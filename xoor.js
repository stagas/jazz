var dom = require('dom');
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
    pagePoint: new Point,
    pageRemainder: new Box,
    pageBounds: new Range,

    gutter: new Box,
    gutterMargin: 15,

    caret: new Point({ x: -1, y: -1 }),
    code: 0,
    rows: 0,
  };

  this.file = new File;
  this.move = new Move(this);

  this.node = document.createDocumentFragment();
  this.caret = new View('caret', this, template.caret);
  this.code = new View('code', this, template.code);
  this.rows = new View('rows', this, template.rows);
  this.input = new Input(this);

  dom.append(this.node, [
    this.code,
    this.rows,
    this.caret,
    this.input.text,
  ]);

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
  this.input.on('input', this.onInput);
  this.input.on('click', this.onClick);
};

Xoor.prototype.onMove = function() {
  this.render.hold();
  this.followCaret();
  this.render();
  window.requestAnimationFrame(() => {
    this.render.release(this);
  });
};

Xoor.prototype.onScroll = function(scroll) {
  this.layout.scroll.set(scroll);
  this.render();
  this.render.release(this);
};

Xoor.prototype.onKey = function(key, e) {
  if (!(key in this.bindings)) return;
  e.preventDefault();
  this.bindings[key].call(this, e);
};

Xoor.prototype.onInput = function(text) {
  this.render.hold();
  this.insert(text);
  this.render.release(this);
};

Xoor.prototype.onClick = function(text) {
  this.focus();
};

Xoor.prototype.onFileOpen = function() {
  this.render.hold();
  this.repaint();
  this.move.beginOfFile();
  this.render.release(this);
};

Xoor.prototype.onFileChange = function() {
  this.layout.rows = this.file.buffer.loc;
  this.layout.code = this.file.buffer.text.length;
  this.render();
};

Xoor.prototype.open = function(path, fn) {
  this.file.open(path, fn);
};

Xoor.prototype.focus = function() {
  this.input.focus();
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
  if (bottom > 0 || top > 0) {
    this.render.hold();
    this.render();
  }
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
  // stage();
    this.file.buffer.insert(this.layout.caret, text);
    this.move.byChars(+1);
  // commit();
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
  _.page.set(_.size.grid(_.char));
  _.pagePoint.set(_.scroll.grid(_.char));
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
  var _ = this.layout;
  this.code.render(_.pageBounds);
  this.rows.render(_.pageBounds);
  this.caret.render();
  this.emit('render');
});

function atomic(fn) {
  var stage = false;
  var n = 0;

  function wrap() {
    if (stage) return n++;
    else fn.call(this);
  }

  wrap.hold = function() {
    stage = true;
    n = n || 0;
  };

  wrap.release = function(context) {
    if (stage && n) {
      stage = false;
      n = 0;
      fn.call(context);
    }
  };

  return wrap;
}
