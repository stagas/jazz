
var bench = require('../../test/bench');
var Node = require('./rangetree');

var size = 10000;
var node = new Node([0,size]);
var times = 10e4;

var a,b;
var res = bench(times, function() {
  a = Math.random() * (size - 100) | 0;
  b = a + Math.random() * 100 | 0;
  node.insert([a,b], 'foo');
}, 'random inserts');
print(res);

function print(o, depth) {
  var inspect = require('util').inspect;
  if ('object' === typeof o) {
    console.log(inspect(o, null, depth || null, true));
  } else {
    console.log(o.length, o);
  }
}
