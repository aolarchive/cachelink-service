var fs               = require('fs');
var cachelinkService = require('../lib/index.js');

var configFile = process.argv[2];

if (!configFile) {
	console.error('usage: bin/cachelink /path/to/config.json');
	process.exit(1);
}
if (!fs.existsSync(configFile)) {
	console.error('error: could not find config file at path "' + configFile + '"');
	process.exit(1);
}
var configText = fs.readFileSync(configFile, { encoding: 'utf8' });
var config     = JSON.parse(configText);
var service    = cachelinkService(config);

service.start();
