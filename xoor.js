var dom = require('dom');
var load = require('load');
var Events = require('events');
var Point = require('point');
var Range = require('range');
var Box = require('box');

var template = require('src/template')
var syntax = require('src/syntax');
var Buffer = require('src/buffer');
var View = require('src/view')

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
  };

  this.buffer = new Buffer;

  this.node = document.createDocumentFragment();
  this.code = new View(this, 'code', template.code);
  this.rows = new View(this, 'rows', template.rows);
  dom.append(this.node, [this.code, this.rows]);

  this.bindEvents();
}

Xoor.prototype.__proto__ = Events.prototype;

Xoor.prototype.bindEvents = function() {
  this.buffer.on('set', this.resize.bind(this));
  this.buffer.on('set', this.render.bind(this));
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
  _.pageBounds = [0, this.buffer.loc];
  _.gutter = (''+this.buffer.loc).length * _.char.width;

  dom.css(
    '.editor .code {'
  + '  padding-left: ' + (_.gutter + _.gutterMargin) + 'px;'
  + '}'
  + '.editor .rows {'
  + '  padding-right: ' + (_.gutterMargin) + 'px;'
  + '  width: ' + (_.gutter + _.gutterMargin) + 'px;'
  + '}'
  );

  this.emit('resize');
};

Xoor.prototype.use = function(node) {
  node.appendChild(this.node);
  this.node = node;
  this.resize();
};

Xoor.prototype.open = function(path, fn) {
  var buffer = this.buffer;

  load(path, (err, text) => {
    if (err) {
      this.emit('error', err);
      return fn(err);
    }
    buffer.set(text);
    this.emit('load', path, buffer);
    fn(null, buffer);
  });
};

Xoor.prototype.focus = function() {
  //this.input.focus();
};

Xoor.prototype.render = function() {
  var _ = this.layout;

  this.code.render(_.pageBounds);
  this.rows.render(_.pageBounds);
};
