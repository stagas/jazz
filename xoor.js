var dom = require('dom');
var load = require('load');
var Point = require('point');
var Range = require('range');
var Box = require('box');
var Events = require('events');
var Buffer = require('src/buffer');
var syntax = require('src/syntax');

module.exports = Xoor;

function Xoor() {
  this.node = document.createDocumentFragment();

  this.code = dom('code');

  dom.append(this.node, this.code);

  this.layout = {
    scroll: new Point,
    offset: new Point,
    point: new Point,
    size: new Box,
    page: new Box,
    char: new Box,
    gutter: new Box,
    remainder: new Box,
    bounds: new Range,
  };

  this.buffer = new Buffer;

  this.bindEvents();
}

Xoor.prototype.__proto__ = Events.prototype;

Xoor.prototype.bindEvents = function() {
  this.buffer.on('set', this.render.bind(this));
};

Xoor.prototype.appendTo = function(node) {
  node.appendChild(this.node);
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
  var code = this.buffer.get();
  var html = syntax.highlight(code);
  dom.style(this.code, { top: 0 });
  dom.html(this.code, html);
};
