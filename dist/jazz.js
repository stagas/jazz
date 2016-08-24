(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Jazz
 */

var DefaultOptions = {
  theme: 'western',
  debug_layers: false,
  scroll_speed: 75,
  hide_rows: false,
  center: false,
  margin_left: 15,
  gutter_margin: 20,
};

require('./lib/set-immediate');
var dom = require('./lib/dom');
var diff = require('./lib/diff');
var merge = require('./lib/merge');
var clone = require('./lib/clone');
var debounce = require('./lib/debounce');
var throttle = require('./lib/throttle');
var atomic = require('./lib/atomic');
var Event = require('./lib/event');
var Dialog = require('./lib/dialog');
var Point = require('./lib/point');
var Range = require('./lib/range');
var Area = require('./lib/area');
var Box = require('./lib/box');

var DefaultBindings = require('./src/input/bindings');
var History = require('./src/history');
var Input = require('./src/input');
var File = require('./src/file');
var Move = require('./src/move');
var Text = require('./src/input/text');
var Views = require('./src/views');
var theme = require('./src/theme');
var css = require('./src/style.css');

module.exports = Jazz;

function Jazz(options) {
  this.options = merge(clone(DefaultOptions), options || {});

  Object.assign(this, {
    el: document.createDocumentFragment(),

    id: 'jazz_' + (Math.random() * 10e6 | 0).toString(36),
    file: new File,
    move: new Move(this),
    views: new Views(this),
    input: new Input(this),
    history: new History(this),

    bindings: { single: {} },

    find: new Dialog('Find', Text.map),
    findValue: '',
    findNeedle: 0,
    findResults: [],

    scroll: new Point,
    offset: new Point,
    size: new Box,
    char: new Box,

    page: new Box,
    pagePoint: new Point,
    pageRemainder: new Box,
    pageBounds: new Range,

    longestLine: 0,
    gutter: 0,
    code: 0,
    rows: 0,

    caret: new Point({ x: 0, y: 0 }),
    hasFocus: false,

    mark: new Area({
      begin: new Point({ x: -1, y: -1 }),
      end: new Point({ x: -1, y: -1 })
    }),

    editing: false,
    editLine: -1,
    editRange: [-1,-1],
    editShift: 0,

    suggestIndex: 0,
    suggestRoot: '',
    suggestNodes: [],

    animationFrame: -1,
    animationRunning: false,
    animationScrollTarget: null,
  });

  dom.append(this.views.caret, this.input.text);
  dom.append(this, this.views);

  // useful shortcuts
  this.buffer = this.file.buffer;
  this.buffer.mark = this.mark;
  this.syntax = this.buffer.syntax;

  theme(this.options.theme);

  this.bindMethods();
  this.bindEvent();
}

Jazz.prototype.__proto__ = Event.prototype;

Jazz.prototype.use = function(el, scrollEl) {
  if (this.ref) {
    this.el.removeAttribute('id');
    this.el.classList.remove(css.editor);
    this.el.classList.remove(this.options.theme);
    this.offScroll();
    this.ref.forEach(ref => {
      dom.append(el, ref);
    });
  } else {
    this.ref = [].slice.call(this.el.children);
    dom.append(el, this.el);
    dom.onresize(this.onResize);
  }

  this.el = el;
  this.el.setAttribute('id', this.id);
  this.el.classList.add(css.editor);
  this.el.classList.add(this.options.theme);
  this.offScroll = dom.onscroll(scrollEl || this.el, this.onScroll);
  this.input.use(this.el);

  setTimeout(this.repaint, 0);

  return this;
};

Jazz.prototype.assign = function(bindings) {
  this.bindings = bindings;
  return this;
};

Jazz.prototype.open = function(path, root, fn) {
  this.file.open(path, root, fn);
  return this;
};

Jazz.prototype.save = function(fn) {
  this.file.save(fn);
  return this;
};

Jazz.prototype.set = function(text, path) {
  this.file.set(text);
  this.file.path = path || this.file.path;
  return this;
};

Jazz.prototype.focus = function() {
  setImmediate(this.input.focus);
  return this;
};

Jazz.prototype.blur = function() {
  setImmediate(this.input.blur);
  return this;
};

Jazz.prototype.bindMethods = function() {
  this.animationScrollFrame = this.animationScrollFrame.bind(this);
  this.animationScrollBegin = this.animationScrollBegin.bind(this);
  this.markSet = this.markSet.bind(this);
  this.markClear = this.markClear.bind(this);
  this.repaint = this.repaint.bind(this);
  this.focus = this.focus.bind(this);
};

Jazz.prototype.bindHandlers = function() {
  for (var method in this) {
    if ('on' === method.slice(0, 2)) {
      this[method] = this[method].bind(this);
    }
  }
};

Jazz.prototype.bindEvent = function() {
  this.bindHandlers()
  this.move.on('move', this.onMove);
  this.file.on('raw', this.onFileRaw); //TODO: should not need this event
  this.file.on('set', this.onFileSet);
  this.file.on('open', this.onFileOpen);
  this.file.on('change', this.onFileChange);
  this.file.on('before change', this.onBeforeFileChange);
  this.history.on('change', this.onHistoryChange);
  this.input.on('blur', this.onBlur);
  this.input.on('focus', this.onFocus);
  this.input.on('input', this.onInput);
  this.input.on('text', this.onText);
  this.input.on('keys', this.onKeys);
  this.input.on('key', this.onKey);
  this.input.on('cut', this.onCut);
  this.input.on('copy', this.onCopy);
  this.input.on('paste', this.onPaste);
  this.input.on('mouseup', this.onMouseUp);
  this.input.on('mousedown', this.onMouseDown);
  this.input.on('mouseclick', this.onMouseClick);
  this.input.on('mousedragbegin', this.onMouseDragBegin);
  this.input.on('mousedrag', this.onMouseDrag);
  this.find.on('submit', this.findJump.bind(this, 1));
  this.find.on('value', this.onFindValue);
  this.find.on('key', this.onFindKey);
  this.find.on('open', this.onFindOpen);
  this.find.on('close', this.onFindClose);
};

Jazz.prototype.onScroll = function(scroll) {
  this.editing = false;
  this.scroll.set(scroll);
  this.render();
};

Jazz.prototype.onMove = function(point, byEdit) {
  if (!byEdit) this.editing = false;
  if (point) this.setCaret(point);

  if (!byEdit) {
    if (this.input.text.modifiers.shift || this.input.mouse.down) this.markSet();
    else this.markClear();
  }

  this.emit('move');
  this.render();
};

Jazz.prototype.onResize = function() {
  this.repaint();
};

Jazz.prototype.onFocus = function(text) {
  this.hasFocus = true;
  this.emit('focus');
  this.views.caret.render();
};

Jazz.prototype.onBlur = function(text) {
  this.hasFocus = false;
  setTimeout(() => {
    if (!this.hasFocus) {
      this.emit('blur');
      this.views.caret.render();
    }
  }, 5);
};

Jazz.prototype.onInput = function(text) {
  this.render();
};

Jazz.prototype.onText = function(text) {
  this.suggestRoot = '';
  this.insert(text);
};

Jazz.prototype.onKeys = function(keys, e) {
  if (keys in this.bindings) {
    e.preventDefault();
    this.bindings[keys].call(this, e);
  }
  else if (keys in DefaultBindings) {
    e.preventDefault();
    DefaultBindings[keys].call(this, e);
  }
};

Jazz.prototype.onKey = function(key, e) {
  if (key in this.bindings.single) {
    e.preventDefault();
    this.bindings.single[key].call(this, e);
  }
  else if (key in DefaultBindings.single) {
    e.preventDefault();
    DefaultBindings.single[key].call(this, e);
  }
};

Jazz.prototype.onCut = function(e) {
  if (!this.mark.active) return;
  this.onCopy(e);
  this.delete();
};

Jazz.prototype.onCopy = function(e) {
  if (!this.mark.active) return;
  var area = this.mark.get();
  var text = this.buffer.getArea(area);
  e.clipboardData.setData('text/plain', text);
};

Jazz.prototype.onPaste = function(e) {
  var text = e.clipboardData.getData('text/plain');
  this.insert(text);
};

Jazz.prototype.onFileOpen = function() {
  this.move.beginOfFile();
  this.repaint();
};

Jazz.prototype.onFileRaw = function(raw) {
  this.clear();
  this.render();
};

Jazz.prototype.onFileSet = function() {
  this.setCaret({ x:0, y:0 });
  this.buffer.updateRaw();
  this.followCaret();
  this.repaint();
};

Jazz.prototype.onHistoryChange = function() {
  this.clear();
  this.repaint();
  this.followCaret();
};

Jazz.prototype.onBeforeFileChange = function() {
  this.history.save();
};

Jazz.prototype.onFileChange = function(editRange, editShift, textBefore, textAfter) {
  // console.log('change')
  this.rows = this.buffer.loc;
  this.code = this.buffer.text.length;

  this.editing = true;
  this.editLine = editRange[0];
  this.editRange = editRange;
  this.editShift = editShift;

  this.pageBounds = [0, this.rows];

  if (this.find.isOpen) {
    this.onFindValue(this.findValue, true);
  }

  this.history.save();
  this.render();
  this.emit('change');
};

Jazz.prototype.setCaretFromPx = function(px) {
  var g = new Point({ x: this.marginLeft, y: this.char.height/2 })['+'](this.offset);
  var p = px['-'](g)['+'](this.scroll)['o/'](this.char);

  p.y = Math.max(0, Math.min(p.y, this.buffer.loc));
  p.x = Math.max(0, Math.min(p.x, this.getLineLength(p.y)));

  this.setCaret(p);
  this.move.lastDeliberateX = p.x;
  this.onMove();

  return p;
};

Jazz.prototype.onMouseUp = function() {
  setTimeout(() => {
    if (!this.hasFocus) this.blur();
  }, 5);
};

Jazz.prototype.onMouseDown = function() {
  setTimeout(this.focus.bind(this), 10);
  if (this.input.text.modifiers.shift) this.markBegin();
  else this.markClear();
  this.setCaretFromPx(this.input.mouse.point);
};

Jazz.prototype.setCaret = function(p) {
  this.caret.set(p);
  this.followCaret();
};

Jazz.prototype.onMouseClick = function() {
  var clicks = this.input.mouse.clicks;
  if (clicks > 1) {
    var area;

    if (clicks === 2) {
      area = this.buffer.wordAt(this.caret);
    } else if (clicks === 3) {
      var y = this.caret.y;
      area = new Area({
        begin: { x: 0, y: y },
        end: { x: this.getLineLength(y), y: y }
      });
    }

    if (area) {
      this.setCaret(area.end);
      this.markSetArea(area);
      // this.render();
    }
  }
};

Jazz.prototype.onMouseDragBegin = function() {
  this.markBegin();
  this.setCaretFromPx(this.input.mouse.down);
};

Jazz.prototype.onMouseDrag = function() {
  this.setCaretFromPx(this.input.mouse.point);
};

Jazz.prototype.markBegin = function(area) {
  if (!this.mark.active) {
    this.mark.active = true;
    if (area) {
      this.mark.set(area);
    } else if (area !== false || this.mark.begin.x === -1) {
      this.mark.begin.set(this.caret);
      this.mark.end.set(this.caret);
    }
  }
};

Jazz.prototype.markSet = function() {
  if (this.mark.active) this.mark.end.set(this.caret);
};

Jazz.prototype.markSetArea = function(area) {
  this.markBegin(area);
  this.render();
};

Jazz.prototype.markClear = function(force) {
  if (this.input.text.modifiers.shift && !force) return;

  this.mark.active = false;
  this.mark.set({
    begin: new Point({ x: -1, y: -1 }),
    end: new Point({ x: -1, y: -1 })
  });
};

Jazz.prototype.getRange = function(range) {
  return Range.clamp(range, this.pageBounds);
};

Jazz.prototype.getPageRange = function(range) {
  var p = this.scroll['_/'](this.char);
  return this.getRange([
    Math.floor(p.y + this.page.height * range[0]),
    Math.ceil(p.y + this.page.height + this.page.height * range[1])
  ]);
};

Jazz.prototype.getLineLength = function(y) {
  return this.buffer.lines.getLineLength(y);
};

Jazz.prototype.followCaret = function() {
  var p = this.caret['_*'](this.char);
  var s = this.animationScrollTarget || this.scroll;

  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + this.size.height) + this.char.height;

  var left = (s.x + this.char.width) - p.x;
  var right = (p.x) - (s.x + this.size.width - this.marginLeft) + this.char.width * 2;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  if (!this.animationRunning && !this.find.isOpen)
    this.scrollBy(right - left, bottom - top);
  else
    this.animateScrollBy(right - left, bottom - top);
};

Jazz.prototype.scrollTo = function(p) {
  dom.scrollTo(this.el, p.x, p.y);
};

Jazz.prototype.scrollBy = function(x, y) {
  this.scroll.set(Point.low({
    x: 0,
    y: 0
  }, {
    x: this.scroll.x + x,
    y: this.scroll.y + y
  }));
  this.scrollTo(this.scroll);
};

Jazz.prototype.animateScrollBy = function(x, y) {
  if (!this.animationRunning) {
    this.followCaret();
    this.animationRunning = true;
    this.animationFrame = window.requestAnimationFrame(this.animationScrollBegin);
  }

  var s = this.animationScrollTarget || this.scroll;

  this.animationScrollTarget = new Point({
    x: Math.max(0, s.x + x),
    y: Math.min((this.rows + 1) * this.char.height - this.size.height, Math.max(0, s.y + y))
  });
};

Jazz.prototype.animationScrollBegin = function() {
  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  var s = this.scroll;
  var t = this.animationScrollTarget;

  var dx = t.x - s.x;
  var dy = t.y - s.y;

  dx = Math.sign(dx) * 5;
  dy = Math.sign(dy) * 5;

  this.scrollBy(dx, dy);
};

Jazz.prototype.animationScrollFrame = function() {
  var speed = this.options.scroll_speed;
  var s = this.scroll;
  var t = this.animationScrollTarget;

  var dx = t.x - s.x;
  var dy = t.y - s.y;

  var adx = Math.abs(dx);
  var ady = Math.abs(dy);

  if (ady >= this.size.height * 1.2) {
    speed *= 2.45;
  }

  if (adx < 1 && ady < 1) {
    this.scrollTo(this.animationScrollTarget);
    this.animationRunning = false;
    this.animationScrollTarget = null;
    this.emit('animation end');
    return;
  }

  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  if (adx < speed) dx *= 0.9;
  else dx = Math.sign(dx) * speed;

  if (ady < speed) dy *= 0.9;
  else dy = Math.sign(dy) * speed;

  this.scrollBy(dx, dy);
};

Jazz.prototype.insert = function(text) {
  if (this.mark.active) this.delete();
  var length = this.buffer.insert(this.caret, text);
  this.move.byChars(length, true);
};

Jazz.prototype.backspace = function() {
  if (this.move.isBeginOfFile()) {
    if (this.mark.active && !this.move.isEndOfFile()) return this.delete();
    return;
  }
  if (this.mark.active) {
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.deleteArea(area);
    this.markClear(true);
    this.clear();
    this.render();
  } else {
    this.move.byChars(-1, true);
    this.buffer.deleteCharAt(this.caret);
  }
};

Jazz.prototype.delete = function() {
  if (this.move.isEndOfFile()) {
    if (this.mark.active && !this.move.isBeginOfFile()) return this.backspace();
    return;
  }
  if (this.mark.active) {
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.deleteArea(area);
    this.markClear(true);
    this.clear();
    this.render();
  } else {
    this.buffer.deleteCharAt(this.caret);
  }
};

Jazz.prototype.findJump = function(jump) {
  if (!this.findResults.length || !this.find.isOpen) return;

  this.findNeedle = this.findNeedle + jump;
  if (this.findNeedle >= this.findResults.length) {
    this.findNeedle = 0;
  } else if (this.findNeedle < 0) {
    this.findNeedle = this.findResults.length - 1;
  }

  var result = this.findResults[this.findNeedle];
  this.setCaret(result);
  this.markClear(true);
  this.markBegin();
  this.move.byChars(this.findValue.length, true);
  this.markSet();
  this.followCaret();
  this.render();
};

Jazz.prototype.onFindValue = function(value, noJump) {
  var g = new Point({ x: this.gutter, y: 0 });

  this.buffer.updateRaw();

  this.views.find.clear();

  this.findValue = value;
  // console.time('find ' + value);
  this.findResults = this.buffer.indexer.find(value).map((offset) => {
    return this.buffer.lines.getOffset(offset);
      //px: new Point(point)['*'](e.char)['+'](g)
  });
  // console.timeEnd('find ' + value);

  this.find.info('0/' + this.findResults.length);

  if (!noJump) this.findJump(0);

  this.views.find.render();
};

Jazz.prototype.onFindKey = function(e) {
  if (~[33, 34, 114].indexOf(e.which)) { // pageup, pagedown, f3
    this.input.text.onkeydown(e);
  }

  if (70 === e.which && e.ctrlKey) { // ctrl+f
    e.preventDefault();
    return false;
  }
  if (9 === e.which) { // tab
    e.preventDefault();
    this.input.focus();
    return false;
  }
};

Jazz.prototype.onFindOpen = function() {
  this.find.info('');
  this.onFindValue(this.findValue);
};

Jazz.prototype.onFindClose = function() {
  this.views.find.clear();
  this.focus();
};

Jazz.prototype.suggest = function() {
  var area = this.buffer.wordAt(this.caret, true);
  if (!area) return;

  var key = this.buffer.getArea(area);
  if (!key) return;

  if (!this.suggestRoot
    || key.substr(0, this.suggestRoot.length) !== this.suggestRoot) {
    this.suggestIndex = 0;
    this.suggestRoot = key;
    this.suggestNodes = this.buffer.prefix.collect(key);
  }

  if (!this.suggestNodes.length) return;
  var node = this.suggestNodes[this.suggestIndex];

  this.suggestIndex = (this.suggestIndex + 1) % this.suggestNodes.length;

  return {
    area: area,
    node: node
  };
};

Jazz.prototype.repaint = function() {
  this.resize();
  this.render();
};

