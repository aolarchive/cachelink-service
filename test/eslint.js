const path       = require('path');
const exec       = require('child_process').exec;

const topDir     = path.join(__dirname, '..');
const eslintExec = path.join(topDir, 'node_modules', '.bin', 'eslint');

describe('eslint', () => {
  it('passes', function eslintPasses(done) {

    this.slow(2000);
    this.timeout(5000);

    exec(`${eslintExec} --config .eslintrc.yml ./lib/*.js`, { cwd: topDir }, (e, out, err) => {
      if (e) {
        throw new Error(`ESLINT error (${e.code}):\n\n${out}\n${err}`);
      }
      done();
    });
  });
});
