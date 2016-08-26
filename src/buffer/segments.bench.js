var Buffer = require('./');
var Point = require('../../lib/point');
var bench = require('../../test/bench');
var print = require('../../lib/print');
var read = require('fs').readFileSync;

var TIMES = 10e3;

var code =
  // read(__dirname + '/../../test/syntax.html.js', 'utf8');
  read(__dirname + '/../../examples/babel.js', 'utf8');

var buffer = new Buffer();

buffer.set(code);

// var res = bench(TIMES, function() {
//   syntax.set(code);
// }, 'syntax set');

// print(res);

var res = bench(1, function() {
  buffer.segments.index(buffer.raw);
}, 'segments index');
print(res);

// console.log(buffer.segments.segments.length)

var res = bench(TIMES, function() {
  var x = 0;
  for (var i = 0; i < 80000; i+=Math.random() * 100 | 0) {
    x++;
    buffer.segments.get(i);
    if (x === 1000) break;
  }
}, 'segments get', 1000);
print(res);

// console.log(buffer.segments.cache.point)