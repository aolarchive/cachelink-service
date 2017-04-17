const request          = require('request');
const assert           = require('assert');
const cachelinkService = require('../../lib/index.js');
const log              = require('./log.js');

const cachelink = new Promise((resolve) => {
  const service = cachelinkService(process.env, { log: () => log });
  service.start();
  resolve(service);
});

function callRouteNoAuth(httpMethod, path, data, callback) {
  cachelink.then((service) => {
    request({
      method: httpMethod,
      url: `http://localhost:${service.config.port}${path}`,
      json: data,
    }, callback || (() => {}));
  });
}

function callRoute(httpMethod, path, data, callback) {
  cachelink.then((service) => {
    const basicAuth = (service.config.basicAuthUser && service.config.basicAuthPass)
      ? { user: service.config.basicAuthUser, pass: service.config.basicAuthPass }
      : undefined;
    request({
      method: httpMethod,
      url: `http://localhost:${service.config.port}${path}`,
      json: data,
      auth: basicAuth,
    }, callback || (() => {}));
  });
}

function observeOnce(obj, field, wrapper) {
  const original = obj[field];
  obj[field] = (...args) => {
    wrapper(...args);
    obj[field] = original;
    return original(...args);
  };
}

describe('router', () => {

  let service;

  before(function beforeRouter() {
    this.timeout(5000);
    return cachelink.then((s) => {
      service = s;
    });
  });


  describe('GET /', () => {

    it('should not work without basic auth', (done) => {
      callRouteNoAuth('GET', '/?key=foo', null, (e, res) => {
        assert.equal(401, res.statusCode);
        done();
      });
    });

    it('works', (done) => {
      observeOnce(service.cache, 'getMany', (options) => {
        assert.deepEqual(options, { keys: ['foo'] });
        done();
      });
      callRoute('GET', '/?key=foo', null);
    });

  });

  describe('PUT /:key', () => {

    it('works', (done) => {
      observeOnce(service.cache, 'set', (options) => {
        assert.deepEqual(options, { key: 'foo', data: 'bar', millis: 100, associations: ['baz', 'qux'] });
        done();
      });
      callRoute('PUT', '/foo', { data: 'bar', millis: 100, associations: ['baz', 'qux'] });
    });
  });

  describe('GET /clear', () => {

    it('works with query string "k"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 'all' });
        done();
      });
      callRoute('GET', '/clear?k=foo', null);
    });

    it('works with query string "key"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'], levels: 'all' });
        done();
      });
      callRoute('GET', '/clear?key=foo&key=bar', null);
    });

    it('works with query string "keys"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'], levels: 'all' });
        done();
      });
      callRoute('GET', '/clear?keys=foo&keys=bar&keys=baz', null);
    });
  });

  describe('DELETE /:key', () => {

    it('works', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 'all' });
        done();
      });
      callRoute('DELETE', '/foo', null);
    });
  });

  describe('DELETE /', () => {

    it('works with query string "k"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 'all' });
        done();
      });
      callRoute('DELETE', '/?k=foo', null);
    });

    it('works with query string "key"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'], levels: 'all' });
        done();
      });
      callRoute('DELETE', '/?key=foo&key=bar', null);
    });

    it('works with query string "keys"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'], levels: 'all' });
        done();
      });
      callRoute('DELETE', '/?keys=foo&keys=bar&keys=baz', null);
    });

    it('works with data "k"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo'], levels: 54 });
        done();
      });
      callRoute('DELETE', '/', { k: ['foo'], levels: 54 });
    });

    it('works with data "key"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'], levels: 'none' });
        done();
      });
      callRoute('DELETE', '/', { key: ['foo', 'bar'], levels: 'none' });
    });

    it('works with data "keys"', (done) => {
      observeOnce(service.cache, 'clear', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'], levels: 2 });
        done();
      });
      callRoute('DELETE', '/', { keys: ['foo', 'bar', 'baz'], levels: 2 });
    });
  });

  describe('GET /clear-later/:key', () => {

    it('works', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo'] });
        done();
      });
      callRoute('GET', '/clear-later/foo');
    });
  });

  describe('GET /clear-later', () => {

    it('works with query string "k"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo'] });
        done();
      });
      callRoute('GET', '/clear-later?k=foo', null);
    });

    it('works with query string "key"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'] });
        done();
      });
      callRoute('GET', '/clear-later?key=foo&key=bar', null);
    });

    it('works with query string "keys"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'] });
        done();
      });
      callRoute('GET', '/clear-later?keys=foo&keys=bar&keys=baz', null);
    });
  });

  describe('PUT /clear-later', () => {

    it('works with query string "k"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo'] });
        done();
      });
      callRoute('PUT', '/clear-later?k=foo', null);
    });

    it('works with query string "key"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'] });
        done();
      });
      callRoute('PUT', '/clear-later?key=foo&key=bar', null);
    });

    it('works with query string "keys"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'] });
        done();
      });
      callRoute('PUT', '/clear-later?keys=foo&keys=bar&keys=baz', null);
    });

    it('works with data "k"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo'] });
        done();
      });
      callRoute('PUT', '/clear-later', { k: ['foo'] });
    });

    it('works with data "key"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'] });
        done();
      });
      callRoute('PUT', '/clear-later', { key: ['foo', 'bar'] });
    });

    it('works with data "keys"', (done) => {
      observeOnce(service.cache, 'clearLater', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'] });
        done();
      });
      callRoute('PUT', '/clear-later', { keys: ['foo', 'bar', 'baz'] });
    });
  });

  describe('GET /clear-now', () => {

    it('works', (done) => {
      observeOnce(service.cache, 'clearNow', (...args) => {
        assert(args.length === 0);
        done();
      });
      callRoute('GET', '/clear-now', null);
    });
  });

  describe('GET /clear-counts', () => {

    it('works', (done) => {
      let waiting = 2;
      observeOnce(service.cache, 'clearLaterCount', (...args) => {
        assert(args.length === 0);
        waiting -= 1;
        if (!waiting) {
          done();
        }
      });
      observeOnce(service.cache, 'clearNowCount', (...args) => {
        assert(args.length === 0);
        waiting -= 1;
        if (!waiting) {
          done();
        }
      });
      callRoute('GET', '/clear-counts', null);
    });
  });

  describe('GET /:key', () => {

    it('works', (done) => {
      observeOnce(service.cache, 'get', (options) => {
        assert.deepEqual(options, { key: 'x' });
        done();
      });
      callRoute('GET', '/x', null);
    });
  });

  describe('GET /', () => {

    it('works with query string "k"', (done) => {
      observeOnce(service.cache, 'getMany', (options) => {
        assert.deepEqual(options, { keys: ['foo'] });
        done();
      });
      callRoute('GET', '/?k=foo', null);
    });

    it('works with query string "key"', (done) => {
      observeOnce(service.cache, 'getMany', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar'] });
        done();
      });
      callRoute('GET', '/?key=foo&key=bar', null);
    });

    it('works with query string "keys"', (done) => {
      observeOnce(service.cache, 'getMany', (options) => {
        assert.deepEqual(options, { keys: ['foo', 'bar', 'baz'] });
        done();
      });
      callRoute('GET', '/?keys=foo&keys=bar&keys=baz', null);
    });
  });

});
