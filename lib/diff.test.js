
var assert = require('assert');

module.exports = function(t, diff) {
  t('diff', function() {
    assert.equal({b:3}, diff({a:1,b:2},{a:1,b:3}));
    assert.equal({a:1,b:3}, diff({b:2},{a:1,b:3}));
    assert.equal({a:1,b:3}, diff({},{a:1,b:3}));
    assert.equal(undefined, diff({a:1,b:3},{a:1,b:3}));
    assert.equal(undefined, diff({a:1,b:3,c:4},{a:1,b:3}));
    assert.equal({a:2,d:5}, diff({a:1,b:3,c:4},{a:2,b:3,d:5}));
  })
}