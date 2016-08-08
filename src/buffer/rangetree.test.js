
var assert = require('assert');

module.exports = function(t, Node) {

var times = 1;

t('insert', function() {
  var node = new Node([0,0],'HEAD');
  node.insert([7,12], 'foo');
  node.insert([15,18], 'cat');
  var bar = node.insert([8,11], 'bar');
  var zoo = node.insert([9,10], 'zoo');
  console.log(node)
  assert.equal('HEAD', node.get(6)[0].value);
  assert.equal('foo', node.get(7)[0].value);
  assert.equal('bar', node.get(8)[0].value);
  assert.equal('zoo', node.get(9)[0].value);
  assert.equal('zoo', node.get(10)[0].value);
  assert.equal('bar', node.get(11)[0].value);
  assert.equal('bar', node.get(12)[0].value);
  assert.equal('bar', node.get(13)[0].value);
  assert.equal('zoo,bar,foo,HEAD', node.get(9).map(n=>n.value).join());

  var dog = node.insert([1,15], 'dog');
  assert.equal('dog', node.get(7)[0].value);
  assert.equal('dog', node.get(15)[0].value);
  assert.equal('foo', node.get(23)[0].value);
  console.log(node);
  var thing = node.insert([0,9], 'thing');
  assert.equal('thing', node.get(7)[0].value);
  assert.equal('dog', node.get(25)[0].value);
  assert.equal('foo', node.get(28)[0].value);

  // assert.equal('HEAD', node.get(0)[0].value);
  // assert.equal('HEAD', node.get(5)[0].value);
  // assert.equal('HEAD', node.get(6)[0].value);
  // assert.equal('foo', node.get(7)[0].value);
  // assert.equal('foo', node.get(8)[0].value);
  // assert.equal('foo', node.get(9)[0].value);
  // assert.equal('HEAD', node.get(10)[0].value);
  // node.range[0] = 7
  // assert.equal('HEAD', node.get(0)[0].value);
  // assert.equal('HEAD', node.get(5)[0].value);
  // assert.equal('HEAD', node.get(6)[0].value);
  // assert.equal('HEAD', node.get(7)[0].value);
  // assert.equal('HEAD', node.get(8)[0].value);
  // assert.equal('foo', node.get(9)[0].value);
  // assert.equal('foo', node.get(10)[0].value);
  // assert.equal('foo', node.get(11)[0].value);
  // assert.equal('HEAD', node.get(12)[0].value);
  // var bar;
  // assert.equal([1,2], (bar = node.insert([8,9], 'bar')).range);
  // console.log('bar offset', bar, bar.offset())
  // node.insert([8,9], 'bar');
  // console.log(node)
  // // console.log(node)
  // assert.equal([0,0], node.insert([8,8], 'zoo').range);
// var zoo = node.insert([8,8], 'zoo');
// console.log(node.get(8))
// console.log(zoo.offset(), zoo.range)
  // assert.equal('HEAD', node.get(17)[0].value);
  // assert.equal('cat', node.get(18)[0].value);
  // assert.equal('cat', node.get(19)[0].value);
  // assert.equal('cat', node.get(20)[0].value);
  // assert.equal('cat', node.get(21)[0].value);
  // assert.equal('HEAD', node.get(22)[0].value);
})

};

function repeat(times, fn) {
  while (times--) fn();
}
