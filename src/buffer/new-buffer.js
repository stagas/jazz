var Point = require('../../lib/point');
var Event = require('../../lib/event');

var SkipString = require('./skipstring');
var Segments = require('./segments');
var Tokens = require('./tokens');
var Syntax = require('./syntax');

var EOL = /\r\n|\r|\n/g;

module.exports = Buffer;

function Buffer() {
  this.syntax = new Syntax;
  this.segments = new Segments(this);
  this.setText('');
}

Buffer.prototype.__proto__ = Event.prototype;

var SEGMENT = {
  'comment': '/*',
  'string': '`',
};

var SEGMENT_END = {
  'comment': '*/',
  'string': '`',
};

Buffer.prototype.get = function(range) {
  var code = this.getLineRangeText(range);
  // console.time('segment get')
  var segment = this.segments.get(range[0]);
  // console.timeEnd('segment get')
  if (segment) {
    code = SEGMENT[segment] + '\uffba' + code + '\uffbe' + SEGMENT_END[segment];
    code = this.syntax.highlight(code);
    code = '<' + segment + '>' +
      code.substring(
        code.indexOf('\uffba') + 1,
        code.lastIndexOf('\uffbe')
      );
  } else {
    code = this.syntax.highlight(code + '\uffbe*/`');
    code = code.substring(
      0,
      code.lastIndexOf('\uffbe')
    );
  }
  return code;
};

Buffer.prototype.setText = function(text) {
  text = normalizeEOL(text);

  this.raw = text;

  this.syntax.tab = ~this.raw.indexOf('\t') ? '\t' : ' ';

  this.text = new SkipString;
  this.text.set(this.raw);

  this.tokens = new Tokens;
  this.tokens.index(this.raw);

  // this.emit('raw', this.raw);
  this.emit('set');
};

Buffer.prototype.getLineRangeText = function(range) {
  var offsets = this.getLineRangeOffsets(range);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.getOffsetRangeText = function(offsetRange) {
  var text = this.text.getRange(offsetRange);
  return text;
};

Buffer.prototype.charAt = function(offset) {
  var char = this.text.getRange([offset, offset + 1]);
  return char;
};

Buffer.prototype.getOffsetLineText = function(offset) {
  return {
    line: line,
    text: text,
  }
};

Buffer.prototype.toString = function() {
  return this.text.toString();
};

Buffer.prototype.getLineText = function(y) {
  var text = this.getLineRangeText([y,y]);
  return text;
};

Buffer.prototype.getAreaText = function(area) {
  return text;
};

Buffer.prototype.insertTextAtPoint = function(point, text) {
  return text.length;
};

Buffer.prototype.removeCharAtPoint = function(point) {

};

Buffer.prototype.wordAreaAtPoint = function(point, inclusive) {
  return area;
};

Buffer.prototype.removeArea = function(area) {

};

Buffer.prototype.moveAreaByLines = function(y, area) {

};


Buffer.prototype.getLineRangeOffsets = function(range) {
  var a = this.getLineOffset(range[0] - 1) + 1;
  var b = range[1] >= this.loc()
    ? this.text.length
    : this.getLineOffset(range[1]);
  var offsets = [a, b];
  return offsets;
};

Buffer.prototype.getAreaOffsetRange = function(area) {
  return range;
};

Buffer.prototype.getLineOffset = function(y) {
  var offset = y < 0 ? -1 : this.tokens.getByIndex('lines', y);
  return offset;
};

Buffer.prototype.getPointLine = function(point) {
  return line;
};

Buffer.prototype.getOffsetLine = function(offset) {
  return line;
};

Buffer.prototype.getOffsetPoint = function(offset) {
  var token = this.tokens.getByOffset('lines', offset);
  var point = new Point({
    x: offset - token.offset,
    y: token.index
  });
  return point;
};

Buffer.prototype.loc = function() {
  return this.tokens.getCollection('lines').length;
};

Buffer.prototype.getLine = function(y) {
  var line = new Line;
  line.offsetRange = this.getLineRangeOffsets([y,y]);
  line.offset = line.offsetRange[0];
  line.length = line.offsetRange[1] - line.offsetRange[0];
  line.point.set({ x:0, y:y });
  return line;
};

function Line() {
  this.offsetRange = [];
  this.offset = 0;
  this.length = 0;
  this.point = new Point;
}

function normalizeEOL(s) {
  return s.replace(EOL, '\n');
}
