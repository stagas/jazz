var parse = require('parse');
var Area = require('area');
var Events = require('events');
var Lines = require('./lines');
var Segments = require('./segments');
var SkipString = require('./skipstring');

exports = module.exports = Buffer;

var EOL = exports.EOL = /\r\n|\r|\n/g;
var N = exports.N = /\n/g;
var CHUNK_SIZE = exports.CHUNK_SIZE = 30;

function Buffer(scene) {
  Events.call(this);

  this.scene = scene;
  this.text = new SkipString;
  this.lines = new Lines;
  this.segments = new Segments;
  this.point = { x:0, y:0, offset: 0 };
}

Buffer.prototype = {
  get loc() {
    return this.lines.length;
  }
};

Buffer.prototype.__proto__ = Events.prototype;

Buffer.prototype.get = function(lines) {
  if (!lines) return this.text.getRange();
  var range = this.lines.getRange(lines);
  var text = this.text.getRange(range);
  return text;
};

Buffer.prototype.getLine = function(y) {
  return this.get([y,y]);
};

Buffer.prototype.set = function(text) {
  text = this.normalizeEndLines(text);
  this.lines = new Lines;
  this.text = new SkipString;

  console.time('segment index');
  this.segments.set(text);
  console.timeEnd('segment index');

  this.lines.insert({ x:0, y:0 }, text);
  this.text.insertChunked(0, text, exports.CHUNK_SIZE);

  this.emit('set');
};

Buffer.prototype.insert = function(point, text) {
  text = this.normalizeEndLines(text);
  // if ('\n' == text) this.emit('shift', +1);
  var isEOL = '\n' === text;
  this.point = this.lines.getPoint(point);
  this.lines.insert(this.point, text);
  this.text.insert(this.point.offset, text);
  this.emit('update', this.point.y, +isEOL);
};

Buffer.prototype.deleteCharAt = function(point) {
  this.point = this.lines.getPoint(point);
  var isEOL = this.lines.removeCharAt(this.point);
  // if (isEOL) this.emit('shift', -1);
  this.text.removeCharAt(this.point.offset);
  this.emit('update', this.point.y, -isEOL);
};

Buffer.prototype.wordAt = function(point) {
  this.point = this.lines.getPoint(point);
  var text = this.text.getRange(this.point.line.range);
  var words = parse.tokens(text);
  var lastIndex = 0;
  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (word.index > this.point.x) {
      return new Area({
        begin: { x: lastIndex, y: this.point.y },
        end: { x: word.index, y: this.point.y }
      });
    }
    lastIndex = word.index;
  }
};

/*
Buffer.prototype.getAreaText = function(area) {
  var range = this.lines.getArea(area);
  var text = this.text.getRange(range);
  return text;
};

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

Buffer.prototype.deleteArea = function(area) {
  var range = this.lines.getArea(area);
  this.lines.removeArea(area);
  this.text.remove(range);
};
*/
Buffer.prototype.normalizeEndLines = function(s) {
  return s.replace(exports.EOL, '\n');
};
