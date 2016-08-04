var dom = require('dom');
var Events = require('events');
var Point = require('point');
var Range = require('range');
var Box = require('box');

var template = require('src/template')
var syntax = require('src/syntax');
var Input = require('src/input');
var File = require('src/file');
var View = require('src/view');

module.exports = Xoor;

function Xoor() {
  this.layout = {
    scroll: new Point,
    offset: new Point,
    size: new Box,
    char: new Box,

    page: new Box,
    pagePoint: new Point,
    pageRemainder: new Box,
    pageBounds: new Range,

    gutter: new Box,
    gutterMargin: 15,

    caret: new Point,
  };

  this.file = new File;

  this.node = document.createDocumentFragment();
  this.code = new View(this, 'code', template.code);
  this.rows = new View(this, 'rows', template.rows);
  this.input = new Input(this);
  dom.append(this, [this.code, this.rows, this.input.text]);

  this.bindEvents();
}

Xoor.prototype.__proto__ = Events.prototype;

Xoor.prototype.bindEvents = function() {
  this.file.on('open', this.repaint.bind(this));
  this.file.on('change', this.render.bind(this));
  this.input.on('input', this.insert.bind(this));
};

Xoor.prototype.use = function(node) {
  node.appendChild(this.node);
  this.node = node;
  this.resize();
};

Xoor.prototype.open = function(path, fn) {
  this.file.open(path, fn);
};

Xoor.prototype.focus = function() {
  this.input.focus();
};

Xoor.prototype.insert = function(text) {
  var _ = this.layout;
  this.file.buffer.insert(_.caret, text);
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
  _.page.set(_.size.grid(_.char));
  _.pagePoint.set(_.scroll.grid(_.char));
  _.pageRemainder.set(_.size['-'](_.page['*'](_.char)));
  _.pageBounds = [0, this.file.buffer.loc];
  _.gutter = (''+this.file.buffer.loc).length * _.char.width;

  dom.css(''
  + '.editor > .code {'
  + '  padding-left: ' + (_.gutter + _.gutterMargin) + 'px;'
  + '}'
  + '.editor > .rows {'
  + '  padding-right: ' + (_.gutterMargin) + 'px;'
  + '  width: ' + (_.gutter + _.gutterMargin) + 'px;'
  + '}'
  );

  this.emit('resize');
};

Xoor.prototype.render = function() {
  var _ = this.layout;

  this.code.render(_.pageBounds);
  this.rows.render(_.pageBounds);
};
