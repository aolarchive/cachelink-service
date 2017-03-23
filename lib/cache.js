const Promise = require('bluebird');

module.exports = function buildCache(config, log, redis) {

  const maxClearLevels      = 1000000;
  const clearLaterSet       = config.clearLaterSet;
  const clearNowSet         = config.clearNowSet;
  const clearsPerIteration  = config.clearNowAmountPerIteration;
  const prefix              = config.redisPrefix;
  const prefixData          = `${prefix}d:`;
  const prefixContains      = `${prefix}c:`;
  const prefixIn            = `${prefix}i:`;


  /**
   * Get a value from the cache with the given key.
   *
   * @param {string} options.key The key to get the value for.
   *
   * @returns {Promise} A promise that resolves to the value or `null` if none.
   */
  function cacheGet(options) {

    if (!options.key) {
      return Promise.reject(new Error('must provide a "key" to get'));
    }

    log.debug(`cache: [get] ${options.key}`);

    const key = prefixData + options.key;

    return redis('get', [key]);
  }

  /**
   * Get many values from cache with the given keys. Maintains order.
   *
   * @param {string[]} options.keys The keys to get values for.
   *
   * @returns {Promise} A promise that resolves to an array of values or `null`
   *   in the same order as the keys given.
   */
  function cacheGetMany(options) {

    if (!options.keys || !options.keys.length) {
      return Promise.reject(new Error('must provide "keys" to getMany'));
    }

    const keys    = options.keys.map(k => prefixData + k);
    const keysLen = options.keys.length;

    log.debug(`cache: [getMany] ${keysLen} keys`);

    return redis('mget', keys).then((rawArray) => {

      if (rawArray && rawArray.length !== keysLen) {
        const e = new Error(`cache: redis(mget) returned ${rawArray.length} replies, expected ${keys.length}`);
        log.error(e.message, { keys: keys });
        throw e;
      }

      return rawArray;
    });
  }

  /**
   * Set the given key to the given data with the given timeout in milliseconds.
   *
   * @param {string} options.key    The key for the set.
   * @param {*}      options.data   The data to set.
   * @param {number} options.millis The TTL for the set (in millis).
   *
   * @returns {Promise} A promise that resolves to an object containing details of the set operation:
   * <code>
   * {
   *   cacheSet            : // if the set was successful
   *   clearAssocIn        : // if the associated key clear was successful
   *   assocIn             : // how many associations were tied to the "in" set
   *   assocContains       : // how many "contains" sets this key was added to
   *   expireAssocIn       : // whether the "in" set TTL was set
   *   expireAssocContains : // whether the "contains" sets TTLs were set
   * }
   * </code>
   */
  function cacheSet(options) {

    if (!options.key) {
      return Promise.reject(new Error('must provide a "key" to set'));
    }
    if (typeof options.data === 'undefined') {
      return Promise.reject(new Error('must provide "data" to set'));
    }
    if (!options.millis) {
      return Promise.reject(new Error('must provide a "millis" TTL'));
    }

    const key      = options.key;
    const millis   = options.millis;
    const assoc    = options.associations;
    const assocLen = assoc ? assoc.length : 0;
    const keyData  = prefixData + key;
    const keyIn    = prefixIn + key;

    log.debug(`cache: [set] ${key} for ${millis} millis`);

    // Set the data for the key.
    const asyncCacheSet = redis('set', [keyData, options.data, 'PX', millis]);

    // Clear any existing associations.
    const asyncClearAssocIn = redis('del', [keyIn]);

    let asyncAssociateIn;
    let asyncExpireAssociateIn;
    let asyncAssociateContains;
    let asyncExpireAssociateContains;

    // Make associations.
    if (assocLen) {

      // The given associated keys are *in* this key.
      const argsAssocIn = [keyIn].concat(assoc);
      asyncAssociateIn = redis('sadd', argsAssocIn);
      asyncExpireAssociateIn = redis('pexpire', [keyIn, millis]);

      // This key *contains* the given associated keys.
      const waitingAssociateContains = [];
      const waitingAssociateExpire   = [];
      for (let i = 0; i < assocLen; i += 1) {
        const assocKey         = assoc[i];
        const assocKeyContains = prefixContains + assocKey;
        waitingAssociateContains.push(redis('sadd', [assocKeyContains, key]));
        waitingAssociateExpire.push(redis('pexpiremax', [assocKeyContains, prefixData + key]));
      }

      asyncAssociateContains       = Promise.all(waitingAssociateContains);
      asyncExpireAssociateContains = Promise.all(waitingAssociateExpire);

    } else {

      asyncAssociateIn             = Promise.resolve();
      asyncExpireAssociateIn       = Promise.resolve();
      asyncAssociateContains       = Promise.resolve();
      asyncExpireAssociateContains = Promise.resolve();

    }

    return Promise.props({
      cacheSet:            asyncCacheSet,
      clearAssocIn:        asyncClearAssocIn,
      assocIn:             asyncAssociateIn,
      assocContains:       asyncAssociateContains,
      expireAssocIn:       asyncExpireAssociateIn,
      expireAssocContains: asyncExpireAssociateContains,
    }).then((result) => {
      result.success = result.cacheSet === 'OK';
      if (assocLen) {
        result.success =
          result.success &&
          result.assocIn &&
          result.expireAssocIn &&
          result.assocContains.length === assocLen &&
          result.expireAssocContains.length === assocLen;
      }
      return result;
    });
  }

  /**
   * Clear the given keys in cache and the given amount of association levels.
   *
   * @param {string[]}      options.keys   The keys to clear
   * @param {number|string} options.levels The association levels to clear. Defaults to "all".
   *   Can be a positive integer, or a string ("none" or "all).
   *
   * @returns {Promise} A promise that resolves to information about the clear.
   * <code>
   * {
   *   level               : // this level number (starts at 1)
   *   keys                : // keys to be cleared at this level
   *   keysCount           : // number of keys to be cleared at this level
   *   cleared             : // number of data keys cleared
   *   keysContains        : // keys ("contains" sets) modified
   *   removedFromContains : // keys removed from "contains" sets
   *   keysInDeleted       : // keys ("in" sets) deleted
   *   keysNextLevel       : // the keys that will be cleared on the next level
   *   nextLevel           : // an object similar to this one, containing information about the next level clear
   * }
   * </code>
   */
  function cacheClear(options) {

    if (!options.keys || !options.keys.length) {
      return Promise.reject(new Error('must provide "keys" to clear'));
    }

    const keysSeen = {};
    let maxLevel = maxClearLevels;

    if (options.levels === 'none') {
      maxLevel = 0;
    } else if (typeof options.levels === 'number') {
      maxLevel = Math.max(0, Math.floor(+options.levels));
    }

    // Clear the cache then attach a property of all cache keys cleared.
    return cacheClearLevel(options.keys, 1).then((info) => {
      info.allKeysCleared = Object.keys(keysSeen);
      return info;
    });

    function cacheClearLevel(keys, level) {

      // Build a unique set of keys for "data", "in", and "contains" key sets.
      const keysStrings  = [];
      const keysData     = [];
      const keysIn       = [];
      const keysContains = [];
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!keysSeen[key]) {
          keysSeen[key] = true;
          keysStrings.push(String(key));
          keysData.push(prefixData + key);
          keysIn.push(prefixIn + key);
          keysContains.push(prefixContains + key);
        }
      }

      if (!keysStrings.length) {
        return Promise.resolve();
      }

      log.debug(`cache: [clear] (level ${level}) ${keysData.length} keys`);

      // Delete the data from cache.
      const asyncClear = redis('del', keysData);

      // Get all of the *contains* keys for the associations from the *in* keys.
      const asyncGetContainsKeys = redis('sunion', keysIn);

      // Delete all of the *in* keys for the associations.
      const asyncDeleteInSets = redis('del', keysIn);

      // Remove the keys that were cleared from the *contains* keys.
      const asyncRemoveContains = asyncGetContainsKeys.then(keysAllContains =>
        Promise.all(
          (keysAllContains || []).map(key => redis('srem', [prefixContains + key].concat(keys)))
        ).then(results => ((results && results.length) ? results.reduce((a, b) => a + b) : 0))
      );

      let asyncKeysNextLevel;
      let asyncClearNextLevel;

      if (level > maxLevel) {

        asyncKeysNextLevel  = Promise.resolve([]);
        asyncClearNextLevel = Promise.resolve();

      } else {

        // Get the next level of keys to clear.
        asyncKeysNextLevel = redis('sunion', keysContains);

        // Clear the next level of keys.
        asyncClearNextLevel = asyncKeysNextLevel.then(
          keysNextLevel => (keysNextLevel.length ? cacheClearLevel(keysNextLevel, level + 1) : Promise.resolve())
        );

      }

      return Promise.props({
        success:             true,
        level:               level,
        keys:                keys,
        keysCount:           keys.length,
        cleared:             asyncClear,
        keysContains:        asyncGetContainsKeys,
        removedFromContains: asyncRemoveContains,
        keysInDeleted:       asyncDeleteInSets,
        keysNextLevel:       asyncKeysNextLevel,
        nextLevel:           asyncClearNextLevel,
      });
    }
  }

  /**
   * Add the given keys to a de-dupe queue for clearing later.
   * These keys will be fully cleared.
   *
   * @param {string[]} options.keys The keys to clear later.
   *
   * @returns {Promise} A promise that resolves to the number of keys added.
   */
  function cacheClearLater(options) {

    if (!options.keys || !options.keys.length) {
      return Promise.reject(new Error('must provide "keys" to clear later'));
    }

    log.debug(`cache: [clearLater] ${options.keys.length} keys`);

    // Add all of the given keys to a clear later set.
    const argsSetAdd = [clearLaterSet].concat(options.keys);
    return redis('sadd', argsSetAdd).then(result => ({ success: !!result, added: +result }));
  }

  /**
   * Clear all keys in the "clear now" set. This will clear in batches using the "smpop" script.
   *
   * @returns {Promise} A promise that resolves to an array of arrays containing the keys cleared per iteration.
   */
  function cacheClearNow() {

    // Clear all of the keys from the given clear later set.
    const keysClearedByIteration = [];

    return cacheClearNowIteration();

    // Pop a few keys from the set and clear them.
    // Once they've been cleared, continue to pop keys and clear until the set has been emptied.
    function cacheClearNowIteration() {

      const pops = [];
      for (let i = 0; i < clearsPerIteration; i += 1) {
        pops.push(redis('spop', [clearNowSet]));
      }
      return Promise.all(pops).then((popped) => {

        const keysToClear = popped.filter(p => !!p);

        if (keysToClear && keysToClear.length) {

          log.debug(`cache: [clearNow] iteration ${keysToClear.length} keys`);

          return cacheClear({ keys: keysToClear }).then((clearInfo) => {

            if (clearInfo && clearInfo.allKeysCleared) {
              keysClearedByIteration.push(clearInfo.allKeysCleared);
            }
            if (keysToClear.length !== clearsPerIteration) {
              return keysClearedByIteration;
            }

            return cacheClearNowIteration().then(() => keysClearedByIteration);
          });
        }
      });
    }
  }

  /**
   * Returns the amount of keys in the clear-later set.
   *
   * @returns {Promise} A promise that resolves to the number of keys in the clear-later set.
   */
  function cacheClearLaterCount() {
    return redis('scard', [clearLaterSet]);
  }

  /**
   * Returns the amount of keys in the clear-now set.
   *
   * @returns {Promise} A promise that resolves to the number of keys in the clear-now set.
   */
  function cacheClearNowCount() {
    return redis('scard', [clearNowSet]);
  }

  /**
   * Get the cluster ID.
   *
   * @returns {string} The cluster ID.
   */
  function getClusterId() {
    return redis.getClusterId();
  }


  return {
    get:             cacheGet,
    getMany:         cacheGetMany,
    set:             cacheSet,
    clear:           cacheClear,
    clearLater:      cacheClearLater,
    clearLaterCount: cacheClearLaterCount,
    clearNow:        cacheClearNow,
    clearNowCount:   cacheClearNowCount,
    getClusterId:    getClusterId,
  };
};
