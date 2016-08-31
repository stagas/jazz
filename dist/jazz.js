(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Jazz
 */

var DefaultOptions = {
  theme: 'western',
  debug_layers: false,
  scroll_speed: 95,
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

Jazz.prototype.setCaret = function(p) {
  this.caret.set(p);

  var tabs = this.getPointTabs(this.caret);

  this.caretPx.set({
    x: this.char.width * (this.caret.x + tabs.tabs * this.tabSize - tabs.remainder),
    y: this.char.height * this.caret.y
  });

  this.followCaret();
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
  return this.getRange([
    Math.floor(p.y + this.page.height * range[0]),
    Math.ceil(p.y + this.page.height + this.page.height * range[1])
  ]);
};

Jazz.prototype.getLineLength = function(y) {
  return this.buffer.getLine(y).length;
};

Jazz.prototype.followCaret = function() {
  var p = this.caretPx;
  var s = this.animationScrollTarget || this.scroll;

  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + this.size.height) + this.char.height;

  var left = (s.x + this.char.width) - p.x;
  var right = (p.x) - (s.x + this.size.width - this.marginLeft) + this.char.width * 2;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  // if (!this.animationRunning)
  if (left + top + right + bottom) {
    this.scrollBy(right - left, bottom - top);
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

  if ((adx < 1 && ady < 1) || !this.animationRunning) {
    this.animationRunning = false;
    this.scrollTo(this.animationScrollTarget);
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
    #${this.id} > .${css.ruler},
    #${this.id} > .${css.layer} > .${css.find},
    #${this.id} > .${css.layer} > .${css.mark},
    #${this.id} > .${css.layer} > .${css.code} {
      padding-left: ${this.options.margin_left + this.gutter}px;
      tab-size: ${this.tabSize};
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

Buffer.prototype.setText = function(text) {
  text = normalizeEOL(text);

  this.raw = text //this.syntax.highlight(text);

  this.syntax.tab = ~this.raw.indexOf('\t') ? '\t' : ' ';

  this.text = new SkipString;
  this.text.set(this.raw);

  this.tokens = new Tokens;
  this.tokens.index(this.raw);

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

var Blocks = R(['comment','string','regexp'], 'gm');

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
  // code = code.replace(/\n/g, '<br>')

  // code = code.replace(/\ueeee/g, function() {
  //   return long.shift().slice(0, this.maxLine) + '...line too long to display';
  // });

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

function sortByNumber(a, b) {
  return a - b;
}

Tokens.prototype.update = function(range, text, shift) {
  var insert = new Tokens(Array);
  insert.index(text, range[0]);
  for (var type in this.tokens) {
    this.tokens[type].shiftOffset(range[0], shift);
    // if (shift < 0) range[1] += shift;
    this.tokens[type].removeRange(range);
    this.tokens[type].insert(range[0], insert.tokens[type]);
  }
  // console.log(range)
  // console.log(this.tokens.lines.toArray())
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

},{"./parts":27}],33:[function(require,module,exports){
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
    new View('caret', editor, template.caret),
    new CodeView('code', editor, template.code),
    new MarkView('mark', editor, template.mark),
    new RowsView('rows', editor, template.rows),
    // new FindView('find', editor, template.find),
    new BlockView('block', editor, template.block),
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

Layer.prototype.renderPageBelow = function(y) {
  this.renderRange([y, this.getPageRange([0,0])[1]]);
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
    if (results[i].y < range[0]) begin = i;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwibGliL3RyaW0uanMiLCJzcmMvYnVmZmVyL2luZGV4LmpzIiwic3JjL2J1ZmZlci9pbmRleGVyLmpzIiwic3JjL2J1ZmZlci9wYXJ0cy5qcyIsInNyYy9idWZmZXIvcHJlZml4dHJlZS5qcyIsInNyYy9idWZmZXIvc2VnbWVudHMuanMiLCJzcmMvYnVmZmVyL3NraXBzdHJpbmcuanMiLCJzcmMvYnVmZmVyL3N5bnRheC5qcyIsInNyYy9idWZmZXIvdG9rZW5zLmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwNkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25NQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TEE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEphenpcbiAqL1xuXG52YXIgRGVmYXVsdE9wdGlvbnMgPSB7XG4gIHRoZW1lOiAnd2VzdGVybicsXG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogOTUsXG4gIGhpZGVfcm93czogZmFsc2UsXG4gIGNlbnRlcjogZmFsc2UsXG4gIG1hcmdpbl9sZWZ0OiAxNSxcbiAgZ3V0dGVyX21hcmdpbjogMjAsXG59O1xuXG5yZXF1aXJlKCcuL2xpYi9zZXQtaW1tZWRpYXRlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi9saWIvZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vbGliL2RpZmYnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbGliL21lcmdlJyk7XG52YXIgY2xvbmUgPSByZXF1aXJlKCcuL2xpYi9jbG9uZScpO1xudmFyIGJpbmRSYWYgPSByZXF1aXJlKCcuL2xpYi9iaW5kLXJhZicpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4vbGliL3JlZ2V4cCcpO1xudmFyIERpYWxvZyA9IHJlcXVpcmUoJy4vbGliL2RpYWxvZycpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi9saWIvcG9pbnQnKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4vbGliL3JhbmdlJyk7XG52YXIgQXJlYSA9IHJlcXVpcmUoJy4vbGliL2FyZWEnKTtcbnZhciBCb3ggPSByZXF1aXJlKCcuL2xpYi9ib3gnKTtcblxudmFyIERlZmF1bHRCaW5kaW5ncyA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L2JpbmRpbmdzJyk7XG52YXIgSGlzdG9yeSA9IHJlcXVpcmUoJy4vc3JjL2hpc3RvcnknKTtcbnZhciBJbnB1dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0Jyk7XG52YXIgRmlsZSA9IHJlcXVpcmUoJy4vc3JjL2ZpbGUnKTtcbnZhciBNb3ZlID0gcmVxdWlyZSgnLi9zcmMvbW92ZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC90ZXh0Jyk7XG52YXIgVmlld3MgPSByZXF1aXJlKCcuL3NyYy92aWV3cycpO1xudmFyIHRoZW1lID0gcmVxdWlyZSgnLi9zcmMvdGhlbWUnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3NyYy9zdHlsZS5jc3MnKTtcblxudmFyIE5FV0xJTkUgPSBSZWdleHAuY3JlYXRlKFsnbmV3bGluZSddLCAnZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEpheno7XG5cbmZ1bmN0aW9uIEphenoob3B0aW9ucykge1xuICB0aGlzLm9wdGlvbnMgPSBtZXJnZShjbG9uZShEZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMgfHwge30pO1xuXG4gIE9iamVjdC5hc3NpZ24odGhpcywge1xuICAgIGVsOiBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG5cbiAgICBpZDogJ2phenpfJyArIChNYXRoLnJhbmRvbSgpICogMTBlNiB8IDApLnRvU3RyaW5nKDM2KSxcbiAgICBmaWxlOiBuZXcgRmlsZSxcbiAgICBtb3ZlOiBuZXcgTW92ZSh0aGlzKSxcbiAgICB2aWV3czogbmV3IFZpZXdzKHRoaXMpLFxuICAgIGlucHV0OiBuZXcgSW5wdXQodGhpcyksXG4gICAgaGlzdG9yeTogbmV3IEhpc3RvcnkodGhpcyksXG5cbiAgICBiaW5kaW5nczogeyBzaW5nbGU6IHt9IH0sXG5cbiAgICBmaW5kOiBuZXcgRGlhbG9nKCdGaW5kJywgVGV4dC5tYXApLFxuICAgIGZpbmRWYWx1ZTogJycsXG4gICAgZmluZE5lZWRsZTogMCxcbiAgICBmaW5kUmVzdWx0czogW10sXG5cbiAgICBzY3JvbGw6IG5ldyBQb2ludCxcbiAgICBvZmZzZXQ6IG5ldyBQb2ludCxcbiAgICBzaXplOiBuZXcgQm94LFxuICAgIGNoYXI6IG5ldyBCb3gsXG5cbiAgICBwYWdlOiBuZXcgQm94LFxuICAgIHBhZ2VQb2ludDogbmV3IFBvaW50LFxuICAgIHBhZ2VSZW1haW5kZXI6IG5ldyBCb3gsXG4gICAgcGFnZUJvdW5kczogbmV3IFJhbmdlLFxuXG4gICAgbG9uZ2VzdExpbmU6IDAsXG4gICAgZ3V0dGVyOiAwLFxuICAgIGNvZGU6IDAsXG4gICAgcm93czogMCxcblxuICAgIHRhYlNpemU6IDIsXG4gICAgdGFiOiAnICAnLFxuXG4gICAgY2FyZXQ6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG4gICAgY2FyZXRQeDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcblxuICAgIGhhc0ZvY3VzOiBmYWxzZSxcblxuICAgIG1hcms6IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICAgIH0pLFxuXG4gICAgZWRpdGluZzogZmFsc2UsXG4gICAgZWRpdExpbmU6IC0xLFxuICAgIGVkaXRSYW5nZTogWy0xLC0xXSxcbiAgICBlZGl0U2hpZnQ6IDAsXG5cbiAgICBzdWdnZXN0SW5kZXg6IDAsXG4gICAgc3VnZ2VzdFJvb3Q6ICcnLFxuICAgIHN1Z2dlc3ROb2RlczogW10sXG5cbiAgICBhbmltYXRpb25GcmFtZTogLTEsXG4gICAgYW5pbWF0aW9uUnVubmluZzogZmFsc2UsXG4gICAgYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0OiBudWxsLFxuICB9KTtcblxuICBkb20uYXBwZW5kKHRoaXMudmlld3MuY2FyZXQsIHRoaXMuaW5wdXQudGV4dCk7XG4gIGRvbS5hcHBlbmQodGhpcywgdGhpcy52aWV3cyk7XG5cbiAgLy8gdXNlZnVsIHNob3J0Y3V0c1xuICB0aGlzLmJ1ZmZlciA9IHRoaXMuZmlsZS5idWZmZXI7XG4gIHRoaXMuYnVmZmVyLm1hcmsgPSB0aGlzLm1hcms7XG4gIHRoaXMuc3ludGF4ID0gdGhpcy5idWZmZXIuc3ludGF4O1xuXG4gIHRoZW1lKHRoaXMub3B0aW9ucy50aGVtZSk7XG5cbiAgdGhpcy5iaW5kTWV0aG9kcygpO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5KYXp6LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkphenoucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsLCBzY3JvbGxFbCkge1xuICBpZiAodGhpcy5yZWYpIHtcbiAgICB0aGlzLmVsLnJlbW92ZUF0dHJpYnV0ZSgnaWQnKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUoY3NzLmVkaXRvcik7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gICAgdGhpcy5vZmZTY3JvbGwoKTtcbiAgICB0aGlzLnJlZi5mb3JFYWNoKHJlZiA9PiB7XG4gICAgICBkb20uYXBwZW5kKGVsLCByZWYpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHRoaXMucmVmID0gW10uc2xpY2UuY2FsbCh0aGlzLmVsLmNoaWxkcmVuKTtcbiAgICBkb20uYXBwZW5kKGVsLCB0aGlzLmVsKTtcbiAgICBkb20ub25yZXNpemUodGhpcy5vblJlc2l6ZSk7XG4gIH1cblxuICB0aGlzLmVsID0gZWw7XG4gIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdpZCcsIHRoaXMuaWQpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQoY3NzLmVkaXRvcik7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZCh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICB0aGlzLm9mZlNjcm9sbCA9IGRvbS5vbnNjcm9sbChzY3JvbGxFbCB8fCB0aGlzLmVsLCB0aGlzLm9uU2Nyb2xsKTtcbiAgdGhpcy5pbnB1dC51c2UodGhpcy5lbCk7XG5cbiAgc2V0VGltZW91dCh0aGlzLnJlcGFpbnQsIDApO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYXNzaWduID0gZnVuY3Rpb24oYmluZGluZ3MpIHtcbiAgdGhpcy5iaW5kaW5ncyA9IGJpbmRpbmdzO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLmZpbGUub3BlbihwYXRoLCByb290LCBmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHRoaXMuZmlsZS5zYXZlKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0LCBwYXRoKSB7XG4gIHRoaXMuZmlsZS5zZXQodGV4dCk7XG4gIHRoaXMuZmlsZS5wYXRoID0gcGF0aCB8fCB0aGlzLmZpbGUucGF0aDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5mb2N1cyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5ibHVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbi5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmluZEhhbmRsZXJzKClcbiAgdGhpcy5tb3ZlLm9uKCdtb3ZlJywgdGhpcy5vbk1vdmUpO1xuICB0aGlzLmZpbGUub24oJ3JhdycsIHRoaXMub25GaWxlUmF3KTsgLy9UT0RPOiBzaG91bGQgbm90IG5lZWQgdGhpcyBldmVudFxuICB0aGlzLmZpbGUub24oJ3NldCcsIHRoaXMub25GaWxlU2V0KTtcbiAgdGhpcy5maWxlLm9uKCdvcGVuJywgdGhpcy5vbkZpbGVPcGVuKTtcbiAgdGhpcy5maWxlLm9uKCdjaGFuZ2UnLCB0aGlzLm9uRmlsZUNoYW5nZSk7XG4gIHRoaXMuZmlsZS5vbignYmVmb3JlIGNoYW5nZScsIHRoaXMub25CZWZvcmVGaWxlQ2hhbmdlKTtcbiAgdGhpcy5oaXN0b3J5Lm9uKCdjaGFuZ2UnLCB0aGlzLm9uSGlzdG9yeUNoYW5nZSk7XG4gIHRoaXMuaW5wdXQub24oJ2JsdXInLCB0aGlzLm9uQmx1cik7XG4gIHRoaXMuaW5wdXQub24oJ2ZvY3VzJywgdGhpcy5vbkZvY3VzKTtcbiAgdGhpcy5pbnB1dC5vbignaW5wdXQnLCB0aGlzLm9uSW5wdXQpO1xuICB0aGlzLmlucHV0Lm9uKCd0ZXh0JywgdGhpcy5vblRleHQpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXlzJywgdGhpcy5vbktleXMpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXknLCB0aGlzLm9uS2V5KTtcbiAgdGhpcy5pbnB1dC5vbignY3V0JywgdGhpcy5vbkN1dCk7XG4gIHRoaXMuaW5wdXQub24oJ2NvcHknLCB0aGlzLm9uQ29weSk7XG4gIHRoaXMuaW5wdXQub24oJ3Bhc3RlJywgdGhpcy5vblBhc3RlKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2V1cCcsIHRoaXMub25Nb3VzZVVwKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2Vkb3duJywgdGhpcy5vbk1vdXNlRG93bik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlY2xpY2snLCB0aGlzLm9uTW91c2VDbGljayk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZ2JlZ2luJywgdGhpcy5vbk1vdXNlRHJhZ0JlZ2luKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnJywgdGhpcy5vbk1vdXNlRHJhZyk7XG4gIHRoaXMuZmluZC5vbignc3VibWl0JywgdGhpcy5maW5kSnVtcC5iaW5kKHRoaXMsIDEpKTtcbiAgdGhpcy5maW5kLm9uKCd2YWx1ZScsIHRoaXMub25GaW5kVmFsdWUpO1xuICB0aGlzLmZpbmQub24oJ2tleScsIHRoaXMub25GaW5kS2V5KTtcbiAgdGhpcy5maW5kLm9uKCdvcGVuJywgdGhpcy5vbkZpbmRPcGVuKTtcbiAgdGhpcy5maW5kLm9uKCdjbG9zZScsIHRoaXMub25GaW5kQ2xvc2UpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25TY3JvbGwgPSBmdW5jdGlvbihzY3JvbGwpIHtcbiAgdGhpcy5zY3JvbGwuc2V0KHNjcm9sbCk7XG4gIGlmICghdGhpcy5lZGl0aW5nKSB0aGlzLnJlbmRlcigpO1xuICB0aGlzLnJlc3QoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlc3QgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIHRoaXMucmVuZGVyKCk7XG59LCAzMDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikgdGhpcy5tYXJrU2V0KCk7XG4gICAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIHRoaXMuY2FyZXRTb2xpZCgpO1xuICBpZiAoIXRoaXMuZWRpdGluZykgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Gb2N1cyA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IHRydWU7XG4gIHRoaXMuZW1pdCgnZm9jdXMnKTtcbiAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgdGhpcy5jYXJldFNvbGlkKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldFNvbGlkID0gZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgdGhpcy5jYXJldEJsaW5rKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jYXJldEJsaW5rID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXQsIGNzc1snYmxpbmstc21vb3RoJ11dKTtcbn0sIDQwMCk7XG5cbkphenoucHJvdG90eXBlLm9uQmx1ciA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IGZhbHNlO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHtcbiAgICAgIGRvbS5jbGFzc2VzKHRoaXMudmlld3MuY2FyZXQsIFtjc3MuY2FyZXRdKTtcbiAgICAgIHRoaXMuZW1pdCgnYmx1cicpO1xuICAgICAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgICB9XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKGtleXMgaW4gdGhpcy5iaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5cyBpbiBEZWZhdWx0QmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmIChrZXkgaW4gdGhpcy5iaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleSBpbiBEZWZhdWx0QmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHRoaXMub25Db3B5KGUpO1xuICB0aGlzLmRlbGV0ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Db3B5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0VGFiTW9kZSA9IGZ1bmN0aW9uKGNoYXIpIHtcbiAgaWYgKCdcXHQnID09PSBjaGFyKSB7XG4gICAgdGhpcy50YWIgPSBjaGFyO1xuICB9IGVsc2Uge1xuICAgIHRoaXMudGFiID0gbmV3IEFycmF5KHRoaXMudGFiU2l6ZSArIDEpLmpvaW4oY2hhcik7XG4gIH1cbn1cblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgLy8gdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIC8vIHRoaXMuc2V0VGFiTW9kZSh0aGlzLmJ1ZmZlci5zeW50YXgudGFiKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSGlzdG9yeUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVwYWludCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJlZm9yZUZpbGVDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgLy8gdGhpcy5oaXN0b3J5LnNhdmUoKTtcbiAgdGhpcy5lZGl0Q2FyZXRCZWZvcmUgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKGVkaXRSYW5nZSwgZWRpdFNoaWZ0LCB0ZXh0QmVmb3JlLCB0ZXh0QWZ0ZXIpIHtcbiAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gIHRoaXMuZWRpdGluZyA9IHRydWU7XG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcblxuICBpZiAodGhpcy5maW5kLmlzT3Blbikge1xuICAgIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUsIHRydWUpO1xuICB9XG5cbiAgLy8gdGhpcy5oaXN0b3J5LnNhdmUoKTtcblxuICB0aGlzLnZpZXdzLmNvZGUucmVuZGVyRWRpdCh7XG4gICAgbGluZTogZWRpdFJhbmdlWzBdLFxuICAgIHJhbmdlOiBlZGl0UmFuZ2UsXG4gICAgc2hpZnQ6IGVkaXRTaGlmdCxcbiAgICBjYXJldE5vdzogdGhpcy5jYXJldCxcbiAgICBjYXJldEJlZm9yZTogdGhpcy5lZGl0Q2FyZXRCZWZvcmVcbiAgfSk7XG5cbiAgdGhpcy5yZW5kZXIoKTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXRGcm9tUHggPSBmdW5jdGlvbihweCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMubWFyZ2luTGVmdCwgeTogdGhpcy5jaGFyLmhlaWdodC8yIH0pWycrJ10odGhpcy5vZmZzZXQpO1xuICB2YXIgcCA9IHB4WyctJ10oZylbJysnXSh0aGlzLnNjcm9sbClbJ28vJ10odGhpcy5jaGFyKTtcblxuICBwLnkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihwLnksIHRoaXMuYnVmZmVyLmxvYygpKSk7XG4gIHAueCA9IE1hdGgubWF4KDAsIHAueCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldENvb3Jkc1RhYnMocCk7XG5cbiAgcC54ID0gTWF0aC5tYXgoXG4gICAgMCxcbiAgICBNYXRoLm1pbihcbiAgICAgIHAueCAtIHRhYnMudGFicyArIHRhYnMucmVtYWluZGVyLFxuICAgICAgdGhpcy5nZXRMaW5lTGVuZ3RoKHAueSlcbiAgICApXG4gICk7XG5cbiAgdGhpcy5zZXRDYXJldChwKTtcbiAgdGhpcy5tb3ZlLmxhc3REZWxpYmVyYXRlWCA9IHAueDtcbiAgdGhpcy5vbk1vdmUoKTtcblxuICByZXR1cm4gcDtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VVcCA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHRoaXMuYmx1cigpO1xuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEb3duID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQodGhpcy5mb2N1cy5iaW5kKHRoaXMpLCAxMCk7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0KSB0aGlzLm1hcmtCZWdpbigpO1xuICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy5jYXJldC5zZXQocCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldFBvaW50VGFicyh0aGlzLmNhcmV0KTtcblxuICB0aGlzLmNhcmV0UHguc2V0KHtcbiAgICB4OiB0aGlzLmNoYXIud2lkdGggKiAodGhpcy5jYXJldC54ICsgdGFicy50YWJzICogdGhpcy50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpLFxuICAgIHk6IHRoaXMuY2hhci5oZWlnaHQgKiB0aGlzLmNhcmV0LnlcbiAgfSk7XG5cbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZUNsaWNrID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjbGlja3MgPSB0aGlzLmlucHV0Lm1vdXNlLmNsaWNrcztcbiAgaWYgKGNsaWNrcyA+IDEpIHtcbiAgICB2YXIgYXJlYTtcblxuICAgIGlmIChjbGlja3MgPT09IDIpIHtcbiAgICAgIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXJlYUF0UG9pbnQodGhpcy5jYXJldCk7XG4gICAgfSBlbHNlIGlmIChjbGlja3MgPT09IDMpIHtcbiAgICAgIHZhciB5ID0gdGhpcy5jYXJldC55O1xuICAgICAgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgICAgYmVnaW46IHsgeDogMCwgeTogeSB9LFxuICAgICAgICBlbmQ6IHsgeDogdGhpcy5nZXRMaW5lTGVuZ3RoKHkpLCB5OiB5IH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLnNldENhcmV0KGFyZWEuZW5kKTtcbiAgICAgIHRoaXMubWFya1NldEFyZWEoYXJlYSk7XG4gICAgICAvLyB0aGlzLnJlbmRlcigpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UuZG93bik7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0JlZ2luID0gZnVuY3Rpb24oYXJlYSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gdHJ1ZTtcbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB9IGVsc2UgaWYgKGFyZWEgIT09IGZhbHNlIHx8IHRoaXMubWFyay5iZWdpbi54ID09PSAtMSkge1xuICAgICAgdGhpcy5tYXJrLmJlZ2luLnNldCh0aGlzLmNhcmV0KTtcbiAgICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLm1hcmtCZWdpbihhcmVhKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtDbGVhciA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0ICYmICFmb3JjZSkgcmV0dXJuO1xuXG4gIHRoaXMubWFyay5hY3RpdmUgPSBmYWxzZTtcbiAgdGhpcy5tYXJrLnNldCh7XG4gICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICB9KTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIFJhbmdlLmNsYW1wKHJhbmdlLCB0aGlzLnBhZ2VCb3VuZHMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHAgPSB0aGlzLnNjcm9sbFsnXy8nXSh0aGlzLmNoYXIpO1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDtcbn07XG5cbkphenoucHJvdG90eXBlLmZvbGxvd0NhcmV0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwID0gdGhpcy5jYXJldFB4O1xuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHZhciB0b3AgPSBzLnkgLSBwLnk7XG4gIHZhciBib3R0b20gPSAocC55KSAtIChzLnkgKyB0aGlzLnNpemUuaGVpZ2h0KSArIHRoaXMuY2hhci5oZWlnaHQ7XG5cbiAgdmFyIGxlZnQgPSAocy54ICsgdGhpcy5jaGFyLndpZHRoKSAtIHAueDtcbiAgdmFyIHJpZ2h0ID0gKHAueCkgLSAocy54ICsgdGhpcy5zaXplLndpZHRoIC0gdGhpcy5tYXJnaW5MZWZ0KSArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgaWYgKGJvdHRvbSA8IDApIGJvdHRvbSA9IDA7XG4gIGlmICh0b3AgPCAwKSB0b3AgPSAwO1xuICBpZiAobGVmdCA8IDApIGxlZnQgPSAwO1xuICBpZiAocmlnaHQgPCAwKSByaWdodCA9IDA7XG5cbiAgLy8gaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpXG4gIGlmIChsZWZ0ICsgdG9wICsgcmlnaHQgKyBib3R0b20pIHtcbiAgICB0aGlzLnNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbiAgfVxuICAvLyBlbHNlXG4gICAgLy8gdGhpcy5hbmltYXRlU2Nyb2xsQnkocmlnaHQgLSBsZWZ0LCBib3R0b20gLSB0b3ApO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsVG8gPSBmdW5jdGlvbihwKSB7XG4gIGRvbS5zY3JvbGxUbyh0aGlzLmVsLCBwLngsIHAueSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgdmFyIHRhcmdldCA9IFBvaW50Lmxvdyh7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH0sIHtcbiAgICB4OiB0aGlzLnNjcm9sbC54ICsgeCxcbiAgICB5OiB0aGlzLnNjcm9sbC55ICsgeVxuICB9KTtcblxuICBpZiAoUG9pbnQuc29ydCh0YXJnZXQsIHRoaXMuc2Nyb2xsKSAhPT0gMCkge1xuICAgIHRoaXMuc2Nyb2xsLnNldCh0YXJnZXQpO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5zY3JvbGwpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRlU2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIGlmICghdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IHRydWU7XG4gICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbik7XG4gIH1cblxuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1heCgwLCBzLnggKyB4KSxcbiAgICB5OiBNYXRoLm1pbigodGhpcy5yb3dzICsgMSkgKiB0aGlzLmNoYXIuaGVpZ2h0IC0gdGhpcy5zaXplLmhlaWdodCwgTWF0aC5tYXgoMCwgcy55ICsgeSkpXG4gIH0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICBkeCA9IE1hdGguc2lnbihkeCkgKiA1O1xuICBkeSA9IE1hdGguc2lnbihkeSkgKiA1O1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzcGVlZCA9IHRoaXMub3B0aW9ucy5zY3JvbGxfc3BlZWQ7XG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgdmFyIGFkeCA9IE1hdGguYWJzKGR4KTtcbiAgdmFyIGFkeSA9IE1hdGguYWJzKGR5KTtcblxuICBpZiAoYWR5ID49IHRoaXMuc2l6ZS5oZWlnaHQgKiAxLjIpIHtcbiAgICBzcGVlZCAqPSAyLjQ1O1xuICB9XG5cbiAgaWYgKChhZHggPCAxICYmIGFkeSA8IDEpIHx8ICF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNjcm9sbFRvKHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0KTtcbiAgICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG51bGw7XG4gICAgdGhpcy5lbWl0KCdhbmltYXRpb24gZW5kJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgaWYgKGFkeCA8IHNwZWVkKSBkeCAqPSAwLjk7XG4gIGVsc2UgZHggPSBNYXRoLnNpZ24oZHgpICogc3BlZWQ7XG5cbiAgaWYgKGFkeSA8IHNwZWVkKSBkeSAqPSAwLjk7XG4gIGVsc2UgZHkgPSBNYXRoLnNpZ24oZHkpICogc3BlZWQ7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24odGV4dCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkgdGhpcy5kZWxldGUoKTtcblxuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHRoaXMuY2FyZXQueSk7XG4gIHZhciByaWdodCA9IGxpbmVbdGhpcy5jYXJldC54XTtcbiAgdmFyIGhhc1JpZ2h0U3ltYm9sID0gflsnfScsJ10nLCcpJ10uaW5kZXhPZihyaWdodCk7XG5cbiAgLy8gYXBwbHkgaW5kZW50IG9uIGVudGVyXG4gIGlmIChORVdMSU5FLnRlc3QodGV4dCkpIHtcbiAgICB2YXIgaXNFbmRPZkxpbmUgPSB0aGlzLmNhcmV0LnggPT09IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgbGVmdCA9IGxpbmVbdGhpcy5jYXJldC54IC0gMV07XG4gICAgdmFyIGluZGVudCA9IGxpbmUubWF0Y2goL1xcUy8pO1xuICAgIGluZGVudCA9IGluZGVudCA/IGluZGVudC5pbmRleCA6IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgaGFzTGVmdFN5bWJvbCA9IH5bJ3snLCdbJywnKCddLmluZGV4T2YobGVmdCk7XG5cbiAgICBpZiAoaGFzTGVmdFN5bWJvbCkgaW5kZW50ICs9IDI7XG5cbiAgICBpZiAoaXNFbmRPZkxpbmUgfHwgaGFzTGVmdFN5bWJvbCkge1xuICAgICAgdGV4dCArPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBsZW5ndGg7XG5cbiAgaWYgKCFoYXNSaWdodFN5bWJvbCB8fCAoaGFzUmlnaHRTeW1ib2wgJiYgIX5bJ30nLCddJywnKSddLmluZGV4T2YodGV4dCkpKSB7XG4gICAgbGVuZ3RoID0gdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsIHRleHQpO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IDE7XG4gIH1cblxuICB0aGlzLm1vdmUuYnlDaGFycyhsZW5ndGgsIHRydWUpO1xuXG4gIGlmICgneycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnfScpO1xuICBlbHNlIGlmICgnKCcgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnKScpO1xuICBlbHNlIGlmICgnWycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXScpO1xuXG4gIGlmIChoYXNMZWZ0U3ltYm9sICYmIGhhc1JpZ2h0U3ltYm9sKSB7XG4gICAgaW5kZW50IC09IDI7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICdcXG4nICsgbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJhY2tzcGFjZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuIHRoaXMuZGVsZXRlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xLCB0cnVlKTtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZGVsZXRlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm4gdGhpcy5iYWNrc3BhY2UoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQ2hhckF0UG9pbnQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmZpbmRKdW1wID0gZnVuY3Rpb24oanVtcCkge1xuICBpZiAoIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIHx8ICF0aGlzLmZpbmQuaXNPcGVuKSByZXR1cm47XG5cbiAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kTmVlZGxlICsganVtcDtcbiAgaWYgKHRoaXMuZmluZE5lZWRsZSA+PSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IDA7XG4gIH0gZWxzZSBpZiAodGhpcy5maW5kTmVlZGxlIDwgMCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIC0gMTtcbiAgfVxuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0KTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlLCBub0p1bXApIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLmd1dHRlciwgeTogMCB9KTtcblxuICB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcblxuICB0aGlzLnZpZXdzLmZpbmQuY2xlYXIoKTtcblxuICB0aGlzLmZpbmRWYWx1ZSA9IHZhbHVlO1xuICAvLyBjb25zb2xlLnRpbWUoJ2ZpbmQgJyArIHZhbHVlKTtcbiAgdGhpcy5maW5kUmVzdWx0cyA9IHRoaXMuYnVmZmVyLmluZGV4ZXIuZmluZCh2YWx1ZSkubWFwKChvZmZzZXQpID0+IHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KG9mZnNldCk7XG4gICAgICAvL3B4OiBuZXcgUG9pbnQocG9pbnQpWycqJ10oZS5jaGFyKVsnKyddKGcpXG4gIH0pO1xuICAvLyBjb25zb2xlLnRpbWVFbmQoJ2ZpbmQgJyArIHZhbHVlKTtcblxuICB0aGlzLmZpbmQuaW5mbygnMC8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIGlmICghbm9KdW1wKSB0aGlzLmZpbmRKdW1wKDApO1xuXG4gIHRoaXMudmlld3MuZmluZC5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZEtleSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKH5bMzMsIDM0LCAxMTRdLmluZGV4T2YoZS53aGljaCkpIHsgLy8gcGFnZXVwLCBwYWdlZG93biwgZjNcbiAgICB0aGlzLmlucHV0LnRleHQub25rZXlkb3duKGUpO1xuICB9XG5cbiAgaWYgKDcwID09PSBlLndoaWNoICYmIGUuY3RybEtleSkgeyAvLyBjdHJsK2ZcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICg5ID09PSBlLndoaWNoKSB7IC8vIHRhYlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZmluZC5pbmZvKCcnKTtcbiAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRDbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnZpZXdzLmZpbmQuY2xlYXIoKTtcbiAgdGhpcy5mb2N1cygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc3VnZ2VzdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0LCB0cnVlKTtcbiAgaWYgKCFhcmVhKSByZXR1cm47XG5cbiAgdmFyIGtleSA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEpO1xuICBpZiAoIWtleSkgcmV0dXJuO1xuXG4gIGlmICghdGhpcy5zdWdnZXN0Um9vdFxuICAgIHx8IGtleS5zdWJzdHIoMCwgdGhpcy5zdWdnZXN0Um9vdC5sZW5ndGgpICE9PSB0aGlzLnN1Z2dlc3RSb290KSB7XG4gICAgdGhpcy5zdWdnZXN0SW5kZXggPSAwO1xuICAgIHRoaXMuc3VnZ2VzdFJvb3QgPSBrZXk7XG4gICAgdGhpcy5zdWdnZXN0Tm9kZXMgPSB0aGlzLmJ1ZmZlci5wcmVmaXguY29sbGVjdChrZXkpO1xuICB9XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGgpIHJldHVybjtcbiAgdmFyIG5vZGUgPSB0aGlzLnN1Z2dlc3ROb2Rlc1t0aGlzLnN1Z2dlc3RJbmRleF07XG5cbiAgdGhpcy5zdWdnZXN0SW5kZXggPSAodGhpcy5zdWdnZXN0SW5kZXggKyAxKSAlIHRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aDtcblxuICByZXR1cm4ge1xuICAgIGFyZWE6IGFyZWEsXG4gICAgbm9kZTogbm9kZVxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UG9pbnRUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyICsgdGFic1xuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0Q29vcmRzVGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFicyAqIHRoaXMudGFiU2l6ZSArIHJlbWFpbmRlciA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXJcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlcGFpbnQgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2l6ZSgpO1xuICB0aGlzLnJlbmRlcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgJCA9IHRoaXMuZWw7XG5cbiAgdGhpcy5vZmZzZXQuc2V0KGRvbS5nZXRPZmZzZXQoJCkpO1xuICB0aGlzLnNjcm9sbC5zZXQoZG9tLmdldFNjcm9sbCgkKSk7XG4gIHRoaXMuc2l6ZS5zZXQoZG9tLmdldFNpemUoJCkpO1xuXG4gIC8vIHRoaXMgaXMgYSB3ZWlyZCBmaXggd2hlbiBkb2luZyBtdWx0aXBsZSAudXNlKClcbiAgaWYgKHRoaXMuY2hhci53aWR0aCA9PT0gMCkgdGhpcy5jaGFyLnNldChkb20uZ2V0Q2hhclNpemUoJCwgY3NzLmNvZGUpKTtcblxuICB0aGlzLnJvd3MgPSB0aGlzLmJ1ZmZlci5sb2MoKTtcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG4gIHRoaXMucGFnZS5zZXQodGhpcy5zaXplWydeLyddKHRoaXMuY2hhcikpO1xuICB0aGlzLnBhZ2VSZW1haW5kZXIuc2V0KHRoaXMuc2l6ZVsnLSddKHRoaXMucGFnZVsnXyonXSh0aGlzLmNoYXIpKSk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuICAvLyB0aGlzLmxvbmdlc3RMaW5lID0gTWF0aC5taW4oNTAwLCB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMb25nZXN0TGluZUxlbmd0aCgpKTtcbiAgdGhpcy5ndXR0ZXIgPSBNYXRoLm1heChcbiAgICB0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aCxcbiAgICAodGhpcy5vcHRpb25zLmNlbnRlclxuICAgICAgPyAodGhpcy5wYWdlLndpZHRoIC0gODEpIC8gMiB8IDAgOiAwKVxuICAgICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3NcbiAgICAgID8gMCA6IE1hdGgubWF4KDMsICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpXG4gICkgKiB0aGlzLmNoYXIud2lkdGggKyAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiB0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbik7XG4gIHRoaXMubWFyZ2luTGVmdCA9IHRoaXMuZ3V0dGVyICsgdGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0O1xuXG4gIC8vIGRvbS5zdHlsZSh0aGlzLmVsLCB7XG4gIC8vICAgd2lkdGg6IHRoaXMubG9uZ2VzdExpbmUgKiB0aGlzLmNoYXIud2lkdGgsXG4gIC8vICAgaGVpZ2h0OiB0aGlzLnJvd3MgKiB0aGlzLmNoYXIuaGVpZ2h0XG4gIC8vIH0pO1xuXG4gIC8vVE9ETzogbWFrZSBtZXRob2QvdXRpbFxuICAvLyBkcmF3IGluZGVudCBpbWFnZVxuICB2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHZhciBmb28gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9vJyk7XG4gIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICBjYW52YXMuc2V0QXR0cmlidXRlKCd3aWR0aCcsIE1hdGguY2VpbCh0aGlzLmNoYXIud2lkdGggKiAyKSk7XG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ2hlaWdodCcsIHRoaXMuY2hhci5oZWlnaHQpO1xuXG4gIHZhciBjb21tZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYycpO1xuICAkLmFwcGVuZENoaWxkKGNvbW1lbnQpO1xuICB2YXIgY29sb3IgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShjb21tZW50KS5jb2xvcjtcbiAgJC5yZW1vdmVDaGlsZChjb21tZW50KTtcbiAgY3R4LnNldExpbmVEYXNoKFsxLDFdKTtcbiAgY3R4LmxpbmVEYXNoT2Zmc2V0ID0gMDtcbiAgY3R4LmJlZ2luUGF0aCgpO1xuICBjdHgubW92ZVRvKDAsMSk7XG4gIGN0eC5saW5lVG8oMCwgdGhpcy5jaGFyLmhlaWdodCk7XG4gIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICBjdHguc3Ryb2tlKCk7XG5cbiAgdmFyIGRhdGFVUkwgPSBjYW52YXMudG9EYXRhVVJMKCk7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MucnVsZXJ9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5maW5kfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MubWFya30sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmNvZGV9IHtcbiAgICAgIHBhZGRpbmctbGVmdDogJHt0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQgKyB0aGlzLmd1dHRlcn1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5yb3dzfSB7XG4gICAgICBwYWRkaW5nLXJpZ2h0OiAke3RoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2lufXB4O1xuICAgICAgbWFyZ2luLWxlZnQ6ICR7dGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0fXB4O1xuICAgICAgd2lkdGg6ICR7dGhpcy5ndXR0ZXJ9cHg7XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5maW5kfSA+IGksXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmJsb2NrfSA+IGkge1xuICAgICAgaGVpZ2h0OiAke3RoaXMuY2hhci5oZWlnaHQgKyAxfXB4O1xuICAgIH1cbiAgICB4IHtcbiAgICAgIGJhY2tncm91bmQtaW1hZ2U6IHVybCgke2RhdGFVUkx9KTtcbiAgICB9YFxuICApO1xuXG4gIHRoaXMuZW1pdCgncmVzaXplJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jbGVhciA9IGJpbmRSYWYoZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdjbGVhcicpXG4gIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICB0aGlzLnZpZXdzLmNsZWFyKCk7XG59KTtcblxuSmF6ei5wcm90b3R5cGUucmVuZGVyID0gYmluZFJhZihmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicpXG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG59KTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBBcmVhO1xuXG5mdW5jdGlvbiBBcmVhKGEpIHtcbiAgaWYgKGEpIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50KGEuYmVnaW4pO1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50KGEuZW5kKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50O1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50O1xuICB9XG59XG5cbkFyZWEucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHRoaXMpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzID0gW3RoaXMuYmVnaW4sIHRoaXMuZW5kXS5zb3J0KFBvaW50LnNvcnQpO1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoc1swXSksXG4gICAgZW5kOiBuZXcgUG9pbnQoc1sxXSlcbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMuYmVnaW4uc2V0KGFyZWEuYmVnaW4pO1xuICB0aGlzLmVuZC5zZXQoYXJlYS5lbmQpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0TGVmdCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy5iZWdpbi54ID0geDtcbiAgdGhpcy5lbmQueCA9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIGlmICh0aGlzLmJlZ2luLngpIHRoaXMuYmVnaW4ueCArPSB4O1xuICBpZiAodGhpcy5lbmQueCkgdGhpcy5lbmQueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZEJvdHRvbSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5lbmQueSArPSB5O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLnNoaWZ0QnlMaW5lcyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5iZWdpbi55ICs9IHk7XG4gIHRoaXMuZW5kLnkgKz0geTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+IGEuZW5kLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj0nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5iZWdpbi54ID49IGEuYmVnaW4ueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzwnXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5lbmQueCA8IGEuYmVnaW4ueFxuICAgIDogdGhpcy5lbmQueSA8IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PSddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuZW5kLnggPD0gYS5lbmQueFxuICAgIDogdGhpcy5lbmQueSA8IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPjwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+J10oYSkgJiYgdGhpc1snPCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzwnXShhKSB8fCB0aGlzWyc+J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj08J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+PSddKGEpICYmIHRoaXNbJzw9J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPD0nXShhKSB8fCB0aGlzWyc+PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz09PSddID1cbkFyZWEucHJvdG90eXBlLmVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi54ID09PSBhLmJlZ2luLnggJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICAgICYmIHRoaXMuZW5kLnggICA9PT0gYS5lbmQueCAgICYmIHRoaXMuZW5kLnkgICA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PSddID1cbkFyZWEucHJvdG90eXBlLmJlZ2luTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXwnXSA9XG5BcmVhLnByb3RvdHlwZS5lbmRMaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9fCddID1cbkFyZWEucHJvdG90eXBlLmxpbmVzRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyd8PSddKGEpICYmIHRoaXNbJz18J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXw9J10gPVxuQXJlYS5wcm90b3R5cGUuc2FtZUxpbmUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IHRoaXMuZW5kLnkgJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnLXgtJ10gPVxuQXJlYS5wcm90b3R5cGUuc2hvcnRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54ICsgeCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54IC0geCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJyt4KyddID1cbkFyZWEucHJvdG90eXBlLndpZGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggLSB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggKyB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0KGIuYmVnaW4sIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0KGIuZW5kLCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WCh4LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFgoeCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFkgPSBmdW5jdGlvbih5LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFkoeSwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRZKHksIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiAnJyArIGEuYmVnaW4gKyAnLScgKyBhLmVuZDtcbn07XG5cbkFyZWEuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA9PT0gYi5iZWdpbi55XG4gICAgPyBhLmJlZ2luLnggLSBiLmJlZ2luLnhcbiAgICA6IGEuYmVnaW4ueSAtIGIuYmVnaW4ueTtcbn07XG5cbkFyZWEudG9Qb2ludFNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPD0gYi55ICYmIGEuZW5kLnkgPj0gYi55XG4gICAgPyBhLmJlZ2luLnkgPT09IGIueVxuICAgICAgPyBhLmJlZ2luLnggLSBiLnhcbiAgICAgIDogYS5lbmQueSA9PT0gYi55XG4gICAgICAgID8gYS5lbmQueCAtIGIueFxuICAgICAgICA6IDBcbiAgICA6IGEuYmVnaW4ueSAtIGIueTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gYmluYXJ5U2VhcmNoO1xuXG5mdW5jdGlvbiBiaW5hcnlTZWFyY2goYXJyYXksIGNvbXBhcmUpIHtcbiAgdmFyIGluZGV4ID0gLTE7XG4gIHZhciBwcmV2ID0gLTE7XG4gIHZhciBsb3cgPSAwO1xuICB2YXIgaGlnaCA9IGFycmF5Lmxlbmd0aDtcbiAgaWYgKCFoaWdoKSByZXR1cm4ge1xuICAgIGl0ZW06IG51bGwsXG4gICAgaW5kZXg6IDBcbiAgfTtcblxuICBkbyB7XG4gICAgcHJldiA9IGluZGV4O1xuICAgIGluZGV4ID0gbG93ICsgKGhpZ2ggLSBsb3cgPj4gMSk7XG4gICAgdmFyIGl0ZW0gPSBhcnJheVtpbmRleF07XG4gICAgdmFyIHJlc3VsdCA9IGNvbXBhcmUoaXRlbSk7XG5cbiAgICBpZiAocmVzdWx0KSBsb3cgPSBpbmRleDtcbiAgICBlbHNlIGhpZ2ggPSBpbmRleDtcbiAgfSB3aGlsZSAocHJldiAhPT0gaW5kZXgpO1xuXG4gIGlmIChpdGVtICE9IG51bGwpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaXRlbTogaXRlbSxcbiAgICAgIGluZGV4OiBpbmRleFxuICAgIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGl0ZW06IG51bGwsXG4gICAgaW5kZXg6IH5sb3cgKiAtMSAtIDFcbiAgfTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4pIHtcbiAgdmFyIHJlcXVlc3Q7XG4gIHJldHVybiBmdW5jdGlvbiByYWZXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUocmVxdWVzdCk7XG4gICAgcmVxdWVzdCA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSk7XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEJveDtcblxuZnVuY3Rpb24gQm94KGIpIHtcbiAgaWYgKGIpIHtcbiAgICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xuICB9IGVsc2Uge1xuICAgIHRoaXMud2lkdGggPSAwO1xuICAgIHRoaXMuaGVpZ2h0ID0gMDtcbiAgfVxufVxuXG5Cb3gucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGIpIHtcbiAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG59O1xuXG5Cb3gucHJvdG90eXBlWycvJ10gPVxuQm94LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18vJ10gPVxuQm94LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeLyddID1cbkJveC5wcm90b3R5cGUuY2VpbGRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXionXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ28qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5yb3VuZCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGgucm91bmQodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnLSddID1cbkJveC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLSAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAtIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNsb25lKG9iaikge1xuICB2YXIgbyA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgdmFyIHZhbCA9IG9ialtrZXldO1xuICAgIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIHZhbCkge1xuICAgICAgb1trZXldID0gY2xvbmUodmFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb1trZXldID0gdmFsO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbiBkZWJvdW5jZVdyYXAoYSwgYiwgYywgZCkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICB0aW1lb3V0ID0gc2V0VGltZW91dChmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpLCBtcyk7XG4gICAgcmV0dXJuIHRpbWVvdXQ7XG4gIH1cbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vZG9tJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9ldmVudCcpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlhbG9nO1xuXG5mdW5jdGlvbiBEaWFsb2cobGFiZWwsIGtleW1hcCkge1xuICB0aGlzLm5vZGUgPSBkb20oY3NzLmRpYWxvZywgW1xuICAgIGA8bGFiZWw+JHtjc3MubGFiZWx9YCxcbiAgICBbY3NzLmlucHV0LCBbXG4gICAgICBgPGlucHV0PiR7Y3NzLnRleHR9YCxcbiAgICAgIGNzcy5pbmZvXG4gICAgXV1cbiAgXSk7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MubGFiZWxdLCBsYWJlbCk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogJ25vbmUnIH0pO1xuICB0aGlzLmtleW1hcCA9IGtleW1hcDtcbiAgdGhpcy5vbmJvZHlrZXlkb3duID0gdGhpcy5vbmJvZHlrZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmNsaWNrID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNldXAgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2Vkb3duID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xufVxuXG5EaWFsb2cucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuZnVuY3Rpb24gc3RvcFByb3BhZ2F0aW9uKGUpIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaGFzRm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLmhhc0ZvY3VzKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uYm9keWtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgyNyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDEzID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuc3VibWl0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChlLndoaWNoIGluIHRoaXMua2V5bWFwKSB7XG4gICAgdGhpcy5lbWl0KCdrZXknLCBlKTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3ZhbHVlJywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICBkb20uYXBwZW5kKGRvY3VtZW50LmJvZHksIHRoaXMubm9kZSk7XG4gIGRvbS5mb2N1cyh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0pO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwuc2VsZWN0KCk7XG4gIHRoaXMuaXNPcGVuID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdvcGVuJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIHRoaXMubm9kZS5lbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMubm9kZS5lbCk7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG4gIHRoaXMuZW1pdCgnY2xvc2UnKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuc3VibWl0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZW1pdCgnc3VibWl0JywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaW5mbyA9IGZ1bmN0aW9uKGluZm8pIHtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCBpbmZvKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiBpbmZvID8gJ2Jsb2NrJyA6ICdub25lJyB9KTtcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImRpYWxvZ1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2RpYWxvZ1wiLFwiaW5wdXRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbnB1dFwiLFwidGV4dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX3RleHRcIixcImxhYmVsXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fbGFiZWxcIixcImluZm9cIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbmZvXCJ9IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG5cbmZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBhKSB7XG4gICAgdmFyIGQgPSB7fTtcbiAgICB2YXIgaSA9IDA7XG4gICAgZm9yICh2YXIgayBpbiBiKSB7XG4gICAgICBpZiAoYVtrXSAhPT0gYltrXSkge1xuICAgICAgICBkW2tdID0gYltrXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaSkgcmV0dXJuIGQ7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGEgIT09IGI7XG4gIH1cbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9iaW5kLXJhZicpO1xudmFyIG1lbW9pemUgPSByZXF1aXJlKCcuL21lbW9pemUnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxudmFyIHVuaXRzID0ge1xuICBsZWZ0OiAncHgnLFxuICB0b3A6ICdweCcsXG4gIHJpZ2h0OiAncHgnLFxuICBib3R0b206ICdweCcsXG4gIHdpZHRoOiAncHgnLFxuICBoZWlnaHQ6ICdweCcsXG4gIG1heEhlaWdodDogJ3B4JyxcbiAgcGFkZGluZ0xlZnQ6ICdweCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRvbTtcblxuZnVuY3Rpb24gZG9tKG5hbWUsIGNoaWxkcmVuLCBhdHRycykge1xuICB2YXIgZWw7XG4gIHZhciB0YWcgPSAnZGl2JztcbiAgdmFyIG5vZGU7XG5cbiAgaWYgKCdzdHJpbmcnID09PSB0eXBlb2YgbmFtZSkge1xuICAgIGlmICgnPCcgPT09IG5hbWUuY2hhckF0KDApKSB7XG4gICAgICB2YXIgbWF0Y2hlcyA9IG5hbWUubWF0Y2goLyg/OjwpKC4qKSg/Oj4pKFxcUyspPy8pO1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGFnID0gbWF0Y2hlc1sxXTtcbiAgICAgICAgbmFtZSA9IG1hdGNoZXNbMl0gfHwgdGFnO1xuICAgICAgfVxuICAgIH1cbiAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgICBub2RlID0ge1xuICAgICAgZWw6IGVsLFxuICAgICAgbmFtZTogbmFtZS5zcGxpdCgnICcpWzBdXG4gICAgfTtcbiAgICBkb20uY2xhc3Nlcyhub2RlLCBuYW1lLnNwbGl0KCcgJykuc2xpY2UoMSkpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICByZXR1cm4gZG9tLmFwcGx5KG51bGwsIG5hbWUpO1xuICB9IGVsc2Uge1xuICAgIGlmICgnZG9tJyBpbiBuYW1lKSB7XG4gICAgICBub2RlID0gbmFtZS5kb207XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUgPSBuYW1lO1xuICAgIH1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGNoaWxkcmVuKSkge1xuICAgIGNoaWxkcmVuXG4gICAgICAubWFwKGRvbSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQsIGkpIHtcbiAgICAgICAgbm9kZVtjaGlsZC5uYW1lXSA9IGNoaWxkO1xuICAgICAgICByZXR1cm4gY2hpbGQ7XG4gICAgICB9KVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCkge1xuICAgICAgICBub2RlLmVsLmFwcGVuZENoaWxkKGNoaWxkLmVsKTtcbiAgICAgIH0pO1xuICB9IGVsc2UgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgY2hpbGRyZW4pIHtcbiAgICBkb20uc3R5bGUobm9kZSwgY2hpbGRyZW4pO1xuICB9XG5cbiAgaWYgKGF0dHJzKSB7XG4gICAgZG9tLmF0dHJzKG5vZGUsIGF0dHJzKTtcbiAgfVxuXG4gIHJldHVybiBub2RlO1xufVxuXG5kb20uc3R5bGUgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBfLCBzdHlsZSkge1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn0sIGRpZmYsIG1lcmdlLCBmdW5jdGlvbihub2RlLCBzdHlsZSkge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgc3R5bGVdO1xufSk7XG5cbi8qXG5kb20uc3R5bGUgPSBmdW5jdGlvbihlbCwgc3R5bGUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufTtcbiovXG5kb20uY2xhc3NlcyA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbC5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG59LCBudWxsLCBudWxsLCBmdW5jdGlvbihub2RlLCBjbGFzc2VzKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBjbGFzc2VzLmNvbmNhdChub2RlLm5hbWUpLmZpbHRlcihCb29sZWFuKS5qb2luKCcgJyldO1xufSk7XG5cbmRvbS5hdHRycyA9IGZ1bmN0aW9uKGVsLCBhdHRycykge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgT2JqZWN0LmFzc2lnbihlbCwgYXR0cnMpO1xufTtcblxuZG9tLmh0bWwgPSBmdW5jdGlvbihlbCwgaHRtbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn07XG5cbmRvbS50ZXh0ID0gZnVuY3Rpb24oZWwsIHRleHQpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLnRleHRDb250ZW50ID0gdGV4dDtcbn07XG5cbmRvbS5mb2N1cyA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5mb2N1cygpO1xufTtcblxuZG9tLmdldFNpemUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogZWwuY2xpZW50V2lkdGgsXG4gICAgaGVpZ2h0OiBlbC5jbGllbnRIZWlnaHRcbiAgfTtcbn07XG5cbmRvbS5nZXRDaGFyU2l6ZSA9IGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xuICBzcGFuLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcblxuICBlbC5hcHBlbmRDaGlsZChzcGFuKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgJztcbiAgdmFyIGEgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAgXFxuICc7XG4gIHZhciBiID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBlbC5yZW1vdmVDaGlsZChzcGFuKTtcblxuICByZXR1cm4ge1xuICAgIHdpZHRoOiAoYi53aWR0aCAtIGEud2lkdGgpLFxuICAgIGhlaWdodDogKGIuaGVpZ2h0IC0gYS5oZWlnaHQpXG4gIH07XG59O1xuXG5kb20uZ2V0T2Zmc2V0ID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgdmFyIGJvcmRlckxlZnQgPSBwYXJzZUludChzdHlsZS5ib3JkZXJMZWZ0V2lkdGgpO1xuICB2YXIgYm9yZGVyVG9wID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyVG9wV2lkdGgpO1xuICByZXR1cm4gUG9pbnQubG93KHsgeDogMCwgeTogMCB9LCB7XG4gICAgeDogKHJlY3QubGVmdCArIGJvcmRlckxlZnQpIHwgMCxcbiAgICB5OiAocmVjdC50b3AgKyBib3JkZXJUb3ApIHwgMFxuICB9KTtcbn07XG5cbmRvbS5nZXRTY3JvbGwgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIGdldFNjcm9sbChlbCk7XG59O1xuXG5kb20ub25zY3JvbGwgPSBmdW5jdGlvbiBvbnNjcm9sbChlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG5cbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH0gZWxzZSB7XG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVyKGV2KSB7XG4gICAgZm4oZ2V0U2Nyb2xsKGVsKSk7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gb2Zmc2Nyb2xsKCkge1xuICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG59O1xuXG5kb20ub25vZmZzZXQgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHdoaWxlIChlbCA9IGVsLm9mZnNldFBhcmVudCkge1xuICAgIGRvbS5vbnNjcm9sbChlbCwgZm4pO1xuICB9XG59O1xuXG5kb20ub25jbGljayA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICByZXR1cm4gZWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmbik7XG59O1xuXG5kb20ub25yZXNpemUgPSBmdW5jdGlvbihmbikge1xuICByZXR1cm4gd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcbn07XG5cbmRvbS5hcHBlbmQgPSBmdW5jdGlvbih0YXJnZXQsIHNyYywgZGljdCkge1xuICB0YXJnZXQgPSBkb20uZ2V0RWxlbWVudCh0YXJnZXQpO1xuICBpZiAoJ2ZvckVhY2gnIGluIHNyYykgc3JjLmZvckVhY2goZG9tLmFwcGVuZC5iaW5kKG51bGwsIHRhcmdldCkpO1xuICAvLyBlbHNlIGlmICgndmlld3MnIGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyYy52aWV3cywgdHJ1ZSk7XG4gIGVsc2UgaWYgKGRpY3QgPT09IHRydWUpIGZvciAodmFyIGtleSBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmNba2V5XSk7XG4gIGVsc2UgaWYgKCdmdW5jdGlvbicgIT0gdHlwZW9mIHNyYykgdGFyZ2V0LmFwcGVuZENoaWxkKGRvbS5nZXRFbGVtZW50KHNyYykpO1xufTtcblxuZG9tLnJlbW92ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBpZiAoZWwucGFyZW50Tm9kZSkgZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChlbCk7XG59O1xuXG5kb20uZ2V0RWxlbWVudCA9IGZ1bmN0aW9uKGVsKSB7XG4gIHJldHVybiBlbC5kb20gJiYgZWwuZG9tLmVsIHx8IGVsLmVsIHx8IGVsLm5vZGUgfHwgZWw7XG59O1xuXG5kb20uc2Nyb2xsQnkgPSBmdW5jdGlvbihlbCwgeCwgeSwgc2Nyb2xsKSB7XG4gIHNjcm9sbCA9IHNjcm9sbCB8fCBkb20uZ2V0U2Nyb2xsKGVsKTtcbiAgZG9tLnNjcm9sbFRvKGVsLCBzY3JvbGwueCArIHgsIHNjcm9sbC55ICsgeSk7XG59O1xuXG5kb20uc2Nyb2xsVG8gPSBmdW5jdGlvbihlbCwgeCwgeSkge1xuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICB3aW5kb3cuc2Nyb2xsVG8oeCwgeSk7XG4gIH0gZWxzZSB7XG4gICAgZWwuc2Nyb2xsTGVmdCA9IHggfHwgMDtcbiAgICBlbC5zY3JvbGxUb3AgPSB5IHx8IDA7XG4gIH1cbn07XG5cbmRvbS5jc3MgPSBiaW5kUmFmKGZ1bmN0aW9uKGlkLCBjc3NUZXh0KSB7XG4gIGlmICghKGlkIGluIGRvbS5jc3Muc3R5bGVzKSkge1xuICAgIGRvbS5jc3Muc3R5bGVzW2lkXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlc1tpZF0pO1xuICB9XG4gIGRvbS5jc3Muc3R5bGVzW2lkXS50ZXh0Q29udGVudCA9IGNzc1RleHQ7XG59KTtcblxuZG9tLmNzcy5zdHlsZXMgPSB7fTtcblxuZG9tLmdldE1vdXNlUG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiBnZXRTY3JvbGwoZWwpIHtcbiAgcmV0dXJuIGRvY3VtZW50LmJvZHkgPT09IGVsXG4gICAgPyB7XG4gICAgICAgIHg6IHdpbmRvdy5zY3JvbGxYIHx8IGVsLnNjcm9sbExlZnQgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbExlZnQsXG4gICAgICAgIHk6IHdpbmRvdy5zY3JvbGxZIHx8IGVsLnNjcm9sbFRvcCAgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbFRvcFxuICAgICAgfVxuICAgIDoge1xuICAgICAgICB4OiBlbC5zY3JvbGxMZWZ0LFxuICAgICAgICB5OiBlbC5zY3JvbGxUb3BcbiAgICAgIH07XG59XG4iLCJcbnZhciBwdXNoID0gW10ucHVzaDtcbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50O1xuXG5mdW5jdGlvbiBFdmVudCgpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEV2ZW50KSkgcmV0dXJuIG5ldyBFdmVudDtcblxuICB0aGlzLl9oYW5kbGVycyA9IHt9O1xufVxuXG5FdmVudC5wcm90b3R5cGUuX2dldEhhbmRsZXJzID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLl9oYW5kbGVycyA9IHRoaXMuX2hhbmRsZXJzIHx8IHt9O1xuICByZXR1cm4gdGhpcy5faGFuZGxlcnNbbmFtZV0gPSB0aGlzLl9oYW5kbGVyc1tuYW1lXSB8fCBbXTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24obmFtZSwgYSwgYiwgYywgZCkge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgIGhhbmRsZXJzW2ldKGEsIGIsIGMsIGQpO1xuICB9O1xufTtcblxuRXZlbnQucHJvdG90eXBlLm9uID0gZnVuY3Rpb24obmFtZSkge1xuICB2YXIgaGFuZGxlcnM7XG4gIHZhciBuZXdIYW5kbGVycyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICBuYW1lLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgICAgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgICAgIHB1c2guYXBwbHkoaGFuZGxlcnMsIG5ld0hhbmRsZXJzW25hbWVdKTtcbiAgICB9LCB0aGlzKTtcbiAgfSBlbHNlIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgIHB1c2guYXBwbHkoaGFuZGxlcnMsIG5ld0hhbmRsZXJzKTtcbiAgfVxufTtcblxuRXZlbnQucHJvdG90eXBlLm9mZiA9IGZ1bmN0aW9uKG5hbWUsIGhhbmRsZXIpIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBpbmRleCA9IGhhbmRsZXJzLmluZGV4T2YoaGFuZGxlcik7XG4gIGlmICh+aW5kZXgpIGhhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG59O1xuXG5FdmVudC5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKG5hbWUsIGZuKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGEsIGIsIGMsIGQpIHtcbiAgICBmbihhLCBiLCBjLCBkKTtcbiAgICBoYW5kbGVycy5zcGxpY2UoaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKSwgMSk7XG4gIH07XG4gIGhhbmRsZXJzLnB1c2goaGFuZGxlcik7XG59O1xuIiwidmFyIGNsb25lID0gcmVxdWlyZSgnLi9jbG9uZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1lbW9pemUoZm4sIGRpZmYsIG1lcmdlLCBwcmUpIHtcbiAgZGlmZiA9IGRpZmYgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYSAhPT0gYiB9O1xuICBtZXJnZSA9IG1lcmdlIHx8IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGIgfTtcbiAgcHJlID0gcHJlIHx8IGZ1bmN0aW9uKG5vZGUsIHBhcmFtKSB7IHJldHVybiBwYXJhbSB9O1xuXG4gIHZhciBub2RlcyA9IFtdO1xuICB2YXIgY2FjaGUgPSBbXTtcbiAgdmFyIHJlc3VsdHMgPSBbXTtcblxuICByZXR1cm4gZnVuY3Rpb24obm9kZSwgcGFyYW0pIHtcbiAgICB2YXIgYXJncyA9IHByZShub2RlLCBwYXJhbSk7XG4gICAgbm9kZSA9IGFyZ3NbMF07XG4gICAgcGFyYW0gPSBhcmdzWzFdO1xuXG4gICAgdmFyIGluZGV4ID0gbm9kZXMuaW5kZXhPZihub2RlKTtcbiAgICBpZiAofmluZGV4KSB7XG4gICAgICB2YXIgZCA9IGRpZmYoY2FjaGVbaW5kZXhdLCBwYXJhbSk7XG4gICAgICBpZiAoIWQpIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgICAgIGVsc2Uge1xuICAgICAgICBjYWNoZVtpbmRleF0gPSBtZXJnZShjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgICAgcmVzdWx0c1tpbmRleF0gPSBmbihub2RlLCBwYXJhbSwgZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhY2hlLnB1c2goY2xvbmUocGFyYW0pKTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBpbmRleCA9IHJlc3VsdHMucHVzaChmbihub2RlLCBwYXJhbSwgcGFyYW0pKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0c1tpbmRleF07XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1lcmdlKGRlc3QsIHNyYykge1xuICBmb3IgKHZhciBrZXkgaW4gc3JjKSB7XG4gICAgZGVzdFtrZXldID0gc3JjW2tleV07XG4gIH1cbiAgcmV0dXJuIGRlc3Q7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IG9wZW47XG5cbmZ1bmN0aW9uIG9wZW4odXJsLCBjYikge1xuICByZXR1cm4gZmV0Y2godXJsKVxuICAgIC50aGVuKGdldFRleHQpXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuXG5mdW5jdGlvbiBnZXRUZXh0KHJlcykge1xuICByZXR1cm4gcmVzLnRleHQoKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBQb2ludDtcblxuZnVuY3Rpb24gUG9pbnQocCkge1xuICBpZiAocCkge1xuICAgIHRoaXMueCA9IHAueDtcbiAgICB0aGlzLnkgPSBwLnk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy54ID0gMDtcbiAgICB0aGlzLnkgPSAwO1xuICB9XG59XG5cblBvaW50LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihwKSB7XG4gIHRoaXMueCA9IHAueDtcbiAgdGhpcy55ID0gcC55O1xufTtcblxuUG9pbnQucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh0aGlzKTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycvJ10gPVxuUG9pbnQucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18vJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvLyddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14vJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKyddID1cblBvaW50LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCArIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWyctJ10gPVxuUG9pbnQucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC0gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAtIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJyonXSA9XG5Qb2ludC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXionXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbE11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvKiddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZE11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18qJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAneDonICsgdGhpcy54ICsgJyx5OicgKyB0aGlzLnk7XG59O1xuXG5Qb2ludC5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUG9pbnQuZ3JpZFJvdW5kID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgucm91bmQoYS54IC8gYi53aWR0aCksXG4gICAgeTogTWF0aC5yb3VuZChhLnkgLyBiLmhlaWdodClcbiAgfTtcbn07XG5cblBvaW50LmxvdyA9IGZ1bmN0aW9uKGxvdywgcCkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgubWF4KGxvdy54LCBwLngpLFxuICAgIHk6IE1hdGgubWF4KGxvdy55LCBwLnkpXG4gIH07XG59O1xuXG5Qb2ludC5jbGFtcCA9IGZ1bmN0aW9uKGFyZWEsIHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5taW4oYXJlYS5lbmQueCwgTWF0aC5tYXgoYXJlYS5iZWdpbi54LCBwLngpKSxcbiAgICB5OiBNYXRoLm1pbihhcmVhLmVuZC55LCBNYXRoLm1heChhcmVhLmJlZ2luLnksIHAueSkpXG4gIH0pO1xufTtcblxuUG9pbnQub2Zmc2V0ID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4geyB4OiBhLnggKyBiLngsIHk6IGEueSArIGIueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIHApIHtcbiAgcmV0dXJuIHsgeDogcC54ICsgeCwgeTogcC55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRZID0gZnVuY3Rpb24oeSwgcCkge1xuICByZXR1cm4geyB4OiBwLngsIHk6IHAueSArIHkgfTtcbn07XG5cblBvaW50LnRvTGVmdFRvcCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIHtcbiAgICBsZWZ0OiBwLngsXG4gICAgdG9wOiBwLnlcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gQU5EO1xuXG5mdW5jdGlvbiBBTkQoYSwgYikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIG91dCA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSBhWzBdOyBpIDw9IGFbMV07IGkrKykge1xuICAgIGZvdW5kID0gZmFsc2U7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGIubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChpID49IGJbal1bMF0gJiYgaSA8PSBiW2pdWzFdKSB7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gTk9UO1xuXG5mdW5jdGlvbiBOT1QoYSwgYikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIG91dCA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSBhWzBdOyBpIDw9IGFbMV07IGkrKykge1xuICAgIGZvdW5kID0gZmFsc2U7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGIubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChpID49IGJbal1bMF0gJiYgaSA8PSBiW2pdWzFdKSB7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwidmFyIEFORCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1hbmQnKTtcbnZhciBOT1QgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtbm90Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUmFuZ2U7XG5cbmZ1bmN0aW9uIFJhbmdlKHIpIHtcbiAgaWYgKHIpIHtcbiAgICB0aGlzWzBdID0gclswXTtcbiAgICB0aGlzWzFdID0gclsxXTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzWzBdID0gMDtcbiAgICB0aGlzWzFdID0gMTtcbiAgfVxufTtcblxuUmFuZ2UuQU5EID0gQU5EO1xuUmFuZ2UuTk9UID0gTk9UO1xuXG5SYW5nZS5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUmFuZ2UuZXF1YWwgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhWzBdID09PSBiWzBdICYmIGFbMV0gPT09IGJbMV07XG59O1xuXG5SYW5nZS5jbGFtcCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZShbXG4gICAgTWF0aC5taW4oYlsxXSwgTWF0aC5tYXgoYVswXSwgYlswXSkpLFxuICAgIE1hdGgubWluKGFbMV0sIGJbMV0pXG4gIF0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UodGhpcyk7XG59O1xuXG5SYW5nZS5yYW5nZXMgPSBmdW5jdGlvbihpdGVtcykge1xuICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uKGl0ZW0pIHsgcmV0dXJuIGl0ZW0ucmFuZ2UgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPj0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA8PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3ZlcmxhcCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdIDw9IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPj0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVsxXSA8IHJhbmdlWzBdIHx8IGl0ZW0ucmFuZ2VbMF0gPiByYW5nZVsxXTtcbiAgfSk7XG59O1xuIiwiXG52YXIgUmVnZXhwID0gZXhwb3J0cztcblxuUmVnZXhwLmNyZWF0ZSA9IGZ1bmN0aW9uKG5hbWVzLCBmbGFncywgZm4pIHtcbiAgZm4gPSBmbiB8fCBmdW5jdGlvbihzKSB7IHJldHVybiBzIH07XG4gIHJldHVybiBuZXcgUmVnRXhwKFxuICAgIG5hbWVzXG4gICAgLm1hcCgobikgPT4gJ3N0cmluZycgPT09IHR5cGVvZiBuID8gUmVnZXhwLnR5cGVzW25dIDogbilcbiAgICAubWFwKChyKSA9PiBmbihyLnRvU3RyaW5nKCkuc2xpY2UoMSwtMSkpKVxuICAgIC5qb2luKCd8JyksXG4gICAgZmxhZ3NcbiAgKTtcbn07XG5cblJlZ2V4cC50eXBlcyA9IHtcbiAgJ3Rva2Vucyc6IC8uKz9cXGJ8LlxcQnxcXGIuKz8vLFxuICAnd29yZHMnOiAvW2EtekEtWjAtOV17MSx9LyxcbiAgJ3BhcnRzJzogL1suL1xcXFxcXChcXClcIidcXC06LC47PD5+IUAjJCVeJipcXHxcXCs9XFxbXFxde31gflxcPyBdKy8sXG5cbiAgJ3NpbmdsZSBjb21tZW50JzogL1xcL1xcLy4qPyQvLFxuICAnZG91YmxlIGNvbW1lbnQnOiAvXFwvXFwqW15dKj9cXCpcXC8vLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IC8oJyg/Oig/OlxcXFxcXG58XFxcXCd8W14nXFxuXSkpKj8nKS8sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogLyhcIig/Oig/OlxcXFxcXG58XFxcXFwifFteXCJcXG5dKSkqP1wiKS8sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAvKGAoPzooPzpcXFxcYHxbXmBdKSkqP2ApLyxcblxuICAnb3BlcmF0b3InOiAvIXw+PT98PD0/fD17MSwzfXwoPzomKXsxLDJ9fFxcfD9cXHx8XFw/fFxcKnxcXC98fnxcXF58JXxcXC4oPyFcXGQpfFxcK3sxLDJ9fFxcLXsxLDJ9LyxcbiAgJ2Z1bmN0aW9uJzogLyAoKD8hXFxkfFsuIF0qPyhpZnxlbHNlfGRvfGZvcnxjYXNlfHRyeXxjYXRjaHx3aGlsZXx3aXRofHN3aXRjaCkpW2EtekEtWjAtOV8gJF0rKSg/PVxcKC4qXFwpLip7KS8sXG4gICdrZXl3b3JkJzogL1xcYihicmVha3xjYXNlfGNhdGNofGNvbnN0fGNvbnRpbnVlfGRlYnVnZ2VyfGRlZmF1bHR8ZGVsZXRlfGRvfGVsc2V8ZXhwb3J0fGV4dGVuZHN8ZmluYWxseXxmb3J8ZnJvbXxpZnxpbXBsZW1lbnRzfGltcG9ydHxpbnxpbnN0YW5jZW9mfGludGVyZmFjZXxsZXR8bmV3fHBhY2thZ2V8cHJpdmF0ZXxwcm90ZWN0ZWR8cHVibGljfHJldHVybnxzdGF0aWN8c3VwZXJ8c3dpdGNofHRocm93fHRyeXx0eXBlb2Z8d2hpbGV8d2l0aHx5aWVsZClcXGIvLFxuICAnZGVjbGFyZSc6IC9cXGIoZnVuY3Rpb258aW50ZXJmYWNlfGNsYXNzfHZhcnxsZXR8Y29uc3R8ZW51bXx2b2lkKVxcYi8sXG4gICdidWlsdGluJzogL1xcYihPYmplY3R8RnVuY3Rpb258Qm9vbGVhbnxFcnJvcnxFdmFsRXJyb3J8SW50ZXJuYWxFcnJvcnxSYW5nZUVycm9yfFJlZmVyZW5jZUVycm9yfFN0b3BJdGVyYXRpb258U3ludGF4RXJyb3J8VHlwZUVycm9yfFVSSUVycm9yfE51bWJlcnxNYXRofERhdGV8U3RyaW5nfFJlZ0V4cHxBcnJheXxGbG9hdDMyQXJyYXl8RmxvYXQ2NEFycmF5fEludDE2QXJyYXl8SW50MzJBcnJheXxJbnQ4QXJyYXl8VWludDE2QXJyYXl8VWludDMyQXJyYXl8VWludDhBcnJheXxVaW50OENsYW1wZWRBcnJheXxBcnJheUJ1ZmZlcnxEYXRhVmlld3xKU09OfEludGx8YXJndW1lbnRzfGNvbnNvbGV8d2luZG93fGRvY3VtZW50fFN5bWJvbHxTZXR8TWFwfFdlYWtTZXR8V2Vha01hcHxQcm94eXxSZWZsZWN0fFByb21pc2UpXFxiLyxcbiAgJ3NwZWNpYWwnOiAvXFxiKHRydWV8ZmFsc2V8bnVsbHx1bmRlZmluZWQpXFxiLyxcbiAgJ3BhcmFtcyc6IC9mdW5jdGlvblsgXFwoXXsxfVteXSo/XFx7LyxcbiAgJ251bWJlcic6IC8tP1xcYigweFtcXGRBLUZhLWZdK3xcXGQqXFwuP1xcZCsoW0VlXVsrLV0/XFxkKyk/fE5hTnwtP0luZmluaXR5KVxcYi8sXG4gICdzeW1ib2wnOiAvW3t9W1xcXSgpLDpdLyxcbiAgJ3JlZ2V4cCc6IC8oPyFbXlxcL10pKFxcLyg/IVtcXC98XFwqXSkuKj9bXlxcXFxcXF5dXFwvKShbO1xcblxcLlxcKVxcXVxcfSBnaW1dKS8sXG5cbiAgJ3htbCc6IC88W14+XSo+LyxcbiAgJ3VybCc6IC8oKFxcdys6XFwvXFwvKVstYS16QS1aMC05OkA7PyY9XFwvJVxcK1xcLlxcKiEnXFwoXFwpLFxcJF9cXHtcXH1cXF5+XFxbXFxdYCN8XSspLyxcbiAgJ2luZGVudCc6IC9eICt8XlxcdCsvLFxuICAnbGluZSc6IC9eLiskfF5cXG4vLFxuICAnbmV3bGluZSc6IC9cXHJcXG58XFxyfFxcbi8sXG59O1xuXG5SZWdleHAudHlwZXMuY29tbWVudCA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIGNvbW1lbnQnLFxuICAnZG91YmxlIGNvbW1lbnQnLFxuXSk7XG5cblJlZ2V4cC50eXBlcy5zdHJpbmcgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZycsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuXSk7XG5cblJlZ2V4cC50eXBlcy5tdWx0aWxpbmUgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ2RvdWJsZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG4gICdpbmRlbnQnLFxuICAnbGluZSdcbl0pO1xuXG5SZWdleHAucGFyc2UgPSBmdW5jdGlvbihzLCByZWdleHAsIGZpbHRlcikge1xuICB2YXIgd29yZHMgPSBbXTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGZpbHRlcikge1xuICAgIHdoaWxlICh3b3JkID0gcmVnZXhwLmV4ZWMocykpIHtcbiAgICAgIGlmIChmaWx0ZXIod29yZCkpIHdvcmRzLnB1c2god29yZCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHdoaWxlICh3b3JkID0gcmVnZXhwLmV4ZWMocykpIHtcbiAgICAgIHdvcmRzLnB1c2god29yZCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHdvcmRzO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBzYXZlO1xuXG5mdW5jdGlvbiBzYXZlKHVybCwgc3JjLCBjYikge1xuICByZXR1cm4gZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGJvZHk6IHNyYyxcbiAgICB9KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cbiIsIi8vIE5vdGU6IFlvdSBwcm9iYWJseSBkbyBub3Qgd2FudCB0byB1c2UgdGhpcyBpbiBwcm9kdWN0aW9uIGNvZGUsIGFzIFByb21pc2UgaXNcbi8vICAgbm90IHN1cHBvcnRlZCBieSBhbGwgYnJvd3NlcnMgeWV0LlxuXG4oZnVuY3Rpb24oKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICBpZiAod2luZG93LnNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBlbmRpbmcgPSB7fSxcbiAgICAgICAgbmV4dEhhbmRsZSA9IDE7XG5cbiAgICBmdW5jdGlvbiBvblJlc29sdmUoaGFuZGxlKSB7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICAgICAgY2FsbGJhY2suZm4uYXBwbHkobnVsbCwgY2FsbGJhY2suYXJncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3aW5kb3cuc2V0SW1tZWRpYXRlID0gZnVuY3Rpb24oZm4pIHtcbiAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICAgICAgaGFuZGxlO1xuXG4gICAgICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImludmFsaWQgZnVuY3Rpb25cIik7XG4gICAgICAgIH1cblxuICAgICAgICBoYW5kbGUgPSBuZXh0SGFuZGxlKys7XG4gICAgICAgIHBlbmRpbmdbaGFuZGxlXSA9IHsgZm46IGZuLCBhcmdzOiBhcmdzIH07XG5cbiAgICAgICAgbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICAgICAgcmVzb2x2ZShoYW5kbGUpO1xuICAgICAgICB9KS50aGVuKG9uUmVzb2x2ZSk7XG5cbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9O1xuXG4gICAgd2luZG93LmNsZWFySW1tZWRpYXRlID0gZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgfTtcbn0oKSk7IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgcnVubmluZywgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYykge1xuICAgIGlmIChydW5uaW5nKSByZXR1cm47XG4gICAgcnVubmluZyA9IHRydWU7XG4gICAgZm4uY2FsbCh0aGlzLCBhLCBiLCBjKTtcbiAgICBzZXRUaW1lb3V0KHJlc2V0LCBtcyk7XG4gIH07XG5cbiAgZnVuY3Rpb24gcmVzZXQoKSB7XG4gICAgcnVubmluZyA9IGZhbHNlO1xuICB9XG59O1xuIiwiXG52YXIgdHJpbSA9IGV4cG9ydHM7XG5cbnRyaW0uZW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHRyYWlsaW5nID0gdHJpbS50cmFpbGluZ0VtcHR5TGluZXMocyk7XG4gIHZhciBsZWFkaW5nID0gdHJpbS5sZWFkaW5nRW1wdHlMaW5lcyh0cmFpbGluZy5zdHJpbmcpO1xuICByZXR1cm4ge1xuICAgIHRyYWlsaW5nOiB0cmFpbGluZy5yZW1vdmVkLFxuICAgIGxlYWRpbmc6IGxlYWRpbmcucmVtb3ZlZCxcbiAgICByZW1vdmVkOiB0cmFpbGluZy5yZW1vdmVkICsgbGVhZGluZy5yZW1vdmVkLFxuICAgIHN0cmluZzogbGVhZGluZy5zdHJpbmdcbiAgfTtcbn07XG5cbnRyaW0udHJhaWxpbmdFbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgaW5kZXggPSBzLmxlbmd0aDtcbiAgdmFyIGxhc3RJbmRleCA9IGluZGV4O1xuICB2YXIgbiA9IDA7XG4gIHdoaWxlIChcbiAgICB+KGluZGV4ID0gcy5sYXN0SW5kZXhPZignXFxuJywgbGFzdEluZGV4IC0gMSkpXG4gICAgJiYgaW5kZXggLSBsYXN0SW5kZXggPT09IC0xKSB7XG4gICAgbisrO1xuICAgIGxhc3RJbmRleCA9IGluZGV4O1xuICB9XG5cbiAgaWYgKG4pIHMgPSBzLnNsaWNlKDAsIGxhc3RJbmRleCk7XG5cbiAgcmV0dXJuIHtcbiAgICByZW1vdmVkOiBuLFxuICAgIHN0cmluZzogc1xuICB9O1xufTtcblxudHJpbS5sZWFkaW5nRW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIGluZGV4ID0gLTE7XG4gIHZhciBsYXN0SW5kZXggPSBpbmRleDtcbiAgdmFyIG4gPSAwO1xuXG4gIHdoaWxlIChcbiAgICB+KGluZGV4ID0gcy5pbmRleE9mKCdcXG4nLCBsYXN0SW5kZXggKyAxKSlcbiAgICAmJiBpbmRleCAtIGxhc3RJbmRleCA9PT0gMSkge1xuICAgIG4rKztcbiAgICBsYXN0SW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIGlmIChuKSBzID0gcy5zbGljZShsYXN0SW5kZXggKyAxKTtcblxuICByZXR1cm4ge1xuICAgIHJlbW92ZWQ6IG4sXG4gICAgc3RyaW5nOiBzXG4gIH07XG59O1xuIiwidmFyIEFyZWEgPSByZXF1aXJlKCcuLi8uLi9saWIvYXJlYScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG5cbnZhciBTa2lwU3RyaW5nID0gcmVxdWlyZSgnLi9za2lwc3RyaW5nJyk7XG52YXIgUHJlZml4VHJlZSA9IHJlcXVpcmUoJy4vcHJlZml4dHJlZScpO1xudmFyIFNlZ21lbnRzID0gcmVxdWlyZSgnLi9zZWdtZW50cycpO1xudmFyIEluZGV4ZXIgPSByZXF1aXJlKCcuL2luZGV4ZXInKTtcbnZhciBUb2tlbnMgPSByZXF1aXJlKCcuL3Rva2VucycpO1xudmFyIFN5bnRheCA9IHJlcXVpcmUoJy4vc3ludGF4Jyk7XG5cbnZhciBFT0wgPSAvXFxyXFxufFxccnxcXG4vZztcbnZhciBORVdMSU5FID0gL1xcbi9nO1xudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3Rva2VucyddLCAnZycpO1xuXG52YXIgU0VHTUVOVCA9IHtcbiAgJ2NvbW1lbnQnOiAnLyonLFxuICAnc3RyaW5nJzogJ2AnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCdWZmZXI7XG5cbmZ1bmN0aW9uIEJ1ZmZlcigpIHtcbiAgdGhpcy5zeW50YXggPSBuZXcgU3ludGF4O1xuICB0aGlzLmluZGV4ZXIgPSBuZXcgSW5kZXhlcih0aGlzKTtcbiAgdGhpcy5zZWdtZW50cyA9IG5ldyBTZWdtZW50cyh0aGlzKTtcbiAgdGhpcy5zZXRUZXh0KCcnKTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2V0VGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB0aGlzLnJhdyA9IHRleHQgLy90aGlzLnN5bnRheC5oaWdobGlnaHQodGV4dCk7XG5cbiAgdGhpcy5zeW50YXgudGFiID0gfnRoaXMucmF3LmluZGV4T2YoJ1xcdCcpID8gJ1xcdCcgOiAnICc7XG5cbiAgdGhpcy50ZXh0ID0gbmV3IFNraXBTdHJpbmc7XG4gIHRoaXMudGV4dC5zZXQodGhpcy5yYXcpO1xuXG4gIHRoaXMudG9rZW5zID0gbmV3IFRva2VucztcbiAgdGhpcy50b2tlbnMuaW5kZXgodGhpcy5yYXcpO1xuXG4gIHRoaXMucHJlZml4ID0gbmV3IFByZWZpeFRyZWU7XG4gIHRoaXMucHJlZml4LmluZGV4KHRoaXMucmF3KTtcblxuICAvLyB0aGlzLmVtaXQoJ3JhdycsIHRoaXMucmF3KTtcbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zZXJ0ID1cbkJ1ZmZlci5wcm90b3R5cGUuaW5zZXJ0VGV4dEF0UG9pbnQgPSBmdW5jdGlvbihwLCB0ZXh0LCBjdHJsU2hpZnQpIHtcbiAgaWYgKCFjdHJsU2hpZnQpIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdmFyIGlzRU9MID0gJ1xcbicgPT09IHRleHRbMF07XG4gIHZhciBzaGlmdCA9IGN0cmxTaGlmdCB8fCBpc0VPTDtcbiAgdmFyIGxlbmd0aCA9IHRleHQubGVuZ3RoO1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgbGluZXMgPSAodGV4dC5tYXRjaChORVdMSU5FKSB8fCBbXSkubGVuZ3RoO1xuICB2YXIgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIGxpbmVzXTtcbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcblxuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG4gIG9mZnNldFJhbmdlWzFdICs9IHRleHQubGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcbiAgdGhpcy50b2tlbnMudXBkYXRlKG9mZnNldFJhbmdlLCBhZnRlciwgbGVuZ3RoKTtcbiAgdGhpcy5zZWdtZW50cy5jbGVhckNhY2hlKG9mZnNldFJhbmdlWzBdKTtcblxuICAvLyB0aGlzLnRva2VucyA9IG5ldyBUb2tlbnM7XG4gIC8vIHRoaXMudG9rZW5zLmluZGV4KHRoaXMudGV4dC50b1N0cmluZygpKTtcbiAgLy8gdGhpcy5zZWdtZW50cyA9IG5ldyBTZWdtZW50cyh0aGlzKTtcblxuICBpZiAoIWN0cmxTaGlmdCkgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xuICBlbHNlIHRoaXMuZW1pdCgncmF3Jyk7XG5cbiAgcmV0dXJuIHRleHQubGVuZ3RoO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmUgPVxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKG8sIG5vVXBkYXRlKSB7XG4gIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdvZmZzZXRzJywgbylcbiAgdmFyIGEgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMF0pO1xuICB2YXIgYiA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1sxXSk7XG4gIHZhciBsZW5ndGggPSBvWzBdIC0gb1sxXTtcbiAgdmFyIHJhbmdlID0gW2EueSwgYi55XTtcbiAgdmFyIHNoaWZ0ID0gYS55IC0gYi55O1xuICAvLyBjb25zb2xlLmxvZyhhLGIpXG5cbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGJlZm9yZSA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy50ZXh0LnJlbW92ZShvKTtcbiAgLy8gb2Zmc2V0UmFuZ2VbMV0gLT0gc2hpZnQ7XG4gIHZhciBhZnRlciA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICB0aGlzLnRva2Vucy51cGRhdGUob2Zmc2V0UmFuZ2UsIGFmdGVyLCBsZW5ndGgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUob2Zmc2V0UmFuZ2VbMF0pO1xuXG4gIGlmICghbm9VcGRhdGUpIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlQXJlYSA9IGZ1bmN0aW9uKGFyZWEsIG5vVXBkYXRlKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRBcmVhT2Zmc2V0UmFuZ2UoYXJlYSk7XG4gIHJldHVybiB0aGlzLnJlbW92ZU9mZnNldFJhbmdlKG9mZnNldHMsIG5vVXBkYXRlKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlQ2hhckF0UG9pbnQgPSBmdW5jdGlvbihwKSB7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciBvZmZzZXRSYW5nZSA9IFtwb2ludC5vZmZzZXQsIHBvaW50Lm9mZnNldCsxXTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0UmFuZ2UpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgY29kZSA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChyYW5nZSk7XG4gIHZhciBzZWdtZW50ID0gdGhpcy5zZWdtZW50cy5nZXQocmFuZ2VbMF0pO1xuICBpZiAoc2VnbWVudCkge1xuICAgIGNvZGUgPSBTRUdNRU5UW3NlZ21lbnRdICsgJ1xcdWZmYmEnICsgY29kZSArICdcXHVmZmJlKi9gJ1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSk7XG4gICAgY29kZSA9ICc8JyArIHNlZ21lbnRbMF0gKyAnPicgK1xuICAgICAgY29kZS5zdWJzdHJpbmcoXG4gICAgICAgIGNvZGUuaW5kZXhPZignXFx1ZmZiYScpICsgMSxcbiAgICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSArICdcXHVmZmJlKi9gJyk7XG4gICAgY29kZSA9IGNvZGUuc3Vic3RyaW5nKDAsIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBsaW5lID0gbmV3IExpbmU7XG4gIGxpbmUub2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMoW3kseV0pO1xuICBsaW5lLm9mZnNldCA9IGxpbmUub2Zmc2V0UmFuZ2VbMF07XG4gIGxpbmUubGVuZ3RoID0gbGluZS5vZmZzZXRSYW5nZVsxXSAtIGxpbmUub2Zmc2V0UmFuZ2VbMF0gLSAoeSA8IHRoaXMubG9jKCkpO1xuICBsaW5lLnBvaW50LnNldCh7IHg6MCwgeTp5IH0pO1xuICByZXR1cm4gbGluZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihwKSB7XG4gIHZhciBsaW5lID0gdGhpcy5nZXRMaW5lKHAueSk7XG4gIHZhciBwb2ludCA9IG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5taW4obGluZS5sZW5ndGgsIHAueCksXG4gICAgeTogbGluZS5wb2ludC55XG4gIH0pO1xuICBwb2ludC5vZmZzZXQgPSBsaW5lLm9mZnNldCArIHBvaW50Lng7XG4gIHBvaW50LnBvaW50ID0gcG9pbnQ7XG4gIHBvaW50LmxpbmUgPSBsaW5lO1xuICByZXR1cm4gcG9pbnQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVSYW5nZVRleHQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldHMpO1xuICByZXR1cm4gdGV4dDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlT2Zmc2V0cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBhID0gdGhpcy5nZXRMaW5lT2Zmc2V0KHJhbmdlWzBdKTtcbiAgdmFyIGIgPSByYW5nZVsxXSA+PSB0aGlzLmxvYygpXG4gICAgPyB0aGlzLnRleHQubGVuZ3RoXG4gICAgOiB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMV0gKyAxKTtcbiAgdmFyIG9mZnNldHMgPSBbYSwgYl07XG4gIHJldHVybiBvZmZzZXRzO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRSYW5nZVRleHQgPSBmdW5jdGlvbihvZmZzZXRSYW5nZSkge1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRSYW5nZSk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRPZmZzZXRQb2ludCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgdG9rZW4gPSB0aGlzLnRva2Vucy5nZXRCeU9mZnNldCgnbGluZXMnLCBvZmZzZXQgLSAuNSk7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IG9mZnNldCAtIChvZmZzZXQgPiB0b2tlbi5vZmZzZXQgPyB0b2tlbi5vZmZzZXQgKyAxIDogMCksXG4gICAgeTogTWF0aC5taW4odGhpcy5sb2MoKSwgdG9rZW4uaW5kZXggLSAodG9rZW4ub2Zmc2V0ICsgMSA+IG9mZnNldCkgKyAxKVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuY2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBjaGFyID0gdGhpcy50ZXh0LmdldFJhbmdlKFtvZmZzZXQsIG9mZnNldCArIDFdKTtcbiAgcmV0dXJuIGNoYXI7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmVUZXh0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB7XG4gICAgbGluZTogbGluZSxcbiAgICB0ZXh0OiB0ZXh0LFxuICB9XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVUZXh0ID0gZnVuY3Rpb24oeSkge1xuICB2YXIgdGV4dCA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChbeSx5XSk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhVGV4dCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS53b3JkQXJlYUF0UG9pbnQgPSBmdW5jdGlvbihwLCBpbmNsdXNpdmUpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2UocG9pbnQubGluZS5vZmZzZXRSYW5nZSk7XG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZSh0ZXh0LCBXT1JEUyk7XG5cbiAgaWYgKHdvcmRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHZhciBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gYXJlYTtcbiAgfVxuXG4gIHZhciBsYXN0SW5kZXggPSAwO1xuICB2YXIgd29yZCA9IFtdO1xuICB2YXIgZW5kID0gdGV4dC5sZW5ndGg7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAod29yZC5pbmRleCA+IHBvaW50LnggLSAhIWluY2x1c2l2ZSkge1xuICAgICAgZW5kID0gd29yZC5pbmRleDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBsYXN0SW5kZXggPSB3b3JkLmluZGV4O1xuICB9XG5cbiAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHsgeDogbGFzdEluZGV4LCB5OiBwb2ludC55IH0sXG4gICAgZW5kOiB7IHg6IGVuZCwgeTogcG9pbnQueSB9XG4gIH0pO1xuXG4gIHJldHVybiBhcmVhO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmVuZC54ID4gMCB8fCBhcmVhLmJlZ2luLnkgPT09IGFyZWEuZW5kLnkpIGFyZWEuZW5kLnkgKz0gMTtcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwO1xuICBhcmVhLmVuZC54ID0gMDtcblxuICB2YXIgdGV4dCA9IHRoaXMuZ2V0TGluZVJhbmdlVGV4dChbYXJlYS5iZWdpbi55LCBhcmVhLmVuZC55LTFdKTtcbiAgdGhpcy5yZW1vdmVBcmVhKGFyZWEsIHRydWUpO1xuXG4gIHRoaXMuaW5zZXJ0KHsgeDowLCB5OmFyZWEuYmVnaW4ueSArIHkgfSwgdGV4dCwgeSk7XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEFyZWFPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIHJhbmdlID0gW1xuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5iZWdpbikub2Zmc2V0LFxuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpLm9mZnNldFxuICBdO1xuICByZXR1cm4gcmFuZ2U7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGxpbmU7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldExpbmVPZmZzZXQgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBvZmZzZXQgPSB5IDwgMCA/IC0xIDogeSA9PT0gMCA/IDAgOiB0aGlzLnRva2Vucy5nZXRCeUluZGV4KCdsaW5lcycsIHkgLSAxKSArIDE7XG4gIHJldHVybiBvZmZzZXQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmxvYyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy50b2tlbnMuZ2V0Q29sbGVjdGlvbignbGluZXMnKS5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRleHQudG9TdHJpbmcoKTtcbn07XG5cbmZ1bmN0aW9uIExpbmUoKSB7XG4gIHRoaXMub2Zmc2V0UmFuZ2UgPSBbXTtcbiAgdGhpcy5vZmZzZXQgPSAwO1xuICB0aGlzLmxlbmd0aCA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVPTChzKSB7XG4gIHJldHVybiBzLnJlcGxhY2UoRU9MLCAnXFxuJyk7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gSW5kZXhlcjtcblxuZnVuY3Rpb24gSW5kZXhlcihidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG59XG5cbkluZGV4ZXIucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihzKSB7XG4gIGlmICghcykgcmV0dXJuIFtdO1xuICB2YXIgb2Zmc2V0cyA9IFtdO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLnJhdztcbiAgdmFyIGxlbiA9IHMubGVuZ3RoO1xuICB2YXIgaW5kZXg7XG4gIHdoaWxlICh+KGluZGV4ID0gdGV4dC5pbmRleE9mKHMsIGluZGV4ICsgbGVuKSkpIHtcbiAgICBvZmZzZXRzLnB1c2goaW5kZXgpO1xuICB9XG4gIHJldHVybiBvZmZzZXRzO1xufTtcbiIsInZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBhcnRzO1xuXG5mdW5jdGlvbiBQYXJ0cyhtaW5TaXplKSB7XG4gIG1pblNpemUgPSBtaW5TaXplIHx8IDUwMDA7XG4gIHRoaXMubWluU2l6ZSA9IG1pblNpemU7XG4gIHRoaXMucGFydHMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5QYXJ0cy5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgdGhpcy5hcHBlbmQoW2l0ZW1dKTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcGFydCA9IGxhc3QodGhpcy5wYXJ0cyk7XG5cbiAgaWYgKCFwYXJ0KSB7XG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IDA7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IDA7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG4gIGVsc2UgaWYgKHBhcnQubGVuZ3RoID49IHRoaXMubWluU2l6ZSkge1xuICAgIHZhciBzdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4ICsgcGFydC5sZW5ndGg7XG4gICAgdmFyIHN0YXJ0T2Zmc2V0ID0gaXRlbXNbMF07XG5cbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gc3RhcnRJbmRleDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gc3RhcnRPZmZzZXQ7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG5cbiAgcGFydC5wdXNoLmFwcGx5KHBhcnQsIGl0ZW1zLm1hcChvZmZzZXQgPT4gb2Zmc2V0IC0gcGFydC5zdGFydE9mZnNldCkpO1xuXG4gIHRoaXMubGVuZ3RoICs9IGl0ZW1zLmxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpbmRleCkge1xuICB2YXIgcGFydCA9IHRoaXMuZmluZFBhcnRCeUluZGV4KGluZGV4KS5pdGVtO1xuICByZXR1cm4gcGFydFtpbmRleCAtIHBhcnQuc3RhcnRJbmRleF0gKyBwYXJ0LnN0YXJ0T2Zmc2V0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHAgPSB0aGlzLmZpbmRQYXJ0QnlPZmZzZXQob2Zmc2V0KTtcbiAgaWYgKCFwLml0ZW0pIHJldHVybiBudWxsO1xuXG4gIHZhciBwYXJ0ID0gcC5pdGVtO1xuICB2YXIgcGFydEluZGV4ID0gcC5pbmRleDtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KTtcbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG8uaXRlbSArIHBhcnQuc3RhcnRPZmZzZXQsXG4gICAgaW5kZXg6IG8uaW5kZXggKyBwYXJ0LnN0YXJ0SW5kZXgsXG4gICAgbG9jYWw6IG8uaW5kZXgsXG4gICAgcGFydDogcGFydCxcbiAgICBwYXJ0SW5kZXg6IHBhcnRJbmRleFxuICB9O1xufTtcblxuUGFydHMucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgYXJyYXkpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKCFvKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwZW5kKGFycmF5KTtcbiAgfVxuICBpZiAoby5vZmZzZXQgPiBvZmZzZXQpIG8ubG9jYWwgPSAtMTtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcbiAgLy9UT0RPOiBtYXliZSBzdWJ0cmFjdCAnb2Zmc2V0JyBpbnN0ZWFkID9cbiAgYXJyYXkgPSBhcnJheS5tYXAoZWwgPT4gZWwgLT0gby5wYXJ0LnN0YXJ0T2Zmc2V0KTtcbiAgaW5zZXJ0KG8ucGFydCwgby5sb2NhbCArIDEsIGFycmF5KTtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgLWxlbmd0aCk7XG4gIHRoaXMubGVuZ3RoICs9IGxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdE9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgc2hpZnQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cztcbiAgdmFyIGl0ZW0gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKG9mZnNldCA+IGl0ZW0ub2Zmc2V0KSBpdGVtLmxvY2FsICs9IDE7XG5cbiAgdmFyIHJlbW92ZWQgPSAwO1xuICBmb3IgKHZhciBpID0gaXRlbS5sb2NhbDsgaSA8IGl0ZW0ucGFydC5sZW5ndGg7IGkrKykge1xuICAgIGl0ZW0ucGFydFtpXSArPSBzaGlmdDtcbiAgICBpZiAoaXRlbS5wYXJ0W2ldICsgaXRlbS5wYXJ0LnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICByZW1vdmVkKys7XG4gICAgICBpdGVtLnBhcnQuc3BsaWNlKGktLSwgMSk7XG4gICAgfVxuICB9XG4gIGlmIChyZW1vdmVkKSB7XG4gICAgdGhpcy5zaGlmdEluZGV4KGl0ZW0ucGFydEluZGV4ICsgMSwgcmVtb3ZlZCk7XG4gICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgfVxuICBmb3IgKHZhciBpID0gaXRlbS5wYXJ0SW5kZXggKyAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBwYXJ0c1tpXS5zdGFydE9mZnNldCArPSBzaGlmdDtcbiAgICBpZiAocGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIGlmIChsYXN0KHBhcnRzW2ldKSArIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICAgIHJlbW92ZWQgPSBwYXJ0c1tpXS5sZW5ndGg7XG4gICAgICAgIHRoaXMuc2hpZnRJbmRleChpICsgMSwgcmVtb3ZlZCk7XG4gICAgICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gICAgICAgIHBhcnRzLnNwbGljZShpLS0sIDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZW1vdmVCZWxvd09mZnNldChvZmZzZXQsIHBhcnRzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBhID0gdGhpcy5maW5kKHJhbmdlWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmZpbmQocmFuZ2VbMV0pO1xuXG4gIGlmIChhLnBhcnRJbmRleCA9PT0gYi5wYXJ0SW5kZXgpIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0ID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoYS5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gICAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdEEgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsKS5sZW5ndGg7XG4gICAgdmFyIHNoaWZ0QiA9IHJlbW92ZShiLnBhcnQsIDAsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgaWYgKGIucGFydEluZGV4IC0gYS5wYXJ0SW5kZXggPiAxKSB7XG4gICAgICB2YXIgcmVtb3ZlZCA9IHJlbW92ZSh0aGlzLnBhcnRzLCBhLnBhcnRJbmRleCArIDEsIGIucGFydEluZGV4KTtcbiAgICAgIHZhciBzaGlmdEJldHdlZW4gPSByZW1vdmVkLnJlZHVjZSgocCxuKSA9PiBwICsgbi5sZW5ndGgsIDApO1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBICsgc2hpZnRCZXR3ZWVuO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4IC0gcmVtb3ZlZC5sZW5ndGggKyAxLCBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW4pO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuO1xuICAgIH0gZWxzZSB7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEE7XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggKyAxLCBzaGlmdEEgKyBzaGlmdEIpO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCO1xuICAgIH1cbiAgfVxuXG4gIC8vVE9ETzogdGhpcyBpcyBpbmVmZmljaWVudCBhcyB3ZSBjYW4gY2FsY3VsYXRlIHRoZSBpbmRleGVzIG91cnNlbHZlc1xuICBpZiAoIWEucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYS5wYXJ0KSwgMSk7XG4gIH1cbiAgaWYgKCFiLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGIucGFydCksIDEpO1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRJbmRleCA9IGZ1bmN0aW9uKHN0YXJ0SW5kZXgsIHNoaWZ0KSB7XG4gIGZvciAodmFyIGkgPSBzdGFydEluZGV4OyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMucGFydHNbaV0uc3RhcnRJbmRleCAtPSBzaGlmdDtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZUJlbG93T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydClcbiAgdmFyIHNoaWZ0ID0gcmVtb3ZlKHBhcnQsIDAsIG8uaW5kZXgpLmxlbmd0aDtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kT2Zmc2V0SW5QYXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIG9mZnNldCAtPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHBhcnQsIG8gPT4gbyA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlJbmRleCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0SW5kZXggPD0gaW5kZXgpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRPZmZzZXQgPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnBhcnRzLnJlZHVjZSgocCxuKSA9PiBwLmNvbmNhdChuKSwgW10pO1xufTtcblxuZnVuY3Rpb24gbGFzdChhcnJheSkge1xuICByZXR1cm4gYXJyYXlbYXJyYXkubGVuZ3RoIC0gMV07XG59XG5cbmZ1bmN0aW9uIHJlbW92ZShhcnJheSwgYSwgYikge1xuICBpZiAoYiA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEsIGIgLSBhKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBpbmRleCwgYXJyYXkpIHtcbiAgdmFyIG9wID0gYXJyYXkuc2xpY2UoKTtcbiAgb3AudW5zaGlmdChpbmRleCwgMCk7XG4gIHRhcmdldC5zcGxpY2UuYXBwbHkodGFyZ2V0LCBvcCk7XG59XG4iLCIvLyB2YXIgV09SRCA9IC9cXHcrL2c7XG52YXIgV09SRCA9IC9bYS16QS1aMC05XXsxLH0vZ1xudmFyIHJhbmsgPSAwO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFByZWZpeFRyZWVOb2RlO1xuXG5mdW5jdGlvbiBQcmVmaXhUcmVlTm9kZSgpIHtcbiAgdGhpcy52YWx1ZSA9ICcnO1xuICB0aGlzLnJhbmsgPSAwO1xuICB0aGlzLmNoaWxkcmVuID0ge307XG59XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5nZXRDaGlsZHJlbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2hpbGRyZW4gPSBPYmplY3RcbiAgICAua2V5cyh0aGlzLmNoaWxkcmVuKVxuICAgIC5tYXAoKGtleSkgPT4gdGhpcy5jaGlsZHJlbltrZXldKTtcblxuICByZXR1cm4gY2hpbGRyZW4ucmVkdWNlKChwLCBuKSA9PiBwLmNvbmNhdChuLmdldENoaWxkcmVuKCkpLCBjaGlsZHJlbik7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuY29sbGVjdCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgY29sbGVjdGlvbiA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuZmluZChrZXkpO1xuICBpZiAobm9kZSkge1xuICAgIGNvbGxlY3Rpb24gPSBub2RlXG4gICAgICAuZ2V0Q2hpbGRyZW4oKVxuICAgICAgLmZpbHRlcigobm9kZSkgPT4gbm9kZS52YWx1ZSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIHZhciByZXMgPSBiLnJhbmsgLSBhLnJhbms7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGIudmFsdWUubGVuZ3RoIC0gYS52YWx1ZS5sZW5ndGg7XG4gICAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGEudmFsdWUgPiBiLnZhbHVlO1xuICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgfSk7XG5cbiAgICBpZiAobm9kZS52YWx1ZSkgY29sbGVjdGlvbi5wdXNoKG5vZGUpO1xuICB9XG4gIHJldHVybiBjb2xsZWN0aW9uO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICBmb3IgKHZhciBjaGFyIGluIGtleSkge1xuICAgIGlmIChrZXlbY2hhcl0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5ba2V5W2NoYXJdXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbm9kZTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIHZhciBpID0gMDtcbiAgdmFyIG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBpZiAoc1tpXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltzW2ldXTtcbiAgICAgIGkrKztcbiAgICB9IGVsc2Uge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgbm9kZSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSB8fCBuZXcgUHJlZml4VHJlZU5vZGU7XG4gICAgaSsrO1xuICB9XG5cbiAgbm9kZS52YWx1ZSA9IHM7XG4gIG5vZGUucmFuaysrO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24ocykge1xuICB2YXIgd29yZDtcbiAgd2hpbGUgKHdvcmQgPSBXT1JELmV4ZWMocykpIHtcbiAgICB0aGlzLmluc2VydCh3b3JkWzBdKTtcbiAgfVxufTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG52YXIgVG9rZW5zID0gcmVxdWlyZSgnLi90b2tlbnMnKTtcbnZhciBUeXBlID0gVG9rZW5zLlR5cGU7XG5cbnZhciBCZWdpbiA9IC9bXFwvJ1wiYF0vZztcblxudmFyIE1hdGNoID0ge1xuICAnc2luZ2xlIGNvbW1lbnQnOiBbJy8vJywnXFxuJ10sXG4gICdkb3VibGUgY29tbWVudCc6IFsnLyonLCcqLyddLFxuICAndGVtcGxhdGUgc3RyaW5nJzogWydgJywnYCddLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFtcIidcIixcIidcIl0sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogWydcIicsJ1wiJ10sXG4gICdyZWdleHAnOiBbJy8nLCcvJ10sXG59O1xuXG52YXIgU2tpcCA9IHtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ3NpbmdsZSBjb21tZW50JzogZmFsc2UsXG4gICdkb3VibGUgY29tbWVudCc6IGZhbHNlLFxuICAncmVnZXhwJzogXCJcXFxcXCIsXG59O1xuXG52YXIgVG9rZW4gPSB7fTtcbmZvciAodmFyIGtleSBpbiBNYXRjaCkge1xuICB2YXIgTSA9IE1hdGNoW2tleV07XG4gIFRva2VuW01bMF1dID0ga2V5O1xufVxuXG52YXIgTGVuZ3RoID0ge1xuICAnb3BlbiBjb21tZW50JzogMixcbiAgJ2Nsb3NlIGNvbW1lbnQnOiAyLFxuICAndGVtcGxhdGUgc3RyaW5nJzogMSxcbn07XG5cbnZhciBOb3RPcGVuID0ge1xuICAnY2xvc2UgY29tbWVudCc6IHRydWVcbn07XG5cbnZhciBDbG9zZXMgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY2xvc2UgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbnZhciBUYWcgPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAnY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAnc3RyaW5nJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudHM7XG5cbmZ1bmN0aW9uIFNlZ21lbnRzKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbiAgdGhpcy5jYWNoZSA9IHt9O1xuICB0aGlzLnJlc2V0KCk7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5jbGVhckNhY2hlID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQpIHtcbiAgICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMub2Zmc2V0IDwgb2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLmNhY2hlLnN0YXRlLnNwbGljZShzLmluZGV4KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmNhY2hlLnN0YXRlID0gW107XG4gIH1cbiAgdGhpcy5jYWNoZS5vZmZzZXQgPSB7fTtcbiAgdGhpcy5jYWNoZS5yYW5nZSA9IHt9O1xuICB0aGlzLmNhY2hlLnBvaW50ID0ge307XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhckNhY2hlKCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSBpbiB0aGlzLmNhY2hlLnBvaW50KSB7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGUucG9pbnRbeV07XG4gIH1cblxuICB2YXIgc2VnbWVudHMgPSB0aGlzLmJ1ZmZlci50b2tlbnMuZ2V0Q29sbGVjdGlvbignc2VnbWVudHMnKTtcbiAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgdmFyIHN0YXRlID0gbnVsbDtcbiAgdmFyIHdhaXRGb3IgPSAnJztcbiAgdmFyIHBvaW50ID0geyB4Oi0xLCB5Oi0xIH07XG4gIHZhciBjbG9zZSA9IDA7XG4gIHZhciBvZmZzZXQ7XG4gIHZhciBzZWdtZW50O1xuICB2YXIgcmFuZ2U7XG4gIHZhciB0ZXh0O1xuICB2YXIgdmFsaWQ7XG4gIHZhciBsYXN0O1xuXG4gIHZhciBsYXN0Q2FjaGVTdGF0ZU9mZnNldCA9IDA7XG5cbiAgdmFyIGkgPSAwO1xuXG4gIHZhciBjYWNoZVN0YXRlID0gdGhpcy5nZXRDYWNoZVN0YXRlKHkpO1xuICBpZiAoY2FjaGVTdGF0ZSAmJiBjYWNoZVN0YXRlLml0ZW0pIHtcbiAgICBvcGVuID0gdHJ1ZTtcbiAgICBzdGF0ZSA9IGNhY2hlU3RhdGUuaXRlbTtcbiAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgIGkgPSBzdGF0ZS5pbmRleCArIDE7XG4gIH1cblxuICBmb3IgKDsgaSA8IHNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb2Zmc2V0ID0gc2VnbWVudHMuZ2V0KGkpO1xuICAgIHNlZ21lbnQgPSB7XG4gICAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICAgIHR5cGU6IFR5cGVbdGhpcy5idWZmZXIuY2hhckF0KG9mZnNldCldXG4gICAgfTtcblxuICAgIC8vIHNlYXJjaGluZyBmb3IgY2xvc2UgdG9rZW5cbiAgICBpZiAob3Blbikge1xuICAgICAgaWYgKHdhaXRGb3IgPT09IHNlZ21lbnQudHlwZSkge1xuICAgICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIHtcbiAgICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICAgICAgICB9XG5cbiAgICAgICAgbGFzdCA9IHNlZ21lbnQ7XG4gICAgICAgIGxhc3QucG9pbnQgPSBwb2ludDtcbiAgICAgICAgc3RhdGUgPSBudWxsO1xuICAgICAgICBvcGVuID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBvcGVuIHRva2VuXG4gICAgZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQoc2VnbWVudC5vZmZzZXQpO1xuXG4gICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgfVxuXG4gICAgICByYW5nZSA9IHRoaXMuYnVmZmVyLmdldExpbmUocG9pbnQueSkub2Zmc2V0UmFuZ2U7XG5cbiAgICAgIGlmIChsYXN0ICYmIGxhc3QucG9pbnQueSA9PT0gcG9pbnQueSkge1xuICAgICAgICBjbG9zZSA9IGxhc3QucG9pbnQueCArIExlbmd0aFtsYXN0LnR5cGVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2xvc2UgPSAwO1xuICAgICAgfVxuXG4gICAgICB2YWxpZCA9IHRoaXMuaXNWYWxpZFJhbmdlKFtyYW5nZVswXSwgcmFuZ2VbMV0rMV0sIHNlZ21lbnQsIGNsb3NlKTtcblxuICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgIGlmIChOb3RPcGVuW3NlZ21lbnQudHlwZV0pIGNvbnRpbnVlO1xuICAgICAgICBvcGVuID0gdHJ1ZTtcbiAgICAgICAgc3RhdGUgPSBzZWdtZW50O1xuICAgICAgICBzdGF0ZS5pbmRleCA9IGk7XG4gICAgICAgIHN0YXRlLnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIC8vIHN0YXRlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLm9mZnNldCB9O1xuICAgICAgICB3YWl0Rm9yID0gQ2xvc2VzW3N0YXRlLnR5cGVdO1xuICAgICAgICBpZiAoIXRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIHx8IHRoaXMuY2FjaGUuc3RhdGUubGVuZ3RoICYmIHN0YXRlLm9mZnNldCA+IHRoaXMuY2FjaGUuc3RhdGVbdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggLSAxXS5vZmZzZXQpIHtcbiAgICAgICAgICB0aGlzLmNhY2hlLnN0YXRlLnB1c2goc3RhdGUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIGlmIChzdGF0ZSAmJiBzdGF0ZS5wb2ludC55IDwgeSkge1xuICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gIH1cblxuICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbn07XG5cbi8vVE9ETzogY2FjaGUgaW4gQnVmZmVyXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0T2Zmc2V0UG9pbnQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCBpbiB0aGlzLmNhY2hlLm9mZnNldCkgcmV0dXJuIHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF07XG4gIHJldHVybiAodGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XSA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFBvaW50KG9mZnNldCkpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlLCBzZWdtZW50LCBjbG9zZSkge1xuICB2YXIga2V5ID0gcmFuZ2Uuam9pbigpO1xuICBpZiAoa2V5IGluIHRoaXMuY2FjaGUucmFuZ2UpIHJldHVybiB0aGlzLmNhY2hlLnJhbmdlW2tleV07XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UmFuZ2VUZXh0KHJhbmdlKTtcbiAgdmFyIHZhbGlkID0gdGhpcy5pc1ZhbGlkKHRleHQsIHNlZ21lbnQub2Zmc2V0IC0gcmFuZ2VbMF0sIGNsb3NlKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnJhbmdlW2tleV0gPSB2YWxpZCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCwgbGFzdEluZGV4KSB7XG4gIEJlZ2luLmxhc3RJbmRleCA9IGxhc3RJbmRleDtcblxuICB2YXIgbWF0Y2ggPSBCZWdpbi5leGVjKHRleHQpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG5cbiAgdmFyIGkgPSBtYXRjaC5pbmRleDtcblxuICBsYXN0ID0gaTtcblxuICB2YXIgdmFsaWQgPSB0cnVlO1xuXG4gIG91dGVyOlxuICBmb3IgKDsgaSA8IHRleHQubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgb25lID0gdGV4dFtpXTtcbiAgICB2YXIgbmV4dCA9IHRleHRbaSArIDFdO1xuICAgIHZhciB0d28gPSBvbmUgKyBuZXh0O1xuICAgIGlmIChpID09PSBvZmZzZXQpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIG8gPSBUb2tlblt0d29dO1xuICAgIGlmICghbykgbyA9IFRva2VuW29uZV07XG4gICAgaWYgKCFvKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICB2YXIgd2FpdEZvciA9IE1hdGNoW29dWzFdO1xuXG4gICAgbGFzdCA9IGk7XG5cbiAgICBzd2l0Y2ggKHdhaXRGb3IubGVuZ3RoKSB7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gb25lKSB7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMTtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIHdoaWxlICgrK2kgPCB0ZXh0Lmxlbmd0aCkge1xuXG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcbiAgICAgICAgICB0d28gPSB0ZXh0W2ldICsgdGV4dFtpICsgMV07XG5cbiAgICAgICAgICBpZiAob25lID09PSBTa2lwW29dKSB7XG4gICAgICAgICAgICArK2k7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAod2FpdEZvciA9PT0gdHdvKSB7XG4gICAgICAgICAgICBpICs9IDI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoJ1xcbicgPT09IG9uZSAmJiAhdmFsaWQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gdHJ1ZTtcbiAgICAgICAgICAgIGkgPSBsYXN0ICsgMjtcbiAgICAgICAgICAgIGNvbnRpbnVlIG91dGVyO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpID09PSBvZmZzZXQpIHtcbiAgICAgICAgICAgIHZhbGlkID0gZmFsc2U7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWxpZDtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmdldENhY2hlU3RhdGUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBzID0gYmluYXJ5U2VhcmNoKHRoaXMuY2FjaGUuc3RhdGUsIHMgPT4gcy5wb2ludC55IDwgeSk7XG4gIGlmIChzLml0ZW0gJiYgeSAtIDEgPCBzLml0ZW0ucG9pbnQueSkgcmV0dXJuIG51bGw7XG4gIGVsc2UgcmV0dXJuIHM7XG4gIC8vIHJldHVybiBzO1xufTtcbiIsIi8qXG5cbmV4YW1wbGUgc2VhcmNoIGZvciBvZmZzZXQgYDRgIDpcbmBvYCBhcmUgbm9kZSdzIGxldmVscywgYHhgIGFyZSB0cmF2ZXJzYWwgc3RlcHNcblxueFxueFxuby0tPnggICBvICAgb1xubyBvIHggICBvICAgbyBvIG9cbm8gbyBvLXggbyBvIG8gbyBvXG4xIDIgMyA0IDUgNiA3IDggOVxuXG4qL1xuXG5sb2cgPSBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNraXBTdHJpbmc7XG5cbmZ1bmN0aW9uIE5vZGUodmFsdWUsIGxldmVsKSB7XG4gIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgdGhpcy5sZXZlbCA9IGxldmVsO1xuICB0aGlzLndpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwodmFsdWUgJiYgdmFsdWUubGVuZ3RoIHx8IDApO1xuICB0aGlzLm5leHQgPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbChudWxsKTtcbn1cblxuTm9kZS5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMud2lkdGhbMF07XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNraXBTdHJpbmcobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy5sZXZlbHMgPSBvLmxldmVscyB8fCAxMTtcbiAgdGhpcy5iaWFzID0gby5iaWFzIHx8IDEgLyBNYXRoLkU7XG4gIHRoaXMuaGVhZCA9IG5ldyBOb2RlKG51bGwsIHRoaXMubGV2ZWxzKTtcbiAgdGhpcy5jaHVua1NpemUgPSBvLmNodW5rU2l6ZSB8fCA1MDAwO1xufVxuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkLndpZHRoW3RoaXMubGV2ZWxzIC0gMV07XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICAvLyBncmVhdCBoYWNrIHRvIGRvIG9mZnNldCA+PSBmb3IgLnNlYXJjaCgpXG4gIC8vIHdlIGRvbid0IGhhdmUgZnJhY3Rpb25zIGFueXdheSBzby4uXG4gIHJldHVybiB0aGlzLnNlYXJjaChvZmZzZXQsIHRydWUpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmluc2VydENodW5rZWQoMCwgdGV4dCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbihvZmZzZXQsIGluY2wpIHtcbiAgaW5jbCA9IGluY2wgPyAuMSA6IDA7XG5cbiAgLy8gcHJlcGFyZSB0byBob2xkIHN0ZXBzXG4gIHZhciBzdGVwcyA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG4gIHZhciB3aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG5cbiAgLy8gaXRlcmF0ZSBsZXZlbHMgZG93biwgc2tpcHBpbmcgdG9wXG4gIHZhciBpID0gdGhpcy5sZXZlbHM7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICB3aGlsZSAob2Zmc2V0ICsgaW5jbCA+IG5vZGUud2lkdGhbaV0gJiYgbnVsbCAhPSBub2RlLm5leHRbaV0pIHtcbiAgICAgIG9mZnNldCAtPSBub2RlLndpZHRoW2ldO1xuICAgICAgbm9kZSA9IG5vZGUubmV4dFtpXTtcbiAgICB9XG4gICAgc3RlcHNbaV0gPSBub2RlO1xuICAgIHdpZHRoW2ldID0gb2Zmc2V0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBub2RlOiBub2RlLFxuICAgIHN0ZXBzOiBzdGVwcyxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgb2Zmc2V0OiBvZmZzZXRcbiAgfTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNwbGljZSA9IGZ1bmN0aW9uKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7IC8vIHNraXAgc3RlcHMgbGVmdCBvZiB0aGUgb2Zmc2V0XG4gIHZhciB3aWR0aCA9IHMud2lkdGg7XG5cbiAgdmFyIHA7IC8vIGxlZnQgbm9kZSBvciBgcGBcbiAgdmFyIHE7IC8vIHJpZ2h0IG5vZGUgb3IgYHFgIChvdXIgbmV3IG5vZGUpXG4gIHZhciBsZW47XG5cbiAgLy8gY3JlYXRlIG5ldyBub2RlXG4gIGxldmVsID0gbGV2ZWwgfHwgdGhpcy5yYW5kb21MZXZlbCgpO1xuICBxID0gbmV3IE5vZGUodmFsdWUsIGxldmVsKTtcbiAgbGVuZ3RoID0gcS53aWR0aFswXTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBpdGVyYXRlIHN0ZXBzIGxldmVscyBiZWxvdyBuZXcgbm9kZSBsZXZlbFxuICBpID0gbGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbCBzdGVwXG4gICAgcS5uZXh0W2ldID0gcC5uZXh0W2ldOyAvLyBpbnNlcnQgc28gaW5oZXJpdCBsZWZ0J3MgbmV4dFxuICAgIHAubmV4dFtpXSA9IHE7IC8vIGxlZnQncyBuZXh0IGlzIG5vdyBvdXIgbmV3IG5vZGVcbiAgICBxLndpZHRoW2ldID0gcC53aWR0aFtpXSAtIHdpZHRoW2ldICsgbGVuZ3RoO1xuICAgIHAud2lkdGhbaV0gPSB3aWR0aFtpXTtcbiAgfVxuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgYWxsIGxldmVscyBkb3duIHVudGlsIGV4Y2VwdCBuZXcgbm9kZSBsZXZlbFxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBsZXZlbCkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsXG4gICAgcC53aWR0aFtpXSArPSBsZW5ndGg7IC8vIGFkZCBuZXcgbm9kZSB3aWR0aFxuICB9XG5cbiAgLy8gcmV0dXJuIG5ldyBub2RlXG4gIHJldHVybiBxO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChvZmZzZXQpO1xuXG4gIC8vIGlmIHNlYXJjaCBmYWxscyBpbiB0aGUgbWlkZGxlIG9mIGEgc3RyaW5nXG4gIC8vIGluc2VydCBpdCB0aGVyZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIGEgbmV3IG5vZGVcbiAgaWYgKHMub2Zmc2V0ICYmIHMubm9kZS52YWx1ZSAmJiBzLm9mZnNldCA8IHMubm9kZS52YWx1ZS5sZW5ndGgpIHtcbiAgICB0aGlzLnVwZGF0ZShzLCBpbnNlcnQocy5vZmZzZXQsIHMubm9kZS52YWx1ZSwgdmFsdWUpKTtcbiAgICByZXR1cm4gcy5ub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuc3BsaWNlKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIC8vIHZhbHVlcyBsZW5ndGggZGlmZmVyZW5jZVxuICB2YXIgbGVuZ3RoID0gcy5ub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICAvLyB1cGRhdGUgdmFsdWVcbiAgcy5ub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gZml4IHdpZHRocyBvbiBhbGwgbGV2ZWxzXG4gIGkgPSB0aGlzLmxldmVscztcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgcy5zdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKHJhbmdlWzFdID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAncmFuZ2UgZW5kIG92ZXIgbWF4aW11bSBsZW5ndGgoJyArXG4gICAgICB0aGlzLmxlbmd0aCArICcpOiBbJyArIHJhbmdlLmpvaW4oKSArICddJ1xuICAgICk7XG4gIH1cblxuICAvLyByZW1haW4gZGlzdGFuY2UgdG8gcmVtb3ZlXG4gIHZhciB4ID0gcmFuZ2VbMV0gLSByYW5nZVswXTtcblxuICAvLyBzZWFyY2ggZm9yIG5vZGUgb24gbGVmdCBlZGdlXG4gIHZhciBzID0gdGhpcy5zZWFyY2gocmFuZ2VbMF0pO1xuICB2YXIgb2Zmc2V0ID0gcy5vZmZzZXQ7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7XG4gIHZhciBub2RlID0gcy5ub2RlO1xuXG4gIC8vIHNraXAgaGVhZFxuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gIC8vIHNsaWNlIGxlZnQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKG9mZnNldCkge1xuICAgIGlmIChvZmZzZXQgPCBub2RlLndpZHRoWzBdKSB7XG4gICAgICB4IC09IHRoaXMudXBkYXRlKHMsXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoMCwgb2Zmc2V0KSArXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoXG4gICAgICAgICAgb2Zmc2V0ICtcbiAgICAgICAgICBNYXRoLm1pbih4LCBub2RlLmxlbmd0aCAtIG9mZnNldClcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gICAgaWYgKCFub2RlKSByZXR1cm47XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGZ1bGwgbm9kZXMgaW4gcmFuZ2VcbiAgd2hpbGUgKG5vZGUgJiYgeCA+PSBub2RlLndpZHRoWzBdKSB7XG4gICAgeCAtPSB0aGlzLnJlbW92ZU5vZGUoc3RlcHMsIG5vZGUpO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cblxuICAvLyBzbGljZSByaWdodCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAoeCkge1xuICAgIHRoaXMucmVwbGFjZShzdGVwcywgbm9kZSwgbm9kZS52YWx1ZS5zbGljZSh4KSk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZU5vZGUgPSBmdW5jdGlvbihzdGVwcywgbm9kZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS53aWR0aFswXTtcblxuICB2YXIgaTtcblxuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aCAtIG5vZGUud2lkdGhbaV07XG4gICAgc3RlcHNbaV0ubmV4dFtpXSA9IG5vZGUubmV4dFtpXTtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlLCB2YWx1ZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgbm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIHZhciBpO1xuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIG5vZGUud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlKFtvZmZzZXQsIG9mZnNldCsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnRDaHVua2VkID0gZnVuY3Rpb24ob2Zmc2V0LCB0ZXh0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gdGhpcy5jaHVua1NpemUpIHtcbiAgICB2YXIgY2h1bmsgPSB0ZXh0LnN1YnN0cihpLCB0aGlzLmNodW5rU2l6ZSk7XG4gICAgdGhpcy5pbnNlcnQoaSArIG9mZnNldCwgY2h1bmspO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zdWJzdHJpbmcgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBsZW5ndGggPSBiIC0gYTtcblxuICB2YXIgc2VhcmNoID0gdGhpcy5zZWFyY2goYSwgdHJ1ZSk7XG4gIHZhciBub2RlID0gc2VhcmNoLm5vZGU7XG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIHZhciBkID0gbGVuZ3RoICsgc2VhcmNoLm9mZnNldDtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKG5vZGUgJiYgZCA+PSAwKSB7XG4gICAgZCAtPSBub2RlLndpZHRoWzBdO1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG4gIGlmIChub2RlKSB7XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICB9XG5cbiAgcmV0dXJuIHMuc3Vic3RyKHNlYXJjaC5vZmZzZXQsIGxlbmd0aCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yYW5kb21MZXZlbCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbGV2ZWwgPSAxO1xuICB3aGlsZSAobGV2ZWwgPCB0aGlzLmxldmVscyAtIDEgJiYgTWF0aC5yYW5kb20oKSA8IHRoaXMuYmlhcykgbGV2ZWwrKztcbiAgcmV0dXJuIGxldmVsO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByYW5nZSA9IHJhbmdlIHx8IFtdO1xuICByZXR1cm4gdGhpcy5zdWJzdHJpbmcocmFuZ2VbMF0sIHJhbmdlWzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvcHkgPSBuZXcgU2tpcFN0cmluZztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHZhciBvZmZzZXQgPSAwO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIGNvcHkuaW5zZXJ0KG9mZnNldCwgbm9kZS52YWx1ZSk7XG4gICAgb2Zmc2V0ICs9IG5vZGUud2lkdGhbMF07XG4gIH1cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5qb2luU3RyaW5nID0gZnVuY3Rpb24oZGVsaW1pdGVyKSB7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBwYXJ0cy5wdXNoKG5vZGUudmFsdWUpO1xuICB9XG4gIHJldHVybiBwYXJ0cy5qb2luKGRlbGltaXRlcik7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5zdWJzdHJpbmcoMCwgdGhpcy5sZW5ndGgpO1xufTtcblxuZnVuY3Rpb24gdHJpbShzLCBsZWZ0LCByaWdodCkge1xuICByZXR1cm4gcy5zdWJzdHIoMCwgcy5sZW5ndGggLSByaWdodCkuc3Vic3RyKGxlZnQpO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcbnZhciBSID0gUmVnZXhwLmNyZWF0ZTtcblxuLy9OT1RFOiBvcmRlciBtYXR0ZXJzXG52YXIgc3ludGF4ID0gbWFwKHtcbiAgJ3QnOiBSKFsnb3BlcmF0b3InXSwgJ2cnLCBlbnRpdGllcyksXG4gICdtJzogUihbJ3BhcmFtcyddLCAgICdnJyksXG4gICdkJzogUihbJ2RlY2xhcmUnXSwgICdnJyksXG4gICdmJzogUihbJ2Z1bmN0aW9uJ10sICdnJyksXG4gICdrJzogUihbJ2tleXdvcmQnXSwgICdnJyksXG4gICduJzogUihbJ2J1aWx0aW4nXSwgICdnJyksXG4gICdsJzogUihbJ3N5bWJvbCddLCAgICdnJyksXG4gICdzJzogUihbJ3RlbXBsYXRlIHN0cmluZyddLCAnZycpLFxuICAnZSc6IFIoWydzcGVjaWFsJywnbnVtYmVyJ10sICdnJyksXG59LCBjb21waWxlKTtcblxudmFyIEluZGVudCA9IHtcbiAgcmVnZXhwOiBSKFsnaW5kZW50J10sICdnbScpLFxuICByZXBsYWNlcjogKHMpID0+IHMucmVwbGFjZSgvIHsxLDJ9fFxcdC9nLCAnPHg+JCY8L3g+Jylcbn07XG5cbnZhciBBbnlDaGFyID0gL1xcUy9nO1xuXG52YXIgQmxvY2tzID0gUihbJ2NvbW1lbnQnLCdzdHJpbmcnLCdyZWdleHAnXSwgJ2dtJyk7XG5cbnZhciBUYWcgPSB7XG4gICcvLyc6ICdjJyxcbiAgJy8qJzogJ2MnLFxuICAnYCc6ICdzJyxcbiAgJ1wiJzogJ3MnLFxuICBcIidcIjogJ3MnLFxuICAnLyc6ICdyJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3ludGF4O1xuXG5mdW5jdGlvbiBTeW50YXgobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy50YWIgPSBvLnRhYiB8fCAnXFx0JztcbiAgdGhpcy5tYXhMaW5lID0gby5tYXhMaW5lIHx8IDMwMDtcbiAgdGhpcy5ibG9ja3MgPSBbXTtcbn1cblxuU3ludGF4LnByb3RvdHlwZS5lbnRpdGllcyA9IGVudGl0aWVzO1xuXG5TeW50YXgucHJvdG90eXBlLmhpZ2hsaWdodCA9IGZ1bmN0aW9uKGNvZGUsIG9mZnNldCkge1xuICAvLyBjb25zb2xlLmxvZygwLCAnaGlnaGxpZ2h0JywgY29kZSlcblxuICBjb2RlID0gdGhpcy5jcmVhdGVJbmRlbnRzKGNvZGUpO1xuICBjb2RlID0gdGhpcy5jcmVhdGVCbG9ja3MoY29kZSk7XG4gIGNvZGUgPSBlbnRpdGllcyhjb2RlKTtcblxuICBmb3IgKHZhciBrZXkgaW4gc3ludGF4KSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShzeW50YXhba2V5XS5yZWdleHAsIHN5bnRheFtrZXldLnJlcGxhY2VyKTtcbiAgfVxuXG4gIGNvZGUgPSB0aGlzLnJlc3RvcmVCbG9ja3MoY29kZSk7XG5cbiAgY29kZSA9IGNvZGUucmVwbGFjZShJbmRlbnQucmVnZXhwLCBJbmRlbnQucmVwbGFjZXIpO1xuICAvLyBjb2RlID0gY29kZS5yZXBsYWNlKC9cXG4vZywgJzxicj4nKVxuXG4gIC8vIGNvZGUgPSBjb2RlLnJlcGxhY2UoL1xcdWVlZWUvZywgZnVuY3Rpb24oKSB7XG4gIC8vICAgcmV0dXJuIGxvbmcuc2hpZnQoKS5zbGljZSgwLCB0aGlzLm1heExpbmUpICsgJy4uLmxpbmUgdG9vIGxvbmcgdG8gZGlzcGxheSc7XG4gIC8vIH0pO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVJbmRlbnRzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XG4gIHZhciBpbmRlbnQgPSAwO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBsaW5lO1xuICB2YXIgaTtcblxuICBpID0gbGluZXMubGVuZ3RoO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgQW55Q2hhci5sYXN0SW5kZXggPSAwO1xuICAgIG1hdGNoID0gQW55Q2hhci5leGVjKGxpbmUpO1xuICAgIGlmIChtYXRjaCkgaW5kZW50ID0gbWF0Y2guaW5kZXg7XG4gICAgZWxzZSBpZiAoaW5kZW50ICYmICFsaW5lLmxlbmd0aCkge1xuICAgICAgbGluZXNbaV0gPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbih0aGlzLnRhYik7XG4gICAgfVxuICB9XG5cbiAgY29kZSA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5yZXN0b3JlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgYmxvY2s7XG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcbiAgdmFyIG4gPSAwO1xuICByZXR1cm4gY29kZS5yZXBsYWNlKC9cXHVmZmViL2csIGZ1bmN0aW9uKCkge1xuICAgIGJsb2NrID0gYmxvY2tzW24rK11cbiAgICB2YXIgdGFnID0gaWRlbnRpZnkoYmxvY2spO1xuICAgIHJldHVybiAnPCcrdGFnKyc+JytlbnRpdGllcyhibG9jaykrJzwvJyt0YWcrJz4nO1xuICB9KTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB0aGlzLmJsb2NrcyA9IFtdO1xuICBjb2RlID0gY29kZS5yZXBsYWNlKEJsb2NrcywgKGJsb2NrKSA9PiB7XG4gICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgcmV0dXJuICdcXHVmZmViJztcbiAgfSk7XG4gIHJldHVybiBjb2RlO1xufTtcblxuZnVuY3Rpb24gY3JlYXRlSWQoKSB7XG4gIHZhciBhbHBoYWJldCA9ICdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eic7XG4gIHZhciBsZW5ndGggPSBhbHBoYWJldC5sZW5ndGggLSAxO1xuICB2YXIgaSA9IDY7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzICs9IGFscGhhYmV0W01hdGgucmFuZG9tKCkgKiBsZW5ndGggfCAwXTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gZW50aXRpZXModGV4dCkge1xuICByZXR1cm4gdGV4dFxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICA7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGUocmVnZXhwLCB0YWcpIHtcbiAgdmFyIG9wZW5UYWcgPSAnPCcgKyB0YWcgKyAnPic7XG4gIHZhciBjbG9zZVRhZyA9ICc8LycgKyB0YWcgKyAnPic7XG4gIHJldHVybiB7XG4gICAgbmFtZTogdGFnLFxuICAgIHJlZ2V4cDogcmVnZXhwLFxuICAgIHJlcGxhY2VyOiBvcGVuVGFnICsgJyQmJyArIGNsb3NlVGFnXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hcChvYmosIGZuKSB7XG4gIHZhciByZXN1bHQgPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHJlc3VsdFtrZXldID0gZm4ob2JqW2tleV0sIGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZShwYXNzLCBjb2RlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFzcy5sZW5ndGg7IGkrKykge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UocGFzc1tpXVswXSwgcGFzc1tpXVsxXSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZ5KGJsb2NrKSB7XG4gIHZhciBvbmUgPSBibG9ja1swXTtcbiAgdmFyIHR3byA9IG9uZSArIGJsb2NrWzFdO1xuICByZXR1cm4gVGFnW3R3b10gfHwgVGFnW29uZV07XG59XG4iLCJ2YXIgUGFydHMgPSByZXF1aXJlKCcuL3BhcnRzJyk7XG5cbnZhciBUeXBlID0ge1xuICAnXFxuJzogJ2xpbmVzJyxcbiAgJ3snOiAnb3BlbiBjdXJseScsXG4gICd9JzogJ2Nsb3NlIGN1cmx5JyxcbiAgJ1snOiAnb3BlbiBzcXVhcmUnLFxuICAnXSc6ICdjbG9zZSBzcXVhcmUnLFxuICAnKCc6ICdvcGVuIHBhcmVucycsXG4gICcpJzogJ2Nsb3NlIHBhcmVucycsXG4gICcvJzogJ29wZW4gY29tbWVudCcsXG4gICcqJzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAnYCc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxuLy8gdmFyIFRPS0VOID0gL1xcbi9nO1xudmFyIFRPS0VOID0gL1xcbnxcXC9cXCp8XFwqXFwvfGB8XFx7fFxcfXxcXFt8XFxdfFxcKHxcXCkvZztcblxubW9kdWxlLmV4cG9ydHMgPSBUb2tlbnM7XG5cblRva2Vucy5UeXBlID0gVHlwZTtcblxuZnVuY3Rpb24gVG9rZW5zKGZhY3RvcnkpIHtcbiAgZmFjdG9yeSA9IGZhY3RvcnkgfHwgZnVuY3Rpb24oKSB7IHJldHVybiBuZXcgUGFydHM7IH07XG5cbiAgdmFyIHQgPSB0aGlzLnRva2VucyA9IHtcbiAgICBsaW5lczogZmFjdG9yeSgpLFxuICAgIGJsb2NrczogZmFjdG9yeSgpLFxuICAgIHNlZ21lbnRzOiBmYWN0b3J5KCksXG4gIH07XG5cbiAgdGhpcy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5ibG9ja3MsXG4gICAgJ30nOiB0LmJsb2NrcyxcbiAgICAnWyc6IHQuYmxvY2tzLFxuICAgICddJzogdC5ibG9ja3MsXG4gICAgJygnOiB0LmJsb2NrcyxcbiAgICAnKSc6IHQuYmxvY2tzLFxuICAgICcvJzogdC5zZWdtZW50cyxcbiAgICAnKic6IHQuc2VnbWVudHMsXG4gICAgJ2AnOiB0LnNlZ21lbnRzLFxuICB9O1xufVxuXG5Ub2tlbnMucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8fCAwO1xuXG4gIHZhciB0b2tlbnMgPSB0aGlzLnRva2VucztcbiAgdmFyIG1hdGNoO1xuICB2YXIgdHlwZTtcbiAgdmFyIGNvbGxlY3Rpb247XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGNvbGxlY3Rpb24gPSB0aGlzLmNvbGxlY3Rpb25bdGV4dFttYXRjaC5pbmRleF1dO1xuICAgIGNvbGxlY3Rpb24ucHVzaChtYXRjaC5pbmRleCArIG9mZnNldCk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIHNvcnRCeU51bWJlcihhLCBiKSB7XG4gIHJldHVybiBhIC0gYjtcbn1cblxuVG9rZW5zLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihyYW5nZSwgdGV4dCwgc2hpZnQpIHtcbiAgdmFyIGluc2VydCA9IG5ldyBUb2tlbnMoQXJyYXkpO1xuICBpbnNlcnQuaW5kZXgodGV4dCwgcmFuZ2VbMF0pO1xuICBmb3IgKHZhciB0eXBlIGluIHRoaXMudG9rZW5zKSB7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uc2hpZnRPZmZzZXQocmFuZ2VbMF0sIHNoaWZ0KTtcbiAgICAvLyBpZiAoc2hpZnQgPCAwKSByYW5nZVsxXSArPSBzaGlmdDtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5yZW1vdmVSYW5nZShyYW5nZSk7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0uaW5zZXJ0KHJhbmdlWzBdLCBpbnNlcnQudG9rZW5zW3R5cGVdKTtcbiAgfVxuICAvLyBjb25zb2xlLmxvZyhyYW5nZSlcbiAgLy8gY29uc29sZS5sb2codGhpcy50b2tlbnMubGluZXMudG9BcnJheSgpKVxufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeUluZGV4ID0gZnVuY3Rpb24odHlwZSwgaW5kZXgpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdLmdldChpbmRleCk7XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldENvbGxlY3Rpb24gPSBmdW5jdGlvbih0eXBlKSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlPZmZzZXQgPSBmdW5jdGlvbih0eXBlLCBvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdLmZpbmQob2Zmc2V0KTtcbn07XG4iLCJ2YXIgb3BlbiA9IHJlcXVpcmUoJy4uL2xpYi9vcGVuJyk7XG52YXIgc2F2ZSA9IHJlcXVpcmUoJy4uL2xpYi9zYXZlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBCdWZmZXIgPSByZXF1aXJlKCcuL2J1ZmZlcicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbGU7XG5cbmZ1bmN0aW9uIEZpbGUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5yb290ID0gJyc7XG4gIHRoaXMucGF0aCA9ICd1bnRpdGxlZCc7XG4gIHRoaXMuYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuRmlsZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5GaWxlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5idWZmZXIub24oJ3JhdycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdyYXcnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdzZXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnc2V0JykpO1xuICB0aGlzLmJ1ZmZlci5vbigndXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZScpKTtcbiAgdGhpcy5idWZmZXIub24oJ2JlZm9yZSB1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmVmb3JlIGNoYW5nZScpKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLnBhdGggPSBwYXRoO1xuICB0aGlzLnJvb3QgPSByb290O1xuICBvcGVuKHJvb3QgKyBwYXRoLCAoZXJyLCB0ZXh0KSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICBmbiAmJiBmbihlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xuICAgIHRoaXMuZW1pdCgnb3BlbicpO1xuICAgIGZuICYmIGZuKG51bGwsIHRoaXMpO1xuICB9KTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICBzYXZlKHRoaXMucm9vdCArIHRoaXMucGF0aCwgdGhpcy5idWZmZXIudG9TdHJpbmcoKSwgZm4gfHwgbm9vcCk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5mdW5jdGlvbiBub29wKCkgey8qIG5vb3AgKi99XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uL2xpYi9kZWJvdW5jZScpO1xuXG4vKlxuICAgLiAuXG4tMSAwIDEgMiAzIDQgNVxuICAgblxuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBIaXN0b3J5O1xuXG5mdW5jdGlvbiBIaXN0b3J5KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sb2cgPSBbXTtcbiAgdGhpcy5uZWVkbGUgPSAwO1xuICB0aGlzLnRpbWVvdXQgPSB0cnVlO1xuICB0aGlzLnRpbWVTdGFydCA9IDA7XG59XG5cbkhpc3RvcnkucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAoRGF0ZS5ub3coKSAtIHRoaXMudGltZVN0YXJ0ID4gMjAwMCkgdGhpcy5hY3R1YWxseVNhdmUoKTtcbiAgdGhpcy50aW1lb3V0ID0gdGhpcy5kZWJvdW5jZWRTYXZlKCk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5kZWJvdW5jZWRTYXZlID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG59LCA3MDApO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5hY3R1YWxseVNhdmUgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ3NhdmUnLCB0aGlzLm5lZWRsZSlcbiAgY2xlYXJUaW1lb3V0KHRoaXMudGltZW91dCk7XG4gIHRoaXMubG9nID0gdGhpcy5sb2cuc2xpY2UoMCwgKyt0aGlzLm5lZWRsZSk7XG4gIHRoaXMubG9nLnB1c2godGhpcy5jb21taXQoKSk7XG4gIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoO1xuICB0aGlzLnRpbWVTdGFydCA9IERhdGUubm93KCk7XG4gIHRoaXMudGltZW91dCA9IGZhbHNlO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUudW5kbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG5cbiAgdGhpcy5uZWVkbGUtLTtcblxuICBpZiAodGhpcy5uZWVkbGUgPCAwKSB0aGlzLm5lZWRsZSA9IDA7XG4gIC8vIGNvbnNvbGUubG9nKCd1bmRvJywgdGhpcy5uZWVkbGUsIHRoaXMubG9nLmxlbmd0aCAtIDEpXG5cbiAgdGhpcy5jaGVja291dCh0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5yZWRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIHRoaXMubmVlZGxlKys7XG4gIC8vIGNvbnNvbGUubG9nKCdyZWRvJywgdGhpcy5uZWVkbGUsIHRoaXMubG9nLmxlbmd0aCAtIDEpXG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuXG4gIHRoaXMuY2hlY2tvdXQodGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY2hlY2tvdXQgPSBmdW5jdGlvbihuKSB7XG4gIHZhciBjb21taXQgPSB0aGlzLmxvZ1tuXTtcbiAgaWYgKCFjb21taXQpIHJldHVybjtcbiAgdGhpcy5lZGl0b3IubWFyay5hY3RpdmUgPSBjb21taXQubWFya0FjdGl2ZTtcbiAgdGhpcy5lZGl0b3IubWFyay5zZXQoY29tbWl0Lm1hcmsuY29weSgpKTtcbiAgdGhpcy5lZGl0b3Iuc2V0Q2FyZXQoY29tbWl0LmNhcmV0LmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLmJ1ZmZlci50ZXh0ID0gY29tbWl0LnRleHQuY29weSgpO1xuICB0aGlzLmVkaXRvci5idWZmZXIubGluZXMgPSBjb21taXQubGluZXMuY29weSgpO1xuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgdGV4dDogdGhpcy5lZGl0b3IuYnVmZmVyLnRleHQuY29weSgpLFxuICAgIGxpbmVzOiB0aGlzLmVkaXRvci5idWZmZXIubGluZXMuY29weSgpLFxuICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgfTtcbn07XG4iLCJ2YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcblxudmFyIFBBR0lOR19USFJPVFRMRSA9IDY1O1xuXG52YXIga2V5cyA9IG1vZHVsZS5leHBvcnRzID0ge1xuICAnY3RybCt6JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnVuZG8oKTtcbiAgfSxcbiAgJ2N0cmwreSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS5yZWRvKCk7XG4gIH0sXG5cbiAgJ2hvbWUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUoKTtcbiAgfSxcbiAgJ2VuZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUoKTtcbiAgfSxcbiAgJ3BhZ2V1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ3BhZ2Vkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK3VwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCg2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93big2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSk7XG4gIH0sXG4gICd1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xKTtcbiAgfSxcbiAgJ3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEpO1xuICB9LFxuICAnZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxKTtcbiAgfSxcblxuICAnY3RybCtsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSk7XG4gIH0sXG4gICdjdHJsK3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrYSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH0sXG5cbiAgJ2N0cmwrc2hpZnQrdXAnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcbiAgJ2N0cmwrc2hpZnQrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCB7IGJlZ2luOiB0aGlzLmNhcmV0LnBvcywgZW5kOiB0aGlzLmNhcmV0LnBvcyB9KTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCB0aGlzLm1hcmsuZ2V0KCkpO1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdlbnRlcic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5zZXJ0KCdcXG4nKTtcbiAgfSxcblxuICAnYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCtkJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciBsaW5lcyA9IGFyZWEuZW5kLnkgLSBhcmVhLmJlZ2luLnk7XG4gICAgaWYgKGxpbmVzICYmIGFyZWEuZW5kLnggPiAwKSBhZGQgKz0gMTtcbiAgICBpZiAoIWxpbmVzKSBhZGQgKz0gMTtcbiAgICBsaW5lcyArPSBhZGQ7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhLnNldExlZnQoMCkuYWRkQm90dG9tKGFkZCkpO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh7IHg6IDAsIHk6IGFyZWEuZW5kLnkgfSwgdGV4dCk7XG4gICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcyhsaW5lcyk7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMobGluZXMsIHRydWUpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICd0YWInOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcmVzID0gdGhpcy5zdWdnZXN0KCk7XG4gICAgaWYgKCFyZXMpIHtcbiAgICAgIHRoaXMuaW5zZXJ0KHRoaXMudGFiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShyZXMuYXJlYSk7XG4gICAgICB0aGlzLmluc2VydChyZXMubm9kZS52YWx1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdjdHJsK2YnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmQub3BlbigpO1xuICB9LFxuXG4gICdmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoKzEpO1xuICB9LFxuICAnc2hpZnQrZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKC0xKTtcbiAgfSxcblxuICAnY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFkZDtcbiAgICB2YXIgYXJlYTtcbiAgICB2YXIgdGV4dDtcblxuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuXG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICBjbGVhciA9IHRydWU7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRoaXMubWFyay5hZGRCb3R0b20oYXJlYS5lbmQueCA+IDApLnNldExlZnQoMCk7XG4gICAgICB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYSh0aGlzLm1hcmsuZ2V0KCkpO1xuICAgIH1cblxuICAgIC8vVE9ETzogc2hvdWxkIGNoZWNrIGlmIGxhc3QgbGluZSBoYXMgLy8gYWxzb1xuICAgIGlmICh0ZXh0LnRyaW1MZWZ0KCkuc3Vic3RyKDAsMikgPT09ICcvLycpIHtcbiAgICAgIGFkZCA9IC0zO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXiguKj8pXFwvXFwvICguKykvZ20sICckMSQyJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkZCA9ICszO1xuICAgICAgdGV4dCA9IHRleHQucmVwbGFjZSgvXihbXFxzXSopKC4rKS9nbSwgJyQxLy8gJDInKTtcbiAgICB9XG5cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcblxuICAgIHRoaXMubWFyay5zZXQoYXJlYS5hZGRSaWdodChhZGQpKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuXG4gICAgaWYgKGNhcmV0LngpIGNhcmV0LmFkZFJpZ2h0KGFkZCk7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldCk7XG5cbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIGNsZWFyID0gdHJ1ZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICAgIGlmICh0ZXh0LnNsaWNlKDAsMikgPT09ICcvKicgJiYgdGV4dC5zbGljZSgtMikgPT09ICcqLycpIHtcbiAgICAgIHRleHQgPSB0ZXh0LnNsaWNlKDIsLTIpO1xuICAgICAgYWRkIC09IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgLT0gMjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGV4dCA9ICcvKicgKyB0ZXh0ICsgJyovJztcbiAgICAgIGFkZCArPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkICs9IDI7XG4gICAgfVxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuICAgIGFyZWEuZW5kLnggKz0gYWRkO1xuICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0LmFkZFJpZ2h0KGFkZCkpO1xuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG59O1xuXG5rZXlzLnNpbmdsZSA9IHtcbiAgLy9cbn07XG5cbi8vIHNlbGVjdGlvbiBrZXlzXG5bICdob21lJywnZW5kJyxcbiAgJ3BhZ2V1cCcsJ3BhZ2Vkb3duJyxcbiAgJ2xlZnQnLCd1cCcsJ3JpZ2h0JywnZG93bicsXG4gICdjdHJsK2xlZnQnLCdjdHJsK3JpZ2h0J1xuXS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICBrZXlzWydzaGlmdCsnK2tleV0gPSBmdW5jdGlvbihlKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICBrZXlzW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfTtcbn0pO1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgTW91c2UgPSByZXF1aXJlKCcuL21vdXNlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vdGV4dCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IElucHV0O1xuXG5mdW5jdGlvbiBJbnB1dChlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubW91c2UgPSBuZXcgTW91c2UodGhpcyk7XG4gIHRoaXMudGV4dCA9IG5ldyBUZXh0O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5JbnB1dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5JbnB1dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmx1ciA9IHRoaXMuYmx1ci5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xuICB0aGlzLnRleHQub24oWydrZXknLCAndGV4dCddLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnaW5wdXQnKSk7XG4gIHRoaXMudGV4dC5vbignZm9jdXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKSk7XG4gIHRoaXMudGV4dC5vbignYmx1cicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJykpO1xuICB0aGlzLnRleHQub24oJ3RleHQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAndGV4dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXlzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleXMnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2tleScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjdXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY3V0JykpO1xuICB0aGlzLnRleHQub24oJ2NvcHknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY29weScpKTtcbiAgdGhpcy50ZXh0Lm9uKCdwYXN0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdwYXN0ZScpKTtcbiAgdGhpcy5tb3VzZS5vbigndXAnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2V1cCcpKTtcbiAgdGhpcy5tb3VzZS5vbignY2xpY2snLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VjbGljaycpKTtcbiAgdGhpcy5tb3VzZS5vbignZG93bicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRvd24nKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnIGJlZ2luJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZ2JlZ2luJykpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgdGhpcy5tb3VzZS51c2Uobm9kZSk7XG4gIHRoaXMudGV4dC5yZXNldCgpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmJsdXIoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuZm9jdXMoKTtcbn07XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW91c2U7XG5cbmZ1bmN0aW9uIE1vdXNlKCkge1xuICB0aGlzLm5vZGUgPSBudWxsO1xuICB0aGlzLmNsaWNrcyA9IDA7XG4gIHRoaXMucG9pbnQgPSBuZXcgUG9pbnQ7XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbk1vdXNlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdXNlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5vbm1heWJlZHJhZyA9IHRoaXMub25tYXliZWRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRyYWcgPSB0aGlzLm9uZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZG93biA9IHRoaXMub25kb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub251cCA9IHRoaXMub251cC5iaW5kKHRoaXMpO1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xufTtcblxuTW91c2UucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKG5vZGUpIHtcbiAgaWYgKHRoaXMubm9kZSkge1xuICAgIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gICAgLy8gdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xuICB9XG4gIHRoaXMubm9kZSA9IG5vZGU7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCB0aGlzLm9uZG93bik7XG4gIC8vIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRvd24gPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmRvd24gPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2Rvd24nLCBlKTtcbiAgdGhpcy5vbmNsaWNrKGUpO1xuICB0aGlzLm1heWJlRHJhZygpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9udXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndXAnLCBlKTtcbiAgaWYgKCF0aGlzLmRvd24pIHJldHVybjtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5kcmFnRW5kKCk7XG4gIHRoaXMubWF5YmVEcmFnRW5kKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25jbGljayA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5yZXNldENsaWNrcygpO1xuICB0aGlzLmNsaWNrcyA9ICh0aGlzLmNsaWNrcyAlIDMpICsgMTtcbiAgdGhpcy5lbWl0KCdjbGljaycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9ubWF5YmVkcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcblxuICB2YXIgZCA9XG4gICAgICBNYXRoLmFicyh0aGlzLnBvaW50LnggLSB0aGlzLmRvd24ueClcbiAgICArIE1hdGguYWJzKHRoaXMucG9pbnQueSAtIHRoaXMuZG93bi55KTtcblxuICBpZiAoZCA+IDUpIHtcbiAgICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xuICAgIHRoaXMuZHJhZ0JlZ2luKCk7XG4gIH1cbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuICB0aGlzLmVtaXQoJ2RyYWcnLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBiZWdpbicpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGVuZCcpO1xufTtcblxuXG5Nb3VzZS5wcm90b3R5cGUucmVzZXRDbGlja3MgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGlja3MgPSAwO1xufSwgMzUwKTtcblxuTW91c2UucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG5cbnZhciBUSFJPVFRMRSA9IDEwMDAvNjI7XG5cbnZhciBtYXAgPSB7XG4gIDg6ICdiYWNrc3BhY2UnLFxuICA5OiAndGFiJyxcbiAgMTM6ICdlbnRlcicsXG4gIDMzOiAncGFnZXVwJyxcbiAgMzQ6ICdwYWdlZG93bicsXG4gIDM1OiAnZW5kJyxcbiAgMzY6ICdob21lJyxcbiAgMzc6ICdsZWZ0JyxcbiAgMzg6ICd1cCcsXG4gIDM5OiAncmlnaHQnLFxuICA0MDogJ2Rvd24nLFxuICA0NjogJ2RlbGV0ZScsXG4gIDQ4OiAnMCcsXG4gIDQ5OiAnMScsXG4gIDUwOiAnMicsXG4gIDUxOiAnMycsXG4gIDUyOiAnNCcsXG4gIDUzOiAnNScsXG4gIDU0OiAnNicsXG4gIDU1OiAnNycsXG4gIDU2OiAnOCcsXG4gIDU3OiAnOScsXG4gIDY1OiAnYScsXG4gIDY4OiAnZCcsXG4gIDcwOiAnZicsXG4gIDc3OiAnbScsXG4gIDc4OiAnbicsXG4gIDgzOiAncycsXG4gIDg5OiAneScsXG4gIDkwOiAneicsXG4gIDExMjogJ2YxJyxcbiAgMTE0OiAnZjMnLFxuICAxMjI6ICdmMTEnLFxuICAxODg6ICcsJyxcbiAgMTkwOiAnLicsXG4gIDE5MTogJy8nLFxuXG4gIC8vIG51bXBhZFxuICA5NzogJ2VuZCcsXG4gIDk4OiAnZG93bicsXG4gIDk5OiAncGFnZWRvd24nLFxuICAxMDA6ICdsZWZ0JyxcbiAgMTAyOiAncmlnaHQnLFxuICAxMDM6ICdob21lJyxcbiAgMTA0OiAndXAnLFxuICAxMDU6ICdwYWdldXAnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBUZXh0O1xuXG5UZXh0Lm1hcCA9IG1hcDtcblxuZnVuY3Rpb24gVGV4dCgpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGV4dGFyZWEnKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHBvc2l0aW9uOiAnYWJzb2x1dGUnLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIHdpZHRoOiAxLFxuICAgIGhlaWdodDogMSxcbiAgICBvcGFjaXR5OiAwXG4gIH0pO1xuXG4gIGRvbS5hdHRycyh0aGlzLCB7XG4gICAgYXV0b2NhcGl0YWxpemU6ICdub25lJyxcbiAgICBhdXRvY29tcGxldGU6ICdvZmYnLFxuICAgIHNwZWxsY2hlY2tpbmc6ICdvZmYnLFxuICB9KTtcblxuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cblRleHQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVGV4dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25jdXQgPSB0aGlzLm9uY3V0LmJpbmQodGhpcyk7XG4gIHRoaXMub25jb3B5ID0gdGhpcy5vbmNvcHkuYmluZCh0aGlzKTtcbiAgdGhpcy5vbnBhc3RlID0gdGhpcy5vbnBhc3RlLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXl1cCA9IHRoaXMub25rZXl1cC5iaW5kKHRoaXMpO1xuICB0aGlzLmVsLm9uYmx1ciA9IHRoaXMuZW1pdC5iaW5kKHRoaXMsICdibHVyJyk7XG4gIHRoaXMuZWwub25mb2N1cyA9IHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpO1xuICB0aGlzLmVsLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQ7XG4gIHRoaXMuZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMuZWwub25rZXl1cCA9IHRoaXMub25rZXl1cDtcbiAgdGhpcy5lbC5vbmN1dCA9IHRoaXMub25jdXQ7XG4gIHRoaXMuZWwub25jb3B5ID0gdGhpcy5vbmNvcHk7XG4gIHRoaXMuZWwub25wYXN0ZSA9IHRoaXMub25wYXN0ZTtcbn07XG5cblRleHQucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbn1cblxuVGV4dC5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVsLnZhbHVlLnN1YnN0cigtMSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih2YWx1ZSkge1xuICB0aGlzLmVsLnZhbHVlID0gdmFsdWU7XG59O1xuXG4vL1RPRE86IG9uIG1vYmlsZSB3ZSBuZWVkIHRvIGNsZWFyIHdpdGhvdXQgZGVib3VuY2Vcbi8vIG9yIHRoZSB0ZXh0YXJlYSBjb250ZW50IGlzIGRpc3BsYXllZCBpbiBoYWNrZXIncyBrZXlib2FyZFxuLy8gb3IgeW91IG5lZWQgdG8gZGlzYWJsZSB3b3JkIHN1Z2dlc3Rpb25zIGluIGhhY2tlcidzIGtleWJvYXJkIHNldHRpbmdzXG5UZXh0LnByb3RvdHlwZS5jbGVhciA9IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG59LCAyMDAwKTtcblxuVGV4dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmJsdXIoKTtcbn07XG5cblRleHQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuZm9jdXMoKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgLy8gZm9yY2VzIGNhcmV0IHRvIGVuZCBvZiB0ZXh0YXJlYSBzbyB3ZSBjYW4gZ2V0IC5zbGljZSgtMSkgY2hhclxuICBzZXRJbW1lZGlhdGUoKCkgPT4gdGhpcy5lbC5zZWxlY3Rpb25TdGFydCA9IHRoaXMuZWwudmFsdWUubGVuZ3RoKTtcbiAgdGhpcy5lbWl0KCd0ZXh0JywgdGhpcy5nZXQoKSk7XG4gIHRoaXMuY2xlYXIoKTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICAvLyBjb25zb2xlLmxvZyhlLndoaWNoKTtcbiAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gIGlmIChub3cgLSB0aGlzLnRocm90dGxlVGltZSA8IFRIUk9UVExFKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB0aGlzLnRocm90dGxlVGltZSA9IG5vdztcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleXVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCAmJiAhZS5zaGlmdEtleSkga2V5cy5wdXNoKCdzaGlmdDp1cCcpO1xuICBpZiAobS5jdHJsICYmICFlLmN0cmxLZXkpIGtleXMucHVzaCgnY3RybDp1cCcpO1xuICBpZiAobS5hbHQgJiYgIWUuYWx0S2V5KSBrZXlzLnB1c2goJ2FsdDp1cCcpO1xuXG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdICsgJzp1cCcpO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25jdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjdXQnLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uY29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2NvcHknLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ucGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdwYXN0ZScsIGUpO1xufTtcbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi9saWIvcmVnZXhwJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uL2xpYi9wb2ludCcpO1xuXG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsnd29yZHMnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3ZlO1xuXG5mdW5jdGlvbiBNb3ZlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xufVxuXG5Nb3ZlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VEb3duID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIHNpemUgLSByZW1haW5kZXIpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKHBhZ2UpO1xufTtcblxuTW92ZS5wcm90b3R5cGUucGFnZVVwID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIC0oc2l6ZSAtIHJlbWFpbmRlcikpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKC1wYWdlKTtcbn07XG5cbnZhciBtb3ZlID0ge307XG5cbm1vdmUuYnlXb3JkID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgbGluZSA9IGJ1ZmZlci5nZXRMaW5lVGV4dChwLnkpO1xuXG4gIGlmIChkeCA+IDAgJiYgcC54ID49IGxpbmUubGVuZ3RoIC0gMSkgeyAvLyBhdCBlbmQgb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCArMSk7IC8vIG1vdmUgb25lIGNoYXIgcmlnaHRcbiAgfSBlbHNlIGlmIChkeCA8IDAgJiYgcC54ID09PSAwKSB7IC8vIGF0IGJlZ2luIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgLTEpOyAvLyBtb3ZlIG9uZSBjaGFyIGxlZnRcbiAgfVxuXG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZShsaW5lLCBXT1JEUyk7XG4gIHZhciB3b3JkO1xuXG4gIGlmIChkeCA8IDApIHdvcmRzLnJldmVyc2UoKTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmIChkeCA+IDBcbiAgICAgID8gd29yZC5pbmRleCA+IHAueFxuICAgICAgOiB3b3JkLmluZGV4IDwgcC54KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiB3b3JkLmluZGV4LFxuICAgICAgICB5OiBwLnlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVhY2hlZCBiZWdpbi9lbmQgb2YgZmlsZVxuICByZXR1cm4gZHggPiAwXG4gICAgPyBtb3ZlLmVuZE9mTGluZShidWZmZXIsIHApXG4gICAgOiBtb3ZlLmJlZ2luT2ZMaW5lKGJ1ZmZlciwgcCk7XG59O1xuXG5tb3ZlLmJ5Q2hhcnMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHggPCAwKSB7IC8vIGdvaW5nIGxlZnRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIGxlZnRcbiAgICBpZiAoeCA8IDApIHsgLy8gd2hlbiBwYXN0IGxlZnQgZWRnZVxuICAgICAgaWYgKHkgPiAwKSB7IC8vIGFuZCBsaW5lcyBhYm92ZVxuICAgICAgICB5IC09IDE7IC8vIG1vdmUgdXAgYSBsaW5lXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGFuZCBnbyB0byB0aGUgZW5kIG9mIGxpbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHggPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChkeCA+IDApIHsgLy8gZ29pbmcgcmlnaHRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIHJpZ2h0XG4gICAgd2hpbGUgKHggLSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggPiAwKSB7IC8vIHdoaWxlIHBhc3QgbGluZSBsZW5ndGhcbiAgICAgIGlmICh5ID09PSBidWZmZXIubG9jKCkpIHsgLy8gb24gZW5kIG9mIGZpbGVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gZ28gdG8gZW5kIG9mIGxpbmUgb24gbGFzdCBsaW5lXG4gICAgICAgIGJyZWFrOyAvLyBhbmQgZXhpdFxuICAgICAgfVxuICAgICAgeCAtPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGggKyAxOyAvLyB3cmFwIHRoaXMgbGluZSBsZW5ndGhcbiAgICAgIHkgKz0gMTsgLy8gYW5kIG1vdmUgZG93biBhIGxpbmVcbiAgICB9XG4gIH1cblxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYnlMaW5lcyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHkpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeSA8IDApIHsgLy8gZ29pbmcgdXBcbiAgICBpZiAoeSArIGR5ID4gMCkgeyAvLyB3aGVuIGxpbmVzIGFib3ZlXG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIHVwXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSAwO1xuICAgIH1cbiAgfSBlbHNlIGlmIChkeSA+IDApIHsgLy8gZ29pbmcgZG93blxuICAgIGlmICh5IDwgYnVmZmVyLmxvYygpIC0gZHkpIHsgLy8gd2hlbiBsaW5lcyBiZWxvd1xuICAgICAgeSArPSBkeTsgLy8gbW92ZSBkb3duXG4gICAgfSBlbHNlIHtcbiAgICAgIHkgPSBidWZmZXIubG9jKCk7XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgKHggPiBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aCkge1xuICAvLyAgIHggPSBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gfVxuICB4ID0gTWF0aC5taW4odGhpcy5sYXN0RGVsaWJlcmF0ZVgsIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkxpbmUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5lbmRPZkxpbmUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShwLnkpLmxlbmd0aDtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSBJbmZpbml0eTtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgdmFyIHggPSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGhcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogbGFzdFxuICB9O1xufTtcblxubW92ZS5pc0JlZ2luT2ZGaWxlID0gZnVuY3Rpb24oXywgcCkge1xuICByZXR1cm4gcC54ID09PSAwICYmIHAueSA9PT0gMDtcbn07XG5cbm1vdmUuaXNFbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHJldHVybiBwLnkgPT09IGxhc3QgJiYgcC54ID09PSBidWZmZXIuZ2V0TGluZShsYXN0KS5sZW5ndGg7XG59O1xuXG5PYmplY3Qua2V5cyhtb3ZlKS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICBNb3ZlLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24ocGFyYW0sIGJ5RWRpdCkge1xuICAgIHZhciByZXN1bHQgPSBtb3ZlW21ldGhvZF0uY2FsbChcbiAgICAgIHRoaXMsXG4gICAgICB0aGlzLmVkaXRvci5idWZmZXIsXG4gICAgICB0aGlzLmVkaXRvci5jYXJldCxcbiAgICAgIHBhcmFtXG4gICAgKTtcblxuICAgIGlmICgnaXMnID09PSBtZXRob2Quc2xpY2UoMCwyKSkgcmV0dXJuIHJlc3VsdDtcblxuICAgIHRoaXMuZW1pdCgnbW92ZScsIHJlc3VsdCwgYnlFZGl0KTtcbiAgfTtcbn0pO1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJlZGl0b3JcIjpcIl9zcmNfc3R5bGVfX2VkaXRvclwiLFwibGF5ZXJcIjpcIl9zcmNfc3R5bGVfX2xheWVyXCIsXCJyb3dzXCI6XCJfc3JjX3N0eWxlX19yb3dzXCIsXCJtYXJrXCI6XCJfc3JjX3N0eWxlX19tYXJrXCIsXCJjb2RlXCI6XCJfc3JjX3N0eWxlX19jb2RlXCIsXCJjYXJldFwiOlwiX3NyY19zdHlsZV9fY2FyZXRcIixcImJsaW5rLXNtb290aFwiOlwiX3NyY19zdHlsZV9fYmxpbmstc21vb3RoXCIsXCJjYXJldC1ibGluay1zbW9vdGhcIjpcIl9zcmNfc3R5bGVfX2NhcmV0LWJsaW5rLXNtb290aFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIGVyZ29ub206IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MUUxNicsXG4gICAgY29sb3I6ICcjRTlFM0QxJyxcbiAgICBrZXl3b3JkOiAnI0ExMzYzMCcsXG4gICAgZnVuY3Rpb246ICcjQjNERjAyJyxcbiAgICBkZWNsYXJlOiAnI0Y2MzgzMycsXG4gICAgbnVtYmVyOiAnI0ZGOUY0RScsXG4gICAgcGFyYW1zOiAnI0EwOTBBMCcsXG4gICAgcmVnZXhwOiAnI0JENzBGNCcsXG4gICAgY29tbWVudDogJyM2MzUwNDcnLFxuICAgIHN0cmluZzogJyMzRUExRkInLFxuICB9LFxuXG4gIGRheWxpZ2h0OiB7XG4gICAgYmFja2dyb3VuZDogJyNFQkVCRUInLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyNGRjFCMUInLFxuICAgIGZ1bmN0aW9uOiAnIzAwMDVGRicsXG4gICAgZGVjbGFyZTogJyMwQzdBMDAnLFxuICAgIG51bWJlcjogJyM4MDIxRDQnLFxuICAgIHBhcmFtczogJyM0QzY5NjknLFxuICAgIGNvbW1lbnQ6ICcjQUJBQkFCJyxcbiAgICBzdHJpbmc6ICcjRTY3MDAwJyxcbiAgfSxcbn07XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHNldFRoZW1lO1xuZXhwb3J0cy50aGVtZXMgPSB0aGVtZXM7XG5cbi8qXG50OiBvcGVyYXRvclxuazoga2V5d29yZFxuZDogZGVjbGFyZVxuYjogYnVpbHRpblxubzogYm9vbGVhblxubjogbnVtYmVyXG5tOiBwYXJhbXNcbmY6IGZ1bmN0aW9uXG5yOiByZWdleHBcbmM6IGNvbW1lbnRcbnM6IHN0cmluZ1xubDogc3ltYm9sXG54OiBpbmRlbnRcbiAqL1xuZnVuY3Rpb24gc2V0VGhlbWUobmFtZSkge1xuICB2YXIgdCA9IHRoZW1lc1tuYW1lXTtcbiAgZG9tLmNzcygndGhlbWUnLFxuYFxuLiR7bmFtZX0ge1xuICBiYWNrZ3JvdW5kOiAke3QuYmFja2dyb3VuZH07XG59XG5cbnQsXG5rIHtcbiAgY29sb3I6ICR7dC5rZXl3b3JkfTtcbn1cblxuZCxcbm4ge1xuICBjb2xvcjogJHt0LmRlY2xhcmV9O1xufVxuXG5vLFxuZSB7XG4gIGNvbG9yOiAke3QubnVtYmVyfTtcbn1cblxubSB7XG4gIGNvbG9yOiAke3QucGFyYW1zfTtcbn1cblxuZiB7XG4gIGNvbG9yOiAke3QuZnVuY3Rpb259O1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbnIge1xuICBjb2xvcjogJHt0LnJlZ2V4cCB8fCB0LnBhcmFtc307XG59XG5cbmMge1xuICBjb2xvcjogJHt0LmNvbW1lbnR9O1xufVxuXG5zIHtcbiAgY29sb3I6ICR7dC5zdHJpbmd9O1xufVxuXG5sLFxuLiR7Y3NzLmNvZGV9IHtcbiAgY29sb3I6ICR7dC5jb2xvcn07XG59XG5cbi4ke2Nzcy5jYXJldH0ge1xuICBiYWNrZ3JvdW5kOiAke3QuY29sb3J9O1xufVxuXG5tLFxuZCB7XG4gIGZvbnQtc3R5bGU6IGl0YWxpYztcbn1cblxubCB7XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxueCB7XG4gIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgYmFja2dyb3VuZC1yZXBlYXQ6IG5vLXJlcGVhdDtcbn1cbmBcbiAgKVxuXG59XG5cbiIsInZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCbG9jaztcblxuZnVuY3Rpb24gQmxvY2sobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEpO1xufVxuXG5CbG9jay5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5CbG9jay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVuZGVyUGFnZSgxLCB0cnVlKTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ29kZTtcblxuZnVuY3Rpb24gQ29kZShuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNyk7XG59XG5cbkNvZGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuQ29kZS5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIHRoaXMuY2xlYXIoKTtcbiAgLy8gcmV0dXJuIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcblxuICBpZiAoIXRoaXMuZWRpdG9yLmVkaXRpbmcpIHtcbiAgICB0aGlzLnJlbmRlckFoZWFkKCk7XG4gIH1cbn07XG5cbkNvZGUucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIC8vIHRoaXMuY2xlYXIoKTtcbiAgLy8gcmV0dXJuIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcblxuICB2YXIgeSA9IGVkaXQubGluZTtcbiAgdmFyIGcgPSBlZGl0LnJhbmdlLnNsaWNlKCk7XG4gIHZhciBzaGlmdCA9IGVkaXQuc2hpZnQ7XG4gIHZhciBpc0VudGVyID0gc2hpZnQgPiAwO1xuICB2YXIgaXNCYWNrc3BhY2UgPSBzaGlmdCA8IDA7XG4gIHZhciBpc0JlZ2luID0gZ1swXSArIGlzQmFja3NwYWNlID09PSAwO1xuICB2YXIgaXNFbmQgPSBnWzFdICsgaXNFbnRlciA9PT0gdGhpcy5lZGl0b3Iucm93cztcblxuICBpZiAoc2hpZnQpIHtcbiAgICBpZiAoaXNFbnRlcikge1xuICAgICAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwwXSk7XG4gICAgICBpZiAoIXRoaXMuaGFzVmlld1RvcEF0KGVkaXQuY2FyZXROb3cueSkgfHwgZWRpdC5jYXJldEJlZm9yZS54ID4gMCkge1xuICAgICAgICB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhlZGl0LmNhcmV0Tm93LnkgKyAxLCAxKTtcbiAgICAgICAgdGhpcy5zcGxpdEVudGVyKGVkaXQuY2FyZXROb3cueSk7XG4gICAgICAgIGlmIChlZGl0LmNhcmV0QmVmb3JlLnggPiAwKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVSYW5nZShbZWRpdC5jYXJldEJlZm9yZS55LCBlZGl0LmNhcmV0QmVmb3JlLnldKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zaGlmdFZpZXdzQmVsb3coZWRpdC5jYXJldE5vdy55LCAxKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyUGFnZUJlbG93KGVkaXQuY2FyZXROb3cueSsxKTtcbiAgICB9XG4gICAgZWxzZSBpZiAoaXNCYWNrc3BhY2UpIHtcbiAgICAgIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMV0pO1xuICAgICAgdGhpcy5zaG9ydGVuQm90dG9tQXQoZWRpdC5jYXJldE5vdy55KTtcbiAgICAgIHRoaXMuc2hpZnRWaWV3c0JlbG93KGVkaXQuY2FyZXROb3cueSsxLCAtMSk7XG4gICAgICBpZiAoIXRoaXMuaGFzVmlld1RvcEF0KGVkaXQuY2FyZXROb3cueSkpIHtcbiAgICAgICAgdGhpcy5zcGxpdEJhY2tzcGFjZShlZGl0LmNhcmV0Tm93LnkpO1xuICAgICAgfVxuICAgICAgaWYgKGVkaXQuY2FyZXROb3cueCA+IDApIHtcbiAgICAgICAgdGhpcy51cGRhdGVSYW5nZShbZWRpdC5jYXJldE5vdy55LCBlZGl0LmNhcmV0Tm93LnldKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyUGFnZUJlbG93KGVkaXQuY2FyZXROb3cueSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRoaXMudXBkYXRlUmFuZ2UoZyk7XG4gICAgdGhpcy5yZW5kZXJQYWdlKDApO1xuICB9XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbmQ7XG5cbmZ1bmN0aW9uIEZpbmQobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDQpO1xufVxuXG5GaW5kLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkZpbmQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcbiAgdGhpcy5yZW5kZXJQYWdlKDApO1xufTtcbiIsInZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xudmFyIEZpbmRWaWV3ID0gcmVxdWlyZSgnLi9maW5kJyk7XG52YXIgQmxvY2tWaWV3ID0gcmVxdWlyZSgnLi9ibG9jaycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3cztcblxuZnVuY3Rpb24gVmlld3MoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuXG4gIHRoaXMudmlld3MgPSBbXG4gICAgbmV3IFZpZXcoJ3J1bGVyJywgZWRpdG9yLCB0ZW1wbGF0ZS5ydWxlciksXG4gICAgbmV3IFZpZXcoJ2NhcmV0JywgZWRpdG9yLCB0ZW1wbGF0ZS5jYXJldCksXG4gICAgbmV3IENvZGVWaWV3KCdjb2RlJywgZWRpdG9yLCB0ZW1wbGF0ZS5jb2RlKSxcbiAgICBuZXcgTWFya1ZpZXcoJ21hcmsnLCBlZGl0b3IsIHRlbXBsYXRlLm1hcmspLFxuICAgIG5ldyBSb3dzVmlldygncm93cycsIGVkaXRvciwgdGVtcGxhdGUucm93cyksXG4gICAgLy8gbmV3IEZpbmRWaWV3KCdmaW5kJywgZWRpdG9yLCB0ZW1wbGF0ZS5maW5kKSxcbiAgICBuZXcgQmxvY2tWaWV3KCdibG9jaycsIGVkaXRvciwgdGVtcGxhdGUuYmxvY2spLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcblxuICB0aGlzLmJsb2NrLnJlbmRlciA9IGRlYm91bmNlKHRoaXMuYmxvY2sucmVuZGVyLCAyMCk7XG5cbiAgLy9UT0RPOiBuZWVkcyB0byBiZSBzZXQgZHluYW1pY2FsbHlcbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuaGlkZV9yb3dzKSB0aGlzLnJvd3MucmVuZGVyID0gbm9vcDtcbn1cblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59LFxuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xuXG52YXIgQWhlYWRUaHJlc2hvbGQgPSB7XG4gIGFuaW1hdGlvbjogWy4xNSwgLjRdLFxuICBub3JtYWw6IFsxLjUsIDNdXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IExheWVyO1xuXG5mdW5jdGlvbiBMYXllcihuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCBsZW5ndGgpIHtcbiAgdGhpcy5kb20gPSBkb20oY3NzLmxheWVyKTtcbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy52aWV3cyA9IHRoaXMuY3JlYXRlKGxlbmd0aCk7XG59XG5cbkxheWVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkxheWVyLnByb3RvdHlwZS5jcmVhdGUgPSBmdW5jdGlvbihsZW5ndGgpIHtcbiAgdmFyIHZpZXdzID0gbmV3IEFycmF5KGxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXSA9IG5ldyBWaWV3KHRoaXMubmFtZSwgdGhpcy5lZGl0b3IsIHRoaXMudGVtcGxhdGUpO1xuICAgIGRvbS5hcHBlbmQodGhpcywgdmlld3NbaV0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZXF1ZXN0VmlldyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiB2aWV3O1xuICB9XG4gIHJldHVybiB0aGlzLmNsZWFyKClbMF07XG59O1xuXG5MYXllci5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuaW5SYW5nZVZpZXdzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHZpZXdzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAoIHZpZXcudmlzaWJsZSA9PT0gdHJ1ZVxuICAgICAgJiYgKCB2aWV3WzBdID49IHJhbmdlWzBdICYmIHZpZXdbMF0gPD0gcmFuZ2VbMV1cbiAgICAgICAgfHwgdmlld1sxXSA+PSByYW5nZVswXSAmJiB2aWV3WzFdIDw9IHJhbmdlWzFdICkgKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUub3V0UmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IGZhbHNlXG4gICAgICB8fCB2aWV3WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHZpZXdbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHZpZXdzLnB1c2godmlldyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB2aWV3cy5zb3J0KChhLGIpID0+IGEubGFzdFVzZWQgLSBiLmxhc3RVc2VkKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJSYW5nZXMgPSBmdW5jdGlvbihyYW5nZXMsIHZpZXdzKSB7XG4gIGZvciAodmFyIG4gPSAwLCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciByYW5nZSA9IHJhbmdlc1tpXTtcbiAgICB2YXIgdmlldyA9IHZpZXdzW24rK107XG4gICAgdmlldy5yZW5kZXIocmFuZ2UpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgaW5jbHVkZSkge1xuICB2YXIgdmlzaWJsZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5WaWV3cyA9IHRoaXMuaW5SYW5nZVZpZXdzKHJhbmdlKTtcbiAgdmFyIG91dFZpZXdzID0gdGhpcy5vdXRSYW5nZVZpZXdzKG1heChyYW5nZSwgdmlzaWJsZVJhbmdlKSk7XG5cbiAgdmFyIG5lZWRSYW5nZXMgPSBSYW5nZS5OT1QocmFuZ2UsIGluVmlld3MpO1xuICB2YXIgbmVlZFZpZXdzID0gbmVlZFJhbmdlcy5sZW5ndGggLSBvdXRWaWV3cy5sZW5ndGg7XG4gIGlmIChuZWVkVmlld3MgPiAwKSB7XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIHRoaXMucmVuZGVyUmFuZ2VzKFt2aXNpYmxlUmFuZ2VdLCB0aGlzLnZpZXdzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZWxzZSBpZiAoaW5jbHVkZSkgdGhpcy5yZW5kZXJWaWV3cyhpblZpZXdzKTtcbiAgdGhpcy5yZW5kZXJSYW5nZXMobmVlZFJhbmdlcywgb3V0Vmlld3MpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclZpZXdzID0gZnVuY3Rpb24odmlld3MpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB2aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZpZXdzW2ldLnJlbmRlcigpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyTGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5yZW5kZXJSYW5nZShbeSx5XSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUGFnZSA9IGZ1bmN0aW9uKG4sIGluY2x1ZGUpIHtcbiAgbiA9IG4gfHwgMDtcbiAgdGhpcy5yZW5kZXJSYW5nZSh0aGlzLmdldFBhZ2VSYW5nZShbLW4sK25dKSwgaW5jbHVkZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyQWhlYWQgPSBmdW5jdGlvbihpbmNsdWRlKSB7XG4gIHZhciB2aWV3cyA9IHRoaXMudmlld3M7XG4gIHZhciBjdXJyZW50UGFnZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuXG4gIC8vIG5vIHZpZXcgaXMgdmlzaWJsZSwgcmVuZGVyIGN1cnJlbnQgcGFnZSBvbmx5XG4gIGlmIChSYW5nZS5BTkQoY3VycmVudFBhZ2VSYW5nZSwgdmlld3MpLmxlbmd0aCA9PT0gMCkge1xuICAgIHRoaXMucmVuZGVyUGFnZSgwKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBjaGVjayBpZiB3ZSdyZSBwYXN0IHRoZSB0aHJlc2hvbGQgb2Ygdmlld1xuICB2YXIgdGhyZXNob2xkID0gdGhpcy5lZGl0b3IuYW5pbWF0aW9uUnVubmluZ1xuICAgID8gWy1BaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF0sICtBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF1dXG4gICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFswXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFswXV07XG5cbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZSh0aHJlc2hvbGQpO1xuICB2YXIgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHZpZXdzKTtcbiAgaWYgKGFoZWFkTmVlZFJhbmdlcy5sZW5ndGgpIHtcbiAgICAvLyBpZiBzbywgcmVuZGVyIGZ1cnRoZXIgYWhlYWQgdG8gaGF2ZSBzb21lXG4gICAgLy8gbWFyZ2luIHRvIHNjcm9sbCB3aXRob3V0IHRyaWdnZXJpbmcgbmV3IHJlbmRlcnNcbiAgICB0aGlzLnJlbmRlclBhZ2UoXG4gICAgICB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgICAgID8gQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdXG4gICAgICAgIDogQWhlYWRUaHJlc2hvbGQubm9ybWFsWzFdLFxuICAgICAgaW5jbHVkZVxuICAgICk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5zcGxpY2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcblxuICAgIGlmICh2aWV3WzFdIDwgcmFuZ2VbMF0gfHwgdmlld1swXSA+IHJhbmdlWzFdKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAodmlld1swXSA8IHJhbmdlWzBdICYmIHZpZXdbMV0gPj0gcmFuZ2VbMF0pIHsgLy8gc2hvcnRlbiBhYm92ZVxuICAgICAgdmlld1sxXSA9IHJhbmdlWzBdIC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMV0gPiByYW5nZVsxXSkgeyAvLyBzaG9ydGVuIGJlbG93XG4gICAgICB2aWV3WzBdID0gcmFuZ2VbMV0gKyAxO1xuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMF0gPT09IHJhbmdlWzBdICYmIHZpZXdbMV0gPT09IHJhbmdlWzFdKSB7IC8vIGN1cnJlbnQgbGluZVxuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmlldy5jbGVhcigpO1xuICAgIH1cbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLmhhc1ZpZXdUb3BBdCA9IGZ1bmN0aW9uKHkpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzBdID09PSB5KSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc2hvcnRlbkJvdHRvbUF0ID0gZnVuY3Rpb24oeSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMV0gPT09IHkpIHtcbiAgICAgIHZpZXdbMV0gLT0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc3BsaXRFbnRlciA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzBdIDw9IHkgJiYgdmlld1sxXSA+PSB5KSB7XG4gICAgICB2YXIgYm90dG9tID0gdmlld1sxXTtcbiAgICAgIHZpZXdbMV0gPSB5IC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICAgIHRoaXMucmVuZGVyUmFuZ2UoW3krMSwgTWF0aC5taW4ocGFnZVJhbmdlWzFdLCBib3R0b20rMSldKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc3BsaXRCYWNrc3BhY2UgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBwYWdlUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbMCwxXSk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5ICYmIHZpZXdbMV0gPj0geSkge1xuICAgICAgdmFyIGJvdHRvbSA9IHZpZXdbMV07XG4gICAgICB2aWV3WzFdID0geSAtIDE7XG4gICAgICB2aWV3LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclJhbmdlKFt5LCBNYXRoLm1pbihwYWdlUmFuZ2VbMV0sIGJvdHRvbSsxKV0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5zaGlmdFZpZXdzQmVsb3cgPSBmdW5jdGlvbih5LCBkeSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMF0gPCB5KSBjb250aW51ZTtcblxuICAgIHZpZXdbMF0gKz0gZHk7XG4gICAgdmlld1sxXSArPSBkeTtcbiAgICB2aWV3LnN0eWxlKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhck91dFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMub3V0UmFuZ2VWaWV3cyh0aGlzLmdldFBhZ2VSYW5nZShyYW5nZSkpLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclBhZ2VCZWxvdyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5yZW5kZXJSYW5nZShbeSwgdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pWzFdXSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUudXBkYXRlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLnNwbGljZVJhbmdlKHJhbmdlKTtcbiAgdGhpcy5yZW5kZXJSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy52aWV3c1tpXS5jbGVhcigpO1xuICB9XG4gIHJldHVybiB0aGlzLnZpZXdzO1xufTtcblxuZnVuY3Rpb24gbWF4KGEsIGIpIHtcbiAgcmV0dXJuIFtNYXRoLm1pbihhWzBdLCBiWzBdKSwgTWF0aC5tYXgoYVsxXSwgYlsxXSldO1xufVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hcms7XG5cbmZ1bmN0aW9uIE1hcmsobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEpO1xufVxuXG5NYXJrLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbk1hcmsucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlclBhZ2UoMCwgdHJ1ZSk7XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJvd3M7XG5cbmZ1bmN0aW9uIFJvd3MobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDcpO1xufVxuXG5Sb3dzLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cblJvd3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICAvLyB0aGlzLmNsZWFyKCk7XG4gIC8vIHJldHVybiB0aGlzLnJlbmRlclBhZ2UoMCwgdHJ1ZSk7XG5cbiAgdmFyIHZpZXdzID0gdGhpcy52aWV3cztcbiAgdmFyIHJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB2aWV3c1tpXTtcbiAgICB2YXIgciA9IHZpZXc7XG4gICAgaWYgKCF2aWV3LnZpc2libGUpIGNvbnRpbnVlO1xuXG4gICAgaWYgKHJbMV0gPiByb3dzKSB2aWV3LmNsZWFyKCk7XG4gIH1cblxuICB0aGlzLnJlbmRlckFoZWFkKCk7XG59O1xuIiwidmFyIHRlbXBsYXRlID0gZXhwb3J0cztcblxudGVtcGxhdGUuY29kZSA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIC8vIGlmICh0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucGFyYW0gPT09IGNvZGUpIHtcbiAgLy8gICByZXR1cm4gdGVtcGxhdGUuY29kZS5tZW1vaXplLnJlc3VsdDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gICB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucGFyYW0gPSBjb2RlO1xuICAvLyAgIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5yZXN1bHQgPSBmYWxzZTtcbiAgLy8gfVxuXG4gIC8vIHZhciBodG1sID0gZS5idWZmZXIuZ2V0SGlnaGxpZ2h0ZWQocmFuZ2UpO1xuICB2YXIgaHRtbCA9IGUuYnVmZmVyLmdldChyYW5nZSk7XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG4vLyBzaW5nbGV0b24gbWVtb2l6ZSBmb3IgZmFzdCBsYXN0IHJlcGVhdGluZyB2YWx1ZVxudGVtcGxhdGUuY29kZS5tZW1vaXplID0ge1xuICBwYXJhbTogJycsXG4gIHJlc3VsdDogJydcbn07XG5cbnRlbXBsYXRlLnJvd3MgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcyA9ICcnO1xuICBmb3IgKHZhciBpID0gcmFuZ2VbMF07IGkgPD0gcmFuZ2VbMV07IGkrKykge1xuICAgIHMgKz0gKGkgKyAxKSArICdcXG4nO1xuICB9XG4gIHJldHVybiBzO1xufTtcblxudGVtcGxhdGUubWFyayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBtYXJrID0gZS5tYXJrLmdldCgpO1xuICBpZiAocmFuZ2VbMF0gPiBtYXJrLmVuZC55KSByZXR1cm4gZmFsc2U7XG4gIGlmIChyYW5nZVsxXSA8IG1hcmsuYmVnaW4ueSkgcmV0dXJuIGZhbHNlO1xuXG4gIHZhciBvZmZzZXRzID0gZS5idWZmZXIuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBhcmVhID0gZS5idWZmZXIuZ2V0QXJlYU9mZnNldFJhbmdlKG1hcmspO1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG5cbiAgYXJlYVswXSAtPSBvZmZzZXRzWzBdO1xuICBhcmVhWzFdIC09IG9mZnNldHNbMF07XG5cbiAgdmFyIGFib3ZlID0gY29kZS5zdWJzdHJpbmcoMCwgYXJlYVswXSk7XG4gIHZhciBtaWRkbGUgPSBjb2RlLnN1YnN0cmluZyhhcmVhWzBdLCBhcmVhWzFdKTtcbiAgdmFyIGh0bWwgPSBlLnN5bnRheC5lbnRpdGllcyhhYm92ZSlcbiAgICArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciB0YWJzO1xuICB2YXIgcjtcbiAgd2hpbGUgKHJlc3VsdHNbaV0gJiYgcmVzdWx0c1tpXS55IDwgcmFuZ2VbMV0pIHtcbiAgICByID0gcmVzdWx0c1tpKytdO1xuICAgIHRhYnMgPSBlLmdldFBvaW50VGFicyhyKTtcbiAgICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgICArICd3aWR0aDonICsgd2lkdGggKyAnOydcbiAgICAgICAgICArICd0b3A6JyArIChyLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICAgKyAnbGVmdDonICsgKChyLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBodG1sID0gJyc7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcblxuICB2YXIgcmVzdWx0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5T2Zmc2V0KCdibG9ja3MnLCBvZmZzZXQpO1xuICBpZiAoIXJlc3VsdCkgcmV0dXJuIGh0bWw7XG5cbiAgdmFyIGxlbmd0aCA9IGUuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdibG9ja3MnKS5sZW5ndGg7XG4gIHZhciBjaGFyID0gZS5idWZmZXIuY2hhckF0KHJlc3VsdCk7XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgaSA9IHJlc3VsdC5pbmRleDtcbiAgdmFyIG9wZW5PZmZzZXQgPSByZXN1bHQub2Zmc2V0O1xuXG4gIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG5cbiAgdmFyIGNvdW50ID0gcmVzdWx0Lm9mZnNldCA+PSBvZmZzZXQgLSAxICYmIENsb3NlW2NoYXJdID8gMCA6IDE7XG5cbiAgdmFyIGxpbWl0ID0gMjAwO1xuXG4gIHdoaWxlIChpID4gMCkge1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAoIS0tbGltaXQpIHJldHVybiBodG1sO1xuXG4gICAgaWYgKG9wZW4gJiYgIS0tY291bnQpIGJyZWFrO1xuXG4gICAgb3Blbk9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCAtLWkpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIGNvdW50ID0gMTtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID1cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID1cbnRlbXBsYXRlLm1hcmsuc3R5bGUgPVxudGVtcGxhdGUucm93cy5zdHlsZSA9XG50ZW1wbGF0ZS5jb2RlLnN0eWxlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiByYW5nZVswXSAqIGUuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogZS5jaGFyLmhlaWdodFxuICB9O1xufTtcblxudGVtcGxhdGUuY2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUuY2FyZXQuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6ICtlLmhhc0ZvY3VzLFxuICAgIGxlZnQ6IGUuY2FyZXRQeC54ICsgZS5tYXJnaW5MZWZ0LFxuICAgIHRvcDogZS5jYXJldFB4LnkgLSAxLFxuICAgIGhlaWdodDogZS5jaGFyLmhlaWdodCArIDIsXG4gIH07XG59O1xuXG50ZW1wbGF0ZS5ndXR0ZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG51bGw7XG59O1xuXG50ZW1wbGF0ZS5ndXR0ZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6IDEsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiBlLnJvd3MgKiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUucnVsZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUucnVsZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIC8vIHdpZHRoOiBlLmxvbmdlc3RMaW5lICogZS5jaGFyLndpZHRoLFxuICAgIG9wYWNpdHk6IDAsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAoKGUucm93cyArIGUucGFnZS5oZWlnaHQpICogZS5jaGFyLmhlaWdodCkgKyBlLnBhZ2VSZW1haW5kZXIuaGVpZ2h0LFxuICB9O1xufTtcblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvbWVyZ2UnKTtcbnZhciB0cmltID0gcmVxdWlyZSgnLi4vLi4vbGliL3RyaW0nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5mdW5jdGlvbiBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFZpZXcpKSByZXR1cm4gbmV3IFZpZXcobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSk7XG5cbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcblxuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgdGhpcy5sYXN0VXNlZCA9IDA7XG5cbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHRoaXMuZWwuY2xhc3NOYW1lID0gY3NzW25hbWVdO1xuXG4gIHZhciBzdHlsZSA9IHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAwLFxuICAgIG9wYWNpdHk6IDBcbiAgfTtcblxuICBpZiAodGhpcy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzLmluZGV4T2YobmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICB9XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHN0eWxlKTtcbn1cblxuVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKCFyYW5nZSkgcmFuZ2UgPSB0aGlzO1xuXG4gIHRoaXMubGFzdFVzZWQgPSBEYXRlLm5vdygpO1xuXG4gIC8vIGNvbnNvbGUubG9nKHRoaXMubmFtZSwgdGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSwgZGlmZih0aGlzLnZhbHVlLCBlLmxheW91dFt0aGlzLm5hbWVdKSlcbiAgLy8gaWYgKCFkaWZmKHRoaXMudmFsdWUsIHRoaXMuZWRpdG9yLmxheW91dFt0aGlzLm5hbWVdKSkgcmV0dXJuO1xuXG4gIHZhciBodG1sID0gdGhpcy50ZW1wbGF0ZShyYW5nZSwgdGhpcy5lZGl0b3IpO1xuICBpZiAoaHRtbCA9PT0gZmFsc2UpIHJldHVybiB0aGlzLnN0eWxlKCk7XG5cbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG4gIHRoaXMudmlzaWJsZSA9IHRydWU7XG5cbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSB7XG4gIC8vICAgdmFyIHJlcyA9IHRyaW0uZW1wdHlMaW5lcyhodG1sKVxuICAvLyAgIHJhbmdlWzBdICs9IHJlcy5sZWFkaW5nO1xuICAvLyAgIGh0bWwgPSByZXMuc3RyaW5nO1xuICAvLyB9XG5cbiAgaWYgKGh0bWwpIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICBlbHNlIGlmICgnY29kZScgPT09IHRoaXMubmFtZSB8fCAnYmxvY2snID09PSB0aGlzLm5hbWUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG5cbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicsIHRoaXMubmFtZSlcbiAgdGhpcy5zdHlsZSgpO1xufTtcblxuVmlldy5wcm90b3R5cGUuc3R5bGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0VXNlZCA9IERhdGUubm93KCk7XG4gIGRvbS5zdHlsZSh0aGlzLCB0aGlzLnRlbXBsYXRlLnN0eWxlKHRoaXMsIHRoaXMuZWRpdG9yKSk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpc1swXSArICcsJyArIHRoaXNbMV07XG59O1xuXG5WaWV3LnByb3RvdHlwZS52YWx1ZU9mID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBbdGhpc1swXSwgdGhpc1sxXV07XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMudmlzaWJsZSkgcmV0dXJuO1xuICB0aGlzWzBdID0gdGhpc1sxXSA9IC0xO1xuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgLy8gZG9tLmh0bWwodGhpcywgJycpO1xuICBkb20uc3R5bGUodGhpcywgeyB0b3A6IDAsIGhlaWdodDogMCwgb3BhY2l0eTogMCB9KTtcbn07XG4iXX0=
