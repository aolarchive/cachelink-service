const express     = require('express');
const bodyParser  = require('body-parser');
const basicAuth   = require('basic-auth');
const https       = require('https');
const http        = require('http');
const buildLog    = require('./log.js');
const buildConfig = require('./config.js');
const buildRedis  = require('./redis.js');
const buildCache  = require('./cache.js');
const buildCron   = require('./cron.js');
const buildRouter = require('./router.js');

module.exports = function buildApp(env, options) {

  const conf = buildConfig(env);
  const log  = (options && options.log) ? options.log(conf) : buildLog(conf);

  const initializerList = [];

  log.info('server: building redis connection');

  const redis = buildRedis(conf, log);

  log.info('server: building cache');

  const cache = buildCache(conf, log, redis);

  log.info('server: building cron');

  const cron  = buildCron(conf, log, redis, cache);

  /**
   * Attach an initializer to the cachelink service.
   *
   * @param {Function} initializer The initializer to attach. This will receive
   *   the express app as a single argument.
   */
  function init(initializer) {
    if (typeof initializer !== 'function') {
      throw new Error('init must be given a function');
    }
    initializerList.push(initializer);
  }

  return {
    config: conf,
    log:    log,
    redis:  redis,
    cache:  cache,
    cron:   cron,
    init:   init,
    start(callback) {

      cron.startCron();
      cron.listenForMessages();

      if (!conf.port) {
        throw new Error('missing "port" key in initEnv');
      }

      const router = buildRouter(conf, log, cache, cron);

      log.info('building HTTP server');

      const app = express();
      app.disable('x-powered-by');

      // Basic HTTP authentication.
      if (conf.basicAuth) {
        log.info('using basic auth');
        app.use((req, res, next) => {
          const user = basicAuth(req);
          if (!user || user.name !== conf.basicAuth.user || user.pass !== conf.basicAuth.pass) {
            log.debug(`access rejected for ${req.method} ${req.url}`);
            res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
            res.status(401).end();
          } else {
            next();
          }
        });
      }

      const requestSizeLimit = conf.requestSizeLimit || '10mb';

      app.use(accessLogger);
      app.use(bodyParser.json({ limit: requestSizeLimit }));
      app.use(bodyParser.urlencoded({ limit: requestSizeLimit, extended: true }));

      if (initializerList.length) {
        log.info('calling initializers');
        initializerList.forEach((initializer) => {
          initializer(app);
        });
      }

      app.use(router);

      app.use((e, req, res, next) => {
        const status = e.status || 500;
        res.status(status).end();
        log.error(`uncaught error: ${e.message || '?'}`, { error: e });
      });

      function accessLogger(req, res, next) {
        log.debug(`access: ${req.method} ${req.url}`);
        next();
      }

      let httpsEnabled = false;
      function applicationStarted() {
        log.info(`server: running on port ${conf.port} ${httpsEnabled ? '(HTTPS enabled)' : '(HTTP)'}`);
        if (typeof callback === 'function') {
          callback();
        }
      }

      if (conf.httpsPrivateKey || conf.httpsCertificate) {
        httpsEnabled = true;
        const httpsOptions = {
          key: conf.httpsPrivateKey,
          cert: conf.httpsCertificate,
          ca: conf.httpsCa,
          requestCert: conf.httpsRequestCert,
          rejectUnauthorized: conf.httpsRejectUnauthorized,
        };
        https.createServer(httpsOptions, app).listen(conf.port, applicationStarted);
      } else {
        http.createServer(app).listen(conf.port, applicationStarted);
      }

    },
  };
};