Jazz.prototype.resize = function() {
  var $ = this.el;

  this.offset.set(dom.getOffset($));
  this.scroll.set(dom.getScroll($));
  this.size.set(dom.getSize($));

  // this is a weird fix when doing multiple .use()
  if (this.char.width === 0) this.char.set(dom.getCharSize($, css.code));

  this.rows = this.buffer.loc;
  this.code = this.buffer.text.length;
  this.page.set(this.size['^/'](this.char));
  this.pageRemainder.set(this.size['-'](this.page['_*'](this.char)));
  this.pageBounds = [0, this.rows];
  this.longestLine = Math.min(500, this.buffer.lines.getLongestLineLength());
  this.gutter = Math.max(
    this.options.hide_rows ? 0 : (''+this.rows).length,
    (this.options.center
      ? (this.page.width - 81) / 2 | 0 : 0)
    + (this.options.hide_rows
      ? 0 : Math.max(3, (''+this.rows).length))
  ) * this.char.width + (this.options.hide_rows ? 0 : this.options.gutter_margin);
  this.marginLeft = this.gutter + this.options.margin_left;

  // dom.style(this.el, {
  //   width: this.longestLine * this.char.width,
  //   height: this.rows * this.char.height
  // });

  //TODO: make method/util
  // draw indent image
  var canvas = document.createElement('canvas');
  var foo = document.getElementById('foo');
  var ctx = canvas.getContext('2d');

  canvas.setAttribute('width', Math.ceil(this.char.width * 2));
  canvas.setAttribute('height', this.char.height);

  var comment = document.createElement('comment');
  $.appendChild(comment);
  var color = window.getComputedStyle(comment).color;
  $.removeChild(comment);
  ctx.setLineDash([1,1]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(0,1);
  ctx.lineTo(0, this.char.height);
  ctx.strokeStyle = color;
  ctx.stroke();

  var dataURL = canvas.toDataURL();

  dom.css(this.id, `
    #${this.id} > .${css.ruler},
    #${this.id} > .${css.layer} > .${css.find},
    #${this.id} > .${css.layer} > .${css.mark},
    #${this.id} > .${css.layer} > .${css.code} {
      padding-left: ${this.options.margin_left + this.gutter}px;
    }
    #${this.id} > .${css.layer} > .${css.rows} {
      padding-right: ${this.options.gutter_margin}px;
      margin-left: ${this.options.margin_left}px;
      width: ${this.gutter}px;
    }
    #${this.id} > .${css.layer} > .${css.find} > i,
    #${this.id} > .${css.layer} > .${css.block} > i {
      height: ${this.char.height + 1}px;
    }
    indent {
      background-image: url(${dataURL});
    }`
  );

  this.emit('resize');
};

Jazz.prototype.clear = atomic(function() {
  // console.log('clear')
  this.views.clear();
});

Jazz.prototype.render = atomic(function() {
  // console.log('render')
  this.views.render();
  this.emit('render');
});

},{"./lib/area":2,"./lib/atomic":3,"./lib/box":4,"./lib/clone":5,"./lib/debounce":6,"./lib/dialog":7,"./lib/diff":9,"./lib/dom":10,"./lib/event":11,"./lib/merge":13,"./lib/point":16,"./lib/range":19,"./lib/set-immediate":22,"./lib/throttle":23,"./src/file":32,"./src/history":33,"./src/input":35,"./src/input/bindings":34,"./src/input/text":37,"./src/move":38,"./src/style.css":39,"./src/theme":40,"./src/views":44}],2:[function(require,module,exports){
var Point = require('./point');

module.exports = Area;

function Area(a) {
  if (a) {
    this.begin = new Point(a.begin);
    this.end = new Point(a.end);
  } else {
    this.begin = new Point;
    this.end = new Point;
  }
}

Area.prototype.copy = function() {
  return new Area(this);
};

Area.prototype.get = function() {
  var s = [this.begin, this.end].sort(Point.sort);
  return new Area({
    begin: new Point(s[0]),
    end: new Point(s[1])
  });
};

Area.prototype.set = function(area) {
  this.begin.set(area.begin);
  this.end.set(area.end);
};

Area.prototype.setLeft = function(x) {
  this.begin.x = x;
  this.end.x = x;
  return this;
};

Area.prototype.addRight = function(x) {
  if (this.begin.x) this.begin.x += x;
  if (this.end.x) this.end.x += x;
  return this;
};

Area.prototype.addBottom = function(y) {
  this.end.y += y;
  return this;
};

Area.prototype.shiftByLines = function(y) {
  this.begin.y += y;
  this.end.y += y;
};

Area.prototype['>'] =
Area.prototype.greaterThan = function(a) {
  return this.begin.y === a.end.y
    ? this.begin.x > a.end.x
    : this.begin.y > a.end.y;
};

Area.prototype['>='] =
Area.prototype.greaterThanOrEqual = function(a) {
  return this.begin.y === a.begin.y
    ? this.begin.x >= a.begin.x
    : this.begin.y > a.begin.y;
};

Area.prototype['<'] =
Area.prototype.lessThan = function(a) {
  return this.end.y === a.begin.y
    ? this.end.x < a.begin.x
    : this.end.y < a.begin.y;
};

Area.prototype['<='] =
Area.prototype.lessThanOrEqual = function(a) {
  return this.end.y === a.end.y
    ? this.end.x <= a.end.x
    : this.end.y < a.end.y;
};

Area.prototype['><'] =
Area.prototype.inside = function(a) {
  return this['>'](a) && this['<'](a);
};

Area.prototype['<>'] =
Area.prototype.outside = function(a) {
  return this['<'](a) || this['>'](a);
};

Area.prototype['>=<'] =
Area.prototype.insideEqual = function(a) {
  return this['>='](a) && this['<='](a);
};

Area.prototype['<=>'] =
Area.prototype.outsideEqual = function(a) {
  return this['<='](a) || this['>='](a);
};

Area.prototype['==='] =
Area.prototype.equal = function(a) {
  return this.begin.x === a.begin.x && this.begin.y === a.begin.y
      && this.end.x   === a.end.x   && this.end.y   === a.end.y;
};

Area.prototype['|='] =
Area.prototype.beginLineEqual = function(a) {
  return this.begin.y === a.begin.y;
};

Area.prototype['=|'] =
Area.prototype.endLineEqual = function(a) {
  return this.end.y === a.end.y;
};

Area.prototype['|=|'] =
Area.prototype.linesEqual = function(a) {
  return this['|='](a) && this['=|'](a);
};

Area.prototype['=|='] =
Area.prototype.sameLine = function(a) {
  return this.begin.y === this.end.y && this.begin.y === a.begin.y;
};

Area.prototype['-x-'] =
Area.prototype.shortenByX = function(x) {
  return new Area({
    begin: {
      x: this.begin.x + x,
      y: this.begin.y
    },
    end: {
      x: this.end.x - x,
      y: this.end.y
    }
  });
};

Area.prototype['+x+'] =
Area.prototype.widenByX = function(x) {
  return new Area({
    begin: {
      x: this.begin.x - x,
      y: this.begin.y
    },
    end: {
      x: this.end.x + x,
      y: this.end.y
    }
  });
};

Area.offset = function(b, a) {
  return {
    begin: point.offset(b.begin, a.begin),
    end: point.offset(b.end, a.end)
  };
};

Area.offsetX = function(x, a) {
  return {
    begin: point.offsetX(x, a.begin),
    end: point.offsetX(x, a.end)
  };
};

Area.offsetY = function(y, a) {
  return {
    begin: point.offsetY(y, a.begin),
    end: point.offsetY(y, a.end)
  };
};

Area.prototype.toString = function(a) {
  return '' + a.begin + '-' + a.end;
};

Area.sort = function(a, b) {
  return a.begin.y === b.begin.y
    ? a.begin.x - b.begin.x
    : a.begin.y - b.begin.y;
};

Area.toPointSort = function(a, b) {
  return a.begin.y <= b.y && a.end.y >= b.y
    ? a.begin.y === b.y
      ? a.begin.x - b.x
      : a.end.y === b.y
        ? a.end.x - b.x
        : 0
    : a.begin.y - b.y;
};

},{"./point":16}],3:[function(require,module,exports){

module.exports = atomic;

// function atomic(fn) {
//   var stage = false;
//   var n = 0;

//   function wrap() {
//     if (stage) return n++;
//     else fn.call(this);
//   }

//   wrap.hold = function() {
//     stage = true;
//     n = n || 0;
//   };

//   wrap.release = function(context) {
//     if (stage && n) {
//       stage = false;
//       n = 0;
//       fn.call(context);
//     }
//   };

//   return wrap;
// }

function atomic(fn) {
  var request;

  return function(a, b, c) {
    clearImmediate(request);
    request = setImmediate(fn.bind(this, a, b, c));
  };
}

},{}],4:[function(require,module,exports){

module.exports = Box;

function Box(b) {
  if (b) {
    this.width = b.width;
    this.height = b.height;
  } else {
    this.width = 0;
    this.height = 0;
  }
}

Box.prototype.set = function(b) {
  this.width = b.width;
  this.height = b.height;
};

Box.prototype['/'] =
Box.prototype.div = function(p) {
  return new Box({
    width: this.width / (p.x || p.width || 0),
    height: this.height / (p.y || p.height || 0)
  });
};

Box.prototype['_/'] =
Box.prototype.floorDiv = function(p) {
  return new Box({
    width: this.width / (p.x || p.width || 0) | 0,
    height: this.height / (p.y || p.height || 0) | 0
  });
};

Box.prototype['^/'] =
Box.prototype.ceildiv = function(p) {
  return new Box({
    width: Math.ceil(this.width / (p.x || p.width || 0)),
    height: Math.ceil(this.height / (p.y || p.height || 0))
  });
};

Box.prototype['*'] =
Box.prototype.mul = function(b) {
  return new Box({
    width: this.width * (b.width || b.x || 0),
    height: this.height * (b.height || b.y || 0)
  });
};

Box.prototype['^*'] =
Box.prototype.mul = function(b) {
  return new Box({
    width: Math.ceil(this.width * (b.width || b.x || 0)),
    height: Math.ceil(this.height * (b.height || b.y || 0))
  });
};

Box.prototype['o*'] =
Box.prototype.mul = function(b) {
  return new Box({
    width: Math.round(this.width * (b.width || b.x || 0)),
    height: Math.round(this.height * (b.height || b.y || 0))
  });
};

Box.prototype['_*'] =
Box.prototype.mul = function(b) {
  return new Box({
    width: this.width * (b.width || b.x || 0) | 0,
    height: this.height * (b.height || b.y || 0) | 0
  });
};

Box.prototype['-'] =
Box.prototype.sub = function(b) {
  return new Box({
    width: this.width - (b.width || b.x || 0),
    height: this.height - (b.height || b.y || 0)
  });
};

},{}],5:[function(require,module,exports){

module.exports = function clone(obj) {
  var o = {};
  for (var key in obj) {
    var val = obj[key];
    if ('object' === typeof val) {
      o[key] = clone(val);
    } else {
      o[key] = val;
    }
  }
  return o;
};

},{}],6:[function(require,module,exports){

module.exports = function(fn, ms) {
  var timeout;

  return function debounceWrap(a, b, c, d) {
    clearTimeout(timeout);
    timeout = setTimeout(fn.bind(this, a, b, c, d), ms);
    return timeout;
  }
};

},{}],7:[function(require,module,exports){
var dom = require('../dom');
var Event = require('../event');
var css = require('./style.css');

module.exports = Dialog;

function Dialog(label, keymap) {
  this.node = dom(css.dialog, [
    `<label>${css.label}`,
    [css.input, [
      `<input>${css.text}`,
      css.info
    ]]
  ]);
  dom.text(this.node[css.label], label);
  dom.style(this.node[css.input][css.info], { display: 'none' });
  this.keymap = keymap;
  this.onbodykeydown = this.onbodykeydown.bind(this);
  this.onkeydown = this.onkeydown.bind(this);
  this.oninput = this.oninput.bind(this);
  this.node[css.input].el.onkeydown = this.onkeydown;
  this.node[css.input].el.onclick = stopPropagation;
  this.node[css.input].el.onmouseup = stopPropagation;
  this.node[css.input].el.onmousedown = stopPropagation;
  this.node[css.input].el.oninput = this.oninput;
  this.isOpen = false;
}

Dialog.prototype.__proto__ = Event.prototype;

function stopPropagation(e) {
  e.stopPropagation();
};

Dialog.prototype.hasFocus = function() {
  return this.node[css.input].el.hasFocus();
};

Dialog.prototype.onbodykeydown = function(e) {
  if (27 === e.which) {
    e.preventDefault();
    this.close();
    return false;
  }
};

Dialog.prototype.onkeydown = function(e) {
  if (13 === e.which) {
    e.preventDefault();
    this.submit();
    return false;
  }
  if (e.which in this.keymap) {
    this.emit('key', e);
  }
};

Dialog.prototype.oninput = function(e) {
  this.emit('value', this.node[css.input][css.text].el.value);
};

Dialog.prototype.open = function() {
  document.body.addEventListener('keydown', this.onbodykeydown);
  dom.append(document.body, this.node);
  dom.focus(this.node[css.input][css.text]);
  this.node[css.input][css.text].el.select();
  this.isOpen = true;
  this.emit('open');
};

Dialog.prototype.close = function() {
  document.body.removeEventListener('keydown', this.onbodykeydown);
  this.node.el.parentNode.removeChild(this.node.el);
  this.isOpen = false;
  this.emit('close');
};

Dialog.prototype.submit = function() {
  this.emit('submit', this.node[css.input][css.text].el.value);
};

Dialog.prototype.info = function(info) {
  dom.text(this.node[css.input][css.info], info);
  dom.style(this.node[css.input][css.info], { display: info ? 'block' : 'none' });
};

},{"../dom":10,"../event":11,"./style.css":8}],8:[function(require,module,exports){
module.exports = {"dialog":"_lib_dialog_style__dialog","input":"_lib_dialog_style__input","text":"_lib_dialog_style__text","label":"_lib_dialog_style__label","info":"_lib_dialog_style__info"}
},{}],9:[function(require,module,exports){

module.exports = diff;

function diff(a, b) {
  if ('object' === typeof a) {
    var d = {};
    var i = 0;
    for (var k in b) {
      if (a[k] !== b[k]) {
        d[k] = b[k];
        i++;
      }
    }
    if (i) return d;
  } else {
    return a !== b;
  }
}

},{}],10:[function(require,module,exports){
var Point = require('./point');
var atomic = require('./atomic');
var memoize = require('./memoize');
var merge = require('./merge');
var diff = require('./diff');
var slice = [].slice;

var units = {
  left: 'px',
  top: 'px',
  right: 'px',
  bottom: 'px',
  width: 'px',
  height: 'px',
  maxHeight: 'px',
  paddingLeft: 'px',
};

module.exports = dom;

function dom(name, children, attrs) {
  var el;
  var tag = 'div';
  var node;

  if ('string' === typeof name) {
    if ('<' === name.charAt(0)) {
      var matches = name.match(/(?:<)(.*)(?:>)(\S+)?/);
      if (matches) {
        tag = matches[1];
        name = matches[2] || tag;
      }
    }
    el = document.createElement(tag);
    node = {
      el: el,
      name: name.split(' ')[0]
    };
    dom.classes(node, name.split(' ').slice(1));
  } else if (Array.isArray(name)) {
    return dom.apply(null, name);
  } else {
    if ('dom' in name) {
      node = name.dom;
    } else {
      node = name;
    }
  }

  if (Array.isArray(children)) {
    children
      .map(dom)
      .map(function(child, i) {
        node[child.name] = child;
        return child;
      })
      .map(function(child) {
        node.el.appendChild(child.el);
      });
  } else if ('object' === typeof children) {
    dom.style(node, children);
  }

  if (attrs) {
    dom.attrs(node, attrs);
  }

  return node;
}

dom.style = memoize(function(el, _, style) {
  for (var name in style)
    if (name in units)
      style[name] += units[name];
  Object.assign(el.style, style);
}, diff, merge, function(node, style) {
  var el = dom.getElement(node);
  return [el, style];
});

/*
dom.style = function(el, style) {
  el = dom.getElement(el);
  for (var name in style)
    if (name in units)
      style[name] += units[name];
  Object.assign(el.style, style);
};
*/
dom.classes = memoize(function(el, className) {
  el.className = className;
}, null, null, function(node, classes) {
  var el = dom.getElement(node);
  return [el, classes.concat(node.name).filter(Boolean).join(' ')];
});

dom.attrs = function(el, attrs) {
  el = dom.getElement(el);
  Object.assign(el, attrs);
};

dom.html = function(el, html) {
  el = dom.getElement(el);
  el.innerHTML = html;
};

dom.text = function(el, text) {
  el = dom.getElement(el);
  el.textContent = text;
};

dom.focus = function(el) {
  el = dom.getElement(el);
  el.focus();
};

dom.getSize = function(el) {
  el = dom.getElement(el);
  return {
    width: el.clientWidth,
    height: el.clientHeight
  };
};

dom.getCharSize = function(el, className) {
  el = dom.getElement(el);
  var span = document.createElement('span');
  span.className = className;

  el.appendChild(span);

  span.innerHTML = ' ';
  var a = span.getBoundingClientRect();

  span.innerHTML = '  \n ';
  var b = span.getBoundingClientRect();

  el.removeChild(span);

  return {
    width: (b.width - a.width),
    height: (b.height - a.height)
  };
};

dom.getOffset = function(el) {
  el = dom.getElement(el);
  var rect = el.getBoundingClientRect();
  var style = window.getComputedStyle(el);
  var borderLeft = parseInt(style.borderLeftWidth);
  var borderTop = parseInt(style.borderTopWidth);
  return Point.low({ x: 0, y: 0 }, {
    x: (rect.left + borderLeft) | 0,
    y: (rect.top + borderTop) | 0
  });
};

dom.getScroll = function(el) {
  el = dom.getElement(el);
  return getScroll(el);
};

dom.onscroll = function onscroll(el, fn) {
  el = dom.getElement(el);

  if (document.body === el) {
    document.addEventListener('scroll', handler);
  } else {
    el.addEventListener('scroll', handler);
  }

  function handler(ev) {
    fn(getScroll(el));
  }

  return function offscroll() {
    el.removeEventListener('scroll', handler);
  }
};

dom.onoffset = function(el, fn) {
  el = dom.getElement(el);
  while (el = el.offsetParent) {
    dom.onscroll(el, fn);
  }
};

dom.onclick = function(el, fn) {
  return el.addEventListener('click', fn);
};

dom.onresize = function(fn) {
  return window.addEventListener('resize', fn);
};

dom.append = function(target, src, dict) {
  target = dom.getElement(target);
  if ('forEach' in src) src.forEach(dom.append.bind(null, target));
  // else if ('views' in src) dom.append(target, src.views, true);
  else if (dict === true) for (var key in src) dom.append(target, src[key]);
  else if ('function' != typeof src) target.appendChild(dom.getElement(src));
};

dom.remove = function(el) {
  el = dom.getElement(el);
  if (el.parentNode) el.parentNode.removeChild(el);
};

dom.getElement = function(el) {
  return el.dom && el.dom.el || el.el || el.node || el;
};

dom.scrollBy = function(el, x, y, scroll) {
  scroll = scroll || dom.getScroll(el);
  dom.scrollTo(el, scroll.x + x, scroll.y + y);
};

dom.scrollTo = function(el, x, y) {
  if (document.body === el) {
    window.scrollTo(x, y);
  } else {
    el.scrollLeft = x || 0;
    el.scrollTop = y || 0;
  }
};

dom.css = atomic(function(id, cssText) {
  if (!(id in dom.css.styles)) {
    dom.css.styles[id] = document.createElement('style');
    document.body.appendChild(dom.css.styles[id]);
  }
  dom.css.styles[id].textContent = cssText;
});

dom.css.styles = {};

dom.getMousePoint = function(e) {
  return new Point({
    x: e.clientX,
    y: e.clientY
  });
};

function getScroll(el) {
  return document.body === el
    ? {
        x: window.scrollX || el.scrollLeft || document.documentElement.scrollLeft,
        y: window.scrollY || el.scrollTop  || document.documentElement.scrollTop
      }
    : {
        x: el.scrollLeft,
        y: el.scrollTop
      };
}

},{"./atomic":3,"./diff":9,"./memoize":12,"./merge":13,"./point":16}],11:[function(require,module,exports){

var push = [].push;
var slice = [].slice;

module.exports = Event;

function Event() {
  if (!(this instanceof Event)) return new Event;

  this._handlers = {};
}

Event.prototype._getHandlers = function(name) {
  this._handlers = this._handlers || {};
  return this._handlers[name] = this._handlers[name] || [];
};

Event.prototype.emit = function(name, a, b, c, d) {
  var handlers = this._getHandlers(name);
  for (var i = 0; i < handlers.length; i++) {
    handlers[i](a, b, c, d);
  };
};

Event.prototype.on = function(name) {
  var handlers;
  var newHandlers = slice.call(arguments, 1);
  if (Array.isArray(name)) {
    name.forEach(function(name) {
      handlers = this._getHandlers(name);
      push.apply(handlers, newHandlers[name]);
    }, this);
  } else {
    handlers = this._getHandlers(name);
    push.apply(handlers, newHandlers);
  }
};

Event.prototype.off = function(name, handler) {
  var handlers = this._getHandlers(name);
  var index = handlers.indexOf(handler);
  if (~index) handlers.splice(index, 1);
};

Event.prototype.once = function(name, fn) {
  var handlers = this._getHandlers(name);
  var handler = function(a, b, c, d) {
    fn(a, b, c, d);
    handlers.splice(handlers.indexOf(handler), 1);
  };
  handlers.push(handler);
};

},{}],12:[function(require,module,exports){
var clone = require('./clone');

module.exports = function memoize(fn, diff, merge, pre) {
  diff = diff || function(a, b) { return a !== b };
  merge = merge || function(a, b) { return b };
  pre = pre || function(node, param) { return param };

  var nodes = [];
  var cache = [];
  var results = [];

  return function(node, param) {
    var args = pre(node, param);
    node = args[0];
    param = args[1];

    var index = nodes.indexOf(node);
    if (~index) {
      var d = diff(cache[index], param);
      if (!d) return results[index];
      else {
        cache[index] = merge(cache[index], param);
        results[index] = fn(node, param, d);
      }
    } else {
      cache.push(clone(param));
      nodes.push(node);
      index = results.push(fn(node, param, param));
    }

    return results[index];
  };
};

},{"./clone":5}],13:[function(require,module,exports){

module.exports = function merge(dest, src) {
  for (var key in src) {
    dest[key] = src[key];
  }
  return dest;
};

},{}],14:[function(require,module,exports){

module.exports = open;

function open(url, cb) {
  return fetch(url)
    .then(getText)
    .then(cb.bind(null, null))
    .catch(cb);
}

function getText(res) {
  return res.text();
}

},{}],15:[function(require,module,exports){
var TOKENS = /.+?\b|.\B|\b.+?/g;
var WORD = /[./\\\(\)"'\-:,.;<>~!@#$%^&*\|\+=\[\]{}`~\? ]+/g;

var parse = exports;

parse.words = function(s) {
  var words = [];
  var word;

  while (word = WORD.exec(s)) {
    words.push(word);
  }

  return words;
};

parse.tokens = function(s) {
  var words = [];
  var word;

  while (word = TOKENS.exec(s)) {
    words.push(word);
  }

  return words;
};

},{}],16:[function(require,module,exports){

module.exports = Point;

function Point(p) {
  if (p) {
    this.x = p.x;
    this.y = p.y;
  } else {
    this.x = 0;
    this.y = 0;
  }
}

Point.prototype.set = function(p) {
  this.x = p.x;
  this.y = p.y;
};

Point.prototype.copy = function() {
  return new Point(this);
};

Point.prototype.addRight = function(x) {
  this.x += x;
  return this;
};

Point.prototype['/'] =
Point.prototype.div = function(p) {
  return new Point({
    x: this.x / (p.x || p.width || 0),
    y: this.y / (p.y || p.height || 0)
  });
};

Point.prototype['_/'] =
Point.prototype.floorDiv = function(p) {
  return new Point({
    x: this.x / (p.x || p.width || 0) | 0,
    y: this.y / (p.y || p.height || 0) | 0
  });
};

Point.prototype['o/'] =
Point.prototype.roundDiv = function(p) {
  return new Point({
    x: Math.round(this.x / (p.x || p.width || 0)),
    y: Math.round(this.y / (p.y || p.height || 0))
  });
};

Point.prototype['+'] =
Point.prototype.add = function(p) {
  return new Point({
    x: this.x + (p.x || p.width || 0),
    y: this.y + (p.y || p.height || 0)
  });
};

Point.prototype['-'] =
Point.prototype.sub = function(p) {
  return new Point({
    x: this.x - (p.x || p.width || 0),
    y: this.y - (p.y || p.height || 0)
  });
};

//TODO: _* o* ^* floorMul roundMul ceilMul
Point.prototype['*'] =
Point.prototype.mul = function(p) {
  return new Point({
    x: this.x * (p.x || p.width || 0),
    y: this.y * (p.y || p.height || 0)
  });
};

Point.prototype['^*'] =
Point.prototype.mul = function(p) {
  return new Point({
    x: Math.ceil(this.x * (p.x || p.width || 0)),
    y: Math.ceil(this.y * (p.y || p.height || 0))
  });
};

Point.prototype['o*'] =
Point.prototype.mul = function(p) {
  return new Point({
    x: Math.round(this.x * (p.x || p.width || 0)),
    y: Math.round(this.y * (p.y || p.height || 0))
  });
};

Point.prototype['_*'] =
Point.prototype.mul = function(p) {
  return new Point({
    x: this.x * (p.x || p.width || 0) | 0,
    y: this.y * (p.y || p.height || 0) | 0
  });
};

Point.prototype.toString = function() {
  return 'x:' + this.x + ',y:' + this.y;
};

Point.sort = function(a, b) {
  return a.y === b.y
    ? a.x - b.x
    : a.y - b.y;
};

Point.gridRound = function(b, a) {
  return {
    x: Math.round(a.x / b.width),
    y: Math.round(a.y / b.height)
  };
};

Point.low = function(low, p) {
  return {
    x: Math.max(low.x, p.x),
    y: Math.max(low.y, p.y)
  };
};

Point.clamp = function(area, p) {
  return new Point({
    x: Math.min(area.end.x, Math.max(area.begin.x, p.x)),
    y: Math.min(area.end.y, Math.max(area.begin.y, p.y))
  });
};

Point.offset = function(b, a) {
  return { x: a.x + b.x, y: a.y + b.y };
};

Point.offsetX = function(x, p) {
  return { x: p.x + x, y: p.y };
};

Point.offsetY = function(y, p) {
  return { x: p.x, y: p.y + y };
};

Point.toLeftTop = function(p) {
  return {
    left: p.x,
    top: p.y
  };
};

},{}],17:[function(require,module,exports){

module.exports = AND;

function AND(a, b) {
  var found = false;
  var range = null;
  var out = [];

  for (var i = a[0]; i <= a[1]; i++) {
    found = false;

    for (var j = 0; j < b.length; j++) {
      if (i >= b[j][0] && i <= b[j][1]) {
        found = true;
        break;
      }
    }

    if (found) {
      if (!range) {
        range = [i,i];
        out.push(range);
      }
      range[1] = i;
    } else {
      range = null;
    }
  }

  return out;
}

},{}],18:[function(require,module,exports){

module.exports = NOT;

function NOT(a, b) {
  var found = false;
  var range = null;
  var out = [];

  for (var i = a[0]; i <= a[1]; i++) {
    found = false;

    for (var j = 0; j < b.length; j++) {
      if (i >= b[j][0] && i <= b[j][1]) {
        found = true;
        break;
      }
    }

    if (!found) {
      if (!range) {
        range = [i,i];
        out.push(range);
      }
      range[1] = i;
    } else {
      range = null;
    }
  }

  return out;
}

},{}],19:[function(require,module,exports){
var AND = require('./range-gate-and');
var NOT = require('./range-gate-not');

module.exports = Range;

function Range(r) {
  if (r) {
    this[0] = r[0];
    this[1] = r[1];
  } else {
    this[0] = 0;
    this[1] = 1;
  }
};

Range.AND = AND;
Range.NOT = NOT;

Range.sort = function(a, b) {
  return a.y === b.y
    ? a.x - b.x
    : a.y - b.y;
};

Range.equal = function(a, b) {
  return a[0] === b[0] && a[1] === b[1];
};

Range.clamp = function(a, b) {
  return new Range([
    Math.min(b[1], Math.max(a[0], b[0])),
    Math.min(a[1], b[1])
  ]);
};

Range.prototype.slice = function() {
  return new Range(this);
};

Range.ranges = function(items) {
  return items.map(function(item) { return item.range });
};

Range.prototype.inside = function(items) {
  var range = this;
  return items.filter(function(item) {
    return item.range[0] >= range[0] && item.range[1] <= range[1];
  });
};

Range.prototype.overlap = function(items) {
  var range = this;
  return items.filter(function(item) {
    return item.range[0] <= range[0] && item.range[1] >= range[1];
  });
};

Range.prototype.outside = function(items) {
  var range = this;
  return items.filter(function(item) {
    return item.range[1] < range[0] || item.range[0] > range[1];
  });
};

},{"./range-gate-and":17,"./range-gate-not":18}],20:[function(require,module,exports){

var Regexp = exports;

Regexp.create = function(names, flags, fn) {
  fn = fn || function(s) { return s };
  return new RegExp(
    names
    .map((n) => 'string' === typeof n ? Regexp.types[n] : n)
    .map((r) => fn(r.toString().slice(1,-1)))
    .join('|'),
    flags
  );
};

Regexp.types = {
  'tokens': /.+?\b|.\B|\b.+?/,
  'words': /[a-zA-Z0-9]{1,}/,
  'parts': /[./\\\(\)"'\-:,.;<>~!@#$%^&*\|\+=\[\]{}`~\? ]+/,

  'single comment': /\/\/.*?$/,
  'double comment': /\/\*[^]*?\*\//,
  'single quote string': /('(?:(?:\\\n|\\'|[^'\n]))*?')/,
  'double quote string': /("(?:(?:\\\n|\\"|[^"\n]))*?")/,
  'template string': /(`(?:(?:\\`|[^`]))*?`)/,

  'operator': /!|>=?|<=?|={1,3}|(?:&){1,2}|\|?\||\?|\*|\/|~|\^|%|\.(?!\d)|\+{1,2}|\-{1,2}/,
  'function': / ((?!\d|[. ]*?(if|else|do|for|case|try|catch|while|with|switch))[a-zA-Z0-9_ $]+)(?=\(.*\).*{)/,
  'keyword': /\b(break|case|catch|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|if|implements|import|in|instanceof|interface|let|new|package|private|protected|public|return|static|super|switch|throw|try|typeof|while|with|yield)\b/,
  'declare': /\b(function|interface|class|var|let|const|enum|void)\b/,
  'builtin': /\b(Object|Function|Boolean|Error|EvalError|InternalError|RangeError|ReferenceError|StopIteration|SyntaxError|TypeError|URIError|Number|Math|Date|String|RegExp|Array|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray|ArrayBuffer|DataView|JSON|Intl|arguments|console|window|document|Symbol|Set|Map|WeakSet|WeakMap|Proxy|Reflect|Promise)\b/,
  'special': /\b(true|false|null|undefined)\b/,
  'params': /function[ \(]{1}[^]*?\{/,
  'number': /-?\b(0x[\dA-Fa-f]+|\d*\.?\d+([Ee][+-]?\d+)?|NaN|-?Infinity)\b/,
  'symbol': /[{}[\](),:]/,
  'regexp': /(?![^\/])(\/(?![\/|\*]).*?[^\\\^]\/)([;\n\.\)\]\} gim])/,

  'xml': /<[^>]*>/,
  'url': /((\w+:\/\/)[-a-zA-Z0-9:@;?&=\/%\+\.\*!'\(\),\$_\{\}\^~\[\]`#|]+)/,
  'indent': /^ +/,
  'line': /^.+$|^\n/,
};

Regexp.types.comment = Regexp.create([
  'single comment',
  'double comment',
]);

Regexp.types.string = Regexp.create([
  'single quote string',
  'double quote string',
  'template string',
]);

Regexp.types.multiline = Regexp.create([
  'double comment',
  'template string',
  'indent',
  'line'
]);

Regexp.parse = function(s, regexp, filter) {
  var words = [];
  var word;

  if (filter) {
    while (word = regexp.exec(s)) {
      if (filter(word)) words.push(word);
    }
  } else {
    while (word = regexp.exec(s)) {
      words.push(word);
    }
  }

  return words;
};

},{}],21:[function(require,module,exports){

module.exports = save;

function save(url, src, cb) {
  return fetch(url, {
      method: 'POST',
      body: src,
    })
    .then(cb.bind(null, null))
    .catch(cb);
}

},{}],22:[function(require,module,exports){
// Note: You probably do not want to use this in production code, as Promise is
//   not supported by all browsers yet.

(function() {
    "use strict";

    if (window.setImmediate) {
        return;
    }

    var pending = {},
        nextHandle = 1;

    function onResolve(handle) {
        var callback = pending[handle];
        if (callback) {
            delete pending[handle];
            callback.fn.apply(null, callback.args);
        }
    }

    window.setImmediate = function(fn) {
        var args = Array.prototype.slice.call(arguments, 1),
            handle;

        if (typeof fn !== "function") {
            throw new TypeError("invalid function");
        }

        handle = nextHandle++;
        pending[handle] = { fn: fn, args: args };

        new Promise(function(resolve) {
            resolve(handle);
        }).then(onResolve);

        return handle;
    };

    window.clearImmediate = function(handle) {
        delete pending[handle];
    };
}());
},{}],23:[function(require,module,exports){

module.exports = function(fn, ms) {
  var running, timeout;

  return function(a, b, c) {
    if (running) return;
    running = true;
    fn.call(this, a, b, c);
    setTimeout(reset, ms);
  };

  function reset() {
    running = false;
  }
};

},{}],24:[function(require,module,exports){

var trim = exports;

trim.emptyLines = function(s) {
  var trailing = trim.trailingEmptyLines(s);
  var leading = trim.leadingEmptyLines(trailing.string);
  return {
    trailing: trailing.removed,
    leading: leading.removed,
    removed: trailing.removed + leading.removed,
    string: leading.string
  };
};

trim.trailingEmptyLines = function(s) {
  var index = s.length;
  var lastIndex = index;
  var n = 0;
  while (
    ~(index = s.lastIndexOf('\n', lastIndex - 1))
    && index - lastIndex === -1) {
    n++;
    lastIndex = index;
  }

  if (n) s = s.slice(0, lastIndex);

  return {
    removed: n,
    string: s
  };
};

trim.leadingEmptyLines = function(s) {
  var index = -1;
  var lastIndex = index;
  var n = 0;

  while (
    ~(index = s.indexOf('\n', lastIndex + 1))
    && index - lastIndex === 1) {
    n++;
    lastIndex = index;
  }

  if (n) s = s.slice(lastIndex + 1);

  return {
    removed: n,
    string: s
  };
};

},{}],25:[function(require,module,exports){
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var atomic = require('../../lib/atomic');
var parse = require('../../lib/parse');
var Area = require('../../lib/area');
var Range = require('../../lib/range');
var Regexp = require('../../lib/regexp');
var Event = require('../../lib/event');
var Lines = require('./lines');
var Syntax = require('./syntax');
var Segments = require('./segments');
var SkipString = require('./skipstring');
var PrefixTree = require('./prefixtree');
var Indexer = require('./indexer');

exports = module.exports = Buffer;

var EOL = exports.EOL = /\r\n|\r|\n/g;
var N = exports.N = /\n/g;
var CHUNK_SIZE = exports.CHUNK_SIZE = 5000;
var WORDS = Regexp.create(['tokens'], 'g');

function Buffer() {
  this.syntax = new Syntax;
  this.indexer = new Indexer(this);
  this.segments = new Segments(this);
  this.on('update', debounce(this.updateRaw.bind(this), 300));
  this.on('raw', this.segments.index.bind(this.segments));
  this.set('');
}

Buffer.prototype = {
  get loc() {
    return this.lines.length;
  }
};

Buffer.prototype.__proto__ = Event.prototype;

Buffer.prototype.get = function(range) {
  if (!range) return this.text.getRange();
  var offsets = this.lines.getRange(range);
  var text = this.text.getRange(offsets);
  return text;
};

var BLOCK = {
  'comment': '/*',
  'string': '`',
};

var BLOCK_END = {
  'comment': '*/',
  'string': '`',
};

Buffer.prototype.getHighlighted = function(range) {
  var code = this.get(range);
  // return this.syntax.entities(code);
  // return this.syntax.highlight(code);

  var block = this.segments.get(range[0]);
  // console.timeEnd('get segment')
  if (block) {
    code = BLOCK[block] + '\uffba' + code + '\uffbe' + BLOCK_END[block];
    code = this.syntax.highlight(code);
    code = '<' + block + '>' +
      code.substring(
        code.indexOf('\uffba') + 1,
        code.lastIndexOf('\uffbe')
      );
  } else {
    code = this.syntax.highlight(code + '\uffbe*/`');
    code = code.substring(
      0,
      code.lastIndexOf('\uffbe')
    );
  }
  return code;
};

//TODO: this defeats the purpose of having a skiplist
// need to get rid of in the future
Buffer.prototype.updateRaw = function() {
  this.raw = this.get();
  this.emit('raw', this.raw);
};

Buffer.prototype.getOffsetLine = function(offset) {
  var point = this.lines.getOffset(offset);
  var text = this.text.getRange(point.line.range);
  return {
    point: point,
    text: text
  };
};

Buffer.prototype.getLine = function(y) {
  return this.get([y,y]);
};

Buffer.prototype.set = function(text) {
  this.changes = 0;

  this.raw = text = normalizeEOL(text);
  this.emit('raw', this.raw);

  this.text = new SkipString({ chunkSize: CHUNK_SIZE });
  this.text.set(text);

  this.prefix = new PrefixTree;
  this.prefix.index(this.raw);

  this.lines = new Lines;
  this.lines.insert({ x:0, y:0 }, this.raw);

  this.emit('set');
};

Buffer.prototype.insert = function(point, text, shift, isCtrlShift) {
  var isEOL, lines, range, before, after;

  this.changes++;

  if (!isCtrlShift) this.emit('before update');

  text = normalizeEOL(text);

  isEOL = '\n' === text;

  point = this.lines.getPoint(point);
  lines = this.lines.insert(point, text);
  range = [point.y, point.y + lines];

  shift = !isCtrlShift && (shift || isEOL);

  before = this.get(range);

  this.text.insert(point.offset, text);

  after = this.get(range);

  this.prefix.index(after);
  if (isCtrlShift) range = [Math.max(0, range[0]-1), range[1]];

  this.segments.shift(point.offset, text.length);

  //TODO: i think shift should be 'lines'
  this.emit('update', range, shift, before, after);

  // this is to update caret position
  return text.length;
};

Buffer.prototype.deleteCharAt = function(point) {
  var isEOL, range, before, after;

  this.changes++;

  this.emit('before update');

  point = this.lines.getPoint(point);
  isEOL = this.lines.removeCharAt(point);
  range = Range.clamp([0, this.lines.length], [point.y, point.y + isEOL]);

  before = this.get(range);

  this.text.removeCharAt(point.offset);

  after = this.get(range);

  this.prefix.index(after);

  this.segments.shift(point.offset, -1);

  this.emit('update', range, -isEOL, before);
};

Buffer.prototype.wordAt = function(point, inclusive) {
  inclusive = inclusive || 0;

  point = this.lines.getPoint(point);

  var text = this.text.getRange(point.line.range);

  var words = Regexp.parse(text, WORDS);

  if (words.length === 1) {
    return new Area({
      begin: { x: 0, y: point.y },
      end: { x: point.line.length, y: point.y },
    });
  }

  var lastIndex = 0;
  var word = [];
  var end = text.length;

  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (word.index > point.x - inclusive) {
      end = word.index;
      break;
    }
    lastIndex = word.index;
  }

  return new Area({
    begin: { x: lastIndex, y: point.y },
    end: { x: end, y: point.y }
  });
};

Buffer.prototype.deleteArea = function(area, noUpdate) {
  var range, offsets, lines;

  this.changes++;

  this.emit('before update');

  offsets = this.lines.getAreaOffsetRange(area);
  lines = this.lines.removeArea(area);
  range = [area.begin.y, area.end.y];

  this.text.remove(offsets);

  this.segments.shift(offsets[0], offsets[0]-offsets[1]);

  if (!noUpdate) {
    this.emit('update', range);
  }
};

Buffer.prototype.getArea = function(area) {
  var offsets = this.lines.getAreaOffsetRange(area);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.moveAreaByLines = function(y, area) {
  if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
  if (area.begin.y + y < 0 || area.end.y + y > this.loc) return false;

  area.begin.x = 0;
  area.end.x = 0;

  var text = this.get([area.begin.y, area.end.y-1]);
  this.deleteArea(area, true);

  this.insert({ x:0, y:area.begin.y + y }, text, y, true);

  return true;
};

function normalizeEOL(s) {
  return s.replace(exports.EOL, '\n');
}

},{"../../lib/area":2,"../../lib/atomic":3,"../../lib/debounce":6,"../../lib/event":11,"../../lib/parse":15,"../../lib/range":19,"../../lib/regexp":20,"../../lib/throttle":23,"./indexer":26,"./lines":27,"./prefixtree":28,"./segments":29,"./skipstring":30,"./syntax":31}],26:[function(require,module,exports){

module.exports = Indexer;

function Indexer(buffer) {
  this.buffer = buffer;
}

Indexer.prototype.find = function(s) {
  if (!s) return [];
  var offsets = [];
  var text = this.buffer.raw;
  var len = s.length;
  var index;
  while (~(index = text.indexOf(s, index + len))) {
    offsets.push(index);
  }
  return offsets;
};

},{}],27:[function(require,module,exports){

/*
 *                                                       _ = caret
 *
 *   0   1   2   3   4    5   0   1   2   3   4    5   0   1   2
 * | h | e | l | l | o | \n | w | o | r | l | d | \n | ! | ! | _ |
 * 0   1   2   3   4   5    6   7   8   9   10  11   12  13  14  15
 *
 * get(0) -> 0
 * get(1) -> 6
 * get(2) -> 12
 * get(3) -> throws
 *
 * left inclusive, right exclusive:
 *
 * getLine(x).offset === get(x)
 * getLine(0).range -> 0-6
 * getLine(1).range -> 6-12
 * getLine(2).range -> 12-13
 * getLine(3) -> throws
 *
 * getRange([0,0]) -> 0-6
 * getRange([0,1]) -> 0-12
 * getRange([1,1]) -> 6-12
 * getRange([1,2]) -> 6-13
 * getRange([2,2]) -> 12-13
 * getRange([2,3]) -> throws
 * getRange([0,3]) -> throws
 *
 * getPoint({ x:x, y:y }).line === getLine(y)
 * getPoint({ x:0, y:0 }).offset -> 0
 * getPoint({ x:0, y:0 }).point -> { x:0, y:0 }
 * getPoint({ x:2, y:0 }).offset -> 2
 * getPoint({ x:10, y:0 }).offset -> 5
 * getPoint({ x:10, y:0 }).point -> { x:5, y:0 }
 * getPoint({ x:0, y:1 }).offset -> 6
 * getPoint({ x:2, y:1 }).offset -> 8
 * getPoint({ x:10, y:1 }).offset -> 11
 * getPoint({ x:10, y:1 }).point -> { x:5, y:1 }
 * getPoint({ x:0, y:2 }).offset -> 12
 * getPoint({ x:10, y:2 }).offset -> 13
 * getPoint({ x:10, y:2 }).point -> { x:1, y:2 }
 * getRange({ x:100, y:100 }).offset -> 13
 * getRange({ x:100, y:100 }).point -> { x:1, y: 2 }
 *
 * getLineLength(0) -> 6
 * getLineLength(1) -> 6
 * getLineLength(2) -> 2
 * getLineLength(3) -> throws
 */

var EOL = /\r\n|\r|\n/g;
var N = /\n/g;

module.exports = Lines;

function Lines() {
  this.index = [];
  this.tail = '';
  this.length = 0;
}

Lines.prototype.get = function(y) {
  if (y > this.length) {
    return this.index[this.length - 1] + this.tail.length + 1;
  }
  var line = this.index[y - 1] || 0;

  return y > 0 ? line + 1 : 0;
};

Lines.prototype.getRange = function(range) {
  var a = this.get(range[0]);
  var b;

  if (range[1] + 1 >= this.length + 1) {
    b = this.get(range[1]) + this.tail.length;
  } else {
    b = this.get(range[1] + 1);
  }

  return [a, b];
};

Lines.prototype.getDistance = function(range) {
  var a = this.get(range[0]);
  var b;

  if (range[1] === this.length + 1) {
    b = this.get(range[1] - 1) + this.tail.length;
  } else {
    b = this.get(range[1]) - 1;
  }

  return b - a;
};

Lines.prototype.getLineLength = function(y) {
  return this.getDistance([y, y+1]);
};

Lines.prototype.getLongestLineLength = function() {
  var longest = 0;
  var d = 0;
  var p = this.index[this.length - 1];
  var i = this.length;
  while (i-- > 0) {
    d = this.index[i] - this.index[i - 1];
    longest = d > longest ? d : longest;
  }
  return longest;
};

Lines.prototype.getLine = function(y) {
  var offset = this.get(y);
  var point = { x: 0, y: y };
  var length = this.getLineLength(point.y);
  var range = [offset, offset + length];

  return {
    offset: offset,
    point: point,
    range: range,
    length: length,
  };
};

Lines.prototype.getPoint = function(point) {
  var line = this.getLine(point.y);

  var point = {
    x: Math.min(point.x, line.length),
    y: line.point.y
  };

  return {
    offset: line.offset + point.x,
    point: point,
    x: point.x,
    y: point.y,
    line: line,
  };
};

Lines.prototype.getOffset = function(offset) {
  var begin = 0;
  var end = this.length;
  if (!end) return;

  var p = -1;
  var i = -1;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    if (this.get(i) <= offset) begin = i;
    else end = i;
  } while (p !== i);

  var line = this.getLine(i);
  var x = offset - line.offset;
  if ( x > line.length
    && i === this.length - 1) {
    x -= line.length + 1;
    i += 1;
    if (x > this.tail.length) return false;
  }

  return {
    x: x,
    y: i,
    line: line
  };
};

Lines.prototype.insert = function(p, text) {
  var point = this.getPoint(p);
  var x = point.x;
  var y = point.y;
  var offset = point.offset;

  if (y === this.length) {
    text = this.tail.substr(0,x) + text + this.tail.substr(x);
    this.tail = '';
    offset -= x;
  }

  var matches = [y, 0];
  var match = -1;
  var shift = 0;
  var last = -1;

  while (~(match = text.indexOf('\n', match + 1))) {
    matches.push(match + offset);
    last = match;
  }

  shift += last + 1;

  var tail = text.slice(last + 1);
  if (y === this.length) {
    this.tail += tail;
  }

  if (y < this.length) {
    shift += tail.length;
    this.shift(y, shift);
  }

  if (matches.length < 3) return 0;

  this.index.splice.apply(this.index, matches);

  var lines = this.index.length - this.length;

  this.length = this.index.length;

  return lines;
};

Lines.prototype.insertLine = function(y, text) {
  this.insert({ x:0, y:y }, text);
};

Lines.prototype.getArea = function(area) {
  return this.getRange([
    area.begin.y,
    area.end.y
  ]);
};

Lines.prototype.getAreaOffsetRange = function(area) {
  return [
    this.getPoint(area.begin).offset,
    this.getPoint(area.end).offset
  ];
};

Lines.prototype.removeCharAt = function(p) {
  var a = this.getPoint(p);
  if (a.point.y === this.length) {
    this.tail = this.tail.slice(0, -1);
    return false;
  } else {
    var isEndOfLine = a.line.length === a.point.x;
    if (isEndOfLine) {
      this.index.splice(a.point.y, 1);
      this.length = this.index.length;
      if (a.point.y === this.length) {
        this.tail += new Array(a.line.length+1).join('*');
      }
    }
    this.shift(a.point.y, -1);
    return isEndOfLine;
  }
};

Lines.prototype.removeArea = function(area) {
  var begin = this.getPoint(area.begin);
  var end = this.getPoint(area.end);

  var x = 0;

  var dist = end.y - begin.y;
  var sameLine = begin.y === end.y;
  if (sameLine) x = end.x - begin.x;
  else {
    this.index.splice(begin.y, dist);
  }

  if (!sameLine) {
    if (area.begin.y === this.length) {
      this.tail = this.tail.slice(0, -x);
    }
    if (area.end.y === this.length) {
      this.tail = this.tail.slice(end.x);
      this.tail += new Array(begin.x + 1).join('*');
    }
  } else {
    if (area.begin.y === this.length) {
      this.tail = this.tail.slice(0, begin.x) + this.tail.slice(end.x);
    }
  }

  this.shift(area.begin.y, -(end.offset - begin.offset));

  var diff = this.length - this.index.length;

  this.length = this.index.length;

  return diff;
};

Lines.prototype.shift = function(y, diff) {
  for (var i = y; i < this.index.length; i++) {
    this.index[i] += diff;
  }
};

Lines.prototype.copy = function() {
  var lines = new Lines;
  lines.index = this.index.slice();
  lines.tail = this.tail;
  lines.length = this.length;
  return lines;
};

Lines.count = function(text) {
  return this.text.match(N).length;
};

function add(b) {
  return function(a) {
    return a + b;
  };
}

},{}],28:[function(require,module,exports){
// var WORD = /\w+/g;
var WORD = /[a-zA-Z0-9]{1,}/g
var rank = 0;

module.exports = PrefixTreeNode;

function PrefixTreeNode() {
  this.value = '';
  this.rank = 0;
  this.children = {};
}

PrefixTreeNode.prototype.getSortedChildren = function() {
  var children = Object
    .keys(this.children)
    .map((key) => this.children[key]);

  //TODO: only filter and sort in the end
  return children
    .reduce((p, n) => p.concat(n.getSortedChildren()), children)
    .filter((node) => node.value)
    .sort((a, b) => {
      var res = b.rank - a.rank;
      if (res === 0) res = b.value.length - a.value.length;
      if (res === 0) res = a.value > b.value;
      return res;
    });
};

PrefixTreeNode.prototype.collect = function(key) {
  var collection = [];
  var node = this.find(key);
  if (node) {
    collection = node.getSortedChildren();
    if (node.value) collection.push(node);
  }
  return collection;
};

PrefixTreeNode.prototype.find = function(key) {
  var node = this;
  for (var char in key) {
    if (key[char] in node.children) {
      node = node.children[key[char]];
    } else {
      return;
    }
  }
  return node;
};

PrefixTreeNode.prototype.insert = function(s, value) {
  var node = this;
  var i = 0;
  var n = s.length;

  while (i < n) {
    if (s[i] in node.children) {
      node = node.children[s[i]];
      i++;
    } else {
      break;
    }
  }

  while (i < n) {
    node =
    node.children[s[i]] =
    node.children[s[i]] || new PrefixTreeNode;
    i++;
  }

  node.value = s;
  node.rank++;
};

PrefixTreeNode.prototype.index = function(s) {
  var word;
  while (word = WORD.exec(s)) {
    this.insert(word[0]);
  }
};

},{}],29:[function(require,module,exports){

var Begin = /[\/'"`]/g;

var Match = {
  'single comment': ['//','\n'],
  'double comment': ['/*','*/'],
  'template string': ['`','`'],
  'single quote string': ["'","'"],
  'double quote string': ['"','"'],
  'regexp': ['/','/'],
};

var Skip = {
  'single quote string': "\\",
  'double quote string': "\\",
  'single comment': false,
  'double comment': false,
  'regexp': "\\",
};

var Token = {};
for (var key in Match) {
  var M = Match[key];
  Token[M[0]] = key;
}

var TOKEN = /(\/\*)|(\*\/)|(`)/g;

module.exports = Segments;

function Segments(buffer) {
  this.buffer = buffer;
  this.segments = [];
  this.clearCache();
}

var Length = {
  'open comment': 2,
  'close comment': 2,
  'template string': 1,
};

var NotOpen = {
  'close comment': true
};

var Closes = {
  'open comment': 'close comment',
  'template string': 'template string',
};

var Tag = {
  'open comment': 'comment',
  'template string': 'string',
};

Segments.prototype.get = function(y) {
  if (y in this.cache.state) return this.cache.state[y];

  var open = false;
  var state = null;
  var waitFor = '';
  var point = { x:-1, y:-1 };
  var close = 0;
  var segment;
  var range;
  var text;
  var valid;
  var last;

  var i = 0;

  //TODO: optimization:
  // cache segment y with open/close/state so we skip
  // iterating from the begin every time

  for (; i < this.segments.length; i++) {
    segment = this.segments[i];

    if (open) {
      if (waitFor === segment.type) {
        point = this.getPointOffset(segment.offset);
        if (!point) return (this.cache.state[y] = null);
        if (point.y >= y) return (this.cache.state[y] = Tag[state.type]);

        // console.log('close', segment.type, segment.offset, this.buffer.text.getRange([segment.offset, segment.offset + 10]))
        last = segment;
        last.point = point;
        state = null;
        open = false;
      }
    } else {
      point = this.getPointOffset(segment.offset);
      if (!point) return (this.cache.state[y] = null);

      range = point.line.range;

      if (last && last.point.y === point.y) {
        close = last.point.x + Length[last.type];
        // console.log('last one was', last.type, last.point.x, this.buffer.text.getRange([last.offset, last.offset + 10]))
      } else {
        close = 0;
      }
      valid = this.isValidRange([range[0], range[1]+1], segment, close);

      if (valid) {
        if (NotOpen[segment.type]) continue;
        // console.log('open', segment.type, segment.offset, this.buffer.text.getRange([segment.offset, segment.offset + 10]))
        open = true;
        state = segment;
        state.point = point;
        waitFor = Closes[state.type];
      }
    }
    if (point.y >= y) break;
  }
  if (state && state.point.y < y) return (this.cache.state[y] = Tag[state.type]);
  return (this.cache.state[y] = null);
};

Segments.prototype.getPointOffset = function(offset) {
  if (offset in this.cache.offset) return this.cache.offset[offset]
  return (this.cache.offset[offset] = this.buffer.lines.getOffset(offset));
};

Segments.prototype.isValidRange = function(range, segment, close) {
  var key = range.join();
  if (key in this.cache.range) return this.cache.range[key];
  var text = this.buffer.text.getRange(range);
  var valid = this.isValid(text, segment.offset - range[0], close);
  return (this.cache.range[key] = valid);
};

Segments.prototype.isValid = function(text, offset, lastIndex) {
  Begin.lastIndex = lastIndex;
  var match = Begin.exec(text);
  if (!match) return;

  i = match.index;

  last = i;

  var valid = true;

  outer:
  for (; i < text.length; i++) {
    var one = text[i];
    var next = text[i + 1];
    var two = one + next;
    if (i === offset) return true;

    var o = Token[two];
    if (!o) o = Token[one];
    if (!o) {
      continue;
    }

    var waitFor = Match[o][1];

    // console.log('start', i, o)
    last = i;

    switch (waitFor.length) {
      case 1:
        while (++i < text.length) {
          one = text[i];

          if (one === Skip[o]) {
            ++i;
            continue;
          }

          if (waitFor === one) {
            i += 1;
            break;
          }

          if ('\n' === one && !valid) {
            valid = true;
            i = last + 1;
            continue outer;
          }

          if (i === offset) {
            valid = false;
            continue;
          }
        }
        break;
      case 2:
        while (++i < text.length) {

          one = text[i];
          two = text[i] + text[i + 1];

          if (one === Skip[o]) {
            ++i;
            continue;
          }

          if (waitFor === two) {
            i += 2;
            break;
          }

          if ('\n' === one && !valid) {
            valid = true;
            i = last + 2;
            continue outer;
          }

          if (i === offset) {
            valid = false;
            continue;
          }
        }
        break;
    }
  }
  return valid;
}

Segments.prototype.getSegment = function(offset) {
  var begin = 0;
  var end = this.segments.length;
  if (!end) return;

  var p = -1;
  var i = -1;
  var b;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    b = this.segments[i];
    if (b.offset < offset) begin = i;
    else end = i;
  } while (p !== i);

  return {
    segment: b,
    index: i
  };
};

Segments.prototype.shift = function(offset, shift) {
  var s = this.getSegment(offset);
  if (!s) return;

  for (var i = s.index + 1; i < this.segments.length; i++) {
    this.segments[i].offset += shift;
  }

  // if (shift < 0) {
    // this.clearCache();
  // }
};

Segments.prototype.clearCache = function() {
  this.cache = {
    offset: {},
    range: {},
    state: {}
  };
};

Segments.prototype.index = function(text) {
  var match;

  var segments = this.segments = [];

  this.clearCache();

  while (match = TOKEN.exec(text)) {
    if (match['3']) segments.push(new Segment('template string', match.index));
    else if (match['1']) segments.push(new Segment('open comment', match.index));
    else if (match['2']) segments.push(new Segment('close comment', match.index));
  }
};

function Segment(type, offset) {
  this.type = type;
  this.offset = offset;
}

},{}],30:[function(require,module,exports){
/*

example search for offset `4` :
`o` are node's levels, `x` are traversal steps

x
x
o-->x   o   o
o o x   o   o o o
o o o-x o o o o o
1 2 3 4 5 6 7 8 9

*/

log = console.log.bind(console);

module.exports = SkipString;

function Node(value, level) {
  this.value = value;
  this.level = level;
  this.width = new Array(this.level).fill(value && value.length || 0);
  this.next = new Array(this.level).fill(null);
}

Node.prototype = {
  get length() {
    return this.width[0];
  }
};

function SkipString(o) {
  o = o || {};
  this.levels = o.levels || 11;
  this.bias = o.bias || 1 / Math.E;
  this.head = new Node(null, this.levels);
  this.chunkSize = o.chunkSize;
}

SkipString.prototype = {
  get length() {
    return this.head.width[this.levels - 1];
  }
};

SkipString.prototype.get = function(offset) {
  // great hack to do offset >= for .search()
  // we don't have fractions anyway so..
  return this.search(offset, true);
};

SkipString.prototype.set = function(text) {
  this.insertChunked(0, text);
};

SkipString.prototype.search = function(offset, incl) {
  incl = incl ? .1 : 0;

  // prepare to hold steps
  var steps = new Array(this.levels);
  var width = new Array(this.levels);

  // iterate levels down, skipping top
  var i = this.levels;
  var node = this.head;

  while (i--) {
    while (offset + incl > node.width[i] && null != node.next[i]) {
      offset -= node.width[i];
      node = node.next[i];
    }
    steps[i] = node;
    width[i] = offset;
  }

  return {
    node: node,
    steps: steps,
    width: width,
    offset: offset
  };
};

SkipString.prototype.splice = function(s, offset, value, level) {
  var steps = s.steps; // skip steps left of the offset
  var width = s.width;

  var p; // left node or `p`
  var q; // right node or `q` (our new node)
  var len;

  // create new node
  level = level || this.randomLevel();
  q = new Node(value, level);
  length = q.width[0];

  // iterator
  var i;

  // iterate steps levels below new node level
  i = level;
  while (i--) {
    p = steps[i]; // get left node of this level step
    q.next[i] = p.next[i]; // insert so inherit left's next
    p.next[i] = q; // left's next is now our new node
    q.width[i] = p.width[i] - width[i] + length;
    p.width[i] = width[i];
  }

  // iterate steps all levels down until except new node level
  i = this.levels;
  while (i-- > level) {
    p = steps[i]; // get left node of this level
    p.width[i] += length; // add new node width
  }

  // return new node
  return q;
};

SkipString.prototype.insert = function(offset, value, level) {
  var s = this.search(offset);

  // if search falls in the middle of a string
  // insert it there instead of creating a new node
  if (s.offset && s.node.value && s.offset < s.node.value.length) {
    this.update(s, insert(s.offset, s.node.value, value));
    return s.node;
  }

  return this.splice(s, offset, value, level);
};

SkipString.prototype.update = function(s, value) {
  // values length difference
  var length = s.node.value.length - value.length;

  // update value
  s.node.value = value;

  // iterator
  var i;

  // fix widths on all levels
  i = this.levels;

  while (i--) {
    s.steps[i].width[i] -= length;
  }

  return length;
};

SkipString.prototype.remove = function(range) {
  if (range[1] > this.length) {
    throw new Error(
      'range end over maximum length(' +
      this.length + '): [' + range.join() + ']'
    );
  }

  // remain distance to remove
  var x = range[1] - range[0];

  // search for node on left edge
  var s = this.search(range[0]);
  var offset = s.offset;
  var steps = s.steps;
  var node = s.node;

  // skip head
  if (this.head === node) node = node.next[0];

  // slice left edge when partial
  if (offset) {
    if (offset < node.width[0]) {
      x -= this.update(s,
        node.value.slice(0, offset) +
        node.value.slice(
          offset +
          Math.min(x, node.length - offset)
        )
      );
    }

    node = node.next[0];

    if (!node) return;
  }

  // remove all full nodes in range
  while (node && x >= node.width[0]) {
    x -= this.removeNode(steps, node);
    node = node.next[0];
  }

  // slice right edge when partial
  if (x) {
    this.replace(steps, node, node.value.slice(x));
  }
};

SkipString.prototype.removeNode = function(steps, node) {
  var length = node.width[0];

  var i;

  i = node.level;
  while (i--) {
    steps[i].width[i] -= length - node.width[i];
    steps[i].next[i] = node.next[i];
  }

  i = this.levels;
  while (i-- > node.level) {
    steps[i].width[i] -= length;
  }

  return length;
};

SkipString.prototype.replace = function(steps, node, value) {
  var length = node.value.length - value.length;

  node.value = value;

  var i;
  i = node.level;
  while (i--) {
    node.width[i] -= length;
  }

  i = this.levels;
  while (i-- > node.level) {
    steps[i].width[i] -= length;
  }

  return length;
};

SkipString.prototype.removeCharAt = function(offset) {
  return this.remove([offset, offset+1]);
};

SkipString.prototype.insertChunked = function(offset, text) {
  for (var i = 0; i < text.length; i += this.chunkSize) {
    var chunk = text.substr(i, this.chunkSize);
    this.insert(i + offset, chunk);
  }
};

SkipString.prototype.substring = function(a, b) {
  a = a || 0;
  b = b || this.length;
  var length = b - a;

  var search = this.search(a, true);
  var node = search.node;
  if (this.head === node) node = node.next[0];
  var d = length + search.offset;
  var s = '';
  while (node && d >= 0) {
    d -= node.width[0];
    s += node.value;
    node = node.next[0];
  }
  if (node) {
    s += node.value;
  }

  return s.substr(search.offset, length);
};

SkipString.prototype.randomLevel = function() {
  var level = 1;
  while (level < this.levels - 1 && Math.random() < this.bias) level++;
  return level;
};

SkipString.prototype.getRange = function(range) {
  range = range || [];
  return this.substring(range[0], range[1]);
};

SkipString.prototype.copy = function() {
  var copy = new SkipString;
  var node = this.head;
  var offset = 0;
  while (node = node.next[0]) {
    copy.insert(offset, node.value);
    offset += node.width[0];
  }
  return copy;
};

SkipString.prototype.joinString = function(delimiter) {
  var parts = [];
  var node = this.head;
  while (node = node.next[0]) {
    parts.push(node.value);
  }
  return parts.join(delimiter);
};

SkipString.prototype.toString = function() {
  return this.substring();
};

function trim(s, left, right) {
  return s.substr(0, s.length - right).substr(left);
}

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}

},{}],31:[function(require,module,exports){
var Regexp = require('../../lib/regexp');
var R = Regexp.create;

//NOTE: order matters
var syntax = map({
  'operator': R(['operator'], 'g', entities),
  'params':   R(['params'],   'g'),
  'declare':  R(['declare'],  'g'),
  'function': R(['function'], 'g'),
  'keyword':  R(['keyword'],  'g'),
  'builtin':  R(['builtin'],  'g'),
  'indent':   R(['indent'],   'gm'),
  'symbol':   R(['symbol'],   'g'),
  'string':   R(['template string'], 'g'),
  'number':   R(['special','number'], 'g'),
}, compile);

var Indent = compile(R(['indent'], 'gm'), 'indent');

var Blocks = R(['comment','string','regexp'], 'gm');

var Tag = {
  '//': 'comment',
  '/*': 'comment',
  '`': 'string',
  '"': 'string',
  "'": 'string',
  '/': 'regexp',
};

module.exports = Syntax;

function Syntax(o) {
  o = o || {};
  this.maxLine = o.maxLine || 300;
  this.blocks = [];
}

Syntax.prototype.entities = entities;

Syntax.prototype.highlight = function(code, offset) {
  // console.log(0, 'highlight', code)

  code = this.createIndents(code);
  code = this.createBlocks(code);
  code = entities(code);

  for (var key in syntax) {
    code = code.replace(syntax[key].regexp, syntax[key].replacer);
  }

  code = this.restoreBlocks(code);

  code = code.replace(Indent.regexp, Indent.replacer);

  // code = code.replace(/\ueeee/g, function() {
  //   return long.shift().slice(0, this.maxLine) + '...line too long to display';
  // });

  return code;
};

Syntax.prototype.createIndents = function(code) {
  var lines = code.split(/\n/g);
  if (lines.length <= 2) return code;

  var line;
  var long = [];
  var match;
  var firstIndent = 0;
  var i = 0;

  // for (; i < lines.length; i++) {
  //   line = lines[i];
  //   if (line.length > this.maxLine) {
  //     long.push(lines.splice(i--, 1, '\ueeee'));
  //   }
  // }

  i = 0;
  line = lines[i];
  // console.log(line)
  while (!(match = /\S/g.exec(line))) {
    line = lines[++i];
    // console.log(line)
  }
  for (var j = 0; j < i; j++) {
    lines[j] = new Array(match.index + 1).join(' ');
  }
  var prev;
  for (; i < lines.length; i++) {
    line = lines[i];
    prev = lines[i-1];
    if (!line.length && prev.length && prev[0] === ' ' && prev[prev.length-1] !== '/') lines[i] = ' ';
  }

  code = lines.join('\n');

  return code;
};

Syntax.prototype.restoreBlocks = function(code) {
  var block;
  var blocks = this.blocks;
  var n = 0;
  return code.replace(/\uffeb/g, function() {
    block = blocks[n++]
    var tag = identify(block);
    return '<'+tag+'>'+entities(block)+'</'+tag+'>';
  });
};

Syntax.prototype.createBlocks = function(code) {
  this.blocks = [];
  code = code.replace(Blocks, (block) => {
    this.blocks.push(block);
    return '\uffeb';
  });
  return code;
};

function createId() {
  var alphabet = 'abcdefghijklmnopqrstuvwxyz';
  var length = alphabet.length - 1;
  var i = 6;
  var s = '';
  while (i--) {
    s += alphabet[Math.random() * length | 0];
  }
  return s;
}

function entities(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    ;
}

function compile(regexp, tag) {
  var openTag = '<' + tag + '>';
  var closeTag = '</' + tag + '>';
  return {
    name: tag,
    regexp: regexp,
    replacer: openTag + '$&' + closeTag
  };
}

function map(obj, fn) {
  var result = {};
  for (var key in obj) {
    result[key] = fn(obj[key], key);
  }
  return result;
}

function replace(pass, code) {
  for (var i = 0; i < pass.length; i++) {
    code = code.replace(pass[i][0], pass[i][1]);
  }
  return code;
}

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}

function identify(block) {
  var one = block[0];
  var two = one + block[1];
  return Tag[two] || Tag[one];
}

},{"../../lib/regexp":20}],32:[function(require,module,exports){
var open = require('../lib/open');
var save = require('../lib/save');
var Event = require('../lib/event');
var Buffer = require('./buffer');

module.exports = File;

function File(editor) {
  Event.call(this);

  this.root = '';
  this.path = 'untitled';
  this.buffer = new Buffer;
  this.bindEvent();
}

File.prototype.__proto__ = Event.prototype;

File.prototype.bindEvent = function() {
  this.buffer.on('raw', this.emit.bind(this, 'raw'));
  this.buffer.on('set', this.emit.bind(this, 'set'));
  this.buffer.on('update', this.emit.bind(this, 'change'));
  this.buffer.on('before update', this.emit.bind(this, 'before change'));
};

File.prototype.open = function(path, root, fn) {
  this.path = path;
  this.root = root;
  open(root + path, (err, text) => {
    if (err) {
      this.emit('error', err);
      fn && fn(err);
      return;
    }
    this.buffer.set(text);
    this.emit('open');
    fn && fn(null, this);
  });
};

File.prototype.save = function(fn) {
  save(this.root + this.path, this.buffer.get(), fn || noop);
};

File.prototype.set = function(text) {
  this.buffer.set(text);
  this.emit('set');
};

function noop() {/* noop */}

},{"../lib/event":11,"../lib/open":14,"../lib/save":21,"./buffer":25}],33:[function(require,module,exports){
var Event = require('../lib/event');
var debounce = require('../lib/debounce');

/*
   . .
-1 0 1 2 3 4 5
   n

 */

module.exports = History;

function History(editor) {
  this.editor = editor;
  this.log = [];
  this.needle = 0;
  this.timeout = true;
  this.timeStart = 0;
}

History.prototype.__proto__ = Event.prototype;

History.prototype.save = function() {
  if (Date.now() - this.timeStart > 2000) this.actuallySave();
  this.timeout = this.debouncedSave();
};

History.prototype.debouncedSave = debounce(function() {
  this.actuallySave();
}, 700);

History.prototype.actuallySave = function() {
  // console.log('save', this.needle)
  clearTimeout(this.timeout);
  this.log = this.log.slice(0, ++this.needle);
  this.log.push(this.commit());
  this.needle = this.log.length;
  this.timeStart = Date.now();
  this.timeout = false;
};

History.prototype.undo = function() {
  if (this.timeout !== false) this.actuallySave();

  if (this.needle > this.log.length - 1) this.needle = this.log.length - 1;

  this.needle--;

  if (this.needle < 0) this.needle = 0;
  // console.log('undo', this.needle, this.log.length - 1)

  this.checkout(this.needle);
};

History.prototype.redo = function() {
  if (this.timeout !== false) this.actuallySave();

  this.needle++;
  // console.log('redo', this.needle, this.log.length - 1)

  if (this.needle > this.log.length - 1) this.needle = this.log.length - 1;

  this.checkout(this.needle);
};

History.prototype.checkout = function(n) {
  var commit = this.log[n];
  if (!commit) return;
  this.editor.mark.active = commit.markActive;
  this.editor.mark.set(commit.mark.copy());
  this.editor.setCaret(commit.caret.copy());
  this.editor.buffer.text = commit.text.copy();
  this.editor.buffer.lines = commit.lines.copy();
  this.emit('change');
};

History.prototype.commit = function() {
  return {
    text: this.editor.buffer.text.copy(),
    lines: this.editor.buffer.lines.copy(),
    caret: this.editor.caret.copy(),
    mark: this.editor.mark.copy(),
    markActive: this.editor.mark.active
  };
};

},{"../lib/debounce":6,"../lib/event":11}],34:[function(require,module,exports){
var throttle = require('../../lib/throttle');

var PAGING_THROTTLE = 70;

var keys = module.exports = {
  'ctrl+z': function() {
    this.history.undo();
  },
  'ctrl+y': function() {
    this.history.redo();
  },

  'home': function() {
    this.move.beginOfLine();
  },
  'end': function() {
    this.move.endOfLine();
  },
  'pageup': throttle(function() {
    this.move.pageUp();
  }, PAGING_THROTTLE),
  'pagedown': throttle(function() {
    this.move.pageDown();
  }, PAGING_THROTTLE),
  'ctrl+up': throttle(function() {
    this.move.pageUp(6);
  }, PAGING_THROTTLE),
  'ctrl+down': throttle(function() {
    this.move.pageDown(6);
  }, PAGING_THROTTLE),
  'left': function() {
    this.move.byChars(-1);
  },
  'up': function() {
    this.move.byLines(-1);
  },
  'right': function() {
    this.move.byChars(+1);
  },
  'down': function() {
    this.move.byLines(+1);
  },

  'ctrl+left': function() {
    this.move.byWord(-1);
  },
  'ctrl+right': function() {
    this.move.byWord(+1);
  },

  'ctrl+a': function() {
    this.markClear(true);
    this.move.beginOfFile(null, true);
    this.markBegin();
    this.move.endOfFile(null, true);
    this.markSet();
  },

  'ctrl+shift+up': function() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(-1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(-1, true);
    } else {
      this.buffer.moveAreaByLines(-1, this.mark.get());
      this.mark.shiftByLines(-1);
      this.move.byLines(-1, true);
    }
  },
  'ctrl+shift+down': function() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(+1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(+1, true);
    } else {
      this.buffer.moveAreaByLines(+1, this.mark.get());
      this.mark.shiftByLines(+1);
      this.move.byLines(+1, true);
    }
  },

  'enter': function() {
    this.insert('\n');
  },

  'backspace': function() {
    this.backspace();
  },
  'delete': function() {
    this.delete();
  },
  'ctrl+backspace': function() {
    if (this.move.isBeginOfFile()) return;
    this.markClear(true);
    this.markBegin();
    this.move.byWord(-1, true);
    this.markSet();
    this.delete();
  },
  'shift+ctrl+backspace': function() {
    this.markClear(true);
    this.markBegin();
    this.move.beginOfLine(null, true);
    this.markSet();
    this.delete();
  },
  'ctrl+delete': function() {
    if (this.move.isEndOfFile()) return;
    this.markClear(true);
    this.markBegin();
    this.move.byWord(+1, true);
    this.markSet();
    this.backspace();
  },
  'shift+ctrl+delete': function() {
    this.markClear(true);
    this.markBegin();
    this.move.endOfLine(null, true);
    this.markSet();
    this.backspace();
  },
  'shift+delete': function() {
    this.markClear(true);
    this.move.beginOfLine(null, true);
    this.markBegin();
    this.move.endOfLine(null, true);
    this.move.byChars(+1, true);
    this.markSet();
    this.backspace();
  },

  'shift+ctrl+d': function() {
    this.markBegin(false);
    var add = 0;
    var area = this.mark.get();
    var lines = area.end.y - area.begin.y;
    if (lines && area.end.x > 0) add += 1;
    if (!lines) add += 1;
    lines += add;
    var text = this.buffer.getArea(area.setLeft(0).addBottom(add));
    this.buffer.insert({ x: 0, y: area.end.y }, text);
    this.mark.shiftByLines(lines);
    this.move.byLines(lines, true);
  },

  'shift+ctrl+up': function() {
    this.markBegin(false);
    var area = this.mark.get();
    if (this.buffer.moveAreaByLines(-1, area)) {
      this.mark.shiftByLines(-1);
      this.move.byLines(-1, true);
    }
  },

  'shift+ctrl+down': function() {
    this.markBegin(false);
    var area = this.mark.get();
    if (this.buffer.moveAreaByLines(+1, area)) {
      this.mark.shiftByLines(+1);
      this.move.byLines(+1, true);
    }
  },

  'tab': function() {
    var res = this.suggest();
    if (!res) {
      this.insert('  ');
    } else {
      this.markSetArea(res.area);
      this.insert(res.node.value);
    }
  },

  'ctrl+f': function() {
    this.find.open();
  },

  'f3': function() {
    this.findJump(+1);
  },
  'shift+f3': function() {
    this.findJump(-1);
  },

  'ctrl+/': function() {
    var add;
    var area;
    var text;

    var clear = false;
    var caret = this.caret.copy();

    if (!this.mark.active) {
      clear = true;
      this.markClear();
      this.move.beginOfLine(null, true);
      this.markBegin();
      this.move.endOfLine(null, true);
      this.markSet();
      area = this.mark.get();
      text = this.buffer.getArea(area);
    } else {
      area = this.mark.get();
      this.mark.addBottom(area.end.x > 0).setLeft(0);
      text = this.buffer.getArea(this.mark.get());
    }

    //TODO: should check if last line has // also
    if (text.trimLeft().substr(0,2) === '//') {
      add = -3;
      text = text.replace(/^(.*?)\/\/ (.+)/gm, '$1$2');
    } else {
      add = +3;
      text = text.replace(/^([\s]*)(.+)/gm, '$1// $2');
    }

    this.insert(text);

    this.mark.set(area.addRight(add));
    this.mark.active = !clear;

    if (caret.x) caret.addRight(add);
    this.setCaret(caret);

    if (clear) {
      this.markClear();
    }
  },

  'shift+ctrl+/': function() {
    var clear = false;
    var add = 0;
    if (!this.mark.active) clear = true;
    var caret = this.caret.copy();
    this.markBegin(false);
    var area = this.mark.get();
    var text = this.buffer.getArea(area);
    if (text.slice(0,2) === '/*' && text.slice(-2) === '*/') {
      text = text.slice(2,-2);
      add -= 2;
      if (area.end.y === area.begin.y) add -= 2;
    } else {
      text = '/*' + text + '*/';
      add += 2;
      if (area.end.y === area.begin.y) add += 2;
    }
    this.insert(text);
    area.end.x += add;
    this.mark.set(area);
    this.mark.active = !clear;
    this.setCaret(caret.addRight(add));
    if (clear) {
      this.markClear();
    }
  },
};

keys.single = {
  //
};

// selection keys
[ 'home','end',
  'pageup','pagedown',
  'left','up','right','down',
  'ctrl+left','ctrl+right'
].forEach(function(key) {
  keys['shift+'+key] = function(e) {
    this.markBegin();
    keys[key].call(this, e);
    this.markSet();
  };
});

},{"../../lib/throttle":23}],35:[function(require,module,exports){
var Event = require('../../lib/event');
var Mouse = require('./mouse');
var Text = require('./text');

module.exports = Input;

function Input(editor) {
  this.editor = editor;
  this.mouse = new Mouse(this);
  this.text = new Text;
  this.bindEvent();
}

Input.prototype.__proto__ = Event.prototype;

Input.prototype.bindEvent = function() {
  this.blur = this.blur.bind(this);
  this.focus = this.focus.bind(this);
  this.text.on(['key', 'text'], this.emit.bind(this, 'input'));
  this.text.on('focus', this.emit.bind(this, 'focus'));
  this.text.on('blur', this.emit.bind(this, 'blur'));
  this.text.on('text', this.emit.bind(this, 'text'));
  this.text.on('keys', this.emit.bind(this, 'keys'));
  this.text.on('key', this.emit.bind(this, 'key'));
  this.text.on('cut', this.emit.bind(this, 'cut'));
  this.text.on('copy', this.emit.bind(this, 'copy'));
  this.text.on('paste', this.emit.bind(this, 'paste'));
  this.mouse.on('up', this.emit.bind(this, 'mouseup'));
  this.mouse.on('click', this.emit.bind(this, 'mouseclick'));
  this.mouse.on('down', this.emit.bind(this, 'mousedown'));
  this.mouse.on('drag', this.emit.bind(this, 'mousedrag'));
  this.mouse.on('drag begin', this.emit.bind(this, 'mousedragbegin'));
};

Input.prototype.use = function(node) {
  this.mouse.use(node);
  this.text.reset();
};

Input.prototype.blur = function() {
  this.text.blur();
};

Input.prototype.focus = function() {
  this.text.focus();
};

},{"../../lib/event":11,"./mouse":36,"./text":37}],36:[function(require,module,exports){
var Event = require('../../lib/event');
var debounce = require('../../lib/debounce');
var Point = require('../../lib/point');

module.exports = Mouse;

function Mouse() {
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
    this.node.removeEventListener('mousedown', this.ondown);
    // this.node.removeEventListener('mouseup', this.onup);
  }
  this.node = node;
  this.node.addEventListener('mousedown', this.ondown);
  // this.node.addEventListener('mouseup', this.onup);
};

Mouse.prototype.ondown = function(e) {
  this.point = this.down = this.getPoint(e);
  this.emit('down', e);
  this.onclick(e);
  this.maybeDrag();
};

Mouse.prototype.onup = function(e) {
  this.emit('up', e);
  if (!this.down) return;
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

},{"../../lib/debounce":6,"../../lib/event":11,"../../lib/point":16}],37:[function(require,module,exports){
var dom = require('../../lib/dom');
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var Event = require('../../lib/event');

var THROTTLE = 1000/75;

var map = {
  8: 'backspace',
  9: 'tab',
  13: 'enter',
  33: 'pageup',
  34: 'pagedown',
  35: 'end',
  36: 'home',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  46: 'delete',
  48: '0',
  49: '1',
  50: '2',
  51: '3',
  52: '4',
  53: '5',
  54: '6',
  55: '7',
  56: '8',
  57: '9',
  65: 'a',
  68: 'd',
  70: 'f',
  77: 'm',
  78: 'n',
  83: 's',
  89: 'y',
  90: 'z',
  112: 'f1',
  114: 'f3',
  122: 'f11',
  188: ',',
  190: '.',
  191: '/',

  // numpad
  97: 'end',
  98: 'down',
  99: 'pagedown',
  100: 'left',
  102: 'right',
  103: 'home',
  104: 'up',
  105: 'pageup',
};

module.exports = Text;

Text.map = map;

function Text() {
  Event.call(this);

  this.el = document.createElement('input');

  dom.style(this, {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0
  });

  dom.attrs(this, {
    autocapitalize: 'none'
  });

  this.throttleTime = 0;
  this.modifiers = {};
  this.bindEvent();
}

Text.prototype.__proto__ = Event.prototype;

Text.prototype.bindEvent = function() {
  this.oncut = this.oncut.bind(this);
  this.oncopy = this.oncopy.bind(this);
  this.onpaste = this.onpaste.bind(this);
  this.oninput = this.oninput.bind(this);
  this.onkeydown = this.onkeydown.bind(this);
  this.onkeyup = this.onkeyup.bind(this);
  this.el.onblur = this.emit.bind(this, 'blur');
  this.el.onfocus = this.emit.bind(this, 'focus');
  this.el.oninput = this.oninput;
  this.el.onkeydown = this.onkeydown;
  this.el.onkeyup = this.onkeyup;
  this.el.oncut = this.oncut;
  this.el.oncopy = this.oncopy;
  this.el.onpaste = this.onpaste;
};

Text.prototype.reset = function() {
  this.set('');
  this.modifiers = {};
}

Text.prototype.get = function() {
  return this.el.value.substr(-1);
};

Text.prototype.set = function(value) {
  this.el.value = value;
};

//TODO: on mobile we need to clear without debounce
// or the textarea content is displayed in hacker's keyboard
// or you need to disable word suggestions in hacker's keyboard settings
Text.prototype.clear = throttle(function() {
  this.set('');
}, 2000);

Text.prototype.blur = function() {
  // console.log('focus')
  this.el.blur();
};

Text.prototype.focus = function() {
  // console.log('focus')
  this.el.focus();
};

Text.prototype.oninput = function(e) {
  e.preventDefault();
  // forces caret to end of textarea so we can get .slice(-1) char
  setImmediate(() => this.el.selectionStart = this.el.value.length);
  this.emit('text', this.get());
  this.clear();
  return false;
};

Text.prototype.onkeydown = function(e) {
  // console.log(e.which);
  var now = Date.now();
  if (now - this.throttleTime < THROTTLE) {
    e.preventDefault();
    return false;
  }
  this.throttleTime = now;

  var m = this.modifiers;
  m.shift = e.shiftKey;
  m.ctrl = e.ctrlKey;
  m.alt = e.altKey;

  var keys = [];
  if (m.shift) keys.push('shift');
  if (m.ctrl) keys.push('ctrl');
  if (m.alt) keys.push('alt');
  if (e.which in map) keys.push(map[e.which]);

  if (keys.length) {
    var press = keys.join('+');
    this.emit('keys', press, e);
    this.emit(press, e);
    keys.forEach((press) => this.emit('key', press, e));
  }
};

Text.prototype.onkeyup = function(e) {
  this.throttleTime = 0;

  var m = this.modifiers;

  var keys = [];
  if (m.shift && !e.shiftKey) keys.push('shift:up');
  if (m.ctrl && !e.ctrlKey) keys.push('ctrl:up');
  if (m.alt && !e.altKey) keys.push('alt:up');

  m.shift = e.shiftKey;
  m.ctrl = e.ctrlKey;
  m.alt = e.altKey;

  if (m.shift) keys.push('shift');
  if (m.ctrl) keys.push('ctrl');
  if (m.alt) keys.push('alt');
  if (e.which in map) keys.push(map[e.which] + ':up');

  if (keys.length) {
    var press = keys.join('+');
    this.emit('keys', press, e);
    this.emit(press, e);
    keys.forEach((press) => this.emit('key', press, e));
  }
};

Text.prototype.oncut = function(e) {
  e.preventDefault();
  this.emit('cut', e);
};

Text.prototype.oncopy = function(e) {
  e.preventDefault();
  this.emit('copy', e);
};

Text.prototype.onpaste = function(e) {
  e.preventDefault();
  this.emit('paste', e);
};

},{"../../lib/debounce":6,"../../lib/dom":10,"../../lib/event":11,"../../lib/throttle":23}],38:[function(require,module,exports){
var Regexp = require('../lib/regexp');
var Event = require('../lib/event');
var Point = require('../lib/point');

var WORDS = Regexp.create(['words'], 'g');

module.exports = Move;

function Move(editor) {
  Event.call(this);
  this.editor = editor;
  this.lastDeliberateX = 0;
}

Move.prototype.__proto__ = Event.prototype;

Move.prototype.pageDown = function(div) {
  div = div || 1;
  var page = this.editor.page.height / div | 0;
  var size = this.editor.size.height / div | 0;
  var remainder = size - page * this.editor.char.height | 0;
  this.editor.animateScrollBy(0, size - remainder);
  return this.byLines(page);
};

Move.prototype.pageUp = function(div) {
  div = div || 1;
  var page = this.editor.page.height / div | 0;
  var size = this.editor.size.height / div | 0;
  var remainder = size - page * this.editor.char.height | 0;
  this.editor.animateScrollBy(0, -(size - remainder));
  return this.byLines(-page);
};

var move = {};

move.byWord = function(buffer, p, dx) {
  var line = buffer.getLine(p.y);

  if (dx > 0 && p.x >= line.length - 1) { // at end of line
    return move.byChars(buffer, p, +1); // move one char right
  } else if (dx < 0 && p.x === 0) { // at begin of line
    return move.byChars(buffer, p, -1); // move one char left
  }

  var words = Regexp.parse(line, WORDS);
  var word;

  if (dx < 0) words.reverse();

  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (dx > 0
      ? word.index > p.x
      : word.index < p.x) {
      return {
        x: word.index,
        y: p.y
      };
    }
  }

  // reached begin/end of file
  return dx > 0
    ? move.endOfLine(buffer, p)
    : move.beginOfLine(buffer, p);
};

move.byChars = function(buffer, p, dx) {
  var lines = buffer.lines;
  var x = p.x;
  var y = p.y;

  if (dx < 0) { // going left
    x += dx; // move left
    if (x < 0) { // when past left edge
      if (y > 0) { // and lines above
        y -= 1; // move up a line
        x = lines.getLineLength(y); // and go to the end of line
      } else {
        x = 0;
      }
    }
  } else if (dx > 0) { // going right
    x += dx; // move right
    while (x - lines.getLineLength(y) > 0) { // while past line length
      if (y === lines.length) { // on end of file
        x = lines.getLineLength(y); // go to end of line on last line
        break; // and exit
      }
      x -= lines.getLineLength(y) + 1; // wrap this line length
      y += 1; // and move down a line
    }
  }

  this.lastDeliberateX = x;

  return {
    x: x,
    y: y
  };
};

move.byLines = function(buffer, p, dy) {
  var lines = buffer.lines;
  var x = p.x;
  var y = p.y;

  if (dy < 0) { // going up
    if (y + dy > 0) { // when lines above
      y += dy; // move up
    } else {
      y = 0;
    }
  } else if (dy > 0) { // going down
    if (y < lines.length - dy) { // when lines below
      y += dy; // move down
    } else {
      y = lines.length;
    }
  }

  // if (x > lines.getLine(y).length) {
  //   x = lines.getLine(y).length;
  // } else {
  // }
  x = Math.min(this.lastDeliberateX, lines.getLine(y).length);

  return {
    x: x,
    y: y
  };
};

move.beginOfLine = function(_, p) {
  this.lastDeliberateX = 0;
  return {
    x: 0,
    y: p.y
  };
};

move.endOfLine = function(buffer, p) {
  var x = buffer.lines.getLine(p.y).length;
  this.lastDeliberateX = Infinity;
  return {
    x: x,
    y: p.y
  };
};

move.beginOfFile = function() {
  this.lastDeliberateX = 0;
  return {
    x: 0,
    y: 0
  };
};

move.endOfFile = function(buffer) {
  var last = buffer.lines.length;
  var x = buffer.lines.getLine(last).length
  this.lastDeliberateX = x;
  return {
    x: x,
    y: last
  };
};

move.isBeginOfFile = function(_, p) {
  return p.x === 0 && p.y === 0;
};

move.isEndOfFile = function(buffer, p) {
  var last = buffer.loc;
  return p.y === last && p.x === buffer.lines.getLineLength(last);
};

Object.keys(move).forEach(function(method) {
  Move.prototype[method] = function(param, byEdit) {
    var result = move[method].call(
      this,
      this.editor.buffer,
      this.editor.caret,
      param
    );

    if ('is' === method.slice(0,2)) return result;

    this.emit('move', result, byEdit);
  };
});

},{"../lib/event":11,"../lib/point":16,"../lib/regexp":20}],39:[function(require,module,exports){
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
},{}],40:[function(require,module,exports){
var dom = require('../lib/dom');
var css = require('./style.css');

var themes = {
  monokai: {
    background: '#272822',
    color: '#F8F8F2',
    keyword: '#DF2266',
    function: '#A0D92E',
    declare: '#61CCE0',
    number: '#AB7FFB',
    params: '#FD971F',
    comment: '#75715E',
    string: '#E6DB74',
  },

  western: {
    background: '#D9D1B1',
    color: '#000000',
    keyword: '#7A3B3B',
    function: '#256F75',
    declare: '#634256',
    number: '#134D26',
    params: '#082663',
    comment: '#998E6E',
    string: '#C43C3C',
  },

  ergonom: {
    background: '#271E16',
    color: '#E9E3D1',
    keyword: '#A13630',
    function: '#B3DF02',
    declare: '#F63833',
    number: '#FF9F4E',
    params: '#A090A0',
    regexp: '#BD70F4',
    comment: '#635047',
    string: '#3EA1FB',
  },

  daylight: {
    background: '#EBEBEB',
    color: '#000000',
    keyword: '#FF1B1B',
    function: '#0005FF',
    declare: '#0C7A00',
    number: '#8021D4',
    params: '#4C6969',
    comment: '#ABABAB',
    string: '#E67000',
  },
};

exports = module.exports = setTheme;
exports.themes = themes;

function setTheme(name) {
  var t = themes[name];
  dom.css('theme',
`
.${name} {
  background: ${t.background};
}

operator,
keyword {
  color: ${t.keyword};
}

declare,
builtin {
  color: ${t.declare};
}

boolean,
number {
  color: ${t.number};
}

params {
  color: ${t.params};
}

function {
  color: ${t.function};
  font-style: normal;
}

regexp {
  color: ${t.regexp || t.params};
}

comment {
  color: ${t.comment};
}

string {
  color: ${t.string};
}

symbol,
.${css.code} {
  color: ${t.color};
}

.${css.caret} {
  background: ${t.color};
}

params,
declare {
  font-style: italic;
}

symbol {
  font-style: normal;
}

indent {
  display: inline-block;
  background-repeat: repeat;
}
`
  )

}


},{"../lib/dom":10,"./style.css":39}],41:[function(require,module,exports){
var Layer = require('./layer');
var template = require('./template');

module.exports = Block;

function Block(name, editor, template) {
  Layer.call(this, name, editor, template, 1);
}

Block.prototype.__proto__ = Layer.prototype;

Block.prototype.render = function() {
  this.renderPage(1, true);
};

},{"./layer":45,"./template":48}],42:[function(require,module,exports){
var dom = require('../../lib/dom');
var Range = require('../../lib/range');
var Layer = require('./layer');
var template = require('./template');

module.exports = Code;

function Code(name, editor, template) {
  Layer.call(this, name, editor, template, 10);
}

Code.prototype.__proto__ = Layer.prototype;

Code.prototype.render = function() {
  var layer = this;
  var views = this.views;
  var e = this.editor;

  // this.clear();
  // return this.renderPage(0, true);
  if (!e.editing) return this.renderAhead();

  var y = e.editLine;
  var g = e.editRange.slice();
  var shift = e.editShift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isBegin = g[0] + isBackspace === 0;
  var isEnd = g[1] + isEnter === e.rows;

  if (shift) {
    if (isEnter && !isEnd) this.shiftViewsBelow(g[0], shift);
    else if (isBackspace && !isBegin) this.shiftViewsBelow(g[0], shift);
  }

  this.updateRange(g);
  this.renderPage(0);
};

},{"../../lib/dom":10,"../../lib/range":19,"./layer":45,"./template":48}],43:[function(require,module,exports){
var Layer = require('./layer');
var template = require('./template');

module.exports = Find;

function Find(name, editor, template) {
  Layer.call(this, name, editor, template, 4);
}

Find.prototype.__proto__ = Layer.prototype;

Find.prototype.render = function() {
  if (!this.editor.find.isOpen || !this.editor.findResults.length) return;
  this.renderPage(0);
};

},{"./layer":45,"./template":48}],44:[function(require,module,exports){
var debounce = require('../../lib/debounce');
var template = require('./template');
var CodeView = require('./code');
var MarkView = require('./mark');
var RowsView = require('./rows');
var FindView = require('./find');
var BlockView = require('./block');
var View = require('./view');

module.exports = Views;

function Views(editor) {
  this.editor = editor;

  this.views = [
    new View('ruler', editor, template.ruler),
    new View('caret', editor, template.caret),
    new CodeView('code', editor, template.code),
    new MarkView('mark', editor, template.mark),
    new RowsView('rows', editor, template.rows),
    new FindView('find', editor, template.find),
    new BlockView('block', editor, template.block),
  ];

  this.views.forEach(view => this[view.name] = view);
  this.forEach = this.views.forEach.bind(this.views);

  this.block.render = debounce(this.block.render, 60);

  //TODO: needs to be set dynamically
  if (this.editor.options.hide_rows) this.rows.render = noop;
}

Views.prototype.clear = function() {
  this.forEach(view => view.clear());
},

Views.prototype.render = function() {
  this.forEach(view => view.render());
};

function noop() {/* noop */}

},{"../../lib/debounce":6,"./block":41,"./code":42,"./find":43,"./mark":46,"./rows":47,"./template":48,"./view":49}],45:[function(require,module,exports){
var dom = require('../../lib/dom');
var Event = require('../../lib/event');
var Range = require('../../lib/range');
var View = require('./view');
var css = require('../style.css');

module.exports = Layer;

function Layer(name, editor, template, length) {
  this.dom = dom(css.layer);
  this.name = name;
  this.editor = editor;
  this.template = template;
  this.views = this.create(length);
}

Layer.prototype.__proto__ = Event.prototype;

Layer.prototype.create = function(length) {
  var views = new Array(length);
  for (var i = 0; i < length; i++) {
    views[i] = new View(this.name, this.editor, this.template);
    dom.append(this, views[i]);
  }
  return views;
};

Layer.prototype.requestView = function() {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view.visible === false) return view;
  }
  return this.clear()[0];
};

Layer.prototype.getPageRange = function(range) {
  return this.editor.getPageRange(range);
};

Layer.prototype.inRangeViews = function(range) {
  var views = [];
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if ( view.visible === true
      && ( view[0] >= range[0] && view[0] <= range[1]
        || view[1] >= range[0] && view[1] <= range[1] ) ) {
      views.push(view);
    }
  }
  return views;
};

Layer.prototype.outRangeViews = function(range) {
  var views = [];
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if ( view.visible === false
      || view[1] < range[0]
      || view[0] > range[1] ) {
      views.push(view);
    }
  }
  return views.sort((a,b) => a.lastUsed - b.lastUsed);
};

Layer.prototype.renderRanges = function(ranges, views) {
  for (var n = 0, i = 0; i < ranges.length; i++) {
    var range = ranges[i];
    var view = views[n++];
    view.render(range);
  }
};

Layer.prototype.renderRange = function(range, include) {
  var visibleRange = this.getPageRange([0,0]);
  var inViews = this.inRangeViews(range);
  var outViews = this.outRangeViews(max(range, visibleRange));

  var needRanges = Range.NOT(range, inViews);
  var needViews = needRanges.length - outViews.length;
  // if ('code' === this.name) console.log('need:', needViews, needRanges.join(' '));
  // if ('code' === this.name) console.log('have:', this.views.join(' '));
  // if ('code' === this.name) console.log('out:', outViews.join(' '));
  // if ('code' === this.name) console.log('range', range, inViews.join(' '));
  if (needViews > 0) {
    this.clear();
    this.renderRanges([visibleRange], this.views);
    return;
  }
  else if (include) this.renderViews(inViews);
  this.renderRanges(needRanges, outViews);
};

Layer.prototype.renderViews = function(views) {
  for (var i = 0; i < views.length; i++) {
    views[i].render();
  }
};

Layer.prototype.renderLine = function(y) {
  this.renderRange([y,y], true);
};

Layer.prototype.renderPage = function(n, include) {
  n = n || 0;
  this.renderRange(this.getPageRange([-n,+n]), include);
};

Layer.prototype.renderAhead = function(include) {
  var views = this.views;
  var currentPageRange = this.getPageRange([0,0]);

  // no view is visible, render current page only
  if (Range.AND(currentPageRange, views).length === 0) {
    this.renderPage(0);
    return;
  }

  // check if we're past the threshold of view
  var aheadRange = this.getPageRange([-1,+1]);
  var aheadNeedRanges = Range.NOT(aheadRange, views);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders
    this.renderPage(2, include);
  }
};

