const cachelinkService = require('../lib/index.js');

const service = cachelinkService(process.env);

service.start();
