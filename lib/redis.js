const Promise = require('bluebird');
const Redis   = require('ioredis');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const uuid    = require('uuid');

const scriptsDirectory = 'lua-server-scripts';
let scriptCache;

module.exports = function buildRedis(config, log) {

  // Parse redis nodes into an array of objects containing host and port.
  const redisNodes = config.redisNodes
    .map(h => h.trim())
    .filter(h => Boolean(h))
    .map((h) => {
      const parts = h.split(':');
      const host = parts[0];
      const port = parts[1] || '6379';
      if (!host) {
        throw new Error('Invalid redis host provided');
      }
      return { host, port };
    });

  if (!redisNodes.length) {
    throw new Error('Must have at least one redis node.');
  }

  if (!config.redisCluster && redisNodes.length !== 1) {
    throw new Error('Must only use one redis node if not in cluster mode.');
  }

  // Redis options for all nodes.
  const redisOptions = {
    password: config.redisAuth,
  };

  const createRedisClient = () => (
    config.redisCluster
      ? new Redis.Cluster(redisNodes, { redisOptions })
      : new Redis(Object.assign(redisNodes[0], redisOptions))
  );

  // Connect to redis.
  const client = createRedisClient();
  const subscriber = createRedisClient();

  // Build the LUA scripts for execution on the redis server.
  const scripts = buildScripts(log);

  /**
   * Calls the given redis command with the given args.
   *
   * @param {string} command The command or script to execute.
   * @param {*[]}    args    The arguments to send.
   *
   * @returns {Promise} A promise for completion of the command.
   */
  const clientExport = function redisClientCommand(command, ...args) {

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
      return logPromiseError(client.call('evalsha', ...evalArgs).catch((e) => {

        // If an unexpected error occurred, return it.
        if (!e || !e.message || e.message !== 'NOSCRIPT No matching script. Please use EVAL.') {
          throw e;
        }

        // If the script is not loaded into redis yet, try loading it now.
        log.info(`scripts: script missing, loading script into redis: "${scriptInfo.name}"`);
        return client.call('script', 'load', scriptInfo.text)
          .then(() => {

            // Once the script is loaded, try executing it again using the SHA1.
            log.info(`scripts: script loaded into redis: "${scriptInfo.name}"`);
            return logPromiseError(client.call('evalsha', ...evalArgs));
          })
          .catch((loadError) => {

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
      promise.catch((e) => {
        log.error(`redis: error executing command "${command}"`, { redisError: e, redisArgs: args });
      });

      return promise;
    }

    // If there is no script matching the command name, assume it's a native redis command.
    log.debug(`executing command: ${command}`);
    return logPromiseError(client.call(command, ...args), command, args);
  };

  /**
   * Clear all data in the redis DBs.
   *
   * @returns {Promise} When the clear is complete.
   */
  clientExport.clearAllKeys = function clientClearAllKeys() {
    return config.redisCluster
      ? Promise.all(client.nodes('master').map(node => node.flushdb()))
      : client.flushdb();
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

    return clientExport('get', redisKeyClusterId).then((clusterId) => {
      if (clusterId) {
        return gotClusterId(clusterId);
      }
      return clientExport('set', redisKeyClusterId, uuid.v4(), 'nx').then(() =>
        clientExport('get', redisKeyClusterId).then((clusterIdNew) => {
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

  // --------------------------------------------------------------------------
  // Shimmed cluster operations
  // --------------------------------------------------------------------------

  /**
   * Takes several keys and finds the max PTTL of all of them.
   * It will then assign that TTL to the first key in the list given.
   *
   * @param {string[]} keys The keys to check.
   *
   * @returns {Promise.<number>} The maximum PTTL.
   */
  clientExport.pexpiremax = function redisPExpireMax(...keys) {
    if (!config.redisCluster) {
      return clientExport('pexpiremax', ...keys);
    }
    let max = -1;
    const getMax = Promise.each(keys, key => clientExport('pttl', key).then((pttl) => {
      if (pttl > max) {
        max = pttl;
      }
    }));
    return getMax.then(() => (
      max <= 0
        ? max
        : clientExport('pexpire', keys[0], max).then(() => max)
    ));
  };

  /**
   * A client-side union that uses smembers and a in-memory Set.
   *
   * @param {string[]} sets The redis sets to union.
   *
   * @returns {string[]} The set union.
   */
  clientExport.sunion = function redisSunion(sets) {
    if (!config.redisCluster) {
      return clientExport('sunion', ...sets);
    }
    const union = new Set();
    const addSetMembers = set => clientExport('smembers', set).then((members) => {
      members.forEach((member) => {
        union.add(member);
      });
    });
    return Promise.all(sets.map(addSetMembers)).then(() => Array.from(union));
  };

  /**
   * A client-side mget that runs get for each key given.
   *
   * @param {string[]} keys The keys to get.
   *
   * @returns {*[]} The values.
   */
  clientExport.mget = function redisMget(keys) {
    if (!config.redisCluster) {
      return clientExport('mget', ...keys);
    }
    return Promise.all(keys.map(key => clientExport('get', key)));
  };

  /**
   * A client side multi-delete that runs del for each key given.
   *
   * @param {string[]} keys The keys to delete.
   *
   * @returns {number} The number of keys deleted.
   */
  clientExport.del = function redisDel(keys) {
    if (!config.redisCluster || keys.length === 1) {
      return clientExport('del', ...keys);
    }
    return Promise.all(keys.map(key => clientExport('del', key)))
      .then(results => results.reduce((t, n) => t + n, 0));
  };

  /**
   * Takes a key of a source set and a destination set and moves the
   * source set into the destination set.
   *
   * @param {string} key  The source set.
   * @param {string} dest The destination set.
   *
   * @returns {Promise} Whether the source set was deleted.
   */
  clientExport.smoveall = function redisSmoveAll(key, dest) {
    if (!config.redisCluster) {
      return clientExport('smoveall', key, dest);
    }
    return clientExport('sunionstore', dest, dest, key)
      .then(added => clientExport('del', key).then(() => added));
  };

  /**
   * Get all keys. This should be used mainly for testing purposes.
   *
   * @param args Arguments for the keys command.
   *
   * @returns {Promise.<string[]>} The keys.
   */
  clientExport.keys = function redisKeys(...args) {
    if (!config.redisCluster) {
      return clientExport('keys', ...args);
    }
    const masters = client.nodes('master');
    return Promise.all(masters.map(node => node.keys(...args))).then(results => [].concat(...results));
  };

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
