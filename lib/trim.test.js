
var assert = require('assert');

module.exports = function(t, trim) {

var text = '\n\n\n\nfoo bar\n\n\n\n';
var edge1 = '\nfoo bar\n';
var edge2 = '\n foo bar \n';
var edge3 = '\n \nfoo bar\n \n';

t('empty lines', function() {
  assert.equal('foo bar', trim.emptyLines(text).string);
  assert.equal(8, trim.emptyLines(text).removed);
  assert.equal(4, trim.emptyLines(text).trailing);
  assert.equal(4, trim.emptyLines(text).leading);
})

t('trailing empty lines', function() {
  assert.equal('\n\n\n\nfoo bar', trim.trailingEmptyLines(text).string);
  assert.equal(4, trim.trailingEmptyLines(text).removed);
  assert.equal('\nfoo bar', trim.trailingEmptyLines(edge1).string);
  assert.equal(1, trim.trailingEmptyLines(edge1).removed);
  assert.equal('\n foo bar ', trim.trailingEmptyLines(edge2).string);
  assert.equal(1, trim.trailingEmptyLines(edge2).removed);
  assert.equal('\n \nfoo bar\n ', trim.trailingEmptyLines(edge3).string);
  assert.equal(1, trim.trailingEmptyLines(edge3).removed);
})

t('leading empty lines', function() {
  assert.equal('foo bar\n\n\n\n', trim.leadingEmptyLines(text).string);
  assert.equal(4, trim.leadingEmptyLines(text).removed);
  assert.equal('foo bar\n', trim.leadingEmptyLines(edge1).string);
  assert.equal(1, trim.leadingEmptyLines(edge1).removed);
  assert.equal(' foo bar \n', trim.leadingEmptyLines(edge2).string);
  assert.equal(1, trim.leadingEmptyLines(edge2).removed);
  assert.equal(' \nfoo bar\n \n', trim.leadingEmptyLines(edge3).string);
  assert.equal(1, trim.leadingEmptyLines(edge3).removed);
})

};
