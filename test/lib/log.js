var winston = require('winston');

winston.add(winston.transports.File, {filename: 'test.log'});
winston.remove(winston.transports.Console);
module.exports = winston;
