var express     = require('express');
var bodyParser  = require('body-parser');
var buildLog    = require('./log.js');
var buildConfig = require('./config.js');
var buildRedis  = require('./redis.js');
var buildCache  = require('./cache.js');
var buildCron   = require('./cron.js');
var buildRouter = require('./router.js');

module.exports = function (config, options) {

	var conf  = buildConfig(config);
	var log   = (options && options.log) ? options.log(conf) : buildLog(conf);

	log.info('server: building redis connection');

	var redis = buildRedis(conf, log);

	log.info('server: building cache');

	var cache = buildCache(conf, log, redis);

	log.info('server: building cron');

	var cron  = buildCron(conf, log, redis, cache);

	return {
		config : conf,
		log    : log,
		redis  : redis,
		cache  : cache,
		cron   : cron,
		start  : function () {

			cron.startCron();
			cron.listenForMessages();

			if (!config.port) {
				throw new Error('missing "port" key in config');
			}

			var router = buildRouter(conf, log, cache, cron);

			var app = express();
			app.disable('x-powered-by');
			app.use(accessLogger);
			app.use(bodyParser.json());
			app.use(bodyParser.urlencoded({ extended: true }));
			app.use(router);
			app.use(function (e, req, res, next) {
				var status = e.status || 500;
				res.send(status);
				log.error('uncaught error: ' + (e.message || '?'), { error: e });
			});

			function accessLogger(req, res, next) {
				log.debug('access: ' + req.method + ' ' + req.url);
				next();
			}

			app.listen(config.port);
			log.info('server: running on port ' + config.port);
		}
	};
};