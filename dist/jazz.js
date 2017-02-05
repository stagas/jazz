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
  this.repaint(true);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7O0FBSUEsSUFBSSxpQkFBaUI7QUFDbkIsU0FBTyxTQURZO0FBRW5CLGFBQVcsS0FGUTtBQUduQixlQUFhLE9BSE07QUFJbkIsZ0JBQWMsS0FKSztBQUtuQixnQkFBYyxFQUxLO0FBTW5CLGFBQVcsS0FOUTtBQU9uQixxQkFBbUIsS0FQQTtBQVFuQixtQkFBaUIsS0FSRTtBQVNuQixlQUFhLEVBVE07QUFVbkIsaUJBQWU7QUFWSSxDQUFyQjs7QUFhQSxRQUFRLHFCQUFSO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxVQUFVLFFBQVEsZ0JBQVIsQ0FBZDtBQUNBLElBQUksV0FBVyxRQUFRLGdCQUFSLENBQWY7QUFDQSxJQUFJLFdBQVcsUUFBUSxnQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWOztBQUVBLElBQUksa0JBQWtCLFFBQVEsc0JBQVIsQ0FBdEI7QUFDQSxJQUFJLFVBQVUsUUFBUSxlQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxhQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJ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QW9CLEtBQXBCLEdBQTRCLFlBQVc7QUFDckMsTUFBSSxLQUFKLENBQVUsSUFBVixFQUFnQjtBQUNkLFlBQVE7QUFETSxHQUFoQjtBQUdELENBSkQ7Ozs7O0FDMUJBLE9BQU8sT0FBUCxHQUFpQixJQUFqQjs7QUFFQSxTQUFTLElBQVQsQ0FBYyxNQUFkLEVBQXNCO0FBQ3BCLE9BQUssTUFBTCxHQUFjLE1BQWQ7QUFDRDs7QUFFRCxLQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLFlBQVc7QUFDakMsUUFBTSxJQUFJLEtBQUosQ0FBVSx3QkFBVixDQUFOO0FBQ0QsQ0FGRDs7QUFJQSxLQUFLLFNBQUwsQ0FBZSxLQUFmLEdBQXVCLFlBQVc7QUFDaEMsUUFBTSxJQUFJLEtBQUosQ0FBVSx1QkFBVixDQUFOO0FBQ0QsQ0FGRCIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEphenpcbiAqL1xuXG52YXIgRGVmYXVsdE9wdGlvbnMgPSB7XG4gIHRoZW1lOiAnd2VzdGVybicsXG4gIGZvbnRfc2l6ZTogJzlwdCcsXG4gIGxpbmVfaGVpZ2h0OiAnMS40ZW0nLFxuICBkZWJ1Z19sYXllcnM6IGZhbHNlLFxuICBzY3JvbGxfc3BlZWQ6IDk1LFxuICBoaWRlX3Jvd3M6IGZhbHNlLFxuICBjZW50ZXJfaG9yaXpvbnRhbDogZmFsc2UsXG4gIGNlbnRlcl92ZXJ0aWNhbDogZmFsc2UsXG4gIG1hcmdpbl9sZWZ0OiAxNSxcbiAgZ3V0dGVyX21hcmdpbjogMjAsXG59O1xuXG5yZXF1aXJlKCcuL2xpYi9zZXQtaW1tZWRpYXRlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi9saWIvZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vbGliL2RpZmYnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbGliL21lcmdlJyk7XG52YXIgY2xvbmUgPSByZXF1aXJlKCcuL2xpYi9jbG9uZScpO1xudmFyIGJpbmRSYWYgPSByZXF1aXJlKCcuL2xpYi9iaW5kLXJhZicpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4vbGliL3JlZ2V4cCcpO1xudmFyIERpYWxvZyA9IHJlcXVpcmUoJy4vbGliL2RpYWxvZycpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi9saWIvcG9pbnQnKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4vbGliL3JhbmdlJyk7XG52YXIgQXJlYSA9IHJlcXVpcmUoJy4vbGliL2FyZWEnKTtcbnZhciBCb3ggPSByZXF1aXJlKCcuL2xpYi9ib3gnKTtcblxudmFyIERlZmF1bHRCaW5kaW5ncyA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L2JpbmRpbmdzJyk7XG52YXIgSGlzdG9yeSA9IHJlcXVpcmUoJy4vc3JjL2hpc3RvcnknKTtcbnZhciBJbnB1dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0Jyk7XG52YXIgRmlsZSA9IHJlcXVpcmUoJy4vc3JjL2ZpbGUnKTtcbnZhciBNb3ZlID0gcmVxdWlyZSgnLi9zcmMvbW92ZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC90ZXh0Jyk7XG52YXIgVmlld3MgPSByZXF1aXJlKCcuL3NyYy92aWV3cycpO1xudmFyIHRoZW1lID0gcmVxdWlyZSgnLi9zcmMvdGhlbWUnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3NyYy9zdHlsZS5jc3MnKTtcblxudmFyIE5FV0xJTkUgPSBSZWdleHAuY3JlYXRlKFsnbmV3bGluZSddKTtcblxubW9kdWxlLmV4cG9ydHMgPSBKYXp6O1xuXG5mdW5jdGlvbiBKYXp6KG9wdGlvbnMpIHtcbiAgdGhpcy5vcHRpb25zID0gbWVyZ2UoY2xvbmUoRGVmYXVsdE9wdGlvbnMpLCBvcHRpb25zIHx8IHt9KTtcblxuICBPYmplY3QuYXNzaWduKHRoaXMsIHtcbiAgICBlbDogZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpLFxuXG4gICAgaWQ6ICdqYXp6XycgKyAoTWF0aC5yYW5kb20oKSAqIDEwZTYgfCAwKS50b1N0cmluZygzNiksXG4gICAgZmlsZTogbmV3IEZpbGUsXG4gICAgbW92ZTogbmV3IE1vdmUodGhpcyksXG4gICAgdmlld3M6IG5ldyBWaWV3cyh0aGlzKSxcbiAgICBpbnB1dDogbmV3IElucHV0KHRoaXMpLFxuICAgIGhpc3Rvcnk6IG5ldyBIaXN0b3J5KHRoaXMpLFxuXG4gICAgYmluZGluZ3M6IE9iamVjdC5hc3NpZ24oe30sIERlZmF1bHRCaW5kaW5ncyksXG5cbiAgICBmaW5kOiBuZXcgRGlhbG9nKCdGaW5kJywgVGV4dC5tYXApLFxuICAgIGZpbmRWYWx1ZTogJycsXG4gICAgZmluZE5lZWRsZTogMCxcbiAgICBmaW5kUmVzdWx0czogW10sXG5cbiAgICBzY3JvbGw6IG5ldyBQb2ludCxcbiAgICBvZmZzZXQ6IG5ldyBQb2ludCxcbiAgICBzaXplOiBuZXcgQm94LFxuICAgIGNoYXI6IG5ldyBCb3gsXG5cbiAgICBwYWdlOiBuZXcgQm94LFxuICAgIHBhZ2VQb2ludDogbmV3IFBvaW50LFxuICAgIHBhZ2VSZW1haW5kZXI6IG5ldyBCb3gsXG4gICAgcGFnZUJvdW5kczogbmV3IFJhbmdlLFxuXG4gICAgbG9uZ2VzdExpbmU6IDAsXG4gICAgZ3V0dGVyOiAwLFxuICAgIGNvZGU6IDAsXG4gICAgcm93czogMCxcblxuICAgIHRhYlNpemU6IDIsXG4gICAgdGFiOiAnICAnLFxuXG4gICAgY2FyZXQ6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG4gICAgY2FyZXRQeDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcblxuICAgIGhhc0ZvY3VzOiBmYWxzZSxcblxuICAgIG1hcms6IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICAgIH0pLFxuXG4gICAgZWRpdGluZzogZmFsc2UsXG4gICAgZWRpdExpbmU6IC0xLFxuICAgIGVkaXRSYW5nZTogWy0xLC0xXSxcbiAgICBlZGl0U2hpZnQ6IDAsXG5cbiAgICBzdWdnZXN0SW5kZXg6IDAsXG4gICAgc3VnZ2VzdFJvb3Q6ICcnLFxuICAgIHN1Z2dlc3ROb2RlczogW10sXG5cbiAgICBhbmltYXRpb25UeXBlOiAnbGluZWFyJyxcbiAgICBhbmltYXRpb25GcmFtZTogLTEsXG4gICAgYW5pbWF0aW9uUnVubmluZzogZmFsc2UsXG4gICAgYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0OiBudWxsLFxuXG4gICAgcmVuZGVyUXVldWU6IFtdLFxuICAgIHJlbmRlclJlcXVlc3Q6IG51bGwsXG4gIH0pO1xuXG4gIC8vIHVzZWZ1bCBzaG9ydGN1dHNcbiAgdGhpcy5idWZmZXIgPSB0aGlzLmZpbGUuYnVmZmVyO1xuICB0aGlzLmJ1ZmZlci5tYXJrID0gdGhpcy5tYXJrO1xuICB0aGlzLnN5bnRheCA9IHRoaXMuYnVmZmVyLnN5bnRheDtcblxuICB0aGVtZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuXG4gIHRoaXMuYmluZE1ldGhvZHMoKTtcbiAgdGhpcy5iaW5kRXZlbnRzKCk7XG59XG5cbkphenoucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSmF6ei5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZWwsIHNjcm9sbEVsKSB7XG4gIGlmICh0aGlzLnJlZikge1xuICAgIHRoaXMuZWwucmVtb3ZlQXR0cmlidXRlKCdpZCcpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZShjc3MuZWRpdG9yKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgICB0aGlzLm9mZlNjcm9sbCgpO1xuICAgIHRoaXMucmVmLmZvckVhY2gocmVmID0+IHtcbiAgICAgIGRvbS5hcHBlbmQoZWwsIHJlZik7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5yZWYgPSBbXS5zbGljZS5jYWxsKHRoaXMuZWwuY2hpbGRyZW4pO1xuICAgIGRvbS5hcHBlbmQoZWwsIHRoaXMuZWwpO1xuICAgIGRvbS5vbnJlc2l6ZSh0aGlzLm9uUmVzaXplKTtcbiAgfVxuXG4gIHRoaXMuZWwgPSBlbDtcbiAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2lkJywgdGhpcy5pZCk7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZChjc3MuZWRpdG9yKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gIHRoaXMub2ZmU2Nyb2xsID0gZG9tLm9uc2Nyb2xsKHNjcm9sbEVsIHx8IHRoaXMuZWwsIHRoaXMub25TY3JvbGwpO1xuICB0aGlzLmlucHV0LnVzZSh0aGlzLmVsKTtcbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXdzLmNhcmV0LCB0aGlzLmlucHV0LnRleHQpO1xuICB0aGlzLnZpZXdzLnVzZSh0aGlzLmVsKTtcblxuICB0aGlzLnJlcGFpbnQoKVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYXNzaWduID0gZnVuY3Rpb24oYmluZGluZ3MpIHtcbiAgdGhpcy5iaW5kaW5ncyA9IGJpbmRpbmdzO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLmZpbGUub3BlbihwYXRoLCByb290LCBmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHRoaXMuZmlsZS5zYXZlKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0LCBwYXRoKSB7XG4gIHRoaXMuZmlsZS5zZXQodGV4dCk7XG4gIHRoaXMuZmlsZS5wYXRoID0gcGF0aCB8fCB0aGlzLmZpbGUucGF0aDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5mb2N1cyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5ibHVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbi5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTsgLy9iaW5kUmFmKHRoaXMucmVwYWludCkuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJpbmRIYW5kbGVycygpXG4gIHRoaXMubW92ZS5vbignbW92ZScsIHRoaXMub25Nb3ZlKTtcbiAgdGhpcy5maWxlLm9uKCdyYXcnLCB0aGlzLm9uRmlsZVJhdyk7IC8vVE9ETzogc2hvdWxkIG5vdCBuZWVkIHRoaXMgZXZlbnRcbiAgdGhpcy5maWxlLm9uKCdzZXQnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuZmlsZS5vbignb3BlbicsIHRoaXMub25GaWxlT3Blbik7XG4gIHRoaXMuZmlsZS5vbignY2hhbmdlJywgdGhpcy5vbkZpbGVDaGFuZ2UpO1xuICB0aGlzLmZpbGUub24oJ2JlZm9yZSBjaGFuZ2UnLCB0aGlzLm9uQmVmb3JlRmlsZUNoYW5nZSk7XG4gIHRoaXMuaGlzdG9yeS5vbignY2hhbmdlJywgdGhpcy5vbkhpc3RvcnlDaGFuZ2UpO1xuICB0aGlzLmlucHV0Lm9uKCdibHVyJywgdGhpcy5vbkJsdXIpO1xuICB0aGlzLmlucHV0Lm9uKCdmb2N1cycsIHRoaXMub25Gb2N1cyk7XG4gIHRoaXMuaW5wdXQub24oJ2lucHV0JywgdGhpcy5vbklucHV0KTtcbiAgdGhpcy5pbnB1dC5vbigndGV4dCcsIHRoaXMub25UZXh0KTtcbiAgdGhpcy5pbnB1dC5vbigna2V5cycsIHRoaXMub25LZXlzKTtcbiAgdGhpcy5pbnB1dC5vbigna2V5JywgdGhpcy5vbktleSk7XG4gIHRoaXMuaW5wdXQub24oJ2N1dCcsIHRoaXMub25DdXQpO1xuICB0aGlzLmlucHV0Lm9uKCdjb3B5JywgdGhpcy5vbkNvcHkpO1xuICB0aGlzLmlucHV0Lm9uKCdwYXN0ZScsIHRoaXMub25QYXN0ZSk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNldXAnLCB0aGlzLm9uTW91c2VVcCk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWNsaWNrJywgdGhpcy5vbk1vdXNlQ2xpY2spO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWdiZWdpbicsIHRoaXMub25Nb3VzZURyYWdCZWdpbik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZycsIHRoaXMub25Nb3VzZURyYWcpO1xuICB0aGlzLmZpbmQub24oJ3N1Ym1pdCcsIHRoaXMuZmluZEp1bXAuYmluZCh0aGlzLCAxKSk7XG4gIHRoaXMuZmluZC5vbigndmFsdWUnLCB0aGlzLm9uRmluZFZhbHVlKTtcbiAgdGhpcy5maW5kLm9uKCdrZXknLCB0aGlzLm9uRmluZEtleSk7XG4gIHRoaXMuZmluZC5vbignb3BlbicsIHRoaXMub25GaW5kT3Blbik7XG4gIHRoaXMuZmluZC5vbignY2xvc2UnLCB0aGlzLm9uRmluZENsb3NlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uU2Nyb2xsID0gZnVuY3Rpb24oc2Nyb2xsKSB7XG4gIHRoaXMuc2Nyb2xsLnNldChzY3JvbGwpO1xuICB0aGlzLnJlbmRlcignY29kZScpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xuICB0aGlzLnJlbmRlcigncm93cycpO1xuICB0aGlzLnJlc3QoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlc3QgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG59LCA2MDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikge1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIHRoaXMuZW1pdCgnaW5wdXQnLCAnJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpO1xuICB0aGlzLmNhcmV0U29saWQoKTtcbiAgdGhpcy5yZXN0KCk7XG5cbiAgdGhpcy5yZW5kZXIoJ2NhcmV0Jyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25SZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZvY3VzID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdmb2N1cycpO1xuICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICB0aGlzLmNhcmV0U29saWQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNhcmV0U29saWQgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldF0pO1xuICB0aGlzLmNhcmV0QmxpbmsoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNhcmV0QmxpbmsgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldCwgY3NzWydibGluay1zbW9vdGgnXV0pO1xufSwgNDAwKTtcblxuSmF6ei5wcm90b3R5cGUub25CbHVyID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gZmFsc2U7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykge1xuICAgICAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldF0pO1xuICAgICAgdGhpcy5lbWl0KCdibHVyJyk7XG4gICAgICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICAgIH1cbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbklucHV0ID0gZnVuY3Rpb24odGV4dCkge1xufTtcblxuSmF6ei5wcm90b3R5cGUub25UZXh0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLnN1Z2dlc3RSb290ID0gJyc7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXlzID0gZnVuY3Rpb24oa2V5cywgZSkge1xuICBpZiAoa2V5cyBpbiB0aGlzLmJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXlzIGluIERlZmF1bHRCaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXkgPSBmdW5jdGlvbihrZXksIGUpIHtcbiAgaWYgKGtleSBpbiB0aGlzLmJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5IGluIERlZmF1bHRCaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uQ3V0ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdGhpcy5vbkNvcHkoZSk7XG4gIHRoaXMuZGVsZXRlKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgZS5jbGlwYm9hcmREYXRhLnNldERhdGEoJ3RleHQvcGxhaW4nLCB0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIHZhciB0ZXh0ID0gZS5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubW92ZS5iZWdpbk9mRmlsZSgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVJhdyA9IGZ1bmN0aW9uKHJhdykge1xuICAvL1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0VGFiTW9kZSA9IGZ1bmN0aW9uKGNoYXIpIHtcbiAgaWYgKCdcXHQnID09PSBjaGFyKSB7XG4gICAgdGhpcy50YWIgPSBjaGFyO1xuICB9IGVsc2Uge1xuICAgIHRoaXMudGFiID0gbmV3IEFycmF5KHRoaXMudGFiU2l6ZSArIDEpLmpvaW4oY2hhcik7XG4gIH1cbn1cblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICB0aGlzLnJlcGFpbnQodHJ1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkhpc3RvcnlDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXIoJ2NvZGUnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLmVkaXRDYXJldEJlZm9yZSA9IHRoaXMuY2FyZXQuY29weSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuXG4gIHRoaXMudmlld3MuY29kZS5yZW5kZXJFZGl0KHtcbiAgICBsaW5lOiBlZGl0UmFuZ2VbMF0sXG4gICAgcmFuZ2U6IGVkaXRSYW5nZSxcbiAgICBzaGlmdDogZWRpdFNoaWZ0LFxuICAgIGNhcmV0Tm93OiB0aGlzLmNhcmV0LFxuICAgIGNhcmV0QmVmb3JlOiB0aGlzLmVkaXRDYXJldEJlZm9yZVxuICB9KTtcblxuICB0aGlzLnJlbmRlcignY2FyZXQnKTtcbiAgdGhpcy5yZW5kZXIoJ3Jvd3MnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbiAgdGhpcy5yZW5kZXIoJ3J1bGVyJyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldEZyb21QeCA9IGZ1bmN0aW9uKHB4KSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5tYXJnaW5MZWZ0LCB5OiB0aGlzLmNoYXIuaGVpZ2h0LzIgfSlbJysnXSh0aGlzLm9mZnNldCk7XG4gIGlmICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsKSBnLnkgKz0gdGhpcy5zaXplLmhlaWdodCAvIDMgfCAwO1xuICB2YXIgcCA9IHB4WyctJ10oZylbJysnXSh0aGlzLnNjcm9sbClbJ28vJ10odGhpcy5jaGFyKTtcblxuICBwLnkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihwLnksIHRoaXMuYnVmZmVyLmxvYygpKSk7XG4gIHAueCA9IE1hdGgubWF4KDAsIHAueCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldENvb3Jkc1RhYnMocCk7XG5cbiAgcC54ID0gTWF0aC5tYXgoXG4gICAgMCxcbiAgICBNYXRoLm1pbihcbiAgICAgIHAueCAtIHRhYnMudGFicyArIHRhYnMucmVtYWluZGVyLFxuICAgICAgdGhpcy5nZXRMaW5lTGVuZ3RoKHAueSlcbiAgICApXG4gICk7XG5cbiAgdGhpcy5zZXRDYXJldChwKTtcbiAgdGhpcy5tb3ZlLmxhc3REZWxpYmVyYXRlWCA9IHAueDtcbiAgdGhpcy5vbk1vdmUoKTtcblxuICByZXR1cm4gcDtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VVcCA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHRoaXMuYmx1cigpO1xuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEb3duID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQodGhpcy5mb2N1cy5iaW5kKHRoaXMpLCAxMCk7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0KSB0aGlzLm1hcmtCZWdpbigpO1xuICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldCA9IGZ1bmN0aW9uKHAsIGNlbnRlciwgYW5pbWF0ZSkge1xuICB0aGlzLmNhcmV0LnNldChwKTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0UG9pbnRUYWJzKHRoaXMuY2FyZXQpO1xuXG4gIHRoaXMuY2FyZXRQeC5zZXQoe1xuICAgIHg6IHRoaXMuY2hhci53aWR0aCAqICh0aGlzLmNhcmV0LnggKyB0YWJzLnRhYnMgKiB0aGlzLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlciksXG4gICAgeTogdGhpcy5jaGFyLmhlaWdodCAqIHRoaXMuY2FyZXQueVxuICB9KTtcblxuICB0aGlzLmZvbGxvd0NhcmV0KGNlbnRlciwgYW5pbWF0ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLmRvd24pO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtCZWdpbiA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9IHRydWU7XG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgfSBlbHNlIGlmIChhcmVhICE9PSBmYWxzZSB8fCB0aGlzLm1hcmsuYmVnaW4ueCA9PT0gLTEpIHtcbiAgICAgIHRoaXMubWFyay5iZWdpbi5zZXQodGhpcy5jYXJldCk7XG4gICAgICB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbiAgICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdGhpcy5tYXJrQmVnaW4oYXJlYSk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQ2xlYXIgPSBmdW5jdGlvbihmb3JjZSkge1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCAmJiAhZm9yY2UpIHJldHVybjtcblxuICB0aGlzLm1hcmsuYWN0aXZlID0gZmFsc2U7XG4gIHRoaXMubWFyay5zZXQoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgfSk7XG4gIHRoaXMuY2xlYXIoJ21hcmsnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIFJhbmdlLmNsYW1wKHJhbmdlLCB0aGlzLnBhZ2VCb3VuZHMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbC5jb3B5KCk7XG4gIGlmICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsKSB7XG4gICAgcy55IC09IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIHwgMDtcbiAgfVxuICB2YXIgcCA9IHNbJ18vJ10odGhpcy5jaGFyKTtcbiAgcmV0dXJuIHRoaXMuZ2V0UmFuZ2UoW1xuICAgIE1hdGguZmxvb3IocC55ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzBdKSxcbiAgICBNYXRoLmNlaWwocC55ICsgdGhpcy5wYWdlLmhlaWdodCArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVsxXSlcbiAgXSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRMaW5lTGVuZ3RoID0gZnVuY3Rpb24oeSkge1xuICByZXR1cm4gdGhpcy5idWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2xsb3dDYXJldCA9IGZ1bmN0aW9uKGNlbnRlciwgYW5pbWF0ZSkge1xuICB2YXIgcCA9IHRoaXMuY2FyZXRQeDtcbiAgdmFyIHMgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCB8fCB0aGlzLnNjcm9sbDtcblxuICB2YXIgdG9wID0gKFxuICAgICAgcy55XG4gICAgKyAoY2VudGVyICYmICF0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAyIHwgMCkgLSAxMDAgOiAwKVxuICApIC0gcC55O1xuXG4gIHZhciBib3R0b20gPSBwLnkgLSAoXG4gICAgICBzLnlcbiAgICArIHRoaXMuc2l6ZS5oZWlnaHRcbiAgICAtIChjZW50ZXIgJiYgIXRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDIgfCAwKSAtIDEwMCA6IDApXG4gICAgLSAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMyAqIDIgfCAwKSA6IDApXG4gICkgKyB0aGlzLmNoYXIuaGVpZ2h0O1xuXG4gIHZhciBsZWZ0ID0gKHMueCArIHRoaXMuY2hhci53aWR0aCkgLSBwLng7XG4gIHZhciByaWdodCA9IChwLngpIC0gKHMueCArIHRoaXMuc2l6ZS53aWR0aCAtIHRoaXMubWFyZ2luTGVmdCkgKyB0aGlzLmNoYXIud2lkdGggKiAyO1xuXG4gIGlmIChib3R0b20gPCAwKSBib3R0b20gPSAwO1xuICBpZiAodG9wIDwgMCkgdG9wID0gMDtcbiAgaWYgKGxlZnQgPCAwKSBsZWZ0ID0gMDtcbiAgaWYgKHJpZ2h0IDwgMCkgcmlnaHQgPSAwO1xuXG4gIGlmIChsZWZ0ICsgdG9wICsgcmlnaHQgKyBib3R0b20pIHtcbiAgICB0aGlzW2FuaW1hdGUgPyAnYW5pbWF0ZVNjcm9sbEJ5JyA6ICdzY3JvbGxCeSddKHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wLCAnZWFzZScpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB2YXIgdGFyZ2V0ID0gUG9pbnQubG93KHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfSwge1xuICAgIHg6IHRoaXMuc2Nyb2xsLnggKyB4LFxuICAgIHk6IHRoaXMuc2Nyb2xsLnkgKyB5XG4gIH0pO1xuXG4gIGlmIChQb2ludC5zb3J0KHRhcmdldCwgdGhpcy5zY3JvbGwpICE9PSAwKSB7XG4gICAgdGhpcy5zY3JvbGwuc2V0KHRhcmdldCk7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHksIGFuaW1hdGlvblR5cGUpIHtcbiAgdGhpcy5hbmltYXRpb25UeXBlID0gYW5pbWF0aW9uVHlwZSB8fCAnbGluZWFyJztcblxuICBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIGlmICgnbGluZWFyJyA9PT0gdGhpcy5hbmltYXRpb25UeXBlKSB7XG4gICAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgfVxuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IHRydWU7XG4gICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbik7XG4gIH1cblxuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1heCgwLCBzLnggKyB4KSxcbiAgICB5OiBNYXRoLm1pbihcbiAgICAgICAgKHRoaXMucm93cyArIDEpICogdGhpcy5jaGFyLmhlaWdodCAtIHRoaXMuc2l6ZS5oZWlnaHRcbiAgICAgICsgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyB0aGlzLnNpemUuaGVpZ2h0IC8gMyAqIDIgfCAwIDogMCksXG4gICAgICBNYXRoLm1heCgwLCBzLnkgKyB5KVxuICAgIClcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoKGFkeCA8IDEgJiYgYWR5IDwgMSkgfHwgIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQpO1xuICAgIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2FuaW1hdGlvbiBlbmQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBzd2l0Y2ggKHRoaXMuYW5pbWF0aW9uVHlwZSkge1xuICAgIGNhc2UgJ2xpbmVhcic6XG4gICAgICBpZiAoYWR4IDwgc3BlZWQpIGR4ICo9IDAuOTtcbiAgICAgIGVsc2UgZHggPSBNYXRoLnNpZ24oZHgpICogc3BlZWQ7XG5cbiAgICAgIGlmIChhZHkgPCBzcGVlZCkgZHkgKj0gMC45O1xuICAgICAgZWxzZSBkeSA9IE1hdGguc2lnbihkeSkgKiBzcGVlZDtcblxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZWFzZSc6XG4gICAgICBkeCAqPSAwLjU7XG4gICAgICBkeSAqPSAwLjU7XG4gICAgICBicmVhaztcbiAgfVxuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMuZGVsZXRlKCk7XG5cbiAgdGhpcy5lbWl0KCdpbnB1dCcsIHRleHQsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcblxuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHRoaXMuY2FyZXQueSk7XG4gIHZhciByaWdodCA9IGxpbmVbdGhpcy5jYXJldC54XTtcbiAgdmFyIGhhc1JpZ2h0U3ltYm9sID0gflsnfScsJ10nLCcpJ10uaW5kZXhPZihyaWdodCk7XG5cbiAgLy8gYXBwbHkgaW5kZW50IG9uIGVudGVyXG4gIGlmIChORVdMSU5FLnRlc3QodGV4dCkpIHtcbiAgICB2YXIgaXNFbmRPZkxpbmUgPSB0aGlzLmNhcmV0LnggPT09IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgbGVmdCA9IGxpbmVbdGhpcy5jYXJldC54IC0gMV07XG4gICAgdmFyIGluZGVudCA9IGxpbmUubWF0Y2goL1xcUy8pO1xuICAgIGluZGVudCA9IGluZGVudCA/IGluZGVudC5pbmRleCA6IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgaGFzTGVmdFN5bWJvbCA9IH5bJ3snLCdbJywnKCddLmluZGV4T2YobGVmdCk7XG5cbiAgICBpZiAoaGFzTGVmdFN5bWJvbCkgaW5kZW50ICs9IDI7XG5cbiAgICBpZiAoaXNFbmRPZkxpbmUgfHwgaGFzTGVmdFN5bWJvbCkge1xuICAgICAgdGV4dCArPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBsZW5ndGg7XG5cbiAgaWYgKCFoYXNSaWdodFN5bWJvbCB8fCAoaGFzUmlnaHRTeW1ib2wgJiYgIX5bJ30nLCddJywnKSddLmluZGV4T2YodGV4dCkpKSB7XG4gICAgbGVuZ3RoID0gdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsIHRleHQpO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IDE7XG4gIH1cblxuICB0aGlzLm1vdmUuYnlDaGFycyhsZW5ndGgsIHRydWUpO1xuXG4gIGlmICgneycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnfScpO1xuICBlbHNlIGlmICgnKCcgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnKScpO1xuICBlbHNlIGlmICgnWycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXScpO1xuXG4gIGlmIChoYXNMZWZ0U3ltYm9sICYmIGhhc1JpZ2h0U3ltYm9sKSB7XG4gICAgaW5kZW50IC09IDI7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICdcXG4nICsgbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJhY2tzcGFjZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuIHRoaXMuZGVsZXRlKCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWEwJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpO1xuXG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUodHJ1ZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEsIHRydWUpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMScsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKTtcblxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKHRydWUpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5maW5kSnVtcCA9IGZ1bmN0aW9uKGp1bXApIHtcbiAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCB8fCAhdGhpcy5maW5kLmlzT3BlbikgcmV0dXJuO1xuXG4gIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZE5lZWRsZSArIGp1bXA7XG4gIGlmICh0aGlzLmZpbmROZWVkbGUgPj0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSAwO1xuICB9IGVsc2UgaWYgKHRoaXMuZmluZE5lZWRsZSA8IDApIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCAtIDE7XG4gIH1cblxuICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0LCB0cnVlLCB0cnVlKTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KHRydWUsIHRydWUpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kVmFsdWUgPSBmdW5jdGlvbih2YWx1ZSwgbm9KdW1wKSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5ndXR0ZXIsIHk6IDAgfSk7XG5cbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMuZmluZFZhbHVlID0gdmFsdWU7XG4gIHRoaXMuZmluZFJlc3VsdHMgPSB0aGlzLmJ1ZmZlci5pbmRleGVyLmZpbmQodmFsdWUpLm1hcCgob2Zmc2V0KSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCk7XG4gIH0pO1xuXG4gIGlmICh0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZC5pbmZvKDEgKyB0aGlzLmZpbmROZWVkbGUgKyAnLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG4gIH1cblxuICBpZiAoIW5vSnVtcCkgdGhpcy5maW5kSnVtcCgwKTtcblxuICB0aGlzLnJlbmRlcignZmluZCcpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXIoJ2ZpbmQnKTtcbiAgdGhpcy5mb2N1cygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc3VnZ2VzdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0LCB0cnVlKTtcbiAgaWYgKCFhcmVhKSByZXR1cm47XG5cbiAgdmFyIGtleSA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICBpZiAoIWtleSkgcmV0dXJuO1xuXG4gIGlmICghdGhpcy5zdWdnZXN0Um9vdFxuICAgIHx8IGtleS5zdWJzdHIoMCwgdGhpcy5zdWdnZXN0Um9vdC5sZW5ndGgpICE9PSB0aGlzLnN1Z2dlc3RSb290KSB7XG4gICAgdGhpcy5zdWdnZXN0SW5kZXggPSAwO1xuICAgIHRoaXMuc3VnZ2VzdFJvb3QgPSBrZXk7XG4gICAgdGhpcy5zdWdnZXN0Tm9kZXMgPSB0aGlzLmJ1ZmZlci5wcmVmaXguY29sbGVjdChrZXkpO1xuICB9XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGgpIHJldHVybjtcbiAgdmFyIG5vZGUgPSB0aGlzLnN1Z2dlc3ROb2Rlc1t0aGlzLnN1Z2dlc3RJbmRleF07XG5cbiAgdGhpcy5zdWdnZXN0SW5kZXggPSAodGhpcy5zdWdnZXN0SW5kZXggKyAxKSAlIHRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aDtcblxuICByZXR1cm4ge1xuICAgIGFyZWE6IGFyZWEsXG4gICAgbm9kZTogbm9kZVxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UG9pbnRUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyICsgdGFic1xuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0Q29vcmRzVGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFicyAqIHRoaXMudGFiU2l6ZSArIHJlbWFpbmRlciA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXJcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlcGFpbnQgPSBmdW5jdGlvbihjbGVhcikge1xuICB0aGlzLnJlc2l6ZSgpO1xuICBpZiAoY2xlYXIpIHRoaXMudmlld3MuY2xlYXIoKTtcbiAgdGhpcy52aWV3cy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgJCA9IHRoaXMuZWw7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgLiR7Y3NzLnJvd3N9LFxuICAgIC4ke2Nzcy5tYXJrfSxcbiAgICAuJHtjc3MuY29kZX0sXG4gICAgbWFyayxcbiAgICBwLFxuICAgIHQsXG4gICAgayxcbiAgICBkLFxuICAgIG4sXG4gICAgbyxcbiAgICBlLFxuICAgIG0sXG4gICAgZixcbiAgICByLFxuICAgIGMsXG4gICAgcyxcbiAgICBsLFxuICAgIHgge1xuICAgICAgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTtcbiAgICAgIGZvbnQtc2l6ZTogJHt0aGlzLm9wdGlvbnMuZm9udF9zaXplfTtcbiAgICAgIGxpbmUtaGVpZ2h0OiAke3RoaXMub3B0aW9ucy5saW5lX2hlaWdodH07XG4gICAgfVxuICAgIGBcbiAgKTtcblxuICB0aGlzLm9mZnNldC5zZXQoZG9tLmdldE9mZnNldCgkKSk7XG4gIHRoaXMuc2Nyb2xsLnNldChkb20uZ2V0U2Nyb2xsKCQpKTtcbiAgdGhpcy5zaXplLnNldChkb20uZ2V0U2l6ZSgkKSk7XG5cbiAgLy8gdGhpcyBpcyBhIHdlaXJkIGZpeCB3aGVuIGRvaW5nIG11bHRpcGxlIC51c2UoKVxuICBpZiAodGhpcy5jaGFyLndpZHRoID09PSAwKSB0aGlzLmNoYXIuc2V0KGRvbS5nZXRDaGFyU2l6ZSgkLCBjc3MuY29kZSkpO1xuXG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWydfKiddKHRoaXMuY2hhcikpKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG4gIC8vIHRoaXMubG9uZ2VzdExpbmUgPSBNYXRoLm1pbig1MDAsIHRoaXMuYnVmZmVyLmxpbmVzLmdldExvbmdlc3RMaW5lTGVuZ3RoKCkpO1xuXG4gIHRoaXMuZ3V0dGVyID0gTWF0aC5tYXgoXG4gICAgdGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgKHRoaXMub3B0aW9ucy5jZW50ZXJfaG9yaXpvbnRhbFxuICAgICAgPyBNYXRoLm1heChcbiAgICAgICAgICAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgICAgICAgKCB0aGlzLnBhZ2Uud2lkdGggLSA4MVxuICAgICAgICAgIC0gKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoKVxuICAgICAgICAgICkgLyAyIHwgMFxuICAgICAgICApIDogMClcbiAgICArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6IE1hdGgubWF4KDMsICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpXG4gICkgKiB0aGlzLmNoYXIud2lkdGhcbiAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93c1xuICAgICAgPyAwXG4gICAgICA6IHRoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2luICogKHRoaXMub3B0aW9ucy5jZW50ZXJfaG9yaXpvbnRhbCA/IC0xIDogMSlcbiAgICApO1xuXG4gIHRoaXMubWFyZ2luTGVmdCA9IHRoaXMuZ3V0dGVyICsgdGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0O1xuXG4gIC8vIGRvbS5zdHlsZSh0aGlzLmVsLCB7XG4gIC8vICAgd2lkdGg6IHRoaXMubG9uZ2VzdExpbmUgKiB0aGlzLmNoYXIud2lkdGgsXG4gIC8vICAgaGVpZ2h0OiB0aGlzLnJvd3MgKiB0aGlzLmNoYXIuaGVpZ2h0XG4gIC8vIH0pO1xuXG4gIC8vVE9ETzogbWFrZSBtZXRob2QvdXRpbFxuICAvLyBkcmF3IGluZGVudCBpbWFnZVxuICB2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHZhciBmb28gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9vJyk7XG4gIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICBjYW52YXMuc2V0QXR0cmlidXRlKCd3aWR0aCcsIE1hdGguY2VpbCh0aGlzLmNoYXIud2lkdGggKiAyKSk7XG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ2hlaWdodCcsIHRoaXMuY2hhci5oZWlnaHQpO1xuXG4gIHZhciBjb21tZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYycpO1xuICAkLmFwcGVuZENoaWxkKGNvbW1lbnQpO1xuICB2YXIgY29sb3IgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShjb21tZW50KS5jb2xvcjtcbiAgJC5yZW1vdmVDaGlsZChjb21tZW50KTtcbiAgY3R4LnNldExpbmVEYXNoKFsxLDFdKTtcbiAgY3R4LmxpbmVEYXNoT2Zmc2V0ID0gMDtcbiAgY3R4LmJlZ2luUGF0aCgpO1xuICBjdHgubW92ZVRvKDAsMSk7XG4gIGN0eC5saW5lVG8oMCwgdGhpcy5jaGFyLmhlaWdodCk7XG4gIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICBjdHguc3Ryb2tlKCk7XG5cbiAgdmFyIGRhdGFVUkwgPSBjYW52YXMudG9EYXRhVVJMKCk7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgIyR7dGhpcy5pZH0ge1xuICAgICAgdG9wOiAke3RoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyB0aGlzLnNpemUuaGVpZ2h0IC8gMyA6IDB9cHg7XG4gICAgfVxuXG4gICAgLiR7Y3NzLnJvd3N9LFxuICAgIC4ke2Nzcy5tYXJrfSxcbiAgICAuJHtjc3MuY29kZX0sXG4gICAgbWFyayxcbiAgICBwLFxuICAgIHQsXG4gICAgayxcbiAgICBkLFxuICAgIG4sXG4gICAgbyxcbiAgICBlLFxuICAgIG0sXG4gICAgZixcbiAgICByLFxuICAgIGMsXG4gICAgcyxcbiAgICBsLFxuICAgIHgge1xuICAgICAgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTtcbiAgICAgIGZvbnQtc2l6ZTogJHt0aGlzLm9wdGlvbnMuZm9udF9zaXplfTtcbiAgICAgIGxpbmUtaGVpZ2h0OiAke3RoaXMub3B0aW9ucy5saW5lX2hlaWdodH07XG4gICAgfVxuXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MucnVsZXJ9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmZpbmR9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLm1hcmt9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmNvZGV9IHtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJvd3N9IHtcbiAgICAgIHBhZGRpbmctcmlnaHQ6ICR7dGhpcy5vcHRpb25zLmd1dHRlcl9tYXJnaW59cHg7XG4gICAgICBwYWRkaW5nLWxlZnQ6ICR7dGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0fXB4O1xuICAgICAgd2lkdGg6ICR7dGhpcy5tYXJnaW5MZWZ0fXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5maW5kfSA+IGksXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuYmxvY2t9ID4gaSB7XG4gICAgICBoZWlnaHQ6ICR7dGhpcy5jaGFyLmhlaWdodCArIDF9cHg7XG4gICAgfVxuICAgIHgge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLnZpZXdzW25hbWVdLmNsZWFyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbihuYW1lKSB7XG4gIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmVuZGVyUmVxdWVzdCk7XG4gIGlmICghfnRoaXMucmVuZGVyUXVldWUuaW5kZXhPZihuYW1lKSkge1xuICAgIGlmIChuYW1lIGluIHRoaXMudmlld3MpIHtcbiAgICAgIHRoaXMucmVuZGVyUXVldWUucHVzaChuYW1lKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJSZXF1ZXN0ID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuX3JlbmRlci5iaW5kKHRoaXMpKTtcbn07XG5cbkphenoucHJvdG90eXBlLl9yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXJRdWV1ZS5mb3JFYWNoKG5hbWUgPT4gdGhpcy52aWV3c1tuYW1lXS5yZW5kZXIoKSk7XG4gIHRoaXMucmVuZGVyUXVldWUgPSBbXTtcbn07XG5cbi8vIHRoaXMgaXMgdXNlZCBmb3IgZGV2ZWxvcG1lbnQgZGVidWcgcHVycG9zZXNcbmZ1bmN0aW9uIGJpbmRDYWxsU2l0ZShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIHZhciBlcnIgPSBuZXcgRXJyb3I7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyLCBhcmd1bWVudHMuY2FsbGVlKTtcbiAgICB2YXIgc3RhY2sgPSBlcnIuc3RhY2s7XG4gICAgY29uc29sZS5sb2coc3RhY2spO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYywgZCk7XG4gIH07XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIGxldCBhcmVhID0gdGhpcy5nZXQoKVxuICByZXR1cm4gJycgKyBhcmVhLmJlZ2luICsgJ3wnICsgYXJlYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGJpbmFyeVNlYXJjaDtcblxuZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFycmF5LCBjb21wYXJlKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgbG93ID0gMDtcbiAgdmFyIGhpZ2ggPSBhcnJheS5sZW5ndGg7XG4gIGlmICghaGlnaCkgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiAwXG4gIH07XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpbmRleDtcbiAgICBpbmRleCA9IGxvdyArIChoaWdoIC0gbG93ID4+IDEpO1xuICAgIHZhciBpdGVtID0gYXJyYXlbaW5kZXhdO1xuICAgIHZhciByZXN1bHQgPSBjb21wYXJlKGl0ZW0pO1xuXG4gICAgaWYgKHJlc3VsdCkgbG93ID0gaW5kZXg7XG4gICAgZWxzZSBoaWdoID0gaW5kZXg7XG4gIH0gd2hpbGUgKHByZXYgIT09IGluZGV4KTtcblxuICBpZiAoaXRlbSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICBpbmRleDogaW5kZXhcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiB+bG93ICogLTEgLSAxXG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuICByZXR1cm4gZnVuY3Rpb24gcmFmV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKHJlcXVlc3QpO1xuICAgIHJlcXVlc3QgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCkpO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfLyddID1cbkJveC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXi8nXSA9XG5Cb3gucHJvdG90eXBlLmNlaWxkaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWycqJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydvKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGgucm91bmQodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLnJvdW5kKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJy0nXSA9XG5Cb3gucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC0gKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjbG9uZShvYmopIHtcbiAgdmFyIG8gPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHZhciB2YWwgPSBvYmpba2V5XTtcbiAgICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiB2YWwpIHtcbiAgICAgIG9ba2V5XSA9IGNsb25lKHZhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ba2V5XSA9IHZhbDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG87XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24gZGVib3VuY2VXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgdGltZW91dCA9IHNldFRpbWVvdXQoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSwgbXMpO1xuICAgIHJldHVybiB0aW1lb3V0O1xuICB9XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vZXZlbnQnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpYWxvZztcblxuZnVuY3Rpb24gRGlhbG9nKGxhYmVsLCBrZXltYXApIHtcbiAgdGhpcy5ub2RlID0gZG9tKGNzcy5kaWFsb2csIFtcbiAgICBgPGxhYmVsPiR7Y3NzLmxhYmVsfWAsXG4gICAgW2Nzcy5pbnB1dCwgW1xuICAgICAgYDxpbnB1dD4ke2Nzcy50ZXh0fWAsXG4gICAgICBjc3MuaW5mb1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmxhYmVsXSwgbGFiZWwpO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25jbGljayA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNlZG93biA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbn1cblxuRGlhbG9nLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbmZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbihlKSB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmhhc0ZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgZG9tLmFwcGVuZChkb2N1bWVudC5ib2R5LCB0aGlzLm5vZGUpO1xuICBkb20uZm9jdXModGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmluZm8gPSBmdW5jdGlvbihpbmZvKSB7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgaW5mbyk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJkaWFsb2dcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19kaWFsb2dcIixcImlucHV0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5wdXRcIixcInRleHRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX190ZXh0XCIsXCJsYWJlbFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2xhYmVsXCIsXCJpbmZvXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5mb1wifSIsIlxubW9kdWxlLmV4cG9ydHMgPSBkaWZmO1xuXG5mdW5jdGlvbiBkaWZmKGEsIGIpIHtcbiAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgYSkge1xuICAgIHZhciBkID0ge307XG4gICAgdmFyIGkgPSAwO1xuICAgIGZvciAodmFyIGsgaW4gYikge1xuICAgICAgaWYgKGFba10gIT09IGJba10pIHtcbiAgICAgICAgZFtrXSA9IGJba107XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGkpIHJldHVybiBkO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhICE9PSBiO1xuICB9XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vYmluZC1yYWYnKTtcbnZhciBtZW1vaXplID0gcmVxdWlyZSgnLi9tZW1vaXplJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWUuc3BsaXQoJyAnKVswXVxuICAgIH07XG4gICAgZG9tLmNsYXNzZXMobm9kZSwgbmFtZS5zcGxpdCgnICcpLnNsaWNlKDEpKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIGlmIChzdHlsZVtuYW1lXSAhPT0gJ2F1dG8nKVxuICAgICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufSwgZGlmZiwgbWVyZ2UsIGZ1bmN0aW9uKG5vZGUsIHN0eWxlKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBzdHlsZV07XG59KTtcblxuLypcbmRvbS5zdHlsZSA9IGZ1bmN0aW9uKGVsLCBzdHlsZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59O1xuKi9cbmRvbS5jbGFzc2VzID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbn0sIG51bGwsIG51bGwsIGZ1bmN0aW9uKG5vZGUsIGNsYXNzZXMpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIGNsYXNzZXMuY29uY2F0KG5vZGUubmFtZSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKV07XG59KTtcblxuZG9tLmF0dHJzID0gZnVuY3Rpb24oZWwsIGF0dHJzKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBPYmplY3QuYXNzaWduKGVsLCBhdHRycyk7XG59O1xuXG5kb20uaHRtbCA9IGZ1bmN0aW9uKGVsLCBodG1sKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZG9tLnRleHQgPSBmdW5jdGlvbihlbCwgdGV4dCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xufTtcblxuZG9tLmZvY3VzID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmZvY3VzKCk7XG59O1xuXG5kb20uZ2V0U2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlbC5jbGllbnRXaWR0aCxcbiAgICBoZWlnaHQ6IGVsLmNsaWVudEhlaWdodFxuICB9O1xufTtcblxuZG9tLmdldENoYXJTaXplID0gZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHNwYW4uY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuXG4gIGVsLmFwcGVuZENoaWxkKHNwYW4pO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAnO1xuICB2YXIgYSA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICBcXG4gJztcbiAgdmFyIGIgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIGVsLnJlbW92ZUNoaWxkKHNwYW4pO1xuXG4gIHJldHVybiB7XG4gICAgd2lkdGg6IChiLndpZHRoIC0gYS53aWR0aCksXG4gICAgaGVpZ2h0OiAoYi5oZWlnaHQgLSBhLmhlaWdodClcbiAgfTtcbn07XG5cbmRvbS5nZXRPZmZzZXQgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpO1xuICB2YXIgYm9yZGVyTGVmdCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlckxlZnRXaWR0aCk7XG4gIHZhciBib3JkZXJUb3AgPSBwYXJzZUludChzdHlsZS5ib3JkZXJUb3BXaWR0aCk7XG4gIHJldHVybiBQb2ludC5sb3coeyB4OiAwLCB5OiAwIH0sIHtcbiAgICB4OiAocmVjdC5sZWZ0ICsgYm9yZGVyTGVmdCkgfCAwLFxuICAgIHk6IChyZWN0LnRvcCArIGJvcmRlclRvcCkgfCAwXG4gIH0pO1xufTtcblxuZG9tLmdldFNjcm9sbCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4gZ2V0U2Nyb2xsKGVsKTtcbn07XG5cbmRvbS5vbnNjcm9sbCA9IGZ1bmN0aW9uIG9uc2Nyb2xsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZzY3JvbGwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20ucmVtb3ZlID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChlbC5wYXJlbnROb2RlKSBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKTtcbn07XG5cbmRvbS5nZXRFbGVtZW50ID0gZnVuY3Rpb24oZWwpIHtcbiAgcmV0dXJuIGVsLmRvbSAmJiBlbC5kb20uZWwgfHwgZWwuZWwgfHwgZWwubm9kZSB8fCBlbDtcbn07XG5cbmRvbS5zY3JvbGxCeSA9IGZ1bmN0aW9uKGVsLCB4LCB5LCBzY3JvbGwpIHtcbiAgc2Nyb2xsID0gc2Nyb2xsIHx8IGRvbS5nZXRTY3JvbGwoZWwpO1xuICBkb20uc2Nyb2xsVG8oZWwsIHNjcm9sbC54ICsgeCwgc2Nyb2xsLnkgKyB5KTtcbn07XG5cbmRvbS5zY3JvbGxUbyA9IGZ1bmN0aW9uKGVsLCB4LCB5KSB7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIHdpbmRvdy5zY3JvbGxUbyh4LCB5KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5zY3JvbGxMZWZ0ID0geCB8fCAwO1xuICAgIGVsLnNjcm9sbFRvcCA9IHkgfHwgMDtcbiAgfVxufTtcblxuZG9tLmNzcyA9IGZ1bmN0aW9uKGlkLCBjc3NUZXh0KSB7XG4gIGlmICghKGlkIGluIGRvbS5jc3Muc3R5bGVzKSkge1xuICAgIGRvbS5jc3Muc3R5bGVzW2lkXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlc1tpZF0pO1xuICB9XG4gIGRvbS5jc3Muc3R5bGVzW2lkXS50ZXh0Q29udGVudCA9IGNzc1RleHQ7XG59O1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIGlmICh0aGlzLnNpbGVudCkgcmV0dXJuXG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFBvaW50O1xuXG5mdW5jdGlvbiBQb2ludChwKSB7XG4gIGlmIChwKSB7XG4gICAgdGhpcy54ID0gcC54O1xuICAgIHRoaXMueSA9IHAueTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gIH1cbn1cblxuUG9pbnQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy54ID0gcC54O1xuICB0aGlzLnkgPSBwLnk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFBvaW50KHRoaXMpO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28vJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXi8nXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycrJ10gPVxuUG9pbnQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSArIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy0nXSA9XG5Qb2ludC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLSAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC0gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKiddID1cblBvaW50LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeKiddID1cblBvaW50LnByb3RvdHlwZS5jZWlsTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXyonXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMueCArICcsJyArIHRoaXMueTtcbn07XG5cblBvaW50LnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5Qb2ludC5ncmlkUm91bmQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5yb3VuZChhLnggLyBiLndpZHRoKSxcbiAgICB5OiBNYXRoLnJvdW5kKGEueSAvIGIuaGVpZ2h0KVxuICB9O1xufTtcblxuUG9pbnQubG93ID0gZnVuY3Rpb24obG93LCBwKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5tYXgobG93LngsIHAueCksXG4gICAgeTogTWF0aC5tYXgobG93LnksIHAueSlcbiAgfTtcbn07XG5cblBvaW50LmNsYW1wID0gZnVuY3Rpb24oYXJlYSwgcCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfSk7XG59O1xuXG5Qb2ludC5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7IHg6IGEueCArIGIueCwgeTogYS55ICsgYi55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRYID0gZnVuY3Rpb24oeCwgcCkge1xuICByZXR1cm4geyB4OiBwLnggKyB4LCB5OiBwLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFkgPSBmdW5jdGlvbih5LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCwgeTogcC55ICsgeSB9O1xufTtcblxuUG9pbnQudG9MZWZ0VG9wID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHAueCxcbiAgICB0b3A6IHAueVxuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBBTkQ7XG5cbmZ1bmN0aW9uIEFORChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBOT1Q7XG5cbmZ1bmN0aW9uIE5PVChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJ2YXIgQU5EID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLWFuZCcpO1xudmFyIE5PVCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1ub3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSYW5nZTtcblxuZnVuY3Rpb24gUmFuZ2Uocikge1xuICBpZiAocikge1xuICAgIHRoaXNbMF0gPSByWzBdO1xuICAgIHRoaXNbMV0gPSByWzFdO1xuICB9IGVsc2Uge1xuICAgIHRoaXNbMF0gPSAwO1xuICAgIHRoaXNbMV0gPSAxO1xuICB9XG59O1xuXG5SYW5nZS5BTkQgPSBBTkQ7XG5SYW5nZS5OT1QgPSBOT1Q7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZSh0aGlzKTtcbn07XG5cblJhbmdlLnJhbmdlcyA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHJldHVybiBpdGVtcy5tYXAoZnVuY3Rpb24oaXRlbSkgeyByZXR1cm4gaXRlbS5yYW5nZSB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA+PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdIDw9IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdmVybGFwID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPD0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA+PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzFdIDwgcmFuZ2VbMF0gfHwgaXRlbS5yYW5nZVswXSA+IHJhbmdlWzFdO1xuICB9KTtcbn07XG4iLCJcbnZhciBSZWdleHAgPSBleHBvcnRzO1xuXG5SZWdleHAuY3JlYXRlID0gZnVuY3Rpb24obmFtZXMsIGZsYWdzLCBmbikge1xuICBmbiA9IGZuIHx8IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMgfTtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgbmFtZXNcbiAgICAubWFwKChuKSA9PiAnc3RyaW5nJyA9PT0gdHlwZW9mIG4gPyBSZWdleHAudHlwZXNbbl0gOiBuKVxuICAgIC5tYXAoKHIpID0+IGZuKHIudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkpXG4gICAgLmpvaW4oJ3wnKSxcbiAgICBmbGFnc1xuICApO1xufTtcblxuUmVnZXhwLnR5cGVzID0ge1xuICAndG9rZW5zJzogLy4rP1xcYnwuXFxCfFxcYi4rPy8sXG4gICd3b3Jkcyc6IC9bYS16QS1aMC05XXsxLH0vLFxuICAncGFydHMnOiAvWy4vXFxcXFxcKFxcKVwiJ1xcLTosLjs8Pn4hQCMkJV4mKlxcfFxcKz1cXFtcXF17fWB+XFw/IF0rLyxcblxuICAnc2luZ2xlIGNvbW1lbnQnOiAvXFwvXFwvLio/JC8sXG4gICdkb3VibGUgY29tbWVudCc6IC9cXC9cXCpbXl0qP1xcKlxcLy8sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogLygnKD86KD86XFxcXFxcbnxcXFxcJ3xbXidcXG5dKSkqPycpLyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiAvKFwiKD86KD86XFxcXFxcbnxcXFxcXCJ8W15cIlxcbl0pKSo/XCIpLyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IC8oYCg/Oig/OlxcXFxgfFteYF0pKSo/YCkvLFxuXG4gICdvcGVyYXRvcic6IC8hfD49P3w8PT98PXsxLDN9fCg/OiYpezEsMn18XFx8P1xcfHxcXD98XFwqfFxcL3x+fFxcXnwlfFxcLig/IVxcZCl8XFwrezEsMn18XFwtezEsMn0vLFxuICAnZnVuY3Rpb24nOiAvICgoPyFcXGR8Wy4gXSo/KGlmfGVsc2V8ZG98Zm9yfGNhc2V8dHJ5fGNhdGNofHdoaWxlfHdpdGh8c3dpdGNoKSlbYS16QS1aMC05XyAkXSspKD89XFwoLipcXCkuKnspLyxcbiAgJ2tleXdvcmQnOiAvXFxiKGJyZWFrfGNhc2V8Y2F0Y2h8Y29uc3R8Y29udGludWV8ZGVidWdnZXJ8ZGVmYXVsdHxkZWxldGV8ZG98ZWxzZXxleHBvcnR8ZXh0ZW5kc3xmaW5hbGx5fGZvcnxmcm9tfGlmfGltcGxlbWVudHN8aW1wb3J0fGlufGluc3RhbmNlb2Z8aW50ZXJmYWNlfGxldHxuZXd8cGFja2FnZXxwcml2YXRlfHByb3RlY3RlZHxwdWJsaWN8cmV0dXJufHN0YXRpY3xzdXBlcnxzd2l0Y2h8dGhyb3d8dHJ5fHR5cGVvZnx3aGlsZXx3aXRofHlpZWxkKVxcYi8sXG4gICdkZWNsYXJlJzogL1xcYihmdW5jdGlvbnxpbnRlcmZhY2V8Y2xhc3N8dmFyfGxldHxjb25zdHxlbnVtfHZvaWQpXFxiLyxcbiAgJ2J1aWx0aW4nOiAvXFxiKE9iamVjdHxGdW5jdGlvbnxCb29sZWFufEVycm9yfEV2YWxFcnJvcnxJbnRlcm5hbEVycm9yfFJhbmdlRXJyb3J8UmVmZXJlbmNlRXJyb3J8U3RvcEl0ZXJhdGlvbnxTeW50YXhFcnJvcnxUeXBlRXJyb3J8VVJJRXJyb3J8TnVtYmVyfE1hdGh8RGF0ZXxTdHJpbmd8UmVnRXhwfEFycmF5fEZsb2F0MzJBcnJheXxGbG9hdDY0QXJyYXl8SW50MTZBcnJheXxJbnQzMkFycmF5fEludDhBcnJheXxVaW50MTZBcnJheXxVaW50MzJBcnJheXxVaW50OEFycmF5fFVpbnQ4Q2xhbXBlZEFycmF5fEFycmF5QnVmZmVyfERhdGFWaWV3fEpTT058SW50bHxhcmd1bWVudHN8Y29uc29sZXx3aW5kb3d8ZG9jdW1lbnR8U3ltYm9sfFNldHxNYXB8V2Vha1NldHxXZWFrTWFwfFByb3h5fFJlZmxlY3R8UHJvbWlzZSlcXGIvLFxuICAnc3BlY2lhbCc6IC9cXGIodHJ1ZXxmYWxzZXxudWxsfHVuZGVmaW5lZClcXGIvLFxuICAncGFyYW1zJzogL2Z1bmN0aW9uWyBcXChdezF9W15dKj9cXHsvLFxuICAnbnVtYmVyJzogLy0/XFxiKDB4W1xcZEEtRmEtZl0rfFxcZCpcXC4/XFxkKyhbRWVdWystXT9cXGQrKT98TmFOfC0/SW5maW5pdHkpXFxiLyxcbiAgJ3N5bWJvbCc6IC9be31bXFxdKCksOl0vLFxuICAncmVnZXhwJzogLyg/IVteXFwvXSkoXFwvKD8hW1xcL3xcXCpdKS4qP1teXFxcXFxcXl1cXC8pKFs7XFxuXFwuXFwpXFxdXFx9IGdpbV0pLyxcblxuICAneG1sJzogLzxbXj5dKj4vLFxuICAndXJsJzogLygoXFx3KzpcXC9cXC8pWy1hLXpBLVowLTk6QDs/Jj1cXC8lXFwrXFwuXFwqISdcXChcXCksXFwkX1xce1xcfVxcXn5cXFtcXF1gI3xdKykvLFxuICAnaW5kZW50JzogL14gK3xeXFx0Ky8sXG4gICdsaW5lJzogL14uKyR8Xlxcbi8sXG4gICduZXdsaW5lJzogL1xcclxcbnxcXHJ8XFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJ2YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcblxudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLnNldFRleHQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS51cGRhdGVSYXcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yYXcgPSB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnVwZGF0ZVJhdygpO1xuICB2YXIgYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgYnVmZmVyLnJlcGxhY2UodGhpcyk7XG4gIHJldHVybiBidWZmZXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihkYXRhKSB7XG4gIHRoaXMucmF3ID0gZGF0YS5yYXc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuICB0aGlzLnRva2VucyA9IGRhdGEudG9rZW5zLmNvcHkoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnNldFRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdGhpcy5yYXcgPSB0ZXh0IC8vdGhpcy5zeW50YXguaGlnaGxpZ2h0KHRleHQpO1xuXG4gIHRoaXMuc3ludGF4LnRhYiA9IH50aGlzLnJhdy5pbmRleE9mKCdcXHQnKSA/ICdcXHQnIDogJyAnO1xuXG4gIHRoaXMudGV4dCA9IG5ldyBTa2lwU3RyaW5nO1xuICB0aGlzLnRleHQuc2V0KHRoaXMucmF3KTtcblxuICB0aGlzLnRva2VucyA9IG5ldyBUb2tlbnM7XG4gIHRoaXMudG9rZW5zLmluZGV4KHRoaXMucmF3KTtcbiAgdGhpcy50b2tlbnMub24oJ2NoYW5nZSBzZWdtZW50cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2Ugc2VnbWVudHMnKSk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9XG5CdWZmZXIucHJvdG90eXBlLmluc2VydFRleHRBdFBvaW50ID0gZnVuY3Rpb24ocCwgdGV4dCwgbm9Mb2cpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB2YXIgbGVuZ3RoID0gdGV4dC5sZW5ndGg7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciBzaGlmdCA9ICh0ZXh0Lm1hdGNoKE5FV0xJTkUpIHx8IFtdKS5sZW5ndGg7XG4gIHZhciByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgc2hpZnRdO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuXG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudGV4dC5pbnNlcnQocG9pbnQub2Zmc2V0LCB0ZXh0KTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gdGV4dC5sZW5ndGg7XG4gIHZhciBhZnRlciA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICB0aGlzLnRva2Vucy51cGRhdGUob2Zmc2V0UmFuZ2UsIGFmdGVyLCBsZW5ndGgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUob2Zmc2V0UmFuZ2VbMF0pO1xuXG4gIGlmICghbm9Mb2cpIHtcbiAgICB2YXIgbGFzdExvZyA9IHRoaXMubG9nW3RoaXMubG9nLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0TG9nICYmIGxhc3RMb2dbMF0gPT09ICdpbnNlcnQnICYmIGxhc3RMb2dbMV1bMV0gPT09IHBvaW50Lm9mZnNldCkge1xuICAgICAgbGFzdExvZ1sxXVsxXSArPSB0ZXh0Lmxlbmd0aDtcbiAgICAgIGxhc3RMb2dbMl0gKz0gdGV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cucHVzaChbJ2luc2VydCcsIFtwb2ludC5vZmZzZXQsIHBvaW50Lm9mZnNldCArIHRleHQubGVuZ3RoXSwgdGV4dF0pO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcblxuICByZXR1cm4gdGV4dC5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZSA9XG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZU9mZnNldFJhbmdlID0gZnVuY3Rpb24obywgbm9Mb2cpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgLy8gY29uc29sZS5sb2coJ29mZnNldHMnLCBvKVxuICB2YXIgYSA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1swXSk7XG4gIHZhciBiID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzFdKTtcbiAgdmFyIGxlbmd0aCA9IG9bMF0gLSBvWzFdO1xuICB2YXIgcmFuZ2UgPSBbYS55LCBiLnldO1xuICB2YXIgc2hpZnQgPSBhLnkgLSBiLnk7XG4gIC8vIGNvbnNvbGUubG9nKGEsYilcblxuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvKTtcbiAgdGhpcy50ZXh0LnJlbW92ZShvKTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gbGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vTG9nKSB7XG4gICAgdmFyIGxhc3RMb2cgPSB0aGlzLmxvZ1t0aGlzLmxvZy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExvZyAmJiBsYXN0TG9nWzBdID09PSAncmVtb3ZlJyAmJiBsYXN0TG9nWzFdWzBdID09PSBvWzFdKSB7XG4gICAgICBsYXN0TG9nWzFdWzBdIC09IHRleHQubGVuZ3RoO1xuICAgICAgbGFzdExvZ1syXSA9IHRleHQgKyBsYXN0TG9nWzJdO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZy5wdXNoKFsncmVtb3ZlJywgbywgdGV4dF0pO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlQXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0cyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUNoYXJBdFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQrMV07XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldFJhbmdlKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLmdldExpbmVSYW5nZVRleHQocmFuZ2UpO1xuXG4gIC8vIGNhbGN1bGF0ZSBpbmRlbnQgZm9yIGBjb2RlYFxuICAvL1RPRE86IG1vdmUgdG8gbWV0aG9kXG4gIHZhciBsYXN0ID0gY29kZS5zbGljZShjb2RlLmxhc3RJbmRleE9mKCdcXG4nKSk7XG4gIHZhciBBbnlDaGFyID0gL1xcUy9nO1xuICB2YXIgeSA9IHJhbmdlWzFdO1xuICB2YXIgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMobGFzdCk7XG4gIHdoaWxlICghbWF0Y2ggJiYgeSA8IHRoaXMubG9jKCkpIHtcbiAgICB2YXIgYWZ0ZXIgPSB0aGlzLmdldExpbmVUZXh0KCsreSk7XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGFmdGVyKTtcbiAgfVxuICB2YXIgaW5kZW50ID0gMDtcbiAgaWYgKG1hdGNoKSBpbmRlbnQgPSBtYXRjaC5pbmRleDtcbiAgdmFyIGluZGVudFRleHQgPSAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKHRoaXMuc3ludGF4LnRhYik7XG5cbiAgdmFyIHNlZ21lbnQgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIGlmIChzZWdtZW50KSB7XG4gICAgY29kZSA9IFNFR01FTlRbc2VnbWVudF0gKyAnXFx1ZmZiYVxcbicgKyBjb2RlICsgaW5kZW50VGV4dCArICdcXHVmZmJlKi9gJ1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSk7XG4gICAgY29kZSA9ICc8JyArIHNlZ21lbnRbMF0gKyAnPicgK1xuICAgICAgY29kZS5zdWJzdHJpbmcoXG4gICAgICAgIGNvZGUuaW5kZXhPZignXFx1ZmZiYScpICsgMixcbiAgICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSArIGluZGVudFRleHQgKyAnXFx1ZmZiZSovYCcpO1xuICAgIGNvZGUgPSBjb2RlLnN1YnN0cmluZygwLCBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJykpO1xuICB9XG4gIHJldHVybiBjb2RlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lID0gZnVuY3Rpb24oeSkge1xuICB2YXIgbGluZSA9IG5ldyBMaW5lO1xuICBsaW5lLm9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKFt5LHldKTtcbiAgbGluZS5vZmZzZXQgPSBsaW5lLm9mZnNldFJhbmdlWzBdO1xuICBsaW5lLmxlbmd0aCA9IGxpbmUub2Zmc2V0UmFuZ2VbMV0gLSBsaW5lLm9mZnNldFJhbmdlWzBdIC0gKHkgPCB0aGlzLmxvYygpKTtcbiAgbGluZS5wb2ludC5zZXQoeyB4OjAsIHk6eSB9KTtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShwLnkpO1xuICB2YXIgcG9pbnQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGxpbmUubGVuZ3RoLCBwLngpLFxuICAgIHk6IGxpbmUucG9pbnQueVxuICB9KTtcbiAgcG9pbnQub2Zmc2V0ID0gbGluZS5vZmZzZXQgKyBwb2ludC54O1xuICBwb2ludC5wb2ludCA9IHBvaW50O1xuICBwb2ludC5saW5lID0gbGluZTtcbiAgcmV0dXJuIHBvaW50O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VUZXh0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVSYW5nZU9mZnNldHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVswXSk7XG4gIHZhciBiID0gcmFuZ2VbMV0gPj0gdGhpcy5sb2MoKVxuICAgID8gdGhpcy50ZXh0Lmxlbmd0aFxuICAgIDogdGhpcy5nZXRMaW5lT2Zmc2V0KHJhbmdlWzFdICsgMSk7XG4gIHZhciBvZmZzZXRzID0gW2EsIGJdO1xuICByZXR1cm4gb2Zmc2V0cztcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UmFuZ2VUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0UmFuZ2UpIHtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0UmFuZ2UpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHRva2VuID0gdGhpcy50b2tlbnMuZ2V0QnlPZmZzZXQoJ2xpbmVzJywgb2Zmc2V0IC0gLjUpO1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBvZmZzZXQgLSAob2Zmc2V0ID4gdG9rZW4ub2Zmc2V0ID8gdG9rZW4ub2Zmc2V0ICsgKCEhdG9rZW4ucGFydC5sZW5ndGgpIDogMCksXG4gICAgeTogTWF0aC5taW4odGhpcy5sb2MoKSwgdG9rZW4uaW5kZXggLSAodG9rZW4ub2Zmc2V0ICsgMSA+IG9mZnNldCkgKyAxKVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBjaGFyID0gdGhpcy50ZXh0LmdldFJhbmdlKFtvZmZzZXQsIG9mZnNldCArIDFdKTtcbiAgcmV0dXJuIGNoYXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmVUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB7XG4gICAgbGluZTogbGluZSxcbiAgICB0ZXh0OiB0ZXh0LFxuICB9XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVUZXh0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgdGV4dCA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChbeSx5XSk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhVGV4dCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53b3JkQXJlYUF0UG9pbnQgPSBmdW5jdGlvbihwLCBpbmNsdXNpdmUpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2UocG9pbnQubGluZS5vZmZzZXRSYW5nZSk7XG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZSh0ZXh0LCBXT1JEUyk7XG5cbiAgaWYgKHdvcmRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXJlYTtcbiAgfVxuXG4gIHZhciBsYXN0SW5kZXggPSAwO1xuICB2YXIgd29yZCA9IFtdO1xuICB2YXIgZW5kID0gdGV4dC5sZW5ndGg7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAod29yZC5pbmRleCA+IHBvaW50LnggLSAhIWluY2x1c2l2ZSkge1xuICAgICAgZW5kID0gd29yZC5pbmRleDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBsYXN0SW5kZXggPSB3b3JkLmluZGV4O1xuICB9XG5cbiAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHsgeDogbGFzdEluZGV4LCB5OiBwb2ludC55IH0sXG4gICAgZW5kOiB7IHg6IGVuZCwgeTogcG9pbnQueSB9XG4gIH0pO1xuXG4gIHJldHVybiBhcmVhO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmJlZ2luLnkgKyB5IDwgMCB8fCBhcmVhLmVuZC55ICsgeSA+IHRoaXMubG9jKCkpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwXG4gIGFyZWEuZW5kLnggPSB0aGlzLmdldExpbmUoYXJlYS5lbmQueSkubGVuZ3RoXG5cbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcblxuICB2YXIgeCA9IDBcblxuICBpZiAoeSA+IDAgJiYgYXJlYS5iZWdpbi55ID4gMCB8fCBhcmVhLmVuZC55ID09PSB0aGlzLmxvYygpKSB7XG4gICAgYXJlYS5iZWdpbi55IC09IDFcbiAgICBhcmVhLmJlZ2luLnggPSB0aGlzLmdldExpbmUoYXJlYS5iZWdpbi55KS5sZW5ndGhcbiAgICBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSlcbiAgICB4ID0gSW5maW5pdHlcbiAgfSBlbHNlIHtcbiAgICBvZmZzZXRzWzFdICs9IDFcbiAgfVxuXG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpXG5cbiAgdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRzKVxuXG4gIHRoaXMuaW5zZXJ0KHsgeDogeCwgeTphcmVhLmJlZ2luLnkgKyB5IH0sIHRleHQpO1xuXG4gIHJldHVybiB0cnVlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciByYW5nZSA9IFtcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pLm9mZnNldCxcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuZW5kKS5vZmZzZXRcbiAgXTtcbiAgcmV0dXJuIHJhbmdlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lT2Zmc2V0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgb2Zmc2V0ID0geSA8IDAgPyAtMSA6IHkgPT09IDAgPyAwIDogdGhpcy50b2tlbnMuZ2V0QnlJbmRleCgnbGluZXMnLCB5IC0gMSkgKyAxO1xuICByZXR1cm4gb2Zmc2V0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5sb2MgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zLmdldENvbGxlY3Rpb24oJ2xpbmVzJykubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50ZXh0LnRvU3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiBMaW5lKCkge1xuICB0aGlzLm9mZnNldFJhbmdlID0gW107XG4gIHRoaXMub2Zmc2V0ID0gMDtcbiAgdGhpcy5sZW5ndGggPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFT0wocykge1xuICByZXR1cm4gcy5yZXBsYWNlKEVPTCwgJ1xcbicpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEluZGV4ZXI7XG5cbmZ1bmN0aW9uIEluZGV4ZXIoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xufVxuXG5JbmRleGVyLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ocykge1xuICBpZiAoIXMpIHJldHVybiBbXTtcbiAgdmFyIG9mZnNldHMgPSBbXTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5yYXc7XG4gIHZhciBsZW4gPSBzLmxlbmd0aDtcbiAgdmFyIGluZGV4O1xuICB3aGlsZSAofihpbmRleCA9IHRleHQuaW5kZXhPZihzLCBpbmRleCArIGxlbikpKSB7XG4gICAgb2Zmc2V0cy5wdXNoKGluZGV4KTtcbiAgfVxuICByZXR1cm4gb2Zmc2V0cztcbn07XG4iLCJ2YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQYXJ0cztcblxuZnVuY3Rpb24gUGFydHMobWluU2l6ZSkge1xuICBtaW5TaXplID0gbWluU2l6ZSB8fCA1MDAwO1xuICB0aGlzLm1pblNpemUgPSBtaW5TaXplO1xuICB0aGlzLnBhcnRzID0gW107XG4gIHRoaXMubGVuZ3RoID0gMDtcbn1cblxuUGFydHMucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihpdGVtKSB7XG4gIHRoaXMuYXBwZW5kKFtpdGVtXSk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHBhcnQgPSBsYXN0KHRoaXMucGFydHMpO1xuXG4gIGlmICghcGFydCkge1xuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSAwO1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSAwO1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuICBlbHNlIGlmIChwYXJ0Lmxlbmd0aCA+PSB0aGlzLm1pblNpemUpIHtcbiAgICB2YXIgc3RhcnRJbmRleCA9IHBhcnQuc3RhcnRJbmRleCArIHBhcnQubGVuZ3RoO1xuICAgIHZhciBzdGFydE9mZnNldCA9IGl0ZW1zWzBdO1xuXG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IHN0YXJ0SW5kZXg7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IHN0YXJ0T2Zmc2V0O1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuXG4gIHBhcnQucHVzaC5hcHBseShwYXJ0LCBpdGVtcy5tYXAob2Zmc2V0ID0+IG9mZnNldCAtIHBhcnQuc3RhcnRPZmZzZXQpKTtcblxuICB0aGlzLmxlbmd0aCArPSBpdGVtcy5sZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgdmFyIHBhcnQgPSB0aGlzLmZpbmRQYXJ0QnlJbmRleChpbmRleCkuaXRlbTtcbiAgcmV0dXJuIHBhcnRbTWF0aC5taW4ocGFydC5sZW5ndGggLSAxLCBpbmRleCAtIHBhcnQuc3RhcnRJbmRleCldICsgcGFydC5zdGFydE9mZnNldDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBwID0gdGhpcy5maW5kUGFydEJ5T2Zmc2V0KG9mZnNldCk7XG4gIGlmICghcC5pdGVtKSByZXR1cm4gbnVsbDtcblxuICB2YXIgcGFydCA9IHAuaXRlbTtcbiAgdmFyIHBhcnRJbmRleCA9IHAuaW5kZXg7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydCk7XG4gIHJldHVybiB7XG4gICAgb2Zmc2V0OiBvLml0ZW0gKyBwYXJ0LnN0YXJ0T2Zmc2V0LFxuICAgIGluZGV4OiBvLmluZGV4ICsgcGFydC5zdGFydEluZGV4LFxuICAgIGxvY2FsOiBvLmluZGV4LFxuICAgIHBhcnQ6IHBhcnQsXG4gICAgcGFydEluZGV4OiBwYXJ0SW5kZXhcbiAgfTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIGFycmF5KSB7XG4gIHZhciBvID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghbykge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZChhcnJheSk7XG4gIH1cbiAgaWYgKG8ub2Zmc2V0ID4gb2Zmc2V0KSBvLmxvY2FsID0gLTE7XG4gIHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG4gIC8vVE9ETzogbWF5YmUgc3VidHJhY3QgJ29mZnNldCcgaW5zdGVhZCA/XG4gIGFycmF5ID0gYXJyYXkubWFwKGVsID0+IGVsIC09IG8ucGFydC5zdGFydE9mZnNldCk7XG4gIGluc2VydChvLnBhcnQsIG8ubG9jYWwgKyAxLCBhcnJheSk7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIC1sZW5ndGgpO1xuICB0aGlzLmxlbmd0aCArPSBsZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHNoaWZ0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHM7XG4gIHZhciBpdGVtID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghaXRlbSkgcmV0dXJuO1xuICBpZiAob2Zmc2V0ID4gaXRlbS5vZmZzZXQpIGl0ZW0ubG9jYWwgKz0gMTtcblxuICB2YXIgcmVtb3ZlZCA9IDA7XG4gIGZvciAodmFyIGkgPSBpdGVtLmxvY2FsOyBpIDwgaXRlbS5wYXJ0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaXRlbS5wYXJ0W2ldICs9IHNoaWZ0O1xuICAgIGlmIChpdGVtLnBhcnRbaV0gKyBpdGVtLnBhcnQuc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIHJlbW92ZWQrKztcbiAgICAgIGl0ZW0ucGFydC5zcGxpY2UoaS0tLCAxKTtcbiAgICB9XG4gIH1cbiAgaWYgKHJlbW92ZWQpIHtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoaXRlbS5wYXJ0SW5kZXggKyAxLCByZW1vdmVkKTtcbiAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICB9XG4gIGZvciAodmFyIGkgPSBpdGVtLnBhcnRJbmRleCArIDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0ICs9IHNoaWZ0O1xuICAgIGlmIChwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgaWYgKGxhc3QocGFydHNbaV0pICsgcGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgICAgcmVtb3ZlZCA9IHBhcnRzW2ldLmxlbmd0aDtcbiAgICAgICAgdGhpcy5zaGlmdEluZGV4KGkgKyAxLCByZW1vdmVkKTtcbiAgICAgICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgICAgICAgcGFydHMuc3BsaWNlKGktLSwgMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlbW92ZUJlbG93T2Zmc2V0KG9mZnNldCwgcGFydHNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmZpbmQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHRoaXMuZmluZChyYW5nZVsxXSk7XG4gIGlmICghYSAmJiAhYikgcmV0dXJuO1xuXG4gIGlmIChhLnBhcnRJbmRleCA9PT0gYi5wYXJ0SW5kZXgpIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0ID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoYS5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gICAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdEEgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsKS5sZW5ndGg7XG4gICAgdmFyIHNoaWZ0QiA9IHJlbW92ZShiLnBhcnQsIDAsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgaWYgKGIucGFydEluZGV4IC0gYS5wYXJ0SW5kZXggPiAxKSB7XG4gICAgICB2YXIgcmVtb3ZlZCA9IHJlbW92ZSh0aGlzLnBhcnRzLCBhLnBhcnRJbmRleCArIDEsIGIucGFydEluZGV4KTtcbiAgICAgIHZhciBzaGlmdEJldHdlZW4gPSByZW1vdmVkLnJlZHVjZSgocCxuKSA9PiBwICsgbi5sZW5ndGgsIDApO1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBICsgc2hpZnRCZXR3ZWVuO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4IC0gcmVtb3ZlZC5sZW5ndGggKyAxLCBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW4pO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuO1xuICAgIH0gZWxzZSB7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEE7XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggKyAxLCBzaGlmdEEgKyBzaGlmdEIpO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCO1xuICAgIH1cbiAgfVxuXG4gIC8vVE9ETzogdGhpcyBpcyBpbmVmZmljaWVudCBhcyB3ZSBjYW4gY2FsY3VsYXRlIHRoZSBpbmRleGVzIG91cnNlbHZlc1xuICBpZiAoIWEucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYS5wYXJ0KSwgMSk7XG4gIH1cbiAgaWYgKCFiLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGIucGFydCksIDEpO1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRJbmRleCA9IGZ1bmN0aW9uKHN0YXJ0SW5kZXgsIHNoaWZ0KSB7XG4gIGZvciAodmFyIGkgPSBzdGFydEluZGV4OyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMucGFydHNbaV0uc3RhcnRJbmRleCAtPSBzaGlmdDtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZUJlbG93T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydClcbiAgdmFyIHNoaWZ0ID0gcmVtb3ZlKHBhcnQsIDAsIG8uaW5kZXgpLmxlbmd0aDtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kT2Zmc2V0SW5QYXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIG9mZnNldCAtPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHBhcnQsIG8gPT4gbyA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlJbmRleCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0SW5kZXggPD0gaW5kZXgpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRPZmZzZXQgPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnBhcnRzLnJlZHVjZSgocCxuKSA9PiBwLmNvbmNhdChuKSwgW10pO1xufTtcblxuUGFydHMucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwYXJ0cyA9IG5ldyBQYXJ0cyh0aGlzLm1pblNpemUpO1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiB7XG4gICAgdmFyIHAgPSBwYXJ0LnNsaWNlKCk7XG4gICAgcC5zdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4O1xuICAgIHAuc3RhcnRPZmZzZXQgPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICAgIHBhcnRzLnBhcnRzLnB1c2gocCk7XG4gIH0pO1xuICBwYXJ0cy5sZW5ndGggPSB0aGlzLmxlbmd0aDtcbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuZnVuY3Rpb24gbGFzdChhcnJheSkge1xuICByZXR1cm4gYXJyYXlbYXJyYXkubGVuZ3RoIC0gMV07XG59XG5cbmZ1bmN0aW9uIHJlbW92ZShhcnJheSwgYSwgYikge1xuICBpZiAoYiA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEsIGIgLSBhKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBpbmRleCwgYXJyYXkpIHtcbiAgdmFyIG9wID0gYXJyYXkuc2xpY2UoKTtcbiAgb3AudW5zaGlmdChpbmRleCwgMCk7XG4gIHRhcmdldC5zcGxpY2UuYXBwbHkodGFyZ2V0LCBvcCk7XG59XG4iLCIvLyB2YXIgV09SRCA9IC9cXHcrL2c7XG52YXIgV09SRCA9IC9bYS16QS1aMC05XXsxLH0vZ1xudmFyIHJhbmsgPSAwO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFByZWZpeFRyZWVOb2RlO1xuXG5mdW5jdGlvbiBQcmVmaXhUcmVlTm9kZSgpIHtcbiAgdGhpcy52YWx1ZSA9ICcnO1xuICB0aGlzLnJhbmsgPSAwO1xuICB0aGlzLmNoaWxkcmVuID0ge307XG59XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5nZXRDaGlsZHJlbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2hpbGRyZW4gPSBPYmplY3RcbiAgICAua2V5cyh0aGlzLmNoaWxkcmVuKVxuICAgIC5tYXAoKGtleSkgPT4gdGhpcy5jaGlsZHJlbltrZXldKTtcblxuICByZXR1cm4gY2hpbGRyZW4ucmVkdWNlKChwLCBuKSA9PiBwLmNvbmNhdChuLmdldENoaWxkcmVuKCkpLCBjaGlsZHJlbik7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuY29sbGVjdCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgY29sbGVjdGlvbiA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuZmluZChrZXkpO1xuICBpZiAobm9kZSkge1xuICAgIGNvbGxlY3Rpb24gPSBub2RlXG4gICAgICAuZ2V0Q2hpbGRyZW4oKVxuICAgICAgLmZpbHRlcigobm9kZSkgPT4gbm9kZS52YWx1ZSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIHZhciByZXMgPSBiLnJhbmsgLSBhLnJhbms7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGIudmFsdWUubGVuZ3RoIC0gYS52YWx1ZS5sZW5ndGg7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGEudmFsdWUgPiBiLnZhbHVlO1xuICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgfSk7XG5cbiAgICBpZiAobm9kZS52YWx1ZSkgY29sbGVjdGlvbi5wdXNoKG5vZGUpO1xuICB9XG4gIHJldHVybiBjb2xsZWN0aW9uO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICBmb3IgKHZhciBjaGFyIGluIGtleSkge1xuICAgIGlmIChrZXlbY2hhcl0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5ba2V5W2NoYXJdXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbm9kZTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIHZhciBpID0gMDtcbiAgdmFyIG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBpZiAoc1tpXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltzW2ldXTtcbiAgICAgIGkrKztcbiAgICB9IGVsc2Uge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgbm9kZSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSB8fCBuZXcgUHJlZml4VHJlZU5vZGU7XG4gICAgaSsrO1xuICB9XG5cbiAgbm9kZS52YWx1ZSA9IHM7XG4gIG5vZGUucmFuaysrO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24ocykge1xuICB2YXIgd29yZDtcbiAgd2hpbGUgKHdvcmQgPSBXT1JELmV4ZWMocykpIHtcbiAgICB0aGlzLmluc2VydCh3b3JkWzBdKTtcbiAgfVxufTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG52YXIgVG9rZW5zID0gcmVxdWlyZSgnLi90b2tlbnMnKTtcbnZhciBUeXBlID0gVG9rZW5zLlR5cGU7XG5cbnZhciBCZWdpbiA9IC9bXFwvJ1wiYF0vZztcblxudmFyIE1hdGNoID0ge1xuICAnc2luZ2xlIGNvbW1lbnQnOiBbJy8vJywnXFxuJ10sXG4gICdkb3VibGUgY29tbWVudCc6IFsnLyonLCcqLyddLFxuICAndGVtcGxhdGUgc3RyaW5nJzogWydgJywnYCddLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFtcIidcIixcIidcIl0sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogWydcIicsJ1wiJ10sXG4gICdyZWdleHAnOiBbJy8nLCcvJ10sXG59O1xuXG52YXIgU2tpcCA9IHtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ3NpbmdsZSBjb21tZW50JzogZmFsc2UsXG4gICdkb3VibGUgY29tbWVudCc6IGZhbHNlLFxuICAncmVnZXhwJzogXCJcXFxcXCIsXG59O1xuXG52YXIgVG9rZW4gPSB7fTtcbmZvciAodmFyIGtleSBpbiBNYXRjaCkge1xuICB2YXIgTSA9IE1hdGNoW2tleV07XG4gIFRva2VuW01bMF1dID0ga2V5O1xufVxuXG52YXIgTGVuZ3RoID0ge1xuICAnb3BlbiBjb21tZW50JzogMixcbiAgJ2Nsb3NlIGNvbW1lbnQnOiAyLFxuICAndGVtcGxhdGUgc3RyaW5nJzogMSxcbn07XG5cbnZhciBOb3RPcGVuID0ge1xuICAnY2xvc2UgY29tbWVudCc6IHRydWVcbn07XG5cbnZhciBDbG9zZXMgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY2xvc2UgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUYWcgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAnc3RyaW5nJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudHM7XG5cbmZ1bmN0aW9uIFNlZ21lbnRzKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbiAgdGhpcy5jYWNoZSA9IHt9O1xuICB0aGlzLnJlc2V0KCk7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5jbGVhckNhY2hlID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQpIHtcbiAgICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMub2Zmc2V0IDwgb2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLmNhY2hlLnN0YXRlLnNwbGljZShzLmluZGV4KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmNhY2hlLnN0YXRlID0gW107XG4gIH1cbiAgdGhpcy5jYWNoZS5vZmZzZXQgPSB7fTtcbiAgdGhpcy5jYWNoZS5yYW5nZSA9IHt9O1xuICB0aGlzLmNhY2hlLnBvaW50ID0ge307XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhckNhY2hlKCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSBpbiB0aGlzLmNhY2hlLnBvaW50KSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGUucG9pbnRbeV07XG4gIH1cblxuICB2YXIgc2VnbWVudHMgPSB0aGlzLmJ1ZmZlci50b2tlbnMuZ2V0Q29sbGVjdGlvbignc2VnbWVudHMnKTtcbiAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgdmFyIHN0YXRlID0gbnVsbDtcbiAgdmFyIHdhaXRGb3IgPSAnJztcbiAgdmFyIHBvaW50ID0geyB4Oi0xLCB5Oi0xIH07XG4gIHZhciBjbG9zZSA9IDA7XG4gIHZhciBvZmZzZXQ7XG4gIHZhciBzZWdtZW50O1xuICB2YXIgcmFuZ2U7XG4gIHZhciB0ZXh0O1xuICB2YXIgdmFsaWQ7XG4gIHZhciBsYXN0O1xuXG4gIHZhciBsYXN0Q2FjaGVTdGF0ZU9mZnNldCA9IDA7XG5cbiAgdmFyIGkgPSAwO1xuXG4gIHZhciBjYWNoZVN0YXRlID0gdGhpcy5nZXRDYWNoZVN0YXRlKHkpO1xuICBpZiAoY2FjaGVTdGF0ZSAmJiBjYWNoZVN0YXRlLml0ZW0pIHtcbiAgICBvcGVuID0gdHJ1ZTtcbiAgICBzdGF0ZSA9IGNhY2hlU3RhdGUuaXRlbTtcbiAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgIGkgPSBzdGF0ZS5pbmRleCArIDE7XG4gIH1cblxuICBmb3IgKDsgaSA8IHNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb2Zmc2V0ID0gc2VnbWVudHMuZ2V0KGkpO1xuICAgIHNlZ21lbnQgPSB7XG4gICAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICAgIHR5cGU6IFR5cGVbdGhpcy5idWZmZXIuY2hhckF0KG9mZnNldCldXG4gICAgfTtcblxuICAgIC8vIHNlYXJjaGluZyBmb3IgY2xvc2UgdG9rZW5cbiAgICBpZiAob3Blbikge1xuICAgICAgaWYgKHdhaXRGb3IgPT09IHNlZ21lbnQudHlwZSkge1xuICAgICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFzdCA9IHNlZ21lbnQ7XG4gICAgICAgIGxhc3QucG9pbnQgPSBwb2ludDtcbiAgICAgICAgc3RhdGUgPSBudWxsO1xuICAgICAgICBvcGVuID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBvcGVuIHRva2VuXG4gICAgZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgfVxuXG4gICAgICByYW5nZSA9IHRoaXMuYnVmZmVyLmdldExpbmUocG9pbnQueSkub2Zmc2V0UmFuZ2U7XG5cbiAgICAgIGlmIChsYXN0ICYmIGxhc3QucG9pbnQueSA9PT0gcG9pbnQueSkge1xuICAgICAgICBjbG9zZSA9IGxhc3QucG9pbnQueCArIExlbmd0aFtsYXN0LnR5cGVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2xvc2UgPSAwO1xuICAgICAgfVxuXG4gICAgICB2YWxpZCA9IHRoaXMuaXNWYWxpZFJhbmdlKFtyYW5nZVswXSwgcmFuZ2VbMV0rMV0sIHNlZ21lbnQsIGNsb3NlKTtcblxuICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgIGlmIChOb3RPcGVuW3NlZ21lbnQudHlwZV0pIGNvbnRpbnVlO1xuICAgICAgICBvcGVuID0gdHJ1ZTtcbiAgICAgICAgc3RhdGUgPSBzZWdtZW50O1xuICAgICAgICBzdGF0ZS5pbmRleCA9IGk7XG4gICAgICAgIHN0YXRlLnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIC8vIHN0YXRlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLm9mZnNldCB9O1xuICAgICAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgICAgICBpZiAoIXRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIHx8IHRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoICYmIHN0YXRlLm9mZnNldCA+IHRoaXMuY2FjaGUuc3RhdGVbdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggLSAxXS5vZmZzZXQpIHtcbiAgICAgICAgICB0aGlzLmNhY2hlLnN0YXRlLnB1c2goc3RhdGUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzdGF0ZSAmJiBzdGF0ZS5wb2ludC55IDwgeSkge1xuICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gIH1cblxuICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbn07XG5cbi8vVE9ETzogY2FjaGUgaW4gQnVmZmVyXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCBpbiB0aGlzLmNhY2hlLm9mZnNldCkgcmV0dXJuIHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF07XG4gIHJldHVybiAodGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XSA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCkpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlLCBzZWdtZW50LCBjbG9zZSkge1xuICB2YXIga2V5ID0gcmFuZ2Uuam9pbigpO1xuICBpZiAoa2V5IGluIHRoaXMuY2FjaGUucmFuZ2UpIHJldHVybiB0aGlzLmNhY2hlLnJhbmdlW2tleV07XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UmFuZ2VUZXh0KHJhbmdlKTtcbiAgdmFyIHZhbGlkID0gdGhpcy5pc1ZhbGlkKHRleHQsIHNlZ21lbnQub2Zmc2V0IC0gcmFuZ2VbMF0sIGNsb3NlKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnJhbmdlW2tleV0gPSB2YWxpZCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCwgbGFzdEluZGV4KSB7XG4gIEJlZ2luLmxhc3RJbmRleCA9IGxhc3RJbmRleDtcblxuICB2YXIgbWF0Y2ggPSBCZWdpbi5leGVjKHRleHQpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG5cbiAgdmFyIGkgPSBtYXRjaC5pbmRleDtcblxuICB2YXIgbGFzdCA9IGk7XG5cbiAgdmFyIHZhbGlkID0gdHJ1ZTtcblxuICBvdXRlcjpcbiAgZm9yICg7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIG9uZSA9IHRleHRbaV07XG4gICAgdmFyIG5leHQgPSB0ZXh0W2kgKyAxXTtcbiAgICB2YXIgdHdvID0gb25lICsgbmV4dDtcbiAgICBpZiAoaSA9PT0gb2Zmc2V0KSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciBvID0gVG9rZW5bdHdvXTtcbiAgICBpZiAoIW8pIG8gPSBUb2tlbltvbmVdO1xuICAgIGlmICghbykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgdmFyIHdhaXRGb3IgPSBNYXRjaFtvXVsxXTtcblxuICAgIGxhc3QgPSBpO1xuXG4gICAgc3dpdGNoICh3YWl0Rm9yLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IG9uZSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDE7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcblxuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG4gICAgICAgICAgdHdvID0gdGV4dFtpXSArIHRleHRbaSArIDFdO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IHR3bykge1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDI7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsaWQ7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRDYWNoZVN0YXRlID0gZnVuY3Rpb24oeSkge1xuICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMucG9pbnQueSA8IHkpO1xuICBpZiAocy5pdGVtICYmIHkgLSAxIDwgcy5pdGVtLnBvaW50LnkpIHJldHVybiBudWxsO1xuICBlbHNlIHJldHVybiBzO1xuICAvLyByZXR1cm4gcztcbn07XG4iLCIvKlxuXG5leGFtcGxlIHNlYXJjaCBmb3Igb2Zmc2V0IGA0YCA6XG5gb2AgYXJlIG5vZGUncyBsZXZlbHMsIGB4YCBhcmUgdHJhdmVyc2FsIHN0ZXBzXG5cbnhcbnhcbm8tLT54ICAgbyAgIG9cbm8gbyB4ICAgbyAgIG8gbyBvXG5vIG8gby14IG8gbyBvIG8gb1xuMSAyIDMgNCA1IDYgNyA4IDlcblxuKi9cblxubW9kdWxlLmV4cG9ydHMgPSBTa2lwU3RyaW5nO1xuXG5mdW5jdGlvbiBOb2RlKHZhbHVlLCBsZXZlbCkge1xuICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gIHRoaXMubGV2ZWwgPSBsZXZlbDtcbiAgdGhpcy53aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKHZhbHVlICYmIHZhbHVlLmxlbmd0aCB8fCAwKTtcbiAgdGhpcy5uZXh0ID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwobnVsbCk7XG59XG5cbk5vZGUucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLndpZHRoWzBdO1xuICB9XG59O1xuXG5mdW5jdGlvbiBTa2lwU3RyaW5nKG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMubGV2ZWxzID0gby5sZXZlbHMgfHwgMTE7XG4gIHRoaXMuYmlhcyA9IG8uYmlhcyB8fCAxIC8gTWF0aC5FO1xuICB0aGlzLmhlYWQgPSBuZXcgTm9kZShudWxsLCB0aGlzLmxldmVscyk7XG4gIHRoaXMuY2h1bmtTaXplID0gby5jaHVua1NpemUgfHwgNTAwMDtcbn1cblxuU2tpcFN0cmluZy5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuaGVhZC53aWR0aFt0aGlzLmxldmVscyAtIDFdO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgLy8gZ3JlYXQgaGFjayB0byBkbyBvZmZzZXQgPj0gZm9yIC5zZWFyY2goKVxuICAvLyB3ZSBkb24ndCBoYXZlIGZyYWN0aW9ucyBhbnl3YXkgc28uLlxuICByZXR1cm4gdGhpcy5zZWFyY2gob2Zmc2V0LCB0cnVlKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5pbnNlcnRDaHVua2VkKDAsIHRleHQpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24ob2Zmc2V0LCBpbmNsKSB7XG4gIGluY2wgPSBpbmNsID8gLjEgOiAwO1xuXG4gIC8vIHByZXBhcmUgdG8gaG9sZCBzdGVwc1xuICB2YXIgc3RlcHMgPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuICB2YXIgd2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuXG4gIC8vIGl0ZXJhdGUgbGV2ZWxzIGRvd24sIHNraXBwaW5nIHRvcFxuICB2YXIgaSA9IHRoaXMubGV2ZWxzO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgd2hpbGUgKG9mZnNldCArIGluY2wgPiBub2RlLndpZHRoW2ldICYmIG51bGwgIT0gbm9kZS5uZXh0W2ldKSB7XG4gICAgICBvZmZzZXQgLT0gbm9kZS53aWR0aFtpXTtcbiAgICAgIG5vZGUgPSBub2RlLm5leHRbaV07XG4gICAgfVxuICAgIHN0ZXBzW2ldID0gbm9kZTtcbiAgICB3aWR0aFtpXSA9IG9mZnNldDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbm9kZTogbm9kZSxcbiAgICBzdGVwczogc3RlcHMsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIG9mZnNldDogb2Zmc2V0XG4gIH07XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zcGxpY2UgPSBmdW5jdGlvbihzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzOyAvLyBza2lwIHN0ZXBzIGxlZnQgb2YgdGhlIG9mZnNldFxuICB2YXIgd2lkdGggPSBzLndpZHRoO1xuXG4gIHZhciBwOyAvLyBsZWZ0IG5vZGUgb3IgYHBgXG4gIHZhciBxOyAvLyByaWdodCBub2RlIG9yIGBxYCAob3VyIG5ldyBub2RlKVxuICB2YXIgbGVuO1xuXG4gIC8vIGNyZWF0ZSBuZXcgbm9kZVxuICBsZXZlbCA9IGxldmVsIHx8IHRoaXMucmFuZG9tTGV2ZWwoKTtcbiAgcSA9IG5ldyBOb2RlKHZhbHVlLCBsZXZlbCk7XG4gIGxlbmd0aCA9IHEud2lkdGhbMF07XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBsZXZlbHMgYmVsb3cgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IGxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWwgc3RlcFxuICAgIHEubmV4dFtpXSA9IHAubmV4dFtpXTsgLy8gaW5zZXJ0IHNvIGluaGVyaXQgbGVmdCdzIG5leHRcbiAgICBwLm5leHRbaV0gPSBxOyAvLyBsZWZ0J3MgbmV4dCBpcyBub3cgb3VyIG5ldyBub2RlXG4gICAgcS53aWR0aFtpXSA9IHAud2lkdGhbaV0gLSB3aWR0aFtpXSArIGxlbmd0aDtcbiAgICBwLndpZHRoW2ldID0gd2lkdGhbaV07XG4gIH1cblxuICAvLyBpdGVyYXRlIHN0ZXBzIGFsbCBsZXZlbHMgZG93biB1bnRpbCBleGNlcHQgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbGV2ZWwpIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbFxuICAgIHAud2lkdGhbaV0gKz0gbGVuZ3RoOyAvLyBhZGQgbmV3IG5vZGUgd2lkdGhcbiAgfVxuXG4gIC8vIHJldHVybiBuZXcgbm9kZVxuICByZXR1cm4gcTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzID0gdGhpcy5zZWFyY2gob2Zmc2V0KTtcblxuICAvLyBpZiBzZWFyY2ggZmFsbHMgaW4gdGhlIG1pZGRsZSBvZiBhIHN0cmluZ1xuICAvLyBpbnNlcnQgaXQgdGhlcmUgaW5zdGVhZCBvZiBjcmVhdGluZyBhIG5ldyBub2RlXG4gIGlmIChzLm9mZnNldCAmJiBzLm5vZGUudmFsdWUgJiYgcy5vZmZzZXQgPCBzLm5vZGUudmFsdWUubGVuZ3RoKSB7XG4gICAgdGhpcy51cGRhdGUocywgaW5zZXJ0KHMub2Zmc2V0LCBzLm5vZGUudmFsdWUsIHZhbHVlKSk7XG4gICAgcmV0dXJuIHMubm9kZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLnNwbGljZShzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICAvLyB2YWx1ZXMgbGVuZ3RoIGRpZmZlcmVuY2VcbiAgdmFyIGxlbmd0aCA9IHMubm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgLy8gdXBkYXRlIHZhbHVlXG4gIHMubm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGZpeCB3aWR0aHMgb24gYWxsIGxldmVsc1xuICBpID0gdGhpcy5sZXZlbHM7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHMuc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmIChyYW5nZVsxXSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ3JhbmdlIGVuZCBvdmVyIG1heGltdW0gbGVuZ3RoKCcgK1xuICAgICAgdGhpcy5sZW5ndGggKyAnKTogWycgKyByYW5nZS5qb2luKCkgKyAnXSdcbiAgICApO1xuICB9XG5cbiAgLy8gcmVtYWluIGRpc3RhbmNlIHRvIHJlbW92ZVxuICB2YXIgeCA9IHJhbmdlWzFdIC0gcmFuZ2VbMF07XG5cbiAgLy8gc2VhcmNoIGZvciBub2RlIG9uIGxlZnQgZWRnZVxuICB2YXIgcyA9IHRoaXMuc2VhcmNoKHJhbmdlWzBdKTtcbiAgdmFyIG9mZnNldCA9IHMub2Zmc2V0O1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzO1xuICB2YXIgbm9kZSA9IHMubm9kZTtcblxuICAvLyBza2lwIGhlYWRcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAvLyBzbGljZSBsZWZ0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmIChvZmZzZXQpIHtcbiAgICBpZiAob2Zmc2V0IDwgbm9kZS53aWR0aFswXSkge1xuICAgICAgeCAtPSB0aGlzLnVwZGF0ZShzLFxuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKDAsIG9mZnNldCkgK1xuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKFxuICAgICAgICAgIG9mZnNldCArXG4gICAgICAgICAgTWF0aC5taW4oeCwgbm9kZS5sZW5ndGggLSBvZmZzZXQpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAgIGlmICghbm9kZSkgcmV0dXJuO1xuICB9XG5cbiAgLy8gcmVtb3ZlIGFsbCBmdWxsIG5vZGVzIGluIHJhbmdlXG4gIHdoaWxlIChub2RlICYmIHggPj0gbm9kZS53aWR0aFswXSkge1xuICAgIHggLT0gdGhpcy5yZW1vdmVOb2RlKHN0ZXBzLCBub2RlKTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG5cbiAgLy8gc2xpY2UgcmlnaHQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKHgpIHtcbiAgICB0aGlzLnJlcGxhY2Uoc3RlcHMsIG5vZGUsIG5vZGUudmFsdWUuc2xpY2UoeCkpO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVOb2RlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUud2lkdGhbMF07XG5cbiAgdmFyIGk7XG5cbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGggLSBub2RlLndpZHRoW2ldO1xuICAgIHN0ZXBzW2ldLm5leHRbaV0gPSBub2RlLm5leHRbaV07XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihzdGVwcywgbm9kZSwgdmFsdWUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIG5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICB2YXIgaTtcbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBub2RlLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlQ2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnJlbW92ZShbb2Zmc2V0LCBvZmZzZXQrMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0Q2h1bmtlZCA9IGZ1bmN0aW9uKG9mZnNldCwgdGV4dCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRleHQubGVuZ3RoOyBpICs9IHRoaXMuY2h1bmtTaXplKSB7XG4gICAgdmFyIGNodW5rID0gdGV4dC5zdWJzdHIoaSwgdGhpcy5jaHVua1NpemUpO1xuICAgIHRoaXMuaW5zZXJ0KGkgKyBvZmZzZXQsIGNodW5rKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3Vic3RyaW5nID0gZnVuY3Rpb24oYSwgYikge1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKDAsIHRoaXMubGVuZ3RoKTtcbn07XG5cbmZ1bmN0aW9uIHRyaW0ocywgbGVmdCwgcmlnaHQpIHtcbiAgcmV0dXJuIHMuc3Vic3RyKDAsIHMubGVuZ3RoIC0gcmlnaHQpLnN1YnN0cihsZWZ0KTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG52YXIgUiA9IFJlZ2V4cC5jcmVhdGU7XG5cbi8vTk9URTogb3JkZXIgbWF0dGVyc1xudmFyIHN5bnRheCA9IG1hcCh7XG4gICd0JzogUihbJ29wZXJhdG9yJ10sICdnJywgZW50aXRpZXMpLFxuICAnbSc6IFIoWydwYXJhbXMnXSwgICAnZycpLFxuICAnZCc6IFIoWydkZWNsYXJlJ10sICAnZycpLFxuICAnZic6IFIoWydmdW5jdGlvbiddLCAnZycpLFxuICAnayc6IFIoWydrZXl3b3JkJ10sICAnZycpLFxuICAnbic6IFIoWydidWlsdGluJ10sICAnZycpLFxuICAnbCc6IFIoWydzeW1ib2wnXSwgICAnZycpLFxuICAncyc6IFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ2UnOiBSKFsnc3BlY2lhbCcsJ251bWJlciddLCAnZycpLFxufSwgY29tcGlsZSk7XG5cbnZhciBJbmRlbnQgPSB7XG4gIHJlZ2V4cDogUihbJ2luZGVudCddLCAnZ20nKSxcbiAgcmVwbGFjZXI6IChzKSA9PiBzLnJlcGxhY2UoLyB7MSwyfXxcXHQvZywgJzx4PiQmPC94PicpXG59O1xuXG52YXIgQW55Q2hhciA9IC9cXFMvZztcblxudmFyIEJsb2NrcyA9IFIoWydjb21tZW50Jywnc3RyaW5nJywncmVnZXhwJ10sICdnbScpO1xuXG52YXIgTG9uZ0xpbmVzID0gLyheLnsxMDAwLH0pL2dtO1xuXG52YXIgVGFnID0ge1xuICAnLy8nOiAnYycsXG4gICcvKic6ICdjJyxcbiAgJ2AnOiAncycsXG4gICdcIic6ICdzJyxcbiAgXCInXCI6ICdzJyxcbiAgJy8nOiAncicsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bnRheDtcblxuZnVuY3Rpb24gU3ludGF4KG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMudGFiID0gby50YWIgfHwgJ1xcdCc7XG4gIHRoaXMuYmxvY2tzID0gW107XG59XG5cblN5bnRheC5wcm90b3R5cGUuZW50aXRpZXMgPSBlbnRpdGllcztcblxuU3ludGF4LnByb3RvdHlwZS5oaWdobGlnaHQgPSBmdW5jdGlvbihjb2RlLCBvZmZzZXQpIHtcbiAgY29kZSA9IHRoaXMuY3JlYXRlSW5kZW50cyhjb2RlKTtcbiAgY29kZSA9IHRoaXMuY3JlYXRlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gZW50aXRpZXMoY29kZSk7XG5cbiAgZm9yICh2YXIga2V5IGluIHN5bnRheCkge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2Uoc3ludGF4W2tleV0ucmVnZXhwLCBzeW50YXhba2V5XS5yZXBsYWNlcik7XG4gIH1cblxuICBjb2RlID0gdGhpcy5yZXN0b3JlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gY29kZS5yZXBsYWNlKEluZGVudC5yZWdleHAsIEluZGVudC5yZXBsYWNlcik7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUluZGVudHMgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBsaW5lcyA9IGNvZGUuc3BsaXQoL1xcbi9nKTtcbiAgdmFyIGluZGVudCA9IDA7XG4gIHZhciBtYXRjaDtcbiAgdmFyIGxpbmU7XG4gIHZhciBpO1xuXG4gIGkgPSBsaW5lcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIGxpbmUgPSBsaW5lc1tpXTtcbiAgICBBbnlDaGFyLmxhc3RJbmRleCA9IDA7XG4gICAgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMobGluZSk7XG4gICAgaWYgKG1hdGNoKSBpbmRlbnQgPSBtYXRjaC5pbmRleDtcbiAgICBlbHNlIGlmIChpbmRlbnQgJiYgIWxpbmUubGVuZ3RoKSB7XG4gICAgICBsaW5lc1tpXSA9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKHRoaXMudGFiKTtcbiAgICB9XG4gIH1cblxuICBjb2RlID0gbGluZXMuam9pbignXFxuJyk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLnJlc3RvcmVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBibG9jaztcbiAgdmFyIGJsb2NrcyA9IHRoaXMuYmxvY2tzO1xuICB2YXIgbiA9IDA7XG4gIHJldHVybiBjb2RlXG4gICAgLnJlcGxhY2UoL1xcdWZmZWMvZywgZnVuY3Rpb24oKSB7XG4gICAgICBibG9jayA9IGJsb2Nrc1tuKytdO1xuICAgICAgcmV0dXJuIGVudGl0aWVzKGJsb2NrLnNsaWNlKDAsIDEwMDApICsgJy4uLmxpbmUgdG9vIGxvbmcgdG8gZGlzcGxheScpO1xuICAgIH0pXG4gICAgLnJlcGxhY2UoL1xcdWZmZWIvZywgZnVuY3Rpb24oKSB7XG4gICAgICBibG9jayA9IGJsb2Nrc1tuKytdO1xuICAgICAgdmFyIHRhZyA9IGlkZW50aWZ5KGJsb2NrKTtcbiAgICAgIHJldHVybiAnPCcrdGFnKyc+JytlbnRpdGllcyhibG9jaykrJzwvJyt0YWcrJz4nO1xuICAgIH0pO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHRoaXMuYmxvY2tzID0gW107XG5cbiAgY29kZSA9IGNvZGVcbiAgICAucmVwbGFjZShMb25nTGluZXMsIChibG9jaykgPT4ge1xuICAgICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICByZXR1cm4gJ1xcdWZmZWMnO1xuICAgIH0pXG4gICAgLnJlcGxhY2UoQmxvY2tzLCAoYmxvY2spID0+IHtcbiAgICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgcmV0dXJuICdcXHVmZmViJztcbiAgICB9KTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cbmZ1bmN0aW9uIGNyZWF0ZUlkKCkge1xuICB2YXIgYWxwaGFiZXQgPSAnYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXonO1xuICB2YXIgbGVuZ3RoID0gYWxwaGFiZXQubGVuZ3RoIC0gMTtcbiAgdmFyIGkgPSA2O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcyArPSBhbHBoYWJldFtNYXRoLnJhbmRvbSgpICogbGVuZ3RoIHwgMF07XG4gIH1cbiAgcmV0dXJuIHM7XG59XG5cbmZ1bmN0aW9uIGVudGl0aWVzKHRleHQpIHtcbiAgcmV0dXJuIHRleHRcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgO1xufVxuXG5mdW5jdGlvbiBjb21waWxlKHJlZ2V4cCwgdGFnKSB7XG4gIHZhciBvcGVuVGFnID0gJzwnICsgdGFnICsgJz4nO1xuICB2YXIgY2xvc2VUYWcgPSAnPC8nICsgdGFnICsgJz4nO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IHRhZyxcbiAgICByZWdleHA6IHJlZ2V4cCxcbiAgICByZXBsYWNlcjogb3BlblRhZyArICckJicgKyBjbG9zZVRhZ1xuICB9O1xufVxuXG5mdW5jdGlvbiBtYXAob2JqLCBmbikge1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICByZXN1bHRba2V5XSA9IGZuKG9ialtrZXldLCBrZXkpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2UocGFzcywgY29kZSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhc3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHBhc3NbaV1bMF0sIHBhc3NbaV1bMV0pO1xuICB9XG4gIHJldHVybiBjb2RlO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuXG5mdW5jdGlvbiBpZGVudGlmeShibG9jaykge1xuICB2YXIgb25lID0gYmxvY2tbMF07XG4gIHZhciB0d28gPSBvbmUgKyBibG9ja1sxXTtcbiAgcmV0dXJuIFRhZ1t0d29dIHx8IFRhZ1tvbmVdO1xufVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgUGFydHMgPSByZXF1aXJlKCcuL3BhcnRzJyk7XG5cbnZhciBUeXBlID0ge1xuICAnXFxuJzogJ2xpbmVzJyxcbiAgJ3snOiAnb3BlbiBjdXJseScsXG4gICd9JzogJ2Nsb3NlIGN1cmx5JyxcbiAgJ1snOiAnb3BlbiBzcXVhcmUnLFxuICAnXSc6ICdjbG9zZSBzcXVhcmUnLFxuICAnKCc6ICdvcGVuIHBhcmVucycsXG4gICcpJzogJ2Nsb3NlIHBhcmVucycsXG4gICcvJzogJ29wZW4gY29tbWVudCcsXG4gICcqJzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAnYCc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRPS0VOID0gL1xcbnxcXC9cXCp8XFwqXFwvfGB8XFx7fFxcfXxcXFt8XFxdfFxcKHxcXCkvZztcblxubW9kdWxlLmV4cG9ydHMgPSBUb2tlbnM7XG5cblRva2Vucy5UeXBlID0gVHlwZTtcblxuZnVuY3Rpb24gVG9rZW5zKGZhY3RvcnkpIHtcbiAgZmFjdG9yeSA9IGZhY3RvcnkgfHwgZnVuY3Rpb24oKSB7IHJldHVybiBuZXcgUGFydHM7IH07XG5cbiAgdGhpcy5mYWN0b3J5ID0gZmFjdG9yeTtcblxuICB2YXIgdCA9IHRoaXMudG9rZW5zID0ge1xuICAgIGxpbmVzOiBmYWN0b3J5KCksXG4gICAgYmxvY2tzOiBmYWN0b3J5KCksXG4gICAgc2VnbWVudHM6IGZhY3RvcnkoKSxcbiAgfTtcblxuICB0aGlzLmNvbGxlY3Rpb24gPSB7XG4gICAgJ1xcbic6IHQubGluZXMsXG4gICAgJ3snOiB0LmJsb2NrcyxcbiAgICAnfSc6IHQuYmxvY2tzLFxuICAgICdbJzogdC5ibG9ja3MsXG4gICAgJ10nOiB0LmJsb2NrcyxcbiAgICAnKCc6IHQuYmxvY2tzLFxuICAgICcpJzogdC5ibG9ja3MsXG4gICAgJy8nOiB0LnNlZ21lbnRzLFxuICAgICcqJzogdC5zZWdtZW50cyxcbiAgICAnYCc6IHQuc2VnbWVudHMsXG4gIH07XG59XG5cblRva2Vucy5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Ub2tlbnMucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8fCAwO1xuXG4gIHZhciB0b2tlbnMgPSB0aGlzLnRva2VucztcbiAgdmFyIG1hdGNoO1xuICB2YXIgdHlwZTtcbiAgdmFyIGNvbGxlY3Rpb247XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGNvbGxlY3Rpb24gPSB0aGlzLmNvbGxlY3Rpb25bdGV4dFttYXRjaC5pbmRleF1dO1xuICAgIGNvbGxlY3Rpb24ucHVzaChtYXRjaC5pbmRleCArIG9mZnNldCk7XG4gIH1cbn07XG5cblRva2Vucy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocmFuZ2UsIHRleHQsIHNoaWZ0KSB7XG4gIHZhciBpbnNlcnQgPSBuZXcgVG9rZW5zKEFycmF5KTtcbiAgaW5zZXJ0LmluZGV4KHRleHQsIHJhbmdlWzBdKTtcblxuICB2YXIgbGVuZ3RocyA9IHt9O1xuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgbGVuZ3Roc1t0eXBlXSA9IHRoaXMudG9rZW5zW3R5cGVdLmxlbmd0aDtcbiAgfVxuXG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5zaGlmdE9mZnNldChyYW5nZVswXSwgc2hpZnQpO1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnJlbW92ZVJhbmdlKHJhbmdlKTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5pbnNlcnQocmFuZ2VbMF0sIGluc2VydC50b2tlbnNbdHlwZV0pO1xuICB9XG5cbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIGlmICh0aGlzLnRva2Vuc1t0eXBlXS5sZW5ndGggIT09IGxlbmd0aHNbdHlwZV0pIHtcbiAgICAgIHRoaXMuZW1pdChgY2hhbmdlICR7dHlwZX1gKTtcbiAgICB9XG4gIH1cbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlJbmRleCA9IGZ1bmN0aW9uKHR5cGUsIGluZGV4KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5nZXQoaW5kZXgpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRDb2xsZWN0aW9uID0gZnVuY3Rpb24odHlwZSkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV07XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5T2Zmc2V0ID0gZnVuY3Rpb24odHlwZSwgb2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5maW5kKG9mZnNldCk7XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHRva2VucyA9IG5ldyBUb2tlbnModGhpcy5mYWN0b3J5KTtcbiAgdmFyIHQgPSB0b2tlbnMudG9rZW5zO1xuICBmb3IgKHZhciBrZXkgaW4gdGhpcy50b2tlbnMpIHtcbiAgICB0W2tleV0gPSB0aGlzLnRva2Vuc1trZXldLnNsaWNlKCk7XG4gIH1cbiAgdG9rZW5zLmNvbGxlY3Rpb24gPSB7XG4gICAgJ1xcbic6IHQubGluZXMsXG4gICAgJ3snOiB0LmJsb2NrcyxcbiAgICAnfSc6IHQuYmxvY2tzLFxuICAgICdbJzogdC5ibG9ja3MsXG4gICAgJ10nOiB0LmJsb2NrcyxcbiAgICAnKCc6IHQuYmxvY2tzLFxuICAgICcpJzogdC5ibG9ja3MsXG4gICAgJy8nOiB0LnNlZ21lbnRzLFxuICAgICcqJzogdC5zZWdtZW50cyxcbiAgICAnYCc6IHQuc2VnbWVudHMsXG4gIH07XG4gIHJldHVybiB0b2tlbnM7XG59O1xuIiwidmFyIG9wZW4gPSByZXF1aXJlKCcuLi9saWIvb3BlbicpO1xudmFyIHNhdmUgPSByZXF1aXJlKCcuLi9saWIvc2F2ZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnLi9idWZmZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaWxlO1xuXG5mdW5jdGlvbiBGaWxlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMucm9vdCA9ICcnO1xuICB0aGlzLnBhdGggPSAndW50aXRsZWQnO1xuICB0aGlzLmJ1ZmZlciA9IG5ldyBCdWZmZXI7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkZpbGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuRmlsZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYnVmZmVyLm9uKCdyYXcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncmF3JykpO1xuICB0aGlzLmJ1ZmZlci5vbignc2V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3NldCcpKTtcbiAgdGhpcy5idWZmZXIub24oJ3VwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2UnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdiZWZvcmUgdXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JlZm9yZSBjaGFuZ2UnKSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5wYXRoID0gcGF0aDtcbiAgdGhpcy5yb290ID0gcm9vdDtcbiAgb3Blbihyb290ICsgcGF0aCwgKGVyciwgdGV4dCkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgICAgZm4gJiYgZm4oZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgICB0aGlzLmVtaXQoJ29wZW4nKTtcbiAgICBmbiAmJiBmbihudWxsLCB0aGlzKTtcbiAgfSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgc2F2ZSh0aGlzLnJvb3QgKyB0aGlzLnBhdGgsIHRoaXMuYnVmZmVyLnRvU3RyaW5nKCksIGZuIHx8IG5vb3ApO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi9saWIvZGVib3VuY2UnKTtcblxuLypcbiAgIC4gLlxuLTEgMCAxIDIgMyA0IDVcbiAgIG5cblxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSGlzdG9yeTtcblxuZnVuY3Rpb24gSGlzdG9yeShlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMubmVlZGxlID0gMDtcbiAgdGhpcy50aW1lb3V0ID0gdHJ1ZTtcbiAgdGhpcy50aW1lU3RhcnQgPSAwO1xuICB0aGlzLmRlYm91bmNlZFNhdmUgPSBkZWJvdW5jZSh0aGlzLmFjdHVhbGx5U2F2ZS5iaW5kKHRoaXMpLCA3MDApXG59XG5cbkhpc3RvcnkucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmIChEYXRlLm5vdygpIC0gdGhpcy50aW1lU3RhcnQgPiAyMDAwIHx8IGZvcmNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuICB0aGlzLnRpbWVvdXQgPSB0aGlzLmRlYm91bmNlZFNhdmUoKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmFjdHVhbGx5U2F2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgaWYgKHRoaXMuZWRpdG9yLmJ1ZmZlci5sb2cubGVuZ3RoKSB7XG4gICAgdGhpcy5sb2cgPSB0aGlzLmxvZy5zbGljZSgwLCArK3RoaXMubmVlZGxlKTtcbiAgICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICAgIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoO1xuICAgIHRoaXMuc2F2ZU1ldGEoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnNhdmVNZXRhKCk7XG4gIH1cbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuICBpZiAodGhpcy5uZWVkbGUgPCAwKSByZXR1cm47XG5cbiAgdGhpcy5jaGVja291dCgndW5kbycsIHRoaXMubmVlZGxlLS0pO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPT09IHRoaXMubG9nLmxlbmd0aCAtIDEpIHJldHVybjtcblxuICB0aGlzLmNoZWNrb3V0KCdyZWRvJywgKyt0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jaGVja291dCA9IGZ1bmN0aW9uKHR5cGUsIG4pIHtcbiAgdmFyIGNvbW1pdCA9IHRoaXMubG9nW25dO1xuICBpZiAoIWNvbW1pdCkgcmV0dXJuO1xuXG4gIHZhciBsb2cgPSBjb21taXQubG9nO1xuXG4gIGNvbW1pdCA9IHRoaXMubG9nW25dW3R5cGVdO1xuICB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSA9IGNvbW1pdC5tYXJrQWN0aXZlO1xuICB0aGlzLmVkaXRvci5tYXJrLnNldChjb21taXQubWFyay5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5zZXRDYXJldChjb21taXQuY2FyZXQuY29weSgpKTtcblxuICBsb2cgPSAndW5kbycgPT09IHR5cGVcbiAgICA/IGxvZy5zbGljZSgpLnJldmVyc2UoKVxuICAgIDogbG9nLnNsaWNlKCk7XG5cbiAgbG9nLmZvckVhY2goaXRlbSA9PiB7XG4gICAgdmFyIGFjdGlvbiA9IGl0ZW1bMF07XG4gICAgdmFyIG9mZnNldFJhbmdlID0gaXRlbVsxXTtcbiAgICB2YXIgdGV4dCA9IGl0ZW1bMl07XG4gICAgc3dpdGNoIChhY3Rpb24pIHtcbiAgICAgIGNhc2UgJ2luc2VydCc6XG4gICAgICAgIGlmICgndW5kbycgPT09IHR5cGUpIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5pbnNlcnQodGhpcy5lZGl0b3IuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldFJhbmdlWzBdKSwgdGV4dCwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyZW1vdmUnOlxuICAgICAgICBpZiAoJ3VuZG8nID09PSB0eXBlKSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLmluc2VydCh0aGlzLmVkaXRvci5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0UmFuZ2VbMF0pLCB0ZXh0LCB0cnVlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UsIHRydWUpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNvbW1pdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbG9nID0gdGhpcy5lZGl0b3IuYnVmZmVyLmxvZztcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLmxvZyA9IFtdO1xuICByZXR1cm4ge1xuICAgIGxvZzogbG9nLFxuICAgIHVuZG86IHRoaXMubWV0YSxcbiAgICByZWRvOiB7XG4gICAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgICBtYXJrQWN0aXZlOiB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZVxuICAgIH1cbiAgfTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmVNZXRhID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWV0YSA9IHtcbiAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gIH07XG59O1xuIiwidmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG5cbnZhciBQQUdJTkdfVEhST1RUTEUgPSA2NTtcblxudmFyIGtleXMgPSBtb2R1bGUuZXhwb3J0cyA9IHtcbiAgJ2N0cmwreic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS51bmRvKCk7XG4gIH0sXG4gICdjdHJsK3knOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucmVkbygpO1xuICB9LFxuXG4gICdob21lJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKCk7XG4gIH0sXG4gICdlbmQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKCk7XG4gIH0sXG4gICdwYWdldXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdwYWdlZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93bigpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCt1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK2Rvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEpO1xuICB9LFxuICAndXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSk7XG4gIH0sXG4gICdyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxKTtcbiAgfSxcbiAgJ2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEpO1xuICB9LFxuICAnY3RybCtyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEpO1xuICB9LFxuXG4gICdjdHJsK2EnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9LFxuXG4gICdlbnRlcic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5zZXJ0KCdcXG4nKTtcbiAgfSxcblxuICAnYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCtkJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciBsaW5lcyA9IGFyZWEuZW5kLnkgLSBhcmVhLmJlZ2luLnk7XG4gICAgaWYgKGxpbmVzICYmIGFyZWEuZW5kLnggPiAwKSBhZGQgKz0gMTtcbiAgICBpZiAoIWxpbmVzKSBhZGQgKz0gMTtcbiAgICBsaW5lcyArPSBhZGQ7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhLnNldExlZnQoMCkuYWRkQm90dG9tKGFkZCkpO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh7IHg6IDAsIHk6IGFyZWEuZW5kLnkgfSwgdGV4dCk7XG4gICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcyhsaW5lcyk7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMobGluZXMsIHRydWUpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5lbWl0KCdpbnB1dCcsICdcXHVhYWEyJywgdGhpcy5jYXJldC5jb3B5KCksIHRoaXMubWFyay5jb3B5KCksIHRoaXMubWFyay5hY3RpdmUpXG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZW1pdCgnaW5wdXQnLCAnXFx1YWFhMycsIHRoaXMuY2FyZXQuY29weSgpLCB0aGlzLm1hcmsuY29weSgpLCB0aGlzLm1hcmsuYWN0aXZlKVxuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICd0YWInOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5zdWdnZXN0KCk7XG4gICAgaWYgKCFyZXMpIHtcbiAgICAgIHRoaXMuaW5zZXJ0KHRoaXMudGFiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShyZXMuYXJlYSk7XG4gICAgICB0aGlzLmluc2VydChyZXMubm9kZS52YWx1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdjdHJsK2YnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmQub3BlbigpO1xuICB9LFxuXG4gICdmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoKzEpO1xuICB9LFxuICAnc2hpZnQrZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKC0xKTtcbiAgfSxcblxuICAnY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFkZDtcbiAgICB2YXIgYXJlYTtcbiAgICB2YXIgdGV4dDtcblxuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuXG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICBjbGVhciA9IHRydWU7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRoaXMubWFyay5hZGRCb3R0b20oYXJlYS5lbmQueCA+IDApLnNldExlZnQoMCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYSh0aGlzLm1hcmsuZ2V0KCkpO1xuICAgIH1cblxuICAgIC8vVE9ETzogc2hvdWxkIGNoZWNrIGlmIGxhc3QgbGluZSBoYXMgLy8gYWxzb1xuICAgIGlmICh0ZXh0LnRyaW1MZWZ0KCkuc3Vic3RyKDAsMikgPT09ICcvLycpIHtcbiAgICAgIGFkZCA9IC0zO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXiguKj8pXFwvXFwvICguKykvZ20sICckMSQyJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkZCA9ICszO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXihbXFxzXSopKC4rKS9nbSwgJyQxLy8gJDInKTtcbiAgICB9XG5cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcblxuICAgIHRoaXMubWFyay5zZXQoYXJlYS5hZGRSaWdodChhZGQpKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuXG4gICAgaWYgKGNhcmV0LngpIGNhcmV0LmFkZFJpZ2h0KGFkZCk7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldCk7XG5cbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIGNsZWFyID0gdHJ1ZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICAgIGlmICh0ZXh0LnNsaWNlKDAsMikgPT09ICcvKicgJiYgdGV4dC5zbGljZSgtMikgPT09ICcqLycpIHtcbiAgICAgIHRleHQgPSB0ZXh0LnNsaWNlKDIsLTIpO1xuICAgICAgYWRkIC09IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgLT0gMjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGV4dCA9ICcvKicgKyB0ZXh0ICsgJyovJztcbiAgICAgIGFkZCArPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkICs9IDI7XG4gICAgfVxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuICAgIGFyZWEuZW5kLnggKz0gYWRkO1xuICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0LmFkZFJpZ2h0KGFkZCkpO1xuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG59O1xuXG5rZXlzLnNpbmdsZSA9IHtcbiAgLy9cbn07XG5cbi8vIHNlbGVjdGlvbiBrZXlzXG5bICdob21lJywnZW5kJyxcbiAgJ3BhZ2V1cCcsJ3BhZ2Vkb3duJyxcbiAgJ2xlZnQnLCd1cCcsJ3JpZ2h0JywnZG93bicsXG4gICdjdHJsK2xlZnQnLCdjdHJsK3JpZ2h0J1xuXS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICBrZXlzWydzaGlmdCsnK2tleV0gPSBmdW5jdGlvbihlKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICBrZXlzW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfTtcbn0pO1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgTW91c2UgPSByZXF1aXJlKCcuL21vdXNlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vdGV4dCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IElucHV0O1xuXG5mdW5jdGlvbiBJbnB1dChlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubW91c2UgPSBuZXcgTW91c2UodGhpcyk7XG4gIHRoaXMudGV4dCA9IG5ldyBUZXh0O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5JbnB1dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5JbnB1dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmx1ciA9IHRoaXMuYmx1ci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnRleHQub24oWydrZXknLCAndGV4dCddLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnaW5wdXQnKSk7XG4gIHRoaXMudGV4dC5vbignZm9jdXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKSk7XG4gIHRoaXMudGV4dC5vbignYmx1cicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJykpO1xuICB0aGlzLnRleHQub24oJ3RleHQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAndGV4dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXlzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleXMnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjdXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY3V0JykpO1xuICB0aGlzLnRleHQub24oJ2NvcHknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY29weScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdwYXN0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdwYXN0ZScpKTtcbiAgdGhpcy5tb3VzZS5vbigndXAnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2V1cCcpKTtcbiAgdGhpcy5tb3VzZS5vbignY2xpY2snLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VjbGljaycpKTtcbiAgdGhpcy5tb3VzZS5vbignZG93bicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRvd24nKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnIGJlZ2luJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZ2JlZ2luJykpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgdGhpcy5tb3VzZS51c2Uobm9kZSk7XG4gIHRoaXMudGV4dC5yZXNldCgpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmJsdXIoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuZm9jdXMoKTtcbn07XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW91c2U7XG5cbmZ1bmN0aW9uIE1vdXNlKCkge1xuICB0aGlzLm5vZGUgPSBudWxsO1xuICB0aGlzLmNsaWNrcyA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbk1vdXNlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdXNlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXNldENsaWNrcyA9IGRlYm91bmNlKHRoaXMucmVzZXRDbGlja3MuYmluZCh0aGlzKSwgMzUwKVxuICB0aGlzLm9ubWF5YmVkcmFnID0gdGhpcy5vbm1heWJlZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZHJhZyA9IHRoaXMub25kcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kb3duID0gdGhpcy5vbmRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbnVwID0gdGhpcy5vbnVwLmJpbmQodGhpcyk7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICBpZiAodGhpcy5ub2RlKSB7XG4gICAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIHRoaXMub25kb3duKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIHRoaXMub25kb3duKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRvd24gPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmRvd24gPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2Rvd24nLCBlKTtcbiAgdGhpcy5vbmNsaWNrKGUpO1xuICB0aGlzLm1heWJlRHJhZygpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9udXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndXAnLCBlKTtcbiAgaWYgKCF0aGlzLmRvd24pIHJldHVybjtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5kcmFnRW5kKCk7XG4gIHRoaXMubWF5YmVEcmFnRW5kKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25jbGljayA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5yZXNldENsaWNrcygpO1xuICB0aGlzLmNsaWNrcyA9ICh0aGlzLmNsaWNrcyAlIDMpICsgMTtcbiAgdGhpcy5lbWl0KCdjbGljaycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9ubWF5YmVkcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcblxuICB2YXIgZCA9XG4gICAgICBNYXRoLmFicyh0aGlzLnBvaW50LnggLSB0aGlzLmRvd24ueClcbiAgICArIE1hdGguYWJzKHRoaXMucG9pbnQueSAtIHRoaXMuZG93bi55KTtcblxuICBpZiAoZCA+IDUpIHtcbiAgICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xuICAgIHRoaXMuZHJhZ0JlZ2luKCk7XG4gIH1cbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2RyYWcnLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBiZWdpbicpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGVuZCcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLnJlc2V0Q2xpY2tzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xpY2tzID0gMDtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xuXG52YXIgVEhST1RUTEUgPSAwIC8vMTAwMC82MjtcblxudmFyIG1hcCA9IHtcbiAgODogJ2JhY2tzcGFjZScsXG4gIDk6ICd0YWInLFxuICAxMzogJ2VudGVyJyxcbiAgMzM6ICdwYWdldXAnLFxuICAzNDogJ3BhZ2Vkb3duJyxcbiAgMzU6ICdlbmQnLFxuICAzNjogJ2hvbWUnLFxuICAzNzogJ2xlZnQnLFxuICAzODogJ3VwJyxcbiAgMzk6ICdyaWdodCcsXG4gIDQwOiAnZG93bicsXG4gIDQ2OiAnZGVsZXRlJyxcbiAgNDg6ICcwJyxcbiAgNDk6ICcxJyxcbiAgNTA6ICcyJyxcbiAgNTE6ICczJyxcbiAgNTI6ICc0JyxcbiAgNTM6ICc1JyxcbiAgNTQ6ICc2JyxcbiAgNTU6ICc3JyxcbiAgNTY6ICc4JyxcbiAgNTc6ICc5JyxcbiAgNjU6ICdhJyxcbiAgNjg6ICdkJyxcbiAgNzA6ICdmJyxcbiAgNzc6ICdtJyxcbiAgNzg6ICduJyxcbiAgODM6ICdzJyxcbiAgODk6ICd5JyxcbiAgOTA6ICd6JyxcbiAgMTEyOiAnZjEnLFxuICAxMTQ6ICdmMycsXG4gIDEyMjogJ2YxMScsXG4gIDE4ODogJywnLFxuICAxOTA6ICcuJyxcbiAgMTkxOiAnLycsXG5cbiAgLy8gbnVtcGFkXG4gIDk3OiAnZW5kJyxcbiAgOTg6ICdkb3duJyxcbiAgOTk6ICdwYWdlZG93bicsXG4gIDEwMDogJ2xlZnQnLFxuICAxMDI6ICdyaWdodCcsXG4gIDEwMzogJ2hvbWUnLFxuICAxMDQ6ICd1cCcsXG4gIDEwNTogJ3BhZ2V1cCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRleHQ7XG5cblRleHQubWFwID0gbWFwO1xuXG5mdW5jdGlvbiBUZXh0KCkge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZXh0YXJlYScpO1xuXG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgcG9zaXRpb246ICdhYnNvbHV0ZScsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgd2lkdGg6IDEsXG4gICAgaGVpZ2h0OiAxLFxuICAgIG9wYWNpdHk6IDAsXG4gICAgekluZGV4OiAxMDAwMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZScsXG4gICAgYXV0b2NvbXBsZXRlOiAnb2ZmJyxcbiAgICBzcGVsbGNoZWNraW5nOiAnb2ZmJyxcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG4gIHRoaXMuY2xlYXIgPSB0aHJvdHRsZSh0aGlzLmNsZWFyLmJpbmQodGhpcyksIDIwMDApXG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmJsdXIoKTtcbn07XG5cblRleHQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuZm9jdXMoKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgLy8gZm9yY2VzIGNhcmV0IHRvIGVuZCBvZiB0ZXh0YXJlYSBzbyB3ZSBjYW4gZ2V0IC5zbGljZSgtMSkgY2hhclxuICBzZXRJbW1lZGlhdGUoKCkgPT4gdGhpcy5lbC5zZWxlY3Rpb25TdGFydCA9IHRoaXMuZWwudmFsdWUubGVuZ3RoKTtcbiAgdGhpcy5lbWl0KCd0ZXh0JywgdGhpcy5nZXQoKSk7XG4gIHRoaXMuY2xlYXIoKTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICAvLyBjb25zb2xlLmxvZyhlLndoaWNoKTtcbiAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gIGlmIChub3cgLSB0aGlzLnRocm90dGxlVGltZSA8IFRIUk9UVExFKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB0aGlzLnRocm90dGxlVGltZSA9IG5vdztcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleXVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCAmJiAhZS5zaGlmdEtleSkga2V5cy5wdXNoKCdzaGlmdDp1cCcpO1xuICBpZiAobS5jdHJsICYmICFlLmN0cmxLZXkpIGtleXMucHVzaCgnY3RybDp1cCcpO1xuICBpZiAobS5hbHQgJiYgIWUuYWx0S2V5KSBrZXlzLnB1c2goJ2FsdDp1cCcpO1xuXG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdICsgJzp1cCcpO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25jdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjdXQnLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uY29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2NvcHknLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ucGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdwYXN0ZScsIGUpO1xufTtcbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi9saWIvcmVnZXhwJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uL2xpYi9wb2ludCcpO1xuXG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsnd29yZHMnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3ZlO1xuXG5mdW5jdGlvbiBNb3ZlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xufVxuXG5Nb3ZlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VEb3duID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIHNpemUgLSByZW1haW5kZXIpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKHBhZ2UpO1xufTtcblxuTW92ZS5wcm90b3R5cGUucGFnZVVwID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIC0oc2l6ZSAtIHJlbWFpbmRlcikpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKC1wYWdlKTtcbn07XG5cbnZhciBtb3ZlID0ge307XG5cbm1vdmUuYnlXb3JkID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgbGluZSA9IGJ1ZmZlci5nZXRMaW5lVGV4dChwLnkpO1xuXG4gIGlmIChkeCA+IDAgJiYgcC54ID49IGxpbmUubGVuZ3RoIC0gMSkgeyAvLyBhdCBlbmQgb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCArMSk7IC8vIG1vdmUgb25lIGNoYXIgcmlnaHRcbiAgfSBlbHNlIGlmIChkeCA8IDAgJiYgcC54ID09PSAwKSB7IC8vIGF0IGJlZ2luIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgLTEpOyAvLyBtb3ZlIG9uZSBjaGFyIGxlZnRcbiAgfVxuXG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZShsaW5lLCBXT1JEUyk7XG4gIHZhciB3b3JkO1xuXG4gIGlmIChkeCA8IDApIHdvcmRzLnJldmVyc2UoKTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmIChkeCA+IDBcbiAgICAgID8gd29yZC5pbmRleCA+IHAueFxuICAgICAgOiB3b3JkLmluZGV4IDwgcC54KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiB3b3JkLmluZGV4LFxuICAgICAgICB5OiBwLnlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVhY2hlZCBiZWdpbi9lbmQgb2YgZmlsZVxuICByZXR1cm4gZHggPiAwXG4gICAgPyBtb3ZlLmVuZE9mTGluZShidWZmZXIsIHApXG4gICAgOiBtb3ZlLmJlZ2luT2ZMaW5lKGJ1ZmZlciwgcCk7XG59O1xuXG5tb3ZlLmJ5Q2hhcnMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHggPCAwKSB7IC8vIGdvaW5nIGxlZnRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIGxlZnRcbiAgICBpZiAoeCA8IDApIHsgLy8gd2hlbiBwYXN0IGxlZnQgZWRnZVxuICAgICAgaWYgKHkgPiAwKSB7IC8vIGFuZCBsaW5lcyBhYm92ZVxuICAgICAgICB5IC09IDE7IC8vIG1vdmUgdXAgYSBsaW5lXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGFuZCBnbyB0byB0aGUgZW5kIG9mIGxpbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHggPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChkeCA+IDApIHsgLy8gZ29pbmcgcmlnaHRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIHJpZ2h0XG4gICAgd2hpbGUgKHggLSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggPiAwKSB7IC8vIHdoaWxlIHBhc3QgbGluZSBsZW5ndGhcbiAgICAgIGlmICh5ID09PSBidWZmZXIubG9jKCkpIHsgLy8gb24gZW5kIG9mIGZpbGVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gZ28gdG8gZW5kIG9mIGxpbmUgb24gbGFzdCBsaW5lXG4gICAgICAgIGJyZWFrOyAvLyBhbmQgZXhpdFxuICAgICAgfVxuICAgICAgeCAtPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggKyAxOyAvLyB3cmFwIHRoaXMgbGluZSBsZW5ndGhcbiAgICAgIHkgKz0gMTsgLy8gYW5kIG1vdmUgZG93biBhIGxpbmVcbiAgICB9XG4gIH1cblxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYnlMaW5lcyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHkpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeSA8IDApIHsgLy8gZ29pbmcgdXBcbiAgICBpZiAoeSArIGR5ID4gMCkgeyAvLyB3aGVuIGxpbmVzIGFib3ZlXG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIHVwXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSAwO1xuICAgIH1cbiAgfSBlbHNlIGlmIChkeSA+IDApIHsgLy8gZ29pbmcgZG93blxuICAgIGlmICh5IDwgYnVmZmVyLmxvYygpIC0gZHkpIHsgLy8gd2hlbiBsaW5lcyBiZWxvd1xuICAgICAgeSArPSBkeTsgLy8gbW92ZSBkb3duXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSBidWZmZXIubG9jKCk7XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgKHggPiBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aCkge1xuICAvLyAgIHggPSBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gfVxuICB4ID0gTWF0aC5taW4odGhpcy5sYXN0RGVsaWJlcmF0ZVgsIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkxpbmUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5lbmRPZkxpbmUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShwLnkpLmxlbmd0aDtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSBJbmZpbml0eTtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGhcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogbGFzdFxuICB9O1xufTtcblxubW92ZS5pc0JlZ2luT2ZGaWxlID0gZnVuY3Rpb24oXywgcCkge1xuICByZXR1cm4gcC54ID09PSAwICYmIHAueSA9PT0gMDtcbn07XG5cbm1vdmUuaXNFbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHJldHVybiBwLnkgPT09IGxhc3QgJiYgcC54ID09PSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGg7XG59O1xuXG5PYmplY3Qua2V5cyhtb3ZlKS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICBNb3ZlLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24ocGFyYW0sIGJ5RWRpdCkge1xuICAgIHZhciByZXN1bHQgPSBtb3ZlW21ldGhvZF0uY2FsbChcbiAgICAgIHRoaXMsXG4gICAgICB0aGlzLmVkaXRvci5idWZmZXIsXG4gICAgICB0aGlzLmVkaXRvci5jYXJldCxcbiAgICAgIHBhcmFtXG4gICAgKTtcblxuICAgIGlmICgnaXMnID09PSBtZXRob2Quc2xpY2UoMCwyKSkgcmV0dXJuIHJlc3VsdDtcblxuICAgIHRoaXMuZW1pdCgnbW92ZScsIHJlc3VsdCwgYnlFZGl0KTtcbiAgfTtcbn0pO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJlZGl0b3JcIjpcIl9zcmNfc3R5bGVfX2VkaXRvclwiLFwibGF5ZXJcIjpcIl9zcmNfc3R5bGVfX2xheWVyXCIsXCJyb3dzXCI6XCJfc3JjX3N0eWxlX19yb3dzXCIsXCJtYXJrXCI6XCJfc3JjX3N0eWxlX19tYXJrXCIsXCJjb2RlXCI6XCJfc3JjX3N0eWxlX19jb2RlXCIsXCJjYXJldFwiOlwiX3NyY19zdHlsZV9fY2FyZXRcIixcImJsaW5rLXNtb290aFwiOlwiX3NyY19zdHlsZV9fYmxpbmstc21vb3RoXCIsXCJjYXJldC1ibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2NhcmV0LWJsaW5rLXNtb290aFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIHJlZGJsaXNzOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzFFMTYnLFxuICAgIGNvbG9yOiAnI0U5RTNEMScsXG4gICAga2V5d29yZDogJyNBMTM2MzAnLFxuICAgIGZ1bmN0aW9uOiAnI0IzREYwMicsXG4gICAgZGVjbGFyZTogJyNGNjM4MzMnLFxuICAgIG51bWJlcjogJyNGRjlGNEUnLFxuICAgIHBhcmFtczogJyNBMDkwQTAnLFxuICAgIHJlZ2V4cDogJyNCRDcwRjQnLFxuICAgIGNvbW1lbnQ6ICcjNjM1MDQ3JyxcbiAgICBzdHJpbmc6ICcjM0VBMUZCJyxcbiAgfSxcblxuICBkYXlsaWdodDoge1xuICAgIGJhY2tncm91bmQ6ICcjRUJFQkVCJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjRkYxQjFCJyxcbiAgICBmdW5jdGlvbjogJyMwMDA1RkYnLFxuICAgIGRlY2xhcmU6ICcjMEM3QTAwJyxcbiAgICBudW1iZXI6ICcjODAyMUQ0JyxcbiAgICBwYXJhbXM6ICcjNEM2OTY5JyxcbiAgICBjb21tZW50OiAnI0FCQUJBQicsXG4gICAgc3RyaW5nOiAnI0U2NzAwMCcsXG4gIH0sXG59O1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBzZXRUaGVtZTtcbmV4cG9ydHMudGhlbWVzID0gdGhlbWVzO1xuXG4vKlxudDogb3BlcmF0b3Jcbms6IGtleXdvcmRcbmQ6IGRlY2xhcmVcbmI6IGJ1aWx0aW5cbm86IGJvb2xlYW5cbm46IG51bWJlclxubTogcGFyYW1zXG5mOiBmdW5jdGlvblxucjogcmVnZXhwXG5jOiBjb21tZW50XG5zOiBzdHJpbmdcbmw6IHN5bWJvbFxueDogaW5kZW50XG4gKi9cbmZ1bmN0aW9uIHNldFRoZW1lKG5hbWUpIHtcbiAgdmFyIHQgPSB0aGVtZXNbbmFtZV07XG4gIGRvbS5jc3MoJ3RoZW1lJyxcbmBcbi4ke25hbWV9IHtcbiAgYmFja2dyb3VuZDogJHt0LmJhY2tncm91bmR9O1xufVxuXG50LFxuayB7XG4gIGNvbG9yOiAke3Qua2V5d29yZH07XG59XG5cbmQsXG5uIHtcbiAgY29sb3I6ICR7dC5kZWNsYXJlfTtcbn1cblxubyxcbmUge1xuICBjb2xvcjogJHt0Lm51bWJlcn07XG59XG5cbm0ge1xuICBjb2xvcjogJHt0LnBhcmFtc307XG59XG5cbmYge1xuICBjb2xvcjogJHt0LmZ1bmN0aW9ufTtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5yIHtcbiAgY29sb3I6ICR7dC5yZWdleHAgfHwgdC5wYXJhbXN9O1xufVxuXG5jIHtcbiAgY29sb3I6ICR7dC5jb21tZW50fTtcbn1cblxucyB7XG4gIGNvbG9yOiAke3Quc3RyaW5nfTtcbn1cblxubCxcbi4ke2Nzcy5jb2RlfSB7XG4gIGNvbG9yOiAke3QuY29sb3J9O1xufVxuXG4uJHtjc3MuY2FyZXR9IHtcbiAgYmFja2dyb3VuZDogJHt0LmNvbG9yfTtcbn1cblxubSxcbmQge1xuICBmb250LXN0eWxlOiBpdGFsaWM7XG59XG5cbmwge1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbngge1xuICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gIGJhY2tncm91bmQtcmVwZWF0OiBuby1yZXBlYXQ7XG59XG5gXG4gIClcblxufVxuXG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCbG9ja1ZpZXc7XG5cbmZ1bmN0aW9uIEJsb2NrVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdibG9jayc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5ibG9jayk7XG4gIHRoaXMuaHRtbCA9ICcnO1xufVxuXG5CbG9ja1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGUpIHtcbiAgdmFyIGh0bWwgPSAnJztcblxuICB2YXIgT3BlbiA9IHtcbiAgICAneyc6ICdjdXJseScsXG4gICAgJ1snOiAnc3F1YXJlJyxcbiAgICAnKCc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIENsb3NlID0ge1xuICAgICd9JzogJ2N1cmx5JyxcbiAgICAnXSc6ICdzcXVhcmUnLFxuICAgICcpJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgb2Zmc2V0ID0gZS5idWZmZXIuZ2V0UG9pbnQoZS5jYXJldCkub2Zmc2V0O1xuXG4gIHZhciByZXN1bHQgPSBlLmJ1ZmZlci50b2tlbnMuZ2V0QnlPZmZzZXQoJ2Jsb2NrcycsIG9mZnNldCk7XG4gIGlmICghcmVzdWx0KSByZXR1cm4gaHRtbDtcblxuICB2YXIgbGVuZ3RoID0gZS5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ2Jsb2NrcycpLmxlbmd0aDtcbiAgdmFyIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQocmVzdWx0KTtcblxuICB2YXIgb3BlbjtcbiAgdmFyIGNsb3NlO1xuXG4gIHZhciBpID0gcmVzdWx0LmluZGV4O1xuICB2YXIgb3Blbk9mZnNldCA9IHJlc3VsdC5vZmZzZXQ7XG5cbiAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChvcGVuT2Zmc2V0KTtcblxuICB2YXIgY291bnQgPSByZXN1bHQub2Zmc2V0ID49IG9mZnNldCAtIDEgJiYgQ2xvc2VbY2hhcl0gPyAwIDogMTtcblxuICB2YXIgbGltaXQgPSAyMDA7XG5cbiAgd2hpbGUgKGkgPiAwKSB7XG4gICAgb3BlbiA9IE9wZW5bY2hhcl07XG4gICAgaWYgKENsb3NlW2NoYXJdKSBjb3VudCsrO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBpZiAob3BlbiAmJiAhLS1jb3VudCkgYnJlYWs7XG5cbiAgICBvcGVuT2Zmc2V0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5SW5kZXgoJ2Jsb2NrcycsIC0taSk7XG4gICAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChvcGVuT2Zmc2V0KTtcbiAgfVxuXG4gIGlmIChjb3VudCkgcmV0dXJuIGh0bWw7XG5cbiAgY291bnQgPSAxO1xuXG4gIHZhciBjbG9zZU9mZnNldDtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59XG5cbkJsb2NrVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBodG1sID0gdGhpcy5nZXQodGhpcy5lZGl0b3IpO1xuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuICAgIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICB9XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENhcmV0VmlldztcblxuZnVuY3Rpb24gQ2FyZXRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2NhcmV0JztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNhcmV0KTtcbn1cblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBvcGFjaXR5OiArdGhpcy5lZGl0b3IuaGFzRm9jdXMsXG4gICAgbGVmdDogdGhpcy5lZGl0b3IuY2FyZXRQeC54ICsgdGhpcy5lZGl0b3IubWFyZ2luTGVmdCxcbiAgICB0b3A6IHRoaXMuZWRpdG9yLmNhcmV0UHgueSAtIDEsXG4gICAgaGVpZ2h0OiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCArIDFcbiAgfSk7XG59O1xuXG5DYXJldFZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgb3BhY2l0eTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxudmFyIEFoZWFkVGhyZXNob2xkID0ge1xuICBhbmltYXRpb246IFsuMTUsIC40XSxcbiAgbm9ybWFsOiBbLjc1LCAxLjVdXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGVWaWV3O1xuXG5mdW5jdGlvbiBDb2RlVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG5cbiAgdGhpcy5uYW1lID0gJ2NvZGUnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY29kZSk7XG4gIHRoaXMucGFydHMgPSBbXTtcbn1cblxuQ29kZVZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Db2RlVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRoaXMudGFyZ2V0ID0gdGFyZ2V0O1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhcnQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydCA9IG5ldyBQYXJ0KHRoaXMsIHJhbmdlKTtcbiAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICBwYXJ0LnJlbmRlcigpO1xuICBwYXJ0LmFwcGVuZCgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xuICBpZiAoZWRpdC5zaGlmdCA+IDApIHRoaXMucmVuZGVySW5zZXJ0KGVkaXQpO1xuICBlbHNlIGlmIChlZGl0LnNoaWZ0IDwgMCkgdGhpcy5yZW5kZXJSZW1vdmUoZWRpdCk7XG4gIGVsc2UgdGhpcy5yZW5kZXJMaW5lKGVkaXQpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5QYXJ0cyA9IHRoaXMuaW5SYW5nZVBhcnRzKHBhZ2UpO1xuICB2YXIgbmVlZFJhbmdlcyA9IFJhbmdlLk5PVChwYWdlLCB0aGlzLnBhcnRzKTtcbiAgbmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHRoaXMucmVuZGVyUGFydChyYW5nZSkpO1xuICBpblBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LnJlbmRlcigpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJSZW1vdmUgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPiBlZGl0LnJhbmdlWzBdICYmIHBhcnRbMV0gPCBlZGl0LnJhbmdlWzFdKSB7XG4gICAgICB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+IGVkaXQubGluZSkge1xuICAgICAgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lICYmIHBhcnRbMF0gKyBlZGl0LnNoaWZ0IDw9IGVkaXQubGluZSkge1xuICAgICAgdmFyIG9mZnNldCA9IGVkaXQubGluZSAtIChwYXJ0WzBdICsgZWRpdC5zaGlmdCkgKyAxO1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydC5vZmZzZXQob2Zmc2V0KTtcbiAgICAgIGlmIChwYXJ0WzBdID49IHBhcnRbMV0pIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSkge1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJJbnNlcnQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMF0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnRbMV0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJQYWdlKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyTGluZSA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lICYmIHBhcnRbMV0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA8PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgaWYgKHBhcnRbMV0gPCBwYXJ0WzBdKSB0aGlzLnJlbW92ZVBhcnQocGFydClcbiAgICAgIGVsc2UgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW1vdmVQYXJ0ID0gZnVuY3Rpb24ocGFydCkge1xuICBwYXJ0LmNsZWFyKCk7XG4gIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihwYXJ0KSwgMSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuY2xlYXJPdXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLm91dFJhbmdlUGFydHModGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHJhbmdlKSlcbiAgICAuZm9yRWFjaChwYXJ0ID0+IHRoaXMucmVtb3ZlUGFydChwYXJ0KSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuaW5SYW5nZVBhcnRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gdGhpcy5wYXJ0c1tpXTtcbiAgICBpZiAoIHBhcnRbMF0gPj0gcmFuZ2VbMF0gJiYgcGFydFswXSA8PSByYW5nZVsxXVxuICAgICAgfHwgcGFydFsxXSA+PSByYW5nZVswXSAmJiBwYXJ0WzFdIDw9IHJhbmdlWzFdICkge1xuICAgICAgcGFydHMucHVzaChwYXJ0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLm91dFJhbmdlUGFydHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSB0aGlzLnBhcnRzW2ldO1xuICAgIGlmICggcGFydFsxXSA8IHJhbmdlWzBdXG4gICAgICB8fCBwYXJ0WzBdID4gcmFuZ2VbMV0gKSB7XG4gICAgICBwYXJ0cy5wdXNoKHBhcnQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0aW5nKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuXG4gIGlmIChSYW5nZS5OT1QocGFnZSwgdGhpcy5wYXJ0cykubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKFJhbmdlLkFORChwYWdlLCB0aGlzLnBhcnRzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgICB0aGlzLnJlbmRlclBhcnQocGFnZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdXVxuICAgIDogWy1BaGVhZFRocmVzaG9sZC5ub3JtYWxbMF0sICtBaGVhZFRocmVzaG9sZC5ub3JtYWxbMF1dO1xuXG4gIHZhciBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gIHZhciBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdGhpcy5wYXJ0cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG5cbiAgICB0aHJlc2hvbGQgPSB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdXVxuICAgICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFsxXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFsxXV07XG5cbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG5cbiAgICBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gICAgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHRoaXMucGFydHMpO1xuICAgIGFoZWFkTmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHtcbiAgICAgIHRoaXMucmVuZGVyUGFydChyYW5nZSk7XG4gICAgfSk7XG4gIH1cbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LmNsZWFyKCkpO1xuICB0aGlzLnBhcnRzID0gW107XG59O1xuXG5mdW5jdGlvbiBQYXJ0KHZpZXcsIHJhbmdlKSB7XG4gIHRoaXMudmlldyA9IHZpZXc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jb2RlKTtcbiAgdGhpcy5jb2RlID0gJyc7XG4gIHRoaXMub2Zmc2V0VG9wID0gMDtcbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG5cbiAgdmFyIHN0eWxlID0ge307XG5cbiAgaWYgKHRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnMuaW5kZXhPZih0aGlzLnZpZXcubmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICAgIHN0eWxlLm9wYWNpdHkgPSAwLjU7XG4gIH1cblxuICBkb20uc3R5bGUodGhpcywgc3R5bGUpO1xufVxuXG5QYXJ0LnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMub2Zmc2V0VG9wICs9IHk7XG4gIHRoaXMuY29kZSA9IHRoaXMuY29kZS5zcGxpdCgvXFxuL2cpLnNsaWNlKHkpLmpvaW4oJ1xcbicpO1xuICB0aGlzWzFdIC09IHk7XG4gIHRoaXMuc3R5bGUoKTtcbiAgdGhpcy5kb20uZWwuc2Nyb2xsVG9wID0gdGhpcy5vZmZzZXRUb3AgKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0O1xufTtcblxuUGFydC5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5hcHBlbmQodGhpcy52aWV3LnRhcmdldCwgdGhpcyk7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLnZpZXcuZWRpdG9yLmJ1ZmZlci5nZXQodGhpcyk7XG4gIGlmIChjb2RlICE9PSB0aGlzLmNvZGUpIHtcbiAgICBkb20uaHRtbCh0aGlzLCBjb2RlKTtcbiAgICB0aGlzLmNvZGUgPSBjb2RlO1xuICB9XG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblBhcnQucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAodGhpc1sxXSAtIHRoaXNbMF0gKyAxKSAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgdG9wOiB0aGlzWzBdICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodFxuICB9KTtcbn07XG5cblBhcnQucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5yZW1vdmUodGhpcyk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmluZFZpZXc7XG5cbmZ1bmN0aW9uIEZpbmRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2ZpbmQnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuZmluZCk7XG59XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuRmluZFZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIHJlc3VsdHMgPSBlLmZpbmRSZXN1bHRzO1xuXG4gIHZhciBiZWdpbiA9IDA7XG4gIHZhciBlbmQgPSByZXN1bHRzLmxlbmd0aDtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGkgPSAtMTtcblxuICBkbyB7XG4gICAgcHJldiA9IGk7XG4gICAgaSA9IGJlZ2luICsgKGVuZCAtIGJlZ2luKSAvIDIgfCAwO1xuICAgIGlmIChyZXN1bHRzW2ldLnkgPCByYW5nZVswXSAtIDEpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHByZXYgIT09IGkpO1xuXG4gIHZhciB3aWR0aCA9IGUuZmluZFZhbHVlLmxlbmd0aCAqIGUuY2hhci53aWR0aCArICdweCc7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgdmFyIHRhYnM7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKHIpO1xuICAgIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICAgICsgJ3dpZHRoOicgKyB3aWR0aCArICc7J1xuICAgICAgICAgICsgJ3RvcDonICsgKHIueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgICArICdsZWZ0OicgKyAoKHIueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICAgKyAnXCI+PC9pPic7XG4gIH1cblxuICByZXR1cm4gaHRtbDtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5maW5kLmlzT3BlbiB8fCAhdGhpcy5lZGl0b3IuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0uNSwrLjVdKTtcbiAgdmFyIGh0bWwgPSB0aGlzLmdldChwYWdlLCB0aGlzLmVkaXRvcik7XG5cbiAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmh0bWwodGhpcywgJycpO1xufTtcbiIsInZhciBSdWxlclZpZXcgPSByZXF1aXJlKCcuL3J1bGVyJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBDb2RlVmlldyA9IHJlcXVpcmUoJy4vY29kZScpO1xudmFyIENhcmV0VmlldyA9IHJlcXVpcmUoJy4vY2FyZXQnKTtcbnZhciBCbG9ja1ZpZXcgPSByZXF1aXJlKCcuL2Jsb2NrJyk7XG52YXIgRmluZFZpZXcgPSByZXF1aXJlKCcuL2ZpbmQnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdzO1xuXG5mdW5jdGlvbiBWaWV3cyhlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG5cbiAgdGhpcy52aWV3cyA9IFtcbiAgICBuZXcgUnVsZXJWaWV3KGVkaXRvciksXG4gICAgbmV3IE1hcmtWaWV3KGVkaXRvciksXG4gICAgbmV3IENvZGVWaWV3KGVkaXRvciksXG4gICAgbmV3IENhcmV0VmlldyhlZGl0b3IpLFxuICAgIG5ldyBCbG9ja1ZpZXcoZWRpdG9yKSxcbiAgICBuZXcgRmluZFZpZXcoZWRpdG9yKSxcbiAgICBuZXcgUm93c1ZpZXcoZWRpdG9yKSxcbiAgXTtcblxuICB0aGlzLnZpZXdzLmZvckVhY2godmlldyA9PiB0aGlzW3ZpZXcubmFtZV0gPSB2aWV3KTtcbiAgdGhpcy5mb3JFYWNoID0gdGhpcy52aWV3cy5mb3JFYWNoLmJpbmQodGhpcy52aWV3cyk7XG59XG5cblZpZXdzLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnVzZShlbCkpO1xufTtcblxuVmlld3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnJlbmRlcigpKTtcbn07XG5cblZpZXdzLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hcmtWaWV3O1xuXG5mdW5jdGlvbiBNYXJrVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdtYXJrJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLm1hcmspO1xufVxuXG5NYXJrVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbk1hcmtWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBtYXJrID0gZS5tYXJrLmdldCgpO1xuICBpZiAocmFuZ2VbMF0gPiBtYXJrLmVuZC55KSByZXR1cm4gZmFsc2U7XG4gIGlmIChyYW5nZVsxXSA8IG1hcmsuYmVnaW4ueSkgcmV0dXJuIGZhbHNlO1xuXG4gIHZhciBvZmZzZXRzID0gZS5idWZmZXIuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBhcmVhID0gZS5idWZmZXIuZ2V0QXJlYU9mZnNldFJhbmdlKG1hcmspO1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG5cbiAgYXJlYVswXSAtPSBvZmZzZXRzWzBdO1xuICBhcmVhWzFdIC09IG9mZnNldHNbMF07XG5cbiAgdmFyIGFib3ZlID0gY29kZS5zdWJzdHJpbmcoMCwgYXJlYVswXSk7XG4gIHZhciBtaWRkbGUgPSBjb2RlLnN1YnN0cmluZyhhcmVhWzBdLCBhcmVhWzFdKTtcbiAgdmFyIGh0bWwgPSBlLnN5bnRheC5lbnRpdGllcyhhYm92ZSlcbiAgICArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHRvcDogcGFnZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgIGhlaWdodDogJ2F1dG8nXG4gIH0pO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb3dzVmlldztcblxuZnVuY3Rpb24gUm93c1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAncm93cyc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5yb3dzKTtcbiAgdGhpcy5yb3dzID0gLTE7XG4gIHRoaXMucmFuZ2UgPSBbLTEsLTFdO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuUm93c1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Sb3dzVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMSwrMV0pO1xuXG4gIGlmICggcmFuZ2VbMF0gPj0gdGhpcy5yYW5nZVswXVxuICAgICYmIHJhbmdlWzFdIDw9IHRoaXMucmFuZ2VbMV1cbiAgICAmJiAoIHRoaXMucmFuZ2VbMV0gIT09IHRoaXMucm93c1xuICAgICAgfHwgdGhpcy5lZGl0b3Iucm93cyA9PT0gdGhpcy5yb3dzXG4gICAgKSkgcmV0dXJuO1xuXG4gIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMywrM10pO1xuICB0aGlzLnJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICB0aGlzLnJhbmdlID0gcmFuZ2U7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgZm9yICh2YXIgaSA9IHJhbmdlWzBdOyBpIDw9IHJhbmdlWzFdOyBpKyspIHtcbiAgICBodG1sICs9IChpICsgMSkgKyAnXFxuJztcbiAgfVxuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuXG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG5cbiAgICBkb20uc3R5bGUodGhpcywge1xuICAgICAgdG9wOiByYW5nZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHRcbiAgICB9KTtcbiAgfVxufTtcblxuUm93c1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJ1bGVyVmlldztcblxuZnVuY3Rpb24gUnVsZXJWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ3J1bGVyJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLnJ1bGVyKTtcbn1cblxuUnVsZXJWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAodGhpcy5lZGl0b3Iucm93cyArIHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0KVxuICAgICAgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodFxuICAgICAgKyB0aGlzLmVkaXRvci5wYWdlUmVtYWluZGVyLmhlaWdodFxuICB9KTtcbn07XG5cblJ1bGVyVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cbmZ1bmN0aW9uIFZpZXcoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xufVxuXG5WaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdyZW5kZXIgbm90IGltcGxlbWVudGVkJyk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyIG5vdCBpbXBsZW1lbnRlZCcpO1xufTtcbiJdfQ==
