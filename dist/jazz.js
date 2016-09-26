(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

var NEWLINE = Regexp.create(['newline']);

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

    renderQueue: [],
    renderRequest: null,
  });

  dom.append(this.views.caret, this.input.text);

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
  this.views.use(this.el);

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
  this.render('code');
  this.render('mark');
  this.render('find');
  this.render('rows');
  this.rest();
};

Jazz.prototype.rest = debounce(function() {
  this.editing = false;
}, 600);

Jazz.prototype.onMove = function(point, byEdit) {
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
  //
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
  //
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
  this.followCaret();
  this.repaint();
};

Jazz.prototype.onHistoryChange = function() {
  this.render('code');
  this.render('mark');
  this.render('block');
  this.followCaret();
};

Jazz.prototype.onBeforeFileChange = function() {
  this.history.save();
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

Jazz.prototype.setCaretFromPx = function(px) {
  var g = new Point({ x: this.marginLeft, y: this.char.height/2 })['+'](this.offset);
  if (this.options.center_vertical) g.y += this.size.height / 3 | 0;
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
    this.render('mark');
  }
};

Jazz.prototype.markSetArea = function(area) {
  this.markBegin(area);
  this.render('mark');
};

Jazz.prototype.markClear = function(force) {
  if (this.input.text.modifiers.shift && !force) return;

  this.mark.active = false;
  this.mark.set({
    begin: new Point({ x: -1, y: -1 }),
    end: new Point({ x: -1, y: -1 })
  });
  this.clear('mark');
};

Jazz.prototype.getRange = function(range) {
  return Range.clamp(range, this.pageBounds);
};

