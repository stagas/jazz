
var debounce = require('debounce');
var events = require('events');
var point = require('point');

module.exports = Mouse;

function Mouse(input) {
  this.editor = input.editor;
  this.clicks = 0;
  this.point = point();
  this.down = point();
  this.events = events();
  this.bindEvents();
}

Mouse.prototype.bindEvents = function() {
  this.ondrag = this.ondrag.bind(this);
  this.ondown = this.ondown.bind(this);
  this.onup = this.onup.bind(this);
  this.editor.node.onmousedown = this.ondown;
  document.body.addEventListener('mouseup', this.onup);
};

Mouse.prototype.ondown = function(e) {
  this.point = this.down = this.getPoint(e);
  this.events.emit('down', e);
  this.onclick(e);
  this.beginDrag();
};

Mouse.prototype.onup = function(e) {
  if (!this.down) return;
  this.events.emit('up', e);
  this.down = null;
  this.endDrag();
};

Mouse.prototype.onclick = function(e) {
  this.resetClicks();
  this.clicks = (this.clicks % 3) + 1;
  this.events.emit('click', e);
};

Mouse.prototype.ondrag = function(e) {
  this.point = this.getPoint(e);
  this.events.emit('drag', e);
};

Mouse.prototype.beginDrag = function() {
  this.scene.el.addEventListener('mousemove', this.ondrag);
};

Mouse.prototype.endDrag = function() {
  this.scene.el.removeEventListener('mousemove', this.ondrag);
};

Mouse.prototype.resetClicks = debounce(function() {
  this.clicks = 0;
}, 300);

/*Mouse.prototype.getPoint = function(e) {
  return {
    x: Math.round((e.pageX - this.display.gutter.width) / this.display.char.width),
    y: Math.floor(e.pageY / this.display.char.height)
  };
};*/

//TODO: this doesn't belong here
Mouse.prototype.getPoint = function(e) {
  var l = this.scene.layout;
  var p = point.gridRound(
    l.char,
    point.low({ x: 0, y: 0 }, {
      x: e.clientX - l.gutter.width - 30 - l.offset.x + l.scroll.x,
      y: e.clientY - l.offset.y + l.scroll.y - l.char.height / 2
    })
  );
  p.x = Math.min(this.scene.buffer.lines.getLineLength(p.y), p.x);
  return p;
};
