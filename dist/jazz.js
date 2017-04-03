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

  dom.css(this.id, '\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n    ');

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

  dom.css(this.id, '\n    #' + this.id + ' {\n      top: ' + (this.options.center_vertical ? this.size.height / 3 : 0) + 'px;\n    }\n\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n\n    #' + this.id + ' > .' + css.ruler + ',\n    #' + this.id + ' > .' + css.find + ',\n    #' + this.id + ' > .' + css.mark + ',\n    #' + this.id + ' > .' + css.code + ' {\n      margin-left: ' + this.codeLeft + 'px;\n      tab-size: ' + this.tabSize + ';\n    }\n    #' + this.id + ' > .' + css.rows + ' {\n      width: ' + this.marginLeft + 'px;\n    }\n    #' + this.id + ' > .' + css.find + ' > i,\n    #' + this.id + ' > .' + css.block + ' > i {\n      height: ' + (this.char.height + 1) + 'px;\n    }\n    x {\n      background-image: url(' + dataURL + ');\n    }');

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
    top: this[0] * this.view.editor.char.height
    // -this.view.offset.top
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7O0FBSUEsSUFBSSxpQkFBaUI7QUFDbkIsU0FBTyxTQURZO0FBRW5CLGFBQVcsS0FGUTtBQUduQixlQUFhLE9BSE07QUFJbkIsZ0JBQWMsS0FKSztBQUtuQixnQkFBYyxFQUxLO0FBTW5CLGFBQVcsS0FOUTtBQU9uQixxQkFBbUIsS0FQQTtBQVFuQixtQkFBaUIsS0FSRTtBQVNuQixlQUFhLEVBVE07QUFVbkIsaUJBQWU7QUFWSSxDQUFyQjs7QUFhQSxRQUFRLHFCQUFSO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxVQUFVLFFBQVEsZ0JBQVIsQ0FBZDtBQUNBLElBQUksV0FBVyxRQUFRLGdCQUFSLENBQWY7QUFDQSxJQUFJLFdBQVcsUUFBUSxnQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWOztBQUVBLElBQUksa0JBQWtCLFFBQVEsc0JBQVIsQ0FBdEI7QUFDQSxJQUFJLFVBQVUsUUFBUSxlQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxhQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJ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USxjQUFSLENBQVY7QUFDQSxJQUFJLE9BQU8sUUFBUSxRQUFSLENBQVg7O0FBRUEsT0FBTyxPQUFQLEdBQWlCLFNBQWpCOztBQUVBLFNBQVMsU0FBVCxDQUFtQixNQUFuQixFQUEyQjtBQUN6QixPQUFLLElBQUwsQ0FBVSxJQUFWLEVBQWdCLE1BQWhCO0FBQ0EsT0FBSyxJQUFMLEdBQVksT0FBWjtBQUNBLE9BQUssR0FBTCxHQUFXLElBQUksSUFBSSxLQUFSLENBQVg7QUFDRDs7QUFFRCxVQUFVLFNBQVYsQ0FBb0IsU0FBcEIsR0FBZ0MsS0FBSyxTQUFyQzs7QUFFQSxVQUFVLFNBQVYsQ0FBb0IsR0FBcEIsR0FBMEIsVUFBUyxNQUFULEVBQWlCO0FBQ3pDLE1BQUksTUFBSixDQUFXLE1BQVgsRUFBbUIsSUFBbkI7QUFDRCxDQUZEOztBQUlBLFVBQVUsU0FBVixDQUFvQixNQUFwQixHQUE2QixZQUFXO0FBQ3RDLE1BQUksS0FBSixDQUFVLElBQVYsRUFBZ0I7QUFDZCxTQUFLO0FBRFMsR0FBaEI7QUFPRCxDQVJEOztBQVVBLFVBQVUsU0FBVixDQUFvQixLQUFwQixHQUE0QixZQUFXO0FBQ3JDLE1BQUksS0FBSixDQUFVLElBQVYsRUFBZ0I7QUFDZCxZQUFRO0FBRE0sR0FBaEI7QUFHRCxDQUpEOzs7OztBQzNCQSxPQUFPLE9BQVAsR0FBaUIsSUFBakI7O0FBRUEsU0FBUyxJQUFULENBQWMsTUFBZCxFQUFzQjtBQUNwQixPQUFLLE1BQUwsR0FBYyxNQUFkO0FBQ0Q7O0FBRUQsS0FBSyxTQUFMLENBQWUsTUFBZixHQUF3QixZQUFXO0FBQ2pDLFFBQU0sSUFBSSxLQUFKLENBQVUsd0JBQVYsQ0FBTjtBQUNELENBRkQ7O0FBSUEsS0FBSyxTQUFMLENBQWUsS0FBZixHQUF1QixZQUFXO0FBQ2hDLFFBQU0sSUFBSSxLQUFKLENBQVUsdUJBQVYsQ0FBTjtBQUNELENBRkQiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBKYXp6XG4gKi9cblxudmFyIERlZmF1bHRPcHRpb25zID0ge1xuICB0aGVtZTogJ3dlc3Rlcm4nLFxuICBmb250X3NpemU6ICc5cHQnLFxuICBsaW5lX2hlaWdodDogJzEuNGVtJyxcbiAgZGVidWdfbGF5ZXJzOiBmYWxzZSxcbiAgc2Nyb2xsX3NwZWVkOiA5NSxcbiAgaGlkZV9yb3dzOiBmYWxzZSxcbiAgY2VudGVyX2hvcml6b250YWw6IGZhbHNlLFxuICBjZW50ZXJfdmVydGljYWw6IGZhbHNlLFxuICBtYXJnaW5fbGVmdDogMTUsXG4gIGd1dHRlcl9tYXJnaW46IDIwLFxufTtcblxucmVxdWlyZSgnLi9saWIvc2V0LWltbWVkaWF0ZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL2xpYi9tZXJnZScpO1xudmFyIGNsb25lID0gcmVxdWlyZSgnLi9saWIvY2xvbmUnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9saWIvYmluZC1yYWYnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuL2xpYi9yZWdleHAnKTtcbnZhciBEaWFsb2cgPSByZXF1aXJlKCcuL2xpYi9kaWFsb2cnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4vbGliL3BvaW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuL2xpYi9yYW5nZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuL2xpYi9hcmVhJyk7XG52YXIgQm94ID0gcmVxdWlyZSgnLi9saWIvYm94Jyk7XG5cbnZhciBEZWZhdWx0QmluZGluZ3MgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC9iaW5kaW5ncycpO1xudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcbnZhciB0aGVtZSA9IHJlcXVpcmUoJy4vc3JjL3RoZW1lJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zcmMvc3R5bGUuY3NzJyk7XG5cbnZhciBORVdMSU5FID0gUmVnZXhwLmNyZWF0ZShbJ25ld2xpbmUnXSk7XG5cbm1vZHVsZS5leHBvcnRzID0gSmF6ejtcblxuZnVuY3Rpb24gSmF6eihvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG1lcmdlKGNsb25lKERlZmF1bHRPcHRpb25zKSwgb3B0aW9ucyB8fCB7fSk7XG5cbiAgT2JqZWN0LmFzc2lnbih0aGlzLCB7XG4gICAgZWw6IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKSxcblxuICAgIGlkOiAnamF6el8nICsgKE1hdGgucmFuZG9tKCkgKiAxMGU2IHwgMCkudG9TdHJpbmcoMzYpLFxuICAgIGZpbGU6IG5ldyBGaWxlLFxuICAgIG1vdmU6IG5ldyBNb3ZlKHRoaXMpLFxuICAgIHZpZXdzOiBuZXcgVmlld3ModGhpcyksXG4gICAgaW5wdXQ6IG5ldyBJbnB1dCh0aGlzKSxcbiAgICBoaXN0b3J5OiBuZXcgSGlzdG9yeSh0aGlzKSxcblxuICAgIGJpbmRpbmdzOiBPYmplY3QuYXNzaWduKHt9LCBEZWZhdWx0QmluZGluZ3MpLFxuXG4gICAgZmluZDogbmV3IERpYWxvZygnRmluZCcsIFRleHQubWFwKSxcbiAgICBmaW5kVmFsdWU6ICcnLFxuICAgIGZpbmROZWVkbGU6IDAsXG4gICAgZmluZFJlc3VsdHM6IFtdLFxuXG4gICAgc2Nyb2xsOiBuZXcgUG9pbnQsXG4gICAgb2Zmc2V0OiBuZXcgUG9pbnQsXG4gICAgc2l6ZTogbmV3IEJveCxcbiAgICBjaGFyOiBuZXcgQm94LFxuXG4gICAgcGFnZTogbmV3IEJveCxcbiAgICBwYWdlUG9pbnQ6IG5ldyBQb2ludCxcbiAgICBwYWdlUmVtYWluZGVyOiBuZXcgQm94LFxuICAgIHBhZ2VCb3VuZHM6IG5ldyBSYW5nZSxcblxuICAgIGxvbmdlc3RMaW5lOiAwLFxuICAgIGd1dHRlcjogMCxcbiAgICBjb2RlOiAwLFxuICAgIHJvd3M6IDAsXG5cbiAgICB0YWJTaXplOiAyLFxuICAgIHRhYjogJyAgJyxcblxuICAgIGNhcmV0OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuICAgIGNhcmV0UHg6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG5cbiAgICBoYXNGb2N1czogZmFsc2UsXG5cbiAgICBtYXJrOiBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgICB9KSxcblxuICAgIGVkaXRpbmc6IGZhbHNlLFxuICAgIGVkaXRMaW5lOiAtMSxcbiAgICBlZGl0UmFuZ2U6IFstMSwtMV0sXG4gICAgZWRpdFNoaWZ0OiAwLFxuXG4gICAgc3VnZ2VzdEluZGV4OiAwLFxuICAgIHN1Z2dlc3RSb290OiAnJyxcbiAgICBzdWdnZXN0Tm9kZXM6IFtdLFxuXG4gICAgYW5pbWF0aW9uVHlwZTogJ2xpbmVhcicsXG4gICAgYW5pbWF0aW9uRnJhbWU6IC0xLFxuICAgIGFuaW1hdGlvblJ1bm5pbmc6IGZhbHNlLFxuICAgIGFuaW1hdGlvblNjcm9sbFRhcmdldDogbnVsbCxcblxuICAgIHJlbmRlclF1ZXVlOiBbXSxcbiAgICByZW5kZXJSZXF1ZXN0OiBudWxsLFxuICAgIHJlbmRlclJlcXVlc3RTdGFydGVkQXQ6IC0xLFxuICB9KTtcblxuICAvLyB1c2VmdWwgc2hvcnRjdXRzXG4gIHRoaXMuYnVmZmVyID0gdGhpcy5maWxlLmJ1ZmZlcjtcbiAgdGhpcy5idWZmZXIubWFyayA9IHRoaXMubWFyaztcbiAgdGhpcy5zeW50YXggPSB0aGlzLmJ1ZmZlci5zeW50YXg7XG5cbiAgdGhlbWUodGhpcy5vcHRpb25zLnRoZW1lKTtcblxuICB0aGlzLmJpbmRNZXRob2RzKCk7XG4gIHRoaXMuYmluZEV2ZW50cygpO1xufVxuXG5KYXp6LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkphenoucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsLCBzY3JvbGxFbCkge1xuICBpZiAodGhpcy5yZWYpIHtcbiAgICB0aGlzLmVsLnJlbW92ZUF0dHJpYnV0ZSgnaWQnKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUoY3NzLmVkaXRvcik7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gICAgdGhpcy5vZmZTY3JvbGwoKTtcbiAgICB0aGlzLm9mZldoZWVsKCk7XG4gICAgdGhpcy5yZWYuZm9yRWFjaChyZWYgPT4ge1xuICAgICAgZG9tLmFwcGVuZChlbCwgcmVmKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnJlZiA9IFtdLnNsaWNlLmNhbGwodGhpcy5lbC5jaGlsZHJlbik7XG4gICAgZG9tLmFwcGVuZChlbCwgdGhpcy5lbCk7XG4gICAgZG9tLm9ucmVzaXplKHRoaXMub25SZXNpemUpO1xuICB9XG5cbiAgdGhpcy5lbCA9IGVsO1xuICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnaWQnLCB0aGlzLmlkKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKGNzcy5lZGl0b3IpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgdGhpcy5vZmZTY3JvbGwgPSBkb20ub25zY3JvbGwoc2Nyb2xsRWwgfHwgdGhpcy5lbCwgdGhpcy5vblNjcm9sbCk7XG4gIHRoaXMub2ZmV2hlZWwgPSBkb20ub253aGVlbChzY3JvbGxFbCB8fCB0aGlzLmVsLCB0aGlzLm9uV2hlZWwpXG4gIHRoaXMuaW5wdXQudXNlKHRoaXMuZWwpO1xuICBkb20uYXBwZW5kKHRoaXMudmlld3MuY2FyZXQsIHRoaXMuaW5wdXQudGV4dCk7XG4gIHRoaXMudmlld3MudXNlKHRoaXMuZWwpO1xuXG4gIHRoaXMucmVwYWludCgpXG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hc3NpZ24gPSBmdW5jdGlvbihiaW5kaW5ncykge1xuICB0aGlzLmJpbmRpbmdzID0gYmluZGluZ3M7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMuZmlsZS5vcGVuKHBhdGgsIHJvb3QsIGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgdGhpcy5maWxlLnNhdmUoZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQsIHBhdGgpIHtcbiAgdGhpcy5maWxlLnNldCh0ZXh0KTtcbiAgdGhpcy5maWxlLnBhdGggPSBwYXRoIHx8IHRoaXMuZmlsZS5wYXRoO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmZvY3VzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmJsdXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRNZXRob2RzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lLmJpbmQodGhpcyk7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luLmJpbmQodGhpcyk7XG4gIHRoaXMubWFya1NldCA9IHRoaXMubWFya1NldC5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtDbGVhciA9IHRoaXMubWFya0NsZWFyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMucmVwYWludCA9IHRoaXMucmVwYWludC5iaW5kKHRoaXMpOyAvL2JpbmRSYWYodGhpcy5yZXBhaW50KS5iaW5kKHRoaXMpO1xuICB0aGlzLl9yZW5kZXIgPSB0aGlzLl9yZW5kZXIuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxuICB0aGlzLm9uV2hlZWwgPSB0aHJvdHRsZSh0aGlzLm9uV2hlZWwsIDEwKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRFdmVudHMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5iaW5kSGFuZGxlcnMoKVxuICB0aGlzLm1vdmUub24oJ21vdmUnLCB0aGlzLm9uTW92ZSk7XG4gIHRoaXMuZmlsZS5vbigncmF3JywgdGhpcy5vbkZpbGVSYXcpOyAvL1RPRE86IHNob3VsZCBub3QgbmVlZCB0aGlzIGV2ZW50XG4gIHRoaXMuZmlsZS5vbignc2V0JywgdGhpcy5vbkZpbGVTZXQpO1xuICB0aGlzLmZpbGUub24oJ29wZW4nLCB0aGlzLm9uRmlsZU9wZW4pO1xuICB0aGlzLmZpbGUub24oJ2NoYW5nZScsIHRoaXMub25GaWxlQ2hhbmdlKTtcbiAgdGhpcy5maWxlLm9uKCdiZWZvcmUgY2hhbmdlJywgdGhpcy5vbkJlZm9yZUZpbGVDaGFuZ2UpO1xuICB0aGlzLmhpc3Rvcnkub24oJ2NoYW5nZScsIHRoaXMub25IaXN0b3J5Q2hhbmdlKTtcbiAgdGhpcy5pbnB1dC5vbignYmx1cicsIHRoaXMub25CbHVyKTtcbiAgdGhpcy5pbnB1dC5vbignZm9jdXMnLCB0aGlzLm9uRm9jdXMpO1xuICB0aGlzLmlucHV0Lm9uKCdpbnB1dCcsIHRoaXMub25JbnB1dCk7XG4gIHRoaXMuaW5wdXQub24oJ3RleHQnLCB0aGlzLm9uVGV4dCk7XG4gIHRoaXMuaW5wdXQub24oJ2tleXMnLCB0aGlzLm9uS2V5cyk7XG4gIHRoaXMuaW5wdXQub24oJ2tleScsIHRoaXMub25LZXkpO1xuICB0aGlzLmlucHV0Lm9uKCdjdXQnLCB0aGlzLm9uQ3V0KTtcbiAgdGhpcy5pbnB1dC5vbignY29weScsIHRoaXMub25Db3B5KTtcbiAgdGhpcy5pbnB1dC5vbigncGFzdGUnLCB0aGlzLm9uUGFzdGUpO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZXVwJywgdGhpcy5vbk1vdXNlVXApO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRvd24nLCB0aGlzLm9uTW91c2VEb3duKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VjbGljaycsIHRoaXMub25Nb3VzZUNsaWNrKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnYmVnaW4nLCB0aGlzLm9uTW91c2VEcmFnQmVnaW4pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWcnLCB0aGlzLm9uTW91c2VEcmFnKTtcbiAgdGhpcy5maW5kLm9uKCdzdWJtaXQnLCB0aGlzLmZpbmRKdW1wLmJpbmQodGhpcywgMSkpO1xuICB0aGlzLmZpbmQub24oJ3ZhbHVlJywgdGhpcy5vbkZpbmRWYWx1ZSk7XG4gIHRoaXMuZmluZC5vbigna2V5JywgdGhpcy5vbkZpbmRLZXkpO1xuICB0aGlzLmZpbmQub24oJ29wZW4nLCB0aGlzLm9uRmluZE9wZW4pO1xuICB0aGlzLmZpbmQub24oJ2Nsb3NlJywgdGhpcy5vbkZpbmRDbG9zZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblNjcm9sbCA9IGZ1bmN0aW9uKHNjcm9sbCkge1xuICB0aGlzLnNjcm9sbC5zZXQoc2Nyb2xsKTtcbiAgdGhpcy5yZW5kZXIoJ2NvZGUnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbiAgdGhpcy5yZW5kZXIoJ3Jvd3MnKTtcbiAgdGhpcy5yZXN0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbldoZWVsID0gZnVuY3Rpb24od2hlZWwpIHtcbiAgdGhpcy5hbmltYXRlU2Nyb2xsQnkod2hlZWwuZGVsdGFYLCB3aGVlbC5kZWx0YVkgKiAxLjIsICdlYXNlJylcbn07XG5cbkphenoucHJvdG90eXBlLnJlc3QgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG59LCA2MDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikge1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIHRoaXMuZW1pdCgnaW5wdXQnLCAnJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpO1xuICB0aGlzLmNhcmV0U29saWQoKTtcbiAgdGhpcy5yZXN0KCk7XG5cbiAgdGhpcy5yZW5kZXIoJ2NhcmV0Jyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25SZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZvY3VzID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdmb2N1cycpO1xuICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICB0aGlzLmNhcmV0U29saWQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNhcmV0U29saWQgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldF0pO1xuICB0aGlzLmNhcmV0QmxpbmsoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNhcmV0QmxpbmsgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldCwgY3NzWydibGluay1zbW9vdGgnXV0pO1xufSwgNDAwKTtcblxuSmF6ei5wcm90b3R5cGUub25CbHVyID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gZmFsc2U7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykge1xuICAgICAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldF0pO1xuICAgICAgdGhpcy5lbWl0KCdibHVyJyk7XG4gICAgICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICAgIH1cbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbklucHV0ID0gZnVuY3Rpb24odGV4dCkge1xufTtcblxuSmF6ei5wcm90b3R5cGUub25UZXh0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLnN1Z2dlc3RSb290ID0gJyc7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXlzID0gZnVuY3Rpb24oa2V5cywgZSkge1xuICBpZiAoa2V5cyBpbiB0aGlzLmJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXlzIGluIERlZmF1bHRCaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXkgPSBmdW5jdGlvbihrZXksIGUpIHtcbiAgaWYgKGtleSBpbiB0aGlzLmJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5IGluIERlZmF1bHRCaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uQ3V0ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdGhpcy5vbkNvcHkoZSk7XG4gIHRoaXMuZGVsZXRlKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgZS5jbGlwYm9hcmREYXRhLnNldERhdGEoJ3RleHQvcGxhaW4nLCB0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIHZhciB0ZXh0ID0gZS5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubW92ZS5iZWdpbk9mRmlsZSgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVJhdyA9IGZ1bmN0aW9uKHJhdykge1xuICAvL1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0VGFiTW9kZSA9IGZ1bmN0aW9uKGNoYXIpIHtcbiAgaWYgKCdcXHQnID09PSBjaGFyKSB7XG4gICAgdGhpcy50YWIgPSBjaGFyO1xuICB9IGVsc2Uge1xuICAgIHRoaXMudGFiID0gbmV3IEFycmF5KHRoaXMudGFiU2l6ZSArIDEpLmpvaW4oY2hhcik7XG4gIH1cbn1cblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICB0aGlzLnJlcGFpbnQodHJ1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkhpc3RvcnlDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXIoJ2NvZGUnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5lbWl0KCdoaXN0b3J5IGNoYW5nZScpXG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJlZm9yZUZpbGVDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgdGhpcy5lZGl0Q2FyZXRCZWZvcmUgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKGVkaXRSYW5nZSwgZWRpdFNoaWZ0LCB0ZXh0QmVmb3JlLCB0ZXh0QWZ0ZXIpIHtcbiAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gIHRoaXMuZWRpdGluZyA9IHRydWU7XG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcblxuICBpZiAodGhpcy5maW5kLmlzT3Blbikge1xuICAgIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUsIHRydWUpO1xuICB9XG5cbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcblxuICB0aGlzLnZpZXdzLmNvZGUucmVuZGVyRWRpdCh7XG4gICAgbGluZTogZWRpdFJhbmdlWzBdLFxuICAgIHJhbmdlOiBlZGl0UmFuZ2UsXG4gICAgc2hpZnQ6IGVkaXRTaGlmdCxcbiAgICBjYXJldE5vdzogdGhpcy5jYXJldCxcbiAgICBjYXJldEJlZm9yZTogdGhpcy5lZGl0Q2FyZXRCZWZvcmVcbiAgfSk7XG5cbiAgdGhpcy5yZW5kZXIoJ2NhcmV0Jyk7XG4gIHRoaXMucmVuZGVyKCdyb3dzJyk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG4gIHRoaXMucmVuZGVyKCdydWxlcicpO1xuICB0aGlzLnJlbmRlcignYmxvY2snKTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXRGcm9tUHggPSBmdW5jdGlvbihweCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMubWFyZ2luTGVmdCwgeTogdGhpcy5jaGFyLmhlaWdodC8yIH0pWycrJ10odGhpcy5vZmZzZXQpO1xuICBpZiAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCkgZy55ICs9IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIHwgMDtcbiAgdmFyIHAgPSBweFsnLSddKGcpWycrJ10odGhpcy5zY3JvbGwpWydvLyddKHRoaXMuY2hhcik7XG5cbiAgcC55ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocC55LCB0aGlzLmJ1ZmZlci5sb2MoKSkpO1xuICBwLnggPSBNYXRoLm1heCgwLCBwLngpO1xuXG4gIHZhciB0YWJzID0gdGhpcy5nZXRDb29yZHNUYWJzKHApO1xuXG4gIHAueCA9IE1hdGgubWF4KFxuICAgIDAsXG4gICAgTWF0aC5taW4oXG4gICAgICBwLnggLSB0YWJzLnRhYnMgKyB0YWJzLnJlbWFpbmRlcixcbiAgICAgIHRoaXMuZ2V0TGluZUxlbmd0aChwLnkpXG4gICAgKVxuICApO1xuXG4gIHRoaXMuc2V0Q2FyZXQocCk7XG4gIHRoaXMubW92ZS5sYXN0RGVsaWJlcmF0ZVggPSBwLng7XG4gIHRoaXMub25Nb3ZlKCk7XG5cbiAgcmV0dXJuIHA7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlVXAgPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB0aGlzLmJsdXIoKTtcbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRG93biA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KHRoaXMuZm9jdXMuYmluZCh0aGlzKSwgMTApO1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCkgdGhpcy5tYXJrQmVnaW4oKTtcbiAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXQgPSBmdW5jdGlvbihwLCBjZW50ZXIsIGFuaW1hdGUpIHtcbiAgdGhpcy5jYXJldC5zZXQocCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldFBvaW50VGFicyh0aGlzLmNhcmV0KTtcblxuICB0aGlzLmNhcmV0UHguc2V0KHtcbiAgICB4OiB0aGlzLmNoYXIud2lkdGggKiAodGhpcy5jYXJldC54ICsgdGFicy50YWJzICogdGhpcy50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpLFxuICAgIHk6IHRoaXMuY2hhci5oZWlnaHQgKiB0aGlzLmNhcmV0LnlcbiAgfSk7XG5cbiAgdGhpcy5mb2xsb3dDYXJldChjZW50ZXIsIGFuaW1hdGUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZUNsaWNrID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjbGlja3MgPSB0aGlzLmlucHV0Lm1vdXNlLmNsaWNrcztcbiAgaWYgKGNsaWNrcyA+IDEpIHtcbiAgICB2YXIgYXJlYTtcblxuICAgIGlmIChjbGlja3MgPT09IDIpIHtcbiAgICAgIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXJlYUF0UG9pbnQodGhpcy5jYXJldCk7XG4gICAgfSBlbHNlIGlmIChjbGlja3MgPT09IDMpIHtcbiAgICAgIHZhciB5ID0gdGhpcy5jYXJldC55O1xuICAgICAgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgICAgYmVnaW46IHsgeDogMCwgeTogeSB9LFxuICAgICAgICBlbmQ6IHsgeDogdGhpcy5nZXRMaW5lTGVuZ3RoKHkpLCB5OiB5IH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLnNldENhcmV0KGFyZWEuZW5kKTtcbiAgICAgIHRoaXMubWFya1NldEFyZWEoYXJlYSk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xuICB0aGlzLmNsZWFyKCdtYXJrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJldHVybiBSYW5nZS5jbGFtcChyYW5nZSwgdGhpcy5wYWdlQm91bmRzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBzID0gdGhpcy5zY3JvbGwuY29weSgpO1xuICBpZiAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCkge1xuICAgIHMueSAtPSB0aGlzLnNpemUuaGVpZ2h0IC8gMyB8IDA7XG4gIH1cbiAgdmFyIHAgPSBzWydfLyddKHRoaXMuY2hhcik7XG4gIHJldHVybiB0aGlzLmdldFJhbmdlKFtcbiAgICBNYXRoLmZsb29yKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVswXSksXG4gICAgTWF0aC5jZWlsKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMV0pXG4gIF0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBmdW5jdGlvbihjZW50ZXIsIGFuaW1hdGUpIHtcbiAgdmFyIHAgPSB0aGlzLmNhcmV0UHg7XG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdmFyIHRvcCA9IChcbiAgICAgIHMueVxuICAgICsgKGNlbnRlciAmJiAhdGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMiB8IDApIC0gMTAwIDogMClcbiAgKSAtIHAueTtcblxuICB2YXIgYm90dG9tID0gcC55IC0gKFxuICAgICAgcy55XG4gICAgKyB0aGlzLnNpemUuaGVpZ2h0XG4gICAgLSAoY2VudGVyICYmICF0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAyIHwgMCkgLSAxMDAgOiAwKVxuICAgIC0gKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDMgKiAyIHwgMCkgOiAwKVxuICApICsgdGhpcy5jaGFyLmhlaWdodDtcblxuICB2YXIgbGVmdCA9IChzLnggKyB0aGlzLmNoYXIud2lkdGgpIC0gcC54O1xuICB2YXIgcmlnaHQgPSAocC54KSAtIChzLnggKyB0aGlzLnNpemUud2lkdGggLSB0aGlzLm1hcmdpbkxlZnQpICsgdGhpcy5jaGFyLndpZHRoICogMjtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICBpZiAobGVmdCArIHRvcCArIHJpZ2h0ICsgYm90dG9tKSB7XG4gICAgdGhpc1thbmltYXRlID8gJ2FuaW1hdGVTY3JvbGxCeScgOiAnc2Nyb2xsQnknXShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCwgJ2Vhc2UnKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsVG8gPSBmdW5jdGlvbihwKSB7XG4gIGRvbS5zY3JvbGxUbyh0aGlzLmVsLCBwLngsIHAueSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgdmFyIHRhcmdldCA9IFBvaW50Lmxvdyh7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH0sIHtcbiAgICB4OiB0aGlzLnNjcm9sbC54ICsgeCxcbiAgICB5OiB0aGlzLnNjcm9sbC55ICsgeVxuICB9KTtcblxuICBpZiAoUG9pbnQuc29ydCh0YXJnZXQsIHRoaXMuc2Nyb2xsKSAhPT0gMCkge1xuICAgIHRoaXMuc2Nyb2xsLnNldCh0YXJnZXQpO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5zY3JvbGwpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRlU2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5LCBhbmltYXRpb25UeXBlKSB7XG4gIHRoaXMuYW5pbWF0aW9uVHlwZSA9IGFuaW1hdGlvblR5cGUgfHwgJ2xpbmVhcic7XG5cbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICBpZiAoJ2xpbmVhcicgPT09IHRoaXMuYW5pbWF0aW9uVHlwZSkge1xuICAgICAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICAgIH1cbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSB0cnVlO1xuICAgIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4pO1xuICB9XG5cbiAgdmFyIHMgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCB8fCB0aGlzLnNjcm9sbDtcblxuICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5tYXgoMCwgcy54ICsgeCksXG4gICAgeTogTWF0aC5taW4oXG4gICAgICAgICh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0XG4gICAgICArICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gdGhpcy5zaXplLmhlaWdodCAvIDMgKiAyIHwgMCA6IDApLFxuICAgICAgTWF0aC5tYXgoMCwgcy55ICsgeSlcbiAgICApXG4gIH0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICBkeCA9IE1hdGguc2lnbihkeCkgKiA1O1xuICBkeSA9IE1hdGguc2lnbihkeSkgKiA1O1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzcGVlZCA9IHRoaXMub3B0aW9ucy5zY3JvbGxfc3BlZWQ7XG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgdmFyIGFkeCA9IE1hdGguYWJzKGR4KTtcbiAgdmFyIGFkeSA9IE1hdGguYWJzKGR5KTtcblxuICBpZiAoYWR5ID49IHRoaXMuc2l6ZS5oZWlnaHQgKiAxLjIpIHtcbiAgICBzcGVlZCAqPSAyLjQ1O1xuICB9XG5cbiAgaWYgKChhZHggPCAxICYmIGFkeSA8IDEpIHx8ICF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0KTtcbiAgICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG51bGw7XG4gICAgdGhpcy5lbWl0KCdhbmltYXRpb24gZW5kJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgc3dpdGNoICh0aGlzLmFuaW1hdGlvblR5cGUpIHtcbiAgICBjYXNlICdsaW5lYXInOlxuICAgICAgaWYgKGFkeCA8IHNwZWVkKSBkeCAqPSAwLjk7XG4gICAgICBlbHNlIGR4ID0gTWF0aC5zaWduKGR4KSAqIHNwZWVkO1xuXG4gICAgICBpZiAoYWR5IDwgc3BlZWQpIGR5ICo9IDAuOTtcbiAgICAgIGVsc2UgZHkgPSBNYXRoLnNpZ24oZHkpICogc3BlZWQ7XG5cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2Vhc2UnOlxuICAgICAgZHggKj0gMC41O1xuICAgICAgZHkgKj0gMC41O1xuICAgICAgYnJlYWs7XG4gIH1cblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLmRlbGV0ZSgpO1xuXG4gIHRoaXMuZW1pdCgnaW5wdXQnLCB0ZXh0LCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSk7XG5cbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dCh0aGlzLmNhcmV0LnkpO1xuICB2YXIgcmlnaHQgPSBsaW5lW3RoaXMuY2FyZXQueF07XG4gIHZhciBoYXNSaWdodFN5bWJvbCA9IH5bJ30nLCddJywnKSddLmluZGV4T2YocmlnaHQpO1xuXG4gIC8vIGFwcGx5IGluZGVudCBvbiBlbnRlclxuICBpZiAoTkVXTElORS50ZXN0KHRleHQpKSB7XG4gICAgdmFyIGlzRW5kT2ZMaW5lID0gdGhpcy5jYXJldC54ID09PSBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGxlZnQgPSBsaW5lW3RoaXMuY2FyZXQueCAtIDFdO1xuICAgIHZhciBpbmRlbnQgPSBsaW5lLm1hdGNoKC9cXFMvKTtcbiAgICBpbmRlbnQgPSBpbmRlbnQgPyBpbmRlbnQuaW5kZXggOiBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGhhc0xlZnRTeW1ib2wgPSB+Wyd7JywnWycsJygnXS5pbmRleE9mKGxlZnQpO1xuXG4gICAgaWYgKGhhc0xlZnRTeW1ib2wpIGluZGVudCArPSAyO1xuXG4gICAgaWYgKGlzRW5kT2ZMaW5lIHx8IGhhc0xlZnRTeW1ib2wpIHtcbiAgICAgIHRleHQgKz0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKTtcbiAgICB9XG4gIH1cblxuICB2YXIgbGVuZ3RoO1xuXG4gIGlmICghaGFzUmlnaHRTeW1ib2wgfHwgKGhhc1JpZ2h0U3ltYm9sICYmICF+Wyd9JywnXScsJyknXS5pbmRleE9mKHRleHQpKSkge1xuICAgIGxlbmd0aCA9IHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCB0ZXh0LCBudWxsLCB0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSAxO1xuICB9XG5cbiAgdGhpcy5tb3ZlLmJ5Q2hhcnMobGVuZ3RoLCB0cnVlKTtcblxuICBpZiAoJ3snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ30nKTtcbiAgZWxzZSBpZiAoJygnID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJyknKTtcbiAgZWxzZSBpZiAoJ1snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ10nKTtcblxuICBpZiAoaGFzTGVmdFN5bWJvbCAmJiBoYXNSaWdodFN5bWJvbCkge1xuICAgIGluZGVudCAtPSAyO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJykpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iYWNrc3BhY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybiB0aGlzLmRlbGV0ZSgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMCcsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcblxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKHRydWUpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xLCB0cnVlKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm4gdGhpcy5iYWNrc3BhY2UoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmVtaXQoJ2lucHV0JywgJ1xcdWFhYTEnLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSk7XG5cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSh0cnVlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZmluZEp1bXAgPSBmdW5jdGlvbihqdW1wKSB7XG4gIGlmICghdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggfHwgIXRoaXMuZmluZC5pc09wZW4pIHJldHVybjtcblxuICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmROZWVkbGUgKyBqdW1wO1xuICBpZiAodGhpcy5maW5kTmVlZGxlID49IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gMDtcbiAgfSBlbHNlIGlmICh0aGlzLmZpbmROZWVkbGUgPCAwKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggLSAxO1xuICB9XG5cbiAgdGhpcy5maW5kLmluZm8oMSArIHRoaXMuZmluZE5lZWRsZSArICcvJyArIHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKTtcblxuICB2YXIgcmVzdWx0ID0gdGhpcy5maW5kUmVzdWx0c1t0aGlzLmZpbmROZWVkbGVdO1xuICB0aGlzLnNldENhcmV0KHJlc3VsdCwgdHJ1ZSwgdHJ1ZSk7XG4gIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLm1vdmUuYnlDaGFycyh0aGlzLmZpbmRWYWx1ZS5sZW5ndGgsIHRydWUpO1xuICB0aGlzLm1hcmtTZXQoKTtcbiAgdGhpcy5mb2xsb3dDYXJldCh0cnVlLCB0cnVlKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZFZhbHVlID0gZnVuY3Rpb24odmFsdWUsIG5vSnVtcCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMuZ3V0dGVyLCB5OiAwIH0pO1xuXG4gIHRoaXMuYnVmZmVyLnVwZGF0ZVJhdygpO1xuICB0aGlzLmZpbmRWYWx1ZSA9IHZhbHVlO1xuICB0aGlzLmZpbmRSZXN1bHRzID0gdGhpcy5idWZmZXIuaW5kZXhlci5maW5kKHZhbHVlKS5tYXAoKG9mZnNldCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpO1xuICB9KTtcblxuICBpZiAodGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuICB9XG5cbiAgaWYgKCFub0p1bXApIHRoaXMuZmluZEp1bXAoMCk7XG5cbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZEtleSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKH5bMzMsIDM0LCAxMTRdLmluZGV4T2YoZS53aGljaCkpIHsgLy8gcGFnZXVwLCBwYWdlZG93biwgZjNcbiAgICB0aGlzLmlucHV0LnRleHQub25rZXlkb3duKGUpO1xuICB9XG5cbiAgaWYgKDcwID09PSBlLndoaWNoICYmIGUuY3RybEtleSkgeyAvLyBjdHJsK2ZcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICg5ID09PSBlLndoaWNoKSB7IC8vIHRhYlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZmluZC5pbmZvKCcnKTtcbiAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRDbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyKCdmaW5kJyk7XG4gIHRoaXMuZm9jdXMoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnN1Z2dlc3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXJlYUF0UG9pbnQodGhpcy5jYXJldCwgdHJ1ZSk7XG4gIGlmICghYXJlYSkgcmV0dXJuO1xuXG4gIHZhciBrZXkgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgaWYgKCFrZXkpIHJldHVybjtcblxuICBpZiAoIXRoaXMuc3VnZ2VzdFJvb3RcbiAgICB8fCBrZXkuc3Vic3RyKDAsIHRoaXMuc3VnZ2VzdFJvb3QubGVuZ3RoKSAhPT0gdGhpcy5zdWdnZXN0Um9vdCkge1xuICAgIHRoaXMuc3VnZ2VzdEluZGV4ID0gMDtcbiAgICB0aGlzLnN1Z2dlc3RSb290ID0ga2V5O1xuICAgIHRoaXMuc3VnZ2VzdE5vZGVzID0gdGhpcy5idWZmZXIucHJlZml4LmNvbGxlY3Qoa2V5KTtcbiAgfVxuXG4gIGlmICghdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoKSByZXR1cm47XG4gIHZhciBub2RlID0gdGhpcy5zdWdnZXN0Tm9kZXNbdGhpcy5zdWdnZXN0SW5kZXhdO1xuXG4gIHRoaXMuc3VnZ2VzdEluZGV4ID0gKHRoaXMuc3VnZ2VzdEluZGV4ICsgMSkgJSB0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGg7XG5cbiAgcmV0dXJuIHtcbiAgICBhcmVhOiBhcmVhLFxuICAgIG5vZGU6IG5vZGVcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBvaW50VGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFiID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlciArIHRhYnNcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldENvb3Jkc1RhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYnMgKiB0aGlzLnRhYlNpemUgKyByZW1haW5kZXIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXBhaW50ID0gZnVuY3Rpb24oY2xlYXIpIHtcbiAgdGhpcy5yZXNpemUoKTtcbiAgaWYgKGNsZWFyKSB0aGlzLnZpZXdzLmNsZWFyKCk7XG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyICQgPSB0aGlzLmVsO1xuXG4gIGRvbS5jc3ModGhpcy5pZCwgYFxuICAgIC4ke2Nzcy5yb3dzfSxcbiAgICAuJHtjc3MubWFya30sXG4gICAgLiR7Y3NzLmNvZGV9LFxuICAgIG1hcmssXG4gICAgcCxcbiAgICB0LFxuICAgIGssXG4gICAgZCxcbiAgICBuLFxuICAgIG8sXG4gICAgZSxcbiAgICBtLFxuICAgIGYsXG4gICAgcixcbiAgICBjLFxuICAgIHMsXG4gICAgbCxcbiAgICB4IHtcbiAgICAgIGZvbnQtZmFtaWx5OiBtb25vc3BhY2U7XG4gICAgICBmb250LXNpemU6ICR7dGhpcy5vcHRpb25zLmZvbnRfc2l6ZX07XG4gICAgICBsaW5lLWhlaWdodDogJHt0aGlzLm9wdGlvbnMubGluZV9oZWlnaHR9O1xuICAgIH1cbiAgICBgXG4gICk7XG5cbiAgdGhpcy5vZmZzZXQuc2V0KGRvbS5nZXRPZmZzZXQoJCkpO1xuICB0aGlzLnNjcm9sbC5zZXQoZG9tLmdldFNjcm9sbCgkKSk7XG4gIHRoaXMuc2l6ZS5zZXQoZG9tLmdldFNpemUoJCkpO1xuXG4gIC8vIHRoaXMgaXMgYSB3ZWlyZCBmaXggd2hlbiBkb2luZyBtdWx0aXBsZSAudXNlKClcbiAgLy8gaWYgKHRoaXMuY2hhci53aWR0aCA9PT0gMClcbiAgdGhpcy5jaGFyLnNldChkb20uZ2V0Q2hhclNpemUoJCwgY3NzLmNvZGUpKTtcblxuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2MoKTtcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG4gIHRoaXMucGFnZS5zZXQodGhpcy5zaXplWydeLyddKHRoaXMuY2hhcikpO1xuICB0aGlzLnBhZ2VSZW1haW5kZXIuc2V0KHRoaXMuc2l6ZVsnLSddKHRoaXMucGFnZVsnXyonXSh0aGlzLmNoYXIpKSk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuICAvLyB0aGlzLmxvbmdlc3RMaW5lID0gTWF0aC5taW4oNTAwLCB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMb25nZXN0TGluZUxlbmd0aCgpKTtcblxuICB0aGlzLmd1dHRlciA9IE1hdGgubWF4KFxuICAgIHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWxcbiAgICAgID8gTWF0aC5tYXgoXG4gICAgICAgICAgKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICAgICAgICggdGhpcy5wYWdlLndpZHRoIC0gODFcbiAgICAgICAgICAtICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aClcbiAgICAgICAgICApIC8gMiB8IDBcbiAgICAgICAgKSA6IDApXG4gICAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiBNYXRoLm1heCgzLCAoJycrdGhpcy5yb3dzKS5sZW5ndGgpKVxuICApICogdGhpcy5jaGFyLndpZHRoXG4gICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3NcbiAgICAgID8gMFxuICAgICAgOiB0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbiAqICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWwgPyAtMSA6IDEpXG4gICAgKTtcblxuICB0aGlzLm1hcmdpbkxlZnQgPSB0aGlzLmd1dHRlciArIHRoaXMub3B0aW9ucy5tYXJnaW5fbGVmdDtcbiAgdGhpcy5jb2RlTGVmdCA9IHRoaXMubWFyZ2luTGVmdCArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgdGhpcy5oZWlnaHQgPSAodGhpcy5yb3dzICsgdGhpcy5wYWdlLmhlaWdodClcbiAgICAqIHRoaXMuY2hhci5oZWlnaHRcbiAgICArIHRoaXMucGFnZVJlbWFpbmRlci5oZWlnaHQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjJyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSB7XG4gICAgICB0b3A6ICR7dGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIDogMH1weDtcbiAgICB9XG5cbiAgICAuJHtjc3Mucm93c30sXG4gICAgLiR7Y3NzLm1hcmt9LFxuICAgIC4ke2Nzcy5jb2RlfSxcbiAgICBtYXJrLFxuICAgIHAsXG4gICAgdCxcbiAgICBrLFxuICAgIGQsXG4gICAgbixcbiAgICBvLFxuICAgIGUsXG4gICAgbSxcbiAgICBmLFxuICAgIHIsXG4gICAgYyxcbiAgICBzLFxuICAgIGwsXG4gICAgeCB7XG4gICAgICBmb250LWZhbWlseTogbW9ub3NwYWNlO1xuICAgICAgZm9udC1zaXplOiAke3RoaXMub3B0aW9ucy5mb250X3NpemV9O1xuICAgICAgbGluZS1oZWlnaHQ6ICR7dGhpcy5vcHRpb25zLmxpbmVfaGVpZ2h0fTtcbiAgICB9XG5cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ydWxlcn0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuZmluZH0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubWFya30sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuY29kZX0ge1xuICAgICAgbWFyZ2luLWxlZnQ6ICR7dGhpcy5jb2RlTGVmdH1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJvd3N9IHtcbiAgICAgIHdpZHRoOiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuZmluZH0gPiBpLFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmJsb2NrfSA+IGkge1xuICAgICAgaGVpZ2h0OiAke3RoaXMuY2hhci5oZWlnaHQgKyAxfXB4O1xuICAgIH1cbiAgICB4IHtcbiAgICAgIGJhY2tncm91bmQtaW1hZ2U6IHVybCgke2RhdGFVUkx9KTtcbiAgICB9YFxuICApO1xuXG4gIHRoaXMuZW1pdCgncmVzaXplJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdGhpcy52aWV3c1tuYW1lXS5jbGVhcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24obmFtZSkge1xuICBjYW5jZWxBbmltYXRpb25GcmFtZSh0aGlzLnJlbmRlclJlcXVlc3QpO1xuICBpZiAodGhpcy5yZW5kZXJSZXF1ZXN0U3RhcnRlZEF0ID09PSAtMSkge1xuICAgIHRoaXMucmVuZGVyUmVxdWVzdFN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKERhdGUubm93KCkgLSB0aGlzLnJlbmRlclJlcXVlc3RTdGFydGVkQXQgPiAxMDApIHtcbiAgICAgIHRoaXMuX3JlbmRlcigpO1xuICAgIH1cbiAgfVxuICBpZiAoIX50aGlzLnJlbmRlclF1ZXVlLmluZGV4T2YobmFtZSkpIHtcbiAgICBpZiAobmFtZSBpbiB0aGlzLnZpZXdzKSB7XG4gICAgICB0aGlzLnJlbmRlclF1ZXVlLnB1c2gobmFtZSk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUmVxdWVzdCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLl9yZW5kZXIpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuX3JlbmRlciA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygncmVuZGVyJylcbiAgdGhpcy5yZW5kZXJSZXF1ZXN0U3RhcnRlZEF0ID0gLTE7XG4gIHRoaXMucmVuZGVyUXVldWUuZm9yRWFjaChuYW1lID0+IHRoaXMudmlld3NbbmFtZV0ucmVuZGVyKHtcbiAgICBvZmZzZXQ6IHtcbiAgICAgIGxlZnQ6IHRoaXMuc2Nyb2xsLngsXG4gICAgICB0b3A6IHRoaXMuc2Nyb2xsLnkgLSB0aGlzLmVsLnNjcm9sbFRvcFxuICAgIH1cbiAgfSkpO1xuICB0aGlzLnJlbmRlclF1ZXVlID0gW107XG59O1xuXG4vLyB0aGlzIGlzIHVzZWQgZm9yIGRldmVsb3BtZW50IGRlYnVnIHB1cnBvc2VzXG5mdW5jdGlvbiBiaW5kQ2FsbFNpdGUoZm4pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMsIGQpIHtcbiAgICB2YXIgZXJyID0gbmV3IEVycm9yO1xuICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKGVyciwgYXJndW1lbnRzLmNhbGxlZSk7XG4gICAgdmFyIHN0YWNrID0gZXJyLnN0YWNrO1xuICAgIGNvbnNvbGUubG9nKHN0YWNrKTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMsIGQpO1xuICB9O1xufVxuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFyZWE7XG5cbmZ1bmN0aW9uIEFyZWEoYSkge1xuICBpZiAoYSkge1xuICAgIHRoaXMuYmVnaW4gPSBuZXcgUG9pbnQoYS5iZWdpbik7XG4gICAgdGhpcy5lbmQgPSBuZXcgUG9pbnQoYS5lbmQpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuYmVnaW4gPSBuZXcgUG9pbnQ7XG4gICAgdGhpcy5lbmQgPSBuZXcgUG9pbnQ7XG4gIH1cbn1cblxuQXJlYS5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IEFyZWEodGhpcyk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHMgPSBbdGhpcy5iZWdpbiwgdGhpcy5lbmRdLnNvcnQoUG9pbnQuc29ydCk7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IG5ldyBQb2ludChzWzBdKSxcbiAgICBlbmQ6IG5ldyBQb2ludChzWzFdKVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdGhpcy5iZWdpbi5zZXQoYXJlYS5iZWdpbik7XG4gIHRoaXMuZW5kLnNldChhcmVhLmVuZCk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXRMZWZ0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLmJlZ2luLnggPSB4O1xuICB0aGlzLmVuZC54ID0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgaWYgKHRoaXMuYmVnaW4ueCkgdGhpcy5iZWdpbi54ICs9IHg7XG4gIGlmICh0aGlzLmVuZC54KSB0aGlzLmVuZC54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkQm90dG9tID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLmVuZC55ICs9IHk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2hpZnRCeUxpbmVzID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLmJlZ2luLnkgKz0geTtcbiAgdGhpcy5lbmQueSArPSB5O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz4nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5lbmQueVxuICAgID8gdGhpcy5iZWdpbi54ID4gYS5lbmQueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PSddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgPyB0aGlzLmJlZ2luLnggPj0gYS5iZWdpbi54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPCddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5iZWdpbi55XG4gICAgPyB0aGlzLmVuZC54IDwgYS5iZWdpbi54XG4gICAgOiB0aGlzLmVuZC55IDwgYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueVxuICAgID8gdGhpcy5lbmQueCA8PSBhLmVuZC54XG4gICAgOiB0aGlzLmVuZC55IDwgYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJz4nXShhKSAmJiB0aGlzWyc8J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD4nXSA9XG5BcmVhLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPCddKGEpIHx8IHRoaXNbJz4nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PTwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJz49J10oYSkgJiYgdGhpc1snPD0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PT4nXSA9XG5BcmVhLnByb3RvdHlwZS5vdXRzaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8PSddKGEpIHx8IHRoaXNbJz49J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPT09J10gPVxuQXJlYS5wcm90b3R5cGUuZXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnggPT09IGEuYmVnaW4ueCAmJiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgICAgJiYgdGhpcy5lbmQueCAgID09PSBhLmVuZC54ICAgJiYgdGhpcy5lbmQueSAgID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9J10gPVxuQXJlYS5wcm90b3R5cGUuYmVnaW5MaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9fCddID1cbkFyZWEucHJvdG90eXBlLmVuZExpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD18J10gPVxuQXJlYS5wcm90b3R5cGUubGluZXNFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJ3w9J10oYSkgJiYgdGhpc1snPXwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9fD0nXSA9XG5BcmVhLnByb3RvdHlwZS5zYW1lTGluZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gdGhpcy5lbmQueSAmJiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycteC0nXSA9XG5BcmVhLnByb3RvdHlwZS5zaG9ydGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggKyB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggLSB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnK3grJ10gPVxuQXJlYS5wcm90b3R5cGUud2lkZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCAtIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCArIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEub2Zmc2V0ID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXQoYi5iZWdpbiwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXQoYi5lbmQsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRYID0gZnVuY3Rpb24oeCwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRYKHgsIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WCh4LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WSh5LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFkoeSwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICBsZXQgYXJlYSA9IHRoaXMuZ2V0KClcbiAgcmV0dXJuICcnICsgYXJlYS5iZWdpbiArICd8JyArIGFyZWEuZW5kO1xufTtcblxuQXJlYS5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55ID09PSBiLmJlZ2luLnlcbiAgICA/IGEuYmVnaW4ueCAtIGIuYmVnaW4ueFxuICAgIDogYS5iZWdpbi55IC0gYi5iZWdpbi55O1xufTtcblxuQXJlYS50b1BvaW50U29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA8PSBiLnkgJiYgYS5lbmQueSA+PSBiLnlcbiAgICA/IGEuYmVnaW4ueSA9PT0gYi55XG4gICAgICA/IGEuYmVnaW4ueCAtIGIueFxuICAgICAgOiBhLmVuZC55ID09PSBiLnlcbiAgICAgICAgPyBhLmVuZC54IC0gYi54XG4gICAgICAgIDogMFxuICAgIDogYS5iZWdpbi55IC0gYi55O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBiaW5hcnlTZWFyY2g7XG5cbmZ1bmN0aW9uIGJpbmFyeVNlYXJjaChhcnJheSwgY29tcGFyZSkge1xuICB2YXIgaW5kZXggPSAtMTtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGxvdyA9IDA7XG4gIHZhciBoaWdoID0gYXJyYXkubGVuZ3RoO1xuICBpZiAoIWhpZ2gpIHJldHVybiB7XG4gICAgaXRlbTogbnVsbCxcbiAgICBpbmRleDogMFxuICB9O1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaW5kZXg7XG4gICAgaW5kZXggPSBsb3cgKyAoaGlnaCAtIGxvdyA+PiAxKTtcbiAgICB2YXIgaXRlbSA9IGFycmF5W2luZGV4XTtcbiAgICB2YXIgcmVzdWx0ID0gY29tcGFyZShpdGVtKTtcblxuICAgIGlmIChyZXN1bHQpIGxvdyA9IGluZGV4O1xuICAgIGVsc2UgaGlnaCA9IGluZGV4O1xuICB9IHdoaWxlIChwcmV2ICE9PSBpbmRleCk7XG5cbiAgaWYgKGl0ZW0gIT0gbnVsbCkge1xuICAgIHJldHVybiB7XG4gICAgICBpdGVtOiBpdGVtLFxuICAgICAgaW5kZXg6IGluZGV4XG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgaXRlbTogbnVsbCxcbiAgICBpbmRleDogfmxvdyAqIC0xIC0gMVxuICB9O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbikge1xuICB2YXIgcmVxdWVzdDtcbiAgcmV0dXJuIGZ1bmN0aW9uIHJhZldyYXAoYSwgYiwgYywgZCkge1xuICAgIHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZShyZXF1ZXN0KTtcbiAgICByZXF1ZXN0ID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZShmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpKTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gQm94O1xuXG5mdW5jdGlvbiBCb3goYikge1xuICBpZiAoYikge1xuICAgIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICAgIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy53aWR0aCA9IDA7XG4gICAgdGhpcy5oZWlnaHQgPSAwO1xuICB9XG59XG5cbkJveC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYikge1xuICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbn07XG5cbkJveC5wcm90b3R5cGVbJy8nXSA9XG5Cb3gucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXy8nXSA9XG5Cb3gucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14vJ10gPVxuQm94LnByb3RvdHlwZS5jZWlsZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnbyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLnJvdW5kKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5yb3VuZCh0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWyctJ10gPVxuQm94LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAtIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC0gKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2xvbmUob2JqKSB7XG4gIHZhciBvID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICB2YXIgdmFsID0gb2JqW2tleV07XG4gICAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgdmFsKSB7XG4gICAgICBvW2tleV0gPSBjbG9uZSh2YWwpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvW2tleV0gPSB2YWw7XG4gICAgfVxuICB9XG4gIHJldHVybiBvO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGRlYm91bmNlV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCksIG1zKTtcbiAgICByZXR1cm4gdGltZW91dDtcbiAgfVxufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2V2ZW50Jyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zdHlsZS5jc3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBEaWFsb2c7XG5cbmZ1bmN0aW9uIERpYWxvZyhsYWJlbCwga2V5bWFwKSB7XG4gIHRoaXMubm9kZSA9IGRvbShjc3MuZGlhbG9nLCBbXG4gICAgYDxsYWJlbD4ke2Nzcy5sYWJlbH1gLFxuICAgIFtjc3MuaW5wdXQsIFtcbiAgICAgIGA8aW5wdXQ+JHtjc3MudGV4dH1gLFxuICAgICAgY3NzLmluZm9cbiAgICBdXVxuICBdKTtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5sYWJlbF0sIGxhYmVsKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiAnbm9uZScgfSk7XG4gIHRoaXMua2V5bWFwID0ga2V5bWFwO1xuICB0aGlzLm9uYm9keWtleWRvd24gPSB0aGlzLm9uYm9keWtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9uY2xpY2sgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2V1cCA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZWRvd24gPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQ7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG59XG5cbkRpYWxvZy5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5mdW5jdGlvbiBzdG9wUHJvcGFnYXRpb24oZSkge1xuICBlLnN0b3BQcm9wYWdhdGlvbigpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5oYXNGb2N1cyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwuaGFzRm9jdXMoKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25ib2R5a2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDI3ID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuY2xvc2UoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMTMgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5zdWJtaXQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGUud2hpY2ggaW4gdGhpcy5rZXltYXApIHtcbiAgICB0aGlzLmVtaXQoJ2tleScsIGUpO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndmFsdWUnLCB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwudmFsdWUpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIGRvbS5hcHBlbmQoZG9jdW1lbnQuYm9keSwgdGhpcy5ub2RlKTtcbiAgZG9tLmZvY3VzKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XSk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC5zZWxlY3QoKTtcbiAgdGhpcy5pc09wZW4gPSB0cnVlO1xuICB0aGlzLmVtaXQoJ29wZW4nKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5yZW1vdmVFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgdGhpcy5ub2RlLmVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodGhpcy5ub2RlLmVsKTtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbiAgdGhpcy5lbWl0KCdjbG9zZScpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5zdWJtaXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5lbWl0KCdzdWJtaXQnLCB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwudmFsdWUpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5pbmZvID0gZnVuY3Rpb24oaW5mbykge1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIGluZm8pO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6IGluZm8gPyAnYmxvY2snIDogJ25vbmUnIH0pO1xufTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZGlhbG9nXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fZGlhbG9nXCIsXCJpbnB1dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2lucHV0XCIsXCJ0ZXh0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fdGV4dFwiLFwibGFiZWxcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19sYWJlbFwiLFwiaW5mb1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2luZm9cIn0iLCJcbm1vZHVsZS5leHBvcnRzID0gZGlmZjtcblxuZnVuY3Rpb24gZGlmZihhLCBiKSB7XG4gIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGEpIHtcbiAgICB2YXIgZCA9IHt9O1xuICAgIHZhciBpID0gMDtcbiAgICBmb3IgKHZhciBrIGluIGIpIHtcbiAgICAgIGlmIChhW2tdICE9PSBiW2tdKSB7XG4gICAgICAgIGRba10gPSBiW2tdO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpKSByZXR1cm4gZDtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYSAhPT0gYjtcbiAgfVxufVxuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi9wb2ludCcpO1xudmFyIGJpbmRSYWYgPSByZXF1aXJlKCcuL2JpbmQtcmFmJyk7XG52YXIgbWVtb2l6ZSA9IHJlcXVpcmUoJy4vbWVtb2l6ZScpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9tZXJnZScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG52YXIgdW5pdHMgPSB7XG4gIGxlZnQ6ICdweCcsXG4gIHRvcDogJ3B4JyxcbiAgcmlnaHQ6ICdweCcsXG4gIGJvdHRvbTogJ3B4JyxcbiAgd2lkdGg6ICdweCcsXG4gIGhlaWdodDogJ3B4JyxcbiAgbWF4SGVpZ2h0OiAncHgnLFxuICBwYWRkaW5nTGVmdDogJ3B4JyxcbiAgbGluZUhlaWdodDogJ3B4Jyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZG9tO1xuXG5mdW5jdGlvbiBkb20obmFtZSwgY2hpbGRyZW4sIGF0dHJzKSB7XG4gIHZhciBlbDtcbiAgdmFyIHRhZyA9ICdkaXYnO1xuICB2YXIgbm9kZTtcblxuICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiBuYW1lKSB7XG4gICAgaWYgKCc8JyA9PT0gbmFtZS5jaGFyQXQoMCkpIHtcbiAgICAgIHZhciBtYXRjaGVzID0gbmFtZS5tYXRjaCgvKD86PCkoLiopKD86PikoXFxTKyk/Lyk7XG4gICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICB0YWcgPSBtYXRjaGVzWzFdO1xuICAgICAgICBuYW1lID0gbWF0Y2hlc1syXSB8fCB0YWc7XG4gICAgICB9XG4gICAgfVxuICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCh0YWcpO1xuICAgIG5vZGUgPSB7XG4gICAgICBlbDogZWwsXG4gICAgICBuYW1lOiBuYW1lLnNwbGl0KCcgJylbMF1cbiAgICB9O1xuICAgIGRvbS5jbGFzc2VzKG5vZGUsIG5hbWUuc3BsaXQoJyAnKS5zbGljZSgxKSk7XG4gIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIHJldHVybiBkb20uYXBwbHkobnVsbCwgbmFtZSk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCdkb20nIGluIG5hbWUpIHtcbiAgICAgIG5vZGUgPSBuYW1lLmRvbTtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZSA9IG5hbWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKSB7XG4gICAgY2hpbGRyZW5cbiAgICAgIC5tYXAoZG9tKVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCwgaSkge1xuICAgICAgICBub2RlW2NoaWxkLm5hbWVdID0gY2hpbGQ7XG4gICAgICAgIHJldHVybiBjaGlsZDtcbiAgICAgIH0pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkKSB7XG4gICAgICAgIG5vZGUuZWwuYXBwZW5kQ2hpbGQoY2hpbGQuZWwpO1xuICAgICAgfSk7XG4gIH0gZWxzZSBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBjaGlsZHJlbikge1xuICAgIGRvbS5zdHlsZShub2RlLCBjaGlsZHJlbik7XG4gIH1cblxuICBpZiAoYXR0cnMpIHtcbiAgICBkb20uYXR0cnMobm9kZSwgYXR0cnMpO1xuICB9XG5cbiAgcmV0dXJuIG5vZGU7XG59XG5cbmRvbS5zdHlsZSA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIF8sIHN0eWxlKSB7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBpZiAoc3R5bGVbbmFtZV0gIT09ICdhdXRvJylcbiAgICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn0sIGRpZmYsIG1lcmdlLCBmdW5jdGlvbihub2RlLCBzdHlsZSkge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgc3R5bGVdO1xufSk7XG5cbi8qXG5kb20uc3R5bGUgPSBmdW5jdGlvbihlbCwgc3R5bGUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufTtcbiovXG5kb20uY2xhc3NlcyA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbC5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG59LCBudWxsLCBudWxsLCBmdW5jdGlvbihub2RlLCBjbGFzc2VzKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBjbGFzc2VzLmNvbmNhdChub2RlLm5hbWUpLmZpbHRlcihCb29sZWFuKS5qb2luKCcgJyldO1xufSk7XG5cbmRvbS5hdHRycyA9IGZ1bmN0aW9uKGVsLCBhdHRycykge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgT2JqZWN0LmFzc2lnbihlbCwgYXR0cnMpO1xufTtcblxuZG9tLmh0bWwgPSBmdW5jdGlvbihlbCwgaHRtbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn07XG5cbmRvbS50ZXh0ID0gZnVuY3Rpb24oZWwsIHRleHQpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLnRleHRDb250ZW50ID0gdGV4dDtcbn07XG5cbmRvbS5mb2N1cyA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5mb2N1cygpO1xufTtcblxuZG9tLmdldFNpemUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogZWwuY2xpZW50V2lkdGgsXG4gICAgaGVpZ2h0OiBlbC5jbGllbnRIZWlnaHRcbiAgfTtcbn07XG5cbmRvbS5nZXRDaGFyU2l6ZSA9IGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xuICBzcGFuLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcblxuICBlbC5hcHBlbmRDaGlsZChzcGFuKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcmbmJzcDsnO1xuICB2YXIgYSA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnJm5ic3A7Jm5ic3A7XFxuJm5ic3A7JztcbiAgdmFyIGIgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIGVsLnJlbW92ZUNoaWxkKHNwYW4pO1xuXG4gIHJldHVybiB7XG4gICAgd2lkdGg6IChiLndpZHRoIC0gYS53aWR0aCksXG4gICAgaGVpZ2h0OiAoYi5oZWlnaHQgLSBhLmhlaWdodClcbiAgfTtcbn07XG5cbmRvbS5nZXRPZmZzZXQgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpO1xuICB2YXIgYm9yZGVyTGVmdCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlckxlZnRXaWR0aCk7XG4gIHZhciBib3JkZXJUb3AgPSBwYXJzZUludChzdHlsZS5ib3JkZXJUb3BXaWR0aCk7XG4gIHJldHVybiBQb2ludC5sb3coeyB4OiAwLCB5OiAwIH0sIHtcbiAgICB4OiAocmVjdC5sZWZ0ICsgYm9yZGVyTGVmdCkgfCAwLFxuICAgIHk6IChyZWN0LnRvcCArIGJvcmRlclRvcCkgfCAwXG4gIH0pO1xufTtcblxuZG9tLmdldFNjcm9sbCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4gZ2V0U2Nyb2xsKGVsKTtcbn07XG5cbmRvbS5vbnNjcm9sbCA9IGZ1bmN0aW9uIG9uc2Nyb2xsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZzY3JvbGwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbndoZWVsID0gZnVuY3Rpb24gb253aGVlbChlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG5cbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignd2hlZWwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCd3aGVlbCcsIGhhbmRsZXIpO1xuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlcihldikge1xuICAgIGZuKGV2KTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZ3aGVlbCgpIHtcbiAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCd3aGVlbCcsIGhhbmRsZXIpO1xuICB9XG59O1xuXG5kb20ub25vZmZzZXQgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHdoaWxlIChlbCA9IGVsLm9mZnNldFBhcmVudCkge1xuICAgIGRvbS5vbnNjcm9sbChlbCwgZm4pO1xuICB9XG59O1xuXG5kb20ub25jbGljayA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICByZXR1cm4gZWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmbik7XG59O1xuXG5kb20ub25yZXNpemUgPSBmdW5jdGlvbihmbikge1xuICByZXR1cm4gd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcbn07XG5cbmRvbS5hcHBlbmQgPSBmdW5jdGlvbih0YXJnZXQsIHNyYywgZGljdCkge1xuICB0YXJnZXQgPSBkb20uZ2V0RWxlbWVudCh0YXJnZXQpO1xuICBpZiAoJ2ZvckVhY2gnIGluIHNyYykgc3JjLmZvckVhY2goZG9tLmFwcGVuZC5iaW5kKG51bGwsIHRhcmdldCkpO1xuICAvLyBlbHNlIGlmICgndmlld3MnIGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyYy52aWV3cywgdHJ1ZSk7XG4gIGVsc2UgaWYgKGRpY3QgPT09IHRydWUpIGZvciAodmFyIGtleSBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmNba2V5XSk7XG4gIGVsc2UgaWYgKCdmdW5jdGlvbicgIT0gdHlwZW9mIHNyYykgdGFyZ2V0LmFwcGVuZENoaWxkKGRvbS5nZXRFbGVtZW50KHNyYykpO1xufTtcblxuZG9tLnJlbW92ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBpZiAoZWwucGFyZW50Tm9kZSkgZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChlbCk7XG59O1xuXG5kb20uZ2V0RWxlbWVudCA9IGZ1bmN0aW9uKGVsKSB7XG4gIHJldHVybiBlbC5kb20gJiYgZWwuZG9tLmVsIHx8IGVsLmVsIHx8IGVsLm5vZGUgfHwgZWw7XG59O1xuXG5kb20uc2Nyb2xsQnkgPSBmdW5jdGlvbihlbCwgeCwgeSwgc2Nyb2xsKSB7XG4gIHNjcm9sbCA9IHNjcm9sbCB8fCBkb20uZ2V0U2Nyb2xsKGVsKTtcbiAgZG9tLnNjcm9sbFRvKGVsLCBzY3JvbGwueCArIHgsIHNjcm9sbC55ICsgeSk7XG59O1xuXG5kb20uc2Nyb2xsVG8gPSBmdW5jdGlvbihlbCwgeCwgeSkge1xuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICB3aW5kb3cuc2Nyb2xsVG8oeCwgeSk7XG4gIH0gZWxzZSB7XG4gICAgZWwuc2Nyb2xsTGVmdCA9IHggfHwgMDtcbiAgICBlbC5zY3JvbGxUb3AgPSB5IHx8IDA7XG4gIH1cbn07XG5cbmRvbS5jc3MgPSBmdW5jdGlvbihpZCwgY3NzVGV4dCkge1xuICBpZiAoIShpZCBpbiBkb20uY3NzLnN0eWxlcykpIHtcbiAgICBkb20uY3NzLnN0eWxlc1tpZF0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZG9tLmNzcy5zdHlsZXNbaWRdKTtcbiAgfVxuICBkb20uY3NzLnN0eWxlc1tpZF0udGV4dENvbnRlbnQgPSBjc3NUZXh0O1xufTtcblxuZG9tLmNzcy5zdHlsZXMgPSB7fTtcblxuZG9tLmdldE1vdXNlUG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiBnZXRTY3JvbGwoZWwpIHtcbiAgcmV0dXJuIGRvY3VtZW50LmJvZHkgPT09IGVsXG4gICAgPyB7XG4gICAgICAgIHg6IHdpbmRvdy5zY3JvbGxYIHx8IGVsLnNjcm9sbExlZnQgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbExlZnQsXG4gICAgICAgIHk6IHdpbmRvdy5zY3JvbGxZIHx8IGVsLnNjcm9sbFRvcCAgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbFRvcFxuICAgICAgfVxuICAgIDoge1xuICAgICAgICB4OiBlbC5zY3JvbGxMZWZ0LFxuICAgICAgICB5OiBlbC5zY3JvbGxUb3BcbiAgICAgIH07XG59XG4iLCJcbnZhciBwdXNoID0gW10ucHVzaDtcbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50O1xuXG5mdW5jdGlvbiBFdmVudCgpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEV2ZW50KSkgcmV0dXJuIG5ldyBFdmVudDtcblxuICB0aGlzLl9oYW5kbGVycyA9IHt9O1xufVxuXG5FdmVudC5wcm90b3R5cGUuX2dldEhhbmRsZXJzID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLl9oYW5kbGVycyA9IHRoaXMuX2hhbmRsZXJzIHx8IHt9O1xuICByZXR1cm4gdGhpcy5faGFuZGxlcnNbbmFtZV0gPSB0aGlzLl9oYW5kbGVyc1tuYW1lXSB8fCBbXTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24obmFtZSwgYSwgYiwgYywgZCkge1xuICBpZiAodGhpcy5zaWxlbnQpIHJldHVyblxuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgIGhhbmRsZXJzW2ldKGEsIGIsIGMsIGQpO1xuICB9O1xufTtcblxuRXZlbnQucHJvdG90eXBlLm9uID0gZnVuY3Rpb24obmFtZSkge1xuICB2YXIgaGFuZGxlcnM7XG4gIHZhciBuZXdIYW5kbGVycyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICBuYW1lLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgICAgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgICAgIHB1c2guYXBwbHkoaGFuZGxlcnMsIG5ld0hhbmRsZXJzW25hbWVdKTtcbiAgICB9LCB0aGlzKTtcbiAgfSBlbHNlIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgIHB1c2guYXBwbHkoaGFuZGxlcnMsIG5ld0hhbmRsZXJzKTtcbiAgfVxufTtcblxuRXZlbnQucHJvdG90eXBlLm9mZiA9IGZ1bmN0aW9uKG5hbWUsIGhhbmRsZXIpIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBpbmRleCA9IGhhbmRsZXJzLmluZGV4T2YoaGFuZGxlcik7XG4gIGlmICh+aW5kZXgpIGhhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG59O1xuXG5FdmVudC5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKG5hbWUsIGZuKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGEsIGIsIGMsIGQpIHtcbiAgICBmbihhLCBiLCBjLCBkKTtcbiAgICBoYW5kbGVycy5zcGxpY2UoaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKSwgMSk7XG4gIH07XG4gIGhhbmRsZXJzLnB1c2goaGFuZGxlcik7XG59O1xuIiwidmFyIGNsb25lID0gcmVxdWlyZSgnLi9jbG9uZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1lbW9pemUoZm4sIGRpZmYsIG1lcmdlLCBwcmUpIHtcbiAgZGlmZiA9IGRpZmYgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYSAhPT0gYiB9O1xuICBtZXJnZSA9IG1lcmdlIHx8IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGIgfTtcbiAgcHJlID0gcHJlIHx8IGZ1bmN0aW9uKG5vZGUsIHBhcmFtKSB7IHJldHVybiBwYXJhbSB9O1xuXG4gIHZhciBub2RlcyA9IFtdO1xuICB2YXIgY2FjaGUgPSBbXTtcbiAgdmFyIHJlc3VsdHMgPSBbXTtcblxuICByZXR1cm4gZnVuY3Rpb24obm9kZSwgcGFyYW0pIHtcbiAgICB2YXIgYXJncyA9IHByZShub2RlLCBwYXJhbSk7XG4gICAgbm9kZSA9IGFyZ3NbMF07XG4gICAgcGFyYW0gPSBhcmdzWzFdO1xuXG4gICAgdmFyIGluZGV4ID0gbm9kZXMuaW5kZXhPZihub2RlKTtcbiAgICBpZiAofmluZGV4KSB7XG4gICAgICB2YXIgZCA9IGRpZmYoY2FjaGVbaW5kZXhdLCBwYXJhbSk7XG4gICAgICBpZiAoIWQpIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgICAgIGVsc2Uge1xuICAgICAgICBjYWNoZVtpbmRleF0gPSBtZXJnZShjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgICAgcmVzdWx0c1tpbmRleF0gPSBmbihub2RlLCBwYXJhbSwgZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhY2hlLnB1c2goY2xvbmUocGFyYW0pKTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBpbmRleCA9IHJlc3VsdHMucHVzaChmbihub2RlLCBwYXJhbSwgcGFyYW0pKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0c1tpbmRleF07XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1lcmdlKGRlc3QsIHNyYykge1xuICBmb3IgKHZhciBrZXkgaW4gc3JjKSB7XG4gICAgZGVzdFtrZXldID0gc3JjW2tleV07XG4gIH1cbiAgcmV0dXJuIGRlc3Q7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IG9wZW47XG5cbmZ1bmN0aW9uIG9wZW4odXJsLCBjYikge1xuICByZXR1cm4gZmV0Y2godXJsKVxuICAgIC50aGVuKGdldFRleHQpXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuXG5mdW5jdGlvbiBnZXRUZXh0KHJlcykge1xuICByZXR1cm4gcmVzLnRleHQoKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBQb2ludDtcblxuZnVuY3Rpb24gUG9pbnQocCkge1xuICBpZiAocCkge1xuICAgIHRoaXMueCA9IHAueDtcbiAgICB0aGlzLnkgPSBwLnk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy54ID0gMDtcbiAgICB0aGlzLnkgPSAwO1xuICB9XG59XG5cblBvaW50LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihwKSB7XG4gIHRoaXMueCA9IHAueDtcbiAgdGhpcy55ID0gcC55O1xufTtcblxuUG9pbnQucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh0aGlzKTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycvJ10gPVxuUG9pbnQucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18vJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvLyddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14vJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKyddID1cblBvaW50LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCArIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWyctJ10gPVxuUG9pbnQucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC0gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAtIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJyonXSA9XG5Qb2ludC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXionXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbE11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvKiddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZE11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18qJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmxlcnAgPSBmdW5jdGlvbihwLCBhKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCArICgocC54IC0gdGhpcy54KSAqIGEpLFxuICAgIHk6IHRoaXMueSArICgocC55IC0gdGhpcy55KSAqIGEpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnggKyAnLCcgKyB0aGlzLnk7XG59O1xuXG5Qb2ludC5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUG9pbnQuZ3JpZFJvdW5kID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgucm91bmQoYS54IC8gYi53aWR0aCksXG4gICAgeTogTWF0aC5yb3VuZChhLnkgLyBiLmhlaWdodClcbiAgfTtcbn07XG5cblBvaW50LmxvdyA9IGZ1bmN0aW9uKGxvdywgcCkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgubWF4KGxvdy54LCBwLngpLFxuICAgIHk6IE1hdGgubWF4KGxvdy55LCBwLnkpXG4gIH07XG59O1xuXG5Qb2ludC5jbGFtcCA9IGZ1bmN0aW9uKGFyZWEsIHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5taW4oYXJlYS5lbmQueCwgTWF0aC5tYXgoYXJlYS5iZWdpbi54LCBwLngpKSxcbiAgICB5OiBNYXRoLm1pbihhcmVhLmVuZC55LCBNYXRoLm1heChhcmVhLmJlZ2luLnksIHAueSkpXG4gIH0pO1xufTtcblxuUG9pbnQub2Zmc2V0ID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4geyB4OiBhLnggKyBiLngsIHk6IGEueSArIGIueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIHApIHtcbiAgcmV0dXJuIHsgeDogcC54ICsgeCwgeTogcC55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRZID0gZnVuY3Rpb24oeSwgcCkge1xuICByZXR1cm4geyB4OiBwLngsIHk6IHAueSArIHkgfTtcbn07XG5cblBvaW50LnRvTGVmdFRvcCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIHtcbiAgICBsZWZ0OiBwLngsXG4gICAgdG9wOiBwLnlcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gQU5EO1xuXG5mdW5jdGlvbiBBTkQoYSwgYikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIG91dCA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSBhWzBdOyBpIDw9IGFbMV07IGkrKykge1xuICAgIGZvdW5kID0gZmFsc2U7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGIubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChpID49IGJbal1bMF0gJiYgaSA8PSBiW2pdWzFdKSB7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gTk9UO1xuXG5mdW5jdGlvbiBOT1QoYSwgYikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIG91dCA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSBhWzBdOyBpIDw9IGFbMV07IGkrKykge1xuICAgIGZvdW5kID0gZmFsc2U7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGIubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChpID49IGJbal1bMF0gJiYgaSA8PSBiW2pdWzFdKSB7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwidmFyIEFORCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1hbmQnKTtcbnZhciBOT1QgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtbm90Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUmFuZ2U7XG5cbmZ1bmN0aW9uIFJhbmdlKHIpIHtcbiAgaWYgKHIpIHtcbiAgICB0aGlzWzBdID0gclswXTtcbiAgICB0aGlzWzFdID0gclsxXTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzWzBdID0gMDtcbiAgICB0aGlzWzFdID0gMTtcbiAgfVxufTtcblxuUmFuZ2UuQU5EID0gQU5EO1xuUmFuZ2UuTk9UID0gTk9UO1xuXG5SYW5nZS5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUmFuZ2UuZXF1YWwgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhWzBdID09PSBiWzBdICYmIGFbMV0gPT09IGJbMV07XG59O1xuXG5SYW5nZS5jbGFtcCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZShbXG4gICAgTWF0aC5taW4oYlsxXSwgTWF0aC5tYXgoYVswXSwgYlswXSkpLFxuICAgIE1hdGgubWluKGFbMV0sIGJbMV0pXG4gIF0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UodGhpcyk7XG59O1xuXG5SYW5nZS5yYW5nZXMgPSBmdW5jdGlvbihpdGVtcykge1xuICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uKGl0ZW0pIHsgcmV0dXJuIGl0ZW0ucmFuZ2UgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPj0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA8PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3ZlcmxhcCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdIDw9IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPj0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVsxXSA8IHJhbmdlWzBdIHx8IGl0ZW0ucmFuZ2VbMF0gPiByYW5nZVsxXTtcbiAgfSk7XG59O1xuIiwiXG52YXIgUmVnZXhwID0gZXhwb3J0cztcblxuUmVnZXhwLmNyZWF0ZSA9IGZ1bmN0aW9uKG5hbWVzLCBmbGFncywgZm4pIHtcbiAgZm4gPSBmbiB8fCBmdW5jdGlvbihzKSB7IHJldHVybiBzIH07XG4gIHJldHVybiBuZXcgUmVnRXhwKFxuICAgIG5hbWVzXG4gICAgLm1hcCgobikgPT4gJ3N0cmluZycgPT09IHR5cGVvZiBuID8gUmVnZXhwLnR5cGVzW25dIDogbilcbiAgICAubWFwKChyKSA9PiBmbihyLnRvU3RyaW5nKCkuc2xpY2UoMSwtMSkpKVxuICAgIC5qb2luKCd8JyksXG4gICAgZmxhZ3NcbiAgKTtcbn07XG5cblJlZ2V4cC50eXBlcyA9IHtcbiAgJ3Rva2Vucyc6IC8uKz9cXGJ8LlxcQnxcXGIuKz8vLFxuICAnd29yZHMnOiAvW2EtekEtWjAtOV17MSx9LyxcbiAgJ3BhcnRzJzogL1suL1xcXFxcXChcXClcIidcXC06LC47PD5+IUAjJCVeJipcXHxcXCs9XFxbXFxde31gflxcPyBdKy8sXG5cbiAgJ3NpbmdsZSBjb21tZW50JzogL1xcL1xcLy4qPyQvLFxuICAnZG91YmxlIGNvbW1lbnQnOiAvXFwvXFwqW15dKj9cXCpcXC8vLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IC8oJyg/Oig/OlxcXFxcXG58XFxcXCd8W14nXFxuXSkpKj8nKS8sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogLyhcIig/Oig/OlxcXFxcXG58XFxcXFwifFteXCJcXG5dKSkqP1wiKS8sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAvKGAoPzooPzpcXFxcYHxbXmBdKSkqP2ApLyxcblxuICAnb3BlcmF0b3InOiAvIXw+PT98PD0/fD17MSwzfXwoPzomKXsxLDJ9fFxcfD9cXHx8XFw/fFxcKnxcXC98fnxcXF58JXxcXC4oPyFcXGQpfFxcK3sxLDJ9fFxcLXsxLDJ9LyxcbiAgJ2Z1bmN0aW9uJzogLyAoKD8hXFxkfFsuIF0qPyhpZnxlbHNlfGRvfGZvcnxjYXNlfHRyeXxjYXRjaHx3aGlsZXx3aXRofHN3aXRjaCkpW2EtekEtWjAtOV8gJF0rKSg/PVxcKC4qXFwpLip7KS8sXG4gICdrZXl3b3JkJzogL1xcYihicmVha3xjYXNlfGNhdGNofGNvbnN0fGNvbnRpbnVlfGRlYnVnZ2VyfGRlZmF1bHR8ZGVsZXRlfGRvfGVsc2V8ZXhwb3J0fGV4dGVuZHN8ZmluYWxseXxmb3J8ZnJvbXxpZnxpbXBsZW1lbnRzfGltcG9ydHxpbnxpbnN0YW5jZW9mfGludGVyZmFjZXxsZXR8bmV3fHBhY2thZ2V8cHJpdmF0ZXxwcm90ZWN0ZWR8cHVibGljfHJldHVybnxzdGF0aWN8c3VwZXJ8c3dpdGNofHRocm93fHRyeXx0eXBlb2Z8d2hpbGV8d2l0aHx5aWVsZClcXGIvLFxuICAnZGVjbGFyZSc6IC9cXGIoZnVuY3Rpb258aW50ZXJmYWNlfGNsYXNzfHZhcnxsZXR8Y29uc3R8ZW51bXx2b2lkKVxcYi8sXG4gICdidWlsdGluJzogL1xcYihPYmplY3R8RnVuY3Rpb258Qm9vbGVhbnxFcnJvcnxFdmFsRXJyb3J8SW50ZXJuYWxFcnJvcnxSYW5nZUVycm9yfFJlZmVyZW5jZUVycm9yfFN0b3BJdGVyYXRpb258U3ludGF4RXJyb3J8VHlwZUVycm9yfFVSSUVycm9yfE51bWJlcnxNYXRofERhdGV8U3RyaW5nfFJlZ0V4cHxBcnJheXxGbG9hdDMyQXJyYXl8RmxvYXQ2NEFycmF5fEludDE2QXJyYXl8SW50MzJBcnJheXxJbnQ4QXJyYXl8VWludDE2QXJyYXl8VWludDMyQXJyYXl8VWludDhBcnJheXxVaW50OENsYW1wZWRBcnJheXxBcnJheUJ1ZmZlcnxEYXRhVmlld3xKU09OfEludGx8YXJndW1lbnRzfGNvbnNvbGV8d2luZG93fGRvY3VtZW50fFN5bWJvbHxTZXR8TWFwfFdlYWtTZXR8V2Vha01hcHxQcm94eXxSZWZsZWN0fFByb21pc2UpXFxiLyxcbiAgJ3NwZWNpYWwnOiAvXFxiKHRydWV8ZmFsc2V8bnVsbHx1bmRlZmluZWQpXFxiLyxcbiAgJ3BhcmFtcyc6IC9mdW5jdGlvblsgXFwoXXsxfVteXSo/XFx7LyxcbiAgJ251bWJlcic6IC8tP1xcYigweFtcXGRBLUZhLWZdK3xcXGQqXFwuP1xcZCsoW0VlXVsrLV0/XFxkKyk/fE5hTnwtP0luZmluaXR5KVxcYi8sXG4gICdzeW1ib2wnOiAvW3t9W1xcXSgpLDpdLyxcbiAgJ3JlZ2V4cCc6IC8oPyFbXlxcL10pKFxcLyg/IVtcXC98XFwqXSkuKj9bXlxcXFxcXF5dXFwvKShbO1xcblxcLlxcKVxcXVxcfSBnaW1dKS8sXG5cbiAgJ3htbCc6IC88W14+XSo+LyxcbiAgJ3VybCc6IC8oKFxcdys6XFwvXFwvKVstYS16QS1aMC05OkA7PyY9XFwvJVxcK1xcLlxcKiEnXFwoXFwpLFxcJF9cXHtcXH1cXF5+XFxbXFxdYCN8XSspLyxcbiAgJ2luZGVudCc6IC9eICt8XlxcdCsvLFxuICAnbGluZSc6IC9eLiskfF5cXG4vLFxuICAnbmV3bGluZSc6IC9cXHJcXG58XFxyfFxcbi8sXG59O1xuXG5SZWdleHAudHlwZXMuY29tbWVudCA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIGNvbW1lbnQnLFxuICAnZG91YmxlIGNvbW1lbnQnLFxuXSk7XG5cblJlZ2V4cC50eXBlcy5zdHJpbmcgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZycsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuXSk7XG5cblJlZ2V4cC50eXBlcy5tdWx0aWxpbmUgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ2RvdWJsZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG4gICdpbmRlbnQnLFxuICAnbGluZSdcbl0pO1xuXG5SZWdleHAucGFyc2UgPSBmdW5jdGlvbihzLCByZWdleHAsIGZpbHRlcikge1xuICB2YXIgd29yZHMgPSBbXTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGZpbHRlcikge1xuICAgIHdoaWxlICh3b3JkID0gcmVnZXhwLmV4ZWMocykpIHtcbiAgICAgIGlmIChmaWx0ZXIod29yZCkpIHdvcmRzLnB1c2god29yZCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHdoaWxlICh3b3JkID0gcmVnZXhwLmV4ZWMocykpIHtcbiAgICAgIHdvcmRzLnB1c2god29yZCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHdvcmRzO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBzYXZlO1xuXG5mdW5jdGlvbiBzYXZlKHVybCwgc3JjLCBjYikge1xuICByZXR1cm4gZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGJvZHk6IHNyYyxcbiAgICB9KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cbiIsIi8vIE5vdGU6IFlvdSBwcm9iYWJseSBkbyBub3Qgd2FudCB0byB1c2UgdGhpcyBpbiBwcm9kdWN0aW9uIGNvZGUsIGFzIFByb21pc2UgaXNcbi8vICAgbm90IHN1cHBvcnRlZCBieSBhbGwgYnJvd3NlcnMgeWV0LlxuXG4oZnVuY3Rpb24oKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICBpZiAod2luZG93LnNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBlbmRpbmcgPSB7fSxcbiAgICAgICAgbmV4dEhhbmRsZSA9IDE7XG5cbiAgICBmdW5jdGlvbiBvblJlc29sdmUoaGFuZGxlKSB7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICAgICAgY2FsbGJhY2suZm4uYXBwbHkobnVsbCwgY2FsbGJhY2suYXJncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3aW5kb3cuc2V0SW1tZWRpYXRlID0gZnVuY3Rpb24oZm4pIHtcbiAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICAgICAgaGFuZGxlO1xuXG4gICAgICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImludmFsaWQgZnVuY3Rpb25cIik7XG4gICAgICAgIH1cblxuICAgICAgICBoYW5kbGUgPSBuZXh0SGFuZGxlKys7XG4gICAgICAgIHBlbmRpbmdbaGFuZGxlXSA9IHsgZm46IGZuLCBhcmdzOiBhcmdzIH07XG5cbiAgICAgICAgbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICAgICAgcmVzb2x2ZShoYW5kbGUpO1xuICAgICAgICB9KS50aGVuKG9uUmVzb2x2ZSk7XG5cbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9O1xuXG4gICAgd2luZG93LmNsZWFySW1tZWRpYXRlID0gZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgfTtcbn0oKSk7IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgcnVubmluZywgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYykge1xuICAgIGlmIChydW5uaW5nKSByZXR1cm47XG4gICAgcnVubmluZyA9IHRydWU7XG4gICAgZm4uY2FsbCh0aGlzLCBhLCBiLCBjKTtcbiAgICBzZXRUaW1lb3V0KHJlc2V0LCBtcyk7XG4gIH07XG5cbiAgZnVuY3Rpb24gcmVzZXQoKSB7XG4gICAgcnVubmluZyA9IGZhbHNlO1xuICB9XG59O1xuIiwidmFyIEFyZWEgPSByZXF1aXJlKCcuLi8uLi9saWIvYXJlYScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG5cbnZhciBTa2lwU3RyaW5nID0gcmVxdWlyZSgnLi9za2lwc3RyaW5nJyk7XG52YXIgUHJlZml4VHJlZSA9IHJlcXVpcmUoJy4vcHJlZml4dHJlZScpO1xudmFyIFNlZ21lbnRzID0gcmVxdWlyZSgnLi9zZWdtZW50cycpO1xudmFyIEluZGV4ZXIgPSByZXF1aXJlKCcuL2luZGV4ZXInKTtcbnZhciBUb2tlbnMgPSByZXF1aXJlKCcuL3Rva2VucycpO1xudmFyIFN5bnRheCA9IHJlcXVpcmUoJy4vc3ludGF4Jyk7XG5cbnZhciBFT0wgPSAvXFxyXFxufFxccnxcXG4vZztcbnZhciBORVdMSU5FID0gL1xcbi9nO1xudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3Rva2VucyddLCAnZycpO1xuXG52YXIgU0VHTUVOVCA9IHtcbiAgJ2NvbW1lbnQnOiAnLyonLFxuICAnc3RyaW5nJzogJ2AnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCdWZmZXI7XG5cbmZ1bmN0aW9uIEJ1ZmZlcigpIHtcbiAgdGhpcy5sb2cgPSBbXTtcbiAgdGhpcy5zeW50YXggPSBuZXcgU3ludGF4O1xuICB0aGlzLmluZGV4ZXIgPSBuZXcgSW5kZXhlcih0aGlzKTtcbiAgdGhpcy5zZWdtZW50cyA9IG5ldyBTZWdtZW50cyh0aGlzKTtcbiAgdGhpcy5zZXRUZXh0KCcnKTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkJ1ZmZlci5wcm90b3R5cGUudXBkYXRlUmF3ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmF3ID0gdGhpcy50ZXh0LnRvU3RyaW5nKCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy51cGRhdGVSYXcoKTtcbiAgdmFyIGJ1ZmZlciA9IG5ldyBCdWZmZXI7XG4gIGJ1ZmZlci5yZXBsYWNlKHRoaXMpO1xuICByZXR1cm4gYnVmZmVyO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZXBsYWNlID0gZnVuY3Rpb24oZGF0YSkge1xuICB0aGlzLnJhdyA9IGRhdGEucmF3O1xuICB0aGlzLnRleHQuc2V0KHRoaXMucmF3KTtcbiAgdGhpcy50b2tlbnMgPSBkYXRhLnRva2Vucy5jb3B5KCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZSgpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5zZXRUZXh0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0ZXh0ID0gbm9ybWFsaXplRU9MKHRleHQpO1xuXG4gIHRoaXMucmF3ID0gdGV4dCAvL3RoaXMuc3ludGF4LmhpZ2hsaWdodCh0ZXh0KTtcblxuICB0aGlzLnN5bnRheC50YWIgPSB+dGhpcy5yYXcuaW5kZXhPZignXFx0JykgPyAnXFx0JyA6ICcgJztcblxuICB0aGlzLnRleHQgPSBuZXcgU2tpcFN0cmluZztcbiAgdGhpcy50ZXh0LnNldCh0aGlzLnJhdyk7XG5cbiAgdGhpcy50b2tlbnMgPSBuZXcgVG9rZW5zO1xuICB0aGlzLnRva2Vucy5pbmRleCh0aGlzLnJhdyk7XG4gIHRoaXMudG9rZW5zLm9uKCdjaGFuZ2Ugc2VnbWVudHMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY2hhbmdlIHNlZ21lbnRzJykpO1xuXG4gIHRoaXMucHJlZml4ID0gbmV3IFByZWZpeFRyZWU7XG4gIHRoaXMucHJlZml4LmluZGV4KHRoaXMucmF3KTtcblxuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnQgPVxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnRUZXh0QXRQb2ludCA9IGZ1bmN0aW9uKHAsIHRleHQsIG5vTG9nKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdmFyIGxlbmd0aCA9IHRleHQubGVuZ3RoO1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgc2hpZnQgPSAodGV4dC5tYXRjaChORVdMSU5FKSB8fCBbXSkubGVuZ3RoO1xuICB2YXIgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIHNoaWZ0XTtcbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcblxuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG4gIG9mZnNldFJhbmdlWzFdICs9IHRleHQubGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vTG9nKSB7XG4gICAgdmFyIGxhc3RMb2cgPSB0aGlzLmxvZ1t0aGlzLmxvZy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExvZyAmJiBsYXN0TG9nWzBdID09PSAnaW5zZXJ0JyAmJiBsYXN0TG9nWzFdWzFdID09PSBwb2ludC5vZmZzZXQpIHtcbiAgICAgIGxhc3RMb2dbMV1bMV0gKz0gdGV4dC5sZW5ndGg7XG4gICAgICBsYXN0TG9nWzJdICs9IHRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nLnB1c2goWydpbnNlcnQnLCBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQgKyB0ZXh0Lmxlbmd0aF0sIHRleHRdKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG5cbiAgcmV0dXJuIHRleHQubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmUgPVxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKG8sIG5vTG9nKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdvZmZzZXRzJywgbylcbiAgdmFyIGEgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMF0pO1xuICB2YXIgYiA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1sxXSk7XG4gIHZhciBsZW5ndGggPSBvWzBdIC0gb1sxXTtcbiAgdmFyIHJhbmdlID0gW2EueSwgYi55XTtcbiAgdmFyIHNoaWZ0ID0gYS55IC0gYi55O1xuICAvLyBjb25zb2xlLmxvZyhhLGIpXG5cbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGJlZm9yZSA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uobyk7XG4gIHRoaXMudGV4dC5yZW1vdmUobyk7XG4gIG9mZnNldFJhbmdlWzFdICs9IGxlbmd0aDtcbiAgdmFyIGFmdGVyID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgaWYgKCFub0xvZykge1xuICAgIHZhciBsYXN0TG9nID0gdGhpcy5sb2dbdGhpcy5sb2cubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxhc3RMb2cgJiYgbGFzdExvZ1swXSA9PT0gJ3JlbW92ZScgJiYgbGFzdExvZ1sxXVswXSA9PT0gb1sxXSkge1xuICAgICAgbGFzdExvZ1sxXVswXSAtPSB0ZXh0Lmxlbmd0aDtcbiAgICAgIGxhc3RMb2dbMl0gPSB0ZXh0ICsgbGFzdExvZ1syXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cucHVzaChbJ3JlbW92ZScsIG8sIHRleHRdKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldHMpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVDaGFyQXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIG9mZnNldFJhbmdlID0gW3BvaW50Lm9mZnNldCwgcG9pbnQub2Zmc2V0KzFdO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBjb2RlID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KHJhbmdlKTtcblxuICAvLyBjYWxjdWxhdGUgaW5kZW50IGZvciBgY29kZWBcbiAgLy9UT0RPOiBtb3ZlIHRvIG1ldGhvZFxuICB2YXIgbGFzdCA9IGNvZGUuc2xpY2UoY29kZS5sYXN0SW5kZXhPZignXFxuJykpO1xuICB2YXIgQW55Q2hhciA9IC9cXFMvZztcbiAgdmFyIHkgPSByYW5nZVsxXTtcbiAgdmFyIG1hdGNoID0gQW55Q2hhci5leGVjKGxhc3QpO1xuICB3aGlsZSAoIW1hdGNoICYmIHkgPCB0aGlzLmxvYygpKSB7XG4gICAgdmFyIGFmdGVyID0gdGhpcy5nZXRMaW5lVGV4dCgrK3kpO1xuICAgIEFueUNoYXIubGFzdEluZGV4ID0gMDtcbiAgICBtYXRjaCA9IEFueUNoYXIuZXhlYyhhZnRlcik7XG4gIH1cbiAgdmFyIGluZGVudCA9IDA7XG4gIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gIHZhciBpbmRlbnRUZXh0ID0gJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnN5bnRheC50YWIpO1xuXG4gIHZhciBzZWdtZW50ID0gdGhpcy5zZWdtZW50cy5nZXQocmFuZ2VbMF0pO1xuICBpZiAoc2VnbWVudCkge1xuICAgIGNvZGUgPSBTRUdNRU5UW3NlZ21lbnRdICsgJ1xcdWZmYmFcXG4nICsgY29kZSArIGluZGVudFRleHQgKyAnXFx1ZmZiZSovYCdcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUpO1xuICAgIGNvZGUgPSAnPCcgKyBzZWdtZW50WzBdICsgJz4nICtcbiAgICAgIGNvZGUuc3Vic3RyaW5nKFxuICAgICAgICBjb2RlLmluZGV4T2YoJ1xcdWZmYmEnKSArIDIsXG4gICAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUgKyBpbmRlbnRUZXh0ICsgJ1xcdWZmYmUqL2AnKTtcbiAgICBjb2RlID0gY29kZS5zdWJzdHJpbmcoMCwgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIGxpbmUgPSBuZXcgTGluZTtcbiAgbGluZS5vZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhbeSx5XSk7XG4gIGxpbmUub2Zmc2V0ID0gbGluZS5vZmZzZXRSYW5nZVswXTtcbiAgbGluZS5sZW5ndGggPSBsaW5lLm9mZnNldFJhbmdlWzFdIC0gbGluZS5vZmZzZXRSYW5nZVswXSAtICh5IDwgdGhpcy5sb2MoKSk7XG4gIGxpbmUucG9pbnQuc2V0KHsgeDowLCB5OnkgfSk7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocC55KTtcbiAgdmFyIHBvaW50ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihsaW5lLmxlbmd0aCwgcC54KSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfSk7XG4gIHBvaW50Lm9mZnNldCA9IGxpbmUub2Zmc2V0ICsgcG9pbnQueDtcbiAgcG9pbnQucG9pbnQgPSBwb2ludDtcbiAgcG9pbnQubGluZSA9IGxpbmU7XG4gIHJldHVybiBwb2ludDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlVGV4dCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VPZmZzZXRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHJhbmdlWzFdID49IHRoaXMubG9jKClcbiAgICA/IHRoaXMudGV4dC5sZW5ndGhcbiAgICA6IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVsxXSArIDEpO1xuICB2YXIgb2Zmc2V0cyA9IFthLCBiXTtcbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFJhbmdlVGV4dCA9IGZ1bmN0aW9uKG9mZnNldFJhbmdlKSB7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldFJhbmdlKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciB0b2tlbiA9IHRoaXMudG9rZW5zLmdldEJ5T2Zmc2V0KCdsaW5lcycsIG9mZnNldCAtIC41KTtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogb2Zmc2V0IC0gKG9mZnNldCA+IHRva2VuLm9mZnNldCA/IHRva2VuLm9mZnNldCArICghIXRva2VuLnBhcnQubGVuZ3RoKSA6IDApLFxuICAgIHk6IE1hdGgubWluKHRoaXMubG9jKCksIHRva2VuLmluZGV4IC0gKHRva2VuLm9mZnNldCArIDEgPiBvZmZzZXQpICsgMSlcbiAgfSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgY2hhciA9IHRoaXMudGV4dC5nZXRSYW5nZShbb2Zmc2V0LCBvZmZzZXQgKyAxXSk7XG4gIHJldHVybiBjaGFyO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4ge1xuICAgIGxpbmU6IGxpbmUsXG4gICAgdGV4dDogdGV4dCxcbiAgfVxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHRleHQgPSB0aGlzLmdldExpbmVSYW5nZVRleHQoW3kseV0pO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYVRleHQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUud29yZEFyZWFBdFBvaW50ID0gZnVuY3Rpb24ocCwgaW5jbHVzaXZlKSB7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKHBvaW50LmxpbmUub2Zmc2V0UmFuZ2UpO1xuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHBvaW50LnkgfSxcbiAgICAgIGVuZDogeyB4OiBwb2ludC5saW5lLmxlbmd0aCwgeTogcG9pbnQueSB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFyZWE7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gISFpbmNsdXNpdmUpIHtcbiAgICAgIGVuZCA9IHdvcmQuaW5kZXg7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgbGFzdEluZGV4ID0gd29yZC5pbmRleDtcbiAgfVxuXG4gIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcblxuICByZXR1cm4gYXJlYTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubW92ZUFyZWFCeUxpbmVzID0gZnVuY3Rpb24oeSwgYXJlYSkge1xuICBpZiAoYXJlYS5iZWdpbi55ICsgeSA8IDAgfHwgYXJlYS5lbmQueSArIHkgPiB0aGlzLmxvYygpKSByZXR1cm4gZmFsc2U7XG5cbiAgYXJlYS5iZWdpbi54ID0gMFxuICBhcmVhLmVuZC54ID0gdGhpcy5nZXRMaW5lKGFyZWEuZW5kLnkpLmxlbmd0aFxuXG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG5cbiAgdmFyIHggPSAwXG5cbiAgaWYgKHkgPiAwICYmIGFyZWEuYmVnaW4ueSA+IDAgfHwgYXJlYS5lbmQueSA9PT0gdGhpcy5sb2MoKSkge1xuICAgIGFyZWEuYmVnaW4ueSAtPSAxXG4gICAgYXJlYS5iZWdpbi54ID0gdGhpcy5nZXRMaW5lKGFyZWEuYmVnaW4ueSkubGVuZ3RoXG4gICAgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpXG4gICAgeCA9IEluZmluaXR5XG4gIH0gZWxzZSB7XG4gICAgb2Zmc2V0c1sxXSArPSAxXG4gIH1cblxuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKVxuXG4gIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0cylcblxuICB0aGlzLmluc2VydCh7IHg6IHgsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0KTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgcmFuZ2UgPSBbXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmJlZ2luKS5vZmZzZXQsXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmVuZCkub2Zmc2V0XG4gIF07XG4gIHJldHVybiByYW5nZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gbGluZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZU9mZnNldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIG9mZnNldCA9IHkgPCAwID8gLTEgOiB5ID09PSAwID8gMCA6IHRoaXMudG9rZW5zLmdldEJ5SW5kZXgoJ2xpbmVzJywgeSAtIDEpICsgMTtcbiAgcmV0dXJuIG9mZnNldDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubG9jID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdsaW5lcycpLmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudGV4dC50b1N0cmluZygpO1xufTtcblxuZnVuY3Rpb24gTGluZSgpIHtcbiAgdGhpcy5vZmZzZXRSYW5nZSA9IFtdO1xuICB0aGlzLm9mZnNldCA9IDA7XG4gIHRoaXMubGVuZ3RoID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRU9MKHMpIHtcbiAgcmV0dXJuIHMucmVwbGFjZShFT0wsICdcXG4nKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBJbmRleGVyO1xuXG5mdW5jdGlvbiBJbmRleGVyKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbn1cblxuSW5kZXhlci5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKCFzKSByZXR1cm4gW107XG4gIHZhciBvZmZzZXRzID0gW107XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIucmF3O1xuICB2YXIgbGVuID0gcy5sZW5ndGg7XG4gIHZhciBpbmRleDtcbiAgd2hpbGUgKH4oaW5kZXggPSB0ZXh0LmluZGV4T2YocywgaW5kZXggKyBsZW4pKSkge1xuICAgIG9mZnNldHMucHVzaChpbmRleCk7XG4gIH1cbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuIiwidmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUGFydHM7XG5cbmZ1bmN0aW9uIFBhcnRzKG1pblNpemUpIHtcbiAgbWluU2l6ZSA9IG1pblNpemUgfHwgNTAwMDtcbiAgdGhpcy5taW5TaXplID0gbWluU2l6ZTtcbiAgdGhpcy5wYXJ0cyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IDA7XG59XG5cblBhcnRzLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oaXRlbSkge1xuICB0aGlzLmFwcGVuZChbaXRlbV0pO1xufTtcblxuUGFydHMucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciBwYXJ0ID0gbGFzdCh0aGlzLnBhcnRzKTtcblxuICBpZiAoIXBhcnQpIHtcbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gMDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gMDtcbiAgICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIH1cbiAgZWxzZSBpZiAocGFydC5sZW5ndGggPj0gdGhpcy5taW5TaXplKSB7XG4gICAgdmFyIHN0YXJ0SW5kZXggPSBwYXJ0LnN0YXJ0SW5kZXggKyBwYXJ0Lmxlbmd0aDtcbiAgICB2YXIgc3RhcnRPZmZzZXQgPSBpdGVtc1swXTtcblxuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSBzdGFydEluZGV4O1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSBzdGFydE9mZnNldDtcbiAgICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIH1cblxuICBwYXJ0LnB1c2guYXBwbHkocGFydCwgaXRlbXMubWFwKG9mZnNldCA9PiBvZmZzZXQgLSBwYXJ0LnN0YXJ0T2Zmc2V0KSk7XG5cbiAgdGhpcy5sZW5ndGggKz0gaXRlbXMubGVuZ3RoO1xufTtcblxuUGFydHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHZhciBwYXJ0ID0gdGhpcy5maW5kUGFydEJ5SW5kZXgoaW5kZXgpLml0ZW07XG4gIHJldHVybiBwYXJ0W01hdGgubWluKHBhcnQubGVuZ3RoIC0gMSwgaW5kZXggLSBwYXJ0LnN0YXJ0SW5kZXgpXSArIHBhcnQuc3RhcnRPZmZzZXQ7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgcCA9IHRoaXMuZmluZFBhcnRCeU9mZnNldChvZmZzZXQpO1xuICBpZiAoIXAuaXRlbSkgcmV0dXJuIG51bGw7XG5cbiAgdmFyIHBhcnQgPSBwLml0ZW07XG4gIHZhciBwYXJ0SW5kZXggPSBwLmluZGV4O1xuICB2YXIgbyA9IHRoaXMuZmluZE9mZnNldEluUGFydChvZmZzZXQsIHBhcnQpO1xuICByZXR1cm4ge1xuICAgIG9mZnNldDogby5pdGVtICsgcGFydC5zdGFydE9mZnNldCxcbiAgICBpbmRleDogby5pbmRleCArIHBhcnQuc3RhcnRJbmRleCxcbiAgICBsb2NhbDogby5pbmRleCxcbiAgICBwYXJ0OiBwYXJ0LFxuICAgIHBhcnRJbmRleDogcGFydEluZGV4XG4gIH07XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBhcnJheSkge1xuICB2YXIgbyA9IHRoaXMuZmluZChvZmZzZXQpO1xuICBpZiAoIW8pIHtcbiAgICByZXR1cm4gdGhpcy5hcHBlbmQoYXJyYXkpO1xuICB9XG4gIGlmIChvLm9mZnNldCA+IG9mZnNldCkgby5sb2NhbCA9IC0xO1xuICB2YXIgbGVuZ3RoID0gYXJyYXkubGVuZ3RoO1xuICAvL1RPRE86IG1heWJlIHN1YnRyYWN0ICdvZmZzZXQnIGluc3RlYWQgP1xuICBhcnJheSA9IGFycmF5Lm1hcChlbCA9PiBlbCAtPSBvLnBhcnQuc3RhcnRPZmZzZXQpO1xuICBpbnNlcnQoby5wYXJ0LCBvLmxvY2FsICsgMSwgYXJyYXkpO1xuICB0aGlzLnNoaWZ0SW5kZXgoby5wYXJ0SW5kZXggKyAxLCAtbGVuZ3RoKTtcbiAgdGhpcy5sZW5ndGggKz0gbGVuZ3RoO1xufTtcblxuUGFydHMucHJvdG90eXBlLnNoaWZ0T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBzaGlmdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzO1xuICB2YXIgaXRlbSA9IHRoaXMuZmluZChvZmZzZXQpO1xuICBpZiAoIWl0ZW0pIHJldHVybjtcbiAgaWYgKG9mZnNldCA+IGl0ZW0ub2Zmc2V0KSBpdGVtLmxvY2FsICs9IDE7XG5cbiAgdmFyIHJlbW92ZWQgPSAwO1xuICBmb3IgKHZhciBpID0gaXRlbS5sb2NhbDsgaSA8IGl0ZW0ucGFydC5sZW5ndGg7IGkrKykge1xuICAgIGl0ZW0ucGFydFtpXSArPSBzaGlmdDtcbiAgICBpZiAoaXRlbS5wYXJ0W2ldICsgaXRlbS5wYXJ0LnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICByZW1vdmVkKys7XG4gICAgICBpdGVtLnBhcnQuc3BsaWNlKGktLSwgMSk7XG4gICAgfVxuICB9XG4gIGlmIChyZW1vdmVkKSB7XG4gICAgdGhpcy5zaGlmdEluZGV4KGl0ZW0ucGFydEluZGV4ICsgMSwgcmVtb3ZlZCk7XG4gICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgfVxuICBmb3IgKHZhciBpID0gaXRlbS5wYXJ0SW5kZXggKyAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBwYXJ0c1tpXS5zdGFydE9mZnNldCArPSBzaGlmdDtcbiAgICBpZiAocGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIGlmIChsYXN0KHBhcnRzW2ldKSArIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICAgIHJlbW92ZWQgPSBwYXJ0c1tpXS5sZW5ndGg7XG4gICAgICAgIHRoaXMuc2hpZnRJbmRleChpICsgMSwgcmVtb3ZlZCk7XG4gICAgICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gICAgICAgIHBhcnRzLnNwbGljZShpLS0sIDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZW1vdmVCZWxvd09mZnNldChvZmZzZXQsIHBhcnRzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBhID0gdGhpcy5maW5kKHJhbmdlWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmZpbmQocmFuZ2VbMV0pO1xuICBpZiAoIWEgJiYgIWIpIHJldHVybjtcblxuICBpZiAoYS5wYXJ0SW5kZXggPT09IGIucGFydEluZGV4KSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdCA9IHJlbW92ZShhLnBhcnQsIGEubG9jYWwsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgdGhpcy5zaGlmdEluZGV4KGEucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0O1xuICB9IGVsc2Uge1xuICAgIGlmIChhLm9mZnNldCA+PSByYW5nZVsxXSB8fCBhLm9mZnNldCA8IHJhbmdlWzBdKSBhLmxvY2FsICs9IDE7XG4gICAgaWYgKGIub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGIub2Zmc2V0IDwgcmFuZ2VbMF0pIGIubG9jYWwgLT0gMTtcbiAgICB2YXIgc2hpZnRBID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCkubGVuZ3RoO1xuICAgIHZhciBzaGlmdEIgPSByZW1vdmUoYi5wYXJ0LCAwLCBiLmxvY2FsICsgMSkubGVuZ3RoO1xuICAgIGlmIChiLnBhcnRJbmRleCAtIGEucGFydEluZGV4ID4gMSkge1xuICAgICAgdmFyIHJlbW92ZWQgPSByZW1vdmUodGhpcy5wYXJ0cywgYS5wYXJ0SW5kZXggKyAxLCBiLnBhcnRJbmRleCk7XG4gICAgICB2YXIgc2hpZnRCZXR3ZWVuID0gcmVtb3ZlZC5yZWR1Y2UoKHAsbikgPT4gcCArIG4ubGVuZ3RoLCAwKTtcbiAgICAgIGIucGFydC5zdGFydEluZGV4IC09IHNoaWZ0QSArIHNoaWZ0QmV0d2VlbjtcbiAgICAgIHRoaXMuc2hpZnRJbmRleChiLnBhcnRJbmRleCAtIHJlbW92ZWQubGVuZ3RoICsgMSwgc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuKTtcbiAgICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0QSArIHNoaWZ0QiArIHNoaWZ0QmV0d2VlbjtcbiAgICB9IGVsc2Uge1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4ICsgMSwgc2hpZnRBICsgc2hpZnRCKTtcbiAgICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0QSArIHNoaWZ0QjtcbiAgICB9XG4gIH1cblxuICAvL1RPRE86IHRoaXMgaXMgaW5lZmZpY2llbnQgYXMgd2UgY2FuIGNhbGN1bGF0ZSB0aGUgaW5kZXhlcyBvdXJzZWx2ZXNcbiAgaWYgKCFhLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGEucGFydCksIDEpO1xuICB9XG4gIGlmICghYi5wYXJ0Lmxlbmd0aCkge1xuICAgIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihiLnBhcnQpLCAxKTtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnNoaWZ0SW5kZXggPSBmdW5jdGlvbihzdGFydEluZGV4LCBzaGlmdCkge1xuICBmb3IgKHZhciBpID0gc3RhcnRJbmRleDsgaSA8IHRoaXMucGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnBhcnRzW2ldLnN0YXJ0SW5kZXggLT0gc2hpZnQ7XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVCZWxvd09mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgcGFydCkge1xuICB2YXIgbyA9IHRoaXMuZmluZE9mZnNldEluUGFydChvZmZzZXQsIHBhcnQpXG4gIHZhciBzaGlmdCA9IHJlbW92ZShwYXJ0LCAwLCBvLmluZGV4KS5sZW5ndGg7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIHNoaWZ0KTtcbiAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZE9mZnNldEluUGFydCA9IGZ1bmN0aW9uKG9mZnNldCwgcGFydCkge1xuICBvZmZzZXQgLT0gcGFydC5zdGFydE9mZnNldDtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaChwYXJ0LCBvID0+IG8gPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kUGFydEJ5SW5kZXggPSBmdW5jdGlvbihpbmRleCkge1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHRoaXMucGFydHMsIHMgPT4gcy5zdGFydEluZGV4IDw9IGluZGV4KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kUGFydEJ5T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0T2Zmc2V0IDw9IG9mZnNldCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUudG9BcnJheSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5wYXJ0cy5yZWR1Y2UoKHAsbikgPT4gcC5jb25jYXQobiksIFtdKTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGFydHMgPSBuZXcgUGFydHModGhpcy5taW5TaXplKTtcbiAgdGhpcy5wYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xuICAgIHZhciBwID0gcGFydC5zbGljZSgpO1xuICAgIHAuc3RhcnRJbmRleCA9IHBhcnQuc3RhcnRJbmRleDtcbiAgICBwLnN0YXJ0T2Zmc2V0ID0gcGFydC5zdGFydE9mZnNldDtcbiAgICBwYXJ0cy5wYXJ0cy5wdXNoKHApO1xuICB9KTtcbiAgcGFydHMubGVuZ3RoID0gdGhpcy5sZW5ndGg7XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbmZ1bmN0aW9uIGxhc3QoYXJyYXkpIHtcbiAgcmV0dXJuIGFycmF5W2FycmF5Lmxlbmd0aCAtIDFdO1xufVxuXG5mdW5jdGlvbiByZW1vdmUoYXJyYXksIGEsIGIpIHtcbiAgaWYgKGIgPT0gbnVsbCkge1xuICAgIHJldHVybiBhcnJheS5zcGxpY2UoYSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhLCBiIC0gYSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgaW5kZXgsIGFycmF5KSB7XG4gIHZhciBvcCA9IGFycmF5LnNsaWNlKCk7XG4gIG9wLnVuc2hpZnQoaW5kZXgsIDApO1xuICB0YXJnZXQuc3BsaWNlLmFwcGx5KHRhcmdldCwgb3ApO1xufVxuIiwiLy8gdmFyIFdPUkQgPSAvXFx3Ky9nO1xudmFyIFdPUkQgPSAvW2EtekEtWjAtOV17MSx9L2dcbnZhciByYW5rID0gMDtcblxubW9kdWxlLmV4cG9ydHMgPSBQcmVmaXhUcmVlTm9kZTtcblxuZnVuY3Rpb24gUHJlZml4VHJlZU5vZGUoKSB7XG4gIHRoaXMudmFsdWUgPSAnJztcbiAgdGhpcy5yYW5rID0gMDtcbiAgdGhpcy5jaGlsZHJlbiA9IHt9O1xufVxuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZ2V0Q2hpbGRyZW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNoaWxkcmVuID0gT2JqZWN0XG4gICAgLmtleXModGhpcy5jaGlsZHJlbilcbiAgICAubWFwKChrZXkpID0+IHRoaXMuY2hpbGRyZW5ba2V5XSk7XG5cbiAgcmV0dXJuIGNoaWxkcmVuLnJlZHVjZSgocCwgbikgPT4gcC5jb25jYXQobi5nZXRDaGlsZHJlbigpKSwgY2hpbGRyZW4pO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmNvbGxlY3QgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIGNvbGxlY3Rpb24gPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmZpbmQoa2V5KTtcbiAgaWYgKG5vZGUpIHtcbiAgICBjb2xsZWN0aW9uID0gbm9kZVxuICAgICAgLmdldENoaWxkcmVuKClcbiAgICAgIC5maWx0ZXIoKG5vZGUpID0+IG5vZGUudmFsdWUpXG4gICAgICAuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICB2YXIgcmVzID0gYi5yYW5rIC0gYS5yYW5rO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBiLnZhbHVlLmxlbmd0aCAtIGEudmFsdWUubGVuZ3RoO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBhLnZhbHVlID4gYi52YWx1ZTtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pO1xuXG4gICAgaWYgKG5vZGUudmFsdWUpIGNvbGxlY3Rpb24ucHVzaChub2RlKTtcbiAgfVxuICByZXR1cm4gY29sbGVjdGlvbjtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgZm9yICh2YXIgY2hhciBpbiBrZXkpIHtcbiAgICBpZiAoa2V5W2NoYXJdIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW2tleVtjaGFyXV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5vZGU7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICB2YXIgaSA9IDA7XG4gIHZhciBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgaWYgKHNbaV0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bc1tpXV07XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIG5vZGUgPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gfHwgbmV3IFByZWZpeFRyZWVOb2RlO1xuICAgIGkrKztcbiAgfVxuXG4gIG5vZGUudmFsdWUgPSBzO1xuICBub2RlLnJhbmsrKztcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmQ7XG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgdGhpcy5pbnNlcnQod29yZFswXSk7XG4gIH1cbn07XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgVHlwZSA9IFRva2Vucy5UeXBlO1xuXG52YXIgQmVnaW4gPSAvW1xcLydcImBdL2c7XG5cbnZhciBNYXRjaCA9IHtcbiAgJ3NpbmdsZSBjb21tZW50JzogWycvLycsJ1xcbiddLFxuICAnZG91YmxlIGNvbW1lbnQnOiBbJy8qJywnKi8nXSxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IFsnYCcsJ2AnXSxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBbXCInXCIsXCInXCJdLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFsnXCInLCdcIiddLFxuICAncmVnZXhwJzogWycvJywnLyddLFxufTtcblxudmFyIFNraXAgPSB7XG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdzaW5nbGUgY29tbWVudCc6IGZhbHNlLFxuICAnZG91YmxlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ3JlZ2V4cCc6IFwiXFxcXFwiLFxufTtcblxudmFyIFRva2VuID0ge307XG5mb3IgKHZhciBrZXkgaW4gTWF0Y2gpIHtcbiAgdmFyIE0gPSBNYXRjaFtrZXldO1xuICBUb2tlbltNWzBdXSA9IGtleTtcbn1cblxudmFyIExlbmd0aCA9IHtcbiAgJ29wZW4gY29tbWVudCc6IDIsXG4gICdjbG9zZSBjb21tZW50JzogMixcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IDEsXG59O1xuXG52YXIgTm90T3BlbiA9IHtcbiAgJ2Nsb3NlIGNvbW1lbnQnOiB0cnVlXG59O1xuXG52YXIgQ2xvc2VzID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVGFnID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2NvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3N0cmluZycsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRzO1xuXG5mdW5jdGlvbiBTZWdtZW50cyhidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG4gIHRoaXMuY2FjaGUgPSB7fTtcbiAgdGhpcy5yZXNldCgpO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0KSB7XG4gICAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLm9mZnNldCA8IG9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZS5zcGxpY2Uocy5pbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZSA9IFtdO1xuICB9XG4gIHRoaXMuY2FjaGUub2Zmc2V0ID0ge307XG4gIHRoaXMuY2FjaGUucmFuZ2UgPSB7fTtcbiAgdGhpcy5jYWNoZS5wb2ludCA9IHt9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXJDYWNoZSgpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHkpIHtcbiAgaWYgKHkgaW4gdGhpcy5jYWNoZS5wb2ludCkge1xuICAgIHJldHVybiB0aGlzLmNhY2hlLnBvaW50W3ldO1xuICB9XG5cbiAgdmFyIHNlZ21lbnRzID0gdGhpcy5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ3NlZ21lbnRzJyk7XG4gIHZhciBvcGVuID0gZmFsc2U7XG4gIHZhciBzdGF0ZSA9IG51bGw7XG4gIHZhciB3YWl0Rm9yID0gJyc7XG4gIHZhciBwb2ludCA9IHsgeDotMSwgeTotMSB9O1xuICB2YXIgY2xvc2UgPSAwO1xuICB2YXIgb2Zmc2V0O1xuICB2YXIgc2VnbWVudDtcbiAgdmFyIHJhbmdlO1xuICB2YXIgdGV4dDtcbiAgdmFyIHZhbGlkO1xuICB2YXIgbGFzdDtcblxuICB2YXIgbGFzdENhY2hlU3RhdGVPZmZzZXQgPSAwO1xuXG4gIHZhciBpID0gMDtcblxuICB2YXIgY2FjaGVTdGF0ZSA9IHRoaXMuZ2V0Q2FjaGVTdGF0ZSh5KTtcbiAgaWYgKGNhY2hlU3RhdGUgJiYgY2FjaGVTdGF0ZS5pdGVtKSB7XG4gICAgb3BlbiA9IHRydWU7XG4gICAgc3RhdGUgPSBjYWNoZVN0YXRlLml0ZW07XG4gICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICBpID0gc3RhdGUuaW5kZXggKyAxO1xuICB9XG5cbiAgZm9yICg7IGkgPCBzZWdtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIG9mZnNldCA9IHNlZ21lbnRzLmdldChpKTtcbiAgICBzZWdtZW50ID0ge1xuICAgICAgb2Zmc2V0OiBvZmZzZXQsXG4gICAgICB0eXBlOiBUeXBlW3RoaXMuYnVmZmVyLmNoYXJBdChvZmZzZXQpXVxuICAgIH07XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIGNsb3NlIHRva2VuXG4gICAgaWYgKG9wZW4pIHtcbiAgICAgIGlmICh3YWl0Rm9yID09PSBzZWdtZW50LnR5cGUpIHtcbiAgICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNlYXJjaGluZyBmb3Igb3BlbiB0b2tlblxuICAgIGVsc2Uge1xuICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgIH1cblxuICAgICAgcmFuZ2UgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKHBvaW50LnkpLm9mZnNldFJhbmdlO1xuXG4gICAgICBpZiAobGFzdCAmJiBsYXN0LnBvaW50LnkgPT09IHBvaW50LnkpIHtcbiAgICAgICAgY2xvc2UgPSBsYXN0LnBvaW50LnggKyBMZW5ndGhbbGFzdC50eXBlXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNsb3NlID0gMDtcbiAgICAgIH1cblxuICAgICAgdmFsaWQgPSB0aGlzLmlzVmFsaWRSYW5nZShbcmFuZ2VbMF0sIHJhbmdlWzFdKzFdLCBzZWdtZW50LCBjbG9zZSk7XG5cbiAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICBpZiAoTm90T3BlbltzZWdtZW50LnR5cGVdKSBjb250aW51ZTtcbiAgICAgICAgb3BlbiA9IHRydWU7XG4gICAgICAgIHN0YXRlID0gc2VnbWVudDtcbiAgICAgICAgc3RhdGUuaW5kZXggPSBpO1xuICAgICAgICBzdGF0ZS5wb2ludCA9IHBvaW50O1xuICAgICAgICAvLyBzdGF0ZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5vZmZzZXQgfTtcbiAgICAgICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICAgICAgaWYgKCF0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCB8fCB0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAmJiBzdGF0ZS5vZmZzZXQgPiB0aGlzLmNhY2hlLnN0YXRlW3RoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIC0gMV0ub2Zmc2V0KSB7XG4gICAgICAgICAgdGhpcy5jYWNoZS5zdGF0ZS5wdXNoKHN0YXRlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhdGUgJiYgc3RhdGUucG9pbnQueSA8IHkpIHtcbiAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICB9XG5cbiAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG59O1xuXG4vL1RPRE86IGNhY2hlIGluIEJ1ZmZlclxuU2VnbWVudHMucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQgaW4gdGhpcy5jYWNoZS5vZmZzZXQpIHJldHVybiB0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdO1xuICByZXR1cm4gKHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF0gPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgc2VnbWVudCwgY2xvc2UpIHtcbiAgdmFyIGtleSA9IHJhbmdlLmpvaW4oKTtcbiAgaWYgKGtleSBpbiB0aGlzLmNhY2hlLnJhbmdlKSByZXR1cm4gdGhpcy5jYWNoZS5yYW5nZVtrZXldO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFJhbmdlVGV4dChyYW5nZSk7XG4gIHZhciB2YWxpZCA9IHRoaXMuaXNWYWxpZCh0ZXh0LCBzZWdtZW50Lm9mZnNldCAtIHJhbmdlWzBdLCBjbG9zZSk7XG4gIHJldHVybiAodGhpcy5jYWNoZS5yYW5nZVtrZXldID0gdmFsaWQpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWQgPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQsIGxhc3RJbmRleCkge1xuICBCZWdpbi5sYXN0SW5kZXggPSBsYXN0SW5kZXg7XG5cbiAgdmFyIG1hdGNoID0gQmVnaW4uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuXG4gIHZhciBpID0gbWF0Y2guaW5kZXg7XG5cbiAgdmFyIGxhc3QgPSBpO1xuXG4gIHZhciB2YWxpZCA9IHRydWU7XG5cbiAgb3V0ZXI6XG4gIGZvciAoOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBvbmUgPSB0ZXh0W2ldO1xuICAgIHZhciBuZXh0ID0gdGV4dFtpICsgMV07XG4gICAgdmFyIHR3byA9IG9uZSArIG5leHQ7XG4gICAgaWYgKGkgPT09IG9mZnNldCkgcmV0dXJuIHRydWU7XG5cbiAgICB2YXIgbyA9IFRva2VuW3R3b107XG4gICAgaWYgKCFvKSBvID0gVG9rZW5bb25lXTtcbiAgICBpZiAoIW8pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHZhciB3YWl0Rm9yID0gTWF0Y2hbb11bMV07XG5cbiAgICBsYXN0ID0gaTtcblxuICAgIHN3aXRjaCAod2FpdEZvci5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSBvbmUpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAxO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG5cbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuICAgICAgICAgIHR3byA9IHRleHRbaV0gKyB0ZXh0W2kgKyAxXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSB0d28pIHtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAyO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0Q2FjaGVTdGF0ZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLnBvaW50LnkgPCB5KTtcbiAgaWYgKHMuaXRlbSAmJiB5IC0gMSA8IHMuaXRlbS5wb2ludC55KSByZXR1cm4gbnVsbDtcbiAgZWxzZSByZXR1cm4gcztcbiAgLy8gcmV0dXJuIHM7XG59O1xuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplIHx8IDUwMDA7XG59XG5cblNraXBTdHJpbmcucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLmhlYWQud2lkdGhbdGhpcy5sZXZlbHMgLSAxXTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIC8vIGdyZWF0IGhhY2sgdG8gZG8gb2Zmc2V0ID49IGZvciAuc2VhcmNoKClcbiAgLy8gd2UgZG9uJ3QgaGF2ZSBmcmFjdGlvbnMgYW55d2F5IHNvLi5cbiAgcmV0dXJuIHRoaXMuc2VhcmNoKG9mZnNldCwgdHJ1ZSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaW5zZXJ0Q2h1bmtlZCgwLCB0ZXh0KTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKG9mZnNldCwgaW5jbCkge1xuICBpbmNsID0gaW5jbCA/IC4xIDogMDtcblxuICAvLyBwcmVwYXJlIHRvIGhvbGQgc3RlcHNcbiAgdmFyIHN0ZXBzID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcbiAgdmFyIHdpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcblxuICAvLyBpdGVyYXRlIGxldmVscyBkb3duLCBza2lwcGluZyB0b3BcbiAgdmFyIGkgPSB0aGlzLmxldmVscztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHdoaWxlIChvZmZzZXQgKyBpbmNsID4gbm9kZS53aWR0aFtpXSAmJiBudWxsICE9IG5vZGUubmV4dFtpXSkge1xuICAgICAgb2Zmc2V0IC09IG5vZGUud2lkdGhbaV07XG4gICAgICBub2RlID0gbm9kZS5uZXh0W2ldO1xuICAgIH1cbiAgICBzdGVwc1tpXSA9IG5vZGU7XG4gICAgd2lkdGhbaV0gPSBvZmZzZXQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG5vZGU6IG5vZGUsXG4gICAgc3RlcHM6IHN0ZXBzLFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBvZmZzZXQ6IG9mZnNldFxuICB9O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3BsaWNlID0gZnVuY3Rpb24ocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwczsgLy8gc2tpcCBzdGVwcyBsZWZ0IG9mIHRoZSBvZmZzZXRcbiAgdmFyIHdpZHRoID0gcy53aWR0aDtcblxuICB2YXIgcDsgLy8gbGVmdCBub2RlIG9yIGBwYFxuICB2YXIgcTsgLy8gcmlnaHQgbm9kZSBvciBgcWAgKG91ciBuZXcgbm9kZSlcbiAgdmFyIGxlbjtcblxuICAvLyBjcmVhdGUgbmV3IG5vZGVcbiAgbGV2ZWwgPSBsZXZlbCB8fCB0aGlzLnJhbmRvbUxldmVsKCk7XG4gIHEgPSBuZXcgTm9kZSh2YWx1ZSwgbGV2ZWwpO1xuICBsZW5ndGggPSBxLndpZHRoWzBdO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgbGV2ZWxzIGJlbG93IG5ldyBub2RlIGxldmVsXG4gIGkgPSBsZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsIHN0ZXBcbiAgICBxLm5leHRbaV0gPSBwLm5leHRbaV07IC8vIGluc2VydCBzbyBpbmhlcml0IGxlZnQncyBuZXh0XG4gICAgcC5uZXh0W2ldID0gcTsgLy8gbGVmdCdzIG5leHQgaXMgbm93IG91ciBuZXcgbm9kZVxuICAgIHEud2lkdGhbaV0gPSBwLndpZHRoW2ldIC0gd2lkdGhbaV0gKyBsZW5ndGg7XG4gICAgcC53aWR0aFtpXSA9IHdpZHRoW2ldO1xuICB9XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBhbGwgbGV2ZWxzIGRvd24gdW50aWwgZXhjZXB0IG5ldyBub2RlIGxldmVsXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IGxldmVsKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWxcbiAgICBwLndpZHRoW2ldICs9IGxlbmd0aDsgLy8gYWRkIG5ldyBub2RlIHdpZHRoXG4gIH1cblxuICAvLyByZXR1cm4gbmV3IG5vZGVcbiAgcmV0dXJuIHE7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgcyA9IHRoaXMuc2VhcmNoKG9mZnNldCk7XG5cbiAgLy8gaWYgc2VhcmNoIGZhbGxzIGluIHRoZSBtaWRkbGUgb2YgYSBzdHJpbmdcbiAgLy8gaW5zZXJ0IGl0IHRoZXJlIGluc3RlYWQgb2YgY3JlYXRpbmcgYSBuZXcgbm9kZVxuICBpZiAocy5vZmZzZXQgJiYgcy5ub2RlLnZhbHVlICYmIHMub2Zmc2V0IDwgcy5ub2RlLnZhbHVlLmxlbmd0aCkge1xuICAgIHRoaXMudXBkYXRlKHMsIGluc2VydChzLm9mZnNldCwgcy5ub2RlLnZhbHVlLCB2YWx1ZSkpO1xuICAgIHJldHVybiBzLm5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5zcGxpY2Uocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgLy8gdmFsdWVzIGxlbmd0aCBkaWZmZXJlbmNlXG4gIHZhciBsZW5ndGggPSBzLm5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIC8vIHVwZGF0ZSB2YWx1ZVxuICBzLm5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBmaXggd2lkdGhzIG9uIGFsbCBsZXZlbHNcbiAgaSA9IHRoaXMubGV2ZWxzO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBzLnN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihyYW5nZSkge1xuICBpZiAocmFuZ2VbMV0gPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdyYW5nZSBlbmQgb3ZlciBtYXhpbXVtIGxlbmd0aCgnICtcbiAgICAgIHRoaXMubGVuZ3RoICsgJyk6IFsnICsgcmFuZ2Uuam9pbigpICsgJ10nXG4gICAgKTtcbiAgfVxuXG4gIC8vIHJlbWFpbiBkaXN0YW5jZSB0byByZW1vdmVcbiAgdmFyIHggPSByYW5nZVsxXSAtIHJhbmdlWzBdO1xuXG4gIC8vIHNlYXJjaCBmb3Igbm9kZSBvbiBsZWZ0IGVkZ2VcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChyYW5nZVswXSk7XG4gIHZhciBvZmZzZXQgPSBzLm9mZnNldDtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwcztcbiAgdmFyIG5vZGUgPSBzLm5vZGU7XG5cbiAgLy8gc2tpcCBoZWFkXG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgLy8gc2xpY2UgbGVmdCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAob2Zmc2V0KSB7XG4gICAgaWYgKG9mZnNldCA8IG5vZGUud2lkdGhbMF0pIHtcbiAgICAgIHggLT0gdGhpcy51cGRhdGUocyxcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZSgwLCBvZmZzZXQpICtcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZShcbiAgICAgICAgICBvZmZzZXQgK1xuICAgICAgICAgIE1hdGgubWluKHgsIG5vZGUubGVuZ3RoIC0gb2Zmc2V0KVxuICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgICBpZiAoIW5vZGUpIHJldHVybjtcbiAgfVxuXG4gIC8vIHJlbW92ZSBhbGwgZnVsbCBub2RlcyBpbiByYW5nZVxuICB3aGlsZSAobm9kZSAmJiB4ID49IG5vZGUud2lkdGhbMF0pIHtcbiAgICB4IC09IHRoaXMucmVtb3ZlTm9kZShzdGVwcywgbm9kZSk7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuXG4gIC8vIHNsaWNlIHJpZ2h0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmICh4KSB7XG4gICAgdGhpcy5yZXBsYWNlKHN0ZXBzLCBub2RlLCBub2RlLnZhbHVlLnNsaWNlKHgpKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlTm9kZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLndpZHRoWzBdO1xuXG4gIHZhciBpO1xuXG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoIC0gbm9kZS53aWR0aFtpXTtcbiAgICBzdGVwc1tpXS5uZXh0W2ldID0gbm9kZS5uZXh0W2ldO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZXBsYWNlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUsIHZhbHVlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICBub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgdmFyIGk7XG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgbm9kZS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gdGhpcy5yZW1vdmUoW29mZnNldCwgb2Zmc2V0KzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydENodW5rZWQgPSBmdW5jdGlvbihvZmZzZXQsIHRleHQpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0ZXh0Lmxlbmd0aDsgaSArPSB0aGlzLmNodW5rU2l6ZSkge1xuICAgIHZhciBjaHVuayA9IHRleHQuc3Vic3RyKGksIHRoaXMuY2h1bmtTaXplKTtcbiAgICB0aGlzLmluc2VydChpICsgb2Zmc2V0LCBjaHVuayk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnN1YnN0cmluZyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgdmFyIGxlbmd0aCA9IGIgLSBhO1xuXG4gIHZhciBzZWFyY2ggPSB0aGlzLnNlYXJjaChhLCB0cnVlKTtcbiAgdmFyIG5vZGUgPSBzZWFyY2gubm9kZTtcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgdmFyIGQgPSBsZW5ndGggKyBzZWFyY2gub2Zmc2V0O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAobm9kZSAmJiBkID49IDApIHtcbiAgICBkIC09IG5vZGUud2lkdGhbMF07XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cbiAgaWYgKG5vZGUpIHtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gIH1cblxuICByZXR1cm4gcy5zdWJzdHIoc2VhcmNoLm9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJhbmRvbUxldmVsID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsZXZlbCA9IDE7XG4gIHdoaWxlIChsZXZlbCA8IHRoaXMubGV2ZWxzIC0gMSAmJiBNYXRoLnJhbmRvbSgpIDwgdGhpcy5iaWFzKSBsZXZlbCsrO1xuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJhbmdlID0gcmFuZ2UgfHwgW107XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZyhyYW5nZVswXSwgcmFuZ2VbMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29weSA9IG5ldyBTa2lwU3RyaW5nO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgdmFyIG9mZnNldCA9IDA7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgY29weS5pbnNlcnQob2Zmc2V0LCBub2RlLnZhbHVlKTtcbiAgICBvZmZzZXQgKz0gbm9kZS53aWR0aFswXTtcbiAgfVxuICByZXR1cm4gY29weTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmpvaW5TdHJpbmcgPSBmdW5jdGlvbihkZWxpbWl0ZXIpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIHBhcnRzLnB1c2gobm9kZS52YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzLmpvaW4oZGVsaW1pdGVyKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZygwLCB0aGlzLmxlbmd0aCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIFIgPSBSZWdleHAuY3JlYXRlO1xuXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcbnZhciBzeW50YXggPSBtYXAoe1xuICAndCc6IFIoWydvcGVyYXRvciddLCAnZycsIGVudGl0aWVzKSxcbiAgJ20nOiBSKFsncGFyYW1zJ10sICAgJ2cnKSxcbiAgJ2QnOiBSKFsnZGVjbGFyZSddLCAgJ2cnKSxcbiAgJ2YnOiBSKFsnZnVuY3Rpb24nXSwgJ2cnKSxcbiAgJ2snOiBSKFsna2V5d29yZCddLCAgJ2cnKSxcbiAgJ24nOiBSKFsnYnVpbHRpbiddLCAgJ2cnKSxcbiAgJ2wnOiBSKFsnc3ltYm9sJ10sICAgJ2cnKSxcbiAgJ3MnOiBSKFsndGVtcGxhdGUgc3RyaW5nJ10sICdnJyksXG4gICdlJzogUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0ge1xuICByZWdleHA6IFIoWydpbmRlbnQnXSwgJ2dtJyksXG4gIHJlcGxhY2VyOiAocykgPT4gcy5yZXBsYWNlKC8gezEsMn18XFx0L2csICc8eD4kJjwveD4nKVxufTtcblxudmFyIEFueUNoYXIgPSAvXFxTL2c7XG5cbnZhciBCbG9ja3MgPSBSKFsnY29tbWVudCcsJ3N0cmluZycsJ3JlZ2V4cCddLCAnZ20nKTtcblxudmFyIExvbmdMaW5lcyA9IC8oXi57MTAwMCx9KS9nbTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2MnLFxuICAnLyonOiAnYycsXG4gICdgJzogJ3MnLFxuICAnXCInOiAncycsXG4gIFwiJ1wiOiAncycsXG4gICcvJzogJ3InLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW50YXg7XG5cbmZ1bmN0aW9uIFN5bnRheChvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLnRhYiA9IG8udGFiIHx8ICdcXHQnO1xuICB0aGlzLmJsb2NrcyA9IFtdO1xufVxuXG5TeW50YXgucHJvdG90eXBlLmVudGl0aWVzID0gZW50aXRpZXM7XG5cblN5bnRheC5wcm90b3R5cGUuaGlnaGxpZ2h0ID0gZnVuY3Rpb24oY29kZSwgb2Zmc2V0KSB7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUluZGVudHMoY29kZSk7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGVudGl0aWVzKGNvZGUpO1xuXG4gIGZvciAodmFyIGtleSBpbiBzeW50YXgpIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHN5bnRheFtrZXldLnJlZ2V4cCwgc3ludGF4W2tleV0ucmVwbGFjZXIpO1xuICB9XG5cbiAgY29kZSA9IHRoaXMucmVzdG9yZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGNvZGUucmVwbGFjZShJbmRlbnQucmVnZXhwLCBJbmRlbnQucmVwbGFjZXIpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVJbmRlbnRzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XG4gIHZhciBpbmRlbnQgPSAwO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBsaW5lO1xuICB2YXIgaTtcblxuICBpID0gbGluZXMubGVuZ3RoO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGxpbmUpO1xuICAgIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gICAgZWxzZSBpZiAoaW5kZW50ICYmICFsaW5lLmxlbmd0aCkge1xuICAgICAgbGluZXNbaV0gPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnRhYik7XG4gICAgfVxuICB9XG5cbiAgY29kZSA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5yZXN0b3JlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgYmxvY2s7XG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcbiAgdmFyIG4gPSAwO1xuICByZXR1cm4gY29kZVxuICAgIC5yZXBsYWNlKC9cXHVmZmVjL2csIGZ1bmN0aW9uKCkge1xuICAgICAgYmxvY2sgPSBibG9ja3NbbisrXTtcbiAgICAgIHJldHVybiBlbnRpdGllcyhibG9jay5zbGljZSgwLCAxMDAwKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknKTtcbiAgICB9KVxuICAgIC5yZXBsYWNlKC9cXHVmZmViL2csIGZ1bmN0aW9uKCkge1xuICAgICAgYmxvY2sgPSBibG9ja3NbbisrXTtcbiAgICAgIHZhciB0YWcgPSBpZGVudGlmeShibG9jayk7XG4gICAgICByZXR1cm4gJzwnK3RhZysnPicrZW50aXRpZXMoYmxvY2spKyc8LycrdGFnKyc+JztcbiAgICB9KTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB0aGlzLmJsb2NrcyA9IFtdO1xuXG4gIGNvZGUgPSBjb2RlXG4gICAgLnJlcGxhY2UoTG9uZ0xpbmVzLCAoYmxvY2spID0+IHtcbiAgICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgcmV0dXJuICdcXHVmZmVjJztcbiAgICB9KVxuICAgIC5yZXBsYWNlKEJsb2NrcywgKGJsb2NrKSA9PiB7XG4gICAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgIHJldHVybiAnXFx1ZmZlYic7XG4gICAgfSk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVJZCgpIHtcbiAgdmFyIGFscGhhYmV0ID0gJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6JztcbiAgdmFyIGxlbmd0aCA9IGFscGhhYmV0Lmxlbmd0aCAtIDE7XG4gIHZhciBpID0gNjtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKGktLSkge1xuICAgIHMgKz0gYWxwaGFiZXRbTWF0aC5yYW5kb20oKSAqIGxlbmd0aCB8IDBdO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBlbnRpdGllcyh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIDtcbn1cblxuZnVuY3Rpb24gY29tcGlsZShyZWdleHAsIHRhZykge1xuICB2YXIgb3BlblRhZyA9ICc8JyArIHRhZyArICc+JztcbiAgdmFyIGNsb3NlVGFnID0gJzwvJyArIHRhZyArICc+JztcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiB0YWcsXG4gICAgcmVnZXhwOiByZWdleHAsXG4gICAgcmVwbGFjZXI6IG9wZW5UYWcgKyAnJCYnICsgY2xvc2VUYWdcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFwKG9iaiwgZm4pIHtcbiAgdmFyIHJlc3VsdCA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgcmVzdWx0W2tleV0gPSBmbihvYmpba2V5XSwga2V5KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiByZXBsYWNlKHBhc3MsIGNvZGUpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXNzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShwYXNzW2ldWzBdLCBwYXNzW2ldWzFdKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cblxuZnVuY3Rpb24gaWRlbnRpZnkoYmxvY2spIHtcbiAgdmFyIG9uZSA9IGJsb2NrWzBdO1xuICB2YXIgdHdvID0gb25lICsgYmxvY2tbMV07XG4gIHJldHVybiBUYWdbdHdvXSB8fCBUYWdbb25lXTtcbn1cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFBhcnRzID0gcmVxdWlyZSgnLi9wYXJ0cycpO1xuXG52YXIgVHlwZSA9IHtcbiAgJ1xcbic6ICdsaW5lcycsXG4gICd7JzogJ29wZW4gY3VybHknLFxuICAnfSc6ICdjbG9zZSBjdXJseScsXG4gICdbJzogJ29wZW4gc3F1YXJlJyxcbiAgJ10nOiAnY2xvc2Ugc3F1YXJlJyxcbiAgJygnOiAnb3BlbiBwYXJlbnMnLFxuICAnKSc6ICdjbG9zZSBwYXJlbnMnLFxuICAnLyc6ICdvcGVuIGNvbW1lbnQnLFxuICAnKic6ICdjbG9zZSBjb21tZW50JyxcbiAgJ2AnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUT0tFTiA9IC9cXG58XFwvXFwqfFxcKlxcL3xgfFxce3xcXH18XFxbfFxcXXxcXCh8XFwpL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gVG9rZW5zO1xuXG5Ub2tlbnMuVHlwZSA9IFR5cGU7XG5cbmZ1bmN0aW9uIFRva2VucyhmYWN0b3J5KSB7XG4gIGZhY3RvcnkgPSBmYWN0b3J5IHx8IGZ1bmN0aW9uKCkgeyByZXR1cm4gbmV3IFBhcnRzOyB9O1xuXG4gIHRoaXMuZmFjdG9yeSA9IGZhY3Rvcnk7XG5cbiAgdmFyIHQgPSB0aGlzLnRva2VucyA9IHtcbiAgICBsaW5lczogZmFjdG9yeSgpLFxuICAgIGJsb2NrczogZmFjdG9yeSgpLFxuICAgIHNlZ21lbnRzOiBmYWN0b3J5KCksXG4gIH07XG5cbiAgdGhpcy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xufVxuXG5Ub2tlbnMucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVG9rZW5zLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfHwgMDtcblxuICB2YXIgdG9rZW5zID0gdGhpcy50b2tlbnM7XG4gIHZhciBtYXRjaDtcbiAgdmFyIHR5cGU7XG4gIHZhciBjb2xsZWN0aW9uO1xuXG4gIHdoaWxlIChtYXRjaCA9IFRPS0VOLmV4ZWModGV4dCkpIHtcbiAgICBjb2xsZWN0aW9uID0gdGhpcy5jb2xsZWN0aW9uW3RleHRbbWF0Y2guaW5kZXhdXTtcbiAgICBjb2xsZWN0aW9uLnB1c2gobWF0Y2guaW5kZXggKyBvZmZzZXQpO1xuICB9XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHJhbmdlLCB0ZXh0LCBzaGlmdCkge1xuICB2YXIgaW5zZXJ0ID0gbmV3IFRva2VucyhBcnJheSk7XG4gIGluc2VydC5pbmRleCh0ZXh0LCByYW5nZVswXSk7XG5cbiAgdmFyIGxlbmd0aHMgPSB7fTtcbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIGxlbmd0aHNbdHlwZV0gPSB0aGlzLnRva2Vuc1t0eXBlXS5sZW5ndGg7XG4gIH1cblxuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uc2hpZnRPZmZzZXQocmFuZ2VbMF0sIHNoaWZ0KTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5yZW1vdmVSYW5nZShyYW5nZSk7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uaW5zZXJ0KHJhbmdlWzBdLCBpbnNlcnQudG9rZW5zW3R5cGVdKTtcbiAgfVxuXG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICBpZiAodGhpcy50b2tlbnNbdHlwZV0ubGVuZ3RoICE9PSBsZW5ndGhzW3R5cGVdKSB7XG4gICAgICB0aGlzLmVtaXQoYGNoYW5nZSAke3R5cGV9YCk7XG4gICAgfVxuICB9XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5SW5kZXggPSBmdW5jdGlvbih0eXBlLCBpbmRleCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZ2V0KGluZGV4KTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0Q29sbGVjdGlvbiA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeU9mZnNldCA9IGZ1bmN0aW9uKHR5cGUsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZmluZChvZmZzZXQpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciB0b2tlbnMgPSBuZXcgVG9rZW5zKHRoaXMuZmFjdG9yeSk7XG4gIHZhciB0ID0gdG9rZW5zLnRva2VucztcbiAgZm9yICh2YXIga2V5IGluIHRoaXMudG9rZW5zKSB7XG4gICAgdFtrZXldID0gdGhpcy50b2tlbnNba2V5XS5zbGljZSgpO1xuICB9XG4gIHRva2Vucy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xuICByZXR1cm4gdG9rZW5zO1xufTtcbiIsInZhciBvcGVuID0gcmVxdWlyZSgnLi4vbGliL29wZW4nKTtcbnZhciBzYXZlID0gcmVxdWlyZSgnLi4vbGliL3NhdmUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJy4vYnVmZmVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmlsZTtcblxuZnVuY3Rpb24gRmlsZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLnJvb3QgPSAnJztcbiAgdGhpcy5wYXRoID0gJ3VudGl0bGVkJztcbiAgdGhpcy5idWZmZXIgPSBuZXcgQnVmZmVyO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5GaWxlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkZpbGUucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJ1ZmZlci5vbigncmF3JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3JhdycpKTtcbiAgdGhpcy5idWZmZXIub24oJ3NldCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdzZXQnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCd1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY2hhbmdlJykpO1xuICB0aGlzLmJ1ZmZlci5vbignYmVmb3JlIHVwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdiZWZvcmUgY2hhbmdlJykpO1xufTtcblxuRmlsZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMucGF0aCA9IHBhdGg7XG4gIHRoaXMucm9vdCA9IHJvb3Q7XG4gIG9wZW4ocm9vdCArIHBhdGgsIChlcnIsIHRleHQpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIGZuICYmIGZuKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG4gICAgdGhpcy5lbWl0KCdvcGVuJyk7XG4gICAgZm4gJiYgZm4obnVsbCwgdGhpcyk7XG4gIH0pO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHNhdmUodGhpcy5yb290ICsgdGhpcy5wYXRoLCB0aGlzLmJ1ZmZlci50b1N0cmluZygpLCBmbiB8fCBub29wKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vbGliL2RlYm91bmNlJyk7XG5cbi8qXG4gICAuIC5cbi0xIDAgMSAyIDMgNCA1XG4gICBuXG5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEhpc3Rvcnk7XG5cbmZ1bmN0aW9uIEhpc3RvcnkoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLm5lZWRsZSA9IDA7XG4gIHRoaXMudGltZW91dCA9IHRydWU7XG4gIHRoaXMudGltZVN0YXJ0ID0gMDtcbiAgdGhpcy5kZWJvdW5jZWRTYXZlID0gZGVib3VuY2UodGhpcy5hY3R1YWxseVNhdmUuYmluZCh0aGlzKSwgNzAwKVxufVxuXG5IaXN0b3J5LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmb3JjZSkge1xuICBpZiAoRGF0ZS5ub3coKSAtIHRoaXMudGltZVN0YXJ0ID4gMjAwMCB8fCBmb3JjZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcbiAgdGhpcy50aW1lb3V0ID0gdGhpcy5kZWJvdW5jZWRTYXZlKCk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5hY3R1YWxseVNhdmUgPSBmdW5jdGlvbigpIHtcbiAgY2xlYXJUaW1lb3V0KHRoaXMudGltZW91dCk7XG4gIGlmICh0aGlzLmVkaXRvci5idWZmZXIubG9nLmxlbmd0aCkge1xuICAgIHRoaXMubG9nID0gdGhpcy5sb2cuc2xpY2UoMCwgKyt0aGlzLm5lZWRsZSk7XG4gICAgdGhpcy5sb2cucHVzaCh0aGlzLmNvbW1pdCgpKTtcbiAgICB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aDtcbiAgICB0aGlzLnNhdmVNZXRhKCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5zYXZlTWV0YSgpO1xuICB9XG4gIHRoaXMudGltZVN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgdGhpcy50aW1lb3V0ID0gZmFsc2U7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS51bmRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcbiAgaWYgKHRoaXMubmVlZGxlIDwgMCkgcmV0dXJuO1xuXG4gIHRoaXMuY2hlY2tvdXQoJ3VuZG8nLCB0aGlzLm5lZWRsZS0tKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnJlZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID09PSB0aGlzLmxvZy5sZW5ndGggLSAxKSByZXR1cm47XG5cbiAgdGhpcy5jaGVja291dCgncmVkbycsICsrdGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY2hlY2tvdXQgPSBmdW5jdGlvbih0eXBlLCBuKSB7XG4gIHZhciBjb21taXQgPSB0aGlzLmxvZ1tuXTtcbiAgaWYgKCFjb21taXQpIHJldHVybjtcblxuICB2YXIgbG9nID0gY29tbWl0LmxvZztcblxuICBjb21taXQgPSB0aGlzLmxvZ1tuXVt0eXBlXTtcbiAgdGhpcy5lZGl0b3IubWFyay5hY3RpdmUgPSBjb21taXQubWFya0FjdGl2ZTtcbiAgdGhpcy5lZGl0b3IubWFyay5zZXQoY29tbWl0Lm1hcmsuY29weSgpKTtcbiAgdGhpcy5lZGl0b3Iuc2V0Q2FyZXQoY29tbWl0LmNhcmV0LmNvcHkoKSk7XG5cbiAgbG9nID0gJ3VuZG8nID09PSB0eXBlXG4gICAgPyBsb2cuc2xpY2UoKS5yZXZlcnNlKClcbiAgICA6IGxvZy5zbGljZSgpO1xuXG4gIGxvZy5mb3JFYWNoKGl0ZW0gPT4ge1xuICAgIHZhciBhY3Rpb24gPSBpdGVtWzBdO1xuICAgIHZhciBvZmZzZXRSYW5nZSA9IGl0ZW1bMV07XG4gICAgdmFyIHRleHQgPSBpdGVtWzJdO1xuICAgIHN3aXRjaCAoYWN0aW9uKSB7XG4gICAgICBjYXNlICdpbnNlcnQnOlxuICAgICAgICBpZiAoJ3VuZG8nID09PSB0eXBlKSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldFJhbmdlLCB0cnVlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIuaW5zZXJ0KHRoaXMuZWRpdG9yLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXRSYW5nZVswXSksIHRleHQsIHRydWUpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAncmVtb3ZlJzpcbiAgICAgICAgaWYgKCd1bmRvJyA9PT0gdHlwZSkge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5pbnNlcnQodGhpcy5lZGl0b3IuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldFJhbmdlWzBdKSwgdGV4dCwgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldFJhbmdlLCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jb21taXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxvZyA9IHRoaXMuZWRpdG9yLmJ1ZmZlci5sb2c7XG4gIHRoaXMuZWRpdG9yLmJ1ZmZlci5sb2cgPSBbXTtcbiAgcmV0dXJuIHtcbiAgICBsb2c6IGxvZyxcbiAgICB1bmRvOiB0aGlzLm1ldGEsXG4gICAgcmVkbzoge1xuICAgICAgY2FyZXQ6IHRoaXMuZWRpdG9yLmNhcmV0LmNvcHkoKSxcbiAgICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgICB9XG4gIH07XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5zYXZlTWV0YSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1ldGEgPSB7XG4gICAgY2FyZXQ6IHRoaXMuZWRpdG9yLmNhcmV0LmNvcHkoKSxcbiAgICBtYXJrOiB0aGlzLmVkaXRvci5tYXJrLmNvcHkoKSxcbiAgICBtYXJrQWN0aXZlOiB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZVxuICB9O1xufTtcbiIsInZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xuXG52YXIgUEFHSU5HX1RIUk9UVExFID0gNjU7XG5cbnZhciBrZXlzID0gbW9kdWxlLmV4cG9ydHMgPSB7XG4gICdjdHJsK3onOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkudW5kbygpO1xuICB9LFxuICAnY3RybCt5JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnJlZG8oKTtcbiAgfSxcblxuICAnaG9tZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZSgpO1xuICB9LFxuICAnZW5kJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZSgpO1xuICB9LFxuICAncGFnZXVwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCgpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAncGFnZWRvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrdXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKDYpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCtkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKDYpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xKTtcbiAgfSxcbiAgJ3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEpO1xuICB9LFxuICAncmlnaHQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSk7XG4gIH0sXG4gICdkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEpO1xuICB9LFxuXG4gICdjdHJsK2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xKTtcbiAgfSxcbiAgJ2N0cmwrcmlnaHQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxKTtcbiAgfSxcblxuICAnY3RybCthJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfSxcblxuICAnZW50ZXInOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmluc2VydCgnXFxuJyk7XG4gIH0sXG5cbiAgJ2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgbGluZXMgPSBhcmVhLmVuZC55IC0gYXJlYS5iZWdpbi55O1xuICAgIGlmIChsaW5lcyAmJiBhcmVhLmVuZC54ID4gMCkgYWRkICs9IDE7XG4gICAgaWYgKCFsaW5lcykgYWRkICs9IDE7XG4gICAgbGluZXMgKz0gYWRkO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYS5zZXRMZWZ0KDApLmFkZEJvdHRvbShhZGQpKTtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQoeyB4OiAwLCB5OiBhcmVhLmVuZC55IH0sIHRleHQpO1xuICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMobGluZXMpO1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKGxpbmVzLCB0cnVlKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMicsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKVxuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAoYXJlYS5lbmQueCA9PT0gMCkge1xuICAgICAgYXJlYS5lbmQueSA9IGFyZWEuZW5kLnkgLSAxXG4gICAgICBhcmVhLmVuZC54ID0gdGhpcy5idWZmZXIuZ2V0TGluZShhcmVhLmVuZC55KS5sZW5ndGhcbiAgICB9XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCtkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWEzJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpXG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmIChhcmVhLmVuZC54ID09PSAwKSB7XG4gICAgICBhcmVhLmVuZC55ID0gYXJlYS5lbmQueSAtIDFcbiAgICAgIGFyZWEuZW5kLnggPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKGFyZWEuZW5kLnkpLmxlbmd0aFxuICAgIH1cbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICd0YWInOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5zdWdnZXN0KCk7XG4gICAgaWYgKCFyZXMpIHtcbiAgICAgIHRoaXMuaW5zZXJ0KHRoaXMudGFiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShyZXMuYXJlYSk7XG4gICAgICB0aGlzLmluc2VydChyZXMubm9kZS52YWx1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdjdHJsK2YnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmQub3BlbigpO1xuICB9LFxuXG4gICdmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoKzEpO1xuICB9LFxuICAnc2hpZnQrZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKC0xKTtcbiAgfSxcblxuICAnY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFkZDtcbiAgICB2YXIgYXJlYTtcbiAgICB2YXIgdGV4dDtcblxuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuXG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICBjbGVhciA9IHRydWU7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0aGlzLm1hcmsuYWRkQm90dG9tKGFyZWEuZW5kLnggPiAwKS5zZXRMZWZ0KDApO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KHRoaXMubWFyay5nZXQoKSk7XG4gICAgfVxuXG4gICAgLy9UT0RPOiBzaG91bGQgY2hlY2sgaWYgbGFzdCBsaW5lIGhhcyAvLyBhbHNvXG4gICAgaWYgKHRleHQudHJpbUxlZnQoKS5zdWJzdHIoMCwyKSA9PT0gJy8vJykge1xuICAgICAgYWRkID0gLTM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKC4qPylcXC9cXC8gKC4rKS9nbSwgJyQxJDInKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWRkID0gKzM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKFtcXHNdKikoLispL2dtLCAnJDEvLyAkMicpO1xuICAgIH1cblxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuXG4gICAgdGhpcy5tYXJrLnNldChhcmVhLmFkZFJpZ2h0KGFkZCkpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG5cbiAgICBpZiAoY2FyZXQueCkgY2FyZXQuYWRkUmlnaHQoYWRkKTtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0KTtcblxuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgY2xlYXIgPSB0cnVlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICAgIGlmICh0ZXh0LnNsaWNlKDAsMikgPT09ICcvKicgJiYgdGV4dC5zbGljZSgtMikgPT09ICcqLycpIHtcbiAgICAgIHRleHQgPSB0ZXh0LnNsaWNlKDIsLTIpO1xuICAgICAgYWRkIC09IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgLT0gMjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGV4dCA9ICcvKicgKyB0ZXh0ICsgJyovJztcbiAgICAgIGFkZCArPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkICs9IDI7XG4gICAgfVxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuICAgIGFyZWEuZW5kLnggKz0gYWRkO1xuICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0LmFkZFJpZ2h0KGFkZCkpO1xuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG59O1xuXG5rZXlzLnNpbmdsZSA9IHtcbiAgLy9cbn07XG5cbi8vIHNlbGVjdGlvbiBrZXlzXG5bICdob21lJywnZW5kJyxcbiAgJ3BhZ2V1cCcsJ3BhZ2Vkb3duJyxcbiAgJ2xlZnQnLCd1cCcsJ3JpZ2h0JywnZG93bicsXG4gICdjdHJsK2xlZnQnLCdjdHJsK3JpZ2h0J1xuXS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICBrZXlzWydzaGlmdCsnK2tleV0gPSBmdW5jdGlvbihlKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICBrZXlzW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfTtcbn0pO1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgTW91c2UgPSByZXF1aXJlKCcuL21vdXNlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vdGV4dCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IElucHV0O1xuXG5mdW5jdGlvbiBJbnB1dChlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubW91c2UgPSBuZXcgTW91c2UodGhpcyk7XG4gIHRoaXMudGV4dCA9IG5ldyBUZXh0O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5JbnB1dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5JbnB1dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmx1ciA9IHRoaXMuYmx1ci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnRleHQub24oWydrZXknLCAndGV4dCddLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnaW5wdXQnKSk7XG4gIHRoaXMudGV4dC5vbignZm9jdXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKSk7XG4gIHRoaXMudGV4dC5vbignYmx1cicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJykpO1xuICB0aGlzLnRleHQub24oJ3RleHQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAndGV4dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXlzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleXMnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjdXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY3V0JykpO1xuICB0aGlzLnRleHQub24oJ2NvcHknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY29weScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdwYXN0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdwYXN0ZScpKTtcbiAgdGhpcy5tb3VzZS5vbigndXAnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2V1cCcpKTtcbiAgdGhpcy5tb3VzZS5vbignY2xpY2snLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VjbGljaycpKTtcbiAgdGhpcy5tb3VzZS5vbignZG93bicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRvd24nKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnIGJlZ2luJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZ2JlZ2luJykpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgdGhpcy5tb3VzZS51c2Uobm9kZSk7XG4gIHRoaXMudGV4dC5yZXNldCgpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmJsdXIoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuZm9jdXMoKTtcbn07XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW91c2U7XG5cbmZ1bmN0aW9uIE1vdXNlKCkge1xuICB0aGlzLm5vZGUgPSBudWxsO1xuICB0aGlzLmNsaWNrcyA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbk1vdXNlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdXNlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXNldENsaWNrcyA9IGRlYm91bmNlKHRoaXMucmVzZXRDbGlja3MuYmluZCh0aGlzKSwgMzUwKVxuICB0aGlzLm9ubWF5YmVkcmFnID0gdGhpcy5vbm1heWJlZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZHJhZyA9IHRoaXMub25kcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kb3duID0gdGhpcy5vbmRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbnVwID0gdGhpcy5vbnVwLmJpbmQodGhpcyk7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICBpZiAodGhpcy5ub2RlKSB7XG4gICAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIHRoaXMub25kb3duKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIHRoaXMub25kb3duKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRvd24gPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmRvd24gPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2Rvd24nLCBlKTtcbiAgdGhpcy5vbmNsaWNrKGUpO1xuICB0aGlzLm1heWJlRHJhZygpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9udXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndXAnLCBlKTtcbiAgaWYgKCF0aGlzLmRvd24pIHJldHVybjtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5kcmFnRW5kKCk7XG4gIHRoaXMubWF5YmVEcmFnRW5kKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25jbGljayA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5yZXNldENsaWNrcygpO1xuICB0aGlzLmNsaWNrcyA9ICh0aGlzLmNsaWNrcyAlIDMpICsgMTtcbiAgdGhpcy5lbWl0KCdjbGljaycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9ubWF5YmVkcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcblxuICB2YXIgZCA9XG4gICAgICBNYXRoLmFicyh0aGlzLnBvaW50LnggLSB0aGlzLmRvd24ueClcbiAgICArIE1hdGguYWJzKHRoaXMucG9pbnQueSAtIHRoaXMuZG93bi55KTtcblxuICBpZiAoZCA+IDUpIHtcbiAgICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xuICAgIHRoaXMuZHJhZ0JlZ2luKCk7XG4gIH1cbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2RyYWcnLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBiZWdpbicpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGVuZCcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLnJlc2V0Q2xpY2tzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xpY2tzID0gMDtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xuXG52YXIgVEhST1RUTEUgPSAwIC8vMTAwMC82MjtcblxudmFyIG1hcCA9IHtcbiAgODogJ2JhY2tzcGFjZScsXG4gIDk6ICd0YWInLFxuICAxMzogJ2VudGVyJyxcbiAgMzM6ICdwYWdldXAnLFxuICAzNDogJ3BhZ2Vkb3duJyxcbiAgMzU6ICdlbmQnLFxuICAzNjogJ2hvbWUnLFxuICAzNzogJ2xlZnQnLFxuICAzODogJ3VwJyxcbiAgMzk6ICdyaWdodCcsXG4gIDQwOiAnZG93bicsXG4gIDQ2OiAnZGVsZXRlJyxcbiAgNDg6ICcwJyxcbiAgNDk6ICcxJyxcbiAgNTA6ICcyJyxcbiAgNTE6ICczJyxcbiAgNTI6ICc0JyxcbiAgNTM6ICc1JyxcbiAgNTQ6ICc2JyxcbiAgNTU6ICc3JyxcbiAgNTY6ICc4JyxcbiAgNTc6ICc5JyxcbiAgNjU6ICdhJyxcbiAgNjg6ICdkJyxcbiAgNzA6ICdmJyxcbiAgNzc6ICdtJyxcbiAgNzg6ICduJyxcbiAgODM6ICdzJyxcbiAgODk6ICd5JyxcbiAgOTA6ICd6JyxcbiAgMTEyOiAnZjEnLFxuICAxMTQ6ICdmMycsXG4gIDEyMjogJ2YxMScsXG4gIDE4ODogJywnLFxuICAxOTA6ICcuJyxcbiAgMTkxOiAnLycsXG5cbiAgLy8gbnVtcGFkXG4gIDk3OiAnZW5kJyxcbiAgOTg6ICdkb3duJyxcbiAgOTk6ICdwYWdlZG93bicsXG4gIDEwMDogJ2xlZnQnLFxuICAxMDI6ICdyaWdodCcsXG4gIDEwMzogJ2hvbWUnLFxuICAxMDQ6ICd1cCcsXG4gIDEwNTogJ3BhZ2V1cCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRleHQ7XG5cblRleHQubWFwID0gbWFwO1xuXG5mdW5jdGlvbiBUZXh0KCkge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZXh0YXJlYScpO1xuXG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgcG9zaXRpb246ICdhYnNvbHV0ZScsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgd2lkdGg6IDEsXG4gICAgaGVpZ2h0OiAxLFxuICAgIG9wYWNpdHk6IDAsXG4gICAgekluZGV4OiAxMDAwMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZScsXG4gICAgYXV0b2NvbXBsZXRlOiAnb2ZmJyxcbiAgICBzcGVsbGNoZWNraW5nOiAnb2ZmJyxcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG4gIHRoaXMuY2xlYXIgPSB0aHJvdHRsZSh0aGlzLmNsZWFyLmJpbmQodGhpcyksIDIwMDApXG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmJsdXIoKTtcbn07XG5cblRleHQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuZm9jdXMoKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgLy8gZm9yY2VzIGNhcmV0IHRvIGVuZCBvZiB0ZXh0YXJlYSBzbyB3ZSBjYW4gZ2V0IC5zbGljZSgtMSkgY2hhclxuICBzZXRJbW1lZGlhdGUoKCkgPT4gdGhpcy5lbC5zZWxlY3Rpb25TdGFydCA9IHRoaXMuZWwudmFsdWUubGVuZ3RoKTtcbiAgdGhpcy5lbWl0KCd0ZXh0JywgdGhpcy5nZXQoKSk7XG4gIHRoaXMuY2xlYXIoKTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICAvLyBjb25zb2xlLmxvZyhlLndoaWNoKTtcbiAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gIGlmIChub3cgLSB0aGlzLnRocm90dGxlVGltZSA8IFRIUk9UVExFKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB0aGlzLnRocm90dGxlVGltZSA9IG5vdztcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleXVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCAmJiAhZS5zaGlmdEtleSkga2V5cy5wdXNoKCdzaGlmdDp1cCcpO1xuICBpZiAobS5jdHJsICYmICFlLmN0cmxLZXkpIGtleXMucHVzaCgnY3RybDp1cCcpO1xuICBpZiAobS5hbHQgJiYgIWUuYWx0S2V5KSBrZXlzLnB1c2goJ2FsdDp1cCcpO1xuXG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdICsgJzp1cCcpO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25jdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjdXQnLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uY29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2NvcHknLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ucGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdwYXN0ZScsIGUpO1xufTtcbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi9saWIvcmVnZXhwJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uL2xpYi9wb2ludCcpO1xuXG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsnd29yZHMnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3ZlO1xuXG5mdW5jdGlvbiBNb3ZlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xufVxuXG5Nb3ZlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VEb3duID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIHNpemUgLSByZW1haW5kZXIpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKHBhZ2UpO1xufTtcblxuTW92ZS5wcm90b3R5cGUucGFnZVVwID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIC0oc2l6ZSAtIHJlbWFpbmRlcikpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKC1wYWdlKTtcbn07XG5cbnZhciBtb3ZlID0ge307XG5cbm1vdmUuYnlXb3JkID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgbGluZSA9IGJ1ZmZlci5nZXRMaW5lVGV4dChwLnkpO1xuXG4gIGlmIChkeCA+IDAgJiYgcC54ID49IGxpbmUubGVuZ3RoIC0gMSkgeyAvLyBhdCBlbmQgb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCArMSk7IC8vIG1vdmUgb25lIGNoYXIgcmlnaHRcbiAgfSBlbHNlIGlmIChkeCA8IDAgJiYgcC54ID09PSAwKSB7IC8vIGF0IGJlZ2luIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgLTEpOyAvLyBtb3ZlIG9uZSBjaGFyIGxlZnRcbiAgfVxuXG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZShsaW5lLCBXT1JEUyk7XG4gIHZhciB3b3JkO1xuXG4gIGlmIChkeCA8IDApIHdvcmRzLnJldmVyc2UoKTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmIChkeCA+IDBcbiAgICAgID8gd29yZC5pbmRleCA+IHAueFxuICAgICAgOiB3b3JkLmluZGV4IDwgcC54KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiB3b3JkLmluZGV4LFxuICAgICAgICB5OiBwLnlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVhY2hlZCBiZWdpbi9lbmQgb2YgZmlsZVxuICByZXR1cm4gZHggPiAwXG4gICAgPyBtb3ZlLmVuZE9mTGluZShidWZmZXIsIHApXG4gICAgOiBtb3ZlLmJlZ2luT2ZMaW5lKGJ1ZmZlciwgcCk7XG59O1xuXG5tb3ZlLmJ5Q2hhcnMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHggPCAwKSB7IC8vIGdvaW5nIGxlZnRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIGxlZnRcbiAgICBpZiAoeCA8IDApIHsgLy8gd2hlbiBwYXN0IGxlZnQgZWRnZVxuICAgICAgaWYgKHkgPiAwKSB7IC8vIGFuZCBsaW5lcyBhYm92ZVxuICAgICAgICB5IC09IDE7IC8vIG1vdmUgdXAgYSBsaW5lXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGFuZCBnbyB0byB0aGUgZW5kIG9mIGxpbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHggPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChkeCA+IDApIHsgLy8gZ29pbmcgcmlnaHRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIHJpZ2h0XG4gICAgd2hpbGUgKHggLSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggPiAwKSB7IC8vIHdoaWxlIHBhc3QgbGluZSBsZW5ndGhcbiAgICAgIGlmICh5ID09PSBidWZmZXIubG9jKCkpIHsgLy8gb24gZW5kIG9mIGZpbGVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gZ28gdG8gZW5kIG9mIGxpbmUgb24gbGFzdCBsaW5lXG4gICAgICAgIGJyZWFrOyAvLyBhbmQgZXhpdFxuICAgICAgfVxuICAgICAgeCAtPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggKyAxOyAvLyB3cmFwIHRoaXMgbGluZSBsZW5ndGhcbiAgICAgIHkgKz0gMTsgLy8gYW5kIG1vdmUgZG93biBhIGxpbmVcbiAgICB9XG4gIH1cblxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYnlMaW5lcyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHkpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeSA8IDApIHsgLy8gZ29pbmcgdXBcbiAgICBpZiAoeSArIGR5ID4gMCkgeyAvLyB3aGVuIGxpbmVzIGFib3ZlXG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIHVwXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSAwO1xuICAgIH1cbiAgfSBlbHNlIGlmIChkeSA+IDApIHsgLy8gZ29pbmcgZG93blxuICAgIGlmICh5IDwgYnVmZmVyLmxvYygpIC0gZHkpIHsgLy8gd2hlbiBsaW5lcyBiZWxvd1xuICAgICAgeSArPSBkeTsgLy8gbW92ZSBkb3duXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSBidWZmZXIubG9jKCk7XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgKHggPiBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aCkge1xuICAvLyAgIHggPSBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gfVxuICB4ID0gTWF0aC5taW4odGhpcy5sYXN0RGVsaWJlcmF0ZVgsIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkxpbmUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5lbmRPZkxpbmUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShwLnkpLmxlbmd0aDtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSBJbmZpbml0eTtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGhcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogbGFzdFxuICB9O1xufTtcblxubW92ZS5pc0JlZ2luT2ZGaWxlID0gZnVuY3Rpb24oXywgcCkge1xuICByZXR1cm4gcC54ID09PSAwICYmIHAueSA9PT0gMDtcbn07XG5cbm1vdmUuaXNFbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHJldHVybiBwLnkgPT09IGxhc3QgJiYgcC54ID09PSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGg7XG59O1xuXG5PYmplY3Qua2V5cyhtb3ZlKS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICBNb3ZlLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24ocGFyYW0sIGJ5RWRpdCkge1xuICAgIHZhciByZXN1bHQgPSBtb3ZlW21ldGhvZF0uY2FsbChcbiAgICAgIHRoaXMsXG4gICAgICB0aGlzLmVkaXRvci5idWZmZXIsXG4gICAgICB0aGlzLmVkaXRvci5jYXJldCxcbiAgICAgIHBhcmFtXG4gICAgKTtcblxuICAgIGlmICgnaXMnID09PSBtZXRob2Quc2xpY2UoMCwyKSkgcmV0dXJuIHJlc3VsdDtcblxuICAgIHRoaXMuZW1pdCgnbW92ZScsIHJlc3VsdCwgYnlFZGl0KTtcbiAgfTtcbn0pO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJlZGl0b3JcIjpcIl9zcmNfc3R5bGVfX2VkaXRvclwiLFwibGF5ZXJcIjpcIl9zcmNfc3R5bGVfX2xheWVyXCIsXCJyb3dzXCI6XCJfc3JjX3N0eWxlX19yb3dzXCIsXCJtYXJrXCI6XCJfc3JjX3N0eWxlX19tYXJrXCIsXCJjb2RlXCI6XCJfc3JjX3N0eWxlX19jb2RlXCIsXCJjYXJldFwiOlwiX3NyY19zdHlsZV9fY2FyZXRcIixcImJsaW5rLXNtb290aFwiOlwiX3NyY19zdHlsZV9fYmxpbmstc21vb3RoXCIsXCJjYXJldC1ibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2NhcmV0LWJsaW5rLXNtb290aFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIHJlZGJsaXNzOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzFFMTYnLFxuICAgIGNvbG9yOiAnI0U5RTNEMScsXG4gICAga2V5d29yZDogJyNBMTM2MzAnLFxuICAgIGZ1bmN0aW9uOiAnI0IzREYwMicsXG4gICAgZGVjbGFyZTogJyNGNjM4MzMnLFxuICAgIG51bWJlcjogJyNGRjlGNEUnLFxuICAgIHBhcmFtczogJyNBMDkwQTAnLFxuICAgIHJlZ2V4cDogJyNCRDcwRjQnLFxuICAgIGNvbW1lbnQ6ICcjNjM1MDQ3JyxcbiAgICBzdHJpbmc6ICcjM0VBMUZCJyxcbiAgfSxcblxuICBkYXlsaWdodDoge1xuICAgIGJhY2tncm91bmQ6ICcjRUJFQkVCJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjRkYxQjFCJyxcbiAgICBmdW5jdGlvbjogJyMwMDA1RkYnLFxuICAgIGRlY2xhcmU6ICcjMEM3QTAwJyxcbiAgICBudW1iZXI6ICcjODAyMUQ0JyxcbiAgICBwYXJhbXM6ICcjNEM2OTY5JyxcbiAgICBjb21tZW50OiAnI0FCQUJBQicsXG4gICAgc3RyaW5nOiAnI0U2NzAwMCcsXG4gIH0sXG59O1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzZXRUaGVtZTtcbmV4cG9ydHMudGhlbWVzID0gdGhlbWVzO1xuXG4vKlxudDogb3BlcmF0b3Jcbms6IGtleXdvcmRcbmQ6IGRlY2xhcmVcbmI6IGJ1aWx0aW5cbm86IGJvb2xlYW5cbm46IG51bWJlclxubTogcGFyYW1zXG5mOiBmdW5jdGlvblxucjogcmVnZXhwXG5jOiBjb21tZW50XG5zOiBzdHJpbmdcbmw6IHN5bWJvbFxueDogaW5kZW50XG4gKi9cbmZ1bmN0aW9uIHNldFRoZW1lKG5hbWUpIHtcbiAgdmFyIHQgPSB0aGVtZXNbbmFtZV07XG4gIGRvbS5jc3MoJ3RoZW1lJyxcbmBcbi4ke25hbWV9LFxuLiR7Y3NzLnJvd3N9IHtcbiAgYmFja2dyb3VuZDogJHt0LmJhY2tncm91bmR9O1xufVxuXG50LFxuayB7XG4gIGNvbG9yOiAke3Qua2V5d29yZH07XG59XG5cbmQsXG5uIHtcbiAgY29sb3I6ICR7dC5kZWNsYXJlfTtcbn1cblxubyxcbmUge1xuICBjb2xvcjogJHt0Lm51bWJlcn07XG59XG5cbm0ge1xuICBjb2xvcjogJHt0LnBhcmFtc307XG59XG5cbmYge1xuICBjb2xvcjogJHt0LmZ1bmN0aW9ufTtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5yIHtcbiAgY29sb3I6ICR7dC5yZWdleHAgfHwgdC5wYXJhbXN9O1xufVxuXG5jIHtcbiAgY29sb3I6ICR7dC5jb21tZW50fTtcbn1cblxucyB7XG4gIGNvbG9yOiAke3Quc3RyaW5nfTtcbn1cblxubCxcbi4ke2Nzcy5jb2RlfSB7XG4gIGNvbG9yOiAke3QuY29sb3J9O1xufVxuXG4uJHtjc3MuY2FyZXR9IHtcbiAgYmFja2dyb3VuZDogJHt0LmNvbG9yfTtcbn1cblxubSxcbmQge1xuICBmb250LXN0eWxlOiBpdGFsaWM7XG59XG5cbmwge1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbngge1xuICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gIGJhY2tncm91bmQtcmVwZWF0OiBuby1yZXBlYXQ7XG59XG5gXG4gIClcblxufVxuXG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCbG9ja1ZpZXc7XG5cbmZ1bmN0aW9uIEJsb2NrVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdibG9jayc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5ibG9jayk7XG4gIHRoaXMuaHRtbCA9ICcnO1xufVxuXG5CbG9ja1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGh0bWwgPSAnJztcblxuICB2YXIgT3BlbiA9IHtcbiAgICAneyc6ICdjdXJseScsXG4gICAgJ1snOiAnc3F1YXJlJyxcbiAgICAnKCc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIENsb3NlID0ge1xuICAgICd9JzogJ2N1cmx5JyxcbiAgICAnXSc6ICdzcXVhcmUnLFxuICAgICcpJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgb2Zmc2V0ID0gZS5idWZmZXIuZ2V0UG9pbnQoZS5jYXJldCkub2Zmc2V0O1xuXG4gIHZhciByZXN1bHQgPSBlLmJ1ZmZlci50b2tlbnMuZ2V0QnlPZmZzZXQoJ2Jsb2NrcycsIG9mZnNldCk7XG4gIGlmICghcmVzdWx0KSByZXR1cm4gaHRtbDtcblxuICB2YXIgbGVuZ3RoID0gZS5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ2Jsb2NrcycpLmxlbmd0aDtcbiAgdmFyIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQocmVzdWx0KTtcblxuICB2YXIgb3BlbjtcbiAgdmFyIGNsb3NlO1xuXG4gIHZhciBpID0gcmVzdWx0LmluZGV4O1xuICB2YXIgb3Blbk9mZnNldCA9IHJlc3VsdC5vZmZzZXQ7XG5cbiAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChvcGVuT2Zmc2V0KTtcblxuICB2YXIgY291bnQgPSByZXN1bHQub2Zmc2V0ID49IG9mZnNldCAtIDEgJiYgQ2xvc2VbY2hhcl0gPyAwIDogMTtcblxuICB2YXIgbGltaXQgPSAyMDA7XG5cbiAgd2hpbGUgKGkgPiAwKSB7XG4gICAgb3BlbiA9IE9wZW5bY2hhcl07XG4gICAgaWYgKENsb3NlW2NoYXJdKSBjb3VudCsrO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBpZiAob3BlbiAmJiAhLS1jb3VudCkgYnJlYWs7XG5cbiAgICBvcGVuT2Zmc2V0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5SW5kZXgoJ2Jsb2NrcycsIC0taSk7XG4gICAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChvcGVuT2Zmc2V0KTtcbiAgfVxuXG4gIGlmIChjb3VudCkgcmV0dXJuIGh0bWw7XG5cbiAgY291bnQgPSAxO1xuXG4gIHZhciBjbG9zZU9mZnNldDtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuY29kZUxlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKGVuZCk7XG5cbiAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICsgJ3dpZHRoOicgKyBlLmNoYXIud2lkdGggKyAncHg7J1xuICAgICAgICArICd0b3A6JyArIChlbmQueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChlbmQueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmNvZGVMZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHJldHVybiBodG1sO1xufVxuXG5CbG9ja1ZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHRoaXMuZWRpdG9yKTtcblxuICBpZiAoaHRtbCAhPT0gdGhpcy5odG1sKSB7XG4gICAgdGhpcy5odG1sID0gaHRtbDtcbiAgICBkb20uaHRtbCh0aGlzLCBodG1sKTtcbiAgfVxufTtcblxuQmxvY2tWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBDYXJldFZpZXc7XG5cbmZ1bmN0aW9uIENhcmV0VmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdjYXJldCc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jYXJldCk7XG59XG5cbkNhcmV0Vmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbkNhcmV0Vmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cbkNhcmV0Vmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgb3BhY2l0eTogK3RoaXMuZWRpdG9yLmhhc0ZvY3VzLFxuICAgIGxlZnQ6IHRoaXMuZWRpdG9yLmNhcmV0UHgueCArIHRoaXMuZWRpdG9yLmNvZGVMZWZ0LFxuICAgIHRvcDogdGhpcy5lZGl0b3IuY2FyZXRQeC55IC0gMSxcbiAgICBoZWlnaHQ6IHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0ICsgMVxuICB9KTtcbn07XG5cbkNhcmV0Vmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBvcGFjaXR5OiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG52YXIgQWhlYWRUaHJlc2hvbGQgPSB7XG4gIGFuaW1hdGlvbjogWy4xNSwgLjRdLFxuICBub3JtYWw6IFsyLCA0XVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBDb2RlVmlldztcblxuZnVuY3Rpb24gQ29kZVZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuXG4gIHRoaXMubmFtZSA9ICdjb2RlJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNvZGUpO1xuICB0aGlzLnBhcnRzID0gW107XG4gIHRoaXMub2Zmc2V0ID0geyB0b3A6IDAsIGxlZnQ6IDAgfTtcbn1cblxuQ29kZVZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Db2RlVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRoaXMudGFyZ2V0ID0gdGFyZ2V0O1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLmFwcGVuZFBhcnRzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucGFydHMuZm9yRWFjaChwYXJ0ID0+IHBhcnQuYXBwZW5kKCkpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhcnQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydCA9IG5ldyBQYXJ0KHRoaXMsIHJhbmdlKTtcbiAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICBwYXJ0LnJlbmRlcigpO1xuICBwYXJ0LmFwcGVuZCgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xuICBpZiAoZWRpdC5zaGlmdCA+IDApIHRoaXMucmVuZGVySW5zZXJ0KGVkaXQpO1xuICBlbHNlIGlmIChlZGl0LnNoaWZ0IDwgMCkgdGhpcy5yZW5kZXJSZW1vdmUoZWRpdCk7XG4gIGVsc2UgdGhpcy5yZW5kZXJMaW5lKGVkaXQpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5QYXJ0cyA9IHRoaXMuaW5SYW5nZVBhcnRzKHBhZ2UpO1xuICB2YXIgbmVlZFJhbmdlcyA9IFJhbmdlLk5PVChwYWdlLCB0aGlzLnBhcnRzKTtcbiAgbmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHRoaXMucmVuZGVyUGFydChyYW5nZSkpO1xuICBpblBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LnJlbmRlcigpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJSZW1vdmUgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPiBlZGl0LnJhbmdlWzBdICYmIHBhcnRbMV0gPCBlZGl0LnJhbmdlWzFdKSB7XG4gICAgICB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+IGVkaXQubGluZSkge1xuICAgICAgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lICYmIHBhcnRbMF0gKyBlZGl0LnNoaWZ0IDw9IGVkaXQubGluZSkge1xuICAgICAgdmFyIG9mZnNldCA9IGVkaXQubGluZSAtIChwYXJ0WzBdICsgZWRpdC5zaGlmdCkgKyAxO1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydC5vZmZzZXQob2Zmc2V0KTtcbiAgICAgIGlmIChwYXJ0WzBdID49IHBhcnRbMV0pIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSkge1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJJbnNlcnQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMF0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnRbMV0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJQYWdlKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyTGluZSA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lICYmIHBhcnRbMV0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA8PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgaWYgKHBhcnRbMV0gPCBwYXJ0WzBdKSB0aGlzLnJlbW92ZVBhcnQocGFydClcbiAgICAgIGVsc2UgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW1vdmVQYXJ0ID0gZnVuY3Rpb24ocGFydCkge1xuICBwYXJ0LmNsZWFyKCk7XG4gIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihwYXJ0KSwgMSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuY2xlYXJPdXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLm91dFJhbmdlUGFydHModGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHJhbmdlKSlcbiAgICAuZm9yRWFjaChwYXJ0ID0+IHRoaXMucmVtb3ZlUGFydChwYXJ0KSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuaW5SYW5nZVBhcnRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gdGhpcy5wYXJ0c1tpXTtcbiAgICBpZiAoIHBhcnRbMF0gPj0gcmFuZ2VbMF0gJiYgcGFydFswXSA8PSByYW5nZVsxXVxuICAgICAgfHwgcGFydFsxXSA+PSByYW5nZVswXSAmJiBwYXJ0WzFdIDw9IHJhbmdlWzFdICkge1xuICAgICAgcGFydHMucHVzaChwYXJ0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLm91dFJhbmdlUGFydHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSB0aGlzLnBhcnRzW2ldO1xuICAgIGlmICggcGFydFsxXSA8IHJhbmdlWzBdXG4gICAgICB8fCBwYXJ0WzBdID4gcmFuZ2VbMV0gKSB7XG4gICAgICBwYXJ0cy5wdXNoKHBhcnQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24ob3B0cyA9IHt9KSB7XG4gIGlmIChvcHRzLm9mZnNldCkgdGhpcy5vZmZzZXQgPSBvcHRzLm9mZnNldDtcbiAgLy8gaWYgKHRoaXMuZWRpdG9yLmVkaXRpbmcpIHJldHVybjtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbMCwwXSk7XG5cbiAgaWYgKFJhbmdlLk5PVChwYWdlLCB0aGlzLnBhcnRzKS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoUmFuZ2UuQU5EKHBhZ2UsIHRoaXMucGFydHMpLmxlbmd0aCA9PT0gMCkge1xuICAgIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xuICAgIHRoaXMucmVuZGVyUGFydChwYWdlKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBjaGVjayBpZiB3ZSdyZSBwYXN0IHRoZSB0aHJlc2hvbGQgb2Ygdmlld1xuICB2YXIgdGhyZXNob2xkID0gdGhpcy5lZGl0b3IuYW5pbWF0aW9uUnVubmluZ1xuICAgID8gWy1BaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF0sICtBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF1dXG4gICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFswXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFswXV07XG5cbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB0aGlzLnBhcnRzKTtcbiAgaWYgKGFoZWFkTmVlZFJhbmdlcy5sZW5ndGgpIHtcbiAgICAvLyBpZiBzbywgcmVuZGVyIGZ1cnRoZXIgYWhlYWQgdG8gaGF2ZSBzb21lXG4gICAgLy8gbWFyZ2luIHRvIHNjcm9sbCB3aXRob3V0IHRyaWdnZXJpbmcgbmV3IHJlbmRlcnNcblxuICAgIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICAgID8gWy1BaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMV0sICtBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMV1dXG4gICAgICA6IFstQWhlYWRUaHJlc2hvbGQubm9ybWFsWzFdLCArQWhlYWRUaHJlc2hvbGQubm9ybWFsWzFdXTtcblxuICAgIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcblxuICAgIGFoZWFkUmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcbiAgICBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdGhpcy5wYXJ0cyk7XG4gICAgYWhlYWROZWVkUmFuZ2VzLmZvckVhY2gocmFuZ2UgPT4ge1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KHJhbmdlKTtcbiAgICB9KTtcbiAgfVxufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucGFydHMuZm9yRWFjaChwYXJ0ID0+IHBhcnQuY2xlYXIoKSk7XG4gIHRoaXMucGFydHMgPSBbXTtcbn07XG5cbmZ1bmN0aW9uIFBhcnQodmlldywgcmFuZ2UpIHtcbiAgdGhpcy52aWV3ID0gdmlldztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNvZGUpO1xuICB0aGlzLmNvZGUgPSAnJztcbiAgdGhpcy5vZmZzZXRUb3AgPSAwO1xuICB0aGlzWzBdID0gcmFuZ2VbMF07XG4gIHRoaXNbMV0gPSByYW5nZVsxXTtcblxuICB2YXIgc3R5bGUgPSB7fTtcblxuICBpZiAodGhpcy52aWV3LmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVyc1xuICAmJiB+dGhpcy52aWV3LmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVycy5pbmRleE9mKHRoaXMudmlldy5uYW1lKSkge1xuICAgIHN0eWxlLmJhY2tncm91bmQgPSAnIydcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNilcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNilcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNik7XG4gICAgc3R5bGUub3BhY2l0eSA9IDAuNTtcbiAgfVxuXG4gIGRvbS5zdHlsZSh0aGlzLCBzdHlsZSk7XG59XG5cblBhcnQucHJvdG90eXBlLm9mZnNldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5vZmZzZXRUb3AgKz0geTtcbiAgdGhpcy5jb2RlID0gdGhpcy5jb2RlLnNwbGl0KC9cXG4vZykuc2xpY2UoeSkuam9pbignXFxuJyk7XG4gIHRoaXNbMV0gLT0geTtcbiAgdGhpcy5zdHlsZSgpO1xuICB0aGlzLmRvbS5lbC5zY3JvbGxUb3AgPSB0aGlzLm9mZnNldFRvcCAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHQ7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXcudGFyZ2V0LCB0aGlzKTtcbn07XG5cblBhcnQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29kZSA9IHRoaXMudmlldy5lZGl0b3IuYnVmZmVyLmdldCh0aGlzKTtcbiAgaWYgKGNvZGUgIT09IHRoaXMuY29kZSkge1xuICAgIGRvbS5odG1sKHRoaXMsIGNvZGUpO1xuICAgIHRoaXMuY29kZSA9IGNvZGU7XG4gIH1cbiAgdGhpcy5zdHlsZSgpO1xufTtcblxuUGFydC5wcm90b3R5cGUuc3R5bGUgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6ICh0aGlzWzFdIC0gdGhpc1swXSArIDEpICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodCxcbiAgICB0b3A6IHRoaXNbMF0gKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0XG4gICAgICAvLyAtdGhpcy52aWV3Lm9mZnNldC50b3BcbiAgfSk7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIGhlaWdodDogMFxuICB9KVxuICBzY2hlZHVsZVRvUmVtb3ZlKHRoaXMpXG59O1xuXG52YXIgc2NoZWR1bGVkRm9yUmVtb3ZhbCA9IFtdXG52YXIgcmVtb3ZlVGltZW91dFxuXG5mdW5jdGlvbiBzY2hlZHVsZVRvUmVtb3ZlKGVsKSB7XG4gIHNjaGVkdWxlZEZvclJlbW92YWwucHVzaChlbClcbiAgY2xlYXJUaW1lb3V0KHJlbW92ZVRpbWVvdXQpXG4gIGlmIChzY2hlZHVsZWRGb3JSZW1vdmFsLmxlbmd0aCA+IDEwKSB7XG4gICAgcmV0dXJuIHJlbW92ZVNjaGVkdWxlZCgpXG4gIH1cbiAgcmVtb3ZlVGltZW91dCA9IHNldFRpbWVvdXQocmVtb3ZlU2NoZWR1bGVkLCA5MDApXG59XG5cbmZ1bmN0aW9uIHJlbW92ZVNjaGVkdWxlZCgpIHtcbiAgdmFyIGVsXG4gIHdoaWxlIChlbCA9IHNjaGVkdWxlZEZvclJlbW92YWwucG9wKCkpIHtcbiAgICBkb20ucmVtb3ZlKGVsKVxuICB9XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaW5kVmlldztcblxuZnVuY3Rpb24gRmluZFZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnZmluZCc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5maW5kKTtcbn1cblxuRmluZFZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5GaW5kVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdIC0gMSkgYmVnaW4gPSBpO1xuICAgIGVsc2UgZW5kID0gaTtcbiAgfSB3aGlsZSAocHJldiAhPT0gaSk7XG5cbiAgdmFyIHdpZHRoID0gZS5maW5kVmFsdWUubGVuZ3RoICogZS5jaGFyLndpZHRoICsgJ3B4JztcblxuICB2YXIgaHRtbCA9ICcnO1xuICB2YXIgdGFicztcbiAgdmFyIHI7XG4gIHdoaWxlIChyZXN1bHRzW2ldICYmIHJlc3VsdHNbaV0ueSA8IHJhbmdlWzFdKSB7XG4gICAgciA9IHJlc3VsdHNbaSsrXTtcbiAgICB0YWJzID0gZS5nZXRQb2ludFRhYnMocik7XG4gICAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICAgKyAnd2lkdGg6JyArIHdpZHRoICsgJzsnXG4gICAgICAgICAgKyAndG9wOicgKyAoci55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICAgICsgJ2xlZnQ6JyArICgoci54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgICArICdcIj48L2k+JztcbiAgfVxuXG4gIHJldHVybiBodG1sO1xufTtcblxuRmluZFZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uaHRtbCh0aGlzLCAnJyk7XG59O1xuIiwidmFyIFJ1bGVyVmlldyA9IHJlcXVpcmUoJy4vcnVsZXInKTtcbnZhciBNYXJrVmlldyA9IHJlcXVpcmUoJy4vbWFyaycpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgQ2FyZXRWaWV3ID0gcmVxdWlyZSgnLi9jYXJldCcpO1xudmFyIEJsb2NrVmlldyA9IHJlcXVpcmUoJy4vYmxvY2snKTtcbnZhciBGaW5kVmlldyA9IHJlcXVpcmUoJy4vZmluZCcpO1xudmFyIFJvd3NWaWV3ID0gcmVxdWlyZSgnLi9yb3dzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlld3M7XG5cbmZ1bmN0aW9uIFZpZXdzKGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcblxuICB0aGlzLnZpZXdzID0gW1xuICAgIG5ldyBSdWxlclZpZXcoZWRpdG9yKSxcbiAgICBuZXcgTWFya1ZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQ29kZVZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQ2FyZXRWaWV3KGVkaXRvciksXG4gICAgbmV3IEJsb2NrVmlldyhlZGl0b3IpLFxuICAgIG5ldyBGaW5kVmlldyhlZGl0b3IpLFxuICAgIG5ldyBSb3dzVmlldyhlZGl0b3IpLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcbn1cblxuVmlld3MucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcudXNlKGVsKSk7XG59O1xuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFya1ZpZXc7XG5cbmZ1bmN0aW9uIE1hcmtWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ21hcmsnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MubWFyayk7XG59XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuTWFya1ZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5NYXJrVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldHMgPSBlLmJ1ZmZlci5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcblxuICBhcmVhWzBdIC09IG9mZnNldHNbMF07XG4gIGFyZWFbMV0gLT0gb2Zmc2V0c1swXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGFib3ZlLnJlcGxhY2UoL1teXFxuXS9nLCAnICcpIC8vZS5zeW50YXguZW50aXRpZXMoYWJvdmUpXG4gICAgKyAnPG1hcms+JyArIG1pZGRsZS5yZXBsYWNlKC9bXlxcbl0vZywgJyAnKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHRvcDogcGFnZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgIGhlaWdodDogJ2F1dG8nXG4gIH0pO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb3dzVmlldztcblxuZnVuY3Rpb24gUm93c1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAncm93cyc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5yb3dzKTtcbiAgdGhpcy5yb3dzID0gLTE7XG4gIHRoaXMucmFuZ2UgPSBbLTEsLTFdO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuUm93c1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Sb3dzVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMSwrMV0pO1xuXG4gIGlmICggcmFuZ2VbMF0gPj0gdGhpcy5yYW5nZVswXVxuICAgICYmIHJhbmdlWzFdIDw9IHRoaXMucmFuZ2VbMV1cbiAgICAmJiAoIHRoaXMucmFuZ2VbMV0gIT09IHRoaXMucm93c1xuICAgICAgfHwgdGhpcy5lZGl0b3Iucm93cyA9PT0gdGhpcy5yb3dzXG4gICAgKSkgcmV0dXJuO1xuXG4gIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMywrM10pO1xuICB0aGlzLnJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICB0aGlzLnJhbmdlID0gcmFuZ2U7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgZm9yICh2YXIgaSA9IHJhbmdlWzBdOyBpIDw9IHJhbmdlWzFdOyBpKyspIHtcbiAgICBodG1sICs9IChpICsgMSkgKyAnXFxuJztcbiAgfVxuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuXG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG5cbiAgICBkb20uc3R5bGUodGhpcywge1xuICAgICAgdG9wOiByYW5nZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgfSk7XG4gIH1cbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSdWxlclZpZXc7XG5cbmZ1bmN0aW9uIFJ1bGVyVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdydWxlcic7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5ydWxlcik7XG59XG5cblJ1bGVyVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cblJ1bGVyVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJ1bGVyVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIC8vIGhlaWdodDogdGhpcy5lZGl0b3IuaGVpZ2h0XG4gICAgLy8gKHRoaXMuZWRpdG9yLnJvd3MgKyB0aGlzLmVkaXRvci5wYWdlLmhlaWdodClcbiAgICAvLyAgICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHRcbiAgICAvLyAgICsgdGhpcy5lZGl0b3IucGFnZVJlbWFpbmRlci5oZWlnaHRcbiAgfSk7XG59O1xuXG5SdWxlclZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5mdW5jdGlvbiBWaWV3KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbn1cblxuVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRocm93IG5ldyBFcnJvcigncmVuZGVyIG5vdCBpbXBsZW1lbnRlZCcpO1xufTtcblxuVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdjbGVhciBub3QgaW1wbGVtZW50ZWQnKTtcbn07XG4iXX0=
