var Buffer = require('./new-buffer');
var Point = require('../../lib/point');
var bench = require('../../test/bench');
var print = require('../../lib/print');
var read = require('fs').readFileSync;

var TIMES = 100;

var code =
  // read(__dirname + '/../../test/syntax.html.js', 'utf8');
  read(__dirname + '/../../examples/babel.js', 'utf8');

var length = code.length - 200;

var buffer = new Buffer;

var i;

var res = bench(1, function() {
  buffer.setText(code);
}, 'setText');
print(res);

i = 50000;
var res = bench(TIMES*100, function() {
  buffer.get([i, i]);
}, 'get same line');
print(res);

i = 60000;
var res = bench(TIMES*10, function() {
  buffer.get([i, i+50]);
}, 'get same 50 lines');
print(res);

i = 80000
var res = bench(TIMES, function() {
  buffer.get([i, i+50]);
  i = Math.random() * (buffer.loc() - 51) | 0;
}, 'random gets of 50 lines');
print(res);

i = 0;
var res = bench(TIMES*10, function() {
  buffer.get([i, i+50]);
  i += 50;
}, 'sequential gets of 50 lines');
print(res);

var res = bench(TIMES, function() {
  i = Math.random() * buffer.loc() | 0;
  buffer.insert({ x:0, y:i }, '123\n{456}\n');
}, 'random inserts');
print(res);
