var fs               = require('fs');
var cachelinkService = require('./index.js');

var configFile = process.argv[2];

if (!configFile) {
	throw new Error('config file was not given as argument');
}
if (!fs.existsSync(configFile)) {
	throw new Error('could not find config file at path "' + configFile + '"');
}

var config  = require(configFile);
var service = cachelinkService(config);

service.start();
