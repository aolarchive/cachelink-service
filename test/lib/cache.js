const Promise = require('bluebird');
const assert  = require('assert');
const setup   = require('./setup.js');

describe('cache', () => {

  const { config, redis, cache, getAllData } = setup();

  describe('#get', () => {

    it('should return a value if set', (done) => {
      redis.clearAllKeys()
        .then(() => cache.set({ key: 'foo', data: 'bar', millis: 5 * 1000 }))
        .then((result) => {
          assert(result && result.cacheSet === 'OK');
          return cache.get({ key: 'foo' });
        })
        .then((data) => {
          assert.equal(data, 'bar');
        })
        .then(done);

    });

    it('should return null if not set', (done) => {
      redis.clearAllKeys()
        .then(() => cache.get({ key: 'notset' }))
        .then((result) => {
          assert.equal(result, null);
        })
        .then(done);
    });
  });

  describe('#getMany', () => {

    it('should return multiple values if they are set', (done) => {
      const data = [['a', 1], ['b', 2], ['c', 3], ['d', 4]];
      redis.clearAllKeys()
        .then(() => Promise.all(data.map(d => cache.set({ key: d[0], data: d[1], millis: 1000 }))))
        .then(() => cache.getMany({ keys: data.map(d => d[0]) }))
        .then((values) => {
          assert.deepEqual(data.map(d => d[1]), values);
        })
        .then(done);
    });

    it('should return nulls where keys are not set', (done) => {
      const data = [['a', 1], ['b', 2], ['c', 3], ['d', 4]];
      const empty = ['e', 'f', 'g'];
      redis.clearAllKeys()
        .then(() => Promise.all(data.map(d => cache.set({ key: d[0], data: d[1], millis: 1000 }))))
        .then(() => cache.getMany({ keys: data.map(d => d[0]).concat(empty) }))
        .then((values) => {
          assert.deepEqual(
            data.map(d => d[1]).concat(empty.map(() => null)),
            values
          );
        })
        .then(done);
    });
  });

  describe('#set', () => {

    it('should set a value properly', (done) => {
      redis.clearAllKeys()
        .then(() => cache.set({ key: 'set1', data: 'bar', millis: 5 * 1000 }))
        .then((result) => {
          assert(result);
          assert.equal(result.cacheSet, 'OK');
        })
        .then(done);
    });

    it('should expire in the right amount of time', function setShouldExpireInTheRightAmountOfTime(done) {

      this.slow(1100);

      redis.clearAllKeys()
        .then(() => cache.set({ key: 'set2', data: 'foo', millis: 500 }))
        .then((result) => {
          assert(result);
          assert.equal(result.cacheSet, 'OK');
          return Promise.delay(100);
        })
        .then(() => cache.get({ key: 'set2' }))
        .then((data) => {
          assert.equal(data, 'foo');
          return Promise.delay(410);
        })
        .then(() => cache.get({ key: 'set2' }))
        .then((data) => {
          assert.equal(data, null);
        })
        .then(done);
    });

    it('should set associations properly', (done) => {

      const data = [
        ['foo', ['a1', 'a2', 'a3']],
        ['bar', ['a4', 'a5']],
        ['baz', ['a6']],
      ];
      const keys = data.map(d => d[0]);
      const members = data.map(d => d[1]);
      const parentsAndMembers = data.map(d => d[1].map(m => [d[0], m])).reduce((a, b) => a.concat(b));
      const allUnderlyingKeys =
        keys.map(k => `d:${k}`)
        .concat(keys.map(k => `i:${k}`))
        .concat(parentsAndMembers.map(i => `c:${i[1]}`))
        .sort();
      redis.clearAllKeys()
        .then(() => Promise.all(data.map(d => cache.set({ key: d[0], data: d[0], millis: 1000, associations: d[1] }))))
        .then((results) => {
          assert(!results.filter(r => !r.success).length);
          return redis.keys('*');
        })
        .then((allKeys) => {
          allKeys.sort();
          assert.deepEqual(allUnderlyingKeys, allKeys);
          return cache.getMany({ keys: keys });
        })
        .then((r) => {
          assert.deepEqual(r, keys);
          return Promise.all(keys.map(k => redis('smembers', `i:${k}`)));
        })
        .then((m) => {
          m = m.map(i => i.sort());
          assert.deepEqual(m, members);
          return Promise.all(parentsAndMembers.map(i => redis('smembers', `c:${i[1]}`)));
        })
        .then((c) => {
          assert.deepEqual(c, parentsAndMembers.map(i => [i[0]]));
        })
        .then(done);
    });

    it('should set associations TTL properly', (done) => {
      const total = 4;
      const millisStep = 1000;
      const mainKeyPttl = 5000;
      const assocSets = [];
      const assocKeys = [];
      const assocPttls = [];
      const assertPttlCloseTo = (expect, actual, which) => {
        assert(actual <= expect && actual > expect - 100,
          `${which} (${actual}) expected between ${expect - 100} and ${expect}`);
      };
      for (let i = 1; i <= total; i += 1) {
        assocKeys.push(`s${i}`);
        assocPttls.push(i * millisStep);
        assocSets.push({ key: `s${i}`, data: `sd${i}`, millis: i * millisStep });
      }
      redis.clearAllKeys()
        .then(() => Promise.all(assocSets.map(cache.set)))
        .then(() => cache.set({ key: 'X', data: 'Xd', millis: mainKeyPttl, associations: assocKeys }))
        .then(() => Promise.all([
          Promise.all([
            redis('pttl', 'd:X'),
            redis('pttl', 'i:X'),
            redis('pttl', 'c:X'),
          ]),
          Promise.all(assocKeys.map(k => Promise.all([
            redis('pttl', `d:${k}`),
            redis('pttl', `i:${k}`),
            redis('pttl', `c:${k}`),
          ]))),
        ]))
        .then((pttls) => {
          const pttlData     = pttls[0][0];
          const pttlIn       = pttls[0][1];
          const pttlContains = pttls[0][2];
          assertPttlCloseTo(mainKeyPttl, pttlData, 'Main Data PTTL');
          assertPttlCloseTo(mainKeyPttl, pttlIn, 'Main In PTTL');
          assert(pttlContains === -2, `Main Contains PTTL (${pttlContains}) expected -2`);
          for (let i = 0; i < pttls[1].length; i += 1) {
            const pttlAssoc         = assocPttls[i];
            const pttlAssocData     = pttls[1][i][0];
            const pttlAssocIn       = pttls[1][i][1];
            const pttlAssocContains = pttls[1][i][2];
            assertPttlCloseTo(pttlAssoc, pttlAssocData, `Assoc ${assocKeys[i]} Data PTTL`);
            assert(pttlAssocIn === -2, `Assoc ${assocKeys[i]}In PTTL (${pttlAssocIn}) expected -2`);
            assertPttlCloseTo(mainKeyPttl, pttlAssocContains, `Assoc ${assocKeys[i]} Contains PTTL`);
          }
        })
        .then(done);
    });
  });

  describe('#clear', () => {

    it('should perform a basic clear (no associations) properly', (done) => {
      redis.clearAllKeys()
        .then(() => cache.set({ key: 'hello', data: 'foo', millis: 10000 }))
        .then(() => cache.get({ key: 'hello' }))
        .then((data) => {
          assert.equal(data, 'foo');
          return cache.clear({ keys: ['hello'] });
        })
        .then((cleared) => {
          assert.deepEqual(cleared, {
            success: true,
            level: 1,
            keys: ['hello'],
            keysCount: 1,
            cleared: 1,
            keysContains: [],
            removedFromContains: 0,
            keysInDeleted: 0,
            keysNextLevel: [],
            nextLevel: undefined,
            allKeysCleared: ['hello'],
          });
          return cache.get({ key: 'hello' });
        })
        .then((data) => {
          assert.equal(data, null);
        })
        .then(done);
    });

    it('should perform a clear with associations properly', (done) => {
      const data = [
        // Key, Value, Associations
        ['kA1', 'vA', ['kB1', 'kB2', 'kB3', 'kB4']],
        ['kB1', 'vB', ['kC1', 'kC2']],
        ['kC1', 'vC', ['kD1', 'kD2']],
        ['kD1', 'vD', []],
      ];
      const initial = {
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
        'i:kC1': ['kD1', 'kD2'],
      };
      const test = [
        [
          ['kD1'],
          {},
          ['kD1', 'kC1', 'kB1', 'kA1'],
        ],
        [
          ['kC1'],
          {
            'd:kD1': 'vD',
          },
          ['kC1', 'kB1', 'kA1'],
        ],
        [
          ['kB1'],
          {
            'c:kD1': ['kC1'],
            'c:kD2': ['kC1'],
            'd:kC1': 'vC',
            'd:kD1': 'vD',
            'i:kC1': ['kD1', 'kD2'],
          },
          ['kB1', 'kA1'],
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
            'i:kC1': ['kD1', 'kD2'],
          },
          ['kA1'],
        ],
      ];
      const testClearAssociations = (clearKeys, afterClear, cleared) => redis.clearAllKeys()
          .then(() => Promise.all(
            data.map(d => cache.set({ key: d[0], data: d[1], millis: 1000000, associations: d[2] }))
          ))
          .then(() => getAllData()).then((allData) => {
            assert.deepEqual(initial, allData);
            return cache.clear({ keys: clearKeys });
          })
          .then((clearInfo) => {
            assert.deepEqual(cleared, clearInfo.allKeysCleared);
            return getAllData();
          })
          .then((dataAfterClear) => {
            assert.deepEqual(afterClear, dataAfterClear);
          });
      const runTest = () => {
        const t = test.pop();
        if (t) {
          testClearAssociations(...t).then(runTest);
        } else {
          done();
        }
      };
      runTest();
    });
  });

  describe('#clearLater', () => {

    it('should append to the clear-later set', (done) => {
      let mem = ['a', 'b', 'c', 'd'];
      redis.clearAllKeys()
        .then(() => cache.clearLater({ keys: mem }))
        .then((added) => {
          assert.deepEqual(added, { success: true, added: 4 });
          return redis('smembers', config.clearLaterSet);
        })
        .then((members) => {
          assert.deepEqual(members.sort(), mem);
          const append = ['c', 'd', 'e', 'f', 'g'];
          mem = mem.concat(['e', 'f', 'g']);
          return cache.clearLater({ keys: append });
        })
        .then((added) => {
          assert.deepEqual(added, { success: true, added: 3 });
          return redis('smembers', config.clearLaterSet);
        })
        .then((members) => {
          assert.deepEqual(members.sort(), mem);
        })
        .then(done);
    });
  });

  describe('#clearNow', () => {

    it('should clear all items in the clear-now set', function clearNowShouldClearAllItemsInClearNowSet(done) {
      this.slow(100);
      const keyCount    = 30;
      const clearNowSet = config.clearNowSet;
      redis.clearAllKeys()
        .then(() => {
          const waiting = [];
          for (let i = 1; i <= keyCount; i += 1) {
            const assoc = [];
            for (let j = i - 1; j >= Math.floor(keyCount / 2); j -= 1) {
              assoc.push(`k${j}`);
            }
            waiting.push(cache.set({ key: `k${i}`, data: `v${i}`, millis: 100000, associations: assoc }));
            waiting.push(redis('sadd', clearNowSet, `k${i}`));
          }
          return Promise.all(waiting);
        })
        .then(() => cache.clearNow())
        .then(() => getAllData())
        .then((data) => {
          assert.deepEqual({}, data);
        })
        .then(done);
    });
  });
});
