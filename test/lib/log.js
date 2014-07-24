var winston = require('winston');

module.exports = function (config) {
	winston.add(winston.transports.File, {filename: 'test.log'});
	winston.remove(winston.transports.Console);
	return winston;
};