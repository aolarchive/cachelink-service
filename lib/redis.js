const Promise = require('bluebird');
const redis   = require('redis');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const uuid    = require('uuid');

const scriptsDirectory = 'lua-server-scripts';
let scriptCache;

module.exports = function buildRedis(config, log) {

  if (!config.redisHost) {
    throw new Error('missing "redisHost" key in envs');
  }
  if (!config.redisPort) {
    throw new Error('missing "redisPort" key in envs');
  }

  // Build the redis client options.
  const clientOptions = {
    retry_delay_max: 1000 * 60,
  };
  if (config.redisAuth) {
    clientOptions.auth_pass = config.redisAuth;
  }

  // Connect to redis.
  const client      = redis.createClient(config.redisPort, config.redisHost, clientOptions);
  const subscriber  = redis.createClient(config.redisPort, config.redisHost, clientOptions);
  // Create a Promise version of send_command.
  const sendCommand = Promise.promisify(client.send_command, { context: client });
  // Build the LUA scripts for execution on the redis server.
  const scripts     = buildScripts(log);

  /**
   * Calls the given redis command with the given args.
   *
   * @param {string} command The command or script to execute.
   * @param {*[]}    args    The arguments to send.
   *
   * @returns {Promise} A promise for completion of the command.
   */
  const clientExport = function redisClientCommand(command, args) {

    // If there's a script matching the command name, try to execute it.
    const scriptInfo = scripts[command];
    if (scriptInfo) {

      // Determine the number of keys and args to send as arguments to the script.
      let keyCount = args.length;
      if (scriptInfo.countKeys !== null) {
        keyCount = scriptInfo.countKeys;
      } else if (scriptInfo.countArgs !== null) {
        keyCount = args.length - scriptInfo.countArgs;
      }
      const evalArgs = [scriptInfo.hash, keyCount].concat(args);

      // Try to execute the script using the SHA1.
      log.debug(`scripts: executing script: "${scriptInfo.name}"`);
      return logPromiseError(sendCommand('evalsha', evalArgs).error((e) => {

        // If an unexpected error occurred, return it.
        if (!e || !e.message || e.message !== 'NOSCRIPT No matching script. Please use EVAL.') {
          throw e;
        }

        // If the script is not loaded into redis yet, try loading it now.
        log.info(`scripts: script missing, loading script into redis: "${scriptInfo.name}"`);
        return sendCommand('script', ['load', scriptInfo.text])
          .then(() => {

            // Once the script is loaded, try executing it again using the SHA1.
            log.info(`scripts: script loaded into redis: "${scriptInfo.name}"`);
            return logPromiseError(sendCommand('evalsha', evalArgs));
          })
          .error((loadError) => {

            // If the script could not be loaded, return an error.
            log.error(`scripts: could not load script into redis: "${scriptInfo.name}"`, { error: loadError });
            throw loadError;
          });
      }));
    }

    /**
     * Take a promise and attach a  reject listener to lof the error.
     *
     * @param {Promise} promise The promise to attach to.
     *
     * @returns {Promise} The promise given.
     */
    function logPromiseError(promise) {

      // If there's an error, log it.
      promise.error((e) => {
        log.error(`redis: error executing command "${command}"`, e);
      });

      return promise;
    }

    // If there is no script matching the command name, assume it's a native redis command.
    log.debug(`executing command: ${command}`);
    return logPromiseError(sendCommand(command, args));
  };

  // Build wrapper methods for publishing and subscribing to messages.

  clientExport.subscribed = {};

  /**
   * Publish a message onto the given channel.
   *
   * @param {string} channel The channel to send the message to.
   * @param {*}      message The message to send. Should be a plain JS object.
   */
  clientExport.publish = function clientPublish(channel, message) {
    const messageJson = JSON.stringify(message);
    return client.publish(channel, messageJson);
  };

  /**
   * Subscribe the given callback to the given channel.
   *
   * @param {string}   channel  The channel to subscribe to.
   * @param {function} callback A callback taking the message as the only argument.
   */
  clientExport.subscribe = function clientSubscribe(channel, callback) {
    let list = clientExport.subscribed[channel];
    if (!list) {
      list = [];
      clientExport.subscribed[channel] = list;
      subscriber.subscribe(channel);
    }
    list.push(callback);
  };

  /**
   * Unsubscribe from all notifications.
   */
  clientExport.unsubscribe = function clientUnsubscribe() {
    clientExport.subscribed = {};
    subscriber.unsubscribe();
  };

  // Cluster ID:

  const redisKeyClusterId = `${config.redisPrefix}__cachelink_cluster_id`;
  let cachedClusterId = null;
  let cachedClusterIdExpires = 0;
  const cachedClusterIdTimeout = 1000 * 60; // 1 minute

  /**
   * Get the cachelink cluster ID.
   *
   * @returns {Promise} A promise resolving to the cluster ID.
   */
  clientExport.getClusterId = function clientGetClusterId() {

    if (cachedClusterId && cachedClusterIdExpires > Date.now()) {
      return Promise.resolve(cachedClusterId);
    }

    function gotClusterId(clusterId) {
      cachedClusterId = clusterId;
      cachedClusterIdExpires = Date.now() + cachedClusterIdTimeout;
      return clusterId;
    }

    return clientExport('get', [redisKeyClusterId]).then((clusterId) => {
      if (clusterId) {
        return gotClusterId(clusterId);
      }
      return clientExport('set', [redisKeyClusterId, uuid.v4(), 'nx']).then(() =>
        clientExport('get', [redisKeyClusterId]).then((clusterIdNew) => {
          if (!clusterIdNew) {
            log.error('redis: could not get cluster ID');
          }
          return gotClusterId(clusterIdNew);
        })
      );
    });
  };

  // When a redis error occurs, log it.
  subscriber.on('error', (e) => {
    log.error(`redis: (subscriber) ${String(e)}`, { redisError: e });
  });
  client.on('error', (e) => {
    log.error(`redis: (client) ${String(e)}`, { redisError: e });
  });


  // When a message is received from redis, call any callbacks registered to that channel.
  subscriber.on('message', (channel, message) => {
    let messageObject = null;
    try {
      messageObject = JSON.parse(message);
    } catch (e) {
      log.error('redis: decoding message as JSON');
    }
    const list = clientExport.subscribed[channel];
    if (list) {
      list.forEach((listener) => {
        listener(messageObject);
      });
    }
  });

  return clientExport;
};


