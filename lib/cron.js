module.exports = function buildCron(config, log, redis, cache) {

  const syncKey             = config.clearLaterSyncKey;
  const clearIntervalSecs   = config.clearLaterIntervalSeconds;
  const clearIntervalMillis = config.clearLaterIntervalSeconds * 1000;
  const cronChannel         = config.cronChannel;
  const clearLaterSet       = config.clearLaterSet;
  const clearNowSet         = config.clearNowSet;
  let clearing              = null;
  let cronInterval          = null;
  let listening             = false;

  const cron = {
    startCron:            startCron,
    stopCron:             stopCron,
    listenForMessages:    listenForMessages,
    startClearNowProcess: startClearNowProcess,
    clearNow:             clearNow,
    checkSyncKey:         checkSyncKey,
  };

  /**
   * Start this process's internal cron.
   * Every tick, try to set the sync key. If we are the first to set it (the clear
   * interval has expired and we were the first to check) then start the clear process.
   */
  function startCron() {
    if (!cronInterval) {

      log.info(`cron: starting (every ${clearIntervalSecs} seconds)`);

      cronInterval = setInterval(() => {
        cron.checkSyncKey();
      }, clearIntervalMillis);
    }
  }

  /**
   * Check the sync key and start the clear now process if it has expired.
   */
  function checkSyncKey() {
    log.info(`cron: tick! (every ${clearIntervalSecs} seconds)`);
    return redis('set', [syncKey, clearIntervalMillis, 'px', clearIntervalMillis - 500, 'nx'])
      .then((success) => {

        if (success === 'OK') {

          log.info('cron: needs clear, starting clear process');
          cron.startClearNowProcess();
        }
        return success;
      });
  }

  /**
   * Stop this process's internal cron.
   */
  function stopCron() {
    if (cronInterval) {

      log.info('cron: stopping');

      clearInterval(cronInterval);
    }
    cronInterval = null;
  }

  /**
   * Listen for broadcasts to start the clear process.
   */
  function listenForMessages() {
    if (!listening) {
      listening = true;

      log.info('cron: listening for messages');

      redis.subscribe(cronChannel, (message) => {

        if (message === 'startClear') {

          log.info('cron: got message to clear');
          cron.clearNow();
        }
      });
    }
  }

  /**
   * Starts the clear process.
   * This will move all keys from the "clear-later" set to the "clear-now" set and
   * broadcast a message to the cluster to start the clear.
   */
  function startClearNowProcess() {

    // Move all keys to the "clear-now" set.
    return redis('smoveall', [clearLaterSet, clearNowSet]).then((success) => {

      if (success) {

        log.info('cron: prepped clear set. ready. broadcasting clear start message');
        // Broadcast to cluster hosts to start the clear.
        redis.publish(cronChannel, 'startClear');
        // Start the local clear immediately.
        cron.clearNow();

      } else {

        log.info('cron: no keys to clear');
      }

      return { success: success };
    });
  }

  /**
   * Clear all keys in the "clear-now" set.
   * If already in the process of clearing, do nothing.
   */
  function clearNow() {

    if (!clearing) {

      log.info('cron: clearing started');

      clearing = cache.clearNow().then(() => {

        log.info('cron: clearing complete');
        clearing = null;
      });
    }

    return clearing;
  }

  return cron;
};
