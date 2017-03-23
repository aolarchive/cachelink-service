const winston = require('winston');

module.exports = function buildLog() {
  return new winston.Logger({
    transports: [
      new winston.transports.File({
        json: true,
        logstash: true,
        handleExceptions: true,
        stream: process.stdout,
      }),
    ],
  });
};
