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
  scroll_speed: 125,
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

    scrollOffsetTop: 0,
    scrollPage: 0,
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
  this.onWheel = throttle(this.onWheel, 8);
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
  console.log('scroll', scroll, this.size.height);
};

Jazz.prototype.adjustScroll = function () {
  this.views['code'].parts.forEach(function (part) {
    part.style();
  });
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
  var g = new Point({ x: this.codeLeft, y: this.char.height / 2 })['+'](this.offset);
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
  s.y += this.scrollOffsetTop;
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
  var target = this.scroll.add({ x: x, y: y });
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
  if (!t) return cancelAnimationFrame(this.animationScrollFrame);

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
  if (!t) return cancelAnimationFrame(this.animationScrollFrame);

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

  dom.css(this.id, '\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: \'Roboto Mono\', monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n    ');

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

  dom.css(this.id, '\n    #' + this.id + ' {\n      top: ' + (this.options.center_vertical ? this.size.height / 3 : 0) + 'px;\n    }\n\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: \'Roboto Mono\', monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n\n    #' + this.id + ' > .' + css.ruler + ',\n    #' + this.id + ' > .' + css.find + ',\n    #' + this.id + ' > .' + css.mark + ',\n    #' + this.id + ' > .' + css.code + ' {\n      margin-left: ' + this.codeLeft + 'px;\n      tab-size: ' + this.tabSize + ';\n    }\n    #' + this.id + ' > .' + css.rows + ' {\n      width: ' + this.marginLeft + 'px;\n    }\n    #' + this.id + ' > .' + css.find + ' > i,\n    #' + this.id + ' > .' + css.block + ' > i {\n      height: ' + (this.char.height + 1) + 'px;\n    }\n    x {\n      background-image: url(' + dataURL + ');\n    }');

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
        left: 0,
        top: 0
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
    html += '<i style="' + 'width:' + width + ';' + 'top:' + r.y * e.char.height + 'px;' + 'left:' + ((r.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.codeLeft) + 'px;' + '"></i>';
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7O0FBSUEsSUFBSSxpQkFBaUI7QUFDbkIsU0FBTyxTQURZO0FBRW5CLGFBQVcsS0FGUTtBQUduQixlQUFhLE9BSE07QUFJbkIsZ0JBQWMsS0FKSztBQUtuQixnQkFBYyxHQUxLO0FBTW5CLGFBQVcsS0FOUTtBQU9uQixxQkFBbUIsS0FQQTtBQVFuQixtQkFBaUIsS0FSRTtBQVNuQixlQUFhLEVBVE07QUFVbkIsaUJBQWU7QUFWSSxDQUFyQjs7QUFhQSxRQUFRLHFCQUFSO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxVQUFVLFFBQVEsZ0JBQVIsQ0FBZDtBQUNBLElBQUksV0FBVyxRQUFRLGdCQUFSLENBQWY7QUFDQSxJQUFJLFdBQVcsUUFBUSxnQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWOztBQUVBLElBQUksa0JBQWtCLFFBQVEsc0JBQVIsQ0FBdEI7QUFDQSxJQUFJLFVBQVUsUUFBUSxlQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxhQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJ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ZSxNQUFmLEdBQXdCLFlBQVc7QUFDakMsUUFBTSxJQUFJLEtBQUosQ0FBVSx3QkFBVixDQUFOO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLEdBQXVCLFlBQVc7QUFDaEMsUUFBTSxJQUFJLEtBQUosQ0FBVSx1QkFBVixDQUFOO0FBQ0QsQ0FGRCIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEphenpcbiAqL1xuXG52YXIgRGVmYXVsdE9wdGlvbnMgPSB7XG4gIHRoZW1lOiAnd2VzdGVybicsXG4gIGZvbnRfc2l6ZTogJzlwdCcsXG4gIGxpbmVfaGVpZ2h0OiAnMS40ZW0nLFxuICBkZWJ1Z19sYXllcnM6IGZhbHNlLFxuICBzY3JvbGxfc3BlZWQ6IDEyNSxcbiAgaGlkZV9yb3dzOiBmYWxzZSxcbiAgY2VudGVyX2hvcml6b250YWw6IGZhbHNlLFxuICBjZW50ZXJfdmVydGljYWw6IGZhbHNlLFxuICBtYXJnaW5fbGVmdDogMTUsXG4gIGd1dHRlcl9tYXJnaW46IDIwLFxufTtcblxucmVxdWlyZSgnLi9saWIvc2V0LWltbWVkaWF0ZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL2xpYi9tZXJnZScpO1xudmFyIGNsb25lID0gcmVxdWlyZSgnLi9saWIvY2xvbmUnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9saWIvYmluZC1yYWYnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuL2xpYi9yZWdleHAnKTtcbnZhciBEaWFsb2cgPSByZXF1aXJlKCcuL2xpYi9kaWFsb2cnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4vbGliL3BvaW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuL2xpYi9yYW5nZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuL2xpYi9hcmVhJyk7XG52YXIgQm94ID0gcmVxdWlyZSgnLi9saWIvYm94Jyk7XG5cbnZhciBEZWZhdWx0QmluZGluZ3MgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC9iaW5kaW5ncycpO1xudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcbnZhciB0aGVtZSA9IHJlcXVpcmUoJy4vc3JjL3RoZW1lJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zcmMvc3R5bGUuY3NzJyk7XG5cbnZhciBORVdMSU5FID0gUmVnZXhwLmNyZWF0ZShbJ25ld2xpbmUnXSk7XG5cbm1vZHVsZS5leHBvcnRzID0gSmF6ejtcblxuZnVuY3Rpb24gSmF6eihvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG1lcmdlKGNsb25lKERlZmF1bHRPcHRpb25zKSwgb3B0aW9ucyB8fCB7fSk7XG5cbiAgT2JqZWN0LmFzc2lnbih0aGlzLCB7XG4gICAgZWw6IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKSxcblxuICAgIGlkOiAnamF6el8nICsgKE1hdGgucmFuZG9tKCkgKiAxMGU2IHwgMCkudG9TdHJpbmcoMzYpLFxuICAgIGZpbGU6IG5ldyBGaWxlLFxuICAgIG1vdmU6IG5ldyBNb3ZlKHRoaXMpLFxuICAgIHZpZXdzOiBuZXcgVmlld3ModGhpcyksXG4gICAgaW5wdXQ6IG5ldyBJbnB1dCh0aGlzKSxcbiAgICBoaXN0b3J5OiBuZXcgSGlzdG9yeSh0aGlzKSxcblxuICAgIGJpbmRpbmdzOiBPYmplY3QuYXNzaWduKHt9LCBEZWZhdWx0QmluZGluZ3MpLFxuXG4gICAgZmluZDogbmV3IERpYWxvZygnRmluZCcsIFRleHQubWFwKSxcbiAgICBmaW5kVmFsdWU6ICcnLFxuICAgIGZpbmROZWVkbGU6IDAsXG4gICAgZmluZFJlc3VsdHM6IFtdLFxuXG4gICAgc2Nyb2xsT2Zmc2V0VG9wOiAwLFxuICAgIHNjcm9sbFBhZ2U6IDAsXG4gICAgc2Nyb2xsOiBuZXcgUG9pbnQsXG4gICAgb2Zmc2V0OiBuZXcgUG9pbnQsXG4gICAgc2l6ZTogbmV3IEJveCxcbiAgICBjaGFyOiBuZXcgQm94LFxuXG4gICAgcGFnZTogbmV3IEJveCxcbiAgICBwYWdlUG9pbnQ6IG5ldyBQb2ludCxcbiAgICBwYWdlUmVtYWluZGVyOiBuZXcgQm94LFxuICAgIHBhZ2VCb3VuZHM6IG5ldyBSYW5nZSxcblxuICAgIGxvbmdlc3RMaW5lOiAwLFxuICAgIGd1dHRlcjogMCxcbiAgICBjb2RlOiAwLFxuICAgIHJvd3M6IDAsXG5cbiAgICB0YWJTaXplOiAyLFxuICAgIHRhYjogJyAgJyxcblxuICAgIGNhcmV0OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuICAgIGNhcmV0UHg6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG5cbiAgICBoYXNGb2N1czogZmFsc2UsXG5cbiAgICBtYXJrOiBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgICB9KSxcblxuICAgIGVkaXRpbmc6IGZhbHNlLFxuICAgIGVkaXRMaW5lOiAtMSxcbiAgICBlZGl0UmFuZ2U6IFstMSwtMV0sXG4gICAgZWRpdFNoaWZ0OiAwLFxuXG4gICAgc3VnZ2VzdEluZGV4OiAwLFxuICAgIHN1Z2dlc3RSb290OiAnJyxcbiAgICBzdWdnZXN0Tm9kZXM6IFtdLFxuXG4gICAgYW5pbWF0aW9uVHlwZTogJ2xpbmVhcicsXG4gICAgYW5pbWF0aW9uRnJhbWU6IC0xLFxuICAgIGFuaW1hdGlvblJ1bm5pbmc6IGZhbHNlLFxuICAgIGFuaW1hdGlvblNjcm9sbFRhcmdldDogbnVsbCxcblxuICAgIHJlbmRlclF1ZXVlOiBbXSxcbiAgICByZW5kZXJSZXF1ZXN0OiBudWxsLFxuICAgIHJlbmRlclJlcXVlc3RTdGFydGVkQXQ6IC0xLFxuICB9KTtcblxuICAvLyB1c2VmdWwgc2hvcnRjdXRzXG4gIHRoaXMuYnVmZmVyID0gdGhpcy5maWxlLmJ1ZmZlcjtcbiAgdGhpcy5idWZmZXIubWFyayA9IHRoaXMubWFyaztcbiAgdGhpcy5zeW50YXggPSB0aGlzLmJ1ZmZlci5zeW50YXg7XG5cbiAgdGhlbWUodGhpcy5vcHRpb25zLnRoZW1lKTtcblxuICB0aGlzLmJpbmRNZXRob2RzKCk7XG4gIHRoaXMuYmluZEV2ZW50cygpO1xufVxuXG5KYXp6LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkphenoucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsLCBzY3JvbGxFbCkge1xuICBpZiAodGhpcy5yZWYpIHtcbiAgICB0aGlzLmVsLnJlbW92ZUF0dHJpYnV0ZSgnaWQnKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUoY3NzLmVkaXRvcik7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gICAgdGhpcy5vZmZTY3JvbGwoKTtcbiAgICB0aGlzLm9mZldoZWVsKCk7XG4gICAgdGhpcy5yZWYuZm9yRWFjaChyZWYgPT4ge1xuICAgICAgZG9tLmFwcGVuZChlbCwgcmVmKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnJlZiA9IFtdLnNsaWNlLmNhbGwodGhpcy5lbC5jaGlsZHJlbik7XG4gICAgZG9tLmFwcGVuZChlbCwgdGhpcy5lbCk7XG4gICAgZG9tLm9ucmVzaXplKHRoaXMub25SZXNpemUpO1xuICB9XG5cbiAgdGhpcy5lbCA9IGVsO1xuICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnaWQnLCB0aGlzLmlkKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKGNzcy5lZGl0b3IpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgdGhpcy5vZmZTY3JvbGwgPSBkb20ub25zY3JvbGwoc2Nyb2xsRWwgfHwgdGhpcy5lbCwgdGhpcy5vblNjcm9sbCk7XG4gIHRoaXMub2ZmV2hlZWwgPSBkb20ub253aGVlbChzY3JvbGxFbCB8fCB0aGlzLmVsLCB0aGlzLm9uV2hlZWwpXG4gIHRoaXMuaW5wdXQudXNlKHRoaXMuZWwpO1xuICBkb20uYXBwZW5kKHRoaXMudmlld3MuY2FyZXQsIHRoaXMuaW5wdXQudGV4dCk7XG4gIHRoaXMudmlld3MudXNlKHRoaXMuZWwpO1xuXG4gIHRoaXMucmVwYWludCgpXG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hc3NpZ24gPSBmdW5jdGlvbihiaW5kaW5ncykge1xuICB0aGlzLmJpbmRpbmdzID0gYmluZGluZ3M7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMuZmlsZS5vcGVuKHBhdGgsIHJvb3QsIGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgdGhpcy5maWxlLnNhdmUoZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQsIHBhdGgpIHtcbiAgdGhpcy5maWxlLnNldCh0ZXh0KTtcbiAgdGhpcy5maWxlLnBhdGggPSBwYXRoIHx8IHRoaXMuZmlsZS5wYXRoO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmZvY3VzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmJsdXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRNZXRob2RzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lLmJpbmQodGhpcyk7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luLmJpbmQodGhpcyk7XG4gIHRoaXMubWFya1NldCA9IHRoaXMubWFya1NldC5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtDbGVhciA9IHRoaXMubWFya0NsZWFyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMucmVwYWludCA9IHRoaXMucmVwYWludC5iaW5kKHRoaXMpOyAvL2JpbmRSYWYodGhpcy5yZXBhaW50KS5iaW5kKHRoaXMpO1xuICB0aGlzLl9yZW5kZXIgPSB0aGlzLl9yZW5kZXIuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxuICB0aGlzLm9uV2hlZWwgPSB0aHJvdHRsZSh0aGlzLm9uV2hlZWwsIDgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJpbmRIYW5kbGVycygpXG4gIHRoaXMubW92ZS5vbignbW92ZScsIHRoaXMub25Nb3ZlKTtcbiAgdGhpcy5maWxlLm9uKCdyYXcnLCB0aGlzLm9uRmlsZVJhdyk7IC8vVE9ETzogc2hvdWxkIG5vdCBuZWVkIHRoaXMgZXZlbnRcbiAgdGhpcy5maWxlLm9uKCdzZXQnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuZmlsZS5vbignb3BlbicsIHRoaXMub25GaWxlT3Blbik7XG4gIHRoaXMuZmlsZS5vbignY2hhbmdlJywgdGhpcy5vbkZpbGVDaGFuZ2UpO1xuICB0aGlzLmZpbGUub24oJ2JlZm9yZSBjaGFuZ2UnLCB0aGlzLm9uQmVmb3JlRmlsZUNoYW5nZSk7XG4gIHRoaXMuaGlzdG9yeS5vbignY2hhbmdlJywgdGhpcy5vbkhpc3RvcnlDaGFuZ2UpO1xuICB0aGlzLmlucHV0Lm9uKCdibHVyJywgdGhpcy5vbkJsdXIpO1xuICB0aGlzLmlucHV0Lm9uKCdmb2N1cycsIHRoaXMub25Gb2N1cyk7XG4gIHRoaXMuaW5wdXQub24oJ2lucHV0JywgdGhpcy5vbklucHV0KTtcbiAgdGhpcy5pbnB1dC5vbigndGV4dCcsIHRoaXMub25UZXh0KTtcbiAgdGhpcy5pbnB1dC5vbigna2V5cycsIHRoaXMub25LZXlzKTtcbiAgdGhpcy5pbnB1dC5vbigna2V5JywgdGhpcy5vbktleSk7XG4gIHRoaXMuaW5wdXQub24oJ2N1dCcsIHRoaXMub25DdXQpO1xuICB0aGlzLmlucHV0Lm9uKCdjb3B5JywgdGhpcy5vbkNvcHkpO1xuICB0aGlzLmlucHV0Lm9uKCdwYXN0ZScsIHRoaXMub25QYXN0ZSk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNldXAnLCB0aGlzLm9uTW91c2VVcCk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWNsaWNrJywgdGhpcy5vbk1vdXNlQ2xpY2spO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWdiZWdpbicsIHRoaXMub25Nb3VzZURyYWdCZWdpbik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZycsIHRoaXMub25Nb3VzZURyYWcpO1xuICB0aGlzLmZpbmQub24oJ3N1Ym1pdCcsIHRoaXMuZmluZEp1bXAuYmluZCh0aGlzLCAxKSk7XG4gIHRoaXMuZmluZC5vbigndmFsdWUnLCB0aGlzLm9uRmluZFZhbHVlKTtcbiAgdGhpcy5maW5kLm9uKCdrZXknLCB0aGlzLm9uRmluZEtleSk7XG4gIHRoaXMuZmluZC5vbignb3BlbicsIHRoaXMub25GaW5kT3Blbik7XG4gIHRoaXMuZmluZC5vbignY2xvc2UnLCB0aGlzLm9uRmluZENsb3NlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uU2Nyb2xsID0gZnVuY3Rpb24oc2Nyb2xsKSB7XG4gIHRoaXMuc2Nyb2xsLnNldChzY3JvbGwpO1xuICB0aGlzLnJlbmRlcignY29kZScpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xuICB0aGlzLnJlbmRlcigncm93cycpO1xuICB0aGlzLnJlc3QoKTtcbiAgY29uc29sZS5sb2coJ3Njcm9sbCcsIHNjcm9sbCwgdGhpcy5zaXplLmhlaWdodCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hZGp1c3RTY3JvbGwgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy52aWV3c1snY29kZSddLnBhcnRzLmZvckVhY2gocGFydCA9PiB7XG4gICAgcGFydC5zdHlsZSgpO1xuICB9KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uV2hlZWwgPSBmdW5jdGlvbih3aGVlbCkge1xuICB0aGlzLmFuaW1hdGVTY3JvbGxCeSh3aGVlbC5kZWx0YVgsIHdoZWVsLmRlbHRhWSAqIDEuMiwgJ2Vhc2UnKVxufTtcblxuSmF6ei5wcm90b3R5cGUucmVzdCA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbn0sIDYwMCk7XG5cbkphenoucHJvdG90eXBlLm9uTW92ZSA9IGZ1bmN0aW9uKHBvaW50LCBieUVkaXQpIHtcbiAgaWYgKCFieUVkaXQpIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICBpZiAocG9pbnQpIHRoaXMuc2V0Q2FyZXQocG9pbnQpO1xuXG4gIGlmICghYnlFZGl0KSB7XG4gICAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgfHwgdGhpcy5pbnB1dC5tb3VzZS5kb3duKSB7XG4gICAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ21vdmUnKTtcbiAgdGhpcy5lbWl0KCdpbnB1dCcsICcnLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSk7XG4gIHRoaXMuY2FyZXRTb2xpZCgpO1xuICB0aGlzLnJlc3QoKTtcblxuICB0aGlzLnJlbmRlcignY2FyZXQnKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRm9jdXMgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSB0cnVlO1xuICB0aGlzLmVtaXQoJ2ZvY3VzJyk7XG4gIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG4gIHRoaXMuY2FyZXRTb2xpZCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuY2FyZXRTb2xpZCA9IGZ1bmN0aW9uKCkge1xuICBkb20uY2xhc3Nlcyh0aGlzLnZpZXdzLmNhcmV0LCBbY3NzLmNhcmV0XSk7XG4gIHRoaXMuY2FyZXRCbGluaygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuY2FyZXRCbGluayA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICBkb20uY2xhc3Nlcyh0aGlzLnZpZXdzLmNhcmV0LCBbY3NzLmNhcmV0LCBjc3NbJ2JsaW5rLXNtb290aCddXSk7XG59LCA0MDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbkJsdXIgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSBmYWxzZTtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB7XG4gICAgICBkb20uY2xhc3Nlcyh0aGlzLnZpZXdzLmNhcmV0LCBbY3NzLmNhcmV0XSk7XG4gICAgICB0aGlzLmVtaXQoJ2JsdXInKTtcbiAgICAgIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG4gICAgfVxuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSW5wdXQgPSBmdW5jdGlvbih0ZXh0KSB7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuc3VnZ2VzdFJvb3QgPSAnJztcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleXMgPSBmdW5jdGlvbihrZXlzLCBlKSB7XG4gIGlmIChrZXlzIGluIHRoaXMuYmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleXMgaW4gRGVmYXVsdEJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleSA9IGZ1bmN0aW9uKGtleSwgZSkge1xuICBpZiAoa2V5IGluIHRoaXMuYmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXkgaW4gRGVmYXVsdEJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25DdXQgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB0aGlzLm9uQ29weShlKTtcbiAgdGhpcy5kZWxldGUoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQ29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICBlLmNsaXBib2FyZERhdGEuc2V0RGF0YSgndGV4dC9wbGFpbicsIHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25QYXN0ZSA9IGZ1bmN0aW9uKGUpIHtcbiAgdmFyIHRleHQgPSBlLmNsaXBib2FyZERhdGEuZ2V0RGF0YSgndGV4dC9wbGFpbicpO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZU9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tb3ZlLmJlZ2luT2ZGaWxlKCk7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlUmF3ID0gZnVuY3Rpb24ocmF3KSB7XG4gIC8vXG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRUYWJNb2RlID0gZnVuY3Rpb24oY2hhcikge1xuICBpZiAoJ1xcdCcgPT09IGNoYXIpIHtcbiAgICB0aGlzLnRhYiA9IGNoYXI7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy50YWIgPSBuZXcgQXJyYXkodGhpcy50YWJTaXplICsgMSkuam9pbihjaGFyKTtcbiAgfVxufVxuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVTZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldCh7IHg6MCwgeTowIH0pO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVwYWludCh0cnVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSGlzdG9yeUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlbmRlcignY29kZScpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB0aGlzLnJlbmRlcignYmxvY2snKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICB0aGlzLmVtaXQoJ2hpc3RvcnkgY2hhbmdlJylcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLmVkaXRDYXJldEJlZm9yZSA9IHRoaXMuY2FyZXQuY29weSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuXG4gIHRoaXMudmlld3MuY29kZS5yZW5kZXJFZGl0KHtcbiAgICBsaW5lOiBlZGl0UmFuZ2VbMF0sXG4gICAgcmFuZ2U6IGVkaXRSYW5nZSxcbiAgICBzaGlmdDogZWRpdFNoaWZ0LFxuICAgIGNhcmV0Tm93OiB0aGlzLmNhcmV0LFxuICAgIGNhcmV0QmVmb3JlOiB0aGlzLmVkaXRDYXJldEJlZm9yZVxuICB9KTtcblxuICB0aGlzLnJlbmRlcignY2FyZXQnKTtcbiAgdGhpcy5yZW5kZXIoJ3Jvd3MnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbiAgdGhpcy5yZW5kZXIoJ3J1bGVyJyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldEZyb21QeCA9IGZ1bmN0aW9uKHB4KSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5jb2RlTGVmdCwgeTogdGhpcy5jaGFyLmhlaWdodC8yIH0pWycrJ10odGhpcy5vZmZzZXQpO1xuICBpZiAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCkgZy55ICs9IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIHwgMDtcbiAgdmFyIHAgPSBweFsnLSddKGcpWycrJ10odGhpcy5zY3JvbGwpWydvLyddKHRoaXMuY2hhcik7XG5cbiAgcC55ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocC55LCB0aGlzLmJ1ZmZlci5sb2MoKSkpO1xuICBwLnggPSBNYXRoLm1heCgwLCBwLngpO1xuXG4gIHZhciB0YWJzID0gdGhpcy5nZXRDb29yZHNUYWJzKHApO1xuXG4gIHAueCA9IE1hdGgubWF4KFxuICAgIDAsXG4gICAgTWF0aC5taW4oXG4gICAgICBwLnggLSB0YWJzLnRhYnMgKyB0YWJzLnJlbWFpbmRlcixcbiAgICAgIHRoaXMuZ2V0TGluZUxlbmd0aChwLnkpXG4gICAgKVxuICApO1xuXG4gIHRoaXMuc2V0Q2FyZXQocCk7XG4gIHRoaXMubW92ZS5sYXN0RGVsaWJlcmF0ZVggPSBwLng7XG4gIHRoaXMub25Nb3ZlKCk7XG5cbiAgcmV0dXJuIHA7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlVXAgPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB0aGlzLmJsdXIoKTtcbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRG93biA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KHRoaXMuZm9jdXMuYmluZCh0aGlzKSwgMTApO1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCkgdGhpcy5tYXJrQmVnaW4oKTtcbiAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXQgPSBmdW5jdGlvbihwLCBjZW50ZXIsIGFuaW1hdGUpIHtcbiAgdGhpcy5jYXJldC5zZXQocCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldFBvaW50VGFicyh0aGlzLmNhcmV0KTtcblxuICB0aGlzLmNhcmV0UHguc2V0KHtcbiAgICB4OiB0aGlzLmNoYXIud2lkdGggKiAodGhpcy5jYXJldC54ICsgdGFicy50YWJzICogdGhpcy50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpLFxuICAgIHk6IHRoaXMuY2hhci5oZWlnaHQgKiB0aGlzLmNhcmV0LnlcbiAgfSk7XG5cbiAgdGhpcy5mb2xsb3dDYXJldChjZW50ZXIsIGFuaW1hdGUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZUNsaWNrID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjbGlja3MgPSB0aGlzLmlucHV0Lm1vdXNlLmNsaWNrcztcbiAgaWYgKGNsaWNrcyA+IDEpIHtcbiAgICB2YXIgYXJlYTtcblxuICAgIGlmIChjbGlja3MgPT09IDIpIHtcbiAgICAgIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXJlYUF0UG9pbnQodGhpcy5jYXJldCk7XG4gICAgfSBlbHNlIGlmIChjbGlja3MgPT09IDMpIHtcbiAgICAgIHZhciB5ID0gdGhpcy5jYXJldC55O1xuICAgICAgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgICAgYmVnaW46IHsgeDogMCwgeTogeSB9LFxuICAgICAgICBlbmQ6IHsgeDogdGhpcy5nZXRMaW5lTGVuZ3RoKHkpLCB5OiB5IH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLnNldENhcmV0KGFyZWEuZW5kKTtcbiAgICAgIHRoaXMubWFya1NldEFyZWEoYXJlYSk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xuICB0aGlzLmNsZWFyKCdtYXJrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJldHVybiBSYW5nZS5jbGFtcChyYW5nZSwgdGhpcy5wYWdlQm91bmRzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBzID0gdGhpcy5zY3JvbGwuY29weSgpO1xuICBzLnkgKz0gdGhpcy5zY3JvbGxPZmZzZXRUb3A7XG4gIGlmICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsKSB7XG4gICAgcy55IC09IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIHwgMDtcbiAgfVxuICB2YXIgcCA9IHNbJ18vJ10odGhpcy5jaGFyKTtcbiAgcmV0dXJuIHRoaXMuZ2V0UmFuZ2UoW1xuICAgIE1hdGguZmxvb3IocC55ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzBdKSxcbiAgICBNYXRoLmNlaWwocC55ICsgdGhpcy5wYWdlLmhlaWdodCArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVsxXSlcbiAgXSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRMaW5lTGVuZ3RoID0gZnVuY3Rpb24oeSkge1xuICByZXR1cm4gdGhpcy5idWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2xsb3dDYXJldCA9IGZ1bmN0aW9uKGNlbnRlciwgYW5pbWF0ZSkge1xuICB2YXIgcCA9IHRoaXMuY2FyZXRQeDtcbiAgdmFyIHMgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCB8fCB0aGlzLnNjcm9sbDtcblxuICB2YXIgdG9wID0gKFxuICAgICAgcy55XG4gICAgKyAoY2VudGVyICYmICF0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAyIHwgMCkgLSAxMDAgOiAwKVxuICApIC0gcC55O1xuXG4gIHZhciBib3R0b20gPSBwLnkgLSAoXG4gICAgICBzLnlcbiAgICArIHRoaXMuc2l6ZS5oZWlnaHRcbiAgICAtIChjZW50ZXIgJiYgIXRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDIgfCAwKSAtIDEwMCA6IDApXG4gICAgLSAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMyAqIDIgfCAwKSA6IDApXG4gICkgKyB0aGlzLmNoYXIuaGVpZ2h0O1xuXG4gIHZhciBsZWZ0ID0gKHMueCArIHRoaXMuY2hhci53aWR0aCkgLSBwLng7XG4gIHZhciByaWdodCA9IChwLngpIC0gKHMueCArIHRoaXMuc2l6ZS53aWR0aCAtIHRoaXMubWFyZ2luTGVmdCkgKyB0aGlzLmNoYXIud2lkdGggKiAyO1xuXG4gIGlmIChib3R0b20gPCAwKSBib3R0b20gPSAwO1xuICBpZiAodG9wIDwgMCkgdG9wID0gMDtcbiAgaWYgKGxlZnQgPCAwKSBsZWZ0ID0gMDtcbiAgaWYgKHJpZ2h0IDwgMCkgcmlnaHQgPSAwO1xuXG4gIGlmIChsZWZ0ICsgdG9wICsgcmlnaHQgKyBib3R0b20pIHtcbiAgICB0aGlzW2FuaW1hdGUgPyAnYW5pbWF0ZVNjcm9sbEJ5JyA6ICdzY3JvbGxCeSddKHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wLCAnZWFzZScpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICBsZXQgdGFyZ2V0ID0gdGhpcy5zY3JvbGwuYWRkKHsgeCwgeSB9KTtcbiAgaWYgKFBvaW50LnNvcnQodGFyZ2V0LCB0aGlzLnNjcm9sbCkgIT09IDApIHtcbiAgICB0aGlzLnNjcm9sbC5zZXQodGFyZ2V0KTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuc2Nyb2xsKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0ZVNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSwgYW5pbWF0aW9uVHlwZSkge1xuICB0aGlzLmFuaW1hdGlvblR5cGUgPSBhbmltYXRpb25UeXBlIHx8ICdsaW5lYXInO1xuXG4gIGlmICghdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgaWYgKCdsaW5lYXInID09PSB0aGlzLmFuaW1hdGlvblR5cGUpIHtcbiAgICAgIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgICB9XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKFxuICAgICAgICAodGhpcy5yb3dzICsgMSkgKiB0aGlzLmNoYXIuaGVpZ2h0IC0gdGhpcy5zaXplLmhlaWdodFxuICAgICAgKyAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzICogMiB8IDAgOiAwKSxcbiAgICAgIE1hdGgubWF4KDAsIHMueSArIHkpXG4gICAgKVxuICB9KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG4gIGlmICghdCkgcmV0dXJuIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcbiAgaWYgKCF0KSByZXR1cm4gY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgdmFyIGFkeCA9IE1hdGguYWJzKGR4KTtcbiAgdmFyIGFkeSA9IE1hdGguYWJzKGR5KTtcblxuICBpZiAoYWR5ID49IHRoaXMuc2l6ZS5oZWlnaHQgKiAxLjIpIHtcbiAgICBzcGVlZCAqPSAyLjQ1O1xuICB9XG5cbiAgaWYgKChhZHggPCAxICYmIGFkeSA8IDEpIHx8ICF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0KTtcbiAgICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG51bGw7XG4gICAgdGhpcy5lbWl0KCdhbmltYXRpb24gZW5kJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgc3dpdGNoICh0aGlzLmFuaW1hdGlvblR5cGUpIHtcbiAgICBjYXNlICdsaW5lYXInOlxuICAgICAgaWYgKGFkeCA8IHNwZWVkKSBkeCAqPSAwLjk7XG4gICAgICBlbHNlIGR4ID0gTWF0aC5zaWduKGR4KSAqIHNwZWVkO1xuXG4gICAgICBpZiAoYWR5IDwgc3BlZWQpIGR5ICo9IDAuOTtcbiAgICAgIGVsc2UgZHkgPSBNYXRoLnNpZ24oZHkpICogc3BlZWQ7XG5cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2Vhc2UnOlxuICAgICAgZHggKj0gMC41O1xuICAgICAgZHkgKj0gMC41O1xuICAgICAgYnJlYWs7XG4gIH1cblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLmRlbGV0ZSgpO1xuXG4gIHRoaXMuZW1pdCgnaW5wdXQnLCB0ZXh0LCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSk7XG5cbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dCh0aGlzLmNhcmV0LnkpO1xuICB2YXIgcmlnaHQgPSBsaW5lW3RoaXMuY2FyZXQueF07XG4gIHZhciBoYXNSaWdodFN5bWJvbCA9IH5bJ30nLCddJywnKSddLmluZGV4T2YocmlnaHQpO1xuXG4gIC8vIGFwcGx5IGluZGVudCBvbiBlbnRlclxuICBpZiAoTkVXTElORS50ZXN0KHRleHQpKSB7XG4gICAgdmFyIGlzRW5kT2ZMaW5lID0gdGhpcy5jYXJldC54ID09PSBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGxlZnQgPSBsaW5lW3RoaXMuY2FyZXQueCAtIDFdO1xuICAgIHZhciBpbmRlbnQgPSBsaW5lLm1hdGNoKC9cXFMvKTtcbiAgICBpbmRlbnQgPSBpbmRlbnQgPyBpbmRlbnQuaW5kZXggOiBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGhhc0xlZnRTeW1ib2wgPSB+Wyd7JywnWycsJygnXS5pbmRleE9mKGxlZnQpO1xuXG4gICAgaWYgKGhhc0xlZnRTeW1ib2wpIGluZGVudCArPSAyO1xuXG4gICAgaWYgKGlzRW5kT2ZMaW5lIHx8IGhhc0xlZnRTeW1ib2wpIHtcbiAgICAgIHRleHQgKz0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKTtcbiAgICB9XG4gIH1cblxuICB2YXIgbGVuZ3RoO1xuXG4gIGlmICghaGFzUmlnaHRTeW1ib2wgfHwgKGhhc1JpZ2h0U3ltYm9sICYmICF+Wyd9JywnXScsJyknXS5pbmRleE9mKHRleHQpKSkge1xuICAgIGxlbmd0aCA9IHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCB0ZXh0LCBudWxsLCB0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSAxO1xuICB9XG5cbiAgdGhpcy5tb3ZlLmJ5Q2hhcnMobGVuZ3RoLCB0cnVlKTtcblxuICBpZiAoJ3snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ30nKTtcbiAgZWxzZSBpZiAoJygnID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJyknKTtcbiAgZWxzZSBpZiAoJ1snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ10nKTtcblxuICBpZiAoaGFzTGVmdFN5bWJvbCAmJiBoYXNSaWdodFN5bWJvbCkge1xuICAgIGluZGVudCAtPSAyO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJykpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iYWNrc3BhY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybiB0aGlzLmRlbGV0ZSgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMCcsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcblxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKHRydWUpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xLCB0cnVlKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm4gdGhpcy5iYWNrc3BhY2UoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmVtaXQoJ2lucHV0JywgJ1xcdWFhYTEnLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSk7XG5cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSh0cnVlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZmluZEp1bXAgPSBmdW5jdGlvbihqdW1wKSB7XG4gIGlmICghdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggfHwgIXRoaXMuZmluZC5pc09wZW4pIHJldHVybjtcblxuICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmROZWVkbGUgKyBqdW1wO1xuICBpZiAodGhpcy5maW5kTmVlZGxlID49IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gMDtcbiAgfSBlbHNlIGlmICh0aGlzLmZpbmROZWVkbGUgPCAwKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggLSAxO1xuICB9XG5cbiAgdGhpcy5maW5kLmluZm8oMSArIHRoaXMuZmluZE5lZWRsZSArICcvJyArIHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKTtcblxuICB2YXIgcmVzdWx0ID0gdGhpcy5maW5kUmVzdWx0c1t0aGlzLmZpbmROZWVkbGVdO1xuICB0aGlzLnNldENhcmV0KHJlc3VsdCwgdHJ1ZSwgdHJ1ZSk7XG4gIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLm1vdmUuYnlDaGFycyh0aGlzLmZpbmRWYWx1ZS5sZW5ndGgsIHRydWUpO1xuICB0aGlzLm1hcmtTZXQoKTtcbiAgdGhpcy5mb2xsb3dDYXJldCh0cnVlLCB0cnVlKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZFZhbHVlID0gZnVuY3Rpb24odmFsdWUsIG5vSnVtcCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMuZ3V0dGVyLCB5OiAwIH0pO1xuXG4gIHRoaXMuYnVmZmVyLnVwZGF0ZVJhdygpO1xuICB0aGlzLmZpbmRWYWx1ZSA9IHZhbHVlO1xuICB0aGlzLmZpbmRSZXN1bHRzID0gdGhpcy5idWZmZXIuaW5kZXhlci5maW5kKHZhbHVlKS5tYXAoKG9mZnNldCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpO1xuICB9KTtcblxuICBpZiAodGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuICB9XG5cbiAgaWYgKCFub0p1bXApIHRoaXMuZmluZEp1bXAoMCk7XG5cbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZEtleSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKH5bMzMsIDM0LCAxMTRdLmluZGV4T2YoZS53aGljaCkpIHsgLy8gcGFnZXVwLCBwYWdlZG93biwgZjNcbiAgICB0aGlzLmlucHV0LnRleHQub25rZXlkb3duKGUpO1xuICB9XG5cbiAgaWYgKDcwID09PSBlLndoaWNoICYmIGUuY3RybEtleSkgeyAvLyBjdHJsK2ZcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICg5ID09PSBlLndoaWNoKSB7IC8vIHRhYlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZmluZC5pbmZvKCcnKTtcbiAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRDbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyKCdmaW5kJyk7XG4gIHRoaXMuZm9jdXMoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnN1Z2dlc3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXJlYUF0UG9pbnQodGhpcy5jYXJldCwgdHJ1ZSk7XG4gIGlmICghYXJlYSkgcmV0dXJuO1xuXG4gIHZhciBrZXkgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgaWYgKCFrZXkpIHJldHVybjtcblxuICBpZiAoIXRoaXMuc3VnZ2VzdFJvb3RcbiAgICB8fCBrZXkuc3Vic3RyKDAsIHRoaXMuc3VnZ2VzdFJvb3QubGVuZ3RoKSAhPT0gdGhpcy5zdWdnZXN0Um9vdCkge1xuICAgIHRoaXMuc3VnZ2VzdEluZGV4ID0gMDtcbiAgICB0aGlzLnN1Z2dlc3RSb290ID0ga2V5O1xuICAgIHRoaXMuc3VnZ2VzdE5vZGVzID0gdGhpcy5idWZmZXIucHJlZml4LmNvbGxlY3Qoa2V5KTtcbiAgfVxuXG4gIGlmICghdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoKSByZXR1cm47XG4gIHZhciBub2RlID0gdGhpcy5zdWdnZXN0Tm9kZXNbdGhpcy5zdWdnZXN0SW5kZXhdO1xuXG4gIHRoaXMuc3VnZ2VzdEluZGV4ID0gKHRoaXMuc3VnZ2VzdEluZGV4ICsgMSkgJSB0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGg7XG5cbiAgcmV0dXJuIHtcbiAgICBhcmVhOiBhcmVhLFxuICAgIG5vZGU6IG5vZGVcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBvaW50VGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFiID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlciArIHRhYnNcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldENvb3Jkc1RhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYnMgKiB0aGlzLnRhYlNpemUgKyByZW1haW5kZXIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXBhaW50ID0gZnVuY3Rpb24oY2xlYXIpIHtcbiAgdGhpcy5yZXNpemUoKTtcbiAgaWYgKGNsZWFyKSB0aGlzLnZpZXdzLmNsZWFyKCk7XG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyICQgPSB0aGlzLmVsO1xuXG4gIGRvbS5jc3ModGhpcy5pZCwgYFxuICAgIC4ke2Nzcy5yb3dzfSxcbiAgICAuJHtjc3MubWFya30sXG4gICAgLiR7Y3NzLmNvZGV9LFxuICAgIG1hcmssXG4gICAgcCxcbiAgICB0LFxuICAgIGssXG4gICAgZCxcbiAgICBuLFxuICAgIG8sXG4gICAgZSxcbiAgICBtLFxuICAgIGYsXG4gICAgcixcbiAgICBjLFxuICAgIHMsXG4gICAgbCxcbiAgICB4IHtcbiAgICAgIGZvbnQtZmFtaWx5OiAnUm9ib3RvIE1vbm8nLCBtb25vc3BhY2U7XG4gICAgICBmb250LXNpemU6ICR7dGhpcy5vcHRpb25zLmZvbnRfc2l6ZX07XG4gICAgICBsaW5lLWhlaWdodDogJHt0aGlzLm9wdGlvbnMubGluZV9oZWlnaHR9O1xuICAgIH1cbiAgICBgXG4gICk7XG5cbiAgdGhpcy5vZmZzZXQuc2V0KGRvbS5nZXRPZmZzZXQoJCkpO1xuICB0aGlzLnNjcm9sbC5zZXQoZG9tLmdldFNjcm9sbCgkKSk7XG4gIHRoaXMuc2l6ZS5zZXQoZG9tLmdldFNpemUoJCkpO1xuXG4gIC8vIHRoaXMgaXMgYSB3ZWlyZCBmaXggd2hlbiBkb2luZyBtdWx0aXBsZSAudXNlKClcbiAgLy8gaWYgKHRoaXMuY2hhci53aWR0aCA9PT0gMClcbiAgdGhpcy5jaGFyLnNldChkb20uZ2V0Q2hhclNpemUoJCwgY3NzLmNvZGUpKTtcblxuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2MoKTtcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG4gIHRoaXMucGFnZS5zZXQodGhpcy5zaXplWydeLyddKHRoaXMuY2hhcikpO1xuICB0aGlzLnBhZ2VSZW1haW5kZXIuc2V0KHRoaXMuc2l6ZVsnLSddKHRoaXMucGFnZVsnXyonXSh0aGlzLmNoYXIpKSk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuICAvLyB0aGlzLmxvbmdlc3RMaW5lID0gTWF0aC5taW4oNTAwLCB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMb25nZXN0TGluZUxlbmd0aCgpKTtcblxuICB0aGlzLmd1dHRlciA9IE1hdGgubWF4KFxuICAgIHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWxcbiAgICAgID8gTWF0aC5tYXgoXG4gICAgICAgICAgKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICAgICAgICggdGhpcy5wYWdlLndpZHRoIC0gODFcbiAgICAgICAgICAtICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aClcbiAgICAgICAgICApIC8gMiB8IDBcbiAgICAgICAgKSA6IDApXG4gICAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiBNYXRoLm1heCgzLCAoJycrdGhpcy5yb3dzKS5sZW5ndGgpKVxuICApICogdGhpcy5jaGFyLndpZHRoXG4gICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3NcbiAgICAgID8gMFxuICAgICAgOiB0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbiAqICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWwgPyAtMSA6IDEpXG4gICAgKTtcblxuICB0aGlzLm1hcmdpbkxlZnQgPSB0aGlzLmd1dHRlciArIHRoaXMub3B0aW9ucy5tYXJnaW5fbGVmdDtcbiAgdGhpcy5jb2RlTGVmdCA9IHRoaXMubWFyZ2luTGVmdCArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgdGhpcy5oZWlnaHQgPSAodGhpcy5yb3dzICsgdGhpcy5wYWdlLmhlaWdodClcbiAgICAqIHRoaXMuY2hhci5oZWlnaHRcbiAgICArIHRoaXMucGFnZVJlbWFpbmRlci5oZWlnaHQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjJyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSB7XG4gICAgICB0b3A6ICR7dGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIDogMH1weDtcbiAgICB9XG5cbiAgICAuJHtjc3Mucm93c30sXG4gICAgLiR7Y3NzLm1hcmt9LFxuICAgIC4ke2Nzcy5jb2RlfSxcbiAgICBtYXJrLFxuICAgIHAsXG4gICAgdCxcbiAgICBrLFxuICAgIGQsXG4gICAgbixcbiAgICBvLFxuICAgIGUsXG4gICAgbSxcbiAgICBmLFxuICAgIHIsXG4gICAgYyxcbiAgICBzLFxuICAgIGwsXG4gICAgeCB7XG4gICAgICBmb250LWZhbWlseTogJ1JvYm90byBNb25vJywgbW9ub3NwYWNlO1xuICAgICAgZm9udC1zaXplOiAke3RoaXMub3B0aW9ucy5mb250X3NpemV9O1xuICAgICAgbGluZS1oZWlnaHQ6ICR7dGhpcy5vcHRpb25zLmxpbmVfaGVpZ2h0fTtcbiAgICB9XG5cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ydWxlcn0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuZmluZH0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubWFya30sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuY29kZX0ge1xuICAgICAgbWFyZ2luLWxlZnQ6ICR7dGhpcy5jb2RlTGVmdH1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJvd3N9IHtcbiAgICAgIHdpZHRoOiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuZmluZH0gPiBpLFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmJsb2NrfSA+IGkge1xuICAgICAgaGVpZ2h0OiAke3RoaXMuY2hhci5oZWlnaHQgKyAxfXB4O1xuICAgIH1cbiAgICB4IHtcbiAgICAgIGJhY2tncm91bmQtaW1hZ2U6IHVybCgke2RhdGFVUkx9KTtcbiAgICB9YFxuICApO1xuXG4gIHRoaXMuZW1pdCgncmVzaXplJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdGhpcy52aWV3c1tuYW1lXS5jbGVhcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24obmFtZSkge1xuICBjYW5jZWxBbmltYXRpb25GcmFtZSh0aGlzLnJlbmRlclJlcXVlc3QpO1xuICBpZiAodGhpcy5yZW5kZXJSZXF1ZXN0U3RhcnRlZEF0ID09PSAtMSkge1xuICAgIHRoaXMucmVuZGVyUmVxdWVzdFN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKERhdGUubm93KCkgLSB0aGlzLnJlbmRlclJlcXVlc3RTdGFydGVkQXQgPiAxMDApIHtcbiAgICAgIHRoaXMuX3JlbmRlcigpO1xuICAgIH1cbiAgfVxuICBpZiAoIX50aGlzLnJlbmRlclF1ZXVlLmluZGV4T2YobmFtZSkpIHtcbiAgICBpZiAobmFtZSBpbiB0aGlzLnZpZXdzKSB7XG4gICAgICB0aGlzLnJlbmRlclF1ZXVlLnB1c2gobmFtZSk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUmVxdWVzdCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLl9yZW5kZXIpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuX3JlbmRlciA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygncmVuZGVyJylcbiAgdGhpcy5yZW5kZXJSZXF1ZXN0U3RhcnRlZEF0ID0gLTE7XG4gIHRoaXMucmVuZGVyUXVldWUuZm9yRWFjaChuYW1lID0+IHRoaXMudmlld3NbbmFtZV0ucmVuZGVyKHtcbiAgICBvZmZzZXQ6IHtcbiAgICAgIGxlZnQ6IDAsXG4gICAgICB0b3A6IDBcbiAgICB9XG4gIH0pKTtcbiAgdGhpcy5yZW5kZXJRdWV1ZSA9IFtdO1xufTtcblxuLy8gdGhpcyBpcyB1c2VkIGZvciBkZXZlbG9wbWVudCBkZWJ1ZyBwdXJwb3Nlc1xuZnVuY3Rpb24gYmluZENhbGxTaXRlKGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgdmFyIGVyciA9IG5ldyBFcnJvcjtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnIsIGFyZ3VtZW50cy5jYWxsZWUpO1xuICAgIHZhciBzdGFjayA9IGVyci5zdGFjaztcbiAgICBjb25zb2xlLmxvZyhzdGFjayk7XG4gICAgZm4uY2FsbCh0aGlzLCBhLCBiLCBjLCBkKTtcbiAgfTtcbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBBcmVhO1xuXG5mdW5jdGlvbiBBcmVhKGEpIHtcbiAgaWYgKGEpIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50KGEuYmVnaW4pO1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50KGEuZW5kKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50O1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50O1xuICB9XG59XG5cbkFyZWEucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHRoaXMpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzID0gW3RoaXMuYmVnaW4sIHRoaXMuZW5kXS5zb3J0KFBvaW50LnNvcnQpO1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoc1swXSksXG4gICAgZW5kOiBuZXcgUG9pbnQoc1sxXSlcbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMuYmVnaW4uc2V0KGFyZWEuYmVnaW4pO1xuICB0aGlzLmVuZC5zZXQoYXJlYS5lbmQpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0TGVmdCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy5iZWdpbi54ID0geDtcbiAgdGhpcy5lbmQueCA9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIGlmICh0aGlzLmJlZ2luLngpIHRoaXMuYmVnaW4ueCArPSB4O1xuICBpZiAodGhpcy5lbmQueCkgdGhpcy5lbmQueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZEJvdHRvbSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5lbmQueSArPSB5O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLnNoaWZ0QnlMaW5lcyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5iZWdpbi55ICs9IHk7XG4gIHRoaXMuZW5kLnkgKz0geTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+IGEuZW5kLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj0nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5iZWdpbi54ID49IGEuYmVnaW4ueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzwnXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5lbmQueCA8IGEuYmVnaW4ueFxuICAgIDogdGhpcy5lbmQueSA8IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PSddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuZW5kLnggPD0gYS5lbmQueFxuICAgIDogdGhpcy5lbmQueSA8IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPjwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+J10oYSkgJiYgdGhpc1snPCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzwnXShhKSB8fCB0aGlzWyc+J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj08J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+PSddKGEpICYmIHRoaXNbJzw9J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPD0nXShhKSB8fCB0aGlzWyc+PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz09PSddID1cbkFyZWEucHJvdG90eXBlLmVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi54ID09PSBhLmJlZ2luLnggJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICAgICYmIHRoaXMuZW5kLnggICA9PT0gYS5lbmQueCAgICYmIHRoaXMuZW5kLnkgICA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PSddID1cbkFyZWEucHJvdG90eXBlLmJlZ2luTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXwnXSA9XG5BcmVhLnByb3RvdHlwZS5lbmRMaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9fCddID1cbkFyZWEucHJvdG90eXBlLmxpbmVzRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyd8PSddKGEpICYmIHRoaXNbJz18J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXw9J10gPVxuQXJlYS5wcm90b3R5cGUuc2FtZUxpbmUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IHRoaXMuZW5kLnkgJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnLXgtJ10gPVxuQXJlYS5wcm90b3R5cGUuc2hvcnRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54ICsgeCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54IC0geCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJyt4KyddID1cbkFyZWEucHJvdG90eXBlLndpZGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggLSB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggKyB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0KGIuYmVnaW4sIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0KGIuZW5kLCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WCh4LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFgoeCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFkgPSBmdW5jdGlvbih5LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFkoeSwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRZKHksIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgbGV0IGFyZWEgPSB0aGlzLmdldCgpXG4gIHJldHVybiAnJyArIGFyZWEuYmVnaW4gKyAnfCcgKyBhcmVhLmVuZDtcbn07XG5cbkFyZWEuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA9PT0gYi5iZWdpbi55XG4gICAgPyBhLmJlZ2luLnggLSBiLmJlZ2luLnhcbiAgICA6IGEuYmVnaW4ueSAtIGIuYmVnaW4ueTtcbn07XG5cbkFyZWEudG9Qb2ludFNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPD0gYi55ICYmIGEuZW5kLnkgPj0gYi55XG4gICAgPyBhLmJlZ2luLnkgPT09IGIueVxuICAgICAgPyBhLmJlZ2luLnggLSBiLnhcbiAgICAgIDogYS5lbmQueSA9PT0gYi55XG4gICAgICAgID8gYS5lbmQueCAtIGIueFxuICAgICAgICA6IDBcbiAgICA6IGEuYmVnaW4ueSAtIGIueTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gYmluYXJ5U2VhcmNoO1xuXG5mdW5jdGlvbiBiaW5hcnlTZWFyY2goYXJyYXksIGNvbXBhcmUpIHtcbiAgdmFyIGluZGV4ID0gLTE7XG4gIHZhciBwcmV2ID0gLTE7XG4gIHZhciBsb3cgPSAwO1xuICB2YXIgaGlnaCA9IGFycmF5Lmxlbmd0aDtcbiAgaWYgKCFoaWdoKSByZXR1cm4ge1xuICAgIGl0ZW06IG51bGwsXG4gICAgaW5kZXg6IDBcbiAgfTtcblxuICBkbyB7XG4gICAgcHJldiA9IGluZGV4O1xuICAgIGluZGV4ID0gbG93ICsgKGhpZ2ggLSBsb3cgPj4gMSk7XG4gICAgdmFyIGl0ZW0gPSBhcnJheVtpbmRleF07XG4gICAgdmFyIHJlc3VsdCA9IGNvbXBhcmUoaXRlbSk7XG5cbiAgICBpZiAocmVzdWx0KSBsb3cgPSBpbmRleDtcbiAgICBlbHNlIGhpZ2ggPSBpbmRleDtcbiAgfSB3aGlsZSAocHJldiAhPT0gaW5kZXgpO1xuXG4gIGlmIChpdGVtICE9IG51bGwpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXRlbTogaXRlbSxcbiAgICAgIGluZGV4OiBpbmRleFxuICAgIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGl0ZW06IG51bGwsXG4gICAgaW5kZXg6IH5sb3cgKiAtMSAtIDFcbiAgfTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4pIHtcbiAgdmFyIHJlcXVlc3Q7XG4gIHJldHVybiBmdW5jdGlvbiByYWZXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUocmVxdWVzdCk7XG4gICAgcmVxdWVzdCA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSk7XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEJveDtcblxuZnVuY3Rpb24gQm94KGIpIHtcbiAgaWYgKGIpIHtcbiAgICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xuICB9IGVsc2Uge1xuICAgIHRoaXMud2lkdGggPSAwO1xuICAgIHRoaXMuaGVpZ2h0ID0gMDtcbiAgfVxufVxuXG5Cb3gucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGIpIHtcbiAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG59O1xuXG5Cb3gucHJvdG90eXBlWycvJ10gPVxuQm94LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18vJ10gPVxuQm94LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeLyddID1cbkJveC5wcm90b3R5cGUuY2VpbGRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXionXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ28qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5yb3VuZCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGgucm91bmQodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnLSddID1cbkJveC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLSAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAtIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNsb25lKG9iaikge1xuICB2YXIgbyA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgdmFyIHZhbCA9IG9ialtrZXldO1xuICAgIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIHZhbCkge1xuICAgICAgb1trZXldID0gY2xvbmUodmFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb1trZXldID0gdmFsO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbiBkZWJvdW5jZVdyYXAoYSwgYiwgYywgZCkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICB0aW1lb3V0ID0gc2V0VGltZW91dChmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpLCBtcyk7XG4gICAgcmV0dXJuIHRpbWVvdXQ7XG4gIH1cbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vZG9tJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9ldmVudCcpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlhbG9nO1xuXG5mdW5jdGlvbiBEaWFsb2cobGFiZWwsIGtleW1hcCkge1xuICB0aGlzLm5vZGUgPSBkb20oY3NzLmRpYWxvZywgW1xuICAgIGA8bGFiZWw+JHtjc3MubGFiZWx9YCxcbiAgICBbY3NzLmlucHV0LCBbXG4gICAgICBgPGlucHV0PiR7Y3NzLnRleHR9YCxcbiAgICAgIGNzcy5pbmZvXG4gICAgXV1cbiAgXSk7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MubGFiZWxdLCBsYWJlbCk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogJ25vbmUnIH0pO1xuICB0aGlzLmtleW1hcCA9IGtleW1hcDtcbiAgdGhpcy5vbmJvZHlrZXlkb3duID0gdGhpcy5vbmJvZHlrZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmNsaWNrID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNldXAgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2Vkb3duID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xufVxuXG5EaWFsb2cucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuZnVuY3Rpb24gc3RvcFByb3BhZ2F0aW9uKGUpIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaGFzRm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLmhhc0ZvY3VzKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uYm9keWtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgyNyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDEzID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuc3VibWl0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChlLndoaWNoIGluIHRoaXMua2V5bWFwKSB7XG4gICAgdGhpcy5lbWl0KCdrZXknLCBlKTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3ZhbHVlJywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICBkb20uYXBwZW5kKGRvY3VtZW50LmJvZHksIHRoaXMubm9kZSk7XG4gIGRvbS5mb2N1cyh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0pO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwuc2VsZWN0KCk7XG4gIHRoaXMuaXNPcGVuID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdvcGVuJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIHRoaXMubm9kZS5lbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMubm9kZS5lbCk7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG4gIHRoaXMuZW1pdCgnY2xvc2UnKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuc3VibWl0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZW1pdCgnc3VibWl0JywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaW5mbyA9IGZ1bmN0aW9uKGluZm8pIHtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCBpbmZvKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiBpbmZvID8gJ2Jsb2NrJyA6ICdub25lJyB9KTtcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImRpYWxvZ1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2RpYWxvZ1wiLFwiaW5wdXRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbnB1dFwiLFwidGV4dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX3RleHRcIixcImxhYmVsXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fbGFiZWxcIixcImluZm9cIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbmZvXCJ9IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG5cbmZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBhKSB7XG4gICAgdmFyIGQgPSB7fTtcbiAgICB2YXIgaSA9IDA7XG4gICAgZm9yICh2YXIgayBpbiBiKSB7XG4gICAgICBpZiAoYVtrXSAhPT0gYltrXSkge1xuICAgICAgICBkW2tdID0gYltrXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaSkgcmV0dXJuIGQ7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGEgIT09IGI7XG4gIH1cbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9iaW5kLXJhZicpO1xudmFyIG1lbW9pemUgPSByZXF1aXJlKCcuL21lbW9pemUnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxudmFyIHVuaXRzID0ge1xuICBsZWZ0OiAncHgnLFxuICB0b3A6ICdweCcsXG4gIHJpZ2h0OiAncHgnLFxuICBib3R0b206ICdweCcsXG4gIHdpZHRoOiAncHgnLFxuICBoZWlnaHQ6ICdweCcsXG4gIG1heEhlaWdodDogJ3B4JyxcbiAgcGFkZGluZ0xlZnQ6ICdweCcsXG4gIGxpbmVIZWlnaHQ6ICdweCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRvbTtcblxuZnVuY3Rpb24gZG9tKG5hbWUsIGNoaWxkcmVuLCBhdHRycykge1xuICB2YXIgZWw7XG4gIHZhciB0YWcgPSAnZGl2JztcbiAgdmFyIG5vZGU7XG5cbiAgaWYgKCdzdHJpbmcnID09PSB0eXBlb2YgbmFtZSkge1xuICAgIGlmICgnPCcgPT09IG5hbWUuY2hhckF0KDApKSB7XG4gICAgICB2YXIgbWF0Y2hlcyA9IG5hbWUubWF0Y2goLyg/OjwpKC4qKSg/Oj4pKFxcUyspPy8pO1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGFnID0gbWF0Y2hlc1sxXTtcbiAgICAgICAgbmFtZSA9IG1hdGNoZXNbMl0gfHwgdGFnO1xuICAgICAgfVxuICAgIH1cbiAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgICBub2RlID0ge1xuICAgICAgZWw6IGVsLFxuICAgICAgbmFtZTogbmFtZS5zcGxpdCgnICcpWzBdXG4gICAgfTtcbiAgICBkb20uY2xhc3Nlcyhub2RlLCBuYW1lLnNwbGl0KCcgJykuc2xpY2UoMSkpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICByZXR1cm4gZG9tLmFwcGx5KG51bGwsIG5hbWUpO1xuICB9IGVsc2Uge1xuICAgIGlmICgnZG9tJyBpbiBuYW1lKSB7XG4gICAgICBub2RlID0gbmFtZS5kb207XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUgPSBuYW1lO1xuICAgIH1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGNoaWxkcmVuKSkge1xuICAgIGNoaWxkcmVuXG4gICAgICAubWFwKGRvbSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQsIGkpIHtcbiAgICAgICAgbm9kZVtjaGlsZC5uYW1lXSA9IGNoaWxkO1xuICAgICAgICByZXR1cm4gY2hpbGQ7XG4gICAgICB9KVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCkge1xuICAgICAgICBub2RlLmVsLmFwcGVuZENoaWxkKGNoaWxkLmVsKTtcbiAgICAgIH0pO1xuICB9IGVsc2UgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgY2hpbGRyZW4pIHtcbiAgICBkb20uc3R5bGUobm9kZSwgY2hpbGRyZW4pO1xuICB9XG5cbiAgaWYgKGF0dHJzKSB7XG4gICAgZG9tLmF0dHJzKG5vZGUsIGF0dHJzKTtcbiAgfVxuXG4gIHJldHVybiBub2RlO1xufVxuXG5kb20uc3R5bGUgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBfLCBzdHlsZSkge1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgaWYgKHN0eWxlW25hbWVdICE9PSAnYXV0bycpXG4gICAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59LCBkaWZmLCBtZXJnZSwgZnVuY3Rpb24obm9kZSwgc3R5bGUpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIHN0eWxlXTtcbn0pO1xuXG4vKlxuZG9tLnN0eWxlID0gZnVuY3Rpb24oZWwsIHN0eWxlKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn07XG4qL1xuZG9tLmNsYXNzZXMgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xufSwgbnVsbCwgbnVsbCwgZnVuY3Rpb24obm9kZSwgY2xhc3Nlcykge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgY2xhc3Nlcy5jb25jYXQobm9kZS5uYW1lKS5maWx0ZXIoQm9vbGVhbikuam9pbignICcpXTtcbn0pO1xuXG5kb20uYXR0cnMgPSBmdW5jdGlvbihlbCwgYXR0cnMpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIE9iamVjdC5hc3NpZ24oZWwsIGF0dHJzKTtcbn07XG5cbmRvbS5odG1sID0gZnVuY3Rpb24oZWwsIGh0bWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XG59O1xuXG5kb20udGV4dCA9IGZ1bmN0aW9uKGVsLCB0ZXh0KSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC50ZXh0Q29udGVudCA9IHRleHQ7XG59O1xuXG5kb20uZm9jdXMgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuZm9jdXMoKTtcbn07XG5cbmRvbS5nZXRTaXplID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiB7XG4gICAgd2lkdGg6IGVsLmNsaWVudFdpZHRoLFxuICAgIGhlaWdodDogZWwuY2xpZW50SGVpZ2h0XG4gIH07XG59O1xuXG5kb20uZ2V0Q2hhclNpemUgPSBmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgc3Bhbi5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG5cbiAgZWwuYXBwZW5kQ2hpbGQoc3Bhbik7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnJm5ic3A7JztcbiAgdmFyIGEgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyZuYnNwOyZuYnNwO1xcbiZuYnNwOyc7XG4gIHZhciBiID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBlbC5yZW1vdmVDaGlsZChzcGFuKTtcblxuICByZXR1cm4ge1xuICAgIHdpZHRoOiAoYi53aWR0aCAtIGEud2lkdGgpLFxuICAgIGhlaWdodDogKGIuaGVpZ2h0IC0gYS5oZWlnaHQpXG4gIH07XG59O1xuXG5kb20uZ2V0T2Zmc2V0ID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgdmFyIGJvcmRlckxlZnQgPSBwYXJzZUludChzdHlsZS5ib3JkZXJMZWZ0V2lkdGgpO1xuICB2YXIgYm9yZGVyVG9wID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyVG9wV2lkdGgpO1xuICByZXR1cm4gUG9pbnQubG93KHsgeDogMCwgeTogMCB9LCB7XG4gICAgeDogKHJlY3QubGVmdCArIGJvcmRlckxlZnQpIHwgMCxcbiAgICB5OiAocmVjdC50b3AgKyBib3JkZXJUb3ApIHwgMFxuICB9KTtcbn07XG5cbmRvbS5nZXRTY3JvbGwgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIGdldFNjcm9sbChlbCk7XG59O1xuXG5kb20ub25zY3JvbGwgPSBmdW5jdGlvbiBvbnNjcm9sbChlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG5cbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH0gZWxzZSB7XG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVyKGV2KSB7XG4gICAgZm4oZ2V0U2Nyb2xsKGVsKSk7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gb2Zmc2Nyb2xsKCkge1xuICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG59O1xuXG5kb20ub253aGVlbCA9IGZ1bmN0aW9uIG9ud2hlZWwoZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuXG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3doZWVsJywgaGFuZGxlcik7XG4gIH0gZWxzZSB7XG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignd2hlZWwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihldik7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gb2Zmd2hlZWwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignd2hlZWwnLCBoYW5kbGVyKTtcbiAgfVxufTtcblxuZG9tLm9ub2Zmc2V0ID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB3aGlsZSAoZWwgPSBlbC5vZmZzZXRQYXJlbnQpIHtcbiAgICBkb20ub25zY3JvbGwoZWwsIGZuKTtcbiAgfVxufTtcblxuZG9tLm9uY2xpY2sgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgcmV0dXJuIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZm4pO1xufTtcblxuZG9tLm9ucmVzaXplID0gZnVuY3Rpb24oZm4pIHtcbiAgcmV0dXJuIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG59O1xuXG5kb20uYXBwZW5kID0gZnVuY3Rpb24odGFyZ2V0LCBzcmMsIGRpY3QpIHtcbiAgdGFyZ2V0ID0gZG9tLmdldEVsZW1lbnQodGFyZ2V0KTtcbiAgaWYgKCdmb3JFYWNoJyBpbiBzcmMpIHNyYy5mb3JFYWNoKGRvbS5hcHBlbmQuYmluZChudWxsLCB0YXJnZXQpKTtcbiAgLy8gZWxzZSBpZiAoJ3ZpZXdzJyBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmMudmlld3MsIHRydWUpO1xuICBlbHNlIGlmIChkaWN0ID09PSB0cnVlKSBmb3IgKHZhciBrZXkgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjW2tleV0pO1xuICBlbHNlIGlmICgnZnVuY3Rpb24nICE9IHR5cGVvZiBzcmMpIHRhcmdldC5hcHBlbmRDaGlsZChkb20uZ2V0RWxlbWVudChzcmMpKTtcbn07XG5cbmRvbS5yZW1vdmUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgaWYgKGVsLnBhcmVudE5vZGUpIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpO1xufTtcblxuZG9tLmdldEVsZW1lbnQgPSBmdW5jdGlvbihlbCkge1xuICByZXR1cm4gZWwuZG9tICYmIGVsLmRvbS5lbCB8fCBlbC5lbCB8fCBlbC5ub2RlIHx8IGVsO1xufTtcblxuZG9tLnNjcm9sbEJ5ID0gZnVuY3Rpb24oZWwsIHgsIHksIHNjcm9sbCkge1xuICBzY3JvbGwgPSBzY3JvbGwgfHwgZG9tLmdldFNjcm9sbChlbCk7XG4gIGRvbS5zY3JvbGxUbyhlbCwgc2Nyb2xsLnggKyB4LCBzY3JvbGwueSArIHkpO1xufTtcblxuZG9tLnNjcm9sbFRvID0gZnVuY3Rpb24oZWwsIHgsIHkpIHtcbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgd2luZG93LnNjcm9sbFRvKHgsIHkpO1xuICB9IGVsc2Uge1xuICAgIGVsLnNjcm9sbExlZnQgPSB4IHx8IDA7XG4gICAgZWwuc2Nyb2xsVG9wID0geSB8fCAwO1xuICB9XG59O1xuXG5kb20uY3NzID0gZnVuY3Rpb24oaWQsIGNzc1RleHQpIHtcbiAgaWYgKCEoaWQgaW4gZG9tLmNzcy5zdHlsZXMpKSB7XG4gICAgZG9tLmNzcy5zdHlsZXNbaWRdID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvbS5jc3Muc3R5bGVzW2lkXSk7XG4gIH1cbiAgZG9tLmNzcy5zdHlsZXNbaWRdLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn07XG5cbmRvbS5jc3Muc3R5bGVzID0ge307XG5cbmRvbS5nZXRNb3VzZVBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcblxuZnVuY3Rpb24gZ2V0U2Nyb2xsKGVsKSB7XG4gIHJldHVybiBkb2N1bWVudC5ib2R5ID09PSBlbFxuICAgID8ge1xuICAgICAgICB4OiB3aW5kb3cuc2Nyb2xsWCB8fCBlbC5zY3JvbGxMZWZ0IHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxMZWZ0LFxuICAgICAgICB5OiB3aW5kb3cuc2Nyb2xsWSB8fCBlbC5zY3JvbGxUb3AgIHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxUb3BcbiAgICAgIH1cbiAgICA6IHtcbiAgICAgICAgeDogZWwuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogZWwuc2Nyb2xsVG9wXG4gICAgICB9O1xufVxuIiwiXG52YXIgcHVzaCA9IFtdLnB1c2g7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxubW9kdWxlLmV4cG9ydHMgPSBFdmVudDtcblxuZnVuY3Rpb24gRXZlbnQoKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBFdmVudCkpIHJldHVybiBuZXcgRXZlbnQ7XG5cbiAgdGhpcy5faGFuZGxlcnMgPSB7fTtcbn1cblxuRXZlbnQucHJvdG90eXBlLl9nZXRIYW5kbGVycyA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdGhpcy5faGFuZGxlcnMgPSB0aGlzLl9oYW5kbGVycyB8fCB7fTtcbiAgcmV0dXJuIHRoaXMuX2hhbmRsZXJzW25hbWVdID0gdGhpcy5faGFuZGxlcnNbbmFtZV0gfHwgW107XG59O1xuXG5FdmVudC5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKG5hbWUsIGEsIGIsIGMsIGQpIHtcbiAgaWYgKHRoaXMuc2lsZW50KSByZXR1cm5cbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgaGFuZGxlcnMubGVuZ3RoOyBpKyspIHtcbiAgICBoYW5kbGVyc1tpXShhLCBiLCBjLCBkKTtcbiAgfTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGhhbmRsZXJzO1xuICB2YXIgbmV3SGFuZGxlcnMgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgbmFtZS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgICBwdXNoLmFwcGx5KGhhbmRsZXJzLCBuZXdIYW5kbGVyc1tuYW1lXSk7XG4gICAgfSwgdGhpcyk7XG4gIH0gZWxzZSB7XG4gICAgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgICBwdXNoLmFwcGx5KGhhbmRsZXJzLCBuZXdIYW5kbGVycyk7XG4gIH1cbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vZmYgPSBmdW5jdGlvbihuYW1lLCBoYW5kbGVyKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICB2YXIgaW5kZXggPSBoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpO1xuICBpZiAofmluZGV4KSBoYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xufTtcblxuRXZlbnQucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbihuYW1lLCBmbikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgZm4oYSwgYiwgYywgZCk7XG4gICAgaGFuZGxlcnMuc3BsaWNlKGhhbmRsZXJzLmluZGV4T2YoaGFuZGxlciksIDEpO1xuICB9O1xuICBoYW5kbGVycy5wdXNoKGhhbmRsZXIpO1xufTtcbiIsInZhciBjbG9uZSA9IHJlcXVpcmUoJy4vY2xvbmUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZW1vaXplKGZuLCBkaWZmLCBtZXJnZSwgcHJlKSB7XG4gIGRpZmYgPSBkaWZmIHx8IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEgIT09IGIgfTtcbiAgbWVyZ2UgPSBtZXJnZSB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBiIH07XG4gIHByZSA9IHByZSB8fCBmdW5jdGlvbihub2RlLCBwYXJhbSkgeyByZXR1cm4gcGFyYW0gfTtcblxuICB2YXIgbm9kZXMgPSBbXTtcbiAgdmFyIGNhY2hlID0gW107XG4gIHZhciByZXN1bHRzID0gW107XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKG5vZGUsIHBhcmFtKSB7XG4gICAgdmFyIGFyZ3MgPSBwcmUobm9kZSwgcGFyYW0pO1xuICAgIG5vZGUgPSBhcmdzWzBdO1xuICAgIHBhcmFtID0gYXJnc1sxXTtcblxuICAgIHZhciBpbmRleCA9IG5vZGVzLmluZGV4T2Yobm9kZSk7XG4gICAgaWYgKH5pbmRleCkge1xuICAgICAgdmFyIGQgPSBkaWZmKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgaWYgKCFkKSByZXR1cm4gcmVzdWx0c1tpbmRleF07XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2FjaGVbaW5kZXhdID0gbWVyZ2UoY2FjaGVbaW5kZXhdLCBwYXJhbSk7XG4gICAgICAgIHJlc3VsdHNbaW5kZXhdID0gZm4obm9kZSwgcGFyYW0sIGQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjYWNoZS5wdXNoKGNsb25lKHBhcmFtKSk7XG4gICAgICBub2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgaW5kZXggPSByZXN1bHRzLnB1c2goZm4obm9kZSwgcGFyYW0sIHBhcmFtKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZXJnZShkZXN0LCBzcmMpIHtcbiAgZm9yICh2YXIga2V5IGluIHNyYykge1xuICAgIGRlc3Rba2V5XSA9IHNyY1trZXldO1xuICB9XG4gIHJldHVybiBkZXN0O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBvcGVuO1xuXG5mdW5jdGlvbiBvcGVuKHVybCwgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybClcbiAgICAudGhlbihnZXRUZXh0KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cblxuZnVuY3Rpb24gZ2V0VGV4dChyZXMpIHtcbiAgcmV0dXJuIHJlcy50ZXh0KCk7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gUG9pbnQ7XG5cbmZ1bmN0aW9uIFBvaW50KHApIHtcbiAgaWYgKHApIHtcbiAgICB0aGlzLnggPSBwLng7XG4gICAgdGhpcy55ID0gcC55O1xuICB9IGVsc2Uge1xuICAgIHRoaXMueCA9IDA7XG4gICAgdGhpcy55ID0gMDtcbiAgfVxufVxuXG5Qb2ludC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLnggPSBwLng7XG4gIHRoaXMueSA9IHAueTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUG9pbnQodGhpcyk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLyddID1cblBvaW50LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfLyddID1cblBvaW50LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnby8nXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmREaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeLyddID1cblBvaW50LnByb3RvdHlwZS5jZWlsRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJysnXSA9XG5Qb2ludC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICsgKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLSddID1cblBvaW50LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAtIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLSAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycqJ10gPVxuUG9pbnQucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14qJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnbyonXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmRNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfKiddID1cblBvaW50LnByb3RvdHlwZS5mbG9vck11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5sZXJwID0gZnVuY3Rpb24ocCwgYSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKyAoKHAueCAtIHRoaXMueCkgKiBhKSxcbiAgICB5OiB0aGlzLnkgKyAoKHAueSAtIHRoaXMueSkgKiBhKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy54ICsgJywnICsgdGhpcy55O1xufTtcblxuUG9pbnQuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblBvaW50LmdyaWRSb3VuZCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLnJvdW5kKGEueCAvIGIud2lkdGgpLFxuICAgIHk6IE1hdGgucm91bmQoYS55IC8gYi5oZWlnaHQpXG4gIH07XG59O1xuXG5Qb2ludC5sb3cgPSBmdW5jdGlvbihsb3csIHApIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLm1heChsb3cueCwgcC54KSxcbiAgICB5OiBNYXRoLm1heChsb3cueSwgcC55KVxuICB9O1xufTtcblxuUG9pbnQuY2xhbXAgPSBmdW5jdGlvbihhcmVhLCBwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGFyZWEuZW5kLngsIE1hdGgubWF4KGFyZWEuYmVnaW4ueCwgcC54KSksXG4gICAgeTogTWF0aC5taW4oYXJlYS5lbmQueSwgTWF0aC5tYXgoYXJlYS5iZWdpbi55LCBwLnkpKVxuICB9KTtcbn07XG5cblBvaW50Lm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHsgeDogYS54ICsgYi54LCB5OiBhLnkgKyBiLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFggPSBmdW5jdGlvbih4LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCArIHgsIHk6IHAueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIHApIHtcbiAgcmV0dXJuIHsgeDogcC54LCB5OiBwLnkgKyB5IH07XG59O1xuXG5Qb2ludC50b0xlZnRUb3AgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiB7XG4gICAgbGVmdDogcC54LFxuICAgIHRvcDogcC55XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEFORDtcblxuZnVuY3Rpb24gQU5EKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IE5PVDtcblxuZnVuY3Rpb24gTk9UKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsInZhciBBTkQgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtYW5kJyk7XG52YXIgTk9UID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLW5vdCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJhbmdlO1xuXG5mdW5jdGlvbiBSYW5nZShyKSB7XG4gIGlmIChyKSB7XG4gICAgdGhpc1swXSA9IHJbMF07XG4gICAgdGhpc1sxXSA9IHJbMV07XG4gIH0gZWxzZSB7XG4gICAgdGhpc1swXSA9IDA7XG4gICAgdGhpc1sxXSA9IDE7XG4gIH1cbn07XG5cblJhbmdlLkFORCA9IEFORDtcblJhbmdlLk5PVCA9IE5PVDtcblxuUmFuZ2Uuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblJhbmdlLmVxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYVswXSA9PT0gYlswXSAmJiBhWzFdID09PSBiWzFdO1xufTtcblxuUmFuZ2UuY2xhbXAgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UoW1xuICAgIE1hdGgubWluKGJbMV0sIE1hdGgubWF4KGFbMF0sIGJbMF0pKSxcbiAgICBNYXRoLm1pbihhWzFdLCBiWzFdKVxuICBdKTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFJhbmdlKHRoaXMpO1xufTtcblxuUmFuZ2UucmFuZ2VzID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbihpdGVtKSB7IHJldHVybiBpdGVtLnJhbmdlIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdID49IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPD0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm92ZXJsYXAgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA8PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdID49IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMV0gPCByYW5nZVswXSB8fCBpdGVtLnJhbmdlWzBdID4gcmFuZ2VbMV07XG4gIH0pO1xufTtcbiIsIlxudmFyIFJlZ2V4cCA9IGV4cG9ydHM7XG5cblJlZ2V4cC5jcmVhdGUgPSBmdW5jdGlvbihuYW1lcywgZmxhZ3MsIGZuKSB7XG4gIGZuID0gZm4gfHwgZnVuY3Rpb24ocykgeyByZXR1cm4gcyB9O1xuICByZXR1cm4gbmV3IFJlZ0V4cChcbiAgICBuYW1lc1xuICAgIC5tYXAoKG4pID0+ICdzdHJpbmcnID09PSB0eXBlb2YgbiA/IFJlZ2V4cC50eXBlc1tuXSA6IG4pXG4gICAgLm1hcCgocikgPT4gZm4oci50b1N0cmluZygpLnNsaWNlKDEsLTEpKSlcbiAgICAuam9pbignfCcpLFxuICAgIGZsYWdzXG4gICk7XG59O1xuXG5SZWdleHAudHlwZXMgPSB7XG4gICd0b2tlbnMnOiAvLis/XFxifC5cXEJ8XFxiLis/LyxcbiAgJ3dvcmRzJzogL1thLXpBLVowLTldezEsfS8sXG4gICdwYXJ0cyc6IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvLFxuXG4gICdzaW5nbGUgY29tbWVudCc6IC9cXC9cXC8uKj8kLyxcbiAgJ2RvdWJsZSBjb21tZW50JzogL1xcL1xcKlteXSo/XFwqXFwvLyxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiAvKCcoPzooPzpcXFxcXFxufFxcXFwnfFteJ1xcbl0pKSo/JykvLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IC8oXCIoPzooPzpcXFxcXFxufFxcXFxcInxbXlwiXFxuXSkpKj9cIikvLFxuICAndGVtcGxhdGUgc3RyaW5nJzogLyhgKD86KD86XFxcXGB8W15gXSkpKj9gKS8sXG5cbiAgJ29wZXJhdG9yJzogLyF8Pj0/fDw9P3w9ezEsM318KD86Jil7MSwyfXxcXHw/XFx8fFxcP3xcXCp8XFwvfH58XFxefCV8XFwuKD8hXFxkKXxcXCt7MSwyfXxcXC17MSwyfS8sXG4gICdmdW5jdGlvbic6IC8gKCg/IVxcZHxbLiBdKj8oaWZ8ZWxzZXxkb3xmb3J8Y2FzZXx0cnl8Y2F0Y2h8d2hpbGV8d2l0aHxzd2l0Y2gpKVthLXpBLVowLTlfICRdKykoPz1cXCguKlxcKS4qeykvLFxuICAna2V5d29yZCc6IC9cXGIoYnJlYWt8Y2FzZXxjYXRjaHxjb25zdHxjb250aW51ZXxkZWJ1Z2dlcnxkZWZhdWx0fGRlbGV0ZXxkb3xlbHNlfGV4cG9ydHxleHRlbmRzfGZpbmFsbHl8Zm9yfGZyb218aWZ8aW1wbGVtZW50c3xpbXBvcnR8aW58aW5zdGFuY2VvZnxpbnRlcmZhY2V8bGV0fG5ld3xwYWNrYWdlfHByaXZhdGV8cHJvdGVjdGVkfHB1YmxpY3xyZXR1cm58c3RhdGljfHN1cGVyfHN3aXRjaHx0aHJvd3x0cnl8dHlwZW9mfHdoaWxlfHdpdGh8eWllbGQpXFxiLyxcbiAgJ2RlY2xhcmUnOiAvXFxiKGZ1bmN0aW9ufGludGVyZmFjZXxjbGFzc3x2YXJ8bGV0fGNvbnN0fGVudW18dm9pZClcXGIvLFxuICAnYnVpbHRpbic6IC9cXGIoT2JqZWN0fEZ1bmN0aW9ufEJvb2xlYW58RXJyb3J8RXZhbEVycm9yfEludGVybmFsRXJyb3J8UmFuZ2VFcnJvcnxSZWZlcmVuY2VFcnJvcnxTdG9wSXRlcmF0aW9ufFN5bnRheEVycm9yfFR5cGVFcnJvcnxVUklFcnJvcnxOdW1iZXJ8TWF0aHxEYXRlfFN0cmluZ3xSZWdFeHB8QXJyYXl8RmxvYXQzMkFycmF5fEZsb2F0NjRBcnJheXxJbnQxNkFycmF5fEludDMyQXJyYXl8SW50OEFycmF5fFVpbnQxNkFycmF5fFVpbnQzMkFycmF5fFVpbnQ4QXJyYXl8VWludDhDbGFtcGVkQXJyYXl8QXJyYXlCdWZmZXJ8RGF0YVZpZXd8SlNPTnxJbnRsfGFyZ3VtZW50c3xjb25zb2xlfHdpbmRvd3xkb2N1bWVudHxTeW1ib2x8U2V0fE1hcHxXZWFrU2V0fFdlYWtNYXB8UHJveHl8UmVmbGVjdHxQcm9taXNlKVxcYi8sXG4gICdzcGVjaWFsJzogL1xcYih0cnVlfGZhbHNlfG51bGx8dW5kZWZpbmVkKVxcYi8sXG4gICdwYXJhbXMnOiAvZnVuY3Rpb25bIFxcKF17MX1bXl0qP1xcey8sXG4gICdudW1iZXInOiAvLT9cXGIoMHhbXFxkQS1GYS1mXSt8XFxkKlxcLj9cXGQrKFtFZV1bKy1dP1xcZCspP3xOYU58LT9JbmZpbml0eSlcXGIvLFxuICAnc3ltYm9sJzogL1t7fVtcXF0oKSw6XS8sXG4gICdyZWdleHAnOiAvKD8hW15cXC9dKShcXC8oPyFbXFwvfFxcKl0pLio/W15cXFxcXFxeXVxcLykoWztcXG5cXC5cXClcXF1cXH0gZ2ltXSkvLFxuXG4gICd4bWwnOiAvPFtePl0qPi8sXG4gICd1cmwnOiAvKChcXHcrOlxcL1xcLylbLWEtekEtWjAtOTpAOz8mPVxcLyVcXCtcXC5cXCohJ1xcKFxcKSxcXCRfXFx7XFx9XFxeflxcW1xcXWAjfF0rKS8sXG4gICdpbmRlbnQnOiAvXiArfF5cXHQrLyxcbiAgJ2xpbmUnOiAvXi4rJHxeXFxuLyxcbiAgJ25ld2xpbmUnOiAvXFxyXFxufFxccnxcXG4vLFxufTtcblxuUmVnZXhwLnR5cGVzLmNvbW1lbnQgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBjb21tZW50JyxcbiAgJ2RvdWJsZSBjb21tZW50Jyxcbl0pO1xuXG5SZWdleHAudHlwZXMuc3RyaW5nID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbl0pO1xuXG5SZWdleHAudHlwZXMubXVsdGlsaW5lID0gUmVnZXhwLmNyZWF0ZShbXG4gICdkb3VibGUgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuICAnaW5kZW50JyxcbiAgJ2xpbmUnXG5dKTtcblxuUmVnZXhwLnBhcnNlID0gZnVuY3Rpb24ocywgcmVnZXhwLCBmaWx0ZXIpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIGlmIChmaWx0ZXIpIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICBpZiAoZmlsdGVyKHdvcmQpKSB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gc2F2ZTtcblxuZnVuY3Rpb24gc2F2ZSh1cmwsIHNyYywgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBib2R5OiBzcmMsXG4gICAgfSlcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG4iLCIvLyBOb3RlOiBZb3UgcHJvYmFibHkgZG8gbm90IHdhbnQgdG8gdXNlIHRoaXMgaW4gcHJvZHVjdGlvbiBjb2RlLCBhcyBQcm9taXNlIGlzXG4vLyAgIG5vdCBzdXBwb3J0ZWQgYnkgYWxsIGJyb3dzZXJzIHlldC5cblxuKGZ1bmN0aW9uKCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgaWYgKHdpbmRvdy5zZXRJbW1lZGlhdGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwZW5kaW5nID0ge30sXG4gICAgICAgIG5leHRIYW5kbGUgPSAxO1xuXG4gICAgZnVuY3Rpb24gb25SZXNvbHZlKGhhbmRsZSkge1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgICAgIGNhbGxiYWNrLmZuLmFwcGx5KG51bGwsIGNhbGxiYWNrLmFyZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd2luZG93LnNldEltbWVkaWF0ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgICAgIGhhbmRsZTtcblxuICAgICAgICBpZiAodHlwZW9mIGZuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnZhbGlkIGZ1bmN0aW9uXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaGFuZGxlID0gbmV4dEhhbmRsZSsrO1xuICAgICAgICBwZW5kaW5nW2hhbmRsZV0gPSB7IGZuOiBmbiwgYXJnczogYXJncyB9O1xuXG4gICAgICAgIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaGFuZGxlKTtcbiAgICAgICAgfSkudGhlbihvblJlc29sdmUpO1xuXG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcblxuICAgIHdpbmRvdy5jbGVhckltbWVkaWF0ZSA9IGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgIH07XG59KCkpOyIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHJ1bm5pbmcsIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMpIHtcbiAgICBpZiAocnVubmluZykgcmV0dXJuO1xuICAgIHJ1bm5pbmcgPSB0cnVlO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYyk7XG4gICAgc2V0VGltZW91dChyZXNldCwgbXMpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlc2V0KCkge1xuICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgfVxufTtcbiIsInZhciBBcmVhID0gcmVxdWlyZSgnLi4vLi4vbGliL2FyZWEnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xuXG52YXIgU2tpcFN0cmluZyA9IHJlcXVpcmUoJy4vc2tpcHN0cmluZycpO1xudmFyIFByZWZpeFRyZWUgPSByZXF1aXJlKCcuL3ByZWZpeHRyZWUnKTtcbnZhciBTZWdtZW50cyA9IHJlcXVpcmUoJy4vc2VnbWVudHMnKTtcbnZhciBJbmRleGVyID0gcmVxdWlyZSgnLi9pbmRleGVyJyk7XG52YXIgVG9rZW5zID0gcmVxdWlyZSgnLi90b2tlbnMnKTtcbnZhciBTeW50YXggPSByZXF1aXJlKCcuL3N5bnRheCcpO1xuXG52YXIgRU9MID0gL1xcclxcbnxcXHJ8XFxuL2c7XG52YXIgTkVXTElORSA9IC9cXG4vZztcbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd0b2tlbnMnXSwgJ2cnKTtcblxudmFyIFNFR01FTlQgPSB7XG4gICdjb21tZW50JzogJy8qJyxcbiAgJ3N0cmluZyc6ICdgJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQnVmZmVyO1xuXG5mdW5jdGlvbiBCdWZmZXIoKSB7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMuc3ludGF4ID0gbmV3IFN5bnRheDtcbiAgdGhpcy5pbmRleGVyID0gbmV3IEluZGV4ZXIodGhpcyk7XG4gIHRoaXMuc2VnbWVudHMgPSBuZXcgU2VnbWVudHModGhpcyk7XG4gIHRoaXMuc2V0VGV4dCgnJyk7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5CdWZmZXIucHJvdG90eXBlLnVwZGF0ZVJhdyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJhdyA9IHRoaXMudGV4dC50b1N0cmluZygpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudXBkYXRlUmF3KCk7XG4gIHZhciBidWZmZXIgPSBuZXcgQnVmZmVyO1xuICBidWZmZXIucmVwbGFjZSh0aGlzKTtcbiAgcmV0dXJuIGJ1ZmZlcjtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgdGhpcy5yYXcgPSBkYXRhLnJhdztcbiAgdGhpcy50ZXh0LnNldCh0aGlzLnJhdyk7XG4gIHRoaXMudG9rZW5zID0gZGF0YS50b2tlbnMuY29weSgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2V0VGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB0aGlzLnJhdyA9IHRleHQgLy90aGlzLnN5bnRheC5oaWdobGlnaHQodGV4dCk7XG5cbiAgdGhpcy5zeW50YXgudGFiID0gfnRoaXMucmF3LmluZGV4T2YoJ1xcdCcpID8gJ1xcdCcgOiAnICc7XG5cbiAgdGhpcy50ZXh0ID0gbmV3IFNraXBTdHJpbmc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuXG4gIHRoaXMudG9rZW5zID0gbmV3IFRva2VucztcbiAgdGhpcy50b2tlbnMuaW5kZXgodGhpcy5yYXcpO1xuICB0aGlzLnRva2Vucy5vbignY2hhbmdlIHNlZ21lbnRzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZSBzZWdtZW50cycpKTtcblxuICB0aGlzLnByZWZpeCA9IG5ldyBQcmVmaXhUcmVlO1xuICB0aGlzLnByZWZpeC5pbmRleCh0aGlzLnJhdyk7XG5cbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zZXJ0ID1cbkJ1ZmZlci5wcm90b3R5cGUuaW5zZXJ0VGV4dEF0UG9pbnQgPSBmdW5jdGlvbihwLCB0ZXh0LCBub0xvZykge1xuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICB0ZXh0ID0gbm9ybWFsaXplRU9MKHRleHQpO1xuXG4gIHZhciBsZW5ndGggPSB0ZXh0Lmxlbmd0aDtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIHNoaWZ0ID0gKHRleHQubWF0Y2goTkVXTElORSkgfHwgW10pLmxlbmd0aDtcbiAgdmFyIHJhbmdlID0gW3BvaW50LnksIHBvaW50LnkgKyBzaGlmdF07XG4gIHZhciBvZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG5cbiAgdmFyIGJlZm9yZSA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy50ZXh0Lmluc2VydChwb2ludC5vZmZzZXQsIHRleHQpO1xuICBvZmZzZXRSYW5nZVsxXSArPSB0ZXh0Lmxlbmd0aDtcbiAgdmFyIGFmdGVyID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgaWYgKCFub0xvZykge1xuICAgIHZhciBsYXN0TG9nID0gdGhpcy5sb2dbdGhpcy5sb2cubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxhc3RMb2cgJiYgbGFzdExvZ1swXSA9PT0gJ2luc2VydCcgJiYgbGFzdExvZ1sxXVsxXSA9PT0gcG9pbnQub2Zmc2V0KSB7XG4gICAgICBsYXN0TG9nWzFdWzFdICs9IHRleHQubGVuZ3RoO1xuICAgICAgbGFzdExvZ1syXSArPSB0ZXh0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZy5wdXNoKFsnaW5zZXJ0JywgW3BvaW50Lm9mZnNldCwgcG9pbnQub2Zmc2V0ICsgdGV4dC5sZW5ndGhdLCB0ZXh0XSk7XG4gICAgfVxuICB9XG5cbiAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xuXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlID1cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihvLCBub0xvZykge1xuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICAvLyBjb25zb2xlLmxvZygnb2Zmc2V0cycsIG8pXG4gIHZhciBhID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMV0pO1xuICB2YXIgbGVuZ3RoID0gb1swXSAtIG9bMV07XG4gIHZhciByYW5nZSA9IFthLnksIGIueV07XG4gIHZhciBzaGlmdCA9IGEueSAtIGIueTtcbiAgLy8gY29uc29sZS5sb2coYSxiKVxuXG4gIHZhciBvZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG8pO1xuICB0aGlzLnRleHQucmVtb3ZlKG8pO1xuICBvZmZzZXRSYW5nZVsxXSArPSBsZW5ndGg7XG4gIHZhciBhZnRlciA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICB0aGlzLnRva2Vucy51cGRhdGUob2Zmc2V0UmFuZ2UsIGFmdGVyLCBsZW5ndGgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUob2Zmc2V0UmFuZ2VbMF0pO1xuXG4gIGlmICghbm9Mb2cpIHtcbiAgICB2YXIgbGFzdExvZyA9IHRoaXMubG9nW3RoaXMubG9nLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0TG9nICYmIGxhc3RMb2dbMF0gPT09ICdyZW1vdmUnICYmIGxhc3RMb2dbMV1bMF0gPT09IG9bMV0pIHtcbiAgICAgIGxhc3RMb2dbMV1bMF0gLT0gdGV4dC5sZW5ndGg7XG4gICAgICBsYXN0TG9nWzJdID0gdGV4dCArIGxhc3RMb2dbMl07XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nLnB1c2goWydyZW1vdmUnLCBvLCB0ZXh0XSk7XG4gICAgfVxuICB9XG5cbiAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRzKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlQ2hhckF0UG9pbnQgPSBmdW5jdGlvbihwKSB7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciBvZmZzZXRSYW5nZSA9IFtwb2ludC5vZmZzZXQsIHBvaW50Lm9mZnNldCsxXTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgY29kZSA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChyYW5nZSk7XG5cbiAgLy8gY2FsY3VsYXRlIGluZGVudCBmb3IgYGNvZGVgXG4gIC8vVE9ETzogbW92ZSB0byBtZXRob2RcbiAgdmFyIGxhc3QgPSBjb2RlLnNsaWNlKGNvZGUubGFzdEluZGV4T2YoJ1xcbicpKTtcbiAgdmFyIEFueUNoYXIgPSAvXFxTL2c7XG4gIHZhciB5ID0gcmFuZ2VbMV07XG4gIHZhciBtYXRjaCA9IEFueUNoYXIuZXhlYyhsYXN0KTtcbiAgd2hpbGUgKCFtYXRjaCAmJiB5IDwgdGhpcy5sb2MoKSkge1xuICAgIHZhciBhZnRlciA9IHRoaXMuZ2V0TGluZVRleHQoKyt5KTtcbiAgICBBbnlDaGFyLmxhc3RJbmRleCA9IDA7XG4gICAgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMoYWZ0ZXIpO1xuICB9XG4gIHZhciBpbmRlbnQgPSAwO1xuICBpZiAobWF0Y2gpIGluZGVudCA9IG1hdGNoLmluZGV4O1xuICB2YXIgaW5kZW50VGV4dCA9ICdcXG4nICsgbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4odGhpcy5zeW50YXgudGFiKTtcblxuICB2YXIgc2VnbWVudCA9IHRoaXMuc2VnbWVudHMuZ2V0KHJhbmdlWzBdKTtcbiAgaWYgKHNlZ21lbnQpIHtcbiAgICBjb2RlID0gU0VHTUVOVFtzZWdtZW50XSArICdcXHVmZmJhXFxuJyArIGNvZGUgKyBpbmRlbnRUZXh0ICsgJ1xcdWZmYmUqL2AnXG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlKTtcbiAgICBjb2RlID0gJzwnICsgc2VnbWVudFswXSArICc+JyArXG4gICAgICBjb2RlLnN1YnN0cmluZyhcbiAgICAgICAgY29kZS5pbmRleE9mKCdcXHVmZmJhJykgKyAyLFxuICAgICAgICBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJylcbiAgICAgICk7XG4gIH0gZWxzZSB7XG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlICsgaW5kZW50VGV4dCArICdcXHVmZmJlKi9gJyk7XG4gICAgY29kZSA9IGNvZGUuc3Vic3RyaW5nKDAsIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBsaW5lID0gbmV3IExpbmU7XG4gIGxpbmUub2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMoW3kseV0pO1xuICBsaW5lLm9mZnNldCA9IGxpbmUub2Zmc2V0UmFuZ2VbMF07XG4gIGxpbmUubGVuZ3RoID0gbGluZS5vZmZzZXRSYW5nZVsxXSAtIGxpbmUub2Zmc2V0UmFuZ2VbMF0gLSAoeSA8IHRoaXMubG9jKCkpO1xuICBsaW5lLnBvaW50LnNldCh7IHg6MCwgeTp5IH0pO1xuICByZXR1cm4gbGluZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihwKSB7XG4gIHZhciBsaW5lID0gdGhpcy5nZXRMaW5lKHAueSk7XG4gIHZhciBwb2ludCA9IG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5taW4obGluZS5sZW5ndGgsIHAueCksXG4gICAgeTogbGluZS5wb2ludC55XG4gIH0pO1xuICBwb2ludC5vZmZzZXQgPSBsaW5lLm9mZnNldCArIHBvaW50Lng7XG4gIHBvaW50LnBvaW50ID0gcG9pbnQ7XG4gIHBvaW50LmxpbmUgPSBsaW5lO1xuICByZXR1cm4gcG9pbnQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVSYW5nZVRleHQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlT2Zmc2V0cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBhID0gdGhpcy5nZXRMaW5lT2Zmc2V0KHJhbmdlWzBdKTtcbiAgdmFyIGIgPSByYW5nZVsxXSA+PSB0aGlzLmxvYygpXG4gICAgPyB0aGlzLnRleHQubGVuZ3RoXG4gICAgOiB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMV0gKyAxKTtcbiAgdmFyIG9mZnNldHMgPSBbYSwgYl07XG4gIHJldHVybiBvZmZzZXRzO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRSYW5nZVRleHQgPSBmdW5jdGlvbihvZmZzZXRSYW5nZSkge1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRSYW5nZSk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRQb2ludCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgdG9rZW4gPSB0aGlzLnRva2Vucy5nZXRCeU9mZnNldCgnbGluZXMnLCBvZmZzZXQgLSAuNSk7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IG9mZnNldCAtIChvZmZzZXQgPiB0b2tlbi5vZmZzZXQgPyB0b2tlbi5vZmZzZXQgKyAoISF0b2tlbi5wYXJ0Lmxlbmd0aCkgOiAwKSxcbiAgICB5OiBNYXRoLm1pbih0aGlzLmxvYygpLCB0b2tlbi5pbmRleCAtICh0b2tlbi5vZmZzZXQgKyAxID4gb2Zmc2V0KSArIDEpXG4gIH0pO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5jaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGNoYXIgPSB0aGlzLnRleHQuZ2V0UmFuZ2UoW29mZnNldCwgb2Zmc2V0ICsgMV0pO1xuICByZXR1cm4gY2hhcjtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZVRleHQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHtcbiAgICBsaW5lOiBsaW5lLFxuICAgIHRleHQ6IHRleHQsXG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVRleHQgPSBmdW5jdGlvbih5KSB7XG4gIHZhciB0ZXh0ID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KFt5LHldKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEFyZWFUZXh0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBcmVhQXRQb2ludCA9IGZ1bmN0aW9uKHAsIGluY2x1c2l2ZSkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLm9mZnNldFJhbmdlKTtcbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKHRleHQsIFdPUkRTKTtcblxuICBpZiAod29yZHMubGVuZ3RoID09PSAxKSB7XG4gICAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogeyB4OiAwLCB5OiBwb2ludC55IH0sXG4gICAgICBlbmQ6IHsgeDogcG9pbnQubGluZS5sZW5ndGgsIHk6IHBvaW50LnkgfSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcmVhO1xuICB9XG5cbiAgdmFyIGxhc3RJbmRleCA9IDA7XG4gIHZhciB3b3JkID0gW107XG4gIHZhciBlbmQgPSB0ZXh0Lmxlbmd0aDtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmICh3b3JkLmluZGV4ID4gcG9pbnQueCAtICEhaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICBiZWdpbjogeyB4OiBsYXN0SW5kZXgsIHk6IHBvaW50LnkgfSxcbiAgICBlbmQ6IHsgeDogZW5kLCB5OiBwb2ludC55IH1cbiAgfSk7XG5cbiAgcmV0dXJuIGFyZWE7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLm1vdmVBcmVhQnlMaW5lcyA9IGZ1bmN0aW9uKHksIGFyZWEpIHtcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MoKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGFyZWEuYmVnaW4ueCA9IDBcbiAgYXJlYS5lbmQueCA9IHRoaXMuZ2V0TGluZShhcmVhLmVuZC55KS5sZW5ndGhcblxuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuXG4gIHZhciB4ID0gMFxuXG4gIGlmICh5ID4gMCAmJiBhcmVhLmJlZ2luLnkgPiAwIHx8IGFyZWEuZW5kLnkgPT09IHRoaXMubG9jKCkpIHtcbiAgICBhcmVhLmJlZ2luLnkgLT0gMVxuICAgIGFyZWEuYmVnaW4ueCA9IHRoaXMuZ2V0TGluZShhcmVhLmJlZ2luLnkpLmxlbmd0aFxuICAgIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKVxuICAgIHggPSBJbmZpbml0eVxuICB9IGVsc2Uge1xuICAgIG9mZnNldHNbMV0gKz0gMVxuICB9XG5cbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cylcblxuICB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldHMpXG5cbiAgdGhpcy5pbnNlcnQoeyB4OiB4LCB5OmFyZWEuYmVnaW4ueSArIHkgfSwgdGV4dCk7XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEFyZWFPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIHJhbmdlID0gW1xuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5iZWdpbikub2Zmc2V0LFxuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpLm9mZnNldFxuICBdO1xuICByZXR1cm4gcmFuZ2U7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVPZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBvZmZzZXQgPSB5IDwgMCA/IC0xIDogeSA9PT0gMCA/IDAgOiB0aGlzLnRva2Vucy5nZXRCeUluZGV4KCdsaW5lcycsIHkgLSAxKSArIDE7XG4gIHJldHVybiBvZmZzZXQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmxvYyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50b2tlbnMuZ2V0Q29sbGVjdGlvbignbGluZXMnKS5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbmZ1bmN0aW9uIExpbmUoKSB7XG4gIHRoaXMub2Zmc2V0UmFuZ2UgPSBbXTtcbiAgdGhpcy5vZmZzZXQgPSAwO1xuICB0aGlzLmxlbmd0aCA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVPTChzKSB7XG4gIHJldHVybiBzLnJlcGxhY2UoRU9MLCAnXFxuJyk7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gSW5kZXhlcjtcblxuZnVuY3Rpb24gSW5kZXhlcihidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG59XG5cbkluZGV4ZXIucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihzKSB7XG4gIGlmICghcykgcmV0dXJuIFtdO1xuICB2YXIgb2Zmc2V0cyA9IFtdO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLnJhdztcbiAgdmFyIGxlbiA9IHMubGVuZ3RoO1xuICB2YXIgaW5kZXg7XG4gIHdoaWxlICh+KGluZGV4ID0gdGV4dC5pbmRleE9mKHMsIGluZGV4ICsgbGVuKSkpIHtcbiAgICBvZmZzZXRzLnB1c2goaW5kZXgpO1xuICB9XG4gIHJldHVybiBvZmZzZXRzO1xufTtcbiIsInZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBhcnRzO1xuXG5mdW5jdGlvbiBQYXJ0cyhtaW5TaXplKSB7XG4gIG1pblNpemUgPSBtaW5TaXplIHx8IDUwMDA7XG4gIHRoaXMubWluU2l6ZSA9IG1pblNpemU7XG4gIHRoaXMucGFydHMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5QYXJ0cy5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgdGhpcy5hcHBlbmQoW2l0ZW1dKTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcGFydCA9IGxhc3QodGhpcy5wYXJ0cyk7XG5cbiAgaWYgKCFwYXJ0KSB7XG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IDA7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IDA7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG4gIGVsc2UgaWYgKHBhcnQubGVuZ3RoID49IHRoaXMubWluU2l6ZSkge1xuICAgIHZhciBzdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4ICsgcGFydC5sZW5ndGg7XG4gICAgdmFyIHN0YXJ0T2Zmc2V0ID0gaXRlbXNbMF07XG5cbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gc3RhcnRJbmRleDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gc3RhcnRPZmZzZXQ7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG5cbiAgcGFydC5wdXNoLmFwcGx5KHBhcnQsIGl0ZW1zLm1hcChvZmZzZXQgPT4gb2Zmc2V0IC0gcGFydC5zdGFydE9mZnNldCkpO1xuXG4gIHRoaXMubGVuZ3RoICs9IGl0ZW1zLmxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpbmRleCkge1xuICB2YXIgcGFydCA9IHRoaXMuZmluZFBhcnRCeUluZGV4KGluZGV4KS5pdGVtO1xuICByZXR1cm4gcGFydFtNYXRoLm1pbihwYXJ0Lmxlbmd0aCAtIDEsIGluZGV4IC0gcGFydC5zdGFydEluZGV4KV0gKyBwYXJ0LnN0YXJ0T2Zmc2V0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHAgPSB0aGlzLmZpbmRQYXJ0QnlPZmZzZXQob2Zmc2V0KTtcbiAgaWYgKCFwLml0ZW0pIHJldHVybiBudWxsO1xuXG4gIHZhciBwYXJ0ID0gcC5pdGVtO1xuICB2YXIgcGFydEluZGV4ID0gcC5pbmRleDtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KTtcbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG8uaXRlbSArIHBhcnQuc3RhcnRPZmZzZXQsXG4gICAgaW5kZXg6IG8uaW5kZXggKyBwYXJ0LnN0YXJ0SW5kZXgsXG4gICAgbG9jYWw6IG8uaW5kZXgsXG4gICAgcGFydDogcGFydCxcbiAgICBwYXJ0SW5kZXg6IHBhcnRJbmRleFxuICB9O1xufTtcblxuUGFydHMucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgYXJyYXkpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKCFvKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwZW5kKGFycmF5KTtcbiAgfVxuICBpZiAoby5vZmZzZXQgPiBvZmZzZXQpIG8ubG9jYWwgPSAtMTtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcbiAgLy9UT0RPOiBtYXliZSBzdWJ0cmFjdCAnb2Zmc2V0JyBpbnN0ZWFkID9cbiAgYXJyYXkgPSBhcnJheS5tYXAoZWwgPT4gZWwgLT0gby5wYXJ0LnN0YXJ0T2Zmc2V0KTtcbiAgaW5zZXJ0KG8ucGFydCwgby5sb2NhbCArIDEsIGFycmF5KTtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgLWxlbmd0aCk7XG4gIHRoaXMubGVuZ3RoICs9IGxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdE9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgc2hpZnQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cztcbiAgdmFyIGl0ZW0gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKCFpdGVtKSByZXR1cm47XG4gIGlmIChvZmZzZXQgPiBpdGVtLm9mZnNldCkgaXRlbS5sb2NhbCArPSAxO1xuXG4gIHZhciByZW1vdmVkID0gMDtcbiAgZm9yICh2YXIgaSA9IGl0ZW0ubG9jYWw7IGkgPCBpdGVtLnBhcnQubGVuZ3RoOyBpKyspIHtcbiAgICBpdGVtLnBhcnRbaV0gKz0gc2hpZnQ7XG4gICAgaWYgKGl0ZW0ucGFydFtpXSArIGl0ZW0ucGFydC5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgcmVtb3ZlZCsrO1xuICAgICAgaXRlbS5wYXJ0LnNwbGljZShpLS0sIDEpO1xuICAgIH1cbiAgfVxuICBpZiAocmVtb3ZlZCkge1xuICAgIHRoaXMuc2hpZnRJbmRleChpdGVtLnBhcnRJbmRleCArIDEsIHJlbW92ZWQpO1xuICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gIH1cbiAgZm9yICh2YXIgaSA9IGl0ZW0ucGFydEluZGV4ICsgMTsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgcGFydHNbaV0uc3RhcnRPZmZzZXQgKz0gc2hpZnQ7XG4gICAgaWYgKHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICBpZiAobGFzdChwYXJ0c1tpXSkgKyBwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgICByZW1vdmVkID0gcGFydHNbaV0ubGVuZ3RoO1xuICAgICAgICB0aGlzLnNoaWZ0SW5kZXgoaSArIDEsIHJlbW92ZWQpO1xuICAgICAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICAgICAgICBwYXJ0cy5zcGxpY2UoaS0tLCAxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVtb3ZlQmVsb3dPZmZzZXQob2Zmc2V0LCBwYXJ0c1tpXSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUucmVtb3ZlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZmluZChyYW5nZVswXSk7XG4gIHZhciBiID0gdGhpcy5maW5kKHJhbmdlWzFdKTtcbiAgaWYgKCFhICYmICFiKSByZXR1cm47XG5cbiAgaWYgKGEucGFydEluZGV4ID09PSBiLnBhcnRJbmRleCkge1xuICAgIGlmIChhLm9mZnNldCA+PSByYW5nZVsxXSB8fCBhLm9mZnNldCA8IHJhbmdlWzBdKSBhLmxvY2FsICs9IDE7XG4gICAgaWYgKGIub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGIub2Zmc2V0IDwgcmFuZ2VbMF0pIGIubG9jYWwgLT0gMTtcbiAgICB2YXIgc2hpZnQgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsLCBiLmxvY2FsICsgMSkubGVuZ3RoO1xuICAgIHRoaXMuc2hpZnRJbmRleChhLnBhcnRJbmRleCArIDEsIHNoaWZ0KTtcbiAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbiAgfSBlbHNlIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0QSA9IHJlbW92ZShhLnBhcnQsIGEubG9jYWwpLmxlbmd0aDtcbiAgICB2YXIgc2hpZnRCID0gcmVtb3ZlKGIucGFydCwgMCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICBpZiAoYi5wYXJ0SW5kZXggLSBhLnBhcnRJbmRleCA+IDEpIHtcbiAgICAgIHZhciByZW1vdmVkID0gcmVtb3ZlKHRoaXMucGFydHMsIGEucGFydEluZGV4ICsgMSwgYi5wYXJ0SW5kZXgpO1xuICAgICAgdmFyIHNoaWZ0QmV0d2VlbiA9IHJlbW92ZWQucmVkdWNlKChwLG4pID0+IHAgKyBuLmxlbmd0aCwgMCk7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEEgKyBzaGlmdEJldHdlZW47XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggLSByZW1vdmVkLmxlbmd0aCArIDEsIHNoaWZ0QSArIHNoaWZ0QiArIHNoaWZ0QmV0d2Vlbik7XG4gICAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW47XG4gICAgfSBlbHNlIHtcbiAgICAgIGIucGFydC5zdGFydEluZGV4IC09IHNoaWZ0QTtcbiAgICAgIHRoaXMuc2hpZnRJbmRleChiLnBhcnRJbmRleCArIDEsIHNoaWZ0QSArIHNoaWZ0Qik7XG4gICAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdEEgKyBzaGlmdEI7XG4gICAgfVxuICB9XG5cbiAgLy9UT0RPOiB0aGlzIGlzIGluZWZmaWNpZW50IGFzIHdlIGNhbiBjYWxjdWxhdGUgdGhlIGluZGV4ZXMgb3Vyc2VsdmVzXG4gIGlmICghYS5wYXJ0Lmxlbmd0aCkge1xuICAgIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihhLnBhcnQpLCAxKTtcbiAgfVxuICBpZiAoIWIucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYi5wYXJ0KSwgMSk7XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdEluZGV4ID0gZnVuY3Rpb24oc3RhcnRJbmRleCwgc2hpZnQpIHtcbiAgZm9yICh2YXIgaSA9IHN0YXJ0SW5kZXg7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy5wYXJ0c1tpXS5zdGFydEluZGV4IC09IHNoaWZ0O1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUucmVtb3ZlQmVsb3dPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHBhcnQpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KVxuICB2YXIgc2hpZnQgPSByZW1vdmUocGFydCwgMCwgby5pbmRleCkubGVuZ3RoO1xuICB0aGlzLnNoaWZ0SW5kZXgoby5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gIHRoaXMubGVuZ3RoIC09IHNoaWZ0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRPZmZzZXRJblBhcnQgPSBmdW5jdGlvbihvZmZzZXQsIHBhcnQpIHtcbiAgb2Zmc2V0IC09IHBhcnQuc3RhcnRPZmZzZXQ7XG4gIHJldHVybiBiaW5hcnlTZWFyY2gocGFydCwgbyA9PiBvIDw9IG9mZnNldCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZFBhcnRCeUluZGV4ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRJbmRleCA8PSBpbmRleCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZFBhcnRCeU9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHRoaXMucGFydHMsIHMgPT4gcy5zdGFydE9mZnNldCA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMucGFydHMucmVkdWNlKChwLG4pID0+IHAuY29uY2F0KG4pLCBbXSk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhcnRzID0gbmV3IFBhcnRzKHRoaXMubWluU2l6ZSk7XG4gIHRoaXMucGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcbiAgICB2YXIgcCA9IHBhcnQuc2xpY2UoKTtcbiAgICBwLnN0YXJ0SW5kZXggPSBwYXJ0LnN0YXJ0SW5kZXg7XG4gICAgcC5zdGFydE9mZnNldCA9IHBhcnQuc3RhcnRPZmZzZXQ7XG4gICAgcGFydHMucGFydHMucHVzaChwKTtcbiAgfSk7XG4gIHBhcnRzLmxlbmd0aCA9IHRoaXMubGVuZ3RoO1xuICByZXR1cm4gcGFydHM7XG59O1xuXG5mdW5jdGlvbiBsYXN0KGFycmF5KSB7XG4gIHJldHVybiBhcnJheVthcnJheS5sZW5ndGggLSAxXTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlKGFycmF5LCBhLCBiKSB7XG4gIGlmIChiID09IG51bGwpIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhcnJheS5zcGxpY2UoYSwgYiAtIGEpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGluc2VydCh0YXJnZXQsIGluZGV4LCBhcnJheSkge1xuICB2YXIgb3AgPSBhcnJheS5zbGljZSgpO1xuICBvcC51bnNoaWZ0KGluZGV4LCAwKTtcbiAgdGFyZ2V0LnNwbGljZS5hcHBseSh0YXJnZXQsIG9wKTtcbn1cbiIsIi8vIHZhciBXT1JEID0gL1xcdysvZztcbnZhciBXT1JEID0gL1thLXpBLVowLTldezEsfS9nXG52YXIgcmFuayA9IDA7XG5cbm1vZHVsZS5leHBvcnRzID0gUHJlZml4VHJlZU5vZGU7XG5cbmZ1bmN0aW9uIFByZWZpeFRyZWVOb2RlKCkge1xuICB0aGlzLnZhbHVlID0gJyc7XG4gIHRoaXMucmFuayA9IDA7XG4gIHRoaXMuY2hpbGRyZW4gPSB7fTtcbn1cblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmdldENoaWxkcmVuID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjaGlsZHJlbiA9IE9iamVjdFxuICAgIC5rZXlzKHRoaXMuY2hpbGRyZW4pXG4gICAgLm1hcCgoa2V5KSA9PiB0aGlzLmNoaWxkcmVuW2tleV0pO1xuXG4gIHJldHVybiBjaGlsZHJlbi5yZWR1Y2UoKHAsIG4pID0+IHAuY29uY2F0KG4uZ2V0Q2hpbGRyZW4oKSksIGNoaWxkcmVuKTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5jb2xsZWN0ID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBjb2xsZWN0aW9uID0gW107XG4gIHZhciBub2RlID0gdGhpcy5maW5kKGtleSk7XG4gIGlmIChub2RlKSB7XG4gICAgY29sbGVjdGlvbiA9IG5vZGVcbiAgICAgIC5nZXRDaGlsZHJlbigpXG4gICAgICAuZmlsdGVyKChub2RlKSA9PiBub2RlLnZhbHVlKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgdmFyIHJlcyA9IGIucmFuayAtIGEucmFuaztcbiAgICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYi52YWx1ZS5sZW5ndGggLSBhLnZhbHVlLmxlbmd0aDtcbiAgICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYS52YWx1ZSA+IGIudmFsdWU7XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgICB9KTtcblxuICAgIGlmIChub2RlLnZhbHVlKSBjb2xsZWN0aW9uLnB1c2gobm9kZSk7XG4gIH1cbiAgcmV0dXJuIGNvbGxlY3Rpb247XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIGZvciAodmFyIGNoYXIgaW4ga2V5KSB7XG4gICAgaWYgKGtleVtjaGFyXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltrZXlbY2hhcl1dO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG4gIHJldHVybiBub2RlO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgdmFyIGkgPSAwO1xuICB2YXIgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGlmIChzW2ldIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW3NbaV1dO1xuICAgICAgaSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBub2RlID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dIHx8IG5ldyBQcmVmaXhUcmVlTm9kZTtcbiAgICBpKys7XG4gIH1cblxuICBub2RlLnZhbHVlID0gcztcbiAgbm9kZS5yYW5rKys7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkO1xuICB3aGlsZSAod29yZCA9IFdPUkQuZXhlYyhzKSkge1xuICAgIHRoaXMuaW5zZXJ0KHdvcmRbMF0pO1xuICB9XG59O1xuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG52YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcbnZhciBUb2tlbnMgPSByZXF1aXJlKCcuL3Rva2VucycpO1xudmFyIFR5cGUgPSBUb2tlbnMuVHlwZTtcblxudmFyIEJlZ2luID0gL1tcXC8nXCJgXS9nO1xuXG52YXIgTWF0Y2ggPSB7XG4gICdzaW5nbGUgY29tbWVudCc6IFsnLy8nLCdcXG4nXSxcbiAgJ2RvdWJsZSBjb21tZW50JzogWycvKicsJyovJ10sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiBbJ2AnLCdgJ10sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogW1wiJ1wiLFwiJ1wiXSxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBbJ1wiJywnXCInXSxcbiAgJ3JlZ2V4cCc6IFsnLycsJy8nXSxcbn07XG5cbnZhciBTa2lwID0ge1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnc2luZ2xlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ2RvdWJsZSBjb21tZW50JzogZmFsc2UsXG4gICdyZWdleHAnOiBcIlxcXFxcIixcbn07XG5cbnZhciBUb2tlbiA9IHt9O1xuZm9yICh2YXIga2V5IGluIE1hdGNoKSB7XG4gIHZhciBNID0gTWF0Y2hba2V5XTtcbiAgVG9rZW5bTVswXV0gPSBrZXk7XG59XG5cbnZhciBMZW5ndGggPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAyLFxuICAnY2xvc2UgY29tbWVudCc6IDIsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAxLFxufTtcblxudmFyIE5vdE9wZW4gPSB7XG4gICdjbG9zZSBjb21tZW50JzogdHJ1ZVxufTtcblxudmFyIENsb3NlcyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjbG9zZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRhZyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICdzdHJpbmcnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50cztcblxuZnVuY3Rpb24gU2VnbWVudHMoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xuICB0aGlzLmNhY2hlID0ge307XG4gIHRoaXMucmVzZXQoKTtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmNsZWFyQ2FjaGUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCkge1xuICAgIHZhciBzID0gYmluYXJ5U2VhcmNoKHRoaXMuY2FjaGUuc3RhdGUsIHMgPT4gcy5vZmZzZXQgPCBvZmZzZXQsIHRydWUpO1xuICAgIHRoaXMuY2FjaGUuc3RhdGUuc3BsaWNlKHMuaW5kZXgpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuY2FjaGUuc3RhdGUgPSBbXTtcbiAgfVxuICB0aGlzLmNhY2hlLm9mZnNldCA9IHt9O1xuICB0aGlzLmNhY2hlLnJhbmdlID0ge307XG4gIHRoaXMuY2FjaGUucG9pbnQgPSB7fTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyQ2FjaGUoKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbih5KSB7XG4gIGlmICh5IGluIHRoaXMuY2FjaGUucG9pbnQpIHtcbiAgICByZXR1cm4gdGhpcy5jYWNoZS5wb2ludFt5XTtcbiAgfVxuXG4gIHZhciBzZWdtZW50cyA9IHRoaXMuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdzZWdtZW50cycpO1xuICB2YXIgb3BlbiA9IGZhbHNlO1xuICB2YXIgc3RhdGUgPSBudWxsO1xuICB2YXIgd2FpdEZvciA9ICcnO1xuICB2YXIgcG9pbnQgPSB7IHg6LTEsIHk6LTEgfTtcbiAgdmFyIGNsb3NlID0gMDtcbiAgdmFyIG9mZnNldDtcbiAgdmFyIHNlZ21lbnQ7XG4gIHZhciByYW5nZTtcbiAgdmFyIHRleHQ7XG4gIHZhciB2YWxpZDtcbiAgdmFyIGxhc3Q7XG5cbiAgdmFyIGxhc3RDYWNoZVN0YXRlT2Zmc2V0ID0gMDtcblxuICB2YXIgaSA9IDA7XG5cbiAgdmFyIGNhY2hlU3RhdGUgPSB0aGlzLmdldENhY2hlU3RhdGUoeSk7XG4gIGlmIChjYWNoZVN0YXRlICYmIGNhY2hlU3RhdGUuaXRlbSkge1xuICAgIG9wZW4gPSB0cnVlO1xuICAgIHN0YXRlID0gY2FjaGVTdGF0ZS5pdGVtO1xuICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgaSA9IHN0YXRlLmluZGV4ICsgMTtcbiAgfVxuXG4gIGZvciAoOyBpIDwgc2VnbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBvZmZzZXQgPSBzZWdtZW50cy5nZXQoaSk7XG4gICAgc2VnbWVudCA9IHtcbiAgICAgIG9mZnNldDogb2Zmc2V0LFxuICAgICAgdHlwZTogVHlwZVt0aGlzLmJ1ZmZlci5jaGFyQXQob2Zmc2V0KV1cbiAgICB9O1xuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBjbG9zZSB0b2tlblxuICAgIGlmIChvcGVuKSB7XG4gICAgICBpZiAod2FpdEZvciA9PT0gc2VnbWVudC50eXBlKSB7XG4gICAgICAgIHBvaW50ID0gdGhpcy5nZXRPZmZzZXRQb2ludChzZWdtZW50Lm9mZnNldCk7XG5cbiAgICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkge1xuICAgICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gICAgICAgIH1cblxuICAgICAgICBsYXN0ID0gc2VnbWVudDtcbiAgICAgICAgbGFzdC5wb2ludCA9IHBvaW50O1xuICAgICAgICBzdGF0ZSA9IG51bGw7XG4gICAgICAgIG9wZW4gPSBmYWxzZTtcblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIG9wZW4gdG9rZW5cbiAgICBlbHNlIHtcbiAgICAgIHBvaW50ID0gdGhpcy5nZXRPZmZzZXRQb2ludChzZWdtZW50Lm9mZnNldCk7XG5cbiAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICB9XG5cbiAgICAgIHJhbmdlID0gdGhpcy5idWZmZXIuZ2V0TGluZShwb2ludC55KS5vZmZzZXRSYW5nZTtcblxuICAgICAgaWYgKGxhc3QgJiYgbGFzdC5wb2ludC55ID09PSBwb2ludC55KSB7XG4gICAgICAgIGNsb3NlID0gbGFzdC5wb2ludC54ICsgTGVuZ3RoW2xhc3QudHlwZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjbG9zZSA9IDA7XG4gICAgICB9XG5cbiAgICAgIHZhbGlkID0gdGhpcy5pc1ZhbGlkUmFuZ2UoW3JhbmdlWzBdLCByYW5nZVsxXSsxXSwgc2VnbWVudCwgY2xvc2UpO1xuXG4gICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgaWYgKE5vdE9wZW5bc2VnbWVudC50eXBlXSkgY29udGludWU7XG4gICAgICAgIG9wZW4gPSB0cnVlO1xuICAgICAgICBzdGF0ZSA9IHNlZ21lbnQ7XG4gICAgICAgIHN0YXRlLmluZGV4ID0gaTtcbiAgICAgICAgc3RhdGUucG9pbnQgPSBwb2ludDtcbiAgICAgICAgLy8gc3RhdGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMub2Zmc2V0IH07XG4gICAgICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgICAgIGlmICghdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggfHwgdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggJiYgc3RhdGUub2Zmc2V0ID4gdGhpcy5jYWNoZS5zdGF0ZVt0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAtIDFdLm9mZnNldCkge1xuICAgICAgICAgIHRoaXMuY2FjaGUuc3RhdGUucHVzaChzdGF0ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXRlICYmIHN0YXRlLnBvaW50LnkgPCB5KSB7XG4gICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgfVxuXG4gIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xufTtcblxuLy9UT0RPOiBjYWNoZSBpbiBCdWZmZXJcblNlZ21lbnRzLnByb3RvdHlwZS5nZXRPZmZzZXRQb2ludCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0IGluIHRoaXMuY2FjaGUub2Zmc2V0KSByZXR1cm4gdGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0KSk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIHNlZ21lbnQsIGNsb3NlKSB7XG4gIHZhciBrZXkgPSByYW5nZS5qb2luKCk7XG4gIGlmIChrZXkgaW4gdGhpcy5jYWNoZS5yYW5nZSkgcmV0dXJuIHRoaXMuY2FjaGUucmFuZ2Vba2V5XTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRSYW5nZVRleHQocmFuZ2UpO1xuICB2YXIgdmFsaWQgPSB0aGlzLmlzVmFsaWQodGV4dCwgc2VnbWVudC5vZmZzZXQgLSByYW5nZVswXSwgY2xvc2UpO1xuICByZXR1cm4gKHRoaXMuY2FjaGUucmFuZ2Vba2V5XSA9IHZhbGlkKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0LCBsYXN0SW5kZXgpIHtcbiAgQmVnaW4ubGFzdEluZGV4ID0gbGFzdEluZGV4O1xuXG4gIHZhciBtYXRjaCA9IEJlZ2luLmV4ZWModGV4dCk7XG4gIGlmICghbWF0Y2gpIHJldHVybjtcblxuICB2YXIgaSA9IG1hdGNoLmluZGV4O1xuXG4gIHZhciBsYXN0ID0gaTtcblxuICB2YXIgdmFsaWQgPSB0cnVlO1xuXG4gIG91dGVyOlxuICBmb3IgKDsgaSA8IHRleHQubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgb25lID0gdGV4dFtpXTtcbiAgICB2YXIgbmV4dCA9IHRleHRbaSArIDFdO1xuICAgIHZhciB0d28gPSBvbmUgKyBuZXh0O1xuICAgIGlmIChpID09PSBvZmZzZXQpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIG8gPSBUb2tlblt0d29dO1xuICAgIGlmICghbykgbyA9IFRva2VuW29uZV07XG4gICAgaWYgKCFvKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICB2YXIgd2FpdEZvciA9IE1hdGNoW29dWzFdO1xuXG4gICAgbGFzdCA9IGk7XG5cbiAgICBzd2l0Y2ggKHdhaXRGb3IubGVuZ3RoKSB7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gb25lKSB7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMTtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuXG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcbiAgICAgICAgICB0d28gPSB0ZXh0W2ldICsgdGV4dFtpICsgMV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gdHdvKSB7XG4gICAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMjtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWxpZDtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmdldENhY2hlU3RhdGUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBzID0gYmluYXJ5U2VhcmNoKHRoaXMuY2FjaGUuc3RhdGUsIHMgPT4gcy5wb2ludC55IDwgeSk7XG4gIGlmIChzLml0ZW0gJiYgeSAtIDEgPCBzLml0ZW0ucG9pbnQueSkgcmV0dXJuIG51bGw7XG4gIGVsc2UgcmV0dXJuIHM7XG4gIC8vIHJldHVybiBzO1xufTtcbiIsIi8qXG5cbmV4YW1wbGUgc2VhcmNoIGZvciBvZmZzZXQgYDRgIDpcbmBvYCBhcmUgbm9kZSdzIGxldmVscywgYHhgIGFyZSB0cmF2ZXJzYWwgc3RlcHNcblxueFxueFxuby0tPnggICBvICAgb1xubyBvIHggICBvICAgbyBvIG9cbm8gbyBvLXggbyBvIG8gbyBvXG4xIDIgMyA0IDUgNiA3IDggOVxuXG4qL1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNraXBTdHJpbmc7XG5cbmZ1bmN0aW9uIE5vZGUodmFsdWUsIGxldmVsKSB7XG4gIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgdGhpcy5sZXZlbCA9IGxldmVsO1xuICB0aGlzLndpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwodmFsdWUgJiYgdmFsdWUubGVuZ3RoIHx8IDApO1xuICB0aGlzLm5leHQgPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbChudWxsKTtcbn1cblxuTm9kZS5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMud2lkdGhbMF07XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNraXBTdHJpbmcobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy5sZXZlbHMgPSBvLmxldmVscyB8fCAxMTtcbiAgdGhpcy5iaWFzID0gby5iaWFzIHx8IDEgLyBNYXRoLkU7XG4gIHRoaXMuaGVhZCA9IG5ldyBOb2RlKG51bGwsIHRoaXMubGV2ZWxzKTtcbiAgdGhpcy5jaHVua1NpemUgPSBvLmNodW5rU2l6ZSB8fCA1MDAwO1xufVxuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkLndpZHRoW3RoaXMubGV2ZWxzIC0gMV07XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICAvLyBncmVhdCBoYWNrIHRvIGRvIG9mZnNldCA+PSBmb3IgLnNlYXJjaCgpXG4gIC8vIHdlIGRvbid0IGhhdmUgZnJhY3Rpb25zIGFueXdheSBzby4uXG4gIHJldHVybiB0aGlzLnNlYXJjaChvZmZzZXQsIHRydWUpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmluc2VydENodW5rZWQoMCwgdGV4dCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbihvZmZzZXQsIGluY2wpIHtcbiAgaW5jbCA9IGluY2wgPyAuMSA6IDA7XG5cbiAgLy8gcHJlcGFyZSB0byBob2xkIHN0ZXBzXG4gIHZhciBzdGVwcyA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG4gIHZhciB3aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG5cbiAgLy8gaXRlcmF0ZSBsZXZlbHMgZG93biwgc2tpcHBpbmcgdG9wXG4gIHZhciBpID0gdGhpcy5sZXZlbHM7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICB3aGlsZSAob2Zmc2V0ICsgaW5jbCA+IG5vZGUud2lkdGhbaV0gJiYgbnVsbCAhPSBub2RlLm5leHRbaV0pIHtcbiAgICAgIG9mZnNldCAtPSBub2RlLndpZHRoW2ldO1xuICAgICAgbm9kZSA9IG5vZGUubmV4dFtpXTtcbiAgICB9XG4gICAgc3RlcHNbaV0gPSBub2RlO1xuICAgIHdpZHRoW2ldID0gb2Zmc2V0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBub2RlOiBub2RlLFxuICAgIHN0ZXBzOiBzdGVwcyxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgb2Zmc2V0OiBvZmZzZXRcbiAgfTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNwbGljZSA9IGZ1bmN0aW9uKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7IC8vIHNraXAgc3RlcHMgbGVmdCBvZiB0aGUgb2Zmc2V0XG4gIHZhciB3aWR0aCA9IHMud2lkdGg7XG5cbiAgdmFyIHA7IC8vIGxlZnQgbm9kZSBvciBgcGBcbiAgdmFyIHE7IC8vIHJpZ2h0IG5vZGUgb3IgYHFgIChvdXIgbmV3IG5vZGUpXG4gIHZhciBsZW47XG5cbiAgLy8gY3JlYXRlIG5ldyBub2RlXG4gIGxldmVsID0gbGV2ZWwgfHwgdGhpcy5yYW5kb21MZXZlbCgpO1xuICBxID0gbmV3IE5vZGUodmFsdWUsIGxldmVsKTtcbiAgbGVuZ3RoID0gcS53aWR0aFswXTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBpdGVyYXRlIHN0ZXBzIGxldmVscyBiZWxvdyBuZXcgbm9kZSBsZXZlbFxuICBpID0gbGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbCBzdGVwXG4gICAgcS5uZXh0W2ldID0gcC5uZXh0W2ldOyAvLyBpbnNlcnQgc28gaW5oZXJpdCBsZWZ0J3MgbmV4dFxuICAgIHAubmV4dFtpXSA9IHE7IC8vIGxlZnQncyBuZXh0IGlzIG5vdyBvdXIgbmV3IG5vZGVcbiAgICBxLndpZHRoW2ldID0gcC53aWR0aFtpXSAtIHdpZHRoW2ldICsgbGVuZ3RoO1xuICAgIHAud2lkdGhbaV0gPSB3aWR0aFtpXTtcbiAgfVxuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgYWxsIGxldmVscyBkb3duIHVudGlsIGV4Y2VwdCBuZXcgbm9kZSBsZXZlbFxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBsZXZlbCkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsXG4gICAgcC53aWR0aFtpXSArPSBsZW5ndGg7IC8vIGFkZCBuZXcgbm9kZSB3aWR0aFxuICB9XG5cbiAgLy8gcmV0dXJuIG5ldyBub2RlXG4gIHJldHVybiBxO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChvZmZzZXQpO1xuXG4gIC8vIGlmIHNlYXJjaCBmYWxscyBpbiB0aGUgbWlkZGxlIG9mIGEgc3RyaW5nXG4gIC8vIGluc2VydCBpdCB0aGVyZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIGEgbmV3IG5vZGVcbiAgaWYgKHMub2Zmc2V0ICYmIHMubm9kZS52YWx1ZSAmJiBzLm9mZnNldCA8IHMubm9kZS52YWx1ZS5sZW5ndGgpIHtcbiAgICB0aGlzLnVwZGF0ZShzLCBpbnNlcnQocy5vZmZzZXQsIHMubm9kZS52YWx1ZSwgdmFsdWUpKTtcbiAgICByZXR1cm4gcy5ub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuc3BsaWNlKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIC8vIHZhbHVlcyBsZW5ndGggZGlmZmVyZW5jZVxuICB2YXIgbGVuZ3RoID0gcy5ub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICAvLyB1cGRhdGUgdmFsdWVcbiAgcy5ub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gZml4IHdpZHRocyBvbiBhbGwgbGV2ZWxzXG4gIGkgPSB0aGlzLmxldmVscztcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgcy5zdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKHJhbmdlWzFdID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAncmFuZ2UgZW5kIG92ZXIgbWF4aW11bSBsZW5ndGgoJyArXG4gICAgICB0aGlzLmxlbmd0aCArICcpOiBbJyArIHJhbmdlLmpvaW4oKSArICddJ1xuICAgICk7XG4gIH1cblxuICAvLyByZW1haW4gZGlzdGFuY2UgdG8gcmVtb3ZlXG4gIHZhciB4ID0gcmFuZ2VbMV0gLSByYW5nZVswXTtcblxuICAvLyBzZWFyY2ggZm9yIG5vZGUgb24gbGVmdCBlZGdlXG4gIHZhciBzID0gdGhpcy5zZWFyY2gocmFuZ2VbMF0pO1xuICB2YXIgb2Zmc2V0ID0gcy5vZmZzZXQ7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7XG4gIHZhciBub2RlID0gcy5ub2RlO1xuXG4gIC8vIHNraXAgaGVhZFxuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gIC8vIHNsaWNlIGxlZnQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKG9mZnNldCkge1xuICAgIGlmIChvZmZzZXQgPCBub2RlLndpZHRoWzBdKSB7XG4gICAgICB4IC09IHRoaXMudXBkYXRlKHMsXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoMCwgb2Zmc2V0KSArXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoXG4gICAgICAgICAgb2Zmc2V0ICtcbiAgICAgICAgICBNYXRoLm1pbih4LCBub2RlLmxlbmd0aCAtIG9mZnNldClcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gICAgaWYgKCFub2RlKSByZXR1cm47XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGZ1bGwgbm9kZXMgaW4gcmFuZ2VcbiAgd2hpbGUgKG5vZGUgJiYgeCA+PSBub2RlLndpZHRoWzBdKSB7XG4gICAgeCAtPSB0aGlzLnJlbW92ZU5vZGUoc3RlcHMsIG5vZGUpO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cblxuICAvLyBzbGljZSByaWdodCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAoeCkge1xuICAgIHRoaXMucmVwbGFjZShzdGVwcywgbm9kZSwgbm9kZS52YWx1ZS5zbGljZSh4KSk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZU5vZGUgPSBmdW5jdGlvbihzdGVwcywgbm9kZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS53aWR0aFswXTtcblxuICB2YXIgaTtcblxuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aCAtIG5vZGUud2lkdGhbaV07XG4gICAgc3RlcHNbaV0ubmV4dFtpXSA9IG5vZGUubmV4dFtpXTtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlLCB2YWx1ZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgbm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIHZhciBpO1xuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIG5vZGUud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlKFtvZmZzZXQsIG9mZnNldCsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnRDaHVua2VkID0gZnVuY3Rpb24ob2Zmc2V0LCB0ZXh0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gdGhpcy5jaHVua1NpemUpIHtcbiAgICB2YXIgY2h1bmsgPSB0ZXh0LnN1YnN0cihpLCB0aGlzLmNodW5rU2l6ZSk7XG4gICAgdGhpcy5pbnNlcnQoaSArIG9mZnNldCwgY2h1bmspO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zdWJzdHJpbmcgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBsZW5ndGggPSBiIC0gYTtcblxuICB2YXIgc2VhcmNoID0gdGhpcy5zZWFyY2goYSwgdHJ1ZSk7XG4gIHZhciBub2RlID0gc2VhcmNoLm5vZGU7XG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIHZhciBkID0gbGVuZ3RoICsgc2VhcmNoLm9mZnNldDtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKG5vZGUgJiYgZCA+PSAwKSB7XG4gICAgZCAtPSBub2RlLndpZHRoWzBdO1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG4gIGlmIChub2RlKSB7XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICB9XG5cbiAgcmV0dXJuIHMuc3Vic3RyKHNlYXJjaC5vZmZzZXQsIGxlbmd0aCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yYW5kb21MZXZlbCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbGV2ZWwgPSAxO1xuICB3aGlsZSAobGV2ZWwgPCB0aGlzLmxldmVscyAtIDEgJiYgTWF0aC5yYW5kb20oKSA8IHRoaXMuYmlhcykgbGV2ZWwrKztcbiAgcmV0dXJuIGxldmVsO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByYW5nZSA9IHJhbmdlIHx8IFtdO1xuICByZXR1cm4gdGhpcy5zdWJzdHJpbmcocmFuZ2VbMF0sIHJhbmdlWzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvcHkgPSBuZXcgU2tpcFN0cmluZztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHZhciBvZmZzZXQgPSAwO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIGNvcHkuaW5zZXJ0KG9mZnNldCwgbm9kZS52YWx1ZSk7XG4gICAgb2Zmc2V0ICs9IG5vZGUud2lkdGhbMF07XG4gIH1cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5qb2luU3RyaW5nID0gZnVuY3Rpb24oZGVsaW1pdGVyKSB7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBwYXJ0cy5wdXNoKG5vZGUudmFsdWUpO1xuICB9XG4gIHJldHVybiBwYXJ0cy5qb2luKGRlbGltaXRlcik7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zdWJzdHJpbmcoMCwgdGhpcy5sZW5ndGgpO1xufTtcblxuZnVuY3Rpb24gdHJpbShzLCBsZWZ0LCByaWdodCkge1xuICByZXR1cm4gcy5zdWJzdHIoMCwgcy5sZW5ndGggLSByaWdodCkuc3Vic3RyKGxlZnQpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcbnZhciBSID0gUmVnZXhwLmNyZWF0ZTtcblxuLy9OT1RFOiBvcmRlciBtYXR0ZXJzXG52YXIgc3ludGF4ID0gbWFwKHtcbiAgJ3QnOiBSKFsnb3BlcmF0b3InXSwgJ2cnLCBlbnRpdGllcyksXG4gICdtJzogUihbJ3BhcmFtcyddLCAgICdnJyksXG4gICdkJzogUihbJ2RlY2xhcmUnXSwgICdnJyksXG4gICdmJzogUihbJ2Z1bmN0aW9uJ10sICdnJyksXG4gICdrJzogUihbJ2tleXdvcmQnXSwgICdnJyksXG4gICduJzogUihbJ2J1aWx0aW4nXSwgICdnJyksXG4gICdsJzogUihbJ3N5bWJvbCddLCAgICdnJyksXG4gICdzJzogUihbJ3RlbXBsYXRlIHN0cmluZyddLCAnZycpLFxuICAnZSc6IFIoWydzcGVjaWFsJywnbnVtYmVyJ10sICdnJyksXG59LCBjb21waWxlKTtcblxudmFyIEluZGVudCA9IHtcbiAgcmVnZXhwOiBSKFsnaW5kZW50J10sICdnbScpLFxuICByZXBsYWNlcjogKHMpID0+IHMucmVwbGFjZSgvIHsxLDJ9fFxcdC9nLCAnPHg+JCY8L3g+Jylcbn07XG5cbnZhciBBbnlDaGFyID0gL1xcUy9nO1xuXG52YXIgQmxvY2tzID0gUihbJ2NvbW1lbnQnLCdzdHJpbmcnLCdyZWdleHAnXSwgJ2dtJyk7XG5cbnZhciBMb25nTGluZXMgPSAvKF4uezEwMDAsfSkvZ207XG5cbnZhciBUYWcgPSB7XG4gICcvLyc6ICdjJyxcbiAgJy8qJzogJ2MnLFxuICAnYCc6ICdzJyxcbiAgJ1wiJzogJ3MnLFxuICBcIidcIjogJ3MnLFxuICAnLyc6ICdyJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3ludGF4O1xuXG5mdW5jdGlvbiBTeW50YXgobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy50YWIgPSBvLnRhYiB8fCAnXFx0JztcbiAgdGhpcy5ibG9ja3MgPSBbXTtcbn1cblxuU3ludGF4LnByb3RvdHlwZS5lbnRpdGllcyA9IGVudGl0aWVzO1xuXG5TeW50YXgucHJvdG90eXBlLmhpZ2hsaWdodCA9IGZ1bmN0aW9uKGNvZGUsIG9mZnNldCkge1xuICBjb2RlID0gdGhpcy5jcmVhdGVJbmRlbnRzKGNvZGUpO1xuICBjb2RlID0gdGhpcy5jcmVhdGVCbG9ja3MoY29kZSk7XG4gIGNvZGUgPSBlbnRpdGllcyhjb2RlKTtcblxuICBmb3IgKHZhciBrZXkgaW4gc3ludGF4KSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShzeW50YXhba2V5XS5yZWdleHAsIHN5bnRheFtrZXldLnJlcGxhY2VyKTtcbiAgfVxuXG4gIGNvZGUgPSB0aGlzLnJlc3RvcmVCbG9ja3MoY29kZSk7XG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoSW5kZW50LnJlZ2V4cCwgSW5kZW50LnJlcGxhY2VyKTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlSW5kZW50cyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGxpbmVzID0gY29kZS5zcGxpdCgvXFxuL2cpO1xuICB2YXIgaW5kZW50ID0gMDtcbiAgdmFyIG1hdGNoO1xuICB2YXIgbGluZTtcbiAgdmFyIGk7XG5cbiAgaSA9IGxpbmVzLmxlbmd0aDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgbGluZSA9IGxpbmVzW2ldO1xuICAgIEFueUNoYXIubGFzdEluZGV4ID0gMDtcbiAgICBtYXRjaCA9IEFueUNoYXIuZXhlYyhsaW5lKTtcbiAgICBpZiAobWF0Y2gpIGluZGVudCA9IG1hdGNoLmluZGV4O1xuICAgIGVsc2UgaWYgKGluZGVudCAmJiAhbGluZS5sZW5ndGgpIHtcbiAgICAgIGxpbmVzW2ldID0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4odGhpcy50YWIpO1xuICAgIH1cbiAgfVxuXG4gIGNvZGUgPSBsaW5lcy5qb2luKCdcXG4nKTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUucmVzdG9yZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGJsb2NrO1xuICB2YXIgYmxvY2tzID0gdGhpcy5ibG9ja3M7XG4gIHZhciBuID0gMDtcbiAgcmV0dXJuIGNvZGVcbiAgICAucmVwbGFjZSgvXFx1ZmZlYy9nLCBmdW5jdGlvbigpIHtcbiAgICAgIGJsb2NrID0gYmxvY2tzW24rK107XG4gICAgICByZXR1cm4gZW50aXRpZXMoYmxvY2suc2xpY2UoMCwgMTAwMCkgKyAnLi4ubGluZSB0b28gbG9uZyB0byBkaXNwbGF5Jyk7XG4gICAgfSlcbiAgICAucmVwbGFjZSgvXFx1ZmZlYi9nLCBmdW5jdGlvbigpIHtcbiAgICAgIGJsb2NrID0gYmxvY2tzW24rK107XG4gICAgICB2YXIgdGFnID0gaWRlbnRpZnkoYmxvY2spO1xuICAgICAgcmV0dXJuICc8Jyt0YWcrJz4nK2VudGl0aWVzKGJsb2NrKSsnPC8nK3RhZysnPic7XG4gICAgfSk7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdGhpcy5ibG9ja3MgPSBbXTtcblxuICBjb2RlID0gY29kZVxuICAgIC5yZXBsYWNlKExvbmdMaW5lcywgKGJsb2NrKSA9PiB7XG4gICAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgIHJldHVybiAnXFx1ZmZlYyc7XG4gICAgfSlcbiAgICAucmVwbGFjZShCbG9ja3MsIChibG9jaykgPT4ge1xuICAgICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICByZXR1cm4gJ1xcdWZmZWInO1xuICAgIH0pO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuZnVuY3Rpb24gY3JlYXRlSWQoKSB7XG4gIHZhciBhbHBoYWJldCA9ICdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eic7XG4gIHZhciBsZW5ndGggPSBhbHBoYWJldC5sZW5ndGggLSAxO1xuICB2YXIgaSA9IDY7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzICs9IGFscGhhYmV0W01hdGgucmFuZG9tKCkgKiBsZW5ndGggfCAwXTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gZW50aXRpZXModGV4dCkge1xuICByZXR1cm4gdGV4dFxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICA7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGUocmVnZXhwLCB0YWcpIHtcbiAgdmFyIG9wZW5UYWcgPSAnPCcgKyB0YWcgKyAnPic7XG4gIHZhciBjbG9zZVRhZyA9ICc8LycgKyB0YWcgKyAnPic7XG4gIHJldHVybiB7XG4gICAgbmFtZTogdGFnLFxuICAgIHJlZ2V4cDogcmVnZXhwLFxuICAgIHJlcGxhY2VyOiBvcGVuVGFnICsgJyQmJyArIGNsb3NlVGFnXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hcChvYmosIGZuKSB7XG4gIHZhciByZXN1bHQgPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHJlc3VsdFtrZXldID0gZm4ob2JqW2tleV0sIGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZShwYXNzLCBjb2RlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFzcy5sZW5ndGg7IGkrKykge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UocGFzc1tpXVswXSwgcGFzc1tpXVsxXSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZ5KGJsb2NrKSB7XG4gIHZhciBvbmUgPSBibG9ja1swXTtcbiAgdmFyIHR3byA9IG9uZSArIGJsb2NrWzFdO1xuICByZXR1cm4gVGFnW3R3b10gfHwgVGFnW29uZV07XG59XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBQYXJ0cyA9IHJlcXVpcmUoJy4vcGFydHMnKTtcblxudmFyIFR5cGUgPSB7XG4gICdcXG4nOiAnbGluZXMnLFxuICAneyc6ICdvcGVuIGN1cmx5JyxcbiAgJ30nOiAnY2xvc2UgY3VybHknLFxuICAnWyc6ICdvcGVuIHNxdWFyZScsXG4gICddJzogJ2Nsb3NlIHNxdWFyZScsXG4gICcoJzogJ29wZW4gcGFyZW5zJyxcbiAgJyknOiAnY2xvc2UgcGFyZW5zJyxcbiAgJy8nOiAnb3BlbiBjb21tZW50JyxcbiAgJyonOiAnY2xvc2UgY29tbWVudCcsXG4gICdgJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVE9LRU4gPSAvXFxufFxcL1xcKnxcXCpcXC98YHxcXHt8XFx9fFxcW3xcXF18XFwofFxcKS9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRva2VucztcblxuVG9rZW5zLlR5cGUgPSBUeXBlO1xuXG5mdW5jdGlvbiBUb2tlbnMoZmFjdG9yeSkge1xuICBmYWN0b3J5ID0gZmFjdG9yeSB8fCBmdW5jdGlvbigpIHsgcmV0dXJuIG5ldyBQYXJ0czsgfTtcblxuICB0aGlzLmZhY3RvcnkgPSBmYWN0b3J5O1xuXG4gIHZhciB0ID0gdGhpcy50b2tlbnMgPSB7XG4gICAgbGluZXM6IGZhY3RvcnkoKSxcbiAgICBibG9ja3M6IGZhY3RvcnkoKSxcbiAgICBzZWdtZW50czogZmFjdG9yeSgpLFxuICB9O1xuXG4gIHRoaXMuY29sbGVjdGlvbiA9IHtcbiAgICAnXFxuJzogdC5saW5lcyxcbiAgICAneyc6IHQuYmxvY2tzLFxuICAgICd9JzogdC5ibG9ja3MsXG4gICAgJ1snOiB0LmJsb2NrcyxcbiAgICAnXSc6IHQuYmxvY2tzLFxuICAgICcoJzogdC5ibG9ja3MsXG4gICAgJyknOiB0LmJsb2NrcyxcbiAgICAnLyc6IHQuc2VnbWVudHMsXG4gICAgJyonOiB0LnNlZ21lbnRzLFxuICAgICdgJzogdC5zZWdtZW50cyxcbiAgfTtcbn1cblxuVG9rZW5zLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRva2Vucy5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHx8IDA7XG5cbiAgdmFyIHRva2VucyA9IHRoaXMudG9rZW5zO1xuICB2YXIgbWF0Y2g7XG4gIHZhciB0eXBlO1xuICB2YXIgY29sbGVjdGlvbjtcblxuICB3aGlsZSAobWF0Y2ggPSBUT0tFTi5leGVjKHRleHQpKSB7XG4gICAgY29sbGVjdGlvbiA9IHRoaXMuY29sbGVjdGlvblt0ZXh0W21hdGNoLmluZGV4XV07XG4gICAgY29sbGVjdGlvbi5wdXNoKG1hdGNoLmluZGV4ICsgb2Zmc2V0KTtcbiAgfVxufTtcblxuVG9rZW5zLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihyYW5nZSwgdGV4dCwgc2hpZnQpIHtcbiAgdmFyIGluc2VydCA9IG5ldyBUb2tlbnMoQXJyYXkpO1xuICBpbnNlcnQuaW5kZXgodGV4dCwgcmFuZ2VbMF0pO1xuXG4gIHZhciBsZW5ndGhzID0ge307XG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICBsZW5ndGhzW3R5cGVdID0gdGhpcy50b2tlbnNbdHlwZV0ubGVuZ3RoO1xuICB9XG5cbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnNoaWZ0T2Zmc2V0KHJhbmdlWzBdLCBzaGlmdCk7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0ucmVtb3ZlUmFuZ2UocmFuZ2UpO1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLmluc2VydChyYW5nZVswXSwgaW5zZXJ0LnRva2Vuc1t0eXBlXSk7XG4gIH1cblxuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgaWYgKHRoaXMudG9rZW5zW3R5cGVdLmxlbmd0aCAhPT0gbGVuZ3Roc1t0eXBlXSkge1xuICAgICAgdGhpcy5lbWl0KGBjaGFuZ2UgJHt0eXBlfWApO1xuICAgIH1cbiAgfVxufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeUluZGV4ID0gZnVuY3Rpb24odHlwZSwgaW5kZXgpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdLmdldChpbmRleCk7XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldENvbGxlY3Rpb24gPSBmdW5jdGlvbih0eXBlKSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlPZmZzZXQgPSBmdW5jdGlvbih0eXBlLCBvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdLmZpbmQob2Zmc2V0KTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgdG9rZW5zID0gbmV3IFRva2Vucyh0aGlzLmZhY3RvcnkpO1xuICB2YXIgdCA9IHRva2Vucy50b2tlbnM7XG4gIGZvciAodmFyIGtleSBpbiB0aGlzLnRva2Vucykge1xuICAgIHRba2V5XSA9IHRoaXMudG9rZW5zW2tleV0uc2xpY2UoKTtcbiAgfVxuICB0b2tlbnMuY29sbGVjdGlvbiA9IHtcbiAgICAnXFxuJzogdC5saW5lcyxcbiAgICAneyc6IHQuYmxvY2tzLFxuICAgICd9JzogdC5ibG9ja3MsXG4gICAgJ1snOiB0LmJsb2NrcyxcbiAgICAnXSc6IHQuYmxvY2tzLFxuICAgICcoJzogdC5ibG9ja3MsXG4gICAgJyknOiB0LmJsb2NrcyxcbiAgICAnLyc6IHQuc2VnbWVudHMsXG4gICAgJyonOiB0LnNlZ21lbnRzLFxuICAgICdgJzogdC5zZWdtZW50cyxcbiAgfTtcbiAgcmV0dXJuIHRva2Vucztcbn07XG4iLCJ2YXIgb3BlbiA9IHJlcXVpcmUoJy4uL2xpYi9vcGVuJyk7XG52YXIgc2F2ZSA9IHJlcXVpcmUoJy4uL2xpYi9zYXZlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBCdWZmZXIgPSByZXF1aXJlKCcuL2J1ZmZlcicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbGU7XG5cbmZ1bmN0aW9uIEZpbGUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5yb290ID0gJyc7XG4gIHRoaXMucGF0aCA9ICd1bnRpdGxlZCc7XG4gIHRoaXMuYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuRmlsZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5GaWxlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5idWZmZXIub24oJ3JhdycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdyYXcnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdzZXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnc2V0JykpO1xuICB0aGlzLmJ1ZmZlci5vbigndXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZScpKTtcbiAgdGhpcy5idWZmZXIub24oJ2JlZm9yZSB1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmVmb3JlIGNoYW5nZScpKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLnBhdGggPSBwYXRoO1xuICB0aGlzLnJvb3QgPSByb290O1xuICBvcGVuKHJvb3QgKyBwYXRoLCAoZXJyLCB0ZXh0KSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICBmbiAmJiBmbihlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xuICAgIHRoaXMuZW1pdCgnb3BlbicpO1xuICAgIGZuICYmIGZuKG51bGwsIHRoaXMpO1xuICB9KTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICBzYXZlKHRoaXMucm9vdCArIHRoaXMucGF0aCwgdGhpcy5idWZmZXIudG9TdHJpbmcoKSwgZm4gfHwgbm9vcCk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG59O1xuXG5mdW5jdGlvbiBub29wKCkgey8qIG5vb3AgKi99XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uL2xpYi9kZWJvdW5jZScpO1xuXG4vKlxuICAgLiAuXG4tMSAwIDEgMiAzIDQgNVxuICAgblxuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBIaXN0b3J5O1xuXG5mdW5jdGlvbiBIaXN0b3J5KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sb2cgPSBbXTtcbiAgdGhpcy5uZWVkbGUgPSAwO1xuICB0aGlzLnRpbWVvdXQgPSB0cnVlO1xuICB0aGlzLnRpbWVTdGFydCA9IDA7XG4gIHRoaXMuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKHRoaXMuYWN0dWFsbHlTYXZlLmJpbmQodGhpcyksIDcwMClcbn1cblxuSGlzdG9yeS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDAgfHwgZm9yY2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICBpZiAodGhpcy5lZGl0b3IuYnVmZmVyLmxvZy5sZW5ndGgpIHtcbiAgICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICAgIHRoaXMubG9nLnB1c2godGhpcy5jb21taXQoKSk7XG4gICAgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGg7XG4gICAgdGhpcy5zYXZlTWV0YSgpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuc2F2ZU1ldGEoKTtcbiAgfVxuICB0aGlzLnRpbWVTdGFydCA9IERhdGUubm93KCk7XG4gIHRoaXMudGltZW91dCA9IGZhbHNlO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUudW5kbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG4gIGlmICh0aGlzLm5lZWRsZSA8IDApIHJldHVybjtcblxuICB0aGlzLmNoZWNrb3V0KCd1bmRvJywgdGhpcy5uZWVkbGUtLSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5yZWRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA9PT0gdGhpcy5sb2cubGVuZ3RoIC0gMSkgcmV0dXJuO1xuXG4gIHRoaXMuY2hlY2tvdXQoJ3JlZG8nLCArK3RoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24odHlwZSwgbikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG5cbiAgdmFyIGxvZyA9IGNvbW1pdC5sb2c7XG5cbiAgY29tbWl0ID0gdGhpcy5sb2dbbl1bdHlwZV07XG4gIHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlID0gY29tbWl0Lm1hcmtBY3RpdmU7XG4gIHRoaXMuZWRpdG9yLm1hcmsuc2V0KGNvbW1pdC5tYXJrLmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLnNldENhcmV0KGNvbW1pdC5jYXJldC5jb3B5KCkpO1xuXG4gIGxvZyA9ICd1bmRvJyA9PT0gdHlwZVxuICAgID8gbG9nLnNsaWNlKCkucmV2ZXJzZSgpXG4gICAgOiBsb2cuc2xpY2UoKTtcblxuICBsb2cuZm9yRWFjaChpdGVtID0+IHtcbiAgICB2YXIgYWN0aW9uID0gaXRlbVswXTtcbiAgICB2YXIgb2Zmc2V0UmFuZ2UgPSBpdGVtWzFdO1xuICAgIHZhciB0ZXh0ID0gaXRlbVsyXTtcbiAgICBzd2l0Y2ggKGFjdGlvbikge1xuICAgICAgY2FzZSAnaW5zZXJ0JzpcbiAgICAgICAgaWYgKCd1bmRvJyA9PT0gdHlwZSkge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSwgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLmluc2VydCh0aGlzLmVkaXRvci5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0UmFuZ2VbMF0pLCB0ZXh0LCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbW92ZSc6XG4gICAgICAgIGlmICgndW5kbycgPT09IHR5cGUpIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIuaW5zZXJ0KHRoaXMuZWRpdG9yLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXRSYW5nZVswXSksIHRleHQsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsb2cgPSB0aGlzLmVkaXRvci5idWZmZXIubG9nO1xuICB0aGlzLmVkaXRvci5idWZmZXIubG9nID0gW107XG4gIHJldHVybiB7XG4gICAgbG9nOiBsb2csXG4gICAgdW5kbzogdGhpcy5tZXRhLFxuICAgIHJlZG86IHtcbiAgICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgICBtYXJrOiB0aGlzLmVkaXRvci5tYXJrLmNvcHkoKSxcbiAgICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gICAgfVxuICB9O1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZU1ldGEgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tZXRhID0ge1xuICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgfTtcbn07XG4iLCJ2YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcblxudmFyIFBBR0lOR19USFJPVFRMRSA9IDY1O1xuXG52YXIga2V5cyA9IG1vZHVsZS5leHBvcnRzID0ge1xuICAnY3RybCt6JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnVuZG8oKTtcbiAgfSxcbiAgJ2N0cmwreSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS5yZWRvKCk7XG4gIH0sXG5cbiAgJ2hvbWUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUoKTtcbiAgfSxcbiAgJ2VuZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUoKTtcbiAgfSxcbiAgJ3BhZ2V1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ3BhZ2Vkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK3VwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCg2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93big2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSk7XG4gIH0sXG4gICd1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xKTtcbiAgfSxcbiAgJ3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEpO1xuICB9LFxuICAnZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxKTtcbiAgfSxcblxuICAnY3RybCtsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSk7XG4gIH0sXG4gICdjdHJsK3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrYSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH0sXG5cbiAgJ2VudGVyJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5pbnNlcnQoJ1xcbicpO1xuICB9LFxuXG4gICdiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK2QnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIGxpbmVzID0gYXJlYS5lbmQueSAtIGFyZWEuYmVnaW4ueTtcbiAgICBpZiAobGluZXMgJiYgYXJlYS5lbmQueCA+IDApIGFkZCArPSAxO1xuICAgIGlmICghbGluZXMpIGFkZCArPSAxO1xuICAgIGxpbmVzICs9IGFkZDtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEuc2V0TGVmdCgwKS5hZGRCb3R0b20oYWRkKSk7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHsgeDogMCwgeTogYXJlYS5lbmQueSB9LCB0ZXh0KTtcbiAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKGxpbmVzKTtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcyhsaW5lcywgdHJ1ZSk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrdXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmVtaXQoJ2lucHV0JywgJ1xcdWFhYTInLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSlcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKGFyZWEuZW5kLnggPT09IDApIHtcbiAgICAgIGFyZWEuZW5kLnkgPSBhcmVhLmVuZC55IC0gMVxuICAgICAgYXJlYS5lbmQueCA9IHRoaXMuYnVmZmVyLmdldExpbmUoYXJlYS5lbmQueSkubGVuZ3RoXG4gICAgfVxuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMycsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKVxuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAoYXJlYS5lbmQueCA9PT0gMCkge1xuICAgICAgYXJlYS5lbmQueSA9IGFyZWEuZW5kLnkgLSAxXG4gICAgICBhcmVhLmVuZC54ID0gdGhpcy5idWZmZXIuZ2V0TGluZShhcmVhLmVuZC55KS5sZW5ndGhcbiAgICB9XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAndGFiJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuc3VnZ2VzdCgpO1xuICAgIGlmICghcmVzKSB7XG4gICAgICB0aGlzLmluc2VydCh0aGlzLnRhYik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya1NldEFyZWEocmVzLmFyZWEpO1xuICAgICAgdGhpcy5pbnNlcnQocmVzLm5vZGUudmFsdWUpO1xuICAgIH1cbiAgfSxcblxuICAnY3RybCtmJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kLm9wZW4oKTtcbiAgfSxcblxuICAnZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKCsxKTtcbiAgfSxcbiAgJ3NoaWZ0K2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgtMSk7XG4gIH0sXG5cbiAgJ2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhZGQ7XG4gICAgdmFyIGFyZWE7XG4gICAgdmFyIHRleHQ7XG5cbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcblxuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgY2xlYXIgPSB0cnVlO1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGhpcy5tYXJrLmFkZEJvdHRvbShhcmVhLmVuZC54ID4gMCkuc2V0TGVmdCgwKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dCh0aGlzLm1hcmsuZ2V0KCkpO1xuICAgIH1cblxuICAgIC8vVE9ETzogc2hvdWxkIGNoZWNrIGlmIGxhc3QgbGluZSBoYXMgLy8gYWxzb1xuICAgIGlmICh0ZXh0LnRyaW1MZWZ0KCkuc3Vic3RyKDAsMikgPT09ICcvLycpIHtcbiAgICAgIGFkZCA9IC0zO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXiguKj8pXFwvXFwvICguKykvZ20sICckMSQyJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkZCA9ICszO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXihbXFxzXSopKC4rKS9nbSwgJyQxLy8gJDInKTtcbiAgICB9XG5cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcblxuICAgIHRoaXMubWFyay5zZXQoYXJlYS5hZGRSaWdodChhZGQpKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuXG4gICAgaWYgKGNhcmV0LngpIGNhcmV0LmFkZFJpZ2h0KGFkZCk7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldCk7XG5cbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIGNsZWFyID0gdHJ1ZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgICBpZiAodGV4dC5zbGljZSgwLDIpID09PSAnLyonICYmIHRleHQuc2xpY2UoLTIpID09PSAnKi8nKSB7XG4gICAgICB0ZXh0ID0gdGV4dC5zbGljZSgyLC0yKTtcbiAgICAgIGFkZCAtPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkIC09IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRleHQgPSAnLyonICsgdGV4dCArICcqLyc7XG4gICAgICBhZGQgKz0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCArPSAyO1xuICAgIH1cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcbiAgICBhcmVhLmVuZC54ICs9IGFkZDtcbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldC5hZGRSaWdodChhZGQpKTtcbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxufTtcblxua2V5cy5zaW5nbGUgPSB7XG4gIC8vXG59O1xuXG4vLyBzZWxlY3Rpb24ga2V5c1xuWyAnaG9tZScsJ2VuZCcsXG4gICdwYWdldXAnLCdwYWdlZG93bicsXG4gICdsZWZ0JywndXAnLCdyaWdodCcsJ2Rvd24nLFxuICAnY3RybCtsZWZ0JywnY3RybCtyaWdodCdcbl0uZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAga2V5c1snc2hpZnQrJytrZXldID0gZnVuY3Rpb24oZSkge1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAga2V5c1trZXldLmNhbGwodGhpcywgZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH07XG59KTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLm1vdXNlID0gbmV3IE1vdXNlKHRoaXMpO1xuICB0aGlzLnRleHQgPSBuZXcgVGV4dDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSW5wdXQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSW5wdXQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJsdXIgPSB0aGlzLmJsdXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy50ZXh0Lm9uKFsna2V5JywgJ3RleHQnXSwgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2lucHV0JykpO1xuICB0aGlzLnRleHQub24oJ2ZvY3VzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJykpO1xuICB0aGlzLnRleHQub24oJ2JsdXInLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xuICB0aGlzLnRleHQucmVzZXQoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5ibHVyKCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmZvY3VzKCk7XG59O1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdXNlO1xuXG5mdW5jdGlvbiBNb3VzZSgpIHtcbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVzZXRDbGlja3MgPSBkZWJvdW5jZSh0aGlzLnJlc2V0Q2xpY2tzLmJpbmQodGhpcyksIDM1MClcbiAgdGhpcy5vbm1heWJlZHJhZyA9IHRoaXMub25tYXliZWRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRyYWcgPSB0aGlzLm9uZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZG93biA9IHRoaXMub25kb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub251cCA9IHRoaXMub251cC5iaW5kKHRoaXMpO1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xufTtcblxuTW91c2UucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgaWYgKHRoaXMubm9kZSkge1xuICAgIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gICAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3RvdWNoc3RhcnQnLCB0aGlzLm9uZG93bik7XG4gIH1cbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ3RvdWNoc3RhcnQnLCB0aGlzLm9uZG93bik7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kb3duID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5kb3duID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkb3duJywgZSk7XG4gIHRoaXMub25jbGljayhlKTtcbiAgdGhpcy5tYXliZURyYWcoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbnVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3VwJywgZSk7XG4gIGlmICghdGhpcy5kb3duKSByZXR1cm47XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuZHJhZ0VuZCgpO1xuICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uY2xpY2sgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucmVzZXRDbGlja3MoKTtcbiAgdGhpcy5jbGlja3MgPSAodGhpcy5jbGlja3MgJSAzKSArIDE7XG4gIHRoaXMuZW1pdCgnY2xpY2snLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbm1heWJlZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG5cbiAgdmFyIGQgPVxuICAgICAgTWF0aC5hYnModGhpcy5wb2ludC54IC0gdGhpcy5kb3duLngpXG4gICAgKyBNYXRoLmFicyh0aGlzLnBvaW50LnkgLSB0aGlzLmRvd24ueSk7XG5cbiAgaWYgKGQgPiA1KSB7XG4gICAgdGhpcy5tYXliZURyYWdFbmQoKTtcbiAgICB0aGlzLmRyYWdCZWdpbigpO1xuICB9XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkcmFnJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgYmVnaW4nKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBlbmQnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5yZXNldENsaWNrcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsaWNrcyA9IDA7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcblxudmFyIFRIUk9UVExFID0gMCAvLzEwMDAvNjI7XG5cbnZhciBtYXAgPSB7XG4gIDg6ICdiYWNrc3BhY2UnLFxuICA5OiAndGFiJyxcbiAgMTM6ICdlbnRlcicsXG4gIDMzOiAncGFnZXVwJyxcbiAgMzQ6ICdwYWdlZG93bicsXG4gIDM1OiAnZW5kJyxcbiAgMzY6ICdob21lJyxcbiAgMzc6ICdsZWZ0JyxcbiAgMzg6ICd1cCcsXG4gIDM5OiAncmlnaHQnLFxuICA0MDogJ2Rvd24nLFxuICA0NjogJ2RlbGV0ZScsXG4gIDQ4OiAnMCcsXG4gIDQ5OiAnMScsXG4gIDUwOiAnMicsXG4gIDUxOiAnMycsXG4gIDUyOiAnNCcsXG4gIDUzOiAnNScsXG4gIDU0OiAnNicsXG4gIDU1OiAnNycsXG4gIDU2OiAnOCcsXG4gIDU3OiAnOScsXG4gIDY1OiAnYScsXG4gIDY4OiAnZCcsXG4gIDcwOiAnZicsXG4gIDc3OiAnbScsXG4gIDc4OiAnbicsXG4gIDgzOiAncycsXG4gIDg5OiAneScsXG4gIDkwOiAneicsXG4gIDExMjogJ2YxJyxcbiAgMTE0OiAnZjMnLFxuICAxMjI6ICdmMTEnLFxuICAxODg6ICcsJyxcbiAgMTkwOiAnLicsXG4gIDE5MTogJy8nLFxuXG4gIC8vIG51bXBhZFxuICA5NzogJ2VuZCcsXG4gIDk4OiAnZG93bicsXG4gIDk5OiAncGFnZWRvd24nLFxuICAxMDA6ICdsZWZ0JyxcbiAgMTAyOiAncmlnaHQnLFxuICAxMDM6ICdob21lJyxcbiAgMTA0OiAndXAnLFxuICAxMDU6ICdwYWdldXAnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBUZXh0O1xuXG5UZXh0Lm1hcCA9IG1hcDtcblxuZnVuY3Rpb24gVGV4dCgpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGV4dGFyZWEnKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHBvc2l0aW9uOiAnYWJzb2x1dGUnLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIHdpZHRoOiAxLFxuICAgIGhlaWdodDogMSxcbiAgICBvcGFjaXR5OiAwLFxuICAgIHpJbmRleDogMTAwMDBcbiAgfSk7XG5cbiAgZG9tLmF0dHJzKHRoaXMsIHtcbiAgICBhdXRvY2FwaXRhbGl6ZTogJ25vbmUnLFxuICAgIGF1dG9jb21wbGV0ZTogJ29mZicsXG4gICAgc3BlbGxjaGVja2luZzogJ29mZicsXG4gIH0pO1xuXG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuVGV4dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5UZXh0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5vbmN1dCA9IHRoaXMub25jdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmNvcHkgPSB0aGlzLm9uY29weS5iaW5kKHRoaXMpO1xuICB0aGlzLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGUuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleXVwID0gdGhpcy5vbmtleXVwLmJpbmQodGhpcyk7XG4gIHRoaXMuZWwub25ibHVyID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKTtcbiAgdGhpcy5lbC5vbmZvY3VzID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJyk7XG4gIHRoaXMuZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5lbC5vbmtleXVwID0gdGhpcy5vbmtleXVwO1xuICB0aGlzLmVsLm9uY3V0ID0gdGhpcy5vbmN1dDtcbiAgdGhpcy5lbC5vbmNvcHkgPSB0aGlzLm9uY29weTtcbiAgdGhpcy5lbC5vbnBhc3RlID0gdGhpcy5vbnBhc3RlO1xuICB0aGlzLmNsZWFyID0gdGhyb3R0bGUodGhpcy5jbGVhci5iaW5kKHRoaXMpLCAyMDAwKVxufTtcblxuVGV4dC5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xufVxuXG5UZXh0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWwudmFsdWUuc3Vic3RyKC0xKTtcbn07XG5cblRleHQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHRoaXMuZWwudmFsdWUgPSB2YWx1ZTtcbn07XG5cbi8vVE9ETzogb24gbW9iaWxlIHdlIG5lZWQgdG8gY2xlYXIgd2l0aG91dCBkZWJvdW5jZVxuLy8gb3IgdGhlIHRleHRhcmVhIGNvbnRlbnQgaXMgZGlzcGxheWVkIGluIGhhY2tlcidzIGtleWJvYXJkXG4vLyBvciB5b3UgbmVlZCB0byBkaXNhYmxlIHdvcmQgc3VnZ2VzdGlvbnMgaW4gaGFja2VyJ3Mga2V5Ym9hcmQgc2V0dGluZ3NcblRleHQucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbn07XG5cblRleHQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5ibHVyKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmZvY3VzKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIC8vIGZvcmNlcyBjYXJldCB0byBlbmQgb2YgdGV4dGFyZWEgc28gd2UgY2FuIGdldCAuc2xpY2UoLTEpIGNoYXJcbiAgc2V0SW1tZWRpYXRlKCgpID0+IHRoaXMuZWwuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLmVsLnZhbHVlLmxlbmd0aCk7XG4gIHRoaXMuZW1pdCgndGV4dCcsIHRoaXMuZ2V0KCkpO1xuICB0aGlzLmNsZWFyKCk7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgLy8gY29uc29sZS5sb2coZS53aGljaCk7XG4gIHZhciBub3cgPSBEYXRlLm5vdygpO1xuICBpZiAobm93IC0gdGhpcy50aHJvdHRsZVRpbWUgPCBUSFJPVFRMRSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSBub3c7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0pO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXl1cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQgJiYgIWUuc2hpZnRLZXkpIGtleXMucHVzaCgnc2hpZnQ6dXAnKTtcbiAgaWYgKG0uY3RybCAmJiAhZS5jdHJsS2V5KSBrZXlzLnB1c2goJ2N0cmw6dXAnKTtcbiAgaWYgKG0uYWx0ICYmICFlLmFsdEtleSkga2V5cy5wdXNoKCdhbHQ6dXAnKTtcblxuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSArICc6dXAnKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9uY3V0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY3V0JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjb3B5JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbnBhc3RlID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgncGFzdGUnLCBlKTtcbn07XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi9saWIvcG9pbnQnKTtcblxudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3dvcmRzJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW92ZTtcblxuZnVuY3Rpb24gTW92ZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbn1cblxuTW92ZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlRG93biA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCBzaXplIC0gcmVtYWluZGVyKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcyhwYWdlKTtcbn07XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VVcCA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCAtKHNpemUgLSByZW1haW5kZXIpKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcygtcGFnZSk7XG59O1xuXG52YXIgbW92ZSA9IHt9O1xuXG5tb3ZlLmJ5V29yZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmUgPSBidWZmZXIuZ2V0TGluZVRleHQocC55KTtcblxuICBpZiAoZHggPiAwICYmIHAueCA+PSBsaW5lLmxlbmd0aCAtIDEpIHsgLy8gYXQgZW5kIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgKzEpOyAvLyBtb3ZlIG9uZSBjaGFyIHJpZ2h0XG4gIH0gZWxzZSBpZiAoZHggPCAwICYmIHAueCA9PT0gMCkgeyAvLyBhdCBiZWdpbiBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsIC0xKTsgLy8gbW92ZSBvbmUgY2hhciBsZWZ0XG4gIH1cblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UobGluZSwgV09SRFMpO1xuICB2YXIgd29yZDtcblxuICBpZiAoZHggPCAwKSB3b3Jkcy5yZXZlcnNlKCk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAoZHggPiAwXG4gICAgICA/IHdvcmQuaW5kZXggPiBwLnhcbiAgICAgIDogd29yZC5pbmRleCA8IHAueCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgeDogd29yZC5pbmRleCxcbiAgICAgICAgeTogcC55XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIHJlYWNoZWQgYmVnaW4vZW5kIG9mIGZpbGVcbiAgcmV0dXJuIGR4ID4gMFxuICAgID8gbW92ZS5lbmRPZkxpbmUoYnVmZmVyLCBwKVxuICAgIDogbW92ZS5iZWdpbk9mTGluZShidWZmZXIsIHApO1xufTtcblxubW92ZS5ieUNoYXJzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR4IDwgMCkgeyAvLyBnb2luZyBsZWZ0XG4gICAgeCArPSBkeDsgLy8gbW92ZSBsZWZ0XG4gICAgaWYgKHggPCAwKSB7IC8vIHdoZW4gcGFzdCBsZWZ0IGVkZ2VcbiAgICAgIGlmICh5ID4gMCkgeyAvLyBhbmQgbGluZXMgYWJvdmVcbiAgICAgICAgeSAtPSAxOyAvLyBtb3ZlIHVwIGEgbGluZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBhbmQgZ28gdG8gdGhlIGVuZCBvZiBsaW5lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB4ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAoZHggPiAwKSB7IC8vIGdvaW5nIHJpZ2h0XG4gICAgeCArPSBkeDsgLy8gbW92ZSByaWdodFxuICAgIHdoaWxlICh4IC0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoID4gMCkgeyAvLyB3aGlsZSBwYXN0IGxpbmUgbGVuZ3RoXG4gICAgICBpZiAoeSA9PT0gYnVmZmVyLmxvYygpKSB7IC8vIG9uIGVuZCBvZiBmaWxlXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGdvIHRvIGVuZCBvZiBsaW5lIG9uIGxhc3QgbGluZVxuICAgICAgICBicmVhazsgLy8gYW5kIGV4aXRcbiAgICAgIH1cbiAgICAgIHggLT0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoICsgMTsgLy8gd3JhcCB0aGlzIGxpbmUgbGVuZ3RoXG4gICAgICB5ICs9IDE7IC8vIGFuZCBtb3ZlIGRvd24gYSBsaW5lXG4gICAgfVxuICB9XG5cbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJ5TGluZXMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR5KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHkgPCAwKSB7IC8vIGdvaW5nIHVwXG4gICAgaWYgKHkgKyBkeSA+IDApIHsgLy8gd2hlbiBsaW5lcyBhYm92ZVxuICAgICAgeSArPSBkeTsgLy8gbW92ZSB1cFxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gMDtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZHkgPiAwKSB7IC8vIGdvaW5nIGRvd25cbiAgICBpZiAoeSA8IGJ1ZmZlci5sb2MoKSAtIGR5KSB7IC8vIHdoZW4gbGluZXMgYmVsb3dcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgZG93blxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gYnVmZmVyLmxvYygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmICh4ID4gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpIHtcbiAgLy8gICB4ID0gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGg7XG4gIC8vIH0gZWxzZSB7XG4gIC8vIH1cbiAgeCA9IE1hdGgubWluKHRoaXMubGFzdERlbGliZXJhdGVYLCBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGgpO1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZMaW5lID0gZnVuY3Rpb24oXywgcCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZMaW5lID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUocC55KS5sZW5ndGg7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gSW5maW5pdHk7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkZpbGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9O1xufTtcblxubW92ZS5lbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IGxhc3RcbiAgfTtcbn07XG5cbm1vdmUuaXNCZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgcmV0dXJuIHAueCA9PT0gMCAmJiBwLnkgPT09IDA7XG59O1xuXG5tb3ZlLmlzRW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICByZXR1cm4gcC55ID09PSBsYXN0ICYmIHAueCA9PT0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoO1xufTtcblxuT2JqZWN0LmtleXMobW92ZSkuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgTW92ZS5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKHBhcmFtLCBieUVkaXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbW92ZVttZXRob2RdLmNhbGwoXG4gICAgICB0aGlzLFxuICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLFxuICAgICAgdGhpcy5lZGl0b3IuY2FyZXQsXG4gICAgICBwYXJhbVxuICAgICk7XG5cbiAgICBpZiAoJ2lzJyA9PT0gbWV0aG9kLnNsaWNlKDAsMikpIHJldHVybiByZXN1bHQ7XG5cbiAgICB0aGlzLmVtaXQoJ21vdmUnLCByZXN1bHQsIGJ5RWRpdCk7XG4gIH07XG59KTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZWRpdG9yXCI6XCJfc3JjX3N0eWxlX19lZGl0b3JcIixcImxheWVyXCI6XCJfc3JjX3N0eWxlX19sYXllclwiLFwicm93c1wiOlwiX3NyY19zdHlsZV9fcm93c1wiLFwibWFya1wiOlwiX3NyY19zdHlsZV9fbWFya1wiLFwiY29kZVwiOlwiX3NyY19zdHlsZV9fY29kZVwiLFwiY2FyZXRcIjpcIl9zcmNfc3R5bGVfX2NhcmV0XCIsXCJibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2JsaW5rLXNtb290aFwiLFwiY2FyZXQtYmxpbmstc21vb3RoXCI6XCJfc3JjX3N0eWxlX19jYXJldC1ibGluay1zbW9vdGhcIixcImd1dHRlclwiOlwiX3NyY19zdHlsZV9fZ3V0dGVyXCIsXCJydWxlclwiOlwiX3NyY19zdHlsZV9fcnVsZXJcIixcImFib3ZlXCI6XCJfc3JjX3N0eWxlX19hYm92ZVwiLFwiZmluZFwiOlwiX3NyY19zdHlsZV9fZmluZFwiLFwiYmxvY2tcIjpcIl9zcmNfc3R5bGVfX2Jsb2NrXCJ9IiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG52YXIgdGhlbWVzID0ge1xuICBtb25va2FpOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzI4MjInLFxuICAgIGNvbG9yOiAnI0Y4RjhGMicsXG4gICAga2V5d29yZDogJyNERjIyNjYnLFxuICAgIGZ1bmN0aW9uOiAnI0EwRDkyRScsXG4gICAgZGVjbGFyZTogJyM2MUNDRTAnLFxuICAgIG51bWJlcjogJyNBQjdGRkInLFxuICAgIHBhcmFtczogJyNGRDk3MUYnLFxuICAgIGNvbW1lbnQ6ICcjNzU3MTVFJyxcbiAgICBzdHJpbmc6ICcjRTZEQjc0JyxcbiAgfSxcblxuICB3ZXN0ZXJuOiB7XG4gICAgYmFja2dyb3VuZDogJyNEOUQxQjEnLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyM3QTNCM0InLFxuICAgIGZ1bmN0aW9uOiAnIzI1NkY3NScsXG4gICAgZGVjbGFyZTogJyM2MzQyNTYnLFxuICAgIG51bWJlcjogJyMxMzREMjYnLFxuICAgIHBhcmFtczogJyMwODI2NjMnLFxuICAgIGNvbW1lbnQ6ICcjOTk4RTZFJyxcbiAgICBzdHJpbmc6ICcjQzQzQzNDJyxcbiAgfSxcblxuICByZWRibGlzczoge1xuICAgIGJhY2tncm91bmQ6ICcjMjcxRTE2JyxcbiAgICBjb2xvcjogJyNFOUUzRDEnLFxuICAgIGtleXdvcmQ6ICcjQTEzNjMwJyxcbiAgICBmdW5jdGlvbjogJyNCM0RGMDInLFxuICAgIGRlY2xhcmU6ICcjRjYzODMzJyxcbiAgICBudW1iZXI6ICcjRkY5RjRFJyxcbiAgICBwYXJhbXM6ICcjQTA5MEEwJyxcbiAgICByZWdleHA6ICcjQkQ3MEY0JyxcbiAgICBjb21tZW50OiAnIzYzNTA0NycsXG4gICAgc3RyaW5nOiAnIzNFQTFGQicsXG4gIH0sXG5cbiAgZGF5bGlnaHQ6IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0VCRUJFQicsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnI0ZGMUIxQicsXG4gICAgZnVuY3Rpb246ICcjMDAwNUZGJyxcbiAgICBkZWNsYXJlOiAnIzBDN0EwMCcsXG4gICAgbnVtYmVyOiAnIzgwMjFENCcsXG4gICAgcGFyYW1zOiAnIzRDNjk2OScsXG4gICAgY29tbWVudDogJyNBQkFCQUInLFxuICAgIHN0cmluZzogJyNFNjcwMDAnLFxuICB9LFxufTtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gc2V0VGhlbWU7XG5leHBvcnRzLnRoZW1lcyA9IHRoZW1lcztcblxuLypcbnQ6IG9wZXJhdG9yXG5rOiBrZXl3b3JkXG5kOiBkZWNsYXJlXG5iOiBidWlsdGluXG5vOiBib29sZWFuXG5uOiBudW1iZXJcbm06IHBhcmFtc1xuZjogZnVuY3Rpb25cbnI6IHJlZ2V4cFxuYzogY29tbWVudFxuczogc3RyaW5nXG5sOiBzeW1ib2xcbng6IGluZGVudFxuICovXG5mdW5jdGlvbiBzZXRUaGVtZShuYW1lKSB7XG4gIHZhciB0ID0gdGhlbWVzW25hbWVdO1xuICBkb20uY3NzKCd0aGVtZScsXG5gXG4uJHtuYW1lfSxcbi4ke2Nzcy5yb3dzfSB7XG4gIGJhY2tncm91bmQ6ICR7dC5iYWNrZ3JvdW5kfTtcbn1cblxudCxcbmsge1xuICBjb2xvcjogJHt0LmtleXdvcmR9O1xufVxuXG5kLFxubiB7XG4gIGNvbG9yOiAke3QuZGVjbGFyZX07XG59XG5cbm8sXG5lIHtcbiAgY29sb3I6ICR7dC5udW1iZXJ9O1xufVxuXG5tIHtcbiAgY29sb3I6ICR7dC5wYXJhbXN9O1xufVxuXG5mIHtcbiAgY29sb3I6ICR7dC5mdW5jdGlvbn07XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxuciB7XG4gIGNvbG9yOiAke3QucmVnZXhwIHx8IHQucGFyYW1zfTtcbn1cblxuYyB7XG4gIGNvbG9yOiAke3QuY29tbWVudH07XG59XG5cbnMge1xuICBjb2xvcjogJHt0LnN0cmluZ307XG59XG5cbmwsXG4uJHtjc3MuY29kZX0ge1xuICBjb2xvcjogJHt0LmNvbG9yfTtcbn1cblxuLiR7Y3NzLmNhcmV0fSB7XG4gIGJhY2tncm91bmQ6ICR7dC5jb2xvcn07XG59XG5cbm0sXG5kIHtcbiAgZm9udC1zdHlsZTogaXRhbGljO1xufVxuXG5sIHtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG54IHtcbiAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICBiYWNrZ3JvdW5kLXJlcGVhdDogbm8tcmVwZWF0O1xufVxuYFxuICApXG5cbn1cblxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvY2tWaWV3O1xuXG5mdW5jdGlvbiBCbG9ja1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnYmxvY2snO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuYmxvY2spO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuQmxvY2tWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQmxvY2tWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuQmxvY2tWaWV3LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihlKSB7XG4gIHZhciBodG1sID0gJyc7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcblxuICB2YXIgcmVzdWx0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5T2Zmc2V0KCdibG9ja3MnLCBvZmZzZXQpO1xuICBpZiAoIXJlc3VsdCkgcmV0dXJuIGh0bWw7XG5cbiAgdmFyIGxlbmd0aCA9IGUuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdibG9ja3MnKS5sZW5ndGg7XG4gIHZhciBjaGFyID0gZS5idWZmZXIuY2hhckF0KHJlc3VsdCk7XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgaSA9IHJlc3VsdC5pbmRleDtcbiAgdmFyIG9wZW5PZmZzZXQgPSByZXN1bHQub2Zmc2V0O1xuXG4gIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG5cbiAgdmFyIGNvdW50ID0gcmVzdWx0Lm9mZnNldCA+PSBvZmZzZXQgLSAxICYmIENsb3NlW2NoYXJdID8gMCA6IDE7XG5cbiAgdmFyIGxpbWl0ID0gMjAwO1xuXG4gIHdoaWxlIChpID4gMCkge1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAoIS0tbGltaXQpIHJldHVybiBodG1sO1xuXG4gICAgaWYgKG9wZW4gJiYgIS0tY291bnQpIGJyZWFrO1xuXG4gICAgb3Blbk9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCAtLWkpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIGNvdW50ID0gMTtcblxuICB2YXIgY2xvc2VPZmZzZXQ7XG5cbiAgd2hpbGUgKGkgPCBsZW5ndGggLSAxKSB7XG4gICAgY2xvc2VPZmZzZXQgPSBlLmJ1ZmZlci50b2tlbnMuZ2V0QnlJbmRleCgnYmxvY2tzJywgKytpKTtcbiAgICBjaGFyID0gZS5idWZmZXIuY2hhckF0KGNsb3NlT2Zmc2V0KTtcbiAgICBpZiAoIS0tbGltaXQpIHJldHVybiBodG1sO1xuXG4gICAgY2xvc2UgPSBDbG9zZVtjaGFyXTtcbiAgICBpZiAoT3BlbltjaGFyXSA9PT0gb3BlbikgY291bnQrKztcbiAgICBpZiAob3BlbiA9PT0gY2xvc2UpIGNvdW50LS07XG5cbiAgICBpZiAoIWNvdW50KSBicmVhaztcbiAgfVxuXG4gIGlmIChjb3VudCkgcmV0dXJuIGh0bWw7XG5cbiAgdmFyIGJlZ2luID0gZS5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob3Blbk9mZnNldCk7XG4gIHZhciBlbmQgPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChjbG9zZU9mZnNldCk7XG5cbiAgdmFyIHRhYnM7XG5cbiAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKGJlZ2luKTtcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGJlZ2luLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoYmVnaW4ueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmNvZGVMZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5jb2RlTGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICByZXR1cm4gaHRtbDtcbn1cblxuQmxvY2tWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGh0bWwgPSB0aGlzLmdldCh0aGlzLmVkaXRvcik7XG5cbiAgaWYgKGh0bWwgIT09IHRoaXMuaHRtbCkge1xuICAgIHRoaXMuaHRtbCA9IGh0bWw7XG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG4gIH1cbn07XG5cbkJsb2NrVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ2FyZXRWaWV3O1xuXG5mdW5jdGlvbiBDYXJldFZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnY2FyZXQnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY2FyZXQpO1xufVxuXG5DYXJldFZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5DYXJldFZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5DYXJldFZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIG9wYWNpdHk6ICt0aGlzLmVkaXRvci5oYXNGb2N1cyxcbiAgICBsZWZ0OiB0aGlzLmVkaXRvci5jYXJldFB4LnggKyB0aGlzLmVkaXRvci5jb2RlTGVmdCxcbiAgICB0b3A6IHRoaXMuZWRpdG9yLmNhcmV0UHgueSAtIDEsXG4gICAgaGVpZ2h0OiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCArIDFcbiAgfSk7XG59O1xuXG5DYXJldFZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgb3BhY2l0eTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxudmFyIEFoZWFkVGhyZXNob2xkID0ge1xuICBhbmltYXRpb246IFsuMTUsIC40XSxcbiAgbm9ybWFsOiBbMiwgNF1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ29kZVZpZXc7XG5cbmZ1bmN0aW9uIENvZGVWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcblxuICB0aGlzLm5hbWUgPSAnY29kZSc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jb2RlKTtcbiAgdGhpcy5wYXJ0cyA9IFtdO1xuICB0aGlzLm9mZnNldCA9IHsgdG9wOiAwLCBsZWZ0OiAwIH07XG59XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5hcHBlbmRQYXJ0cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LmFwcGVuZCgpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJQYXJ0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHBhcnQgPSBuZXcgUGFydCh0aGlzLCByYW5nZSk7XG4gIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgcGFydC5yZW5kZXIoKTtcbiAgcGFydC5hcHBlbmQoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJFZGl0ID0gZnVuY3Rpb24oZWRpdCkge1xuICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgaWYgKGVkaXQuc2hpZnQgPiAwKSB0aGlzLnJlbmRlckluc2VydChlZGl0KTtcbiAgZWxzZSBpZiAoZWRpdC5zaGlmdCA8IDApIHRoaXMucmVuZGVyUmVtb3ZlKGVkaXQpO1xuICBlbHNlIHRoaXMucmVuZGVyTGluZShlZGl0KTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJQYWdlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFswLDBdKTtcbiAgdmFyIGluUGFydHMgPSB0aGlzLmluUmFuZ2VQYXJ0cyhwYWdlKTtcbiAgdmFyIG5lZWRSYW5nZXMgPSBSYW5nZS5OT1QocGFnZSwgdGhpcy5wYXJ0cyk7XG4gIG5lZWRSYW5nZXMuZm9yRWFjaChyYW5nZSA9PiB0aGlzLnJlbmRlclBhcnQocmFuZ2UpKTtcbiAgaW5QYXJ0cy5mb3JFYWNoKHBhcnQgPT4gcGFydC5yZW5kZXIoKSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyUmVtb3ZlID0gZnVuY3Rpb24oZWRpdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzLnNsaWNlKCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHBhcnRzW2ldO1xuICAgIGlmIChwYXJ0WzBdID4gZWRpdC5yYW5nZVswXSAmJiBwYXJ0WzFdIDwgZWRpdC5yYW5nZVsxXSkge1xuICAgICAgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdIDwgZWRpdC5saW5lICYmIHBhcnRbMV0gPj0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0WzFdID0gZWRpdC5saW5lIC0gMTtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICAgIHRoaXMucmVuZGVyUGFydChbZWRpdC5saW5lLCBlZGl0LmxpbmVdKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lICYmIHBhcnRbMV0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lICYmIHBhcnRbMV0gPiBlZGl0LmxpbmUpIHtcbiAgICAgIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICAgIHRoaXMucmVuZGVyUGFydChbZWRpdC5saW5lLCBlZGl0LmxpbmVdKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSAmJiBwYXJ0WzBdICsgZWRpdC5zaGlmdCA8PSBlZGl0LmxpbmUpIHtcbiAgICAgIHZhciBvZmZzZXQgPSBlZGl0LmxpbmUgLSAocGFydFswXSArIGVkaXQuc2hpZnQpICsgMTtcbiAgICAgIHBhcnRbMF0gKz0gZWRpdC5zaGlmdCArIG9mZnNldDtcbiAgICAgIHBhcnRbMV0gKz0gZWRpdC5zaGlmdCArIG9mZnNldDtcbiAgICAgIHBhcnQub2Zmc2V0KG9mZnNldCk7XG4gICAgICBpZiAocGFydFswXSA+PSBwYXJ0WzFdKSB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMF0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnRbMV0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJQYWdlKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVySW5zZXJ0ID0gZnVuY3Rpb24oZWRpdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzLnNsaWNlKCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHBhcnRzW2ldO1xuICAgIGlmIChwYXJ0WzBdIDwgZWRpdC5saW5lICYmIHBhcnRbMV0gPj0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0WzFdID0gZWRpdC5saW5lIC0gMTtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICAgIHRoaXMucmVuZGVyUGFydChlZGl0LnJhbmdlKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0WzBdICs9IGVkaXQuc2hpZnQ7XG4gICAgICBwYXJ0WzFdICs9IGVkaXQuc2hpZnQ7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUGFnZSgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckxpbmUgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSAmJiBwYXJ0WzFdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPD0gZWRpdC5saW5lICYmIHBhcnRbMV0gPj0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0WzFdID0gZWRpdC5saW5lIC0gMTtcbiAgICAgIGlmIChwYXJ0WzFdIDwgcGFydFswXSkgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpXG4gICAgICBlbHNlIHBhcnQuc3R5bGUoKTtcbiAgICAgIHRoaXMucmVuZGVyUGFydChlZGl0LnJhbmdlKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJQYWdlKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVtb3ZlUGFydCA9IGZ1bmN0aW9uKHBhcnQpIHtcbiAgcGFydC5jbGVhcigpO1xuICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YocGFydCksIDEpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLmNsZWFyT3V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdGhpcy5vdXRSYW5nZVBhcnRzKHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShyYW5nZSkpXG4gICAgLmZvckVhY2gocGFydCA9PiB0aGlzLnJlbW92ZVBhcnQocGFydCkpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLmluUmFuZ2VQYXJ0cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHRoaXMucGFydHNbaV07XG4gICAgaWYgKCBwYXJ0WzBdID49IHJhbmdlWzBdICYmIHBhcnRbMF0gPD0gcmFuZ2VbMV1cbiAgICAgIHx8IHBhcnRbMV0gPj0gcmFuZ2VbMF0gJiYgcGFydFsxXSA8PSByYW5nZVsxXSApIHtcbiAgICAgIHBhcnRzLnB1c2gocGFydCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5vdXRSYW5nZVBhcnRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gdGhpcy5wYXJ0c1tpXTtcbiAgICBpZiAoIHBhcnRbMV0gPCByYW5nZVswXVxuICAgICAgfHwgcGFydFswXSA+IHJhbmdlWzFdICkge1xuICAgICAgcGFydHMucHVzaChwYXJ0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKG9wdHMgPSB7fSkge1xuICBpZiAob3B0cy5vZmZzZXQpIHRoaXMub2Zmc2V0ID0gb3B0cy5vZmZzZXQ7XG4gIC8vIGlmICh0aGlzLmVkaXRvci5lZGl0aW5nKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuXG4gIGlmIChSYW5nZS5OT1QocGFnZSwgdGhpcy5wYXJ0cykubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKFJhbmdlLkFORChwYWdlLCB0aGlzLnBhcnRzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgICB0aGlzLnJlbmRlclBhcnQocGFnZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdXVxuICAgIDogWy1BaGVhZFRocmVzaG9sZC5ub3JtYWxbMF0sICtBaGVhZFRocmVzaG9sZC5ub3JtYWxbMF1dO1xuXG4gIHZhciBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gIHZhciBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdGhpcy5wYXJ0cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG5cbiAgICB0aHJlc2hvbGQgPSB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdXVxuICAgICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFsxXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFsxXV07XG5cbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG5cbiAgICBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gICAgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHRoaXMucGFydHMpO1xuICAgIGFoZWFkTmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHtcbiAgICAgIHRoaXMucmVuZGVyUGFydChyYW5nZSk7XG4gICAgfSk7XG4gIH1cbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LmNsZWFyKCkpO1xuICB0aGlzLnBhcnRzID0gW107XG59O1xuXG5mdW5jdGlvbiBQYXJ0KHZpZXcsIHJhbmdlKSB7XG4gIHRoaXMudmlldyA9IHZpZXc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jb2RlKTtcbiAgdGhpcy5jb2RlID0gJyc7XG4gIHRoaXMub2Zmc2V0VG9wID0gMDtcbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG5cbiAgdmFyIHN0eWxlID0ge307XG5cbiAgaWYgKHRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnMuaW5kZXhPZih0aGlzLnZpZXcubmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICAgIHN0eWxlLm9wYWNpdHkgPSAwLjU7XG4gIH1cblxuICBkb20uc3R5bGUodGhpcywgc3R5bGUpO1xufVxuXG5QYXJ0LnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMub2Zmc2V0VG9wICs9IHk7XG4gIHRoaXMuY29kZSA9IHRoaXMuY29kZS5zcGxpdCgvXFxuL2cpLnNsaWNlKHkpLmpvaW4oJ1xcbicpO1xuICB0aGlzWzFdIC09IHk7XG4gIHRoaXMuc3R5bGUoKTtcbiAgdGhpcy5kb20uZWwuc2Nyb2xsVG9wID0gdGhpcy5vZmZzZXRUb3AgKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0O1xufTtcblxuUGFydC5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5hcHBlbmQodGhpcy52aWV3LnRhcmdldCwgdGhpcyk7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLnZpZXcuZWRpdG9yLmJ1ZmZlci5nZXQodGhpcyk7XG4gIGlmIChjb2RlICE9PSB0aGlzLmNvZGUpIHtcbiAgICBkb20uaHRtbCh0aGlzLCBjb2RlKTtcbiAgICB0aGlzLmNvZGUgPSBjb2RlO1xuICB9XG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblBhcnQucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAodGhpc1sxXSAtIHRoaXNbMF0gKyAxKSAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgdG9wOiB0aGlzWzBdICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodFxuICAgICAgLXRoaXMudmlldy5vZmZzZXQudG9wXG4gIH0pO1xufTtcblxuUGFydC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSlcbiAgc2NoZWR1bGVUb1JlbW92ZSh0aGlzKVxufTtcblxudmFyIHNjaGVkdWxlZEZvclJlbW92YWwgPSBbXVxudmFyIHJlbW92ZVRpbWVvdXRcblxuZnVuY3Rpb24gc2NoZWR1bGVUb1JlbW92ZShlbCkge1xuICBzY2hlZHVsZWRGb3JSZW1vdmFsLnB1c2goZWwpXG4gIGNsZWFyVGltZW91dChyZW1vdmVUaW1lb3V0KVxuICBpZiAoc2NoZWR1bGVkRm9yUmVtb3ZhbC5sZW5ndGggPiAxMCkge1xuICAgIHJldHVybiByZW1vdmVTY2hlZHVsZWQoKVxuICB9XG4gIHJlbW92ZVRpbWVvdXQgPSBzZXRUaW1lb3V0KHJlbW92ZVNjaGVkdWxlZCwgOTAwKVxufVxuXG5mdW5jdGlvbiByZW1vdmVTY2hlZHVsZWQoKSB7XG4gIHZhciBlbFxuICB3aGlsZSAoZWwgPSBzY2hlZHVsZWRGb3JSZW1vdmFsLnBvcCgpKSB7XG4gICAgZG9tLnJlbW92ZShlbClcbiAgfVxufVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmluZFZpZXc7XG5cbmZ1bmN0aW9uIEZpbmRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2ZpbmQnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuZmluZCk7XG59XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuRmluZFZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIHJlc3VsdHMgPSBlLmZpbmRSZXN1bHRzO1xuXG4gIHZhciBiZWdpbiA9IDA7XG4gIHZhciBlbmQgPSByZXN1bHRzLmxlbmd0aDtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGkgPSAtMTtcblxuICBkbyB7XG4gICAgcHJldiA9IGk7XG4gICAgaSA9IGJlZ2luICsgKGVuZCAtIGJlZ2luKSAvIDIgfCAwO1xuICAgIGlmIChyZXN1bHRzW2ldLnkgPCByYW5nZVswXSAtIDEpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHByZXYgIT09IGkpO1xuXG4gIHZhciB3aWR0aCA9IGUuZmluZFZhbHVlLmxlbmd0aCAqIGUuY2hhci53aWR0aCArICdweCc7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgdmFyIHRhYnM7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKHIpO1xuICAgIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICAgICsgJ3dpZHRoOicgKyB3aWR0aCArICc7J1xuICAgICAgICAgICsgJ3RvcDonICsgKHIueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgICArICdsZWZ0OicgKyAoKHIueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuY29kZUxlZnQpICsgJ3B4OydcbiAgICAgICAgICArICdcIj48L2k+JztcbiAgfVxuXG4gIHJldHVybiBodG1sO1xufTtcblxuRmluZFZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uaHRtbCh0aGlzLCAnJyk7XG59O1xuIiwidmFyIFJ1bGVyVmlldyA9IHJlcXVpcmUoJy4vcnVsZXInKTtcbnZhciBNYXJrVmlldyA9IHJlcXVpcmUoJy4vbWFyaycpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgQ2FyZXRWaWV3ID0gcmVxdWlyZSgnLi9jYXJldCcpO1xudmFyIEJsb2NrVmlldyA9IHJlcXVpcmUoJy4vYmxvY2snKTtcbnZhciBGaW5kVmlldyA9IHJlcXVpcmUoJy4vZmluZCcpO1xudmFyIFJvd3NWaWV3ID0gcmVxdWlyZSgnLi9yb3dzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlld3M7XG5cbmZ1bmN0aW9uIFZpZXdzKGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcblxuICB0aGlzLnZpZXdzID0gW1xuICAgIG5ldyBSdWxlclZpZXcoZWRpdG9yKSxcbiAgICBuZXcgTWFya1ZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQ29kZVZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQ2FyZXRWaWV3KGVkaXRvciksXG4gICAgbmV3IEJsb2NrVmlldyhlZGl0b3IpLFxuICAgIG5ldyBGaW5kVmlldyhlZGl0b3IpLFxuICAgIG5ldyBSb3dzVmlldyhlZGl0b3IpLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcbn1cblxuVmlld3MucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcudXNlKGVsKSk7XG59O1xuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFya1ZpZXc7XG5cbmZ1bmN0aW9uIE1hcmtWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ21hcmsnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MubWFyayk7XG59XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuTWFya1ZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5NYXJrVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldHMgPSBlLmJ1ZmZlci5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcblxuICBhcmVhWzBdIC09IG9mZnNldHNbMF07XG4gIGFyZWFbMV0gLT0gb2Zmc2V0c1swXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGFib3ZlLnJlcGxhY2UoL1teXFxuXS9nLCAnICcpIC8vZS5zeW50YXguZW50aXRpZXMoYWJvdmUpXG4gICAgKyAnPG1hcms+JyArIG1pZGRsZS5yZXBsYWNlKC9bXlxcbl0vZywgJyAnKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHRvcDogcGFnZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgIGhlaWdodDogJ2F1dG8nXG4gIH0pO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb3dzVmlldztcblxuZnVuY3Rpb24gUm93c1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAncm93cyc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5yb3dzKTtcbiAgdGhpcy5yb3dzID0gLTE7XG4gIHRoaXMucmFuZ2UgPSBbLTEsLTFdO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuUm93c1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Sb3dzVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMSwrMV0pO1xuXG4gIGlmICggcmFuZ2VbMF0gPj0gdGhpcy5yYW5nZVswXVxuICAgICYmIHJhbmdlWzFdIDw9IHRoaXMucmFuZ2VbMV1cbiAgICAmJiAoIHRoaXMucmFuZ2VbMV0gIT09IHRoaXMucm93c1xuICAgICAgfHwgdGhpcy5lZGl0b3Iucm93cyA9PT0gdGhpcy5yb3dzXG4gICAgKSkgcmV0dXJuO1xuXG4gIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMywrM10pO1xuICB0aGlzLnJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICB0aGlzLnJhbmdlID0gcmFuZ2U7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgZm9yICh2YXIgaSA9IHJhbmdlWzBdOyBpIDw9IHJhbmdlWzFdOyBpKyspIHtcbiAgICBodG1sICs9IChpICsgMSkgKyAnXFxuJztcbiAgfVxuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuXG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG5cbiAgICBkb20uc3R5bGUodGhpcywge1xuICAgICAgdG9wOiByYW5nZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgfSk7XG4gIH1cbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSdWxlclZpZXc7XG5cbmZ1bmN0aW9uIFJ1bGVyVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdydWxlcic7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5ydWxlcik7XG59XG5cblJ1bGVyVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cblJ1bGVyVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJ1bGVyVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIC8vIGhlaWdodDogdGhpcy5lZGl0b3IuaGVpZ2h0XG4gICAgLy8gKHRoaXMuZWRpdG9yLnJvd3MgKyB0aGlzLmVkaXRvci5wYWdlLmhlaWdodClcbiAgICAvLyAgICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHRcbiAgICAvLyAgICsgdGhpcy5lZGl0b3IucGFnZVJlbWFpbmRlci5oZWlnaHRcbiAgfSk7XG59O1xuXG5SdWxlclZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5mdW5jdGlvbiBWaWV3KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbn1cblxuVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRocm93IG5ldyBFcnJvcigncmVuZGVyIG5vdCBpbXBsZW1lbnRlZCcpO1xufTtcblxuVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdjbGVhciBub3QgaW1wbGVtZW50ZWQnKTtcbn07XG4iXX0=
