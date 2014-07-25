var os     = require('os');
var crypto = require('crypto');

var localUniqueString = os.hostname() + '_' + process.pid + '_' + (new Date().getTime());
var localHash         = crypto.createHash('sha1').update(localUniqueString).digest('hex');

module.exports = function (config) {

	if (!config) {
		throw new Error('no config given');
	}

	config.localHash                  = localHash;
	config.broadcastTimeout           = config.broadcastTimeout           || 5000;
	config.clearLaterInterval         = config.clearLaterInterval         || 60;
	config.clearLaterSyncKey          = config.clearLaterSyncKey          || '___clear_later_sync';
	config.cronChannel                = config.cronChannel                || '___cron_channel';
	config.clearLaterSet              = config.clearLaterSet              || '___clear_later_set';
	config.clearNowSet                = config.clearNowSet                || '___clear_now_set';
	config.clearNowAmountPerIteration = config.clearNowAmountPerIteration || 3;
	config.redis.prefix               = config.redis.prefix               || '';

	return config;
};