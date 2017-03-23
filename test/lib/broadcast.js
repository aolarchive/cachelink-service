const Promise          = require('bluebird');
const request          = require('request');
const assert           = require('assert');
const cachelinkService = require('../../lib/index.js');
const log              = require('./log.js');
const initEnv          = require('../env.json');

const services = [];
const ports = [];
const envs = [];
const totalServers = 4;
const getLog = () => log;

const servicesReady = new Promise((resolve) => {

  // Build initEnv.
  for (let i = 0; i < totalServers; i += 1) {
    const port = initEnv.CACHELINK_PORT + i + 1;
    ports.push(port);
    envs[i] = Object.assign({}, initEnv, {
      CACHELINK_PORT: port,
      CACHELINK_REDIS_PREFIX: `test-${i}`,
      CACHELINK_BROADCAST: '',
    });
  }
  for (let i = 0; i < totalServers; i += 1) {
    for (let j = 0; j < totalServers; j += 1) {
      if (i !== j) {
        envs[i].CACHELINK_BROADCAST = `${envs[i].CACHELINK_BROADCAST || ''};http://localhost:${ports[j]}`;
      }
    }
  }

  // Start services.
  let servicesWaiting = totalServers;
  const callback = () => {
    servicesWaiting -= 1;
    if (!servicesWaiting) {
      resolve();
    }
  };
  for (let i = 0; i < totalServers; i += 1) {
    services[i] = cachelinkService(envs[i], { log: getLog });
    services[i].start(callback);
  }
});

function callRoute(serviceNumber, httpMethod, path, data, done) {
  servicesReady.then(() => {
    const config = services[serviceNumber].config;
    request({
      method: httpMethod,
      url: `http://localhost:${config.port}${path}`,
      json: data,
      auth: {
        user: config.basicAuthUser,
        pass: config.basicAuthPass,
      },
    }, done || (() => {}));
  });
}

function observeAllServicesCache(noreply, field, wrapper, done, timeout) {
  return observeAllServices(noreply, s => s.cache, field, wrapper, done, timeout);
}
function observeAllServicesCron(noreply, field, wrapper, done, timeout) {
  return observeAllServices(noreply, s => s.cron, field, wrapper, done, timeout);
}

function observeAllServices(noreply, objGet, field, wrapper, done, timeout) {
  timeout = timeout || 3000;
  done = done || (() => { });
  let waiting = services.length - noreply.length;
  const norep = { };
  const didNotReply = { };
  let timeoutHandle;
  for (let i = 0; i < noreply.length; i += 1) {
    norep[String(noreply[i])] = true;
  }
  const stopObserving = [];
  services.forEach((service, num) => {
    didNotReply[String(num)] = true;
    stopObserving.push(observeOnce(objGet(service), field, (...args) => {
      delete didNotReply[String(num)];
      if (!norep[String(num)]) {
        waiting -= 1;
      }
      if (!waiting) {
        const complete = done;
        done = () => { };
        setTimeout(() => {
          stopObserving.forEach(stop => stop());
          clearTimeout(timeoutHandle);
          complete();
        }, 200);
      }
      wrapper(...args);
    }, timeout));
  });
  timeoutHandle = setTimeout(() => {
    if (waiting) {
      const dnr = [];
      Object.keys(didNotReply).forEach((k) => {
        if (!norep[k]) {
          dnr.push(k);
        }
      });
      if (dnr.length) {
        throw new Error(`services (${dnr.join(', ')}) did not execute.`);
      }
      const rep = [];
      Object.keys(norep).forEach((k) => {
        if (!didNotReply[k]) {
          rep.push(k);
        }
      });
      if (rep.length) {
        throw new Error(`services (${rep.join(', ')}) executed, they shouldn't have.`);
      }
    }
    done();
    done = () => { };
  }, timeout);
}

function observeOnce(obj, field, wrapper, timeout) {
  const original = obj[field];
  let observing = true;
  const stopObserving = () => {
    if (observing) {
      obj[field] = original;
      observing = false;
    }
  };
  obj[field] = (...args) => {
    wrapper(...args);
    stopObserving();
    return original(...args);
  };
  setTimeout(stopObserving, timeout);
  return stopObserving;

}

