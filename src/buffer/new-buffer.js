var Point = require('../../lib/point');

var SkipString = require('./skipstring');
var Tokens = require('./tokens');

var EOL = /\r\n|\r|\n/g;

module.exports = Buffer;

function Buffer() {
  this.setText('');
}

Buffer.prototype.setText = function(text) {
  text = normalizeEOL(text);

  this.raw = text;

  this.text = new SkipString;
  this.text.set(this.raw);

  this.tokens = new Tokens;
  this.tokens.index(this.raw);
};

Buffer.prototype.getLineRangeText = function(range) {
  var offsets = this.getLineRangeOffsets(range);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.getOffsetRangeText = function(offsetRange) {
  return text;
};

Buffer.prototype.getOffsetLineText = function(offset) {
  return {
    line: line,
    text: text,
  }
};

Buffer.prototype.getLineText = function(y) {
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