Jazz.prototype.getPageRange = function(range) {
  var s = this.scroll.copy();
  if (this.options.center_vertical) {
    s.y -= this.size.height / 3 | 0;
  }
  var p = s['_/'](this.char);
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

  if (left + top + right + bottom) {
    this[animate ? 'animateScrollBy' : 'scrollBy'](right - left, bottom - top, 'ease');
  }
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

Jazz.prototype.delete = function() {
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
  this.render('find');
};

Jazz.prototype.onFindValue = function(value, noJump) {
  var g = new Point({ x: this.gutter, y: 0 });

  this.buffer.updateRaw();
  this.findValue = value;
  this.findResults = this.buffer.indexer.find(value).map((offset) => {
    return this.buffer.getOffsetPoint(offset);
  });

  if (this.findResults.length) {
    this.find.info(1 + this.findNeedle + '/' + this.findResults.length);
  }

  if (!noJump) this.findJump(0);

  this.render('find');
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
  this.clear('find');
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

Jazz.prototype.repaint = bindRaf(function() {
  this.resize();
  this.views.render();
});

Jazz.prototype.resize = function() {
  var $ = this.el;

  dom.css(this.id, `
    .${css.rows},
    .${css.mark},
    .${css.code},
    mark,
    p,
    t,
    k,
    d,
    n,
    o,
    e,
    m,
    f,
    r,
    c,
    s,
    l,
    x {
      font-family: monospace;
      font-size: ${this.options.font_size};
      line-height: ${this.options.line_height};
    }
    `
  );

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
      ? Math.max(
          (''+this.rows).length,
          ( this.page.width - 81
          - (this.options.hide_rows ? 0 : (''+this.rows).length)
          ) / 2 | 0
        ) : 0)
    + (this.options.hide_rows ? 0 : Math.max(3, (''+this.rows).length))
  ) * this.char.width
  + (this.options.hide_rows
      ? 0
      : this.options.gutter_margin * (this.options.center_horizontal ? -1 : 1)
    );

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

    .${css.rows},
    .${css.mark},
    .${css.code},
    mark,
    p,
    t,
    k,
    d,
    n,
    o,
    e,
    m,
    f,
    r,
    c,
    s,
    l,
    x {
      font-family: monospace;
      font-size: ${this.options.font_size};
      line-height: ${this.options.line_height};
    }

    #${this.id} > .${css.ruler},
    #${this.id} > .${css.find},
    #${this.id} > .${css.mark},
    #${this.id} > .${css.code} {
      margin-left: ${this.marginLeft}px;
      tab-size: ${this.tabSize};
    }
    #${this.id} > .${css.rows} {
      padding-right: ${this.options.gutter_margin}px;
      padding-left: ${this.options.margin_left}px;
      width: ${this.marginLeft}px;
    }
    #${this.id} > .${css.find} > i,
    #${this.id} > .${css.block} > i {
      height: ${this.char.height + 1}px;
    }
    x {
      background-image: url(${dataURL});
    }`
  );

  this.emit('resize');
};

Jazz.prototype.clear = function(name) {
  this.views[name].clear();
};

Jazz.prototype.render = function(name) {
  cancelAnimationFrame(this.renderRequest);
  if (!~this.renderQueue.indexOf(name)) {
    if (name in this.views) {
      this.renderQueue.push(name);
    }
  }
  this.renderRequest = requestAnimationFrame(this._render.bind(this));
};

Jazz.prototype._render = function() {
  this.renderQueue.forEach(name => this.views[name].render());
  this.renderQueue = [];
};

// this is used for development debug purposes
function bindCallSite(fn) {
  return function(a, b, c, d) {
    var err = new Error;
    Error.captureStackTrace(err, arguments.callee);
    var stack = err.stack;
    console.log(stack);
    fn.call(this, a, b, c, d);
  };
}

},{"./lib/area":2,"./lib/bind-raf":4,"./lib/box":5,"./lib/clone":6,"./lib/debounce":7,"./lib/dialog":8,"./lib/diff":10,"./lib/dom":11,"./lib/event":12,"./lib/merge":14,"./lib/point":16,"./lib/range":19,"./lib/regexp":20,"./lib/set-immediate":22,"./lib/throttle":23,"./src/file":32,"./src/history":33,"./src/input":35,"./src/input/bindings":34,"./src/input/text":37,"./src/move":38,"./src/style.css":39,"./src/theme":40,"./src/views":45}],2:[function(require,module,exports){
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
      if (style[name] !== 'auto')
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

dom.css = function(id, cssText) {
  if (!(id in dom.css.styles)) {
    dom.css.styles[id] = document.createElement('style');
    document.body.appendChild(dom.css.styles[id]);
  }
  dom.css.styles[id].textContent = cssText;
};

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
  this.log = [];
  this.syntax = new Syntax;
  this.indexer = new Indexer(this);
  this.segments = new Segments(this);
  this.setText('');
}

Buffer.prototype.__proto__ = Event.prototype;

Buffer.prototype.updateRaw = function() {
  this.raw = this.text.toString();
};

Buffer.prototype.copy = function() {
  this.updateRaw();
  var buffer = new Buffer;
  buffer.replace(this);
  return buffer;
};

Buffer.prototype.replace = function(data) {
  this.raw = data.raw;
  this.text.set(this.raw);
  this.tokens = data.tokens.copy();
  this.segments.clearCache();
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
Buffer.prototype.insertTextAtPoint = function(p, text, noLog) {
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

Buffer.prototype.remove =
Buffer.prototype.removeOffsetRange = function(o, noLog) {
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

Buffer.prototype.removeArea = function(area) {
  var offsets = this.getAreaOffsetRange(area);
  return this.removeOffsetRange(offsets);
};

Buffer.prototype.removeCharAtPoint = function(p) {
  var point = this.getPoint(p);
  var offsetRange = [point.offset, point.offset+1];
  return this.removeOffsetRange(offsetRange);
};

Buffer.prototype.get = function(range) {
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
    code = SEGMENT[segment] + '\uffba\n' + code + indentText + '\uffbe*/`'
    code = this.syntax.highlight(code);
    code = '<' + segment[0] + '>' +
      code.substring(
        code.indexOf('\uffba') + 2,
        code.lastIndexOf('\uffbe')
      );
  } else {
    code = this.syntax.highlight(code + indentText + '\uffbe*/`');
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
    x: offset - (offset > token.offset ? token.offset + (!!token.part.length) : 0),
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
  this.removeArea(area);

  this.insert({ x:0, y:area.begin.y + y }, text);

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

},{"../../lib/area":2,"../../lib/event":12,"../../lib/point":16,"../../lib/regexp":20,"./indexer":25,"./prefixtree":27,"./segments":28,"./skipstring":29,"./syntax":30,"./tokens":31}],25:[function(require,module,exports){

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

},{}],26:[function(require,module,exports){
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

Parts.prototype.removeRange = function(range) {
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

Parts.prototype.slice = function() {
  var parts = new Parts(this.minSize);
  this.parts.forEach(part => {
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

},{}],28:[function(require,module,exports){
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

},{"../../lib/binary-search":3,"../../lib/point":16,"./tokens":31}],29:[function(require,module,exports){
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

},{}],30:[function(require,module,exports){
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

var Blocks = R(['comment','string','regexp'], 'gm');

var LongLines = /(^.{1000,})/gm;

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
  return code
    .replace(/\uffec/g, function() {
      block = blocks[n++];
      return entities(block.slice(0, 1000) + '...line too long to display');
    })
    .replace(/\uffeb/g, function() {
      block = blocks[n++];
      var tag = identify(block);
      return '<'+tag+'>'+entities(block)+'</'+tag+'>';
    });
};

Syntax.prototype.createBlocks = function(code) {
  this.blocks = [];

  code = code
    .replace(LongLines, (block) => {
      this.blocks.push(block);
      return '\uffec';
    })
    .replace(Blocks, (block) => {
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

},{"../../lib/regexp":20}],31:[function(require,module,exports){
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

var TOKEN = /\n|\/\*|\*\/|`|\{|\}|\[|\]|\(|\)/g;

module.exports = Tokens;

Tokens.Type = Type;

function Tokens(factory) {
  factory = factory || function() { return new Parts; };

  this.factory = factory;

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

Tokens.prototype.copy = function() {
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
    '`': t.segments,
  };
  return tokens;
};

},{"../../lib/event":12,"./parts":26}],32:[function(require,module,exports){
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

},{"../lib/event":12,"../lib/open":15,"../lib/save":21,"./buffer":24}],33:[function(require,module,exports){
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

History.prototype.save = function(force) {
  if (Date.now() - this.timeStart > 2000 || force) this.actuallySave();
  this.timeout = this.debouncedSave();
};

History.prototype.debouncedSave = debounce(function() {
  this.actuallySave();
}, 700);

History.prototype.actuallySave = function() {
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

History.prototype.undo = function() {
  if (this.timeout !== false) this.actuallySave();

  if (this.needle > this.log.length - 1) this.needle = this.log.length - 1;
  if (this.needle < 0) return;

  this.checkout('undo', this.needle--);
};

History.prototype.redo = function() {
  if (this.timeout !== false) this.actuallySave();

  if (this.needle === this.log.length - 1) return;

  this.checkout('redo', ++this.needle);
};

History.prototype.checkout = function(type, n) {
  var commit = this.log[n];
  if (!commit) return;

  var log = commit.log;

  commit = this.log[n][type];
  this.editor.mark.active = commit.markActive;
  this.editor.mark.set(commit.mark.copy());
  this.editor.setCaret(commit.caret.copy());

  log = 'undo' === type
    ? log.slice().reverse()
    : log.slice();

  log.forEach(item => {
    var action = item[0];
    var offsetRange = item[1];
    var text = item[2];
    switch (action) {
      case 'insert':
        if ('undo' === type) {
          this.editor.buffer.removeOffsetRange(offsetRange, true);
        } else {
          this.editor.buffer.insert(this.editor.buffer.getOffsetPoint(offsetRange[0]), text, true);
        }
        break;
      case 'remove':
        if ('undo' === type) {
          this.editor.buffer.insert(this.editor.buffer.getOffsetPoint(offsetRange[0]), text, true);
        } else {
          this.editor.buffer.removeOffsetRange(offsetRange, true);
        }
        break;
    }
  });

  this.emit('change');
};

History.prototype.commit = function() {
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

History.prototype.saveMeta = function() {
  this.meta = {
    caret: this.editor.caret.copy(),
    mark: this.editor.mark.copy(),
    markActive: this.editor.mark.active
  };
};

},{"../lib/debounce":7,"../lib/event":12}],34:[function(require,module,exports){
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

},{"../../lib/event":12,"./mouse":36,"./text":37}],36:[function(require,module,exports){
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

},{"../../lib/debounce":7,"../../lib/event":12,"../../lib/point":16}],37:[function(require,module,exports){
var dom = require('../../lib/dom');
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var Event = require('../../lib/event');

var THROTTLE = 0 //1000/62;

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

},{"../../lib/debounce":7,"../../lib/dom":11,"../../lib/event":12,"../../lib/throttle":23}],38:[function(require,module,exports){
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

},{"../lib/event":12,"../lib/point":16,"../lib/regexp":20}],39:[function(require,module,exports){
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","blink-smooth":"_src_style__blink-smooth","caret-blink-smooth":"_src_style__caret-blink-smooth","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
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


},{"../lib/dom":11,"./style.css":39}],41:[function(require,module,exports){
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

BlockView.prototype.use = function(target) {
  dom.append(target, this);
};

BlockView.prototype.get = function(e) {
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
}

BlockView.prototype.render = function() {
  var html = this.get(this.editor);

  if (html !== this.html) {
    this.html = html;
    dom.html(this, html);
  }
};

BlockView.prototype.clear = function() {
  dom.style(this, {
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],42:[function(require,module,exports){
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

CaretView.prototype.use = function(target) {
  dom.append(target, this);
};

CaretView.prototype.render = function() {
  dom.style(this, {
    opacity: +this.editor.hasFocus,
    left: this.editor.caretPx.x + this.editor.marginLeft,
    top: this.editor.caretPx.y - 1,
    height: this.editor.char.height + 1
  });
};

CaretView.prototype.clear = function() {
  dom.style(this, {
    opacity: 0,
    left: 0,
    top: 0,
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],43:[function(require,module,exports){
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

CodeView.prototype.use = function(target) {
  this.target = target;
};

CodeView.prototype.renderPart = function(range) {
  var part = new Part(this, range);
  this.parts.push(part);
  part.render();
  part.append();
};

CodeView.prototype.renderEdit = function(edit) {
  this.clearOutPageRange([0,0]);
  if (edit.shift > 0) this.renderInsert(edit);
  else if (edit.shift < 0) this.renderRemove(edit);
  else this.renderLine(edit);
};

CodeView.prototype.renderPage = function() {
  var page = this.editor.getPageRange([0,0]);
  var inParts = this.inRangeParts(page);
  var needRanges = Range.NOT(page, this.parts);
  needRanges.forEach(range => this.renderPart(range));
  inParts.forEach(part => part.render());
};

CodeView.prototype.renderRemove = function(edit) {
  var parts = this.parts.slice();
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part[0] > edit.range[0] && part[1] < edit.range[1]) {
      this.removePart(part);
    }
    else if (part[0] < edit.line && part[1] >= edit.line) {
      part[1] = edit.line - 1;
      part.style();
      this.renderPart([edit.line, edit.line]);
    }
    else if (part[0] === edit.line && part[1] === edit.line) {
      part.render();
    }
    else if (part[0] === edit.line && part[1] > edit.line) {
      this.removePart(part);
      this.renderPart([edit.line, edit.line]);
    }
    else if (part[0] > edit.line && part[0] + edit.shift <= edit.line) {
      var offset = edit.line - (part[0] + edit.shift) + 1;
      part[0] += edit.shift + offset;
      part[1] += edit.shift + offset;
      part.offset(offset);
      if (part[0] >= part[1]) this.removePart(part);
    }
    else if (part[0] > edit.line) {
      part[0] += edit.shift;
      part[1] += edit.shift;
      part.style();
    }
  }
  this.renderPage();
};

CodeView.prototype.renderInsert = function(edit) {
  var parts = this.parts.slice();
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part[0] < edit.line && part[1] >= edit.line) {
      part[1] = edit.line - 1;
      part.style();
      this.renderPart(edit.range);
    }
    else if (part[0] === edit.line) {
      part.render();
    }
    else if (part[0] > edit.line) {
      part[0] += edit.shift;
      part[1] += edit.shift;
      part.style();
    }
  }
  this.renderPage();
};

CodeView.prototype.renderLine = function(edit) {
  var parts = this.parts.slice();
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (part[0] === edit.line && part[1] === edit.line) {
      part.render();
    }
    else if (part[0] <= edit.line && part[1] >= edit.line) {
      part[1] = edit.line - 1;
      if (part[1] < part[0]) this.removePart(part)
      else part.style();
      this.renderPart(edit.range);
    }
  }
  this.renderPage();
};

CodeView.prototype.removePart = function(part) {
  part.clear();
  this.parts.splice(this.parts.indexOf(part), 1);
};

CodeView.prototype.clearOutPageRange = function(range) {
  this.outRangeParts(this.editor.getPageRange(range))
    .forEach(part => this.removePart(part));
};

CodeView.prototype.inRangeParts = function(range) {
  var parts = [];
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if ( part[0] >= range[0] && part[0] <= range[1]
      || part[1] >= range[0] && part[1] <= range[1] ) {
      parts.push(part);
    }
  }
  return parts;
};

CodeView.prototype.outRangeParts = function(range) {
  var parts = [];
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if ( part[1] < range[0]
      || part[0] > range[1] ) {
      parts.push(part);
    }
  }
  return parts;
};

CodeView.prototype.render = function() {
  if (this.editor.editing) return;

  var page = this.editor.getPageRange([0,0]);

  if (Range.NOT(page, this.parts).length === 0) {
    return;
  }

  if (Range.AND(page, this.parts).length === 0) {
    this.clearOutPageRange([0,0]);
    this.renderPart(page);
    return;
  }

  // check if we're past the threshold of view
  var threshold = this.editor.animationRunning
    ? [-AheadThreshold.animation[0], +AheadThreshold.animation[0]]
    : [-AheadThreshold.normal[0], +AheadThreshold.normal[0]];

  var aheadRange = this.editor.getPageRange(threshold);
  var aheadNeedRanges = Range.NOT(aheadRange, this.parts);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders

    threshold = this.editor.animationRunning
      ? [-AheadThreshold.animation[1], +AheadThreshold.animation[1]]
      : [-AheadThreshold.normal[1], +AheadThreshold.normal[1]];

    this.clearOutPageRange(threshold);

    aheadRange = this.editor.getPageRange(threshold);
    aheadNeedRanges = Range.NOT(aheadRange, this.parts);
    aheadNeedRanges.forEach(range => {
      this.renderPart(range);
    });
  }
};

CodeView.prototype.clear = function() {
  this.parts.forEach(part => part.clear());
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

  if (this.view.editor.options.debug_layers
  && ~this.view.editor.options.debug_layers.indexOf(this.view.name)) {
    style.background = '#'
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16);
    style.opacity = 0.5;
  }

  dom.style(this, style);
}

Part.prototype.offset = function(y) {
  this.offsetTop += y;
  this.code = this.code.split(/\n/g).slice(y).join('\n');
  this[1] -= y;
  this.style();
  this.dom.el.scrollTop = this.offsetTop * this.view.editor.char.height;
};

Part.prototype.append = function() {
  dom.append(this.view.target, this);
};

Part.prototype.render = function() {
  var code = this.view.editor.buffer.get(this);
  if (code !== this.code) {
    dom.html(this, code);
    this.code = code;
  }
  this.style();
};

Part.prototype.style = function() {
  dom.style(this, {
    height: (this[1] - this[0] + 1) * this.view.editor.char.height,
    top: this[0] * this.view.editor.char.height
  });
};

Part.prototype.clear = function() {
  dom.remove(this);
};

},{"../../lib/dom":11,"../../lib/range":19,"../style.css":39,"./view":49}],44:[function(require,module,exports){
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

FindView.prototype.use = function(target) {
  dom.append(target, this);
};

FindView.prototype.get = function(range, e) {
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

FindView.prototype.render = function() {
  if (!this.editor.find.isOpen || !this.editor.findResults.length) return;

  var page = this.editor.getPageRange([-.5,+.5]);
  var html = this.get(page, this.editor);

  dom.html(this, html);
};

FindView.prototype.clear = function() {
  dom.html(this, '');
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],45:[function(require,module,exports){
var RulerView = require('./ruler');
var MarkView = require('./mark');
var CodeView = require('./code');
var CaretView = require('./caret');
var BlockView = require('./block');
var FindView = require('./find');
var RowsView = require('./rows');

module.exports = Views;

function Views(editor) {
  this.editor = editor;

  this.views = [
    new RulerView(editor),
    new MarkView(editor),
    new CodeView(editor),
    new CaretView(editor),
    new BlockView(editor),
    new FindView(editor),
    new RowsView(editor),
  ];

  this.views.forEach(view => this[view.name] = view);
  this.forEach = this.views.forEach.bind(this.views);
}

Views.prototype.use = function(el) {
  this.forEach(view => view.use(el));
};

Views.prototype.render = function() {
  this.forEach(view => view.render());
};

Views.prototype.clear = function() {
  this.forEach(view => view.clear());
};

},{"./block":41,"./caret":42,"./code":43,"./find":44,"./mark":46,"./rows":47,"./ruler":48}],46:[function(require,module,exports){
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

MarkView.prototype.use = function(target) {
  dom.append(target, this);
};

MarkView.prototype.get = function(range, e) {
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

MarkView.prototype.render = function() {
  if (!this.editor.mark.active) return this.clear();

  var page = this.editor.getPageRange([-.5,+.5]);
  var html = this.get(page, this.editor);

  dom.html(this, html);

  dom.style(this, {
    top: page[0] * this.editor.char.height,
    height: 'auto'
  });
};

MarkView.prototype.clear = function() {
  dom.style(this, {
    top: 0,
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],47:[function(require,module,exports){
var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = RowsView;

function RowsView(editor) {
  View.call(this, editor);
  this.name = 'rows';
  this.dom = dom(css.rows);
  this.rows = -1;
  this.range = [-1,-1];
  this.html = '';
}

RowsView.prototype.__proto__ = View.prototype;

RowsView.prototype.use = function(target) {
  dom.append(target, this);
};

RowsView.prototype.render = function() {
  var range = this.editor.getPageRange([-1,+1]);

  if ( range[0] >= this.range[0]
    && range[1] <= this.range[1]
    && ( this.range[1] !== this.rows
      || this.editor.rows === this.rows
    )) return;

  range = this.editor.getPageRange([-3,+3]);
  this.rows = this.editor.rows;
  this.range = range;

  var html = '';
  for (var i = range[0]; i <= range[1]; i++) {
    html += (i + 1) + '\n';
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

RowsView.prototype.clear = function() {
  dom.style(this, {
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],48:[function(require,module,exports){
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

RulerView.prototype.use = function(target) {
  dom.append(target, this);
};

RulerView.prototype.render = function() {
  dom.style(this, {
    top: 0,
    height: (this.editor.rows + this.editor.page.height)
      * this.editor.char.height
      + this.editor.pageRemainder.height
  });
};

RulerView.prototype.clear = function() {
  dom.style(this, {
    height: 0
  });
};

},{"../../lib/dom":11,"../style.css":39,"./view":49}],49:[function(require,module,exports){

module.exports = View;

function View(editor) {
  this.editor = editor;
}

View.prototype.render = function() {
  throw new Error('render not implemented');
};

View.prototype.clear = function() {
  throw new Error('clear not implemented');
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvcGFydHMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvYnVmZmVyL3Rva2Vucy5qcyIsInNyYy9maWxlLmpzIiwic3JjL2hpc3RvcnkuanMiLCJzcmMvaW5wdXQvYmluZGluZ3MuanMiLCJzcmMvaW5wdXQvaW5kZXguanMiLCJzcmMvaW5wdXQvbW91c2UuanMiLCJzcmMvaW5wdXQvdGV4dC5qcyIsInNyYy9tb3ZlLmpzIiwic3JjL3N0eWxlLmNzcyIsInNyYy90aGVtZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jYXJldC5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3J1bGVyLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ppQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9RQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlMQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBKYXp6XG4gKi9cblxudmFyIERlZmF1bHRPcHRpb25zID0ge1xuICB0aGVtZTogJ3dlc3Rlcm4nLFxuICBmb250X3NpemU6ICc5cHQnLFxuICBsaW5lX2hlaWdodDogJzEuNGVtJyxcbiAgZGVidWdfbGF5ZXJzOiBmYWxzZSxcbiAgc2Nyb2xsX3NwZWVkOiA5NSxcbiAgaGlkZV9yb3dzOiBmYWxzZSxcbiAgY2VudGVyX2hvcml6b250YWw6IGZhbHNlLFxuICBjZW50ZXJfdmVydGljYWw6IGZhbHNlLFxuICBtYXJnaW5fbGVmdDogMTUsXG4gIGd1dHRlcl9tYXJnaW46IDIwLFxufTtcblxucmVxdWlyZSgnLi9saWIvc2V0LWltbWVkaWF0ZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL2xpYi9tZXJnZScpO1xudmFyIGNsb25lID0gcmVxdWlyZSgnLi9saWIvY2xvbmUnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9saWIvYmluZC1yYWYnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuL2xpYi9yZWdleHAnKTtcbnZhciBEaWFsb2cgPSByZXF1aXJlKCcuL2xpYi9kaWFsb2cnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4vbGliL3BvaW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuL2xpYi9yYW5nZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuL2xpYi9hcmVhJyk7XG52YXIgQm94ID0gcmVxdWlyZSgnLi9saWIvYm94Jyk7XG5cbnZhciBEZWZhdWx0QmluZGluZ3MgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC9iaW5kaW5ncycpO1xudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcbnZhciB0aGVtZSA9IHJlcXVpcmUoJy4vc3JjL3RoZW1lJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zcmMvc3R5bGUuY3NzJyk7XG5cbnZhciBORVdMSU5FID0gUmVnZXhwLmNyZWF0ZShbJ25ld2xpbmUnXSk7XG5cbm1vZHVsZS5leHBvcnRzID0gSmF6ejtcblxuZnVuY3Rpb24gSmF6eihvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG1lcmdlKGNsb25lKERlZmF1bHRPcHRpb25zKSwgb3B0aW9ucyB8fCB7fSk7XG5cbiAgT2JqZWN0LmFzc2lnbih0aGlzLCB7XG4gICAgZWw6IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKSxcblxuICAgIGlkOiAnamF6el8nICsgKE1hdGgucmFuZG9tKCkgKiAxMGU2IHwgMCkudG9TdHJpbmcoMzYpLFxuICAgIGZpbGU6IG5ldyBGaWxlLFxuICAgIG1vdmU6IG5ldyBNb3ZlKHRoaXMpLFxuICAgIHZpZXdzOiBuZXcgVmlld3ModGhpcyksXG4gICAgaW5wdXQ6IG5ldyBJbnB1dCh0aGlzKSxcbiAgICBoaXN0b3J5OiBuZXcgSGlzdG9yeSh0aGlzKSxcblxuICAgIGJpbmRpbmdzOiB7IHNpbmdsZToge30gfSxcblxuICAgIGZpbmQ6IG5ldyBEaWFsb2coJ0ZpbmQnLCBUZXh0Lm1hcCksXG4gICAgZmluZFZhbHVlOiAnJyxcbiAgICBmaW5kTmVlZGxlOiAwLFxuICAgIGZpbmRSZXN1bHRzOiBbXSxcblxuICAgIHNjcm9sbDogbmV3IFBvaW50LFxuICAgIG9mZnNldDogbmV3IFBvaW50LFxuICAgIHNpemU6IG5ldyBCb3gsXG4gICAgY2hhcjogbmV3IEJveCxcblxuICAgIHBhZ2U6IG5ldyBCb3gsXG4gICAgcGFnZVBvaW50OiBuZXcgUG9pbnQsXG4gICAgcGFnZVJlbWFpbmRlcjogbmV3IEJveCxcbiAgICBwYWdlQm91bmRzOiBuZXcgUmFuZ2UsXG5cbiAgICBsb25nZXN0TGluZTogMCxcbiAgICBndXR0ZXI6IDAsXG4gICAgY29kZTogMCxcbiAgICByb3dzOiAwLFxuXG4gICAgdGFiU2l6ZTogMixcbiAgICB0YWI6ICcgICcsXG5cbiAgICBjYXJldDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcbiAgICBjYXJldFB4OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuXG4gICAgaGFzRm9jdXM6IGZhbHNlLFxuXG4gICAgbWFyazogbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gICAgfSksXG5cbiAgICBlZGl0aW5nOiBmYWxzZSxcbiAgICBlZGl0TGluZTogLTEsXG4gICAgZWRpdFJhbmdlOiBbLTEsLTFdLFxuICAgIGVkaXRTaGlmdDogMCxcblxuICAgIHN1Z2dlc3RJbmRleDogMCxcbiAgICBzdWdnZXN0Um9vdDogJycsXG4gICAgc3VnZ2VzdE5vZGVzOiBbXSxcblxuICAgIGFuaW1hdGlvblR5cGU6ICdsaW5lYXInLFxuICAgIGFuaW1hdGlvbkZyYW1lOiAtMSxcbiAgICBhbmltYXRpb25SdW5uaW5nOiBmYWxzZSxcbiAgICBhbmltYXRpb25TY3JvbGxUYXJnZXQ6IG51bGwsXG5cbiAgICByZW5kZXJRdWV1ZTogW10sXG4gICAgcmVuZGVyUmVxdWVzdDogbnVsbCxcbiAgfSk7XG5cbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXdzLmNhcmV0LCB0aGlzLmlucHV0LnRleHQpO1xuXG4gIC8vIHVzZWZ1bCBzaG9ydGN1dHNcbiAgdGhpcy5idWZmZXIgPSB0aGlzLmZpbGUuYnVmZmVyO1xuICB0aGlzLmJ1ZmZlci5tYXJrID0gdGhpcy5tYXJrO1xuICB0aGlzLnN5bnRheCA9IHRoaXMuYnVmZmVyLnN5bnRheDtcblxuICB0aGVtZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuXG4gIHRoaXMuYmluZE1ldGhvZHMoKTtcbiAgdGhpcy5iaW5kRXZlbnRzKCk7XG59XG5cbkphenoucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSmF6ei5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZWwsIHNjcm9sbEVsKSB7XG4gIGlmICh0aGlzLnJlZikge1xuICAgIHRoaXMuZWwucmVtb3ZlQXR0cmlidXRlKCdpZCcpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZShjc3MuZWRpdG9yKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgICB0aGlzLm9mZlNjcm9sbCgpO1xuICAgIHRoaXMucmVmLmZvckVhY2gocmVmID0+IHtcbiAgICAgIGRvbS5hcHBlbmQoZWwsIHJlZik7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5yZWYgPSBbXS5zbGljZS5jYWxsKHRoaXMuZWwuY2hpbGRyZW4pO1xuICAgIGRvbS5hcHBlbmQoZWwsIHRoaXMuZWwpO1xuICAgIGRvbS5vbnJlc2l6ZSh0aGlzLm9uUmVzaXplKTtcbiAgfVxuXG4gIHRoaXMuZWwgPSBlbDtcbiAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2lkJywgdGhpcy5pZCk7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZChjc3MuZWRpdG9yKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gIHRoaXMub2ZmU2Nyb2xsID0gZG9tLm9uc2Nyb2xsKHNjcm9sbEVsIHx8IHRoaXMuZWwsIHRoaXMub25TY3JvbGwpO1xuICB0aGlzLmlucHV0LnVzZSh0aGlzLmVsKTtcbiAgdGhpcy52aWV3cy51c2UodGhpcy5lbCk7XG5cbiAgc2V0VGltZW91dCh0aGlzLnJlcGFpbnQsIDApO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYXNzaWduID0gZnVuY3Rpb24oYmluZGluZ3MpIHtcbiAgdGhpcy5iaW5kaW5ncyA9IGJpbmRpbmdzO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLmZpbGUub3BlbihwYXRoLCByb290LCBmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHRoaXMuZmlsZS5zYXZlKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0LCBwYXRoKSB7XG4gIHRoaXMuZmlsZS5zZXQodGV4dCk7XG4gIHRoaXMuZmlsZS5wYXRoID0gcGF0aCB8fCB0aGlzLmZpbGUucGF0aDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5mb2N1cyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5ibHVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbi5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJpbmRIYW5kbGVycygpXG4gIHRoaXMubW92ZS5vbignbW92ZScsIHRoaXMub25Nb3ZlKTtcbiAgdGhpcy5maWxlLm9uKCdyYXcnLCB0aGlzLm9uRmlsZVJhdyk7IC8vVE9ETzogc2hvdWxkIG5vdCBuZWVkIHRoaXMgZXZlbnRcbiAgdGhpcy5maWxlLm9uKCdzZXQnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuZmlsZS5vbignb3BlbicsIHRoaXMub25GaWxlT3Blbik7XG4gIHRoaXMuZmlsZS5vbignY2hhbmdlJywgdGhpcy5vbkZpbGVDaGFuZ2UpO1xuICB0aGlzLmZpbGUub24oJ2JlZm9yZSBjaGFuZ2UnLCB0aGlzLm9uQmVmb3JlRmlsZUNoYW5nZSk7XG4gIHRoaXMuaGlzdG9yeS5vbignY2hhbmdlJywgdGhpcy5vbkhpc3RvcnlDaGFuZ2UpO1xuICB0aGlzLmlucHV0Lm9uKCdibHVyJywgdGhpcy5vbkJsdXIpO1xuICB0aGlzLmlucHV0Lm9uKCdmb2N1cycsIHRoaXMub25Gb2N1cyk7XG4gIHRoaXMuaW5wdXQub24oJ2lucHV0JywgdGhpcy5vbklucHV0KTtcbiAgdGhpcy5pbnB1dC5vbigndGV4dCcsIHRoaXMub25UZXh0KTtcbiAgdGhpcy5pbnB1dC5vbigna2V5cycsIHRoaXMub25LZXlzKTtcbiAgdGhpcy5pbnB1dC5vbigna2V5JywgdGhpcy5vbktleSk7XG4gIHRoaXMuaW5wdXQub24oJ2N1dCcsIHRoaXMub25DdXQpO1xuICB0aGlzLmlucHV0Lm9uKCdjb3B5JywgdGhpcy5vbkNvcHkpO1xuICB0aGlzLmlucHV0Lm9uKCdwYXN0ZScsIHRoaXMub25QYXN0ZSk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNldXAnLCB0aGlzLm9uTW91c2VVcCk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWNsaWNrJywgdGhpcy5vbk1vdXNlQ2xpY2spO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWdiZWdpbicsIHRoaXMub25Nb3VzZURyYWdCZWdpbik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZycsIHRoaXMub25Nb3VzZURyYWcpO1xuICB0aGlzLmZpbmQub24oJ3N1Ym1pdCcsIHRoaXMuZmluZEp1bXAuYmluZCh0aGlzLCAxKSk7XG4gIHRoaXMuZmluZC5vbigndmFsdWUnLCB0aGlzLm9uRmluZFZhbHVlKTtcbiAgdGhpcy5maW5kLm9uKCdrZXknLCB0aGlzLm9uRmluZEtleSk7XG4gIHRoaXMuZmluZC5vbignb3BlbicsIHRoaXMub25GaW5kT3Blbik7XG4gIHRoaXMuZmluZC5vbignY2xvc2UnLCB0aGlzLm9uRmluZENsb3NlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uU2Nyb2xsID0gZnVuY3Rpb24oc2Nyb2xsKSB7XG4gIHRoaXMuc2Nyb2xsLnNldChzY3JvbGwpO1xuICB0aGlzLnJlbmRlcignY29kZScpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xuICB0aGlzLnJlbmRlcignZmluZCcpO1xuICB0aGlzLnJlbmRlcigncm93cycpO1xuICB0aGlzLnJlc3QoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlc3QgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG59LCA2MDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikge1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIHRoaXMuY2FyZXRTb2xpZCgpO1xuICB0aGlzLnJlc3QoKTtcblxuICB0aGlzLnJlbmRlcignY2FyZXQnKTtcbiAgdGhpcy5yZW5kZXIoJ2Jsb2NrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRm9jdXMgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSB0cnVlO1xuICB0aGlzLmVtaXQoJ2ZvY3VzJyk7XG4gIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG4gIHRoaXMuY2FyZXRTb2xpZCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuY2FyZXRTb2xpZCA9IGZ1bmN0aW9uKCkge1xuICBkb20uY2xhc3Nlcyh0aGlzLnZpZXdzLmNhcmV0LCBbY3NzLmNhcmV0XSk7XG4gIHRoaXMuY2FyZXRCbGluaygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuY2FyZXRCbGluayA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICBkb20uY2xhc3Nlcyh0aGlzLnZpZXdzLmNhcmV0LCBbY3NzLmNhcmV0LCBjc3NbJ2JsaW5rLXNtb290aCddXSk7XG59LCA0MDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbkJsdXIgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSBmYWxzZTtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB7XG4gICAgICBkb20uY2xhc3Nlcyh0aGlzLnZpZXdzLmNhcmV0LCBbY3NzLmNhcmV0XSk7XG4gICAgICB0aGlzLmVtaXQoJ2JsdXInKTtcbiAgICAgIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG4gICAgfVxuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSW5wdXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIC8vXG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuc3VnZ2VzdFJvb3QgPSAnJztcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleXMgPSBmdW5jdGlvbihrZXlzLCBlKSB7XG4gIGlmIChrZXlzIGluIHRoaXMuYmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleXMgaW4gRGVmYXVsdEJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleSA9IGZ1bmN0aW9uKGtleSwgZSkge1xuICBpZiAoa2V5IGluIHRoaXMuYmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXkgaW4gRGVmYXVsdEJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25DdXQgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB0aGlzLm9uQ29weShlKTtcbiAgdGhpcy5kZWxldGUoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQ29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICBlLmNsaXBib2FyZERhdGEuc2V0RGF0YSgndGV4dC9wbGFpbicsIHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25QYXN0ZSA9IGZ1bmN0aW9uKGUpIHtcbiAgdmFyIHRleHQgPSBlLmNsaXBib2FyZERhdGEuZ2V0RGF0YSgndGV4dC9wbGFpbicpO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZU9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tb3ZlLmJlZ2luT2ZGaWxlKCk7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlUmF3ID0gZnVuY3Rpb24ocmF3KSB7XG4gIC8vXG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRUYWJNb2RlID0gZnVuY3Rpb24oY2hhcikge1xuICBpZiAoJ1xcdCcgPT09IGNoYXIpIHtcbiAgICB0aGlzLnRhYiA9IGNoYXI7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy50YWIgPSBuZXcgQXJyYXkodGhpcy50YWJTaXplICsgMSkuam9pbihjaGFyKTtcbiAgfVxufVxuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVTZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldCh7IHg6MCwgeTowIH0pO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25IaXN0b3J5Q2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVuZGVyKCdjb2RlJyk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIHRoaXMucmVuZGVyKCdibG9jaycpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJlZm9yZUZpbGVDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgdGhpcy5lZGl0Q2FyZXRCZWZvcmUgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKGVkaXRSYW5nZSwgZWRpdFNoaWZ0LCB0ZXh0QmVmb3JlLCB0ZXh0QWZ0ZXIpIHtcbiAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gIHRoaXMuZWRpdGluZyA9IHRydWU7XG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcblxuICBpZiAodGhpcy5maW5kLmlzT3Blbikge1xuICAgIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUsIHRydWUpO1xuICB9XG5cbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcblxuICB0aGlzLnZpZXdzLmNvZGUucmVuZGVyRWRpdCh7XG4gICAgbGluZTogZWRpdFJhbmdlWzBdLFxuICAgIHJhbmdlOiBlZGl0UmFuZ2UsXG4gICAgc2hpZnQ6IGVkaXRTaGlmdCxcbiAgICBjYXJldE5vdzogdGhpcy5jYXJldCxcbiAgICBjYXJldEJlZm9yZTogdGhpcy5lZGl0Q2FyZXRCZWZvcmVcbiAgfSk7XG5cbiAgdGhpcy5yZW5kZXIoJ2NhcmV0Jyk7XG4gIHRoaXMucmVuZGVyKCdyb3dzJyk7XG4gIHRoaXMucmVuZGVyKCdtYXJrJyk7XG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG4gIHRoaXMucmVuZGVyKCdydWxlcicpO1xuICB0aGlzLnJlbmRlcignYmxvY2snKTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXRGcm9tUHggPSBmdW5jdGlvbihweCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMubWFyZ2luTGVmdCwgeTogdGhpcy5jaGFyLmhlaWdodC8yIH0pWycrJ10odGhpcy5vZmZzZXQpO1xuICBpZiAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCkgZy55ICs9IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIHwgMDtcbiAgdmFyIHAgPSBweFsnLSddKGcpWycrJ10odGhpcy5zY3JvbGwpWydvLyddKHRoaXMuY2hhcik7XG5cbiAgcC55ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4ocC55LCB0aGlzLmJ1ZmZlci5sb2MoKSkpO1xuICBwLnggPSBNYXRoLm1heCgwLCBwLngpO1xuXG4gIHZhciB0YWJzID0gdGhpcy5nZXRDb29yZHNUYWJzKHApO1xuXG4gIHAueCA9IE1hdGgubWF4KFxuICAgIDAsXG4gICAgTWF0aC5taW4oXG4gICAgICBwLnggLSB0YWJzLnRhYnMgKyB0YWJzLnJlbWFpbmRlcixcbiAgICAgIHRoaXMuZ2V0TGluZUxlbmd0aChwLnkpXG4gICAgKVxuICApO1xuXG4gIHRoaXMuc2V0Q2FyZXQocCk7XG4gIHRoaXMubW92ZS5sYXN0RGVsaWJlcmF0ZVggPSBwLng7XG4gIHRoaXMub25Nb3ZlKCk7XG5cbiAgcmV0dXJuIHA7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlVXAgPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB0aGlzLmJsdXIoKTtcbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRG93biA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KHRoaXMuZm9jdXMuYmluZCh0aGlzKSwgMTApO1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCkgdGhpcy5tYXJrQmVnaW4oKTtcbiAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXQgPSBmdW5jdGlvbihwLCBjZW50ZXIsIGFuaW1hdGUpIHtcbiAgdGhpcy5jYXJldC5zZXQocCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldFBvaW50VGFicyh0aGlzLmNhcmV0KTtcblxuICB0aGlzLmNhcmV0UHguc2V0KHtcbiAgICB4OiB0aGlzLmNoYXIud2lkdGggKiAodGhpcy5jYXJldC54ICsgdGFicy50YWJzICogdGhpcy50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpLFxuICAgIHk6IHRoaXMuY2hhci5oZWlnaHQgKiB0aGlzLmNhcmV0LnlcbiAgfSk7XG5cbiAgdGhpcy5mb2xsb3dDYXJldChjZW50ZXIsIGFuaW1hdGUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZUNsaWNrID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjbGlja3MgPSB0aGlzLmlucHV0Lm1vdXNlLmNsaWNrcztcbiAgaWYgKGNsaWNrcyA+IDEpIHtcbiAgICB2YXIgYXJlYTtcblxuICAgIGlmIChjbGlja3MgPT09IDIpIHtcbiAgICAgIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXJlYUF0UG9pbnQodGhpcy5jYXJldCk7XG4gICAgfSBlbHNlIGlmIChjbGlja3MgPT09IDMpIHtcbiAgICAgIHZhciB5ID0gdGhpcy5jYXJldC55O1xuICAgICAgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgICAgYmVnaW46IHsgeDogMCwgeTogeSB9LFxuICAgICAgICBlbmQ6IHsgeDogdGhpcy5nZXRMaW5lTGVuZ3RoKHkpLCB5OiB5IH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLnNldENhcmV0KGFyZWEuZW5kKTtcbiAgICAgIHRoaXMubWFya1NldEFyZWEoYXJlYSk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgdGhpcy5yZW5kZXIoJ21hcmsnKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcignbWFyaycpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xuICB0aGlzLmNsZWFyKCdtYXJrJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJldHVybiBSYW5nZS5jbGFtcChyYW5nZSwgdGhpcy5wYWdlQm91bmRzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBzID0gdGhpcy5zY3JvbGwuY29weSgpO1xuICBpZiAodGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCkge1xuICAgIHMueSAtPSB0aGlzLnNpemUuaGVpZ2h0IC8gMyB8IDA7XG4gIH1cbiAgdmFyIHAgPSBzWydfLyddKHRoaXMuY2hhcik7XG4gIHJldHVybiB0aGlzLmdldFJhbmdlKFtcbiAgICBNYXRoLmZsb29yKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVswXSksXG4gICAgTWF0aC5jZWlsKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMV0pXG4gIF0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBmdW5jdGlvbihjZW50ZXIsIGFuaW1hdGUpIHtcbiAgdmFyIHAgPSB0aGlzLmNhcmV0UHg7XG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdmFyIHRvcCA9IChcbiAgICAgIHMueVxuICAgICsgKGNlbnRlciAmJiAhdGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/ICh0aGlzLnNpemUuaGVpZ2h0IC8gMiB8IDApIC0gMTAwIDogMClcbiAgKSAtIHAueTtcblxuICB2YXIgYm90dG9tID0gcC55IC0gKFxuICAgICAgcy55XG4gICAgKyB0aGlzLnNpemUuaGVpZ2h0XG4gICAgLSAoY2VudGVyICYmICF0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gKHRoaXMuc2l6ZS5oZWlnaHQgLyAyIHwgMCkgLSAxMDAgOiAwKVxuICAgIC0gKHRoaXMub3B0aW9ucy5jZW50ZXJfdmVydGljYWwgPyAodGhpcy5zaXplLmhlaWdodCAvIDMgKiAyIHwgMCkgOiAwKVxuICApICsgdGhpcy5jaGFyLmhlaWdodDtcblxuICB2YXIgbGVmdCA9IChzLnggKyB0aGlzLmNoYXIud2lkdGgpIC0gcC54O1xuICB2YXIgcmlnaHQgPSAocC54KSAtIChzLnggKyB0aGlzLnNpemUud2lkdGggLSB0aGlzLm1hcmdpbkxlZnQpICsgdGhpcy5jaGFyLndpZHRoICogMjtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICBpZiAobGVmdCArIHRvcCArIHJpZ2h0ICsgYm90dG9tKSB7XG4gICAgdGhpc1thbmltYXRlID8gJ2FuaW1hdGVTY3JvbGxCeScgOiAnc2Nyb2xsQnknXShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCwgJ2Vhc2UnKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsVG8gPSBmdW5jdGlvbihwKSB7XG4gIGRvbS5zY3JvbGxUbyh0aGlzLmVsLCBwLngsIHAueSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgdmFyIHRhcmdldCA9IFBvaW50Lmxvdyh7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH0sIHtcbiAgICB4OiB0aGlzLnNjcm9sbC54ICsgeCxcbiAgICB5OiB0aGlzLnNjcm9sbC55ICsgeVxuICB9KTtcblxuICBpZiAoUG9pbnQuc29ydCh0YXJnZXQsIHRoaXMuc2Nyb2xsKSAhPT0gMCkge1xuICAgIHRoaXMuc2Nyb2xsLnNldCh0YXJnZXQpO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5zY3JvbGwpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRlU2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5LCBhbmltYXRpb25UeXBlKSB7XG4gIHRoaXMuYW5pbWF0aW9uVHlwZSA9IGFuaW1hdGlvblR5cGUgfHwgJ2xpbmVhcic7XG5cbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICBpZiAoJ2xpbmVhcicgPT09IHRoaXMuYW5pbWF0aW9uVHlwZSkge1xuICAgICAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICAgIH1cbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSB0cnVlO1xuICAgIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4pO1xuICB9XG5cbiAgdmFyIHMgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCB8fCB0aGlzLnNjcm9sbDtcblxuICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5tYXgoMCwgcy54ICsgeCksXG4gICAgeTogTWF0aC5taW4oXG4gICAgICAgICh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0XG4gICAgICArICh0aGlzLm9wdGlvbnMuY2VudGVyX3ZlcnRpY2FsID8gdGhpcy5zaXplLmhlaWdodCAvIDMgKiAyIHwgMCA6IDApLFxuICAgICAgTWF0aC5tYXgoMCwgcy55ICsgeSlcbiAgICApXG4gIH0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICBkeCA9IE1hdGguc2lnbihkeCkgKiA1O1xuICBkeSA9IE1hdGguc2lnbihkeSkgKiA1O1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzcGVlZCA9IHRoaXMub3B0aW9ucy5zY3JvbGxfc3BlZWQ7XG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgdmFyIGFkeCA9IE1hdGguYWJzKGR4KTtcbiAgdmFyIGFkeSA9IE1hdGguYWJzKGR5KTtcblxuICBpZiAoYWR5ID49IHRoaXMuc2l6ZS5oZWlnaHQgKiAxLjIpIHtcbiAgICBzcGVlZCAqPSAyLjQ1O1xuICB9XG5cbiAgaWYgKChhZHggPCAxICYmIGFkeSA8IDEpIHx8ICF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0KTtcbiAgICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG51bGw7XG4gICAgdGhpcy5lbWl0KCdhbmltYXRpb24gZW5kJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgc3dpdGNoICh0aGlzLmFuaW1hdGlvblR5cGUpIHtcbiAgICBjYXNlICdsaW5lYXInOlxuICAgICAgaWYgKGFkeCA8IHNwZWVkKSBkeCAqPSAwLjk7XG4gICAgICBlbHNlIGR4ID0gTWF0aC5zaWduKGR4KSAqIHNwZWVkO1xuXG4gICAgICBpZiAoYWR5IDwgc3BlZWQpIGR5ICo9IDAuOTtcbiAgICAgIGVsc2UgZHkgPSBNYXRoLnNpZ24oZHkpICogc3BlZWQ7XG5cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2Vhc2UnOlxuICAgICAgZHggKj0gMC41O1xuICAgICAgZHkgKj0gMC41O1xuICAgICAgYnJlYWs7XG4gIH1cblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLmRlbGV0ZSgpO1xuXG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQodGhpcy5jYXJldC55KTtcbiAgdmFyIHJpZ2h0ID0gbGluZVt0aGlzLmNhcmV0LnhdO1xuICB2YXIgaGFzUmlnaHRTeW1ib2wgPSB+Wyd9JywnXScsJyknXS5pbmRleE9mKHJpZ2h0KTtcblxuICAvLyBhcHBseSBpbmRlbnQgb24gZW50ZXJcbiAgaWYgKE5FV0xJTkUudGVzdCh0ZXh0KSkge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IHRoaXMuY2FyZXQueCA9PT0gbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBsZWZ0ID0gbGluZVt0aGlzLmNhcmV0LnggLSAxXTtcbiAgICB2YXIgaW5kZW50ID0gbGluZS5tYXRjaCgvXFxTLyk7XG4gICAgaW5kZW50ID0gaW5kZW50ID8gaW5kZW50LmluZGV4IDogbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBoYXNMZWZ0U3ltYm9sID0gflsneycsJ1snLCcoJ10uaW5kZXhPZihsZWZ0KTtcblxuICAgIGlmIChoYXNMZWZ0U3ltYm9sKSBpbmRlbnQgKz0gMjtcblxuICAgIGlmIChpc0VuZE9mTGluZSB8fCBoYXNMZWZ0U3ltYm9sKSB7XG4gICAgICB0ZXh0ICs9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJyk7XG4gICAgfVxuICB9XG5cbiAgdmFyIGxlbmd0aDtcblxuICBpZiAoIWhhc1JpZ2h0U3ltYm9sIHx8IChoYXNSaWdodFN5bWJvbCAmJiAhflsnfScsJ10nLCcpJ10uaW5kZXhPZih0ZXh0KSkpIHtcbiAgICBsZW5ndGggPSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgdGV4dCk7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gMTtcbiAgfVxuXG4gIHRoaXMubW92ZS5ieUNoYXJzKGxlbmd0aCwgdHJ1ZSk7XG5cbiAgaWYgKCd7JyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICd9Jyk7XG4gIGVsc2UgaWYgKCcoJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICcpJyk7XG4gIGVsc2UgaWYgKCdbJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICddJyk7XG5cbiAgaWYgKGhhc0xlZnRTeW1ib2wgJiYgaGFzUmlnaHRTeW1ib2wpIHtcbiAgICBpbmRlbnQgLT0gMjtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmFja3NwYWNlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm4gdGhpcy5kZWxldGUoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLmhpc3Rvcnkuc2F2ZSh0cnVlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSwgdHJ1ZSk7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQ2hhckF0UG9pbnQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuIHRoaXMuYmFja3NwYWNlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5oaXN0b3J5LnNhdmUodHJ1ZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQ2hhckF0UG9pbnQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmZpbmRKdW1wID0gZnVuY3Rpb24oanVtcCkge1xuICBpZiAoIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIHx8ICF0aGlzLmZpbmQuaXNPcGVuKSByZXR1cm47XG5cbiAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kTmVlZGxlICsganVtcDtcbiAgaWYgKHRoaXMuZmluZE5lZWRsZSA+PSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IDA7XG4gIH0gZWxzZSBpZiAodGhpcy5maW5kTmVlZGxlIDwgMCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIC0gMTtcbiAgfVxuXG4gIHRoaXMuZmluZC5pbmZvKDEgKyB0aGlzLmZpbmROZWVkbGUgKyAnLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG5cbiAgdmFyIHJlc3VsdCA9IHRoaXMuZmluZFJlc3VsdHNbdGhpcy5maW5kTmVlZGxlXTtcbiAgdGhpcy5zZXRDYXJldChyZXN1bHQsIHRydWUsIHRydWUpO1xuICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5tb3ZlLmJ5Q2hhcnModGhpcy5maW5kVmFsdWUubGVuZ3RoLCB0cnVlKTtcbiAgdGhpcy5tYXJrU2V0KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQodHJ1ZSwgdHJ1ZSk7XG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlLCBub0p1bXApIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLmd1dHRlciwgeTogMCB9KTtcblxuICB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcbiAgdGhpcy5maW5kVmFsdWUgPSB2YWx1ZTtcbiAgdGhpcy5maW5kUmVzdWx0cyA9IHRoaXMuYnVmZmVyLmluZGV4ZXIuZmluZCh2YWx1ZSkubWFwKChvZmZzZXQpID0+IHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0KTtcbiAgfSk7XG5cbiAgaWYgKHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kLmluZm8oMSArIHRoaXMuZmluZE5lZWRsZSArICcvJyArIHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKTtcbiAgfVxuXG4gIGlmICghbm9KdW1wKSB0aGlzLmZpbmRKdW1wKDApO1xuXG4gIHRoaXMucmVuZGVyKCdmaW5kJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRLZXkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICh+WzMzLCAzNCwgMTE0XS5pbmRleE9mKGUud2hpY2gpKSB7IC8vIHBhZ2V1cCwgcGFnZWRvd24sIGYzXG4gICAgdGhpcy5pbnB1dC50ZXh0Lm9ua2V5ZG93bihlKTtcbiAgfVxuXG4gIGlmICg3MCA9PT0gZS53aGljaCAmJiBlLmN0cmxLZXkpIHsgLy8gY3RybCtmXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoOSA9PT0gZS53aGljaCkgeyAvLyB0YWJcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5pbnB1dC5mb2N1cygpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZpbmQuaW5mbygnJyk7XG4gIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kQ2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhcignZmluZCcpO1xuICB0aGlzLmZvY3VzKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zdWdnZXN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQsIHRydWUpO1xuICBpZiAoIWFyZWEpIHJldHVybjtcblxuICB2YXIga2V5ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGlmICgha2V5KSByZXR1cm47XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3RSb290XG4gICAgfHwga2V5LnN1YnN0cigwLCB0aGlzLnN1Z2dlc3RSb290Lmxlbmd0aCkgIT09IHRoaXMuc3VnZ2VzdFJvb3QpIHtcbiAgICB0aGlzLnN1Z2dlc3RJbmRleCA9IDA7XG4gICAgdGhpcy5zdWdnZXN0Um9vdCA9IGtleTtcbiAgICB0aGlzLnN1Z2dlc3ROb2RlcyA9IHRoaXMuYnVmZmVyLnByZWZpeC5jb2xsZWN0KGtleSk7XG4gIH1cblxuICBpZiAoIXRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aCkgcmV0dXJuO1xuICB2YXIgbm9kZSA9IHRoaXMuc3VnZ2VzdE5vZGVzW3RoaXMuc3VnZ2VzdEluZGV4XTtcblxuICB0aGlzLnN1Z2dlc3RJbmRleCA9ICh0aGlzLnN1Z2dlc3RJbmRleCArIDEpICUgdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoO1xuXG4gIHJldHVybiB7XG4gICAgYXJlYTogYXJlYSxcbiAgICBub2RlOiBub2RlXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQb2ludFRhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYiA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXIgKyB0YWJzXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRDb29yZHNUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWJzICogdGhpcy50YWJTaXplICsgcmVtYWluZGVyID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlclxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVwYWludCA9IGJpbmRSYWYoZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVzaXplKCk7XG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG59KTtcblxuSmF6ei5wcm90b3R5cGUucmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHZhciAkID0gdGhpcy5lbDtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAuJHtjc3Mucm93c30sXG4gICAgLiR7Y3NzLm1hcmt9LFxuICAgIC4ke2Nzcy5jb2RlfSxcbiAgICBtYXJrLFxuICAgIHAsXG4gICAgdCxcbiAgICBrLFxuICAgIGQsXG4gICAgbixcbiAgICBvLFxuICAgIGUsXG4gICAgbSxcbiAgICBmLFxuICAgIHIsXG4gICAgYyxcbiAgICBzLFxuICAgIGwsXG4gICAgeCB7XG4gICAgICBmb250LWZhbWlseTogbW9ub3NwYWNlO1xuICAgICAgZm9udC1zaXplOiAke3RoaXMub3B0aW9ucy5mb250X3NpemV9O1xuICAgICAgbGluZS1oZWlnaHQ6ICR7dGhpcy5vcHRpb25zLmxpbmVfaGVpZ2h0fTtcbiAgICB9XG4gICAgYFxuICApO1xuXG4gIHRoaXMub2Zmc2V0LnNldChkb20uZ2V0T2Zmc2V0KCQpKTtcbiAgdGhpcy5zY3JvbGwuc2V0KGRvbS5nZXRTY3JvbGwoJCkpO1xuICB0aGlzLnNpemUuc2V0KGRvbS5nZXRTaXplKCQpKTtcblxuICAvLyB0aGlzIGlzIGEgd2VpcmQgZml4IHdoZW4gZG9pbmcgbXVsdGlwbGUgLnVzZSgpXG4gIGlmICh0aGlzLmNoYXIud2lkdGggPT09IDApIHRoaXMuY2hhci5zZXQoZG9tLmdldENoYXJTaXplKCQsIGNzcy5jb2RlKSk7XG5cbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMuY29kZSA9IHRoaXMuYnVmZmVyLnRleHQubGVuZ3RoO1xuICB0aGlzLnBhZ2Uuc2V0KHRoaXMuc2l6ZVsnXi8nXSh0aGlzLmNoYXIpKTtcbiAgdGhpcy5wYWdlUmVtYWluZGVyLnNldCh0aGlzLnNpemVbJy0nXSh0aGlzLnBhZ2VbJ18qJ10odGhpcy5jaGFyKSkpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcbiAgLy8gdGhpcy5sb25nZXN0TGluZSA9IE1hdGgubWluKDUwMCwgdGhpcy5idWZmZXIubGluZXMuZ2V0TG9uZ2VzdExpbmVMZW5ndGgoKSk7XG5cbiAgdGhpcy5ndXR0ZXIgPSBNYXRoLm1heChcbiAgICB0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aCxcbiAgICAodGhpcy5vcHRpb25zLmNlbnRlcl9ob3Jpem9udGFsXG4gICAgICA/IE1hdGgubWF4KFxuICAgICAgICAgICgnJyt0aGlzLnJvd3MpLmxlbmd0aCxcbiAgICAgICAgICAoIHRoaXMucGFnZS53aWR0aCAtIDgxXG4gICAgICAgICAgLSAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiAoJycrdGhpcy5yb3dzKS5sZW5ndGgpXG4gICAgICAgICAgKSAvIDIgfCAwXG4gICAgICAgICkgOiAwKVxuICAgICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogTWF0aC5tYXgoMywgKCcnK3RoaXMucm93cykubGVuZ3RoKSlcbiAgKSAqIHRoaXMuY2hhci53aWR0aFxuICArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzXG4gICAgICA/IDBcbiAgICAgIDogdGhpcy5vcHRpb25zLmd1dHRlcl9tYXJnaW4gKiAodGhpcy5vcHRpb25zLmNlbnRlcl9ob3Jpem9udGFsID8gLTEgOiAxKVxuICAgICk7XG5cbiAgdGhpcy5tYXJnaW5MZWZ0ID0gdGhpcy5ndXR0ZXIgKyB0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjJyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSB7XG4gICAgICB0b3A6ICR7dGhpcy5vcHRpb25zLmNlbnRlcl92ZXJ0aWNhbCA/IHRoaXMuc2l6ZS5oZWlnaHQgLyAzIDogMH1weDtcbiAgICB9XG5cbiAgICAuJHtjc3Mucm93c30sXG4gICAgLiR7Y3NzLm1hcmt9LFxuICAgIC4ke2Nzcy5jb2RlfSxcbiAgICBtYXJrLFxuICAgIHAsXG4gICAgdCxcbiAgICBrLFxuICAgIGQsXG4gICAgbixcbiAgICBvLFxuICAgIGUsXG4gICAgbSxcbiAgICBmLFxuICAgIHIsXG4gICAgYyxcbiAgICBzLFxuICAgIGwsXG4gICAgeCB7XG4gICAgICBmb250LWZhbWlseTogbW9ub3NwYWNlO1xuICAgICAgZm9udC1zaXplOiAke3RoaXMub3B0aW9ucy5mb250X3NpemV9O1xuICAgICAgbGluZS1oZWlnaHQ6ICR7dGhpcy5vcHRpb25zLmxpbmVfaGVpZ2h0fTtcbiAgICB9XG5cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ydWxlcn0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuZmluZH0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubWFya30sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MuY29kZX0ge1xuICAgICAgbWFyZ2luLWxlZnQ6ICR7dGhpcy5tYXJnaW5MZWZ0fXB4O1xuICAgICAgdGFiLXNpemU6ICR7dGhpcy50YWJTaXplfTtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3Mucm93c30ge1xuICAgICAgcGFkZGluZy1yaWdodDogJHt0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbn1weDtcbiAgICAgIHBhZGRpbmctbGVmdDogJHt0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnR9cHg7XG4gICAgICB3aWR0aDogJHt0aGlzLm1hcmdpbkxlZnR9cHg7XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmZpbmR9ID4gaSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ibG9ja30gPiBpIHtcbiAgICAgIGhlaWdodDogJHt0aGlzLmNoYXIuaGVpZ2h0ICsgMX1weDtcbiAgICB9XG4gICAgeCB7XG4gICAgICBiYWNrZ3JvdW5kLWltYWdlOiB1cmwoJHtkYXRhVVJMfSk7XG4gICAgfWBcbiAgKTtcblxuICB0aGlzLmVtaXQoJ3Jlc2l6ZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMudmlld3NbbmFtZV0uY2xlYXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yZW5kZXJSZXF1ZXN0KTtcbiAgaWYgKCF+dGhpcy5yZW5kZXJRdWV1ZS5pbmRleE9mKG5hbWUpKSB7XG4gICAgaWYgKG5hbWUgaW4gdGhpcy52aWV3cykge1xuICAgICAgdGhpcy5yZW5kZXJRdWV1ZS5wdXNoKG5hbWUpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclJlcXVlc3QgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5fcmVuZGVyLmJpbmQodGhpcykpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuX3JlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlbmRlclF1ZXVlLmZvckVhY2gobmFtZSA9PiB0aGlzLnZpZXdzW25hbWVdLnJlbmRlcigpKTtcbiAgdGhpcy5yZW5kZXJRdWV1ZSA9IFtdO1xufTtcblxuLy8gdGhpcyBpcyB1c2VkIGZvciBkZXZlbG9wbWVudCBkZWJ1ZyBwdXJwb3Nlc1xuZnVuY3Rpb24gYmluZENhbGxTaXRlKGZuKSB7XG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgdmFyIGVyciA9IG5ldyBFcnJvcjtcbiAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZShlcnIsIGFyZ3VtZW50cy5jYWxsZWUpO1xuICAgIHZhciBzdGFjayA9IGVyci5zdGFjaztcbiAgICBjb25zb2xlLmxvZyhzdGFjayk7XG4gICAgZm4uY2FsbCh0aGlzLCBhLCBiLCBjLCBkKTtcbiAgfTtcbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBBcmVhO1xuXG5mdW5jdGlvbiBBcmVhKGEpIHtcbiAgaWYgKGEpIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50KGEuYmVnaW4pO1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50KGEuZW5kKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50O1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50O1xuICB9XG59XG5cbkFyZWEucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHRoaXMpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzID0gW3RoaXMuYmVnaW4sIHRoaXMuZW5kXS5zb3J0KFBvaW50LnNvcnQpO1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoc1swXSksXG4gICAgZW5kOiBuZXcgUG9pbnQoc1sxXSlcbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMuYmVnaW4uc2V0KGFyZWEuYmVnaW4pO1xuICB0aGlzLmVuZC5zZXQoYXJlYS5lbmQpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0TGVmdCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy5iZWdpbi54ID0geDtcbiAgdGhpcy5lbmQueCA9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIGlmICh0aGlzLmJlZ2luLngpIHRoaXMuYmVnaW4ueCArPSB4O1xuICBpZiAodGhpcy5lbmQueCkgdGhpcy5lbmQueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZEJvdHRvbSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5lbmQueSArPSB5O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLnNoaWZ0QnlMaW5lcyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5iZWdpbi55ICs9IHk7XG4gIHRoaXMuZW5kLnkgKz0geTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+IGEuZW5kLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj0nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5iZWdpbi54ID49IGEuYmVnaW4ueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzwnXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5lbmQueCA8IGEuYmVnaW4ueFxuICAgIDogdGhpcy5lbmQueSA8IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PSddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuZW5kLnggPD0gYS5lbmQueFxuICAgIDogdGhpcy5lbmQueSA8IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPjwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+J10oYSkgJiYgdGhpc1snPCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzwnXShhKSB8fCB0aGlzWyc+J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj08J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+PSddKGEpICYmIHRoaXNbJzw9J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPD0nXShhKSB8fCB0aGlzWyc+PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz09PSddID1cbkFyZWEucHJvdG90eXBlLmVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi54ID09PSBhLmJlZ2luLnggJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICAgICYmIHRoaXMuZW5kLnggICA9PT0gYS5lbmQueCAgICYmIHRoaXMuZW5kLnkgICA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PSddID1cbkFyZWEucHJvdG90eXBlLmJlZ2luTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXwnXSA9XG5BcmVhLnByb3RvdHlwZS5lbmRMaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9fCddID1cbkFyZWEucHJvdG90eXBlLmxpbmVzRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyd8PSddKGEpICYmIHRoaXNbJz18J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXw9J10gPVxuQXJlYS5wcm90b3R5cGUuc2FtZUxpbmUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IHRoaXMuZW5kLnkgJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnLXgtJ10gPVxuQXJlYS5wcm90b3R5cGUuc2hvcnRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54ICsgeCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54IC0geCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJyt4KyddID1cbkFyZWEucHJvdG90eXBlLndpZGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggLSB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggKyB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0KGIuYmVnaW4sIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0KGIuZW5kLCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WCh4LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFgoeCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFkgPSBmdW5jdGlvbih5LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFkoeSwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRZKHksIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiAnJyArIGEuYmVnaW4gKyAnLScgKyBhLmVuZDtcbn07XG5cbkFyZWEuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA9PT0gYi5iZWdpbi55XG4gICAgPyBhLmJlZ2luLnggLSBiLmJlZ2luLnhcbiAgICA6IGEuYmVnaW4ueSAtIGIuYmVnaW4ueTtcbn07XG5cbkFyZWEudG9Qb2ludFNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPD0gYi55ICYmIGEuZW5kLnkgPj0gYi55XG4gICAgPyBhLmJlZ2luLnkgPT09IGIueVxuICAgICAgPyBhLmJlZ2luLnggLSBiLnhcbiAgICAgIDogYS5lbmQueSA9PT0gYi55XG4gICAgICAgID8gYS5lbmQueCAtIGIueFxuICAgICAgICA6IDBcbiAgICA6IGEuYmVnaW4ueSAtIGIueTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gYmluYXJ5U2VhcmNoO1xuXG5mdW5jdGlvbiBiaW5hcnlTZWFyY2goYXJyYXksIGNvbXBhcmUpIHtcbiAgdmFyIGluZGV4ID0gLTE7XG4gIHZhciBwcmV2ID0gLTE7XG4gIHZhciBsb3cgPSAwO1xuICB2YXIgaGlnaCA9IGFycmF5Lmxlbmd0aDtcbiAgaWYgKCFoaWdoKSByZXR1cm4ge1xuICAgIGl0ZW06IG51bGwsXG4gICAgaW5kZXg6IDBcbiAgfTtcblxuICBkbyB7XG4gICAgcHJldiA9IGluZGV4O1xuICAgIGluZGV4ID0gbG93ICsgKGhpZ2ggLSBsb3cgPj4gMSk7XG4gICAgdmFyIGl0ZW0gPSBhcnJheVtpbmRleF07XG4gICAgdmFyIHJlc3VsdCA9IGNvbXBhcmUoaXRlbSk7XG5cbiAgICBpZiAocmVzdWx0KSBsb3cgPSBpbmRleDtcbiAgICBlbHNlIGhpZ2ggPSBpbmRleDtcbiAgfSB3aGlsZSAocHJldiAhPT0gaW5kZXgpO1xuXG4gIGlmIChpdGVtICE9IG51bGwpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXRlbTogaXRlbSxcbiAgICAgIGluZGV4OiBpbmRleFxuICAgIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGl0ZW06IG51bGwsXG4gICAgaW5kZXg6IH5sb3cgKiAtMSAtIDFcbiAgfTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4pIHtcbiAgdmFyIHJlcXVlc3Q7XG4gIHJldHVybiBmdW5jdGlvbiByYWZXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUocmVxdWVzdCk7XG4gICAgcmVxdWVzdCA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSk7XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEJveDtcblxuZnVuY3Rpb24gQm94KGIpIHtcbiAgaWYgKGIpIHtcbiAgICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xuICB9IGVsc2Uge1xuICAgIHRoaXMud2lkdGggPSAwO1xuICAgIHRoaXMuaGVpZ2h0ID0gMDtcbiAgfVxufVxuXG5Cb3gucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGIpIHtcbiAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG59O1xuXG5Cb3gucHJvdG90eXBlWycvJ10gPVxuQm94LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18vJ10gPVxuQm94LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeLyddID1cbkJveC5wcm90b3R5cGUuY2VpbGRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXionXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ28qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5yb3VuZCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGgucm91bmQodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnLSddID1cbkJveC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLSAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAtIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNsb25lKG9iaikge1xuICB2YXIgbyA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgdmFyIHZhbCA9IG9ialtrZXldO1xuICAgIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIHZhbCkge1xuICAgICAgb1trZXldID0gY2xvbmUodmFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb1trZXldID0gdmFsO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbiBkZWJvdW5jZVdyYXAoYSwgYiwgYywgZCkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICB0aW1lb3V0ID0gc2V0VGltZW91dChmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpLCBtcyk7XG4gICAgcmV0dXJuIHRpbWVvdXQ7XG4gIH1cbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vZG9tJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9ldmVudCcpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlhbG9nO1xuXG5mdW5jdGlvbiBEaWFsb2cobGFiZWwsIGtleW1hcCkge1xuICB0aGlzLm5vZGUgPSBkb20oY3NzLmRpYWxvZywgW1xuICAgIGA8bGFiZWw+JHtjc3MubGFiZWx9YCxcbiAgICBbY3NzLmlucHV0LCBbXG4gICAgICBgPGlucHV0PiR7Y3NzLnRleHR9YCxcbiAgICAgIGNzcy5pbmZvXG4gICAgXV1cbiAgXSk7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MubGFiZWxdLCBsYWJlbCk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogJ25vbmUnIH0pO1xuICB0aGlzLmtleW1hcCA9IGtleW1hcDtcbiAgdGhpcy5vbmJvZHlrZXlkb3duID0gdGhpcy5vbmJvZHlrZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmNsaWNrID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNldXAgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2Vkb3duID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xufVxuXG5EaWFsb2cucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuZnVuY3Rpb24gc3RvcFByb3BhZ2F0aW9uKGUpIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaGFzRm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLmhhc0ZvY3VzKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uYm9keWtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgyNyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDEzID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuc3VibWl0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChlLndoaWNoIGluIHRoaXMua2V5bWFwKSB7XG4gICAgdGhpcy5lbWl0KCdrZXknLCBlKTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3ZhbHVlJywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICBkb20uYXBwZW5kKGRvY3VtZW50LmJvZHksIHRoaXMubm9kZSk7XG4gIGRvbS5mb2N1cyh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0pO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwuc2VsZWN0KCk7XG4gIHRoaXMuaXNPcGVuID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdvcGVuJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIHRoaXMubm9kZS5lbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMubm9kZS5lbCk7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG4gIHRoaXMuZW1pdCgnY2xvc2UnKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuc3VibWl0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZW1pdCgnc3VibWl0JywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaW5mbyA9IGZ1bmN0aW9uKGluZm8pIHtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCBpbmZvKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiBpbmZvID8gJ2Jsb2NrJyA6ICdub25lJyB9KTtcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImRpYWxvZ1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2RpYWxvZ1wiLFwiaW5wdXRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbnB1dFwiLFwidGV4dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX3RleHRcIixcImxhYmVsXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fbGFiZWxcIixcImluZm9cIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbmZvXCJ9IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG5cbmZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBhKSB7XG4gICAgdmFyIGQgPSB7fTtcbiAgICB2YXIgaSA9IDA7XG4gICAgZm9yICh2YXIgayBpbiBiKSB7XG4gICAgICBpZiAoYVtrXSAhPT0gYltrXSkge1xuICAgICAgICBkW2tdID0gYltrXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaSkgcmV0dXJuIGQ7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGEgIT09IGI7XG4gIH1cbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9iaW5kLXJhZicpO1xudmFyIG1lbW9pemUgPSByZXF1aXJlKCcuL21lbW9pemUnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxudmFyIHVuaXRzID0ge1xuICBsZWZ0OiAncHgnLFxuICB0b3A6ICdweCcsXG4gIHJpZ2h0OiAncHgnLFxuICBib3R0b206ICdweCcsXG4gIHdpZHRoOiAncHgnLFxuICBoZWlnaHQ6ICdweCcsXG4gIG1heEhlaWdodDogJ3B4JyxcbiAgcGFkZGluZ0xlZnQ6ICdweCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRvbTtcblxuZnVuY3Rpb24gZG9tKG5hbWUsIGNoaWxkcmVuLCBhdHRycykge1xuICB2YXIgZWw7XG4gIHZhciB0YWcgPSAnZGl2JztcbiAgdmFyIG5vZGU7XG5cbiAgaWYgKCdzdHJpbmcnID09PSB0eXBlb2YgbmFtZSkge1xuICAgIGlmICgnPCcgPT09IG5hbWUuY2hhckF0KDApKSB7XG4gICAgICB2YXIgbWF0Y2hlcyA9IG5hbWUubWF0Y2goLyg/OjwpKC4qKSg/Oj4pKFxcUyspPy8pO1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGFnID0gbWF0Y2hlc1sxXTtcbiAgICAgICAgbmFtZSA9IG1hdGNoZXNbMl0gfHwgdGFnO1xuICAgICAgfVxuICAgIH1cbiAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgICBub2RlID0ge1xuICAgICAgZWw6IGVsLFxuICAgICAgbmFtZTogbmFtZS5zcGxpdCgnICcpWzBdXG4gICAgfTtcbiAgICBkb20uY2xhc3Nlcyhub2RlLCBuYW1lLnNwbGl0KCcgJykuc2xpY2UoMSkpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICByZXR1cm4gZG9tLmFwcGx5KG51bGwsIG5hbWUpO1xuICB9IGVsc2Uge1xuICAgIGlmICgnZG9tJyBpbiBuYW1lKSB7XG4gICAgICBub2RlID0gbmFtZS5kb207XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUgPSBuYW1lO1xuICAgIH1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGNoaWxkcmVuKSkge1xuICAgIGNoaWxkcmVuXG4gICAgICAubWFwKGRvbSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQsIGkpIHtcbiAgICAgICAgbm9kZVtjaGlsZC5uYW1lXSA9IGNoaWxkO1xuICAgICAgICByZXR1cm4gY2hpbGQ7XG4gICAgICB9KVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCkge1xuICAgICAgICBub2RlLmVsLmFwcGVuZENoaWxkKGNoaWxkLmVsKTtcbiAgICAgIH0pO1xuICB9IGVsc2UgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgY2hpbGRyZW4pIHtcbiAgICBkb20uc3R5bGUobm9kZSwgY2hpbGRyZW4pO1xuICB9XG5cbiAgaWYgKGF0dHJzKSB7XG4gICAgZG9tLmF0dHJzKG5vZGUsIGF0dHJzKTtcbiAgfVxuXG4gIHJldHVybiBub2RlO1xufVxuXG5kb20uc3R5bGUgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBfLCBzdHlsZSkge1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgaWYgKHN0eWxlW25hbWVdICE9PSAnYXV0bycpXG4gICAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59LCBkaWZmLCBtZXJnZSwgZnVuY3Rpb24obm9kZSwgc3R5bGUpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIHN0eWxlXTtcbn0pO1xuXG4vKlxuZG9tLnN0eWxlID0gZnVuY3Rpb24oZWwsIHN0eWxlKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn07XG4qL1xuZG9tLmNsYXNzZXMgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xufSwgbnVsbCwgbnVsbCwgZnVuY3Rpb24obm9kZSwgY2xhc3Nlcykge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgY2xhc3Nlcy5jb25jYXQobm9kZS5uYW1lKS5maWx0ZXIoQm9vbGVhbikuam9pbignICcpXTtcbn0pO1xuXG5kb20uYXR0cnMgPSBmdW5jdGlvbihlbCwgYXR0cnMpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIE9iamVjdC5hc3NpZ24oZWwsIGF0dHJzKTtcbn07XG5cbmRvbS5odG1sID0gZnVuY3Rpb24oZWwsIGh0bWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XG59O1xuXG5kb20udGV4dCA9IGZ1bmN0aW9uKGVsLCB0ZXh0KSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC50ZXh0Q29udGVudCA9IHRleHQ7XG59O1xuXG5kb20uZm9jdXMgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuZm9jdXMoKTtcbn07XG5cbmRvbS5nZXRTaXplID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiB7XG4gICAgd2lkdGg6IGVsLmNsaWVudFdpZHRoLFxuICAgIGhlaWdodDogZWwuY2xpZW50SGVpZ2h0XG4gIH07XG59O1xuXG5kb20uZ2V0Q2hhclNpemUgPSBmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgc3Bhbi5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG5cbiAgZWwuYXBwZW5kQ2hpbGQoc3Bhbik7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICc7XG4gIHZhciBhID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgIFxcbiAnO1xuICB2YXIgYiA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgZWwucmVtb3ZlQ2hpbGQoc3Bhbik7XG5cbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogKGIud2lkdGggLSBhLndpZHRoKSxcbiAgICBoZWlnaHQ6IChiLmhlaWdodCAtIGEuaGVpZ2h0KVxuICB9O1xufTtcblxuZG9tLmdldE9mZnNldCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB2YXIgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCk7XG4gIHZhciBib3JkZXJMZWZ0ID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyTGVmdFdpZHRoKTtcbiAgdmFyIGJvcmRlclRvcCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlclRvcFdpZHRoKTtcbiAgcmV0dXJuIFBvaW50Lmxvdyh7IHg6IDAsIHk6IDAgfSwge1xuICAgIHg6IChyZWN0LmxlZnQgKyBib3JkZXJMZWZ0KSB8IDAsXG4gICAgeTogKHJlY3QudG9wICsgYm9yZGVyVG9wKSB8IDBcbiAgfSk7XG59O1xuXG5kb20uZ2V0U2Nyb2xsID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiBnZXRTY3JvbGwoZWwpO1xufTtcblxuZG9tLm9uc2Nyb2xsID0gZnVuY3Rpb24gb25zY3JvbGwoZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuXG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9IGVsc2Uge1xuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlcihldikge1xuICAgIGZuKGdldFNjcm9sbChlbCkpO1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9mZnNjcm9sbCgpIHtcbiAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxufTtcblxuZG9tLm9ub2Zmc2V0ID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB3aGlsZSAoZWwgPSBlbC5vZmZzZXRQYXJlbnQpIHtcbiAgICBkb20ub25zY3JvbGwoZWwsIGZuKTtcbiAgfVxufTtcblxuZG9tLm9uY2xpY2sgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgcmV0dXJuIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZm4pO1xufTtcblxuZG9tLm9ucmVzaXplID0gZnVuY3Rpb24oZm4pIHtcbiAgcmV0dXJuIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG59O1xuXG5kb20uYXBwZW5kID0gZnVuY3Rpb24odGFyZ2V0LCBzcmMsIGRpY3QpIHtcbiAgdGFyZ2V0ID0gZG9tLmdldEVsZW1lbnQodGFyZ2V0KTtcbiAgaWYgKCdmb3JFYWNoJyBpbiBzcmMpIHNyYy5mb3JFYWNoKGRvbS5hcHBlbmQuYmluZChudWxsLCB0YXJnZXQpKTtcbiAgLy8gZWxzZSBpZiAoJ3ZpZXdzJyBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmMudmlld3MsIHRydWUpO1xuICBlbHNlIGlmIChkaWN0ID09PSB0cnVlKSBmb3IgKHZhciBrZXkgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjW2tleV0pO1xuICBlbHNlIGlmICgnZnVuY3Rpb24nICE9IHR5cGVvZiBzcmMpIHRhcmdldC5hcHBlbmRDaGlsZChkb20uZ2V0RWxlbWVudChzcmMpKTtcbn07XG5cbmRvbS5yZW1vdmUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgaWYgKGVsLnBhcmVudE5vZGUpIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpO1xufTtcblxuZG9tLmdldEVsZW1lbnQgPSBmdW5jdGlvbihlbCkge1xuICByZXR1cm4gZWwuZG9tICYmIGVsLmRvbS5lbCB8fCBlbC5lbCB8fCBlbC5ub2RlIHx8IGVsO1xufTtcblxuZG9tLnNjcm9sbEJ5ID0gZnVuY3Rpb24oZWwsIHgsIHksIHNjcm9sbCkge1xuICBzY3JvbGwgPSBzY3JvbGwgfHwgZG9tLmdldFNjcm9sbChlbCk7XG4gIGRvbS5zY3JvbGxUbyhlbCwgc2Nyb2xsLnggKyB4LCBzY3JvbGwueSArIHkpO1xufTtcblxuZG9tLnNjcm9sbFRvID0gZnVuY3Rpb24oZWwsIHgsIHkpIHtcbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgd2luZG93LnNjcm9sbFRvKHgsIHkpO1xuICB9IGVsc2Uge1xuICAgIGVsLnNjcm9sbExlZnQgPSB4IHx8IDA7XG4gICAgZWwuc2Nyb2xsVG9wID0geSB8fCAwO1xuICB9XG59O1xuXG5kb20uY3NzID0gZnVuY3Rpb24oaWQsIGNzc1RleHQpIHtcbiAgaWYgKCEoaWQgaW4gZG9tLmNzcy5zdHlsZXMpKSB7XG4gICAgZG9tLmNzcy5zdHlsZXNbaWRdID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvbS5jc3Muc3R5bGVzW2lkXSk7XG4gIH1cbiAgZG9tLmNzcy5zdHlsZXNbaWRdLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn07XG5cbmRvbS5jc3Muc3R5bGVzID0ge307XG5cbmRvbS5nZXRNb3VzZVBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcblxuZnVuY3Rpb24gZ2V0U2Nyb2xsKGVsKSB7XG4gIHJldHVybiBkb2N1bWVudC5ib2R5ID09PSBlbFxuICAgID8ge1xuICAgICAgICB4OiB3aW5kb3cuc2Nyb2xsWCB8fCBlbC5zY3JvbGxMZWZ0IHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxMZWZ0LFxuICAgICAgICB5OiB3aW5kb3cuc2Nyb2xsWSB8fCBlbC5zY3JvbGxUb3AgIHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxUb3BcbiAgICAgIH1cbiAgICA6IHtcbiAgICAgICAgeDogZWwuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogZWwuc2Nyb2xsVG9wXG4gICAgICB9O1xufVxuIiwiXG52YXIgcHVzaCA9IFtdLnB1c2g7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxubW9kdWxlLmV4cG9ydHMgPSBFdmVudDtcblxuZnVuY3Rpb24gRXZlbnQoKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBFdmVudCkpIHJldHVybiBuZXcgRXZlbnQ7XG5cbiAgdGhpcy5faGFuZGxlcnMgPSB7fTtcbn1cblxuRXZlbnQucHJvdG90eXBlLl9nZXRIYW5kbGVycyA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdGhpcy5faGFuZGxlcnMgPSB0aGlzLl9oYW5kbGVycyB8fCB7fTtcbiAgcmV0dXJuIHRoaXMuX2hhbmRsZXJzW25hbWVdID0gdGhpcy5faGFuZGxlcnNbbmFtZV0gfHwgW107XG59O1xuXG5FdmVudC5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKG5hbWUsIGEsIGIsIGMsIGQpIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgaGFuZGxlcnMubGVuZ3RoOyBpKyspIHtcbiAgICBoYW5kbGVyc1tpXShhLCBiLCBjLCBkKTtcbiAgfTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGhhbmRsZXJzO1xuICB2YXIgbmV3SGFuZGxlcnMgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgbmFtZS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgICBwdXNoLmFwcGx5KGhhbmRsZXJzLCBuZXdIYW5kbGVyc1tuYW1lXSk7XG4gICAgfSwgdGhpcyk7XG4gIH0gZWxzZSB7XG4gICAgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgICBwdXNoLmFwcGx5KGhhbmRsZXJzLCBuZXdIYW5kbGVycyk7XG4gIH1cbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vZmYgPSBmdW5jdGlvbihuYW1lLCBoYW5kbGVyKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICB2YXIgaW5kZXggPSBoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpO1xuICBpZiAofmluZGV4KSBoYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xufTtcblxuRXZlbnQucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbihuYW1lLCBmbikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgZm4oYSwgYiwgYywgZCk7XG4gICAgaGFuZGxlcnMuc3BsaWNlKGhhbmRsZXJzLmluZGV4T2YoaGFuZGxlciksIDEpO1xuICB9O1xuICBoYW5kbGVycy5wdXNoKGhhbmRsZXIpO1xufTtcbiIsInZhciBjbG9uZSA9IHJlcXVpcmUoJy4vY2xvbmUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZW1vaXplKGZuLCBkaWZmLCBtZXJnZSwgcHJlKSB7XG4gIGRpZmYgPSBkaWZmIHx8IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEgIT09IGIgfTtcbiAgbWVyZ2UgPSBtZXJnZSB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBiIH07XG4gIHByZSA9IHByZSB8fCBmdW5jdGlvbihub2RlLCBwYXJhbSkgeyByZXR1cm4gcGFyYW0gfTtcblxuICB2YXIgbm9kZXMgPSBbXTtcbiAgdmFyIGNhY2hlID0gW107XG4gIHZhciByZXN1bHRzID0gW107XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKG5vZGUsIHBhcmFtKSB7XG4gICAgdmFyIGFyZ3MgPSBwcmUobm9kZSwgcGFyYW0pO1xuICAgIG5vZGUgPSBhcmdzWzBdO1xuICAgIHBhcmFtID0gYXJnc1sxXTtcblxuICAgIHZhciBpbmRleCA9IG5vZGVzLmluZGV4T2Yobm9kZSk7XG4gICAgaWYgKH5pbmRleCkge1xuICAgICAgdmFyIGQgPSBkaWZmKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgaWYgKCFkKSByZXR1cm4gcmVzdWx0c1tpbmRleF07XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2FjaGVbaW5kZXhdID0gbWVyZ2UoY2FjaGVbaW5kZXhdLCBwYXJhbSk7XG4gICAgICAgIHJlc3VsdHNbaW5kZXhdID0gZm4obm9kZSwgcGFyYW0sIGQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjYWNoZS5wdXNoKGNsb25lKHBhcmFtKSk7XG4gICAgICBub2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgaW5kZXggPSByZXN1bHRzLnB1c2goZm4obm9kZSwgcGFyYW0sIHBhcmFtKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZXJnZShkZXN0LCBzcmMpIHtcbiAgZm9yICh2YXIga2V5IGluIHNyYykge1xuICAgIGRlc3Rba2V5XSA9IHNyY1trZXldO1xuICB9XG4gIHJldHVybiBkZXN0O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBvcGVuO1xuXG5mdW5jdGlvbiBvcGVuKHVybCwgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybClcbiAgICAudGhlbihnZXRUZXh0KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cblxuZnVuY3Rpb24gZ2V0VGV4dChyZXMpIHtcbiAgcmV0dXJuIHJlcy50ZXh0KCk7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gUG9pbnQ7XG5cbmZ1bmN0aW9uIFBvaW50KHApIHtcbiAgaWYgKHApIHtcbiAgICB0aGlzLnggPSBwLng7XG4gICAgdGhpcy55ID0gcC55O1xuICB9IGVsc2Uge1xuICAgIHRoaXMueCA9IDA7XG4gICAgdGhpcy55ID0gMDtcbiAgfVxufVxuXG5Qb2ludC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLnggPSBwLng7XG4gIHRoaXMueSA9IHAueTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUG9pbnQodGhpcyk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLyddID1cblBvaW50LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfLyddID1cblBvaW50LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnby8nXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmREaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeLyddID1cblBvaW50LnByb3RvdHlwZS5jZWlsRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJysnXSA9XG5Qb2ludC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICsgKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLSddID1cblBvaW50LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAtIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLSAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycqJ10gPVxuUG9pbnQucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14qJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnbyonXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmRNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfKiddID1cblBvaW50LnByb3RvdHlwZS5mbG9vck11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gJ3g6JyArIHRoaXMueCArICcseTonICsgdGhpcy55O1xufTtcblxuUG9pbnQuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblBvaW50LmdyaWRSb3VuZCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLnJvdW5kKGEueCAvIGIud2lkdGgpLFxuICAgIHk6IE1hdGgucm91bmQoYS55IC8gYi5oZWlnaHQpXG4gIH07XG59O1xuXG5Qb2ludC5sb3cgPSBmdW5jdGlvbihsb3csIHApIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLm1heChsb3cueCwgcC54KSxcbiAgICB5OiBNYXRoLm1heChsb3cueSwgcC55KVxuICB9O1xufTtcblxuUG9pbnQuY2xhbXAgPSBmdW5jdGlvbihhcmVhLCBwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGFyZWEuZW5kLngsIE1hdGgubWF4KGFyZWEuYmVnaW4ueCwgcC54KSksXG4gICAgeTogTWF0aC5taW4oYXJlYS5lbmQueSwgTWF0aC5tYXgoYXJlYS5iZWdpbi55LCBwLnkpKVxuICB9KTtcbn07XG5cblBvaW50Lm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHsgeDogYS54ICsgYi54LCB5OiBhLnkgKyBiLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFggPSBmdW5jdGlvbih4LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCArIHgsIHk6IHAueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIHApIHtcbiAgcmV0dXJuIHsgeDogcC54LCB5OiBwLnkgKyB5IH07XG59O1xuXG5Qb2ludC50b0xlZnRUb3AgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiB7XG4gICAgbGVmdDogcC54LFxuICAgIHRvcDogcC55XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEFORDtcblxuZnVuY3Rpb24gQU5EKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IE5PVDtcblxuZnVuY3Rpb24gTk9UKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsInZhciBBTkQgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtYW5kJyk7XG52YXIgTk9UID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLW5vdCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJhbmdlO1xuXG5mdW5jdGlvbiBSYW5nZShyKSB7XG4gIGlmIChyKSB7XG4gICAgdGhpc1swXSA9IHJbMF07XG4gICAgdGhpc1sxXSA9IHJbMV07XG4gIH0gZWxzZSB7XG4gICAgdGhpc1swXSA9IDA7XG4gICAgdGhpc1sxXSA9IDE7XG4gIH1cbn07XG5cblJhbmdlLkFORCA9IEFORDtcblJhbmdlLk5PVCA9IE5PVDtcblxuUmFuZ2Uuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblJhbmdlLmVxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYVswXSA9PT0gYlswXSAmJiBhWzFdID09PSBiWzFdO1xufTtcblxuUmFuZ2UuY2xhbXAgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UoW1xuICAgIE1hdGgubWluKGJbMV0sIE1hdGgubWF4KGFbMF0sIGJbMF0pKSxcbiAgICBNYXRoLm1pbihhWzFdLCBiWzFdKVxuICBdKTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFJhbmdlKHRoaXMpO1xufTtcblxuUmFuZ2UucmFuZ2VzID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbihpdGVtKSB7IHJldHVybiBpdGVtLnJhbmdlIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdID49IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPD0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm92ZXJsYXAgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA8PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdID49IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMV0gPCByYW5nZVswXSB8fCBpdGVtLnJhbmdlWzBdID4gcmFuZ2VbMV07XG4gIH0pO1xufTtcbiIsIlxudmFyIFJlZ2V4cCA9IGV4cG9ydHM7XG5cblJlZ2V4cC5jcmVhdGUgPSBmdW5jdGlvbihuYW1lcywgZmxhZ3MsIGZuKSB7XG4gIGZuID0gZm4gfHwgZnVuY3Rpb24ocykgeyByZXR1cm4gcyB9O1xuICByZXR1cm4gbmV3IFJlZ0V4cChcbiAgICBuYW1lc1xuICAgIC5tYXAoKG4pID0+ICdzdHJpbmcnID09PSB0eXBlb2YgbiA/IFJlZ2V4cC50eXBlc1tuXSA6IG4pXG4gICAgLm1hcCgocikgPT4gZm4oci50b1N0cmluZygpLnNsaWNlKDEsLTEpKSlcbiAgICAuam9pbignfCcpLFxuICAgIGZsYWdzXG4gICk7XG59O1xuXG5SZWdleHAudHlwZXMgPSB7XG4gICd0b2tlbnMnOiAvLis/XFxifC5cXEJ8XFxiLis/LyxcbiAgJ3dvcmRzJzogL1thLXpBLVowLTldezEsfS8sXG4gICdwYXJ0cyc6IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvLFxuXG4gICdzaW5nbGUgY29tbWVudCc6IC9cXC9cXC8uKj8kLyxcbiAgJ2RvdWJsZSBjb21tZW50JzogL1xcL1xcKlteXSo/XFwqXFwvLyxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiAvKCcoPzooPzpcXFxcXFxufFxcXFwnfFteJ1xcbl0pKSo/JykvLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IC8oXCIoPzooPzpcXFxcXFxufFxcXFxcInxbXlwiXFxuXSkpKj9cIikvLFxuICAndGVtcGxhdGUgc3RyaW5nJzogLyhgKD86KD86XFxcXGB8W15gXSkpKj9gKS8sXG5cbiAgJ29wZXJhdG9yJzogLyF8Pj0/fDw9P3w9ezEsM318KD86Jil7MSwyfXxcXHw/XFx8fFxcP3xcXCp8XFwvfH58XFxefCV8XFwuKD8hXFxkKXxcXCt7MSwyfXxcXC17MSwyfS8sXG4gICdmdW5jdGlvbic6IC8gKCg/IVxcZHxbLiBdKj8oaWZ8ZWxzZXxkb3xmb3J8Y2FzZXx0cnl8Y2F0Y2h8d2hpbGV8d2l0aHxzd2l0Y2gpKVthLXpBLVowLTlfICRdKykoPz1cXCguKlxcKS4qeykvLFxuICAna2V5d29yZCc6IC9cXGIoYnJlYWt8Y2FzZXxjYXRjaHxjb25zdHxjb250aW51ZXxkZWJ1Z2dlcnxkZWZhdWx0fGRlbGV0ZXxkb3xlbHNlfGV4cG9ydHxleHRlbmRzfGZpbmFsbHl8Zm9yfGZyb218aWZ8aW1wbGVtZW50c3xpbXBvcnR8aW58aW5zdGFuY2VvZnxpbnRlcmZhY2V8bGV0fG5ld3xwYWNrYWdlfHByaXZhdGV8cHJvdGVjdGVkfHB1YmxpY3xyZXR1cm58c3RhdGljfHN1cGVyfHN3aXRjaHx0aHJvd3x0cnl8dHlwZW9mfHdoaWxlfHdpdGh8eWllbGQpXFxiLyxcbiAgJ2RlY2xhcmUnOiAvXFxiKGZ1bmN0aW9ufGludGVyZmFjZXxjbGFzc3x2YXJ8bGV0fGNvbnN0fGVudW18dm9pZClcXGIvLFxuICAnYnVpbHRpbic6IC9cXGIoT2JqZWN0fEZ1bmN0aW9ufEJvb2xlYW58RXJyb3J8RXZhbEVycm9yfEludGVybmFsRXJyb3J8UmFuZ2VFcnJvcnxSZWZlcmVuY2VFcnJvcnxTdG9wSXRlcmF0aW9ufFN5bnRheEVycm9yfFR5cGVFcnJvcnxVUklFcnJvcnxOdW1iZXJ8TWF0aHxEYXRlfFN0cmluZ3xSZWdFeHB8QXJyYXl8RmxvYXQzMkFycmF5fEZsb2F0NjRBcnJheXxJbnQxNkFycmF5fEludDMyQXJyYXl8SW50OEFycmF5fFVpbnQxNkFycmF5fFVpbnQzMkFycmF5fFVpbnQ4QXJyYXl8VWludDhDbGFtcGVkQXJyYXl8QXJyYXlCdWZmZXJ8RGF0YVZpZXd8SlNPTnxJbnRsfGFyZ3VtZW50c3xjb25zb2xlfHdpbmRvd3xkb2N1bWVudHxTeW1ib2x8U2V0fE1hcHxXZWFrU2V0fFdlYWtNYXB8UHJveHl8UmVmbGVjdHxQcm9taXNlKVxcYi8sXG4gICdzcGVjaWFsJzogL1xcYih0cnVlfGZhbHNlfG51bGx8dW5kZWZpbmVkKVxcYi8sXG4gICdwYXJhbXMnOiAvZnVuY3Rpb25bIFxcKF17MX1bXl0qP1xcey8sXG4gICdudW1iZXInOiAvLT9cXGIoMHhbXFxkQS1GYS1mXSt8XFxkKlxcLj9cXGQrKFtFZV1bKy1dP1xcZCspP3xOYU58LT9JbmZpbml0eSlcXGIvLFxuICAnc3ltYm9sJzogL1t7fVtcXF0oKSw6XS8sXG4gICdyZWdleHAnOiAvKD8hW15cXC9dKShcXC8oPyFbXFwvfFxcKl0pLio/W15cXFxcXFxeXVxcLykoWztcXG5cXC5cXClcXF1cXH0gZ2ltXSkvLFxuXG4gICd4bWwnOiAvPFtePl0qPi8sXG4gICd1cmwnOiAvKChcXHcrOlxcL1xcLylbLWEtekEtWjAtOTpAOz8mPVxcLyVcXCtcXC5cXCohJ1xcKFxcKSxcXCRfXFx7XFx9XFxeflxcW1xcXWAjfF0rKS8sXG4gICdpbmRlbnQnOiAvXiArfF5cXHQrLyxcbiAgJ2xpbmUnOiAvXi4rJHxeXFxuLyxcbiAgJ25ld2xpbmUnOiAvXFxyXFxufFxccnxcXG4vLFxufTtcblxuUmVnZXhwLnR5cGVzLmNvbW1lbnQgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBjb21tZW50JyxcbiAgJ2RvdWJsZSBjb21tZW50Jyxcbl0pO1xuXG5SZWdleHAudHlwZXMuc3RyaW5nID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbl0pO1xuXG5SZWdleHAudHlwZXMubXVsdGlsaW5lID0gUmVnZXhwLmNyZWF0ZShbXG4gICdkb3VibGUgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuICAnaW5kZW50JyxcbiAgJ2xpbmUnXG5dKTtcblxuUmVnZXhwLnBhcnNlID0gZnVuY3Rpb24ocywgcmVnZXhwLCBmaWx0ZXIpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIGlmIChmaWx0ZXIpIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICBpZiAoZmlsdGVyKHdvcmQpKSB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gc2F2ZTtcblxuZnVuY3Rpb24gc2F2ZSh1cmwsIHNyYywgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBib2R5OiBzcmMsXG4gICAgfSlcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG4iLCIvLyBOb3RlOiBZb3UgcHJvYmFibHkgZG8gbm90IHdhbnQgdG8gdXNlIHRoaXMgaW4gcHJvZHVjdGlvbiBjb2RlLCBhcyBQcm9taXNlIGlzXG4vLyAgIG5vdCBzdXBwb3J0ZWQgYnkgYWxsIGJyb3dzZXJzIHlldC5cblxuKGZ1bmN0aW9uKCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgaWYgKHdpbmRvdy5zZXRJbW1lZGlhdGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwZW5kaW5nID0ge30sXG4gICAgICAgIG5leHRIYW5kbGUgPSAxO1xuXG4gICAgZnVuY3Rpb24gb25SZXNvbHZlKGhhbmRsZSkge1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgICAgIGNhbGxiYWNrLmZuLmFwcGx5KG51bGwsIGNhbGxiYWNrLmFyZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd2luZG93LnNldEltbWVkaWF0ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgICAgIGhhbmRsZTtcblxuICAgICAgICBpZiAodHlwZW9mIGZuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnZhbGlkIGZ1bmN0aW9uXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaGFuZGxlID0gbmV4dEhhbmRsZSsrO1xuICAgICAgICBwZW5kaW5nW2hhbmRsZV0gPSB7IGZuOiBmbiwgYXJnczogYXJncyB9O1xuXG4gICAgICAgIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaGFuZGxlKTtcbiAgICAgICAgfSkudGhlbihvblJlc29sdmUpO1xuXG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcblxuICAgIHdpbmRvdy5jbGVhckltbWVkaWF0ZSA9IGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgIH07XG59KCkpOyIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHJ1bm5pbmcsIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMpIHtcbiAgICBpZiAocnVubmluZykgcmV0dXJuO1xuICAgIHJ1bm5pbmcgPSB0cnVlO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYyk7XG4gICAgc2V0VGltZW91dChyZXNldCwgbXMpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlc2V0KCkge1xuICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgfVxufTtcbiIsInZhciBBcmVhID0gcmVxdWlyZSgnLi4vLi4vbGliL2FyZWEnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xuXG52YXIgU2tpcFN0cmluZyA9IHJlcXVpcmUoJy4vc2tpcHN0cmluZycpO1xudmFyIFByZWZpeFRyZWUgPSByZXF1aXJlKCcuL3ByZWZpeHRyZWUnKTtcbnZhciBTZWdtZW50cyA9IHJlcXVpcmUoJy4vc2VnbWVudHMnKTtcbnZhciBJbmRleGVyID0gcmVxdWlyZSgnLi9pbmRleGVyJyk7XG52YXIgVG9rZW5zID0gcmVxdWlyZSgnLi90b2tlbnMnKTtcbnZhciBTeW50YXggPSByZXF1aXJlKCcuL3N5bnRheCcpO1xuXG52YXIgRU9MID0gL1xcclxcbnxcXHJ8XFxuL2c7XG52YXIgTkVXTElORSA9IC9cXG4vZztcbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd0b2tlbnMnXSwgJ2cnKTtcblxudmFyIFNFR01FTlQgPSB7XG4gICdjb21tZW50JzogJy8qJyxcbiAgJ3N0cmluZyc6ICdgJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQnVmZmVyO1xuXG5mdW5jdGlvbiBCdWZmZXIoKSB7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMuc3ludGF4ID0gbmV3IFN5bnRheDtcbiAgdGhpcy5pbmRleGVyID0gbmV3IEluZGV4ZXIodGhpcyk7XG4gIHRoaXMuc2VnbWVudHMgPSBuZXcgU2VnbWVudHModGhpcyk7XG4gIHRoaXMuc2V0VGV4dCgnJyk7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5CdWZmZXIucHJvdG90eXBlLnVwZGF0ZVJhdyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJhdyA9IHRoaXMudGV4dC50b1N0cmluZygpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudXBkYXRlUmF3KCk7XG4gIHZhciBidWZmZXIgPSBuZXcgQnVmZmVyO1xuICBidWZmZXIucmVwbGFjZSh0aGlzKTtcbiAgcmV0dXJuIGJ1ZmZlcjtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgdGhpcy5yYXcgPSBkYXRhLnJhdztcbiAgdGhpcy50ZXh0LnNldCh0aGlzLnJhdyk7XG4gIHRoaXMudG9rZW5zID0gZGF0YS50b2tlbnMuY29weSgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUoKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2V0VGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB0aGlzLnJhdyA9IHRleHQgLy90aGlzLnN5bnRheC5oaWdobGlnaHQodGV4dCk7XG5cbiAgdGhpcy5zeW50YXgudGFiID0gfnRoaXMucmF3LmluZGV4T2YoJ1xcdCcpID8gJ1xcdCcgOiAnICc7XG5cbiAgdGhpcy50ZXh0ID0gbmV3IFNraXBTdHJpbmc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuXG4gIHRoaXMudG9rZW5zID0gbmV3IFRva2VucztcbiAgdGhpcy50b2tlbnMuaW5kZXgodGhpcy5yYXcpO1xuICB0aGlzLnRva2Vucy5vbignY2hhbmdlIHNlZ21lbnRzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZSBzZWdtZW50cycpKTtcblxuICB0aGlzLnByZWZpeCA9IG5ldyBQcmVmaXhUcmVlO1xuICB0aGlzLnByZWZpeC5pbmRleCh0aGlzLnJhdyk7XG5cbiAgLy8gdGhpcy5lbWl0KCdyYXcnLCB0aGlzLnJhdyk7XG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9XG5CdWZmZXIucHJvdG90eXBlLmluc2VydFRleHRBdFBvaW50ID0gZnVuY3Rpb24ocCwgdGV4dCwgbm9Mb2cpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB2YXIgbGVuZ3RoID0gdGV4dC5sZW5ndGg7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciBzaGlmdCA9ICh0ZXh0Lm1hdGNoKE5FV0xJTkUpIHx8IFtdKS5sZW5ndGg7XG4gIHZhciByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgc2hpZnRdO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuXG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudGV4dC5pbnNlcnQocG9pbnQub2Zmc2V0LCB0ZXh0KTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gdGV4dC5sZW5ndGg7XG4gIHZhciBhZnRlciA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICB0aGlzLnRva2Vucy51cGRhdGUob2Zmc2V0UmFuZ2UsIGFmdGVyLCBsZW5ndGgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUob2Zmc2V0UmFuZ2VbMF0pO1xuXG4gIGlmICghbm9Mb2cpIHtcbiAgICB2YXIgbGFzdExvZyA9IHRoaXMubG9nW3RoaXMubG9nLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0TG9nICYmIGxhc3RMb2dbMF0gPT09ICdpbnNlcnQnICYmIGxhc3RMb2dbMV1bMV0gPT09IHBvaW50Lm9mZnNldCkge1xuICAgICAgbGFzdExvZ1sxXVsxXSArPSB0ZXh0Lmxlbmd0aDtcbiAgICAgIGxhc3RMb2dbMl0gKz0gdGV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2cucHVzaChbJ2luc2VydCcsIFtwb2ludC5vZmZzZXQsIHBvaW50Lm9mZnNldCArIHRleHQubGVuZ3RoXSwgdGV4dF0pO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcblxuICByZXR1cm4gdGV4dC5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZSA9XG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZU9mZnNldFJhbmdlID0gZnVuY3Rpb24obywgbm9Mb2cpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgLy8gY29uc29sZS5sb2coJ29mZnNldHMnLCBvKVxuICB2YXIgYSA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1swXSk7XG4gIHZhciBiID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzFdKTtcbiAgdmFyIGxlbmd0aCA9IG9bMF0gLSBvWzFdO1xuICB2YXIgcmFuZ2UgPSBbYS55LCBiLnldO1xuICB2YXIgc2hpZnQgPSBhLnkgLSBiLnk7XG4gIC8vIGNvbnNvbGUubG9nKGEsYilcblxuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvKTtcbiAgdGhpcy50ZXh0LnJlbW92ZShvKTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gbGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICBpZiAoIW5vTG9nKSB7XG4gICAgdmFyIGxhc3RMb2cgPSB0aGlzLmxvZ1t0aGlzLmxvZy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExvZyAmJiBsYXN0TG9nWzBdID09PSAncmVtb3ZlJyAmJiBsYXN0TG9nWzFdWzBdID09PSBvWzFdKSB7XG4gICAgICBsYXN0TG9nWzFdWzBdIC09IHRleHQubGVuZ3RoO1xuICAgICAgbGFzdExvZ1syXSA9IHRleHQgKyBsYXN0TG9nWzJdO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZy5wdXNoKFsncmVtb3ZlJywgbywgdGV4dF0pO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlQXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0cyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZUNoYXJBdFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSBbcG9pbnQub2Zmc2V0LCBwb2ludC5vZmZzZXQrMV07XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldFJhbmdlKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLmdldExpbmVSYW5nZVRleHQocmFuZ2UpO1xuXG4gIC8vIGNhbGN1bGF0ZSBpbmRlbnQgZm9yIGBjb2RlYFxuICAvL1RPRE86IG1vdmUgdG8gbWV0aG9kXG4gIHZhciBsYXN0ID0gY29kZS5zbGljZShjb2RlLmxhc3RJbmRleE9mKCdcXG4nKSk7XG4gIHZhciBBbnlDaGFyID0gL1xcUy9nO1xuICB2YXIgeSA9IHJhbmdlWzFdO1xuICB2YXIgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMobGFzdCk7XG4gIHdoaWxlICghbWF0Y2ggJiYgeSA8IHRoaXMubG9jKCkpIHtcbiAgICB2YXIgYWZ0ZXIgPSB0aGlzLmdldExpbmVUZXh0KCsreSk7XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGFmdGVyKTtcbiAgfVxuICB2YXIgaW5kZW50ID0gMDtcbiAgaWYgKG1hdGNoKSBpbmRlbnQgPSBtYXRjaC5pbmRleDtcbiAgdmFyIGluZGVudFRleHQgPSAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKHRoaXMuc3ludGF4LnRhYik7XG5cbiAgdmFyIHNlZ21lbnQgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIGlmIChzZWdtZW50KSB7XG4gICAgY29kZSA9IFNFR01FTlRbc2VnbWVudF0gKyAnXFx1ZmZiYVxcbicgKyBjb2RlICsgaW5kZW50VGV4dCArICdcXHVmZmJlKi9gJ1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSk7XG4gICAgY29kZSA9ICc8JyArIHNlZ21lbnRbMF0gKyAnPicgK1xuICAgICAgY29kZS5zdWJzdHJpbmcoXG4gICAgICAgIGNvZGUuaW5kZXhPZignXFx1ZmZiYScpICsgMixcbiAgICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSArIGluZGVudFRleHQgKyAnXFx1ZmZiZSovYCcpO1xuICAgIGNvZGUgPSBjb2RlLnN1YnN0cmluZygwLCBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJykpO1xuICB9XG4gIHJldHVybiBjb2RlO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lID0gZnVuY3Rpb24oeSkge1xuICB2YXIgbGluZSA9IG5ldyBMaW5lO1xuICBsaW5lLm9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKFt5LHldKTtcbiAgbGluZS5vZmZzZXQgPSBsaW5lLm9mZnNldFJhbmdlWzBdO1xuICBsaW5lLmxlbmd0aCA9IGxpbmUub2Zmc2V0UmFuZ2VbMV0gLSBsaW5lLm9mZnNldFJhbmdlWzBdIC0gKHkgPCB0aGlzLmxvYygpKTtcbiAgbGluZS5wb2ludC5zZXQoeyB4OjAsIHk6eSB9KTtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocCkge1xuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShwLnkpO1xuICB2YXIgcG9pbnQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGxpbmUubGVuZ3RoLCBwLngpLFxuICAgIHk6IGxpbmUucG9pbnQueVxuICB9KTtcbiAgcG9pbnQub2Zmc2V0ID0gbGluZS5vZmZzZXQgKyBwb2ludC54O1xuICBwb2ludC5wb2ludCA9IHBvaW50O1xuICBwb2ludC5saW5lID0gbGluZTtcbiAgcmV0dXJuIHBvaW50O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VUZXh0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVSYW5nZU9mZnNldHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVswXSk7XG4gIHZhciBiID0gcmFuZ2VbMV0gPj0gdGhpcy5sb2MoKVxuICAgID8gdGhpcy50ZXh0Lmxlbmd0aFxuICAgIDogdGhpcy5nZXRMaW5lT2Zmc2V0KHJhbmdlWzFdICsgMSk7XG4gIHZhciBvZmZzZXRzID0gW2EsIGJdO1xuICByZXR1cm4gb2Zmc2V0cztcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UmFuZ2VUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0UmFuZ2UpIHtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0UmFuZ2UpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHRva2VuID0gdGhpcy50b2tlbnMuZ2V0QnlPZmZzZXQoJ2xpbmVzJywgb2Zmc2V0IC0gLjUpO1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBvZmZzZXQgLSAob2Zmc2V0ID4gdG9rZW4ub2Zmc2V0ID8gdG9rZW4ub2Zmc2V0ICsgKCEhdG9rZW4ucGFydC5sZW5ndGgpIDogMCksXG4gICAgeTogTWF0aC5taW4odGhpcy5sb2MoKSwgdG9rZW4uaW5kZXggLSAodG9rZW4ub2Zmc2V0ICsgMSA+IG9mZnNldCkgKyAxKVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBjaGFyID0gdGhpcy50ZXh0LmdldFJhbmdlKFtvZmZzZXQsIG9mZnNldCArIDFdKTtcbiAgcmV0dXJuIGNoYXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmVUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB7XG4gICAgbGluZTogbGluZSxcbiAgICB0ZXh0OiB0ZXh0LFxuICB9XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVUZXh0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgdGV4dCA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChbeSx5XSk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhVGV4dCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53b3JkQXJlYUF0UG9pbnQgPSBmdW5jdGlvbihwLCBpbmNsdXNpdmUpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2UocG9pbnQubGluZS5vZmZzZXRSYW5nZSk7XG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZSh0ZXh0LCBXT1JEUyk7XG5cbiAgaWYgKHdvcmRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXJlYTtcbiAgfVxuXG4gIHZhciBsYXN0SW5kZXggPSAwO1xuICB2YXIgd29yZCA9IFtdO1xuICB2YXIgZW5kID0gdGV4dC5sZW5ndGg7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAod29yZC5pbmRleCA+IHBvaW50LnggLSAhIWluY2x1c2l2ZSkge1xuICAgICAgZW5kID0gd29yZC5pbmRleDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBsYXN0SW5kZXggPSB3b3JkLmluZGV4O1xuICB9XG5cbiAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHsgeDogbGFzdEluZGV4LCB5OiBwb2ludC55IH0sXG4gICAgZW5kOiB7IHg6IGVuZCwgeTogcG9pbnQueSB9XG4gIH0pO1xuXG4gIHJldHVybiBhcmVhO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmVuZC54ID4gMCB8fCBhcmVhLmJlZ2luLnkgPT09IGFyZWEuZW5kLnkpIGFyZWEuZW5kLnkgKz0gMTtcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwO1xuICBhcmVhLmVuZC54ID0gMDtcblxuICB2YXIgdGV4dCA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChbYXJlYS5iZWdpbi55LCBhcmVhLmVuZC55LTFdKTtcbiAgdGhpcy5yZW1vdmVBcmVhKGFyZWEpO1xuXG4gIHRoaXMuaW5zZXJ0KHsgeDowLCB5OmFyZWEuYmVnaW4ueSArIHkgfSwgdGV4dCk7XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEFyZWFPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIHJhbmdlID0gW1xuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5iZWdpbikub2Zmc2V0LFxuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpLm9mZnNldFxuICBdO1xuICByZXR1cm4gcmFuZ2U7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVPZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBvZmZzZXQgPSB5IDwgMCA/IC0xIDogeSA9PT0gMCA/IDAgOiB0aGlzLnRva2Vucy5nZXRCeUluZGV4KCdsaW5lcycsIHkgLSAxKSArIDE7XG4gIHJldHVybiBvZmZzZXQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmxvYyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50b2tlbnMuZ2V0Q29sbGVjdGlvbignbGluZXMnKS5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbmZ1bmN0aW9uIExpbmUoKSB7XG4gIHRoaXMub2Zmc2V0UmFuZ2UgPSBbXTtcbiAgdGhpcy5vZmZzZXQgPSAwO1xuICB0aGlzLmxlbmd0aCA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVPTChzKSB7XG4gIHJldHVybiBzLnJlcGxhY2UoRU9MLCAnXFxuJyk7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gSW5kZXhlcjtcblxuZnVuY3Rpb24gSW5kZXhlcihidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG59XG5cbkluZGV4ZXIucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihzKSB7XG4gIGlmICghcykgcmV0dXJuIFtdO1xuICB2YXIgb2Zmc2V0cyA9IFtdO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLnJhdztcbiAgdmFyIGxlbiA9IHMubGVuZ3RoO1xuICB2YXIgaW5kZXg7XG4gIHdoaWxlICh+KGluZGV4ID0gdGV4dC5pbmRleE9mKHMsIGluZGV4ICsgbGVuKSkpIHtcbiAgICBvZmZzZXRzLnB1c2goaW5kZXgpO1xuICB9XG4gIHJldHVybiBvZmZzZXRzO1xufTtcbiIsInZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBhcnRzO1xuXG5mdW5jdGlvbiBQYXJ0cyhtaW5TaXplKSB7XG4gIG1pblNpemUgPSBtaW5TaXplIHx8IDUwMDA7XG4gIHRoaXMubWluU2l6ZSA9IG1pblNpemU7XG4gIHRoaXMucGFydHMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5QYXJ0cy5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgdGhpcy5hcHBlbmQoW2l0ZW1dKTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcGFydCA9IGxhc3QodGhpcy5wYXJ0cyk7XG5cbiAgaWYgKCFwYXJ0KSB7XG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IDA7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IDA7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG4gIGVsc2UgaWYgKHBhcnQubGVuZ3RoID49IHRoaXMubWluU2l6ZSkge1xuICAgIHZhciBzdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4ICsgcGFydC5sZW5ndGg7XG4gICAgdmFyIHN0YXJ0T2Zmc2V0ID0gaXRlbXNbMF07XG5cbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gc3RhcnRJbmRleDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gc3RhcnRPZmZzZXQ7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG5cbiAgcGFydC5wdXNoLmFwcGx5KHBhcnQsIGl0ZW1zLm1hcChvZmZzZXQgPT4gb2Zmc2V0IC0gcGFydC5zdGFydE9mZnNldCkpO1xuXG4gIHRoaXMubGVuZ3RoICs9IGl0ZW1zLmxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpbmRleCkge1xuICB2YXIgcGFydCA9IHRoaXMuZmluZFBhcnRCeUluZGV4KGluZGV4KS5pdGVtO1xuICByZXR1cm4gcGFydFtpbmRleCAtIHBhcnQuc3RhcnRJbmRleF0gKyBwYXJ0LnN0YXJ0T2Zmc2V0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHAgPSB0aGlzLmZpbmRQYXJ0QnlPZmZzZXQob2Zmc2V0KTtcbiAgaWYgKCFwLml0ZW0pIHJldHVybiBudWxsO1xuXG4gIHZhciBwYXJ0ID0gcC5pdGVtO1xuICB2YXIgcGFydEluZGV4ID0gcC5pbmRleDtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KTtcbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG8uaXRlbSArIHBhcnQuc3RhcnRPZmZzZXQsXG4gICAgaW5kZXg6IG8uaW5kZXggKyBwYXJ0LnN0YXJ0SW5kZXgsXG4gICAgbG9jYWw6IG8uaW5kZXgsXG4gICAgcGFydDogcGFydCxcbiAgICBwYXJ0SW5kZXg6IHBhcnRJbmRleFxuICB9O1xufTtcblxuUGFydHMucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgYXJyYXkpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKCFvKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwZW5kKGFycmF5KTtcbiAgfVxuICBpZiAoby5vZmZzZXQgPiBvZmZzZXQpIG8ubG9jYWwgPSAtMTtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcbiAgLy9UT0RPOiBtYXliZSBzdWJ0cmFjdCAnb2Zmc2V0JyBpbnN0ZWFkID9cbiAgYXJyYXkgPSBhcnJheS5tYXAoZWwgPT4gZWwgLT0gby5wYXJ0LnN0YXJ0T2Zmc2V0KTtcbiAgaW5zZXJ0KG8ucGFydCwgby5sb2NhbCArIDEsIGFycmF5KTtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgLWxlbmd0aCk7XG4gIHRoaXMubGVuZ3RoICs9IGxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdE9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgc2hpZnQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cztcbiAgdmFyIGl0ZW0gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKCFpdGVtKSByZXR1cm47XG4gIGlmIChvZmZzZXQgPiBpdGVtLm9mZnNldCkgaXRlbS5sb2NhbCArPSAxO1xuXG4gIHZhciByZW1vdmVkID0gMDtcbiAgZm9yICh2YXIgaSA9IGl0ZW0ubG9jYWw7IGkgPCBpdGVtLnBhcnQubGVuZ3RoOyBpKyspIHtcbiAgICBpdGVtLnBhcnRbaV0gKz0gc2hpZnQ7XG4gICAgaWYgKGl0ZW0ucGFydFtpXSArIGl0ZW0ucGFydC5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgcmVtb3ZlZCsrO1xuICAgICAgaXRlbS5wYXJ0LnNwbGljZShpLS0sIDEpO1xuICAgIH1cbiAgfVxuICBpZiAocmVtb3ZlZCkge1xuICAgIHRoaXMuc2hpZnRJbmRleChpdGVtLnBhcnRJbmRleCArIDEsIHJlbW92ZWQpO1xuICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gIH1cbiAgZm9yICh2YXIgaSA9IGl0ZW0ucGFydEluZGV4ICsgMTsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgcGFydHNbaV0uc3RhcnRPZmZzZXQgKz0gc2hpZnQ7XG4gICAgaWYgKHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICBpZiAobGFzdChwYXJ0c1tpXSkgKyBwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgICByZW1vdmVkID0gcGFydHNbaV0ubGVuZ3RoO1xuICAgICAgICB0aGlzLnNoaWZ0SW5kZXgoaSArIDEsIHJlbW92ZWQpO1xuICAgICAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICAgICAgICBwYXJ0cy5zcGxpY2UoaS0tLCAxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMucmVtb3ZlQmVsb3dPZmZzZXQob2Zmc2V0LCBwYXJ0c1tpXSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUucmVtb3ZlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZmluZChyYW5nZVswXSk7XG4gIHZhciBiID0gdGhpcy5maW5kKHJhbmdlWzFdKTtcbiAgaWYgKCFhICYmICFiKSByZXR1cm47XG5cbiAgaWYgKGEucGFydEluZGV4ID09PSBiLnBhcnRJbmRleCkge1xuICAgIGlmIChhLm9mZnNldCA+PSByYW5nZVsxXSB8fCBhLm9mZnNldCA8IHJhbmdlWzBdKSBhLmxvY2FsICs9IDE7XG4gICAgaWYgKGIub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGIub2Zmc2V0IDwgcmFuZ2VbMF0pIGIubG9jYWwgLT0gMTtcbiAgICB2YXIgc2hpZnQgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsLCBiLmxvY2FsICsgMSkubGVuZ3RoO1xuICAgIHRoaXMuc2hpZnRJbmRleChhLnBhcnRJbmRleCArIDEsIHNoaWZ0KTtcbiAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbiAgfSBlbHNlIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0QSA9IHJlbW92ZShhLnBhcnQsIGEubG9jYWwpLmxlbmd0aDtcbiAgICB2YXIgc2hpZnRCID0gcmVtb3ZlKGIucGFydCwgMCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICBpZiAoYi5wYXJ0SW5kZXggLSBhLnBhcnRJbmRleCA+IDEpIHtcbiAgICAgIHZhciByZW1vdmVkID0gcmVtb3ZlKHRoaXMucGFydHMsIGEucGFydEluZGV4ICsgMSwgYi5wYXJ0SW5kZXgpO1xuICAgICAgdmFyIHNoaWZ0QmV0d2VlbiA9IHJlbW92ZWQucmVkdWNlKChwLG4pID0+IHAgKyBuLmxlbmd0aCwgMCk7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEEgKyBzaGlmdEJldHdlZW47XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggLSByZW1vdmVkLmxlbmd0aCArIDEsIHNoaWZ0QSArIHNoaWZ0QiArIHNoaWZ0QmV0d2Vlbik7XG4gICAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW47XG4gICAgfSBlbHNlIHtcbiAgICAgIGIucGFydC5zdGFydEluZGV4IC09IHNoaWZ0QTtcbiAgICAgIHRoaXMuc2hpZnRJbmRleChiLnBhcnRJbmRleCArIDEsIHNoaWZ0QSArIHNoaWZ0Qik7XG4gICAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdEEgKyBzaGlmdEI7XG4gICAgfVxuICB9XG5cbiAgLy9UT0RPOiB0aGlzIGlzIGluZWZmaWNpZW50IGFzIHdlIGNhbiBjYWxjdWxhdGUgdGhlIGluZGV4ZXMgb3Vyc2VsdmVzXG4gIGlmICghYS5wYXJ0Lmxlbmd0aCkge1xuICAgIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihhLnBhcnQpLCAxKTtcbiAgfVxuICBpZiAoIWIucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYi5wYXJ0KSwgMSk7XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdEluZGV4ID0gZnVuY3Rpb24oc3RhcnRJbmRleCwgc2hpZnQpIHtcbiAgZm9yICh2YXIgaSA9IHN0YXJ0SW5kZXg7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy5wYXJ0c1tpXS5zdGFydEluZGV4IC09IHNoaWZ0O1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUucmVtb3ZlQmVsb3dPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHBhcnQpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KVxuICB2YXIgc2hpZnQgPSByZW1vdmUocGFydCwgMCwgby5pbmRleCkubGVuZ3RoO1xuICB0aGlzLnNoaWZ0SW5kZXgoby5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gIHRoaXMubGVuZ3RoIC09IHNoaWZ0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRPZmZzZXRJblBhcnQgPSBmdW5jdGlvbihvZmZzZXQsIHBhcnQpIHtcbiAgb2Zmc2V0IC09IHBhcnQuc3RhcnRPZmZzZXQ7XG4gIHJldHVybiBiaW5hcnlTZWFyY2gocGFydCwgbyA9PiBvIDw9IG9mZnNldCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZFBhcnRCeUluZGV4ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRJbmRleCA8PSBpbmRleCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZFBhcnRCeU9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHRoaXMucGFydHMsIHMgPT4gcy5zdGFydE9mZnNldCA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMucGFydHMucmVkdWNlKChwLG4pID0+IHAuY29uY2F0KG4pLCBbXSk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhcnRzID0gbmV3IFBhcnRzKHRoaXMubWluU2l6ZSk7XG4gIHRoaXMucGFydHMuZm9yRWFjaChwYXJ0ID0+IHtcbiAgICB2YXIgcCA9IHBhcnQuc2xpY2UoKTtcbiAgICBwLnN0YXJ0SW5kZXggPSBwYXJ0LnN0YXJ0SW5kZXg7XG4gICAgcC5zdGFydE9mZnNldCA9IHBhcnQuc3RhcnRPZmZzZXQ7XG4gICAgcGFydHMucGFydHMucHVzaChwKTtcbiAgfSk7XG4gIHBhcnRzLmxlbmd0aCA9IHRoaXMubGVuZ3RoO1xuICByZXR1cm4gcGFydHM7XG59O1xuXG5mdW5jdGlvbiBsYXN0KGFycmF5KSB7XG4gIHJldHVybiBhcnJheVthcnJheS5sZW5ndGggLSAxXTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlKGFycmF5LCBhLCBiKSB7XG4gIGlmIChiID09IG51bGwpIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhcnJheS5zcGxpY2UoYSwgYiAtIGEpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGluc2VydCh0YXJnZXQsIGluZGV4LCBhcnJheSkge1xuICB2YXIgb3AgPSBhcnJheS5zbGljZSgpO1xuICBvcC51bnNoaWZ0KGluZGV4LCAwKTtcbiAgdGFyZ2V0LnNwbGljZS5hcHBseSh0YXJnZXQsIG9wKTtcbn1cbiIsIi8vIHZhciBXT1JEID0gL1xcdysvZztcbnZhciBXT1JEID0gL1thLXpBLVowLTldezEsfS9nXG52YXIgcmFuayA9IDA7XG5cbm1vZHVsZS5leHBvcnRzID0gUHJlZml4VHJlZU5vZGU7XG5cbmZ1bmN0aW9uIFByZWZpeFRyZWVOb2RlKCkge1xuICB0aGlzLnZhbHVlID0gJyc7XG4gIHRoaXMucmFuayA9IDA7XG4gIHRoaXMuY2hpbGRyZW4gPSB7fTtcbn1cblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmdldENoaWxkcmVuID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjaGlsZHJlbiA9IE9iamVjdFxuICAgIC5rZXlzKHRoaXMuY2hpbGRyZW4pXG4gICAgLm1hcCgoa2V5KSA9PiB0aGlzLmNoaWxkcmVuW2tleV0pO1xuXG4gIHJldHVybiBjaGlsZHJlbi5yZWR1Y2UoKHAsIG4pID0+IHAuY29uY2F0KG4uZ2V0Q2hpbGRyZW4oKSksIGNoaWxkcmVuKTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5jb2xsZWN0ID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBjb2xsZWN0aW9uID0gW107XG4gIHZhciBub2RlID0gdGhpcy5maW5kKGtleSk7XG4gIGlmIChub2RlKSB7XG4gICAgY29sbGVjdGlvbiA9IG5vZGVcbiAgICAgIC5nZXRDaGlsZHJlbigpXG4gICAgICAuZmlsdGVyKChub2RlKSA9PiBub2RlLnZhbHVlKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgdmFyIHJlcyA9IGIucmFuayAtIGEucmFuaztcbiAgICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYi52YWx1ZS5sZW5ndGggLSBhLnZhbHVlLmxlbmd0aDtcbiAgICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYS52YWx1ZSA+IGIudmFsdWU7XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgICB9KTtcblxuICAgIGlmIChub2RlLnZhbHVlKSBjb2xsZWN0aW9uLnB1c2gobm9kZSk7XG4gIH1cbiAgcmV0dXJuIGNvbGxlY3Rpb247XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIGZvciAodmFyIGNoYXIgaW4ga2V5KSB7XG4gICAgaWYgKGtleVtjaGFyXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltrZXlbY2hhcl1dO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG4gIHJldHVybiBub2RlO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgdmFyIGkgPSAwO1xuICB2YXIgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGlmIChzW2ldIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW3NbaV1dO1xuICAgICAgaSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBub2RlID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dIHx8IG5ldyBQcmVmaXhUcmVlTm9kZTtcbiAgICBpKys7XG4gIH1cblxuICBub2RlLnZhbHVlID0gcztcbiAgbm9kZS5yYW5rKys7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkO1xuICB3aGlsZSAod29yZCA9IFdPUkQuZXhlYyhzKSkge1xuICAgIHRoaXMuaW5zZXJ0KHdvcmRbMF0pO1xuICB9XG59O1xuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG52YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcbnZhciBUb2tlbnMgPSByZXF1aXJlKCcuL3Rva2VucycpO1xudmFyIFR5cGUgPSBUb2tlbnMuVHlwZTtcblxudmFyIEJlZ2luID0gL1tcXC8nXCJgXS9nO1xuXG52YXIgTWF0Y2ggPSB7XG4gICdzaW5nbGUgY29tbWVudCc6IFsnLy8nLCdcXG4nXSxcbiAgJ2RvdWJsZSBjb21tZW50JzogWycvKicsJyovJ10sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiBbJ2AnLCdgJ10sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogW1wiJ1wiLFwiJ1wiXSxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBbJ1wiJywnXCInXSxcbiAgJ3JlZ2V4cCc6IFsnLycsJy8nXSxcbn07XG5cbnZhciBTa2lwID0ge1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnc2luZ2xlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ2RvdWJsZSBjb21tZW50JzogZmFsc2UsXG4gICdyZWdleHAnOiBcIlxcXFxcIixcbn07XG5cbnZhciBUb2tlbiA9IHt9O1xuZm9yICh2YXIga2V5IGluIE1hdGNoKSB7XG4gIHZhciBNID0gTWF0Y2hba2V5XTtcbiAgVG9rZW5bTVswXV0gPSBrZXk7XG59XG5cbnZhciBMZW5ndGggPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAyLFxuICAnY2xvc2UgY29tbWVudCc6IDIsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAxLFxufTtcblxudmFyIE5vdE9wZW4gPSB7XG4gICdjbG9zZSBjb21tZW50JzogdHJ1ZVxufTtcblxudmFyIENsb3NlcyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjbG9zZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRhZyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICdzdHJpbmcnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50cztcblxuZnVuY3Rpb24gU2VnbWVudHMoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xuICB0aGlzLmNhY2hlID0ge307XG4gIHRoaXMucmVzZXQoKTtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmNsZWFyQ2FjaGUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCkge1xuICAgIHZhciBzID0gYmluYXJ5U2VhcmNoKHRoaXMuY2FjaGUuc3RhdGUsIHMgPT4gcy5vZmZzZXQgPCBvZmZzZXQsIHRydWUpO1xuICAgIHRoaXMuY2FjaGUuc3RhdGUuc3BsaWNlKHMuaW5kZXgpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuY2FjaGUuc3RhdGUgPSBbXTtcbiAgfVxuICB0aGlzLmNhY2hlLm9mZnNldCA9IHt9O1xuICB0aGlzLmNhY2hlLnJhbmdlID0ge307XG4gIHRoaXMuY2FjaGUucG9pbnQgPSB7fTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyQ2FjaGUoKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbih5KSB7XG4gIGlmICh5IGluIHRoaXMuY2FjaGUucG9pbnQpIHtcbiAgICByZXR1cm4gdGhpcy5jYWNoZS5wb2ludFt5XTtcbiAgfVxuXG4gIHZhciBzZWdtZW50cyA9IHRoaXMuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdzZWdtZW50cycpO1xuICB2YXIgb3BlbiA9IGZhbHNlO1xuICB2YXIgc3RhdGUgPSBudWxsO1xuICB2YXIgd2FpdEZvciA9ICcnO1xuICB2YXIgcG9pbnQgPSB7IHg6LTEsIHk6LTEgfTtcbiAgdmFyIGNsb3NlID0gMDtcbiAgdmFyIG9mZnNldDtcbiAgdmFyIHNlZ21lbnQ7XG4gIHZhciByYW5nZTtcbiAgdmFyIHRleHQ7XG4gIHZhciB2YWxpZDtcbiAgdmFyIGxhc3Q7XG5cbiAgdmFyIGxhc3RDYWNoZVN0YXRlT2Zmc2V0ID0gMDtcblxuICB2YXIgaSA9IDA7XG5cbiAgdmFyIGNhY2hlU3RhdGUgPSB0aGlzLmdldENhY2hlU3RhdGUoeSk7XG4gIGlmIChjYWNoZVN0YXRlICYmIGNhY2hlU3RhdGUuaXRlbSkge1xuICAgIG9wZW4gPSB0cnVlO1xuICAgIHN0YXRlID0gY2FjaGVTdGF0ZS5pdGVtO1xuICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgaSA9IHN0YXRlLmluZGV4ICsgMTtcbiAgfVxuXG4gIGZvciAoOyBpIDwgc2VnbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBvZmZzZXQgPSBzZWdtZW50cy5nZXQoaSk7XG4gICAgc2VnbWVudCA9IHtcbiAgICAgIG9mZnNldDogb2Zmc2V0LFxuICAgICAgdHlwZTogVHlwZVt0aGlzLmJ1ZmZlci5jaGFyQXQob2Zmc2V0KV1cbiAgICB9O1xuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBjbG9zZSB0b2tlblxuICAgIGlmIChvcGVuKSB7XG4gICAgICBpZiAod2FpdEZvciA9PT0gc2VnbWVudC50eXBlKSB7XG4gICAgICAgIHBvaW50ID0gdGhpcy5nZXRPZmZzZXRQb2ludChzZWdtZW50Lm9mZnNldCk7XG5cbiAgICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkge1xuICAgICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gICAgICAgIH1cblxuICAgICAgICBsYXN0ID0gc2VnbWVudDtcbiAgICAgICAgbGFzdC5wb2ludCA9IHBvaW50O1xuICAgICAgICBzdGF0ZSA9IG51bGw7XG4gICAgICAgIG9wZW4gPSBmYWxzZTtcblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIG9wZW4gdG9rZW5cbiAgICBlbHNlIHtcbiAgICAgIHBvaW50ID0gdGhpcy5nZXRPZmZzZXRQb2ludChzZWdtZW50Lm9mZnNldCk7XG5cbiAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICB9XG5cbiAgICAgIHJhbmdlID0gdGhpcy5idWZmZXIuZ2V0TGluZShwb2ludC55KS5vZmZzZXRSYW5nZTtcblxuICAgICAgaWYgKGxhc3QgJiYgbGFzdC5wb2ludC55ID09PSBwb2ludC55KSB7XG4gICAgICAgIGNsb3NlID0gbGFzdC5wb2ludC54ICsgTGVuZ3RoW2xhc3QudHlwZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjbG9zZSA9IDA7XG4gICAgICB9XG5cbiAgICAgIHZhbGlkID0gdGhpcy5pc1ZhbGlkUmFuZ2UoW3JhbmdlWzBdLCByYW5nZVsxXSsxXSwgc2VnbWVudCwgY2xvc2UpO1xuXG4gICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgaWYgKE5vdE9wZW5bc2VnbWVudC50eXBlXSkgY29udGludWU7XG4gICAgICAgIG9wZW4gPSB0cnVlO1xuICAgICAgICBzdGF0ZSA9IHNlZ21lbnQ7XG4gICAgICAgIHN0YXRlLmluZGV4ID0gaTtcbiAgICAgICAgc3RhdGUucG9pbnQgPSBwb2ludDtcbiAgICAgICAgLy8gc3RhdGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMub2Zmc2V0IH07XG4gICAgICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgICAgIGlmICghdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggfHwgdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggJiYgc3RhdGUub2Zmc2V0ID4gdGhpcy5jYWNoZS5zdGF0ZVt0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAtIDFdLm9mZnNldCkge1xuICAgICAgICAgIHRoaXMuY2FjaGUuc3RhdGUucHVzaChzdGF0ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXRlICYmIHN0YXRlLnBvaW50LnkgPCB5KSB7XG4gICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgfVxuXG4gIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xufTtcblxuLy9UT0RPOiBjYWNoZSBpbiBCdWZmZXJcblNlZ21lbnRzLnByb3RvdHlwZS5nZXRPZmZzZXRQb2ludCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0IGluIHRoaXMuY2FjaGUub2Zmc2V0KSByZXR1cm4gdGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0KSk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIHNlZ21lbnQsIGNsb3NlKSB7XG4gIHZhciBrZXkgPSByYW5nZS5qb2luKCk7XG4gIGlmIChrZXkgaW4gdGhpcy5jYWNoZS5yYW5nZSkgcmV0dXJuIHRoaXMuY2FjaGUucmFuZ2Vba2V5XTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRSYW5nZVRleHQocmFuZ2UpO1xuICB2YXIgdmFsaWQgPSB0aGlzLmlzVmFsaWQodGV4dCwgc2VnbWVudC5vZmZzZXQgLSByYW5nZVswXSwgY2xvc2UpO1xuICByZXR1cm4gKHRoaXMuY2FjaGUucmFuZ2Vba2V5XSA9IHZhbGlkKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0LCBsYXN0SW5kZXgpIHtcbiAgQmVnaW4ubGFzdEluZGV4ID0gbGFzdEluZGV4O1xuXG4gIHZhciBtYXRjaCA9IEJlZ2luLmV4ZWModGV4dCk7XG4gIGlmICghbWF0Y2gpIHJldHVybjtcblxuICB2YXIgaSA9IG1hdGNoLmluZGV4O1xuXG4gIGxhc3QgPSBpO1xuXG4gIHZhciB2YWxpZCA9IHRydWU7XG5cbiAgb3V0ZXI6XG4gIGZvciAoOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBvbmUgPSB0ZXh0W2ldO1xuICAgIHZhciBuZXh0ID0gdGV4dFtpICsgMV07XG4gICAgdmFyIHR3byA9IG9uZSArIG5leHQ7XG4gICAgaWYgKGkgPT09IG9mZnNldCkgcmV0dXJuIHRydWU7XG5cbiAgICB2YXIgbyA9IFRva2VuW3R3b107XG4gICAgaWYgKCFvKSBvID0gVG9rZW5bb25lXTtcbiAgICBpZiAoIW8pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHZhciB3YWl0Rm9yID0gTWF0Y2hbb11bMV07XG5cbiAgICBsYXN0ID0gaTtcblxuICAgIHN3aXRjaCAod2FpdEZvci5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSBvbmUpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAxO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG5cbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuICAgICAgICAgIHR3byA9IHRleHRbaV0gKyB0ZXh0W2kgKyAxXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSB0d28pIHtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAyO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0Q2FjaGVTdGF0ZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLnBvaW50LnkgPCB5KTtcbiAgaWYgKHMuaXRlbSAmJiB5IC0gMSA8IHMuaXRlbS5wb2ludC55KSByZXR1cm4gbnVsbDtcbiAgZWxzZSByZXR1cm4gcztcbiAgLy8gcmV0dXJuIHM7XG59O1xuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbmxvZyA9IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplIHx8IDUwMDA7XG59XG5cblNraXBTdHJpbmcucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLmhlYWQud2lkdGhbdGhpcy5sZXZlbHMgLSAxXTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIC8vIGdyZWF0IGhhY2sgdG8gZG8gb2Zmc2V0ID49IGZvciAuc2VhcmNoKClcbiAgLy8gd2UgZG9uJ3QgaGF2ZSBmcmFjdGlvbnMgYW55d2F5IHNvLi5cbiAgcmV0dXJuIHRoaXMuc2VhcmNoKG9mZnNldCwgdHJ1ZSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaW5zZXJ0Q2h1bmtlZCgwLCB0ZXh0KTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKG9mZnNldCwgaW5jbCkge1xuICBpbmNsID0gaW5jbCA/IC4xIDogMDtcblxuICAvLyBwcmVwYXJlIHRvIGhvbGQgc3RlcHNcbiAgdmFyIHN0ZXBzID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcbiAgdmFyIHdpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcblxuICAvLyBpdGVyYXRlIGxldmVscyBkb3duLCBza2lwcGluZyB0b3BcbiAgdmFyIGkgPSB0aGlzLmxldmVscztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHdoaWxlIChvZmZzZXQgKyBpbmNsID4gbm9kZS53aWR0aFtpXSAmJiBudWxsICE9IG5vZGUubmV4dFtpXSkge1xuICAgICAgb2Zmc2V0IC09IG5vZGUud2lkdGhbaV07XG4gICAgICBub2RlID0gbm9kZS5uZXh0W2ldO1xuICAgIH1cbiAgICBzdGVwc1tpXSA9IG5vZGU7XG4gICAgd2lkdGhbaV0gPSBvZmZzZXQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG5vZGU6IG5vZGUsXG4gICAgc3RlcHM6IHN0ZXBzLFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBvZmZzZXQ6IG9mZnNldFxuICB9O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3BsaWNlID0gZnVuY3Rpb24ocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwczsgLy8gc2tpcCBzdGVwcyBsZWZ0IG9mIHRoZSBvZmZzZXRcbiAgdmFyIHdpZHRoID0gcy53aWR0aDtcblxuICB2YXIgcDsgLy8gbGVmdCBub2RlIG9yIGBwYFxuICB2YXIgcTsgLy8gcmlnaHQgbm9kZSBvciBgcWAgKG91ciBuZXcgbm9kZSlcbiAgdmFyIGxlbjtcblxuICAvLyBjcmVhdGUgbmV3IG5vZGVcbiAgbGV2ZWwgPSBsZXZlbCB8fCB0aGlzLnJhbmRvbUxldmVsKCk7XG4gIHEgPSBuZXcgTm9kZSh2YWx1ZSwgbGV2ZWwpO1xuICBsZW5ndGggPSBxLndpZHRoWzBdO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgbGV2ZWxzIGJlbG93IG5ldyBub2RlIGxldmVsXG4gIGkgPSBsZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsIHN0ZXBcbiAgICBxLm5leHRbaV0gPSBwLm5leHRbaV07IC8vIGluc2VydCBzbyBpbmhlcml0IGxlZnQncyBuZXh0XG4gICAgcC5uZXh0W2ldID0gcTsgLy8gbGVmdCdzIG5leHQgaXMgbm93IG91ciBuZXcgbm9kZVxuICAgIHEud2lkdGhbaV0gPSBwLndpZHRoW2ldIC0gd2lkdGhbaV0gKyBsZW5ndGg7XG4gICAgcC53aWR0aFtpXSA9IHdpZHRoW2ldO1xuICB9XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBhbGwgbGV2ZWxzIGRvd24gdW50aWwgZXhjZXB0IG5ldyBub2RlIGxldmVsXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IGxldmVsKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWxcbiAgICBwLndpZHRoW2ldICs9IGxlbmd0aDsgLy8gYWRkIG5ldyBub2RlIHdpZHRoXG4gIH1cblxuICAvLyByZXR1cm4gbmV3IG5vZGVcbiAgcmV0dXJuIHE7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgcyA9IHRoaXMuc2VhcmNoKG9mZnNldCk7XG5cbiAgLy8gaWYgc2VhcmNoIGZhbGxzIGluIHRoZSBtaWRkbGUgb2YgYSBzdHJpbmdcbiAgLy8gaW5zZXJ0IGl0IHRoZXJlIGluc3RlYWQgb2YgY3JlYXRpbmcgYSBuZXcgbm9kZVxuICBpZiAocy5vZmZzZXQgJiYgcy5ub2RlLnZhbHVlICYmIHMub2Zmc2V0IDwgcy5ub2RlLnZhbHVlLmxlbmd0aCkge1xuICAgIHRoaXMudXBkYXRlKHMsIGluc2VydChzLm9mZnNldCwgcy5ub2RlLnZhbHVlLCB2YWx1ZSkpO1xuICAgIHJldHVybiBzLm5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5zcGxpY2Uocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgLy8gdmFsdWVzIGxlbmd0aCBkaWZmZXJlbmNlXG4gIHZhciBsZW5ndGggPSBzLm5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIC8vIHVwZGF0ZSB2YWx1ZVxuICBzLm5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBmaXggd2lkdGhzIG9uIGFsbCBsZXZlbHNcbiAgaSA9IHRoaXMubGV2ZWxzO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBzLnN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihyYW5nZSkge1xuICBpZiAocmFuZ2VbMV0gPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdyYW5nZSBlbmQgb3ZlciBtYXhpbXVtIGxlbmd0aCgnICtcbiAgICAgIHRoaXMubGVuZ3RoICsgJyk6IFsnICsgcmFuZ2Uuam9pbigpICsgJ10nXG4gICAgKTtcbiAgfVxuXG4gIC8vIHJlbWFpbiBkaXN0YW5jZSB0byByZW1vdmVcbiAgdmFyIHggPSByYW5nZVsxXSAtIHJhbmdlWzBdO1xuXG4gIC8vIHNlYXJjaCBmb3Igbm9kZSBvbiBsZWZ0IGVkZ2VcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChyYW5nZVswXSk7XG4gIHZhciBvZmZzZXQgPSBzLm9mZnNldDtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwcztcbiAgdmFyIG5vZGUgPSBzLm5vZGU7XG5cbiAgLy8gc2tpcCBoZWFkXG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgLy8gc2xpY2UgbGVmdCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAob2Zmc2V0KSB7XG4gICAgaWYgKG9mZnNldCA8IG5vZGUud2lkdGhbMF0pIHtcbiAgICAgIHggLT0gdGhpcy51cGRhdGUocyxcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZSgwLCBvZmZzZXQpICtcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZShcbiAgICAgICAgICBvZmZzZXQgK1xuICAgICAgICAgIE1hdGgubWluKHgsIG5vZGUubGVuZ3RoIC0gb2Zmc2V0KVxuICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgICBpZiAoIW5vZGUpIHJldHVybjtcbiAgfVxuXG4gIC8vIHJlbW92ZSBhbGwgZnVsbCBub2RlcyBpbiByYW5nZVxuICB3aGlsZSAobm9kZSAmJiB4ID49IG5vZGUud2lkdGhbMF0pIHtcbiAgICB4IC09IHRoaXMucmVtb3ZlTm9kZShzdGVwcywgbm9kZSk7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuXG4gIC8vIHNsaWNlIHJpZ2h0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmICh4KSB7XG4gICAgdGhpcy5yZXBsYWNlKHN0ZXBzLCBub2RlLCBub2RlLnZhbHVlLnNsaWNlKHgpKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlTm9kZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLndpZHRoWzBdO1xuXG4gIHZhciBpO1xuXG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoIC0gbm9kZS53aWR0aFtpXTtcbiAgICBzdGVwc1tpXS5uZXh0W2ldID0gbm9kZS5uZXh0W2ldO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZXBsYWNlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUsIHZhbHVlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICBub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgdmFyIGk7XG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgbm9kZS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gdGhpcy5yZW1vdmUoW29mZnNldCwgb2Zmc2V0KzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydENodW5rZWQgPSBmdW5jdGlvbihvZmZzZXQsIHRleHQpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0ZXh0Lmxlbmd0aDsgaSArPSB0aGlzLmNodW5rU2l6ZSkge1xuICAgIHZhciBjaHVuayA9IHRleHQuc3Vic3RyKGksIHRoaXMuY2h1bmtTaXplKTtcbiAgICB0aGlzLmluc2VydChpICsgb2Zmc2V0LCBjaHVuayk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnN1YnN0cmluZyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgdmFyIGxlbmd0aCA9IGIgLSBhO1xuXG4gIHZhciBzZWFyY2ggPSB0aGlzLnNlYXJjaChhLCB0cnVlKTtcbiAgdmFyIG5vZGUgPSBzZWFyY2gubm9kZTtcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgdmFyIGQgPSBsZW5ndGggKyBzZWFyY2gub2Zmc2V0O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAobm9kZSAmJiBkID49IDApIHtcbiAgICBkIC09IG5vZGUud2lkdGhbMF07XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cbiAgaWYgKG5vZGUpIHtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gIH1cblxuICByZXR1cm4gcy5zdWJzdHIoc2VhcmNoLm9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJhbmRvbUxldmVsID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsZXZlbCA9IDE7XG4gIHdoaWxlIChsZXZlbCA8IHRoaXMubGV2ZWxzIC0gMSAmJiBNYXRoLnJhbmRvbSgpIDwgdGhpcy5iaWFzKSBsZXZlbCsrO1xuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJhbmdlID0gcmFuZ2UgfHwgW107XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZyhyYW5nZVswXSwgcmFuZ2VbMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29weSA9IG5ldyBTa2lwU3RyaW5nO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgdmFyIG9mZnNldCA9IDA7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgY29weS5pbnNlcnQob2Zmc2V0LCBub2RlLnZhbHVlKTtcbiAgICBvZmZzZXQgKz0gbm9kZS53aWR0aFswXTtcbiAgfVxuICByZXR1cm4gY29weTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmpvaW5TdHJpbmcgPSBmdW5jdGlvbihkZWxpbWl0ZXIpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIHBhcnRzLnB1c2gobm9kZS52YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzLmpvaW4oZGVsaW1pdGVyKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZygwLCB0aGlzLmxlbmd0aCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIFIgPSBSZWdleHAuY3JlYXRlO1xuXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcbnZhciBzeW50YXggPSBtYXAoe1xuICAndCc6IFIoWydvcGVyYXRvciddLCAnZycsIGVudGl0aWVzKSxcbiAgJ20nOiBSKFsncGFyYW1zJ10sICAgJ2cnKSxcbiAgJ2QnOiBSKFsnZGVjbGFyZSddLCAgJ2cnKSxcbiAgJ2YnOiBSKFsnZnVuY3Rpb24nXSwgJ2cnKSxcbiAgJ2snOiBSKFsna2V5d29yZCddLCAgJ2cnKSxcbiAgJ24nOiBSKFsnYnVpbHRpbiddLCAgJ2cnKSxcbiAgJ2wnOiBSKFsnc3ltYm9sJ10sICAgJ2cnKSxcbiAgJ3MnOiBSKFsndGVtcGxhdGUgc3RyaW5nJ10sICdnJyksXG4gICdlJzogUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0ge1xuICByZWdleHA6IFIoWydpbmRlbnQnXSwgJ2dtJyksXG4gIHJlcGxhY2VyOiAocykgPT4gcy5yZXBsYWNlKC8gezEsMn18XFx0L2csICc8eD4kJjwveD4nKVxufTtcblxudmFyIEFueUNoYXIgPSAvXFxTL2c7XG5cbnZhciBCbG9ja3MgPSBSKFsnY29tbWVudCcsJ3N0cmluZycsJ3JlZ2V4cCddLCAnZ20nKTtcblxudmFyIExvbmdMaW5lcyA9IC8oXi57MTAwMCx9KS9nbTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2MnLFxuICAnLyonOiAnYycsXG4gICdgJzogJ3MnLFxuICAnXCInOiAncycsXG4gIFwiJ1wiOiAncycsXG4gICcvJzogJ3InLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW50YXg7XG5cbmZ1bmN0aW9uIFN5bnRheChvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLnRhYiA9IG8udGFiIHx8ICdcXHQnO1xuICB0aGlzLmJsb2NrcyA9IFtdO1xufVxuXG5TeW50YXgucHJvdG90eXBlLmVudGl0aWVzID0gZW50aXRpZXM7XG5cblN5bnRheC5wcm90b3R5cGUuaGlnaGxpZ2h0ID0gZnVuY3Rpb24oY29kZSwgb2Zmc2V0KSB7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUluZGVudHMoY29kZSk7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGVudGl0aWVzKGNvZGUpO1xuXG4gIGZvciAodmFyIGtleSBpbiBzeW50YXgpIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHN5bnRheFtrZXldLnJlZ2V4cCwgc3ludGF4W2tleV0ucmVwbGFjZXIpO1xuICB9XG5cbiAgY29kZSA9IHRoaXMucmVzdG9yZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGNvZGUucmVwbGFjZShJbmRlbnQucmVnZXhwLCBJbmRlbnQucmVwbGFjZXIpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVJbmRlbnRzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XG4gIHZhciBpbmRlbnQgPSAwO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBsaW5lO1xuICB2YXIgaTtcblxuICBpID0gbGluZXMubGVuZ3RoO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGxpbmUpO1xuICAgIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gICAgZWxzZSBpZiAoaW5kZW50ICYmICFsaW5lLmxlbmd0aCkge1xuICAgICAgbGluZXNbaV0gPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnRhYik7XG4gICAgfVxuICB9XG5cbiAgY29kZSA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5yZXN0b3JlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgYmxvY2s7XG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcbiAgdmFyIG4gPSAwO1xuICByZXR1cm4gY29kZVxuICAgIC5yZXBsYWNlKC9cXHVmZmVjL2csIGZ1bmN0aW9uKCkge1xuICAgICAgYmxvY2sgPSBibG9ja3NbbisrXTtcbiAgICAgIHJldHVybiBlbnRpdGllcyhibG9jay5zbGljZSgwLCAxMDAwKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknKTtcbiAgICB9KVxuICAgIC5yZXBsYWNlKC9cXHVmZmViL2csIGZ1bmN0aW9uKCkge1xuICAgICAgYmxvY2sgPSBibG9ja3NbbisrXTtcbiAgICAgIHZhciB0YWcgPSBpZGVudGlmeShibG9jayk7XG4gICAgICByZXR1cm4gJzwnK3RhZysnPicrZW50aXRpZXMoYmxvY2spKyc8LycrdGFnKyc+JztcbiAgICB9KTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB0aGlzLmJsb2NrcyA9IFtdO1xuXG4gIGNvZGUgPSBjb2RlXG4gICAgLnJlcGxhY2UoTG9uZ0xpbmVzLCAoYmxvY2spID0+IHtcbiAgICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgcmV0dXJuICdcXHVmZmVjJztcbiAgICB9KVxuICAgIC5yZXBsYWNlKEJsb2NrcywgKGJsb2NrKSA9PiB7XG4gICAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICAgIHJldHVybiAnXFx1ZmZlYic7XG4gICAgfSk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVJZCgpIHtcbiAgdmFyIGFscGhhYmV0ID0gJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6JztcbiAgdmFyIGxlbmd0aCA9IGFscGhhYmV0Lmxlbmd0aCAtIDE7XG4gIHZhciBpID0gNjtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKGktLSkge1xuICAgIHMgKz0gYWxwaGFiZXRbTWF0aC5yYW5kb20oKSAqIGxlbmd0aCB8IDBdO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBlbnRpdGllcyh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIDtcbn1cblxuZnVuY3Rpb24gY29tcGlsZShyZWdleHAsIHRhZykge1xuICB2YXIgb3BlblRhZyA9ICc8JyArIHRhZyArICc+JztcbiAgdmFyIGNsb3NlVGFnID0gJzwvJyArIHRhZyArICc+JztcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiB0YWcsXG4gICAgcmVnZXhwOiByZWdleHAsXG4gICAgcmVwbGFjZXI6IG9wZW5UYWcgKyAnJCYnICsgY2xvc2VUYWdcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFwKG9iaiwgZm4pIHtcbiAgdmFyIHJlc3VsdCA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgcmVzdWx0W2tleV0gPSBmbihvYmpba2V5XSwga2V5KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiByZXBsYWNlKHBhc3MsIGNvZGUpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXNzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShwYXNzW2ldWzBdLCBwYXNzW2ldWzFdKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cblxuZnVuY3Rpb24gaWRlbnRpZnkoYmxvY2spIHtcbiAgdmFyIG9uZSA9IGJsb2NrWzBdO1xuICB2YXIgdHdvID0gb25lICsgYmxvY2tbMV07XG4gIHJldHVybiBUYWdbdHdvXSB8fCBUYWdbb25lXTtcbn1cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFBhcnRzID0gcmVxdWlyZSgnLi9wYXJ0cycpO1xuXG52YXIgVHlwZSA9IHtcbiAgJ1xcbic6ICdsaW5lcycsXG4gICd7JzogJ29wZW4gY3VybHknLFxuICAnfSc6ICdjbG9zZSBjdXJseScsXG4gICdbJzogJ29wZW4gc3F1YXJlJyxcbiAgJ10nOiAnY2xvc2Ugc3F1YXJlJyxcbiAgJygnOiAnb3BlbiBwYXJlbnMnLFxuICAnKSc6ICdjbG9zZSBwYXJlbnMnLFxuICAnLyc6ICdvcGVuIGNvbW1lbnQnLFxuICAnKic6ICdjbG9zZSBjb21tZW50JyxcbiAgJ2AnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUT0tFTiA9IC9cXG58XFwvXFwqfFxcKlxcL3xgfFxce3xcXH18XFxbfFxcXXxcXCh8XFwpL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gVG9rZW5zO1xuXG5Ub2tlbnMuVHlwZSA9IFR5cGU7XG5cbmZ1bmN0aW9uIFRva2VucyhmYWN0b3J5KSB7XG4gIGZhY3RvcnkgPSBmYWN0b3J5IHx8IGZ1bmN0aW9uKCkgeyByZXR1cm4gbmV3IFBhcnRzOyB9O1xuXG4gIHRoaXMuZmFjdG9yeSA9IGZhY3Rvcnk7XG5cbiAgdmFyIHQgPSB0aGlzLnRva2VucyA9IHtcbiAgICBsaW5lczogZmFjdG9yeSgpLFxuICAgIGJsb2NrczogZmFjdG9yeSgpLFxuICAgIHNlZ21lbnRzOiBmYWN0b3J5KCksXG4gIH07XG5cbiAgdGhpcy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xufVxuXG5Ub2tlbnMucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVG9rZW5zLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfHwgMDtcblxuICB2YXIgdG9rZW5zID0gdGhpcy50b2tlbnM7XG4gIHZhciBtYXRjaDtcbiAgdmFyIHR5cGU7XG4gIHZhciBjb2xsZWN0aW9uO1xuXG4gIHdoaWxlIChtYXRjaCA9IFRPS0VOLmV4ZWModGV4dCkpIHtcbiAgICBjb2xsZWN0aW9uID0gdGhpcy5jb2xsZWN0aW9uW3RleHRbbWF0Y2guaW5kZXhdXTtcbiAgICBjb2xsZWN0aW9uLnB1c2gobWF0Y2guaW5kZXggKyBvZmZzZXQpO1xuICB9XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHJhbmdlLCB0ZXh0LCBzaGlmdCkge1xuICB2YXIgaW5zZXJ0ID0gbmV3IFRva2VucyhBcnJheSk7XG4gIGluc2VydC5pbmRleCh0ZXh0LCByYW5nZVswXSk7XG5cbiAgdmFyIGxlbmd0aHMgPSB7fTtcbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIGxlbmd0aHNbdHlwZV0gPSB0aGlzLnRva2Vuc1t0eXBlXS5sZW5ndGg7XG4gIH1cblxuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uc2hpZnRPZmZzZXQocmFuZ2VbMF0sIHNoaWZ0KTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5yZW1vdmVSYW5nZShyYW5nZSk7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uaW5zZXJ0KHJhbmdlWzBdLCBpbnNlcnQudG9rZW5zW3R5cGVdKTtcbiAgfVxuXG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICBpZiAodGhpcy50b2tlbnNbdHlwZV0ubGVuZ3RoICE9PSBsZW5ndGhzW3R5cGVdKSB7XG4gICAgICB0aGlzLmVtaXQoYGNoYW5nZSAke3R5cGV9YCk7XG4gICAgfVxuICB9XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5SW5kZXggPSBmdW5jdGlvbih0eXBlLCBpbmRleCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZ2V0KGluZGV4KTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0Q29sbGVjdGlvbiA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeU9mZnNldCA9IGZ1bmN0aW9uKHR5cGUsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZmluZChvZmZzZXQpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciB0b2tlbnMgPSBuZXcgVG9rZW5zKHRoaXMuZmFjdG9yeSk7XG4gIHZhciB0ID0gdG9rZW5zLnRva2VucztcbiAgZm9yICh2YXIga2V5IGluIHRoaXMudG9rZW5zKSB7XG4gICAgdFtrZXldID0gdGhpcy50b2tlbnNba2V5XS5zbGljZSgpO1xuICB9XG4gIHRva2Vucy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xuICByZXR1cm4gdG9rZW5zO1xufTtcbiIsInZhciBvcGVuID0gcmVxdWlyZSgnLi4vbGliL29wZW4nKTtcbnZhciBzYXZlID0gcmVxdWlyZSgnLi4vbGliL3NhdmUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJy4vYnVmZmVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmlsZTtcblxuZnVuY3Rpb24gRmlsZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLnJvb3QgPSAnJztcbiAgdGhpcy5wYXRoID0gJ3VudGl0bGVkJztcbiAgdGhpcy5idWZmZXIgPSBuZXcgQnVmZmVyO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5GaWxlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkZpbGUucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJ1ZmZlci5vbigncmF3JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3JhdycpKTtcbiAgdGhpcy5idWZmZXIub24oJ3NldCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdzZXQnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCd1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY2hhbmdlJykpO1xuICB0aGlzLmJ1ZmZlci5vbignYmVmb3JlIHVwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdiZWZvcmUgY2hhbmdlJykpO1xufTtcblxuRmlsZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMucGF0aCA9IHBhdGg7XG4gIHRoaXMucm9vdCA9IHJvb3Q7XG4gIG9wZW4ocm9vdCArIHBhdGgsIChlcnIsIHRleHQpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIGZuICYmIGZuKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG4gICAgdGhpcy5lbWl0KCdvcGVuJyk7XG4gICAgZm4gJiYgZm4obnVsbCwgdGhpcyk7XG4gIH0pO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHNhdmUodGhpcy5yb290ICsgdGhpcy5wYXRoLCB0aGlzLmJ1ZmZlci50b1N0cmluZygpLCBmbiB8fCBub29wKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vbGliL2RlYm91bmNlJyk7XG5cbi8qXG4gICAuIC5cbi0xIDAgMSAyIDMgNCA1XG4gICBuXG5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEhpc3Rvcnk7XG5cbmZ1bmN0aW9uIEhpc3RvcnkoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLm5lZWRsZSA9IDA7XG4gIHRoaXMudGltZW91dCA9IHRydWU7XG4gIHRoaXMudGltZVN0YXJ0ID0gMDtcbn1cblxuSGlzdG9yeS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDAgfHwgZm9yY2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xufSwgNzAwKTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICBpZiAodGhpcy5lZGl0b3IuYnVmZmVyLmxvZy5sZW5ndGgpIHtcbiAgICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICAgIHRoaXMubG9nLnB1c2godGhpcy5jb21taXQoKSk7XG4gICAgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGg7XG4gICAgdGhpcy5zYXZlTWV0YSgpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuc2F2ZU1ldGEoKTtcbiAgfVxuICB0aGlzLnRpbWVTdGFydCA9IERhdGUubm93KCk7XG4gIHRoaXMudGltZW91dCA9IGZhbHNlO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUudW5kbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG4gIGlmICh0aGlzLm5lZWRsZSA8IDApIHJldHVybjtcblxuICB0aGlzLmNoZWNrb3V0KCd1bmRvJywgdGhpcy5uZWVkbGUtLSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5yZWRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA9PT0gdGhpcy5sb2cubGVuZ3RoIC0gMSkgcmV0dXJuO1xuXG4gIHRoaXMuY2hlY2tvdXQoJ3JlZG8nLCArK3RoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24odHlwZSwgbikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG5cbiAgdmFyIGxvZyA9IGNvbW1pdC5sb2c7XG5cbiAgY29tbWl0ID0gdGhpcy5sb2dbbl1bdHlwZV07XG4gIHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlID0gY29tbWl0Lm1hcmtBY3RpdmU7XG4gIHRoaXMuZWRpdG9yLm1hcmsuc2V0KGNvbW1pdC5tYXJrLmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLnNldENhcmV0KGNvbW1pdC5jYXJldC5jb3B5KCkpO1xuXG4gIGxvZyA9ICd1bmRvJyA9PT0gdHlwZVxuICAgID8gbG9nLnNsaWNlKCkucmV2ZXJzZSgpXG4gICAgOiBsb2cuc2xpY2UoKTtcblxuICBsb2cuZm9yRWFjaChpdGVtID0+IHtcbiAgICB2YXIgYWN0aW9uID0gaXRlbVswXTtcbiAgICB2YXIgb2Zmc2V0UmFuZ2UgPSBpdGVtWzFdO1xuICAgIHZhciB0ZXh0ID0gaXRlbVsyXTtcbiAgICBzd2l0Y2ggKGFjdGlvbikge1xuICAgICAgY2FzZSAnaW5zZXJ0JzpcbiAgICAgICAgaWYgKCd1bmRvJyA9PT0gdHlwZSkge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSwgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLmluc2VydCh0aGlzLmVkaXRvci5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0UmFuZ2VbMF0pLCB0ZXh0LCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3JlbW92ZSc6XG4gICAgICAgIGlmICgndW5kbycgPT09IHR5cGUpIHtcbiAgICAgICAgICB0aGlzLmVkaXRvci5idWZmZXIuaW5zZXJ0KHRoaXMuZWRpdG9yLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXRSYW5nZVswXSksIHRleHQsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlci5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSwgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsb2cgPSB0aGlzLmVkaXRvci5idWZmZXIubG9nO1xuICB0aGlzLmVkaXRvci5idWZmZXIubG9nID0gW107XG4gIHJldHVybiB7XG4gICAgbG9nOiBsb2csXG4gICAgdW5kbzogdGhpcy5tZXRhLFxuICAgIHJlZG86IHtcbiAgICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgICBtYXJrOiB0aGlzLmVkaXRvci5tYXJrLmNvcHkoKSxcbiAgICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gICAgfVxuICB9O1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZU1ldGEgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tZXRhID0ge1xuICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgfTtcbn07XG4iLCJ2YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcblxudmFyIFBBR0lOR19USFJPVFRMRSA9IDY1O1xuXG52YXIga2V5cyA9IG1vZHVsZS5leHBvcnRzID0ge1xuICAnY3RybCt6JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnVuZG8oKTtcbiAgfSxcbiAgJ2N0cmwreSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS5yZWRvKCk7XG4gIH0sXG5cbiAgJ2hvbWUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUoKTtcbiAgfSxcbiAgJ2VuZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUoKTtcbiAgfSxcbiAgJ3BhZ2V1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ3BhZ2Vkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK3VwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCg2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93big2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSk7XG4gIH0sXG4gICd1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xKTtcbiAgfSxcbiAgJ3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEpO1xuICB9LFxuICAnZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxKTtcbiAgfSxcblxuICAnY3RybCtsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSk7XG4gIH0sXG4gICdjdHJsK3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrYSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH0sXG5cbiAgJ2N0cmwrc2hpZnQrdXAnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcbiAgJ2N0cmwrc2hpZnQrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCB7IGJlZ2luOiB0aGlzLmNhcmV0LnBvcywgZW5kOiB0aGlzLmNhcmV0LnBvcyB9KTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCB0aGlzLm1hcmsuZ2V0KCkpO1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdlbnRlcic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5zZXJ0KCdcXG4nKTtcbiAgfSxcblxuICAnYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCtkJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciBsaW5lcyA9IGFyZWEuZW5kLnkgLSBhcmVhLmJlZ2luLnk7XG4gICAgaWYgKGxpbmVzICYmIGFyZWEuZW5kLnggPiAwKSBhZGQgKz0gMTtcbiAgICBpZiAoIWxpbmVzKSBhZGQgKz0gMTtcbiAgICBsaW5lcyArPSBhZGQ7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhLnNldExlZnQoMCkuYWRkQm90dG9tKGFkZCkpO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh7IHg6IDAsIHk6IGFyZWEuZW5kLnkgfSwgdGV4dCk7XG4gICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcyhsaW5lcyk7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMobGluZXMsIHRydWUpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICd0YWInOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5zdWdnZXN0KCk7XG4gICAgaWYgKCFyZXMpIHtcbiAgICAgIHRoaXMuaW5zZXJ0KHRoaXMudGFiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShyZXMuYXJlYSk7XG4gICAgICB0aGlzLmluc2VydChyZXMubm9kZS52YWx1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdjdHJsK2YnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmQub3BlbigpO1xuICB9LFxuXG4gICdmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoKzEpO1xuICB9LFxuICAnc2hpZnQrZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKC0xKTtcbiAgfSxcblxuICAnY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFkZDtcbiAgICB2YXIgYXJlYTtcbiAgICB2YXIgdGV4dDtcblxuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuXG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICBjbGVhciA9IHRydWU7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRoaXMubWFyay5hZGRCb3R0b20oYXJlYS5lbmQueCA+IDApLnNldExlZnQoMCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYSh0aGlzLm1hcmsuZ2V0KCkpO1xuICAgIH1cblxuICAgIC8vVE9ETzogc2hvdWxkIGNoZWNrIGlmIGxhc3QgbGluZSBoYXMgLy8gYWxzb1xuICAgIGlmICh0ZXh0LnRyaW1MZWZ0KCkuc3Vic3RyKDAsMikgPT09ICcvLycpIHtcbiAgICAgIGFkZCA9IC0zO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXiguKj8pXFwvXFwvICguKykvZ20sICckMSQyJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkZCA9ICszO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXihbXFxzXSopKC4rKS9nbSwgJyQxLy8gJDInKTtcbiAgICB9XG5cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcblxuICAgIHRoaXMubWFyay5zZXQoYXJlYS5hZGRSaWdodChhZGQpKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuXG4gICAgaWYgKGNhcmV0LngpIGNhcmV0LmFkZFJpZ2h0KGFkZCk7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldCk7XG5cbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIGNsZWFyID0gdHJ1ZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICAgIGlmICh0ZXh0LnNsaWNlKDAsMikgPT09ICcvKicgJiYgdGV4dC5zbGljZSgtMikgPT09ICcqLycpIHtcbiAgICAgIHRleHQgPSB0ZXh0LnNsaWNlKDIsLTIpO1xuICAgICAgYWRkIC09IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgLT0gMjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGV4dCA9ICcvKicgKyB0ZXh0ICsgJyovJztcbiAgICAgIGFkZCArPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkICs9IDI7XG4gICAgfVxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuICAgIGFyZWEuZW5kLnggKz0gYWRkO1xuICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0LmFkZFJpZ2h0KGFkZCkpO1xuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG59O1xuXG5rZXlzLnNpbmdsZSA9IHtcbiAgLy9cbn07XG5cbi8vIHNlbGVjdGlvbiBrZXlzXG5bICdob21lJywnZW5kJyxcbiAgJ3BhZ2V1cCcsJ3BhZ2Vkb3duJyxcbiAgJ2xlZnQnLCd1cCcsJ3JpZ2h0JywnZG93bicsXG4gICdjdHJsK2xlZnQnLCdjdHJsK3JpZ2h0J1xuXS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICBrZXlzWydzaGlmdCsnK2tleV0gPSBmdW5jdGlvbihlKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICBrZXlzW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfTtcbn0pO1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgTW91c2UgPSByZXF1aXJlKCcuL21vdXNlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vdGV4dCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IElucHV0O1xuXG5mdW5jdGlvbiBJbnB1dChlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubW91c2UgPSBuZXcgTW91c2UodGhpcyk7XG4gIHRoaXMudGV4dCA9IG5ldyBUZXh0O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5JbnB1dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5JbnB1dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmx1ciA9IHRoaXMuYmx1ci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnRleHQub24oWydrZXknLCAndGV4dCddLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnaW5wdXQnKSk7XG4gIHRoaXMudGV4dC5vbignZm9jdXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKSk7XG4gIHRoaXMudGV4dC5vbignYmx1cicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJykpO1xuICB0aGlzLnRleHQub24oJ3RleHQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAndGV4dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXlzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleXMnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjdXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY3V0JykpO1xuICB0aGlzLnRleHQub24oJ2NvcHknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY29weScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdwYXN0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdwYXN0ZScpKTtcbiAgdGhpcy5tb3VzZS5vbigndXAnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2V1cCcpKTtcbiAgdGhpcy5tb3VzZS5vbignY2xpY2snLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VjbGljaycpKTtcbiAgdGhpcy5tb3VzZS5vbignZG93bicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRvd24nKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnIGJlZ2luJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZ2JlZ2luJykpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgdGhpcy5tb3VzZS51c2Uobm9kZSk7XG4gIHRoaXMudGV4dC5yZXNldCgpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmJsdXIoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuZm9jdXMoKTtcbn07XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW91c2U7XG5cbmZ1bmN0aW9uIE1vdXNlKCkge1xuICB0aGlzLm5vZGUgPSBudWxsO1xuICB0aGlzLmNsaWNrcyA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbk1vdXNlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdXNlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5vbm1heWJlZHJhZyA9IHRoaXMub25tYXliZWRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRyYWcgPSB0aGlzLm9uZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZG93biA9IHRoaXMub25kb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub251cCA9IHRoaXMub251cC5iaW5kKHRoaXMpO1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xufTtcblxuTW91c2UucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgaWYgKHRoaXMubm9kZSkge1xuICAgIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gICAgLy8gdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xuICB9XG4gIHRoaXMubm9kZSA9IG5vZGU7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gIC8vIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRvd24gPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmRvd24gPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2Rvd24nLCBlKTtcbiAgdGhpcy5vbmNsaWNrKGUpO1xuICB0aGlzLm1heWJlRHJhZygpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9udXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndXAnLCBlKTtcbiAgaWYgKCF0aGlzLmRvd24pIHJldHVybjtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5kcmFnRW5kKCk7XG4gIHRoaXMubWF5YmVEcmFnRW5kKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25jbGljayA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5yZXNldENsaWNrcygpO1xuICB0aGlzLmNsaWNrcyA9ICh0aGlzLmNsaWNrcyAlIDMpICsgMTtcbiAgdGhpcy5lbWl0KCdjbGljaycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9ubWF5YmVkcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcblxuICB2YXIgZCA9XG4gICAgICBNYXRoLmFicyh0aGlzLnBvaW50LnggLSB0aGlzLmRvd24ueClcbiAgICArIE1hdGguYWJzKHRoaXMucG9pbnQueSAtIHRoaXMuZG93bi55KTtcblxuICBpZiAoZCA+IDUpIHtcbiAgICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xuICAgIHRoaXMuZHJhZ0JlZ2luKCk7XG4gIH1cbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2RyYWcnLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBiZWdpbicpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGVuZCcpO1xufTtcblxuXG5Nb3VzZS5wcm90b3R5cGUucmVzZXRDbGlja3MgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGlja3MgPSAwO1xufSwgMzUwKTtcblxuTW91c2UucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG5cbnZhciBUSFJPVFRMRSA9IDAgLy8xMDAwLzYyO1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RleHRhcmVhJyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZScsXG4gICAgYXV0b2NvbXBsZXRlOiAnb2ZmJyxcbiAgICBzcGVsbGNoZWNraW5nOiAnb2ZmJyxcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufSwgMjAwMCk7XG5cblRleHQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5ibHVyKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmZvY3VzKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIC8vIGZvcmNlcyBjYXJldCB0byBlbmQgb2YgdGV4dGFyZWEgc28gd2UgY2FuIGdldCAuc2xpY2UoLTEpIGNoYXJcbiAgc2V0SW1tZWRpYXRlKCgpID0+IHRoaXMuZWwuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLmVsLnZhbHVlLmxlbmd0aCk7XG4gIHRoaXMuZW1pdCgndGV4dCcsIHRoaXMuZ2V0KCkpO1xuICB0aGlzLmNsZWFyKCk7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgLy8gY29uc29sZS5sb2coZS53aGljaCk7XG4gIHZhciBub3cgPSBEYXRlLm5vdygpO1xuICBpZiAobm93IC0gdGhpcy50aHJvdHRsZVRpbWUgPCBUSFJPVFRMRSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSBub3c7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0pO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXl1cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQgJiYgIWUuc2hpZnRLZXkpIGtleXMucHVzaCgnc2hpZnQ6dXAnKTtcbiAgaWYgKG0uY3RybCAmJiAhZS5jdHJsS2V5KSBrZXlzLnB1c2goJ2N0cmw6dXAnKTtcbiAgaWYgKG0uYWx0ICYmICFlLmFsdEtleSkga2V5cy5wdXNoKCdhbHQ6dXAnKTtcblxuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSArICc6dXAnKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9uY3V0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY3V0JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjb3B5JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbnBhc3RlID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgncGFzdGUnLCBlKTtcbn07XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi9saWIvcG9pbnQnKTtcblxudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3dvcmRzJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW92ZTtcblxuZnVuY3Rpb24gTW92ZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbn1cblxuTW92ZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlRG93biA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCBzaXplIC0gcmVtYWluZGVyKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcyhwYWdlKTtcbn07XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VVcCA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCAtKHNpemUgLSByZW1haW5kZXIpKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcygtcGFnZSk7XG59O1xuXG52YXIgbW92ZSA9IHt9O1xuXG5tb3ZlLmJ5V29yZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmUgPSBidWZmZXIuZ2V0TGluZVRleHQocC55KTtcblxuICBpZiAoZHggPiAwICYmIHAueCA+PSBsaW5lLmxlbmd0aCAtIDEpIHsgLy8gYXQgZW5kIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgKzEpOyAvLyBtb3ZlIG9uZSBjaGFyIHJpZ2h0XG4gIH0gZWxzZSBpZiAoZHggPCAwICYmIHAueCA9PT0gMCkgeyAvLyBhdCBiZWdpbiBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsIC0xKTsgLy8gbW92ZSBvbmUgY2hhciBsZWZ0XG4gIH1cblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UobGluZSwgV09SRFMpO1xuICB2YXIgd29yZDtcblxuICBpZiAoZHggPCAwKSB3b3Jkcy5yZXZlcnNlKCk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAoZHggPiAwXG4gICAgICA/IHdvcmQuaW5kZXggPiBwLnhcbiAgICAgIDogd29yZC5pbmRleCA8IHAueCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgeDogd29yZC5pbmRleCxcbiAgICAgICAgeTogcC55XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIHJlYWNoZWQgYmVnaW4vZW5kIG9mIGZpbGVcbiAgcmV0dXJuIGR4ID4gMFxuICAgID8gbW92ZS5lbmRPZkxpbmUoYnVmZmVyLCBwKVxuICAgIDogbW92ZS5iZWdpbk9mTGluZShidWZmZXIsIHApO1xufTtcblxubW92ZS5ieUNoYXJzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR4IDwgMCkgeyAvLyBnb2luZyBsZWZ0XG4gICAgeCArPSBkeDsgLy8gbW92ZSBsZWZ0XG4gICAgaWYgKHggPCAwKSB7IC8vIHdoZW4gcGFzdCBsZWZ0IGVkZ2VcbiAgICAgIGlmICh5ID4gMCkgeyAvLyBhbmQgbGluZXMgYWJvdmVcbiAgICAgICAgeSAtPSAxOyAvLyBtb3ZlIHVwIGEgbGluZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBhbmQgZ28gdG8gdGhlIGVuZCBvZiBsaW5lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB4ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAoZHggPiAwKSB7IC8vIGdvaW5nIHJpZ2h0XG4gICAgeCArPSBkeDsgLy8gbW92ZSByaWdodFxuICAgIHdoaWxlICh4IC0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoID4gMCkgeyAvLyB3aGlsZSBwYXN0IGxpbmUgbGVuZ3RoXG4gICAgICBpZiAoeSA9PT0gYnVmZmVyLmxvYygpKSB7IC8vIG9uIGVuZCBvZiBmaWxlXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGdvIHRvIGVuZCBvZiBsaW5lIG9uIGxhc3QgbGluZVxuICAgICAgICBicmVhazsgLy8gYW5kIGV4aXRcbiAgICAgIH1cbiAgICAgIHggLT0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoICsgMTsgLy8gd3JhcCB0aGlzIGxpbmUgbGVuZ3RoXG4gICAgICB5ICs9IDE7IC8vIGFuZCBtb3ZlIGRvd24gYSBsaW5lXG4gICAgfVxuICB9XG5cbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJ5TGluZXMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR5KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHkgPCAwKSB7IC8vIGdvaW5nIHVwXG4gICAgaWYgKHkgKyBkeSA+IDApIHsgLy8gd2hlbiBsaW5lcyBhYm92ZVxuICAgICAgeSArPSBkeTsgLy8gbW92ZSB1cFxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gMDtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZHkgPiAwKSB7IC8vIGdvaW5nIGRvd25cbiAgICBpZiAoeSA8IGJ1ZmZlci5sb2MoKSAtIGR5KSB7IC8vIHdoZW4gbGluZXMgYmVsb3dcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgZG93blxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gYnVmZmVyLmxvYygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmICh4ID4gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpIHtcbiAgLy8gICB4ID0gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGg7XG4gIC8vIH0gZWxzZSB7XG4gIC8vIH1cbiAgeCA9IE1hdGgubWluKHRoaXMubGFzdERlbGliZXJhdGVYLCBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGgpO1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZMaW5lID0gZnVuY3Rpb24oXywgcCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZMaW5lID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUocC55KS5sZW5ndGg7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gSW5maW5pdHk7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkZpbGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9O1xufTtcblxubW92ZS5lbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IGxhc3RcbiAgfTtcbn07XG5cbm1vdmUuaXNCZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgcmV0dXJuIHAueCA9PT0gMCAmJiBwLnkgPT09IDA7XG59O1xuXG5tb3ZlLmlzRW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICByZXR1cm4gcC55ID09PSBsYXN0ICYmIHAueCA9PT0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoO1xufTtcblxuT2JqZWN0LmtleXMobW92ZSkuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgTW92ZS5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKHBhcmFtLCBieUVkaXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbW92ZVttZXRob2RdLmNhbGwoXG4gICAgICB0aGlzLFxuICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLFxuICAgICAgdGhpcy5lZGl0b3IuY2FyZXQsXG4gICAgICBwYXJhbVxuICAgICk7XG5cbiAgICBpZiAoJ2lzJyA9PT0gbWV0aG9kLnNsaWNlKDAsMikpIHJldHVybiByZXN1bHQ7XG5cbiAgICB0aGlzLmVtaXQoJ21vdmUnLCByZXN1bHQsIGJ5RWRpdCk7XG4gIH07XG59KTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZWRpdG9yXCI6XCJfc3JjX3N0eWxlX19lZGl0b3JcIixcImxheWVyXCI6XCJfc3JjX3N0eWxlX19sYXllclwiLFwicm93c1wiOlwiX3NyY19zdHlsZV9fcm93c1wiLFwibWFya1wiOlwiX3NyY19zdHlsZV9fbWFya1wiLFwiY29kZVwiOlwiX3NyY19zdHlsZV9fY29kZVwiLFwiY2FyZXRcIjpcIl9zcmNfc3R5bGVfX2NhcmV0XCIsXCJibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2JsaW5rLXNtb290aFwiLFwiY2FyZXQtYmxpbmstc21vb3RoXCI6XCJfc3JjX3N0eWxlX19jYXJldC1ibGluay1zbW9vdGhcIixcImd1dHRlclwiOlwiX3NyY19zdHlsZV9fZ3V0dGVyXCIsXCJydWxlclwiOlwiX3NyY19zdHlsZV9fcnVsZXJcIixcImFib3ZlXCI6XCJfc3JjX3N0eWxlX19hYm92ZVwiLFwiZmluZFwiOlwiX3NyY19zdHlsZV9fZmluZFwiLFwiYmxvY2tcIjpcIl9zcmNfc3R5bGVfX2Jsb2NrXCJ9IiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG52YXIgdGhlbWVzID0ge1xuICBtb25va2FpOiB7XG4gICAgYmFja2dyb3VuZDogJyMyNzI4MjInLFxuICAgIGNvbG9yOiAnI0Y4RjhGMicsXG4gICAga2V5d29yZDogJyNERjIyNjYnLFxuICAgIGZ1bmN0aW9uOiAnI0EwRDkyRScsXG4gICAgZGVjbGFyZTogJyM2MUNDRTAnLFxuICAgIG51bWJlcjogJyNBQjdGRkInLFxuICAgIHBhcmFtczogJyNGRDk3MUYnLFxuICAgIGNvbW1lbnQ6ICcjNzU3MTVFJyxcbiAgICBzdHJpbmc6ICcjRTZEQjc0JyxcbiAgfSxcblxuICB3ZXN0ZXJuOiB7XG4gICAgYmFja2dyb3VuZDogJyNEOUQxQjEnLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyM3QTNCM0InLFxuICAgIGZ1bmN0aW9uOiAnIzI1NkY3NScsXG4gICAgZGVjbGFyZTogJyM2MzQyNTYnLFxuICAgIG51bWJlcjogJyMxMzREMjYnLFxuICAgIHBhcmFtczogJyMwODI2NjMnLFxuICAgIGNvbW1lbnQ6ICcjOTk4RTZFJyxcbiAgICBzdHJpbmc6ICcjQzQzQzNDJyxcbiAgfSxcblxuICByZWRibGlzczoge1xuICAgIGJhY2tncm91bmQ6ICcjMjcxRTE2JyxcbiAgICBjb2xvcjogJyNFOUUzRDEnLFxuICAgIGtleXdvcmQ6ICcjQTEzNjMwJyxcbiAgICBmdW5jdGlvbjogJyNCM0RGMDInLFxuICAgIGRlY2xhcmU6ICcjRjYzODMzJyxcbiAgICBudW1iZXI6ICcjRkY5RjRFJyxcbiAgICBwYXJhbXM6ICcjQTA5MEEwJyxcbiAgICByZWdleHA6ICcjQkQ3MEY0JyxcbiAgICBjb21tZW50OiAnIzYzNTA0NycsXG4gICAgc3RyaW5nOiAnIzNFQTFGQicsXG4gIH0sXG5cbiAgZGF5bGlnaHQ6IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0VCRUJFQicsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnI0ZGMUIxQicsXG4gICAgZnVuY3Rpb246ICcjMDAwNUZGJyxcbiAgICBkZWNsYXJlOiAnIzBDN0EwMCcsXG4gICAgbnVtYmVyOiAnIzgwMjFENCcsXG4gICAgcGFyYW1zOiAnIzRDNjk2OScsXG4gICAgY29tbWVudDogJyNBQkFCQUInLFxuICAgIHN0cmluZzogJyNFNjcwMDAnLFxuICB9LFxufTtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gc2V0VGhlbWU7XG5leHBvcnRzLnRoZW1lcyA9IHRoZW1lcztcblxuLypcbnQ6IG9wZXJhdG9yXG5rOiBrZXl3b3JkXG5kOiBkZWNsYXJlXG5iOiBidWlsdGluXG5vOiBib29sZWFuXG5uOiBudW1iZXJcbm06IHBhcmFtc1xuZjogZnVuY3Rpb25cbnI6IHJlZ2V4cFxuYzogY29tbWVudFxuczogc3RyaW5nXG5sOiBzeW1ib2xcbng6IGluZGVudFxuICovXG5mdW5jdGlvbiBzZXRUaGVtZShuYW1lKSB7XG4gIHZhciB0ID0gdGhlbWVzW25hbWVdO1xuICBkb20uY3NzKCd0aGVtZScsXG5gXG4uJHtuYW1lfSB7XG4gIGJhY2tncm91bmQ6ICR7dC5iYWNrZ3JvdW5kfTtcbn1cblxudCxcbmsge1xuICBjb2xvcjogJHt0LmtleXdvcmR9O1xufVxuXG5kLFxubiB7XG4gIGNvbG9yOiAke3QuZGVjbGFyZX07XG59XG5cbm8sXG5lIHtcbiAgY29sb3I6ICR7dC5udW1iZXJ9O1xufVxuXG5tIHtcbiAgY29sb3I6ICR7dC5wYXJhbXN9O1xufVxuXG5mIHtcbiAgY29sb3I6ICR7dC5mdW5jdGlvbn07XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxuciB7XG4gIGNvbG9yOiAke3QucmVnZXhwIHx8IHQucGFyYW1zfTtcbn1cblxuYyB7XG4gIGNvbG9yOiAke3QuY29tbWVudH07XG59XG5cbnMge1xuICBjb2xvcjogJHt0LnN0cmluZ307XG59XG5cbmwsXG4uJHtjc3MuY29kZX0ge1xuICBjb2xvcjogJHt0LmNvbG9yfTtcbn1cblxuLiR7Y3NzLmNhcmV0fSB7XG4gIGJhY2tncm91bmQ6ICR7dC5jb2xvcn07XG59XG5cbm0sXG5kIHtcbiAgZm9udC1zdHlsZTogaXRhbGljO1xufVxuXG5sIHtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG54IHtcbiAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICBiYWNrZ3JvdW5kLXJlcGVhdDogbm8tcmVwZWF0O1xufVxuYFxuICApXG5cbn1cblxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvY2tWaWV3O1xuXG5mdW5jdGlvbiBCbG9ja1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAnYmxvY2snO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuYmxvY2spO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuQmxvY2tWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQmxvY2tWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuQmxvY2tWaWV3LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihlKSB7XG4gIHZhciBodG1sID0gJyc7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcblxuICB2YXIgcmVzdWx0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5T2Zmc2V0KCdibG9ja3MnLCBvZmZzZXQpO1xuICBpZiAoIXJlc3VsdCkgcmV0dXJuIGh0bWw7XG5cbiAgdmFyIGxlbmd0aCA9IGUuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdibG9ja3MnKS5sZW5ndGg7XG4gIHZhciBjaGFyID0gZS5idWZmZXIuY2hhckF0KHJlc3VsdCk7XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgaSA9IHJlc3VsdC5pbmRleDtcbiAgdmFyIG9wZW5PZmZzZXQgPSByZXN1bHQub2Zmc2V0O1xuXG4gIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG5cbiAgdmFyIGNvdW50ID0gcmVzdWx0Lm9mZnNldCA+PSBvZmZzZXQgLSAxICYmIENsb3NlW2NoYXJdID8gMCA6IDE7XG5cbiAgdmFyIGxpbWl0ID0gMjAwO1xuXG4gIHdoaWxlIChpID4gMCkge1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAoIS0tbGltaXQpIHJldHVybiBodG1sO1xuXG4gICAgaWYgKG9wZW4gJiYgIS0tY291bnQpIGJyZWFrO1xuXG4gICAgb3Blbk9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCAtLWkpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIGNvdW50ID0gMTtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59XG5cbkJsb2NrVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBodG1sID0gdGhpcy5nZXQodGhpcy5lZGl0b3IpO1xuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuICAgIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICB9XG59O1xuXG5CbG9ja1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENhcmV0VmlldztcblxuZnVuY3Rpb24gQ2FyZXRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2NhcmV0JztcbiAgdGhpcy5kb20gPSBkb20oY3NzLmNhcmV0KTtcbn1cblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuQ2FyZXRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBvcGFjaXR5OiArdGhpcy5lZGl0b3IuaGFzRm9jdXMsXG4gICAgbGVmdDogdGhpcy5lZGl0b3IuY2FyZXRQeC54ICsgdGhpcy5lZGl0b3IubWFyZ2luTGVmdCxcbiAgICB0b3A6IHRoaXMuZWRpdG9yLmNhcmV0UHgueSAtIDEsXG4gICAgaGVpZ2h0OiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCArIDFcbiAgfSk7XG59O1xuXG5DYXJldFZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgb3BhY2l0eTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwidmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxudmFyIEFoZWFkVGhyZXNob2xkID0ge1xuICBhbmltYXRpb246IFsuMTUsIC40XSxcbiAgbm9ybWFsOiBbLjc1LCAxLjVdXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGVWaWV3O1xuXG5mdW5jdGlvbiBDb2RlVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG5cbiAgdGhpcy5uYW1lID0gJ2NvZGUnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuY29kZSk7XG4gIHRoaXMucGFydHMgPSBbXTtcbn1cblxuQ29kZVZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Db2RlVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRoaXMudGFyZ2V0ID0gdGFyZ2V0O1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhcnQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydCA9IG5ldyBQYXJ0KHRoaXMsIHJhbmdlKTtcbiAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICBwYXJ0LnJlbmRlcigpO1xuICBwYXJ0LmFwcGVuZCgpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMF0pO1xuICBpZiAoZWRpdC5zaGlmdCA+IDApIHRoaXMucmVuZGVySW5zZXJ0KGVkaXQpO1xuICBlbHNlIGlmIChlZGl0LnNoaWZ0IDwgMCkgdGhpcy5yZW5kZXJSZW1vdmUoZWRpdCk7XG4gIGVsc2UgdGhpcy5yZW5kZXJMaW5lKGVkaXQpO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5QYXJ0cyA9IHRoaXMuaW5SYW5nZVBhcnRzKHBhZ2UpO1xuICB2YXIgbmVlZFJhbmdlcyA9IFJhbmdlLk5PVChwYWdlLCB0aGlzLnBhcnRzKTtcbiAgbmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHRoaXMucmVuZGVyUGFydChyYW5nZSkpO1xuICBpblBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LnJlbmRlcigpKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJSZW1vdmUgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPiBlZGl0LnJhbmdlWzBdICYmIHBhcnRbMV0gPCBlZGl0LnJhbmdlWzFdKSB7XG4gICAgICB0aGlzLnJlbW92ZVBhcnQocGFydCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA9PT0gZWRpdC5saW5lKSB7XG4gICAgICBwYXJ0LnJlbmRlcigpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+IGVkaXQubGluZSkge1xuICAgICAgdGhpcy5yZW1vdmVQYXJ0KHBhcnQpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KFtlZGl0LmxpbmUsIGVkaXQubGluZV0pO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID4gZWRpdC5saW5lICYmIHBhcnRbMF0gKyBlZGl0LnNoaWZ0IDw9IGVkaXQubGluZSkge1xuICAgICAgdmFyIG9mZnNldCA9IGVkaXQubGluZSAtIChwYXJ0WzBdICsgZWRpdC5zaGlmdCkgKyAxO1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0ICsgb2Zmc2V0O1xuICAgICAgcGFydC5vZmZzZXQob2Zmc2V0KTtcbiAgICAgIGlmIChwYXJ0WzBdID49IHBhcnRbMV0pIHRoaXMucmVtb3ZlUGFydChwYXJ0KTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA+IGVkaXQubGluZSkge1xuICAgICAgcGFydFswXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydFsxXSArPSBlZGl0LnNoaWZ0O1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW5kZXJJbnNlcnQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciBwYXJ0cyA9IHRoaXMucGFydHMuc2xpY2UoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gcGFydHNbaV07XG4gICAgaWYgKHBhcnRbMF0gPCBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgICBlbHNlIGlmIChwYXJ0WzBdID09PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnQucmVuZGVyKCk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHBhcnRbMF0gPiBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMF0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnRbMV0gKz0gZWRpdC5zaGlmdDtcbiAgICAgIHBhcnQuc3R5bGUoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJQYWdlKCk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyTGluZSA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cy5zbGljZSgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSBwYXJ0c1tpXTtcbiAgICBpZiAocGFydFswXSA9PT0gZWRpdC5saW5lICYmIHBhcnRbMV0gPT09IGVkaXQubGluZSkge1xuICAgICAgcGFydC5yZW5kZXIoKTtcbiAgICB9XG4gICAgZWxzZSBpZiAocGFydFswXSA8PSBlZGl0LmxpbmUgJiYgcGFydFsxXSA+PSBlZGl0LmxpbmUpIHtcbiAgICAgIHBhcnRbMV0gPSBlZGl0LmxpbmUgLSAxO1xuICAgICAgaWYgKHBhcnRbMV0gPCBwYXJ0WzBdKSB0aGlzLnJlbW92ZVBhcnQocGFydClcbiAgICAgIGVsc2UgcGFydC5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYXJ0KGVkaXQucmFuZ2UpO1xuICAgIH1cbiAgfVxuICB0aGlzLnJlbmRlclBhZ2UoKTtcbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5yZW1vdmVQYXJ0ID0gZnVuY3Rpb24ocGFydCkge1xuICBwYXJ0LmNsZWFyKCk7XG4gIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihwYXJ0KSwgMSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuY2xlYXJPdXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLm91dFJhbmdlUGFydHModGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHJhbmdlKSlcbiAgICAuZm9yRWFjaChwYXJ0ID0+IHRoaXMucmVtb3ZlUGFydChwYXJ0KSk7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUuaW5SYW5nZVBhcnRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJ0ID0gdGhpcy5wYXJ0c1tpXTtcbiAgICBpZiAoIHBhcnRbMF0gPj0gcmFuZ2VbMF0gJiYgcGFydFswXSA8PSByYW5nZVsxXVxuICAgICAgfHwgcGFydFsxXSA+PSByYW5nZVswXSAmJiBwYXJ0WzFdIDw9IHJhbmdlWzFdICkge1xuICAgICAgcGFydHMucHVzaChwYXJ0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuQ29kZVZpZXcucHJvdG90eXBlLm91dFJhbmdlUGFydHMgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnQgPSB0aGlzLnBhcnRzW2ldO1xuICAgIGlmICggcGFydFsxXSA8IHJhbmdlWzBdXG4gICAgICB8fCBwYXJ0WzBdID4gcmFuZ2VbMV0gKSB7XG4gICAgICBwYXJ0cy5wdXNoKHBhcnQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG5Db2RlVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0aW5nKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuXG4gIGlmIChSYW5nZS5OT1QocGFnZSwgdGhpcy5wYXJ0cykubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKFJhbmdlLkFORChwYWdlLCB0aGlzLnBhcnRzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgICB0aGlzLnJlbmRlclBhcnQocGFnZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIHRocmVzaG9sZCA9IHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzBdXVxuICAgIDogWy1BaGVhZFRocmVzaG9sZC5ub3JtYWxbMF0sICtBaGVhZFRocmVzaG9sZC5ub3JtYWxbMF1dO1xuXG4gIHZhciBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gIHZhciBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdGhpcy5wYXJ0cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG5cbiAgICB0aHJlc2hvbGQgPSB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgICA/IFstQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdLCArQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdXVxuICAgICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFsxXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFsxXV07XG5cbiAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG5cbiAgICBhaGVhZFJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gICAgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHRoaXMucGFydHMpO1xuICAgIGFoZWFkTmVlZFJhbmdlcy5mb3JFYWNoKHJhbmdlID0+IHtcbiAgICAgIHRoaXMucmVuZGVyUGFydChyYW5nZSk7XG4gICAgfSk7XG4gIH1cbn07XG5cbkNvZGVWaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhcnRzLmZvckVhY2gocGFydCA9PiBwYXJ0LmNsZWFyKCkpO1xuICB0aGlzLnBhcnRzID0gW107XG59O1xuXG5mdW5jdGlvbiBQYXJ0KHZpZXcsIHJhbmdlKSB7XG4gIHRoaXMudmlldyA9IHZpZXc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5jb2RlKTtcbiAgdGhpcy5jb2RlID0gJyc7XG4gIHRoaXMub2Zmc2V0VG9wID0gMDtcbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG5cbiAgdmFyIHN0eWxlID0ge307XG5cbiAgaWYgKHRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMudmlldy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnMuaW5kZXhPZih0aGlzLnZpZXcubmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICAgIHN0eWxlLm9wYWNpdHkgPSAwLjU7XG4gIH1cblxuICBkb20uc3R5bGUodGhpcywgc3R5bGUpO1xufVxuXG5QYXJ0LnByb3RvdHlwZS5vZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMub2Zmc2V0VG9wICs9IHk7XG4gIHRoaXMuY29kZSA9IHRoaXMuY29kZS5zcGxpdCgvXFxuL2cpLnNsaWNlKHkpLmpvaW4oJ1xcbicpO1xuICB0aGlzWzFdIC09IHk7XG4gIHRoaXMuc3R5bGUoKTtcbiAgdGhpcy5kb20uZWwuc2Nyb2xsVG9wID0gdGhpcy5vZmZzZXRUb3AgKiB0aGlzLnZpZXcuZWRpdG9yLmNoYXIuaGVpZ2h0O1xufTtcblxuUGFydC5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5hcHBlbmQodGhpcy52aWV3LnRhcmdldCwgdGhpcyk7XG59O1xuXG5QYXJ0LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLnZpZXcuZWRpdG9yLmJ1ZmZlci5nZXQodGhpcyk7XG4gIGlmIChjb2RlICE9PSB0aGlzLmNvZGUpIHtcbiAgICBkb20uaHRtbCh0aGlzLCBjb2RlKTtcbiAgICB0aGlzLmNvZGUgPSBjb2RlO1xuICB9XG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblBhcnQucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAodGhpc1sxXSAtIHRoaXNbMF0gKyAxKSAqIHRoaXMudmlldy5lZGl0b3IuY2hhci5oZWlnaHQsXG4gICAgdG9wOiB0aGlzWzBdICogdGhpcy52aWV3LmVkaXRvci5jaGFyLmhlaWdodFxuICB9KTtcbn07XG5cblBhcnQucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5yZW1vdmUodGhpcyk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmluZFZpZXc7XG5cbmZ1bmN0aW9uIEZpbmRWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ2ZpbmQnO1xuICB0aGlzLmRvbSA9IGRvbShjc3MuZmluZCk7XG59XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuRmluZFZpZXcucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICBkb20uYXBwZW5kKHRhcmdldCwgdGhpcyk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIHJlc3VsdHMgPSBlLmZpbmRSZXN1bHRzO1xuXG4gIHZhciBiZWdpbiA9IDA7XG4gIHZhciBlbmQgPSByZXN1bHRzLmxlbmd0aDtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGkgPSAtMTtcblxuICBkbyB7XG4gICAgcHJldiA9IGk7XG4gICAgaSA9IGJlZ2luICsgKGVuZCAtIGJlZ2luKSAvIDIgfCAwO1xuICAgIGlmIChyZXN1bHRzW2ldLnkgPCByYW5nZVswXSAtIDEpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHByZXYgIT09IGkpO1xuXG4gIHZhciB3aWR0aCA9IGUuZmluZFZhbHVlLmxlbmd0aCAqIGUuY2hhci53aWR0aCArICdweCc7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgdmFyIHRhYnM7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgdGFicyA9IGUuZ2V0UG9pbnRUYWJzKHIpO1xuICAgIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICAgICsgJ3dpZHRoOicgKyB3aWR0aCArICc7J1xuICAgICAgICAgICsgJ3RvcDonICsgKHIueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgICArICdsZWZ0OicgKyAoKHIueCArIHRhYnMudGFicyAqIGUudGFiU2l6ZSAtIHRhYnMucmVtYWluZGVyKVxuICAgICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICAgKyAnXCI+PC9pPic7XG4gIH1cblxuICByZXR1cm4gaHRtbDtcbn07XG5cbkZpbmRWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5maW5kLmlzT3BlbiB8fCAhdGhpcy5lZGl0b3IuZmluZFJlc3VsdHMubGVuZ3RoKSByZXR1cm47XG5cbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UoWy0uNSwrLjVdKTtcbiAgdmFyIGh0bWwgPSB0aGlzLmdldChwYWdlLCB0aGlzLmVkaXRvcik7XG5cbiAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG59O1xuXG5GaW5kVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLmh0bWwodGhpcywgJycpO1xufTtcbiIsInZhciBSdWxlclZpZXcgPSByZXF1aXJlKCcuL3J1bGVyJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBDb2RlVmlldyA9IHJlcXVpcmUoJy4vY29kZScpO1xudmFyIENhcmV0VmlldyA9IHJlcXVpcmUoJy4vY2FyZXQnKTtcbnZhciBCbG9ja1ZpZXcgPSByZXF1aXJlKCcuL2Jsb2NrJyk7XG52YXIgRmluZFZpZXcgPSByZXF1aXJlKCcuL2ZpbmQnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdzO1xuXG5mdW5jdGlvbiBWaWV3cyhlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG5cbiAgdGhpcy52aWV3cyA9IFtcbiAgICBuZXcgUnVsZXJWaWV3KGVkaXRvciksXG4gICAgbmV3IE1hcmtWaWV3KGVkaXRvciksXG4gICAgbmV3IENvZGVWaWV3KGVkaXRvciksXG4gICAgbmV3IENhcmV0VmlldyhlZGl0b3IpLFxuICAgIG5ldyBCbG9ja1ZpZXcoZWRpdG9yKSxcbiAgICBuZXcgRmluZFZpZXcoZWRpdG9yKSxcbiAgICBuZXcgUm93c1ZpZXcoZWRpdG9yKSxcbiAgXTtcblxuICB0aGlzLnZpZXdzLmZvckVhY2godmlldyA9PiB0aGlzW3ZpZXcubmFtZV0gPSB2aWV3KTtcbiAgdGhpcy5mb3JFYWNoID0gdGhpcy52aWV3cy5mb3JFYWNoLmJpbmQodGhpcy52aWV3cyk7XG59XG5cblZpZXdzLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnVzZShlbCkpO1xufTtcblxuVmlld3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnJlbmRlcigpKTtcbn07XG5cblZpZXdzLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hcmtWaWV3O1xuXG5mdW5jdGlvbiBNYXJrVmlldyhlZGl0b3IpIHtcbiAgVmlldy5jYWxsKHRoaXMsIGVkaXRvcik7XG4gIHRoaXMubmFtZSA9ICdtYXJrJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLm1hcmspO1xufVxuXG5NYXJrVmlldy5wcm90b3R5cGUuX19wcm90b19fID0gVmlldy5wcm90b3R5cGU7XG5cbk1hcmtWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBtYXJrID0gZS5tYXJrLmdldCgpO1xuICBpZiAocmFuZ2VbMF0gPiBtYXJrLmVuZC55KSByZXR1cm4gZmFsc2U7XG4gIGlmIChyYW5nZVsxXSA8IG1hcmsuYmVnaW4ueSkgcmV0dXJuIGZhbHNlO1xuXG4gIHZhciBvZmZzZXRzID0gZS5idWZmZXIuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBhcmVhID0gZS5idWZmZXIuZ2V0QXJlYU9mZnNldFJhbmdlKG1hcmspO1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG5cbiAgYXJlYVswXSAtPSBvZmZzZXRzWzBdO1xuICBhcmVhWzFdIC09IG9mZnNldHNbMF07XG5cbiAgdmFyIGFib3ZlID0gY29kZS5zdWJzdHJpbmcoMCwgYXJlYVswXSk7XG4gIHZhciBtaWRkbGUgPSBjb2RlLnN1YnN0cmluZyhhcmVhWzBdLCBhcmVhWzFdKTtcbiAgdmFyIGh0bWwgPSBlLnN5bnRheC5lbnRpdGllcyhhYm92ZSlcbiAgICArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbk1hcmtWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcblxuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShbLS41LCsuNV0pO1xuICB2YXIgaHRtbCA9IHRoaXMuZ2V0KHBhZ2UsIHRoaXMuZWRpdG9yKTtcblxuICBkb20uaHRtbCh0aGlzLCBodG1sKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHRvcDogcGFnZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgIGhlaWdodDogJ2F1dG8nXG4gIH0pO1xufTtcblxuTWFya1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMFxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb3dzVmlldztcblxuZnVuY3Rpb24gUm93c1ZpZXcoZWRpdG9yKSB7XG4gIFZpZXcuY2FsbCh0aGlzLCBlZGl0b3IpO1xuICB0aGlzLm5hbWUgPSAncm93cyc7XG4gIHRoaXMuZG9tID0gZG9tKGNzcy5yb3dzKTtcbiAgdGhpcy5yb3dzID0gLTE7XG4gIHRoaXMucmFuZ2UgPSBbLTEsLTFdO1xuICB0aGlzLmh0bWwgPSAnJztcbn1cblxuUm93c1ZpZXcucHJvdG90eXBlLl9fcHJvdG9fXyA9IFZpZXcucHJvdG90eXBlO1xuXG5Sb3dzVmlldy5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIGRvbS5hcHBlbmQodGFyZ2V0LCB0aGlzKTtcbn07XG5cblJvd3NWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMSwrMV0pO1xuXG4gIGlmICggcmFuZ2VbMF0gPj0gdGhpcy5yYW5nZVswXVxuICAgICYmIHJhbmdlWzFdIDw9IHRoaXMucmFuZ2VbMV1cbiAgICAmJiAoIHRoaXMucmFuZ2VbMV0gIT09IHRoaXMucm93c1xuICAgICAgfHwgdGhpcy5lZGl0b3Iucm93cyA9PT0gdGhpcy5yb3dzXG4gICAgKSkgcmV0dXJuO1xuXG4gIHJhbmdlID0gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKFstMywrM10pO1xuICB0aGlzLnJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICB0aGlzLnJhbmdlID0gcmFuZ2U7XG5cbiAgdmFyIGh0bWwgPSAnJztcbiAgZm9yICh2YXIgaSA9IHJhbmdlWzBdOyBpIDw9IHJhbmdlWzFdOyBpKyspIHtcbiAgICBodG1sICs9IChpICsgMSkgKyAnXFxuJztcbiAgfVxuXG4gIGlmIChodG1sICE9PSB0aGlzLmh0bWwpIHtcbiAgICB0aGlzLmh0bWwgPSBodG1sO1xuXG4gICAgZG9tLmh0bWwodGhpcywgaHRtbCk7XG5cbiAgICBkb20uc3R5bGUodGhpcywge1xuICAgICAgdG9wOiByYW5nZVswXSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0LFxuICAgICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHRcbiAgICB9KTtcbiAgfVxufTtcblxuUm93c1ZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgaGVpZ2h0OiAwXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJ1bGVyVmlldztcblxuZnVuY3Rpb24gUnVsZXJWaWV3KGVkaXRvcikge1xuICBWaWV3LmNhbGwodGhpcywgZWRpdG9yKTtcbiAgdGhpcy5uYW1lID0gJ3J1bGVyJztcbiAgdGhpcy5kb20gPSBkb20oY3NzLnJ1bGVyKTtcbn1cblxuUnVsZXJWaWV3LnByb3RvdHlwZS5fX3Byb3RvX18gPSBWaWV3LnByb3RvdHlwZTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgZG9tLmFwcGVuZCh0YXJnZXQsIHRoaXMpO1xufTtcblxuUnVsZXJWaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAodGhpcy5lZGl0b3Iucm93cyArIHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0KVxuICAgICAgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodFxuICAgICAgKyB0aGlzLmVkaXRvci5wYWdlUmVtYWluZGVyLmhlaWdodFxuICB9KTtcbn07XG5cblJ1bGVyVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBoZWlnaHQ6IDBcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cbmZ1bmN0aW9uIFZpZXcoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xufVxuXG5WaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdyZW5kZXIgbm90IGltcGxlbWVudGVkJyk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ2NsZWFyIG5vdCBpbXBsZW1lbnRlZCcpO1xufTtcbiJdfQ==
