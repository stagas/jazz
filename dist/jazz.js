(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

/**
 * Jazz
 */

var DefaultOptions = {
  theme: 'western',
  font_size: '9pt',
  line_height: '1.4em',
  debug_layers: false,
  scroll_speed: 95,
  hide_rows: false,
  center_horizontal: false,
  center_vertical: false,
  margin_left: 15,
  gutter_margin: 20
};

require('./lib/set-immediate');
var dom = require('./lib/dom');
var diff = require('./lib/diff');
var merge = require('./lib/merge');
var clone = require('./lib/clone');
var bindRaf = require('./lib/bind-raf');
var debounce = require('./lib/debounce');
var throttle = require('./lib/throttle');
var Event = require('./lib/event');
var Regexp = require('./lib/regexp');
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

var NEWLINE = Regexp.create(['newline']);

module.exports = Jazz;

function Jazz(options) {
  this.options = merge(clone(DefaultOptions), options || {});

  Object.assign(this, {
    el: document.createDocumentFragment(),

    id: 'jazz_' + (Math.random() * 10e6 | 0).toString(36),
    file: new File(),
    move: new Move(this),
    views: new Views(this),
    input: new Input(this),
    history: new History(this),

    bindings: Object.assign({}, DefaultBindings),

    find: new Dialog('Find', Text.map),
    findValue: '',
    findNeedle: 0,
    findResults: [],

    scroll: new Point(),
    offset: new Point(),
    size: new Box(),
    char: new Box(),

    page: new Box(),
    pagePoint: new Point(),
    pageRemainder: new Box(),
    pageBounds: new Range(),

    longestLine: 0,
    gutter: 0,
    code: 0,
    rows: 0,

    tabSize: 2,
    tab: '  ',

    caret: new Point({ x: 0, y: 0 }),
    caretPx: new Point({ x: 0, y: 0 }),

    hasFocus: false,

    mark: new Area({
      begin: new Point({ x: -1, y: -1 }),
      end: new Point({ x: -1, y: -1 })
    }),

    editing: false,
    editLine: -1,
    editRange: [-1, -1],
    editShift: 0,

    suggestIndex: 0,
    suggestRoot: '',
    suggestNodes: [],

    animationType: 'linear',
    animationFrame: -1,
    animationRunning: false,
    animationScrollTarget: null,

    renderQueue: [],
    renderRequest: null,
    renderRequestStartedAt: -1
  });

  // useful shortcuts
  this.buffer = this.file.buffer;
  this.buffer.mark = this.mark;
  this.syntax = this.buffer.syntax;

  theme(this.options.theme);

  this.bindMethods();
  this.bindEvents();
}

Jazz.prototype.__proto__ = Event.prototype;

Jazz.prototype.use = function (el, scrollEl) {
  if (this.ref) {
    this.el.removeAttribute('id');
    this.el.classList.remove(css.editor);
    this.el.classList.remove(this.options.theme);
    this.offScroll();
    this.offWheel();
    this.ref.forEach(function (ref) {
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
  this.offWheel = dom.onwheel(scrollEl || this.el, this.onWheel);
  this.input.use(this.el);
  dom.append(this.views.caret, this.input.text);
  this.views.use(this.el);

  this.repaint();

  return this;
};

Jazz.prototype.assign = function (bindings) {
  this.bindings = bindings;
  return this;
};

Jazz.prototype.open = function (path, root, fn) {
  this.file.open(path, root, fn);
  return this;
};

Jazz.prototype.save = function (fn) {
  this.file.save(fn);
  return this;
};

Jazz.prototype.set = function (text, path) {
  this.file.set(text);
  this.file.path = path || this.file.path;
  return this;
};

Jazz.prototype.focus = function () {
  setImmediate(this.input.focus);
  return this;
};

Jazz.prototype.blur = function () {
  setImmediate(this.input.blur);
  return this;
};

Jazz.prototype.bindMethods = function () {
  this.animationScrollFrame = this.animationScrollFrame.bind(this);
  this.animationScrollBegin = this.animationScrollBegin.bind(this);
  this.markSet = this.markSet.bind(this);
  this.markClear = this.markClear.bind(this);
  this.focus = this.focus.bind(this);
  this.repaint = this.repaint.bind(this); //bindRaf(this.repaint).bind(this);
  this._render = this._render.bind(this);
};

Jazz.prototype.bindHandlers = function () {
  for (var method in this) {
    if ('on' === method.slice(0, 2)) {
      this[method] = this[method].bind(this);
    }
  }
  this.onWheel = throttle(this.onWheel, 10);
};

Jazz.prototype.bindEvents = function () {
  this.bindHandlers();
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

Jazz.prototype.onScroll = function (scroll) {
  this.scroll.set(scroll);
  this.render('code');
  this.render('mark');
  this.render('find');
  this.render('rows');
  this.rest();
};

Jazz.prototype.onWheel = function (wheel) {
  this.animateScrollBy(wheel.deltaX, wheel.deltaY * 1.2, 'ease');
};

Jazz.prototype.rest = debounce(function () {
  this.editing = false;
}, 600);

Jazz.prototype.onMove = function (point, byEdit) {
  if (!byEdit) this.editing = false;
  if (point) this.setCaret(point);

  if (!byEdit) {
    if (this.input.text.modifiers.shift || this.input.mouse.down) {
      this.markSet();
    } else {
      this.markClear();
    }
  }

  this.emit('move');
  this.emit('input', '', this.caret.copy(), this.mark.copy(), this.mark.active);
  this.caretSolid();
  this.rest();

  this.render('caret');
  this.render('block');
};

Jazz.prototype.onResize = function () {
  this.repaint();
};

Jazz.prototype.onFocus = function (text) {
  this.hasFocus = true;
  this.emit('focus');
  this.views.caret.render();
  this.caretSolid();
};

Jazz.prototype.caretSolid = function () {
  dom.classes(this.views.caret, [css.caret]);
  this.caretBlink();
};

Jazz.prototype.caretBlink = debounce(function () {
  dom.classes(this.views.caret, [css.caret, css['blink-smooth']]);
}, 400);

Jazz.prototype.onBlur = function (text) {
  var _this = this;

  this.hasFocus = false;
  setTimeout(function () {
    if (!_this.hasFocus) {
      dom.classes(_this.views.caret, [css.caret]);
      _this.emit('blur');
      _this.views.caret.render();
    }
  }, 5);
};

Jazz.prototype.onInput = function (text) {};

Jazz.prototype.onText = function (text) {
  this.suggestRoot = '';
  this.insert(text);
};

Jazz.prototype.onKeys = function (keys, e) {
  if (keys in this.bindings) {
    e.preventDefault();
    this.bindings[keys].call(this, e);
  } else if (keys in DefaultBindings) {
    e.preventDefault();
    DefaultBindings[keys].call(this, e);
  }
};

Jazz.prototype.onKey = function (key, e) {
  if (key in this.bindings.single) {
    e.preventDefault();
    this.bindings.single[key].call(this, e);
  } else if (key in DefaultBindings.single) {
    e.preventDefault();
    DefaultBindings.single[key].call(this, e);
  }
};

Jazz.prototype.onCut = function (e) {
  if (!this.mark.active) return;
  this.onCopy(e);
  this.delete();
};

Jazz.prototype.onCopy = function (e) {
  if (!this.mark.active) return;
  var area = this.mark.get();
  var text = this.buffer.getAreaText(area);
  e.clipboardData.setData('text/plain', text);
};

Jazz.prototype.onPaste = function (e) {
  var text = e.clipboardData.getData('text/plain');
  this.insert(text);
};

Jazz.prototype.onFileOpen = function () {
  this.move.beginOfFile();
  this.repaint();
};

Jazz.prototype.onFileRaw = function (raw) {
  //
};

Jazz.prototype.setTabMode = function (char) {
  if ('\t' === char) {
    this.tab = char;
  } else {
    this.tab = new Array(this.tabSize + 1).join(char);
  }
};

Jazz.prototype.onFileSet = function () {
  this.setCaret({ x: 0, y: 0 });
  this.followCaret();
  this.repaint(true);
};

Jazz.prototype.onHistoryChange = function () {
  this.render('code');
  this.render('mark');
  this.render('block');
  this.followCaret();
  this.emit('history change');
};

Jazz.prototype.onBeforeFileChange = function () {
  this.history.save();
  this.editCaretBefore = this.caret.copy();
};

Jazz.prototype.onFileChange = function (editRange, editShift, textBefore, textAfter) {
  this.animationRunning = false;
  this.editing = true;
  this.rows = this.buffer.loc();
  this.pageBounds = [0, this.rows];

  if (this.find.isOpen) {
    this.onFindValue(this.findValue, true);
  }

  this.history.save();

  this.views.code.renderEdit({
    line: editRange[0],
    range: editRange,
    shift: editShift,
    caretNow: this.caret,
    caretBefore: this.editCaretBefore
  });

  this.render('caret');
  this.render('rows');
  this.render('mark');
  this.render('find');
  this.render('ruler');
  this.render('block');

  this.emit('change');
};

Jazz.prototype.setCaretFromPx = function (px) {
  var g = new Point({ x: this.marginLeft, y: this.char.height / 2 })['+'](this.offset);
  if (this.options.center_vertical) g.y += this.size.height / 3 | 0;
  var p = px['-'](g)['+'](this.scroll)['o/'](this.char);

  p.y = Math.max(0, Math.min(p.y, this.buffer.loc()));
  p.x = Math.max(0, p.x);

  var tabs = this.getCoordsTabs(p);

  p.x = Math.max(0, Math.min(p.x - tabs.tabs + tabs.remainder, this.getLineLength(p.y)));

  this.setCaret(p);
  this.move.lastDeliberateX = p.x;
  this.onMove();

  return p;
};

Jazz.prototype.onMouseUp = function () {
  var _this2 = this;

  setTimeout(function () {
    if (!_this2.hasFocus) _this2.blur();
  }, 5);
};

Jazz.prototype.onMouseDown = function () {
  setTimeout(this.focus.bind(this), 10);
  if (this.input.text.modifiers.shift) this.markBegin();else this.markClear();
  this.setCaretFromPx(this.input.mouse.point);
};

Jazz.prototype.setCaret = function (p, center, animate) {
  this.caret.set(p);

  var tabs = this.getPointTabs(this.caret);

  this.caretPx.set({
    x: this.char.width * (this.caret.x + tabs.tabs * this.tabSize - tabs.remainder),
    y: this.char.height * this.caret.y
  });

  this.followCaret(center, animate);
};

Jazz.prototype.onMouseClick = function () {
  var clicks = this.input.mouse.clicks;
  if (clicks > 1) {
    var area;

    if (clicks === 2) {
      area = this.buffer.wordAreaAtPoint(this.caret);
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
    }
  }
};

Jazz.prototype.onMouseDragBegin = function () {
  this.markBegin();
  this.setCaretFromPx(this.input.mouse.down);
};

Jazz.prototype.onMouseDrag = function () {
  this.setCaretFromPx(this.input.mouse.point);
};

Jazz.prototype.markBegin = function (area) {
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

Jazz.prototype.markSet = function () {
  if (this.mark.active) {
    this.mark.end.set(this.caret);
    this.render('mark');
  }
};

Jazz.prototype.markSetArea = function (area) {
  this.markBegin(area);
  this.render('mark');
};

Jazz.prototype.markClear = function (force) {
  if (this.input.text.modifiers.shift && !force) return;

  this.mark.active = false;
  this.mark.set({
    begin: new Point({ x: -1, y: -1 }),
    end: new Point({ x: -1, y: -1 })
  });
  this.clear('mark');
};

Jazz.prototype.getRange = function (range) {
  return Range.clamp(range, this.pageBounds);
};

Jazz.prototype.getPageRange = function (range) {
  var s = this.scroll.copy();
  if (this.options.center_vertical) {
    s.y -= this.size.height / 3 | 0;
  }
  var p = s['_/'](this.char);
  return this.getRange([Math.floor(p.y + this.page.height * range[0]), Math.ceil(p.y + this.page.height + this.page.height * range[1])]);
};

Jazz.prototype.getLineLength = function (y) {
  return this.buffer.getLine(y).length;
};

Jazz.prototype.followCaret = function (center, animate) {
  var p = this.caretPx;
  var s = this.animationScrollTarget || this.scroll;

  var top = s.y + (center && !this.options.center_vertical ? (this.size.height / 2 | 0) - 100 : 0) - p.y;

  var bottom = p.y - (s.y + this.size.height - (center && !this.options.center_vertical ? (this.size.height / 2 | 0) - 100 : 0) - (this.options.center_vertical ? this.size.height / 3 * 2 | 0 : 0)) + this.char.height;

  var left = s.x + this.char.width - p.x;
  var right = p.x - (s.x + this.size.width - this.marginLeft) + this.char.width * 2;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  if (left + top + right + bottom) {
    this[animate ? 'animateScrollBy' : 'scrollBy'](right - left, bottom - top, 'ease');
  }
};

Jazz.prototype.scrollTo = function (p) {
  dom.scrollTo(this.el, p.x, p.y);
};

Jazz.prototype.scrollBy = function (x, y) {
  var target = Point.low({
    x: 0,
    y: 0
  }, {
    x: this.scroll.x + x,
    y: this.scroll.y + y
  });

  if (Point.sort(target, this.scroll) !== 0) {
    this.scroll.set(target);
    this.scrollTo(this.scroll);
  }
};

Jazz.prototype.animateScrollBy = function (x, y, animationType) {
  this.animationType = animationType || 'linear';

  if (!this.animationRunning) {
    if ('linear' === this.animationType) {
      this.followCaret();
    }
    this.animationRunning = true;
    this.animationFrame = window.requestAnimationFrame(this.animationScrollBegin);
  }

  var s = this.animationScrollTarget || this.scroll;

  this.animationScrollTarget = new Point({
    x: Math.max(0, s.x + x),
    y: Math.min((this.rows + 1) * this.char.height - this.size.height + (this.options.center_vertical ? this.size.height / 3 * 2 | 0 : 0), Math.max(0, s.y + y))
  });
};

Jazz.prototype.animationScrollBegin = function () {
  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  var s = this.scroll;
  var t = this.animationScrollTarget;

  var dx = t.x - s.x;
  var dy = t.y - s.y;

  dx = Math.sign(dx) * 5;
  dy = Math.sign(dy) * 5;

  this.scrollBy(dx, dy);
};

Jazz.prototype.animationScrollFrame = function () {
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

  if (adx < 1 && ady < 1 || !this.animationRunning) {
    this.animationRunning = false;
    this.scrollTo(this.animationScrollTarget);
    this.animationScrollTarget = null;
    this.emit('animation end');
    return;
  }

  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  switch (this.animationType) {
    case 'linear':
      if (adx < speed) dx *= 0.9;else dx = Math.sign(dx) * speed;

      if (ady < speed) dy *= 0.9;else dy = Math.sign(dy) * speed;

      break;
    case 'ease':
      dx *= 0.5;
      dy *= 0.5;
      break;
  }

  this.scrollBy(dx, dy);
};

Jazz.prototype.insert = function (text) {
  if (this.mark.active) this.delete();

  this.emit('input', text, this.caret.copy(), this.mark.copy(), this.mark.active);

  var line = this.buffer.getLineText(this.caret.y);
  var right = line[this.caret.x];
  var hasRightSymbol = ~['}', ']', ')'].indexOf(right);

  // apply indent on enter
  if (NEWLINE.test(text)) {
    var isEndOfLine = this.caret.x === line.length - 1;
    var left = line[this.caret.x - 1];
    var indent = line.match(/\S/);
    indent = indent ? indent.index : line.length - 1;
    var hasLeftSymbol = ~['{', '[', '('].indexOf(left);

    if (hasLeftSymbol) indent += 2;

    if (isEndOfLine || hasLeftSymbol) {
      text += new Array(indent + 1).join(' ');
    }
  }

  var length;

  if (!hasRightSymbol || hasRightSymbol && !~['}', ']', ')'].indexOf(text)) {
    length = this.buffer.insert(this.caret, text, null, true);
  } else {
    length = 1;
  }

  this.move.byChars(length, true);

  if ('{' === text) this.buffer.insert(this.caret, '}');else if ('(' === text) this.buffer.insert(this.caret, ')');else if ('[' === text) this.buffer.insert(this.caret, ']');

  if (hasLeftSymbol && hasRightSymbol) {
    indent -= 2;
    this.buffer.insert(this.caret, '\n' + new Array(indent + 1).join(' '));
  }
};

Jazz.prototype.backspace = function () {
  if (this.move.isBeginOfFile()) {
    if (this.mark.active && !this.move.isEndOfFile()) return this.delete();
    return;
  }

  this.emit('input', '\uAAA0', this.caret.copy(), this.mark.copy(), this.mark.active);

  if (this.mark.active) {
    this.history.save(true);
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.removeArea(area);
    this.markClear(true);
  } else {
    this.history.save();
    this.move.byChars(-1, true);
    this.buffer.removeCharAtPoint(this.caret);
  }
};

Jazz.prototype.delete = function () {
  if (this.move.isEndOfFile()) {
    if (this.mark.active && !this.move.isBeginOfFile()) return this.backspace();
    return;
  }

  this.emit('input', '\uAAA1', this.caret.copy(), this.mark.copy(), this.mark.active);

  if (this.mark.active) {
    this.history.save(true);
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.removeArea(area);
    this.markClear(true);
  } else {
    this.history.save();
    this.buffer.removeCharAtPoint(this.caret);
  }
};

Jazz.prototype.findJump = function (jump) {
  if (!this.findResults.length || !this.find.isOpen) return;

  this.findNeedle = this.findNeedle + jump;
  if (this.findNeedle >= this.findResults.length) {
    this.findNeedle = 0;
  } else if (this.findNeedle < 0) {
    this.findNeedle = this.findResults.length - 1;
  }

  this.find.info(1 + this.findNeedle + '/' + this.findResults.length);

  var result = this.findResults[this.findNeedle];
  this.setCaret(result, true, true);
  this.markClear(true);
  this.markBegin();
  this.move.byChars(this.findValue.length, true);
  this.markSet();
  this.followCaret(true, true);
  this.render('find');
};

Jazz.prototype.onFindValue = function (value, noJump) {
  var _this3 = this;

  var g = new Point({ x: this.gutter, y: 0 });

  this.buffer.updateRaw();
  this.findValue = value;
  this.findResults = this.buffer.indexer.find(value).map(function (offset) {
    return _this3.buffer.getOffsetPoint(offset);
  });

  if (this.findResults.length) {
    this.find.info(1 + this.findNeedle + '/' + this.findResults.length);
  }

  if (!noJump) this.findJump(0);

  this.render('find');
};

Jazz.prototype.onFindKey = function (e) {
  if (~[33, 34, 114].indexOf(e.which)) {
    // pageup, pagedown, f3
    this.input.text.onkeydown(e);
  }

  if (70 === e.which && e.ctrlKey) {
    // ctrl+f
    e.preventDefault();
    return false;
  }
  if (9 === e.which) {
    // tab
    e.preventDefault();
    this.input.focus();
    return false;
  }
};

Jazz.prototype.onFindOpen = function () {
  this.find.info('');
  this.onFindValue(this.findValue);
};

Jazz.prototype.onFindClose = function () {
  this.clear('find');
  this.focus();
};

Jazz.prototype.suggest = function () {
  var area = this.buffer.wordAreaAtPoint(this.caret, true);
  if (!area) return;

  var key = this.buffer.getAreaText(area);
  if (!key) return;

  if (!this.suggestRoot || key.substr(0, this.suggestRoot.length) !== this.suggestRoot) {
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

Jazz.prototype.getPointTabs = function (point) {
  var line = this.buffer.getLineText(point.y);
  var remainder = 0;
  var tabs = 0;
  var tab;
  var prev = 0;
  while (~(tab = line.indexOf('\t', tab + 1))) {
    if (tab >= point.x) break;
    remainder += (tab - prev) % this.tabSize;
    tabs++;
    prev = tab + 1;
  }
  return {
    tabs: tabs,
    remainder: remainder + tabs
  };
};

Jazz.prototype.getCoordsTabs = function (point) {
  var line = this.buffer.getLineText(point.y);
  var remainder = 0;
  var tabs = 0;
  var tab;
  var prev = 0;
  while (~(tab = line.indexOf('\t', tab + 1))) {
    if (tabs * this.tabSize + remainder >= point.x) break;
    remainder += (tab - prev) % this.tabSize;
    tabs++;
    prev = tab + 1;
  }
  return {
    tabs: tabs,
    remainder: remainder
  };
};

Jazz.prototype.repaint = function (clear) {
  this.resize();
  if (clear) this.views.clear();
  this.views.render();
};

Jazz.prototype.resize = function () {
  var $ = this.el;

  dom.css(this.id, '\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: \'Meslo LG S\', \'Roboto Mono\', \'Consolas\', monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n    ');

  this.offset.set(dom.getOffset($));
  this.scroll.set(dom.getScroll($));
  this.size.set(dom.getSize($));

  // this is a weird fix when doing multiple .use()
  // if (this.char.width === 0)
  this.char.set(dom.getCharSize($, css.code));

  this.rows = this.buffer.loc();
  this.code = this.buffer.text.length;
  this.page.set(this.size['^/'](this.char));
  this.pageRemainder.set(this.size['-'](this.page['_*'](this.char)));
  this.pageBounds = [0, this.rows];
  // this.longestLine = Math.min(500, this.buffer.lines.getLongestLineLength());

  this.gutter = Math.max(this.options.hide_rows ? 0 : ('' + this.rows).length, (this.options.center_horizontal ? Math.max(('' + this.rows).length, (this.page.width - 81 - (this.options.hide_rows ? 0 : ('' + this.rows).length)) / 2 | 0) : 0) + (this.options.hide_rows ? 0 : Math.max(3, ('' + this.rows).length))) * this.char.width + (this.options.hide_rows ? 0 : this.options.gutter_margin * (this.options.center_horizontal ? -1 : 1));

  this.marginLeft = this.gutter + this.options.margin_left;
  this.codeLeft = this.marginLeft + this.char.width * 2;

  this.height = (this.rows + this.page.height) * this.char.height + this.pageRemainder.height;

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

  var comment = document.createElement('c');
  $.appendChild(comment);
  var color = window.getComputedStyle(comment).color;
  $.removeChild(comment);
  ctx.setLineDash([1, 1]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.lineTo(0, this.char.height);
  ctx.strokeStyle = color;
  ctx.stroke();

  var dataURL = canvas.toDataURL();

  dom.css(this.id, '\n    #' + this.id + ' {\n      top: ' + (this.options.center_vertical ? this.size.height / 3 : 0) + 'px;\n    }\n\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: \'Meslo LG S\', \'Roboto Mono\', \'Consolas\', monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n\n    #' + this.id + ' > .' + css.ruler + ',\n    #' + this.id + ' > .' + css.find + ',\n    #' + this.id + ' > .' + css.mark + ',\n    #' + this.id + ' > .' + css.code + ' {\n      margin-left: ' + this.codeLeft + 'px;\n      tab-size: ' + this.tabSize + ';\n    }\n    #' + this.id + ' > .' + css.rows + ' {\n      width: ' + this.marginLeft + 'px;\n    }\n    #' + this.id + ' > .' + css.find + ' > i,\n    #' + this.id + ' > .' + css.block + ' > i {\n      height: ' + (this.char.height + 1) + 'px;\n    }\n    x {\n      background-image: url(' + dataURL + ');\n    }');

  this.emit('resize');
};

Jazz.prototype.clear = function (name) {
  this.views[name].clear();
};

Jazz.prototype.render = function (name) {
  cancelAnimationFrame(this.renderRequest);
  if (this.renderRequestStartedAt === -1) {
    this.renderRequestStartedAt = Date.now();
  } else {
    if (Date.now() - this.renderRequestStartedAt > 100) {
      this._render();
    }
  }
  if (!~this.renderQueue.indexOf(name)) {
    if (name in this.views) {
      this.renderQueue.push(name);
    }
  }
  this.renderRequest = requestAnimationFrame(this._render);
};

Jazz.prototype._render = function () {
  var _this4 = this;

  // console.log('render')
  this.renderRequestStartedAt = -1;
  this.renderQueue.forEach(function (name) {
    return _this4.views[name].render({
      offset: {
        left: _this4.scroll.x,
        top: _this4.scroll.y - _this4.el.scrollTop
      }
    });
  });
  this.renderQueue = [];
};

// this is used for development debug purposes
function bindCallSite(fn) {
  return function (a, b, c, d) {
    var err = new Error();
    Error.captureStackTrace(err, arguments.callee);
    var stack = err.stack;
    console.log(stack);
    fn.call(this, a, b, c, d);
  };
}

},{"./lib/area":2,"./lib/bind-raf":4,"./lib/box":5,"./lib/clone":6,"./lib/debounce":7,"./lib/dialog":8,"./lib/diff":10,"./lib/dom":11,"./lib/event":12,"./lib/merge":14,"./lib/point":16,"./lib/range":19,"./lib/regexp":20,"./lib/set-immediate":22,"./lib/throttle":23,"./src/file":32,"./src/history":33,"./src/input":35,"./src/input/bindings":34,"./src/input/text":37,"./src/move":38,"./src/style.css":39,"./src/theme":40,"./src/views":45}],2:[function(require,module,exports){
'use strict';

var Point = require('./point');

module.exports = Area;

function Area(a) {
  if (a) {
    this.begin = new Point(a.begin);
    this.end = new Point(a.end);
  } else {
    this.begin = new Point();
    this.end = new Point();
  }
}

Area.prototype.copy = function () {
  return new Area(this);
};

Area.prototype.get = function () {
  var s = [this.begin, this.end].sort(Point.sort);
  return new Area({
    begin: new Point(s[0]),
    end: new Point(s[1])
  });
};

Area.prototype.set = function (area) {
  this.begin.set(area.begin);
  this.end.set(area.end);
};

Area.prototype.setLeft = function (x) {
  this.begin.x = x;
  this.end.x = x;
  return this;
};

Area.prototype.addRight = function (x) {
  if (this.begin.x) this.begin.x += x;
  if (this.end.x) this.end.x += x;
  return this;
};

Area.prototype.addBottom = function (y) {
  this.end.y += y;
  return this;
};

Area.prototype.shiftByLines = function (y) {
  this.begin.y += y;
  this.end.y += y;
};

Area.prototype['>'] = Area.prototype.greaterThan = function (a) {
  return this.begin.y === a.end.y ? this.begin.x > a.end.x : this.begin.y > a.end.y;
};

Area.prototype['>='] = Area.prototype.greaterThanOrEqual = function (a) {
  return this.begin.y === a.begin.y ? this.begin.x >= a.begin.x : this.begin.y > a.begin.y;
};

Area.prototype['<'] = Area.prototype.lessThan = function (a) {
  return this.end.y === a.begin.y ? this.end.x < a.begin.x : this.end.y < a.begin.y;
};

Area.prototype['<='] = Area.prototype.lessThanOrEqual = function (a) {
  return this.end.y === a.end.y ? this.end.x <= a.end.x : this.end.y < a.end.y;
};

Area.prototype['><'] = Area.prototype.inside = function (a) {
  return this['>'](a) && this['<'](a);
};

Area.prototype['<>'] = Area.prototype.outside = function (a) {
  return this['<'](a) || this['>'](a);
};

Area.prototype['>=<'] = Area.prototype.insideEqual = function (a) {
  return this['>='](a) && this['<='](a);
};

Area.prototype['<=>'] = Area.prototype.outsideEqual = function (a) {
  return this['<='](a) || this['>='](a);
};

Area.prototype['==='] = Area.prototype.equal = function (a) {
  return this.begin.x === a.begin.x && this.begin.y === a.begin.y && this.end.x === a.end.x && this.end.y === a.end.y;
};

Area.prototype['|='] = Area.prototype.beginLineEqual = function (a) {
  return this.begin.y === a.begin.y;
};

Area.prototype['=|'] = Area.prototype.endLineEqual = function (a) {
  return this.end.y === a.end.y;
};

Area.prototype['|=|'] = Area.prototype.linesEqual = function (a) {
  return this['|='](a) && this['=|'](a);
};

Area.prototype['=|='] = Area.prototype.sameLine = function (a) {
  return this.begin.y === this.end.y && this.begin.y === a.begin.y;
};

Area.prototype['-x-'] = Area.prototype.shortenByX = function (x) {
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

Area.prototype['+x+'] = Area.prototype.widenByX = function (x) {
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

Area.offset = function (b, a) {
  return {
    begin: point.offset(b.begin, a.begin),
    end: point.offset(b.end, a.end)
  };
};

Area.offsetX = function (x, a) {
  return {
    begin: point.offsetX(x, a.begin),
    end: point.offsetX(x, a.end)
  };
};

Area.offsetY = function (y, a) {
  return {
    begin: point.offsetY(y, a.begin),
    end: point.offsetY(y, a.end)
  };
};

Area.prototype.toString = function () {
  var area = this.get();
  return '' + area.begin + '|' + area.end;
};

Area.sort = function (a, b) {
  return a.begin.y === b.begin.y ? a.begin.x - b.begin.x : a.begin.y - b.begin.y;
};

Area.toPointSort = function (a, b) {
  return a.begin.y <= b.y && a.end.y >= b.y ? a.begin.y === b.y ? a.begin.x - b.x : a.end.y === b.y ? a.end.x - b.x : 0 : a.begin.y - b.y;
};

},{"./point":16}],3:[function(require,module,exports){
"use strict";

module.exports = binarySearch;

function binarySearch(array, compare) {
  var index = -1;
  var prev = -1;
  var low = 0;
  var high = array.length;
  if (!high) return {
    item: null,
    index: 0
  };

  do {
    prev = index;
    index = low + (high - low >> 1);
    var item = array[index];
    var result = compare(item);

    if (result) low = index;else high = index;
  } while (prev !== index);

  if (item != null) {
    return {
      item: item,
      index: index
    };
  }

  return {
    item: null,
    index: ~low * -1 - 1
  };
}

},{}],4:[function(require,module,exports){
"use strict";

module.exports = function (fn) {
  var request;
  return function rafWrap(a, b, c, d) {
    window.cancelAnimationFrame(request);
    request = window.requestAnimationFrame(fn.bind(this, a, b, c, d));
  };
};

},{}],5:[function(require,module,exports){
'use strict';

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

Box.prototype.set = function (b) {
  this.width = b.width;
  this.height = b.height;
};

Box.prototype['/'] = Box.prototype.div = function (p) {
  return new Box({
    width: this.width / (p.x || p.width || 0),
    height: this.height / (p.y || p.height || 0)
  });
};

Box.prototype['_/'] = Box.prototype.floorDiv = function (p) {
  return new Box({
    width: this.width / (p.x || p.width || 0) | 0,
    height: this.height / (p.y || p.height || 0) | 0
  });
};

Box.prototype['^/'] = Box.prototype.ceildiv = function (p) {
  return new Box({
    width: Math.ceil(this.width / (p.x || p.width || 0)),
    height: Math.ceil(this.height / (p.y || p.height || 0))
  });
};

Box.prototype['*'] = Box.prototype.mul = function (b) {
  return new Box({
    width: this.width * (b.width || b.x || 0),
    height: this.height * (b.height || b.y || 0)
  });
};

Box.prototype['^*'] = Box.prototype.mul = function (b) {
  return new Box({
    width: Math.ceil(this.width * (b.width || b.x || 0)),
    height: Math.ceil(this.height * (b.height || b.y || 0))
  });
};

Box.prototype['o*'] = Box.prototype.mul = function (b) {
  return new Box({
    width: Math.round(this.width * (b.width || b.x || 0)),
    height: Math.round(this.height * (b.height || b.y || 0))
  });
};

Box.prototype['_*'] = Box.prototype.mul = function (b) {
  return new Box({
    width: this.width * (b.width || b.x || 0) | 0,
    height: this.height * (b.height || b.y || 0) | 0
  });
};

Box.prototype['-'] = Box.prototype.sub = function (b) {
  return new Box({
    width: this.width - (b.width || b.x || 0),
    height: this.height - (b.height || b.y || 0)
  });
};

},{}],6:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

module.exports = function clone(obj) {
  var o = {};
  for (var key in obj) {
    var val = obj[key];
    if ('object' === (typeof val === 'undefined' ? 'undefined' : _typeof(val))) {
      o[key] = clone(val);
    } else {
      o[key] = val;
    }
  }
  return o;
};

},{}],7:[function(require,module,exports){
"use strict";

module.exports = function (fn, ms) {
  var timeout;

  return function debounceWrap(a, b, c, d) {
    clearTimeout(timeout);
    timeout = setTimeout(fn.bind(this, a, b, c, d), ms);
    return timeout;
  };
};

},{}],8:[function(require,module,exports){
'use strict';

var dom = require('../dom');
var Event = require('../event');
var css = require('./style.css');

module.exports = Dialog;

function Dialog(label, keymap) {
  this.node = dom(css.dialog, ['<label>' + css.label, [css.input, ['<input>' + css.text, css.info]]]);
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

Dialog.prototype.hasFocus = function () {
  return this.node[css.input].el.hasFocus();
};

Dialog.prototype.onbodykeydown = function (e) {
  if (27 === e.which) {
    e.preventDefault();
    this.close();
    return false;
  }
};

Dialog.prototype.onkeydown = function (e) {
  if (13 === e.which) {
    e.preventDefault();
    this.submit();
    return false;
  }
  if (e.which in this.keymap) {
    this.emit('key', e);
  }
};

Dialog.prototype.oninput = function (e) {
  this.emit('value', this.node[css.input][css.text].el.value);
};

Dialog.prototype.open = function () {
  document.body.addEventListener('keydown', this.onbodykeydown);
  dom.append(document.body, this.node);
  dom.focus(this.node[css.input][css.text]);
  this.node[css.input][css.text].el.select();
  this.isOpen = true;
  this.emit('open');
};

Dialog.prototype.close = function () {
  document.body.removeEventListener('keydown', this.onbodykeydown);
  this.node.el.parentNode.removeChild(this.node.el);
  this.isOpen = false;
  this.emit('close');
};

Dialog.prototype.submit = function () {
  this.emit('submit', this.node[css.input][css.text].el.value);
};

Dialog.prototype.info = function (info) {
  dom.text(this.node[css.input][css.info], info);
  dom.style(this.node[css.input][css.info], { display: info ? 'block' : 'none' });
};

},{"../dom":11,"../event":12,"./style.css":9}],9:[function(require,module,exports){
module.exports = {"dialog":"_lib_dialog_style__dialog","input":"_lib_dialog_style__input","text":"_lib_dialog_style__text","label":"_lib_dialog_style__label","info":"_lib_dialog_style__info"}
},{}],10:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

module.exports = diff;

function diff(a, b) {
  if ('object' === (typeof a === 'undefined' ? 'undefined' : _typeof(a))) {
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

},{}],11:[function(require,module,exports){
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var Point = require('./point');
var bindRaf = require('./bind-raf');
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
  lineHeight: 'px'
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
    children.map(dom).map(function (child, i) {
      node[child.name] = child;
      return child;
    }).map(function (child) {
      node.el.appendChild(child.el);
    });
  } else if ('object' === (typeof children === 'undefined' ? 'undefined' : _typeof(children))) {
    dom.style(node, children);
  }

  if (attrs) {
    dom.attrs(node, attrs);
  }

  return node;
}

dom.style = memoize(function (el, _, style) {
  for (var name in style) {
    if (name in units) if (style[name] !== 'auto') style[name] += units[name];
  }Object.assign(el.style, style);
}, diff, merge, function (node, style) {
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
dom.classes = memoize(function (el, className) {
  el.className = className;
}, null, null, function (node, classes) {
  var el = dom.getElement(node);
  return [el, classes.concat(node.name).filter(Boolean).join(' ')];
});

dom.attrs = function (el, attrs) {
  el = dom.getElement(el);
  Object.assign(el, attrs);
};

dom.html = function (el, html) {
  el = dom.getElement(el);
  el.innerHTML = html;
};

dom.text = function (el, text) {
  el = dom.getElement(el);
  el.textContent = text;
};

dom.focus = function (el) {
  el = dom.getElement(el);
  el.focus();
};

dom.getSize = function (el) {
  el = dom.getElement(el);
  return {
    width: el.clientWidth,
    height: el.clientHeight
  };
};

dom.getCharSize = function (el, className) {
  el = dom.getElement(el);
  var span = document.createElement('span');
  span.className = className;

  el.appendChild(span);

  span.innerHTML = '&nbsp;';
  var a = span.getBoundingClientRect();

  span.innerHTML = '&nbsp;&nbsp;\n&nbsp;';
  var b = span.getBoundingClientRect();

  el.removeChild(span);

  return {
    width: b.width - a.width,
    height: b.height - a.height
  };
};

dom.getOffset = function (el) {
  el = dom.getElement(el);
  var rect = el.getBoundingClientRect();
  var style = window.getComputedStyle(el);
  var borderLeft = parseInt(style.borderLeftWidth);
  var borderTop = parseInt(style.borderTopWidth);
  return Point.low({ x: 0, y: 0 }, {
    x: rect.left + borderLeft | 0,
    y: rect.top + borderTop | 0
  });
};

dom.getScroll = function (el) {
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
  };
};

dom.onwheel = function onwheel(el, fn) {
  el = dom.getElement(el);

  if (document.body === el) {
    document.addEventListener('wheel', handler);
  } else {
    el.addEventListener('wheel', handler);
  }

  function handler(ev) {
    fn(ev);
  }

  return function offwheel() {
    el.removeEventListener('wheel', handler);
  };
};

dom.onoffset = function (el, fn) {
  el = dom.getElement(el);
  while (el = el.offsetParent) {
    dom.onscroll(el, fn);
  }
};

dom.onclick = function (el, fn) {
  return el.addEventListener('click', fn);
};

dom.onresize = function (fn) {
  return window.addEventListener('resize', fn);
};

dom.append = function (target, src, dict) {
  target = dom.getElement(target);
  if ('forEach' in src) src.forEach(dom.append.bind(null, target));
  // else if ('views' in src) dom.append(target, src.views, true);
  else if (dict === true) for (var key in src) {
      dom.append(target, src[key]);
    } else if ('function' != typeof src) target.appendChild(dom.getElement(src));
};

dom.remove = function (el) {
  el = dom.getElement(el);
  if (el.parentNode) el.parentNode.removeChild(el);
};

dom.getElement = function (el) {
  return el.dom && el.dom.el || el.el || el.node || el;
};

dom.scrollBy = function (el, x, y, scroll) {
  scroll = scroll || dom.getScroll(el);
  dom.scrollTo(el, scroll.x + x, scroll.y + y);
};

dom.scrollTo = function (el, x, y) {
  if (document.body === el) {
    window.scrollTo(x, y);
  } else {
    el.scrollLeft = x || 0;
    el.scrollTop = y || 0;
  }
};

dom.css = function (id, cssText) {
  if (!(id in dom.css.styles)) {
    dom.css.styles[id] = document.createElement('style');
    document.body.appendChild(dom.css.styles[id]);
  }
  dom.css.styles[id].textContent = cssText;
};

dom.css.styles = {};

dom.getMousePoint = function (e) {
  return new Point({
    x: e.clientX,
    y: e.clientY
  });
};

function getScroll(el) {
  return document.body === el ? {
    x: window.scrollX || el.scrollLeft || document.documentElement.scrollLeft,
    y: window.scrollY || el.scrollTop || document.documentElement.scrollTop
  } : {
    x: el.scrollLeft,
    y: el.scrollTop
  };
}

},{"./bind-raf":4,"./diff":10,"./memoize":13,"./merge":14,"./point":16}],12:[function(require,module,exports){
"use strict";

var push = [].push;
var slice = [].slice;

module.exports = Event;

function Event() {
  if (!(this instanceof Event)) return new Event();

  this._handlers = {};
}

Event.prototype._getHandlers = function (name) {
  this._handlers = this._handlers || {};
  return this._handlers[name] = this._handlers[name] || [];
};

Event.prototype.emit = function (name, a, b, c, d) {
  if (this.silent) return;
  var handlers = this._getHandlers(name);
  for (var i = 0; i < handlers.length; i++) {
    handlers[i](a, b, c, d);
  };
};

Event.prototype.on = function (name) {
  var handlers;
  var newHandlers = slice.call(arguments, 1);
  if (Array.isArray(name)) {
    name.forEach(function (name) {
      handlers = this._getHandlers(name);
      push.apply(handlers, newHandlers[name]);
    }, this);
  } else {
    handlers = this._getHandlers(name);
    push.apply(handlers, newHandlers);
  }
};

Event.prototype.off = function (name, handler) {
  var handlers = this._getHandlers(name);
  var index = handlers.indexOf(handler);
  if (~index) handlers.splice(index, 1);
};

Event.prototype.once = function (name, fn) {
  var handlers = this._getHandlers(name);
  var handler = function handler(a, b, c, d) {
    fn(a, b, c, d);
    handlers.splice(handlers.indexOf(handler), 1);
  };
  handlers.push(handler);
};

},{}],13:[function(require,module,exports){
'use strict';

var clone = require('./clone');

module.exports = function memoize(fn, diff, merge, pre) {
  diff = diff || function (a, b) {
    return a !== b;
  };
  merge = merge || function (a, b) {
    return b;
  };
  pre = pre || function (node, param) {
    return param;
  };

  var nodes = [];
  var cache = [];
  var results = [];

  return function (node, param) {
    var args = pre(node, param);
    node = args[0];
    param = args[1];

    var index = nodes.indexOf(node);
    if (~index) {
      var d = diff(cache[index], param);
      if (!d) return results[index];else {
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

},{"./clone":6}],14:[function(require,module,exports){
"use strict";

module.exports = function merge(dest, src) {
  for (var key in src) {
    dest[key] = src[key];
  }
  return dest;
};

},{}],15:[function(require,module,exports){
"use strict";

module.exports = open;

function open(url, cb) {
  return fetch(url).then(getText).then(cb.bind(null, null)).catch(cb);
}

function getText(res) {
  return res.text();
}

},{}],16:[function(require,module,exports){
'use strict';

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

Point.prototype.set = function (p) {
  this.x = p.x;
  this.y = p.y;
};

Point.prototype.copy = function () {
  return new Point(this);
};

Point.prototype.addRight = function (x) {
  this.x += x;
  return this;
};

Point.prototype['/'] = Point.prototype.div = function (p) {
  return new Point({
    x: this.x / (p.x || p.width || 0),
    y: this.y / (p.y || p.height || 0)
  });
};

Point.prototype['_/'] = Point.prototype.floorDiv = function (p) {
  return new Point({
    x: this.x / (p.x || p.width || 0) | 0,
    y: this.y / (p.y || p.height || 0) | 0
  });
};

Point.prototype['o/'] = Point.prototype.roundDiv = function (p) {
  return new Point({
    x: Math.round(this.x / (p.x || p.width || 0)),
    y: Math.round(this.y / (p.y || p.height || 0))
  });
};

Point.prototype['^/'] = Point.prototype.ceilDiv = function (p) {
  return new Point({
    x: Math.ceil(this.x / (p.x || p.width || 0)),
    y: Math.ceil(this.y / (p.y || p.height || 0))
  });
};

Point.prototype['+'] = Point.prototype.add = function (p) {
  return new Point({
    x: this.x + (p.x || p.width || 0),
    y: this.y + (p.y || p.height || 0)
  });
};

Point.prototype['-'] = Point.prototype.sub = function (p) {
  return new Point({
    x: this.x - (p.x || p.width || 0),
    y: this.y - (p.y || p.height || 0)
  });
};

Point.prototype['*'] = Point.prototype.mul = function (p) {
  return new Point({
    x: this.x * (p.x || p.width || 0),
    y: this.y * (p.y || p.height || 0)
  });
};

Point.prototype['^*'] = Point.prototype.ceilMul = function (p) {
  return new Point({
    x: Math.ceil(this.x * (p.x || p.width || 0)),
    y: Math.ceil(this.y * (p.y || p.height || 0))
  });
};

Point.prototype['o*'] = Point.prototype.roundMul = function (p) {
  return new Point({
    x: Math.round(this.x * (p.x || p.width || 0)),
    y: Math.round(this.y * (p.y || p.height || 0))
  });
};

Point.prototype['_*'] = Point.prototype.floorMul = function (p) {
  return new Point({
    x: this.x * (p.x || p.width || 0) | 0,
    y: this.y * (p.y || p.height || 0) | 0
  });
};

Point.prototype.lerp = function (p, a) {
  return new Point({
    x: this.x + (p.x - this.x) * a,
    y: this.y + (p.y - this.y) * a
  });
};

Point.prototype.toString = function () {
  return this.x + ',' + this.y;
};

Point.sort = function (a, b) {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
};

Point.gridRound = function (b, a) {
  return {
    x: Math.round(a.x / b.width),
    y: Math.round(a.y / b.height)
  };
};

Point.low = function (low, p) {
  return {
    x: Math.max(low.x, p.x),
    y: Math.max(low.y, p.y)
  };
};

Point.clamp = function (area, p) {
  return new Point({
    x: Math.min(area.end.x, Math.max(area.begin.x, p.x)),
    y: Math.min(area.end.y, Math.max(area.begin.y, p.y))
  });
};

Point.offset = function (b, a) {
  return { x: a.x + b.x, y: a.y + b.y };
};

Point.offsetX = function (x, p) {
  return { x: p.x + x, y: p.y };
};

Point.offsetY = function (y, p) {
  return { x: p.x, y: p.y + y };
};

Point.toLeftTop = function (p) {
  return {
    left: p.x,
    top: p.y
  };
};

},{}],17:[function(require,module,exports){
"use strict";

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
        range = [i, i];
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
"use strict";

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
        range = [i, i];
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
'use strict';

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

Range.sort = function (a, b) {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
};

Range.equal = function (a, b) {
  return a[0] === b[0] && a[1] === b[1];
};

Range.clamp = function (a, b) {
  return new Range([Math.min(b[1], Math.max(a[0], b[0])), Math.min(a[1], b[1])]);
};

Range.prototype.slice = function () {
  return new Range(this);
};

Range.ranges = function (items) {
  return items.map(function (item) {
    return item.range;
  });
};

Range.prototype.inside = function (items) {
  var range = this;
  return items.filter(function (item) {
    return item.range[0] >= range[0] && item.range[1] <= range[1];
  });
};

Range.prototype.overlap = function (items) {
  var range = this;
  return items.filter(function (item) {
    return item.range[0] <= range[0] && item.range[1] >= range[1];
  });
};

Range.prototype.outside = function (items) {
  var range = this;
  return items.filter(function (item) {
    return item.range[1] < range[0] || item.range[0] > range[1];
  });
};

},{"./range-gate-and":17,"./range-gate-not":18}],20:[function(require,module,exports){
'use strict';

var Regexp = exports;

Regexp.create = function (names, flags, fn) {
  fn = fn || function (s) {
    return s;
  };
  return new RegExp(names.map(function (n) {
    return 'string' === typeof n ? Regexp.types[n] : n;
  }).map(function (r) {
    return fn(r.toString().slice(1, -1));
  }).join('|'), flags);
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
  'indent': /^ +|^\t+/,
  'line': /^.+$|^\n/,
  'newline': /\r\n|\r|\n/
};

Regexp.types.comment = Regexp.create(['single comment', 'double comment']);

Regexp.types.string = Regexp.create(['single quote string', 'double quote string', 'template string']);

Regexp.types.multiline = Regexp.create(['double comment', 'template string', 'indent', 'line']);

Regexp.parse = function (s, regexp, filter) {
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
'use strict';

module.exports = save;

function save(url, src, cb) {
    return fetch(url, {
        method: 'POST',
        body: src
    }).then(cb.bind(null, null)).catch(cb);
}

},{}],22:[function(require,module,exports){
"use strict";

// Note: You probably do not want to use this in production code, as Promise is
//   not supported by all browsers yet.

(function () {
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

    window.setImmediate = function (fn) {
        var args = Array.prototype.slice.call(arguments, 1),
            handle;

        if (typeof fn !== "function") {
            throw new TypeError("invalid function");
        }

        handle = nextHandle++;
        pending[handle] = { fn: fn, args: args };

        new Promise(function (resolve) {
            resolve(handle);
        }).then(onResolve);

        return handle;
    };

    window.clearImmediate = function (handle) {
        delete pending[handle];
    };
})();

},{}],23:[function(require,module,exports){
"use strict";

module.exports = function (fn, ms) {
  var running, timeout;

  return function (a, b, c) {
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
'use strict';

var Area = require('../../lib/area');
var Point = require('../../lib/point');
var Event = require('../../lib/event');
var Regexp = require('../../lib/regexp');

var SkipString = require('./skipstring');
var PrefixTree = require('./prefixtree');
var Segments = require('./segments');
var Indexer = require('./indexer');
var Tokens = require('./tokens');
var Syntax = require('./syntax');

var EOL = /\r\n|\r|\n/g;
var NEWLINE = /\n/g;
var WORDS = Regexp.create(['tokens'], 'g');

var SEGMENT = {
  'comment': '/*',
  'string': '`'
};

module.exports = Buffer;

function Buffer() {
  this.log = [];
  this.syntax = new Syntax();
  this.indexer = new Indexer(this);
  this.segments = new Segments(this);
  this.setText('');
}

Buffer.prototype.__proto__ = Event.prototype;

Buffer.prototype.updateRaw = function () {
  this.raw = this.text.toString();
};

Buffer.prototype.copy = function () {
  this.updateRaw();
  var buffer = new Buffer();
  buffer.replace(this);
  return buffer;
};

Buffer.prototype.replace = function (data) {
  this.raw = data.raw;
  this.text.set(this.raw);
  this.tokens = data.tokens.copy();
  this.segments.clearCache();
};

Buffer.prototype.setText = function (text) {
  text = normalizeEOL(text);

  this.raw = text; //this.syntax.highlight(text);

  this.syntax.tab = ~this.raw.indexOf('\t') ? '\t' : ' ';

  this.text = new SkipString();
  this.text.set(this.raw);

  this.tokens = new Tokens();
  this.tokens.index(this.raw);
  this.tokens.on('change segments', this.emit.bind(this, 'change segments'));

  this.prefix = new PrefixTree();
  this.prefix.index(this.raw);

  this.emit('set');
};

Buffer.prototype.insert = Buffer.prototype.insertTextAtPoint = function (p, text, noLog) {
  this.emit('before update');

  text = normalizeEOL(text);

  var length = text.length;
  var point = this.getPoint(p);
  var shift = (text.match(NEWLINE) || []).length;
  var range = [point.y, point.y + shift];
  var offsetRange = this.getLineRangeOffsets(range);

  var before = this.getOffsetRangeText(offsetRange);
  this.text.insert(point.offset, text);
  offsetRange[1] += text.length;
  var after = this.getOffsetRangeText(offsetRange);
  this.prefix.index(after);
  this.tokens.update(offsetRange, after, length);
  this.segments.clearCache(offsetRange[0]);

  if (!noLog) {
    var lastLog = this.log[this.log.length - 1];
    if (lastLog && lastLog[0] === 'insert' && lastLog[1][1] === point.offset) {
      lastLog[1][1] += text.length;
      lastLog[2] += text;
    } else {
      this.log.push(['insert', [point.offset, point.offset + text.length], text]);
    }
  }

  this.emit('update', range, shift, before, after);

  return text.length;
};

Buffer.prototype.remove = Buffer.prototype.removeOffsetRange = function (o, noLog) {
  this.emit('before update');

  // console.log('offsets', o)
  var a = this.getOffsetPoint(o[0]);
  var b = this.getOffsetPoint(o[1]);
  var length = o[0] - o[1];
  var range = [a.y, b.y];
  var shift = a.y - b.y;
  // console.log(a,b)

  var offsetRange = this.getLineRangeOffsets(range);
  var before = this.getOffsetRangeText(offsetRange);
  var text = this.text.getRange(o);
  this.text.remove(o);
  offsetRange[1] += length;
  var after = this.getOffsetRangeText(offsetRange);
  this.prefix.index(after);
  this.tokens.update(offsetRange, after, length);
  this.segments.clearCache(offsetRange[0]);

  if (!noLog) {
    var lastLog = this.log[this.log.length - 1];
    if (lastLog && lastLog[0] === 'remove' && lastLog[1][0] === o[1]) {
      lastLog[1][0] -= text.length;
      lastLog[2] = text + lastLog[2];
    } else {
      this.log.push(['remove', o, text]);
    }
  }

  this.emit('update', range, shift, before, after);
};

Buffer.prototype.removeArea = function (area) {
  var offsets = this.getAreaOffsetRange(area);
  return this.removeOffsetRange(offsets);
};

Buffer.prototype.removeCharAtPoint = function (p) {
  var point = this.getPoint(p);
  var offsetRange = [point.offset, point.offset + 1];
  return this.removeOffsetRange(offsetRange);
};

Buffer.prototype.get = function (range) {
  var code = this.getLineRangeText(range);

  // calculate indent for `code`
  //TODO: move to method
  var last = code.slice(code.lastIndexOf('\n'));
  var AnyChar = /\S/g;
  var y = range[1];
  var match = AnyChar.exec(last);
  while (!match && y < this.loc()) {
    var after = this.getLineText(++y);
    AnyChar.lastIndex = 0;
    match = AnyChar.exec(after);
  }
  var indent = 0;
  if (match) indent = match.index;
  var indentText = '\n' + new Array(indent + 1).join(this.syntax.tab);

  var segment = this.segments.get(range[0]);
  if (segment) {
    code = SEGMENT[segment] + '\uFFBA\n' + code + indentText + '\uFFBE*/`';
    code = this.syntax.highlight(code);
    code = '<' + segment[0] + '>' + code.substring(code.indexOf('\uFFBA') + 2, code.lastIndexOf('\uFFBE'));
  } else {
    code = this.syntax.highlight(code + indentText + '\uFFBE*/`');
    code = code.substring(0, code.lastIndexOf('\uFFBE'));
  }
  return code;
};

Buffer.prototype.getLine = function (y) {
  var line = new Line();
  line.offsetRange = this.getLineRangeOffsets([y, y]);
  line.offset = line.offsetRange[0];
  line.length = line.offsetRange[1] - line.offsetRange[0] - (y < this.loc());
  line.point.set({ x: 0, y: y });
  return line;
};

Buffer.prototype.getPoint = function (p) {
  var line = this.getLine(p.y);
  var point = new Point({
    x: Math.min(line.length, p.x),
    y: line.point.y
  });
  point.offset = line.offset + point.x;
  point.point = point;
  point.line = line;
  return point;
};

Buffer.prototype.getLineRangeText = function (range) {
  var offsets = this.getLineRangeOffsets(range);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.getLineRangeOffsets = function (range) {
  var a = this.getLineOffset(range[0]);
  var b = range[1] >= this.loc() ? this.text.length : this.getLineOffset(range[1] + 1);
  var offsets = [a, b];
  return offsets;
};

Buffer.prototype.getOffsetRangeText = function (offsetRange) {
  var text = this.text.getRange(offsetRange);
  return text;
};

Buffer.prototype.getOffsetPoint = function (offset) {
  var token = this.tokens.getByOffset('lines', offset - .5);
  return new Point({
    x: offset - (offset > token.offset ? token.offset + !!token.part.length : 0),
    y: Math.min(this.loc(), token.index - (token.offset + 1 > offset) + 1)
  });
};

Buffer.prototype.charAt = function (offset) {
  var char = this.text.getRange([offset, offset + 1]);
  return char;
};

Buffer.prototype.getOffsetLineText = function (offset) {
  return {
    line: line,
    text: text
  };
};

Buffer.prototype.getLineText = function (y) {
  var text = this.getLineRangeText([y, y]);
  return text;
};

Buffer.prototype.getAreaText = function (area) {
  var offsets = this.getAreaOffsetRange(area);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.wordAreaAtPoint = function (p, inclusive) {
  var point = this.getPoint(p);
  var text = this.text.getRange(point.line.offsetRange);
  var words = Regexp.parse(text, WORDS);

  if (words.length === 1) {
    var area = new Area({
      begin: { x: 0, y: point.y },
      end: { x: point.line.length, y: point.y }
    });

    return area;
  }

  var lastIndex = 0;
  var word = [];
  var end = text.length;

  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (word.index > point.x - !!inclusive) {
      end = word.index;
      break;
    }
    lastIndex = word.index;
  }

  var area = new Area({
    begin: { x: lastIndex, y: point.y },
    end: { x: end, y: point.y }
  });

  return area;
};

Buffer.prototype.moveAreaByLines = function (y, area) {
  if (area.begin.y + y < 0 || area.end.y + y > this.loc()) return false;

  area.begin.x = 0;
  area.end.x = this.getLine(area.end.y).length;

  var offsets = this.getAreaOffsetRange(area);

  var x = 0;

  if (y > 0 && area.begin.y > 0 || area.end.y === this.loc()) {
    area.begin.y -= 1;
    area.begin.x = this.getLine(area.begin.y).length;
    offsets = this.getAreaOffsetRange(area);
    x = Infinity;
  } else {
    offsets[1] += 1;
  }

  var text = this.text.getRange(offsets);

  this.removeOffsetRange(offsets);

  this.insert({ x: x, y: area.begin.y + y }, text);

  return true;
};

Buffer.prototype.getAreaOffsetRange = function (area) {
  var range = [this.getPoint(area.begin).offset, this.getPoint(area.end).offset];
  return range;
};

Buffer.prototype.getOffsetLine = function (offset) {
  return line;
};

Buffer.prototype.getLineOffset = function (y) {
  var offset = y < 0 ? -1 : y === 0 ? 0 : this.tokens.getByIndex('lines', y - 1) + 1;
  return offset;
};

Buffer.prototype.loc = function () {
  return this.tokens.getCollection('lines').length;
};

Buffer.prototype.toString = function () {
  return this.text.toString();
};

function Line() {
  this.offsetRange = [];
  this.offset = 0;
  this.length = 0;
  this.point = new Point();
}

function normalizeEOL(s) {
  return s.replace(EOL, '\n');
}

},{"../../lib/area":2,"../../lib/event":12,"../../lib/point":16,"../../lib/regexp":20,"./indexer":25,"./prefixtree":27,"./segments":28,"./skipstring":29,"./syntax":30,"./tokens":31}],25:[function(require,module,exports){
"use strict";

module.exports = Indexer;

function Indexer(buffer) {
  this.buffer = buffer;
}

Indexer.prototype.find = function (s) {
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

},{}],26:[function(require,module,exports){
'use strict';

var binarySearch = require('../../lib/binary-search');

module.exports = Parts;

function Parts(minSize) {
  minSize = minSize || 5000;
  this.minSize = minSize;
  this.parts = [];
  this.length = 0;
}

Parts.prototype.push = function (item) {
  this.append([item]);
};

Parts.prototype.append = function (items) {
  var part = last(this.parts);

  if (!part) {
    part = [];
    part.startIndex = 0;
    part.startOffset = 0;
    this.parts.push(part);
  } else if (part.length >= this.minSize) {
    var startIndex = part.startIndex + part.length;
    var startOffset = items[0];

    part = [];
    part.startIndex = startIndex;
    part.startOffset = startOffset;
    this.parts.push(part);
  }

  part.push.apply(part, items.map(function (offset) {
    return offset - part.startOffset;
  }));

  this.length += items.length;
};

Parts.prototype.get = function (index) {
  var part = this.findPartByIndex(index).item;
  return part[Math.min(part.length - 1, index - part.startIndex)] + part.startOffset;
};

Parts.prototype.find = function (offset) {
  var p = this.findPartByOffset(offset);
  if (!p.item) return null;

  var part = p.item;
  var partIndex = p.index;
  var o = this.findOffsetInPart(offset, part);
  return {
    offset: o.item + part.startOffset,
    index: o.index + part.startIndex,
    local: o.index,
    part: part,
    partIndex: partIndex
  };
};

Parts.prototype.insert = function (offset, array) {
  var o = this.find(offset);
  if (!o) {
    return this.append(array);
  }
  if (o.offset > offset) o.local = -1;
  var length = array.length;
  //TODO: maybe subtract 'offset' instead ?
  array = array.map(function (el) {
    return el -= o.part.startOffset;
  });
  insert(o.part, o.local + 1, array);
  this.shiftIndex(o.partIndex + 1, -length);
  this.length += length;
};

Parts.prototype.shiftOffset = function (offset, shift) {
  var parts = this.parts;
  var item = this.find(offset);
  if (!item) return;
  if (offset > item.offset) item.local += 1;

  var removed = 0;
  for (var i = item.local; i < item.part.length; i++) {
    item.part[i] += shift;
    if (item.part[i] + item.part.startOffset < offset) {
      removed++;
      item.part.splice(i--, 1);
    }
  }
  if (removed) {
    this.shiftIndex(item.partIndex + 1, removed);
    this.length -= removed;
  }
  for (var i = item.partIndex + 1; i < parts.length; i++) {
    parts[i].startOffset += shift;
    if (parts[i].startOffset < offset) {
      if (last(parts[i]) + parts[i].startOffset < offset) {
        removed = parts[i].length;
        this.shiftIndex(i + 1, removed);
        this.length -= removed;
        parts.splice(i--, 1);
      } else {
        this.removeBelowOffset(offset, parts[i]);
      }
    }
  }
};

Parts.prototype.removeRange = function (range) {
  var a = this.find(range[0]);
  var b = this.find(range[1]);
  if (!a && !b) return;

  if (a.partIndex === b.partIndex) {
    if (a.offset >= range[1] || a.offset < range[0]) a.local += 1;
    if (b.offset >= range[1] || b.offset < range[0]) b.local -= 1;
    var shift = remove(a.part, a.local, b.local + 1).length;
    this.shiftIndex(a.partIndex + 1, shift);
    this.length -= shift;
  } else {
    if (a.offset >= range[1] || a.offset < range[0]) a.local += 1;
    if (b.offset >= range[1] || b.offset < range[0]) b.local -= 1;
    var shiftA = remove(a.part, a.local).length;
    var shiftB = remove(b.part, 0, b.local + 1).length;
    if (b.partIndex - a.partIndex > 1) {
      var removed = remove(this.parts, a.partIndex + 1, b.partIndex);
      var shiftBetween = removed.reduce(function (p, n) {
        return p + n.length;
      }, 0);
      b.part.startIndex -= shiftA + shiftBetween;
      this.shiftIndex(b.partIndex - removed.length + 1, shiftA + shiftB + shiftBetween);
      this.length -= shiftA + shiftB + shiftBetween;
    } else {
      b.part.startIndex -= shiftA;
      this.shiftIndex(b.partIndex + 1, shiftA + shiftB);
      this.length -= shiftA + shiftB;
    }
  }

  //TODO: this is inefficient as we can calculate the indexes ourselves
  if (!a.part.length) {
    this.parts.splice(this.parts.indexOf(a.part), 1);
  }
  if (!b.part.length) {
    this.parts.splice(this.parts.indexOf(b.part), 1);
  }
};

Parts.prototype.shiftIndex = function (startIndex, shift) {
  for (var i = startIndex; i < this.parts.length; i++) {
    this.parts[i].startIndex -= shift;
  }
};

Parts.prototype.removeBelowOffset = function (offset, part) {
  var o = this.findOffsetInPart(offset, part);
  var shift = remove(part, 0, o.index).length;
  this.shiftIndex(o.partIndex + 1, shift);
  this.length -= shift;
};

Parts.prototype.findOffsetInPart = function (offset, part) {
  offset -= part.startOffset;
  return binarySearch(part, function (o) {
    return o <= offset;
  });
};

Parts.prototype.findPartByIndex = function (index) {
  return binarySearch(this.parts, function (s) {
    return s.startIndex <= index;
  });
};

Parts.prototype.findPartByOffset = function (offset) {
  return binarySearch(this.parts, function (s) {
    return s.startOffset <= offset;
  });
};

Parts.prototype.toArray = function () {
  return this.parts.reduce(function (p, n) {
    return p.concat(n);
  }, []);
};

Parts.prototype.slice = function () {
  var parts = new Parts(this.minSize);
  this.parts.forEach(function (part) {
    var p = part.slice();
    p.startIndex = part.startIndex;
    p.startOffset = part.startOffset;
    parts.parts.push(p);
  });
  parts.length = this.length;
  return parts;
};

function last(array) {
  return array[array.length - 1];
}

function remove(array, a, b) {
  if (b == null) {
    return array.splice(a);
  } else {
    return array.splice(a, b - a);
  }
}

function insert(target, index, array) {
  var op = array.slice();
  op.unshift(index, 0);
  target.splice.apply(target, op);
}

},{"../../lib/binary-search":3}],27:[function(require,module,exports){
'use strict';

// var WORD = /\w+/g;
var WORD = /[a-zA-Z0-9]{1,}/g;
var rank = 0;

module.exports = PrefixTreeNode;

function PrefixTreeNode() {
  this.value = '';
  this.rank = 0;
  this.children = {};
}

PrefixTreeNode.prototype.getChildren = function () {
  var _this = this;

  var children = Object.keys(this.children).map(function (key) {
    return _this.children[key];
  });

  return children.reduce(function (p, n) {
    return p.concat(n.getChildren());
  }, children);
};

PrefixTreeNode.prototype.collect = function (key) {
  var collection = [];
  var node = this.find(key);
  if (node) {
    collection = node.getChildren().filter(function (node) {
      return node.value;
    }).sort(function (a, b) {
      var res = b.rank - a.rank;
      if (res === 0) res = b.value.length - a.value.length;
      if (res === 0) res = a.value > b.value;
      return res;
    });

    if (node.value) collection.push(node);
  }
  return collection;
};

PrefixTreeNode.prototype.find = function (key) {
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

PrefixTreeNode.prototype.insert = function (s, value) {
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
    node = node.children[s[i]] = node.children[s[i]] || new PrefixTreeNode();
    i++;
  }

  node.value = s;
  node.rank++;
};

PrefixTreeNode.prototype.index = function (s) {
  var word;
  while (word = WORD.exec(s)) {
    this.insert(word[0]);
  }
};

},{}],28:[function(require,module,exports){
'use strict';

var Point = require('../../lib/point');
var binarySearch = require('../../lib/binary-search');
var Tokens = require('./tokens');
var Type = Tokens.Type;

var Begin = /[\/'"`]/g;

var Match = {
  'single comment': ['//', '\n'],
  'double comment': ['/*', '*/'],
  'template string': ['`', '`'],
  'single quote string': ["'", "'"],
  'double quote string': ['"', '"'],
  'regexp': ['/', '/']
};

var Skip = {
  'single quote string': "\\",
  'double quote string': "\\",
  'single comment': false,
  'double comment': false,
  'regexp': "\\"
};

var Token = {};
for (var key in Match) {
  var M = Match[key];
  Token[M[0]] = key;
}

var Length = {
  'open comment': 2,
  'close comment': 2,
  'template string': 1
};

var NotOpen = {
  'close comment': true
};

var Closes = {
  'open comment': 'close comment',
  'template string': 'template string'
};

var Tag = {
  'open comment': 'comment',
  'template string': 'string'
};

module.exports = Segments;

function Segments(buffer) {
  this.buffer = buffer;
  this.cache = {};
  this.reset();
}

Segments.prototype.clearCache = function (offset) {
  if (offset) {
    var s = binarySearch(this.cache.state, function (s) {
      return s.offset < offset;
    }, true);
    this.cache.state.splice(s.index);
  } else {
    this.cache.state = [];
  }
  this.cache.offset = {};
  this.cache.range = {};
  this.cache.point = {};
};

Segments.prototype.reset = function () {
  this.clearCache();
};

Segments.prototype.get = function (y) {
  if (y in this.cache.point) {
    return this.cache.point[y];
  }

  var segments = this.buffer.tokens.getCollection('segments');
  var open = false;
  var state = null;
  var waitFor = '';
  var point = { x: -1, y: -1 };
  var close = 0;
  var offset;
  var segment;
  var range;
  var text;
  var valid;
  var last;

  var lastCacheStateOffset = 0;

  var i = 0;

  var cacheState = this.getCacheState(y);
  if (cacheState && cacheState.item) {
    open = true;
    state = cacheState.item;
    waitFor = Closes[state.type];
    i = state.index + 1;
  }

  for (; i < segments.length; i++) {
    offset = segments.get(i);
    segment = {
      offset: offset,
      type: Type[this.buffer.charAt(offset)]
    };

    // searching for close token
    if (open) {
      if (waitFor === segment.type) {
        point = this.getOffsetPoint(segment.offset);

        if (!point) {
          return this.cache.point[y] = null;
        }

        if (point.y >= y) {
          return this.cache.point[y] = Tag[state.type];
        }

        last = segment;
        last.point = point;
        state = null;
        open = false;

        if (point.y >= y) break;
      }
    }

    // searching for open token
    else {
        point = this.getOffsetPoint(segment.offset);

        if (!point) {
          return this.cache.point[y] = null;
        }

        range = this.buffer.getLine(point.y).offsetRange;

        if (last && last.point.y === point.y) {
          close = last.point.x + Length[last.type];
        } else {
          close = 0;
        }

        valid = this.isValidRange([range[0], range[1] + 1], segment, close);

        if (valid) {
          if (NotOpen[segment.type]) continue;
          open = true;
          state = segment;
          state.index = i;
          state.point = point;
          // state.toString = function() { return this.offset };
          waitFor = Closes[state.type];
          if (!this.cache.state.length || this.cache.state.length && state.offset > this.cache.state[this.cache.state.length - 1].offset) {
            this.cache.state.push(state);
          }
        }

        if (point.y >= y) break;
      }
  }

  if (state && state.point.y < y) {
    return this.cache.point[y] = Tag[state.type];
  }

  return this.cache.point[y] = null;
};

//TODO: cache in Buffer
Segments.prototype.getOffsetPoint = function (offset) {
  if (offset in this.cache.offset) return this.cache.offset[offset];
  return this.cache.offset[offset] = this.buffer.getOffsetPoint(offset);
};

Segments.prototype.isValidRange = function (range, segment, close) {
  var key = range.join();
  if (key in this.cache.range) return this.cache.range[key];
  var text = this.buffer.getOffsetRangeText(range);
  var valid = this.isValid(text, segment.offset - range[0], close);
  return this.cache.range[key] = valid;
};

Segments.prototype.isValid = function (text, offset, lastIndex) {
  Begin.lastIndex = lastIndex;

  var match = Begin.exec(text);
  if (!match) return;

  var i = match.index;

  var last = i;

  var valid = true;

  outer: for (; i < text.length; i++) {
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
};

Segments.prototype.getCacheState = function (y) {
  var s = binarySearch(this.cache.state, function (s) {
    return s.point.y < y;
  });
  if (s.item && y - 1 < s.item.point.y) return null;else return s;
  // return s;
};

},{"../../lib/binary-search":3,"../../lib/point":16,"./tokens":31}],29:[function(require,module,exports){
'use strict';

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
  this.chunkSize = o.chunkSize || 5000;
}

SkipString.prototype = {
  get length() {
    return this.head.width[this.levels - 1];
  }
};

SkipString.prototype.get = function (offset) {
  // great hack to do offset >= for .search()
  // we don't have fractions anyway so..
  return this.search(offset, true);
};

SkipString.prototype.set = function (text) {
  this.insertChunked(0, text);
};

SkipString.prototype.search = function (offset, incl) {
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

SkipString.prototype.splice = function (s, offset, value, level) {
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

SkipString.prototype.insert = function (offset, value, level) {
  var s = this.search(offset);

  // if search falls in the middle of a string
  // insert it there instead of creating a new node
  if (s.offset && s.node.value && s.offset < s.node.value.length) {
    this.update(s, insert(s.offset, s.node.value, value));
    return s.node;
  }

  return this.splice(s, offset, value, level);
};

SkipString.prototype.update = function (s, value) {
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

SkipString.prototype.remove = function (range) {
  if (range[1] > this.length) {
    throw new Error('range end over maximum length(' + this.length + '): [' + range.join() + ']');
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
      x -= this.update(s, node.value.slice(0, offset) + node.value.slice(offset + Math.min(x, node.length - offset)));
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

SkipString.prototype.removeNode = function (steps, node) {
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

SkipString.prototype.replace = function (steps, node, value) {
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

SkipString.prototype.removeCharAt = function (offset) {
  return this.remove([offset, offset + 1]);
};

SkipString.prototype.insertChunked = function (offset, text) {
  for (var i = 0; i < text.length; i += this.chunkSize) {
    var chunk = text.substr(i, this.chunkSize);
    this.insert(i + offset, chunk);
  }
};

SkipString.prototype.substring = function (a, b) {
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

SkipString.prototype.randomLevel = function () {
  var level = 1;
  while (level < this.levels - 1 && Math.random() < this.bias) {
    level++;
  }return level;
};

SkipString.prototype.getRange = function (range) {
  range = range || [];
  return this.substring(range[0], range[1]);
};

SkipString.prototype.copy = function () {
  var copy = new SkipString();
  var node = this.head;
  var offset = 0;
  while (node = node.next[0]) {
    copy.insert(offset, node.value);
    offset += node.width[0];
  }
  return copy;
};

SkipString.prototype.joinString = function (delimiter) {
  var parts = [];
  var node = this.head;
  while (node = node.next[0]) {
    parts.push(node.value);
  }
  return parts.join(delimiter);
};

SkipString.prototype.toString = function () {
  return this.substring(0, this.length);
};

function trim(s, left, right) {
  return s.substr(0, s.length - right).substr(left);
}

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}

},{}],30:[function(require,module,exports){
'use strict';

var Regexp = require('../../lib/regexp');
var R = Regexp.create;

//NOTE: order matters
var syntax = map({
  't': R(['operator'], 'g', entities),
  'm': R(['params'], 'g'),
  'd': R(['declare'], 'g'),
  'f': R(['function'], 'g'),
  'k': R(['keyword'], 'g'),
  'n': R(['builtin'], 'g'),
  'l': R(['symbol'], 'g'),
  's': R(['template string'], 'g'),
  'e': R(['special', 'number'], 'g')
}, compile);

var Indent = {
  regexp: R(['indent'], 'gm'),
  replacer: function replacer(s) {
    return s.replace(/ {1,2}|\t/g, '<x>$&</x>');
  }
};

var AnyChar = /\S/g;

var Blocks = R(['comment', 'string', 'regexp'], 'gm');

var LongLines = /(^.{1000,})/gm;

var Tag = {
  '//': 'c',
  '/*': 'c',
  '`': 's',
  '"': 's',
  "'": 's',
  '/': 'r'
};

module.exports = Syntax;

function Syntax(o) {
  o = o || {};
  this.tab = o.tab || '\t';
  this.blocks = [];
}

Syntax.prototype.entities = entities;

Syntax.prototype.highlight = function (code, offset) {
  code = this.createIndents(code);
  code = this.createBlocks(code);
  code = entities(code);

  for (var key in syntax) {
    code = code.replace(syntax[key].regexp, syntax[key].replacer);
  }

  code = this.restoreBlocks(code);
  code = code.replace(Indent.regexp, Indent.replacer);

  return code;
};

Syntax.prototype.createIndents = function (code) {
  var lines = code.split(/\n/g);
  var indent = 0;
  var match;
  var line;
  var i;

  i = lines.length;

  while (i--) {
    line = lines[i];
    AnyChar.lastIndex = 0;
    match = AnyChar.exec(line);
    if (match) indent = match.index;else if (indent && !line.length) {
      lines[i] = new Array(indent + 1).join(this.tab);
    }
  }

  code = lines.join('\n');

  return code;
};

Syntax.prototype.restoreBlocks = function (code) {
  var block;
  var blocks = this.blocks;
  var n = 0;
  return code.replace(/\uffec/g, function () {
    block = blocks[n++];
    return entities(block.slice(0, 1000) + '...line too long to display');
  }).replace(/\uffeb/g, function () {
    block = blocks[n++];
    var tag = identify(block);
    return '<' + tag + '>' + entities(block) + '</' + tag + '>';
  });
};

Syntax.prototype.createBlocks = function (code) {
  var _this = this;

  this.blocks = [];

  code = code.replace(LongLines, function (block) {
    _this.blocks.push(block);
    return '\uFFEC';
  }).replace(Blocks, function (block) {
    _this.blocks.push(block);
    return '\uFFEB';
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
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

},{"../../lib/regexp":20}],31:[function(require,module,exports){
'use strict';

var Event = require('../../lib/event');
var Parts = require('./parts');

var Type = {
  '\n': 'lines',
  '{': 'open curly',
  '}': 'close curly',
  '[': 'open square',
  ']': 'close square',
  '(': 'open parens',
  ')': 'close parens',
  '/': 'open comment',
  '*': 'close comment',
  '`': 'template string'
};

var TOKEN = /\n|\/\*|\*\/|`|\{|\}|\[|\]|\(|\)/g;

module.exports = Tokens;

Tokens.Type = Type;

function Tokens(factory) {
  factory = factory || function () {
    return new Parts();
  };

  this.factory = factory;

  var t = this.tokens = {
    lines: factory(),
    blocks: factory(),
    segments: factory()
  };

  this.collection = {
    '\n': t.lines,
    '{': t.blocks,
    '}': t.blocks,
    '[': t.blocks,
    ']': t.blocks,
    '(': t.blocks,
    ')': t.blocks,
    '/': t.segments,
    '*': t.segments,
    '`': t.segments
  };
}

Tokens.prototype.__proto__ = Event.prototype;

Tokens.prototype.index = function (text, offset) {
  offset = offset || 0;

  var tokens = this.tokens;
  var match;
  var type;
  var collection;

  while (match = TOKEN.exec(text)) {
    collection = this.collection[text[match.index]];
    collection.push(match.index + offset);
  }
};

Tokens.prototype.update = function (range, text, shift) {
  var insert = new Tokens(Array);
  insert.index(text, range[0]);

  var lengths = {};
  for (var type in this.tokens) {
    lengths[type] = this.tokens[type].length;
  }

  for (var type in this.tokens) {
    this.tokens[type].shiftOffset(range[0], shift);
    this.tokens[type].removeRange(range);
    this.tokens[type].insert(range[0], insert.tokens[type]);
  }

  for (var type in this.tokens) {
    if (this.tokens[type].length !== lengths[type]) {
      this.emit('change ' + type);
    }
  }
};

Tokens.prototype.getByIndex = function (type, index) {
  return this.tokens[type].get(index);
};

Tokens.prototype.getCollection = function (type) {
  return this.tokens[type];
};

Tokens.prototype.getByOffset = function (type, offset) {
  return this.tokens[type].find(offset);
};

Tokens.prototype.copy = function () {
  var tokens = new Tokens(this.factory);
  var t = tokens.tokens;
  for (var key in this.tokens) {
    t[key] = this.tokens[key].slice();
  }
  tokens.collection = {
    '\n': t.lines,
    '{': t.blocks,
    '}': t.blocks,
    '[': t.blocks,
    ']': t.blocks,
    '(': t.blocks,
    ')': t.blocks,
    '/': t.segments,
    '*': t.segments,
    '`': t.segments
  };
  return tokens;
};

},{"../../lib/event":12,"./parts":26}],32:[function(require,module,exports){
'use strict';

var open = require('../lib/open');
var save = require('../lib/save');
var Event = require('../lib/event');
var Buffer = require('./buffer');

module.exports = File;

function File(editor) {
  Event.call(this);

  this.root = '';
  this.path = 'untitled';
  this.buffer = new Buffer();
  this.bindEvent();
}

File.prototype.__proto__ = Event.prototype;

File.prototype.bindEvent = function () {
  this.buffer.on('raw', this.emit.bind(this, 'raw'));
  this.buffer.on('set', this.emit.bind(this, 'set'));
  this.buffer.on('update', this.emit.bind(this, 'change'));
  this.buffer.on('before update', this.emit.bind(this, 'before change'));
};

File.prototype.open = function (path, root, fn) {
  var _this = this;

  this.path = path;
  this.root = root;
  open(root + path, function (err, text) {
    if (err) {
      _this.emit('error', err);
      fn && fn(err);
      return;
    }
    _this.buffer.setText(text);
    _this.emit('open');
    fn && fn(null, _this);
  });
};

File.prototype.save = function (fn) {
  save(this.root + this.path, this.buffer.toString(), fn || noop);
};

File.prototype.set = function (text) {
  this.buffer.setText(text);
};

function noop() {/* noop */}

},{"../lib/event":12,"../lib/open":15,"../lib/save":21,"./buffer":24}],33:[function(require,module,exports){
'use strict';

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
  this.debouncedSave = debounce(this.actuallySave.bind(this), 700);
}

History.prototype.__proto__ = Event.prototype;

History.prototype.save = function (force) {
  if (Date.now() - this.timeStart > 2000 || force) this.actuallySave();
  this.timeout = this.debouncedSave();
};

History.prototype.actuallySave = function () {
  clearTimeout(this.timeout);
  if (this.editor.buffer.log.length) {
    this.log = this.log.slice(0, ++this.needle);
    this.log.push(this.commit());
    this.needle = this.log.length;
    this.saveMeta();
  } else {
    this.saveMeta();
  }
  this.timeStart = Date.now();
  this.timeout = false;
};

History.prototype.undo = function () {
  if (this.timeout !== false) this.actuallySave();

  if (this.needle > this.log.length - 1) this.needle = this.log.length - 1;
  if (this.needle < 0) return;

  this.checkout('undo', this.needle--);
};

History.prototype.redo = function () {
  if (this.timeout !== false) this.actuallySave();

  if (this.needle === this.log.length - 1) return;

  this.checkout('redo', ++this.needle);
};

History.prototype.checkout = function (type, n) {
  var _this = this;

  var commit = this.log[n];
  if (!commit) return;

  var log = commit.log;

  commit = this.log[n][type];
  this.editor.mark.active = commit.markActive;
  this.editor.mark.set(commit.mark.copy());
  this.editor.setCaret(commit.caret.copy());

  log = 'undo' === type ? log.slice().reverse() : log.slice();

  log.forEach(function (item) {
    var action = item[0];
    var offsetRange = item[1];
    var text = item[2];
    switch (action) {
      case 'insert':
        if ('undo' === type) {
          _this.editor.buffer.removeOffsetRange(offsetRange, true);
        } else {
          _this.editor.buffer.insert(_this.editor.buffer.getOffsetPoint(offsetRange[0]), text, true);
        }
        break;
      case 'remove':
        if ('undo' === type) {
          _this.editor.buffer.insert(_this.editor.buffer.getOffsetPoint(offsetRange[0]), text, true);
        } else {
          _this.editor.buffer.removeOffsetRange(offsetRange, true);
        }
        break;
    }
  });

  this.emit('change');
};

History.prototype.commit = function () {
  var log = this.editor.buffer.log;
  this.editor.buffer.log = [];
  return {
    log: log,
    undo: this.meta,
    redo: {
      caret: this.editor.caret.copy(),
      mark: this.editor.mark.copy(),
      markActive: this.editor.mark.active
    }
  };
};

History.prototype.saveMeta = function () {
  this.meta = {
    caret: this.editor.caret.copy(),
    mark: this.editor.mark.copy(),
    markActive: this.editor.mark.active
  };
};

},{"../lib/debounce":7,"../lib/event":12}],34:[function(require,module,exports){
'use strict';

var throttle = require('../../lib/throttle');

var PAGING_THROTTLE = 65;

var keys = module.exports = {
  'ctrl+z': function ctrlZ() {
    this.history.undo();
  },
  'ctrl+y': function ctrlY() {
    this.history.redo();
  },

  'home': function home() {
    this.move.beginOfLine();
  },
  'end': function end() {
    this.move.endOfLine();
  },
  'pageup': throttle(function () {
    this.move.pageUp();
  }, PAGING_THROTTLE),
  'pagedown': throttle(function () {
    this.move.pageDown();
  }, PAGING_THROTTLE),
  'ctrl+up': throttle(function () {
    this.move.pageUp(6);
  }, PAGING_THROTTLE),
  'ctrl+down': throttle(function () {
    this.move.pageDown(6);
  }, PAGING_THROTTLE),
  'left': function left() {
    this.move.byChars(-1);
  },
  'up': function up() {
    this.move.byLines(-1);
  },
  'right': function right() {
    this.move.byChars(+1);
  },
  'down': function down() {
    this.move.byLines(+1);
  },

  'ctrl+left': function ctrlLeft() {
    this.move.byWord(-1);
  },
  'ctrl+right': function ctrlRight() {
    this.move.byWord(+1);
  },

  'ctrl+a': function ctrlA() {
    this.markClear(true);
    this.move.beginOfFile(null, true);
    this.markBegin();
    this.move.endOfFile(null, true);
    this.markSet();
  },

  'enter': function enter() {
    this.insert('\n');
  },

  'backspace': function backspace() {
    this.backspace();
  },
  'delete': function _delete() {
    this.delete();
  },
  'ctrl+backspace': function ctrlBackspace() {
    if (this.move.isBeginOfFile()) return;
    this.markClear(true);
    this.markBegin();
    this.move.byWord(-1, true);
    this.markSet();
    this.delete();
  },
  'shift+ctrl+backspace': function shiftCtrlBackspace() {
    this.markClear(true);
    this.markBegin();
    this.move.beginOfLine(null, true);
    this.markSet();
    this.delete();
  },
  'ctrl+delete': function ctrlDelete() {
    if (this.move.isEndOfFile()) return;
    this.markClear(true);
    this.markBegin();
    this.move.byWord(+1, true);
    this.markSet();
    this.backspace();
  },
  'shift+ctrl+delete': function shiftCtrlDelete() {
    this.markClear(true);
    this.markBegin();
    this.move.endOfLine(null, true);
    this.markSet();
    this.backspace();
  },
  'shift+delete': function shiftDelete() {
    this.markClear(true);
    this.move.beginOfLine(null, true);
    this.markBegin();
    this.move.endOfLine(null, true);
    this.move.byChars(+1, true);
    this.markSet();
    this.backspace();
  },

  'shift+ctrl+d': function shiftCtrlD() {
    this.markBegin(false);
    var add = 0;
    var area = this.mark.get();
    var lines = area.end.y - area.begin.y;
    if (lines && area.end.x > 0) add += 1;
    if (!lines) add += 1;
    lines += add;
    var text = this.buffer.getAreaText(area.setLeft(0).addBottom(add));
    this.buffer.insert({ x: 0, y: area.end.y }, text);
    this.mark.shiftByLines(lines);
    this.move.byLines(lines, true);
  },

  'shift+ctrl+up': function shiftCtrlUp() {
    this.emit('input', '\uAAA2', this.caret.copy(), this.mark.copy(), this.mark.active);
    this.markBegin(false);
    var area = this.mark.get();
    if (area.end.x === 0) {
      area.end.y = area.end.y - 1;
      area.end.x = this.buffer.getLine(area.end.y).length;
    }
    if (this.buffer.moveAreaByLines(-1, area)) {
      this.mark.shiftByLines(-1);
      this.move.byLines(-1, true);
    }
  },

  'shift+ctrl+down': function shiftCtrlDown() {
    this.emit('input', '\uAAA3', this.caret.copy(), this.mark.copy(), this.mark.active);
    this.markBegin(false);
    var area = this.mark.get();
    if (area.end.x === 0) {
      area.end.y = area.end.y - 1;
      area.end.x = this.buffer.getLine(area.end.y).length;
    }
    if (this.buffer.moveAreaByLines(+1, area)) {
      this.mark.shiftByLines(+1);
      this.move.byLines(+1, true);
    }
  },

  'tab': function tab() {
    var res = this.suggest();
    if (!res) {
      this.insert(this.tab);
    } else {
      this.markSetArea(res.area);
      this.insert(res.node.value);
    }
  },

  'ctrl+f': function ctrlF() {
    this.find.open();
  },

  'f3': function f3() {
    this.findJump(+1);
  },
  'shift+f3': function shiftF3() {
    this.findJump(-1);
  },

  'ctrl+/': function ctrl() {
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
      text = this.buffer.getAreaText(area);
    } else {
      area = this.mark.get();
      this.mark.addBottom(area.end.x > 0).setLeft(0);
      text = this.buffer.getAreaText(this.mark.get());
    }

    //TODO: should check if last line has // also
    if (text.trimLeft().substr(0, 2) === '//') {
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

  'shift+ctrl+/': function shiftCtrl() {
    var clear = false;
    var add = 0;
    if (!this.mark.active) clear = true;
    var caret = this.caret.copy();
    this.markBegin(false);
    var area = this.mark.get();
    var text = this.buffer.getAreaText(area);
    if (text.slice(0, 2) === '/*' && text.slice(-2) === '*/') {
      text = text.slice(2, -2);
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
  }
};

keys.single = {
  //
};

// selection keys
['home', 'end', 'pageup', 'pagedown', 'left', 'up', 'right', 'down', 'ctrl+left', 'ctrl+right'].forEach(function (key) {
  keys['shift+' + key] = function (e) {
    this.markBegin();
    keys[key].call(this, e);
    this.markSet();
  };
});

},{"../../lib/throttle":23}],35:[function(require,module,exports){
'use strict';

var Event = require('../../lib/event');
var Mouse = require('./mouse');
var Text = require('./text');

module.exports = Input;

function Input(editor) {
  this.editor = editor;
  this.mouse = new Mouse(this);
  this.text = new Text();
  this.bindEvent();
}

Input.prototype.__proto__ = Event.prototype;

Input.prototype.bindEvent = function () {
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

Input.prototype.use = function (node) {
  this.mouse.use(node);
  this.text.reset();
};

Input.prototype.blur = function () {
  this.text.blur();
};

Input.prototype.focus = function () {
  this.text.focus();
};

},{"../../lib/event":12,"./mouse":36,"./text":37}],36:[function(require,module,exports){
'use strict';

var Event = require('../../lib/event');
var debounce = require('../../lib/debounce');
var Point = require('../../lib/point');

module.exports = Mouse;

function Mouse() {
  this.node = null;
  this.clicks = 0;
  this.point = new Point();
  this.down = null;
  this.bindEvent();
}

Mouse.prototype.__proto__ = Event.prototype;

Mouse.prototype.bindEvent = function () {
  this.resetClicks = debounce(this.resetClicks.bind(this), 350);
  this.onmaybedrag = this.onmaybedrag.bind(this);
  this.ondrag = this.ondrag.bind(this);
  this.ondown = this.ondown.bind(this);
  this.onup = this.onup.bind(this);
  document.body.addEventListener('mouseup', this.onup);
};

Mouse.prototype.use = function (node) {
  if (this.node) {
    this.node.removeEventListener('mousedown', this.ondown);
    this.node.removeEventListener('touchstart', this.ondown);
  }
  this.node = node;
  this.node.addEventListener('mousedown', this.ondown);
  this.node.addEventListener('touchstart', this.ondown);
};

Mouse.prototype.ondown = function (e) {
  this.point = this.down = this.getPoint(e);
  this.emit('down', e);
  this.onclick(e);
  this.maybeDrag();
};

Mouse.prototype.onup = function (e) {
  this.emit('up', e);
  if (!this.down) return;
  this.down = null;
  this.dragEnd();
  this.maybeDragEnd();
};

Mouse.prototype.onclick = function (e) {
  this.resetClicks();
  this.clicks = this.clicks % 3 + 1;
  this.emit('click', e);
};

Mouse.prototype.onmaybedrag = function (e) {
  this.point = this.getPoint(e);

  var d = Math.abs(this.point.x - this.down.x) + Math.abs(this.point.y - this.down.y);

  if (d > 5) {
    this.maybeDragEnd();
    this.dragBegin();
  }
};

Mouse.prototype.ondrag = function (e) {
  this.point = this.getPoint(e);
  this.emit('drag', e);
};

Mouse.prototype.maybeDrag = function () {
  this.node.addEventListener('mousemove', this.onmaybedrag);
};

Mouse.prototype.maybeDragEnd = function () {
  this.node.removeEventListener('mousemove', this.onmaybedrag);
};

Mouse.prototype.dragBegin = function () {
  this.node.addEventListener('mousemove', this.ondrag);
  this.emit('drag begin');
};

Mouse.prototype.dragEnd = function () {
  this.node.removeEventListener('mousemove', this.ondrag);
  this.emit('drag end');
};

Mouse.prototype.resetClicks = function () {
  this.clicks = 0;
};

Mouse.prototype.getPoint = function (e) {
  return new Point({
    x: e.clientX,
    y: e.clientY
  });
};

},{"../../lib/debounce":7,"../../lib/event":12,"../../lib/point":16}],37:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var Event = require('../../lib/event');

var THROTTLE = 0; //1000/62;

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
  105: 'pageup'
};

module.exports = Text;

Text.map = map;

function Text() {
  Event.call(this);

  this.el = document.createElement('textarea');

  dom.style(this, {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: 10000
  });

  dom.attrs(this, {
    autocapitalize: 'none',
    autocomplete: 'off',
    spellchecking: 'off'
  });

  this.throttleTime = 0;
  this.modifiers = {};
  this.bindEvent();
}

Text.prototype.__proto__ = Event.prototype;

Text.prototype.bindEvent = function () {
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
  this.clear = throttle(this.clear.bind(this), 2000);
};

Text.prototype.reset = function () {
  this.set('');
  this.modifiers = {};
};

Text.prototype.get = function () {
  return this.el.value.substr(-1);
};

Text.prototype.set = function (value) {
  this.el.value = value;
};

//TODO: on mobile we need to clear without debounce
// or the textarea content is displayed in hacker's keyboard
// or you need to disable word suggestions in hacker's keyboard settings
Text.prototype.clear = function () {
  this.set('');
};

Text.prototype.blur = function () {
  // console.log('focus')
  this.el.blur();
};

Text.prototype.focus = function () {
  // console.log('focus')
  this.el.focus();
};

Text.prototype.oninput = function (e) {
  var _this = this;

  e.preventDefault();
  // forces caret to end of textarea so we can get .slice(-1) char
  setImmediate(function () {
    return _this.el.selectionStart = _this.el.value.length;
  });
  this.emit('text', this.get());
  this.clear();
  return false;
};

Text.prototype.onkeydown = function (e) {
  var _this2 = this;

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
    keys.forEach(function (press) {
      return _this2.emit('key', press, e);
    });
  }
};

Text.prototype.onkeyup = function (e) {
  var _this3 = this;

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
    keys.forEach(function (press) {
      return _this3.emit('key', press, e);
    });
  }
};

Text.prototype.oncut = function (e) {
  e.preventDefault();
  this.emit('cut', e);
};

Text.prototype.oncopy = function (e) {
  e.preventDefault();
  this.emit('copy', e);
};

Text.prototype.onpaste = function (e) {
  e.preventDefault();
  this.emit('paste', e);
};

},{"../../lib/debounce":7,"../../lib/dom":11,"../../lib/event":12,"../../lib/throttle":23}],38:[function(require,module,exports){
'use strict';

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

Move.prototype.pageDown = function (div) {
  div = div || 1;
  var page = this.editor.page.height / div | 0;
  var size = this.editor.size.height / div | 0;
  var remainder = size - page * this.editor.char.height | 0;
  this.editor.animateScrollBy(0, size - remainder);
  return this.byLines(page);
};

Move.prototype.pageUp = function (div) {
  div = div || 1;
  var page = this.editor.page.height / div | 0;
  var size = this.editor.size.height / div | 0;
  var remainder = size - page * this.editor.char.height | 0;
  this.editor.animateScrollBy(0, -(size - remainder));
  return this.byLines(-page);
};

var move = {};

move.byWord = function (buffer, p, dx) {
  var line = buffer.getLineText(p.y);

  if (dx > 0 && p.x >= line.length - 1) {
    // at end of line
    return move.byChars(buffer, p, +1); // move one char right
  } else if (dx < 0 && p.x === 0) {
    // at begin of line
    return move.byChars(buffer, p, -1); // move one char left
  }

  var words = Regexp.parse(line, WORDS);
  var word;

  if (dx < 0) words.reverse();

  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (dx > 0 ? word.index > p.x : word.index < p.x) {
      return {
        x: word.index,
        y: p.y
      };
    }
  }

  // reached begin/end of file
  return dx > 0 ? move.endOfLine(buffer, p) : move.beginOfLine(buffer, p);
};

move.byChars = function (buffer, p, dx) {
  var x = p.x;
  var y = p.y;

  if (dx < 0) {
    // going left
    x += dx; // move left
    if (x < 0) {
      // when past left edge
      if (y > 0) {
        // and lines above
        y -= 1; // move up a line
        x = buffer.getLine(y).length; // and go to the end of line
      } else {
        x = 0;
      }
    }
  } else if (dx > 0) {
    // going right
    x += dx; // move right
    while (x - buffer.getLine(y).length > 0) {
      // while past line length
      if (y === buffer.loc()) {
        // on end of file
        x = buffer.getLine(y).length; // go to end of line on last line
        break; // and exit
      }
      x -= buffer.getLine(y).length + 1; // wrap this line length
      y += 1; // and move down a line
    }
  }

  this.lastDeliberateX = x;

  return {
    x: x,
    y: y
  };
};

move.byLines = function (buffer, p, dy) {
  var x = p.x;
  var y = p.y;

  if (dy < 0) {
    // going up
    if (y + dy > 0) {
      // when lines above
      y += dy; // move up
    } else {
      y = 0;
    }
  } else if (dy > 0) {
    // going down
    if (y < buffer.loc() - dy) {
      // when lines below
      y += dy; // move down
    } else {
      y = buffer.loc();
    }
  }

  // if (x > lines.getLine(y).length) {
  //   x = lines.getLine(y).length;
  // } else {
  // }
  x = Math.min(this.lastDeliberateX, buffer.getLine(y).length);

  return {
    x: x,
    y: y
  };
};

move.beginOfLine = function (_, p) {
  this.lastDeliberateX = 0;
  return {
    x: 0,
    y: p.y
  };
};

move.endOfLine = function (buffer, p) {
  var x = buffer.getLine(p.y).length;
  this.lastDeliberateX = Infinity;
  return {
    x: x,
    y: p.y
  };
};

move.beginOfFile = function () {
  this.lastDeliberateX = 0;
  return {
    x: 0,
    y: 0
  };
};

move.endOfFile = function (buffer) {
  var last = buffer.loc();
  var x = buffer.getLine(last).length;
  this.lastDeliberateX = x;
  return {
    x: x,
    y: last
  };
};

move.isBeginOfFile = function (_, p) {
  return p.x === 0 && p.y === 0;
};

move.isEndOfFile = function (buffer, p) {
  var last = buffer.loc();
  return p.y === last && p.x === buffer.getLine(last).length;
};

Object.keys(move).forEach(function (method) {
  Move.prototype[method] = function (param, byEdit) {
    var result = move[method].call(this, this.editor.buffer, this.editor.caret, param);

    if ('is' === method.slice(0, 2)) return result;

    this.emit('move', result, byEdit);
  };
});

},{"../lib/event":12,"../lib/point":16,"../lib/regexp":20}],39:[function(require,module,exports){
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","blink-smooth":"_src_style__blink-smooth","caret-blink-smooth":"_src_style__caret-blink-smooth","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
},{}],40:[function(require,module,exports){
'use strict';

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
    string: '#E6DB74'
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
    string: '#C43C3C'
  },

  redbliss: {
    background: '#271E16',
    color: '#E9E3D1',
    keyword: '#A13630',
    function: '#B3DF02',
    declare: '#F63833',
    number: '#FF9F4E',
    params: '#A090A0',
    regexp: '#BD70F4',
    comment: '#635047',
    string: '#3EA1FB'
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
    string: '#E67000'
  }
};

exports = module.exports = setTheme;
exports.themes = themes;

/*
t: operator
k: keyword
d: declare
b: builtin
o: boolean
n: number
m: params
f: function
r: regexp
c: comment
s: string
l: symbol
x: indent
 */
function setTheme(name) {
  var t = themes[name];
  dom.css('theme', '\n.' + name + ',\n.' + css.rows + ' {\n  background: ' + t.background + ';\n}\n\nt,\nk {\n  color: ' + t.keyword + ';\n}\n\nd,\nn {\n  color: ' + t.declare + ';\n}\n\no,\ne {\n  color: ' + t.number + ';\n}\n\nm {\n  color: ' + t.params + ';\n}\n\nf {\n  color: ' + t.function + ';\n  font-style: normal;\n}\n\nr {\n  color: ' + (t.regexp || t.params) + ';\n}\n\nc {\n  color: ' + t.comment + ';\n}\n\ns {\n  color: ' + t.string + ';\n}\n\nl,\n.' + css.code + ' {\n  color: ' + t.color + ';\n}\n\n.' + css.caret + ' {\n  background: ' + t.color + ';\n}\n\nm,\nd {\n  font-style: italic;\n}\n\nl {\n  font-style: normal;\n}\n\nx {\n  display: inline-block;\n  background-repeat: no-repeat;\n}\n');
}

},{"../lib/dom":11,"./style.css":39}],41:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = BlockView;

function BlockView(editor) {
  View.call(this, editor);
  this.name = 'block';
  this.dom = dom(css.block);
  this.html = '';
}

BlockView.prototype.__proto__ = View.prototype;

BlockView.prototype.use = function (target) {
  dom.append(target, this);
};

BlockView.prototype.get = function (e) {
  var html = '';

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

  var offset = e.buffer.getPoint(e.caret).offset;

  var result = e.buffer.tokens.getByOffset('blocks', offset);
  if (!result) return html;

  var length = e.buffer.tokens.getCollection('blocks').length;
  var char = e.buffer.charAt(result);

  var open;
  var close;

  var i = result.index;
  var openOffset = result.offset;

  char = e.buffer.charAt(openOffset);

  var count = result.offset >= offset - 1 && Close[char] ? 0 : 1;

  var limit = 200;

  while (i > 0) {
    open = Open[char];
    if (Close[char]) count++;
    if (! --limit) return html;

    if (open && ! --count) break;

    openOffset = e.buffer.tokens.getByIndex('blocks', --i);
    char = e.buffer.charAt(openOffset);
  }

  if (count) return html;

  count = 1;

  var closeOffset;

  while (i < length - 1) {
    closeOffset = e.buffer.tokens.getByIndex('blocks', ++i);
    char = e.buffer.charAt(closeOffset);
    if (! --limit) return html;

    close = Close[char];
    if (Open[char] === open) count++;
    if (open === close) count--;

    if (!count) break;
  }

  if (count) return html;

  var begin = e.buffer.getOffsetPoint(openOffset);
  var end = e.buffer.getOffsetPoint(closeOffset);

  var tabs;

  tabs = e.getPointTabs(begin);

  html += '<i style="' + 'width:' + e.char.width + 'px;' + 'top:' + begin.y * e.char.height + 'px;' + 'left:' + ((begin.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.codeLeft) + 'px;' + '"></i>';

  tabs = e.getPointTabs(end);

  html += '<i style="' + 'width:' + e.char.width + 'px;' + 'top:' + end.y * e.char.height + 'px;' + 'left:' + ((end.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.codeLeft) + 'px;' + '"></i>';

  return html;
};

BlockView.prototype.render = function () {
  var html = this.get(this.editor);

  if (html !== this.html) {
    this.html = html;
    dom.html(this, html);
  }
};

BlockView.prototype.clear = function () {
  dom.style(this, {
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],42:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = CaretView;

function CaretView(editor) {
  View.call(this, editor);
  this.name = 'caret';
  this.dom = dom(css.caret);
}

CaretView.prototype.__proto__ = View.prototype;

CaretView.prototype.use = function (target) {
  dom.append(target, this);
};

CaretView.prototype.render = function () {
  dom.style(this, {
    opacity: +this.editor.hasFocus,
    left: this.editor.caretPx.x + this.editor.codeLeft,
    top: this.editor.caretPx.y - 1,
    height: this.editor.char.height + 1
  });
};

CaretView.prototype.clear = function () {
  dom.style(this, {
    opacity: 0,
    left: 0,
    top: 0,
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],43:[function(require,module,exports){
'use strict';

var Range = require('../../lib/range');
var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

var AheadThreshold = {
  animation: [.15, .4],
  normal: [2, 4]
};

module.exports = CodeView;

function CodeView(editor) {
  View.call(this, editor);

  this.name = 'code';
  this.dom = dom(css.code);
  this.parts = [];
  this.offset = { top: 0, left: 0 };
}

CodeView.prototype.__proto__ = View.prototype;

CodeView.prototype.use = function (target) {
  this.target = target;
};

CodeView.prototype.appendParts = function () {
  this.parts.forEach(function (part) {
    return part.append();
  });
};

CodeView.prototype.renderPart = function (range) {
  var part = new Part(this, range);
  this.parts.push(part);
  part.render();
  part.append();
};

CodeView.prototype.renderEdit = function (edit) {
  this.clearOutPageRange([0, 0]);
  if (edit.shift > 0) this.renderInsert(edit);else if (edit.shift < 0) this.renderRemove(edit);else this.renderLine(edit);
};

CodeView.prototype.renderPage = function () {
  var _this = this;

  var page = this.editor.getPageRange([0, 0]);
  var inParts = this.inRangeParts(page);
  var needRanges = Range.NOT(page, this.parts);
  needRanges.forEach(function (range) {
    return _this.renderPart(range);
  });
  inParts.forEach(function (part) {
    return part.render();
  });
};

CodeView.prototype.renderRemove = function (edit) {
  var parts = this.parts.slice();
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part[0] > edit.range[0] && part[1] < edit.range[1]) {
      this.removePart(part);
    } else if (part[0] < edit.line && part[1] >= edit.line) {
      part[1] = edit.line - 1;
      part.style();
      this.renderPart([edit.line, edit.line]);
    } else if (part[0] === edit.line && part[1] === edit.line) {
      part.render();
    } else if (part[0] === edit.line && part[1] > edit.line) {
      this.removePart(part);
      this.renderPart([edit.line, edit.line]);
    } else if (part[0] > edit.line && part[0] + edit.shift <= edit.line) {
      var offset = edit.line - (part[0] + edit.shift) + 1;
      part[0] += edit.shift + offset;
      part[1] += edit.shift + offset;
      part.offset(offset);
      if (part[0] >= part[1]) this.removePart(part);
    } else if (part[0] > edit.line) {
      part[0] += edit.shift;
      part[1] += edit.shift;
      part.style();
    }
  }
  this.renderPage();
};

CodeView.prototype.renderInsert = function (edit) {
  var parts = this.parts.slice();
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part[0] < edit.line && part[1] >= edit.line) {
      part[1] = edit.line - 1;
      part.style();
      this.renderPart(edit.range);
    } else if (part[0] === edit.line) {
      part.render();
    } else if (part[0] > edit.line) {
      part[0] += edit.shift;
      part[1] += edit.shift;
      part.style();
    }
  }
  this.renderPage();
};

CodeView.prototype.renderLine = function (edit) {
  var parts = this.parts.slice();
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part[0] === edit.line && part[1] === edit.line) {
      part.render();
    } else if (part[0] <= edit.line && part[1] >= edit.line) {
      part[1] = edit.line - 1;
      if (part[1] < part[0]) this.removePart(part);else part.style();
      this.renderPart(edit.range);
    }
  }
  this.renderPage();
};

CodeView.prototype.removePart = function (part) {
  part.clear();
  this.parts.splice(this.parts.indexOf(part), 1);
};

CodeView.prototype.clearOutPageRange = function (range) {
  var _this2 = this;

  this.outRangeParts(this.editor.getPageRange(range)).forEach(function (part) {
    return _this2.removePart(part);
  });
};

CodeView.prototype.inRangeParts = function (range) {
  var parts = [];
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part[0] >= range[0] && part[0] <= range[1] || part[1] >= range[0] && part[1] <= range[1]) {
      parts.push(part);
    }
  }
  return parts;
};

CodeView.prototype.outRangeParts = function (range) {
  var parts = [];
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part[1] < range[0] || part[0] > range[1]) {
      parts.push(part);
    }
  }
  return parts;
};

CodeView.prototype.render = function () {
  var _this3 = this;

  var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

  if (opts.offset) this.offset = opts.offset;
  // if (this.editor.editing) return;

  var page = this.editor.getPageRange([0, 0]);

  if (Range.NOT(page, this.parts).length === 0) {
    return;
  }

  if (Range.AND(page, this.parts).length === 0) {
    this.clearOutPageRange([0, 0]);
    this.renderPart(page);
    return;
  }

  // check if we're past the threshold of view
  var threshold = this.editor.animationRunning ? [-AheadThreshold.animation[0], +AheadThreshold.animation[0]] : [-AheadThreshold.normal[0], +AheadThreshold.normal[0]];

  var aheadRange = this.editor.getPageRange(threshold);
  var aheadNeedRanges = Range.NOT(aheadRange, this.parts);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders

    threshold = this.editor.animationRunning ? [-AheadThreshold.animation[1], +AheadThreshold.animation[1]] : [-AheadThreshold.normal[1], +AheadThreshold.normal[1]];

    this.clearOutPageRange(threshold);

    aheadRange = this.editor.getPageRange(threshold);
    aheadNeedRanges = Range.NOT(aheadRange, this.parts);
    aheadNeedRanges.forEach(function (range) {
      _this3.renderPart(range);
    });
  }
};

CodeView.prototype.clear = function () {
  this.parts.forEach(function (part) {
    return part.clear();
  });
  this.parts = [];
};

function Part(view, range) {
  this.view = view;
  this.dom = dom(css.code);
  this.code = '';
  this.offsetTop = 0;
  this[0] = range[0];
  this[1] = range[1];

  var style = {};

  if (this.view.editor.options.debug_layers && ~this.view.editor.options.debug_layers.indexOf(this.view.name)) {
    style.background = '#' + (Math.random() * 12 | 0).toString(16) + (Math.random() * 12 | 0).toString(16) + (Math.random() * 12 | 0).toString(16);
    style.opacity = 0.5;
  }

  dom.style(this, style);
}

Part.prototype.offset = function (y) {
  this.offsetTop += y;
  this.code = this.code.split(/\n/g).slice(y).join('\n');
  this[1] -= y;
  this.style();
  this.dom.el.scrollTop = this.offsetTop * this.view.editor.char.height;
};

Part.prototype.append = function () {
  dom.append(this.view.target, this);
};

Part.prototype.render = function () {
  var code = this.view.editor.buffer.get(this);
  if (code !== this.code) {
    dom.html(this, code);
    this.code = code;
  }
  this.style();
};

Part.prototype.style = function () {
  dom.style(this, {
    height: (this[1] - this[0] + 1) * this.view.editor.char.height,
    top: this[0] * this.view.editor.char.height - this.view.offset.top
  });
};

Part.prototype.clear = function () {
  dom.style(this, {
    height: 0
  });
  scheduleToRemove(this);
};

var scheduledForRemoval = [];
var removeTimeout;

function scheduleToRemove(el) {
  scheduledForRemoval.push(el);
  clearTimeout(removeTimeout);
  if (scheduledForRemoval.length > 10) {
    return removeScheduled();
  }
  removeTimeout = setTimeout(removeScheduled, 900);
}

function removeScheduled() {
  var el;
  while (el = scheduledForRemoval.pop()) {
    dom.remove(el);
  }
}

},{"../../lib/dom":11,"../../lib/range":19,"../style.css":39,"./view":49}],44:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = FindView;

function FindView(editor) {
  View.call(this, editor);
  this.name = 'find';
  this.dom = dom(css.find);
}

FindView.prototype.__proto__ = View.prototype;

FindView.prototype.use = function (target) {
  dom.append(target, this);
};

FindView.prototype.get = function (range, e) {
  var results = e.findResults;

  var begin = 0;
  var end = results.length;
  var prev = -1;
  var i = -1;

  do {
    prev = i;
    i = begin + (end - begin) / 2 | 0;
    if (results[i].y < range[0] - 1) begin = i;else end = i;
  } while (prev !== i);

  var width = e.findValue.length * e.char.width + 'px';

  var html = '';
  var tabs;
  var r;
  while (results[i] && results[i].y < range[1]) {
    r = results[i++];
    tabs = e.getPointTabs(r);
    html += '<i style="' + 'width:' + width + ';' + 'top:' + r.y * e.char.height + 'px;' + 'left:' + ((r.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.gutter + e.options.margin_left) + 'px;' + '"></i>';
  }

  return html;
};

FindView.prototype.render = function () {
  if (!this.editor.find.isOpen || !this.editor.findResults.length) return;

  var page = this.editor.getPageRange([-.5, +.5]);
  var html = this.get(page, this.editor);

  dom.html(this, html);
};

FindView.prototype.clear = function () {
  dom.html(this, '');
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],45:[function(require,module,exports){
'use strict';

var RulerView = require('./ruler');
var MarkView = require('./mark');
var CodeView = require('./code');
var CaretView = require('./caret');
var BlockView = require('./block');
var FindView = require('./find');
var RowsView = require('./rows');

module.exports = Views;

function Views(editor) {
  var _this = this;

  this.editor = editor;

  this.views = [new RulerView(editor), new MarkView(editor), new CodeView(editor), new CaretView(editor), new BlockView(editor), new FindView(editor), new RowsView(editor)];

  this.views.forEach(function (view) {
    return _this[view.name] = view;
  });
  this.forEach = this.views.forEach.bind(this.views);
}

Views.prototype.use = function (el) {
  this.forEach(function (view) {
    return view.use(el);
  });
};

Views.prototype.render = function () {
  this.forEach(function (view) {
    return view.render();
  });
};

Views.prototype.clear = function () {
  this.forEach(function (view) {
    return view.clear();
  });
};

},{"./block":41,"./caret":42,"./code":43,"./find":44,"./mark":46,"./rows":47,"./ruler":48}],46:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = MarkView;

function MarkView(editor) {
  View.call(this, editor);
  this.name = 'mark';
  this.dom = dom(css.mark);
}

MarkView.prototype.__proto__ = View.prototype;

MarkView.prototype.use = function (target) {
  dom.append(target, this);
};

MarkView.prototype.get = function (range, e) {
  var mark = e.mark.get();
  if (range[0] > mark.end.y) return false;
  if (range[1] < mark.begin.y) return false;

  var offsets = e.buffer.getLineRangeOffsets(range);
  var area = e.buffer.getAreaOffsetRange(mark);
  var code = e.buffer.text.getRange(offsets);

  area[0] -= offsets[0];
  area[1] -= offsets[0];

  var above = code.substring(0, area[0]);
  var middle = code.substring(area[0], area[1]);
  var html = above.replace(/[^\n]/g, ' ') //e.syntax.entities(above)
  + '<mark>' + middle.replace(/[^\n]/g, ' ') + '</mark>';

  html = html.replace(/\n/g, ' \n');

  return html;
};

MarkView.prototype.render = function () {
  if (!this.editor.mark.active) return this.clear();

  var page = this.editor.getPageRange([-.5, +.5]);
  var html = this.get(page, this.editor);

  dom.html(this, html);

  dom.style(this, {
    top: page[0] * this.editor.char.height,
    height: 'auto'
  });
};

MarkView.prototype.clear = function () {
  dom.style(this, {
    top: 0,
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],47:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = RowsView;

function RowsView(editor) {
  View.call(this, editor);
  this.name = 'rows';
  this.dom = dom(css.rows);
  this.rows = -1;
  this.range = [-1, -1];
  this.html = '';
}

RowsView.prototype.__proto__ = View.prototype;

RowsView.prototype.use = function (target) {
  dom.append(target, this);
};

RowsView.prototype.render = function () {
  var range = this.editor.getPageRange([-1, +1]);

  if (range[0] >= this.range[0] && range[1] <= this.range[1] && (this.range[1] !== this.rows || this.editor.rows === this.rows)) return;

  range = this.editor.getPageRange([-3, +3]);
  this.rows = this.editor.rows;
  this.range = range;

  var html = '';
  for (var i = range[0]; i <= range[1]; i++) {
    html += i + 1 + '\n';
  }

  if (html !== this.html) {
    this.html = html;

    dom.html(this, html);

    dom.style(this, {
      top: range[0] * this.editor.char.height,
      height: (range[1] - range[0] + 1) * this.editor.char.height
    });
  }
};

RowsView.prototype.clear = function () {
  dom.style(this, {
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],48:[function(require,module,exports){
'use strict';

var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = RulerView;

function RulerView(editor) {
  View.call(this, editor);
  this.name = 'ruler';
  this.dom = dom(css.ruler);
}

RulerView.prototype.__proto__ = View.prototype;

RulerView.prototype.use = function (target) {
  dom.append(target, this);
};

RulerView.prototype.render = function () {
  dom.style(this, {
    top: 0
  });
};

RulerView.prototype.clear = function () {
  dom.style(this, {
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],49:[function(require,module,exports){
'use strict';

module.exports = View;

function View(editor) {
  this.editor = editor;
}

View.prototype.render = function () {
  throw new Error('render not implemented');
};

View.prototype.clear = function () {
  throw new Error('clear not implemented');
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7O0FBSUEsSUFBSSxpQkFBaUI7QUFDbkIsU0FBTyxTQURZO0FBRW5CLGFBQVcsS0FGUTtBQUduQixlQUFhLE9BSE07QUFJbkIsZ0JBQWMsS0FKSztBQUtuQixnQkFBYyxFQUxLO0FBTW5CLGFBQVcsS0FOUTtBQU9uQixxQkFBbUIsS0FQQTtBQVFuQixtQkFBaUIsS0FSRTtBQVNuQixlQUFhLEVBVE07QUFVbkIsaUJBQWU7QUFWSSxDQUFyQjs7QUFhQSxRQUFRLHFCQUFSO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxVQUFVLFFBQVEsZ0JBQVIsQ0FBZDtBQUNBLElBQUksV0FBVyxRQUFRLGdCQUFSLENBQWY7QUFDQSxJQUFJLFdBQVcsUUFBUSxnQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWOztBQUVBLElBQUksa0JBQWtCLFFBQVEsc0JBQVIsQ0FBdEI7QUFDQSxJQUFJLFVBQVUsUUFBUSxlQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxhQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJLE9BQU8sUUFBUSxrQkFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxNQUFNLFFBQVEsaUJBQVIsQ0FBVjs7QUFFQSxJQUFJLFVBQVUsT0FBTyxNQUFQLENBQWMsQ0FBQyxTQUFELENBQWQsQ0FBZDs7QUFFQSxPQUFPLE9BQVAsR0FBaUIsSUFBakI7O0FBRUEsU0FBUyxJQUFULENBQWMsT0FBZCxFQUF1QjtBQUNyQixPQUFLLE9BQUwsR0FBZSxNQUFNLE1BQU0sY0FBTixDQUFOLEVBQTZCLFdBQVcsRUFBeEMsQ0FBZjs7QUFFQSxTQUFPLE1BQVAsQ0FBYyxJQUFkLEVBQW9CO0FBQ2xCLFFBQUksU0FBUyxzQkFBVCxFQURjOztBQUdsQixRQUFJLFVBQVUsQ0FBQyxLQUFLLE1BQUwsS0FBZ0IsSUFBaEIsR0FBdUIsQ0FBeEIsRUFBMkIsUUFBM0IsQ0FBb0MsRUFBcEMsQ0FISTtBQUlsQixVQUFNLElBQUksSUFBSixFQUpZO0FBS2xCLFVBQU0sSUFBSSxJQUFKLENBQVMsSUFBVCxDQUxZO0FBTWxCLFdBQU8sSUFBSSxLQUFKLENBQVUsSUFBVixDQU5XO0FBT2xCLFdBQU8sSUFBSSxLQUFKLENBQVUsSUFBVixDQVBXO0FBUWxCLGFBQVMsSUFBSSxPQUFKLENBQVksSUFBWixDQVJTOztBQVVsQixjQUFVLE9BQU8sTUFBUCxDQUFjLEVBQWQsRUFBa0IsZUFBbEIsQ0FWUTs7QUFZbEIsVUFBTSxJQUFJLE1BQUosQ0FBVyxNQUFYLEVBQW1CLEtBQUssR0FBeEIsQ0FaWTtBQWFsQixlQUFXLEVBYk87QUFjbEIsZ0JBQVksQ0FkTTtBQWVsQixpQkFBYSxFQWZLOztBQWlCbEIsWUFBUSxJQUFJLEtBQUosRUFqQlU7QUFrQmxCLFlBQVEsSUFBSSxLQUFKLEVBbEJVO0FBbUJsQixVQUFNLElBQUksR0FBSixFQW5CWTtBQW9CbEIsVUFBTSxJQUFJLEdBQUosRUFwQlk7O0FBc0JsQixVQUFNLElBQUksR0FBSixFQXRCWTtBQXVCbEIsZUFBVyxJQUFJLEtBQUosRUF2Qk87QUF3QmxCLG1CQUFlLElBQUksR0FBSixFQXhCRztBQXlCbEIsZ0JBQVksSUFBSSxLQUFKLEVBekJNOztBQTJCbEIsaUJBQWEsQ0EzQks7QUE0QmxCLFlBQVEsQ0E1QlU7QUE2QmxCLFVBQU0sQ0E3Qlk7QUE4QmxCLFVBQU0sQ0E5Qlk7O0FBZ0NsQixhQUFTLENBaENTO0FBaUNsQixTQUFLLElBakNhOztBQW1DbEIsV0FBTyxJQUFJLEtBQUosQ0FBVSxFQUFFLEdBQUcsQ0FBTCxFQUFRLEdBQUcsQ0FBWCxFQUFWLENBbkNXO0FBb0NsQixhQUFTLElBQUksS0FBSixDQUFVLEVBQUUsR0FBRyxDQUFMLEVBQVEsR0FBRyxDQUFYLEVBQVYsQ0FwQ1M7O0FBc0NsQixjQUFVLEtBdENROztBQXdDbEIsVUFBTSxJQUFJLElBQUosQ0FBUztBQUNiLGFBQU8sSUFBSSxLQUFKLENBQVUsRUFBRSxHQUFHLENBQUMsQ0FBTixFQUFTLEdBQUcsQ0FBQyxDQUFiLEVBQVYsQ0FETTtBQUViLFdBQUssSUFBSSxLQUFKLENBQVUsRUFBRSxHQUFHLENBQUMsQ0FBTixFQUFTLEdBQUcsQ0FBQyxDQUFiLEVBQVY7QUFGUSxLQUFULENBeENZOztBQTZDbEIsYUFBUyxLQTdDUztBQThDbEIsY0FBVSxDQUFDLENBOUNPO0FBK0NsQixlQUFXLENBQUMsQ0FBQyxDQUFGLEVBQUksQ0FBQyxDQUFMLENBL0NPO0FBZ0RsQixlQUFXLENBaERPOztBQWtEbEIsa0JBQWMsQ0FsREk7QUFtRGxCLGlCQUFhLEVBbkRLO0FBb0RsQixrQkFBYyxFQXBESTs7QUFzRGxCLG1CQUFlLFFBdERHO0FBdURsQixvQkFBZ0IsQ0FBQyxDQXZEQztBQXdEbEIsc0JBQWtCLEtBeERBO0FBeURsQiwyQkFBdUIsSUF6REw7O0FBMkRsQixpQkFBYSxFQTNESztBQTREbEIsbUJBQWUsSUE1REc7QUE2RGxCLDRCQUF3QixDQUFDO0FBN0RQLEdBQXBCOztBQWdFQTtBQUNBLE9BQUssTUFBTCxHQUFjLEtBQUssSUFBTCxDQUFVLE1BQXhCO0FBQ0EsT0FBSyxNQUFMLENBQVksSUFBWixHQUFtQixLQUFLLElBQXhCO0FBQ0EsT0FBSyxNQUFMLEdBQWMsS0FBSyxNQUFMLENBQVksTUFBMUI7O0FBRUEsUUFBTSxLQUFLLE9BQUwsQ0FBYSxLQUFuQjs7QUFFQSxPQUFLLFdBQUw7QUFDQSxPQUFLLFVBQUw7QUFDRDs7QUFFRCxLQUFLLFNBQUwsQ0FBZSxTQUFmLEdBQTJCLE1BQU0sU0FBakM7O0FBRUEsS0FBSyxTQUFMLENBQWUsR0FBZixHQUFxQixVQUFTLEVBQVQsRUFBYSxRQUFiLEVBQXVCO0FBQzFDLE1BQUksS0FBSyxHQUFULEVBQWM7QUFDWixTQUFLLEVBQUwsQ0FBUSxlQUFSLENBQXdCLElBQXhCO0FBQ0EsU0FBSyxFQUFMLENBQVEsU0FBUixDQUFrQixNQUFsQixDQUF5QixJQUFJLE1BQTdCO0FBQ0EsU0FBSyxFQUFMLENBQVEsU0FBUixDQUFrQixNQUFsQixDQUF5QixLQUFLLE9BQUwsQ0FBYSxLQUF0QztBQUNBLFNBQUssU0FBTDtBQUNBLFNBQUssUUFBTDtBQUNBLFNBQUssR0FBTCxDQUFTLE9BQVQsQ0FBaUIsZUFBTztBQUN0QixVQUFJLE1BQUosQ0FBVyxFQUFYLEVBQWUsR0FBZjtBQUNELEtBRkQ7QUFHRCxHQVRELE1BU087QUFDTCxTQUFLLEdBQUwsR0FBVyxHQUFHLEtBQUgsQ0FBUyxJQUFULENBQWMsS0FBSyxFQUFMLENBQVEsUUFBdEIsQ0FBWDtBQUNBLFFBQUksTUFBSixDQUFXLEVBQVgsRUFBZSxLQUFLLEVBQXBCO0FBQ0EsUUFBSSxRQUFKLENBQWEsS0FBSyxRQUFsQjtBQUNEOztBQUVELE9BQUssRUFBTCxHQUFVLEVBQVY7QUFDQSxPQUFLLEVBQUwsQ0FBUSxZQUFSLENBQXFCLElBQXJCLEVBQTJCLEtBQUssRUFBaEM7QUFDQSxPQUFLLEVBQUwsQ0FBUSxTQUFSLENBQWtCLEdBQWxCLENBQXNCLElBQUksTUFBMUI7QUFDQSxPQUFLLEVBQUwsQ0FBUSxTQUFSLENBQWtCLEdBQWxCLENBQXNCLEtBQUssT0FBTCxDQUFhLEtBQW5DO0FBQ0EsT0FBSyxTQUFMLEdBQWlCLElBQUksUUFBSixDQUFhLFlBQVksS0FBSyxFQUE5QixFQUFrQyxLQUFLLFFBQXZDLENBQWpCO0FBQ0EsT0FBSyxRQUFMLEdBQWdCLElBQUksT0FBSixDQUFZLFlBQVksS0FBSyxFQUE3QixFQUFpQyxLQUFLLE9BQXRDLENBQWhCO0FBQ0EsT0FBSyxLQUFMLENBQVcsR0FBWCxDQUFlLEtBQUssRUFBcEI7QUFDQSxNQUFJLE1BQUosQ0FBVyxLQUFLLEtBQUwsQ0FBVyxLQUF0QixFQUE2QixLQUFLLEtBQUwsQ0FBVyxJQUF4QztBQUNBLE9BQUssS0FBTCxDQUFXLEdBQVgsQ0FBZSxLQUFLLEVBQXBCOztBQUVBLE9BQUssT0FBTDs7QUFFQSxTQUFPLElBQVA7QUFDRCxDQTdCRDs7QUErQkEsS0FBSyxTQUFMLENBQWUsTUFBZixHQUF3QixVQUFTLFFBQVQsRUFBbUI7QUFDekMsT0FBSyxRQUFMLEdBQWdCLFFBQWhCO0FBQ0EsU0FBTyxJQUFQO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxJQUFmLEdBQXNCLFVBQVMsSUFBVCxFQUFlLElBQWYsRUFBcUIsRUFBckIsRUFBeUI7QUFDN0MsT0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsSUFBckIsRUFBMkIsRUFBM0I7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLElBQWYsR0FBc0IsVUFBUyxFQUFULEVBQWE7QUFDakMsT0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLEVBQWY7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLEdBQWYsR0FBcUIsVUFBUyxJQUFULEVBQWUsSUFBZixFQUFxQjtBQUN4QyxPQUFLLElBQUwsQ0FBVSxHQUFWLENBQWMsSUFBZDtBQUNBLE9BQUssSUFBTCxDQUFVLElBQVYsR0FBaUIsUUFBUSxLQUFLLElBQUwsQ0FBVSxJQUFuQztBQUNBLFNBQU8sSUFBUDtBQUNELENBSkQ7O0FBTUEsS0FBSyxTQUFMLENBQWUsS0FBZixHQUF1QixZQUFXO0FBQ2hDLGVBQWEsS0FBSyxLQUFMLENBQVcsS0FBeEI7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLElBQWYsR0FBc0IsWUFBVztBQUMvQixlQUFhLEtBQUssS0FBTCxDQUFXLElBQXhCO0FBQ0EsU0FBTyxJQUFQO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxXQUFmLEdBQTZCLFlBQVc7QUFDdEMsT0FBSyxvQkFBTCxHQUE0QixLQUFLLG9CQUFMLENBQTBCLElBQTFCLENBQStCLElBQS9CLENBQTVCO0FBQ0EsT0FBSyxvQkFBTCxHQUE0QixLQUFLLG9CQUFMLENBQTBCLElBQTFCLENBQStCLElBQS9CLENBQTVCO0FBQ0EsT0FBSyxPQUFMLEdBQWUsS0FBSyxPQUFMLENBQWEsSUFBYixDQUFrQixJQUFsQixDQUFmO0FBQ0EsT0FBSyxTQUFMLEdBQWlCLEtBQUssU0FBTCxDQUFlLElBQWYsQ0FBb0IsSUFBcEIsQ0FBakI7QUFDQSxPQUFLLEtBQUwsR0FBYSxLQUFLLEtBQUwsQ0FBVyxJQUFYLENBQWdCLElBQWhCLENBQWI7QUFDQSxPQUFLLE9BQUwsR0FBZSxLQUFLLE9BQUwsQ0FBYSxJQUFiLENBQWtCLElBQWxCLENBQWYsQ0FOc0MsQ0FNRTtBQUN4QyxPQUFLLE9BQUwsR0FBZSxLQUFLLE9BQUwsQ0FBYSxJQUFiLENBQWtCLElBQWxCLENBQWY7QUFDRCxDQVJEOztBQVVBLEtBQUssU0FBTCxDQUFlLFlBQWYsR0FBOEIsWUFBVztBQUN2QyxPQUFLLElBQUksTUFBVCxJQUFtQixJQUFuQixFQUF5QjtBQUN2QixRQUFJLFNBQVMsT0FBTyxLQUFQLENBQWEsQ0FBYixFQUFnQixDQUFoQixDQUFiLEVBQWlDO0FBQy9CLFdBQUssTUFBTCxJQUFlLEtBQUssTUFBTCxFQUFhLElBQWIsQ0FBa0IsSUFBbEIsQ0FBZjtBQUNEO0FBQ0Y7QUFDRCxPQUFLLE9BQUwsR0FBZSxTQUFTLEtBQUssT0FBZCxFQUF1QixFQUF2QixDQUFmO0FBQ0QsQ0FQRDs7QUFTQSxLQUFLLFNBQUwsQ0FBZSxVQUFmLEdBQTRCLFlBQVc7QUFDckMsT0FBSyxZQUFMO0FBQ0EsT0FBSyxJQUFMLENBQVUsRUFBVixDQUFhLE1BQWIsRUFBcUIsS0FBSyxNQUExQjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxLQUFiLEVBQW9CLEtBQUssU0FBekIsRUFIcUMsQ0FHQTtBQUNyQyxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsS0FBYixFQUFvQixLQUFLLFNBQXpCO0FBQ0EsT0FBSyxJQUFMLENBQVUsRUFBVixDQUFhLE1BQWIsRUFBcUIsS0FBSyxVQUExQjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxRQUFiLEVBQXVCLEtBQUssWUFBNUI7QUFDQSxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsZUFBYixFQUE4QixLQUFLLGtCQUFuQztBQUNBLE9BQUssT0FBTCxDQUFhLEVBQWIsQ0FBZ0IsUUFBaEIsRUFBMEIsS0FBSyxlQUEvQjtBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxNQUFkLEVBQXNCLEtBQUssTUFBM0I7QUFDQSxPQUFLLEtBQUwsQ0FBVyxFQUFYLENBQWMsT0FBZCxFQUF1QixLQUFLLE9BQTVCO0FBQ0EsT0FBSyxLQUFMLENBQVcsRUFBWCxDQUFjLE9BQWQsRUFBdUIsS0FBSyxPQUE1QjtBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxNQUFkLEVBQXNCLEtBQUssTUFBM0I7QUFDQSxPQUFLLEtBQUwsQ0FBVyxFQUFYLENBQWMsTUFBZCxFQUFzQixLQUFLLE1BQTNCO0FBQ0EsT0FBSyxLQUFMLENBQVcsRUFBWCxDQUFjLEtBQWQsRUFBcUIsS0FBSyxLQUExQjtBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxLQUFkLEVBQXFCLEtBQUssS0FBMUI7QUFDQSxPQUFLLEtBQUwsQ0FBVyxFQUFYLENBQWMsTUFBZCxFQUFzQixLQUFLLE1BQTNCO0FBQ0EsT0FBSyxLQUFMLENBQVcsRUFBWCxDQUFjLE9BQWQsRUFBdUIsS0FBSyxPQUE1QjtBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxTQUFkLEVBQXlCLEtBQUssU0FBOUI7QUFDQSxPQUFLLEtBQUwsQ0FBVyxFQUFYLENBQWMsV0FBZCxFQUEyQixLQUFLLFdBQWhDO0FBQ0EsT0FBSyxLQUFMLENBQVcsRUFBWCxDQUFjLFlBQWQsRUFBNEIsS0FBSyxZQUFqQztBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxnQkFBZCxFQUFnQyxLQUFLLGdCQUFyQztBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxXQUFkLEVBQTJCLEtBQUssV0FBaEM7QUFDQSxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsUUFBYixFQUF1QixLQUFLLFFBQUwsQ0FBYyxJQUFkLENBQW1CLElBQW5CLEVBQXlCLENBQXpCLENBQXZCO0FBQ0EsT0FBSyxJQUFMLENBQVUsRUFBVixDQUFhLE9BQWIsRUFBc0IsS0FBSyxXQUEzQjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxLQUFiLEVBQW9CLEtBQUssU0FBekI7QUFDQSxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsTUFBYixFQUFxQixLQUFLLFVBQTFCO0FBQ0EsT0FBSyxJQUFMLENBQVUsRUFBVixDQUFhLE9BQWIsRUFBc0IsS0FBSyxXQUEzQjtBQUNELENBNUJEOztBQThCQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFVBQVMsTUFBVCxFQUFpQjtBQUN6QyxPQUFLLE1BQUwsQ0FBWSxHQUFaLENBQWdCLE1BQWhCO0FBQ0EsT0FBSyxNQUFMLENBQVksTUFBWjtBQUNBLE9BQUssTUFBTCxDQUFZLE1BQVo7QUFDQSxPQUFLLE1BQUwsQ0FBWSxNQUFaO0FBQ0EsT0FBSyxNQUFMLENBQVksTUFBWjtBQUNBLE9BQUssSUFBTDtBQUNELENBUEQ7O0FBU0EsS0FBSyxTQUFMLENBQWUsT0FBZixHQUF5QixVQUFTLEtBQVQsRUFBZ0I7QUFDdkMsT0FBSyxlQUFMLENBQXFCLE1BQU0sTUFBM0IsRUFBbUMsTUFBTSxNQUFOLEdBQWUsR0FBbEQsRUFBdUQsTUFBdkQ7QUFDRCxDQUZEOztBQUlBLEtBQUssU0FBTCxDQUFlLElBQWYsR0FBc0IsU0FBUyxZQUFXO0FBQ3hDLE9BQUssT0FBTCxHQUFlLEtBQWY7QUFDRCxDQUZxQixFQUVuQixHQUZtQixDQUF0Qjs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsS0FBVCxFQUFnQixNQUFoQixFQUF3QjtBQUM5QyxNQUFJLENBQUMsTUFBTCxFQUFhLEtBQUssT0FBTCxHQUFlLEtBQWY7QUFDYixNQUFJLEtBQUosRUFBVyxLQUFLLFFBQUwsQ0FBYyxLQUFkOztBQUVYLE1BQUksQ0FBQyxNQUFMLEVBQWE7QUFDWCxRQUFJLEtBQUssS0FBTCxDQUFXLElBQVgsQ0FBZ0IsU0FBaEIsQ0FBMEIsS0FBMUIsSUFBbUMsS0FBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixJQUF4RCxFQUE4RDtBQUM1RCxXQUFLLE9BQUw7QUFDRCxLQUZELE1BRU87QUFDTCxXQUFLLFNBQUw7QUFDRDtBQUNGOztBQUVELE9BQUssSUFBTCxDQUFVLE1BQVY7QUFDQSxPQUFLLElBQUwsQ0FBVSxPQUFWLEVBQW1CLEVBQW5CLEVBQXVCLEtBQUssS0FBTCxDQUFXLElBQVgsRUFBdkIsRUFBMEMsS0FBSyxJQUFMLENBQVUsSUFBVixFQUExQyxFQUE0RCxLQUFLLElBQUwsQ0FBVSxNQUF0RTtBQUNBLE9BQUssVUFBTDtBQUNBLE9BQUssSUFBTDs7QUFFQSxPQUFLLE1BQUwsQ0FBWSxPQUFaO0FBQ0EsT0FBSyxNQUFMLENBQVksT0FBWjtBQUNELENBbkJEOztBQXFCQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFlBQVc7QUFDbkMsT0FBSyxPQUFMO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxPQUFmLEdBQXlCLFVBQVMsSUFBVCxFQUFlO0FBQ3RDLE9BQUssUUFBTCxHQUFnQixJQUFoQjtBQUNBLE9BQUssSUFBTCxDQUFVLE9BQVY7QUFDQSxPQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLE1BQWpCO0FBQ0EsT0FBSyxVQUFMO0FBQ0QsQ0FMRDs7QUFPQSxLQUFLLFNBQUwsQ0FBZSxVQUFmLEdBQTRCLFlBQVc7QUFDckMsTUFBSSxPQUFKLENBQVksS0FBSyxLQUFMLENBQVcsS0FBdkIsRUFBOEIsQ0FBQyxJQUFJLEtBQUwsQ0FBOUI7QUFDQSxPQUFLLFVBQUw7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLFVBQWYsR0FBNEIsU0FBUyxZQUFXO0FBQzlDLE1BQUksT0FBSixDQUFZLEtBQUssS0FBTCxDQUFXLEtBQXZCLEVBQThCLENBQUMsSUFBSSxLQUFMLEVBQVksSUFBSSxjQUFKLENBQVosQ0FBOUI7QUFDRCxDQUYyQixFQUV6QixHQUZ5QixDQUE1Qjs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsSUFBVCxFQUFlO0FBQUE7O0FBQ3JDLE9BQUssUUFBTCxHQUFnQixLQUFoQjtBQUNBLGFBQVcsWUFBTTtBQUNmLFFBQUksQ0FBQyxNQUFLLFFBQVYsRUFBb0I7QUFDbEIsVUFBSSxPQUFKLENBQVksTUFBSyxLQUFMLENBQVcsS0FBdkIsRUFBOEIsQ0FBQyxJQUFJLEtBQUwsQ0FBOUI7QUFDQSxZQUFLLElBQUwsQ0FBVSxNQUFWO0FBQ0EsWUFBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixNQUFqQjtBQUNEO0FBQ0YsR0FORCxFQU1HLENBTkg7QUFPRCxDQVREOztBQVdBLEtBQUssU0FBTCxDQUFlLE9BQWYsR0FBeUIsVUFBUyxJQUFULEVBQWUsQ0FDdkMsQ0FERDs7QUFHQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsSUFBVCxFQUFlO0FBQ3JDLE9BQUssV0FBTCxHQUFtQixFQUFuQjtBQUNBLE9BQUssTUFBTCxDQUFZLElBQVo7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsVUFBUyxJQUFULEVBQWUsQ0FBZixFQUFrQjtBQUN4QyxNQUFJLFFBQVEsS0FBSyxRQUFqQixFQUEyQjtBQUN6QixNQUFFLGNBQUY7QUFDQSxTQUFLLFFBQUwsQ0FBYyxJQUFkLEVBQW9CLElBQXBCLENBQXlCLElBQXpCLEVBQStCLENBQS9CO0FBQ0QsR0FIRCxNQUlLLElBQUksUUFBUSxlQUFaLEVBQTZCO0FBQ2hDLE1BQUUsY0FBRjtBQUNBLG9CQUFnQixJQUFoQixFQUFzQixJQUF0QixDQUEyQixJQUEzQixFQUFpQyxDQUFqQztBQUNEO0FBQ0YsQ0FURDs7QUFXQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLEdBQXVCLFVBQVMsR0FBVCxFQUFjLENBQWQsRUFBaUI7QUFDdEMsTUFBSSxPQUFPLEtBQUssUUFBTCxDQUFjLE1BQXpCLEVBQWlDO0FBQy9CLE1BQUUsY0FBRjtBQUNBLFNBQUssUUFBTCxDQUFjLE1BQWQsQ0FBcUIsR0FBckIsRUFBMEIsSUFBMUIsQ0FBK0IsSUFBL0IsRUFBcUMsQ0FBckM7QUFDRCxHQUhELE1BSUssSUFBSSxPQUFPLGdCQUFnQixNQUEzQixFQUFtQztBQUN0QyxNQUFFLGNBQUY7QUFDQSxvQkFBZ0IsTUFBaEIsQ0FBdUIsR0FBdkIsRUFBNEIsSUFBNUIsQ0FBaUMsSUFBakMsRUFBdUMsQ0FBdkM7QUFDRDtBQUNGLENBVEQ7O0FBV0EsS0FBSyxTQUFMLENBQWUsS0FBZixHQUF1QixVQUFTLENBQVQsRUFBWTtBQUNqQyxNQUFJLENBQUMsS0FBSyxJQUFMLENBQVUsTUFBZixFQUF1QjtBQUN2QixPQUFLLE1BQUwsQ0FBWSxDQUFaO0FBQ0EsT0FBSyxNQUFMO0FBQ0QsQ0FKRDs7QUFNQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsQ0FBVCxFQUFZO0FBQ2xDLE1BQUksQ0FBQyxLQUFLLElBQUwsQ0FBVSxNQUFmLEVBQXVCO0FBQ3ZCLE1BQUksT0FBTyxLQUFLLElBQUwsQ0FBVSxHQUFWLEVBQVg7QUFDQSxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksV0FBWixDQUF3QixJQUF4QixDQUFYO0FBQ0EsSUFBRSxhQUFGLENBQWdCLE9BQWhCLENBQXdCLFlBQXhCLEVBQXNDLElBQXRDO0FBQ0QsQ0FMRDs7QUFPQSxLQUFLLFNBQUwsQ0FBZSxPQUFmLEdBQXlCLFVBQVMsQ0FBVCxFQUFZO0FBQ25DLE1BQUksT0FBTyxFQUFFLGFBQUYsQ0FBZ0IsT0FBaEIsQ0FBd0IsWUFBeEIsQ0FBWDtBQUNBLE9BQUssTUFBTCxDQUFZLElBQVo7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLFVBQWYsR0FBNEIsWUFBVztBQUNyQyxPQUFLLElBQUwsQ0FBVSxXQUFWO0FBQ0EsT0FBSyxPQUFMO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxTQUFmLEdBQTJCLFVBQVMsR0FBVCxFQUFjO0FBQ3ZDO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxVQUFmLEdBQTRCLFVBQVMsSUFBVCxFQUFlO0FBQ3pDLE1BQUksU0FBUyxJQUFiLEVBQW1CO0FBQ2pCLFNBQUssR0FBTCxHQUFXLElBQVg7QUFDRCxHQUZELE1BRU87QUFDTCxTQUFLLEdBQUwsR0FBVyxJQUFJLEtBQUosQ0FBVSxLQUFLLE9BQUwsR0FBZSxDQUF6QixFQUE0QixJQUE1QixDQUFpQyxJQUFqQyxDQUFYO0FBQ0Q7QUFDRixDQU5EOztBQVFBLEtBQUssU0FBTCxDQUFlLFNBQWYsR0FBMkIsWUFBVztBQUNwQyxPQUFLLFFBQUwsQ0FBYyxFQUFFLEdBQUUsQ0FBSixFQUFPLEdBQUUsQ0FBVCxFQUFkO0FBQ0EsT0FBSyxXQUFMO0FBQ0EsT0FBSyxPQUFMLENBQWEsSUFBYjtBQUNELENBSkQ7O0FBTUEsS0FBSyxTQUFMLENBQWUsZUFBZixHQUFpQyxZQUFXO0FBQzFDLE9BQUssTUFBTCxDQUFZLE1BQVo7QUFDQSxPQUFLLE1BQUwsQ0FBWSxNQUFaO0FBQ0EsT0FBSyxNQUFMLENBQVksT0FBWjtBQUNBLE9BQUssV0FBTDtBQUNBLE9BQUssSUFBTCxDQUFVLGdCQUFWO0FBQ0QsQ0FORDs7QUFRQSxLQUFLLFNBQUwsQ0FBZSxrQkFBZixHQUFvQyxZQUFXO0FBQzdDLE9BQUssT0FBTCxDQUFhLElBQWI7QUFDQSxPQUFLLGVBQUwsR0FBdUIsS0FBSyxLQUFMLENBQVcsSUFBWCxFQUF2QjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsWUFBZixHQUE4QixVQUFTLFNBQVQsRUFBb0IsU0FBcEIsRUFBK0IsVUFBL0IsRUFBMkMsU0FBM0MsRUFBc0Q7QUFDbEYsT0FBSyxnQkFBTCxHQUF3QixLQUF4QjtBQUNBLE9BQUssT0FBTCxHQUFlLElBQWY7QUFDQSxPQUFLLElBQUwsR0FBWSxLQUFLLE1BQUwsQ0FBWSxHQUFaLEVBQVo7QUFDQSxPQUFLLFVBQUwsR0FBa0IsQ0FBQyxDQUFELEVBQUksS0FBSyxJQUFULENBQWxCOztBQUVBLE1BQUksS0FBSyxJQUFMLENBQVUsTUFBZCxFQUFzQjtBQUNwQixTQUFLLFdBQUwsQ0FBaUIsS0FBSyxTQUF0QixFQUFpQyxJQUFqQztBQUNEOztBQUVELE9BQUssT0FBTCxDQUFhLElBQWI7O0FBRUEsT0FBSyxLQUFMLENBQVcsSUFBWCxDQUFnQixVQUFoQixDQUEyQjtBQUN6QixVQUFNLFVBQVUsQ0FBVixDQURtQjtBQUV6QixXQUFPLFNBRmtCO0FBR3pCLFdBQU8sU0FIa0I7QUFJekIsY0FBVSxLQUFLLEtBSlU7QUFLekIsaUJBQWEsS0FBSztBQUxPLEdBQTNCOztBQVFBLE9BQUssTUFBTCxDQUFZLE9BQVo7QUFDQSxPQUFLLE1BQUwsQ0FBWSxNQUFaO0FBQ0EsT0FBSyxNQUFMLENBQVksTUFBWjtBQUNBLE9BQUssTUFBTCxDQUFZLE1BQVo7QUFDQSxPQUFLLE1BQUwsQ0FBWSxPQUFaO0FBQ0EsT0FBSyxNQUFMLENBQVksT0FBWjs7QUFFQSxPQUFLLElBQUwsQ0FBVSxRQUFWO0FBQ0QsQ0E1QkQ7O0FBOEJBLEtBQUssU0FBTCxDQUFlLGNBQWYsR0FBZ0MsVUFBUyxFQUFULEVBQWE7QUFDM0MsTUFBSSxJQUFJLElBQUksS0FBSixDQUFVLEVBQUUsR0FBRyxLQUFLLFVBQVYsRUFBc0IsR0FBRyxLQUFLLElBQUwsQ0FBVSxNQUFWLEdBQWlCLENBQTFDLEVBQVYsRUFBeUQsR0FBekQsRUFBOEQsS0FBSyxNQUFuRSxDQUFSO0FBQ0EsTUFBSSxLQUFLLE9BQUwsQ0FBYSxlQUFqQixFQUFrQyxFQUFFLENBQUYsSUFBTyxLQUFLLElBQUwsQ0FBVSxNQUFWLEdBQW1CLENBQW5CLEdBQXVCLENBQTlCO0FBQ2xDLE1BQUksSUFBSSxHQUFHLEdBQUgsRUFBUSxDQUFSLEVBQVcsR0FBWCxFQUFnQixLQUFLLE1BQXJCLEVBQTZCLElBQTdCLEVBQW1DLEtBQUssSUFBeEMsQ0FBUjs7QUFFQSxJQUFFLENBQUYsR0FBTSxLQUFLLEdBQUwsQ0FBUyxDQUFULEVBQVksS0FBSyxHQUFMLENBQVMsRUFBRSxDQUFYLEVBQWMsS0FBSyxNQUFMLENBQVksR0FBWixFQUFkLENBQVosQ0FBTjtBQUNBLElBQUUsQ0FBRixHQUFNLEtBQUssR0FBTCxDQUFTLENBQVQsRUFBWSxFQUFFLENBQWQsQ0FBTjs7QUFFQSxNQUFJLE9BQU8sS0FBSyxhQUFMLENBQW1CLENBQW5CLENBQVg7O0FBRUEsSUFBRSxDQUFGLEdBQU0sS0FBSyxHQUFMLENBQ0osQ0FESSxFQUVKLEtBQUssR0FBTCxDQUNFLEVBQUUsQ0FBRixHQUFNLEtBQUssSUFBWCxHQUFrQixLQUFLLFNBRHpCLEVBRUUsS0FBSyxhQUFMLENBQW1CLEVBQUUsQ0FBckIsQ0FGRixDQUZJLENBQU47O0FBUUEsT0FBSyxRQUFMLENBQWMsQ0FBZDtBQUNBLE9BQUssSUFBTCxDQUFVLGVBQVYsR0FBNEIsRUFBRSxDQUE5QjtBQUNBLE9BQUssTUFBTDs7QUFFQSxTQUFPLENBQVA7QUFDRCxDQXZCRDs7QUF5QkEsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixZQUFXO0FBQUE7O0FBQ3BDLGFBQVcsWUFBTTtBQUNmLFFBQUksQ0FBQyxPQUFLLFFBQVYsRUFBb0IsT0FBSyxJQUFMO0FBQ3JCLEdBRkQsRUFFRyxDQUZIO0FBR0QsQ0FKRDs7QUFNQSxLQUFLLFNBQUwsQ0FBZSxXQUFmLEdBQTZCLFlBQVc7QUFDdEMsYUFBVyxLQUFLLEtBQUwsQ0FBVyxJQUFYLENBQWdCLElBQWhCLENBQVgsRUFBa0MsRUFBbEM7QUFDQSxNQUFJLEtBQUssS0FBTCxDQUFXLElBQVgsQ0FBZ0IsU0FBaEIsQ0FBMEIsS0FBOUIsRUFBcUMsS0FBSyxTQUFMLEdBQXJDLEtBQ0ssS0FBSyxTQUFMO0FBQ0wsT0FBSyxjQUFMLENBQW9CLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsS0FBckM7QUFDRCxDQUxEOztBQU9BLEtBQUssU0FBTCxDQUFlLFFBQWYsR0FBMEIsVUFBUyxDQUFULEVBQVksTUFBWixFQUFvQixPQUFwQixFQUE2QjtBQUNyRCxPQUFLLEtBQUwsQ0FBVyxHQUFYLENBQWUsQ0FBZjs7QUFFQSxNQUFJLE9BQU8sS0FBSyxZQUFMLENBQWtCLEtBQUssS0FBdkIsQ0FBWDs7QUFFQSxPQUFLLE9BQUwsQ0FBYSxHQUFiLENBQWlCO0FBQ2YsT0FBRyxLQUFLLElBQUwsQ0FBVSxLQUFWLElBQW1CLEtBQUssS0FBTCxDQUFXLENBQVgsR0FBZSxLQUFLLElBQUwsR0FBWSxLQUFLLE9BQWhDLEdBQTBDLEtBQUssU0FBbEUsQ0FEWTtBQUVmLE9BQUcsS0FBSyxJQUFMLENBQVUsTUFBVixHQUFtQixLQUFLLEtBQUwsQ0FBVztBQUZsQixHQUFqQjs7QUFLQSxPQUFLLFdBQUwsQ0FBaUIsTUFBakIsRUFBeUIsT0FBekI7QUFDRCxDQVhEOztBQWFBLEtBQUssU0FBTCxDQUFlLFlBQWYsR0FBOEIsWUFBVztBQUN2QyxNQUFJLFNBQVMsS0FBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixNQUE5QjtBQUNBLE1BQUksU0FBUyxDQUFiLEVBQWdCO0FBQ2QsUUFBSSxJQUFKOztBQUVBLFFBQUksV0FBVyxDQUFmLEVBQWtCO0FBQ2hCLGFBQU8sS0FBSyxNQUFMLENBQVksZUFBWixDQUE0QixLQUFLLEtBQWpDLENBQVA7QUFDRCxLQUZELE1BRU8sSUFBSSxXQUFXLENBQWYsRUFBa0I7QUFDdkIsVUFBSSxJQUFJLEtBQUssS0FBTCxDQUFXLENBQW5CO0FBQ0EsYUFBTyxJQUFJLElBQUosQ0FBUztBQUNkLGVBQU8sRUFBRSxHQUFHLENBQUwsRUFBUSxHQUFHLENBQVgsRUFETztBQUVkLGFBQUssRUFBRSxHQUFHLEtBQUssYUFBTCxDQUFtQixDQUFuQixDQUFMLEVBQTRCLEdBQUcsQ0FBL0I7QUFGUyxPQUFULENBQVA7QUFJRDs7QUFFRCxRQUFJLElBQUosRUFBVTtBQUNSLFdBQUssUUFBTCxDQUFjLEtBQUssR0FBbkI7QUFDQSxXQUFLLFdBQUwsQ0FBaUIsSUFBakI7QUFDRDtBQUNGO0FBQ0YsQ0FwQkQ7O0FBc0JBLEtBQUssU0FBTCxDQUFlLGdCQUFmLEdBQWtDLFlBQVc7QUFDM0MsT0FBSyxTQUFMO0FBQ0EsT0FBSyxjQUFMLENBQW9CLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsSUFBckM7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLFdBQWYsR0FBNkIsWUFBVztBQUN0QyxPQUFLLGNBQUwsQ0FBb0IsS0FBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixLQUFyQztBQUNELENBRkQ7O0FBSUEsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixVQUFTLElBQVQsRUFBZTtBQUN4QyxNQUFJLENBQUMsS0FBSyxJQUFMLENBQVUsTUFBZixFQUF1QjtBQUNyQixTQUFLLElBQUwsQ0FBVSxNQUFWLEdBQW1CLElBQW5CO0FBQ0EsUUFBSSxJQUFKLEVBQVU7QUFDUixXQUFLLElBQUwsQ0FBVSxHQUFWLENBQWMsSUFBZDtBQUNELEtBRkQsTUFFTyxJQUFJLFNBQVMsS0FBVCxJQUFrQixLQUFLLElBQUwsQ0FBVSxLQUFWLENBQWdCLENBQWhCLEtBQXNCLENBQUMsQ0FBN0MsRUFBZ0Q7QUFDckQsV0FBSyxJQUFMLENBQVUsS0FBVixDQUFnQixHQUFoQixDQUFvQixLQUFLLEtBQXpCO0FBQ0EsV0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLEdBQWQsQ0FBa0IsS0FBSyxLQUF2QjtBQUNEO0FBQ0Y7QUFDRixDQVZEOztBQVlBLEtBQUssU0FBTCxDQUFlLE9BQWYsR0FBeUIsWUFBVztBQUNsQyxNQUFJLEtBQUssSUFBTCxDQUFVLE1BQWQsRUFBc0I7QUFDcEIsU0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLEdBQWQsQ0FBa0IsS0FBSyxLQUF2QjtBQUNBLFNBQUssTUFBTCxDQUFZLE1BQVo7QUFDRDtBQUNGLENBTEQ7O0FBT0EsS0FBSyxTQUFMLENBQWUsV0FBZixHQUE2QixVQUFTLElBQVQsRUFBZTtBQUMxQyxPQUFLLFNBQUwsQ0FBZSxJQUFmO0FBQ0EsT0FBSyxNQUFMLENBQVksTUFBWjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixVQUFTLEtBQVQsRUFBZ0I7QUFDekMsTUFBSSxLQUFLLEtBQUwsQ0FBVyxJQUFYLENBQWdCLFNBQWhCLENBQTBCLEtBQTFCLElBQW1DLENBQUMsS0FBeEMsRUFBK0M7O0FBRS9DLE9BQUssSUFBTCxDQUFVLE1BQVYsR0FBbUIsS0FBbkI7QUFDQSxPQUFLLElBQUwsQ0FBVSxHQUFWLENBQWM7QUFDWixXQUFPLElBQUksS0FBSixDQUFVLEVBQUUsR0FBRyxDQUFDLENBQU4sRUFBUyxHQUFHLENBQUMsQ0FBYixFQUFWLENBREs7QUFFWixTQUFLLElBQUksS0FBSixDQUFVLEVBQUUsR0FBRyxDQUFDLENBQU4sRUFBUyxHQUFHLENBQUMsQ0FBYixFQUFWO0FBRk8sR0FBZDtBQUlBLE9BQUssS0FBTCxDQUFXLE1BQVg7QUFDRCxDQVREOztBQVdBLEtBQUssU0FBTCxDQUFlLFFBQWYsR0FBMEIsVUFBUyxLQUFULEVBQWdCO0FBQ3hDLFNBQU8sTUFBTSxLQUFOLENBQVksS0FBWixFQUFtQixLQUFLLFVBQXhCLENBQVA7QUFDRCxDQUZEOztBQUlBLEtBQUssU0FBTCxDQUFlLFlBQWYsR0FBOEIsVUFBUyxLQUFULEVBQWdCO0FBQzVDLE1BQUksSUFBSSxLQUFLLE1BQUwsQ0FBWSxJQUFaLEVBQVI7QUFDQSxNQUFJLEtBQUssT0FBTCxDQUFhLGVBQWpCLEVBQWtDO0FBQ2hDLE1BQUUsQ0FBRixJQUFPLEtBQUssSUFBTCxDQUFVLE1BQVYsR0FBbUIsQ0FBbkIsR0FBdUIsQ0FBOUI7QUFDRDtBQUNELE1BQUksSUFBSSxFQUFFLElBQUYsRUFBUSxLQUFLLElBQWIsQ0FBUjtBQUNBLFNBQU8sS0FBSyxRQUFMLENBQWMsQ0FDbkIsS0FBSyxLQUFMLENBQVcsRUFBRSxDQUFGLEdBQU0sS0FBSyxJQUFMLENBQVUsTUFBVixHQUFtQixNQUFNLENBQU4sQ0FBcEMsQ0FEbUIsRUFFbkIsS0FBSyxJQUFMLENBQVUsRUFBRSxDQUFGLEdBQU0sS0FBSyxJQUFMLENBQVUsTUFBaEIsR0FBeUIsS0FBSyxJQUFMLENBQVUsTUFBVixHQUFtQixNQUFNLENBQU4sQ0FBdEQsQ0FGbUIsQ0FBZCxDQUFQO0FBSUQsQ0FWRDs7QUFZQSxLQUFLLFNBQUwsQ0FBZSxhQUFmLEdBQStCLFVBQVMsQ0FBVCxFQUFZO0FBQ3pDLFNBQU8sS0FBSyxNQUFMLENBQVksT0FBWixDQUFvQixDQUFwQixFQUF1QixNQUE5QjtBQUNELENBRkQ7O0FBSUEsS0FBSyxTQUFMLENBQWUsV0FBZixHQUE2QixVQUFTLE1BQVQsRUFBaUIsT0FBakIsRUFBMEI7QUFDckQsTUFBSSxJQUFJLEtBQUssT0FBYjtBQUNBLE1BQUksSUFBSSxLQUFLLHFCQUFMLElBQThCLEtBQUssTUFBM0M7O0FBRUEsTUFBSSxNQUNBLEVBQUUsQ0FBRixJQUNDLFVBQVUsQ0FBQyxLQUFLLE9BQUwsQ0FBYSxlQUF4QixHQUEwQyxDQUFDLEtBQUssSUFBTCxDQUFVLE1BQVYsR0FBbUIsQ0FBbkIsR0FBdUIsQ0FBeEIsSUFBNkIsR0FBdkUsR0FBNkUsQ0FEOUUsQ0FETSxHQUdOLEVBQUUsQ0FITjs7QUFLQSxNQUFJLFNBQVMsRUFBRSxDQUFGLElBQ1QsRUFBRSxDQUFGLEdBQ0EsS0FBSyxJQUFMLENBQVUsTUFEVixJQUVDLFVBQVUsQ0FBQyxLQUFLLE9BQUwsQ0FBYSxlQUF4QixHQUEwQyxDQUFDLEtBQUssSUFBTCxDQUFVLE1BQVYsR0FBbUIsQ0FBbkIsR0FBdUIsQ0FBeEIsSUFBNkIsR0FBdkUsR0FBNkUsQ0FGOUUsS0FHQyxLQUFLLE9BQUwsQ0FBYSxlQUFiLEdBQWdDLEtBQUssSUFBTCxDQUFVLE1BQVYsR0FBbUIsQ0FBbkIsR0FBdUIsQ0FBdkIsR0FBMkIsQ0FBM0QsR0FBZ0UsQ0FIakUsQ0FEUyxJQUtULEtBQUssSUFBTCxDQUFVLE1BTGQ7O0FBT0EsTUFBSSxPQUFRLEVBQUUsQ0FBRixHQUFNLEtBQUssSUFBTCxDQUFVLEtBQWpCLEdBQTBCLEVBQUUsQ0FBdkM7QUFDQSxNQUFJLFFBQVMsRUFBRSxDQUFILElBQVMsRUFBRSxDQUFGLEdBQU0sS0FBSyxJQUFMLENBQVUsS0FBaEIsR0FBd0IsS0FBSyxVQUF0QyxJQUFvRCxLQUFLLElBQUwsQ0FBVSxLQUFWLEdBQWtCLENBQWxGOztBQUVBLE1BQUksU0FBUyxDQUFiLEVBQWdCLFNBQVMsQ0FBVDtBQUNoQixNQUFJLE1BQU0sQ0FBVixFQUFhLE1BQU0sQ0FBTjtBQUNiLE1BQUksT0FBTyxDQUFYLEVBQWMsT0FBTyxDQUFQO0FBQ2QsTUFBSSxRQUFRLENBQVosRUFBZSxRQUFRLENBQVI7O0FBRWYsTUFBSSxPQUFPLEdBQVAsR0FBYSxLQUFiLEdBQXFCLE1BQXpCLEVBQWlDO0FBQy9CLFNBQUssVUFBVSxpQkFBVixHQUE4QixVQUFuQyxFQUErQyxRQUFRLElBQXZELEVBQTZELFNBQVMsR0FBdEUsRUFBMkUsTUFBM0U7QUFDRDtBQUNGLENBM0JEOztBQTZCQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFVBQVMsQ0FBVCxFQUFZO0FBQ3BDLE1BQUksUUFBSixDQUFhLEtBQUssRUFBbEIsRUFBc0IsRUFBRSxDQUF4QixFQUEyQixFQUFFLENBQTdCO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZTtBQUN2QyxNQUFJLFNBQVMsTUFBTSxHQUFOLENBQVU7QUFDckIsT0FBRyxDQURrQjtBQUVyQixPQUFHO0FBRmtCLEdBQVYsRUFHVjtBQUNELE9BQUcsS0FBSyxNQUFMLENBQVksQ0FBWixHQUFnQixDQURsQjtBQUVELE9BQUcsS0FBSyxNQUFMLENBQVksQ0FBWixHQUFnQjtBQUZsQixHQUhVLENBQWI7O0FBUUEsTUFBSSxNQUFNLElBQU4sQ0FBVyxNQUFYLEVBQW1CLEtBQUssTUFBeEIsTUFBb0MsQ0FBeEMsRUFBMkM7QUFDekMsU0FBSyxNQUFMLENBQVksR0FBWixDQUFnQixNQUFoQjtBQUNBLFNBQUssUUFBTCxDQUFjLEtBQUssTUFBbkI7QUFDRDtBQUNGLENBYkQ7O0FBZUEsS0FBSyxTQUFMLENBQWUsZUFBZixHQUFpQyxVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWUsYUFBZixFQUE4QjtBQUM3RCxPQUFLLGFBQUwsR0FBcUIsaUJBQWlCLFFBQXRDOztBQUVBLE1BQUksQ0FBQyxLQUFLLGdCQUFWLEVBQTRCO0FBQzFCLFFBQUksYUFBYSxLQUFLLGFBQXRCLEVBQXFDO0FBQ25DLFdBQUssV0FBTDtBQUNEO0FBQ0QsU0FBSyxnQkFBTCxHQUF3QixJQUF4QjtBQUNBLFNBQUssY0FBTCxHQUFzQixPQUFPLHFCQUFQLENBQTZCLEtBQUssb0JBQWxDLENBQXRCO0FBQ0Q7O0FBRUQsTUFBSSxJQUFJLEtBQUsscUJBQUwsSUFBOEIsS0FBSyxNQUEzQzs7QUFFQSxPQUFLLHFCQUFMLEdBQTZCLElBQUksS0FBSixDQUFVO0FBQ3JDLE9BQUcsS0FBSyxHQUFMLENBQVMsQ0FBVCxFQUFZLEVBQUUsQ0FBRixHQUFNLENBQWxCLENBRGtDO0FBRXJDLE9BQUcsS0FBSyxHQUFMLENBQ0MsQ0FBQyxLQUFLLElBQUwsR0FBWSxDQUFiLElBQWtCLEtBQUssSUFBTCxDQUFVLE1BQTVCLEdBQXFDLEtBQUssSUFBTCxDQUFVLE1BQS9DLElBQ0MsS0FBSyxPQUFMLENBQWEsZUFBYixHQUErQixLQUFLLElBQUwsQ0FBVSxNQUFWLEdBQW1CLENBQW5CLEdBQXVCLENBQXZCLEdBQTJCLENBQTFELEdBQThELENBRC9ELENBREQsRUFHRCxLQUFLLEdBQUwsQ0FBUyxDQUFULEVBQVksRUFBRSxDQUFGLEdBQU0sQ0FBbEIsQ0FIQztBQUZrQyxHQUFWLENBQTdCO0FBUUQsQ0FyQkQ7O0FBdUJBLEtBQUssU0FBTCxDQUFlLG9CQUFmLEdBQXNDLFlBQVc7QUFDL0MsT0FBSyxjQUFMLEdBQXNCLE9BQU8scUJBQVAsQ0FBNkIsS0FBSyxvQkFBbEMsQ0FBdEI7O0FBRUEsTUFBSSxJQUFJLEtBQUssTUFBYjtBQUNBLE1BQUksSUFBSSxLQUFLLHFCQUFiOztBQUVBLE1BQUksS0FBSyxFQUFFLENBQUYsR0FBTSxFQUFFLENBQWpCO0FBQ0EsTUFBSSxLQUFLLEVBQUUsQ0FBRixHQUFNLEVBQUUsQ0FBakI7O0FBRUEsT0FBSyxLQUFLLElBQUwsQ0FBVSxFQUFWLElBQWdCLENBQXJCO0FBQ0EsT0FBSyxLQUFLLElBQUwsQ0FBVSxFQUFWLElBQWdCLENBQXJCOztBQUVBLE9BQUssUUFBTCxDQUFjLEVBQWQsRUFBa0IsRUFBbEI7QUFDRCxDQWJEOztBQWVBLEtBQUssU0FBTCxDQUFlLG9CQUFmLEdBQXNDLFlBQVc7QUFDL0MsTUFBSSxRQUFRLEtBQUssT0FBTCxDQUFhLFlBQXpCO0FBQ0EsTUFBSSxJQUFJLEtBQUssTUFBYjtBQUNBLE1BQUksSUFBSSxLQUFLLHFCQUFiOztBQUVBLE1BQUksS0FBSyxFQUFFLENBQUYsR0FBTSxFQUFFLENBQWpCO0FBQ0EsTUFBSSxLQUFLLEVBQUUsQ0FBRixHQUFNLEVBQUUsQ0FBakI7O0FBRUEsTUFBSSxNQUFNLEtBQUssR0FBTCxDQUFTLEVBQVQsQ0FBVjtBQUNBLE1BQUksTUFBTSxLQUFLLEdBQUwsQ0FBUyxFQUFULENBQVY7O0FBRUEsTUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLE1BQVYsR0FBbUIsR0FBOUIsRUFBbUM7QUFDakMsYUFBUyxJQUFUO0FBQ0Q7O0FBRUQsTUFBSyxNQUFNLENBQU4sSUFBVyxNQUFNLENBQWxCLElBQXdCLENBQUMsS0FBSyxnQkFBbEMsRUFBb0Q7QUFDbEQsU0FBSyxnQkFBTCxHQUF3QixLQUF4QjtBQUNBLFNBQUssUUFBTCxDQUFjLEtBQUsscUJBQW5CO0FBQ0EsU0FBSyxxQkFBTCxHQUE2QixJQUE3QjtBQUNBLFNBQUssSUFBTCxDQUFVLGVBQVY7QUFDQTtBQUNEOztBQUVELE9BQUssY0FBTCxHQUFzQixPQUFPLHFCQUFQLENBQTZCLEtBQUssb0JBQWxDLENBQXRCOztBQUVBLFVBQVEsS0FBSyxhQUFiO0FBQ0UsU0FBSyxRQUFMO0FBQ0UsVUFBSSxNQUFNLEtBQVYsRUFBaUIsTUFBTSxHQUFOLENBQWpCLEtBQ0ssS0FBSyxLQUFLLElBQUwsQ0FBVSxFQUFWLElBQWdCLEtBQXJCOztBQUVMLFVBQUksTUFBTSxLQUFWLEVBQWlCLE1BQU0sR0FBTixDQUFqQixLQUNLLEtBQUssS0FBSyxJQUFMLENBQVUsRUFBVixJQUFnQixLQUFyQjs7QUFFTDtBQUNGLFNBQUssTUFBTDtBQUNFLFlBQU0sR0FBTjtBQUNBLFlBQU0sR0FBTjtBQUNBO0FBWko7O0FBZUEsT0FBSyxRQUFMLENBQWMsRUFBZCxFQUFrQixFQUFsQjtBQUNELENBekNEOztBQTJDQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsSUFBVCxFQUFlO0FBQ3JDLE1BQUksS0FBSyxJQUFMLENBQVUsTUFBZCxFQUFzQixLQUFLLE1BQUw7O0FBRXRCLE9BQUssSUFBTCxDQUFVLE9BQVYsRUFBbUIsSUFBbkIsRUFBeUIsS0FBSyxLQUFMLENBQVcsSUFBWCxFQUF6QixFQUE0QyxLQUFLLElBQUwsQ0FBVSxJQUFWLEVBQTVDLEVBQThELEtBQUssSUFBTCxDQUFVLE1BQXhFOztBQUVBLE1BQUksT0FBTyxLQUFLLE1BQUwsQ0FBWSxXQUFaLENBQXdCLEtBQUssS0FBTCxDQUFXLENBQW5DLENBQVg7QUFDQSxNQUFJLFFBQVEsS0FBSyxLQUFLLEtBQUwsQ0FBVyxDQUFoQixDQUFaO0FBQ0EsTUFBSSxpQkFBaUIsQ0FBQyxDQUFDLEdBQUQsRUFBSyxHQUFMLEVBQVMsR0FBVCxFQUFjLE9BQWQsQ0FBc0IsS0FBdEIsQ0FBdEI7O0FBRUE7QUFDQSxNQUFJLFFBQVEsSUFBUixDQUFhLElBQWIsQ0FBSixFQUF3QjtBQUN0QixRQUFJLGNBQWMsS0FBSyxLQUFMLENBQVcsQ0FBWCxLQUFpQixLQUFLLE1BQUwsR0FBYyxDQUFqRDtBQUNBLFFBQUksT0FBTyxLQUFLLEtBQUssS0FBTCxDQUFXLENBQVgsR0FBZSxDQUFwQixDQUFYO0FBQ0EsUUFBSSxTQUFTLEtBQUssS0FBTCxDQUFXLElBQVgsQ0FBYjtBQUNBLGFBQVMsU0FBUyxPQUFPLEtBQWhCLEdBQXdCLEtBQUssTUFBTCxHQUFjLENBQS9DO0FBQ0EsUUFBSSxnQkFBZ0IsQ0FBQyxDQUFDLEdBQUQsRUFBSyxHQUFMLEVBQVMsR0FBVCxFQUFjLE9BQWQsQ0FBc0IsSUFBdEIsQ0FBckI7O0FBRUEsUUFBSSxhQUFKLEVBQW1CLFVBQVUsQ0FBVjs7QUFFbkIsUUFBSSxlQUFlLGFBQW5CLEVBQWtDO0FBQ2hDLGNBQVEsSUFBSSxLQUFKLENBQVUsU0FBUyxDQUFuQixFQUFzQixJQUF0QixDQUEyQixHQUEzQixDQUFSO0FBQ0Q7QUFDRjs7QUFFRCxNQUFJLE1BQUo7O0FBRUEsTUFBSSxDQUFDLGNBQUQsSUFBb0Isa0JBQWtCLENBQUMsQ0FBQyxDQUFDLEdBQUQsRUFBSyxHQUFMLEVBQVMsR0FBVCxFQUFjLE9BQWQsQ0FBc0IsSUFBdEIsQ0FBNUMsRUFBMEU7QUFDeEUsYUFBUyxLQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLEtBQUssS0FBeEIsRUFBK0IsSUFBL0IsRUFBcUMsSUFBckMsRUFBMkMsSUFBM0MsQ0FBVDtBQUNELEdBRkQsTUFFTztBQUNMLGFBQVMsQ0FBVDtBQUNEOztBQUVELE9BQUssSUFBTCxDQUFVLE9BQVYsQ0FBa0IsTUFBbEIsRUFBMEIsSUFBMUI7O0FBRUEsTUFBSSxRQUFRLElBQVosRUFBa0IsS0FBSyxNQUFMLENBQVksTUFBWixDQUFtQixLQUFLLEtBQXhCLEVBQStCLEdBQS9CLEVBQWxCLEtBQ0ssSUFBSSxRQUFRLElBQVosRUFBa0IsS0FBSyxNQUFMLENBQVksTUFBWixDQUFtQixLQUFLLEtBQXhCLEVBQStCLEdBQS9CLEVBQWxCLEtBQ0EsSUFBSSxRQUFRLElBQVosRUFBa0IsS0FBSyxNQUFMLENBQVksTUFBWixDQUFtQixLQUFLLEtBQXhCLEVBQStCLEdBQS9COztBQUV2QixNQUFJLGlCQUFpQixjQUFyQixFQUFxQztBQUNuQyxjQUFVLENBQVY7QUFDQSxTQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLEtBQUssS0FBeEIsRUFBK0IsT0FBTyxJQUFJLEtBQUosQ0FBVSxTQUFTLENBQW5CLEVBQXNCLElBQXRCLENBQTJCLEdBQTNCLENBQXRDO0FBQ0Q7QUFDRixDQTFDRDs7QUE0Q0EsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixZQUFXO0FBQ3BDLE1BQUksS0FBSyxJQUFMLENBQVUsYUFBVixFQUFKLEVBQStCO0FBQzdCLFFBQUksS0FBSyxJQUFMLENBQVUsTUFBVixJQUFvQixDQUFDLEtBQUssSUFBTCxDQUFVLFdBQVYsRUFBekIsRUFBa0QsT0FBTyxLQUFLLE1BQUwsRUFBUDtBQUNsRDtBQUNEOztBQUVELE9BQUssSUFBTCxDQUFVLE9BQVYsRUFBbUIsUUFBbkIsRUFBNkIsS0FBSyxLQUFMLENBQVcsSUFBWCxFQUE3QixFQUFnRCxLQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWhELEVBQWtFLEtBQUssSUFBTCxDQUFVLE1BQTVFOztBQUVBLE1BQUksS0FBSyxJQUFMLENBQVUsTUFBZCxFQUFzQjtBQUNwQixTQUFLLE9BQUwsQ0FBYSxJQUFiLENBQWtCLElBQWxCO0FBQ0EsUUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLEdBQVYsRUFBWDtBQUNBLFNBQUssUUFBTCxDQUFjLEtBQUssS0FBbkI7QUFDQSxTQUFLLE1BQUwsQ0FBWSxVQUFaLENBQXVCLElBQXZCO0FBQ0EsU0FBSyxTQUFMLENBQWUsSUFBZjtBQUNELEdBTkQsTUFNTztBQUNMLFNBQUssT0FBTCxDQUFhLElBQWI7QUFDQSxTQUFLLElBQUwsQ0FBVSxPQUFWLENBQWtCLENBQUMsQ0FBbkIsRUFBc0IsSUFBdEI7QUFDQSxTQUFLLE1BQUwsQ0FBWSxpQkFBWixDQUE4QixLQUFLLEtBQW5DO0FBQ0Q7QUFDRixDQW5CRDs7QUFxQkEsS0FBSyxTQUFMLENBQWUsTUFBZixHQUF3QixZQUFXO0FBQ2pDLE1BQUksS0FBSyxJQUFMLENBQVUsV0FBVixFQUFKLEVBQTZCO0FBQzNCLFFBQUksS0FBSyxJQUFMLENBQVUsTUFBVixJQUFvQixDQUFDLEtBQUssSUFBTCxDQUFVLGFBQVYsRUFBekIsRUFBb0QsT0FBTyxLQUFLLFNBQUwsRUFBUDtBQUNwRDtBQUNEOztBQUVELE9BQUssSUFBTCxDQUFVLE9BQVYsRUFBbUIsUUFBbkIsRUFBNkIsS0FBSyxLQUFMLENBQVcsSUFBWCxFQUE3QixFQUFnRCxLQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWhELEVBQWtFLEtBQUssSUFBTCxDQUFVLE1BQTVFOztBQUVBLE1BQUksS0FBSyxJQUFMLENBQVUsTUFBZCxFQUFzQjtBQUNwQixTQUFLLE9BQUwsQ0FBYSxJQUFiLENBQWtCLElBQWxCO0FBQ0EsUUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLEdBQVYsRUFBWDtBQUNBLFNBQUssUUFBTCxDQUFjLEtBQUssS0FBbkI7QUFDQSxTQUFLLE1BQUwsQ0FBWSxVQUFaLENBQXVCLElBQXZCO0FBQ0EsU0FBSyxTQUFMLENBQWUsSUFBZjtBQUNELEdBTkQsTUFNTztBQUNMLFNBQUssT0FBTCxDQUFhLElBQWI7QUFDQSxTQUFLLE1BQUwsQ0FBWSxpQkFBWixDQUE4QixLQUFLLEtBQW5DO0FBQ0Q7QUFDRixDQWxCRDs7QUFvQkEsS0FBSyxTQUFMLENBQWUsUUFBZixHQUEwQixVQUFTLElBQVQsRUFBZTtBQUN2QyxNQUFJLENBQUMsS0FBSyxXQUFMLENBQWlCLE1BQWxCLElBQTRCLENBQUMsS0FBSyxJQUFMLENBQVUsTUFBM0MsRUFBbUQ7O0FBRW5ELE9BQUssVUFBTCxHQUFrQixLQUFLLFVBQUwsR0FBa0IsSUFBcEM7QUFDQSxNQUFJLEtBQUssVUFBTCxJQUFtQixLQUFLLFdBQUwsQ0FBaUIsTUFBeEMsRUFBZ0Q7QUFDOUMsU0FBSyxVQUFMLEdBQWtCLENBQWxCO0FBQ0QsR0FGRCxNQUVPLElBQUksS0FBSyxVQUFMLEdBQWtCLENBQXRCLEVBQXlCO0FBQzlCLFNBQUssVUFBTCxHQUFrQixLQUFLLFdBQUwsQ0FBaUIsTUFBakIsR0FBMEIsQ0FBNUM7QUFDRDs7QUFFRCxPQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBSSxLQUFLLFVBQVQsR0FBc0IsR0FBdEIsR0FBNEIsS0FBSyxXQUFMLENBQWlCLE1BQTVEOztBQUVBLE1BQUksU0FBUyxLQUFLLFdBQUwsQ0FBaUIsS0FBSyxVQUF0QixDQUFiO0FBQ0EsT0FBSyxRQUFMLENBQWMsTUFBZCxFQUFzQixJQUF0QixFQUE0QixJQUE1QjtBQUNBLE9BQUssU0FBTCxDQUFlLElBQWY7QUFDQSxPQUFLLFNBQUw7QUFDQSxPQUFLLElBQUwsQ0FBVSxPQUFWLENBQWtCLEtBQUssU0FBTCxDQUFlLE1BQWpDLEVBQXlDLElBQXpDO0FBQ0EsT0FBSyxPQUFMO0FBQ0EsT0FBSyxXQUFMLENBQWlCLElBQWpCLEVBQXVCLElBQXZCO0FBQ0EsT0FBSyxNQUFMLENBQVksTUFBWjtBQUNELENBcEJEOztBQXNCQSxLQUFLLFNBQUwsQ0FBZSxXQUFmLEdBQTZCLFVBQVMsS0FBVCxFQUFnQixNQUFoQixFQUF3QjtBQUFBOztBQUNuRCxNQUFJLElBQUksSUFBSSxLQUFKLENBQVUsRUFBRSxHQUFHLEtBQUssTUFBVixFQUFrQixHQUFHLENBQXJCLEVBQVYsQ0FBUjs7QUFFQSxPQUFLLE1BQUwsQ0FBWSxTQUFaO0FBQ0EsT0FBSyxTQUFMLEdBQWlCLEtBQWpCO0FBQ0EsT0FBSyxXQUFMLEdBQW1CLEtBQUssTUFBTCxDQUFZLE9BQVosQ0FBb0IsSUFBcEIsQ0FBeUIsS0FBekIsRUFBZ0MsR0FBaEMsQ0FBb0MsVUFBQyxNQUFELEVBQVk7QUFDakUsV0FBTyxPQUFLLE1BQUwsQ0FBWSxjQUFaLENBQTJCLE1BQTNCLENBQVA7QUFDRCxHQUZrQixDQUFuQjs7QUFJQSxNQUFJLEtBQUssV0FBTCxDQUFpQixNQUFyQixFQUE2QjtBQUMzQixTQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBSSxLQUFLLFVBQVQsR0FBc0IsR0FBdEIsR0FBNEIsS0FBSyxXQUFMLENBQWlCLE1BQTVEO0FBQ0Q7O0FBRUQsTUFBSSxDQUFDLE1BQUwsRUFBYSxLQUFLLFFBQUwsQ0FBYyxDQUFkOztBQUViLE9BQUssTUFBTCxDQUFZLE1BQVo7QUFDRCxDQWhCRDs7QUFrQkEsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixVQUFTLENBQVQsRUFBWTtBQUNyQyxNQUFJLENBQUMsQ0FBQyxFQUFELEVBQUssRUFBTCxFQUFTLEdBQVQsRUFBYyxPQUFkLENBQXNCLEVBQUUsS0FBeEIsQ0FBTCxFQUFxQztBQUFFO0FBQ3JDLFNBQUssS0FBTCxDQUFXLElBQVgsQ0FBZ0IsU0FBaEIsQ0FBMEIsQ0FBMUI7QUFDRDs7QUFFRCxNQUFJLE9BQU8sRUFBRSxLQUFULElBQWtCLEVBQUUsT0FBeEIsRUFBaUM7QUFBRTtBQUNqQyxNQUFFLGNBQUY7QUFDQSxXQUFPLEtBQVA7QUFDRDtBQUNELE1BQUksTUFBTSxFQUFFLEtBQVosRUFBbUI7QUFBRTtBQUNuQixNQUFFLGNBQUY7QUFDQSxTQUFLLEtBQUwsQ0FBVyxLQUFYO0FBQ0EsV0FBTyxLQUFQO0FBQ0Q7QUFDRixDQWREOztBQWdCQSxLQUFLLFNBQUwsQ0FBZSxVQUFmLEdBQTRCLFlBQVc7QUFDckMsT0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLEVBQWY7QUFDQSxPQUFLLFdBQUwsQ0FBaUIsS0FBSyxTQUF0QjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsV0FBZixHQUE2QixZQUFXO0FBQ3RDLE9BQUssS0FBTCxDQUFXLE1BQVg7QUFDQSxPQUFLLEtBQUw7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLE9BQWYsR0FBeUIsWUFBVztBQUNsQyxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksZUFBWixDQUE0QixLQUFLLEtBQWpDLEVBQXdDLElBQXhDLENBQVg7QUFDQSxNQUFJLENBQUMsSUFBTCxFQUFXOztBQUVYLE1BQUksTUFBTSxLQUFLLE1BQUwsQ0FBWSxXQUFaLENBQXdCLElBQXhCLENBQVY7QUFDQSxNQUFJLENBQUMsR0FBTCxFQUFVOztBQUVWLE1BQUksQ0FBQyxLQUFLLFdBQU4sSUFDQyxJQUFJLE1BQUosQ0FBVyxDQUFYLEVBQWMsS0FBSyxXQUFMLENBQWlCLE1BQS9CLE1BQTJDLEtBQUssV0FEckQsRUFDa0U7QUFDaEUsU0FBSyxZQUFMLEdBQW9CLENBQXBCO0FBQ0EsU0FBSyxXQUFMLEdBQW1CLEdBQW5CO0FBQ0EsU0FBSyxZQUFMLEdBQW9CLEtBQUssTUFBTCxDQUFZLE1BQVosQ0FBbUIsT0FBbkIsQ0FBMkIsR0FBM0IsQ0FBcEI7QUFDRDs7QUFFRCxNQUFJLENBQUMsS0FBSyxZQUFMLENBQWtCLE1BQXZCLEVBQStCO0FBQy9CLE1BQUksT0FBTyxLQUFLLFlBQUwsQ0FBa0IsS0FBSyxZQUF2QixDQUFYOztBQUVBLE9BQUssWUFBTCxHQUFvQixDQUFDLEtBQUssWUFBTCxHQUFvQixDQUFyQixJQUEwQixLQUFLLFlBQUwsQ0FBa0IsTUFBaEU7O0FBRUEsU0FBTztBQUNMLFVBQU0sSUFERDtBQUVMLFVBQU07QUFGRCxHQUFQO0FBSUQsQ0F2QkQ7O0FBeUJBLEtBQUssU0FBTCxDQUFlLFlBQWYsR0FBOEIsVUFBUyxLQUFULEVBQWdCO0FBQzVDLE1BQUksT0FBTyxLQUFLLE1BQUwsQ0FBWSxXQUFaLENBQXdCLE1BQU0sQ0FBOUIsQ0FBWDtBQUNBLE1BQUksWUFBWSxDQUFoQjtBQUNBLE1BQUksT0FBTyxDQUFYO0FBQ0EsTUFBSSxHQUFKO0FBQ0EsTUFBSSxPQUFPLENBQVg7QUFDQSxTQUFPLEVBQUUsTUFBTSxLQUFLLE9BQUwsQ0FBYSxJQUFiLEVBQW1CLE1BQU0sQ0FBekIsQ0FBUixDQUFQLEVBQTZDO0FBQzNDLFFBQUksT0FBTyxNQUFNLENBQWpCLEVBQW9CO0FBQ3BCLGlCQUFhLENBQUMsTUFBTSxJQUFQLElBQWUsS0FBSyxPQUFqQztBQUNBO0FBQ0EsV0FBTyxNQUFNLENBQWI7QUFDRDtBQUNELFNBQU87QUFDTCxVQUFNLElBREQ7QUFFTCxlQUFXLFlBQVk7QUFGbEIsR0FBUDtBQUlELENBaEJEOztBQWtCQSxLQUFLLFNBQUwsQ0FBZSxhQUFmLEdBQStCLFVBQVMsS0FBVCxFQUFnQjtBQUM3QyxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksV0FBWixDQUF3QixNQUFNLENBQTlCLENBQVg7QUFDQSxNQUFJLFlBQVksQ0FBaEI7QUFDQSxNQUFJLE9BQU8sQ0FBWDtBQUNBLE1BQUksR0FBSjtBQUNBLE1BQUksT0FBTyxDQUFYO0FBQ0EsU0FBTyxFQUFFLE1BQU0sS0FBSyxPQUFMLENBQWEsSUFBYixFQUFtQixNQUFNLENBQXpCLENBQVIsQ0FBUCxFQUE2QztBQUMzQyxRQUFJLE9BQU8sS0FBSyxPQUFaLEdBQXNCLFNBQXRCLElBQW1DLE1BQU0sQ0FBN0MsRUFBZ0Q7QUFDaEQsaUJBQWEsQ0FBQyxNQUFNLElBQVAsSUFBZSxLQUFLLE9BQWpDO0FBQ0E7QUFDQSxXQUFPLE1BQU0sQ0FBYjtBQUNEO0FBQ0QsU0FBTztBQUNMLFVBQU0sSUFERDtBQUVMLGVBQVc7QUFGTixHQUFQO0FBSUQsQ0FoQkQ7O0FBa0JBLEtBQUssU0FBTCxDQUFlLE9BQWYsR0FBeUIsVUFBUyxLQUFULEVBQWdCO0FBQ3ZDLE9BQUssTUFBTDtBQUNBLE1BQUksS0FBSixFQUFXLEtBQUssS0FBTCxDQUFXLEtBQVg7QUFDWCxPQUFLLEtBQUwsQ0FBVyxNQUFYO0FBQ0QsQ0FKRDs7QUFNQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFlBQVc7QUFDakMsTUFBSSxJQUFJLEtBQUssRUFBYjs7QUFFQSxNQUFJLEdBQUosQ0FBUSxLQUFLLEVBQWIsY0FDSyxJQUFJLElBRFQsZ0JBRUssSUFBSSxJQUZULGdCQUdLLElBQUksSUFIVCxzT0FvQmlCLEtBQUssT0FBTCxDQUFhLFNBcEI5Qiw4QkFxQm1CLEtBQUssT0FBTCxDQUFhLFdBckJoQzs7QUEwQkEsT0FBSyxNQUFMLENBQVksR0FBWixDQUFnQixJQUFJLFNBQUosQ0FBYyxDQUFkLENBQWhCO0FBQ0EsT0FBSyxNQUFMLENBQVksR0FBWixDQUFnQixJQUFJLFNBQUosQ0FBYyxDQUFkLENBQWhCO0FBQ0EsT0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLElBQUksT0FBSixDQUFZLENBQVosQ0FBZDs7QUFFQTtBQUNBO0FBQ0EsT0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLElBQUksV0FBSixDQUFnQixDQUFoQixFQUFtQixJQUFJLElBQXZCLENBQWQ7O0FBRUEsT0FBSyxJQUFMLEdBQVksS0FBSyxNQUFMLENBQVksR0FBWixFQUFaO0FBQ0EsT0FBSyxJQUFMLEdBQVksS0FBSyxNQUFMLENBQVksSUFBWixDQUFpQixNQUE3QjtBQUNBLE9BQUssSUFBTCxDQUFVLEdBQVYsQ0FBYyxLQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWdCLEtBQUssSUFBckIsQ0FBZDtBQUNBLE9BQUssYUFBTCxDQUFtQixHQUFuQixDQUF1QixLQUFLLElBQUwsQ0FBVSxHQUFWLEVBQWUsS0FBSyxJQUFMLENBQVUsSUFBVixFQUFnQixLQUFLLElBQXJCLENBQWYsQ0FBdkI7QUFDQSxPQUFLLFVBQUwsR0FBa0IsQ0FBQyxDQUFELEVBQUksS0FBSyxJQUFULENBQWxCO0FBQ0E7O0FBRUEsT0FBSyxNQUFMLEdBQWMsS0FBSyxHQUFMLENBQ1osS0FBSyxPQUFMLENBQWEsU0FBYixHQUF5QixDQUF6QixHQUE2QixDQUFDLEtBQUcsS0FBSyxJQUFULEVBQWUsTUFEaEMsRUFFWixDQUFDLEtBQUssT0FBTCxDQUFhLGlCQUFiLEdBQ0csS0FBSyxHQUFMLENBQ0UsQ0FBQyxLQUFHLEtBQUssSUFBVCxFQUFlLE1BRGpCLEVBRUUsQ0FBRSxLQUFLLElBQUwsQ0FBVSxLQUFWLEdBQWtCLEVBQWxCLElBQ0MsS0FBSyxPQUFMLENBQWEsU0FBYixHQUF5QixDQUF6QixHQUE2QixDQUFDLEtBQUcsS0FBSyxJQUFULEVBQWUsTUFEN0MsQ0FBRixJQUVJLENBRkosR0FFUSxDQUpWLENBREgsR0FNTyxDQU5SLEtBT0csS0FBSyxPQUFMLENBQWEsU0FBYixHQUF5QixDQUF6QixHQUE2QixLQUFLLEdBQUwsQ0FBUyxDQUFULEVBQVksQ0FBQyxLQUFHLEtBQUssSUFBVCxFQUFlLE1BQTNCLENBUGhDLENBRlksSUFVVixLQUFLLElBQUwsQ0FBVSxLQVZBLElBV1gsS0FBSyxPQUFMLENBQWEsU0FBYixHQUNHLENBREgsR0FFRyxLQUFLLE9BQUwsQ0FBYSxhQUFiLElBQThCLEtBQUssT0FBTCxDQUFhLGlCQUFiLEdBQWlDLENBQUMsQ0FBbEMsR0FBc0MsQ0FBcEUsQ0FiUSxDQUFkOztBQWdCQSxPQUFLLFVBQUwsR0FBa0IsS0FBSyxNQUFMLEdBQWMsS0FBSyxPQUFMLENBQWEsV0FBN0M7QUFDQSxPQUFLLFFBQUwsR0FBZ0IsS0FBSyxVQUFMLEdBQWtCLEtBQUssSUFBTCxDQUFVLEtBQVYsR0FBa0IsQ0FBcEQ7O0FBRUEsT0FBSyxNQUFMLEdBQWMsQ0FBQyxLQUFLLElBQUwsR0FBWSxLQUFLLElBQUwsQ0FBVSxNQUF2QixJQUNWLEtBQUssSUFBTCxDQUFVLE1BREEsR0FFVixLQUFLLGFBQUwsQ0FBbUIsTUFGdkI7O0FBSUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBLE1BQUksU0FBUyxTQUFTLGFBQVQsQ0FBdUIsUUFBdkIsQ0FBYjtBQUNBLE1BQUksTUFBTSxTQUFTLGNBQVQsQ0FBd0IsS0FBeEIsQ0FBVjtBQUNBLE1BQUksTUFBTSxPQUFPLFVBQVAsQ0FBa0IsSUFBbEIsQ0FBVjs7QUFFQSxTQUFPLFlBQVAsQ0FBb0IsT0FBcEIsRUFBNkIsS0FBSyxJQUFMLENBQVUsS0FBSyxJQUFMLENBQVUsS0FBVixHQUFrQixDQUE1QixDQUE3QjtBQUNBLFNBQU8sWUFBUCxDQUFvQixRQUFwQixFQUE4QixLQUFLLElBQUwsQ0FBVSxNQUF4Qzs7QUFFQSxNQUFJLFVBQVUsU0FBUyxhQUFULENBQXVCLEdBQXZCLENBQWQ7QUFDQSxJQUFFLFdBQUYsQ0FBYyxPQUFkO0FBQ0EsTUFBSSxRQUFRLE9BQU8sZ0JBQVAsQ0FBd0IsT0FBeEIsRUFBaUMsS0FBN0M7QUFDQSxJQUFFLFdBQUYsQ0FBYyxPQUFkO0FBQ0EsTUFBSSxXQUFKLENBQWdCLENBQUMsQ0FBRCxFQUFHLENBQUgsQ0FBaEI7QUFDQSxNQUFJLGNBQUosR0FBcUIsQ0FBckI7QUFDQSxNQUFJLFNBQUo7QUFDQSxNQUFJLE1BQUosQ0FBVyxDQUFYLEVBQWEsQ0FBYjtBQUNBLE1BQUksTUFBSixDQUFXLENBQVgsRUFBYyxLQUFLLElBQUwsQ0FBVSxNQUF4QjtBQUNBLE1BQUksV0FBSixHQUFrQixLQUFsQjtBQUNBLE1BQUksTUFBSjs7QUFFQSxNQUFJLFVBQVUsT0FBTyxTQUFQLEVBQWQ7O0FBRUEsTUFBSSxHQUFKLENBQVEsS0FBSyxFQUFiLGNBQ0ssS0FBSyxFQURWLHdCQUVXLEtBQUssT0FBTCxDQUFhLGVBQWIsR0FBK0IsS0FBSyxJQUFMLENBQVUsTUFBVixHQUFtQixDQUFsRCxHQUFzRCxDQUZqRSw0QkFLSyxJQUFJLElBTFQsZ0JBTUssSUFBSSxJQU5ULGdCQU9LLElBQUksSUFQVCxzT0F3QmlCLEtBQUssT0FBTCxDQUFhLFNBeEI5Qiw4QkF5Qm1CLEtBQUssT0FBTCxDQUFhLFdBekJoQyx5QkE0QkssS0FBSyxFQTVCVixZQTRCbUIsSUFBSSxLQTVCdkIsZ0JBNkJLLEtBQUssRUE3QlYsWUE2Qm1CLElBQUksSUE3QnZCLGdCQThCSyxLQUFLLEVBOUJWLFlBOEJtQixJQUFJLElBOUJ2QixnQkErQkssS0FBSyxFQS9CVixZQStCbUIsSUFBSSxJQS9CdkIsK0JBZ0NtQixLQUFLLFFBaEN4Qiw2QkFpQ2dCLEtBQUssT0FqQ3JCLHVCQW1DSyxLQUFLLEVBbkNWLFlBbUNtQixJQUFJLElBbkN2Qix5QkFvQ2EsS0FBSyxVQXBDbEIseUJBc0NLLEtBQUssRUF0Q1YsWUFzQ21CLElBQUksSUF0Q3ZCLG9CQXVDSyxLQUFLLEVBdkNWLFlBdUNtQixJQUFJLEtBdkN2QiwrQkF3Q2MsS0FBSyxJQUFMLENBQVUsTUFBVixHQUFtQixDQXhDakMsMERBMkM0QixPQTNDNUI7O0FBK0NBLE9BQUssSUFBTCxDQUFVLFFBQVY7QUFDRCxDQS9JRDs7QUFpSkEsS0FBSyxTQUFMLENBQWUsS0FBZixHQUF1QixVQUFTLElBQVQsRUFBZTtBQUNwQyxPQUFLLEtBQUwsQ0FBVyxJQUFYLEVBQWlCLEtBQWpCO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsSUFBVCxFQUFlO0FBQ3JDLHVCQUFxQixLQUFLLGFBQTFCO0FBQ0EsTUFBSSxLQUFLLHNCQUFMLEtBQWdDLENBQUMsQ0FBckMsRUFBd0M7QUFDdEMsU0FBSyxzQkFBTCxHQUE4QixLQUFLLEdBQUwsRUFBOUI7QUFDRCxHQUZELE1BRU87QUFDTCxRQUFJLEtBQUssR0FBTCxLQUFhLEtBQUssc0JBQWxCLEdBQTJDLEdBQS9DLEVBQW9EO0FBQ2xELFdBQUssT0FBTDtBQUNEO0FBQ0Y7QUFDRCxNQUFJLENBQUMsQ0FBQyxLQUFLLFdBQUwsQ0FBaUIsT0FBakIsQ0FBeUIsSUFBekIsQ0FBTixFQUFzQztBQUNwQyxRQUFJLFFBQVEsS0FBSyxLQUFqQixFQUF3QjtBQUN0QixXQUFLLFdBQUwsQ0FBaUIsSUFBakIsQ0FBc0IsSUFBdEI7QUFDRDtBQUNGO0FBQ0QsT0FBSyxhQUFMLEdBQXFCLHNCQUFzQixLQUFLLE9BQTNCLENBQXJCO0FBQ0QsQ0FmRDs7QUFpQkEsS0FBSyxTQUFMLENBQWUsT0FBZixHQUF5QixZQUFXO0FBQUE7O0FBQ2xDO0FBQ0EsT0FBSyxzQkFBTCxHQUE4QixDQUFDLENBQS9CO0FBQ0EsT0FBSyxXQUFMLENBQWlCLE9BQWpCLENBQXlCO0FBQUEsV0FBUSxPQUFLLEtBQUwsQ0FBVyxJQUFYLEVBQWlCLE1BQWpCLENBQXdCO0FBQ3ZELGNBQVE7QUFDTixjQUFNLE9BQUssTUFBTCxDQUFZLENBRFo7QUFFTixhQUFLLE9BQUssTUFBTCxDQUFZLENBQVosR0FBZ0IsT0FBSyxFQUFMLENBQVE7QUFGdkI7QUFEK0MsS0FBeEIsQ0FBUjtBQUFBLEdBQXpCO0FBTUEsT0FBSyxXQUFMLEdBQW1CLEVBQW5CO0FBQ0QsQ0FWRDs7QUFZQTtBQUNBLFNBQVMsWUFBVCxDQUFzQixFQUF0QixFQUEwQjtBQUN4QixTQUFPLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZSxDQUFmLEVBQWtCLENBQWxCLEVBQXFCO0FBQzFCLFFBQUksTUFBTSxJQUFJLEtBQUosRUFBVjtBQUNBLFVBQU0saUJBQU4sQ0FBd0IsR0FBeEIsRUFBNkIsVUFBVSxNQUF2QztBQUNBLFFBQUksUUFBUSxJQUFJLEtBQWhCO0FBQ0EsWUFBUSxHQUFSLENBQVksS0FBWjtBQUNBLE9BQUcsSUFBSCxDQUFRLElBQVIsRUFBYyxDQUFkLEVBQWlCLENBQWpCLEVBQW9CLENBQXBCLEVBQXVCLENBQXZCO0FBQ0QsR0FORDtBQU9EOzs7OztBQ3BrQ0QsSUFBSSxRQUFRLFFBQVEsU0FBUixDQUFaOztBQUVBLE9BQU8sT0FBUCxHQUFpQixJQUFqQjs7QUFFQSxTQUFTLElBQVQsQ0FBYyxDQUFkLEVBQWlCO0FBQ2YsTUFBSSxDQUFKLEVBQU87QUFDTCxTQUFLLEtBQUwsR0FBYSxJQUFJLEtBQUosQ0FBVSxFQUFFLEtBQVosQ0FBYjtBQUNBLFNBQUssR0FBTCxHQUFXLElBQUksS0FBSixDQUFVLEVBQUUsR0FBWixDQUFYO0FBQ0QsR0FIRCxNQUdPO0FBQ0wsU0FBSyxLQUFMLEdBQWEsSUFBSSxLQUFKLEVBQWI7QUFDQSxTQUFLLEdBQUwsR0FBVyxJQUFJLEtBQUosRUFBWDtBQUNEO0FBQ0Y7O0FBRUQsS0FBSyxTQUFMLENBQWUsSUFBZixHQUFzQixZQUFXO0FBQy9CLFNBQU8sSUFBSSxJQUFKLENBQVMsSUFBVCxDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxHQUFmLEdBQXFCLFlBQVc7QUFDOUIsTUFBSSxJQUFJLENBQUMsS0FBSyxLQUFOLEVBQWEsS0FBSyxHQUFsQixFQUF1QixJQUF2QixDQUE0QixNQUFNLElBQWxDLENBQVI7QUFDQSxTQUFPLElBQUksSUFBSixDQUFTO0FBQ2QsV0FBTyxJQUFJLEtBQUosQ0FBVSxFQUFFLENBQUYsQ0FBVixDQURPO0FBRWQsU0FBSyxJQUFJLEtBQUosQ0FBVSxFQUFFLENBQUYsQ0FBVjtBQUZTLEdBQVQsQ0FBUDtBQUlELENBTkQ7O0FBUUEsS0FBSyxTQUFMLENBQWUsR0FBZixHQUFxQixVQUFTLElBQVQsRUFBZTtBQUNsQyxPQUFLLEtBQUwsQ0FBVyxHQUFYLENBQWUsS0FBSyxLQUFwQjtBQUNBLE9BQUssR0FBTCxDQUFTLEdBQVQsQ0FBYSxLQUFLLEdBQWxCO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxPQUFmLEdBQXlCLFVBQVMsQ0FBVCxFQUFZO0FBQ25DLE9BQUssS0FBTCxDQUFXLENBQVgsR0FBZSxDQUFmO0FBQ0EsT0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLENBQWI7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUpEOztBQU1BLEtBQUssU0FBTCxDQUFlLFFBQWYsR0FBMEIsVUFBUyxDQUFULEVBQVk7QUFDcEMsTUFBSSxLQUFLLEtBQUwsQ0FBVyxDQUFmLEVBQWtCLEtBQUssS0FBTCxDQUFXLENBQVgsSUFBZ0IsQ0FBaEI7QUFDbEIsTUFBSSxLQUFLLEdBQUwsQ0FBUyxDQUFiLEVBQWdCLEtBQUssR0FBTCxDQUFTLENBQVQsSUFBYyxDQUFkO0FBQ2hCLFNBQU8sSUFBUDtBQUNELENBSkQ7O0FBTUEsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixVQUFTLENBQVQsRUFBWTtBQUNyQyxPQUFLLEdBQUwsQ0FBUyxDQUFULElBQWMsQ0FBZDtBQUNBLFNBQU8sSUFBUDtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsWUFBZixHQUE4QixVQUFTLENBQVQsRUFBWTtBQUN4QyxPQUFLLEtBQUwsQ0FBVyxDQUFYLElBQWdCLENBQWhCO0FBQ0EsT0FBSyxHQUFMLENBQVMsQ0FBVCxJQUFjLENBQWQ7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLEdBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxXQUFmLEdBQTZCLFVBQVMsQ0FBVCxFQUFZO0FBQ3ZDLFNBQU8sS0FBSyxLQUFMLENBQVcsQ0FBWCxLQUFpQixFQUFFLEdBQUYsQ0FBTSxDQUF2QixHQUNILEtBQUssS0FBTCxDQUFXLENBQVgsR0FBZSxFQUFFLEdBQUYsQ0FBTSxDQURsQixHQUVILEtBQUssS0FBTCxDQUFXLENBQVgsR0FBZSxFQUFFLEdBQUYsQ0FBTSxDQUZ6QjtBQUdELENBTEQ7O0FBT0EsS0FBSyxTQUFMLENBQWUsSUFBZixJQUNBLEtBQUssU0FBTCxDQUFlLGtCQUFmLEdBQW9DLFVBQVMsQ0FBVCxFQUFZO0FBQzlDLFNBQU8sS0FBSyxLQUFMLENBQVcsQ0FBWCxLQUFpQixFQUFFLEtBQUYsQ0FBUSxDQUF6QixHQUNILEtBQUssS0FBTCxDQUFXLENBQVgsSUFBZ0IsRUFBRSxLQUFGLENBQVEsQ0FEckIsR0FFSCxLQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsRUFBRSxLQUFGLENBQVEsQ0FGM0I7QUFHRCxDQUxEOztBQU9BLEtBQUssU0FBTCxDQUFlLEdBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFVBQVMsQ0FBVCxFQUFZO0FBQ3BDLFNBQU8sS0FBSyxHQUFMLENBQVMsQ0FBVCxLQUFlLEVBQUUsS0FBRixDQUFRLENBQXZCLEdBQ0gsS0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLEVBQUUsS0FBRixDQUFRLENBRGxCLEdBRUgsS0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLEVBQUUsS0FBRixDQUFRLENBRnpCO0FBR0QsQ0FMRDs7QUFPQSxLQUFLLFNBQUwsQ0FBZSxJQUFmLElBQ0EsS0FBSyxTQUFMLENBQWUsZUFBZixHQUFpQyxVQUFTLENBQVQsRUFBWTtBQUMzQyxTQUFPLEtBQUssR0FBTCxDQUFTLENBQVQsS0FBZSxFQUFFLEdBQUYsQ0FBTSxDQUFyQixHQUNILEtBQUssR0FBTCxDQUFTLENBQVQsSUFBYyxFQUFFLEdBQUYsQ0FBTSxDQURqQixHQUVILEtBQUssR0FBTCxDQUFTLENBQVQsR0FBYSxFQUFFLEdBQUYsQ0FBTSxDQUZ2QjtBQUdELENBTEQ7O0FBT0EsS0FBSyxTQUFMLENBQWUsSUFBZixJQUNBLEtBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsVUFBUyxDQUFULEVBQVk7QUFDbEMsU0FBTyxLQUFLLEdBQUwsRUFBVSxDQUFWLEtBQWdCLEtBQUssR0FBTCxFQUFVLENBQVYsQ0FBdkI7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLElBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxPQUFmLEdBQXlCLFVBQVMsQ0FBVCxFQUFZO0FBQ25DLFNBQU8sS0FBSyxHQUFMLEVBQVUsQ0FBVixLQUFnQixLQUFLLEdBQUwsRUFBVSxDQUFWLENBQXZCO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLElBQ0EsS0FBSyxTQUFMLENBQWUsV0FBZixHQUE2QixVQUFTLENBQVQsRUFBWTtBQUN2QyxTQUFPLEtBQUssSUFBTCxFQUFXLENBQVgsS0FBaUIsS0FBSyxJQUFMLEVBQVcsQ0FBWCxDQUF4QjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsS0FBZixJQUNBLEtBQUssU0FBTCxDQUFlLFlBQWYsR0FBOEIsVUFBUyxDQUFULEVBQVk7QUFDeEMsU0FBTyxLQUFLLElBQUwsRUFBVyxDQUFYLEtBQWlCLEtBQUssSUFBTCxFQUFXLENBQVgsQ0FBeEI7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLEtBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLEdBQXVCLFVBQVMsQ0FBVCxFQUFZO0FBQ2pDLFNBQU8sS0FBSyxLQUFMLENBQVcsQ0FBWCxLQUFpQixFQUFFLEtBQUYsQ0FBUSxDQUF6QixJQUE4QixLQUFLLEtBQUwsQ0FBVyxDQUFYLEtBQWlCLEVBQUUsS0FBRixDQUFRLENBQXZELElBQ0EsS0FBSyxHQUFMLENBQVMsQ0FBVCxLQUFpQixFQUFFLEdBQUYsQ0FBTSxDQUR2QixJQUM4QixLQUFLLEdBQUwsQ0FBUyxDQUFULEtBQWlCLEVBQUUsR0FBRixDQUFNLENBRDVEO0FBRUQsQ0FKRDs7QUFNQSxLQUFLLFNBQUwsQ0FBZSxJQUFmLElBQ0EsS0FBSyxTQUFMLENBQWUsY0FBZixHQUFnQyxVQUFTLENBQVQsRUFBWTtBQUMxQyxTQUFPLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsRUFBRSxLQUFGLENBQVEsQ0FBaEM7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLElBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxZQUFmLEdBQThCLFVBQVMsQ0FBVCxFQUFZO0FBQ3hDLFNBQU8sS0FBSyxHQUFMLENBQVMsQ0FBVCxLQUFlLEVBQUUsR0FBRixDQUFNLENBQTVCO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLElBQ0EsS0FBSyxTQUFMLENBQWUsVUFBZixHQUE0QixVQUFTLENBQVQsRUFBWTtBQUN0QyxTQUFPLEtBQUssSUFBTCxFQUFXLENBQVgsS0FBaUIsS0FBSyxJQUFMLEVBQVcsQ0FBWCxDQUF4QjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsS0FBZixJQUNBLEtBQUssU0FBTCxDQUFlLFFBQWYsR0FBMEIsVUFBUyxDQUFULEVBQVk7QUFDcEMsU0FBTyxLQUFLLEtBQUwsQ0FBVyxDQUFYLEtBQWlCLEtBQUssR0FBTCxDQUFTLENBQTFCLElBQStCLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsRUFBRSxLQUFGLENBQVEsQ0FBL0Q7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLEtBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxVQUFmLEdBQTRCLFVBQVMsQ0FBVCxFQUFZO0FBQ3RDLFNBQU8sSUFBSSxJQUFKLENBQVM7QUFDZCxXQUFPO0FBQ0wsU0FBRyxLQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsQ0FEYjtBQUVMLFNBQUcsS0FBSyxLQUFMLENBQVc7QUFGVCxLQURPO0FBS2QsU0FBSztBQUNILFNBQUcsS0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLENBRGI7QUFFSCxTQUFHLEtBQUssR0FBTCxDQUFTO0FBRlQ7QUFMUyxHQUFULENBQVA7QUFVRCxDQVpEOztBQWNBLEtBQUssU0FBTCxDQUFlLEtBQWYsSUFDQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFVBQVMsQ0FBVCxFQUFZO0FBQ3BDLFNBQU8sSUFBSSxJQUFKLENBQVM7QUFDZCxXQUFPO0FBQ0wsU0FBRyxLQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsQ0FEYjtBQUVMLFNBQUcsS0FBSyxLQUFMLENBQVc7QUFGVCxLQURPO0FBS2QsU0FBSztBQUNILFNBQUcsS0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLENBRGI7QUFFSCxTQUFHLEtBQUssR0FBTCxDQUFTO0FBRlQ7QUFMUyxHQUFULENBQVA7QUFVRCxDQVpEOztBQWNBLEtBQUssTUFBTCxHQUFjLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZTtBQUMzQixTQUFPO0FBQ0wsV0FBTyxNQUFNLE1BQU4sQ0FBYSxFQUFFLEtBQWYsRUFBc0IsRUFBRSxLQUF4QixDQURGO0FBRUwsU0FBSyxNQUFNLE1BQU4sQ0FBYSxFQUFFLEdBQWYsRUFBb0IsRUFBRSxHQUF0QjtBQUZBLEdBQVA7QUFJRCxDQUxEOztBQU9BLEtBQUssT0FBTCxHQUFlLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZTtBQUM1QixTQUFPO0FBQ0wsV0FBTyxNQUFNLE9BQU4sQ0FBYyxDQUFkLEVBQWlCLEVBQUUsS0FBbkIsQ0FERjtBQUVMLFNBQUssTUFBTSxPQUFOLENBQWMsQ0FBZCxFQUFpQixFQUFFLEdBQW5CO0FBRkEsR0FBUDtBQUlELENBTEQ7O0FBT0EsS0FBSyxPQUFMLEdBQWUsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQzVCLFNBQU87QUFDTCxXQUFPLE1BQU0sT0FBTixDQUFjLENBQWQsRUFBaUIsRUFBRSxLQUFuQixDQURGO0FBRUwsU0FBSyxNQUFNLE9BQU4sQ0FBYyxDQUFkLEVBQWlCLEVBQUUsR0FBbkI7QUFGQSxHQUFQO0FBSUQsQ0FMRDs7QUFPQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFlBQVc7QUFDbkMsTUFBSSxPQUFPLEtBQUssR0FBTCxFQUFYO0FBQ0EsU0FBTyxLQUFLLEtBQUssS0FBVixHQUFrQixHQUFsQixHQUF3QixLQUFLLEdBQXBDO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLElBQUwsR0FBWSxVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDekIsU0FBTyxFQUFFLEtBQUYsQ0FBUSxDQUFSLEtBQWMsRUFBRSxLQUFGLENBQVEsQ0FBdEIsR0FDSCxFQUFFLEtBQUYsQ0FBUSxDQUFSLEdBQVksRUFBRSxLQUFGLENBQVEsQ0FEakIsR0FFSCxFQUFFLEtBQUYsQ0FBUSxDQUFSLEdBQVksRUFBRSxLQUFGLENBQVEsQ0FGeEI7QUFHRCxDQUpEOztBQU1BLEtBQUssV0FBTCxHQUFtQixVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDaEMsU0FBTyxFQUFFLEtBQUYsQ0FBUSxDQUFSLElBQWEsRUFBRSxDQUFmLElBQW9CLEVBQUUsR0FBRixDQUFNLENBQU4sSUFBVyxFQUFFLENBQWpDLEdBQ0gsRUFBRSxLQUFGLENBQVEsQ0FBUixLQUFjLEVBQUUsQ0FBaEIsR0FDRSxFQUFFLEtBQUYsQ0FBUSxDQUFSLEdBQVksRUFBRSxDQURoQixHQUVFLEVBQUUsR0FBRixDQUFNLENBQU4sS0FBWSxFQUFFLENBQWQsR0FDRSxFQUFFLEdBQUYsQ0FBTSxDQUFOLEdBQVUsRUFBRSxDQURkLEdBRUUsQ0FMRCxHQU1ILEVBQUUsS0FBRixDQUFRLENBQVIsR0FBWSxFQUFFLENBTmxCO0FBT0QsQ0FSRDs7Ozs7QUMxTEEsT0FBTyxPQUFQLEdBQWlCLFlBQWpCOztBQUVBLFNBQVMsWUFBVCxDQUFzQixLQUF0QixFQUE2QixPQUE3QixFQUFzQztBQUNwQyxNQUFJLFFBQVEsQ0FBQyxDQUFiO0FBQ0EsTUFBSSxPQUFPLENBQUMsQ0FBWjtBQUNBLE1BQUksTUFBTSxDQUFWO0FBQ0EsTUFBSSxPQUFPLE1BQU0sTUFBakI7QUFDQSxNQUFJLENBQUMsSUFBTCxFQUFXLE9BQU87QUFDaEIsVUFBTSxJQURVO0FBRWhCLFdBQU87QUFGUyxHQUFQOztBQUtYLEtBQUc7QUFDRCxXQUFPLEtBQVA7QUFDQSxZQUFRLE9BQU8sT0FBTyxHQUFQLElBQWMsQ0FBckIsQ0FBUjtBQUNBLFFBQUksT0FBTyxNQUFNLEtBQU4sQ0FBWDtBQUNBLFFBQUksU0FBUyxRQUFRLElBQVIsQ0FBYjs7QUFFQSxRQUFJLE1BQUosRUFBWSxNQUFNLEtBQU4sQ0FBWixLQUNLLE9BQU8sS0FBUDtBQUNOLEdBUkQsUUFRUyxTQUFTLEtBUmxCOztBQVVBLE1BQUksUUFBUSxJQUFaLEVBQWtCO0FBQ2hCLFdBQU87QUFDTCxZQUFNLElBREQ7QUFFTCxhQUFPO0FBRkYsS0FBUDtBQUlEOztBQUVELFNBQU87QUFDTCxVQUFNLElBREQ7QUFFTCxXQUFPLENBQUMsR0FBRCxHQUFPLENBQUMsQ0FBUixHQUFZO0FBRmQsR0FBUDtBQUlEOzs7OztBQ2xDRCxPQUFPLE9BQVAsR0FBaUIsVUFBUyxFQUFULEVBQWE7QUFDNUIsTUFBSSxPQUFKO0FBQ0EsU0FBTyxTQUFTLE9BQVQsQ0FBaUIsQ0FBakIsRUFBb0IsQ0FBcEIsRUFBdUIsQ0FBdkIsRUFBMEIsQ0FBMUIsRUFBNkI7QUFDbEMsV0FBTyxvQkFBUCxDQUE0QixPQUE1QjtBQUNBLGNBQVUsT0FBTyxxQkFBUCxDQUE2QixHQUFHLElBQUgsQ0FBUSxJQUFSLEVBQWMsQ0FBZCxFQUFpQixDQUFqQixFQUFvQixDQUFwQixFQUF1QixDQUF2QixDQUE3QixDQUFWO0FBQ0QsR0FIRDtBQUlELENBTkQ7Ozs7O0FDQ0EsT0FBTyxPQUFQLEdBQWlCLEdBQWpCOztBQUVBLFNBQVMsR0FBVCxDQUFhLENBQWIsRUFBZ0I7QUFDZCxNQUFJLENBQUosRUFBTztBQUNMLFNBQUssS0FBTCxHQUFhLEVBQUUsS0FBZjtBQUNBLFNBQUssTUFBTCxHQUFjLEVBQUUsTUFBaEI7QUFDRCxHQUhELE1BR087QUFDTCxTQUFLLEtBQUwsR0FBYSxDQUFiO0FBQ0EsU0FBSyxNQUFMLEdBQWMsQ0FBZDtBQUNEO0FBQ0Y7O0FBRUQsSUFBSSxTQUFKLENBQWMsR0FBZCxHQUFvQixVQUFTLENBQVQsRUFBWTtBQUM5QixPQUFLLEtBQUwsR0FBYSxFQUFFLEtBQWY7QUFDQSxPQUFLLE1BQUwsR0FBYyxFQUFFLE1BQWhCO0FBQ0QsQ0FIRDs7QUFLQSxJQUFJLFNBQUosQ0FBYyxHQUFkLElBQ0EsSUFBSSxTQUFKLENBQWMsR0FBZCxHQUFvQixVQUFTLENBQVQsRUFBWTtBQUM5QixTQUFPLElBQUksR0FBSixDQUFRO0FBQ2IsV0FBTyxLQUFLLEtBQUwsSUFBYyxFQUFFLENBQUYsSUFBTyxFQUFFLEtBQVQsSUFBa0IsQ0FBaEMsQ0FETTtBQUViLFlBQVEsS0FBSyxNQUFMLElBQWUsRUFBRSxDQUFGLElBQU8sRUFBRSxNQUFULElBQW1CLENBQWxDO0FBRkssR0FBUixDQUFQO0FBSUQsQ0FORDs7QUFRQSxJQUFJLFNBQUosQ0FBYyxJQUFkLElBQ0EsSUFBSSxTQUFKLENBQWMsUUFBZCxHQUF5QixVQUFTLENBQVQsRUFBWTtBQUNuQyxTQUFPLElBQUksR0FBSixDQUFRO0FBQ2IsV0FBTyxLQUFLLEtBQUwsSUFBYyxFQUFFLENBQUYsSUFBTyxFQUFFLEtBQVQsSUFBa0IsQ0FBaEMsSUFBcUMsQ0FEL0I7QUFFYixZQUFRLEtBQUssTUFBTCxJQUFlLEVBQUUsQ0FBRixJQUFPLEVBQUUsTUFBVCxJQUFtQixDQUFsQyxJQUF1QztBQUZsQyxHQUFSLENBQVA7QUFJRCxDQU5EOztBQVFBLElBQUksU0FBSixDQUFjLElBQWQsSUFDQSxJQUFJLFNBQUosQ0FBYyxPQUFkLEdBQXdCLFVBQVMsQ0FBVCxFQUFZO0FBQ2xDLFNBQU8sSUFBSSxHQUFKLENBQVE7QUFDYixXQUFPLEtBQUssSUFBTCxDQUFVLEtBQUssS0FBTCxJQUFjLEVBQUUsQ0FBRixJQUFPLEVBQUUsS0FBVCxJQUFrQixDQUFoQyxDQUFWLENBRE07QUFFYixZQUFRLEtBQUssSUFBTCxDQUFVLEtBQUssTUFBTCxJQUFlLEVBQUUsQ0FBRixJQUFPLEVBQUUsTUFBVCxJQUFtQixDQUFsQyxDQUFWO0FBRkssR0FBUixDQUFQO0FBSUQsQ0FORDs7QUFRQSxJQUFJLFNBQUosQ0FBYyxHQUFkLElBQ0EsSUFBSSxTQUFKLENBQWMsR0FBZCxHQUFvQixVQUFTLENBQVQsRUFBWTtBQUM5QixTQUFPLElBQUksR0FBSixDQUFRO0FBQ2IsV0FBTyxLQUFLLEtBQUwsSUFBYyxFQUFFLEtBQUYsSUFBVyxFQUFFLENBQWIsSUFBa0IsQ0FBaEMsQ0FETTtBQUViLFlBQVEsS0FBSyxNQUFMLElBQWUsRUFBRSxNQUFGLElBQVksRUFBRSxDQUFkLElBQW1CLENBQWxDO0FBRkssR0FBUixDQUFQO0FBSUQsQ0FORDs7QUFRQSxJQUFJLFNBQUosQ0FBYyxJQUFkLElBQ0EsSUFBSSxTQUFKLENBQWMsR0FBZCxHQUFvQixVQUFTLENBQVQsRUFBWTtBQUM5QixTQUFPLElBQUksR0FBSixDQUFRO0FBQ2IsV0FBTyxLQUFLLElBQUwsQ0FBVSxLQUFLLEtBQUwsSUFBYyxFQUFFLEtBQUYsSUFBVyxFQUFFLENBQWIsSUFBa0IsQ0FBaEMsQ0FBVixDQURNO0FBRWIsWUFBUSxLQUFLLElBQUwsQ0FBVSxLQUFLLE1BQUwsSUFBZSxFQUFFLE1BQUYsSUFBWSxFQUFFLENBQWQsSUFBbUIsQ0FBbEMsQ0FBVjtBQUZLLEdBQVIsQ0FBUDtBQUlELENBTkQ7O0FBUUEsSUFBSSxTQUFKLENBQWMsSUFBZCxJQUNBLElBQUksU0FBSixDQUFjLEdBQWQsR0FBb0IsVUFBUyxDQUFULEVBQVk7QUFDOUIsU0FBTyxJQUFJLEdBQUosQ0FBUTtBQUNiLFdBQU8sS0FBSyxLQUFMLENBQVcsS0FBSyxLQUFMLElBQWMsRUFBRSxLQUFGLElBQVcsRUFBRSxDQUFiLElBQWtCLENBQWhDLENBQVgsQ0FETTtBQUViLFlBQVEsS0FBSyxLQUFMLENBQVcsS0FBSyxNQUFMLElBQWUsRUFBRSxNQUFGLElBQVksRUFBRSxDQUFkLElBQW1CLENBQWxDLENBQVg7QUFGSyxHQUFSLENBQVA7QUFJRCxDQU5EOztBQVFBLElBQUksU0FBSixDQUFjLElBQWQsSUFDQSxJQUFJLFNBQUosQ0FBYyxHQUFkLEdBQW9CLFVBQVMsQ0FBVCxFQUFZO0FBQzlCLFNBQU8sSUFBSSxHQUFKLENBQVE7QUFDYixXQUFPLEtBQUssS0FBTCxJQUFjLEVBQUUsS0FBRixJQUFXLEVBQUUsQ0FBYixJQUFrQixDQUFoQyxJQUFxQyxDQUQvQjtBQUViLFlBQVEsS0FBSyxNQUFMLElBQWUsRUFBRSxNQUFGLElBQVksRUFBRSxDQUFkLElBQW1CLENBQWxDLElBQXVDO0FBRmxDLEdBQVIsQ0FBUDtBQUlELENBTkQ7O0FBUUEsSUFBSSxTQUFKLENBQWMsR0FBZCxJQUNBLElBQUksU0FBSixDQUFjLEdBQWQsR0FBb0IsVUFBUyxDQUFULEVBQVk7QUFDOUIsU0FBTyxJQUFJLEdBQUosQ0FBUTtBQUNiLFdBQU8sS0FBSyxLQUFMLElBQWMsRUFBRSxLQUFGLElBQVcsRUFBRSxDQUFiLElBQWtCLENBQWhDLENBRE07QUFFYixZQUFRLEtBQUssTUFBTCxJQUFlLEVBQUUsTUFBRixJQUFZLEVBQUUsQ0FBZCxJQUFtQixDQUFsQztBQUZLLEdBQVIsQ0FBUDtBQUlELENBTkQ7Ozs7Ozs7QUN6RUEsT0FBTyxPQUFQLEdBQWlCLFNBQVMsS0FBVCxDQUFlLEdBQWYsRUFBb0I7QUFDbkMsTUFBSSxJQUFJLEVBQVI7QUFDQSxPQUFLLElBQUksR0FBVCxJQUFnQixHQUFoQixFQUFxQjtBQUNuQixRQUFJLE1BQU0sSUFBSSxHQUFKLENBQVY7QUFDQSxRQUFJLHFCQUFvQixHQUFwQix5Q0FBb0IsR0FBcEIsRUFBSixFQUE2QjtBQUMzQixRQUFFLEdBQUYsSUFBUyxNQUFNLEdBQU4sQ0FBVDtBQUNELEtBRkQsTUFFTztBQUNMLFFBQUUsR0FBRixJQUFTLEdBQVQ7QUFDRDtBQUNGO0FBQ0QsU0FBTyxDQUFQO0FBQ0QsQ0FYRDs7Ozs7QUNBQSxPQUFPLE9BQVAsR0FBaUIsVUFBUyxFQUFULEVBQWEsRUFBYixFQUFpQjtBQUNoQyxNQUFJLE9BQUo7O0FBRUEsU0FBTyxTQUFTLFlBQVQsQ0FBc0IsQ0FBdEIsRUFBeUIsQ0FBekIsRUFBNEIsQ0FBNUIsRUFBK0IsQ0FBL0IsRUFBa0M7QUFDdkMsaUJBQWEsT0FBYjtBQUNBLGNBQVUsV0FBVyxHQUFHLElBQUgsQ0FBUSxJQUFSLEVBQWMsQ0FBZCxFQUFpQixDQUFqQixFQUFvQixDQUFwQixFQUF1QixDQUF2QixDQUFYLEVBQXNDLEVBQXRDLENBQVY7QUFDQSxXQUFPLE9BQVA7QUFDRCxHQUpEO0FBS0QsQ0FSRDs7Ozs7QUNEQSxJQUFJLE1BQU0sUUFBUSxRQUFSLENBQVY7QUFDQSxJQUFJLFFBQVEsUUFBUSxVQUFSLENBQVo7QUFDQSxJQUFJLE1BQU0sUUFBUSxhQUFSLENBQVY7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLE1BQWpCOztBQUVBLFNBQVMsTUFBVCxDQUFnQixLQUFoQixFQUF1QixNQUF2QixFQUErQjtBQUM3QixPQUFLLElBQUwsR0FBWSxJQUFJLElBQUksTUFBUixFQUFnQixhQUNoQixJQUFJLEtBRFksRUFFMUIsQ0FBQyxJQUFJLEtBQUwsRUFBWSxhQUNBLElBQUksSUFESixFQUVWLElBQUksSUFGTSxDQUFaLENBRjBCLENBQWhCLENBQVo7QUFPQSxNQUFJLElBQUosQ0FBUyxLQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsQ0FBVCxFQUErQixLQUEvQjtBQUNBLE1BQUksS0FBSixDQUFVLEtBQUssSUFBTCxDQUFVLElBQUksS0FBZCxFQUFxQixJQUFJLElBQXpCLENBQVYsRUFBMEMsRUFBRSxTQUFTLE1BQVgsRUFBMUM7QUFDQSxPQUFLLE1BQUwsR0FBYyxNQUFkO0FBQ0EsT0FBSyxhQUFMLEdBQXFCLEtBQUssYUFBTCxDQUFtQixJQUFuQixDQUF3QixJQUF4QixDQUFyQjtBQUNBLE9BQUssU0FBTCxHQUFpQixLQUFLLFNBQUwsQ0FBZSxJQUFmLENBQW9CLElBQXBCLENBQWpCO0FBQ0EsT0FBSyxPQUFMLEdBQWUsS0FBSyxPQUFMLENBQWEsSUFBYixDQUFrQixJQUFsQixDQUFmO0FBQ0EsT0FBSyxJQUFMLENBQVUsSUFBSSxLQUFkLEVBQXFCLEVBQXJCLENBQXdCLFNBQXhCLEdBQW9DLEtBQUssU0FBekM7QUFDQSxPQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsRUFBckIsQ0FBd0IsT0FBeEIsR0FBa0MsZUFBbEM7QUFDQSxPQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsRUFBckIsQ0FBd0IsU0FBeEIsR0FBb0MsZUFBcEM7QUFDQSxPQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsRUFBckIsQ0FBd0IsV0FBeEIsR0FBc0MsZUFBdEM7QUFDQSxPQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsRUFBckIsQ0FBd0IsT0FBeEIsR0FBa0MsS0FBSyxPQUF2QztBQUNBLE9BQUssTUFBTCxHQUFjLEtBQWQ7QUFDRDs7QUFFRCxPQUFPLFNBQVAsQ0FBaUIsU0FBakIsR0FBNkIsTUFBTSxTQUFuQzs7QUFFQSxTQUFTLGVBQVQsQ0FBeUIsQ0FBekIsRUFBNEI7QUFDMUIsSUFBRSxlQUFGO0FBQ0Q7O0FBRUQsT0FBTyxTQUFQLENBQWlCLFFBQWpCLEdBQTRCLFlBQVc7QUFDckMsU0FBTyxLQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsRUFBckIsQ0FBd0IsUUFBeEIsRUFBUDtBQUNELENBRkQ7O0FBSUEsT0FBTyxTQUFQLENBQWlCLGFBQWpCLEdBQWlDLFVBQVMsQ0FBVCxFQUFZO0FBQzNDLE1BQUksT0FBTyxFQUFFLEtBQWIsRUFBb0I7QUFDbEIsTUFBRSxjQUFGO0FBQ0EsU0FBSyxLQUFMO0FBQ0EsV0FBTyxLQUFQO0FBQ0Q7QUFDRixDQU5EOztBQVFBLE9BQU8sU0FBUCxDQUFpQixTQUFqQixHQUE2QixVQUFTLENBQVQsRUFBWTtBQUN2QyxNQUFJLE9BQU8sRUFBRSxLQUFiLEVBQW9CO0FBQ2xCLE1BQUUsY0FBRjtBQUNBLFNBQUssTUFBTDtBQUNBLFdBQU8sS0FBUDtBQUNEO0FBQ0QsTUFBSSxFQUFFLEtBQUYsSUFBVyxLQUFLLE1BQXBCLEVBQTRCO0FBQzFCLFNBQUssSUFBTCxDQUFVLEtBQVYsRUFBaUIsQ0FBakI7QUFDRDtBQUNGLENBVEQ7O0FBV0EsT0FBTyxTQUFQLENBQWlCLE9BQWpCLEdBQTJCLFVBQVMsQ0FBVCxFQUFZO0FBQ3JDLE9BQUssSUFBTCxDQUFVLE9BQVYsRUFBbUIsS0FBSyxJQUFMLENBQVUsSUFBSSxLQUFkLEVBQXFCLElBQUksSUFBekIsRUFBK0IsRUFBL0IsQ0FBa0MsS0FBckQ7QUFDRCxDQUZEOztBQUlBLE9BQU8sU0FBUCxDQUFpQixJQUFqQixHQUF3QixZQUFXO0FBQ2pDLFdBQVMsSUFBVCxDQUFjLGdCQUFkLENBQStCLFNBQS9CLEVBQTBDLEtBQUssYUFBL0M7QUFDQSxNQUFJLE1BQUosQ0FBVyxTQUFTLElBQXBCLEVBQTBCLEtBQUssSUFBL0I7QUFDQSxNQUFJLEtBQUosQ0FBVSxLQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsSUFBSSxJQUF6QixDQUFWO0FBQ0EsT0FBSyxJQUFMLENBQVUsSUFBSSxLQUFkLEVBQXFCLElBQUksSUFBekIsRUFBK0IsRUFBL0IsQ0FBa0MsTUFBbEM7QUFDQSxPQUFLLE1BQUwsR0FBYyxJQUFkO0FBQ0EsT0FBSyxJQUFMLENBQVUsTUFBVjtBQUNELENBUEQ7O0FBU0EsT0FBTyxTQUFQLENBQWlCLEtBQWpCLEdBQXlCLFlBQVc7QUFDbEMsV0FBUyxJQUFULENBQWMsbUJBQWQsQ0FBa0MsU0FBbEMsRUFBNkMsS0FBSyxhQUFsRDtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxVQUFiLENBQXdCLFdBQXhCLENBQW9DLEtBQUssSUFBTCxDQUFVLEVBQTlDO0FBQ0EsT0FBSyxNQUFMLEdBQWMsS0FBZDtBQUNBLE9BQUssSUFBTCxDQUFVLE9BQVY7QUFDRCxDQUxEOztBQU9BLE9BQU8sU0FBUCxDQUFpQixNQUFqQixHQUEwQixZQUFXO0FBQ25DLE9BQUssSUFBTCxDQUFVLFFBQVYsRUFBb0IsS0FBSyxJQUFMLENBQVUsSUFBSSxLQUFkLEVBQXFCLElBQUksSUFBekIsRUFBK0IsRUFBL0IsQ0FBa0MsS0FBdEQ7QUFDRCxDQUZEOztBQUlBLE9BQU8sU0FBUCxDQUFpQixJQUFqQixHQUF3QixVQUFTLElBQVQsRUFBZTtBQUNyQyxNQUFJLElBQUosQ0FBUyxLQUFLLElBQUwsQ0FBVSxJQUFJLEtBQWQsRUFBcUIsSUFBSSxJQUF6QixDQUFULEVBQXlDLElBQXpDO0FBQ0EsTUFBSSxLQUFKLENBQVUsS0FBSyxJQUFMLENBQVUsSUFBSSxLQUFkLEVBQXFCLElBQUksSUFBekIsQ0FBVixFQUEwQyxFQUFFLFNBQVMsT0FBTyxPQUFQLEdBQWlCLE1BQTVCLEVBQTFDO0FBQ0QsQ0FIRDs7O0FDakZBOzs7Ozs7QUNDQSxPQUFPLE9BQVAsR0FBaUIsSUFBakI7O0FBRUEsU0FBUyxJQUFULENBQWMsQ0FBZCxFQUFpQixDQUFqQixFQUFvQjtBQUNsQixNQUFJLHFCQUFvQixDQUFwQix5Q0FBb0IsQ0FBcEIsRUFBSixFQUEyQjtBQUN6QixRQUFJLElBQUksRUFBUjtBQUNBLFFBQUksSUFBSSxDQUFSO0FBQ0EsU0FBSyxJQUFJLENBQVQsSUFBYyxDQUFkLEVBQWlCO0FBQ2YsVUFBSSxFQUFFLENBQUYsTUFBUyxFQUFFLENBQUYsQ0FBYixFQUFtQjtBQUNqQixVQUFFLENBQUYsSUFBTyxFQUFFLENBQUYsQ0FBUDtBQUNBO0FBQ0Q7QUFDRjtBQUNELFFBQUksQ0FBSixFQUFPLE9BQU8sQ0FBUDtBQUNSLEdBVkQsTUFVTztBQUNMLFdBQU8sTUFBTSxDQUFiO0FBQ0Q7QUFDRjs7Ozs7OztBQ2pCRCxJQUFJLFFBQVEsUUFBUSxTQUFSLENBQVo7QUFDQSxJQUFJLFVBQVUsUUFBUSxZQUFSLENBQWQ7QUFDQSxJQUFJLFVBQVUsUUFBUSxXQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxTQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxRQUFSLENBQVg7QUFDQSxJQUFJLFFBQVEsR0FBRyxLQUFmOztBQUVBLElBQUksUUFBUTtBQUNWLFFBQU0sSUFESTtBQUVWLE9BQUssSUFGSztBQUdWLFNBQU8sSUFIRztBQUlWLFVBQVEsSUFKRTtBQUtWLFNBQU8sSUFMRztBQU1WLFVBQVEsSUFORTtBQU9WLGFBQVcsSUFQRDtBQVFWLGVBQWEsSUFSSDtBQVNWLGNBQVk7QUFURixDQUFaOztBQVlBLE9BQU8sT0FBUCxHQUFpQixHQUFqQjs7QUFFQSxTQUFTLEdBQVQsQ0FBYSxJQUFiLEVBQW1CLFFBQW5CLEVBQTZCLEtBQTdCLEVBQW9DO0FBQ2xDLE1BQUksRUFBSjtBQUNBLE1BQUksTUFBTSxLQUFWO0FBQ0EsTUFBSSxJQUFKOztBQUVBLE1BQUksYUFBYSxPQUFPLElBQXhCLEVBQThCO0FBQzVCLFFBQUksUUFBUSxLQUFLLE1BQUwsQ0FBWSxDQUFaLENBQVosRUFBNEI7QUFDMUIsVUFBSSxVQUFVLEtBQUssS0FBTCxDQUFXLHNCQUFYLENBQWQ7QUFDQSxVQUFJLE9BQUosRUFBYTtBQUNYLGNBQU0sUUFBUSxDQUFSLENBQU47QUFDQSxlQUFPLFFBQVEsQ0FBUixLQUFjLEdBQXJCO0FBQ0Q7QUFDRjtBQUNELFNBQUssU0FBUyxhQUFULENBQXVCLEdBQXZCLENBQUw7QUFDQSxXQUFPO0FBQ0wsVUFBSSxFQURDO0FBRUwsWUFBTSxLQUFLLEtBQUwsQ0FBVyxHQUFYLEVBQWdCLENBQWhCO0FBRkQsS0FBUDtBQUlBLFFBQUksT0FBSixDQUFZLElBQVosRUFBa0IsS0FBSyxLQUFMLENBQVcsR0FBWCxFQUFnQixLQUFoQixDQUFzQixDQUF0QixDQUFsQjtBQUNELEdBZEQsTUFjTyxJQUFJLE1BQU0sT0FBTixDQUFjLElBQWQsQ0FBSixFQUF5QjtBQUM5QixXQUFPLElBQUksS0FBSixDQUFVLElBQVYsRUFBZ0IsSUFBaEIsQ0FBUDtBQUNELEdBRk0sTUFFQTtBQUNMLFFBQUksU0FBUyxJQUFiLEVBQW1CO0FBQ2pCLGFBQU8sS0FBSyxHQUFaO0FBQ0QsS0FGRCxNQUVPO0FBQ0wsYUFBTyxJQUFQO0FBQ0Q7QUFDRjs7QUFFRCxNQUFJLE1BQU0sT0FBTixDQUFjLFFBQWQsQ0FBSixFQUE2QjtBQUMzQixhQUNHLEdBREgsQ0FDTyxHQURQLEVBRUcsR0FGSCxDQUVPLFVBQVMsS0FBVCxFQUFnQixDQUFoQixFQUFtQjtBQUN0QixXQUFLLE1BQU0sSUFBWCxJQUFtQixLQUFuQjtBQUNBLGFBQU8sS0FBUDtBQUNELEtBTEgsRUFNRyxHQU5ILENBTU8sVUFBUyxLQUFULEVBQWdCO0FBQ25CLFdBQUssRUFBTCxDQUFRLFdBQVIsQ0FBb0IsTUFBTSxFQUExQjtBQUNELEtBUkg7QUFTRCxHQVZELE1BVU8sSUFBSSxxQkFBb0IsUUFBcEIseUNBQW9CLFFBQXBCLEVBQUosRUFBa0M7QUFDdkMsUUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQixRQUFoQjtBQUNEOztBQUVELE1BQUksS0FBSixFQUFXO0FBQ1QsUUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQixLQUFoQjtBQUNEOztBQUVELFNBQU8sSUFBUDtBQUNEOztBQUVELElBQUksS0FBSixHQUFZLFFBQVEsVUFBUyxFQUFULEVBQWEsQ0FBYixFQUFnQixLQUFoQixFQUF1QjtBQUN6QyxPQUFLLElBQUksSUFBVCxJQUFpQixLQUFqQjtBQUNFLFFBQUksUUFBUSxLQUFaLEVBQ0UsSUFBSSxNQUFNLElBQU4sTUFBZ0IsTUFBcEIsRUFDRSxNQUFNLElBQU4sS0FBZSxNQUFNLElBQU4sQ0FBZjtBQUhOLEdBSUEsT0FBTyxNQUFQLENBQWMsR0FBRyxLQUFqQixFQUF3QixLQUF4QjtBQUNELENBTlcsRUFNVCxJQU5TLEVBTUgsS0FORyxFQU1JLFVBQVMsSUFBVCxFQUFlLEtBQWYsRUFBc0I7QUFDcEMsTUFBSSxLQUFLLElBQUksVUFBSixDQUFlLElBQWYsQ0FBVDtBQUNBLFNBQU8sQ0FBQyxFQUFELEVBQUssS0FBTCxDQUFQO0FBQ0QsQ0FUVyxDQUFaOztBQVdBOzs7Ozs7Ozs7QUFTQSxJQUFJLE9BQUosR0FBYyxRQUFRLFVBQVMsRUFBVCxFQUFhLFNBQWIsRUFBd0I7QUFDNUMsS0FBRyxTQUFILEdBQWUsU0FBZjtBQUNELENBRmEsRUFFWCxJQUZXLEVBRUwsSUFGSyxFQUVDLFVBQVMsSUFBVCxFQUFlLE9BQWYsRUFBd0I7QUFDckMsTUFBSSxLQUFLLElBQUksVUFBSixDQUFlLElBQWYsQ0FBVDtBQUNBLFNBQU8sQ0FBQyxFQUFELEVBQUssUUFBUSxNQUFSLENBQWUsS0FBSyxJQUFwQixFQUEwQixNQUExQixDQUFpQyxPQUFqQyxFQUEwQyxJQUExQyxDQUErQyxHQUEvQyxDQUFMLENBQVA7QUFDRCxDQUxhLENBQWQ7O0FBT0EsSUFBSSxLQUFKLEdBQVksVUFBUyxFQUFULEVBQWEsS0FBYixFQUFvQjtBQUM5QixPQUFLLElBQUksVUFBSixDQUFlLEVBQWYsQ0FBTDtBQUNBLFNBQU8sTUFBUCxDQUFjLEVBQWQsRUFBa0IsS0FBbEI7QUFDRCxDQUhEOztBQUtBLElBQUksSUFBSixHQUFXLFVBQVMsRUFBVCxFQUFhLElBQWIsRUFBbUI7QUFDNUIsT0FBSyxJQUFJLFVBQUosQ0FBZSxFQUFmLENBQUw7QUFDQSxLQUFHLFNBQUgsR0FBZSxJQUFmO0FBQ0QsQ0FIRDs7QUFLQSxJQUFJLElBQUosR0FBVyxVQUFTLEVBQVQsRUFBYSxJQUFiLEVBQW1CO0FBQzVCLE9BQUssSUFBSSxVQUFKLENBQWUsRUFBZixDQUFMO0FBQ0EsS0FBRyxXQUFILEdBQWlCLElBQWpCO0FBQ0QsQ0FIRDs7QUFLQSxJQUFJLEtBQUosR0FBWSxVQUFTLEVBQVQsRUFBYTtBQUN2QixPQUFLLElBQUksVUFBSixDQUFlLEVBQWYsQ0FBTDtBQUNBLEtBQUcsS0FBSDtBQUNELENBSEQ7O0FBS0EsSUFBSSxPQUFKLEdBQWMsVUFBUyxFQUFULEVBQWE7QUFDekIsT0FBSyxJQUFJLFVBQUosQ0FBZSxFQUFmLENBQUw7QUFDQSxTQUFPO0FBQ0wsV0FBTyxHQUFHLFdBREw7QUFFTCxZQUFRLEdBQUc7QUFGTixHQUFQO0FBSUQsQ0FORDs7QUFRQSxJQUFJLFdBQUosR0FBa0IsVUFBUyxFQUFULEVBQWEsU0FBYixFQUF3QjtBQUN4QyxPQUFLLElBQUksVUFBSixDQUFlLEVBQWYsQ0FBTDtBQUNBLE1BQUksT0FBTyxTQUFTLGFBQVQsQ0FBdUIsTUFBdkIsQ0FBWDtBQUNBLE9BQUssU0FBTCxHQUFpQixTQUFqQjs7QUFFQSxLQUFHLFdBQUgsQ0FBZSxJQUFmOztBQUVBLE9BQUssU0FBTCxHQUFpQixRQUFqQjtBQUNBLE1BQUksSUFBSSxLQUFLLHFCQUFMLEVBQVI7O0FBRUEsT0FBSyxTQUFMLEdBQWlCLHNCQUFqQjtBQUNBLE1BQUksSUFBSSxLQUFLLHFCQUFMLEVBQVI7O0FBRUEsS0FBRyxXQUFILENBQWUsSUFBZjs7QUFFQSxTQUFPO0FBQ0wsV0FBUSxFQUFFLEtBQUYsR0FBVSxFQUFFLEtBRGY7QUFFTCxZQUFTLEVBQUUsTUFBRixHQUFXLEVBQUU7QUFGakIsR0FBUDtBQUlELENBbkJEOztBQXFCQSxJQUFJLFNBQUosR0FBZ0IsVUFBUyxFQUFULEVBQWE7QUFDM0IsT0FBSyxJQUFJLFVBQUosQ0FBZSxFQUFmLENBQUw7QUFDQSxNQUFJLE9BQU8sR0FBRyxxQkFBSCxFQUFYO0FBQ0EsTUFBSSxRQUFRLE9BQU8sZ0JBQVAsQ0FBd0IsRUFBeEIsQ0FBWjtBQUNBLE1BQUksYUFBYSxTQUFTLE1BQU0sZUFBZixDQUFqQjtBQUNBLE1BQUksWUFBWSxTQUFTLE1BQU0sY0FBZixDQUFoQjtBQUNBLFNBQU8sTUFBTSxHQUFOLENBQVUsRUFBRSxHQUFHLENBQUwsRUFBUSxHQUFHLENBQVgsRUFBVixFQUEwQjtBQUMvQixPQUFJLEtBQUssSUFBTCxHQUFZLFVBQWIsR0FBMkIsQ0FEQztBQUUvQixPQUFJLEtBQUssR0FBTCxHQUFXLFNBQVosR0FBeUI7QUFGRyxHQUExQixDQUFQO0FBSUQsQ0FWRDs7QUFZQSxJQUFJLFNBQUosR0FBZ0IsVUFBUyxFQUFULEVBQWE7QUFDM0IsT0FBSyxJQUFJLFVBQUosQ0FBZSxFQUFmLENBQUw7QUFDQSxTQUFPLFVBQVUsRUFBVixDQUFQO0FBQ0QsQ0FIRDs7QUFLQSxJQUFJLFFBQUosR0FBZSxTQUFTLFFBQVQsQ0FBa0IsRUFBbEIsRUFBc0IsRUFBdEIsRUFBMEI7QUFDdkMsT0FBSyxJQUFJLFVBQUosQ0FBZSxFQUFmLENBQUw7O0FBRUEsTUFBSSxTQUFTLElBQVQsS0FBa0IsRUFBdEIsRUFBMEI7QUFDeEIsYUFBUyxnQkFBVCxDQUEwQixRQUExQixFQUFvQyxPQUFwQztBQUNELEdBRkQsTUFFTztBQUNMLE9BQUcsZ0JBQUgsQ0FBb0IsUUFBcEIsRUFBOEIsT0FBOUI7QUFDRDs7QUFFRCxXQUFTLE9BQVQsQ0FBaUIsRUFBakIsRUFBcUI7QUFDbkIsT0FBRyxVQUFVLEVBQVYsQ0FBSDtBQUNEOztBQUVELFNBQU8sU0FBUyxTQUFULEdBQXFCO0FBQzFCLE9BQUcsbUJBQUgsQ0FBdUIsUUFBdkIsRUFBaUMsT0FBakM7QUFDRCxHQUZEO0FBR0QsQ0FoQkQ7O0FBa0JBLElBQUksT0FBSixHQUFjLFNBQVMsT0FBVCxDQUFpQixFQUFqQixFQUFxQixFQUFyQixFQUF5QjtBQUNyQyxPQUFLLElBQUksVUFBSixDQUFlLEVBQWYsQ0FBTDs7QUFFQSxNQUFJLFNBQVMsSUFBVCxLQUFrQixFQUF0QixFQUEwQjtBQUN4QixhQUFTLGdCQUFULENBQTBCLE9BQTFCLEVBQW1DLE9BQW5DO0FBQ0QsR0FGRCxNQUVPO0FBQ0wsT0FBRyxnQkFBSCxDQUFvQixPQUFwQixFQUE2QixPQUE3QjtBQUNEOztBQUVELFdBQVMsT0FBVCxDQUFpQixFQUFqQixFQUFxQjtBQUNuQixPQUFHLEVBQUg7QUFDRDs7QUFFRCxTQUFPLFNBQVMsUUFBVCxHQUFvQjtBQUN6QixPQUFHLG1CQUFILENBQXVCLE9BQXZCLEVBQWdDLE9BQWhDO0FBQ0QsR0FGRDtBQUdELENBaEJEOztBQWtCQSxJQUFJLFFBQUosR0FBZSxVQUFTLEVBQVQsRUFBYSxFQUFiLEVBQWlCO0FBQzlCLE9BQUssSUFBSSxVQUFKLENBQWUsRUFBZixDQUFMO0FBQ0EsU0FBTyxLQUFLLEdBQUcsWUFBZixFQUE2QjtBQUMzQixRQUFJLFFBQUosQ0FBYSxFQUFiLEVBQWlCLEVBQWpCO0FBQ0Q7QUFDRixDQUxEOztBQU9BLElBQUksT0FBSixHQUFjLFVBQVMsRUFBVCxFQUFhLEVBQWIsRUFBaUI7QUFDN0IsU0FBTyxHQUFHLGdCQUFILENBQW9CLE9BQXBCLEVBQTZCLEVBQTdCLENBQVA7QUFDRCxDQUZEOztBQUlBLElBQUksUUFBSixHQUFlLFVBQVMsRUFBVCxFQUFhO0FBQzFCLFNBQU8sT0FBTyxnQkFBUCxDQUF3QixRQUF4QixFQUFrQyxFQUFsQyxDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxJQUFJLE1BQUosR0FBYSxVQUFTLE1BQVQsRUFBaUIsR0FBakIsRUFBc0IsSUFBdEIsRUFBNEI7QUFDdkMsV0FBUyxJQUFJLFVBQUosQ0FBZSxNQUFmLENBQVQ7QUFDQSxNQUFJLGFBQWEsR0FBakIsRUFBc0IsSUFBSSxPQUFKLENBQVksSUFBSSxNQUFKLENBQVcsSUFBWCxDQUFnQixJQUFoQixFQUFzQixNQUF0QixDQUFaO0FBQ3RCO0FBREEsT0FFSyxJQUFJLFNBQVMsSUFBYixFQUFtQixLQUFLLElBQUksR0FBVCxJQUFnQixHQUFoQjtBQUFxQixVQUFJLE1BQUosQ0FBVyxNQUFYLEVBQW1CLElBQUksR0FBSixDQUFuQjtBQUFyQixLQUFuQixNQUNBLElBQUksY0FBYyxPQUFPLEdBQXpCLEVBQThCLE9BQU8sV0FBUCxDQUFtQixJQUFJLFVBQUosQ0FBZSxHQUFmLENBQW5CO0FBQ3BDLENBTkQ7O0FBUUEsSUFBSSxNQUFKLEdBQWEsVUFBUyxFQUFULEVBQWE7QUFDeEIsT0FBSyxJQUFJLFVBQUosQ0FBZSxFQUFmLENBQUw7QUFDQSxNQUFJLEdBQUcsVUFBUCxFQUFtQixHQUFHLFVBQUgsQ0FBYyxXQUFkLENBQTBCLEVBQTFCO0FBQ3BCLENBSEQ7O0FBS0EsSUFBSSxVQUFKLEdBQWlCLFVBQVMsRUFBVCxFQUFhO0FBQzVCLFNBQU8sR0FBRyxHQUFILElBQVUsR0FBRyxHQUFILENBQU8sRUFBakIsSUFBdUIsR0FBRyxFQUExQixJQUFnQyxHQUFHLElBQW5DLElBQTJDLEVBQWxEO0FBQ0QsQ0FGRDs7QUFJQSxJQUFJLFFBQUosR0FBZSxVQUFTLEVBQVQsRUFBYSxDQUFiLEVBQWdCLENBQWhCLEVBQW1CLE1BQW5CLEVBQTJCO0FBQ3hDLFdBQVMsVUFBVSxJQUFJLFNBQUosQ0FBYyxFQUFkLENBQW5CO0FBQ0EsTUFBSSxRQUFKLENBQWEsRUFBYixFQUFpQixPQUFPLENBQVAsR0FBVyxDQUE1QixFQUErQixPQUFPLENBQVAsR0FBVyxDQUExQztBQUNELENBSEQ7O0FBS0EsSUFBSSxRQUFKLEdBQWUsVUFBUyxFQUFULEVBQWEsQ0FBYixFQUFnQixDQUFoQixFQUFtQjtBQUNoQyxNQUFJLFNBQVMsSUFBVCxLQUFrQixFQUF0QixFQUEwQjtBQUN4QixXQUFPLFFBQVAsQ0FBZ0IsQ0FBaEIsRUFBbUIsQ0FBbkI7QUFDRCxHQUZELE1BRU87QUFDTCxPQUFHLFVBQUgsR0FBZ0IsS0FBSyxDQUFyQjtBQUNBLE9BQUcsU0FBSCxHQUFlLEtBQUssQ0FBcEI7QUFDRDtBQUNGLENBUEQ7O0FBU0EsSUFBSSxHQUFKLEdBQVUsVUFBUyxFQUFULEVBQWEsT0FBYixFQUFzQjtBQUM5QixNQUFJLEVBQUUsTUFBTSxJQUFJLEdBQUosQ0FBUSxNQUFoQixDQUFKLEVBQTZCO0FBQzNCLFFBQUksR0FBSixDQUFRLE1BQVIsQ0FBZSxFQUFmLElBQXFCLFNBQVMsYUFBVCxDQUF1QixPQUF2QixDQUFyQjtBQUNBLGFBQVMsSUFBVCxDQUFjLFdBQWQsQ0FBMEIsSUFBSSxHQUFKLENBQVEsTUFBUixDQUFlLEVBQWYsQ0FBMUI7QUFDRDtBQUNELE1BQUksR0FBSixDQUFRLE1BQVIsQ0FBZSxFQUFmLEVBQW1CLFdBQW5CLEdBQWlDLE9BQWpDO0FBQ0QsQ0FORDs7QUFRQSxJQUFJLEdBQUosQ0FBUSxNQUFSLEdBQWlCLEVBQWpCOztBQUVBLElBQUksYUFBSixHQUFvQixVQUFTLENBQVQsRUFBWTtBQUM5QixTQUFPLElBQUksS0FBSixDQUFVO0FBQ2YsT0FBRyxFQUFFLE9BRFU7QUFFZixPQUFHLEVBQUU7QUFGVSxHQUFWLENBQVA7QUFJRCxDQUxEOztBQU9BLFNBQVMsU0FBVCxDQUFtQixFQUFuQixFQUF1QjtBQUNyQixTQUFPLFNBQVMsSUFBVCxLQUFrQixFQUFsQixHQUNIO0FBQ0UsT0FBRyxPQUFPLE9BQVAsSUFBa0IsR0FBRyxVQUFyQixJQUFtQyxTQUFTLGVBQVQsQ0FBeUIsVUFEakU7QUFFRSxPQUFHLE9BQU8sT0FBUCxJQUFrQixHQUFHLFNBQXJCLElBQW1DLFNBQVMsZUFBVCxDQUF5QjtBQUZqRSxHQURHLEdBS0g7QUFDRSxPQUFHLEdBQUcsVUFEUjtBQUVFLE9BQUcsR0FBRztBQUZSLEdBTEo7QUFTRDs7Ozs7QUNoUkQsSUFBSSxPQUFPLEdBQUcsSUFBZDtBQUNBLElBQUksUUFBUSxHQUFHLEtBQWY7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLEtBQWpCOztBQUVBLFNBQVMsS0FBVCxHQUFpQjtBQUNmLE1BQUksRUFBRSxnQkFBZ0IsS0FBbEIsQ0FBSixFQUE4QixPQUFPLElBQUksS0FBSixFQUFQOztBQUU5QixPQUFLLFNBQUwsR0FBaUIsRUFBakI7QUFDRDs7QUFFRCxNQUFNLFNBQU4sQ0FBZ0IsWUFBaEIsR0FBK0IsVUFBUyxJQUFULEVBQWU7QUFDNUMsT0FBSyxTQUFMLEdBQWlCLEtBQUssU0FBTCxJQUFrQixFQUFuQztBQUNBLFNBQU8sS0FBSyxTQUFMLENBQWUsSUFBZixJQUF1QixLQUFLLFNBQUwsQ0FBZSxJQUFmLEtBQXdCLEVBQXREO0FBQ0QsQ0FIRDs7QUFLQSxNQUFNLFNBQU4sQ0FBZ0IsSUFBaEIsR0FBdUIsVUFBUyxJQUFULEVBQWUsQ0FBZixFQUFrQixDQUFsQixFQUFxQixDQUFyQixFQUF3QixDQUF4QixFQUEyQjtBQUNoRCxNQUFJLEtBQUssTUFBVCxFQUFpQjtBQUNqQixNQUFJLFdBQVcsS0FBSyxZQUFMLENBQWtCLElBQWxCLENBQWY7QUFDQSxPQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksU0FBUyxNQUE3QixFQUFxQyxHQUFyQyxFQUEwQztBQUN4QyxhQUFTLENBQVQsRUFBWSxDQUFaLEVBQWUsQ0FBZixFQUFrQixDQUFsQixFQUFxQixDQUFyQjtBQUNEO0FBQ0YsQ0FORDs7QUFRQSxNQUFNLFNBQU4sQ0FBZ0IsRUFBaEIsR0FBcUIsVUFBUyxJQUFULEVBQWU7QUFDbEMsTUFBSSxRQUFKO0FBQ0EsTUFBSSxjQUFjLE1BQU0sSUFBTixDQUFXLFNBQVgsRUFBc0IsQ0FBdEIsQ0FBbEI7QUFDQSxNQUFJLE1BQU0sT0FBTixDQUFjLElBQWQsQ0FBSixFQUF5QjtBQUN2QixTQUFLLE9BQUwsQ0FBYSxVQUFTLElBQVQsRUFBZTtBQUMxQixpQkFBVyxLQUFLLFlBQUwsQ0FBa0IsSUFBbEIsQ0FBWDtBQUNBLFdBQUssS0FBTCxDQUFXLFFBQVgsRUFBcUIsWUFBWSxJQUFaLENBQXJCO0FBQ0QsS0FIRCxFQUdHLElBSEg7QUFJRCxHQUxELE1BS087QUFDTCxlQUFXLEtBQUssWUFBTCxDQUFrQixJQUFsQixDQUFYO0FBQ0EsU0FBSyxLQUFMLENBQVcsUUFBWCxFQUFxQixXQUFyQjtBQUNEO0FBQ0YsQ0FaRDs7QUFjQSxNQUFNLFNBQU4sQ0FBZ0IsR0FBaEIsR0FBc0IsVUFBUyxJQUFULEVBQWUsT0FBZixFQUF3QjtBQUM1QyxNQUFJLFdBQVcsS0FBSyxZQUFMLENBQWtCLElBQWxCLENBQWY7QUFDQSxNQUFJLFFBQVEsU0FBUyxPQUFULENBQWlCLE9BQWpCLENBQVo7QUFDQSxNQUFJLENBQUMsS0FBTCxFQUFZLFNBQVMsTUFBVCxDQUFnQixLQUFoQixFQUF1QixDQUF2QjtBQUNiLENBSkQ7O0FBTUEsTUFBTSxTQUFOLENBQWdCLElBQWhCLEdBQXVCLFVBQVMsSUFBVCxFQUFlLEVBQWYsRUFBbUI7QUFDeEMsTUFBSSxXQUFXLEtBQUssWUFBTCxDQUFrQixJQUFsQixDQUFmO0FBQ0EsTUFBSSxVQUFVLFNBQVYsT0FBVSxDQUFTLENBQVQsRUFBWSxDQUFaLEVBQWUsQ0FBZixFQUFrQixDQUFsQixFQUFxQjtBQUNqQyxPQUFHLENBQUgsRUFBTSxDQUFOLEVBQVMsQ0FBVCxFQUFZLENBQVo7QUFDQSxhQUFTLE1BQVQsQ0FBZ0IsU0FBUyxPQUFULENBQWlCLE9BQWpCLENBQWhCLEVBQTJDLENBQTNDO0FBQ0QsR0FIRDtBQUlBLFdBQVMsSUFBVCxDQUFjLE9BQWQ7QUFDRCxDQVBEOzs7OztBQzdDQSxJQUFJLFFBQVEsUUFBUSxTQUFSLENBQVo7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLFNBQVMsT0FBVCxDQUFpQixFQUFqQixFQUFxQixJQUFyQixFQUEyQixLQUEzQixFQUFrQyxHQUFsQyxFQUF1QztBQUN0RCxTQUFPLFFBQVEsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQUUsV0FBTyxNQUFNLENBQWI7QUFBZ0IsR0FBaEQ7QUFDQSxVQUFRLFNBQVMsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQUUsV0FBTyxDQUFQO0FBQVUsR0FBNUM7QUFDQSxRQUFNLE9BQU8sVUFBUyxJQUFULEVBQWUsS0FBZixFQUFzQjtBQUFFLFdBQU8sS0FBUDtBQUFjLEdBQW5EOztBQUVBLE1BQUksUUFBUSxFQUFaO0FBQ0EsTUFBSSxRQUFRLEVBQVo7QUFDQSxNQUFJLFVBQVUsRUFBZDs7QUFFQSxTQUFPLFVBQVMsSUFBVCxFQUFlLEtBQWYsRUFBc0I7QUFDM0IsUUFBSSxPQUFPLElBQUksSUFBSixFQUFVLEtBQVYsQ0FBWDtBQUNBLFdBQU8sS0FBSyxDQUFMLENBQVA7QUFDQSxZQUFRLEtBQUssQ0FBTCxDQUFSOztBQUVBLFFBQUksUUFBUSxNQUFNLE9BQU4sQ0FBYyxJQUFkLENBQVo7QUFDQSxRQUFJLENBQUMsS0FBTCxFQUFZO0FBQ1YsVUFBSSxJQUFJLEtBQUssTUFBTSxLQUFOLENBQUwsRUFBbUIsS0FBbkIsQ0FBUjtBQUNBLFVBQUksQ0FBQyxDQUFMLEVBQVEsT0FBTyxRQUFRLEtBQVIsQ0FBUCxDQUFSLEtBQ0s7QUFDSCxjQUFNLEtBQU4sSUFBZSxNQUFNLE1BQU0sS0FBTixDQUFOLEVBQW9CLEtBQXBCLENBQWY7QUFDQSxnQkFBUSxLQUFSLElBQWlCLEdBQUcsSUFBSCxFQUFTLEtBQVQsRUFBZ0IsQ0FBaEIsQ0FBakI7QUFDRDtBQUNGLEtBUEQsTUFPTztBQUNMLFlBQU0sSUFBTixDQUFXLE1BQU0sS0FBTixDQUFYO0FBQ0EsWUFBTSxJQUFOLENBQVcsSUFBWDtBQUNBLGNBQVEsUUFBUSxJQUFSLENBQWEsR0FBRyxJQUFILEVBQVMsS0FBVCxFQUFnQixLQUFoQixDQUFiLENBQVI7QUFDRDs7QUFFRCxXQUFPLFFBQVEsS0FBUixDQUFQO0FBQ0QsR0FwQkQ7QUFxQkQsQ0E5QkQ7Ozs7O0FDREEsT0FBTyxPQUFQLEdBQWlCLFNBQVMsS0FBVCxDQUFlLElBQWYsRUFBcUIsR0FBckIsRUFBMEI7QUFDekMsT0FBSyxJQUFJLEdBQVQsSUFBZ0IsR0FBaEIsRUFBcUI7QUFDbkIsU0FBSyxHQUFMLElBQVksSUFBSSxHQUFKLENBQVo7QUFDRDtBQUNELFNBQU8sSUFBUDtBQUNELENBTEQ7Ozs7O0FDQUEsT0FBTyxPQUFQLEdBQWlCLElBQWpCOztBQUVBLFNBQVMsSUFBVCxDQUFjLEdBQWQsRUFBbUIsRUFBbkIsRUFBdUI7QUFDckIsU0FBTyxNQUFNLEdBQU4sRUFDSixJQURJLENBQ0MsT0FERCxFQUVKLElBRkksQ0FFQyxHQUFHLElBQUgsQ0FBUSxJQUFSLEVBQWMsSUFBZCxDQUZELEVBR0osS0FISSxDQUdFLEVBSEYsQ0FBUDtBQUlEOztBQUVELFNBQVMsT0FBVCxDQUFpQixHQUFqQixFQUFzQjtBQUNwQixTQUFPLElBQUksSUFBSixFQUFQO0FBQ0Q7Ozs7O0FDWEQsT0FBTyxPQUFQLEdBQWlCLEtBQWpCOztBQUVBLFNBQVMsS0FBVCxDQUFlLENBQWYsRUFBa0I7QUFDaEIsTUFBSSxDQUFKLEVBQU87QUFDTCxTQUFLLENBQUwsR0FBUyxFQUFFLENBQVg7QUFDQSxTQUFLLENBQUwsR0FBUyxFQUFFLENBQVg7QUFDRCxHQUhELE1BR087QUFDTCxTQUFLLENBQUwsR0FBUyxDQUFUO0FBQ0EsU0FBSyxDQUFMLEdBQVMsQ0FBVDtBQUNEO0FBQ0Y7O0FBRUQsTUFBTSxTQUFOLENBQWdCLEdBQWhCLEdBQXNCLFVBQVMsQ0FBVCxFQUFZO0FBQ2hDLE9BQUssQ0FBTCxHQUFTLEVBQUUsQ0FBWDtBQUNBLE9BQUssQ0FBTCxHQUFTLEVBQUUsQ0FBWDtBQUNELENBSEQ7O0FBS0EsTUFBTSxTQUFOLENBQWdCLElBQWhCLEdBQXVCLFlBQVc7QUFDaEMsU0FBTyxJQUFJLEtBQUosQ0FBVSxJQUFWLENBQVA7QUFDRCxDQUZEOztBQUlBLE1BQU0sU0FBTixDQUFnQixRQUFoQixHQUEyQixVQUFTLENBQVQsRUFBWTtBQUNyQyxPQUFLLENBQUwsSUFBVSxDQUFWO0FBQ0EsU0FBTyxJQUFQO0FBQ0QsQ0FIRDs7QUFLQSxNQUFNLFNBQU4sQ0FBZ0IsR0FBaEIsSUFDQSxNQUFNLFNBQU4sQ0FBZ0IsR0FBaEIsR0FBc0IsVUFBUyxDQUFULEVBQVk7QUFDaEMsU0FBTyxJQUFJLEtBQUosQ0FBVTtBQUNmLE9BQUcsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxLQUFULElBQWtCLENBQTVCLENBRFk7QUFFZixPQUFHLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsTUFBVCxJQUFtQixDQUE3QjtBQUZZLEdBQVYsQ0FBUDtBQUlELENBTkQ7O0FBUUEsTUFBTSxTQUFOLENBQWdCLElBQWhCLElBQ0EsTUFBTSxTQUFOLENBQWdCLFFBQWhCLEdBQTJCLFVBQVMsQ0FBVCxFQUFZO0FBQ3JDLFNBQU8sSUFBSSxLQUFKLENBQVU7QUFDZixPQUFHLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsS0FBVCxJQUFrQixDQUE1QixJQUFpQyxDQURyQjtBQUVmLE9BQUcsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxNQUFULElBQW1CLENBQTdCLElBQWtDO0FBRnRCLEdBQVYsQ0FBUDtBQUlELENBTkQ7O0FBUUEsTUFBTSxTQUFOLENBQWdCLElBQWhCLElBQ0EsTUFBTSxTQUFOLENBQWdCLFFBQWhCLEdBQTJCLFVBQVMsQ0FBVCxFQUFZO0FBQ3JDLFNBQU8sSUFBSSxLQUFKLENBQVU7QUFDZixPQUFHLEtBQUssS0FBTCxDQUFXLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsS0FBVCxJQUFrQixDQUE1QixDQUFYLENBRFk7QUFFZixPQUFHLEtBQUssS0FBTCxDQUFXLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsTUFBVCxJQUFtQixDQUE3QixDQUFYO0FBRlksR0FBVixDQUFQO0FBSUQsQ0FORDs7QUFRQSxNQUFNLFNBQU4sQ0FBZ0IsSUFBaEIsSUFDQSxNQUFNLFNBQU4sQ0FBZ0IsT0FBaEIsR0FBMEIsVUFBUyxDQUFULEVBQVk7QUFDcEMsU0FBTyxJQUFJLEtBQUosQ0FBVTtBQUNmLE9BQUcsS0FBSyxJQUFMLENBQVUsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxLQUFULElBQWtCLENBQTVCLENBQVYsQ0FEWTtBQUVmLE9BQUcsS0FBSyxJQUFMLENBQVUsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxNQUFULElBQW1CLENBQTdCLENBQVY7QUFGWSxHQUFWLENBQVA7QUFJRCxDQU5EOztBQVFBLE1BQU0sU0FBTixDQUFnQixHQUFoQixJQUNBLE1BQU0sU0FBTixDQUFnQixHQUFoQixHQUFzQixVQUFTLENBQVQsRUFBWTtBQUNoQyxTQUFPLElBQUksS0FBSixDQUFVO0FBQ2YsT0FBRyxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsSUFBTyxFQUFFLEtBQVQsSUFBa0IsQ0FBNUIsQ0FEWTtBQUVmLE9BQUcsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxNQUFULElBQW1CLENBQTdCO0FBRlksR0FBVixDQUFQO0FBSUQsQ0FORDs7QUFRQSxNQUFNLFNBQU4sQ0FBZ0IsR0FBaEIsSUFDQSxNQUFNLFNBQU4sQ0FBZ0IsR0FBaEIsR0FBc0IsVUFBUyxDQUFULEVBQVk7QUFDaEMsU0FBTyxJQUFJLEtBQUosQ0FBVTtBQUNmLE9BQUcsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxLQUFULElBQWtCLENBQTVCLENBRFk7QUFFZixPQUFHLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsTUFBVCxJQUFtQixDQUE3QjtBQUZZLEdBQVYsQ0FBUDtBQUlELENBTkQ7O0FBUUEsTUFBTSxTQUFOLENBQWdCLEdBQWhCLElBQ0EsTUFBTSxTQUFOLENBQWdCLEdBQWhCLEdBQXNCLFVBQVMsQ0FBVCxFQUFZO0FBQ2hDLFNBQU8sSUFBSSxLQUFKLENBQVU7QUFDZixPQUFHLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsS0FBVCxJQUFrQixDQUE1QixDQURZO0FBRWYsT0FBRyxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsSUFBTyxFQUFFLE1BQVQsSUFBbUIsQ0FBN0I7QUFGWSxHQUFWLENBQVA7QUFJRCxDQU5EOztBQVFBLE1BQU0sU0FBTixDQUFnQixJQUFoQixJQUNBLE1BQU0sU0FBTixDQUFnQixPQUFoQixHQUEwQixVQUFTLENBQVQsRUFBWTtBQUNwQyxTQUFPLElBQUksS0FBSixDQUFVO0FBQ2YsT0FBRyxLQUFLLElBQUwsQ0FBVSxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsSUFBTyxFQUFFLEtBQVQsSUFBa0IsQ0FBNUIsQ0FBVixDQURZO0FBRWYsT0FBRyxLQUFLLElBQUwsQ0FBVSxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsSUFBTyxFQUFFLE1BQVQsSUFBbUIsQ0FBN0IsQ0FBVjtBQUZZLEdBQVYsQ0FBUDtBQUlELENBTkQ7O0FBUUEsTUFBTSxTQUFOLENBQWdCLElBQWhCLElBQ0EsTUFBTSxTQUFOLENBQWdCLFFBQWhCLEdBQTJCLFVBQVMsQ0FBVCxFQUFZO0FBQ3JDLFNBQU8sSUFBSSxLQUFKLENBQVU7QUFDZixPQUFHLEtBQUssS0FBTCxDQUFXLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsS0FBVCxJQUFrQixDQUE1QixDQUFYLENBRFk7QUFFZixPQUFHLEtBQUssS0FBTCxDQUFXLEtBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixJQUFPLEVBQUUsTUFBVCxJQUFtQixDQUE3QixDQUFYO0FBRlksR0FBVixDQUFQO0FBSUQsQ0FORDs7QUFRQSxNQUFNLFNBQU4sQ0FBZ0IsSUFBaEIsSUFDQSxNQUFNLFNBQU4sQ0FBZ0IsUUFBaEIsR0FBMkIsVUFBUyxDQUFULEVBQVk7QUFDckMsU0FBTyxJQUFJLEtBQUosQ0FBVTtBQUNmLE9BQUcsS0FBSyxDQUFMLElBQVUsRUFBRSxDQUFGLElBQU8sRUFBRSxLQUFULElBQWtCLENBQTVCLElBQWlDLENBRHJCO0FBRWYsT0FBRyxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsSUFBTyxFQUFFLE1BQVQsSUFBbUIsQ0FBN0IsSUFBa0M7QUFGdEIsR0FBVixDQUFQO0FBSUQsQ0FORDs7QUFRQSxNQUFNLFNBQU4sQ0FBZ0IsSUFBaEIsR0FBdUIsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQ3BDLFNBQU8sSUFBSSxLQUFKLENBQVU7QUFDZixPQUFHLEtBQUssQ0FBTCxHQUFVLENBQUMsRUFBRSxDQUFGLEdBQU0sS0FBSyxDQUFaLElBQWlCLENBRGY7QUFFZixPQUFHLEtBQUssQ0FBTCxHQUFVLENBQUMsRUFBRSxDQUFGLEdBQU0sS0FBSyxDQUFaLElBQWlCO0FBRmYsR0FBVixDQUFQO0FBSUQsQ0FMRDs7QUFPQSxNQUFNLFNBQU4sQ0FBZ0IsUUFBaEIsR0FBMkIsWUFBVztBQUNwQyxTQUFPLEtBQUssQ0FBTCxHQUFTLEdBQVQsR0FBZSxLQUFLLENBQTNCO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLElBQU4sR0FBYSxVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDMUIsU0FBTyxFQUFFLENBQUYsS0FBUSxFQUFFLENBQVYsR0FDSCxFQUFFLENBQUYsR0FBTSxFQUFFLENBREwsR0FFSCxFQUFFLENBQUYsR0FBTSxFQUFFLENBRlo7QUFHRCxDQUpEOztBQU1BLE1BQU0sU0FBTixHQUFrQixVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDL0IsU0FBTztBQUNMLE9BQUcsS0FBSyxLQUFMLENBQVcsRUFBRSxDQUFGLEdBQU0sRUFBRSxLQUFuQixDQURFO0FBRUwsT0FBRyxLQUFLLEtBQUwsQ0FBVyxFQUFFLENBQUYsR0FBTSxFQUFFLE1BQW5CO0FBRkUsR0FBUDtBQUlELENBTEQ7O0FBT0EsTUFBTSxHQUFOLEdBQVksVUFBUyxHQUFULEVBQWMsQ0FBZCxFQUFpQjtBQUMzQixTQUFPO0FBQ0wsT0FBRyxLQUFLLEdBQUwsQ0FBUyxJQUFJLENBQWIsRUFBZ0IsRUFBRSxDQUFsQixDQURFO0FBRUwsT0FBRyxLQUFLLEdBQUwsQ0FBUyxJQUFJLENBQWIsRUFBZ0IsRUFBRSxDQUFsQjtBQUZFLEdBQVA7QUFJRCxDQUxEOztBQU9BLE1BQU0sS0FBTixHQUFjLFVBQVMsSUFBVCxFQUFlLENBQWYsRUFBa0I7QUFDOUIsU0FBTyxJQUFJLEtBQUosQ0FBVTtBQUNmLE9BQUcsS0FBSyxHQUFMLENBQVMsS0FBSyxHQUFMLENBQVMsQ0FBbEIsRUFBcUIsS0FBSyxHQUFMLENBQVMsS0FBSyxLQUFMLENBQVcsQ0FBcEIsRUFBdUIsRUFBRSxDQUF6QixDQUFyQixDQURZO0FBRWYsT0FBRyxLQUFLLEdBQUwsQ0FBUyxLQUFLLEdBQUwsQ0FBUyxDQUFsQixFQUFxQixLQUFLLEdBQUwsQ0FBUyxLQUFLLEtBQUwsQ0FBVyxDQUFwQixFQUF1QixFQUFFLENBQXpCLENBQXJCO0FBRlksR0FBVixDQUFQO0FBSUQsQ0FMRDs7QUFPQSxNQUFNLE1BQU4sR0FBZSxVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDNUIsU0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFGLEdBQU0sRUFBRSxDQUFiLEVBQWdCLEdBQUcsRUFBRSxDQUFGLEdBQU0sRUFBRSxDQUEzQixFQUFQO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLE9BQU4sR0FBZ0IsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQzdCLFNBQU8sRUFBRSxHQUFHLEVBQUUsQ0FBRixHQUFNLENBQVgsRUFBYyxHQUFHLEVBQUUsQ0FBbkIsRUFBUDtBQUNELENBRkQ7O0FBSUEsTUFBTSxPQUFOLEdBQWdCLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZTtBQUM3QixTQUFPLEVBQUUsR0FBRyxFQUFFLENBQVAsRUFBVSxHQUFHLEVBQUUsQ0FBRixHQUFNLENBQW5CLEVBQVA7QUFDRCxDQUZEOztBQUlBLE1BQU0sU0FBTixHQUFrQixVQUFTLENBQVQsRUFBWTtBQUM1QixTQUFPO0FBQ0wsVUFBTSxFQUFFLENBREg7QUFFTCxTQUFLLEVBQUU7QUFGRixHQUFQO0FBSUQsQ0FMRDs7Ozs7QUM1SkEsT0FBTyxPQUFQLEdBQWlCLEdBQWpCOztBQUVBLFNBQVMsR0FBVCxDQUFhLENBQWIsRUFBZ0IsQ0FBaEIsRUFBbUI7QUFDakIsTUFBSSxRQUFRLEtBQVo7QUFDQSxNQUFJLFFBQVEsSUFBWjtBQUNBLE1BQUksTUFBTSxFQUFWOztBQUVBLE9BQUssSUFBSSxJQUFJLEVBQUUsQ0FBRixDQUFiLEVBQW1CLEtBQUssRUFBRSxDQUFGLENBQXhCLEVBQThCLEdBQTlCLEVBQW1DO0FBQ2pDLFlBQVEsS0FBUjs7QUFFQSxTQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksRUFBRSxNQUF0QixFQUE4QixHQUE5QixFQUFtQztBQUNqQyxVQUFJLEtBQUssRUFBRSxDQUFGLEVBQUssQ0FBTCxDQUFMLElBQWdCLEtBQUssRUFBRSxDQUFGLEVBQUssQ0FBTCxDQUF6QixFQUFrQztBQUNoQyxnQkFBUSxJQUFSO0FBQ0E7QUFDRDtBQUNGOztBQUVELFFBQUksS0FBSixFQUFXO0FBQ1QsVUFBSSxDQUFDLEtBQUwsRUFBWTtBQUNWLGdCQUFRLENBQUMsQ0FBRCxFQUFHLENBQUgsQ0FBUjtBQUNBLFlBQUksSUFBSixDQUFTLEtBQVQ7QUFDRDtBQUNELFlBQU0sQ0FBTixJQUFXLENBQVg7QUFDRCxLQU5ELE1BTU87QUFDTCxjQUFRLElBQVI7QUFDRDtBQUNGOztBQUVELFNBQU8sR0FBUDtBQUNEOzs7OztBQzdCRCxPQUFPLE9BQVAsR0FBaUIsR0FBakI7O0FBRUEsU0FBUyxHQUFULENBQWEsQ0FBYixFQUFnQixDQUFoQixFQUFtQjtBQUNqQixNQUFJLFFBQVEsS0FBWjtBQUNBLE1BQUksUUFBUSxJQUFaO0FBQ0EsTUFBSSxNQUFNLEVBQVY7O0FBRUEsT0FBSyxJQUFJLElBQUksRUFBRSxDQUFGLENBQWIsRUFBbUIsS0FBSyxFQUFFLENBQUYsQ0FBeEIsRUFBOEIsR0FBOUIsRUFBbUM7QUFDakMsWUFBUSxLQUFSOztBQUVBLFNBQUssSUFBSSxJQUFJLENBQWIsRUFBZ0IsSUFBSSxFQUFFLE1BQXRCLEVBQThCLEdBQTlCLEVBQW1DO0FBQ2pDLFVBQUksS0FBSyxFQUFFLENBQUYsRUFBSyxDQUFMLENBQUwsSUFBZ0IsS0FBSyxFQUFFLENBQUYsRUFBSyxDQUFMLENBQXpCLEVBQWtDO0FBQ2hDLGdCQUFRLElBQVI7QUFDQTtBQUNEO0FBQ0Y7O0FBRUQsUUFBSSxDQUFDLEtBQUwsRUFBWTtBQUNWLFVBQUksQ0FBQyxLQUFMLEVBQVk7QUFDVixnQkFBUSxDQUFDLENBQUQsRUFBRyxDQUFILENBQVI7QUFDQSxZQUFJLElBQUosQ0FBUyxLQUFUO0FBQ0Q7QUFDRCxZQUFNLENBQU4sSUFBVyxDQUFYO0FBQ0QsS0FORCxNQU1PO0FBQ0wsY0FBUSxJQUFSO0FBQ0Q7QUFDRjs7QUFFRCxTQUFPLEdBQVA7QUFDRDs7Ozs7QUM5QkQsSUFBSSxNQUFNLFFBQVEsa0JBQVIsQ0FBVjtBQUNBLElBQUksTUFBTSxRQUFRLGtCQUFSLENBQVY7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLEtBQWpCOztBQUVBLFNBQVMsS0FBVCxDQUFlLENBQWYsRUFBa0I7QUFDaEIsTUFBSSxDQUFKLEVBQU87QUFDTCxTQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsQ0FBVjtBQUNBLFNBQUssQ0FBTCxJQUFVLEVBQUUsQ0FBRixDQUFWO0FBQ0QsR0FIRCxNQUdPO0FBQ0wsU0FBSyxDQUFMLElBQVUsQ0FBVjtBQUNBLFNBQUssQ0FBTCxJQUFVLENBQVY7QUFDRDtBQUNGOztBQUVELE1BQU0sR0FBTixHQUFZLEdBQVo7QUFDQSxNQUFNLEdBQU4sR0FBWSxHQUFaOztBQUVBLE1BQU0sSUFBTixHQUFhLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZTtBQUMxQixTQUFPLEVBQUUsQ0FBRixLQUFRLEVBQUUsQ0FBVixHQUNILEVBQUUsQ0FBRixHQUFNLEVBQUUsQ0FETCxHQUVILEVBQUUsQ0FBRixHQUFNLEVBQUUsQ0FGWjtBQUdELENBSkQ7O0FBTUEsTUFBTSxLQUFOLEdBQWMsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQzNCLFNBQU8sRUFBRSxDQUFGLE1BQVMsRUFBRSxDQUFGLENBQVQsSUFBaUIsRUFBRSxDQUFGLE1BQVMsRUFBRSxDQUFGLENBQWpDO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLEtBQU4sR0FBYyxVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDM0IsU0FBTyxJQUFJLEtBQUosQ0FBVSxDQUNmLEtBQUssR0FBTCxDQUFTLEVBQUUsQ0FBRixDQUFULEVBQWUsS0FBSyxHQUFMLENBQVMsRUFBRSxDQUFGLENBQVQsRUFBZSxFQUFFLENBQUYsQ0FBZixDQUFmLENBRGUsRUFFZixLQUFLLEdBQUwsQ0FBUyxFQUFFLENBQUYsQ0FBVCxFQUFlLEVBQUUsQ0FBRixDQUFmLENBRmUsQ0FBVixDQUFQO0FBSUQsQ0FMRDs7QUFPQSxNQUFNLFNBQU4sQ0FBZ0IsS0FBaEIsR0FBd0IsWUFBVztBQUNqQyxTQUFPLElBQUksS0FBSixDQUFVLElBQVYsQ0FBUDtBQUNELENBRkQ7O0FBSUEsTUFBTSxNQUFOLEdBQWUsVUFBUyxLQUFULEVBQWdCO0FBQzdCLFNBQU8sTUFBTSxHQUFOLENBQVUsVUFBUyxJQUFULEVBQWU7QUFBRSxXQUFPLEtBQUssS0FBWjtBQUFtQixHQUE5QyxDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLFNBQU4sQ0FBZ0IsTUFBaEIsR0FBeUIsVUFBUyxLQUFULEVBQWdCO0FBQ3ZDLE1BQUksUUFBUSxJQUFaO0FBQ0EsU0FBTyxNQUFNLE1BQU4sQ0FBYSxVQUFTLElBQVQsRUFBZTtBQUNqQyxXQUFPLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsTUFBTSxDQUFOLENBQWpCLElBQTZCLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsTUFBTSxDQUFOLENBQXJEO0FBQ0QsR0FGTSxDQUFQO0FBR0QsQ0FMRDs7QUFPQSxNQUFNLFNBQU4sQ0FBZ0IsT0FBaEIsR0FBMEIsVUFBUyxLQUFULEVBQWdCO0FBQ3hDLE1BQUksUUFBUSxJQUFaO0FBQ0EsU0FBTyxNQUFNLE1BQU4sQ0FBYSxVQUFTLElBQVQsRUFBZTtBQUNqQyxXQUFPLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsTUFBTSxDQUFOLENBQWpCLElBQTZCLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsTUFBTSxDQUFOLENBQXJEO0FBQ0QsR0FGTSxDQUFQO0FBR0QsQ0FMRDs7QUFPQSxNQUFNLFNBQU4sQ0FBZ0IsT0FBaEIsR0FBMEIsVUFBUyxLQUFULEVBQWdCO0FBQ3hDLE1BQUksUUFBUSxJQUFaO0FBQ0EsU0FBTyxNQUFNLE1BQU4sQ0FBYSxVQUFTLElBQVQsRUFBZTtBQUNqQyxXQUFPLEtBQUssS0FBTCxDQUFXLENBQVgsSUFBZ0IsTUFBTSxDQUFOLENBQWhCLElBQTRCLEtBQUssS0FBTCxDQUFXLENBQVgsSUFBZ0IsTUFBTSxDQUFOLENBQW5EO0FBQ0QsR0FGTSxDQUFQO0FBR0QsQ0FMRDs7Ozs7QUN4REEsSUFBSSxTQUFTLE9BQWI7O0FBRUEsT0FBTyxNQUFQLEdBQWdCLFVBQVMsS0FBVCxFQUFnQixLQUFoQixFQUF1QixFQUF2QixFQUEyQjtBQUN6QyxPQUFLLE1BQU0sVUFBUyxDQUFULEVBQVk7QUFBRSxXQUFPLENBQVA7QUFBVSxHQUFuQztBQUNBLFNBQU8sSUFBSSxNQUFKLENBQ0wsTUFDQyxHQURELENBQ0ssVUFBQyxDQUFEO0FBQUEsV0FBTyxhQUFhLE9BQU8sQ0FBcEIsR0FBd0IsT0FBTyxLQUFQLENBQWEsQ0FBYixDQUF4QixHQUEwQyxDQUFqRDtBQUFBLEdBREwsRUFFQyxHQUZELENBRUssVUFBQyxDQUFEO0FBQUEsV0FBTyxHQUFHLEVBQUUsUUFBRixHQUFhLEtBQWIsQ0FBbUIsQ0FBbkIsRUFBcUIsQ0FBQyxDQUF0QixDQUFILENBQVA7QUFBQSxHQUZMLEVBR0MsSUFIRCxDQUdNLEdBSE4sQ0FESyxFQUtMLEtBTEssQ0FBUDtBQU9ELENBVEQ7O0FBV0EsT0FBTyxLQUFQLEdBQWU7QUFDYixZQUFVLGlCQURHO0FBRWIsV0FBUyxpQkFGSTtBQUdiLFdBQVMsZ0RBSEk7O0FBS2Isb0JBQWtCLFVBTEw7QUFNYixvQkFBa0IsZUFOTDtBQU9iLHlCQUF1QiwrQkFQVjtBQVFiLHlCQUF1QiwrQkFSVjtBQVNiLHFCQUFtQix3QkFUTjs7QUFXYixjQUFZLDRFQVhDO0FBWWIsY0FBWSwrRkFaQztBQWFiLGFBQVcsMFBBYkU7QUFjYixhQUFXLHdEQWRFO0FBZWIsYUFBVyw4WUFmRTtBQWdCYixhQUFXLGlDQWhCRTtBQWlCYixZQUFVLHlCQWpCRztBQWtCYixZQUFVLCtEQWxCRztBQW1CYixZQUFVLGFBbkJHO0FBb0JiLFlBQVUseURBcEJHOztBQXNCYixTQUFPLFNBdEJNO0FBdUJiLFNBQU8sa0VBdkJNO0FBd0JiLFlBQVUsVUF4Qkc7QUF5QmIsVUFBUSxVQXpCSztBQTBCYixhQUFXO0FBMUJFLENBQWY7O0FBNkJBLE9BQU8sS0FBUCxDQUFhLE9BQWIsR0FBdUIsT0FBTyxNQUFQLENBQWMsQ0FDbkMsZ0JBRG1DLEVBRW5DLGdCQUZtQyxDQUFkLENBQXZCOztBQUtBLE9BQU8sS0FBUCxDQUFhLE1BQWIsR0FBc0IsT0FBTyxNQUFQLENBQWMsQ0FDbEMscUJBRGtDLEVBRWxDLHFCQUZrQyxFQUdsQyxpQkFIa0MsQ0FBZCxDQUF0Qjs7QUFNQSxPQUFPLEtBQVAsQ0FBYSxTQUFiLEdBQXlCLE9BQU8sTUFBUCxDQUFjLENBQ3JDLGdCQURxQyxFQUVyQyxpQkFGcUMsRUFHckMsUUFIcUMsRUFJckMsTUFKcUMsQ0FBZCxDQUF6Qjs7QUFPQSxPQUFPLEtBQVAsR0FBZSxVQUFTLENBQVQsRUFBWSxNQUFaLEVBQW9CLE1BQXBCLEVBQTRCO0FBQ3pDLE1BQUksUUFBUSxFQUFaO0FBQ0EsTUFBSSxJQUFKOztBQUVBLE1BQUksTUFBSixFQUFZO0FBQ1YsV0FBTyxPQUFPLE9BQU8sSUFBUCxDQUFZLENBQVosQ0FBZCxFQUE4QjtBQUM1QixVQUFJLE9BQU8sSUFBUCxDQUFKLEVBQWtCLE1BQU0sSUFBTixDQUFXLElBQVg7QUFDbkI7QUFDRixHQUpELE1BSU87QUFDTCxXQUFPLE9BQU8sT0FBTyxJQUFQLENBQVksQ0FBWixDQUFkLEVBQThCO0FBQzVCLFlBQU0sSUFBTixDQUFXLElBQVg7QUFDRDtBQUNGOztBQUVELFNBQU8sS0FBUDtBQUNELENBZkQ7Ozs7O0FDNURBLE9BQU8sT0FBUCxHQUFpQixJQUFqQjs7QUFFQSxTQUFTLElBQVQsQ0FBYyxHQUFkLEVBQW1CLEdBQW5CLEVBQXdCLEVBQXhCLEVBQTRCO0FBQzFCLFdBQU8sTUFBTSxHQUFOLEVBQVc7QUFDZCxnQkFBUSxNQURNO0FBRWQsY0FBTTtBQUZRLEtBQVgsRUFJSixJQUpJLENBSUMsR0FBRyxJQUFILENBQVEsSUFBUixFQUFjLElBQWQsQ0FKRCxFQUtKLEtBTEksQ0FLRSxFQUxGLENBQVA7QUFNRDs7Ozs7QUNWRDtBQUNBOztBQUVDLGFBQVc7QUFDUjs7QUFFQSxRQUFJLE9BQU8sWUFBWCxFQUF5QjtBQUNyQjtBQUNIOztBQUVELFFBQUksVUFBVSxFQUFkO0FBQUEsUUFDSSxhQUFhLENBRGpCOztBQUdBLGFBQVMsU0FBVCxDQUFtQixNQUFuQixFQUEyQjtBQUN2QixZQUFJLFdBQVcsUUFBUSxNQUFSLENBQWY7QUFDQSxZQUFJLFFBQUosRUFBYztBQUNWLG1CQUFPLFFBQVEsTUFBUixDQUFQO0FBQ0EscUJBQVMsRUFBVCxDQUFZLEtBQVosQ0FBa0IsSUFBbEIsRUFBd0IsU0FBUyxJQUFqQztBQUNIO0FBQ0o7O0FBRUQsV0FBTyxZQUFQLEdBQXNCLFVBQVMsRUFBVCxFQUFhO0FBQy9CLFlBQUksT0FBTyxNQUFNLFNBQU4sQ0FBZ0IsS0FBaEIsQ0FBc0IsSUFBdEIsQ0FBMkIsU0FBM0IsRUFBc0MsQ0FBdEMsQ0FBWDtBQUFBLFlBQ0ksTUFESjs7QUFHQSxZQUFJLE9BQU8sRUFBUCxLQUFjLFVBQWxCLEVBQThCO0FBQzFCLGtCQUFNLElBQUksU0FBSixDQUFjLGtCQUFkLENBQU47QUFDSDs7QUFFRCxpQkFBUyxZQUFUO0FBQ0EsZ0JBQVEsTUFBUixJQUFrQixFQUFFLElBQUksRUFBTixFQUFVLE1BQU0sSUFBaEIsRUFBbEI7O0FBRUEsWUFBSSxPQUFKLENBQVksVUFBUyxPQUFULEVBQWtCO0FBQzFCLG9CQUFRLE1BQVI7QUFDSCxTQUZELEVBRUcsSUFGSCxDQUVRLFNBRlI7O0FBSUEsZUFBTyxNQUFQO0FBQ0gsS0FoQkQ7O0FBa0JBLFdBQU8sY0FBUCxHQUF3QixVQUFTLE1BQVQsRUFBaUI7QUFDckMsZUFBTyxRQUFRLE1BQVIsQ0FBUDtBQUNILEtBRkQ7QUFHSCxDQXZDQSxHQUFEOzs7OztBQ0ZBLE9BQU8sT0FBUCxHQUFpQixVQUFTLEVBQVQsRUFBYSxFQUFiLEVBQWlCO0FBQ2hDLE1BQUksT0FBSixFQUFhLE9BQWI7O0FBRUEsU0FBTyxVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWUsQ0FBZixFQUFrQjtBQUN2QixRQUFJLE9BQUosRUFBYTtBQUNiLGNBQVUsSUFBVjtBQUNBLE9BQUcsSUFBSCxDQUFRLElBQVIsRUFBYyxDQUFkLEVBQWlCLENBQWpCLEVBQW9CLENBQXBCO0FBQ0EsZUFBVyxLQUFYLEVBQWtCLEVBQWxCO0FBQ0QsR0FMRDs7QUFPQSxXQUFTLEtBQVQsR0FBaUI7QUFDZixjQUFVLEtBQVY7QUFDRDtBQUNGLENBYkQ7Ozs7O0FDREEsSUFBSSxPQUFPLFFBQVEsZ0JBQVIsQ0FBWDtBQUNBLElBQUksUUFBUSxRQUFRLGlCQUFSLENBQVo7QUFDQSxJQUFJLFFBQVEsUUFBUSxpQkFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsa0JBQVIsQ0FBYjs7QUFFQSxJQUFJLGFBQWEsUUFBUSxjQUFSLENBQWpCO0FBQ0EsSUFBSSxhQUFhLFFBQVEsY0FBUixDQUFqQjtBQUNBLElBQUksV0FBVyxRQUFRLFlBQVIsQ0FBZjtBQUNBLElBQUksVUFBVSxRQUFRLFdBQVIsQ0FBZDtBQUNBLElBQUksU0FBUyxRQUFRLFVBQVIsQ0FBYjtBQUNBLElBQUksU0FBUyxRQUFRLFVBQVIsQ0FBYjs7QUFFQSxJQUFJLE1BQU0sYUFBVjtBQUNBLElBQUksVUFBVSxLQUFkO0FBQ0EsSUFBSSxRQUFRLE9BQU8sTUFBUCxDQUFjLENBQUMsUUFBRCxDQUFkLEVBQTBCLEdBQTFCLENBQVo7O0FBRUEsSUFBSSxVQUFVO0FBQ1osYUFBVyxJQURDO0FBRVosWUFBVTtBQUZFLENBQWQ7O0FBS0EsT0FBTyxPQUFQLEdBQWlCLE1BQWpCOztBQUVBLFNBQVMsTUFBVCxHQUFrQjtBQUNoQixPQUFLLEdBQUwsR0FBVyxFQUFYO0FBQ0EsT0FBSyxNQUFMLEdBQWMsSUFBSSxNQUFKLEVBQWQ7QUFDQSxPQUFLLE9BQUwsR0FBZSxJQUFJLE9BQUosQ0FBWSxJQUFaLENBQWY7QUFDQSxPQUFLLFFBQUwsR0FBZ0IsSUFBSSxRQUFKLENBQWEsSUFBYixDQUFoQjtBQUNBLE9BQUssT0FBTCxDQUFhLEVBQWI7QUFDRDs7QUFFRCxPQUFPLFNBQVAsQ0FBaUIsU0FBakIsR0FBNkIsTUFBTSxTQUFuQzs7QUFFQSxPQUFPLFNBQVAsQ0FBaUIsU0FBakIsR0FBNkIsWUFBVztBQUN0QyxPQUFLLEdBQUwsR0FBVyxLQUFLLElBQUwsQ0FBVSxRQUFWLEVBQVg7QUFDRCxDQUZEOztBQUlBLE9BQU8sU0FBUCxDQUFpQixJQUFqQixHQUF3QixZQUFXO0FBQ2pDLE9BQUssU0FBTDtBQUNBLE1BQUksU0FBUyxJQUFJLE1BQUosRUFBYjtBQUNBLFNBQU8sT0FBUCxDQUFlLElBQWY7QUFDQSxTQUFPLE1BQVA7QUFDRCxDQUxEOztBQU9BLE9BQU8sU0FBUCxDQUFpQixPQUFqQixHQUEyQixVQUFTLElBQVQsRUFBZTtBQUN4QyxPQUFLLEdBQUwsR0FBVyxLQUFLLEdBQWhCO0FBQ0EsT0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLEtBQUssR0FBbkI7QUFDQSxPQUFLLE1BQUwsR0FBYyxLQUFLLE1BQUwsQ0FBWSxJQUFaLEVBQWQ7QUFDQSxPQUFLLFFBQUwsQ0FBYyxVQUFkO0FBQ0QsQ0FMRDs7QUFPQSxPQUFPLFNBQVAsQ0FBaUIsT0FBakIsR0FBMkIsVUFBUyxJQUFULEVBQWU7QUFDeEMsU0FBTyxhQUFhLElBQWIsQ0FBUDs7QUFFQSxPQUFLLEdBQUwsR0FBVyxJQUFYLENBSHdDLENBR3hCOztBQUVoQixPQUFLLE1BQUwsQ0FBWSxHQUFaLEdBQWtCLENBQUMsS0FBSyxHQUFMLENBQVMsT0FBVCxDQUFpQixJQUFqQixDQUFELEdBQTBCLElBQTFCLEdBQWlDLEdBQW5EOztBQUVBLE9BQUssSUFBTCxHQUFZLElBQUksVUFBSixFQUFaO0FBQ0EsT0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLEtBQUssR0FBbkI7O0FBRUEsT0FBSyxNQUFMLEdBQWMsSUFBSSxNQUFKLEVBQWQ7QUFDQSxPQUFLLE1BQUwsQ0FBWSxLQUFaLENBQWtCLEtBQUssR0FBdkI7QUFDQSxPQUFLLE1BQUwsQ0FBWSxFQUFaLENBQWUsaUJBQWYsRUFBa0MsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsaUJBQXJCLENBQWxDOztBQUVBLE9BQUssTUFBTCxHQUFjLElBQUksVUFBSixFQUFkO0FBQ0EsT0FBSyxNQUFMLENBQVksS0FBWixDQUFrQixLQUFLLEdBQXZCOztBQUVBLE9BQUssSUFBTCxDQUFVLEtBQVY7QUFDRCxDQWxCRDs7QUFvQkEsT0FBTyxTQUFQLENBQWlCLE1BQWpCLEdBQ0EsT0FBTyxTQUFQLENBQWlCLGlCQUFqQixHQUFxQyxVQUFTLENBQVQsRUFBWSxJQUFaLEVBQWtCLEtBQWxCLEVBQXlCO0FBQzVELE9BQUssSUFBTCxDQUFVLGVBQVY7O0FBRUEsU0FBTyxhQUFhLElBQWIsQ0FBUDs7QUFFQSxNQUFJLFNBQVMsS0FBSyxNQUFsQjtBQUNBLE1BQUksUUFBUSxLQUFLLFFBQUwsQ0FBYyxDQUFkLENBQVo7QUFDQSxNQUFJLFFBQVEsQ0FBQyxLQUFLLEtBQUwsQ0FBVyxPQUFYLEtBQXVCLEVBQXhCLEVBQTRCLE1BQXhDO0FBQ0EsTUFBSSxRQUFRLENBQUMsTUFBTSxDQUFQLEVBQVUsTUFBTSxDQUFOLEdBQVUsS0FBcEIsQ0FBWjtBQUNBLE1BQUksY0FBYyxLQUFLLG1CQUFMLENBQXlCLEtBQXpCLENBQWxCOztBQUVBLE1BQUksU0FBUyxLQUFLLGtCQUFMLENBQXdCLFdBQXhCLENBQWI7QUFDQSxPQUFLLElBQUwsQ0FBVSxNQUFWLENBQWlCLE1BQU0sTUFBdkIsRUFBK0IsSUFBL0I7QUFDQSxjQUFZLENBQVosS0FBa0IsS0FBSyxNQUF2QjtBQUNBLE1BQUksUUFBUSxLQUFLLGtCQUFMLENBQXdCLFdBQXhCLENBQVo7QUFDQSxPQUFLLE1BQUwsQ0FBWSxLQUFaLENBQWtCLEtBQWxCO0FBQ0EsT0FBSyxNQUFMLENBQVksTUFBWixDQUFtQixXQUFuQixFQUFnQyxLQUFoQyxFQUF1QyxNQUF2QztBQUNBLE9BQUssUUFBTCxDQUFjLFVBQWQsQ0FBeUIsWUFBWSxDQUFaLENBQXpCOztBQUVBLE1BQUksQ0FBQyxLQUFMLEVBQVk7QUFDVixRQUFJLFVBQVUsS0FBSyxHQUFMLENBQVMsS0FBSyxHQUFMLENBQVMsTUFBVCxHQUFrQixDQUEzQixDQUFkO0FBQ0EsUUFBSSxXQUFXLFFBQVEsQ0FBUixNQUFlLFFBQTFCLElBQXNDLFFBQVEsQ0FBUixFQUFXLENBQVgsTUFBa0IsTUFBTSxNQUFsRSxFQUEwRTtBQUN4RSxjQUFRLENBQVIsRUFBVyxDQUFYLEtBQWlCLEtBQUssTUFBdEI7QUFDQSxjQUFRLENBQVIsS0FBYyxJQUFkO0FBQ0QsS0FIRCxNQUdPO0FBQ0wsV0FBSyxHQUFMLENBQVMsSUFBVCxDQUFjLENBQUMsUUFBRCxFQUFXLENBQUMsTUFBTSxNQUFQLEVBQWUsTUFBTSxNQUFOLEdBQWUsS0FBSyxNQUFuQyxDQUFYLEVBQXVELElBQXZELENBQWQ7QUFDRDtBQUNGOztBQUVELE9BQUssSUFBTCxDQUFVLFFBQVYsRUFBb0IsS0FBcEIsRUFBMkIsS0FBM0IsRUFBa0MsTUFBbEMsRUFBMEMsS0FBMUM7O0FBRUEsU0FBTyxLQUFLLE1BQVo7QUFDRCxDQWpDRDs7QUFtQ0EsT0FBTyxTQUFQLENBQWlCLE1BQWpCLEdBQ0EsT0FBTyxTQUFQLENBQWlCLGlCQUFqQixHQUFxQyxVQUFTLENBQVQsRUFBWSxLQUFaLEVBQW1CO0FBQ3RELE9BQUssSUFBTCxDQUFVLGVBQVY7O0FBRUE7QUFDQSxNQUFJLElBQUksS0FBSyxjQUFMLENBQW9CLEVBQUUsQ0FBRixDQUFwQixDQUFSO0FBQ0EsTUFBSSxJQUFJLEtBQUssY0FBTCxDQUFvQixFQUFFLENBQUYsQ0FBcEIsQ0FBUjtBQUNBLE1BQUksU0FBUyxFQUFFLENBQUYsSUFBTyxFQUFFLENBQUYsQ0FBcEI7QUFDQSxNQUFJLFFBQVEsQ0FBQyxFQUFFLENBQUgsRUFBTSxFQUFFLENBQVIsQ0FBWjtBQUNBLE1BQUksUUFBUSxFQUFFLENBQUYsR0FBTSxFQUFFLENBQXBCO0FBQ0E7O0FBRUEsTUFBSSxjQUFjLEtBQUssbUJBQUwsQ0FBeUIsS0FBekIsQ0FBbEI7QUFDQSxNQUFJLFNBQVMsS0FBSyxrQkFBTCxDQUF3QixXQUF4QixDQUFiO0FBQ0EsTUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLFFBQVYsQ0FBbUIsQ0FBbkIsQ0FBWDtBQUNBLE9BQUssSUFBTCxDQUFVLE1BQVYsQ0FBaUIsQ0FBakI7QUFDQSxjQUFZLENBQVosS0FBa0IsTUFBbEI7QUFDQSxNQUFJLFFBQVEsS0FBSyxrQkFBTCxDQUF3QixXQUF4QixDQUFaO0FBQ0EsT0FBSyxNQUFMLENBQVksS0FBWixDQUFrQixLQUFsQjtBQUNBLE9BQUssTUFBTCxDQUFZLE1BQVosQ0FBbUIsV0FBbkIsRUFBZ0MsS0FBaEMsRUFBdUMsTUFBdkM7QUFDQSxPQUFLLFFBQUwsQ0FBYyxVQUFkLENBQXlCLFlBQVksQ0FBWixDQUF6Qjs7QUFFQSxNQUFJLENBQUMsS0FBTCxFQUFZO0FBQ1YsUUFBSSxVQUFVLEtBQUssR0FBTCxDQUFTLEtBQUssR0FBTCxDQUFTLE1BQVQsR0FBa0IsQ0FBM0IsQ0FBZDtBQUNBLFFBQUksV0FBVyxRQUFRLENBQVIsTUFBZSxRQUExQixJQUFzQyxRQUFRLENBQVIsRUFBVyxDQUFYLE1BQWtCLEVBQUUsQ0FBRixDQUE1RCxFQUFrRTtBQUNoRSxjQUFRLENBQVIsRUFBVyxDQUFYLEtBQWlCLEtBQUssTUFBdEI7QUFDQSxjQUFRLENBQVIsSUFBYSxPQUFPLFFBQVEsQ0FBUixDQUFwQjtBQUNELEtBSEQsTUFHTztBQUNMLFdBQUssR0FBTCxDQUFTLElBQVQsQ0FBYyxDQUFDLFFBQUQsRUFBVyxDQUFYLEVBQWMsSUFBZCxDQUFkO0FBQ0Q7QUFDRjs7QUFFRCxPQUFLLElBQUwsQ0FBVSxRQUFWLEVBQW9CLEtBQXBCLEVBQTJCLEtBQTNCLEVBQWtDLE1BQWxDLEVBQTBDLEtBQTFDO0FBQ0QsQ0FqQ0Q7O0FBbUNBLE9BQU8sU0FBUCxDQUFpQixVQUFqQixHQUE4QixVQUFTLElBQVQsRUFBZTtBQUMzQyxNQUFJLFVBQVUsS0FBSyxrQkFBTCxDQUF3QixJQUF4QixDQUFkO0FBQ0EsU0FBTyxLQUFLLGlCQUFMLENBQXVCLE9BQXZCLENBQVA7QUFDRCxDQUhEOztBQUtBLE9BQU8sU0FBUCxDQUFpQixpQkFBakIsR0FBcUMsVUFBUyxDQUFULEVBQVk7QUFDL0MsTUFBSSxRQUFRLEtBQUssUUFBTCxDQUFjLENBQWQsQ0FBWjtBQUNBLE1BQUksY0FBYyxDQUFDLE1BQU0sTUFBUCxFQUFlLE1BQU0sTUFBTixHQUFhLENBQTVCLENBQWxCO0FBQ0EsU0FBTyxLQUFLLGlCQUFMLENBQXVCLFdBQXZCLENBQVA7QUFDRCxDQUpEOztBQU1BLE9BQU8sU0FBUCxDQUFpQixHQUFqQixHQUF1QixVQUFTLEtBQVQsRUFBZ0I7QUFDckMsTUFBSSxPQUFPLEtBQUssZ0JBQUwsQ0FBc0IsS0FBdEIsQ0FBWDs7QUFFQTtBQUNBO0FBQ0EsTUFBSSxPQUFPLEtBQUssS0FBTCxDQUFXLEtBQUssV0FBTCxDQUFpQixJQUFqQixDQUFYLENBQVg7QUFDQSxNQUFJLFVBQVUsS0FBZDtBQUNBLE1BQUksSUFBSSxNQUFNLENBQU4sQ0FBUjtBQUNBLE1BQUksUUFBUSxRQUFRLElBQVIsQ0FBYSxJQUFiLENBQVo7QUFDQSxTQUFPLENBQUMsS0FBRCxJQUFVLElBQUksS0FBSyxHQUFMLEVBQXJCLEVBQWlDO0FBQy9CLFFBQUksUUFBUSxLQUFLLFdBQUwsQ0FBaUIsRUFBRSxDQUFuQixDQUFaO0FBQ0EsWUFBUSxTQUFSLEdBQW9CLENBQXBCO0FBQ0EsWUFBUSxRQUFRLElBQVIsQ0FBYSxLQUFiLENBQVI7QUFDRDtBQUNELE1BQUksU0FBUyxDQUFiO0FBQ0EsTUFBSSxLQUFKLEVBQVcsU0FBUyxNQUFNLEtBQWY7QUFDWCxNQUFJLGFBQWEsT0FBTyxJQUFJLEtBQUosQ0FBVSxTQUFTLENBQW5CLEVBQXNCLElBQXRCLENBQTJCLEtBQUssTUFBTCxDQUFZLEdBQXZDLENBQXhCOztBQUVBLE1BQUksVUFBVSxLQUFLLFFBQUwsQ0FBYyxHQUFkLENBQWtCLE1BQU0sQ0FBTixDQUFsQixDQUFkO0FBQ0EsTUFBSSxPQUFKLEVBQWE7QUFDWCxXQUFPLFFBQVEsT0FBUixJQUFtQixVQUFuQixHQUFnQyxJQUFoQyxHQUF1QyxVQUF2QyxHQUFvRCxXQUEzRDtBQUNBLFdBQU8sS0FBSyxNQUFMLENBQVksU0FBWixDQUFzQixJQUF0QixDQUFQO0FBQ0EsV0FBTyxNQUFNLFFBQVEsQ0FBUixDQUFOLEdBQW1CLEdBQW5CLEdBQ0wsS0FBSyxTQUFMLENBQ0UsS0FBSyxPQUFMLENBQWEsUUFBYixJQUF5QixDQUQzQixFQUVFLEtBQUssV0FBTCxDQUFpQixRQUFqQixDQUZGLENBREY7QUFLRCxHQVJELE1BUU87QUFDTCxXQUFPLEtBQUssTUFBTCxDQUFZLFNBQVosQ0FBc0IsT0FBTyxVQUFQLEdBQW9CLFdBQTFDLENBQVA7QUFDQSxXQUFPLEtBQUssU0FBTCxDQUFlLENBQWYsRUFBa0IsS0FBSyxXQUFMLENBQWlCLFFBQWpCLENBQWxCLENBQVA7QUFDRDtBQUNELFNBQU8sSUFBUDtBQUNELENBaENEOztBQWtDQSxPQUFPLFNBQVAsQ0FBaUIsT0FBakIsR0FBMkIsVUFBUyxDQUFULEVBQVk7QUFDckMsTUFBSSxPQUFPLElBQUksSUFBSixFQUFYO0FBQ0EsT0FBSyxXQUFMLEdBQW1CLEtBQUssbUJBQUwsQ0FBeUIsQ0FBQyxDQUFELEVBQUcsQ0FBSCxDQUF6QixDQUFuQjtBQUNBLE9BQUssTUFBTCxHQUFjLEtBQUssV0FBTCxDQUFpQixDQUFqQixDQUFkO0FBQ0EsT0FBSyxNQUFMLEdBQWMsS0FBSyxXQUFMLENBQWlCLENBQWpCLElBQXNCLEtBQUssV0FBTCxDQUFpQixDQUFqQixDQUF0QixJQUE2QyxJQUFJLEtBQUssR0FBTCxFQUFqRCxDQUFkO0FBQ0EsT0FBSyxLQUFMLENBQVcsR0FBWCxDQUFlLEVBQUUsR0FBRSxDQUFKLEVBQU8sR0FBRSxDQUFULEVBQWY7QUFDQSxTQUFPLElBQVA7QUFDRCxDQVBEOztBQVNBLE9BQU8sU0FBUCxDQUFpQixRQUFqQixHQUE0QixVQUFTLENBQVQsRUFBWTtBQUN0QyxNQUFJLE9BQU8sS0FBSyxPQUFMLENBQWEsRUFBRSxDQUFmLENBQVg7QUFDQSxNQUFJLFFBQVEsSUFBSSxLQUFKLENBQVU7QUFDcEIsT0FBRyxLQUFLLEdBQUwsQ0FBUyxLQUFLLE1BQWQsRUFBc0IsRUFBRSxDQUF4QixDQURpQjtBQUVwQixPQUFHLEtBQUssS0FBTCxDQUFXO0FBRk0sR0FBVixDQUFaO0FBSUEsUUFBTSxNQUFOLEdBQWUsS0FBSyxNQUFMLEdBQWMsTUFBTSxDQUFuQztBQUNBLFFBQU0sS0FBTixHQUFjLEtBQWQ7QUFDQSxRQUFNLElBQU4sR0FBYSxJQUFiO0FBQ0EsU0FBTyxLQUFQO0FBQ0QsQ0FWRDs7QUFZQSxPQUFPLFNBQVAsQ0FBaUIsZ0JBQWpCLEdBQW9DLFVBQVMsS0FBVCxFQUFnQjtBQUNsRCxNQUFJLFVBQVUsS0FBSyxtQkFBTCxDQUF5QixLQUF6QixDQUFkO0FBQ0EsTUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLFFBQVYsQ0FBbUIsT0FBbkIsQ0FBWDtBQUNBLFNBQU8sSUFBUDtBQUNELENBSkQ7O0FBTUEsT0FBTyxTQUFQLENBQWlCLG1CQUFqQixHQUF1QyxVQUFTLEtBQVQsRUFBZ0I7QUFDckQsTUFBSSxJQUFJLEtBQUssYUFBTCxDQUFtQixNQUFNLENBQU4sQ0FBbkIsQ0FBUjtBQUNBLE1BQUksSUFBSSxNQUFNLENBQU4sS0FBWSxLQUFLLEdBQUwsRUFBWixHQUNKLEtBQUssSUFBTCxDQUFVLE1BRE4sR0FFSixLQUFLLGFBQUwsQ0FBbUIsTUFBTSxDQUFOLElBQVcsQ0FBOUIsQ0FGSjtBQUdBLE1BQUksVUFBVSxDQUFDLENBQUQsRUFBSSxDQUFKLENBQWQ7QUFDQSxTQUFPLE9BQVA7QUFDRCxDQVBEOztBQVNBLE9BQU8sU0FBUCxDQUFpQixrQkFBakIsR0FBc0MsVUFBUyxXQUFULEVBQXNCO0FBQzFELE1BQUksT0FBTyxLQUFLLElBQUwsQ0FBVSxRQUFWLENBQW1CLFdBQW5CLENBQVg7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUhEOztBQUtBLE9BQU8sU0FBUCxDQUFpQixjQUFqQixHQUFrQyxVQUFTLE1BQVQsRUFBaUI7QUFDakQsTUFBSSxRQUFRLEtBQUssTUFBTCxDQUFZLFdBQVosQ0FBd0IsT0FBeEIsRUFBaUMsU0FBUyxFQUExQyxDQUFaO0FBQ0EsU0FBTyxJQUFJLEtBQUosQ0FBVTtBQUNmLE9BQUcsVUFBVSxTQUFTLE1BQU0sTUFBZixHQUF3QixNQUFNLE1BQU4sR0FBZ0IsQ0FBQyxDQUFDLE1BQU0sSUFBTixDQUFXLE1BQXJELEdBQStELENBQXpFLENBRFk7QUFFZixPQUFHLEtBQUssR0FBTCxDQUFTLEtBQUssR0FBTCxFQUFULEVBQXFCLE1BQU0sS0FBTixJQUFlLE1BQU0sTUFBTixHQUFlLENBQWYsR0FBbUIsTUFBbEMsSUFBNEMsQ0FBakU7QUFGWSxHQUFWLENBQVA7QUFJRCxDQU5EOztBQVFBLE9BQU8sU0FBUCxDQUFpQixNQUFqQixHQUEwQixVQUFTLE1BQVQsRUFBaUI7QUFDekMsTUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLFFBQVYsQ0FBbUIsQ0FBQyxNQUFELEVBQVMsU0FBUyxDQUFsQixDQUFuQixDQUFYO0FBQ0EsU0FBTyxJQUFQO0FBQ0QsQ0FIRDs7QUFLQSxPQUFPLFNBQVAsQ0FBaUIsaUJBQWpCLEdBQXFDLFVBQVMsTUFBVCxFQUFpQjtBQUNwRCxTQUFPO0FBQ0wsVUFBTSxJQUREO0FBRUwsVUFBTTtBQUZELEdBQVA7QUFJRCxDQUxEOztBQU9BLE9BQU8sU0FBUCxDQUFpQixXQUFqQixHQUErQixVQUFTLENBQVQsRUFBWTtBQUN6QyxNQUFJLE9BQU8sS0FBSyxnQkFBTCxDQUFzQixDQUFDLENBQUQsRUFBRyxDQUFILENBQXRCLENBQVg7QUFDQSxTQUFPLElBQVA7QUFDRCxDQUhEOztBQUtBLE9BQU8sU0FBUCxDQUFpQixXQUFqQixHQUErQixVQUFTLElBQVQsRUFBZTtBQUM1QyxNQUFJLFVBQVUsS0FBSyxrQkFBTCxDQUF3QixJQUF4QixDQUFkO0FBQ0EsTUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLFFBQVYsQ0FBbUIsT0FBbkIsQ0FBWDtBQUNBLFNBQU8sSUFBUDtBQUNELENBSkQ7O0FBTUEsT0FBTyxTQUFQLENBQWlCLGVBQWpCLEdBQW1DLFVBQVMsQ0FBVCxFQUFZLFNBQVosRUFBdUI7QUFDeEQsTUFBSSxRQUFRLEtBQUssUUFBTCxDQUFjLENBQWQsQ0FBWjtBQUNBLE1BQUksT0FBTyxLQUFLLElBQUwsQ0FBVSxRQUFWLENBQW1CLE1BQU0sSUFBTixDQUFXLFdBQTlCLENBQVg7QUFDQSxNQUFJLFFBQVEsT0FBTyxLQUFQLENBQWEsSUFBYixFQUFtQixLQUFuQixDQUFaOztBQUVBLE1BQUksTUFBTSxNQUFOLEtBQWlCLENBQXJCLEVBQXdCO0FBQ3RCLFFBQUksT0FBTyxJQUFJLElBQUosQ0FBUztBQUNsQixhQUFPLEVBQUUsR0FBRyxDQUFMLEVBQVEsR0FBRyxNQUFNLENBQWpCLEVBRFc7QUFFbEIsV0FBSyxFQUFFLEdBQUcsTUFBTSxJQUFOLENBQVcsTUFBaEIsRUFBd0IsR0FBRyxNQUFNLENBQWpDO0FBRmEsS0FBVCxDQUFYOztBQUtBLFdBQU8sSUFBUDtBQUNEOztBQUVELE1BQUksWUFBWSxDQUFoQjtBQUNBLE1BQUksT0FBTyxFQUFYO0FBQ0EsTUFBSSxNQUFNLEtBQUssTUFBZjs7QUFFQSxPQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksTUFBTSxNQUExQixFQUFrQyxHQUFsQyxFQUF1QztBQUNyQyxXQUFPLE1BQU0sQ0FBTixDQUFQO0FBQ0EsUUFBSSxLQUFLLEtBQUwsR0FBYSxNQUFNLENBQU4sR0FBVSxDQUFDLENBQUMsU0FBN0IsRUFBd0M7QUFDdEMsWUFBTSxLQUFLLEtBQVg7QUFDQTtBQUNEO0FBQ0QsZ0JBQVksS0FBSyxLQUFqQjtBQUNEOztBQUVELE1BQUksT0FBTyxJQUFJLElBQUosQ0FBUztBQUNsQixXQUFPLEVBQUUsR0FBRyxTQUFMLEVBQWdCLEdBQUcsTUFBTSxDQUF6QixFQURXO0FBRWxCLFNBQUssRUFBRSxHQUFHLEdBQUwsRUFBVSxHQUFHLE1BQU0sQ0FBbkI7QUFGYSxHQUFULENBQVg7O0FBS0EsU0FBTyxJQUFQO0FBQ0QsQ0FqQ0Q7O0FBbUNBLE9BQU8sU0FBUCxDQUFpQixlQUFqQixHQUFtQyxVQUFTLENBQVQsRUFBWSxJQUFaLEVBQWtCO0FBQ25ELE1BQUksS0FBSyxLQUFMLENBQVcsQ0FBWCxHQUFlLENBQWYsR0FBbUIsQ0FBbkIsSUFBd0IsS0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLENBQWIsR0FBaUIsS0FBSyxHQUFMLEVBQTdDLEVBQXlELE9BQU8sS0FBUDs7QUFFekQsT0FBSyxLQUFMLENBQVcsQ0FBWCxHQUFlLENBQWY7QUFDQSxPQUFLLEdBQUwsQ0FBUyxDQUFULEdBQWEsS0FBSyxPQUFMLENBQWEsS0FBSyxHQUFMLENBQVMsQ0FBdEIsRUFBeUIsTUFBdEM7O0FBRUEsTUFBSSxVQUFVLEtBQUssa0JBQUwsQ0FBd0IsSUFBeEIsQ0FBZDs7QUFFQSxNQUFJLElBQUksQ0FBUjs7QUFFQSxNQUFJLElBQUksQ0FBSixJQUFTLEtBQUssS0FBTCxDQUFXLENBQVgsR0FBZSxDQUF4QixJQUE2QixLQUFLLEdBQUwsQ0FBUyxDQUFULEtBQWUsS0FBSyxHQUFMLEVBQWhELEVBQTREO0FBQzFELFNBQUssS0FBTCxDQUFXLENBQVgsSUFBZ0IsQ0FBaEI7QUFDQSxTQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsS0FBSyxPQUFMLENBQWEsS0FBSyxLQUFMLENBQVcsQ0FBeEIsRUFBMkIsTUFBMUM7QUFDQSxjQUFVLEtBQUssa0JBQUwsQ0FBd0IsSUFBeEIsQ0FBVjtBQUNBLFFBQUksUUFBSjtBQUNELEdBTEQsTUFLTztBQUNMLFlBQVEsQ0FBUixLQUFjLENBQWQ7QUFDRDs7QUFFRCxNQUFJLE9BQU8sS0FBSyxJQUFMLENBQVUsUUFBVixDQUFtQixPQUFuQixDQUFYOztBQUVBLE9BQUssaUJBQUwsQ0FBdUIsT0FBdkI7O0FBRUEsT0FBSyxNQUFMLENBQVksRUFBRSxHQUFHLENBQUwsRUFBUSxHQUFFLEtBQUssS0FBTCxDQUFXLENBQVgsR0FBZSxDQUF6QixFQUFaLEVBQTBDLElBQTFDOztBQUVBLFNBQU8sSUFBUDtBQUNELENBMUJEOztBQTRCQSxPQUFPLFNBQVAsQ0FBaUIsa0JBQWpCLEdBQXNDLFVBQVMsSUFBVCxFQUFlO0FBQ25ELE1BQUksUUFBUSxDQUNWLEtBQUssUUFBTCxDQUFjLEtBQUssS0FBbkIsRUFBMEIsTUFEaEIsRUFFVixLQUFLLFFBQUwsQ0FBYyxLQUFLLEdBQW5CLEVBQXdCLE1BRmQsQ0FBWjtBQUlBLFNBQU8sS0FBUDtBQUNELENBTkQ7O0FBUUEsT0FBTyxTQUFQLENBQWlCLGFBQWpCLEdBQWlDLFVBQVMsTUFBVCxFQUFpQjtBQUNoRCxTQUFPLElBQVA7QUFDRCxDQUZEOztBQUlBLE9BQU8sU0FBUCxDQUFpQixhQUFqQixHQUFpQyxVQUFTLENBQVQsRUFBWTtBQUMzQyxNQUFJLFNBQVMsSUFBSSxDQUFKLEdBQVEsQ0FBQyxDQUFULEdBQWEsTUFBTSxDQUFOLEdBQVUsQ0FBVixHQUFjLEtBQUssTUFBTCxDQUFZLFVBQVosQ0FBdUIsT0FBdkIsRUFBZ0MsSUFBSSxDQUFwQyxJQUF5QyxDQUFqRjtBQUNBLFNBQU8sTUFBUDtBQUNELENBSEQ7O0FBS0EsT0FBTyxTQUFQLENBQWlCLEdBQWpCLEdBQXVCLFlBQVc7QUFDaEMsU0FBTyxLQUFLLE1BQUwsQ0FBWSxhQUFaLENBQTBCLE9BQTFCLEVBQW1DLE1BQTFDO0FBQ0QsQ0FGRDs7QUFJQSxPQUFPLFNBQVAsQ0FBaUIsUUFBakIsR0FBNEIsWUFBVztBQUNyQyxTQUFPLEtBQUssSUFBTCxDQUFVLFFBQVYsRUFBUDtBQUNELENBRkQ7O0FBSUEsU0FBUyxJQUFULEdBQWdCO0FBQ2QsT0FBSyxXQUFMLEdBQW1CLEVBQW5CO0FBQ0EsT0FBSyxNQUFMLEdBQWMsQ0FBZDtBQUNBLE9BQUssTUFBTCxHQUFjLENBQWQ7QUFDQSxPQUFLLEtBQUwsR0FBYSxJQUFJLEtBQUosRUFBYjtBQUNEOztBQUVELFNBQVMsWUFBVCxDQUFzQixDQUF0QixFQUF5QjtBQUN2QixTQUFPLEVBQUUsT0FBRixDQUFVLEdBQVYsRUFBZSxJQUFmLENBQVA7QUFDRDs7Ozs7QUNsV0QsT0FBTyxPQUFQLEdBQWlCLE9BQWpCOztBQUVBLFNBQVMsT0FBVCxDQUFpQixNQUFqQixFQUF5QjtBQUN2QixPQUFLLE1BQUwsR0FBYyxNQUFkO0FBQ0Q7O0FBRUQsUUFBUSxTQUFSLENBQWtCLElBQWxCLEdBQXlCLFVBQVMsQ0FBVCxFQUFZO0FBQ25DLE1BQUksQ0FBQyxDQUFMLEVBQVEsT0FBTyxFQUFQO0FBQ1IsTUFBSSxVQUFVLEVBQWQ7QUFDQSxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksR0FBdkI7QUFDQSxNQUFJLE1BQU0sRUFBRSxNQUFaO0FBQ0EsTUFBSSxLQUFKO0FBQ0EsU0FBTyxFQUFFLFFBQVEsS0FBSyxPQUFMLENBQWEsQ0FBYixFQUFnQixRQUFRLEdBQXhCLENBQVYsQ0FBUCxFQUFnRDtBQUM5QyxZQUFRLElBQVIsQ0FBYSxLQUFiO0FBQ0Q7QUFDRCxTQUFPLE9BQVA7QUFDRCxDQVZEOzs7OztBQ1BBLElBQUksZUFBZSxRQUFRLHlCQUFSLENBQW5COztBQUVBLE9BQU8sT0FBUCxHQUFpQixLQUFqQjs7QUFFQSxTQUFTLEtBQVQsQ0FBZSxPQUFmLEVBQXdCO0FBQ3RCLFlBQVUsV0FBVyxJQUFyQjtBQUNBLE9BQUssT0FBTCxHQUFlLE9BQWY7QUFDQSxPQUFLLEtBQUwsR0FBYSxFQUFiO0FBQ0EsT0FBSyxNQUFMLEdBQWMsQ0FBZDtBQUNEOztBQUVELE1BQU0sU0FBTixDQUFnQixJQUFoQixHQUF1QixVQUFTLElBQVQsRUFBZTtBQUNwQyxPQUFLLE1BQUwsQ0FBWSxDQUFDLElBQUQsQ0FBWjtBQUNELENBRkQ7O0FBSUEsTUFBTSxTQUFOLENBQWdCLE1BQWhCLEdBQXlCLFVBQVMsS0FBVCxFQUFnQjtBQUN2QyxNQUFJLE9BQU8sS0FBSyxLQUFLLEtBQVYsQ0FBWDs7QUFFQSxNQUFJLENBQUMsSUFBTCxFQUFXO0FBQ1QsV0FBTyxFQUFQO0FBQ0EsU0FBSyxVQUFMLEdBQWtCLENBQWxCO0FBQ0EsU0FBSyxXQUFMLEdBQW1CLENBQW5CO0FBQ0EsU0FBSyxLQUFMLENBQVcsSUFBWCxDQUFnQixJQUFoQjtBQUNELEdBTEQsTUFNSyxJQUFJLEtBQUssTUFBTCxJQUFlLEtBQUssT0FBeEIsRUFBaUM7QUFDcEMsUUFBSSxhQUFhLEtBQUssVUFBTCxHQUFrQixLQUFLLE1BQXhDO0FBQ0EsUUFBSSxjQUFjLE1BQU0sQ0FBTixDQUFsQjs7QUFFQSxXQUFPLEVBQVA7QUFDQSxTQUFLLFVBQUwsR0FBa0IsVUFBbEI7QUFDQSxTQUFLLFdBQUwsR0FBbUIsV0FBbkI7QUFDQSxTQUFLLEtBQUwsQ0FBVyxJQUFYLENBQWdCLElBQWhCO0FBQ0Q7O0FBRUQsT0FBSyxJQUFMLENBQVUsS0FBVixDQUFnQixJQUFoQixFQUFzQixNQUFNLEdBQU4sQ0FBVTtBQUFBLFdBQVUsU0FBUyxLQUFLLFdBQXhCO0FBQUEsR0FBVixDQUF0Qjs7QUFFQSxPQUFLLE1BQUwsSUFBZSxNQUFNLE1BQXJCO0FBQ0QsQ0F0QkQ7O0FBd0JBLE1BQU0sU0FBTixDQUFnQixHQUFoQixHQUFzQixVQUFTLEtBQVQsRUFBZ0I7QUFDcEMsTUFBSSxPQUFPLEtBQUssZUFBTCxDQUFxQixLQUFyQixFQUE0QixJQUF2QztBQUNBLFNBQU8sS0FBSyxLQUFLLEdBQUwsQ0FBUyxLQUFLLE1BQUwsR0FBYyxDQUF2QixFQUEwQixRQUFRLEtBQUssVUFBdkMsQ0FBTCxJQUEyRCxLQUFLLFdBQXZFO0FBQ0QsQ0FIRDs7QUFLQSxNQUFNLFNBQU4sQ0FBZ0IsSUFBaEIsR0FBdUIsVUFBUyxNQUFULEVBQWlCO0FBQ3RDLE1BQUksSUFBSSxLQUFLLGdCQUFMLENBQXNCLE1BQXRCLENBQVI7QUFDQSxNQUFJLENBQUMsRUFBRSxJQUFQLEVBQWEsT0FBTyxJQUFQOztBQUViLE1BQUksT0FBTyxFQUFFLElBQWI7QUFDQSxNQUFJLFlBQVksRUFBRSxLQUFsQjtBQUNBLE1BQUksSUFBSSxLQUFLLGdCQUFMLENBQXNCLE1BQXRCLEVBQThCLElBQTlCLENBQVI7QUFDQSxTQUFPO0FBQ0wsWUFBUSxFQUFFLElBQUYsR0FBUyxLQUFLLFdBRGpCO0FBRUwsV0FBTyxFQUFFLEtBQUYsR0FBVSxLQUFLLFVBRmpCO0FBR0wsV0FBTyxFQUFFLEtBSEo7QUFJTCxVQUFNLElBSkQ7QUFLTCxlQUFXO0FBTE4sR0FBUDtBQU9ELENBZEQ7O0FBZ0JBLE1BQU0sU0FBTixDQUFnQixNQUFoQixHQUF5QixVQUFTLE1BQVQsRUFBaUIsS0FBakIsRUFBd0I7QUFDL0MsTUFBSSxJQUFJLEtBQUssSUFBTCxDQUFVLE1BQVYsQ0FBUjtBQUNBLE1BQUksQ0FBQyxDQUFMLEVBQVE7QUFDTixXQUFPLEtBQUssTUFBTCxDQUFZLEtBQVosQ0FBUDtBQUNEO0FBQ0QsTUFBSSxFQUFFLE1BQUYsR0FBVyxNQUFmLEVBQXVCLEVBQUUsS0FBRixHQUFVLENBQUMsQ0FBWDtBQUN2QixNQUFJLFNBQVMsTUFBTSxNQUFuQjtBQUNBO0FBQ0EsVUFBUSxNQUFNLEdBQU4sQ0FBVTtBQUFBLFdBQU0sTUFBTSxFQUFFLElBQUYsQ0FBTyxXQUFuQjtBQUFBLEdBQVYsQ0FBUjtBQUNBLFNBQU8sRUFBRSxJQUFULEVBQWUsRUFBRSxLQUFGLEdBQVUsQ0FBekIsRUFBNEIsS0FBNUI7QUFDQSxPQUFLLFVBQUwsQ0FBZ0IsRUFBRSxTQUFGLEdBQWMsQ0FBOUIsRUFBaUMsQ0FBQyxNQUFsQztBQUNBLE9BQUssTUFBTCxJQUFlLE1BQWY7QUFDRCxDQVpEOztBQWNBLE1BQU0sU0FBTixDQUFnQixXQUFoQixHQUE4QixVQUFTLE1BQVQsRUFBaUIsS0FBakIsRUFBd0I7QUFDcEQsTUFBSSxRQUFRLEtBQUssS0FBakI7QUFDQSxNQUFJLE9BQU8sS0FBSyxJQUFMLENBQVUsTUFBVixDQUFYO0FBQ0EsTUFBSSxDQUFDLElBQUwsRUFBVztBQUNYLE1BQUksU0FBUyxLQUFLLE1BQWxCLEVBQTBCLEtBQUssS0FBTCxJQUFjLENBQWQ7O0FBRTFCLE1BQUksVUFBVSxDQUFkO0FBQ0EsT0FBSyxJQUFJLElBQUksS0FBSyxLQUFsQixFQUF5QixJQUFJLEtBQUssSUFBTCxDQUFVLE1BQXZDLEVBQStDLEdBQS9DLEVBQW9EO0FBQ2xELFNBQUssSUFBTCxDQUFVLENBQVYsS0FBZ0IsS0FBaEI7QUFDQSxRQUFJLEtBQUssSUFBTCxDQUFVLENBQVYsSUFBZSxLQUFLLElBQUwsQ0FBVSxXQUF6QixHQUF1QyxNQUEzQyxFQUFtRDtBQUNqRDtBQUNBLFdBQUssSUFBTCxDQUFVLE1BQVYsQ0FBaUIsR0FBakIsRUFBc0IsQ0FBdEI7QUFDRDtBQUNGO0FBQ0QsTUFBSSxPQUFKLEVBQWE7QUFDWCxTQUFLLFVBQUwsQ0FBZ0IsS0FBSyxTQUFMLEdBQWlCLENBQWpDLEVBQW9DLE9BQXBDO0FBQ0EsU0FBSyxNQUFMLElBQWUsT0FBZjtBQUNEO0FBQ0QsT0FBSyxJQUFJLElBQUksS0FBSyxTQUFMLEdBQWlCLENBQTlCLEVBQWlDLElBQUksTUFBTSxNQUEzQyxFQUFtRCxHQUFuRCxFQUF3RDtBQUN0RCxVQUFNLENBQU4sRUFBUyxXQUFULElBQXdCLEtBQXhCO0FBQ0EsUUFBSSxNQUFNLENBQU4sRUFBUyxXQUFULEdBQXVCLE1BQTNCLEVBQW1DO0FBQ2pDLFVBQUksS0FBSyxNQUFNLENBQU4sQ0FBTCxJQUFpQixNQUFNLENBQU4sRUFBUyxXQUExQixHQUF3QyxNQUE1QyxFQUFvRDtBQUNsRCxrQkFBVSxNQUFNLENBQU4sRUFBUyxNQUFuQjtBQUNBLGFBQUssVUFBTCxDQUFnQixJQUFJLENBQXBCLEVBQXVCLE9BQXZCO0FBQ0EsYUFBSyxNQUFMLElBQWUsT0FBZjtBQUNBLGNBQU0sTUFBTixDQUFhLEdBQWIsRUFBa0IsQ0FBbEI7QUFDRCxPQUxELE1BS087QUFDTCxhQUFLLGlCQUFMLENBQXVCLE1BQXZCLEVBQStCLE1BQU0sQ0FBTixDQUEvQjtBQUNEO0FBQ0Y7QUFDRjtBQUNGLENBL0JEOztBQWlDQSxNQUFNLFNBQU4sQ0FBZ0IsV0FBaEIsR0FBOEIsVUFBUyxLQUFULEVBQWdCO0FBQzVDLE1BQUksSUFBSSxLQUFLLElBQUwsQ0FBVSxNQUFNLENBQU4sQ0FBVixDQUFSO0FBQ0EsTUFBSSxJQUFJLEtBQUssSUFBTCxDQUFVLE1BQU0sQ0FBTixDQUFWLENBQVI7QUFDQSxNQUFJLENBQUMsQ0FBRCxJQUFNLENBQUMsQ0FBWCxFQUFjOztBQUVkLE1BQUksRUFBRSxTQUFGLEtBQWdCLEVBQUUsU0FBdEIsRUFBaUM7QUFDL0IsUUFBSSxFQUFFLE1BQUYsSUFBWSxNQUFNLENBQU4sQ0FBWixJQUF3QixFQUFFLE1BQUYsR0FBVyxNQUFNLENBQU4sQ0FBdkMsRUFBaUQsRUFBRSxLQUFGLElBQVcsQ0FBWDtBQUNqRCxRQUFJLEVBQUUsTUFBRixJQUFZLE1BQU0sQ0FBTixDQUFaLElBQXdCLEVBQUUsTUFBRixHQUFXLE1BQU0sQ0FBTixDQUF2QyxFQUFpRCxFQUFFLEtBQUYsSUFBVyxDQUFYO0FBQ2pELFFBQUksUUFBUSxPQUFPLEVBQUUsSUFBVCxFQUFlLEVBQUUsS0FBakIsRUFBd0IsRUFBRSxLQUFGLEdBQVUsQ0FBbEMsRUFBcUMsTUFBakQ7QUFDQSxTQUFLLFVBQUwsQ0FBZ0IsRUFBRSxTQUFGLEdBQWMsQ0FBOUIsRUFBaUMsS0FBakM7QUFDQSxTQUFLLE1BQUwsSUFBZSxLQUFmO0FBQ0QsR0FORCxNQU1PO0FBQ0wsUUFBSSxFQUFFLE1BQUYsSUFBWSxNQUFNLENBQU4sQ0FBWixJQUF3QixFQUFFLE1BQUYsR0FBVyxNQUFNLENBQU4sQ0FBdkMsRUFBaUQsRUFBRSxLQUFGLElBQVcsQ0FBWDtBQUNqRCxRQUFJLEVBQUUsTUFBRixJQUFZLE1BQU0sQ0FBTixDQUFaLElBQXdCLEVBQUUsTUFBRixHQUFXLE1BQU0sQ0FBTixDQUF2QyxFQUFpRCxFQUFFLEtBQUYsSUFBVyxDQUFYO0FBQ2pELFFBQUksU0FBUyxPQUFPLEVBQUUsSUFBVCxFQUFlLEVBQUUsS0FBakIsRUFBd0IsTUFBckM7QUFDQSxRQUFJLFNBQVMsT0FBTyxFQUFFLElBQVQsRUFBZSxDQUFmLEVBQWtCLEVBQUUsS0FBRixHQUFVLENBQTVCLEVBQStCLE1BQTVDO0FBQ0EsUUFBSSxFQUFFLFNBQUYsR0FBYyxFQUFFLFNBQWhCLEdBQTRCLENBQWhDLEVBQW1DO0FBQ2pDLFVBQUksVUFBVSxPQUFPLEtBQUssS0FBWixFQUFtQixFQUFFLFNBQUYsR0FBYyxDQUFqQyxFQUFvQyxFQUFFLFNBQXRDLENBQWQ7QUFDQSxVQUFJLGVBQWUsUUFBUSxNQUFSLENBQWUsVUFBQyxDQUFELEVBQUcsQ0FBSDtBQUFBLGVBQVMsSUFBSSxFQUFFLE1BQWY7QUFBQSxPQUFmLEVBQXNDLENBQXRDLENBQW5CO0FBQ0EsUUFBRSxJQUFGLENBQU8sVUFBUCxJQUFxQixTQUFTLFlBQTlCO0FBQ0EsV0FBSyxVQUFMLENBQWdCLEVBQUUsU0FBRixHQUFjLFFBQVEsTUFBdEIsR0FBK0IsQ0FBL0MsRUFBa0QsU0FBUyxNQUFULEdBQWtCLFlBQXBFO0FBQ0EsV0FBSyxNQUFMLElBQWUsU0FBUyxNQUFULEdBQWtCLFlBQWpDO0FBQ0QsS0FORCxNQU1PO0FBQ0wsUUFBRSxJQUFGLENBQU8sVUFBUCxJQUFxQixNQUFyQjtBQUNBLFdBQUssVUFBTCxDQUFnQixFQUFFLFNBQUYsR0FBYyxDQUE5QixFQUFpQyxTQUFTLE1BQTFDO0FBQ0EsV0FBSyxNQUFMLElBQWUsU0FBUyxNQUF4QjtBQUNEO0FBQ0Y7O0FBRUQ7QUFDQSxNQUFJLENBQUMsRUFBRSxJQUFGLENBQU8sTUFBWixFQUFvQjtBQUNsQixTQUFLLEtBQUwsQ0FBVyxNQUFYLENBQWtCLEtBQUssS0FBTCxDQUFXLE9BQVgsQ0FBbUIsRUFBRSxJQUFyQixDQUFsQixFQUE4QyxDQUE5QztBQUNEO0FBQ0QsTUFBSSxDQUFDLEVBQUUsSUFBRixDQUFPLE1BQVosRUFBb0I7QUFDbEIsU0FBSyxLQUFMLENBQVcsTUFBWCxDQUFrQixLQUFLLEtBQUwsQ0FBVyxPQUFYLENBQW1CLEVBQUUsSUFBckIsQ0FBbEIsRUFBOEMsQ0FBOUM7QUFDRDtBQUNGLENBcENEOztBQXNDQSxNQUFNLFNBQU4sQ0FBZ0IsVUFBaEIsR0FBNkIsVUFBUyxVQUFULEVBQXFCLEtBQXJCLEVBQTRCO0FBQ3ZELE9BQUssSUFBSSxJQUFJLFVBQWIsRUFBeUIsSUFBSSxLQUFLLEtBQUwsQ0FBVyxNQUF4QyxFQUFnRCxHQUFoRCxFQUFxRDtBQUNuRCxTQUFLLEtBQUwsQ0FBVyxDQUFYLEVBQWMsVUFBZCxJQUE0QixLQUE1QjtBQUNEO0FBQ0YsQ0FKRDs7QUFNQSxNQUFNLFNBQU4sQ0FBZ0IsaUJBQWhCLEdBQW9DLFVBQVMsTUFBVCxFQUFpQixJQUFqQixFQUF1QjtBQUN6RCxNQUFJLElBQUksS0FBSyxnQkFBTCxDQUFzQixNQUF0QixFQUE4QixJQUE5QixDQUFSO0FBQ0EsTUFBSSxRQUFRLE9BQU8sSUFBUCxFQUFhLENBQWIsRUFBZ0IsRUFBRSxLQUFsQixFQUF5QixNQUFyQztBQUNBLE9BQUssVUFBTCxDQUFnQixFQUFFLFNBQUYsR0FBYyxDQUE5QixFQUFpQyxLQUFqQztBQUNBLE9BQUssTUFBTCxJQUFlLEtBQWY7QUFDRCxDQUxEOztBQU9BLE1BQU0sU0FBTixDQUFnQixnQkFBaEIsR0FBbUMsVUFBUyxNQUFULEVBQWlCLElBQWpCLEVBQXVCO0FBQ3hELFlBQVUsS0FBSyxXQUFmO0FBQ0EsU0FBTyxhQUFhLElBQWIsRUFBbUI7QUFBQSxXQUFLLEtBQUssTUFBVjtBQUFBLEdBQW5CLENBQVA7QUFDRCxDQUhEOztBQUtBLE1BQU0sU0FBTixDQUFnQixlQUFoQixHQUFrQyxVQUFTLEtBQVQsRUFBZ0I7QUFDaEQsU0FBTyxhQUFhLEtBQUssS0FBbEIsRUFBeUI7QUFBQSxXQUFLLEVBQUUsVUFBRixJQUFnQixLQUFyQjtBQUFBLEdBQXpCLENBQVA7QUFDRCxDQUZEOztBQUlBLE1BQU0sU0FBTixDQUFnQixnQkFBaEIsR0FBbUMsVUFBUyxNQUFULEVBQWlCO0FBQ2xELFNBQU8sYUFBYSxLQUFLLEtBQWxCLEVBQXlCO0FBQUEsV0FBSyxFQUFFLFdBQUYsSUFBaUIsTUFBdEI7QUFBQSxHQUF6QixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLFNBQU4sQ0FBZ0IsT0FBaEIsR0FBMEIsWUFBVztBQUNuQyxTQUFPLEtBQUssS0FBTCxDQUFXLE1BQVgsQ0FBa0IsVUFBQyxDQUFELEVBQUcsQ0FBSDtBQUFBLFdBQVMsRUFBRSxNQUFGLENBQVMsQ0FBVCxDQUFUO0FBQUEsR0FBbEIsRUFBd0MsRUFBeEMsQ0FBUDtBQUNELENBRkQ7O0FBSUEsTUFBTSxTQUFOLENBQWdCLEtBQWhCLEdBQXdCLFlBQVc7QUFDakMsTUFBSSxRQUFRLElBQUksS0FBSixDQUFVLEtBQUssT0FBZixDQUFaO0FBQ0EsT0FBSyxLQUFMLENBQVcsT0FBWCxDQUFtQixnQkFBUTtBQUN6QixRQUFJLElBQUksS0FBSyxLQUFMLEVBQVI7QUFDQSxNQUFFLFVBQUYsR0FBZSxLQUFLLFVBQXBCO0FBQ0EsTUFBRSxXQUFGLEdBQWdCLEtBQUssV0FBckI7QUFDQSxVQUFNLEtBQU4sQ0FBWSxJQUFaLENBQWlCLENBQWpCO0FBQ0QsR0FMRDtBQU1BLFFBQU0sTUFBTixHQUFlLEtBQUssTUFBcEI7QUFDQSxTQUFPLEtBQVA7QUFDRCxDQVZEOztBQVlBLFNBQVMsSUFBVCxDQUFjLEtBQWQsRUFBcUI7QUFDbkIsU0FBTyxNQUFNLE1BQU0sTUFBTixHQUFlLENBQXJCLENBQVA7QUFDRDs7QUFFRCxTQUFTLE1BQVQsQ0FBZ0IsS0FBaEIsRUFBdUIsQ0FBdkIsRUFBMEIsQ0FBMUIsRUFBNkI7QUFDM0IsTUFBSSxLQUFLLElBQVQsRUFBZTtBQUNiLFdBQU8sTUFBTSxNQUFOLENBQWEsQ0FBYixDQUFQO0FBQ0QsR0FGRCxNQUVPO0FBQ0wsV0FBTyxNQUFNLE1BQU4sQ0FBYSxDQUFiLEVBQWdCLElBQUksQ0FBcEIsQ0FBUDtBQUNEO0FBQ0Y7O0FBRUQsU0FBUyxNQUFULENBQWdCLE1BQWhCLEVBQXdCLEtBQXhCLEVBQStCLEtBQS9CLEVBQXNDO0FBQ3BDLE1BQUksS0FBSyxNQUFNLEtBQU4sRUFBVDtBQUNBLEtBQUcsT0FBSCxDQUFXLEtBQVgsRUFBa0IsQ0FBbEI7QUFDQSxTQUFPLE1BQVAsQ0FBYyxLQUFkLENBQW9CLE1BQXBCLEVBQTRCLEVBQTVCO0FBQ0Q7Ozs7O0FDM01EO0FBQ0EsSUFBSSxPQUFPLGtCQUFYO0FBQ0EsSUFBSSxPQUFPLENBQVg7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLGNBQWpCOztBQUVBLFNBQVMsY0FBVCxHQUEwQjtBQUN4QixPQUFLLEtBQUwsR0FBYSxFQUFiO0FBQ0EsT0FBSyxJQUFMLEdBQVksQ0FBWjtBQUNBLE9BQUssUUFBTCxHQUFnQixFQUFoQjtBQUNEOztBQUVELGVBQWUsU0FBZixDQUF5QixXQUF6QixHQUF1QyxZQUFXO0FBQUE7O0FBQ2hELE1BQUksV0FBVyxPQUNaLElBRFksQ0FDUCxLQUFLLFFBREUsRUFFWixHQUZZLENBRVIsVUFBQyxHQUFEO0FBQUEsV0FBUyxNQUFLLFFBQUwsQ0FBYyxHQUFkLENBQVQ7QUFBQSxHQUZRLENBQWY7O0FBSUEsU0FBTyxTQUFTLE1BQVQsQ0FBZ0IsVUFBQyxDQUFELEVBQUksQ0FBSjtBQUFBLFdBQVUsRUFBRSxNQUFGLENBQVMsRUFBRSxXQUFGLEVBQVQsQ0FBVjtBQUFBLEdBQWhCLEVBQXFELFFBQXJELENBQVA7QUFDRCxDQU5EOztBQVFBLGVBQWUsU0FBZixDQUF5QixPQUF6QixHQUFtQyxVQUFTLEdBQVQsRUFBYztBQUMvQyxNQUFJLGFBQWEsRUFBakI7QUFDQSxNQUFJLE9BQU8sS0FBSyxJQUFMLENBQVUsR0FBVixDQUFYO0FBQ0EsTUFBSSxJQUFKLEVBQVU7QUFDUixpQkFBYSxLQUNWLFdBRFUsR0FFVixNQUZVLENBRUgsVUFBQyxJQUFEO0FBQUEsYUFBVSxLQUFLLEtBQWY7QUFBQSxLQUZHLEVBR1YsSUFIVSxDQUdMLFVBQUMsQ0FBRCxFQUFJLENBQUosRUFBVTtBQUNkLFVBQUksTUFBTSxFQUFFLElBQUYsR0FBUyxFQUFFLElBQXJCO0FBQ0EsVUFBSSxRQUFRLENBQVosRUFBZSxNQUFNLEVBQUUsS0FBRixDQUFRLE1BQVIsR0FBaUIsRUFBRSxLQUFGLENBQVEsTUFBL0I7QUFDZixVQUFJLFFBQVEsQ0FBWixFQUFlLE1BQU0sRUFBRSxLQUFGLEdBQVUsRUFBRSxLQUFsQjtBQUNmLGFBQU8sR0FBUDtBQUNELEtBUlUsQ0FBYjs7QUFVQSxRQUFJLEtBQUssS0FBVCxFQUFnQixXQUFXLElBQVgsQ0FBZ0IsSUFBaEI7QUFDakI7QUFDRCxTQUFPLFVBQVA7QUFDRCxDQWpCRDs7QUFtQkEsZUFBZSxTQUFmLENBQXlCLElBQXpCLEdBQWdDLFVBQVMsR0FBVCxFQUFjO0FBQzVDLE1BQUksT0FBTyxJQUFYO0FBQ0EsT0FBSyxJQUFJLElBQVQsSUFBaUIsR0FBakIsRUFBc0I7QUFDcEIsUUFBSSxJQUFJLElBQUosS0FBYSxLQUFLLFFBQXRCLEVBQWdDO0FBQzlCLGFBQU8sS0FBSyxRQUFMLENBQWMsSUFBSSxJQUFKLENBQWQsQ0FBUDtBQUNELEtBRkQsTUFFTztBQUNMO0FBQ0Q7QUFDRjtBQUNELFNBQU8sSUFBUDtBQUNELENBVkQ7O0FBWUEsZUFBZSxTQUFmLENBQXlCLE1BQXpCLEdBQWtDLFVBQVMsQ0FBVCxFQUFZLEtBQVosRUFBbUI7QUFDbkQsTUFBSSxPQUFPLElBQVg7QUFDQSxNQUFJLElBQUksQ0FBUjtBQUNBLE1BQUksSUFBSSxFQUFFLE1BQVY7O0FBRUEsU0FBTyxJQUFJLENBQVgsRUFBYztBQUNaLFFBQUksRUFBRSxDQUFGLEtBQVEsS0FBSyxRQUFqQixFQUEyQjtBQUN6QixhQUFPLEtBQUssUUFBTCxDQUFjLEVBQUUsQ0FBRixDQUFkLENBQVA7QUFDQTtBQUNELEtBSEQsTUFHTztBQUNMO0FBQ0Q7QUFDRjs7QUFFRCxTQUFPLElBQUksQ0FBWCxFQUFjO0FBQ1osV0FDQSxLQUFLLFFBQUwsQ0FBYyxFQUFFLENBQUYsQ0FBZCxJQUNBLEtBQUssUUFBTCxDQUFjLEVBQUUsQ0FBRixDQUFkLEtBQXVCLElBQUksY0FBSixFQUZ2QjtBQUdBO0FBQ0Q7O0FBRUQsT0FBSyxLQUFMLEdBQWEsQ0FBYjtBQUNBLE9BQUssSUFBTDtBQUNELENBdkJEOztBQXlCQSxlQUFlLFNBQWYsQ0FBeUIsS0FBekIsR0FBaUMsVUFBUyxDQUFULEVBQVk7QUFDM0MsTUFBSSxJQUFKO0FBQ0EsU0FBTyxPQUFPLEtBQUssSUFBTCxDQUFVLENBQVYsQ0FBZCxFQUE0QjtBQUMxQixTQUFLLE1BQUwsQ0FBWSxLQUFLLENBQUwsQ0FBWjtBQUNEO0FBQ0YsQ0FMRDs7Ozs7QUM1RUEsSUFBSSxRQUFRLFFBQVEsaUJBQVIsQ0FBWjtBQUNBLElBQUksZUFBZSxRQUFRLHlCQUFSLENBQW5CO0FBQ0EsSUFBSSxTQUFTLFFBQVEsVUFBUixDQUFiO0FBQ0EsSUFBSSxPQUFPLE9BQU8sSUFBbEI7O0FBRUEsSUFBSSxRQUFRLFVBQVo7O0FBRUEsSUFBSSxRQUFRO0FBQ1Ysb0JBQWtCLENBQUMsSUFBRCxFQUFNLElBQU4sQ0FEUjtBQUVWLG9CQUFrQixDQUFDLElBQUQsRUFBTSxJQUFOLENBRlI7QUFHVixxQkFBbUIsQ0FBQyxHQUFELEVBQUssR0FBTCxDQUhUO0FBSVYseUJBQXVCLENBQUMsR0FBRCxFQUFLLEdBQUwsQ0FKYjtBQUtWLHlCQUF1QixDQUFDLEdBQUQsRUFBSyxHQUFMLENBTGI7QUFNVixZQUFVLENBQUMsR0FBRCxFQUFLLEdBQUw7QUFOQSxDQUFaOztBQVNBLElBQUksT0FBTztBQUNULHlCQUF1QixJQURkO0FBRVQseUJBQXVCLElBRmQ7QUFHVCxvQkFBa0IsS0FIVDtBQUlULG9CQUFrQixLQUpUO0FBS1QsWUFBVTtBQUxELENBQVg7O0FBUUEsSUFBSSxRQUFRLEVBQVo7QUFDQSxLQUFLLElBQUksR0FBVCxJQUFnQixLQUFoQixFQUF1QjtBQUNyQixNQUFJLElBQUksTUFBTSxHQUFOLENBQVI7QUFDQSxRQUFNLEVBQUUsQ0FBRixDQUFOLElBQWMsR0FBZDtBQUNEOztBQUVELElBQUksU0FBUztBQUNYLGtCQUFnQixDQURMO0FBRVgsbUJBQWlCLENBRk47QUFHWCxxQkFBbUI7QUFIUixDQUFiOztBQU1BLElBQUksVUFBVTtBQUNaLG1CQUFpQjtBQURMLENBQWQ7O0FBSUEsSUFBSSxTQUFTO0FBQ1gsa0JBQWdCLGVBREw7QUFFWCxxQkFBbUI7QUFGUixDQUFiOztBQUtBLElBQUksTUFBTTtBQUNSLGtCQUFnQixTQURSO0FBRVIscUJBQW1CO0FBRlgsQ0FBVjs7QUFLQSxPQUFPLE9BQVAsR0FBaUIsUUFBakI7O0FBRUEsU0FBUyxRQUFULENBQWtCLE1BQWxCLEVBQTBCO0FBQ3hCLE9BQUssTUFBTCxHQUFjLE1BQWQ7QUFDQSxPQUFLLEtBQUwsR0FBYSxFQUFiO0FBQ0EsT0FBSyxLQUFMO0FBQ0Q7O0FBRUQsU0FBUyxTQUFULENBQW1CLFVBQW5CLEdBQWdDLFVBQVMsTUFBVCxFQUFpQjtBQUMvQyxNQUFJLE1BQUosRUFBWTtBQUNWLFFBQUksSUFBSSxhQUFhLEtBQUssS0FBTCxDQUFXLEtBQXhCLEVBQStCO0FBQUEsYUFBSyxFQUFFLE1BQUYsR0FBVyxNQUFoQjtBQUFBLEtBQS9CLEVBQXVELElBQXZELENBQVI7QUFDQSxTQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLE1BQWpCLENBQXdCLEVBQUUsS0FBMUI7QUFDRCxHQUhELE1BR087QUFDTCxTQUFLLEtBQUwsQ0FBVyxLQUFYLEdBQW1CLEVBQW5CO0FBQ0Q7QUFDRCxPQUFLLEtBQUwsQ0FBVyxNQUFYLEdBQW9CLEVBQXBCO0FBQ0EsT0FBSyxLQUFMLENBQVcsS0FBWCxHQUFtQixFQUFuQjtBQUNBLE9BQUssS0FBTCxDQUFXLEtBQVgsR0FBbUIsRUFBbkI7QUFDRCxDQVZEOztBQVlBLFNBQVMsU0FBVCxDQUFtQixLQUFuQixHQUEyQixZQUFXO0FBQ3BDLE9BQUssVUFBTDtBQUNELENBRkQ7O0FBSUEsU0FBUyxTQUFULENBQW1CLEdBQW5CLEdBQXlCLFVBQVMsQ0FBVCxFQUFZO0FBQ25DLE1BQUksS0FBSyxLQUFLLEtBQUwsQ0FBVyxLQUFwQixFQUEyQjtBQUN6QixXQUFPLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsQ0FBakIsQ0FBUDtBQUNEOztBQUVELE1BQUksV0FBVyxLQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLGFBQW5CLENBQWlDLFVBQWpDLENBQWY7QUFDQSxNQUFJLE9BQU8sS0FBWDtBQUNBLE1BQUksUUFBUSxJQUFaO0FBQ0EsTUFBSSxVQUFVLEVBQWQ7QUFDQSxNQUFJLFFBQVEsRUFBRSxHQUFFLENBQUMsQ0FBTCxFQUFRLEdBQUUsQ0FBQyxDQUFYLEVBQVo7QUFDQSxNQUFJLFFBQVEsQ0FBWjtBQUNBLE1BQUksTUFBSjtBQUNBLE1BQUksT0FBSjtBQUNBLE1BQUksS0FBSjtBQUNBLE1BQUksSUFBSjtBQUNBLE1BQUksS0FBSjtBQUNBLE1BQUksSUFBSjs7QUFFQSxNQUFJLHVCQUF1QixDQUEzQjs7QUFFQSxNQUFJLElBQUksQ0FBUjs7QUFFQSxNQUFJLGFBQWEsS0FBSyxhQUFMLENBQW1CLENBQW5CLENBQWpCO0FBQ0EsTUFBSSxjQUFjLFdBQVcsSUFBN0IsRUFBbUM7QUFDakMsV0FBTyxJQUFQO0FBQ0EsWUFBUSxXQUFXLElBQW5CO0FBQ0EsY0FBVSxPQUFPLE1BQU0sSUFBYixDQUFWO0FBQ0EsUUFBSSxNQUFNLEtBQU4sR0FBYyxDQUFsQjtBQUNEOztBQUVELFNBQU8sSUFBSSxTQUFTLE1BQXBCLEVBQTRCLEdBQTVCLEVBQWlDO0FBQy9CLGFBQVMsU0FBUyxHQUFULENBQWEsQ0FBYixDQUFUO0FBQ0EsY0FBVTtBQUNSLGNBQVEsTUFEQTtBQUVSLFlBQU0sS0FBSyxLQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLE1BQW5CLENBQUw7QUFGRSxLQUFWOztBQUtBO0FBQ0EsUUFBSSxJQUFKLEVBQVU7QUFDUixVQUFJLFlBQVksUUFBUSxJQUF4QixFQUE4QjtBQUM1QixnQkFBUSxLQUFLLGNBQUwsQ0FBb0IsUUFBUSxNQUE1QixDQUFSOztBQUVBLFlBQUksQ0FBQyxLQUFMLEVBQVk7QUFDVixpQkFBUSxLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLENBQWpCLElBQXNCLElBQTlCO0FBQ0Q7O0FBRUQsWUFBSSxNQUFNLENBQU4sSUFBVyxDQUFmLEVBQWtCO0FBQ2hCLGlCQUFRLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsQ0FBakIsSUFBc0IsSUFBSSxNQUFNLElBQVYsQ0FBOUI7QUFDRDs7QUFFRCxlQUFPLE9BQVA7QUFDQSxhQUFLLEtBQUwsR0FBYSxLQUFiO0FBQ0EsZ0JBQVEsSUFBUjtBQUNBLGVBQU8sS0FBUDs7QUFFQSxZQUFJLE1BQU0sQ0FBTixJQUFXLENBQWYsRUFBa0I7QUFDbkI7QUFDRjs7QUFFRDtBQXJCQSxTQXNCSztBQUNILGdCQUFRLEtBQUssY0FBTCxDQUFvQixRQUFRLE1BQTVCLENBQVI7O0FBRUEsWUFBSSxDQUFDLEtBQUwsRUFBWTtBQUNWLGlCQUFRLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsQ0FBakIsSUFBc0IsSUFBOUI7QUFDRDs7QUFFRCxnQkFBUSxLQUFLLE1BQUwsQ0FBWSxPQUFaLENBQW9CLE1BQU0sQ0FBMUIsRUFBNkIsV0FBckM7O0FBRUEsWUFBSSxRQUFRLEtBQUssS0FBTCxDQUFXLENBQVgsS0FBaUIsTUFBTSxDQUFuQyxFQUFzQztBQUNwQyxrQkFBUSxLQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsT0FBTyxLQUFLLElBQVosQ0FBdkI7QUFDRCxTQUZELE1BRU87QUFDTCxrQkFBUSxDQUFSO0FBQ0Q7O0FBRUQsZ0JBQVEsS0FBSyxZQUFMLENBQWtCLENBQUMsTUFBTSxDQUFOLENBQUQsRUFBVyxNQUFNLENBQU4sSUFBUyxDQUFwQixDQUFsQixFQUEwQyxPQUExQyxFQUFtRCxLQUFuRCxDQUFSOztBQUVBLFlBQUksS0FBSixFQUFXO0FBQ1QsY0FBSSxRQUFRLFFBQVEsSUFBaEIsQ0FBSixFQUEyQjtBQUMzQixpQkFBTyxJQUFQO0FBQ0Esa0JBQVEsT0FBUjtBQUNBLGdCQUFNLEtBQU4sR0FBYyxDQUFkO0FBQ0EsZ0JBQU0sS0FBTixHQUFjLEtBQWQ7QUFDQTtBQUNBLG9CQUFVLE9BQU8sTUFBTSxJQUFiLENBQVY7QUFDQSxjQUFJLENBQUMsS0FBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixNQUFsQixJQUE0QixLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLE1BQWpCLElBQTJCLE1BQU0sTUFBTixHQUFlLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsS0FBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixNQUFqQixHQUEwQixDQUEzQyxFQUE4QyxNQUF4SCxFQUFnSTtBQUM5SCxpQkFBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixJQUFqQixDQUFzQixLQUF0QjtBQUNEO0FBQ0Y7O0FBRUQsWUFBSSxNQUFNLENBQU4sSUFBVyxDQUFmLEVBQWtCO0FBQ25CO0FBQ0Y7O0FBRUQsTUFBSSxTQUFTLE1BQU0sS0FBTixDQUFZLENBQVosR0FBZ0IsQ0FBN0IsRUFBZ0M7QUFDOUIsV0FBUSxLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLENBQWpCLElBQXNCLElBQUksTUFBTSxJQUFWLENBQTlCO0FBQ0Q7O0FBRUQsU0FBUSxLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLENBQWpCLElBQXNCLElBQTlCO0FBQ0QsQ0FuR0Q7O0FBcUdBO0FBQ0EsU0FBUyxTQUFULENBQW1CLGNBQW5CLEdBQW9DLFVBQVMsTUFBVCxFQUFpQjtBQUNuRCxNQUFJLFVBQVUsS0FBSyxLQUFMLENBQVcsTUFBekIsRUFBaUMsT0FBTyxLQUFLLEtBQUwsQ0FBVyxNQUFYLENBQWtCLE1BQWxCLENBQVA7QUFDakMsU0FBUSxLQUFLLEtBQUwsQ0FBVyxNQUFYLENBQWtCLE1BQWxCLElBQTRCLEtBQUssTUFBTCxDQUFZLGNBQVosQ0FBMkIsTUFBM0IsQ0FBcEM7QUFDRCxDQUhEOztBQUtBLFNBQVMsU0FBVCxDQUFtQixZQUFuQixHQUFrQyxVQUFTLEtBQVQsRUFBZ0IsT0FBaEIsRUFBeUIsS0FBekIsRUFBZ0M7QUFDaEUsTUFBSSxNQUFNLE1BQU0sSUFBTixFQUFWO0FBQ0EsTUFBSSxPQUFPLEtBQUssS0FBTCxDQUFXLEtBQXRCLEVBQTZCLE9BQU8sS0FBSyxLQUFMLENBQVcsS0FBWCxDQUFpQixHQUFqQixDQUFQO0FBQzdCLE1BQUksT0FBTyxLQUFLLE1BQUwsQ0FBWSxrQkFBWixDQUErQixLQUEvQixDQUFYO0FBQ0EsTUFBSSxRQUFRLEtBQUssT0FBTCxDQUFhLElBQWIsRUFBbUIsUUFBUSxNQUFSLEdBQWlCLE1BQU0sQ0FBTixDQUFwQyxFQUE4QyxLQUE5QyxDQUFaO0FBQ0EsU0FBUSxLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQWlCLEdBQWpCLElBQXdCLEtBQWhDO0FBQ0QsQ0FORDs7QUFRQSxTQUFTLFNBQVQsQ0FBbUIsT0FBbkIsR0FBNkIsVUFBUyxJQUFULEVBQWUsTUFBZixFQUF1QixTQUF2QixFQUFrQztBQUM3RCxRQUFNLFNBQU4sR0FBa0IsU0FBbEI7O0FBRUEsTUFBSSxRQUFRLE1BQU0sSUFBTixDQUFXLElBQVgsQ0FBWjtBQUNBLE1BQUksQ0FBQyxLQUFMLEVBQVk7O0FBRVosTUFBSSxJQUFJLE1BQU0sS0FBZDs7QUFFQSxNQUFJLE9BQU8sQ0FBWDs7QUFFQSxNQUFJLFFBQVEsSUFBWjs7QUFFQSxTQUNBLE9BQU8sSUFBSSxLQUFLLE1BQWhCLEVBQXdCLEdBQXhCLEVBQTZCO0FBQzNCLFFBQUksTUFBTSxLQUFLLENBQUwsQ0FBVjtBQUNBLFFBQUksT0FBTyxLQUFLLElBQUksQ0FBVCxDQUFYO0FBQ0EsUUFBSSxNQUFNLE1BQU0sSUFBaEI7QUFDQSxRQUFJLE1BQU0sTUFBVixFQUFrQixPQUFPLElBQVA7O0FBRWxCLFFBQUksSUFBSSxNQUFNLEdBQU4sQ0FBUjtBQUNBLFFBQUksQ0FBQyxDQUFMLEVBQVEsSUFBSSxNQUFNLEdBQU4sQ0FBSjtBQUNSLFFBQUksQ0FBQyxDQUFMLEVBQVE7QUFDTjtBQUNEOztBQUVELFFBQUksVUFBVSxNQUFNLENBQU4sRUFBUyxDQUFULENBQWQ7O0FBRUEsV0FBTyxDQUFQOztBQUVBLFlBQVEsUUFBUSxNQUFoQjtBQUNFLFdBQUssQ0FBTDtBQUNFLGVBQU8sRUFBRSxDQUFGLEdBQU0sS0FBSyxNQUFsQixFQUEwQjtBQUN4QixnQkFBTSxLQUFLLENBQUwsQ0FBTjs7QUFFQSxjQUFJLFFBQVEsS0FBSyxDQUFMLENBQVosRUFBcUI7QUFDbkIsY0FBRSxDQUFGO0FBQ0E7QUFDRDs7QUFFRCxjQUFJLFlBQVksR0FBaEIsRUFBcUI7QUFDbkIsaUJBQUssQ0FBTDtBQUNBO0FBQ0Q7O0FBRUQsY0FBSSxTQUFTLEdBQVQsSUFBZ0IsQ0FBQyxLQUFyQixFQUE0QjtBQUMxQixvQkFBUSxJQUFSO0FBQ0EsZ0JBQUksT0FBTyxDQUFYO0FBQ0EscUJBQVMsS0FBVDtBQUNEOztBQUVELGNBQUksTUFBTSxNQUFWLEVBQWtCO0FBQ2hCLG9CQUFRLEtBQVI7QUFDQTtBQUNEO0FBQ0Y7QUFDRDtBQUNGLFdBQUssQ0FBTDtBQUNFLGVBQU8sRUFBRSxDQUFGLEdBQU0sS0FBSyxNQUFsQixFQUEwQjs7QUFFeEIsZ0JBQU0sS0FBSyxDQUFMLENBQU47QUFDQSxnQkFBTSxLQUFLLENBQUwsSUFBVSxLQUFLLElBQUksQ0FBVCxDQUFoQjs7QUFFQSxjQUFJLFFBQVEsS0FBSyxDQUFMLENBQVosRUFBcUI7QUFDbkIsY0FBRSxDQUFGO0FBQ0E7QUFDRDs7QUFFRCxjQUFJLFlBQVksR0FBaEIsRUFBcUI7QUFDbkIsaUJBQUssQ0FBTDtBQUNBO0FBQ0Q7O0FBRUQsY0FBSSxTQUFTLEdBQVQsSUFBZ0IsQ0FBQyxLQUFyQixFQUE0QjtBQUMxQixvQkFBUSxJQUFSO0FBQ0EsZ0JBQUksT0FBTyxDQUFYO0FBQ0EscUJBQVMsS0FBVDtBQUNEOztBQUVELGNBQUksTUFBTSxNQUFWLEVBQWtCO0FBQ2hCLG9CQUFRLEtBQVI7QUFDQTtBQUNEO0FBQ0Y7QUFDRDtBQXRESjtBQXdERDtBQUNELFNBQU8sS0FBUDtBQUNELENBdkZEOztBQXlGQSxTQUFTLFNBQVQsQ0FBbUIsYUFBbkIsR0FBbUMsVUFBUyxDQUFULEVBQVk7QUFDN0MsTUFBSSxJQUFJLGFBQWEsS0FBSyxLQUFMLENBQVcsS0FBeEIsRUFBK0I7QUFBQSxXQUFLLEVBQUUsS0FBRixDQUFRLENBQVIsR0FBWSxDQUFqQjtBQUFBLEdBQS9CLENBQVI7QUFDQSxNQUFJLEVBQUUsSUFBRixJQUFVLElBQUksQ0FBSixHQUFRLEVBQUUsSUFBRixDQUFPLEtBQVAsQ0FBYSxDQUFuQyxFQUFzQyxPQUFPLElBQVAsQ0FBdEMsS0FDSyxPQUFPLENBQVA7QUFDTDtBQUNELENBTEQ7Ozs7O0FDdFJBOzs7Ozs7Ozs7Ozs7OztBQWNBLE9BQU8sT0FBUCxHQUFpQixVQUFqQjs7QUFFQSxTQUFTLElBQVQsQ0FBYyxLQUFkLEVBQXFCLEtBQXJCLEVBQTRCO0FBQzFCLE9BQUssS0FBTCxHQUFhLEtBQWI7QUFDQSxPQUFLLEtBQUwsR0FBYSxLQUFiO0FBQ0EsT0FBSyxLQUFMLEdBQWEsSUFBSSxLQUFKLENBQVUsS0FBSyxLQUFmLEVBQXNCLElBQXRCLENBQTJCLFNBQVMsTUFBTSxNQUFmLElBQXlCLENBQXBELENBQWI7QUFDQSxPQUFLLElBQUwsR0FBWSxJQUFJLEtBQUosQ0FBVSxLQUFLLEtBQWYsRUFBc0IsSUFBdEIsQ0FBMkIsSUFBM0IsQ0FBWjtBQUNEOztBQUVELEtBQUssU0FBTCxHQUFpQjtBQUNmLE1BQUksTUFBSixHQUFhO0FBQ1gsV0FBTyxLQUFLLEtBQUwsQ0FBVyxDQUFYLENBQVA7QUFDRDtBQUhjLENBQWpCOztBQU1BLFNBQVMsVUFBVCxDQUFvQixDQUFwQixFQUF1QjtBQUNyQixNQUFJLEtBQUssRUFBVDtBQUNBLE9BQUssTUFBTCxHQUFjLEVBQUUsTUFBRixJQUFZLEVBQTFCO0FBQ0EsT0FBSyxJQUFMLEdBQVksRUFBRSxJQUFGLElBQVUsSUFBSSxLQUFLLENBQS9CO0FBQ0EsT0FBSyxJQUFMLEdBQVksSUFBSSxJQUFKLENBQVMsSUFBVCxFQUFlLEtBQUssTUFBcEIsQ0FBWjtBQUNBLE9BQUssU0FBTCxHQUFpQixFQUFFLFNBQUYsSUFBZSxJQUFoQztBQUNEOztBQUVELFdBQVcsU0FBWCxHQUF1QjtBQUNyQixNQUFJLE1BQUosR0FBYTtBQUNYLFdBQU8sS0FBSyxJQUFMLENBQVUsS0FBVixDQUFnQixLQUFLLE1BQUwsR0FBYyxDQUE5QixDQUFQO0FBQ0Q7QUFIb0IsQ0FBdkI7O0FBTUEsV0FBVyxTQUFYLENBQXFCLEdBQXJCLEdBQTJCLFVBQVMsTUFBVCxFQUFpQjtBQUMxQztBQUNBO0FBQ0EsU0FBTyxLQUFLLE1BQUwsQ0FBWSxNQUFaLEVBQW9CLElBQXBCLENBQVA7QUFDRCxDQUpEOztBQU1BLFdBQVcsU0FBWCxDQUFxQixHQUFyQixHQUEyQixVQUFTLElBQVQsRUFBZTtBQUN4QyxPQUFLLGFBQUwsQ0FBbUIsQ0FBbkIsRUFBc0IsSUFBdEI7QUFDRCxDQUZEOztBQUlBLFdBQVcsU0FBWCxDQUFxQixNQUFyQixHQUE4QixVQUFTLE1BQVQsRUFBaUIsSUFBakIsRUFBdUI7QUFDbkQsU0FBTyxPQUFPLEVBQVAsR0FBWSxDQUFuQjs7QUFFQTtBQUNBLE1BQUksUUFBUSxJQUFJLEtBQUosQ0FBVSxLQUFLLE1BQWYsQ0FBWjtBQUNBLE1BQUksUUFBUSxJQUFJLEtBQUosQ0FBVSxLQUFLLE1BQWYsQ0FBWjs7QUFFQTtBQUNBLE1BQUksSUFBSSxLQUFLLE1BQWI7QUFDQSxNQUFJLE9BQU8sS0FBSyxJQUFoQjs7QUFFQSxTQUFPLEdBQVAsRUFBWTtBQUNWLFdBQU8sU0FBUyxJQUFULEdBQWdCLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBaEIsSUFBaUMsUUFBUSxLQUFLLElBQUwsQ0FBVSxDQUFWLENBQWhELEVBQThEO0FBQzVELGdCQUFVLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBVjtBQUNBLGFBQU8sS0FBSyxJQUFMLENBQVUsQ0FBVixDQUFQO0FBQ0Q7QUFDRCxVQUFNLENBQU4sSUFBVyxJQUFYO0FBQ0EsVUFBTSxDQUFOLElBQVcsTUFBWDtBQUNEOztBQUVELFNBQU87QUFDTCxVQUFNLElBREQ7QUFFTCxXQUFPLEtBRkY7QUFHTCxXQUFPLEtBSEY7QUFJTCxZQUFRO0FBSkgsR0FBUDtBQU1ELENBMUJEOztBQTRCQSxXQUFXLFNBQVgsQ0FBcUIsTUFBckIsR0FBOEIsVUFBUyxDQUFULEVBQVksTUFBWixFQUFvQixLQUFwQixFQUEyQixLQUEzQixFQUFrQztBQUM5RCxNQUFJLFFBQVEsRUFBRSxLQUFkLENBRDhELENBQ3pDO0FBQ3JCLE1BQUksUUFBUSxFQUFFLEtBQWQ7O0FBRUEsTUFBSSxDQUFKLENBSjhELENBSXZEO0FBQ1AsTUFBSSxDQUFKLENBTDhELENBS3ZEO0FBQ1AsTUFBSSxHQUFKOztBQUVBO0FBQ0EsVUFBUSxTQUFTLEtBQUssV0FBTCxFQUFqQjtBQUNBLE1BQUksSUFBSSxJQUFKLENBQVMsS0FBVCxFQUFnQixLQUFoQixDQUFKO0FBQ0EsV0FBUyxFQUFFLEtBQUYsQ0FBUSxDQUFSLENBQVQ7O0FBRUE7QUFDQSxNQUFJLENBQUo7O0FBRUE7QUFDQSxNQUFJLEtBQUo7QUFDQSxTQUFPLEdBQVAsRUFBWTtBQUNWLFFBQUksTUFBTSxDQUFOLENBQUosQ0FEVSxDQUNJO0FBQ2QsTUFBRSxJQUFGLENBQU8sQ0FBUCxJQUFZLEVBQUUsSUFBRixDQUFPLENBQVAsQ0FBWixDQUZVLENBRWE7QUFDdkIsTUFBRSxJQUFGLENBQU8sQ0FBUCxJQUFZLENBQVosQ0FIVSxDQUdLO0FBQ2YsTUFBRSxLQUFGLENBQVEsQ0FBUixJQUFhLEVBQUUsS0FBRixDQUFRLENBQVIsSUFBYSxNQUFNLENBQU4sQ0FBYixHQUF3QixNQUFyQztBQUNBLE1BQUUsS0FBRixDQUFRLENBQVIsSUFBYSxNQUFNLENBQU4sQ0FBYjtBQUNEOztBQUVEO0FBQ0EsTUFBSSxLQUFLLE1BQVQ7QUFDQSxTQUFPLE1BQU0sS0FBYixFQUFvQjtBQUNsQixRQUFJLE1BQU0sQ0FBTixDQUFKLENBRGtCLENBQ0o7QUFDZCxNQUFFLEtBQUYsQ0FBUSxDQUFSLEtBQWMsTUFBZCxDQUZrQixDQUVJO0FBQ3ZCOztBQUVEO0FBQ0EsU0FBTyxDQUFQO0FBQ0QsQ0FuQ0Q7O0FBcUNBLFdBQVcsU0FBWCxDQUFxQixNQUFyQixHQUE4QixVQUFTLE1BQVQsRUFBaUIsS0FBakIsRUFBd0IsS0FBeEIsRUFBK0I7QUFDM0QsTUFBSSxJQUFJLEtBQUssTUFBTCxDQUFZLE1BQVosQ0FBUjs7QUFFQTtBQUNBO0FBQ0EsTUFBSSxFQUFFLE1BQUYsSUFBWSxFQUFFLElBQUYsQ0FBTyxLQUFuQixJQUE0QixFQUFFLE1BQUYsR0FBVyxFQUFFLElBQUYsQ0FBTyxLQUFQLENBQWEsTUFBeEQsRUFBZ0U7QUFDOUQsU0FBSyxNQUFMLENBQVksQ0FBWixFQUFlLE9BQU8sRUFBRSxNQUFULEVBQWlCLEVBQUUsSUFBRixDQUFPLEtBQXhCLEVBQStCLEtBQS9CLENBQWY7QUFDQSxXQUFPLEVBQUUsSUFBVDtBQUNEOztBQUVELFNBQU8sS0FBSyxNQUFMLENBQVksQ0FBWixFQUFlLE1BQWYsRUFBdUIsS0FBdkIsRUFBOEIsS0FBOUIsQ0FBUDtBQUNELENBWEQ7O0FBYUEsV0FBVyxTQUFYLENBQXFCLE1BQXJCLEdBQThCLFVBQVMsQ0FBVCxFQUFZLEtBQVosRUFBbUI7QUFDL0M7QUFDQSxNQUFJLFNBQVMsRUFBRSxJQUFGLENBQU8sS0FBUCxDQUFhLE1BQWIsR0FBc0IsTUFBTSxNQUF6Qzs7QUFFQTtBQUNBLElBQUUsSUFBRixDQUFPLEtBQVAsR0FBZSxLQUFmOztBQUVBO0FBQ0EsTUFBSSxDQUFKOztBQUVBO0FBQ0EsTUFBSSxLQUFLLE1BQVQ7O0FBRUEsU0FBTyxHQUFQLEVBQVk7QUFDVixNQUFFLEtBQUYsQ0FBUSxDQUFSLEVBQVcsS0FBWCxDQUFpQixDQUFqQixLQUF1QixNQUF2QjtBQUNEOztBQUVELFNBQU8sTUFBUDtBQUNELENBbEJEOztBQW9CQSxXQUFXLFNBQVgsQ0FBcUIsTUFBckIsR0FBOEIsVUFBUyxLQUFULEVBQWdCO0FBQzVDLE1BQUksTUFBTSxDQUFOLElBQVcsS0FBSyxNQUFwQixFQUE0QjtBQUMxQixVQUFNLElBQUksS0FBSixDQUNKLG1DQUNBLEtBQUssTUFETCxHQUNjLE1BRGQsR0FDdUIsTUFBTSxJQUFOLEVBRHZCLEdBQ3NDLEdBRmxDLENBQU47QUFJRDs7QUFFRDtBQUNBLE1BQUksSUFBSSxNQUFNLENBQU4sSUFBVyxNQUFNLENBQU4sQ0FBbkI7O0FBRUE7QUFDQSxNQUFJLElBQUksS0FBSyxNQUFMLENBQVksTUFBTSxDQUFOLENBQVosQ0FBUjtBQUNBLE1BQUksU0FBUyxFQUFFLE1BQWY7QUFDQSxNQUFJLFFBQVEsRUFBRSxLQUFkO0FBQ0EsTUFBSSxPQUFPLEVBQUUsSUFBYjs7QUFFQTtBQUNBLE1BQUksS0FBSyxJQUFMLEtBQWMsSUFBbEIsRUFBd0IsT0FBTyxLQUFLLElBQUwsQ0FBVSxDQUFWLENBQVA7O0FBRXhCO0FBQ0EsTUFBSSxNQUFKLEVBQVk7QUFDVixRQUFJLFNBQVMsS0FBSyxLQUFMLENBQVcsQ0FBWCxDQUFiLEVBQTRCO0FBQzFCLFdBQUssS0FBSyxNQUFMLENBQVksQ0FBWixFQUNILEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsQ0FBakIsRUFBb0IsTUFBcEIsSUFDQSxLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQ0UsU0FDQSxLQUFLLEdBQUwsQ0FBUyxDQUFULEVBQVksS0FBSyxNQUFMLEdBQWMsTUFBMUIsQ0FGRixDQUZHLENBQUw7QUFPRDs7QUFFRCxXQUFPLEtBQUssSUFBTCxDQUFVLENBQVYsQ0FBUDs7QUFFQSxRQUFJLENBQUMsSUFBTCxFQUFXO0FBQ1o7O0FBRUQ7QUFDQSxTQUFPLFFBQVEsS0FBSyxLQUFLLEtBQUwsQ0FBVyxDQUFYLENBQXBCLEVBQW1DO0FBQ2pDLFNBQUssS0FBSyxVQUFMLENBQWdCLEtBQWhCLEVBQXVCLElBQXZCLENBQUw7QUFDQSxXQUFPLEtBQUssSUFBTCxDQUFVLENBQVYsQ0FBUDtBQUNEOztBQUVEO0FBQ0EsTUFBSSxDQUFKLEVBQU87QUFDTCxTQUFLLE9BQUwsQ0FBYSxLQUFiLEVBQW9CLElBQXBCLEVBQTBCLEtBQUssS0FBTCxDQUFXLEtBQVgsQ0FBaUIsQ0FBakIsQ0FBMUI7QUFDRDtBQUNGLENBL0NEOztBQWlEQSxXQUFXLFNBQVgsQ0FBcUIsVUFBckIsR0FBa0MsVUFBUyxLQUFULEVBQWdCLElBQWhCLEVBQXNCO0FBQ3RELE1BQUksU0FBUyxLQUFLLEtBQUwsQ0FBVyxDQUFYLENBQWI7O0FBRUEsTUFBSSxDQUFKOztBQUVBLE1BQUksS0FBSyxLQUFUO0FBQ0EsU0FBTyxHQUFQLEVBQVk7QUFDVixVQUFNLENBQU4sRUFBUyxLQUFULENBQWUsQ0FBZixLQUFxQixTQUFTLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBOUI7QUFDQSxVQUFNLENBQU4sRUFBUyxJQUFULENBQWMsQ0FBZCxJQUFtQixLQUFLLElBQUwsQ0FBVSxDQUFWLENBQW5CO0FBQ0Q7O0FBRUQsTUFBSSxLQUFLLE1BQVQ7QUFDQSxTQUFPLE1BQU0sS0FBSyxLQUFsQixFQUF5QjtBQUN2QixVQUFNLENBQU4sRUFBUyxLQUFULENBQWUsQ0FBZixLQUFxQixNQUFyQjtBQUNEOztBQUVELFNBQU8sTUFBUDtBQUNELENBakJEOztBQW1CQSxXQUFXLFNBQVgsQ0FBcUIsT0FBckIsR0FBK0IsVUFBUyxLQUFULEVBQWdCLElBQWhCLEVBQXNCLEtBQXRCLEVBQTZCO0FBQzFELE1BQUksU0FBUyxLQUFLLEtBQUwsQ0FBVyxNQUFYLEdBQW9CLE1BQU0sTUFBdkM7O0FBRUEsT0FBSyxLQUFMLEdBQWEsS0FBYjs7QUFFQSxNQUFJLENBQUo7QUFDQSxNQUFJLEtBQUssS0FBVDtBQUNBLFNBQU8sR0FBUCxFQUFZO0FBQ1YsU0FBSyxLQUFMLENBQVcsQ0FBWCxLQUFpQixNQUFqQjtBQUNEOztBQUVELE1BQUksS0FBSyxNQUFUO0FBQ0EsU0FBTyxNQUFNLEtBQUssS0FBbEIsRUFBeUI7QUFDdkIsVUFBTSxDQUFOLEVBQVMsS0FBVCxDQUFlLENBQWYsS0FBcUIsTUFBckI7QUFDRDs7QUFFRCxTQUFPLE1BQVA7QUFDRCxDQWpCRDs7QUFtQkEsV0FBVyxTQUFYLENBQXFCLFlBQXJCLEdBQW9DLFVBQVMsTUFBVCxFQUFpQjtBQUNuRCxTQUFPLEtBQUssTUFBTCxDQUFZLENBQUMsTUFBRCxFQUFTLFNBQU8sQ0FBaEIsQ0FBWixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxXQUFXLFNBQVgsQ0FBcUIsYUFBckIsR0FBcUMsVUFBUyxNQUFULEVBQWlCLElBQWpCLEVBQXVCO0FBQzFELE9BQUssSUFBSSxJQUFJLENBQWIsRUFBZ0IsSUFBSSxLQUFLLE1BQXpCLEVBQWlDLEtBQUssS0FBSyxTQUEzQyxFQUFzRDtBQUNwRCxRQUFJLFFBQVEsS0FBSyxNQUFMLENBQVksQ0FBWixFQUFlLEtBQUssU0FBcEIsQ0FBWjtBQUNBLFNBQUssTUFBTCxDQUFZLElBQUksTUFBaEIsRUFBd0IsS0FBeEI7QUFDRDtBQUNGLENBTEQ7O0FBT0EsV0FBVyxTQUFYLENBQXFCLFNBQXJCLEdBQWlDLFVBQVMsQ0FBVCxFQUFZLENBQVosRUFBZTtBQUM5QyxNQUFJLFNBQVMsSUFBSSxDQUFqQjs7QUFFQSxNQUFJLFNBQVMsS0FBSyxNQUFMLENBQVksQ0FBWixFQUFlLElBQWYsQ0FBYjtBQUNBLE1BQUksT0FBTyxPQUFPLElBQWxCO0FBQ0EsTUFBSSxLQUFLLElBQUwsS0FBYyxJQUFsQixFQUF3QixPQUFPLEtBQUssSUFBTCxDQUFVLENBQVYsQ0FBUDtBQUN4QixNQUFJLElBQUksU0FBUyxPQUFPLE1BQXhCO0FBQ0EsTUFBSSxJQUFJLEVBQVI7QUFDQSxTQUFPLFFBQVEsS0FBSyxDQUFwQixFQUF1QjtBQUNyQixTQUFLLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBTDtBQUNBLFNBQUssS0FBSyxLQUFWO0FBQ0EsV0FBTyxLQUFLLElBQUwsQ0FBVSxDQUFWLENBQVA7QUFDRDtBQUNELE1BQUksSUFBSixFQUFVO0FBQ1IsU0FBSyxLQUFLLEtBQVY7QUFDRDs7QUFFRCxTQUFPLEVBQUUsTUFBRixDQUFTLE9BQU8sTUFBaEIsRUFBd0IsTUFBeEIsQ0FBUDtBQUNELENBbEJEOztBQW9CQSxXQUFXLFNBQVgsQ0FBcUIsV0FBckIsR0FBbUMsWUFBVztBQUM1QyxNQUFJLFFBQVEsQ0FBWjtBQUNBLFNBQU8sUUFBUSxLQUFLLE1BQUwsR0FBYyxDQUF0QixJQUEyQixLQUFLLE1BQUwsS0FBZ0IsS0FBSyxJQUF2RDtBQUE2RDtBQUE3RCxHQUNBLE9BQU8sS0FBUDtBQUNELENBSkQ7O0FBTUEsV0FBVyxTQUFYLENBQXFCLFFBQXJCLEdBQWdDLFVBQVMsS0FBVCxFQUFnQjtBQUM5QyxVQUFRLFNBQVMsRUFBakI7QUFDQSxTQUFPLEtBQUssU0FBTCxDQUFlLE1BQU0sQ0FBTixDQUFmLEVBQXlCLE1BQU0sQ0FBTixDQUF6QixDQUFQO0FBQ0QsQ0FIRDs7QUFLQSxXQUFXLFNBQVgsQ0FBcUIsSUFBckIsR0FBNEIsWUFBVztBQUNyQyxNQUFJLE9BQU8sSUFBSSxVQUFKLEVBQVg7QUFDQSxNQUFJLE9BQU8sS0FBSyxJQUFoQjtBQUNBLE1BQUksU0FBUyxDQUFiO0FBQ0EsU0FBTyxPQUFPLEtBQUssSUFBTCxDQUFVLENBQVYsQ0FBZCxFQUE0QjtBQUMxQixTQUFLLE1BQUwsQ0FBWSxNQUFaLEVBQW9CLEtBQUssS0FBekI7QUFDQSxjQUFVLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBVjtBQUNEO0FBQ0QsU0FBTyxJQUFQO0FBQ0QsQ0FURDs7QUFXQSxXQUFXLFNBQVgsQ0FBcUIsVUFBckIsR0FBa0MsVUFBUyxTQUFULEVBQW9CO0FBQ3BELE1BQUksUUFBUSxFQUFaO0FBQ0EsTUFBSSxPQUFPLEtBQUssSUFBaEI7QUFDQSxTQUFPLE9BQU8sS0FBSyxJQUFMLENBQVUsQ0FBVixDQUFkLEVBQTRCO0FBQzFCLFVBQU0sSUFBTixDQUFXLEtBQUssS0FBaEI7QUFDRDtBQUNELFNBQU8sTUFBTSxJQUFOLENBQVcsU0FBWCxDQUFQO0FBQ0QsQ0FQRDs7QUFTQSxXQUFXLFNBQVgsQ0FBcUIsUUFBckIsR0FBZ0MsWUFBVztBQUN6QyxTQUFPLEtBQUssU0FBTCxDQUFlLENBQWYsRUFBa0IsS0FBSyxNQUF2QixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxTQUFTLElBQVQsQ0FBYyxDQUFkLEVBQWlCLElBQWpCLEVBQXVCLEtBQXZCLEVBQThCO0FBQzVCLFNBQU8sRUFBRSxNQUFGLENBQVMsQ0FBVCxFQUFZLEVBQUUsTUFBRixHQUFXLEtBQXZCLEVBQThCLE1BQTlCLENBQXFDLElBQXJDLENBQVA7QUFDRDs7QUFFRCxTQUFTLE1BQVQsQ0FBZ0IsTUFBaEIsRUFBd0IsTUFBeEIsRUFBZ0MsSUFBaEMsRUFBc0M7QUFDcEMsU0FBTyxPQUFPLEtBQVAsQ0FBYSxDQUFiLEVBQWdCLE1BQWhCLElBQTBCLElBQTFCLEdBQWlDLE9BQU8sS0FBUCxDQUFhLE1BQWIsQ0FBeEM7QUFDRDs7Ozs7QUN0VEQsSUFBSSxTQUFTLFFBQVEsa0JBQVIsQ0FBYjtBQUNBLElBQUksSUFBSSxPQUFPLE1BQWY7O0FBRUE7QUFDQSxJQUFJLFNBQVMsSUFBSTtBQUNmLE9BQUssRUFBRSxDQUFDLFVBQUQsQ0FBRixFQUFnQixHQUFoQixFQUFxQixRQUFyQixDQURVO0FBRWYsT0FBSyxFQUFFLENBQUMsUUFBRCxDQUFGLEVBQWdCLEdBQWhCLENBRlU7QUFHZixPQUFLLEVBQUUsQ0FBQyxTQUFELENBQUYsRUFBZ0IsR0FBaEIsQ0FIVTtBQUlmLE9BQUssRUFBRSxDQUFDLFVBQUQsQ0FBRixFQUFnQixHQUFoQixDQUpVO0FBS2YsT0FBSyxFQUFFLENBQUMsU0FBRCxDQUFGLEVBQWdCLEdBQWhCLENBTFU7QUFNZixPQUFLLEVBQUUsQ0FBQyxTQUFELENBQUYsRUFBZ0IsR0FBaEIsQ0FOVTtBQU9mLE9BQUssRUFBRSxDQUFDLFFBQUQsQ0FBRixFQUFnQixHQUFoQixDQVBVO0FBUWYsT0FBSyxFQUFFLENBQUMsaUJBQUQsQ0FBRixFQUF1QixHQUF2QixDQVJVO0FBU2YsT0FBSyxFQUFFLENBQUMsU0FBRCxFQUFXLFFBQVgsQ0FBRixFQUF3QixHQUF4QjtBQVRVLENBQUosRUFVVixPQVZVLENBQWI7O0FBWUEsSUFBSSxTQUFTO0FBQ1gsVUFBUSxFQUFFLENBQUMsUUFBRCxDQUFGLEVBQWMsSUFBZCxDQURHO0FBRVgsWUFBVSxrQkFBQyxDQUFEO0FBQUEsV0FBTyxFQUFFLE9BQUYsQ0FBVSxZQUFWLEVBQXdCLFdBQXhCLENBQVA7QUFBQTtBQUZDLENBQWI7O0FBS0EsSUFBSSxVQUFVLEtBQWQ7O0FBRUEsSUFBSSxTQUFTLEVBQUUsQ0FBQyxTQUFELEVBQVcsUUFBWCxFQUFvQixRQUFwQixDQUFGLEVBQWlDLElBQWpDLENBQWI7O0FBRUEsSUFBSSxZQUFZLGVBQWhCOztBQUVBLElBQUksTUFBTTtBQUNSLFFBQU0sR0FERTtBQUVSLFFBQU0sR0FGRTtBQUdSLE9BQUssR0FIRztBQUlSLE9BQUssR0FKRztBQUtSLE9BQUssR0FMRztBQU1SLE9BQUs7QUFORyxDQUFWOztBQVNBLE9BQU8sT0FBUCxHQUFpQixNQUFqQjs7QUFFQSxTQUFTLE1BQVQsQ0FBZ0IsQ0FBaEIsRUFBbUI7QUFDakIsTUFBSSxLQUFLLEVBQVQ7QUFDQSxPQUFLLEdBQUwsR0FBVyxFQUFFLEdBQUYsSUFBUyxJQUFwQjtBQUNBLE9BQUssTUFBTCxHQUFjLEVBQWQ7QUFDRDs7QUFFRCxPQUFPLFNBQVAsQ0FBaUIsUUFBakIsR0FBNEIsUUFBNUI7O0FBRUEsT0FBTyxTQUFQLENBQWlCLFNBQWpCLEdBQTZCLFVBQVMsSUFBVCxFQUFlLE1BQWYsRUFBdUI7QUFDbEQsU0FBTyxLQUFLLGFBQUwsQ0FBbUIsSUFBbkIsQ0FBUDtBQUNBLFNBQU8sS0FBSyxZQUFMLENBQWtCLElBQWxCLENBQVA7QUFDQSxTQUFPLFNBQVMsSUFBVCxDQUFQOztBQUVBLE9BQUssSUFBSSxHQUFULElBQWdCLE1BQWhCLEVBQXdCO0FBQ3RCLFdBQU8sS0FBSyxPQUFMLENBQWEsT0FBTyxHQUFQLEVBQVksTUFBekIsRUFBaUMsT0FBTyxHQUFQLEVBQVksUUFBN0MsQ0FBUDtBQUNEOztBQUVELFNBQU8sS0FBSyxhQUFMLENBQW1CLElBQW5CLENBQVA7QUFDQSxTQUFPLEtBQUssT0FBTCxDQUFhLE9BQU8sTUFBcEIsRUFBNEIsT0FBTyxRQUFuQyxDQUFQOztBQUVBLFNBQU8sSUFBUDtBQUNELENBYkQ7O0FBZUEsT0FBTyxTQUFQLENBQWlCLGFBQWpCLEdBQWlDLFVBQVMsSUFBVCxFQUFlO0FBQzlDLE1BQUksUUFBUSxLQUFLLEtBQUwsQ0FBVyxLQUFYLENBQVo7QUFDQSxNQUFJLFNBQVMsQ0FBYjtBQUNBLE1BQUksS0FBSjtBQUNBLE1BQUksSUFBSjtBQUNBLE1BQUksQ0FBSjs7QUFFQSxNQUFJLE1BQU0sTUFBVjs7QUFFQSxTQUFPLEdBQVAsRUFBWTtBQUNWLFdBQU8sTUFBTSxDQUFOLENBQVA7QUFDQSxZQUFRLFNBQVIsR0FBb0IsQ0FBcEI7QUFDQSxZQUFRLFFBQVEsSUFBUixDQUFhLElBQWIsQ0FBUjtBQUNBLFFBQUksS0FBSixFQUFXLFNBQVMsTUFBTSxLQUFmLENBQVgsS0FDSyxJQUFJLFVBQVUsQ0FBQyxLQUFLLE1BQXBCLEVBQTRCO0FBQy9CLFlBQU0sQ0FBTixJQUFXLElBQUksS0FBSixDQUFVLFNBQVMsQ0FBbkIsRUFBc0IsSUFBdEIsQ0FBMkIsS0FBSyxHQUFoQyxDQUFYO0FBQ0Q7QUFDRjs7QUFFRCxTQUFPLE1BQU0sSUFBTixDQUFXLElBQVgsQ0FBUDs7QUFFQSxTQUFPLElBQVA7QUFDRCxDQXRCRDs7QUF3QkEsT0FBTyxTQUFQLENBQWlCLGFBQWpCLEdBQWlDLFVBQVMsSUFBVCxFQUFlO0FBQzlDLE1BQUksS0FBSjtBQUNBLE1BQUksU0FBUyxLQUFLLE1BQWxCO0FBQ0EsTUFBSSxJQUFJLENBQVI7QUFDQSxTQUFPLEtBQ0osT0FESSxDQUNJLFNBREosRUFDZSxZQUFXO0FBQzdCLFlBQVEsT0FBTyxHQUFQLENBQVI7QUFDQSxXQUFPLFNBQVMsTUFBTSxLQUFOLENBQVksQ0FBWixFQUFlLElBQWYsSUFBdUIsNkJBQWhDLENBQVA7QUFDRCxHQUpJLEVBS0osT0FMSSxDQUtJLFNBTEosRUFLZSxZQUFXO0FBQzdCLFlBQVEsT0FBTyxHQUFQLENBQVI7QUFDQSxRQUFJLE1BQU0sU0FBUyxLQUFULENBQVY7QUFDQSxXQUFPLE1BQUksR0FBSixHQUFRLEdBQVIsR0FBWSxTQUFTLEtBQVQsQ0FBWixHQUE0QixJQUE1QixHQUFpQyxHQUFqQyxHQUFxQyxHQUE1QztBQUNELEdBVEksQ0FBUDtBQVVELENBZEQ7O0FBZ0JBLE9BQU8sU0FBUCxDQUFpQixZQUFqQixHQUFnQyxVQUFTLElBQVQsRUFBZTtBQUFBOztBQUM3QyxPQUFLLE1BQUwsR0FBYyxFQUFkOztBQUVBLFNBQU8sS0FDSixPQURJLENBQ0ksU0FESixFQUNlLFVBQUMsS0FBRCxFQUFXO0FBQzdCLFVBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsS0FBakI7QUFDQSxXQUFPLFFBQVA7QUFDRCxHQUpJLEVBS0osT0FMSSxDQUtJLE1BTEosRUFLWSxVQUFDLEtBQUQsRUFBVztBQUMxQixVQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLEtBQWpCO0FBQ0EsV0FBTyxRQUFQO0FBQ0QsR0FSSSxDQUFQOztBQVVBLFNBQU8sSUFBUDtBQUNELENBZEQ7O0FBZ0JBLFNBQVMsUUFBVCxHQUFvQjtBQUNsQixNQUFJLFdBQVcsNEJBQWY7QUFDQSxNQUFJLFNBQVMsU0FBUyxNQUFULEdBQWtCLENBQS9CO0FBQ0EsTUFBSSxJQUFJLENBQVI7QUFDQSxNQUFJLElBQUksRUFBUjtBQUNBLFNBQU8sR0FBUCxFQUFZO0FBQ1YsU0FBSyxTQUFTLEtBQUssTUFBTCxLQUFnQixNQUFoQixHQUF5QixDQUFsQyxDQUFMO0FBQ0Q7QUFDRCxTQUFPLENBQVA7QUFDRDs7QUFFRCxTQUFTLFFBQVQsQ0FBa0IsSUFBbEIsRUFBd0I7QUFDdEIsU0FBTyxLQUNKLE9BREksQ0FDSSxJQURKLEVBQ1UsT0FEVixFQUVKLE9BRkksQ0FFSSxJQUZKLEVBRVUsTUFGVixFQUdKLE9BSEksQ0FHSSxJQUhKLEVBR1UsTUFIVixDQUFQO0FBS0Q7O0FBRUQsU0FBUyxPQUFULENBQWlCLE1BQWpCLEVBQXlCLEdBQXpCLEVBQThCO0FBQzVCLE1BQUksVUFBVSxNQUFNLEdBQU4sR0FBWSxHQUExQjtBQUNBLE1BQUksV0FBVyxPQUFPLEdBQVAsR0FBYSxHQUE1QjtBQUNBLFNBQU87QUFDTCxVQUFNLEdBREQ7QUFFTCxZQUFRLE1BRkg7QUFHTCxjQUFVLFVBQVUsSUFBVixHQUFpQjtBQUh0QixHQUFQO0FBS0Q7O0FBRUQsU0FBUyxHQUFULENBQWEsR0FBYixFQUFrQixFQUFsQixFQUFzQjtBQUNwQixNQUFJLFNBQVMsRUFBYjtBQUNBLE9BQUssSUFBSSxHQUFULElBQWdCLEdBQWhCLEVBQXFCO0FBQ25CLFdBQU8sR0FBUCxJQUFjLEdBQUcsSUFBSSxHQUFKLENBQUgsRUFBYSxHQUFiLENBQWQ7QUFDRDtBQUNELFNBQU8sTUFBUDtBQUNEOztBQUVELFNBQVMsT0FBVCxDQUFpQixJQUFqQixFQUF1QixJQUF2QixFQUE2QjtBQUMzQixPQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksS0FBSyxNQUF6QixFQUFpQyxHQUFqQyxFQUFzQztBQUNwQyxXQUFPLEtBQUssT0FBTCxDQUFhLEtBQUssQ0FBTCxFQUFRLENBQVIsQ0FBYixFQUF5QixLQUFLLENBQUwsRUFBUSxDQUFSLENBQXpCLENBQVA7QUFDRDtBQUNELFNBQU8sSUFBUDtBQUNEOztBQUVELFNBQVMsTUFBVCxDQUFnQixNQUFoQixFQUF3QixNQUF4QixFQUFnQyxJQUFoQyxFQUFzQztBQUNwQyxTQUFPLE9BQU8sS0FBUCxDQUFhLENBQWIsRUFBZ0IsTUFBaEIsSUFBMEIsSUFBMUIsR0FBaUMsT0FBTyxLQUFQLENBQWEsTUFBYixDQUF4QztBQUNEOztBQUVELFNBQVMsUUFBVCxDQUFrQixLQUFsQixFQUF5QjtBQUN2QixNQUFJLE1BQU0sTUFBTSxDQUFOLENBQVY7QUFDQSxNQUFJLE1BQU0sTUFBTSxNQUFNLENBQU4sQ0FBaEI7QUFDQSxTQUFPLElBQUksR0FBSixLQUFZLElBQUksR0FBSixDQUFuQjtBQUNEOzs7OztBQ3pLRCxJQUFJLFFBQVEsUUFBUSxpQkFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsU0FBUixDQUFaOztBQUVBLElBQUksT0FBTztBQUNULFFBQU0sT0FERztBQUVULE9BQUssWUFGSTtBQUdULE9BQUssYUFISTtBQUlULE9BQUssYUFKSTtBQUtULE9BQUssY0FMSTtBQU1ULE9BQUssYUFOSTtBQU9ULE9BQUssY0FQSTtBQVFULE9BQUssY0FSSTtBQVNULE9BQUssZUFUSTtBQVVULE9BQUs7QUFWSSxDQUFYOztBQWFBLElBQUksUUFBUSxtQ0FBWjs7QUFFQSxPQUFPLE9BQVAsR0FBaUIsTUFBakI7O0FBRUEsT0FBTyxJQUFQLEdBQWMsSUFBZDs7QUFFQSxTQUFTLE1BQVQsQ0FBZ0IsT0FBaEIsRUFBeUI7QUFDdkIsWUFBVSxXQUFXLFlBQVc7QUFBRSxXQUFPLElBQUksS0FBSixFQUFQO0FBQW1CLEdBQXJEOztBQUVBLE9BQUssT0FBTCxHQUFlLE9BQWY7O0FBRUEsTUFBSSxJQUFJLEtBQUssTUFBTCxHQUFjO0FBQ3BCLFdBQU8sU0FEYTtBQUVwQixZQUFRLFNBRlk7QUFHcEIsY0FBVTtBQUhVLEdBQXRCOztBQU1BLE9BQUssVUFBTCxHQUFrQjtBQUNoQixVQUFNLEVBQUUsS0FEUTtBQUVoQixTQUFLLEVBQUUsTUFGUztBQUdoQixTQUFLLEVBQUUsTUFIUztBQUloQixTQUFLLEVBQUUsTUFKUztBQUtoQixTQUFLLEVBQUUsTUFMUztBQU1oQixTQUFLLEVBQUUsTUFOUztBQU9oQixTQUFLLEVBQUUsTUFQUztBQVFoQixTQUFLLEVBQUUsUUFSUztBQVNoQixTQUFLLEVBQUUsUUFUUztBQVVoQixTQUFLLEVBQUU7QUFWUyxHQUFsQjtBQVlEOztBQUVELE9BQU8sU0FBUCxDQUFpQixTQUFqQixHQUE2QixNQUFNLFNBQW5DOztBQUVBLE9BQU8sU0FBUCxDQUFpQixLQUFqQixHQUF5QixVQUFTLElBQVQsRUFBZSxNQUFmLEVBQXVCO0FBQzlDLFdBQVMsVUFBVSxDQUFuQjs7QUFFQSxNQUFJLFNBQVMsS0FBSyxNQUFsQjtBQUNBLE1BQUksS0FBSjtBQUNBLE1BQUksSUFBSjtBQUNBLE1BQUksVUFBSjs7QUFFQSxTQUFPLFFBQVEsTUFBTSxJQUFOLENBQVcsSUFBWCxDQUFmLEVBQWlDO0FBQy9CLGlCQUFhLEtBQUssVUFBTCxDQUFnQixLQUFLLE1BQU0sS0FBWCxDQUFoQixDQUFiO0FBQ0EsZUFBVyxJQUFYLENBQWdCLE1BQU0sS0FBTixHQUFjLE1BQTlCO0FBQ0Q7QUFDRixDQVpEOztBQWNBLE9BQU8sU0FBUCxDQUFpQixNQUFqQixHQUEwQixVQUFTLEtBQVQsRUFBZ0IsSUFBaEIsRUFBc0IsS0FBdEIsRUFBNkI7QUFDckQsTUFBSSxTQUFTLElBQUksTUFBSixDQUFXLEtBQVgsQ0FBYjtBQUNBLFNBQU8sS0FBUCxDQUFhLElBQWIsRUFBbUIsTUFBTSxDQUFOLENBQW5COztBQUVBLE1BQUksVUFBVSxFQUFkO0FBQ0EsT0FBSyxJQUFJLElBQVQsSUFBaUIsS0FBSyxNQUF0QixFQUE4QjtBQUM1QixZQUFRLElBQVIsSUFBZ0IsS0FBSyxNQUFMLENBQVksSUFBWixFQUFrQixNQUFsQztBQUNEOztBQUVELE9BQUssSUFBSSxJQUFULElBQWlCLEtBQUssTUFBdEIsRUFBOEI7QUFDNUIsU0FBSyxNQUFMLENBQVksSUFBWixFQUFrQixXQUFsQixDQUE4QixNQUFNLENBQU4sQ0FBOUIsRUFBd0MsS0FBeEM7QUFDQSxTQUFLLE1BQUwsQ0FBWSxJQUFaLEVBQWtCLFdBQWxCLENBQThCLEtBQTlCO0FBQ0EsU0FBSyxNQUFMLENBQVksSUFBWixFQUFrQixNQUFsQixDQUF5QixNQUFNLENBQU4sQ0FBekIsRUFBbUMsT0FBTyxNQUFQLENBQWMsSUFBZCxDQUFuQztBQUNEOztBQUVELE9BQUssSUFBSSxJQUFULElBQWlCLEtBQUssTUFBdEIsRUFBOEI7QUFDNUIsUUFBSSxLQUFLLE1BQUwsQ0FBWSxJQUFaLEVBQWtCLE1BQWxCLEtBQTZCLFFBQVEsSUFBUixDQUFqQyxFQUFnRDtBQUM5QyxXQUFLLElBQUwsYUFBb0IsSUFBcEI7QUFDRDtBQUNGO0FBQ0YsQ0FwQkQ7O0FBc0JBLE9BQU8sU0FBUCxDQUFpQixVQUFqQixHQUE4QixVQUFTLElBQVQsRUFBZSxLQUFmLEVBQXNCO0FBQ2xELFNBQU8sS0FBSyxNQUFMLENBQVksSUFBWixFQUFrQixHQUFsQixDQUFzQixLQUF0QixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxPQUFPLFNBQVAsQ0FBaUIsYUFBakIsR0FBaUMsVUFBUyxJQUFULEVBQWU7QUFDOUMsU0FBTyxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQVA7QUFDRCxDQUZEOztBQUlBLE9BQU8sU0FBUCxDQUFpQixXQUFqQixHQUErQixVQUFTLElBQVQsRUFBZSxNQUFmLEVBQXVCO0FBQ3BELFNBQU8sS0FBSyxNQUFMLENBQVksSUFBWixFQUFrQixJQUFsQixDQUF1QixNQUF2QixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxPQUFPLFNBQVAsQ0FBaUIsSUFBakIsR0FBd0IsWUFBVztBQUNqQyxNQUFJLFNBQVMsSUFBSSxNQUFKLENBQVcsS0FBSyxPQUFoQixDQUFiO0FBQ0EsTUFBSSxJQUFJLE9BQU8sTUFBZjtBQUNBLE9BQUssSUFBSSxHQUFULElBQWdCLEtBQUssTUFBckIsRUFBNkI7QUFDM0IsTUFBRSxHQUFGLElBQVMsS0FBSyxNQUFMLENBQVksR0FBWixFQUFpQixLQUFqQixFQUFUO0FBQ0Q7QUFDRCxTQUFPLFVBQVAsR0FBb0I7QUFDbEIsVUFBTSxFQUFFLEtBRFU7QUFFbEIsU0FBSyxFQUFFLE1BRlc7QUFHbEIsU0FBSyxFQUFFLE1BSFc7QUFJbEIsU0FBSyxFQUFFLE1BSlc7QUFLbEIsU0FBSyxFQUFFLE1BTFc7QUFNbEIsU0FBSyxFQUFFLE1BTlc7QUFPbEIsU0FBSyxFQUFFLE1BUFc7QUFRbEIsU0FBSyxFQUFFLFFBUlc7QUFTbEIsU0FBSyxFQUFFLFFBVFc7QUFVbEIsU0FBSyxFQUFFO0FBVlcsR0FBcEI7QUFZQSxTQUFPLE1BQVA7QUFDRCxDQW5CRDs7Ozs7QUNqR0EsSUFBSSxPQUFPLFFBQVEsYUFBUixDQUFYO0FBQ0EsSUFBSSxPQUFPLFFBQVEsYUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsY0FBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsVUFBUixDQUFiOztBQUVBLE9BQU8sT0FBUCxHQUFpQixJQUFqQjs7QUFFQSxTQUFTLElBQVQsQ0FBYyxNQUFkLEVBQXNCO0FBQ3BCLFFBQU0sSUFBTixDQUFXLElBQVg7O0FBRUEsT0FBSyxJQUFMLEdBQVksRUFBWjtBQUNBLE9BQUssSUFBTCxHQUFZLFVBQVo7QUFDQSxPQUFLLE1BQUwsR0FBYyxJQUFJLE1BQUosRUFBZDtBQUNBLE9BQUssU0FBTDtBQUNEOztBQUVELEtBQUssU0FBTCxDQUFlLFNBQWYsR0FBMkIsTUFBTSxTQUFqQzs7QUFFQSxLQUFLLFNBQUwsQ0FBZSxTQUFmLEdBQTJCLFlBQVc7QUFDcEMsT0FBSyxNQUFMLENBQVksRUFBWixDQUFlLEtBQWYsRUFBc0IsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsS0FBckIsQ0FBdEI7QUFDQSxPQUFLLE1BQUwsQ0FBWSxFQUFaLENBQWUsS0FBZixFQUFzQixLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixFQUFxQixLQUFyQixDQUF0QjtBQUNBLE9BQUssTUFBTCxDQUFZLEVBQVosQ0FBZSxRQUFmLEVBQXlCLEtBQUssSUFBTCxDQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLFFBQXJCLENBQXpCO0FBQ0EsT0FBSyxNQUFMLENBQVksRUFBWixDQUFlLGVBQWYsRUFBZ0MsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsZUFBckIsQ0FBaEM7QUFDRCxDQUxEOztBQU9BLEtBQUssU0FBTCxDQUFlLElBQWYsR0FBc0IsVUFBUyxJQUFULEVBQWUsSUFBZixFQUFxQixFQUFyQixFQUF5QjtBQUFBOztBQUM3QyxPQUFLLElBQUwsR0FBWSxJQUFaO0FBQ0EsT0FBSyxJQUFMLEdBQVksSUFBWjtBQUNBLE9BQUssT0FBTyxJQUFaLEVBQWtCLFVBQUMsR0FBRCxFQUFNLElBQU4sRUFBZTtBQUMvQixRQUFJLEdBQUosRUFBUztBQUNQLFlBQUssSUFBTCxDQUFVLE9BQVYsRUFBbUIsR0FBbkI7QUFDQSxZQUFNLEdBQUcsR0FBSCxDQUFOO0FBQ0E7QUFDRDtBQUNELFVBQUssTUFBTCxDQUFZLE9BQVosQ0FBb0IsSUFBcEI7QUFDQSxVQUFLLElBQUwsQ0FBVSxNQUFWO0FBQ0EsVUFBTSxHQUFHLElBQUgsUUFBTjtBQUNELEdBVEQ7QUFVRCxDQWJEOztBQWVBLEtBQUssU0FBTCxDQUFlLElBQWYsR0FBc0IsVUFBUyxFQUFULEVBQWE7QUFDakMsT0FBSyxLQUFLLElBQUwsR0FBWSxLQUFLLElBQXRCLEVBQTRCLEtBQUssTUFBTCxDQUFZLFFBQVosRUFBNUIsRUFBb0QsTUFBTSxJQUExRDtBQUNELENBRkQ7O0FBSUEsS0FBSyxTQUFMLENBQWUsR0FBZixHQUFxQixVQUFTLElBQVQsRUFBZTtBQUNsQyxPQUFLLE1BQUwsQ0FBWSxPQUFaLENBQW9CLElBQXBCO0FBQ0QsQ0FGRDs7QUFJQSxTQUFTLElBQVQsR0FBZ0IsQ0FBQyxVQUFXOzs7OztBQ2hENUIsSUFBSSxRQUFRLFFBQVEsY0FBUixDQUFaO0FBQ0EsSUFBSSxXQUFXLFFBQVEsaUJBQVIsQ0FBZjs7QUFFQTs7Ozs7OztBQU9BLE9BQU8sT0FBUCxHQUFpQixPQUFqQjs7QUFFQSxTQUFTLE9BQVQsQ0FBaUIsTUFBakIsRUFBeUI7QUFDdkIsT0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNBLE9BQUssR0FBTCxHQUFXLEVBQVg7QUFDQSxPQUFLLE1BQUwsR0FBYyxDQUFkO0FBQ0EsT0FBSyxPQUFMLEdBQWUsSUFBZjtBQUNBLE9BQUssU0FBTCxHQUFpQixDQUFqQjtBQUNBLE9BQUssYUFBTCxHQUFxQixTQUFTLEtBQUssWUFBTCxDQUFrQixJQUFsQixDQUF1QixJQUF2QixDQUFULEVBQXVDLEdBQXZDLENBQXJCO0FBQ0Q7O0FBRUQsUUFBUSxTQUFSLENBQWtCLFNBQWxCLEdBQThCLE1BQU0sU0FBcEM7O0FBRUEsUUFBUSxTQUFSLENBQWtCLElBQWxCLEdBQXlCLFVBQVMsS0FBVCxFQUFnQjtBQUN2QyxNQUFJLEtBQUssR0FBTCxLQUFhLEtBQUssU0FBbEIsR0FBOEIsSUFBOUIsSUFBc0MsS0FBMUMsRUFBaUQsS0FBSyxZQUFMO0FBQ2pELE9BQUssT0FBTCxHQUFlLEtBQUssYUFBTCxFQUFmO0FBQ0QsQ0FIRDs7QUFLQSxRQUFRLFNBQVIsQ0FBa0IsWUFBbEIsR0FBaUMsWUFBVztBQUMxQyxlQUFhLEtBQUssT0FBbEI7QUFDQSxNQUFJLEtBQUssTUFBTCxDQUFZLE1BQVosQ0FBbUIsR0FBbkIsQ0FBdUIsTUFBM0IsRUFBbUM7QUFDakMsU0FBSyxHQUFMLEdBQVcsS0FBSyxHQUFMLENBQVMsS0FBVCxDQUFlLENBQWYsRUFBa0IsRUFBRSxLQUFLLE1BQXpCLENBQVg7QUFDQSxTQUFLLEdBQUwsQ0FBUyxJQUFULENBQWMsS0FBSyxNQUFMLEVBQWQ7QUFDQSxTQUFLLE1BQUwsR0FBYyxLQUFLLEdBQUwsQ0FBUyxNQUF2QjtBQUNBLFNBQUssUUFBTDtBQUNELEdBTEQsTUFLTztBQUNMLFNBQUssUUFBTDtBQUNEO0FBQ0QsT0FBSyxTQUFMLEdBQWlCLEtBQUssR0FBTCxFQUFqQjtBQUNBLE9BQUssT0FBTCxHQUFlLEtBQWY7QUFDRCxDQVpEOztBQWNBLFFBQVEsU0FBUixDQUFrQixJQUFsQixHQUF5QixZQUFXO0FBQ2xDLE1BQUksS0FBSyxPQUFMLEtBQWlCLEtBQXJCLEVBQTRCLEtBQUssWUFBTDs7QUFFNUIsTUFBSSxLQUFLLE1BQUwsR0FBYyxLQUFLLEdBQUwsQ0FBUyxNQUFULEdBQWtCLENBQXBDLEVBQXVDLEtBQUssTUFBTCxHQUFjLEtBQUssR0FBTCxDQUFTLE1BQVQsR0FBa0IsQ0FBaEM7QUFDdkMsTUFBSSxLQUFLLE1BQUwsR0FBYyxDQUFsQixFQUFxQjs7QUFFckIsT0FBSyxRQUFMLENBQWMsTUFBZCxFQUFzQixLQUFLLE1BQUwsRUFBdEI7QUFDRCxDQVBEOztBQVNBLFFBQVEsU0FBUixDQUFrQixJQUFsQixHQUF5QixZQUFXO0FBQ2xDLE1BQUksS0FBSyxPQUFMLEtBQWlCLEtBQXJCLEVBQTRCLEtBQUssWUFBTDs7QUFFNUIsTUFBSSxLQUFLLE1BQUwsS0FBZ0IsS0FBSyxHQUFMLENBQVMsTUFBVCxHQUFrQixDQUF0QyxFQUF5Qzs7QUFFekMsT0FBSyxRQUFMLENBQWMsTUFBZCxFQUFzQixFQUFFLEtBQUssTUFBN0I7QUFDRCxDQU5EOztBQVFBLFFBQVEsU0FBUixDQUFrQixRQUFsQixHQUE2QixVQUFTLElBQVQsRUFBZSxDQUFmLEVBQWtCO0FBQUE7O0FBQzdDLE1BQUksU0FBUyxLQUFLLEdBQUwsQ0FBUyxDQUFULENBQWI7QUFDQSxNQUFJLENBQUMsTUFBTCxFQUFhOztBQUViLE1BQUksTUFBTSxPQUFPLEdBQWpCOztBQUVBLFdBQVMsS0FBSyxHQUFMLENBQVMsQ0FBVCxFQUFZLElBQVosQ0FBVDtBQUNBLE9BQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBakIsR0FBMEIsT0FBTyxVQUFqQztBQUNBLE9BQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsR0FBakIsQ0FBcUIsT0FBTyxJQUFQLENBQVksSUFBWixFQUFyQjtBQUNBLE9BQUssTUFBTCxDQUFZLFFBQVosQ0FBcUIsT0FBTyxLQUFQLENBQWEsSUFBYixFQUFyQjs7QUFFQSxRQUFNLFdBQVcsSUFBWCxHQUNGLElBQUksS0FBSixHQUFZLE9BQVosRUFERSxHQUVGLElBQUksS0FBSixFQUZKOztBQUlBLE1BQUksT0FBSixDQUFZLGdCQUFRO0FBQ2xCLFFBQUksU0FBUyxLQUFLLENBQUwsQ0FBYjtBQUNBLFFBQUksY0FBYyxLQUFLLENBQUwsQ0FBbEI7QUFDQSxRQUFJLE9BQU8sS0FBSyxDQUFMLENBQVg7QUFDQSxZQUFRLE1BQVI7QUFDRSxXQUFLLFFBQUw7QUFDRSxZQUFJLFdBQVcsSUFBZixFQUFxQjtBQUNuQixnQkFBSyxNQUFMLENBQVksTUFBWixDQUFtQixpQkFBbkIsQ0FBcUMsV0FBckMsRUFBa0QsSUFBbEQ7QUFDRCxTQUZELE1BRU87QUFDTCxnQkFBSyxNQUFMLENBQVksTUFBWixDQUFtQixNQUFuQixDQUEwQixNQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLGNBQW5CLENBQWtDLFlBQVksQ0FBWixDQUFsQyxDQUExQixFQUE2RSxJQUE3RSxFQUFtRixJQUFuRjtBQUNEO0FBQ0Q7QUFDRixXQUFLLFFBQUw7QUFDRSxZQUFJLFdBQVcsSUFBZixFQUFxQjtBQUNuQixnQkFBSyxNQUFMLENBQVksTUFBWixDQUFtQixNQUFuQixDQUEwQixNQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLGNBQW5CLENBQWtDLFlBQVksQ0FBWixDQUFsQyxDQUExQixFQUE2RSxJQUE3RSxFQUFtRixJQUFuRjtBQUNELFNBRkQsTUFFTztBQUNMLGdCQUFLLE1BQUwsQ0FBWSxNQUFaLENBQW1CLGlCQUFuQixDQUFxQyxXQUFyQyxFQUFrRCxJQUFsRDtBQUNEO0FBQ0Q7QUFkSjtBQWdCRCxHQXBCRDs7QUFzQkEsT0FBSyxJQUFMLENBQVUsUUFBVjtBQUNELENBdENEOztBQXdDQSxRQUFRLFNBQVIsQ0FBa0IsTUFBbEIsR0FBMkIsWUFBVztBQUNwQyxNQUFJLE1BQU0sS0FBSyxNQUFMLENBQVksTUFBWixDQUFtQixHQUE3QjtBQUNBLE9BQUssTUFBTCxDQUFZLE1BQVosQ0FBbUIsR0FBbkIsR0FBeUIsRUFBekI7QUFDQSxTQUFPO0FBQ0wsU0FBSyxHQURBO0FBRUwsVUFBTSxLQUFLLElBRk47QUFHTCxVQUFNO0FBQ0osYUFBTyxLQUFLLE1BQUwsQ0FBWSxLQUFaLENBQWtCLElBQWxCLEVBREg7QUFFSixZQUFNLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsSUFBakIsRUFGRjtBQUdKLGtCQUFZLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUI7QUFIekI7QUFIRCxHQUFQO0FBU0QsQ0FaRDs7QUFjQSxRQUFRLFNBQVIsQ0FBa0IsUUFBbEIsR0FBNkIsWUFBVztBQUN0QyxPQUFLLElBQUwsR0FBWTtBQUNWLFdBQU8sS0FBSyxNQUFMLENBQVksS0FBWixDQUFrQixJQUFsQixFQURHO0FBRVYsVUFBTSxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLElBQWpCLEVBRkk7QUFHVixnQkFBWSxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCO0FBSG5CLEdBQVo7QUFLRCxDQU5EOzs7OztBQ2pIQSxJQUFJLFdBQVcsUUFBUSxvQkFBUixDQUFmOztBQUVBLElBQUksa0JBQWtCLEVBQXRCOztBQUVBLElBQUksT0FBTyxPQUFPLE9BQVAsR0FBaUI7QUFDMUIsWUFBVSxpQkFBVztBQUNuQixTQUFLLE9BQUwsQ0FBYSxJQUFiO0FBQ0QsR0FIeUI7QUFJMUIsWUFBVSxpQkFBVztBQUNuQixTQUFLLE9BQUwsQ0FBYSxJQUFiO0FBQ0QsR0FOeUI7O0FBUTFCLFVBQVEsZ0JBQVc7QUFDakIsU0FBSyxJQUFMLENBQVUsV0FBVjtBQUNELEdBVnlCO0FBVzFCLFNBQU8sZUFBVztBQUNoQixTQUFLLElBQUwsQ0FBVSxTQUFWO0FBQ0QsR0FieUI7QUFjMUIsWUFBVSxTQUFTLFlBQVc7QUFDNUIsU0FBSyxJQUFMLENBQVUsTUFBVjtBQUNELEdBRlMsRUFFUCxlQUZPLENBZGdCO0FBaUIxQixjQUFZLFNBQVMsWUFBVztBQUM5QixTQUFLLElBQUwsQ0FBVSxRQUFWO0FBQ0QsR0FGVyxFQUVULGVBRlMsQ0FqQmM7QUFvQjFCLGFBQVcsU0FBUyxZQUFXO0FBQzdCLFNBQUssSUFBTCxDQUFVLE1BQVYsQ0FBaUIsQ0FBakI7QUFDRCxHQUZVLEVBRVIsZUFGUSxDQXBCZTtBQXVCMUIsZUFBYSxTQUFTLFlBQVc7QUFDL0IsU0FBSyxJQUFMLENBQVUsUUFBVixDQUFtQixDQUFuQjtBQUNELEdBRlksRUFFVixlQUZVLENBdkJhO0FBMEIxQixVQUFRLGdCQUFXO0FBQ2pCLFNBQUssSUFBTCxDQUFVLE9BQVYsQ0FBa0IsQ0FBQyxDQUFuQjtBQUNELEdBNUJ5QjtBQTZCMUIsUUFBTSxjQUFXO0FBQ2YsU0FBSyxJQUFMLENBQVUsT0FBVixDQUFrQixDQUFDLENBQW5CO0FBQ0QsR0EvQnlCO0FBZ0MxQixXQUFTLGlCQUFXO0FBQ2xCLFNBQUssSUFBTCxDQUFVLE9BQVYsQ0FBa0IsQ0FBQyxDQUFuQjtBQUNELEdBbEN5QjtBQW1DMUIsVUFBUSxnQkFBVztBQUNqQixTQUFLLElBQUwsQ0FBVSxPQUFWLENBQWtCLENBQUMsQ0FBbkI7QUFDRCxHQXJDeUI7O0FBdUMxQixlQUFhLG9CQUFXO0FBQ3RCLFNBQUssSUFBTCxDQUFVLE1BQVYsQ0FBaUIsQ0FBQyxDQUFsQjtBQUNELEdBekN5QjtBQTBDMUIsZ0JBQWMscUJBQVc7QUFDdkIsU0FBSyxJQUFMLENBQVUsTUFBVixDQUFpQixDQUFDLENBQWxCO0FBQ0QsR0E1Q3lCOztBQThDMUIsWUFBVSxpQkFBVztBQUNuQixTQUFLLFNBQUwsQ0FBZSxJQUFmO0FBQ0EsU0FBSyxJQUFMLENBQVUsV0FBVixDQUFzQixJQUF0QixFQUE0QixJQUE1QjtBQUNBLFNBQUssU0FBTDtBQUNBLFNBQUssSUFBTCxDQUFVLFNBQVYsQ0FBb0IsSUFBcEIsRUFBMEIsSUFBMUI7QUFDQSxTQUFLLE9BQUw7QUFDRCxHQXBEeUI7O0FBc0QxQixXQUFTLGlCQUFXO0FBQ2xCLFNBQUssTUFBTCxDQUFZLElBQVo7QUFDRCxHQXhEeUI7O0FBMEQxQixlQUFhLHFCQUFXO0FBQ3RCLFNBQUssU0FBTDtBQUNELEdBNUR5QjtBQTZEMUIsWUFBVSxtQkFBVztBQUNuQixTQUFLLE1BQUw7QUFDRCxHQS9EeUI7QUFnRTFCLG9CQUFrQix5QkFBVztBQUMzQixRQUFJLEtBQUssSUFBTCxDQUFVLGFBQVYsRUFBSixFQUErQjtBQUMvQixTQUFLLFNBQUwsQ0FBZSxJQUFmO0FBQ0EsU0FBSyxTQUFMO0FBQ0EsU0FBSyxJQUFMLENBQVUsTUFBVixDQUFpQixDQUFDLENBQWxCLEVBQXFCLElBQXJCO0FBQ0EsU0FBSyxPQUFMO0FBQ0EsU0FBSyxNQUFMO0FBQ0QsR0F2RXlCO0FBd0UxQiwwQkFBd0IsOEJBQVc7QUFDakMsU0FBSyxTQUFMLENBQWUsSUFBZjtBQUNBLFNBQUssU0FBTDtBQUNBLFNBQUssSUFBTCxDQUFVLFdBQVYsQ0FBc0IsSUFBdEIsRUFBNEIsSUFBNUI7QUFDQSxTQUFLLE9BQUw7QUFDQSxTQUFLLE1BQUw7QUFDRCxHQTlFeUI7QUErRTFCLGlCQUFlLHNCQUFXO0FBQ3hCLFFBQUksS0FBSyxJQUFMLENBQVUsV0FBVixFQUFKLEVBQTZCO0FBQzdCLFNBQUssU0FBTCxDQUFlLElBQWY7QUFDQSxTQUFLLFNBQUw7QUFDQSxTQUFLLElBQUwsQ0FBVSxNQUFWLENBQWlCLENBQUMsQ0FBbEIsRUFBcUIsSUFBckI7QUFDQSxTQUFLLE9BQUw7QUFDQSxTQUFLLFNBQUw7QUFDRCxHQXRGeUI7QUF1RjFCLHVCQUFxQiwyQkFBVztBQUM5QixTQUFLLFNBQUwsQ0FBZSxJQUFmO0FBQ0EsU0FBSyxTQUFMO0FBQ0EsU0FBSyxJQUFMLENBQVUsU0FBVixDQUFvQixJQUFwQixFQUEwQixJQUExQjtBQUNBLFNBQUssT0FBTDtBQUNBLFNBQUssU0FBTDtBQUNELEdBN0Z5QjtBQThGMUIsa0JBQWdCLHVCQUFXO0FBQ3pCLFNBQUssU0FBTCxDQUFlLElBQWY7QUFDQSxTQUFLLElBQUwsQ0FBVSxXQUFWLENBQXNCLElBQXRCLEVBQTRCLElBQTVCO0FBQ0EsU0FBSyxTQUFMO0FBQ0EsU0FBSyxJQUFMLENBQVUsU0FBVixDQUFvQixJQUFwQixFQUEwQixJQUExQjtBQUNBLFNBQUssSUFBTCxDQUFVLE9BQVYsQ0FBa0IsQ0FBQyxDQUFuQixFQUFzQixJQUF0QjtBQUNBLFNBQUssT0FBTDtBQUNBLFNBQUssU0FBTDtBQUNELEdBdEd5Qjs7QUF3RzFCLGtCQUFnQixzQkFBVztBQUN6QixTQUFLLFNBQUwsQ0FBZSxLQUFmO0FBQ0EsUUFBSSxNQUFNLENBQVY7QUFDQSxRQUFJLE9BQU8sS0FBSyxJQUFMLENBQVUsR0FBVixFQUFYO0FBQ0EsUUFBSSxRQUFRLEtBQUssR0FBTCxDQUFTLENBQVQsR0FBYSxLQUFLLEtBQUwsQ0FBVyxDQUFwQztBQUNBLFFBQUksU0FBUyxLQUFLLEdBQUwsQ0FBUyxDQUFULEdBQWEsQ0FBMUIsRUFBNkIsT0FBTyxDQUFQO0FBQzdCLFFBQUksQ0FBQyxLQUFMLEVBQVksT0FBTyxDQUFQO0FBQ1osYUFBUyxHQUFUO0FBQ0EsUUFBSSxPQUFPLEtBQUssTUFBTCxDQUFZLFdBQVosQ0FBd0IsS0FBSyxPQUFMLENBQWEsQ0FBYixFQUFnQixTQUFoQixDQUEwQixHQUExQixDQUF4QixDQUFYO0FBQ0EsU0FBSyxNQUFMLENBQVksTUFBWixDQUFtQixFQUFFLEdBQUcsQ0FBTCxFQUFRLEdBQUcsS0FBSyxHQUFMLENBQVMsQ0FBcEIsRUFBbkIsRUFBNEMsSUFBNUM7QUFDQSxTQUFLLElBQUwsQ0FBVSxZQUFWLENBQXVCLEtBQXZCO0FBQ0EsU0FBSyxJQUFMLENBQVUsT0FBVixDQUFrQixLQUFsQixFQUF5QixJQUF6QjtBQUNELEdBcEh5Qjs7QUFzSDFCLG1CQUFpQix1QkFBVztBQUMxQixTQUFLLElBQUwsQ0FBVSxPQUFWLEVBQW1CLFFBQW5CLEVBQTZCLEtBQUssS0FBTCxDQUFXLElBQVgsRUFBN0IsRUFBZ0QsS0FBSyxJQUFMLENBQVUsSUFBVixFQUFoRCxFQUFrRSxLQUFLLElBQUwsQ0FBVSxNQUE1RTtBQUNBLFNBQUssU0FBTCxDQUFlLEtBQWY7QUFDQSxRQUFJLE9BQU8sS0FBSyxJQUFMLENBQVUsR0FBVixFQUFYO0FBQ0EsUUFBSSxLQUFLLEdBQUwsQ0FBUyxDQUFULEtBQWUsQ0FBbkIsRUFBc0I7QUFDcEIsV0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLEtBQUssR0FBTCxDQUFTLENBQVQsR0FBYSxDQUExQjtBQUNBLFdBQUssR0FBTCxDQUFTLENBQVQsR0FBYSxLQUFLLE1BQUwsQ0FBWSxPQUFaLENBQW9CLEtBQUssR0FBTCxDQUFTLENBQTdCLEVBQWdDLE1BQTdDO0FBQ0Q7QUFDRCxRQUFJLEtBQUssTUFBTCxDQUFZLGVBQVosQ0FBNEIsQ0FBQyxDQUE3QixFQUFnQyxJQUFoQyxDQUFKLEVBQTJDO0FBQ3pDLFdBQUssSUFBTCxDQUFVLFlBQVYsQ0FBdUIsQ0FBQyxDQUF4QjtBQUNBLFdBQUssSUFBTCxDQUFVLE9BQVYsQ0FBa0IsQ0FBQyxDQUFuQixFQUFzQixJQUF0QjtBQUNEO0FBQ0YsR0FsSXlCOztBQW9JMUIscUJBQW1CLHlCQUFXO0FBQzVCLFNBQUssSUFBTCxDQUFVLE9BQVYsRUFBbUIsUUFBbkIsRUFBNkIsS0FBSyxLQUFMLENBQVcsSUFBWCxFQUE3QixFQUFnRCxLQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWhELEVBQWtFLEtBQUssSUFBTCxDQUFVLE1BQTVFO0FBQ0EsU0FBSyxTQUFMLENBQWUsS0FBZjtBQUNBLFFBQUksT0FBTyxLQUFLLElBQUwsQ0FBVSxHQUFWLEVBQVg7QUFDQSxRQUFJLEtBQUssR0FBTCxDQUFTLENBQVQsS0FBZSxDQUFuQixFQUFzQjtBQUNwQixXQUFLLEdBQUwsQ0FBUyxDQUFULEdBQWEsS0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLENBQTFCO0FBQ0EsV0FBSyxHQUFMLENBQVMsQ0FBVCxHQUFhLEtBQUssTUFBTCxDQUFZLE9BQVosQ0FBb0IsS0FBSyxHQUFMLENBQVMsQ0FBN0IsRUFBZ0MsTUFBN0M7QUFDRDtBQUNELFFBQUksS0FBSyxNQUFMLENBQVksZUFBWixDQUE0QixDQUFDLENBQTdCLEVBQWdDLElBQWhDLENBQUosRUFBMkM7QUFDekMsV0FBSyxJQUFMLENBQVUsWUFBVixDQUF1QixDQUFDLENBQXhCO0FBQ0EsV0FBSyxJQUFMLENBQVUsT0FBVixDQUFrQixDQUFDLENBQW5CLEVBQXNCLElBQXRCO0FBQ0Q7QUFDRixHQWhKeUI7O0FBa0oxQixTQUFPLGVBQVc7QUFDaEIsUUFBSSxNQUFNLEtBQUssT0FBTCxFQUFWO0FBQ0EsUUFBSSxDQUFDLEdBQUwsRUFBVTtBQUNSLFdBQUssTUFBTCxDQUFZLEtBQUssR0FBakI7QUFDRCxLQUZELE1BRU87QUFDTCxXQUFLLFdBQUwsQ0FBaUIsSUFBSSxJQUFyQjtBQUNBLFdBQUssTUFBTCxDQUFZLElBQUksSUFBSixDQUFTLEtBQXJCO0FBQ0Q7QUFDRixHQTFKeUI7O0FBNEoxQixZQUFVLGlCQUFXO0FBQ25CLFNBQUssSUFBTCxDQUFVLElBQVY7QUFDRCxHQTlKeUI7O0FBZ0sxQixRQUFNLGNBQVc7QUFDZixTQUFLLFFBQUwsQ0FBYyxDQUFDLENBQWY7QUFDRCxHQWxLeUI7QUFtSzFCLGNBQVksbUJBQVc7QUFDckIsU0FBSyxRQUFMLENBQWMsQ0FBQyxDQUFmO0FBQ0QsR0FyS3lCOztBQXVLMUIsWUFBVSxnQkFBVztBQUNuQixRQUFJLEdBQUo7QUFDQSxRQUFJLElBQUo7QUFDQSxRQUFJLElBQUo7O0FBRUEsUUFBSSxRQUFRLEtBQVo7QUFDQSxRQUFJLFFBQVEsS0FBSyxLQUFMLENBQVcsSUFBWCxFQUFaOztBQUVBLFFBQUksQ0FBQyxLQUFLLElBQUwsQ0FBVSxNQUFmLEVBQXVCO0FBQ3JCLGNBQVEsSUFBUjtBQUNBLFdBQUssU0FBTDtBQUNBLFdBQUssSUFBTCxDQUFVLFdBQVYsQ0FBc0IsSUFBdEIsRUFBNEIsSUFBNUI7QUFDQSxXQUFLLFNBQUw7QUFDQSxXQUFLLElBQUwsQ0FBVSxTQUFWLENBQW9CLElBQXBCLEVBQTBCLElBQTFCO0FBQ0EsV0FBSyxPQUFMO0FBQ0EsYUFBTyxLQUFLLElBQUwsQ0FBVSxHQUFWLEVBQVA7QUFDQSxhQUFPLEtBQUssTUFBTCxDQUFZLFdBQVosQ0FBd0IsSUFBeEIsQ0FBUDtBQUNELEtBVEQsTUFTTztBQUNMLGFBQU8sS0FBSyxJQUFMLENBQVUsR0FBVixFQUFQO0FBQ0EsV0FBSyxJQUFMLENBQVUsU0FBVixDQUFvQixLQUFLLEdBQUwsQ0FBUyxDQUFULEdBQWEsQ0FBakMsRUFBb0MsT0FBcEMsQ0FBNEMsQ0FBNUM7QUFDQSxhQUFPLEtBQUssTUFBTCxDQUFZLFdBQVosQ0FBd0IsS0FBSyxJQUFMLENBQVUsR0FBVixFQUF4QixDQUFQO0FBQ0Q7O0FBRUQ7QUFDQSxRQUFJLEtBQUssUUFBTCxHQUFnQixNQUFoQixDQUF1QixDQUF2QixFQUF5QixDQUF6QixNQUFnQyxJQUFwQyxFQUEwQztBQUN4QyxZQUFNLENBQUMsQ0FBUDtBQUNBLGFBQU8sS0FBSyxPQUFMLENBQWEsbUJBQWIsRUFBa0MsTUFBbEMsQ0FBUDtBQUNELEtBSEQsTUFHTztBQUNMLFlBQU0sQ0FBQyxDQUFQO0FBQ0EsYUFBTyxLQUFLLE9BQUwsQ0FBYSxnQkFBYixFQUErQixTQUEvQixDQUFQO0FBQ0Q7O0FBRUQsU0FBSyxNQUFMLENBQVksSUFBWjs7QUFFQSxTQUFLLElBQUwsQ0FBVSxHQUFWLENBQWMsS0FBSyxRQUFMLENBQWMsR0FBZCxDQUFkO0FBQ0EsU0FBSyxJQUFMLENBQVUsTUFBVixHQUFtQixDQUFDLEtBQXBCOztBQUVBLFFBQUksTUFBTSxDQUFWLEVBQWEsTUFBTSxRQUFOLENBQWUsR0FBZjtBQUNiLFNBQUssUUFBTCxDQUFjLEtBQWQ7O0FBRUEsUUFBSSxLQUFKLEVBQVc7QUFDVCxXQUFLLFNBQUw7QUFDRDtBQUNGLEdBbE55Qjs7QUFvTjFCLGtCQUFnQixxQkFBVztBQUN6QixRQUFJLFFBQVEsS0FBWjtBQUNBLFFBQUksTUFBTSxDQUFWO0FBQ0EsUUFBSSxDQUFDLEtBQUssSUFBTCxDQUFVLE1BQWYsRUFBdUIsUUFBUSxJQUFSO0FBQ3ZCLFFBQUksUUFBUSxLQUFLLEtBQUwsQ0FBVyxJQUFYLEVBQVo7QUFDQSxTQUFLLFNBQUwsQ0FBZSxLQUFmO0FBQ0EsUUFBSSxPQUFPLEtBQUssSUFBTCxDQUFVLEdBQVYsRUFBWDtBQUNBLFFBQUksT0FBTyxLQUFLLE1BQUwsQ0FBWSxXQUFaLENBQXdCLElBQXhCLENBQVg7QUFDQSxRQUFJLEtBQUssS0FBTCxDQUFXLENBQVgsRUFBYSxDQUFiLE1BQW9CLElBQXBCLElBQTRCLEtBQUssS0FBTCxDQUFXLENBQUMsQ0FBWixNQUFtQixJQUFuRCxFQUF5RDtBQUN2RCxhQUFPLEtBQUssS0FBTCxDQUFXLENBQVgsRUFBYSxDQUFDLENBQWQsQ0FBUDtBQUNBLGFBQU8sQ0FBUDtBQUNBLFVBQUksS0FBSyxHQUFMLENBQVMsQ0FBVCxLQUFlLEtBQUssS0FBTCxDQUFXLENBQTlCLEVBQWlDLE9BQU8sQ0FBUDtBQUNsQyxLQUpELE1BSU87QUFDTCxhQUFPLE9BQU8sSUFBUCxHQUFjLElBQXJCO0FBQ0EsYUFBTyxDQUFQO0FBQ0EsVUFBSSxLQUFLLEdBQUwsQ0FBUyxDQUFULEtBQWUsS0FBSyxLQUFMLENBQVcsQ0FBOUIsRUFBaUMsT0FBTyxDQUFQO0FBQ2xDO0FBQ0QsU0FBSyxNQUFMLENBQVksSUFBWjtBQUNBLFNBQUssR0FBTCxDQUFTLENBQVQsSUFBYyxHQUFkO0FBQ0EsU0FBSyxJQUFMLENBQVUsR0FBVixDQUFjLElBQWQ7QUFDQSxTQUFLLElBQUwsQ0FBVSxNQUFWLEdBQW1CLENBQUMsS0FBcEI7QUFDQSxTQUFLLFFBQUwsQ0FBYyxNQUFNLFFBQU4sQ0FBZSxHQUFmLENBQWQ7QUFDQSxRQUFJLEtBQUosRUFBVztBQUNULFdBQUssU0FBTDtBQUNEO0FBQ0Y7QUE3T3lCLENBQTVCOztBQWdQQSxLQUFLLE1BQUwsR0FBYztBQUNaO0FBRFksQ0FBZDs7QUFJQTtBQUNBLENBQUUsTUFBRixFQUFTLEtBQVQsRUFDRSxRQURGLEVBQ1csVUFEWCxFQUVFLE1BRkYsRUFFUyxJQUZULEVBRWMsT0FGZCxFQUVzQixNQUZ0QixFQUdFLFdBSEYsRUFHYyxZQUhkLEVBSUUsT0FKRixDQUlVLFVBQVMsR0FBVCxFQUFjO0FBQ3RCLE9BQUssV0FBUyxHQUFkLElBQXFCLFVBQVMsQ0FBVCxFQUFZO0FBQy9CLFNBQUssU0FBTDtBQUNBLFNBQUssR0FBTCxFQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLENBQXJCO0FBQ0EsU0FBSyxPQUFMO0FBQ0QsR0FKRDtBQUtELENBVkQ7Ozs7O0FDelBBLElBQUksUUFBUSxRQUFRLGlCQUFSLENBQVo7QUFDQSxJQUFJLFFBQVEsUUFBUSxTQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxRQUFSLENBQVg7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLEtBQWpCOztBQUVBLFNBQVMsS0FBVCxDQUFlLE1BQWYsRUFBdUI7QUFDckIsT0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNBLE9BQUssS0FBTCxHQUFhLElBQUksS0FBSixDQUFVLElBQVYsQ0FBYjtBQUNBLE9BQUssSUFBTCxHQUFZLElBQUksSUFBSixFQUFaO0FBQ0EsT0FBSyxTQUFMO0FBQ0Q7O0FBRUQsTUFBTSxTQUFOLENBQWdCLFNBQWhCLEdBQTRCLE1BQU0sU0FBbEM7O0FBRUEsTUFBTSxTQUFOLENBQWdCLFNBQWhCLEdBQTRCLFlBQVc7QUFDckMsT0FBSyxJQUFMLEdBQVksS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsQ0FBWjtBQUNBLE9BQUssS0FBTCxHQUFhLEtBQUssS0FBTCxDQUFXLElBQVgsQ0FBZ0IsSUFBaEIsQ0FBYjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxDQUFDLEtBQUQsRUFBUSxNQUFSLENBQWIsRUFBOEIsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsT0FBckIsQ0FBOUI7QUFDQSxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsT0FBYixFQUFzQixLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixFQUFxQixPQUFyQixDQUF0QjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxNQUFiLEVBQXFCLEtBQUssSUFBTCxDQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLE1BQXJCLENBQXJCO0FBQ0EsT0FBSyxJQUFMLENBQVUsRUFBVixDQUFhLE1BQWIsRUFBcUIsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsTUFBckIsQ0FBckI7QUFDQSxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsTUFBYixFQUFxQixLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixFQUFxQixNQUFyQixDQUFyQjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxLQUFiLEVBQW9CLEtBQUssSUFBTCxDQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLEtBQXJCLENBQXBCO0FBQ0EsT0FBSyxJQUFMLENBQVUsRUFBVixDQUFhLEtBQWIsRUFBb0IsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsS0FBckIsQ0FBcEI7QUFDQSxPQUFLLElBQUwsQ0FBVSxFQUFWLENBQWEsTUFBYixFQUFxQixLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixFQUFxQixNQUFyQixDQUFyQjtBQUNBLE9BQUssSUFBTCxDQUFVLEVBQVYsQ0FBYSxPQUFiLEVBQXNCLEtBQUssSUFBTCxDQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLE9BQXJCLENBQXRCO0FBQ0EsT0FBSyxLQUFMLENBQVcsRUFBWCxDQUFjLElBQWQsRUFBb0IsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsU0FBckIsQ0FBcEI7QUFDQSxPQUFLLEtBQUwsQ0FBVyxFQUFYLENBQWMsT0FBZCxFQUF1QixLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixFQUFxQixZQUFyQixDQUF2QjtBQUNBLE9BQUssS0FBTCxDQUFXLEVBQVgsQ0FBYyxNQUFkLEVBQXNCLEtBQUssSUFBTCxDQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLFdBQXJCLENBQXRCO0FBQ0EsT0FBSyxLQUFMLENBQVcsRUFBWCxDQUFjLE1BQWQsRUFBc0IsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsV0FBckIsQ0FBdEI7QUFDQSxPQUFLLEtBQUwsQ0FBVyxFQUFYLENBQWMsWUFBZCxFQUE0QixLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixFQUFxQixnQkFBckIsQ0FBNUI7QUFDRCxDQWpCRDs7QUFtQkEsTUFBTSxTQUFOLENBQWdCLEdBQWhCLEdBQXNCLFVBQVMsSUFBVCxFQUFlO0FBQ25DLE9BQUssS0FBTCxDQUFXLEdBQVgsQ0FBZSxJQUFmO0FBQ0EsT0FBSyxJQUFMLENBQVUsS0FBVjtBQUNELENBSEQ7O0FBS0EsTUFBTSxTQUFOLENBQWdCLElBQWhCLEdBQXVCLFlBQVc7QUFDaEMsT0FBSyxJQUFMLENBQVUsSUFBVjtBQUNELENBRkQ7O0FBSUEsTUFBTSxTQUFOLENBQWdCLEtBQWhCLEdBQXdCLFlBQVc7QUFDakMsT0FBSyxJQUFMLENBQVUsS0FBVjtBQUNELENBRkQ7Ozs7O0FDM0NBLElBQUksUUFBUSxRQUFRLGlCQUFSLENBQVo7QUFDQSxJQUFJLFdBQVcsUUFBUSxvQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsaUJBQVIsQ0FBWjs7QUFFQSxPQUFPLE9BQVAsR0FBaUIsS0FBakI7O0FBRUEsU0FBUyxLQUFULEdBQWlCO0FBQ2YsT0FBSyxJQUFMLEdBQVksSUFBWjtBQUNBLE9BQUssTUFBTCxHQUFjLENBQWQ7QUFDQSxPQUFLLEtBQUwsR0FBYSxJQUFJLEtBQUosRUFBYjtBQUNBLE9BQUssSUFBTCxHQUFZLElBQVo7QUFDQSxPQUFLLFNBQUw7QUFDRDs7QUFFRCxNQUFNLFNBQU4sQ0FBZ0IsU0FBaEIsR0FBNEIsTUFBTSxTQUFsQzs7QUFFQSxNQUFNLFNBQU4sQ0FBZ0IsU0FBaEIsR0FBNEIsWUFBVztBQUNyQyxPQUFLLFdBQUwsR0FBbUIsU0FBUyxLQUFLLFdBQUwsQ0FBaUIsSUFBakIsQ0FBc0IsSUFBdEIsQ0FBVCxFQUFzQyxHQUF0QyxDQUFuQjtBQUNBLE9BQUssV0FBTCxHQUFtQixLQUFLLFdBQUwsQ0FBaUIsSUFBakIsQ0FBc0IsSUFBdEIsQ0FBbkI7QUFDQSxPQUFLLE1BQUwsR0FBYyxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLElBQWpCLENBQWQ7QUFDQSxPQUFLLE1BQUwsR0FBYyxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLElBQWpCLENBQWQ7QUFDQSxPQUFLLElBQUwsR0FBWSxLQUFLLElBQUwsQ0FBVSxJQUFWLENBQWUsSUFBZixDQUFaO0FBQ0EsV0FBUyxJQUFULENBQWMsZ0JBQWQsQ0FBK0IsU0FBL0IsRUFBMEMsS0FBSyxJQUEvQztBQUNELENBUEQ7O0FBU0EsTUFBTSxTQUFOLENBQWdCLEdBQWhCLEdBQXNCLFVBQVMsSUFBVCxFQUFlO0FBQ25DLE1BQUksS0FBSyxJQUFULEVBQWU7QUFDYixTQUFLLElBQUwsQ0FBVSxtQkFBVixDQUE4QixXQUE5QixFQUEyQyxLQUFLLE1BQWhEO0FBQ0EsU0FBSyxJQUFMLENBQVUsbUJBQVYsQ0FBOEIsWUFBOUIsRUFBNEMsS0FBSyxNQUFqRDtBQUNEO0FBQ0QsT0FBSyxJQUFMLEdBQVksSUFBWjtBQUNBLE9BQUssSUFBTCxDQUFVLGdCQUFWLENBQTJCLFdBQTNCLEVBQXdDLEtBQUssTUFBN0M7QUFDQSxPQUFLLElBQUwsQ0FBVSxnQkFBVixDQUEyQixZQUEzQixFQUF5QyxLQUFLLE1BQTlDO0FBQ0QsQ0FSRDs7QUFVQSxNQUFNLFNBQU4sQ0FBZ0IsTUFBaEIsR0FBeUIsVUFBUyxDQUFULEVBQVk7QUFDbkMsT0FBSyxLQUFMLEdBQWEsS0FBSyxJQUFMLEdBQVksS0FBSyxRQUFMLENBQWMsQ0FBZCxDQUF6QjtBQUNBLE9BQUssSUFBTCxDQUFVLE1BQVYsRUFBa0IsQ0FBbEI7QUFDQSxPQUFLLE9BQUwsQ0FBYSxDQUFiO0FBQ0EsT0FBSyxTQUFMO0FBQ0QsQ0FMRDs7QUFPQSxNQUFNLFNBQU4sQ0FBZ0IsSUFBaEIsR0FBdUIsVUFBUyxDQUFULEVBQVk7QUFDakMsT0FBSyxJQUFMLENBQVUsSUFBVixFQUFnQixDQUFoQjtBQUNBLE1BQUksQ0FBQyxLQUFLLElBQVYsRUFBZ0I7QUFDaEIsT0FBSyxJQUFMLEdBQVksSUFBWjtBQUNBLE9BQUssT0FBTDtBQUNBLE9BQUssWUFBTDtBQUNELENBTkQ7O0FBUUEsTUFBTSxTQUFOLENBQWdCLE9BQWhCLEdBQTBCLFVBQVMsQ0FBVCxFQUFZO0FBQ3BDLE9BQUssV0FBTDtBQUNBLE9BQUssTUFBTCxHQUFlLEtBQUssTUFBTCxHQUFjLENBQWYsR0FBb0IsQ0FBbEM7QUFDQSxPQUFLLElBQUwsQ0FBVSxPQUFWLEVBQW1CLENBQW5CO0FBQ0QsQ0FKRDs7QUFNQSxNQUFNLFNBQU4sQ0FBZ0IsV0FBaEIsR0FBOEIsVUFBUyxDQUFULEVBQVk7QUFDeEMsT0FBSyxLQUFMLEdBQWEsS0FBSyxRQUFMLENBQWMsQ0FBZCxDQUFiOztBQUVBLE1BQUksSUFDQSxLQUFLLEdBQUwsQ0FBUyxLQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsS0FBSyxJQUFMLENBQVUsQ0FBbEMsSUFDQSxLQUFLLEdBQUwsQ0FBUyxLQUFLLEtBQUwsQ0FBVyxDQUFYLEdBQWUsS0FBSyxJQUFMLENBQVUsQ0FBbEMsQ0FGSjs7QUFJQSxNQUFJLElBQUksQ0FBUixFQUFXO0FBQ1QsU0FBSyxZQUFMO0FBQ0EsU0FBSyxTQUFMO0FBQ0Q7QUFDRixDQVhEOztBQWFBLE1BQU0sU0FBTixDQUFnQixNQUFoQixHQUF5QixVQUFTLENBQVQsRUFBWTtBQUNuQyxPQUFLLEtBQUwsR0FBYSxLQUFLLFFBQUwsQ0FBYyxDQUFkLENBQWI7QUFDQSxPQUFLLElBQUwsQ0FBVSxNQUFWLEVBQWtCLENBQWxCO0FBQ0QsQ0FIRDs7QUFLQSxNQUFNLFNBQU4sQ0FBZ0IsU0FBaEIsR0FBNEIsWUFBVztBQUNyQyxPQUFLLElBQUwsQ0FBVSxnQkFBVixDQUEyQixXQUEzQixFQUF3QyxLQUFLLFdBQTdDO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLFNBQU4sQ0FBZ0IsWUFBaEIsR0FBK0IsWUFBVztBQUN4QyxPQUFLLElBQUwsQ0FBVSxtQkFBVixDQUE4QixXQUE5QixFQUEyQyxLQUFLLFdBQWhEO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNLFNBQU4sQ0FBZ0IsU0FBaEIsR0FBNEIsWUFBVztBQUNyQyxPQUFLLElBQUwsQ0FBVSxnQkFBVixDQUEyQixXQUEzQixFQUF3QyxLQUFLLE1BQTdDO0FBQ0EsT0FBSyxJQUFMLENBQVUsWUFBVjtBQUNELENBSEQ7O0FBS0EsTUFBTSxTQUFOLENBQWdCLE9BQWhCLEdBQTBCLFlBQVc7QUFDbkMsT0FBSyxJQUFMLENBQVUsbUJBQVYsQ0FBOEIsV0FBOUIsRUFBMkMsS0FBSyxNQUFoRDtBQUNBLE9BQUssSUFBTCxDQUFVLFVBQVY7QUFDRCxDQUhEOztBQUtBLE1BQU0sU0FBTixDQUFnQixXQUFoQixHQUE4QixZQUFXO0FBQ3ZDLE9BQUssTUFBTCxHQUFjLENBQWQ7QUFDRCxDQUZEOztBQUlBLE1BQU0sU0FBTixDQUFnQixRQUFoQixHQUEyQixVQUFTLENBQVQsRUFBWTtBQUNyQyxTQUFPLElBQUksS0FBSixDQUFVO0FBQ2YsT0FBRyxFQUFFLE9BRFU7QUFFZixPQUFHLEVBQUU7QUFGVSxHQUFWLENBQVA7QUFJRCxDQUxEOzs7OztBQ2hHQSxJQUFJLE1BQU0sUUFBUSxlQUFSLENBQVY7QUFDQSxJQUFJLFdBQVcsUUFBUSxvQkFBUixDQUFmO0FBQ0EsSUFBSSxXQUFXLFFBQVEsb0JBQVIsQ0FBZjtBQUNBLElBQUksUUFBUSxRQUFRLGlCQUFSLENBQVo7O0FBRUEsSUFBSSxXQUFXLENBQWYsQyxDQUFpQjs7QUFFakIsSUFBSSxNQUFNO0FBQ1IsS0FBRyxXQURLO0FBRVIsS0FBRyxLQUZLO0FBR1IsTUFBSSxPQUhJO0FBSVIsTUFBSSxRQUpJO0FBS1IsTUFBSSxVQUxJO0FBTVIsTUFBSSxLQU5JO0FBT1IsTUFBSSxNQVBJO0FBUVIsTUFBSSxNQVJJO0FBU1IsTUFBSSxJQVRJO0FBVVIsTUFBSSxPQVZJO0FBV1IsTUFBSSxNQVhJO0FBWVIsTUFBSSxRQVpJO0FBYVIsTUFBSSxHQWJJO0FBY1IsTUFBSSxHQWRJO0FBZVIsTUFBSSxHQWZJO0FBZ0JSLE1BQUksR0FoQkk7QUFpQlIsTUFBSSxHQWpCSTtBQWtCUixNQUFJLEdBbEJJO0FBbUJSLE1BQUksR0FuQkk7QUFvQlIsTUFBSSxHQXBCSTtBQXFCUixNQUFJLEdBckJJO0FBc0JSLE1BQUksR0F0Qkk7QUF1QlIsTUFBSSxHQXZCSTtBQXdCUixNQUFJLEdBeEJJO0FBeUJSLE1BQUksR0F6Qkk7QUEwQlIsTUFBSSxHQTFCSTtBQTJCUixNQUFJLEdBM0JJO0FBNEJSLE1BQUksR0E1Qkk7QUE2QlIsTUFBSSxHQTdCSTtBQThCUixNQUFJLEdBOUJJO0FBK0JSLE9BQUssSUEvQkc7QUFnQ1IsT0FBSyxJQWhDRztBQWlDUixPQUFLLEtBakNHO0FBa0NSLE9BQUssR0FsQ0c7QUFtQ1IsT0FBSyxHQW5DRztBQW9DUixPQUFLLEdBcENHOztBQXNDUjtBQUNBLE1BQUksS0F2Q0k7QUF3Q1IsTUFBSSxNQXhDSTtBQXlDUixNQUFJLFVBekNJO0FBMENSLE9BQUssTUExQ0c7QUEyQ1IsT0FBSyxPQTNDRztBQTRDUixPQUFLLE1BNUNHO0FBNkNSLE9BQUssSUE3Q0c7QUE4Q1IsT0FBSztBQTlDRyxDQUFWOztBQWlEQSxPQUFPLE9BQVAsR0FBaUIsSUFBakI7O0FBRUEsS0FBSyxHQUFMLEdBQVcsR0FBWDs7QUFFQSxTQUFTLElBQVQsR0FBZ0I7QUFDZCxRQUFNLElBQU4sQ0FBVyxJQUFYOztBQUVBLE9BQUssRUFBTCxHQUFVLFNBQVMsYUFBVCxDQUF1QixVQUF2QixDQUFWOztBQUVBLE1BQUksS0FBSixDQUFVLElBQVYsRUFBZ0I7QUFDZCxjQUFVLFVBREk7QUFFZCxVQUFNLENBRlE7QUFHZCxTQUFLLENBSFM7QUFJZCxXQUFPLENBSk87QUFLZCxZQUFRLENBTE07QUFNZCxhQUFTLENBTks7QUFPZCxZQUFRO0FBUE0sR0FBaEI7O0FBVUEsTUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQjtBQUNkLG9CQUFnQixNQURGO0FBRWQsa0JBQWMsS0FGQTtBQUdkLG1CQUFlO0FBSEQsR0FBaEI7O0FBTUEsT0FBSyxZQUFMLEdBQW9CLENBQXBCO0FBQ0EsT0FBSyxTQUFMLEdBQWlCLEVBQWpCO0FBQ0EsT0FBSyxTQUFMO0FBQ0Q7O0FBRUQsS0FBSyxTQUFMLENBQWUsU0FBZixHQUEyQixNQUFNLFNBQWpDOztBQUVBLEtBQUssU0FBTCxDQUFlLFNBQWYsR0FBMkIsWUFBVztBQUNwQyxPQUFLLEtBQUwsR0FBYSxLQUFLLEtBQUwsQ0FBVyxJQUFYLENBQWdCLElBQWhCLENBQWI7QUFDQSxPQUFLLE1BQUwsR0FBYyxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLElBQWpCLENBQWQ7QUFDQSxPQUFLLE9BQUwsR0FBZSxLQUFLLE9BQUwsQ0FBYSxJQUFiLENBQWtCLElBQWxCLENBQWY7QUFDQSxPQUFLLE9BQUwsR0FBZSxLQUFLLE9BQUwsQ0FBYSxJQUFiLENBQWtCLElBQWxCLENBQWY7QUFDQSxPQUFLLFNBQUwsR0FBaUIsS0FBSyxTQUFMLENBQWUsSUFBZixDQUFvQixJQUFwQixDQUFqQjtBQUNBLE9BQUssT0FBTCxHQUFlLEtBQUssT0FBTCxDQUFhLElBQWIsQ0FBa0IsSUFBbEIsQ0FBZjtBQUNBLE9BQUssRUFBTCxDQUFRLE1BQVIsR0FBaUIsS0FBSyxJQUFMLENBQVUsSUFBVixDQUFlLElBQWYsRUFBcUIsTUFBckIsQ0FBakI7QUFDQSxPQUFLLEVBQUwsQ0FBUSxPQUFSLEdBQWtCLEtBQUssSUFBTCxDQUFVLElBQVYsQ0FBZSxJQUFmLEVBQXFCLE9BQXJCLENBQWxCO0FBQ0EsT0FBSyxFQUFMLENBQVEsT0FBUixHQUFrQixLQUFLLE9BQXZCO0FBQ0EsT0FBSyxFQUFMLENBQVEsU0FBUixHQUFvQixLQUFLLFNBQXpCO0FBQ0EsT0FBSyxFQUFMLENBQVEsT0FBUixHQUFrQixLQUFLLE9BQXZCO0FBQ0EsT0FBSyxFQUFMLENBQVEsS0FBUixHQUFnQixLQUFLLEtBQXJCO0FBQ0EsT0FBSyxFQUFMLENBQVEsTUFBUixHQUFpQixLQUFLLE1BQXRCO0FBQ0EsT0FBSyxFQUFMLENBQVEsT0FBUixHQUFrQixLQUFLLE9BQXZCO0FBQ0EsT0FBSyxLQUFMLEdBQWEsU0FBUyxLQUFLLEtBQUwsQ0FBVyxJQUFYLENBQWdCLElBQWhCLENBQVQsRUFBZ0MsSUFBaEMsQ0FBYjtBQUNELENBaEJEOztBQWtCQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLEdBQXVCLFlBQVc7QUFDaEMsT0FBSyxHQUFMLENBQVMsRUFBVDtBQUNBLE9BQUssU0FBTCxHQUFpQixFQUFqQjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsR0FBZixHQUFxQixZQUFXO0FBQzlCLFNBQU8sS0FBSyxFQUFMLENBQVEsS0FBUixDQUFjLE1BQWQsQ0FBcUIsQ0FBQyxDQUF0QixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxHQUFmLEdBQXFCLFVBQVMsS0FBVCxFQUFnQjtBQUNuQyxPQUFLLEVBQUwsQ0FBUSxLQUFSLEdBQWdCLEtBQWhCO0FBQ0QsQ0FGRDs7QUFJQTtBQUNBO0FBQ0E7QUFDQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLEdBQXVCLFlBQVc7QUFDaEMsT0FBSyxHQUFMLENBQVMsRUFBVDtBQUNELENBRkQ7O0FBSUEsS0FBSyxTQUFMLENBQWUsSUFBZixHQUFzQixZQUFXO0FBQy9CO0FBQ0EsT0FBSyxFQUFMLENBQVEsSUFBUjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsS0FBZixHQUF1QixZQUFXO0FBQ2hDO0FBQ0EsT0FBSyxFQUFMLENBQVEsS0FBUjtBQUNELENBSEQ7O0FBS0EsS0FBSyxTQUFMLENBQWUsT0FBZixHQUF5QixVQUFTLENBQVQsRUFBWTtBQUFBOztBQUNuQyxJQUFFLGNBQUY7QUFDQTtBQUNBLGVBQWE7QUFBQSxXQUFNLE1BQUssRUFBTCxDQUFRLGNBQVIsR0FBeUIsTUFBSyxFQUFMLENBQVEsS0FBUixDQUFjLE1BQTdDO0FBQUEsR0FBYjtBQUNBLE9BQUssSUFBTCxDQUFVLE1BQVYsRUFBa0IsS0FBSyxHQUFMLEVBQWxCO0FBQ0EsT0FBSyxLQUFMO0FBQ0EsU0FBTyxLQUFQO0FBQ0QsQ0FQRDs7QUFTQSxLQUFLLFNBQUwsQ0FBZSxTQUFmLEdBQTJCLFVBQVMsQ0FBVCxFQUFZO0FBQUE7O0FBQ3JDO0FBQ0EsTUFBSSxNQUFNLEtBQUssR0FBTCxFQUFWO0FBQ0EsTUFBSSxNQUFNLEtBQUssWUFBWCxHQUEwQixRQUE5QixFQUF3QztBQUN0QyxNQUFFLGNBQUY7QUFDQSxXQUFPLEtBQVA7QUFDRDtBQUNELE9BQUssWUFBTCxHQUFvQixHQUFwQjs7QUFFQSxNQUFJLElBQUksS0FBSyxTQUFiO0FBQ0EsSUFBRSxLQUFGLEdBQVUsRUFBRSxRQUFaO0FBQ0EsSUFBRSxJQUFGLEdBQVMsRUFBRSxPQUFYO0FBQ0EsSUFBRSxHQUFGLEdBQVEsRUFBRSxNQUFWOztBQUVBLE1BQUksT0FBTyxFQUFYO0FBQ0EsTUFBSSxFQUFFLEtBQU4sRUFBYSxLQUFLLElBQUwsQ0FBVSxPQUFWO0FBQ2IsTUFBSSxFQUFFLElBQU4sRUFBWSxLQUFLLElBQUwsQ0FBVSxNQUFWO0FBQ1osTUFBSSxFQUFFLEdBQU4sRUFBVyxLQUFLLElBQUwsQ0FBVSxLQUFWO0FBQ1gsTUFBSSxFQUFFLEtBQUYsSUFBVyxHQUFmLEVBQW9CLEtBQUssSUFBTCxDQUFVLElBQUksRUFBRSxLQUFOLENBQVY7O0FBRXBCLE1BQUksS0FBSyxNQUFULEVBQWlCO0FBQ2YsUUFBSSxRQUFRLEtBQUssSUFBTCxDQUFVLEdBQVYsQ0FBWjtBQUNBLFNBQUssSUFBTCxDQUFVLE1BQVYsRUFBa0IsS0FBbEIsRUFBeUIsQ0FBekI7QUFDQSxTQUFLLElBQUwsQ0FBVSxLQUFWLEVBQWlCLENBQWpCO0FBQ0EsU0FBSyxPQUFMLENBQWEsVUFBQyxLQUFEO0FBQUEsYUFBVyxPQUFLLElBQUwsQ0FBVSxLQUFWLEVBQWlCLEtBQWpCLEVBQXdCLENBQXhCLENBQVg7QUFBQSxLQUFiO0FBQ0Q7QUFDRixDQTFCRDs7QUE0QkEsS0FBSyxTQUFMLENBQWUsT0FBZixHQUF5QixVQUFTLENBQVQsRUFBWTtBQUFBOztBQUNuQyxPQUFLLFlBQUwsR0FBb0IsQ0FBcEI7O0FBRUEsTUFBSSxJQUFJLEtBQUssU0FBYjs7QUFFQSxNQUFJLE9BQU8sRUFBWDtBQUNBLE1BQUksRUFBRSxLQUFGLElBQVcsQ0FBQyxFQUFFLFFBQWxCLEVBQTRCLEtBQUssSUFBTCxDQUFVLFVBQVY7QUFDNUIsTUFBSSxFQUFFLElBQUYsSUFBVSxDQUFDLEVBQUUsT0FBakIsRUFBMEIsS0FBSyxJQUFMLENBQVUsU0FBVjtBQUMxQixNQUFJLEVBQUUsR0FBRixJQUFTLENBQUMsRUFBRSxNQUFoQixFQUF3QixLQUFLLElBQUwsQ0FBVSxRQUFWOztBQUV4QixJQUFFLEtBQUYsR0FBVSxFQUFFLFFBQVo7QUFDQSxJQUFFLElBQUYsR0FBUyxFQUFFLE9BQVg7QUFDQSxJQUFFLEdBQUYsR0FBUSxFQUFFLE1BQVY7O0FBRUEsTUFBSSxFQUFFLEtBQU4sRUFBYSxLQUFLLElBQUwsQ0FBVSxPQUFWO0FBQ2IsTUFBSSxFQUFFLElBQU4sRUFBWSxLQUFLLElBQUwsQ0FBVSxNQUFWO0FBQ1osTUFBSSxFQUFFLEdBQU4sRUFBVyxLQUFLLElBQUwsQ0FBVSxLQUFWO0FBQ1gsTUFBSSxFQUFFLEtBQUYsSUFBVyxHQUFmLEVBQW9CLEtBQUssSUFBTCxDQUFVLElBQUksRUFBRSxLQUFOLElBQWUsS0FBekI7O0FBRXBCLE1BQUksS0FBSyxNQUFULEVBQWlCO0FBQ2YsUUFBSSxRQUFRLEtBQUssSUFBTCxDQUFVLEdBQVYsQ0FBWjtBQUNBLFNBQUssSUFBTCxDQUFVLE1BQVYsRUFBa0IsS0FBbEIsRUFBeUIsQ0FBekI7QUFDQSxTQUFLLElBQUwsQ0FBVSxLQUFWLEVBQWlCLENBQWpCO0FBQ0EsU0FBSyxPQUFMLENBQWEsVUFBQyxLQUFEO0FBQUEsYUFBVyxPQUFLLElBQUwsQ0FBVSxLQUFWLEVBQWlCLEtBQWpCLEVBQXdCLENBQXhCLENBQVg7QUFBQSxLQUFiO0FBQ0Q7QUFDRixDQXpCRDs7QUEyQkEsS0FBSyxTQUFMLENBQWUsS0FBZixHQUF1QixVQUFTLENBQVQsRUFBWTtBQUNqQyxJQUFFLGNBQUY7QUFDQSxPQUFLLElBQUwsQ0FBVSxLQUFWLEVBQWlCLENBQWpCO0FBQ0QsQ0FIRDs7QUFLQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsQ0FBVCxFQUFZO0FBQ2xDLElBQUUsY0FBRjtBQUNBLE9BQUssSUFBTCxDQUFVLE1BQVYsRUFBa0IsQ0FBbEI7QUFDRCxDQUhEOztBQUtBLEtBQUssU0FBTCxDQUFlLE9BQWYsR0FBeUIsVUFBUyxDQUFULEVBQVk7QUFDbkMsSUFBRSxjQUFGO0FBQ0EsT0FBSyxJQUFMLENBQVUsT0FBVixFQUFtQixDQUFuQjtBQUNELENBSEQ7Ozs7O0FDbE5BLElBQUksU0FBUyxRQUFRLGVBQVIsQ0FBYjtBQUNBLElBQUksUUFBUSxRQUFRLGNBQVIsQ0FBWjtBQUNBLElBQUksUUFBUSxRQUFRLGNBQVIsQ0FBWjs7QUFFQSxJQUFJLFFBQVEsT0FBTyxNQUFQLENBQWMsQ0FBQyxPQUFELENBQWQsRUFBeUIsR0FBekIsQ0FBWjs7QUFFQSxPQUFPLE9BQVAsR0FBaUIsSUFBakI7O0FBRUEsU0FBUyxJQUFULENBQWMsTUFBZCxFQUFzQjtBQUNwQixRQUFNLElBQU4sQ0FBVyxJQUFYO0FBQ0EsT0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNBLE9BQUssZUFBTCxHQUF1QixDQUF2QjtBQUNEOztBQUVELEtBQUssU0FBTCxDQUFlLFNBQWYsR0FBMkIsTUFBTSxTQUFqQzs7QUFFQSxLQUFLLFNBQUwsQ0FBZSxRQUFmLEdBQTBCLFVBQVMsR0FBVCxFQUFjO0FBQ3RDLFFBQU0sT0FBTyxDQUFiO0FBQ0EsTUFBSSxPQUFPLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBakIsR0FBMEIsR0FBMUIsR0FBZ0MsQ0FBM0M7QUFDQSxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksSUFBWixDQUFpQixNQUFqQixHQUEwQixHQUExQixHQUFnQyxDQUEzQztBQUNBLE1BQUksWUFBWSxPQUFPLE9BQU8sS0FBSyxNQUFMLENBQVksSUFBWixDQUFpQixNQUEvQixHQUF3QyxDQUF4RDtBQUNBLE9BQUssTUFBTCxDQUFZLGVBQVosQ0FBNEIsQ0FBNUIsRUFBK0IsT0FBTyxTQUF0QztBQUNBLFNBQU8sS0FBSyxPQUFMLENBQWEsSUFBYixDQUFQO0FBQ0QsQ0FQRDs7QUFTQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFVBQVMsR0FBVCxFQUFjO0FBQ3BDLFFBQU0sT0FBTyxDQUFiO0FBQ0EsTUFBSSxPQUFPLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBakIsR0FBMEIsR0FBMUIsR0FBZ0MsQ0FBM0M7QUFDQSxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksSUFBWixDQUFpQixNQUFqQixHQUEwQixHQUExQixHQUFnQyxDQUEzQztBQUNBLE1BQUksWUFBWSxPQUFPLE9BQU8sS0FBSyxNQUFMLENBQVksSUFBWixDQUFpQixNQUEvQixHQUF3QyxDQUF4RDtBQUNBLE9BQUssTUFBTCxDQUFZLGVBQVosQ0FBNEIsQ0FBNUIsRUFBK0IsRUFBRSxPQUFPLFNBQVQsQ0FBL0I7QUFDQSxTQUFPLEtBQUssT0FBTCxDQUFhLENBQUMsSUFBZCxDQUFQO0FBQ0QsQ0FQRDs7QUFTQSxJQUFJLE9BQU8sRUFBWDs7QUFFQSxLQUFLLE1BQUwsR0FBYyxVQUFTLE1BQVQsRUFBaUIsQ0FBakIsRUFBb0IsRUFBcEIsRUFBd0I7QUFDcEMsTUFBSSxPQUFPLE9BQU8sV0FBUCxDQUFtQixFQUFFLENBQXJCLENBQVg7O0FBRUEsTUFBSSxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsSUFBTyxLQUFLLE1BQUwsR0FBYyxDQUFuQyxFQUFzQztBQUFFO0FBQ3RDLFdBQU8sS0FBSyxPQUFMLENBQWEsTUFBYixFQUFxQixDQUFyQixFQUF3QixDQUFDLENBQXpCLENBQVAsQ0FEb0MsQ0FDQTtBQUNyQyxHQUZELE1BRU8sSUFBSSxLQUFLLENBQUwsSUFBVSxFQUFFLENBQUYsS0FBUSxDQUF0QixFQUF5QjtBQUFFO0FBQ2hDLFdBQU8sS0FBSyxPQUFMLENBQWEsTUFBYixFQUFxQixDQUFyQixFQUF3QixDQUFDLENBQXpCLENBQVAsQ0FEOEIsQ0FDTTtBQUNyQzs7QUFFRCxNQUFJLFFBQVEsT0FBTyxLQUFQLENBQWEsSUFBYixFQUFtQixLQUFuQixDQUFaO0FBQ0EsTUFBSSxJQUFKOztBQUVBLE1BQUksS0FBSyxDQUFULEVBQVksTUFBTSxPQUFOOztBQUVaLE9BQUssSUFBSSxJQUFJLENBQWIsRUFBZ0IsSUFBSSxNQUFNLE1BQTFCLEVBQWtDLEdBQWxDLEVBQXVDO0FBQ3JDLFdBQU8sTUFBTSxDQUFOLENBQVA7QUFDQSxRQUFJLEtBQUssQ0FBTCxHQUNBLEtBQUssS0FBTCxHQUFhLEVBQUUsQ0FEZixHQUVBLEtBQUssS0FBTCxHQUFhLEVBQUUsQ0FGbkIsRUFFc0I7QUFDcEIsYUFBTztBQUNMLFdBQUcsS0FBSyxLQURIO0FBRUwsV0FBRyxFQUFFO0FBRkEsT0FBUDtBQUlEO0FBQ0Y7O0FBRUQ7QUFDQSxTQUFPLEtBQUssQ0FBTCxHQUNILEtBQUssU0FBTCxDQUFlLE1BQWYsRUFBdUIsQ0FBdkIsQ0FERyxHQUVILEtBQUssV0FBTCxDQUFpQixNQUFqQixFQUF5QixDQUF6QixDQUZKO0FBR0QsQ0E5QkQ7O0FBZ0NBLEtBQUssT0FBTCxHQUFlLFVBQVMsTUFBVCxFQUFpQixDQUFqQixFQUFvQixFQUFwQixFQUF3QjtBQUNyQyxNQUFJLElBQUksRUFBRSxDQUFWO0FBQ0EsTUFBSSxJQUFJLEVBQUUsQ0FBVjs7QUFFQSxNQUFJLEtBQUssQ0FBVCxFQUFZO0FBQUU7QUFDWixTQUFLLEVBQUwsQ0FEVSxDQUNEO0FBQ1QsUUFBSSxJQUFJLENBQVIsRUFBVztBQUFFO0FBQ1gsVUFBSSxJQUFJLENBQVIsRUFBVztBQUFFO0FBQ1gsYUFBSyxDQUFMLENBRFMsQ0FDRDtBQUNSLFlBQUksT0FBTyxPQUFQLENBQWUsQ0FBZixFQUFrQixNQUF0QixDQUZTLENBRXFCO0FBQy9CLE9BSEQsTUFHTztBQUNMLFlBQUksQ0FBSjtBQUNEO0FBQ0Y7QUFDRixHQVZELE1BVU8sSUFBSSxLQUFLLENBQVQsRUFBWTtBQUFFO0FBQ25CLFNBQUssRUFBTCxDQURpQixDQUNSO0FBQ1QsV0FBTyxJQUFJLE9BQU8sT0FBUCxDQUFlLENBQWYsRUFBa0IsTUFBdEIsR0FBK0IsQ0FBdEMsRUFBeUM7QUFBRTtBQUN6QyxVQUFJLE1BQU0sT0FBTyxHQUFQLEVBQVYsRUFBd0I7QUFBRTtBQUN4QixZQUFJLE9BQU8sT0FBUCxDQUFlLENBQWYsRUFBa0IsTUFBdEIsQ0FEc0IsQ0FDUTtBQUM5QixjQUZzQixDQUVmO0FBQ1I7QUFDRCxXQUFLLE9BQU8sT0FBUCxDQUFlLENBQWYsRUFBa0IsTUFBbEIsR0FBMkIsQ0FBaEMsQ0FMdUMsQ0FLSjtBQUNuQyxXQUFLLENBQUwsQ0FOdUMsQ0FNL0I7QUFDVDtBQUNGOztBQUVELE9BQUssZUFBTCxHQUF1QixDQUF2Qjs7QUFFQSxTQUFPO0FBQ0wsT0FBRyxDQURFO0FBRUwsT0FBRztBQUZFLEdBQVA7QUFJRCxDQWhDRDs7QUFrQ0EsS0FBSyxPQUFMLEdBQWUsVUFBUyxNQUFULEVBQWlCLENBQWpCLEVBQW9CLEVBQXBCLEVBQXdCO0FBQ3JDLE1BQUksSUFBSSxFQUFFLENBQVY7QUFDQSxNQUFJLElBQUksRUFBRSxDQUFWOztBQUVBLE1BQUksS0FBSyxDQUFULEVBQVk7QUFBRTtBQUNaLFFBQUksSUFBSSxFQUFKLEdBQVMsQ0FBYixFQUFnQjtBQUFFO0FBQ2hCLFdBQUssRUFBTCxDQURjLENBQ0w7QUFDVixLQUZELE1BRU87QUFDTCxVQUFJLENBQUo7QUFDRDtBQUNGLEdBTkQsTUFNTyxJQUFJLEtBQUssQ0FBVCxFQUFZO0FBQUU7QUFDbkIsUUFBSSxJQUFJLE9BQU8sR0FBUCxLQUFlLEVBQXZCLEVBQTJCO0FBQUU7QUFDM0IsV0FBSyxFQUFMLENBRHlCLENBQ2hCO0FBQ1YsS0FGRCxNQUVPO0FBQ0wsVUFBSSxPQUFPLEdBQVAsRUFBSjtBQUNEO0FBQ0Y7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQSxNQUFJLEtBQUssR0FBTCxDQUFTLEtBQUssZUFBZCxFQUErQixPQUFPLE9BQVAsQ0FBZSxDQUFmLEVBQWtCLE1BQWpELENBQUo7O0FBRUEsU0FBTztBQUNMLE9BQUcsQ0FERTtBQUVMLE9BQUc7QUFGRSxHQUFQO0FBSUQsQ0E1QkQ7O0FBOEJBLEtBQUssV0FBTCxHQUFtQixVQUFTLENBQVQsRUFBWSxDQUFaLEVBQWU7QUFDaEMsT0FBSyxlQUFMLEdBQXVCLENBQXZCO0FBQ0EsU0FBTztBQUNMLE9BQUcsQ0FERTtBQUVMLE9BQUcsRUFBRTtBQUZBLEdBQVA7QUFJRCxDQU5EOztBQVFBLEtBQUssU0FBTCxHQUFpQixVQUFTLE1BQVQsRUFBaUIsQ0FBakIsRUFBb0I7QUFDbkMsTUFBSSxJQUFJLE9BQU8sT0FBUCxDQUFlLEVBQUUsQ0FBakIsRUFBb0IsTUFBNUI7QUFDQSxPQUFLLGVBQUwsR0FBdUIsUUFBdkI7QUFDQSxTQUFPO0FBQ0wsT0FBRyxDQURFO0FBRUwsT0FBRyxFQUFFO0FBRkEsR0FBUDtBQUlELENBUEQ7O0FBU0EsS0FBSyxXQUFMLEdBQW1CLFlBQVc7QUFDNUIsT0FBSyxlQUFMLEdBQXVCLENBQXZCO0FBQ0EsU0FBTztBQUNMLE9BQUcsQ0FERTtBQUVMLE9BQUc7QUFGRSxHQUFQO0FBSUQsQ0FORDs7QUFRQSxLQUFLLFNBQUwsR0FBaUIsVUFBUyxNQUFULEVBQWlCO0FBQ2hDLE1BQUksT0FBTyxPQUFPLEdBQVAsRUFBWDtBQUNBLE1BQUksSUFBSSxPQUFPLE9BQVAsQ0FBZSxJQUFmLEVBQXFCLE1BQTdCO0FBQ0EsT0FBSyxlQUFMLEdBQXVCLENBQXZCO0FBQ0EsU0FBTztBQUNMLE9BQUcsQ0FERTtBQUVMLE9BQUc7QUFGRSxHQUFQO0FBSUQsQ0FSRDs7QUFVQSxLQUFLLGFBQUwsR0FBcUIsVUFBUyxDQUFULEVBQVksQ0FBWixFQUFlO0FBQ2xDLFNBQU8sRUFBRSxDQUFGLEtBQVEsQ0FBUixJQUFhLEVBQUUsQ0FBRixLQUFRLENBQTVCO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFdBQUwsR0FBbUIsVUFBUyxNQUFULEVBQWlCLENBQWpCLEVBQW9CO0FBQ3JDLE1BQUksT0FBTyxPQUFPLEdBQVAsRUFBWDtBQUNBLFNBQU8sRUFBRSxDQUFGLEtBQVEsSUFBUixJQUFnQixFQUFFLENBQUYsS0FBUSxPQUFPLE9BQVAsQ0FBZSxJQUFmLEVBQXFCLE1BQXBEO0FBQ0QsQ0FIRDs7QUFLQSxPQUFPLElBQVAsQ0FBWSxJQUFaLEVBQWtCLE9BQWxCLENBQTBCLFVBQVMsTUFBVCxFQUFpQjtBQUN6QyxPQUFLLFNBQUwsQ0FBZSxNQUFmLElBQXlCLFVBQVMsS0FBVCxFQUFnQixNQUFoQixFQUF3QjtBQUMvQyxRQUFJLFNBQVMsS0FBSyxNQUFMLEVBQWEsSUFBYixDQUNYLElBRFcsRUFFWCxLQUFLLE1BQUwsQ0FBWSxNQUZELEVBR1gsS0FBSyxNQUFMLENBQVksS0FIRCxFQUlYLEtBSlcsQ0FBYjs7QUFPQSxRQUFJLFNBQVMsT0FBTyxLQUFQLENBQWEsQ0FBYixFQUFlLENBQWYsQ0FBYixFQUFnQyxPQUFPLE1BQVA7O0FBRWhDLFNBQUssSUFBTCxDQUFVLE1BQVYsRUFBa0IsTUFBbEIsRUFBMEIsTUFBMUI7QUFDRCxHQVhEO0FBWUQsQ0FiRDs7O0FDaExBOzs7O0FDQUEsSUFBSSxNQUFNLFFBQVEsWUFBUixDQUFWO0FBQ0EsSUFBSSxNQUFNLFFBQVEsYUFBUixDQUFWOztBQUVBLElBQUksU0FBUztBQUNYLFdBQVM7QUFDUCxnQkFBWSxTQURMO0FBRVAsV0FBTyxTQUZBO0FBR1AsYUFBUyxTQUhGO0FBSVAsY0FBVSxTQUpIO0FBS1AsYUFBUyxTQUxGO0FBTVAsWUFBUSxTQU5EO0FBT1AsWUFBUSxTQVBEO0FBUVAsYUFBUyxTQVJGO0FBU1AsWUFBUTtBQVRELEdBREU7O0FBYVgsV0FBUztBQUNQLGdCQUFZLFNBREw7QUFFUCxXQUFPLFNBRkE7QUFHUCxhQUFTLFNBSEY7QUFJUCxjQUFVLFNBSkg7QUFLUCxhQUFTLFNBTEY7QUFNUCxZQUFRLFNBTkQ7QUFPUCxZQUFRLFNBUEQ7QUFRUCxhQUFTLFNBUkY7QUFTUCxZQUFRO0FBVEQsR0FiRTs7QUF5QlgsWUFBVTtBQUNSLGdCQUFZLFNBREo7QUFFUixXQUFPLFNBRkM7QUFHUixhQUFTLFNBSEQ7QUFJUixjQUFVLFNBSkY7QUFLUixhQUFTLFNBTEQ7QUFNUixZQUFRLFNBTkE7QUFPUixZQUFRLFNBUEE7QUFRUixZQUFRLFNBUkE7QUFTUixhQUFTLFNBVEQ7QUFVUixZQUFRO0FBVkEsR0F6QkM7O0FBc0NYLFlBQVU7QUFDUixnQkFBWSxTQURKO0FBRVIsV0FBTyxTQUZDO0FBR1IsYUFBUyxTQUhEO0FBSVIsY0FBVSxTQUpGO0FBS1IsYUFBUyxTQUxEO0FBTVIsWUFBUSxTQU5BO0FBT1IsWUFBUSxTQVBBO0FBUVIsYUFBUyxTQVJEO0FBU1IsWUFBUTtBQVRBO0FBdENDLENBQWI7O0FBbURBLFVBQVUsT0FBTyxPQUFQLEdBQWlCLFFBQTNCO0FBQ0EsUUFBUSxNQUFSLEdBQWlCLE1BQWpCOztBQUVBOzs7Ozs7Ozs7Ozs7Ozs7QUFlQSxTQUFTLFFBQVQsQ0FBa0IsSUFBbEIsRUFBd0I7QUFDdEIsTUFBSSxJQUFJLE9BQU8sSUFBUCxDQUFSO0FBQ0EsTUFBSSxHQUFKLENBQVEsT0FBUixVQUVDLElBRkQsWUFHQyxJQUFJLElBSEwsMEJBSWMsRUFBRSxVQUpoQixrQ0FTUyxFQUFFLE9BVFgsa0NBY1MsRUFBRSxPQWRYLGtDQW1CUyxFQUFFLE1BbkJYLDhCQXVCUyxFQUFFLE1BdkJYLDhCQTJCUyxFQUFFLFFBM0JYLHNEQWdDUyxFQUFFLE1BQUYsSUFBWSxFQUFFLE1BaEN2QiwrQkFvQ1MsRUFBRSxPQXBDWCw4QkF3Q1MsRUFBRSxNQXhDWCxxQkE0Q0MsSUFBSSxJQTVDTCxxQkE2Q1MsRUFBRSxLQTdDWCxpQkFnREMsSUFBSSxLQWhETCwwQkFpRGMsRUFBRSxLQWpEaEI7QUFvRUQ7Ozs7O0FDOUlELElBQUksTUFBTSxRQUFRLGVBQVIsQ0FBVjtBQUNBLElBQUksTUFBTSxRQUFRLGNBQVIsQ0FBVjtBQUNBLElBQUksT0FBTyxRQUFRLFFBQVIsQ0FBWDs7QUFFQSxPQUFPLE9BQVAsR0FBaUIsU0FBakI7O0FBRUEsU0FBUyxTQUFULENBQW1CLE1BQW5CLEVBQTJCO0FBQ3pCLE9BQUssSUFBTCxDQUFVLElBQVYsRUFBZ0IsTUFBaEI7QUFDQSxPQUFLLElBQUwsR0FBWSxPQUFaO0FBQ0EsT0FBSyxHQUFMLEdBQVcsSUFBSSxJQUFJLEtBQVIsQ0FBWDtBQUNBLE9BQUssSUFBTCxHQUFZLEVBQVo7QUFDRDs7QUFFRCxVQUFVLFNBQVYsQ0FBb0IsU0FBcEIsR0FBZ0MsS0FBSyxTQUFyQzs7QUFFQSxVQUFVLFNBQVYsQ0FBb0IsR0FBcEIsR0FBMEIsVUFBUyxNQUFULEVBQWlCO0FBQ3pDLE1BQUksTUFBSixDQUFXLE1BQVgsRUFBbUIsSUFBbkI7QUFDRCxDQUZEOztBQUlBLFVBQVUsU0FBVixDQUFvQixHQUFwQixHQUEwQixVQUFTLENBQVQsRUFBWTtBQUNwQyxNQUFJLE9BQU8sRUFBWDs7QUFFQSxNQUFJLE9BQU87QUFDVCxTQUFLLE9BREk7QUFFVCxTQUFLLFFBRkk7QUFHVCxTQUFLO0FBSEksR0FBWDs7QUFNQSxNQUFJLFFBQVE7QUFDVixTQUFLLE9BREs7QUFFVixTQUFLLFFBRks7QUFHVixTQUFLO0FBSEssR0FBWjs7QUFNQSxNQUFJLFNBQVMsRUFBRSxNQUFGLENBQVMsUUFBVCxDQUFrQixFQUFFLEtBQXBCLEVBQTJCLE1BQXhDOztBQUVBLE1BQUksU0FBUyxFQUFFLE1BQUYsQ0FBUyxNQUFULENBQWdCLFdBQWhCLENBQTRCLFFBQTVCLEVBQXNDLE1BQXRDLENBQWI7QUFDQSxNQUFJLENBQUMsTUFBTCxFQUFhLE9BQU8sSUFBUDs7QUFFYixNQUFJLFNBQVMsRUFBRSxNQUFGLENBQVMsTUFBVCxDQUFnQixhQUFoQixDQUE4QixRQUE5QixFQUF3QyxNQUFyRDtBQUNBLE1BQUksT0FBTyxFQUFFLE1BQUYsQ0FBUyxNQUFULENBQWdCLE1BQWhCLENBQVg7O0FBRUEsTUFBSSxJQUFKO0FBQ0EsTUFBSSxLQUFKOztBQUVBLE1BQUksSUFBSSxPQUFPLEtBQWY7QUFDQSxNQUFJLGFBQWEsT0FBTyxNQUF4Qjs7QUFFQSxTQUFPLEVBQUUsTUFBRixDQUFTLE1BQVQsQ0FBZ0IsVUFBaEIsQ0FBUDs7QUFFQSxNQUFJLFFBQVEsT0FBTyxNQUFQLElBQWlCLFNBQVMsQ0FBMUIsSUFBK0IsTUFBTSxJQUFOLENBQS9CLEdBQTZDLENBQTdDLEdBQWlELENBQTdEOztBQUVBLE1BQUksUUFBUSxHQUFaOztBQUVBLFNBQU8sSUFBSSxDQUFYLEVBQWM7QUFDWixXQUFPLEtBQUssSUFBTCxDQUFQO0FBQ0EsUUFBSSxNQUFNLElBQU4sQ0FBSixFQUFpQjtBQUNqQixRQUFJLENBQUMsR0FBRSxLQUFQLEVBQWMsT0FBTyxJQUFQOztBQUVkLFFBQUksUUFBUSxDQUFDLEdBQUUsS0FBZixFQUFzQjs7QUFFdEIsaUJBQWEsRUFBRSxNQUFGLENBQVMsTUFBVCxDQUFnQixVQUFoQixDQUEyQixRQUEzQixFQUFxQyxFQUFFLENBQXZDLENBQWI7QUFDQSxXQUFPLEVBQUUsTUFBRixDQUFTLE1BQVQsQ0FBZ0IsVUFBaEIsQ0FBUDtBQUNEOztBQUVELE1BQUksS0FBSixFQUFXLE9BQU8sSUFBUDs7QUFFWCxVQUFRLENBQVI7O0FBRUEsTUFBSSxXQUFKOztBQUVBLFNBQU8sSUFBSSxTQUFTLENBQXBCLEVBQXVCO0FBQ3JCLGtCQUFjLEVBQUUsTUFBRixDQUFTLE1BQVQsQ0FBZ0IsVUFBaEIsQ0FBMkIsUUFBM0IsRUFBcUMsRUFBRSxDQUF2QyxDQUFkO0FBQ0EsV0FBTyxFQUFFLE1BQUYsQ0FBUyxNQUFULENBQWdCLFdBQWhCLENBQVA7QUFDQSxRQUFJLENBQUMsR0FBRSxLQUFQLEVBQWMsT0FBTyxJQUFQOztBQUVkLFlBQVEsTUFBTSxJQUFOLENBQVI7QUFDQSxRQUFJLEtBQUssSUFBTCxNQUFlLElBQW5CLEVBQXlCO0FBQ3pCLFFBQUksU0FBUyxLQUFiLEVBQW9COztBQUVwQixRQUFJLENBQUMsS0FBTCxFQUFZO0FBQ2I7O0FBRUQsTUFBSSxLQUFKLEVBQVcsT0FBTyxJQUFQOztBQUVYLE1BQUksUUFBUSxFQUFFLE1BQUYsQ0FBUyxjQUFULENBQXdCLFVBQXhCLENBQVo7QUFDQSxNQUFJLE1BQU0sRUFBRSxNQUFGLENBQVMsY0FBVCxDQUF3QixXQUF4QixDQUFWOztBQUVBLE1BQUksSUFBSjs7QUFFQSxTQUFPLEVBQUUsWUFBRixDQUFlLEtBQWYsQ0FBUDs7QUFFQSxVQUFRLGVBQ0EsUUFEQSxHQUNXLEVBQUUsSUFBRixDQUFPLEtBRGxCLEdBQzBCLEtBRDFCLEdBRUEsTUFGQSxHQUVVLE1BQU0sQ0FBTixHQUFVLEVBQUUsSUFBRixDQUFPLE1BRjNCLEdBRXFDLEtBRnJDLEdBR0EsT0FIQSxJQUdXLENBQUMsTUFBTSxDQUFOLEdBQVUsS0FBSyxJQUFMLEdBQVksRUFBRSxPQUF4QixHQUFrQyxLQUFLLFNBQXhDLElBQ0QsRUFBRSxJQUFGLENBQU8sS0FETixHQUNjLEVBQUUsUUFKM0IsSUFJdUMsS0FKdkMsR0FLQSxRQUxSOztBQU9BLFNBQU8sRUFBRSxZQUFGLENBQWUsR0FBZixDQUFQOztBQUVBLFVBQVEsZUFDQSxRQURBLEdBQ1csRUFBRSxJQUFGLENBQU8sS0FEbEIsR0FDMEIsS0FEMUIsR0FFQSxNQUZBLEdBRVUsSUFBSSxDQUFKLEdBQVEsRUFBRSxJQUFGLENBQU8sTUFGekIsR0FFbUMsS0FGbkMsR0FHQSxPQUhBLElBR1csQ0FBQyxJQUFJLENBQUosR0FBUSxLQUFLLElBQUwsR0FBWSxFQUFFLE9BQXRCLEdBQWdDLEtBQUssU0FBdEMsSUFDRCxFQUFFLElBQUYsQ0FBTyxLQUROLEdBQ2MsRUFBRSxRQUozQixJQUl1QyxLQUp2QyxHQUtBLFFBTFI7O0FBT0EsU0FBTyxJQUFQO0FBQ0QsQ0ExRkQ7O0FBNEZBLFVBQVUsU0FBVixDQUFvQixNQUFwQixHQUE2QixZQUFXO0FBQ3RDLE1BQUksT0FBTyxLQUFLLEdBQUwsQ0FBUyxLQUFLLE1BQWQsQ0FBWDs7QUFFQSxNQUFJLFNBQVMsS0FBSyxJQUFsQixFQUF3QjtBQUN0QixTQUFLLElBQUwsR0FBWSxJQUFaO0FBQ0EsUUFBSSxJQUFKLENBQVMsSUFBVCxFQUFlLElBQWY7QUFDRDtBQUNGLENBUEQ7O0FBU0EsVUFBVSxTQUFWLENBQW9CLEtBQXBCLEdBQTRCLFlBQVc7QUFDckMsTUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQjtBQUNkLFlBQVE7QUFETSxHQUFoQjtBQUdELENBSkQ7Ozs7O0FDeEhBLElBQUksTUFBTSxRQUFRLGVBQVIsQ0FBVjtBQUNBLElBQUksTUFBTSxRQUFRLGNBQVIsQ0FBVjtBQUNBLElBQUksT0FBTyxRQUFRLFFBQVIsQ0FBWDs7QUFFQSxPQUFPLE9BQVAsR0FBaUIsU0FBakI7O0FBRUEsU0FBUyxTQUFULENBQW1CLE1BQW5CLEVBQTJCO0FBQ3pCLE9BQUssSUFBTCxDQUFVLElBQVYsRUFBZ0IsTUFBaEI7QUFDQSxPQUFLLElBQUwsR0FBWSxPQUFaO0FBQ0EsT0FBSyxHQUFMLEdBQVcsSUFBSSxJQUFJLEtBQVIsQ0FBWDtBQUNEOztBQUVELFVBQVUsU0FBVixDQUFvQixTQUFwQixHQUFnQyxLQUFLLFNBQXJDOztBQUVBLFVBQVUsU0FBVixDQUFvQixHQUFwQixHQUEwQixVQUFTLE1BQVQsRUFBaUI7QUFDekMsTUFBSSxNQUFKLENBQVcsTUFBWCxFQUFtQixJQUFuQjtBQUNELENBRkQ7O0FBSUEsVUFBVSxTQUFWLENBQW9CLE1BQXBCLEdBQTZCLFlBQVc7QUFDdEMsTUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQjtBQUNkLGFBQVMsQ0FBQyxLQUFLLE1BQUwsQ0FBWSxRQURSO0FBRWQsVUFBTSxLQUFLLE1BQUwsQ0FBWSxPQUFaLENBQW9CLENBQXBCLEdBQXdCLEtBQUssTUFBTCxDQUFZLFFBRjVCO0FBR2QsU0FBSyxLQUFLLE1BQUwsQ0FBWSxPQUFaLENBQW9CLENBQXBCLEdBQXdCLENBSGY7QUFJZCxZQUFRLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBakIsR0FBMEI7QUFKcEIsR0FBaEI7QUFNRCxDQVBEOztBQVNBLFVBQVUsU0FBVixDQUFvQixLQUFwQixHQUE0QixZQUFXO0FBQ3JDLE1BQUksS0FBSixDQUFVLElBQVYsRUFBZ0I7QUFDZCxhQUFTLENBREs7QUFFZCxVQUFNLENBRlE7QUFHZCxTQUFLLENBSFM7QUFJZCxZQUFRO0FBSk0sR0FBaEI7QUFNRCxDQVBEOzs7OztBQzNCQSxJQUFJLFFBQVEsUUFBUSxpQkFBUixDQUFaO0FBQ0EsSUFBSSxNQUFNLFFBQVEsZUFBUixDQUFWO0FBQ0EsSUFBSSxNQUFNLFFBQVEsY0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsUUFBUixDQUFYOztBQUVBLElBQUksaUJBQWlCO0FBQ25CLGFBQVcsQ0FBQyxHQUFELEVBQU0sRUFBTixDQURRO0FBRW5CLFVBQVEsQ0FBQyxDQUFELEVBQUksQ0FBSjtBQUZXLENBQXJCOztBQUtBLE9BQU8sT0FBUCxHQUFpQixRQUFqQjs7QUFFQSxTQUFTLFFBQVQsQ0FBa0IsTUFBbEIsRUFBMEI7QUFDeEIsT0FBSyxJQUFMLENBQVUsSUFBVixFQUFnQixNQUFoQjs7QUFFQSxPQUFLLElBQUwsR0FBWSxNQUFaO0FBQ0EsT0FBSyxHQUFMLEdBQVcsSUFBSSxJQUFJLElBQVIsQ0FBWDtBQUNBLE9BQUssS0FBTCxHQUFhLEVBQWI7QUFDQSxPQUFLLE1BQUwsR0FBYyxFQUFFLEtBQUssQ0FBUCxFQUFVLE1BQU0sQ0FBaEIsRUFBZDtBQUNEOztBQUVELFNBQVMsU0FBVCxDQUFtQixTQUFuQixHQUErQixLQUFLLFNBQXBDOztBQUVBLFNBQVMsU0FBVCxDQUFtQixHQUFuQixHQUF5QixVQUFTLE1BQVQsRUFBaUI7QUFDeEMsT0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNELENBRkQ7O0FBSUEsU0FBUyxTQUFULENBQW1CLFdBQW5CLEdBQWlDLFlBQVc7QUFDMUMsT0FBSyxLQUFMLENBQVcsT0FBWCxDQUFtQjtBQUFBLFdBQVEsS0FBSyxNQUFMLEVBQVI7QUFBQSxHQUFuQjtBQUNELENBRkQ7O0FBSUEsU0FBUyxTQUFULENBQW1CLFVBQW5CLEdBQWdDLFVBQVMsS0FBVCxFQUFnQjtBQUM5QyxNQUFJLE9BQU8sSUFBSSxJQUFKLENBQVMsSUFBVCxFQUFlLEtBQWYsQ0FBWDtBQUNBLE9BQUssS0FBTCxDQUFXLElBQVgsQ0FBZ0IsSUFBaEI7QUFDQSxPQUFLLE1BQUw7QUFDQSxPQUFLLE1BQUw7QUFDRCxDQUxEOztBQU9BLFNBQVMsU0FBVCxDQUFtQixVQUFuQixHQUFnQyxVQUFTLElBQVQsRUFBZTtBQUM3QyxPQUFLLGlCQUFMLENBQXVCLENBQUMsQ0FBRCxFQUFHLENBQUgsQ0FBdkI7QUFDQSxNQUFJLEtBQUssS0FBTCxHQUFhLENBQWpCLEVBQW9CLEtBQUssWUFBTCxDQUFrQixJQUFsQixFQUFwQixLQUNLLElBQUksS0FBSyxLQUFMLEdBQWEsQ0FBakIsRUFBb0IsS0FBSyxZQUFMLENBQWtCLElBQWxCLEVBQXBCLEtBQ0EsS0FBSyxVQUFMLENBQWdCLElBQWhCO0FBQ04sQ0FMRDs7QUFPQSxTQUFTLFNBQVQsQ0FBbUIsVUFBbkIsR0FBZ0MsWUFBVztBQUFBOztBQUN6QyxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksWUFBWixDQUF5QixDQUFDLENBQUQsRUFBRyxDQUFILENBQXpCLENBQVg7QUFDQSxNQUFJLFVBQVUsS0FBSyxZQUFMLENBQWtCLElBQWxCLENBQWQ7QUFDQSxNQUFJLGFBQWEsTUFBTSxHQUFOLENBQVUsSUFBVixFQUFnQixLQUFLLEtBQXJCLENBQWpCO0FBQ0EsYUFBVyxPQUFYLENBQW1CO0FBQUEsV0FBUyxNQUFLLFVBQUwsQ0FBZ0IsS0FBaEIsQ0FBVDtBQUFBLEdBQW5CO0FBQ0EsVUFBUSxPQUFSLENBQWdCO0FBQUEsV0FBUSxLQUFLLE1BQUwsRUFBUjtBQUFBLEdBQWhCO0FBQ0QsQ0FORDs7QUFRQSxTQUFTLFNBQVQsQ0FBbUIsWUFBbkIsR0FBa0MsVUFBUyxJQUFULEVBQWU7QUFDL0MsTUFBSSxRQUFRLEtBQUssS0FBTCxDQUFXLEtBQVgsRUFBWjtBQUNBLE9BQUssSUFBSSxJQUFJLENBQWIsRUFBZ0IsSUFBSSxNQUFNLE1BQTFCLEVBQWtDLEdBQWxDLEVBQXVDO0FBQ3JDLFFBQUksT0FBTyxNQUFNLENBQU4sQ0FBWDtBQUNBLFFBQUksS0FBSyxDQUFMLElBQVUsS0FBSyxLQUFMLENBQVcsQ0FBWCxDQUFWLElBQTJCLEtBQUssQ0FBTCxJQUFVLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBekMsRUFBd0Q7QUFDdEQsV0FBSyxVQUFMLENBQWdCLElBQWhCO0FBQ0QsS0FGRCxNQUdLLElBQUksS0FBSyxDQUFMLElBQVUsS0FBSyxJQUFmLElBQXVCLEtBQUssQ0FBTCxLQUFXLEtBQUssSUFBM0MsRUFBaUQ7QUFDcEQsV0FBSyxDQUFMLElBQVUsS0FBSyxJQUFMLEdBQVksQ0FBdEI7QUFDQSxXQUFLLEtBQUw7QUFDQSxXQUFLLFVBQUwsQ0FBZ0IsQ0FBQyxLQUFLLElBQU4sRUFBWSxLQUFLLElBQWpCLENBQWhCO0FBQ0QsS0FKSSxNQUtBLElBQUksS0FBSyxDQUFMLE1BQVksS0FBSyxJQUFqQixJQUF5QixLQUFLLENBQUwsTUFBWSxLQUFLLElBQTlDLEVBQW9EO0FBQ3ZELFdBQUssTUFBTDtBQUNELEtBRkksTUFHQSxJQUFJLEtBQUssQ0FBTCxNQUFZLEtBQUssSUFBakIsSUFBeUIsS0FBSyxDQUFMLElBQVUsS0FBSyxJQUE1QyxFQUFrRDtBQUNyRCxXQUFLLFVBQUwsQ0FBZ0IsSUFBaEI7QUFDQSxXQUFLLFVBQUwsQ0FBZ0IsQ0FBQyxLQUFLLElBQU4sRUFBWSxLQUFLLElBQWpCLENBQWhCO0FBQ0QsS0FISSxNQUlBLElBQUksS0FBSyxDQUFMLElBQVUsS0FBSyxJQUFmLElBQXVCLEtBQUssQ0FBTCxJQUFVLEtBQUssS0FBZixJQUF3QixLQUFLLElBQXhELEVBQThEO0FBQ2pFLFVBQUksU0FBUyxLQUFLLElBQUwsSUFBYSxLQUFLLENBQUwsSUFBVSxLQUFLLEtBQTVCLElBQXFDLENBQWxEO0FBQ0EsV0FBSyxDQUFMLEtBQVcsS0FBSyxLQUFMLEdBQWEsTUFBeEI7QUFDQSxXQUFLLENBQUwsS0FBVyxLQUFLLEtBQUwsR0FBYSxNQUF4QjtBQUNBLFdBQUssTUFBTCxDQUFZLE1BQVo7QUFDQSxVQUFJLEtBQUssQ0FBTCxLQUFXLEtBQUssQ0FBTCxDQUFmLEVBQXdCLEtBQUssVUFBTCxDQUFnQixJQUFoQjtBQUN6QixLQU5JLE1BT0EsSUFBSSxLQUFLLENBQUwsSUFBVSxLQUFLLElBQW5CLEVBQXlCO0FBQzVCLFdBQUssQ0FBTCxLQUFXLEtBQUssS0FBaEI7QUFDQSxXQUFLLENBQUwsS0FBVyxLQUFLLEtBQWhCO0FBQ0EsV0FBSyxLQUFMO0FBQ0Q7QUFDRjtBQUNELE9BQUssVUFBTDtBQUNELENBakNEOztBQW1DQSxTQUFTLFNBQVQsQ0FBbUIsWUFBbkIsR0FBa0MsVUFBUyxJQUFULEVBQWU7QUFDL0MsTUFBSSxRQUFRLEtBQUssS0FBTCxDQUFXLEtBQVgsRUFBWjtBQUNBLE9BQUssSUFBSSxJQUFJLENBQWIsRUFBZ0IsSUFBSSxNQUFNLE1BQTFCLEVBQWtDLEdBQWxDLEVBQXVDO0FBQ3JDLFFBQUksT0FBTyxNQUFNLENBQU4sQ0FBWDtBQUNBLFFBQUksS0FBSyxDQUFMLElBQVUsS0FBSyxJQUFmLElBQXVCLEtBQUssQ0FBTCxLQUFXLEtBQUssSUFBM0MsRUFBaUQ7QUFDL0MsV0FBSyxDQUFMLElBQVUsS0FBSyxJQUFMLEdBQVksQ0FBdEI7QUFDQSxXQUFLLEtBQUw7QUFDQSxXQUFLLFVBQUwsQ0FBZ0IsS0FBSyxLQUFyQjtBQUNELEtBSkQsTUFLSyxJQUFJLEtBQUssQ0FBTCxNQUFZLEtBQUssSUFBckIsRUFBMkI7QUFDOUIsV0FBSyxNQUFMO0FBQ0QsS0FGSSxNQUdBLElBQUksS0FBSyxDQUFMLElBQVUsS0FBSyxJQUFuQixFQUF5QjtBQUM1QixXQUFLLENBQUwsS0FBVyxLQUFLLEtBQWhCO0FBQ0EsV0FBSyxDQUFMLEtBQVcsS0FBSyxLQUFoQjtBQUNBLFdBQUssS0FBTDtBQUNEO0FBQ0Y7QUFDRCxPQUFLLFVBQUw7QUFDRCxDQW5CRDs7QUFxQkEsU0FBUyxTQUFULENBQW1CLFVBQW5CLEdBQWdDLFVBQVMsSUFBVCxFQUFlO0FBQzdDLE1BQUksUUFBUSxLQUFLLEtBQUwsQ0FBVyxLQUFYLEVBQVo7QUFDQSxPQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksTUFBTSxNQUExQixFQUFrQyxHQUFsQyxFQUF1QztBQUNyQyxRQUFJLE9BQU8sTUFBTSxDQUFOLENBQVg7QUFDQSxRQUFJLEtBQUssQ0FBTCxNQUFZLEtBQUssSUFBakIsSUFBeUIsS0FBSyxDQUFMLE1BQVksS0FBSyxJQUE5QyxFQUFvRDtBQUNsRCxXQUFLLE1BQUw7QUFDRCxLQUZELE1BR0ssSUFBSSxLQUFLLENBQUwsS0FBVyxLQUFLLElBQWhCLElBQXdCLEtBQUssQ0FBTCxLQUFXLEtBQUssSUFBNUMsRUFBa0Q7QUFDckQsV0FBSyxDQUFMLElBQVUsS0FBSyxJQUFMLEdBQVksQ0FBdEI7QUFDQSxVQUFJLEtBQUssQ0FBTCxJQUFVLEtBQUssQ0FBTCxDQUFkLEVBQXVCLEtBQUssVUFBTCxDQUFnQixJQUFoQixFQUF2QixLQUNLLEtBQUssS0FBTDtBQUNMLFdBQUssVUFBTCxDQUFnQixLQUFLLEtBQXJCO0FBQ0Q7QUFDRjtBQUNELE9BQUssVUFBTDtBQUNELENBZkQ7O0FBaUJBLFNBQVMsU0FBVCxDQUFtQixVQUFuQixHQUFnQyxVQUFTLElBQVQsRUFBZTtBQUM3QyxPQUFLLEtBQUw7QUFDQSxPQUFLLEtBQUwsQ0FBVyxNQUFYLENBQWtCLEtBQUssS0FBTCxDQUFXLE9BQVgsQ0FBbUIsSUFBbkIsQ0FBbEIsRUFBNEMsQ0FBNUM7QUFDRCxDQUhEOztBQUtBLFNBQVMsU0FBVCxDQUFtQixpQkFBbkIsR0FBdUMsVUFBUyxLQUFULEVBQWdCO0FBQUE7O0FBQ3JELE9BQUssYUFBTCxDQUFtQixLQUFLLE1BQUwsQ0FBWSxZQUFaLENBQXlCLEtBQXpCLENBQW5CLEVBQ0csT0FESCxDQUNXO0FBQUEsV0FBUSxPQUFLLFVBQUwsQ0FBZ0IsSUFBaEIsQ0FBUjtBQUFBLEdBRFg7QUFFRCxDQUhEOztBQUtBLFNBQVMsU0FBVCxDQUFtQixZQUFuQixHQUFrQyxVQUFTLEtBQVQsRUFBZ0I7QUFDaEQsTUFBSSxRQUFRLEVBQVo7QUFDQSxPQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksS0FBSyxLQUFMLENBQVcsTUFBL0IsRUFBdUMsR0FBdkMsRUFBNEM7QUFDMUMsUUFBSSxPQUFPLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBWDtBQUNBLFFBQUssS0FBSyxDQUFMLEtBQVcsTUFBTSxDQUFOLENBQVgsSUFBdUIsS0FBSyxDQUFMLEtBQVcsTUFBTSxDQUFOLENBQWxDLElBQ0EsS0FBSyxDQUFMLEtBQVcsTUFBTSxDQUFOLENBQVgsSUFBdUIsS0FBSyxDQUFMLEtBQVcsTUFBTSxDQUFOLENBRHZDLEVBQ2tEO0FBQ2hELFlBQU0sSUFBTixDQUFXLElBQVg7QUFDRDtBQUNGO0FBQ0QsU0FBTyxLQUFQO0FBQ0QsQ0FWRDs7QUFZQSxTQUFTLFNBQVQsQ0FBbUIsYUFBbkIsR0FBbUMsVUFBUyxLQUFULEVBQWdCO0FBQ2pELE1BQUksUUFBUSxFQUFaO0FBQ0EsT0FBSyxJQUFJLElBQUksQ0FBYixFQUFnQixJQUFJLEtBQUssS0FBTCxDQUFXLE1BQS9CLEVBQXVDLEdBQXZDLEVBQTRDO0FBQzFDLFFBQUksT0FBTyxLQUFLLEtBQUwsQ0FBVyxDQUFYLENBQVg7QUFDQSxRQUFLLEtBQUssQ0FBTCxJQUFVLE1BQU0sQ0FBTixDQUFWLElBQ0EsS0FBSyxDQUFMLElBQVUsTUFBTSxDQUFOLENBRGYsRUFDMEI7QUFDeEIsWUFBTSxJQUFOLENBQVcsSUFBWDtBQUNEO0FBQ0Y7QUFDRCxTQUFPLEtBQVA7QUFDRCxDQVZEOztBQVlBLFNBQVMsU0FBVCxDQUFtQixNQUFuQixHQUE0QixZQUFvQjtBQUFBOztBQUFBLE1BQVgsSUFBVyx1RUFBSixFQUFJOztBQUM5QyxNQUFJLEtBQUssTUFBVCxFQUFpQixLQUFLLE1BQUwsR0FBYyxLQUFLLE1BQW5CO0FBQ2pCOztBQUVBLE1BQUksT0FBTyxLQUFLLE1BQUwsQ0FBWSxZQUFaLENBQXlCLENBQUMsQ0FBRCxFQUFHLENBQUgsQ0FBekIsQ0FBWDs7QUFFQSxNQUFJLE1BQU0sR0FBTixDQUFVLElBQVYsRUFBZ0IsS0FBSyxLQUFyQixFQUE0QixNQUE1QixLQUF1QyxDQUEzQyxFQUE4QztBQUM1QztBQUNEOztBQUVELE1BQUksTUFBTSxHQUFOLENBQVUsSUFBVixFQUFnQixLQUFLLEtBQXJCLEVBQTRCLE1BQTVCLEtBQXVDLENBQTNDLEVBQThDO0FBQzVDLFNBQUssaUJBQUwsQ0FBdUIsQ0FBQyxDQUFELEVBQUcsQ0FBSCxDQUF2QjtBQUNBLFNBQUssVUFBTCxDQUFnQixJQUFoQjtBQUNBO0FBQ0Q7O0FBRUQ7QUFDQSxNQUFJLFlBQVksS0FBSyxNQUFMLENBQVksZ0JBQVosR0FDWixDQUFDLENBQUMsZUFBZSxTQUFmLENBQXlCLENBQXpCLENBQUYsRUFBK0IsQ0FBQyxlQUFlLFNBQWYsQ0FBeUIsQ0FBekIsQ0FBaEMsQ0FEWSxHQUVaLENBQUMsQ0FBQyxlQUFlLE1BQWYsQ0FBc0IsQ0FBdEIsQ0FBRixFQUE0QixDQUFDLGVBQWUsTUFBZixDQUFzQixDQUF0QixDQUE3QixDQUZKOztBQUlBLE1BQUksYUFBYSxLQUFLLE1BQUwsQ0FBWSxZQUFaLENBQXlCLFNBQXpCLENBQWpCO0FBQ0EsTUFBSSxrQkFBa0IsTUFBTSxHQUFOLENBQVUsVUFBVixFQUFzQixLQUFLLEtBQTNCLENBQXRCO0FBQ0EsTUFBSSxnQkFBZ0IsTUFBcEIsRUFBNEI7QUFDMUI7QUFDQTs7QUFFQSxnQkFBWSxLQUFLLE1BQUwsQ0FBWSxnQkFBWixHQUNSLENBQUMsQ0FBQyxlQUFlLFNBQWYsQ0FBeUIsQ0FBekIsQ0FBRixFQUErQixDQUFDLGVBQWUsU0FBZixDQUF5QixDQUF6QixDQUFoQyxDQURRLEdBRVIsQ0FBQyxDQUFDLGVBQWUsTUFBZixDQUFzQixDQUF0QixDQUFGLEVBQTRCLENBQUMsZUFBZSxNQUFmLENBQXNCLENBQXRCLENBQTdCLENBRko7O0FBSUEsU0FBSyxpQkFBTCxDQUF1QixTQUF2Qjs7QUFFQSxpQkFBYSxLQUFLLE1BQUwsQ0FBWSxZQUFaLENBQXlCLFNBQXpCLENBQWI7QUFDQSxzQkFBa0IsTUFBTSxHQUFOLENBQVUsVUFBVixFQUFzQixLQUFLLEtBQTNCLENBQWxCO0FBQ0Esb0JBQWdCLE9BQWhCLENBQXdCLGlCQUFTO0FBQy9CLGFBQUssVUFBTCxDQUFnQixLQUFoQjtBQUNELEtBRkQ7QUFHRDtBQUNGLENBdkNEOztBQXlDQSxTQUFTLFNBQVQsQ0FBbUIsS0FBbkIsR0FBMkIsWUFBVztBQUNwQyxPQUFLLEtBQUwsQ0FBVyxPQUFYLENBQW1CO0FBQUEsV0FBUSxLQUFLLEtBQUwsRUFBUjtBQUFBLEdBQW5CO0FBQ0EsT0FBSyxLQUFMLEdBQWEsRUFBYjtBQUNELENBSEQ7O0FBS0EsU0FBUyxJQUFULENBQWMsSUFBZCxFQUFvQixLQUFwQixFQUEyQjtBQUN6QixPQUFLLElBQUwsR0FBWSxJQUFaO0FBQ0EsT0FBSyxHQUFMLEdBQVcsSUFBSSxJQUFJLElBQVIsQ0FBWDtBQUNBLE9BQUssSUFBTCxHQUFZLEVBQVo7QUFDQSxPQUFLLFNBQUwsR0FBaUIsQ0FBakI7QUFDQSxPQUFLLENBQUwsSUFBVSxNQUFNLENBQU4sQ0FBVjtBQUNBLE9BQUssQ0FBTCxJQUFVLE1BQU0sQ0FBTixDQUFWOztBQUVBLE1BQUksUUFBUSxFQUFaOztBQUVBLE1BQUksS0FBSyxJQUFMLENBQVUsTUFBVixDQUFpQixPQUFqQixDQUF5QixZQUF6QixJQUNELENBQUMsS0FBSyxJQUFMLENBQVUsTUFBVixDQUFpQixPQUFqQixDQUF5QixZQUF6QixDQUFzQyxPQUF0QyxDQUE4QyxLQUFLLElBQUwsQ0FBVSxJQUF4RCxDQURKLEVBQ21FO0FBQ2pFLFVBQU0sVUFBTixHQUFtQixNQUNqQixDQUFDLEtBQUssTUFBTCxLQUFnQixFQUFoQixHQUFxQixDQUF0QixFQUF5QixRQUF6QixDQUFrQyxFQUFsQyxDQURpQixHQUVqQixDQUFDLEtBQUssTUFBTCxLQUFnQixFQUFoQixHQUFxQixDQUF0QixFQUF5QixRQUF6QixDQUFrQyxFQUFsQyxDQUZpQixHQUdqQixDQUFDLEtBQUssTUFBTCxLQUFnQixFQUFoQixHQUFxQixDQUF0QixFQUF5QixRQUF6QixDQUFrQyxFQUFsQyxDQUhGO0FBSUEsVUFBTSxPQUFOLEdBQWdCLEdBQWhCO0FBQ0Q7O0FBRUQsTUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQixLQUFoQjtBQUNEOztBQUVELEtBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsVUFBUyxDQUFULEVBQVk7QUFDbEMsT0FBSyxTQUFMLElBQWtCLENBQWxCO0FBQ0EsT0FBSyxJQUFMLEdBQVksS0FBSyxJQUFMLENBQVUsS0FBVixDQUFnQixLQUFoQixFQUF1QixLQUF2QixDQUE2QixDQUE3QixFQUFnQyxJQUFoQyxDQUFxQyxJQUFyQyxDQUFaO0FBQ0EsT0FBSyxDQUFMLEtBQVcsQ0FBWDtBQUNBLE9BQUssS0FBTDtBQUNBLE9BQUssR0FBTCxDQUFTLEVBQVQsQ0FBWSxTQUFaLEdBQXdCLEtBQUssU0FBTCxHQUFpQixLQUFLLElBQUwsQ0FBVSxNQUFWLENBQWlCLElBQWpCLENBQXNCLE1BQS9EO0FBQ0QsQ0FORDs7QUFRQSxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFlBQVc7QUFDakMsTUFBSSxNQUFKLENBQVcsS0FBSyxJQUFMLENBQVUsTUFBckIsRUFBNkIsSUFBN0I7QUFDRCxDQUZEOztBQUlBLEtBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsWUFBVztBQUNqQyxNQUFJLE9BQU8sS0FBSyxJQUFMLENBQVUsTUFBVixDQUFpQixNQUFqQixDQUF3QixHQUF4QixDQUE0QixJQUE1QixDQUFYO0FBQ0EsTUFBSSxTQUFTLEtBQUssSUFBbEIsRUFBd0I7QUFDdEIsUUFBSSxJQUFKLENBQVMsSUFBVCxFQUFlLElBQWY7QUFDQSxTQUFLLElBQUwsR0FBWSxJQUFaO0FBQ0Q7QUFDRCxPQUFLLEtBQUw7QUFDRCxDQVBEOztBQVNBLEtBQUssU0FBTCxDQUFlLEtBQWYsR0FBdUIsWUFBVztBQUNoQyxNQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsWUFBUSxDQUFDLEtBQUssQ0FBTCxJQUFVLEtBQUssQ0FBTCxDQUFWLEdBQW9CLENBQXJCLElBQTBCLEtBQUssSUFBTCxDQUFVLE1BQVYsQ0FBaUIsSUFBakIsQ0FBc0IsTUFEMUM7QUFFZCxTQUFLLEtBQUssQ0FBTCxJQUFVLEtBQUssSUFBTCxDQUFVLE1BQVYsQ0FBaUIsSUFBakIsQ0FBc0IsTUFBaEMsR0FDRixLQUFLLElBQUwsQ0FBVSxNQUFWLENBQWlCO0FBSE4sR0FBaEI7QUFLRCxDQU5EOztBQVFBLEtBQUssU0FBTCxDQUFlLEtBQWYsR0FBdUIsWUFBVztBQUNoQyxNQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsWUFBUTtBQURNLEdBQWhCO0FBR0EsbUJBQWlCLElBQWpCO0FBQ0QsQ0FMRDs7QUFPQSxJQUFJLHNCQUFzQixFQUExQjtBQUNBLElBQUksYUFBSjs7QUFFQSxTQUFTLGdCQUFULENBQTBCLEVBQTFCLEVBQThCO0FBQzVCLHNCQUFvQixJQUFwQixDQUF5QixFQUF6QjtBQUNBLGVBQWEsYUFBYjtBQUNBLE1BQUksb0JBQW9CLE1BQXBCLEdBQTZCLEVBQWpDLEVBQXFDO0FBQ25DLFdBQU8saUJBQVA7QUFDRDtBQUNELGtCQUFnQixXQUFXLGVBQVgsRUFBNEIsR0FBNUIsQ0FBaEI7QUFDRDs7QUFFRCxTQUFTLGVBQVQsR0FBMkI7QUFDekIsTUFBSSxFQUFKO0FBQ0EsU0FBTyxLQUFLLG9CQUFvQixHQUFwQixFQUFaLEVBQXVDO0FBQ3JDLFFBQUksTUFBSixDQUFXLEVBQVg7QUFDRDtBQUNGOzs7OztBQ3pSRCxJQUFJLE1BQU0sUUFBUSxlQUFSLENBQVY7QUFDQSxJQUFJLE1BQU0sUUFBUSxjQUFSLENBQVY7QUFDQSxJQUFJLE9BQU8sUUFBUSxRQUFSLENBQVg7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLFFBQWpCOztBQUVBLFNBQVMsUUFBVCxDQUFrQixNQUFsQixFQUEwQjtBQUN4QixPQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWdCLE1BQWhCO0FBQ0EsT0FBSyxJQUFMLEdBQVksTUFBWjtBQUNBLE9BQUssR0FBTCxHQUFXLElBQUksSUFBSSxJQUFSLENBQVg7QUFDRDs7QUFFRCxTQUFTLFNBQVQsQ0FBbUIsU0FBbkIsR0FBK0IsS0FBSyxTQUFwQzs7QUFFQSxTQUFTLFNBQVQsQ0FBbUIsR0FBbkIsR0FBeUIsVUFBUyxNQUFULEVBQWlCO0FBQ3hDLE1BQUksTUFBSixDQUFXLE1BQVgsRUFBbUIsSUFBbkI7QUFDRCxDQUZEOztBQUlBLFNBQVMsU0FBVCxDQUFtQixHQUFuQixHQUF5QixVQUFTLEtBQVQsRUFBZ0IsQ0FBaEIsRUFBbUI7QUFDMUMsTUFBSSxVQUFVLEVBQUUsV0FBaEI7O0FBRUEsTUFBSSxRQUFRLENBQVo7QUFDQSxNQUFJLE1BQU0sUUFBUSxNQUFsQjtBQUNBLE1BQUksT0FBTyxDQUFDLENBQVo7QUFDQSxNQUFJLElBQUksQ0FBQyxDQUFUOztBQUVBLEtBQUc7QUFDRCxXQUFPLENBQVA7QUFDQSxRQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQVAsSUFBZ0IsQ0FBeEIsR0FBNEIsQ0FBaEM7QUFDQSxRQUFJLFFBQVEsQ0FBUixFQUFXLENBQVgsR0FBZSxNQUFNLENBQU4sSUFBVyxDQUE5QixFQUFpQyxRQUFRLENBQVIsQ0FBakMsS0FDSyxNQUFNLENBQU47QUFDTixHQUxELFFBS1MsU0FBUyxDQUxsQjs7QUFPQSxNQUFJLFFBQVEsRUFBRSxTQUFGLENBQVksTUFBWixHQUFxQixFQUFFLElBQUYsQ0FBTyxLQUE1QixHQUFvQyxJQUFoRDs7QUFFQSxNQUFJLE9BQU8sRUFBWDtBQUNBLE1BQUksSUFBSjtBQUNBLE1BQUksQ0FBSjtBQUNBLFNBQU8sUUFBUSxDQUFSLEtBQWMsUUFBUSxDQUFSLEVBQVcsQ0FBWCxHQUFlLE1BQU0sQ0FBTixDQUFwQyxFQUE4QztBQUM1QyxRQUFJLFFBQVEsR0FBUixDQUFKO0FBQ0EsV0FBTyxFQUFFLFlBQUYsQ0FBZSxDQUFmLENBQVA7QUFDQSxZQUFRLGVBQ0EsUUFEQSxHQUNXLEtBRFgsR0FDbUIsR0FEbkIsR0FFQSxNQUZBLEdBRVUsRUFBRSxDQUFGLEdBQU0sRUFBRSxJQUFGLENBQU8sTUFGdkIsR0FFaUMsS0FGakMsR0FHQSxPQUhBLElBR1csQ0FBQyxFQUFFLENBQUYsR0FBTSxLQUFLLElBQUwsR0FBWSxFQUFFLE9BQXBCLEdBQThCLEtBQUssU0FBcEMsSUFDRCxFQUFFLElBQUYsQ0FBTyxLQUROLEdBQ2MsRUFBRSxNQURoQixHQUN5QixFQUFFLE9BQUYsQ0FBVSxXQUo5QyxJQUk2RCxLQUo3RCxHQUtBLFFBTFI7QUFNRDs7QUFFRCxTQUFPLElBQVA7QUFDRCxDQWhDRDs7QUFrQ0EsU0FBUyxTQUFULENBQW1CLE1BQW5CLEdBQTRCLFlBQVc7QUFDckMsTUFBSSxDQUFDLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBbEIsSUFBNEIsQ0FBQyxLQUFLLE1BQUwsQ0FBWSxXQUFaLENBQXdCLE1BQXpELEVBQWlFOztBQUVqRSxNQUFJLE9BQU8sS0FBSyxNQUFMLENBQVksWUFBWixDQUF5QixDQUFDLENBQUMsRUFBRixFQUFLLENBQUMsRUFBTixDQUF6QixDQUFYO0FBQ0EsTUFBSSxPQUFPLEtBQUssR0FBTCxDQUFTLElBQVQsRUFBZSxLQUFLLE1BQXBCLENBQVg7O0FBRUEsTUFBSSxJQUFKLENBQVMsSUFBVCxFQUFlLElBQWY7QUFDRCxDQVBEOztBQVNBLFNBQVMsU0FBVCxDQUFtQixLQUFuQixHQUEyQixZQUFXO0FBQ3BDLE1BQUksSUFBSixDQUFTLElBQVQsRUFBZSxFQUFmO0FBQ0QsQ0FGRDs7Ozs7QUM3REEsSUFBSSxZQUFZLFFBQVEsU0FBUixDQUFoQjtBQUNBLElBQUksV0FBVyxRQUFRLFFBQVIsQ0FBZjtBQUNBLElBQUksV0FBVyxRQUFRLFFBQVIsQ0FBZjtBQUNBLElBQUksWUFBWSxRQUFRLFNBQVIsQ0FBaEI7QUFDQSxJQUFJLFlBQVksUUFBUSxTQUFSLENBQWhCO0FBQ0EsSUFBSSxXQUFXLFFBQVEsUUFBUixDQUFmO0FBQ0EsSUFBSSxXQUFXLFFBQVEsUUFBUixDQUFmOztBQUVBLE9BQU8sT0FBUCxHQUFpQixLQUFqQjs7QUFFQSxTQUFTLEtBQVQsQ0FBZSxNQUFmLEVBQXVCO0FBQUE7O0FBQ3JCLE9BQUssTUFBTCxHQUFjLE1BQWQ7O0FBRUEsT0FBSyxLQUFMLEdBQWEsQ0FDWCxJQUFJLFNBQUosQ0FBYyxNQUFkLENBRFcsRUFFWCxJQUFJLFFBQUosQ0FBYSxNQUFiLENBRlcsRUFHWCxJQUFJLFFBQUosQ0FBYSxNQUFiLENBSFcsRUFJWCxJQUFJLFNBQUosQ0FBYyxNQUFkLENBSlcsRUFLWCxJQUFJLFNBQUosQ0FBYyxNQUFkLENBTFcsRUFNWCxJQUFJLFFBQUosQ0FBYSxNQUFiLENBTlcsRUFPWCxJQUFJLFFBQUosQ0FBYSxNQUFiLENBUFcsQ0FBYjs7QUFVQSxPQUFLLEtBQUwsQ0FBVyxPQUFYLENBQW1CO0FBQUEsV0FBUSxNQUFLLEtBQUssSUFBVixJQUFrQixJQUExQjtBQUFBLEdBQW5CO0FBQ0EsT0FBSyxPQUFMLEdBQWUsS0FBSyxLQUFMLENBQVcsT0FBWCxDQUFtQixJQUFuQixDQUF3QixLQUFLLEtBQTdCLENBQWY7QUFDRDs7QUFFRCxNQUFNLFNBQU4sQ0FBZ0IsR0FBaEIsR0FBc0IsVUFBUyxFQUFULEVBQWE7QUFDakMsT0FBSyxPQUFMLENBQWE7QUFBQSxXQUFRLEtBQUssR0FBTCxDQUFTLEVBQVQsQ0FBUjtBQUFBLEdBQWI7QUFDRCxDQUZEOztBQUlBLE1BQU0sU0FBTixDQUFnQixNQUFoQixHQUF5QixZQUFXO0FBQ2xDLE9BQUssT0FBTCxDQUFhO0FBQUEsV0FBUSxLQUFLLE1BQUwsRUFBUjtBQUFBLEdBQWI7QUFDRCxDQUZEOztBQUlBLE1BQU0sU0FBTixDQUFnQixLQUFoQixHQUF3QixZQUFXO0FBQ2pDLE9BQUssT0FBTCxDQUFhO0FBQUEsV0FBUSxLQUFLLEtBQUwsRUFBUjtBQUFBLEdBQWI7QUFDRCxDQUZEOzs7OztBQ25DQSxJQUFJLE1BQU0sUUFBUSxlQUFSLENBQVY7QUFDQSxJQUFJLE1BQU0sUUFBUSxjQUFSLENBQVY7QUFDQSxJQUFJLE9BQU8sUUFBUSxRQUFSLENBQVg7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLFFBQWpCOztBQUVBLFNBQVMsUUFBVCxDQUFrQixNQUFsQixFQUEwQjtBQUN4QixPQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWdCLE1BQWhCO0FBQ0EsT0FBSyxJQUFMLEdBQVksTUFBWjtBQUNBLE9BQUssR0FBTCxHQUFXLElBQUksSUFBSSxJQUFSLENBQVg7QUFDRDs7QUFFRCxTQUFTLFNBQVQsQ0FBbUIsU0FBbkIsR0FBK0IsS0FBSyxTQUFwQzs7QUFFQSxTQUFTLFNBQVQsQ0FBbUIsR0FBbkIsR0FBeUIsVUFBUyxNQUFULEVBQWlCO0FBQ3hDLE1BQUksTUFBSixDQUFXLE1BQVgsRUFBbUIsSUFBbkI7QUFDRCxDQUZEOztBQUlBLFNBQVMsU0FBVCxDQUFtQixHQUFuQixHQUF5QixVQUFTLEtBQVQsRUFBZ0IsQ0FBaEIsRUFBbUI7QUFDMUMsTUFBSSxPQUFPLEVBQUUsSUFBRixDQUFPLEdBQVAsRUFBWDtBQUNBLE1BQUksTUFBTSxDQUFOLElBQVcsS0FBSyxHQUFMLENBQVMsQ0FBeEIsRUFBMkIsT0FBTyxLQUFQO0FBQzNCLE1BQUksTUFBTSxDQUFOLElBQVcsS0FBSyxLQUFMLENBQVcsQ0FBMUIsRUFBNkIsT0FBTyxLQUFQOztBQUU3QixNQUFJLFVBQVUsRUFBRSxNQUFGLENBQVMsbUJBQVQsQ0FBNkIsS0FBN0IsQ0FBZDtBQUNBLE1BQUksT0FBTyxFQUFFLE1BQUYsQ0FBUyxrQkFBVCxDQUE0QixJQUE1QixDQUFYO0FBQ0EsTUFBSSxPQUFPLEVBQUUsTUFBRixDQUFTLElBQVQsQ0FBYyxRQUFkLENBQXVCLE9BQXZCLENBQVg7O0FBRUEsT0FBSyxDQUFMLEtBQVcsUUFBUSxDQUFSLENBQVg7QUFDQSxPQUFLLENBQUwsS0FBVyxRQUFRLENBQVIsQ0FBWDs7QUFFQSxNQUFJLFFBQVEsS0FBSyxTQUFMLENBQWUsQ0FBZixFQUFrQixLQUFLLENBQUwsQ0FBbEIsQ0FBWjtBQUNBLE1BQUksU0FBUyxLQUFLLFNBQUwsQ0FBZSxLQUFLLENBQUwsQ0FBZixFQUF3QixLQUFLLENBQUwsQ0FBeEIsQ0FBYjtBQUNBLE1BQUksT0FBTyxNQUFNLE9BQU4sQ0FBYyxRQUFkLEVBQXdCLEdBQXhCLEVBQTZCO0FBQTdCLElBQ1AsUUFETyxHQUNJLE9BQU8sT0FBUCxDQUFlLFFBQWYsRUFBeUIsR0FBekIsQ0FESixHQUNvQyxTQUQvQzs7QUFHQSxTQUFPLEtBQUssT0FBTCxDQUFhLEtBQWIsRUFBb0IsS0FBcEIsQ0FBUDs7QUFFQSxTQUFPLElBQVA7QUFDRCxDQXBCRDs7QUFzQkEsU0FBUyxTQUFULENBQW1CLE1BQW5CLEdBQTRCLFlBQVc7QUFDckMsTUFBSSxDQUFDLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBdEIsRUFBOEIsT0FBTyxLQUFLLEtBQUwsRUFBUDs7QUFFOUIsTUFBSSxPQUFPLEtBQUssTUFBTCxDQUFZLFlBQVosQ0FBeUIsQ0FBQyxDQUFDLEVBQUYsRUFBSyxDQUFDLEVBQU4sQ0FBekIsQ0FBWDtBQUNBLE1BQUksT0FBTyxLQUFLLEdBQUwsQ0FBUyxJQUFULEVBQWUsS0FBSyxNQUFwQixDQUFYOztBQUVBLE1BQUksSUFBSixDQUFTLElBQVQsRUFBZSxJQUFmOztBQUVBLE1BQUksS0FBSixDQUFVLElBQVYsRUFBZ0I7QUFDZCxTQUFLLEtBQUssQ0FBTCxJQUFVLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFEbEI7QUFFZCxZQUFRO0FBRk0sR0FBaEI7QUFJRCxDQVpEOztBQWNBLFNBQVMsU0FBVCxDQUFtQixLQUFuQixHQUEyQixZQUFXO0FBQ3BDLE1BQUksS0FBSixDQUFVLElBQVYsRUFBZ0I7QUFDZCxTQUFLLENBRFM7QUFFZCxZQUFRO0FBRk0sR0FBaEI7QUFJRCxDQUxEOzs7OztBQ3REQSxJQUFJLE1BQU0sUUFBUSxlQUFSLENBQVY7QUFDQSxJQUFJLE1BQU0sUUFBUSxjQUFSLENBQVY7QUFDQSxJQUFJLE9BQU8sUUFBUSxRQUFSLENBQVg7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLFFBQWpCOztBQUVBLFNBQVMsUUFBVCxDQUFrQixNQUFsQixFQUEwQjtBQUN4QixPQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWdCLE1BQWhCO0FBQ0EsT0FBSyxJQUFMLEdBQVksTUFBWjtBQUNBLE9BQUssR0FBTCxHQUFXLElBQUksSUFBSSxJQUFSLENBQVg7QUFDQSxPQUFLLElBQUwsR0FBWSxDQUFDLENBQWI7QUFDQSxPQUFLLEtBQUwsR0FBYSxDQUFDLENBQUMsQ0FBRixFQUFJLENBQUMsQ0FBTCxDQUFiO0FBQ0EsT0FBSyxJQUFMLEdBQVksRUFBWjtBQUNEOztBQUVELFNBQVMsU0FBVCxDQUFtQixTQUFuQixHQUErQixLQUFLLFNBQXBDOztBQUVBLFNBQVMsU0FBVCxDQUFtQixHQUFuQixHQUF5QixVQUFTLE1BQVQsRUFBaUI7QUFDeEMsTUFBSSxNQUFKLENBQVcsTUFBWCxFQUFtQixJQUFuQjtBQUNELENBRkQ7O0FBSUEsU0FBUyxTQUFULENBQW1CLE1BQW5CLEdBQTRCLFlBQVc7QUFDckMsTUFBSSxRQUFRLEtBQUssTUFBTCxDQUFZLFlBQVosQ0FBeUIsQ0FBQyxDQUFDLENBQUYsRUFBSSxDQUFDLENBQUwsQ0FBekIsQ0FBWjs7QUFFQSxNQUFLLE1BQU0sQ0FBTixLQUFZLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FBWixJQUNBLE1BQU0sQ0FBTixLQUFZLEtBQUssS0FBTCxDQUFXLENBQVgsQ0FEWixLQUVFLEtBQUssS0FBTCxDQUFXLENBQVgsTUFBa0IsS0FBSyxJQUF2QixJQUNBLEtBQUssTUFBTCxDQUFZLElBQVosS0FBcUIsS0FBSyxJQUg1QixDQUFMLEVBSUs7O0FBRUwsVUFBUSxLQUFLLE1BQUwsQ0FBWSxZQUFaLENBQXlCLENBQUMsQ0FBQyxDQUFGLEVBQUksQ0FBQyxDQUFMLENBQXpCLENBQVI7QUFDQSxPQUFLLElBQUwsR0FBWSxLQUFLLE1BQUwsQ0FBWSxJQUF4QjtBQUNBLE9BQUssS0FBTCxHQUFhLEtBQWI7O0FBRUEsTUFBSSxPQUFPLEVBQVg7QUFDQSxPQUFLLElBQUksSUFBSSxNQUFNLENBQU4sQ0FBYixFQUF1QixLQUFLLE1BQU0sQ0FBTixDQUE1QixFQUFzQyxHQUF0QyxFQUEyQztBQUN6QyxZQUFTLElBQUksQ0FBTCxHQUFVLElBQWxCO0FBQ0Q7O0FBRUQsTUFBSSxTQUFTLEtBQUssSUFBbEIsRUFBd0I7QUFDdEIsU0FBSyxJQUFMLEdBQVksSUFBWjs7QUFFQSxRQUFJLElBQUosQ0FBUyxJQUFULEVBQWUsSUFBZjs7QUFFQSxRQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsV0FBSyxNQUFNLENBQU4sSUFBVyxLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLE1BRG5CO0FBRWQsY0FBUSxDQUFDLE1BQU0sQ0FBTixJQUFXLE1BQU0sQ0FBTixDQUFYLEdBQXNCLENBQXZCLElBQTRCLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUI7QUFGdkMsS0FBaEI7QUFJRDtBQUNGLENBNUJEOztBQThCQSxTQUFTLFNBQVQsQ0FBbUIsS0FBbkIsR0FBMkIsWUFBVztBQUNwQyxNQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsWUFBUTtBQURNLEdBQWhCO0FBR0QsQ0FKRDs7Ozs7QUNuREEsSUFBSSxNQUFNLFFBQVEsZUFBUixDQUFWO0FBQ0EsSUFBSSxNQUFNLFFBQVEsY0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsUUFBUixDQUFYOztBQUVBLE9BQU8sT0FBUCxHQUFpQixTQUFqQjs7QUFFQSxTQUFTLFNBQVQsQ0FBbUIsTUFBbkIsRUFBMkI7QUFDekIsT0FBSyxJQUFMLENBQVUsSUFBVixFQUFnQixNQUFoQjtBQUNBLE9BQUssSUFBTCxHQUFZLE9BQVo7QUFDQSxPQUFLLEdBQUwsR0FBVyxJQUFJLElBQUksS0FBUixDQUFYO0FBQ0Q7O0FBRUQsVUFBVSxTQUFWLENBQW9CLFNBQXBCLEdBQWdDLEtBQUssU0FBckM7O0FBRUEsVUFBVSxTQUFWLENBQW9CLEdBQXBCLEdBQTBCLFVBQVMsTUFBVCxFQUFpQjtBQUN6QyxNQUFJLE1BQUosQ0FBVyxNQUFYLEVBQW1CLElBQW5CO0FBQ0QsQ0FGRDs7QUFJQSxVQUFVLFNBQVYsQ0FBb0IsTUFBcEIsR0FBNkIsWUFBVztBQUN0QyxNQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsU0FBSztBQURTLEdBQWhCO0FBT0QsQ0FSRDs7QUFVQSxVQUFVLFNBQVYsQ0FBb0IsS0FBcEIsR0FBNEIsWUFBVztBQUNyQyxNQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsWUFBUTtBQURNLEdBQWhCO0FBR0QsQ0FKRDs7Ozs7QUMzQkEsT0FBTyxPQUFQLEdBQWlCLElBQWpCOztBQUVBLFNBQVMsSUFBVCxDQUFjLE1BQWQsRUFBc0I7QUFDcEIsT0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNEOztBQUVELEtBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsWUFBVztBQUNqQyxRQUFNLElBQUksS0FBSixDQUFVLHdCQUFWLENBQU47QUFDRCxDQUZEOztBQUlBLEtBQUssU0FBTCxDQUFlLEtBQWYsR0FBdUIsWUFBVztBQUNoQyxRQUFNLElBQUksS0FBSixDQUFVLHVCQUFWLENBQU47QUFDRCxDQUZEIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKlxuICogSmF6elxuICovXG5cbnZhciBEZWZhdWx0T3B0aW9ucyA9IHtcbiAgdGhlbWU6ICd3ZXN0ZXJuJyxcbiAgZm9udF9zaXplOiAnOXB0JyxcbiAgbGluZV9oZWlnaHQ6ICcxLjRlbScsXG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogOTUsXG4gIGhpZGVfcm93czogZmFsc2UsXG4gIGNlbnRlcl9ob3Jpem9udGFsOiBmYWxzZSxcbiAgY2VudGVyX3ZlcnRpY2FsOiBmYWxzZSxcbiAgbWFyZ2luX2xlZnQ6IDE1LFxuICBndXR0ZXJfbWFyZ2luOiAyMCxcbn07XG5cbnJlcXVpcmUoJy4vbGliL3NldC1pbW1lZGlhdGUnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuL2xpYi9kb20nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9saWIvbWVyZ2UnKTtcbnZhciBjbG9uZSA9IHJlcXVpcmUoJy4vbGliL2Nsb25lJyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vbGliL2JpbmQtcmFmJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi9saWIvcmVnZXhwJyk7XG52YXIgRGlhbG9nID0gcmVxdWlyZSgnLi9saWIvZGlhbG9nJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuL2xpYi9wb2ludCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi9saWIvcmFuZ2UnKTtcbnZhciBBcmVhID0gcmVxdWlyZSgnLi9saWIvYXJlYScpO1xudmFyIEJveCA9IHJlcXVpcmUoJy4vbGliL2JveCcpO1xuXG52YXIgRGVmYXVsdEJpbmRpbmdzID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvYmluZGluZ3MnKTtcbnZhciBIaXN0b3J5ID0gcmVxdWlyZSgnLi9zcmMvaGlzdG9yeScpO1xudmFyIElucHV0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQnKTtcbnZhciBGaWxlID0gcmVxdWlyZSgnLi9zcmMvZmlsZScpO1xudmFyIE1vdmUgPSByZXF1aXJlKCcuL3NyYy9tb3ZlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L3RleHQnKTtcbnZhciBWaWV3cyA9IHJlcXVpcmUoJy4vc3JjL3ZpZXdzJyk7XG52YXIgdGhlbWUgPSByZXF1aXJlKCcuL3NyYy90aGVtZScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3JjL3N0eWxlLmNzcycpO1xuXG52YXIgTkVXTElORSA9IFJlZ2V4cC5jcmVhdGUoWyduZXdsaW5lJ10pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEpheno7XG5cbmZ1bmN0aW9uIEphenoob3B0aW9ucykge1xuICB0aGlzLm9wdGlvbnMgPSBtZXJnZShjbG9uZShEZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMgfHwge30pO1xuXG4gIE9iamVjdC5hc3NpZ24odGhpcywge1xuICAgIGVsOiBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG5cbiAgICBpZDogJ2phenpfJyArIChNYXRoLnJhbmRvbSgpICogMTBlNiB8IDApLnRvU3RyaW5nKDM2KSxcbiAgICBmaWxlOiBuZXcgRmlsZSxcbiAgICBtb3ZlOiBuZXcgTW92ZSh0aGlzKSxcbiAgICB2aWV3czogbmV3IFZpZXdzKHRoaXMpLFxuICAgIGlucHV0OiBuZXcgSW5wdXQodGhpcyksXG4gICAgaGlzdG9yeTogbmV3IEhpc3RvcnkodGhpcyksXG5cbiAgICBiaW5kaW5nczogT2JqZWN0LmFzc2lnbih7fSwgRGVmYXVsdEJpbmRpbmdzKSxcblxuICAgIGZpbmQ6IG5ldyBEaWFsb2coJ0ZpbmQnLCBUZXh0Lm1hcCksXG4gICAgZmluZFZhbHVlOiAnJyxcbiAgICBmaW5kTmVlZGxlOiAwLFxuICAgIGZpbmRSZXN1bHRzOiBbXSxcblxuICAgIHNjcm9sbDogbmV3IFBvaW50LFxuICAgIG9mZnNldDogbmV3IFBvaW50LFxuICAgIHNpemU6IG5ldyBCb3gsXG4gICAgY2hhcjogbmV3IEJveCxcblxuICAgIHBhZ2U6IG5ldyBCb3gsXG4gICAgcGFnZVBvaW50OiBuZXcgUG9pbnQsXG4gICAgcGFnZVJlbWFpbmRlcjogbmV3IEJveCxcbiAgICBwYWdlQm91bmRzOiBuZXcgUmFuZ2UsXG5cbiAgICBsb25nZXN0TGluZTogMCxcbiAgICBndXR0ZXI6IDAsXG4gICAgY29kZTogMCxcbiAgICByb3dzOiAwLFxuXG4gICAgdGFiU2l6ZTogMixcbiAgICB0YWI6ICcgICcsXG5cbiAgICBjYXJldDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcbiAgICBjYXJldFB4OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuXG4gICAgaGFzRm9jdXM6IGZhbHNlLFxuXG4gICAgbWFyazogbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gICAgfSksXG5cbiAgICBlZGl0aW5nOiBmYWxzZSxcbiAgICBlZGl0TGluZTogLTEsXG4gICAgZWRpdFJhbmdlOiBbLTEsLTFdLFxuICAgIGVkaXRTaGlmdDogMCxcblxuICAgIHN1Z2dlc3RJbmRleDogMCxcbiAgICBzdWdnZXN0Um9vdDogJycsXG4gICAgc3VnZ2VzdE5vZGVzOiBbXSxcblxuICAgIGFuaW1hdGlvblR5cGU6ICdsaW5lYXInLFxuICAgIGFuaW1hdGlvbkZyYW1lOiAtMSxcbiAgICBhbmltYXRpb25SdW5uaW5nOiBmYWxzZSxcbiAgICBhbmltYXRpb25TY3JvbGxUYXJnZXQ6IG51bGwsXG5cbiAgICByZW5kZXJRdWV1ZTogW10sXG4gICAgcmVuZGVyUmVxdWVzdDogbnVsbCxcbiAgICByZW5kZXJSZXF1ZXN0U3RhcnRlZEF0OiAtMSxcbiAgfSk7XG5cbiAgLy8gdXNlZnVsIHNob3J0Y3V0c1xuICB0aGlzLmJ1ZmZlciA9IHRoaXMuZmlsZS5idWZmZXI7XG4gIHRoaXMuYnVmZmVyLm1hcmsgPSB0aGlzLm1hcms7XG4gIHRoaXMuc3ludGF4ID0gdGhpcy5idWZmZXIuc3ludGF4O1xuXG4gIHRoZW1lKHRoaXMub3B0aW9ucy50aGVtZSk7XG5cbiAgdGhpcy5iaW5kTWV0aG9kcygpO1xuICB0aGlzLmJpbmRFdmVudHMoKTtcbn1cblxuSmF6ei5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5KYXp6LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCwgc2Nyb2xsRWwpIHtcbiAgaWYgKHRoaXMucmVmKSB7XG4gICAgdGhpcy5lbC5yZW1vdmVBdHRyaWJ1dGUoJ2lkJyk7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKGNzcy5lZGl0b3IpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICAgIHRoaXMub2ZmU2Nyb2xsKCk7XG4gICAgdGhpcy5vZmZXaGVlbCgpO1xuICAgIHRoaXMucmVmLmZvckVhY2gocmVmID0+IHtcbiAgICAgIGRvbS5hcHBlbmQoZWwsIHJlZik7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5yZWYgPSBbXS5zbGljZS5jYWxsKHRoaXMuZWwuY2hpbGRyZW4pO1xuICAgIGRvbS5hcHBlbmQoZWwsIHRoaXMuZWwpO1xuICAgIGRvbS5vbnJlc2l6ZSh0aGlzLm9uUmVzaXplKTtcbiAgfVxuXG4gIHRoaXMuZWwgPSBlbDtcbiAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2lkJywgdGhpcy5pZCk7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZChjc3MuZWRpdG9yKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gIHRoaXMub2ZmU2Nyb2xsID0gZG9tLm9uc2Nyb2xsKHNjcm9sbEVsIHx8IHRoaXMuZWwsIHRoaXMub25TY3JvbGwpO1xuICB0aGlzLm9mZldoZWVsID0gZG9tLm9ud2hlZWwoc2Nyb2xsRWwgfHwgdGhpcy5lbCwgdGhpcy5vbldoZWVsKVxuICB0aGlzLmlucHV0LnVzZSh0aGlzLmVsKTtcbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXdzLmNhcmV0LCB0aGlzLmlucHV0LnRleHQpO1xuICB0aGlzLnZpZXdzLnVzZSh0aGlzLmVsKTtcblxuICB0aGlzLnJlcGFpbnQoKVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYXNzaWduID0gZnVuY3Rpb24oYmluZGluZ3MpIHtcbiAgdGhpcy5iaW5kaW5ncyA9IGJpbmRpbmdzO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLmZpbGUub3BlbihwYXRoLCByb290LCBmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHRoaXMuZmlsZS5zYXZlKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0LCBwYXRoKSB7XG4gIHRoaXMuZmlsZS5zZXQodGV4dCk7XG4gIHRoaXMuZmlsZS5wYXRoID0gcGF0aCB8fCB0aGlzLmZpbGUucGF0aDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5mb2N1cyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5ibHVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbi5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTsgLy9iaW5kUmFmKHRoaXMucmVwYWludCkuYmluZCh0aGlzKTtcbiAgdGhpcy5fcmVuZGVyID0gdGhpcy5fcmVuZGVyLmJpbmQodGhpcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kSGFuZGxlcnMgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgbWV0aG9kIGluIHRoaXMpIHtcbiAgICBpZiAoJ29uJyA9PT0gbWV0aG9kLnNsaWNlKDAsIDIpKSB7XG4gICAgICB0aGlzW21ldGhvZF0gPSB0aGlzW21ldGhvZF0uYmluZCh0aGlzKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5vbldoZWVsID0gdGhyb3R0bGUodGhpcy5vbldoZWVsLCAxMCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kRXZlbnRzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmluZEhhbmRsZXJzKClcbiAgdGhpcy5tb3ZlLm9uKCdtb3ZlJywgdGhpcy5vbk1vdmUpO1xuICB0aGlzLmZpbGUub24oJ3JhdycsIHRoaXMub25GaWxlUmF3KTsgLy9UT0RPOiBzaG91bGQgbm90IG5lZWQgdGhpcyBldmVudFxuICB0aGlzLmZpbGUub24oJ3NldCcsIHRoaXMub25GaWxlU2V0KTtcbiAgdGhpcy5maWxlLm9uKCdvcGVuJywgdGhpcy5vbkZpbGVPcGVuKTtcbiAgdGhpcy5maWxlLm9uKCdjaGFuZ2UnLCB0aGlzLm9uRmlsZUNoYW5nZSk7XG4gIHRoaXMuZmlsZS5vbignYmVmb3JlIGNoYW5nZScsIHRoaXMub25CZWZvcmVGaWxlQ2hhbmdlKTtcbiAgdGhpcy5oaXN0b3J5Lm9uKCdjaGFuZ2UnLCB0aGlzLm9uSGlzdG9yeUNoYW5nZSk7XG4gIHRoaXMuaW5wdXQub24oJ2JsdXInLCB0aGlzLm9uQmx1cik7XG4gIHRoaXMuaW5wdXQub24oJ2ZvY3VzJywgdGhpcy5vbkZvY3VzKTtcbiAgdGhpcy5pbnB1dC5vbignaW5wdXQnLCB0aGlzLm9uSW5wdXQpO1xuICB0aGlzLmlucHV0Lm9uKCd0ZXh0JywgdGhpcy5vblRleHQpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXlzJywgdGhpcy5vbktleXMpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXknLCB0aGlzLm9uS2V5KTtcbiAgdGhpcy5pbnB1dC5vbignY3V0JywgdGhpcy5vbkN1dCk7XG4gIHRoaXMuaW5wdXQub24oJ2NvcHknLCB0aGlzLm9uQ29weSk7XG4gIHRoaXMuaW5wdXQub24oJ3Bhc3RlJywgdGhpcy5vblBhc3RlKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2V1cCcsIHRoaXMub25Nb3VzZVVwKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2Vkb3duJywgdGhpcy5vbk1vdXNlRG93bik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlY2xpY2snLCB0aGlzLm9uTW91c2VDbGljayk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZ2JlZ2luJywgdGhpcy5vbk1vdXNlRHJhZ0JlZ2luKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnJywgdGhpcy5vbk1vdXNlRHJhZyk7XG4gIHRoaXMuZmluZC5vbignc3VibWl0JywgdGhpcy5maW5kSnVtcC5iaW5kKHRoaXMsIDEpKTtcbiAgdGhpcy5maW5kLm9uKCd2YWx1ZScsIHRoaXMub25GaW5kVmFsdWUpO1xuICB0aGlzLmZpbmQub24oJ2tleScsIHRoaXMub25GaW5kS2V5KTtcbiAgdGhpcy5maW5kLm9uKCdvcGVuJywgdGhpcy5vbkZpbmRPcGVuKTtcbiAgdGhpcy5maW5kLm9uKCdjbG9zZScsIHRoaXMub25GaW5kQ2xvc2UpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25TY3JvbGwgPSBmdW5jdGlvbihzY3JvbGwpIHtcbiAgdGhpcy5zY3JvbGwuc2V0KHNjcm9sbCk7XG4gIHRoaXMucmVuZGVyKCdjb2RlJyk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG4gIHRoaXMucmVuZGVyKCdyb3dzJyk7XG4gIHRoaXMucmVzdCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25XaGVlbCA9IGZ1bmN0aW9uKHdoZWVsKSB7XG4gIHRoaXMuYW5pbWF0ZVNjcm9sbEJ5KHdoZWVsLmRlbHRhWCwgd2hlZWwuZGVsdGFZICogMS4yLCAnZWFzZScpXG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXN0ID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xufSwgNjAwKTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3ZlID0gZnVuY3Rpb24ocG9pbnQsIGJ5RWRpdCkge1xuICBpZiAoIWJ5RWRpdCkgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIGlmIChwb2ludCkgdGhpcy5zZXRDYXJldChwb2ludCk7XG5cbiAgaWYgKCFieUVkaXQpIHtcbiAgICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCB8fCB0aGlzLmlucHV0Lm1vdXNlLmRvd24pIHtcbiAgICAgIHRoaXMubWFya1NldCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgnbW92ZScpO1xuICB0aGlzLmVtaXQoJ2lucHV0JywgJycsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG4gIHRoaXMucmVzdCgpO1xuXG4gIHRoaXMucmVuZGVyKCdjYXJldCcpO1xuICB0aGlzLnJlbmRlcignYmxvY2snKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Gb2N1cyA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IHRydWU7XG4gIHRoaXMuZW1pdCgnZm9jdXMnKTtcbiAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldFNvbGlkID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgdGhpcy5jYXJldEJsaW5rKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldEJsaW5rID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXQsIGNzc1snYmxpbmstc21vb3RoJ11dKTtcbn0sIDQwMCk7XG5cbkphenoucHJvdG90eXBlLm9uQmx1ciA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IGZhbHNlO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHtcbiAgICAgIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgICAgIHRoaXMuZW1pdCgnYmx1cicpO1xuICAgICAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgICB9XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKGtleXMgaW4gdGhpcy5iaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5cyBpbiBEZWZhdWx0QmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmIChrZXkgaW4gdGhpcy5iaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleSBpbiBEZWZhdWx0QmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHRoaXMub25Db3B5KGUpO1xuICB0aGlzLmRlbGV0ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Db3B5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgLy9cbn07XG5cbkphenoucHJvdG90eXBlLnNldFRhYk1vZGUgPSBmdW5jdGlvbihjaGFyKSB7XG4gIGlmICgnXFx0JyA9PT0gY2hhcikge1xuICAgIHRoaXMudGFiID0gY2hhcjtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnRhYiA9IG5ldyBBcnJheSh0aGlzLnRhYlNpemUgKyAxKS5qb2luKGNoYXIpO1xuICB9XG59XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0KHsgeDowLCB5OjAgfSk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZXBhaW50KHRydWUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25IaXN0b3J5Q2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVuZGVyKCdjb2RlJyk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMuZW1pdCgnaGlzdG9yeSBjaGFuZ2UnKVxufTtcblxuSmF6ei5wcm90b3R5cGUub25CZWZvcmVGaWxlQ2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG4gIHRoaXMuZWRpdENhcmV0QmVmb3JlID0gdGhpcy5jYXJldC5jb3B5KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVDaGFuZ2UgPSBmdW5jdGlvbihlZGl0UmFuZ2UsIGVkaXRTaGlmdCwgdGV4dEJlZm9yZSwgdGV4dEFmdGVyKSB7XG4gIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICB0aGlzLmVkaXRpbmcgPSB0cnVlO1xuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2MoKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG5cbiAgaWYgKHRoaXMuZmluZC5pc09wZW4pIHtcbiAgICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlLCB0cnVlKTtcbiAgfVxuXG4gIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG5cbiAgdGhpcy52aWV3cy5jb2RlLnJlbmRlckVkaXQoe1xuICAgIGxpbmU6IGVkaXRSYW5nZVswXSxcbiAgICByYW5nZTogZWRpdFJhbmdlLFxuICAgIHNoaWZ0OiBlZGl0U2hpZnQsXG4gICAgY2FyZXROb3c6IHRoaXMuY2FyZXQsXG4gICAgY2FyZXRCZWZvcmU6IHRoaXMuZWRpdENhcmV0QmVmb3JlXG4gIH0pO1xuXG4gIHRoaXMucmVuZGVyKCdjYXJldCcpO1xuICB0aGlzLnJlbmRlcigncm93cycpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xuICB0aGlzLnJlbmRlcigncnVsZXInKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG5cbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0RnJvbVB4ID0gZnVuY3Rpb24ocHgpIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLm1hcmdpbkxlZnQsIHk6IHRoaXMuY2hhci5oZWlnaHQvMiB9KVsnKyddKHRoaXMub2Zmc2V0KTtcbiAgaWYgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwpIGcueSArPSB0aGlzLnNpemUuaGVpZ2h0IC8gMyB8IDA7XG4gIHZhciBwID0gcHhbJy0nXShnKVsnKyddKHRoaXMuc2Nyb2xsKVsnby8nXSh0aGlzLmNoYXIpO1xuXG4gIHAueSA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueSwgdGhpcy5idWZmZXIubG9jKCkpKTtcbiAgcC54ID0gTWF0aC5tYXgoMCwgcC54KTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0Q29vcmRzVGFicyhwKTtcblxuICBwLnggPSBNYXRoLm1heChcbiAgICAwLFxuICAgIE1hdGgubWluKFxuICAgICAgcC54IC0gdGFicy50YWJzICsgdGFicy5yZW1haW5kZXIsXG4gICAgICB0aGlzLmdldExpbmVMZW5ndGgocC55KVxuICAgIClcbiAgKTtcblxuICB0aGlzLnNldENhcmV0KHApO1xuICB0aGlzLm1vdmUubGFzdERlbGliZXJhdGVYID0gcC54O1xuICB0aGlzLm9uTW92ZSgpO1xuXG4gIHJldHVybiBwO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZVVwID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykgdGhpcy5ibHVyKCk7XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURvd24gPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCh0aGlzLmZvY3VzLmJpbmQodGhpcyksIDEwKTtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQpIHRoaXMubWFya0JlZ2luKCk7XG4gIGVsc2UgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0ID0gZnVuY3Rpb24ocCwgY2VudGVyLCBhbmltYXRlKSB7XG4gIHRoaXMuY2FyZXQuc2V0KHApO1xuXG4gIHZhciB0YWJzID0gdGhpcy5nZXRQb2ludFRhYnModGhpcy5jYXJldCk7XG5cbiAgdGhpcy5jYXJldFB4LnNldCh7XG4gICAgeDogdGhpcy5jaGFyLndpZHRoICogKHRoaXMuY2FyZXQueCArIHRhYnMudGFicyAqIHRoaXMudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKSxcbiAgICB5OiB0aGlzLmNoYXIuaGVpZ2h0ICogdGhpcy5jYXJldC55XG4gIH0pO1xuXG4gIHRoaXMuZm9sbG93Q2FyZXQoY2VudGVyLCBhbmltYXRlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VDbGljayA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2xpY2tzID0gdGhpcy5pbnB1dC5tb3VzZS5jbGlja3M7XG4gIGlmIChjbGlja3MgPiAxKSB7XG4gICAgdmFyIGFyZWE7XG5cbiAgICBpZiAoY2xpY2tzID09PSAyKSB7XG4gICAgICBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQpO1xuICAgIH0gZWxzZSBpZiAoY2xpY2tzID09PSAzKSB7XG4gICAgICB2YXIgeSA9IHRoaXMuY2FyZXQueTtcbiAgICAgIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHkgfSxcbiAgICAgICAgZW5kOiB7IHg6IHRoaXMuZ2V0TGluZUxlbmd0aCh5KSwgeTogeSB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5zZXRDYXJldChhcmVhLmVuZCk7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKGFyZWEpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UuZG93bik7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0JlZ2luID0gZnVuY3Rpb24oYXJlYSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gdHJ1ZTtcbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB9IGVsc2UgaWYgKGFyZWEgIT09IGZhbHNlIHx8IHRoaXMubWFyay5iZWdpbi54ID09PSAtMSkge1xuICAgICAgdGhpcy5tYXJrLmJlZ2luLnNldCh0aGlzLmNhcmV0KTtcbiAgICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLm1hcmtCZWdpbihhcmVhKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtDbGVhciA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0ICYmICFmb3JjZSkgcmV0dXJuO1xuXG4gIHRoaXMubWFyay5hY3RpdmUgPSBmYWxzZTtcbiAgdGhpcy5tYXJrLnNldCh7XG4gICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICB9KTtcbiAgdGhpcy5jbGVhcignbWFyaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gUmFuZ2UuY2xhbXAocmFuZ2UsIHRoaXMucGFnZUJvdW5kcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcyA9IHRoaXMuc2Nyb2xsLmNvcHkoKTtcbiAgaWYgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwpIHtcbiAgICBzLnkgLT0gdGhpcy5zaXplLmhlaWdodCAvIDMgfCAwO1xuICB9XG4gIHZhciBwID0gc1snXy8nXSh0aGlzLmNoYXIpO1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDtcbn07XG5cbkphenoucHJvdG90eXBlLmZvbGxvd0NhcmV0ID0gZnVuY3Rpb24oY2VudGVyLCBhbmltYXRlKSB7XG4gIHZhciBwID0gdGhpcy5jYXJldFB4O1xuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHZhciB0b3AgPSAoXG4gICAgICBzLnlcbiAgICArIChjZW50ZXIgJiYgIXRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDIgfCAwKSAtIDEwMCA6IDApXG4gICkgLSBwLnk7XG5cbiAgdmFyIGJvdHRvbSA9IHAueSAtIChcbiAgICAgIHMueVxuICAgICsgdGhpcy5zaXplLmhlaWdodFxuICAgIC0gKGNlbnRlciAmJiAhdGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMiB8IDApIC0gMTAwIDogMClcbiAgICAtICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAzICogMiB8IDApIDogMClcbiAgKSArIHRoaXMuY2hhci5oZWlnaHQ7XG5cbiAgdmFyIGxlZnQgPSAocy54ICsgdGhpcy5jaGFyLndpZHRoKSAtIHAueDtcbiAgdmFyIHJpZ2h0ID0gKHAueCkgLSAocy54ICsgdGhpcy5zaXplLndpZHRoIC0gdGhpcy5tYXJnaW5MZWZ0KSArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgaWYgKGJvdHRvbSA8IDApIGJvdHRvbSA9IDA7XG4gIGlmICh0b3AgPCAwKSB0b3AgPSAwO1xuICBpZiAobGVmdCA8IDApIGxlZnQgPSAwO1xuICBpZiAocmlnaHQgPCAwKSByaWdodCA9IDA7XG5cbiAgaWYgKGxlZnQgKyB0b3AgKyByaWdodCArIGJvdHRvbSkge1xuICAgIHRoaXNbYW5pbWF0ZSA/ICdhbmltYXRlU2Nyb2xsQnknIDogJ3Njcm9sbEJ5J10ocmlnaHQgLSBsZWZ0LCBib3R0b20gLSB0b3AsICdlYXNlJyk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbFRvID0gZnVuY3Rpb24ocCkge1xuICBkb20uc2Nyb2xsVG8odGhpcy5lbCwgcC54LCBwLnkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIHZhciB0YXJnZXQgPSBQb2ludC5sb3coe1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9LCB7XG4gICAgeDogdGhpcy5zY3JvbGwueCArIHgsXG4gICAgeTogdGhpcy5zY3JvbGwueSArIHlcbiAgfSk7XG5cbiAgaWYgKFBvaW50LnNvcnQodGFyZ2V0LCB0aGlzLnNjcm9sbCkgIT09IDApIHtcbiAgICB0aGlzLnNjcm9sbC5zZXQodGFyZ2V0KTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuc2Nyb2xsKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0ZVNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSwgYW5pbWF0aW9uVHlwZSkge1xuICB0aGlzLmFuaW1hdGlvblR5cGUgPSBhbmltYXRpb25UeXBlIHx8ICdsaW5lYXInO1xuXG4gIGlmICghdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgaWYgKCdsaW5lYXInID09PSB0aGlzLmFuaW1hdGlvblR5cGUpIHtcbiAgICAgIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgICB9XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKFxuICAgICAgICAodGhpcy5yb3dzICsgMSkgKiB0aGlzLmNoYXIuaGVpZ2h0IC0gdGhpcy5zaXplLmhlaWdodFxuICAgICAgKyAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzICogMiB8IDAgOiAwKSxcbiAgICAgIE1hdGgubWF4KDAsIHMueSArIHkpXG4gICAgKVxuICB9KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgZHggPSBNYXRoLnNpZ24oZHgpICogNTtcbiAgZHkgPSBNYXRoLnNpZ24oZHkpICogNTtcblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxGcmFtZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc3BlZWQgPSB0aGlzLm9wdGlvbnMuc2Nyb2xsX3NwZWVkO1xuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIHZhciBhZHggPSBNYXRoLmFicyhkeCk7XG4gIHZhciBhZHkgPSBNYXRoLmFicyhkeSk7XG5cbiAgaWYgKGFkeSA+PSB0aGlzLnNpemUuaGVpZ2h0ICogMS4yKSB7XG4gICAgc3BlZWQgKj0gMi40NTtcbiAgfVxuXG4gIGlmICgoYWR4IDwgMSAmJiBhZHkgPCAxKSB8fCAhdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCk7XG4gICAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBudWxsO1xuICAgIHRoaXMuZW1pdCgnYW5pbWF0aW9uIGVuZCcpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIHN3aXRjaCAodGhpcy5hbmltYXRpb25UeXBlKSB7XG4gICAgY2FzZSAnbGluZWFyJzpcbiAgICAgIGlmIChhZHggPCBzcGVlZCkgZHggKj0gMC45O1xuICAgICAgZWxzZSBkeCA9IE1hdGguc2lnbihkeCkgKiBzcGVlZDtcblxuICAgICAgaWYgKGFkeSA8IHNwZWVkKSBkeSAqPSAwLjk7XG4gICAgICBlbHNlIGR5ID0gTWF0aC5zaWduKGR5KSAqIHNwZWVkO1xuXG4gICAgICBicmVhaztcbiAgICBjYXNlICdlYXNlJzpcbiAgICAgIGR4ICo9IDAuNTtcbiAgICAgIGR5ICo9IDAuNTtcbiAgICAgIGJyZWFrO1xuICB9XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24odGV4dCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkgdGhpcy5kZWxldGUoKTtcblxuICB0aGlzLmVtaXQoJ2lucHV0JywgdGV4dCwgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpO1xuXG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQodGhpcy5jYXJldC55KTtcbiAgdmFyIHJpZ2h0ID0gbGluZVt0aGlzLmNhcmV0LnhdO1xuICB2YXIgaGFzUmlnaHRTeW1ib2wgPSB+Wyd9JywnXScsJyknXS5pbmRleE9mKHJpZ2h0KTtcblxuICAvLyBhcHBseSBpbmRlbnQgb24gZW50ZXJcbiAgaWYgKE5FV0xJTkUudGVzdCh0ZXh0KSkge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IHRoaXMuY2FyZXQueCA9PT0gbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBsZWZ0ID0gbGluZVt0aGlzLmNhcmV0LnggLSAxXTtcbiAgICB2YXIgaW5kZW50ID0gbGluZS5tYXRjaCgvXFxTLyk7XG4gICAgaW5kZW50ID0gaW5kZW50ID8gaW5kZW50LmluZGV4IDogbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBoYXNMZWZ0U3ltYm9sID0gflsneycsJ1snLCcoJ10uaW5kZXhPZihsZWZ0KTtcblxuICAgIGlmIChoYXNMZWZ0U3ltYm9sKSBpbmRlbnQgKz0gMjtcblxuICAgIGlmIChpc0VuZE9mTGluZSB8fCBoYXNMZWZ0U3ltYm9sKSB7XG4gICAgICB0ZXh0ICs9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJyk7XG4gICAgfVxuICB9XG5cbiAgdmFyIGxlbmd0aDtcblxuICBpZiAoIWhhc1JpZ2h0U3ltYm9sIHx8IChoYXNSaWdodFN5bWJvbCAmJiAhflsnfScsJ10nLCcpJ10uaW5kZXhPZih0ZXh0KSkpIHtcbiAgICBsZW5ndGggPSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgdGV4dCwgbnVsbCwgdHJ1ZSk7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gMTtcbiAgfVxuXG4gIHRoaXMubW92ZS5ieUNoYXJzKGxlbmd0aCwgdHJ1ZSk7XG5cbiAgaWYgKCd7JyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICd9Jyk7XG4gIGVsc2UgaWYgKCcoJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICcpJyk7XG4gIGVsc2UgaWYgKCdbJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICddJyk7XG5cbiAgaWYgKGhhc0xlZnRTeW1ib2wgJiYgaGFzUmlnaHRTeW1ib2wpIHtcbiAgICBpbmRlbnQgLT0gMjtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmFja3NwYWNlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm4gdGhpcy5kZWxldGUoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmVtaXQoJ2lucHV0JywgJ1xcdWFhYTAnLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSk7XG5cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSh0cnVlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSwgdHJ1ZSk7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQ2hhckF0UG9pbnQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuIHRoaXMuYmFja3NwYWNlKCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWExJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpO1xuXG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUodHJ1ZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQ2hhckF0UG9pbnQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmZpbmRKdW1wID0gZnVuY3Rpb24oanVtcCkge1xuICBpZiAoIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIHx8ICF0aGlzLmZpbmQuaXNPcGVuKSByZXR1cm47XG5cbiAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kTmVlZGxlICsganVtcDtcbiAgaWYgKHRoaXMuZmluZE5lZWRsZSA+PSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IDA7XG4gIH0gZWxzZSBpZiAodGhpcy5maW5kTmVlZGxlIDwgMCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIC0gMTtcbiAgfVxuXG4gIHRoaXMuZmluZC5pbmZvKDEgKyB0aGlzLmZpbmROZWVkbGUgKyAnLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG5cbiAgdmFyIHJlc3VsdCA9IHRoaXMuZmluZFJlc3VsdHNbdGhpcy5maW5kTmVlZGxlXTtcbiAgdGhpcy5zZXRDYXJldChyZXN1bHQsIHRydWUsIHRydWUpO1xuICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5tb3ZlLmJ5Q2hhcnModGhpcy5maW5kVmFsdWUubGVuZ3RoLCB0cnVlKTtcbiAgdGhpcy5tYXJrU2V0KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQodHJ1ZSwgdHJ1ZSk7XG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlLCBub0p1bXApIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLmd1dHRlciwgeTogMCB9KTtcblxuICB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcbiAgdGhpcy5maW5kVmFsdWUgPSB2YWx1ZTtcbiAgdGhpcy5maW5kUmVzdWx0cyA9IHRoaXMuYnVmZmVyLmluZGV4ZXIuZmluZCh2YWx1ZSkubWFwKChvZmZzZXQpID0+IHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0KTtcbiAgfSk7XG5cbiAgaWYgKHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kLmluZm8oMSArIHRoaXMuZmluZE5lZWRsZSArICcvJyArIHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKTtcbiAgfVxuXG4gIGlmICghbm9KdW1wKSB0aGlzLmZpbmRKdW1wKDApO1xuXG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRLZXkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICh+WzMzLCAzNCwgMTE0XS5pbmRleE9mKGUud2hpY2gpKSB7IC8vIHBhZ2V1cCwgcGFnZWRvd24sIGYzXG4gICAgdGhpcy5pbnB1dC50ZXh0Lm9ua2V5ZG93bihlKTtcbiAgfVxuXG4gIGlmICg3MCA9PT0gZS53aGljaCAmJiBlLmN0cmxLZXkpIHsgLy8gY3RybCtmXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoOSA9PT0gZS53aGljaCkgeyAvLyB0YWJcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5pbnB1dC5mb2N1cygpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZpbmQuaW5mbygnJyk7XG4gIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kQ2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhcignZmluZCcpO1xuICB0aGlzLmZvY3VzKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zdWdnZXN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQsIHRydWUpO1xuICBpZiAoIWFyZWEpIHJldHVybjtcblxuICB2YXIga2V5ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGlmICgha2V5KSByZXR1cm47XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3RSb290XG4gICAgfHwga2V5LnN1YnN0cigwLCB0aGlzLnN1Z2dlc3RSb290Lmxlbmd0aCkgIT09IHRoaXMuc3VnZ2VzdFJvb3QpIHtcbiAgICB0aGlzLnN1Z2dlc3RJbmRleCA9IDA7XG4gICAgdGhpcy5zdWdnZXN0Um9vdCA9IGtleTtcbiAgICB0aGlzLnN1Z2dlc3ROb2RlcyA9IHRoaXMuYnVmZmVyLnByZWZpeC5jb2xsZWN0KGtleSk7XG4gIH1cblxuICBpZiAoIXRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aCkgcmV0dXJuO1xuICB2YXIgbm9kZSA9IHRoaXMuc3VnZ2VzdE5vZGVzW3RoaXMuc3VnZ2VzdEluZGV4XTtcblxuICB0aGlzLnN1Z2dlc3RJbmRleCA9ICh0aGlzLnN1Z2dlc3RJbmRleCArIDEpICUgdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoO1xuXG4gIHJldHVybiB7XG4gICAgYXJlYTogYXJlYSxcbiAgICBub2RlOiBub2RlXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQb2ludFRhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYiA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXIgKyB0YWJzXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRDb29yZHNUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWJzICogdGhpcy50YWJTaXplICsgcmVtYWluZGVyID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlclxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVwYWludCA9IGZ1bmN0aW9uKGNsZWFyKSB7XG4gIHRoaXMucmVzaXplKCk7XG4gIGlmIChjbGVhcikgdGhpcy52aWV3cy5jbGVhcigpO1xuICB0aGlzLnZpZXdzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHZhciAkID0gdGhpcy5lbDtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAuJHtjc3Mucm93c30sXG4gICAgLiR7Y3NzLm1hcmt9LFxuICAgIC4ke2Nzcy5jb2RlfSxcbiAgICBtYXJrLFxuICAgIHAsXG4gICAgdCxcbiAgICBrLFxuICAgIGQsXG4gICAgbixcbiAgICBvLFxuICAgIGUsXG4gICAgbSxcbiAgICBmLFxuICAgIHIsXG4gICAgYyxcbiAgICBzLFxuICAgIGwsXG4gICAgeCB7XG4gICAgICBmb250LWZhbWlseTogJ01lc2xvIExHIFMnLCAnUm9ib3RvIE1vbm8nLCAnQ29uc29sYXMnLCBtb25vc3BhY2U7XG4gICAgICBmb250LXNpemU6ICR7dGhpcy5vcHRpb25zLmZvbnRfc2l6ZX07XG4gICAgICBsaW5lLWhlaWdodDogJHt0aGlzLm9wdGlvbnMubGluZV9oZWlnaHR9O1xuICAgIH1cbiAgICBgXG4gICk7XG5cbiAgdGhpcy5vZmZzZXQuc2V0KGRvbS5nZXRPZmZzZXQoJCkpO1xuICB0aGlzLnNjcm9sbC5zZXQoZG9tLmdldFNjcm9sbCgkKSk7XG4gIHRoaXMuc2l6ZS5zZXQoZG9tLmdldFNpemUoJCkpO1xuXG4gIC8vIHRoaXMgaXMgYSB3ZWlyZCBmaXggd2hlbiBkb2luZyBtdWx0aXBsZSAudXNlKClcbiAgLy8gaWYgKHRoaXMuY2hhci53aWR0aCA9PT0gMClcbiAgdGhpcy5jaGFyLnNldChkb20uZ2V0Q2hhclNpemUoJCwgY3NzLmNvZGUpKTtcblxuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2MoKTtcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG4gIHRoaXMucGFnZS5zZXQodGhpcy5zaXplWydeLyddKHRoaXMuY2hhcikpO1xuICB0aGlzLnBhZ2VSZW1haW5kZXIuc2V0KHRoaXMuc2l6ZVsnLSddKHRoaXMucGFnZVsnXyonXSh0aGlzLmNoYXIpKSk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuICAvLyB0aGlzLmxvbmdlc3RMaW5lID0gTWF0aC5taW4oNTAwLCB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMb25nZXN0TGluZUxlbmd0aCgpKTtcblxuICB0aGlzLmd1dHRlciA9IE1hdGgubWF4KFxuICAgIHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWxcbiAgICAgID8gTWF0aC5tYXgoXG4gICAgICAgICAgKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICAgICAgICggdGhpcy5wYWdlLndpZHRoIC0gODFcbiAgICAgICAgICAtICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aClcbiAgICAgICAgICApIC8gMiB8IDBcbiAgICAgICAgKSA6IDApXG4gICAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiBNYXRoLm1heCgzLCAoJycrdGhpcy5yb3dzKS5sZW5ndGgpKVxuICApICogdGhpcy5jaGFyLndpZHRoXG4gICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3NcbiAgICAgID8gMFxuICAgICAgOiB0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbiAqICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWwgPyAtMSA6IDEpXG4gICAgKTtcblxuICB0aGlzLm1hcmdpbkxlZnQgPSB0aGlzLmd1dHRlciArIHRoaXMub3B0aW9ucy5tYXJnaW5fbGVmdDtcbiAgdGhpcy5jb2RlTGVmdCA9IHRoaXMubWFyZ2luTGVmdCArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgdGhpcy5oZWlnaHQgPSAodGhpcy5yb3dzICsgdGhpcy5wYWdlLmhlaWdodClcbiAgICAqIHRoaXMuY2hhci5oZWlnaHRcbiAgICArIHRoaXMucGFnZVJlbWFpbmRlci5oZWlnaHQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjJyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSB7XG4gICAgICB0b3A6ICR7dGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIDogMH1weDtcbiAgICB9XG5cbiAgICAuJHtjc3Mucm93c30sXG4gICAgLiR7Y3NzLm1hcmt9LFxuICAgIC4ke2Nzcy5jb2RlfSxcbiAgICBtYXJrLFxuICAgIHAsXG4gICAgdCxcbiAgICBrLFxuICAgIGQsXG4gICAgbixcbiAgICBvLFxuICAgIGUsXG4gICAgbSxcbiAgICBmLFxuICAgIHIsXG4gICAgYyxcbiAgICBzLFxuICAgIGwsXG4gICAgeCB7XG4gICAgICBmb250LWZhbWlseTogJ01lc2xvIExHIFMnLCAnUm9ib3RvIE1vbm8nLCAnQ29uc29sYXMnLCBtb25vc3BhY2U7XG4gICAgICBmb250LXNpemU6ICR7dGhpcy5vcHRpb25zLmZvbnRfc2l6ZX07XG4gICAgICBsaW5lLWhlaWdodDogJHt0aGlzLm9wdGlvbnMubGluZV9oZWlnaHR9O1xuICAgIH1cblxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJ1bGVyfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5maW5kfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5tYXJrfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5jb2RlfSB7XG4gICAgICBtYXJnaW4tbGVmdDogJHt0aGlzLmNvZGVMZWZ0fXB4O1xuICAgICAgdGFiLXNpemU6ICR7dGhpcy50YWJTaXplfTtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3Mucm93c30ge1xuICAgICAgd2lkdGg6ICR7dGhpcy5tYXJnaW5MZWZ0fXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5maW5kfSA+IGksXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuYmxvY2t9ID4gaSB7XG4gICAgICBoZWlnaHQ6ICR7dGhpcy5jaGFyLmhlaWdodCArIDF9cHg7XG4gICAgfVxuICAgIHgge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLnZpZXdzW25hbWVdLmNsZWFyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbihuYW1lKSB7XG4gIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmVuZGVyUmVxdWVzdCk7XG4gIGlmICh0aGlzLnJlbmRlclJlcXVlc3RTdGFydGVkQXQgPT09IC0xKSB7XG4gICAgdGhpcy5yZW5kZXJSZXF1ZXN0U3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoRGF0ZS5ub3coKSAtIHRoaXMucmVuZGVyUmVxdWVzdFN0YXJ0ZWRBdCA+IDEwMCkge1xuICAgICAgdGhpcy5fcmVuZGVyKCk7XG4gICAgfVxuICB9XG4gIGlmICghfnRoaXMucmVuZGVyUXVldWUuaW5kZXhPZihuYW1lKSkge1xuICAgIGlmIChuYW1lIGluIHRoaXMudmlld3MpIHtcbiAgICAgIHRoaXMucmVuZGVyUXVldWUucHVzaChuYW1lKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJSZXF1ZXN0ID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuX3JlbmRlcik7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5fcmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdyZW5kZXInKVxuICB0aGlzLnJlbmRlclJlcXVlc3RTdGFydGVkQXQgPSAtMTtcbiAgdGhpcy5yZW5kZXJRdWV1ZS5mb3JFYWNoKG5hbWUgPT4gdGhpcy52aWV3c1tuYW1lXS5yZW5kZXIoe1xuICAgIG9mZnNldDoge1xuICAgICAgbGVmdDogdGhpcy5zY3JvbGwueCxcbiAgICAgIHRvcDogdGhpcy5zY3JvbGwueSAtIHRoaXMuZWwuc2Nyb2xsVG9wXG4gICAgfVxuICB9KSk7XG4gIHRoaXMucmVuZGVyUXVldWUgPSBbXTtcbn07XG5cbi8vIHRoaXMgaXMgdXNlZCBmb3IgZGV2ZWxvcG1lbnQgZGVidWcgcHVycG9zZXNcbmZ1bmN0aW9uIGJpbmRDYWxsU2l0ZShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIHZhciBlcnIgPSBuZXcgRXJyb3I7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyLCBhcmd1bWVudHMuY2FsbGVlKTtcbiAgICB2YXIgc3RhY2sgPSBlcnIuc3RhY2s7XG4gICAgY29uc29sZS5sb2coc3RhY2spO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYywgZCk7XG4gIH07XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIGxldCBhcmVhID0gdGhpcy5nZXQoKVxuICByZXR1cm4gJycgKyBhcmVhLmJlZ2luICsgJ3wnICsgYXJlYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGJpbmFyeVNlYXJjaDtcblxuZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFycmF5LCBjb21wYXJlKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgbG93ID0gMDtcbiAgdmFyIGhpZ2ggPSBhcnJheS5sZW5ndGg7XG4gIGlmICghaGlnaCkgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiAwXG4gIH07XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpbmRleDtcbiAgICBpbmRleCA9IGxvdyArIChoaWdoIC0gbG93ID4+IDEpO1xuICAgIHZhciBpdGVtID0gYXJyYXlbaW5kZXhdO1xuICAgIHZhciByZXN1bHQgPSBjb21wYXJlKGl0ZW0pO1xuXG4gICAgaWYgKHJlc3VsdCkgbG93ID0gaW5kZXg7XG4gICAgZWxzZSBoaWdoID0gaW5kZXg7XG4gIH0gd2hpbGUgKHByZXYgIT09IGluZGV4KTtcblxuICBpZiAoaXRlbSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICBpbmRleDogaW5kZXhcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiB+bG93ICogLTEgLSAxXG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuICByZXR1cm4gZnVuY3Rpb24gcmFmV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKHJlcXVlc3QpO1xuICAgIHJlcXVlc3QgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCkpO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfLyddID1cbkJveC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXi8nXSA9XG5Cb3gucHJvdG90eXBlLmNlaWxkaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWycqJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydvKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGgucm91bmQodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLnJvdW5kKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJy0nXSA9XG5Cb3gucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC0gKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjbG9uZShvYmopIHtcbiAgdmFyIG8gPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHZhciB2YWwgPSBvYmpba2V5XTtcbiAgICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiB2YWwpIHtcbiAgICAgIG9ba2V5XSA9IGNsb25lKHZhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ba2V5XSA9IHZhbDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG87XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24gZGVib3VuY2VXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgdGltZW91dCA9IHNldFRpbWVvdXQoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSwgbXMpO1xuICAgIHJldHVybiB0aW1lb3V0O1xuICB9XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vZXZlbnQnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpYWxvZztcblxuZnVuY3Rpb24gRGlhbG9nKGxhYmVsLCBrZXltYXApIHtcbiAgdGhpcy5ub2RlID0gZG9tKGNzcy5kaWFsb2csIFtcbiAgICBgPGxhYmVsPiR7Y3NzLmxhYmVsfWAsXG4gICAgW2Nzcy5pbnB1dCwgW1xuICAgICAgYDxpbnB1dD4ke2Nzcy50ZXh0fWAsXG4gICAgICBjc3MuaW5mb1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmxhYmVsXSwgbGFiZWwpO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25jbGljayA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNlZG93biA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbn1cblxuRGlhbG9nLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbmZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbihlKSB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmhhc0ZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgZG9tLmFwcGVuZChkb2N1bWVudC5ib2R5LCB0aGlzLm5vZGUpO1xuICBkb20uZm9jdXModGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmluZm8gPSBmdW5jdGlvbihpbmZvKSB7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgaW5mbyk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJkaWFsb2dcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19kaWFsb2dcIixcImlucHV0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5wdXRcIixcInRleHRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX190ZXh0XCIsXCJsYWJlbFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2xhYmVsXCIsXCJpbmZvXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5mb1wifSIsIlxubW9kdWxlLmV4cG9ydHMgPSBkaWZmO1xuXG5mdW5jdGlvbiBkaWZmKGEsIGIpIHtcbiAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgYSkge1xuICAgIHZhciBkID0ge307XG4gICAgdmFyIGkgPSAwO1xuICAgIGZvciAodmFyIGsgaW4gYikge1xuICAgICAgaWYgKGFba10gIT09IGJba10pIHtcbiAgICAgICAgZFtrXSA9IGJba107XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGkpIHJldHVybiBkO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhICE9PSBiO1xuICB9XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vYmluZC1yYWYnKTtcbnZhciBtZW1vaXplID0gcmVxdWlyZSgnLi9tZW1vaXplJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxuICBsaW5lSGVpZ2h0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWUuc3BsaXQoJyAnKVswXVxuICAgIH07XG4gICAgZG9tLmNsYXNzZXMobm9kZSwgbmFtZS5zcGxpdCgnICcpLnNsaWNlKDEpKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIGlmIChzdHlsZVtuYW1lXSAhPT0gJ2F1dG8nKVxuICAgICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufSwgZGlmZiwgbWVyZ2UsIGZ1bmN0aW9uKG5vZGUsIHN0eWxlKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBzdHlsZV07XG59KTtcblxuLypcbmRvbS5zdHlsZSA9IGZ1bmN0aW9uKGVsLCBzdHlsZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59O1xuKi9cbmRvbS5jbGFzc2VzID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbn0sIG51bGwsIG51bGwsIGZ1bmN0aW9uKG5vZGUsIGNsYXNzZXMpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIGNsYXNzZXMuY29uY2F0KG5vZGUubmFtZSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKV07XG59KTtcblxuZG9tLmF0dHJzID0gZnVuY3Rpb24oZWwsIGF0dHJzKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBPYmplY3QuYXNzaWduKGVsLCBhdHRycyk7XG59O1xuXG5kb20uaHRtbCA9IGZ1bmN0aW9uKGVsLCBodG1sKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZG9tLnRleHQgPSBmdW5jdGlvbihlbCwgdGV4dCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xufTtcblxuZG9tLmZvY3VzID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmZvY3VzKCk7XG59O1xuXG5kb20uZ2V0U2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlbC5jbGllbnRXaWR0aCxcbiAgICBoZWlnaHQ6IGVsLmNsaWVudEhlaWdodFxuICB9O1xufTtcblxuZG9tLmdldENoYXJTaXplID0gZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHNwYW4uY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuXG4gIGVsLmFwcGVuZENoaWxkKHNwYW4pO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyZuYnNwOyc7XG4gIHZhciBhID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcmbmJzcDsmbmJzcDtcXG4mbmJzcDsnO1xuICB2YXIgYiA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgZWwucmVtb3ZlQ2hpbGQoc3Bhbik7XG5cbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogKGIud2lkdGggLSBhLndpZHRoKSxcbiAgICBoZWlnaHQ6IChiLmhlaWdodCAtIGEuaGVpZ2h0KVxuICB9O1xufTtcblxuZG9tLmdldE9mZnNldCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB2YXIgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCk7XG4gIHZhciBib3JkZXJMZWZ0ID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyTGVmdFdpZHRoKTtcbiAgdmFyIGJvcmRlclRvcCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlclRvcFdpZHRoKTtcbiAgcmV0dXJuIFBvaW50Lmxvdyh7IHg6IDAsIHk6IDAgfSwge1xuICAgIHg6IChyZWN0LmxlZnQgKyBib3JkZXJMZWZ0KSB8IDAsXG4gICAgeTogKHJlY3QudG9wICsgYm9yZGVyVG9wKSB8IDBcbiAgfSk7XG59O1xuXG5kb20uZ2V0U2Nyb2xsID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiBnZXRTY3JvbGwoZWwpO1xufTtcblxuZG9tLm9uc2Nyb2xsID0gZnVuY3Rpb24gb25zY3JvbGwoZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuXG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9IGVsc2Uge1xuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlcihldikge1xuICAgIGZuKGdldFNjcm9sbChlbCkpO1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9mZnNjcm9sbCgpIHtcbiAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxufTtcblxuZG9tLm9ud2hlZWwgPSBmdW5jdGlvbiBvbndoZWVsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCd3aGVlbCcsIGhhbmRsZXIpO1xuICB9IGVsc2Uge1xuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ3doZWVsJywgaGFuZGxlcik7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVyKGV2KSB7XG4gICAgZm4oZXYpO1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9mZndoZWVsKCkge1xuICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3doZWVsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20ucmVtb3ZlID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChlbC5wYXJlbnROb2RlKSBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKTtcbn07XG5cbmRvbS5nZXRFbGVtZW50ID0gZnVuY3Rpb24oZWwpIHtcbiAgcmV0dXJuIGVsLmRvbSAmJiBlbC5kb20uZWwgfHwgZWwuZWwgfHwgZWwubm9kZSB8fCBlbDtcbn07XG5cbmRvbS5zY3JvbGxCeSA9IGZ1bmN0aW9uKGVsLCB4LCB5LCBzY3JvbGwpIHtcbiAgc2Nyb2xsID0gc2Nyb2xsIHx8IGRvbS5nZXRTY3JvbGwoZWwpO1xuICBkb20uc2Nyb2xsVG8oZWwsIHNjcm9sbC54ICsgeCwgc2Nyb2xsLnkgKyB5KTtcbn07XG5cbmRvbS5zY3JvbGxUbyA9IGZ1bmN0aW9uKGVsLCB4LCB5KSB7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIHdpbmRvdy5zY3JvbGxUbyh4LCB5KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5zY3JvbGxMZWZ0ID0geCB8fCAwO1xuICAgIGVsLnNjcm9sbFRvcCA9IHkgfHwgMDtcbiAgfVxufTtcblxuZG9tLmNzcyA9IGZ1bmN0aW9uKGlkLCBjc3NUZXh0KSB7XG4gIGlmICghKGlkIGluIGRvbS5jc3Muc3R5bGVzKSkge1xuICAgIGRvbS5jc3Muc3R5bGVzW2lkXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlc1tpZF0pO1xuICB9XG4gIGRvbS5jc3Muc3R5bGVzW2lkXS50ZXh0Q29udGVudCA9IGNzc1RleHQ7XG59O1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIGlmICh0aGlzLnNpbGVudCkgcmV0dXJuXG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFBvaW50O1xuXG5mdW5jdGlvbiBQb2ludChwKSB7XG4gIGlmIChwKSB7XG4gICAgdGhpcy54ID0gcC54O1xuICAgIHRoaXMueSA9IHAueTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gIH1cbn1cblxuUG9pbnQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy54ID0gcC54O1xuICB0aGlzLnkgPSBwLnk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFBvaW50KHRoaXMpO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28vJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXi8nXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycrJ10gPVxuUG9pbnQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSArIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy0nXSA9XG5Qb2ludC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLSAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC0gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKiddID1cblBvaW50LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeKiddID1cblBvaW50LnByb3RvdHlwZS5jZWlsTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXyonXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUubGVycCA9IGZ1bmN0aW9uKHAsIGEpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKChwLnggLSB0aGlzLngpICogYSksXG4gICAgeTogdGhpcy55ICsgKChwLnkgLSB0aGlzLnkpICogYSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMueCArICcsJyArIHRoaXMueTtcbn07XG5cblBvaW50LnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5Qb2ludC5ncmlkUm91bmQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5yb3VuZChhLnggLyBiLndpZHRoKSxcbiAgICB5OiBNYXRoLnJvdW5kKGEueSAvIGIuaGVpZ2h0KVxuICB9O1xufTtcblxuUG9pbnQubG93ID0gZnVuY3Rpb24obG93LCBwKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5tYXgobG93LngsIHAueCksXG4gICAgeTogTWF0aC5tYXgobG93LnksIHAueSlcbiAgfTtcbn07XG5cblBvaW50LmNsYW1wID0gZnVuY3Rpb24oYXJlYSwgcCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfSk7XG59O1xuXG5Qb2ludC5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7IHg6IGEueCArIGIueCwgeTogYS55ICsgYi55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRYID0gZnVuY3Rpb24oeCwgcCkge1xuICByZXR1cm4geyB4OiBwLnggKyB4LCB5OiBwLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFkgPSBmdW5jdGlvbih5LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCwgeTogcC55ICsgeSB9O1xufTtcblxuUG9pbnQudG9MZWZ0VG9wID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHAueCxcbiAgICB0b3A6IHAueVxuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBBTkQ7XG5cbmZ1bmN0aW9uIEFORChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBOT1Q7XG5cbmZ1bmN0aW9uIE5PVChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJ2YXIgQU5EID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLWFuZCcpO1xudmFyIE5PVCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1ub3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSYW5nZTtcblxuZnVuY3Rpb24gUmFuZ2Uocikge1xuICBpZiAocikge1xuICAgIHRoaXNbMF0gPSByWzBdO1xuICAgIHRoaXNbMV0gPSByWzFdO1xuICB9IGVsc2Uge1xuICAgIHRoaXNbMF0gPSAwO1xuICAgIHRoaXNbMV0gPSAxO1xuICB9XG59O1xuXG5SYW5nZS5BTkQgPSBBTkQ7XG5SYW5nZS5OT1QgPSBOT1Q7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZSh0aGlzKTtcbn07XG5cblJhbmdlLnJhbmdlcyA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHJldHVybiBpdGVtcy5tYXAoZnVuY3Rpb24oaXRlbSkgeyByZXR1cm4gaXRlbS5yYW5nZSB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA+PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdIDw9IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdmVybGFwID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPD0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA+PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzFdIDwgcmFuZ2VbMF0gfHwgaXRlbS5yYW5nZVswXSA+IHJhbmdlWzFdO1xuICB9KTtcbn07XG4iLCJcbnZhciBSZWdleHAgPSBleHBvcnRzO1xuXG5SZWdleHAuY3JlYXRlID0gZnVuY3Rpb24obmFtZXMsIGZsYWdzLCBmbikge1xuICBmbiA9IGZuIHx8IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMgfTtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgbmFtZXNcbiAgICAubWFwKChuKSA9PiAnc3RyaW5nJyA9PT0gdHlwZW9mIG4gPyBSZWdleHAudHlwZXNbbl0gOiBuKVxuICAgIC5tYXAoKHIpID0+IGZuKHIudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkpXG4gICAgLmpvaW4oJ3wnKSxcbiAgICBmbGFnc1xuICApO1xufTtcblxuUmVnZXhwLnR5cGVzID0ge1xuICAndG9rZW5zJzogLy4rP1xcYnwuXFxCfFxcYi4rPy8sXG4gICd3b3Jkcyc6IC9bYS16QS1aMC05XXsxLH0vLFxuICAncGFydHMnOiAvWy4vXFxcXFxcKFxcKVwiJ1xcLTosLjs8Pn4hQCMkJV4mKlxcfFxcKz1cXFtcXF17fWB+XFw/IF0rLyxcblxuICAnc2luZ2xlIGNvbW1lbnQnOiAvXFwvXFwvLio/JC8sXG4gICdkb3VibGUgY29tbWVudCc6IC9cXC9cXCpbXl0qP1xcKlxcLy8sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogLygnKD86KD86XFxcXFxcbnxcXFxcJ3xbXidcXG5dKSkqPycpLyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiAvKFwiKD86KD86XFxcXFxcbnxcXFxcXCJ8W15cIlxcbl0pKSo/XCIpLyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IC8oYCg/Oig/OlxcXFxgfFteYF0pKSo/YCkvLFxuXG4gICdvcGVyYXRvcic6IC8hfD49P3w8PT98PXsxLDN9fCg/OiYpezEsMn18XFx8P1xcfHxcXD98XFwqfFxcL3x+fFxcXnwlfFxcLig/IVxcZCl8XFwrezEsMn18XFwtezEsMn0vLFxuICAnZnVuY3Rpb24nOiAvICgoPyFcXGR8Wy4gXSo/KGlmfGVsc2V8ZG98Zm9yfGNhc2V8dHJ5fGNhdGNofHdoaWxlfHdpdGh8c3dpdGNoKSlbYS16QS1aMC05XyAkXSspKD89XFwoLipcXCkuKnspLyxcbiAgJ2tleXdvcmQnOiAvXFxiKGJyZWFrfGNhc2V8Y2F0Y2h8Y29uc3R8Y29udGludWV8ZGVidWdnZXJ8ZGVmYXVsdHxkZWxldGV8ZG98ZWxzZXxleHBvcnR8ZXh0ZW5kc3xmaW5hbGx5fGZvcnxmcm9tfGlmfGltcGxlbWVudHN8aW1wb3J0fGlufGluc3RhbmNlb2Z8aW50ZXJmYWNlfGxldHxuZXd8cGFja2FnZXxwcml2YXRlfHByb3RlY3RlZHxwdWJsaWN8cmV0dXJufHN0YXRpY3xzdXBlcnxzd2l0Y2h8dGhyb3d8dHJ5fHR5cGVvZnx3aGlsZXx3aXRofHlpZWxkKVxcYi8sXG4gICdkZWNsYXJlJzogL1xcYihmdW5jdGlvbnxpbnRlcmZhY2V8Y2xhc3N8dmFyfGxldHxjb25zdHxlbnVtfHZvaWQpXFxiLyxcbiAgJ2J1aWx0aW4nOiAvXFxiKE9iamVjdHxGdW5jdGlvbnxCb29sZWFufEVycm9yfEV2YWxFcnJvcnxJbnRlcm5hbEVycm9yfFJhbmdlRXJyb3J8UmVmZXJlbmNlRXJyb3J8U3RvcEl0ZXJhdGlvbnxTeW50YXhFcnJvcnxUeXBlRXJyb3J8VVJJRXJyb3J8TnVtYmVyfE1hdGh8RGF0ZXxTdHJpbmd8UmVnRXhwfEFycmF5fEZsb2F0MzJBcnJheXxGbG9hdDY0QXJyYXl8SW50MTZBcnJheXxJbnQzMkFycmF5fEludDhBcnJheXxVaW50MTZBcnJheXxVaW50MzJBcnJheXxVaW50OEFycmF5fFVpbnQ4Q2xhbXBlZEFycmF5fEFycmF5QnVmZmVyfERhdGFWaWV3fEpTT058SW50bHxhcmd1bWVudHN8Y29uc29sZXx3aW5kb3d8ZG9jdW1lbnR8U3ltYm9sfFNldHxNYXB8V2Vha1NldHxXZWFrTWFwfFByb3h5fFJlZmxlY3R8UHJvbWlzZSlcXGIvLFxuICAnc3BlY2lhbCc6IC9cXGIodHJ1ZXxmYWxzZXxudWxsfHVuZGVmaW5lZClcXGIvLFxuICAncGFyYW1zJzogL2Z1bmN0aW9uWyBcXChdezF9W15dKj9cXHsvLFxuICAnbnVtYmVyJzogLy0/XFxiKDB4W1xcZEEtRmEtZl0rfFxcZCpcXC4/XFxkKyhbRWVdWystXT9cXGQrKT98TmFOfC0/SW5maW5pdHkpXFxiLyxcbiAgJ3N5bWJvbCc6IC9be31bXFxdKCksOl0vLFxuICAncmVnZXhwJzogLyg/IVteXFwvXSkoXFwvKD8hW1xcL3xcXCpdKS4qP1teXFxcXFxcXl1cXC8pKFs7XFxuXFwuXFwpXFxdXFx9IGdpbV0pLyxcblxuICAneG1sJzogLzxbXj5dKj4vLFxuICAndXJsJzogLygoXFx3KzpcXC9cXC8pWy1hLXpBLVowLTk6QDs/Jj1cXC8lXFwrXFwuXFwqISdcXChcXCksXFwkX1xce1xcfVxcXn5cXFtcXF1gI3xdKykvLFxuICAnaW5kZW50JzogL14gK3xeXFx0Ky8sXG4gICdsaW5lJzogL14uKyR8Xlxcbi8sXG4gICduZXdsaW5lJzogL1xcclxcbnxcXHJ8XFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJ2YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcblxudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLnNldFRleHQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS51cGRhdGVSYXcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yYXcgPSB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnVwZGF0ZVJhdygpO1xuICB2YXIgYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgYnVmZmVyLnJlcGxhY2UodGhpcyk7XG4gIHJldHVybiBidWZmZXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihkYXRhKSB7XG4gIHRoaXMucmF3ID0gZGF0YS5yYXc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuICB0aGlzLnRva2VucyA9IGRhdGEudG9rZW5zLmNvcHkoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnNldFRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdGhpcy5yYXcgPSB0ZXh0IC8vdGhpcy5zeW50YXguaGlnaGxpZ2h0KHRleHQpO1xuXG4gIHRoaXMuc3ludGF4LnRhYiA9IH50aGlzLnJhdy5pbmRleE9mKCdcXHQnKSA/ICdcXHQnIDogJyAnO1xuXG4gIHRoaXMudGV4dCA9IG5ldyBTa2lwU3RyaW5nO1xuICB0aGlzLnRleHQuc2V0KHRoaXMucmF3KTtcblxuICB0aGlzLnRva2VucyA9IG5ldyBUb2tlbnM7XG4gIHRoaXMudG9rZW5zLmluZGV4KHRoaXMucmF3KTtcbiAgdGhpcy50b2tlbnMub24oJ2NoYW5nZSBzZWdtZW50cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2Ugc2VnbWVudHMnKSk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9XG5CdWZmZXIucHJvdG90eXBlLmluc2VydFRleHRBdFBvaW50ID0gZnVuY3Rpb24ocCwgdGV4dCwgbm9Mb2cpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB2YXIgbGVuZ3RoID0gdGV4dC5sZW5ndGg7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciBzaGlmdCA9ICh0ZXh0Lm1hdGNoKE5FV0xJTkUpIHx8IFtdKS5sZW5ndGg7XG4gIHZhciByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgc2hpZnRdO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuXG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudGV4dC5pbnNlcnQocG9pbnQub2Zmc2V0LCB0ZXh0KTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gdGV4dC5sZW5ndGg7XG4gIHZhciBhZnRlciA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICB0aGlzLnRva2Vucy51cGRhdGUob2Zmc2V0UmFuZ2UsIGFmdGVyLCBsZW5ndGgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUob2Zmc2V0UmFuZ2VbMF0pO1xuXG4gIGlmICghbm9Mb2cpIHtcbiAgICB2YXIgbGFzdExvZyA9IHRoaXMubG9nW3RoaXMubG9nLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0TG9nICYmIGxhc3RMb2dbMF0gPT09ICdpbnNlcnQnICYmIGxhc3RMb2dbMV1bMV0gPT09IHBvaW50Lm9mZnNldCkge1xuICAgICAgbGFzdExvZ1sxXVsxXSArPSB0ZXh0Lmxlbmd0aDtcbiAgICAgIGxhc3RMb2dbMl0gKz0gdGV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cucHVzaChbJ2luc2VydCcsIFtwb2ludC5vZmZzZXQsIHBvaW50Lm9mZnNldCArIHRleHQubGVuZ3RoXSwgdGV4dF0pO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcblxuICByZXR1cm4gdGV4dC5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZSA9XG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZU9mZnNldFJhbmdlID0gZnVuY3Rpb24obywgbm9Mb2cpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgLy8gY29uc29sZS5sb2coJ29mZnNldHMnLCBvKVxuICB2YXIgYSA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1swXSk7XG4gIHZhciBiID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzFdKTtcbiAgdmFyIGxlbmd0aCA9IG9bMF0gLSBvWzFdO1xuICB2YXIgcmFuZ2UgPSBbYS55LCBiLnldO1xuICB2YXIgc2hpZnQgPSBhLnkgLSBiLnk7XG4gIC8vIGNvbnNvbGUubG9nKGEsYilcblxuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvKTtcbiAgdGhpcy50ZXh0LnJlbW92ZShvKTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gbGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vTG9nKSB7XG4gICAgdmFyIGxhc3RMb2cgPSB0aGlzLmxvZ1t0aGlzLmxvZy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExvZyAmJiBsYXN0TG9nWzBdID09PSAncmVtb3ZlJyAmJiBsYXN0TG9nWzFdWzBdID09PSBvWzFdKSB7XG4gICAgICBsYXN0TG9nWzFdWzBdIC09IHRleHQubGVuZ3RoO1xuICAgICAgbGFzdExvZ1syXSA9IHRleHQgKyBsYXN0TG9nWzJdO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZy5wdXNoKFsncmVtb3ZlJywgbywgdGV4dF0pO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlQXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0cyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUNoYXJBdFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQrMV07XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldFJhbmdlKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLmdldExpbmVSYW5nZVRleHQocmFuZ2UpO1xuXG4gIC8vIGNhbGN1bGF0ZSBpbmRlbnQgZm9yIGBjb2RlYFxuICAvL1RPRE86IG1vdmUgdG8gbWV0aG9kXG4gIHZhciBsYXN0ID0gY29kZS5zbGljZShjb2RlLmxhc3RJbmRleE9mKCdcXG4nKSk7XG4gIHZhciBBbnlDaGFyID0gL1xcUy9nO1xuICB2YXIgeSA9IHJhbmdlWzFdO1xuICB2YXIgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMobGFzdCk7XG4gIHdoaWxlICghbWF0Y2ggJiYgeSA8IHRoaXMubG9jKCkpIHtcbiAgICB2YXIgYWZ0ZXIgPSB0aGlzLmdldExpbmVUZXh0KCsreSk7XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGFmdGVyKTtcbiAgfVxuICB2YXIgaW5kZW50ID0gMDtcbiAgaWYgKG1hdGNoKSBpbmRlbnQgPSBtYXRjaC5pbmRleDtcbiAgdmFyIGluZGVudFRleHQgPSAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKHRoaXMuc3ludGF4LnRhYik7XG5cbiAgdmFyIHNlZ21lbnQgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIGlmIChzZWdtZW50KSB7XG4gICAgY29kZSA9IFNFR01FTlRbc2VnbWVudF0gKyAnXFx1ZmZiYVxcbicgKyBjb2RlICsgaW5kZW50VGV4dCArICdcXHVmZmJlKi9gJ1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSk7XG4gICAgY29kZSA9ICc8JyArIHNlZ21lbnRbMF0gKyAnPicgK1xuICAgICAgY29kZS5zdWJzdHJpbmcoXG4gICAgICAgIGNvZGUuaW5kZXhPZignXFx1ZmZiYScpICsgMixcbiAgICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSArIGluZGVudFRleHQgKyAnXFx1ZmZiZSovYCcpO1xuICAgIGNvZGUgPSBjb2RlLnN1YnN0cmluZygwLCBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJykpO1xuICB9XG4gIHJldHVybiBjb2RlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lID0gZnVuY3Rpb24oeSkge1xuICB2YXIgbGluZSA9IG5ldyBMaW5lO1xuICBsaW5lLm9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKFt5LHldKTtcbiAgbGluZS5vZmZzZXQgPSBsaW5lLm9mZnNldFJhbmdlWzBdO1xuICBsaW5lLmxlbmd0aCA9IGxpbmUub2Zmc2V0UmFuZ2VbMV0gLSBsaW5lLm9mZnNldFJhbmdlWzBdIC0gKHkgPCB0aGlzLmxvYygpKTtcbiAgbGluZS5wb2ludC5zZXQoeyB4OjAsIHk6eSB9KTtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShwLnkpO1xuICB2YXIgcG9pbnQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGxpbmUubGVuZ3RoLCBwLngpLFxuICAgIHk6IGxpbmUucG9pbnQueVxuICB9KTtcbiAgcG9pbnQub2Zmc2V0ID0gbGluZS5vZmZzZXQgKyBwb2ludC54O1xuICBwb2ludC5wb2ludCA9IHBvaW50O1xuICBwb2ludC5saW5lID0gbGluZTtcbiAgcmV0dXJuIHBvaW50O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VUZXh0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVSYW5nZU9mZnNldHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVswXSk7XG4gIHZhciBiID0gcmFuZ2VbMV0gPj0gdGhpcy5sb2MoKVxuICAgID8gdGhpcy50ZXh0Lmxlbmd0aFxuICAgIDogdGhpcy5nZXRMaW5lT2Zmc2V0KHJhbmdlWzFdICsgMSk7XG4gIHZhciBvZmZzZXRzID0gW2EsIGJdO1xuICByZXR1cm4gb2Zmc2V0cztcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UmFuZ2VUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0UmFuZ2UpIHtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0UmFuZ2UpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHRva2VuID0gdGhpcy50b2tlbnMuZ2V0QnlPZmZzZXQoJ2xpbmVzJywgb2Zmc2V0IC0gLjUpO1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBvZmZzZXQgLSAob2Zmc2V0ID4gdG9rZW4ub2Zmc2V0ID8gdG9rZW4ub2Zmc2V0ICsgKCEhdG9rZW4ucGFydC5sZW5ndGgpIDogMCksXG4gICAgeTogTWF0aC5taW4odGhpcy5sb2MoKSwgdG9rZW4uaW5kZXggLSAodG9rZW4ub2Zmc2V0ICsgMSA+IG9mZnNldCkgKyAxKVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBjaGFyID0gdGhpcy50ZXh0LmdldFJhbmdlKFtvZmZzZXQsIG9mZnNldCArIDFdKTtcbiAgcmV0dXJuIGNoYXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmVUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB7XG4gICAgbGluZTogbGluZSxcbiAgICB0ZXh0OiB0ZXh0LFxuICB9XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVUZXh0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgdGV4dCA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChbeSx5XSk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhVGV4dCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53b3JkQXJlYUF0UG9pbnQgPSBmdW5jdGlvbihwLCBpbmNsdXNpdmUpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2UocG9pbnQubGluZS5vZmZzZXRSYW5nZSk7XG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZSh0ZXh0LCBXT1JEUyk7XG5cbiAgaWYgKHdvcmRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXJlYTtcbiAgfVxuXG4gIHZhciBsYXN0SW5kZXggPSAwO1xuICB2YXIgd29yZCA9IFtdO1xuICB2YXIgZW5kID0gdGV4dC5sZW5ndGg7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAod29yZC5pbmRleCA+IHBvaW50LnggLSAhIWluY2x1c2l2ZSkge1xuICAgICAgZW5kID0gd29yZC5pbmRleDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBsYXN0SW5kZXggPSB3b3JkLmluZGV4O1xuICB9XG5cbiAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHsgeDogbGFzdEluZGV4LCB5OiBwb2ludC55IH0sXG4gICAgZW5kOiB7IHg6IGVuZCwgeTogcG9pbnQueSB9XG4gIH0pO1xuXG4gIHJldHVybiBhcmVhO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmJlZ2luLnkgKyB5IDwgMCB8fCBhcmVhLmVuZC55ICsgeSA+IHRoaXMubG9jKCkpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwXG4gIGFyZWEuZW5kLnggPSB0aGlzLmdldExpbmUoYXJlYS5lbmQueSkubGVuZ3RoXG5cbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcblxuICB2YXIgeCA9IDBcblxuICBpZiAoeSA+IDAgJiYgYXJlYS5iZWdpbi55ID4gMCB8fCBhcmVhLmVuZC55ID09PSB0aGlzLmxvYygpKSB7XG4gICAgYXJlYS5iZWdpbi55IC09IDFcbiAgICBhcmVhLmJlZ2luLnggPSB0aGlzLmdldExpbmUoYXJlYS5iZWdpbi55KS5sZW5ndGhcbiAgICBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSlcbiAgICB4ID0gSW5maW5pdHlcbiAgfSBlbHNlIHtcbiAgICBvZmZzZXRzWzFdICs9IDFcbiAgfVxuXG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpXG5cbiAgdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRzKVxuXG4gIHRoaXMuaW5zZXJ0KHsgeDogeCwgeTphcmVhLmJlZ2luLnkgKyB5IH0sIHRleHQpO1xuXG4gIHJldHVybiB0cnVlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciByYW5nZSA9IFtcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pLm9mZnNldCxcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuZW5kKS5vZmZzZXRcbiAgXTtcbiAgcmV0dXJuIHJhbmdlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lT2Zmc2V0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgb2Zmc2V0ID0geSA8IDAgPyAtMSA6IHkgPT09IDAgPyAwIDogdGhpcy50b2tlbnMuZ2V0QnlJbmRleCgnbGluZXMnLCB5IC0gMSkgKyAxO1xuICByZXR1cm4gb2Zmc2V0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5sb2MgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zLmdldENvbGxlY3Rpb24oJ2xpbmVzJykubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50ZXh0LnRvU3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiBMaW5lKCkge1xuICB0aGlzLm9mZnNldFJhbmdlID0gW107XG4gIHRoaXMub2Zmc2V0ID0gMDtcbiAgdGhpcy5sZW5ndGggPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFT0wocykge1xuICByZXR1cm4gcy5yZXBsYWNlKEVPTCwgJ1xcbicpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEluZGV4ZXI7XG5cbmZ1bmN0aW9uIEluZGV4ZXIoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xufVxuXG5JbmRleGVyLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ocykge1xuICBpZiAoIXMpIHJldHVybiBbXTtcbiAgdmFyIG9mZnNldHMgPSBbXTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5yYXc7XG4gIHZhciBsZW4gPSBzLmxlbmd0aDtcbiAgdmFyIGluZGV4O1xuICB3aGlsZSAofihpbmRleCA9IHRleHQuaW5kZXhPZihzLCBpbmRleCArIGxlbikpKSB7XG4gICAgb2Zmc2V0cy5wdXNoKGluZGV4KTtcbiAgfVxuICByZXR1cm4gb2Zmc2V0cztcbn07XG4iLCJ2YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQYXJ0cztcblxuZnVuY3Rpb24gUGFydHMobWluU2l6ZSkge1xuICBtaW5TaXplID0gbWluU2l6ZSB8fCA1MDAwO1xuICB0aGlzLm1pblNpemUgPSBtaW5TaXplO1xuICB0aGlzLnBhcnRzID0gW107XG4gIHRoaXMubGVuZ3RoID0gMDtcbn1cblxuUGFydHMucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihpdGVtKSB7XG4gIHRoaXMuYXBwZW5kKFtpdGVtXSk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHBhcnQgPSBsYXN0KHRoaXMucGFydHMpO1xuXG4gIGlmICghcGFydCkge1xuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSAwO1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSAwO1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuICBlbHNlIGlmIChwYXJ0Lmxlbmd0aCA+PSB0aGlzLm1pblNpemUpIHtcbiAgICB2YXIgc3RhcnRJbmRleCA9IHBhcnQuc3RhcnRJbmRleCArIHBhcnQubGVuZ3RoO1xuICAgIHZhciBzdGFydE9mZnNldCA9IGl0ZW1zWzBdO1xuXG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IHN0YXJ0SW5kZXg7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IHN0YXJ0T2Zmc2V0O1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuXG4gIHBhcnQucHVzaC5hcHBseShwYXJ0LCBpdGVtcy5tYXAob2Zmc2V0ID0+IG9mZnNldCAtIHBhcnQuc3RhcnRPZmZzZXQpKTtcblxuICB0aGlzLmxlbmd0aCArPSBpdGVtcy5sZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgdmFyIHBhcnQgPSB0aGlzLmZpbmRQYXJ0QnlJbmRleChpbmRleCkuaXRlbTtcbiAgcmV0dXJuIHBhcnRbTWF0aC5taW4ocGFydC5sZW5ndGggLSAxLCBpbmRleCAtIHBhcnQuc3RhcnRJbmRleCldICsgcGFydC5zdGFydE9mZnNldDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBwID0gdGhpcy5maW5kUGFydEJ5T2Zmc2V0KG9mZnNldCk7XG4gIGlmICghcC5pdGVtKSByZXR1cm4gbnVsbDtcblxuICB2YXIgcGFydCA9IHAuaXRlbTtcbiAgdmFyIHBhcnRJbmRleCA9IHAuaW5kZXg7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydCk7XG4gIHJldHVybiB7XG4gICAgb2Zmc2V0OiBvLml0ZW0gKyBwYXJ0LnN0YXJ0T2Zmc2V0LFxuICAgIGluZGV4OiBvLmluZGV4ICsgcGFydC5zdGFydEluZGV4LFxuICAgIGxvY2FsOiBvLmluZGV4LFxuICAgIHBhcnQ6IHBhcnQsXG4gICAgcGFydEluZGV4OiBwYXJ0SW5kZXhcbiAgfTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIGFycmF5KSB7XG4gIHZhciBvID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghbykge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZChhcnJheSk7XG4gIH1cbiAgaWYgKG8ub2Zmc2V0ID4gb2Zmc2V0KSBvLmxvY2FsID0gLTE7XG4gIHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG4gIC8vVE9ETzogbWF5YmUgc3VidHJhY3QgJ29mZnNldCcgaW5zdGVhZCA/XG4gIGFycmF5ID0gYXJyYXkubWFwKGVsID0+IGVsIC09IG8ucGFydC5zdGFydE9mZnNldCk7XG4gIGluc2VydChvLnBhcnQsIG8ubG9jYWwgKyAxLCBhcnJheSk7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIC1sZW5ndGgpO1xuICB0aGlzLmxlbmd0aCArPSBsZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHNoaWZ0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHM7XG4gIHZhciBpdGVtID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghaXRlbSkgcmV0dXJuO1xuICBpZiAob2Zmc2V0ID4gaXRlbS5vZmZzZXQpIGl0ZW0ubG9jYWwgKz0gMTtcblxuICB2YXIgcmVtb3ZlZCA9IDA7XG4gIGZvciAodmFyIGkgPSBpdGVtLmxvY2FsOyBpIDwgaXRlbS5wYXJ0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaXRlbS5wYXJ0W2ldICs9IHNoaWZ0O1xuICAgIGlmIChpdGVtLnBhcnRbaV0gKyBpdGVtLnBhcnQuc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIHJlbW92ZWQrKztcbiAgICAgIGl0ZW0ucGFydC5zcGxpY2UoaS0tLCAxKTtcbiAgICB9XG4gIH1cbiAgaWYgKHJlbW92ZWQpIHtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoaXRlbS5wYXJ0SW5kZXggKyAxLCByZW1vdmVkKTtcbiAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICB9XG4gIGZvciAodmFyIGkgPSBpdGVtLnBhcnRJbmRleCArIDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0ICs9IHNoaWZ0O1xuICAgIGlmIChwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgaWYgKGxhc3QocGFydHNbaV0pICsgcGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgICAgcmVtb3ZlZCA9IHBhcnRzW2ldLmxlbmd0aDtcbiAgICAgICAgdGhpcy5zaGlmdEluZGV4KGkgKyAxLCByZW1vdmVkKTtcbiAgICAgICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgICAgICAgcGFydHMuc3BsaWNlKGktLSwgMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlbW92ZUJlbG93T2Zmc2V0KG9mZnNldCwgcGFydHNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmZpbmQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHRoaXMuZmluZChyYW5nZVsxXSk7XG4gIGlmICghYSAmJiAhYikgcmV0dXJuO1xuXG4gIGlmIChhLnBhcnRJbmRleCA9PT0gYi5wYXJ0SW5kZXgpIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0ID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoYS5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gICAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdEEgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsKS5sZW5ndGg7XG4gICAgdmFyIHNoaWZ0QiA9IHJlbW92ZShiLnBhcnQsIDAsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgaWYgKGIucGFydEluZGV4IC0gYS5wYXJ0SW5kZXggPiAxKSB7XG4gICAgICB2YXIgcmVtb3ZlZCA9IHJlbW92ZSh0aGlzLnBhcnRzLCBhLnBhcnRJbmRleCArIDEsIGIucGFydEluZGV4KTtcbiAgICAgIHZhciBzaGlmdEJldHdlZW4gPSByZW1vdmVkLnJlZHVjZSgocCxuKSA9PiBwICsgbi5sZW5ndGgsIDApO1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBICsgc2hpZnRCZXR3ZWVuO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4IC0gcmVtb3ZlZC5sZW5ndGggKyAxLCBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW4pO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuO1xuICAgIH0gZWxzZSB7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEE7XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggKyAxLCBzaGlmdEEgKyBzaGlmdEIpO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCO1xuICAgIH1cbiAgfVxuXG4gIC8vVE9ETzogdGhpcyBpcyBpbmVmZmljaWVudCBhcyB3ZSBjYW4gY2FsY3VsYXRlIHRoZSBpbmRleGVzIG91cnNlbHZlc1xuICBpZiAoIWEucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYS5wYXJ0KSwgMSk7XG4gIH1cbiAgaWYgKCFiLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGIucGFydCksIDEpO1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRJbmRleCA9IGZ1bmN0aW9uKHN0YXJ0SW5kZXgsIHNoaWZ0KSB7XG4gIGZvciAodmFyIGkgPSBzdGFydEluZGV4OyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMucGFydHNbaV0uc3RhcnRJbmRleCAtPSBzaGlmdDtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZUJlbG93T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydClcbiAgdmFyIHNoaWZ0ID0gcmVtb3ZlKHBhcnQsIDAsIG8uaW5kZXgpLmxlbmd0aDtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kT2Zmc2V0SW5QYXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIG9mZnNldCAtPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHBhcnQsIG8gPT4gbyA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlJbmRleCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0SW5kZXggPD0gaW5kZXgpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRPZmZzZXQgPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnBhcnRzLnJlZHVjZSgocCxuKSA9PiBwLmNvbmNhdChuKSwgW10pO1xufTtcblxuUGFydHMucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwYXJ0cyA9IG5ldyBQYXJ0cyh0aGlzLm1pblNpemUpO1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiB7XG4gICAgdmFyIHAgPSBwYXJ0LnNsaWNlKCk7XG4gICAgcC5zdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4O1xuICAgIHAuc3RhcnRPZmZzZXQgPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICAgIHBhcnRzLnBhcnRzLnB1c2gocCk7XG4gIH0pO1xuICBwYXJ0cy5sZW5ndGggPSB0aGlzLmxlbmd0aDtcbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuZnVuY3Rpb24gbGFzdChhcnJheSkge1xuICByZXR1cm4gYXJyYXlbYXJyYXkubGVuZ3RoIC0gMV07XG59XG5cbmZ1bmN0aW9uIHJlbW92ZShhcnJheSwgYSwgYikge1xuICBpZiAoYiA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEsIGIgLSBhKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBpbmRleCwgYXJyYXkpIHtcbiAgdmFyIG9wID0gYXJyYXkuc2xpY2UoKTtcbiAgb3AudW5zaGlmdChpbmRleCwgMCk7XG4gIHRhcmdldC5zcGxpY2UuYXBwbHkodGFyZ2V0LCBvcCk7XG59XG4iLCIvLyB2YXIgV09SRCA9IC9cXHcrL2c7XG52YXIgV09SRCA9IC9bYS16QS1aMC05XXsxLH0vZ1xudmFyIHJhbmsgPSAwO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFByZWZpeFRyZWVOb2RlO1xuXG5mdW5jdGlvbiBQcmVmaXhUcmVlTm9kZSgpIHtcbiAgdGhpcy52YWx1ZSA9ICcnO1xuICB0aGlzLnJhbmsgPSAwO1xuICB0aGlzLmNoaWxkcmVuID0ge307XG59XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5nZXRDaGlsZHJlbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2hpbGRyZW4gPSBPYmplY3RcbiAgICAua2V5cyh0aGlzLmNoaWxkcmVuKVxuICAgIC5tYXAoKGtleSkgPT4gdGhpcy5jaGlsZHJlbltrZXldKTtcblxuICByZXR1cm4gY2hpbGRyZW4ucmVkdWNlKChwLCBuKSA9PiBwLmNvbmNhdChuLmdldENoaWxkcmVuKCkpLCBjaGlsZHJlbik7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuY29sbGVjdCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgY29sbGVjdGlvbiA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuZmluZChrZXkpO1xuICBpZiAobm9kZSkge1xuICAgIGNvbGxlY3Rpb24gPSBub2RlXG4gICAgICAuZ2V0Q2hpbGRyZW4oKVxuICAgICAgLmZpbHRlcigobm9kZSkgPT4gbm9kZS52YWx1ZSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIHZhciByZXMgPSBiLnJhbmsgLSBhLnJhbms7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGIudmFsdWUubGVuZ3RoIC0gYS52YWx1ZS5sZW5ndGg7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGEudmFsdWUgPiBiLnZhbHVlO1xuICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgfSk7XG5cbiAgICBpZiAobm9kZS52YWx1ZSkgY29sbGVjdGlvbi5wdXNoKG5vZGUpO1xuICB9XG4gIHJldHVybiBjb2xsZWN0aW9uO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICBmb3IgKHZhciBjaGFyIGluIGtleSkge1xuICAgIGlmIChrZXlbY2hhcl0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5ba2V5W2NoYXJdXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbm9kZTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIHZhciBpID0gMDtcbiAgdmFyIG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBpZiAoc1tpXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltzW2ldXTtcbiAgICAgIGkrKztcbiAgICB9IGVsc2Uge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgbm9kZSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSB8fCBuZXcgUHJlZml4VHJlZU5vZGU7XG4gICAgaSsrO1xuICB9XG5cbiAgbm9kZS52YWx1ZSA9IHM7XG4gIG5vZGUucmFuaysrO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24ocykge1xuICB2YXIgd29yZDtcbiAgd2hpbGUgKHdvcmQgPSBXT1JELmV4ZWMocykpIHtcbiAgICB0aGlzLmluc2VydCh3b3JkWzBdKTtcbiAgfVxufTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG52YXIgVG9rZW5zID0gcmVxdWlyZSgnLi90b2tlbnMnKTtcbnZhciBUeXBlID0gVG9rZW5zLlR5cGU7XG5cbnZhciBCZWdpbiA9IC9bXFwvJ1wiYF0vZztcblxudmFyIE1hdGNoID0ge1xuICAnc2luZ2xlIGNvbW1lbnQnOiBbJy8vJywnXFxuJ10sXG4gICdkb3VibGUgY29tbWVudCc6IFsnLyonLCcqLyddLFxuICAndGVtcGxhdGUgc3RyaW5nJzogWydgJywnYCddLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFtcIidcIixcIidcIl0sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogWydcIicsJ1wiJ10sXG4gICdyZWdleHAnOiBbJy8nLCcvJ10sXG59O1xuXG52YXIgU2tpcCA9IHtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ3NpbmdsZSBjb21tZW50JzogZmFsc2UsXG4gICdkb3VibGUgY29tbWVudCc6IGZhbHNlLFxuICAncmVnZXhwJzogXCJcXFxcXCIsXG59O1xuXG52YXIgVG9rZW4gPSB7fTtcbmZvciAodmFyIGtleSBpbiBNYXRjaCkge1xuICB2YXIgTSA9IE1hdGNoW2tleV07XG4gIFRva2VuW01bMF1dID0ga2V5O1xufVxuXG52YXIgTGVuZ3RoID0ge1xuICAnb3BlbiBjb21tZW50JzogMixcbiAgJ2Nsb3NlIGNvbW1lbnQnOiAyLFxuICAndGVtcGxhdGUgc3RyaW5nJzogMSxcbn07XG5cbnZhciBOb3RPcGVuID0ge1xuICAnY2xvc2UgY29tbWVudCc6IHRydWVcbn07XG5cbnZhciBDbG9zZXMgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY2xvc2UgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUYWcgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAnc3RyaW5nJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudHM7XG5cbmZ1bmN0aW9uIFNlZ21lbnRzKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbiAgdGhpcy5jYWNoZSA9IHt9O1xuICB0aGlzLnJlc2V0KCk7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5jbGVhckNhY2hlID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQpIHtcbiAgICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMub2Zmc2V0IDwgb2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLmNhY2hlLnN0YXRlLnNwbGljZShzLmluZGV4KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmNhY2hlLnN0YXRlID0gW107XG4gIH1cbiAgdGhpcy5jYWNoZS5vZmZzZXQgPSB7fTtcbiAgdGhpcy5jYWNoZS5yYW5nZSA9IHt9O1xuICB0aGlzLmNhY2hlLnBvaW50ID0ge307XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhckNhY2hlKCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSBpbiB0aGlzLmNhY2hlLnBvaW50KSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGUucG9pbnRbeV07XG4gIH1cblxuICB2YXIgc2VnbWVudHMgPSB0aGlzLmJ1ZmZlci50b2tlbnMuZ2V0Q29sbGVjdGlvbignc2VnbWVudHMnKTtcbiAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgdmFyIHN0YXRlID0gbnVsbDtcbiAgdmFyIHdhaXRGb3IgPSAnJztcbiAgdmFyIHBvaW50ID0geyB4Oi0xLCB5Oi0xIH07XG4gIHZhciBjbG9zZSA9IDA7XG4gIHZhciBvZmZzZXQ7XG4gIHZhciBzZWdtZW50O1xuICB2YXIgcmFuZ2U7XG4gIHZhciB0ZXh0O1xuICB2YXIgdmFsaWQ7XG4gIHZhciBsYXN0O1xuXG4gIHZhciBsYXN0Q2FjaGVTdGF0ZU9mZnNldCA9IDA7XG5cbiAgdmFyIGkgPSAwO1xuXG4gIHZhciBjYWNoZVN0YXRlID0gdGhpcy5nZXRDYWNoZVN0YXRlKHkpO1xuICBpZiAoY2FjaGVTdGF0ZSAmJiBjYWNoZVN0YXRlLml0ZW0pIHtcbiAgICBvcGVuID0gdHJ1ZTtcbiAgICBzdGF0ZSA9IGNhY2hlU3RhdGUuaXRlbTtcbiAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgIGkgPSBzdGF0ZS5pbmRleCArIDE7XG4gIH1cblxuICBmb3IgKDsgaSA8IHNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb2Zmc2V0ID0gc2VnbWVudHMuZ2V0KGkpO1xuICAgIHNlZ21lbnQgPSB7XG4gICAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICAgIHR5cGU6IFR5cGVbdGhpcy5idWZmZXIuY2hhckF0KG9mZnNldCldXG4gICAgfTtcblxuICAgIC8vIHNlYXJjaGluZyBmb3IgY2xvc2UgdG9rZW5cbiAgICBpZiAob3Blbikge1xuICAgICAgaWYgKHdhaXRGb3IgPT09IHNlZ21lbnQudHlwZSkge1xuICAgICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFzdCA9IHNlZ21lbnQ7XG4gICAgICAgIGxhc3QucG9pbnQgPSBwb2ludDtcbiAgICAgICAgc3RhdGUgPSBudWxsO1xuICAgICAgICBvcGVuID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBvcGVuIHRva2VuXG4gICAgZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgfVxuXG4gICAgICByYW5nZSA9IHRoaXMuYnVmZmVyLmdldExpbmUocG9pbnQueSkub2Zmc2V0UmFuZ2U7XG5cbiAgICAgIGlmIChsYXN0ICYmIGxhc3QucG9pbnQueSA9PT0gcG9pbnQueSkge1xuICAgICAgICBjbG9zZSA9IGxhc3QucG9pbnQueCArIExlbmd0aFtsYXN0LnR5cGVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2xvc2UgPSAwO1xuICAgICAgfVxuXG4gICAgICB2YWxpZCA9IHRoaXMuaXNWYWxpZFJhbmdlKFtyYW5nZVswXSwgcmFuZ2VbMV0rMV0sIHNlZ21lbnQsIGNsb3NlKTtcblxuICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgIGlmIChOb3RPcGVuW3NlZ21lbnQudHlwZV0pIGNvbnRpbnVlO1xuICAgICAgICBvcGVuID0gdHJ1ZTtcbiAgICAgICAgc3RhdGUgPSBzZWdtZW50O1xuICAgICAgICBzdGF0ZS5pbmRleCA9IGk7XG4gICAgICAgIHN0YXRlLnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIC8vIHN0YXRlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLm9mZnNldCB9O1xuICAgICAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgICAgICBpZiAoIXRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIHx8IHRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoICYmIHN0YXRlLm9mZnNldCA+IHRoaXMuY2FjaGUuc3RhdGVbdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggLSAxXS5vZmZzZXQpIHtcbiAgICAgICAgICB0aGlzLmNhY2hlLnN0YXRlLnB1c2goc3RhdGUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzdGF0ZSAmJiBzdGF0ZS5wb2ludC55IDwgeSkge1xuICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gIH1cblxuICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbn07XG5cbi8vVE9ETzogY2FjaGUgaW4gQnVmZmVyXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCBpbiB0aGlzLmNhY2hlLm9mZnNldCkgcmV0dXJuIHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF07XG4gIHJldHVybiAodGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XSA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCkpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlLCBzZWdtZW50LCBjbG9zZSkge1xuICB2YXIga2V5ID0gcmFuZ2Uuam9pbigpO1xuICBpZiAoa2V5IGluIHRoaXMuY2FjaGUucmFuZ2UpIHJldHVybiB0aGlzLmNhY2hlLnJhbmdlW2tleV07XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UmFuZ2VUZXh0KHJhbmdlKTtcbiAgdmFyIHZhbGlkID0gdGhpcy5pc1ZhbGlkKHRleHQsIHNlZ21lbnQub2Zmc2V0IC0gcmFuZ2VbMF0sIGNsb3NlKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnJhbmdlW2tleV0gPSB2YWxpZCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCwgbGFzdEluZGV4KSB7XG4gIEJlZ2luLmxhc3RJbmRleCA9IGxhc3RJbmRleDtcblxuICB2YXIgbWF0Y2ggPSBCZWdpbi5leGVjKHRleHQpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG5cbiAgdmFyIGkgPSBtYXRjaC5pbmRleDtcblxuICB2YXIgbGFzdCA9IGk7XG5cbiAgdmFyIHZhbGlkID0gdHJ1ZTtcblxuICBvdXRlcjpcbiAgZm9yICg7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIG9uZSA9IHRleHRbaV07XG4gICAgdmFyIG5leHQgPSB0ZXh0W2kgKyAxXTtcbiAgICB2YXIgdHdvID0gb25lICsgbmV4dDtcbiAgICBpZiAoaSA9PT0gb2Zmc2V0KSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciBvID0gVG9rZW5bdHdvXTtcbiAgICBpZiAoIW8pIG8gPSBUb2tlbltvbmVdO1xuICAgIGlmICghbykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgdmFyIHdhaXRGb3IgPSBNYXRjaFtvXVsxXTtcblxuICAgIGxhc3QgPSBpO1xuXG4gICAgc3dpdGNoICh3YWl0Rm9yLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IG9uZSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDE7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcblxuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG4gICAgICAgICAgdHdvID0gdGV4dFtpXSArIHRleHRbaSArIDFdO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IHR3bykge1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDI7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsaWQ7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRDYWNoZVN0YXRlID0gZnVuY3Rpb24oeSkge1xuICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMucG9pbnQueSA8IHkpO1xuICBpZiAocy5pdGVtICYmIHkgLSAxIDwgcy5pdGVtLnBvaW50LnkpIHJldHVybiBudWxsO1xuICBlbHNlIHJldHVybiBzO1xuICAvLyByZXR1cm4gcztcbn07XG4iLCIvKlxuXG5leGFtcGxlIHNlYXJjaCBmb3Igb2Zmc2V0IGA0YCA6XG5gb2AgYXJlIG5vZGUncyBsZXZlbHMsIGB4YCBhcmUgdHJhdmVyc2FsIHN0ZXBzXG5cbnhcbnhcbm8tLT54ICAgbyAgIG9cbm8gbyB4ICAgbyAgIG8gbyBvXG5vIG8gby14IG8gbyBvIG8gb1xuMSAyIDMgNCA1IDYgNyA4IDlcblxuKi9cblxubW9kdWxlLmV4cG9ydHMgPSBTa2lwU3RyaW5nO1xuXG5mdW5jdGlvbiBOb2RlKHZhbHVlLCBsZXZlbCkge1xuICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gIHRoaXMubGV2ZWwgPSBsZXZlbDtcbiAgdGhpcy53aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKHZhbHVlICYmIHZhbHVlLmxlbmd0aCB8fCAwKTtcbiAgdGhpcy5uZXh0ID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwobnVsbCk7XG59XG5cbk5vZGUucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLndpZHRoWzBdO1xuICB9XG59O1xuXG5mdW5jdGlvbiBTa2lwU3RyaW5nKG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMubGV2ZWxzID0gby5sZXZlbHMgfHwgMTE7XG4gIHRoaXMuYmlhcyA9IG8uYmlhcyB8fCAxIC8gTWF0aC5FO1xuICB0aGlzLmhlYWQgPSBuZXcgTm9kZShudWxsLCB0aGlzLmxldmVscyk7XG4gIHRoaXMuY2h1bmtTaXplID0gby5jaHVua1NpemUgfHwgNTAwMDtcbn1cblxuU2tpcFN0cmluZy5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuaGVhZC53aWR0aFt0aGlzLmxldmVscyAtIDFdO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgLy8gZ3JlYXQgaGFjayB0byBkbyBvZmZzZXQgPj0gZm9yIC5zZWFyY2goKVxuICAvLyB3ZSBkb24ndCBoYXZlIGZyYWN0aW9ucyBhbnl3YXkgc28uLlxuICByZXR1cm4gdGhpcy5zZWFyY2gob2Zmc2V0LCB0cnVlKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5pbnNlcnRDaHVua2VkKDAsIHRleHQpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24ob2Zmc2V0LCBpbmNsKSB7XG4gIGluY2wgPSBpbmNsID8gLjEgOiAwO1xuXG4gIC8vIHByZXBhcmUgdG8gaG9sZCBzdGVwc1xuICB2YXIgc3RlcHMgPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuICB2YXIgd2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuXG4gIC8vIGl0ZXJhdGUgbGV2ZWxzIGRvd24sIHNraXBwaW5nIHRvcFxuICB2YXIgaSA9IHRoaXMubGV2ZWxzO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgd2hpbGUgKG9mZnNldCArIGluY2wgPiBub2RlLndpZHRoW2ldICYmIG51bGwgIT0gbm9kZS5uZXh0W2ldKSB7XG4gICAgICBvZmZzZXQgLT0gbm9kZS53aWR0aFtpXTtcbiAgICAgIG5vZGUgPSBub2RlLm5leHRbaV07XG4gICAgfVxuICAgIHN0ZXBzW2ldID0gbm9kZTtcbiAgICB3aWR0aFtpXSA9IG9mZnNldDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbm9kZTogbm9kZSxcbiAgICBzdGVwczogc3RlcHMsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIG9mZnNldDogb2Zmc2V0XG4gIH07XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zcGxpY2UgPSBmdW5jdGlvbihzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzOyAvLyBza2lwIHN0ZXBzIGxlZnQgb2YgdGhlIG9mZnNldFxuICB2YXIgd2lkdGggPSBzLndpZHRoO1xuXG4gIHZhciBwOyAvLyBsZWZ0IG5vZGUgb3IgYHBgXG4gIHZhciBxOyAvLyByaWdodCBub2RlIG9yIGBxYCAob3VyIG5ldyBub2RlKVxuICB2YXIgbGVuO1xuXG4gIC8vIGNyZWF0ZSBuZXcgbm9kZVxuICBsZXZlbCA9IGxldmVsIHx8IHRoaXMucmFuZG9tTGV2ZWwoKTtcbiAgcSA9IG5ldyBOb2RlKHZhbHVlLCBsZXZlbCk7XG4gIGxlbmd0aCA9IHEud2lkdGhbMF07XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBsZXZlbHMgYmVsb3cgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IGxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWwgc3RlcFxuICAgIHEubmV4dFtpXSA9IHAubmV4dFtpXTsgLy8gaW5zZXJ0IHNvIGluaGVyaXQgbGVmdCdzIG5leHRcbiAgICBwLm5leHRbaV0gPSBxOyAvLyBsZWZ0J3MgbmV4dCBpcyBub3cgb3VyIG5ldyBub2RlXG4gICAgcS53aWR0aFtpXSA9IHAud2lkdGhbaV0gLSB3aWR0aFtpXSArIGxlbmd0aDtcbiAgICBwLndpZHRoW2ldID0gd2lkdGhbaV07XG4gIH1cblxuICAvLyBpdGVyYXRlIHN0ZXBzIGFsbCBsZXZlbHMgZG93biB1bnRpbCBleGNlcHQgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbGV2ZWwpIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbFxuICAgIHAud2lkdGhbaV0gKz0gbGVuZ3RoOyAvLyBhZGQgbmV3IG5vZGUgd2lkdGhcbiAgfVxuXG4gIC8vIHJldHVybiBuZXcgbm9kZVxuICByZXR1cm4gcTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzID0gdGhpcy5zZWFyY2gob2Zmc2V0KTtcblxuICAvLyBpZiBzZWFyY2ggZmFsbHMgaW4gdGhlIG1pZGRsZSBvZiBhIHN0cmluZ1xuICAvLyBpbnNlcnQgaXQgdGhlcmUgaW5zdGVhZCBvZiBjcmVhdGluZyBhIG5ldyBub2RlXG4gIGlmIChzLm9mZnNldCAmJiBzLm5vZGUudmFsdWUgJiYgcy5vZmZzZXQgPCBzLm5vZGUudmFsdWUubGVuZ3RoKSB7XG4gICAgdGhpcy51cGRhdGUocywgaW5zZXJ0KHMub2Zmc2V0LCBzLm5vZGUudmFsdWUsIHZhbHVlKSk7XG4gICAgcmV0dXJuIHMubm9kZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLnNwbGljZShzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICAvLyB2YWx1ZXMgbGVuZ3RoIGRpZmZlcmVuY2VcbiAgdmFyIGxlbmd0aCA9IHMubm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgLy8gdXBkYXRlIHZhbHVlXG4gIHMubm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGZpeCB3aWR0aHMgb24gYWxsIGxldmVsc1xuICBpID0gdGhpcy5sZXZlbHM7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHMuc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmIChyYW5nZVsxXSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ3JhbmdlIGVuZCBvdmVyIG1heGltdW0gbGVuZ3RoKCcgK1xuICAgICAgdGhpcy5sZW5ndGggKyAnKTogWycgKyByYW5nZS5qb2luKCkgKyAnXSdcbiAgICApO1xuICB9XG5cbiAgLy8gcmVtYWluIGRpc3RhbmNlIHRvIHJlbW92ZVxuICB2YXIgeCA9IHJhbmdlWzFdIC0gcmFuZ2VbMF07XG5cbiAgLy8gc2VhcmNoIGZvciBub2RlIG9uIGxlZnQgZWRnZVxuICB2YXIgcyA9IHRoaXMuc2VhcmNoKHJhbmdlWzBdKTtcbiAgdmFyIG9mZnNldCA9IHMub2Zmc2V0O1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzO1xuICB2YXIgbm9kZSA9IHMubm9kZTtcblxuICAvLyBza2lwIGhlYWRcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAvLyBzbGljZSBsZWZ0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmIChvZmZzZXQpIHtcbiAgICBpZiAob2Zmc2V0IDwgbm9kZS53aWR0aFswXSkge1xuICAgICAgeCAtPSB0aGlzLnVwZGF0ZShzLFxuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKDAsIG9mZnNldCkgK1xuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKFxuICAgICAgICAgIG9mZnNldCArXG4gICAgICAgICAgTWF0aC5taW4oeCwgbm9kZS5sZW5ndGggLSBvZmZzZXQpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAgIGlmICghbm9kZSkgcmV0dXJuO1xuICB9XG5cbiAgLy8gcmVtb3ZlIGFsbCBmdWxsIG5vZGVzIGluIHJhbmdlXG4gIHdoaWxlIChub2RlICYmIHggPj0gbm9kZS53aWR0aFswXSkge1xuICAgIHggLT0gdGhpcy5yZW1vdmVOb2RlKHN0ZXBzLCBub2RlKTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG5cbiAgLy8gc2xpY2UgcmlnaHQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKHgpIHtcbiAgICB0aGlzLnJlcGxhY2Uoc3RlcHMsIG5vZGUsIG5vZGUudmFsdWUuc2xpY2UoeCkpO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVOb2RlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUud2lkdGhbMF07XG5cbiAgdmFyIGk7XG5cbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGggLSBub2RlLndpZHRoW2ldO1xuICAgIHN0ZXBzW2ldLm5leHRbaV0gPSBub2RlLm5leHRbaV07XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihzdGVwcywgbm9kZSwgdmFsdWUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIG5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICB2YXIgaTtcbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBub2RlLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlQ2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnJlbW92ZShbb2Zmc2V0LCBvZmZzZXQrMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0Q2h1bmtlZCA9IGZ1bmN0aW9uKG9mZnNldCwgdGV4dCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRleHQubGVuZ3RoOyBpICs9IHRoaXMuY2h1bmtTaXplKSB7XG4gICAgdmFyIGNodW5rID0gdGV4dC5zdWJzdHIoaSwgdGhpcy5jaHVua1NpemUpO1xuICAgIHRoaXMuaW5zZXJ0KGkgKyBvZmZzZXQsIGNodW5rKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3Vic3RyaW5nID0gZnVuY3Rpb24oYSwgYikge1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKDAsIHRoaXMubGVuZ3RoKTtcbn07XG5cbmZ1bmN0aW9uIHRyaW0ocywgbGVmdCwgcmlnaHQpIHtcbiAgcmV0dXJuIHMuc3Vic3RyKDAsIHMubGVuZ3RoIC0gcmlnaHQpLnN1YnN0cihsZWZ0KTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG52YXIgUiA9IFJlZ2V4cC5jcmVhdGU7XG5cbi8vTk9URTogb3JkZXIgbWF0dGVyc1xudmFyIHN5bnRheCA9IG1hcCh7XG4gICd0JzogUihbJ29wZXJhdG9yJ10sICdnJywgZW50aXRpZXMpLFxuICAnbSc6IFIoWydwYXJhbXMnXSwgICAnZycpLFxuICAnZCc6IFIoWydkZWNsYXJlJ10sICAnZycpLFxuICAnZic6IFIoWydmdW5jdGlvbiddLCAnZycpLFxuICAnayc6IFIoWydrZXl3b3JkJ10sICAnZycpLFxuICAnbic6IFIoWydidWlsdGluJ10sICAnZycpLFxuICAnbCc6IFIoWydzeW1ib2wnXSwgICAnZycpLFxuICAncyc6IFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ2UnOiBSKFsnc3BlY2lhbCcsJ251bWJlciddLCAnZycpLFxufSwgY29tcGlsZSk7XG5cbnZhciBJbmRlbnQgPSB7XG4gIHJlZ2V4cDogUihbJ2luZGVudCddLCAnZ20nKSxcbiAgcmVwbGFjZXI6IChzKSA9PiBzLnJlcGxhY2UoLyB7MSwyfXxcXHQvZywgJzx4PiQmPC94PicpXG59O1xuXG52YXIgQW55Q2hhciA9IC9cXFMvZztcblxudmFyIEJsb2NrcyA9IFIoWydjb21tZW50Jywnc3RyaW5nJywncmVnZXhwJ10sICdnbScpO1xuXG52YXIgTG9uZ0xpbmVzID0gLyheLnsxMDAwLH0pL2dtO1xuXG52YXIgVGFnID0ge1xuICAnLy8nOiAnYycsXG4gICcvKic6ICdjJyxcbiAgJ2AnOiAncycsXG4gICdcIic6ICdzJyxcbiAgXCInXCI6ICdzJyxcbiAgJy8nOiAncicsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bnRheDtcblxuZnVuY3Rpb24gU3ludGF4KG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMudGFiID0gby50YWIgfHwgJ1xcdCc7XG4gIHRoaXMuYmxvY2tzID0gW107XG59XG5cblN5bnRheC5wcm90b3R5cGUuZW50aXRpZXMgPSBlbnRpdGllcztcblxuU3ludGF4LnByb3RvdHlwZS5oaWdobGlnaHQgPSBmdW5jdGlvbihjb2RlLCBvZmZzZXQpIHtcbiAgY29kZSA9IHRoaXMuY3JlYXRlSW5kZW50cyhjb2RlKTtcbiAgY29kZSA9IHRoaXMuY3JlYXRlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gZW50aXRpZXMoY29kZSk7XG5cbiAgZm9yICh2YXIga2V5IGluIHN5bnRheCkge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2Uoc3ludGF4W2tleV0ucmVnZXhwLCBzeW50YXhba2V5XS5yZXBsYWNlcik7XG4gIH1cblxuICBjb2RlID0gdGhpcy5yZXN0b3JlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gY29kZS5yZXBsYWNlKEluZGVudC5yZWdleHAsIEluZGVudC5yZXBsYWNlcik7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUluZGVudHMgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBsaW5lcyA9IGNvZGUuc3BsaXQoL1xcbi9nKTtcbiAgdmFyIGluZGVudCA9IDA7XG4gIHZhciBtYXRjaDtcbiAgdmFyIGxpbmU7XG4gIHZhciBpO1xuXG4gIGkgPSBsaW5lcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIGxpbmUgPSBsaW5lc1tpXTtcbiAgICBBbnlDaGFyLmxhc3RJbmRleCA9IDA7XG4gICAgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMobGluZSk7XG4gICAgaWYgKG1hdGNoKSBpbmRlbnQgPSBtYXRjaC5pbmRleDtcbiAgICBlbHNlIGlmIChpbmRlbnQgJiYgIWxpbmUubGVuZ3RoKSB7XG4gICAgICBsaW5lc1tpXSA9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKHRoaXMudGFiKTtcbiAgICB9XG4gIH1cblxuICBjb2RlID0gbGluZXMuam9pbignXFxuJyk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLnJlc3RvcmVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBibG9jaztcbiAgdmFyIGJsb2NrcyA9IHRoaXMuYmxvY2tzO1xuICB2YXIgbiA9IDA7XG4gIHJldHVybiBjb2RlXG4gICAgLnJlcGxhY2UoL1xcdWZmZWMvZywgZnVuY3Rpb24oKSB7XG4gICAgICBibG9jayA9IGJsb2Nrc1tuKytdO1xuICAgICAgcmV0dXJuIGVudGl0aWVzKGJsb2NrLnNsaWNlKDAsIDEwMDApICsgJy4uLmxpbmUgdG9vIGxvbmcgdG8gZGlzcGxheScpO1xuICAgIH0pXG4gICAgLnJlcGxhY2UoL1xcdWZmZWIvZywgZnVuY3Rpb24oKSB7XG4gICAgICBibG9jayA9IGJsb2Nrc1tuKytdO1xuICAgICAgdmFyIHRhZyA9IGlkZW50aWZ5KGJsb2NrKTtcbiAgICAgIHJldHVybiAnPCcrdGFnKyc+JytlbnRpdGllcyhibG9jaykrJzwvJyt0YWcrJz4nO1xuICAgIH0pO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHRoaXMuYmxvY2tzID0gW107XG5cbiAgY29kZSA9IGNvZGVcbiAgICAucmVwbGFjZShMb25nTGluZXMsIChibG9jaykgPT4ge1xuICAgICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICByZXR1cm4gJ1xcdWZmZWMnO1xuICAgIH0pXG4gICAgLnJlcGxhY2UoQmxvY2tzLCAoYmxvY2spID0+IHtcbiAgICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgcmV0dXJuICdcXHVmZmViJztcbiAgICB9KTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cbmZ1bmN0aW9uIGNyZWF0ZUlkKCkge1xuICB2YXIgYWxwaGFiZXQgPSAnYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXonO1xuICB2YXIgbGVuZ3RoID0gYWxwaGFiZXQubGVuZ3RoIC0gMTtcbiAgdmFyIGkgPSA2O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcyArPSBhbHBoYWJldFtNYXRoLnJhbmRvbSgpICogbGVuZ3RoIHwgMF07XG4gIH1cbiAgcmV0dXJuIHM7XG59XG5cbmZ1bmN0aW9uIGVudGl0aWVzKHRleHQpIHtcbiAgcmV0dXJuIHRleHRcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgO1xufVxuXG5mdW5jdGlvbiBjb21waWxlKHJlZ2V4cCwgdGFnKSB7XG4gIHZhciBvcGVuVGFnID0gJzwnICsgdGFnICsgJz4nO1xuICB2YXIgY2xvc2VUYWcgPSAnPC8nICsgdGFnICsgJz4nO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IHRhZyxcbiAgICByZWdleHA6IHJlZ2V4cCxcbiAgICByZXBsYWNlcjogb3BlblRhZyArICckJicgKyBjbG9zZVRhZ1xuICB9O1xufVxuXG5mdW5jdGlvbiBtYXAob2JqLCBmbikge1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICByZXN1bHRba2V5XSA9IGZuKG9ialtrZXldLCBrZXkpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2UocGFzcywgY29kZSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhc3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHBhc3NbaV1bMF0sIHBhc3NbaV1bMV0pO1xuICB9XG4gIHJldHVybiBjb2RlO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuXG5mdW5jdGlvbiBpZGVudGlmeShibG9jaykge1xuICB2YXIgb25lID0gYmxvY2tbMF07XG4gIHZhciB0d28gPSBvbmUgKyBibG9ja1sxXTtcbiAgcmV0dXJuIFRhZ1t0d29dIHx8IFRhZ1tvbmVdO1xufVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgUGFydHMgPSByZXF1aXJlKCcuL3BhcnRzJyk7XG5cbnZhciBUeXBlID0ge1xuICAnXFxuJzogJ2xpbmVzJyxcbiAgJ3snOiAnb3BlbiBjdXJseScsXG4gICd9JzogJ2Nsb3NlIGN1cmx5JyxcbiAgJ1snOiAnb3BlbiBzcXVhcmUnLFxuICAnXSc6ICdjbG9zZSBzcXVhcmUnLFxuICAnKCc6ICdvcGVuIHBhcmVucycsXG4gICcpJzogJ2Nsb3NlIHBhcmVucycsXG4gICcvJzogJ29wZW4gY29tbWVudCcsXG4gICcqJzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAnYCc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRPS0VOID0gL1xcbnxcXC9cXCp8XFwqXFwvfGB8XFx7fFxcfXxcXFt8XFxdfFxcKHxcXCkvZztcblxubW9kdWxlLmV4cG9ydHMgPSBUb2tlbnM7XG5cblRva2Vucy5UeXBlID0gVHlwZTtcblxuZnVuY3Rpb24gVG9rZW5zKGZhY3RvcnkpIHtcbiAgZmFjdG9yeSA9IGZhY3RvcnkgfHwgZnVuY3Rpb24oKSB7IHJldHVybiBuZXcgUGFydHM7IH07XG5cbiAgdGhpcy5mYWN0b3J5ID0gZmFjdG9yeTtcblxuICB2YXIgdCA9IHRoaXMudG9rZW5zID0ge1xuICAgIGxpbmVzOiBmYWN0b3J5KCksXG4gICAgYmxvY2tzOiBmYWN0b3J5KCksXG4gICAgc2VnbWVudHM6IGZhY3RvcnkoKSxcbiAgfTtcblxuICB0aGlzLmNvbGxlY3Rpb24gPSB7XG4gICAgJ1xcbic6IHQubGluZXMsXG4gICAgJ3snOiB0LmJsb2NrcyxcbiAgICAnfSc6IHQuYmxvY2tzLFxuICAgICdbJzogdC5ibG9ja3MsXG4gICAgJ10nOiB0LmJsb2NrcyxcbiAgICAnKCc6IHQuYmxvY2tzLFxuICAgICcpJzogdC5ibG9ja3MsXG4gICAgJy8nOiB0LnNlZ21lbnRzLFxuICAgICcqJzogdC5zZWdtZW50cyxcbiAgICAnYCc6IHQuc2VnbWVudHMsXG4gIH07XG59XG5cblRva2Vucy5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Ub2tlbnMucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8fCAwO1xuXG4gIHZhciB0b2tlbnMgPSB0aGlzLnRva2VucztcbiAgdmFyIG1hdGNoO1xuICB2YXIgdHlwZTtcbiAgdmFyIGNvbGxlY3Rpb247XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGNvbGxlY3Rpb24gPSB0aGlzLmNvbGxlY3Rpb25bdGV4dFttYXRjaC5pbmRleF1dO1xuICAgIGNvbGxlY3Rpb24ucHVzaChtYXRjaC5pbmRleCArIG9mZnNldCk7XG4gIH1cbn07XG5cblRva2Vucy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocmFuZ2UsIHRleHQsIHNoaWZ0KSB7XG4gIHZhciBpbnNlcnQgPSBuZXcgVG9rZW5zKEFycmF5KTtcbiAgaW5zZXJ0LmluZGV4KHRleHQsIHJhbmdlWzBdKTtcblxuICB2YXIgbGVuZ3RocyA9IHt9O1xuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgbGVuZ3Roc1t0eXBlXSA9IHRoaXMudG9rZW5zW3R5cGVdLmxlbmd0aDtcbiAgfVxuXG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5zaGlmdE9mZnNldChyYW5nZVswXSwgc2hpZnQpO1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnJlbW92ZVJhbmdlKHJhbmdlKTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5pbnNlcnQocmFuZ2VbMF0sIGluc2VydC50b2tlbnNbdHlwZV0pO1xuICB9XG5cbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIGlmICh0aGlzLnRva2Vuc1t0eXBlXS5sZW5ndGggIT09IGxlbmd0aHNbdHlwZV0pIHtcbiAgICAgIHRoaXMuZW1pdChgY2hhbmdlICR7dHlwZX1gKTtcbiAgICB9XG4gIH1cbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlJbmRleCA9IGZ1bmN0aW9uKHR5cGUsIGluZGV4KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5nZXQoaW5kZXgpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRDb2xsZWN0aW9uID0gZnVuY3Rpb24odHlwZSkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV07XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5T2Zmc2V0ID0gZnVuY3Rpb24odHlwZSwgb2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5maW5kKG9mZnNldCk7XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHRva2VucyA9IG5ldyBUb2tlbnModGhpcy5mYWN0b3J5KTtcbiAgdmFyIHQgPSB0b2tlbnMudG9rZW5zO1xuICBmb3IgKHZhciBrZXkgaW4gdGhpcy50b2tlbnMpIHtcbiAgICB0W2tleV0gPSB0aGlzLnRva2Vuc1trZXldLnNsaWNlKCk7XG4gIH1cbiAgdG9rZW5zLmNvbGxlY3Rpb24gPSB7XG4gICAgJ1xcbic6IHQubGluZXMsXG4gICAgJ3snOiB0LmJsb2NrcyxcbiAgICAnfSc6IHQuYmxvY2tzLFxuICAgICdbJzogdC5ibG9ja3MsXG4gICAgJ10nOiB0LmJsb2NrcyxcbiAgICAnKCc6IHQuYmxvY2tzLFxuICAgICcpJzogdC5ibG9ja3MsXG4gICAgJy8nOiB0LnNlZ21lbnRzLFxuICAgICcqJzogdC5zZWdtZW50cyxcbiAgICAnYCc6IHQuc2VnbWVudHMsXG4gIH07XG4gIHJldHVybiB0b2tlbnM7XG59O1xuIiwidmFyIG9wZW4gPSByZXF1aXJlKCcuLi9saWIvb3BlbicpO1xudmFyIHNhdmUgPSByZXF1aXJlKCcuLi9saWIvc2F2ZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnLi9idWZmZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaWxlO1xuXG5mdW5jdGlvbiBGaWxlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMucm9vdCA9ICcnO1xuICB0aGlzLnBhdGggPSAndW50aXRsZWQnO1xuICB0aGlzLmJ1ZmZlciA9IG5ldyBCdWZmZXI7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkZpbGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuRmlsZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYnVmZmVyLm9uKCdyYXcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncmF3JykpO1xuICB0aGlzLmJ1ZmZlci5vbignc2V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3NldCcpKTtcbiAgdGhpcy5idWZmZXIub24oJ3VwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2UnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdiZWZvcmUgdXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JlZm9yZSBjaGFuZ2UnKSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5wYXRoID0gcGF0aDtcbiAgdGhpcy5yb290ID0gcm9vdDtcbiAgb3Blbihyb290ICsgcGF0aCwgKGVyciwgdGV4dCkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgICAgZm4gJiYgZm4oZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgICB0aGlzLmVtaXQoJ29wZW4nKTtcbiAgICBmbiAmJiBmbihudWxsLCB0aGlzKTtcbiAgfSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgc2F2ZSh0aGlzLnJvb3QgKyB0aGlzLnBhdGgsIHRoaXMuYnVmZmVyLnRvU3RyaW5nKCksIGZuIHx8IG5vb3ApO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi9saWIvZGVib3VuY2UnKTtcblxuLypcbiAgIC4gLlxuLTEgMCAxIDIgMyA0IDVcbiAgIG5cblxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSGlzdG9yeTtcblxuZnVuY3Rpb24gSGlzdG9yeShlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMubmVlZGxlID0gMDtcbiAgdGhpcy50aW1lb3V0ID0gdHJ1ZTtcbiAgdGhpcy50aW1lU3RhcnQgPSAwO1xuICB0aGlzLmRlYm91bmNlZFNhdmUgPSBkZWJvdW5jZSh0aGlzLmFjdHVhbGx5U2F2ZS5iaW5kKHRoaXMpLCA3MDApXG59XG5cbkhpc3RvcnkucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmIChEYXRlLm5vdygpIC0gdGhpcy50aW1lU3RhcnQgPiAyMDAwIHx8IGZvcmNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuICB0aGlzLnRpbWVvdXQgPSB0aGlzLmRlYm91bmNlZFNhdmUoKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmFjdHVhbGx5U2F2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgaWYgKHRoaXMuZWRpdG9yLmJ1ZmZlci5sb2cubGVuZ3RoKSB7XG4gICAgdGhpcy5sb2cgPSB0aGlzLmxvZy5zbGljZSgwLCArK3RoaXMubmVlZGxlKTtcbiAgICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICAgIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoO1xuICAgIHRoaXMuc2F2ZU1ldGEoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnNhdmVNZXRhKCk7XG4gIH1cbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuICBpZiAodGhpcy5uZWVkbGUgPCAwKSByZXR1cm47XG5cbiAgdGhpcy5jaGVja291dCgndW5kbycsIHRoaXMubmVlZGxlLS0pO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPT09IHRoaXMubG9nLmxlbmd0aCAtIDEpIHJldHVybjtcblxuICB0aGlzLmNoZWNrb3V0KCdyZWRvJywgKyt0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jaGVja291dCA9IGZ1bmN0aW9uKHR5cGUsIG4pIHtcbiAgdmFyIGNvbW1pdCA9IHRoaXMubG9nW25dO1xuICBpZiAoIWNvbW1pdCkgcmV0dXJuO1xuXG4gIHZhciBsb2cgPSBjb21taXQubG9nO1xuXG4gIGNvbW1pdCA9IHRoaXMubG9nW25dW3R5cGVdO1xuICB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSA9IGNvbW1pdC5tYXJrQWN0aXZlO1xuICB0aGlzLmVkaXRvci5tYXJrLnNldChjb21taXQubWFyay5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5zZXRDYXJldChjb21taXQuY2FyZXQuY29weSgpKTtcblxuICBsb2cgPSAndW5kbycgPT09IHR5cGVcbiAgICA/IGxvZy5zbGljZSgpLnJldmVyc2UoKVxuICAgIDogbG9nLnNsaWNlKCk7XG5cbiAgbG9nLmZvckVhY2goaXRlbSA9PiB7XG4gICAgdmFyIGFjdGlvbiA9IGl0ZW1bMF07XG4gICAgdmFyIG9mZnNldFJhbmdlID0gaXRlbVsxXTtcbiAgICB2YXIgdGV4dCA9IGl0ZW1bMl07XG4gICAgc3dpdGNoIChhY3Rpb24pIHtcbiAgICAgIGNhc2UgJ2luc2VydCc6XG4gICAgICAgIGlmICgndW5kbycgPT09IHR5cGUpIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5pbnNlcnQodGhpcy5lZGl0b3IuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldFJhbmdlWzBdKSwgdGV4dCwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyZW1vdmUnOlxuICAgICAgICBpZiAoJ3VuZG8nID09PSB0eXBlKSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLmluc2VydCh0aGlzLmVkaXRvci5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0UmFuZ2VbMF0pLCB0ZXh0LCB0cnVlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UsIHRydWUpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNvbW1pdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbG9nID0gdGhpcy5lZGl0b3IuYnVmZmVyLmxvZztcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLmxvZyA9IFtdO1xuICByZXR1cm4ge1xuICAgIGxvZzogbG9nLFxuICAgIHVuZG86IHRoaXMubWV0YSxcbiAgICByZWRvOiB7XG4gICAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgICBtYXJrQWN0aXZlOiB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZVxuICAgIH1cbiAgfTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmVNZXRhID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWV0YSA9IHtcbiAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gIH07XG59O1xuIiwidmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG5cbnZhciBQQUdJTkdfVEhST1RUTEUgPSA2NTtcblxudmFyIGtleXMgPSBtb2R1bGUuZXhwb3J0cyA9IHtcbiAgJ2N0cmwreic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS51bmRvKCk7XG4gIH0sXG4gICdjdHJsK3knOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucmVkbygpO1xuICB9LFxuXG4gICdob21lJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKCk7XG4gIH0sXG4gICdlbmQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKCk7XG4gIH0sXG4gICdwYWdldXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdwYWdlZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93bigpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCt1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK2Rvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEpO1xuICB9LFxuICAndXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSk7XG4gIH0sXG4gICdyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxKTtcbiAgfSxcbiAgJ2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEpO1xuICB9LFxuICAnY3RybCtyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEpO1xuICB9LFxuXG4gICdjdHJsK2EnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9LFxuXG4gICdlbnRlcic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5zZXJ0KCdcXG4nKTtcbiAgfSxcblxuICAnYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCtkJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciBsaW5lcyA9IGFyZWEuZW5kLnkgLSBhcmVhLmJlZ2luLnk7XG4gICAgaWYgKGxpbmVzICYmIGFyZWEuZW5kLnggPiAwKSBhZGQgKz0gMTtcbiAgICBpZiAoIWxpbmVzKSBhZGQgKz0gMTtcbiAgICBsaW5lcyArPSBhZGQ7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhLnNldExlZnQoMCkuYWRkQm90dG9tKGFkZCkpO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh7IHg6IDAsIHk6IGFyZWEuZW5kLnkgfSwgdGV4dCk7XG4gICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcyhsaW5lcyk7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMobGluZXMsIHRydWUpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWEyJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpXG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmIChhcmVhLmVuZC54ID09PSAwKSB7XG4gICAgICBhcmVhLmVuZC55ID0gYXJlYS5lbmQueSAtIDFcbiAgICAgIGFyZWEuZW5kLnggPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKGFyZWEuZW5kLnkpLmxlbmd0aFxuICAgIH1cbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsK2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmVtaXQoJ2lucHV0JywgJ1xcdWFhYTMnLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSlcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKGFyZWEuZW5kLnggPT09IDApIHtcbiAgICAgIGFyZWEuZW5kLnkgPSBhcmVhLmVuZC55IC0gMVxuICAgICAgYXJlYS5lbmQueCA9IHRoaXMuYnVmZmVyLmdldExpbmUoYXJlYS5lbmQueSkubGVuZ3RoXG4gICAgfVxuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKCsxKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3RhYic6IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXMgPSB0aGlzLnN1Z2dlc3QoKTtcbiAgICBpZiAoIXJlcykge1xuICAgICAgdGhpcy5pbnNlcnQodGhpcy50YWIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKHJlcy5hcmVhKTtcbiAgICAgIHRoaXMuaW5zZXJ0KHJlcy5ub2RlLnZhbHVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ2N0cmwrZic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZC5vcGVuKCk7XG4gIH0sXG5cbiAgJ2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgrMSk7XG4gIH0sXG4gICdzaGlmdCtmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoLTEpO1xuICB9LFxuXG4gICdjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYWRkO1xuICAgIHZhciBhcmVhO1xuICAgIHZhciB0ZXh0O1xuXG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG5cbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIGNsZWFyID0gdHJ1ZTtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya1NldCgpO1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRoaXMubWFyay5hZGRCb3R0b20oYXJlYS5lbmQueCA+IDApLnNldExlZnQoMCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQodGhpcy5tYXJrLmdldCgpKTtcbiAgICB9XG5cbiAgICAvL1RPRE86IHNob3VsZCBjaGVjayBpZiBsYXN0IGxpbmUgaGFzIC8vIGFsc29cbiAgICBpZiAodGV4dC50cmltTGVmdCgpLnN1YnN0cigwLDIpID09PSAnLy8nKSB7XG4gICAgICBhZGQgPSAtMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLio/KVxcL1xcLyAoLispL2dtLCAnJDEkMicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGQgPSArMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oW1xcc10qKSguKykvZ20sICckMS8vICQyJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG5cbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEuYWRkUmlnaHQoYWRkKSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcblxuICAgIGlmIChjYXJldC54KSBjYXJldC5hZGRSaWdodChhZGQpO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQpO1xuXG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSBjbGVhciA9IHRydWU7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gICAgaWYgKHRleHQuc2xpY2UoMCwyKSA9PT0gJy8qJyAmJiB0ZXh0LnNsaWNlKC0yKSA9PT0gJyovJykge1xuICAgICAgdGV4dCA9IHRleHQuc2xpY2UoMiwtMik7XG4gICAgICBhZGQgLT0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCAtPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB0ZXh0ID0gJy8qJyArIHRleHQgKyAnKi8nO1xuICAgICAgYWRkICs9IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgKz0gMjtcbiAgICB9XG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG4gICAgYXJlYS5lbmQueCArPSBhZGQ7XG4gICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQuYWRkUmlnaHQoYWRkKSk7XG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcbn07XG5cbmtleXMuc2luZ2xlID0ge1xuICAvL1xufTtcblxuLy8gc2VsZWN0aW9uIGtleXNcblsgJ2hvbWUnLCdlbmQnLFxuICAncGFnZXVwJywncGFnZWRvd24nLFxuICAnbGVmdCcsJ3VwJywncmlnaHQnLCdkb3duJyxcbiAgJ2N0cmwrbGVmdCcsJ2N0cmwrcmlnaHQnXG5dLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gIGtleXNbJ3NoaWZ0Kycra2V5XSA9IGZ1bmN0aW9uKGUpIHtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIGtleXNba2V5XS5jYWxsKHRoaXMsIGUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9O1xufSk7XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBNb3VzZSA9IHJlcXVpcmUoJy4vbW91c2UnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi90ZXh0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSW5wdXQ7XG5cbmZ1bmN0aW9uIElucHV0KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5tb3VzZSA9IG5ldyBNb3VzZSh0aGlzKTtcbiAgdGhpcy50ZXh0ID0gbmV3IFRleHQ7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbklucHV0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbklucHV0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ibHVyID0gdGhpcy5ibHVyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMudGV4dC5vbihbJ2tleScsICd0ZXh0J10sIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdpbnB1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdmb2N1cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdibHVyJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKSk7XG4gIHRoaXMudGV4dC5vbigndGV4dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICd0ZXh0JykpO1xuICB0aGlzLnRleHQub24oJ2tleXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5JykpO1xuICB0aGlzLnRleHQub24oJ2N1dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjdXQnKSk7XG4gIHRoaXMudGV4dC5vbignY29weScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjb3B5JykpO1xuICB0aGlzLnRleHQub24oJ3Bhc3RlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3Bhc3RlJykpO1xuICB0aGlzLm1vdXNlLm9uKCd1cCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZXVwJykpO1xuICB0aGlzLm1vdXNlLm9uKCdjbGljaycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWNsaWNrJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkb3duJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZG93bicpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWcnKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcgYmVnaW4nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnYmVnaW4nKSk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICB0aGlzLm1vdXNlLnVzZShub2RlKTtcbiAgdGhpcy50ZXh0LnJlc2V0KCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuYmx1cigpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5mb2N1cygpO1xufTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3VzZTtcblxuZnVuY3Rpb24gTW91c2UoKSB7XG4gIHRoaXMubm9kZSA9IG51bGw7XG4gIHRoaXMuY2xpY2tzID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuTW91c2UucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW91c2UucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2V0Q2xpY2tzID0gZGVib3VuY2UodGhpcy5yZXNldENsaWNrcy5iaW5kKHRoaXMpLCAzNTApXG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAgIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCd0b3VjaHN0YXJ0JywgdGhpcy5vbmRvd24pO1xuICB9XG4gIHRoaXMubm9kZSA9IG5vZGU7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCd0b3VjaHN0YXJ0JywgdGhpcy5vbmRvd24pO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZG93biA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZG93bicsIGUpO1xuICB0aGlzLm9uY2xpY2soZSk7XG4gIHRoaXMubWF5YmVEcmFnKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub251cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd1cCcsIGUpO1xuICBpZiAoIXRoaXMuZG93bikgcmV0dXJuO1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmRyYWdFbmQoKTtcbiAgdGhpcy5tYXliZURyYWdFbmQoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmNsaWNrID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnJlc2V0Q2xpY2tzKCk7XG4gIHRoaXMuY2xpY2tzID0gKHRoaXMuY2xpY2tzICUgMykgKyAxO1xuICB0aGlzLmVtaXQoJ2NsaWNrJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25tYXliZWRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuXG4gIHZhciBkID1cbiAgICAgIE1hdGguYWJzKHRoaXMucG9pbnQueCAtIHRoaXMuZG93bi54KVxuICAgICsgTWF0aC5hYnModGhpcy5wb2ludC55IC0gdGhpcy5kb3duLnkpO1xuXG4gIGlmIChkID4gNSkge1xuICAgIHRoaXMubWF5YmVEcmFnRW5kKCk7XG4gICAgdGhpcy5kcmFnQmVnaW4oKTtcbiAgfVxufTtcblxuTW91c2UucHJvdG90eXBlLm9uZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZHJhZycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGJlZ2luJyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgZW5kJyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUucmVzZXRDbGlja3MgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGlja3MgPSAwO1xufTtcblxuTW91c2UucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG5cbnZhciBUSFJPVFRMRSA9IDAgLy8xMDAwLzYyO1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RleHRhcmVhJyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMCxcbiAgICB6SW5kZXg6IDEwMDAwXG4gIH0pO1xuXG4gIGRvbS5hdHRycyh0aGlzLCB7XG4gICAgYXV0b2NhcGl0YWxpemU6ICdub25lJyxcbiAgICBhdXRvY29tcGxldGU6ICdvZmYnLFxuICAgIHNwZWxsY2hlY2tpbmc6ICdvZmYnLFxuICB9KTtcblxuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cblRleHQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVGV4dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25jdXQgPSB0aGlzLm9uY3V0LmJpbmQodGhpcyk7XG4gIHRoaXMub25jb3B5ID0gdGhpcy5vbmNvcHkuYmluZCh0aGlzKTtcbiAgdGhpcy5vbnBhc3RlID0gdGhpcy5vbnBhc3RlLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXl1cCA9IHRoaXMub25rZXl1cC5iaW5kKHRoaXMpO1xuICB0aGlzLmVsLm9uYmx1ciA9IHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJyk7XG4gIHRoaXMuZWwub25mb2N1cyA9IHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpO1xuICB0aGlzLmVsLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQ7XG4gIHRoaXMuZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMuZWwub25rZXl1cCA9IHRoaXMub25rZXl1cDtcbiAgdGhpcy5lbC5vbmN1dCA9IHRoaXMub25jdXQ7XG4gIHRoaXMuZWwub25jb3B5ID0gdGhpcy5vbmNvcHk7XG4gIHRoaXMuZWwub25wYXN0ZSA9IHRoaXMub25wYXN0ZTtcbiAgdGhpcy5jbGVhciA9IHRocm90dGxlKHRoaXMuY2xlYXIuYmluZCh0aGlzKSwgMjAwMClcbn07XG5cblRleHQucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbn1cblxuVGV4dC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVsLnZhbHVlLnN1YnN0cigtMSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih2YWx1ZSkge1xuICB0aGlzLmVsLnZhbHVlID0gdmFsdWU7XG59O1xuXG4vL1RPRE86IG9uIG1vYmlsZSB3ZSBuZWVkIHRvIGNsZWFyIHdpdGhvdXQgZGVib3VuY2Vcbi8vIG9yIHRoZSB0ZXh0YXJlYSBjb250ZW50IGlzIGRpc3BsYXllZCBpbiBoYWNrZXIncyBrZXlib2FyZFxuLy8gb3IgeW91IG5lZWQgdG8gZGlzYWJsZSB3b3JkIHN1Z2dlc3Rpb25zIGluIGhhY2tlcidzIGtleWJvYXJkIHNldHRpbmdzXG5UZXh0LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuYmx1cigpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5mb2N1cygpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAvLyBmb3JjZXMgY2FyZXQgdG8gZW5kIG9mIHRleHRhcmVhIHNvIHdlIGNhbiBnZXQgLnNsaWNlKC0xKSBjaGFyXG4gIHNldEltbWVkaWF0ZSgoKSA9PiB0aGlzLmVsLnNlbGVjdGlvblN0YXJ0ID0gdGhpcy5lbC52YWx1ZS5sZW5ndGgpO1xuICB0aGlzLmVtaXQoJ3RleHQnLCB0aGlzLmdldCgpKTtcbiAgdGhpcy5jbGVhcigpO1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIC8vIGNvbnNvbGUubG9nKGUud2hpY2gpO1xuICB2YXIgbm93ID0gRGF0ZS5ub3coKTtcbiAgaWYgKG5vdyAtIHRoaXMudGhyb3R0bGVUaW1lIDwgVEhST1RUTEUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gbm93O1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5dXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0ICYmICFlLnNoaWZ0S2V5KSBrZXlzLnB1c2goJ3NoaWZ0OnVwJyk7XG4gIGlmIChtLmN0cmwgJiYgIWUuY3RybEtleSkga2V5cy5wdXNoKCdjdHJsOnVwJyk7XG4gIGlmIChtLmFsdCAmJiAhZS5hbHRLZXkpIGtleXMucHVzaCgnYWx0OnVwJyk7XG5cbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0gKyAnOnVwJyk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2N1dCcsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25jb3B5ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY29weScsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25wYXN0ZSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ3Bhc3RlJywgZSk7XG59O1xuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uL2xpYi9yZWdleHAnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vbGliL3BvaW50Jyk7XG5cbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd3b3JkcyddLCAnZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdmU7XG5cbmZ1bmN0aW9uIE1vdmUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG59XG5cbk1vdmUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW92ZS5wcm90b3R5cGUucGFnZURvd24gPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgc2l6ZSAtIHJlbWFpbmRlcik7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMocGFnZSk7XG59O1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlVXAgPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgLShzaXplIC0gcmVtYWluZGVyKSk7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMoLXBhZ2UpO1xufTtcblxudmFyIG1vdmUgPSB7fTtcblxubW92ZS5ieVdvcmQgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciBsaW5lID0gYnVmZmVyLmdldExpbmVUZXh0KHAueSk7XG5cbiAgaWYgKGR4ID4gMCAmJiBwLnggPj0gbGluZS5sZW5ndGggLSAxKSB7IC8vIGF0IGVuZCBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsICsxKTsgLy8gbW92ZSBvbmUgY2hhciByaWdodFxuICB9IGVsc2UgaWYgKGR4IDwgMCAmJiBwLnggPT09IDApIHsgLy8gYXQgYmVnaW4gb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCAtMSk7IC8vIG1vdmUgb25lIGNoYXIgbGVmdFxuICB9XG5cbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKGxpbmUsIFdPUkRTKTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGR4IDwgMCkgd29yZHMucmV2ZXJzZSgpO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKGR4ID4gMFxuICAgICAgPyB3b3JkLmluZGV4ID4gcC54XG4gICAgICA6IHdvcmQuaW5kZXggPCBwLngpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHg6IHdvcmQuaW5kZXgsXG4gICAgICAgIHk6IHAueVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyByZWFjaGVkIGJlZ2luL2VuZCBvZiBmaWxlXG4gIHJldHVybiBkeCA+IDBcbiAgICA/IG1vdmUuZW5kT2ZMaW5lKGJ1ZmZlciwgcClcbiAgICA6IG1vdmUuYmVnaW5PZkxpbmUoYnVmZmVyLCBwKTtcbn07XG5cbm1vdmUuYnlDaGFycyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeCA8IDApIHsgLy8gZ29pbmcgbGVmdFxuICAgIHggKz0gZHg7IC8vIG1vdmUgbGVmdFxuICAgIGlmICh4IDwgMCkgeyAvLyB3aGVuIHBhc3QgbGVmdCBlZGdlXG4gICAgICBpZiAoeSA+IDApIHsgLy8gYW5kIGxpbmVzIGFib3ZlXG4gICAgICAgIHkgLT0gMTsgLy8gbW92ZSB1cCBhIGxpbmVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gYW5kIGdvIHRvIHRoZSBlbmQgb2YgbGluZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeCA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKGR4ID4gMCkgeyAvLyBnb2luZyByaWdodFxuICAgIHggKz0gZHg7IC8vIG1vdmUgcmlnaHRcbiAgICB3aGlsZSAoeCAtIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCA+IDApIHsgLy8gd2hpbGUgcGFzdCBsaW5lIGxlbmd0aFxuICAgICAgaWYgKHkgPT09IGJ1ZmZlci5sb2MoKSkgeyAvLyBvbiBlbmQgb2YgZmlsZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBnbyB0byBlbmQgb2YgbGluZSBvbiBsYXN0IGxpbmVcbiAgICAgICAgYnJlYWs7IC8vIGFuZCBleGl0XG4gICAgICB9XG4gICAgICB4IC09IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCArIDE7IC8vIHdyYXAgdGhpcyBsaW5lIGxlbmd0aFxuICAgICAgeSArPSAxOyAvLyBhbmQgbW92ZSBkb3duIGEgbGluZVxuICAgIH1cbiAgfVxuXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5ieUxpbmVzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeSkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR5IDwgMCkgeyAvLyBnb2luZyB1cFxuICAgIGlmICh5ICsgZHkgPiAwKSB7IC8vIHdoZW4gbGluZXMgYWJvdmVcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgdXBcbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IDA7XG4gICAgfVxuICB9IGVsc2UgaWYgKGR5ID4gMCkgeyAvLyBnb2luZyBkb3duXG4gICAgaWYgKHkgPCBidWZmZXIubG9jKCkgLSBkeSkgeyAvLyB3aGVuIGxpbmVzIGJlbG93XG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIGRvd25cbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IGJ1ZmZlci5sb2MoKTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiAoeCA+IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoKSB7XG4gIC8vICAgeCA9IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoO1xuICAvLyB9IGVsc2Uge1xuICAvLyB9XG4gIHggPSBNYXRoLm1pbih0aGlzLmxhc3REZWxpYmVyYXRlWCwgYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoKTtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mTGluZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mTGluZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgeCA9IGJ1ZmZlci5nZXRMaW5lKHAueSkubGVuZ3RoO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IEluZmluaXR5O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZGaWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICB2YXIgeCA9IGJ1ZmZlci5nZXRMaW5lKGxhc3QpLmxlbmd0aFxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBsYXN0XG4gIH07XG59O1xuXG5tb3ZlLmlzQmVnaW5PZkZpbGUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHJldHVybiBwLnggPT09IDAgJiYgcC55ID09PSAwO1xufTtcblxubW92ZS5pc0VuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgcmV0dXJuIHAueSA9PT0gbGFzdCAmJiBwLnggPT09IGJ1ZmZlci5nZXRMaW5lKGxhc3QpLmxlbmd0aDtcbn07XG5cbk9iamVjdC5rZXlzKG1vdmUpLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gIE1vdmUucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbihwYXJhbSwgYnlFZGl0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG1vdmVbbWV0aG9kXS5jYWxsKFxuICAgICAgdGhpcyxcbiAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlcixcbiAgICAgIHRoaXMuZWRpdG9yLmNhcmV0LFxuICAgICAgcGFyYW1cbiAgICApO1xuXG4gICAgaWYgKCdpcycgPT09IG1ldGhvZC5zbGljZSgwLDIpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgdGhpcy5lbWl0KCdtb3ZlJywgcmVzdWx0LCBieUVkaXQpO1xuICB9O1xufSk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImVkaXRvclwiOlwiX3NyY19zdHlsZV9fZWRpdG9yXCIsXCJsYXllclwiOlwiX3NyY19zdHlsZV9fbGF5ZXJcIixcInJvd3NcIjpcIl9zcmNfc3R5bGVfX3Jvd3NcIixcIm1hcmtcIjpcIl9zcmNfc3R5bGVfX21hcmtcIixcImNvZGVcIjpcIl9zcmNfc3R5bGVfX2NvZGVcIixcImNhcmV0XCI6XCJfc3JjX3N0eWxlX19jYXJldFwiLFwiYmxpbmstc21vb3RoXCI6XCJfc3JjX3N0eWxlX19ibGluay1zbW9vdGhcIixcImNhcmV0LWJsaW5rLXNtb290aFwiOlwiX3NyY19zdHlsZV9fY2FyZXQtYmxpbmstc21vb3RoXCIsXCJndXR0ZXJcIjpcIl9zcmNfc3R5bGVfX2d1dHRlclwiLFwicnVsZXJcIjpcIl9zcmNfc3R5bGVfX3J1bGVyXCIsXCJhYm92ZVwiOlwiX3NyY19zdHlsZV9fYWJvdmVcIixcImZpbmRcIjpcIl9zcmNfc3R5bGVfX2ZpbmRcIixcImJsb2NrXCI6XCJfc3JjX3N0eWxlX19ibG9ja1wifSIsInZhciBkb20gPSByZXF1aXJlKCcuLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zdHlsZS5jc3MnKTtcblxudmFyIHRoZW1lcyA9IHtcbiAgbW9ub2thaToge1xuICAgIGJhY2tncm91bmQ6ICcjMjcyODIyJyxcbiAgICBjb2xvcjogJyNGOEY4RjInLFxuICAgIGtleXdvcmQ6ICcjREYyMjY2JyxcbiAgICBmdW5jdGlvbjogJyNBMEQ5MkUnLFxuICAgIGRlY2xhcmU6ICcjNjFDQ0UwJyxcbiAgICBudW1iZXI6ICcjQUI3RkZCJyxcbiAgICBwYXJhbXM6ICcjRkQ5NzFGJyxcbiAgICBjb21tZW50OiAnIzc1NzE1RScsXG4gICAgc3RyaW5nOiAnI0U2REI3NCcsXG4gIH0sXG5cbiAgd2VzdGVybjoge1xuICAgIGJhY2tncm91bmQ6ICcjRDlEMUIxJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjN0EzQjNCJyxcbiAgICBmdW5jdGlvbjogJyMyNTZGNzUnLFxuICAgIGRlY2xhcmU6ICcjNjM0MjU2JyxcbiAgICBudW1iZXI6ICcjMTM0RDI2JyxcbiAgICBwYXJhbXM6ICcjMDgyNjYzJyxcbiAgICBjb21tZW50OiAnIzk5OEU2RScsXG4gICAgc3RyaW5nOiAnI0M0M0MzQycsXG4gIH0sXG5cbiAgcmVkYmxpc3M6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MUUxNicsXG4gICAgY29sb3I6ICcjRTlFM0QxJyxcbiAgICBrZXl3b3JkOiAnI0ExMzYzMCcsXG4gICAgZnVuY3Rpb246ICcjQjNERjAyJyxcbiAgICBkZWNsYXJlOiAnI0Y2MzgzMycsXG4gICAgbnVtYmVyOiAnI0ZGOUY0RScsXG4gICAgcGFyYW1zOiAnI0EwOTBBMCcsXG4gICAgcmVnZXhwOiAnI0JENzBGNCcsXG4gICAgY29tbWVudDogJyM2MzUwNDcnLFxuICAgIHN0cmluZzogJyMzRUExRkInLFxuICB9LFxuXG4gIGRheWxpZ2h0OiB7XG4gICAgYmFja2dyb3VuZDogJyNFQkVCRUInLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyNGRjFCMUInLFxuICAgIGZ1bmN0aW9uOiAnIzAwMDVGRicsXG4gICAgZGVjbGFyZTogJyMwQzdBMDAnLFxuICAgIG51bWJlcjogJyM4MDIxRDQnLFxuICAgIHBhcmFtczogJyM0QzY5NjknLFxuICAgIGNvbW1lbnQ6ICcjQUJBQkFCJyxcbiAgICBzdHJpbmc6ICcjRTY3MDAwJyxcbiAgfSxcbn07XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHNldFRoZW1lO1xuZXhwb3J0cy50aGVtZXMgPSB0aGVtZXM7XG5cbi8qXG50OiBvcGVyYXRvclxuazoga2V5d29yZFxuZDogZGVjbGFyZVxuYjogYnVpbHRpblxubzogYm9vbGVhblxubjogbnVtYmVyXG5tOiBwYXJhbXNcbmY6IGZ1bmN0aW9uXG5yOiByZWdleHBcbmM6IGNvbW1lbnRcbnM6IHN0cmluZ1xubDogc3ltYm9sXG54OiBpbmRlbnRcbiAqL1xuZnVuY3Rpb24gc2V0VGhlbWUobmFtZSkge1xuICB2YXIgdCA9IHRoZW1lc1tuYW1lXTtcbiAgZG9tLmNzcygndGhlbWUnLFxuYFxuLiR7bmFtZX0sXG4uJHtjc3Mucm93c30ge1xuICBiYWNrZ3JvdW5kOiAke3QuYmFja2dyb3VuZH07XG59XG5cbnQsXG5rIHtcbiAgY29sb3I6ICR7dC5rZXl3b3JkfTtcbn1cblxuZCxcbm4ge1xuICBjb2xvcjogJHt0LmRlY2xhcmV9O1xufVxuXG5vLFxuZSB7XG4gIGNvbG9yOiAke3QubnVtYmVyfTtcbn1cblxubSB7XG4gIGNvbG9yOiAke3QucGFyYW1zfTtcbn1cblxuZiB7XG4gIGNvbG9yOiAke3QuZnVuY3Rpb259O1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbnIge1xuICBjb2xvcjogJHt0LnJlZ2V4cCB8fCB0LnBhcmFtc307XG59XG5cbmMge1xuICBjb2xvcjogJHt0LmNvbW1lbnR9O1xufVxuXG5zIHtcbiAgY29sb3I6ICR7dC5zdHJpbmd9O1xufVxuXG5sLFxuLiR7Y3NzLmNvZGV9IHtcbiAgY29sb3I6ICR7dC5jb2xvcn07XG59XG5cbi4ke2Nzcy5jYXJldH0ge1xuICBiYWNrZ3JvdW5kOiAke3QuY29sb3J9O1xufVxuXG5tLFxuZCB7XG4gIGZvbnQtc3R5bGU6IGl0YWxpYztcbn1cblxubCB7XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxueCB7XG4gIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgYmFja2dyb3VuZC1yZXBlYXQ6IG5vLXJlcGVhdDtcbn1cbmBcbiAgKVxuXG59XG5cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb2NrVmlldztcblxuZnVuY3Rpb24gQmxvY2tWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2Jsb2NrJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmJsb2NrKTtcbiAgdGhpcy5odG1sID0gJyc7XG59XG5cbkJsb2NrVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbkJsb2NrVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cbkJsb2NrVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oZSkge1xuICB2YXIgaHRtbCA9ICcnO1xuXG4gIHZhciBPcGVuID0ge1xuICAgICd7JzogJ2N1cmx5JyxcbiAgICAnWyc6ICdzcXVhcmUnLFxuICAgICcoJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgQ2xvc2UgPSB7XG4gICAgJ30nOiAnY3VybHknLFxuICAgICddJzogJ3NxdWFyZScsXG4gICAgJyknOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBvZmZzZXQgPSBlLmJ1ZmZlci5nZXRQb2ludChlLmNhcmV0KS5vZmZzZXQ7XG5cbiAgdmFyIHJlc3VsdCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeU9mZnNldCgnYmxvY2tzJywgb2Zmc2V0KTtcbiAgaWYgKCFyZXN1bHQpIHJldHVybiBodG1sO1xuXG4gIHZhciBsZW5ndGggPSBlLmJ1ZmZlci50b2tlbnMuZ2V0Q29sbGVjdGlvbignYmxvY2tzJykubGVuZ3RoO1xuICB2YXIgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChyZXN1bHQpO1xuXG4gIHZhciBvcGVuO1xuICB2YXIgY2xvc2U7XG5cbiAgdmFyIGkgPSByZXN1bHQuaW5kZXg7XG4gIHZhciBvcGVuT2Zmc2V0ID0gcmVzdWx0Lm9mZnNldDtcblxuICBjaGFyID0gZS5idWZmZXIuY2hhckF0KG9wZW5PZmZzZXQpO1xuXG4gIHZhciBjb3VudCA9IHJlc3VsdC5vZmZzZXQgPj0gb2Zmc2V0IC0gMSAmJiBDbG9zZVtjaGFyXSA/IDAgOiAxO1xuXG4gIHZhciBsaW1pdCA9IDIwMDtcblxuICB3aGlsZSAoaSA+IDApIHtcbiAgICBvcGVuID0gT3BlbltjaGFyXTtcbiAgICBpZiAoQ2xvc2VbY2hhcl0pIGNvdW50Kys7XG4gICAgaWYgKCEtLWxpbWl0KSByZXR1cm4gaHRtbDtcblxuICAgIGlmIChvcGVuICYmICEtLWNvdW50KSBicmVhaztcblxuICAgIG9wZW5PZmZzZXQgPSBlLmJ1ZmZlci50b2tlbnMuZ2V0QnlJbmRleCgnYmxvY2tzJywgLS1pKTtcbiAgICBjaGFyID0gZS5idWZmZXIuY2hhckF0KG9wZW5PZmZzZXQpO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICBjb3VudCA9IDE7XG5cbiAgdmFyIGNsb3NlT2Zmc2V0O1xuXG4gIHdoaWxlIChpIDwgbGVuZ3RoIC0gMSkge1xuICAgIGNsb3NlT2Zmc2V0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5SW5kZXgoJ2Jsb2NrcycsICsraSk7XG4gICAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChjbG9zZU9mZnNldCk7XG4gICAgaWYgKCEtLWxpbWl0KSByZXR1cm4gaHRtbDtcblxuICAgIGNsb3NlID0gQ2xvc2VbY2hhcl07XG4gICAgaWYgKE9wZW5bY2hhcl0gPT09IG9wZW4pIGNvdW50Kys7XG4gICAgaWYgKG9wZW4gPT09IGNsb3NlKSBjb3VudC0tO1xuXG4gICAgaWYgKCFjb3VudCkgYnJlYWs7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIHZhciBiZWdpbiA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KG9wZW5PZmZzZXQpO1xuICB2YXIgZW5kID0gZS5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQoY2xvc2VPZmZzZXQpO1xuXG4gIHZhciB0YWJzO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhiZWdpbik7XG5cbiAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICsgJ3dpZHRoOicgKyBlLmNoYXIud2lkdGggKyAncHg7J1xuICAgICAgICArICd0b3A6JyArIChiZWdpbi55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoKGJlZ2luLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5jb2RlTGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoZW5kKTtcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGVuZC55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoKGVuZC54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuY29kZUxlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59XG5cbkJsb2NrVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBodG1sID0gdGhpcy5nZXQodGhpcy5lZGl0b3IpO1xuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuICAgIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICB9XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENhcmV0VmlldztcblxuZnVuY3Rpb24gQ2FyZXRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2NhcmV0JztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNhcmV0KTtcbn1cblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBvcGFjaXR5OiArdGhpcy5lZGl0b3IuaGFzRm9jdXMsXG4gICAgbGVmdDogdGhpcy5lZGl0b3IuY2FyZXRQeC54ICsgdGhpcy5lZGl0b3IuY29kZUxlZnQsXG4gICAgdG9wOiB0aGlzLmVkaXRvci5jYXJldFB4LnkgLSAxLFxuICAgIGhlaWdodDogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgKyAxXG4gIH0pO1xufTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIG9wYWNpdHk6IDAsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbnZhciBBaGVhZFRocmVzaG9sZCA9IHtcbiAgYW5pbWF0aW9uOiBbLjE1LCAuNF0sXG4gIG5vcm1hbDogWzIsIDRdXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGVWaWV3O1xuXG5mdW5jdGlvbiBDb2RlVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG5cbiAgdGhpcy5uYW1lID0gJ2NvZGUnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY29kZSk7XG4gIHRoaXMucGFydHMgPSBbXTtcbiAgdGhpcy5vZmZzZXQgPSB7IHRvcDogMCwgbGVmdDogMCB9O1xufVxuXG5Db2RlVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbkNvZGVWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgdGhpcy50YXJnZXQgPSB0YXJnZXQ7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuYXBwZW5kUGFydHMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5wYXJ0cy5mb3JFYWNoKHBhcnQgPT4gcGFydC5hcHBlbmQoKSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyUGFydCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBwYXJ0ID0gbmV3IFBhcnQodGhpcywgcmFuZ2UpO1xuICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIHBhcnQucmVuZGVyKCk7XG4gIHBhcnQuYXBwZW5kKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyRWRpdCA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwwXSk7XG4gIGlmIChlZGl0LnNoaWZ0ID4gMCkgdGhpcy5yZW5kZXJJbnNlcnQoZWRpdCk7XG4gIGVsc2UgaWYgKGVkaXQuc2hpZnQgPCAwKSB0aGlzLnJlbmRlclJlbW92ZShlZGl0KTtcbiAgZWxzZSB0aGlzLnJlbmRlckxpbmUoZWRpdCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyUGFnZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbMCwwXSk7XG4gIHZhciBpblBhcnRzID0gdGhpcy5pblJhbmdlUGFydHMocGFnZSk7XG4gIHZhciBuZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKHBhZ2UsIHRoaXMucGFydHMpO1xuICBuZWVkUmFuZ2VzLmZvckVhY2gocmFuZ2UgPT4gdGhpcy5yZW5kZXJQYXJ0KHJhbmdlKSk7XG4gIGluUGFydHMuZm9yRWFjaChwYXJ0ID0+IHBhcnQucmVuZGVyKCkpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclJlbW92ZSA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA+IGVkaXQucmFuZ2VbMF0gJiYgcGFydFsxXSA8IGVkaXQucmFuZ2VbMV0pIHtcbiAgICAgIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA8IGVkaXQubGluZSAmJiBwYXJ0WzFdID49IGVkaXQubGluZSkge1xuICAgICAgcGFydFsxXSA9IGVkaXQubGluZSAtIDE7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoW2VkaXQubGluZSwgZWRpdC5saW5lXSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSAmJiBwYXJ0WzFdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSAmJiBwYXJ0WzFdID4gZWRpdC5saW5lKSB7XG4gICAgICB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoW2VkaXQubGluZSwgZWRpdC5saW5lXSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUgJiYgcGFydFswXSArIGVkaXQuc2hpZnQgPD0gZWRpdC5saW5lKSB7XG4gICAgICB2YXIgb2Zmc2V0ID0gZWRpdC5saW5lIC0gKHBhcnRbMF0gKyBlZGl0LnNoaWZ0KSArIDE7XG4gICAgICBwYXJ0WzBdICs9IGVkaXQuc2hpZnQgKyBvZmZzZXQ7XG4gICAgICBwYXJ0WzFdICs9IGVkaXQuc2hpZnQgKyBvZmZzZXQ7XG4gICAgICBwYXJ0Lm9mZnNldChvZmZzZXQpO1xuICAgICAgaWYgKHBhcnRbMF0gPj0gcGFydFsxXSkgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0WzBdICs9IGVkaXQuc2hpZnQ7XG4gICAgICBwYXJ0WzFdICs9IGVkaXQuc2hpZnQ7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUGFnZSgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckluc2VydCA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA8IGVkaXQubGluZSAmJiBwYXJ0WzFdID49IGVkaXQubGluZSkge1xuICAgICAgcGFydFsxXSA9IGVkaXQubGluZSAtIDE7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoZWRpdC5yYW5nZSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSkge1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJMaW5lID0gZnVuY3Rpb24oZWRpdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzLnNsaWNlKCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHBhcnRzW2ldO1xuICAgIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdIDw9IGVkaXQubGluZSAmJiBwYXJ0WzFdID49IGVkaXQubGluZSkge1xuICAgICAgcGFydFsxXSA9IGVkaXQubGluZSAtIDE7XG4gICAgICBpZiAocGFydFsxXSA8IHBhcnRbMF0pIHRoaXMucmVtb3ZlUGFydChwYXJ0KVxuICAgICAgZWxzZSBwYXJ0LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoZWRpdC5yYW5nZSk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUGFnZSgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbW92ZVBhcnQgPSBmdW5jdGlvbihwYXJ0KSB7XG4gIHBhcnQuY2xlYXIoKTtcbiAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKHBhcnQpLCAxKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5jbGVhck91dFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMub3V0UmFuZ2VQYXJ0cyh0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UocmFuZ2UpKVxuICAgIC5mb3JFYWNoKHBhcnQgPT4gdGhpcy5yZW1vdmVQYXJ0KHBhcnQpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5pblJhbmdlUGFydHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSB0aGlzLnBhcnRzW2ldO1xuICAgIGlmICggcGFydFswXSA+PSByYW5nZVswXSAmJiBwYXJ0WzBdIDw9IHJhbmdlWzFdXG4gICAgICB8fCBwYXJ0WzFdID49IHJhbmdlWzBdICYmIHBhcnRbMV0gPD0gcmFuZ2VbMV0gKSB7XG4gICAgICBwYXJ0cy5wdXNoKHBhcnQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUub3V0UmFuZ2VQYXJ0cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHRoaXMucGFydHNbaV07XG4gICAgaWYgKCBwYXJ0WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHBhcnRbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHBhcnRzLnB1c2gocGFydCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbihvcHRzID0ge30pIHtcbiAgaWYgKG9wdHMub2Zmc2V0KSB0aGlzLm9mZnNldCA9IG9wdHMub2Zmc2V0O1xuICAvLyBpZiAodGhpcy5lZGl0b3IuZWRpdGluZykgcmV0dXJuO1xuXG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFswLDBdKTtcblxuICBpZiAoUmFuZ2UuTk9UKHBhZ2UsIHRoaXMucGFydHMpLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmIChSYW5nZS5BTkQocGFnZSwgdGhpcy5wYXJ0cykubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwwXSk7XG4gICAgdGhpcy5yZW5kZXJQYXJ0KHBhZ2UpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGNoZWNrIGlmIHdlJ3JlIHBhc3QgdGhlIHRocmVzaG9sZCBvZiB2aWV3XG4gIHZhciB0aHJlc2hvbGQgPSB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgPyBbLUFoZWFkVGhyZXNob2xkLmFuaW1hdGlvblswXSwgK0FoZWFkVGhyZXNob2xkLmFuaW1hdGlvblswXV1cbiAgICA6IFstQWhlYWRUaHJlc2hvbGQubm9ybWFsWzBdLCArQWhlYWRUaHJlc2hvbGQubm9ybWFsWzBdXTtcblxuICB2YXIgYWhlYWRSYW5nZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZSh0aHJlc2hvbGQpO1xuICB2YXIgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHRoaXMucGFydHMpO1xuICBpZiAoYWhlYWROZWVkUmFuZ2VzLmxlbmd0aCkge1xuICAgIC8vIGlmIHNvLCByZW5kZXIgZnVydGhlciBhaGVhZCB0byBoYXZlIHNvbWVcbiAgICAvLyBtYXJnaW4gdG8gc2Nyb2xsIHdpdGhvdXQgdHJpZ2dlcmluZyBuZXcgcmVuZGVyc1xuXG4gICAgdGhyZXNob2xkID0gdGhpcy5lZGl0b3IuYW5pbWF0aW9uUnVubmluZ1xuICAgICAgPyBbLUFoZWFkVGhyZXNob2xkLmFuaW1hdGlvblsxXSwgK0FoZWFkVGhyZXNob2xkLmFuaW1hdGlvblsxXV1cbiAgICAgIDogWy1BaGVhZFRocmVzaG9sZC5ub3JtYWxbMV0sICtBaGVhZFRocmVzaG9sZC5ub3JtYWxbMV1dO1xuXG4gICAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZSh0aHJlc2hvbGQpO1xuXG4gICAgYWhlYWRSYW5nZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZSh0aHJlc2hvbGQpO1xuICAgIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB0aGlzLnBhcnRzKTtcbiAgICBhaGVhZE5lZWRSYW5nZXMuZm9yRWFjaChyYW5nZSA9PiB7XG4gICAgICB0aGlzLnJlbmRlclBhcnQocmFuZ2UpO1xuICAgIH0pO1xuICB9XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5wYXJ0cy5mb3JFYWNoKHBhcnQgPT4gcGFydC5jbGVhcigpKTtcbiAgdGhpcy5wYXJ0cyA9IFtdO1xufTtcblxuZnVuY3Rpb24gUGFydCh2aWV3LCByYW5nZSkge1xuICB0aGlzLnZpZXcgPSB2aWV3O1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY29kZSk7XG4gIHRoaXMuY29kZSA9ICcnO1xuICB0aGlzLm9mZnNldFRvcCA9IDA7XG4gIHRoaXNbMF0gPSByYW5nZVswXTtcbiAgdGhpc1sxXSA9IHJhbmdlWzFdO1xuXG4gIHZhciBzdHlsZSA9IHt9O1xuXG4gIGlmICh0aGlzLnZpZXcuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzXG4gICYmIH50aGlzLnZpZXcuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzLmluZGV4T2YodGhpcy52aWV3Lm5hbWUpKSB7XG4gICAgc3R5bGUuYmFja2dyb3VuZCA9ICcjJ1xuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KTtcbiAgICBzdHlsZS5vcGFjaXR5ID0gMC41O1xuICB9XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHN0eWxlKTtcbn1cblxuUGFydC5wcm90b3R5cGUub2Zmc2V0ID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLm9mZnNldFRvcCArPSB5O1xuICB0aGlzLmNvZGUgPSB0aGlzLmNvZGUuc3BsaXQoL1xcbi9nKS5zbGljZSh5KS5qb2luKCdcXG4nKTtcbiAgdGhpc1sxXSAtPSB5O1xuICB0aGlzLnN0eWxlKCk7XG4gIHRoaXMuZG9tLmVsLnNjcm9sbFRvcCA9IHRoaXMub2Zmc2V0VG9wICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodDtcbn07XG5cblBhcnQucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uKCkge1xuICBkb20uYXBwZW5kKHRoaXMudmlldy50YXJnZXQsIHRoaXMpO1xufTtcblxuUGFydC5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb2RlID0gdGhpcy52aWV3LmVkaXRvci5idWZmZXIuZ2V0KHRoaXMpO1xuICBpZiAoY29kZSAhPT0gdGhpcy5jb2RlKSB7XG4gICAgZG9tLmh0bWwodGhpcywgY29kZSk7XG4gICAgdGhpcy5jb2RlID0gY29kZTtcbiAgfVxuICB0aGlzLnN0eWxlKCk7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5zdHlsZSA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIGhlaWdodDogKHRoaXNbMV0gLSB0aGlzWzBdICsgMSkgKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgIHRvcDogdGhpc1swXSAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHRcbiAgICAgIC10aGlzLnZpZXcub2Zmc2V0LnRvcFxuICB9KTtcbn07XG5cblBhcnQucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pXG4gIHNjaGVkdWxlVG9SZW1vdmUodGhpcylcbn07XG5cbnZhciBzY2hlZHVsZWRGb3JSZW1vdmFsID0gW11cbnZhciByZW1vdmVUaW1lb3V0XG5cbmZ1bmN0aW9uIHNjaGVkdWxlVG9SZW1vdmUoZWwpIHtcbiAgc2NoZWR1bGVkRm9yUmVtb3ZhbC5wdXNoKGVsKVxuICBjbGVhclRpbWVvdXQocmVtb3ZlVGltZW91dClcbiAgaWYgKHNjaGVkdWxlZEZvclJlbW92YWwubGVuZ3RoID4gMTApIHtcbiAgICByZXR1cm4gcmVtb3ZlU2NoZWR1bGVkKClcbiAgfVxuICByZW1vdmVUaW1lb3V0ID0gc2V0VGltZW91dChyZW1vdmVTY2hlZHVsZWQsIDkwMClcbn1cblxuZnVuY3Rpb24gcmVtb3ZlU2NoZWR1bGVkKCkge1xuICB2YXIgZWxcbiAgd2hpbGUgKGVsID0gc2NoZWR1bGVkRm9yUmVtb3ZhbC5wb3AoKSkge1xuICAgIGRvbS5yZW1vdmUoZWwpXG4gIH1cbn1cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbmRWaWV3O1xuXG5mdW5jdGlvbiBGaW5kVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdmaW5kJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmZpbmQpO1xufVxuXG5GaW5kVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbkZpbmRWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuRmluZFZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciByZXN1bHRzID0gZS5maW5kUmVzdWx0cztcblxuICB2YXIgYmVnaW4gPSAwO1xuICB2YXIgZW5kID0gcmVzdWx0cy5sZW5ndGg7XG4gIHZhciBwcmV2ID0gLTE7XG4gIHZhciBpID0gLTE7XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBpZiAocmVzdWx0c1tpXS55IDwgcmFuZ2VbMF0gLSAxKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciB0YWJzO1xuICB2YXIgcjtcbiAgd2hpbGUgKHJlc3VsdHNbaV0gJiYgcmVzdWx0c1tpXS55IDwgcmFuZ2VbMV0pIHtcbiAgICByID0gcmVzdWx0c1tpKytdO1xuICAgIHRhYnMgPSBlLmdldFBvaW50VGFicyhyKTtcbiAgICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgICArICd3aWR0aDonICsgd2lkdGggKyAnOydcbiAgICAgICAgICArICd0b3A6JyArIChyLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICAgKyAnbGVmdDonICsgKChyLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IuZmluZC5pc09wZW4gfHwgIXRoaXMuZWRpdG9yLmZpbmRSZXN1bHRzLmxlbmd0aCkgcmV0dXJuO1xuXG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstLjUsKy41XSk7XG4gIHZhciBodG1sID0gdGhpcy5nZXQocGFnZSwgdGhpcy5lZGl0b3IpO1xuXG4gIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xufTtcblxuRmluZFZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5odG1sKHRoaXMsICcnKTtcbn07XG4iLCJ2YXIgUnVsZXJWaWV3ID0gcmVxdWlyZSgnLi9ydWxlcicpO1xudmFyIE1hcmtWaWV3ID0gcmVxdWlyZSgnLi9tYXJrJyk7XG52YXIgQ29kZVZpZXcgPSByZXF1aXJlKCcuL2NvZGUnKTtcbnZhciBDYXJldFZpZXcgPSByZXF1aXJlKCcuL2NhcmV0Jyk7XG52YXIgQmxvY2tWaWV3ID0gcmVxdWlyZSgnLi9ibG9jaycpO1xudmFyIEZpbmRWaWV3ID0gcmVxdWlyZSgnLi9maW5kJyk7XG52YXIgUm93c1ZpZXcgPSByZXF1aXJlKCcuL3Jvd3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3cztcblxuZnVuY3Rpb24gVmlld3MoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuXG4gIHRoaXMudmlld3MgPSBbXG4gICAgbmV3IFJ1bGVyVmlldyhlZGl0b3IpLFxuICAgIG5ldyBNYXJrVmlldyhlZGl0b3IpLFxuICAgIG5ldyBDb2RlVmlldyhlZGl0b3IpLFxuICAgIG5ldyBDYXJldFZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQmxvY2tWaWV3KGVkaXRvciksXG4gICAgbmV3IEZpbmRWaWV3KGVkaXRvciksXG4gICAgbmV3IFJvd3NWaWV3KGVkaXRvciksXG4gIF07XG5cbiAgdGhpcy52aWV3cy5mb3JFYWNoKHZpZXcgPT4gdGhpc1t2aWV3Lm5hbWVdID0gdmlldyk7XG4gIHRoaXMuZm9yRWFjaCA9IHRoaXMudmlld3MuZm9yRWFjaC5iaW5kKHRoaXMudmlld3MpO1xufVxuXG5WaWV3cy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZWwpIHtcbiAgdGhpcy5mb3JFYWNoKHZpZXcgPT4gdmlldy51c2UoZWwpKTtcbn07XG5cblZpZXdzLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JFYWNoKHZpZXcgPT4gdmlldy5yZW5kZXIoKSk7XG59O1xuXG5WaWV3cy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JFYWNoKHZpZXcgPT4gdmlldy5jbGVhcigpKTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYXJrVmlldztcblxuZnVuY3Rpb24gTWFya1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnbWFyayc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5tYXJrKTtcbn1cblxuTWFya1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5NYXJrVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgbWFyayA9IGUubWFyay5nZXQoKTtcbiAgaWYgKHJhbmdlWzBdID4gbWFyay5lbmQueSkgcmV0dXJuIGZhbHNlO1xuICBpZiAocmFuZ2VbMV0gPCBtYXJrLmJlZ2luLnkpIHJldHVybiBmYWxzZTtcblxuICB2YXIgb2Zmc2V0cyA9IGUuYnVmZmVyLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgYXJlYSA9IGUuYnVmZmVyLmdldEFyZWFPZmZzZXRSYW5nZShtYXJrKTtcbiAgdmFyIGNvZGUgPSBlLmJ1ZmZlci50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuXG4gIGFyZWFbMF0gLT0gb2Zmc2V0c1swXTtcbiAgYXJlYVsxXSAtPSBvZmZzZXRzWzBdO1xuXG4gIHZhciBhYm92ZSA9IGNvZGUuc3Vic3RyaW5nKDAsIGFyZWFbMF0pO1xuICB2YXIgbWlkZGxlID0gY29kZS5zdWJzdHJpbmcoYXJlYVswXSwgYXJlYVsxXSk7XG4gIHZhciBodG1sID0gYWJvdmUucmVwbGFjZSgvW15cXG5dL2csICcgJykgLy9lLnN5bnRheC5lbnRpdGllcyhhYm92ZSlcbiAgICArICc8bWFyaz4nICsgbWlkZGxlLnJlcGxhY2UoL1teXFxuXS9nLCAnICcpICsgJzwvbWFyaz4nO1xuXG4gIGh0bWwgPSBodG1sLnJlcGxhY2UoL1xcbi9nLCAnIFxcbicpO1xuXG4gIHJldHVybiBodG1sO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuXG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstLjUsKy41XSk7XG4gIHZhciBodG1sID0gdGhpcy5nZXQocGFnZSwgdGhpcy5lZGl0b3IpO1xuXG4gIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuXG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiBwYWdlWzBdICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAnYXV0bydcbiAgfSk7XG59O1xuXG5NYXJrVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJvd3NWaWV3O1xuXG5mdW5jdGlvbiBSb3dzVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdyb3dzJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLnJvd3MpO1xuICB0aGlzLnJvd3MgPSAtMTtcbiAgdGhpcy5yYW5nZSA9IFstMSwtMV07XG4gIHRoaXMuaHRtbCA9ICcnO1xufVxuXG5Sb3dzVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cblJvd3NWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuUm93c1ZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0xLCsxXSk7XG5cbiAgaWYgKCByYW5nZVswXSA+PSB0aGlzLnJhbmdlWzBdXG4gICAgJiYgcmFuZ2VbMV0gPD0gdGhpcy5yYW5nZVsxXVxuICAgICYmICggdGhpcy5yYW5nZVsxXSAhPT0gdGhpcy5yb3dzXG4gICAgICB8fCB0aGlzLmVkaXRvci5yb3dzID09PSB0aGlzLnJvd3NcbiAgICApKSByZXR1cm47XG5cbiAgcmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0zLCszXSk7XG4gIHRoaXMucm93cyA9IHRoaXMuZWRpdG9yLnJvd3M7XG4gIHRoaXMucmFuZ2UgPSByYW5nZTtcblxuICB2YXIgaHRtbCA9ICcnO1xuICBmb3IgKHZhciBpID0gcmFuZ2VbMF07IGkgPD0gcmFuZ2VbMV07IGkrKykge1xuICAgIGh0bWwgKz0gKGkgKyAxKSArICdcXG4nO1xuICB9XG5cbiAgaWYgKGh0bWwgIT09IHRoaXMuaHRtbCkge1xuICAgIHRoaXMuaHRtbCA9IGh0bWw7XG5cbiAgICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICAgIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgICB0b3A6IHJhbmdlWzBdICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgICBoZWlnaHQ6IChyYW5nZVsxXSAtIHJhbmdlWzBdICsgMSkgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCxcbiAgICB9KTtcbiAgfVxufTtcblxuUm93c1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJ1bGVyVmlldztcblxuZnVuY3Rpb24gUnVsZXJWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ3J1bGVyJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLnJ1bGVyKTtcbn1cblxuUnVsZXJWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICB0b3A6IDAsXG4gICAgLy8gaGVpZ2h0OiB0aGlzLmVkaXRvci5oZWlnaHRcbiAgICAvLyAodGhpcy5lZGl0b3Iucm93cyArIHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0KVxuICAgIC8vICAgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodFxuICAgIC8vICAgKyB0aGlzLmVkaXRvci5wYWdlUmVtYWluZGVyLmhlaWdodFxuICB9KTtcbn07XG5cblJ1bGVyVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cbmZ1bmN0aW9uIFZpZXcoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xufVxuXG5WaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdyZW5kZXIgbm90IGltcGxlbWVudGVkJyk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyIG5vdCBpbXBsZW1lbnRlZCcpO1xufTtcbiJdfQ==
