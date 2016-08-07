
var assert = require('assert');

module.exports = function(t, PTNode) {
  var words = [
    'foo',
    'fo',
    'ba',
    'bar'
  ];

  t('insert', function() {
    var node = new PTNode;
    words.forEach((word) => node.insert(word));
    assert.equal('', node.value);
    assert.equal('', node.children.f.value);
    assert.equal('fo', node.children.f.children.o.value);
    assert.equal('foo', node.children.f.children.o.children.o.value);
    assert.equal('ba', node.children.b.children.a.value);
    assert.equal('bar', node.children.b.children.a.children.r.value);
  })

  t('find', function() {
    var node = new PTNode;
    words.forEach((word) => node.insert(word));
    assert.equal(undefined, node.find('x'));
    assert.equal('', node.find('f').value);
    assert.equal('fo', node.find('fo').value);
    assert.equal('foo', node.find('foo').value);
    assert.equal('', node.find('b').value);
    assert.equal('ba', node.find('ba').value);
    assert.equal('bar', node.find('bar').value);
  })

  t('getSortedChildren', function() {
    var node = new PTNode;
    words.forEach((word) => node.insert(word));
    assert.equal(
      ['ba', 'fo', 'bar', 'foo'],
      node.getSortedChildren().map((node) => node.value)
    );
    node.children.f.children.o.incrementRank();
    assert.equal(
      ['fo', 'ba', 'bar', 'foo'],
      node.getSortedChildren().map((node) => node.value)
    );
  })

  t('collect', function() {
    var node = new PTNode;
    words.forEach((word) => node.insert(word));
    assert.equal(
      ['ba', 'bar'],
      node.collect('b').map((node) => node.value)
    );
    assert.equal(
      ['fo', 'foo'],
      node.collect('f').map((node) => node.value)
    );
    assert.equal(
      ['foo'],
      node.collect('foo').map((node) => node.value)
    );
    assert.equal(
      [],
      node.collect('x')
    );
  })

  t('index', function() {
    var node = new PTNode;
    var s = 'foo bar fo ba';
    node.index(s);
    assert.equal(
      ['ba', 'fo', 'bar', 'foo'],
      node.getSortedChildren().map((node) => node.value)
    );
  })
};

function repeat(times, fn) {
  while (times--) fn();
}
