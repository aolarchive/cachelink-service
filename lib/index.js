var express     = require('express');
var bodyParser  = require('body-parser');
var basicAuth   = require('basic-auth');
var buildLog    = require('./log.js');
var buildConfig = require('./config.js');
var buildRedis  = require('./redis.js');
var buildCache  = require('./cache.js');
var buildCron   = require('./cron.js');
var buildRouter = require('./router.js');

module.exports = function (config, options) {

	var conf = buildConfig(config);
	var log  = (options && options.log) ? options.log(conf) : buildLog(conf);

	var initializerList = [];

	log.info('server: building redis connection');

	var redis = buildRedis(conf, log);

	log.info('server: building cache');

	var cache = buildCache(conf, log, redis);

	log.info('server: building cron');

	var cron  = buildCron(conf, log, redis, cache);

	/**
	 * Attach an initializer to the cachelink service.
	 *
	 * @param {Function} initializer The initializer to attach. This will receive
	 *   the express app as a single argument.
	 */
	function init(initializer) {
		if ('function' !== typeof initializer) {
			throw new Error('init must be given a function');
		}
		initializerList.push(initializer);
	}

	return {
		config : conf,
		log    : log,
		redis  : redis,
		cache  : cache,
		cron   : cron,
		init   : init,
		start  : function () {

			cron.startCron();
			cron.listenForMessages();

			if (!config.port) {
				throw new Error('missing "port" key in config');
			}

			var router = buildRouter(conf, log, cache, cron);

			log.info('building HTTP server');

			var app = express();
			app.disable('x-powered-by');

			// Basic HTTP authentication.
			if (config.basicAuth && config.basicAuth.user && config.basicAuth.pass) {
				log.info('using basic auth');
				app.use(function (req, res, next) {
					var user = basicAuth(req);
					if (!user || user.name !== config.basicAuth.user || user.pass !== config.basicAuth.pass) {
						log.debug('access rejected for ' + req.method + ' ' + req.url);
						res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
						res.status(401).end();
					} else {
						next();
					}
				});
			}

			app.use(accessLogger);
			app.use(bodyParser.json());
			app.use(bodyParser.urlencoded({ extended: true }));

			if (initializerList.length) {
				log.info('calling initializers');
				initializerList.forEach(function (init) {
					init(app);
				});
			}

			app.use(router);

			/*jshint unused: false */
			app.use(function (e, req, res, next) {
				var status = e.status || 500;
				res.status(status).end();
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