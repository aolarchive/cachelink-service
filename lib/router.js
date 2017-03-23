const Promise = require('bluebird');
const express = require('express');
const request = require('request');

module.exports = function buildRouter(config, log, cache, cron) {

  const broadcastTimeoutMillis  = (config.broadcastTimeoutSeconds || 5) * 1000;
  const broadcastBaseUrls = config.broadcast || [];
  const noop = () => {};

  if (broadcastBaseUrls && !Array.isArray(broadcastBaseUrls)) {
    const e = new Error(
      'missing "broadcast" key in envs, should be an array of base HTTP URLs'
    );
    log.error(e.message);
    throw e;
  }

  broadcastBaseUrls.forEach((url, i) => {
    if (typeof url !== 'string') {
      const e = new Error(`invalid URL (must be a string) in broadcast[${i}]`);
      log.error(e.message);
      throw e;
    }
    if (!url.match(/^https?:\/\//)) {
      const e = new Error(`invalid URL (must start with "http://" or "https://") in broadcast[${i}]`);
      log.error(e.message);
      throw e;
    }
    if (!url.match(/^https?:\/\/[^/]+/)) {
      const e = new Error(`invalid URL (must not contain a path portion) in broadcast[${i}]`);
      log.error(e.message);
      throw e;
    }
  });

  // Setup routing.

  const router = express.Router();

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
    return function sendErrorFunc(e) {
      res.status(500).send((e && e.message) || 'internal_server_error');
    };
  }

  /**
   * Takes a key or an array of keys and converts it to an array of non-empty keys.
   *
   * @param {string|string[]} keys The keys to clean.
   *
   * @returns {string[]} The cleaned keys.
   */
  function cleanKeysArray(keys) {
    return (Array.isArray(keys) ? keys : [keys]).filter(k => !!k);
  }

  function param(req, ...keys) {
    for (let i = 0; i < keys.length; i += 1) {
      const key   = keys[i];
      const value =
        (req.params && req.params[key]) ||
        (req.body && req.body[key]) ||
        (req.query && req.query[key]);
      if (value) {
        return value;
      }
    }
  }


  /**
   * Get a value from cache.
   *
   * @param req express HTTP request.
   * @param res express HTTP response.
   */
  function routeGet(req, res) {

    cache.get({ key: param(req, 'key') }).then((data) => {

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

    const keys    = param(req, 'key', 'keys', 'k');
    const options = { keys: cleanKeysArray(keys) };

    cache.getMany(options).then((data) => {

      const dataByKey = { };
      for (let i = 0; i < keys.length; i += 1) {
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

    const key          = param(req, 'key');
    const data         = param(req, 'data');
    const millis       =
      (Number(param(req, 'millis')))              ||
      (Number(param(req, 'seconds')) * 1000)      ||
      (Number(param(req, 'minutes')) * 60 * 1000);
    const associations = param(req, 'assoc', 'associations');
    const options      = { key: key, data: data, millis: millis, associations: associations };
    const background   = !!param(req, 'background');
    const error        = background ? noop : sendError(res);
    const complete     = background ? noop : d => res.json(d);

    if (background) {
      res.json({ background: true });
    }

    let broadcastPromise = Promise.resolve(null);
    if (param(req, 'broadcast')) {
      broadcastPromise = broadcast('set', options);
    }

    const promise = cache.set(options);

    appendBroadcastResult(promise, broadcastPromise).then(complete, error);
  }

  /**
   * Clear the given key (or keys) from the cache. Will do a deep clear unless the number of "levels" are given.
   *
   * @param req express HTTP request.
   * @param res express HTTP response.
   */
  function routeClear(req, res) {

    const keys       = param(req, 'key', 'keys', 'k');
    const levels     = param(req, 'levels') || 'all';
    const options    = { keys: cleanKeysArray(keys), levels: levels };
    const background = !!param(req, 'background');
    const error      = background ? noop : sendError(res);
    const complete   = background ? noop : d => res.json(d);

    if (background) {
      res.json({ background: true });
    }

    let broadcastPromise = Promise.resolve(null);
    if (!param(req, 'local')) {
      broadcastPromise = broadcast('clear', options);
    }

    const promise = cache.clear(options);

    appendBroadcastResult(promise, broadcastPromise).then(complete, error);
  }

  /**
   * Clear the given key (or keys) from the cache at a later time.
   *
   * @param req express HTTP request.
   * @param res express HTTP response.
   */
  function routeClearLater(req, res) {

    const keys       = param(req, 'key', 'keys', 'k');
    const options    = { keys: cleanKeysArray(keys) };
    const background = !!param(req, 'background');
    const error      = background ? noop : sendError(res);
    const complete   = background ? noop : d => res.json(d);

    if (background) {
      res.json({ background: true });
    }

    let broadcastPromise = Promise.resolve(null);
    if (!param(req, 'local')) {
      broadcastPromise = broadcast('clear-later', options);
    }

    const promise = cache.clearLater(options);

    appendBroadcastResult(promise, broadcastPromise).then(complete, error);
  }

  /**
   * Force the clear of all keys that were passed to clear-later. This shouldn't normally need
   * to be called since the cron will handle clearing.
   *
   * @param req express HTTP request.
   * @param res express HTTP response.
   */
  function routeClearNow(req, res) {

    const background = !!param(req, 'background');
    const error      = background ? noop : sendError(res);
    const complete   = background ? noop : success => res.json({ started: success });

    if (background) {
      res.json({ background: true });
    }

    let broadcastPromise = Promise.resolve(null);
    if (!param(req, 'local')) {
      broadcastPromise = broadcast('clear-now');
    }

    const promise = cron.startClearNowProcess();

    appendBroadcastResult(promise, broadcastPromise).then(complete, error);
  }

  /**
   * Get the number of keys in the clear-later set and the clear-now set.
   *
   * @param req express HTTP request.
   * @param res express HTTP response.
   */
  function routeClearCounts(req, res) {

    Promise.props({

      clearLaterCount: cache.clearLaterCount(),
      clearNowCount:   cache.clearNowCount(),

    }).then((result) => {

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
    cache.getClusterId().then((clusterId) => {

      // Ignore broadcasts from the same cluster.
      if (req.get('x-postable-cluster') === clusterId) {
        return res.status(500).send('broadcast_error_same_cluster');
      }

      // Perform the broadcast operation.
      let promise;
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
          promise = cron.startClearNowProcess();
          break;
        default:
          break;
      }

      // Send the result of the operation.
      if (promise) {
        promise.then((result) => {
          res.json(result);
        }, sendError(res));
      } else {
        res.status(500).send('broadcast_error_no_such_operation');
      }
    });
  }

  /**
   * Append the result of the broadcast to the promise result.
   *
   * @param {Promise} promise The main promise.
   * @param {Promise} broadcastPromise The broadcast promise.
   *
   * @returns {Promise} The combined promise.
   */
  function appendBroadcastResult(promise, broadcastPromise) {
    return Promise.join(promise, broadcastPromise).then((responses) => {
      const result = responses[0];
      const broadcastResult = responses[1];
      if (result && typeof result === 'object' && !result.broadcastResult) {
        result.broadcastResult = broadcastResult;
      }
      return result;
    });
  }

  /**
   * Broadcast the given operation with the given data to all cachelink clusters defined
   * in the "broadcast" envs.
   *
   * @param {string} operation The operation to broadcast.
   * @param {*}      data      The data for the operation.
   *
   * @returns Promise A promise for the result of the broadcast.
   */
  function broadcast(operation, data) {
    return cache.getClusterId().then(clusterId => new Promise((resolve) => {

      const responsesByUrl = {};
      let outstandingResponses = broadcastBaseUrls.length;
      let broadcastsFailed = 0;

      if (!broadcastBaseUrls.length) {
        return resolve(null);
      }

      broadcastBaseUrls.forEach((baseUrl) => {

        const url = `${baseUrl}/broadcast/${operation}`;

        log.debug(`broadcast: broadcasting (${url})`);

        request({
          method:  'POST',
          url:     url,
          json:    data,
          timeout: broadcastTimeoutMillis,
          auth:    config.basicAuth,
          headers: {
            'x-postable-cluster': clusterId,
          },
        }, (e, response, body) => {

          const status = response.statusCode;

          if (e) {
            log.error(
              `broadcast: failed (${url}): ${e.message ? e.message : '?'}`, { error: e }
            );
            responsesByUrl[url] = { status: 'broadcast_failed' };
            broadcastsFailed += 1;
          } else if (status !== 200) {
            log.error(
              `broadcast: failed (${url}) (status ${status})`, { body: body }
            );
            responsesByUrl[url] = { status: status, body: body };
            broadcastsFailed += 1;
          } else {
            log.debug(`broadcast: success (${url})`);
            responsesByUrl[url] = { status: status, body: body };
          }

          outstandingResponses -= 1;
          if (outstandingResponses <= 0) {
            resolve({
              operation: operation,
              data:      data,
              failed:    broadcastsFailed,
              responses: responsesByUrl,
            });
          }

        });
      });
    }));
  }

  return router;
};
