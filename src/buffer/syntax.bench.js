var Syntax = require('./syntax');
var bench = require('../../test/bench');
var print = require('../../lib/print');
var read = require('fs').readFileSync;

var TIMES = 10e3;

var code =
  read(__dirname + '/../../test/syntax.html.js', 'utf8');
  // read(__dirname + '/../../babel.js', 'utf8');

var syntax = new Syntax;

// var res = bench(TIMES, function() {
//   syntax.set(code);
// }, 'syntax set');

// print(res);

var res = bench(TIMES, function() {
  syntax.highlight(code);
}, 'syntax highlight');

print(res);
