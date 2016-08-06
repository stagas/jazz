var dom = require('dom');
var diff = require('diff');
var throttle = require('throttle');
var atomic = require('atomic');
var Events = require('events');
var Point = require('point');
var Range = require('range');
var Area = require('area');
var Box = require('box');

var template = require('./src/template');
var syntax = require('./src/syntax');
var Input = require('./src/input');
var File = require('./src/file');
var Move = require('./src/move');
var View = require('./src/view');
var Code = require('./src/code');
var Mark = require('./src/mark');
var Rows = require('./src/rows');

module.exports = Xoor;

function Xoor(options) {
  Events.call(this);

  this.options = options || {};
  this.options.debug = this.options.debug || {};

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
    mark: new Area,

    editLine: -1,
    editShift: 0,

    animationFrame: -1,
    animationRunning: false,
    animationScrollTarget: null,
  };

  this.file = new File;
  this.move = new Move(this);

  this.file.buffer.mark = this.layout.mark;

  this.node = document.createDocumentFragment();
  this.gutter = new View('gutter', this, template.gutter);
  this.caret = new View('caret', this, template.caret);
  this.code = new Code('code', this, template.code);
  this.mark = new Mark('mark', this, template.mark);
  this.rows = new Rows('rows', this, template.rows);
  this.input = new Input(this);

  dom.append(this.node, [
    this.gutter,
    this.caret,
    this.code,
    this.mark,
    this.rows,
  ]);

  dom.append(this.caret, this.input.text);

  this.bindMethods();
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

Xoor.prototype.bindMethods = function() {
  this.animationScrollFrame = this.animationScrollFrame.bind(this);
  this.markSet = this.markSet.bind(this);
  this.markClear = this.markClear.bind(this);
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
  this.input.on('keys', this.onKeys);
  this.input.on('key', this.onKey);
  this.input.on('text', this.onText);
  this.input.on('input', this.onInput);
  this.input.on('mouseup', this.onMouseUp);
  this.input.on('mousedown', this.onMouseDown);
  this.input.on('mouseclick', this.onMouseClick);
  this.input.on('mousedragbegin', this.onMouseDragBegin);
  this.input.on('mousedrag', this.onMouseDrag);
};

Xoor.prototype.onScroll = function(scroll) {
  if (scroll.y !== this.layout.scroll.y) {
    this.layout.scroll.set(scroll);
    this.render();
  }
};

Xoor.prototype.onInput = function(text) {
  this.render();
};

Xoor.prototype.onText = function(text) {
  this.insert(text);
};

Xoor.prototype.onKeys = function(keys, e) {
  if (!(keys in this.bindings)) return;
  e.preventDefault();
  this.bindings[keys].call(this, e);
};

Xoor.prototype.onKey = function(key, e) {
  if (!(key in this.bindings.single)) return;
  this.bindings.single[key].call(this, e);
};

Xoor.prototype.onFileOpen = function() {
  this.move.beginOfFile();
  this.repaint();
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

Xoor.prototype.setCaretFromPx = function(px) {
  var _ = this.layout;
  var g = new Point({ x: _.gutter, y: _.char.height/2 });
  var p = px['-'](g)['+'](_.scroll)['o/'](_.char);
  p.x = Math.min(p.x, this.getLineLength(p.y));
  _.caret.set(p);
  return p;
};

Xoor.prototype.onMouseUp = function() {
  this.markEnd();
  this.focus();
};

Xoor.prototype.onMouseDown = function() {
  if (this.input.text.modifiers.shift) {
    this.markBegin();
  }
  this.setCaretFromPx(this.input.mouse.point);
  this.onMove();
};

Xoor.prototype.onMouseClick = function() {
  var clicks = this.input.mouse.clicks;
  if (clicks > 1) {
    var area;

    if (clicks === 2) {
      area = this.file.buffer.wordAt(this.layout.caret);
    } else if (clicks === 3) {
      var y = this.layout.caret.y;
      area = new Area({
        begin: { x: 0, y: y },
        end: { x: this.getLineLength(y), y: y }
      });
    }

    if (area) {
      this.layout.caret.set(area.end);
      this.markSetArea(area);
      this.render();
    }
  }
};

Xoor.prototype.onMouseDragBegin = function() {
  console.log('drag begin')
  this.setCaretFromPx(this.input.mouse.down);
  this.markBegin();
};

Xoor.prototype.onMouseDrag = function() {
  this.setCaretFromPx(this.input.mouse.point);
  this.onMove();
  this.markSet();
};

Xoor.prototype.onMove = function(point) {
  if (point) this.layout.caret.set(point);
  this.followCaret();
  this.emit('move');
  this.render();
};

Xoor.prototype.markBegin = function(area) {
  if (!this.layout.mark.active) {
    this.layout.mark.active = true;
    if (!area) {
      this.layout.mark.begin.set(this.layout.caret);
      this.layout.mark.end.set(this.layout.caret);
    } else {
      this.layout.mark.set(area);
    }
    this.off('move', this.markSet);
    this.on('move', this.markSet);
    // console.log('mark begin')
  } else {
    this.off('move', this.markClear);
  }
};

Xoor.prototype.markSet = function() {
  this.layout.mark.end.set(this.layout.caret);
};

Xoor.prototype.markSetArea = function(area) {
  this.markBegin(area);
  this.render();
  this.markEnd();
};

Xoor.prototype.markEnd = function() {
  this.on('move', this.markClear);
};

Xoor.prototype.markClear = function() {
  this.off('move', this.markClear);
  this.off('move', this.markSet);
  this.layout.mark.active = false;
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
  var p = (_.animationScrollTarget || _.scroll)['/'](_.char);
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
  var s = _.animationScrollTarget || _.scroll; //getScroll();
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

Xoor.prototype.animateScrollVertical = function(y) {
  var _ = this.layout;

  if (!_.animationRunning) {
    _.animationRunning = true;
  } else {
    window.cancelAnimationFrame(_.animationFrame);
  }

  _.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  var s = _.animationScrollTarget || _.scroll;

  _.animationScrollTarget = new Point({
    // x: Math.max(0, s.x + x),
    x: 0,
    y: Math.max(0, s.y + y)
  });
};

Xoor.prototype.animationScrollFrame = function() {
  var _ = this.layout;

  window.cancelAnimationFrame(_.animationFrame);

  var speed = 0.29;
  var s = _.scroll;
  var t = _.animationScrollTarget;

  // var dx = t.x - s.x;
  var dy = t.y - s.y;

  if (/*dx === 0 && */dy === 0) {
    _.animationRunning = false;
    _.animationScrollTarget = null;
    this.emit('animation end');
    // console.log('anim end')
    return;
  }

  _.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  // dx *= speed;
  dy *= speed;

  // dx = dx > 0 ? Math.ceil(dx) : Math.floor(dx);
  dy = dy > 0 ? Math.ceil(dy) : Math.floor(dy);

  this.scrollVertical(dy);
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
  + '.editor > .mark,'
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
  this.mark.render();
  this.code.render();
  this.rows.render();
  this.clearEdit();
  this.emit('render');
});
