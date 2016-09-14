var Event = require('../../lib/event');
var Parts = require('./parts');

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
  factory = factory || function() { return new Parts; };

  this.factory = factory;

  var t = this.tokens = {
    lines: factory(),
    blocks: factory(),
    segments: factory(),
  };

  this.collection = {
    '\n': t.lines,
    '{': t.blocks,
    '}': t.blocks,
    '[': t.blocks,
    ']': t.blocks,
    '(': t.blocks,
    ')': t.blocks,
    '/': t.segments,
    '*': t.segments,
    '`': t.segments,
  };
}

Tokens.prototype.__proto__ = Event.prototype;

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

Tokens.prototype.update = function(range, text, shift) {
  var insert = new Tokens(Array);
  insert.index(text, range[0]);

  var lengths = {};
  for (var type in this.tokens) {
    lengths[type] = this.tokens[type].length;
  }

  for (var type in this.tokens) {
    this.tokens[type].shiftOffset(range[0], shift);
    this.tokens[type].removeRange(range);
    this.tokens[type].insert(range[0], insert.tokens[type]);
  }

  for (var type in this.tokens) {
    if (this.tokens[type].length !== lengths[type]) {
      this.emit(`change ${type}`);
    }
  }
};

Tokens.prototype.getByIndex = function(type, index) {
  return this.tokens[type].get(index);
};

Tokens.prototype.getCollection = function(type) {
  return this.tokens[type];
};

Tokens.prototype.getByOffset = function(type, offset) {
  return this.tokens[type].find(offset);
};

Tokens.prototype.copy = function() {
  var tokens = new Tokens(this.factory);
  var t = tokens.tokens;
  for (var key in this.tokens) {
    t[key] = this.tokens[key].slice();
  }
  tokens.collection = {
    '\n': t.lines,
    '{': t.blocks,
    '}': t.blocks,
    '[': t.blocks,
    ']': t.blocks,
    '(': t.blocks,
    ')': t.blocks,
    '/': t.segments,
    '*': t.segments,
    '`': t.segments,
  };
  return tokens;
};
