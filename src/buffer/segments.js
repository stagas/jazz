var Regexp = require('regexp');

var PHONY_ENDING = '`*/';

var MULTILINE = Regexp.create([
  Regexp.types.strings,
  Regexp.types.comments,
], 'g');

var FILTERS = [
  ['double comment', '/*', 2],
  ['template string', '`', 1]
];

module.exports = Segments;

function Segments() {
  this.index = [];
}

Segments.prototype.createIndex = function(s) {
  this.index = Regexp.parse(s + PHONY_ENDING, MULTILINE, function(token) {
    for (var i = 0; i < FILTERS.length; i++) {
      if (token[0].substr(0,FILTERS[i][2]) === FILTERS[i][1]) return true;
    }
  });
  return this.index.length;
};

Segments.prototype.get = function(offset) {
  var index = this.index;

  var begin = 0;
  var end = index.length;
  if (!end) return;

  var p = -1;
  var i = -1;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    if (index[i].index <= offset) begin = i;
    else end = i;
  } while (p !== i);

  var token = index[i];

  var type;
  for (var i = 0; i < FILTERS.length; i++) {
    var f = FILTERS[i];
    if (token[0].slice(0,f[2]) === f[1]) {
      type = f[0];
      break;
    }
  }

  return {
    index: p,
    type: type,
    token: token,
    range: [token.index, token.index + token[0].length]
  };
};

Segments.prototype.shift = function(offset, n) {
  // console.time('shift segments')
  var segment = this.get(offset);
  for (var i = segment.index + 1; i < this.index.length; i++) {
    this.index[i].index += n;
  }
  // console.timeEnd('shift segments')
};
