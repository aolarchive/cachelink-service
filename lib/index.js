var buildLog    = require('./log.js');
var buildConfig = require('./config.js');
var buildRedis  = require('./redis.js');
var buildCache  = require('./cache.js');
var buildCron   = require('./cron.js');
var buildRouter = require('./router.js');

module.exports = function (config, options) {

	var conf  = buildConfig(config);
	var log   = (options && options.log) ? options.log(conf) : buildLog(conf);
	var redis = buildRedis(conf, log);
	var cache = buildCache(conf, log, redis);
	var cron  = buildCron(conf, log, redis, cache);

	return {
		config : conf,
		log    : log,
		redis  : redis,
		cache  : cache,
		cron   : cron,
		start  : function () {

			if (!config.port) {
				throw new Error('missing "port" key in config');
			}

			var router = buildRouter(conf, log, redis, cache, cron);

			var app = express();
			app.use(accessLogger);
			app.use(bodyParser.json());
			app.use(bodyParser.urlencoded());
			app.use(router);

			function accessLogger(req, res, next) {
				log.debug('access: ' + req.method + ' ' + req.url);
				next();
			}

			app.listen(config.port);
			log.info('server: running on port ' + config.port);
		}
	};
};