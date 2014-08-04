var path       = require('path');
var exec       = require('child_process').exec;
var topDir     = path.normalize(__dirname + '/../');
var jshintExec = path.normalize(topDir + '/node_modules/jshint/bin/jshint');

describe('jshint', function () {
	it('passes', function (done) {

		this.slow(2000);
		this.timeout(5000);

		exec(jshintExec + ' --config .jshintrc ./lib/*.js', { cwd: topDir }, function (e, out, err) {
			if (e) {
				throw new Error('JSHINT error (' + e.code + '):\n\n' + out + '\n' + err);
			}
			done();
		});
	});
});