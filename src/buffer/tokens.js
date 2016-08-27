
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

function Tokens(factory) {
  factory = factory || function() { return new ChunkArray(5000) };

  var t = this.tokens = {
    lines: factory(),
    curly: factory(),
    square: factory(),
    parens: factory(),
    segments: factory(),
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
  var insert = new Tokens(Array);
  insert.index(text, offset);

  var shift = text.length;
  var collection;

  for (var type in insert.tokens) {
    collection = insert.tokens[type];
    if (collection.length) {
      this.tokens[type].mergeShift(collection, shift);
    } else {
      this.tokens[type].shiftAt(offset, shift);
    }
  }
};

Tokens.prototype.updateRange = function(range, text) {
  for (var type in this.tokens) {
    this.tokens[type].removeOffsetRange(range);
  }
  this.insert(range[0], text);
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

Tokens.prototype.getByIndex = function(type, index) {
  return this.tokens[type].get(index);
};

Tokens.prototype.getCollection = function(type) {
  return this.tokens[type];
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
