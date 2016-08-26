
var assert = require('assert');

module.exports = function(t, Tokens) {

var fixture = `
/*
foo
 */

while (true) {
  if (this[something]) {
    return \`
foo
bar
\`
  }
}
`;

var t;

function before() {
  t = new Tokens(2);
  t.index(fixture);
}

t('index', function() {
  before();
  assert.equal(13, t.tokens.lines.length);
  assert.equal(4, t.tokens.curly.length);
  assert.equal(2, t.tokens.square.length);
  assert.equal(4, t.tokens.parens.length);
  assert.equal(4, t.tokens.segments.length);
  assert.equal(0, t.tokens.lines.get(0));
  assert.equal(3, t.tokens.lines.get(1));
  assert.equal(fixture.length-1, t.tokens.lines.get(t.tokens.lines.length-1));
  // assert.equal(1, t.tokens.segments.get(0));
})

t('shift', function() {
  before();
  t.shift(1, 2);
  assert.equal(0, t.tokens.lines.get(0));
  assert.equal(3+2, t.tokens.lines.get(1));
  assert.equal(fixture.length-1+2, t.tokens.lines.get(t.tokens.lines.length-1));
  assert.equal(1+2, t.tokens.segments.get(0));

  before();
  t.shift(0, 2);
  assert.equal(0+2, t.tokens.lines.get(0));
  assert.equal(3+2, t.tokens.lines.get(1));
  assert.equal(fixture.length-1+2, t.tokens.lines.get(t.tokens.lines.length-1));
  assert.equal(1+2, t.tokens.segments.get(0));
})

};
