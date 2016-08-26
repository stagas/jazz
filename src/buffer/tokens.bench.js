var Tokens = require('./tokens');
var Point = require('../../lib/point');
var bench = require('../../test/bench');
var print = require('../../lib/print');
var read = require('fs').readFileSync;

var TIMES = 10;

var code =
  // read(__dirname + '/../../test/syntax.html.js', 'utf8');
  read(__dirname + '/../../examples/babel.js', 'utf8');

var length = code.length;

var tokens = new Tokens(5000);

var res = bench(TIMES, function() {
  tokens.index(code);
}, 'tokens index');
print(res);

var res = bench(TIMES * 1000, function() {
  tokens.get('segments', Math.random() * length | 0);
}, 'tokens get');
print(res);

var res = bench(TIMES * 1000, function() {
  tokens.shift(Math.random() * length | 0, 5);
}, 'tokens shift');
print(res);

// tokens.shift(0, 2)

// var token = tokens.get('segments', 23204);
// console.log(token)
// console.log(Tokens.Type[code[token.offset-2]]);
