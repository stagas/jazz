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
    renderRequest: null
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
  this.input.use(this.el);
  dom.append(this.views.caret, this.input.text);
  this.views.use(this.el);

  setTimeout(this.repaint, 0);

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
  this.repaint = this.repaint.bind(this);
};

Jazz.prototype.bindHandlers = function () {
  for (var method in this) {
    if ('on' === method.slice(0, 2)) {
      this[method] = this[method].bind(this);
    }
  }
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
  this.repaint();
};

Jazz.prototype.onHistoryChange = function () {
  this.render('code');
  this.render('mark');
  this.render('block');
  this.followCaret();
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
    length = this.buffer.insert(this.caret, text);
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

Jazz.prototype.repaint = bindRaf(function () {
  this.resize();
  this.views.render();
});

Jazz.prototype.resize = function () {
  var $ = this.el;

  dom.css(this.id, '\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n    ');

  this.offset.set(dom.getOffset($));
  this.scroll.set(dom.getScroll($));
  this.size.set(dom.getSize($));

  // this is a weird fix when doing multiple .use()
  if (this.char.width === 0) this.char.set(dom.getCharSize($, css.code));

  this.rows = this.buffer.loc();
  this.code = this.buffer.text.length;
  this.page.set(this.size['^/'](this.char));
  this.pageRemainder.set(this.size['-'](this.page['_*'](this.char)));
  this.pageBounds = [0, this.rows];
  // this.longestLine = Math.min(500, this.buffer.lines.getLongestLineLength());

  this.gutter = Math.max(this.options.hide_rows ? 0 : ('' + this.rows).length, (this.options.center_horizontal ? Math.max(('' + this.rows).length, (this.page.width - 81 - (this.options.hide_rows ? 0 : ('' + this.rows).length)) / 2 | 0) : 0) + (this.options.hide_rows ? 0 : Math.max(3, ('' + this.rows).length))) * this.char.width + (this.options.hide_rows ? 0 : this.options.gutter_margin * (this.options.center_horizontal ? -1 : 1));

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

  dom.css(this.id, '\n    #' + this.id + ' {\n      top: ' + (this.options.center_vertical ? this.size.height / 3 : 0) + 'px;\n    }\n\n    .' + css.rows + ',\n    .' + css.mark + ',\n    .' + css.code + ',\n    mark,\n    p,\n    t,\n    k,\n    d,\n    n,\n    o,\n    e,\n    m,\n    f,\n    r,\n    c,\n    s,\n    l,\n    x {\n      font-family: monospace;\n      font-size: ' + this.options.font_size + ';\n      line-height: ' + this.options.line_height + ';\n    }\n\n    #' + this.id + ' > .' + css.ruler + ',\n    #' + this.id + ' > .' + css.find + ',\n    #' + this.id + ' > .' + css.mark + ',\n    #' + this.id + ' > .' + css.code + ' {\n      margin-left: ' + this.marginLeft + 'px;\n      tab-size: ' + this.tabSize + ';\n    }\n    #' + this.id + ' > .' + css.rows + ' {\n      padding-right: ' + this.options.gutter_margin + 'px;\n      padding-left: ' + this.options.margin_left + 'px;\n      width: ' + this.marginLeft + 'px;\n    }\n    #' + this.id + ' > .' + css.find + ' > i,\n    #' + this.id + ' > .' + css.block + ' > i {\n      height: ' + (this.char.height + 1) + 'px;\n    }\n    x {\n      background-image: url(' + dataURL + ');\n    }');

  this.emit('resize');
};

Jazz.prototype.clear = function (name) {
  this.views[name].clear();
};

Jazz.prototype.render = function (name) {
  cancelAnimationFrame(this.renderRequest);
  if (!~this.renderQueue.indexOf(name)) {
    if (name in this.views) {
      this.renderQueue.push(name);
    }
  }
  this.renderRequest = requestAnimationFrame(this._render.bind(this));
};

Jazz.prototype._render = function () {
  var _this4 = this;

  this.renderQueue.forEach(function (name) {
    return _this4.views[name].render();
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
  paddingLeft: 'px'
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

  span.innerHTML = ' ';
  var a = span.getBoundingClientRect();

  span.innerHTML = '  \n ';
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

  // this.emit('raw', this.raw);
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
  if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
  //TODO: currently will not reach last line
  // because it's buggy
  if (area.begin.y + y < 0 || area.end.y + y > this.loc()) return false;

  area.begin.x = 0;
  area.end.x = 0;

  var text = this.getLineRangeText([area.begin.y, area.end.y - 1]);
  this.removeArea(area);

  this.insert({ x: 0, y: area.begin.y + y }, text);

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
  return part[index - part.startIndex] + part.startOffset;
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
  this.emit('set');
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
}

History.prototype.__proto__ = Event.prototype;

History.prototype.save = function (force) {
  if (Date.now() - this.timeStart > 2000 || force) this.actuallySave();
  this.timeout = this.debouncedSave();
};

History.prototype.debouncedSave = debounce(function () {
  this.actuallySave();
}, 700);

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
    if (this.buffer.moveAreaByLines(-1, area)) {
      this.mark.shiftByLines(-1);
      this.move.byLines(-1, true);
    }
  },

  'shift+ctrl+down': function shiftCtrlDown() {
    this.emit('input', '\uAAA3', this.caret.copy(), this.mark.copy(), this.mark.active);
    this.markBegin(false);
    var area = this.mark.get();
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
      text = this.buffer.getArea(area);
    } else {
      area = this.mark.get();
      this.mark.addBottom(area.end.x > 0).setLeft(0);
      text = this.buffer.getArea(this.mark.get());
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
    var text = this.buffer.getArea(area);
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

Mouse.prototype.resetClicks = debounce(function () {
  this.clicks = 0;
}, 350);

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
Text.prototype.clear = throttle(function () {
  this.set('');
}, 2000);

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
  dom.css('theme', '\n.' + name + ' {\n  background: ' + t.background + ';\n}\n\nt,\nk {\n  color: ' + t.keyword + ';\n}\n\nd,\nn {\n  color: ' + t.declare + ';\n}\n\no,\ne {\n  color: ' + t.number + ';\n}\n\nm {\n  color: ' + t.params + ';\n}\n\nf {\n  color: ' + t.function + ';\n  font-style: normal;\n}\n\nr {\n  color: ' + (t.regexp || t.params) + ';\n}\n\nc {\n  color: ' + t.comment + ';\n}\n\ns {\n  color: ' + t.string + ';\n}\n\nl,\n.' + css.code + ' {\n  color: ' + t.color + ';\n}\n\n.' + css.caret + ' {\n  background: ' + t.color + ';\n}\n\nm,\nd {\n  font-style: italic;\n}\n\nl {\n  font-style: normal;\n}\n\nx {\n  display: inline-block;\n  background-repeat: no-repeat;\n}\n');
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

  html += '<i style="' + 'width:' + e.char.width + 'px;' + 'top:' + begin.y * e.char.height + 'px;' + 'left:' + ((begin.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.gutter + e.options.margin_left) + 'px;' + '"></i>';

  tabs = e.getPointTabs(end);

  html += '<i style="' + 'width:' + e.char.width + 'px;' + 'top:' + end.y * e.char.height + 'px;' + 'left:' + ((end.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.gutter + e.options.margin_left) + 'px;' + '"></i>';

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
    left: this.editor.caretPx.x + this.editor.marginLeft,
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
  normal: [.75, 1.5]
};

module.exports = CodeView;

function CodeView(editor) {
  View.call(this, editor);

  this.name = 'code';
  this.dom = dom(css.code);
  this.parts = [];
}

CodeView.prototype.__proto__ = View.prototype;

CodeView.prototype.use = function (target) {
  this.target = target;
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

  if (this.editor.editing) return;

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
  });
};

Part.prototype.clear = function () {
  dom.remove(this);
};

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
  var html = e.syntax.entities(above) + '<mark>' + e.syntax.entities(middle) + '</mark>';

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
    top: 0,
    height: (this.editor.rows + this.editor.page.height) * this.editor.char.height + this.editor.pageRemainder.height
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7O0FBSUEsSUFBSSxpQkFBaUI7QUFDbkIsU0FBTyxTQURZO0FBRW5CLGFBQVcsS0FGUTtBQUduQixlQUFhLE9BSE07QUFJbkIsZ0JBQWMsS0FKSztBQUtuQixnQkFBYyxFQUxLO0FBTW5CLGFBQVcsS0FOUTtBQU9uQixxQkFBbUIsS0FQQTtBQVFuQixtQkFBaUIsS0FSRTtBQVNuQixlQUFhLEVBVE07QUFVbkIsaUJBQWU7QUFWSSxDQUFyQjs7QUFhQSxRQUFRLHFCQUFSO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxVQUFVLFFBQVEsZ0JBQVIsQ0FBZDtBQUNBLElBQUksV0FBVyxRQUFRLGdCQUFSLENBQWY7QUFDQSxJQUFJLFdBQVcsUUFBUSxnQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWOztBQUVBLElBQUksa0JBQWtCLFFBQVEsc0JBQVIsQ0FBdEI7QUFDQSxJQUFJLFVBQVUsUUFBUSxlQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxhQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJ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WSxPQUFaO0FBQ0EsT0FBSyxHQUFMLEdBQVcsSUFBSSxJQUFJLEtBQVIsQ0FBWDtBQUNEOztBQUVELFVBQVUsU0FBVixDQUFvQixTQUFwQixHQUFnQyxLQUFLLFNBQXJDOztBQUVBLFVBQVUsU0FBVixDQUFvQixHQUFwQixHQUEwQixVQUFTLE1BQVQsRUFBaUI7QUFDekMsTUFBSSxNQUFKLENBQVcsTUFBWCxFQUFtQixJQUFuQjtBQUNELENBRkQ7O0FBSUEsVUFBVSxTQUFWLENBQW9CLE1BQXBCLEdBQTZCLFlBQVc7QUFDdEMsTUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQjtBQUNkLFNBQUssQ0FEUztBQUVkLFlBQVEsQ0FBQyxLQUFLLE1BQUwsQ0FBWSxJQUFaLEdBQW1CLEtBQUssTUFBTCxDQUFZLElBQVosQ0FBaUIsTUFBckMsSUFDSixLQUFLLE1BQUwsQ0FBWSxJQUFaLENBQWlCLE1BRGIsR0FFSixLQUFLLE1BQUwsQ0FBWSxhQUFaLENBQTBCO0FBSmhCLEdBQWhCO0FBTUQsQ0FQRDs7QUFTQSxVQUFVLFNBQVYsQ0FBb0IsS0FBcEIsR0FBNEIsWUFBVztBQUNyQyxNQUFJLEtBQUosQ0FBVSxJQUFWLEVBQWdCO0FBQ2QsWUFBUTtBQURNLEdBQWhCO0FBR0QsQ0FKRDs7Ozs7QUMxQkEsT0FBTyxPQUFQLEdBQWlCLElBQWpCOztBQUVBLFNBQVMsSUFBVCxDQUFjLE1BQWQsRUFBc0I7QUFDcEIsT0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNEOztBQUVELEtBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsWUFBVztBQUNqQyxRQUFNLElBQUksS0FBSixDQUFVLHdCQUFWLENBQU47QUFDRCxDQUZEOztBQUlBLEtBQUssU0FBTCxDQUFlLEtBQWYsR0FBdUIsWUFBVztBQUNoQyxRQUFNLElBQUksS0FBSixDQUFVLHVCQUFWLENBQU47QUFDRCxDQUZEIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKlxuICogSmF6elxuICovXG5cbnZhciBEZWZhdWx0T3B0aW9ucyA9IHtcbiAgdGhlbWU6ICd3ZXN0ZXJuJyxcbiAgZm9udF9zaXplOiAnOXB0JyxcbiAgbGluZV9oZWlnaHQ6ICcxLjRlbScsXG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogOTUsXG4gIGhpZGVfcm93czogZmFsc2UsXG4gIGNlbnRlcl9ob3Jpem9udGFsOiBmYWxzZSxcbiAgY2VudGVyX3ZlcnRpY2FsOiBmYWxzZSxcbiAgbWFyZ2luX2xlZnQ6IDE1LFxuICBndXR0ZXJfbWFyZ2luOiAyMCxcbn07XG5cbnJlcXVpcmUoJy4vbGliL3NldC1pbW1lZGlhdGUnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuL2xpYi9kb20nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9saWIvbWVyZ2UnKTtcbnZhciBjbG9uZSA9IHJlcXVpcmUoJy4vbGliL2Nsb25lJyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vbGliL2JpbmQtcmFmJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi9saWIvcmVnZXhwJyk7XG52YXIgRGlhbG9nID0gcmVxdWlyZSgnLi9saWIvZGlhbG9nJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuL2xpYi9wb2ludCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi9saWIvcmFuZ2UnKTtcbnZhciBBcmVhID0gcmVxdWlyZSgnLi9saWIvYXJlYScpO1xudmFyIEJveCA9IHJlcXVpcmUoJy4vbGliL2JveCcpO1xuXG52YXIgRGVmYXVsdEJpbmRpbmdzID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvYmluZGluZ3MnKTtcbnZhciBIaXN0b3J5ID0gcmVxdWlyZSgnLi9zcmMvaGlzdG9yeScpO1xudmFyIElucHV0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQnKTtcbnZhciBGaWxlID0gcmVxdWlyZSgnLi9zcmMvZmlsZScpO1xudmFyIE1vdmUgPSByZXF1aXJlKCcuL3NyYy9tb3ZlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L3RleHQnKTtcbnZhciBWaWV3cyA9IHJlcXVpcmUoJy4vc3JjL3ZpZXdzJyk7XG52YXIgdGhlbWUgPSByZXF1aXJlKCcuL3NyYy90aGVtZScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3JjL3N0eWxlLmNzcycpO1xuXG52YXIgTkVXTElORSA9IFJlZ2V4cC5jcmVhdGUoWyduZXdsaW5lJ10pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEpheno7XG5cbmZ1bmN0aW9uIEphenoob3B0aW9ucykge1xuICB0aGlzLm9wdGlvbnMgPSBtZXJnZShjbG9uZShEZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMgfHwge30pO1xuXG4gIE9iamVjdC5hc3NpZ24odGhpcywge1xuICAgIGVsOiBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG5cbiAgICBpZDogJ2phenpfJyArIChNYXRoLnJhbmRvbSgpICogMTBlNiB8IDApLnRvU3RyaW5nKDM2KSxcbiAgICBmaWxlOiBuZXcgRmlsZSxcbiAgICBtb3ZlOiBuZXcgTW92ZSh0aGlzKSxcbiAgICB2aWV3czogbmV3IFZpZXdzKHRoaXMpLFxuICAgIGlucHV0OiBuZXcgSW5wdXQodGhpcyksXG4gICAgaGlzdG9yeTogbmV3IEhpc3RvcnkodGhpcyksXG5cbiAgICBiaW5kaW5nczogT2JqZWN0LmFzc2lnbih7fSwgRGVmYXVsdEJpbmRpbmdzKSxcblxuICAgIGZpbmQ6IG5ldyBEaWFsb2coJ0ZpbmQnLCBUZXh0Lm1hcCksXG4gICAgZmluZFZhbHVlOiAnJyxcbiAgICBmaW5kTmVlZGxlOiAwLFxuICAgIGZpbmRSZXN1bHRzOiBbXSxcblxuICAgIHNjcm9sbDogbmV3IFBvaW50LFxuICAgIG9mZnNldDogbmV3IFBvaW50LFxuICAgIHNpemU6IG5ldyBCb3gsXG4gICAgY2hhcjogbmV3IEJveCxcblxuICAgIHBhZ2U6IG5ldyBCb3gsXG4gICAgcGFnZVBvaW50OiBuZXcgUG9pbnQsXG4gICAgcGFnZVJlbWFpbmRlcjogbmV3IEJveCxcbiAgICBwYWdlQm91bmRzOiBuZXcgUmFuZ2UsXG5cbiAgICBsb25nZXN0TGluZTogMCxcbiAgICBndXR0ZXI6IDAsXG4gICAgY29kZTogMCxcbiAgICByb3dzOiAwLFxuXG4gICAgdGFiU2l6ZTogMixcbiAgICB0YWI6ICcgICcsXG5cbiAgICBjYXJldDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcbiAgICBjYXJldFB4OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuXG4gICAgaGFzRm9jdXM6IGZhbHNlLFxuXG4gICAgbWFyazogbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gICAgfSksXG5cbiAgICBlZGl0aW5nOiBmYWxzZSxcbiAgICBlZGl0TGluZTogLTEsXG4gICAgZWRpdFJhbmdlOiBbLTEsLTFdLFxuICAgIGVkaXRTaGlmdDogMCxcblxuICAgIHN1Z2dlc3RJbmRleDogMCxcbiAgICBzdWdnZXN0Um9vdDogJycsXG4gICAgc3VnZ2VzdE5vZGVzOiBbXSxcblxuICAgIGFuaW1hdGlvblR5cGU6ICdsaW5lYXInLFxuICAgIGFuaW1hdGlvbkZyYW1lOiAtMSxcbiAgICBhbmltYXRpb25SdW5uaW5nOiBmYWxzZSxcbiAgICBhbmltYXRpb25TY3JvbGxUYXJnZXQ6IG51bGwsXG5cbiAgICByZW5kZXJRdWV1ZTogW10sXG4gICAgcmVuZGVyUmVxdWVzdDogbnVsbCxcbiAgfSk7XG5cbiAgLy8gdXNlZnVsIHNob3J0Y3V0c1xuICB0aGlzLmJ1ZmZlciA9IHRoaXMuZmlsZS5idWZmZXI7XG4gIHRoaXMuYnVmZmVyLm1hcmsgPSB0aGlzLm1hcms7XG4gIHRoaXMuc3ludGF4ID0gdGhpcy5idWZmZXIuc3ludGF4O1xuXG4gIHRoZW1lKHRoaXMub3B0aW9ucy50aGVtZSk7XG5cbiAgdGhpcy5iaW5kTWV0aG9kcygpO1xuICB0aGlzLmJpbmRFdmVudHMoKTtcbn1cblxuSmF6ei5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5KYXp6LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCwgc2Nyb2xsRWwpIHtcbiAgaWYgKHRoaXMucmVmKSB7XG4gICAgdGhpcy5lbC5yZW1vdmVBdHRyaWJ1dGUoJ2lkJyk7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKGNzcy5lZGl0b3IpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICAgIHRoaXMub2ZmU2Nyb2xsKCk7XG4gICAgdGhpcy5yZWYuZm9yRWFjaChyZWYgPT4ge1xuICAgICAgZG9tLmFwcGVuZChlbCwgcmVmKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnJlZiA9IFtdLnNsaWNlLmNhbGwodGhpcy5lbC5jaGlsZHJlbik7XG4gICAgZG9tLmFwcGVuZChlbCwgdGhpcy5lbCk7XG4gICAgZG9tLm9ucmVzaXplKHRoaXMub25SZXNpemUpO1xuICB9XG5cbiAgdGhpcy5lbCA9IGVsO1xuICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnaWQnLCB0aGlzLmlkKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKGNzcy5lZGl0b3IpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgdGhpcy5vZmZTY3JvbGwgPSBkb20ub25zY3JvbGwoc2Nyb2xsRWwgfHwgdGhpcy5lbCwgdGhpcy5vblNjcm9sbCk7XG4gIHRoaXMuaW5wdXQudXNlKHRoaXMuZWwpO1xuICBkb20uYXBwZW5kKHRoaXMudmlld3MuY2FyZXQsIHRoaXMuaW5wdXQudGV4dCk7XG4gIHRoaXMudmlld3MudXNlKHRoaXMuZWwpO1xuXG4gIHNldFRpbWVvdXQodGhpcy5yZXBhaW50LCAwKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmFzc2lnbiA9IGZ1bmN0aW9uKGJpbmRpbmdzKSB7XG4gIHRoaXMuYmluZGluZ3MgPSBiaW5kaW5ncztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5maWxlLm9wZW4ocGF0aCwgcm9vdCwgZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICB0aGlzLmZpbGUuc2F2ZShmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCwgcGF0aCkge1xuICB0aGlzLmZpbGUuc2V0KHRleHQpO1xuICB0aGlzLmZpbGUucGF0aCA9IHBhdGggfHwgdGhpcy5maWxlLnBhdGg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgc2V0SW1tZWRpYXRlKHRoaXMuaW5wdXQuZm9jdXMpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgc2V0SW1tZWRpYXRlKHRoaXMuaW5wdXQuYmx1cik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZE1ldGhvZHMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUuYmluZCh0aGlzKTtcbiAgdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbiA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4uYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrU2V0ID0gdGhpcy5tYXJrU2V0LmJpbmQodGhpcyk7XG4gIHRoaXMubWFya0NsZWFyID0gdGhpcy5tYXJrQ2xlYXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy5yZXBhaW50ID0gdGhpcy5yZXBhaW50LmJpbmQodGhpcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kSGFuZGxlcnMgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgbWV0aG9kIGluIHRoaXMpIHtcbiAgICBpZiAoJ29uJyA9PT0gbWV0aG9kLnNsaWNlKDAsIDIpKSB7XG4gICAgICB0aGlzW21ldGhvZF0gPSB0aGlzW21ldGhvZF0uYmluZCh0aGlzKTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRFdmVudHMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5iaW5kSGFuZGxlcnMoKVxuICB0aGlzLm1vdmUub24oJ21vdmUnLCB0aGlzLm9uTW92ZSk7XG4gIHRoaXMuZmlsZS5vbigncmF3JywgdGhpcy5vbkZpbGVSYXcpOyAvL1RPRE86IHNob3VsZCBub3QgbmVlZCB0aGlzIGV2ZW50XG4gIHRoaXMuZmlsZS5vbignc2V0JywgdGhpcy5vbkZpbGVTZXQpO1xuICB0aGlzLmZpbGUub24oJ29wZW4nLCB0aGlzLm9uRmlsZU9wZW4pO1xuICB0aGlzLmZpbGUub24oJ2NoYW5nZScsIHRoaXMub25GaWxlQ2hhbmdlKTtcbiAgdGhpcy5maWxlLm9uKCdiZWZvcmUgY2hhbmdlJywgdGhpcy5vbkJlZm9yZUZpbGVDaGFuZ2UpO1xuICB0aGlzLmhpc3Rvcnkub24oJ2NoYW5nZScsIHRoaXMub25IaXN0b3J5Q2hhbmdlKTtcbiAgdGhpcy5pbnB1dC5vbignYmx1cicsIHRoaXMub25CbHVyKTtcbiAgdGhpcy5pbnB1dC5vbignZm9jdXMnLCB0aGlzLm9uRm9jdXMpO1xuICB0aGlzLmlucHV0Lm9uKCdpbnB1dCcsIHRoaXMub25JbnB1dCk7XG4gIHRoaXMuaW5wdXQub24oJ3RleHQnLCB0aGlzLm9uVGV4dCk7XG4gIHRoaXMuaW5wdXQub24oJ2tleXMnLCB0aGlzLm9uS2V5cyk7XG4gIHRoaXMuaW5wdXQub24oJ2tleScsIHRoaXMub25LZXkpO1xuICB0aGlzLmlucHV0Lm9uKCdjdXQnLCB0aGlzLm9uQ3V0KTtcbiAgdGhpcy5pbnB1dC5vbignY29weScsIHRoaXMub25Db3B5KTtcbiAgdGhpcy5pbnB1dC5vbigncGFzdGUnLCB0aGlzLm9uUGFzdGUpO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZXVwJywgdGhpcy5vbk1vdXNlVXApO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRvd24nLCB0aGlzLm9uTW91c2VEb3duKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VjbGljaycsIHRoaXMub25Nb3VzZUNsaWNrKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnYmVnaW4nLCB0aGlzLm9uTW91c2VEcmFnQmVnaW4pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWcnLCB0aGlzLm9uTW91c2VEcmFnKTtcbiAgdGhpcy5maW5kLm9uKCdzdWJtaXQnLCB0aGlzLmZpbmRKdW1wLmJpbmQodGhpcywgMSkpO1xuICB0aGlzLmZpbmQub24oJ3ZhbHVlJywgdGhpcy5vbkZpbmRWYWx1ZSk7XG4gIHRoaXMuZmluZC5vbigna2V5JywgdGhpcy5vbkZpbmRLZXkpO1xuICB0aGlzLmZpbmQub24oJ29wZW4nLCB0aGlzLm9uRmluZE9wZW4pO1xuICB0aGlzLmZpbmQub24oJ2Nsb3NlJywgdGhpcy5vbkZpbmRDbG9zZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblNjcm9sbCA9IGZ1bmN0aW9uKHNjcm9sbCkge1xuICB0aGlzLnNjcm9sbC5zZXQoc2Nyb2xsKTtcbiAgdGhpcy5yZW5kZXIoJ2NvZGUnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbiAgdGhpcy5yZW5kZXIoJ3Jvd3MnKTtcbiAgdGhpcy5yZXN0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXN0ID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xufSwgNjAwKTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3ZlID0gZnVuY3Rpb24ocG9pbnQsIGJ5RWRpdCkge1xuICBpZiAoIWJ5RWRpdCkgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIGlmIChwb2ludCkgdGhpcy5zZXRDYXJldChwb2ludCk7XG5cbiAgaWYgKCFieUVkaXQpIHtcbiAgICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCB8fCB0aGlzLmlucHV0Lm1vdXNlLmRvd24pIHtcbiAgICAgIHRoaXMubWFya1NldCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgnbW92ZScpO1xuICB0aGlzLmVtaXQoJ2lucHV0JywgJycsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG4gIHRoaXMucmVzdCgpO1xuXG4gIHRoaXMucmVuZGVyKCdjYXJldCcpO1xuICB0aGlzLnJlbmRlcignYmxvY2snKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Gb2N1cyA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IHRydWU7XG4gIHRoaXMuZW1pdCgnZm9jdXMnKTtcbiAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldFNvbGlkID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgdGhpcy5jYXJldEJsaW5rKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldEJsaW5rID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXQsIGNzc1snYmxpbmstc21vb3RoJ11dKTtcbn0sIDQwMCk7XG5cbkphenoucHJvdG90eXBlLm9uQmx1ciA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IGZhbHNlO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHtcbiAgICAgIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgICAgIHRoaXMuZW1pdCgnYmx1cicpO1xuICAgICAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgICB9XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKGtleXMgaW4gdGhpcy5iaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5cyBpbiBEZWZhdWx0QmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmIChrZXkgaW4gdGhpcy5iaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleSBpbiBEZWZhdWx0QmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHRoaXMub25Db3B5KGUpO1xuICB0aGlzLmRlbGV0ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Db3B5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgLy9cbn07XG5cbkphenoucHJvdG90eXBlLnNldFRhYk1vZGUgPSBmdW5jdGlvbihjaGFyKSB7XG4gIGlmICgnXFx0JyA9PT0gY2hhcikge1xuICAgIHRoaXMudGFiID0gY2hhcjtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnRhYiA9IG5ldyBBcnJheSh0aGlzLnRhYlNpemUgKyAxKS5qb2luKGNoYXIpO1xuICB9XG59XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0KHsgeDowLCB5OjAgfSk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkhpc3RvcnlDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXIoJ2NvZGUnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLmVkaXRDYXJldEJlZm9yZSA9IHRoaXMuY2FyZXQuY29weSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuXG4gIHRoaXMudmlld3MuY29kZS5yZW5kZXJFZGl0KHtcbiAgICBsaW5lOiBlZGl0UmFuZ2VbMF0sXG4gICAgcmFuZ2U6IGVkaXRSYW5nZSxcbiAgICBzaGlmdDogZWRpdFNoaWZ0LFxuICAgIGNhcmV0Tm93OiB0aGlzLmNhcmV0LFxuICAgIGNhcmV0QmVmb3JlOiB0aGlzLmVkaXRDYXJldEJlZm9yZVxuICB9KTtcblxuICB0aGlzLnJlbmRlcignY2FyZXQnKTtcbiAgdGhpcy5yZW5kZXIoJ3Jvd3MnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbiAgdGhpcy5yZW5kZXIoJ3J1bGVyJyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldEZyb21QeCA9IGZ1bmN0aW9uKHB4KSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5tYXJnaW5MZWZ0LCB5OiB0aGlzLmNoYXIuaGVpZ2h0LzIgfSlbJysnXSh0aGlzLm9mZnNldCk7XG4gIGlmICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsKSBnLnkgKz0gdGhpcy5zaXplLmhlaWdodCAvIDMgfCAwO1xuICB2YXIgcCA9IHB4WyctJ10oZylbJysnXSh0aGlzLnNjcm9sbClbJ28vJ10odGhpcy5jaGFyKTtcblxuICBwLnkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihwLnksIHRoaXMuYnVmZmVyLmxvYygpKSk7XG4gIHAueCA9IE1hdGgubWF4KDAsIHAueCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldENvb3Jkc1RhYnMocCk7XG5cbiAgcC54ID0gTWF0aC5tYXgoXG4gICAgMCxcbiAgICBNYXRoLm1pbihcbiAgICAgIHAueCAtIHRhYnMudGFicyArIHRhYnMucmVtYWluZGVyLFxuICAgICAgdGhpcy5nZXRMaW5lTGVuZ3RoKHAueSlcbiAgICApXG4gICk7XG5cbiAgdGhpcy5zZXRDYXJldChwKTtcbiAgdGhpcy5tb3ZlLmxhc3REZWxpYmVyYXRlWCA9IHAueDtcbiAgdGhpcy5vbk1vdmUoKTtcblxuICByZXR1cm4gcDtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VVcCA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHRoaXMuYmx1cigpO1xuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEb3duID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQodGhpcy5mb2N1cy5iaW5kKHRoaXMpLCAxMCk7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0KSB0aGlzLm1hcmtCZWdpbigpO1xuICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldCA9IGZ1bmN0aW9uKHAsIGNlbnRlciwgYW5pbWF0ZSkge1xuICB0aGlzLmNhcmV0LnNldChwKTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0UG9pbnRUYWJzKHRoaXMuY2FyZXQpO1xuXG4gIHRoaXMuY2FyZXRQeC5zZXQoe1xuICAgIHg6IHRoaXMuY2hhci53aWR0aCAqICh0aGlzLmNhcmV0LnggKyB0YWJzLnRhYnMgKiB0aGlzLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlciksXG4gICAgeTogdGhpcy5jaGFyLmhlaWdodCAqIHRoaXMuY2FyZXQueVxuICB9KTtcblxuICB0aGlzLmZvbGxvd0NhcmV0KGNlbnRlciwgYW5pbWF0ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLmRvd24pO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtCZWdpbiA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9IHRydWU7XG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgfSBlbHNlIGlmIChhcmVhICE9PSBmYWxzZSB8fCB0aGlzLm1hcmsuYmVnaW4ueCA9PT0gLTEpIHtcbiAgICAgIHRoaXMubWFyay5iZWdpbi5zZXQodGhpcy5jYXJldCk7XG4gICAgICB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbiAgICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdGhpcy5tYXJrQmVnaW4oYXJlYSk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQ2xlYXIgPSBmdW5jdGlvbihmb3JjZSkge1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCAmJiAhZm9yY2UpIHJldHVybjtcblxuICB0aGlzLm1hcmsuYWN0aXZlID0gZmFsc2U7XG4gIHRoaXMubWFyay5zZXQoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgfSk7XG4gIHRoaXMuY2xlYXIoJ21hcmsnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIFJhbmdlLmNsYW1wKHJhbmdlLCB0aGlzLnBhZ2VCb3VuZHMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbC5jb3B5KCk7XG4gIGlmICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsKSB7XG4gICAgcy55IC09IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIHwgMDtcbiAgfVxuICB2YXIgcCA9IHNbJ18vJ10odGhpcy5jaGFyKTtcbiAgcmV0dXJuIHRoaXMuZ2V0UmFuZ2UoW1xuICAgIE1hdGguZmxvb3IocC55ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzBdKSxcbiAgICBNYXRoLmNlaWwocC55ICsgdGhpcy5wYWdlLmhlaWdodCArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVsxXSlcbiAgXSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRMaW5lTGVuZ3RoID0gZnVuY3Rpb24oeSkge1xuICByZXR1cm4gdGhpcy5idWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2xsb3dDYXJldCA9IGZ1bmN0aW9uKGNlbnRlciwgYW5pbWF0ZSkge1xuICB2YXIgcCA9IHRoaXMuY2FyZXRQeDtcbiAgdmFyIHMgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCB8fCB0aGlzLnNjcm9sbDtcblxuICB2YXIgdG9wID0gKFxuICAgICAgcy55XG4gICAgKyAoY2VudGVyICYmICF0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAyIHwgMCkgLSAxMDAgOiAwKVxuICApIC0gcC55O1xuXG4gIHZhciBib3R0b20gPSBwLnkgLSAoXG4gICAgICBzLnlcbiAgICArIHRoaXMuc2l6ZS5oZWlnaHRcbiAgICAtIChjZW50ZXIgJiYgIXRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDIgfCAwKSAtIDEwMCA6IDApXG4gICAgLSAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMyAqIDIgfCAwKSA6IDApXG4gICkgKyB0aGlzLmNoYXIuaGVpZ2h0O1xuXG4gIHZhciBsZWZ0ID0gKHMueCArIHRoaXMuY2hhci53aWR0aCkgLSBwLng7XG4gIHZhciByaWdodCA9IChwLngpIC0gKHMueCArIHRoaXMuc2l6ZS53aWR0aCAtIHRoaXMubWFyZ2luTGVmdCkgKyB0aGlzLmNoYXIud2lkdGggKiAyO1xuXG4gIGlmIChib3R0b20gPCAwKSBib3R0b20gPSAwO1xuICBpZiAodG9wIDwgMCkgdG9wID0gMDtcbiAgaWYgKGxlZnQgPCAwKSBsZWZ0ID0gMDtcbiAgaWYgKHJpZ2h0IDwgMCkgcmlnaHQgPSAwO1xuXG4gIGlmIChsZWZ0ICsgdG9wICsgcmlnaHQgKyBib3R0b20pIHtcbiAgICB0aGlzW2FuaW1hdGUgPyAnYW5pbWF0ZVNjcm9sbEJ5JyA6ICdzY3JvbGxCeSddKHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wLCAnZWFzZScpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB2YXIgdGFyZ2V0ID0gUG9pbnQubG93KHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfSwge1xuICAgIHg6IHRoaXMuc2Nyb2xsLnggKyB4LFxuICAgIHk6IHRoaXMuc2Nyb2xsLnkgKyB5XG4gIH0pO1xuXG4gIGlmIChQb2ludC5zb3J0KHRhcmdldCwgdGhpcy5zY3JvbGwpICE9PSAwKSB7XG4gICAgdGhpcy5zY3JvbGwuc2V0KHRhcmdldCk7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHksIGFuaW1hdGlvblR5cGUpIHtcbiAgdGhpcy5hbmltYXRpb25UeXBlID0gYW5pbWF0aW9uVHlwZSB8fCAnbGluZWFyJztcblxuICBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIGlmICgnbGluZWFyJyA9PT0gdGhpcy5hbmltYXRpb25UeXBlKSB7XG4gICAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgfVxuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IHRydWU7XG4gICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbik7XG4gIH1cblxuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1heCgwLCBzLnggKyB4KSxcbiAgICB5OiBNYXRoLm1pbihcbiAgICAgICAgKHRoaXMucm93cyArIDEpICogdGhpcy5jaGFyLmhlaWdodCAtIHRoaXMuc2l6ZS5oZWlnaHRcbiAgICAgICsgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyB0aGlzLnNpemUuaGVpZ2h0IC8gMyAqIDIgfCAwIDogMCksXG4gICAgICBNYXRoLm1heCgwLCBzLnkgKyB5KVxuICAgIClcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoKGFkeCA8IDEgJiYgYWR5IDwgMSkgfHwgIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQpO1xuICAgIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2FuaW1hdGlvbiBlbmQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBzd2l0Y2ggKHRoaXMuYW5pbWF0aW9uVHlwZSkge1xuICAgIGNhc2UgJ2xpbmVhcic6XG4gICAgICBpZiAoYWR4IDwgc3BlZWQpIGR4ICo9IDAuOTtcbiAgICAgIGVsc2UgZHggPSBNYXRoLnNpZ24oZHgpICogc3BlZWQ7XG5cbiAgICAgIGlmIChhZHkgPCBzcGVlZCkgZHkgKj0gMC45O1xuICAgICAgZWxzZSBkeSA9IE1hdGguc2lnbihkeSkgKiBzcGVlZDtcblxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZWFzZSc6XG4gICAgICBkeCAqPSAwLjU7XG4gICAgICBkeSAqPSAwLjU7XG4gICAgICBicmVhaztcbiAgfVxuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMuZGVsZXRlKCk7XG5cbiAgdGhpcy5lbWl0KCdpbnB1dCcsIHRleHQsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcblxuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHRoaXMuY2FyZXQueSk7XG4gIHZhciByaWdodCA9IGxpbmVbdGhpcy5jYXJldC54XTtcbiAgdmFyIGhhc1JpZ2h0U3ltYm9sID0gflsnfScsJ10nLCcpJ10uaW5kZXhPZihyaWdodCk7XG5cbiAgLy8gYXBwbHkgaW5kZW50IG9uIGVudGVyXG4gIGlmIChORVdMSU5FLnRlc3QodGV4dCkpIHtcbiAgICB2YXIgaXNFbmRPZkxpbmUgPSB0aGlzLmNhcmV0LnggPT09IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgbGVmdCA9IGxpbmVbdGhpcy5jYXJldC54IC0gMV07XG4gICAgdmFyIGluZGVudCA9IGxpbmUubWF0Y2goL1xcUy8pO1xuICAgIGluZGVudCA9IGluZGVudCA/IGluZGVudC5pbmRleCA6IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgaGFzTGVmdFN5bWJvbCA9IH5bJ3snLCdbJywnKCddLmluZGV4T2YobGVmdCk7XG5cbiAgICBpZiAoaGFzTGVmdFN5bWJvbCkgaW5kZW50ICs9IDI7XG5cbiAgICBpZiAoaXNFbmRPZkxpbmUgfHwgaGFzTGVmdFN5bWJvbCkge1xuICAgICAgdGV4dCArPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBsZW5ndGg7XG5cbiAgaWYgKCFoYXNSaWdodFN5bWJvbCB8fCAoaGFzUmlnaHRTeW1ib2wgJiYgIX5bJ30nLCddJywnKSddLmluZGV4T2YodGV4dCkpKSB7XG4gICAgbGVuZ3RoID0gdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsIHRleHQpO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IDE7XG4gIH1cblxuICB0aGlzLm1vdmUuYnlDaGFycyhsZW5ndGgsIHRydWUpO1xuXG4gIGlmICgneycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnfScpO1xuICBlbHNlIGlmICgnKCcgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnKScpO1xuICBlbHNlIGlmICgnWycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXScpO1xuXG4gIGlmIChoYXNMZWZ0U3ltYm9sICYmIGhhc1JpZ2h0U3ltYm9sKSB7XG4gICAgaW5kZW50IC09IDI7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICdcXG4nICsgbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJhY2tzcGFjZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuIHRoaXMuZGVsZXRlKCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWEwJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpO1xuXG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUodHJ1ZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEsIHRydWUpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMScsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcblxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKHRydWUpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5maW5kSnVtcCA9IGZ1bmN0aW9uKGp1bXApIHtcbiAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCB8fCAhdGhpcy5maW5kLmlzT3BlbikgcmV0dXJuO1xuXG4gIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZE5lZWRsZSArIGp1bXA7XG4gIGlmICh0aGlzLmZpbmROZWVkbGUgPj0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSAwO1xuICB9IGVsc2UgaWYgKHRoaXMuZmluZE5lZWRsZSA8IDApIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCAtIDE7XG4gIH1cblxuICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0LCB0cnVlLCB0cnVlKTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KHRydWUsIHRydWUpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kVmFsdWUgPSBmdW5jdGlvbih2YWx1ZSwgbm9KdW1wKSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5ndXR0ZXIsIHk6IDAgfSk7XG5cbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMuZmluZFZhbHVlID0gdmFsdWU7XG4gIHRoaXMuZmluZFJlc3VsdHMgPSB0aGlzLmJ1ZmZlci5pbmRleGVyLmZpbmQodmFsdWUpLm1hcCgob2Zmc2V0KSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCk7XG4gIH0pO1xuXG4gIGlmICh0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZC5pbmZvKDEgKyB0aGlzLmZpbmROZWVkbGUgKyAnLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG4gIH1cblxuICBpZiAoIW5vSnVtcCkgdGhpcy5maW5kSnVtcCgwKTtcblxuICB0aGlzLnJlbmRlcignZmluZCcpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXIoJ2ZpbmQnKTtcbiAgdGhpcy5mb2N1cygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc3VnZ2VzdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0LCB0cnVlKTtcbiAgaWYgKCFhcmVhKSByZXR1cm47XG5cbiAgdmFyIGtleSA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICBpZiAoIWtleSkgcmV0dXJuO1xuXG4gIGlmICghdGhpcy5zdWdnZXN0Um9vdFxuICAgIHx8IGtleS5zdWJzdHIoMCwgdGhpcy5zdWdnZXN0Um9vdC5sZW5ndGgpICE9PSB0aGlzLnN1Z2dlc3RSb290KSB7XG4gICAgdGhpcy5zdWdnZXN0SW5kZXggPSAwO1xuICAgIHRoaXMuc3VnZ2VzdFJvb3QgPSBrZXk7XG4gICAgdGhpcy5zdWdnZXN0Tm9kZXMgPSB0aGlzLmJ1ZmZlci5wcmVmaXguY29sbGVjdChrZXkpO1xuICB9XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGgpIHJldHVybjtcbiAgdmFyIG5vZGUgPSB0aGlzLnN1Z2dlc3ROb2Rlc1t0aGlzLnN1Z2dlc3RJbmRleF07XG5cbiAgdGhpcy5zdWdnZXN0SW5kZXggPSAodGhpcy5zdWdnZXN0SW5kZXggKyAxKSAlIHRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aDtcblxuICByZXR1cm4ge1xuICAgIGFyZWE6IGFyZWEsXG4gICAgbm9kZTogbm9kZVxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UG9pbnRUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyICsgdGFic1xuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0Q29vcmRzVGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFicyAqIHRoaXMudGFiU2l6ZSArIHJlbWFpbmRlciA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXJcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlcGFpbnQgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2l6ZSgpO1xuICB0aGlzLnZpZXdzLnJlbmRlcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgJCA9IHRoaXMuZWw7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgLiR7Y3NzLnJvd3N9LFxuICAgIC4ke2Nzcy5tYXJrfSxcbiAgICAuJHtjc3MuY29kZX0sXG4gICAgbWFyayxcbiAgICBwLFxuICAgIHQsXG4gICAgayxcbiAgICBkLFxuICAgIG4sXG4gICAgbyxcbiAgICBlLFxuICAgIG0sXG4gICAgZixcbiAgICByLFxuICAgIGMsXG4gICAgcyxcbiAgICBsLFxuICAgIHgge1xuICAgICAgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTtcbiAgICAgIGZvbnQtc2l6ZTogJHt0aGlzLm9wdGlvbnMuZm9udF9zaXplfTtcbiAgICAgIGxpbmUtaGVpZ2h0OiAke3RoaXMub3B0aW9ucy5saW5lX2hlaWdodH07XG4gICAgfVxuICAgIGBcbiAgKTtcblxuICB0aGlzLm9mZnNldC5zZXQoZG9tLmdldE9mZnNldCgkKSk7XG4gIHRoaXMuc2Nyb2xsLnNldChkb20uZ2V0U2Nyb2xsKCQpKTtcbiAgdGhpcy5zaXplLnNldChkb20uZ2V0U2l6ZSgkKSk7XG5cbiAgLy8gdGhpcyBpcyBhIHdlaXJkIGZpeCB3aGVuIGRvaW5nIG11bHRpcGxlIC51c2UoKVxuICBpZiAodGhpcy5jaGFyLndpZHRoID09PSAwKSB0aGlzLmNoYXIuc2V0KGRvbS5nZXRDaGFyU2l6ZSgkLCBjc3MuY29kZSkpO1xuXG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWydfKiddKHRoaXMuY2hhcikpKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG4gIC8vIHRoaXMubG9uZ2VzdExpbmUgPSBNYXRoLm1pbig1MDAsIHRoaXMuYnVmZmVyLmxpbmVzLmdldExvbmdlc3RMaW5lTGVuZ3RoKCkpO1xuXG4gIHRoaXMuZ3V0dGVyID0gTWF0aC5tYXgoXG4gICAgdGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgKHRoaXMub3B0aW9ucy5jZW50ZXJfaG9yaXpvbnRhbFxuICAgICAgPyBNYXRoLm1heChcbiAgICAgICAgICAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgICAgICAgKCB0aGlzLnBhZ2Uud2lkdGggLSA4MVxuICAgICAgICAgIC0gKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoKVxuICAgICAgICAgICkgLyAyIHwgMFxuICAgICAgICApIDogMClcbiAgICArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6IE1hdGgubWF4KDMsICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpXG4gICkgKiB0aGlzLmNoYXIud2lkdGhcbiAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93c1xuICAgICAgPyAwXG4gICAgICA6IHRoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2luICogKHRoaXMub3B0aW9ucy5jZW50ZXJfaG9yaXpvbnRhbCA/IC0xIDogMSlcbiAgICApO1xuXG4gIHRoaXMubWFyZ2luTGVmdCA9IHRoaXMuZ3V0dGVyICsgdGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0O1xuXG4gIC8vIGRvbS5zdHlsZSh0aGlzLmVsLCB7XG4gIC8vICAgd2lkdGg6IHRoaXMubG9uZ2VzdExpbmUgKiB0aGlzLmNoYXIud2lkdGgsXG4gIC8vICAgaGVpZ2h0OiB0aGlzLnJvd3MgKiB0aGlzLmNoYXIuaGVpZ2h0XG4gIC8vIH0pO1xuXG4gIC8vVE9ETzogbWFrZSBtZXRob2QvdXRpbFxuICAvLyBkcmF3IGluZGVudCBpbWFnZVxuICB2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHZhciBmb28gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9vJyk7XG4gIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICBjYW52YXMuc2V0QXR0cmlidXRlKCd3aWR0aCcsIE1hdGguY2VpbCh0aGlzLmNoYXIud2lkdGggKiAyKSk7XG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ2hlaWdodCcsIHRoaXMuY2hhci5oZWlnaHQpO1xuXG4gIHZhciBjb21tZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYycpO1xuICAkLmFwcGVuZENoaWxkKGNvbW1lbnQpO1xuICB2YXIgY29sb3IgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShjb21tZW50KS5jb2xvcjtcbiAgJC5yZW1vdmVDaGlsZChjb21tZW50KTtcbiAgY3R4LnNldExpbmVEYXNoKFsxLDFdKTtcbiAgY3R4LmxpbmVEYXNoT2Zmc2V0ID0gMDtcbiAgY3R4LmJlZ2luUGF0aCgpO1xuICBjdHgubW92ZVRvKDAsMSk7XG4gIGN0eC5saW5lVG8oMCwgdGhpcy5jaGFyLmhlaWdodCk7XG4gIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICBjdHguc3Ryb2tlKCk7XG5cbiAgdmFyIGRhdGFVUkwgPSBjYW52YXMudG9EYXRhVVJMKCk7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgIyR7dGhpcy5pZH0ge1xuICAgICAgdG9wOiAke3RoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyB0aGlzLnNpemUuaGVpZ2h0IC8gMyA6IDB9cHg7XG4gICAgfVxuXG4gICAgLiR7Y3NzLnJvd3N9LFxuICAgIC4ke2Nzcy5tYXJrfSxcbiAgICAuJHtjc3MuY29kZX0sXG4gICAgbWFyayxcbiAgICBwLFxuICAgIHQsXG4gICAgayxcbiAgICBkLFxuICAgIG4sXG4gICAgbyxcbiAgICBlLFxuICAgIG0sXG4gICAgZixcbiAgICByLFxuICAgIGMsXG4gICAgcyxcbiAgICBsLFxuICAgIHgge1xuICAgICAgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTtcbiAgICAgIGZvbnQtc2l6ZTogJHt0aGlzLm9wdGlvbnMuZm9udF9zaXplfTtcbiAgICAgIGxpbmUtaGVpZ2h0OiAke3RoaXMub3B0aW9ucy5saW5lX2hlaWdodH07XG4gICAgfVxuXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MucnVsZXJ9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmZpbmR9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLm1hcmt9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmNvZGV9IHtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJvd3N9IHtcbiAgICAgIHBhZGRpbmctcmlnaHQ6ICR7dGhpcy5vcHRpb25zLmd1dHRlcl9tYXJnaW59cHg7XG4gICAgICBwYWRkaW5nLWxlZnQ6ICR7dGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0fXB4O1xuICAgICAgd2lkdGg6ICR7dGhpcy5tYXJnaW5MZWZ0fXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5maW5kfSA+IGksXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuYmxvY2t9ID4gaSB7XG4gICAgICBoZWlnaHQ6ICR7dGhpcy5jaGFyLmhlaWdodCArIDF9cHg7XG4gICAgfVxuICAgIHgge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLnZpZXdzW25hbWVdLmNsZWFyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbihuYW1lKSB7XG4gIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmVuZGVyUmVxdWVzdCk7XG4gIGlmICghfnRoaXMucmVuZGVyUXVldWUuaW5kZXhPZihuYW1lKSkge1xuICAgIGlmIChuYW1lIGluIHRoaXMudmlld3MpIHtcbiAgICAgIHRoaXMucmVuZGVyUXVldWUucHVzaChuYW1lKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJSZXF1ZXN0ID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuX3JlbmRlci5iaW5kKHRoaXMpKTtcbn07XG5cbkphenoucHJvdG90eXBlLl9yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXJRdWV1ZS5mb3JFYWNoKG5hbWUgPT4gdGhpcy52aWV3c1tuYW1lXS5yZW5kZXIoKSk7XG4gIHRoaXMucmVuZGVyUXVldWUgPSBbXTtcbn07XG5cbi8vIHRoaXMgaXMgdXNlZCBmb3IgZGV2ZWxvcG1lbnQgZGVidWcgcHVycG9zZXNcbmZ1bmN0aW9uIGJpbmRDYWxsU2l0ZShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIHZhciBlcnIgPSBuZXcgRXJyb3I7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyLCBhcmd1bWVudHMuY2FsbGVlKTtcbiAgICB2YXIgc3RhY2sgPSBlcnIuc3RhY2s7XG4gICAgY29uc29sZS5sb2coc3RhY2spO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYywgZCk7XG4gIH07XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIGxldCBhcmVhID0gdGhpcy5nZXQoKVxuICByZXR1cm4gJycgKyBhcmVhLmJlZ2luICsgJ3wnICsgYXJlYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGJpbmFyeVNlYXJjaDtcblxuZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFycmF5LCBjb21wYXJlKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgbG93ID0gMDtcbiAgdmFyIGhpZ2ggPSBhcnJheS5sZW5ndGg7XG4gIGlmICghaGlnaCkgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiAwXG4gIH07XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpbmRleDtcbiAgICBpbmRleCA9IGxvdyArIChoaWdoIC0gbG93ID4+IDEpO1xuICAgIHZhciBpdGVtID0gYXJyYXlbaW5kZXhdO1xuICAgIHZhciByZXN1bHQgPSBjb21wYXJlKGl0ZW0pO1xuXG4gICAgaWYgKHJlc3VsdCkgbG93ID0gaW5kZXg7XG4gICAgZWxzZSBoaWdoID0gaW5kZXg7XG4gIH0gd2hpbGUgKHByZXYgIT09IGluZGV4KTtcblxuICBpZiAoaXRlbSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICBpbmRleDogaW5kZXhcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiB+bG93ICogLTEgLSAxXG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuICByZXR1cm4gZnVuY3Rpb24gcmFmV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKHJlcXVlc3QpO1xuICAgIHJlcXVlc3QgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCkpO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfLyddID1cbkJveC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXi8nXSA9XG5Cb3gucHJvdG90eXBlLmNlaWxkaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWycqJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydvKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGgucm91bmQodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLnJvdW5kKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJy0nXSA9XG5Cb3gucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC0gKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjbG9uZShvYmopIHtcbiAgdmFyIG8gPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHZhciB2YWwgPSBvYmpba2V5XTtcbiAgICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiB2YWwpIHtcbiAgICAgIG9ba2V5XSA9IGNsb25lKHZhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ba2V5XSA9IHZhbDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG87XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24gZGVib3VuY2VXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgdGltZW91dCA9IHNldFRpbWVvdXQoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSwgbXMpO1xuICAgIHJldHVybiB0aW1lb3V0O1xuICB9XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vZXZlbnQnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpYWxvZztcblxuZnVuY3Rpb24gRGlhbG9nKGxhYmVsLCBrZXltYXApIHtcbiAgdGhpcy5ub2RlID0gZG9tKGNzcy5kaWFsb2csIFtcbiAgICBgPGxhYmVsPiR7Y3NzLmxhYmVsfWAsXG4gICAgW2Nzcy5pbnB1dCwgW1xuICAgICAgYDxpbnB1dD4ke2Nzcy50ZXh0fWAsXG4gICAgICBjc3MuaW5mb1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmxhYmVsXSwgbGFiZWwpO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25jbGljayA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNlZG93biA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbn1cblxuRGlhbG9nLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbmZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbihlKSB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmhhc0ZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgZG9tLmFwcGVuZChkb2N1bWVudC5ib2R5LCB0aGlzLm5vZGUpO1xuICBkb20uZm9jdXModGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmluZm8gPSBmdW5jdGlvbihpbmZvKSB7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgaW5mbyk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJkaWFsb2dcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19kaWFsb2dcIixcImlucHV0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5wdXRcIixcInRleHRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX190ZXh0XCIsXCJsYWJlbFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2xhYmVsXCIsXCJpbmZvXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5mb1wifSIsIlxubW9kdWxlLmV4cG9ydHMgPSBkaWZmO1xuXG5mdW5jdGlvbiBkaWZmKGEsIGIpIHtcbiAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgYSkge1xuICAgIHZhciBkID0ge307XG4gICAgdmFyIGkgPSAwO1xuICAgIGZvciAodmFyIGsgaW4gYikge1xuICAgICAgaWYgKGFba10gIT09IGJba10pIHtcbiAgICAgICAgZFtrXSA9IGJba107XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGkpIHJldHVybiBkO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhICE9PSBiO1xuICB9XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vYmluZC1yYWYnKTtcbnZhciBtZW1vaXplID0gcmVxdWlyZSgnLi9tZW1vaXplJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWUuc3BsaXQoJyAnKVswXVxuICAgIH07XG4gICAgZG9tLmNsYXNzZXMobm9kZSwgbmFtZS5zcGxpdCgnICcpLnNsaWNlKDEpKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIGlmIChzdHlsZVtuYW1lXSAhPT0gJ2F1dG8nKVxuICAgICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufSwgZGlmZiwgbWVyZ2UsIGZ1bmN0aW9uKG5vZGUsIHN0eWxlKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBzdHlsZV07XG59KTtcblxuLypcbmRvbS5zdHlsZSA9IGZ1bmN0aW9uKGVsLCBzdHlsZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59O1xuKi9cbmRvbS5jbGFzc2VzID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbn0sIG51bGwsIG51bGwsIGZ1bmN0aW9uKG5vZGUsIGNsYXNzZXMpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIGNsYXNzZXMuY29uY2F0KG5vZGUubmFtZSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKV07XG59KTtcblxuZG9tLmF0dHJzID0gZnVuY3Rpb24oZWwsIGF0dHJzKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBPYmplY3QuYXNzaWduKGVsLCBhdHRycyk7XG59O1xuXG5kb20uaHRtbCA9IGZ1bmN0aW9uKGVsLCBodG1sKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZG9tLnRleHQgPSBmdW5jdGlvbihlbCwgdGV4dCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xufTtcblxuZG9tLmZvY3VzID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmZvY3VzKCk7XG59O1xuXG5kb20uZ2V0U2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlbC5jbGllbnRXaWR0aCxcbiAgICBoZWlnaHQ6IGVsLmNsaWVudEhlaWdodFxuICB9O1xufTtcblxuZG9tLmdldENoYXJTaXplID0gZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHNwYW4uY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuXG4gIGVsLmFwcGVuZENoaWxkKHNwYW4pO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAnO1xuICB2YXIgYSA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICBcXG4gJztcbiAgdmFyIGIgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIGVsLnJlbW92ZUNoaWxkKHNwYW4pO1xuXG4gIHJldHVybiB7XG4gICAgd2lkdGg6IChiLndpZHRoIC0gYS53aWR0aCksXG4gICAgaGVpZ2h0OiAoYi5oZWlnaHQgLSBhLmhlaWdodClcbiAgfTtcbn07XG5cbmRvbS5nZXRPZmZzZXQgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpO1xuICB2YXIgYm9yZGVyTGVmdCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlckxlZnRXaWR0aCk7XG4gIHZhciBib3JkZXJUb3AgPSBwYXJzZUludChzdHlsZS5ib3JkZXJUb3BXaWR0aCk7XG4gIHJldHVybiBQb2ludC5sb3coeyB4OiAwLCB5OiAwIH0sIHtcbiAgICB4OiAocmVjdC5sZWZ0ICsgYm9yZGVyTGVmdCkgfCAwLFxuICAgIHk6IChyZWN0LnRvcCArIGJvcmRlclRvcCkgfCAwXG4gIH0pO1xufTtcblxuZG9tLmdldFNjcm9sbCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4gZ2V0U2Nyb2xsKGVsKTtcbn07XG5cbmRvbS5vbnNjcm9sbCA9IGZ1bmN0aW9uIG9uc2Nyb2xsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZzY3JvbGwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20ucmVtb3ZlID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChlbC5wYXJlbnROb2RlKSBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKTtcbn07XG5cbmRvbS5nZXRFbGVtZW50ID0gZnVuY3Rpb24oZWwpIHtcbiAgcmV0dXJuIGVsLmRvbSAmJiBlbC5kb20uZWwgfHwgZWwuZWwgfHwgZWwubm9kZSB8fCBlbDtcbn07XG5cbmRvbS5zY3JvbGxCeSA9IGZ1bmN0aW9uKGVsLCB4LCB5LCBzY3JvbGwpIHtcbiAgc2Nyb2xsID0gc2Nyb2xsIHx8IGRvbS5nZXRTY3JvbGwoZWwpO1xuICBkb20uc2Nyb2xsVG8oZWwsIHNjcm9sbC54ICsgeCwgc2Nyb2xsLnkgKyB5KTtcbn07XG5cbmRvbS5zY3JvbGxUbyA9IGZ1bmN0aW9uKGVsLCB4LCB5KSB7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIHdpbmRvdy5zY3JvbGxUbyh4LCB5KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5zY3JvbGxMZWZ0ID0geCB8fCAwO1xuICAgIGVsLnNjcm9sbFRvcCA9IHkgfHwgMDtcbiAgfVxufTtcblxuZG9tLmNzcyA9IGZ1bmN0aW9uKGlkLCBjc3NUZXh0KSB7XG4gIGlmICghKGlkIGluIGRvbS5jc3Muc3R5bGVzKSkge1xuICAgIGRvbS5jc3Muc3R5bGVzW2lkXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlc1tpZF0pO1xuICB9XG4gIGRvbS5jc3Muc3R5bGVzW2lkXS50ZXh0Q29udGVudCA9IGNzc1RleHQ7XG59O1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFBvaW50O1xuXG5mdW5jdGlvbiBQb2ludChwKSB7XG4gIGlmIChwKSB7XG4gICAgdGhpcy54ID0gcC54O1xuICAgIHRoaXMueSA9IHAueTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gIH1cbn1cblxuUG9pbnQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy54ID0gcC54O1xuICB0aGlzLnkgPSBwLnk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFBvaW50KHRoaXMpO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28vJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXi8nXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycrJ10gPVxuUG9pbnQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSArIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy0nXSA9XG5Qb2ludC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLSAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC0gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKiddID1cblBvaW50LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeKiddID1cblBvaW50LnByb3RvdHlwZS5jZWlsTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXyonXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMueCArICcsJyArIHRoaXMueTtcbn07XG5cblBvaW50LnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5Qb2ludC5ncmlkUm91bmQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5yb3VuZChhLnggLyBiLndpZHRoKSxcbiAgICB5OiBNYXRoLnJvdW5kKGEueSAvIGIuaGVpZ2h0KVxuICB9O1xufTtcblxuUG9pbnQubG93ID0gZnVuY3Rpb24obG93LCBwKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5tYXgobG93LngsIHAueCksXG4gICAgeTogTWF0aC5tYXgobG93LnksIHAueSlcbiAgfTtcbn07XG5cblBvaW50LmNsYW1wID0gZnVuY3Rpb24oYXJlYSwgcCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfSk7XG59O1xuXG5Qb2ludC5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7IHg6IGEueCArIGIueCwgeTogYS55ICsgYi55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRYID0gZnVuY3Rpb24oeCwgcCkge1xuICByZXR1cm4geyB4OiBwLnggKyB4LCB5OiBwLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFkgPSBmdW5jdGlvbih5LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCwgeTogcC55ICsgeSB9O1xufTtcblxuUG9pbnQudG9MZWZ0VG9wID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHAueCxcbiAgICB0b3A6IHAueVxuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBBTkQ7XG5cbmZ1bmN0aW9uIEFORChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBOT1Q7XG5cbmZ1bmN0aW9uIE5PVChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJ2YXIgQU5EID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLWFuZCcpO1xudmFyIE5PVCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1ub3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSYW5nZTtcblxuZnVuY3Rpb24gUmFuZ2Uocikge1xuICBpZiAocikge1xuICAgIHRoaXNbMF0gPSByWzBdO1xuICAgIHRoaXNbMV0gPSByWzFdO1xuICB9IGVsc2Uge1xuICAgIHRoaXNbMF0gPSAwO1xuICAgIHRoaXNbMV0gPSAxO1xuICB9XG59O1xuXG5SYW5nZS5BTkQgPSBBTkQ7XG5SYW5nZS5OT1QgPSBOT1Q7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZSh0aGlzKTtcbn07XG5cblJhbmdlLnJhbmdlcyA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHJldHVybiBpdGVtcy5tYXAoZnVuY3Rpb24oaXRlbSkgeyByZXR1cm4gaXRlbS5yYW5nZSB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA+PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdIDw9IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdmVybGFwID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPD0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA+PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzFdIDwgcmFuZ2VbMF0gfHwgaXRlbS5yYW5nZVswXSA+IHJhbmdlWzFdO1xuICB9KTtcbn07XG4iLCJcbnZhciBSZWdleHAgPSBleHBvcnRzO1xuXG5SZWdleHAuY3JlYXRlID0gZnVuY3Rpb24obmFtZXMsIGZsYWdzLCBmbikge1xuICBmbiA9IGZuIHx8IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMgfTtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgbmFtZXNcbiAgICAubWFwKChuKSA9PiAnc3RyaW5nJyA9PT0gdHlwZW9mIG4gPyBSZWdleHAudHlwZXNbbl0gOiBuKVxuICAgIC5tYXAoKHIpID0+IGZuKHIudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkpXG4gICAgLmpvaW4oJ3wnKSxcbiAgICBmbGFnc1xuICApO1xufTtcblxuUmVnZXhwLnR5cGVzID0ge1xuICAndG9rZW5zJzogLy4rP1xcYnwuXFxCfFxcYi4rPy8sXG4gICd3b3Jkcyc6IC9bYS16QS1aMC05XXsxLH0vLFxuICAncGFydHMnOiAvWy4vXFxcXFxcKFxcKVwiJ1xcLTosLjs8Pn4hQCMkJV4mKlxcfFxcKz1cXFtcXF17fWB+XFw/IF0rLyxcblxuICAnc2luZ2xlIGNvbW1lbnQnOiAvXFwvXFwvLio/JC8sXG4gICdkb3VibGUgY29tbWVudCc6IC9cXC9cXCpbXl0qP1xcKlxcLy8sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogLygnKD86KD86XFxcXFxcbnxcXFxcJ3xbXidcXG5dKSkqPycpLyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiAvKFwiKD86KD86XFxcXFxcbnxcXFxcXCJ8W15cIlxcbl0pKSo/XCIpLyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IC8oYCg/Oig/OlxcXFxgfFteYF0pKSo/YCkvLFxuXG4gICdvcGVyYXRvcic6IC8hfD49P3w8PT98PXsxLDN9fCg/OiYpezEsMn18XFx8P1xcfHxcXD98XFwqfFxcL3x+fFxcXnwlfFxcLig/IVxcZCl8XFwrezEsMn18XFwtezEsMn0vLFxuICAnZnVuY3Rpb24nOiAvICgoPyFcXGR8Wy4gXSo/KGlmfGVsc2V8ZG98Zm9yfGNhc2V8dHJ5fGNhdGNofHdoaWxlfHdpdGh8c3dpdGNoKSlbYS16QS1aMC05XyAkXSspKD89XFwoLipcXCkuKnspLyxcbiAgJ2tleXdvcmQnOiAvXFxiKGJyZWFrfGNhc2V8Y2F0Y2h8Y29uc3R8Y29udGludWV8ZGVidWdnZXJ8ZGVmYXVsdHxkZWxldGV8ZG98ZWxzZXxleHBvcnR8ZXh0ZW5kc3xmaW5hbGx5fGZvcnxmcm9tfGlmfGltcGxlbWVudHN8aW1wb3J0fGlufGluc3RhbmNlb2Z8aW50ZXJmYWNlfGxldHxuZXd8cGFja2FnZXxwcml2YXRlfHByb3RlY3RlZHxwdWJsaWN8cmV0dXJufHN0YXRpY3xzdXBlcnxzd2l0Y2h8dGhyb3d8dHJ5fHR5cGVvZnx3aGlsZXx3aXRofHlpZWxkKVxcYi8sXG4gICdkZWNsYXJlJzogL1xcYihmdW5jdGlvbnxpbnRlcmZhY2V8Y2xhc3N8dmFyfGxldHxjb25zdHxlbnVtfHZvaWQpXFxiLyxcbiAgJ2J1aWx0aW4nOiAvXFxiKE9iamVjdHxGdW5jdGlvbnxCb29sZWFufEVycm9yfEV2YWxFcnJvcnxJbnRlcm5hbEVycm9yfFJhbmdlRXJyb3J8UmVmZXJlbmNlRXJyb3J8U3RvcEl0ZXJhdGlvbnxTeW50YXhFcnJvcnxUeXBlRXJyb3J8VVJJRXJyb3J8TnVtYmVyfE1hdGh8RGF0ZXxTdHJpbmd8UmVnRXhwfEFycmF5fEZsb2F0MzJBcnJheXxGbG9hdDY0QXJyYXl8SW50MTZBcnJheXxJbnQzMkFycmF5fEludDhBcnJheXxVaW50MTZBcnJheXxVaW50MzJBcnJheXxVaW50OEFycmF5fFVpbnQ4Q2xhbXBlZEFycmF5fEFycmF5QnVmZmVyfERhdGFWaWV3fEpTT058SW50bHxhcmd1bWVudHN8Y29uc29sZXx3aW5kb3d8ZG9jdW1lbnR8U3ltYm9sfFNldHxNYXB8V2Vha1NldHxXZWFrTWFwfFByb3h5fFJlZmxlY3R8UHJvbWlzZSlcXGIvLFxuICAnc3BlY2lhbCc6IC9cXGIodHJ1ZXxmYWxzZXxudWxsfHVuZGVmaW5lZClcXGIvLFxuICAncGFyYW1zJzogL2Z1bmN0aW9uWyBcXChdezF9W15dKj9cXHsvLFxuICAnbnVtYmVyJzogLy0/XFxiKDB4W1xcZEEtRmEtZl0rfFxcZCpcXC4/XFxkKyhbRWVdWystXT9cXGQrKT98TmFOfC0/SW5maW5pdHkpXFxiLyxcbiAgJ3N5bWJvbCc6IC9be31bXFxdKCksOl0vLFxuICAncmVnZXhwJzogLyg/IVteXFwvXSkoXFwvKD8hW1xcL3xcXCpdKS4qP1teXFxcXFxcXl1cXC8pKFs7XFxuXFwuXFwpXFxdXFx9IGdpbV0pLyxcblxuICAneG1sJzogLzxbXj5dKj4vLFxuICAndXJsJzogLygoXFx3KzpcXC9cXC8pWy1hLXpBLVowLTk6QDs/Jj1cXC8lXFwrXFwuXFwqISdcXChcXCksXFwkX1xce1xcfVxcXn5cXFtcXF1gI3xdKykvLFxuICAnaW5kZW50JzogL14gK3xeXFx0Ky8sXG4gICdsaW5lJzogL14uKyR8Xlxcbi8sXG4gICduZXdsaW5lJzogL1xcclxcbnxcXHJ8XFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJ2YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcblxudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLnNldFRleHQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS51cGRhdGVSYXcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yYXcgPSB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnVwZGF0ZVJhdygpO1xuICB2YXIgYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgYnVmZmVyLnJlcGxhY2UodGhpcyk7XG4gIHJldHVybiBidWZmZXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihkYXRhKSB7XG4gIHRoaXMucmF3ID0gZGF0YS5yYXc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuICB0aGlzLnRva2VucyA9IGRhdGEudG9rZW5zLmNvcHkoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnNldFRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdGhpcy5yYXcgPSB0ZXh0IC8vdGhpcy5zeW50YXguaGlnaGxpZ2h0KHRleHQpO1xuXG4gIHRoaXMuc3ludGF4LnRhYiA9IH50aGlzLnJhdy5pbmRleE9mKCdcXHQnKSA/ICdcXHQnIDogJyAnO1xuXG4gIHRoaXMudGV4dCA9IG5ldyBTa2lwU3RyaW5nO1xuICB0aGlzLnRleHQuc2V0KHRoaXMucmF3KTtcblxuICB0aGlzLnRva2VucyA9IG5ldyBUb2tlbnM7XG4gIHRoaXMudG9rZW5zLmluZGV4KHRoaXMucmF3KTtcbiAgdGhpcy50b2tlbnMub24oJ2NoYW5nZSBzZWdtZW50cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2Ugc2VnbWVudHMnKSk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIC8vIHRoaXMuZW1pdCgncmF3JywgdGhpcy5yYXcpO1xuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnQgPVxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnRUZXh0QXRQb2ludCA9IGZ1bmN0aW9uKHAsIHRleHQsIG5vTG9nKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdmFyIGxlbmd0aCA9IHRleHQubGVuZ3RoO1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgc2hpZnQgPSAodGV4dC5tYXRjaChORVdMSU5FKSB8fCBbXSkubGVuZ3RoO1xuICB2YXIgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIHNoaWZ0XTtcbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcblxuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG4gIG9mZnNldFJhbmdlWzFdICs9IHRleHQubGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vTG9nKSB7XG4gICAgdmFyIGxhc3RMb2cgPSB0aGlzLmxvZ1t0aGlzLmxvZy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExvZyAmJiBsYXN0TG9nWzBdID09PSAnaW5zZXJ0JyAmJiBsYXN0TG9nWzFdWzFdID09PSBwb2ludC5vZmZzZXQpIHtcbiAgICAgIGxhc3RMb2dbMV1bMV0gKz0gdGV4dC5sZW5ndGg7XG4gICAgICBsYXN0TG9nWzJdICs9IHRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nLnB1c2goWydpbnNlcnQnLCBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQgKyB0ZXh0Lmxlbmd0aF0sIHRleHRdKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG5cbiAgcmV0dXJuIHRleHQubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmUgPVxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKG8sIG5vTG9nKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdvZmZzZXRzJywgbylcbiAgdmFyIGEgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMF0pO1xuICB2YXIgYiA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1sxXSk7XG4gIHZhciBsZW5ndGggPSBvWzBdIC0gb1sxXTtcbiAgdmFyIHJhbmdlID0gW2EueSwgYi55XTtcbiAgdmFyIHNoaWZ0ID0gYS55IC0gYi55O1xuICAvLyBjb25zb2xlLmxvZyhhLGIpXG5cbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGJlZm9yZSA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uobyk7XG4gIHRoaXMudGV4dC5yZW1vdmUobyk7XG4gIG9mZnNldFJhbmdlWzFdICs9IGxlbmd0aDtcbiAgdmFyIGFmdGVyID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgaWYgKCFub0xvZykge1xuICAgIHZhciBsYXN0TG9nID0gdGhpcy5sb2dbdGhpcy5sb2cubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxhc3RMb2cgJiYgbGFzdExvZ1swXSA9PT0gJ3JlbW92ZScgJiYgbGFzdExvZ1sxXVswXSA9PT0gb1sxXSkge1xuICAgICAgbGFzdExvZ1sxXVswXSAtPSB0ZXh0Lmxlbmd0aDtcbiAgICAgIGxhc3RMb2dbMl0gPSB0ZXh0ICsgbGFzdExvZ1syXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cucHVzaChbJ3JlbW92ZScsIG8sIHRleHRdKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldHMpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVDaGFyQXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIG9mZnNldFJhbmdlID0gW3BvaW50Lm9mZnNldCwgcG9pbnQub2Zmc2V0KzFdO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBjb2RlID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KHJhbmdlKTtcblxuICAvLyBjYWxjdWxhdGUgaW5kZW50IGZvciBgY29kZWBcbiAgLy9UT0RPOiBtb3ZlIHRvIG1ldGhvZFxuICB2YXIgbGFzdCA9IGNvZGUuc2xpY2UoY29kZS5sYXN0SW5kZXhPZignXFxuJykpO1xuICB2YXIgQW55Q2hhciA9IC9cXFMvZztcbiAgdmFyIHkgPSByYW5nZVsxXTtcbiAgdmFyIG1hdGNoID0gQW55Q2hhci5leGVjKGxhc3QpO1xuICB3aGlsZSAoIW1hdGNoICYmIHkgPCB0aGlzLmxvYygpKSB7XG4gICAgdmFyIGFmdGVyID0gdGhpcy5nZXRMaW5lVGV4dCgrK3kpO1xuICAgIEFueUNoYXIubGFzdEluZGV4ID0gMDtcbiAgICBtYXRjaCA9IEFueUNoYXIuZXhlYyhhZnRlcik7XG4gIH1cbiAgdmFyIGluZGVudCA9IDA7XG4gIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gIHZhciBpbmRlbnRUZXh0ID0gJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnN5bnRheC50YWIpO1xuXG4gIHZhciBzZWdtZW50ID0gdGhpcy5zZWdtZW50cy5nZXQocmFuZ2VbMF0pO1xuICBpZiAoc2VnbWVudCkge1xuICAgIGNvZGUgPSBTRUdNRU5UW3NlZ21lbnRdICsgJ1xcdWZmYmFcXG4nICsgY29kZSArIGluZGVudFRleHQgKyAnXFx1ZmZiZSovYCdcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUpO1xuICAgIGNvZGUgPSAnPCcgKyBzZWdtZW50WzBdICsgJz4nICtcbiAgICAgIGNvZGUuc3Vic3RyaW5nKFxuICAgICAgICBjb2RlLmluZGV4T2YoJ1xcdWZmYmEnKSArIDIsXG4gICAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUgKyBpbmRlbnRUZXh0ICsgJ1xcdWZmYmUqL2AnKTtcbiAgICBjb2RlID0gY29kZS5zdWJzdHJpbmcoMCwgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIGxpbmUgPSBuZXcgTGluZTtcbiAgbGluZS5vZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhbeSx5XSk7XG4gIGxpbmUub2Zmc2V0ID0gbGluZS5vZmZzZXRSYW5nZVswXTtcbiAgbGluZS5sZW5ndGggPSBsaW5lLm9mZnNldFJhbmdlWzFdIC0gbGluZS5vZmZzZXRSYW5nZVswXSAtICh5IDwgdGhpcy5sb2MoKSk7XG4gIGxpbmUucG9pbnQuc2V0KHsgeDowLCB5OnkgfSk7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocC55KTtcbiAgdmFyIHBvaW50ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihsaW5lLmxlbmd0aCwgcC54KSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfSk7XG4gIHBvaW50Lm9mZnNldCA9IGxpbmUub2Zmc2V0ICsgcG9pbnQueDtcbiAgcG9pbnQucG9pbnQgPSBwb2ludDtcbiAgcG9pbnQubGluZSA9IGxpbmU7XG4gIHJldHVybiBwb2ludDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlVGV4dCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VPZmZzZXRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHJhbmdlWzFdID49IHRoaXMubG9jKClcbiAgICA/IHRoaXMudGV4dC5sZW5ndGhcbiAgICA6IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVsxXSArIDEpO1xuICB2YXIgb2Zmc2V0cyA9IFthLCBiXTtcbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFJhbmdlVGV4dCA9IGZ1bmN0aW9uKG9mZnNldFJhbmdlKSB7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldFJhbmdlKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciB0b2tlbiA9IHRoaXMudG9rZW5zLmdldEJ5T2Zmc2V0KCdsaW5lcycsIG9mZnNldCAtIC41KTtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogb2Zmc2V0IC0gKG9mZnNldCA+IHRva2VuLm9mZnNldCA/IHRva2VuLm9mZnNldCArICghIXRva2VuLnBhcnQubGVuZ3RoKSA6IDApLFxuICAgIHk6IE1hdGgubWluKHRoaXMubG9jKCksIHRva2VuLmluZGV4IC0gKHRva2VuLm9mZnNldCArIDEgPiBvZmZzZXQpICsgMSlcbiAgfSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgY2hhciA9IHRoaXMudGV4dC5nZXRSYW5nZShbb2Zmc2V0LCBvZmZzZXQgKyAxXSk7XG4gIHJldHVybiBjaGFyO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4ge1xuICAgIGxpbmU6IGxpbmUsXG4gICAgdGV4dDogdGV4dCxcbiAgfVxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHRleHQgPSB0aGlzLmdldExpbmVSYW5nZVRleHQoW3kseV0pO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYVRleHQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUud29yZEFyZWFBdFBvaW50ID0gZnVuY3Rpb24ocCwgaW5jbHVzaXZlKSB7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKHBvaW50LmxpbmUub2Zmc2V0UmFuZ2UpO1xuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHBvaW50LnkgfSxcbiAgICAgIGVuZDogeyB4OiBwb2ludC5saW5lLmxlbmd0aCwgeTogcG9pbnQueSB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFyZWE7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gISFpbmNsdXNpdmUpIHtcbiAgICAgIGVuZCA9IHdvcmQuaW5kZXg7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgbGFzdEluZGV4ID0gd29yZC5pbmRleDtcbiAgfVxuXG4gIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcblxuICByZXR1cm4gYXJlYTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubW92ZUFyZWFCeUxpbmVzID0gZnVuY3Rpb24oeSwgYXJlYSkge1xuICBpZiAoYXJlYS5lbmQueCA+IDAgfHwgYXJlYS5iZWdpbi55ID09PSBhcmVhLmVuZC55KSBhcmVhLmVuZC55ICs9IDE7XG4gIC8vVE9ETzogY3VycmVudGx5IHdpbGwgbm90IHJlYWNoIGxhc3QgbGluZVxuICAvLyBiZWNhdXNlIGl0J3MgYnVnZ3lcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MoKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGFyZWEuYmVnaW4ueCA9IDA7XG4gIGFyZWEuZW5kLnggPSAwO1xuXG4gIHZhciB0ZXh0ID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KFthcmVhLmJlZ2luLnksIGFyZWEuZW5kLnktMV0pO1xuICB0aGlzLnJlbW92ZUFyZWEoYXJlYSk7XG5cbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0KTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgcmFuZ2UgPSBbXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmJlZ2luKS5vZmZzZXQsXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmVuZCkub2Zmc2V0XG4gIF07XG4gIHJldHVybiByYW5nZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gbGluZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZU9mZnNldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIG9mZnNldCA9IHkgPCAwID8gLTEgOiB5ID09PSAwID8gMCA6IHRoaXMudG9rZW5zLmdldEJ5SW5kZXgoJ2xpbmVzJywgeSAtIDEpICsgMTtcbiAgcmV0dXJuIG9mZnNldDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubG9jID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdsaW5lcycpLmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudGV4dC50b1N0cmluZygpO1xufTtcblxuZnVuY3Rpb24gTGluZSgpIHtcbiAgdGhpcy5vZmZzZXRSYW5nZSA9IFtdO1xuICB0aGlzLm9mZnNldCA9IDA7XG4gIHRoaXMubGVuZ3RoID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRU9MKHMpIHtcbiAgcmV0dXJuIHMucmVwbGFjZShFT0wsICdcXG4nKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBJbmRleGVyO1xuXG5mdW5jdGlvbiBJbmRleGVyKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbn1cblxuSW5kZXhlci5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKCFzKSByZXR1cm4gW107XG4gIHZhciBvZmZzZXRzID0gW107XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIucmF3O1xuICB2YXIgbGVuID0gcy5sZW5ndGg7XG4gIHZhciBpbmRleDtcbiAgd2hpbGUgKH4oaW5kZXggPSB0ZXh0LmluZGV4T2YocywgaW5kZXggKyBsZW4pKSkge1xuICAgIG9mZnNldHMucHVzaChpbmRleCk7XG4gIH1cbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuIiwidmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUGFydHM7XG5cbmZ1bmN0aW9uIFBhcnRzKG1pblNpemUpIHtcbiAgbWluU2l6ZSA9IG1pblNpemUgfHwgNTAwMDtcbiAgdGhpcy5taW5TaXplID0gbWluU2l6ZTtcbiAgdGhpcy5wYXJ0cyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IDA7XG59XG5cblBhcnRzLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oaXRlbSkge1xuICB0aGlzLmFwcGVuZChbaXRlbV0pO1xufTtcblxuUGFydHMucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciBwYXJ0ID0gbGFzdCh0aGlzLnBhcnRzKTtcblxuICBpZiAoIXBhcnQpIHtcbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gMDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gMDtcbiAgICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIH1cbiAgZWxzZSBpZiAocGFydC5sZW5ndGggPj0gdGhpcy5taW5TaXplKSB7XG4gICAgdmFyIHN0YXJ0SW5kZXggPSBwYXJ0LnN0YXJ0SW5kZXggKyBwYXJ0Lmxlbmd0aDtcbiAgICB2YXIgc3RhcnRPZmZzZXQgPSBpdGVtc1swXTtcblxuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSBzdGFydEluZGV4O1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSBzdGFydE9mZnNldDtcbiAgICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIH1cblxuICBwYXJ0LnB1c2guYXBwbHkocGFydCwgaXRlbXMubWFwKG9mZnNldCA9PiBvZmZzZXQgLSBwYXJ0LnN0YXJ0T2Zmc2V0KSk7XG5cbiAgdGhpcy5sZW5ndGggKz0gaXRlbXMubGVuZ3RoO1xufTtcblxuUGFydHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHZhciBwYXJ0ID0gdGhpcy5maW5kUGFydEJ5SW5kZXgoaW5kZXgpLml0ZW07XG4gIHJldHVybiBwYXJ0W2luZGV4IC0gcGFydC5zdGFydEluZGV4XSArIHBhcnQuc3RhcnRPZmZzZXQ7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgcCA9IHRoaXMuZmluZFBhcnRCeU9mZnNldChvZmZzZXQpO1xuICBpZiAoIXAuaXRlbSkgcmV0dXJuIG51bGw7XG5cbiAgdmFyIHBhcnQgPSBwLml0ZW07XG4gIHZhciBwYXJ0SW5kZXggPSBwLmluZGV4O1xuICB2YXIgbyA9IHRoaXMuZmluZE9mZnNldEluUGFydChvZmZzZXQsIHBhcnQpO1xuICByZXR1cm4ge1xuICAgIG9mZnNldDogby5pdGVtICsgcGFydC5zdGFydE9mZnNldCxcbiAgICBpbmRleDogby5pbmRleCArIHBhcnQuc3RhcnRJbmRleCxcbiAgICBsb2NhbDogby5pbmRleCxcbiAgICBwYXJ0OiBwYXJ0LFxuICAgIHBhcnRJbmRleDogcGFydEluZGV4XG4gIH07XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBhcnJheSkge1xuICB2YXIgbyA9IHRoaXMuZmluZChvZmZzZXQpO1xuICBpZiAoIW8pIHtcbiAgICByZXR1cm4gdGhpcy5hcHBlbmQoYXJyYXkpO1xuICB9XG4gIGlmIChvLm9mZnNldCA+IG9mZnNldCkgby5sb2NhbCA9IC0xO1xuICB2YXIgbGVuZ3RoID0gYXJyYXkubGVuZ3RoO1xuICAvL1RPRE86IG1heWJlIHN1YnRyYWN0ICdvZmZzZXQnIGluc3RlYWQgP1xuICBhcnJheSA9IGFycmF5Lm1hcChlbCA9PiBlbCAtPSBvLnBhcnQuc3RhcnRPZmZzZXQpO1xuICBpbnNlcnQoby5wYXJ0LCBvLmxvY2FsICsgMSwgYXJyYXkpO1xuICB0aGlzLnNoaWZ0SW5kZXgoby5wYXJ0SW5kZXggKyAxLCAtbGVuZ3RoKTtcbiAgdGhpcy5sZW5ndGggKz0gbGVuZ3RoO1xufTtcblxuUGFydHMucHJvdG90eXBlLnNoaWZ0T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBzaGlmdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzO1xuICB2YXIgaXRlbSA9IHRoaXMuZmluZChvZmZzZXQpO1xuICBpZiAoIWl0ZW0pIHJldHVybjtcbiAgaWYgKG9mZnNldCA+IGl0ZW0ub2Zmc2V0KSBpdGVtLmxvY2FsICs9IDE7XG5cbiAgdmFyIHJlbW92ZWQgPSAwO1xuICBmb3IgKHZhciBpID0gaXRlbS5sb2NhbDsgaSA8IGl0ZW0ucGFydC5sZW5ndGg7IGkrKykge1xuICAgIGl0ZW0ucGFydFtpXSArPSBzaGlmdDtcbiAgICBpZiAoaXRlbS5wYXJ0W2ldICsgaXRlbS5wYXJ0LnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICByZW1vdmVkKys7XG4gICAgICBpdGVtLnBhcnQuc3BsaWNlKGktLSwgMSk7XG4gICAgfVxuICB9XG4gIGlmIChyZW1vdmVkKSB7XG4gICAgdGhpcy5zaGlmdEluZGV4KGl0ZW0ucGFydEluZGV4ICsgMSwgcmVtb3ZlZCk7XG4gICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgfVxuICBmb3IgKHZhciBpID0gaXRlbS5wYXJ0SW5kZXggKyAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBwYXJ0c1tpXS5zdGFydE9mZnNldCArPSBzaGlmdDtcbiAgICBpZiAocGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIGlmIChsYXN0KHBhcnRzW2ldKSArIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICAgIHJlbW92ZWQgPSBwYXJ0c1tpXS5sZW5ndGg7XG4gICAgICAgIHRoaXMuc2hpZnRJbmRleChpICsgMSwgcmVtb3ZlZCk7XG4gICAgICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gICAgICAgIHBhcnRzLnNwbGljZShpLS0sIDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZW1vdmVCZWxvd09mZnNldChvZmZzZXQsIHBhcnRzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBhID0gdGhpcy5maW5kKHJhbmdlWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmZpbmQocmFuZ2VbMV0pO1xuICBpZiAoIWEgJiYgIWIpIHJldHVybjtcblxuICBpZiAoYS5wYXJ0SW5kZXggPT09IGIucGFydEluZGV4KSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdCA9IHJlbW92ZShhLnBhcnQsIGEubG9jYWwsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgdGhpcy5zaGlmdEluZGV4KGEucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0O1xuICB9IGVsc2Uge1xuICAgIGlmIChhLm9mZnNldCA+PSByYW5nZVsxXSB8fCBhLm9mZnNldCA8IHJhbmdlWzBdKSBhLmxvY2FsICs9IDE7XG4gICAgaWYgKGIub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGIub2Zmc2V0IDwgcmFuZ2VbMF0pIGIubG9jYWwgLT0gMTtcbiAgICB2YXIgc2hpZnRBID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCkubGVuZ3RoO1xuICAgIHZhciBzaGlmdEIgPSByZW1vdmUoYi5wYXJ0LCAwLCBiLmxvY2FsICsgMSkubGVuZ3RoO1xuICAgIGlmIChiLnBhcnRJbmRleCAtIGEucGFydEluZGV4ID4gMSkge1xuICAgICAgdmFyIHJlbW92ZWQgPSByZW1vdmUodGhpcy5wYXJ0cywgYS5wYXJ0SW5kZXggKyAxLCBiLnBhcnRJbmRleCk7XG4gICAgICB2YXIgc2hpZnRCZXR3ZWVuID0gcmVtb3ZlZC5yZWR1Y2UoKHAsbikgPT4gcCArIG4ubGVuZ3RoLCAwKTtcbiAgICAgIGIucGFydC5zdGFydEluZGV4IC09IHNoaWZ0QSArIHNoaWZ0QmV0d2VlbjtcbiAgICAgIHRoaXMuc2hpZnRJbmRleChiLnBhcnRJbmRleCAtIHJlbW92ZWQubGVuZ3RoICsgMSwgc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuKTtcbiAgICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0QSArIHNoaWZ0QiArIHNoaWZ0QmV0d2VlbjtcbiAgICB9IGVsc2Uge1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4ICsgMSwgc2hpZnRBICsgc2hpZnRCKTtcbiAgICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0QSArIHNoaWZ0QjtcbiAgICB9XG4gIH1cblxuICAvL1RPRE86IHRoaXMgaXMgaW5lZmZpY2llbnQgYXMgd2UgY2FuIGNhbGN1bGF0ZSB0aGUgaW5kZXhlcyBvdXJzZWx2ZXNcbiAgaWYgKCFhLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGEucGFydCksIDEpO1xuICB9XG4gIGlmICghYi5wYXJ0Lmxlbmd0aCkge1xuICAgIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihiLnBhcnQpLCAxKTtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnNoaWZ0SW5kZXggPSBmdW5jdGlvbihzdGFydEluZGV4LCBzaGlmdCkge1xuICBmb3IgKHZhciBpID0gc3RhcnRJbmRleDsgaSA8IHRoaXMucGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnBhcnRzW2ldLnN0YXJ0SW5kZXggLT0gc2hpZnQ7XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVCZWxvd09mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgcGFydCkge1xuICB2YXIgbyA9IHRoaXMuZmluZE9mZnNldEluUGFydChvZmZzZXQsIHBhcnQpXG4gIHZhciBzaGlmdCA9IHJlbW92ZShwYXJ0LCAwLCBvLmluZGV4KS5sZW5ndGg7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIHNoaWZ0KTtcbiAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZE9mZnNldEluUGFydCA9IGZ1bmN0aW9uKG9mZnNldCwgcGFydCkge1xuICBvZmZzZXQgLT0gcGFydC5zdGFydE9mZnNldDtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaChwYXJ0LCBvID0+IG8gPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kUGFydEJ5SW5kZXggPSBmdW5jdGlvbihpbmRleCkge1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHRoaXMucGFydHMsIHMgPT4gcy5zdGFydEluZGV4IDw9IGluZGV4KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kUGFydEJ5T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0T2Zmc2V0IDw9IG9mZnNldCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUudG9BcnJheSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5wYXJ0cy5yZWR1Y2UoKHAsbikgPT4gcC5jb25jYXQobiksIFtdKTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGFydHMgPSBuZXcgUGFydHModGhpcy5taW5TaXplKTtcbiAgdGhpcy5wYXJ0cy5mb3JFYWNoKHBhcnQgPT4ge1xuICAgIHZhciBwID0gcGFydC5zbGljZSgpO1xuICAgIHAuc3RhcnRJbmRleCA9IHBhcnQuc3RhcnRJbmRleDtcbiAgICBwLnN0YXJ0T2Zmc2V0ID0gcGFydC5zdGFydE9mZnNldDtcbiAgICBwYXJ0cy5wYXJ0cy5wdXNoKHApO1xuICB9KTtcbiAgcGFydHMubGVuZ3RoID0gdGhpcy5sZW5ndGg7XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbmZ1bmN0aW9uIGxhc3QoYXJyYXkpIHtcbiAgcmV0dXJuIGFycmF5W2FycmF5Lmxlbmd0aCAtIDFdO1xufVxuXG5mdW5jdGlvbiByZW1vdmUoYXJyYXksIGEsIGIpIHtcbiAgaWYgKGIgPT0gbnVsbCkge1xuICAgIHJldHVybiBhcnJheS5zcGxpY2UoYSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhLCBiIC0gYSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgaW5kZXgsIGFycmF5KSB7XG4gIHZhciBvcCA9IGFycmF5LnNsaWNlKCk7XG4gIG9wLnVuc2hpZnQoaW5kZXgsIDApO1xuICB0YXJnZXQuc3BsaWNlLmFwcGx5KHRhcmdldCwgb3ApO1xufVxuIiwiLy8gdmFyIFdPUkQgPSAvXFx3Ky9nO1xudmFyIFdPUkQgPSAvW2EtekEtWjAtOV17MSx9L2dcbnZhciByYW5rID0gMDtcblxubW9kdWxlLmV4cG9ydHMgPSBQcmVmaXhUcmVlTm9kZTtcblxuZnVuY3Rpb24gUHJlZml4VHJlZU5vZGUoKSB7XG4gIHRoaXMudmFsdWUgPSAnJztcbiAgdGhpcy5yYW5rID0gMDtcbiAgdGhpcy5jaGlsZHJlbiA9IHt9O1xufVxuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZ2V0Q2hpbGRyZW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNoaWxkcmVuID0gT2JqZWN0XG4gICAgLmtleXModGhpcy5jaGlsZHJlbilcbiAgICAubWFwKChrZXkpID0+IHRoaXMuY2hpbGRyZW5ba2V5XSk7XG5cbiAgcmV0dXJuIGNoaWxkcmVuLnJlZHVjZSgocCwgbikgPT4gcC5jb25jYXQobi5nZXRDaGlsZHJlbigpKSwgY2hpbGRyZW4pO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmNvbGxlY3QgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIGNvbGxlY3Rpb24gPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmZpbmQoa2V5KTtcbiAgaWYgKG5vZGUpIHtcbiAgICBjb2xsZWN0aW9uID0gbm9kZVxuICAgICAgLmdldENoaWxkcmVuKClcbiAgICAgIC5maWx0ZXIoKG5vZGUpID0+IG5vZGUudmFsdWUpXG4gICAgICAuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICB2YXIgcmVzID0gYi5yYW5rIC0gYS5yYW5rO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBiLnZhbHVlLmxlbmd0aCAtIGEudmFsdWUubGVuZ3RoO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBhLnZhbHVlID4gYi52YWx1ZTtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pO1xuXG4gICAgaWYgKG5vZGUudmFsdWUpIGNvbGxlY3Rpb24ucHVzaChub2RlKTtcbiAgfVxuICByZXR1cm4gY29sbGVjdGlvbjtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgZm9yICh2YXIgY2hhciBpbiBrZXkpIHtcbiAgICBpZiAoa2V5W2NoYXJdIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW2tleVtjaGFyXV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5vZGU7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICB2YXIgaSA9IDA7XG4gIHZhciBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgaWYgKHNbaV0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bc1tpXV07XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIG5vZGUgPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gfHwgbmV3IFByZWZpeFRyZWVOb2RlO1xuICAgIGkrKztcbiAgfVxuXG4gIG5vZGUudmFsdWUgPSBzO1xuICBub2RlLnJhbmsrKztcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmQ7XG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgdGhpcy5pbnNlcnQod29yZFswXSk7XG4gIH1cbn07XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgVHlwZSA9IFRva2Vucy5UeXBlO1xuXG52YXIgQmVnaW4gPSAvW1xcLydcImBdL2c7XG5cbnZhciBNYXRjaCA9IHtcbiAgJ3NpbmdsZSBjb21tZW50JzogWycvLycsJ1xcbiddLFxuICAnZG91YmxlIGNvbW1lbnQnOiBbJy8qJywnKi8nXSxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IFsnYCcsJ2AnXSxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBbXCInXCIsXCInXCJdLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFsnXCInLCdcIiddLFxuICAncmVnZXhwJzogWycvJywnLyddLFxufTtcblxudmFyIFNraXAgPSB7XG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdzaW5nbGUgY29tbWVudCc6IGZhbHNlLFxuICAnZG91YmxlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ3JlZ2V4cCc6IFwiXFxcXFwiLFxufTtcblxudmFyIFRva2VuID0ge307XG5mb3IgKHZhciBrZXkgaW4gTWF0Y2gpIHtcbiAgdmFyIE0gPSBNYXRjaFtrZXldO1xuICBUb2tlbltNWzBdXSA9IGtleTtcbn1cblxudmFyIExlbmd0aCA9IHtcbiAgJ29wZW4gY29tbWVudCc6IDIsXG4gICdjbG9zZSBjb21tZW50JzogMixcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IDEsXG59O1xuXG52YXIgTm90T3BlbiA9IHtcbiAgJ2Nsb3NlIGNvbW1lbnQnOiB0cnVlXG59O1xuXG52YXIgQ2xvc2VzID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVGFnID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2NvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3N0cmluZycsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRzO1xuXG5mdW5jdGlvbiBTZWdtZW50cyhidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG4gIHRoaXMuY2FjaGUgPSB7fTtcbiAgdGhpcy5yZXNldCgpO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0KSB7XG4gICAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLm9mZnNldCA8IG9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZS5zcGxpY2Uocy5pbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZSA9IFtdO1xuICB9XG4gIHRoaXMuY2FjaGUub2Zmc2V0ID0ge307XG4gIHRoaXMuY2FjaGUucmFuZ2UgPSB7fTtcbiAgdGhpcy5jYWNoZS5wb2ludCA9IHt9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXJDYWNoZSgpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHkpIHtcbiAgaWYgKHkgaW4gdGhpcy5jYWNoZS5wb2ludCkge1xuICAgIHJldHVybiB0aGlzLmNhY2hlLnBvaW50W3ldO1xuICB9XG5cbiAgdmFyIHNlZ21lbnRzID0gdGhpcy5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ3NlZ21lbnRzJyk7XG4gIHZhciBvcGVuID0gZmFsc2U7XG4gIHZhciBzdGF0ZSA9IG51bGw7XG4gIHZhciB3YWl0Rm9yID0gJyc7XG4gIHZhciBwb2ludCA9IHsgeDotMSwgeTotMSB9O1xuICB2YXIgY2xvc2UgPSAwO1xuICB2YXIgb2Zmc2V0O1xuICB2YXIgc2VnbWVudDtcbiAgdmFyIHJhbmdlO1xuICB2YXIgdGV4dDtcbiAgdmFyIHZhbGlkO1xuICB2YXIgbGFzdDtcblxuICB2YXIgbGFzdENhY2hlU3RhdGVPZmZzZXQgPSAwO1xuXG4gIHZhciBpID0gMDtcblxuICB2YXIgY2FjaGVTdGF0ZSA9IHRoaXMuZ2V0Q2FjaGVTdGF0ZSh5KTtcbiAgaWYgKGNhY2hlU3RhdGUgJiYgY2FjaGVTdGF0ZS5pdGVtKSB7XG4gICAgb3BlbiA9IHRydWU7XG4gICAgc3RhdGUgPSBjYWNoZVN0YXRlLml0ZW07XG4gICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICBpID0gc3RhdGUuaW5kZXggKyAxO1xuICB9XG5cbiAgZm9yICg7IGkgPCBzZWdtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIG9mZnNldCA9IHNlZ21lbnRzLmdldChpKTtcbiAgICBzZWdtZW50ID0ge1xuICAgICAgb2Zmc2V0OiBvZmZzZXQsXG4gICAgICB0eXBlOiBUeXBlW3RoaXMuYnVmZmVyLmNoYXJBdChvZmZzZXQpXVxuICAgIH07XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIGNsb3NlIHRva2VuXG4gICAgaWYgKG9wZW4pIHtcbiAgICAgIGlmICh3YWl0Rm9yID09PSBzZWdtZW50LnR5cGUpIHtcbiAgICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNlYXJjaGluZyBmb3Igb3BlbiB0b2tlblxuICAgIGVsc2Uge1xuICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgIH1cblxuICAgICAgcmFuZ2UgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKHBvaW50LnkpLm9mZnNldFJhbmdlO1xuXG4gICAgICBpZiAobGFzdCAmJiBsYXN0LnBvaW50LnkgPT09IHBvaW50LnkpIHtcbiAgICAgICAgY2xvc2UgPSBsYXN0LnBvaW50LnggKyBMZW5ndGhbbGFzdC50eXBlXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNsb3NlID0gMDtcbiAgICAgIH1cblxuICAgICAgdmFsaWQgPSB0aGlzLmlzVmFsaWRSYW5nZShbcmFuZ2VbMF0sIHJhbmdlWzFdKzFdLCBzZWdtZW50LCBjbG9zZSk7XG5cbiAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICBpZiAoTm90T3BlbltzZWdtZW50LnR5cGVdKSBjb250aW51ZTtcbiAgICAgICAgb3BlbiA9IHRydWU7XG4gICAgICAgIHN0YXRlID0gc2VnbWVudDtcbiAgICAgICAgc3RhdGUuaW5kZXggPSBpO1xuICAgICAgICBzdGF0ZS5wb2ludCA9IHBvaW50O1xuICAgICAgICAvLyBzdGF0ZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5vZmZzZXQgfTtcbiAgICAgICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICAgICAgaWYgKCF0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCB8fCB0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAmJiBzdGF0ZS5vZmZzZXQgPiB0aGlzLmNhY2hlLnN0YXRlW3RoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIC0gMV0ub2Zmc2V0KSB7XG4gICAgICAgICAgdGhpcy5jYWNoZS5zdGF0ZS5wdXNoKHN0YXRlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhdGUgJiYgc3RhdGUucG9pbnQueSA8IHkpIHtcbiAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICB9XG5cbiAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG59O1xuXG4vL1RPRE86IGNhY2hlIGluIEJ1ZmZlclxuU2VnbWVudHMucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQgaW4gdGhpcy5jYWNoZS5vZmZzZXQpIHJldHVybiB0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdO1xuICByZXR1cm4gKHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF0gPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgc2VnbWVudCwgY2xvc2UpIHtcbiAgdmFyIGtleSA9IHJhbmdlLmpvaW4oKTtcbiAgaWYgKGtleSBpbiB0aGlzLmNhY2hlLnJhbmdlKSByZXR1cm4gdGhpcy5jYWNoZS5yYW5nZVtrZXldO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFJhbmdlVGV4dChyYW5nZSk7XG4gIHZhciB2YWxpZCA9IHRoaXMuaXNWYWxpZCh0ZXh0LCBzZWdtZW50Lm9mZnNldCAtIHJhbmdlWzBdLCBjbG9zZSk7XG4gIHJldHVybiAodGhpcy5jYWNoZS5yYW5nZVtrZXldID0gdmFsaWQpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWQgPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQsIGxhc3RJbmRleCkge1xuICBCZWdpbi5sYXN0SW5kZXggPSBsYXN0SW5kZXg7XG5cbiAgdmFyIG1hdGNoID0gQmVnaW4uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuXG4gIHZhciBpID0gbWF0Y2guaW5kZXg7XG5cbiAgdmFyIGxhc3QgPSBpO1xuXG4gIHZhciB2YWxpZCA9IHRydWU7XG5cbiAgb3V0ZXI6XG4gIGZvciAoOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBvbmUgPSB0ZXh0W2ldO1xuICAgIHZhciBuZXh0ID0gdGV4dFtpICsgMV07XG4gICAgdmFyIHR3byA9IG9uZSArIG5leHQ7XG4gICAgaWYgKGkgPT09IG9mZnNldCkgcmV0dXJuIHRydWU7XG5cbiAgICB2YXIgbyA9IFRva2VuW3R3b107XG4gICAgaWYgKCFvKSBvID0gVG9rZW5bb25lXTtcbiAgICBpZiAoIW8pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHZhciB3YWl0Rm9yID0gTWF0Y2hbb11bMV07XG5cbiAgICBsYXN0ID0gaTtcblxuICAgIHN3aXRjaCAod2FpdEZvci5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSBvbmUpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAxO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG5cbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuICAgICAgICAgIHR3byA9IHRleHRbaV0gKyB0ZXh0W2kgKyAxXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSB0d28pIHtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAyO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0Q2FjaGVTdGF0ZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLnBvaW50LnkgPCB5KTtcbiAgaWYgKHMuaXRlbSAmJiB5IC0gMSA8IHMuaXRlbS5wb2ludC55KSByZXR1cm4gbnVsbDtcbiAgZWxzZSByZXR1cm4gcztcbiAgLy8gcmV0dXJuIHM7XG59O1xuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplIHx8IDUwMDA7XG59XG5cblNraXBTdHJpbmcucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLmhlYWQud2lkdGhbdGhpcy5sZXZlbHMgLSAxXTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIC8vIGdyZWF0IGhhY2sgdG8gZG8gb2Zmc2V0ID49IGZvciAuc2VhcmNoKClcbiAgLy8gd2UgZG9uJ3QgaGF2ZSBmcmFjdGlvbnMgYW55d2F5IHNvLi5cbiAgcmV0dXJuIHRoaXMuc2VhcmNoKG9mZnNldCwgdHJ1ZSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaW5zZXJ0Q2h1bmtlZCgwLCB0ZXh0KTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKG9mZnNldCwgaW5jbCkge1xuICBpbmNsID0gaW5jbCA/IC4xIDogMDtcblxuICAvLyBwcmVwYXJlIHRvIGhvbGQgc3RlcHNcbiAgdmFyIHN0ZXBzID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcbiAgdmFyIHdpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcblxuICAvLyBpdGVyYXRlIGxldmVscyBkb3duLCBza2lwcGluZyB0b3BcbiAgdmFyIGkgPSB0aGlzLmxldmVscztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHdoaWxlIChvZmZzZXQgKyBpbmNsID4gbm9kZS53aWR0aFtpXSAmJiBudWxsICE9IG5vZGUubmV4dFtpXSkge1xuICAgICAgb2Zmc2V0IC09IG5vZGUud2lkdGhbaV07XG4gICAgICBub2RlID0gbm9kZS5uZXh0W2ldO1xuICAgIH1cbiAgICBzdGVwc1tpXSA9IG5vZGU7XG4gICAgd2lkdGhbaV0gPSBvZmZzZXQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG5vZGU6IG5vZGUsXG4gICAgc3RlcHM6IHN0ZXBzLFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBvZmZzZXQ6IG9mZnNldFxuICB9O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3BsaWNlID0gZnVuY3Rpb24ocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwczsgLy8gc2tpcCBzdGVwcyBsZWZ0IG9mIHRoZSBvZmZzZXRcbiAgdmFyIHdpZHRoID0gcy53aWR0aDtcblxuICB2YXIgcDsgLy8gbGVmdCBub2RlIG9yIGBwYFxuICB2YXIgcTsgLy8gcmlnaHQgbm9kZSBvciBgcWAgKG91ciBuZXcgbm9kZSlcbiAgdmFyIGxlbjtcblxuICAvLyBjcmVhdGUgbmV3IG5vZGVcbiAgbGV2ZWwgPSBsZXZlbCB8fCB0aGlzLnJhbmRvbUxldmVsKCk7XG4gIHEgPSBuZXcgTm9kZSh2YWx1ZSwgbGV2ZWwpO1xuICBsZW5ndGggPSBxLndpZHRoWzBdO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgbGV2ZWxzIGJlbG93IG5ldyBub2RlIGxldmVsXG4gIGkgPSBsZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsIHN0ZXBcbiAgICBxLm5leHRbaV0gPSBwLm5leHRbaV07IC8vIGluc2VydCBzbyBpbmhlcml0IGxlZnQncyBuZXh0XG4gICAgcC5uZXh0W2ldID0gcTsgLy8gbGVmdCdzIG5leHQgaXMgbm93IG91ciBuZXcgbm9kZVxuICAgIHEud2lkdGhbaV0gPSBwLndpZHRoW2ldIC0gd2lkdGhbaV0gKyBsZW5ndGg7XG4gICAgcC53aWR0aFtpXSA9IHdpZHRoW2ldO1xuICB9XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBhbGwgbGV2ZWxzIGRvd24gdW50aWwgZXhjZXB0IG5ldyBub2RlIGxldmVsXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IGxldmVsKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWxcbiAgICBwLndpZHRoW2ldICs9IGxlbmd0aDsgLy8gYWRkIG5ldyBub2RlIHdpZHRoXG4gIH1cblxuICAvLyByZXR1cm4gbmV3IG5vZGVcbiAgcmV0dXJuIHE7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgcyA9IHRoaXMuc2VhcmNoKG9mZnNldCk7XG5cbiAgLy8gaWYgc2VhcmNoIGZhbGxzIGluIHRoZSBtaWRkbGUgb2YgYSBzdHJpbmdcbiAgLy8gaW5zZXJ0IGl0IHRoZXJlIGluc3RlYWQgb2YgY3JlYXRpbmcgYSBuZXcgbm9kZVxuICBpZiAocy5vZmZzZXQgJiYgcy5ub2RlLnZhbHVlICYmIHMub2Zmc2V0IDwgcy5ub2RlLnZhbHVlLmxlbmd0aCkge1xuICAgIHRoaXMudXBkYXRlKHMsIGluc2VydChzLm9mZnNldCwgcy5ub2RlLnZhbHVlLCB2YWx1ZSkpO1xuICAgIHJldHVybiBzLm5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5zcGxpY2Uocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgLy8gdmFsdWVzIGxlbmd0aCBkaWZmZXJlbmNlXG4gIHZhciBsZW5ndGggPSBzLm5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIC8vIHVwZGF0ZSB2YWx1ZVxuICBzLm5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBmaXggd2lkdGhzIG9uIGFsbCBsZXZlbHNcbiAgaSA9IHRoaXMubGV2ZWxzO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBzLnN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihyYW5nZSkge1xuICBpZiAocmFuZ2VbMV0gPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdyYW5nZSBlbmQgb3ZlciBtYXhpbXVtIGxlbmd0aCgnICtcbiAgICAgIHRoaXMubGVuZ3RoICsgJyk6IFsnICsgcmFuZ2Uuam9pbigpICsgJ10nXG4gICAgKTtcbiAgfVxuXG4gIC8vIHJlbWFpbiBkaXN0YW5jZSB0byByZW1vdmVcbiAgdmFyIHggPSByYW5nZVsxXSAtIHJhbmdlWzBdO1xuXG4gIC8vIHNlYXJjaCBmb3Igbm9kZSBvbiBsZWZ0IGVkZ2VcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChyYW5nZVswXSk7XG4gIHZhciBvZmZzZXQgPSBzLm9mZnNldDtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwcztcbiAgdmFyIG5vZGUgPSBzLm5vZGU7XG5cbiAgLy8gc2tpcCBoZWFkXG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgLy8gc2xpY2UgbGVmdCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAob2Zmc2V0KSB7XG4gICAgaWYgKG9mZnNldCA8IG5vZGUud2lkdGhbMF0pIHtcbiAgICAgIHggLT0gdGhpcy51cGRhdGUocyxcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZSgwLCBvZmZzZXQpICtcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZShcbiAgICAgICAgICBvZmZzZXQgK1xuICAgICAgICAgIE1hdGgubWluKHgsIG5vZGUubGVuZ3RoIC0gb2Zmc2V0KVxuICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgICBpZiAoIW5vZGUpIHJldHVybjtcbiAgfVxuXG4gIC8vIHJlbW92ZSBhbGwgZnVsbCBub2RlcyBpbiByYW5nZVxuICB3aGlsZSAobm9kZSAmJiB4ID49IG5vZGUud2lkdGhbMF0pIHtcbiAgICB4IC09IHRoaXMucmVtb3ZlTm9kZShzdGVwcywgbm9kZSk7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuXG4gIC8vIHNsaWNlIHJpZ2h0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmICh4KSB7XG4gICAgdGhpcy5yZXBsYWNlKHN0ZXBzLCBub2RlLCBub2RlLnZhbHVlLnNsaWNlKHgpKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlTm9kZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLndpZHRoWzBdO1xuXG4gIHZhciBpO1xuXG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoIC0gbm9kZS53aWR0aFtpXTtcbiAgICBzdGVwc1tpXS5uZXh0W2ldID0gbm9kZS5uZXh0W2ldO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZXBsYWNlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUsIHZhbHVlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICBub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgdmFyIGk7XG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgbm9kZS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gdGhpcy5yZW1vdmUoW29mZnNldCwgb2Zmc2V0KzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydENodW5rZWQgPSBmdW5jdGlvbihvZmZzZXQsIHRleHQpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0ZXh0Lmxlbmd0aDsgaSArPSB0aGlzLmNodW5rU2l6ZSkge1xuICAgIHZhciBjaHVuayA9IHRleHQuc3Vic3RyKGksIHRoaXMuY2h1bmtTaXplKTtcbiAgICB0aGlzLmluc2VydChpICsgb2Zmc2V0LCBjaHVuayk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnN1YnN0cmluZyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgdmFyIGxlbmd0aCA9IGIgLSBhO1xuXG4gIHZhciBzZWFyY2ggPSB0aGlzLnNlYXJjaChhLCB0cnVlKTtcbiAgdmFyIG5vZGUgPSBzZWFyY2gubm9kZTtcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgdmFyIGQgPSBsZW5ndGggKyBzZWFyY2gub2Zmc2V0O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAobm9kZSAmJiBkID49IDApIHtcbiAgICBkIC09IG5vZGUud2lkdGhbMF07XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cbiAgaWYgKG5vZGUpIHtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gIH1cblxuICByZXR1cm4gcy5zdWJzdHIoc2VhcmNoLm9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJhbmRvbUxldmVsID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsZXZlbCA9IDE7XG4gIHdoaWxlIChsZXZlbCA8IHRoaXMubGV2ZWxzIC0gMSAmJiBNYXRoLnJhbmRvbSgpIDwgdGhpcy5iaWFzKSBsZXZlbCsrO1xuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJhbmdlID0gcmFuZ2UgfHwgW107XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZyhyYW5nZVswXSwgcmFuZ2VbMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29weSA9IG5ldyBTa2lwU3RyaW5nO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgdmFyIG9mZnNldCA9IDA7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgY29weS5pbnNlcnQob2Zmc2V0LCBub2RlLnZhbHVlKTtcbiAgICBvZmZzZXQgKz0gbm9kZS53aWR0aFswXTtcbiAgfVxuICByZXR1cm4gY29weTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmpvaW5TdHJpbmcgPSBmdW5jdGlvbihkZWxpbWl0ZXIpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIHBhcnRzLnB1c2gobm9kZS52YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzLmpvaW4oZGVsaW1pdGVyKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZygwLCB0aGlzLmxlbmd0aCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIFIgPSBSZWdleHAuY3JlYXRlO1xuXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcbnZhciBzeW50YXggPSBtYXAoe1xuICAndCc6IFIoWydvcGVyYXRvciddLCAnZycsIGVudGl0aWVzKSxcbiAgJ20nOiBSKFsncGFyYW1zJ10sICAgJ2cnKSxcbiAgJ2QnOiBSKFsnZGVjbGFyZSddLCAgJ2cnKSxcbiAgJ2YnOiBSKFsnZnVuY3Rpb24nXSwgJ2cnKSxcbiAgJ2snOiBSKFsna2V5d29yZCddLCAgJ2cnKSxcbiAgJ24nOiBSKFsnYnVpbHRpbiddLCAgJ2cnKSxcbiAgJ2wnOiBSKFsnc3ltYm9sJ10sICAgJ2cnKSxcbiAgJ3MnOiBSKFsndGVtcGxhdGUgc3RyaW5nJ10sICdnJyksXG4gICdlJzogUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0ge1xuICByZWdleHA6IFIoWydpbmRlbnQnXSwgJ2dtJyksXG4gIHJlcGxhY2VyOiAocykgPT4gcy5yZXBsYWNlKC8gezEsMn18XFx0L2csICc8eD4kJjwveD4nKVxufTtcblxudmFyIEFueUNoYXIgPSAvXFxTL2c7XG5cbnZhciBCbG9ja3MgPSBSKFsnY29tbWVudCcsJ3N0cmluZycsJ3JlZ2V4cCddLCAnZ20nKTtcblxudmFyIExvbmdMaW5lcyA9IC8oXi57MTAwMCx9KS9nbTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2MnLFxuICAnLyonOiAnYycsXG4gICdgJzogJ3MnLFxuICAnXCInOiAncycsXG4gIFwiJ1wiOiAncycsXG4gICcvJzogJ3InLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW50YXg7XG5cbmZ1bmN0aW9uIFN5bnRheChvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLnRhYiA9IG8udGFiIHx8ICdcXHQnO1xuICB0aGlzLmJsb2NrcyA9IFtdO1xufVxuXG5TeW50YXgucHJvdG90eXBlLmVudGl0aWVzID0gZW50aXRpZXM7XG5cblN5bnRheC5wcm90b3R5cGUuaGlnaGxpZ2h0ID0gZnVuY3Rpb24oY29kZSwgb2Zmc2V0KSB7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUluZGVudHMoY29kZSk7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGVudGl0aWVzKGNvZGUpO1xuXG4gIGZvciAodmFyIGtleSBpbiBzeW50YXgpIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHN5bnRheFtrZXldLnJlZ2V4cCwgc3ludGF4W2tleV0ucmVwbGFjZXIpO1xuICB9XG5cbiAgY29kZSA9IHRoaXMucmVzdG9yZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGNvZGUucmVwbGFjZShJbmRlbnQucmVnZXhwLCBJbmRlbnQucmVwbGFjZXIpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVJbmRlbnRzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XG4gIHZhciBpbmRlbnQgPSAwO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBsaW5lO1xuICB2YXIgaTtcblxuICBpID0gbGluZXMubGVuZ3RoO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGxpbmUpO1xuICAgIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gICAgZWxzZSBpZiAoaW5kZW50ICYmICFsaW5lLmxlbmd0aCkge1xuICAgICAgbGluZXNbaV0gPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnRhYik7XG4gICAgfVxuICB9XG5cbiAgY29kZSA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5yZXN0b3JlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgYmxvY2s7XG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcbiAgdmFyIG4gPSAwO1xuICByZXR1cm4gY29kZVxuICAgIC5yZXBsYWNlKC9cXHVmZmVjL2csIGZ1bmN0aW9uKCkge1xuICAgICAgYmxvY2sgPSBibG9ja3NbbisrXTtcbiAgICAgIHJldHVybiBlbnRpdGllcyhibG9jay5zbGljZSgwLCAxMDAwKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknKTtcbiAgICB9KVxuICAgIC5yZXBsYWNlKC9cXHVmZmViL2csIGZ1bmN0aW9uKCkge1xuICAgICAgYmxvY2sgPSBibG9ja3NbbisrXTtcbiAgICAgIHZhciB0YWcgPSBpZGVudGlmeShibG9jayk7XG4gICAgICByZXR1cm4gJzwnK3RhZysnPicrZW50aXRpZXMoYmxvY2spKyc8LycrdGFnKyc+JztcbiAgICB9KTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB0aGlzLmJsb2NrcyA9IFtdO1xuXG4gIGNvZGUgPSBjb2RlXG4gICAgLnJlcGxhY2UoTG9uZ0xpbmVzLCAoYmxvY2spID0+IHtcbiAgICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgcmV0dXJuICdcXHVmZmVjJztcbiAgICB9KVxuICAgIC5yZXBsYWNlKEJsb2NrcywgKGJsb2NrKSA9PiB7XG4gICAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgIHJldHVybiAnXFx1ZmZlYic7XG4gICAgfSk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVJZCgpIHtcbiAgdmFyIGFscGhhYmV0ID0gJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6JztcbiAgdmFyIGxlbmd0aCA9IGFscGhhYmV0Lmxlbmd0aCAtIDE7XG4gIHZhciBpID0gNjtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKGktLSkge1xuICAgIHMgKz0gYWxwaGFiZXRbTWF0aC5yYW5kb20oKSAqIGxlbmd0aCB8IDBdO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBlbnRpdGllcyh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIDtcbn1cblxuZnVuY3Rpb24gY29tcGlsZShyZWdleHAsIHRhZykge1xuICB2YXIgb3BlblRhZyA9ICc8JyArIHRhZyArICc+JztcbiAgdmFyIGNsb3NlVGFnID0gJzwvJyArIHRhZyArICc+JztcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiB0YWcsXG4gICAgcmVnZXhwOiByZWdleHAsXG4gICAgcmVwbGFjZXI6IG9wZW5UYWcgKyAnJCYnICsgY2xvc2VUYWdcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFwKG9iaiwgZm4pIHtcbiAgdmFyIHJlc3VsdCA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgcmVzdWx0W2tleV0gPSBmbihvYmpba2V5XSwga2V5KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiByZXBsYWNlKHBhc3MsIGNvZGUpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXNzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShwYXNzW2ldWzBdLCBwYXNzW2ldWzFdKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cblxuZnVuY3Rpb24gaWRlbnRpZnkoYmxvY2spIHtcbiAgdmFyIG9uZSA9IGJsb2NrWzBdO1xuICB2YXIgdHdvID0gb25lICsgYmxvY2tbMV07XG4gIHJldHVybiBUYWdbdHdvXSB8fCBUYWdbb25lXTtcbn1cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFBhcnRzID0gcmVxdWlyZSgnLi9wYXJ0cycpO1xuXG52YXIgVHlwZSA9IHtcbiAgJ1xcbic6ICdsaW5lcycsXG4gICd7JzogJ29wZW4gY3VybHknLFxuICAnfSc6ICdjbG9zZSBjdXJseScsXG4gICdbJzogJ29wZW4gc3F1YXJlJyxcbiAgJ10nOiAnY2xvc2Ugc3F1YXJlJyxcbiAgJygnOiAnb3BlbiBwYXJlbnMnLFxuICAnKSc6ICdjbG9zZSBwYXJlbnMnLFxuICAnLyc6ICdvcGVuIGNvbW1lbnQnLFxuICAnKic6ICdjbG9zZSBjb21tZW50JyxcbiAgJ2AnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUT0tFTiA9IC9cXG58XFwvXFwqfFxcKlxcL3xgfFxce3xcXH18XFxbfFxcXXxcXCh8XFwpL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gVG9rZW5zO1xuXG5Ub2tlbnMuVHlwZSA9IFR5cGU7XG5cbmZ1bmN0aW9uIFRva2VucyhmYWN0b3J5KSB7XG4gIGZhY3RvcnkgPSBmYWN0b3J5IHx8IGZ1bmN0aW9uKCkgeyByZXR1cm4gbmV3IFBhcnRzOyB9O1xuXG4gIHRoaXMuZmFjdG9yeSA9IGZhY3Rvcnk7XG5cbiAgdmFyIHQgPSB0aGlzLnRva2VucyA9IHtcbiAgICBsaW5lczogZmFjdG9yeSgpLFxuICAgIGJsb2NrczogZmFjdG9yeSgpLFxuICAgIHNlZ21lbnRzOiBmYWN0b3J5KCksXG4gIH07XG5cbiAgdGhpcy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xufVxuXG5Ub2tlbnMucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVG9rZW5zLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfHwgMDtcblxuICB2YXIgdG9rZW5zID0gdGhpcy50b2tlbnM7XG4gIHZhciBtYXRjaDtcbiAgdmFyIHR5cGU7XG4gIHZhciBjb2xsZWN0aW9uO1xuXG4gIHdoaWxlIChtYXRjaCA9IFRPS0VOLmV4ZWModGV4dCkpIHtcbiAgICBjb2xsZWN0aW9uID0gdGhpcy5jb2xsZWN0aW9uW3RleHRbbWF0Y2guaW5kZXhdXTtcbiAgICBjb2xsZWN0aW9uLnB1c2gobWF0Y2guaW5kZXggKyBvZmZzZXQpO1xuICB9XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHJhbmdlLCB0ZXh0LCBzaGlmdCkge1xuICB2YXIgaW5zZXJ0ID0gbmV3IFRva2VucyhBcnJheSk7XG4gIGluc2VydC5pbmRleCh0ZXh0LCByYW5nZVswXSk7XG5cbiAgdmFyIGxlbmd0aHMgPSB7fTtcbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIGxlbmd0aHNbdHlwZV0gPSB0aGlzLnRva2Vuc1t0eXBlXS5sZW5ndGg7XG4gIH1cblxuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uc2hpZnRPZmZzZXQocmFuZ2VbMF0sIHNoaWZ0KTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5yZW1vdmVSYW5nZShyYW5nZSk7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uaW5zZXJ0KHJhbmdlWzBdLCBpbnNlcnQudG9rZW5zW3R5cGVdKTtcbiAgfVxuXG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICBpZiAodGhpcy50b2tlbnNbdHlwZV0ubGVuZ3RoICE9PSBsZW5ndGhzW3R5cGVdKSB7XG4gICAgICB0aGlzLmVtaXQoYGNoYW5nZSAke3R5cGV9YCk7XG4gICAgfVxuICB9XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5SW5kZXggPSBmdW5jdGlvbih0eXBlLCBpbmRleCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZ2V0KGluZGV4KTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0Q29sbGVjdGlvbiA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeU9mZnNldCA9IGZ1bmN0aW9uKHR5cGUsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZmluZChvZmZzZXQpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciB0b2tlbnMgPSBuZXcgVG9rZW5zKHRoaXMuZmFjdG9yeSk7XG4gIHZhciB0ID0gdG9rZW5zLnRva2VucztcbiAgZm9yICh2YXIga2V5IGluIHRoaXMudG9rZW5zKSB7XG4gICAgdFtrZXldID0gdGhpcy50b2tlbnNba2V5XS5zbGljZSgpO1xuICB9XG4gIHRva2Vucy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xuICByZXR1cm4gdG9rZW5zO1xufTtcbiIsInZhciBvcGVuID0gcmVxdWlyZSgnLi4vbGliL29wZW4nKTtcbnZhciBzYXZlID0gcmVxdWlyZSgnLi4vbGliL3NhdmUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJy4vYnVmZmVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmlsZTtcblxuZnVuY3Rpb24gRmlsZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLnJvb3QgPSAnJztcbiAgdGhpcy5wYXRoID0gJ3VudGl0bGVkJztcbiAgdGhpcy5idWZmZXIgPSBuZXcgQnVmZmVyO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5GaWxlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkZpbGUucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJ1ZmZlci5vbigncmF3JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3JhdycpKTtcbiAgdGhpcy5idWZmZXIub24oJ3NldCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdzZXQnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCd1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY2hhbmdlJykpO1xuICB0aGlzLmJ1ZmZlci5vbignYmVmb3JlIHVwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdiZWZvcmUgY2hhbmdlJykpO1xufTtcblxuRmlsZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMucGF0aCA9IHBhdGg7XG4gIHRoaXMucm9vdCA9IHJvb3Q7XG4gIG9wZW4ocm9vdCArIHBhdGgsIChlcnIsIHRleHQpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIGZuICYmIGZuKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG4gICAgdGhpcy5lbWl0KCdvcGVuJyk7XG4gICAgZm4gJiYgZm4obnVsbCwgdGhpcyk7XG4gIH0pO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHNhdmUodGhpcy5yb290ICsgdGhpcy5wYXRoLCB0aGlzLmJ1ZmZlci50b1N0cmluZygpLCBmbiB8fCBub29wKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vbGliL2RlYm91bmNlJyk7XG5cbi8qXG4gICAuIC5cbi0xIDAgMSAyIDMgNCA1XG4gICBuXG5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEhpc3Rvcnk7XG5cbmZ1bmN0aW9uIEhpc3RvcnkoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLm5lZWRsZSA9IDA7XG4gIHRoaXMudGltZW91dCA9IHRydWU7XG4gIHRoaXMudGltZVN0YXJ0ID0gMDtcbn1cblxuSGlzdG9yeS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDAgfHwgZm9yY2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xufSwgNzAwKTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICBpZiAodGhpcy5lZGl0b3IuYnVmZmVyLmxvZy5sZW5ndGgpIHtcbiAgICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICAgIHRoaXMubG9nLnB1c2godGhpcy5jb21taXQoKSk7XG4gICAgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGg7XG4gICAgdGhpcy5zYXZlTWV0YSgpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuc2F2ZU1ldGEoKTtcbiAgfVxuICB0aGlzLnRpbWVTdGFydCA9IERhdGUubm93KCk7XG4gIHRoaXMudGltZW91dCA9IGZhbHNlO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUudW5kbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG4gIGlmICh0aGlzLm5lZWRsZSA8IDApIHJldHVybjtcblxuICB0aGlzLmNoZWNrb3V0KCd1bmRvJywgdGhpcy5uZWVkbGUtLSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5yZWRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA9PT0gdGhpcy5sb2cubGVuZ3RoIC0gMSkgcmV0dXJuO1xuXG4gIHRoaXMuY2hlY2tvdXQoJ3JlZG8nLCArK3RoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24odHlwZSwgbikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG5cbiAgdmFyIGxvZyA9IGNvbW1pdC5sb2c7XG5cbiAgY29tbWl0ID0gdGhpcy5sb2dbbl1bdHlwZV07XG4gIHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlID0gY29tbWl0Lm1hcmtBY3RpdmU7XG4gIHRoaXMuZWRpdG9yLm1hcmsuc2V0KGNvbW1pdC5tYXJrLmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLnNldENhcmV0KGNvbW1pdC5jYXJldC5jb3B5KCkpO1xuXG4gIGxvZyA9ICd1bmRvJyA9PT0gdHlwZVxuICAgID8gbG9nLnNsaWNlKCkucmV2ZXJzZSgpXG4gICAgOiBsb2cuc2xpY2UoKTtcblxuICBsb2cuZm9yRWFjaChpdGVtID0+IHtcbiAgICB2YXIgYWN0aW9uID0gaXRlbVswXTtcbiAgICB2YXIgb2Zmc2V0UmFuZ2UgPSBpdGVtWzFdO1xuICAgIHZhciB0ZXh0ID0gaXRlbVsyXTtcbiAgICBzd2l0Y2ggKGFjdGlvbikge1xuICAgICAgY2FzZSAnaW5zZXJ0JzpcbiAgICAgICAgaWYgKCd1bmRvJyA9PT0gdHlwZSkge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSwgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLmluc2VydCh0aGlzLmVkaXRvci5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0UmFuZ2VbMF0pLCB0ZXh0LCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbW92ZSc6XG4gICAgICAgIGlmICgndW5kbycgPT09IHR5cGUpIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIuaW5zZXJ0KHRoaXMuZWRpdG9yLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXRSYW5nZVswXSksIHRleHQsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsb2cgPSB0aGlzLmVkaXRvci5idWZmZXIubG9nO1xuICB0aGlzLmVkaXRvci5idWZmZXIubG9nID0gW107XG4gIHJldHVybiB7XG4gICAgbG9nOiBsb2csXG4gICAgdW5kbzogdGhpcy5tZXRhLFxuICAgIHJlZG86IHtcbiAgICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgICBtYXJrOiB0aGlzLmVkaXRvci5tYXJrLmNvcHkoKSxcbiAgICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gICAgfVxuICB9O1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZU1ldGEgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tZXRhID0ge1xuICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgfTtcbn07XG4iLCJ2YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcblxudmFyIFBBR0lOR19USFJPVFRMRSA9IDY1O1xuXG52YXIga2V5cyA9IG1vZHVsZS5leHBvcnRzID0ge1xuICAnY3RybCt6JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnVuZG8oKTtcbiAgfSxcbiAgJ2N0cmwreSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS5yZWRvKCk7XG4gIH0sXG5cbiAgJ2hvbWUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUoKTtcbiAgfSxcbiAgJ2VuZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUoKTtcbiAgfSxcbiAgJ3BhZ2V1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ3BhZ2Vkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK3VwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCg2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93big2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSk7XG4gIH0sXG4gICd1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xKTtcbiAgfSxcbiAgJ3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEpO1xuICB9LFxuICAnZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxKTtcbiAgfSxcblxuICAnY3RybCtsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSk7XG4gIH0sXG4gICdjdHJsK3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrYSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH0sXG5cbiAgJ2VudGVyJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5pbnNlcnQoJ1xcbicpO1xuICB9LFxuXG4gICdiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK2QnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIGxpbmVzID0gYXJlYS5lbmQueSAtIGFyZWEuYmVnaW4ueTtcbiAgICBpZiAobGluZXMgJiYgYXJlYS5lbmQueCA+IDApIGFkZCArPSAxO1xuICAgIGlmICghbGluZXMpIGFkZCArPSAxO1xuICAgIGxpbmVzICs9IGFkZDtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEuc2V0TGVmdCgwKS5hZGRCb3R0b20oYWRkKSk7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHsgeDogMCwgeTogYXJlYS5lbmQueSB9LCB0ZXh0KTtcbiAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKGxpbmVzKTtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcyhsaW5lcywgdHJ1ZSk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrdXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmVtaXQoJ2lucHV0JywgJ1xcdWFhYTInLCB0aGlzLmNhcmV0LmNvcHkoKSwgdGhpcy5tYXJrLmNvcHkoKSwgdGhpcy5tYXJrLmFjdGl2ZSlcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCtkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWEzJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpXG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKCsxKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3RhYic6IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXMgPSB0aGlzLnN1Z2dlc3QoKTtcbiAgICBpZiAoIXJlcykge1xuICAgICAgdGhpcy5pbnNlcnQodGhpcy50YWIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKHJlcy5hcmVhKTtcbiAgICAgIHRoaXMuaW5zZXJ0KHJlcy5ub2RlLnZhbHVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ2N0cmwrZic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZC5vcGVuKCk7XG4gIH0sXG5cbiAgJ2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgrMSk7XG4gIH0sXG4gICdzaGlmdCtmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoLTEpO1xuICB9LFxuXG4gICdjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYWRkO1xuICAgIHZhciBhcmVhO1xuICAgIHZhciB0ZXh0O1xuXG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG5cbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIGNsZWFyID0gdHJ1ZTtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya1NldCgpO1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGhpcy5tYXJrLmFkZEJvdHRvbShhcmVhLmVuZC54ID4gMCkuc2V0TGVmdCgwKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKHRoaXMubWFyay5nZXQoKSk7XG4gICAgfVxuXG4gICAgLy9UT0RPOiBzaG91bGQgY2hlY2sgaWYgbGFzdCBsaW5lIGhhcyAvLyBhbHNvXG4gICAgaWYgKHRleHQudHJpbUxlZnQoKS5zdWJzdHIoMCwyKSA9PT0gJy8vJykge1xuICAgICAgYWRkID0gLTM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKC4qPylcXC9cXC8gKC4rKS9nbSwgJyQxJDInKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWRkID0gKzM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKFtcXHNdKikoLispL2dtLCAnJDEvLyAkMicpO1xuICAgIH1cblxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuXG4gICAgdGhpcy5tYXJrLnNldChhcmVhLmFkZFJpZ2h0KGFkZCkpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG5cbiAgICBpZiAoY2FyZXQueCkgY2FyZXQuYWRkUmlnaHQoYWRkKTtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0KTtcblxuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgY2xlYXIgPSB0cnVlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgaWYgKHRleHQuc2xpY2UoMCwyKSA9PT0gJy8qJyAmJiB0ZXh0LnNsaWNlKC0yKSA9PT0gJyovJykge1xuICAgICAgdGV4dCA9IHRleHQuc2xpY2UoMiwtMik7XG4gICAgICBhZGQgLT0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCAtPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB0ZXh0ID0gJy8qJyArIHRleHQgKyAnKi8nO1xuICAgICAgYWRkICs9IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgKz0gMjtcbiAgICB9XG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG4gICAgYXJlYS5lbmQueCArPSBhZGQ7XG4gICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQuYWRkUmlnaHQoYWRkKSk7XG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcbn07XG5cbmtleXMuc2luZ2xlID0ge1xuICAvL1xufTtcblxuLy8gc2VsZWN0aW9uIGtleXNcblsgJ2hvbWUnLCdlbmQnLFxuICAncGFnZXVwJywncGFnZWRvd24nLFxuICAnbGVmdCcsJ3VwJywncmlnaHQnLCdkb3duJyxcbiAgJ2N0cmwrbGVmdCcsJ2N0cmwrcmlnaHQnXG5dLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gIGtleXNbJ3NoaWZ0Kycra2V5XSA9IGZ1bmN0aW9uKGUpIHtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIGtleXNba2V5XS5jYWxsKHRoaXMsIGUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9O1xufSk7XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBNb3VzZSA9IHJlcXVpcmUoJy4vbW91c2UnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi90ZXh0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSW5wdXQ7XG5cbmZ1bmN0aW9uIElucHV0KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5tb3VzZSA9IG5ldyBNb3VzZSh0aGlzKTtcbiAgdGhpcy50ZXh0ID0gbmV3IFRleHQ7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbklucHV0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbklucHV0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ibHVyID0gdGhpcy5ibHVyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMudGV4dC5vbihbJ2tleScsICd0ZXh0J10sIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdpbnB1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdmb2N1cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdibHVyJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKSk7XG4gIHRoaXMudGV4dC5vbigndGV4dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICd0ZXh0JykpO1xuICB0aGlzLnRleHQub24oJ2tleXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5JykpO1xuICB0aGlzLnRleHQub24oJ2N1dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjdXQnKSk7XG4gIHRoaXMudGV4dC5vbignY29weScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjb3B5JykpO1xuICB0aGlzLnRleHQub24oJ3Bhc3RlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3Bhc3RlJykpO1xuICB0aGlzLm1vdXNlLm9uKCd1cCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZXVwJykpO1xuICB0aGlzLm1vdXNlLm9uKCdjbGljaycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWNsaWNrJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkb3duJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZG93bicpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWcnKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcgYmVnaW4nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnYmVnaW4nKSk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICB0aGlzLm1vdXNlLnVzZShub2RlKTtcbiAgdGhpcy50ZXh0LnJlc2V0KCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuYmx1cigpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5mb2N1cygpO1xufTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3VzZTtcblxuZnVuY3Rpb24gTW91c2UoKSB7XG4gIHRoaXMubm9kZSA9IG51bGw7XG4gIHRoaXMuY2xpY2tzID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuTW91c2UucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW91c2UucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9ubWF5YmVkcmFnID0gdGhpcy5vbm1heWJlZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZHJhZyA9IHRoaXMub25kcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kb3duID0gdGhpcy5vbmRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbnVwID0gdGhpcy5vbnVwLmJpbmQodGhpcyk7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICBpZiAodGhpcy5ub2RlKSB7XG4gICAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIHRoaXMub25kb3duKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIHRoaXMub25kb3duKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRvd24gPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmRvd24gPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2Rvd24nLCBlKTtcbiAgdGhpcy5vbmNsaWNrKGUpO1xuICB0aGlzLm1heWJlRHJhZygpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9udXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndXAnLCBlKTtcbiAgaWYgKCF0aGlzLmRvd24pIHJldHVybjtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5kcmFnRW5kKCk7XG4gIHRoaXMubWF5YmVEcmFnRW5kKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25jbGljayA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5yZXNldENsaWNrcygpO1xuICB0aGlzLmNsaWNrcyA9ICh0aGlzLmNsaWNrcyAlIDMpICsgMTtcbiAgdGhpcy5lbWl0KCdjbGljaycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9ubWF5YmVkcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcblxuICB2YXIgZCA9XG4gICAgICBNYXRoLmFicyh0aGlzLnBvaW50LnggLSB0aGlzLmRvd24ueClcbiAgICArIE1hdGguYWJzKHRoaXMucG9pbnQueSAtIHRoaXMuZG93bi55KTtcblxuICBpZiAoZCA+IDUpIHtcbiAgICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xuICAgIHRoaXMuZHJhZ0JlZ2luKCk7XG4gIH1cbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2RyYWcnLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBiZWdpbicpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGVuZCcpO1xufTtcblxuXG5Nb3VzZS5wcm90b3R5cGUucmVzZXRDbGlja3MgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGlja3MgPSAwO1xufSwgMzUwKTtcblxuTW91c2UucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG5cbnZhciBUSFJPVFRMRSA9IDAgLy8xMDAwLzYyO1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RleHRhcmVhJyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMCxcbiAgICB6SW5kZXg6IDEwMDAwXG4gIH0pO1xuXG4gIGRvbS5hdHRycyh0aGlzLCB7XG4gICAgYXV0b2NhcGl0YWxpemU6ICdub25lJyxcbiAgICBhdXRvY29tcGxldGU6ICdvZmYnLFxuICAgIHNwZWxsY2hlY2tpbmc6ICdvZmYnLFxuICB9KTtcblxuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cblRleHQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVGV4dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25jdXQgPSB0aGlzLm9uY3V0LmJpbmQodGhpcyk7XG4gIHRoaXMub25jb3B5ID0gdGhpcy5vbmNvcHkuYmluZCh0aGlzKTtcbiAgdGhpcy5vbnBhc3RlID0gdGhpcy5vbnBhc3RlLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXl1cCA9IHRoaXMub25rZXl1cC5iaW5kKHRoaXMpO1xuICB0aGlzLmVsLm9uYmx1ciA9IHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJyk7XG4gIHRoaXMuZWwub25mb2N1cyA9IHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpO1xuICB0aGlzLmVsLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQ7XG4gIHRoaXMuZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMuZWwub25rZXl1cCA9IHRoaXMub25rZXl1cDtcbiAgdGhpcy5lbC5vbmN1dCA9IHRoaXMub25jdXQ7XG4gIHRoaXMuZWwub25jb3B5ID0gdGhpcy5vbmNvcHk7XG4gIHRoaXMuZWwub25wYXN0ZSA9IHRoaXMub25wYXN0ZTtcbn07XG5cblRleHQucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbn1cblxuVGV4dC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVsLnZhbHVlLnN1YnN0cigtMSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih2YWx1ZSkge1xuICB0aGlzLmVsLnZhbHVlID0gdmFsdWU7XG59O1xuXG4vL1RPRE86IG9uIG1vYmlsZSB3ZSBuZWVkIHRvIGNsZWFyIHdpdGhvdXQgZGVib3VuY2Vcbi8vIG9yIHRoZSB0ZXh0YXJlYSBjb250ZW50IGlzIGRpc3BsYXllZCBpbiBoYWNrZXIncyBrZXlib2FyZFxuLy8gb3IgeW91IG5lZWQgdG8gZGlzYWJsZSB3b3JkIHN1Z2dlc3Rpb25zIGluIGhhY2tlcidzIGtleWJvYXJkIHNldHRpbmdzXG5UZXh0LnByb3RvdHlwZS5jbGVhciA9IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG59LCAyMDAwKTtcblxuVGV4dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmJsdXIoKTtcbn07XG5cblRleHQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuZm9jdXMoKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgLy8gZm9yY2VzIGNhcmV0IHRvIGVuZCBvZiB0ZXh0YXJlYSBzbyB3ZSBjYW4gZ2V0IC5zbGljZSgtMSkgY2hhclxuICBzZXRJbW1lZGlhdGUoKCkgPT4gdGhpcy5lbC5zZWxlY3Rpb25TdGFydCA9IHRoaXMuZWwudmFsdWUubGVuZ3RoKTtcbiAgdGhpcy5lbWl0KCd0ZXh0JywgdGhpcy5nZXQoKSk7XG4gIHRoaXMuY2xlYXIoKTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICAvLyBjb25zb2xlLmxvZyhlLndoaWNoKTtcbiAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gIGlmIChub3cgLSB0aGlzLnRocm90dGxlVGltZSA8IFRIUk9UVExFKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB0aGlzLnRocm90dGxlVGltZSA9IG5vdztcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleXVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCAmJiAhZS5zaGlmdEtleSkga2V5cy5wdXNoKCdzaGlmdDp1cCcpO1xuICBpZiAobS5jdHJsICYmICFlLmN0cmxLZXkpIGtleXMucHVzaCgnY3RybDp1cCcpO1xuICBpZiAobS5hbHQgJiYgIWUuYWx0S2V5KSBrZXlzLnB1c2goJ2FsdDp1cCcpO1xuXG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdICsgJzp1cCcpO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25jdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjdXQnLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uY29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2NvcHknLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ucGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdwYXN0ZScsIGUpO1xufTtcbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi9saWIvcmVnZXhwJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uL2xpYi9wb2ludCcpO1xuXG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsnd29yZHMnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3ZlO1xuXG5mdW5jdGlvbiBNb3ZlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xufVxuXG5Nb3ZlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VEb3duID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIHNpemUgLSByZW1haW5kZXIpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKHBhZ2UpO1xufTtcblxuTW92ZS5wcm90b3R5cGUucGFnZVVwID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIC0oc2l6ZSAtIHJlbWFpbmRlcikpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKC1wYWdlKTtcbn07XG5cbnZhciBtb3ZlID0ge307XG5cbm1vdmUuYnlXb3JkID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgbGluZSA9IGJ1ZmZlci5nZXRMaW5lVGV4dChwLnkpO1xuXG4gIGlmIChkeCA+IDAgJiYgcC54ID49IGxpbmUubGVuZ3RoIC0gMSkgeyAvLyBhdCBlbmQgb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCArMSk7IC8vIG1vdmUgb25lIGNoYXIgcmlnaHRcbiAgfSBlbHNlIGlmIChkeCA8IDAgJiYgcC54ID09PSAwKSB7IC8vIGF0IGJlZ2luIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgLTEpOyAvLyBtb3ZlIG9uZSBjaGFyIGxlZnRcbiAgfVxuXG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZShsaW5lLCBXT1JEUyk7XG4gIHZhciB3b3JkO1xuXG4gIGlmIChkeCA8IDApIHdvcmRzLnJldmVyc2UoKTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmIChkeCA+IDBcbiAgICAgID8gd29yZC5pbmRleCA+IHAueFxuICAgICAgOiB3b3JkLmluZGV4IDwgcC54KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiB3b3JkLmluZGV4LFxuICAgICAgICB5OiBwLnlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVhY2hlZCBiZWdpbi9lbmQgb2YgZmlsZVxuICByZXR1cm4gZHggPiAwXG4gICAgPyBtb3ZlLmVuZE9mTGluZShidWZmZXIsIHApXG4gICAgOiBtb3ZlLmJlZ2luT2ZMaW5lKGJ1ZmZlciwgcCk7XG59O1xuXG5tb3ZlLmJ5Q2hhcnMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHggPCAwKSB7IC8vIGdvaW5nIGxlZnRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIGxlZnRcbiAgICBpZiAoeCA8IDApIHsgLy8gd2hlbiBwYXN0IGxlZnQgZWRnZVxuICAgICAgaWYgKHkgPiAwKSB7IC8vIGFuZCBsaW5lcyBhYm92ZVxuICAgICAgICB5IC09IDE7IC8vIG1vdmUgdXAgYSBsaW5lXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGFuZCBnbyB0byB0aGUgZW5kIG9mIGxpbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHggPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChkeCA+IDApIHsgLy8gZ29pbmcgcmlnaHRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIHJpZ2h0XG4gICAgd2hpbGUgKHggLSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggPiAwKSB7IC8vIHdoaWxlIHBhc3QgbGluZSBsZW5ndGhcbiAgICAgIGlmICh5ID09PSBidWZmZXIubG9jKCkpIHsgLy8gb24gZW5kIG9mIGZpbGVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gZ28gdG8gZW5kIG9mIGxpbmUgb24gbGFzdCBsaW5lXG4gICAgICAgIGJyZWFrOyAvLyBhbmQgZXhpdFxuICAgICAgfVxuICAgICAgeCAtPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggKyAxOyAvLyB3cmFwIHRoaXMgbGluZSBsZW5ndGhcbiAgICAgIHkgKz0gMTsgLy8gYW5kIG1vdmUgZG93biBhIGxpbmVcbiAgICB9XG4gIH1cblxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYnlMaW5lcyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHkpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeSA8IDApIHsgLy8gZ29pbmcgdXBcbiAgICBpZiAoeSArIGR5ID4gMCkgeyAvLyB3aGVuIGxpbmVzIGFib3ZlXG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIHVwXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSAwO1xuICAgIH1cbiAgfSBlbHNlIGlmIChkeSA+IDApIHsgLy8gZ29pbmcgZG93blxuICAgIGlmICh5IDwgYnVmZmVyLmxvYygpIC0gZHkpIHsgLy8gd2hlbiBsaW5lcyBiZWxvd1xuICAgICAgeSArPSBkeTsgLy8gbW92ZSBkb3duXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSBidWZmZXIubG9jKCk7XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgKHggPiBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aCkge1xuICAvLyAgIHggPSBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gfVxuICB4ID0gTWF0aC5taW4odGhpcy5sYXN0RGVsaWJlcmF0ZVgsIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkxpbmUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5lbmRPZkxpbmUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShwLnkpLmxlbmd0aDtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSBJbmZpbml0eTtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGhcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogbGFzdFxuICB9O1xufTtcblxubW92ZS5pc0JlZ2luT2ZGaWxlID0gZnVuY3Rpb24oXywgcCkge1xuICByZXR1cm4gcC54ID09PSAwICYmIHAueSA9PT0gMDtcbn07XG5cbm1vdmUuaXNFbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHJldHVybiBwLnkgPT09IGxhc3QgJiYgcC54ID09PSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGg7XG59O1xuXG5PYmplY3Qua2V5cyhtb3ZlKS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICBNb3ZlLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24ocGFyYW0sIGJ5RWRpdCkge1xuICAgIHZhciByZXN1bHQgPSBtb3ZlW21ldGhvZF0uY2FsbChcbiAgICAgIHRoaXMsXG4gICAgICB0aGlzLmVkaXRvci5idWZmZXIsXG4gICAgICB0aGlzLmVkaXRvci5jYXJldCxcbiAgICAgIHBhcmFtXG4gICAgKTtcblxuICAgIGlmICgnaXMnID09PSBtZXRob2Quc2xpY2UoMCwyKSkgcmV0dXJuIHJlc3VsdDtcblxuICAgIHRoaXMuZW1pdCgnbW92ZScsIHJlc3VsdCwgYnlFZGl0KTtcbiAgfTtcbn0pO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJlZGl0b3JcIjpcIl9zcmNfc3R5bGVfX2VkaXRvclwiLFwibGF5ZXJcIjpcIl9zcmNfc3R5bGVfX2xheWVyXCIsXCJyb3dzXCI6XCJfc3JjX3N0eWxlX19yb3dzXCIsXCJtYXJrXCI6XCJfc3JjX3N0eWxlX19tYXJrXCIsXCJjb2RlXCI6XCJfc3JjX3N0eWxlX19jb2RlXCIsXCJjYXJldFwiOlwiX3NyY19zdHlsZV9fY2FyZXRcIixcImJsaW5rLXNtb290aFwiOlwiX3NyY19zdHlsZV9fYmxpbmstc21vb3RoXCIsXCJjYXJldC1ibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2NhcmV0LWJsaW5rLXNtb290aFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIHJlZGJsaXNzOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzFFMTYnLFxuICAgIGNvbG9yOiAnI0U5RTNEMScsXG4gICAga2V5d29yZDogJyNBMTM2MzAnLFxuICAgIGZ1bmN0aW9uOiAnI0IzREYwMicsXG4gICAgZGVjbGFyZTogJyNGNjM4MzMnLFxuICAgIG51bWJlcjogJyNGRjlGNEUnLFxuICAgIHBhcmFtczogJyNBMDkwQTAnLFxuICAgIHJlZ2V4cDogJyNCRDcwRjQnLFxuICAgIGNvbW1lbnQ6ICcjNjM1MDQ3JyxcbiAgICBzdHJpbmc6ICcjM0VBMUZCJyxcbiAgfSxcblxuICBkYXlsaWdodDoge1xuICAgIGJhY2tncm91bmQ6ICcjRUJFQkVCJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjRkYxQjFCJyxcbiAgICBmdW5jdGlvbjogJyMwMDA1RkYnLFxuICAgIGRlY2xhcmU6ICcjMEM3QTAwJyxcbiAgICBudW1iZXI6ICcjODAyMUQ0JyxcbiAgICBwYXJhbXM6ICcjNEM2OTY5JyxcbiAgICBjb21tZW50OiAnI0FCQUJBQicsXG4gICAgc3RyaW5nOiAnI0U2NzAwMCcsXG4gIH0sXG59O1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzZXRUaGVtZTtcbmV4cG9ydHMudGhlbWVzID0gdGhlbWVzO1xuXG4vKlxudDogb3BlcmF0b3Jcbms6IGtleXdvcmRcbmQ6IGRlY2xhcmVcbmI6IGJ1aWx0aW5cbm86IGJvb2xlYW5cbm46IG51bWJlclxubTogcGFyYW1zXG5mOiBmdW5jdGlvblxucjogcmVnZXhwXG5jOiBjb21tZW50XG5zOiBzdHJpbmdcbmw6IHN5bWJvbFxueDogaW5kZW50XG4gKi9cbmZ1bmN0aW9uIHNldFRoZW1lKG5hbWUpIHtcbiAgdmFyIHQgPSB0aGVtZXNbbmFtZV07XG4gIGRvbS5jc3MoJ3RoZW1lJyxcbmBcbi4ke25hbWV9IHtcbiAgYmFja2dyb3VuZDogJHt0LmJhY2tncm91bmR9O1xufVxuXG50LFxuayB7XG4gIGNvbG9yOiAke3Qua2V5d29yZH07XG59XG5cbmQsXG5uIHtcbiAgY29sb3I6ICR7dC5kZWNsYXJlfTtcbn1cblxubyxcbmUge1xuICBjb2xvcjogJHt0Lm51bWJlcn07XG59XG5cbm0ge1xuICBjb2xvcjogJHt0LnBhcmFtc307XG59XG5cbmYge1xuICBjb2xvcjogJHt0LmZ1bmN0aW9ufTtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5yIHtcbiAgY29sb3I6ICR7dC5yZWdleHAgfHwgdC5wYXJhbXN9O1xufVxuXG5jIHtcbiAgY29sb3I6ICR7dC5jb21tZW50fTtcbn1cblxucyB7XG4gIGNvbG9yOiAke3Quc3RyaW5nfTtcbn1cblxubCxcbi4ke2Nzcy5jb2RlfSB7XG4gIGNvbG9yOiAke3QuY29sb3J9O1xufVxuXG4uJHtjc3MuY2FyZXR9IHtcbiAgYmFja2dyb3VuZDogJHt0LmNvbG9yfTtcbn1cblxubSxcbmQge1xuICBmb250LXN0eWxlOiBpdGFsaWM7XG59XG5cbmwge1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbngge1xuICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gIGJhY2tncm91bmQtcmVwZWF0OiBuby1yZXBlYXQ7XG59XG5gXG4gIClcblxufVxuXG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCbG9ja1ZpZXc7XG5cbmZ1bmN0aW9uIEJsb2NrVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdibG9jayc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5ibG9jayk7XG4gIHRoaXMuaHRtbCA9ICcnO1xufVxuXG5CbG9ja1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGh0bWwgPSAnJztcblxuICB2YXIgT3BlbiA9IHtcbiAgICAneyc6ICdjdXJseScsXG4gICAgJ1snOiAnc3F1YXJlJyxcbiAgICAnKCc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIENsb3NlID0ge1xuICAgICd9JzogJ2N1cmx5JyxcbiAgICAnXSc6ICdzcXVhcmUnLFxuICAgICcpJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgb2Zmc2V0ID0gZS5idWZmZXIuZ2V0UG9pbnQoZS5jYXJldCkub2Zmc2V0O1xuXG4gIHZhciByZXN1bHQgPSBlLmJ1ZmZlci50b2tlbnMuZ2V0QnlPZmZzZXQoJ2Jsb2NrcycsIG9mZnNldCk7XG4gIGlmICghcmVzdWx0KSByZXR1cm4gaHRtbDtcblxuICB2YXIgbGVuZ3RoID0gZS5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ2Jsb2NrcycpLmxlbmd0aDtcbiAgdmFyIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQocmVzdWx0KTtcblxuICB2YXIgb3BlbjtcbiAgdmFyIGNsb3NlO1xuXG4gIHZhciBpID0gcmVzdWx0LmluZGV4O1xuICB2YXIgb3Blbk9mZnNldCA9IHJlc3VsdC5vZmZzZXQ7XG5cbiAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChvcGVuT2Zmc2V0KTtcblxuICB2YXIgY291bnQgPSByZXN1bHQub2Zmc2V0ID49IG9mZnNldCAtIDEgJiYgQ2xvc2VbY2hhcl0gPyAwIDogMTtcblxuICB2YXIgbGltaXQgPSAyMDA7XG5cbiAgd2hpbGUgKGkgPiAwKSB7XG4gICAgb3BlbiA9IE9wZW5bY2hhcl07XG4gICAgaWYgKENsb3NlW2NoYXJdKSBjb3VudCsrO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBpZiAob3BlbiAmJiAhLS1jb3VudCkgYnJlYWs7XG5cbiAgICBvcGVuT2Zmc2V0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5SW5kZXgoJ2Jsb2NrcycsIC0taSk7XG4gICAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChvcGVuT2Zmc2V0KTtcbiAgfVxuXG4gIGlmIChjb3VudCkgcmV0dXJuIGh0bWw7XG5cbiAgY291bnQgPSAxO1xuXG4gIHZhciBjbG9zZU9mZnNldDtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59XG5cbkJsb2NrVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBodG1sID0gdGhpcy5nZXQodGhpcy5lZGl0b3IpO1xuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuICAgIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICB9XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENhcmV0VmlldztcblxuZnVuY3Rpb24gQ2FyZXRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2NhcmV0JztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNhcmV0KTtcbn1cblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBvcGFjaXR5OiArdGhpcy5lZGl0b3IuaGFzRm9jdXMsXG4gICAgbGVmdDogdGhpcy5lZGl0b3IuY2FyZXRQeC54ICsgdGhpcy5lZGl0b3IubWFyZ2luTGVmdCxcbiAgICB0b3A6IHRoaXMuZWRpdG9yLmNhcmV0UHgueSAtIDEsXG4gICAgaGVpZ2h0OiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCArIDFcbiAgfSk7XG59O1xuXG5DYXJldFZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgb3BhY2l0eTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxudmFyIEFoZWFkVGhyZXNob2xkID0ge1xuICBhbmltYXRpb246IFsuMTUsIC40XSxcbiAgbm9ybWFsOiBbLjc1LCAxLjVdXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGVWaWV3O1xuXG5mdW5jdGlvbiBDb2RlVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG5cbiAgdGhpcy5uYW1lID0gJ2NvZGUnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY29kZSk7XG4gIHRoaXMucGFydHMgPSBbXTtcbn1cblxuQ29kZVZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Db2RlVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRoaXMudGFyZ2V0ID0gdGFyZ2V0O1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhcnQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydCA9IG5ldyBQYXJ0KHRoaXMsIHJhbmdlKTtcbiAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICBwYXJ0LnJlbmRlcigpO1xuICBwYXJ0LmFwcGVuZCgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xuICBpZiAoZWRpdC5zaGlmdCA+IDApIHRoaXMucmVuZGVySW5zZXJ0KGVkaXQpO1xuICBlbHNlIGlmIChlZGl0LnNoaWZ0IDwgMCkgdGhpcy5yZW5kZXJSZW1vdmUoZWRpdCk7XG4gIGVsc2UgdGhpcy5yZW5kZXJMaW5lKGVkaXQpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5QYXJ0cyA9IHRoaXMuaW5SYW5nZVBhcnRzKHBhZ2UpO1xuICB2YXIgbmVlZFJhbmdlcyA9IFJhbmdlLk5PVChwYWdlLCB0aGlzLnBhcnRzKTtcbiAgbmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHRoaXMucmVuZGVyUGFydChyYW5nZSkpO1xuICBpblBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LnJlbmRlcigpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJSZW1vdmUgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPiBlZGl0LnJhbmdlWzBdICYmIHBhcnRbMV0gPCBlZGl0LnJhbmdlWzFdKSB7XG4gICAgICB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+IGVkaXQubGluZSkge1xuICAgICAgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lICYmIHBhcnRbMF0gKyBlZGl0LnNoaWZ0IDw9IGVkaXQubGluZSkge1xuICAgICAgdmFyIG9mZnNldCA9IGVkaXQubGluZSAtIChwYXJ0WzBdICsgZWRpdC5zaGlmdCkgKyAxO1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydC5vZmZzZXQob2Zmc2V0KTtcbiAgICAgIGlmIChwYXJ0WzBdID49IHBhcnRbMV0pIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSkge1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJJbnNlcnQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMF0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnRbMV0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJQYWdlKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyTGluZSA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lICYmIHBhcnRbMV0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA8PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgaWYgKHBhcnRbMV0gPCBwYXJ0WzBdKSB0aGlzLnJlbW92ZVBhcnQocGFydClcbiAgICAgIGVsc2UgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW1vdmVQYXJ0ID0gZnVuY3Rpb24ocGFydCkge1xuICBwYXJ0LmNsZWFyKCk7XG4gIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihwYXJ0KSwgMSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuY2xlYXJPdXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLm91dFJhbmdlUGFydHModGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHJhbmdlKSlcbiAgICAuZm9yRWFjaChwYXJ0ID0+IHRoaXMucmVtb3ZlUGFydChwYXJ0KSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuaW5SYW5nZVBhcnRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gdGhpcy5wYXJ0c1tpXTtcbiAgICBpZiAoIHBhcnRbMF0gPj0gcmFuZ2VbMF0gJiYgcGFydFswXSA8PSByYW5nZVsxXVxuICAgICAgfHwgcGFydFsxXSA+PSByYW5nZVswXSAmJiBwYXJ0WzFdIDw9IHJhbmdlWzFdICkge1xuICAgICAgcGFydHMucHVzaChwYXJ0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLm91dFJhbmdlUGFydHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSB0aGlzLnBhcnRzW2ldO1xuICAgIGlmICggcGFydFsxXSA8IHJhbmdlWzBdXG4gICAgICB8fCBwYXJ0WzBdID4gcmFuZ2VbMV0gKSB7XG4gICAgICBwYXJ0cy5wdXNoKHBhcnQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0aW5nKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuXG4gIGlmIChSYW5nZS5OT1QocGFnZSwgdGhpcy5wYXJ0cykubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKFJhbmdlLkFORChwYWdlLCB0aGlzLnBhcnRzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgICB0aGlzLnJlbmRlclBhcnQocGFnZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdXVxuICAgIDogWy1BaGVhZFRocmVzaG9sZC5ub3JtYWxbMF0sICtBaGVhZFRocmVzaG9sZC5ub3JtYWxbMF1dO1xuXG4gIHZhciBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gIHZhciBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdGhpcy5wYXJ0cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG5cbiAgICB0aHJlc2hvbGQgPSB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdXVxuICAgICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFsxXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFsxXV07XG5cbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG5cbiAgICBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gICAgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHRoaXMucGFydHMpO1xuICAgIGFoZWFkTmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHtcbiAgICAgIHRoaXMucmVuZGVyUGFydChyYW5nZSk7XG4gICAgfSk7XG4gIH1cbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LmNsZWFyKCkpO1xuICB0aGlzLnBhcnRzID0gW107XG59O1xuXG5mdW5jdGlvbiBQYXJ0KHZpZXcsIHJhbmdlKSB7XG4gIHRoaXMudmlldyA9IHZpZXc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jb2RlKTtcbiAgdGhpcy5jb2RlID0gJyc7XG4gIHRoaXMub2Zmc2V0VG9wID0gMDtcbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG5cbiAgdmFyIHN0eWxlID0ge307XG5cbiAgaWYgKHRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnMuaW5kZXhPZih0aGlzLnZpZXcubmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICAgIHN0eWxlLm9wYWNpdHkgPSAwLjU7XG4gIH1cblxuICBkb20uc3R5bGUodGhpcywgc3R5bGUpO1xufVxuXG5QYXJ0LnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMub2Zmc2V0VG9wICs9IHk7XG4gIHRoaXMuY29kZSA9IHRoaXMuY29kZS5zcGxpdCgvXFxuL2cpLnNsaWNlKHkpLmpvaW4oJ1xcbicpO1xuICB0aGlzWzFdIC09IHk7XG4gIHRoaXMuc3R5bGUoKTtcbiAgdGhpcy5kb20uZWwuc2Nyb2xsVG9wID0gdGhpcy5vZmZzZXRUb3AgKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0O1xufTtcblxuUGFydC5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5hcHBlbmQodGhpcy52aWV3LnRhcmdldCwgdGhpcyk7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLnZpZXcuZWRpdG9yLmJ1ZmZlci5nZXQodGhpcyk7XG4gIGlmIChjb2RlICE9PSB0aGlzLmNvZGUpIHtcbiAgICBkb20uaHRtbCh0aGlzLCBjb2RlKTtcbiAgICB0aGlzLmNvZGUgPSBjb2RlO1xuICB9XG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblBhcnQucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAodGhpc1sxXSAtIHRoaXNbMF0gKyAxKSAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgdG9wOiB0aGlzWzBdICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodFxuICB9KTtcbn07XG5cblBhcnQucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5yZW1vdmUodGhpcyk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmluZFZpZXc7XG5cbmZ1bmN0aW9uIEZpbmRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2ZpbmQnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuZmluZCk7XG59XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuRmluZFZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIHJlc3VsdHMgPSBlLmZpbmRSZXN1bHRzO1xuXG4gIHZhciBiZWdpbiA9IDA7XG4gIHZhciBlbmQgPSByZXN1bHRzLmxlbmd0aDtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGkgPSAtMTtcblxuICBkbyB7XG4gICAgcHJldiA9IGk7XG4gICAgaSA9IGJlZ2luICsgKGVuZCAtIGJlZ2luKSAvIDIgfCAwO1xuICAgIGlmIChyZXN1bHRzW2ldLnkgPCByYW5nZVswXSAtIDEpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHByZXYgIT09IGkpO1xuXG4gIHZhciB3aWR0aCA9IGUuZmluZFZhbHVlLmxlbmd0aCAqIGUuY2hhci53aWR0aCArICdweCc7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgdmFyIHRhYnM7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKHIpO1xuICAgIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICAgICsgJ3dpZHRoOicgKyB3aWR0aCArICc7J1xuICAgICAgICAgICsgJ3RvcDonICsgKHIueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgICArICdsZWZ0OicgKyAoKHIueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICAgKyAnXCI+PC9pPic7XG4gIH1cblxuICByZXR1cm4gaHRtbDtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5maW5kLmlzT3BlbiB8fCAhdGhpcy5lZGl0b3IuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0uNSwrLjVdKTtcbiAgdmFyIGh0bWwgPSB0aGlzLmdldChwYWdlLCB0aGlzLmVkaXRvcik7XG5cbiAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmh0bWwodGhpcywgJycpO1xufTtcbiIsInZhciBSdWxlclZpZXcgPSByZXF1aXJlKCcuL3J1bGVyJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBDb2RlVmlldyA9IHJlcXVpcmUoJy4vY29kZScpO1xudmFyIENhcmV0VmlldyA9IHJlcXVpcmUoJy4vY2FyZXQnKTtcbnZhciBCbG9ja1ZpZXcgPSByZXF1aXJlKCcuL2Jsb2NrJyk7XG52YXIgRmluZFZpZXcgPSByZXF1aXJlKCcuL2ZpbmQnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdzO1xuXG5mdW5jdGlvbiBWaWV3cyhlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG5cbiAgdGhpcy52aWV3cyA9IFtcbiAgICBuZXcgUnVsZXJWaWV3KGVkaXRvciksXG4gICAgbmV3IE1hcmtWaWV3KGVkaXRvciksXG4gICAgbmV3IENvZGVWaWV3KGVkaXRvciksXG4gICAgbmV3IENhcmV0VmlldyhlZGl0b3IpLFxuICAgIG5ldyBCbG9ja1ZpZXcoZWRpdG9yKSxcbiAgICBuZXcgRmluZFZpZXcoZWRpdG9yKSxcbiAgICBuZXcgUm93c1ZpZXcoZWRpdG9yKSxcbiAgXTtcblxuICB0aGlzLnZpZXdzLmZvckVhY2godmlldyA9PiB0aGlzW3ZpZXcubmFtZV0gPSB2aWV3KTtcbiAgdGhpcy5mb3JFYWNoID0gdGhpcy52aWV3cy5mb3JFYWNoLmJpbmQodGhpcy52aWV3cyk7XG59XG5cblZpZXdzLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnVzZShlbCkpO1xufTtcblxuVmlld3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnJlbmRlcigpKTtcbn07XG5cblZpZXdzLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hcmtWaWV3O1xuXG5mdW5jdGlvbiBNYXJrVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdtYXJrJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLm1hcmspO1xufVxuXG5NYXJrVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbk1hcmtWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBtYXJrID0gZS5tYXJrLmdldCgpO1xuICBpZiAocmFuZ2VbMF0gPiBtYXJrLmVuZC55KSByZXR1cm4gZmFsc2U7XG4gIGlmIChyYW5nZVsxXSA8IG1hcmsuYmVnaW4ueSkgcmV0dXJuIGZhbHNlO1xuXG4gIHZhciBvZmZzZXRzID0gZS5idWZmZXIuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBhcmVhID0gZS5idWZmZXIuZ2V0QXJlYU9mZnNldFJhbmdlKG1hcmspO1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG5cbiAgYXJlYVswXSAtPSBvZmZzZXRzWzBdO1xuICBhcmVhWzFdIC09IG9mZnNldHNbMF07XG5cbiAgdmFyIGFib3ZlID0gY29kZS5zdWJzdHJpbmcoMCwgYXJlYVswXSk7XG4gIHZhciBtaWRkbGUgPSBjb2RlLnN1YnN0cmluZyhhcmVhWzBdLCBhcmVhWzFdKTtcbiAgdmFyIGh0bWwgPSBlLnN5bnRheC5lbnRpdGllcyhhYm92ZSlcbiAgICArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHRvcDogcGFnZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgIGhlaWdodDogJ2F1dG8nXG4gIH0pO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb3dzVmlldztcblxuZnVuY3Rpb24gUm93c1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAncm93cyc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5yb3dzKTtcbiAgdGhpcy5yb3dzID0gLTE7XG4gIHRoaXMucmFuZ2UgPSBbLTEsLTFdO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuUm93c1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Sb3dzVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMSwrMV0pO1xuXG4gIGlmICggcmFuZ2VbMF0gPj0gdGhpcy5yYW5nZVswXVxuICAgICYmIHJhbmdlWzFdIDw9IHRoaXMucmFuZ2VbMV1cbiAgICAmJiAoIHRoaXMucmFuZ2VbMV0gIT09IHRoaXMucm93c1xuICAgICAgfHwgdGhpcy5lZGl0b3Iucm93cyA9PT0gdGhpcy5yb3dzXG4gICAgKSkgcmV0dXJuO1xuXG4gIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMywrM10pO1xuICB0aGlzLnJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICB0aGlzLnJhbmdlID0gcmFuZ2U7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgZm9yICh2YXIgaSA9IHJhbmdlWzBdOyBpIDw9IHJhbmdlWzFdOyBpKyspIHtcbiAgICBodG1sICs9IChpICsgMSkgKyAnXFxuJztcbiAgfVxuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuXG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG5cbiAgICBkb20uc3R5bGUodGhpcywge1xuICAgICAgdG9wOiByYW5nZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHRcbiAgICB9KTtcbiAgfVxufTtcblxuUm93c1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJ1bGVyVmlldztcblxuZnVuY3Rpb24gUnVsZXJWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ3J1bGVyJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLnJ1bGVyKTtcbn1cblxuUnVsZXJWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAodGhpcy5lZGl0b3Iucm93cyArIHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0KVxuICAgICAgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodFxuICAgICAgKyB0aGlzLmVkaXRvci5wYWdlUmVtYWluZGVyLmhlaWdodFxuICB9KTtcbn07XG5cblJ1bGVyVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cbmZ1bmN0aW9uIFZpZXcoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xufVxuXG5WaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdyZW5kZXIgbm90IGltcGxlbWVudGVkJyk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyIG5vdCBpbXBsZW1lbnRlZCcpO1xufTtcbiJdfQ==
