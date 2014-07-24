var Promise    = require('bluebird');
var assert     = require('assert');
var setup      = require('./setup.js');
var config     = setup.config;
var redis      = setup.redis;
var cache      = setup.cache;
var log        = setup.log;
var cron       = require('../../lib/cron.js')(config, log, redis, cache);
var getAllData = setup.getAllData;

describe('cron', function () {

	describe('#startClearNowProcess', function () {

		it('should move all the keys from the clear-later set to the clear-now set', function (done) {
			var cron = require('../../lib/cron.js')(config, log, redis, cache);
			var clearNowCalled = false;
			var clearNowOld = cron.clearNow;
			var clearKeys = ['a','b','c'];
			var clearNowDone = new Promise(function (resolve) {
				cron.clearNow = function () {
					clearNowCalled = true;
					return redis('smembers', [config.clearNowSet]).then(function (clearNowSet) {
						assert.deepEqual(clearKeys, clearNowSet.sort());
						return clearNowOld().then(resolve);
					});
				};
			});
			redis('flushdb', []).then(function () {
				return cache.clearLater({keys:clearKeys})
			}).then(function () {
				return redis('smembers', [config.clearLaterSet]);
			}).then(function (members) {
				assert.deepEqual(clearKeys, members.sort());
				return cron.startClearNowProcess()
			}).then(function (success) {
				assert(clearNowCalled);
				assert(success);
				return clearNowDone;
			}).then(function () {
				return Promise.all([
					redis('smembers', [config.clearLaterSet]),
					redis('smembers', [config.clearNowSet])
				])
			}).then(function (clearSets) {
				assert.deepEqual([], clearSets[0]);
				assert.deepEqual([], clearSets[1]);
			}).then(done);
		});
	});

	describe('#clearNow', function () {

		it('should empty the clear-now set and clear all those keys', function (done) {
			redis('flushdb',[]).then(function () {
				return Promise.all([
					cache.set({key:'A',data:'_',millis:10000}),
					cache.set({key:'B',data:'_',millis:10000}),
					cache.set({key:'C',data:'_',millis:10000}),
					cache.set({key:'D',data:'_',millis:10000,associations:['B','C']}),
					cache.set({key:'E',data:'_',millis:10000}),
					cache.set({key:'F',data:'_',millis:10000}),
					cache.set({key:'G',data:'_',millis:10000,associations:['A']}),
					redis('sadd', [config.clearNowSet,'B','C'])
				])
			}).then(function () {
				return cron.clearNow();
			}).then(function () {
				return getAllData();
			}).then(function (allData) {
				assert.deepEqual(allData, {
					'c:A': [ 'G' ],
					'd:A': '_',
					'd:E': '_',
					'd:G': '_',
					'i:G': [ 'A' ],
					'd:F': '_'
				})
			}).then(done);
		});
	});


	describe('#listenForMessages', function () {

		it('should run clearNow when it receives a "startClear" message', function (done) {
			var cron = require('../../lib/cron.js')(config, log, redis, cache);
			cron.listenForMessages();
			var startedClear = false;
			cron.clearNow = function () {
				startedClear = true;
			};
			redis.publish(config.cronChannel, 'startClear');
			Promise.delay(20).then(function () {
				assert(startedClear);
			}).then(done);
		});

		it('should do nothing if it receives an invalid message', function (done) {
			var cron = require('../../lib/cron.js')(config, log, redis, cache);
			cron.listenForMessages();
			var startedClear = false;
			cron.clearNow = function () {
				startedClear = true;
			};
			redis.publish(config.cronChannel, 'invalidMessage');
			Promise.delay(20).then(function () {
				assert(!startedClear);
				redis.unsubscribe();
			}).then(done);
		});
	});

	describe('#checkSyncKey', function () {

		it('should set the sync key if it is not already set and start the clear process', function (done) {
			var clearIntervalMillis = config.clearLaterInterval * 1000;
			var syncKey = config.clearLaterSyncKey;
			var cron = require('../../lib/cron.js')(config, log, redis, cache);
			var startedClearNow = false;
			cron.startClearNowProcess = function () { startedClearNow = true; };
			redis('flushdb',[]).then(function () {
				return cron.checkSyncKey();
			}).then(function (success) {
				assert(!!success);
				assert(startedClearNow);
				return Promise.all([
					redis('pttl', [syncKey]),
					redis('get', [syncKey])
				]);
			}).then(function (result) {
				assert(result[0] && result[1] == clearIntervalMillis);
			}).then(done);
		});

		it('should fail to set the sync key if it is already set and NOT start the clear process', function (done) {
			var syncKey = config.clearLaterSyncKey;
			var cron = require('../../lib/cron.js')(config, log, redis, cache);
			var startedClearNow = false;
			cron.startClearNowProcess = function () { startedClearNow = true; };
			redis('flushdb',[]).then(function () {
				return redis('set', [syncKey, 'foo', 'px', 100000, 'nx'])
			}).then(function () {
				return cron.checkSyncKey();
			}).then(function (success) {
				assert(!success);
				assert(!startedClearNow);
				return redis('get', [syncKey]);
			}).then(function (result) {
				assert(result === 'foo');
			}).then(done);
		});
	});

	describe('#startCron', function () {

		it('should call #checkSyncKey at the cron interval', function (done) {
			var c = { };
			for (var k in config) {
				c[k] = config[k];
			}
			c.clearLaterInterval = 0.1;
			var cron = require('../../lib/cron.js')(c, log, redis, cache);
			var called = 0;
			var times = 3;
			var interval = c.clearLaterInterval * 1000;
			this.slow((interval * times) + 500);
			this.timeout((interval * times) + 1000);
			cron.checkSyncKey = function () {
				called++;
			};
			cron.startCron();
			Promise.delay((interval * times) + 10).then(function () {
				assert.equal(called, times);
			}).then(done);
		});
	});
});