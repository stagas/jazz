(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Jazz
 */

var DefaultOptions = {
  theme: 'western',
  debug_layers: false,
  scroll_speed: 95,
  hide_rows: false,
  center_horizontal: false,
  center_vertical: false,
  margin_left: 15,
  gutter_margin: 20,
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

var NEWLINE = Regexp.create(['newline'], 'g');

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
    editRange: [-1,-1],
    editShift: 0,

    suggestIndex: 0,
    suggestRoot: '',
    suggestNodes: [],

    animationType: 'linear',
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
  this.bindEvents();
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
  this.focus = this.focus.bind(this);
  this.repaint = this.repaint.bind(this);
  this.repaintBelowCaret = this.repaintBelowCaret.bind(this);
};

Jazz.prototype.bindHandlers = function() {
  for (var method in this) {
    if ('on' === method.slice(0, 2)) {
      this[method] = this[method].bind(this);
    }
  }
};

Jazz.prototype.bindEvents = function() {
  this.bindHandlers()
  this.move.on('move', this.onMove);
  this.file.on('raw', this.onFileRaw); //TODO: should not need this event
  this.file.on('set', this.onFileSet);
  this.file.on('open', this.onFileOpen);
  this.file.on('change', this.onFileChange);
  this.file.on('before change', this.onBeforeFileChange);
  this.file.buffer.on('change segments', this.repaintBelowCaret);
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
  this.scroll.set(scroll);
  if (!this.editing) this.render();
  this.rest();
};

Jazz.prototype.rest = debounce(function() {
  this.editing = false;
  this.render();
}, 300);

Jazz.prototype.onMove = function(point, byEdit) {
  if (!byEdit) this.editing = false;
  if (point) this.setCaret(point);

  if (!byEdit) {
    if (this.input.text.modifiers.shift || this.input.mouse.down) this.markSet();
    else this.markClear();
  }

  this.emit('move');
  this.caretSolid();
  if (!this.editing) this.render();
};

Jazz.prototype.onResize = function() {
  this.repaint();
};

Jazz.prototype.onFocus = function(text) {
  this.hasFocus = true;
  this.emit('focus');
  this.views.caret.render();
  this.caretSolid();
};

Jazz.prototype.caretSolid = function() {
  dom.classes(this.views.caret, [css.caret]);
  this.caretBlink();
};

Jazz.prototype.caretBlink = debounce(function() {
  dom.classes(this.views.caret, [css.caret, css['blink-smooth']]);
}, 400);

Jazz.prototype.onBlur = function(text) {
  this.hasFocus = false;
  setTimeout(() => {
    if (!this.hasFocus) {
      dom.classes(this.views.caret, [css.caret]);
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
  var text = this.buffer.getAreaText(area);
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
  console.log('file raw!')
  this.clear();
  this.render();
};

Jazz.prototype.setTabMode = function(char) {
  if ('\t' === char) {
    this.tab = char;
  } else {
    this.tab = new Array(this.tabSize + 1).join(char);
  }
}

Jazz.prototype.onFileSet = function() {
  this.setCaret({ x:0, y:0 });
  // this.buffer.updateRaw();
  // this.setTabMode(this.buffer.syntax.tab);
  this.followCaret();
  this.repaint();
};

Jazz.prototype.onHistoryChange = function() {
  this.clear();
  this.repaint();
  this.followCaret();
};

Jazz.prototype.onBeforeFileChange = function() {
  // this.history.save();
  this.editCaretBefore = this.caret.copy();
};

Jazz.prototype.onFileChange = function(editRange, editShift, textBefore, textAfter) {
  this.animationRunning = false;
  this.editing = true;
  this.rows = this.buffer.loc();
  this.pageBounds = [0, this.rows];

  if (this.find.isOpen) {
    this.onFindValue(this.findValue, true);
  }

  // this.history.save();

  this.views.code.renderEdit({
    line: editRange[0],
    range: editRange,
    shift: editShift,
    caretNow: this.caret,
    caretBefore: this.editCaretBefore
  });

  this.render();

  this.emit('change');
};

Jazz.prototype.setCaretFromPx = function(px) {
  var g = new Point({ x: this.marginLeft, y: this.char.height/2 })['+'](this.offset);
  var p = px['-'](g)['+'](this.scroll)['o/'](this.char);

  p.y = Math.max(0, Math.min(p.y, this.buffer.loc()));
  p.x = Math.max(0, p.x);

  var tabs = this.getCoordsTabs(p);

  p.x = Math.max(
    0,
    Math.min(
      p.x - tabs.tabs + tabs.remainder,
      this.getLineLength(p.y)
    )
  );

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

Jazz.prototype.setCaret = function(p, center, animate) {
  this.caret.set(p);

  var tabs = this.getPointTabs(this.caret);

  this.caretPx.set({
    x: this.char.width * (this.caret.x + tabs.tabs * this.tabSize - tabs.remainder),
    y: this.char.height * this.caret.y
  });

  this.followCaret(center, animate);
};

Jazz.prototype.onMouseClick = function() {
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
  if (this.mark.active) {
    this.mark.end.set(this.caret);
    this.render();
  }
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
  this.render();
};

Jazz.prototype.getRange = function(range) {
  return Range.clamp(range, this.pageBounds);
};

Jazz.prototype.getPageRange = function(range) {
  var p = this.scroll['_/'](this.char);
  if (this.options.center_vertical) {
    p.y -= this.page.height / 3 | 0;
  }
  return this.getRange([
    Math.floor(p.y + this.page.height * range[0]),
    Math.ceil(p.y + this.page.height + this.page.height * range[1])
  ]);
};

Jazz.prototype.getLineLength = function(y) {
  return this.buffer.getLine(y).length;
};

Jazz.prototype.followCaret = function(center, animate) {
  var p = this.caretPx;
  var s = this.animationScrollTarget || this.scroll;

  var top = (
      s.y
    + (center && !this.options.center_vertical ? (this.size.height / 2 | 0) - 100 : 0)
  ) - p.y;

  var bottom = p.y - (
      s.y
    + this.size.height
    - (center && !this.options.center_vertical ? (this.size.height / 2 | 0) - 100 : 0)
    - (this.options.center_vertical ? (this.size.height / 3 * 2 | 0) : 0)
  ) + this.char.height;

  var left = (s.x + this.char.width) - p.x;
  var right = (p.x) - (s.x + this.size.width - this.marginLeft) + this.char.width * 2;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  // if (!this.animationRunning)
  if (left + top + right + bottom) {
    this[animate ? 'animateScrollBy' : 'scrollBy'](right - left, bottom - top, 'ease');
  }
  // else
    // this.animateScrollBy(right - left, bottom - top);
};

Jazz.prototype.scrollTo = function(p) {
  dom.scrollTo(this.el, p.x, p.y);
};

Jazz.prototype.scrollBy = function(x, y) {
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

Jazz.prototype.animateScrollBy = function(x, y, animationType) {
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
    y: Math.min(
        (this.rows + 1) * this.char.height - this.size.height
      + (this.options.center_vertical ? this.size.height / 3 * 2 | 0 : 0),
      Math.max(0, s.y + y)
    )
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

  if ((adx < 1 && ady < 1) || !this.animationRunning) {
    this.animationRunning = false;
    this.scrollTo(this.animationScrollTarget);
    this.animationScrollTarget = null;
    this.emit('animation end');
    return;
  }

  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  switch (this.animationType) {
    case 'linear':
      if (adx < speed) dx *= 0.9;
      else dx = Math.sign(dx) * speed;

      if (ady < speed) dy *= 0.9;
      else dy = Math.sign(dy) * speed;

      break;
    case 'ease':
      dx *= 0.5;
      dy *= 0.5;
      break;
  }

  this.scrollBy(dx, dy);
};

Jazz.prototype.insert = function(text) {
  if (this.mark.active) this.delete();

  var line = this.buffer.getLineText(this.caret.y);
  var right = line[this.caret.x];
  var hasRightSymbol = ~['}',']',')'].indexOf(right);

  // apply indent on enter
  if (NEWLINE.test(text)) {
    var isEndOfLine = this.caret.x === line.length - 1;
    var left = line[this.caret.x - 1];
    var indent = line.match(/\S/);
    indent = indent ? indent.index : line.length - 1;
    var hasLeftSymbol = ~['{','[','('].indexOf(left);

    if (hasLeftSymbol) indent += 2;

    if (isEndOfLine || hasLeftSymbol) {
      text += new Array(indent + 1).join(' ');
    }
  }

  var length;

  if (!hasRightSymbol || (hasRightSymbol && !~['}',']',')'].indexOf(text))) {
    length = this.buffer.insert(this.caret, text);
  } else {
    length = 1;
  }

  this.move.byChars(length, true);

  if ('{' === text) this.buffer.insert(this.caret, '}');
  else if ('(' === text) this.buffer.insert(this.caret, ')');
  else if ('[' === text) this.buffer.insert(this.caret, ']');

  if (hasLeftSymbol && hasRightSymbol) {
    indent -= 2;
    this.buffer.insert(this.caret, '\n' + new Array(indent + 1).join(' '));
  }
};

Jazz.prototype.backspace = function() {
  if (this.move.isBeginOfFile()) {
    if (this.mark.active && !this.move.isEndOfFile()) return this.delete();
    return;
  }
  if (this.mark.active) {
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.removeArea(area);
    this.markClear(true);
    this.clear();
    this.render();
  } else {
    this.move.byChars(-1, true);
    this.buffer.removeCharAtPoint(this.caret);
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
    this.buffer.removeArea(area);
    this.markClear(true);
    this.clear();
    this.render();
  } else {
    this.buffer.removeCharAtPoint(this.caret);
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

  this.find.info(1 + this.findNeedle + '/' + this.findResults.length);

  var result = this.findResults[this.findNeedle];
  this.setCaret(result, true, true);
  this.markClear(true);
  this.markBegin();
  this.move.byChars(this.findValue.length, true);
  this.markSet();
  this.followCaret(true, true);
  this.render();
};

Jazz.prototype.onFindValue = function(value, noJump) {
  var g = new Point({ x: this.gutter, y: 0 });

  this.buffer.updateRaw();
  this.views.find.clear();
  this.findValue = value;
  this.findResults = this.buffer.indexer.find(value).map((offset) => {
    return this.buffer.getOffsetPoint(offset);
  });

  if (this.findResults.length) {
    this.find.info(1 + this.findNeedle + '/' + this.findResults.length);
  }

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
  var area = this.buffer.wordAreaAtPoint(this.caret, true);
  if (!area) return;

  var key = this.buffer.getAreaText(area);
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

Jazz.prototype.getPointTabs = function(point) {
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

Jazz.prototype.getCoordsTabs = function(point) {
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

Jazz.prototype.repaintBelowCaret = debounce(function() {
  this.views.code.repaintBelowCaret();
}, 40);

Jazz.prototype.repaint = bindRaf(function() {
  this.resize();
  this.render();
});

Jazz.prototype.resize = function() {
  var $ = this.el;

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
  this.gutter = Math.max(
    this.options.hide_rows ? 0 : (''+this.rows).length,
    (this.options.center_horizontal
      ? (this.page.width - 81 - (this.options.hide_rows ? 0 : (''+this.rows).length)) / 2 | 0 : 0)
    + (this.options.hide_rows
      ? 0 : Math.max(3, (''+this.rows).length))
  ) * this.char.width + (this.options.hide_rows ? 0 : this.options.gutter_margin * (this.options.center_horizontal ? -1 : 1));
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
  ctx.setLineDash([1,1]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(0,1);
  ctx.lineTo(0, this.char.height);
  ctx.strokeStyle = color;
  ctx.stroke();

  var dataURL = canvas.toDataURL();

  dom.css(this.id, `
    #${this.id} {
      top: ${this.options.center_vertical ? this.size.height / 3 : 0}px;
    }
    #${this.id} > .${css.ruler},
    #${this.id} > .${css.layer} > .${css.find},
    #${this.id} > .${css.layer} > .${css.mark},
    #${this.id} > .${css.layer} > .${css.code} {
      margin-left: ${this.marginLeft}px;
      tab-size: ${this.tabSize};
    }
    #${this.id} > .${css.layer} > .${css.rows} {
      padding-right: ${this.options.gutter_margin}px;
      padding-left: ${this.options.margin_left}px;
      width: ${this.marginLeft}px;
    }
    #${this.id} > .${css.layer} > .${css.find} > i,
    #${this.id} > .${css.layer} > .${css.block} > i {
      height: ${this.char.height + 1}px;
    }
    x {
      background-image: url(${dataURL});
    }`
  );

  this.emit('resize');
};

Jazz.prototype.clear = bindRaf(function() {
  // console.log('clear')
  this.editing = false;
  this.views.clear();
});

Jazz.prototype.render = bindRaf(function() {
  // console.log('render')
  this.views.render();
});

},{"./lib/area":2,"./lib/bind-raf":4,"./lib/box":5,"./lib/clone":6,"./lib/debounce":7,"./lib/dialog":8,"./lib/diff":10,"./lib/dom":11,"./lib/event":12,"./lib/merge":14,"./lib/point":16,"./lib/range":19,"./lib/regexp":20,"./lib/set-immediate":22,"./lib/throttle":23,"./src/file":33,"./src/history":34,"./src/input":36,"./src/input/bindings":35,"./src/input/text":38,"./src/move":39,"./src/style.css":40,"./src/theme":41,"./src/views":45}],2:[function(require,module,exports){
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

    if (result) low = index;
    else high = index;
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
module.exports = function(fn) {
  var request;
  return function rafWrap(a, b, c, d) {
    window.cancelAnimationFrame(request);
    request = window.requestAnimationFrame(fn.bind(this, a, b, c, d));
  };
};

},{}],5:[function(require,module,exports){

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

},{}],6:[function(require,module,exports){

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

},{}],7:[function(require,module,exports){

module.exports = function(fn, ms) {
  var timeout;

  return function debounceWrap(a, b, c, d) {
    clearTimeout(timeout);
    timeout = setTimeout(fn.bind(this, a, b, c, d), ms);
    return timeout;
  }
};

},{}],8:[function(require,module,exports){
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

},{"../dom":11,"../event":12,"./style.css":9}],9:[function(require,module,exports){
module.exports = {"dialog":"_lib_dialog_style__dialog","input":"_lib_dialog_style__input","text":"_lib_dialog_style__text","label":"_lib_dialog_style__label","info":"_lib_dialog_style__info"}
},{}],10:[function(require,module,exports){

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

},{}],11:[function(require,module,exports){
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

dom.css = bindRaf(function(id, cssText) {
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

},{"./bind-raf":4,"./diff":10,"./memoize":13,"./merge":14,"./point":16}],12:[function(require,module,exports){

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

},{}],13:[function(require,module,exports){
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

},{"./clone":6}],14:[function(require,module,exports){

module.exports = function merge(dest, src) {
  for (var key in src) {
    dest[key] = src[key];
  }
  return dest;
};

},{}],15:[function(require,module,exports){

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

Point.prototype['^/'] =
Point.prototype.ceilDiv = function(p) {
  return new Point({
    x: Math.ceil(this.x / (p.x || p.width || 0)),
    y: Math.ceil(this.y / (p.y || p.height || 0))
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

Point.prototype['*'] =
Point.prototype.mul = function(p) {
  return new Point({
    x: this.x * (p.x || p.width || 0),
    y: this.y * (p.y || p.height || 0)
  });
};

Point.prototype['^*'] =
Point.prototype.ceilMul = function(p) {
  return new Point({
    x: Math.ceil(this.x * (p.x || p.width || 0)),
    y: Math.ceil(this.y * (p.y || p.height || 0))
  });
};

Point.prototype['o*'] =
Point.prototype.roundMul = function(p) {
  return new Point({
    x: Math.round(this.x * (p.x || p.width || 0)),
    y: Math.round(this.y * (p.y || p.height || 0))
  });
};

Point.prototype['_*'] =
Point.prototype.floorMul = function(p) {
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
  'indent': /^ +|^\t+/,
  'line': /^.+$|^\n/,
  'newline': /\r\n|\r|\n/,
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
  'string': '`',
};

module.exports = Buffer;

function Buffer() {
  this.syntax = new Syntax;
  this.indexer = new Indexer(this);
  this.segments = new Segments(this);
  this.setText('');
}

Buffer.prototype.__proto__ = Event.prototype;

Buffer.prototype.updateRaw = function() {
  this.raw = this.text.toString();
};

Buffer.prototype.setText = function(text) {
  text = normalizeEOL(text);

  this.raw = text //this.syntax.highlight(text);

  this.syntax.tab = ~this.raw.indexOf('\t') ? '\t' : ' ';

  this.text = new SkipString;
  this.text.set(this.raw);

  this.tokens = new Tokens;
  this.tokens.index(this.raw);
  this.tokens.on('change segments', this.emit.bind(this, 'change segments'));

  this.prefix = new PrefixTree;
  this.prefix.index(this.raw);

  // this.emit('raw', this.raw);
  this.emit('set');
};

Buffer.prototype.insert =
Buffer.prototype.insertTextAtPoint = function(p, text, ctrlShift) {
  if (!ctrlShift) this.emit('before update');

  text = normalizeEOL(text);

  var isEOL = '\n' === text[0];
  var shift = ctrlShift || isEOL;
  var length = text.length;
  var point = this.getPoint(p);
  var lines = (text.match(NEWLINE) || []).length;
  var range = [point.y, point.y + lines];
  var offsetRange = this.getLineRangeOffsets(range);

  var before = this.getOffsetRangeText(offsetRange);
  this.text.insert(point.offset, text);
  offsetRange[1] += text.length;
  var after = this.getOffsetRangeText(offsetRange);
  this.prefix.index(after);
  this.tokens.update(offsetRange, after, length);
  this.segments.clearCache(offsetRange[0]);

  // this.tokens = new Tokens;
  // this.tokens.index(this.text.toString());
  // this.segments = new Segments(this);

  if (!ctrlShift) this.emit('update', range, shift, before, after);
  else this.emit('raw');

  return text.length;
};

Buffer.prototype.remove =
Buffer.prototype.removeOffsetRange = function(o, noUpdate) {
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
  this.text.remove(o);
  // offsetRange[1] -= shift;
  var after = this.getOffsetRangeText(offsetRange);
  this.prefix.index(after);
  this.tokens.update(offsetRange, after, length);
  this.segments.clearCache(offsetRange[0]);

  if (!noUpdate) this.emit('update', range, shift, before, after);
};

Buffer.prototype.removeArea = function(area, noUpdate) {
  var offsets = this.getAreaOffsetRange(area);
  return this.removeOffsetRange(offsets, noUpdate);
};

Buffer.prototype.removeCharAtPoint = function(p) {
  var point = this.getPoint(p);
  var offsetRange = [point.offset, point.offset+1];
  return this.removeOffsetRange(offsetRange);
};

Buffer.prototype.get = function(range) {
  var code = this.getLineRangeText(range);
  var segment = this.segments.get(range[0]);
  if (segment) {
    code = SEGMENT[segment] + '\uffba' + code + '\uffbe*/`'
    code = this.syntax.highlight(code);
    code = '<' + segment[0] + '>' +
      code.substring(
        code.indexOf('\uffba') + 1,
        code.lastIndexOf('\uffbe')
      );
  } else {
    code = this.syntax.highlight(code + '\uffbe*/`');
    code = code.substring(0, code.lastIndexOf('\uffbe'));
  }
  return code;
};

Buffer.prototype.getLine = function(y) {
  var line = new Line;
  line.offsetRange = this.getLineRangeOffsets([y,y]);
  line.offset = line.offsetRange[0];
  line.length = line.offsetRange[1] - line.offsetRange[0] - (y < this.loc());
  line.point.set({ x:0, y:y });
  return line;
};

Buffer.prototype.getPoint = function(p) {
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

Buffer.prototype.getLineRangeText = function(range) {
  var offsets = this.getLineRangeOffsets(range);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.getLineRangeOffsets = function(range) {
  var a = this.getLineOffset(range[0]);
  var b = range[1] >= this.loc()
    ? this.text.length
    : this.getLineOffset(range[1] + 1);
  var offsets = [a, b];
  return offsets;
};

Buffer.prototype.getOffsetRangeText = function(offsetRange) {
  var text = this.text.getRange(offsetRange);
  return text;
};

Buffer.prototype.getOffsetPoint = function(offset) {
  var token = this.tokens.getByOffset('lines', offset - .5);
  return new Point({
    x: offset - (offset > token.offset ? token.offset + 1 : 0),
    y: Math.min(this.loc(), token.index - (token.offset + 1 > offset) + 1)
  });
};

Buffer.prototype.charAt = function(offset) {
  var char = this.text.getRange([offset, offset + 1]);
  return char;
};

Buffer.prototype.getOffsetLineText = function(offset) {
  return {
    line: line,
    text: text,
  }
};

Buffer.prototype.getLineText = function(y) {
  var text = this.getLineRangeText([y,y]);
  return text;
};

Buffer.prototype.getAreaText = function(area) {
  var offsets = this.getAreaOffsetRange(area);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.wordAreaAtPoint = function(p, inclusive) {
  var point = this.getPoint(p);
  var text = this.text.getRange(point.line.offsetRange);
  var words = Regexp.parse(text, WORDS);

  if (words.length === 1) {
    var area = new Area({
      begin: { x: 0, y: point.y },
      end: { x: point.line.length, y: point.y },
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

Buffer.prototype.moveAreaByLines = function(y, area) {
  if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
  if (area.begin.y + y < 0 || area.end.y + y > this.loc) return false;

  area.begin.x = 0;
  area.end.x = 0;

  var text = this.getLineRangeText([area.begin.y, area.end.y-1]);
  this.removeArea(area, true);

  this.insert({ x:0, y:area.begin.y + y }, text, y);

  return true;
};

Buffer.prototype.getAreaOffsetRange = function(area) {
  var range = [
    this.getPoint(area.begin).offset,
    this.getPoint(area.end).offset
  ];
  return range;
};

Buffer.prototype.getOffsetLine = function(offset) {
  return line;
};

Buffer.prototype.getLineOffset = function(y) {
  var offset = y < 0 ? -1 : y === 0 ? 0 : this.tokens.getByIndex('lines', y - 1) + 1;
  return offset;
};

Buffer.prototype.loc = function() {
  return this.tokens.getCollection('lines').length;
};

Buffer.prototype.toString = function() {
  return this.text.toString();
};

function Line() {
  this.offsetRange = [];
  this.offset = 0;
  this.length = 0;
  this.point = new Point;
}

function normalizeEOL(s) {
  return s.replace(EOL, '\n');
}

},{"../../lib/area":2,"../../lib/event":12,"../../lib/point":16,"../../lib/regexp":20,"./indexer":26,"./prefixtree":28,"./segments":29,"./skipstring":30,"./syntax":31,"./tokens":32}],26:[function(require,module,exports){

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
var binarySearch = require('../../lib/binary-search');

module.exports = Parts;

function Parts(minSize) {
  minSize = minSize || 5000;
  this.minSize = minSize;
  this.parts = [];
  this.length = 0;
}

Parts.prototype.push = function(item) {
  this.append([item]);
};

Parts.prototype.append = function(items) {
  var part = last(this.parts);

  if (!part) {
    part = [];
    part.startIndex = 0;
    part.startOffset = 0;
    this.parts.push(part);
  }
  else if (part.length >= this.minSize) {
    var startIndex = part.startIndex + part.length;
    var startOffset = items[0];

    part = [];
    part.startIndex = startIndex;
    part.startOffset = startOffset;
    this.parts.push(part);
  }

  part.push.apply(part, items.map(offset => offset - part.startOffset));

  this.length += items.length;
};

Parts.prototype.get = function(index) {
  var part = this.findPartByIndex(index).item;
  return part[index - part.startIndex] + part.startOffset;
};

Parts.prototype.find = function(offset) {
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

Parts.prototype.insert = function(offset, array) {
  var o = this.find(offset);
  if (!o) {
    return this.append(array);
  }
  if (o.offset > offset) o.local = -1;
  var length = array.length;
  //TODO: maybe subtract 'offset' instead ?
  array = array.map(el => el -= o.part.startOffset);
  insert(o.part, o.local + 1, array);
  this.shiftIndex(o.partIndex + 1, -length);
  this.length += length;
};

Parts.prototype.shiftOffset = function(offset, shift) {
  var parts = this.parts;
  var item = this.find(offset);
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

Parts.prototype.removeRange = function(range) {
  var a = this.find(range[0]);
  var b = this.find(range[1]);

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
      var shiftBetween = removed.reduce((p,n) => p + n.length, 0);
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

Parts.prototype.shiftIndex = function(startIndex, shift) {
  for (var i = startIndex; i < this.parts.length; i++) {
    this.parts[i].startIndex -= shift;
  }
};

Parts.prototype.removeBelowOffset = function(offset, part) {
  var o = this.findOffsetInPart(offset, part)
  var shift = remove(part, 0, o.index).length;
  this.shiftIndex(o.partIndex + 1, shift);
  this.length -= shift;
};

Parts.prototype.findOffsetInPart = function(offset, part) {
  offset -= part.startOffset;
  return binarySearch(part, o => o <= offset);
};

Parts.prototype.findPartByIndex = function(index) {
  return binarySearch(this.parts, s => s.startIndex <= index);
};

Parts.prototype.findPartByOffset = function(offset) {
  return binarySearch(this.parts, s => s.startOffset <= offset);
};

Parts.prototype.toArray = function() {
  return this.parts.reduce((p,n) => p.concat(n), []);
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

},{"../../lib/binary-search":3}],28:[function(require,module,exports){
// var WORD = /\w+/g;
var WORD = /[a-zA-Z0-9]{1,}/g
var rank = 0;

module.exports = PrefixTreeNode;

function PrefixTreeNode() {
  this.value = '';
  this.rank = 0;
  this.children = {};
}

PrefixTreeNode.prototype.getChildren = function() {
  var children = Object
    .keys(this.children)
    .map((key) => this.children[key]);

  return children.reduce((p, n) => p.concat(n.getChildren()), children);
};

PrefixTreeNode.prototype.collect = function(key) {
  var collection = [];
  var node = this.find(key);
  if (node) {
    collection = node
      .getChildren()
      .filter((node) => node.value)
      .sort((a, b) => {
        var res = b.rank - a.rank;
        if (res === 0) res = b.value.length - a.value.length;
        if (res === 0) res = a.value > b.value;
        return res;
      });

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
var Point = require('../../lib/point');
var binarySearch = require('../../lib/binary-search');
var Tokens = require('./tokens');
var Type = Tokens.Type;

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

module.exports = Segments;

function Segments(buffer) {
  this.buffer = buffer;
  this.cache = {};
  this.reset();
}

Segments.prototype.clearCache = function(offset) {
  if (offset) {
    var s = binarySearch(this.cache.state, s => s.offset < offset, true);
    this.cache.state.splice(s.index);
  } else {
    this.cache.state = [];
  }
  this.cache.offset = {};
  this.cache.range = {};
  this.cache.point = {};
};

Segments.prototype.reset = function() {
  this.clearCache();
};

Segments.prototype.get = function(y) {
  if (y in this.cache.point) {
    return this.cache.point[y];
  }

  var segments = this.buffer.tokens.getCollection('segments');
  var open = false;
  var state = null;
  var waitFor = '';
  var point = { x:-1, y:-1 };
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
          return (this.cache.point[y] = null);
        }

        if (point.y >= y) {
          return (this.cache.point[y] = Tag[state.type]);
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
        return (this.cache.point[y] = null);
      }

      range = this.buffer.getLine(point.y).offsetRange;

      if (last && last.point.y === point.y) {
        close = last.point.x + Length[last.type];
      } else {
        close = 0;
      }

      valid = this.isValidRange([range[0], range[1]+1], segment, close);

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
    return (this.cache.point[y] = Tag[state.type]);
  }

  return (this.cache.point[y] = null);
};

//TODO: cache in Buffer
Segments.prototype.getOffsetPoint = function(offset) {
  if (offset in this.cache.offset) return this.cache.offset[offset];
  return (this.cache.offset[offset] = this.buffer.getOffsetPoint(offset));
};

Segments.prototype.isValidRange = function(range, segment, close) {
  var key = range.join();
  if (key in this.cache.range) return this.cache.range[key];
  var text = this.buffer.getOffsetRangeText(range);
  var valid = this.isValid(text, segment.offset - range[0], close);
  return (this.cache.range[key] = valid);
};

Segments.prototype.isValid = function(text, offset, lastIndex) {
  Begin.lastIndex = lastIndex;

  var match = Begin.exec(text);
  if (!match) return;

  var i = match.index;

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

Segments.prototype.getCacheState = function(y) {
  var s = binarySearch(this.cache.state, s => s.point.y < y);
  if (s.item && y - 1 < s.item.point.y) return null;
  else return s;
  // return s;
};

},{"../../lib/binary-search":3,"../../lib/point":16,"./tokens":32}],30:[function(require,module,exports){
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
  this.chunkSize = o.chunkSize || 5000;
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
  return this.substring(0, this.length);
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
  't': R(['operator'], 'g', entities),
  'm': R(['params'],   'g'),
  'd': R(['declare'],  'g'),
  'f': R(['function'], 'g'),
  'k': R(['keyword'],  'g'),
  'n': R(['builtin'],  'g'),
  'l': R(['symbol'],   'g'),
  's': R(['template string'], 'g'),
  'e': R(['special','number'], 'g'),
}, compile);

var Indent = {
  regexp: R(['indent'], 'gm'),
  replacer: (s) => s.replace(/ {1,2}|\t/g, '<x>$&</x>')
};

var AnyChar = /\S/g;

var Blocks = R(['comment','string','regexp', /^.{1000,}/], 'gm');

var Tag = {
  '//': 'c',
  '/*': 'c',
  '`': 's',
  '"': 's',
  "'": 's',
  '/': 'r',
};

module.exports = Syntax;

function Syntax(o) {
  o = o || {};
  this.tab = o.tab || '\t';
  this.blocks = [];
}

Syntax.prototype.entities = entities;

Syntax.prototype.highlight = function(code, offset) {
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

Syntax.prototype.createIndents = function(code) {
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
    if (match) indent = match.index;
    else if (indent && !line.length) {
      lines[i] = new Array(indent + 1).join(this.tab);
    }
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
    if (tag) return '<'+tag+'>'+entities(block)+'</'+tag+'>';
    else return entities(block.slice(0, 1000) + '...line too long to display');
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
  '`': 'template string',
};

// var TOKEN = /\n/g;
var TOKEN = /\n|\/\*|\*\/|`|\{|\}|\[|\]|\(|\)/g;

module.exports = Tokens;

Tokens.Type = Type;

function Tokens(factory) {
  factory = factory || function() { return new Parts; };

  var t = this.tokens = {
    lines: factory(),
    blocks: factory(),
    segments: factory(),
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
    '`': t.segments,
  };
}

Tokens.prototype.__proto__ = Event.prototype;

Tokens.prototype.index = function(text, offset) {
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

Tokens.prototype.update = function(range, text, shift) {
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
      this.emit(`change ${type}`);
    }
  }
};

Tokens.prototype.getByIndex = function(type, index) {
  return this.tokens[type].get(index);
};

Tokens.prototype.getCollection = function(type) {
  return this.tokens[type];
};

Tokens.prototype.getByOffset = function(type, offset) {
  return this.tokens[type].find(offset);
};

},{"../../lib/event":12,"./parts":27}],33:[function(require,module,exports){
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
    this.buffer.setText(text);
    this.emit('open');
    fn && fn(null, this);
  });
};

File.prototype.save = function(fn) {
  save(this.root + this.path, this.buffer.toString(), fn || noop);
};

File.prototype.set = function(text) {
  this.buffer.setText(text);
  this.emit('set');
};

function noop() {/* noop */}

},{"../lib/event":12,"../lib/open":15,"../lib/save":21,"./buffer":25}],34:[function(require,module,exports){
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

},{"../lib/debounce":7,"../lib/event":12}],35:[function(require,module,exports){
var throttle = require('../../lib/throttle');

var PAGING_THROTTLE = 65;

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
    var text = this.buffer.getAreaText(area.setLeft(0).addBottom(add));
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
      this.insert(this.tab);
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

},{"../../lib/throttle":23}],36:[function(require,module,exports){
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

},{"../../lib/event":12,"./mouse":37,"./text":38}],37:[function(require,module,exports){
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

},{"../../lib/debounce":7,"../../lib/event":12,"../../lib/point":16}],38:[function(require,module,exports){
var dom = require('../../lib/dom');
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var Event = require('../../lib/event');

var THROTTLE = 1000/62;

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

  this.el = document.createElement('textarea');

  dom.style(this, {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0
  });

  dom.attrs(this, {
    autocapitalize: 'none',
    autocomplete: 'off',
    spellchecking: 'off',
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

},{"../../lib/debounce":7,"../../lib/dom":11,"../../lib/event":12,"../../lib/throttle":23}],39:[function(require,module,exports){
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
  var line = buffer.getLineText(p.y);

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
  var x = p.x;
  var y = p.y;

  if (dx < 0) { // going left
    x += dx; // move left
    if (x < 0) { // when past left edge
      if (y > 0) { // and lines above
        y -= 1; // move up a line
        x = buffer.getLine(y).length; // and go to the end of line
      } else {
        x = 0;
      }
    }
  } else if (dx > 0) { // going right
    x += dx; // move right
    while (x - buffer.getLine(y).length > 0) { // while past line length
      if (y === buffer.loc()) { // on end of file
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

move.byLines = function(buffer, p, dy) {
  var x = p.x;
  var y = p.y;

  if (dy < 0) { // going up
    if (y + dy > 0) { // when lines above
      y += dy; // move up
    } else {
      y = 0;
    }
  } else if (dy > 0) { // going down
    if (y < buffer.loc() - dy) { // when lines below
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

move.beginOfLine = function(_, p) {
  this.lastDeliberateX = 0;
  return {
    x: 0,
    y: p.y
  };
};

move.endOfLine = function(buffer, p) {
  var x = buffer.getLine(p.y).length;
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
  var last = buffer.loc();
  var x = buffer.getLine(last).length
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
  var last = buffer.loc();
  return p.y === last && p.x === buffer.getLine(last).length;
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

},{"../lib/event":12,"../lib/point":16,"../lib/regexp":20}],40:[function(require,module,exports){
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","blink-smooth":"_src_style__blink-smooth","caret-blink-smooth":"_src_style__caret-blink-smooth","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
},{}],41:[function(require,module,exports){
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
  dom.css('theme',
`
.${name} {
  background: ${t.background};
}

t,
k {
  color: ${t.keyword};
}

d,
n {
  color: ${t.declare};
}

o,
e {
  color: ${t.number};
}

m {
  color: ${t.params};
}

f {
  color: ${t.function};
  font-style: normal;
}

r {
  color: ${t.regexp || t.params};
}

c {
  color: ${t.comment};
}

s {
  color: ${t.string};
}

l,
.${css.code} {
  color: ${t.color};
}

.${css.caret} {
  background: ${t.color};
}

m,
d {
  font-style: italic;
}

l {
  font-style: normal;
}

x {
  display: inline-block;
  background-repeat: no-repeat;
}
`
  )

}


},{"../lib/dom":11,"./style.css":40}],42:[function(require,module,exports){
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

},{"./layer":46,"./template":49}],43:[function(require,module,exports){
var dom = require('../../lib/dom');
var Range = require('../../lib/range');
var Layer = require('./layer');
var template = require('./template');

module.exports = Code;

function Code(name, editor, template) {
  Layer.call(this, name, editor, template, 7);
}

Code.prototype.__proto__ = Layer.prototype;

Code.prototype.render = function() {
  // this.clear();
  // return this.renderPage(0, true);

  if (!this.editor.editing) {
    this.renderAhead();
  }
};

Code.prototype.renderEdit = function(edit) {
  // this.clear();
  // return this.renderPage(0, true);

  var y = edit.line;
  var g = edit.range.slice();
  var shift = edit.shift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isBegin = g[0] + isBackspace === 0;
  var isEnd = g[1] + isEnter === this.editor.rows;

  if (shift) {
    if (isEnter) {
      this.clearOutPageRange([0,0]);
      if (!this.hasViewTopAt(edit.caretNow.y) || edit.caretBefore.x > 0) {
        this.shiftViewsBelow(edit.caretNow.y + 1, 1);
        this.splitEnter(edit.caretNow.y);
        if (edit.caretBefore.x > 0) {
          this.updateRange([edit.caretBefore.y, edit.caretBefore.y]);
        }
      } else {
        this.shiftViewsBelow(edit.caretNow.y, 1);
      }
      this.renderPageBelow(edit.caretNow.y+1);
    }
    else if (isBackspace) {
      this.clearOutPageRange([0,1]);
      this.shortenBottomAt(edit.caretNow.y);
      this.shiftViewsBelow(edit.caretNow.y+1, -1);
      if (!this.hasViewTopAt(edit.caretNow.y)) {
        this.splitBackspace(edit.caretNow.y);
      }
      if (edit.caretNow.x > 0) {
        this.updateRange([edit.caretNow.y, edit.caretNow.y]);
      }
      this.renderPageBelow(edit.caretNow.y);
    }
  } else {
    this.updateRange(g);
    this.renderPage(0);
  }
};

Code.prototype.repaintBelowCaret = function() {
  this.splitEnter(this.editor.caret.y);
  this.renderPageBelow(this.editor.caret.y, true);
  this.clearOutPageRange([0,0]);
};

},{"../../lib/dom":11,"../../lib/range":19,"./layer":46,"./template":49}],44:[function(require,module,exports){
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

},{"./layer":46,"./template":49}],45:[function(require,module,exports){
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
    new CodeView('code', editor, template.code),
    new View('caret', editor, template.caret),
    new BlockView('block', editor, template.block),
    new FindView('find', editor, template.find),
    new MarkView('mark', editor, template.mark),
    new RowsView('rows', editor, template.rows),
  ];

  this.views.forEach(view => this[view.name] = view);
  this.forEach = this.views.forEach.bind(this.views);

  this.block.render = debounce(this.block.render, 20);

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

},{"../../lib/debounce":7,"./block":42,"./code":43,"./find":44,"./mark":47,"./rows":48,"./template":49,"./view":50}],46:[function(require,module,exports){
var dom = require('../../lib/dom');
var Event = require('../../lib/event');
var Range = require('../../lib/range');
var View = require('./view');
var css = require('../style.css');

var AheadThreshold = {
  animation: [.15, .4],
  normal: [1.5, 3]
};

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
  this.renderRange([y,y]);
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
  var threshold = this.editor.animationRunning
    ? [-AheadThreshold.animation[0], +AheadThreshold.animation[0]]
    : [-AheadThreshold.normal[0], +AheadThreshold.normal[0]];

  var aheadRange = this.getPageRange(threshold);
  var aheadNeedRanges = Range.NOT(aheadRange, views);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders
    this.renderPage(
      this.editor.animationRunning
        ? AheadThreshold.animation[1]
        : AheadThreshold.normal[1],
      include
    );
  }
};

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

Layer.prototype.hasViewTopAt = function(y) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] === y) return true;
  }
  return false;
};

Layer.prototype.shortenBottomAt = function(y) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[1] === y) {
      view[1] -= 1;
      view.style();
      return true;
    }
  }
  return false;
};

Layer.prototype.splitEnter = function(y) {
  var pageRange = this.getPageRange([0,0]);
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] <= y && view[1] >= y) {
      var bottom = view[1];
      view[1] = y - 1;
      view.style();
      this.renderRange([y+1, Math.min(pageRange[1], bottom+1)]);
      return true;
    }
  }
  return false;
};

Layer.prototype.splitBackspace = function(y) {
  var pageRange = this.getPageRange([0,1]);
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] <= y && view[1] >= y) {
      var bottom = view[1];
      view[1] = y - 1;
      view.style();
      this.renderRange([y, Math.min(pageRange[1], bottom+1)]);
      return true;
    }
  }
  return false;
};

Layer.prototype.shiftViewsBelow = function(y, dy) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] < y) continue;

    view[0] += dy;
    view[1] += dy;
    view.style();
  }
};

Layer.prototype.clearOutPageRange = function(range) {
  this.outRangeViews(this.getPageRange(range)).forEach(view => view.clear());
};

Layer.prototype.renderPageBelow = function(y, inclusive) {
  this.renderRange([y, this.getPageRange([0,0])[1]], inclusive);
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

},{"../../lib/dom":11,"../../lib/event":12,"../../lib/range":19,"../style.css":40,"./view":50}],47:[function(require,module,exports){
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

},{"../../lib/dom":11,"../../lib/range":19,"./layer":46,"./template":49}],48:[function(require,module,exports){
var Layer = require('./layer');
var template = require('./template');

module.exports = Rows;

function Rows(name, editor, template) {
  Layer.call(this, name, editor, template, 7);
}

Rows.prototype.__proto__ = Layer.prototype;

Rows.prototype.render = function() {
  // this.clear();
  // return this.renderPage(0, true);

  var views = this.views;
  var rows = this.editor.rows;
  for (var i = 0; i < views.length; i++) {
    var view = views[i];
    var r = view;
    if (!view.visible) continue;

    if (r[1] > rows) view.clear();
  }

  this.renderAhead();
};

},{"./layer":46,"./template":49}],49:[function(require,module,exports){
var template = exports;

template.code = function(range, e) {
  // if (template.code.memoize.param === code) {
  //   return template.code.memoize.result;
  // } else {
  //   template.code.memoize.param = code;
  //   template.code.memoize.result = false;
  // }

  // var html = e.buffer.getHighlighted(range);
  var html = e.buffer.get(range);

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

  var offsets = e.buffer.getLineRangeOffsets(range);
  var area = e.buffer.getAreaOffsetRange(mark);
  var code = e.buffer.text.getRange(offsets);

  area[0] -= offsets[0];
  area[1] -= offsets[0];

  var above = code.substring(0, area[0]);
  var middle = code.substring(area[0], area[1]);
  var html = e.syntax.entities(above)
    + '<mark>' + e.syntax.entities(middle) + '</mark>';

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
    if (results[i].y < range[0] - 1) begin = i;
    else end = i;
  } while (prev !== i);

  var width = e.findValue.length * e.char.width + 'px';

  var html = '';
  var tabs;
  var r;
  while (results[i] && results[i].y < range[1]) {
    r = results[i++];
    tabs = e.getPointTabs(r);
    html += '<i style="'
          + 'width:' + width + ';'
          + 'top:' + (r.y * e.char.height) + 'px;'
          + 'left:' + ((r.x + tabs.tabs * e.tabSize - tabs.remainder)
                    * e.char.width + e.gutter + e.options.margin_left) + 'px;'
          + '"></i>';
  }

  return html;
};

template.block = function(range, e) {
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
    if (!--limit) return html;

    if (open && !--count) break;

    openOffset = e.buffer.tokens.getByIndex('blocks', --i);
    char = e.buffer.charAt(openOffset);
  }

  if (count) return html;

  count = 1;

  while (i < length - 1) {
    closeOffset = e.buffer.tokens.getByIndex('blocks', ++i);
    char = e.buffer.charAt(closeOffset);
    if (!--limit) return html;

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

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (begin.y * e.char.height) + 'px;'
        + 'left:' + ((begin.x + tabs.tabs * e.tabSize - tabs.remainder)
                  * e.char.width + e.gutter + e.options.margin_left) + 'px;'
        + '"></i>';

  tabs = e.getPointTabs(end);

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (end.y * e.char.height) + 'px;'
        + 'left:' + ((end.x + tabs.tabs * e.tabSize - tabs.remainder)
                  * e.char.width + e.gutter + e.options.margin_left) + 'px;'
        + '"></i>';

  return html;
};

template.find.style =
template.block.style =
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
    left: e.caretPx.x + e.marginLeft,
    top: e.caretPx.y - 1,
    height: e.char.height + 2,
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

},{}],50:[function(require,module,exports){
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

},{"../../lib/diff":10,"../../lib/dom":11,"../../lib/merge":14,"../../lib/trim":24,"../style.css":40}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwibGliL3RyaW0uanMiLCJzcmMvYnVmZmVyL2luZGV4LmpzIiwic3JjL2J1ZmZlci9pbmRleGVyLmpzIiwic3JjL2J1ZmZlci9wYXJ0cy5qcyIsInNyYy9idWZmZXIvcHJlZml4dHJlZS5qcyIsInNyYy9idWZmZXIvc2VnbWVudHMuanMiLCJzcmMvYnVmZmVyL3NraXBzdHJpbmcuanMiLCJzcmMvYnVmZmVyL3N5bnRheC5qcyIsInNyYy9idWZmZXIvdG9rZW5zLmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzU4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TEE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEphenpcbiAqL1xuXG52YXIgRGVmYXVsdE9wdGlvbnMgPSB7XG4gIHRoZW1lOiAnd2VzdGVybicsXG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogOTUsXG4gIGhpZGVfcm93czogZmFsc2UsXG4gIGNlbnRlcl9ob3Jpem9udGFsOiBmYWxzZSxcbiAgY2VudGVyX3ZlcnRpY2FsOiBmYWxzZSxcbiAgbWFyZ2luX2xlZnQ6IDE1LFxuICBndXR0ZXJfbWFyZ2luOiAyMCxcbn07XG5cbnJlcXVpcmUoJy4vbGliL3NldC1pbW1lZGlhdGUnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuL2xpYi9kb20nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9saWIvbWVyZ2UnKTtcbnZhciBjbG9uZSA9IHJlcXVpcmUoJy4vbGliL2Nsb25lJyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vbGliL2JpbmQtcmFmJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi9saWIvcmVnZXhwJyk7XG52YXIgRGlhbG9nID0gcmVxdWlyZSgnLi9saWIvZGlhbG9nJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuL2xpYi9wb2ludCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi9saWIvcmFuZ2UnKTtcbnZhciBBcmVhID0gcmVxdWlyZSgnLi9saWIvYXJlYScpO1xudmFyIEJveCA9IHJlcXVpcmUoJy4vbGliL2JveCcpO1xuXG52YXIgRGVmYXVsdEJpbmRpbmdzID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvYmluZGluZ3MnKTtcbnZhciBIaXN0b3J5ID0gcmVxdWlyZSgnLi9zcmMvaGlzdG9yeScpO1xudmFyIElucHV0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQnKTtcbnZhciBGaWxlID0gcmVxdWlyZSgnLi9zcmMvZmlsZScpO1xudmFyIE1vdmUgPSByZXF1aXJlKCcuL3NyYy9tb3ZlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L3RleHQnKTtcbnZhciBWaWV3cyA9IHJlcXVpcmUoJy4vc3JjL3ZpZXdzJyk7XG52YXIgdGhlbWUgPSByZXF1aXJlKCcuL3NyYy90aGVtZScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3JjL3N0eWxlLmNzcycpO1xuXG52YXIgTkVXTElORSA9IFJlZ2V4cC5jcmVhdGUoWyduZXdsaW5lJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSmF6ejtcblxuZnVuY3Rpb24gSmF6eihvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG1lcmdlKGNsb25lKERlZmF1bHRPcHRpb25zKSwgb3B0aW9ucyB8fCB7fSk7XG5cbiAgT2JqZWN0LmFzc2lnbih0aGlzLCB7XG4gICAgZWw6IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKSxcblxuICAgIGlkOiAnamF6el8nICsgKE1hdGgucmFuZG9tKCkgKiAxMGU2IHwgMCkudG9TdHJpbmcoMzYpLFxuICAgIGZpbGU6IG5ldyBGaWxlLFxuICAgIG1vdmU6IG5ldyBNb3ZlKHRoaXMpLFxuICAgIHZpZXdzOiBuZXcgVmlld3ModGhpcyksXG4gICAgaW5wdXQ6IG5ldyBJbnB1dCh0aGlzKSxcbiAgICBoaXN0b3J5OiBuZXcgSGlzdG9yeSh0aGlzKSxcblxuICAgIGJpbmRpbmdzOiB7IHNpbmdsZToge30gfSxcblxuICAgIGZpbmQ6IG5ldyBEaWFsb2coJ0ZpbmQnLCBUZXh0Lm1hcCksXG4gICAgZmluZFZhbHVlOiAnJyxcbiAgICBmaW5kTmVlZGxlOiAwLFxuICAgIGZpbmRSZXN1bHRzOiBbXSxcblxuICAgIHNjcm9sbDogbmV3IFBvaW50LFxuICAgIG9mZnNldDogbmV3IFBvaW50LFxuICAgIHNpemU6IG5ldyBCb3gsXG4gICAgY2hhcjogbmV3IEJveCxcblxuICAgIHBhZ2U6IG5ldyBCb3gsXG4gICAgcGFnZVBvaW50OiBuZXcgUG9pbnQsXG4gICAgcGFnZVJlbWFpbmRlcjogbmV3IEJveCxcbiAgICBwYWdlQm91bmRzOiBuZXcgUmFuZ2UsXG5cbiAgICBsb25nZXN0TGluZTogMCxcbiAgICBndXR0ZXI6IDAsXG4gICAgY29kZTogMCxcbiAgICByb3dzOiAwLFxuXG4gICAgdGFiU2l6ZTogMixcbiAgICB0YWI6ICcgICcsXG5cbiAgICBjYXJldDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcbiAgICBjYXJldFB4OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuXG4gICAgaGFzRm9jdXM6IGZhbHNlLFxuXG4gICAgbWFyazogbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gICAgfSksXG5cbiAgICBlZGl0aW5nOiBmYWxzZSxcbiAgICBlZGl0TGluZTogLTEsXG4gICAgZWRpdFJhbmdlOiBbLTEsLTFdLFxuICAgIGVkaXRTaGlmdDogMCxcblxuICAgIHN1Z2dlc3RJbmRleDogMCxcbiAgICBzdWdnZXN0Um9vdDogJycsXG4gICAgc3VnZ2VzdE5vZGVzOiBbXSxcblxuICAgIGFuaW1hdGlvblR5cGU6ICdsaW5lYXInLFxuICAgIGFuaW1hdGlvbkZyYW1lOiAtMSxcbiAgICBhbmltYXRpb25SdW5uaW5nOiBmYWxzZSxcbiAgICBhbmltYXRpb25TY3JvbGxUYXJnZXQ6IG51bGwsXG4gIH0pO1xuXG4gIGRvbS5hcHBlbmQodGhpcy52aWV3cy5jYXJldCwgdGhpcy5pbnB1dC50ZXh0KTtcbiAgZG9tLmFwcGVuZCh0aGlzLCB0aGlzLnZpZXdzKTtcblxuICAvLyB1c2VmdWwgc2hvcnRjdXRzXG4gIHRoaXMuYnVmZmVyID0gdGhpcy5maWxlLmJ1ZmZlcjtcbiAgdGhpcy5idWZmZXIubWFyayA9IHRoaXMubWFyaztcbiAgdGhpcy5zeW50YXggPSB0aGlzLmJ1ZmZlci5zeW50YXg7XG5cbiAgdGhlbWUodGhpcy5vcHRpb25zLnRoZW1lKTtcblxuICB0aGlzLmJpbmRNZXRob2RzKCk7XG4gIHRoaXMuYmluZEV2ZW50cygpO1xufVxuXG5KYXp6LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkphenoucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsLCBzY3JvbGxFbCkge1xuICBpZiAodGhpcy5yZWYpIHtcbiAgICB0aGlzLmVsLnJlbW92ZUF0dHJpYnV0ZSgnaWQnKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUoY3NzLmVkaXRvcik7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gICAgdGhpcy5vZmZTY3JvbGwoKTtcbiAgICB0aGlzLnJlZi5mb3JFYWNoKHJlZiA9PiB7XG4gICAgICBkb20uYXBwZW5kKGVsLCByZWYpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHRoaXMucmVmID0gW10uc2xpY2UuY2FsbCh0aGlzLmVsLmNoaWxkcmVuKTtcbiAgICBkb20uYXBwZW5kKGVsLCB0aGlzLmVsKTtcbiAgICBkb20ub25yZXNpemUodGhpcy5vblJlc2l6ZSk7XG4gIH1cblxuICB0aGlzLmVsID0gZWw7XG4gIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdpZCcsIHRoaXMuaWQpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQoY3NzLmVkaXRvcik7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZCh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICB0aGlzLm9mZlNjcm9sbCA9IGRvbS5vbnNjcm9sbChzY3JvbGxFbCB8fCB0aGlzLmVsLCB0aGlzLm9uU2Nyb2xsKTtcbiAgdGhpcy5pbnB1dC51c2UodGhpcy5lbCk7XG5cbiAgc2V0VGltZW91dCh0aGlzLnJlcGFpbnQsIDApO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYXNzaWduID0gZnVuY3Rpb24oYmluZGluZ3MpIHtcbiAgdGhpcy5iaW5kaW5ncyA9IGJpbmRpbmdzO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLmZpbGUub3BlbihwYXRoLCByb290LCBmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHRoaXMuZmlsZS5zYXZlKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0LCBwYXRoKSB7XG4gIHRoaXMuZmlsZS5zZXQodGV4dCk7XG4gIHRoaXMuZmlsZS5wYXRoID0gcGF0aCB8fCB0aGlzLmZpbGUucGF0aDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5mb2N1cyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5ibHVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbi5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTtcbiAgdGhpcy5yZXBhaW50QmVsb3dDYXJldCA9IHRoaXMucmVwYWludEJlbG93Q2FyZXQuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJpbmRIYW5kbGVycygpXG4gIHRoaXMubW92ZS5vbignbW92ZScsIHRoaXMub25Nb3ZlKTtcbiAgdGhpcy5maWxlLm9uKCdyYXcnLCB0aGlzLm9uRmlsZVJhdyk7IC8vVE9ETzogc2hvdWxkIG5vdCBuZWVkIHRoaXMgZXZlbnRcbiAgdGhpcy5maWxlLm9uKCdzZXQnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuZmlsZS5vbignb3BlbicsIHRoaXMub25GaWxlT3Blbik7XG4gIHRoaXMuZmlsZS5vbignY2hhbmdlJywgdGhpcy5vbkZpbGVDaGFuZ2UpO1xuICB0aGlzLmZpbGUub24oJ2JlZm9yZSBjaGFuZ2UnLCB0aGlzLm9uQmVmb3JlRmlsZUNoYW5nZSk7XG4gIHRoaXMuZmlsZS5idWZmZXIub24oJ2NoYW5nZSBzZWdtZW50cycsIHRoaXMucmVwYWludEJlbG93Q2FyZXQpO1xuICB0aGlzLmhpc3Rvcnkub24oJ2NoYW5nZScsIHRoaXMub25IaXN0b3J5Q2hhbmdlKTtcbiAgdGhpcy5pbnB1dC5vbignYmx1cicsIHRoaXMub25CbHVyKTtcbiAgdGhpcy5pbnB1dC5vbignZm9jdXMnLCB0aGlzLm9uRm9jdXMpO1xuICB0aGlzLmlucHV0Lm9uKCdpbnB1dCcsIHRoaXMub25JbnB1dCk7XG4gIHRoaXMuaW5wdXQub24oJ3RleHQnLCB0aGlzLm9uVGV4dCk7XG4gIHRoaXMuaW5wdXQub24oJ2tleXMnLCB0aGlzLm9uS2V5cyk7XG4gIHRoaXMuaW5wdXQub24oJ2tleScsIHRoaXMub25LZXkpO1xuICB0aGlzLmlucHV0Lm9uKCdjdXQnLCB0aGlzLm9uQ3V0KTtcbiAgdGhpcy5pbnB1dC5vbignY29weScsIHRoaXMub25Db3B5KTtcbiAgdGhpcy5pbnB1dC5vbigncGFzdGUnLCB0aGlzLm9uUGFzdGUpO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZXVwJywgdGhpcy5vbk1vdXNlVXApO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRvd24nLCB0aGlzLm9uTW91c2VEb3duKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VjbGljaycsIHRoaXMub25Nb3VzZUNsaWNrKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnYmVnaW4nLCB0aGlzLm9uTW91c2VEcmFnQmVnaW4pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWcnLCB0aGlzLm9uTW91c2VEcmFnKTtcbiAgdGhpcy5maW5kLm9uKCdzdWJtaXQnLCB0aGlzLmZpbmRKdW1wLmJpbmQodGhpcywgMSkpO1xuICB0aGlzLmZpbmQub24oJ3ZhbHVlJywgdGhpcy5vbkZpbmRWYWx1ZSk7XG4gIHRoaXMuZmluZC5vbigna2V5JywgdGhpcy5vbkZpbmRLZXkpO1xuICB0aGlzLmZpbmQub24oJ29wZW4nLCB0aGlzLm9uRmluZE9wZW4pO1xuICB0aGlzLmZpbmQub24oJ2Nsb3NlJywgdGhpcy5vbkZpbmRDbG9zZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblNjcm9sbCA9IGZ1bmN0aW9uKHNjcm9sbCkge1xuICB0aGlzLnNjcm9sbC5zZXQoc2Nyb2xsKTtcbiAgaWYgKCF0aGlzLmVkaXRpbmcpIHRoaXMucmVuZGVyKCk7XG4gIHRoaXMucmVzdCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVzdCA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgdGhpcy5yZW5kZXIoKTtcbn0sIDMwMCk7XG5cbkphenoucHJvdG90eXBlLm9uTW92ZSA9IGZ1bmN0aW9uKHBvaW50LCBieUVkaXQpIHtcbiAgaWYgKCFieUVkaXQpIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICBpZiAocG9pbnQpIHRoaXMuc2V0Q2FyZXQocG9pbnQpO1xuXG4gIGlmICghYnlFZGl0KSB7XG4gICAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgfHwgdGhpcy5pbnB1dC5tb3VzZS5kb3duKSB0aGlzLm1hcmtTZXQoKTtcbiAgICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIH1cblxuICB0aGlzLmVtaXQoJ21vdmUnKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG4gIGlmICghdGhpcy5lZGl0aW5nKSB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25SZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZvY3VzID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdmb2N1cycpO1xuICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICB0aGlzLmNhcmV0U29saWQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNhcmV0U29saWQgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldF0pO1xuICB0aGlzLmNhcmV0QmxpbmsoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNhcmV0QmxpbmsgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldCwgY3NzWydibGluay1zbW9vdGgnXV0pO1xufSwgNDAwKTtcblxuSmF6ei5wcm90b3R5cGUub25CbHVyID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gZmFsc2U7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykge1xuICAgICAgZG9tLmNsYXNzZXModGhpcy52aWV3cy5jYXJldCwgW2Nzcy5jYXJldF0pO1xuICAgICAgdGhpcy5lbWl0KCdibHVyJyk7XG4gICAgICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICAgIH1cbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbklucHV0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25UZXh0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLnN1Z2dlc3RSb290ID0gJyc7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXlzID0gZnVuY3Rpb24oa2V5cywgZSkge1xuICBpZiAoa2V5cyBpbiB0aGlzLmJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXlzIGluIERlZmF1bHRCaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXkgPSBmdW5jdGlvbihrZXksIGUpIHtcbiAgaWYgKGtleSBpbiB0aGlzLmJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5IGluIERlZmF1bHRCaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uQ3V0ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdGhpcy5vbkNvcHkoZSk7XG4gIHRoaXMuZGVsZXRlKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgZS5jbGlwYm9hcmREYXRhLnNldERhdGEoJ3RleHQvcGxhaW4nLCB0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIHZhciB0ZXh0ID0gZS5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubW92ZS5iZWdpbk9mRmlsZSgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVJhdyA9IGZ1bmN0aW9uKHJhdykge1xuICBjb25zb2xlLmxvZygnZmlsZSByYXchJylcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0VGFiTW9kZSA9IGZ1bmN0aW9uKGNoYXIpIHtcbiAgaWYgKCdcXHQnID09PSBjaGFyKSB7XG4gICAgdGhpcy50YWIgPSBjaGFyO1xuICB9IGVsc2Uge1xuICAgIHRoaXMudGFiID0gbmV3IEFycmF5KHRoaXMudGFiU2l6ZSArIDEpLmpvaW4oY2hhcik7XG4gIH1cbn1cblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgLy8gdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIC8vIHRoaXMuc2V0VGFiTW9kZSh0aGlzLmJ1ZmZlci5zeW50YXgudGFiKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSGlzdG9yeUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVwYWludCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJlZm9yZUZpbGVDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgLy8gdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgdGhpcy5lZGl0Q2FyZXRCZWZvcmUgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKGVkaXRSYW5nZSwgZWRpdFNoaWZ0LCB0ZXh0QmVmb3JlLCB0ZXh0QWZ0ZXIpIHtcbiAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gIHRoaXMuZWRpdGluZyA9IHRydWU7XG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcblxuICBpZiAodGhpcy5maW5kLmlzT3Blbikge1xuICAgIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUsIHRydWUpO1xuICB9XG5cbiAgLy8gdGhpcy5oaXN0b3J5LnNhdmUoKTtcblxuICB0aGlzLnZpZXdzLmNvZGUucmVuZGVyRWRpdCh7XG4gICAgbGluZTogZWRpdFJhbmdlWzBdLFxuICAgIHJhbmdlOiBlZGl0UmFuZ2UsXG4gICAgc2hpZnQ6IGVkaXRTaGlmdCxcbiAgICBjYXJldE5vdzogdGhpcy5jYXJldCxcbiAgICBjYXJldEJlZm9yZTogdGhpcy5lZGl0Q2FyZXRCZWZvcmVcbiAgfSk7XG5cbiAgdGhpcy5yZW5kZXIoKTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXRGcm9tUHggPSBmdW5jdGlvbihweCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMubWFyZ2luTGVmdCwgeTogdGhpcy5jaGFyLmhlaWdodC8yIH0pWycrJ10odGhpcy5vZmZzZXQpO1xuICB2YXIgcCA9IHB4WyctJ10oZylbJysnXSh0aGlzLnNjcm9sbClbJ28vJ10odGhpcy5jaGFyKTtcblxuICBwLnkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihwLnksIHRoaXMuYnVmZmVyLmxvYygpKSk7XG4gIHAueCA9IE1hdGgubWF4KDAsIHAueCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldENvb3Jkc1RhYnMocCk7XG5cbiAgcC54ID0gTWF0aC5tYXgoXG4gICAgMCxcbiAgICBNYXRoLm1pbihcbiAgICAgIHAueCAtIHRhYnMudGFicyArIHRhYnMucmVtYWluZGVyLFxuICAgICAgdGhpcy5nZXRMaW5lTGVuZ3RoKHAueSlcbiAgICApXG4gICk7XG5cbiAgdGhpcy5zZXRDYXJldChwKTtcbiAgdGhpcy5tb3ZlLmxhc3REZWxpYmVyYXRlWCA9IHAueDtcbiAgdGhpcy5vbk1vdmUoKTtcblxuICByZXR1cm4gcDtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VVcCA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHRoaXMuYmx1cigpO1xuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEb3duID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQodGhpcy5mb2N1cy5iaW5kKHRoaXMpLCAxMCk7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0KSB0aGlzLm1hcmtCZWdpbigpO1xuICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldCA9IGZ1bmN0aW9uKHAsIGNlbnRlciwgYW5pbWF0ZSkge1xuICB0aGlzLmNhcmV0LnNldChwKTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0UG9pbnRUYWJzKHRoaXMuY2FyZXQpO1xuXG4gIHRoaXMuY2FyZXRQeC5zZXQoe1xuICAgIHg6IHRoaXMuY2hhci53aWR0aCAqICh0aGlzLmNhcmV0LnggKyB0YWJzLnRhYnMgKiB0aGlzLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlciksXG4gICAgeTogdGhpcy5jaGFyLmhlaWdodCAqIHRoaXMuY2FyZXQueVxuICB9KTtcblxuICB0aGlzLmZvbGxvd0NhcmV0KGNlbnRlciwgYW5pbWF0ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICAgIC8vIHRoaXMucmVuZGVyKCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gUmFuZ2UuY2xhbXAocmFuZ2UsIHRoaXMucGFnZUJvdW5kcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcCA9IHRoaXMuc2Nyb2xsWydfLyddKHRoaXMuY2hhcik7XG4gIGlmICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsKSB7XG4gICAgcC55IC09IHRoaXMucGFnZS5oZWlnaHQgLyAzIHwgMDtcbiAgfVxuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDtcbn07XG5cbkphenoucHJvdG90eXBlLmZvbGxvd0NhcmV0ID0gZnVuY3Rpb24oY2VudGVyLCBhbmltYXRlKSB7XG4gIHZhciBwID0gdGhpcy5jYXJldFB4O1xuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHZhciB0b3AgPSAoXG4gICAgICBzLnlcbiAgICArIChjZW50ZXIgJiYgIXRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDIgfCAwKSAtIDEwMCA6IDApXG4gICkgLSBwLnk7XG5cbiAgdmFyIGJvdHRvbSA9IHAueSAtIChcbiAgICAgIHMueVxuICAgICsgdGhpcy5zaXplLmhlaWdodFxuICAgIC0gKGNlbnRlciAmJiAhdGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMiB8IDApIC0gMTAwIDogMClcbiAgICAtICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAzICogMiB8IDApIDogMClcbiAgKSArIHRoaXMuY2hhci5oZWlnaHQ7XG5cbiAgdmFyIGxlZnQgPSAocy54ICsgdGhpcy5jaGFyLndpZHRoKSAtIHAueDtcbiAgdmFyIHJpZ2h0ID0gKHAueCkgLSAocy54ICsgdGhpcy5zaXplLndpZHRoIC0gdGhpcy5tYXJnaW5MZWZ0KSArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgaWYgKGJvdHRvbSA8IDApIGJvdHRvbSA9IDA7XG4gIGlmICh0b3AgPCAwKSB0b3AgPSAwO1xuICBpZiAobGVmdCA8IDApIGxlZnQgPSAwO1xuICBpZiAocmlnaHQgPCAwKSByaWdodCA9IDA7XG5cbiAgLy8gaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpXG4gIGlmIChsZWZ0ICsgdG9wICsgcmlnaHQgKyBib3R0b20pIHtcbiAgICB0aGlzW2FuaW1hdGUgPyAnYW5pbWF0ZVNjcm9sbEJ5JyA6ICdzY3JvbGxCeSddKHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wLCAnZWFzZScpO1xuICB9XG4gIC8vIGVsc2VcbiAgICAvLyB0aGlzLmFuaW1hdGVTY3JvbGxCeShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB2YXIgdGFyZ2V0ID0gUG9pbnQubG93KHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfSwge1xuICAgIHg6IHRoaXMuc2Nyb2xsLnggKyB4LFxuICAgIHk6IHRoaXMuc2Nyb2xsLnkgKyB5XG4gIH0pO1xuXG4gIGlmIChQb2ludC5zb3J0KHRhcmdldCwgdGhpcy5zY3JvbGwpICE9PSAwKSB7XG4gICAgdGhpcy5zY3JvbGwuc2V0KHRhcmdldCk7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHksIGFuaW1hdGlvblR5cGUpIHtcbiAgdGhpcy5hbmltYXRpb25UeXBlID0gYW5pbWF0aW9uVHlwZSB8fCAnbGluZWFyJztcblxuICBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIGlmICgnbGluZWFyJyA9PT0gdGhpcy5hbmltYXRpb25UeXBlKSB7XG4gICAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgfVxuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IHRydWU7XG4gICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbik7XG4gIH1cblxuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1heCgwLCBzLnggKyB4KSxcbiAgICB5OiBNYXRoLm1pbihcbiAgICAgICAgKHRoaXMucm93cyArIDEpICogdGhpcy5jaGFyLmhlaWdodCAtIHRoaXMuc2l6ZS5oZWlnaHRcbiAgICAgICsgKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyB0aGlzLnNpemUuaGVpZ2h0IC8gMyAqIDIgfCAwIDogMCksXG4gICAgICBNYXRoLm1heCgwLCBzLnkgKyB5KVxuICAgIClcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoKGFkeCA8IDEgJiYgYWR5IDwgMSkgfHwgIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQpO1xuICAgIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2FuaW1hdGlvbiBlbmQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBzd2l0Y2ggKHRoaXMuYW5pbWF0aW9uVHlwZSkge1xuICAgIGNhc2UgJ2xpbmVhcic6XG4gICAgICBpZiAoYWR4IDwgc3BlZWQpIGR4ICo9IDAuOTtcbiAgICAgIGVsc2UgZHggPSBNYXRoLnNpZ24oZHgpICogc3BlZWQ7XG5cbiAgICAgIGlmIChhZHkgPCBzcGVlZCkgZHkgKj0gMC45O1xuICAgICAgZWxzZSBkeSA9IE1hdGguc2lnbihkeSkgKiBzcGVlZDtcblxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZWFzZSc6XG4gICAgICBkeCAqPSAwLjU7XG4gICAgICBkeSAqPSAwLjU7XG4gICAgICBicmVhaztcbiAgfVxuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMuZGVsZXRlKCk7XG5cbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dCh0aGlzLmNhcmV0LnkpO1xuICB2YXIgcmlnaHQgPSBsaW5lW3RoaXMuY2FyZXQueF07XG4gIHZhciBoYXNSaWdodFN5bWJvbCA9IH5bJ30nLCddJywnKSddLmluZGV4T2YocmlnaHQpO1xuXG4gIC8vIGFwcGx5IGluZGVudCBvbiBlbnRlclxuICBpZiAoTkVXTElORS50ZXN0KHRleHQpKSB7XG4gICAgdmFyIGlzRW5kT2ZMaW5lID0gdGhpcy5jYXJldC54ID09PSBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGxlZnQgPSBsaW5lW3RoaXMuY2FyZXQueCAtIDFdO1xuICAgIHZhciBpbmRlbnQgPSBsaW5lLm1hdGNoKC9cXFMvKTtcbiAgICBpbmRlbnQgPSBpbmRlbnQgPyBpbmRlbnQuaW5kZXggOiBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGhhc0xlZnRTeW1ib2wgPSB+Wyd7JywnWycsJygnXS5pbmRleE9mKGxlZnQpO1xuXG4gICAgaWYgKGhhc0xlZnRTeW1ib2wpIGluZGVudCArPSAyO1xuXG4gICAgaWYgKGlzRW5kT2ZMaW5lIHx8IGhhc0xlZnRTeW1ib2wpIHtcbiAgICAgIHRleHQgKz0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKTtcbiAgICB9XG4gIH1cblxuICB2YXIgbGVuZ3RoO1xuXG4gIGlmICghaGFzUmlnaHRTeW1ib2wgfHwgKGhhc1JpZ2h0U3ltYm9sICYmICF+Wyd9JywnXScsJyknXS5pbmRleE9mKHRleHQpKSkge1xuICAgIGxlbmd0aCA9IHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCB0ZXh0KTtcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSAxO1xuICB9XG5cbiAgdGhpcy5tb3ZlLmJ5Q2hhcnMobGVuZ3RoLCB0cnVlKTtcblxuICBpZiAoJ3snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ30nKTtcbiAgZWxzZSBpZiAoJygnID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJyknKTtcbiAgZWxzZSBpZiAoJ1snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ10nKTtcblxuICBpZiAoaGFzTGVmdFN5bWJvbCAmJiBoYXNSaWdodFN5bWJvbCkge1xuICAgIGluZGVudCAtPSAyO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJykpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iYWNrc3BhY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybiB0aGlzLmRlbGV0ZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSwgdHJ1ZSk7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQ2hhckF0UG9pbnQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuIHRoaXMuYmFja3NwYWNlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5maW5kSnVtcCA9IGZ1bmN0aW9uKGp1bXApIHtcbiAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCB8fCAhdGhpcy5maW5kLmlzT3BlbikgcmV0dXJuO1xuXG4gIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZE5lZWRsZSArIGp1bXA7XG4gIGlmICh0aGlzLmZpbmROZWVkbGUgPj0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSAwO1xuICB9IGVsc2UgaWYgKHRoaXMuZmluZE5lZWRsZSA8IDApIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCAtIDE7XG4gIH1cblxuICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0LCB0cnVlLCB0cnVlKTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KHRydWUsIHRydWUpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kVmFsdWUgPSBmdW5jdGlvbih2YWx1ZSwgbm9KdW1wKSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5ndXR0ZXIsIHk6IDAgfSk7XG5cbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuICB0aGlzLmZpbmRWYWx1ZSA9IHZhbHVlO1xuICB0aGlzLmZpbmRSZXN1bHRzID0gdGhpcy5idWZmZXIuaW5kZXhlci5maW5kKHZhbHVlKS5tYXAoKG9mZnNldCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpO1xuICB9KTtcblxuICBpZiAodGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmQuaW5mbygxICsgdGhpcy5maW5kTmVlZGxlICsgJy8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuICB9XG5cbiAgaWYgKCFub0p1bXApIHRoaXMuZmluZEp1bXAoMCk7XG5cbiAgdGhpcy52aWV3cy5maW5kLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuICB0aGlzLmZvY3VzKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zdWdnZXN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQsIHRydWUpO1xuICBpZiAoIWFyZWEpIHJldHVybjtcblxuICB2YXIga2V5ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGlmICgha2V5KSByZXR1cm47XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3RSb290XG4gICAgfHwga2V5LnN1YnN0cigwLCB0aGlzLnN1Z2dlc3RSb290Lmxlbmd0aCkgIT09IHRoaXMuc3VnZ2VzdFJvb3QpIHtcbiAgICB0aGlzLnN1Z2dlc3RJbmRleCA9IDA7XG4gICAgdGhpcy5zdWdnZXN0Um9vdCA9IGtleTtcbiAgICB0aGlzLnN1Z2dlc3ROb2RlcyA9IHRoaXMuYnVmZmVyLnByZWZpeC5jb2xsZWN0KGtleSk7XG4gIH1cblxuICBpZiAoIXRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aCkgcmV0dXJuO1xuICB2YXIgbm9kZSA9IHRoaXMuc3VnZ2VzdE5vZGVzW3RoaXMuc3VnZ2VzdEluZGV4XTtcblxuICB0aGlzLnN1Z2dlc3RJbmRleCA9ICh0aGlzLnN1Z2dlc3RJbmRleCArIDEpICUgdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoO1xuXG4gIHJldHVybiB7XG4gICAgYXJlYTogYXJlYSxcbiAgICBub2RlOiBub2RlXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQb2ludFRhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYiA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXIgKyB0YWJzXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRDb29yZHNUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWJzICogdGhpcy50YWJTaXplICsgcmVtYWluZGVyID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlclxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVwYWludEJlbG93Q2FyZXQgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy52aWV3cy5jb2RlLnJlcGFpbnRCZWxvd0NhcmV0KCk7XG59LCA0MCk7XG5cbkphenoucHJvdG90eXBlLnJlcGFpbnQgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2l6ZSgpO1xuICB0aGlzLnJlbmRlcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgJCA9IHRoaXMuZWw7XG5cbiAgdGhpcy5vZmZzZXQuc2V0KGRvbS5nZXRPZmZzZXQoJCkpO1xuICB0aGlzLnNjcm9sbC5zZXQoZG9tLmdldFNjcm9sbCgkKSk7XG4gIHRoaXMuc2l6ZS5zZXQoZG9tLmdldFNpemUoJCkpO1xuXG4gIC8vIHRoaXMgaXMgYSB3ZWlyZCBmaXggd2hlbiBkb2luZyBtdWx0aXBsZSAudXNlKClcbiAgaWYgKHRoaXMuY2hhci53aWR0aCA9PT0gMCkgdGhpcy5jaGFyLnNldChkb20uZ2V0Q2hhclNpemUoJCwgY3NzLmNvZGUpKTtcblxuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2MoKTtcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG4gIHRoaXMucGFnZS5zZXQodGhpcy5zaXplWydeLyddKHRoaXMuY2hhcikpO1xuICB0aGlzLnBhZ2VSZW1haW5kZXIuc2V0KHRoaXMuc2l6ZVsnLSddKHRoaXMucGFnZVsnXyonXSh0aGlzLmNoYXIpKSk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuICAvLyB0aGlzLmxvbmdlc3RMaW5lID0gTWF0aC5taW4oNTAwLCB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMb25nZXN0TGluZUxlbmd0aCgpKTtcbiAgdGhpcy5ndXR0ZXIgPSBNYXRoLm1heChcbiAgICB0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aCxcbiAgICAodGhpcy5vcHRpb25zLmNlbnRlcl9ob3Jpem9udGFsXG4gICAgICA/ICh0aGlzLnBhZ2Uud2lkdGggLSA4MSAtICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpIC8gMiB8IDAgOiAwKVxuICAgICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3NcbiAgICAgID8gMCA6IE1hdGgubWF4KDMsICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpXG4gICkgKiB0aGlzLmNoYXIud2lkdGggKyAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiB0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbiAqICh0aGlzLm9wdGlvbnMuY2VudGVyX2hvcml6b250YWwgPyAtMSA6IDEpKTtcbiAgdGhpcy5tYXJnaW5MZWZ0ID0gdGhpcy5ndXR0ZXIgKyB0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjJyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSB7XG4gICAgICB0b3A6ICR7dGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIDogMH1weDtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MucnVsZXJ9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5maW5kfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MubWFya30sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmNvZGV9IHtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5yb3dzfSB7XG4gICAgICBwYWRkaW5nLXJpZ2h0OiAke3RoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2lufXB4O1xuICAgICAgcGFkZGluZy1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdH1weDtcbiAgICAgIHdpZHRoOiAke3RoaXMubWFyZ2luTGVmdH1weDtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmZpbmR9ID4gaSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuYmxvY2t9ID4gaSB7XG4gICAgICBoZWlnaHQ6ICR7dGhpcy5jaGFyLmhlaWdodCArIDF9cHg7XG4gICAgfVxuICAgIHgge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gYmluZFJhZihmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2NsZWFyJylcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIHRoaXMudmlld3MuY2xlYXIoKTtcbn0pO1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygncmVuZGVyJylcbiAgdGhpcy52aWV3cy5yZW5kZXIoKTtcbn0pO1xuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFyZWE7XG5cbmZ1bmN0aW9uIEFyZWEoYSkge1xuICBpZiAoYSkge1xuICAgIHRoaXMuYmVnaW4gPSBuZXcgUG9pbnQoYS5iZWdpbik7XG4gICAgdGhpcy5lbmQgPSBuZXcgUG9pbnQoYS5lbmQpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuYmVnaW4gPSBuZXcgUG9pbnQ7XG4gICAgdGhpcy5lbmQgPSBuZXcgUG9pbnQ7XG4gIH1cbn1cblxuQXJlYS5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IEFyZWEodGhpcyk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHMgPSBbdGhpcy5iZWdpbiwgdGhpcy5lbmRdLnNvcnQoUG9pbnQuc29ydCk7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IG5ldyBQb2ludChzWzBdKSxcbiAgICBlbmQ6IG5ldyBQb2ludChzWzFdKVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdGhpcy5iZWdpbi5zZXQoYXJlYS5iZWdpbik7XG4gIHRoaXMuZW5kLnNldChhcmVhLmVuZCk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXRMZWZ0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLmJlZ2luLnggPSB4O1xuICB0aGlzLmVuZC54ID0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgaWYgKHRoaXMuYmVnaW4ueCkgdGhpcy5iZWdpbi54ICs9IHg7XG4gIGlmICh0aGlzLmVuZC54KSB0aGlzLmVuZC54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkQm90dG9tID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLmVuZC55ICs9IHk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2hpZnRCeUxpbmVzID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLmJlZ2luLnkgKz0geTtcbiAgdGhpcy5lbmQueSArPSB5O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz4nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5lbmQueVxuICAgID8gdGhpcy5iZWdpbi54ID4gYS5lbmQueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PSddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgPyB0aGlzLmJlZ2luLnggPj0gYS5iZWdpbi54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPCddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5iZWdpbi55XG4gICAgPyB0aGlzLmVuZC54IDwgYS5iZWdpbi54XG4gICAgOiB0aGlzLmVuZC55IDwgYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueVxuICAgID8gdGhpcy5lbmQueCA8PSBhLmVuZC54XG4gICAgOiB0aGlzLmVuZC55IDwgYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJz4nXShhKSAmJiB0aGlzWyc8J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD4nXSA9XG5BcmVhLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPCddKGEpIHx8IHRoaXNbJz4nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PTwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJz49J10oYSkgJiYgdGhpc1snPD0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PT4nXSA9XG5BcmVhLnByb3RvdHlwZS5vdXRzaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8PSddKGEpIHx8IHRoaXNbJz49J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPT09J10gPVxuQXJlYS5wcm90b3R5cGUuZXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnggPT09IGEuYmVnaW4ueCAmJiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgICAgJiYgdGhpcy5lbmQueCAgID09PSBhLmVuZC54ICAgJiYgdGhpcy5lbmQueSAgID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9J10gPVxuQXJlYS5wcm90b3R5cGUuYmVnaW5MaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9fCddID1cbkFyZWEucHJvdG90eXBlLmVuZExpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD18J10gPVxuQXJlYS5wcm90b3R5cGUubGluZXNFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJ3w9J10oYSkgJiYgdGhpc1snPXwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9fD0nXSA9XG5BcmVhLnByb3RvdHlwZS5zYW1lTGluZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gdGhpcy5lbmQueSAmJiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycteC0nXSA9XG5BcmVhLnByb3RvdHlwZS5zaG9ydGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggKyB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggLSB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnK3grJ10gPVxuQXJlYS5wcm90b3R5cGUud2lkZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCAtIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCArIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEub2Zmc2V0ID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXQoYi5iZWdpbiwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXQoYi5lbmQsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRYID0gZnVuY3Rpb24oeCwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRYKHgsIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WCh4LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WSh5LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFkoeSwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuICcnICsgYS5iZWdpbiArICctJyArIGEuZW5kO1xufTtcblxuQXJlYS5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55ID09PSBiLmJlZ2luLnlcbiAgICA/IGEuYmVnaW4ueCAtIGIuYmVnaW4ueFxuICAgIDogYS5iZWdpbi55IC0gYi5iZWdpbi55O1xufTtcblxuQXJlYS50b1BvaW50U29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA8PSBiLnkgJiYgYS5lbmQueSA+PSBiLnlcbiAgICA/IGEuYmVnaW4ueSA9PT0gYi55XG4gICAgICA/IGEuYmVnaW4ueCAtIGIueFxuICAgICAgOiBhLmVuZC55ID09PSBiLnlcbiAgICAgICAgPyBhLmVuZC54IC0gYi54XG4gICAgICAgIDogMFxuICAgIDogYS5iZWdpbi55IC0gYi55O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBiaW5hcnlTZWFyY2g7XG5cbmZ1bmN0aW9uIGJpbmFyeVNlYXJjaChhcnJheSwgY29tcGFyZSkge1xuICB2YXIgaW5kZXggPSAtMTtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGxvdyA9IDA7XG4gIHZhciBoaWdoID0gYXJyYXkubGVuZ3RoO1xuICBpZiAoIWhpZ2gpIHJldHVybiB7XG4gICAgaXRlbTogbnVsbCxcbiAgICBpbmRleDogMFxuICB9O1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaW5kZXg7XG4gICAgaW5kZXggPSBsb3cgKyAoaGlnaCAtIGxvdyA+PiAxKTtcbiAgICB2YXIgaXRlbSA9IGFycmF5W2luZGV4XTtcbiAgICB2YXIgcmVzdWx0ID0gY29tcGFyZShpdGVtKTtcblxuICAgIGlmIChyZXN1bHQpIGxvdyA9IGluZGV4O1xuICAgIGVsc2UgaGlnaCA9IGluZGV4O1xuICB9IHdoaWxlIChwcmV2ICE9PSBpbmRleCk7XG5cbiAgaWYgKGl0ZW0gIT0gbnVsbCkge1xuICAgIHJldHVybiB7XG4gICAgICBpdGVtOiBpdGVtLFxuICAgICAgaW5kZXg6IGluZGV4XG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgaXRlbTogbnVsbCxcbiAgICBpbmRleDogfmxvdyAqIC0xIC0gMVxuICB9O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbikge1xuICB2YXIgcmVxdWVzdDtcbiAgcmV0dXJuIGZ1bmN0aW9uIHJhZldyYXAoYSwgYiwgYywgZCkge1xuICAgIHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZShyZXF1ZXN0KTtcbiAgICByZXF1ZXN0ID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZShmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpKTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gQm94O1xuXG5mdW5jdGlvbiBCb3goYikge1xuICBpZiAoYikge1xuICAgIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICAgIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy53aWR0aCA9IDA7XG4gICAgdGhpcy5oZWlnaHQgPSAwO1xuICB9XG59XG5cbkJveC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYikge1xuICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbn07XG5cbkJveC5wcm90b3R5cGVbJy8nXSA9XG5Cb3gucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXy8nXSA9XG5Cb3gucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14vJ10gPVxuQm94LnByb3RvdHlwZS5jZWlsZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnbyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLnJvdW5kKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5yb3VuZCh0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWyctJ10gPVxuQm94LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAtIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC0gKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2xvbmUob2JqKSB7XG4gIHZhciBvID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICB2YXIgdmFsID0gb2JqW2tleV07XG4gICAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgdmFsKSB7XG4gICAgICBvW2tleV0gPSBjbG9uZSh2YWwpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvW2tleV0gPSB2YWw7XG4gICAgfVxuICB9XG4gIHJldHVybiBvO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGRlYm91bmNlV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCksIG1zKTtcbiAgICByZXR1cm4gdGltZW91dDtcbiAgfVxufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2V2ZW50Jyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zdHlsZS5jc3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBEaWFsb2c7XG5cbmZ1bmN0aW9uIERpYWxvZyhsYWJlbCwga2V5bWFwKSB7XG4gIHRoaXMubm9kZSA9IGRvbShjc3MuZGlhbG9nLCBbXG4gICAgYDxsYWJlbD4ke2Nzcy5sYWJlbH1gLFxuICAgIFtjc3MuaW5wdXQsIFtcbiAgICAgIGA8aW5wdXQ+JHtjc3MudGV4dH1gLFxuICAgICAgY3NzLmluZm9cbiAgICBdXVxuICBdKTtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5sYWJlbF0sIGxhYmVsKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiAnbm9uZScgfSk7XG4gIHRoaXMua2V5bWFwID0ga2V5bWFwO1xuICB0aGlzLm9uYm9keWtleWRvd24gPSB0aGlzLm9uYm9keWtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9uY2xpY2sgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2V1cCA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZWRvd24gPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQ7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG59XG5cbkRpYWxvZy5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5mdW5jdGlvbiBzdG9wUHJvcGFnYXRpb24oZSkge1xuICBlLnN0b3BQcm9wYWdhdGlvbigpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5oYXNGb2N1cyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwuaGFzRm9jdXMoKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25ib2R5a2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDI3ID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuY2xvc2UoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMTMgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5zdWJtaXQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGUud2hpY2ggaW4gdGhpcy5rZXltYXApIHtcbiAgICB0aGlzLmVtaXQoJ2tleScsIGUpO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndmFsdWUnLCB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwudmFsdWUpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIGRvbS5hcHBlbmQoZG9jdW1lbnQuYm9keSwgdGhpcy5ub2RlKTtcbiAgZG9tLmZvY3VzKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XSk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC5zZWxlY3QoKTtcbiAgdGhpcy5pc09wZW4gPSB0cnVlO1xuICB0aGlzLmVtaXQoJ29wZW4nKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5yZW1vdmVFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgdGhpcy5ub2RlLmVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodGhpcy5ub2RlLmVsKTtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbiAgdGhpcy5lbWl0KCdjbG9zZScpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5zdWJtaXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5lbWl0KCdzdWJtaXQnLCB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwudmFsdWUpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5pbmZvID0gZnVuY3Rpb24oaW5mbykge1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIGluZm8pO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6IGluZm8gPyAnYmxvY2snIDogJ25vbmUnIH0pO1xufTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZGlhbG9nXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fZGlhbG9nXCIsXCJpbnB1dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2lucHV0XCIsXCJ0ZXh0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fdGV4dFwiLFwibGFiZWxcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19sYWJlbFwiLFwiaW5mb1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2luZm9cIn0iLCJcbm1vZHVsZS5leHBvcnRzID0gZGlmZjtcblxuZnVuY3Rpb24gZGlmZihhLCBiKSB7XG4gIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGEpIHtcbiAgICB2YXIgZCA9IHt9O1xuICAgIHZhciBpID0gMDtcbiAgICBmb3IgKHZhciBrIGluIGIpIHtcbiAgICAgIGlmIChhW2tdICE9PSBiW2tdKSB7XG4gICAgICAgIGRba10gPSBiW2tdO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpKSByZXR1cm4gZDtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYSAhPT0gYjtcbiAgfVxufVxuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi9wb2ludCcpO1xudmFyIGJpbmRSYWYgPSByZXF1aXJlKCcuL2JpbmQtcmFmJyk7XG52YXIgbWVtb2l6ZSA9IHJlcXVpcmUoJy4vbWVtb2l6ZScpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9tZXJnZScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG52YXIgdW5pdHMgPSB7XG4gIGxlZnQ6ICdweCcsXG4gIHRvcDogJ3B4JyxcbiAgcmlnaHQ6ICdweCcsXG4gIGJvdHRvbTogJ3B4JyxcbiAgd2lkdGg6ICdweCcsXG4gIGhlaWdodDogJ3B4JyxcbiAgbWF4SGVpZ2h0OiAncHgnLFxuICBwYWRkaW5nTGVmdDogJ3B4Jyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZG9tO1xuXG5mdW5jdGlvbiBkb20obmFtZSwgY2hpbGRyZW4sIGF0dHJzKSB7XG4gIHZhciBlbDtcbiAgdmFyIHRhZyA9ICdkaXYnO1xuICB2YXIgbm9kZTtcblxuICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiBuYW1lKSB7XG4gICAgaWYgKCc8JyA9PT0gbmFtZS5jaGFyQXQoMCkpIHtcbiAgICAgIHZhciBtYXRjaGVzID0gbmFtZS5tYXRjaCgvKD86PCkoLiopKD86PikoXFxTKyk/Lyk7XG4gICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICB0YWcgPSBtYXRjaGVzWzFdO1xuICAgICAgICBuYW1lID0gbWF0Y2hlc1syXSB8fCB0YWc7XG4gICAgICB9XG4gICAgfVxuICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCh0YWcpO1xuICAgIG5vZGUgPSB7XG4gICAgICBlbDogZWwsXG4gICAgICBuYW1lOiBuYW1lLnNwbGl0KCcgJylbMF1cbiAgICB9O1xuICAgIGRvbS5jbGFzc2VzKG5vZGUsIG5hbWUuc3BsaXQoJyAnKS5zbGljZSgxKSk7XG4gIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIHJldHVybiBkb20uYXBwbHkobnVsbCwgbmFtZSk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCdkb20nIGluIG5hbWUpIHtcbiAgICAgIG5vZGUgPSBuYW1lLmRvbTtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZSA9IG5hbWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKSB7XG4gICAgY2hpbGRyZW5cbiAgICAgIC5tYXAoZG9tKVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCwgaSkge1xuICAgICAgICBub2RlW2NoaWxkLm5hbWVdID0gY2hpbGQ7XG4gICAgICAgIHJldHVybiBjaGlsZDtcbiAgICAgIH0pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkKSB7XG4gICAgICAgIG5vZGUuZWwuYXBwZW5kQ2hpbGQoY2hpbGQuZWwpO1xuICAgICAgfSk7XG4gIH0gZWxzZSBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBjaGlsZHJlbikge1xuICAgIGRvbS5zdHlsZShub2RlLCBjaGlsZHJlbik7XG4gIH1cblxuICBpZiAoYXR0cnMpIHtcbiAgICBkb20uYXR0cnMobm9kZSwgYXR0cnMpO1xuICB9XG5cbiAgcmV0dXJuIG5vZGU7XG59XG5cbmRvbS5zdHlsZSA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIF8sIHN0eWxlKSB7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufSwgZGlmZiwgbWVyZ2UsIGZ1bmN0aW9uKG5vZGUsIHN0eWxlKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBzdHlsZV07XG59KTtcblxuLypcbmRvbS5zdHlsZSA9IGZ1bmN0aW9uKGVsLCBzdHlsZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59O1xuKi9cbmRvbS5jbGFzc2VzID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbn0sIG51bGwsIG51bGwsIGZ1bmN0aW9uKG5vZGUsIGNsYXNzZXMpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIGNsYXNzZXMuY29uY2F0KG5vZGUubmFtZSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKV07XG59KTtcblxuZG9tLmF0dHJzID0gZnVuY3Rpb24oZWwsIGF0dHJzKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBPYmplY3QuYXNzaWduKGVsLCBhdHRycyk7XG59O1xuXG5kb20uaHRtbCA9IGZ1bmN0aW9uKGVsLCBodG1sKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZG9tLnRleHQgPSBmdW5jdGlvbihlbCwgdGV4dCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xufTtcblxuZG9tLmZvY3VzID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmZvY3VzKCk7XG59O1xuXG5kb20uZ2V0U2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlbC5jbGllbnRXaWR0aCxcbiAgICBoZWlnaHQ6IGVsLmNsaWVudEhlaWdodFxuICB9O1xufTtcblxuZG9tLmdldENoYXJTaXplID0gZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHNwYW4uY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuXG4gIGVsLmFwcGVuZENoaWxkKHNwYW4pO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAnO1xuICB2YXIgYSA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICBcXG4gJztcbiAgdmFyIGIgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIGVsLnJlbW92ZUNoaWxkKHNwYW4pO1xuXG4gIHJldHVybiB7XG4gICAgd2lkdGg6IChiLndpZHRoIC0gYS53aWR0aCksXG4gICAgaGVpZ2h0OiAoYi5oZWlnaHQgLSBhLmhlaWdodClcbiAgfTtcbn07XG5cbmRvbS5nZXRPZmZzZXQgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpO1xuICB2YXIgYm9yZGVyTGVmdCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlckxlZnRXaWR0aCk7XG4gIHZhciBib3JkZXJUb3AgPSBwYXJzZUludChzdHlsZS5ib3JkZXJUb3BXaWR0aCk7XG4gIHJldHVybiBQb2ludC5sb3coeyB4OiAwLCB5OiAwIH0sIHtcbiAgICB4OiAocmVjdC5sZWZ0ICsgYm9yZGVyTGVmdCkgfCAwLFxuICAgIHk6IChyZWN0LnRvcCArIGJvcmRlclRvcCkgfCAwXG4gIH0pO1xufTtcblxuZG9tLmdldFNjcm9sbCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4gZ2V0U2Nyb2xsKGVsKTtcbn07XG5cbmRvbS5vbnNjcm9sbCA9IGZ1bmN0aW9uIG9uc2Nyb2xsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZzY3JvbGwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20ucmVtb3ZlID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChlbC5wYXJlbnROb2RlKSBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKTtcbn07XG5cbmRvbS5nZXRFbGVtZW50ID0gZnVuY3Rpb24oZWwpIHtcbiAgcmV0dXJuIGVsLmRvbSAmJiBlbC5kb20uZWwgfHwgZWwuZWwgfHwgZWwubm9kZSB8fCBlbDtcbn07XG5cbmRvbS5zY3JvbGxCeSA9IGZ1bmN0aW9uKGVsLCB4LCB5LCBzY3JvbGwpIHtcbiAgc2Nyb2xsID0gc2Nyb2xsIHx8IGRvbS5nZXRTY3JvbGwoZWwpO1xuICBkb20uc2Nyb2xsVG8oZWwsIHNjcm9sbC54ICsgeCwgc2Nyb2xsLnkgKyB5KTtcbn07XG5cbmRvbS5zY3JvbGxUbyA9IGZ1bmN0aW9uKGVsLCB4LCB5KSB7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIHdpbmRvdy5zY3JvbGxUbyh4LCB5KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5zY3JvbGxMZWZ0ID0geCB8fCAwO1xuICAgIGVsLnNjcm9sbFRvcCA9IHkgfHwgMDtcbiAgfVxufTtcblxuZG9tLmNzcyA9IGJpbmRSYWYoZnVuY3Rpb24oaWQsIGNzc1RleHQpIHtcbiAgaWYgKCEoaWQgaW4gZG9tLmNzcy5zdHlsZXMpKSB7XG4gICAgZG9tLmNzcy5zdHlsZXNbaWRdID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvbS5jc3Muc3R5bGVzW2lkXSk7XG4gIH1cbiAgZG9tLmNzcy5zdHlsZXNbaWRdLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn0pO1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFBvaW50O1xuXG5mdW5jdGlvbiBQb2ludChwKSB7XG4gIGlmIChwKSB7XG4gICAgdGhpcy54ID0gcC54O1xuICAgIHRoaXMueSA9IHAueTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gIH1cbn1cblxuUG9pbnQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy54ID0gcC54O1xuICB0aGlzLnkgPSBwLnk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFBvaW50KHRoaXMpO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28vJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXi8nXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycrJ10gPVxuUG9pbnQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSArIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy0nXSA9XG5Qb2ludC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLSAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC0gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKiddID1cblBvaW50LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeKiddID1cblBvaW50LnByb3RvdHlwZS5jZWlsTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXyonXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICd4OicgKyB0aGlzLnggKyAnLHk6JyArIHRoaXMueTtcbn07XG5cblBvaW50LnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5Qb2ludC5ncmlkUm91bmQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5yb3VuZChhLnggLyBiLndpZHRoKSxcbiAgICB5OiBNYXRoLnJvdW5kKGEueSAvIGIuaGVpZ2h0KVxuICB9O1xufTtcblxuUG9pbnQubG93ID0gZnVuY3Rpb24obG93LCBwKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5tYXgobG93LngsIHAueCksXG4gICAgeTogTWF0aC5tYXgobG93LnksIHAueSlcbiAgfTtcbn07XG5cblBvaW50LmNsYW1wID0gZnVuY3Rpb24oYXJlYSwgcCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfSk7XG59O1xuXG5Qb2ludC5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7IHg6IGEueCArIGIueCwgeTogYS55ICsgYi55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRYID0gZnVuY3Rpb24oeCwgcCkge1xuICByZXR1cm4geyB4OiBwLnggKyB4LCB5OiBwLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFkgPSBmdW5jdGlvbih5LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCwgeTogcC55ICsgeSB9O1xufTtcblxuUG9pbnQudG9MZWZ0VG9wID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHAueCxcbiAgICB0b3A6IHAueVxuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBBTkQ7XG5cbmZ1bmN0aW9uIEFORChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBOT1Q7XG5cbmZ1bmN0aW9uIE5PVChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJ2YXIgQU5EID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLWFuZCcpO1xudmFyIE5PVCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1ub3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSYW5nZTtcblxuZnVuY3Rpb24gUmFuZ2Uocikge1xuICBpZiAocikge1xuICAgIHRoaXNbMF0gPSByWzBdO1xuICAgIHRoaXNbMV0gPSByWzFdO1xuICB9IGVsc2Uge1xuICAgIHRoaXNbMF0gPSAwO1xuICAgIHRoaXNbMV0gPSAxO1xuICB9XG59O1xuXG5SYW5nZS5BTkQgPSBBTkQ7XG5SYW5nZS5OT1QgPSBOT1Q7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZSh0aGlzKTtcbn07XG5cblJhbmdlLnJhbmdlcyA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHJldHVybiBpdGVtcy5tYXAoZnVuY3Rpb24oaXRlbSkgeyByZXR1cm4gaXRlbS5yYW5nZSB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA+PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdIDw9IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdmVybGFwID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPD0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA+PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzFdIDwgcmFuZ2VbMF0gfHwgaXRlbS5yYW5nZVswXSA+IHJhbmdlWzFdO1xuICB9KTtcbn07XG4iLCJcbnZhciBSZWdleHAgPSBleHBvcnRzO1xuXG5SZWdleHAuY3JlYXRlID0gZnVuY3Rpb24obmFtZXMsIGZsYWdzLCBmbikge1xuICBmbiA9IGZuIHx8IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMgfTtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgbmFtZXNcbiAgICAubWFwKChuKSA9PiAnc3RyaW5nJyA9PT0gdHlwZW9mIG4gPyBSZWdleHAudHlwZXNbbl0gOiBuKVxuICAgIC5tYXAoKHIpID0+IGZuKHIudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkpXG4gICAgLmpvaW4oJ3wnKSxcbiAgICBmbGFnc1xuICApO1xufTtcblxuUmVnZXhwLnR5cGVzID0ge1xuICAndG9rZW5zJzogLy4rP1xcYnwuXFxCfFxcYi4rPy8sXG4gICd3b3Jkcyc6IC9bYS16QS1aMC05XXsxLH0vLFxuICAncGFydHMnOiAvWy4vXFxcXFxcKFxcKVwiJ1xcLTosLjs8Pn4hQCMkJV4mKlxcfFxcKz1cXFtcXF17fWB+XFw/IF0rLyxcblxuICAnc2luZ2xlIGNvbW1lbnQnOiAvXFwvXFwvLio/JC8sXG4gICdkb3VibGUgY29tbWVudCc6IC9cXC9cXCpbXl0qP1xcKlxcLy8sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogLygnKD86KD86XFxcXFxcbnxcXFxcJ3xbXidcXG5dKSkqPycpLyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiAvKFwiKD86KD86XFxcXFxcbnxcXFxcXCJ8W15cIlxcbl0pKSo/XCIpLyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IC8oYCg/Oig/OlxcXFxgfFteYF0pKSo/YCkvLFxuXG4gICdvcGVyYXRvcic6IC8hfD49P3w8PT98PXsxLDN9fCg/OiYpezEsMn18XFx8P1xcfHxcXD98XFwqfFxcL3x+fFxcXnwlfFxcLig/IVxcZCl8XFwrezEsMn18XFwtezEsMn0vLFxuICAnZnVuY3Rpb24nOiAvICgoPyFcXGR8Wy4gXSo/KGlmfGVsc2V8ZG98Zm9yfGNhc2V8dHJ5fGNhdGNofHdoaWxlfHdpdGh8c3dpdGNoKSlbYS16QS1aMC05XyAkXSspKD89XFwoLipcXCkuKnspLyxcbiAgJ2tleXdvcmQnOiAvXFxiKGJyZWFrfGNhc2V8Y2F0Y2h8Y29uc3R8Y29udGludWV8ZGVidWdnZXJ8ZGVmYXVsdHxkZWxldGV8ZG98ZWxzZXxleHBvcnR8ZXh0ZW5kc3xmaW5hbGx5fGZvcnxmcm9tfGlmfGltcGxlbWVudHN8aW1wb3J0fGlufGluc3RhbmNlb2Z8aW50ZXJmYWNlfGxldHxuZXd8cGFja2FnZXxwcml2YXRlfHByb3RlY3RlZHxwdWJsaWN8cmV0dXJufHN0YXRpY3xzdXBlcnxzd2l0Y2h8dGhyb3d8dHJ5fHR5cGVvZnx3aGlsZXx3aXRofHlpZWxkKVxcYi8sXG4gICdkZWNsYXJlJzogL1xcYihmdW5jdGlvbnxpbnRlcmZhY2V8Y2xhc3N8dmFyfGxldHxjb25zdHxlbnVtfHZvaWQpXFxiLyxcbiAgJ2J1aWx0aW4nOiAvXFxiKE9iamVjdHxGdW5jdGlvbnxCb29sZWFufEVycm9yfEV2YWxFcnJvcnxJbnRlcm5hbEVycm9yfFJhbmdlRXJyb3J8UmVmZXJlbmNlRXJyb3J8U3RvcEl0ZXJhdGlvbnxTeW50YXhFcnJvcnxUeXBlRXJyb3J8VVJJRXJyb3J8TnVtYmVyfE1hdGh8RGF0ZXxTdHJpbmd8UmVnRXhwfEFycmF5fEZsb2F0MzJBcnJheXxGbG9hdDY0QXJyYXl8SW50MTZBcnJheXxJbnQzMkFycmF5fEludDhBcnJheXxVaW50MTZBcnJheXxVaW50MzJBcnJheXxVaW50OEFycmF5fFVpbnQ4Q2xhbXBlZEFycmF5fEFycmF5QnVmZmVyfERhdGFWaWV3fEpTT058SW50bHxhcmd1bWVudHN8Y29uc29sZXx3aW5kb3d8ZG9jdW1lbnR8U3ltYm9sfFNldHxNYXB8V2Vha1NldHxXZWFrTWFwfFByb3h5fFJlZmxlY3R8UHJvbWlzZSlcXGIvLFxuICAnc3BlY2lhbCc6IC9cXGIodHJ1ZXxmYWxzZXxudWxsfHVuZGVmaW5lZClcXGIvLFxuICAncGFyYW1zJzogL2Z1bmN0aW9uWyBcXChdezF9W15dKj9cXHsvLFxuICAnbnVtYmVyJzogLy0/XFxiKDB4W1xcZEEtRmEtZl0rfFxcZCpcXC4/XFxkKyhbRWVdWystXT9cXGQrKT98TmFOfC0/SW5maW5pdHkpXFxiLyxcbiAgJ3N5bWJvbCc6IC9be31bXFxdKCksOl0vLFxuICAncmVnZXhwJzogLyg/IVteXFwvXSkoXFwvKD8hW1xcL3xcXCpdKS4qP1teXFxcXFxcXl1cXC8pKFs7XFxuXFwuXFwpXFxdXFx9IGdpbV0pLyxcblxuICAneG1sJzogLzxbXj5dKj4vLFxuICAndXJsJzogLygoXFx3KzpcXC9cXC8pWy1hLXpBLVowLTk6QDs/Jj1cXC8lXFwrXFwuXFwqISdcXChcXCksXFwkX1xce1xcfVxcXn5cXFtcXF1gI3xdKykvLFxuICAnaW5kZW50JzogL14gK3xeXFx0Ky8sXG4gICdsaW5lJzogL14uKyR8Xlxcbi8sXG4gICduZXdsaW5lJzogL1xcclxcbnxcXHJ8XFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJcbnZhciB0cmltID0gZXhwb3J0cztcblxudHJpbS5lbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgdHJhaWxpbmcgPSB0cmltLnRyYWlsaW5nRW1wdHlMaW5lcyhzKTtcbiAgdmFyIGxlYWRpbmcgPSB0cmltLmxlYWRpbmdFbXB0eUxpbmVzKHRyYWlsaW5nLnN0cmluZyk7XG4gIHJldHVybiB7XG4gICAgdHJhaWxpbmc6IHRyYWlsaW5nLnJlbW92ZWQsXG4gICAgbGVhZGluZzogbGVhZGluZy5yZW1vdmVkLFxuICAgIHJlbW92ZWQ6IHRyYWlsaW5nLnJlbW92ZWQgKyBsZWFkaW5nLnJlbW92ZWQsXG4gICAgc3RyaW5nOiBsZWFkaW5nLnN0cmluZ1xuICB9O1xufTtcblxudHJpbS50cmFpbGluZ0VtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciBpbmRleCA9IHMubGVuZ3RoO1xuICB2YXIgbGFzdEluZGV4ID0gaW5kZXg7XG4gIHZhciBuID0gMDtcbiAgd2hpbGUgKFxuICAgIH4oaW5kZXggPSBzLmxhc3RJbmRleE9mKCdcXG4nLCBsYXN0SW5kZXggLSAxKSlcbiAgICAmJiBpbmRleCAtIGxhc3RJbmRleCA9PT0gLTEpIHtcbiAgICBuKys7XG4gICAgbGFzdEluZGV4ID0gaW5kZXg7XG4gIH1cblxuICBpZiAobikgcyA9IHMuc2xpY2UoMCwgbGFzdEluZGV4KTtcblxuICByZXR1cm4ge1xuICAgIHJlbW92ZWQ6IG4sXG4gICAgc3RyaW5nOiBzXG4gIH07XG59O1xuXG50cmltLmxlYWRpbmdFbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgaW5kZXggPSAtMTtcbiAgdmFyIGxhc3RJbmRleCA9IGluZGV4O1xuICB2YXIgbiA9IDA7XG5cbiAgd2hpbGUgKFxuICAgIH4oaW5kZXggPSBzLmluZGV4T2YoJ1xcbicsIGxhc3RJbmRleCArIDEpKVxuICAgICYmIGluZGV4IC0gbGFzdEluZGV4ID09PSAxKSB7XG4gICAgbisrO1xuICAgIGxhc3RJbmRleCA9IGluZGV4O1xuICB9XG5cbiAgaWYgKG4pIHMgPSBzLnNsaWNlKGxhc3RJbmRleCArIDEpO1xuXG4gIHJldHVybiB7XG4gICAgcmVtb3ZlZDogbixcbiAgICBzdHJpbmc6IHNcbiAgfTtcbn07XG4iLCJ2YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcblxudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLnNldFRleHQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS51cGRhdGVSYXcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yYXcgPSB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2V0VGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB0aGlzLnJhdyA9IHRleHQgLy90aGlzLnN5bnRheC5oaWdobGlnaHQodGV4dCk7XG5cbiAgdGhpcy5zeW50YXgudGFiID0gfnRoaXMucmF3LmluZGV4T2YoJ1xcdCcpID8gJ1xcdCcgOiAnICc7XG5cbiAgdGhpcy50ZXh0ID0gbmV3IFNraXBTdHJpbmc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuXG4gIHRoaXMudG9rZW5zID0gbmV3IFRva2VucztcbiAgdGhpcy50b2tlbnMuaW5kZXgodGhpcy5yYXcpO1xuICB0aGlzLnRva2Vucy5vbignY2hhbmdlIHNlZ21lbnRzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZSBzZWdtZW50cycpKTtcblxuICB0aGlzLnByZWZpeCA9IG5ldyBQcmVmaXhUcmVlO1xuICB0aGlzLnByZWZpeC5pbmRleCh0aGlzLnJhdyk7XG5cbiAgLy8gdGhpcy5lbWl0KCdyYXcnLCB0aGlzLnJhdyk7XG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9XG5CdWZmZXIucHJvdG90eXBlLmluc2VydFRleHRBdFBvaW50ID0gZnVuY3Rpb24ocCwgdGV4dCwgY3RybFNoaWZ0KSB7XG4gIGlmICghY3RybFNoaWZ0KSB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICB0ZXh0ID0gbm9ybWFsaXplRU9MKHRleHQpO1xuXG4gIHZhciBpc0VPTCA9ICdcXG4nID09PSB0ZXh0WzBdO1xuICB2YXIgc2hpZnQgPSBjdHJsU2hpZnQgfHwgaXNFT0w7XG4gIHZhciBsZW5ndGggPSB0ZXh0Lmxlbmd0aDtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIGxpbmVzID0gKHRleHQubWF0Y2goTkVXTElORSkgfHwgW10pLmxlbmd0aDtcbiAgdmFyIHJhbmdlID0gW3BvaW50LnksIHBvaW50LnkgKyBsaW5lc107XG4gIHZhciBvZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG5cbiAgdmFyIGJlZm9yZSA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy50ZXh0Lmluc2VydChwb2ludC5vZmZzZXQsIHRleHQpO1xuICBvZmZzZXRSYW5nZVsxXSArPSB0ZXh0Lmxlbmd0aDtcbiAgdmFyIGFmdGVyID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgLy8gdGhpcy50b2tlbnMgPSBuZXcgVG9rZW5zO1xuICAvLyB0aGlzLnRva2Vucy5pbmRleCh0aGlzLnRleHQudG9TdHJpbmcoKSk7XG4gIC8vIHRoaXMuc2VnbWVudHMgPSBuZXcgU2VnbWVudHModGhpcyk7XG5cbiAgaWYgKCFjdHJsU2hpZnQpIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcbiAgZWxzZSB0aGlzLmVtaXQoJ3JhdycpO1xuXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlID1cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihvLCBub1VwZGF0ZSkge1xuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICAvLyBjb25zb2xlLmxvZygnb2Zmc2V0cycsIG8pXG4gIHZhciBhID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMV0pO1xuICB2YXIgbGVuZ3RoID0gb1swXSAtIG9bMV07XG4gIHZhciByYW5nZSA9IFthLnksIGIueV07XG4gIHZhciBzaGlmdCA9IGEueSAtIGIueTtcbiAgLy8gY29uc29sZS5sb2coYSxiKVxuXG4gIHZhciBvZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudGV4dC5yZW1vdmUobyk7XG4gIC8vIG9mZnNldFJhbmdlWzFdIC09IHNoaWZ0O1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vVXBkYXRlKSB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUFyZWEgPSBmdW5jdGlvbihhcmVhLCBub1VwZGF0ZSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRzLCBub1VwZGF0ZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUNoYXJBdFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQrMV07XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldFJhbmdlKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLmdldExpbmVSYW5nZVRleHQocmFuZ2UpO1xuICB2YXIgc2VnbWVudCA9IHRoaXMuc2VnbWVudHMuZ2V0KHJhbmdlWzBdKTtcbiAgaWYgKHNlZ21lbnQpIHtcbiAgICBjb2RlID0gU0VHTUVOVFtzZWdtZW50XSArICdcXHVmZmJhJyArIGNvZGUgKyAnXFx1ZmZiZSovYCdcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUpO1xuICAgIGNvZGUgPSAnPCcgKyBzZWdtZW50WzBdICsgJz4nICtcbiAgICAgIGNvZGUuc3Vic3RyaW5nKFxuICAgICAgICBjb2RlLmluZGV4T2YoJ1xcdWZmYmEnKSArIDEsXG4gICAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUgKyAnXFx1ZmZiZSovYCcpO1xuICAgIGNvZGUgPSBjb2RlLnN1YnN0cmluZygwLCBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJykpO1xuICB9XG4gIHJldHVybiBjb2RlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lID0gZnVuY3Rpb24oeSkge1xuICB2YXIgbGluZSA9IG5ldyBMaW5lO1xuICBsaW5lLm9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKFt5LHldKTtcbiAgbGluZS5vZmZzZXQgPSBsaW5lLm9mZnNldFJhbmdlWzBdO1xuICBsaW5lLmxlbmd0aCA9IGxpbmUub2Zmc2V0UmFuZ2VbMV0gLSBsaW5lLm9mZnNldFJhbmdlWzBdIC0gKHkgPCB0aGlzLmxvYygpKTtcbiAgbGluZS5wb2ludC5zZXQoeyB4OjAsIHk6eSB9KTtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShwLnkpO1xuICB2YXIgcG9pbnQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGxpbmUubGVuZ3RoLCBwLngpLFxuICAgIHk6IGxpbmUucG9pbnQueVxuICB9KTtcbiAgcG9pbnQub2Zmc2V0ID0gbGluZS5vZmZzZXQgKyBwb2ludC54O1xuICBwb2ludC5wb2ludCA9IHBvaW50O1xuICBwb2ludC5saW5lID0gbGluZTtcbiAgcmV0dXJuIHBvaW50O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VUZXh0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVSYW5nZU9mZnNldHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVswXSk7XG4gIHZhciBiID0gcmFuZ2VbMV0gPj0gdGhpcy5sb2MoKVxuICAgID8gdGhpcy50ZXh0Lmxlbmd0aFxuICAgIDogdGhpcy5nZXRMaW5lT2Zmc2V0KHJhbmdlWzFdICsgMSk7XG4gIHZhciBvZmZzZXRzID0gW2EsIGJdO1xuICByZXR1cm4gb2Zmc2V0cztcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UmFuZ2VUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0UmFuZ2UpIHtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0UmFuZ2UpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHRva2VuID0gdGhpcy50b2tlbnMuZ2V0QnlPZmZzZXQoJ2xpbmVzJywgb2Zmc2V0IC0gLjUpO1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBvZmZzZXQgLSAob2Zmc2V0ID4gdG9rZW4ub2Zmc2V0ID8gdG9rZW4ub2Zmc2V0ICsgMSA6IDApLFxuICAgIHk6IE1hdGgubWluKHRoaXMubG9jKCksIHRva2VuLmluZGV4IC0gKHRva2VuLm9mZnNldCArIDEgPiBvZmZzZXQpICsgMSlcbiAgfSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgY2hhciA9IHRoaXMudGV4dC5nZXRSYW5nZShbb2Zmc2V0LCBvZmZzZXQgKyAxXSk7XG4gIHJldHVybiBjaGFyO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4ge1xuICAgIGxpbmU6IGxpbmUsXG4gICAgdGV4dDogdGV4dCxcbiAgfVxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lVGV4dCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHRleHQgPSB0aGlzLmdldExpbmVSYW5nZVRleHQoW3kseV0pO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYVRleHQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUud29yZEFyZWFBdFBvaW50ID0gZnVuY3Rpb24ocCwgaW5jbHVzaXZlKSB7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKHBvaW50LmxpbmUub2Zmc2V0UmFuZ2UpO1xuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHBvaW50LnkgfSxcbiAgICAgIGVuZDogeyB4OiBwb2ludC5saW5lLmxlbmd0aCwgeTogcG9pbnQueSB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFyZWE7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gISFpbmNsdXNpdmUpIHtcbiAgICAgIGVuZCA9IHdvcmQuaW5kZXg7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgbGFzdEluZGV4ID0gd29yZC5pbmRleDtcbiAgfVxuXG4gIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcblxuICByZXR1cm4gYXJlYTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubW92ZUFyZWFCeUxpbmVzID0gZnVuY3Rpb24oeSwgYXJlYSkge1xuICBpZiAoYXJlYS5lbmQueCA+IDAgfHwgYXJlYS5iZWdpbi55ID09PSBhcmVhLmVuZC55KSBhcmVhLmVuZC55ICs9IDE7XG4gIGlmIChhcmVhLmJlZ2luLnkgKyB5IDwgMCB8fCBhcmVhLmVuZC55ICsgeSA+IHRoaXMubG9jKSByZXR1cm4gZmFsc2U7XG5cbiAgYXJlYS5iZWdpbi54ID0gMDtcbiAgYXJlYS5lbmQueCA9IDA7XG5cbiAgdmFyIHRleHQgPSB0aGlzLmdldExpbmVSYW5nZVRleHQoW2FyZWEuYmVnaW4ueSwgYXJlYS5lbmQueS0xXSk7XG4gIHRoaXMucmVtb3ZlQXJlYShhcmVhLCB0cnVlKTtcblxuICB0aGlzLmluc2VydCh7IHg6MCwgeTphcmVhLmJlZ2luLnkgKyB5IH0sIHRleHQsIHkpO1xuXG4gIHJldHVybiB0cnVlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHZhciByYW5nZSA9IFtcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pLm9mZnNldCxcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuZW5kKS5vZmZzZXRcbiAgXTtcbiAgcmV0dXJuIHJhbmdlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRMaW5lID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lT2Zmc2V0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgb2Zmc2V0ID0geSA8IDAgPyAtMSA6IHkgPT09IDAgPyAwIDogdGhpcy50b2tlbnMuZ2V0QnlJbmRleCgnbGluZXMnLCB5IC0gMSkgKyAxO1xuICByZXR1cm4gb2Zmc2V0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5sb2MgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zLmdldENvbGxlY3Rpb24oJ2xpbmVzJykubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50ZXh0LnRvU3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiBMaW5lKCkge1xuICB0aGlzLm9mZnNldFJhbmdlID0gW107XG4gIHRoaXMub2Zmc2V0ID0gMDtcbiAgdGhpcy5sZW5ndGggPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVFT0wocykge1xuICByZXR1cm4gcy5yZXBsYWNlKEVPTCwgJ1xcbicpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEluZGV4ZXI7XG5cbmZ1bmN0aW9uIEluZGV4ZXIoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xufVxuXG5JbmRleGVyLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ocykge1xuICBpZiAoIXMpIHJldHVybiBbXTtcbiAgdmFyIG9mZnNldHMgPSBbXTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5yYXc7XG4gIHZhciBsZW4gPSBzLmxlbmd0aDtcbiAgdmFyIGluZGV4O1xuICB3aGlsZSAofihpbmRleCA9IHRleHQuaW5kZXhPZihzLCBpbmRleCArIGxlbikpKSB7XG4gICAgb2Zmc2V0cy5wdXNoKGluZGV4KTtcbiAgfVxuICByZXR1cm4gb2Zmc2V0cztcbn07XG4iLCJ2YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQYXJ0cztcblxuZnVuY3Rpb24gUGFydHMobWluU2l6ZSkge1xuICBtaW5TaXplID0gbWluU2l6ZSB8fCA1MDAwO1xuICB0aGlzLm1pblNpemUgPSBtaW5TaXplO1xuICB0aGlzLnBhcnRzID0gW107XG4gIHRoaXMubGVuZ3RoID0gMDtcbn1cblxuUGFydHMucHJvdG90eXBlLnB1c2ggPSBmdW5jdGlvbihpdGVtKSB7XG4gIHRoaXMuYXBwZW5kKFtpdGVtXSk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHBhcnQgPSBsYXN0KHRoaXMucGFydHMpO1xuXG4gIGlmICghcGFydCkge1xuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSAwO1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSAwO1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuICBlbHNlIGlmIChwYXJ0Lmxlbmd0aCA+PSB0aGlzLm1pblNpemUpIHtcbiAgICB2YXIgc3RhcnRJbmRleCA9IHBhcnQuc3RhcnRJbmRleCArIHBhcnQubGVuZ3RoO1xuICAgIHZhciBzdGFydE9mZnNldCA9IGl0ZW1zWzBdO1xuXG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IHN0YXJ0SW5kZXg7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IHN0YXJ0T2Zmc2V0O1xuICAgIHRoaXMucGFydHMucHVzaChwYXJ0KTtcbiAgfVxuXG4gIHBhcnQucHVzaC5hcHBseShwYXJ0LCBpdGVtcy5tYXAob2Zmc2V0ID0+IG9mZnNldCAtIHBhcnQuc3RhcnRPZmZzZXQpKTtcblxuICB0aGlzLmxlbmd0aCArPSBpdGVtcy5sZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgdmFyIHBhcnQgPSB0aGlzLmZpbmRQYXJ0QnlJbmRleChpbmRleCkuaXRlbTtcbiAgcmV0dXJuIHBhcnRbaW5kZXggLSBwYXJ0LnN0YXJ0SW5kZXhdICsgcGFydC5zdGFydE9mZnNldDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBwID0gdGhpcy5maW5kUGFydEJ5T2Zmc2V0KG9mZnNldCk7XG4gIGlmICghcC5pdGVtKSByZXR1cm4gbnVsbDtcblxuICB2YXIgcGFydCA9IHAuaXRlbTtcbiAgdmFyIHBhcnRJbmRleCA9IHAuaW5kZXg7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydCk7XG4gIHJldHVybiB7XG4gICAgb2Zmc2V0OiBvLml0ZW0gKyBwYXJ0LnN0YXJ0T2Zmc2V0LFxuICAgIGluZGV4OiBvLmluZGV4ICsgcGFydC5zdGFydEluZGV4LFxuICAgIGxvY2FsOiBvLmluZGV4LFxuICAgIHBhcnQ6IHBhcnQsXG4gICAgcGFydEluZGV4OiBwYXJ0SW5kZXhcbiAgfTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIGFycmF5KSB7XG4gIHZhciBvID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmICghbykge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZChhcnJheSk7XG4gIH1cbiAgaWYgKG8ub2Zmc2V0ID4gb2Zmc2V0KSBvLmxvY2FsID0gLTE7XG4gIHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG4gIC8vVE9ETzogbWF5YmUgc3VidHJhY3QgJ29mZnNldCcgaW5zdGVhZCA/XG4gIGFycmF5ID0gYXJyYXkubWFwKGVsID0+IGVsIC09IG8ucGFydC5zdGFydE9mZnNldCk7XG4gIGluc2VydChvLnBhcnQsIG8ubG9jYWwgKyAxLCBhcnJheSk7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIC1sZW5ndGgpO1xuICB0aGlzLmxlbmd0aCArPSBsZW5ndGg7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHNoaWZ0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHM7XG4gIHZhciBpdGVtID0gdGhpcy5maW5kKG9mZnNldCk7XG4gIGlmIChvZmZzZXQgPiBpdGVtLm9mZnNldCkgaXRlbS5sb2NhbCArPSAxO1xuXG4gIHZhciByZW1vdmVkID0gMDtcbiAgZm9yICh2YXIgaSA9IGl0ZW0ubG9jYWw7IGkgPCBpdGVtLnBhcnQubGVuZ3RoOyBpKyspIHtcbiAgICBpdGVtLnBhcnRbaV0gKz0gc2hpZnQ7XG4gICAgaWYgKGl0ZW0ucGFydFtpXSArIGl0ZW0ucGFydC5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgcmVtb3ZlZCsrO1xuICAgICAgaXRlbS5wYXJ0LnNwbGljZShpLS0sIDEpO1xuICAgIH1cbiAgfVxuICBpZiAocmVtb3ZlZCkge1xuICAgIHRoaXMuc2hpZnRJbmRleChpdGVtLnBhcnRJbmRleCArIDEsIHJlbW92ZWQpO1xuICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gIH1cbiAgZm9yICh2YXIgaSA9IGl0ZW0ucGFydEluZGV4ICsgMTsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgcGFydHNbaV0uc3RhcnRPZmZzZXQgKz0gc2hpZnQ7XG4gICAgaWYgKHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICBpZiAobGFzdChwYXJ0c1tpXSkgKyBwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgICByZW1vdmVkID0gcGFydHNbaV0ubGVuZ3RoO1xuICAgICAgICB0aGlzLnNoaWZ0SW5kZXgoaSArIDEsIHJlbW92ZWQpO1xuICAgICAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICAgICAgICBwYXJ0cy5zcGxpY2UoaS0tLCAxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVtb3ZlQmVsb3dPZmZzZXQob2Zmc2V0LCBwYXJ0c1tpXSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUucmVtb3ZlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZmluZChyYW5nZVswXSk7XG4gIHZhciBiID0gdGhpcy5maW5kKHJhbmdlWzFdKTtcblxuICBpZiAoYS5wYXJ0SW5kZXggPT09IGIucGFydEluZGV4KSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdCA9IHJlbW92ZShhLnBhcnQsIGEubG9jYWwsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgdGhpcy5zaGlmdEluZGV4KGEucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0O1xuICB9IGVsc2Uge1xuICAgIGlmIChhLm9mZnNldCA+PSByYW5nZVsxXSB8fCBhLm9mZnNldCA8IHJhbmdlWzBdKSBhLmxvY2FsICs9IDE7XG4gICAgaWYgKGIub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGIub2Zmc2V0IDwgcmFuZ2VbMF0pIGIubG9jYWwgLT0gMTtcbiAgICB2YXIgc2hpZnRBID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCkubGVuZ3RoO1xuICAgIHZhciBzaGlmdEIgPSByZW1vdmUoYi5wYXJ0LCAwLCBiLmxvY2FsICsgMSkubGVuZ3RoO1xuICAgIGlmIChiLnBhcnRJbmRleCAtIGEucGFydEluZGV4ID4gMSkge1xuICAgICAgdmFyIHJlbW92ZWQgPSByZW1vdmUodGhpcy5wYXJ0cywgYS5wYXJ0SW5kZXggKyAxLCBiLnBhcnRJbmRleCk7XG4gICAgICB2YXIgc2hpZnRCZXR3ZWVuID0gcmVtb3ZlZC5yZWR1Y2UoKHAsbikgPT4gcCArIG4ubGVuZ3RoLCAwKTtcbiAgICAgIGIucGFydC5zdGFydEluZGV4IC09IHNoaWZ0QSArIHNoaWZ0QmV0d2VlbjtcbiAgICAgIHRoaXMuc2hpZnRJbmRleChiLnBhcnRJbmRleCAtIHJlbW92ZWQubGVuZ3RoICsgMSwgc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuKTtcbiAgICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0QSArIHNoaWZ0QiArIHNoaWZ0QmV0d2VlbjtcbiAgICB9IGVsc2Uge1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4ICsgMSwgc2hpZnRBICsgc2hpZnRCKTtcbiAgICAgIHRoaXMubGVuZ3RoIC09IHNoaWZ0QSArIHNoaWZ0QjtcbiAgICB9XG4gIH1cblxuICAvL1RPRE86IHRoaXMgaXMgaW5lZmZpY2llbnQgYXMgd2UgY2FuIGNhbGN1bGF0ZSB0aGUgaW5kZXhlcyBvdXJzZWx2ZXNcbiAgaWYgKCFhLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGEucGFydCksIDEpO1xuICB9XG4gIGlmICghYi5wYXJ0Lmxlbmd0aCkge1xuICAgIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihiLnBhcnQpLCAxKTtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnNoaWZ0SW5kZXggPSBmdW5jdGlvbihzdGFydEluZGV4LCBzaGlmdCkge1xuICBmb3IgKHZhciBpID0gc3RhcnRJbmRleDsgaSA8IHRoaXMucGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnBhcnRzW2ldLnN0YXJ0SW5kZXggLT0gc2hpZnQ7XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVCZWxvd09mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgcGFydCkge1xuICB2YXIgbyA9IHRoaXMuZmluZE9mZnNldEluUGFydChvZmZzZXQsIHBhcnQpXG4gIHZhciBzaGlmdCA9IHJlbW92ZShwYXJ0LCAwLCBvLmluZGV4KS5sZW5ndGg7XG4gIHRoaXMuc2hpZnRJbmRleChvLnBhcnRJbmRleCArIDEsIHNoaWZ0KTtcbiAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZE9mZnNldEluUGFydCA9IGZ1bmN0aW9uKG9mZnNldCwgcGFydCkge1xuICBvZmZzZXQgLT0gcGFydC5zdGFydE9mZnNldDtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaChwYXJ0LCBvID0+IG8gPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kUGFydEJ5SW5kZXggPSBmdW5jdGlvbihpbmRleCkge1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHRoaXMucGFydHMsIHMgPT4gcy5zdGFydEluZGV4IDw9IGluZGV4KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kUGFydEJ5T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0T2Zmc2V0IDw9IG9mZnNldCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUudG9BcnJheSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5wYXJ0cy5yZWR1Y2UoKHAsbikgPT4gcC5jb25jYXQobiksIFtdKTtcbn07XG5cbmZ1bmN0aW9uIGxhc3QoYXJyYXkpIHtcbiAgcmV0dXJuIGFycmF5W2FycmF5Lmxlbmd0aCAtIDFdO1xufVxuXG5mdW5jdGlvbiByZW1vdmUoYXJyYXksIGEsIGIpIHtcbiAgaWYgKGIgPT0gbnVsbCkge1xuICAgIHJldHVybiBhcnJheS5zcGxpY2UoYSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhLCBiIC0gYSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaW5zZXJ0KHRhcmdldCwgaW5kZXgsIGFycmF5KSB7XG4gIHZhciBvcCA9IGFycmF5LnNsaWNlKCk7XG4gIG9wLnVuc2hpZnQoaW5kZXgsIDApO1xuICB0YXJnZXQuc3BsaWNlLmFwcGx5KHRhcmdldCwgb3ApO1xufVxuIiwiLy8gdmFyIFdPUkQgPSAvXFx3Ky9nO1xudmFyIFdPUkQgPSAvW2EtekEtWjAtOV17MSx9L2dcbnZhciByYW5rID0gMDtcblxubW9kdWxlLmV4cG9ydHMgPSBQcmVmaXhUcmVlTm9kZTtcblxuZnVuY3Rpb24gUHJlZml4VHJlZU5vZGUoKSB7XG4gIHRoaXMudmFsdWUgPSAnJztcbiAgdGhpcy5yYW5rID0gMDtcbiAgdGhpcy5jaGlsZHJlbiA9IHt9O1xufVxuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZ2V0Q2hpbGRyZW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNoaWxkcmVuID0gT2JqZWN0XG4gICAgLmtleXModGhpcy5jaGlsZHJlbilcbiAgICAubWFwKChrZXkpID0+IHRoaXMuY2hpbGRyZW5ba2V5XSk7XG5cbiAgcmV0dXJuIGNoaWxkcmVuLnJlZHVjZSgocCwgbikgPT4gcC5jb25jYXQobi5nZXRDaGlsZHJlbigpKSwgY2hpbGRyZW4pO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmNvbGxlY3QgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIGNvbGxlY3Rpb24gPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmZpbmQoa2V5KTtcbiAgaWYgKG5vZGUpIHtcbiAgICBjb2xsZWN0aW9uID0gbm9kZVxuICAgICAgLmdldENoaWxkcmVuKClcbiAgICAgIC5maWx0ZXIoKG5vZGUpID0+IG5vZGUudmFsdWUpXG4gICAgICAuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICB2YXIgcmVzID0gYi5yYW5rIC0gYS5yYW5rO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBiLnZhbHVlLmxlbmd0aCAtIGEudmFsdWUubGVuZ3RoO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBhLnZhbHVlID4gYi52YWx1ZTtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pO1xuXG4gICAgaWYgKG5vZGUudmFsdWUpIGNvbGxlY3Rpb24ucHVzaChub2RlKTtcbiAgfVxuICByZXR1cm4gY29sbGVjdGlvbjtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgZm9yICh2YXIgY2hhciBpbiBrZXkpIHtcbiAgICBpZiAoa2V5W2NoYXJdIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW2tleVtjaGFyXV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5vZGU7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICB2YXIgaSA9IDA7XG4gIHZhciBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgaWYgKHNbaV0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bc1tpXV07XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIG5vZGUgPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gfHwgbmV3IFByZWZpeFRyZWVOb2RlO1xuICAgIGkrKztcbiAgfVxuXG4gIG5vZGUudmFsdWUgPSBzO1xuICBub2RlLnJhbmsrKztcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmQ7XG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgdGhpcy5pbnNlcnQod29yZFswXSk7XG4gIH1cbn07XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgVHlwZSA9IFRva2Vucy5UeXBlO1xuXG52YXIgQmVnaW4gPSAvW1xcLydcImBdL2c7XG5cbnZhciBNYXRjaCA9IHtcbiAgJ3NpbmdsZSBjb21tZW50JzogWycvLycsJ1xcbiddLFxuICAnZG91YmxlIGNvbW1lbnQnOiBbJy8qJywnKi8nXSxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IFsnYCcsJ2AnXSxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBbXCInXCIsXCInXCJdLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFsnXCInLCdcIiddLFxuICAncmVnZXhwJzogWycvJywnLyddLFxufTtcblxudmFyIFNraXAgPSB7XG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdzaW5nbGUgY29tbWVudCc6IGZhbHNlLFxuICAnZG91YmxlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ3JlZ2V4cCc6IFwiXFxcXFwiLFxufTtcblxudmFyIFRva2VuID0ge307XG5mb3IgKHZhciBrZXkgaW4gTWF0Y2gpIHtcbiAgdmFyIE0gPSBNYXRjaFtrZXldO1xuICBUb2tlbltNWzBdXSA9IGtleTtcbn1cblxudmFyIExlbmd0aCA9IHtcbiAgJ29wZW4gY29tbWVudCc6IDIsXG4gICdjbG9zZSBjb21tZW50JzogMixcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IDEsXG59O1xuXG52YXIgTm90T3BlbiA9IHtcbiAgJ2Nsb3NlIGNvbW1lbnQnOiB0cnVlXG59O1xuXG52YXIgQ2xvc2VzID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVGFnID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2NvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3N0cmluZycsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRzO1xuXG5mdW5jdGlvbiBTZWdtZW50cyhidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG4gIHRoaXMuY2FjaGUgPSB7fTtcbiAgdGhpcy5yZXNldCgpO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0KSB7XG4gICAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLm9mZnNldCA8IG9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZS5zcGxpY2Uocy5pbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZSA9IFtdO1xuICB9XG4gIHRoaXMuY2FjaGUub2Zmc2V0ID0ge307XG4gIHRoaXMuY2FjaGUucmFuZ2UgPSB7fTtcbiAgdGhpcy5jYWNoZS5wb2ludCA9IHt9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXJDYWNoZSgpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHkpIHtcbiAgaWYgKHkgaW4gdGhpcy5jYWNoZS5wb2ludCkge1xuICAgIHJldHVybiB0aGlzLmNhY2hlLnBvaW50W3ldO1xuICB9XG5cbiAgdmFyIHNlZ21lbnRzID0gdGhpcy5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ3NlZ21lbnRzJyk7XG4gIHZhciBvcGVuID0gZmFsc2U7XG4gIHZhciBzdGF0ZSA9IG51bGw7XG4gIHZhciB3YWl0Rm9yID0gJyc7XG4gIHZhciBwb2ludCA9IHsgeDotMSwgeTotMSB9O1xuICB2YXIgY2xvc2UgPSAwO1xuICB2YXIgb2Zmc2V0O1xuICB2YXIgc2VnbWVudDtcbiAgdmFyIHJhbmdlO1xuICB2YXIgdGV4dDtcbiAgdmFyIHZhbGlkO1xuICB2YXIgbGFzdDtcblxuICB2YXIgbGFzdENhY2hlU3RhdGVPZmZzZXQgPSAwO1xuXG4gIHZhciBpID0gMDtcblxuICB2YXIgY2FjaGVTdGF0ZSA9IHRoaXMuZ2V0Q2FjaGVTdGF0ZSh5KTtcbiAgaWYgKGNhY2hlU3RhdGUgJiYgY2FjaGVTdGF0ZS5pdGVtKSB7XG4gICAgb3BlbiA9IHRydWU7XG4gICAgc3RhdGUgPSBjYWNoZVN0YXRlLml0ZW07XG4gICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICBpID0gc3RhdGUuaW5kZXggKyAxO1xuICB9XG5cbiAgZm9yICg7IGkgPCBzZWdtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIG9mZnNldCA9IHNlZ21lbnRzLmdldChpKTtcbiAgICBzZWdtZW50ID0ge1xuICAgICAgb2Zmc2V0OiBvZmZzZXQsXG4gICAgICB0eXBlOiBUeXBlW3RoaXMuYnVmZmVyLmNoYXJBdChvZmZzZXQpXVxuICAgIH07XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIGNsb3NlIHRva2VuXG4gICAgaWYgKG9wZW4pIHtcbiAgICAgIGlmICh3YWl0Rm9yID09PSBzZWdtZW50LnR5cGUpIHtcbiAgICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNlYXJjaGluZyBmb3Igb3BlbiB0b2tlblxuICAgIGVsc2Uge1xuICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgIH1cblxuICAgICAgcmFuZ2UgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKHBvaW50LnkpLm9mZnNldFJhbmdlO1xuXG4gICAgICBpZiAobGFzdCAmJiBsYXN0LnBvaW50LnkgPT09IHBvaW50LnkpIHtcbiAgICAgICAgY2xvc2UgPSBsYXN0LnBvaW50LnggKyBMZW5ndGhbbGFzdC50eXBlXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNsb3NlID0gMDtcbiAgICAgIH1cblxuICAgICAgdmFsaWQgPSB0aGlzLmlzVmFsaWRSYW5nZShbcmFuZ2VbMF0sIHJhbmdlWzFdKzFdLCBzZWdtZW50LCBjbG9zZSk7XG5cbiAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICBpZiAoTm90T3BlbltzZWdtZW50LnR5cGVdKSBjb250aW51ZTtcbiAgICAgICAgb3BlbiA9IHRydWU7XG4gICAgICAgIHN0YXRlID0gc2VnbWVudDtcbiAgICAgICAgc3RhdGUuaW5kZXggPSBpO1xuICAgICAgICBzdGF0ZS5wb2ludCA9IHBvaW50O1xuICAgICAgICAvLyBzdGF0ZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5vZmZzZXQgfTtcbiAgICAgICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICAgICAgaWYgKCF0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCB8fCB0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAmJiBzdGF0ZS5vZmZzZXQgPiB0aGlzLmNhY2hlLnN0YXRlW3RoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIC0gMV0ub2Zmc2V0KSB7XG4gICAgICAgICAgdGhpcy5jYWNoZS5zdGF0ZS5wdXNoKHN0YXRlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhdGUgJiYgc3RhdGUucG9pbnQueSA8IHkpIHtcbiAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICB9XG5cbiAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG59O1xuXG4vL1RPRE86IGNhY2hlIGluIEJ1ZmZlclxuU2VnbWVudHMucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQgaW4gdGhpcy5jYWNoZS5vZmZzZXQpIHJldHVybiB0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdO1xuICByZXR1cm4gKHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF0gPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgc2VnbWVudCwgY2xvc2UpIHtcbiAgdmFyIGtleSA9IHJhbmdlLmpvaW4oKTtcbiAgaWYgKGtleSBpbiB0aGlzLmNhY2hlLnJhbmdlKSByZXR1cm4gdGhpcy5jYWNoZS5yYW5nZVtrZXldO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFJhbmdlVGV4dChyYW5nZSk7XG4gIHZhciB2YWxpZCA9IHRoaXMuaXNWYWxpZCh0ZXh0LCBzZWdtZW50Lm9mZnNldCAtIHJhbmdlWzBdLCBjbG9zZSk7XG4gIHJldHVybiAodGhpcy5jYWNoZS5yYW5nZVtrZXldID0gdmFsaWQpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWQgPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQsIGxhc3RJbmRleCkge1xuICBCZWdpbi5sYXN0SW5kZXggPSBsYXN0SW5kZXg7XG5cbiAgdmFyIG1hdGNoID0gQmVnaW4uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuXG4gIHZhciBpID0gbWF0Y2guaW5kZXg7XG5cbiAgbGFzdCA9IGk7XG5cbiAgdmFyIHZhbGlkID0gdHJ1ZTtcblxuICBvdXRlcjpcbiAgZm9yICg7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIG9uZSA9IHRleHRbaV07XG4gICAgdmFyIG5leHQgPSB0ZXh0W2kgKyAxXTtcbiAgICB2YXIgdHdvID0gb25lICsgbmV4dDtcbiAgICBpZiAoaSA9PT0gb2Zmc2V0KSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciBvID0gVG9rZW5bdHdvXTtcbiAgICBpZiAoIW8pIG8gPSBUb2tlbltvbmVdO1xuICAgIGlmICghbykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgdmFyIHdhaXRGb3IgPSBNYXRjaFtvXVsxXTtcblxuICAgIGxhc3QgPSBpO1xuXG4gICAgc3dpdGNoICh3YWl0Rm9yLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IG9uZSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDE7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcblxuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG4gICAgICAgICAgdHdvID0gdGV4dFtpXSArIHRleHRbaSArIDFdO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IHR3bykge1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDI7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsaWQ7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRDYWNoZVN0YXRlID0gZnVuY3Rpb24oeSkge1xuICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMucG9pbnQueSA8IHkpO1xuICBpZiAocy5pdGVtICYmIHkgLSAxIDwgcy5pdGVtLnBvaW50LnkpIHJldHVybiBudWxsO1xuICBlbHNlIHJldHVybiBzO1xuICAvLyByZXR1cm4gcztcbn07XG4iLCIvKlxuXG5leGFtcGxlIHNlYXJjaCBmb3Igb2Zmc2V0IGA0YCA6XG5gb2AgYXJlIG5vZGUncyBsZXZlbHMsIGB4YCBhcmUgdHJhdmVyc2FsIHN0ZXBzXG5cbnhcbnhcbm8tLT54ICAgbyAgIG9cbm8gbyB4ICAgbyAgIG8gbyBvXG5vIG8gby14IG8gbyBvIG8gb1xuMSAyIDMgNCA1IDYgNyA4IDlcblxuKi9cblxubG9nID0gY29uc29sZS5sb2cuYmluZChjb25zb2xlKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTa2lwU3RyaW5nO1xuXG5mdW5jdGlvbiBOb2RlKHZhbHVlLCBsZXZlbCkge1xuICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gIHRoaXMubGV2ZWwgPSBsZXZlbDtcbiAgdGhpcy53aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKHZhbHVlICYmIHZhbHVlLmxlbmd0aCB8fCAwKTtcbiAgdGhpcy5uZXh0ID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwobnVsbCk7XG59XG5cbk5vZGUucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLndpZHRoWzBdO1xuICB9XG59O1xuXG5mdW5jdGlvbiBTa2lwU3RyaW5nKG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMubGV2ZWxzID0gby5sZXZlbHMgfHwgMTE7XG4gIHRoaXMuYmlhcyA9IG8uYmlhcyB8fCAxIC8gTWF0aC5FO1xuICB0aGlzLmhlYWQgPSBuZXcgTm9kZShudWxsLCB0aGlzLmxldmVscyk7XG4gIHRoaXMuY2h1bmtTaXplID0gby5jaHVua1NpemUgfHwgNTAwMDtcbn1cblxuU2tpcFN0cmluZy5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuaGVhZC53aWR0aFt0aGlzLmxldmVscyAtIDFdO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgLy8gZ3JlYXQgaGFjayB0byBkbyBvZmZzZXQgPj0gZm9yIC5zZWFyY2goKVxuICAvLyB3ZSBkb24ndCBoYXZlIGZyYWN0aW9ucyBhbnl3YXkgc28uLlxuICByZXR1cm4gdGhpcy5zZWFyY2gob2Zmc2V0LCB0cnVlKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5pbnNlcnRDaHVua2VkKDAsIHRleHQpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24ob2Zmc2V0LCBpbmNsKSB7XG4gIGluY2wgPSBpbmNsID8gLjEgOiAwO1xuXG4gIC8vIHByZXBhcmUgdG8gaG9sZCBzdGVwc1xuICB2YXIgc3RlcHMgPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuICB2YXIgd2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuXG4gIC8vIGl0ZXJhdGUgbGV2ZWxzIGRvd24sIHNraXBwaW5nIHRvcFxuICB2YXIgaSA9IHRoaXMubGV2ZWxzO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgd2hpbGUgKG9mZnNldCArIGluY2wgPiBub2RlLndpZHRoW2ldICYmIG51bGwgIT0gbm9kZS5uZXh0W2ldKSB7XG4gICAgICBvZmZzZXQgLT0gbm9kZS53aWR0aFtpXTtcbiAgICAgIG5vZGUgPSBub2RlLm5leHRbaV07XG4gICAgfVxuICAgIHN0ZXBzW2ldID0gbm9kZTtcbiAgICB3aWR0aFtpXSA9IG9mZnNldDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbm9kZTogbm9kZSxcbiAgICBzdGVwczogc3RlcHMsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIG9mZnNldDogb2Zmc2V0XG4gIH07XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zcGxpY2UgPSBmdW5jdGlvbihzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzOyAvLyBza2lwIHN0ZXBzIGxlZnQgb2YgdGhlIG9mZnNldFxuICB2YXIgd2lkdGggPSBzLndpZHRoO1xuXG4gIHZhciBwOyAvLyBsZWZ0IG5vZGUgb3IgYHBgXG4gIHZhciBxOyAvLyByaWdodCBub2RlIG9yIGBxYCAob3VyIG5ldyBub2RlKVxuICB2YXIgbGVuO1xuXG4gIC8vIGNyZWF0ZSBuZXcgbm9kZVxuICBsZXZlbCA9IGxldmVsIHx8IHRoaXMucmFuZG9tTGV2ZWwoKTtcbiAgcSA9IG5ldyBOb2RlKHZhbHVlLCBsZXZlbCk7XG4gIGxlbmd0aCA9IHEud2lkdGhbMF07XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBsZXZlbHMgYmVsb3cgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IGxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWwgc3RlcFxuICAgIHEubmV4dFtpXSA9IHAubmV4dFtpXTsgLy8gaW5zZXJ0IHNvIGluaGVyaXQgbGVmdCdzIG5leHRcbiAgICBwLm5leHRbaV0gPSBxOyAvLyBsZWZ0J3MgbmV4dCBpcyBub3cgb3VyIG5ldyBub2RlXG4gICAgcS53aWR0aFtpXSA9IHAud2lkdGhbaV0gLSB3aWR0aFtpXSArIGxlbmd0aDtcbiAgICBwLndpZHRoW2ldID0gd2lkdGhbaV07XG4gIH1cblxuICAvLyBpdGVyYXRlIHN0ZXBzIGFsbCBsZXZlbHMgZG93biB1bnRpbCBleGNlcHQgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbGV2ZWwpIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbFxuICAgIHAud2lkdGhbaV0gKz0gbGVuZ3RoOyAvLyBhZGQgbmV3IG5vZGUgd2lkdGhcbiAgfVxuXG4gIC8vIHJldHVybiBuZXcgbm9kZVxuICByZXR1cm4gcTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzID0gdGhpcy5zZWFyY2gob2Zmc2V0KTtcblxuICAvLyBpZiBzZWFyY2ggZmFsbHMgaW4gdGhlIG1pZGRsZSBvZiBhIHN0cmluZ1xuICAvLyBpbnNlcnQgaXQgdGhlcmUgaW5zdGVhZCBvZiBjcmVhdGluZyBhIG5ldyBub2RlXG4gIGlmIChzLm9mZnNldCAmJiBzLm5vZGUudmFsdWUgJiYgcy5vZmZzZXQgPCBzLm5vZGUudmFsdWUubGVuZ3RoKSB7XG4gICAgdGhpcy51cGRhdGUocywgaW5zZXJ0KHMub2Zmc2V0LCBzLm5vZGUudmFsdWUsIHZhbHVlKSk7XG4gICAgcmV0dXJuIHMubm9kZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLnNwbGljZShzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICAvLyB2YWx1ZXMgbGVuZ3RoIGRpZmZlcmVuY2VcbiAgdmFyIGxlbmd0aCA9IHMubm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgLy8gdXBkYXRlIHZhbHVlXG4gIHMubm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGZpeCB3aWR0aHMgb24gYWxsIGxldmVsc1xuICBpID0gdGhpcy5sZXZlbHM7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHMuc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmIChyYW5nZVsxXSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ3JhbmdlIGVuZCBvdmVyIG1heGltdW0gbGVuZ3RoKCcgK1xuICAgICAgdGhpcy5sZW5ndGggKyAnKTogWycgKyByYW5nZS5qb2luKCkgKyAnXSdcbiAgICApO1xuICB9XG5cbiAgLy8gcmVtYWluIGRpc3RhbmNlIHRvIHJlbW92ZVxuICB2YXIgeCA9IHJhbmdlWzFdIC0gcmFuZ2VbMF07XG5cbiAgLy8gc2VhcmNoIGZvciBub2RlIG9uIGxlZnQgZWRnZVxuICB2YXIgcyA9IHRoaXMuc2VhcmNoKHJhbmdlWzBdKTtcbiAgdmFyIG9mZnNldCA9IHMub2Zmc2V0O1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzO1xuICB2YXIgbm9kZSA9IHMubm9kZTtcblxuICAvLyBza2lwIGhlYWRcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAvLyBzbGljZSBsZWZ0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmIChvZmZzZXQpIHtcbiAgICBpZiAob2Zmc2V0IDwgbm9kZS53aWR0aFswXSkge1xuICAgICAgeCAtPSB0aGlzLnVwZGF0ZShzLFxuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKDAsIG9mZnNldCkgK1xuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKFxuICAgICAgICAgIG9mZnNldCArXG4gICAgICAgICAgTWF0aC5taW4oeCwgbm9kZS5sZW5ndGggLSBvZmZzZXQpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAgIGlmICghbm9kZSkgcmV0dXJuO1xuICB9XG5cbiAgLy8gcmVtb3ZlIGFsbCBmdWxsIG5vZGVzIGluIHJhbmdlXG4gIHdoaWxlIChub2RlICYmIHggPj0gbm9kZS53aWR0aFswXSkge1xuICAgIHggLT0gdGhpcy5yZW1vdmVOb2RlKHN0ZXBzLCBub2RlKTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG5cbiAgLy8gc2xpY2UgcmlnaHQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKHgpIHtcbiAgICB0aGlzLnJlcGxhY2Uoc3RlcHMsIG5vZGUsIG5vZGUudmFsdWUuc2xpY2UoeCkpO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVOb2RlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUud2lkdGhbMF07XG5cbiAgdmFyIGk7XG5cbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGggLSBub2RlLndpZHRoW2ldO1xuICAgIHN0ZXBzW2ldLm5leHRbaV0gPSBub2RlLm5leHRbaV07XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihzdGVwcywgbm9kZSwgdmFsdWUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIG5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICB2YXIgaTtcbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBub2RlLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlQ2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnJlbW92ZShbb2Zmc2V0LCBvZmZzZXQrMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0Q2h1bmtlZCA9IGZ1bmN0aW9uKG9mZnNldCwgdGV4dCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRleHQubGVuZ3RoOyBpICs9IHRoaXMuY2h1bmtTaXplKSB7XG4gICAgdmFyIGNodW5rID0gdGV4dC5zdWJzdHIoaSwgdGhpcy5jaHVua1NpemUpO1xuICAgIHRoaXMuaW5zZXJ0KGkgKyBvZmZzZXQsIGNodW5rKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3Vic3RyaW5nID0gZnVuY3Rpb24oYSwgYikge1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKDAsIHRoaXMubGVuZ3RoKTtcbn07XG5cbmZ1bmN0aW9uIHRyaW0ocywgbGVmdCwgcmlnaHQpIHtcbiAgcmV0dXJuIHMuc3Vic3RyKDAsIHMubGVuZ3RoIC0gcmlnaHQpLnN1YnN0cihsZWZ0KTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG52YXIgUiA9IFJlZ2V4cC5jcmVhdGU7XG5cbi8vTk9URTogb3JkZXIgbWF0dGVyc1xudmFyIHN5bnRheCA9IG1hcCh7XG4gICd0JzogUihbJ29wZXJhdG9yJ10sICdnJywgZW50aXRpZXMpLFxuICAnbSc6IFIoWydwYXJhbXMnXSwgICAnZycpLFxuICAnZCc6IFIoWydkZWNsYXJlJ10sICAnZycpLFxuICAnZic6IFIoWydmdW5jdGlvbiddLCAnZycpLFxuICAnayc6IFIoWydrZXl3b3JkJ10sICAnZycpLFxuICAnbic6IFIoWydidWlsdGluJ10sICAnZycpLFxuICAnbCc6IFIoWydzeW1ib2wnXSwgICAnZycpLFxuICAncyc6IFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ2UnOiBSKFsnc3BlY2lhbCcsJ251bWJlciddLCAnZycpLFxufSwgY29tcGlsZSk7XG5cbnZhciBJbmRlbnQgPSB7XG4gIHJlZ2V4cDogUihbJ2luZGVudCddLCAnZ20nKSxcbiAgcmVwbGFjZXI6IChzKSA9PiBzLnJlcGxhY2UoLyB7MSwyfXxcXHQvZywgJzx4PiQmPC94PicpXG59O1xuXG52YXIgQW55Q2hhciA9IC9cXFMvZztcblxudmFyIEJsb2NrcyA9IFIoWydjb21tZW50Jywnc3RyaW5nJywncmVnZXhwJywgL14uezEwMDAsfS9dLCAnZ20nKTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2MnLFxuICAnLyonOiAnYycsXG4gICdgJzogJ3MnLFxuICAnXCInOiAncycsXG4gIFwiJ1wiOiAncycsXG4gICcvJzogJ3InLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW50YXg7XG5cbmZ1bmN0aW9uIFN5bnRheChvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLnRhYiA9IG8udGFiIHx8ICdcXHQnO1xuICB0aGlzLmJsb2NrcyA9IFtdO1xufVxuXG5TeW50YXgucHJvdG90eXBlLmVudGl0aWVzID0gZW50aXRpZXM7XG5cblN5bnRheC5wcm90b3R5cGUuaGlnaGxpZ2h0ID0gZnVuY3Rpb24oY29kZSwgb2Zmc2V0KSB7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUluZGVudHMoY29kZSk7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGVudGl0aWVzKGNvZGUpO1xuXG4gIGZvciAodmFyIGtleSBpbiBzeW50YXgpIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHN5bnRheFtrZXldLnJlZ2V4cCwgc3ludGF4W2tleV0ucmVwbGFjZXIpO1xuICB9XG5cbiAgY29kZSA9IHRoaXMucmVzdG9yZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGNvZGUucmVwbGFjZShJbmRlbnQucmVnZXhwLCBJbmRlbnQucmVwbGFjZXIpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVJbmRlbnRzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XG4gIHZhciBpbmRlbnQgPSAwO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBsaW5lO1xuICB2YXIgaTtcblxuICBpID0gbGluZXMubGVuZ3RoO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGxpbmUpO1xuICAgIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gICAgZWxzZSBpZiAoaW5kZW50ICYmICFsaW5lLmxlbmd0aCkge1xuICAgICAgbGluZXNbaV0gPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnRhYik7XG4gICAgfVxuICB9XG5cbiAgY29kZSA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5yZXN0b3JlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgYmxvY2s7XG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcbiAgdmFyIG4gPSAwO1xuICByZXR1cm4gY29kZS5yZXBsYWNlKC9cXHVmZmViL2csIGZ1bmN0aW9uKCkge1xuICAgIGJsb2NrID0gYmxvY2tzW24rK11cbiAgICB2YXIgdGFnID0gaWRlbnRpZnkoYmxvY2spO1xuICAgIGlmICh0YWcpIHJldHVybiAnPCcrdGFnKyc+JytlbnRpdGllcyhibG9jaykrJzwvJyt0YWcrJz4nO1xuICAgIGVsc2UgcmV0dXJuIGVudGl0aWVzKGJsb2NrLnNsaWNlKDAsIDEwMDApICsgJy4uLmxpbmUgdG9vIGxvbmcgdG8gZGlzcGxheScpO1xuICB9KTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB0aGlzLmJsb2NrcyA9IFtdO1xuICBjb2RlID0gY29kZS5yZXBsYWNlKEJsb2NrcywgKGJsb2NrKSA9PiB7XG4gICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgcmV0dXJuICdcXHVmZmViJztcbiAgfSk7XG4gIHJldHVybiBjb2RlO1xufTtcblxuZnVuY3Rpb24gY3JlYXRlSWQoKSB7XG4gIHZhciBhbHBoYWJldCA9ICdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eic7XG4gIHZhciBsZW5ndGggPSBhbHBoYWJldC5sZW5ndGggLSAxO1xuICB2YXIgaSA9IDY7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzICs9IGFscGhhYmV0W01hdGgucmFuZG9tKCkgKiBsZW5ndGggfCAwXTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gZW50aXRpZXModGV4dCkge1xuICByZXR1cm4gdGV4dFxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICA7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGUocmVnZXhwLCB0YWcpIHtcbiAgdmFyIG9wZW5UYWcgPSAnPCcgKyB0YWcgKyAnPic7XG4gIHZhciBjbG9zZVRhZyA9ICc8LycgKyB0YWcgKyAnPic7XG4gIHJldHVybiB7XG4gICAgbmFtZTogdGFnLFxuICAgIHJlZ2V4cDogcmVnZXhwLFxuICAgIHJlcGxhY2VyOiBvcGVuVGFnICsgJyQmJyArIGNsb3NlVGFnXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hcChvYmosIGZuKSB7XG4gIHZhciByZXN1bHQgPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHJlc3VsdFtrZXldID0gZm4ob2JqW2tleV0sIGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZShwYXNzLCBjb2RlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFzcy5sZW5ndGg7IGkrKykge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UocGFzc1tpXVswXSwgcGFzc1tpXVsxXSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZ5KGJsb2NrKSB7XG4gIHZhciBvbmUgPSBibG9ja1swXTtcbiAgdmFyIHR3byA9IG9uZSArIGJsb2NrWzFdO1xuICByZXR1cm4gVGFnW3R3b10gfHwgVGFnW29uZV07XG59XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBQYXJ0cyA9IHJlcXVpcmUoJy4vcGFydHMnKTtcblxudmFyIFR5cGUgPSB7XG4gICdcXG4nOiAnbGluZXMnLFxuICAneyc6ICdvcGVuIGN1cmx5JyxcbiAgJ30nOiAnY2xvc2UgY3VybHknLFxuICAnWyc6ICdvcGVuIHNxdWFyZScsXG4gICddJzogJ2Nsb3NlIHNxdWFyZScsXG4gICcoJzogJ29wZW4gcGFyZW5zJyxcbiAgJyknOiAnY2xvc2UgcGFyZW5zJyxcbiAgJy8nOiAnb3BlbiBjb21tZW50JyxcbiAgJyonOiAnY2xvc2UgY29tbWVudCcsXG4gICdgJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG4vLyB2YXIgVE9LRU4gPSAvXFxuL2c7XG52YXIgVE9LRU4gPSAvXFxufFxcL1xcKnxcXCpcXC98YHxcXHt8XFx9fFxcW3xcXF18XFwofFxcKS9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRva2VucztcblxuVG9rZW5zLlR5cGUgPSBUeXBlO1xuXG5mdW5jdGlvbiBUb2tlbnMoZmFjdG9yeSkge1xuICBmYWN0b3J5ID0gZmFjdG9yeSB8fCBmdW5jdGlvbigpIHsgcmV0dXJuIG5ldyBQYXJ0czsgfTtcblxuICB2YXIgdCA9IHRoaXMudG9rZW5zID0ge1xuICAgIGxpbmVzOiBmYWN0b3J5KCksXG4gICAgYmxvY2tzOiBmYWN0b3J5KCksXG4gICAgc2VnbWVudHM6IGZhY3RvcnkoKSxcbiAgfTtcblxuICB0aGlzLmNvbGxlY3Rpb24gPSB7XG4gICAgJ1xcbic6IHQubGluZXMsXG4gICAgJ3snOiB0LmJsb2NrcyxcbiAgICAnfSc6IHQuYmxvY2tzLFxuICAgICdbJzogdC5ibG9ja3MsXG4gICAgJ10nOiB0LmJsb2NrcyxcbiAgICAnKCc6IHQuYmxvY2tzLFxuICAgICcpJzogdC5ibG9ja3MsXG4gICAgJy8nOiB0LnNlZ21lbnRzLFxuICAgICcqJzogdC5zZWdtZW50cyxcbiAgICAnYCc6IHQuc2VnbWVudHMsXG4gIH07XG59XG5cblRva2Vucy5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Ub2tlbnMucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8fCAwO1xuXG4gIHZhciB0b2tlbnMgPSB0aGlzLnRva2VucztcbiAgdmFyIG1hdGNoO1xuICB2YXIgdHlwZTtcbiAgdmFyIGNvbGxlY3Rpb247XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGNvbGxlY3Rpb24gPSB0aGlzLmNvbGxlY3Rpb25bdGV4dFttYXRjaC5pbmRleF1dO1xuICAgIGNvbGxlY3Rpb24ucHVzaChtYXRjaC5pbmRleCArIG9mZnNldCk7XG4gIH1cbn07XG5cblRva2Vucy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocmFuZ2UsIHRleHQsIHNoaWZ0KSB7XG4gIHZhciBpbnNlcnQgPSBuZXcgVG9rZW5zKEFycmF5KTtcbiAgaW5zZXJ0LmluZGV4KHRleHQsIHJhbmdlWzBdKTtcblxuICB2YXIgbGVuZ3RocyA9IHt9O1xuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgbGVuZ3Roc1t0eXBlXSA9IHRoaXMudG9rZW5zW3R5cGVdLmxlbmd0aDtcbiAgfVxuXG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5zaGlmdE9mZnNldChyYW5nZVswXSwgc2hpZnQpO1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnJlbW92ZVJhbmdlKHJhbmdlKTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5pbnNlcnQocmFuZ2VbMF0sIGluc2VydC50b2tlbnNbdHlwZV0pO1xuICB9XG5cbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIGlmICh0aGlzLnRva2Vuc1t0eXBlXS5sZW5ndGggIT09IGxlbmd0aHNbdHlwZV0pIHtcbiAgICAgIHRoaXMuZW1pdChgY2hhbmdlICR7dHlwZX1gKTtcbiAgICB9XG4gIH1cbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlJbmRleCA9IGZ1bmN0aW9uKHR5cGUsIGluZGV4KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5nZXQoaW5kZXgpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRDb2xsZWN0aW9uID0gZnVuY3Rpb24odHlwZSkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV07XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5T2Zmc2V0ID0gZnVuY3Rpb24odHlwZSwgb2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5maW5kKG9mZnNldCk7XG59O1xuIiwidmFyIG9wZW4gPSByZXF1aXJlKCcuLi9saWIvb3BlbicpO1xudmFyIHNhdmUgPSByZXF1aXJlKCcuLi9saWIvc2F2ZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnLi9idWZmZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaWxlO1xuXG5mdW5jdGlvbiBGaWxlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMucm9vdCA9ICcnO1xuICB0aGlzLnBhdGggPSAndW50aXRsZWQnO1xuICB0aGlzLmJ1ZmZlciA9IG5ldyBCdWZmZXI7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkZpbGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuRmlsZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYnVmZmVyLm9uKCdyYXcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncmF3JykpO1xuICB0aGlzLmJ1ZmZlci5vbignc2V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3NldCcpKTtcbiAgdGhpcy5idWZmZXIub24oJ3VwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2UnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdiZWZvcmUgdXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JlZm9yZSBjaGFuZ2UnKSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5wYXRoID0gcGF0aDtcbiAgdGhpcy5yb290ID0gcm9vdDtcbiAgb3Blbihyb290ICsgcGF0aCwgKGVyciwgdGV4dCkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgICAgZm4gJiYgZm4oZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgICB0aGlzLmVtaXQoJ29wZW4nKTtcbiAgICBmbiAmJiBmbihudWxsLCB0aGlzKTtcbiAgfSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgc2F2ZSh0aGlzLnJvb3QgKyB0aGlzLnBhdGgsIHRoaXMuYnVmZmVyLnRvU3RyaW5nKCksIGZuIHx8IG5vb3ApO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi9saWIvZGVib3VuY2UnKTtcblxuLypcbiAgIC4gLlxuLTEgMCAxIDIgMyA0IDVcbiAgIG5cblxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSGlzdG9yeTtcblxuZnVuY3Rpb24gSGlzdG9yeShlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMubmVlZGxlID0gMDtcbiAgdGhpcy50aW1lb3V0ID0gdHJ1ZTtcbiAgdGhpcy50aW1lU3RhcnQgPSAwO1xufVxuXG5IaXN0b3J5LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDApIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xufSwgNzAwKTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdzYXZlJywgdGhpcy5uZWVkbGUpXG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aDtcbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuXG4gIHRoaXMubmVlZGxlLS07XG5cbiAgaWYgKHRoaXMubmVlZGxlIDwgMCkgdGhpcy5uZWVkbGUgPSAwO1xuICAvLyBjb25zb2xlLmxvZygndW5kbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIHRoaXMuY2hlY2tvdXQodGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICB0aGlzLm5lZWRsZSsrO1xuICAvLyBjb25zb2xlLmxvZygncmVkbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcblxuICB0aGlzLmNoZWNrb3V0KHRoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24obikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG4gIHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlID0gY29tbWl0Lm1hcmtBY3RpdmU7XG4gIHRoaXMuZWRpdG9yLm1hcmsuc2V0KGNvbW1pdC5tYXJrLmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLnNldENhcmV0KGNvbW1pdC5jYXJldC5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5idWZmZXIudGV4dCA9IGNvbW1pdC50ZXh0LmNvcHkoKTtcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLmxpbmVzID0gY29tbWl0LmxpbmVzLmNvcHkoKTtcbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNvbW1pdCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIHRleHQ6IHRoaXMuZWRpdG9yLmJ1ZmZlci50ZXh0LmNvcHkoKSxcbiAgICBsaW5lczogdGhpcy5lZGl0b3IuYnVmZmVyLmxpbmVzLmNvcHkoKSxcbiAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gIH07XG59O1xuIiwidmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG5cbnZhciBQQUdJTkdfVEhST1RUTEUgPSA2NTtcblxudmFyIGtleXMgPSBtb2R1bGUuZXhwb3J0cyA9IHtcbiAgJ2N0cmwreic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS51bmRvKCk7XG4gIH0sXG4gICdjdHJsK3knOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucmVkbygpO1xuICB9LFxuXG4gICdob21lJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKCk7XG4gIH0sXG4gICdlbmQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKCk7XG4gIH0sXG4gICdwYWdldXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdwYWdlZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93bigpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCt1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK2Rvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEpO1xuICB9LFxuICAndXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSk7XG4gIH0sXG4gICdyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxKTtcbiAgfSxcbiAgJ2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEpO1xuICB9LFxuICAnY3RybCtyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEpO1xuICB9LFxuXG4gICdjdHJsK2EnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9LFxuXG4gICdjdHJsK3NoaWZ0K3VwJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHsgYmVnaW46IHRoaXMuY2FyZXQucG9zLCBlbmQ6IHRoaXMuY2FyZXQucG9zIH0pO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHRoaXMubWFyay5nZXQoKSk7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG4gICdjdHJsK3NoaWZ0K2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnZW50ZXInOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmluc2VydCgnXFxuJyk7XG4gIH0sXG5cbiAgJ2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgbGluZXMgPSBhcmVhLmVuZC55IC0gYXJlYS5iZWdpbi55O1xuICAgIGlmIChsaW5lcyAmJiBhcmVhLmVuZC54ID4gMCkgYWRkICs9IDE7XG4gICAgaWYgKCFsaW5lcykgYWRkICs9IDE7XG4gICAgbGluZXMgKz0gYWRkO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYS5zZXRMZWZ0KDApLmFkZEJvdHRvbShhZGQpKTtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQoeyB4OiAwLCB5OiBhcmVhLmVuZC55IH0sIHRleHQpO1xuICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMobGluZXMpO1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKGxpbmVzLCB0cnVlKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsK2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAndGFiJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuc3VnZ2VzdCgpO1xuICAgIGlmICghcmVzKSB7XG4gICAgICB0aGlzLmluc2VydCh0aGlzLnRhYik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya1NldEFyZWEocmVzLmFyZWEpO1xuICAgICAgdGhpcy5pbnNlcnQocmVzLm5vZGUudmFsdWUpO1xuICAgIH1cbiAgfSxcblxuICAnY3RybCtmJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kLm9wZW4oKTtcbiAgfSxcblxuICAnZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKCsxKTtcbiAgfSxcbiAgJ3NoaWZ0K2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgtMSk7XG4gIH0sXG5cbiAgJ2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhZGQ7XG4gICAgdmFyIGFyZWE7XG4gICAgdmFyIHRleHQ7XG5cbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcblxuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgY2xlYXIgPSB0cnVlO1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0aGlzLm1hcmsuYWRkQm90dG9tKGFyZWEuZW5kLnggPiAwKS5zZXRMZWZ0KDApO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEodGhpcy5tYXJrLmdldCgpKTtcbiAgICB9XG5cbiAgICAvL1RPRE86IHNob3VsZCBjaGVjayBpZiBsYXN0IGxpbmUgaGFzIC8vIGFsc29cbiAgICBpZiAodGV4dC50cmltTGVmdCgpLnN1YnN0cigwLDIpID09PSAnLy8nKSB7XG4gICAgICBhZGQgPSAtMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLio/KVxcL1xcLyAoLispL2dtLCAnJDEkMicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGQgPSArMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oW1xcc10qKSguKykvZ20sICckMS8vICQyJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG5cbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEuYWRkUmlnaHQoYWRkKSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcblxuICAgIGlmIChjYXJldC54KSBjYXJldC5hZGRSaWdodChhZGQpO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQpO1xuXG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSBjbGVhciA9IHRydWU7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICBpZiAodGV4dC5zbGljZSgwLDIpID09PSAnLyonICYmIHRleHQuc2xpY2UoLTIpID09PSAnKi8nKSB7XG4gICAgICB0ZXh0ID0gdGV4dC5zbGljZSgyLC0yKTtcbiAgICAgIGFkZCAtPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkIC09IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRleHQgPSAnLyonICsgdGV4dCArICcqLyc7XG4gICAgICBhZGQgKz0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCArPSAyO1xuICAgIH1cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcbiAgICBhcmVhLmVuZC54ICs9IGFkZDtcbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldC5hZGRSaWdodChhZGQpKTtcbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxufTtcblxua2V5cy5zaW5nbGUgPSB7XG4gIC8vXG59O1xuXG4vLyBzZWxlY3Rpb24ga2V5c1xuWyAnaG9tZScsJ2VuZCcsXG4gICdwYWdldXAnLCdwYWdlZG93bicsXG4gICdsZWZ0JywndXAnLCdyaWdodCcsJ2Rvd24nLFxuICAnY3RybCtsZWZ0JywnY3RybCtyaWdodCdcbl0uZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAga2V5c1snc2hpZnQrJytrZXldID0gZnVuY3Rpb24oZSkge1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAga2V5c1trZXldLmNhbGwodGhpcywgZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH07XG59KTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLm1vdXNlID0gbmV3IE1vdXNlKHRoaXMpO1xuICB0aGlzLnRleHQgPSBuZXcgVGV4dDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSW5wdXQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSW5wdXQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJsdXIgPSB0aGlzLmJsdXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy50ZXh0Lm9uKFsna2V5JywgJ3RleHQnXSwgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2lucHV0JykpO1xuICB0aGlzLnRleHQub24oJ2ZvY3VzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJykpO1xuICB0aGlzLnRleHQub24oJ2JsdXInLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xuICB0aGlzLnRleHQucmVzZXQoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5ibHVyKCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmZvY3VzKCk7XG59O1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdXNlO1xuXG5mdW5jdGlvbiBNb3VzZSgpIHtcbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAgIC8vIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAvLyB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kb3duID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5kb3duID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkb3duJywgZSk7XG4gIHRoaXMub25jbGljayhlKTtcbiAgdGhpcy5tYXliZURyYWcoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbnVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3VwJywgZSk7XG4gIGlmICghdGhpcy5kb3duKSByZXR1cm47XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuZHJhZ0VuZCgpO1xuICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uY2xpY2sgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucmVzZXRDbGlja3MoKTtcbiAgdGhpcy5jbGlja3MgPSAodGhpcy5jbGlja3MgJSAzKSArIDE7XG4gIHRoaXMuZW1pdCgnY2xpY2snLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbm1heWJlZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG5cbiAgdmFyIGQgPVxuICAgICAgTWF0aC5hYnModGhpcy5wb2ludC54IC0gdGhpcy5kb3duLngpXG4gICAgKyBNYXRoLmFicyh0aGlzLnBvaW50LnkgLSB0aGlzLmRvd24ueSk7XG5cbiAgaWYgKGQgPiA1KSB7XG4gICAgdGhpcy5tYXliZURyYWdFbmQoKTtcbiAgICB0aGlzLmRyYWdCZWdpbigpO1xuICB9XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkcmFnJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgYmVnaW4nKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBlbmQnKTtcbn07XG5cblxuTW91c2UucHJvdG90eXBlLnJlc2V0Q2xpY2tzID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xpY2tzID0gMDtcbn0sIDM1MCk7XG5cbk1vdXNlLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xuXG52YXIgVEhST1RUTEUgPSAxMDAwLzYyO1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RleHRhcmVhJyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZScsXG4gICAgYXV0b2NvbXBsZXRlOiAnb2ZmJyxcbiAgICBzcGVsbGNoZWNraW5nOiAnb2ZmJyxcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufSwgMjAwMCk7XG5cblRleHQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5ibHVyKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmZvY3VzKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIC8vIGZvcmNlcyBjYXJldCB0byBlbmQgb2YgdGV4dGFyZWEgc28gd2UgY2FuIGdldCAuc2xpY2UoLTEpIGNoYXJcbiAgc2V0SW1tZWRpYXRlKCgpID0+IHRoaXMuZWwuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLmVsLnZhbHVlLmxlbmd0aCk7XG4gIHRoaXMuZW1pdCgndGV4dCcsIHRoaXMuZ2V0KCkpO1xuICB0aGlzLmNsZWFyKCk7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgLy8gY29uc29sZS5sb2coZS53aGljaCk7XG4gIHZhciBub3cgPSBEYXRlLm5vdygpO1xuICBpZiAobm93IC0gdGhpcy50aHJvdHRsZVRpbWUgPCBUSFJPVFRMRSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSBub3c7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0pO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXl1cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQgJiYgIWUuc2hpZnRLZXkpIGtleXMucHVzaCgnc2hpZnQ6dXAnKTtcbiAgaWYgKG0uY3RybCAmJiAhZS5jdHJsS2V5KSBrZXlzLnB1c2goJ2N0cmw6dXAnKTtcbiAgaWYgKG0uYWx0ICYmICFlLmFsdEtleSkga2V5cy5wdXNoKCdhbHQ6dXAnKTtcblxuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSArICc6dXAnKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9uY3V0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY3V0JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjb3B5JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbnBhc3RlID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgncGFzdGUnLCBlKTtcbn07XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi9saWIvcG9pbnQnKTtcblxudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3dvcmRzJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW92ZTtcblxuZnVuY3Rpb24gTW92ZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbn1cblxuTW92ZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlRG93biA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCBzaXplIC0gcmVtYWluZGVyKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcyhwYWdlKTtcbn07XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VVcCA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCAtKHNpemUgLSByZW1haW5kZXIpKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcygtcGFnZSk7XG59O1xuXG52YXIgbW92ZSA9IHt9O1xuXG5tb3ZlLmJ5V29yZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmUgPSBidWZmZXIuZ2V0TGluZVRleHQocC55KTtcblxuICBpZiAoZHggPiAwICYmIHAueCA+PSBsaW5lLmxlbmd0aCAtIDEpIHsgLy8gYXQgZW5kIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgKzEpOyAvLyBtb3ZlIG9uZSBjaGFyIHJpZ2h0XG4gIH0gZWxzZSBpZiAoZHggPCAwICYmIHAueCA9PT0gMCkgeyAvLyBhdCBiZWdpbiBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsIC0xKTsgLy8gbW92ZSBvbmUgY2hhciBsZWZ0XG4gIH1cblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UobGluZSwgV09SRFMpO1xuICB2YXIgd29yZDtcblxuICBpZiAoZHggPCAwKSB3b3Jkcy5yZXZlcnNlKCk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAoZHggPiAwXG4gICAgICA/IHdvcmQuaW5kZXggPiBwLnhcbiAgICAgIDogd29yZC5pbmRleCA8IHAueCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgeDogd29yZC5pbmRleCxcbiAgICAgICAgeTogcC55XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIHJlYWNoZWQgYmVnaW4vZW5kIG9mIGZpbGVcbiAgcmV0dXJuIGR4ID4gMFxuICAgID8gbW92ZS5lbmRPZkxpbmUoYnVmZmVyLCBwKVxuICAgIDogbW92ZS5iZWdpbk9mTGluZShidWZmZXIsIHApO1xufTtcblxubW92ZS5ieUNoYXJzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR4IDwgMCkgeyAvLyBnb2luZyBsZWZ0XG4gICAgeCArPSBkeDsgLy8gbW92ZSBsZWZ0XG4gICAgaWYgKHggPCAwKSB7IC8vIHdoZW4gcGFzdCBsZWZ0IGVkZ2VcbiAgICAgIGlmICh5ID4gMCkgeyAvLyBhbmQgbGluZXMgYWJvdmVcbiAgICAgICAgeSAtPSAxOyAvLyBtb3ZlIHVwIGEgbGluZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBhbmQgZ28gdG8gdGhlIGVuZCBvZiBsaW5lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB4ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAoZHggPiAwKSB7IC8vIGdvaW5nIHJpZ2h0XG4gICAgeCArPSBkeDsgLy8gbW92ZSByaWdodFxuICAgIHdoaWxlICh4IC0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoID4gMCkgeyAvLyB3aGlsZSBwYXN0IGxpbmUgbGVuZ3RoXG4gICAgICBpZiAoeSA9PT0gYnVmZmVyLmxvYygpKSB7IC8vIG9uIGVuZCBvZiBmaWxlXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGdvIHRvIGVuZCBvZiBsaW5lIG9uIGxhc3QgbGluZVxuICAgICAgICBicmVhazsgLy8gYW5kIGV4aXRcbiAgICAgIH1cbiAgICAgIHggLT0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoICsgMTsgLy8gd3JhcCB0aGlzIGxpbmUgbGVuZ3RoXG4gICAgICB5ICs9IDE7IC8vIGFuZCBtb3ZlIGRvd24gYSBsaW5lXG4gICAgfVxuICB9XG5cbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJ5TGluZXMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR5KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHkgPCAwKSB7IC8vIGdvaW5nIHVwXG4gICAgaWYgKHkgKyBkeSA+IDApIHsgLy8gd2hlbiBsaW5lcyBhYm92ZVxuICAgICAgeSArPSBkeTsgLy8gbW92ZSB1cFxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gMDtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZHkgPiAwKSB7IC8vIGdvaW5nIGRvd25cbiAgICBpZiAoeSA8IGJ1ZmZlci5sb2MoKSAtIGR5KSB7IC8vIHdoZW4gbGluZXMgYmVsb3dcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgZG93blxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gYnVmZmVyLmxvYygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmICh4ID4gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpIHtcbiAgLy8gICB4ID0gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGg7XG4gIC8vIH0gZWxzZSB7XG4gIC8vIH1cbiAgeCA9IE1hdGgubWluKHRoaXMubGFzdERlbGliZXJhdGVYLCBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGgpO1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZMaW5lID0gZnVuY3Rpb24oXywgcCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZMaW5lID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUocC55KS5sZW5ndGg7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gSW5maW5pdHk7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkZpbGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9O1xufTtcblxubW92ZS5lbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IGxhc3RcbiAgfTtcbn07XG5cbm1vdmUuaXNCZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgcmV0dXJuIHAueCA9PT0gMCAmJiBwLnkgPT09IDA7XG59O1xuXG5tb3ZlLmlzRW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICByZXR1cm4gcC55ID09PSBsYXN0ICYmIHAueCA9PT0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoO1xufTtcblxuT2JqZWN0LmtleXMobW92ZSkuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgTW92ZS5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKHBhcmFtLCBieUVkaXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbW92ZVttZXRob2RdLmNhbGwoXG4gICAgICB0aGlzLFxuICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLFxuICAgICAgdGhpcy5lZGl0b3IuY2FyZXQsXG4gICAgICBwYXJhbVxuICAgICk7XG5cbiAgICBpZiAoJ2lzJyA9PT0gbWV0aG9kLnNsaWNlKDAsMikpIHJldHVybiByZXN1bHQ7XG5cbiAgICB0aGlzLmVtaXQoJ21vdmUnLCByZXN1bHQsIGJ5RWRpdCk7XG4gIH07XG59KTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZWRpdG9yXCI6XCJfc3JjX3N0eWxlX19lZGl0b3JcIixcImxheWVyXCI6XCJfc3JjX3N0eWxlX19sYXllclwiLFwicm93c1wiOlwiX3NyY19zdHlsZV9fcm93c1wiLFwibWFya1wiOlwiX3NyY19zdHlsZV9fbWFya1wiLFwiY29kZVwiOlwiX3NyY19zdHlsZV9fY29kZVwiLFwiY2FyZXRcIjpcIl9zcmNfc3R5bGVfX2NhcmV0XCIsXCJibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2JsaW5rLXNtb290aFwiLFwiY2FyZXQtYmxpbmstc21vb3RoXCI6XCJfc3JjX3N0eWxlX19jYXJldC1ibGluay1zbW9vdGhcIixcImd1dHRlclwiOlwiX3NyY19zdHlsZV9fZ3V0dGVyXCIsXCJydWxlclwiOlwiX3NyY19zdHlsZV9fcnVsZXJcIixcImFib3ZlXCI6XCJfc3JjX3N0eWxlX19hYm92ZVwiLFwiZmluZFwiOlwiX3NyY19zdHlsZV9fZmluZFwiLFwiYmxvY2tcIjpcIl9zcmNfc3R5bGVfX2Jsb2NrXCJ9IiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG52YXIgdGhlbWVzID0ge1xuICBtb25va2FpOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzI4MjInLFxuICAgIGNvbG9yOiAnI0Y4RjhGMicsXG4gICAga2V5d29yZDogJyNERjIyNjYnLFxuICAgIGZ1bmN0aW9uOiAnI0EwRDkyRScsXG4gICAgZGVjbGFyZTogJyM2MUNDRTAnLFxuICAgIG51bWJlcjogJyNBQjdGRkInLFxuICAgIHBhcmFtczogJyNGRDk3MUYnLFxuICAgIGNvbW1lbnQ6ICcjNzU3MTVFJyxcbiAgICBzdHJpbmc6ICcjRTZEQjc0JyxcbiAgfSxcblxuICB3ZXN0ZXJuOiB7XG4gICAgYmFja2dyb3VuZDogJyNEOUQxQjEnLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyM3QTNCM0InLFxuICAgIGZ1bmN0aW9uOiAnIzI1NkY3NScsXG4gICAgZGVjbGFyZTogJyM2MzQyNTYnLFxuICAgIG51bWJlcjogJyMxMzREMjYnLFxuICAgIHBhcmFtczogJyMwODI2NjMnLFxuICAgIGNvbW1lbnQ6ICcjOTk4RTZFJyxcbiAgICBzdHJpbmc6ICcjQzQzQzNDJyxcbiAgfSxcblxuICByZWRibGlzczoge1xuICAgIGJhY2tncm91bmQ6ICcjMjcxRTE2JyxcbiAgICBjb2xvcjogJyNFOUUzRDEnLFxuICAgIGtleXdvcmQ6ICcjQTEzNjMwJyxcbiAgICBmdW5jdGlvbjogJyNCM0RGMDInLFxuICAgIGRlY2xhcmU6ICcjRjYzODMzJyxcbiAgICBudW1iZXI6ICcjRkY5RjRFJyxcbiAgICBwYXJhbXM6ICcjQTA5MEEwJyxcbiAgICByZWdleHA6ICcjQkQ3MEY0JyxcbiAgICBjb21tZW50OiAnIzYzNTA0NycsXG4gICAgc3RyaW5nOiAnIzNFQTFGQicsXG4gIH0sXG5cbiAgZGF5bGlnaHQ6IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0VCRUJFQicsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnI0ZGMUIxQicsXG4gICAgZnVuY3Rpb246ICcjMDAwNUZGJyxcbiAgICBkZWNsYXJlOiAnIzBDN0EwMCcsXG4gICAgbnVtYmVyOiAnIzgwMjFENCcsXG4gICAgcGFyYW1zOiAnIzRDNjk2OScsXG4gICAgY29tbWVudDogJyNBQkFCQUInLFxuICAgIHN0cmluZzogJyNFNjcwMDAnLFxuICB9LFxufTtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gc2V0VGhlbWU7XG5leHBvcnRzLnRoZW1lcyA9IHRoZW1lcztcblxuLypcbnQ6IG9wZXJhdG9yXG5rOiBrZXl3b3JkXG5kOiBkZWNsYXJlXG5iOiBidWlsdGluXG5vOiBib29sZWFuXG5uOiBudW1iZXJcbm06IHBhcmFtc1xuZjogZnVuY3Rpb25cbnI6IHJlZ2V4cFxuYzogY29tbWVudFxuczogc3RyaW5nXG5sOiBzeW1ib2xcbng6IGluZGVudFxuICovXG5mdW5jdGlvbiBzZXRUaGVtZShuYW1lKSB7XG4gIHZhciB0ID0gdGhlbWVzW25hbWVdO1xuICBkb20uY3NzKCd0aGVtZScsXG5gXG4uJHtuYW1lfSB7XG4gIGJhY2tncm91bmQ6ICR7dC5iYWNrZ3JvdW5kfTtcbn1cblxudCxcbmsge1xuICBjb2xvcjogJHt0LmtleXdvcmR9O1xufVxuXG5kLFxubiB7XG4gIGNvbG9yOiAke3QuZGVjbGFyZX07XG59XG5cbm8sXG5lIHtcbiAgY29sb3I6ICR7dC5udW1iZXJ9O1xufVxuXG5tIHtcbiAgY29sb3I6ICR7dC5wYXJhbXN9O1xufVxuXG5mIHtcbiAgY29sb3I6ICR7dC5mdW5jdGlvbn07XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxuciB7XG4gIGNvbG9yOiAke3QucmVnZXhwIHx8IHQucGFyYW1zfTtcbn1cblxuYyB7XG4gIGNvbG9yOiAke3QuY29tbWVudH07XG59XG5cbnMge1xuICBjb2xvcjogJHt0LnN0cmluZ307XG59XG5cbmwsXG4uJHtjc3MuY29kZX0ge1xuICBjb2xvcjogJHt0LmNvbG9yfTtcbn1cblxuLiR7Y3NzLmNhcmV0fSB7XG4gIGJhY2tncm91bmQ6ICR7dC5jb2xvcn07XG59XG5cbm0sXG5kIHtcbiAgZm9udC1zdHlsZTogaXRhbGljO1xufVxuXG5sIHtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG54IHtcbiAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICBiYWNrZ3JvdW5kLXJlcGVhdDogbm8tcmVwZWF0O1xufVxuYFxuICApXG5cbn1cblxuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb2NrO1xuXG5mdW5jdGlvbiBCbG9jayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbkJsb2NrLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkJsb2NrLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXJQYWdlKDEsIHRydWUpO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBDb2RlO1xuXG5mdW5jdGlvbiBDb2RlKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCA3KTtcbn1cblxuQ29kZS5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5Db2RlLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuXG4gIGlmICghdGhpcy5lZGl0b3IuZWRpdGluZykge1xuICAgIHRoaXMucmVuZGVyQWhlYWQoKTtcbiAgfVxufTtcblxuQ29kZS5wcm90b3R5cGUucmVuZGVyRWRpdCA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuXG4gIHZhciB5ID0gZWRpdC5saW5lO1xuICB2YXIgZyA9IGVkaXQucmFuZ2Uuc2xpY2UoKTtcbiAgdmFyIHNoaWZ0ID0gZWRpdC5zaGlmdDtcbiAgdmFyIGlzRW50ZXIgPSBzaGlmdCA+IDA7XG4gIHZhciBpc0JhY2tzcGFjZSA9IHNoaWZ0IDwgMDtcbiAgdmFyIGlzQmVnaW4gPSBnWzBdICsgaXNCYWNrc3BhY2UgPT09IDA7XG4gIHZhciBpc0VuZCA9IGdbMV0gKyBpc0VudGVyID09PSB0aGlzLmVkaXRvci5yb3dzO1xuXG4gIGlmIChzaGlmdCkge1xuICAgIGlmIChpc0VudGVyKSB7XG4gICAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgICAgIGlmICghdGhpcy5oYXNWaWV3VG9wQXQoZWRpdC5jYXJldE5vdy55KSB8fCBlZGl0LmNhcmV0QmVmb3JlLnggPiAwKSB7XG4gICAgICAgIHRoaXMuc2hpZnRWaWV3c0JlbG93KGVkaXQuY2FyZXROb3cueSArIDEsIDEpO1xuICAgICAgICB0aGlzLnNwbGl0RW50ZXIoZWRpdC5jYXJldE5vdy55KTtcbiAgICAgICAgaWYgKGVkaXQuY2FyZXRCZWZvcmUueCA+IDApIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZVJhbmdlKFtlZGl0LmNhcmV0QmVmb3JlLnksIGVkaXQuY2FyZXRCZWZvcmUueV0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhlZGl0LmNhcmV0Tm93LnksIDEpO1xuICAgICAgfVxuICAgICAgdGhpcy5yZW5kZXJQYWdlQmVsb3coZWRpdC5jYXJldE5vdy55KzEpO1xuICAgIH1cbiAgICBlbHNlIGlmIChpc0JhY2tzcGFjZSkge1xuICAgICAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwxXSk7XG4gICAgICB0aGlzLnNob3J0ZW5Cb3R0b21BdChlZGl0LmNhcmV0Tm93LnkpO1xuICAgICAgdGhpcy5zaGlmdFZpZXdzQmVsb3coZWRpdC5jYXJldE5vdy55KzEsIC0xKTtcbiAgICAgIGlmICghdGhpcy5oYXNWaWV3VG9wQXQoZWRpdC5jYXJldE5vdy55KSkge1xuICAgICAgICB0aGlzLnNwbGl0QmFja3NwYWNlKGVkaXQuY2FyZXROb3cueSk7XG4gICAgICB9XG4gICAgICBpZiAoZWRpdC5jYXJldE5vdy54ID4gMCkge1xuICAgICAgICB0aGlzLnVwZGF0ZVJhbmdlKFtlZGl0LmNhcmV0Tm93LnksIGVkaXQuY2FyZXROb3cueV0pO1xuICAgICAgfVxuICAgICAgdGhpcy5yZW5kZXJQYWdlQmVsb3coZWRpdC5jYXJldE5vdy55KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhpcy51cGRhdGVSYW5nZShnKTtcbiAgICB0aGlzLnJlbmRlclBhZ2UoMCk7XG4gIH1cbn07XG5cbkNvZGUucHJvdG90eXBlLnJlcGFpbnRCZWxvd0NhcmV0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc3BsaXRFbnRlcih0aGlzLmVkaXRvci5jYXJldC55KTtcbiAgdGhpcy5yZW5kZXJQYWdlQmVsb3codGhpcy5lZGl0b3IuY2FyZXQueSwgdHJ1ZSk7XG4gIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xufTtcbiIsInZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaW5kO1xuXG5mdW5jdGlvbiBGaW5kKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCA0KTtcbn1cblxuRmluZC5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5GaW5kLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5maW5kLmlzT3BlbiB8fCAhdGhpcy5lZGl0b3IuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XG4gIHRoaXMucmVuZGVyUGFnZSgwKTtcbn07XG4iLCJ2YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcbnZhciBDb2RlVmlldyA9IHJlcXVpcmUoJy4vY29kZScpO1xudmFyIE1hcmtWaWV3ID0gcmVxdWlyZSgnLi9tYXJrJyk7XG52YXIgUm93c1ZpZXcgPSByZXF1aXJlKCcuL3Jvd3MnKTtcbnZhciBGaW5kVmlldyA9IHJlcXVpcmUoJy4vZmluZCcpO1xudmFyIEJsb2NrVmlldyA9IHJlcXVpcmUoJy4vYmxvY2snKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlld3M7XG5cbmZ1bmN0aW9uIFZpZXdzKGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcblxuICB0aGlzLnZpZXdzID0gW1xuICAgIG5ldyBWaWV3KCdydWxlcicsIGVkaXRvciwgdGVtcGxhdGUucnVsZXIpLFxuICAgIG5ldyBDb2RlVmlldygnY29kZScsIGVkaXRvciwgdGVtcGxhdGUuY29kZSksXG4gICAgbmV3IFZpZXcoJ2NhcmV0JywgZWRpdG9yLCB0ZW1wbGF0ZS5jYXJldCksXG4gICAgbmV3IEJsb2NrVmlldygnYmxvY2snLCBlZGl0b3IsIHRlbXBsYXRlLmJsb2NrKSxcbiAgICBuZXcgRmluZFZpZXcoJ2ZpbmQnLCBlZGl0b3IsIHRlbXBsYXRlLmZpbmQpLFxuICAgIG5ldyBNYXJrVmlldygnbWFyaycsIGVkaXRvciwgdGVtcGxhdGUubWFyayksXG4gICAgbmV3IFJvd3NWaWV3KCdyb3dzJywgZWRpdG9yLCB0ZW1wbGF0ZS5yb3dzKSxcbiAgXTtcblxuICB0aGlzLnZpZXdzLmZvckVhY2godmlldyA9PiB0aGlzW3ZpZXcubmFtZV0gPSB2aWV3KTtcbiAgdGhpcy5mb3JFYWNoID0gdGhpcy52aWV3cy5mb3JFYWNoLmJpbmQodGhpcy52aWV3cyk7XG5cbiAgdGhpcy5ibG9jay5yZW5kZXIgPSBkZWJvdW5jZSh0aGlzLmJsb2NrLnJlbmRlciwgMjApO1xuXG4gIC8vVE9ETzogbmVlZHMgdG8gYmUgc2V0IGR5bmFtaWNhbGx5XG4gIGlmICh0aGlzLmVkaXRvci5vcHRpb25zLmhpZGVfcm93cykgdGhpcy5yb3dzLnJlbmRlciA9IG5vb3A7XG59XG5cblZpZXdzLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufSxcblxuVmlld3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnJlbmRlcigpKTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcblxudmFyIEFoZWFkVGhyZXNob2xkID0ge1xuICBhbmltYXRpb246IFsuMTUsIC40XSxcbiAgbm9ybWFsOiBbMS41LCAzXVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBMYXllcjtcblxuZnVuY3Rpb24gTGF5ZXIobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgbGVuZ3RoKSB7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5sYXllcik7XG4gIHRoaXMubmFtZSA9IG5hbWU7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG4gIHRoaXMudmlld3MgPSB0aGlzLmNyZWF0ZShsZW5ndGgpO1xufVxuXG5MYXllci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5MYXllci5wcm90b3R5cGUuY3JlYXRlID0gZnVuY3Rpb24obGVuZ3RoKSB7XG4gIHZhciB2aWV3cyA9IG5ldyBBcnJheShsZW5ndGgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmlld3NbaV0gPSBuZXcgVmlldyh0aGlzLm5hbWUsIHRoaXMuZWRpdG9yLCB0aGlzLnRlbXBsYXRlKTtcbiAgICBkb20uYXBwZW5kKHRoaXMsIHZpZXdzW2ldKTtcbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVxdWVzdFZpZXcgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3LnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gdmlldztcbiAgfVxuICByZXR1cm4gdGhpcy5jbGVhcigpWzBdO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLmdldFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJldHVybiB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UocmFuZ2UpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLmluUmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IHRydWVcbiAgICAgICYmICggdmlld1swXSA+PSByYW5nZVswXSAmJiB2aWV3WzBdIDw9IHJhbmdlWzFdXG4gICAgICAgIHx8IHZpZXdbMV0gPj0gcmFuZ2VbMF0gJiYgdmlld1sxXSA8PSByYW5nZVsxXSApICkge1xuICAgICAgdmlld3MucHVzaCh2aWV3KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZpZXdzO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLm91dFJhbmdlVmlld3MgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgdmlld3MgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICggdmlldy52aXNpYmxlID09PSBmYWxzZVxuICAgICAgfHwgdmlld1sxXSA8IHJhbmdlWzBdXG4gICAgICB8fCB2aWV3WzBdID4gcmFuZ2VbMV0gKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3Muc29ydCgoYSxiKSA9PiBhLmxhc3RVc2VkIC0gYi5sYXN0VXNlZCk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2VzID0gZnVuY3Rpb24ocmFuZ2VzLCB2aWV3cykge1xuICBmb3IgKHZhciBuID0gMCwgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcmFuZ2UgPSByYW5nZXNbaV07XG4gICAgdmFyIHZpZXcgPSB2aWV3c1tuKytdO1xuICAgIHZpZXcucmVuZGVyKHJhbmdlKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIGluY2x1ZGUpIHtcbiAgdmFyIHZpc2libGVSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcbiAgdmFyIGluVmlld3MgPSB0aGlzLmluUmFuZ2VWaWV3cyhyYW5nZSk7XG4gIHZhciBvdXRWaWV3cyA9IHRoaXMub3V0UmFuZ2VWaWV3cyhtYXgocmFuZ2UsIHZpc2libGVSYW5nZSkpO1xuXG4gIHZhciBuZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKHJhbmdlLCBpblZpZXdzKTtcbiAgdmFyIG5lZWRWaWV3cyA9IG5lZWRSYW5nZXMubGVuZ3RoIC0gb3V0Vmlld3MubGVuZ3RoO1xuICBpZiAobmVlZFZpZXdzID4gMCkge1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlclJhbmdlcyhbdmlzaWJsZVJhbmdlXSwgdGhpcy52aWV3cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGVsc2UgaWYgKGluY2x1ZGUpIHRoaXMucmVuZGVyVmlld3MoaW5WaWV3cyk7XG4gIHRoaXMucmVuZGVyUmFuZ2VzKG5lZWRSYW5nZXMsIG91dFZpZXdzKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJWaWV3cyA9IGZ1bmN0aW9uKHZpZXdzKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXS5yZW5kZXIoKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckxpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMucmVuZGVyUmFuZ2UoW3kseV0pO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbihuLCBpbmNsdWRlKSB7XG4gIG4gPSBuIHx8IDA7XG4gIHRoaXMucmVuZGVyUmFuZ2UodGhpcy5nZXRQYWdlUmFuZ2UoWy1uLCtuXSksIGluY2x1ZGUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckFoZWFkID0gZnVuY3Rpb24oaW5jbHVkZSkge1xuICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICB2YXIgY3VycmVudFBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcblxuICAvLyBubyB2aWV3IGlzIHZpc2libGUsIHJlbmRlciBjdXJyZW50IHBhZ2Ugb25seVxuICBpZiAoUmFuZ2UuQU5EKGN1cnJlbnRQYWdlUmFuZ2UsIHZpZXdzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLnJlbmRlclBhZ2UoMCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdXVxuICAgIDogWy1BaGVhZFRocmVzaG9sZC5ub3JtYWxbMF0sICtBaGVhZFRocmVzaG9sZC5ub3JtYWxbMF1dO1xuXG4gIHZhciBhaGVhZFJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UodGhyZXNob2xkKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB2aWV3cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG4gICAgdGhpcy5yZW5kZXJQYWdlKFxuICAgICAgdGhpcy5lZGl0b3IuYW5pbWF0aW9uUnVubmluZ1xuICAgICAgICA/IEFoZWFkVGhyZXNob2xkLmFuaW1hdGlvblsxXVxuICAgICAgICA6IEFoZWFkVGhyZXNob2xkLm5vcm1hbFsxXSxcbiAgICAgIGluY2x1ZGVcbiAgICApO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUuc3BsaWNlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG5cbiAgICBpZiAodmlld1sxXSA8IHJhbmdlWzBdIHx8IHZpZXdbMF0gPiByYW5nZVsxXSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKHZpZXdbMF0gPCByYW5nZVswXSAmJiB2aWV3WzFdID49IHJhbmdlWzBdKSB7IC8vIHNob3J0ZW4gYWJvdmVcbiAgICAgIHZpZXdbMV0gPSByYW5nZVswXSAtIDE7XG4gICAgICB2aWV3LnN0eWxlKCk7XG4gICAgfSBlbHNlIGlmICh2aWV3WzFdID4gcmFuZ2VbMV0pIHsgLy8gc2hvcnRlbiBiZWxvd1xuICAgICAgdmlld1swXSA9IHJhbmdlWzFdICsgMTtcbiAgICAgIHZpZXcucmVuZGVyKCk7XG4gICAgfSBlbHNlIGlmICh2aWV3WzBdID09PSByYW5nZVswXSAmJiB2aWV3WzFdID09PSByYW5nZVsxXSkgeyAvLyBjdXJyZW50IGxpbmVcbiAgICAgIHZpZXcucmVuZGVyKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZpZXcuY2xlYXIoKTtcbiAgICB9XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5oYXNWaWV3VG9wQXQgPSBmdW5jdGlvbih5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA9PT0geSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnNob3J0ZW5Cb3R0b21BdCA9IGZ1bmN0aW9uKHkpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzFdID09PSB5KSB7XG4gICAgICB2aWV3WzFdIC09IDE7XG4gICAgICB2aWV3LnN0eWxlKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnNwbGl0RW50ZXIgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBwYWdlUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbMCwwXSk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5ICYmIHZpZXdbMV0gPj0geSkge1xuICAgICAgdmFyIGJvdHRvbSA9IHZpZXdbMV07XG4gICAgICB2aWV3WzFdID0geSAtIDE7XG4gICAgICB2aWV3LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclJhbmdlKFt5KzEsIE1hdGgubWluKHBhZ2VSYW5nZVsxXSwgYm90dG9tKzEpXSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnNwbGl0QmFja3NwYWNlID0gZnVuY3Rpb24oeSkge1xuICB2YXIgcGFnZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMV0pO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMF0gPD0geSAmJiB2aWV3WzFdID49IHkpIHtcbiAgICAgIHZhciBib3R0b20gPSB2aWV3WzFdO1xuICAgICAgdmlld1sxXSA9IHkgLSAxO1xuICAgICAgdmlldy5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJSYW5nZShbeSwgTWF0aC5taW4ocGFnZVJhbmdlWzFdLCBib3R0b20rMSldKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc2hpZnRWaWV3c0JlbG93ID0gZnVuY3Rpb24oeSwgZHkpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzBdIDwgeSkgY29udGludWU7XG5cbiAgICB2aWV3WzBdICs9IGR5O1xuICAgIHZpZXdbMV0gKz0gZHk7XG4gICAgdmlldy5zdHlsZSgpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUuY2xlYXJPdXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLm91dFJhbmdlVmlld3ModGhpcy5nZXRQYWdlUmFuZ2UocmFuZ2UpKS5mb3JFYWNoKHZpZXcgPT4gdmlldy5jbGVhcigpKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJQYWdlQmVsb3cgPSBmdW5jdGlvbih5LCBpbmNsdXNpdmUpIHtcbiAgdGhpcy5yZW5kZXJSYW5nZShbeSwgdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pWzFdXSwgaW5jbHVzaXZlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS51cGRhdGVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMuc3BsaWNlUmFuZ2UocmFuZ2UpO1xuICB0aGlzLnJlbmRlclJhbmdlKHJhbmdlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnZpZXdzW2ldLmNsZWFyKCk7XG4gIH1cbiAgcmV0dXJuIHRoaXMudmlld3M7XG59O1xuXG5mdW5jdGlvbiBtYXgoYSwgYikge1xuICByZXR1cm4gW01hdGgubWluKGFbMF0sIGJbMF0pLCBNYXRoLm1heChhWzFdLCBiWzFdKV07XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFyaztcblxuZnVuY3Rpb24gTWFyayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbk1hcmsucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuTWFyay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IubWFyay5hY3RpdmUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUm93cztcblxuZnVuY3Rpb24gUm93cyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNyk7XG59XG5cblJvd3MucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuUm93cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIHRoaXMuY2xlYXIoKTtcbiAgLy8gcmV0dXJuIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcblxuICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICB2YXIgcm93cyA9IHRoaXMuZWRpdG9yLnJvd3M7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHZpZXdzW2ldO1xuICAgIHZhciByID0gdmlldztcbiAgICBpZiAoIXZpZXcudmlzaWJsZSkgY29udGludWU7XG5cbiAgICBpZiAoclsxXSA+IHJvd3MpIHZpZXcuY2xlYXIoKTtcbiAgfVxuXG4gIHRoaXMucmVuZGVyQWhlYWQoKTtcbn07XG4iLCJ2YXIgdGVtcGxhdGUgPSBleHBvcnRzO1xuXG50ZW1wbGF0ZS5jb2RlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgLy8gaWYgKHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5wYXJhbSA9PT0gY29kZSkge1xuICAvLyAgIHJldHVybiB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucmVzdWx0O1xuICAvLyB9IGVsc2Uge1xuICAvLyAgIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5wYXJhbSA9IGNvZGU7XG4gIC8vICAgdGVtcGxhdGUuY29kZS5tZW1vaXplLnJlc3VsdCA9IGZhbHNlO1xuICAvLyB9XG5cbiAgLy8gdmFyIGh0bWwgPSBlLmJ1ZmZlci5nZXRIaWdobGlnaHRlZChyYW5nZSk7XG4gIHZhciBodG1sID0gZS5idWZmZXIuZ2V0KHJhbmdlKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbi8vIHNpbmdsZXRvbiBtZW1vaXplIGZvciBmYXN0IGxhc3QgcmVwZWF0aW5nIHZhbHVlXG50ZW1wbGF0ZS5jb2RlLm1lbW9pemUgPSB7XG4gIHBhcmFtOiAnJyxcbiAgcmVzdWx0OiAnJ1xufTtcblxudGVtcGxhdGUucm93cyA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBzID0gJyc7XG4gIGZvciAodmFyIGkgPSByYW5nZVswXTsgaSA8PSByYW5nZVsxXTsgaSsrKSB7XG4gICAgcyArPSAoaSArIDEpICsgJ1xcbic7XG4gIH1cbiAgcmV0dXJuIHM7XG59O1xuXG50ZW1wbGF0ZS5tYXJrID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldHMgPSBlLmJ1ZmZlci5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcblxuICBhcmVhWzBdIC09IG9mZnNldHNbMF07XG4gIGFyZWFbMV0gLT0gb2Zmc2V0c1swXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKVxuICAgICsgJzxtYXJrPicgKyBlLnN5bnRheC5lbnRpdGllcyhtaWRkbGUpICsgJzwvbWFyaz4nO1xuXG4gIGh0bWwgPSBodG1sLnJlcGxhY2UoL1xcbi9nLCAnIFxcbicpO1xuXG4gIHJldHVybiBodG1sO1xufTtcblxudGVtcGxhdGUuZmluZCA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciByZXN1bHRzID0gZS5maW5kUmVzdWx0cztcblxuICB2YXIgYmVnaW4gPSAwO1xuICB2YXIgZW5kID0gcmVzdWx0cy5sZW5ndGg7XG4gIHZhciBwcmV2ID0gLTE7XG4gIHZhciBpID0gLTE7XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBpZiAocmVzdWx0c1tpXS55IDwgcmFuZ2VbMF0gLSAxKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciB0YWJzO1xuICB2YXIgcjtcbiAgd2hpbGUgKHJlc3VsdHNbaV0gJiYgcmVzdWx0c1tpXS55IDwgcmFuZ2VbMV0pIHtcbiAgICByID0gcmVzdWx0c1tpKytdO1xuICAgIHRhYnMgPSBlLmdldFBvaW50VGFicyhyKTtcbiAgICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgICArICd3aWR0aDonICsgd2lkdGggKyAnOydcbiAgICAgICAgICArICd0b3A6JyArIChyLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICAgKyAnbGVmdDonICsgKChyLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBodG1sID0gJyc7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcblxuICB2YXIgcmVzdWx0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5T2Zmc2V0KCdibG9ja3MnLCBvZmZzZXQpO1xuICBpZiAoIXJlc3VsdCkgcmV0dXJuIGh0bWw7XG5cbiAgdmFyIGxlbmd0aCA9IGUuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdibG9ja3MnKS5sZW5ndGg7XG4gIHZhciBjaGFyID0gZS5idWZmZXIuY2hhckF0KHJlc3VsdCk7XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgaSA9IHJlc3VsdC5pbmRleDtcbiAgdmFyIG9wZW5PZmZzZXQgPSByZXN1bHQub2Zmc2V0O1xuXG4gIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG5cbiAgdmFyIGNvdW50ID0gcmVzdWx0Lm9mZnNldCA+PSBvZmZzZXQgLSAxICYmIENsb3NlW2NoYXJdID8gMCA6IDE7XG5cbiAgdmFyIGxpbWl0ID0gMjAwO1xuXG4gIHdoaWxlIChpID4gMCkge1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAoIS0tbGltaXQpIHJldHVybiBodG1sO1xuXG4gICAgaWYgKG9wZW4gJiYgIS0tY291bnQpIGJyZWFrO1xuXG4gICAgb3Blbk9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCAtLWkpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIGNvdW50ID0gMTtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID1cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID1cbnRlbXBsYXRlLm1hcmsuc3R5bGUgPVxudGVtcGxhdGUucm93cy5zdHlsZSA9XG50ZW1wbGF0ZS5jb2RlLnN0eWxlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiByYW5nZVswXSAqIGUuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogZS5jaGFyLmhlaWdodFxuICB9O1xufTtcblxudGVtcGxhdGUuY2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUuY2FyZXQuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6ICtlLmhhc0ZvY3VzLFxuICAgIGxlZnQ6IGUuY2FyZXRQeC54ICsgZS5tYXJnaW5MZWZ0LFxuICAgIHRvcDogZS5jYXJldFB4LnkgLSAxLFxuICAgIGhlaWdodDogZS5jaGFyLmhlaWdodCArIDIsXG4gIH07XG59O1xuXG50ZW1wbGF0ZS5ndXR0ZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG51bGw7XG59O1xuXG50ZW1wbGF0ZS5ndXR0ZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6IDEsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiBlLnJvd3MgKiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUucnVsZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUucnVsZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIC8vIHdpZHRoOiBlLmxvbmdlc3RMaW5lICogZS5jaGFyLndpZHRoLFxuICAgIG9wYWNpdHk6IDAsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAoKGUucm93cyArIGUucGFnZS5oZWlnaHQpICogZS5jaGFyLmhlaWdodCkgKyBlLnBhZ2VSZW1haW5kZXIuaGVpZ2h0LFxuICB9O1xufTtcblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvbWVyZ2UnKTtcbnZhciB0cmltID0gcmVxdWlyZSgnLi4vLi4vbGliL3RyaW0nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5mdW5jdGlvbiBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFZpZXcpKSByZXR1cm4gbmV3IFZpZXcobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSk7XG5cbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcblxuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgdGhpcy5sYXN0VXNlZCA9IDA7XG5cbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHRoaXMuZWwuY2xhc3NOYW1lID0gY3NzW25hbWVdO1xuXG4gIHZhciBzdHlsZSA9IHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAwLFxuICAgIG9wYWNpdHk6IDBcbiAgfTtcblxuICBpZiAodGhpcy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzLmluZGV4T2YobmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICB9XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHN0eWxlKTtcbn1cblxuVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKCFyYW5nZSkgcmFuZ2UgPSB0aGlzO1xuXG4gIHRoaXMubGFzdFVzZWQgPSBEYXRlLm5vdygpO1xuXG4gIC8vIGNvbnNvbGUubG9nKHRoaXMubmFtZSwgdGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSwgZGlmZih0aGlzLnZhbHVlLCBlLmxheW91dFt0aGlzLm5hbWVdKSlcbiAgLy8gaWYgKCFkaWZmKHRoaXMudmFsdWUsIHRoaXMuZWRpdG9yLmxheW91dFt0aGlzLm5hbWVdKSkgcmV0dXJuO1xuXG4gIHZhciBodG1sID0gdGhpcy50ZW1wbGF0ZShyYW5nZSwgdGhpcy5lZGl0b3IpO1xuICBpZiAoaHRtbCA9PT0gZmFsc2UpIHJldHVybiB0aGlzLnN0eWxlKCk7XG5cbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG4gIHRoaXMudmlzaWJsZSA9IHRydWU7XG5cbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSB7XG4gIC8vICAgdmFyIHJlcyA9IHRyaW0uZW1wdHlMaW5lcyhodG1sKVxuICAvLyAgIHJhbmdlWzBdICs9IHJlcy5sZWFkaW5nO1xuICAvLyAgIGh0bWwgPSByZXMuc3RyaW5nO1xuICAvLyB9XG5cbiAgaWYgKGh0bWwpIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICBlbHNlIGlmICgnY29kZScgPT09IHRoaXMubmFtZSB8fCAnYmxvY2snID09PSB0aGlzLm5hbWUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG5cbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicsIHRoaXMubmFtZSlcbiAgdGhpcy5zdHlsZSgpO1xufTtcblxuVmlldy5wcm90b3R5cGUuc3R5bGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0VXNlZCA9IERhdGUubm93KCk7XG4gIGRvbS5zdHlsZSh0aGlzLCB0aGlzLnRlbXBsYXRlLnN0eWxlKHRoaXMsIHRoaXMuZWRpdG9yKSk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpc1swXSArICcsJyArIHRoaXNbMV07XG59O1xuXG5WaWV3LnByb3RvdHlwZS52YWx1ZU9mID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBbdGhpc1swXSwgdGhpc1sxXV07XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMudmlzaWJsZSkgcmV0dXJuO1xuICB0aGlzWzBdID0gdGhpc1sxXSA9IC0xO1xuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgLy8gZG9tLmh0bWwodGhpcywgJycpO1xuICBkb20uc3R5bGUodGhpcywgeyB0b3A6IDAsIGhlaWdodDogMCwgb3BhY2l0eTogMCB9KTtcbn07XG4iXX0=
