var config = require('../../lib/config.js')(__dirname + '/../config.json');
var log    = require('./log.js')(config);
var redis  = require('../../lib/redis.js')(config, log);
var cache  = require('../../lib/cache.js')(config, log, redis);
var cron   = require('../../lib/cron.js')(config, log, redis, cache);

module.exports = {
	config : config,
	log    : log,
	redis  : redis,
	cache  : cache,
	cron   : cron
};