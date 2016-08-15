var debounce = require('debounce');
var throttle = require('throttle');
var parse = require('parse');
var Area = require('area');
var Range = require('range');
var Regexp = require('regexp');
var Events = require('events');
var Lines = require('./lines');
var Syntax = require('./syntax');
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
  this.syntax = new Syntax;
  this.prefix = new PrefixTree;
  this.segments = new Segments(this);
  this.indexer = new Indexer(this);
  this.changes = 0;
  // this.on('update', debounce(this.updateRaw.bind(this), 200));
  this.on('raw', this.segments.index.bind(this.segments));
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

var BLOCK = {
  'comment': '/*',
  'string': '`',
};

var BLOCK_END = {
  'comment': '*/',
  'string': '`',
};

Buffer.prototype.getHighlighted = function(range) {
  var code = this.get(range);
  // console.time('get segment')
  var block = this.segments.get(range[0]);
  // console.timeEnd('get segment')
  if (block) {
    code = BLOCK[block] + '\uffba' + code + '\uffbe' + BLOCK_END[block];
    code = this.syntax.highlight(code);
    code = '<' + block + '>' +
      code.substring(
        code.indexOf('\uffba') + 1,
        code.lastIndexOf('\uffbe')
      );
  } else {
    code = this.syntax.highlight(code);
    // + '\uffbe*/`');
    // code = code.substring(
    //   0,
    //   code.lastIndexOf('\uffbe')
    // );
  }
  return code;
};

//TODO: this defeats the purpose of having a skiplist
// need to get rid of in the future
Buffer.prototype.updateRaw = function() {
  if (this.changes) {
    this.changes = 0;
    this.raw = this.get();
    this.emit('raw', this.raw);
  }
};

Buffer.prototype.getOffsetLine = function(offset) {
  var point = this.lines.getOffset(offset);
  var text = this.text.getRange(point.line.range);
  return {
    point: point,
    text: text
  };
};

Buffer.prototype.getLine = function(y) {
  return this.get([y,y]);
};

Buffer.prototype.set = function(text) {
  Buffer.call(this);

  this.raw = text = normalizeEOL(text);
  this.emit('raw', this.raw);

  console.time('text insert');
  this.text = new SkipString({ chunkSize: CHUNK_SIZE });
  this.text.set(text);
  this.changes = 0;
  console.timeEnd('text insert');

  console.time('prefix index');
  this.prefix = new PrefixTree;
  this.prefix.index(this.raw);
  console.timeEnd('prefix index');

  console.time('lines index');
  this.lines.insert({ x:0, y:0 }, this.raw);
  console.timeEnd('lines index');

  console.time('segments index');
  this.segments.index(this.raw);
  console.timeEnd('segments index');

  this.emit('set');
};

Buffer.prototype.insert = function(point, text, shift, isCtrlShift) {
  var isEOL, lines, range, before, after;

  this.changes++;

  if (!isCtrlShift) this.emit('before update');

  text = normalizeEOL(text);

  isEOL = '\n' === text;

  point = this.lines.getPoint(point);
  lines = this.lines.insert(point, text);
  range = [point.y, point.y + lines];

  shift = !isCtrlShift && (shift || isEOL);

  before = this.get(range);

  this.text.insert(point.offset, text);

  after = this.get(range);

  this.prefix.index(after);
  if (isCtrlShift) range = [Math.max(0, range[0]-1), range[1]];

  //TODO: i think shift should be 'lines'
  this.emit('update', range, shift, before, after);

  // this is to update caret position
  return text.length;
};

Buffer.prototype.deleteCharAt = function(point) {
  var isEOL, range, before, after;

  this.changes++;

  this.emit('before update');

  point = this.lines.getPoint(point);
  isEOL = this.lines.removeCharAt(point);
  range = [point.y, point.y + isEOL];

  before = this.get(range);

  this.text.removeCharAt(point.offset);

  after = this.get(range);

  this.prefix.index(after);

  this.emit('update', range, -isEOL, before);
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
  var range, offsets, lines;

  this.changes++;

  this.emit('before update');

  offsets = this.lines.getAreaOffsetRange(area);
  lines = this.lines.removeArea(area);
  range = [area.begin.y, area.end.y];

  this.text.remove(offsets);

  if (!noUpdate) {
    this.emit('update', range);
  }
};

Buffer.prototype.getArea = function(area) {
  var offsets = this.lines.getAreaOffsetRange(area);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.moveAreaByLines = function(y, area) {
  if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
  if (area.begin.y + y < 0 || area.end.y + y > this.loc) return false;

  area.begin.x = 0;
  area.end.x = 0;

  var text = this.get([area.begin.y, area.end.y-1]);
  this.deleteArea(area, true);

  this.insert({ x:0, y:area.begin.y + y }, text, y, true);

  return true;
};

function normalizeEOL(s) {
  return s.replace(exports.EOL, '\n');
}
