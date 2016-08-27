
var assert = require('assert');

module.exports = function(t, Buffer) {

var fixture = `
1/*
2foo
3 */

5while (true) {
6  if (this[something]) {
7    return \`
8foo
9bar
0\`
1  }
2}
3123`;

var b;

function before() {
  b = new Buffer;
  b.setText(fixture);
}

t('setText', function() {
  before();
  assert.equal(fixture, b.raw);
})

t('getLine', function() {
  before();
  assert.equal(0, b.getLine(0).length);
  assert.equal(3, b.getLine(1).length);
  assert.equal(0, b.getLine(4).length);
  assert.equal(2, b.getLine(12).length);
  assert.equal(4, b.getLine(13).length);
})

t('getLineRangeText', function() {
  before();
  assert.equal('', b.getLineRangeText([0,0]));
  assert.equal('1/*', b.getLineRangeText([1,1]));
  assert.equal('2foo', b.getLineRangeText([2,2]));
  assert.equal('2foo\n3 */', b.getLineRangeText([2,3]));
  assert.equal('\n1/*', b.getLineRangeText([0,1]));
  assert.equal('3123', b.getLineRangeText([13,13]));
  assert.equal('2}\n3123', b.getLineRangeText([12,13]));
})

};
