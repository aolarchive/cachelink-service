var Promise    = require('bluebird');
var assert     = require('assert');
var setup      = require('./setup.js')(require(__dirname + '/../config.json'));
var config     = setup.config;
var redis      = setup.redis;
var cache      = setup.cache;
var cron       = setup.cron;
var getAllData = setup.getAllData;

describe('cache', function () {

	describe('#get', function () {

		it('should return a value if set', function (done) {
			redis('flushdb',[]).then(function () {
				return cache.set({key: 'foo', data: 'bar', millis: 5 * 1000})
			}).then(function (result) {
				assert(result && result.cacheSet == 'OK');
				return cache.get({ key: 'foo' });
			}).then(function (data) {
				assert.equal(data, 'bar');
			}).then(done);

		});

		it('should return null if not set', function (done) {
			redis('flushdb',[]).then(function () {
				return cache.get({ key: 'notset' })
			}).then(function (result) {
				assert.equal(result, null);
			}).then(done);
		});
	});

	describe('#getMany', function () {

		it('should return multiple values if they are set', function (done) {
			var data = [['a',1],['b',2],['c',3],['d',4]];
			redis('flushdb',[]).then(function () {
				return Promise.all(data.map(function (d) {
					return cache.set({key: d[0], data: d[1], millis: 1000});
				}))
			}).then(function () {
				return cache.getMany({keys: data.map(function (d) { return d[0]; })});
			}).then(function (values) {
				assert.deepEqual(data.map(function (d) { return d[1]; }), values);
			}).then(done);
		});

		it('should return nulls where keys are not set', function (done) {
			var data = [['a',1],['b',2],['c',3],['d',4]];
			var empty = ['e','f','g'];
			redis('flushdb',[]).then(function () {
				return Promise.all(data.map(function (d) {
					return cache.set({key: d[0], data: d[1], millis: 1000});
				}))
			}).then(function () {
				return cache.getMany({keys: data.map(function (d) { return d[0]; }).concat(empty)});
			}).then(function (values) {
				assert.deepEqual(
					data.map(function (d) { return d[1]; }).concat(empty.map(function () { return null; })),
					values
				);
			}).then(done);
		});
	});

	describe('#set', function () {

		it('should set a value properly', function (done) {
			redis('flushdb',[]).then(function () {
				return cache.set({key: 'set1', data: 'bar', millis: 5 * 1000})
			}).then(function (result) {
				assert(result);
				assert.equal(result.cacheSet, 'OK');
			}).then(done);
		});

		it('should expire in the right amount of time', function (done) {
			redis('flushdb',[]).then(function () {
				return cache.set({key: 'set2', data: 'foo', millis: 20})
			}).then(function (result) {
				assert(result);
				assert.equal(result.cacheSet, 'OK');
				return Promise.delay(10);
			}).then(function () {
				return cache.get({key: 'set2'});
			}).then(function (data) {
				assert.equal(data, 'foo');
				return Promise.delay(10);
			}).then(function () {
				return cache.get({key: 'set2'});
			}).then(function (data) {
				assert.equal(data, null);
			}).then(done);
		});

		it('should set associations properly', function (done) {
			var data = [
				['foo', ['a1','a2','a3']],
				['bar', ['a4','a5']],
				['baz', ['a6']]
			];
			var keys = data.map(function (d) { return d[0]; });
			var members = data.map(function (d) { return d[1]; });
			var parentsAndMembers = data.map(function (d) {
				return d[1].map(function (m) { return [d[0], m]; });
			}).reduce(function (a, b) {
				return a.concat(b);
			});
			var allUnderlyingKeys =
				keys.map(function (k) { return 'd:'+k })
				.concat(keys.map(function (k) { return 'i:'+k }))
				.concat(parentsAndMembers.map(function (i) { return 'c:' + i[1]; }))
				.sort();
			redis('flushdb',[]).then(function () {
				return Promise.all(data.map(function (d) {
					return cache.set({key: d[0], data: d[0], millis: 15, associations: d[1]});
				}))
			}).then(function () {
				return redis('keys', ['*']);
			}).then(function (allKeys) {
				allKeys.sort();
				assert.deepEqual(allUnderlyingKeys, allKeys);
				return cache.getMany({keys: keys});
			}).then(function (r) {
				assert.deepEqual(r, keys);
				return Promise.all(keys.map(function (k) {
					return redis('smembers', ['i:'+k]);
				}));
			}).then(function (m) {
				m = m.map(function (i) {return i.sort();});
				assert.deepEqual(m, members);
				return Promise.all(parentsAndMembers.map(function (i) {
					return redis('smembers', ['c:'+i[1]]);
				}));
			}).then(function (c) {
				assert.deepEqual(c, parentsAndMembers.map(function (i) {
					return [i[0]];
				}));
				return Promise.delay(15);
			}).then(done);
		});

		it('should set associations TTL properly', function (done) {
			var total = 4;
			var millisStep = 1000;
			var mainKeyPttl = 5000;
			var assocSets = [];
			var assocKeys = [];
			var assocPttls = [];
			var assertPttlCloseTo = function (expect, actual, which) {
				assert(actual <= expect && actual > expect - 15,
					which + ' (' + actual + ') expected between ' + (expect - 15) + ' and ' + expect);
			};
			for (var i = 1; i <= total; i++) {
				assocKeys.push('s'+i);
				assocPttls.push(i*millisStep);
				assocSets.push({key:'s'+i,data:'sd'+i,millis:i*millisStep});
			}
			redis('flushdb', []).then(function () {
				return Promise.all(assocSets.map(cache.set))
			}).then(function () {
				return cache.set({key:'X',data:'Xd',millis:mainKeyPttl,associations:assocKeys})
			}).then(function () {
				return Promise.all([
					Promise.all([
						redis('pttl', ['d:X']),
						redis('pttl', ['i:X']),
						redis('pttl', ['c:X'])
					]),
					Promise.all(assocKeys.map(function (k) {
						return Promise.all([
							redis('pttl', ['d:'+k]),
							redis('pttl', ['i:'+k]),
							redis('pttl', ['c:'+k])
						]);
					}))
				]);
			}).then(function (pttls) {
				var pttlData     = pttls[0][0];
				var pttlIn       = pttls[0][1];
				var pttlContains = pttls[0][2];
				assertPttlCloseTo(mainKeyPttl, pttlData, 'Main Data PTTL');
				assertPttlCloseTo(mainKeyPttl, pttlIn, 'Main In PTTL');
				assert(pttlContains === -1, 'Main Contains PTTL (' + pttlContains + ') expected -1');
				for (var i = 0; i < pttls[1].length; i++) {
					var pttlAssoc         = assocPttls[i];
					var pttlAssocData     = pttls[1][i][0];
					var pttlAssocIn       = pttls[1][i][1];
					var pttlAssocContains = pttls[1][i][2];
					assertPttlCloseTo(pttlAssoc, pttlAssocData, 'Assoc ' + assocKeys[i] + ' Data PTTL');
					assert(pttlAssocIn === -1, 'Assoc ' + assocKeys[i] + 'In PTTL (' + pttlAssocIn + ') expected -1');
					assertPttlCloseTo(mainKeyPttl, pttlAssocContains, 'Assoc ' + assocKeys[i] + ' Contains PTTL');
				}
			}).then(done);
		});
	});

	describe('#clear', function () {

		it('should perform a basic clear (no associations) properly', function (done) {
			redis('flushdb', []).then(function () {
				return cache.set({key:'hello',data:'foo',millis:10000});
			}).then(function () {
				return cache.get({key:'hello'});
			}).then(function (data) {
				assert.equal(data, 'foo');
				return cache.clear({keys:['hello']});
			}).then(function (cleared) {
				assert.deepEqual(cleared, {
					level: 1,
					keys: [ 'hello' ],
					keysCount: 1,
					cleared: 1,
					keysContains: [],
					removedFromContains: 0,
					keysInDeleted: 0,
					keysNextLevel: [],
					nextLevel: undefined,
					allKeysCleared: [ 'hello' ]
				});
				return cache.get({key:'hello'});
			}).then(function (data) {
				assert.equal(data, null);
			}).then(done);
		});

		it('should perform a clear with associations properly', function (done) {
			var data = [
				// Key, Value, Associations
				[ 'kA1', 'vA', ['kB1', 'kB2', 'kB3', 'kB4'] ],
				[ 'kB1', 'vB', ['kC1', 'kC2'] ],
				[ 'kC1', 'vC', ['kD1', 'kD2'] ],
				[ 'kD1', 'vD', [] ]
			];
			var initial = {
				'c:kB1': ['kA1'],
				'c:kB2': ['kA1'],
				'c:kB3': ['kA1'],
				'c:kB4': ['kA1'],
				'c:kC1': ['kB1'],
				'c:kC2': ['kB1'],
				'c:kD1': ['kC1'],
				'c:kD2': ['kC1'],
				'd:kA1': 'vA',
				'd:kB1': 'vB',
				'd:kC1': 'vC',
				'd:kD1': 'vD',
				'i:kA1': ['kB1', 'kB2', 'kB3', 'kB4'],
				'i:kB1': ['kC1', 'kC2'],
				'i:kC1': ['kD1', 'kD2']
			};
			var test = [
				[
					['kD1'],
					{},
					['kD1','kC1','kB1','kA1']
				],
				[
					['kC1'],
					{
						'd:kD1': 'vD'
					},
					['kC1','kB1','kA1']
				],
				[
					['kB1'],
					{
						'c:kD1': ['kC1'],
						'c:kD2': ['kC1'],
						'd:kC1': 'vC',
						'd:kD1': 'vD',
						'i:kC1': ['kD1', 'kD2']
					},
					['kB1','kA1']
				],
				[
					['kA1'],
					{
						'c:kC1': ['kB1'],
						'c:kC2': ['kB1'],
						'c:kD1': ['kC1'],
						'c:kD2': ['kC1'],
						'd:kB1': 'vB',
						'd:kC1': 'vC',
						'd:kD1': 'vD',
						'i:kB1': ['kC1', 'kC2'],
						'i:kC1': ['kD1', 'kD2']
					},
					['kA1']
				]
			];
			var testClearAssociations = function (clearKeys, afterClear, cleared) {
				return redis('flushdb', []).then(function () {
					return Promise.all(data.map(function (d) {
						return cache.set({key: d[0], data: d[1], millis: 1000000, associations: d[2]});
					}));
				}).then(function () {
					return getAllData();
				}).then(function (allData) {
					assert.deepEqual(initial, allData);
					return cache.clear({keys: clearKeys});
				}).then(function (clearInfo) {
					assert.deepEqual(cleared, clearInfo.allKeysCleared);
					return getAllData();
				}).then(function (dataAfterClear) {
					assert.deepEqual(afterClear, dataAfterClear);
				});
			};
			var runTest = function () {
				var t = test.pop();
				if (t) {
					testClearAssociations.apply(null, t).then(runTest);
				} else {
					done();
				}
			};
			runTest();
		});
	});

	describe('#clearLater', function () {

		it('should append to the clear-later set', function (done) {
			var mem = ['a','b','c','d'];
			redis('flushdb', []).then(function () {
				return cache.clearLater({keys:mem});
			}).then(function (added) {
				assert.equal(added, 4);
				return redis('smembers', [config.clearLaterSet]);
			}).then(function (members) {
				assert.deepEqual(members.sort(), mem);
				var append = ['c','d','e','f','g'];
				mem = mem.concat(['e','f','g']);
				return cache.clearLater({keys:append});
			}).then(function (added) {
				assert.equal(added, 3);
				return redis('smembers', [config.clearLaterSet]);
			}).then(function (members) {
				assert.deepEqual(members.sort(), mem);
			}).then(done);
		});
	});

	describe('#clearNow', function () {

		it('should clear all items in the clear-now set', function (done) {
			var s,e;
			var keyCount    = 30;
			var clearNowSet = config.clearNowSet;
			redis('flushdb', []).then(function () {
				var waiting = [];
				for (var i = 1; i <= keyCount; i++) {
					var assoc = [];
					for (var j = i - 1; j >= Math.floor(keyCount/2); j--) {
						assoc.push('k'+j);
					}
					waiting.push(cache.set({key:'k'+i,data:'v'+i,millis:100000,associations:assoc}));
					waiting.push(redis('sadd', [clearNowSet,'k'+i]));
				}
				return Promise.all(waiting);
			}).then(function () {
				s=new Date().getTime();
				return cache.clearNow();
			}).then(function () {
				e=new Date().getTime();
				return getAllData();
			}).then(function (data) {
				assert.deepEqual({}, data);
			}).then(done);
		});
	});
});