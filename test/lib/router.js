var Promise          = require('bluebird');
var request          = require('request');
var assert           = require('assert');
var cachelinkService = require('../../lib/index.js');
var config           = require(__dirname + '/../config.json');
var log              = require(__dirname + '/log.js');
var service          = cachelinkService(config, { log: function () { return log; }});

service.start();

function callRouteNoAuth(httpMethod, path, data, callback) {
	request({
		method : httpMethod,
		url    : 'http://localhost:' + config.port + path,
		json   : data
	}, callback || function () {

	});
}

function callRoute(httpMethod, path, data, callback) {
	request({
		method : httpMethod,
		url    : 'http://localhost:' + config.port + path,
		json   : data,
		auth   : config.basicAuth
	}, callback || function () {

	});
}

function observeOnce(obj, field, wrapper) {
	var original = obj[field];
	obj[field] = function () {
		wrapper.apply(null, arguments);
		obj[field] = original;
		return original.apply(null, arguments);
	};
}

describe('router', function () {

	describe('GET /', function () {

		it('should not work without basic auth', function (done) {
			callRouteNoAuth('GET', '/?key=foo', null, function (e, res) {
				assert.equal(401, res.statusCode);
				done();
			});
		});

		it('works', function (done) {
			observeOnce(service.cache, 'getMany', function (options) {
				assert.deepEqual(options, {keys:['foo']});
				done();
			});
			callRoute('GET', '/?key=foo', null);
		});

	});

	describe('PUT /:key', function () {

		it('works', function (done) {
			observeOnce(service.cache, 'set', function (options) {
				assert.deepEqual(options, {key:'foo',data:'bar',millis:100,associations:['baz','qux']});
				done();
			});
			callRoute('PUT', '/foo', {data:'bar',millis:100,associations:['baz','qux']});
		});
	});

	describe('GET /clear', function () {

		it('works with query string "k"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo"],"levels":"all"});
				done();
			});
			callRoute('GET', '/clear?k=foo', null);
		});

		it('works with query string "key"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"],"levels":"all"});
				done();
			});
			callRoute('GET', '/clear?key=foo&key=bar', null);
		});

		it('works with query string "keys"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"],"levels":"all"});
				done();
			});
			callRoute('GET', '/clear?keys=foo&keys=bar&keys=baz', null);
		});
	});

	describe('DELETE /:key', function () {

		it('works', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo"],"levels":"all"});
				done();
			});
			callRoute('DELETE', '/foo', null);
		});
	});

	describe('DELETE /', function () {

		it('works with query string "k"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo"],"levels":"all"});
				done();
			});
			callRoute('DELETE', '/?k=foo', null);
		});

		it('works with query string "key"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"],"levels":"all"});
				done();
			});
			callRoute('DELETE', '/?key=foo&key=bar', null);
		});

		it('works with query string "keys"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"],"levels":"all"});
				done();
			});
			callRoute('DELETE', '/?keys=foo&keys=bar&keys=baz', null);
		});

		it('works with data "k"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo"],"levels":54});
				done();
			});
			callRoute('DELETE', '/', {"k":["foo"],"levels":54});
		});

		it('works with data "key"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"],"levels":"none"});
				done();
			});
			callRoute('DELETE', '/', {"key":["foo","bar"],"levels":'none'});
		});

		it('works with data "keys"', function (done) {
			observeOnce(service.cache, 'clear', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"],"levels":2});
				done();
			});
			callRoute('DELETE', '/', {"keys":["foo","bar","baz"],"levels":2});
		});
	});

	describe('GET /clear-later/:key', function () {

		it('works', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo"]});
				done();
			});
			callRoute('GET', '/clear-later/foo');
		});
	});

	describe('GET /clear-later', function () {

		it('works with query string "k"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo"]});
				done();
			});
			callRoute('GET', '/clear-later?k=foo', null);
		});

		it('works with query string "key"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"]});
				done();
			});
			callRoute('GET', '/clear-later?key=foo&key=bar', null);
		});

		it('works with query string "keys"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"]});
				done();
			});
			callRoute('GET', '/clear-later?keys=foo&keys=bar&keys=baz', null);
		});
	});

	describe('PUT /clear-later', function () {

		it('works with query string "k"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo"]});
				done();
			});
			callRoute('PUT', '/clear-later?k=foo', null);
		});

		it('works with query string "key"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"]});
				done();
			});
			callRoute('PUT', '/clear-later?key=foo&key=bar', null);
		});

		it('works with query string "keys"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"]});
				done();
			});
			callRoute('PUT', '/clear-later?keys=foo&keys=bar&keys=baz', null);
		});

		it('works with data "k"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo"]});
				done();
			});
			callRoute('PUT', '/clear-later', {"k":["foo"]});
		});

		it('works with data "key"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"]});
				done();
			});
			callRoute('PUT', '/clear-later', {"key":["foo","bar"]});
		});

		it('works with data "keys"', function (done) {
			observeOnce(service.cache, 'clearLater', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"]});
				done();
			});
			callRoute('PUT', '/clear-later', {"keys":["foo","bar","baz"]});
		});
	});

	describe('GET /clear-now', function () {

		it('works', function (done) {
			observeOnce(service.cache, 'clearNow', function () {
				assert(arguments.length === 0);
				done();
			});
			callRoute('GET', '/clear-now', null);
		});
	});

	describe('GET /clear-counts', function () {

		it('works', function (done) {
			var waiting = 2;
			observeOnce(service.cache, 'clearLaterCount', function () {
				assert(arguments.length === 0);
				--waiting || done();
			});
			observeOnce(service.cache, 'clearNowCount', function () {
				assert(arguments.length === 0);
				--waiting || done();
			});
			callRoute('GET', '/clear-counts', null);
		});
	});

	describe('GET /:key', function () {

		it('works', function (done) {
			observeOnce(service.cache, 'get', function (options) {
				assert.deepEqual(options, {key:'x'});
				done();
			});
			callRoute('GET', '/x', null);
		});
	});

	describe('GET /', function () {

		it('works with query string "k"', function (done) {
			observeOnce(service.cache, 'getMany', function (options) {
				assert.deepEqual(options, {"keys":["foo"]});
				done();
			});
			callRoute('GET', '/?k=foo', null);
		});

		it('works with query string "key"', function (done) {
			observeOnce(service.cache, 'getMany', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar"]});
				done();
			});
			callRoute('GET', '/?key=foo&key=bar', null);
		});

		it('works with query string "keys"', function (done) {
			observeOnce(service.cache, 'getMany', function (options) {
				assert.deepEqual(options, {"keys":["foo","bar","baz"]});
				done();
			});
			callRoute('GET', '/?keys=foo&keys=bar&keys=baz', null);
		});
	});



});