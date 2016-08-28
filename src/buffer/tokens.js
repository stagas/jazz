
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

// var TOKEN = /\n/g;
var TOKEN = /\n|\/\*|\*\/|`|\{|\}|\[|\]|\(|\)/g;

module.exports = Tokens;

Tokens.Type = Type;

function Tokens(factory) {
  factory = factory || function() { return new Array; };

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

function sortByNumber(a, b) {
  return a - b;
}

Tokens.prototype.update = function(range, text, shift) {
  var insert = new Tokens(Array);
  insert.index(text, range[0]);

  for (var type in this.tokens) {
    for (var i = 0; i < this.tokens[type].length; i++) {
      if (this.tokens[type][i] >= range[0]) {
        this.tokens[type][i] += shift;
        if (this.tokens[type][i] < range[0]) {
          this.tokens[type].splice(i--, 1);
        }
      }
    }

    for (var i = 0; i < this.tokens[type].length; i++) {
      if ( this.tokens[type][i] >= range[0]
        && this.tokens[type][i] < range[1]) {
        this.tokens[type].splice(i--, 1);
      }
    }

    this.tokens[type].push.apply(this.tokens[type], insert.tokens[type]);
    this.tokens[type].sort(sortByNumber);
  }
};

Tokens.prototype.getByIndex = function(type, index) {
  return this.tokens[type][index];
};

Tokens.prototype.getCollection = function(type) {
  return this.tokens[type];
};

Tokens.prototype.getByOffset = function(type, offset) {
  var i = this.tokens[type].length;
  while (i--) {
    if (this.tokens[type][i] < offset) return {
      offset: this.tokens[type][i],
      index: i+1
    };
  }
  return {
    offset: 0,
    index: 0
  };
};
