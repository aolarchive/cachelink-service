var os     = require('os');
var crypto = require('crypto');

var localUniqueString = os.hostname() + '_' + process.pid + '_' + (new Date().getTime());
var localHash         = crypto.createHash('sha1').update(localUniqueString).digest('hex');

module.exports = function (configFile) {

	if (!configFile) {
		throw new Error('missing config file argument');
	}

	var config = require(configFile);
	if (!config) {
		throw new Error('could not read config file');
	}
	if (!config.port) {
		throw new Error('missing "port" key in config');
	}
	if (!config.redis) {
		throw new Error('missing "redis" key in config');
	}
	if (!config.redis.host) {
		throw new Error('missing "redis.host" key in config');
	}
	if (!config.redis.port) {
		throw new Error('missing "redis.port" key in config');
	}
	if (!config.broadcast || !Array.isArray(config.broadcast)) {
		throw new Error(
			'missing "broadcast" key in config file should be an array of objects containing "host" and "port"'
		);
	}

	config.localHash                  = localHash;
	config.clearLaterInterval         = config.clearLaterInterval         || 60;
	config.clearLaterSyncKey          = config.clearLaterSyncKey          || '___clear_later_sync';
	config.cronChannel                = config.cronChannel                || '___cron_channel';
	config.clearLaterSet              = config.clearLaterSet              || '___clear_later_set';
	config.clearNowSet                = config.clearNowSet                || '___clear_now_set';
	config.clearNowAmountPerIteration = config.clearNowAmountPerIteration || 5;
	config.redis.prefix               = config.redis.prefix               || '';

	return config;
};