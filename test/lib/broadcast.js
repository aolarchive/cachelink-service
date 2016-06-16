var Promise          = require('bluebird');
var extend           = require('node.extend');
var request          = require('request');
var assert           = require('assert');
var cachelinkService = require('../../lib/index.js');
var log              = require(__dirname + '/log.js');
var config           = require(__dirname + '/../config.json');

var services = [];
var ports = [];
var configs = [];
var totalServers = 4;
var getLog = function () {
	return log;
};
for (var i = 0; i < totalServers; i++) {
	var port = config.port + i + 1;
	ports.push(port);
	var serviceConfig = extend({ }, config, { port: port });
	serviceConfig.broadcast = [];
	configs[i] = serviceConfig;
}
for (var i = 0; i < totalServers; i++) {
	for (var j = 0; j < totalServers; j++) {
		if (i !== j) {
			configs[i].broadcast.push('http://localhost:' + ports[j]);
		}
	}
}
for (var i = 0; i < totalServers; i++) {
	services[i] = cachelinkService(configs[i], {log: getLog});
	services[i].start();
}

function callRoute(serviceNumber, httpMethod, path, data, done) {
	request({
		method : httpMethod,
		url    : 'http://localhost:' + ports[serviceNumber] + path,
		json   : data,
		auth   : config.basicAuth
	}, done || function () {

	});
}

function observeAllServicesCache(noreply, field, wrapper, done, timeout) {
	return observeAllServices(noreply, function (s) { return s.cache; }, field, wrapper, done, timeout);
}
function observeAllServicesCron(noreply, field, wrapper, done, timeout) {
	return observeAllServices(noreply, function (s) { return s.cron; }, field, wrapper, done, timeout);
}

function observeAllServices(noreply, objGet, field, wrapper, done, timeout) {
	timeout = timeout || 3000;
	done = done || function () { };
	var waiting = services.length - noreply.length;
	var norep = { };
	var didNotReply = { };
	var timeoutHandle;
	for (var i = 0; i < noreply.length; i++) {
		norep[''+noreply[i]] = true;
	}
	services.forEach(function (service, num) {
		didNotReply[''+num] = true;
		observeOnce(objGet(service), field, function () {
			delete didNotReply[''+num];
			if (!norep[''+num]) {
				--waiting;
			}
			if (!waiting) {
				done();
				done = function () { };
				clearTimeout(timeoutHandle);
			}
			wrapper.apply(this, arguments);
		}, timeout);
	});
	timeoutHandle = setTimeout(function () {
		if (waiting) {
			var dnr = [];
			for (var k in didNotReply) {
				if (!norep[k]) {
					dnr.push(k);
				}
			}
			if (dnr.length) {
				throw new Error('services (' + dnr.join(', ') + ') did not execute.');
			}
			var rep = [];
			for (var k in norep) {
				if (!didNotReply[k]) {
					rep.push(k);
				}
			}
			if (rep.length) {
				throw new Error('services (' + rep.join(', ') + ') executed, they shouldn\'t have.');
			}
		}
		done();
		done = function () { };
	}, timeout);
}

function observeOnce(obj, field, wrapper, timeout) {
	var original = obj[field];
	obj[field] = function () {
		wrapper.apply(null, arguments);
		obj[field] = original;
		return original.apply(null, arguments);
	};
	setTimeout(function () {
		obj[field] = original;
	}, timeout);
}

describe('broadcast', function () {

	this.timeout(4000);
	this.slow(2000);

	describe('PUT /:key', function () {

		it('works with no broadcast', function (done) {
			observeAllServicesCache([0,2,3], 'set', function (options) {
				assert.deepEqual(options, {key:'foo',data:'bar',millis:100,associations:['baz','qux']});
			}, done);
			callRoute(1, 'PUT', '/foo', {data:'bar',millis:100,associations:['baz','qux']});
		});

		it('works with broadcast to (0,2,3)', function (done) {
			observeAllServicesCache([], 'set', function (options) {
				assert.deepEqual(options, {key:'foo',data:'bar',millis:100,associations:['baz','qux']});
			}, done);
			callRoute(1, 'PUT', '/foo?broadcast=1', {data:'bar',millis:100,associations:['baz','qux']});
		});

		it('works with broadcast to (0,1,3)', function (done) {
			observeAllServicesCache([], 'set', function (options) {
				assert.deepEqual(options, {key:'foo',data:'bar',millis:100,associations:['baz','qux']});
			}, done);
			callRoute(2, 'PUT', '/foo?broadcast=1', {data:'bar',millis:100,associations:['baz','qux']});
		});
	});

	describe('DELETE /:key', function () {

		it('works with local flag', function (done) {
			observeAllServicesCache([0,2,3], 'clear', function (options) {
				assert.deepEqual(options, {keys:['foo'],levels:'all'});
			}, done);
			callRoute(1, 'DELETE', '/foo?local=1', {});
		});

		it('works with broadcast (0,2,3)', function (done) {
			observeAllServicesCache([], 'clear', function (options) {
				assert.deepEqual(options, {keys:['foo'],levels:'all'});
			}, done);
			callRoute(1, 'DELETE', '/foo', {});
		});

		it('works with broadcast (0,1,3)', function (done) {
			var waiting = 2;
			var complete = function () { --waiting || done(); };
			observeAllServicesCache([], 'clear', function (options) {
				assert.deepEqual(options, {keys:['foo'],levels:4});
			}, complete);
			callRoute(2, 'DELETE', '/foo', {levels:4}, function (e, res, data) {
				assert(res);
				assert.equal(200, res.statusCode);
				assert(data);
				assert(data.success);
				assert(data.broadcastResult);
				assert(data.broadcastResult.failed === 0);
				assert(data.broadcastResult.responses);
				assert(Object.keys(data.broadcastResult.responses).length === 3);
				complete()
			});
		});
	});

	describe('PUT /clear-later', function () {

		it('works with local flag', function (done) {
			observeAllServicesCache([0,2,3], 'clearLater', function (options) {
				assert.deepEqual(options, {keys:['one']});
			}, done);
			callRoute(1, 'PUT', '/clear-later?local=1', {keys:['one']});
		});

		it('works with broadcast (0,2,3)', function (done) {
			observeAllServicesCache([], 'clearLater', function (options) {
				assert.deepEqual(options, {keys:['asdf']});
			}, done);
			callRoute(1, 'PUT', '/clear-later', {keys:['asdf']});
		});

		it('works with broadcast (0,1,3)', function (done) {
			observeAllServicesCache([], 'clearLater', function (options) {
				assert.deepEqual(options, {keys:['foo','bar']});
			}, done);
			callRoute(1, 'PUT', '/clear-later', {keys:['foo','bar']});
		});
	});

	describe('GET /clear-now', function () {

		it('works with local flag', function (done) {
			observeAllServicesCron([0,2,3], 'startClearNowProcess', function (options) {
				assert.equal(0, arguments.length);
			}, done);
			callRoute(1, 'GET', '/clear-now?local=1');
		});

		it('works with broadcast (0,2,3)', function (done) {
			observeAllServicesCron([], 'startClearNowProcess', function (options) {
				assert.equal(0, arguments.length);
			}, done);
			callRoute(1, 'GET', '/clear-now');
		});

		it('works with broadcast (0,1,3)', function (done) {
			observeAllServicesCron([], 'startClearNowProcess', function (options) {
				assert.equal(0, arguments.length);
			}, done);
			callRoute(1, 'GET', '/clear-now');
		});
	});
});