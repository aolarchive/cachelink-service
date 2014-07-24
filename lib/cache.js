var Promise = require('bluebird');

module.exports = function (config, log, redis) {

	var maxClearLevels      = 1000000;
	var clearLaterSet       = config.clearLaterSet;
	var clearNowSet         = config.clearNowSet;
	var clearsPerIteration  = config.clearNowAmountPerIteration;
	var prefix              = config.redis.prefix;
	var prefixData          = prefix + 'd:';
	var prefixContains      = prefix + 'c:';
	var prefixIn            = prefix + 'i:';


	/**
	 * Get a value from the cache with the given key.
	 *
	 * @param {string} options.key The key to get the value for.
	 *
	 * @returns {Promise} A promise that resolves to the value or `null` if none.
	 */
	function cacheGet(options) {

		if (!options.key) {
			return Promise.reject('must provide a "key" to get');
		}

		log.debug('cache: [get] ' + options.key);

		var key = prefixData + options.key;

		return redis('get', [key]).then(function (json) {

			var data = null;
			try {
				data = JSON.parse(json);
			} catch (e) {
				log.error('cache: decoding redis(get) ' + options.key, { json: json });
			}

			return data;
		});
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
			return Promise.reject('must provide "keys" to getMany');
		}

		var keys    = [];
		var keysLen = options.keys.length;
		for (var i = 0; i < keysLen; i++) {
			keys.push(prefixData + options.keys[i]);
		}

		log.debug('cache: [getMany] ' + keysLen + ' keys');

		return redis('mget', keys).then(function (jsonArray) {

			if (jsonArray && jsonArray.length !== keysLen) {
				var e = new Error('cache: redis(mget) returned ' + jsonArray.length + ' replies, expected ' + keys.length);
				log.error(e.message, { keys: keys });
				throw e;
			}

			var dataArray = [];
			for (var i = 0; i < keysLen; i++) {
				var json = jsonArray[i];
				try {
					dataArray.push(JSON.parse(json));
				} catch (e) {
					log.error('cache: decoding redis(mget) ' + options.keys[i], { json: json });
					dataArray.push(null);
				}
			}

			return dataArray;
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
		if ('undefined' === options.data) {
			return Promise.reject(new Error('must provide "data" to set'));
		}
		if (!options.millis) {
			return Promise.reject(new Error('must provide a "millis" TTL'));
		}

		var key      = options.key;
		var millis   = options.millis;
		var assoc    = options.associations;
		var assocLen = assoc ? assoc.length : 0;
		var keyData  = prefixData + key;
		var keyIn    = prefixIn   + key;

		log.debug('cache: [set] ' + key + ' for ' + millis + ' millis');

		// Set the data for the key (encoded as JSON).
		var json = JSON.stringify(options.data);
		var asyncCacheSet = redis('set', [keyData, json, 'PX', millis]);

		// Clear any existing associations.
		var asyncClearAssocIn = redis('del', [keyIn]);

		var asyncAssociateIn;
		var asyncExpireAssociateIn;
		var asyncAssociateContains;
		var asyncExpireAssociateContains;

		// Make associations.
		if (assocLen) {

			// The given associated keys are *in* this key.
			var argsAssocIn =[keyIn].concat(assoc);
			asyncAssociateIn = redis('sadd', argsAssocIn);
			asyncExpireAssociateIn = redis('pexpire', [keyIn, millis]);

			// This key *contains* the given associated keys.
			var waitingAssociateContains = [];
			var waitingAssociateExpire   = [];
			for (var i = 0; i < assocLen; i++) {
				var assocKey         = assoc[i];
				var assocKeyContains = prefixContains + assocKey;
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
			cacheSet            : asyncCacheSet,
			clearAssocIn        : asyncClearAssocIn,
			assocIn             : asyncAssociateIn,
			assocContains       : asyncAssociateContains,
			expireAssocIn       : asyncExpireAssociateIn,
			expireAssocContains : asyncExpireAssociateContains
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
			return Promise.reject('must provide "keys" to clear');
		}

		var keysSeen = {};
		var maxLevel = maxClearLevels;

		if (options.levels === 'none') {
			maxLevel = 0;
		} else if ('number' === typeof options.levels) {
			maxLevel = Math.max(0, Math.floor(+options.levels));
		}

		// Clear the cache then attach a property of all cache keys cleared.
		return cacheClearLevel(options.keys, 1).then(function (info) {
			info.allKeysCleared = Object.keys(keysSeen);
			return info;
		});

		function cacheClearLevel(keys, level) {

			// Build a unique set of keys for "data", "in", and "contains" key sets.
			var keysStrings  = [];
			var keysData     = [];
			var keysIn       = [];
			var keysContains = [];
			for (var i = 0; i < keys.length; i++) {
				var key = keys[i];
				if (!keysSeen[key]) {
					keysSeen[key] = true;
					keysStrings.push('' + key);
					keysData.push(prefixData + key);
					keysIn.push(prefixIn + key);
					keysContains.push(prefixContains + key);
				}
			}

			if (!keysStrings.length) {
				return Promise.resolve();
			}

			log.debug('cache: [clear] (level ' + level + ') ' + keysData.length + ' keys');

			// Delete the data from cache.
			var asyncClear = redis('del', keysData);

			// Get all of the *contains* keys for the associations from the *in* keys.
			var asyncGetContainsKeys = redis('sunion', keysIn);

			// Delete all of the *in* keys for the associations.
			var asyncDeleteInSets = redis('del', keysIn);

			// Remove the keys that were cleared from the *contains* keys.
			var asyncRemoveContains = asyncGetContainsKeys.then(function (keysAllContains) {
				return Promise.all((keysAllContains || []).map(function (key) {
					return redis('srem', [prefixContains + key].concat(keys));
				})).then(function (results) {
					return (results && results.length) ? results.reduce(function (a, b) { return a + b; }) : 0;
				});
			});

			var asyncKeysNextLevel;
			var asyncClearNextLevel;

			if (level > maxLevel) {

				asyncKeysNextLevel  = Promise.resolve([]);
				asyncClearNextLevel = Promise.resolve();

			} else {

				// Get the next level of keys to clear.
				asyncKeysNextLevel = redis('sunion', keysContains);

				// Clear the next level of keys.
				asyncClearNextLevel = asyncKeysNextLevel.then(function (keysNextLevel) {
					return keysNextLevel.length ? cacheClearLevel(keysNextLevel, level + 1) : Promise.resolve();
				});

			}

			return Promise.props({
				level               : level,
				keys                : keys,
				keysCount           : keys.length,
				cleared             : asyncClear,
				keysContains        : asyncGetContainsKeys,
				removedFromContains : asyncRemoveContains,
				keysInDeleted       : asyncDeleteInSets,
				keysNextLevel       : asyncKeysNextLevel,
				nextLevel           : asyncClearNextLevel
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
			return Promise.reject('must provide "keys" to clear later');
		}

		log.debug('cache: [clearLater] ' + options.keys.length + ' keys');

		// Add all of the given keys to a clear later set.
		var argsSetAdd = [clearLaterSet].concat(options.keys);
		return redis('sadd', argsSetAdd);
	}

	/**
	 * Clear all keys in the "clear now" set. This will clear in batches using the "smpop" script.
	 *
	 * @returns {Promise} A promise that resolves to an array of arrays containing the keys cleared per iteration.
	 */
	function cacheClearNow() {

		// Clear all of the keys from the given clear later set.
		var keysClearedByIteration = [];

		return cacheClearNowIteration();

		// Pop a few keys from the set and clear them.
		// Once they've been cleared, continue to pop keys and clear until the set has been emptied.
		function cacheClearNowIteration() {

			var pops = [];
			for (var i = 0; i < clearsPerIteration; i++) {
				pops.push(redis('spop', [clearNowSet]));
			}
			return Promise.all(pops).then(function (popped) {

				var keysToClear = popped.filter(function (p) {
					return !!p;
				});

				if (keysToClear && keysToClear.length) {

					log.debug('cache: [clearNow] iteration ' + keysToClear.length + ' keys');

					return cacheClear({ keys: keysToClear }).then(function (clearInfo) {

						if (clearInfo && clearInfo.allKeysCleared) {
							keysClearedByIteration.push(clearInfo.allKeysCleared);
						}
						if (keysToClear.length !== clearsPerIteration) {
							return keysClearedByIteration;
						}

						return cacheClearNowIteration().then(function () {
							return keysClearedByIteration;
						});
					});
				}
			});
		}
	}

	return {
		get        : cacheGet,
		getMany    : cacheGetMany,
		set        : cacheSet,
		clear      : cacheClear,
		clearLater : cacheClearLater,
		clearNow   : cacheClearNow
	};
};
