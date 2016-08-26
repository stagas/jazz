
var ChunkArray = require('./chunk-array');

var Type = {
  '\n': 'lines',
  '{': 'open curly',
  '}': 'close curly',
  '[': 'open square',
  ']': 'close square',
  '(': 'open parens',
  ')': 'close parens',
  '/': 'open comment',
  '*': 'close comment',
  '`': 'template string',
};

var TOKEN = /\n|\/\*|\*\/|`|\{|\}|\[|\]|\(|\)/g;

module.exports = Tokens;

Tokens.Type = Type;

function Tokens(chunkSize) {
  this.chunkSize = chunkSize;

  var t = this.tokens = {
    lines: new ChunkArray(chunkSize),
    curly: new ChunkArray(chunkSize),
    square: new ChunkArray(chunkSize),
    parens: new ChunkArray(chunkSize),
    segments: new ChunkArray(chunkSize),
  };

  this.collection = {
    '\n': t.lines,
    '{': t.curly,
    '}': t.curly,
    '[': t.square,
    ']': t.square,
    '(': t.parens,
    ')': t.parens,
    '/': t.segments,
    '*': t.segments,
    '`': t.segments,
  };
}

Tokens.prototype.index = function(text, offset) {
  offset = offset || 0;

  var tokens = this.tokens;
  var match;
  var type;
  var collection;

  while (match = TOKEN.exec(text)) {
    collection = this.collection[text[match.index]];
    collection.push(match.index + offset);
  }
};

Tokens.prototype.insert = function(offset, text) {
  this.shift(offset, text.length);

  var insert = new Tokens(this.chunkSize);
  insert.index(text, offset);
};

Tokens.prototype.shift = function(offset, shift) {
  var collection;
  var token;
  var type;
  var i;

  for (var type in this.tokens) {
    collection = this.tokens[type];
    token = this.get(type, offset);
    i = token ? token.index + (offset > token.offset) : 0;
    collection.shiftAt(i, shift);
  }
};

Tokens.prototype.get = function(type, offset) {
  var tokens = this.tokens[type];
  var begin = 0;
  var end = tokens.length;
  if (!end) return;

  var p = -1;
  var i = -1;
  var t;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    t = tokens.get(i);
    if (t < offset) begin = i;
    else end = i;
  } while (p !== i);

  return {
    offset: t,
    index: i
  };
};
