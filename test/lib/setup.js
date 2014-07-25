var Promise = require('bluebird');

module.exports = function (config) {

	config      = require('../../lib/config.js')(config);
	var log     = require('./log.js');
	var redis   = require('../../lib/redis.js')(config, log);
	var cache   = require('../../lib/cache.js')(config, log, redis);
	var cron    = require('../../lib/cron.js')(config, log, redis, cache);

	return {
		config     : config,
		log        : log,
		redis      : redis,
		cache      : cache,
		cron       : cron,
		getAllData : function () {
			return redis('keys', ['*']).then(function (keys) {
				var result = {};
				return Promise.all(keys.map(function (k) {
					switch (k[0]) {
						case 'd':
							var g = redis('get', [k]);
							g.then(function (v) {
								result[k] = JSON.parse(v);
							});
							return g;
						case 'c':
						case 'i':
							var m = redis('smembers', [k]);
							m.then(function (s) {
								result[k] = s.sort();
							});
							return m;
						default:
							result[k] = null;
							break;
					}
				})).then(function () {
					return result;
				});
			});
		}
	};

};