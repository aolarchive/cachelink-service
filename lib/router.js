var Promise = require('bluebird');
var express = require('express');
var request = require('request');

module.exports = function (config, log, cache, cron) {

	var broadcastTimeout  = config.broadcastTimeout;
	var broadcastBaseUrls = config.broadcast || [];
	var e;

	if (broadcastBaseUrls && !Array.isArray(broadcastBaseUrls)) {
		e = new Error(
			'missing "broadcast" key in config, should be an array of base HTTP URLs'
		);
		log.error(e.message);
		throw e;
	}

	for (var i = 0; i < broadcastBaseUrls.length; i++) {
		var url = broadcastBaseUrls[i];
		if ('string' !== typeof url) {
			e = new Error('invalid URL (must be a string) in broadcast[' + i + ']');
			log.error(e.message);
			throw e;
		}
		if (!url.match(/^https?\:\/\//)) {
			e = new Error('invalid URL (must start with "http://" or "https://") in broadcast[' + i + ']');
			log.error(e.message);
			throw e;
		}
		if (!url.match(/^https?\:\/\/[^/]+/)) {
			e = new Error('invalid URL (must not contain a path portion) in broadcast[' + i + ']');
			log.error(e.message);
			throw e;
		}
	}

	// Setup routing.

	var router = express.Router();

	router.put('/', routeSet);
	router.delete('/', routeClear);
	router.put('/clear-later', routeClearLater);
	router.post('/broadcast/:operation', receiveBroadcast);
	router.put('/:key', routeSet);
	router.delete('/:key', routeClear);
	router.get('/clear/:key', routeClear);
	router.get('/clear', routeClear);
	router.get('/clear-later/:key', routeClearLater);
	router.get('/clear-later', routeClearLater);
	router.get('/clear-now', routeClearNow);
	router.get('/clear-counts', routeClearCounts);
	router.get('/:key', routeGet);
	router.get('/', routeGetMany);

	/**
	 * Create a function to handle errors for the given response.
	 *
	 * @param res express HTTP response.
	 *
	 * @returns {Function} The error handler for the given response.
	 */
	function sendError(res) {
		return function (e) {
			res.send(500, (e && e.message) || 'Internal Server Error');
		};
	}


	/**
	 * Get a value from cache.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeGet(req, res) {

		cache.get({ key: req.param('key') }).then(function (data) {

			res.json(data);

		}, sendError(res));
	}

	/**
	 * Get multiple values from cache.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeGetMany(req, res) {

		var keys    = req.param('key') || req.param('keys') || req.param('k');
		var options = {
			keys: (Array.isArray(keys) ? keys : [keys]).filter(function (k) {
				return !!k;
			})
		};

		cache.getMany(options).then(function (data) {

			var dataByKey = { };
			for (var i = 0; i < keys.length; i++) {
				dataByKey[keys[i]] = data[i];
			}

			res.json(dataByKey);

		}, sendError(res));
	}

	/**
	 * Set a value in cache using the given key, data, and TTL (in millis, seconds, or minutes).
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeSet(req, res) {

		var key          = req.param('key');
		var data         = req.param('data');
		var millis       = +req.param('millis') || (+req.param('seconds') * 1000) || (+req.param('minutes') * 60 * 1000);
		var associations = req.param('assoc') || req.param('associations');
		var options      = { key: key, data: data, millis: millis, associations: associations };

		if (req.param('broadcast')) {
			broadcast('set', options);
		}

		cache.set(options).then(function (setInfo) {

			res.json(setInfo);

		}, sendError(res));
	}

	/**
	 * Clear the given key (or keys) from the cache. Will do a deep clear unless the number of "levels" are given.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeClear(req, res) {

		var keys    = req.param('key') || req.param('keys') || req.param('k');
		var levels  = req.param('levels') || 'all';
		var options = { keys: Array.isArray(keys) ? keys : [keys], levels: levels };

		if (!req.param('local')) {
			broadcast('clear', options);
		}

		cache.clear(options).then(function (clearInfo) {

			res.json(clearInfo);

		}, sendError(res));
	}

	/**
	 * Clear the given key (or keys) from the cache at a later time.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeClearLater(req, res) {

		var keys    = req.param('key') || req.param('keys') || req.param('k');
		var options = {
			keys: (Array.isArray(keys) ? keys : [keys]).filter(function (k) {
				return !!k;
			})
		};

		if (!req.param('local')) {
			broadcast('clear-later', options);
		}

		cache.clearLater(options).then(function (clearLaterInfo) {

			res.json(clearLaterInfo);

		}, sendError(res));
	}

	/**
	 * Force the clear of all keys that were passed to clear-later. This shouldn't normally need
	 * to be called since the cron will handle clearing.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeClearNow(req, res) {

		if (!req.param('local')) {
			broadcast('clear-now');
		}

		cron.startClearNowProcess().then(function (success) {

			res.json({ started: success });

		}, sendError(res));
	}

	/**
	 * Get the number of keys in the clear-later set and the clear-now set.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function routeClearCounts(req, res) {

		Promise.props({

			clearLaterCount : cache.clearLaterCount(),
			clearNowCount   : cache.clearNowCount()

		}).then(function (result) {

			res.json(result);

		}, sendError(res));
	}

	/**
	 * Receive a broadcast from another cachelink cluster and perform the operation.
	 *
	 * @param req express HTTP request.
	 * @param res express HTTP response.
	 */
	function receiveBroadcast(req, res) {
		var promise;
		switch (req.params.operation) {
			case 'set':
				promise = cache.set(req.body);
				break;
			case 'clear':
				promise = cache.clear(req.body);
				break;
			case 'clear-later':
				promise = cache.clearLater(req.body);
				break;
			case 'clear-now':
				promise = cache.startClearNowProcess();
				break;
		}
		if (promise) {
			promise.then(function (result) {
				res.json(result);
			}, sendError(res));
		} else {
			res.send(500, 'no such operation');
		}
	}

	/**
	 * Broadcast the given operation with the given data to all cachelink clusters defined
	 * in the "broadcast" config.
	 *
	 * @param {string} operation The operation to broadcast.
	 * @param {*}      data      The data for the operation.
	 */
	function broadcast(operation, data) {

		broadcastBaseUrls.forEach(function (baseUrl) {

			var url = baseUrl + '/broadcast/' + operation;

			log.debug('broadcast: broadcasting (' + url + ')');

			request({ method: 'POST', url: url, json: data, timeout: broadcastTimeout }, function (e, response, body) {

				if (e) {
					log.error('broadcast: failed ' + '(' + url + '): ' + (e.message ? e.message : '?'), { error: e });
				} else if (!response.statusCode !== 200) {
					log.error('broadcast: failed ' + '(' + url + ') (status ' + response.statusCode + ')', { body: body });
				} else {
					log.debug('broadcast: success (' + url + ')');
				}

			});
		});
	}

	return router;
};