describe('broadcast', function describeBroadcast() {

  this.timeout(4000);
  this.slow(2000);

  describe('PUT /:key', () => {

    it('works with no broadcast', (done) => {
      observeAllServicesCache([0, 2, 3], 'set', (options) => {
        assert.deepEqual(options, { key: 'foo', data: 'bar', millis: 100, associations: ['baz', 'qux'] });
      }, done);
      callRoute(1, 'PUT', '/foo', { data: 'bar', millis: 100, associations: ['baz', 'qux'] });
    });

    it('works with broadcast to (0,2,3)', (done) => {
      observeAllServicesCache([], 'set', (options) => {
        assert.deepEqual(options, { key: 'foo', data: 'bar', millis: 100, associations: ['baz', 'qux'] });
      }, done);
      callRoute(1, 'PUT', '/foo?broadcast=1', { data: 'bar', millis: 100, associations: ['baz', 'qux'] });
    });

    it('works with broadcast to (0,1,3)', (done) => {
      observeAllServicesCache([], 'set', (options) => {
        assert.deepEqual(options, { key: 'foo', data: 'bar', millis: 100, associations: ['baz', 'qux'] });
      }, done);
      callRoute(2, 'PUT', '/foo?broadcast=1', { data: 'bar', millis: 100, associations: ['baz', 'qux'] });
    });
  });

  describe('DELETE /:key', () => {

    it('works with local flag', (done) => {
      observeAllServicesCache([0, 2, 3], 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 'all' });
      }, done);
      callRoute(1, 'DELETE', '/foo?local=1', {});
    });

    it('works with broadcast (0,2,3)', (done) => {
      observeAllServicesCache([], 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 'all' });
      }, done);
      callRoute(1, 'DELETE', '/foo', {});
    });

    it('works with broadcast (0,1,3)', (done) => {
      let waiting = 2;
      const complete = () => {
        waiting -= 1;
        if (!waiting) {
          done();
        }
      };
      observeAllServicesCache([], 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 4 });
      }, complete);
      callRoute(2, 'DELETE', '/foo', { levels: 4 }, (e, res, data) => {
        assert(res);
        assert.equal(200, res.statusCode);
        assert(data);
        assert(data.success);
        assert(data.broadcastResult);
        assert(data.broadcastResult.failed === 0);
        assert(data.broadcastResult.responses);
        assert(Object.keys(data.broadcastResult.responses).length === 3);
        complete();
      });
    });
  });

  describe('PUT /clear-later', () => {

    it('works with local flag', (done) => {
      observeAllServicesCache([0, 2, 3], 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['one'] });
      }, done);
      callRoute(1, 'PUT', '/clear-later?local=1', { keys: ['one'] });
    });

    it('works with broadcast (0,2,3)', (done) => {
      observeAllServicesCache([], 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['asdf'] });
      }, done);
      callRoute(1, 'PUT', '/clear-later', { keys: ['asdf'] });
    });

    it('works with broadcast (0,1,3)', (done) => {
      observeAllServicesCache([], 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'] });
      }, done);
      callRoute(1, 'PUT', '/clear-later', { keys: ['foo', 'bar'] });
    });
  });

  describe('GET /clear-now', () => {

    it('works with local flag', (done) => {
      observeAllServicesCron([0, 2, 3], 'startClearNowProcess', (...args) => {
        assert.equal(0, args.length);
      }, done);
      callRoute(1, 'GET', '/clear-now?local=1');
    });

    it('works with broadcast (0,2,3)', (done) => {
      observeAllServicesCron([], 'startClearNowProcess', (...args) => {
        assert.equal(0, args.length);
      }, done);
      callRoute(1, 'GET', '/clear-now');
    });

    it('works with broadcast (0,1,3)', (done) => {
      observeAllServicesCron([], 'startClearNowProcess', (...args) => {
        assert.equal(0, args.length);
      }, done);
      callRoute(1, 'GET', '/clear-now');
    });
  });
});
