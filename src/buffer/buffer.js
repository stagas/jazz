var debounce = require('debounce');
var throttle = require('throttle');
var parse = require('parse');
var Area = require('area');
var Regexp = require('regexp');
var Events = require('events');
var Lines = require('./lines');
var Segments = require('./segments');
var SkipString = require('./skipstring');
var PrefixTree = require('./prefixtree');
var Indexer = require('./indexer');

exports = module.exports = Buffer;

var EOL = exports.EOL = /\r\n|\r|\n/g;
var N = exports.N = /\n/g;
var CHUNK_SIZE = exports.CHUNK_SIZE = 5000;
var WORDS = Regexp.create(['tokens'], 'g');

function Buffer() {
  this.raw = '';
  this.text = new SkipString({ chunkSize: CHUNK_SIZE });
  this.lines = new Lines;
  this.prefix = new PrefixTree;
  this.segments = new Segments;
  this.indexer = new Indexer(this);
  this.changes = 0;
  this.on('update', debounce(this.updateRaw.bind(this), 1500));
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

Buffer.prototype.updateRaw = function() {
  if (this.changes) {
    this.changes = 0;

    // console.time('update raw');

    this.raw = this.get();

    // console.time('segment index');
    this.segments.createIndex(this.raw);
    // console.timeEnd('segment index');
    this.emit('raw');
    // console.timeEnd('update raw');
  }
};

Buffer.prototype.getLine = function(y) {
  return this.get([y,y]);
};

Buffer.prototype.set = function(text) {
  Buffer.call(this);

  this.raw = text = normalizeEOL(text);
  this.text.set(text);
  this.changes = 0;

  console.time('segment index');
  this.segments.createIndex(this.raw);
  console.timeEnd('segment index');

  console.time('prefix index');
  this.prefix = new PrefixTree;
  this.prefix.index(this.raw);
  console.timeEnd('prefix index');

  console.time('lines index');
  this.lines.insert({ x:0, y:0 }, this.raw);
  console.timeEnd('lines index');

  this.emit('set');
};

Buffer.prototype.insert = function(point, text, shift, isCtrlShift) {
  var isEOL, lines, range, textBefore, textAfter;

  this.changes++;

  this.emit('before update');

  text = normalizeEOL(text);

  isEOL = '\n' === text && !isCtrlShift;

  point = this.lines.getPoint(point);
  lines = this.lines.insert(point, text);
  range = [point.y, point.y + lines - isEOL];

  textBefore = this.get(range);
  this.text.insert(point.offset, text);
  textAfter = this.get(range);

  this.prefix.index(textAfter);

  this.emit('update', range, shift || +isEOL, textBefore, textAfter);

  // this is to update caret position
  return text.length;
};

Buffer.prototype.deleteCharAt = function(point) {
  var isEOL, range, textBefore;

  this.changes++;

  this.emit('before update');

  point = this.lines.getPoint(point);
  isEOL = this.lines.removeCharAt(point);
  range = [point.y, point.y];
  textBefore = this.get(range);

  this.text.removeCharAt(point.offset);

  this.prefix.index(this.get(range));

  this.emit('update', range, -isEOL, textBefore);
};

Buffer.prototype.wordAt = function(point, inclusive) {
  inclusive = inclusive || 0;
  point = this.lines.getPoint(point);
  var text = this.text.getRange(point.line.range);
  var words = Regexp.parse(text, WORDS);
  if (words.length === 1) {
    return new Area({
      begin: { x: 0, y: point.y },
      end: { x: point.line.length, y: point.y },
    });
  }
  var lastIndex = 0;
  var word = [];
  var end = text.length;
  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (word.index > point.x - inclusive) {
      end = word.index;
      break;
    }
    lastIndex = word.index;
  }
  return new Area({
    begin: { x: lastIndex, y: point.y },
    end: { x: end, y: point.y }
  });
};

Buffer.prototype.deleteArea = function(area, noUpdate) {
  var range;

  this.changes++;

  this.emit('before update');

  range = this.lines.getArea(area);
  this.lines.removeArea(area);
  this.text.remove([range[0].offset, range[1].offset]);

  if (!noUpdate) {
    this.emit('update', [area.begin.y, area.end.y]);
  }
};

Buffer.prototype.getArea = function(area) {
  var r = this.lines.getArea(area);
  var text = this.text.getRange([r[0].offset, r[1].offset]);
  return text;
};

Buffer.prototype.moveAreaByLines = function(y, area) {
  if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
  if (area.begin.y + y < 0 || area.end.y + y > this.loc) return false;

  area.begin.x = 0;
  area.end.x = 0;

  var text = this.get([area.begin.y, area.end.y-1]);
  this.deleteArea(area);

  this.insert({ x:0, y:area.begin.y + y }, text, y, true);

  return true;
};

function normalizeEOL(s) {
  return s.replace(exports.EOL, '\n');
}
