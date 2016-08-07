var debounce = require('debounce');
var parse = require('parse');
var Area = require('area');
var Events = require('events');
var Lines = require('./lines');
var Segments = require('./segments');
var SkipString = require('./skipstring');
var PrefixTree = require('./prefixtree');
var Indexer = require('./indexer');

exports = module.exports = Buffer;

var EOL = exports.EOL = /\r\n|\r|\n/g;
var N = exports.N = /\n/g;
var CHUNK_SIZE = exports.CHUNK_SIZE = 3000;

function Buffer() {
  this.raw = '';
  this.text = new SkipString;
  this.lines = new Lines;
  this.prefix = new PrefixTree;
  this.segments = new Segments;
  this.indexer = new Indexer(this);
}

Buffer.prototype = {
  get loc() {
    return this.lines.length;
  }
};

Buffer.prototype.__proto__ = Events.prototype;

Buffer.prototype.get = function(range) {
  if (!range) return this.text.getRange();
  var offsets = this.lines.getRange(range);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.getLine = function(y) {
  return this.get([y,y]);
};

Buffer.prototype.set = function(text) {
  Buffer.call(this);

  text = this.normalizeEndLines(text);
  this.raw = text;

  // this.updateIndexes();

  console.time('lines index');
  this.lines.insert({ x:0, y:0 }, text);
  console.timeEnd('lines index');

  this.text.insertChunked(0, text, exports.CHUNK_SIZE);

  this.emit('set');
};

Buffer.prototype.insert = function(point, text, shift) {
  this.emit('before update');
  text = this.normalizeEndLines(text);
  var isEOL = '\n' === text;
  point = this.lines.getPoint(point);
  var lines = this.lines.insert(point, text);
  this.text.insert(point.offset, text);
  var range = [point.y, point.y + lines - isEOL];
  var insertedText = this.get(range);
  this.emit('update', range, shift || +isEOL);
  return text.length;
};

Buffer.prototype.updateIndexes = debounce(function() {
  console.time('index');
  console.time('prefix index');
  this.prefix = new PrefixTree;
  this.prefix.index(this.raw);
  console.timeEnd('prefix index');
  console.time('segment index');
  this.segments = new Segments;
  this.segments.set(this.raw);
  console.timeEnd('segment index');
  console.timeEnd('index');
}, 10000);

Buffer.prototype.deleteCharAt = function(point) {
  this.emit('before update');
  point = this.lines.getPoint(point);
  var isEOL = this.lines.removeCharAt(point);
  // if (isEOL) this.emit('shift', -1);
  this.text.removeCharAt(point.offset);
  this.emit('update', [point.y, point.y], -isEOL);
};

Buffer.prototype.wordAt = function(point, inclusive) {
  inclusive = inclusive || 0;
  point = this.lines.getPoint(point);
  var text = this.text.getRange(point.line.range);
  var words = parse.tokens(text);
  if (words.length === 1) {
    return new Area({
      begin: { x: 0, y: point.y },
      end: { x: point.line.length, y: point.y },
    });
  }
  var lastIndex = 0;
  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (word.index > point.x - inclusive) {
      return new Area({
        begin: { x: lastIndex, y: point.y },
        end: { x: word.index, y: point.y }
      });
    }
    lastIndex = word.index;
  }
};

Buffer.prototype.deleteArea = function(area, noUpdate) {
  var range = this.lines.getArea(area);
  this.lines.removeArea(area);
  this.text.remove([range[0].offset, range[1].offset]);
  if (!noUpdate) this.emit('update', [area.begin.y, area.end.y]);
};

Buffer.prototype.getArea = function(area) {
  var range = this.lines.getArea(area);
  var text = this.text.getRange([range[0].offset, range[1].offset]);
  return text;
};

/*
Buffer.prototype.moveAreaByLines = function(y, area) {
  var range = this.lines.getAreaRange(area);
  var text = this.text.getRange(range);
  var lines = Lines.count(lines);
  this.text.remove(range);
  this.lines.removeAreaRange(area);

  y = area.begin.y + y;
  var pos = this.lines.get({ x: 0, y: y });
  this.text.insert(pos, text);
  this.lines.insert(y, text);
};

*/
Buffer.prototype.normalizeEndLines = function(s) {
  return s.replace(exports.EOL, '\n');
};
