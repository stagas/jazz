
var bench = require('../test/bench');
var SkipString = require('./skipstring');
var Lines = require('./lines');
var PieceTable = require('./piecetable');

var lines = new Lines;
var table = new PieceTable;

var size = 10e6;
var times = 10e2;

var node = new SkipString;

var s = '123456789\n';

var code = '';
for (var i = 0; i <= size; i++) {
  code += s;
  if (i % 200 === 0) {
    node.insert(0, code);
    code = '';
  }
}

console.log('LENGTH', node.length)
// lines.insert(0, code);
// table.set(code);

var s = '123456789\n';
var p = 0;
var res = bench(times, function() {
  p = Math.random() * node.length | 0;
  node.insert(p, s);
  node.insert(p, s);
  node.insert(p, s);
  node.insert(p, s);
  node.insert(p, s);

  node.insert(p, s);
  node.insert(p, s);
  node.insert(p, s);
  node.insert(p, s);
  node.insert(p, s);

  p = Math.random() * node.length / 2 | 0;
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);

  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
  node.remove([p, p + 5]);
}, 'random insert/remove', 20);
print(res);

var res = bench(times, function() {
  p = Math.random() * node.length | 0;
  node.search(p);
  node.search(p);
  node.search(p);
  node.search(p);
  node.search(p);

  node.search(p);
  node.search(p);
  node.search(p);
  node.search(p);
  node.search(p);
  node.search(p);
}, 'random get', 10);
print(res);

// var c;
// console.log('lines:', c);
// var res = bench(times, function() {
//   node.insert(Math.random() * node.length | 0, s);
//   c = node.countLines();
//   node.findLine(Math.random() * c | 0);
// }, 'random insert and get line');
// print(res);

// var c = lines.length;
// var pos;
// console.log('lines:', c);
// var res = bench(times, function() {
//   pos = Math.random() * node.length | 0;
//   node.insert(pos, s);
//   lines.insert(pos, s);
//   lines.get(Math.random() * lines.length | 0);
// }, 'random get line');
// print(res);

// var c = lines.length;
// var pos;
// console.log('lines:', c);
// var res = bench(times, function() {
//   pos = Math.random() * table.add.length | 0;
//   table.insert(pos, s);
//   table.get();
// }, 'random get line');
// print(res);

function print(o, depth) {
  var inspect = require('util').inspect;
  if ('object' === typeof o) {
    console.log(inspect(o, null, depth || null, true));
  } else {
    console.log(o.length, o);
  }
}
