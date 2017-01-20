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

    bindings: { single: {} },

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
  this.emit('input');
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

Area.prototype.toString = function (a) {
  return '' + a.begin + '-' + a.end;
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
  return 'x:' + this.x + ',y:' + this.y;
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
  if (area.begin.y + y < 0 || area.end.y + y > this.loc) return false;

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

  last = i;

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

  'ctrl+shift+up': function ctrlShiftUp() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(-1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(-1, true);
    } else {
      this.buffer.moveAreaByLines(-1, this.mark.get());
      this.mark.shiftByLines(-1);
      this.move.byLines(-1, true);
    }
  },
  'ctrl+shift+down': function ctrlShiftDown() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(+1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(+1, true);
    } else {
      this.buffer.moveAreaByLines(+1, this.mark.get());
      this.mark.shiftByLines(+1);
      this.move.byLines(+1, true);
    }
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
    this.markBegin(false);
    var area = this.mark.get();
    if (this.buffer.moveAreaByLines(-1, area)) {
      this.mark.shiftByLines(-1);
      this.move.byLines(-1, true);
    }
  },

  'shift+ctrl+down': function shiftCtrlDown() {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7O0FBSUEsSUFBSSxpQkFBaUI7QUFDbkIsU0FBTyxTQURZO0FBRW5CLGFBQVcsS0FGUTtBQUduQixlQUFhLE9BSE07QUFJbkIsZ0JBQWMsS0FKSztBQUtuQixnQkFBYyxFQUxLO0FBTW5CLGFBQVcsS0FOUTtBQU9uQixxQkFBbUIsS0FQQTtBQVFuQixtQkFBaUIsS0FSRTtBQVNuQixlQUFhLEVBVE07QUFVbkIsaUJBQWU7QUFWSSxDQUFyQjs7QUFhQSxRQUFRLHFCQUFSO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxVQUFVLFFBQVEsZ0JBQVIsQ0FBZDtBQUNBLElBQUksV0FBVyxRQUFRLGdCQUFSLENBQWY7QUFDQSxJQUFJLFdBQVcsUUFBUSxnQkFBUixDQUFmO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxTQUFTLFFBQVEsY0FBUixDQUFiO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxRQUFRLFFBQVEsYUFBUixDQUFaO0FBQ0EsSUFBSSxPQUFPLFFBQVEsWUFBUixDQUFYO0FBQ0EsSUFBSSxNQUFNLFFBQVEsV0FBUixDQUFWOztBQUVBLElBQUksa0JBQWtCLFFBQVEsc0JBQVIsQ0FBdEI7QUFDQSxJQUFJLFVBQVUsUUFBUSxlQUFSLENBQWQ7QUFDQSxJQUFJLFFBQVEsUUFBUSxhQUFSLENBQVo7QUFDQSxJQUFJLE9BQU8sUUFBUSxZQUFSLENBQVg7QUFDQSxJQUFJ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cyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKlxuICogSmF6elxuICovXG5cbnZhciBEZWZhdWx0T3B0aW9ucyA9IHtcbiAgdGhlbWU6ICd3ZXN0ZXJuJyxcbiAgZm9udF9zaXplOiAnOXB0JyxcbiAgbGluZV9oZWlnaHQ6ICcxLjRlbScsXG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogOTUsXG4gIGhpZGVfcm93czogZmFsc2UsXG4gIGNlbnRlcl9ob3Jpem9udGFsOiBmYWxzZSxcbiAgY2VudGVyX3ZlcnRpY2FsOiBmYWxzZSxcbiAgbWFyZ2luX2xlZnQ6IDE1LFxuICBndXR0ZXJfbWFyZ2luOiAyMCxcbn07XG5cbnJlcXVpcmUoJy4vbGliL3NldC1pbW1lZGlhdGUnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuL2xpYi9kb20nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9saWIvbWVyZ2UnKTtcbnZhciBjbG9uZSA9IHJlcXVpcmUoJy4vbGliL2Nsb25lJyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vbGliL2JpbmQtcmFmJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi9saWIvcmVnZXhwJyk7XG52YXIgRGlhbG9nID0gcmVxdWlyZSgnLi9saWIvZGlhbG9nJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuL2xpYi9wb2ludCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi9saWIvcmFuZ2UnKTtcbnZhciBBcmVhID0gcmVxdWlyZSgnLi9saWIvYXJlYScpO1xudmFyIEJveCA9IHJlcXVpcmUoJy4vbGliL2JveCcpO1xuXG52YXIgRGVmYXVsdEJpbmRpbmdzID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvYmluZGluZ3MnKTtcbnZhciBIaXN0b3J5ID0gcmVxdWlyZSgnLi9zcmMvaGlzdG9yeScpO1xudmFyIElucHV0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQnKTtcbnZhciBGaWxlID0gcmVxdWlyZSgnLi9zcmMvZmlsZScpO1xudmFyIE1vdmUgPSByZXF1aXJlKCcuL3NyYy9tb3ZlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L3RleHQnKTtcbnZhciBWaWV3cyA9IHJlcXVpcmUoJy4vc3JjL3ZpZXdzJyk7XG52YXIgdGhlbWUgPSByZXF1aXJlKCcuL3NyYy90aGVtZScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3JjL3N0eWxlLmNzcycpO1xuXG52YXIgTkVXTElORSA9IFJlZ2V4cC5jcmVhdGUoWyduZXdsaW5lJ10pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEpheno7XG5cbmZ1bmN0aW9uIEphenoob3B0aW9ucykge1xuICB0aGlzLm9wdGlvbnMgPSBtZXJnZShjbG9uZShEZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMgfHwge30pO1xuXG4gIE9iamVjdC5hc3NpZ24odGhpcywge1xuICAgIGVsOiBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG5cbiAgICBpZDogJ2phenpfJyArIChNYXRoLnJhbmRvbSgpICogMTBlNiB8IDApLnRvU3RyaW5nKDM2KSxcbiAgICBmaWxlOiBuZXcgRmlsZSxcbiAgICBtb3ZlOiBuZXcgTW92ZSh0aGlzKSxcbiAgICB2aWV3czogbmV3IFZpZXdzKHRoaXMpLFxuICAgIGlucHV0OiBuZXcgSW5wdXQodGhpcyksXG4gICAgaGlzdG9yeTogbmV3IEhpc3RvcnkodGhpcyksXG5cbiAgICBiaW5kaW5nczogeyBzaW5nbGU6IHt9IH0sXG5cbiAgICBmaW5kOiBuZXcgRGlhbG9nKCdGaW5kJywgVGV4dC5tYXApLFxuICAgIGZpbmRWYWx1ZTogJycsXG4gICAgZmluZE5lZWRsZTogMCxcbiAgICBmaW5kUmVzdWx0czogW10sXG5cbiAgICBzY3JvbGw6IG5ldyBQb2ludCxcbiAgICBvZmZzZXQ6IG5ldyBQb2ludCxcbiAgICBzaXplOiBuZXcgQm94LFxuICAgIGNoYXI6IG5ldyBCb3gsXG5cbiAgICBwYWdlOiBuZXcgQm94LFxuICAgIHBhZ2VQb2ludDogbmV3IFBvaW50LFxuICAgIHBhZ2VSZW1haW5kZXI6IG5ldyBCb3gsXG4gICAgcGFnZUJvdW5kczogbmV3IFJhbmdlLFxuXG4gICAgbG9uZ2VzdExpbmU6IDAsXG4gICAgZ3V0dGVyOiAwLFxuICAgIGNvZGU6IDAsXG4gICAgcm93czogMCxcblxuICAgIHRhYlNpemU6IDIsXG4gICAgdGFiOiAnICAnLFxuXG4gICAgY2FyZXQ6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG4gICAgY2FyZXRQeDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcblxuICAgIGhhc0ZvY3VzOiBmYWxzZSxcblxuICAgIG1hcms6IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICAgIH0pLFxuXG4gICAgZWRpdGluZzogZmFsc2UsXG4gICAgZWRpdExpbmU6IC0xLFxuICAgIGVkaXRSYW5nZTogWy0xLC0xXSxcbiAgICBlZGl0U2hpZnQ6IDAsXG5cbiAgICBzdWdnZXN0SW5kZXg6IDAsXG4gICAgc3VnZ2VzdFJvb3Q6ICcnLFxuICAgIHN1Z2dlc3ROb2RlczogW10sXG5cbiAgICBhbmltYXRpb25UeXBlOiAnbGluZWFyJyxcbiAgICBhbmltYXRpb25GcmFtZTogLTEsXG4gICAgYW5pbWF0aW9uUnVubmluZzogZmFsc2UsXG4gICAgYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0OiBudWxsLFxuXG4gICAgcmVuZGVyUXVldWU6IFtdLFxuICAgIHJlbmRlclJlcXVlc3Q6IG51bGwsXG4gIH0pO1xuXG4gIC8vIHVzZWZ1bCBzaG9ydGN1dHNcbiAgdGhpcy5idWZmZXIgPSB0aGlzLmZpbGUuYnVmZmVyO1xuICB0aGlzLmJ1ZmZlci5tYXJrID0gdGhpcy5tYXJrO1xuICB0aGlzLnN5bnRheCA9IHRoaXMuYnVmZmVyLnN5bnRheDtcblxuICB0aGVtZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuXG4gIHRoaXMuYmluZE1ldGhvZHMoKTtcbiAgdGhpcy5iaW5kRXZlbnRzKCk7XG59XG5cbkphenoucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSmF6ei5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZWwsIHNjcm9sbEVsKSB7XG4gIGlmICh0aGlzLnJlZikge1xuICAgIHRoaXMuZWwucmVtb3ZlQXR0cmlidXRlKCdpZCcpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZShjc3MuZWRpdG9yKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgICB0aGlzLm9mZlNjcm9sbCgpO1xuICAgIHRoaXMucmVmLmZvckVhY2gocmVmID0+IHtcbiAgICAgIGRvbS5hcHBlbmQoZWwsIHJlZik7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5yZWYgPSBbXS5zbGljZS5jYWxsKHRoaXMuZWwuY2hpbGRyZW4pO1xuICAgIGRvbS5hcHBlbmQoZWwsIHRoaXMuZWwpO1xuICAgIGRvbS5vbnJlc2l6ZSh0aGlzLm9uUmVzaXplKTtcbiAgfVxuXG4gIHRoaXMuZWwgPSBlbDtcbiAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2lkJywgdGhpcy5pZCk7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZChjc3MuZWRpdG9yKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gIHRoaXMub2ZmU2Nyb2xsID0gZG9tLm9uc2Nyb2xsKHNjcm9sbEVsIHx8IHRoaXMuZWwsIHRoaXMub25TY3JvbGwpO1xuICB0aGlzLmlucHV0LnVzZSh0aGlzLmVsKTtcbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXdzLmNhcmV0LCB0aGlzLmlucHV0LnRleHQpO1xuICB0aGlzLnZpZXdzLnVzZSh0aGlzLmVsKTtcblxuICBzZXRUaW1lb3V0KHRoaXMucmVwYWludCwgMCk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hc3NpZ24gPSBmdW5jdGlvbihiaW5kaW5ncykge1xuICB0aGlzLmJpbmRpbmdzID0gYmluZGluZ3M7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMuZmlsZS5vcGVuKHBhdGgsIHJvb3QsIGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgdGhpcy5maWxlLnNhdmUoZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQsIHBhdGgpIHtcbiAgdGhpcy5maWxlLnNldCh0ZXh0KTtcbiAgdGhpcy5maWxlLnBhdGggPSBwYXRoIHx8IHRoaXMuZmlsZS5wYXRoO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmZvY3VzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmJsdXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRNZXRob2RzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lLmJpbmQodGhpcyk7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luLmJpbmQodGhpcyk7XG4gIHRoaXMubWFya1NldCA9IHRoaXMubWFya1NldC5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtDbGVhciA9IHRoaXMubWFya0NsZWFyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMucmVwYWludCA9IHRoaXMucmVwYWludC5iaW5kKHRoaXMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEhhbmRsZXJzID0gZnVuY3Rpb24oKSB7XG4gIGZvciAodmFyIG1ldGhvZCBpbiB0aGlzKSB7XG4gICAgaWYgKCdvbicgPT09IG1ldGhvZC5zbGljZSgwLCAyKSkge1xuICAgICAgdGhpc1ttZXRob2RdID0gdGhpc1ttZXRob2RdLmJpbmQodGhpcyk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kRXZlbnRzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmluZEhhbmRsZXJzKClcbiAgdGhpcy5tb3ZlLm9uKCdtb3ZlJywgdGhpcy5vbk1vdmUpO1xuICB0aGlzLmZpbGUub24oJ3JhdycsIHRoaXMub25GaWxlUmF3KTsgLy9UT0RPOiBzaG91bGQgbm90IG5lZWQgdGhpcyBldmVudFxuICB0aGlzLmZpbGUub24oJ3NldCcsIHRoaXMub25GaWxlU2V0KTtcbiAgdGhpcy5maWxlLm9uKCdvcGVuJywgdGhpcy5vbkZpbGVPcGVuKTtcbiAgdGhpcy5maWxlLm9uKCdjaGFuZ2UnLCB0aGlzLm9uRmlsZUNoYW5nZSk7XG4gIHRoaXMuZmlsZS5vbignYmVmb3JlIGNoYW5nZScsIHRoaXMub25CZWZvcmVGaWxlQ2hhbmdlKTtcbiAgdGhpcy5oaXN0b3J5Lm9uKCdjaGFuZ2UnLCB0aGlzLm9uSGlzdG9yeUNoYW5nZSk7XG4gIHRoaXMuaW5wdXQub24oJ2JsdXInLCB0aGlzLm9uQmx1cik7XG4gIHRoaXMuaW5wdXQub24oJ2ZvY3VzJywgdGhpcy5vbkZvY3VzKTtcbiAgdGhpcy5pbnB1dC5vbignaW5wdXQnLCB0aGlzLm9uSW5wdXQpO1xuICB0aGlzLmlucHV0Lm9uKCd0ZXh0JywgdGhpcy5vblRleHQpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXlzJywgdGhpcy5vbktleXMpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXknLCB0aGlzLm9uS2V5KTtcbiAgdGhpcy5pbnB1dC5vbignY3V0JywgdGhpcy5vbkN1dCk7XG4gIHRoaXMuaW5wdXQub24oJ2NvcHknLCB0aGlzLm9uQ29weSk7XG4gIHRoaXMuaW5wdXQub24oJ3Bhc3RlJywgdGhpcy5vblBhc3RlKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2V1cCcsIHRoaXMub25Nb3VzZVVwKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2Vkb3duJywgdGhpcy5vbk1vdXNlRG93bik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlY2xpY2snLCB0aGlzLm9uTW91c2VDbGljayk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZ2JlZ2luJywgdGhpcy5vbk1vdXNlRHJhZ0JlZ2luKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnJywgdGhpcy5vbk1vdXNlRHJhZyk7XG4gIHRoaXMuZmluZC5vbignc3VibWl0JywgdGhpcy5maW5kSnVtcC5iaW5kKHRoaXMsIDEpKTtcbiAgdGhpcy5maW5kLm9uKCd2YWx1ZScsIHRoaXMub25GaW5kVmFsdWUpO1xuICB0aGlzLmZpbmQub24oJ2tleScsIHRoaXMub25GaW5kS2V5KTtcbiAgdGhpcy5maW5kLm9uKCdvcGVuJywgdGhpcy5vbkZpbmRPcGVuKTtcbiAgdGhpcy5maW5kLm9uKCdjbG9zZScsIHRoaXMub25GaW5kQ2xvc2UpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25TY3JvbGwgPSBmdW5jdGlvbihzY3JvbGwpIHtcbiAgdGhpcy5zY3JvbGwuc2V0KHNjcm9sbCk7XG4gIHRoaXMucmVuZGVyKCdjb2RlJyk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG4gIHRoaXMucmVuZGVyKCdyb3dzJyk7XG4gIHRoaXMucmVzdCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVzdCA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbn0sIDYwMCk7XG5cbkphenoucHJvdG90eXBlLm9uTW92ZSA9IGZ1bmN0aW9uKHBvaW50LCBieUVkaXQpIHtcbiAgaWYgKCFieUVkaXQpIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICBpZiAocG9pbnQpIHRoaXMuc2V0Q2FyZXQocG9pbnQpO1xuXG4gIGlmICghYnlFZGl0KSB7XG4gICAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgfHwgdGhpcy5pbnB1dC5tb3VzZS5kb3duKSB7XG4gICAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ21vdmUnKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG4gIHRoaXMucmVzdCgpO1xuXG4gIHRoaXMucmVuZGVyKCdjYXJldCcpO1xuICB0aGlzLnJlbmRlcignYmxvY2snKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Gb2N1cyA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IHRydWU7XG4gIHRoaXMuZW1pdCgnZm9jdXMnKTtcbiAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldFNvbGlkID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgdGhpcy5jYXJldEJsaW5rKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldEJsaW5rID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXQsIGNzc1snYmxpbmstc21vb3RoJ11dKTtcbn0sIDQwMCk7XG5cbkphenoucHJvdG90eXBlLm9uQmx1ciA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IGZhbHNlO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHtcbiAgICAgIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgICAgIHRoaXMuZW1pdCgnYmx1cicpO1xuICAgICAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgICB9XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKGtleXMgaW4gdGhpcy5iaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5cyBpbiBEZWZhdWx0QmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmIChrZXkgaW4gdGhpcy5iaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleSBpbiBEZWZhdWx0QmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHRoaXMub25Db3B5KGUpO1xuICB0aGlzLmRlbGV0ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Db3B5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgLy9cbn07XG5cbkphenoucHJvdG90eXBlLnNldFRhYk1vZGUgPSBmdW5jdGlvbihjaGFyKSB7XG4gIGlmICgnXFx0JyA9PT0gY2hhcikge1xuICAgIHRoaXMudGFiID0gY2hhcjtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnRhYiA9IG5ldyBBcnJheSh0aGlzLnRhYlNpemUgKyAxKS5qb2luKGNoYXIpO1xuICB9XG59XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0KHsgeDowLCB5OjAgfSk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkhpc3RvcnlDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXIoJ2NvZGUnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLmVkaXRDYXJldEJlZm9yZSA9IHRoaXMuY2FyZXQuY29weSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuXG4gIHRoaXMudmlld3MuY29kZS5yZW5kZXJFZGl0KHtcbiAgICBsaW5lOiBlZGl0UmFuZ2VbMF0sXG4gICAgcmFuZ2U6IGVkaXRSYW5nZSxcbiAgICBzaGlmdDogZWRpdFNoaWZ0LFxuICAgIGNhcmV0Tm93OiB0aGlzLmNhcmV0LFxuICAgIGNhcmV0QmVmb3JlOiB0aGlzLmVkaXRDYXJldEJlZm9yZVxuICB9KTtcblxuICB0aGlzLnJlbmRlcignY2FyZXQnKTtcbiAgdGhpcy5yZW5kZXIoJ3Jvd3MnKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgdGhpcy5yZW5kZXIoJ2ZpbmQnKTtcbiAgdGhpcy5yZW5kZXIoJ3J1bGVyJyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG4gIHRoaXMuZW1pdCgnaW5wdXQnKTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0RnJvbVB4ID0gZnVuY3Rpb24ocHgpIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLm1hcmdpbkxlZnQsIHk6IHRoaXMuY2hhci5oZWlnaHQvMiB9KVsnKyddKHRoaXMub2Zmc2V0KTtcbiAgaWYgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwpIGcueSArPSB0aGlzLnNpemUuaGVpZ2h0IC8gMyB8IDA7XG4gIHZhciBwID0gcHhbJy0nXShnKVsnKyddKHRoaXMuc2Nyb2xsKVsnby8nXSh0aGlzLmNoYXIpO1xuXG4gIHAueSA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueSwgdGhpcy5idWZmZXIubG9jKCkpKTtcbiAgcC54ID0gTWF0aC5tYXgoMCwgcC54KTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0Q29vcmRzVGFicyhwKTtcblxuICBwLnggPSBNYXRoLm1heChcbiAgICAwLFxuICAgIE1hdGgubWluKFxuICAgICAgcC54IC0gdGFicy50YWJzICsgdGFicy5yZW1haW5kZXIsXG4gICAgICB0aGlzLmdldExpbmVMZW5ndGgocC55KVxuICAgIClcbiAgKTtcblxuICB0aGlzLnNldENhcmV0KHApO1xuICB0aGlzLm1vdmUubGFzdERlbGliZXJhdGVYID0gcC54O1xuICB0aGlzLm9uTW92ZSgpO1xuXG4gIHJldHVybiBwO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZVVwID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykgdGhpcy5ibHVyKCk7XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURvd24gPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCh0aGlzLmZvY3VzLmJpbmQodGhpcyksIDEwKTtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQpIHRoaXMubWFya0JlZ2luKCk7XG4gIGVsc2UgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0ID0gZnVuY3Rpb24ocCwgY2VudGVyLCBhbmltYXRlKSB7XG4gIHRoaXMuY2FyZXQuc2V0KHApO1xuXG4gIHZhciB0YWJzID0gdGhpcy5nZXRQb2ludFRhYnModGhpcy5jYXJldCk7XG5cbiAgdGhpcy5jYXJldFB4LnNldCh7XG4gICAgeDogdGhpcy5jaGFyLndpZHRoICogKHRoaXMuY2FyZXQueCArIHRhYnMudGFicyAqIHRoaXMudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKSxcbiAgICB5OiB0aGlzLmNoYXIuaGVpZ2h0ICogdGhpcy5jYXJldC55XG4gIH0pO1xuXG4gIHRoaXMuZm9sbG93Q2FyZXQoY2VudGVyLCBhbmltYXRlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VDbGljayA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2xpY2tzID0gdGhpcy5pbnB1dC5tb3VzZS5jbGlja3M7XG4gIGlmIChjbGlja3MgPiAxKSB7XG4gICAgdmFyIGFyZWE7XG5cbiAgICBpZiAoY2xpY2tzID09PSAyKSB7XG4gICAgICBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQpO1xuICAgIH0gZWxzZSBpZiAoY2xpY2tzID09PSAzKSB7XG4gICAgICB2YXIgeSA9IHRoaXMuY2FyZXQueTtcbiAgICAgIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHkgfSxcbiAgICAgICAgZW5kOiB7IHg6IHRoaXMuZ2V0TGluZUxlbmd0aCh5KSwgeTogeSB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5zZXRDYXJldChhcmVhLmVuZCk7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKGFyZWEpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UuZG93bik7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0JlZ2luID0gZnVuY3Rpb24oYXJlYSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gdHJ1ZTtcbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB9IGVsc2UgaWYgKGFyZWEgIT09IGZhbHNlIHx8IHRoaXMubWFyay5iZWdpbi54ID09PSAtMSkge1xuICAgICAgdGhpcy5tYXJrLmJlZ2luLnNldCh0aGlzLmNhcmV0KTtcbiAgICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLm1hcmtCZWdpbihhcmVhKTtcbiAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtDbGVhciA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0ICYmICFmb3JjZSkgcmV0dXJuO1xuXG4gIHRoaXMubWFyay5hY3RpdmUgPSBmYWxzZTtcbiAgdGhpcy5tYXJrLnNldCh7XG4gICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICB9KTtcbiAgdGhpcy5jbGVhcignbWFyaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gUmFuZ2UuY2xhbXAocmFuZ2UsIHRoaXMucGFnZUJvdW5kcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcyA9IHRoaXMuc2Nyb2xsLmNvcHkoKTtcbiAgaWYgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwpIHtcbiAgICBzLnkgLT0gdGhpcy5zaXplLmhlaWdodCAvIDMgfCAwO1xuICB9XG4gIHZhciBwID0gc1snXy8nXSh0aGlzLmNoYXIpO1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDtcbn07XG5cbkphenoucHJvdG90eXBlLmZvbGxvd0NhcmV0ID0gZnVuY3Rpb24oY2VudGVyLCBhbmltYXRlKSB7XG4gIHZhciBwID0gdGhpcy5jYXJldFB4O1xuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHZhciB0b3AgPSAoXG4gICAgICBzLnlcbiAgICArIChjZW50ZXIgJiYgIXRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDIgfCAwKSAtIDEwMCA6IDApXG4gICkgLSBwLnk7XG5cbiAgdmFyIGJvdHRvbSA9IHAueSAtIChcbiAgICAgIHMueVxuICAgICsgdGhpcy5zaXplLmhlaWdodFxuICAgIC0gKGNlbnRlciAmJiAhdGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMiB8IDApIC0gMTAwIDogMClcbiAgICAtICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAzICogMiB8IDApIDogMClcbiAgKSArIHRoaXMuY2hhci5oZWlnaHQ7XG5cbiAgdmFyIGxlZnQgPSAocy54ICsgdGhpcy5jaGFyLndpZHRoKSAtIHAueDtcbiAgdmFyIHJpZ2h0ID0gKHAueCkgLSAocy54ICsgdGhpcy5zaXplLndpZHRoIC0gdGhpcy5tYXJnaW5MZWZ0KSArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgaWYgKGJvdHRvbSA8IDApIGJvdHRvbSA9IDA7XG4gIGlmICh0b3AgPCAwKSB0b3AgPSAwO1xuICBpZiAobGVmdCA8IDApIGxlZnQgPSAwO1xuICBpZiAocmlnaHQgPCAwKSByaWdodCA9IDA7XG5cbiAgaWYgKGxlZnQgKyB0b3AgKyByaWdodCArIGJvdHRvbSkge1xuICAgIHRoaXNbYW5pbWF0ZSA/ICdhbmltYXRlU2Nyb2xsQnknIDogJ3Njcm9sbEJ5J10ocmlnaHQgLSBsZWZ0LCBib3R0b20gLSB0b3AsICdlYXNlJyk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbFRvID0gZnVuY3Rpb24ocCkge1xuICBkb20uc2Nyb2xsVG8odGhpcy5lbCwgcC54LCBwLnkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIHZhciB0YXJnZXQgPSBQb2ludC5sb3coe1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9LCB7XG4gICAgeDogdGhpcy5zY3JvbGwueCArIHgsXG4gICAgeTogdGhpcy5zY3JvbGwueSArIHlcbiAgfSk7XG5cbiAgaWYgKFBvaW50LnNvcnQodGFyZ2V0LCB0aGlzLnNjcm9sbCkgIT09IDApIHtcbiAgICB0aGlzLnNjcm9sbC5zZXQodGFyZ2V0KTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuc2Nyb2xsKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0ZVNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSwgYW5pbWF0aW9uVHlwZSkge1xuICB0aGlzLmFuaW1hdGlvblR5cGUgPSBhbmltYXRpb25UeXBlIHx8ICdsaW5lYXInO1xuXG4gIGlmICghdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgaWYgKCdsaW5lYXInID09PSB0aGlzLmFuaW1hdGlvblR5cGUpIHtcbiAgICAgIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgICB9XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKFxuICAgICAgICAodGhpcy5yb3dzICsgMSkgKiB0aGlzLmNoYXIuaGVpZ2h0IC0gdGhpcy5zaXplLmhlaWdodFxuICAgICAgKyAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzICogMiB8IDAgOiAwKSxcbiAgICAgIE1hdGgubWF4KDAsIHMueSArIHkpXG4gICAgKVxuICB9KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgZHggPSBNYXRoLnNpZ24oZHgpICogNTtcbiAgZHkgPSBNYXRoLnNpZ24oZHkpICogNTtcblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxGcmFtZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc3BlZWQgPSB0aGlzLm9wdGlvbnMuc2Nyb2xsX3NwZWVkO1xuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIHZhciBhZHggPSBNYXRoLmFicyhkeCk7XG4gIHZhciBhZHkgPSBNYXRoLmFicyhkeSk7XG5cbiAgaWYgKGFkeSA+PSB0aGlzLnNpemUuaGVpZ2h0ICogMS4yKSB7XG4gICAgc3BlZWQgKj0gMi40NTtcbiAgfVxuXG4gIGlmICgoYWR4IDwgMSAmJiBhZHkgPCAxKSB8fCAhdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCk7XG4gICAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBudWxsO1xuICAgIHRoaXMuZW1pdCgnYW5pbWF0aW9uIGVuZCcpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIHN3aXRjaCAodGhpcy5hbmltYXRpb25UeXBlKSB7XG4gICAgY2FzZSAnbGluZWFyJzpcbiAgICAgIGlmIChhZHggPCBzcGVlZCkgZHggKj0gMC45O1xuICAgICAgZWxzZSBkeCA9IE1hdGguc2lnbihkeCkgKiBzcGVlZDtcblxuICAgICAgaWYgKGFkeSA8IHNwZWVkKSBkeSAqPSAwLjk7XG4gICAgICBlbHNlIGR5ID0gTWF0aC5zaWduKGR5KSAqIHNwZWVkO1xuXG4gICAgICBicmVhaztcbiAgICBjYXNlICdlYXNlJzpcbiAgICAgIGR4ICo9IDAuNTtcbiAgICAgIGR5ICo9IDAuNTtcbiAgICAgIGJyZWFrO1xuICB9XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24odGV4dCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkgdGhpcy5kZWxldGUoKTtcblxuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHRoaXMuY2FyZXQueSk7XG4gIHZhciByaWdodCA9IGxpbmVbdGhpcy5jYXJldC54XTtcbiAgdmFyIGhhc1JpZ2h0U3ltYm9sID0gflsnfScsJ10nLCcpJ10uaW5kZXhPZihyaWdodCk7XG5cbiAgLy8gYXBwbHkgaW5kZW50IG9uIGVudGVyXG4gIGlmIChORVdMSU5FLnRlc3QodGV4dCkpIHtcbiAgICB2YXIgaXNFbmRPZkxpbmUgPSB0aGlzLmNhcmV0LnggPT09IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgbGVmdCA9IGxpbmVbdGhpcy5jYXJldC54IC0gMV07XG4gICAgdmFyIGluZGVudCA9IGxpbmUubWF0Y2goL1xcUy8pO1xuICAgIGluZGVudCA9IGluZGVudCA/IGluZGVudC5pbmRleCA6IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgaGFzTGVmdFN5bWJvbCA9IH5bJ3snLCdbJywnKCddLmluZGV4T2YobGVmdCk7XG5cbiAgICBpZiAoaGFzTGVmdFN5bWJvbCkgaW5kZW50ICs9IDI7XG5cbiAgICBpZiAoaXNFbmRPZkxpbmUgfHwgaGFzTGVmdFN5bWJvbCkge1xuICAgICAgdGV4dCArPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBsZW5ndGg7XG5cbiAgaWYgKCFoYXNSaWdodFN5bWJvbCB8fCAoaGFzUmlnaHRTeW1ib2wgJiYgIX5bJ30nLCddJywnKSddLmluZGV4T2YodGV4dCkpKSB7XG4gICAgbGVuZ3RoID0gdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsIHRleHQpO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IDE7XG4gIH1cblxuICB0aGlzLm1vdmUuYnlDaGFycyhsZW5ndGgsIHRydWUpO1xuXG4gIGlmICgneycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnfScpO1xuICBlbHNlIGlmICgnKCcgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnKScpO1xuICBlbHNlIGlmICgnWycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXScpO1xuXG4gIGlmIChoYXNMZWZ0U3ltYm9sICYmIGhhc1JpZ2h0U3ltYm9sKSB7XG4gICAgaW5kZW50IC09IDI7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICdcXG4nICsgbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJhY2tzcGFjZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuIHRoaXMuZGVsZXRlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUodHJ1ZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEsIHRydWUpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKHRydWUpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5maW5kSnVtcCA9IGZ1bmN0aW9uKGp1bXApIHtcbiAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCB8fCAhdGhpcy5maW5kLmlzT3BlbikgcmV0dXJuO1xuXG4gIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZE5lZWRsZSArIGp1bXA7XG4gIGlmICh0aGlzLmZpbmROZWVkbGUgPj0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSAwO1xuICB9IGVsc2UgaWYgKHRoaXMuZmluZE5lZWRsZSA8IDApIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCAtIDE7XG4gIH1cblxuICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0LCB0cnVlLCB0cnVlKTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KHRydWUsIHRydWUpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kVmFsdWUgPSBmdW5jdGlvbih2YWx1ZSwgbm9KdW1wKSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5ndXR0ZXIsIHk6IDAgfSk7XG5cbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMuZmluZFZhbHVlID0gdmFsdWU7XG4gIHRoaXMuZmluZFJlc3VsdHMgPSB0aGlzLmJ1ZmZlci5pbmRleGVyLmZpbmQodmFsdWUpLm1hcCgob2Zmc2V0KSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCk7XG4gIH0pO1xuXG4gIGlmICh0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZC5pbmZvKDEgKyB0aGlzLmZpbmROZWVkbGUgKyAnLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG4gIH1cblxuICBpZiAoIW5vSnVtcCkgdGhpcy5maW5kSnVtcCgwKTtcblxuICB0aGlzLnJlbmRlcignZmluZCcpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXIoJ2ZpbmQnKTtcbiAgdGhpcy5mb2N1cygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc3VnZ2VzdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0LCB0cnVlKTtcbiAgaWYgKCFhcmVhKSByZXR1cm47XG5cbiAgdmFyIGtleSA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICBpZiAoIWtleSkgcmV0dXJuO1xuXG4gIGlmICghdGhpcy5zdWdnZXN0Um9vdFxuICAgIHx8IGtleS5zdWJzdHIoMCwgdGhpcy5zdWdnZXN0Um9vdC5sZW5ndGgpICE9PSB0aGlzLnN1Z2dlc3RSb290KSB7XG4gICAgdGhpcy5zdWdnZXN0SW5kZXggPSAwO1xuICAgIHRoaXMuc3VnZ2VzdFJvb3QgPSBrZXk7XG4gICAgdGhpcy5zdWdnZXN0Tm9kZXMgPSB0aGlzLmJ1ZmZlci5wcmVmaXguY29sbGVjdChrZXkpO1xuICB9XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGgpIHJldHVybjtcbiAgdmFyIG5vZGUgPSB0aGlzLnN1Z2dlc3ROb2Rlc1t0aGlzLnN1Z2dlc3RJbmRleF07XG5cbiAgdGhpcy5zdWdnZXN0SW5kZXggPSAodGhpcy5zdWdnZXN0SW5kZXggKyAxKSAlIHRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aDtcblxuICByZXR1cm4ge1xuICAgIGFyZWE6IGFyZWEsXG4gICAgbm9kZTogbm9kZVxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UG9pbnRUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyICsgdGFic1xuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0Q29vcmRzVGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFicyAqIHRoaXMudGFiU2l6ZSArIHJlbWFpbmRlciA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXJcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlcGFpbnQgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2l6ZSgpO1xuICB0aGlzLnZpZXdzLnJlbmRlcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgJCA9IHRoaXMuZWw7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgLiR7Y3NzLnJvd3N9LFxuICAgIC4ke2Nzcy5tYXJrfSxcbiAgICAuJHtjc3MuY29kZX0sXG4gICAgbWFyayxcbiAgICBwLFxuICAgIHQsXG4gICAgayxcbiAgICBkLFxuICAgIG4sXG4gICAgbyxcbiAgICBlLFxuICAgIG0sXG4gICAgZixcbiAgICByLFxuICAgIGMsXG4gICAgcyxcbiAgICBsLFxuICAgIHgge1xuICAgICAgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTtcbiAgICAgIGZvbnQtc2l6ZTogJHt0aGlzLm9wdGlvbnMuZm9udF9zaXplfTtcbiAgICAgIGxpbmUtaGVpZ2h0OiAke3RoaXMub3B0aW9ucy5saW5lX2hlaWdodH07XG4gICAgfVxuICAgIGBcbiAgKTtcblxuICB0aGlzLm9mZnNldC5zZXQoZG9tLmdldE9mZnNldCgkKSk7XG4gIHRoaXMuc2Nyb2xsLnNldChkb20uZ2V0U2Nyb2xsKCQpKTtcbiAgdGhpcy5zaXplLnNldChkb20uZ2V0U2l6ZSgkKSk7XG5cbiAgLy8gdGhpcyBpcyBhIHdlaXJkIGZpeCB3aGVuIGRvaW5nIG11bHRpcGxlIC51c2UoKVxuICBpZiAodGhpcy5jaGFyLndpZHRoID09PSAwKSB0aGlzLmNoYXIuc2V0KGRvbS5nZXRDaGFyU2l6ZSgkLCBjc3MuY29kZSkpO1xuXG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWydfKiddKHRoaXMuY2hhcikpKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG4gIC8vIHRoaXMubG9uZ2VzdExpbmUgPSBNYXRoLm1pbig1MDAsIHRoaXMuYnVmZmVyLmxpbmVzLmdldExvbmdlc3RMaW5lTGVuZ3RoKCkpO1xuXG4gIHRoaXMuZ3V0dGVyID0gTWF0aC5tYXgoXG4gICAgdGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgKHRoaXMub3B0aW9ucy5jZW50ZXJfaG9yaXpvbnRhbFxuICAgICAgPyBNYXRoLm1heChcbiAgICAgICAgICAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgICAgICAgKCB0aGlzLnBhZ2Uud2lkdGggLSA4MVxuICAgICAgICAgIC0gKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoKVxuICAgICAgICAgICkgLyAyIHwgMFxuICAgICAgICApIDogMClcbiAgICArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6IE1hdGgubWF4KDMsICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpXG4gICkgKiB0aGlzLmNoYXIud2lkdGhcbiAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93c1xuICAgICAgPyAwXG4gICAgICA6IHRoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2luICogKHRoaXMub3B0aW9ucy5jZW50ZXJfaG9yaXpvbnRhbCA/IC0xIDogMSlcbiAgICApO1xuXG4gIHRoaXMubWFyZ2luTGVmdCA9IHRoaXMuZ3V0dGVyICsgdGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0O1xuXG4gIC8vIGRvbS5zdHlsZSh0aGlzLmVsLCB7XG4gIC8vICAgd2lkdGg6IHRoaXMubG9uZ2VzdExpbmUgKiB0aGlzLmNoYXIud2lkdGgsXG4gIC8vICAgaGVpZ2h0OiB0aGlzLnJvd3MgKiB0aGlzLmNoYXIuaGVpZ2h0XG4gIC8vIH0pO1xuXG4gIC8vVE9ETzogbWFrZSBtZXRob2QvdXRpbFxuICAvLyBkcmF3IGluZGVudCBpbWFnZVxuICB2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHZhciBmb28gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9vJyk7XG4gIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICBjYW52YXMuc2V0QXR0cmlidXRlKCd3aWR0aCcsIE1hdGguY2VpbCh0aGlzLmNoYXIud2lkdGggKiAyKSk7XG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ2hlaWdodCcsIHRoaXMuY2hhci5oZWlnaHQpO1xuXG4gIHZhciBjb21tZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYycpO1xuICAkLmFwcGVuZENoaWxkKGNvbW1lbnQpO1xuICB2YXIgY29sb3IgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShjb21tZW50KS5jb2xvcjtcbiAgJC5yZW1vdmVDaGlsZChjb21tZW50KTtcbiAgY3R4LnNldExpbmVEYXNoKFsxLDFdKTtcbiAgY3R4LmxpbmVEYXNoT2Zmc2V0ID0gMDtcbiAgY3R4LmJlZ2luUGF0aCgpO1xuICBjdHgubW92ZVRvKDAsMSk7XG4gIGN0eC5saW5lVG8oMCwgdGhpcy5jaGFyLmhlaWdodCk7XG4gIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICBjdHguc3Ryb2tlKCk7XG5cbiAgdmFyIGRhdGFVUkwgPSBjYW52YXMudG9EYXRhVVJMKCk7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgIyR7dGhpcy5pZH0ge1xuICAgICAgdG9wOiAke3RoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyB0aGlzLnNpemUuaGVpZ2h0IC8gMyA6IDB9cHg7XG4gICAgfVxuXG4gICAgLiR7Y3NzLnJvd3N9LFxuICAgIC4ke2Nzcy5tYXJrfSxcbiAgICAuJHtjc3MuY29kZX0sXG4gICAgbWFyayxcbiAgICBwLFxuICAgIHQsXG4gICAgayxcbiAgICBkLFxuICAgIG4sXG4gICAgbyxcbiAgICBlLFxuICAgIG0sXG4gICAgZixcbiAgICByLFxuICAgIGMsXG4gICAgcyxcbiAgICBsLFxuICAgIHgge1xuICAgICAgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTtcbiAgICAgIGZvbnQtc2l6ZTogJHt0aGlzLm9wdGlvbnMuZm9udF9zaXplfTtcbiAgICAgIGxpbmUtaGVpZ2h0OiAke3RoaXMub3B0aW9ucy5saW5lX2hlaWdodH07XG4gICAgfVxuXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MucnVsZXJ9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmZpbmR9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLm1hcmt9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmNvZGV9IHtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJvd3N9IHtcbiAgICAgIHBhZGRpbmctcmlnaHQ6ICR7dGhpcy5vcHRpb25zLmd1dHRlcl9tYXJnaW59cHg7XG4gICAgICBwYWRkaW5nLWxlZnQ6ICR7dGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0fXB4O1xuICAgICAgd2lkdGg6ICR7dGhpcy5tYXJnaW5MZWZ0fXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5maW5kfSA+IGksXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuYmxvY2t9ID4gaSB7XG4gICAgICBoZWlnaHQ6ICR7dGhpcy5jaGFyLmhlaWdodCArIDF9cHg7XG4gICAgfVxuICAgIHgge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLnZpZXdzW25hbWVdLmNsZWFyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbihuYW1lKSB7XG4gIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmVuZGVyUmVxdWVzdCk7XG4gIGlmICghfnRoaXMucmVuZGVyUXVldWUuaW5kZXhPZihuYW1lKSkge1xuICAgIGlmIChuYW1lIGluIHRoaXMudmlld3MpIHtcbiAgICAgIHRoaXMucmVuZGVyUXVldWUucHVzaChuYW1lKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJSZXF1ZXN0ID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuX3JlbmRlci5iaW5kKHRoaXMpKTtcbn07XG5cbkphenoucHJvdG90eXBlLl9yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXJRdWV1ZS5mb3JFYWNoKG5hbWUgPT4gdGhpcy52aWV3c1tuYW1lXS5yZW5kZXIoKSk7XG4gIHRoaXMucmVuZGVyUXVldWUgPSBbXTtcbn07XG5cbi8vIHRoaXMgaXMgdXNlZCBmb3IgZGV2ZWxvcG1lbnQgZGVidWcgcHVycG9zZXNcbmZ1bmN0aW9uIGJpbmRDYWxsU2l0ZShmbikge1xuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIHZhciBlcnIgPSBuZXcgRXJyb3I7XG4gICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UoZXJyLCBhcmd1bWVudHMuY2FsbGVlKTtcbiAgICB2YXIgc3RhY2sgPSBlcnIuc3RhY2s7XG4gICAgY29uc29sZS5sb2coc3RhY2spO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYywgZCk7XG4gIH07XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gJycgKyBhLmJlZ2luICsgJy0nICsgYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGJpbmFyeVNlYXJjaDtcblxuZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFycmF5LCBjb21wYXJlKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgbG93ID0gMDtcbiAgdmFyIGhpZ2ggPSBhcnJheS5sZW5ndGg7XG4gIGlmICghaGlnaCkgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiAwXG4gIH07XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpbmRleDtcbiAgICBpbmRleCA9IGxvdyArIChoaWdoIC0gbG93ID4+IDEpO1xuICAgIHZhciBpdGVtID0gYXJyYXlbaW5kZXhdO1xuICAgIHZhciByZXN1bHQgPSBjb21wYXJlKGl0ZW0pO1xuXG4gICAgaWYgKHJlc3VsdCkgbG93ID0gaW5kZXg7XG4gICAgZWxzZSBoaWdoID0gaW5kZXg7XG4gIH0gd2hpbGUgKHByZXYgIT09IGluZGV4KTtcblxuICBpZiAoaXRlbSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICBpbmRleDogaW5kZXhcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiB+bG93ICogLTEgLSAxXG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuICByZXR1cm4gZnVuY3Rpb24gcmFmV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKHJlcXVlc3QpO1xuICAgIHJlcXVlc3QgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCkpO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfLyddID1cbkJveC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXi8nXSA9XG5Cb3gucHJvdG90eXBlLmNlaWxkaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWycqJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydvKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGgucm91bmQodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLnJvdW5kKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJy0nXSA9XG5Cb3gucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC0gKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjbG9uZShvYmopIHtcbiAgdmFyIG8gPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHZhciB2YWwgPSBvYmpba2V5XTtcbiAgICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiB2YWwpIHtcbiAgICAgIG9ba2V5XSA9IGNsb25lKHZhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ba2V5XSA9IHZhbDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG87XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24gZGVib3VuY2VXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgdGltZW91dCA9IHNldFRpbWVvdXQoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSwgbXMpO1xuICAgIHJldHVybiB0aW1lb3V0O1xuICB9XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vZXZlbnQnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpYWxvZztcblxuZnVuY3Rpb24gRGlhbG9nKGxhYmVsLCBrZXltYXApIHtcbiAgdGhpcy5ub2RlID0gZG9tKGNzcy5kaWFsb2csIFtcbiAgICBgPGxhYmVsPiR7Y3NzLmxhYmVsfWAsXG4gICAgW2Nzcy5pbnB1dCwgW1xuICAgICAgYDxpbnB1dD4ke2Nzcy50ZXh0fWAsXG4gICAgICBjc3MuaW5mb1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmxhYmVsXSwgbGFiZWwpO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25jbGljayA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNlZG93biA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbn1cblxuRGlhbG9nLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbmZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbihlKSB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmhhc0ZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgZG9tLmFwcGVuZChkb2N1bWVudC5ib2R5LCB0aGlzLm5vZGUpO1xuICBkb20uZm9jdXModGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmluZm8gPSBmdW5jdGlvbihpbmZvKSB7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgaW5mbyk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJkaWFsb2dcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19kaWFsb2dcIixcImlucHV0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5wdXRcIixcInRleHRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX190ZXh0XCIsXCJsYWJlbFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2xhYmVsXCIsXCJpbmZvXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5mb1wifSIsIlxubW9kdWxlLmV4cG9ydHMgPSBkaWZmO1xuXG5mdW5jdGlvbiBkaWZmKGEsIGIpIHtcbiAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgYSkge1xuICAgIHZhciBkID0ge307XG4gICAgdmFyIGkgPSAwO1xuICAgIGZvciAodmFyIGsgaW4gYikge1xuICAgICAgaWYgKGFba10gIT09IGJba10pIHtcbiAgICAgICAgZFtrXSA9IGJba107XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGkpIHJldHVybiBkO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhICE9PSBiO1xuICB9XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vYmluZC1yYWYnKTtcbnZhciBtZW1vaXplID0gcmVxdWlyZSgnLi9tZW1vaXplJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWUuc3BsaXQoJyAnKVswXVxuICAgIH07XG4gICAgZG9tLmNsYXNzZXMobm9kZSwgbmFtZS5zcGxpdCgnICcpLnNsaWNlKDEpKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIGlmIChzdHlsZVtuYW1lXSAhPT0gJ2F1dG8nKVxuICAgICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufSwgZGlmZiwgbWVyZ2UsIGZ1bmN0aW9uKG5vZGUsIHN0eWxlKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBzdHlsZV07XG59KTtcblxuLypcbmRvbS5zdHlsZSA9IGZ1bmN0aW9uKGVsLCBzdHlsZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59O1xuKi9cbmRvbS5jbGFzc2VzID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbn0sIG51bGwsIG51bGwsIGZ1bmN0aW9uKG5vZGUsIGNsYXNzZXMpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIGNsYXNzZXMuY29uY2F0KG5vZGUubmFtZSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKV07XG59KTtcblxuZG9tLmF0dHJzID0gZnVuY3Rpb24oZWwsIGF0dHJzKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBPYmplY3QuYXNzaWduKGVsLCBhdHRycyk7XG59O1xuXG5kb20uaHRtbCA9IGZ1bmN0aW9uKGVsLCBodG1sKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZG9tLnRleHQgPSBmdW5jdGlvbihlbCwgdGV4dCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xufTtcblxuZG9tLmZvY3VzID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmZvY3VzKCk7XG59O1xuXG5kb20uZ2V0U2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlbC5jbGllbnRXaWR0aCxcbiAgICBoZWlnaHQ6IGVsLmNsaWVudEhlaWdodFxuICB9O1xufTtcblxuZG9tLmdldENoYXJTaXplID0gZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHNwYW4uY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuXG4gIGVsLmFwcGVuZENoaWxkKHNwYW4pO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAnO1xuICB2YXIgYSA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICBcXG4gJztcbiAgdmFyIGIgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIGVsLnJlbW92ZUNoaWxkKHNwYW4pO1xuXG4gIHJldHVybiB7XG4gICAgd2lkdGg6IChiLndpZHRoIC0gYS53aWR0aCksXG4gICAgaGVpZ2h0OiAoYi5oZWlnaHQgLSBhLmhlaWdodClcbiAgfTtcbn07XG5cbmRvbS5nZXRPZmZzZXQgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpO1xuICB2YXIgYm9yZGVyTGVmdCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlckxlZnRXaWR0aCk7XG4gIHZhciBib3JkZXJUb3AgPSBwYXJzZUludChzdHlsZS5ib3JkZXJUb3BXaWR0aCk7XG4gIHJldHVybiBQb2ludC5sb3coeyB4OiAwLCB5OiAwIH0sIHtcbiAgICB4OiAocmVjdC5sZWZ0ICsgYm9yZGVyTGVmdCkgfCAwLFxuICAgIHk6IChyZWN0LnRvcCArIGJvcmRlclRvcCkgfCAwXG4gIH0pO1xufTtcblxuZG9tLmdldFNjcm9sbCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4gZ2V0U2Nyb2xsKGVsKTtcbn07XG5cbmRvbS5vbnNjcm9sbCA9IGZ1bmN0aW9uIG9uc2Nyb2xsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZzY3JvbGwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20ucmVtb3ZlID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChlbC5wYXJlbnROb2RlKSBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKTtcbn07XG5cbmRvbS5nZXRFbGVtZW50ID0gZnVuY3Rpb24oZWwpIHtcbiAgcmV0dXJuIGVsLmRvbSAmJiBlbC5kb20uZWwgfHwgZWwuZWwgfHwgZWwubm9kZSB8fCBlbDtcbn07XG5cbmRvbS5zY3JvbGxCeSA9IGZ1bmN0aW9uKGVsLCB4LCB5LCBzY3JvbGwpIHtcbiAgc2Nyb2xsID0gc2Nyb2xsIHx8IGRvbS5nZXRTY3JvbGwoZWwpO1xuICBkb20uc2Nyb2xsVG8oZWwsIHNjcm9sbC54ICsgeCwgc2Nyb2xsLnkgKyB5KTtcbn07XG5cbmRvbS5zY3JvbGxUbyA9IGZ1bmN0aW9uKGVsLCB4LCB5KSB7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIHdpbmRvdy5zY3JvbGxUbyh4LCB5KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5zY3JvbGxMZWZ0ID0geCB8fCAwO1xuICAgIGVsLnNjcm9sbFRvcCA9IHkgfHwgMDtcbiAgfVxufTtcblxuZG9tLmNzcyA9IGZ1bmN0aW9uKGlkLCBjc3NUZXh0KSB7XG4gIGlmICghKGlkIGluIGRvbS5jc3Muc3R5bGVzKSkge1xuICAgIGRvbS5jc3Muc3R5bGVzW2lkXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlc1tpZF0pO1xuICB9XG4gIGRvbS5jc3Muc3R5bGVzW2lkXS50ZXh0Q29udGVudCA9IGNzc1RleHQ7XG59O1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFBvaW50O1xuXG5mdW5jdGlvbiBQb2ludChwKSB7XG4gIGlmIChwKSB7XG4gICAgdGhpcy54ID0gcC54O1xuICAgIHRoaXMueSA9IHAueTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gIH1cbn1cblxuUG9pbnQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy54ID0gcC54O1xuICB0aGlzLnkgPSBwLnk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFBvaW50KHRoaXMpO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28vJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXi8nXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycrJ10gPVxuUG9pbnQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSArIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy0nXSA9XG5Qb2ludC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLSAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC0gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKiddID1cblBvaW50LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeKiddID1cblBvaW50LnByb3RvdHlwZS5jZWlsTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXyonXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICd4OicgKyB0aGlzLnggKyAnLHk6JyArIHRoaXMueTtcbn07XG5cblBvaW50LnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5Qb2ludC5ncmlkUm91bmQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5yb3VuZChhLnggLyBiLndpZHRoKSxcbiAgICB5OiBNYXRoLnJvdW5kKGEueSAvIGIuaGVpZ2h0KVxuICB9O1xufTtcblxuUG9pbnQubG93ID0gZnVuY3Rpb24obG93LCBwKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5tYXgobG93LngsIHAueCksXG4gICAgeTogTWF0aC5tYXgobG93LnksIHAueSlcbiAgfTtcbn07XG5cblBvaW50LmNsYW1wID0gZnVuY3Rpb24oYXJlYSwgcCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfSk7XG59O1xuXG5Qb2ludC5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7IHg6IGEueCArIGIueCwgeTogYS55ICsgYi55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRYID0gZnVuY3Rpb24oeCwgcCkge1xuICByZXR1cm4geyB4OiBwLnggKyB4LCB5OiBwLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFkgPSBmdW5jdGlvbih5LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCwgeTogcC55ICsgeSB9O1xufTtcblxuUG9pbnQudG9MZWZ0VG9wID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHAueCxcbiAgICB0b3A6IHAueVxuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBBTkQ7XG5cbmZ1bmN0aW9uIEFORChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBOT1Q7XG5cbmZ1bmN0aW9uIE5PVChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJ2YXIgQU5EID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLWFuZCcpO1xudmFyIE5PVCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1ub3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSYW5nZTtcblxuZnVuY3Rpb24gUmFuZ2Uocikge1xuICBpZiAocikge1xuICAgIHRoaXNbMF0gPSByWzBdO1xuICAgIHRoaXNbMV0gPSByWzFdO1xuICB9IGVsc2Uge1xuICAgIHRoaXNbMF0gPSAwO1xuICAgIHRoaXNbMV0gPSAxO1xuICB9XG59O1xuXG5SYW5nZS5BTkQgPSBBTkQ7XG5SYW5nZS5OT1QgPSBOT1Q7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZSh0aGlzKTtcbn07XG5cblJhbmdlLnJhbmdlcyA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHJldHVybiBpdGVtcy5tYXAoZnVuY3Rpb24oaXRlbSkgeyByZXR1cm4gaXRlbS5yYW5nZSB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA+PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdIDw9IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdmVybGFwID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPD0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA+PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzFdIDwgcmFuZ2VbMF0gfHwgaXRlbS5yYW5nZVswXSA+IHJhbmdlWzFdO1xuICB9KTtcbn07XG4iLCJcbnZhciBSZWdleHAgPSBleHBvcnRzO1xuXG5SZWdleHAuY3JlYXRlID0gZnVuY3Rpb24obmFtZXMsIGZsYWdzLCBmbikge1xuICBmbiA9IGZuIHx8IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMgfTtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgbmFtZXNcbiAgICAubWFwKChuKSA9PiAnc3RyaW5nJyA9PT0gdHlwZW9mIG4gPyBSZWdleHAudHlwZXNbbl0gOiBuKVxuICAgIC5tYXAoKHIpID0+IGZuKHIudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkpXG4gICAgLmpvaW4oJ3wnKSxcbiAgICBmbGFnc1xuICApO1xufTtcblxuUmVnZXhwLnR5cGVzID0ge1xuICAndG9rZW5zJzogLy4rP1xcYnwuXFxCfFxcYi4rPy8sXG4gICd3b3Jkcyc6IC9bYS16QS1aMC05XXsxLH0vLFxuICAncGFydHMnOiAvWy4vXFxcXFxcKFxcKVwiJ1xcLTosLjs8Pn4hQCMkJV4mKlxcfFxcKz1cXFtcXF17fWB+XFw/IF0rLyxcblxuICAnc2luZ2xlIGNvbW1lbnQnOiAvXFwvXFwvLio/JC8sXG4gICdkb3VibGUgY29tbWVudCc6IC9cXC9cXCpbXl0qP1xcKlxcLy8sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogLygnKD86KD86XFxcXFxcbnxcXFxcJ3xbXidcXG5dKSkqPycpLyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiAvKFwiKD86KD86XFxcXFxcbnxcXFxcXCJ8W15cIlxcbl0pKSo/XCIpLyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IC8oYCg/Oig/OlxcXFxgfFteYF0pKSo/YCkvLFxuXG4gICdvcGVyYXRvcic6IC8hfD49P3w8PT98PXsxLDN9fCg/OiYpezEsMn18XFx8P1xcfHxcXD98XFwqfFxcL3x+fFxcXnwlfFxcLig/IVxcZCl8XFwrezEsMn18XFwtezEsMn0vLFxuICAnZnVuY3Rpb24nOiAvICgoPyFcXGR8Wy4gXSo/KGlmfGVsc2V8ZG98Zm9yfGNhc2V8dHJ5fGNhdGNofHdoaWxlfHdpdGh8c3dpdGNoKSlbYS16QS1aMC05XyAkXSspKD89XFwoLipcXCkuKnspLyxcbiAgJ2tleXdvcmQnOiAvXFxiKGJyZWFrfGNhc2V8Y2F0Y2h8Y29uc3R8Y29udGludWV8ZGVidWdnZXJ8ZGVmYXVsdHxkZWxldGV8ZG98ZWxzZXxleHBvcnR8ZXh0ZW5kc3xmaW5hbGx5fGZvcnxmcm9tfGlmfGltcGxlbWVudHN8aW1wb3J0fGlufGluc3RhbmNlb2Z8aW50ZXJmYWNlfGxldHxuZXd8cGFja2FnZXxwcml2YXRlfHByb3RlY3RlZHxwdWJsaWN8cmV0dXJufHN0YXRpY3xzdXBlcnxzd2l0Y2h8dGhyb3d8dHJ5fHR5cGVvZnx3aGlsZXx3aXRofHlpZWxkKVxcYi8sXG4gICdkZWNsYXJlJzogL1xcYihmdW5jdGlvbnxpbnRlcmZhY2V8Y2xhc3N8dmFyfGxldHxjb25zdHxlbnVtfHZvaWQpXFxiLyxcbiAgJ2J1aWx0aW4nOiAvXFxiKE9iamVjdHxGdW5jdGlvbnxCb29sZWFufEVycm9yfEV2YWxFcnJvcnxJbnRlcm5hbEVycm9yfFJhbmdlRXJyb3J8UmVmZXJlbmNlRXJyb3J8U3RvcEl0ZXJhdGlvbnxTeW50YXhFcnJvcnxUeXBlRXJyb3J8VVJJRXJyb3J8TnVtYmVyfE1hdGh8RGF0ZXxTdHJpbmd8UmVnRXhwfEFycmF5fEZsb2F0MzJBcnJheXxGbG9hdDY0QXJyYXl8SW50MTZBcnJheXxJbnQzMkFycmF5fEludDhBcnJheXxVaW50MTZBcnJheXxVaW50MzJBcnJheXxVaW50OEFycmF5fFVpbnQ4Q2xhbXBlZEFycmF5fEFycmF5QnVmZmVyfERhdGFWaWV3fEpTT058SW50bHxhcmd1bWVudHN8Y29uc29sZXx3aW5kb3d8ZG9jdW1lbnR8U3ltYm9sfFNldHxNYXB8V2Vha1NldHxXZWFrTWFwfFByb3h5fFJlZmxlY3R8UHJvbWlzZSlcXGIvLFxuICAnc3BlY2lhbCc6IC9cXGIodHJ1ZXxmYWxzZXxudWxsfHVuZGVmaW5lZClcXGIvLFxuICAncGFyYW1zJzogL2Z1bmN0aW9uWyBcXChdezF9W15dKj9cXHsvLFxuICAnbnVtYmVyJzogLy0/XFxiKDB4W1xcZEEtRmEtZl0rfFxcZCpcXC4/XFxkKyhbRWVdWystXT9cXGQrKT98TmFOfC0/SW5maW5pdHkpXFxiLyxcbiAgJ3N5bWJvbCc6IC9be31bXFxdKCksOl0vLFxuICAncmVnZXhwJzogLyg/IVteXFwvXSkoXFwvKD8hW1xcL3xcXCpdKS4qP1teXFxcXFxcXl1cXC8pKFs7XFxuXFwuXFwpXFxdXFx9IGdpbV0pLyxcblxuICAneG1sJzogLzxbXj5dKj4vLFxuICAndXJsJzogLygoXFx3KzpcXC9cXC8pWy1hLXpBLVowLTk6QDs/Jj1cXC8lXFwrXFwuXFwqISdcXChcXCksXFwkX1xce1xcfVxcXn5cXFtcXF1gI3xdKykvLFxuICAnaW5kZW50JzogL14gK3xeXFx0Ky8sXG4gICdsaW5lJzogL14uKyR8Xlxcbi8sXG4gICduZXdsaW5lJzogL1xcclxcbnxcXHJ8XFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJ2YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcblxudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLnNldFRleHQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS51cGRhdGVSYXcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yYXcgPSB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnVwZGF0ZVJhdygpO1xuICB2YXIgYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgYnVmZmVyLnJlcGxhY2UodGhpcyk7XG4gIHJldHVybiBidWZmZXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihkYXRhKSB7XG4gIHRoaXMucmF3ID0gZGF0YS5yYXc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuICB0aGlzLnRva2VucyA9IGRhdGEudG9rZW5zLmNvcHkoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKCk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnNldFRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdGhpcy5yYXcgPSB0ZXh0IC8vdGhpcy5zeW50YXguaGlnaGxpZ2h0KHRleHQpO1xuXG4gIHRoaXMuc3ludGF4LnRhYiA9IH50aGlzLnJhdy5pbmRleE9mKCdcXHQnKSA/ICdcXHQnIDogJyAnO1xuXG4gIHRoaXMudGV4dCA9IG5ldyBTa2lwU3RyaW5nO1xuICB0aGlzLnRleHQuc2V0KHRoaXMucmF3KTtcblxuICB0aGlzLnRva2VucyA9IG5ldyBUb2tlbnM7XG4gIHRoaXMudG9rZW5zLmluZGV4KHRoaXMucmF3KTtcbiAgdGhpcy50b2tlbnMub24oJ2NoYW5nZSBzZWdtZW50cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2Ugc2VnbWVudHMnKSk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIC8vIHRoaXMuZW1pdCgncmF3JywgdGhpcy5yYXcpO1xuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnQgPVxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnRUZXh0QXRQb2ludCA9IGZ1bmN0aW9uKHAsIHRleHQsIG5vTG9nKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdmFyIGxlbmd0aCA9IHRleHQubGVuZ3RoO1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgc2hpZnQgPSAodGV4dC5tYXRjaChORVdMSU5FKSB8fCBbXSkubGVuZ3RoO1xuICB2YXIgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIHNoaWZ0XTtcbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcblxuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG4gIG9mZnNldFJhbmdlWzFdICs9IHRleHQubGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vTG9nKSB7XG4gICAgdmFyIGxhc3RMb2cgPSB0aGlzLmxvZ1t0aGlzLmxvZy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExvZyAmJiBsYXN0TG9nWzBdID09PSAnaW5zZXJ0JyAmJiBsYXN0TG9nWzFdWzFdID09PSBwb2ludC5vZmZzZXQpIHtcbiAgICAgIGxhc3RMb2dbMV1bMV0gKz0gdGV4dC5sZW5ndGg7XG4gICAgICBsYXN0TG9nWzJdICs9IHRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nLnB1c2goWydpbnNlcnQnLCBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQgKyB0ZXh0Lmxlbmd0aF0sIHRleHRdKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG5cbiAgcmV0dXJuIHRleHQubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmUgPVxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKG8sIG5vTG9nKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdvZmZzZXRzJywgbylcbiAgdmFyIGEgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMF0pO1xuICB2YXIgYiA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1sxXSk7XG4gIHZhciBsZW5ndGggPSBvWzBdIC0gb1sxXTtcbiAgdmFyIHJhbmdlID0gW2EueSwgYi55XTtcbiAgdmFyIHNoaWZ0ID0gYS55IC0gYi55O1xuICAvLyBjb25zb2xlLmxvZyhhLGIpXG5cbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGJlZm9yZSA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uobyk7XG4gIHRoaXMudGV4dC5yZW1vdmUobyk7XG4gIG9mZnNldFJhbmdlWzFdICs9IGxlbmd0aDtcbiAgdmFyIGFmdGVyID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgaWYgKCFub0xvZykge1xuICAgIHZhciBsYXN0TG9nID0gdGhpcy5sb2dbdGhpcy5sb2cubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxhc3RMb2cgJiYgbGFzdExvZ1swXSA9PT0gJ3JlbW92ZScgJiYgbGFzdExvZ1sxXVswXSA9PT0gb1sxXSkge1xuICAgICAgbGFzdExvZ1sxXVswXSAtPSB0ZXh0Lmxlbmd0aDtcbiAgICAgIGxhc3RMb2dbMl0gPSB0ZXh0ICsgbGFzdExvZ1syXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cucHVzaChbJ3JlbW92ZScsIG8sIHRleHRdKTtcbiAgICB9XG4gIH1cblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldHMpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVDaGFyQXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIG9mZnNldFJhbmdlID0gW3BvaW50Lm9mZnNldCwgcG9pbnQub2Zmc2V0KzFdO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBjb2RlID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KHJhbmdlKTtcblxuICAvLyBjYWxjdWxhdGUgaW5kZW50IGZvciBgY29kZWBcbiAgLy9UT0RPOiBtb3ZlIHRvIG1ldGhvZFxuICB2YXIgbGFzdCA9IGNvZGUuc2xpY2UoY29kZS5sYXN0SW5kZXhPZignXFxuJykpO1xuICB2YXIgQW55Q2hhciA9IC9cXFMvZztcbiAgdmFyIHkgPSByYW5nZVsxXTtcbiAgdmFyIG1hdGNoID0gQW55Q2hhci5leGVjKGxhc3QpO1xuICB3aGlsZSAoIW1hdGNoICYmIHkgPCB0aGlzLmxvYygpKSB7XG4gICAgdmFyIGFmdGVyID0gdGhpcy5nZXRMaW5lVGV4dCgrK3kpO1xuICAgIEFueUNoYXIubGFzdEluZGV4ID0gMDtcbiAgICBtYXRjaCA9IEFueUNoYXIuZXhlYyhhZnRlcik7XG4gIH1cbiAgdmFyIGluZGVudCA9IDA7XG4gIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gIHZhciBpbmRlbnRUZXh0ID0gJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnN5bnRheC50YWIpO1xuXG4gIHZhciBzZWdtZW50ID0gdGhpcy5zZWdtZW50cy5nZXQocmFuZ2VbMF0pO1xuICBpZiAoc2VnbWVudCkge1xuICAgIGNvZGUgPSBTRUdNRU5UW3NlZ21lbnRdICsgJ1xcdWZmYmFcXG4nICsgY29kZSArIGluZGVudFRleHQgKyAnXFx1ZmZiZSovYCdcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUpO1xuICAgIGNvZGUgPSAnPCcgKyBzZWdtZW50WzBdICsgJz4nICtcbiAgICAgIGNvZGUuc3Vic3RyaW5nKFxuICAgICAgICBjb2RlLmluZGV4T2YoJ1xcdWZmYmEnKSArIDIsXG4gICAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUgKyBpbmRlbnRUZXh0ICsgJ1xcdWZmYmUqL2AnKTtcbiAgICBjb2RlID0gY29kZS5zdWJzdHJpbmcoMCwgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIGxpbmUgPSBuZXcgTGluZTtcbiAgbGluZS5vZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhbeSx5XSk7XG4gIGxpbmUub2Zmc2V0ID0gbGluZS5vZmZzZXRSYW5nZVswXTtcbiAgbGluZS5sZW5ndGggPSBsaW5lLm9mZnNldFJhbmdlWzFdIC0gbGluZS5vZmZzZXRSYW5nZVswXSAtICh5IDwgdGhpcy5sb2MoKSk7XG4gIGxpbmUucG9pbnQuc2V0KHsgeDowLCB5OnkgfSk7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocC55KTtcbiAgdmFyIHBvaW50ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihsaW5lLmxlbmd0aCwgcC54KSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfSk7XG4gIHBvaW50Lm9mZnNldCA9IGxpbmUub2Zmc2V0ICsgcG9pbnQueDtcbiAgcG9pbnQucG9pbnQgPSBwb2ludDtcbiAgcG9pbnQubGluZSA9IGxpbmU7XG4gIHJldHVybiBwb2ludDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlVGV4dCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VPZmZzZXRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHJhbmdlWzFdID49IHRoaXMubG9jKClcbiAgICA/IHRoaXMudGV4dC5sZW5ndGhcbiAgICA6IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVsxXSArIDEpO1xuICB2YXIgb2Zmc2V0cyA9IFthLCBiXTtcbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFJhbmdlVGV4dCA9IGZ1bmN0aW9uKG9mZnNldFJhbmdlKSB7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldFJhbmdlKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciB0b2tlbiA9IHRoaXMudG9rZW5zLmdldEJ5T2Zmc2V0KCdsaW5lcycsIG9mZnNldCAtIC41KTtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogb2Zmc2V0IC0gKG9mZnNldCA+IHRva2VuLm9mZnNldCA/IHRva2VuLm9mZnNldCArICghIXRva2VuLnBhcnQubGVuZ3RoKSA6IDApLFxuICAgIHk6IE1hdGgubWluKHRoaXMubG9jKCksIHRva2VuLmluZGV4IC0gKHRva2VuLm9mZnNldCArIDEgPiBvZmZzZXQpICsgMSlcbiAgfSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgY2hhciA9IHRoaXMudGV4dC5nZXRSYW5nZShbb2Zmc2V0LCBvZmZzZXQgKyAxXSk7XG4gIHJldHVybiBjaGFyO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4ge1xuICAgIGxpbmU6IGxpbmUsXG4gICAgdGV4dDogdGV4dCxcbiAgfVxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHRleHQgPSB0aGlzLmdldExpbmVSYW5nZVRleHQoW3kseV0pO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYVRleHQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUud29yZEFyZWFBdFBvaW50ID0gZnVuY3Rpb24ocCwgaW5jbHVzaXZlKSB7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKHBvaW50LmxpbmUub2Zmc2V0UmFuZ2UpO1xuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHBvaW50LnkgfSxcbiAgICAgIGVuZDogeyB4OiBwb2ludC5saW5lLmxlbmd0aCwgeTogcG9pbnQueSB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFyZWE7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gISFpbmNsdXNpdmUpIHtcbiAgICAgIGVuZCA9IHdvcmQuaW5kZXg7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgbGFzdEluZGV4ID0gd29yZC5pbmRleDtcbiAgfVxuXG4gIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcblxuICByZXR1cm4gYXJlYTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubW92ZUFyZWFCeUxpbmVzID0gZnVuY3Rpb24oeSwgYXJlYSkge1xuICBpZiAoYXJlYS5lbmQueCA+IDAgfHwgYXJlYS5iZWdpbi55ID09PSBhcmVhLmVuZC55KSBhcmVhLmVuZC55ICs9IDE7XG4gIGlmIChhcmVhLmJlZ2luLnkgKyB5IDwgMCB8fCBhcmVhLmVuZC55ICsgeSA+IHRoaXMubG9jKSByZXR1cm4gZmFsc2U7XG5cbiAgYXJlYS5iZWdpbi54ID0gMDtcbiAgYXJlYS5lbmQueCA9IDA7XG5cbiAgdmFyIHRleHQgPSB0aGlzLmdldExpbmVSYW5nZVRleHQoW2FyZWEuYmVnaW4ueSwgYXJlYS5lbmQueS0xXSk7XG4gIHRoaXMucmVtb3ZlQXJlYShhcmVhKTtcblxuICB0aGlzLmluc2VydCh7IHg6MCwgeTphcmVhLmJlZ2luLnkgKyB5IH0sIHRleHQpO1xuXG4gIHJldHVybiB0cnVlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciByYW5nZSA9IFtcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pLm9mZnNldCxcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuZW5kKS5vZmZzZXRcbiAgXTtcbiAgcmV0dXJuIHJhbmdlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lT2Zmc2V0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgb2Zmc2V0ID0geSA8IDAgPyAtMSA6IHkgPT09IDAgPyAwIDogdGhpcy50b2tlbnMuZ2V0QnlJbmRleCgnbGluZXMnLCB5IC0gMSkgKyAxO1xuICByZXR1cm4gb2Zmc2V0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5sb2MgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zLmdldENvbGxlY3Rpb24oJ2xpbmVzJykubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50ZXh0LnRvU3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiBMaW5lKCkge1xuICB0aGlzLm9mZnNldFJhbmdlID0gW107XG4gIHRoaXMub2Zmc2V0ID0gMDtcbiAgdGhpcy5sZW5ndGggPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFT0wocykge1xuICByZXR1cm4gcy5yZXBsYWNlKEVPTCwgJ1xcbicpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEluZGV4ZXI7XG5cbmZ1bmN0aW9uIEluZGV4ZXIoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xufVxuXG5JbmRleGVyLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ocykge1xuICBpZiAoIXMpIHJldHVybiBbXTtcbiAgdmFyIG9mZnNldHMgPSBbXTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5yYXc7XG4gIHZhciBsZW4gPSBzLmxlbmd0aDtcbiAgdmFyIGluZGV4O1xuICB3aGlsZSAofihpbmRleCA9IHRleHQuaW5kZXhPZihzLCBpbmRleCArIGxlbikpKSB7XG4gICAgb2Zmc2V0cy5wdXNoKGluZGV4KTtcbiAgfVxuICByZXR1cm4gb2Zmc2V0cztcbn07XG4iLCJ2YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQYXJ0cztcblxuZnVuY3Rpb24gUGFydHMobWluU2l6ZSkge1xuICBtaW5TaXplID0gbWluU2l6ZSB8fCA1MDAwO1xuICB0aGlzLm1pblNpemUgPSBtaW5TaXplO1xuICB0aGlzLnBhcnRzID0gW107XG4gIHRoaXMubGVuZ3RoID0gMDtcbn1cblxuUGFydHMucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihpdGVtKSB7XG4gIHRoaXMuYXBwZW5kKFtpdGVtXSk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHBhcnQgPSBsYXN0KHRoaXMucGFydHMpO1xuXG4gIGlmICghcGFydCkge1xuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSAwO1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSAwO1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuICBlbHNlIGlmIChwYXJ0Lmxlbmd0aCA+PSB0aGlzLm1pblNpemUpIHtcbiAgICB2YXIgc3RhcnRJbmRleCA9IHBhcnQuc3RhcnRJbmRleCArIHBhcnQubGVuZ3RoO1xuICAgIHZhciBzdGFydE9mZnNldCA9IGl0ZW1zWzBdO1xuXG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IHN0YXJ0SW5kZXg7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IHN0YXJ0T2Zmc2V0O1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuXG4gIHBhcnQucHVzaC5hcHBseShwYXJ0LCBpdGVtcy5tYXAob2Zmc2V0ID0+IG9mZnNldCAtIHBhcnQuc3RhcnRPZmZzZXQpKTtcblxuICB0aGlzLmxlbmd0aCArPSBpdGVtcy5sZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgdmFyIHBhcnQgPSB0aGlzLmZpbmRQYXJ0QnlJbmRleChpbmRleCkuaXRlbTtcbiAgcmV0dXJuIHBhcnRbaW5kZXggLSBwYXJ0LnN0YXJ0SW5kZXhdICsgcGFydC5zdGFydE9mZnNldDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBwID0gdGhpcy5maW5kUGFydEJ5T2Zmc2V0KG9mZnNldCk7XG4gIGlmICghcC5pdGVtKSByZXR1cm4gbnVsbDtcblxuICB2YXIgcGFydCA9IHAuaXRlbTtcbiAgdmFyIHBhcnRJbmRleCA9IHAuaW5kZXg7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydCk7XG4gIHJldHVybiB7XG4gICAgb2Zmc2V0OiBvLml0ZW0gKyBwYXJ0LnN0YXJ0T2Zmc2V0LFxuICAgIGluZGV4OiBvLmluZGV4ICsgcGFydC5zdGFydEluZGV4LFxuICAgIGxvY2FsOiBvLmluZGV4LFxuICAgIHBhcnQ6IHBhcnQsXG4gICAgcGFydEluZGV4OiBwYXJ0SW5kZXhcbiAgfTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIGFycmF5KSB7XG4gIHZhciBvID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghbykge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZChhcnJheSk7XG4gIH1cbiAgaWYgKG8ub2Zmc2V0ID4gb2Zmc2V0KSBvLmxvY2FsID0gLTE7XG4gIHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG4gIC8vVE9ETzogbWF5YmUgc3VidHJhY3QgJ29mZnNldCcgaW5zdGVhZCA/XG4gIGFycmF5ID0gYXJyYXkubWFwKGVsID0+IGVsIC09IG8ucGFydC5zdGFydE9mZnNldCk7XG4gIGluc2VydChvLnBhcnQsIG8ubG9jYWwgKyAxLCBhcnJheSk7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIC1sZW5ndGgpO1xuICB0aGlzLmxlbmd0aCArPSBsZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHNoaWZ0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHM7XG4gIHZhciBpdGVtID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghaXRlbSkgcmV0dXJuO1xuICBpZiAob2Zmc2V0ID4gaXRlbS5vZmZzZXQpIGl0ZW0ubG9jYWwgKz0gMTtcblxuICB2YXIgcmVtb3ZlZCA9IDA7XG4gIGZvciAodmFyIGkgPSBpdGVtLmxvY2FsOyBpIDwgaXRlbS5wYXJ0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaXRlbS5wYXJ0W2ldICs9IHNoaWZ0O1xuICAgIGlmIChpdGVtLnBhcnRbaV0gKyBpdGVtLnBhcnQuc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIHJlbW92ZWQrKztcbiAgICAgIGl0ZW0ucGFydC5zcGxpY2UoaS0tLCAxKTtcbiAgICB9XG4gIH1cbiAgaWYgKHJlbW92ZWQpIHtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoaXRlbS5wYXJ0SW5kZXggKyAxLCByZW1vdmVkKTtcbiAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICB9XG4gIGZvciAodmFyIGkgPSBpdGVtLnBhcnRJbmRleCArIDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0ICs9IHNoaWZ0O1xuICAgIGlmIChwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgaWYgKGxhc3QocGFydHNbaV0pICsgcGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgICAgcmVtb3ZlZCA9IHBhcnRzW2ldLmxlbmd0aDtcbiAgICAgICAgdGhpcy5zaGlmdEluZGV4KGkgKyAxLCByZW1vdmVkKTtcbiAgICAgICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgICAgICAgcGFydHMuc3BsaWNlKGktLSwgMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlbW92ZUJlbG93T2Zmc2V0KG9mZnNldCwgcGFydHNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmZpbmQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHRoaXMuZmluZChyYW5nZVsxXSk7XG4gIGlmICghYSAmJiAhYikgcmV0dXJuO1xuXG4gIGlmIChhLnBhcnRJbmRleCA9PT0gYi5wYXJ0SW5kZXgpIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0ID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoYS5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gICAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdEEgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsKS5sZW5ndGg7XG4gICAgdmFyIHNoaWZ0QiA9IHJlbW92ZShiLnBhcnQsIDAsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgaWYgKGIucGFydEluZGV4IC0gYS5wYXJ0SW5kZXggPiAxKSB7XG4gICAgICB2YXIgcmVtb3ZlZCA9IHJlbW92ZSh0aGlzLnBhcnRzLCBhLnBhcnRJbmRleCArIDEsIGIucGFydEluZGV4KTtcbiAgICAgIHZhciBzaGlmdEJldHdlZW4gPSByZW1vdmVkLnJlZHVjZSgocCxuKSA9PiBwICsgbi5sZW5ndGgsIDApO1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBICsgc2hpZnRCZXR3ZWVuO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4IC0gcmVtb3ZlZC5sZW5ndGggKyAxLCBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW4pO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuO1xuICAgIH0gZWxzZSB7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEE7XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggKyAxLCBzaGlmdEEgKyBzaGlmdEIpO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCO1xuICAgIH1cbiAgfVxuXG4gIC8vVE9ETzogdGhpcyBpcyBpbmVmZmljaWVudCBhcyB3ZSBjYW4gY2FsY3VsYXRlIHRoZSBpbmRleGVzIG91cnNlbHZlc1xuICBpZiAoIWEucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYS5wYXJ0KSwgMSk7XG4gIH1cbiAgaWYgKCFiLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGIucGFydCksIDEpO1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRJbmRleCA9IGZ1bmN0aW9uKHN0YXJ0SW5kZXgsIHNoaWZ0KSB7XG4gIGZvciAodmFyIGkgPSBzdGFydEluZGV4OyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMucGFydHNbaV0uc3RhcnRJbmRleCAtPSBzaGlmdDtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZUJlbG93T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydClcbiAgdmFyIHNoaWZ0ID0gcmVtb3ZlKHBhcnQsIDAsIG8uaW5kZXgpLmxlbmd0aDtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kT2Zmc2V0SW5QYXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIG9mZnNldCAtPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHBhcnQsIG8gPT4gbyA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlJbmRleCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0SW5kZXggPD0gaW5kZXgpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRPZmZzZXQgPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnBhcnRzLnJlZHVjZSgocCxuKSA9PiBwLmNvbmNhdChuKSwgW10pO1xufTtcblxuUGFydHMucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwYXJ0cyA9IG5ldyBQYXJ0cyh0aGlzLm1pblNpemUpO1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiB7XG4gICAgdmFyIHAgPSBwYXJ0LnNsaWNlKCk7XG4gICAgcC5zdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4O1xuICAgIHAuc3RhcnRPZmZzZXQgPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICAgIHBhcnRzLnBhcnRzLnB1c2gocCk7XG4gIH0pO1xuICBwYXJ0cy5sZW5ndGggPSB0aGlzLmxlbmd0aDtcbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuZnVuY3Rpb24gbGFzdChhcnJheSkge1xuICByZXR1cm4gYXJyYXlbYXJyYXkubGVuZ3RoIC0gMV07XG59XG5cbmZ1bmN0aW9uIHJlbW92ZShhcnJheSwgYSwgYikge1xuICBpZiAoYiA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEsIGIgLSBhKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBpbmRleCwgYXJyYXkpIHtcbiAgdmFyIG9wID0gYXJyYXkuc2xpY2UoKTtcbiAgb3AudW5zaGlmdChpbmRleCwgMCk7XG4gIHRhcmdldC5zcGxpY2UuYXBwbHkodGFyZ2V0LCBvcCk7XG59XG4iLCIvLyB2YXIgV09SRCA9IC9cXHcrL2c7XG52YXIgV09SRCA9IC9bYS16QS1aMC05XXsxLH0vZ1xudmFyIHJhbmsgPSAwO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFByZWZpeFRyZWVOb2RlO1xuXG5mdW5jdGlvbiBQcmVmaXhUcmVlTm9kZSgpIHtcbiAgdGhpcy52YWx1ZSA9ICcnO1xuICB0aGlzLnJhbmsgPSAwO1xuICB0aGlzLmNoaWxkcmVuID0ge307XG59XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5nZXRDaGlsZHJlbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2hpbGRyZW4gPSBPYmplY3RcbiAgICAua2V5cyh0aGlzLmNoaWxkcmVuKVxuICAgIC5tYXAoKGtleSkgPT4gdGhpcy5jaGlsZHJlbltrZXldKTtcblxuICByZXR1cm4gY2hpbGRyZW4ucmVkdWNlKChwLCBuKSA9PiBwLmNvbmNhdChuLmdldENoaWxkcmVuKCkpLCBjaGlsZHJlbik7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuY29sbGVjdCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgY29sbGVjdGlvbiA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuZmluZChrZXkpO1xuICBpZiAobm9kZSkge1xuICAgIGNvbGxlY3Rpb24gPSBub2RlXG4gICAgICAuZ2V0Q2hpbGRyZW4oKVxuICAgICAgLmZpbHRlcigobm9kZSkgPT4gbm9kZS52YWx1ZSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIHZhciByZXMgPSBiLnJhbmsgLSBhLnJhbms7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGIudmFsdWUubGVuZ3RoIC0gYS52YWx1ZS5sZW5ndGg7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGEudmFsdWUgPiBiLnZhbHVlO1xuICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgfSk7XG5cbiAgICBpZiAobm9kZS52YWx1ZSkgY29sbGVjdGlvbi5wdXNoKG5vZGUpO1xuICB9XG4gIHJldHVybiBjb2xsZWN0aW9uO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICBmb3IgKHZhciBjaGFyIGluIGtleSkge1xuICAgIGlmIChrZXlbY2hhcl0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5ba2V5W2NoYXJdXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbm9kZTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIHZhciBpID0gMDtcbiAgdmFyIG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBpZiAoc1tpXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltzW2ldXTtcbiAgICAgIGkrKztcbiAgICB9IGVsc2Uge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgbm9kZSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSB8fCBuZXcgUHJlZml4VHJlZU5vZGU7XG4gICAgaSsrO1xuICB9XG5cbiAgbm9kZS52YWx1ZSA9IHM7XG4gIG5vZGUucmFuaysrO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24ocykge1xuICB2YXIgd29yZDtcbiAgd2hpbGUgKHdvcmQgPSBXT1JELmV4ZWMocykpIHtcbiAgICB0aGlzLmluc2VydCh3b3JkWzBdKTtcbiAgfVxufTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG52YXIgVG9rZW5zID0gcmVxdWlyZSgnLi90b2tlbnMnKTtcbnZhciBUeXBlID0gVG9rZW5zLlR5cGU7XG5cbnZhciBCZWdpbiA9IC9bXFwvJ1wiYF0vZztcblxudmFyIE1hdGNoID0ge1xuICAnc2luZ2xlIGNvbW1lbnQnOiBbJy8vJywnXFxuJ10sXG4gICdkb3VibGUgY29tbWVudCc6IFsnLyonLCcqLyddLFxuICAndGVtcGxhdGUgc3RyaW5nJzogWydgJywnYCddLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFtcIidcIixcIidcIl0sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogWydcIicsJ1wiJ10sXG4gICdyZWdleHAnOiBbJy8nLCcvJ10sXG59O1xuXG52YXIgU2tpcCA9IHtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ3NpbmdsZSBjb21tZW50JzogZmFsc2UsXG4gICdkb3VibGUgY29tbWVudCc6IGZhbHNlLFxuICAncmVnZXhwJzogXCJcXFxcXCIsXG59O1xuXG52YXIgVG9rZW4gPSB7fTtcbmZvciAodmFyIGtleSBpbiBNYXRjaCkge1xuICB2YXIgTSA9IE1hdGNoW2tleV07XG4gIFRva2VuW01bMF1dID0ga2V5O1xufVxuXG52YXIgTGVuZ3RoID0ge1xuICAnb3BlbiBjb21tZW50JzogMixcbiAgJ2Nsb3NlIGNvbW1lbnQnOiAyLFxuICAndGVtcGxhdGUgc3RyaW5nJzogMSxcbn07XG5cbnZhciBOb3RPcGVuID0ge1xuICAnY2xvc2UgY29tbWVudCc6IHRydWVcbn07XG5cbnZhciBDbG9zZXMgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY2xvc2UgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUYWcgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAnc3RyaW5nJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudHM7XG5cbmZ1bmN0aW9uIFNlZ21lbnRzKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbiAgdGhpcy5jYWNoZSA9IHt9O1xuICB0aGlzLnJlc2V0KCk7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5jbGVhckNhY2hlID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQpIHtcbiAgICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMub2Zmc2V0IDwgb2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLmNhY2hlLnN0YXRlLnNwbGljZShzLmluZGV4KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmNhY2hlLnN0YXRlID0gW107XG4gIH1cbiAgdGhpcy5jYWNoZS5vZmZzZXQgPSB7fTtcbiAgdGhpcy5jYWNoZS5yYW5nZSA9IHt9O1xuICB0aGlzLmNhY2hlLnBvaW50ID0ge307XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhckNhY2hlKCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSBpbiB0aGlzLmNhY2hlLnBvaW50KSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGUucG9pbnRbeV07XG4gIH1cblxuICB2YXIgc2VnbWVudHMgPSB0aGlzLmJ1ZmZlci50b2tlbnMuZ2V0Q29sbGVjdGlvbignc2VnbWVudHMnKTtcbiAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgdmFyIHN0YXRlID0gbnVsbDtcbiAgdmFyIHdhaXRGb3IgPSAnJztcbiAgdmFyIHBvaW50ID0geyB4Oi0xLCB5Oi0xIH07XG4gIHZhciBjbG9zZSA9IDA7XG4gIHZhciBvZmZzZXQ7XG4gIHZhciBzZWdtZW50O1xuICB2YXIgcmFuZ2U7XG4gIHZhciB0ZXh0O1xuICB2YXIgdmFsaWQ7XG4gIHZhciBsYXN0O1xuXG4gIHZhciBsYXN0Q2FjaGVTdGF0ZU9mZnNldCA9IDA7XG5cbiAgdmFyIGkgPSAwO1xuXG4gIHZhciBjYWNoZVN0YXRlID0gdGhpcy5nZXRDYWNoZVN0YXRlKHkpO1xuICBpZiAoY2FjaGVTdGF0ZSAmJiBjYWNoZVN0YXRlLml0ZW0pIHtcbiAgICBvcGVuID0gdHJ1ZTtcbiAgICBzdGF0ZSA9IGNhY2hlU3RhdGUuaXRlbTtcbiAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgIGkgPSBzdGF0ZS5pbmRleCArIDE7XG4gIH1cblxuICBmb3IgKDsgaSA8IHNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb2Zmc2V0ID0gc2VnbWVudHMuZ2V0KGkpO1xuICAgIHNlZ21lbnQgPSB7XG4gICAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICAgIHR5cGU6IFR5cGVbdGhpcy5idWZmZXIuY2hhckF0KG9mZnNldCldXG4gICAgfTtcblxuICAgIC8vIHNlYXJjaGluZyBmb3IgY2xvc2UgdG9rZW5cbiAgICBpZiAob3Blbikge1xuICAgICAgaWYgKHdhaXRGb3IgPT09IHNlZ21lbnQudHlwZSkge1xuICAgICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFzdCA9IHNlZ21lbnQ7XG4gICAgICAgIGxhc3QucG9pbnQgPSBwb2ludDtcbiAgICAgICAgc3RhdGUgPSBudWxsO1xuICAgICAgICBvcGVuID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBvcGVuIHRva2VuXG4gICAgZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgfVxuXG4gICAgICByYW5nZSA9IHRoaXMuYnVmZmVyLmdldExpbmUocG9pbnQueSkub2Zmc2V0UmFuZ2U7XG5cbiAgICAgIGlmIChsYXN0ICYmIGxhc3QucG9pbnQueSA9PT0gcG9pbnQueSkge1xuICAgICAgICBjbG9zZSA9IGxhc3QucG9pbnQueCArIExlbmd0aFtsYXN0LnR5cGVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2xvc2UgPSAwO1xuICAgICAgfVxuXG4gICAgICB2YWxpZCA9IHRoaXMuaXNWYWxpZFJhbmdlKFtyYW5nZVswXSwgcmFuZ2VbMV0rMV0sIHNlZ21lbnQsIGNsb3NlKTtcblxuICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgIGlmIChOb3RPcGVuW3NlZ21lbnQudHlwZV0pIGNvbnRpbnVlO1xuICAgICAgICBvcGVuID0gdHJ1ZTtcbiAgICAgICAgc3RhdGUgPSBzZWdtZW50O1xuICAgICAgICBzdGF0ZS5pbmRleCA9IGk7XG4gICAgICAgIHN0YXRlLnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIC8vIHN0YXRlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLm9mZnNldCB9O1xuICAgICAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgICAgICBpZiAoIXRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIHx8IHRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoICYmIHN0YXRlLm9mZnNldCA+IHRoaXMuY2FjaGUuc3RhdGVbdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggLSAxXS5vZmZzZXQpIHtcbiAgICAgICAgICB0aGlzLmNhY2hlLnN0YXRlLnB1c2goc3RhdGUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzdGF0ZSAmJiBzdGF0ZS5wb2ludC55IDwgeSkge1xuICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gIH1cblxuICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbn07XG5cbi8vVE9ETzogY2FjaGUgaW4gQnVmZmVyXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCBpbiB0aGlzLmNhY2hlLm9mZnNldCkgcmV0dXJuIHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF07XG4gIHJldHVybiAodGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XSA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCkpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlLCBzZWdtZW50LCBjbG9zZSkge1xuICB2YXIga2V5ID0gcmFuZ2Uuam9pbigpO1xuICBpZiAoa2V5IGluIHRoaXMuY2FjaGUucmFuZ2UpIHJldHVybiB0aGlzLmNhY2hlLnJhbmdlW2tleV07XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UmFuZ2VUZXh0KHJhbmdlKTtcbiAgdmFyIHZhbGlkID0gdGhpcy5pc1ZhbGlkKHRleHQsIHNlZ21lbnQub2Zmc2V0IC0gcmFuZ2VbMF0sIGNsb3NlKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnJhbmdlW2tleV0gPSB2YWxpZCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCwgbGFzdEluZGV4KSB7XG4gIEJlZ2luLmxhc3RJbmRleCA9IGxhc3RJbmRleDtcblxuICB2YXIgbWF0Y2ggPSBCZWdpbi5leGVjKHRleHQpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG5cbiAgdmFyIGkgPSBtYXRjaC5pbmRleDtcblxuICBsYXN0ID0gaTtcblxuICB2YXIgdmFsaWQgPSB0cnVlO1xuXG4gIG91dGVyOlxuICBmb3IgKDsgaSA8IHRleHQubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgb25lID0gdGV4dFtpXTtcbiAgICB2YXIgbmV4dCA9IHRleHRbaSArIDFdO1xuICAgIHZhciB0d28gPSBvbmUgKyBuZXh0O1xuICAgIGlmIChpID09PSBvZmZzZXQpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIG8gPSBUb2tlblt0d29dO1xuICAgIGlmICghbykgbyA9IFRva2VuW29uZV07XG4gICAgaWYgKCFvKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICB2YXIgd2FpdEZvciA9IE1hdGNoW29dWzFdO1xuXG4gICAgbGFzdCA9IGk7XG5cbiAgICBzd2l0Y2ggKHdhaXRGb3IubGVuZ3RoKSB7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gb25lKSB7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMTtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuXG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcbiAgICAgICAgICB0d28gPSB0ZXh0W2ldICsgdGV4dFtpICsgMV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gdHdvKSB7XG4gICAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMjtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWxpZDtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmdldENhY2hlU3RhdGUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBzID0gYmluYXJ5U2VhcmNoKHRoaXMuY2FjaGUuc3RhdGUsIHMgPT4gcy5wb2ludC55IDwgeSk7XG4gIGlmIChzLml0ZW0gJiYgeSAtIDEgPCBzLml0ZW0ucG9pbnQueSkgcmV0dXJuIG51bGw7XG4gIGVsc2UgcmV0dXJuIHM7XG4gIC8vIHJldHVybiBzO1xufTtcbiIsIi8qXG5cbmV4YW1wbGUgc2VhcmNoIGZvciBvZmZzZXQgYDRgIDpcbmBvYCBhcmUgbm9kZSdzIGxldmVscywgYHhgIGFyZSB0cmF2ZXJzYWwgc3RlcHNcblxueFxueFxuby0tPnggICBvICAgb1xubyBvIHggICBvICAgbyBvIG9cbm8gbyBvLXggbyBvIG8gbyBvXG4xIDIgMyA0IDUgNiA3IDggOVxuXG4qL1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNraXBTdHJpbmc7XG5cbmZ1bmN0aW9uIE5vZGUodmFsdWUsIGxldmVsKSB7XG4gIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgdGhpcy5sZXZlbCA9IGxldmVsO1xuICB0aGlzLndpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwodmFsdWUgJiYgdmFsdWUubGVuZ3RoIHx8IDApO1xuICB0aGlzLm5leHQgPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbChudWxsKTtcbn1cblxuTm9kZS5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMud2lkdGhbMF07XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNraXBTdHJpbmcobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy5sZXZlbHMgPSBvLmxldmVscyB8fCAxMTtcbiAgdGhpcy5iaWFzID0gby5iaWFzIHx8IDEgLyBNYXRoLkU7XG4gIHRoaXMuaGVhZCA9IG5ldyBOb2RlKG51bGwsIHRoaXMubGV2ZWxzKTtcbiAgdGhpcy5jaHVua1NpemUgPSBvLmNodW5rU2l6ZSB8fCA1MDAwO1xufVxuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkLndpZHRoW3RoaXMubGV2ZWxzIC0gMV07XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICAvLyBncmVhdCBoYWNrIHRvIGRvIG9mZnNldCA+PSBmb3IgLnNlYXJjaCgpXG4gIC8vIHdlIGRvbid0IGhhdmUgZnJhY3Rpb25zIGFueXdheSBzby4uXG4gIHJldHVybiB0aGlzLnNlYXJjaChvZmZzZXQsIHRydWUpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmluc2VydENodW5rZWQoMCwgdGV4dCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbihvZmZzZXQsIGluY2wpIHtcbiAgaW5jbCA9IGluY2wgPyAuMSA6IDA7XG5cbiAgLy8gcHJlcGFyZSB0byBob2xkIHN0ZXBzXG4gIHZhciBzdGVwcyA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG4gIHZhciB3aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG5cbiAgLy8gaXRlcmF0ZSBsZXZlbHMgZG93biwgc2tpcHBpbmcgdG9wXG4gIHZhciBpID0gdGhpcy5sZXZlbHM7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICB3aGlsZSAob2Zmc2V0ICsgaW5jbCA+IG5vZGUud2lkdGhbaV0gJiYgbnVsbCAhPSBub2RlLm5leHRbaV0pIHtcbiAgICAgIG9mZnNldCAtPSBub2RlLndpZHRoW2ldO1xuICAgICAgbm9kZSA9IG5vZGUubmV4dFtpXTtcbiAgICB9XG4gICAgc3RlcHNbaV0gPSBub2RlO1xuICAgIHdpZHRoW2ldID0gb2Zmc2V0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBub2RlOiBub2RlLFxuICAgIHN0ZXBzOiBzdGVwcyxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgb2Zmc2V0OiBvZmZzZXRcbiAgfTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNwbGljZSA9IGZ1bmN0aW9uKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7IC8vIHNraXAgc3RlcHMgbGVmdCBvZiB0aGUgb2Zmc2V0XG4gIHZhciB3aWR0aCA9IHMud2lkdGg7XG5cbiAgdmFyIHA7IC8vIGxlZnQgbm9kZSBvciBgcGBcbiAgdmFyIHE7IC8vIHJpZ2h0IG5vZGUgb3IgYHFgIChvdXIgbmV3IG5vZGUpXG4gIHZhciBsZW47XG5cbiAgLy8gY3JlYXRlIG5ldyBub2RlXG4gIGxldmVsID0gbGV2ZWwgfHwgdGhpcy5yYW5kb21MZXZlbCgpO1xuICBxID0gbmV3IE5vZGUodmFsdWUsIGxldmVsKTtcbiAgbGVuZ3RoID0gcS53aWR0aFswXTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBpdGVyYXRlIHN0ZXBzIGxldmVscyBiZWxvdyBuZXcgbm9kZSBsZXZlbFxuICBpID0gbGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbCBzdGVwXG4gICAgcS5uZXh0W2ldID0gcC5uZXh0W2ldOyAvLyBpbnNlcnQgc28gaW5oZXJpdCBsZWZ0J3MgbmV4dFxuICAgIHAubmV4dFtpXSA9IHE7IC8vIGxlZnQncyBuZXh0IGlzIG5vdyBvdXIgbmV3IG5vZGVcbiAgICBxLndpZHRoW2ldID0gcC53aWR0aFtpXSAtIHdpZHRoW2ldICsgbGVuZ3RoO1xuICAgIHAud2lkdGhbaV0gPSB3aWR0aFtpXTtcbiAgfVxuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgYWxsIGxldmVscyBkb3duIHVudGlsIGV4Y2VwdCBuZXcgbm9kZSBsZXZlbFxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBsZXZlbCkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsXG4gICAgcC53aWR0aFtpXSArPSBsZW5ndGg7IC8vIGFkZCBuZXcgbm9kZSB3aWR0aFxuICB9XG5cbiAgLy8gcmV0dXJuIG5ldyBub2RlXG4gIHJldHVybiBxO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChvZmZzZXQpO1xuXG4gIC8vIGlmIHNlYXJjaCBmYWxscyBpbiB0aGUgbWlkZGxlIG9mIGEgc3RyaW5nXG4gIC8vIGluc2VydCBpdCB0aGVyZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIGEgbmV3IG5vZGVcbiAgaWYgKHMub2Zmc2V0ICYmIHMubm9kZS52YWx1ZSAmJiBzLm9mZnNldCA8IHMubm9kZS52YWx1ZS5sZW5ndGgpIHtcbiAgICB0aGlzLnVwZGF0ZShzLCBpbnNlcnQocy5vZmZzZXQsIHMubm9kZS52YWx1ZSwgdmFsdWUpKTtcbiAgICByZXR1cm4gcy5ub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuc3BsaWNlKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIC8vIHZhbHVlcyBsZW5ndGggZGlmZmVyZW5jZVxuICB2YXIgbGVuZ3RoID0gcy5ub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICAvLyB1cGRhdGUgdmFsdWVcbiAgcy5ub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gZml4IHdpZHRocyBvbiBhbGwgbGV2ZWxzXG4gIGkgPSB0aGlzLmxldmVscztcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgcy5zdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKHJhbmdlWzFdID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAncmFuZ2UgZW5kIG92ZXIgbWF4aW11bSBsZW5ndGgoJyArXG4gICAgICB0aGlzLmxlbmd0aCArICcpOiBbJyArIHJhbmdlLmpvaW4oKSArICddJ1xuICAgICk7XG4gIH1cblxuICAvLyByZW1haW4gZGlzdGFuY2UgdG8gcmVtb3ZlXG4gIHZhciB4ID0gcmFuZ2VbMV0gLSByYW5nZVswXTtcblxuICAvLyBzZWFyY2ggZm9yIG5vZGUgb24gbGVmdCBlZGdlXG4gIHZhciBzID0gdGhpcy5zZWFyY2gocmFuZ2VbMF0pO1xuICB2YXIgb2Zmc2V0ID0gcy5vZmZzZXQ7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7XG4gIHZhciBub2RlID0gcy5ub2RlO1xuXG4gIC8vIHNraXAgaGVhZFxuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gIC8vIHNsaWNlIGxlZnQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKG9mZnNldCkge1xuICAgIGlmIChvZmZzZXQgPCBub2RlLndpZHRoWzBdKSB7XG4gICAgICB4IC09IHRoaXMudXBkYXRlKHMsXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoMCwgb2Zmc2V0KSArXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoXG4gICAgICAgICAgb2Zmc2V0ICtcbiAgICAgICAgICBNYXRoLm1pbih4LCBub2RlLmxlbmd0aCAtIG9mZnNldClcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gICAgaWYgKCFub2RlKSByZXR1cm47XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGZ1bGwgbm9kZXMgaW4gcmFuZ2VcbiAgd2hpbGUgKG5vZGUgJiYgeCA+PSBub2RlLndpZHRoWzBdKSB7XG4gICAgeCAtPSB0aGlzLnJlbW92ZU5vZGUoc3RlcHMsIG5vZGUpO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cblxuICAvLyBzbGljZSByaWdodCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAoeCkge1xuICAgIHRoaXMucmVwbGFjZShzdGVwcywgbm9kZSwgbm9kZS52YWx1ZS5zbGljZSh4KSk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZU5vZGUgPSBmdW5jdGlvbihzdGVwcywgbm9kZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS53aWR0aFswXTtcblxuICB2YXIgaTtcblxuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aCAtIG5vZGUud2lkdGhbaV07XG4gICAgc3RlcHNbaV0ubmV4dFtpXSA9IG5vZGUubmV4dFtpXTtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlLCB2YWx1ZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgbm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIHZhciBpO1xuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIG5vZGUud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlKFtvZmZzZXQsIG9mZnNldCsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnRDaHVua2VkID0gZnVuY3Rpb24ob2Zmc2V0LCB0ZXh0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gdGhpcy5jaHVua1NpemUpIHtcbiAgICB2YXIgY2h1bmsgPSB0ZXh0LnN1YnN0cihpLCB0aGlzLmNodW5rU2l6ZSk7XG4gICAgdGhpcy5pbnNlcnQoaSArIG9mZnNldCwgY2h1bmspO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zdWJzdHJpbmcgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBsZW5ndGggPSBiIC0gYTtcblxuICB2YXIgc2VhcmNoID0gdGhpcy5zZWFyY2goYSwgdHJ1ZSk7XG4gIHZhciBub2RlID0gc2VhcmNoLm5vZGU7XG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIHZhciBkID0gbGVuZ3RoICsgc2VhcmNoLm9mZnNldDtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKG5vZGUgJiYgZCA+PSAwKSB7XG4gICAgZCAtPSBub2RlLndpZHRoWzBdO1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG4gIGlmIChub2RlKSB7XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICB9XG5cbiAgcmV0dXJuIHMuc3Vic3RyKHNlYXJjaC5vZmZzZXQsIGxlbmd0aCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yYW5kb21MZXZlbCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbGV2ZWwgPSAxO1xuICB3aGlsZSAobGV2ZWwgPCB0aGlzLmxldmVscyAtIDEgJiYgTWF0aC5yYW5kb20oKSA8IHRoaXMuYmlhcykgbGV2ZWwrKztcbiAgcmV0dXJuIGxldmVsO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByYW5nZSA9IHJhbmdlIHx8IFtdO1xuICByZXR1cm4gdGhpcy5zdWJzdHJpbmcocmFuZ2VbMF0sIHJhbmdlWzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvcHkgPSBuZXcgU2tpcFN0cmluZztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHZhciBvZmZzZXQgPSAwO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIGNvcHkuaW5zZXJ0KG9mZnNldCwgbm9kZS52YWx1ZSk7XG4gICAgb2Zmc2V0ICs9IG5vZGUud2lkdGhbMF07XG4gIH1cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5qb2luU3RyaW5nID0gZnVuY3Rpb24oZGVsaW1pdGVyKSB7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBwYXJ0cy5wdXNoKG5vZGUudmFsdWUpO1xuICB9XG4gIHJldHVybiBwYXJ0cy5qb2luKGRlbGltaXRlcik7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zdWJzdHJpbmcoMCwgdGhpcy5sZW5ndGgpO1xufTtcblxuZnVuY3Rpb24gdHJpbShzLCBsZWZ0LCByaWdodCkge1xuICByZXR1cm4gcy5zdWJzdHIoMCwgcy5sZW5ndGggLSByaWdodCkuc3Vic3RyKGxlZnQpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcbnZhciBSID0gUmVnZXhwLmNyZWF0ZTtcblxuLy9OT1RFOiBvcmRlciBtYXR0ZXJzXG52YXIgc3ludGF4ID0gbWFwKHtcbiAgJ3QnOiBSKFsnb3BlcmF0b3InXSwgJ2cnLCBlbnRpdGllcyksXG4gICdtJzogUihbJ3BhcmFtcyddLCAgICdnJyksXG4gICdkJzogUihbJ2RlY2xhcmUnXSwgICdnJyksXG4gICdmJzogUihbJ2Z1bmN0aW9uJ10sICdnJyksXG4gICdrJzogUihbJ2tleXdvcmQnXSwgICdnJyksXG4gICduJzogUihbJ2J1aWx0aW4nXSwgICdnJyksXG4gICdsJzogUihbJ3N5bWJvbCddLCAgICdnJyksXG4gICdzJzogUihbJ3RlbXBsYXRlIHN0cmluZyddLCAnZycpLFxuICAnZSc6IFIoWydzcGVjaWFsJywnbnVtYmVyJ10sICdnJyksXG59LCBjb21waWxlKTtcblxudmFyIEluZGVudCA9IHtcbiAgcmVnZXhwOiBSKFsnaW5kZW50J10sICdnbScpLFxuICByZXBsYWNlcjogKHMpID0+IHMucmVwbGFjZSgvIHsxLDJ9fFxcdC9nLCAnPHg+JCY8L3g+Jylcbn07XG5cbnZhciBBbnlDaGFyID0gL1xcUy9nO1xuXG52YXIgQmxvY2tzID0gUihbJ2NvbW1lbnQnLCdzdHJpbmcnLCdyZWdleHAnXSwgJ2dtJyk7XG5cbnZhciBMb25nTGluZXMgPSAvKF4uezEwMDAsfSkvZ207XG5cbnZhciBUYWcgPSB7XG4gICcvLyc6ICdjJyxcbiAgJy8qJzogJ2MnLFxuICAnYCc6ICdzJyxcbiAgJ1wiJzogJ3MnLFxuICBcIidcIjogJ3MnLFxuICAnLyc6ICdyJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3ludGF4O1xuXG5mdW5jdGlvbiBTeW50YXgobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy50YWIgPSBvLnRhYiB8fCAnXFx0JztcbiAgdGhpcy5ibG9ja3MgPSBbXTtcbn1cblxuU3ludGF4LnByb3RvdHlwZS5lbnRpdGllcyA9IGVudGl0aWVzO1xuXG5TeW50YXgucHJvdG90eXBlLmhpZ2hsaWdodCA9IGZ1bmN0aW9uKGNvZGUsIG9mZnNldCkge1xuICBjb2RlID0gdGhpcy5jcmVhdGVJbmRlbnRzKGNvZGUpO1xuICBjb2RlID0gdGhpcy5jcmVhdGVCbG9ja3MoY29kZSk7XG4gIGNvZGUgPSBlbnRpdGllcyhjb2RlKTtcblxuICBmb3IgKHZhciBrZXkgaW4gc3ludGF4KSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShzeW50YXhba2V5XS5yZWdleHAsIHN5bnRheFtrZXldLnJlcGxhY2VyKTtcbiAgfVxuXG4gIGNvZGUgPSB0aGlzLnJlc3RvcmVCbG9ja3MoY29kZSk7XG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoSW5kZW50LnJlZ2V4cCwgSW5kZW50LnJlcGxhY2VyKTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlSW5kZW50cyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGxpbmVzID0gY29kZS5zcGxpdCgvXFxuL2cpO1xuICB2YXIgaW5kZW50ID0gMDtcbiAgdmFyIG1hdGNoO1xuICB2YXIgbGluZTtcbiAgdmFyIGk7XG5cbiAgaSA9IGxpbmVzLmxlbmd0aDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgbGluZSA9IGxpbmVzW2ldO1xuICAgIEFueUNoYXIubGFzdEluZGV4ID0gMDtcbiAgICBtYXRjaCA9IEFueUNoYXIuZXhlYyhsaW5lKTtcbiAgICBpZiAobWF0Y2gpIGluZGVudCA9IG1hdGNoLmluZGV4O1xuICAgIGVsc2UgaWYgKGluZGVudCAmJiAhbGluZS5sZW5ndGgpIHtcbiAgICAgIGxpbmVzW2ldID0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4odGhpcy50YWIpO1xuICAgIH1cbiAgfVxuXG4gIGNvZGUgPSBsaW5lcy5qb2luKCdcXG4nKTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUucmVzdG9yZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGJsb2NrO1xuICB2YXIgYmxvY2tzID0gdGhpcy5ibG9ja3M7XG4gIHZhciBuID0gMDtcbiAgcmV0dXJuIGNvZGVcbiAgICAucmVwbGFjZSgvXFx1ZmZlYy9nLCBmdW5jdGlvbigpIHtcbiAgICAgIGJsb2NrID0gYmxvY2tzW24rK107XG4gICAgICByZXR1cm4gZW50aXRpZXMoYmxvY2suc2xpY2UoMCwgMTAwMCkgKyAnLi4ubGluZSB0b28gbG9uZyB0byBkaXNwbGF5Jyk7XG4gICAgfSlcbiAgICAucmVwbGFjZSgvXFx1ZmZlYi9nLCBmdW5jdGlvbigpIHtcbiAgICAgIGJsb2NrID0gYmxvY2tzW24rK107XG4gICAgICB2YXIgdGFnID0gaWRlbnRpZnkoYmxvY2spO1xuICAgICAgcmV0dXJuICc8Jyt0YWcrJz4nK2VudGl0aWVzKGJsb2NrKSsnPC8nK3RhZysnPic7XG4gICAgfSk7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdGhpcy5ibG9ja3MgPSBbXTtcblxuICBjb2RlID0gY29kZVxuICAgIC5yZXBsYWNlKExvbmdMaW5lcywgKGJsb2NrKSA9PiB7XG4gICAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgIHJldHVybiAnXFx1ZmZlYyc7XG4gICAgfSlcbiAgICAucmVwbGFjZShCbG9ja3MsIChibG9jaykgPT4ge1xuICAgICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICByZXR1cm4gJ1xcdWZmZWInO1xuICAgIH0pO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuZnVuY3Rpb24gY3JlYXRlSWQoKSB7XG4gIHZhciBhbHBoYWJldCA9ICdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eic7XG4gIHZhciBsZW5ndGggPSBhbHBoYWJldC5sZW5ndGggLSAxO1xuICB2YXIgaSA9IDY7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzICs9IGFscGhhYmV0W01hdGgucmFuZG9tKCkgKiBsZW5ndGggfCAwXTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gZW50aXRpZXModGV4dCkge1xuICByZXR1cm4gdGV4dFxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICA7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGUocmVnZXhwLCB0YWcpIHtcbiAgdmFyIG9wZW5UYWcgPSAnPCcgKyB0YWcgKyAnPic7XG4gIHZhciBjbG9zZVRhZyA9ICc8LycgKyB0YWcgKyAnPic7XG4gIHJldHVybiB7XG4gICAgbmFtZTogdGFnLFxuICAgIHJlZ2V4cDogcmVnZXhwLFxuICAgIHJlcGxhY2VyOiBvcGVuVGFnICsgJyQmJyArIGNsb3NlVGFnXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hcChvYmosIGZuKSB7XG4gIHZhciByZXN1bHQgPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHJlc3VsdFtrZXldID0gZm4ob2JqW2tleV0sIGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZShwYXNzLCBjb2RlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFzcy5sZW5ndGg7IGkrKykge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UocGFzc1tpXVswXSwgcGFzc1tpXVsxXSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZ5KGJsb2NrKSB7XG4gIHZhciBvbmUgPSBibG9ja1swXTtcbiAgdmFyIHR3byA9IG9uZSArIGJsb2NrWzFdO1xuICByZXR1cm4gVGFnW3R3b10gfHwgVGFnW29uZV07XG59XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBQYXJ0cyA9IHJlcXVpcmUoJy4vcGFydHMnKTtcblxudmFyIFR5cGUgPSB7XG4gICdcXG4nOiAnbGluZXMnLFxuICAneyc6ICdvcGVuIGN1cmx5JyxcbiAgJ30nOiAnY2xvc2UgY3VybHknLFxuICAnWyc6ICdvcGVuIHNxdWFyZScsXG4gICddJzogJ2Nsb3NlIHNxdWFyZScsXG4gICcoJzogJ29wZW4gcGFyZW5zJyxcbiAgJyknOiAnY2xvc2UgcGFyZW5zJyxcbiAgJy8nOiAnb3BlbiBjb21tZW50JyxcbiAgJyonOiAnY2xvc2UgY29tbWVudCcsXG4gICdgJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVE9LRU4gPSAvXFxufFxcL1xcKnxcXCpcXC98YHxcXHt8XFx9fFxcW3xcXF18XFwofFxcKS9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRva2VucztcblxuVG9rZW5zLlR5cGUgPSBUeXBlO1xuXG5mdW5jdGlvbiBUb2tlbnMoZmFjdG9yeSkge1xuICBmYWN0b3J5ID0gZmFjdG9yeSB8fCBmdW5jdGlvbigpIHsgcmV0dXJuIG5ldyBQYXJ0czsgfTtcblxuICB0aGlzLmZhY3RvcnkgPSBmYWN0b3J5O1xuXG4gIHZhciB0ID0gdGhpcy50b2tlbnMgPSB7XG4gICAgbGluZXM6IGZhY3RvcnkoKSxcbiAgICBibG9ja3M6IGZhY3RvcnkoKSxcbiAgICBzZWdtZW50czogZmFjdG9yeSgpLFxuICB9O1xuXG4gIHRoaXMuY29sbGVjdGlvbiA9IHtcbiAgICAnXFxuJzogdC5saW5lcyxcbiAgICAneyc6IHQuYmxvY2tzLFxuICAgICd9JzogdC5ibG9ja3MsXG4gICAgJ1snOiB0LmJsb2NrcyxcbiAgICAnXSc6IHQuYmxvY2tzLFxuICAgICcoJzogdC5ibG9ja3MsXG4gICAgJyknOiB0LmJsb2NrcyxcbiAgICAnLyc6IHQuc2VnbWVudHMsXG4gICAgJyonOiB0LnNlZ21lbnRzLFxuICAgICdgJzogdC5zZWdtZW50cyxcbiAgfTtcbn1cblxuVG9rZW5zLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRva2Vucy5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHx8IDA7XG5cbiAgdmFyIHRva2VucyA9IHRoaXMudG9rZW5zO1xuICB2YXIgbWF0Y2g7XG4gIHZhciB0eXBlO1xuICB2YXIgY29sbGVjdGlvbjtcblxuICB3aGlsZSAobWF0Y2ggPSBUT0tFTi5leGVjKHRleHQpKSB7XG4gICAgY29sbGVjdGlvbiA9IHRoaXMuY29sbGVjdGlvblt0ZXh0W21hdGNoLmluZGV4XV07XG4gICAgY29sbGVjdGlvbi5wdXNoKG1hdGNoLmluZGV4ICsgb2Zmc2V0KTtcbiAgfVxufTtcblxuVG9rZW5zLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihyYW5nZSwgdGV4dCwgc2hpZnQpIHtcbiAgdmFyIGluc2VydCA9IG5ldyBUb2tlbnMoQXJyYXkpO1xuICBpbnNlcnQuaW5kZXgodGV4dCwgcmFuZ2VbMF0pO1xuXG4gIHZhciBsZW5ndGhzID0ge307XG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICBsZW5ndGhzW3R5cGVdID0gdGhpcy50b2tlbnNbdHlwZV0ubGVuZ3RoO1xuICB9XG5cbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnNoaWZ0T2Zmc2V0KHJhbmdlWzBdLCBzaGlmdCk7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0ucmVtb3ZlUmFuZ2UocmFuZ2UpO1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLmluc2VydChyYW5nZVswXSwgaW5zZXJ0LnRva2Vuc1t0eXBlXSk7XG4gIH1cblxuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgaWYgKHRoaXMudG9rZW5zW3R5cGVdLmxlbmd0aCAhPT0gbGVuZ3Roc1t0eXBlXSkge1xuICAgICAgdGhpcy5lbWl0KGBjaGFuZ2UgJHt0eXBlfWApO1xuICAgIH1cbiAgfVxufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeUluZGV4ID0gZnVuY3Rpb24odHlwZSwgaW5kZXgpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdLmdldChpbmRleCk7XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldENvbGxlY3Rpb24gPSBmdW5jdGlvbih0eXBlKSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlPZmZzZXQgPSBmdW5jdGlvbih0eXBlLCBvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdLmZpbmQob2Zmc2V0KTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgdG9rZW5zID0gbmV3IFRva2Vucyh0aGlzLmZhY3RvcnkpO1xuICB2YXIgdCA9IHRva2Vucy50b2tlbnM7XG4gIGZvciAodmFyIGtleSBpbiB0aGlzLnRva2Vucykge1xuICAgIHRba2V5XSA9IHRoaXMudG9rZW5zW2tleV0uc2xpY2UoKTtcbiAgfVxuICB0b2tlbnMuY29sbGVjdGlvbiA9IHtcbiAgICAnXFxuJzogdC5saW5lcyxcbiAgICAneyc6IHQuYmxvY2tzLFxuICAgICd9JzogdC5ibG9ja3MsXG4gICAgJ1snOiB0LmJsb2NrcyxcbiAgICAnXSc6IHQuYmxvY2tzLFxuICAgICcoJzogdC5ibG9ja3MsXG4gICAgJyknOiB0LmJsb2NrcyxcbiAgICAnLyc6IHQuc2VnbWVudHMsXG4gICAgJyonOiB0LnNlZ21lbnRzLFxuICAgICdgJzogdC5zZWdtZW50cyxcbiAgfTtcbiAgcmV0dXJuIHRva2Vucztcbn07XG4iLCJ2YXIgb3BlbiA9IHJlcXVpcmUoJy4uL2xpYi9vcGVuJyk7XG52YXIgc2F2ZSA9IHJlcXVpcmUoJy4uL2xpYi9zYXZlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBCdWZmZXIgPSByZXF1aXJlKCcuL2J1ZmZlcicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbGU7XG5cbmZ1bmN0aW9uIEZpbGUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5yb290ID0gJyc7XG4gIHRoaXMucGF0aCA9ICd1bnRpdGxlZCc7XG4gIHRoaXMuYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuRmlsZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5GaWxlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5idWZmZXIub24oJ3JhdycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdyYXcnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdzZXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnc2V0JykpO1xuICB0aGlzLmJ1ZmZlci5vbigndXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZScpKTtcbiAgdGhpcy5idWZmZXIub24oJ2JlZm9yZSB1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmVmb3JlIGNoYW5nZScpKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLnBhdGggPSBwYXRoO1xuICB0aGlzLnJvb3QgPSByb290O1xuICBvcGVuKHJvb3QgKyBwYXRoLCAoZXJyLCB0ZXh0KSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICBmbiAmJiBmbihlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xuICAgIHRoaXMuZW1pdCgnb3BlbicpO1xuICAgIGZuICYmIGZuKG51bGwsIHRoaXMpO1xuICB9KTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICBzYXZlKHRoaXMucm9vdCArIHRoaXMucGF0aCwgdGhpcy5idWZmZXIudG9TdHJpbmcoKSwgZm4gfHwgbm9vcCk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5mdW5jdGlvbiBub29wKCkgey8qIG5vb3AgKi99XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uL2xpYi9kZWJvdW5jZScpO1xuXG4vKlxuICAgLiAuXG4tMSAwIDEgMiAzIDQgNVxuICAgblxuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBIaXN0b3J5O1xuXG5mdW5jdGlvbiBIaXN0b3J5KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sb2cgPSBbXTtcbiAgdGhpcy5uZWVkbGUgPSAwO1xuICB0aGlzLnRpbWVvdXQgPSB0cnVlO1xuICB0aGlzLnRpbWVTdGFydCA9IDA7XG59XG5cbkhpc3RvcnkucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmIChEYXRlLm5vdygpIC0gdGhpcy50aW1lU3RhcnQgPiAyMDAwIHx8IGZvcmNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuICB0aGlzLnRpbWVvdXQgPSB0aGlzLmRlYm91bmNlZFNhdmUoKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmRlYm91bmNlZFNhdmUgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5hY3R1YWxseVNhdmUoKTtcbn0sIDcwMCk7XG5cbkhpc3RvcnkucHJvdG90eXBlLmFjdHVhbGx5U2F2ZSA9IGZ1bmN0aW9uKCkge1xuICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgaWYgKHRoaXMuZWRpdG9yLmJ1ZmZlci5sb2cubGVuZ3RoKSB7XG4gICAgdGhpcy5sb2cgPSB0aGlzLmxvZy5zbGljZSgwLCArK3RoaXMubmVlZGxlKTtcbiAgICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICAgIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoO1xuICAgIHRoaXMuc2F2ZU1ldGEoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnNhdmVNZXRhKCk7XG4gIH1cbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuICBpZiAodGhpcy5uZWVkbGUgPCAwKSByZXR1cm47XG5cbiAgdGhpcy5jaGVja291dCgndW5kbycsIHRoaXMubmVlZGxlLS0pO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPT09IHRoaXMubG9nLmxlbmd0aCAtIDEpIHJldHVybjtcblxuICB0aGlzLmNoZWNrb3V0KCdyZWRvJywgKyt0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jaGVja291dCA9IGZ1bmN0aW9uKHR5cGUsIG4pIHtcbiAgdmFyIGNvbW1pdCA9IHRoaXMubG9nW25dO1xuICBpZiAoIWNvbW1pdCkgcmV0dXJuO1xuXG4gIHZhciBsb2cgPSBjb21taXQubG9nO1xuXG4gIGNvbW1pdCA9IHRoaXMubG9nW25dW3R5cGVdO1xuICB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSA9IGNvbW1pdC5tYXJrQWN0aXZlO1xuICB0aGlzLmVkaXRvci5tYXJrLnNldChjb21taXQubWFyay5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5zZXRDYXJldChjb21taXQuY2FyZXQuY29weSgpKTtcblxuICBsb2cgPSAndW5kbycgPT09IHR5cGVcbiAgICA/IGxvZy5zbGljZSgpLnJldmVyc2UoKVxuICAgIDogbG9nLnNsaWNlKCk7XG5cbiAgbG9nLmZvckVhY2goaXRlbSA9PiB7XG4gICAgdmFyIGFjdGlvbiA9IGl0ZW1bMF07XG4gICAgdmFyIG9mZnNldFJhbmdlID0gaXRlbVsxXTtcbiAgICB2YXIgdGV4dCA9IGl0ZW1bMl07XG4gICAgc3dpdGNoIChhY3Rpb24pIHtcbiAgICAgIGNhc2UgJ2luc2VydCc6XG4gICAgICAgIGlmICgndW5kbycgPT09IHR5cGUpIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5pbnNlcnQodGhpcy5lZGl0b3IuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldFJhbmdlWzBdKSwgdGV4dCwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdyZW1vdmUnOlxuICAgICAgICBpZiAoJ3VuZG8nID09PSB0eXBlKSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLmluc2VydCh0aGlzLmVkaXRvci5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0UmFuZ2VbMF0pLCB0ZXh0LCB0cnVlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UsIHRydWUpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSk7XG5cbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNvbW1pdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbG9nID0gdGhpcy5lZGl0b3IuYnVmZmVyLmxvZztcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLmxvZyA9IFtdO1xuICByZXR1cm4ge1xuICAgIGxvZzogbG9nLFxuICAgIHVuZG86IHRoaXMubWV0YSxcbiAgICByZWRvOiB7XG4gICAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgICBtYXJrQWN0aXZlOiB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZVxuICAgIH1cbiAgfTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmVNZXRhID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWV0YSA9IHtcbiAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gIH07XG59O1xuIiwidmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG5cbnZhciBQQUdJTkdfVEhST1RUTEUgPSA2NTtcblxudmFyIGtleXMgPSBtb2R1bGUuZXhwb3J0cyA9IHtcbiAgJ2N0cmwreic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS51bmRvKCk7XG4gIH0sXG4gICdjdHJsK3knOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucmVkbygpO1xuICB9LFxuXG4gICdob21lJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKCk7XG4gIH0sXG4gICdlbmQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKCk7XG4gIH0sXG4gICdwYWdldXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdwYWdlZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93bigpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCt1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK2Rvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEpO1xuICB9LFxuICAndXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSk7XG4gIH0sXG4gICdyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxKTtcbiAgfSxcbiAgJ2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEpO1xuICB9LFxuICAnY3RybCtyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEpO1xuICB9LFxuXG4gICdjdHJsK2EnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9LFxuXG4gICdjdHJsK3NoaWZ0K3VwJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHsgYmVnaW46IHRoaXMuY2FyZXQucG9zLCBlbmQ6IHRoaXMuY2FyZXQucG9zIH0pO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHRoaXMubWFyay5nZXQoKSk7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG4gICdjdHJsK3NoaWZ0K2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnZW50ZXInOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmluc2VydCgnXFxuJyk7XG4gIH0sXG5cbiAgJ2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgbGluZXMgPSBhcmVhLmVuZC55IC0gYXJlYS5iZWdpbi55O1xuICAgIGlmIChsaW5lcyAmJiBhcmVhLmVuZC54ID4gMCkgYWRkICs9IDE7XG4gICAgaWYgKCFsaW5lcykgYWRkICs9IDE7XG4gICAgbGluZXMgKz0gYWRkO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYS5zZXRMZWZ0KDApLmFkZEJvdHRvbShhZGQpKTtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQoeyB4OiAwLCB5OiBhcmVhLmVuZC55IH0sIHRleHQpO1xuICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMobGluZXMpO1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKGxpbmVzLCB0cnVlKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsK2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAndGFiJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuc3VnZ2VzdCgpO1xuICAgIGlmICghcmVzKSB7XG4gICAgICB0aGlzLmluc2VydCh0aGlzLnRhYik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya1NldEFyZWEocmVzLmFyZWEpO1xuICAgICAgdGhpcy5pbnNlcnQocmVzLm5vZGUudmFsdWUpO1xuICAgIH1cbiAgfSxcblxuICAnY3RybCtmJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kLm9wZW4oKTtcbiAgfSxcblxuICAnZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKCsxKTtcbiAgfSxcbiAgJ3NoaWZ0K2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgtMSk7XG4gIH0sXG5cbiAgJ2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhZGQ7XG4gICAgdmFyIGFyZWE7XG4gICAgdmFyIHRleHQ7XG5cbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcblxuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgY2xlYXIgPSB0cnVlO1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0aGlzLm1hcmsuYWRkQm90dG9tKGFyZWEuZW5kLnggPiAwKS5zZXRMZWZ0KDApO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEodGhpcy5tYXJrLmdldCgpKTtcbiAgICB9XG5cbiAgICAvL1RPRE86IHNob3VsZCBjaGVjayBpZiBsYXN0IGxpbmUgaGFzIC8vIGFsc29cbiAgICBpZiAodGV4dC50cmltTGVmdCgpLnN1YnN0cigwLDIpID09PSAnLy8nKSB7XG4gICAgICBhZGQgPSAtMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLio/KVxcL1xcLyAoLispL2dtLCAnJDEkMicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGQgPSArMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oW1xcc10qKSguKykvZ20sICckMS8vICQyJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG5cbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEuYWRkUmlnaHQoYWRkKSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcblxuICAgIGlmIChjYXJldC54KSBjYXJldC5hZGRSaWdodChhZGQpO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQpO1xuXG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSBjbGVhciA9IHRydWU7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICBpZiAodGV4dC5zbGljZSgwLDIpID09PSAnLyonICYmIHRleHQuc2xpY2UoLTIpID09PSAnKi8nKSB7XG4gICAgICB0ZXh0ID0gdGV4dC5zbGljZSgyLC0yKTtcbiAgICAgIGFkZCAtPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkIC09IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRleHQgPSAnLyonICsgdGV4dCArICcqLyc7XG4gICAgICBhZGQgKz0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCArPSAyO1xuICAgIH1cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcbiAgICBhcmVhLmVuZC54ICs9IGFkZDtcbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldC5hZGRSaWdodChhZGQpKTtcbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxufTtcblxua2V5cy5zaW5nbGUgPSB7XG4gIC8vXG59O1xuXG4vLyBzZWxlY3Rpb24ga2V5c1xuWyAnaG9tZScsJ2VuZCcsXG4gICdwYWdldXAnLCdwYWdlZG93bicsXG4gICdsZWZ0JywndXAnLCdyaWdodCcsJ2Rvd24nLFxuICAnY3RybCtsZWZ0JywnY3RybCtyaWdodCdcbl0uZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAga2V5c1snc2hpZnQrJytrZXldID0gZnVuY3Rpb24oZSkge1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAga2V5c1trZXldLmNhbGwodGhpcywgZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH07XG59KTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLm1vdXNlID0gbmV3IE1vdXNlKHRoaXMpO1xuICB0aGlzLnRleHQgPSBuZXcgVGV4dDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSW5wdXQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSW5wdXQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJsdXIgPSB0aGlzLmJsdXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy50ZXh0Lm9uKFsna2V5JywgJ3RleHQnXSwgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2lucHV0JykpO1xuICB0aGlzLnRleHQub24oJ2ZvY3VzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJykpO1xuICB0aGlzLnRleHQub24oJ2JsdXInLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xuICB0aGlzLnRleHQucmVzZXQoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5ibHVyKCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmZvY3VzKCk7XG59O1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdXNlO1xuXG5mdW5jdGlvbiBNb3VzZSgpIHtcbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAgIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCd0b3VjaHN0YXJ0JywgdGhpcy5vbmRvd24pO1xuICB9XG4gIHRoaXMubm9kZSA9IG5vZGU7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCd0b3VjaHN0YXJ0JywgdGhpcy5vbmRvd24pO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZG93biA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZG93bicsIGUpO1xuICB0aGlzLm9uY2xpY2soZSk7XG4gIHRoaXMubWF5YmVEcmFnKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub251cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd1cCcsIGUpO1xuICBpZiAoIXRoaXMuZG93bikgcmV0dXJuO1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmRyYWdFbmQoKTtcbiAgdGhpcy5tYXliZURyYWdFbmQoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmNsaWNrID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnJlc2V0Q2xpY2tzKCk7XG4gIHRoaXMuY2xpY2tzID0gKHRoaXMuY2xpY2tzICUgMykgKyAxO1xuICB0aGlzLmVtaXQoJ2NsaWNrJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25tYXliZWRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuXG4gIHZhciBkID1cbiAgICAgIE1hdGguYWJzKHRoaXMucG9pbnQueCAtIHRoaXMuZG93bi54KVxuICAgICsgTWF0aC5hYnModGhpcy5wb2ludC55IC0gdGhpcy5kb3duLnkpO1xuXG4gIGlmIChkID4gNSkge1xuICAgIHRoaXMubWF5YmVEcmFnRW5kKCk7XG4gICAgdGhpcy5kcmFnQmVnaW4oKTtcbiAgfVxufTtcblxuTW91c2UucHJvdG90eXBlLm9uZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZHJhZycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGJlZ2luJyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgZW5kJyk7XG59O1xuXG5cbk1vdXNlLnByb3RvdHlwZS5yZXNldENsaWNrcyA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsaWNrcyA9IDA7XG59LCAzNTApO1xuXG5Nb3VzZS5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcblxudmFyIFRIUk9UVExFID0gMCAvLzEwMDAvNjI7XG5cbnZhciBtYXAgPSB7XG4gIDg6ICdiYWNrc3BhY2UnLFxuICA5OiAndGFiJyxcbiAgMTM6ICdlbnRlcicsXG4gIDMzOiAncGFnZXVwJyxcbiAgMzQ6ICdwYWdlZG93bicsXG4gIDM1OiAnZW5kJyxcbiAgMzY6ICdob21lJyxcbiAgMzc6ICdsZWZ0JyxcbiAgMzg6ICd1cCcsXG4gIDM5OiAncmlnaHQnLFxuICA0MDogJ2Rvd24nLFxuICA0NjogJ2RlbGV0ZScsXG4gIDQ4OiAnMCcsXG4gIDQ5OiAnMScsXG4gIDUwOiAnMicsXG4gIDUxOiAnMycsXG4gIDUyOiAnNCcsXG4gIDUzOiAnNScsXG4gIDU0OiAnNicsXG4gIDU1OiAnNycsXG4gIDU2OiAnOCcsXG4gIDU3OiAnOScsXG4gIDY1OiAnYScsXG4gIDY4OiAnZCcsXG4gIDcwOiAnZicsXG4gIDc3OiAnbScsXG4gIDc4OiAnbicsXG4gIDgzOiAncycsXG4gIDg5OiAneScsXG4gIDkwOiAneicsXG4gIDExMjogJ2YxJyxcbiAgMTE0OiAnZjMnLFxuICAxMjI6ICdmMTEnLFxuICAxODg6ICcsJyxcbiAgMTkwOiAnLicsXG4gIDE5MTogJy8nLFxuXG4gIC8vIG51bXBhZFxuICA5NzogJ2VuZCcsXG4gIDk4OiAnZG93bicsXG4gIDk5OiAncGFnZWRvd24nLFxuICAxMDA6ICdsZWZ0JyxcbiAgMTAyOiAncmlnaHQnLFxuICAxMDM6ICdob21lJyxcbiAgMTA0OiAndXAnLFxuICAxMDU6ICdwYWdldXAnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBUZXh0O1xuXG5UZXh0Lm1hcCA9IG1hcDtcblxuZnVuY3Rpb24gVGV4dCgpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGV4dGFyZWEnKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHBvc2l0aW9uOiAnYWJzb2x1dGUnLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIHdpZHRoOiAxLFxuICAgIGhlaWdodDogMSxcbiAgICBvcGFjaXR5OiAwLFxuICAgIHpJbmRleDogMTAwMDBcbiAgfSk7XG5cbiAgZG9tLmF0dHJzKHRoaXMsIHtcbiAgICBhdXRvY2FwaXRhbGl6ZTogJ25vbmUnLFxuICAgIGF1dG9jb21wbGV0ZTogJ29mZicsXG4gICAgc3BlbGxjaGVja2luZzogJ29mZicsXG4gIH0pO1xuXG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuVGV4dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5UZXh0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5vbmN1dCA9IHRoaXMub25jdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmNvcHkgPSB0aGlzLm9uY29weS5iaW5kKHRoaXMpO1xuICB0aGlzLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGUuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleXVwID0gdGhpcy5vbmtleXVwLmJpbmQodGhpcyk7XG4gIHRoaXMuZWwub25ibHVyID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKTtcbiAgdGhpcy5lbC5vbmZvY3VzID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJyk7XG4gIHRoaXMuZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5lbC5vbmtleXVwID0gdGhpcy5vbmtleXVwO1xuICB0aGlzLmVsLm9uY3V0ID0gdGhpcy5vbmN1dDtcbiAgdGhpcy5lbC5vbmNvcHkgPSB0aGlzLm9uY29weTtcbiAgdGhpcy5lbC5vbnBhc3RlID0gdGhpcy5vbnBhc3RlO1xufTtcblxuVGV4dC5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xufVxuXG5UZXh0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWwudmFsdWUuc3Vic3RyKC0xKTtcbn07XG5cblRleHQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHRoaXMuZWwudmFsdWUgPSB2YWx1ZTtcbn07XG5cbi8vVE9ETzogb24gbW9iaWxlIHdlIG5lZWQgdG8gY2xlYXIgd2l0aG91dCBkZWJvdW5jZVxuLy8gb3IgdGhlIHRleHRhcmVhIGNvbnRlbnQgaXMgZGlzcGxheWVkIGluIGhhY2tlcidzIGtleWJvYXJkXG4vLyBvciB5b3UgbmVlZCB0byBkaXNhYmxlIHdvcmQgc3VnZ2VzdGlvbnMgaW4gaGFja2VyJ3Mga2V5Ym9hcmQgc2V0dGluZ3NcblRleHQucHJvdG90eXBlLmNsZWFyID0gdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbn0sIDIwMDApO1xuXG5UZXh0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuYmx1cigpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5mb2N1cygpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAvLyBmb3JjZXMgY2FyZXQgdG8gZW5kIG9mIHRleHRhcmVhIHNvIHdlIGNhbiBnZXQgLnNsaWNlKC0xKSBjaGFyXG4gIHNldEltbWVkaWF0ZSgoKSA9PiB0aGlzLmVsLnNlbGVjdGlvblN0YXJ0ID0gdGhpcy5lbC52YWx1ZS5sZW5ndGgpO1xuICB0aGlzLmVtaXQoJ3RleHQnLCB0aGlzLmdldCgpKTtcbiAgdGhpcy5jbGVhcigpO1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIC8vIGNvbnNvbGUubG9nKGUud2hpY2gpO1xuICB2YXIgbm93ID0gRGF0ZS5ub3coKTtcbiAgaWYgKG5vdyAtIHRoaXMudGhyb3R0bGVUaW1lIDwgVEhST1RUTEUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gbm93O1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5dXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0ICYmICFlLnNoaWZ0S2V5KSBrZXlzLnB1c2goJ3NoaWZ0OnVwJyk7XG4gIGlmIChtLmN0cmwgJiYgIWUuY3RybEtleSkga2V5cy5wdXNoKCdjdHJsOnVwJyk7XG4gIGlmIChtLmFsdCAmJiAhZS5hbHRLZXkpIGtleXMucHVzaCgnYWx0OnVwJyk7XG5cbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0gKyAnOnVwJyk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2N1dCcsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25jb3B5ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY29weScsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25wYXN0ZSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ3Bhc3RlJywgZSk7XG59O1xuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uL2xpYi9yZWdleHAnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vbGliL3BvaW50Jyk7XG5cbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd3b3JkcyddLCAnZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdmU7XG5cbmZ1bmN0aW9uIE1vdmUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG59XG5cbk1vdmUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW92ZS5wcm90b3R5cGUucGFnZURvd24gPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgc2l6ZSAtIHJlbWFpbmRlcik7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMocGFnZSk7XG59O1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlVXAgPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgLShzaXplIC0gcmVtYWluZGVyKSk7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMoLXBhZ2UpO1xufTtcblxudmFyIG1vdmUgPSB7fTtcblxubW92ZS5ieVdvcmQgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciBsaW5lID0gYnVmZmVyLmdldExpbmVUZXh0KHAueSk7XG5cbiAgaWYgKGR4ID4gMCAmJiBwLnggPj0gbGluZS5sZW5ndGggLSAxKSB7IC8vIGF0IGVuZCBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsICsxKTsgLy8gbW92ZSBvbmUgY2hhciByaWdodFxuICB9IGVsc2UgaWYgKGR4IDwgMCAmJiBwLnggPT09IDApIHsgLy8gYXQgYmVnaW4gb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCAtMSk7IC8vIG1vdmUgb25lIGNoYXIgbGVmdFxuICB9XG5cbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKGxpbmUsIFdPUkRTKTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGR4IDwgMCkgd29yZHMucmV2ZXJzZSgpO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKGR4ID4gMFxuICAgICAgPyB3b3JkLmluZGV4ID4gcC54XG4gICAgICA6IHdvcmQuaW5kZXggPCBwLngpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHg6IHdvcmQuaW5kZXgsXG4gICAgICAgIHk6IHAueVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyByZWFjaGVkIGJlZ2luL2VuZCBvZiBmaWxlXG4gIHJldHVybiBkeCA+IDBcbiAgICA/IG1vdmUuZW5kT2ZMaW5lKGJ1ZmZlciwgcClcbiAgICA6IG1vdmUuYmVnaW5PZkxpbmUoYnVmZmVyLCBwKTtcbn07XG5cbm1vdmUuYnlDaGFycyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeCA8IDApIHsgLy8gZ29pbmcgbGVmdFxuICAgIHggKz0gZHg7IC8vIG1vdmUgbGVmdFxuICAgIGlmICh4IDwgMCkgeyAvLyB3aGVuIHBhc3QgbGVmdCBlZGdlXG4gICAgICBpZiAoeSA+IDApIHsgLy8gYW5kIGxpbmVzIGFib3ZlXG4gICAgICAgIHkgLT0gMTsgLy8gbW92ZSB1cCBhIGxpbmVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gYW5kIGdvIHRvIHRoZSBlbmQgb2YgbGluZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeCA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKGR4ID4gMCkgeyAvLyBnb2luZyByaWdodFxuICAgIHggKz0gZHg7IC8vIG1vdmUgcmlnaHRcbiAgICB3aGlsZSAoeCAtIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCA+IDApIHsgLy8gd2hpbGUgcGFzdCBsaW5lIGxlbmd0aFxuICAgICAgaWYgKHkgPT09IGJ1ZmZlci5sb2MoKSkgeyAvLyBvbiBlbmQgb2YgZmlsZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBnbyB0byBlbmQgb2YgbGluZSBvbiBsYXN0IGxpbmVcbiAgICAgICAgYnJlYWs7IC8vIGFuZCBleGl0XG4gICAgICB9XG4gICAgICB4IC09IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCArIDE7IC8vIHdyYXAgdGhpcyBsaW5lIGxlbmd0aFxuICAgICAgeSArPSAxOyAvLyBhbmQgbW92ZSBkb3duIGEgbGluZVxuICAgIH1cbiAgfVxuXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5ieUxpbmVzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeSkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR5IDwgMCkgeyAvLyBnb2luZyB1cFxuICAgIGlmICh5ICsgZHkgPiAwKSB7IC8vIHdoZW4gbGluZXMgYWJvdmVcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgdXBcbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IDA7XG4gICAgfVxuICB9IGVsc2UgaWYgKGR5ID4gMCkgeyAvLyBnb2luZyBkb3duXG4gICAgaWYgKHkgPCBidWZmZXIubG9jKCkgLSBkeSkgeyAvLyB3aGVuIGxpbmVzIGJlbG93XG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIGRvd25cbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IGJ1ZmZlci5sb2MoKTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiAoeCA+IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoKSB7XG4gIC8vICAgeCA9IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoO1xuICAvLyB9IGVsc2Uge1xuICAvLyB9XG4gIHggPSBNYXRoLm1pbih0aGlzLmxhc3REZWxpYmVyYXRlWCwgYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoKTtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mTGluZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mTGluZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgeCA9IGJ1ZmZlci5nZXRMaW5lKHAueSkubGVuZ3RoO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IEluZmluaXR5O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZGaWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICB2YXIgeCA9IGJ1ZmZlci5nZXRMaW5lKGxhc3QpLmxlbmd0aFxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBsYXN0XG4gIH07XG59O1xuXG5tb3ZlLmlzQmVnaW5PZkZpbGUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHJldHVybiBwLnggPT09IDAgJiYgcC55ID09PSAwO1xufTtcblxubW92ZS5pc0VuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgcmV0dXJuIHAueSA9PT0gbGFzdCAmJiBwLnggPT09IGJ1ZmZlci5nZXRMaW5lKGxhc3QpLmxlbmd0aDtcbn07XG5cbk9iamVjdC5rZXlzKG1vdmUpLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gIE1vdmUucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbihwYXJhbSwgYnlFZGl0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG1vdmVbbWV0aG9kXS5jYWxsKFxuICAgICAgdGhpcyxcbiAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlcixcbiAgICAgIHRoaXMuZWRpdG9yLmNhcmV0LFxuICAgICAgcGFyYW1cbiAgICApO1xuXG4gICAgaWYgKCdpcycgPT09IG1ldGhvZC5zbGljZSgwLDIpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgdGhpcy5lbWl0KCdtb3ZlJywgcmVzdWx0LCBieUVkaXQpO1xuICB9O1xufSk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImVkaXRvclwiOlwiX3NyY19zdHlsZV9fZWRpdG9yXCIsXCJsYXllclwiOlwiX3NyY19zdHlsZV9fbGF5ZXJcIixcInJvd3NcIjpcIl9zcmNfc3R5bGVfX3Jvd3NcIixcIm1hcmtcIjpcIl9zcmNfc3R5bGVfX21hcmtcIixcImNvZGVcIjpcIl9zcmNfc3R5bGVfX2NvZGVcIixcImNhcmV0XCI6XCJfc3JjX3N0eWxlX19jYXJldFwiLFwiYmxpbmstc21vb3RoXCI6XCJfc3JjX3N0eWxlX19ibGluay1zbW9vdGhcIixcImNhcmV0LWJsaW5rLXNtb290aFwiOlwiX3NyY19zdHlsZV9fY2FyZXQtYmxpbmstc21vb3RoXCIsXCJndXR0ZXJcIjpcIl9zcmNfc3R5bGVfX2d1dHRlclwiLFwicnVsZXJcIjpcIl9zcmNfc3R5bGVfX3J1bGVyXCIsXCJhYm92ZVwiOlwiX3NyY19zdHlsZV9fYWJvdmVcIixcImZpbmRcIjpcIl9zcmNfc3R5bGVfX2ZpbmRcIixcImJsb2NrXCI6XCJfc3JjX3N0eWxlX19ibG9ja1wifSIsInZhciBkb20gPSByZXF1aXJlKCcuLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zdHlsZS5jc3MnKTtcblxudmFyIHRoZW1lcyA9IHtcbiAgbW9ub2thaToge1xuICAgIGJhY2tncm91bmQ6ICcjMjcyODIyJyxcbiAgICBjb2xvcjogJyNGOEY4RjInLFxuICAgIGtleXdvcmQ6ICcjREYyMjY2JyxcbiAgICBmdW5jdGlvbjogJyNBMEQ5MkUnLFxuICAgIGRlY2xhcmU6ICcjNjFDQ0UwJyxcbiAgICBudW1iZXI6ICcjQUI3RkZCJyxcbiAgICBwYXJhbXM6ICcjRkQ5NzFGJyxcbiAgICBjb21tZW50OiAnIzc1NzE1RScsXG4gICAgc3RyaW5nOiAnI0U2REI3NCcsXG4gIH0sXG5cbiAgd2VzdGVybjoge1xuICAgIGJhY2tncm91bmQ6ICcjRDlEMUIxJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjN0EzQjNCJyxcbiAgICBmdW5jdGlvbjogJyMyNTZGNzUnLFxuICAgIGRlY2xhcmU6ICcjNjM0MjU2JyxcbiAgICBudW1iZXI6ICcjMTM0RDI2JyxcbiAgICBwYXJhbXM6ICcjMDgyNjYzJyxcbiAgICBjb21tZW50OiAnIzk5OEU2RScsXG4gICAgc3RyaW5nOiAnI0M0M0MzQycsXG4gIH0sXG5cbiAgcmVkYmxpc3M6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MUUxNicsXG4gICAgY29sb3I6ICcjRTlFM0QxJyxcbiAgICBrZXl3b3JkOiAnI0ExMzYzMCcsXG4gICAgZnVuY3Rpb246ICcjQjNERjAyJyxcbiAgICBkZWNsYXJlOiAnI0Y2MzgzMycsXG4gICAgbnVtYmVyOiAnI0ZGOUY0RScsXG4gICAgcGFyYW1zOiAnI0EwOTBBMCcsXG4gICAgcmVnZXhwOiAnI0JENzBGNCcsXG4gICAgY29tbWVudDogJyM2MzUwNDcnLFxuICAgIHN0cmluZzogJyMzRUExRkInLFxuICB9LFxuXG4gIGRheWxpZ2h0OiB7XG4gICAgYmFja2dyb3VuZDogJyNFQkVCRUInLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyNGRjFCMUInLFxuICAgIGZ1bmN0aW9uOiAnIzAwMDVGRicsXG4gICAgZGVjbGFyZTogJyMwQzdBMDAnLFxuICAgIG51bWJlcjogJyM4MDIxRDQnLFxuICAgIHBhcmFtczogJyM0QzY5NjknLFxuICAgIGNvbW1lbnQ6ICcjQUJBQkFCJyxcbiAgICBzdHJpbmc6ICcjRTY3MDAwJyxcbiAgfSxcbn07XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHNldFRoZW1lO1xuZXhwb3J0cy50aGVtZXMgPSB0aGVtZXM7XG5cbi8qXG50OiBvcGVyYXRvclxuazoga2V5d29yZFxuZDogZGVjbGFyZVxuYjogYnVpbHRpblxubzogYm9vbGVhblxubjogbnVtYmVyXG5tOiBwYXJhbXNcbmY6IGZ1bmN0aW9uXG5yOiByZWdleHBcbmM6IGNvbW1lbnRcbnM6IHN0cmluZ1xubDogc3ltYm9sXG54OiBpbmRlbnRcbiAqL1xuZnVuY3Rpb24gc2V0VGhlbWUobmFtZSkge1xuICB2YXIgdCA9IHRoZW1lc1tuYW1lXTtcbiAgZG9tLmNzcygndGhlbWUnLFxuYFxuLiR7bmFtZX0ge1xuICBiYWNrZ3JvdW5kOiAke3QuYmFja2dyb3VuZH07XG59XG5cbnQsXG5rIHtcbiAgY29sb3I6ICR7dC5rZXl3b3JkfTtcbn1cblxuZCxcbm4ge1xuICBjb2xvcjogJHt0LmRlY2xhcmV9O1xufVxuXG5vLFxuZSB7XG4gIGNvbG9yOiAke3QubnVtYmVyfTtcbn1cblxubSB7XG4gIGNvbG9yOiAke3QucGFyYW1zfTtcbn1cblxuZiB7XG4gIGNvbG9yOiAke3QuZnVuY3Rpb259O1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbnIge1xuICBjb2xvcjogJHt0LnJlZ2V4cCB8fCB0LnBhcmFtc307XG59XG5cbmMge1xuICBjb2xvcjogJHt0LmNvbW1lbnR9O1xufVxuXG5zIHtcbiAgY29sb3I6ICR7dC5zdHJpbmd9O1xufVxuXG5sLFxuLiR7Y3NzLmNvZGV9IHtcbiAgY29sb3I6ICR7dC5jb2xvcn07XG59XG5cbi4ke2Nzcy5jYXJldH0ge1xuICBiYWNrZ3JvdW5kOiAke3QuY29sb3J9O1xufVxuXG5tLFxuZCB7XG4gIGZvbnQtc3R5bGU6IGl0YWxpYztcbn1cblxubCB7XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxueCB7XG4gIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgYmFja2dyb3VuZC1yZXBlYXQ6IG5vLXJlcGVhdDtcbn1cbmBcbiAgKVxuXG59XG5cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb2NrVmlldztcblxuZnVuY3Rpb24gQmxvY2tWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2Jsb2NrJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmJsb2NrKTtcbiAgdGhpcy5odG1sID0gJyc7XG59XG5cbkJsb2NrVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbkJsb2NrVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cbkJsb2NrVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oZSkge1xuICB2YXIgaHRtbCA9ICcnO1xuXG4gIHZhciBPcGVuID0ge1xuICAgICd7JzogJ2N1cmx5JyxcbiAgICAnWyc6ICdzcXVhcmUnLFxuICAgICcoJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgQ2xvc2UgPSB7XG4gICAgJ30nOiAnY3VybHknLFxuICAgICddJzogJ3NxdWFyZScsXG4gICAgJyknOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBvZmZzZXQgPSBlLmJ1ZmZlci5nZXRQb2ludChlLmNhcmV0KS5vZmZzZXQ7XG5cbiAgdmFyIHJlc3VsdCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeU9mZnNldCgnYmxvY2tzJywgb2Zmc2V0KTtcbiAgaWYgKCFyZXN1bHQpIHJldHVybiBodG1sO1xuXG4gIHZhciBsZW5ndGggPSBlLmJ1ZmZlci50b2tlbnMuZ2V0Q29sbGVjdGlvbignYmxvY2tzJykubGVuZ3RoO1xuICB2YXIgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChyZXN1bHQpO1xuXG4gIHZhciBvcGVuO1xuICB2YXIgY2xvc2U7XG5cbiAgdmFyIGkgPSByZXN1bHQuaW5kZXg7XG4gIHZhciBvcGVuT2Zmc2V0ID0gcmVzdWx0Lm9mZnNldDtcblxuICBjaGFyID0gZS5idWZmZXIuY2hhckF0KG9wZW5PZmZzZXQpO1xuXG4gIHZhciBjb3VudCA9IHJlc3VsdC5vZmZzZXQgPj0gb2Zmc2V0IC0gMSAmJiBDbG9zZVtjaGFyXSA/IDAgOiAxO1xuXG4gIHZhciBsaW1pdCA9IDIwMDtcblxuICB3aGlsZSAoaSA+IDApIHtcbiAgICBvcGVuID0gT3BlbltjaGFyXTtcbiAgICBpZiAoQ2xvc2VbY2hhcl0pIGNvdW50Kys7XG4gICAgaWYgKCEtLWxpbWl0KSByZXR1cm4gaHRtbDtcblxuICAgIGlmIChvcGVuICYmICEtLWNvdW50KSBicmVhaztcblxuICAgIG9wZW5PZmZzZXQgPSBlLmJ1ZmZlci50b2tlbnMuZ2V0QnlJbmRleCgnYmxvY2tzJywgLS1pKTtcbiAgICBjaGFyID0gZS5idWZmZXIuY2hhckF0KG9wZW5PZmZzZXQpO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICBjb3VudCA9IDE7XG5cbiAgdmFyIGNsb3NlT2Zmc2V0O1xuXG4gIHdoaWxlIChpIDwgbGVuZ3RoIC0gMSkge1xuICAgIGNsb3NlT2Zmc2V0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5SW5kZXgoJ2Jsb2NrcycsICsraSk7XG4gICAgY2hhciA9IGUuYnVmZmVyLmNoYXJBdChjbG9zZU9mZnNldCk7XG4gICAgaWYgKCEtLWxpbWl0KSByZXR1cm4gaHRtbDtcblxuICAgIGNsb3NlID0gQ2xvc2VbY2hhcl07XG4gICAgaWYgKE9wZW5bY2hhcl0gPT09IG9wZW4pIGNvdW50Kys7XG4gICAgaWYgKG9wZW4gPT09IGNsb3NlKSBjb3VudC0tO1xuXG4gICAgaWYgKCFjb3VudCkgYnJlYWs7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIHZhciBiZWdpbiA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KG9wZW5PZmZzZXQpO1xuICB2YXIgZW5kID0gZS5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQoY2xvc2VPZmZzZXQpO1xuXG4gIHZhciB0YWJzO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhiZWdpbik7XG5cbiAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICsgJ3dpZHRoOicgKyBlLmNoYXIud2lkdGggKyAncHg7J1xuICAgICAgICArICd0b3A6JyArIChiZWdpbi55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoKGJlZ2luLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKGVuZCk7XG5cbiAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICsgJ3dpZHRoOicgKyBlLmNoYXIud2lkdGggKyAncHg7J1xuICAgICAgICArICd0b3A6JyArIChlbmQueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChlbmQueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICByZXR1cm4gaHRtbDtcbn1cblxuQmxvY2tWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGh0bWwgPSB0aGlzLmdldCh0aGlzLmVkaXRvcik7XG5cbiAgaWYgKGh0bWwgIT09IHRoaXMuaHRtbCkge1xuICAgIHRoaXMuaHRtbCA9IGh0bWw7XG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG4gIH1cbn07XG5cbkJsb2NrVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ2FyZXRWaWV3O1xuXG5mdW5jdGlvbiBDYXJldFZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnY2FyZXQnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY2FyZXQpO1xufVxuXG5DYXJldFZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5DYXJldFZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5DYXJldFZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIG9wYWNpdHk6ICt0aGlzLmVkaXRvci5oYXNGb2N1cyxcbiAgICBsZWZ0OiB0aGlzLmVkaXRvci5jYXJldFB4LnggKyB0aGlzLmVkaXRvci5tYXJnaW5MZWZ0LFxuICAgIHRvcDogdGhpcy5lZGl0b3IuY2FyZXRQeC55IC0gMSxcbiAgICBoZWlnaHQ6IHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0ICsgMVxuICB9KTtcbn07XG5cbkNhcmV0Vmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBvcGFjaXR5OiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG52YXIgQWhlYWRUaHJlc2hvbGQgPSB7XG4gIGFuaW1hdGlvbjogWy4xNSwgLjRdLFxuICBub3JtYWw6IFsuNzUsIDEuNV1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ29kZVZpZXc7XG5cbmZ1bmN0aW9uIENvZGVWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcblxuICB0aGlzLm5hbWUgPSAnY29kZSc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jb2RlKTtcbiAgdGhpcy5wYXJ0cyA9IFtdO1xufVxuXG5Db2RlVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbkNvZGVWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgdGhpcy50YXJnZXQgPSB0YXJnZXQ7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyUGFydCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBwYXJ0ID0gbmV3IFBhcnQodGhpcywgcmFuZ2UpO1xuICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIHBhcnQucmVuZGVyKCk7XG4gIHBhcnQuYXBwZW5kKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyRWRpdCA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwwXSk7XG4gIGlmIChlZGl0LnNoaWZ0ID4gMCkgdGhpcy5yZW5kZXJJbnNlcnQoZWRpdCk7XG4gIGVsc2UgaWYgKGVkaXQuc2hpZnQgPCAwKSB0aGlzLnJlbmRlclJlbW92ZShlZGl0KTtcbiAgZWxzZSB0aGlzLnJlbmRlckxpbmUoZWRpdCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyUGFnZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbMCwwXSk7XG4gIHZhciBpblBhcnRzID0gdGhpcy5pblJhbmdlUGFydHMocGFnZSk7XG4gIHZhciBuZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKHBhZ2UsIHRoaXMucGFydHMpO1xuICBuZWVkUmFuZ2VzLmZvckVhY2gocmFuZ2UgPT4gdGhpcy5yZW5kZXJQYXJ0KHJhbmdlKSk7XG4gIGluUGFydHMuZm9yRWFjaChwYXJ0ID0+IHBhcnQucmVuZGVyKCkpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclJlbW92ZSA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA+IGVkaXQucmFuZ2VbMF0gJiYgcGFydFsxXSA8IGVkaXQucmFuZ2VbMV0pIHtcbiAgICAgIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA8IGVkaXQubGluZSAmJiBwYXJ0WzFdID49IGVkaXQubGluZSkge1xuICAgICAgcGFydFsxXSA9IGVkaXQubGluZSAtIDE7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoW2VkaXQubGluZSwgZWRpdC5saW5lXSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSAmJiBwYXJ0WzFdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSAmJiBwYXJ0WzFdID4gZWRpdC5saW5lKSB7XG4gICAgICB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoW2VkaXQubGluZSwgZWRpdC5saW5lXSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUgJiYgcGFydFswXSArIGVkaXQuc2hpZnQgPD0gZWRpdC5saW5lKSB7XG4gICAgICB2YXIgb2Zmc2V0ID0gZWRpdC5saW5lIC0gKHBhcnRbMF0gKyBlZGl0LnNoaWZ0KSArIDE7XG4gICAgICBwYXJ0WzBdICs9IGVkaXQuc2hpZnQgKyBvZmZzZXQ7XG4gICAgICBwYXJ0WzFdICs9IGVkaXQuc2hpZnQgKyBvZmZzZXQ7XG4gICAgICBwYXJ0Lm9mZnNldChvZmZzZXQpO1xuICAgICAgaWYgKHBhcnRbMF0gPj0gcGFydFsxXSkgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0WzBdICs9IGVkaXQuc2hpZnQ7XG4gICAgICBwYXJ0WzFdICs9IGVkaXQuc2hpZnQ7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUGFnZSgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckluc2VydCA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA8IGVkaXQubGluZSAmJiBwYXJ0WzFdID49IGVkaXQubGluZSkge1xuICAgICAgcGFydFsxXSA9IGVkaXQubGluZSAtIDE7XG4gICAgICBwYXJ0LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoZWRpdC5yYW5nZSk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSkge1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJMaW5lID0gZnVuY3Rpb24oZWRpdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzLnNsaWNlKCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHBhcnRzW2ldO1xuICAgIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdIDw9IGVkaXQubGluZSAmJiBwYXJ0WzFdID49IGVkaXQubGluZSkge1xuICAgICAgcGFydFsxXSA9IGVkaXQubGluZSAtIDE7XG4gICAgICBpZiAocGFydFsxXSA8IHBhcnRbMF0pIHRoaXMucmVtb3ZlUGFydChwYXJ0KVxuICAgICAgZWxzZSBwYXJ0LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclBhcnQoZWRpdC5yYW5nZSk7XG4gICAgfVxuICB9XG4gIHRoaXMucmVuZGVyUGFnZSgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbW92ZVBhcnQgPSBmdW5jdGlvbihwYXJ0KSB7XG4gIHBhcnQuY2xlYXIoKTtcbiAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKHBhcnQpLCAxKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5jbGVhck91dFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMub3V0UmFuZ2VQYXJ0cyh0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UocmFuZ2UpKVxuICAgIC5mb3JFYWNoKHBhcnQgPT4gdGhpcy5yZW1vdmVQYXJ0KHBhcnQpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5pblJhbmdlUGFydHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSB0aGlzLnBhcnRzW2ldO1xuICAgIGlmICggcGFydFswXSA+PSByYW5nZVswXSAmJiBwYXJ0WzBdIDw9IHJhbmdlWzFdXG4gICAgICB8fCBwYXJ0WzFdID49IHJhbmdlWzBdICYmIHBhcnRbMV0gPD0gcmFuZ2VbMV0gKSB7XG4gICAgICBwYXJ0cy5wdXNoKHBhcnQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUub3V0UmFuZ2VQYXJ0cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMucGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcGFydCA9IHRoaXMucGFydHNbaV07XG4gICAgaWYgKCBwYXJ0WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHBhcnRbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHBhcnRzLnB1c2gocGFydCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwYXJ0cztcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuZWRpdG9yLmVkaXRpbmcpIHJldHVybjtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbMCwwXSk7XG5cbiAgaWYgKFJhbmdlLk5PVChwYWdlLCB0aGlzLnBhcnRzKS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoUmFuZ2UuQU5EKHBhZ2UsIHRoaXMucGFydHMpLmxlbmd0aCA9PT0gMCkge1xuICAgIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xuICAgIHRoaXMucmVuZGVyUGFydChwYWdlKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBjaGVjayBpZiB3ZSdyZSBwYXN0IHRoZSB0aHJlc2hvbGQgb2Ygdmlld1xuICB2YXIgdGhyZXNob2xkID0gdGhpcy5lZGl0b3IuYW5pbWF0aW9uUnVubmluZ1xuICAgID8gWy1BaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF0sICtBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF1dXG4gICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFswXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFswXV07XG5cbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB0aGlzLnBhcnRzKTtcbiAgaWYgKGFoZWFkTmVlZFJhbmdlcy5sZW5ndGgpIHtcbiAgICAvLyBpZiBzbywgcmVuZGVyIGZ1cnRoZXIgYWhlYWQgdG8gaGF2ZSBzb21lXG4gICAgLy8gbWFyZ2luIHRvIHNjcm9sbCB3aXRob3V0IHRyaWdnZXJpbmcgbmV3IHJlbmRlcnNcblxuICAgIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICAgID8gWy1BaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMV0sICtBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMV1dXG4gICAgICA6IFstQWhlYWRUaHJlc2hvbGQubm9ybWFsWzFdLCArQWhlYWRUaHJlc2hvbGQubm9ybWFsWzFdXTtcblxuICAgIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcblxuICAgIGFoZWFkUmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcbiAgICBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdGhpcy5wYXJ0cyk7XG4gICAgYWhlYWROZWVkUmFuZ2VzLmZvckVhY2gocmFuZ2UgPT4ge1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KHJhbmdlKTtcbiAgICB9KTtcbiAgfVxufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucGFydHMuZm9yRWFjaChwYXJ0ID0+IHBhcnQuY2xlYXIoKSk7XG4gIHRoaXMucGFydHMgPSBbXTtcbn07XG5cbmZ1bmN0aW9uIFBhcnQodmlldywgcmFuZ2UpIHtcbiAgdGhpcy52aWV3ID0gdmlldztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNvZGUpO1xuICB0aGlzLmNvZGUgPSAnJztcbiAgdGhpcy5vZmZzZXRUb3AgPSAwO1xuICB0aGlzWzBdID0gcmFuZ2VbMF07XG4gIHRoaXNbMV0gPSByYW5nZVsxXTtcblxuICB2YXIgc3R5bGUgPSB7fTtcblxuICBpZiAodGhpcy52aWV3LmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVyc1xuICAmJiB+dGhpcy52aWV3LmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVycy5pbmRleE9mKHRoaXMudmlldy5uYW1lKSkge1xuICAgIHN0eWxlLmJhY2tncm91bmQgPSAnIydcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNilcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNilcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNik7XG4gICAgc3R5bGUub3BhY2l0eSA9IDAuNTtcbiAgfVxuXG4gIGRvbS5zdHlsZSh0aGlzLCBzdHlsZSk7XG59XG5cblBhcnQucHJvdG90eXBlLm9mZnNldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5vZmZzZXRUb3AgKz0geTtcbiAgdGhpcy5jb2RlID0gdGhpcy5jb2RlLnNwbGl0KC9cXG4vZykuc2xpY2UoeSkuam9pbignXFxuJyk7XG4gIHRoaXNbMV0gLT0geTtcbiAgdGhpcy5zdHlsZSgpO1xuICB0aGlzLmRvbS5lbC5zY3JvbGxUb3AgPSB0aGlzLm9mZnNldFRvcCAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHQ7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXcudGFyZ2V0LCB0aGlzKTtcbn07XG5cblBhcnQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29kZSA9IHRoaXMudmlldy5lZGl0b3IuYnVmZmVyLmdldCh0aGlzKTtcbiAgaWYgKGNvZGUgIT09IHRoaXMuY29kZSkge1xuICAgIGRvbS5odG1sKHRoaXMsIGNvZGUpO1xuICAgIHRoaXMuY29kZSA9IGNvZGU7XG4gIH1cbiAgdGhpcy5zdHlsZSgpO1xufTtcblxuUGFydC5wcm90b3R5cGUuc3R5bGUgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6ICh0aGlzWzFdIC0gdGhpc1swXSArIDEpICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodCxcbiAgICB0b3A6IHRoaXNbMF0gKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0XG4gIH0pO1xufTtcblxuUGFydC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnJlbW92ZSh0aGlzKTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaW5kVmlldztcblxuZnVuY3Rpb24gRmluZFZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnZmluZCc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5maW5kKTtcbn1cblxuRmluZFZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5GaW5kVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdIC0gMSkgYmVnaW4gPSBpO1xuICAgIGVsc2UgZW5kID0gaTtcbiAgfSB3aGlsZSAocHJldiAhPT0gaSk7XG5cbiAgdmFyIHdpZHRoID0gZS5maW5kVmFsdWUubGVuZ3RoICogZS5jaGFyLndpZHRoICsgJ3B4JztcblxuICB2YXIgaHRtbCA9ICcnO1xuICB2YXIgdGFicztcbiAgdmFyIHI7XG4gIHdoaWxlIChyZXN1bHRzW2ldICYmIHJlc3VsdHNbaV0ueSA8IHJhbmdlWzFdKSB7XG4gICAgciA9IHJlc3VsdHNbaSsrXTtcbiAgICB0YWJzID0gZS5nZXRQb2ludFRhYnMocik7XG4gICAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICAgKyAnd2lkdGg6JyArIHdpZHRoICsgJzsnXG4gICAgICAgICAgKyAndG9wOicgKyAoci55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICAgICsgJ2xlZnQ6JyArICgoci54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgICArICdcIj48L2k+JztcbiAgfVxuXG4gIHJldHVybiBodG1sO1xufTtcblxuRmluZFZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uaHRtbCh0aGlzLCAnJyk7XG59O1xuIiwidmFyIFJ1bGVyVmlldyA9IHJlcXVpcmUoJy4vcnVsZXInKTtcbnZhciBNYXJrVmlldyA9IHJlcXVpcmUoJy4vbWFyaycpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgQ2FyZXRWaWV3ID0gcmVxdWlyZSgnLi9jYXJldCcpO1xudmFyIEJsb2NrVmlldyA9IHJlcXVpcmUoJy4vYmxvY2snKTtcbnZhciBGaW5kVmlldyA9IHJlcXVpcmUoJy4vZmluZCcpO1xudmFyIFJvd3NWaWV3ID0gcmVxdWlyZSgnLi9yb3dzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlld3M7XG5cbmZ1bmN0aW9uIFZpZXdzKGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcblxuICB0aGlzLnZpZXdzID0gW1xuICAgIG5ldyBSdWxlclZpZXcoZWRpdG9yKSxcbiAgICBuZXcgTWFya1ZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQ29kZVZpZXcoZWRpdG9yKSxcbiAgICBuZXcgQ2FyZXRWaWV3KGVkaXRvciksXG4gICAgbmV3IEJsb2NrVmlldyhlZGl0b3IpLFxuICAgIG5ldyBGaW5kVmlldyhlZGl0b3IpLFxuICAgIG5ldyBSb3dzVmlldyhlZGl0b3IpLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcbn1cblxuVmlld3MucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcudXNlKGVsKSk7XG59O1xuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFya1ZpZXc7XG5cbmZ1bmN0aW9uIE1hcmtWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ21hcmsnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MubWFyayk7XG59XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuTWFya1ZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5NYXJrVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldHMgPSBlLmJ1ZmZlci5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcblxuICBhcmVhWzBdIC09IG9mZnNldHNbMF07XG4gIGFyZWFbMV0gLT0gb2Zmc2V0c1swXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKVxuICAgICsgJzxtYXJrPicgKyBlLnN5bnRheC5lbnRpdGllcyhtaWRkbGUpICsgJzwvbWFyaz4nO1xuXG4gIGh0bWwgPSBodG1sLnJlcGxhY2UoL1xcbi9nLCAnIFxcbicpO1xuXG4gIHJldHVybiBodG1sO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuXG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstLjUsKy41XSk7XG4gIHZhciBodG1sID0gdGhpcy5nZXQocGFnZSwgdGhpcy5lZGl0b3IpO1xuXG4gIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuXG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiBwYWdlWzBdICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAnYXV0bydcbiAgfSk7XG59O1xuXG5NYXJrVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJvd3NWaWV3O1xuXG5mdW5jdGlvbiBSb3dzVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdyb3dzJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLnJvd3MpO1xuICB0aGlzLnJvd3MgPSAtMTtcbiAgdGhpcy5yYW5nZSA9IFstMSwtMV07XG4gIHRoaXMuaHRtbCA9ICcnO1xufVxuXG5Sb3dzVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cblJvd3NWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuUm93c1ZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0xLCsxXSk7XG5cbiAgaWYgKCByYW5nZVswXSA+PSB0aGlzLnJhbmdlWzBdXG4gICAgJiYgcmFuZ2VbMV0gPD0gdGhpcy5yYW5nZVsxXVxuICAgICYmICggdGhpcy5yYW5nZVsxXSAhPT0gdGhpcy5yb3dzXG4gICAgICB8fCB0aGlzLmVkaXRvci5yb3dzID09PSB0aGlzLnJvd3NcbiAgICApKSByZXR1cm47XG5cbiAgcmFuZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0zLCszXSk7XG4gIHRoaXMucm93cyA9IHRoaXMuZWRpdG9yLnJvd3M7XG4gIHRoaXMucmFuZ2UgPSByYW5nZTtcblxuICB2YXIgaHRtbCA9ICcnO1xuICBmb3IgKHZhciBpID0gcmFuZ2VbMF07IGkgPD0gcmFuZ2VbMV07IGkrKykge1xuICAgIGh0bWwgKz0gKGkgKyAxKSArICdcXG4nO1xuICB9XG5cbiAgaWYgKGh0bWwgIT09IHRoaXMuaHRtbCkge1xuICAgIHRoaXMuaHRtbCA9IGh0bWw7XG5cbiAgICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICAgIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgICB0b3A6IHJhbmdlWzBdICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgICBoZWlnaHQ6IChyYW5nZVsxXSAtIHJhbmdlWzBdICsgMSkgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodFxuICAgIH0pO1xuICB9XG59O1xuXG5Sb3dzVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUnVsZXJWaWV3O1xuXG5mdW5jdGlvbiBSdWxlclZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAncnVsZXInO1xuICB0aGlzLmRvbSA9IGRvbShjc3MucnVsZXIpO1xufVxuXG5SdWxlclZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5SdWxlclZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5SdWxlclZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6ICh0aGlzLmVkaXRvci5yb3dzICsgdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQpXG4gICAgICAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0XG4gICAgICArIHRoaXMuZWRpdG9yLnBhZ2VSZW1haW5kZXIuaGVpZ2h0XG4gIH0pO1xufTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBkb20uc3R5bGUodGhpcywge1xuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuZnVuY3Rpb24gVmlldyhlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG59XG5cblZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ3JlbmRlciBub3QgaW1wbGVtZW50ZWQnKTtcbn07XG5cblZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRocm93IG5ldyBFcnJvcignY2xlYXIgbm90IGltcGxlbWVudGVkJyk7XG59O1xuIl19
