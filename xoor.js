var dom = require('dom');
var diff = require('diff');
var atomic = require('atomic');
var Events = require('events');
var Point = require('point');
var Range = require('range');
var Box = require('box');

var template = require('./src/template')
var syntax = require('./src/syntax');
var Input = require('./src/input');
var File = require('./src/file');
var Move = require('./src/move');
var View = require('./src/view');
var Code = require('./src/code')
var Edit = require('./src/edit')
var Rows = require('./src/rows')

module.exports = Xoor;

function Xoor() {
  Events.call(this);

  this.bindings = {};

  this.layout = {
    scroll: new Point,
    offset: new Point,
    size: new Box,
    char: new Box,

    page: new Box,
    pageRemainder: new Box,
    pageBounds: new Range,

    gutter: 0,
    gutterMargin: 15,

    caret: new Point({ x: -1, y: -1 }),
    code: 0,
    rows: 0,

    editLine: -1,
    editShift: 0,
  };

  this.file = new File;
  this.move = new Move(this);

  this.node = document.createDocumentFragment();
  this.gutter = new View('gutter', this, template.gutter);
  this.caret = new View('caret', this, template.caret);
  this.code = new Code('code', this, template.code);
  this.rows = new Rows('rows', this, template.rows);
  this.input = new Input(this);

  dom.append(this.node, [
    this.gutter,
    this.caret,
    this.code,
    this.rows,
  ]);

  dom.append(this.caret, this.input.text);

  this.bindEvents();
}

Xoor.prototype.__proto__ = Events.prototype;

Xoor.prototype.use = function(node) {
  node.appendChild(this.node);
  this.node = node;

  dom.onscroll(this.node, this.onScroll);

  this.input.use(node);
  this.resize();
};

Xoor.prototype.assign = function(bindings) {
  this.bindings = bindings;
};

Xoor.prototype.bindHandlers = function() {
  for (var method in this) {
    if ('on' === method.slice(0, 2)) {
      this[method] = this[method].bind(this);
    }
  }
};

Xoor.prototype.bindEvents = function() {
  this.bindHandlers()

  this.move.on('move', this.onMove);
  this.file.on('open', this.onFileOpen);
  this.file.on('change', this.onFileChange);
  this.input.on('key', this.onKey);
  this.input.on('text', this.onText);
  this.input.on('input', this.onInput);
  this.input.on('click', this.onClick);
};

Xoor.prototype.onMove = function() {
  this.followCaret();
  this.render();
};

Xoor.prototype.onScroll = function(scroll) {
  if (scroll.y !== this.layout.scroll.y) {
    // console.log('scroll');
    this.layout.scroll.set(scroll);
    this.render();
  }

  // this.layout.editLine = -1;
  // this.layout.editShift = 0;

    // this.layout.editLine = -1;
    // this.layout.editShift = 0;
  // this.render.release(this);
  // });
  // this.render.release(this);
};

Xoor.prototype.onInput = function(text) {
  this.render();
  // window.requestAnimationFrame(() => this.render.release(this));
};

Xoor.prototype.onText = function(text) {
  this.insert(text);
};

Xoor.prototype.onKey = function(key, e) {
  if (!(key in this.bindings)) return;
  e.preventDefault();
  this.bindings[key].call(this, e);
};

Xoor.prototype.onClick = function(text) {
  this.focus();
};

Xoor.prototype.onFileOpen = function() {
  this.repaint();
  this.move.beginOfFile();

  this.render();
};

Xoor.prototype.onFileChange = function(editLine, editShift) {
  var _ = this.layout;

  _.rows = this.file.buffer.loc;
  _.code = this.file.buffer.text.length;
  _.pageBounds = [0, _.rows];
  _.editLine = editLine;
  _.editShift = editShift;

  this.render();
};

Xoor.prototype.clearEdit = function() {
  this.layout.editLine = -1;
  this.layout.editShift = 0;
};

Xoor.prototype.open = function(path, fn) {
  this.file.open(path, fn);
};

Xoor.prototype.focus = function() {
  this.input.focus();
};

Xoor.prototype.getRange = function(range) {
  return Range.clamp(range, this.layout.pageBounds);
};

Xoor.prototype.getPageRange = function(range) {
  var _ = this.layout;
  var p = _.scroll['/'](_.char);
  return this.getRange([
    Math.floor(p.y + _.page.height * range[0]),
    Math.ceil(p.y + _.page.height + _.page.height * range[1])
  ]);
};

Xoor.prototype.getLineLength = function(y) {
  return this.file.buffer.lines.getLineLength(y);
};

Xoor.prototype.followCaret = function(center) {
  var _ = this.layout;
  center = center ? _.size.height / 2 | 0 : 0;
  var p = _.caret['*'](_.char);
  var s = _.scroll; //getScroll();
  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + _.size.height) + _.char.height;
  if (bottom > 0) this.scrollVertical(bottom + center);
  else if (top > 0) this.scrollVertical(-top - center);
  if (bottom > 0 || top > 0) this.render();
};

Xoor.prototype.scrollTo = function(p) {
  // this.scroll.set(p);
  dom.scrollTo(this.node, p.x, p.y);
};

Xoor.prototype.scrollVertical = function(y) {
  this.layout.scroll.y += y;
  this.scrollTo(this.layout.scroll);
};

Xoor.prototype.insert = function(text) {
  this.file.buffer.insert(this.layout.caret, text);
  this.move.byChars(+1);
};

Xoor.prototype.backspace = function() {
  if (this.move.isBeginOfFile()) return;
  this.move.byChars(-1);
  this.file.buffer.deleteCharAt(this.layout.caret);
};

Xoor.prototype.delete = function() {
  if (this.move.isEndOfFile()) return;
  this.file.buffer.deleteCharAt(this.layout.caret);
};

Xoor.prototype.repaint = function() {
  this.resize();
  this.render();
};

Xoor.prototype.resize = function() {
  var $ = this.node;
  var _ = this.layout;

  _.offset.set(dom.getOffset($));
  _.scroll.set(dom.getScroll($));
  _.size.set(dom.getSize($));
  _.char.set(dom.getCharSize($));
  _.rows = this.file.buffer.loc;
  _.code = this.file.buffer.text.length;
  _.page.set(_.size['^/'](_.char));
  _.pageRemainder.set(_.size['-'](_.page['*'](_.char)));
  _.pageBounds = [0, _.rows];
  _.gutter = (''+_.rows).length * _.char.width + _.gutterMargin;

  dom.style(this.caret, {
    height: _.char.height
  });

  dom.css(''
  + '.editor > .code {'
  + '  padding-left: ' + _.gutter + 'px;'
  + '}'
  + '.editor > .rows {'
  + '  padding-right: ' + _.gutterMargin + 'px;'
  + '  width: ' + _.gutter + 'px;'
  + '}'
  );

  this.emit('resize');
};

Xoor.prototype.render = atomic(function() {
  // console.log('render')
  this.gutter.render();
  this.caret.render();
  this.code.render();
  this.rows.render();
  this.clearEdit();
  this.emit('render');
});