/*

1  x
2 -x
3 -x
4 -
5
6

 */

Layer.prototype.spliceRange = function(range) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];

    if (view[1] < range[0] || view[0] > range[1]) {
      continue;
    }

    if (view[0] < range[0] && view[1] >= range[0]) { // shorten above
      view[1] = range[0] - 1;
      view.style();
    } else if (view[1] > range[1]) { // shorten below
      view[0] = range[1] + 1;
      view.render();
    } else if (view[0] === range[0] && view[1] === range[1]) { // current line
      view.render();
    } else {
      view.clear();
    }
  }
};

Layer.prototype.shiftViewsBelow = function(y, dy) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] <= y) continue;

    view[0] += dy;
    view[1] += dy;
    view.style();
  }
};

Layer.prototype.updateRange = function(range) {
  this.spliceRange(range);
  this.renderRange(range);
};

Layer.prototype.clear = function() {
  for (var i = 0; i < this.views.length; i++) {
    this.views[i].clear();
  }
  return this.views;
};

function max(a, b) {
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

},{"../../lib/dom":10,"../../lib/event":11,"../../lib/range":19,"../style.css":39,"./view":49}],46:[function(require,module,exports){
var dom = require('../../lib/dom');
var Range = require('../../lib/range');
var Layer = require('./layer');
var template = require('./template');

module.exports = Mark;

function Mark(name, editor, template) {
  Layer.call(this, name, editor, template, 1);
}

Mark.prototype.__proto__ = Layer.prototype;

Mark.prototype.render = function() {
  if (!this.editor.mark.active) return this.clear();
  this.renderPage(0, true);
};

},{"../../lib/dom":10,"../../lib/range":19,"./layer":45,"./template":48}],47:[function(require,module,exports){
var Layer = require('./layer');
var template = require('./template');

module.exports = Rows;

function Rows(name, editor, template) {
  Layer.call(this, name, editor, template, 5);
}

Rows.prototype.__proto__ = Layer.prototype;

Rows.prototype.render = function() {
  if (this.editor.editShift) {
    var views = this.views;
    var rows = this.editor.rows;
    for (var i = 0; i < views.length; i++) {
      var view = views[i];
      var r = view;
      if (!view.visible) continue;

      if (r[1] > rows) view.clear();
    }
  }
  this.renderAhead();
};

},{"./layer":45,"./template":48}],48:[function(require,module,exports){
var template = exports;

template.code = function(range, e) {
  // if (template.code.memoize.param === code) {
  //   return template.code.memoize.result;
  // } else {
  //   template.code.memoize.param = code;
  //   template.code.memoize.result = false;
  // }

  var html = e.buffer.getHighlighted(range);

  return html;
};

// singleton memoize for fast last repeating value
template.code.memoize = {
  param: '',
  result: ''
};

template.rows = function(range, e) {
  var s = '';
  for (var i = range[0]; i <= range[1]; i++) {
    s += (i + 1) + '\n';
  }
  return s;
};

template.mark = function(range, e) {
  var mark = e.mark.get();
  if (range[0] > mark.end.y) return false;
  if (range[1] < mark.begin.y) return false;

  var offset = e.buffer.lines.getRange(range);
  var area = e.buffer.lines.getAreaOffsetRange(mark);
  var code = e.buffer.text.getRange(offset);

  area[0] -= offset[0];
  area[1] -= offset[0];

  var above = code.substring(0, area[0]);
  var middle = code.substring(area[0], area[1]);
  var html = e.syntax.entities(above) + '<mark>' + e.syntax.entities(middle) + '</mark>';

  html = html.replace(/\n/g, ' \n');

  return html;
};

template.find = function(range, e) {
  var results = e.findResults;

  var begin = 0;
  var end = results.length;
  var prev = -1;
  var i = -1;

  do {
    prev = i;
    i = begin + (end - begin) / 2 | 0;
    if (results[i].y < range[0]) begin = i;
    else end = i;
  } while (prev !== i);

  var width = e.findValue.length * e.char.width + 'px';

  var html = '';
  var r;
  while (results[i] && results[i].y < range[1]) {
    r = results[i++];
    html += '<i style="'
          + 'width:' + width + ';'
          + 'top:' + (r.y * e.char.height) + 'px;'
          + 'left:' + (r.x * e.char.width + e.gutter + e.options.margin_left) + 'px;'
          + '"></i>';
  }

  return html;
};

template.find.style = function() {
  //
};

template.block = function(range, e) {
  var offset = e.buffer.lines.get(range[0]);
  var target = e.buffer.lines.getPoint(e.caret).offset;
  var code = e.buffer.get(range);
  var i = target - offset;
  var char;

  var Open = {
    '{': 'curly',
    '[': 'square',
    '(': 'parens'
  };

  var Close = {
    '}': 'curly',
    ']': 'square',
    ')': 'parens'
  };

  var open;
  var close;

  var count = 1;
  i -= 1;
  while (i > 0) {
    char = code[i];
    open = Open[char];
    if (Close[char]) count++;
    if (open && !--count) break;
    i--;
  }

  if (!open) return ' ';

  var begin = e.buffer.lines.getOffset(i + offset);

  count = 1;
  i += 1;

  while (i < code.length) {
    char = code[i];
    close = Close[char];
    if (Open[char] === open) count++;
    if (open === close) count--;

    if (!count) break;
    i++;
  }

  if (!close) return ' ';

  var end = e.buffer.lines.getOffset(i + offset);

  var html = '';

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (begin.y * e.char.height) + 'px;'
        + 'left:' + (begin.x * e.char.width + e.gutter + e.options.margin_left) + 'px;'
        + '"></i>';

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (end.y * e.char.height) + 'px;'
        + 'left:' + (end.x * e.char.width + e.gutter + e.options.margin_left) + 'px;'
        + '"></i>';

  return html;
};

template.block.style = function() {
  //
};

template.mark.style =
template.rows.style =
template.code.style = function(range, e) {
  return {
    opacity: 1,
    left: 0,
    top: range[0] * e.char.height,
    height: (range[1] - range[0] + 1) * e.char.height
  };
};

template.caret = function() {
  return false;
};

template.caret.style = function(point, e) {
  return {
    opacity: +e.hasFocus,
    left: e.char.width * e.caret.x + e.gutter + e.options.margin_left,
    top: e.char.height * e.caret.y,
    height: e.char.height,
  };
};

template.gutter = function() {
  return null;
};

template.gutter.style = function(point, e) {
  return {
    opacity: 1,
    left: 0,
    top: 0,
    height: e.rows * e.char.height,
  };
};

template.ruler = function() {
  return false;
};

template.ruler.style = function(point, e) {
  return {
    // width: e.longestLine * e.char.width,
    opacity: 0,
    left: 0,
    top: 0,
    height: ((e.rows + e.page.height) * e.char.height) + e.pageRemainder.height,
  };
};

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}

},{}],49:[function(require,module,exports){
var dom = require('../../lib/dom');
var diff = require('../../lib/diff');
var merge = require('../../lib/merge');
var trim = require('../../lib/trim');
var css = require('../style.css');

module.exports = View;

function View(name, editor, template) {
  if (!(this instanceof View)) return new View(name, editor, template);

  this.name = name;
  this.editor = editor;
  this.template = template;

  this.visible = false;
  this.lastUsed = 0;

  this[0] = this[1] = -1;

  this.el = document.createElement('div');
  this.el.className = css[name];

  var style = {
    top: 0,
    height: 0,
    opacity: 0
  };

  if (this.editor.options.debug_layers
  && ~this.editor.options.debug_layers.indexOf(name)) {
    style.background = '#'
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16);
  }

  dom.style(this, style);
}

View.prototype.render = function(range) {
  if (!range) range = this;

  this.lastUsed = Date.now();

  // console.log(this.name, this.value, e.layout[this.name], diff(this.value, e.layout[this.name]))
  // if (!diff(this.value, this.editor.layout[this.name])) return;

  var html = this.template(range, this.editor);
  if (html === false) return this.style();

  this[0] = range[0];
  this[1] = range[1];
  this.visible = true;

  // if ('code' === this.name) {
  //   var res = trim.emptyLines(html)
  //   range[0] += res.leading;
  //   html = res.string;
  // }

  if (html) dom.html(this, html);
  else if ('code' === this.name || 'block' === this.name) return this.clear();

  // console.log('render', this.name)
  this.style();
};

View.prototype.style = function() {
  this.lastUsed = Date.now();
  dom.style(this, this.template.style(this, this.editor));
};

View.prototype.toString = function() {
  return this[0] + ',' + this[1];
};

View.prototype.valueOf = function() {
  return [this[0], this[1]];
};

View.prototype.clear = function() {
  if (!this.visible) return;
  this[0] = this[1] = -1;
  this.visible = false;
  // dom.html(this, '');
  dom.style(this, { top: 0, height: 0, opacity: 0 });
};

},{"../../lib/diff":9,"../../lib/dom":10,"../../lib/merge":13,"../../lib/trim":24,"../style.css":39}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2F0b21pYy5qcyIsImxpYi9ib3guanMiLCJsaWIvY2xvbmUuanMiLCJsaWIvZGVib3VuY2UuanMiLCJsaWIvZGlhbG9nL2luZGV4LmpzIiwibGliL2RpYWxvZy9zdHlsZS5jc3MiLCJsaWIvZGlmZi5qcyIsImxpYi9kb20uanMiLCJsaWIvZXZlbnQuanMiLCJsaWIvbWVtb2l6ZS5qcyIsImxpYi9tZXJnZS5qcyIsImxpYi9vcGVuLmpzIiwibGliL3BhcnNlLmpzIiwibGliL3BvaW50LmpzIiwibGliL3JhbmdlLWdhdGUtYW5kLmpzIiwibGliL3JhbmdlLWdhdGUtbm90LmpzIiwibGliL3JhbmdlLmpzIiwibGliL3JlZ2V4cC5qcyIsImxpYi9zYXZlLmpzIiwibGliL3NldC1pbW1lZGlhdGUuanMiLCJsaWIvdGhyb3R0bGUuanMiLCJsaWIvdHJpbS5qcyIsInNyYy9idWZmZXIvaW5kZXguanMiLCJzcmMvYnVmZmVyL2luZGV4ZXIuanMiLCJzcmMvYnVmZmVyL2xpbmVzLmpzIiwic3JjL2J1ZmZlci9wcmVmaXh0cmVlLmpzIiwic3JjL2J1ZmZlci9zZWdtZW50cy5qcyIsInNyYy9idWZmZXIvc2tpcHN0cmluZy5qcyIsInNyYy9idWZmZXIvc3ludGF4LmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3h4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNVRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaE1BOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDck5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBKYXp6XG4gKi9cblxudmFyIERlZmF1bHRPcHRpb25zID0ge1xuICB0aGVtZTogJ3dlc3Rlcm4nLFxuICBkZWJ1Z19sYXllcnM6IGZhbHNlLFxuICBzY3JvbGxfc3BlZWQ6IDc1LFxuICBoaWRlX3Jvd3M6IGZhbHNlLFxuICBjZW50ZXI6IGZhbHNlLFxuICBtYXJnaW5fbGVmdDogMTUsXG4gIGd1dHRlcl9tYXJnaW46IDIwLFxufTtcblxucmVxdWlyZSgnLi9saWIvc2V0LWltbWVkaWF0ZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL2xpYi9tZXJnZScpO1xudmFyIGNsb25lID0gcmVxdWlyZSgnLi9saWIvY2xvbmUnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuL2xpYi90aHJvdHRsZScpO1xudmFyIGF0b21pYyA9IHJlcXVpcmUoJy4vbGliL2F0b21pYycpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi9saWIvZXZlbnQnKTtcbnZhciBEaWFsb2cgPSByZXF1aXJlKCcuL2xpYi9kaWFsb2cnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4vbGliL3BvaW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuL2xpYi9yYW5nZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuL2xpYi9hcmVhJyk7XG52YXIgQm94ID0gcmVxdWlyZSgnLi9saWIvYm94Jyk7XG5cbnZhciBEZWZhdWx0QmluZGluZ3MgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC9iaW5kaW5ncycpO1xudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcbnZhciB0aGVtZSA9IHJlcXVpcmUoJy4vc3JjL3RoZW1lJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zcmMvc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSmF6ejtcblxuZnVuY3Rpb24gSmF6eihvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG1lcmdlKGNsb25lKERlZmF1bHRPcHRpb25zKSwgb3B0aW9ucyB8fCB7fSk7XG5cbiAgT2JqZWN0LmFzc2lnbih0aGlzLCB7XG4gICAgZWw6IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKSxcblxuICAgIGlkOiAnamF6el8nICsgKE1hdGgucmFuZG9tKCkgKiAxMGU2IHwgMCkudG9TdHJpbmcoMzYpLFxuICAgIGZpbGU6IG5ldyBGaWxlLFxuICAgIG1vdmU6IG5ldyBNb3ZlKHRoaXMpLFxuICAgIHZpZXdzOiBuZXcgVmlld3ModGhpcyksXG4gICAgaW5wdXQ6IG5ldyBJbnB1dCh0aGlzKSxcbiAgICBoaXN0b3J5OiBuZXcgSGlzdG9yeSh0aGlzKSxcblxuICAgIGJpbmRpbmdzOiB7IHNpbmdsZToge30gfSxcblxuICAgIGZpbmQ6IG5ldyBEaWFsb2coJ0ZpbmQnLCBUZXh0Lm1hcCksXG4gICAgZmluZFZhbHVlOiAnJyxcbiAgICBmaW5kTmVlZGxlOiAwLFxuICAgIGZpbmRSZXN1bHRzOiBbXSxcblxuICAgIHNjcm9sbDogbmV3IFBvaW50LFxuICAgIG9mZnNldDogbmV3IFBvaW50LFxuICAgIHNpemU6IG5ldyBCb3gsXG4gICAgY2hhcjogbmV3IEJveCxcblxuICAgIHBhZ2U6IG5ldyBCb3gsXG4gICAgcGFnZVBvaW50OiBuZXcgUG9pbnQsXG4gICAgcGFnZVJlbWFpbmRlcjogbmV3IEJveCxcbiAgICBwYWdlQm91bmRzOiBuZXcgUmFuZ2UsXG5cbiAgICBsb25nZXN0TGluZTogMCxcbiAgICBndXR0ZXI6IDAsXG4gICAgY29kZTogMCxcbiAgICByb3dzOiAwLFxuXG4gICAgY2FyZXQ6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG4gICAgaGFzRm9jdXM6IGZhbHNlLFxuXG4gICAgbWFyazogbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gICAgfSksXG5cbiAgICBlZGl0aW5nOiBmYWxzZSxcbiAgICBlZGl0TGluZTogLTEsXG4gICAgZWRpdFJhbmdlOiBbLTEsLTFdLFxuICAgIGVkaXRTaGlmdDogMCxcblxuICAgIHN1Z2dlc3RJbmRleDogMCxcbiAgICBzdWdnZXN0Um9vdDogJycsXG4gICAgc3VnZ2VzdE5vZGVzOiBbXSxcblxuICAgIGFuaW1hdGlvbkZyYW1lOiAtMSxcbiAgICBhbmltYXRpb25SdW5uaW5nOiBmYWxzZSxcbiAgICBhbmltYXRpb25TY3JvbGxUYXJnZXQ6IG51bGwsXG4gIH0pO1xuXG4gIGRvbS5hcHBlbmQodGhpcy52aWV3cy5jYXJldCwgdGhpcy5pbnB1dC50ZXh0KTtcbiAgZG9tLmFwcGVuZCh0aGlzLCB0aGlzLnZpZXdzKTtcblxuICAvLyB1c2VmdWwgc2hvcnRjdXRzXG4gIHRoaXMuYnVmZmVyID0gdGhpcy5maWxlLmJ1ZmZlcjtcbiAgdGhpcy5idWZmZXIubWFyayA9IHRoaXMubWFyaztcbiAgdGhpcy5zeW50YXggPSB0aGlzLmJ1ZmZlci5zeW50YXg7XG5cbiAgdGhlbWUodGhpcy5vcHRpb25zLnRoZW1lKTtcblxuICB0aGlzLmJpbmRNZXRob2RzKCk7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkphenoucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSmF6ei5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZWwsIHNjcm9sbEVsKSB7XG4gIGlmICh0aGlzLnJlZikge1xuICAgIHRoaXMuZWwucmVtb3ZlQXR0cmlidXRlKCdpZCcpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZShjc3MuZWRpdG9yKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgICB0aGlzLm9mZlNjcm9sbCgpO1xuICAgIHRoaXMucmVmLmZvckVhY2gocmVmID0+IHtcbiAgICAgIGRvbS5hcHBlbmQoZWwsIHJlZik7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5yZWYgPSBbXS5zbGljZS5jYWxsKHRoaXMuZWwuY2hpbGRyZW4pO1xuICAgIGRvbS5hcHBlbmQoZWwsIHRoaXMuZWwpO1xuICAgIGRvbS5vbnJlc2l6ZSh0aGlzLm9uUmVzaXplKTtcbiAgfVxuXG4gIHRoaXMuZWwgPSBlbDtcbiAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2lkJywgdGhpcy5pZCk7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZChjc3MuZWRpdG9yKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gIHRoaXMub2ZmU2Nyb2xsID0gZG9tLm9uc2Nyb2xsKHNjcm9sbEVsIHx8IHRoaXMuZWwsIHRoaXMub25TY3JvbGwpO1xuICB0aGlzLmlucHV0LnVzZSh0aGlzLmVsKTtcblxuICBzZXRUaW1lb3V0KHRoaXMucmVwYWludCwgMCk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hc3NpZ24gPSBmdW5jdGlvbihiaW5kaW5ncykge1xuICB0aGlzLmJpbmRpbmdzID0gYmluZGluZ3M7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMuZmlsZS5vcGVuKHBhdGgsIHJvb3QsIGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgdGhpcy5maWxlLnNhdmUoZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQsIHBhdGgpIHtcbiAgdGhpcy5maWxlLnNldCh0ZXh0KTtcbiAgdGhpcy5maWxlLnBhdGggPSBwYXRoIHx8IHRoaXMuZmlsZS5wYXRoO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmZvY3VzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmJsdXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRNZXRob2RzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lLmJpbmQodGhpcyk7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luLmJpbmQodGhpcyk7XG4gIHRoaXMubWFya1NldCA9IHRoaXMubWFya1NldC5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtDbGVhciA9IHRoaXMubWFya0NsZWFyLmJpbmQodGhpcyk7XG4gIHRoaXMucmVwYWludCA9IHRoaXMucmVwYWludC5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEhhbmRsZXJzID0gZnVuY3Rpb24oKSB7XG4gIGZvciAodmFyIG1ldGhvZCBpbiB0aGlzKSB7XG4gICAgaWYgKCdvbicgPT09IG1ldGhvZC5zbGljZSgwLCAyKSkge1xuICAgICAgdGhpc1ttZXRob2RdID0gdGhpc1ttZXRob2RdLmJpbmQodGhpcyk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5iaW5kSGFuZGxlcnMoKVxuICB0aGlzLm1vdmUub24oJ21vdmUnLCB0aGlzLm9uTW92ZSk7XG4gIHRoaXMuZmlsZS5vbigncmF3JywgdGhpcy5vbkZpbGVSYXcpOyAvL1RPRE86IHNob3VsZCBub3QgbmVlZCB0aGlzIGV2ZW50XG4gIHRoaXMuZmlsZS5vbignc2V0JywgdGhpcy5vbkZpbGVTZXQpO1xuICB0aGlzLmZpbGUub24oJ29wZW4nLCB0aGlzLm9uRmlsZU9wZW4pO1xuICB0aGlzLmZpbGUub24oJ2NoYW5nZScsIHRoaXMub25GaWxlQ2hhbmdlKTtcbiAgdGhpcy5maWxlLm9uKCdiZWZvcmUgY2hhbmdlJywgdGhpcy5vbkJlZm9yZUZpbGVDaGFuZ2UpO1xuICB0aGlzLmhpc3Rvcnkub24oJ2NoYW5nZScsIHRoaXMub25IaXN0b3J5Q2hhbmdlKTtcbiAgdGhpcy5pbnB1dC5vbignYmx1cicsIHRoaXMub25CbHVyKTtcbiAgdGhpcy5pbnB1dC5vbignZm9jdXMnLCB0aGlzLm9uRm9jdXMpO1xuICB0aGlzLmlucHV0Lm9uKCdpbnB1dCcsIHRoaXMub25JbnB1dCk7XG4gIHRoaXMuaW5wdXQub24oJ3RleHQnLCB0aGlzLm9uVGV4dCk7XG4gIHRoaXMuaW5wdXQub24oJ2tleXMnLCB0aGlzLm9uS2V5cyk7XG4gIHRoaXMuaW5wdXQub24oJ2tleScsIHRoaXMub25LZXkpO1xuICB0aGlzLmlucHV0Lm9uKCdjdXQnLCB0aGlzLm9uQ3V0KTtcbiAgdGhpcy5pbnB1dC5vbignY29weScsIHRoaXMub25Db3B5KTtcbiAgdGhpcy5pbnB1dC5vbigncGFzdGUnLCB0aGlzLm9uUGFzdGUpO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZXVwJywgdGhpcy5vbk1vdXNlVXApO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRvd24nLCB0aGlzLm9uTW91c2VEb3duKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VjbGljaycsIHRoaXMub25Nb3VzZUNsaWNrKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnYmVnaW4nLCB0aGlzLm9uTW91c2VEcmFnQmVnaW4pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWcnLCB0aGlzLm9uTW91c2VEcmFnKTtcbiAgdGhpcy5maW5kLm9uKCdzdWJtaXQnLCB0aGlzLmZpbmRKdW1wLmJpbmQodGhpcywgMSkpO1xuICB0aGlzLmZpbmQub24oJ3ZhbHVlJywgdGhpcy5vbkZpbmRWYWx1ZSk7XG4gIHRoaXMuZmluZC5vbigna2V5JywgdGhpcy5vbkZpbmRLZXkpO1xuICB0aGlzLmZpbmQub24oJ29wZW4nLCB0aGlzLm9uRmluZE9wZW4pO1xuICB0aGlzLmZpbmQub24oJ2Nsb3NlJywgdGhpcy5vbkZpbmRDbG9zZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblNjcm9sbCA9IGZ1bmN0aW9uKHNjcm9sbCkge1xuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgdGhpcy5zY3JvbGwuc2V0KHNjcm9sbCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikgdGhpcy5tYXJrU2V0KCk7XG4gICAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRm9jdXMgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSB0cnVlO1xuICB0aGlzLmVtaXQoJ2ZvY3VzJyk7XG4gIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJsdXIgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSBmYWxzZTtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB7XG4gICAgICB0aGlzLmVtaXQoJ2JsdXInKTtcbiAgICAgIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG4gICAgfVxuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSW5wdXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuc3VnZ2VzdFJvb3QgPSAnJztcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleXMgPSBmdW5jdGlvbihrZXlzLCBlKSB7XG4gIGlmIChrZXlzIGluIHRoaXMuYmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleXMgaW4gRGVmYXVsdEJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleSA9IGZ1bmN0aW9uKGtleSwgZSkge1xuICBpZiAoa2V5IGluIHRoaXMuYmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXkgaW4gRGVmYXVsdEJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25DdXQgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB0aGlzLm9uQ29weShlKTtcbiAgdGhpcy5kZWxldGUoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQ29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkhpc3RvcnlDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlcGFpbnQoKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25CZWZvcmVGaWxlQ2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVDaGFuZ2UgPSBmdW5jdGlvbihlZGl0UmFuZ2UsIGVkaXRTaGlmdCwgdGV4dEJlZm9yZSwgdGV4dEFmdGVyKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdjaGFuZ2UnKVxuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2M7XG4gIHRoaXMuY29kZSA9IHRoaXMuYnVmZmVyLnRleHQubGVuZ3RoO1xuXG4gIHRoaXMuZWRpdGluZyA9IHRydWU7XG4gIHRoaXMuZWRpdExpbmUgPSBlZGl0UmFuZ2VbMF07XG4gIHRoaXMuZWRpdFJhbmdlID0gZWRpdFJhbmdlO1xuICB0aGlzLmVkaXRTaGlmdCA9IGVkaXRTaGlmdDtcblxuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcblxuICBpZiAodGhpcy5maW5kLmlzT3Blbikge1xuICAgIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUsIHRydWUpO1xuICB9XG5cbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgdGhpcy5yZW5kZXIoKTtcbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0RnJvbVB4ID0gZnVuY3Rpb24ocHgpIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLm1hcmdpbkxlZnQsIHk6IHRoaXMuY2hhci5oZWlnaHQvMiB9KVsnKyddKHRoaXMub2Zmc2V0KTtcbiAgdmFyIHAgPSBweFsnLSddKGcpWycrJ10odGhpcy5zY3JvbGwpWydvLyddKHRoaXMuY2hhcik7XG5cbiAgcC55ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocC55LCB0aGlzLmJ1ZmZlci5sb2MpKTtcbiAgcC54ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocC54LCB0aGlzLmdldExpbmVMZW5ndGgocC55KSkpO1xuXG4gIHRoaXMuc2V0Q2FyZXQocCk7XG4gIHRoaXMubW92ZS5sYXN0RGVsaWJlcmF0ZVggPSBwLng7XG4gIHRoaXMub25Nb3ZlKCk7XG5cbiAgcmV0dXJuIHA7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlVXAgPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB0aGlzLmJsdXIoKTtcbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRG93biA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KHRoaXMuZm9jdXMuYmluZCh0aGlzKSwgMTApO1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCkgdGhpcy5tYXJrQmVnaW4oKTtcbiAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXQgPSBmdW5jdGlvbihwKSB7XG4gIHRoaXMuY2FyZXQuc2V0KHApO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBdCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICAgIC8vIHRoaXMucmVuZGVyKCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLm1hcmtCZWdpbihhcmVhKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtDbGVhciA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0ICYmICFmb3JjZSkgcmV0dXJuO1xuXG4gIHRoaXMubWFyay5hY3RpdmUgPSBmYWxzZTtcbiAgdGhpcy5tYXJrLnNldCh7XG4gICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICB9KTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIFJhbmdlLmNsYW1wKHJhbmdlLCB0aGlzLnBhZ2VCb3VuZHMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHAgPSB0aGlzLnNjcm9sbFsnXy8nXSh0aGlzLmNoYXIpO1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMaW5lTGVuZ3RoKHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHAgPSB0aGlzLmNhcmV0WydfKiddKHRoaXMuY2hhcik7XG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdmFyIHRvcCA9IHMueSAtIHAueTtcbiAgdmFyIGJvdHRvbSA9IChwLnkpIC0gKHMueSArIHRoaXMuc2l6ZS5oZWlnaHQpICsgdGhpcy5jaGFyLmhlaWdodDtcblxuICB2YXIgbGVmdCA9IChzLnggKyB0aGlzLmNoYXIud2lkdGgpIC0gcC54O1xuICB2YXIgcmlnaHQgPSAocC54KSAtIChzLnggKyB0aGlzLnNpemUud2lkdGggLSB0aGlzLm1hcmdpbkxlZnQpICsgdGhpcy5jaGFyLndpZHRoICogMjtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZyAmJiAhdGhpcy5maW5kLmlzT3BlbilcbiAgICB0aGlzLnNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbiAgZWxzZVxuICAgIHRoaXMuYW5pbWF0ZVNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbFRvID0gZnVuY3Rpb24ocCkge1xuICBkb20uc2Nyb2xsVG8odGhpcy5lbCwgcC54LCBwLnkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIHRoaXMuc2Nyb2xsLnNldChQb2ludC5sb3coe1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9LCB7XG4gICAgeDogdGhpcy5zY3JvbGwueCArIHgsXG4gICAgeTogdGhpcy5zY3JvbGwueSArIHlcbiAgfSkpO1xuICB0aGlzLnNjcm9sbFRvKHRoaXMuc2Nyb2xsKTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKCh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0LCBNYXRoLm1heCgwLCBzLnkgKyB5KSlcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoYWR4IDwgMSAmJiBhZHkgPCAxKSB7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCk7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBudWxsO1xuICAgIHRoaXMuZW1pdCgnYW5pbWF0aW9uIGVuZCcpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIGlmIChhZHggPCBzcGVlZCkgZHggKj0gMC45O1xuICBlbHNlIGR4ID0gTWF0aC5zaWduKGR4KSAqIHNwZWVkO1xuXG4gIGlmIChhZHkgPCBzcGVlZCkgZHkgKj0gMC45O1xuICBlbHNlIGR5ID0gTWF0aC5zaWduKGR5KSAqIHNwZWVkO1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMuZGVsZXRlKCk7XG4gIHZhciBsZW5ndGggPSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgdGV4dCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKGxlbmd0aCwgdHJ1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iYWNrc3BhY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybiB0aGlzLmRlbGV0ZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSwgdHJ1ZSk7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQ2hhckF0KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJ1ZmZlci5kZWxldGVDaGFyQXQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmZpbmRKdW1wID0gZnVuY3Rpb24oanVtcCkge1xuICBpZiAoIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIHx8ICF0aGlzLmZpbmQuaXNPcGVuKSByZXR1cm47XG5cbiAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kTmVlZGxlICsganVtcDtcbiAgaWYgKHRoaXMuZmluZE5lZWRsZSA+PSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IDA7XG4gIH0gZWxzZSBpZiAodGhpcy5maW5kTmVlZGxlIDwgMCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIC0gMTtcbiAgfVxuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0KTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlLCBub0p1bXApIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLmd1dHRlciwgeTogMCB9KTtcblxuICB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcblxuICB0aGlzLnZpZXdzLmZpbmQuY2xlYXIoKTtcblxuICB0aGlzLmZpbmRWYWx1ZSA9IHZhbHVlO1xuICAvLyBjb25zb2xlLnRpbWUoJ2ZpbmQgJyArIHZhbHVlKTtcbiAgdGhpcy5maW5kUmVzdWx0cyA9IHRoaXMuYnVmZmVyLmluZGV4ZXIuZmluZCh2YWx1ZSkubWFwKChvZmZzZXQpID0+IHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KG9mZnNldCk7XG4gICAgICAvL3B4OiBuZXcgUG9pbnQocG9pbnQpWycqJ10oZS5jaGFyKVsnKyddKGcpXG4gIH0pO1xuICAvLyBjb25zb2xlLnRpbWVFbmQoJ2ZpbmQgJyArIHZhbHVlKTtcblxuICB0aGlzLmZpbmQuaW5mbygnMC8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIGlmICghbm9KdW1wKSB0aGlzLmZpbmRKdW1wKDApO1xuXG4gIHRoaXMudmlld3MuZmluZC5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZEtleSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKH5bMzMsIDM0LCAxMTRdLmluZGV4T2YoZS53aGljaCkpIHsgLy8gcGFnZXVwLCBwYWdlZG93biwgZjNcbiAgICB0aGlzLmlucHV0LnRleHQub25rZXlkb3duKGUpO1xuICB9XG5cbiAgaWYgKDcwID09PSBlLndoaWNoICYmIGUuY3RybEtleSkgeyAvLyBjdHJsK2ZcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICg5ID09PSBlLndoaWNoKSB7IC8vIHRhYlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZmluZC5pbmZvKCcnKTtcbiAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRDbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnZpZXdzLmZpbmQuY2xlYXIoKTtcbiAgdGhpcy5mb2N1cygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc3VnZ2VzdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBdCh0aGlzLmNhcmV0LCB0cnVlKTtcbiAgaWYgKCFhcmVhKSByZXR1cm47XG5cbiAgdmFyIGtleSA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gIGlmICgha2V5KSByZXR1cm47XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3RSb290XG4gICAgfHwga2V5LnN1YnN0cigwLCB0aGlzLnN1Z2dlc3RSb290Lmxlbmd0aCkgIT09IHRoaXMuc3VnZ2VzdFJvb3QpIHtcbiAgICB0aGlzLnN1Z2dlc3RJbmRleCA9IDA7XG4gICAgdGhpcy5zdWdnZXN0Um9vdCA9IGtleTtcbiAgICB0aGlzLnN1Z2dlc3ROb2RlcyA9IHRoaXMuYnVmZmVyLnByZWZpeC5jb2xsZWN0KGtleSk7XG4gIH1cblxuICBpZiAoIXRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aCkgcmV0dXJuO1xuICB2YXIgbm9kZSA9IHRoaXMuc3VnZ2VzdE5vZGVzW3RoaXMuc3VnZ2VzdEluZGV4XTtcblxuICB0aGlzLnN1Z2dlc3RJbmRleCA9ICh0aGlzLnN1Z2dlc3RJbmRleCArIDEpICUgdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoO1xuXG4gIHJldHVybiB7XG4gICAgYXJlYTogYXJlYSxcbiAgICBub2RlOiBub2RlXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXBhaW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVzaXplKCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyICQgPSB0aGlzLmVsO1xuXG4gIHRoaXMub2Zmc2V0LnNldChkb20uZ2V0T2Zmc2V0KCQpKTtcbiAgdGhpcy5zY3JvbGwuc2V0KGRvbS5nZXRTY3JvbGwoJCkpO1xuICB0aGlzLnNpemUuc2V0KGRvbS5nZXRTaXplKCQpKTtcblxuICAvLyB0aGlzIGlzIGEgd2VpcmQgZml4IHdoZW4gZG9pbmcgbXVsdGlwbGUgLnVzZSgpXG4gIGlmICh0aGlzLmNoYXIud2lkdGggPT09IDApIHRoaXMuY2hhci5zZXQoZG9tLmdldENoYXJTaXplKCQsIGNzcy5jb2RlKSk7XG5cbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWydfKiddKHRoaXMuY2hhcikpKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG4gIHRoaXMubG9uZ2VzdExpbmUgPSBNYXRoLm1pbig1MDAsIHRoaXMuYnVmZmVyLmxpbmVzLmdldExvbmdlc3RMaW5lTGVuZ3RoKCkpO1xuICB0aGlzLmd1dHRlciA9IE1hdGgubWF4KFxuICAgIHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICh0aGlzLm9wdGlvbnMuY2VudGVyXG4gICAgICA/ICh0aGlzLnBhZ2Uud2lkdGggLSA4MSkgLyAyIHwgMCA6IDApXG4gICAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93c1xuICAgICAgPyAwIDogTWF0aC5tYXgoMywgKCcnK3RoaXMucm93cykubGVuZ3RoKSlcbiAgKSAqIHRoaXMuY2hhci53aWR0aCArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6IHRoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2luKTtcbiAgdGhpcy5tYXJnaW5MZWZ0ID0gdGhpcy5ndXR0ZXIgKyB0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjb21tZW50Jyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ydWxlcn0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmZpbmR9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5tYXJrfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuY29kZX0ge1xuICAgICAgcGFkZGluZy1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdCArIHRoaXMuZ3V0dGVyfXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3Mucm93c30ge1xuICAgICAgcGFkZGluZy1yaWdodDogJHt0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbn1weDtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdH1weDtcbiAgICAgIHdpZHRoOiAke3RoaXMuZ3V0dGVyfXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuZmluZH0gPiBpLFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5ibG9ja30gPiBpIHtcbiAgICAgIGhlaWdodDogJHt0aGlzLmNoYXIuaGVpZ2h0ICsgMX1weDtcbiAgICB9XG4gICAgaW5kZW50IHtcbiAgICAgIGJhY2tncm91bmQtaW1hZ2U6IHVybCgke2RhdGFVUkx9KTtcbiAgICB9YFxuICApO1xuXG4gIHRoaXMuZW1pdCgncmVzaXplJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jbGVhciA9IGF0b21pYyhmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2NsZWFyJylcbiAgdGhpcy52aWV3cy5jbGVhcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlbmRlciA9IGF0b21pYyhmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicpXG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG4gIHRoaXMuZW1pdCgncmVuZGVyJyk7XG59KTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBBcmVhO1xuXG5mdW5jdGlvbiBBcmVhKGEpIHtcbiAgaWYgKGEpIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50KGEuYmVnaW4pO1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50KGEuZW5kKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50O1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50O1xuICB9XG59XG5cbkFyZWEucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHRoaXMpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzID0gW3RoaXMuYmVnaW4sIHRoaXMuZW5kXS5zb3J0KFBvaW50LnNvcnQpO1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoc1swXSksXG4gICAgZW5kOiBuZXcgUG9pbnQoc1sxXSlcbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMuYmVnaW4uc2V0KGFyZWEuYmVnaW4pO1xuICB0aGlzLmVuZC5zZXQoYXJlYS5lbmQpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0TGVmdCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy5iZWdpbi54ID0geDtcbiAgdGhpcy5lbmQueCA9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIGlmICh0aGlzLmJlZ2luLngpIHRoaXMuYmVnaW4ueCArPSB4O1xuICBpZiAodGhpcy5lbmQueCkgdGhpcy5lbmQueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZEJvdHRvbSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5lbmQueSArPSB5O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLnNoaWZ0QnlMaW5lcyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5iZWdpbi55ICs9IHk7XG4gIHRoaXMuZW5kLnkgKz0geTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+IGEuZW5kLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj0nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5iZWdpbi54ID49IGEuYmVnaW4ueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzwnXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5lbmQueCA8IGEuYmVnaW4ueFxuICAgIDogdGhpcy5lbmQueSA8IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PSddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuZW5kLnggPD0gYS5lbmQueFxuICAgIDogdGhpcy5lbmQueSA8IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPjwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+J10oYSkgJiYgdGhpc1snPCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzwnXShhKSB8fCB0aGlzWyc+J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj08J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+PSddKGEpICYmIHRoaXNbJzw9J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPD0nXShhKSB8fCB0aGlzWyc+PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz09PSddID1cbkFyZWEucHJvdG90eXBlLmVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi54ID09PSBhLmJlZ2luLnggJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICAgICYmIHRoaXMuZW5kLnggICA9PT0gYS5lbmQueCAgICYmIHRoaXMuZW5kLnkgICA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PSddID1cbkFyZWEucHJvdG90eXBlLmJlZ2luTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXwnXSA9XG5BcmVhLnByb3RvdHlwZS5lbmRMaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9fCddID1cbkFyZWEucHJvdG90eXBlLmxpbmVzRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyd8PSddKGEpICYmIHRoaXNbJz18J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXw9J10gPVxuQXJlYS5wcm90b3R5cGUuc2FtZUxpbmUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IHRoaXMuZW5kLnkgJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnLXgtJ10gPVxuQXJlYS5wcm90b3R5cGUuc2hvcnRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54ICsgeCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54IC0geCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJyt4KyddID1cbkFyZWEucHJvdG90eXBlLndpZGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggLSB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggKyB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0KGIuYmVnaW4sIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0KGIuZW5kLCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WCh4LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFgoeCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFkgPSBmdW5jdGlvbih5LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFkoeSwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRZKHksIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiAnJyArIGEuYmVnaW4gKyAnLScgKyBhLmVuZDtcbn07XG5cbkFyZWEuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA9PT0gYi5iZWdpbi55XG4gICAgPyBhLmJlZ2luLnggLSBiLmJlZ2luLnhcbiAgICA6IGEuYmVnaW4ueSAtIGIuYmVnaW4ueTtcbn07XG5cbkFyZWEudG9Qb2ludFNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPD0gYi55ICYmIGEuZW5kLnkgPj0gYi55XG4gICAgPyBhLmJlZ2luLnkgPT09IGIueVxuICAgICAgPyBhLmJlZ2luLnggLSBiLnhcbiAgICAgIDogYS5lbmQueSA9PT0gYi55XG4gICAgICAgID8gYS5lbmQueCAtIGIueFxuICAgICAgICA6IDBcbiAgICA6IGEuYmVnaW4ueSAtIGIueTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gYXRvbWljO1xuXG4vLyBmdW5jdGlvbiBhdG9taWMoZm4pIHtcbi8vICAgdmFyIHN0YWdlID0gZmFsc2U7XG4vLyAgIHZhciBuID0gMDtcblxuLy8gICBmdW5jdGlvbiB3cmFwKCkge1xuLy8gICAgIGlmIChzdGFnZSkgcmV0dXJuIG4rKztcbi8vICAgICBlbHNlIGZuLmNhbGwodGhpcyk7XG4vLyAgIH1cblxuLy8gICB3cmFwLmhvbGQgPSBmdW5jdGlvbigpIHtcbi8vICAgICBzdGFnZSA9IHRydWU7XG4vLyAgICAgbiA9IG4gfHwgMDtcbi8vICAgfTtcblxuLy8gICB3cmFwLnJlbGVhc2UgPSBmdW5jdGlvbihjb250ZXh0KSB7XG4vLyAgICAgaWYgKHN0YWdlICYmIG4pIHtcbi8vICAgICAgIHN0YWdlID0gZmFsc2U7XG4vLyAgICAgICBuID0gMDtcbi8vICAgICAgIGZuLmNhbGwoY29udGV4dCk7XG4vLyAgICAgfVxuLy8gICB9O1xuXG4vLyAgIHJldHVybiB3cmFwO1xuLy8gfVxuXG5mdW5jdGlvbiBhdG9taWMoZm4pIHtcbiAgdmFyIHJlcXVlc3Q7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMpIHtcbiAgICBjbGVhckltbWVkaWF0ZShyZXF1ZXN0KTtcbiAgICByZXF1ZXN0ID0gc2V0SW1tZWRpYXRlKGZuLmJpbmQodGhpcywgYSwgYiwgYykpO1xuICB9O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEJveDtcblxuZnVuY3Rpb24gQm94KGIpIHtcbiAgaWYgKGIpIHtcbiAgICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xuICB9IGVsc2Uge1xuICAgIHRoaXMud2lkdGggPSAwO1xuICAgIHRoaXMuaGVpZ2h0ID0gMDtcbiAgfVxufVxuXG5Cb3gucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGIpIHtcbiAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG59O1xuXG5Cb3gucHJvdG90eXBlWycvJ10gPVxuQm94LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18vJ10gPVxuQm94LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeLyddID1cbkJveC5wcm90b3R5cGUuY2VpbGRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXionXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ28qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5yb3VuZCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGgucm91bmQodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnLSddID1cbkJveC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLSAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAtIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNsb25lKG9iaikge1xuICB2YXIgbyA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgdmFyIHZhbCA9IG9ialtrZXldO1xuICAgIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIHZhbCkge1xuICAgICAgb1trZXldID0gY2xvbmUodmFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb1trZXldID0gdmFsO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbiBkZWJvdW5jZVdyYXAoYSwgYiwgYywgZCkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICB0aW1lb3V0ID0gc2V0VGltZW91dChmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpLCBtcyk7XG4gICAgcmV0dXJuIHRpbWVvdXQ7XG4gIH1cbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vZG9tJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9ldmVudCcpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlhbG9nO1xuXG5mdW5jdGlvbiBEaWFsb2cobGFiZWwsIGtleW1hcCkge1xuICB0aGlzLm5vZGUgPSBkb20oY3NzLmRpYWxvZywgW1xuICAgIGA8bGFiZWw+JHtjc3MubGFiZWx9YCxcbiAgICBbY3NzLmlucHV0LCBbXG4gICAgICBgPGlucHV0PiR7Y3NzLnRleHR9YCxcbiAgICAgIGNzcy5pbmZvXG4gICAgXV1cbiAgXSk7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MubGFiZWxdLCBsYWJlbCk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogJ25vbmUnIH0pO1xuICB0aGlzLmtleW1hcCA9IGtleW1hcDtcbiAgdGhpcy5vbmJvZHlrZXlkb3duID0gdGhpcy5vbmJvZHlrZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmNsaWNrID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNldXAgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2Vkb3duID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xufVxuXG5EaWFsb2cucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuZnVuY3Rpb24gc3RvcFByb3BhZ2F0aW9uKGUpIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaGFzRm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLmhhc0ZvY3VzKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uYm9keWtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgyNyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDEzID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuc3VibWl0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChlLndoaWNoIGluIHRoaXMua2V5bWFwKSB7XG4gICAgdGhpcy5lbWl0KCdrZXknLCBlKTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3ZhbHVlJywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICBkb20uYXBwZW5kKGRvY3VtZW50LmJvZHksIHRoaXMubm9kZSk7XG4gIGRvbS5mb2N1cyh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0pO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwuc2VsZWN0KCk7XG4gIHRoaXMuaXNPcGVuID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdvcGVuJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIHRoaXMubm9kZS5lbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMubm9kZS5lbCk7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG4gIHRoaXMuZW1pdCgnY2xvc2UnKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuc3VibWl0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZW1pdCgnc3VibWl0JywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaW5mbyA9IGZ1bmN0aW9uKGluZm8pIHtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCBpbmZvKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiBpbmZvID8gJ2Jsb2NrJyA6ICdub25lJyB9KTtcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImRpYWxvZ1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2RpYWxvZ1wiLFwiaW5wdXRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbnB1dFwiLFwidGV4dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX3RleHRcIixcImxhYmVsXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fbGFiZWxcIixcImluZm9cIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbmZvXCJ9IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG5cbmZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBhKSB7XG4gICAgdmFyIGQgPSB7fTtcbiAgICB2YXIgaSA9IDA7XG4gICAgZm9yICh2YXIgayBpbiBiKSB7XG4gICAgICBpZiAoYVtrXSAhPT0gYltrXSkge1xuICAgICAgICBkW2tdID0gYltrXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaSkgcmV0dXJuIGQ7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGEgIT09IGI7XG4gIH1cbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcbnZhciBhdG9taWMgPSByZXF1aXJlKCcuL2F0b21pYycpO1xudmFyIG1lbW9pemUgPSByZXF1aXJlKCcuL21lbW9pemUnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxudmFyIHVuaXRzID0ge1xuICBsZWZ0OiAncHgnLFxuICB0b3A6ICdweCcsXG4gIHJpZ2h0OiAncHgnLFxuICBib3R0b206ICdweCcsXG4gIHdpZHRoOiAncHgnLFxuICBoZWlnaHQ6ICdweCcsXG4gIG1heEhlaWdodDogJ3B4JyxcbiAgcGFkZGluZ0xlZnQ6ICdweCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRvbTtcblxuZnVuY3Rpb24gZG9tKG5hbWUsIGNoaWxkcmVuLCBhdHRycykge1xuICB2YXIgZWw7XG4gIHZhciB0YWcgPSAnZGl2JztcbiAgdmFyIG5vZGU7XG5cbiAgaWYgKCdzdHJpbmcnID09PSB0eXBlb2YgbmFtZSkge1xuICAgIGlmICgnPCcgPT09IG5hbWUuY2hhckF0KDApKSB7XG4gICAgICB2YXIgbWF0Y2hlcyA9IG5hbWUubWF0Y2goLyg/OjwpKC4qKSg/Oj4pKFxcUyspPy8pO1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGFnID0gbWF0Y2hlc1sxXTtcbiAgICAgICAgbmFtZSA9IG1hdGNoZXNbMl0gfHwgdGFnO1xuICAgICAgfVxuICAgIH1cbiAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgICBub2RlID0ge1xuICAgICAgZWw6IGVsLFxuICAgICAgbmFtZTogbmFtZS5zcGxpdCgnICcpWzBdXG4gICAgfTtcbiAgICBkb20uY2xhc3Nlcyhub2RlLCBuYW1lLnNwbGl0KCcgJykuc2xpY2UoMSkpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICByZXR1cm4gZG9tLmFwcGx5KG51bGwsIG5hbWUpO1xuICB9IGVsc2Uge1xuICAgIGlmICgnZG9tJyBpbiBuYW1lKSB7XG4gICAgICBub2RlID0gbmFtZS5kb207XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUgPSBuYW1lO1xuICAgIH1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGNoaWxkcmVuKSkge1xuICAgIGNoaWxkcmVuXG4gICAgICAubWFwKGRvbSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQsIGkpIHtcbiAgICAgICAgbm9kZVtjaGlsZC5uYW1lXSA9IGNoaWxkO1xuICAgICAgICByZXR1cm4gY2hpbGQ7XG4gICAgICB9KVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCkge1xuICAgICAgICBub2RlLmVsLmFwcGVuZENoaWxkKGNoaWxkLmVsKTtcbiAgICAgIH0pO1xuICB9IGVsc2UgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgY2hpbGRyZW4pIHtcbiAgICBkb20uc3R5bGUobm9kZSwgY2hpbGRyZW4pO1xuICB9XG5cbiAgaWYgKGF0dHJzKSB7XG4gICAgZG9tLmF0dHJzKG5vZGUsIGF0dHJzKTtcbiAgfVxuXG4gIHJldHVybiBub2RlO1xufVxuXG5kb20uc3R5bGUgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBfLCBzdHlsZSkge1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn0sIGRpZmYsIG1lcmdlLCBmdW5jdGlvbihub2RlLCBzdHlsZSkge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgc3R5bGVdO1xufSk7XG5cbi8qXG5kb20uc3R5bGUgPSBmdW5jdGlvbihlbCwgc3R5bGUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufTtcbiovXG5kb20uY2xhc3NlcyA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbC5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG59LCBudWxsLCBudWxsLCBmdW5jdGlvbihub2RlLCBjbGFzc2VzKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBjbGFzc2VzLmNvbmNhdChub2RlLm5hbWUpLmZpbHRlcihCb29sZWFuKS5qb2luKCcgJyldO1xufSk7XG5cbmRvbS5hdHRycyA9IGZ1bmN0aW9uKGVsLCBhdHRycykge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgT2JqZWN0LmFzc2lnbihlbCwgYXR0cnMpO1xufTtcblxuZG9tLmh0bWwgPSBmdW5jdGlvbihlbCwgaHRtbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn07XG5cbmRvbS50ZXh0ID0gZnVuY3Rpb24oZWwsIHRleHQpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLnRleHRDb250ZW50ID0gdGV4dDtcbn07XG5cbmRvbS5mb2N1cyA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5mb2N1cygpO1xufTtcblxuZG9tLmdldFNpemUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogZWwuY2xpZW50V2lkdGgsXG4gICAgaGVpZ2h0OiBlbC5jbGllbnRIZWlnaHRcbiAgfTtcbn07XG5cbmRvbS5nZXRDaGFyU2l6ZSA9IGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xuICBzcGFuLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcblxuICBlbC5hcHBlbmRDaGlsZChzcGFuKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgJztcbiAgdmFyIGEgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAgXFxuICc7XG4gIHZhciBiID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBlbC5yZW1vdmVDaGlsZChzcGFuKTtcblxuICByZXR1cm4ge1xuICAgIHdpZHRoOiAoYi53aWR0aCAtIGEud2lkdGgpLFxuICAgIGhlaWdodDogKGIuaGVpZ2h0IC0gYS5oZWlnaHQpXG4gIH07XG59O1xuXG5kb20uZ2V0T2Zmc2V0ID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgdmFyIGJvcmRlckxlZnQgPSBwYXJzZUludChzdHlsZS5ib3JkZXJMZWZ0V2lkdGgpO1xuICB2YXIgYm9yZGVyVG9wID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyVG9wV2lkdGgpO1xuICByZXR1cm4gUG9pbnQubG93KHsgeDogMCwgeTogMCB9LCB7XG4gICAgeDogKHJlY3QubGVmdCArIGJvcmRlckxlZnQpIHwgMCxcbiAgICB5OiAocmVjdC50b3AgKyBib3JkZXJUb3ApIHwgMFxuICB9KTtcbn07XG5cbmRvbS5nZXRTY3JvbGwgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIGdldFNjcm9sbChlbCk7XG59O1xuXG5kb20ub25zY3JvbGwgPSBmdW5jdGlvbiBvbnNjcm9sbChlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG5cbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH0gZWxzZSB7XG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVyKGV2KSB7XG4gICAgZm4oZ2V0U2Nyb2xsKGVsKSk7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gb2Zmc2Nyb2xsKCkge1xuICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG59O1xuXG5kb20ub25vZmZzZXQgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHdoaWxlIChlbCA9IGVsLm9mZnNldFBhcmVudCkge1xuICAgIGRvbS5vbnNjcm9sbChlbCwgZm4pO1xuICB9XG59O1xuXG5kb20ub25jbGljayA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICByZXR1cm4gZWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmbik7XG59O1xuXG5kb20ub25yZXNpemUgPSBmdW5jdGlvbihmbikge1xuICByZXR1cm4gd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcbn07XG5cbmRvbS5hcHBlbmQgPSBmdW5jdGlvbih0YXJnZXQsIHNyYywgZGljdCkge1xuICB0YXJnZXQgPSBkb20uZ2V0RWxlbWVudCh0YXJnZXQpO1xuICBpZiAoJ2ZvckVhY2gnIGluIHNyYykgc3JjLmZvckVhY2goZG9tLmFwcGVuZC5iaW5kKG51bGwsIHRhcmdldCkpO1xuICAvLyBlbHNlIGlmICgndmlld3MnIGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyYy52aWV3cywgdHJ1ZSk7XG4gIGVsc2UgaWYgKGRpY3QgPT09IHRydWUpIGZvciAodmFyIGtleSBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmNba2V5XSk7XG4gIGVsc2UgaWYgKCdmdW5jdGlvbicgIT0gdHlwZW9mIHNyYykgdGFyZ2V0LmFwcGVuZENoaWxkKGRvbS5nZXRFbGVtZW50KHNyYykpO1xufTtcblxuZG9tLnJlbW92ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBpZiAoZWwucGFyZW50Tm9kZSkgZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChlbCk7XG59O1xuXG5kb20uZ2V0RWxlbWVudCA9IGZ1bmN0aW9uKGVsKSB7XG4gIHJldHVybiBlbC5kb20gJiYgZWwuZG9tLmVsIHx8IGVsLmVsIHx8IGVsLm5vZGUgfHwgZWw7XG59O1xuXG5kb20uc2Nyb2xsQnkgPSBmdW5jdGlvbihlbCwgeCwgeSwgc2Nyb2xsKSB7XG4gIHNjcm9sbCA9IHNjcm9sbCB8fCBkb20uZ2V0U2Nyb2xsKGVsKTtcbiAgZG9tLnNjcm9sbFRvKGVsLCBzY3JvbGwueCArIHgsIHNjcm9sbC55ICsgeSk7XG59O1xuXG5kb20uc2Nyb2xsVG8gPSBmdW5jdGlvbihlbCwgeCwgeSkge1xuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICB3aW5kb3cuc2Nyb2xsVG8oeCwgeSk7XG4gIH0gZWxzZSB7XG4gICAgZWwuc2Nyb2xsTGVmdCA9IHggfHwgMDtcbiAgICBlbC5zY3JvbGxUb3AgPSB5IHx8IDA7XG4gIH1cbn07XG5cbmRvbS5jc3MgPSBhdG9taWMoZnVuY3Rpb24oaWQsIGNzc1RleHQpIHtcbiAgaWYgKCEoaWQgaW4gZG9tLmNzcy5zdHlsZXMpKSB7XG4gICAgZG9tLmNzcy5zdHlsZXNbaWRdID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvbS5jc3Muc3R5bGVzW2lkXSk7XG4gIH1cbiAgZG9tLmNzcy5zdHlsZXNbaWRdLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn0pO1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwidmFyIFRPS0VOUyA9IC8uKz9cXGJ8LlxcQnxcXGIuKz8vZztcbnZhciBXT1JEID0gL1suL1xcXFxcXChcXClcIidcXC06LC47PD5+IUAjJCVeJipcXHxcXCs9XFxbXFxde31gflxcPyBdKy9nO1xuXG52YXIgcGFyc2UgPSBleHBvcnRzO1xuXG5wYXJzZS53b3JkcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgd29yZHMucHVzaCh3b3JkKTtcbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG5cbnBhcnNlLnRva2VucyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIHdoaWxlICh3b3JkID0gVE9LRU5TLmV4ZWMocykpIHtcbiAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICB9XG5cbiAgcmV0dXJuIHdvcmRzO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBQb2ludDtcblxuZnVuY3Rpb24gUG9pbnQocCkge1xuICBpZiAocCkge1xuICAgIHRoaXMueCA9IHAueDtcbiAgICB0aGlzLnkgPSBwLnk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy54ID0gMDtcbiAgICB0aGlzLnkgPSAwO1xuICB9XG59XG5cblBvaW50LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihwKSB7XG4gIHRoaXMueCA9IHAueDtcbiAgdGhpcy55ID0gcC55O1xufTtcblxuUG9pbnQucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh0aGlzKTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycvJ10gPVxuUG9pbnQucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18vJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvLyddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJysnXSA9XG5Qb2ludC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICsgKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLSddID1cblBvaW50LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAtIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLSAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuLy9UT0RPOiBfKiBvKiBeKiBmbG9vck11bCByb3VuZE11bCBjZWlsTXVsXG5Qb2ludC5wcm90b3R5cGVbJyonXSA9XG5Qb2ludC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXionXSA9XG5Qb2ludC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18qJ10gPVxuUG9pbnQucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gJ3g6JyArIHRoaXMueCArICcseTonICsgdGhpcy55O1xufTtcblxuUG9pbnQuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblBvaW50LmdyaWRSb3VuZCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLnJvdW5kKGEueCAvIGIud2lkdGgpLFxuICAgIHk6IE1hdGgucm91bmQoYS55IC8gYi5oZWlnaHQpXG4gIH07XG59O1xuXG5Qb2ludC5sb3cgPSBmdW5jdGlvbihsb3csIHApIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLm1heChsb3cueCwgcC54KSxcbiAgICB5OiBNYXRoLm1heChsb3cueSwgcC55KVxuICB9O1xufTtcblxuUG9pbnQuY2xhbXAgPSBmdW5jdGlvbihhcmVhLCBwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGFyZWEuZW5kLngsIE1hdGgubWF4KGFyZWEuYmVnaW4ueCwgcC54KSksXG4gICAgeTogTWF0aC5taW4oYXJlYS5lbmQueSwgTWF0aC5tYXgoYXJlYS5iZWdpbi55LCBwLnkpKVxuICB9KTtcbn07XG5cblBvaW50Lm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHsgeDogYS54ICsgYi54LCB5OiBhLnkgKyBiLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFggPSBmdW5jdGlvbih4LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCArIHgsIHk6IHAueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIHApIHtcbiAgcmV0dXJuIHsgeDogcC54LCB5OiBwLnkgKyB5IH07XG59O1xuXG5Qb2ludC50b0xlZnRUb3AgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiB7XG4gICAgbGVmdDogcC54LFxuICAgIHRvcDogcC55XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEFORDtcblxuZnVuY3Rpb24gQU5EKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IE5PVDtcblxuZnVuY3Rpb24gTk9UKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsInZhciBBTkQgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtYW5kJyk7XG52YXIgTk9UID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLW5vdCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJhbmdlO1xuXG5mdW5jdGlvbiBSYW5nZShyKSB7XG4gIGlmIChyKSB7XG4gICAgdGhpc1swXSA9IHJbMF07XG4gICAgdGhpc1sxXSA9IHJbMV07XG4gIH0gZWxzZSB7XG4gICAgdGhpc1swXSA9IDA7XG4gICAgdGhpc1sxXSA9IDE7XG4gIH1cbn07XG5cblJhbmdlLkFORCA9IEFORDtcblJhbmdlLk5PVCA9IE5PVDtcblxuUmFuZ2Uuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblJhbmdlLmVxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYVswXSA9PT0gYlswXSAmJiBhWzFdID09PSBiWzFdO1xufTtcblxuUmFuZ2UuY2xhbXAgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UoW1xuICAgIE1hdGgubWluKGJbMV0sIE1hdGgubWF4KGFbMF0sIGJbMF0pKSxcbiAgICBNYXRoLm1pbihhWzFdLCBiWzFdKVxuICBdKTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFJhbmdlKHRoaXMpO1xufTtcblxuUmFuZ2UucmFuZ2VzID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbihpdGVtKSB7IHJldHVybiBpdGVtLnJhbmdlIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdID49IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPD0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm92ZXJsYXAgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA8PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdID49IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMV0gPCByYW5nZVswXSB8fCBpdGVtLnJhbmdlWzBdID4gcmFuZ2VbMV07XG4gIH0pO1xufTtcbiIsIlxudmFyIFJlZ2V4cCA9IGV4cG9ydHM7XG5cblJlZ2V4cC5jcmVhdGUgPSBmdW5jdGlvbihuYW1lcywgZmxhZ3MsIGZuKSB7XG4gIGZuID0gZm4gfHwgZnVuY3Rpb24ocykgeyByZXR1cm4gcyB9O1xuICByZXR1cm4gbmV3IFJlZ0V4cChcbiAgICBuYW1lc1xuICAgIC5tYXAoKG4pID0+ICdzdHJpbmcnID09PSB0eXBlb2YgbiA/IFJlZ2V4cC50eXBlc1tuXSA6IG4pXG4gICAgLm1hcCgocikgPT4gZm4oci50b1N0cmluZygpLnNsaWNlKDEsLTEpKSlcbiAgICAuam9pbignfCcpLFxuICAgIGZsYWdzXG4gICk7XG59O1xuXG5SZWdleHAudHlwZXMgPSB7XG4gICd0b2tlbnMnOiAvLis/XFxifC5cXEJ8XFxiLis/LyxcbiAgJ3dvcmRzJzogL1thLXpBLVowLTldezEsfS8sXG4gICdwYXJ0cyc6IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvLFxuXG4gICdzaW5nbGUgY29tbWVudCc6IC9cXC9cXC8uKj8kLyxcbiAgJ2RvdWJsZSBjb21tZW50JzogL1xcL1xcKlteXSo/XFwqXFwvLyxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiAvKCcoPzooPzpcXFxcXFxufFxcXFwnfFteJ1xcbl0pKSo/JykvLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IC8oXCIoPzooPzpcXFxcXFxufFxcXFxcInxbXlwiXFxuXSkpKj9cIikvLFxuICAndGVtcGxhdGUgc3RyaW5nJzogLyhgKD86KD86XFxcXGB8W15gXSkpKj9gKS8sXG5cbiAgJ29wZXJhdG9yJzogLyF8Pj0/fDw9P3w9ezEsM318KD86Jil7MSwyfXxcXHw/XFx8fFxcP3xcXCp8XFwvfH58XFxefCV8XFwuKD8hXFxkKXxcXCt7MSwyfXxcXC17MSwyfS8sXG4gICdmdW5jdGlvbic6IC8gKCg/IVxcZHxbLiBdKj8oaWZ8ZWxzZXxkb3xmb3J8Y2FzZXx0cnl8Y2F0Y2h8d2hpbGV8d2l0aHxzd2l0Y2gpKVthLXpBLVowLTlfICRdKykoPz1cXCguKlxcKS4qeykvLFxuICAna2V5d29yZCc6IC9cXGIoYnJlYWt8Y2FzZXxjYXRjaHxjb25zdHxjb250aW51ZXxkZWJ1Z2dlcnxkZWZhdWx0fGRlbGV0ZXxkb3xlbHNlfGV4cG9ydHxleHRlbmRzfGZpbmFsbHl8Zm9yfGZyb218aWZ8aW1wbGVtZW50c3xpbXBvcnR8aW58aW5zdGFuY2VvZnxpbnRlcmZhY2V8bGV0fG5ld3xwYWNrYWdlfHByaXZhdGV8cHJvdGVjdGVkfHB1YmxpY3xyZXR1cm58c3RhdGljfHN1cGVyfHN3aXRjaHx0aHJvd3x0cnl8dHlwZW9mfHdoaWxlfHdpdGh8eWllbGQpXFxiLyxcbiAgJ2RlY2xhcmUnOiAvXFxiKGZ1bmN0aW9ufGludGVyZmFjZXxjbGFzc3x2YXJ8bGV0fGNvbnN0fGVudW18dm9pZClcXGIvLFxuICAnYnVpbHRpbic6IC9cXGIoT2JqZWN0fEZ1bmN0aW9ufEJvb2xlYW58RXJyb3J8RXZhbEVycm9yfEludGVybmFsRXJyb3J8UmFuZ2VFcnJvcnxSZWZlcmVuY2VFcnJvcnxTdG9wSXRlcmF0aW9ufFN5bnRheEVycm9yfFR5cGVFcnJvcnxVUklFcnJvcnxOdW1iZXJ8TWF0aHxEYXRlfFN0cmluZ3xSZWdFeHB8QXJyYXl8RmxvYXQzMkFycmF5fEZsb2F0NjRBcnJheXxJbnQxNkFycmF5fEludDMyQXJyYXl8SW50OEFycmF5fFVpbnQxNkFycmF5fFVpbnQzMkFycmF5fFVpbnQ4QXJyYXl8VWludDhDbGFtcGVkQXJyYXl8QXJyYXlCdWZmZXJ8RGF0YVZpZXd8SlNPTnxJbnRsfGFyZ3VtZW50c3xjb25zb2xlfHdpbmRvd3xkb2N1bWVudHxTeW1ib2x8U2V0fE1hcHxXZWFrU2V0fFdlYWtNYXB8UHJveHl8UmVmbGVjdHxQcm9taXNlKVxcYi8sXG4gICdzcGVjaWFsJzogL1xcYih0cnVlfGZhbHNlfG51bGx8dW5kZWZpbmVkKVxcYi8sXG4gICdwYXJhbXMnOiAvZnVuY3Rpb25bIFxcKF17MX1bXl0qP1xcey8sXG4gICdudW1iZXInOiAvLT9cXGIoMHhbXFxkQS1GYS1mXSt8XFxkKlxcLj9cXGQrKFtFZV1bKy1dP1xcZCspP3xOYU58LT9JbmZpbml0eSlcXGIvLFxuICAnc3ltYm9sJzogL1t7fVtcXF0oKSw6XS8sXG4gICdyZWdleHAnOiAvKD8hW15cXC9dKShcXC8oPyFbXFwvfFxcKl0pLio/W15cXFxcXFxeXVxcLykoWztcXG5cXC5cXClcXF1cXH0gZ2ltXSkvLFxuXG4gICd4bWwnOiAvPFtePl0qPi8sXG4gICd1cmwnOiAvKChcXHcrOlxcL1xcLylbLWEtekEtWjAtOTpAOz8mPVxcLyVcXCtcXC5cXCohJ1xcKFxcKSxcXCRfXFx7XFx9XFxeflxcW1xcXWAjfF0rKS8sXG4gICdpbmRlbnQnOiAvXiArLyxcbiAgJ2xpbmUnOiAvXi4rJHxeXFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJcbnZhciB0cmltID0gZXhwb3J0cztcblxudHJpbS5lbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgdHJhaWxpbmcgPSB0cmltLnRyYWlsaW5nRW1wdHlMaW5lcyhzKTtcbiAgdmFyIGxlYWRpbmcgPSB0cmltLmxlYWRpbmdFbXB0eUxpbmVzKHRyYWlsaW5nLnN0cmluZyk7XG4gIHJldHVybiB7XG4gICAgdHJhaWxpbmc6IHRyYWlsaW5nLnJlbW92ZWQsXG4gICAgbGVhZGluZzogbGVhZGluZy5yZW1vdmVkLFxuICAgIHJlbW92ZWQ6IHRyYWlsaW5nLnJlbW92ZWQgKyBsZWFkaW5nLnJlbW92ZWQsXG4gICAgc3RyaW5nOiBsZWFkaW5nLnN0cmluZ1xuICB9O1xufTtcblxudHJpbS50cmFpbGluZ0VtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciBpbmRleCA9IHMubGVuZ3RoO1xuICB2YXIgbGFzdEluZGV4ID0gaW5kZXg7XG4gIHZhciBuID0gMDtcbiAgd2hpbGUgKFxuICAgIH4oaW5kZXggPSBzLmxhc3RJbmRleE9mKCdcXG4nLCBsYXN0SW5kZXggLSAxKSlcbiAgICAmJiBpbmRleCAtIGxhc3RJbmRleCA9PT0gLTEpIHtcbiAgICBuKys7XG4gICAgbGFzdEluZGV4ID0gaW5kZXg7XG4gIH1cblxuICBpZiAobikgcyA9IHMuc2xpY2UoMCwgbGFzdEluZGV4KTtcblxuICByZXR1cm4ge1xuICAgIHJlbW92ZWQ6IG4sXG4gICAgc3RyaW5nOiBzXG4gIH07XG59O1xuXG50cmltLmxlYWRpbmdFbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgaW5kZXggPSAtMTtcbiAgdmFyIGxhc3RJbmRleCA9IGluZGV4O1xuICB2YXIgbiA9IDA7XG5cbiAgd2hpbGUgKFxuICAgIH4oaW5kZXggPSBzLmluZGV4T2YoJ1xcbicsIGxhc3RJbmRleCArIDEpKVxuICAgICYmIGluZGV4IC0gbGFzdEluZGV4ID09PSAxKSB7XG4gICAgbisrO1xuICAgIGxhc3RJbmRleCA9IGluZGV4O1xuICB9XG5cbiAgaWYgKG4pIHMgPSBzLnNsaWNlKGxhc3RJbmRleCArIDEpO1xuXG4gIHJldHVybiB7XG4gICAgcmVtb3ZlZDogbixcbiAgICBzdHJpbmc6IHNcbiAgfTtcbn07XG4iLCJ2YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xudmFyIGF0b21pYyA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hdG9taWMnKTtcbnZhciBwYXJzZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wYXJzZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuLi8uLi9saWIvYXJlYScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgTGluZXMgPSByZXF1aXJlKCcuL2xpbmVzJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcbnZhciBTZWdtZW50cyA9IHJlcXVpcmUoJy4vc2VnbWVudHMnKTtcbnZhciBTa2lwU3RyaW5nID0gcmVxdWlyZSgnLi9za2lwc3RyaW5nJyk7XG52YXIgUHJlZml4VHJlZSA9IHJlcXVpcmUoJy4vcHJlZml4dHJlZScpO1xudmFyIEluZGV4ZXIgPSByZXF1aXJlKCcuL2luZGV4ZXInKTtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gQnVmZmVyO1xuXG52YXIgRU9MID0gZXhwb3J0cy5FT0wgPSAvXFxyXFxufFxccnxcXG4vZztcbnZhciBOID0gZXhwb3J0cy5OID0gL1xcbi9nO1xudmFyIENIVU5LX1NJWkUgPSBleHBvcnRzLkNIVU5LX1NJWkUgPSA1MDAwO1xudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3Rva2VucyddLCAnZycpO1xuXG5mdW5jdGlvbiBCdWZmZXIoKSB7XG4gIHRoaXMuc3ludGF4ID0gbmV3IFN5bnRheDtcbiAgdGhpcy5pbmRleGVyID0gbmV3IEluZGV4ZXIodGhpcyk7XG4gIHRoaXMuc2VnbWVudHMgPSBuZXcgU2VnbWVudHModGhpcyk7XG4gIHRoaXMub24oJ3VwZGF0ZScsIGRlYm91bmNlKHRoaXMudXBkYXRlUmF3LmJpbmQodGhpcyksIDMwMCkpO1xuICB0aGlzLm9uKCdyYXcnLCB0aGlzLnNlZ21lbnRzLmluZGV4LmJpbmQodGhpcy5zZWdtZW50cykpO1xuICB0aGlzLnNldCgnJyk7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUgPSB7XG4gIGdldCBsb2MoKSB7XG4gICAgcmV0dXJuIHRoaXMubGluZXMubGVuZ3RoO1xuICB9XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihyYW5nZSkge1xuICBpZiAoIXJhbmdlKSByZXR1cm4gdGhpcy50ZXh0LmdldFJhbmdlKCk7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5saW5lcy5nZXRSYW5nZShyYW5nZSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbnZhciBCTE9DSyA9IHtcbiAgJ2NvbW1lbnQnOiAnLyonLFxuICAnc3RyaW5nJzogJ2AnLFxufTtcblxudmFyIEJMT0NLX0VORCA9IHtcbiAgJ2NvbW1lbnQnOiAnKi8nLFxuICAnc3RyaW5nJzogJ2AnLFxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRIaWdobGlnaHRlZCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBjb2RlID0gdGhpcy5nZXQocmFuZ2UpO1xuICAvLyByZXR1cm4gdGhpcy5zeW50YXguZW50aXRpZXMoY29kZSk7XG4gIC8vIHJldHVybiB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSk7XG5cbiAgdmFyIGJsb2NrID0gdGhpcy5zZWdtZW50cy5nZXQocmFuZ2VbMF0pO1xuICAvLyBjb25zb2xlLnRpbWVFbmQoJ2dldCBzZWdtZW50JylcbiAgaWYgKGJsb2NrKSB7XG4gICAgY29kZSA9IEJMT0NLW2Jsb2NrXSArICdcXHVmZmJhJyArIGNvZGUgKyAnXFx1ZmZiZScgKyBCTE9DS19FTkRbYmxvY2tdO1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSk7XG4gICAgY29kZSA9ICc8JyArIGJsb2NrICsgJz4nICtcbiAgICAgIGNvZGUuc3Vic3RyaW5nKFxuICAgICAgICBjb2RlLmluZGV4T2YoJ1xcdWZmYmEnKSArIDEsXG4gICAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUgKyAnXFx1ZmZiZSovYCcpO1xuICAgIGNvZGUgPSBjb2RlLnN1YnN0cmluZyhcbiAgICAgIDAsXG4gICAgICBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJylcbiAgICApO1xuICB9XG4gIHJldHVybiBjb2RlO1xufTtcblxuLy9UT0RPOiB0aGlzIGRlZmVhdHMgdGhlIHB1cnBvc2Ugb2YgaGF2aW5nIGEgc2tpcGxpc3Rcbi8vIG5lZWQgdG8gZ2V0IHJpZCBvZiBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLnVwZGF0ZVJhdyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJhdyA9IHRoaXMuZ2V0KCk7XG4gIHRoaXMuZW1pdCgncmF3JywgdGhpcy5yYXcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBwb2ludCA9IHRoaXMubGluZXMuZ2V0T2Zmc2V0KG9mZnNldCk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKHBvaW50LmxpbmUucmFuZ2UpO1xuICByZXR1cm4ge1xuICAgIHBvaW50OiBwb2ludCxcbiAgICB0ZXh0OiB0ZXh0XG4gIH07XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmdldChbeSx5XSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5jaGFuZ2VzID0gMDtcblxuICB0aGlzLnJhdyA9IHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG4gIHRoaXMuZW1pdCgncmF3JywgdGhpcy5yYXcpO1xuXG4gIHRoaXMudGV4dCA9IG5ldyBTa2lwU3RyaW5nKHsgY2h1bmtTaXplOiBDSFVOS19TSVpFIH0pO1xuICB0aGlzLnRleHQuc2V0KHRleHQpO1xuXG4gIHRoaXMucHJlZml4ID0gbmV3IFByZWZpeFRyZWU7XG4gIHRoaXMucHJlZml4LmluZGV4KHRoaXMucmF3KTtcblxuICB0aGlzLmxpbmVzID0gbmV3IExpbmVzO1xuICB0aGlzLmxpbmVzLmluc2VydCh7IHg6MCwgeTowIH0sIHRoaXMucmF3KTtcblxuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihwb2ludCwgdGV4dCwgc2hpZnQsIGlzQ3RybFNoaWZ0KSB7XG4gIHZhciBpc0VPTCwgbGluZXMsIHJhbmdlLCBiZWZvcmUsIGFmdGVyO1xuXG4gIHRoaXMuY2hhbmdlcysrO1xuXG4gIGlmICghaXNDdHJsU2hpZnQpIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgaXNFT0wgPSAnXFxuJyA9PT0gdGV4dDtcblxuICBwb2ludCA9IHRoaXMubGluZXMuZ2V0UG9pbnQocG9pbnQpO1xuICBsaW5lcyA9IHRoaXMubGluZXMuaW5zZXJ0KHBvaW50LCB0ZXh0KTtcbiAgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIGxpbmVzXTtcblxuICBzaGlmdCA9ICFpc0N0cmxTaGlmdCAmJiAoc2hpZnQgfHwgaXNFT0wpO1xuXG4gIGJlZm9yZSA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG5cbiAgYWZ0ZXIgPSB0aGlzLmdldChyYW5nZSk7XG5cbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICBpZiAoaXNDdHJsU2hpZnQpIHJhbmdlID0gW01hdGgubWF4KDAsIHJhbmdlWzBdLTEpLCByYW5nZVsxXV07XG5cbiAgdGhpcy5zZWdtZW50cy5zaGlmdChwb2ludC5vZmZzZXQsIHRleHQubGVuZ3RoKTtcblxuICAvL1RPRE86IGkgdGhpbmsgc2hpZnQgc2hvdWxkIGJlICdsaW5lcydcbiAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xuXG4gIC8vIHRoaXMgaXMgdG8gdXBkYXRlIGNhcmV0IHBvc2l0aW9uXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQ2hhckF0ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGlzRU9MLCByYW5nZSwgYmVmb3JlLCBhZnRlcjtcblxuICB0aGlzLmNoYW5nZXMrKztcblxuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICBwb2ludCA9IHRoaXMubGluZXMuZ2V0UG9pbnQocG9pbnQpO1xuICBpc0VPTCA9IHRoaXMubGluZXMucmVtb3ZlQ2hhckF0KHBvaW50KTtcbiAgcmFuZ2UgPSBSYW5nZS5jbGFtcChbMCwgdGhpcy5saW5lcy5sZW5ndGhdLCBbcG9pbnQueSwgcG9pbnQueSArIGlzRU9MXSk7XG5cbiAgYmVmb3JlID0gdGhpcy5nZXQocmFuZ2UpO1xuXG4gIHRoaXMudGV4dC5yZW1vdmVDaGFyQXQocG9pbnQub2Zmc2V0KTtcblxuICBhZnRlciA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG5cbiAgdGhpcy5zZWdtZW50cy5zaGlmdChwb2ludC5vZmZzZXQsIC0xKTtcblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCAtaXNFT0wsIGJlZm9yZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBdCA9IGZ1bmN0aW9uKHBvaW50LCBpbmNsdXNpdmUpIHtcbiAgaW5jbHVzaXZlID0gaW5jbHVzaXZlIHx8IDA7XG5cbiAgcG9pbnQgPSB0aGlzLmxpbmVzLmdldFBvaW50KHBvaW50KTtcblxuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLnJhbmdlKTtcblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQXJlYSA9IGZ1bmN0aW9uKGFyZWEsIG5vVXBkYXRlKSB7XG4gIHZhciByYW5nZSwgb2Zmc2V0cywgbGluZXM7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgb2Zmc2V0cyA9IHRoaXMubGluZXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICBsaW5lcyA9IHRoaXMubGluZXMucmVtb3ZlQXJlYShhcmVhKTtcbiAgcmFuZ2UgPSBbYXJlYS5iZWdpbi55LCBhcmVhLmVuZC55XTtcblxuICB0aGlzLnRleHQucmVtb3ZlKG9mZnNldHMpO1xuXG4gIHRoaXMuc2VnbWVudHMuc2hpZnQob2Zmc2V0c1swXSwgb2Zmc2V0c1swXS1vZmZzZXRzWzFdKTtcblxuICBpZiAoIW5vVXBkYXRlKSB7XG4gICAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSk7XG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmxpbmVzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmVuZC54ID4gMCB8fCBhcmVhLmJlZ2luLnkgPT09IGFyZWEuZW5kLnkpIGFyZWEuZW5kLnkgKz0gMTtcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwO1xuICBhcmVhLmVuZC54ID0gMDtcblxuICB2YXIgdGV4dCA9IHRoaXMuZ2V0KFthcmVhLmJlZ2luLnksIGFyZWEuZW5kLnktMV0pO1xuICB0aGlzLmRlbGV0ZUFyZWEoYXJlYSwgdHJ1ZSk7XG5cbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0LCB5LCB0cnVlKTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVPTChzKSB7XG4gIHJldHVybiBzLnJlcGxhY2UoZXhwb3J0cy5FT0wsICdcXG4nKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBJbmRleGVyO1xuXG5mdW5jdGlvbiBJbmRleGVyKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbn1cblxuSW5kZXhlci5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKCFzKSByZXR1cm4gW107XG4gIHZhciBvZmZzZXRzID0gW107XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIucmF3O1xuICB2YXIgbGVuID0gcy5sZW5ndGg7XG4gIHZhciBpbmRleDtcbiAgd2hpbGUgKH4oaW5kZXggPSB0ZXh0LmluZGV4T2YocywgaW5kZXggKyBsZW4pKSkge1xuICAgIG9mZnNldHMucHVzaChpbmRleCk7XG4gIH1cbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuIiwiXG4vKlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXyA9IGNhcmV0XG4gKlxuICogICAwICAgMSAgIDIgICAzICAgNCAgICA1ICAgMCAgIDEgICAyICAgMyAgIDQgICAgNSAgIDAgICAxICAgMlxuICogfCBoIHwgZSB8IGwgfCBsIHwgbyB8IFxcbiB8IHcgfCBvIHwgciB8IGwgfCBkIHwgXFxuIHwgISB8ICEgfCBfIHxcbiAqIDAgICAxICAgMiAgIDMgICA0ICAgNSAgICA2ICAgNyAgIDggICA5ICAgMTAgIDExICAgMTIgIDEzICAxNCAgMTVcbiAqXG4gKiBnZXQoMCkgLT4gMFxuICogZ2V0KDEpIC0+IDZcbiAqIGdldCgyKSAtPiAxMlxuICogZ2V0KDMpIC0+IHRocm93c1xuICpcbiAqIGxlZnQgaW5jbHVzaXZlLCByaWdodCBleGNsdXNpdmU6XG4gKlxuICogZ2V0TGluZSh4KS5vZmZzZXQgPT09IGdldCh4KVxuICogZ2V0TGluZSgwKS5yYW5nZSAtPiAwLTZcbiAqIGdldExpbmUoMSkucmFuZ2UgLT4gNi0xMlxuICogZ2V0TGluZSgyKS5yYW5nZSAtPiAxMi0xM1xuICogZ2V0TGluZSgzKSAtPiB0aHJvd3NcbiAqXG4gKiBnZXRSYW5nZShbMCwwXSkgLT4gMC02XG4gKiBnZXRSYW5nZShbMCwxXSkgLT4gMC0xMlxuICogZ2V0UmFuZ2UoWzEsMV0pIC0+IDYtMTJcbiAqIGdldFJhbmdlKFsxLDJdKSAtPiA2LTEzXG4gKiBnZXRSYW5nZShbMiwyXSkgLT4gMTItMTNcbiAqIGdldFJhbmdlKFsyLDNdKSAtPiB0aHJvd3NcbiAqIGdldFJhbmdlKFswLDNdKSAtPiB0aHJvd3NcbiAqXG4gKiBnZXRQb2ludCh7IHg6eCwgeTp5IH0pLmxpbmUgPT09IGdldExpbmUoeSlcbiAqIGdldFBvaW50KHsgeDowLCB5OjAgfSkub2Zmc2V0IC0+IDBcbiAqIGdldFBvaW50KHsgeDowLCB5OjAgfSkucG9pbnQgLT4geyB4OjAsIHk6MCB9XG4gKiBnZXRQb2ludCh7IHg6MiwgeTowIH0pLm9mZnNldCAtPiAyXG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MCB9KS5vZmZzZXQgLT4gNVxuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjAgfSkucG9pbnQgLT4geyB4OjUsIHk6MCB9XG4gKiBnZXRQb2ludCh7IHg6MCwgeToxIH0pLm9mZnNldCAtPiA2XG4gKiBnZXRQb2ludCh7IHg6MiwgeToxIH0pLm9mZnNldCAtPiA4XG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MSB9KS5vZmZzZXQgLT4gMTFcbiAqIGdldFBvaW50KHsgeDoxMCwgeToxIH0pLnBvaW50IC0+IHsgeDo1LCB5OjEgfVxuICogZ2V0UG9pbnQoeyB4OjAsIHk6MiB9KS5vZmZzZXQgLT4gMTJcbiAqIGdldFBvaW50KHsgeDoxMCwgeToyIH0pLm9mZnNldCAtPiAxM1xuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjIgfSkucG9pbnQgLT4geyB4OjEsIHk6MiB9XG4gKiBnZXRSYW5nZSh7IHg6MTAwLCB5OjEwMCB9KS5vZmZzZXQgLT4gMTNcbiAqIGdldFJhbmdlKHsgeDoxMDAsIHk6MTAwIH0pLnBvaW50IC0+IHsgeDoxLCB5OiAyIH1cbiAqXG4gKiBnZXRMaW5lTGVuZ3RoKDApIC0+IDZcbiAqIGdldExpbmVMZW5ndGgoMSkgLT4gNlxuICogZ2V0TGluZUxlbmd0aCgyKSAtPiAyXG4gKiBnZXRMaW5lTGVuZ3RoKDMpIC0+IHRocm93c1xuICovXG5cbnZhciBFT0wgPSAvXFxyXFxufFxccnxcXG4vZztcbnZhciBOID0gL1xcbi9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IExpbmVzO1xuXG5mdW5jdGlvbiBMaW5lcygpIHtcbiAgdGhpcy5pbmRleCA9IFtdO1xuICB0aGlzLnRhaWwgPSAnJztcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5MaW5lcy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5kZXhbdGhpcy5sZW5ndGggLSAxXSArIHRoaXMudGFpbC5sZW5ndGggKyAxO1xuICB9XG4gIHZhciBsaW5lID0gdGhpcy5pbmRleFt5IC0gMV0gfHwgMDtcblxuICByZXR1cm4geSA+IDAgPyBsaW5lICsgMSA6IDA7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIGI7XG5cbiAgaWYgKHJhbmdlWzFdICsgMSA+PSB0aGlzLmxlbmd0aCArIDEpIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0pICsgdGhpcy50YWlsLmxlbmd0aDtcbiAgfSBlbHNlIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0gKyAxKTtcbiAgfVxuXG4gIHJldHVybiBbYSwgYl07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0RGlzdGFuY2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIGI7XG5cbiAgaWYgKHJhbmdlWzFdID09PSB0aGlzLmxlbmd0aCArIDEpIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0gLSAxKSArIHRoaXMudGFpbC5sZW5ndGg7XG4gIH0gZWxzZSB7XG4gICAgYiA9IHRoaXMuZ2V0KHJhbmdlWzFdKSAtIDE7XG4gIH1cblxuICByZXR1cm4gYiAtIGE7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuZ2V0RGlzdGFuY2UoW3ksIHkrMV0pO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExvbmdlc3RMaW5lTGVuZ3RoID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsb25nZXN0ID0gMDtcbiAgdmFyIGQgPSAwO1xuICB2YXIgcCA9IHRoaXMuaW5kZXhbdGhpcy5sZW5ndGggLSAxXTtcbiAgdmFyIGkgPSB0aGlzLmxlbmd0aDtcbiAgd2hpbGUgKGktLSA+IDApIHtcbiAgICBkID0gdGhpcy5pbmRleFtpXSAtIHRoaXMuaW5kZXhbaSAtIDFdO1xuICAgIGxvbmdlc3QgPSBkID4gbG9uZ2VzdCA/IGQgOiBsb25nZXN0O1xuICB9XG4gIHJldHVybiBsb25nZXN0O1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBvZmZzZXQgPSB0aGlzLmdldCh5KTtcbiAgdmFyIHBvaW50ID0geyB4OiAwLCB5OiB5IH07XG4gIHZhciBsZW5ndGggPSB0aGlzLmdldExpbmVMZW5ndGgocG9pbnQueSk7XG4gIHZhciByYW5nZSA9IFtvZmZzZXQsIG9mZnNldCArIGxlbmd0aF07XG5cbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICBwb2ludDogcG9pbnQsXG4gICAgcmFuZ2U6IHJhbmdlLFxuICAgIGxlbmd0aDogbGVuZ3RoLFxuICB9O1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocG9pbnQueSk7XG5cbiAgdmFyIHBvaW50ID0ge1xuICAgIHg6IE1hdGgubWluKHBvaW50LngsIGxpbmUubGVuZ3RoKSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIG9mZnNldDogbGluZS5vZmZzZXQgKyBwb2ludC54LFxuICAgIHBvaW50OiBwb2ludCxcbiAgICB4OiBwb2ludC54LFxuICAgIHk6IHBvaW50LnksXG4gICAgbGluZTogbGluZSxcbiAgfTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHRoaXMubGVuZ3RoO1xuICBpZiAoIWVuZCkgcmV0dXJuO1xuXG4gIHZhciBwID0gLTE7XG4gIHZhciBpID0gLTE7XG5cbiAgZG8ge1xuICAgIHAgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBpZiAodGhpcy5nZXQoaSkgPD0gb2Zmc2V0KSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwICE9PSBpKTtcblxuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShpKTtcbiAgdmFyIHggPSBvZmZzZXQgLSBsaW5lLm9mZnNldDtcbiAgaWYgKCB4ID4gbGluZS5sZW5ndGhcbiAgICAmJiBpID09PSB0aGlzLmxlbmd0aCAtIDEpIHtcbiAgICB4IC09IGxpbmUubGVuZ3RoICsgMTtcbiAgICBpICs9IDE7XG4gICAgaWYgKHggPiB0aGlzLnRhaWwubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogaSxcbiAgICBsaW5lOiBsaW5lXG4gIH07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocCwgdGV4dCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgeCA9IHBvaW50Lng7XG4gIHZhciB5ID0gcG9pbnQueTtcbiAgdmFyIG9mZnNldCA9IHBvaW50Lm9mZnNldDtcblxuICBpZiAoeSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0ZXh0ID0gdGhpcy50YWlsLnN1YnN0cigwLHgpICsgdGV4dCArIHRoaXMudGFpbC5zdWJzdHIoeCk7XG4gICAgdGhpcy50YWlsID0gJyc7XG4gICAgb2Zmc2V0IC09IHg7XG4gIH1cblxuICB2YXIgbWF0Y2hlcyA9IFt5LCAwXTtcbiAgdmFyIG1hdGNoID0gLTE7XG4gIHZhciBzaGlmdCA9IDA7XG4gIHZhciBsYXN0ID0gLTE7XG5cbiAgd2hpbGUgKH4obWF0Y2ggPSB0ZXh0LmluZGV4T2YoJ1xcbicsIG1hdGNoICsgMSkpKSB7XG4gICAgbWF0Y2hlcy5wdXNoKG1hdGNoICsgb2Zmc2V0KTtcbiAgICBsYXN0ID0gbWF0Y2g7XG4gIH1cblxuICBzaGlmdCArPSBsYXN0ICsgMTtcblxuICB2YXIgdGFpbCA9IHRleHQuc2xpY2UobGFzdCArIDEpO1xuICBpZiAoeSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0aGlzLnRhaWwgKz0gdGFpbDtcbiAgfVxuXG4gIGlmICh5IDwgdGhpcy5sZW5ndGgpIHtcbiAgICBzaGlmdCArPSB0YWlsLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0KHksIHNoaWZ0KTtcbiAgfVxuXG4gIGlmIChtYXRjaGVzLmxlbmd0aCA8IDMpIHJldHVybiAwO1xuXG4gIHRoaXMuaW5kZXguc3BsaWNlLmFwcGx5KHRoaXMuaW5kZXgsIG1hdGNoZXMpO1xuXG4gIHZhciBsaW5lcyA9IHRoaXMuaW5kZXgubGVuZ3RoIC0gdGhpcy5sZW5ndGg7XG5cbiAgdGhpcy5sZW5ndGggPSB0aGlzLmluZGV4Lmxlbmd0aDtcblxuICByZXR1cm4gbGluZXM7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuaW5zZXJ0TGluZSA9IGZ1bmN0aW9uKHksIHRleHQpIHtcbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6eSB9LCB0ZXh0KTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgYXJlYS5iZWdpbi55LFxuICAgIGFyZWEuZW5kLnlcbiAgXSk7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICByZXR1cm4gW1xuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5iZWdpbikub2Zmc2V0LFxuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpLm9mZnNldFxuICBdO1xufTtcblxuTGluZXMucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGEgPSB0aGlzLmdldFBvaW50KHApO1xuICBpZiAoYS5wb2ludC55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgIHRoaXMudGFpbCA9IHRoaXMudGFpbC5zbGljZSgwLCAtMSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGVsc2Uge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IGEubGluZS5sZW5ndGggPT09IGEucG9pbnQueDtcbiAgICBpZiAoaXNFbmRPZkxpbmUpIHtcbiAgICAgIHRoaXMuaW5kZXguc3BsaWNlKGEucG9pbnQueSwgMSk7XG4gICAgICB0aGlzLmxlbmd0aCA9IHRoaXMuaW5kZXgubGVuZ3RoO1xuICAgICAgaWYgKGEucG9pbnQueSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy50YWlsICs9IG5ldyBBcnJheShhLmxpbmUubGVuZ3RoKzEpLmpvaW4oJyonKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5zaGlmdChhLnBvaW50LnksIC0xKTtcbiAgICByZXR1cm4gaXNFbmRPZkxpbmU7XG4gIH1cbn07XG5cbkxpbmVzLnByb3RvdHlwZS5yZW1vdmVBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgYmVnaW4gPSB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pO1xuICB2YXIgZW5kID0gdGhpcy5nZXRQb2ludChhcmVhLmVuZCk7XG5cbiAgdmFyIHggPSAwO1xuXG4gIHZhciBkaXN0ID0gZW5kLnkgLSBiZWdpbi55O1xuICB2YXIgc2FtZUxpbmUgPSBiZWdpbi55ID09PSBlbmQueTtcbiAgaWYgKHNhbWVMaW5lKSB4ID0gZW5kLnggLSBiZWdpbi54O1xuICBlbHNlIHtcbiAgICB0aGlzLmluZGV4LnNwbGljZShiZWdpbi55LCBkaXN0KTtcbiAgfVxuXG4gIGlmICghc2FtZUxpbmUpIHtcbiAgICBpZiAoYXJlYS5iZWdpbi55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKDAsIC14KTtcbiAgICB9XG4gICAgaWYgKGFyZWEuZW5kLnkgPT09IHRoaXMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRhaWwgPSB0aGlzLnRhaWwuc2xpY2UoZW5kLngpO1xuICAgICAgdGhpcy50YWlsICs9IG5ldyBBcnJheShiZWdpbi54ICsgMSkuam9pbignKicpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoYXJlYS5iZWdpbi55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKDAsIGJlZ2luLngpICsgdGhpcy50YWlsLnNsaWNlKGVuZC54KTtcbiAgICB9XG4gIH1cblxuICB0aGlzLnNoaWZ0KGFyZWEuYmVnaW4ueSwgLShlbmQub2Zmc2V0IC0gYmVnaW4ub2Zmc2V0KSk7XG5cbiAgdmFyIGRpZmYgPSB0aGlzLmxlbmd0aCAtIHRoaXMuaW5kZXgubGVuZ3RoO1xuXG4gIHRoaXMubGVuZ3RoID0gdGhpcy5pbmRleC5sZW5ndGg7XG5cbiAgcmV0dXJuIGRpZmY7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuc2hpZnQgPSBmdW5jdGlvbih5LCBkaWZmKSB7XG4gIGZvciAodmFyIGkgPSB5OyBpIDwgdGhpcy5pbmRleC5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMuaW5kZXhbaV0gKz0gZGlmZjtcbiAgfVxufTtcblxuTGluZXMucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxpbmVzID0gbmV3IExpbmVzO1xuICBsaW5lcy5pbmRleCA9IHRoaXMuaW5kZXguc2xpY2UoKTtcbiAgbGluZXMudGFpbCA9IHRoaXMudGFpbDtcbiAgbGluZXMubGVuZ3RoID0gdGhpcy5sZW5ndGg7XG4gIHJldHVybiBsaW5lcztcbn07XG5cbkxpbmVzLmNvdW50ID0gZnVuY3Rpb24odGV4dCkge1xuICByZXR1cm4gdGhpcy50ZXh0Lm1hdGNoKE4pLmxlbmd0aDtcbn07XG5cbmZ1bmN0aW9uIGFkZChiKSB7XG4gIHJldHVybiBmdW5jdGlvbihhKSB7XG4gICAgcmV0dXJuIGEgKyBiO1xuICB9O1xufVxuIiwiLy8gdmFyIFdPUkQgPSAvXFx3Ky9nO1xudmFyIFdPUkQgPSAvW2EtekEtWjAtOV17MSx9L2dcbnZhciByYW5rID0gMDtcblxubW9kdWxlLmV4cG9ydHMgPSBQcmVmaXhUcmVlTm9kZTtcblxuZnVuY3Rpb24gUHJlZml4VHJlZU5vZGUoKSB7XG4gIHRoaXMudmFsdWUgPSAnJztcbiAgdGhpcy5yYW5rID0gMDtcbiAgdGhpcy5jaGlsZHJlbiA9IHt9O1xufVxuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZ2V0U29ydGVkQ2hpbGRyZW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNoaWxkcmVuID0gT2JqZWN0XG4gICAgLmtleXModGhpcy5jaGlsZHJlbilcbiAgICAubWFwKChrZXkpID0+IHRoaXMuY2hpbGRyZW5ba2V5XSk7XG5cbiAgLy9UT0RPOiBvbmx5IGZpbHRlciBhbmQgc29ydCBpbiB0aGUgZW5kXG4gIHJldHVybiBjaGlsZHJlblxuICAgIC5yZWR1Y2UoKHAsIG4pID0+IHAuY29uY2F0KG4uZ2V0U29ydGVkQ2hpbGRyZW4oKSksIGNoaWxkcmVuKVxuICAgIC5maWx0ZXIoKG5vZGUpID0+IG5vZGUudmFsdWUpXG4gICAgLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIHZhciByZXMgPSBiLnJhbmsgLSBhLnJhbms7XG4gICAgICBpZiAocmVzID09PSAwKSByZXMgPSBiLnZhbHVlLmxlbmd0aCAtIGEudmFsdWUubGVuZ3RoO1xuICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYS52YWx1ZSA+IGIudmFsdWU7XG4gICAgICByZXR1cm4gcmVzO1xuICAgIH0pO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmNvbGxlY3QgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIGNvbGxlY3Rpb24gPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmZpbmQoa2V5KTtcbiAgaWYgKG5vZGUpIHtcbiAgICBjb2xsZWN0aW9uID0gbm9kZS5nZXRTb3J0ZWRDaGlsZHJlbigpO1xuICAgIGlmIChub2RlLnZhbHVlKSBjb2xsZWN0aW9uLnB1c2gobm9kZSk7XG4gIH1cbiAgcmV0dXJuIGNvbGxlY3Rpb247XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIGZvciAodmFyIGNoYXIgaW4ga2V5KSB7XG4gICAgaWYgKGtleVtjaGFyXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltrZXlbY2hhcl1dO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG4gIHJldHVybiBub2RlO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgdmFyIGkgPSAwO1xuICB2YXIgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGlmIChzW2ldIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW3NbaV1dO1xuICAgICAgaSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBub2RlID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dIHx8IG5ldyBQcmVmaXhUcmVlTm9kZTtcbiAgICBpKys7XG4gIH1cblxuICBub2RlLnZhbHVlID0gcztcbiAgbm9kZS5yYW5rKys7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkO1xuICB3aGlsZSAod29yZCA9IFdPUkQuZXhlYyhzKSkge1xuICAgIHRoaXMuaW5zZXJ0KHdvcmRbMF0pO1xuICB9XG59O1xuIiwiXG52YXIgQmVnaW4gPSAvW1xcLydcImBdL2c7XG5cbnZhciBNYXRjaCA9IHtcbiAgJ3NpbmdsZSBjb21tZW50JzogWycvLycsJ1xcbiddLFxuICAnZG91YmxlIGNvbW1lbnQnOiBbJy8qJywnKi8nXSxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IFsnYCcsJ2AnXSxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBbXCInXCIsXCInXCJdLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFsnXCInLCdcIiddLFxuICAncmVnZXhwJzogWycvJywnLyddLFxufTtcblxudmFyIFNraXAgPSB7XG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdzaW5nbGUgY29tbWVudCc6IGZhbHNlLFxuICAnZG91YmxlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ3JlZ2V4cCc6IFwiXFxcXFwiLFxufTtcblxudmFyIFRva2VuID0ge307XG5mb3IgKHZhciBrZXkgaW4gTWF0Y2gpIHtcbiAgdmFyIE0gPSBNYXRjaFtrZXldO1xuICBUb2tlbltNWzBdXSA9IGtleTtcbn1cblxudmFyIFRPS0VOID0gLyhcXC9cXCopfChcXCpcXC8pfChgKS9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRzO1xuXG5mdW5jdGlvbiBTZWdtZW50cyhidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG4gIHRoaXMuc2VnbWVudHMgPSBbXTtcbiAgdGhpcy5jbGVhckNhY2hlKCk7XG59XG5cbnZhciBMZW5ndGggPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAyLFxuICAnY2xvc2UgY29tbWVudCc6IDIsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAxLFxufTtcblxudmFyIE5vdE9wZW4gPSB7XG4gICdjbG9zZSBjb21tZW50JzogdHJ1ZVxufTtcblxudmFyIENsb3NlcyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjbG9zZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRhZyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICdzdHJpbmcnLFxufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHkpIHtcbiAgaWYgKHkgaW4gdGhpcy5jYWNoZS5zdGF0ZSkgcmV0dXJuIHRoaXMuY2FjaGUuc3RhdGVbeV07XG5cbiAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgdmFyIHN0YXRlID0gbnVsbDtcbiAgdmFyIHdhaXRGb3IgPSAnJztcbiAgdmFyIHBvaW50ID0geyB4Oi0xLCB5Oi0xIH07XG4gIHZhciBjbG9zZSA9IDA7XG4gIHZhciBzZWdtZW50O1xuICB2YXIgcmFuZ2U7XG4gIHZhciB0ZXh0O1xuICB2YXIgdmFsaWQ7XG4gIHZhciBsYXN0O1xuXG4gIHZhciBpID0gMDtcblxuICAvL1RPRE86IG9wdGltaXphdGlvbjpcbiAgLy8gY2FjaGUgc2VnbWVudCB5IHdpdGggb3Blbi9jbG9zZS9zdGF0ZSBzbyB3ZSBza2lwXG4gIC8vIGl0ZXJhdGluZyBmcm9tIHRoZSBiZWdpbiBldmVyeSB0aW1lXG5cbiAgZm9yICg7IGkgPCB0aGlzLnNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgc2VnbWVudCA9IHRoaXMuc2VnbWVudHNbaV07XG5cbiAgICBpZiAob3Blbikge1xuICAgICAgaWYgKHdhaXRGb3IgPT09IHNlZ21lbnQudHlwZSkge1xuICAgICAgICBwb2ludCA9IHRoaXMuZ2V0UG9pbnRPZmZzZXQoc2VnbWVudC5vZmZzZXQpO1xuICAgICAgICBpZiAoIXBvaW50KSByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBudWxsKTtcbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkgcmV0dXJuICh0aGlzLmNhY2hlLnN0YXRlW3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcblxuICAgICAgICAvLyBjb25zb2xlLmxvZygnY2xvc2UnLCBzZWdtZW50LnR5cGUsIHNlZ21lbnQub2Zmc2V0LCB0aGlzLmJ1ZmZlci50ZXh0LmdldFJhbmdlKFtzZWdtZW50Lm9mZnNldCwgc2VnbWVudC5vZmZzZXQgKyAxMF0pKVxuICAgICAgICBsYXN0ID0gc2VnbWVudDtcbiAgICAgICAgbGFzdC5wb2ludCA9IHBvaW50O1xuICAgICAgICBzdGF0ZSA9IG51bGw7XG4gICAgICAgIG9wZW4gPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcG9pbnQgPSB0aGlzLmdldFBvaW50T2Zmc2V0KHNlZ21lbnQub2Zmc2V0KTtcbiAgICAgIGlmICghcG9pbnQpIHJldHVybiAodGhpcy5jYWNoZS5zdGF0ZVt5XSA9IG51bGwpO1xuXG4gICAgICByYW5nZSA9IHBvaW50LmxpbmUucmFuZ2U7XG5cbiAgICAgIGlmIChsYXN0ICYmIGxhc3QucG9pbnQueSA9PT0gcG9pbnQueSkge1xuICAgICAgICBjbG9zZSA9IGxhc3QucG9pbnQueCArIExlbmd0aFtsYXN0LnR5cGVdO1xuICAgICAgICAvLyBjb25zb2xlLmxvZygnbGFzdCBvbmUgd2FzJywgbGFzdC50eXBlLCBsYXN0LnBvaW50LngsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW2xhc3Qub2Zmc2V0LCBsYXN0Lm9mZnNldCArIDEwXSkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjbG9zZSA9IDA7XG4gICAgICB9XG4gICAgICB2YWxpZCA9IHRoaXMuaXNWYWxpZFJhbmdlKFtyYW5nZVswXSwgcmFuZ2VbMV0rMV0sIHNlZ21lbnQsIGNsb3NlKTtcblxuICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgIGlmIChOb3RPcGVuW3NlZ21lbnQudHlwZV0pIGNvbnRpbnVlO1xuICAgICAgICAvLyBjb25zb2xlLmxvZygnb3BlbicsIHNlZ21lbnQudHlwZSwgc2VnbWVudC5vZmZzZXQsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW3NlZ21lbnQub2Zmc2V0LCBzZWdtZW50Lm9mZnNldCArIDEwXSkpXG4gICAgICAgIG9wZW4gPSB0cnVlO1xuICAgICAgICBzdGF0ZSA9IHNlZ21lbnQ7XG4gICAgICAgIHN0YXRlLnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICB9XG4gIGlmIChzdGF0ZSAmJiBzdGF0ZS5wb2ludC55IDwgeSkgcmV0dXJuICh0aGlzLmNhY2hlLnN0YXRlW3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnN0YXRlW3ldID0gbnVsbCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0UG9pbnRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCBpbiB0aGlzLmNhY2hlLm9mZnNldCkgcmV0dXJuIHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF1cbiAgcmV0dXJuICh0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdID0gdGhpcy5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KG9mZnNldCkpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlLCBzZWdtZW50LCBjbG9zZSkge1xuICB2YXIga2V5ID0gcmFuZ2Uuam9pbigpO1xuICBpZiAoa2V5IGluIHRoaXMuY2FjaGUucmFuZ2UpIHJldHVybiB0aGlzLmNhY2hlLnJhbmdlW2tleV07XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIudGV4dC5nZXRSYW5nZShyYW5nZSk7XG4gIHZhciB2YWxpZCA9IHRoaXMuaXNWYWxpZCh0ZXh0LCBzZWdtZW50Lm9mZnNldCAtIHJhbmdlWzBdLCBjbG9zZSk7XG4gIHJldHVybiAodGhpcy5jYWNoZS5yYW5nZVtrZXldID0gdmFsaWQpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWQgPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQsIGxhc3RJbmRleCkge1xuICBCZWdpbi5sYXN0SW5kZXggPSBsYXN0SW5kZXg7XG4gIHZhciBtYXRjaCA9IEJlZ2luLmV4ZWModGV4dCk7XG4gIGlmICghbWF0Y2gpIHJldHVybjtcblxuICBpID0gbWF0Y2guaW5kZXg7XG5cbiAgbGFzdCA9IGk7XG5cbiAgdmFyIHZhbGlkID0gdHJ1ZTtcblxuICBvdXRlcjpcbiAgZm9yICg7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIG9uZSA9IHRleHRbaV07XG4gICAgdmFyIG5leHQgPSB0ZXh0W2kgKyAxXTtcbiAgICB2YXIgdHdvID0gb25lICsgbmV4dDtcbiAgICBpZiAoaSA9PT0gb2Zmc2V0KSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciBvID0gVG9rZW5bdHdvXTtcbiAgICBpZiAoIW8pIG8gPSBUb2tlbltvbmVdO1xuICAgIGlmICghbykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgdmFyIHdhaXRGb3IgPSBNYXRjaFtvXVsxXTtcblxuICAgIC8vIGNvbnNvbGUubG9nKCdzdGFydCcsIGksIG8pXG4gICAgbGFzdCA9IGk7XG5cbiAgICBzd2l0Y2ggKHdhaXRGb3IubGVuZ3RoKSB7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gb25lKSB7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMTtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuXG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcbiAgICAgICAgICB0d28gPSB0ZXh0W2ldICsgdGV4dFtpICsgMV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gdHdvKSB7XG4gICAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMjtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWxpZDtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmdldFNlZ21lbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHRoaXMuc2VnbWVudHMubGVuZ3RoO1xuICBpZiAoIWVuZCkgcmV0dXJuO1xuXG4gIHZhciBwID0gLTE7XG4gIHZhciBpID0gLTE7XG4gIHZhciBiO1xuXG4gIGRvIHtcbiAgICBwID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgYiA9IHRoaXMuc2VnbWVudHNbaV07XG4gICAgaWYgKGIub2Zmc2V0IDwgb2Zmc2V0KSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwICE9PSBpKTtcblxuICByZXR1cm4ge1xuICAgIHNlZ21lbnQ6IGIsXG4gICAgaW5kZXg6IGlcbiAgfTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5zaGlmdCA9IGZ1bmN0aW9uKG9mZnNldCwgc2hpZnQpIHtcbiAgdmFyIHMgPSB0aGlzLmdldFNlZ21lbnQob2Zmc2V0KTtcbiAgaWYgKCFzKSByZXR1cm47XG5cbiAgZm9yICh2YXIgaSA9IHMuaW5kZXggKyAxOyBpIDwgdGhpcy5zZWdtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMuc2VnbWVudHNbaV0ub2Zmc2V0ICs9IHNoaWZ0O1xuICB9XG5cbiAgLy8gaWYgKHNoaWZ0IDwgMCkge1xuICAgIC8vIHRoaXMuY2xlYXJDYWNoZSgpO1xuICAvLyB9XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNhY2hlID0ge1xuICAgIG9mZnNldDoge30sXG4gICAgcmFuZ2U6IHt9LFxuICAgIHN0YXRlOiB7fVxuICB9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24odGV4dCkge1xuICB2YXIgbWF0Y2g7XG5cbiAgdmFyIHNlZ21lbnRzID0gdGhpcy5zZWdtZW50cyA9IFtdO1xuXG4gIHRoaXMuY2xlYXJDYWNoZSgpO1xuXG4gIHdoaWxlIChtYXRjaCA9IFRPS0VOLmV4ZWModGV4dCkpIHtcbiAgICBpZiAobWF0Y2hbJzMnXSkgc2VnbWVudHMucHVzaChuZXcgU2VnbWVudCgndGVtcGxhdGUgc3RyaW5nJywgbWF0Y2guaW5kZXgpKTtcbiAgICBlbHNlIGlmIChtYXRjaFsnMSddKSBzZWdtZW50cy5wdXNoKG5ldyBTZWdtZW50KCdvcGVuIGNvbW1lbnQnLCBtYXRjaC5pbmRleCkpO1xuICAgIGVsc2UgaWYgKG1hdGNoWycyJ10pIHNlZ21lbnRzLnB1c2gobmV3IFNlZ21lbnQoJ2Nsb3NlIGNvbW1lbnQnLCBtYXRjaC5pbmRleCkpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBTZWdtZW50KHR5cGUsIG9mZnNldCkge1xuICB0aGlzLnR5cGUgPSB0eXBlO1xuICB0aGlzLm9mZnNldCA9IG9mZnNldDtcbn1cbiIsIi8qXG5cbmV4YW1wbGUgc2VhcmNoIGZvciBvZmZzZXQgYDRgIDpcbmBvYCBhcmUgbm9kZSdzIGxldmVscywgYHhgIGFyZSB0cmF2ZXJzYWwgc3RlcHNcblxueFxueFxuby0tPnggICBvICAgb1xubyBvIHggICBvICAgbyBvIG9cbm8gbyBvLXggbyBvIG8gbyBvXG4xIDIgMyA0IDUgNiA3IDggOVxuXG4qL1xuXG5sb2cgPSBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNraXBTdHJpbmc7XG5cbmZ1bmN0aW9uIE5vZGUodmFsdWUsIGxldmVsKSB7XG4gIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgdGhpcy5sZXZlbCA9IGxldmVsO1xuICB0aGlzLndpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwodmFsdWUgJiYgdmFsdWUubGVuZ3RoIHx8IDApO1xuICB0aGlzLm5leHQgPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbChudWxsKTtcbn1cblxuTm9kZS5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMud2lkdGhbMF07XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNraXBTdHJpbmcobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy5sZXZlbHMgPSBvLmxldmVscyB8fCAxMTtcbiAgdGhpcy5iaWFzID0gby5iaWFzIHx8IDEgLyBNYXRoLkU7XG4gIHRoaXMuaGVhZCA9IG5ldyBOb2RlKG51bGwsIHRoaXMubGV2ZWxzKTtcbiAgdGhpcy5jaHVua1NpemUgPSBvLmNodW5rU2l6ZTtcbn1cblxuU2tpcFN0cmluZy5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuaGVhZC53aWR0aFt0aGlzLmxldmVscyAtIDFdO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgLy8gZ3JlYXQgaGFjayB0byBkbyBvZmZzZXQgPj0gZm9yIC5zZWFyY2goKVxuICAvLyB3ZSBkb24ndCBoYXZlIGZyYWN0aW9ucyBhbnl3YXkgc28uLlxuICByZXR1cm4gdGhpcy5zZWFyY2gob2Zmc2V0LCB0cnVlKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5pbnNlcnRDaHVua2VkKDAsIHRleHQpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24ob2Zmc2V0LCBpbmNsKSB7XG4gIGluY2wgPSBpbmNsID8gLjEgOiAwO1xuXG4gIC8vIHByZXBhcmUgdG8gaG9sZCBzdGVwc1xuICB2YXIgc3RlcHMgPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuICB2YXIgd2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuXG4gIC8vIGl0ZXJhdGUgbGV2ZWxzIGRvd24sIHNraXBwaW5nIHRvcFxuICB2YXIgaSA9IHRoaXMubGV2ZWxzO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgd2hpbGUgKG9mZnNldCArIGluY2wgPiBub2RlLndpZHRoW2ldICYmIG51bGwgIT0gbm9kZS5uZXh0W2ldKSB7XG4gICAgICBvZmZzZXQgLT0gbm9kZS53aWR0aFtpXTtcbiAgICAgIG5vZGUgPSBub2RlLm5leHRbaV07XG4gICAgfVxuICAgIHN0ZXBzW2ldID0gbm9kZTtcbiAgICB3aWR0aFtpXSA9IG9mZnNldDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbm9kZTogbm9kZSxcbiAgICBzdGVwczogc3RlcHMsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIG9mZnNldDogb2Zmc2V0XG4gIH07XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zcGxpY2UgPSBmdW5jdGlvbihzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzOyAvLyBza2lwIHN0ZXBzIGxlZnQgb2YgdGhlIG9mZnNldFxuICB2YXIgd2lkdGggPSBzLndpZHRoO1xuXG4gIHZhciBwOyAvLyBsZWZ0IG5vZGUgb3IgYHBgXG4gIHZhciBxOyAvLyByaWdodCBub2RlIG9yIGBxYCAob3VyIG5ldyBub2RlKVxuICB2YXIgbGVuO1xuXG4gIC8vIGNyZWF0ZSBuZXcgbm9kZVxuICBsZXZlbCA9IGxldmVsIHx8IHRoaXMucmFuZG9tTGV2ZWwoKTtcbiAgcSA9IG5ldyBOb2RlKHZhbHVlLCBsZXZlbCk7XG4gIGxlbmd0aCA9IHEud2lkdGhbMF07XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBsZXZlbHMgYmVsb3cgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IGxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWwgc3RlcFxuICAgIHEubmV4dFtpXSA9IHAubmV4dFtpXTsgLy8gaW5zZXJ0IHNvIGluaGVyaXQgbGVmdCdzIG5leHRcbiAgICBwLm5leHRbaV0gPSBxOyAvLyBsZWZ0J3MgbmV4dCBpcyBub3cgb3VyIG5ldyBub2RlXG4gICAgcS53aWR0aFtpXSA9IHAud2lkdGhbaV0gLSB3aWR0aFtpXSArIGxlbmd0aDtcbiAgICBwLndpZHRoW2ldID0gd2lkdGhbaV07XG4gIH1cblxuICAvLyBpdGVyYXRlIHN0ZXBzIGFsbCBsZXZlbHMgZG93biB1bnRpbCBleGNlcHQgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbGV2ZWwpIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbFxuICAgIHAud2lkdGhbaV0gKz0gbGVuZ3RoOyAvLyBhZGQgbmV3IG5vZGUgd2lkdGhcbiAgfVxuXG4gIC8vIHJldHVybiBuZXcgbm9kZVxuICByZXR1cm4gcTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzID0gdGhpcy5zZWFyY2gob2Zmc2V0KTtcblxuICAvLyBpZiBzZWFyY2ggZmFsbHMgaW4gdGhlIG1pZGRsZSBvZiBhIHN0cmluZ1xuICAvLyBpbnNlcnQgaXQgdGhlcmUgaW5zdGVhZCBvZiBjcmVhdGluZyBhIG5ldyBub2RlXG4gIGlmIChzLm9mZnNldCAmJiBzLm5vZGUudmFsdWUgJiYgcy5vZmZzZXQgPCBzLm5vZGUudmFsdWUubGVuZ3RoKSB7XG4gICAgdGhpcy51cGRhdGUocywgaW5zZXJ0KHMub2Zmc2V0LCBzLm5vZGUudmFsdWUsIHZhbHVlKSk7XG4gICAgcmV0dXJuIHMubm9kZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLnNwbGljZShzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICAvLyB2YWx1ZXMgbGVuZ3RoIGRpZmZlcmVuY2VcbiAgdmFyIGxlbmd0aCA9IHMubm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgLy8gdXBkYXRlIHZhbHVlXG4gIHMubm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGZpeCB3aWR0aHMgb24gYWxsIGxldmVsc1xuICBpID0gdGhpcy5sZXZlbHM7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHMuc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmIChyYW5nZVsxXSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ3JhbmdlIGVuZCBvdmVyIG1heGltdW0gbGVuZ3RoKCcgK1xuICAgICAgdGhpcy5sZW5ndGggKyAnKTogWycgKyByYW5nZS5qb2luKCkgKyAnXSdcbiAgICApO1xuICB9XG5cbiAgLy8gcmVtYWluIGRpc3RhbmNlIHRvIHJlbW92ZVxuICB2YXIgeCA9IHJhbmdlWzFdIC0gcmFuZ2VbMF07XG5cbiAgLy8gc2VhcmNoIGZvciBub2RlIG9uIGxlZnQgZWRnZVxuICB2YXIgcyA9IHRoaXMuc2VhcmNoKHJhbmdlWzBdKTtcbiAgdmFyIG9mZnNldCA9IHMub2Zmc2V0O1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzO1xuICB2YXIgbm9kZSA9IHMubm9kZTtcblxuICAvLyBza2lwIGhlYWRcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAvLyBzbGljZSBsZWZ0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmIChvZmZzZXQpIHtcbiAgICBpZiAob2Zmc2V0IDwgbm9kZS53aWR0aFswXSkge1xuICAgICAgeCAtPSB0aGlzLnVwZGF0ZShzLFxuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKDAsIG9mZnNldCkgK1xuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKFxuICAgICAgICAgIG9mZnNldCArXG4gICAgICAgICAgTWF0aC5taW4oeCwgbm9kZS5sZW5ndGggLSBvZmZzZXQpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAgIGlmICghbm9kZSkgcmV0dXJuO1xuICB9XG5cbiAgLy8gcmVtb3ZlIGFsbCBmdWxsIG5vZGVzIGluIHJhbmdlXG4gIHdoaWxlIChub2RlICYmIHggPj0gbm9kZS53aWR0aFswXSkge1xuICAgIHggLT0gdGhpcy5yZW1vdmVOb2RlKHN0ZXBzLCBub2RlKTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG5cbiAgLy8gc2xpY2UgcmlnaHQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKHgpIHtcbiAgICB0aGlzLnJlcGxhY2Uoc3RlcHMsIG5vZGUsIG5vZGUudmFsdWUuc2xpY2UoeCkpO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVOb2RlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUud2lkdGhbMF07XG5cbiAgdmFyIGk7XG5cbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGggLSBub2RlLndpZHRoW2ldO1xuICAgIHN0ZXBzW2ldLm5leHRbaV0gPSBub2RlLm5leHRbaV07XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihzdGVwcywgbm9kZSwgdmFsdWUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIG5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICB2YXIgaTtcbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBub2RlLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlQ2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnJlbW92ZShbb2Zmc2V0LCBvZmZzZXQrMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0Q2h1bmtlZCA9IGZ1bmN0aW9uKG9mZnNldCwgdGV4dCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRleHQubGVuZ3RoOyBpICs9IHRoaXMuY2h1bmtTaXplKSB7XG4gICAgdmFyIGNodW5rID0gdGV4dC5zdWJzdHIoaSwgdGhpcy5jaHVua1NpemUpO1xuICAgIHRoaXMuaW5zZXJ0KGkgKyBvZmZzZXQsIGNodW5rKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3Vic3RyaW5nID0gZnVuY3Rpb24oYSwgYikge1xuICBhID0gYSB8fCAwO1xuICBiID0gYiB8fCB0aGlzLmxlbmd0aDtcbiAgdmFyIGxlbmd0aCA9IGIgLSBhO1xuXG4gIHZhciBzZWFyY2ggPSB0aGlzLnNlYXJjaChhLCB0cnVlKTtcbiAgdmFyIG5vZGUgPSBzZWFyY2gubm9kZTtcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgdmFyIGQgPSBsZW5ndGggKyBzZWFyY2gub2Zmc2V0O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAobm9kZSAmJiBkID49IDApIHtcbiAgICBkIC09IG5vZGUud2lkdGhbMF07XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cbiAgaWYgKG5vZGUpIHtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gIH1cblxuICByZXR1cm4gcy5zdWJzdHIoc2VhcmNoLm9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJhbmRvbUxldmVsID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsZXZlbCA9IDE7XG4gIHdoaWxlIChsZXZlbCA8IHRoaXMubGV2ZWxzIC0gMSAmJiBNYXRoLnJhbmRvbSgpIDwgdGhpcy5iaWFzKSBsZXZlbCsrO1xuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJhbmdlID0gcmFuZ2UgfHwgW107XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZyhyYW5nZVswXSwgcmFuZ2VbMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29weSA9IG5ldyBTa2lwU3RyaW5nO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgdmFyIG9mZnNldCA9IDA7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgY29weS5pbnNlcnQob2Zmc2V0LCBub2RlLnZhbHVlKTtcbiAgICBvZmZzZXQgKz0gbm9kZS53aWR0aFswXTtcbiAgfVxuICByZXR1cm4gY29weTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmpvaW5TdHJpbmcgPSBmdW5jdGlvbihkZWxpbWl0ZXIpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIHBhcnRzLnB1c2gobm9kZS52YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzLmpvaW4oZGVsaW1pdGVyKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZygpO1xufTtcblxuZnVuY3Rpb24gdHJpbShzLCBsZWZ0LCByaWdodCkge1xuICByZXR1cm4gcy5zdWJzdHIoMCwgcy5sZW5ndGggLSByaWdodCkuc3Vic3RyKGxlZnQpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcbnZhciBSID0gUmVnZXhwLmNyZWF0ZTtcblxuLy9OT1RFOiBvcmRlciBtYXR0ZXJzXG52YXIgc3ludGF4ID0gbWFwKHtcbiAgJ29wZXJhdG9yJzogUihbJ29wZXJhdG9yJ10sICdnJywgZW50aXRpZXMpLFxuICAncGFyYW1zJzogICBSKFsncGFyYW1zJ10sICAgJ2cnKSxcbiAgJ2RlY2xhcmUnOiAgUihbJ2RlY2xhcmUnXSwgICdnJyksXG4gICdmdW5jdGlvbic6IFIoWydmdW5jdGlvbiddLCAnZycpLFxuICAna2V5d29yZCc6ICBSKFsna2V5d29yZCddLCAgJ2cnKSxcbiAgJ2J1aWx0aW4nOiAgUihbJ2J1aWx0aW4nXSwgICdnJyksXG4gICdpbmRlbnQnOiAgIFIoWydpbmRlbnQnXSwgICAnZ20nKSxcbiAgJ3N5bWJvbCc6ICAgUihbJ3N5bWJvbCddLCAgICdnJyksXG4gICdzdHJpbmcnOiAgIFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ251bWJlcic6ICAgUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0gY29tcGlsZShSKFsnaW5kZW50J10sICdnbScpLCAnaW5kZW50Jyk7XG5cbnZhciBCbG9ja3MgPSBSKFsnY29tbWVudCcsJ3N0cmluZycsJ3JlZ2V4cCddLCAnZ20nKTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2NvbW1lbnQnLFxuICAnLyonOiAnY29tbWVudCcsXG4gICdgJzogJ3N0cmluZycsXG4gICdcIic6ICdzdHJpbmcnLFxuICBcIidcIjogJ3N0cmluZycsXG4gICcvJzogJ3JlZ2V4cCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bnRheDtcblxuZnVuY3Rpb24gU3ludGF4KG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMubWF4TGluZSA9IG8ubWF4TGluZSB8fCAzMDA7XG4gIHRoaXMuYmxvY2tzID0gW107XG59XG5cblN5bnRheC5wcm90b3R5cGUuZW50aXRpZXMgPSBlbnRpdGllcztcblxuU3ludGF4LnByb3RvdHlwZS5oaWdobGlnaHQgPSBmdW5jdGlvbihjb2RlLCBvZmZzZXQpIHtcbiAgLy8gY29uc29sZS5sb2coMCwgJ2hpZ2hsaWdodCcsIGNvZGUpXG5cbiAgY29kZSA9IHRoaXMuY3JlYXRlSW5kZW50cyhjb2RlKTtcbiAgY29kZSA9IHRoaXMuY3JlYXRlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gZW50aXRpZXMoY29kZSk7XG5cbiAgZm9yICh2YXIga2V5IGluIHN5bnRheCkge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2Uoc3ludGF4W2tleV0ucmVnZXhwLCBzeW50YXhba2V5XS5yZXBsYWNlcik7XG4gIH1cblxuICBjb2RlID0gdGhpcy5yZXN0b3JlQmxvY2tzKGNvZGUpO1xuXG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoSW5kZW50LnJlZ2V4cCwgSW5kZW50LnJlcGxhY2VyKTtcblxuICAvLyBjb2RlID0gY29kZS5yZXBsYWNlKC9cXHVlZWVlL2csIGZ1bmN0aW9uKCkge1xuICAvLyAgIHJldHVybiBsb25nLnNoaWZ0KCkuc2xpY2UoMCwgdGhpcy5tYXhMaW5lKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknO1xuICAvLyB9KTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlSW5kZW50cyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGxpbmVzID0gY29kZS5zcGxpdCgvXFxuL2cpO1xuICBpZiAobGluZXMubGVuZ3RoIDw9IDIpIHJldHVybiBjb2RlO1xuXG4gIHZhciBsaW5lO1xuICB2YXIgbG9uZyA9IFtdO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBmaXJzdEluZGVudCA9IDA7XG4gIHZhciBpID0gMDtcblxuICAvLyBmb3IgKDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gIC8vICAgbGluZSA9IGxpbmVzW2ldO1xuICAvLyAgIGlmIChsaW5lLmxlbmd0aCA+IHRoaXMubWF4TGluZSkge1xuICAvLyAgICAgbG9uZy5wdXNoKGxpbmVzLnNwbGljZShpLS0sIDEsICdcXHVlZWVlJykpO1xuICAvLyAgIH1cbiAgLy8gfVxuXG4gIGkgPSAwO1xuICBsaW5lID0gbGluZXNbaV07XG4gIC8vIGNvbnNvbGUubG9nKGxpbmUpXG4gIHdoaWxlICghKG1hdGNoID0gL1xcUy9nLmV4ZWMobGluZSkpKSB7XG4gICAgbGluZSA9IGxpbmVzWysraV07XG4gICAgLy8gY29uc29sZS5sb2cobGluZSlcbiAgfVxuICBmb3IgKHZhciBqID0gMDsgaiA8IGk7IGorKykge1xuICAgIGxpbmVzW2pdID0gbmV3IEFycmF5KG1hdGNoLmluZGV4ICsgMSkuam9pbignICcpO1xuICB9XG4gIHZhciBwcmV2O1xuICBmb3IgKDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgbGluZSA9IGxpbmVzW2ldO1xuICAgIHByZXYgPSBsaW5lc1tpLTFdO1xuICAgIGlmICghbGluZS5sZW5ndGggJiYgcHJldi5sZW5ndGggJiYgcHJldlswXSA9PT0gJyAnICYmIHByZXZbcHJldi5sZW5ndGgtMV0gIT09ICcvJykgbGluZXNbaV0gPSAnICc7XG4gIH1cblxuICBjb2RlID0gbGluZXMuam9pbignXFxuJyk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLnJlc3RvcmVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBibG9jaztcbiAgdmFyIGJsb2NrcyA9IHRoaXMuYmxvY2tzO1xuICB2YXIgbiA9IDA7XG4gIHJldHVybiBjb2RlLnJlcGxhY2UoL1xcdWZmZWIvZywgZnVuY3Rpb24oKSB7XG4gICAgYmxvY2sgPSBibG9ja3NbbisrXVxuICAgIHZhciB0YWcgPSBpZGVudGlmeShibG9jayk7XG4gICAgcmV0dXJuICc8Jyt0YWcrJz4nK2VudGl0aWVzKGJsb2NrKSsnPC8nK3RhZysnPic7XG4gIH0pO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHRoaXMuYmxvY2tzID0gW107XG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoQmxvY2tzLCAoYmxvY2spID0+IHtcbiAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICByZXR1cm4gJ1xcdWZmZWInO1xuICB9KTtcbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVJZCgpIHtcbiAgdmFyIGFscGhhYmV0ID0gJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6JztcbiAgdmFyIGxlbmd0aCA9IGFscGhhYmV0Lmxlbmd0aCAtIDE7XG4gIHZhciBpID0gNjtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKGktLSkge1xuICAgIHMgKz0gYWxwaGFiZXRbTWF0aC5yYW5kb20oKSAqIGxlbmd0aCB8IDBdO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBlbnRpdGllcyh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIDtcbn1cblxuZnVuY3Rpb24gY29tcGlsZShyZWdleHAsIHRhZykge1xuICB2YXIgb3BlblRhZyA9ICc8JyArIHRhZyArICc+JztcbiAgdmFyIGNsb3NlVGFnID0gJzwvJyArIHRhZyArICc+JztcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiB0YWcsXG4gICAgcmVnZXhwOiByZWdleHAsXG4gICAgcmVwbGFjZXI6IG9wZW5UYWcgKyAnJCYnICsgY2xvc2VUYWdcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFwKG9iaiwgZm4pIHtcbiAgdmFyIHJlc3VsdCA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgcmVzdWx0W2tleV0gPSBmbihvYmpba2V5XSwga2V5KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiByZXBsYWNlKHBhc3MsIGNvZGUpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXNzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShwYXNzW2ldWzBdLCBwYXNzW2ldWzFdKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cblxuZnVuY3Rpb24gaWRlbnRpZnkoYmxvY2spIHtcbiAgdmFyIG9uZSA9IGJsb2NrWzBdO1xuICB2YXIgdHdvID0gb25lICsgYmxvY2tbMV07XG4gIHJldHVybiBUYWdbdHdvXSB8fCBUYWdbb25lXTtcbn1cbiIsInZhciBvcGVuID0gcmVxdWlyZSgnLi4vbGliL29wZW4nKTtcbnZhciBzYXZlID0gcmVxdWlyZSgnLi4vbGliL3NhdmUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJy4vYnVmZmVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmlsZTtcblxuZnVuY3Rpb24gRmlsZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLnJvb3QgPSAnJztcbiAgdGhpcy5wYXRoID0gJ3VudGl0bGVkJztcbiAgdGhpcy5idWZmZXIgPSBuZXcgQnVmZmVyO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5GaWxlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkZpbGUucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJ1ZmZlci5vbigncmF3JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3JhdycpKTtcbiAgdGhpcy5idWZmZXIub24oJ3NldCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdzZXQnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCd1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY2hhbmdlJykpO1xuICB0aGlzLmJ1ZmZlci5vbignYmVmb3JlIHVwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdiZWZvcmUgY2hhbmdlJykpO1xufTtcblxuRmlsZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMucGF0aCA9IHBhdGg7XG4gIHRoaXMucm9vdCA9IHJvb3Q7XG4gIG9wZW4ocm9vdCArIHBhdGgsIChlcnIsIHRleHQpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIGZuICYmIGZuKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYnVmZmVyLnNldCh0ZXh0KTtcbiAgICB0aGlzLmVtaXQoJ29wZW4nKTtcbiAgICBmbiAmJiBmbihudWxsLCB0aGlzKTtcbiAgfSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgc2F2ZSh0aGlzLnJvb3QgKyB0aGlzLnBhdGgsIHRoaXMuYnVmZmVyLmdldCgpLCBmbiB8fCBub29wKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5idWZmZXIuc2V0KHRleHQpO1xuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi9saWIvZGVib3VuY2UnKTtcblxuLypcbiAgIC4gLlxuLTEgMCAxIDIgMyA0IDVcbiAgIG5cblxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSGlzdG9yeTtcblxuZnVuY3Rpb24gSGlzdG9yeShlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMubmVlZGxlID0gMDtcbiAgdGhpcy50aW1lb3V0ID0gdHJ1ZTtcbiAgdGhpcy50aW1lU3RhcnQgPSAwO1xufVxuXG5IaXN0b3J5LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDApIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xufSwgNzAwKTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdzYXZlJywgdGhpcy5uZWVkbGUpXG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aDtcbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuXG4gIHRoaXMubmVlZGxlLS07XG5cbiAgaWYgKHRoaXMubmVlZGxlIDwgMCkgdGhpcy5uZWVkbGUgPSAwO1xuICAvLyBjb25zb2xlLmxvZygndW5kbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIHRoaXMuY2hlY2tvdXQodGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICB0aGlzLm5lZWRsZSsrO1xuICAvLyBjb25zb2xlLmxvZygncmVkbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcblxuICB0aGlzLmNoZWNrb3V0KHRoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24obikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG4gIHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlID0gY29tbWl0Lm1hcmtBY3RpdmU7XG4gIHRoaXMuZWRpdG9yLm1hcmsuc2V0KGNvbW1pdC5tYXJrLmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLnNldENhcmV0KGNvbW1pdC5jYXJldC5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5idWZmZXIudGV4dCA9IGNvbW1pdC50ZXh0LmNvcHkoKTtcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLmxpbmVzID0gY29tbWl0LmxpbmVzLmNvcHkoKTtcbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNvbW1pdCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIHRleHQ6IHRoaXMuZWRpdG9yLmJ1ZmZlci50ZXh0LmNvcHkoKSxcbiAgICBsaW5lczogdGhpcy5lZGl0b3IuYnVmZmVyLmxpbmVzLmNvcHkoKSxcbiAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gIH07XG59O1xuIiwidmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG5cbnZhciBQQUdJTkdfVEhST1RUTEUgPSA3MDtcblxudmFyIGtleXMgPSBtb2R1bGUuZXhwb3J0cyA9IHtcbiAgJ2N0cmwreic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS51bmRvKCk7XG4gIH0sXG4gICdjdHJsK3knOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucmVkbygpO1xuICB9LFxuXG4gICdob21lJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKCk7XG4gIH0sXG4gICdlbmQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKCk7XG4gIH0sXG4gICdwYWdldXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdwYWdlZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93bigpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCt1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK2Rvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEpO1xuICB9LFxuICAndXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSk7XG4gIH0sXG4gICdyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxKTtcbiAgfSxcbiAgJ2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEpO1xuICB9LFxuICAnY3RybCtyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEpO1xuICB9LFxuXG4gICdjdHJsK2EnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9LFxuXG4gICdjdHJsK3NoaWZ0K3VwJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHsgYmVnaW46IHRoaXMuY2FyZXQucG9zLCBlbmQ6IHRoaXMuY2FyZXQucG9zIH0pO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHRoaXMubWFyay5nZXQoKSk7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG4gICdjdHJsK3NoaWZ0K2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnZW50ZXInOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmluc2VydCgnXFxuJyk7XG4gIH0sXG5cbiAgJ2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgbGluZXMgPSBhcmVhLmVuZC55IC0gYXJlYS5iZWdpbi55O1xuICAgIGlmIChsaW5lcyAmJiBhcmVhLmVuZC54ID4gMCkgYWRkICs9IDE7XG4gICAgaWYgKCFsaW5lcykgYWRkICs9IDE7XG4gICAgbGluZXMgKz0gYWRkO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhLnNldExlZnQoMCkuYWRkQm90dG9tKGFkZCkpO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh7IHg6IDAsIHk6IGFyZWEuZW5kLnkgfSwgdGV4dCk7XG4gICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcyhsaW5lcyk7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMobGluZXMsIHRydWUpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICd0YWInOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5zdWdnZXN0KCk7XG4gICAgaWYgKCFyZXMpIHtcbiAgICAgIHRoaXMuaW5zZXJ0KCcgICcpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKHJlcy5hcmVhKTtcbiAgICAgIHRoaXMuaW5zZXJ0KHJlcy5ub2RlLnZhbHVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ2N0cmwrZic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZC5vcGVuKCk7XG4gIH0sXG5cbiAgJ2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgrMSk7XG4gIH0sXG4gICdzaGlmdCtmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoLTEpO1xuICB9LFxuXG4gICdjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYWRkO1xuICAgIHZhciBhcmVhO1xuICAgIHZhciB0ZXh0O1xuXG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG5cbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIGNsZWFyID0gdHJ1ZTtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya1NldCgpO1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGhpcy5tYXJrLmFkZEJvdHRvbShhcmVhLmVuZC54ID4gMCkuc2V0TGVmdCgwKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKHRoaXMubWFyay5nZXQoKSk7XG4gICAgfVxuXG4gICAgLy9UT0RPOiBzaG91bGQgY2hlY2sgaWYgbGFzdCBsaW5lIGhhcyAvLyBhbHNvXG4gICAgaWYgKHRleHQudHJpbUxlZnQoKS5zdWJzdHIoMCwyKSA9PT0gJy8vJykge1xuICAgICAgYWRkID0gLTM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKC4qPylcXC9cXC8gKC4rKS9nbSwgJyQxJDInKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWRkID0gKzM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKFtcXHNdKikoLispL2dtLCAnJDEvLyAkMicpO1xuICAgIH1cblxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuXG4gICAgdGhpcy5tYXJrLnNldChhcmVhLmFkZFJpZ2h0KGFkZCkpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG5cbiAgICBpZiAoY2FyZXQueCkgY2FyZXQuYWRkUmlnaHQoYWRkKTtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0KTtcblxuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgY2xlYXIgPSB0cnVlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgaWYgKHRleHQuc2xpY2UoMCwyKSA9PT0gJy8qJyAmJiB0ZXh0LnNsaWNlKC0yKSA9PT0gJyovJykge1xuICAgICAgdGV4dCA9IHRleHQuc2xpY2UoMiwtMik7XG4gICAgICBhZGQgLT0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCAtPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB0ZXh0ID0gJy8qJyArIHRleHQgKyAnKi8nO1xuICAgICAgYWRkICs9IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgKz0gMjtcbiAgICB9XG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG4gICAgYXJlYS5lbmQueCArPSBhZGQ7XG4gICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQuYWRkUmlnaHQoYWRkKSk7XG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcbn07XG5cbmtleXMuc2luZ2xlID0ge1xuICAvL1xufTtcblxuLy8gc2VsZWN0aW9uIGtleXNcblsgJ2hvbWUnLCdlbmQnLFxuICAncGFnZXVwJywncGFnZWRvd24nLFxuICAnbGVmdCcsJ3VwJywncmlnaHQnLCdkb3duJyxcbiAgJ2N0cmwrbGVmdCcsJ2N0cmwrcmlnaHQnXG5dLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gIGtleXNbJ3NoaWZ0Kycra2V5XSA9IGZ1bmN0aW9uKGUpIHtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIGtleXNba2V5XS5jYWxsKHRoaXMsIGUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9O1xufSk7XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBNb3VzZSA9IHJlcXVpcmUoJy4vbW91c2UnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi90ZXh0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSW5wdXQ7XG5cbmZ1bmN0aW9uIElucHV0KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5tb3VzZSA9IG5ldyBNb3VzZSh0aGlzKTtcbiAgdGhpcy50ZXh0ID0gbmV3IFRleHQ7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbklucHV0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbklucHV0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ibHVyID0gdGhpcy5ibHVyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMudGV4dC5vbihbJ2tleScsICd0ZXh0J10sIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdpbnB1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdmb2N1cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdibHVyJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKSk7XG4gIHRoaXMudGV4dC5vbigndGV4dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICd0ZXh0JykpO1xuICB0aGlzLnRleHQub24oJ2tleXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5JykpO1xuICB0aGlzLnRleHQub24oJ2N1dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjdXQnKSk7XG4gIHRoaXMudGV4dC5vbignY29weScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjb3B5JykpO1xuICB0aGlzLnRleHQub24oJ3Bhc3RlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3Bhc3RlJykpO1xuICB0aGlzLm1vdXNlLm9uKCd1cCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZXVwJykpO1xuICB0aGlzLm1vdXNlLm9uKCdjbGljaycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWNsaWNrJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkb3duJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZG93bicpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWcnKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcgYmVnaW4nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnYmVnaW4nKSk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICB0aGlzLm1vdXNlLnVzZShub2RlKTtcbiAgdGhpcy50ZXh0LnJlc2V0KCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuYmx1cigpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5mb2N1cygpO1xufTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3VzZTtcblxuZnVuY3Rpb24gTW91c2UoKSB7XG4gIHRoaXMubm9kZSA9IG51bGw7XG4gIHRoaXMuY2xpY2tzID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuTW91c2UucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW91c2UucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9ubWF5YmVkcmFnID0gdGhpcy5vbm1heWJlZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZHJhZyA9IHRoaXMub25kcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kb3duID0gdGhpcy5vbmRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbnVwID0gdGhpcy5vbnVwLmJpbmQodGhpcyk7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICBpZiAodGhpcy5ub2RlKSB7XG4gICAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgICAvLyB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG4gIH1cbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgLy8gdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZG93biA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZG93bicsIGUpO1xuICB0aGlzLm9uY2xpY2soZSk7XG4gIHRoaXMubWF5YmVEcmFnKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub251cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd1cCcsIGUpO1xuICBpZiAoIXRoaXMuZG93bikgcmV0dXJuO1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmRyYWdFbmQoKTtcbiAgdGhpcy5tYXliZURyYWdFbmQoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmNsaWNrID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnJlc2V0Q2xpY2tzKCk7XG4gIHRoaXMuY2xpY2tzID0gKHRoaXMuY2xpY2tzICUgMykgKyAxO1xuICB0aGlzLmVtaXQoJ2NsaWNrJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25tYXliZWRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuXG4gIHZhciBkID1cbiAgICAgIE1hdGguYWJzKHRoaXMucG9pbnQueCAtIHRoaXMuZG93bi54KVxuICAgICsgTWF0aC5hYnModGhpcy5wb2ludC55IC0gdGhpcy5kb3duLnkpO1xuXG4gIGlmIChkID4gNSkge1xuICAgIHRoaXMubWF5YmVEcmFnRW5kKCk7XG4gICAgdGhpcy5kcmFnQmVnaW4oKTtcbiAgfVxufTtcblxuTW91c2UucHJvdG90eXBlLm9uZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZHJhZycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGJlZ2luJyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgZW5kJyk7XG59O1xuXG5cbk1vdXNlLnByb3RvdHlwZS5yZXNldENsaWNrcyA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsaWNrcyA9IDA7XG59LCAzNTApO1xuXG5Nb3VzZS5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcblxudmFyIFRIUk9UVExFID0gMTAwMC83NTtcblxudmFyIG1hcCA9IHtcbiAgODogJ2JhY2tzcGFjZScsXG4gIDk6ICd0YWInLFxuICAxMzogJ2VudGVyJyxcbiAgMzM6ICdwYWdldXAnLFxuICAzNDogJ3BhZ2Vkb3duJyxcbiAgMzU6ICdlbmQnLFxuICAzNjogJ2hvbWUnLFxuICAzNzogJ2xlZnQnLFxuICAzODogJ3VwJyxcbiAgMzk6ICdyaWdodCcsXG4gIDQwOiAnZG93bicsXG4gIDQ2OiAnZGVsZXRlJyxcbiAgNDg6ICcwJyxcbiAgNDk6ICcxJyxcbiAgNTA6ICcyJyxcbiAgNTE6ICczJyxcbiAgNTI6ICc0JyxcbiAgNTM6ICc1JyxcbiAgNTQ6ICc2JyxcbiAgNTU6ICc3JyxcbiAgNTY6ICc4JyxcbiAgNTc6ICc5JyxcbiAgNjU6ICdhJyxcbiAgNjg6ICdkJyxcbiAgNzA6ICdmJyxcbiAgNzc6ICdtJyxcbiAgNzg6ICduJyxcbiAgODM6ICdzJyxcbiAgODk6ICd5JyxcbiAgOTA6ICd6JyxcbiAgMTEyOiAnZjEnLFxuICAxMTQ6ICdmMycsXG4gIDEyMjogJ2YxMScsXG4gIDE4ODogJywnLFxuICAxOTA6ICcuJyxcbiAgMTkxOiAnLycsXG5cbiAgLy8gbnVtcGFkXG4gIDk3OiAnZW5kJyxcbiAgOTg6ICdkb3duJyxcbiAgOTk6ICdwYWdlZG93bicsXG4gIDEwMDogJ2xlZnQnLFxuICAxMDI6ICdyaWdodCcsXG4gIDEwMzogJ2hvbWUnLFxuICAxMDQ6ICd1cCcsXG4gIDEwNTogJ3BhZ2V1cCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRleHQ7XG5cblRleHQubWFwID0gbWFwO1xuXG5mdW5jdGlvbiBUZXh0KCkge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpO1xuXG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgcG9zaXRpb246ICdhYnNvbHV0ZScsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgd2lkdGg6IDEsXG4gICAgaGVpZ2h0OiAxLFxuICAgIG9wYWNpdHk6IDBcbiAgfSk7XG5cbiAgZG9tLmF0dHJzKHRoaXMsIHtcbiAgICBhdXRvY2FwaXRhbGl6ZTogJ25vbmUnXG4gIH0pO1xuXG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuVGV4dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5UZXh0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5vbmN1dCA9IHRoaXMub25jdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmNvcHkgPSB0aGlzLm9uY29weS5iaW5kKHRoaXMpO1xuICB0aGlzLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGUuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleXVwID0gdGhpcy5vbmtleXVwLmJpbmQodGhpcyk7XG4gIHRoaXMuZWwub25ibHVyID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKTtcbiAgdGhpcy5lbC5vbmZvY3VzID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJyk7XG4gIHRoaXMuZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5lbC5vbmtleXVwID0gdGhpcy5vbmtleXVwO1xuICB0aGlzLmVsLm9uY3V0ID0gdGhpcy5vbmN1dDtcbiAgdGhpcy5lbC5vbmNvcHkgPSB0aGlzLm9uY29weTtcbiAgdGhpcy5lbC5vbnBhc3RlID0gdGhpcy5vbnBhc3RlO1xufTtcblxuVGV4dC5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xufVxuXG5UZXh0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWwudmFsdWUuc3Vic3RyKC0xKTtcbn07XG5cblRleHQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHRoaXMuZWwudmFsdWUgPSB2YWx1ZTtcbn07XG5cbi8vVE9ETzogb24gbW9iaWxlIHdlIG5lZWQgdG8gY2xlYXIgd2l0aG91dCBkZWJvdW5jZVxuLy8gb3IgdGhlIHRleHRhcmVhIGNvbnRlbnQgaXMgZGlzcGxheWVkIGluIGhhY2tlcidzIGtleWJvYXJkXG4vLyBvciB5b3UgbmVlZCB0byBkaXNhYmxlIHdvcmQgc3VnZ2VzdGlvbnMgaW4gaGFja2VyJ3Mga2V5Ym9hcmQgc2V0dGluZ3NcblRleHQucHJvdG90eXBlLmNsZWFyID0gdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbn0sIDIwMDApO1xuXG5UZXh0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuYmx1cigpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5mb2N1cygpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAvLyBmb3JjZXMgY2FyZXQgdG8gZW5kIG9mIHRleHRhcmVhIHNvIHdlIGNhbiBnZXQgLnNsaWNlKC0xKSBjaGFyXG4gIHNldEltbWVkaWF0ZSgoKSA9PiB0aGlzLmVsLnNlbGVjdGlvblN0YXJ0ID0gdGhpcy5lbC52YWx1ZS5sZW5ndGgpO1xuICB0aGlzLmVtaXQoJ3RleHQnLCB0aGlzLmdldCgpKTtcbiAgdGhpcy5jbGVhcigpO1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIC8vIGNvbnNvbGUubG9nKGUud2hpY2gpO1xuICB2YXIgbm93ID0gRGF0ZS5ub3coKTtcbiAgaWYgKG5vdyAtIHRoaXMudGhyb3R0bGVUaW1lIDwgVEhST1RUTEUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gbm93O1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5dXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0ICYmICFlLnNoaWZ0S2V5KSBrZXlzLnB1c2goJ3NoaWZ0OnVwJyk7XG4gIGlmIChtLmN0cmwgJiYgIWUuY3RybEtleSkga2V5cy5wdXNoKCdjdHJsOnVwJyk7XG4gIGlmIChtLmFsdCAmJiAhZS5hbHRLZXkpIGtleXMucHVzaCgnYWx0OnVwJyk7XG5cbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0gKyAnOnVwJyk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2N1dCcsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25jb3B5ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY29weScsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25wYXN0ZSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ3Bhc3RlJywgZSk7XG59O1xuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uL2xpYi9yZWdleHAnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vbGliL3BvaW50Jyk7XG5cbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd3b3JkcyddLCAnZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdmU7XG5cbmZ1bmN0aW9uIE1vdmUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG59XG5cbk1vdmUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW92ZS5wcm90b3R5cGUucGFnZURvd24gPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgc2l6ZSAtIHJlbWFpbmRlcik7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMocGFnZSk7XG59O1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlVXAgPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgLShzaXplIC0gcmVtYWluZGVyKSk7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMoLXBhZ2UpO1xufTtcblxudmFyIG1vdmUgPSB7fTtcblxubW92ZS5ieVdvcmQgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciBsaW5lID0gYnVmZmVyLmdldExpbmUocC55KTtcblxuICBpZiAoZHggPiAwICYmIHAueCA+PSBsaW5lLmxlbmd0aCAtIDEpIHsgLy8gYXQgZW5kIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgKzEpOyAvLyBtb3ZlIG9uZSBjaGFyIHJpZ2h0XG4gIH0gZWxzZSBpZiAoZHggPCAwICYmIHAueCA9PT0gMCkgeyAvLyBhdCBiZWdpbiBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsIC0xKTsgLy8gbW92ZSBvbmUgY2hhciBsZWZ0XG4gIH1cblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UobGluZSwgV09SRFMpO1xuICB2YXIgd29yZDtcblxuICBpZiAoZHggPCAwKSB3b3Jkcy5yZXZlcnNlKCk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAoZHggPiAwXG4gICAgICA/IHdvcmQuaW5kZXggPiBwLnhcbiAgICAgIDogd29yZC5pbmRleCA8IHAueCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgeDogd29yZC5pbmRleCxcbiAgICAgICAgeTogcC55XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIHJlYWNoZWQgYmVnaW4vZW5kIG9mIGZpbGVcbiAgcmV0dXJuIGR4ID4gMFxuICAgID8gbW92ZS5lbmRPZkxpbmUoYnVmZmVyLCBwKVxuICAgIDogbW92ZS5iZWdpbk9mTGluZShidWZmZXIsIHApO1xufTtcblxubW92ZS5ieUNoYXJzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgbGluZXMgPSBidWZmZXIubGluZXM7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHggPCAwKSB7IC8vIGdvaW5nIGxlZnRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIGxlZnRcbiAgICBpZiAoeCA8IDApIHsgLy8gd2hlbiBwYXN0IGxlZnQgZWRnZVxuICAgICAgaWYgKHkgPiAwKSB7IC8vIGFuZCBsaW5lcyBhYm92ZVxuICAgICAgICB5IC09IDE7IC8vIG1vdmUgdXAgYSBsaW5lXG4gICAgICAgIHggPSBsaW5lcy5nZXRMaW5lTGVuZ3RoKHkpOyAvLyBhbmQgZ28gdG8gdGhlIGVuZCBvZiBsaW5lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB4ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAoZHggPiAwKSB7IC8vIGdvaW5nIHJpZ2h0XG4gICAgeCArPSBkeDsgLy8gbW92ZSByaWdodFxuICAgIHdoaWxlICh4IC0gbGluZXMuZ2V0TGluZUxlbmd0aCh5KSA+IDApIHsgLy8gd2hpbGUgcGFzdCBsaW5lIGxlbmd0aFxuICAgICAgaWYgKHkgPT09IGxpbmVzLmxlbmd0aCkgeyAvLyBvbiBlbmQgb2YgZmlsZVxuICAgICAgICB4ID0gbGluZXMuZ2V0TGluZUxlbmd0aCh5KTsgLy8gZ28gdG8gZW5kIG9mIGxpbmUgb24gbGFzdCBsaW5lXG4gICAgICAgIGJyZWFrOyAvLyBhbmQgZXhpdFxuICAgICAgfVxuICAgICAgeCAtPSBsaW5lcy5nZXRMaW5lTGVuZ3RoKHkpICsgMTsgLy8gd3JhcCB0aGlzIGxpbmUgbGVuZ3RoXG4gICAgICB5ICs9IDE7IC8vIGFuZCBtb3ZlIGRvd24gYSBsaW5lXG4gICAgfVxuICB9XG5cbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJ5TGluZXMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR5KSB7XG4gIHZhciBsaW5lcyA9IGJ1ZmZlci5saW5lcztcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeSA8IDApIHsgLy8gZ29pbmcgdXBcbiAgICBpZiAoeSArIGR5ID4gMCkgeyAvLyB3aGVuIGxpbmVzIGFib3ZlXG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIHVwXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSAwO1xuICAgIH1cbiAgfSBlbHNlIGlmIChkeSA+IDApIHsgLy8gZ29pbmcgZG93blxuICAgIGlmICh5IDwgbGluZXMubGVuZ3RoIC0gZHkpIHsgLy8gd2hlbiBsaW5lcyBiZWxvd1xuICAgICAgeSArPSBkeTsgLy8gbW92ZSBkb3duXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSBsaW5lcy5sZW5ndGg7XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgKHggPiBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aCkge1xuICAvLyAgIHggPSBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gfVxuICB4ID0gTWF0aC5taW4odGhpcy5sYXN0RGVsaWJlcmF0ZVgsIGxpbmVzLmdldExpbmUoeSkubGVuZ3RoKTtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mTGluZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mTGluZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgeCA9IGJ1ZmZlci5saW5lcy5nZXRMaW5lKHAueSkubGVuZ3RoO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IEluZmluaXR5O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZGaWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxpbmVzLmxlbmd0aDtcbiAgdmFyIHggPSBidWZmZXIubGluZXMuZ2V0TGluZShsYXN0KS5sZW5ndGhcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogbGFzdFxuICB9O1xufTtcblxubW92ZS5pc0JlZ2luT2ZGaWxlID0gZnVuY3Rpb24oXywgcCkge1xuICByZXR1cm4gcC54ID09PSAwICYmIHAueSA9PT0gMDtcbn07XG5cbm1vdmUuaXNFbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jO1xuICByZXR1cm4gcC55ID09PSBsYXN0ICYmIHAueCA9PT0gYnVmZmVyLmxpbmVzLmdldExpbmVMZW5ndGgobGFzdCk7XG59O1xuXG5PYmplY3Qua2V5cyhtb3ZlKS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICBNb3ZlLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24ocGFyYW0sIGJ5RWRpdCkge1xuICAgIHZhciByZXN1bHQgPSBtb3ZlW21ldGhvZF0uY2FsbChcbiAgICAgIHRoaXMsXG4gICAgICB0aGlzLmVkaXRvci5idWZmZXIsXG4gICAgICB0aGlzLmVkaXRvci5jYXJldCxcbiAgICAgIHBhcmFtXG4gICAgKTtcblxuICAgIGlmICgnaXMnID09PSBtZXRob2Quc2xpY2UoMCwyKSkgcmV0dXJuIHJlc3VsdDtcblxuICAgIHRoaXMuZW1pdCgnbW92ZScsIHJlc3VsdCwgYnlFZGl0KTtcbiAgfTtcbn0pO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJlZGl0b3JcIjpcIl9zcmNfc3R5bGVfX2VkaXRvclwiLFwibGF5ZXJcIjpcIl9zcmNfc3R5bGVfX2xheWVyXCIsXCJyb3dzXCI6XCJfc3JjX3N0eWxlX19yb3dzXCIsXCJtYXJrXCI6XCJfc3JjX3N0eWxlX19tYXJrXCIsXCJjb2RlXCI6XCJfc3JjX3N0eWxlX19jb2RlXCIsXCJjYXJldFwiOlwiX3NyY19zdHlsZV9fY2FyZXRcIixcImd1dHRlclwiOlwiX3NyY19zdHlsZV9fZ3V0dGVyXCIsXCJydWxlclwiOlwiX3NyY19zdHlsZV9fcnVsZXJcIixcImFib3ZlXCI6XCJfc3JjX3N0eWxlX19hYm92ZVwiLFwiZmluZFwiOlwiX3NyY19zdHlsZV9fZmluZFwiLFwiYmxvY2tcIjpcIl9zcmNfc3R5bGVfX2Jsb2NrXCJ9IiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG52YXIgdGhlbWVzID0ge1xuICBtb25va2FpOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzI4MjInLFxuICAgIGNvbG9yOiAnI0Y4RjhGMicsXG4gICAga2V5d29yZDogJyNERjIyNjYnLFxuICAgIGZ1bmN0aW9uOiAnI0EwRDkyRScsXG4gICAgZGVjbGFyZTogJyM2MUNDRTAnLFxuICAgIG51bWJlcjogJyNBQjdGRkInLFxuICAgIHBhcmFtczogJyNGRDk3MUYnLFxuICAgIGNvbW1lbnQ6ICcjNzU3MTVFJyxcbiAgICBzdHJpbmc6ICcjRTZEQjc0JyxcbiAgfSxcblxuICB3ZXN0ZXJuOiB7XG4gICAgYmFja2dyb3VuZDogJyNEOUQxQjEnLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyM3QTNCM0InLFxuICAgIGZ1bmN0aW9uOiAnIzI1NkY3NScsXG4gICAgZGVjbGFyZTogJyM2MzQyNTYnLFxuICAgIG51bWJlcjogJyMxMzREMjYnLFxuICAgIHBhcmFtczogJyMwODI2NjMnLFxuICAgIGNvbW1lbnQ6ICcjOTk4RTZFJyxcbiAgICBzdHJpbmc6ICcjQzQzQzNDJyxcbiAgfSxcblxuICBlcmdvbm9tOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzFFMTYnLFxuICAgIGNvbG9yOiAnI0U5RTNEMScsXG4gICAga2V5d29yZDogJyNBMTM2MzAnLFxuICAgIGZ1bmN0aW9uOiAnI0IzREYwMicsXG4gICAgZGVjbGFyZTogJyNGNjM4MzMnLFxuICAgIG51bWJlcjogJyNGRjlGNEUnLFxuICAgIHBhcmFtczogJyNBMDkwQTAnLFxuICAgIHJlZ2V4cDogJyNCRDcwRjQnLFxuICAgIGNvbW1lbnQ6ICcjNjM1MDQ3JyxcbiAgICBzdHJpbmc6ICcjM0VBMUZCJyxcbiAgfSxcblxuICBkYXlsaWdodDoge1xuICAgIGJhY2tncm91bmQ6ICcjRUJFQkVCJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjRkYxQjFCJyxcbiAgICBmdW5jdGlvbjogJyMwMDA1RkYnLFxuICAgIGRlY2xhcmU6ICcjMEM3QTAwJyxcbiAgICBudW1iZXI6ICcjODAyMUQ0JyxcbiAgICBwYXJhbXM6ICcjNEM2OTY5JyxcbiAgICBjb21tZW50OiAnI0FCQUJBQicsXG4gICAgc3RyaW5nOiAnI0U2NzAwMCcsXG4gIH0sXG59O1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzZXRUaGVtZTtcbmV4cG9ydHMudGhlbWVzID0gdGhlbWVzO1xuXG5mdW5jdGlvbiBzZXRUaGVtZShuYW1lKSB7XG4gIHZhciB0ID0gdGhlbWVzW25hbWVdO1xuICBkb20uY3NzKCd0aGVtZScsXG5gXG4uJHtuYW1lfSB7XG4gIGJhY2tncm91bmQ6ICR7dC5iYWNrZ3JvdW5kfTtcbn1cblxub3BlcmF0b3IsXG5rZXl3b3JkIHtcbiAgY29sb3I6ICR7dC5rZXl3b3JkfTtcbn1cblxuZGVjbGFyZSxcbmJ1aWx0aW4ge1xuICBjb2xvcjogJHt0LmRlY2xhcmV9O1xufVxuXG5ib29sZWFuLFxubnVtYmVyIHtcbiAgY29sb3I6ICR7dC5udW1iZXJ9O1xufVxuXG5wYXJhbXMge1xuICBjb2xvcjogJHt0LnBhcmFtc307XG59XG5cbmZ1bmN0aW9uIHtcbiAgY29sb3I6ICR7dC5mdW5jdGlvbn07XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxucmVnZXhwIHtcbiAgY29sb3I6ICR7dC5yZWdleHAgfHwgdC5wYXJhbXN9O1xufVxuXG5jb21tZW50IHtcbiAgY29sb3I6ICR7dC5jb21tZW50fTtcbn1cblxuc3RyaW5nIHtcbiAgY29sb3I6ICR7dC5zdHJpbmd9O1xufVxuXG5zeW1ib2wsXG4uJHtjc3MuY29kZX0ge1xuICBjb2xvcjogJHt0LmNvbG9yfTtcbn1cblxuLiR7Y3NzLmNhcmV0fSB7XG4gIGJhY2tncm91bmQ6ICR7dC5jb2xvcn07XG59XG5cbnBhcmFtcyxcbmRlY2xhcmUge1xuICBmb250LXN0eWxlOiBpdGFsaWM7XG59XG5cbnN5bWJvbCB7XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxuaW5kZW50IHtcbiAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICBiYWNrZ3JvdW5kLXJlcGVhdDogcmVwZWF0O1xufVxuYFxuICApXG5cbn1cblxuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb2NrO1xuXG5mdW5jdGlvbiBCbG9jayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbkJsb2NrLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkJsb2NrLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXJQYWdlKDEsIHRydWUpO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBDb2RlO1xuXG5mdW5jdGlvbiBDb2RlKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCAxMCk7XG59XG5cbkNvZGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuQ29kZS5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsYXllciA9IHRoaXM7XG4gIHZhciB2aWV3cyA9IHRoaXMudmlld3M7XG4gIHZhciBlID0gdGhpcy5lZGl0b3I7XG5cbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuICBpZiAoIWUuZWRpdGluZykgcmV0dXJuIHRoaXMucmVuZGVyQWhlYWQoKTtcblxuICB2YXIgeSA9IGUuZWRpdExpbmU7XG4gIHZhciBnID0gZS5lZGl0UmFuZ2Uuc2xpY2UoKTtcbiAgdmFyIHNoaWZ0ID0gZS5lZGl0U2hpZnQ7XG4gIHZhciBpc0VudGVyID0gc2hpZnQgPiAwO1xuICB2YXIgaXNCYWNrc3BhY2UgPSBzaGlmdCA8IDA7XG4gIHZhciBpc0JlZ2luID0gZ1swXSArIGlzQmFja3NwYWNlID09PSAwO1xuICB2YXIgaXNFbmQgPSBnWzFdICsgaXNFbnRlciA9PT0gZS5yb3dzO1xuXG4gIGlmIChzaGlmdCkge1xuICAgIGlmIChpc0VudGVyICYmICFpc0VuZCkgdGhpcy5zaGlmdFZpZXdzQmVsb3coZ1swXSwgc2hpZnQpO1xuICAgIGVsc2UgaWYgKGlzQmFja3NwYWNlICYmICFpc0JlZ2luKSB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhnWzBdLCBzaGlmdCk7XG4gIH1cblxuICB0aGlzLnVwZGF0ZVJhbmdlKGcpO1xuICB0aGlzLnJlbmRlclBhZ2UoMCk7XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbmQ7XG5cbmZ1bmN0aW9uIEZpbmQobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDQpO1xufVxuXG5GaW5kLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkZpbmQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcbiAgdGhpcy5yZW5kZXJQYWdlKDApO1xufTtcbiIsInZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xudmFyIEZpbmRWaWV3ID0gcmVxdWlyZSgnLi9maW5kJyk7XG52YXIgQmxvY2tWaWV3ID0gcmVxdWlyZSgnLi9ibG9jaycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3cztcblxuZnVuY3Rpb24gVmlld3MoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuXG4gIHRoaXMudmlld3MgPSBbXG4gICAgbmV3IFZpZXcoJ3J1bGVyJywgZWRpdG9yLCB0ZW1wbGF0ZS5ydWxlciksXG4gICAgbmV3IFZpZXcoJ2NhcmV0JywgZWRpdG9yLCB0ZW1wbGF0ZS5jYXJldCksXG4gICAgbmV3IENvZGVWaWV3KCdjb2RlJywgZWRpdG9yLCB0ZW1wbGF0ZS5jb2RlKSxcbiAgICBuZXcgTWFya1ZpZXcoJ21hcmsnLCBlZGl0b3IsIHRlbXBsYXRlLm1hcmspLFxuICAgIG5ldyBSb3dzVmlldygncm93cycsIGVkaXRvciwgdGVtcGxhdGUucm93cyksXG4gICAgbmV3IEZpbmRWaWV3KCdmaW5kJywgZWRpdG9yLCB0ZW1wbGF0ZS5maW5kKSxcbiAgICBuZXcgQmxvY2tWaWV3KCdibG9jaycsIGVkaXRvciwgdGVtcGxhdGUuYmxvY2spLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcblxuICB0aGlzLmJsb2NrLnJlbmRlciA9IGRlYm91bmNlKHRoaXMuYmxvY2sucmVuZGVyLCA2MCk7XG5cbiAgLy9UT0RPOiBuZWVkcyB0byBiZSBzZXQgZHluYW1pY2FsbHlcbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuaGlkZV9yb3dzKSB0aGlzLnJvd3MucmVuZGVyID0gbm9vcDtcbn1cblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59LFxuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IExheWVyO1xuXG5mdW5jdGlvbiBMYXllcihuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCBsZW5ndGgpIHtcbiAgdGhpcy5kb20gPSBkb20oY3NzLmxheWVyKTtcbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy52aWV3cyA9IHRoaXMuY3JlYXRlKGxlbmd0aCk7XG59XG5cbkxheWVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkxheWVyLnByb3RvdHlwZS5jcmVhdGUgPSBmdW5jdGlvbihsZW5ndGgpIHtcbiAgdmFyIHZpZXdzID0gbmV3IEFycmF5KGxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXSA9IG5ldyBWaWV3KHRoaXMubmFtZSwgdGhpcy5lZGl0b3IsIHRoaXMudGVtcGxhdGUpO1xuICAgIGRvbS5hcHBlbmQodGhpcywgdmlld3NbaV0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZXF1ZXN0VmlldyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiB2aWV3O1xuICB9XG4gIHJldHVybiB0aGlzLmNsZWFyKClbMF07XG59O1xuXG5MYXllci5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuaW5SYW5nZVZpZXdzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHZpZXdzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAoIHZpZXcudmlzaWJsZSA9PT0gdHJ1ZVxuICAgICAgJiYgKCB2aWV3WzBdID49IHJhbmdlWzBdICYmIHZpZXdbMF0gPD0gcmFuZ2VbMV1cbiAgICAgICAgfHwgdmlld1sxXSA+PSByYW5nZVswXSAmJiB2aWV3WzFdIDw9IHJhbmdlWzFdICkgKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUub3V0UmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IGZhbHNlXG4gICAgICB8fCB2aWV3WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHZpZXdbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHZpZXdzLnB1c2godmlldyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB2aWV3cy5zb3J0KChhLGIpID0+IGEubGFzdFVzZWQgLSBiLmxhc3RVc2VkKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJSYW5nZXMgPSBmdW5jdGlvbihyYW5nZXMsIHZpZXdzKSB7XG4gIGZvciAodmFyIG4gPSAwLCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciByYW5nZSA9IHJhbmdlc1tpXTtcbiAgICB2YXIgdmlldyA9IHZpZXdzW24rK107XG4gICAgdmlldy5yZW5kZXIocmFuZ2UpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgaW5jbHVkZSkge1xuICB2YXIgdmlzaWJsZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5WaWV3cyA9IHRoaXMuaW5SYW5nZVZpZXdzKHJhbmdlKTtcbiAgdmFyIG91dFZpZXdzID0gdGhpcy5vdXRSYW5nZVZpZXdzKG1heChyYW5nZSwgdmlzaWJsZVJhbmdlKSk7XG5cbiAgdmFyIG5lZWRSYW5nZXMgPSBSYW5nZS5OT1QocmFuZ2UsIGluVmlld3MpO1xuICB2YXIgbmVlZFZpZXdzID0gbmVlZFJhbmdlcy5sZW5ndGggLSBvdXRWaWV3cy5sZW5ndGg7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ25lZWQ6JywgbmVlZFZpZXdzLCBuZWVkUmFuZ2VzLmpvaW4oJyAnKSk7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ2hhdmU6JywgdGhpcy52aWV3cy5qb2luKCcgJykpO1xuICAvLyBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUpIGNvbnNvbGUubG9nKCdvdXQ6Jywgb3V0Vmlld3Muam9pbignICcpKTtcbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSBjb25zb2xlLmxvZygncmFuZ2UnLCByYW5nZSwgaW5WaWV3cy5qb2luKCcgJykpO1xuICBpZiAobmVlZFZpZXdzID4gMCkge1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlclJhbmdlcyhbdmlzaWJsZVJhbmdlXSwgdGhpcy52aWV3cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGVsc2UgaWYgKGluY2x1ZGUpIHRoaXMucmVuZGVyVmlld3MoaW5WaWV3cyk7XG4gIHRoaXMucmVuZGVyUmFuZ2VzKG5lZWRSYW5nZXMsIG91dFZpZXdzKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJWaWV3cyA9IGZ1bmN0aW9uKHZpZXdzKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXS5yZW5kZXIoKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckxpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMucmVuZGVyUmFuZ2UoW3kseV0sIHRydWUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbihuLCBpbmNsdWRlKSB7XG4gIG4gPSBuIHx8IDA7XG4gIHRoaXMucmVuZGVyUmFuZ2UodGhpcy5nZXRQYWdlUmFuZ2UoWy1uLCtuXSksIGluY2x1ZGUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckFoZWFkID0gZnVuY3Rpb24oaW5jbHVkZSkge1xuICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICB2YXIgY3VycmVudFBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcblxuICAvLyBubyB2aWV3IGlzIHZpc2libGUsIHJlbmRlciBjdXJyZW50IHBhZ2Ugb25seVxuICBpZiAoUmFuZ2UuQU5EKGN1cnJlbnRQYWdlUmFuZ2UsIHZpZXdzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLnJlbmRlclBhZ2UoMCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbLTEsKzFdKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB2aWV3cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG4gICAgdGhpcy5yZW5kZXJQYWdlKDIsIGluY2x1ZGUpO1xuICB9XG59O1xuXG4vKlxuXG4xICB4XG4yIC14XG4zIC14XG40IC1cbjVcbjZcblxuICovXG5cbkxheWVyLnByb3RvdHlwZS5zcGxpY2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcblxuICAgIGlmICh2aWV3WzFdIDwgcmFuZ2VbMF0gfHwgdmlld1swXSA+IHJhbmdlWzFdKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAodmlld1swXSA8IHJhbmdlWzBdICYmIHZpZXdbMV0gPj0gcmFuZ2VbMF0pIHsgLy8gc2hvcnRlbiBhYm92ZVxuICAgICAgdmlld1sxXSA9IHJhbmdlWzBdIC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMV0gPiByYW5nZVsxXSkgeyAvLyBzaG9ydGVuIGJlbG93XG4gICAgICB2aWV3WzBdID0gcmFuZ2VbMV0gKyAxO1xuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMF0gPT09IHJhbmdlWzBdICYmIHZpZXdbMV0gPT09IHJhbmdlWzFdKSB7IC8vIGN1cnJlbnQgbGluZVxuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmlldy5jbGVhcigpO1xuICAgIH1cbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnNoaWZ0Vmlld3NCZWxvdyA9IGZ1bmN0aW9uKHksIGR5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5KSBjb250aW51ZTtcblxuICAgIHZpZXdbMF0gKz0gZHk7XG4gICAgdmlld1sxXSArPSBkeTtcbiAgICB2aWV3LnN0eWxlKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS51cGRhdGVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMuc3BsaWNlUmFuZ2UocmFuZ2UpO1xuICB0aGlzLnJlbmRlclJhbmdlKHJhbmdlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnZpZXdzW2ldLmNsZWFyKCk7XG4gIH1cbiAgcmV0dXJuIHRoaXMudmlld3M7XG59O1xuXG5mdW5jdGlvbiBtYXgoYSwgYikge1xuICByZXR1cm4gW01hdGgubWluKGFbMF0sIGJbMF0pLCBNYXRoLm1heChhWzFdLCBiWzFdKV07XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFyaztcblxuZnVuY3Rpb24gTWFyayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbk1hcmsucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuTWFyay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IubWFyay5hY3RpdmUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUm93cztcblxuZnVuY3Rpb24gUm93cyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNSk7XG59XG5cblJvd3MucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuUm93cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0U2hpZnQpIHtcbiAgICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICAgIHZhciByb3dzID0gdGhpcy5lZGl0b3Iucm93cztcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgdmlldyA9IHZpZXdzW2ldO1xuICAgICAgdmFyIHIgPSB2aWV3O1xuICAgICAgaWYgKCF2aWV3LnZpc2libGUpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAoclsxXSA+IHJvd3MpIHZpZXcuY2xlYXIoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJBaGVhZCgpO1xufTtcbiIsInZhciB0ZW1wbGF0ZSA9IGV4cG9ydHM7XG5cbnRlbXBsYXRlLmNvZGUgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICAvLyBpZiAodGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID09PSBjb2RlKSB7XG4gIC8vICAgcmV0dXJuIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5yZXN1bHQ7XG4gIC8vIH0gZWxzZSB7XG4gIC8vICAgdGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID0gY29kZTtcbiAgLy8gICB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucmVzdWx0ID0gZmFsc2U7XG4gIC8vIH1cblxuICB2YXIgaHRtbCA9IGUuYnVmZmVyLmdldEhpZ2hsaWdodGVkKHJhbmdlKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbi8vIHNpbmdsZXRvbiBtZW1vaXplIGZvciBmYXN0IGxhc3QgcmVwZWF0aW5nIHZhbHVlXG50ZW1wbGF0ZS5jb2RlLm1lbW9pemUgPSB7XG4gIHBhcmFtOiAnJyxcbiAgcmVzdWx0OiAnJ1xufTtcblxudGVtcGxhdGUucm93cyA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBzID0gJyc7XG4gIGZvciAodmFyIGkgPSByYW5nZVswXTsgaSA8PSByYW5nZVsxXTsgaSsrKSB7XG4gICAgcyArPSAoaSArIDEpICsgJ1xcbic7XG4gIH1cbiAgcmV0dXJuIHM7XG59O1xuXG50ZW1wbGF0ZS5tYXJrID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmxpbmVzLmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5saW5lcy5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXQpO1xuXG4gIGFyZWFbMF0gLT0gb2Zmc2V0WzBdO1xuICBhcmVhWzFdIC09IG9mZnNldFswXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKSArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICAgKyAnd2lkdGg6JyArIHdpZHRoICsgJzsnXG4gICAgICAgICAgKyAndG9wOicgKyAoci55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICAgICsgJ2xlZnQ6JyArIChyLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIC8vXG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBvZmZzZXQgPSBlLmJ1ZmZlci5saW5lcy5nZXQocmFuZ2VbMF0pO1xuICB2YXIgdGFyZ2V0ID0gZS5idWZmZXIubGluZXMuZ2V0UG9pbnQoZS5jYXJldCkub2Zmc2V0O1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLmdldChyYW5nZSk7XG4gIHZhciBpID0gdGFyZ2V0IC0gb2Zmc2V0O1xuICB2YXIgY2hhcjtcblxuICB2YXIgT3BlbiA9IHtcbiAgICAneyc6ICdjdXJseScsXG4gICAgJ1snOiAnc3F1YXJlJyxcbiAgICAnKCc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIENsb3NlID0ge1xuICAgICd9JzogJ2N1cmx5JyxcbiAgICAnXSc6ICdzcXVhcmUnLFxuICAgICcpJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgb3BlbjtcbiAgdmFyIGNsb3NlO1xuXG4gIHZhciBjb3VudCA9IDE7XG4gIGkgLT0gMTtcbiAgd2hpbGUgKGkgPiAwKSB7XG4gICAgY2hhciA9IGNvZGVbaV07XG4gICAgb3BlbiA9IE9wZW5bY2hhcl07XG4gICAgaWYgKENsb3NlW2NoYXJdKSBjb3VudCsrO1xuICAgIGlmIChvcGVuICYmICEtLWNvdW50KSBicmVhaztcbiAgICBpLS07XG4gIH1cblxuICBpZiAoIW9wZW4pIHJldHVybiAnICc7XG5cbiAgdmFyIGJlZ2luID0gZS5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KGkgKyBvZmZzZXQpO1xuXG4gIGNvdW50ID0gMTtcbiAgaSArPSAxO1xuXG4gIHdoaWxlIChpIDwgY29kZS5sZW5ndGgpIHtcbiAgICBjaGFyID0gY29kZVtpXTtcbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICAgIGkrKztcbiAgfVxuXG4gIGlmICghY2xvc2UpIHJldHVybiAnICc7XG5cbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmxpbmVzLmdldE9mZnNldChpICsgb2Zmc2V0KTtcblxuICB2YXIgaHRtbCA9ICcnO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKGJlZ2luLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGVuZC55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoZW5kLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIC8vXG59O1xuXG50ZW1wbGF0ZS5tYXJrLnN0eWxlID1cbnRlbXBsYXRlLnJvd3Muc3R5bGUgPVxudGVtcGxhdGUuY29kZS5zdHlsZSA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHJldHVybiB7XG4gICAgb3BhY2l0eTogMSxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogcmFuZ2VbMF0gKiBlLmNoYXIuaGVpZ2h0LFxuICAgIGhlaWdodDogKHJhbmdlWzFdIC0gcmFuZ2VbMF0gKyAxKSAqIGUuY2hhci5oZWlnaHRcbiAgfTtcbn07XG5cbnRlbXBsYXRlLmNhcmV0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbnRlbXBsYXRlLmNhcmV0LnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiArZS5oYXNGb2N1cyxcbiAgICBsZWZ0OiBlLmNoYXIud2lkdGggKiBlLmNhcmV0LnggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCxcbiAgICB0b3A6IGUuY2hhci5oZWlnaHQgKiBlLmNhcmV0LnksXG4gICAgaGVpZ2h0OiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUuZ3V0dGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBudWxsO1xufTtcblxudGVtcGxhdGUuZ3V0dGVyLnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogZS5yb3dzICogZS5jaGFyLmhlaWdodCxcbiAgfTtcbn07XG5cbnRlbXBsYXRlLnJ1bGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbnRlbXBsYXRlLnJ1bGVyLnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICAvLyB3aWR0aDogZS5sb25nZXN0TGluZSAqIGUuY2hhci53aWR0aCxcbiAgICBvcGFjaXR5OiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogKChlLnJvd3MgKyBlLnBhZ2UuaGVpZ2h0KSAqIGUuY2hhci5oZWlnaHQpICsgZS5wYWdlUmVtYWluZGVyLmhlaWdodCxcbiAgfTtcbn07XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuLi8uLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL21lcmdlJyk7XG52YXIgdHJpbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90cmltJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuZnVuY3Rpb24gVmlldyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBWaWV3KSkgcmV0dXJuIG5ldyBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpO1xuXG4gIHRoaXMubmFtZSA9IG5hbWU7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG5cbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIHRoaXMubGFzdFVzZWQgPSAwO1xuXG4gIHRoaXNbMF0gPSB0aGlzWzFdID0gLTE7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB0aGlzLmVsLmNsYXNzTmFtZSA9IGNzc1tuYW1lXTtcblxuICB2YXIgc3R5bGUgPSB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMCxcbiAgICBvcGFjaXR5OiAwXG4gIH07XG5cbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzXG4gICYmIH50aGlzLmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVycy5pbmRleE9mKG5hbWUpKSB7XG4gICAgc3R5bGUuYmFja2dyb3VuZCA9ICcjJ1xuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KTtcbiAgfVxuXG4gIGRvbS5zdHlsZSh0aGlzLCBzdHlsZSk7XG59XG5cblZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmICghcmFuZ2UpIHJhbmdlID0gdGhpcztcblxuICB0aGlzLmxhc3RVc2VkID0gRGF0ZS5ub3coKTtcblxuICAvLyBjb25zb2xlLmxvZyh0aGlzLm5hbWUsIHRoaXMudmFsdWUsIGUubGF5b3V0W3RoaXMubmFtZV0sIGRpZmYodGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSkpXG4gIC8vIGlmICghZGlmZih0aGlzLnZhbHVlLCB0aGlzLmVkaXRvci5sYXlvdXRbdGhpcy5uYW1lXSkpIHJldHVybjtcblxuICB2YXIgaHRtbCA9IHRoaXMudGVtcGxhdGUocmFuZ2UsIHRoaXMuZWRpdG9yKTtcbiAgaWYgKGh0bWwgPT09IGZhbHNlKSByZXR1cm4gdGhpcy5zdHlsZSgpO1xuXG4gIHRoaXNbMF0gPSByYW5nZVswXTtcbiAgdGhpc1sxXSA9IHJhbmdlWzFdO1xuICB0aGlzLnZpc2libGUgPSB0cnVlO1xuXG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkge1xuICAvLyAgIHZhciByZXMgPSB0cmltLmVtcHR5TGluZXMoaHRtbClcbiAgLy8gICByYW5nZVswXSArPSByZXMubGVhZGluZztcbiAgLy8gICBodG1sID0gcmVzLnN0cmluZztcbiAgLy8gfVxuXG4gIGlmIChodG1sKSBkb20uaHRtbCh0aGlzLCBodG1sKTtcbiAgZWxzZSBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUgfHwgJ2Jsb2NrJyA9PT0gdGhpcy5uYW1lKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdyZW5kZXInLCB0aGlzLm5hbWUpXG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblZpZXcucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdFVzZWQgPSBEYXRlLm5vdygpO1xuICBkb20uc3R5bGUodGhpcywgdGhpcy50ZW1wbGF0ZS5zdHlsZSh0aGlzLCB0aGlzLmVkaXRvcikpO1xufTtcblxuVmlldy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXNbMF0gKyAnLCcgKyB0aGlzWzFdO1xufTtcblxuVmlldy5wcm90b3R5cGUudmFsdWVPZiA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gW3RoaXNbMF0sIHRoaXNbMV1dO1xufTtcblxuVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnZpc2libGUpIHJldHVybjtcbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIC8vIGRvbS5odG1sKHRoaXMsICcnKTtcbiAgZG9tLnN0eWxlKHRoaXMsIHsgdG9wOiAwLCBoZWlnaHQ6IDAsIG9wYWNpdHk6IDAgfSk7XG59O1xuIl19
