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
  if (!this.editing) this.render();
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
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
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
    top: e.caretPx.y,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwibGliL3RyaW0uanMiLCJzcmMvYnVmZmVyL2luZGV4LmpzIiwic3JjL2J1ZmZlci9pbmRleGVyLmpzIiwic3JjL2J1ZmZlci9wYXJ0cy5qcyIsInNyYy9idWZmZXIvcHJlZml4dHJlZS5qcyIsInNyYy9idWZmZXIvc2VnbWVudHMuanMiLCJzcmMvYnVmZmVyL3NraXBzdHJpbmcuanMiLCJzcmMvYnVmZmVyL3N5bnRheC5qcyIsInNyYy9idWZmZXIvdG9rZW5zLmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4NUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25NQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RTQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pUQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5TEE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEphenpcbiAqL1xuXG52YXIgRGVmYXVsdE9wdGlvbnMgPSB7XG4gIHRoZW1lOiAnd2VzdGVybicsXG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogOTUsXG4gIGhpZGVfcm93czogZmFsc2UsXG4gIGNlbnRlcjogZmFsc2UsXG4gIG1hcmdpbl9sZWZ0OiAxNSxcbiAgZ3V0dGVyX21hcmdpbjogMjAsXG59O1xuXG5yZXF1aXJlKCcuL2xpYi9zZXQtaW1tZWRpYXRlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnLi9saWIvZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vbGliL2RpZmYnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbGliL21lcmdlJyk7XG52YXIgY2xvbmUgPSByZXF1aXJlKCcuL2xpYi9jbG9uZScpO1xudmFyIGJpbmRSYWYgPSByZXF1aXJlKCcuL2xpYi9iaW5kLXJhZicpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi9saWIvZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4vbGliL3JlZ2V4cCcpO1xudmFyIERpYWxvZyA9IHJlcXVpcmUoJy4vbGliL2RpYWxvZycpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi9saWIvcG9pbnQnKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4vbGliL3JhbmdlJyk7XG52YXIgQXJlYSA9IHJlcXVpcmUoJy4vbGliL2FyZWEnKTtcbnZhciBCb3ggPSByZXF1aXJlKCcuL2xpYi9ib3gnKTtcblxudmFyIERlZmF1bHRCaW5kaW5ncyA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L2JpbmRpbmdzJyk7XG52YXIgSGlzdG9yeSA9IHJlcXVpcmUoJy4vc3JjL2hpc3RvcnknKTtcbnZhciBJbnB1dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0Jyk7XG52YXIgRmlsZSA9IHJlcXVpcmUoJy4vc3JjL2ZpbGUnKTtcbnZhciBNb3ZlID0gcmVxdWlyZSgnLi9zcmMvbW92ZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC90ZXh0Jyk7XG52YXIgVmlld3MgPSByZXF1aXJlKCcuL3NyYy92aWV3cycpO1xudmFyIHRoZW1lID0gcmVxdWlyZSgnLi9zcmMvdGhlbWUnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3NyYy9zdHlsZS5jc3MnKTtcblxudmFyIE5FV0xJTkUgPSBSZWdleHAuY3JlYXRlKFsnbmV3bGluZSddLCAnZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEpheno7XG5cbmZ1bmN0aW9uIEphenoob3B0aW9ucykge1xuICB0aGlzLm9wdGlvbnMgPSBtZXJnZShjbG9uZShEZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMgfHwge30pO1xuXG4gIE9iamVjdC5hc3NpZ24odGhpcywge1xuICAgIGVsOiBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG5cbiAgICBpZDogJ2phenpfJyArIChNYXRoLnJhbmRvbSgpICogMTBlNiB8IDApLnRvU3RyaW5nKDM2KSxcbiAgICBmaWxlOiBuZXcgRmlsZSxcbiAgICBtb3ZlOiBuZXcgTW92ZSh0aGlzKSxcbiAgICB2aWV3czogbmV3IFZpZXdzKHRoaXMpLFxuICAgIGlucHV0OiBuZXcgSW5wdXQodGhpcyksXG4gICAgaGlzdG9yeTogbmV3IEhpc3RvcnkodGhpcyksXG5cbiAgICBiaW5kaW5nczogeyBzaW5nbGU6IHt9IH0sXG5cbiAgICBmaW5kOiBuZXcgRGlhbG9nKCdGaW5kJywgVGV4dC5tYXApLFxuICAgIGZpbmRWYWx1ZTogJycsXG4gICAgZmluZE5lZWRsZTogMCxcbiAgICBmaW5kUmVzdWx0czogW10sXG5cbiAgICBzY3JvbGw6IG5ldyBQb2ludCxcbiAgICBvZmZzZXQ6IG5ldyBQb2ludCxcbiAgICBzaXplOiBuZXcgQm94LFxuICAgIGNoYXI6IG5ldyBCb3gsXG5cbiAgICBwYWdlOiBuZXcgQm94LFxuICAgIHBhZ2VQb2ludDogbmV3IFBvaW50LFxuICAgIHBhZ2VSZW1haW5kZXI6IG5ldyBCb3gsXG4gICAgcGFnZUJvdW5kczogbmV3IFJhbmdlLFxuXG4gICAgbG9uZ2VzdExpbmU6IDAsXG4gICAgZ3V0dGVyOiAwLFxuICAgIGNvZGU6IDAsXG4gICAgcm93czogMCxcblxuICAgIHRhYlNpemU6IDIsXG4gICAgdGFiOiAnICAnLFxuXG4gICAgY2FyZXQ6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG4gICAgY2FyZXRQeDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcblxuICAgIGhhc0ZvY3VzOiBmYWxzZSxcblxuICAgIG1hcms6IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICAgIH0pLFxuXG4gICAgZWRpdGluZzogZmFsc2UsXG4gICAgZWRpdExpbmU6IC0xLFxuICAgIGVkaXRSYW5nZTogWy0xLC0xXSxcbiAgICBlZGl0U2hpZnQ6IDAsXG5cbiAgICBzdWdnZXN0SW5kZXg6IDAsXG4gICAgc3VnZ2VzdFJvb3Q6ICcnLFxuICAgIHN1Z2dlc3ROb2RlczogW10sXG5cbiAgICBhbmltYXRpb25GcmFtZTogLTEsXG4gICAgYW5pbWF0aW9uUnVubmluZzogZmFsc2UsXG4gICAgYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0OiBudWxsLFxuICB9KTtcblxuICBkb20uYXBwZW5kKHRoaXMudmlld3MuY2FyZXQsIHRoaXMuaW5wdXQudGV4dCk7XG4gIGRvbS5hcHBlbmQodGhpcywgdGhpcy52aWV3cyk7XG5cbiAgLy8gdXNlZnVsIHNob3J0Y3V0c1xuICB0aGlzLmJ1ZmZlciA9IHRoaXMuZmlsZS5idWZmZXI7XG4gIHRoaXMuYnVmZmVyLm1hcmsgPSB0aGlzLm1hcms7XG4gIHRoaXMuc3ludGF4ID0gdGhpcy5idWZmZXIuc3ludGF4O1xuXG4gIHRoZW1lKHRoaXMub3B0aW9ucy50aGVtZSk7XG5cbiAgdGhpcy5iaW5kTWV0aG9kcygpO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5KYXp6LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkphenoucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uKGVsLCBzY3JvbGxFbCkge1xuICBpZiAodGhpcy5yZWYpIHtcbiAgICB0aGlzLmVsLnJlbW92ZUF0dHJpYnV0ZSgnaWQnKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUoY3NzLmVkaXRvcik7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gICAgdGhpcy5vZmZTY3JvbGwoKTtcbiAgICB0aGlzLnJlZi5mb3JFYWNoKHJlZiA9PiB7XG4gICAgICBkb20uYXBwZW5kKGVsLCByZWYpO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHRoaXMucmVmID0gW10uc2xpY2UuY2FsbCh0aGlzLmVsLmNoaWxkcmVuKTtcbiAgICBkb20uYXBwZW5kKGVsLCB0aGlzLmVsKTtcbiAgICBkb20ub25yZXNpemUodGhpcy5vblJlc2l6ZSk7XG4gIH1cblxuICB0aGlzLmVsID0gZWw7XG4gIHRoaXMuZWwuc2V0QXR0cmlidXRlKCdpZCcsIHRoaXMuaWQpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQoY3NzLmVkaXRvcik7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZCh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICB0aGlzLm9mZlNjcm9sbCA9IGRvbS5vbnNjcm9sbChzY3JvbGxFbCB8fCB0aGlzLmVsLCB0aGlzLm9uU2Nyb2xsKTtcbiAgdGhpcy5pbnB1dC51c2UodGhpcy5lbCk7XG5cbiAgc2V0VGltZW91dCh0aGlzLnJlcGFpbnQsIDApO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYXNzaWduID0gZnVuY3Rpb24oYmluZGluZ3MpIHtcbiAgdGhpcy5iaW5kaW5ncyA9IGJpbmRpbmdzO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLmZpbGUub3BlbihwYXRoLCByb290LCBmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHRoaXMuZmlsZS5zYXZlKGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0LCBwYXRoKSB7XG4gIHRoaXMuZmlsZS5zZXQodGV4dCk7XG4gIHRoaXMuZmlsZS5wYXRoID0gcGF0aCB8fCB0aGlzLmZpbGUucGF0aDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5mb2N1cyk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICBzZXRJbW1lZGlhdGUodGhpcy5pbnB1dC5ibHVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luID0gdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbi5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmluZEhhbmRsZXJzKClcbiAgdGhpcy5tb3ZlLm9uKCdtb3ZlJywgdGhpcy5vbk1vdmUpO1xuICB0aGlzLmZpbGUub24oJ3JhdycsIHRoaXMub25GaWxlUmF3KTsgLy9UT0RPOiBzaG91bGQgbm90IG5lZWQgdGhpcyBldmVudFxuICB0aGlzLmZpbGUub24oJ3NldCcsIHRoaXMub25GaWxlU2V0KTtcbiAgdGhpcy5maWxlLm9uKCdvcGVuJywgdGhpcy5vbkZpbGVPcGVuKTtcbiAgdGhpcy5maWxlLm9uKCdjaGFuZ2UnLCB0aGlzLm9uRmlsZUNoYW5nZSk7XG4gIHRoaXMuZmlsZS5vbignYmVmb3JlIGNoYW5nZScsIHRoaXMub25CZWZvcmVGaWxlQ2hhbmdlKTtcbiAgdGhpcy5oaXN0b3J5Lm9uKCdjaGFuZ2UnLCB0aGlzLm9uSGlzdG9yeUNoYW5nZSk7XG4gIHRoaXMuaW5wdXQub24oJ2JsdXInLCB0aGlzLm9uQmx1cik7XG4gIHRoaXMuaW5wdXQub24oJ2ZvY3VzJywgdGhpcy5vbkZvY3VzKTtcbiAgdGhpcy5pbnB1dC5vbignaW5wdXQnLCB0aGlzLm9uSW5wdXQpO1xuICB0aGlzLmlucHV0Lm9uKCd0ZXh0JywgdGhpcy5vblRleHQpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXlzJywgdGhpcy5vbktleXMpO1xuICB0aGlzLmlucHV0Lm9uKCdrZXknLCB0aGlzLm9uS2V5KTtcbiAgdGhpcy5pbnB1dC5vbignY3V0JywgdGhpcy5vbkN1dCk7XG4gIHRoaXMuaW5wdXQub24oJ2NvcHknLCB0aGlzLm9uQ29weSk7XG4gIHRoaXMuaW5wdXQub24oJ3Bhc3RlJywgdGhpcy5vblBhc3RlKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2V1cCcsIHRoaXMub25Nb3VzZVVwKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2Vkb3duJywgdGhpcy5vbk1vdXNlRG93bik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlY2xpY2snLCB0aGlzLm9uTW91c2VDbGljayk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZ2JlZ2luJywgdGhpcy5vbk1vdXNlRHJhZ0JlZ2luKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnJywgdGhpcy5vbk1vdXNlRHJhZyk7XG4gIHRoaXMuZmluZC5vbignc3VibWl0JywgdGhpcy5maW5kSnVtcC5iaW5kKHRoaXMsIDEpKTtcbiAgdGhpcy5maW5kLm9uKCd2YWx1ZScsIHRoaXMub25GaW5kVmFsdWUpO1xuICB0aGlzLmZpbmQub24oJ2tleScsIHRoaXMub25GaW5kS2V5KTtcbiAgdGhpcy5maW5kLm9uKCdvcGVuJywgdGhpcy5vbkZpbmRPcGVuKTtcbiAgdGhpcy5maW5kLm9uKCdjbG9zZScsIHRoaXMub25GaW5kQ2xvc2UpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25TY3JvbGwgPSBmdW5jdGlvbihzY3JvbGwpIHtcbiAgdGhpcy5zY3JvbGwuc2V0KHNjcm9sbCk7XG4gIGlmICghdGhpcy5lZGl0aW5nKSB0aGlzLnJlbmRlcigpO1xuICB0aGlzLnJlc3QoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnJlc3QgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIHRoaXMucmVuZGVyKCk7XG59LCAzMDApO1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikgdGhpcy5tYXJrU2V0KCk7XG4gICAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIGlmICghdGhpcy5lZGl0aW5nKSB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25SZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZvY3VzID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdmb2N1cycpO1xuICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25CbHVyID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmhhc0ZvY3VzID0gZmFsc2U7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykge1xuICAgICAgdGhpcy5lbWl0KCdibHVyJyk7XG4gICAgICB0aGlzLnZpZXdzLmNhcmV0LnJlbmRlcigpO1xuICAgIH1cbiAgfSwgNSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbklucHV0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25UZXh0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLnN1Z2dlc3RSb290ID0gJyc7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXlzID0gZnVuY3Rpb24oa2V5cywgZSkge1xuICBpZiAoa2V5cyBpbiB0aGlzLmJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXlzIGluIERlZmF1bHRCaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25LZXkgPSBmdW5jdGlvbihrZXksIGUpIHtcbiAgaWYgKGtleSBpbiB0aGlzLmJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5IGluIERlZmF1bHRCaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzLnNpbmdsZVtrZXldLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uQ3V0ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdGhpcy5vbkNvcHkoZSk7XG4gIHRoaXMuZGVsZXRlKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhVGV4dChhcmVhKTtcbiAgZS5jbGlwYm9hcmREYXRhLnNldERhdGEoJ3RleHQvcGxhaW4nLCB0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIHZhciB0ZXh0ID0gZS5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubW92ZS5iZWdpbk9mRmlsZSgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVJhdyA9IGZ1bmN0aW9uKHJhdykge1xuICB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRUYWJNb2RlID0gZnVuY3Rpb24oY2hhcikge1xuICBpZiAoJ1xcdCcgPT09IGNoYXIpIHtcbiAgICB0aGlzLnRhYiA9IGNoYXI7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy50YWIgPSBuZXcgQXJyYXkodGhpcy50YWJTaXplICsgMSkuam9pbihjaGFyKTtcbiAgfVxufVxuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVTZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldCh7IHg6MCwgeTowIH0pO1xuICAvLyB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcbiAgLy8gdGhpcy5zZXRUYWJNb2RlKHRoaXMuYnVmZmVyLnN5bnRheC50YWIpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25IaXN0b3J5Q2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXIoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAvLyB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLmVkaXRDYXJldEJlZm9yZSA9IHRoaXMuY2FyZXQuY29weSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICAvLyB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuXG4gIHRoaXMudmlld3MuY29kZS5yZW5kZXJFZGl0KHtcbiAgICBsaW5lOiBlZGl0UmFuZ2VbMF0sXG4gICAgcmFuZ2U6IGVkaXRSYW5nZSxcbiAgICBzaGlmdDogZWRpdFNoaWZ0LFxuICAgIGNhcmV0Tm93OiB0aGlzLmNhcmV0LFxuICAgIGNhcmV0QmVmb3JlOiB0aGlzLmVkaXRDYXJldEJlZm9yZVxuICB9KTtcblxuICB0aGlzLnJlbmRlcigpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldEZyb21QeCA9IGZ1bmN0aW9uKHB4KSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5tYXJnaW5MZWZ0LCB5OiB0aGlzLmNoYXIuaGVpZ2h0LzIgfSlbJysnXSh0aGlzLm9mZnNldCk7XG4gIHZhciBwID0gcHhbJy0nXShnKVsnKyddKHRoaXMuc2Nyb2xsKVsnby8nXSh0aGlzLmNoYXIpO1xuXG4gIHAueSA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueSwgdGhpcy5idWZmZXIubG9jKCkpKTtcbiAgcC54ID0gTWF0aC5tYXgoMCwgcC54KTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0Q29vcmRzVGFicyhwKTtcblxuICBwLnggPSBNYXRoLm1heChcbiAgICAwLFxuICAgIE1hdGgubWluKFxuICAgICAgcC54IC0gdGFicy50YWJzICsgdGFicy5yZW1haW5kZXIsXG4gICAgICB0aGlzLmdldExpbmVMZW5ndGgocC55KVxuICAgIClcbiAgKTtcblxuICB0aGlzLnNldENhcmV0KHApO1xuICB0aGlzLm1vdmUubGFzdERlbGliZXJhdGVYID0gcC54O1xuICB0aGlzLm9uTW92ZSgpO1xuXG4gIHJldHVybiBwO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZVVwID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykgdGhpcy5ibHVyKCk7XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURvd24gPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCh0aGlzLmZvY3VzLmJpbmQodGhpcyksIDEwKTtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQpIHRoaXMubWFya0JlZ2luKCk7XG4gIGVsc2UgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLmNhcmV0LnNldChwKTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0UG9pbnRUYWJzKHRoaXMuY2FyZXQpO1xuXG4gIHRoaXMuY2FyZXRQeC5zZXQoe1xuICAgIHg6IHRoaXMuY2hhci53aWR0aCAqICh0aGlzLmNhcmV0LnggKyB0YWJzLnRhYnMgKiB0aGlzLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlciksXG4gICAgeTogdGhpcy5jaGFyLmhlaWdodCAqIHRoaXMuY2FyZXQueVxuICB9KTtcblxuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICAgIC8vIHRoaXMucmVuZGVyKCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gUmFuZ2UuY2xhbXAocmFuZ2UsIHRoaXMucGFnZUJvdW5kcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcCA9IHRoaXMuc2Nyb2xsWydfLyddKHRoaXMuY2hhcik7XG4gIHJldHVybiB0aGlzLmdldFJhbmdlKFtcbiAgICBNYXRoLmZsb29yKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVswXSksXG4gICAgTWF0aC5jZWlsKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMV0pXG4gIF0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHAgPSB0aGlzLmNhcmV0UHg7XG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdmFyIHRvcCA9IHMueSAtIHAueTtcbiAgdmFyIGJvdHRvbSA9IChwLnkpIC0gKHMueSArIHRoaXMuc2l6ZS5oZWlnaHQpICsgdGhpcy5jaGFyLmhlaWdodDtcblxuICB2YXIgbGVmdCA9IChzLnggKyB0aGlzLmNoYXIud2lkdGgpIC0gcC54O1xuICB2YXIgcmlnaHQgPSAocC54KSAtIChzLnggKyB0aGlzLnNpemUud2lkdGggLSB0aGlzLm1hcmdpbkxlZnQpICsgdGhpcy5jaGFyLndpZHRoICogMjtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICAvLyBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZylcbiAgaWYgKGxlZnQgKyB0b3AgKyByaWdodCArIGJvdHRvbSkge1xuICAgIHRoaXMuc2Nyb2xsQnkocmlnaHQgLSBsZWZ0LCBib3R0b20gLSB0b3ApO1xuICB9XG4gIC8vIGVsc2VcbiAgICAvLyB0aGlzLmFuaW1hdGVTY3JvbGxCeShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB2YXIgdGFyZ2V0ID0gUG9pbnQubG93KHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfSwge1xuICAgIHg6IHRoaXMuc2Nyb2xsLnggKyB4LFxuICAgIHk6IHRoaXMuc2Nyb2xsLnkgKyB5XG4gIH0pO1xuXG4gIGlmIChQb2ludC5zb3J0KHRhcmdldCwgdGhpcy5zY3JvbGwpICE9PSAwKSB7XG4gICAgdGhpcy5zY3JvbGwuc2V0KHRhcmdldCk7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKCh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0LCBNYXRoLm1heCgwLCBzLnkgKyB5KSlcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoKGFkeCA8IDEgJiYgYWR5IDwgMSkgfHwgIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQpO1xuICAgIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2FuaW1hdGlvbiBlbmQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBpZiAoYWR4IDwgc3BlZWQpIGR4ICo9IDAuOTtcbiAgZWxzZSBkeCA9IE1hdGguc2lnbihkeCkgKiBzcGVlZDtcblxuICBpZiAoYWR5IDwgc3BlZWQpIGR5ICo9IDAuOTtcbiAgZWxzZSBkeSA9IE1hdGguc2lnbihkeSkgKiBzcGVlZDtcblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLmRlbGV0ZSgpO1xuXG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQodGhpcy5jYXJldC55KTtcbiAgdmFyIHJpZ2h0ID0gbGluZVt0aGlzLmNhcmV0LnhdO1xuICB2YXIgaGFzUmlnaHRTeW1ib2wgPSB+Wyd9JywnXScsJyknXS5pbmRleE9mKHJpZ2h0KTtcblxuICAvLyBhcHBseSBpbmRlbnQgb24gZW50ZXJcbiAgaWYgKE5FV0xJTkUudGVzdCh0ZXh0KSkge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IHRoaXMuY2FyZXQueCA9PT0gbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBsZWZ0ID0gbGluZVt0aGlzLmNhcmV0LnggLSAxXTtcbiAgICB2YXIgaW5kZW50ID0gbGluZS5tYXRjaCgvXFxTLyk7XG4gICAgaW5kZW50ID0gaW5kZW50ID8gaW5kZW50LmluZGV4IDogbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBoYXNMZWZ0U3ltYm9sID0gflsneycsJ1snLCcoJ10uaW5kZXhPZihsZWZ0KTtcblxuICAgIGlmIChoYXNMZWZ0U3ltYm9sKSBpbmRlbnQgKz0gMjtcblxuICAgIGlmIChpc0VuZE9mTGluZSB8fCBoYXNMZWZ0U3ltYm9sKSB7XG4gICAgICB0ZXh0ICs9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJyk7XG4gICAgfVxuICB9XG5cbiAgdmFyIGxlbmd0aDtcblxuICBpZiAoIWhhc1JpZ2h0U3ltYm9sIHx8IChoYXNSaWdodFN5bWJvbCAmJiAhflsnfScsJ10nLCcpJ10uaW5kZXhPZih0ZXh0KSkpIHtcbiAgICBsZW5ndGggPSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgdGV4dCk7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gMTtcbiAgfVxuXG4gIHRoaXMubW92ZS5ieUNoYXJzKGxlbmd0aCwgdHJ1ZSk7XG5cbiAgaWYgKCd7JyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICd9Jyk7XG4gIGVsc2UgaWYgKCcoJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICcpJyk7XG4gIGVsc2UgaWYgKCdbJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICddJyk7XG5cbiAgaWYgKGhhc0xlZnRTeW1ib2wgJiYgaGFzUmlnaHRTeW1ib2wpIHtcbiAgICBpbmRlbnQgLT0gMjtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmFja3NwYWNlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm4gdGhpcy5kZWxldGUoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEsIHRydWUpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZmluZEp1bXAgPSBmdW5jdGlvbihqdW1wKSB7XG4gIGlmICghdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggfHwgIXRoaXMuZmluZC5pc09wZW4pIHJldHVybjtcblxuICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmROZWVkbGUgKyBqdW1wO1xuICBpZiAodGhpcy5maW5kTmVlZGxlID49IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gMDtcbiAgfSBlbHNlIGlmICh0aGlzLmZpbmROZWVkbGUgPCAwKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggLSAxO1xuICB9XG5cbiAgdmFyIHJlc3VsdCA9IHRoaXMuZmluZFJlc3VsdHNbdGhpcy5maW5kTmVlZGxlXTtcbiAgdGhpcy5zZXRDYXJldChyZXN1bHQpO1xuICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5tb3ZlLmJ5Q2hhcnModGhpcy5maW5kVmFsdWUubGVuZ3RoLCB0cnVlKTtcbiAgdGhpcy5tYXJrU2V0KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZFZhbHVlID0gZnVuY3Rpb24odmFsdWUsIG5vSnVtcCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMuZ3V0dGVyLCB5OiAwIH0pO1xuXG4gIHRoaXMuYnVmZmVyLnVwZGF0ZVJhdygpO1xuXG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuXG4gIHRoaXMuZmluZFZhbHVlID0gdmFsdWU7XG4gIC8vIGNvbnNvbGUudGltZSgnZmluZCAnICsgdmFsdWUpO1xuICB0aGlzLmZpbmRSZXN1bHRzID0gdGhpcy5idWZmZXIuaW5kZXhlci5maW5kKHZhbHVlKS5tYXAoKG9mZnNldCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KTtcbiAgICAgIC8vcHg6IG5ldyBQb2ludChwb2ludClbJyonXShlLmNoYXIpWycrJ10oZylcbiAgfSk7XG4gIC8vIGNvbnNvbGUudGltZUVuZCgnZmluZCAnICsgdmFsdWUpO1xuXG4gIHRoaXMuZmluZC5pbmZvKCcwLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG5cbiAgaWYgKCFub0p1bXApIHRoaXMuZmluZEp1bXAoMCk7XG5cbiAgdGhpcy52aWV3cy5maW5kLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuICB0aGlzLmZvY3VzKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zdWdnZXN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQsIHRydWUpO1xuICBpZiAoIWFyZWEpIHJldHVybjtcblxuICB2YXIga2V5ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYSk7XG4gIGlmICgha2V5KSByZXR1cm47XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3RSb290XG4gICAgfHwga2V5LnN1YnN0cigwLCB0aGlzLnN1Z2dlc3RSb290Lmxlbmd0aCkgIT09IHRoaXMuc3VnZ2VzdFJvb3QpIHtcbiAgICB0aGlzLnN1Z2dlc3RJbmRleCA9IDA7XG4gICAgdGhpcy5zdWdnZXN0Um9vdCA9IGtleTtcbiAgICB0aGlzLnN1Z2dlc3ROb2RlcyA9IHRoaXMuYnVmZmVyLnByZWZpeC5jb2xsZWN0KGtleSk7XG4gIH1cblxuICBpZiAoIXRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aCkgcmV0dXJuO1xuICB2YXIgbm9kZSA9IHRoaXMuc3VnZ2VzdE5vZGVzW3RoaXMuc3VnZ2VzdEluZGV4XTtcblxuICB0aGlzLnN1Z2dlc3RJbmRleCA9ICh0aGlzLnN1Z2dlc3RJbmRleCArIDEpICUgdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoO1xuXG4gIHJldHVybiB7XG4gICAgYXJlYTogYXJlYSxcbiAgICBub2RlOiBub2RlXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQb2ludFRhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYiA+PSBwb2ludC54KSBicmVhaztcbiAgICByZW1haW5kZXIgKz0gKHRhYiAtIHByZXYpICUgdGhpcy50YWJTaXplO1xuICAgIHRhYnMrKztcbiAgICBwcmV2ID0gdGFiICsgMTtcbiAgfVxuICByZXR1cm4ge1xuICAgIHRhYnM6IHRhYnMsXG4gICAgcmVtYWluZGVyOiByZW1haW5kZXIgKyB0YWJzXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRDb29yZHNUYWJzID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lVGV4dChwb2ludC55KTtcbiAgdmFyIHJlbWFpbmRlciA9IDA7XG4gIHZhciB0YWJzID0gMDtcbiAgdmFyIHRhYjtcbiAgdmFyIHByZXYgPSAwO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWJzICogdGhpcy50YWJTaXplICsgcmVtYWluZGVyID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlclxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVwYWludCA9IGJpbmRSYWYoZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVzaXplKCk7XG4gIHRoaXMucmVuZGVyKCk7XG59KTtcblxuSmF6ei5wcm90b3R5cGUucmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHZhciAkID0gdGhpcy5lbDtcblxuICB0aGlzLm9mZnNldC5zZXQoZG9tLmdldE9mZnNldCgkKSk7XG4gIHRoaXMuc2Nyb2xsLnNldChkb20uZ2V0U2Nyb2xsKCQpKTtcbiAgdGhpcy5zaXplLnNldChkb20uZ2V0U2l6ZSgkKSk7XG5cbiAgLy8gdGhpcyBpcyBhIHdlaXJkIGZpeCB3aGVuIGRvaW5nIG11bHRpcGxlIC51c2UoKVxuICBpZiAodGhpcy5jaGFyLndpZHRoID09PSAwKSB0aGlzLmNoYXIuc2V0KGRvbS5nZXRDaGFyU2l6ZSgkLCBjc3MuY29kZSkpO1xuXG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYygpO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWydfKiddKHRoaXMuY2hhcikpKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG4gIC8vIHRoaXMubG9uZ2VzdExpbmUgPSBNYXRoLm1pbig1MDAsIHRoaXMuYnVmZmVyLmxpbmVzLmdldExvbmdlc3RMaW5lTGVuZ3RoKCkpO1xuICB0aGlzLmd1dHRlciA9IE1hdGgubWF4KFxuICAgIHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICh0aGlzLm9wdGlvbnMuY2VudGVyXG4gICAgICA/ICh0aGlzLnBhZ2Uud2lkdGggLSA4MSkgLyAyIHwgMCA6IDApXG4gICAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93c1xuICAgICAgPyAwIDogTWF0aC5tYXgoMywgKCcnK3RoaXMucm93cykubGVuZ3RoKSlcbiAgKSAqIHRoaXMuY2hhci53aWR0aCArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6IHRoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2luKTtcbiAgdGhpcy5tYXJnaW5MZWZ0ID0gdGhpcy5ndXR0ZXIgKyB0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjJyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ydWxlcn0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmZpbmR9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5tYXJrfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuY29kZX0ge1xuICAgICAgcGFkZGluZy1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdCArIHRoaXMuZ3V0dGVyfXB4O1xuICAgICAgdGFiLXNpemU6ICR7dGhpcy50YWJTaXplfTtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLnJvd3N9IHtcbiAgICAgIHBhZGRpbmctcmlnaHQ6ICR7dGhpcy5vcHRpb25zLmd1dHRlcl9tYXJnaW59cHg7XG4gICAgICBtYXJnaW4tbGVmdDogJHt0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnR9cHg7XG4gICAgICB3aWR0aDogJHt0aGlzLmd1dHRlcn1weDtcbiAgICB9XG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmZpbmR9ID4gaSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuYmxvY2t9ID4gaSB7XG4gICAgICBoZWlnaHQ6ICR7dGhpcy5jaGFyLmhlaWdodCArIDF9cHg7XG4gICAgfVxuICAgIHgge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gYmluZFJhZihmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2NsZWFyJylcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIHRoaXMudmlld3MuY2xlYXIoKTtcbn0pO1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygncmVuZGVyJylcbiAgdGhpcy52aWV3cy5yZW5kZXIoKTtcbn0pO1xuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEFyZWE7XG5cbmZ1bmN0aW9uIEFyZWEoYSkge1xuICBpZiAoYSkge1xuICAgIHRoaXMuYmVnaW4gPSBuZXcgUG9pbnQoYS5iZWdpbik7XG4gICAgdGhpcy5lbmQgPSBuZXcgUG9pbnQoYS5lbmQpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuYmVnaW4gPSBuZXcgUG9pbnQ7XG4gICAgdGhpcy5lbmQgPSBuZXcgUG9pbnQ7XG4gIH1cbn1cblxuQXJlYS5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IEFyZWEodGhpcyk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHMgPSBbdGhpcy5iZWdpbiwgdGhpcy5lbmRdLnNvcnQoUG9pbnQuc29ydCk7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IG5ldyBQb2ludChzWzBdKSxcbiAgICBlbmQ6IG5ldyBQb2ludChzWzFdKVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdGhpcy5iZWdpbi5zZXQoYXJlYS5iZWdpbik7XG4gIHRoaXMuZW5kLnNldChhcmVhLmVuZCk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXRMZWZ0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLmJlZ2luLnggPSB4O1xuICB0aGlzLmVuZC54ID0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgaWYgKHRoaXMuYmVnaW4ueCkgdGhpcy5iZWdpbi54ICs9IHg7XG4gIGlmICh0aGlzLmVuZC54KSB0aGlzLmVuZC54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkQm90dG9tID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLmVuZC55ICs9IHk7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2hpZnRCeUxpbmVzID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLmJlZ2luLnkgKz0geTtcbiAgdGhpcy5lbmQueSArPSB5O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz4nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5lbmQueVxuICAgID8gdGhpcy5iZWdpbi54ID4gYS5lbmQueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PSddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgPyB0aGlzLmJlZ2luLnggPj0gYS5iZWdpbi54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPCddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5iZWdpbi55XG4gICAgPyB0aGlzLmVuZC54IDwgYS5iZWdpbi54XG4gICAgOiB0aGlzLmVuZC55IDwgYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueVxuICAgID8gdGhpcy5lbmQueCA8PSBhLmVuZC54XG4gICAgOiB0aGlzLmVuZC55IDwgYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJz4nXShhKSAmJiB0aGlzWyc8J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD4nXSA9XG5BcmVhLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPCddKGEpIHx8IHRoaXNbJz4nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+PTwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJz49J10oYSkgJiYgdGhpc1snPD0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PT4nXSA9XG5BcmVhLnByb3RvdHlwZS5vdXRzaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8PSddKGEpIHx8IHRoaXNbJz49J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPT09J10gPVxuQXJlYS5wcm90b3R5cGUuZXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnggPT09IGEuYmVnaW4ueCAmJiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgICAgJiYgdGhpcy5lbmQueCAgID09PSBhLmVuZC54ICAgJiYgdGhpcy5lbmQueSAgID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9J10gPVxuQXJlYS5wcm90b3R5cGUuYmVnaW5MaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9fCddID1cbkFyZWEucHJvdG90eXBlLmVuZExpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD18J10gPVxuQXJlYS5wcm90b3R5cGUubGluZXNFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJ3w9J10oYSkgJiYgdGhpc1snPXwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9fD0nXSA9XG5BcmVhLnByb3RvdHlwZS5zYW1lTGluZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gdGhpcy5lbmQueSAmJiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycteC0nXSA9XG5BcmVhLnByb3RvdHlwZS5zaG9ydGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggKyB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggLSB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnK3grJ10gPVxuQXJlYS5wcm90b3R5cGUud2lkZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCAtIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCArIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEub2Zmc2V0ID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXQoYi5iZWdpbiwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXQoYi5lbmQsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRYID0gZnVuY3Rpb24oeCwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRYKHgsIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WCh4LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WSh5LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFkoeSwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuICcnICsgYS5iZWdpbiArICctJyArIGEuZW5kO1xufTtcblxuQXJlYS5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55ID09PSBiLmJlZ2luLnlcbiAgICA/IGEuYmVnaW4ueCAtIGIuYmVnaW4ueFxuICAgIDogYS5iZWdpbi55IC0gYi5iZWdpbi55O1xufTtcblxuQXJlYS50b1BvaW50U29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA8PSBiLnkgJiYgYS5lbmQueSA+PSBiLnlcbiAgICA/IGEuYmVnaW4ueSA9PT0gYi55XG4gICAgICA/IGEuYmVnaW4ueCAtIGIueFxuICAgICAgOiBhLmVuZC55ID09PSBiLnlcbiAgICAgICAgPyBhLmVuZC54IC0gYi54XG4gICAgICAgIDogMFxuICAgIDogYS5iZWdpbi55IC0gYi55O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBiaW5hcnlTZWFyY2g7XG5cbmZ1bmN0aW9uIGJpbmFyeVNlYXJjaChhcnJheSwgY29tcGFyZSkge1xuICB2YXIgaW5kZXggPSAtMTtcbiAgdmFyIHByZXYgPSAtMTtcbiAgdmFyIGxvdyA9IDA7XG4gIHZhciBoaWdoID0gYXJyYXkubGVuZ3RoO1xuICBpZiAoIWhpZ2gpIHJldHVybiB7XG4gICAgaXRlbTogbnVsbCxcbiAgICBpbmRleDogMFxuICB9O1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaW5kZXg7XG4gICAgaW5kZXggPSBsb3cgKyAoaGlnaCAtIGxvdyA+PiAxKTtcbiAgICB2YXIgaXRlbSA9IGFycmF5W2luZGV4XTtcbiAgICB2YXIgcmVzdWx0ID0gY29tcGFyZShpdGVtKTtcblxuICAgIGlmIChyZXN1bHQpIGxvdyA9IGluZGV4O1xuICAgIGVsc2UgaGlnaCA9IGluZGV4O1xuICB9IHdoaWxlIChwcmV2ICE9PSBpbmRleCk7XG5cbiAgaWYgKGl0ZW0gIT0gbnVsbCkge1xuICAgIHJldHVybiB7XG4gICAgICBpdGVtOiBpdGVtLFxuICAgICAgaW5kZXg6IGluZGV4XG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgaXRlbTogbnVsbCxcbiAgICBpbmRleDogfmxvdyAqIC0xIC0gMVxuICB9O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbikge1xuICB2YXIgcmVxdWVzdDtcbiAgcmV0dXJuIGZ1bmN0aW9uIHJhZldyYXAoYSwgYiwgYywgZCkge1xuICAgIHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZShyZXF1ZXN0KTtcbiAgICByZXF1ZXN0ID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZShmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpKTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gQm94O1xuXG5mdW5jdGlvbiBCb3goYikge1xuICBpZiAoYikge1xuICAgIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICAgIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy53aWR0aCA9IDA7XG4gICAgdGhpcy5oZWlnaHQgPSAwO1xuICB9XG59XG5cbkJveC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYikge1xuICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbn07XG5cbkJveC5wcm90b3R5cGVbJy8nXSA9XG5Cb3gucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXy8nXSA9XG5Cb3gucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14vJ10gPVxuQm94LnByb3RvdHlwZS5jZWlsZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnbyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLnJvdW5kKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5yb3VuZCh0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWyctJ10gPVxuQm94LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAtIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC0gKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2xvbmUob2JqKSB7XG4gIHZhciBvID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICB2YXIgdmFsID0gb2JqW2tleV07XG4gICAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgdmFsKSB7XG4gICAgICBvW2tleV0gPSBjbG9uZSh2YWwpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvW2tleV0gPSB2YWw7XG4gICAgfVxuICB9XG4gIHJldHVybiBvO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGRlYm91bmNlV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCksIG1zKTtcbiAgICByZXR1cm4gdGltZW91dDtcbiAgfVxufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2V2ZW50Jyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zdHlsZS5jc3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBEaWFsb2c7XG5cbmZ1bmN0aW9uIERpYWxvZyhsYWJlbCwga2V5bWFwKSB7XG4gIHRoaXMubm9kZSA9IGRvbShjc3MuZGlhbG9nLCBbXG4gICAgYDxsYWJlbD4ke2Nzcy5sYWJlbH1gLFxuICAgIFtjc3MuaW5wdXQsIFtcbiAgICAgIGA8aW5wdXQ+JHtjc3MudGV4dH1gLFxuICAgICAgY3NzLmluZm9cbiAgICBdXVxuICBdKTtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5sYWJlbF0sIGxhYmVsKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiAnbm9uZScgfSk7XG4gIHRoaXMua2V5bWFwID0ga2V5bWFwO1xuICB0aGlzLm9uYm9keWtleWRvd24gPSB0aGlzLm9uYm9keWtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9uY2xpY2sgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2V1cCA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZWRvd24gPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQ7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG59XG5cbkRpYWxvZy5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5mdW5jdGlvbiBzdG9wUHJvcGFnYXRpb24oZSkge1xuICBlLnN0b3BQcm9wYWdhdGlvbigpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5oYXNGb2N1cyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwuaGFzRm9jdXMoKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25ib2R5a2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDI3ID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuY2xvc2UoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMTMgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5zdWJtaXQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGUud2hpY2ggaW4gdGhpcy5rZXltYXApIHtcbiAgICB0aGlzLmVtaXQoJ2tleScsIGUpO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uaW5wdXQgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMuZW1pdCgndmFsdWUnLCB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwudmFsdWUpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIGRvbS5hcHBlbmQoZG9jdW1lbnQuYm9keSwgdGhpcy5ub2RlKTtcbiAgZG9tLmZvY3VzKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XSk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC5zZWxlY3QoKTtcbiAgdGhpcy5pc09wZW4gPSB0cnVlO1xuICB0aGlzLmVtaXQoJ29wZW4nKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuY2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5yZW1vdmVFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgdGhpcy5ub2RlLmVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodGhpcy5ub2RlLmVsKTtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbiAgdGhpcy5lbWl0KCdjbG9zZScpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5zdWJtaXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5lbWl0KCdzdWJtaXQnLCB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwudmFsdWUpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5pbmZvID0gZnVuY3Rpb24oaW5mbykge1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIGluZm8pO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6IGluZm8gPyAnYmxvY2snIDogJ25vbmUnIH0pO1xufTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZGlhbG9nXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fZGlhbG9nXCIsXCJpbnB1dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2lucHV0XCIsXCJ0ZXh0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fdGV4dFwiLFwibGFiZWxcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19sYWJlbFwiLFwiaW5mb1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2luZm9cIn0iLCJcbm1vZHVsZS5leHBvcnRzID0gZGlmZjtcblxuZnVuY3Rpb24gZGlmZihhLCBiKSB7XG4gIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGEpIHtcbiAgICB2YXIgZCA9IHt9O1xuICAgIHZhciBpID0gMDtcbiAgICBmb3IgKHZhciBrIGluIGIpIHtcbiAgICAgIGlmIChhW2tdICE9PSBiW2tdKSB7XG4gICAgICAgIGRba10gPSBiW2tdO1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpKSByZXR1cm4gZDtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYSAhPT0gYjtcbiAgfVxufVxuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi9wb2ludCcpO1xudmFyIGJpbmRSYWYgPSByZXF1aXJlKCcuL2JpbmQtcmFmJyk7XG52YXIgbWVtb2l6ZSA9IHJlcXVpcmUoJy4vbWVtb2l6ZScpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9tZXJnZScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG52YXIgdW5pdHMgPSB7XG4gIGxlZnQ6ICdweCcsXG4gIHRvcDogJ3B4JyxcbiAgcmlnaHQ6ICdweCcsXG4gIGJvdHRvbTogJ3B4JyxcbiAgd2lkdGg6ICdweCcsXG4gIGhlaWdodDogJ3B4JyxcbiAgbWF4SGVpZ2h0OiAncHgnLFxuICBwYWRkaW5nTGVmdDogJ3B4Jyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZG9tO1xuXG5mdW5jdGlvbiBkb20obmFtZSwgY2hpbGRyZW4sIGF0dHJzKSB7XG4gIHZhciBlbDtcbiAgdmFyIHRhZyA9ICdkaXYnO1xuICB2YXIgbm9kZTtcblxuICBpZiAoJ3N0cmluZycgPT09IHR5cGVvZiBuYW1lKSB7XG4gICAgaWYgKCc8JyA9PT0gbmFtZS5jaGFyQXQoMCkpIHtcbiAgICAgIHZhciBtYXRjaGVzID0gbmFtZS5tYXRjaCgvKD86PCkoLiopKD86PikoXFxTKyk/Lyk7XG4gICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICB0YWcgPSBtYXRjaGVzWzFdO1xuICAgICAgICBuYW1lID0gbWF0Y2hlc1syXSB8fCB0YWc7XG4gICAgICB9XG4gICAgfVxuICAgIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCh0YWcpO1xuICAgIG5vZGUgPSB7XG4gICAgICBlbDogZWwsXG4gICAgICBuYW1lOiBuYW1lLnNwbGl0KCcgJylbMF1cbiAgICB9O1xuICAgIGRvbS5jbGFzc2VzKG5vZGUsIG5hbWUuc3BsaXQoJyAnKS5zbGljZSgxKSk7XG4gIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIHJldHVybiBkb20uYXBwbHkobnVsbCwgbmFtZSk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCdkb20nIGluIG5hbWUpIHtcbiAgICAgIG5vZGUgPSBuYW1lLmRvbTtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZSA9IG5hbWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKSB7XG4gICAgY2hpbGRyZW5cbiAgICAgIC5tYXAoZG9tKVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCwgaSkge1xuICAgICAgICBub2RlW2NoaWxkLm5hbWVdID0gY2hpbGQ7XG4gICAgICAgIHJldHVybiBjaGlsZDtcbiAgICAgIH0pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkKSB7XG4gICAgICAgIG5vZGUuZWwuYXBwZW5kQ2hpbGQoY2hpbGQuZWwpO1xuICAgICAgfSk7XG4gIH0gZWxzZSBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBjaGlsZHJlbikge1xuICAgIGRvbS5zdHlsZShub2RlLCBjaGlsZHJlbik7XG4gIH1cblxuICBpZiAoYXR0cnMpIHtcbiAgICBkb20uYXR0cnMobm9kZSwgYXR0cnMpO1xuICB9XG5cbiAgcmV0dXJuIG5vZGU7XG59XG5cbmRvbS5zdHlsZSA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIF8sIHN0eWxlKSB7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufSwgZGlmZiwgbWVyZ2UsIGZ1bmN0aW9uKG5vZGUsIHN0eWxlKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBzdHlsZV07XG59KTtcblxuLypcbmRvbS5zdHlsZSA9IGZ1bmN0aW9uKGVsLCBzdHlsZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59O1xuKi9cbmRvbS5jbGFzc2VzID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbn0sIG51bGwsIG51bGwsIGZ1bmN0aW9uKG5vZGUsIGNsYXNzZXMpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIGNsYXNzZXMuY29uY2F0KG5vZGUubmFtZSkuZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyAnKV07XG59KTtcblxuZG9tLmF0dHJzID0gZnVuY3Rpb24oZWwsIGF0dHJzKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBPYmplY3QuYXNzaWduKGVsLCBhdHRycyk7XG59O1xuXG5kb20uaHRtbCA9IGZ1bmN0aW9uKGVsLCBodG1sKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5pbm5lckhUTUwgPSBodG1sO1xufTtcblxuZG9tLnRleHQgPSBmdW5jdGlvbihlbCwgdGV4dCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xufTtcblxuZG9tLmZvY3VzID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmZvY3VzKCk7XG59O1xuXG5kb20uZ2V0U2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlbC5jbGllbnRXaWR0aCxcbiAgICBoZWlnaHQ6IGVsLmNsaWVudEhlaWdodFxuICB9O1xufTtcblxuZG9tLmdldENoYXJTaXplID0gZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzcGFuJyk7XG4gIHNwYW4uY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuXG4gIGVsLmFwcGVuZENoaWxkKHNwYW4pO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAnO1xuICB2YXIgYSA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICBcXG4gJztcbiAgdmFyIGIgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIGVsLnJlbW92ZUNoaWxkKHNwYW4pO1xuXG4gIHJldHVybiB7XG4gICAgd2lkdGg6IChiLndpZHRoIC0gYS53aWR0aCksXG4gICAgaGVpZ2h0OiAoYi5oZWlnaHQgLSBhLmhlaWdodClcbiAgfTtcbn07XG5cbmRvbS5nZXRPZmZzZXQgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgdmFyIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpO1xuICB2YXIgYm9yZGVyTGVmdCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlckxlZnRXaWR0aCk7XG4gIHZhciBib3JkZXJUb3AgPSBwYXJzZUludChzdHlsZS5ib3JkZXJUb3BXaWR0aCk7XG4gIHJldHVybiBQb2ludC5sb3coeyB4OiAwLCB5OiAwIH0sIHtcbiAgICB4OiAocmVjdC5sZWZ0ICsgYm9yZGVyTGVmdCkgfCAwLFxuICAgIHk6IChyZWN0LnRvcCArIGJvcmRlclRvcCkgfCAwXG4gIH0pO1xufTtcblxuZG9tLmdldFNjcm9sbCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICByZXR1cm4gZ2V0U2Nyb2xsKGVsKTtcbn07XG5cbmRvbS5vbnNjcm9sbCA9IGZ1bmN0aW9uIG9uc2Nyb2xsKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcblxuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZXIoZXYpIHtcbiAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbiBvZmZzY3JvbGwoKSB7XG4gICAgZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20ucmVtb3ZlID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChlbC5wYXJlbnROb2RlKSBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKTtcbn07XG5cbmRvbS5nZXRFbGVtZW50ID0gZnVuY3Rpb24oZWwpIHtcbiAgcmV0dXJuIGVsLmRvbSAmJiBlbC5kb20uZWwgfHwgZWwuZWwgfHwgZWwubm9kZSB8fCBlbDtcbn07XG5cbmRvbS5zY3JvbGxCeSA9IGZ1bmN0aW9uKGVsLCB4LCB5LCBzY3JvbGwpIHtcbiAgc2Nyb2xsID0gc2Nyb2xsIHx8IGRvbS5nZXRTY3JvbGwoZWwpO1xuICBkb20uc2Nyb2xsVG8oZWwsIHNjcm9sbC54ICsgeCwgc2Nyb2xsLnkgKyB5KTtcbn07XG5cbmRvbS5zY3JvbGxUbyA9IGZ1bmN0aW9uKGVsLCB4LCB5KSB7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIHdpbmRvdy5zY3JvbGxUbyh4LCB5KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5zY3JvbGxMZWZ0ID0geCB8fCAwO1xuICAgIGVsLnNjcm9sbFRvcCA9IHkgfHwgMDtcbiAgfVxufTtcblxuZG9tLmNzcyA9IGJpbmRSYWYoZnVuY3Rpb24oaWQsIGNzc1RleHQpIHtcbiAgaWYgKCEoaWQgaW4gZG9tLmNzcy5zdHlsZXMpKSB7XG4gICAgZG9tLmNzcy5zdHlsZXNbaWRdID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvbS5jc3Muc3R5bGVzW2lkXSk7XG4gIH1cbiAgZG9tLmNzcy5zdHlsZXNbaWRdLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn0pO1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IFBvaW50O1xuXG5mdW5jdGlvbiBQb2ludChwKSB7XG4gIGlmIChwKSB7XG4gICAgdGhpcy54ID0gcC54O1xuICAgIHRoaXMueSA9IHAueTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSAwO1xuICAgIHRoaXMueSA9IDA7XG4gIH1cbn1cblxuUG9pbnQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy54ID0gcC54O1xuICB0aGlzLnkgPSBwLnk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFBvaW50KHRoaXMpO1xufTtcblxuUG9pbnQucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICB0aGlzLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXy8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28vJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXi8nXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycrJ10gPVxuUG9pbnQucHJvdG90eXBlLmFkZCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICsgKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSArIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJy0nXSA9XG5Qb2ludC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLSAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55IC0gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKiddID1cblBvaW50LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeKiddID1cblBvaW50LnByb3RvdHlwZS5jZWlsTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ28qJ10gPVxuUG9pbnQucHJvdG90eXBlLnJvdW5kTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXyonXSA9XG5Qb2ludC5wcm90b3R5cGUuZmxvb3JNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICd4OicgKyB0aGlzLnggKyAnLHk6JyArIHRoaXMueTtcbn07XG5cblBvaW50LnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5Qb2ludC5ncmlkUm91bmQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5yb3VuZChhLnggLyBiLndpZHRoKSxcbiAgICB5OiBNYXRoLnJvdW5kKGEueSAvIGIuaGVpZ2h0KVxuICB9O1xufTtcblxuUG9pbnQubG93ID0gZnVuY3Rpb24obG93LCBwKSB7XG4gIHJldHVybiB7XG4gICAgeDogTWF0aC5tYXgobG93LngsIHAueCksXG4gICAgeTogTWF0aC5tYXgobG93LnksIHAueSlcbiAgfTtcbn07XG5cblBvaW50LmNsYW1wID0gZnVuY3Rpb24oYXJlYSwgcCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfSk7XG59O1xuXG5Qb2ludC5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7IHg6IGEueCArIGIueCwgeTogYS55ICsgYi55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRYID0gZnVuY3Rpb24oeCwgcCkge1xuICByZXR1cm4geyB4OiBwLnggKyB4LCB5OiBwLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFkgPSBmdW5jdGlvbih5LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCwgeTogcC55ICsgeSB9O1xufTtcblxuUG9pbnQudG9MZWZ0VG9wID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHAueCxcbiAgICB0b3A6IHAueVxuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBBTkQ7XG5cbmZ1bmN0aW9uIEFORChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBOT1Q7XG5cbmZ1bmN0aW9uIE5PVChhLCBiKSB7XG4gIHZhciBmb3VuZCA9IGZhbHNlO1xuICB2YXIgcmFuZ2UgPSBudWxsO1xuICB2YXIgb3V0ID0gW107XG5cbiAgZm9yICh2YXIgaSA9IGFbMF07IGkgPD0gYVsxXTsgaSsrKSB7XG4gICAgZm91bmQgPSBmYWxzZTtcblxuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYi5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGkgPj0gYltqXVswXSAmJiBpIDw9IGJbal1bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJ2YXIgQU5EID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLWFuZCcpO1xudmFyIE5PVCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1ub3QnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSYW5nZTtcblxuZnVuY3Rpb24gUmFuZ2Uocikge1xuICBpZiAocikge1xuICAgIHRoaXNbMF0gPSByWzBdO1xuICAgIHRoaXNbMV0gPSByWzFdO1xuICB9IGVsc2Uge1xuICAgIHRoaXNbMF0gPSAwO1xuICAgIHRoaXNbMV0gPSAxO1xuICB9XG59O1xuXG5SYW5nZS5BTkQgPSBBTkQ7XG5SYW5nZS5OT1QgPSBOT1Q7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZSh0aGlzKTtcbn07XG5cblJhbmdlLnJhbmdlcyA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHJldHVybiBpdGVtcy5tYXAoZnVuY3Rpb24oaXRlbSkgeyByZXR1cm4gaXRlbS5yYW5nZSB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA+PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdIDw9IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdmVybGFwID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPD0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA+PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzFdIDwgcmFuZ2VbMF0gfHwgaXRlbS5yYW5nZVswXSA+IHJhbmdlWzFdO1xuICB9KTtcbn07XG4iLCJcbnZhciBSZWdleHAgPSBleHBvcnRzO1xuXG5SZWdleHAuY3JlYXRlID0gZnVuY3Rpb24obmFtZXMsIGZsYWdzLCBmbikge1xuICBmbiA9IGZuIHx8IGZ1bmN0aW9uKHMpIHsgcmV0dXJuIHMgfTtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgbmFtZXNcbiAgICAubWFwKChuKSA9PiAnc3RyaW5nJyA9PT0gdHlwZW9mIG4gPyBSZWdleHAudHlwZXNbbl0gOiBuKVxuICAgIC5tYXAoKHIpID0+IGZuKHIudG9TdHJpbmcoKS5zbGljZSgxLC0xKSkpXG4gICAgLmpvaW4oJ3wnKSxcbiAgICBmbGFnc1xuICApO1xufTtcblxuUmVnZXhwLnR5cGVzID0ge1xuICAndG9rZW5zJzogLy4rP1xcYnwuXFxCfFxcYi4rPy8sXG4gICd3b3Jkcyc6IC9bYS16QS1aMC05XXsxLH0vLFxuICAncGFydHMnOiAvWy4vXFxcXFxcKFxcKVwiJ1xcLTosLjs8Pn4hQCMkJV4mKlxcfFxcKz1cXFtcXF17fWB+XFw/IF0rLyxcblxuICAnc2luZ2xlIGNvbW1lbnQnOiAvXFwvXFwvLio/JC8sXG4gICdkb3VibGUgY29tbWVudCc6IC9cXC9cXCpbXl0qP1xcKlxcLy8sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogLygnKD86KD86XFxcXFxcbnxcXFxcJ3xbXidcXG5dKSkqPycpLyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiAvKFwiKD86KD86XFxcXFxcbnxcXFxcXCJ8W15cIlxcbl0pKSo/XCIpLyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IC8oYCg/Oig/OlxcXFxgfFteYF0pKSo/YCkvLFxuXG4gICdvcGVyYXRvcic6IC8hfD49P3w8PT98PXsxLDN9fCg/OiYpezEsMn18XFx8P1xcfHxcXD98XFwqfFxcL3x+fFxcXnwlfFxcLig/IVxcZCl8XFwrezEsMn18XFwtezEsMn0vLFxuICAnZnVuY3Rpb24nOiAvICgoPyFcXGR8Wy4gXSo/KGlmfGVsc2V8ZG98Zm9yfGNhc2V8dHJ5fGNhdGNofHdoaWxlfHdpdGh8c3dpdGNoKSlbYS16QS1aMC05XyAkXSspKD89XFwoLipcXCkuKnspLyxcbiAgJ2tleXdvcmQnOiAvXFxiKGJyZWFrfGNhc2V8Y2F0Y2h8Y29uc3R8Y29udGludWV8ZGVidWdnZXJ8ZGVmYXVsdHxkZWxldGV8ZG98ZWxzZXxleHBvcnR8ZXh0ZW5kc3xmaW5hbGx5fGZvcnxmcm9tfGlmfGltcGxlbWVudHN8aW1wb3J0fGlufGluc3RhbmNlb2Z8aW50ZXJmYWNlfGxldHxuZXd8cGFja2FnZXxwcml2YXRlfHByb3RlY3RlZHxwdWJsaWN8cmV0dXJufHN0YXRpY3xzdXBlcnxzd2l0Y2h8dGhyb3d8dHJ5fHR5cGVvZnx3aGlsZXx3aXRofHlpZWxkKVxcYi8sXG4gICdkZWNsYXJlJzogL1xcYihmdW5jdGlvbnxpbnRlcmZhY2V8Y2xhc3N8dmFyfGxldHxjb25zdHxlbnVtfHZvaWQpXFxiLyxcbiAgJ2J1aWx0aW4nOiAvXFxiKE9iamVjdHxGdW5jdGlvbnxCb29sZWFufEVycm9yfEV2YWxFcnJvcnxJbnRlcm5hbEVycm9yfFJhbmdlRXJyb3J8UmVmZXJlbmNlRXJyb3J8U3RvcEl0ZXJhdGlvbnxTeW50YXhFcnJvcnxUeXBlRXJyb3J8VVJJRXJyb3J8TnVtYmVyfE1hdGh8RGF0ZXxTdHJpbmd8UmVnRXhwfEFycmF5fEZsb2F0MzJBcnJheXxGbG9hdDY0QXJyYXl8SW50MTZBcnJheXxJbnQzMkFycmF5fEludDhBcnJheXxVaW50MTZBcnJheXxVaW50MzJBcnJheXxVaW50OEFycmF5fFVpbnQ4Q2xhbXBlZEFycmF5fEFycmF5QnVmZmVyfERhdGFWaWV3fEpTT058SW50bHxhcmd1bWVudHN8Y29uc29sZXx3aW5kb3d8ZG9jdW1lbnR8U3ltYm9sfFNldHxNYXB8V2Vha1NldHxXZWFrTWFwfFByb3h5fFJlZmxlY3R8UHJvbWlzZSlcXGIvLFxuICAnc3BlY2lhbCc6IC9cXGIodHJ1ZXxmYWxzZXxudWxsfHVuZGVmaW5lZClcXGIvLFxuICAncGFyYW1zJzogL2Z1bmN0aW9uWyBcXChdezF9W15dKj9cXHsvLFxuICAnbnVtYmVyJzogLy0/XFxiKDB4W1xcZEEtRmEtZl0rfFxcZCpcXC4/XFxkKyhbRWVdWystXT9cXGQrKT98TmFOfC0/SW5maW5pdHkpXFxiLyxcbiAgJ3N5bWJvbCc6IC9be31bXFxdKCksOl0vLFxuICAncmVnZXhwJzogLyg/IVteXFwvXSkoXFwvKD8hW1xcL3xcXCpdKS4qP1teXFxcXFxcXl1cXC8pKFs7XFxuXFwuXFwpXFxdXFx9IGdpbV0pLyxcblxuICAneG1sJzogLzxbXj5dKj4vLFxuICAndXJsJzogLygoXFx3KzpcXC9cXC8pWy1hLXpBLVowLTk6QDs/Jj1cXC8lXFwrXFwuXFwqISdcXChcXCksXFwkX1xce1xcfVxcXn5cXFtcXF1gI3xdKykvLFxuICAnaW5kZW50JzogL14gK3xeXFx0Ky8sXG4gICdsaW5lJzogL14uKyR8Xlxcbi8sXG4gICduZXdsaW5lJzogL1xcclxcbnxcXHJ8XFxuLyxcbn07XG5cblJlZ2V4cC50eXBlcy5jb21tZW50ID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgY29tbWVudCcsXG4gICdkb3VibGUgY29tbWVudCcsXG5dKTtcblxuUmVnZXhwLnR5cGVzLnN0cmluZyA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZycsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG5dKTtcblxuUmVnZXhwLnR5cGVzLm11bHRpbGluZSA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnZG91YmxlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbiAgJ2luZGVudCcsXG4gICdsaW5lJ1xuXSk7XG5cblJlZ2V4cC5wYXJzZSA9IGZ1bmN0aW9uKHMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICBpZiAoZmlsdGVyKSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgaWYgKGZpbHRlcih3b3JkKSkgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgd2hpbGUgKHdvcmQgPSByZWdleHAuZXhlYyhzKSkge1xuICAgICAgd29yZHMucHVzaCh3b3JkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IHNhdmU7XG5cbmZ1bmN0aW9uIHNhdmUodXJsLCBzcmMsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgYm9keTogc3JjLFxuICAgIH0pXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuIiwiLy8gTm90ZTogWW91IHByb2JhYmx5IGRvIG5vdCB3YW50IHRvIHVzZSB0aGlzIGluIHByb2R1Y3Rpb24gY29kZSwgYXMgUHJvbWlzZSBpc1xuLy8gICBub3Qgc3VwcG9ydGVkIGJ5IGFsbCBicm93c2VycyB5ZXQuXG5cbihmdW5jdGlvbigpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGlmICh3aW5kb3cuc2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgcGVuZGluZyA9IHt9LFxuICAgICAgICBuZXh0SGFuZGxlID0gMTtcblxuICAgIGZ1bmN0aW9uIG9uUmVzb2x2ZShoYW5kbGUpIHtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgICAgICBjYWxsYmFjay5mbi5hcHBseShudWxsLCBjYWxsYmFjay5hcmdzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdpbmRvdy5zZXRJbW1lZGlhdGUgPSBmdW5jdGlvbihmbikge1xuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgICAgICBoYW5kbGU7XG5cbiAgICAgICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBmdW5jdGlvblwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZSA9IG5leHRIYW5kbGUrKztcbiAgICAgICAgcGVuZGluZ1toYW5kbGVdID0geyBmbjogZm4sIGFyZ3M6IGFyZ3MgfTtcblxuICAgICAgICBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgICByZXNvbHZlKGhhbmRsZSk7XG4gICAgICAgIH0pLnRoZW4ob25SZXNvbHZlKTtcblxuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG5cbiAgICB3aW5kb3cuY2xlYXJJbW1lZGlhdGUgPSBmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICB9O1xufSgpKTsiLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciBydW5uaW5nLCB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgaWYgKHJ1bm5pbmcpIHJldHVybjtcbiAgICBydW5uaW5nID0gdHJ1ZTtcbiAgICBmbi5jYWxsKHRoaXMsIGEsIGIsIGMpO1xuICAgIHNldFRpbWVvdXQocmVzZXQsIG1zKTtcbiAgfTtcblxuICBmdW5jdGlvbiByZXNldCgpIHtcbiAgICBydW5uaW5nID0gZmFsc2U7XG4gIH1cbn07XG4iLCJcbnZhciB0cmltID0gZXhwb3J0cztcblxudHJpbS5lbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgdHJhaWxpbmcgPSB0cmltLnRyYWlsaW5nRW1wdHlMaW5lcyhzKTtcbiAgdmFyIGxlYWRpbmcgPSB0cmltLmxlYWRpbmdFbXB0eUxpbmVzKHRyYWlsaW5nLnN0cmluZyk7XG4gIHJldHVybiB7XG4gICAgdHJhaWxpbmc6IHRyYWlsaW5nLnJlbW92ZWQsXG4gICAgbGVhZGluZzogbGVhZGluZy5yZW1vdmVkLFxuICAgIHJlbW92ZWQ6IHRyYWlsaW5nLnJlbW92ZWQgKyBsZWFkaW5nLnJlbW92ZWQsXG4gICAgc3RyaW5nOiBsZWFkaW5nLnN0cmluZ1xuICB9O1xufTtcblxudHJpbS50cmFpbGluZ0VtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciBpbmRleCA9IHMubGVuZ3RoO1xuICB2YXIgbGFzdEluZGV4ID0gaW5kZXg7XG4gIHZhciBuID0gMDtcbiAgd2hpbGUgKFxuICAgIH4oaW5kZXggPSBzLmxhc3RJbmRleE9mKCdcXG4nLCBsYXN0SW5kZXggLSAxKSlcbiAgICAmJiBpbmRleCAtIGxhc3RJbmRleCA9PT0gLTEpIHtcbiAgICBuKys7XG4gICAgbGFzdEluZGV4ID0gaW5kZXg7XG4gIH1cblxuICBpZiAobikgcyA9IHMuc2xpY2UoMCwgbGFzdEluZGV4KTtcblxuICByZXR1cm4ge1xuICAgIHJlbW92ZWQ6IG4sXG4gICAgc3RyaW5nOiBzXG4gIH07XG59O1xuXG50cmltLmxlYWRpbmdFbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgaW5kZXggPSAtMTtcbiAgdmFyIGxhc3RJbmRleCA9IGluZGV4O1xuICB2YXIgbiA9IDA7XG5cbiAgd2hpbGUgKFxuICAgIH4oaW5kZXggPSBzLmluZGV4T2YoJ1xcbicsIGxhc3RJbmRleCArIDEpKVxuICAgICYmIGluZGV4IC0gbGFzdEluZGV4ID09PSAxKSB7XG4gICAgbisrO1xuICAgIGxhc3RJbmRleCA9IGluZGV4O1xuICB9XG5cbiAgaWYgKG4pIHMgPSBzLnNsaWNlKGxhc3RJbmRleCArIDEpO1xuXG4gIHJldHVybiB7XG4gICAgcmVtb3ZlZDogbixcbiAgICBzdHJpbmc6IHNcbiAgfTtcbn07XG4iLCJ2YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcblxudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLnNldFRleHQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuQnVmZmVyLnByb3RvdHlwZS5zZXRUZXh0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0ZXh0ID0gbm9ybWFsaXplRU9MKHRleHQpO1xuXG4gIHRoaXMucmF3ID0gdGV4dCAvL3RoaXMuc3ludGF4LmhpZ2hsaWdodCh0ZXh0KTtcblxuICB0aGlzLnN5bnRheC50YWIgPSB+dGhpcy5yYXcuaW5kZXhPZignXFx0JykgPyAnXFx0JyA6ICcgJztcblxuICB0aGlzLnRleHQgPSBuZXcgU2tpcFN0cmluZztcbiAgdGhpcy50ZXh0LnNldCh0aGlzLnJhdyk7XG5cbiAgdGhpcy50b2tlbnMgPSBuZXcgVG9rZW5zO1xuICB0aGlzLnRva2Vucy5pbmRleCh0aGlzLnJhdyk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIC8vIHRoaXMuZW1pdCgncmF3JywgdGhpcy5yYXcpO1xuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnQgPVxuQnVmZmVyLnByb3RvdHlwZS5pbnNlcnRUZXh0QXRQb2ludCA9IGZ1bmN0aW9uKHAsIHRleHQsIGN0cmxTaGlmdCkge1xuICBpZiAoIWN0cmxTaGlmdCkgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICB2YXIgaXNFT0wgPSAnXFxuJyA9PT0gdGV4dFswXTtcbiAgdmFyIHNoaWZ0ID0gY3RybFNoaWZ0IHx8IGlzRU9MO1xuICB2YXIgbGVuZ3RoID0gdGV4dC5sZW5ndGg7XG4gIHZhciBwb2ludCA9IHRoaXMuZ2V0UG9pbnQocCk7XG4gIHZhciBsaW5lcyA9ICh0ZXh0Lm1hdGNoKE5FV0xJTkUpIHx8IFtdKS5sZW5ndGg7XG4gIHZhciByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgbGluZXNdO1xuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuXG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudGV4dC5pbnNlcnQocG9pbnQub2Zmc2V0LCB0ZXh0KTtcbiAgb2Zmc2V0UmFuZ2VbMV0gKz0gdGV4dC5sZW5ndGg7XG4gIHZhciBhZnRlciA9IHRoaXMuZ2V0T2Zmc2V0UmFuZ2VUZXh0KG9mZnNldFJhbmdlKTtcbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICB0aGlzLnRva2Vucy51cGRhdGUob2Zmc2V0UmFuZ2UsIGFmdGVyLCBsZW5ndGgpO1xuICB0aGlzLnNlZ21lbnRzLmNsZWFyQ2FjaGUob2Zmc2V0UmFuZ2VbMF0pO1xuXG4gIC8vIHRoaXMudG9rZW5zID0gbmV3IFRva2VucztcbiAgLy8gdGhpcy50b2tlbnMuaW5kZXgodGhpcy50ZXh0LnRvU3RyaW5nKCkpO1xuICAvLyB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuXG4gIGlmICghY3RybFNoaWZ0KSB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCBzaGlmdCwgYmVmb3JlLCBhZnRlcik7XG4gIGVsc2UgdGhpcy5lbWl0KCdyYXcnKTtcblxuICByZXR1cm4gdGV4dC5sZW5ndGg7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZSA9XG5CdWZmZXIucHJvdG90eXBlLnJlbW92ZU9mZnNldFJhbmdlID0gZnVuY3Rpb24obywgbm9VcGRhdGUpIHtcbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgLy8gY29uc29sZS5sb2coJ29mZnNldHMnLCBvKVxuICB2YXIgYSA9IHRoaXMuZ2V0T2Zmc2V0UG9pbnQob1swXSk7XG4gIHZhciBiID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzFdKTtcbiAgdmFyIGxlbmd0aCA9IG9bMF0gLSBvWzFdO1xuICB2YXIgcmFuZ2UgPSBbYS55LCBiLnldO1xuICB2YXIgc2hpZnQgPSBhLnkgLSBiLnk7XG4gIC8vIGNvbnNvbGUubG9nKGEsYilcblxuICB2YXIgb2Zmc2V0UmFuZ2UgPSB0aGlzLmdldExpbmVSYW5nZU9mZnNldHMocmFuZ2UpO1xuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnRleHQucmVtb3ZlKG8pO1xuICAvLyBvZmZzZXRSYW5nZVsxXSAtPSBzaGlmdDtcbiAgdmFyIGFmdGVyID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgaWYgKCFub1VwZGF0ZSkgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVBcmVhID0gZnVuY3Rpb24oYXJlYSwgbm9VcGRhdGUpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0cywgbm9VcGRhdGUpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVDaGFyQXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIG9mZnNldFJhbmdlID0gW3BvaW50Lm9mZnNldCwgcG9pbnQub2Zmc2V0KzFdO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBjb2RlID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KHJhbmdlKTtcbiAgdmFyIHNlZ21lbnQgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIGlmIChzZWdtZW50KSB7XG4gICAgY29kZSA9IFNFR01FTlRbc2VnbWVudF0gKyAnXFx1ZmZiYScgKyBjb2RlICsgJ1xcdWZmYmUqL2AnXG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlKTtcbiAgICBjb2RlID0gJzwnICsgc2VnbWVudFswXSArICc+JyArXG4gICAgICBjb2RlLnN1YnN0cmluZyhcbiAgICAgICAgY29kZS5pbmRleE9mKCdcXHVmZmJhJykgKyAxLFxuICAgICAgICBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJylcbiAgICAgICk7XG4gIH0gZWxzZSB7XG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlICsgJ1xcdWZmYmUqL2AnKTtcbiAgICBjb2RlID0gY29kZS5zdWJzdHJpbmcoMCwgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIGxpbmUgPSBuZXcgTGluZTtcbiAgbGluZS5vZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhbeSx5XSk7XG4gIGxpbmUub2Zmc2V0ID0gbGluZS5vZmZzZXRSYW5nZVswXTtcbiAgbGluZS5sZW5ndGggPSBsaW5lLm9mZnNldFJhbmdlWzFdIC0gbGluZS5vZmZzZXRSYW5nZVswXSAtICh5IDwgdGhpcy5sb2MoKSk7XG4gIGxpbmUucG9pbnQuc2V0KHsgeDowLCB5OnkgfSk7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocC55KTtcbiAgdmFyIHBvaW50ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihsaW5lLmxlbmd0aCwgcC54KSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfSk7XG4gIHBvaW50Lm9mZnNldCA9IGxpbmUub2Zmc2V0ICsgcG9pbnQueDtcbiAgcG9pbnQucG9pbnQgPSBwb2ludDtcbiAgcG9pbnQubGluZSA9IGxpbmU7XG4gIHJldHVybiBwb2ludDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlVGV4dCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VPZmZzZXRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHJhbmdlWzFdID49IHRoaXMubG9jKClcbiAgICA/IHRoaXMudGV4dC5sZW5ndGhcbiAgICA6IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVsxXSArIDEpO1xuICB2YXIgb2Zmc2V0cyA9IFthLCBiXTtcbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFJhbmdlVGV4dCA9IGZ1bmN0aW9uKG9mZnNldFJhbmdlKSB7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldFJhbmdlKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciB0b2tlbiA9IHRoaXMudG9rZW5zLmdldEJ5T2Zmc2V0KCdsaW5lcycsIG9mZnNldCAtIC41KTtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogb2Zmc2V0IC0gKG9mZnNldCA+IHRva2VuLm9mZnNldCA/IHRva2VuLm9mZnNldCArIDEgOiAwKSxcbiAgICB5OiBNYXRoLm1pbih0aGlzLmxvYygpLCB0b2tlbi5pbmRleCAtICh0b2tlbi5vZmZzZXQgKyAxID4gb2Zmc2V0KSArIDEpXG4gIH0pO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5jaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGNoYXIgPSB0aGlzLnRleHQuZ2V0UmFuZ2UoW29mZnNldCwgb2Zmc2V0ICsgMV0pO1xuICByZXR1cm4gY2hhcjtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZVRleHQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHtcbiAgICBsaW5lOiBsaW5lLFxuICAgIHRleHQ6IHRleHQsXG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVRleHQgPSBmdW5jdGlvbih5KSB7XG4gIHZhciB0ZXh0ID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KFt5LHldKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEFyZWFUZXh0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBcmVhQXRQb2ludCA9IGZ1bmN0aW9uKHAsIGluY2x1c2l2ZSkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLm9mZnNldFJhbmdlKTtcbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKHRleHQsIFdPUkRTKTtcblxuICBpZiAod29yZHMubGVuZ3RoID09PSAxKSB7XG4gICAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogeyB4OiAwLCB5OiBwb2ludC55IH0sXG4gICAgICBlbmQ6IHsgeDogcG9pbnQubGluZS5sZW5ndGgsIHk6IHBvaW50LnkgfSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcmVhO1xuICB9XG5cbiAgdmFyIGxhc3RJbmRleCA9IDA7XG4gIHZhciB3b3JkID0gW107XG4gIHZhciBlbmQgPSB0ZXh0Lmxlbmd0aDtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmICh3b3JkLmluZGV4ID4gcG9pbnQueCAtICEhaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICBiZWdpbjogeyB4OiBsYXN0SW5kZXgsIHk6IHBvaW50LnkgfSxcbiAgICBlbmQ6IHsgeDogZW5kLCB5OiBwb2ludC55IH1cbiAgfSk7XG5cbiAgcmV0dXJuIGFyZWE7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLm1vdmVBcmVhQnlMaW5lcyA9IGZ1bmN0aW9uKHksIGFyZWEpIHtcbiAgaWYgKGFyZWEuZW5kLnggPiAwIHx8IGFyZWEuYmVnaW4ueSA9PT0gYXJlYS5lbmQueSkgYXJlYS5lbmQueSArPSAxO1xuICBpZiAoYXJlYS5iZWdpbi55ICsgeSA8IDAgfHwgYXJlYS5lbmQueSArIHkgPiB0aGlzLmxvYykgcmV0dXJuIGZhbHNlO1xuXG4gIGFyZWEuYmVnaW4ueCA9IDA7XG4gIGFyZWEuZW5kLnggPSAwO1xuXG4gIHZhciB0ZXh0ID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KFthcmVhLmJlZ2luLnksIGFyZWEuZW5kLnktMV0pO1xuICB0aGlzLnJlbW92ZUFyZWEoYXJlYSwgdHJ1ZSk7XG5cbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0LCB5KTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgcmFuZ2UgPSBbXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmJlZ2luKS5vZmZzZXQsXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmVuZCkub2Zmc2V0XG4gIF07XG4gIHJldHVybiByYW5nZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gbGluZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZU9mZnNldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIG9mZnNldCA9IHkgPCAwID8gLTEgOiB5ID09PSAwID8gMCA6IHRoaXMudG9rZW5zLmdldEJ5SW5kZXgoJ2xpbmVzJywgeSAtIDEpICsgMTtcbiAgcmV0dXJuIG9mZnNldDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubG9jID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdsaW5lcycpLmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudGV4dC50b1N0cmluZygpO1xufTtcblxuZnVuY3Rpb24gTGluZSgpIHtcbiAgdGhpcy5vZmZzZXRSYW5nZSA9IFtdO1xuICB0aGlzLm9mZnNldCA9IDA7XG4gIHRoaXMubGVuZ3RoID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRU9MKHMpIHtcbiAgcmV0dXJuIHMucmVwbGFjZShFT0wsICdcXG4nKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBJbmRleGVyO1xuXG5mdW5jdGlvbiBJbmRleGVyKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbn1cblxuSW5kZXhlci5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKCFzKSByZXR1cm4gW107XG4gIHZhciBvZmZzZXRzID0gW107XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIucmF3O1xuICB2YXIgbGVuID0gcy5sZW5ndGg7XG4gIHZhciBpbmRleDtcbiAgd2hpbGUgKH4oaW5kZXggPSB0ZXh0LmluZGV4T2YocywgaW5kZXggKyBsZW4pKSkge1xuICAgIG9mZnNldHMucHVzaChpbmRleCk7XG4gIH1cbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuIiwidmFyIGJpbmFyeVNlYXJjaCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9iaW5hcnktc2VhcmNoJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUGFydHM7XG5cbmZ1bmN0aW9uIFBhcnRzKG1pblNpemUpIHtcbiAgbWluU2l6ZSA9IG1pblNpemUgfHwgNTAwMDtcbiAgdGhpcy5taW5TaXplID0gbWluU2l6ZTtcbiAgdGhpcy5wYXJ0cyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IDA7XG59XG5cblBhcnRzLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oaXRlbSkge1xuICB0aGlzLmFwcGVuZChbaXRlbV0pO1xufTtcblxuUGFydHMucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciBwYXJ0ID0gbGFzdCh0aGlzLnBhcnRzKTtcblxuICBpZiAoIXBhcnQpIHtcbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gMDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gMDtcbiAgICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIH1cbiAgZWxzZSBpZiAocGFydC5sZW5ndGggPj0gdGhpcy5taW5TaXplKSB7XG4gICAgdmFyIHN0YXJ0SW5kZXggPSBwYXJ0LnN0YXJ0SW5kZXggKyBwYXJ0Lmxlbmd0aDtcbiAgICB2YXIgc3RhcnRPZmZzZXQgPSBpdGVtc1swXTtcblxuICAgIHBhcnQgPSBbXTtcbiAgICBwYXJ0LnN0YXJ0SW5kZXggPSBzdGFydEluZGV4O1xuICAgIHBhcnQuc3RhcnRPZmZzZXQgPSBzdGFydE9mZnNldDtcbiAgICB0aGlzLnBhcnRzLnB1c2gocGFydCk7XG4gIH1cblxuICBwYXJ0LnB1c2guYXBwbHkocGFydCwgaXRlbXMubWFwKG9mZnNldCA9PiBvZmZzZXQgLSBwYXJ0LnN0YXJ0T2Zmc2V0KSk7XG5cbiAgdGhpcy5sZW5ndGggKz0gaXRlbXMubGVuZ3RoO1xufTtcblxuUGFydHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHZhciBwYXJ0ID0gdGhpcy5maW5kUGFydEJ5SW5kZXgoaW5kZXgpLml0ZW07XG4gIHJldHVybiBwYXJ0W2luZGV4IC0gcGFydC5zdGFydEluZGV4XSArIHBhcnQuc3RhcnRPZmZzZXQ7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgcCA9IHRoaXMuZmluZFBhcnRCeU9mZnNldChvZmZzZXQpO1xuICBpZiAoIXAuaXRlbSkgcmV0dXJuIG51bGw7XG5cbiAgdmFyIHBhcnQgPSBwLml0ZW07XG4gIHZhciBwYXJ0SW5kZXggPSBwLmluZGV4O1xuICB2YXIgbyA9IHRoaXMuZmluZE9mZnNldEluUGFydChvZmZzZXQsIHBhcnQpO1xuICByZXR1cm4ge1xuICAgIG9mZnNldDogby5pdGVtICsgcGFydC5zdGFydE9mZnNldCxcbiAgICBpbmRleDogby5pbmRleCArIHBhcnQuc3RhcnRJbmRleCxcbiAgICBsb2NhbDogby5pbmRleCxcbiAgICBwYXJ0OiBwYXJ0LFxuICAgIHBhcnRJbmRleDogcGFydEluZGV4XG4gIH07XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBhcnJheSkge1xuICB2YXIgbyA9IHRoaXMuZmluZChvZmZzZXQpO1xuICBpZiAoIW8pIHtcbiAgICByZXR1cm4gdGhpcy5hcHBlbmQoYXJyYXkpO1xuICB9XG4gIGlmIChvLm9mZnNldCA+IG9mZnNldCkgby5sb2NhbCA9IC0xO1xuICB2YXIgbGVuZ3RoID0gYXJyYXkubGVuZ3RoO1xuICAvL1RPRE86IG1heWJlIHN1YnRyYWN0ICdvZmZzZXQnIGluc3RlYWQgP1xuICBhcnJheSA9IGFycmF5Lm1hcChlbCA9PiBlbCAtPSBvLnBhcnQuc3RhcnRPZmZzZXQpO1xuICBpbnNlcnQoby5wYXJ0LCBvLmxvY2FsICsgMSwgYXJyYXkpO1xuICB0aGlzLnNoaWZ0SW5kZXgoby5wYXJ0SW5kZXggKyAxLCAtbGVuZ3RoKTtcbiAgdGhpcy5sZW5ndGggKz0gbGVuZ3RoO1xufTtcblxuUGFydHMucHJvdG90eXBlLnNoaWZ0T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBzaGlmdCkge1xuICB2YXIgcGFydHMgPSB0aGlzLnBhcnRzO1xuICB2YXIgaXRlbSA9IHRoaXMuZmluZChvZmZzZXQpO1xuICBpZiAob2Zmc2V0ID4gaXRlbS5vZmZzZXQpIGl0ZW0ubG9jYWwgKz0gMTtcblxuICB2YXIgcmVtb3ZlZCA9IDA7XG4gIGZvciAodmFyIGkgPSBpdGVtLmxvY2FsOyBpIDwgaXRlbS5wYXJ0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaXRlbS5wYXJ0W2ldICs9IHNoaWZ0O1xuICAgIGlmIChpdGVtLnBhcnRbaV0gKyBpdGVtLnBhcnQuc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIHJlbW92ZWQrKztcbiAgICAgIGl0ZW0ucGFydC5zcGxpY2UoaS0tLCAxKTtcbiAgICB9XG4gIH1cbiAgaWYgKHJlbW92ZWQpIHtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoaXRlbS5wYXJ0SW5kZXggKyAxLCByZW1vdmVkKTtcbiAgICB0aGlzLmxlbmd0aCAtPSByZW1vdmVkO1xuICB9XG4gIGZvciAodmFyIGkgPSBpdGVtLnBhcnRJbmRleCArIDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0ICs9IHNoaWZ0O1xuICAgIGlmIChwYXJ0c1tpXS5zdGFydE9mZnNldCA8IG9mZnNldCkge1xuICAgICAgaWYgKGxhc3QocGFydHNbaV0pICsgcGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgICAgcmVtb3ZlZCA9IHBhcnRzW2ldLmxlbmd0aDtcbiAgICAgICAgdGhpcy5zaGlmdEluZGV4KGkgKyAxLCByZW1vdmVkKTtcbiAgICAgICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgICAgICAgcGFydHMuc3BsaWNlKGktLSwgMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJlbW92ZUJlbG93T2Zmc2V0KG9mZnNldCwgcGFydHNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmZpbmQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHRoaXMuZmluZChyYW5nZVsxXSk7XG5cbiAgaWYgKGEucGFydEluZGV4ID09PSBiLnBhcnRJbmRleCkge1xuICAgIGlmIChhLm9mZnNldCA+PSByYW5nZVsxXSB8fCBhLm9mZnNldCA8IHJhbmdlWzBdKSBhLmxvY2FsICs9IDE7XG4gICAgaWYgKGIub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGIub2Zmc2V0IDwgcmFuZ2VbMF0pIGIubG9jYWwgLT0gMTtcbiAgICB2YXIgc2hpZnQgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsLCBiLmxvY2FsICsgMSkubGVuZ3RoO1xuICAgIHRoaXMuc2hpZnRJbmRleChhLnBhcnRJbmRleCArIDEsIHNoaWZ0KTtcbiAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbiAgfSBlbHNlIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0QSA9IHJlbW92ZShhLnBhcnQsIGEubG9jYWwpLmxlbmd0aDtcbiAgICB2YXIgc2hpZnRCID0gcmVtb3ZlKGIucGFydCwgMCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICBpZiAoYi5wYXJ0SW5kZXggLSBhLnBhcnRJbmRleCA+IDEpIHtcbiAgICAgIHZhciByZW1vdmVkID0gcmVtb3ZlKHRoaXMucGFydHMsIGEucGFydEluZGV4ICsgMSwgYi5wYXJ0SW5kZXgpO1xuICAgICAgdmFyIHNoaWZ0QmV0d2VlbiA9IHJlbW92ZWQucmVkdWNlKChwLG4pID0+IHAgKyBuLmxlbmd0aCwgMCk7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEEgKyBzaGlmdEJldHdlZW47XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggLSByZW1vdmVkLmxlbmd0aCArIDEsIHNoaWZ0QSArIHNoaWZ0QiArIHNoaWZ0QmV0d2Vlbik7XG4gICAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW47XG4gICAgfSBlbHNlIHtcbiAgICAgIGIucGFydC5zdGFydEluZGV4IC09IHNoaWZ0QTtcbiAgICAgIHRoaXMuc2hpZnRJbmRleChiLnBhcnRJbmRleCArIDEsIHNoaWZ0QSArIHNoaWZ0Qik7XG4gICAgICB0aGlzLmxlbmd0aCAtPSBzaGlmdEEgKyBzaGlmdEI7XG4gICAgfVxuICB9XG5cbiAgLy9UT0RPOiB0aGlzIGlzIGluZWZmaWNpZW50IGFzIHdlIGNhbiBjYWxjdWxhdGUgdGhlIGluZGV4ZXMgb3Vyc2VsdmVzXG4gIGlmICghYS5wYXJ0Lmxlbmd0aCkge1xuICAgIHRoaXMucGFydHMuc3BsaWNlKHRoaXMucGFydHMuaW5kZXhPZihhLnBhcnQpLCAxKTtcbiAgfVxuICBpZiAoIWIucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYi5wYXJ0KSwgMSk7XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdEluZGV4ID0gZnVuY3Rpb24oc3RhcnRJbmRleCwgc2hpZnQpIHtcbiAgZm9yICh2YXIgaSA9IHN0YXJ0SW5kZXg7IGkgPCB0aGlzLnBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy5wYXJ0c1tpXS5zdGFydEluZGV4IC09IHNoaWZ0O1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUucmVtb3ZlQmVsb3dPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQsIHBhcnQpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KVxuICB2YXIgc2hpZnQgPSByZW1vdmUocGFydCwgMCwgby5pbmRleCkubGVuZ3RoO1xuICB0aGlzLnNoaWZ0SW5kZXgoby5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gIHRoaXMubGVuZ3RoIC09IHNoaWZ0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRPZmZzZXRJblBhcnQgPSBmdW5jdGlvbihvZmZzZXQsIHBhcnQpIHtcbiAgb2Zmc2V0IC09IHBhcnQuc3RhcnRPZmZzZXQ7XG4gIHJldHVybiBiaW5hcnlTZWFyY2gocGFydCwgbyA9PiBvIDw9IG9mZnNldCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZFBhcnRCeUluZGV4ID0gZnVuY3Rpb24oaW5kZXgpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRJbmRleCA8PSBpbmRleCk7XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuZmluZFBhcnRCeU9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHRoaXMucGFydHMsIHMgPT4gcy5zdGFydE9mZnNldCA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMucGFydHMucmVkdWNlKChwLG4pID0+IHAuY29uY2F0KG4pLCBbXSk7XG59O1xuXG5mdW5jdGlvbiBsYXN0KGFycmF5KSB7XG4gIHJldHVybiBhcnJheVthcnJheS5sZW5ndGggLSAxXTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlKGFycmF5LCBhLCBiKSB7XG4gIGlmIChiID09IG51bGwpIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhcnJheS5zcGxpY2UoYSwgYiAtIGEpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGluc2VydCh0YXJnZXQsIGluZGV4LCBhcnJheSkge1xuICB2YXIgb3AgPSBhcnJheS5zbGljZSgpO1xuICBvcC51bnNoaWZ0KGluZGV4LCAwKTtcbiAgdGFyZ2V0LnNwbGljZS5hcHBseSh0YXJnZXQsIG9wKTtcbn1cbiIsIi8vIHZhciBXT1JEID0gL1xcdysvZztcbnZhciBXT1JEID0gL1thLXpBLVowLTldezEsfS9nXG52YXIgcmFuayA9IDA7XG5cbm1vZHVsZS5leHBvcnRzID0gUHJlZml4VHJlZU5vZGU7XG5cbmZ1bmN0aW9uIFByZWZpeFRyZWVOb2RlKCkge1xuICB0aGlzLnZhbHVlID0gJyc7XG4gIHRoaXMucmFuayA9IDA7XG4gIHRoaXMuY2hpbGRyZW4gPSB7fTtcbn1cblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmdldENoaWxkcmVuID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjaGlsZHJlbiA9IE9iamVjdFxuICAgIC5rZXlzKHRoaXMuY2hpbGRyZW4pXG4gICAgLm1hcCgoa2V5KSA9PiB0aGlzLmNoaWxkcmVuW2tleV0pO1xuXG4gIHJldHVybiBjaGlsZHJlbi5yZWR1Y2UoKHAsIG4pID0+IHAuY29uY2F0KG4uZ2V0Q2hpbGRyZW4oKSksIGNoaWxkcmVuKTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5jb2xsZWN0ID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBjb2xsZWN0aW9uID0gW107XG4gIHZhciBub2RlID0gdGhpcy5maW5kKGtleSk7XG4gIGlmIChub2RlKSB7XG4gICAgY29sbGVjdGlvbiA9IG5vZGVcbiAgICAgIC5nZXRDaGlsZHJlbigpXG4gICAgICAuZmlsdGVyKChub2RlKSA9PiBub2RlLnZhbHVlKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgdmFyIHJlcyA9IGIucmFuayAtIGEucmFuaztcbiAgICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYi52YWx1ZS5sZW5ndGggLSBhLnZhbHVlLmxlbmd0aDtcbiAgICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYS52YWx1ZSA+IGIudmFsdWU7XG4gICAgICAgIHJldHVybiByZXM7XG4gICAgICB9KTtcblxuICAgIGlmIChub2RlLnZhbHVlKSBjb2xsZWN0aW9uLnB1c2gobm9kZSk7XG4gIH1cbiAgcmV0dXJuIGNvbGxlY3Rpb247XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKGtleSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIGZvciAodmFyIGNoYXIgaW4ga2V5KSB7XG4gICAgaWYgKGtleVtjaGFyXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltrZXlbY2hhcl1dO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG4gIHJldHVybiBub2RlO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgdmFyIGkgPSAwO1xuICB2YXIgbiA9IHMubGVuZ3RoO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGlmIChzW2ldIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW3NbaV1dO1xuICAgICAgaSsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBub2RlID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dID1cbiAgICBub2RlLmNoaWxkcmVuW3NbaV1dIHx8IG5ldyBQcmVmaXhUcmVlTm9kZTtcbiAgICBpKys7XG4gIH1cblxuICBub2RlLnZhbHVlID0gcztcbiAgbm9kZS5yYW5rKys7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkO1xuICB3aGlsZSAod29yZCA9IFdPUkQuZXhlYyhzKSkge1xuICAgIHRoaXMuaW5zZXJ0KHdvcmRbMF0pO1xuICB9XG59O1xuIiwidmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL3BvaW50Jyk7XG52YXIgYmluYXJ5U2VhcmNoID0gcmVxdWlyZSgnLi4vLi4vbGliL2JpbmFyeS1zZWFyY2gnKTtcbnZhciBUb2tlbnMgPSByZXF1aXJlKCcuL3Rva2VucycpO1xudmFyIFR5cGUgPSBUb2tlbnMuVHlwZTtcblxudmFyIEJlZ2luID0gL1tcXC8nXCJgXS9nO1xuXG52YXIgTWF0Y2ggPSB7XG4gICdzaW5nbGUgY29tbWVudCc6IFsnLy8nLCdcXG4nXSxcbiAgJ2RvdWJsZSBjb21tZW50JzogWycvKicsJyovJ10sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiBbJ2AnLCdgJ10sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogW1wiJ1wiLFwiJ1wiXSxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBbJ1wiJywnXCInXSxcbiAgJ3JlZ2V4cCc6IFsnLycsJy8nXSxcbn07XG5cbnZhciBTa2lwID0ge1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnc2luZ2xlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ2RvdWJsZSBjb21tZW50JzogZmFsc2UsXG4gICdyZWdleHAnOiBcIlxcXFxcIixcbn07XG5cbnZhciBUb2tlbiA9IHt9O1xuZm9yICh2YXIga2V5IGluIE1hdGNoKSB7XG4gIHZhciBNID0gTWF0Y2hba2V5XTtcbiAgVG9rZW5bTVswXV0gPSBrZXk7XG59XG5cbnZhciBMZW5ndGggPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAyLFxuICAnY2xvc2UgY29tbWVudCc6IDIsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAxLFxufTtcblxudmFyIE5vdE9wZW4gPSB7XG4gICdjbG9zZSBjb21tZW50JzogdHJ1ZVxufTtcblxudmFyIENsb3NlcyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjbG9zZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRhZyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICdzdHJpbmcnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50cztcblxuZnVuY3Rpb24gU2VnbWVudHMoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xuICB0aGlzLmNhY2hlID0ge307XG4gIHRoaXMucmVzZXQoKTtcbn1cblxuU2VnbWVudHMucHJvdG90eXBlLmNsZWFyQ2FjaGUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgaWYgKG9mZnNldCkge1xuICAgIHZhciBzID0gYmluYXJ5U2VhcmNoKHRoaXMuY2FjaGUuc3RhdGUsIHMgPT4gcy5vZmZzZXQgPCBvZmZzZXQsIHRydWUpO1xuICAgIHRoaXMuY2FjaGUuc3RhdGUuc3BsaWNlKHMuaW5kZXgpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuY2FjaGUuc3RhdGUgPSBbXTtcbiAgfVxuICB0aGlzLmNhY2hlLm9mZnNldCA9IHt9O1xuICB0aGlzLmNhY2hlLnJhbmdlID0ge307XG4gIHRoaXMuY2FjaGUucG9pbnQgPSB7fTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsZWFyQ2FjaGUoKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbih5KSB7XG4gIGlmICh5IGluIHRoaXMuY2FjaGUucG9pbnQpIHtcbiAgICByZXR1cm4gdGhpcy5jYWNoZS5wb2ludFt5XTtcbiAgfVxuXG4gIHZhciBzZWdtZW50cyA9IHRoaXMuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdzZWdtZW50cycpO1xuICB2YXIgb3BlbiA9IGZhbHNlO1xuICB2YXIgc3RhdGUgPSBudWxsO1xuICB2YXIgd2FpdEZvciA9ICcnO1xuICB2YXIgcG9pbnQgPSB7IHg6LTEsIHk6LTEgfTtcbiAgdmFyIGNsb3NlID0gMDtcbiAgdmFyIG9mZnNldDtcbiAgdmFyIHNlZ21lbnQ7XG4gIHZhciByYW5nZTtcbiAgdmFyIHRleHQ7XG4gIHZhciB2YWxpZDtcbiAgdmFyIGxhc3Q7XG5cbiAgdmFyIGxhc3RDYWNoZVN0YXRlT2Zmc2V0ID0gMDtcblxuICB2YXIgaSA9IDA7XG5cbiAgdmFyIGNhY2hlU3RhdGUgPSB0aGlzLmdldENhY2hlU3RhdGUoeSk7XG4gIGlmIChjYWNoZVN0YXRlICYmIGNhY2hlU3RhdGUuaXRlbSkge1xuICAgIG9wZW4gPSB0cnVlO1xuICAgIHN0YXRlID0gY2FjaGVTdGF0ZS5pdGVtO1xuICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgaSA9IHN0YXRlLmluZGV4ICsgMTtcbiAgfVxuXG4gIGZvciAoOyBpIDwgc2VnbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBvZmZzZXQgPSBzZWdtZW50cy5nZXQoaSk7XG4gICAgc2VnbWVudCA9IHtcbiAgICAgIG9mZnNldDogb2Zmc2V0LFxuICAgICAgdHlwZTogVHlwZVt0aGlzLmJ1ZmZlci5jaGFyQXQob2Zmc2V0KV1cbiAgICB9O1xuXG4gICAgLy8gc2VhcmNoaW5nIGZvciBjbG9zZSB0b2tlblxuICAgIGlmIChvcGVuKSB7XG4gICAgICBpZiAod2FpdEZvciA9PT0gc2VnbWVudC50eXBlKSB7XG4gICAgICAgIHBvaW50ID0gdGhpcy5nZXRPZmZzZXRQb2ludChzZWdtZW50Lm9mZnNldCk7XG5cbiAgICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBvaW50LnkgPj0geSkge1xuICAgICAgICAgIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IFRhZ1tzdGF0ZS50eXBlXSk7XG4gICAgICAgIH1cblxuICAgICAgICBsYXN0ID0gc2VnbWVudDtcbiAgICAgICAgbGFzdC5wb2ludCA9IHBvaW50O1xuICAgICAgICBzdGF0ZSA9IG51bGw7XG4gICAgICAgIG9wZW4gPSBmYWxzZTtcblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIG9wZW4gdG9rZW5cbiAgICBlbHNlIHtcbiAgICAgIHBvaW50ID0gdGhpcy5nZXRPZmZzZXRQb2ludChzZWdtZW50Lm9mZnNldCk7XG5cbiAgICAgIGlmICghcG9pbnQpIHtcbiAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICB9XG5cbiAgICAgIHJhbmdlID0gdGhpcy5idWZmZXIuZ2V0TGluZShwb2ludC55KS5vZmZzZXRSYW5nZTtcblxuICAgICAgaWYgKGxhc3QgJiYgbGFzdC5wb2ludC55ID09PSBwb2ludC55KSB7XG4gICAgICAgIGNsb3NlID0gbGFzdC5wb2ludC54ICsgTGVuZ3RoW2xhc3QudHlwZV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjbG9zZSA9IDA7XG4gICAgICB9XG5cbiAgICAgIHZhbGlkID0gdGhpcy5pc1ZhbGlkUmFuZ2UoW3JhbmdlWzBdLCByYW5nZVsxXSsxXSwgc2VnbWVudCwgY2xvc2UpO1xuXG4gICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgaWYgKE5vdE9wZW5bc2VnbWVudC50eXBlXSkgY29udGludWU7XG4gICAgICAgIG9wZW4gPSB0cnVlO1xuICAgICAgICBzdGF0ZSA9IHNlZ21lbnQ7XG4gICAgICAgIHN0YXRlLmluZGV4ID0gaTtcbiAgICAgICAgc3RhdGUucG9pbnQgPSBwb2ludDtcbiAgICAgICAgLy8gc3RhdGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMub2Zmc2V0IH07XG4gICAgICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgICAgIGlmICghdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggfHwgdGhpcy5jYWNoZS5zdGF0ZS5sZW5ndGggJiYgc3RhdGUub2Zmc2V0ID4gdGhpcy5jYWNoZS5zdGF0ZVt0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAtIDFdLm9mZnNldCkge1xuICAgICAgICAgIHRoaXMuY2FjaGUuc3RhdGUucHVzaChzdGF0ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXRlICYmIHN0YXRlLnBvaW50LnkgPCB5KSB7XG4gICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgfVxuXG4gIHJldHVybiAodGhpcy5jYWNoZS5wb2ludFt5XSA9IG51bGwpO1xufTtcblxuLy9UT0RPOiBjYWNoZSBpbiBCdWZmZXJcblNlZ21lbnRzLnByb3RvdHlwZS5nZXRPZmZzZXRQb2ludCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0IGluIHRoaXMuY2FjaGUub2Zmc2V0KSByZXR1cm4gdGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdID0gdGhpcy5idWZmZXIuZ2V0T2Zmc2V0UG9pbnQob2Zmc2V0KSk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIHNlZ21lbnQsIGNsb3NlKSB7XG4gIHZhciBrZXkgPSByYW5nZS5qb2luKCk7XG4gIGlmIChrZXkgaW4gdGhpcy5jYWNoZS5yYW5nZSkgcmV0dXJuIHRoaXMuY2FjaGUucmFuZ2Vba2V5XTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRSYW5nZVRleHQocmFuZ2UpO1xuICB2YXIgdmFsaWQgPSB0aGlzLmlzVmFsaWQodGV4dCwgc2VnbWVudC5vZmZzZXQgLSByYW5nZVswXSwgY2xvc2UpO1xuICByZXR1cm4gKHRoaXMuY2FjaGUucmFuZ2Vba2V5XSA9IHZhbGlkKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0LCBsYXN0SW5kZXgpIHtcbiAgQmVnaW4ubGFzdEluZGV4ID0gbGFzdEluZGV4O1xuXG4gIHZhciBtYXRjaCA9IEJlZ2luLmV4ZWModGV4dCk7XG4gIGlmICghbWF0Y2gpIHJldHVybjtcblxuICB2YXIgaSA9IG1hdGNoLmluZGV4O1xuXG4gIGxhc3QgPSBpO1xuXG4gIHZhciB2YWxpZCA9IHRydWU7XG5cbiAgb3V0ZXI6XG4gIGZvciAoOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBvbmUgPSB0ZXh0W2ldO1xuICAgIHZhciBuZXh0ID0gdGV4dFtpICsgMV07XG4gICAgdmFyIHR3byA9IG9uZSArIG5leHQ7XG4gICAgaWYgKGkgPT09IG9mZnNldCkgcmV0dXJuIHRydWU7XG5cbiAgICB2YXIgbyA9IFRva2VuW3R3b107XG4gICAgaWYgKCFvKSBvID0gVG9rZW5bb25lXTtcbiAgICBpZiAoIW8pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHZhciB3YWl0Rm9yID0gTWF0Y2hbb11bMV07XG5cbiAgICBsYXN0ID0gaTtcblxuICAgIHN3aXRjaCAod2FpdEZvci5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSBvbmUpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAxO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG5cbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuICAgICAgICAgIHR3byA9IHRleHRbaV0gKyB0ZXh0W2kgKyAxXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSB0d28pIHtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAyO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0Q2FjaGVTdGF0ZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLnBvaW50LnkgPCB5KTtcbiAgaWYgKHMuaXRlbSAmJiB5IC0gMSA8IHMuaXRlbS5wb2ludC55KSByZXR1cm4gbnVsbDtcbiAgZWxzZSByZXR1cm4gcztcbiAgLy8gcmV0dXJuIHM7XG59O1xuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbmxvZyA9IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplIHx8IDUwMDA7XG59XG5cblNraXBTdHJpbmcucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLmhlYWQud2lkdGhbdGhpcy5sZXZlbHMgLSAxXTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIC8vIGdyZWF0IGhhY2sgdG8gZG8gb2Zmc2V0ID49IGZvciAuc2VhcmNoKClcbiAgLy8gd2UgZG9uJ3QgaGF2ZSBmcmFjdGlvbnMgYW55d2F5IHNvLi5cbiAgcmV0dXJuIHRoaXMuc2VhcmNoKG9mZnNldCwgdHJ1ZSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaW5zZXJ0Q2h1bmtlZCgwLCB0ZXh0KTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKG9mZnNldCwgaW5jbCkge1xuICBpbmNsID0gaW5jbCA/IC4xIDogMDtcblxuICAvLyBwcmVwYXJlIHRvIGhvbGQgc3RlcHNcbiAgdmFyIHN0ZXBzID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcbiAgdmFyIHdpZHRoID0gbmV3IEFycmF5KHRoaXMubGV2ZWxzKTtcblxuICAvLyBpdGVyYXRlIGxldmVscyBkb3duLCBza2lwcGluZyB0b3BcbiAgdmFyIGkgPSB0aGlzLmxldmVscztcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHdoaWxlIChvZmZzZXQgKyBpbmNsID4gbm9kZS53aWR0aFtpXSAmJiBudWxsICE9IG5vZGUubmV4dFtpXSkge1xuICAgICAgb2Zmc2V0IC09IG5vZGUud2lkdGhbaV07XG4gICAgICBub2RlID0gbm9kZS5uZXh0W2ldO1xuICAgIH1cbiAgICBzdGVwc1tpXSA9IG5vZGU7XG4gICAgd2lkdGhbaV0gPSBvZmZzZXQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG5vZGU6IG5vZGUsXG4gICAgc3RlcHM6IHN0ZXBzLFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBvZmZzZXQ6IG9mZnNldFxuICB9O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3BsaWNlID0gZnVuY3Rpb24ocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwczsgLy8gc2tpcCBzdGVwcyBsZWZ0IG9mIHRoZSBvZmZzZXRcbiAgdmFyIHdpZHRoID0gcy53aWR0aDtcblxuICB2YXIgcDsgLy8gbGVmdCBub2RlIG9yIGBwYFxuICB2YXIgcTsgLy8gcmlnaHQgbm9kZSBvciBgcWAgKG91ciBuZXcgbm9kZSlcbiAgdmFyIGxlbjtcblxuICAvLyBjcmVhdGUgbmV3IG5vZGVcbiAgbGV2ZWwgPSBsZXZlbCB8fCB0aGlzLnJhbmRvbUxldmVsKCk7XG4gIHEgPSBuZXcgTm9kZSh2YWx1ZSwgbGV2ZWwpO1xuICBsZW5ndGggPSBxLndpZHRoWzBdO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgbGV2ZWxzIGJlbG93IG5ldyBub2RlIGxldmVsXG4gIGkgPSBsZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsIHN0ZXBcbiAgICBxLm5leHRbaV0gPSBwLm5leHRbaV07IC8vIGluc2VydCBzbyBpbmhlcml0IGxlZnQncyBuZXh0XG4gICAgcC5uZXh0W2ldID0gcTsgLy8gbGVmdCdzIG5leHQgaXMgbm93IG91ciBuZXcgbm9kZVxuICAgIHEud2lkdGhbaV0gPSBwLndpZHRoW2ldIC0gd2lkdGhbaV0gKyBsZW5ndGg7XG4gICAgcC53aWR0aFtpXSA9IHdpZHRoW2ldO1xuICB9XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBhbGwgbGV2ZWxzIGRvd24gdW50aWwgZXhjZXB0IG5ldyBub2RlIGxldmVsXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IGxldmVsKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWxcbiAgICBwLndpZHRoW2ldICs9IGxlbmd0aDsgLy8gYWRkIG5ldyBub2RlIHdpZHRoXG4gIH1cblxuICAvLyByZXR1cm4gbmV3IG5vZGVcbiAgcmV0dXJuIHE7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgcyA9IHRoaXMuc2VhcmNoKG9mZnNldCk7XG5cbiAgLy8gaWYgc2VhcmNoIGZhbGxzIGluIHRoZSBtaWRkbGUgb2YgYSBzdHJpbmdcbiAgLy8gaW5zZXJ0IGl0IHRoZXJlIGluc3RlYWQgb2YgY3JlYXRpbmcgYSBuZXcgbm9kZVxuICBpZiAocy5vZmZzZXQgJiYgcy5ub2RlLnZhbHVlICYmIHMub2Zmc2V0IDwgcy5ub2RlLnZhbHVlLmxlbmd0aCkge1xuICAgIHRoaXMudXBkYXRlKHMsIGluc2VydChzLm9mZnNldCwgcy5ub2RlLnZhbHVlLCB2YWx1ZSkpO1xuICAgIHJldHVybiBzLm5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5zcGxpY2Uocywgb2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgLy8gdmFsdWVzIGxlbmd0aCBkaWZmZXJlbmNlXG4gIHZhciBsZW5ndGggPSBzLm5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIC8vIHVwZGF0ZSB2YWx1ZVxuICBzLm5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBmaXggd2lkdGhzIG9uIGFsbCBsZXZlbHNcbiAgaSA9IHRoaXMubGV2ZWxzO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICBzLnN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmUgPSBmdW5jdGlvbihyYW5nZSkge1xuICBpZiAocmFuZ2VbMV0gPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdyYW5nZSBlbmQgb3ZlciBtYXhpbXVtIGxlbmd0aCgnICtcbiAgICAgIHRoaXMubGVuZ3RoICsgJyk6IFsnICsgcmFuZ2Uuam9pbigpICsgJ10nXG4gICAgKTtcbiAgfVxuXG4gIC8vIHJlbWFpbiBkaXN0YW5jZSB0byByZW1vdmVcbiAgdmFyIHggPSByYW5nZVsxXSAtIHJhbmdlWzBdO1xuXG4gIC8vIHNlYXJjaCBmb3Igbm9kZSBvbiBsZWZ0IGVkZ2VcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChyYW5nZVswXSk7XG4gIHZhciBvZmZzZXQgPSBzLm9mZnNldDtcbiAgdmFyIHN0ZXBzID0gcy5zdGVwcztcbiAgdmFyIG5vZGUgPSBzLm5vZGU7XG5cbiAgLy8gc2tpcCBoZWFkXG4gIGlmICh0aGlzLmhlYWQgPT09IG5vZGUpIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgLy8gc2xpY2UgbGVmdCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAob2Zmc2V0KSB7XG4gICAgaWYgKG9mZnNldCA8IG5vZGUud2lkdGhbMF0pIHtcbiAgICAgIHggLT0gdGhpcy51cGRhdGUocyxcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZSgwLCBvZmZzZXQpICtcbiAgICAgICAgbm9kZS52YWx1ZS5zbGljZShcbiAgICAgICAgICBvZmZzZXQgK1xuICAgICAgICAgIE1hdGgubWluKHgsIG5vZGUubGVuZ3RoIC0gb2Zmc2V0KVxuICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG5cbiAgICBpZiAoIW5vZGUpIHJldHVybjtcbiAgfVxuXG4gIC8vIHJlbW92ZSBhbGwgZnVsbCBub2RlcyBpbiByYW5nZVxuICB3aGlsZSAobm9kZSAmJiB4ID49IG5vZGUud2lkdGhbMF0pIHtcbiAgICB4IC09IHRoaXMucmVtb3ZlTm9kZShzdGVwcywgbm9kZSk7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuXG4gIC8vIHNsaWNlIHJpZ2h0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmICh4KSB7XG4gICAgdGhpcy5yZXBsYWNlKHN0ZXBzLCBub2RlLCBub2RlLnZhbHVlLnNsaWNlKHgpKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlTm9kZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLndpZHRoWzBdO1xuXG4gIHZhciBpO1xuXG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoIC0gbm9kZS53aWR0aFtpXTtcbiAgICBzdGVwc1tpXS5uZXh0W2ldID0gbm9kZS5uZXh0W2ldO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZXBsYWNlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUsIHZhbHVlKSB7XG4gIHZhciBsZW5ndGggPSBub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICBub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgdmFyIGk7XG4gIGkgPSBub2RlLmxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgbm9kZS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gdGhpcy5yZW1vdmUoW29mZnNldCwgb2Zmc2V0KzFdKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydENodW5rZWQgPSBmdW5jdGlvbihvZmZzZXQsIHRleHQpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0ZXh0Lmxlbmd0aDsgaSArPSB0aGlzLmNodW5rU2l6ZSkge1xuICAgIHZhciBjaHVuayA9IHRleHQuc3Vic3RyKGksIHRoaXMuY2h1bmtTaXplKTtcbiAgICB0aGlzLmluc2VydChpICsgb2Zmc2V0LCBjaHVuayk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnN1YnN0cmluZyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgdmFyIGxlbmd0aCA9IGIgLSBhO1xuXG4gIHZhciBzZWFyY2ggPSB0aGlzLnNlYXJjaChhLCB0cnVlKTtcbiAgdmFyIG5vZGUgPSBzZWFyY2gubm9kZTtcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgdmFyIGQgPSBsZW5ndGggKyBzZWFyY2gub2Zmc2V0O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAobm9kZSAmJiBkID49IDApIHtcbiAgICBkIC09IG5vZGUud2lkdGhbMF07XG4gICAgcyArPSBub2RlLnZhbHVlO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cbiAgaWYgKG5vZGUpIHtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gIH1cblxuICByZXR1cm4gcy5zdWJzdHIoc2VhcmNoLm9mZnNldCwgbGVuZ3RoKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJhbmRvbUxldmVsID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsZXZlbCA9IDE7XG4gIHdoaWxlIChsZXZlbCA8IHRoaXMubGV2ZWxzIC0gMSAmJiBNYXRoLnJhbmRvbSgpIDwgdGhpcy5iaWFzKSBsZXZlbCsrO1xuICByZXR1cm4gbGV2ZWw7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJhbmdlID0gcmFuZ2UgfHwgW107XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZyhyYW5nZVswXSwgcmFuZ2VbMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29weSA9IG5ldyBTa2lwU3RyaW5nO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcbiAgdmFyIG9mZnNldCA9IDA7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgY29weS5pbnNlcnQob2Zmc2V0LCBub2RlLnZhbHVlKTtcbiAgICBvZmZzZXQgKz0gbm9kZS53aWR0aFswXTtcbiAgfVxuICByZXR1cm4gY29weTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmpvaW5TdHJpbmcgPSBmdW5jdGlvbihkZWxpbWl0ZXIpIHtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB3aGlsZSAobm9kZSA9IG5vZGUubmV4dFswXSkge1xuICAgIHBhcnRzLnB1c2gobm9kZS52YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzLmpvaW4oZGVsaW1pdGVyKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnN1YnN0cmluZygwLCB0aGlzLmxlbmd0aCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIFIgPSBSZWdleHAuY3JlYXRlO1xuXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcbnZhciBzeW50YXggPSBtYXAoe1xuICAndCc6IFIoWydvcGVyYXRvciddLCAnZycsIGVudGl0aWVzKSxcbiAgJ20nOiBSKFsncGFyYW1zJ10sICAgJ2cnKSxcbiAgJ2QnOiBSKFsnZGVjbGFyZSddLCAgJ2cnKSxcbiAgJ2YnOiBSKFsnZnVuY3Rpb24nXSwgJ2cnKSxcbiAgJ2snOiBSKFsna2V5d29yZCddLCAgJ2cnKSxcbiAgJ24nOiBSKFsnYnVpbHRpbiddLCAgJ2cnKSxcbiAgJ2wnOiBSKFsnc3ltYm9sJ10sICAgJ2cnKSxcbiAgJ3MnOiBSKFsndGVtcGxhdGUgc3RyaW5nJ10sICdnJyksXG4gICdlJzogUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0ge1xuICByZWdleHA6IFIoWydpbmRlbnQnXSwgJ2dtJyksXG4gIHJlcGxhY2VyOiAocykgPT4gcy5yZXBsYWNlKC8gezEsMn18XFx0L2csICc8eD4kJjwveD4nKVxufTtcblxudmFyIEFueUNoYXIgPSAvXFxTL2c7XG5cbnZhciBCbG9ja3MgPSBSKFsnY29tbWVudCcsJ3N0cmluZycsJ3JlZ2V4cCddLCAnZ20nKTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2MnLFxuICAnLyonOiAnYycsXG4gICdgJzogJ3MnLFxuICAnXCInOiAncycsXG4gIFwiJ1wiOiAncycsXG4gICcvJzogJ3InLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTeW50YXg7XG5cbmZ1bmN0aW9uIFN5bnRheChvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLnRhYiA9IG8udGFiIHx8ICdcXHQnO1xuICB0aGlzLm1heExpbmUgPSBvLm1heExpbmUgfHwgMzAwO1xuICB0aGlzLmJsb2NrcyA9IFtdO1xufVxuXG5TeW50YXgucHJvdG90eXBlLmVudGl0aWVzID0gZW50aXRpZXM7XG5cblN5bnRheC5wcm90b3R5cGUuaGlnaGxpZ2h0ID0gZnVuY3Rpb24oY29kZSwgb2Zmc2V0KSB7XG4gIC8vIGNvbnNvbGUubG9nKDAsICdoaWdobGlnaHQnLCBjb2RlKVxuXG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUluZGVudHMoY29kZSk7XG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUJsb2Nrcyhjb2RlKTtcbiAgY29kZSA9IGVudGl0aWVzKGNvZGUpO1xuXG4gIGZvciAodmFyIGtleSBpbiBzeW50YXgpIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHN5bnRheFtrZXldLnJlZ2V4cCwgc3ludGF4W2tleV0ucmVwbGFjZXIpO1xuICB9XG5cbiAgY29kZSA9IHRoaXMucmVzdG9yZUJsb2Nrcyhjb2RlKTtcblxuICBjb2RlID0gY29kZS5yZXBsYWNlKEluZGVudC5yZWdleHAsIEluZGVudC5yZXBsYWNlcik7XG4gIC8vIGNvZGUgPSBjb2RlLnJlcGxhY2UoL1xcbi9nLCAnPGJyPicpXG5cbiAgLy8gY29kZSA9IGNvZGUucmVwbGFjZSgvXFx1ZWVlZS9nLCBmdW5jdGlvbigpIHtcbiAgLy8gICByZXR1cm4gbG9uZy5zaGlmdCgpLnNsaWNlKDAsIHRoaXMubWF4TGluZSkgKyAnLi4ubGluZSB0b28gbG9uZyB0byBkaXNwbGF5JztcbiAgLy8gfSk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUluZGVudHMgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBsaW5lcyA9IGNvZGUuc3BsaXQoL1xcbi9nKTtcbiAgdmFyIGluZGVudCA9IDA7XG4gIHZhciBtYXRjaDtcbiAgdmFyIGxpbmU7XG4gIHZhciBpO1xuXG4gIGkgPSBsaW5lcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIGxpbmUgPSBsaW5lc1tpXTtcbiAgICBBbnlDaGFyLmxhc3RJbmRleCA9IDA7XG4gICAgbWF0Y2ggPSBBbnlDaGFyLmV4ZWMobGluZSk7XG4gICAgaWYgKG1hdGNoKSBpbmRlbnQgPSBtYXRjaC5pbmRleDtcbiAgICBlbHNlIGlmIChpbmRlbnQgJiYgIWxpbmUubGVuZ3RoKSB7XG4gICAgICBsaW5lc1tpXSA9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKHRoaXMudGFiKTtcbiAgICB9XG4gIH1cblxuICBjb2RlID0gbGluZXMuam9pbignXFxuJyk7XG5cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLnJlc3RvcmVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHZhciBibG9jaztcbiAgdmFyIGJsb2NrcyA9IHRoaXMuYmxvY2tzO1xuICB2YXIgbiA9IDA7XG4gIHJldHVybiBjb2RlLnJlcGxhY2UoL1xcdWZmZWIvZywgZnVuY3Rpb24oKSB7XG4gICAgYmxvY2sgPSBibG9ja3NbbisrXVxuICAgIHZhciB0YWcgPSBpZGVudGlmeShibG9jayk7XG4gICAgcmV0dXJuICc8Jyt0YWcrJz4nK2VudGl0aWVzKGJsb2NrKSsnPC8nK3RhZysnPic7XG4gIH0pO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XG4gIHRoaXMuYmxvY2tzID0gW107XG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoQmxvY2tzLCAoYmxvY2spID0+IHtcbiAgICB0aGlzLmJsb2Nrcy5wdXNoKGJsb2NrKTtcbiAgICByZXR1cm4gJ1xcdWZmZWInO1xuICB9KTtcbiAgcmV0dXJuIGNvZGU7XG59O1xuXG5mdW5jdGlvbiBjcmVhdGVJZCgpIHtcbiAgdmFyIGFscGhhYmV0ID0gJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6JztcbiAgdmFyIGxlbmd0aCA9IGFscGhhYmV0Lmxlbmd0aCAtIDE7XG4gIHZhciBpID0gNjtcbiAgdmFyIHMgPSAnJztcbiAgd2hpbGUgKGktLSkge1xuICAgIHMgKz0gYWxwaGFiZXRbTWF0aC5yYW5kb20oKSAqIGxlbmd0aCB8IDBdO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG5mdW5jdGlvbiBlbnRpdGllcyh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIDtcbn1cblxuZnVuY3Rpb24gY29tcGlsZShyZWdleHAsIHRhZykge1xuICB2YXIgb3BlblRhZyA9ICc8JyArIHRhZyArICc+JztcbiAgdmFyIGNsb3NlVGFnID0gJzwvJyArIHRhZyArICc+JztcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiB0YWcsXG4gICAgcmVnZXhwOiByZWdleHAsXG4gICAgcmVwbGFjZXI6IG9wZW5UYWcgKyAnJCYnICsgY2xvc2VUYWdcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFwKG9iaiwgZm4pIHtcbiAgdmFyIHJlc3VsdCA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgcmVzdWx0W2tleV0gPSBmbihvYmpba2V5XSwga2V5KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiByZXBsYWNlKHBhc3MsIGNvZGUpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXNzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShwYXNzW2ldWzBdLCBwYXNzW2ldWzFdKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cblxuZnVuY3Rpb24gaWRlbnRpZnkoYmxvY2spIHtcbiAgdmFyIG9uZSA9IGJsb2NrWzBdO1xuICB2YXIgdHdvID0gb25lICsgYmxvY2tbMV07XG4gIHJldHVybiBUYWdbdHdvXSB8fCBUYWdbb25lXTtcbn1cbiIsInZhciBQYXJ0cyA9IHJlcXVpcmUoJy4vcGFydHMnKTtcblxudmFyIFR5cGUgPSB7XG4gICdcXG4nOiAnbGluZXMnLFxuICAneyc6ICdvcGVuIGN1cmx5JyxcbiAgJ30nOiAnY2xvc2UgY3VybHknLFxuICAnWyc6ICdvcGVuIHNxdWFyZScsXG4gICddJzogJ2Nsb3NlIHNxdWFyZScsXG4gICcoJzogJ29wZW4gcGFyZW5zJyxcbiAgJyknOiAnY2xvc2UgcGFyZW5zJyxcbiAgJy8nOiAnb3BlbiBjb21tZW50JyxcbiAgJyonOiAnY2xvc2UgY29tbWVudCcsXG4gICdgJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG4vLyB2YXIgVE9LRU4gPSAvXFxuL2c7XG52YXIgVE9LRU4gPSAvXFxufFxcL1xcKnxcXCpcXC98YHxcXHt8XFx9fFxcW3xcXF18XFwofFxcKS9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRva2VucztcblxuVG9rZW5zLlR5cGUgPSBUeXBlO1xuXG5mdW5jdGlvbiBUb2tlbnMoZmFjdG9yeSkge1xuICBmYWN0b3J5ID0gZmFjdG9yeSB8fCBmdW5jdGlvbigpIHsgcmV0dXJuIG5ldyBQYXJ0czsgfTtcblxuICB2YXIgdCA9IHRoaXMudG9rZW5zID0ge1xuICAgIGxpbmVzOiBmYWN0b3J5KCksXG4gICAgYmxvY2tzOiBmYWN0b3J5KCksXG4gICAgc2VnbWVudHM6IGZhY3RvcnkoKSxcbiAgfTtcblxuICB0aGlzLmNvbGxlY3Rpb24gPSB7XG4gICAgJ1xcbic6IHQubGluZXMsXG4gICAgJ3snOiB0LmJsb2NrcyxcbiAgICAnfSc6IHQuYmxvY2tzLFxuICAgICdbJzogdC5ibG9ja3MsXG4gICAgJ10nOiB0LmJsb2NrcyxcbiAgICAnKCc6IHQuYmxvY2tzLFxuICAgICcpJzogdC5ibG9ja3MsXG4gICAgJy8nOiB0LnNlZ21lbnRzLFxuICAgICcqJzogdC5zZWdtZW50cyxcbiAgICAnYCc6IHQuc2VnbWVudHMsXG4gIH07XG59XG5cblRva2Vucy5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHx8IDA7XG5cbiAgdmFyIHRva2VucyA9IHRoaXMudG9rZW5zO1xuICB2YXIgbWF0Y2g7XG4gIHZhciB0eXBlO1xuICB2YXIgY29sbGVjdGlvbjtcblxuICB3aGlsZSAobWF0Y2ggPSBUT0tFTi5leGVjKHRleHQpKSB7XG4gICAgY29sbGVjdGlvbiA9IHRoaXMuY29sbGVjdGlvblt0ZXh0W21hdGNoLmluZGV4XV07XG4gICAgY29sbGVjdGlvbi5wdXNoKG1hdGNoLmluZGV4ICsgb2Zmc2V0KTtcbiAgfVxufTtcblxuZnVuY3Rpb24gc29ydEJ5TnVtYmVyKGEsIGIpIHtcbiAgcmV0dXJuIGEgLSBiO1xufVxuXG5Ub2tlbnMucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHJhbmdlLCB0ZXh0LCBzaGlmdCkge1xuICB2YXIgaW5zZXJ0ID0gbmV3IFRva2VucyhBcnJheSk7XG4gIGluc2VydC5pbmRleCh0ZXh0LCByYW5nZVswXSk7XG4gIGZvciAodmFyIHR5cGUgaW4gdGhpcy50b2tlbnMpIHtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5zaGlmdE9mZnNldChyYW5nZVswXSwgc2hpZnQpO1xuICAgIC8vIGlmIChzaGlmdCA8IDApIHJhbmdlWzFdICs9IHNoaWZ0O1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnJlbW92ZVJhbmdlKHJhbmdlKTtcbiAgICB0aGlzLnRva2Vuc1t0eXBlXS5pbnNlcnQocmFuZ2VbMF0sIGluc2VydC50b2tlbnNbdHlwZV0pO1xuICB9XG4gIC8vIGNvbnNvbGUubG9nKHJhbmdlKVxuICAvLyBjb25zb2xlLmxvZyh0aGlzLnRva2Vucy5saW5lcy50b0FycmF5KCkpXG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5SW5kZXggPSBmdW5jdGlvbih0eXBlLCBpbmRleCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZ2V0KGluZGV4KTtcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0Q29sbGVjdGlvbiA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgcmV0dXJuIHRoaXMudG9rZW5zW3R5cGVdO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRCeU9mZnNldCA9IGZ1bmN0aW9uKHR5cGUsIG9mZnNldCkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV0uZmluZChvZmZzZXQpO1xufTtcbiIsInZhciBvcGVuID0gcmVxdWlyZSgnLi4vbGliL29wZW4nKTtcbnZhciBzYXZlID0gcmVxdWlyZSgnLi4vbGliL3NhdmUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIEJ1ZmZlciA9IHJlcXVpcmUoJy4vYnVmZmVyJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmlsZTtcblxuZnVuY3Rpb24gRmlsZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLnJvb3QgPSAnJztcbiAgdGhpcy5wYXRoID0gJ3VudGl0bGVkJztcbiAgdGhpcy5idWZmZXIgPSBuZXcgQnVmZmVyO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5GaWxlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkZpbGUucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJ1ZmZlci5vbigncmF3JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3JhdycpKTtcbiAgdGhpcy5idWZmZXIub24oJ3NldCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdzZXQnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCd1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnY2hhbmdlJykpO1xuICB0aGlzLmJ1ZmZlci5vbignYmVmb3JlIHVwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdiZWZvcmUgY2hhbmdlJykpO1xufTtcblxuRmlsZS5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMucGF0aCA9IHBhdGg7XG4gIHRoaXMucm9vdCA9IHJvb3Q7XG4gIG9wZW4ocm9vdCArIHBhdGgsIChlcnIsIHRleHQpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIGZuICYmIGZuKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYnVmZmVyLnNldFRleHQodGV4dCk7XG4gICAgdGhpcy5lbWl0KCdvcGVuJyk7XG4gICAgZm4gJiYgZm4obnVsbCwgdGhpcyk7XG4gIH0pO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHNhdmUodGhpcy5yb290ICsgdGhpcy5wYXRoLCB0aGlzLmJ1ZmZlci50b1N0cmluZygpLCBmbiB8fCBub29wKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vbGliL2RlYm91bmNlJyk7XG5cbi8qXG4gICAuIC5cbi0xIDAgMSAyIDMgNCA1XG4gICBuXG5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEhpc3Rvcnk7XG5cbmZ1bmN0aW9uIEhpc3RvcnkoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLm5lZWRsZSA9IDA7XG4gIHRoaXMudGltZW91dCA9IHRydWU7XG4gIHRoaXMudGltZVN0YXJ0ID0gMDtcbn1cblxuSGlzdG9yeS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oKSB7XG4gIGlmIChEYXRlLm5vdygpIC0gdGhpcy50aW1lU3RhcnQgPiAyMDAwKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuICB0aGlzLnRpbWVvdXQgPSB0aGlzLmRlYm91bmNlZFNhdmUoKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmRlYm91bmNlZFNhdmUgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5hY3R1YWxseVNhdmUoKTtcbn0sIDcwMCk7XG5cbkhpc3RvcnkucHJvdG90eXBlLmFjdHVhbGx5U2F2ZSA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnc2F2ZScsIHRoaXMubmVlZGxlKVxuICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgdGhpcy5sb2cgPSB0aGlzLmxvZy5zbGljZSgwLCArK3RoaXMubmVlZGxlKTtcbiAgdGhpcy5sb2cucHVzaCh0aGlzLmNvbW1pdCgpKTtcbiAgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGg7XG4gIHRoaXMudGltZVN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgdGhpcy50aW1lb3V0ID0gZmFsc2U7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS51bmRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcblxuICB0aGlzLm5lZWRsZS0tO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA8IDApIHRoaXMubmVlZGxlID0gMDtcbiAgLy8gY29uc29sZS5sb2coJ3VuZG8nLCB0aGlzLm5lZWRsZSwgdGhpcy5sb2cubGVuZ3RoIC0gMSlcblxuICB0aGlzLmNoZWNrb3V0KHRoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnJlZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgdGhpcy5uZWVkbGUrKztcbiAgLy8gY29uc29sZS5sb2coJ3JlZG8nLCB0aGlzLm5lZWRsZSwgdGhpcy5sb2cubGVuZ3RoIC0gMSlcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG5cbiAgdGhpcy5jaGVja291dCh0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jaGVja291dCA9IGZ1bmN0aW9uKG4pIHtcbiAgdmFyIGNvbW1pdCA9IHRoaXMubG9nW25dO1xuICBpZiAoIWNvbW1pdCkgcmV0dXJuO1xuICB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSA9IGNvbW1pdC5tYXJrQWN0aXZlO1xuICB0aGlzLmVkaXRvci5tYXJrLnNldChjb21taXQubWFyay5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5zZXRDYXJldChjb21taXQuY2FyZXQuY29weSgpKTtcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLnRleHQgPSBjb21taXQudGV4dC5jb3B5KCk7XG4gIHRoaXMuZWRpdG9yLmJ1ZmZlci5saW5lcyA9IGNvbW1pdC5saW5lcy5jb3B5KCk7XG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jb21taXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICB0ZXh0OiB0aGlzLmVkaXRvci5idWZmZXIudGV4dC5jb3B5KCksXG4gICAgbGluZXM6IHRoaXMuZWRpdG9yLmJ1ZmZlci5saW5lcy5jb3B5KCksXG4gICAgY2FyZXQ6IHRoaXMuZWRpdG9yLmNhcmV0LmNvcHkoKSxcbiAgICBtYXJrOiB0aGlzLmVkaXRvci5tYXJrLmNvcHkoKSxcbiAgICBtYXJrQWN0aXZlOiB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZVxuICB9O1xufTtcbiIsInZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xuXG52YXIgUEFHSU5HX1RIUk9UVExFID0gNjU7XG5cbnZhciBrZXlzID0gbW9kdWxlLmV4cG9ydHMgPSB7XG4gICdjdHJsK3onOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkudW5kbygpO1xuICB9LFxuICAnY3RybCt5JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnJlZG8oKTtcbiAgfSxcblxuICAnaG9tZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZSgpO1xuICB9LFxuICAnZW5kJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZSgpO1xuICB9LFxuICAncGFnZXVwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCgpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAncGFnZWRvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrdXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKDYpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCtkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKDYpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xKTtcbiAgfSxcbiAgJ3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEpO1xuICB9LFxuICAncmlnaHQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSk7XG4gIH0sXG4gICdkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEpO1xuICB9LFxuXG4gICdjdHJsK2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xKTtcbiAgfSxcbiAgJ2N0cmwrcmlnaHQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxKTtcbiAgfSxcblxuICAnY3RybCthJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfSxcblxuICAnY3RybCtzaGlmdCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCB7IGJlZ2luOiB0aGlzLmNhcmV0LnBvcywgZW5kOiB0aGlzLmNhcmV0LnBvcyB9KTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCB0aGlzLm1hcmsuZ2V0KCkpO1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuICAnY3RybCtzaGlmdCtkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIHsgYmVnaW46IHRoaXMuY2FyZXQucG9zLCBlbmQ6IHRoaXMuY2FyZXQucG9zIH0pO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIHRoaXMubWFyay5nZXQoKSk7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKCsxKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ2VudGVyJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5pbnNlcnQoJ1xcbicpO1xuICB9LFxuXG4gICdiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK2QnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIGxpbmVzID0gYXJlYS5lbmQueSAtIGFyZWEuYmVnaW4ueTtcbiAgICBpZiAobGluZXMgJiYgYXJlYS5lbmQueCA+IDApIGFkZCArPSAxO1xuICAgIGlmICghbGluZXMpIGFkZCArPSAxO1xuICAgIGxpbmVzICs9IGFkZDtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWFUZXh0KGFyZWEuc2V0TGVmdCgwKS5hZGRCb3R0b20oYWRkKSk7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHsgeDogMCwgeTogYXJlYS5lbmQueSB9LCB0ZXh0KTtcbiAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKGxpbmVzKTtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcyhsaW5lcywgdHJ1ZSk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrdXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCtkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKCsxKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3RhYic6IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXMgPSB0aGlzLnN1Z2dlc3QoKTtcbiAgICBpZiAoIXJlcykge1xuICAgICAgdGhpcy5pbnNlcnQodGhpcy50YWIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKHJlcy5hcmVhKTtcbiAgICAgIHRoaXMuaW5zZXJ0KHJlcy5ub2RlLnZhbHVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ2N0cmwrZic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZC5vcGVuKCk7XG4gIH0sXG5cbiAgJ2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgrMSk7XG4gIH0sXG4gICdzaGlmdCtmMyc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZmluZEp1bXAoLTEpO1xuICB9LFxuXG4gICdjdHJsKy8nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYWRkO1xuICAgIHZhciBhcmVhO1xuICAgIHZhciB0ZXh0O1xuXG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG5cbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIGNsZWFyID0gdHJ1ZTtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya1NldCgpO1xuICAgICAgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGhpcy5tYXJrLmFkZEJvdHRvbShhcmVhLmVuZC54ID4gMCkuc2V0TGVmdCgwKTtcbiAgICAgIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKHRoaXMubWFyay5nZXQoKSk7XG4gICAgfVxuXG4gICAgLy9UT0RPOiBzaG91bGQgY2hlY2sgaWYgbGFzdCBsaW5lIGhhcyAvLyBhbHNvXG4gICAgaWYgKHRleHQudHJpbUxlZnQoKS5zdWJzdHIoMCwyKSA9PT0gJy8vJykge1xuICAgICAgYWRkID0gLTM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKC4qPylcXC9cXC8gKC4rKS9nbSwgJyQxJDInKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWRkID0gKzM7XG4gICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKC9eKFtcXHNdKikoLispL2dtLCAnJDEvLyAkMicpO1xuICAgIH1cblxuICAgIHRoaXMuaW5zZXJ0KHRleHQpO1xuXG4gICAgdGhpcy5tYXJrLnNldChhcmVhLmFkZFJpZ2h0KGFkZCkpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG5cbiAgICBpZiAoY2FyZXQueCkgY2FyZXQuYWRkUmlnaHQoYWRkKTtcbiAgICB0aGlzLnNldENhcmV0KGNhcmV0KTtcblxuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjbGVhciA9IGZhbHNlO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgY2xlYXIgPSB0cnVlO1xuICAgIHZhciBjYXJldCA9IHRoaXMuY2FyZXQuY29weSgpO1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgaWYgKHRleHQuc2xpY2UoMCwyKSA9PT0gJy8qJyAmJiB0ZXh0LnNsaWNlKC0yKSA9PT0gJyovJykge1xuICAgICAgdGV4dCA9IHRleHQuc2xpY2UoMiwtMik7XG4gICAgICBhZGQgLT0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCAtPSAyO1xuICAgIH0gZWxzZSB7XG4gICAgICB0ZXh0ID0gJy8qJyArIHRleHQgKyAnKi8nO1xuICAgICAgYWRkICs9IDI7XG4gICAgICBpZiAoYXJlYS5lbmQueSA9PT0gYXJlYS5iZWdpbi55KSBhZGQgKz0gMjtcbiAgICB9XG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG4gICAgYXJlYS5lbmQueCArPSBhZGQ7XG4gICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gIWNsZWFyO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQuYWRkUmlnaHQoYWRkKSk7XG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcbn07XG5cbmtleXMuc2luZ2xlID0ge1xuICAvL1xufTtcblxuLy8gc2VsZWN0aW9uIGtleXNcblsgJ2hvbWUnLCdlbmQnLFxuICAncGFnZXVwJywncGFnZWRvd24nLFxuICAnbGVmdCcsJ3VwJywncmlnaHQnLCdkb3duJyxcbiAgJ2N0cmwrbGVmdCcsJ2N0cmwrcmlnaHQnXG5dLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gIGtleXNbJ3NoaWZ0Kycra2V5XSA9IGZ1bmN0aW9uKGUpIHtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIGtleXNba2V5XS5jYWxsKHRoaXMsIGUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9O1xufSk7XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBNb3VzZSA9IHJlcXVpcmUoJy4vbW91c2UnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi90ZXh0Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSW5wdXQ7XG5cbmZ1bmN0aW9uIElucHV0KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5tb3VzZSA9IG5ldyBNb3VzZSh0aGlzKTtcbiAgdGhpcy50ZXh0ID0gbmV3IFRleHQ7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbklucHV0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbklucHV0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ibHVyID0gdGhpcy5ibHVyLmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMudGV4dC5vbihbJ2tleScsICd0ZXh0J10sIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdpbnB1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdmb2N1cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdmb2N1cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdibHVyJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKSk7XG4gIHRoaXMudGV4dC5vbigndGV4dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICd0ZXh0JykpO1xuICB0aGlzLnRleHQub24oJ2tleXMnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5cycpKTtcbiAgdGhpcy50ZXh0Lm9uKCdrZXknLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAna2V5JykpO1xuICB0aGlzLnRleHQub24oJ2N1dCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjdXQnKSk7XG4gIHRoaXMudGV4dC5vbignY29weScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjb3B5JykpO1xuICB0aGlzLnRleHQub24oJ3Bhc3RlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3Bhc3RlJykpO1xuICB0aGlzLm1vdXNlLm9uKCd1cCcsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZXVwJykpO1xuICB0aGlzLm1vdXNlLm9uKCdjbGljaycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWNsaWNrJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkb3duJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZG93bicpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWcnKSk7XG4gIHRoaXMubW91c2Uub24oJ2RyYWcgYmVnaW4nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2VkcmFnYmVnaW4nKSk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICB0aGlzLm1vdXNlLnVzZShub2RlKTtcbiAgdGhpcy50ZXh0LnJlc2V0KCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuYmx1ciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnRleHQuYmx1cigpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5mb2N1cygpO1xufTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3VzZTtcblxuZnVuY3Rpb24gTW91c2UoKSB7XG4gIHRoaXMubm9kZSA9IG51bGw7XG4gIHRoaXMuY2xpY2tzID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbiAgdGhpcy5kb3duID0gbnVsbDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuTW91c2UucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW91c2UucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9ubWF5YmVkcmFnID0gdGhpcy5vbm1heWJlZHJhZy5iaW5kKHRoaXMpO1xuICB0aGlzLm9uZHJhZyA9IHRoaXMub25kcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kb3duID0gdGhpcy5vbmRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbnVwID0gdGhpcy5vbnVwLmJpbmQodGhpcyk7XG4gIGRvY3VtZW50LmJvZHkuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24obm9kZSkge1xuICBpZiAodGhpcy5ub2RlKSB7XG4gICAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgICAvLyB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG4gIH1cbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgLy8gdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB0aGlzLm9udXApO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZG93biA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZG93bicsIGUpO1xuICB0aGlzLm9uY2xpY2soZSk7XG4gIHRoaXMubWF5YmVEcmFnKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub251cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd1cCcsIGUpO1xuICBpZiAoIXRoaXMuZG93bikgcmV0dXJuO1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmRyYWdFbmQoKTtcbiAgdGhpcy5tYXliZURyYWdFbmQoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmNsaWNrID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnJlc2V0Q2xpY2tzKCk7XG4gIHRoaXMuY2xpY2tzID0gKHRoaXMuY2xpY2tzICUgMykgKyAxO1xuICB0aGlzLmVtaXQoJ2NsaWNrJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25tYXliZWRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuXG4gIHZhciBkID1cbiAgICAgIE1hdGguYWJzKHRoaXMucG9pbnQueCAtIHRoaXMuZG93bi54KVxuICAgICsgTWF0aC5hYnModGhpcy5wb2ludC55IC0gdGhpcy5kb3duLnkpO1xuXG4gIGlmIChkID4gNSkge1xuICAgIHRoaXMubWF5YmVEcmFnRW5kKCk7XG4gICAgdGhpcy5kcmFnQmVnaW4oKTtcbiAgfVxufTtcblxuTW91c2UucHJvdG90eXBlLm9uZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZHJhZycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGJlZ2luJyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgZW5kJyk7XG59O1xuXG5cbk1vdXNlLnByb3RvdHlwZS5yZXNldENsaWNrcyA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsaWNrcyA9IDA7XG59LCAzNTApO1xuXG5Nb3VzZS5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcblxudmFyIFRIUk9UVExFID0gMTAwMC82MjtcblxudmFyIG1hcCA9IHtcbiAgODogJ2JhY2tzcGFjZScsXG4gIDk6ICd0YWInLFxuICAxMzogJ2VudGVyJyxcbiAgMzM6ICdwYWdldXAnLFxuICAzNDogJ3BhZ2Vkb3duJyxcbiAgMzU6ICdlbmQnLFxuICAzNjogJ2hvbWUnLFxuICAzNzogJ2xlZnQnLFxuICAzODogJ3VwJyxcbiAgMzk6ICdyaWdodCcsXG4gIDQwOiAnZG93bicsXG4gIDQ2OiAnZGVsZXRlJyxcbiAgNDg6ICcwJyxcbiAgNDk6ICcxJyxcbiAgNTA6ICcyJyxcbiAgNTE6ICczJyxcbiAgNTI6ICc0JyxcbiAgNTM6ICc1JyxcbiAgNTQ6ICc2JyxcbiAgNTU6ICc3JyxcbiAgNTY6ICc4JyxcbiAgNTc6ICc5JyxcbiAgNjU6ICdhJyxcbiAgNjg6ICdkJyxcbiAgNzA6ICdmJyxcbiAgNzc6ICdtJyxcbiAgNzg6ICduJyxcbiAgODM6ICdzJyxcbiAgODk6ICd5JyxcbiAgOTA6ICd6JyxcbiAgMTEyOiAnZjEnLFxuICAxMTQ6ICdmMycsXG4gIDEyMjogJ2YxMScsXG4gIDE4ODogJywnLFxuICAxOTA6ICcuJyxcbiAgMTkxOiAnLycsXG5cbiAgLy8gbnVtcGFkXG4gIDk3OiAnZW5kJyxcbiAgOTg6ICdkb3duJyxcbiAgOTk6ICdwYWdlZG93bicsXG4gIDEwMDogJ2xlZnQnLFxuICAxMDI6ICdyaWdodCcsXG4gIDEwMzogJ2hvbWUnLFxuICAxMDQ6ICd1cCcsXG4gIDEwNTogJ3BhZ2V1cCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFRleHQ7XG5cblRleHQubWFwID0gbWFwO1xuXG5mdW5jdGlvbiBUZXh0KCkge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZXh0YXJlYScpO1xuXG4gIGRvbS5zdHlsZSh0aGlzLCB7XG4gICAgcG9zaXRpb246ICdhYnNvbHV0ZScsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgd2lkdGg6IDEsXG4gICAgaGVpZ2h0OiAxLFxuICAgIG9wYWNpdHk6IDBcbiAgfSk7XG5cbiAgZG9tLmF0dHJzKHRoaXMsIHtcbiAgICBhdXRvY2FwaXRhbGl6ZTogJ25vbmUnLFxuICAgIGF1dG9jb21wbGV0ZTogJ29mZicsXG4gICAgc3BlbGxjaGVja2luZzogJ29mZicsXG4gIH0pO1xuXG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcbiAgdGhpcy5tb2RpZmllcnMgPSB7fTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuVGV4dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5UZXh0LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5vbmN1dCA9IHRoaXMub25jdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmNvcHkgPSB0aGlzLm9uY29weS5iaW5kKHRoaXMpO1xuICB0aGlzLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGUuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleXVwID0gdGhpcy5vbmtleXVwLmJpbmQodGhpcyk7XG4gIHRoaXMuZWwub25ibHVyID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JsdXInKTtcbiAgdGhpcy5lbC5vbmZvY3VzID0gdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJyk7XG4gIHRoaXMuZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5lbC5vbmtleXVwID0gdGhpcy5vbmtleXVwO1xuICB0aGlzLmVsLm9uY3V0ID0gdGhpcy5vbmN1dDtcbiAgdGhpcy5lbC5vbmNvcHkgPSB0aGlzLm9uY29weTtcbiAgdGhpcy5lbC5vbnBhc3RlID0gdGhpcy5vbnBhc3RlO1xufTtcblxuVGV4dC5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xufVxuXG5UZXh0LnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWwudmFsdWUuc3Vic3RyKC0xKTtcbn07XG5cblRleHQucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHRoaXMuZWwudmFsdWUgPSB2YWx1ZTtcbn07XG5cbi8vVE9ETzogb24gbW9iaWxlIHdlIG5lZWQgdG8gY2xlYXIgd2l0aG91dCBkZWJvdW5jZVxuLy8gb3IgdGhlIHRleHRhcmVhIGNvbnRlbnQgaXMgZGlzcGxheWVkIGluIGhhY2tlcidzIGtleWJvYXJkXG4vLyBvciB5b3UgbmVlZCB0byBkaXNhYmxlIHdvcmQgc3VnZ2VzdGlvbnMgaW4gaGFja2VyJ3Mga2V5Ym9hcmQgc2V0dGluZ3NcblRleHQucHJvdG90eXBlLmNsZWFyID0gdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbn0sIDIwMDApO1xuXG5UZXh0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMuZWwuYmx1cigpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5mb2N1cygpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAvLyBmb3JjZXMgY2FyZXQgdG8gZW5kIG9mIHRleHRhcmVhIHNvIHdlIGNhbiBnZXQgLnNsaWNlKC0xKSBjaGFyXG4gIHNldEltbWVkaWF0ZSgoKSA9PiB0aGlzLmVsLnNlbGVjdGlvblN0YXJ0ID0gdGhpcy5lbC52YWx1ZS5sZW5ndGgpO1xuICB0aGlzLmVtaXQoJ3RleHQnLCB0aGlzLmdldCgpKTtcbiAgdGhpcy5jbGVhcigpO1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIC8vIGNvbnNvbGUubG9nKGUud2hpY2gpO1xuICB2YXIgbm93ID0gRGF0ZS5ub3coKTtcbiAgaWYgKG5vdyAtIHRoaXMudGhyb3R0bGVUaW1lIDwgVEhST1RUTEUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gbm93O1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5dXAgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMudGhyb3R0bGVUaW1lID0gMDtcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0ICYmICFlLnNoaWZ0S2V5KSBrZXlzLnB1c2goJ3NoaWZ0OnVwJyk7XG4gIGlmIChtLmN0cmwgJiYgIWUuY3RybEtleSkga2V5cy5wdXNoKCdjdHJsOnVwJyk7XG4gIGlmIChtLmFsdCAmJiAhZS5hbHRLZXkpIGtleXMucHVzaCgnYWx0OnVwJyk7XG5cbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0gKyAnOnVwJyk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2N1dCcsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25jb3B5ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY29weScsIGUpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25wYXN0ZSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ3Bhc3RlJywgZSk7XG59O1xuIiwidmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uL2xpYi9yZWdleHAnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgnLi4vbGliL3BvaW50Jyk7XG5cbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd3b3JkcyddLCAnZycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdmU7XG5cbmZ1bmN0aW9uIE1vdmUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG59XG5cbk1vdmUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTW92ZS5wcm90b3R5cGUucGFnZURvd24gPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgc2l6ZSAtIHJlbWFpbmRlcik7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMocGFnZSk7XG59O1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlVXAgPSBmdW5jdGlvbihkaXYpIHtcbiAgZGl2ID0gZGl2IHx8IDE7XG4gIHZhciBwYWdlID0gdGhpcy5lZGl0b3IucGFnZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgc2l6ZSA9IHRoaXMuZWRpdG9yLnNpemUuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHJlbWFpbmRlciA9IHNpemUgLSBwYWdlICogdGhpcy5lZGl0b3IuY2hhci5oZWlnaHQgfCAwO1xuICB0aGlzLmVkaXRvci5hbmltYXRlU2Nyb2xsQnkoMCwgLShzaXplIC0gcmVtYWluZGVyKSk7XG4gIHJldHVybiB0aGlzLmJ5TGluZXMoLXBhZ2UpO1xufTtcblxudmFyIG1vdmUgPSB7fTtcblxubW92ZS5ieVdvcmQgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciBsaW5lID0gYnVmZmVyLmdldExpbmVUZXh0KHAueSk7XG5cbiAgaWYgKGR4ID4gMCAmJiBwLnggPj0gbGluZS5sZW5ndGggLSAxKSB7IC8vIGF0IGVuZCBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsICsxKTsgLy8gbW92ZSBvbmUgY2hhciByaWdodFxuICB9IGVsc2UgaWYgKGR4IDwgMCAmJiBwLnggPT09IDApIHsgLy8gYXQgYmVnaW4gb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCAtMSk7IC8vIG1vdmUgb25lIGNoYXIgbGVmdFxuICB9XG5cbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKGxpbmUsIFdPUkRTKTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGR4IDwgMCkgd29yZHMucmV2ZXJzZSgpO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKGR4ID4gMFxuICAgICAgPyB3b3JkLmluZGV4ID4gcC54XG4gICAgICA6IHdvcmQuaW5kZXggPCBwLngpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHg6IHdvcmQuaW5kZXgsXG4gICAgICAgIHk6IHAueVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyByZWFjaGVkIGJlZ2luL2VuZCBvZiBmaWxlXG4gIHJldHVybiBkeCA+IDBcbiAgICA/IG1vdmUuZW5kT2ZMaW5lKGJ1ZmZlciwgcClcbiAgICA6IG1vdmUuYmVnaW5PZkxpbmUoYnVmZmVyLCBwKTtcbn07XG5cbm1vdmUuYnlDaGFycyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeCA8IDApIHsgLy8gZ29pbmcgbGVmdFxuICAgIHggKz0gZHg7IC8vIG1vdmUgbGVmdFxuICAgIGlmICh4IDwgMCkgeyAvLyB3aGVuIHBhc3QgbGVmdCBlZGdlXG4gICAgICBpZiAoeSA+IDApIHsgLy8gYW5kIGxpbmVzIGFib3ZlXG4gICAgICAgIHkgLT0gMTsgLy8gbW92ZSB1cCBhIGxpbmVcbiAgICAgICAgeCA9IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aDsgLy8gYW5kIGdvIHRvIHRoZSBlbmQgb2YgbGluZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeCA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKGR4ID4gMCkgeyAvLyBnb2luZyByaWdodFxuICAgIHggKz0gZHg7IC8vIG1vdmUgcmlnaHRcbiAgICB3aGlsZSAoeCAtIGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCA+IDApIHsgLy8gd2hpbGUgcGFzdCBsaW5lIGxlbmd0aFxuICAgICAgaWYgKHkgPT09IGJ1ZmZlci5sb2MoKSkgeyAvLyBvbiBlbmQgb2YgZmlsZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBnbyB0byBlbmQgb2YgbGluZSBvbiBsYXN0IGxpbmVcbiAgICAgICAgYnJlYWs7IC8vIGFuZCBleGl0XG4gICAgICB9XG4gICAgICB4IC09IGJ1ZmZlci5nZXRMaW5lKHkpLmxlbmd0aCArIDE7IC8vIHdyYXAgdGhpcyBsaW5lIGxlbmd0aFxuICAgICAgeSArPSAxOyAvLyBhbmQgbW92ZSBkb3duIGEgbGluZVxuICAgIH1cbiAgfVxuXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5ieUxpbmVzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeSkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR5IDwgMCkgeyAvLyBnb2luZyB1cFxuICAgIGlmICh5ICsgZHkgPiAwKSB7IC8vIHdoZW4gbGluZXMgYWJvdmVcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgdXBcbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IDA7XG4gICAgfVxuICB9IGVsc2UgaWYgKGR5ID4gMCkgeyAvLyBnb2luZyBkb3duXG4gICAgaWYgKHkgPCBidWZmZXIubG9jKCkgLSBkeSkgeyAvLyB3aGVuIGxpbmVzIGJlbG93XG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIGRvd25cbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IGJ1ZmZlci5sb2MoKTtcbiAgICB9XG4gIH1cblxuICAvLyBpZiAoeCA+IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoKSB7XG4gIC8vICAgeCA9IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoO1xuICAvLyB9IGVsc2Uge1xuICAvLyB9XG4gIHggPSBNYXRoLm1pbih0aGlzLmxhc3REZWxpYmVyYXRlWCwgYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoKTtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mTGluZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mTGluZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgeCA9IGJ1ZmZlci5nZXRMaW5lKHAueSkubGVuZ3RoO1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IEluZmluaXR5O1xuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogcC55XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZGaWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICB2YXIgeCA9IGJ1ZmZlci5nZXRMaW5lKGxhc3QpLmxlbmd0aFxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBsYXN0XG4gIH07XG59O1xuXG5tb3ZlLmlzQmVnaW5PZkZpbGUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHJldHVybiBwLnggPT09IDAgJiYgcC55ID09PSAwO1xufTtcblxubW92ZS5pc0VuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2MoKTtcbiAgcmV0dXJuIHAueSA9PT0gbGFzdCAmJiBwLnggPT09IGJ1ZmZlci5nZXRMaW5lKGxhc3QpLmxlbmd0aDtcbn07XG5cbk9iamVjdC5rZXlzKG1vdmUpLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gIE1vdmUucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbihwYXJhbSwgYnlFZGl0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG1vdmVbbWV0aG9kXS5jYWxsKFxuICAgICAgdGhpcyxcbiAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlcixcbiAgICAgIHRoaXMuZWRpdG9yLmNhcmV0LFxuICAgICAgcGFyYW1cbiAgICApO1xuXG4gICAgaWYgKCdpcycgPT09IG1ldGhvZC5zbGljZSgwLDIpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgdGhpcy5lbWl0KCdtb3ZlJywgcmVzdWx0LCBieUVkaXQpO1xuICB9O1xufSk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImVkaXRvclwiOlwiX3NyY19zdHlsZV9fZWRpdG9yXCIsXCJsYXllclwiOlwiX3NyY19zdHlsZV9fbGF5ZXJcIixcInJvd3NcIjpcIl9zcmNfc3R5bGVfX3Jvd3NcIixcIm1hcmtcIjpcIl9zcmNfc3R5bGVfX21hcmtcIixcImNvZGVcIjpcIl9zcmNfc3R5bGVfX2NvZGVcIixcImNhcmV0XCI6XCJfc3JjX3N0eWxlX19jYXJldFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIGVyZ29ub206IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MUUxNicsXG4gICAgY29sb3I6ICcjRTlFM0QxJyxcbiAgICBrZXl3b3JkOiAnI0ExMzYzMCcsXG4gICAgZnVuY3Rpb246ICcjQjNERjAyJyxcbiAgICBkZWNsYXJlOiAnI0Y2MzgzMycsXG4gICAgbnVtYmVyOiAnI0ZGOUY0RScsXG4gICAgcGFyYW1zOiAnI0EwOTBBMCcsXG4gICAgcmVnZXhwOiAnI0JENzBGNCcsXG4gICAgY29tbWVudDogJyM2MzUwNDcnLFxuICAgIHN0cmluZzogJyMzRUExRkInLFxuICB9LFxuXG4gIGRheWxpZ2h0OiB7XG4gICAgYmFja2dyb3VuZDogJyNFQkVCRUInLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyNGRjFCMUInLFxuICAgIGZ1bmN0aW9uOiAnIzAwMDVGRicsXG4gICAgZGVjbGFyZTogJyMwQzdBMDAnLFxuICAgIG51bWJlcjogJyM4MDIxRDQnLFxuICAgIHBhcmFtczogJyM0QzY5NjknLFxuICAgIGNvbW1lbnQ6ICcjQUJBQkFCJyxcbiAgICBzdHJpbmc6ICcjRTY3MDAwJyxcbiAgfSxcbn07XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHNldFRoZW1lO1xuZXhwb3J0cy50aGVtZXMgPSB0aGVtZXM7XG5cbi8qXG50OiBvcGVyYXRvclxuazoga2V5d29yZFxuZDogZGVjbGFyZVxuYjogYnVpbHRpblxubzogYm9vbGVhblxubjogbnVtYmVyXG5tOiBwYXJhbXNcbmY6IGZ1bmN0aW9uXG5yOiByZWdleHBcbmM6IGNvbW1lbnRcbnM6IHN0cmluZ1xubDogc3ltYm9sXG54OiBpbmRlbnRcbiAqL1xuZnVuY3Rpb24gc2V0VGhlbWUobmFtZSkge1xuICB2YXIgdCA9IHRoZW1lc1tuYW1lXTtcbiAgZG9tLmNzcygndGhlbWUnLFxuYFxuLiR7bmFtZX0ge1xuICBiYWNrZ3JvdW5kOiAke3QuYmFja2dyb3VuZH07XG59XG5cbnQsXG5rIHtcbiAgY29sb3I6ICR7dC5rZXl3b3JkfTtcbn1cblxuZCxcbm4ge1xuICBjb2xvcjogJHt0LmRlY2xhcmV9O1xufVxuXG5vLFxuZSB7XG4gIGNvbG9yOiAke3QubnVtYmVyfTtcbn1cblxubSB7XG4gIGNvbG9yOiAke3QucGFyYW1zfTtcbn1cblxuZiB7XG4gIGNvbG9yOiAke3QuZnVuY3Rpb259O1xuICBmb250LXN0eWxlOiBub3JtYWw7XG59XG5cbnIge1xuICBjb2xvcjogJHt0LnJlZ2V4cCB8fCB0LnBhcmFtc307XG59XG5cbmMge1xuICBjb2xvcjogJHt0LmNvbW1lbnR9O1xufVxuXG5zIHtcbiAgY29sb3I6ICR7dC5zdHJpbmd9O1xufVxuXG5sLFxuLiR7Y3NzLmNvZGV9IHtcbiAgY29sb3I6ICR7dC5jb2xvcn07XG59XG5cbi4ke2Nzcy5jYXJldH0ge1xuICBiYWNrZ3JvdW5kOiAke3QuY29sb3J9O1xufVxuXG5tLFxuZCB7XG4gIGZvbnQtc3R5bGU6IGl0YWxpYztcbn1cblxubCB7XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxueCB7XG4gIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgYmFja2dyb3VuZC1yZXBlYXQ6IG5vLXJlcGVhdDtcbn1cbmBcbiAgKVxuXG59XG5cbiIsInZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCbG9jaztcblxuZnVuY3Rpb24gQmxvY2sobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEpO1xufVxuXG5CbG9jay5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5CbG9jay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVuZGVyUGFnZSgxLCB0cnVlKTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ29kZTtcblxuZnVuY3Rpb24gQ29kZShuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNyk7XG59XG5cbkNvZGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuQ29kZS5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIHRoaXMuY2xlYXIoKTtcbiAgLy8gcmV0dXJuIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcblxuICBpZiAoIXRoaXMuZWRpdG9yLmVkaXRpbmcpIHtcbiAgICB0aGlzLnJlbmRlckFoZWFkKCk7XG4gIH1cbn07XG5cbkNvZGUucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIC8vIHRoaXMuY2xlYXIoKTtcbiAgLy8gcmV0dXJuIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcblxuICB2YXIgeSA9IGVkaXQubGluZTtcbiAgdmFyIGcgPSBlZGl0LnJhbmdlLnNsaWNlKCk7XG4gIHZhciBzaGlmdCA9IGVkaXQuc2hpZnQ7XG4gIHZhciBpc0VudGVyID0gc2hpZnQgPiAwO1xuICB2YXIgaXNCYWNrc3BhY2UgPSBzaGlmdCA8IDA7XG4gIHZhciBpc0JlZ2luID0gZ1swXSArIGlzQmFja3NwYWNlID09PSAwO1xuICB2YXIgaXNFbmQgPSBnWzFdICsgaXNFbnRlciA9PT0gdGhpcy5lZGl0b3Iucm93cztcblxuICBpZiAoc2hpZnQpIHtcbiAgICBpZiAoaXNFbnRlcikge1xuICAgICAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwwXSk7XG4gICAgICBpZiAoIXRoaXMuaGFzVmlld1RvcEF0KGVkaXQuY2FyZXROb3cueSkgfHwgZWRpdC5jYXJldEJlZm9yZS54ID4gMCkge1xuICAgICAgICB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhlZGl0LmNhcmV0Tm93LnkgKyAxLCAxKTtcbiAgICAgICAgdGhpcy5zcGxpdEVudGVyKGVkaXQuY2FyZXROb3cueSk7XG4gICAgICAgIGlmIChlZGl0LmNhcmV0QmVmb3JlLnggPiAwKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVSYW5nZShbZWRpdC5jYXJldEJlZm9yZS55LCBlZGl0LmNhcmV0QmVmb3JlLnldKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zaGlmdFZpZXdzQmVsb3coZWRpdC5jYXJldE5vdy55LCAxKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyUGFnZUJlbG93KGVkaXQuY2FyZXROb3cueSsxKTtcbiAgICB9XG4gICAgZWxzZSBpZiAoaXNCYWNrc3BhY2UpIHtcbiAgICAgIHRoaXMuY2xlYXJPdXRQYWdlUmFuZ2UoWzAsMV0pO1xuICAgICAgdGhpcy5zaG9ydGVuQm90dG9tQXQoZWRpdC5jYXJldE5vdy55KTtcbiAgICAgIHRoaXMuc2hpZnRWaWV3c0JlbG93KGVkaXQuY2FyZXROb3cueSsxLCAtMSk7XG4gICAgICBpZiAoIXRoaXMuaGFzVmlld1RvcEF0KGVkaXQuY2FyZXROb3cueSkpIHtcbiAgICAgICAgdGhpcy5zcGxpdEJhY2tzcGFjZShlZGl0LmNhcmV0Tm93LnkpO1xuICAgICAgfVxuICAgICAgaWYgKGVkaXQuY2FyZXROb3cueCA+IDApIHtcbiAgICAgICAgdGhpcy51cGRhdGVSYW5nZShbZWRpdC5jYXJldE5vdy55LCBlZGl0LmNhcmV0Tm93LnldKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyUGFnZUJlbG93KGVkaXQuY2FyZXROb3cueSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRoaXMudXBkYXRlUmFuZ2UoZyk7XG4gICAgdGhpcy5yZW5kZXJQYWdlKDApO1xuICB9XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbmQ7XG5cbmZ1bmN0aW9uIEZpbmQobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDQpO1xufVxuXG5GaW5kLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkZpbmQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcbiAgdGhpcy5yZW5kZXJQYWdlKDApO1xufTtcbiIsInZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xudmFyIEZpbmRWaWV3ID0gcmVxdWlyZSgnLi9maW5kJyk7XG52YXIgQmxvY2tWaWV3ID0gcmVxdWlyZSgnLi9ibG9jaycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3cztcblxuZnVuY3Rpb24gVmlld3MoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuXG4gIHRoaXMudmlld3MgPSBbXG4gICAgbmV3IFZpZXcoJ3J1bGVyJywgZWRpdG9yLCB0ZW1wbGF0ZS5ydWxlciksXG4gICAgbmV3IFZpZXcoJ2NhcmV0JywgZWRpdG9yLCB0ZW1wbGF0ZS5jYXJldCksXG4gICAgbmV3IENvZGVWaWV3KCdjb2RlJywgZWRpdG9yLCB0ZW1wbGF0ZS5jb2RlKSxcbiAgICBuZXcgTWFya1ZpZXcoJ21hcmsnLCBlZGl0b3IsIHRlbXBsYXRlLm1hcmspLFxuICAgIG5ldyBSb3dzVmlldygncm93cycsIGVkaXRvciwgdGVtcGxhdGUucm93cyksXG4gICAgLy8gbmV3IEZpbmRWaWV3KCdmaW5kJywgZWRpdG9yLCB0ZW1wbGF0ZS5maW5kKSxcbiAgICBuZXcgQmxvY2tWaWV3KCdibG9jaycsIGVkaXRvciwgdGVtcGxhdGUuYmxvY2spLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcblxuICB0aGlzLmJsb2NrLnJlbmRlciA9IGRlYm91bmNlKHRoaXMuYmxvY2sucmVuZGVyLCAyMCk7XG5cbiAgLy9UT0RPOiBuZWVkcyB0byBiZSBzZXQgZHluYW1pY2FsbHlcbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuaGlkZV9yb3dzKSB0aGlzLnJvd3MucmVuZGVyID0gbm9vcDtcbn1cblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59LFxuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xuXG52YXIgQWhlYWRUaHJlc2hvbGQgPSB7XG4gIGFuaW1hdGlvbjogWy4xNSwgLjRdLFxuICBub3JtYWw6IFsxLjUsIDNdXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IExheWVyO1xuXG5mdW5jdGlvbiBMYXllcihuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCBsZW5ndGgpIHtcbiAgdGhpcy5kb20gPSBkb20oY3NzLmxheWVyKTtcbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy52aWV3cyA9IHRoaXMuY3JlYXRlKGxlbmd0aCk7XG59XG5cbkxheWVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkxheWVyLnByb3RvdHlwZS5jcmVhdGUgPSBmdW5jdGlvbihsZW5ndGgpIHtcbiAgdmFyIHZpZXdzID0gbmV3IEFycmF5KGxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXSA9IG5ldyBWaWV3KHRoaXMubmFtZSwgdGhpcy5lZGl0b3IsIHRoaXMudGVtcGxhdGUpO1xuICAgIGRvbS5hcHBlbmQodGhpcywgdmlld3NbaV0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZXF1ZXN0VmlldyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiB2aWV3O1xuICB9XG4gIHJldHVybiB0aGlzLmNsZWFyKClbMF07XG59O1xuXG5MYXllci5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuaW5SYW5nZVZpZXdzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHZpZXdzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAoIHZpZXcudmlzaWJsZSA9PT0gdHJ1ZVxuICAgICAgJiYgKCB2aWV3WzBdID49IHJhbmdlWzBdICYmIHZpZXdbMF0gPD0gcmFuZ2VbMV1cbiAgICAgICAgfHwgdmlld1sxXSA+PSByYW5nZVswXSAmJiB2aWV3WzFdIDw9IHJhbmdlWzFdICkgKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUub3V0UmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IGZhbHNlXG4gICAgICB8fCB2aWV3WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHZpZXdbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHZpZXdzLnB1c2godmlldyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB2aWV3cy5zb3J0KChhLGIpID0+IGEubGFzdFVzZWQgLSBiLmxhc3RVc2VkKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJSYW5nZXMgPSBmdW5jdGlvbihyYW5nZXMsIHZpZXdzKSB7XG4gIGZvciAodmFyIG4gPSAwLCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciByYW5nZSA9IHJhbmdlc1tpXTtcbiAgICB2YXIgdmlldyA9IHZpZXdzW24rK107XG4gICAgdmlldy5yZW5kZXIocmFuZ2UpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgaW5jbHVkZSkge1xuICB2YXIgdmlzaWJsZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5WaWV3cyA9IHRoaXMuaW5SYW5nZVZpZXdzKHJhbmdlKTtcbiAgdmFyIG91dFZpZXdzID0gdGhpcy5vdXRSYW5nZVZpZXdzKG1heChyYW5nZSwgdmlzaWJsZVJhbmdlKSk7XG5cbiAgdmFyIG5lZWRSYW5nZXMgPSBSYW5nZS5OT1QocmFuZ2UsIGluVmlld3MpO1xuICB2YXIgbmVlZFZpZXdzID0gbmVlZFJhbmdlcy5sZW5ndGggLSBvdXRWaWV3cy5sZW5ndGg7XG4gIGlmIChuZWVkVmlld3MgPiAwKSB7XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIHRoaXMucmVuZGVyUmFuZ2VzKFt2aXNpYmxlUmFuZ2VdLCB0aGlzLnZpZXdzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZWxzZSBpZiAoaW5jbHVkZSkgdGhpcy5yZW5kZXJWaWV3cyhpblZpZXdzKTtcbiAgdGhpcy5yZW5kZXJSYW5nZXMobmVlZFJhbmdlcywgb3V0Vmlld3MpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclZpZXdzID0gZnVuY3Rpb24odmlld3MpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB2aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZpZXdzW2ldLnJlbmRlcigpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyTGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5yZW5kZXJSYW5nZShbeSx5XSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUGFnZSA9IGZ1bmN0aW9uKG4sIGluY2x1ZGUpIHtcbiAgbiA9IG4gfHwgMDtcbiAgdGhpcy5yZW5kZXJSYW5nZSh0aGlzLmdldFBhZ2VSYW5nZShbLW4sK25dKSwgaW5jbHVkZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyQWhlYWQgPSBmdW5jdGlvbihpbmNsdWRlKSB7XG4gIHZhciB2aWV3cyA9IHRoaXMudmlld3M7XG4gIHZhciBjdXJyZW50UGFnZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuXG4gIC8vIG5vIHZpZXcgaXMgdmlzaWJsZSwgcmVuZGVyIGN1cnJlbnQgcGFnZSBvbmx5XG4gIGlmIChSYW5nZS5BTkQoY3VycmVudFBhZ2VSYW5nZSwgdmlld3MpLmxlbmd0aCA9PT0gMCkge1xuICAgIHRoaXMucmVuZGVyUGFnZSgwKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBjaGVjayBpZiB3ZSdyZSBwYXN0IHRoZSB0aHJlc2hvbGQgb2Ygdmlld1xuICB2YXIgdGhyZXNob2xkID0gdGhpcy5lZGl0b3IuYW5pbWF0aW9uUnVubmluZ1xuICAgID8gWy1BaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF0sICtBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMF1dXG4gICAgOiBbLUFoZWFkVGhyZXNob2xkLm5vcm1hbFswXSwgK0FoZWFkVGhyZXNob2xkLm5vcm1hbFswXV07XG5cbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZSh0aHJlc2hvbGQpO1xuICB2YXIgYWhlYWROZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKGFoZWFkUmFuZ2UsIHZpZXdzKTtcbiAgaWYgKGFoZWFkTmVlZFJhbmdlcy5sZW5ndGgpIHtcbiAgICAvLyBpZiBzbywgcmVuZGVyIGZ1cnRoZXIgYWhlYWQgdG8gaGF2ZSBzb21lXG4gICAgLy8gbWFyZ2luIHRvIHNjcm9sbCB3aXRob3V0IHRyaWdnZXJpbmcgbmV3IHJlbmRlcnNcbiAgICB0aGlzLnJlbmRlclBhZ2UoXG4gICAgICB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgICAgID8gQWhlYWRUaHJlc2hvbGQuYW5pbWF0aW9uWzFdXG4gICAgICAgIDogQWhlYWRUaHJlc2hvbGQubm9ybWFsWzFdLFxuICAgICAgaW5jbHVkZVxuICAgICk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5zcGxpY2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcblxuICAgIGlmICh2aWV3WzFdIDwgcmFuZ2VbMF0gfHwgdmlld1swXSA+IHJhbmdlWzFdKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAodmlld1swXSA8IHJhbmdlWzBdICYmIHZpZXdbMV0gPj0gcmFuZ2VbMF0pIHsgLy8gc2hvcnRlbiBhYm92ZVxuICAgICAgdmlld1sxXSA9IHJhbmdlWzBdIC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMV0gPiByYW5nZVsxXSkgeyAvLyBzaG9ydGVuIGJlbG93XG4gICAgICB2aWV3WzBdID0gcmFuZ2VbMV0gKyAxO1xuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMF0gPT09IHJhbmdlWzBdICYmIHZpZXdbMV0gPT09IHJhbmdlWzFdKSB7IC8vIGN1cnJlbnQgbGluZVxuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmlldy5jbGVhcigpO1xuICAgIH1cbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLmhhc1ZpZXdUb3BBdCA9IGZ1bmN0aW9uKHkpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzBdID09PSB5KSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc2hvcnRlbkJvdHRvbUF0ID0gZnVuY3Rpb24oeSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMV0gPT09IHkpIHtcbiAgICAgIHZpZXdbMV0gLT0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc3BsaXRFbnRlciA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzBdIDw9IHkgJiYgdmlld1sxXSA+PSB5KSB7XG4gICAgICB2YXIgYm90dG9tID0gdmlld1sxXTtcbiAgICAgIHZpZXdbMV0gPSB5IC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICAgIHRoaXMucmVuZGVyUmFuZ2UoW3krMSwgTWF0aC5taW4ocGFnZVJhbmdlWzFdLCBib3R0b20rMSldKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG5MYXllci5wcm90b3R5cGUuc3BsaXRCYWNrc3BhY2UgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBwYWdlUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbMCwxXSk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5ICYmIHZpZXdbMV0gPj0geSkge1xuICAgICAgdmFyIGJvdHRvbSA9IHZpZXdbMV07XG4gICAgICB2aWV3WzFdID0geSAtIDE7XG4gICAgICB2aWV3LnN0eWxlKCk7XG4gICAgICB0aGlzLnJlbmRlclJhbmdlKFt5LCBNYXRoLm1pbihwYWdlUmFuZ2VbMV0sIGJvdHRvbSsxKV0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5zaGlmdFZpZXdzQmVsb3cgPSBmdW5jdGlvbih5LCBkeSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMF0gPCB5KSBjb250aW51ZTtcblxuICAgIHZpZXdbMF0gKz0gZHk7XG4gICAgdmlld1sxXSArPSBkeTtcbiAgICB2aWV3LnN0eWxlKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhck91dFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMub3V0UmFuZ2VWaWV3cyh0aGlzLmdldFBhZ2VSYW5nZShyYW5nZSkpLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclBhZ2VCZWxvdyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5yZW5kZXJSYW5nZShbeSwgdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pWzFdXSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUudXBkYXRlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB0aGlzLnNwbGljZVJhbmdlKHJhbmdlKTtcbiAgdGhpcy5yZW5kZXJSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy52aWV3c1tpXS5jbGVhcigpO1xuICB9XG4gIHJldHVybiB0aGlzLnZpZXdzO1xufTtcblxuZnVuY3Rpb24gbWF4KGEsIGIpIHtcbiAgcmV0dXJuIFtNYXRoLm1pbihhWzBdLCBiWzBdKSwgTWF0aC5tYXgoYVsxXSwgYlsxXSldO1xufVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1hcms7XG5cbmZ1bmN0aW9uIE1hcmsobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEpO1xufVxuXG5NYXJrLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbk1hcmsucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlclBhZ2UoMCwgdHJ1ZSk7XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJvd3M7XG5cbmZ1bmN0aW9uIFJvd3MobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDcpO1xufVxuXG5Sb3dzLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cblJvd3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICAvLyB0aGlzLmNsZWFyKCk7XG4gIC8vIHJldHVybiB0aGlzLnJlbmRlclBhZ2UoMCwgdHJ1ZSk7XG5cbiAgdmFyIHZpZXdzID0gdGhpcy52aWV3cztcbiAgdmFyIHJvd3MgPSB0aGlzLmVkaXRvci5yb3dzO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB2aWV3c1tpXTtcbiAgICB2YXIgciA9IHZpZXc7XG4gICAgaWYgKCF2aWV3LnZpc2libGUpIGNvbnRpbnVlO1xuXG4gICAgaWYgKHJbMV0gPiByb3dzKSB2aWV3LmNsZWFyKCk7XG4gIH1cblxuICB0aGlzLnJlbmRlckFoZWFkKCk7XG59O1xuIiwidmFyIHRlbXBsYXRlID0gZXhwb3J0cztcblxudGVtcGxhdGUuY29kZSA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIC8vIGlmICh0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucGFyYW0gPT09IGNvZGUpIHtcbiAgLy8gICByZXR1cm4gdGVtcGxhdGUuY29kZS5tZW1vaXplLnJlc3VsdDtcbiAgLy8gfSBlbHNlIHtcbiAgLy8gICB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucGFyYW0gPSBjb2RlO1xuICAvLyAgIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5yZXN1bHQgPSBmYWxzZTtcbiAgLy8gfVxuXG4gIC8vIHZhciBodG1sID0gZS5idWZmZXIuZ2V0SGlnaGxpZ2h0ZWQocmFuZ2UpO1xuICB2YXIgaHRtbCA9IGUuYnVmZmVyLmdldChyYW5nZSk7XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG4vLyBzaW5nbGV0b24gbWVtb2l6ZSBmb3IgZmFzdCBsYXN0IHJlcGVhdGluZyB2YWx1ZVxudGVtcGxhdGUuY29kZS5tZW1vaXplID0ge1xuICBwYXJhbTogJycsXG4gIHJlc3VsdDogJydcbn07XG5cbnRlbXBsYXRlLnJvd3MgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcyA9ICcnO1xuICBmb3IgKHZhciBpID0gcmFuZ2VbMF07IGkgPD0gcmFuZ2VbMV07IGkrKykge1xuICAgIHMgKz0gKGkgKyAxKSArICdcXG4nO1xuICB9XG4gIHJldHVybiBzO1xufTtcblxudGVtcGxhdGUubWFyayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBtYXJrID0gZS5tYXJrLmdldCgpO1xuICBpZiAocmFuZ2VbMF0gPiBtYXJrLmVuZC55KSByZXR1cm4gZmFsc2U7XG4gIGlmIChyYW5nZVsxXSA8IG1hcmsuYmVnaW4ueSkgcmV0dXJuIGZhbHNlO1xuXG4gIHZhciBvZmZzZXRzID0gZS5idWZmZXIuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBhcmVhID0gZS5idWZmZXIuZ2V0QXJlYU9mZnNldFJhbmdlKG1hcmspO1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG5cbiAgYXJlYVswXSAtPSBvZmZzZXRzWzBdO1xuICBhcmVhWzFdIC09IG9mZnNldHNbMF07XG5cbiAgdmFyIGFib3ZlID0gY29kZS5zdWJzdHJpbmcoMCwgYXJlYVswXSk7XG4gIHZhciBtaWRkbGUgPSBjb2RlLnN1YnN0cmluZyhhcmVhWzBdLCBhcmVhWzFdKTtcbiAgdmFyIGh0bWwgPSBlLnN5bnRheC5lbnRpdGllcyhhYm92ZSlcbiAgICArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciB0YWJzO1xuICB2YXIgcjtcbiAgd2hpbGUgKHJlc3VsdHNbaV0gJiYgcmVzdWx0c1tpXS55IDwgcmFuZ2VbMV0pIHtcbiAgICByID0gcmVzdWx0c1tpKytdO1xuICAgIHRhYnMgPSBlLmdldFBvaW50VGFicyhyKTtcbiAgICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgICArICd3aWR0aDonICsgd2lkdGggKyAnOydcbiAgICAgICAgICArICd0b3A6JyArIChyLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICAgKyAnbGVmdDonICsgKChyLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICAgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBodG1sID0gJyc7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcblxuICB2YXIgcmVzdWx0ID0gZS5idWZmZXIudG9rZW5zLmdldEJ5T2Zmc2V0KCdibG9ja3MnLCBvZmZzZXQpO1xuICBpZiAoIXJlc3VsdCkgcmV0dXJuIGh0bWw7XG5cbiAgdmFyIGxlbmd0aCA9IGUuYnVmZmVyLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdibG9ja3MnKS5sZW5ndGg7XG4gIHZhciBjaGFyID0gZS5idWZmZXIuY2hhckF0KHJlc3VsdCk7XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgaSA9IHJlc3VsdC5pbmRleDtcbiAgdmFyIG9wZW5PZmZzZXQgPSByZXN1bHQub2Zmc2V0O1xuXG4gIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG5cbiAgdmFyIGNvdW50ID0gcmVzdWx0Lm9mZnNldCA+PSBvZmZzZXQgLSAxICYmIENsb3NlW2NoYXJdID8gMCA6IDE7XG5cbiAgdmFyIGxpbWl0ID0gMjAwO1xuXG4gIHdoaWxlIChpID4gMCkge1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAoIS0tbGltaXQpIHJldHVybiBodG1sO1xuXG4gICAgaWYgKG9wZW4gJiYgIS0tY291bnQpIGJyZWFrO1xuXG4gICAgb3Blbk9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCAtLWkpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQob3Blbk9mZnNldCk7XG4gIH1cblxuICBpZiAoY291bnQpIHJldHVybiBodG1sO1xuXG4gIGNvdW50ID0gMTtcblxuICB3aGlsZSAoaSA8IGxlbmd0aCAtIDEpIHtcbiAgICBjbG9zZU9mZnNldCA9IGUuYnVmZmVyLnRva2Vucy5nZXRCeUluZGV4KCdibG9ja3MnLCArK2kpO1xuICAgIGNoYXIgPSBlLmJ1ZmZlci5jaGFyQXQoY2xvc2VPZmZzZXQpO1xuICAgIGlmICghLS1saW1pdCkgcmV0dXJuIGh0bWw7XG5cbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICB9XG5cbiAgaWYgKGNvdW50KSByZXR1cm4gaHRtbDtcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvcGVuT2Zmc2V0KTtcbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmdldE9mZnNldFBvaW50KGNsb3NlT2Zmc2V0KTtcblxuICB2YXIgdGFicztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoYmVnaW4pO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKChiZWdpbi54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpXG4gICAgICAgICAgICAgICAgICAqIGUuY2hhci53aWR0aCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0KSArICdweDsnXG4gICAgICAgICsgJ1wiPjwvaT4nO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhlbmQpO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoZW5kLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICsgJ2xlZnQ6JyArICgoZW5kLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcilcbiAgICAgICAgICAgICAgICAgICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID1cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID1cbnRlbXBsYXRlLm1hcmsuc3R5bGUgPVxudGVtcGxhdGUucm93cy5zdHlsZSA9XG50ZW1wbGF0ZS5jb2RlLnN0eWxlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiByYW5nZVswXSAqIGUuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogZS5jaGFyLmhlaWdodFxuICB9O1xufTtcblxudGVtcGxhdGUuY2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUuY2FyZXQuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6ICtlLmhhc0ZvY3VzLFxuICAgIGxlZnQ6IGUuY2FyZXRQeC54ICsgZS5tYXJnaW5MZWZ0LFxuICAgIHRvcDogZS5jYXJldFB4LnksXG4gICAgaGVpZ2h0OiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUuZ3V0dGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBudWxsO1xufTtcblxudGVtcGxhdGUuZ3V0dGVyLnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogZS5yb3dzICogZS5jaGFyLmhlaWdodCxcbiAgfTtcbn07XG5cbnRlbXBsYXRlLnJ1bGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbnRlbXBsYXRlLnJ1bGVyLnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICAvLyB3aWR0aDogZS5sb25nZXN0TGluZSAqIGUuY2hhci53aWR0aCxcbiAgICBvcGFjaXR5OiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogKChlLnJvd3MgKyBlLnBhZ2UuaGVpZ2h0KSAqIGUuY2hhci5oZWlnaHQpICsgZS5wYWdlUmVtYWluZGVyLmhlaWdodCxcbiAgfTtcbn07XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuLi8uLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL21lcmdlJyk7XG52YXIgdHJpbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90cmltJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuZnVuY3Rpb24gVmlldyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBWaWV3KSkgcmV0dXJuIG5ldyBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpO1xuXG4gIHRoaXMubmFtZSA9IG5hbWU7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG5cbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIHRoaXMubGFzdFVzZWQgPSAwO1xuXG4gIHRoaXNbMF0gPSB0aGlzWzFdID0gLTE7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB0aGlzLmVsLmNsYXNzTmFtZSA9IGNzc1tuYW1lXTtcblxuICB2YXIgc3R5bGUgPSB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMCxcbiAgICBvcGFjaXR5OiAwXG4gIH07XG5cbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzXG4gICYmIH50aGlzLmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVycy5pbmRleE9mKG5hbWUpKSB7XG4gICAgc3R5bGUuYmFja2dyb3VuZCA9ICcjJ1xuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KTtcbiAgfVxuXG4gIGRvbS5zdHlsZSh0aGlzLCBzdHlsZSk7XG59XG5cblZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmICghcmFuZ2UpIHJhbmdlID0gdGhpcztcblxuICB0aGlzLmxhc3RVc2VkID0gRGF0ZS5ub3coKTtcblxuICAvLyBjb25zb2xlLmxvZyh0aGlzLm5hbWUsIHRoaXMudmFsdWUsIGUubGF5b3V0W3RoaXMubmFtZV0sIGRpZmYodGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSkpXG4gIC8vIGlmICghZGlmZih0aGlzLnZhbHVlLCB0aGlzLmVkaXRvci5sYXlvdXRbdGhpcy5uYW1lXSkpIHJldHVybjtcblxuICB2YXIgaHRtbCA9IHRoaXMudGVtcGxhdGUocmFuZ2UsIHRoaXMuZWRpdG9yKTtcbiAgaWYgKGh0bWwgPT09IGZhbHNlKSByZXR1cm4gdGhpcy5zdHlsZSgpO1xuXG4gIHRoaXNbMF0gPSByYW5nZVswXTtcbiAgdGhpc1sxXSA9IHJhbmdlWzFdO1xuICB0aGlzLnZpc2libGUgPSB0cnVlO1xuXG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkge1xuICAvLyAgIHZhciByZXMgPSB0cmltLmVtcHR5TGluZXMoaHRtbClcbiAgLy8gICByYW5nZVswXSArPSByZXMubGVhZGluZztcbiAgLy8gICBodG1sID0gcmVzLnN0cmluZztcbiAgLy8gfVxuXG4gIGlmIChodG1sKSBkb20uaHRtbCh0aGlzLCBodG1sKTtcbiAgZWxzZSBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUgfHwgJ2Jsb2NrJyA9PT0gdGhpcy5uYW1lKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdyZW5kZXInLCB0aGlzLm5hbWUpXG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblZpZXcucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdFVzZWQgPSBEYXRlLm5vdygpO1xuICBkb20uc3R5bGUodGhpcywgdGhpcy50ZW1wbGF0ZS5zdHlsZSh0aGlzLCB0aGlzLmVkaXRvcikpO1xufTtcblxuVmlldy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXNbMF0gKyAnLCcgKyB0aGlzWzFdO1xufTtcblxuVmlldy5wcm90b3R5cGUudmFsdWVPZiA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gW3RoaXNbMF0sIHRoaXNbMV1dO1xufTtcblxuVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnZpc2libGUpIHJldHVybjtcbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIC8vIGRvbS5odG1sKHRoaXMsICcnKTtcbiAgZG9tLnN0eWxlKHRoaXMsIHsgdG9wOiAwLCBoZWlnaHQ6IDAsIG9wYWNpdHk6IDAgfSk7XG59O1xuIl19
