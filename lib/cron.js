module.exports = function (config, log, redis, cache) {

	var syncKey             = config.clearLaterSyncKey;
	var clearIntervalMillis = config.clearLaterInterval * 1000;
	var cronChannel         = config.cronChannel;
	var clearLaterSet       = config.clearLaterSet;
	var clearNowSet         = config.clearNowSet;
	var clearing            = null;
	var cronInterval        = null;
	var listening           = false;

	var cron = {
		startCron            : startCron,
		stopCron             : stopCron,
		listenForMessages    : listenForMessages,
		startClearNowProcess : startClearNowProcess,
		clearNow             : clearNow,
		checkSyncKey         : checkSyncKey
	};

	/**
	 * Start this process's internal cron.
	 * Every tick, try to set the sync key. If we are the first to set it (the clear
	 * interval has expired and we were the first to check) then start the clear process.
	 */
	function startCron() {
		if (!cronInterval) {
			cronInterval = setInterval(function () {
				cron.checkSyncKey();
			}, clearIntervalMillis);
		}
	}

	/**
	 * Check the sync key and start the clear now process if it has expired.
	 */
	function checkSyncKey() {
		log.info('cron: checking clear cron sync key');
		return redis('set', [syncKey, clearIntervalMillis, 'px', clearIntervalMillis - 500, 'nx']).then(function (success) {

			if (success) {

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
			redis.subscribe(cronChannel, function (message) {

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
		log.info('cron: prepping clear set');
		return redis('smoveall', [clearLaterSet, clearNowSet]).then(function (success) {

			if (success) {

				log.info('cron: broadcasting clear start message');
				// Broadcast to cluster hosts to start the clear.
				redis.publish(cronChannel, 'startClear');
				// Start the local clear immediately.
				cron.clearNow();

			} else {

				log.error('cron: error occurred when moving the clear-later set into the clear-now set');
			}

			return success;
		});
	}

	/**
	 * Clear all keys in the "clear-now" set.
	 * If already in the process of clearing, do nothing.
	 */
	function clearNow() {

		if (!clearing) {

			log.info('cron: clearing started');

			clearing = cache.clearNow().then(function () {

				log.info('cron: clearing complete');
				clearing = null;
			});
		}

		return clearing;
	}

	return cron;
};
