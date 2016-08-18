var Event = require('event');
var debounce = require('debounce');
var Point = require('point');

module.exports = Mouse;

function Mouse() {
  Event.call(this);

  this.node = null;
  this.clicks = 0;
  this.point = new Point;
  this.down = null;
  this.bindEvent();
}

Mouse.prototype.__proto__ = Event.prototype;

Mouse.prototype.bindEvent = function() {
  this.onmaybedrag = this.onmaybedrag.bind(this);
  this.ondrag = this.ondrag.bind(this);
  this.ondown = this.ondown.bind(this);
  this.onup = this.onup.bind(this);
  document.body.addEventListener('mouseup', this.onup);
};

Mouse.prototype.use = function(node) {
  if (this.node) {
    node.removeEventListener('mousedown', this.ondown);
  }
  this.node = node;
  this.node.addEventListener('mousedown', this.ondown);
};

Mouse.prototype.ondown = function(e) {
  this.point = this.down = this.getPoint(e);
  this.emit('down', e);
  this.onclick(e);
  this.maybeDrag();
};

Mouse.prototype.onup = function(e) {
  if (!this.down) return;
  this.emit('up', e);
  this.down = null;
  this.dragEnd();
  this.maybeDragEnd();
};

Mouse.prototype.onclick = function(e) {
  this.resetClicks();
  this.clicks = (this.clicks % 3) + 1;
  this.emit('click', e);
};

Mouse.prototype.onmaybedrag = function(e) {
  this.point = this.getPoint(e);

  var d =
      Math.abs(this.point.x - this.down.x)
    + Math.abs(this.point.y - this.down.y);

  if (d > 5) {
    this.maybeDragEnd();
    this.dragBegin();
  }
};

Mouse.prototype.ondrag = function(e) {
  this.point = this.getPoint(e);
  this.emit('drag', e);
};

Mouse.prototype.maybeDrag = function() {
  this.node.addEventListener('mousemove', this.onmaybedrag);
};

Mouse.prototype.maybeDragEnd = function() {
  this.node.removeEventListener('mousemove', this.onmaybedrag);
};

Mouse.prototype.dragBegin = function() {
  this.node.addEventListener('mousemove', this.ondrag);
  this.emit('drag begin');
};

Mouse.prototype.dragEnd = function() {
  this.node.removeEventListener('mousemove', this.ondrag);
  this.emit('drag end');
};


Mouse.prototype.resetClicks = debounce(function() {
  this.clicks = 0;
}, 350);

Mouse.prototype.getPoint = function(e) {
  return new Point({
    x: e.clientX,
    y: e.clientY
  });
};