/**
 * Build all scripts from the scriptCache directory.
 *
 * @param log The logger to log to.
 *
 * @returns {*} All script information.
 */
function buildScripts(log) {
  if (!scriptCache) {
    scriptCache = {};
    log.info('scripts: reading all');
    const scriptDir = path.join(__dirname, scriptsDirectory);
    const scriptFiles = fs.readdirSync(scriptDir);
    scriptFiles.forEach((scriptFile) => {
      if (scriptFile.match(/\.lua/)) {
        const scriptName = scriptFile.replace(/\.lua$/, '');
        const scriptPath = path.join(scriptDir, scriptFile);
        const scriptText = fs.readFileSync(scriptPath, { encoding: 'utf8' });
        const scriptHash = crypto.createHash('sha1').update(scriptText).digest('hex');
        // eslint-disable-next-line import/no-dynamic-require
        const scriptConf = require(path.join(scriptDir, `${scriptName}.json`));
        const scriptInfo = {
          name: scriptName,
          text: scriptText,
          hash: scriptHash,
          countKeys: typeof scriptConf.keysCount === 'number' ? scriptConf.keysCount : null,
          countArgs: typeof scriptConf.argsCount === 'number' ? scriptConf.argsCount : null,
        };
        if (scriptInfo.countKeys === null && scriptInfo.countArgs === null) {
          const message = `scripts: config ${scriptName}.json missing "keysCount" or "argsCount" property`;
          log.error(message);
          throw new Error(message);
        }
        scriptCache[scriptName] = scriptInfo;
        log.info(`scripts: loaded (hash = ${scriptHash}): ${path.join(scriptsDirectory, scriptFile)}`);
      }
    });
  }
  return scriptCache;
}
