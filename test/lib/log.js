var winston = require('winston');

module.exports = new winston.Logger({
	transports: [
		new winston.transports.File({filename: 'test.log', level: 'debug'})
		//new winston.transports.Console({level: 'debug'})
	]
});
