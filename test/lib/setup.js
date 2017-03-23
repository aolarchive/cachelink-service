const Promise = require('bluebird');

module.exports = (testEnv) => {

  const config  = require('../../lib/config.js')(testEnv);
  const log     = require('./log.js');
  const redis   = require('../../lib/redis.js')(config, log);
  const cache   = require('../../lib/cache.js')(config, log, redis);
  const cron    = require('../../lib/cron.js')(config, log, redis, cache);

  return {
    config,
    log,
    redis,
    cache,
    cron,
    getAllData() {
      return redis('keys', ['*']).then((keys) => {
        const result = {};
        return Promise.all(keys.map((k) => {
          const firstChar = k[0];
          if (firstChar === 'd') {
            const g = redis('get', [k]);
            g.then((v) => {
              result[k] = v;
            });
            return g;
          } else if (firstChar === 'c' || firstChar === 'i') {
            const m = redis('smembers', [k]);
            m.then((s) => {
              result[k] = s.sort();
            });
            return m;
          } else if (firstChar === '_') {
            // Do nothing.
          } else {
            result[k] = null;
          }
          return undefined;
        })).then(() => result);
      });
    },
  };

};
