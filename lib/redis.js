var Promise = require('bluebird');
var redis   = require('redis');
var fs      = require('fs');
var crypto  = require('crypto');

var scriptsDirectory = 'lua-server-scripts';
var scripts;

module.exports = function (config, log) {

	if (!config.redis) {
		throw new Error('missing "redis" key in config');
	}
	if (!config.redis.host) {
		throw new Error('missing "redis.host" key in config');
	}
	if (!config.redis.port) {
		throw new Error('missing "redis.port" key in config');
	}

	// Build the redis client options.
	var clientOptions = {
		retry_delay_max: 1000 * 60
	};
	if (config.redis.auth) {
		clientOptions.auth_pass = config.redis.auth;
	}

	// Connect to redis.
	var client      = redis.createClient(config.redis.port, config.redis.host, clientOptions);
	var subscriber  = redis.createClient(config.redis.port, config.redis.host, clientOptions);
	// Create a Promise version of send_command.
	var sendCommand = Promise.promisify(client.send_command, client);
	// Build the LUA scripts for execution on the redis server.
	var scripts     = buildScripts(log);

	/**
	 * Calls the given redis command with the given args.
	 *
	 * @param {string} command The command or script to execute.
	 * @param {*[]}    args    The arguments to send.
	 *
	 * @returns {Promise} A promise for completion of the command.
	 */
	var clientExport = function (command, args) {

		// If there's a script matching the command name, try to execute it.
		var scriptInfo = scripts[command];
		if (scriptInfo) {

			// Determine the number of keys and args to send as arguments to the script.
			var keyCount = args.length;
			if (scriptInfo.countKeys !== null) {
				keyCount = scriptInfo.countKeys;
			} else if (scriptInfo.countArgs !== null) {
				keyCount = args.length - scriptInfo.countArgs;
			}
			var evalArgs = [scriptInfo.hash, keyCount].concat(args);

			// Try to execute the script using the SHA1.
			log.debug('scripts: executing script: "' + scriptInfo.name + '"');
			return logPromiseError(sendCommand('evalsha', evalArgs).error(function (e) {

				// If an unexpected error occurred, return it.
				if (!e || !e.message || !e.message === 'NOSCRIPT No matching script. Please use EVAL.') {
					throw e;
				}

				// If the script is not loaded into redis yet, try loading it now.
				log.info('scripts: script missing, loading script into redis: "' + scriptInfo.name + '"');
				return sendCommand('script', ['load', scriptInfo.text])
					.then(function () {

						// Once the script is loaded, try executing it again using the SHA1.
						log.info('scripts: script loaded into redis: "' + scriptInfo.name + '"');
						return logPromiseError(sendCommand('evalsha', evalArgs));
					})
					.error(function (e) {

						// If the script could not be loaded, return an error.
						log.error('scripts: could not load script into redis: "' + scriptInfo.name + '"', {error: e});
						throw e;
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
			promise.error(function (e) {
				log.error('redis: error executing command "' + command + '"', e);
			});

			return promise;
		}

		// If there is no script matching the command name, assume it's a native redis command.
		log.debug('executing command: ' + command);
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
	clientExport.publish = function (channel, message) {
		message = JSON.stringify(message);
		return client.publish(channel, message);
	};

	/**
	 * Subscribe the given callback to the given channel.
	 *
	 * @param {string}   channel  The channel to subscribe to.
	 * @param {function} callback A callback taking the message as the only argument.
	 */
	clientExport.subscribe = function (channel, callback) {
		var list = clientExport.subscribed[channel];
		if (!list) {
			clientExport.subscribed[channel] = list = [];
			subscriber.subscribe(channel);
		}
		list.push(callback);
	};

	/**
	 * Unsubscribe from all notifications.
	 */
	clientExport.unsubscribe = function () {
		clientExport.subscribed = {};
		subscriber.unsubscribe();
	};

	// When a redis error occurs, log it.
	subscriber.on('error', function (e) {
		log.error('redis: (subscriber) ' + e);
	});
	client.on('error', function (e) {
		log.error('redis: (client) ' + e);
	});


	// When a message is received from redis, call any callbacks registered to that channel.
	subscriber.on('message', function (channel, message) {
		try {
			message = JSON.parse(message);
		} catch (e) {
			log.error('redis: decoding message as JSON');
		}
		var list = clientExport.subscribed[channel];
		if (list) {
			for (var i = 0; i < list.length; i++) {
				list[i](message);
			}
		}
	});

	return clientExport;
};


/**
 * Build all scripts from the scripts directory.
 *
 * @param log The logger to log to.
 *
 * @returns {*} All script information.
 */
function buildScripts(log) {
	if (!scripts) {
		scripts = {};
		log.info('scripts: reading all');
		var scriptDir = __dirname + '/' + scriptsDirectory;
		var scriptFiles = fs.readdirSync(scriptDir);
		for (var i = 0; i < scriptFiles.length; i++) {
			var scriptFile = scriptFiles[i];
			if (scriptFile.match(/\.lua/)) {
				var scriptName = scriptFile.replace(/\.lua$/, '');
				var scriptPath = scriptDir + '/' + scriptFile;
				var scriptText = fs.readFileSync(scriptPath, {encoding: 'utf8'});
				var scriptHash = crypto.createHash('sha1').update(scriptText).digest('hex');
				var scriptConf = require(scriptDir + '/' + scriptName + '.json');
				var scriptInfo = {
					name: scriptName,
					text: scriptText,
					hash: scriptHash,
					countKeys: 'number' === typeof scriptConf.keysCount ? scriptConf.keysCount : null,
					countArgs: 'number' === typeof scriptConf.argsCount ? scriptConf.argsCount : null
				};
				if (scriptInfo.countKeys === null && scriptInfo.countArgs === null) {
					var message = 'scripts: config ' + scriptName + '.json missing "keysCount" or "argsCount" property';
					log.error(message);
					throw new Error(message);
				}
				scripts[scriptName] = scriptInfo;
				log.info('scripts: loaded (hash = ' + scriptHash + '): ' + scriptsDirectory + '/' + scriptFile);
			}
		}
	}
	return scripts;
}