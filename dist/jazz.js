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
  var text = this.buffer.getArea(area);
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

  var key = this.buffer.getArea(area);
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

},{"./lib/area":2,"./lib/bind-raf":4,"./lib/box":5,"./lib/clone":6,"./lib/debounce":7,"./lib/dialog":8,"./lib/diff":10,"./lib/dom":11,"./lib/event":12,"./lib/merge":14,"./lib/point":16,"./lib/range":19,"./lib/regexp":20,"./lib/set-immediate":22,"./lib/throttle":23,"./src/file":31,"./src/history":32,"./src/input":34,"./src/input/bindings":33,"./src/input/text":36,"./src/move":37,"./src/style.css":38,"./src/theme":39,"./src/views":43}],2:[function(require,module,exports){
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
var Segments = require('./segments');
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

},{"../../lib/area":2,"../../lib/event":12,"../../lib/point":16,"../../lib/regexp":20,"./segments":27,"./skipstring":28,"./syntax":29,"./tokens":30}],26:[function(require,module,exports){
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

},{"../../lib/binary-search":3}],27:[function(require,module,exports){
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

},{"../../lib/binary-search":3,"../../lib/point":16,"./tokens":30}],28:[function(require,module,exports){
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

},{}],29:[function(require,module,exports){
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

},{"../../lib/regexp":20}],30:[function(require,module,exports){
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
    curly: factory(),
    square: factory(),
    parens: factory(),
    segments: factory(),
  };

  this.collection = {
    '\n': t.lines,
    '{': t.curly,
    '}': t.curly,
    '[': t.square,
    ']': t.square,
    '(': t.parens,
    ')': t.parens,
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

},{"./parts":26}],31:[function(require,module,exports){
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

},{"../lib/event":12,"../lib/open":15,"../lib/save":21,"./buffer":25}],32:[function(require,module,exports){
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

},{"../lib/debounce":7,"../lib/event":12}],33:[function(require,module,exports){
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

},{"../../lib/throttle":23}],34:[function(require,module,exports){
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

},{"../../lib/event":12,"./mouse":35,"./text":36}],35:[function(require,module,exports){
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

},{"../../lib/debounce":7,"../../lib/event":12,"../../lib/point":16}],36:[function(require,module,exports){
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

},{"../../lib/debounce":7,"../../lib/dom":11,"../../lib/event":12,"../../lib/throttle":23}],37:[function(require,module,exports){
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

},{"../lib/event":12,"../lib/point":16,"../lib/regexp":20}],38:[function(require,module,exports){
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
},{}],39:[function(require,module,exports){
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


},{"../lib/dom":11,"./style.css":38}],40:[function(require,module,exports){
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

},{"./layer":44,"./template":47}],41:[function(require,module,exports){
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

},{"../../lib/dom":11,"../../lib/range":19,"./layer":44,"./template":47}],42:[function(require,module,exports){
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

},{"./layer":44,"./template":47}],43:[function(require,module,exports){
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

  this.block.render = debounce(this.block.render, 60);

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

},{"../../lib/debounce":7,"./block":40,"./code":41,"./find":42,"./mark":45,"./rows":46,"./template":47,"./view":48}],44:[function(require,module,exports){
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

},{"../../lib/dom":11,"../../lib/event":12,"../../lib/range":19,"../style.css":38,"./view":48}],45:[function(require,module,exports){
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

},{"../../lib/dom":11,"../../lib/range":19,"./layer":44,"./template":47}],46:[function(require,module,exports){
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

},{"./layer":44,"./template":47}],47:[function(require,module,exports){
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
  var html = e.syntax.entities(above) + '<mark>' + e.syntax.entities(middle) + '</mark>';

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
          + 'left:' + ((r.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.gutter + e.options.margin_left) + 'px;'
          + '"></i>';
  }

  return html;
};

template.block = function(range, e) {
  if (e.editing) return '';

  var offset = e.buffer.getLineOffset(range[0]);
  var target = e.buffer.getPoint(e.caret).offset;
  var code = e.buffer.getLineRangeText(range);
  var i = target - offset;
  var char;

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

  var open;
  var close;

  var count = 1;
  i -= 1;
  while (i > 0) {
    char = code[i];
    open = Open[char];
    if (Close[char]) count++;
    if (open && !--count) break;
    i--;
  }

  if (!open) return '';

  var begin = e.buffer.getOffsetPoint(i + offset);

  count = 1;
  i += 1;

  while (i < code.length) {
    char = code[i];
    close = Close[char];
    if (Open[char] === open) count++;
    if (open === close) count--;

    if (!count) break;
    i++;
  }

  if (!close) return ' ';

  var end = e.buffer.getOffsetPoint(i + offset);


  var html = '';
  var tabs;

  tabs = e.getPointTabs(begin);

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (begin.y * e.char.height) + 'px;'
        + 'left:' + ((begin.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.gutter + e.options.margin_left) + 'px;'
        + '"></i>';

  tabs = e.getPointTabs(end);

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (end.y * e.char.height) + 'px;'
        + 'left:' + ((end.x + tabs.tabs * e.tabSize - tabs.remainder) * e.char.width + e.gutter + e.options.margin_left) + 'px;'
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

},{}],48:[function(require,module,exports){
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

},{"../../lib/diff":10,"../../lib/dom":11,"../../lib/merge":14,"../../lib/trim":24,"../style.css":38}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2JpbmFyeS1zZWFyY2guanMiLCJsaWIvYmluZC1yYWYuanMiLCJsaWIvYm94LmpzIiwibGliL2Nsb25lLmpzIiwibGliL2RlYm91bmNlLmpzIiwibGliL2RpYWxvZy9pbmRleC5qcyIsImxpYi9kaWFsb2cvc3R5bGUuY3NzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS5qcyIsImxpYi9yZWdleHAuanMiLCJsaWIvc2F2ZS5qcyIsImxpYi9zZXQtaW1tZWRpYXRlLmpzIiwibGliL3Rocm90dGxlLmpzIiwibGliL3RyaW0uanMiLCJzcmMvYnVmZmVyL2luZGV4LmpzIiwic3JjL2J1ZmZlci9wYXJ0cy5qcyIsInNyYy9idWZmZXIvc2VnbWVudHMuanMiLCJzcmMvYnVmZmVyL3NraXBzdHJpbmcuanMiLCJzcmMvYnVmZmVyL3N5bnRheC5qcyIsInNyYy9idWZmZXIvdG9rZW5zLmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4NUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25NQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUxBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6VEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9RQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlMQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0lBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBKYXp6XG4gKi9cblxudmFyIERlZmF1bHRPcHRpb25zID0ge1xuICB0aGVtZTogJ3dlc3Rlcm4nLFxuICBkZWJ1Z19sYXllcnM6IGZhbHNlLFxuICBzY3JvbGxfc3BlZWQ6IDk1LFxuICBoaWRlX3Jvd3M6IGZhbHNlLFxuICBjZW50ZXI6IGZhbHNlLFxuICBtYXJnaW5fbGVmdDogMTUsXG4gIGd1dHRlcl9tYXJnaW46IDIwLFxufTtcblxucmVxdWlyZSgnLi9saWIvc2V0LWltbWVkaWF0ZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL2xpYi9tZXJnZScpO1xudmFyIGNsb25lID0gcmVxdWlyZSgnLi9saWIvY2xvbmUnKTtcbnZhciBiaW5kUmFmID0gcmVxdWlyZSgnLi9saWIvYmluZC1yYWYnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuL2xpYi90aHJvdHRsZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuL2xpYi9yZWdleHAnKTtcbnZhciBEaWFsb2cgPSByZXF1aXJlKCcuL2xpYi9kaWFsb2cnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4vbGliL3BvaW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuL2xpYi9yYW5nZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuL2xpYi9hcmVhJyk7XG52YXIgQm94ID0gcmVxdWlyZSgnLi9saWIvYm94Jyk7XG5cbnZhciBEZWZhdWx0QmluZGluZ3MgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC9iaW5kaW5ncycpO1xudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcbnZhciB0aGVtZSA9IHJlcXVpcmUoJy4vc3JjL3RoZW1lJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zcmMvc3R5bGUuY3NzJyk7XG5cbnZhciBORVdMSU5FID0gUmVnZXhwLmNyZWF0ZShbJ25ld2xpbmUnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBKYXp6O1xuXG5mdW5jdGlvbiBKYXp6KG9wdGlvbnMpIHtcbiAgdGhpcy5vcHRpb25zID0gbWVyZ2UoY2xvbmUoRGVmYXVsdE9wdGlvbnMpLCBvcHRpb25zIHx8IHt9KTtcblxuICBPYmplY3QuYXNzaWduKHRoaXMsIHtcbiAgICBlbDogZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpLFxuXG4gICAgaWQ6ICdqYXp6XycgKyAoTWF0aC5yYW5kb20oKSAqIDEwZTYgfCAwKS50b1N0cmluZygzNiksXG4gICAgZmlsZTogbmV3IEZpbGUsXG4gICAgbW92ZTogbmV3IE1vdmUodGhpcyksXG4gICAgdmlld3M6IG5ldyBWaWV3cyh0aGlzKSxcbiAgICBpbnB1dDogbmV3IElucHV0KHRoaXMpLFxuICAgIGhpc3Rvcnk6IG5ldyBIaXN0b3J5KHRoaXMpLFxuXG4gICAgYmluZGluZ3M6IHsgc2luZ2xlOiB7fSB9LFxuXG4gICAgZmluZDogbmV3IERpYWxvZygnRmluZCcsIFRleHQubWFwKSxcbiAgICBmaW5kVmFsdWU6ICcnLFxuICAgIGZpbmROZWVkbGU6IDAsXG4gICAgZmluZFJlc3VsdHM6IFtdLFxuXG4gICAgc2Nyb2xsOiBuZXcgUG9pbnQsXG4gICAgb2Zmc2V0OiBuZXcgUG9pbnQsXG4gICAgc2l6ZTogbmV3IEJveCxcbiAgICBjaGFyOiBuZXcgQm94LFxuXG4gICAgcGFnZTogbmV3IEJveCxcbiAgICBwYWdlUG9pbnQ6IG5ldyBQb2ludCxcbiAgICBwYWdlUmVtYWluZGVyOiBuZXcgQm94LFxuICAgIHBhZ2VCb3VuZHM6IG5ldyBSYW5nZSxcblxuICAgIGxvbmdlc3RMaW5lOiAwLFxuICAgIGd1dHRlcjogMCxcbiAgICBjb2RlOiAwLFxuICAgIHJvd3M6IDAsXG5cbiAgICB0YWJTaXplOiAyLFxuICAgIHRhYjogJyAgJyxcblxuICAgIGNhcmV0OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuICAgIGNhcmV0UHg6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG5cbiAgICBoYXNGb2N1czogZmFsc2UsXG5cbiAgICBtYXJrOiBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgICB9KSxcblxuICAgIGVkaXRpbmc6IGZhbHNlLFxuICAgIGVkaXRMaW5lOiAtMSxcbiAgICBlZGl0UmFuZ2U6IFstMSwtMV0sXG4gICAgZWRpdFNoaWZ0OiAwLFxuXG4gICAgc3VnZ2VzdEluZGV4OiAwLFxuICAgIHN1Z2dlc3RSb290OiAnJyxcbiAgICBzdWdnZXN0Tm9kZXM6IFtdLFxuXG4gICAgYW5pbWF0aW9uRnJhbWU6IC0xLFxuICAgIGFuaW1hdGlvblJ1bm5pbmc6IGZhbHNlLFxuICAgIGFuaW1hdGlvblNjcm9sbFRhcmdldDogbnVsbCxcbiAgfSk7XG5cbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXdzLmNhcmV0LCB0aGlzLmlucHV0LnRleHQpO1xuICBkb20uYXBwZW5kKHRoaXMsIHRoaXMudmlld3MpO1xuXG4gIC8vIHVzZWZ1bCBzaG9ydGN1dHNcbiAgdGhpcy5idWZmZXIgPSB0aGlzLmZpbGUuYnVmZmVyO1xuICB0aGlzLmJ1ZmZlci5tYXJrID0gdGhpcy5tYXJrO1xuICB0aGlzLnN5bnRheCA9IHRoaXMuYnVmZmVyLnN5bnRheDtcblxuICB0aGVtZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuXG4gIHRoaXMuYmluZE1ldGhvZHMoKTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSmF6ei5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5KYXp6LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCwgc2Nyb2xsRWwpIHtcbiAgaWYgKHRoaXMucmVmKSB7XG4gICAgdGhpcy5lbC5yZW1vdmVBdHRyaWJ1dGUoJ2lkJyk7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKGNzcy5lZGl0b3IpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICAgIHRoaXMub2ZmU2Nyb2xsKCk7XG4gICAgdGhpcy5yZWYuZm9yRWFjaChyZWYgPT4ge1xuICAgICAgZG9tLmFwcGVuZChlbCwgcmVmKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnJlZiA9IFtdLnNsaWNlLmNhbGwodGhpcy5lbC5jaGlsZHJlbik7XG4gICAgZG9tLmFwcGVuZChlbCwgdGhpcy5lbCk7XG4gICAgZG9tLm9ucmVzaXplKHRoaXMub25SZXNpemUpO1xuICB9XG5cbiAgdGhpcy5lbCA9IGVsO1xuICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnaWQnLCB0aGlzLmlkKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKGNzcy5lZGl0b3IpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgdGhpcy5vZmZTY3JvbGwgPSBkb20ub25zY3JvbGwoc2Nyb2xsRWwgfHwgdGhpcy5lbCwgdGhpcy5vblNjcm9sbCk7XG4gIHRoaXMuaW5wdXQudXNlKHRoaXMuZWwpO1xuXG4gIHNldFRpbWVvdXQodGhpcy5yZXBhaW50LCAwKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmFzc2lnbiA9IGZ1bmN0aW9uKGJpbmRpbmdzKSB7XG4gIHRoaXMuYmluZGluZ3MgPSBiaW5kaW5ncztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5maWxlLm9wZW4ocGF0aCwgcm9vdCwgZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICB0aGlzLmZpbGUuc2F2ZShmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCwgcGF0aCkge1xuICB0aGlzLmZpbGUuc2V0KHRleHQpO1xuICB0aGlzLmZpbGUucGF0aCA9IHBhdGggfHwgdGhpcy5maWxlLnBhdGg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgc2V0SW1tZWRpYXRlKHRoaXMuaW5wdXQuZm9jdXMpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgc2V0SW1tZWRpYXRlKHRoaXMuaW5wdXQuYmx1cik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZE1ldGhvZHMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUuYmluZCh0aGlzKTtcbiAgdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbiA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4uYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrU2V0ID0gdGhpcy5tYXJrU2V0LmJpbmQodGhpcyk7XG4gIHRoaXMubWFya0NsZWFyID0gdGhpcy5tYXJrQ2xlYXIuYmluZCh0aGlzKTtcbiAgdGhpcy5yZXBhaW50ID0gdGhpcy5yZXBhaW50LmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kSGFuZGxlcnMgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgbWV0aG9kIGluIHRoaXMpIHtcbiAgICBpZiAoJ29uJyA9PT0gbWV0aG9kLnNsaWNlKDAsIDIpKSB7XG4gICAgICB0aGlzW21ldGhvZF0gPSB0aGlzW21ldGhvZF0uYmluZCh0aGlzKTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJpbmRIYW5kbGVycygpXG4gIHRoaXMubW92ZS5vbignbW92ZScsIHRoaXMub25Nb3ZlKTtcbiAgdGhpcy5maWxlLm9uKCdyYXcnLCB0aGlzLm9uRmlsZVJhdyk7IC8vVE9ETzogc2hvdWxkIG5vdCBuZWVkIHRoaXMgZXZlbnRcbiAgdGhpcy5maWxlLm9uKCdzZXQnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuZmlsZS5vbignb3BlbicsIHRoaXMub25GaWxlT3Blbik7XG4gIHRoaXMuZmlsZS5vbignY2hhbmdlJywgdGhpcy5vbkZpbGVDaGFuZ2UpO1xuICB0aGlzLmZpbGUub24oJ2JlZm9yZSBjaGFuZ2UnLCB0aGlzLm9uQmVmb3JlRmlsZUNoYW5nZSk7XG4gIHRoaXMuaGlzdG9yeS5vbignY2hhbmdlJywgdGhpcy5vbkhpc3RvcnlDaGFuZ2UpO1xuICB0aGlzLmlucHV0Lm9uKCdibHVyJywgdGhpcy5vbkJsdXIpO1xuICB0aGlzLmlucHV0Lm9uKCdmb2N1cycsIHRoaXMub25Gb2N1cyk7XG4gIHRoaXMuaW5wdXQub24oJ2lucHV0JywgdGhpcy5vbklucHV0KTtcbiAgdGhpcy5pbnB1dC5vbigndGV4dCcsIHRoaXMub25UZXh0KTtcbiAgdGhpcy5pbnB1dC5vbigna2V5cycsIHRoaXMub25LZXlzKTtcbiAgdGhpcy5pbnB1dC5vbigna2V5JywgdGhpcy5vbktleSk7XG4gIHRoaXMuaW5wdXQub24oJ2N1dCcsIHRoaXMub25DdXQpO1xuICB0aGlzLmlucHV0Lm9uKCdjb3B5JywgdGhpcy5vbkNvcHkpO1xuICB0aGlzLmlucHV0Lm9uKCdwYXN0ZScsIHRoaXMub25QYXN0ZSk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNldXAnLCB0aGlzLm9uTW91c2VVcCk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWNsaWNrJywgdGhpcy5vbk1vdXNlQ2xpY2spO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWdiZWdpbicsIHRoaXMub25Nb3VzZURyYWdCZWdpbik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZycsIHRoaXMub25Nb3VzZURyYWcpO1xuICB0aGlzLmZpbmQub24oJ3N1Ym1pdCcsIHRoaXMuZmluZEp1bXAuYmluZCh0aGlzLCAxKSk7XG4gIHRoaXMuZmluZC5vbigndmFsdWUnLCB0aGlzLm9uRmluZFZhbHVlKTtcbiAgdGhpcy5maW5kLm9uKCdrZXknLCB0aGlzLm9uRmluZEtleSk7XG4gIHRoaXMuZmluZC5vbignb3BlbicsIHRoaXMub25GaW5kT3Blbik7XG4gIHRoaXMuZmluZC5vbignY2xvc2UnLCB0aGlzLm9uRmluZENsb3NlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uU2Nyb2xsID0gZnVuY3Rpb24oc2Nyb2xsKSB7XG4gIHRoaXMuc2Nyb2xsLnNldChzY3JvbGwpO1xuICBpZiAoIXRoaXMuZWRpdGluZykgdGhpcy5yZW5kZXIoKTtcbiAgdGhpcy5yZXN0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXN0ID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICB0aGlzLnJlbmRlcigpO1xufSwgMzAwKTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3ZlID0gZnVuY3Rpb24ocG9pbnQsIGJ5RWRpdCkge1xuICBpZiAoIWJ5RWRpdCkgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIGlmIChwb2ludCkgdGhpcy5zZXRDYXJldChwb2ludCk7XG5cbiAgaWYgKCFieUVkaXQpIHtcbiAgICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCB8fCB0aGlzLmlucHV0Lm1vdXNlLmRvd24pIHRoaXMubWFya1NldCgpO1xuICAgIGVsc2UgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgfVxuXG4gIHRoaXMuZW1pdCgnbW92ZScpO1xuICBpZiAoIXRoaXMuZWRpdGluZykgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Gb2N1cyA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IHRydWU7XG4gIHRoaXMuZW1pdCgnZm9jdXMnKTtcbiAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmx1ciA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IGZhbHNlO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHtcbiAgICAgIHRoaXMuZW1pdCgnYmx1cicpO1xuICAgICAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgICB9XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKGtleXMgaW4gdGhpcy5iaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5cyBpbiBEZWZhdWx0QmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmIChrZXkgaW4gdGhpcy5iaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleSBpbiBEZWZhdWx0QmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHRoaXMub25Db3B5KGUpO1xuICB0aGlzLmRlbGV0ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Db3B5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgZS5jbGlwYm9hcmREYXRhLnNldERhdGEoJ3RleHQvcGxhaW4nLCB0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIHZhciB0ZXh0ID0gZS5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubW92ZS5iZWdpbk9mRmlsZSgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVJhdyA9IGZ1bmN0aW9uKHJhdykge1xuICB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRUYWJNb2RlID0gZnVuY3Rpb24oY2hhcikge1xuICBpZiAoJ1xcdCcgPT09IGNoYXIpIHtcbiAgICB0aGlzLnRhYiA9IGNoYXI7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy50YWIgPSBuZXcgQXJyYXkodGhpcy50YWJTaXplICsgMSkuam9pbihjaGFyKTtcbiAgfVxufVxuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVTZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldCh7IHg6MCwgeTowIH0pO1xuICAvLyB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcbiAgLy8gdGhpcy5zZXRUYWJNb2RlKHRoaXMuYnVmZmVyLnN5bnRheC50YWIpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25IaXN0b3J5Q2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXIoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAvLyB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLmVkaXRDYXJldEJlZm9yZSA9IHRoaXMuY2FyZXQuY29weSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICAvLyB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuXG4gIHRoaXMudmlld3MuY29kZS5yZW5kZXJFZGl0KHtcbiAgICBsaW5lOiBlZGl0UmFuZ2VbMF0sXG4gICAgcmFuZ2U6IGVkaXRSYW5nZSxcbiAgICBzaGlmdDogZWRpdFNoaWZ0LFxuICAgIGNhcmV0Tm93OiB0aGlzLmNhcmV0LFxuICAgIGNhcmV0QmVmb3JlOiB0aGlzLmVkaXRDYXJldEJlZm9yZVxuICB9KTtcblxuICB0aGlzLnJlbmRlcigpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldEZyb21QeCA9IGZ1bmN0aW9uKHB4KSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5tYXJnaW5MZWZ0LCB5OiB0aGlzLmNoYXIuaGVpZ2h0LzIgfSlbJysnXSh0aGlzLm9mZnNldCk7XG4gIHZhciBwID0gcHhbJy0nXShnKVsnKyddKHRoaXMuc2Nyb2xsKVsnby8nXSh0aGlzLmNoYXIpO1xuXG4gIHAueSA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueSwgdGhpcy5idWZmZXIubG9jKCkpKTtcbiAgcC54ID0gTWF0aC5tYXgoMCwgcC54KTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0Q29vcmRzVGFicyhwKTtcblxuICBwLnggPSBNYXRoLm1heChcbiAgICAwLFxuICAgIE1hdGgubWluKFxuICAgICAgcC54IC0gdGFicy50YWJzICsgdGFicy5yZW1haW5kZXIsXG4gICAgICB0aGlzLmdldExpbmVMZW5ndGgocC55KVxuICAgIClcbiAgKTtcblxuICB0aGlzLnNldENhcmV0KHApO1xuICB0aGlzLm1vdmUubGFzdERlbGliZXJhdGVYID0gcC54O1xuICB0aGlzLm9uTW92ZSgpO1xuXG4gIHJldHVybiBwO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZVVwID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykgdGhpcy5ibHVyKCk7XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURvd24gPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCh0aGlzLmZvY3VzLmJpbmQodGhpcyksIDEwKTtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQpIHRoaXMubWFya0JlZ2luKCk7XG4gIGVsc2UgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLmNhcmV0LnNldChwKTtcblxuICB2YXIgdGFicyA9IHRoaXMuZ2V0UG9pbnRUYWJzKHRoaXMuY2FyZXQpO1xuXG4gIHRoaXMuY2FyZXRQeC5zZXQoe1xuICAgIHg6IHRoaXMuY2hhci53aWR0aCAqICh0aGlzLmNhcmV0LnggKyB0YWJzLnRhYnMgKiB0aGlzLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlciksXG4gICAgeTogdGhpcy5jaGFyLmhlaWdodCAqIHRoaXMuY2FyZXQueVxuICB9KTtcblxuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBcmVhQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICAgIC8vIHRoaXMucmVuZGVyKCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gUmFuZ2UuY2xhbXAocmFuZ2UsIHRoaXMucGFnZUJvdW5kcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcCA9IHRoaXMuc2Nyb2xsWydfLyddKHRoaXMuY2hhcik7XG4gIHJldHVybiB0aGlzLmdldFJhbmdlKFtcbiAgICBNYXRoLmZsb29yKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVswXSksXG4gICAgTWF0aC5jZWlsKHAueSArIHRoaXMucGFnZS5oZWlnaHQgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMV0pXG4gIF0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHAgPSB0aGlzLmNhcmV0UHg7XG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdmFyIHRvcCA9IHMueSAtIHAueTtcbiAgdmFyIGJvdHRvbSA9IChwLnkpIC0gKHMueSArIHRoaXMuc2l6ZS5oZWlnaHQpICsgdGhpcy5jaGFyLmhlaWdodDtcblxuICB2YXIgbGVmdCA9IChzLnggKyB0aGlzLmNoYXIud2lkdGgpIC0gcC54O1xuICB2YXIgcmlnaHQgPSAocC54KSAtIChzLnggKyB0aGlzLnNpemUud2lkdGggLSB0aGlzLm1hcmdpbkxlZnQpICsgdGhpcy5jaGFyLndpZHRoICogMjtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICAvLyBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZylcbiAgaWYgKGxlZnQgKyB0b3AgKyByaWdodCArIGJvdHRvbSkge1xuICAgIHRoaXMuc2Nyb2xsQnkocmlnaHQgLSBsZWZ0LCBib3R0b20gLSB0b3ApO1xuICB9XG4gIC8vIGVsc2VcbiAgICAvLyB0aGlzLmFuaW1hdGVTY3JvbGxCeShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB2YXIgdGFyZ2V0ID0gUG9pbnQubG93KHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfSwge1xuICAgIHg6IHRoaXMuc2Nyb2xsLnggKyB4LFxuICAgIHk6IHRoaXMuc2Nyb2xsLnkgKyB5XG4gIH0pO1xuXG4gIGlmIChQb2ludC5zb3J0KHRhcmdldCwgdGhpcy5zY3JvbGwpICE9PSAwKSB7XG4gICAgdGhpcy5zY3JvbGwuc2V0KHRhcmdldCk7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKCh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0LCBNYXRoLm1heCgwLCBzLnkgKyB5KSlcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoKGFkeCA8IDEgJiYgYWR5IDwgMSkgfHwgIXRoaXMuYW5pbWF0aW9uUnVubmluZykge1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQpO1xuICAgIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2FuaW1hdGlvbiBlbmQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBpZiAoYWR4IDwgc3BlZWQpIGR4ICo9IDAuOTtcbiAgZWxzZSBkeCA9IE1hdGguc2lnbihkeCkgKiBzcGVlZDtcblxuICBpZiAoYWR5IDwgc3BlZWQpIGR5ICo9IDAuOTtcbiAgZWxzZSBkeSA9IE1hdGguc2lnbihkeSkgKiBzcGVlZDtcblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLmRlbGV0ZSgpO1xuXG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQodGhpcy5jYXJldC55KTtcbiAgdmFyIHJpZ2h0ID0gbGluZVt0aGlzLmNhcmV0LnhdO1xuICB2YXIgaGFzUmlnaHRTeW1ib2wgPSB+Wyd9JywnXScsJyknXS5pbmRleE9mKHJpZ2h0KTtcblxuICAvLyBhcHBseSBpbmRlbnQgb24gZW50ZXJcbiAgaWYgKE5FV0xJTkUudGVzdCh0ZXh0KSkge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IHRoaXMuY2FyZXQueCA9PT0gbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBsZWZ0ID0gbGluZVt0aGlzLmNhcmV0LnggLSAxXTtcbiAgICB2YXIgaW5kZW50ID0gbGluZS5tYXRjaCgvXFxTLyk7XG4gICAgaW5kZW50ID0gaW5kZW50ID8gaW5kZW50LmluZGV4IDogbGluZS5sZW5ndGggLSAxO1xuICAgIHZhciBoYXNMZWZ0U3ltYm9sID0gflsneycsJ1snLCcoJ10uaW5kZXhPZihsZWZ0KTtcblxuICAgIGlmIChoYXNMZWZ0U3ltYm9sKSBpbmRlbnQgKz0gMjtcblxuICAgIGlmIChpc0VuZE9mTGluZSB8fCBoYXNMZWZ0U3ltYm9sKSB7XG4gICAgICB0ZXh0ICs9IG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJyk7XG4gICAgfVxuICB9XG5cbiAgdmFyIGxlbmd0aDtcblxuICBpZiAoIWhhc1JpZ2h0U3ltYm9sIHx8IChoYXNSaWdodFN5bWJvbCAmJiAhflsnfScsJ10nLCcpJ10uaW5kZXhPZih0ZXh0KSkpIHtcbiAgICBsZW5ndGggPSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgdGV4dCk7XG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gMTtcbiAgfVxuXG4gIHRoaXMubW92ZS5ieUNoYXJzKGxlbmd0aCwgdHJ1ZSk7XG5cbiAgaWYgKCd7JyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICd9Jyk7XG4gIGVsc2UgaWYgKCcoJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICcpJyk7XG4gIGVsc2UgaWYgKCdbJyA9PT0gdGV4dCkgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICddJyk7XG5cbiAgaWYgKGhhc0xlZnRTeW1ib2wgJiYgaGFzUmlnaHRTeW1ib2wpIHtcbiAgICBpbmRlbnQgLT0gMjtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ1xcbicgKyBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmFja3NwYWNlID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm4gdGhpcy5kZWxldGUoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB0aGlzLnNldENhcmV0KGFyZWEuYmVnaW4pO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUFyZWEoYXJlYSk7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEsIHRydWUpO1xuICAgIHRoaXMuYnVmZmVyLnJlbW92ZUNoYXJBdFBvaW50KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIucmVtb3ZlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJ1ZmZlci5yZW1vdmVDaGFyQXRQb2ludCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZmluZEp1bXAgPSBmdW5jdGlvbihqdW1wKSB7XG4gIGlmICghdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggfHwgIXRoaXMuZmluZC5pc09wZW4pIHJldHVybjtcblxuICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmROZWVkbGUgKyBqdW1wO1xuICBpZiAodGhpcy5maW5kTmVlZGxlID49IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gMDtcbiAgfSBlbHNlIGlmICh0aGlzLmZpbmROZWVkbGUgPCAwKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggLSAxO1xuICB9XG5cbiAgdmFyIHJlc3VsdCA9IHRoaXMuZmluZFJlc3VsdHNbdGhpcy5maW5kTmVlZGxlXTtcbiAgdGhpcy5zZXRDYXJldChyZXN1bHQpO1xuICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5tb3ZlLmJ5Q2hhcnModGhpcy5maW5kVmFsdWUubGVuZ3RoLCB0cnVlKTtcbiAgdGhpcy5tYXJrU2V0KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZFZhbHVlID0gZnVuY3Rpb24odmFsdWUsIG5vSnVtcCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMuZ3V0dGVyLCB5OiAwIH0pO1xuXG4gIHRoaXMuYnVmZmVyLnVwZGF0ZVJhdygpO1xuXG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuXG4gIHRoaXMuZmluZFZhbHVlID0gdmFsdWU7XG4gIC8vIGNvbnNvbGUudGltZSgnZmluZCAnICsgdmFsdWUpO1xuICB0aGlzLmZpbmRSZXN1bHRzID0gdGhpcy5idWZmZXIuaW5kZXhlci5maW5kKHZhbHVlKS5tYXAoKG9mZnNldCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KTtcbiAgICAgIC8vcHg6IG5ldyBQb2ludChwb2ludClbJyonXShlLmNoYXIpWycrJ10oZylcbiAgfSk7XG4gIC8vIGNvbnNvbGUudGltZUVuZCgnZmluZCAnICsgdmFsdWUpO1xuXG4gIHRoaXMuZmluZC5pbmZvKCcwLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG5cbiAgaWYgKCFub0p1bXApIHRoaXMuZmluZEp1bXAoMCk7XG5cbiAgdGhpcy52aWV3cy5maW5kLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuICB0aGlzLmZvY3VzKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zdWdnZXN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmVhID0gdGhpcy5idWZmZXIud29yZEFyZWFBdFBvaW50KHRoaXMuY2FyZXQsIHRydWUpO1xuICBpZiAoIWFyZWEpIHJldHVybjtcblxuICB2YXIga2V5ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgaWYgKCFrZXkpIHJldHVybjtcblxuICBpZiAoIXRoaXMuc3VnZ2VzdFJvb3RcbiAgICB8fCBrZXkuc3Vic3RyKDAsIHRoaXMuc3VnZ2VzdFJvb3QubGVuZ3RoKSAhPT0gdGhpcy5zdWdnZXN0Um9vdCkge1xuICAgIHRoaXMuc3VnZ2VzdEluZGV4ID0gMDtcbiAgICB0aGlzLnN1Z2dlc3RSb290ID0ga2V5O1xuICAgIHRoaXMuc3VnZ2VzdE5vZGVzID0gdGhpcy5idWZmZXIucHJlZml4LmNvbGxlY3Qoa2V5KTtcbiAgfVxuXG4gIGlmICghdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoKSByZXR1cm47XG4gIHZhciBub2RlID0gdGhpcy5zdWdnZXN0Tm9kZXNbdGhpcy5zdWdnZXN0SW5kZXhdO1xuXG4gIHRoaXMuc3VnZ2VzdEluZGV4ID0gKHRoaXMuc3VnZ2VzdEluZGV4ICsgMSkgJSB0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGg7XG5cbiAgcmV0dXJuIHtcbiAgICBhcmVhOiBhcmVhLFxuICAgIG5vZGU6IG5vZGVcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBvaW50VGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZVRleHQocG9pbnQueSk7XG4gIHZhciByZW1haW5kZXIgPSAwO1xuICB2YXIgdGFicyA9IDA7XG4gIHZhciB0YWI7XG4gIHZhciBwcmV2ID0gMDtcbiAgd2hpbGUgKH4odGFiID0gbGluZS5pbmRleE9mKCdcXHQnLCB0YWIgKyAxKSkpIHtcbiAgICBpZiAodGFiID49IHBvaW50LngpIGJyZWFrO1xuICAgIHJlbWFpbmRlciArPSAodGFiIC0gcHJldikgJSB0aGlzLnRhYlNpemU7XG4gICAgdGFicysrO1xuICAgIHByZXYgPSB0YWIgKyAxO1xuICB9XG4gIHJldHVybiB7XG4gICAgdGFiczogdGFicyxcbiAgICByZW1haW5kZXI6IHJlbWFpbmRlciArIHRhYnNcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldENvb3Jkc1RhYnMgPSBmdW5jdGlvbihwb2ludCkge1xuICB2YXIgbGluZSA9IHRoaXMuYnVmZmVyLmdldExpbmVUZXh0KHBvaW50LnkpO1xuICB2YXIgcmVtYWluZGVyID0gMDtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB2YXIgcHJldiA9IDA7XG4gIHdoaWxlICh+KHRhYiA9IGxpbmUuaW5kZXhPZignXFx0JywgdGFiICsgMSkpKSB7XG4gICAgaWYgKHRhYnMgKiB0aGlzLnRhYlNpemUgKyByZW1haW5kZXIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgcmVtYWluZGVyICs9ICh0YWIgLSBwcmV2KSAlIHRoaXMudGFiU2l6ZTtcbiAgICB0YWJzKys7XG4gICAgcHJldiA9IHRhYiArIDE7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB0YWJzOiB0YWJzLFxuICAgIHJlbWFpbmRlcjogcmVtYWluZGVyXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXBhaW50ID0gYmluZFJhZihmdW5jdGlvbigpIHtcbiAgdGhpcy5yZXNpemUoKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn0pO1xuXG5KYXp6LnByb3RvdHlwZS5yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyICQgPSB0aGlzLmVsO1xuXG4gIHRoaXMub2Zmc2V0LnNldChkb20uZ2V0T2Zmc2V0KCQpKTtcbiAgdGhpcy5zY3JvbGwuc2V0KGRvbS5nZXRTY3JvbGwoJCkpO1xuICB0aGlzLnNpemUuc2V0KGRvbS5nZXRTaXplKCQpKTtcblxuICAvLyB0aGlzIGlzIGEgd2VpcmQgZml4IHdoZW4gZG9pbmcgbXVsdGlwbGUgLnVzZSgpXG4gIGlmICh0aGlzLmNoYXIud2lkdGggPT09IDApIHRoaXMuY2hhci5zZXQoZG9tLmdldENoYXJTaXplKCQsIGNzcy5jb2RlKSk7XG5cbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jKCk7XG4gIHRoaXMuY29kZSA9IHRoaXMuYnVmZmVyLnRleHQubGVuZ3RoO1xuICB0aGlzLnBhZ2Uuc2V0KHRoaXMuc2l6ZVsnXi8nXSh0aGlzLmNoYXIpKTtcbiAgdGhpcy5wYWdlUmVtYWluZGVyLnNldCh0aGlzLnNpemVbJy0nXSh0aGlzLnBhZ2VbJ18qJ10odGhpcy5jaGFyKSkpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcbiAgLy8gdGhpcy5sb25nZXN0TGluZSA9IE1hdGgubWluKDUwMCwgdGhpcy5idWZmZXIubGluZXMuZ2V0TG9uZ2VzdExpbmVMZW5ndGgoKSk7XG4gIHRoaXMuZ3V0dGVyID0gTWF0aC5tYXgoXG4gICAgdGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgKHRoaXMub3B0aW9ucy5jZW50ZXJcbiAgICAgID8gKHRoaXMucGFnZS53aWR0aCAtIDgxKSAvIDIgfCAwIDogMClcbiAgICArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzXG4gICAgICA/IDAgOiBNYXRoLm1heCgzLCAoJycrdGhpcy5yb3dzKS5sZW5ndGgpKVxuICApICogdGhpcy5jaGFyLndpZHRoICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogdGhpcy5vcHRpb25zLmd1dHRlcl9tYXJnaW4pO1xuICB0aGlzLm1hcmdpbkxlZnQgPSB0aGlzLmd1dHRlciArIHRoaXMub3B0aW9ucy5tYXJnaW5fbGVmdDtcblxuICAvLyBkb20uc3R5bGUodGhpcy5lbCwge1xuICAvLyAgIHdpZHRoOiB0aGlzLmxvbmdlc3RMaW5lICogdGhpcy5jaGFyLndpZHRoLFxuICAvLyAgIGhlaWdodDogdGhpcy5yb3dzICogdGhpcy5jaGFyLmhlaWdodFxuICAvLyB9KTtcblxuICAvL1RPRE86IG1ha2UgbWV0aG9kL3V0aWxcbiAgLy8gZHJhdyBpbmRlbnQgaW1hZ2VcbiAgdmFyIGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICB2YXIgZm9vID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvbycpO1xuICB2YXIgY3R4ID0gY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG5cbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnd2lkdGgnLCBNYXRoLmNlaWwodGhpcy5jaGFyLndpZHRoICogMikpO1xuICBjYW52YXMuc2V0QXR0cmlidXRlKCdoZWlnaHQnLCB0aGlzLmNoYXIuaGVpZ2h0KTtcblxuICB2YXIgY29tbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2MnKTtcbiAgJC5hcHBlbmRDaGlsZChjb21tZW50KTtcbiAgdmFyIGNvbG9yID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUoY29tbWVudCkuY29sb3I7XG4gICQucmVtb3ZlQ2hpbGQoY29tbWVudCk7XG4gIGN0eC5zZXRMaW5lRGFzaChbMSwxXSk7XG4gIGN0eC5saW5lRGFzaE9mZnNldCA9IDA7XG4gIGN0eC5iZWdpblBhdGgoKTtcbiAgY3R4Lm1vdmVUbygwLDEpO1xuICBjdHgubGluZVRvKDAsIHRoaXMuY2hhci5oZWlnaHQpO1xuICBjdHguc3Ryb2tlU3R5bGUgPSBjb2xvcjtcbiAgY3R4LnN0cm9rZSgpO1xuXG4gIHZhciBkYXRhVVJMID0gY2FudmFzLnRvRGF0YVVSTCgpO1xuXG4gIGRvbS5jc3ModGhpcy5pZCwgYFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLnJ1bGVyfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuZmluZH0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLm1hcmt9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5jb2RlfSB7XG4gICAgICBwYWRkaW5nLWxlZnQ6ICR7dGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0ICsgdGhpcy5ndXR0ZXJ9cHg7XG4gICAgICB0YWItc2l6ZTogJHt0aGlzLnRhYlNpemV9O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3Mucm93c30ge1xuICAgICAgcGFkZGluZy1yaWdodDogJHt0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbn1weDtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdH1weDtcbiAgICAgIHdpZHRoOiAke3RoaXMuZ3V0dGVyfXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuZmluZH0gPiBpLFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5ibG9ja30gPiBpIHtcbiAgICAgIGhlaWdodDogJHt0aGlzLmNoYXIuaGVpZ2h0ICsgMX1weDtcbiAgICB9XG4gICAgeCB7XG4gICAgICBiYWNrZ3JvdW5kLWltYWdlOiB1cmwoJHtkYXRhVVJMfSk7XG4gICAgfWBcbiAgKTtcblxuICB0aGlzLmVtaXQoJ3Jlc2l6ZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuY2xlYXIgPSBiaW5kUmFmKGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnY2xlYXInKVxuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgdGhpcy52aWV3cy5jbGVhcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlbmRlciA9IGJpbmRSYWYoZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdyZW5kZXInKVxuICB0aGlzLnZpZXdzLnJlbmRlcigpO1xufSk7XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gJycgKyBhLmJlZ2luICsgJy0nICsgYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGJpbmFyeVNlYXJjaDtcblxuZnVuY3Rpb24gYmluYXJ5U2VhcmNoKGFycmF5LCBjb21wYXJlKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgbG93ID0gMDtcbiAgdmFyIGhpZ2ggPSBhcnJheS5sZW5ndGg7XG4gIGlmICghaGlnaCkgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiAwXG4gIH07XG5cbiAgZG8ge1xuICAgIHByZXYgPSBpbmRleDtcbiAgICBpbmRleCA9IGxvdyArIChoaWdoIC0gbG93ID4+IDEpO1xuICAgIHZhciBpdGVtID0gYXJyYXlbaW5kZXhdO1xuICAgIHZhciByZXN1bHQgPSBjb21wYXJlKGl0ZW0pO1xuXG4gICAgaWYgKHJlc3VsdCkgbG93ID0gaW5kZXg7XG4gICAgZWxzZSBoaWdoID0gaW5kZXg7XG4gIH0gd2hpbGUgKHByZXYgIT09IGluZGV4KTtcblxuICBpZiAoaXRlbSAhPSBudWxsKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICBpbmRleDogaW5kZXhcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBpdGVtOiBudWxsLFxuICAgIGluZGV4OiB+bG93ICogLTEgLSAxXG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuICByZXR1cm4gZnVuY3Rpb24gcmFmV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKHJlcXVlc3QpO1xuICAgIHJlcXVlc3QgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCkpO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfLyddID1cbkJveC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXi8nXSA9XG5Cb3gucHJvdG90eXBlLmNlaWxkaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWycqJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydvKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGgucm91bmQodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLnJvdW5kKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJy0nXSA9XG5Cb3gucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC0gKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjbG9uZShvYmopIHtcbiAgdmFyIG8gPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHZhciB2YWwgPSBvYmpba2V5XTtcbiAgICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiB2YWwpIHtcbiAgICAgIG9ba2V5XSA9IGNsb25lKHZhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ba2V5XSA9IHZhbDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG87XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24gZGVib3VuY2VXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgdGltZW91dCA9IHNldFRpbWVvdXQoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSwgbXMpO1xuICAgIHJldHVybiB0aW1lb3V0O1xuICB9XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vZXZlbnQnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpYWxvZztcblxuZnVuY3Rpb24gRGlhbG9nKGxhYmVsLCBrZXltYXApIHtcbiAgdGhpcy5ub2RlID0gZG9tKGNzcy5kaWFsb2csIFtcbiAgICBgPGxhYmVsPiR7Y3NzLmxhYmVsfWAsXG4gICAgW2Nzcy5pbnB1dCwgW1xuICAgICAgYDxpbnB1dD4ke2Nzcy50ZXh0fWAsXG4gICAgICBjc3MuaW5mb1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmxhYmVsXSwgbGFiZWwpO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25jbGljayA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNlZG93biA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbn1cblxuRGlhbG9nLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbmZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbihlKSB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmhhc0ZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgZG9tLmFwcGVuZChkb2N1bWVudC5ib2R5LCB0aGlzLm5vZGUpO1xuICBkb20uZm9jdXModGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmluZm8gPSBmdW5jdGlvbihpbmZvKSB7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgaW5mbyk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJkaWFsb2dcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19kaWFsb2dcIixcImlucHV0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5wdXRcIixcInRleHRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX190ZXh0XCIsXCJsYWJlbFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2xhYmVsXCIsXCJpbmZvXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5mb1wifSIsIlxubW9kdWxlLmV4cG9ydHMgPSBkaWZmO1xuXG5mdW5jdGlvbiBkaWZmKGEsIGIpIHtcbiAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgYSkge1xuICAgIHZhciBkID0ge307XG4gICAgdmFyIGkgPSAwO1xuICAgIGZvciAodmFyIGsgaW4gYikge1xuICAgICAgaWYgKGFba10gIT09IGJba10pIHtcbiAgICAgICAgZFtrXSA9IGJba107XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGkpIHJldHVybiBkO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhICE9PSBiO1xuICB9XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG52YXIgYmluZFJhZiA9IHJlcXVpcmUoJy4vYmluZC1yYWYnKTtcbnZhciBtZW1vaXplID0gcmVxdWlyZSgnLi9tZW1vaXplJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWUuc3BsaXQoJyAnKVswXVxuICAgIH07XG4gICAgZG9tLmNsYXNzZXMobm9kZSwgbmFtZS5zcGxpdCgnICcpLnNsaWNlKDEpKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59LCBkaWZmLCBtZXJnZSwgZnVuY3Rpb24obm9kZSwgc3R5bGUpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIHN0eWxlXTtcbn0pO1xuXG4vKlxuZG9tLnN0eWxlID0gZnVuY3Rpb24oZWwsIHN0eWxlKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn07XG4qL1xuZG9tLmNsYXNzZXMgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xufSwgbnVsbCwgbnVsbCwgZnVuY3Rpb24obm9kZSwgY2xhc3Nlcykge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgY2xhc3Nlcy5jb25jYXQobm9kZS5uYW1lKS5maWx0ZXIoQm9vbGVhbikuam9pbignICcpXTtcbn0pO1xuXG5kb20uYXR0cnMgPSBmdW5jdGlvbihlbCwgYXR0cnMpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIE9iamVjdC5hc3NpZ24oZWwsIGF0dHJzKTtcbn07XG5cbmRvbS5odG1sID0gZnVuY3Rpb24oZWwsIGh0bWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XG59O1xuXG5kb20udGV4dCA9IGZ1bmN0aW9uKGVsLCB0ZXh0KSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC50ZXh0Q29udGVudCA9IHRleHQ7XG59O1xuXG5kb20uZm9jdXMgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuZm9jdXMoKTtcbn07XG5cbmRvbS5nZXRTaXplID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiB7XG4gICAgd2lkdGg6IGVsLmNsaWVudFdpZHRoLFxuICAgIGhlaWdodDogZWwuY2xpZW50SGVpZ2h0XG4gIH07XG59O1xuXG5kb20uZ2V0Q2hhclNpemUgPSBmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgc3Bhbi5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG5cbiAgZWwuYXBwZW5kQ2hpbGQoc3Bhbik7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICc7XG4gIHZhciBhID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgIFxcbiAnO1xuICB2YXIgYiA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgZWwucmVtb3ZlQ2hpbGQoc3Bhbik7XG5cbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogKGIud2lkdGggLSBhLndpZHRoKSxcbiAgICBoZWlnaHQ6IChiLmhlaWdodCAtIGEuaGVpZ2h0KVxuICB9O1xufTtcblxuZG9tLmdldE9mZnNldCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB2YXIgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCk7XG4gIHZhciBib3JkZXJMZWZ0ID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyTGVmdFdpZHRoKTtcbiAgdmFyIGJvcmRlclRvcCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlclRvcFdpZHRoKTtcbiAgcmV0dXJuIFBvaW50Lmxvdyh7IHg6IDAsIHk6IDAgfSwge1xuICAgIHg6IChyZWN0LmxlZnQgKyBib3JkZXJMZWZ0KSB8IDAsXG4gICAgeTogKHJlY3QudG9wICsgYm9yZGVyVG9wKSB8IDBcbiAgfSk7XG59O1xuXG5kb20uZ2V0U2Nyb2xsID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiBnZXRTY3JvbGwoZWwpO1xufTtcblxuZG9tLm9uc2Nyb2xsID0gZnVuY3Rpb24gb25zY3JvbGwoZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuXG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9IGVsc2Uge1xuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlcihldikge1xuICAgIGZuKGdldFNjcm9sbChlbCkpO1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9mZnNjcm9sbCgpIHtcbiAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxufTtcblxuZG9tLm9ub2Zmc2V0ID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB3aGlsZSAoZWwgPSBlbC5vZmZzZXRQYXJlbnQpIHtcbiAgICBkb20ub25zY3JvbGwoZWwsIGZuKTtcbiAgfVxufTtcblxuZG9tLm9uY2xpY2sgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgcmV0dXJuIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZm4pO1xufTtcblxuZG9tLm9ucmVzaXplID0gZnVuY3Rpb24oZm4pIHtcbiAgcmV0dXJuIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG59O1xuXG5kb20uYXBwZW5kID0gZnVuY3Rpb24odGFyZ2V0LCBzcmMsIGRpY3QpIHtcbiAgdGFyZ2V0ID0gZG9tLmdldEVsZW1lbnQodGFyZ2V0KTtcbiAgaWYgKCdmb3JFYWNoJyBpbiBzcmMpIHNyYy5mb3JFYWNoKGRvbS5hcHBlbmQuYmluZChudWxsLCB0YXJnZXQpKTtcbiAgLy8gZWxzZSBpZiAoJ3ZpZXdzJyBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmMudmlld3MsIHRydWUpO1xuICBlbHNlIGlmIChkaWN0ID09PSB0cnVlKSBmb3IgKHZhciBrZXkgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjW2tleV0pO1xuICBlbHNlIGlmICgnZnVuY3Rpb24nICE9IHR5cGVvZiBzcmMpIHRhcmdldC5hcHBlbmRDaGlsZChkb20uZ2V0RWxlbWVudChzcmMpKTtcbn07XG5cbmRvbS5yZW1vdmUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgaWYgKGVsLnBhcmVudE5vZGUpIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpO1xufTtcblxuZG9tLmdldEVsZW1lbnQgPSBmdW5jdGlvbihlbCkge1xuICByZXR1cm4gZWwuZG9tICYmIGVsLmRvbS5lbCB8fCBlbC5lbCB8fCBlbC5ub2RlIHx8IGVsO1xufTtcblxuZG9tLnNjcm9sbEJ5ID0gZnVuY3Rpb24oZWwsIHgsIHksIHNjcm9sbCkge1xuICBzY3JvbGwgPSBzY3JvbGwgfHwgZG9tLmdldFNjcm9sbChlbCk7XG4gIGRvbS5zY3JvbGxUbyhlbCwgc2Nyb2xsLnggKyB4LCBzY3JvbGwueSArIHkpO1xufTtcblxuZG9tLnNjcm9sbFRvID0gZnVuY3Rpb24oZWwsIHgsIHkpIHtcbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgd2luZG93LnNjcm9sbFRvKHgsIHkpO1xuICB9IGVsc2Uge1xuICAgIGVsLnNjcm9sbExlZnQgPSB4IHx8IDA7XG4gICAgZWwuc2Nyb2xsVG9wID0geSB8fCAwO1xuICB9XG59O1xuXG5kb20uY3NzID0gYmluZFJhZihmdW5jdGlvbihpZCwgY3NzVGV4dCkge1xuICBpZiAoIShpZCBpbiBkb20uY3NzLnN0eWxlcykpIHtcbiAgICBkb20uY3NzLnN0eWxlc1tpZF0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZG9tLmNzcy5zdHlsZXNbaWRdKTtcbiAgfVxuICBkb20uY3NzLnN0eWxlc1tpZF0udGV4dENvbnRlbnQgPSBjc3NUZXh0O1xufSk7XG5cbmRvbS5jc3Muc3R5bGVzID0ge307XG5cbmRvbS5nZXRNb3VzZVBvaW50ID0gZnVuY3Rpb24oZSkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBlLmNsaWVudFgsXG4gICAgeTogZS5jbGllbnRZXG4gIH0pO1xufTtcblxuZnVuY3Rpb24gZ2V0U2Nyb2xsKGVsKSB7XG4gIHJldHVybiBkb2N1bWVudC5ib2R5ID09PSBlbFxuICAgID8ge1xuICAgICAgICB4OiB3aW5kb3cuc2Nyb2xsWCB8fCBlbC5zY3JvbGxMZWZ0IHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxMZWZ0LFxuICAgICAgICB5OiB3aW5kb3cuc2Nyb2xsWSB8fCBlbC5zY3JvbGxUb3AgIHx8IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxUb3BcbiAgICAgIH1cbiAgICA6IHtcbiAgICAgICAgeDogZWwuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogZWwuc2Nyb2xsVG9wXG4gICAgICB9O1xufVxuIiwiXG52YXIgcHVzaCA9IFtdLnB1c2g7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxubW9kdWxlLmV4cG9ydHMgPSBFdmVudDtcblxuZnVuY3Rpb24gRXZlbnQoKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBFdmVudCkpIHJldHVybiBuZXcgRXZlbnQ7XG5cbiAgdGhpcy5faGFuZGxlcnMgPSB7fTtcbn1cblxuRXZlbnQucHJvdG90eXBlLl9nZXRIYW5kbGVycyA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdGhpcy5faGFuZGxlcnMgPSB0aGlzLl9oYW5kbGVycyB8fCB7fTtcbiAgcmV0dXJuIHRoaXMuX2hhbmRsZXJzW25hbWVdID0gdGhpcy5faGFuZGxlcnNbbmFtZV0gfHwgW107XG59O1xuXG5FdmVudC5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKG5hbWUsIGEsIGIsIGMsIGQpIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgaGFuZGxlcnMubGVuZ3RoOyBpKyspIHtcbiAgICBoYW5kbGVyc1tpXShhLCBiLCBjLCBkKTtcbiAgfTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbiA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGhhbmRsZXJzO1xuICB2YXIgbmV3SGFuZGxlcnMgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgbmFtZS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgICBwdXNoLmFwcGx5KGhhbmRsZXJzLCBuZXdIYW5kbGVyc1tuYW1lXSk7XG4gICAgfSwgdGhpcyk7XG4gIH0gZWxzZSB7XG4gICAgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgICBwdXNoLmFwcGx5KGhhbmRsZXJzLCBuZXdIYW5kbGVycyk7XG4gIH1cbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vZmYgPSBmdW5jdGlvbihuYW1lLCBoYW5kbGVyKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICB2YXIgaW5kZXggPSBoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpO1xuICBpZiAofmluZGV4KSBoYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xufTtcblxuRXZlbnQucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbihuYW1lLCBmbikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgZm4oYSwgYiwgYywgZCk7XG4gICAgaGFuZGxlcnMuc3BsaWNlKGhhbmRsZXJzLmluZGV4T2YoaGFuZGxlciksIDEpO1xuICB9O1xuICBoYW5kbGVycy5wdXNoKGhhbmRsZXIpO1xufTtcbiIsInZhciBjbG9uZSA9IHJlcXVpcmUoJy4vY2xvbmUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZW1vaXplKGZuLCBkaWZmLCBtZXJnZSwgcHJlKSB7XG4gIGRpZmYgPSBkaWZmIHx8IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGEgIT09IGIgfTtcbiAgbWVyZ2UgPSBtZXJnZSB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBiIH07XG4gIHByZSA9IHByZSB8fCBmdW5jdGlvbihub2RlLCBwYXJhbSkgeyByZXR1cm4gcGFyYW0gfTtcblxuICB2YXIgbm9kZXMgPSBbXTtcbiAgdmFyIGNhY2hlID0gW107XG4gIHZhciByZXN1bHRzID0gW107XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKG5vZGUsIHBhcmFtKSB7XG4gICAgdmFyIGFyZ3MgPSBwcmUobm9kZSwgcGFyYW0pO1xuICAgIG5vZGUgPSBhcmdzWzBdO1xuICAgIHBhcmFtID0gYXJnc1sxXTtcblxuICAgIHZhciBpbmRleCA9IG5vZGVzLmluZGV4T2Yobm9kZSk7XG4gICAgaWYgKH5pbmRleCkge1xuICAgICAgdmFyIGQgPSBkaWZmKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgaWYgKCFkKSByZXR1cm4gcmVzdWx0c1tpbmRleF07XG4gICAgICBlbHNlIHtcbiAgICAgICAgY2FjaGVbaW5kZXhdID0gbWVyZ2UoY2FjaGVbaW5kZXhdLCBwYXJhbSk7XG4gICAgICAgIHJlc3VsdHNbaW5kZXhdID0gZm4obm9kZSwgcGFyYW0sIGQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjYWNoZS5wdXNoKGNsb25lKHBhcmFtKSk7XG4gICAgICBub2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgaW5kZXggPSByZXN1bHRzLnB1c2goZm4obm9kZSwgcGFyYW0sIHBhcmFtKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZXJnZShkZXN0LCBzcmMpIHtcbiAgZm9yICh2YXIga2V5IGluIHNyYykge1xuICAgIGRlc3Rba2V5XSA9IHNyY1trZXldO1xuICB9XG4gIHJldHVybiBkZXN0O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBvcGVuO1xuXG5mdW5jdGlvbiBvcGVuKHVybCwgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybClcbiAgICAudGhlbihnZXRUZXh0KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cblxuZnVuY3Rpb24gZ2V0VGV4dChyZXMpIHtcbiAgcmV0dXJuIHJlcy50ZXh0KCk7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gUG9pbnQ7XG5cbmZ1bmN0aW9uIFBvaW50KHApIHtcbiAgaWYgKHApIHtcbiAgICB0aGlzLnggPSBwLng7XG4gICAgdGhpcy55ID0gcC55O1xuICB9IGVsc2Uge1xuICAgIHRoaXMueCA9IDA7XG4gICAgdGhpcy55ID0gMDtcbiAgfVxufVxuXG5Qb2ludC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLnggPSBwLng7XG4gIHRoaXMueSA9IHAueTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUG9pbnQodGhpcyk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLyddID1cblBvaW50LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfLyddID1cblBvaW50LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnby8nXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmREaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeLyddID1cblBvaW50LnByb3RvdHlwZS5jZWlsRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJysnXSA9XG5Qb2ludC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICsgKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLSddID1cblBvaW50LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAtIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLSAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycqJ10gPVxuUG9pbnQucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14qJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnbyonXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmRNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfKiddID1cblBvaW50LnByb3RvdHlwZS5mbG9vck11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gJ3g6JyArIHRoaXMueCArICcseTonICsgdGhpcy55O1xufTtcblxuUG9pbnQuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblBvaW50LmdyaWRSb3VuZCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLnJvdW5kKGEueCAvIGIud2lkdGgpLFxuICAgIHk6IE1hdGgucm91bmQoYS55IC8gYi5oZWlnaHQpXG4gIH07XG59O1xuXG5Qb2ludC5sb3cgPSBmdW5jdGlvbihsb3csIHApIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLm1heChsb3cueCwgcC54KSxcbiAgICB5OiBNYXRoLm1heChsb3cueSwgcC55KVxuICB9O1xufTtcblxuUG9pbnQuY2xhbXAgPSBmdW5jdGlvbihhcmVhLCBwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGFyZWEuZW5kLngsIE1hdGgubWF4KGFyZWEuYmVnaW4ueCwgcC54KSksXG4gICAgeTogTWF0aC5taW4oYXJlYS5lbmQueSwgTWF0aC5tYXgoYXJlYS5iZWdpbi55LCBwLnkpKVxuICB9KTtcbn07XG5cblBvaW50Lm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHsgeDogYS54ICsgYi54LCB5OiBhLnkgKyBiLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFggPSBmdW5jdGlvbih4LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCArIHgsIHk6IHAueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIHApIHtcbiAgcmV0dXJuIHsgeDogcC54LCB5OiBwLnkgKyB5IH07XG59O1xuXG5Qb2ludC50b0xlZnRUb3AgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiB7XG4gICAgbGVmdDogcC54LFxuICAgIHRvcDogcC55XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEFORDtcblxuZnVuY3Rpb24gQU5EKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IE5PVDtcblxuZnVuY3Rpb24gTk9UKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsInZhciBBTkQgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtYW5kJyk7XG52YXIgTk9UID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLW5vdCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJhbmdlO1xuXG5mdW5jdGlvbiBSYW5nZShyKSB7XG4gIGlmIChyKSB7XG4gICAgdGhpc1swXSA9IHJbMF07XG4gICAgdGhpc1sxXSA9IHJbMV07XG4gIH0gZWxzZSB7XG4gICAgdGhpc1swXSA9IDA7XG4gICAgdGhpc1sxXSA9IDE7XG4gIH1cbn07XG5cblJhbmdlLkFORCA9IEFORDtcblJhbmdlLk5PVCA9IE5PVDtcblxuUmFuZ2Uuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblJhbmdlLmVxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYVswXSA9PT0gYlswXSAmJiBhWzFdID09PSBiWzFdO1xufTtcblxuUmFuZ2UuY2xhbXAgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UoW1xuICAgIE1hdGgubWluKGJbMV0sIE1hdGgubWF4KGFbMF0sIGJbMF0pKSxcbiAgICBNYXRoLm1pbihhWzFdLCBiWzFdKVxuICBdKTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFJhbmdlKHRoaXMpO1xufTtcblxuUmFuZ2UucmFuZ2VzID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbihpdGVtKSB7IHJldHVybiBpdGVtLnJhbmdlIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdID49IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPD0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm92ZXJsYXAgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA8PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdID49IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMV0gPCByYW5nZVswXSB8fCBpdGVtLnJhbmdlWzBdID4gcmFuZ2VbMV07XG4gIH0pO1xufTtcbiIsIlxudmFyIFJlZ2V4cCA9IGV4cG9ydHM7XG5cblJlZ2V4cC5jcmVhdGUgPSBmdW5jdGlvbihuYW1lcywgZmxhZ3MsIGZuKSB7XG4gIGZuID0gZm4gfHwgZnVuY3Rpb24ocykgeyByZXR1cm4gcyB9O1xuICByZXR1cm4gbmV3IFJlZ0V4cChcbiAgICBuYW1lc1xuICAgIC5tYXAoKG4pID0+ICdzdHJpbmcnID09PSB0eXBlb2YgbiA/IFJlZ2V4cC50eXBlc1tuXSA6IG4pXG4gICAgLm1hcCgocikgPT4gZm4oci50b1N0cmluZygpLnNsaWNlKDEsLTEpKSlcbiAgICAuam9pbignfCcpLFxuICAgIGZsYWdzXG4gICk7XG59O1xuXG5SZWdleHAudHlwZXMgPSB7XG4gICd0b2tlbnMnOiAvLis/XFxifC5cXEJ8XFxiLis/LyxcbiAgJ3dvcmRzJzogL1thLXpBLVowLTldezEsfS8sXG4gICdwYXJ0cyc6IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvLFxuXG4gICdzaW5nbGUgY29tbWVudCc6IC9cXC9cXC8uKj8kLyxcbiAgJ2RvdWJsZSBjb21tZW50JzogL1xcL1xcKlteXSo/XFwqXFwvLyxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiAvKCcoPzooPzpcXFxcXFxufFxcXFwnfFteJ1xcbl0pKSo/JykvLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IC8oXCIoPzooPzpcXFxcXFxufFxcXFxcInxbXlwiXFxuXSkpKj9cIikvLFxuICAndGVtcGxhdGUgc3RyaW5nJzogLyhgKD86KD86XFxcXGB8W15gXSkpKj9gKS8sXG5cbiAgJ29wZXJhdG9yJzogLyF8Pj0/fDw9P3w9ezEsM318KD86Jil7MSwyfXxcXHw/XFx8fFxcP3xcXCp8XFwvfH58XFxefCV8XFwuKD8hXFxkKXxcXCt7MSwyfXxcXC17MSwyfS8sXG4gICdmdW5jdGlvbic6IC8gKCg/IVxcZHxbLiBdKj8oaWZ8ZWxzZXxkb3xmb3J8Y2FzZXx0cnl8Y2F0Y2h8d2hpbGV8d2l0aHxzd2l0Y2gpKVthLXpBLVowLTlfICRdKykoPz1cXCguKlxcKS4qeykvLFxuICAna2V5d29yZCc6IC9cXGIoYnJlYWt8Y2FzZXxjYXRjaHxjb25zdHxjb250aW51ZXxkZWJ1Z2dlcnxkZWZhdWx0fGRlbGV0ZXxkb3xlbHNlfGV4cG9ydHxleHRlbmRzfGZpbmFsbHl8Zm9yfGZyb218aWZ8aW1wbGVtZW50c3xpbXBvcnR8aW58aW5zdGFuY2VvZnxpbnRlcmZhY2V8bGV0fG5ld3xwYWNrYWdlfHByaXZhdGV8cHJvdGVjdGVkfHB1YmxpY3xyZXR1cm58c3RhdGljfHN1cGVyfHN3aXRjaHx0aHJvd3x0cnl8dHlwZW9mfHdoaWxlfHdpdGh8eWllbGQpXFxiLyxcbiAgJ2RlY2xhcmUnOiAvXFxiKGZ1bmN0aW9ufGludGVyZmFjZXxjbGFzc3x2YXJ8bGV0fGNvbnN0fGVudW18dm9pZClcXGIvLFxuICAnYnVpbHRpbic6IC9cXGIoT2JqZWN0fEZ1bmN0aW9ufEJvb2xlYW58RXJyb3J8RXZhbEVycm9yfEludGVybmFsRXJyb3J8UmFuZ2VFcnJvcnxSZWZlcmVuY2VFcnJvcnxTdG9wSXRlcmF0aW9ufFN5bnRheEVycm9yfFR5cGVFcnJvcnxVUklFcnJvcnxOdW1iZXJ8TWF0aHxEYXRlfFN0cmluZ3xSZWdFeHB8QXJyYXl8RmxvYXQzMkFycmF5fEZsb2F0NjRBcnJheXxJbnQxNkFycmF5fEludDMyQXJyYXl8SW50OEFycmF5fFVpbnQxNkFycmF5fFVpbnQzMkFycmF5fFVpbnQ4QXJyYXl8VWludDhDbGFtcGVkQXJyYXl8QXJyYXlCdWZmZXJ8RGF0YVZpZXd8SlNPTnxJbnRsfGFyZ3VtZW50c3xjb25zb2xlfHdpbmRvd3xkb2N1bWVudHxTeW1ib2x8U2V0fE1hcHxXZWFrU2V0fFdlYWtNYXB8UHJveHl8UmVmbGVjdHxQcm9taXNlKVxcYi8sXG4gICdzcGVjaWFsJzogL1xcYih0cnVlfGZhbHNlfG51bGx8dW5kZWZpbmVkKVxcYi8sXG4gICdwYXJhbXMnOiAvZnVuY3Rpb25bIFxcKF17MX1bXl0qP1xcey8sXG4gICdudW1iZXInOiAvLT9cXGIoMHhbXFxkQS1GYS1mXSt8XFxkKlxcLj9cXGQrKFtFZV1bKy1dP1xcZCspP3xOYU58LT9JbmZpbml0eSlcXGIvLFxuICAnc3ltYm9sJzogL1t7fVtcXF0oKSw6XS8sXG4gICdyZWdleHAnOiAvKD8hW15cXC9dKShcXC8oPyFbXFwvfFxcKl0pLio/W15cXFxcXFxeXVxcLykoWztcXG5cXC5cXClcXF1cXH0gZ2ltXSkvLFxuXG4gICd4bWwnOiAvPFtePl0qPi8sXG4gICd1cmwnOiAvKChcXHcrOlxcL1xcLylbLWEtekEtWjAtOTpAOz8mPVxcLyVcXCtcXC5cXCohJ1xcKFxcKSxcXCRfXFx7XFx9XFxeflxcW1xcXWAjfF0rKS8sXG4gICdpbmRlbnQnOiAvXiArfF5cXHQrLyxcbiAgJ2xpbmUnOiAvXi4rJHxeXFxuLyxcbiAgJ25ld2xpbmUnOiAvXFxyXFxufFxccnxcXG4vLFxufTtcblxuUmVnZXhwLnR5cGVzLmNvbW1lbnQgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBjb21tZW50JyxcbiAgJ2RvdWJsZSBjb21tZW50Jyxcbl0pO1xuXG5SZWdleHAudHlwZXMuc3RyaW5nID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbl0pO1xuXG5SZWdleHAudHlwZXMubXVsdGlsaW5lID0gUmVnZXhwLmNyZWF0ZShbXG4gICdkb3VibGUgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuICAnaW5kZW50JyxcbiAgJ2xpbmUnXG5dKTtcblxuUmVnZXhwLnBhcnNlID0gZnVuY3Rpb24ocywgcmVnZXhwLCBmaWx0ZXIpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIGlmIChmaWx0ZXIpIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICBpZiAoZmlsdGVyKHdvcmQpKSB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gc2F2ZTtcblxuZnVuY3Rpb24gc2F2ZSh1cmwsIHNyYywgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBib2R5OiBzcmMsXG4gICAgfSlcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG4iLCIvLyBOb3RlOiBZb3UgcHJvYmFibHkgZG8gbm90IHdhbnQgdG8gdXNlIHRoaXMgaW4gcHJvZHVjdGlvbiBjb2RlLCBhcyBQcm9taXNlIGlzXG4vLyAgIG5vdCBzdXBwb3J0ZWQgYnkgYWxsIGJyb3dzZXJzIHlldC5cblxuKGZ1bmN0aW9uKCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgaWYgKHdpbmRvdy5zZXRJbW1lZGlhdGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwZW5kaW5nID0ge30sXG4gICAgICAgIG5leHRIYW5kbGUgPSAxO1xuXG4gICAgZnVuY3Rpb24gb25SZXNvbHZlKGhhbmRsZSkge1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgICAgIGNhbGxiYWNrLmZuLmFwcGx5KG51bGwsIGNhbGxiYWNrLmFyZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd2luZG93LnNldEltbWVkaWF0ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgICAgIGhhbmRsZTtcblxuICAgICAgICBpZiAodHlwZW9mIGZuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnZhbGlkIGZ1bmN0aW9uXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaGFuZGxlID0gbmV4dEhhbmRsZSsrO1xuICAgICAgICBwZW5kaW5nW2hhbmRsZV0gPSB7IGZuOiBmbiwgYXJnczogYXJncyB9O1xuXG4gICAgICAgIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaGFuZGxlKTtcbiAgICAgICAgfSkudGhlbihvblJlc29sdmUpO1xuXG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcblxuICAgIHdpbmRvdy5jbGVhckltbWVkaWF0ZSA9IGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgIH07XG59KCkpOyIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHJ1bm5pbmcsIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMpIHtcbiAgICBpZiAocnVubmluZykgcmV0dXJuO1xuICAgIHJ1bm5pbmcgPSB0cnVlO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYyk7XG4gICAgc2V0VGltZW91dChyZXNldCwgbXMpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlc2V0KCkge1xuICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgfVxufTtcbiIsIlxudmFyIHRyaW0gPSBleHBvcnRzO1xuXG50cmltLmVtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciB0cmFpbGluZyA9IHRyaW0udHJhaWxpbmdFbXB0eUxpbmVzKHMpO1xuICB2YXIgbGVhZGluZyA9IHRyaW0ubGVhZGluZ0VtcHR5TGluZXModHJhaWxpbmcuc3RyaW5nKTtcbiAgcmV0dXJuIHtcbiAgICB0cmFpbGluZzogdHJhaWxpbmcucmVtb3ZlZCxcbiAgICBsZWFkaW5nOiBsZWFkaW5nLnJlbW92ZWQsXG4gICAgcmVtb3ZlZDogdHJhaWxpbmcucmVtb3ZlZCArIGxlYWRpbmcucmVtb3ZlZCxcbiAgICBzdHJpbmc6IGxlYWRpbmcuc3RyaW5nXG4gIH07XG59O1xuXG50cmltLnRyYWlsaW5nRW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIGluZGV4ID0gcy5sZW5ndGg7XG4gIHZhciBsYXN0SW5kZXggPSBpbmRleDtcbiAgdmFyIG4gPSAwO1xuICB3aGlsZSAoXG4gICAgfihpbmRleCA9IHMubGFzdEluZGV4T2YoJ1xcbicsIGxhc3RJbmRleCAtIDEpKVxuICAgICYmIGluZGV4IC0gbGFzdEluZGV4ID09PSAtMSkge1xuICAgIG4rKztcbiAgICBsYXN0SW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIGlmIChuKSBzID0gcy5zbGljZSgwLCBsYXN0SW5kZXgpO1xuXG4gIHJldHVybiB7XG4gICAgcmVtb3ZlZDogbixcbiAgICBzdHJpbmc6IHNcbiAgfTtcbn07XG5cbnRyaW0ubGVhZGluZ0VtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgbGFzdEluZGV4ID0gaW5kZXg7XG4gIHZhciBuID0gMDtcblxuICB3aGlsZSAoXG4gICAgfihpbmRleCA9IHMuaW5kZXhPZignXFxuJywgbGFzdEluZGV4ICsgMSkpXG4gICAgJiYgaW5kZXggLSBsYXN0SW5kZXggPT09IDEpIHtcbiAgICBuKys7XG4gICAgbGFzdEluZGV4ID0gaW5kZXg7XG4gIH1cblxuICBpZiAobikgcyA9IHMuc2xpY2UobGFzdEluZGV4ICsgMSk7XG5cbiAgcmV0dXJuIHtcbiAgICByZW1vdmVkOiBuLFxuICAgIHN0cmluZzogc1xuICB9O1xufTtcbiIsInZhciBBcmVhID0gcmVxdWlyZSgnLi4vLi4vbGliL2FyZWEnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xuXG52YXIgU2tpcFN0cmluZyA9IHJlcXVpcmUoJy4vc2tpcHN0cmluZycpO1xudmFyIFNlZ21lbnRzID0gcmVxdWlyZSgnLi9zZWdtZW50cycpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgU3ludGF4ID0gcmVxdWlyZSgnLi9zeW50YXgnKTtcblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE5FV0xJTkUgPSAvXFxuL2c7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbnZhciBTRUdNRU5UID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuc2VnbWVudHMgPSBuZXcgU2VnbWVudHModGhpcyk7XG4gIHRoaXMuc2V0VGV4dCgnJyk7XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5CdWZmZXIucHJvdG90eXBlLnNldFRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdGhpcy5yYXcgPSB0ZXh0IC8vdGhpcy5zeW50YXguaGlnaGxpZ2h0KHRleHQpO1xuXG4gIHRoaXMuc3ludGF4LnRhYiA9IH50aGlzLnJhdy5pbmRleE9mKCdcXHQnKSA/ICdcXHQnIDogJyAnO1xuXG4gIHRoaXMudGV4dCA9IG5ldyBTa2lwU3RyaW5nO1xuICB0aGlzLnRleHQuc2V0KHRoaXMucmF3KTtcblxuICB0aGlzLnRva2VucyA9IG5ldyBUb2tlbnM7XG4gIHRoaXMudG9rZW5zLmluZGV4KHRoaXMucmF3KTtcblxuICAvLyB0aGlzLmVtaXQoJ3JhdycsIHRoaXMucmF3KTtcbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zZXJ0ID1cbkJ1ZmZlci5wcm90b3R5cGUuaW5zZXJ0VGV4dEF0UG9pbnQgPSBmdW5jdGlvbihwLCB0ZXh0LCBjdHJsU2hpZnQpIHtcbiAgaWYgKCFjdHJsU2hpZnQpIHRoaXMuZW1pdCgnYmVmb3JlIHVwZGF0ZScpO1xuXG4gIHRleHQgPSBub3JtYWxpemVFT0wodGV4dCk7XG5cbiAgdmFyIGlzRU9MID0gJ1xcbicgPT09IHRleHRbMF07XG4gIHZhciBzaGlmdCA9IGN0cmxTaGlmdCB8fCBpc0VPTDtcbiAgdmFyIGxlbmd0aCA9IHRleHQubGVuZ3RoO1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgbGluZXMgPSAodGV4dC5tYXRjaChORVdMSU5FKSB8fCBbXSkubGVuZ3RoO1xuICB2YXIgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIGxpbmVzXTtcbiAgdmFyIG9mZnNldFJhbmdlID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcblxuICB2YXIgYmVmb3JlID0gdGhpcy5nZXRPZmZzZXRSYW5nZVRleHQob2Zmc2V0UmFuZ2UpO1xuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG4gIG9mZnNldFJhbmdlWzFdICs9IHRleHQubGVuZ3RoO1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgLy8gdGhpcy50b2tlbnMgPSBuZXcgVG9rZW5zO1xuICAvLyB0aGlzLnRva2Vucy5pbmRleCh0aGlzLnRleHQudG9TdHJpbmcoKSk7XG4gIC8vIHRoaXMuc2VnbWVudHMgPSBuZXcgU2VnbWVudHModGhpcyk7XG5cbiAgaWYgKCFjdHJsU2hpZnQpIHRoaXMuZW1pdCgndXBkYXRlJywgcmFuZ2UsIHNoaWZ0LCBiZWZvcmUsIGFmdGVyKTtcbiAgZWxzZSB0aGlzLmVtaXQoJ3JhdycpO1xuXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlID1cbkJ1ZmZlci5wcm90b3R5cGUucmVtb3ZlT2Zmc2V0UmFuZ2UgPSBmdW5jdGlvbihvLCBub1VwZGF0ZSkge1xuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICAvLyBjb25zb2xlLmxvZygnb2Zmc2V0cycsIG8pXG4gIHZhciBhID0gdGhpcy5nZXRPZmZzZXRQb2ludChvWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmdldE9mZnNldFBvaW50KG9bMV0pO1xuICB2YXIgbGVuZ3RoID0gb1swXSAtIG9bMV07XG4gIHZhciByYW5nZSA9IFthLnksIGIueV07XG4gIHZhciBzaGlmdCA9IGEueSAtIGIueTtcbiAgLy8gY29uc29sZS5sb2coYSxiKVxuXG4gIHZhciBvZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhyYW5nZSk7XG4gIHZhciBiZWZvcmUgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudGV4dC5yZW1vdmUobyk7XG4gIC8vIG9mZnNldFJhbmdlWzFdIC09IHNoaWZ0O1xuICB2YXIgYWZ0ZXIgPSB0aGlzLmdldE9mZnNldFJhbmdlVGV4dChvZmZzZXRSYW5nZSk7XG4gIHRoaXMudG9rZW5zLnVwZGF0ZShvZmZzZXRSYW5nZSwgYWZ0ZXIsIGxlbmd0aCk7XG4gIHRoaXMuc2VnbWVudHMuY2xlYXJDYWNoZShvZmZzZXRSYW5nZVswXSk7XG5cbiAgaWYgKCFub1VwZGF0ZSkgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVBcmVhID0gZnVuY3Rpb24oYXJlYSwgbm9VcGRhdGUpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlT2Zmc2V0UmFuZ2Uob2Zmc2V0cywgbm9VcGRhdGUpO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5yZW1vdmVDaGFyQXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIG9mZnNldFJhbmdlID0gW3BvaW50Lm9mZnNldCwgcG9pbnQub2Zmc2V0KzFdO1xuICByZXR1cm4gdGhpcy5yZW1vdmVPZmZzZXRSYW5nZShvZmZzZXRSYW5nZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBjb2RlID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KHJhbmdlKTtcbiAgdmFyIHNlZ21lbnQgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIGlmIChzZWdtZW50KSB7XG4gICAgY29kZSA9IFNFR01FTlRbc2VnbWVudF0gKyAnXFx1ZmZiYScgKyBjb2RlICsgJ1xcdWZmYmUqL2AnXG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlKTtcbiAgICBjb2RlID0gJzwnICsgc2VnbWVudFswXSArICc+JyArXG4gICAgICBjb2RlLnN1YnN0cmluZyhcbiAgICAgICAgY29kZS5pbmRleE9mKCdcXHVmZmJhJykgKyAxLFxuICAgICAgICBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJylcbiAgICAgICk7XG4gIH0gZWxzZSB7XG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlICsgJ1xcdWZmYmUqL2AnKTtcbiAgICBjb2RlID0gY29kZS5zdWJzdHJpbmcoMCwgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIGxpbmUgPSBuZXcgTGluZTtcbiAgbGluZS5vZmZzZXRSYW5nZSA9IHRoaXMuZ2V0TGluZVJhbmdlT2Zmc2V0cyhbeSx5XSk7XG4gIGxpbmUub2Zmc2V0ID0gbGluZS5vZmZzZXRSYW5nZVswXTtcbiAgbGluZS5sZW5ndGggPSBsaW5lLm9mZnNldFJhbmdlWzFdIC0gbGluZS5vZmZzZXRSYW5nZVswXSAtICh5IDwgdGhpcy5sb2MoKSk7XG4gIGxpbmUucG9pbnQuc2V0KHsgeDowLCB5OnkgfSk7XG4gIHJldHVybiBsaW5lO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocC55KTtcbiAgdmFyIHBvaW50ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1pbihsaW5lLmxlbmd0aCwgcC54KSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfSk7XG4gIHBvaW50Lm9mZnNldCA9IGxpbmUub2Zmc2V0ICsgcG9pbnQueDtcbiAgcG9pbnQucG9pbnQgPSBwb2ludDtcbiAgcG9pbnQubGluZSA9IGxpbmU7XG4gIHJldHVybiBwb2ludDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVJhbmdlVGV4dCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBvZmZzZXRzID0gdGhpcy5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lUmFuZ2VPZmZzZXRzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldExpbmVPZmZzZXQocmFuZ2VbMF0pO1xuICB2YXIgYiA9IHJhbmdlWzFdID49IHRoaXMubG9jKClcbiAgICA/IHRoaXMudGV4dC5sZW5ndGhcbiAgICA6IHRoaXMuZ2V0TGluZU9mZnNldChyYW5nZVsxXSArIDEpO1xuICB2YXIgb2Zmc2V0cyA9IFthLCBiXTtcbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFJhbmdlVGV4dCA9IGZ1bmN0aW9uKG9mZnNldFJhbmdlKSB7XG4gIHZhciB0ZXh0ID0gdGhpcy50ZXh0LmdldFJhbmdlKG9mZnNldFJhbmdlKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciB0b2tlbiA9IHRoaXMudG9rZW5zLmdldEJ5T2Zmc2V0KCdsaW5lcycsIG9mZnNldCAtIC41KTtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogb2Zmc2V0IC0gKG9mZnNldCA+IHRva2VuLm9mZnNldCA/IHRva2VuLm9mZnNldCArIDEgOiAwKSxcbiAgICB5OiBNYXRoLm1pbih0aGlzLmxvYygpLCB0b2tlbi5pbmRleCAtICh0b2tlbi5vZmZzZXQgKyAxID4gb2Zmc2V0KSArIDEpXG4gIH0pO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5jaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGNoYXIgPSB0aGlzLnRleHQuZ2V0UmFuZ2UoW29mZnNldCwgb2Zmc2V0ICsgMV0pO1xuICByZXR1cm4gY2hhcjtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZVRleHQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHtcbiAgICBsaW5lOiBsaW5lLFxuICAgIHRleHQ6IHRleHQsXG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZVRleHQgPSBmdW5jdGlvbih5KSB7XG4gIHZhciB0ZXh0ID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KFt5LHldKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEFyZWFUZXh0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBcmVhQXRQb2ludCA9IGZ1bmN0aW9uKHAsIGluY2x1c2l2ZSkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLm9mZnNldFJhbmdlKTtcbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKHRleHQsIFdPUkRTKTtcblxuICBpZiAod29yZHMubGVuZ3RoID09PSAxKSB7XG4gICAgdmFyIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogeyB4OiAwLCB5OiBwb2ludC55IH0sXG4gICAgICBlbmQ6IHsgeDogcG9pbnQubGluZS5sZW5ndGgsIHk6IHBvaW50LnkgfSxcbiAgICB9KTtcblxuICAgIHJldHVybiBhcmVhO1xuICB9XG5cbiAgdmFyIGxhc3RJbmRleCA9IDA7XG4gIHZhciB3b3JkID0gW107XG4gIHZhciBlbmQgPSB0ZXh0Lmxlbmd0aDtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmICh3b3JkLmluZGV4ID4gcG9pbnQueCAtICEhaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICB2YXIgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICBiZWdpbjogeyB4OiBsYXN0SW5kZXgsIHk6IHBvaW50LnkgfSxcbiAgICBlbmQ6IHsgeDogZW5kLCB5OiBwb2ludC55IH1cbiAgfSk7XG5cbiAgcmV0dXJuIGFyZWE7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLm1vdmVBcmVhQnlMaW5lcyA9IGZ1bmN0aW9uKHksIGFyZWEpIHtcbiAgaWYgKGFyZWEuZW5kLnggPiAwIHx8IGFyZWEuYmVnaW4ueSA9PT0gYXJlYS5lbmQueSkgYXJlYS5lbmQueSArPSAxO1xuICBpZiAoYXJlYS5iZWdpbi55ICsgeSA8IDAgfHwgYXJlYS5lbmQueSArIHkgPiB0aGlzLmxvYykgcmV0dXJuIGZhbHNlO1xuXG4gIGFyZWEuYmVnaW4ueCA9IDA7XG4gIGFyZWEuZW5kLnggPSAwO1xuXG4gIHZhciB0ZXh0ID0gdGhpcy5nZXRMaW5lUmFuZ2VUZXh0KFthcmVhLmJlZ2luLnksIGFyZWEuZW5kLnktMV0pO1xuICB0aGlzLnJlbW92ZUFyZWEoYXJlYSwgdHJ1ZSk7XG5cbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0LCB5KTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgcmFuZ2UgPSBbXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmJlZ2luKS5vZmZzZXQsXG4gICAgdGhpcy5nZXRQb2ludChhcmVhLmVuZCkub2Zmc2V0XG4gIF07XG4gIHJldHVybiByYW5nZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICByZXR1cm4gbGluZTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZU9mZnNldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIG9mZnNldCA9IHkgPCAwID8gLTEgOiB5ID09PSAwID8gMCA6IHRoaXMudG9rZW5zLmdldEJ5SW5kZXgoJ2xpbmVzJywgeSAtIDEpICsgMTtcbiAgcmV0dXJuIG9mZnNldDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUubG9jID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnRva2Vucy5nZXRDb2xsZWN0aW9uKCdsaW5lcycpLmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMudGV4dC50b1N0cmluZygpO1xufTtcblxuZnVuY3Rpb24gTGluZSgpIHtcbiAgdGhpcy5vZmZzZXRSYW5nZSA9IFtdO1xuICB0aGlzLm9mZnNldCA9IDA7XG4gIHRoaXMubGVuZ3RoID0gMDtcbiAgdGhpcy5wb2ludCA9IG5ldyBQb2ludDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRU9MKHMpIHtcbiAgcmV0dXJuIHMucmVwbGFjZShFT0wsICdcXG4nKTtcbn1cbiIsInZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFBhcnRzO1xuXG5mdW5jdGlvbiBQYXJ0cyhtaW5TaXplKSB7XG4gIG1pblNpemUgPSBtaW5TaXplIHx8IDUwMDA7XG4gIHRoaXMubWluU2l6ZSA9IG1pblNpemU7XG4gIHRoaXMucGFydHMgPSBbXTtcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5QYXJ0cy5wcm90b3R5cGUucHVzaCA9IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgdGhpcy5hcHBlbmQoW2l0ZW1dKTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5hcHBlbmQgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcGFydCA9IGxhc3QodGhpcy5wYXJ0cyk7XG5cbiAgaWYgKCFwYXJ0KSB7XG4gICAgcGFydCA9IFtdO1xuICAgIHBhcnQuc3RhcnRJbmRleCA9IDA7XG4gICAgcGFydC5zdGFydE9mZnNldCA9IDA7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG4gIGVsc2UgaWYgKHBhcnQubGVuZ3RoID49IHRoaXMubWluU2l6ZSkge1xuICAgIHZhciBzdGFydEluZGV4ID0gcGFydC5zdGFydEluZGV4ICsgcGFydC5sZW5ndGg7XG4gICAgdmFyIHN0YXJ0T2Zmc2V0ID0gaXRlbXNbMF07XG5cbiAgICBwYXJ0ID0gW107XG4gICAgcGFydC5zdGFydEluZGV4ID0gc3RhcnRJbmRleDtcbiAgICBwYXJ0LnN0YXJ0T2Zmc2V0ID0gc3RhcnRPZmZzZXQ7XG4gICAgdGhpcy5wYXJ0cy5wdXNoKHBhcnQpO1xuICB9XG5cbiAgcGFydC5wdXNoLmFwcGx5KHBhcnQsIGl0ZW1zLm1hcChvZmZzZXQgPT4gb2Zmc2V0IC0gcGFydC5zdGFydE9mZnNldCkpO1xuXG4gIHRoaXMubGVuZ3RoICs9IGl0ZW1zLmxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpbmRleCkge1xuICB2YXIgcGFydCA9IHRoaXMuZmluZFBhcnRCeUluZGV4KGluZGV4KS5pdGVtO1xuICByZXR1cm4gcGFydFtpbmRleCAtIHBhcnQuc3RhcnRJbmRleF0gKyBwYXJ0LnN0YXJ0T2Zmc2V0O1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHAgPSB0aGlzLmZpbmRQYXJ0QnlPZmZzZXQob2Zmc2V0KTtcbiAgaWYgKCFwLml0ZW0pIHJldHVybiBudWxsO1xuXG4gIHZhciBwYXJ0ID0gcC5pdGVtO1xuICB2YXIgcGFydEluZGV4ID0gcC5pbmRleDtcbiAgdmFyIG8gPSB0aGlzLmZpbmRPZmZzZXRJblBhcnQob2Zmc2V0LCBwYXJ0KTtcbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG8uaXRlbSArIHBhcnQuc3RhcnRPZmZzZXQsXG4gICAgaW5kZXg6IG8uaW5kZXggKyBwYXJ0LnN0YXJ0SW5kZXgsXG4gICAgbG9jYWw6IG8uaW5kZXgsXG4gICAgcGFydDogcGFydCxcbiAgICBwYXJ0SW5kZXg6IHBhcnRJbmRleFxuICB9O1xufTtcblxuUGFydHMucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgYXJyYXkpIHtcbiAgdmFyIG8gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKCFvKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwZW5kKGFycmF5KTtcbiAgfVxuICBpZiAoby5vZmZzZXQgPiBvZmZzZXQpIG8ubG9jYWwgPSAtMTtcbiAgdmFyIGxlbmd0aCA9IGFycmF5Lmxlbmd0aDtcbiAgLy9UT0RPOiBtYXliZSBzdWJ0cmFjdCAnb2Zmc2V0JyBpbnN0ZWFkID9cbiAgYXJyYXkgPSBhcnJheS5tYXAoZWwgPT4gZWwgLT0gby5wYXJ0LnN0YXJ0T2Zmc2V0KTtcbiAgaW5zZXJ0KG8ucGFydCwgby5sb2NhbCArIDEsIGFycmF5KTtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgLWxlbmd0aCk7XG4gIHRoaXMubGVuZ3RoICs9IGxlbmd0aDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5zaGlmdE9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCwgc2hpZnQpIHtcbiAgdmFyIHBhcnRzID0gdGhpcy5wYXJ0cztcbiAgdmFyIGl0ZW0gPSB0aGlzLmZpbmQob2Zmc2V0KTtcbiAgaWYgKG9mZnNldCA+IGl0ZW0ub2Zmc2V0KSBpdGVtLmxvY2FsICs9IDE7XG5cbiAgdmFyIHJlbW92ZWQgPSAwO1xuICBmb3IgKHZhciBpID0gaXRlbS5sb2NhbDsgaSA8IGl0ZW0ucGFydC5sZW5ndGg7IGkrKykge1xuICAgIGl0ZW0ucGFydFtpXSArPSBzaGlmdDtcbiAgICBpZiAoaXRlbS5wYXJ0W2ldICsgaXRlbS5wYXJ0LnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICByZW1vdmVkKys7XG4gICAgICBpdGVtLnBhcnQuc3BsaWNlKGktLSwgMSk7XG4gICAgfVxuICB9XG4gIGlmIChyZW1vdmVkKSB7XG4gICAgdGhpcy5zaGlmdEluZGV4KGl0ZW0ucGFydEluZGV4ICsgMSwgcmVtb3ZlZCk7XG4gICAgdGhpcy5sZW5ndGggLT0gcmVtb3ZlZDtcbiAgfVxuICBmb3IgKHZhciBpID0gaXRlbS5wYXJ0SW5kZXggKyAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBwYXJ0c1tpXS5zdGFydE9mZnNldCArPSBzaGlmdDtcbiAgICBpZiAocGFydHNbaV0uc3RhcnRPZmZzZXQgPCBvZmZzZXQpIHtcbiAgICAgIGlmIChsYXN0KHBhcnRzW2ldKSArIHBhcnRzW2ldLnN0YXJ0T2Zmc2V0IDwgb2Zmc2V0KSB7XG4gICAgICAgIHJlbW92ZWQgPSBwYXJ0c1tpXS5sZW5ndGg7XG4gICAgICAgIHRoaXMuc2hpZnRJbmRleChpICsgMSwgcmVtb3ZlZCk7XG4gICAgICAgIHRoaXMubGVuZ3RoIC09IHJlbW92ZWQ7XG4gICAgICAgIHBhcnRzLnNwbGljZShpLS0sIDEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5yZW1vdmVCZWxvd09mZnNldChvZmZzZXQsIHBhcnRzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblBhcnRzLnByb3RvdHlwZS5yZW1vdmVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBhID0gdGhpcy5maW5kKHJhbmdlWzBdKTtcbiAgdmFyIGIgPSB0aGlzLmZpbmQocmFuZ2VbMV0pO1xuXG4gIGlmIChhLnBhcnRJbmRleCA9PT0gYi5wYXJ0SW5kZXgpIHtcbiAgICBpZiAoYS5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYS5vZmZzZXQgPCByYW5nZVswXSkgYS5sb2NhbCArPSAxO1xuICAgIGlmIChiLm9mZnNldCA+PSByYW5nZVsxXSB8fCBiLm9mZnNldCA8IHJhbmdlWzBdKSBiLmxvY2FsIC09IDE7XG4gICAgdmFyIHNoaWZ0ID0gcmVtb3ZlKGEucGFydCwgYS5sb2NhbCwgYi5sb2NhbCArIDEpLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0SW5kZXgoYS5wYXJ0SW5kZXggKyAxLCBzaGlmdCk7XG4gICAgdGhpcy5sZW5ndGggLT0gc2hpZnQ7XG4gIH0gZWxzZSB7XG4gICAgaWYgKGEub2Zmc2V0ID49IHJhbmdlWzFdIHx8IGEub2Zmc2V0IDwgcmFuZ2VbMF0pIGEubG9jYWwgKz0gMTtcbiAgICBpZiAoYi5vZmZzZXQgPj0gcmFuZ2VbMV0gfHwgYi5vZmZzZXQgPCByYW5nZVswXSkgYi5sb2NhbCAtPSAxO1xuICAgIHZhciBzaGlmdEEgPSByZW1vdmUoYS5wYXJ0LCBhLmxvY2FsKS5sZW5ndGg7XG4gICAgdmFyIHNoaWZ0QiA9IHJlbW92ZShiLnBhcnQsIDAsIGIubG9jYWwgKyAxKS5sZW5ndGg7XG4gICAgaWYgKGIucGFydEluZGV4IC0gYS5wYXJ0SW5kZXggPiAxKSB7XG4gICAgICB2YXIgcmVtb3ZlZCA9IHJlbW92ZSh0aGlzLnBhcnRzLCBhLnBhcnRJbmRleCArIDEsIGIucGFydEluZGV4KTtcbiAgICAgIHZhciBzaGlmdEJldHdlZW4gPSByZW1vdmVkLnJlZHVjZSgocCxuKSA9PiBwICsgbi5sZW5ndGgsIDApO1xuICAgICAgYi5wYXJ0LnN0YXJ0SW5kZXggLT0gc2hpZnRBICsgc2hpZnRCZXR3ZWVuO1xuICAgICAgdGhpcy5zaGlmdEluZGV4KGIucGFydEluZGV4IC0gcmVtb3ZlZC5sZW5ndGggKyAxLCBzaGlmdEEgKyBzaGlmdEIgKyBzaGlmdEJldHdlZW4pO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCICsgc2hpZnRCZXR3ZWVuO1xuICAgIH0gZWxzZSB7XG4gICAgICBiLnBhcnQuc3RhcnRJbmRleCAtPSBzaGlmdEE7XG4gICAgICB0aGlzLnNoaWZ0SW5kZXgoYi5wYXJ0SW5kZXggKyAxLCBzaGlmdEEgKyBzaGlmdEIpO1xuICAgICAgdGhpcy5sZW5ndGggLT0gc2hpZnRBICsgc2hpZnRCO1xuICAgIH1cbiAgfVxuXG4gIC8vVE9ETzogdGhpcyBpcyBpbmVmZmljaWVudCBhcyB3ZSBjYW4gY2FsY3VsYXRlIHRoZSBpbmRleGVzIG91cnNlbHZlc1xuICBpZiAoIWEucGFydC5sZW5ndGgpIHtcbiAgICB0aGlzLnBhcnRzLnNwbGljZSh0aGlzLnBhcnRzLmluZGV4T2YoYS5wYXJ0KSwgMSk7XG4gIH1cbiAgaWYgKCFiLnBhcnQubGVuZ3RoKSB7XG4gICAgdGhpcy5wYXJ0cy5zcGxpY2UodGhpcy5wYXJ0cy5pbmRleE9mKGIucGFydCksIDEpO1xuICB9XG59O1xuXG5QYXJ0cy5wcm90b3R5cGUuc2hpZnRJbmRleCA9IGZ1bmN0aW9uKHN0YXJ0SW5kZXgsIHNoaWZ0KSB7XG4gIGZvciAodmFyIGkgPSBzdGFydEluZGV4OyBpIDwgdGhpcy5wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMucGFydHNbaV0uc3RhcnRJbmRleCAtPSBzaGlmdDtcbiAgfVxufTtcblxuUGFydHMucHJvdG90eXBlLnJlbW92ZUJlbG93T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIHZhciBvID0gdGhpcy5maW5kT2Zmc2V0SW5QYXJ0KG9mZnNldCwgcGFydClcbiAgdmFyIHNoaWZ0ID0gcmVtb3ZlKHBhcnQsIDAsIG8uaW5kZXgpLmxlbmd0aDtcbiAgdGhpcy5zaGlmdEluZGV4KG8ucGFydEluZGV4ICsgMSwgc2hpZnQpO1xuICB0aGlzLmxlbmd0aCAtPSBzaGlmdDtcbn07XG5cblBhcnRzLnByb3RvdHlwZS5maW5kT2Zmc2V0SW5QYXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBwYXJ0KSB7XG4gIG9mZnNldCAtPSBwYXJ0LnN0YXJ0T2Zmc2V0O1xuICByZXR1cm4gYmluYXJ5U2VhcmNoKHBhcnQsIG8gPT4gbyA8PSBvZmZzZXQpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlJbmRleCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gIHJldHVybiBiaW5hcnlTZWFyY2godGhpcy5wYXJ0cywgcyA9PiBzLnN0YXJ0SW5kZXggPD0gaW5kZXgpO1xufTtcblxuUGFydHMucHJvdG90eXBlLmZpbmRQYXJ0QnlPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIGJpbmFyeVNlYXJjaCh0aGlzLnBhcnRzLCBzID0+IHMuc3RhcnRPZmZzZXQgPD0gb2Zmc2V0KTtcbn07XG5cblBhcnRzLnByb3RvdHlwZS50b0FycmF5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLnBhcnRzLnJlZHVjZSgocCxuKSA9PiBwLmNvbmNhdChuKSwgW10pO1xufTtcblxuZnVuY3Rpb24gbGFzdChhcnJheSkge1xuICByZXR1cm4gYXJyYXlbYXJyYXkubGVuZ3RoIC0gMV07XG59XG5cbmZ1bmN0aW9uIHJlbW92ZShhcnJheSwgYSwgYikge1xuICBpZiAoYiA9PSBudWxsKSB7XG4gICAgcmV0dXJuIGFycmF5LnNwbGljZShhKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYXJyYXkuc3BsaWNlKGEsIGIgLSBhKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpbnNlcnQodGFyZ2V0LCBpbmRleCwgYXJyYXkpIHtcbiAgdmFyIG9wID0gYXJyYXkuc2xpY2UoKTtcbiAgb3AudW5zaGlmdChpbmRleCwgMCk7XG4gIHRhcmdldC5zcGxpY2UuYXBwbHkodGFyZ2V0LCBvcCk7XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvcG9pbnQnKTtcbnZhciBiaW5hcnlTZWFyY2ggPSByZXF1aXJlKCcuLi8uLi9saWIvYmluYXJ5LXNlYXJjaCcpO1xudmFyIFRva2VucyA9IHJlcXVpcmUoJy4vdG9rZW5zJyk7XG52YXIgVHlwZSA9IFRva2Vucy5UeXBlO1xuXG52YXIgQmVnaW4gPSAvW1xcLydcImBdL2c7XG5cbnZhciBNYXRjaCA9IHtcbiAgJ3NpbmdsZSBjb21tZW50JzogWycvLycsJ1xcbiddLFxuICAnZG91YmxlIGNvbW1lbnQnOiBbJy8qJywnKi8nXSxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IFsnYCcsJ2AnXSxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBbXCInXCIsXCInXCJdLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFsnXCInLCdcIiddLFxuICAncmVnZXhwJzogWycvJywnLyddLFxufTtcblxudmFyIFNraXAgPSB7XG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogXCJcXFxcXCIsXG4gICdzaW5nbGUgY29tbWVudCc6IGZhbHNlLFxuICAnZG91YmxlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ3JlZ2V4cCc6IFwiXFxcXFwiLFxufTtcblxudmFyIFRva2VuID0ge307XG5mb3IgKHZhciBrZXkgaW4gTWF0Y2gpIHtcbiAgdmFyIE0gPSBNYXRjaFtrZXldO1xuICBUb2tlbltNWzBdXSA9IGtleTtcbn1cblxudmFyIExlbmd0aCA9IHtcbiAgJ29wZW4gY29tbWVudCc6IDIsXG4gICdjbG9zZSBjb21tZW50JzogMixcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IDEsXG59O1xuXG52YXIgTm90T3BlbiA9IHtcbiAgJ2Nsb3NlIGNvbW1lbnQnOiB0cnVlXG59O1xuXG52YXIgQ2xvc2VzID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVGFnID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2NvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3N0cmluZycsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNlZ21lbnRzO1xuXG5mdW5jdGlvbiBTZWdtZW50cyhidWZmZXIpIHtcbiAgdGhpcy5idWZmZXIgPSBidWZmZXI7XG4gIHRoaXMuY2FjaGUgPSB7fTtcbiAgdGhpcy5yZXNldCgpO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuY2xlYXJDYWNoZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0KSB7XG4gICAgdmFyIHMgPSBiaW5hcnlTZWFyY2godGhpcy5jYWNoZS5zdGF0ZSwgcyA9PiBzLm9mZnNldCA8IG9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZS5zcGxpY2Uocy5pbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5jYWNoZS5zdGF0ZSA9IFtdO1xuICB9XG4gIHRoaXMuY2FjaGUub2Zmc2V0ID0ge307XG4gIHRoaXMuY2FjaGUucmFuZ2UgPSB7fTtcbiAgdGhpcy5jYWNoZS5wb2ludCA9IHt9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXJDYWNoZSgpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHkpIHtcbiAgaWYgKHkgaW4gdGhpcy5jYWNoZS5wb2ludCkge1xuICAgIHJldHVybiB0aGlzLmNhY2hlLnBvaW50W3ldO1xuICB9XG5cbiAgdmFyIHNlZ21lbnRzID0gdGhpcy5idWZmZXIudG9rZW5zLmdldENvbGxlY3Rpb24oJ3NlZ21lbnRzJyk7XG4gIHZhciBvcGVuID0gZmFsc2U7XG4gIHZhciBzdGF0ZSA9IG51bGw7XG4gIHZhciB3YWl0Rm9yID0gJyc7XG4gIHZhciBwb2ludCA9IHsgeDotMSwgeTotMSB9O1xuICB2YXIgY2xvc2UgPSAwO1xuICB2YXIgb2Zmc2V0O1xuICB2YXIgc2VnbWVudDtcbiAgdmFyIHJhbmdlO1xuICB2YXIgdGV4dDtcbiAgdmFyIHZhbGlkO1xuICB2YXIgbGFzdDtcblxuICB2YXIgbGFzdENhY2hlU3RhdGVPZmZzZXQgPSAwO1xuXG4gIHZhciBpID0gMDtcblxuICB2YXIgY2FjaGVTdGF0ZSA9IHRoaXMuZ2V0Q2FjaGVTdGF0ZSh5KTtcbiAgaWYgKGNhY2hlU3RhdGUgJiYgY2FjaGVTdGF0ZS5pdGVtKSB7XG4gICAgb3BlbiA9IHRydWU7XG4gICAgc3RhdGUgPSBjYWNoZVN0YXRlLml0ZW07XG4gICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICBpID0gc3RhdGUuaW5kZXggKyAxO1xuICB9XG5cbiAgZm9yICg7IGkgPCBzZWdtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIG9mZnNldCA9IHNlZ21lbnRzLmdldChpKTtcbiAgICBzZWdtZW50ID0ge1xuICAgICAgb2Zmc2V0OiBvZmZzZXQsXG4gICAgICB0eXBlOiBUeXBlW3RoaXMuYnVmZmVyLmNoYXJBdChvZmZzZXQpXVxuICAgIH07XG5cbiAgICAvLyBzZWFyY2hpbmcgZm9yIGNsb3NlIHRva2VuXG4gICAgaWYgKG9wZW4pIHtcbiAgICAgIGlmICh3YWl0Rm9yID09PSBzZWdtZW50LnR5cGUpIHtcbiAgICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgICBpZiAoIXBvaW50KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSB7XG4gICAgICAgICAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gVGFnW3N0YXRlLnR5cGVdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNlYXJjaGluZyBmb3Igb3BlbiB0b2tlblxuICAgIGVsc2Uge1xuICAgICAgcG9pbnQgPSB0aGlzLmdldE9mZnNldFBvaW50KHNlZ21lbnQub2Zmc2V0KTtcblxuICAgICAgaWYgKCFwb2ludCkge1xuICAgICAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBudWxsKTtcbiAgICAgIH1cblxuICAgICAgcmFuZ2UgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKHBvaW50LnkpLm9mZnNldFJhbmdlO1xuXG4gICAgICBpZiAobGFzdCAmJiBsYXN0LnBvaW50LnkgPT09IHBvaW50LnkpIHtcbiAgICAgICAgY2xvc2UgPSBsYXN0LnBvaW50LnggKyBMZW5ndGhbbGFzdC50eXBlXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNsb3NlID0gMDtcbiAgICAgIH1cblxuICAgICAgdmFsaWQgPSB0aGlzLmlzVmFsaWRSYW5nZShbcmFuZ2VbMF0sIHJhbmdlWzFdKzFdLCBzZWdtZW50LCBjbG9zZSk7XG5cbiAgICAgIGlmICh2YWxpZCkge1xuICAgICAgICBpZiAoTm90T3BlbltzZWdtZW50LnR5cGVdKSBjb250aW51ZTtcbiAgICAgICAgb3BlbiA9IHRydWU7XG4gICAgICAgIHN0YXRlID0gc2VnbWVudDtcbiAgICAgICAgc3RhdGUuaW5kZXggPSBpO1xuICAgICAgICBzdGF0ZS5wb2ludCA9IHBvaW50O1xuICAgICAgICAvLyBzdGF0ZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5vZmZzZXQgfTtcbiAgICAgICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICAgICAgaWYgKCF0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCB8fCB0aGlzLmNhY2hlLnN0YXRlLmxlbmd0aCAmJiBzdGF0ZS5vZmZzZXQgPiB0aGlzLmNhY2hlLnN0YXRlW3RoaXMuY2FjaGUuc3RhdGUubGVuZ3RoIC0gMV0ub2Zmc2V0KSB7XG4gICAgICAgICAgdGhpcy5jYWNoZS5zdGF0ZS5wdXNoKHN0YXRlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocG9pbnQueSA+PSB5KSBicmVhaztcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhdGUgJiYgc3RhdGUucG9pbnQueSA8IHkpIHtcbiAgICByZXR1cm4gKHRoaXMuY2FjaGUucG9pbnRbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICB9XG5cbiAgcmV0dXJuICh0aGlzLmNhY2hlLnBvaW50W3ldID0gbnVsbCk7XG59O1xuXG4vL1RPRE86IGNhY2hlIGluIEJ1ZmZlclxuU2VnbWVudHMucHJvdG90eXBlLmdldE9mZnNldFBvaW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQgaW4gdGhpcy5jYWNoZS5vZmZzZXQpIHJldHVybiB0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdO1xuICByZXR1cm4gKHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF0gPSB0aGlzLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChvZmZzZXQpKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgc2VnbWVudCwgY2xvc2UpIHtcbiAgdmFyIGtleSA9IHJhbmdlLmpvaW4oKTtcbiAgaWYgKGtleSBpbiB0aGlzLmNhY2hlLnJhbmdlKSByZXR1cm4gdGhpcy5jYWNoZS5yYW5nZVtrZXldO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldE9mZnNldFJhbmdlVGV4dChyYW5nZSk7XG4gIHZhciB2YWxpZCA9IHRoaXMuaXNWYWxpZCh0ZXh0LCBzZWdtZW50Lm9mZnNldCAtIHJhbmdlWzBdLCBjbG9zZSk7XG4gIHJldHVybiAodGhpcy5jYWNoZS5yYW5nZVtrZXldID0gdmFsaWQpO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmlzVmFsaWQgPSBmdW5jdGlvbih0ZXh0LCBvZmZzZXQsIGxhc3RJbmRleCkge1xuICBCZWdpbi5sYXN0SW5kZXggPSBsYXN0SW5kZXg7XG5cbiAgdmFyIG1hdGNoID0gQmVnaW4uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuXG4gIHZhciBpID0gbWF0Y2guaW5kZXg7XG5cbiAgbGFzdCA9IGk7XG5cbiAgdmFyIHZhbGlkID0gdHJ1ZTtcblxuICBvdXRlcjpcbiAgZm9yICg7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIG9uZSA9IHRleHRbaV07XG4gICAgdmFyIG5leHQgPSB0ZXh0W2kgKyAxXTtcbiAgICB2YXIgdHdvID0gb25lICsgbmV4dDtcbiAgICBpZiAoaSA9PT0gb2Zmc2V0KSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciBvID0gVG9rZW5bdHdvXTtcbiAgICBpZiAoIW8pIG8gPSBUb2tlbltvbmVdO1xuICAgIGlmICghbykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgdmFyIHdhaXRGb3IgPSBNYXRjaFtvXVsxXTtcblxuICAgIGxhc3QgPSBpO1xuXG4gICAgc3dpdGNoICh3YWl0Rm9yLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IG9uZSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDE7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcblxuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG4gICAgICAgICAgdHdvID0gdGV4dFtpXSArIHRleHRbaSArIDFdO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IHR3bykge1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDI7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsaWQ7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRDYWNoZVN0YXRlID0gZnVuY3Rpb24oeSkge1xuICB2YXIgcyA9IGJpbmFyeVNlYXJjaCh0aGlzLmNhY2hlLnN0YXRlLCBzID0+IHMucG9pbnQueSA8IHkpO1xuICBpZiAocy5pdGVtICYmIHkgLSAxIDwgcy5pdGVtLnBvaW50LnkpIHJldHVybiBudWxsO1xuICBlbHNlIHJldHVybiBzO1xuICAvLyByZXR1cm4gcztcbn07XG4iLCIvKlxuXG5leGFtcGxlIHNlYXJjaCBmb3Igb2Zmc2V0IGA0YCA6XG5gb2AgYXJlIG5vZGUncyBsZXZlbHMsIGB4YCBhcmUgdHJhdmVyc2FsIHN0ZXBzXG5cbnhcbnhcbm8tLT54ICAgbyAgIG9cbm8gbyB4ICAgbyAgIG8gbyBvXG5vIG8gby14IG8gbyBvIG8gb1xuMSAyIDMgNCA1IDYgNyA4IDlcblxuKi9cblxubG9nID0gY29uc29sZS5sb2cuYmluZChjb25zb2xlKTtcblxubW9kdWxlLmV4cG9ydHMgPSBTa2lwU3RyaW5nO1xuXG5mdW5jdGlvbiBOb2RlKHZhbHVlLCBsZXZlbCkge1xuICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gIHRoaXMubGV2ZWwgPSBsZXZlbDtcbiAgdGhpcy53aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKHZhbHVlICYmIHZhbHVlLmxlbmd0aCB8fCAwKTtcbiAgdGhpcy5uZXh0ID0gbmV3IEFycmF5KHRoaXMubGV2ZWwpLmZpbGwobnVsbCk7XG59XG5cbk5vZGUucHJvdG90eXBlID0ge1xuICBnZXQgbGVuZ3RoKCkge1xuICAgIHJldHVybiB0aGlzLndpZHRoWzBdO1xuICB9XG59O1xuXG5mdW5jdGlvbiBTa2lwU3RyaW5nKG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMubGV2ZWxzID0gby5sZXZlbHMgfHwgMTE7XG4gIHRoaXMuYmlhcyA9IG8uYmlhcyB8fCAxIC8gTWF0aC5FO1xuICB0aGlzLmhlYWQgPSBuZXcgTm9kZShudWxsLCB0aGlzLmxldmVscyk7XG4gIHRoaXMuY2h1bmtTaXplID0gby5jaHVua1NpemUgfHwgNTAwMDtcbn1cblxuU2tpcFN0cmluZy5wcm90b3R5cGUgPSB7XG4gIGdldCBsZW5ndGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuaGVhZC53aWR0aFt0aGlzLmxldmVscyAtIDFdO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgLy8gZ3JlYXQgaGFjayB0byBkbyBvZmZzZXQgPj0gZm9yIC5zZWFyY2goKVxuICAvLyB3ZSBkb24ndCBoYXZlIGZyYWN0aW9ucyBhbnl3YXkgc28uLlxuICByZXR1cm4gdGhpcy5zZWFyY2gob2Zmc2V0LCB0cnVlKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5pbnNlcnRDaHVua2VkKDAsIHRleHQpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2VhcmNoID0gZnVuY3Rpb24ob2Zmc2V0LCBpbmNsKSB7XG4gIGluY2wgPSBpbmNsID8gLjEgOiAwO1xuXG4gIC8vIHByZXBhcmUgdG8gaG9sZCBzdGVwc1xuICB2YXIgc3RlcHMgPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuICB2YXIgd2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbHMpO1xuXG4gIC8vIGl0ZXJhdGUgbGV2ZWxzIGRvd24sIHNraXBwaW5nIHRvcFxuICB2YXIgaSA9IHRoaXMubGV2ZWxzO1xuICB2YXIgbm9kZSA9IHRoaXMuaGVhZDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgd2hpbGUgKG9mZnNldCArIGluY2wgPiBub2RlLndpZHRoW2ldICYmIG51bGwgIT0gbm9kZS5uZXh0W2ldKSB7XG4gICAgICBvZmZzZXQgLT0gbm9kZS53aWR0aFtpXTtcbiAgICAgIG5vZGUgPSBub2RlLm5leHRbaV07XG4gICAgfVxuICAgIHN0ZXBzW2ldID0gbm9kZTtcbiAgICB3aWR0aFtpXSA9IG9mZnNldDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbm9kZTogbm9kZSxcbiAgICBzdGVwczogc3RlcHMsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIG9mZnNldDogb2Zmc2V0XG4gIH07XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zcGxpY2UgPSBmdW5jdGlvbihzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCkge1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzOyAvLyBza2lwIHN0ZXBzIGxlZnQgb2YgdGhlIG9mZnNldFxuICB2YXIgd2lkdGggPSBzLndpZHRoO1xuXG4gIHZhciBwOyAvLyBsZWZ0IG5vZGUgb3IgYHBgXG4gIHZhciBxOyAvLyByaWdodCBub2RlIG9yIGBxYCAob3VyIG5ldyBub2RlKVxuICB2YXIgbGVuO1xuXG4gIC8vIGNyZWF0ZSBuZXcgbm9kZVxuICBsZXZlbCA9IGxldmVsIHx8IHRoaXMucmFuZG9tTGV2ZWwoKTtcbiAgcSA9IG5ldyBOb2RlKHZhbHVlLCBsZXZlbCk7XG4gIGxlbmd0aCA9IHEud2lkdGhbMF07XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gaXRlcmF0ZSBzdGVwcyBsZXZlbHMgYmVsb3cgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IGxldmVsO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcCA9IHN0ZXBzW2ldOyAvLyBnZXQgbGVmdCBub2RlIG9mIHRoaXMgbGV2ZWwgc3RlcFxuICAgIHEubmV4dFtpXSA9IHAubmV4dFtpXTsgLy8gaW5zZXJ0IHNvIGluaGVyaXQgbGVmdCdzIG5leHRcbiAgICBwLm5leHRbaV0gPSBxOyAvLyBsZWZ0J3MgbmV4dCBpcyBub3cgb3VyIG5ldyBub2RlXG4gICAgcS53aWR0aFtpXSA9IHAud2lkdGhbaV0gLSB3aWR0aFtpXSArIGxlbmd0aDtcbiAgICBwLndpZHRoW2ldID0gd2lkdGhbaV07XG4gIH1cblxuICAvLyBpdGVyYXRlIHN0ZXBzIGFsbCBsZXZlbHMgZG93biB1bnRpbCBleGNlcHQgbmV3IG5vZGUgbGV2ZWxcbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbGV2ZWwpIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbFxuICAgIHAud2lkdGhbaV0gKz0gbGVuZ3RoOyAvLyBhZGQgbmV3IG5vZGUgd2lkdGhcbiAgfVxuXG4gIC8vIHJldHVybiBuZXcgbm9kZVxuICByZXR1cm4gcTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzID0gdGhpcy5zZWFyY2gob2Zmc2V0KTtcblxuICAvLyBpZiBzZWFyY2ggZmFsbHMgaW4gdGhlIG1pZGRsZSBvZiBhIHN0cmluZ1xuICAvLyBpbnNlcnQgaXQgdGhlcmUgaW5zdGVhZCBvZiBjcmVhdGluZyBhIG5ldyBub2RlXG4gIGlmIChzLm9mZnNldCAmJiBzLm5vZGUudmFsdWUgJiYgcy5vZmZzZXQgPCBzLm5vZGUudmFsdWUubGVuZ3RoKSB7XG4gICAgdGhpcy51cGRhdGUocywgaW5zZXJ0KHMub2Zmc2V0LCBzLm5vZGUudmFsdWUsIHZhbHVlKSk7XG4gICAgcmV0dXJuIHMubm9kZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLnNwbGljZShzLCBvZmZzZXQsIHZhbHVlLCBsZXZlbCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS51cGRhdGUgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICAvLyB2YWx1ZXMgbGVuZ3RoIGRpZmZlcmVuY2VcbiAgdmFyIGxlbmd0aCA9IHMubm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgLy8gdXBkYXRlIHZhbHVlXG4gIHMubm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIC8vIGl0ZXJhdG9yXG4gIHZhciBpO1xuXG4gIC8vIGZpeCB3aWR0aHMgb24gYWxsIGxldmVsc1xuICBpID0gdGhpcy5sZXZlbHM7XG5cbiAgd2hpbGUgKGktLSkge1xuICAgIHMuc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmIChyYW5nZVsxXSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ3JhbmdlIGVuZCBvdmVyIG1heGltdW0gbGVuZ3RoKCcgK1xuICAgICAgdGhpcy5sZW5ndGggKyAnKTogWycgKyByYW5nZS5qb2luKCkgKyAnXSdcbiAgICApO1xuICB9XG5cbiAgLy8gcmVtYWluIGRpc3RhbmNlIHRvIHJlbW92ZVxuICB2YXIgeCA9IHJhbmdlWzFdIC0gcmFuZ2VbMF07XG5cbiAgLy8gc2VhcmNoIGZvciBub2RlIG9uIGxlZnQgZWRnZVxuICB2YXIgcyA9IHRoaXMuc2VhcmNoKHJhbmdlWzBdKTtcbiAgdmFyIG9mZnNldCA9IHMub2Zmc2V0O1xuICB2YXIgc3RlcHMgPSBzLnN0ZXBzO1xuICB2YXIgbm9kZSA9IHMubm9kZTtcblxuICAvLyBza2lwIGhlYWRcbiAgaWYgKHRoaXMuaGVhZCA9PT0gbm9kZSkgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAvLyBzbGljZSBsZWZ0IGVkZ2Ugd2hlbiBwYXJ0aWFsXG4gIGlmIChvZmZzZXQpIHtcbiAgICBpZiAob2Zmc2V0IDwgbm9kZS53aWR0aFswXSkge1xuICAgICAgeCAtPSB0aGlzLnVwZGF0ZShzLFxuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKDAsIG9mZnNldCkgK1xuICAgICAgICBub2RlLnZhbHVlLnNsaWNlKFxuICAgICAgICAgIG9mZnNldCArXG4gICAgICAgICAgTWF0aC5taW4oeCwgbm9kZS5sZW5ndGggLSBvZmZzZXQpXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcblxuICAgIGlmICghbm9kZSkgcmV0dXJuO1xuICB9XG5cbiAgLy8gcmVtb3ZlIGFsbCBmdWxsIG5vZGVzIGluIHJhbmdlXG4gIHdoaWxlIChub2RlICYmIHggPj0gbm9kZS53aWR0aFswXSkge1xuICAgIHggLT0gdGhpcy5yZW1vdmVOb2RlKHN0ZXBzLCBub2RlKTtcbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB9XG5cbiAgLy8gc2xpY2UgcmlnaHQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKHgpIHtcbiAgICB0aGlzLnJlcGxhY2Uoc3RlcHMsIG5vZGUsIG5vZGUudmFsdWUuc2xpY2UoeCkpO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVOb2RlID0gZnVuY3Rpb24oc3RlcHMsIG5vZGUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUud2lkdGhbMF07XG5cbiAgdmFyIGk7XG5cbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGggLSBub2RlLndpZHRoW2ldO1xuICAgIHN0ZXBzW2ldLm5leHRbaV0gPSBub2RlLm5leHRbaV07XG4gIH1cblxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBub2RlLmxldmVsKSB7XG4gICAgc3RlcHNbaV0ud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgcmV0dXJuIGxlbmd0aDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UgPSBmdW5jdGlvbihzdGVwcywgbm9kZSwgdmFsdWUpIHtcbiAgdmFyIGxlbmd0aCA9IG5vZGUudmFsdWUubGVuZ3RoIC0gdmFsdWUubGVuZ3RoO1xuXG4gIG5vZGUudmFsdWUgPSB2YWx1ZTtcblxuICB2YXIgaTtcbiAgaSA9IG5vZGUubGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBub2RlLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlQ2hhckF0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnJlbW92ZShbb2Zmc2V0LCBvZmZzZXQrMV0pO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0Q2h1bmtlZCA9IGZ1bmN0aW9uKG9mZnNldCwgdGV4dCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRleHQubGVuZ3RoOyBpICs9IHRoaXMuY2h1bmtTaXplKSB7XG4gICAgdmFyIGNodW5rID0gdGV4dC5zdWJzdHIoaSwgdGhpcy5jaHVua1NpemUpO1xuICAgIHRoaXMuaW5zZXJ0KGkgKyBvZmZzZXQsIGNodW5rKTtcbiAgfVxufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc3Vic3RyaW5nID0gZnVuY3Rpb24oYSwgYikge1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKDAsIHRoaXMubGVuZ3RoKTtcbn07XG5cbmZ1bmN0aW9uIHRyaW0ocywgbGVmdCwgcmlnaHQpIHtcbiAgcmV0dXJuIHMuc3Vic3RyKDAsIHMubGVuZ3RoIC0gcmlnaHQpLnN1YnN0cihsZWZ0KTtcbn1cblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG52YXIgUiA9IFJlZ2V4cC5jcmVhdGU7XG5cbi8vTk9URTogb3JkZXIgbWF0dGVyc1xudmFyIHN5bnRheCA9IG1hcCh7XG4gICd0JzogUihbJ29wZXJhdG9yJ10sICdnJywgZW50aXRpZXMpLFxuICAnbSc6IFIoWydwYXJhbXMnXSwgICAnZycpLFxuICAnZCc6IFIoWydkZWNsYXJlJ10sICAnZycpLFxuICAnZic6IFIoWydmdW5jdGlvbiddLCAnZycpLFxuICAnayc6IFIoWydrZXl3b3JkJ10sICAnZycpLFxuICAnbic6IFIoWydidWlsdGluJ10sICAnZycpLFxuICAnbCc6IFIoWydzeW1ib2wnXSwgICAnZycpLFxuICAncyc6IFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ2UnOiBSKFsnc3BlY2lhbCcsJ251bWJlciddLCAnZycpLFxufSwgY29tcGlsZSk7XG5cbnZhciBJbmRlbnQgPSB7XG4gIHJlZ2V4cDogUihbJ2luZGVudCddLCAnZ20nKSxcbiAgcmVwbGFjZXI6IChzKSA9PiBzLnJlcGxhY2UoLyB7MSwyfXxcXHQvZywgJzx4PiQmPC94PicpXG59O1xuXG52YXIgQW55Q2hhciA9IC9cXFMvZztcblxudmFyIEJsb2NrcyA9IFIoWydjb21tZW50Jywnc3RyaW5nJywncmVnZXhwJ10sICdnbScpO1xuXG52YXIgVGFnID0ge1xuICAnLy8nOiAnYycsXG4gICcvKic6ICdjJyxcbiAgJ2AnOiAncycsXG4gICdcIic6ICdzJyxcbiAgXCInXCI6ICdzJyxcbiAgJy8nOiAncicsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bnRheDtcblxuZnVuY3Rpb24gU3ludGF4KG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMudGFiID0gby50YWIgfHwgJ1xcdCc7XG4gIHRoaXMubWF4TGluZSA9IG8ubWF4TGluZSB8fCAzMDA7XG4gIHRoaXMuYmxvY2tzID0gW107XG59XG5cblN5bnRheC5wcm90b3R5cGUuZW50aXRpZXMgPSBlbnRpdGllcztcblxuU3ludGF4LnByb3RvdHlwZS5oaWdobGlnaHQgPSBmdW5jdGlvbihjb2RlLCBvZmZzZXQpIHtcbiAgLy8gY29uc29sZS5sb2coMCwgJ2hpZ2hsaWdodCcsIGNvZGUpXG5cbiAgY29kZSA9IHRoaXMuY3JlYXRlSW5kZW50cyhjb2RlKTtcbiAgY29kZSA9IHRoaXMuY3JlYXRlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gZW50aXRpZXMoY29kZSk7XG5cbiAgZm9yICh2YXIga2V5IGluIHN5bnRheCkge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2Uoc3ludGF4W2tleV0ucmVnZXhwLCBzeW50YXhba2V5XS5yZXBsYWNlcik7XG4gIH1cblxuICBjb2RlID0gdGhpcy5yZXN0b3JlQmxvY2tzKGNvZGUpO1xuXG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoSW5kZW50LnJlZ2V4cCwgSW5kZW50LnJlcGxhY2VyKTtcbiAgLy8gY29kZSA9IGNvZGUucmVwbGFjZSgvXFxuL2csICc8YnI+JylcblxuICAvLyBjb2RlID0gY29kZS5yZXBsYWNlKC9cXHVlZWVlL2csIGZ1bmN0aW9uKCkge1xuICAvLyAgIHJldHVybiBsb25nLnNoaWZ0KCkuc2xpY2UoMCwgdGhpcy5tYXhMaW5lKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknO1xuICAvLyB9KTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlSW5kZW50cyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGxpbmVzID0gY29kZS5zcGxpdCgvXFxuL2cpO1xuICB2YXIgaW5kZW50ID0gMDtcbiAgdmFyIG1hdGNoO1xuICB2YXIgbGluZTtcbiAgdmFyIGk7XG5cbiAgaSA9IGxpbmVzLmxlbmd0aDtcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgbGluZSA9IGxpbmVzW2ldO1xuICAgIEFueUNoYXIubGFzdEluZGV4ID0gMDtcbiAgICBtYXRjaCA9IEFueUNoYXIuZXhlYyhsaW5lKTtcbiAgICBpZiAobWF0Y2gpIGluZGVudCA9IG1hdGNoLmluZGV4O1xuICAgIGVsc2UgaWYgKGluZGVudCAmJiAhbGluZS5sZW5ndGgpIHtcbiAgICAgIGxpbmVzW2ldID0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4odGhpcy50YWIpO1xuICAgIH1cbiAgfVxuXG4gIGNvZGUgPSBsaW5lcy5qb2luKCdcXG4nKTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUucmVzdG9yZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGJsb2NrO1xuICB2YXIgYmxvY2tzID0gdGhpcy5ibG9ja3M7XG4gIHZhciBuID0gMDtcbiAgcmV0dXJuIGNvZGUucmVwbGFjZSgvXFx1ZmZlYi9nLCBmdW5jdGlvbigpIHtcbiAgICBibG9jayA9IGJsb2Nrc1tuKytdXG4gICAgdmFyIHRhZyA9IGlkZW50aWZ5KGJsb2NrKTtcbiAgICByZXR1cm4gJzwnK3RhZysnPicrZW50aXRpZXMoYmxvY2spKyc8LycrdGFnKyc+JztcbiAgfSk7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdGhpcy5ibG9ja3MgPSBbXTtcbiAgY29kZSA9IGNvZGUucmVwbGFjZShCbG9ja3MsIChibG9jaykgPT4ge1xuICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgIHJldHVybiAnXFx1ZmZlYic7XG4gIH0pO1xuICByZXR1cm4gY29kZTtcbn07XG5cbmZ1bmN0aW9uIGNyZWF0ZUlkKCkge1xuICB2YXIgYWxwaGFiZXQgPSAnYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXonO1xuICB2YXIgbGVuZ3RoID0gYWxwaGFiZXQubGVuZ3RoIC0gMTtcbiAgdmFyIGkgPSA2O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcyArPSBhbHBoYWJldFtNYXRoLnJhbmRvbSgpICogbGVuZ3RoIHwgMF07XG4gIH1cbiAgcmV0dXJuIHM7XG59XG5cbmZ1bmN0aW9uIGVudGl0aWVzKHRleHQpIHtcbiAgcmV0dXJuIHRleHRcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgO1xufVxuXG5mdW5jdGlvbiBjb21waWxlKHJlZ2V4cCwgdGFnKSB7XG4gIHZhciBvcGVuVGFnID0gJzwnICsgdGFnICsgJz4nO1xuICB2YXIgY2xvc2VUYWcgPSAnPC8nICsgdGFnICsgJz4nO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IHRhZyxcbiAgICByZWdleHA6IHJlZ2V4cCxcbiAgICByZXBsYWNlcjogb3BlblRhZyArICckJicgKyBjbG9zZVRhZ1xuICB9O1xufVxuXG5mdW5jdGlvbiBtYXAob2JqLCBmbikge1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICByZXN1bHRba2V5XSA9IGZuKG9ialtrZXldLCBrZXkpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2UocGFzcywgY29kZSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhc3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHBhc3NbaV1bMF0sIHBhc3NbaV1bMV0pO1xuICB9XG4gIHJldHVybiBjb2RlO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuXG5mdW5jdGlvbiBpZGVudGlmeShibG9jaykge1xuICB2YXIgb25lID0gYmxvY2tbMF07XG4gIHZhciB0d28gPSBvbmUgKyBibG9ja1sxXTtcbiAgcmV0dXJuIFRhZ1t0d29dIHx8IFRhZ1tvbmVdO1xufVxuIiwidmFyIFBhcnRzID0gcmVxdWlyZSgnLi9wYXJ0cycpO1xuXG52YXIgVHlwZSA9IHtcbiAgJ1xcbic6ICdsaW5lcycsXG4gICd7JzogJ29wZW4gY3VybHknLFxuICAnfSc6ICdjbG9zZSBjdXJseScsXG4gICdbJzogJ29wZW4gc3F1YXJlJyxcbiAgJ10nOiAnY2xvc2Ugc3F1YXJlJyxcbiAgJygnOiAnb3BlbiBwYXJlbnMnLFxuICAnKSc6ICdjbG9zZSBwYXJlbnMnLFxuICAnLyc6ICdvcGVuIGNvbW1lbnQnLFxuICAnKic6ICdjbG9zZSBjb21tZW50JyxcbiAgJ2AnOiAndGVtcGxhdGUgc3RyaW5nJyxcbn07XG5cbi8vIHZhciBUT0tFTiA9IC9cXG4vZztcbnZhciBUT0tFTiA9IC9cXG58XFwvXFwqfFxcKlxcL3xgfFxce3xcXH18XFxbfFxcXXxcXCh8XFwpL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gVG9rZW5zO1xuXG5Ub2tlbnMuVHlwZSA9IFR5cGU7XG5cbmZ1bmN0aW9uIFRva2VucyhmYWN0b3J5KSB7XG4gIGZhY3RvcnkgPSBmYWN0b3J5IHx8IGZ1bmN0aW9uKCkgeyByZXR1cm4gbmV3IFBhcnRzOyB9O1xuXG4gIHZhciB0ID0gdGhpcy50b2tlbnMgPSB7XG4gICAgbGluZXM6IGZhY3RvcnkoKSxcbiAgICBjdXJseTogZmFjdG9yeSgpLFxuICAgIHNxdWFyZTogZmFjdG9yeSgpLFxuICAgIHBhcmVuczogZmFjdG9yeSgpLFxuICAgIHNlZ21lbnRzOiBmYWN0b3J5KCksXG4gIH07XG5cbiAgdGhpcy5jb2xsZWN0aW9uID0ge1xuICAgICdcXG4nOiB0LmxpbmVzLFxuICAgICd7JzogdC5jdXJseSxcbiAgICAnfSc6IHQuY3VybHksXG4gICAgJ1snOiB0LnNxdWFyZSxcbiAgICAnXSc6IHQuc3F1YXJlLFxuICAgICcoJzogdC5wYXJlbnMsXG4gICAgJyknOiB0LnBhcmVucyxcbiAgICAnLyc6IHQuc2VnbWVudHMsXG4gICAgJyonOiB0LnNlZ21lbnRzLFxuICAgICdgJzogdC5zZWdtZW50cyxcbiAgfTtcbn1cblxuVG9rZW5zLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfHwgMDtcblxuICB2YXIgdG9rZW5zID0gdGhpcy50b2tlbnM7XG4gIHZhciBtYXRjaDtcbiAgdmFyIHR5cGU7XG4gIHZhciBjb2xsZWN0aW9uO1xuXG4gIHdoaWxlIChtYXRjaCA9IFRPS0VOLmV4ZWModGV4dCkpIHtcbiAgICBjb2xsZWN0aW9uID0gdGhpcy5jb2xsZWN0aW9uW3RleHRbbWF0Y2guaW5kZXhdXTtcbiAgICBjb2xsZWN0aW9uLnB1c2gobWF0Y2guaW5kZXggKyBvZmZzZXQpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBzb3J0QnlOdW1iZXIoYSwgYikge1xuICByZXR1cm4gYSAtIGI7XG59XG5cblRva2Vucy5wcm90b3R5cGUudXBkYXRlID0gZnVuY3Rpb24ocmFuZ2UsIHRleHQsIHNoaWZ0KSB7XG4gIHZhciBpbnNlcnQgPSBuZXcgVG9rZW5zKEFycmF5KTtcbiAgaW5zZXJ0LmluZGV4KHRleHQsIHJhbmdlWzBdKTtcbiAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLnRva2Vucykge1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLnNoaWZ0T2Zmc2V0KHJhbmdlWzBdLCBzaGlmdCk7XG4gICAgLy8gaWYgKHNoaWZ0IDwgMCkgcmFuZ2VbMV0gKz0gc2hpZnQ7XG4gICAgdGhpcy50b2tlbnNbdHlwZV0ucmVtb3ZlUmFuZ2UocmFuZ2UpO1xuICAgIHRoaXMudG9rZW5zW3R5cGVdLmluc2VydChyYW5nZVswXSwgaW5zZXJ0LnRva2Vuc1t0eXBlXSk7XG4gIH1cbiAgLy8gY29uc29sZS5sb2cocmFuZ2UpXG4gIC8vIGNvbnNvbGUubG9nKHRoaXMudG9rZW5zLmxpbmVzLnRvQXJyYXkoKSlcbn07XG5cblRva2Vucy5wcm90b3R5cGUuZ2V0QnlJbmRleCA9IGZ1bmN0aW9uKHR5cGUsIGluZGV4KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5nZXQoaW5kZXgpO1xufTtcblxuVG9rZW5zLnByb3RvdHlwZS5nZXRDb2xsZWN0aW9uID0gZnVuY3Rpb24odHlwZSkge1xuICByZXR1cm4gdGhpcy50b2tlbnNbdHlwZV07XG59O1xuXG5Ub2tlbnMucHJvdG90eXBlLmdldEJ5T2Zmc2V0ID0gZnVuY3Rpb24odHlwZSwgb2Zmc2V0KSB7XG4gIHJldHVybiB0aGlzLnRva2Vuc1t0eXBlXS5maW5kKG9mZnNldCk7XG59O1xuIiwidmFyIG9wZW4gPSByZXF1aXJlKCcuLi9saWIvb3BlbicpO1xudmFyIHNhdmUgPSByZXF1aXJlKCcuLi9saWIvc2F2ZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnLi9idWZmZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaWxlO1xuXG5mdW5jdGlvbiBGaWxlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMucm9vdCA9ICcnO1xuICB0aGlzLnBhdGggPSAndW50aXRsZWQnO1xuICB0aGlzLmJ1ZmZlciA9IG5ldyBCdWZmZXI7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkZpbGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuRmlsZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYnVmZmVyLm9uKCdyYXcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncmF3JykpO1xuICB0aGlzLmJ1ZmZlci5vbignc2V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3NldCcpKTtcbiAgdGhpcy5idWZmZXIub24oJ3VwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2UnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdiZWZvcmUgdXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JlZm9yZSBjaGFuZ2UnKSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5wYXRoID0gcGF0aDtcbiAgdGhpcy5yb290ID0gcm9vdDtcbiAgb3Blbihyb290ICsgcGF0aCwgKGVyciwgdGV4dCkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgICAgZm4gJiYgZm4oZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5idWZmZXIuc2V0VGV4dCh0ZXh0KTtcbiAgICB0aGlzLmVtaXQoJ29wZW4nKTtcbiAgICBmbiAmJiBmbihudWxsLCB0aGlzKTtcbiAgfSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgc2F2ZSh0aGlzLnJvb3QgKyB0aGlzLnBhdGgsIHRoaXMuYnVmZmVyLnRvU3RyaW5nKCksIGZuIHx8IG5vb3ApO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmJ1ZmZlci5zZXRUZXh0KHRleHQpO1xuICB0aGlzLmVtaXQoJ3NldCcpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi9saWIvZGVib3VuY2UnKTtcblxuLypcbiAgIC4gLlxuLTEgMCAxIDIgMyA0IDVcbiAgIG5cblxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSGlzdG9yeTtcblxuZnVuY3Rpb24gSGlzdG9yeShlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMubmVlZGxlID0gMDtcbiAgdGhpcy50aW1lb3V0ID0gdHJ1ZTtcbiAgdGhpcy50aW1lU3RhcnQgPSAwO1xufVxuXG5IaXN0b3J5LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDApIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xufSwgNzAwKTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdzYXZlJywgdGhpcy5uZWVkbGUpXG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aDtcbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuXG4gIHRoaXMubmVlZGxlLS07XG5cbiAgaWYgKHRoaXMubmVlZGxlIDwgMCkgdGhpcy5uZWVkbGUgPSAwO1xuICAvLyBjb25zb2xlLmxvZygndW5kbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIHRoaXMuY2hlY2tvdXQodGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICB0aGlzLm5lZWRsZSsrO1xuICAvLyBjb25zb2xlLmxvZygncmVkbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcblxuICB0aGlzLmNoZWNrb3V0KHRoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24obikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG4gIHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlID0gY29tbWl0Lm1hcmtBY3RpdmU7XG4gIHRoaXMuZWRpdG9yLm1hcmsuc2V0KGNvbW1pdC5tYXJrLmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLnNldENhcmV0KGNvbW1pdC5jYXJldC5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5idWZmZXIudGV4dCA9IGNvbW1pdC50ZXh0LmNvcHkoKTtcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLmxpbmVzID0gY29tbWl0LmxpbmVzLmNvcHkoKTtcbiAgdGhpcy5lbWl0KCdjaGFuZ2UnKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNvbW1pdCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4ge1xuICAgIHRleHQ6IHRoaXMuZWRpdG9yLmJ1ZmZlci50ZXh0LmNvcHkoKSxcbiAgICBsaW5lczogdGhpcy5lZGl0b3IuYnVmZmVyLmxpbmVzLmNvcHkoKSxcbiAgICBjYXJldDogdGhpcy5lZGl0b3IuY2FyZXQuY29weSgpLFxuICAgIG1hcms6IHRoaXMuZWRpdG9yLm1hcmsuY29weSgpLFxuICAgIG1hcmtBY3RpdmU6IHRoaXMuZWRpdG9yLm1hcmsuYWN0aXZlXG4gIH07XG59O1xuIiwidmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG5cbnZhciBQQUdJTkdfVEhST1RUTEUgPSA2NTtcblxudmFyIGtleXMgPSBtb2R1bGUuZXhwb3J0cyA9IHtcbiAgJ2N0cmwreic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS51bmRvKCk7XG4gIH0sXG4gICdjdHJsK3knOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkucmVkbygpO1xuICB9LFxuXG4gICdob21lJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKCk7XG4gIH0sXG4gICdlbmQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKCk7XG4gIH0sXG4gICdwYWdldXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdwYWdlZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93bigpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCt1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK2Rvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oNik7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoLTEpO1xuICB9LFxuICAndXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSk7XG4gIH0sXG4gICdyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxKTtcbiAgfSxcbiAgJ2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEpO1xuICB9LFxuICAnY3RybCtyaWdodCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEpO1xuICB9LFxuXG4gICdjdHJsK2EnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICB9LFxuXG4gICdjdHJsK3NoaWZ0K3VwJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHsgYmVnaW46IHRoaXMuY2FyZXQucG9zLCBlbmQ6IHRoaXMuY2FyZXQucG9zIH0pO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoLTEsIHRoaXMubWFyay5nZXQoKSk7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKC0xKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9XG4gIH0sXG4gICdjdHJsK3NoaWZ0K2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnZW50ZXInOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmluc2VydCgnXFxuJyk7XG4gIH0sXG5cbiAgJ2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYWRkID0gMDtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICB2YXIgbGluZXMgPSBhcmVhLmVuZC55IC0gYXJlYS5iZWdpbi55O1xuICAgIGlmIChsaW5lcyAmJiBhcmVhLmVuZC54ID4gMCkgYWRkICs9IDE7XG4gICAgaWYgKCFsaW5lcykgYWRkICs9IDE7XG4gICAgbGluZXMgKz0gYWRkO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYVRleHQoYXJlYS5zZXRMZWZ0KDApLmFkZEJvdHRvbShhZGQpKTtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQoeyB4OiAwLCB5OiBhcmVhLmVuZC55IH0sIHRleHQpO1xuICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMobGluZXMpO1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKGxpbmVzLCB0cnVlKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsK2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAndGFiJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuc3VnZ2VzdCgpO1xuICAgIGlmICghcmVzKSB7XG4gICAgICB0aGlzLmluc2VydCh0aGlzLnRhYik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya1NldEFyZWEocmVzLmFyZWEpO1xuICAgICAgdGhpcy5pbnNlcnQocmVzLm5vZGUudmFsdWUpO1xuICAgIH1cbiAgfSxcblxuICAnY3RybCtmJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kLm9wZW4oKTtcbiAgfSxcblxuICAnZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKCsxKTtcbiAgfSxcbiAgJ3NoaWZ0K2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgtMSk7XG4gIH0sXG5cbiAgJ2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhZGQ7XG4gICAgdmFyIGFyZWE7XG4gICAgdmFyIHRleHQ7XG5cbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcblxuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgY2xlYXIgPSB0cnVlO1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0aGlzLm1hcmsuYWRkQm90dG9tKGFyZWEuZW5kLnggPiAwKS5zZXRMZWZ0KDApO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEodGhpcy5tYXJrLmdldCgpKTtcbiAgICB9XG5cbiAgICAvL1RPRE86IHNob3VsZCBjaGVjayBpZiBsYXN0IGxpbmUgaGFzIC8vIGFsc29cbiAgICBpZiAodGV4dC50cmltTGVmdCgpLnN1YnN0cigwLDIpID09PSAnLy8nKSB7XG4gICAgICBhZGQgPSAtMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLio/KVxcL1xcLyAoLispL2dtLCAnJDEkMicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGQgPSArMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oW1xcc10qKSguKykvZ20sICckMS8vICQyJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG5cbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEuYWRkUmlnaHQoYWRkKSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcblxuICAgIGlmIChjYXJldC54KSBjYXJldC5hZGRSaWdodChhZGQpO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQpO1xuXG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSBjbGVhciA9IHRydWU7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICBpZiAodGV4dC5zbGljZSgwLDIpID09PSAnLyonICYmIHRleHQuc2xpY2UoLTIpID09PSAnKi8nKSB7XG4gICAgICB0ZXh0ID0gdGV4dC5zbGljZSgyLC0yKTtcbiAgICAgIGFkZCAtPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkIC09IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRleHQgPSAnLyonICsgdGV4dCArICcqLyc7XG4gICAgICBhZGQgKz0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCArPSAyO1xuICAgIH1cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcbiAgICBhcmVhLmVuZC54ICs9IGFkZDtcbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldC5hZGRSaWdodChhZGQpKTtcbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxufTtcblxua2V5cy5zaW5nbGUgPSB7XG4gIC8vXG59O1xuXG4vLyBzZWxlY3Rpb24ga2V5c1xuWyAnaG9tZScsJ2VuZCcsXG4gICdwYWdldXAnLCdwYWdlZG93bicsXG4gICdsZWZ0JywndXAnLCdyaWdodCcsJ2Rvd24nLFxuICAnY3RybCtsZWZ0JywnY3RybCtyaWdodCdcbl0uZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAga2V5c1snc2hpZnQrJytrZXldID0gZnVuY3Rpb24oZSkge1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAga2V5c1trZXldLmNhbGwodGhpcywgZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH07XG59KTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLm1vdXNlID0gbmV3IE1vdXNlKHRoaXMpO1xuICB0aGlzLnRleHQgPSBuZXcgVGV4dDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSW5wdXQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSW5wdXQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJsdXIgPSB0aGlzLmJsdXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy50ZXh0Lm9uKFsna2V5JywgJ3RleHQnXSwgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2lucHV0JykpO1xuICB0aGlzLnRleHQub24oJ2ZvY3VzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJykpO1xuICB0aGlzLnRleHQub24oJ2JsdXInLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xuICB0aGlzLnRleHQucmVzZXQoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5ibHVyKCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmZvY3VzKCk7XG59O1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdXNlO1xuXG5mdW5jdGlvbiBNb3VzZSgpIHtcbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAgIC8vIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAvLyB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kb3duID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5kb3duID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkb3duJywgZSk7XG4gIHRoaXMub25jbGljayhlKTtcbiAgdGhpcy5tYXliZURyYWcoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbnVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3VwJywgZSk7XG4gIGlmICghdGhpcy5kb3duKSByZXR1cm47XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuZHJhZ0VuZCgpO1xuICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uY2xpY2sgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucmVzZXRDbGlja3MoKTtcbiAgdGhpcy5jbGlja3MgPSAodGhpcy5jbGlja3MgJSAzKSArIDE7XG4gIHRoaXMuZW1pdCgnY2xpY2snLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbm1heWJlZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG5cbiAgdmFyIGQgPVxuICAgICAgTWF0aC5hYnModGhpcy5wb2ludC54IC0gdGhpcy5kb3duLngpXG4gICAgKyBNYXRoLmFicyh0aGlzLnBvaW50LnkgLSB0aGlzLmRvd24ueSk7XG5cbiAgaWYgKGQgPiA1KSB7XG4gICAgdGhpcy5tYXliZURyYWdFbmQoKTtcbiAgICB0aGlzLmRyYWdCZWdpbigpO1xuICB9XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkcmFnJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgYmVnaW4nKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBlbmQnKTtcbn07XG5cblxuTW91c2UucHJvdG90eXBlLnJlc2V0Q2xpY2tzID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xpY2tzID0gMDtcbn0sIDM1MCk7XG5cbk1vdXNlLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xuXG52YXIgVEhST1RUTEUgPSAxMDAwLzYyO1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RleHRhcmVhJyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZScsXG4gICAgYXV0b2NvbXBsZXRlOiAnb2ZmJyxcbiAgICBzcGVsbGNoZWNraW5nOiAnb2ZmJyxcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufSwgMjAwMCk7XG5cblRleHQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5ibHVyKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmZvY3VzKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIC8vIGZvcmNlcyBjYXJldCB0byBlbmQgb2YgdGV4dGFyZWEgc28gd2UgY2FuIGdldCAuc2xpY2UoLTEpIGNoYXJcbiAgc2V0SW1tZWRpYXRlKCgpID0+IHRoaXMuZWwuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLmVsLnZhbHVlLmxlbmd0aCk7XG4gIHRoaXMuZW1pdCgndGV4dCcsIHRoaXMuZ2V0KCkpO1xuICB0aGlzLmNsZWFyKCk7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgLy8gY29uc29sZS5sb2coZS53aGljaCk7XG4gIHZhciBub3cgPSBEYXRlLm5vdygpO1xuICBpZiAobm93IC0gdGhpcy50aHJvdHRsZVRpbWUgPCBUSFJPVFRMRSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSBub3c7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0pO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXl1cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQgJiYgIWUuc2hpZnRLZXkpIGtleXMucHVzaCgnc2hpZnQ6dXAnKTtcbiAgaWYgKG0uY3RybCAmJiAhZS5jdHJsS2V5KSBrZXlzLnB1c2goJ2N0cmw6dXAnKTtcbiAgaWYgKG0uYWx0ICYmICFlLmFsdEtleSkga2V5cy5wdXNoKCdhbHQ6dXAnKTtcblxuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSArICc6dXAnKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9uY3V0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY3V0JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjb3B5JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbnBhc3RlID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgncGFzdGUnLCBlKTtcbn07XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi9saWIvcG9pbnQnKTtcblxudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3dvcmRzJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW92ZTtcblxuZnVuY3Rpb24gTW92ZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbn1cblxuTW92ZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlRG93biA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCBzaXplIC0gcmVtYWluZGVyKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcyhwYWdlKTtcbn07XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VVcCA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCAtKHNpemUgLSByZW1haW5kZXIpKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcygtcGFnZSk7XG59O1xuXG52YXIgbW92ZSA9IHt9O1xuXG5tb3ZlLmJ5V29yZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmUgPSBidWZmZXIuZ2V0TGluZVRleHQocC55KTtcblxuICBpZiAoZHggPiAwICYmIHAueCA+PSBsaW5lLmxlbmd0aCAtIDEpIHsgLy8gYXQgZW5kIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgKzEpOyAvLyBtb3ZlIG9uZSBjaGFyIHJpZ2h0XG4gIH0gZWxzZSBpZiAoZHggPCAwICYmIHAueCA9PT0gMCkgeyAvLyBhdCBiZWdpbiBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsIC0xKTsgLy8gbW92ZSBvbmUgY2hhciBsZWZ0XG4gIH1cblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UobGluZSwgV09SRFMpO1xuICB2YXIgd29yZDtcblxuICBpZiAoZHggPCAwKSB3b3Jkcy5yZXZlcnNlKCk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB3b3Jkcy5sZW5ndGg7IGkrKykge1xuICAgIHdvcmQgPSB3b3Jkc1tpXTtcbiAgICBpZiAoZHggPiAwXG4gICAgICA/IHdvcmQuaW5kZXggPiBwLnhcbiAgICAgIDogd29yZC5pbmRleCA8IHAueCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgeDogd29yZC5pbmRleCxcbiAgICAgICAgeTogcC55XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIHJlYWNoZWQgYmVnaW4vZW5kIG9mIGZpbGVcbiAgcmV0dXJuIGR4ID4gMFxuICAgID8gbW92ZS5lbmRPZkxpbmUoYnVmZmVyLCBwKVxuICAgIDogbW92ZS5iZWdpbk9mTGluZShidWZmZXIsIHApO1xufTtcblxubW92ZS5ieUNoYXJzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR4IDwgMCkgeyAvLyBnb2luZyBsZWZ0XG4gICAgeCArPSBkeDsgLy8gbW92ZSBsZWZ0XG4gICAgaWYgKHggPCAwKSB7IC8vIHdoZW4gcGFzdCBsZWZ0IGVkZ2VcbiAgICAgIGlmICh5ID4gMCkgeyAvLyBhbmQgbGluZXMgYWJvdmVcbiAgICAgICAgeSAtPSAxOyAvLyBtb3ZlIHVwIGEgbGluZVxuICAgICAgICB4ID0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoOyAvLyBhbmQgZ28gdG8gdGhlIGVuZCBvZiBsaW5lXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB4ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSBpZiAoZHggPiAwKSB7IC8vIGdvaW5nIHJpZ2h0XG4gICAgeCArPSBkeDsgLy8gbW92ZSByaWdodFxuICAgIHdoaWxlICh4IC0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoID4gMCkgeyAvLyB3aGlsZSBwYXN0IGxpbmUgbGVuZ3RoXG4gICAgICBpZiAoeSA9PT0gYnVmZmVyLmxvYygpKSB7IC8vIG9uIGVuZCBvZiBmaWxlXG4gICAgICAgIHggPSBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGg7IC8vIGdvIHRvIGVuZCBvZiBsaW5lIG9uIGxhc3QgbGluZVxuICAgICAgICBicmVhazsgLy8gYW5kIGV4aXRcbiAgICAgIH1cbiAgICAgIHggLT0gYnVmZmVyLmdldExpbmUoeSkubGVuZ3RoICsgMTsgLy8gd3JhcCB0aGlzIGxpbmUgbGVuZ3RoXG4gICAgICB5ICs9IDE7IC8vIGFuZCBtb3ZlIGRvd24gYSBsaW5lXG4gICAgfVxuICB9XG5cbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSB4O1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJ5TGluZXMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR5KSB7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHkgPCAwKSB7IC8vIGdvaW5nIHVwXG4gICAgaWYgKHkgKyBkeSA+IDApIHsgLy8gd2hlbiBsaW5lcyBhYm92ZVxuICAgICAgeSArPSBkeTsgLy8gbW92ZSB1cFxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gMDtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZHkgPiAwKSB7IC8vIGdvaW5nIGRvd25cbiAgICBpZiAoeSA8IGJ1ZmZlci5sb2MoKSAtIGR5KSB7IC8vIHdoZW4gbGluZXMgYmVsb3dcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgZG93blxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gYnVmZmVyLmxvYygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmICh4ID4gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpIHtcbiAgLy8gICB4ID0gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGg7XG4gIC8vIH0gZWxzZSB7XG4gIC8vIH1cbiAgeCA9IE1hdGgubWluKHRoaXMubGFzdERlbGliZXJhdGVYLCBidWZmZXIuZ2V0TGluZSh5KS5sZW5ndGgpO1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZMaW5lID0gZnVuY3Rpb24oXywgcCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZMaW5lID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUocC55KS5sZW5ndGg7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gSW5maW5pdHk7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkZpbGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9O1xufTtcblxubW92ZS5lbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubG9jKCk7XG4gIHZhciB4ID0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IGxhc3RcbiAgfTtcbn07XG5cbm1vdmUuaXNCZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgcmV0dXJuIHAueCA9PT0gMCAmJiBwLnkgPT09IDA7XG59O1xuXG5tb3ZlLmlzRW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYygpO1xuICByZXR1cm4gcC55ID09PSBsYXN0ICYmIHAueCA9PT0gYnVmZmVyLmdldExpbmUobGFzdCkubGVuZ3RoO1xufTtcblxuT2JqZWN0LmtleXMobW92ZSkuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgTW92ZS5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKHBhcmFtLCBieUVkaXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbW92ZVttZXRob2RdLmNhbGwoXG4gICAgICB0aGlzLFxuICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLFxuICAgICAgdGhpcy5lZGl0b3IuY2FyZXQsXG4gICAgICBwYXJhbVxuICAgICk7XG5cbiAgICBpZiAoJ2lzJyA9PT0gbWV0aG9kLnNsaWNlKDAsMikpIHJldHVybiByZXN1bHQ7XG5cbiAgICB0aGlzLmVtaXQoJ21vdmUnLCByZXN1bHQsIGJ5RWRpdCk7XG4gIH07XG59KTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1wiZWRpdG9yXCI6XCJfc3JjX3N0eWxlX19lZGl0b3JcIixcImxheWVyXCI6XCJfc3JjX3N0eWxlX19sYXllclwiLFwicm93c1wiOlwiX3NyY19zdHlsZV9fcm93c1wiLFwibWFya1wiOlwiX3NyY19zdHlsZV9fbWFya1wiLFwiY29kZVwiOlwiX3NyY19zdHlsZV9fY29kZVwiLFwiY2FyZXRcIjpcIl9zcmNfc3R5bGVfX2NhcmV0XCIsXCJndXR0ZXJcIjpcIl9zcmNfc3R5bGVfX2d1dHRlclwiLFwicnVsZXJcIjpcIl9zcmNfc3R5bGVfX3J1bGVyXCIsXCJhYm92ZVwiOlwiX3NyY19zdHlsZV9fYWJvdmVcIixcImZpbmRcIjpcIl9zcmNfc3R5bGVfX2ZpbmRcIixcImJsb2NrXCI6XCJfc3JjX3N0eWxlX19ibG9ja1wifSIsInZhciBkb20gPSByZXF1aXJlKCcuLi9saWIvZG9tJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zdHlsZS5jc3MnKTtcblxudmFyIHRoZW1lcyA9IHtcbiAgbW9ub2thaToge1xuICAgIGJhY2tncm91bmQ6ICcjMjcyODIyJyxcbiAgICBjb2xvcjogJyNGOEY4RjInLFxuICAgIGtleXdvcmQ6ICcjREYyMjY2JyxcbiAgICBmdW5jdGlvbjogJyNBMEQ5MkUnLFxuICAgIGRlY2xhcmU6ICcjNjFDQ0UwJyxcbiAgICBudW1iZXI6ICcjQUI3RkZCJyxcbiAgICBwYXJhbXM6ICcjRkQ5NzFGJyxcbiAgICBjb21tZW50OiAnIzc1NzE1RScsXG4gICAgc3RyaW5nOiAnI0U2REI3NCcsXG4gIH0sXG5cbiAgd2VzdGVybjoge1xuICAgIGJhY2tncm91bmQ6ICcjRDlEMUIxJyxcbiAgICBjb2xvcjogJyMwMDAwMDAnLFxuICAgIGtleXdvcmQ6ICcjN0EzQjNCJyxcbiAgICBmdW5jdGlvbjogJyMyNTZGNzUnLFxuICAgIGRlY2xhcmU6ICcjNjM0MjU2JyxcbiAgICBudW1iZXI6ICcjMTM0RDI2JyxcbiAgICBwYXJhbXM6ICcjMDgyNjYzJyxcbiAgICBjb21tZW50OiAnIzk5OEU2RScsXG4gICAgc3RyaW5nOiAnI0M0M0MzQycsXG4gIH0sXG5cbiAgZXJnb25vbToge1xuICAgIGJhY2tncm91bmQ6ICcjMjcxRTE2JyxcbiAgICBjb2xvcjogJyNFOUUzRDEnLFxuICAgIGtleXdvcmQ6ICcjQTEzNjMwJyxcbiAgICBmdW5jdGlvbjogJyNCM0RGMDInLFxuICAgIGRlY2xhcmU6ICcjRjYzODMzJyxcbiAgICBudW1iZXI6ICcjRkY5RjRFJyxcbiAgICBwYXJhbXM6ICcjQTA5MEEwJyxcbiAgICByZWdleHA6ICcjQkQ3MEY0JyxcbiAgICBjb21tZW50OiAnIzYzNTA0NycsXG4gICAgc3RyaW5nOiAnIzNFQTFGQicsXG4gIH0sXG5cbiAgZGF5bGlnaHQ6IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0VCRUJFQicsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnI0ZGMUIxQicsXG4gICAgZnVuY3Rpb246ICcjMDAwNUZGJyxcbiAgICBkZWNsYXJlOiAnIzBDN0EwMCcsXG4gICAgbnVtYmVyOiAnIzgwMjFENCcsXG4gICAgcGFyYW1zOiAnIzRDNjk2OScsXG4gICAgY29tbWVudDogJyNBQkFCQUInLFxuICAgIHN0cmluZzogJyNFNjcwMDAnLFxuICB9LFxufTtcblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gc2V0VGhlbWU7XG5leHBvcnRzLnRoZW1lcyA9IHRoZW1lcztcblxuLypcbnQ6IG9wZXJhdG9yXG5rOiBrZXl3b3JkXG5kOiBkZWNsYXJlXG5iOiBidWlsdGluXG5vOiBib29sZWFuXG5uOiBudW1iZXJcbm06IHBhcmFtc1xuZjogZnVuY3Rpb25cbnI6IHJlZ2V4cFxuYzogY29tbWVudFxuczogc3RyaW5nXG5sOiBzeW1ib2xcbng6IGluZGVudFxuICovXG5mdW5jdGlvbiBzZXRUaGVtZShuYW1lKSB7XG4gIHZhciB0ID0gdGhlbWVzW25hbWVdO1xuICBkb20uY3NzKCd0aGVtZScsXG5gXG4uJHtuYW1lfSB7XG4gIGJhY2tncm91bmQ6ICR7dC5iYWNrZ3JvdW5kfTtcbn1cblxudCxcbmsge1xuICBjb2xvcjogJHt0LmtleXdvcmR9O1xufVxuXG5kLFxubiB7XG4gIGNvbG9yOiAke3QuZGVjbGFyZX07XG59XG5cbm8sXG5lIHtcbiAgY29sb3I6ICR7dC5udW1iZXJ9O1xufVxuXG5tIHtcbiAgY29sb3I6ICR7dC5wYXJhbXN9O1xufVxuXG5mIHtcbiAgY29sb3I6ICR7dC5mdW5jdGlvbn07XG4gIGZvbnQtc3R5bGU6IG5vcm1hbDtcbn1cblxuciB7XG4gIGNvbG9yOiAke3QucmVnZXhwIHx8IHQucGFyYW1zfTtcbn1cblxuYyB7XG4gIGNvbG9yOiAke3QuY29tbWVudH07XG59XG5cbnMge1xuICBjb2xvcjogJHt0LnN0cmluZ307XG59XG5cbmwsXG4uJHtjc3MuY29kZX0ge1xuICBjb2xvcjogJHt0LmNvbG9yfTtcbn1cblxuLiR7Y3NzLmNhcmV0fSB7XG4gIGJhY2tncm91bmQ6ICR7dC5jb2xvcn07XG59XG5cbm0sXG5kIHtcbiAgZm9udC1zdHlsZTogaXRhbGljO1xufVxuXG5sIHtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG54IHtcbiAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICBiYWNrZ3JvdW5kLXJlcGVhdDogbm8tcmVwZWF0O1xufVxuYFxuICApXG5cbn1cblxuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEJsb2NrO1xuXG5mdW5jdGlvbiBCbG9jayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbkJsb2NrLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkJsb2NrLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yZW5kZXJQYWdlKDEsIHRydWUpO1xufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBDb2RlO1xuXG5mdW5jdGlvbiBDb2RlKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCA3KTtcbn1cblxuQ29kZS5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5Db2RlLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuXG4gIGlmICghdGhpcy5lZGl0b3IuZWRpdGluZykge1xuICAgIHRoaXMucmVuZGVyQWhlYWQoKTtcbiAgfVxufTtcblxuQ29kZS5wcm90b3R5cGUucmVuZGVyRWRpdCA9IGZ1bmN0aW9uKGVkaXQpIHtcbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuXG4gIHZhciB5ID0gZWRpdC5saW5lO1xuICB2YXIgZyA9IGVkaXQucmFuZ2Uuc2xpY2UoKTtcbiAgdmFyIHNoaWZ0ID0gZWRpdC5zaGlmdDtcbiAgdmFyIGlzRW50ZXIgPSBzaGlmdCA+IDA7XG4gIHZhciBpc0JhY2tzcGFjZSA9IHNoaWZ0IDwgMDtcbiAgdmFyIGlzQmVnaW4gPSBnWzBdICsgaXNCYWNrc3BhY2UgPT09IDA7XG4gIHZhciBpc0VuZCA9IGdbMV0gKyBpc0VudGVyID09PSB0aGlzLmVkaXRvci5yb3dzO1xuXG4gIGlmIChzaGlmdCkge1xuICAgIGlmIChpc0VudGVyKSB7XG4gICAgICB0aGlzLmNsZWFyT3V0UGFnZVJhbmdlKFswLDBdKTtcbiAgICAgIGlmICghdGhpcy5oYXNWaWV3VG9wQXQoZWRpdC5jYXJldE5vdy55KSB8fCBlZGl0LmNhcmV0QmVmb3JlLnggPiAwKSB7XG4gICAgICAgIHRoaXMuc2hpZnRWaWV3c0JlbG93KGVkaXQuY2FyZXROb3cueSArIDEsIDEpO1xuICAgICAgICB0aGlzLnNwbGl0RW50ZXIoZWRpdC5jYXJldE5vdy55KTtcbiAgICAgICAgaWYgKGVkaXQuY2FyZXRCZWZvcmUueCA+IDApIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZVJhbmdlKFtlZGl0LmNhcmV0QmVmb3JlLnksIGVkaXQuY2FyZXRCZWZvcmUueV0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhlZGl0LmNhcmV0Tm93LnksIDEpO1xuICAgICAgfVxuICAgICAgdGhpcy5yZW5kZXJQYWdlQmVsb3coZWRpdC5jYXJldE5vdy55KzEpO1xuICAgIH1cbiAgICBlbHNlIGlmIChpc0JhY2tzcGFjZSkge1xuICAgICAgdGhpcy5jbGVhck91dFBhZ2VSYW5nZShbMCwxXSk7XG4gICAgICB0aGlzLnNob3J0ZW5Cb3R0b21BdChlZGl0LmNhcmV0Tm93LnkpO1xuICAgICAgdGhpcy5zaGlmdFZpZXdzQmVsb3coZWRpdC5jYXJldE5vdy55KzEsIC0xKTtcbiAgICAgIGlmICghdGhpcy5oYXNWaWV3VG9wQXQoZWRpdC5jYXJldE5vdy55KSkge1xuICAgICAgICB0aGlzLnNwbGl0QmFja3NwYWNlKGVkaXQuY2FyZXROb3cueSk7XG4gICAgICB9XG4gICAgICBpZiAoZWRpdC5jYXJldE5vdy54ID4gMCkge1xuICAgICAgICB0aGlzLnVwZGF0ZVJhbmdlKFtlZGl0LmNhcmV0Tm93LnksIGVkaXQuY2FyZXROb3cueV0pO1xuICAgICAgfVxuICAgICAgdGhpcy5yZW5kZXJQYWdlQmVsb3coZWRpdC5jYXJldE5vdy55KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhpcy51cGRhdGVSYW5nZShnKTtcbiAgICB0aGlzLnJlbmRlclBhZ2UoMCk7XG4gIH1cbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmluZDtcblxuZnVuY3Rpb24gRmluZChuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNCk7XG59XG5cbkZpbmQucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuRmluZC5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IuZmluZC5pc09wZW4gfHwgIXRoaXMuZWRpdG9yLmZpbmRSZXN1bHRzLmxlbmd0aCkgcmV0dXJuO1xuICB0aGlzLnJlbmRlclBhZ2UoMCk7XG59O1xuIiwidmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG52YXIgQ29kZVZpZXcgPSByZXF1aXJlKCcuL2NvZGUnKTtcbnZhciBNYXJrVmlldyA9IHJlcXVpcmUoJy4vbWFyaycpO1xudmFyIFJvd3NWaWV3ID0gcmVxdWlyZSgnLi9yb3dzJyk7XG52YXIgRmluZFZpZXcgPSByZXF1aXJlKCcuL2ZpbmQnKTtcbnZhciBCbG9ja1ZpZXcgPSByZXF1aXJlKCcuL2Jsb2NrJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXdzO1xuXG5mdW5jdGlvbiBWaWV3cyhlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG5cbiAgdGhpcy52aWV3cyA9IFtcbiAgICBuZXcgVmlldygncnVsZXInLCBlZGl0b3IsIHRlbXBsYXRlLnJ1bGVyKSxcbiAgICBuZXcgVmlldygnY2FyZXQnLCBlZGl0b3IsIHRlbXBsYXRlLmNhcmV0KSxcbiAgICBuZXcgQ29kZVZpZXcoJ2NvZGUnLCBlZGl0b3IsIHRlbXBsYXRlLmNvZGUpLFxuICAgIG5ldyBNYXJrVmlldygnbWFyaycsIGVkaXRvciwgdGVtcGxhdGUubWFyayksXG4gICAgbmV3IFJvd3NWaWV3KCdyb3dzJywgZWRpdG9yLCB0ZW1wbGF0ZS5yb3dzKSxcbiAgICAvLyBuZXcgRmluZFZpZXcoJ2ZpbmQnLCBlZGl0b3IsIHRlbXBsYXRlLmZpbmQpLFxuICAgIG5ldyBCbG9ja1ZpZXcoJ2Jsb2NrJywgZWRpdG9yLCB0ZW1wbGF0ZS5ibG9jayksXG4gIF07XG5cbiAgdGhpcy52aWV3cy5mb3JFYWNoKHZpZXcgPT4gdGhpc1t2aWV3Lm5hbWVdID0gdmlldyk7XG4gIHRoaXMuZm9yRWFjaCA9IHRoaXMudmlld3MuZm9yRWFjaC5iaW5kKHRoaXMudmlld3MpO1xuXG4gIHRoaXMuYmxvY2sucmVuZGVyID0gZGVib3VuY2UodGhpcy5ibG9jay5yZW5kZXIsIDYwKTtcblxuICAvL1RPRE86IG5lZWRzIHRvIGJlIHNldCBkeW5hbWljYWxseVxuICBpZiAodGhpcy5lZGl0b3Iub3B0aW9ucy5oaWRlX3Jvd3MpIHRoaXMucm93cy5yZW5kZXIgPSBub29wO1xufVxuXG5WaWV3cy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JFYWNoKHZpZXcgPT4gdmlldy5jbGVhcigpKTtcbn0sXG5cblZpZXdzLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5mb3JFYWNoKHZpZXcgPT4gdmlldy5yZW5kZXIoKSk7XG59O1xuXG5mdW5jdGlvbiBub29wKCkgey8qIG5vb3AgKi99XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG5cbnZhciBBaGVhZFRocmVzaG9sZCA9IHtcbiAgYW5pbWF0aW9uOiBbLjE1LCAuNF0sXG4gIG5vcm1hbDogWzEuNSwgM11cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gTGF5ZXI7XG5cbmZ1bmN0aW9uIExheWVyKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIGxlbmd0aCkge1xuICB0aGlzLmRvbSA9IGRvbShjc3MubGF5ZXIpO1xuICB0aGlzLm5hbWUgPSBuYW1lO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy50ZW1wbGF0ZSA9IHRlbXBsYXRlO1xuICB0aGlzLnZpZXdzID0gdGhpcy5jcmVhdGUobGVuZ3RoKTtcbn1cblxuTGF5ZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuTGF5ZXIucHJvdG90eXBlLmNyZWF0ZSA9IGZ1bmN0aW9uKGxlbmd0aCkge1xuICB2YXIgdmlld3MgPSBuZXcgQXJyYXkobGVuZ3RoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZpZXdzW2ldID0gbmV3IFZpZXcodGhpcy5uYW1lLCB0aGlzLmVkaXRvciwgdGhpcy50ZW1wbGF0ZSk7XG4gICAgZG9tLmFwcGVuZCh0aGlzLCB2aWV3c1tpXSk7XG4gIH1cbiAgcmV0dXJuIHZpZXdzO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlcXVlc3RWaWV3ID0gZnVuY3Rpb24oKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlldy52aXNpYmxlID09PSBmYWxzZSkgcmV0dXJuIHZpZXc7XG4gIH1cbiAgcmV0dXJuIHRoaXMuY2xlYXIoKVswXTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gdGhpcy5lZGl0b3IuZ2V0UGFnZVJhbmdlKHJhbmdlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5pblJhbmdlVmlld3MgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgdmlld3MgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICggdmlldy52aXNpYmxlID09PSB0cnVlXG4gICAgICAmJiAoIHZpZXdbMF0gPj0gcmFuZ2VbMF0gJiYgdmlld1swXSA8PSByYW5nZVsxXVxuICAgICAgICB8fCB2aWV3WzFdID49IHJhbmdlWzBdICYmIHZpZXdbMV0gPD0gcmFuZ2VbMV0gKSApIHtcbiAgICAgIHZpZXdzLnB1c2godmlldyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB2aWV3cztcbn07XG5cbkxheWVyLnByb3RvdHlwZS5vdXRSYW5nZVZpZXdzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHZpZXdzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAoIHZpZXcudmlzaWJsZSA9PT0gZmFsc2VcbiAgICAgIHx8IHZpZXdbMV0gPCByYW5nZVswXVxuICAgICAgfHwgdmlld1swXSA+IHJhbmdlWzFdICkge1xuICAgICAgdmlld3MucHVzaCh2aWV3KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZpZXdzLnNvcnQoKGEsYikgPT4gYS5sYXN0VXNlZCAtIGIubGFzdFVzZWQpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclJhbmdlcyA9IGZ1bmN0aW9uKHJhbmdlcywgdmlld3MpIHtcbiAgZm9yICh2YXIgbiA9IDAsIGkgPSAwOyBpIDwgcmFuZ2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHJhbmdlID0gcmFuZ2VzW2ldO1xuICAgIHZhciB2aWV3ID0gdmlld3NbbisrXTtcbiAgICB2aWV3LnJlbmRlcihyYW5nZSk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlLCBpbmNsdWRlKSB7XG4gIHZhciB2aXNpYmxlUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbMCwwXSk7XG4gIHZhciBpblZpZXdzID0gdGhpcy5pblJhbmdlVmlld3MocmFuZ2UpO1xuICB2YXIgb3V0Vmlld3MgPSB0aGlzLm91dFJhbmdlVmlld3MobWF4KHJhbmdlLCB2aXNpYmxlUmFuZ2UpKTtcblxuICB2YXIgbmVlZFJhbmdlcyA9IFJhbmdlLk5PVChyYW5nZSwgaW5WaWV3cyk7XG4gIHZhciBuZWVkVmlld3MgPSBuZWVkUmFuZ2VzLmxlbmd0aCAtIG91dFZpZXdzLmxlbmd0aDtcbiAgaWYgKG5lZWRWaWV3cyA+IDApIHtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXJSYW5nZXMoW3Zpc2libGVSYW5nZV0sIHRoaXMudmlld3MpO1xuICAgIHJldHVybjtcbiAgfVxuICBlbHNlIGlmIChpbmNsdWRlKSB0aGlzLnJlbmRlclZpZXdzKGluVmlld3MpO1xuICB0aGlzLnJlbmRlclJhbmdlcyhuZWVkUmFuZ2VzLCBvdXRWaWV3cyk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyVmlld3MgPSBmdW5jdGlvbih2aWV3cykge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmlld3NbaV0ucmVuZGVyKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJMaW5lID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLnJlbmRlclJhbmdlKFt5LHldKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJQYWdlID0gZnVuY3Rpb24obiwgaW5jbHVkZSkge1xuICBuID0gbiB8fCAwO1xuICB0aGlzLnJlbmRlclJhbmdlKHRoaXMuZ2V0UGFnZVJhbmdlKFstbiwrbl0pLCBpbmNsdWRlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJBaGVhZCA9IGZ1bmN0aW9uKGluY2x1ZGUpIHtcbiAgdmFyIHZpZXdzID0gdGhpcy52aWV3cztcbiAgdmFyIGN1cnJlbnRQYWdlUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbMCwwXSk7XG5cbiAgLy8gbm8gdmlldyBpcyB2aXNpYmxlLCByZW5kZXIgY3VycmVudCBwYWdlIG9ubHlcbiAgaWYgKFJhbmdlLkFORChjdXJyZW50UGFnZVJhbmdlLCB2aWV3cykubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5yZW5kZXJQYWdlKDApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGNoZWNrIGlmIHdlJ3JlIHBhc3QgdGhlIHRocmVzaG9sZCBvZiB2aWV3XG4gIHZhciB0aHJlc2hvbGQgPSB0aGlzLmVkaXRvci5hbmltYXRpb25SdW5uaW5nXG4gICAgPyBbLUFoZWFkVGhyZXNob2xkLmFuaW1hdGlvblswXSwgK0FoZWFkVGhyZXNob2xkLmFuaW1hdGlvblswXV1cbiAgICA6IFstQWhlYWRUaHJlc2hvbGQubm9ybWFsWzBdLCArQWhlYWRUaHJlc2hvbGQubm9ybWFsWzBdXTtcblxuICB2YXIgYWhlYWRSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKHRocmVzaG9sZCk7XG4gIHZhciBhaGVhZE5lZWRSYW5nZXMgPSBSYW5nZS5OT1QoYWhlYWRSYW5nZSwgdmlld3MpO1xuICBpZiAoYWhlYWROZWVkUmFuZ2VzLmxlbmd0aCkge1xuICAgIC8vIGlmIHNvLCByZW5kZXIgZnVydGhlciBhaGVhZCB0byBoYXZlIHNvbWVcbiAgICAvLyBtYXJnaW4gdG8gc2Nyb2xsIHdpdGhvdXQgdHJpZ2dlcmluZyBuZXcgcmVuZGVyc1xuICAgIHRoaXMucmVuZGVyUGFnZShcbiAgICAgIHRoaXMuZWRpdG9yLmFuaW1hdGlvblJ1bm5pbmdcbiAgICAgICAgPyBBaGVhZFRocmVzaG9sZC5hbmltYXRpb25bMV1cbiAgICAgICAgOiBBaGVhZFRocmVzaG9sZC5ub3JtYWxbMV0sXG4gICAgICBpbmNsdWRlXG4gICAgKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnNwbGljZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuXG4gICAgaWYgKHZpZXdbMV0gPCByYW5nZVswXSB8fCB2aWV3WzBdID4gcmFuZ2VbMV0pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICh2aWV3WzBdIDwgcmFuZ2VbMF0gJiYgdmlld1sxXSA+PSByYW5nZVswXSkgeyAvLyBzaG9ydGVuIGFib3ZlXG4gICAgICB2aWV3WzFdID0gcmFuZ2VbMF0gLSAxO1xuICAgICAgdmlldy5zdHlsZSgpO1xuICAgIH0gZWxzZSBpZiAodmlld1sxXSA+IHJhbmdlWzFdKSB7IC8vIHNob3J0ZW4gYmVsb3dcbiAgICAgIHZpZXdbMF0gPSByYW5nZVsxXSArIDE7XG4gICAgICB2aWV3LnJlbmRlcigpO1xuICAgIH0gZWxzZSBpZiAodmlld1swXSA9PT0gcmFuZ2VbMF0gJiYgdmlld1sxXSA9PT0gcmFuZ2VbMV0pIHsgLy8gY3VycmVudCBsaW5lXG4gICAgICB2aWV3LnJlbmRlcigpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2aWV3LmNsZWFyKCk7XG4gICAgfVxuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUuaGFzVmlld1RvcEF0ID0gZnVuY3Rpb24oeSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMF0gPT09IHkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5zaG9ydGVuQm90dG9tQXQgPSBmdW5jdGlvbih5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1sxXSA9PT0geSkge1xuICAgICAgdmlld1sxXSAtPSAxO1xuICAgICAgdmlldy5zdHlsZSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5zcGxpdEVudGVyID0gZnVuY3Rpb24oeSkge1xuICB2YXIgcGFnZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXdbMF0gPD0geSAmJiB2aWV3WzFdID49IHkpIHtcbiAgICAgIHZhciBib3R0b20gPSB2aWV3WzFdO1xuICAgICAgdmlld1sxXSA9IHkgLSAxO1xuICAgICAgdmlldy5zdHlsZSgpO1xuICAgICAgdGhpcy5yZW5kZXJSYW5nZShbeSsxLCBNYXRoLm1pbihwYWdlUmFuZ2VbMV0sIGJvdHRvbSsxKV0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5zcGxpdEJhY2tzcGFjZSA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDFdKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3WzBdIDw9IHkgJiYgdmlld1sxXSA+PSB5KSB7XG4gICAgICB2YXIgYm90dG9tID0gdmlld1sxXTtcbiAgICAgIHZpZXdbMV0gPSB5IC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICAgIHRoaXMucmVuZGVyUmFuZ2UoW3ksIE1hdGgubWluKHBhZ2VSYW5nZVsxXSwgYm90dG9tKzEpXSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnNoaWZ0Vmlld3NCZWxvdyA9IGZ1bmN0aW9uKHksIGR5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8IHkpIGNvbnRpbnVlO1xuXG4gICAgdmlld1swXSArPSBkeTtcbiAgICB2aWV3WzFdICs9IGR5O1xuICAgIHZpZXcuc3R5bGUoKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLmNsZWFyT3V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdGhpcy5vdXRSYW5nZVZpZXdzKHRoaXMuZ2V0UGFnZVJhbmdlKHJhbmdlKSkuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUGFnZUJlbG93ID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLnJlbmRlclJhbmdlKFt5LCB0aGlzLmdldFBhZ2VSYW5nZShbMCwwXSlbMV1dKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS51cGRhdGVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMuc3BsaWNlUmFuZ2UocmFuZ2UpO1xuICB0aGlzLnJlbmRlclJhbmdlKHJhbmdlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnZpZXdzW2ldLmNsZWFyKCk7XG4gIH1cbiAgcmV0dXJuIHRoaXMudmlld3M7XG59O1xuXG5mdW5jdGlvbiBtYXgoYSwgYikge1xuICByZXR1cm4gW01hdGgubWluKGFbMF0sIGJbMF0pLCBNYXRoLm1heChhWzFdLCBiWzFdKV07XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFyaztcblxuZnVuY3Rpb24gTWFyayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbk1hcmsucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuTWFyay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IubWFyay5hY3RpdmUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUm93cztcblxuZnVuY3Rpb24gUm93cyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNyk7XG59XG5cblJvd3MucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuUm93cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIC8vIHRoaXMuY2xlYXIoKTtcbiAgLy8gcmV0dXJuIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcblxuICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICB2YXIgcm93cyA9IHRoaXMuZWRpdG9yLnJvd3M7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHZpZXdzW2ldO1xuICAgIHZhciByID0gdmlldztcbiAgICBpZiAoIXZpZXcudmlzaWJsZSkgY29udGludWU7XG5cbiAgICBpZiAoclsxXSA+IHJvd3MpIHZpZXcuY2xlYXIoKTtcbiAgfVxuXG4gIHRoaXMucmVuZGVyQWhlYWQoKTtcbn07XG4iLCJ2YXIgdGVtcGxhdGUgPSBleHBvcnRzO1xuXG50ZW1wbGF0ZS5jb2RlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgLy8gaWYgKHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5wYXJhbSA9PT0gY29kZSkge1xuICAvLyAgIHJldHVybiB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucmVzdWx0O1xuICAvLyB9IGVsc2Uge1xuICAvLyAgIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5wYXJhbSA9IGNvZGU7XG4gIC8vICAgdGVtcGxhdGUuY29kZS5tZW1vaXplLnJlc3VsdCA9IGZhbHNlO1xuICAvLyB9XG5cbiAgLy8gdmFyIGh0bWwgPSBlLmJ1ZmZlci5nZXRIaWdobGlnaHRlZChyYW5nZSk7XG4gIHZhciBodG1sID0gZS5idWZmZXIuZ2V0KHJhbmdlKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbi8vIHNpbmdsZXRvbiBtZW1vaXplIGZvciBmYXN0IGxhc3QgcmVwZWF0aW5nIHZhbHVlXG50ZW1wbGF0ZS5jb2RlLm1lbW9pemUgPSB7XG4gIHBhcmFtOiAnJyxcbiAgcmVzdWx0OiAnJ1xufTtcblxudGVtcGxhdGUucm93cyA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBzID0gJyc7XG4gIGZvciAodmFyIGkgPSByYW5nZVswXTsgaSA8PSByYW5nZVsxXTsgaSsrKSB7XG4gICAgcyArPSAoaSArIDEpICsgJ1xcbic7XG4gIH1cbiAgcmV0dXJuIHM7XG59O1xuXG50ZW1wbGF0ZS5tYXJrID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldHMgPSBlLmJ1ZmZlci5nZXRMaW5lUmFuZ2VPZmZzZXRzKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcblxuICBhcmVhWzBdIC09IG9mZnNldHNbMF07XG4gIGFyZWFbMV0gLT0gb2Zmc2V0c1swXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKSArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciB0YWJzO1xuICB2YXIgcjtcbiAgd2hpbGUgKHJlc3VsdHNbaV0gJiYgcmVzdWx0c1tpXS55IDwgcmFuZ2VbMV0pIHtcbiAgICByID0gcmVzdWx0c1tpKytdO1xuICAgIHRhYnMgPSBlLmdldFBvaW50VGFicyhyKTtcbiAgICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgICArICd3aWR0aDonICsgd2lkdGggKyAnOydcbiAgICAgICAgICArICd0b3A6JyArIChyLnkgKiBlLmNoYXIuaGVpZ2h0KSArICdweDsnXG4gICAgICAgICAgKyAnbGVmdDonICsgKChyLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcikgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIGlmIChlLmVkaXRpbmcpIHJldHVybiAnJztcblxuICB2YXIgb2Zmc2V0ID0gZS5idWZmZXIuZ2V0TGluZU9mZnNldChyYW5nZVswXSk7XG4gIHZhciB0YXJnZXQgPSBlLmJ1ZmZlci5nZXRQb2ludChlLmNhcmV0KS5vZmZzZXQ7XG4gIHZhciBjb2RlID0gZS5idWZmZXIuZ2V0TGluZVJhbmdlVGV4dChyYW5nZSk7XG4gIHZhciBpID0gdGFyZ2V0IC0gb2Zmc2V0O1xuICB2YXIgY2hhcjtcblxuICB2YXIgT3BlbiA9IHtcbiAgICAneyc6ICdjdXJseScsXG4gICAgJ1snOiAnc3F1YXJlJyxcbiAgICAnKCc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIENsb3NlID0ge1xuICAgICd9JzogJ2N1cmx5JyxcbiAgICAnXSc6ICdzcXVhcmUnLFxuICAgICcpJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgb3BlbjtcbiAgdmFyIGNsb3NlO1xuXG4gIHZhciBjb3VudCA9IDE7XG4gIGkgLT0gMTtcbiAgd2hpbGUgKGkgPiAwKSB7XG4gICAgY2hhciA9IGNvZGVbaV07XG4gICAgb3BlbiA9IE9wZW5bY2hhcl07XG4gICAgaWYgKENsb3NlW2NoYXJdKSBjb3VudCsrO1xuICAgIGlmIChvcGVuICYmICEtLWNvdW50KSBicmVhaztcbiAgICBpLS07XG4gIH1cblxuICBpZiAoIW9wZW4pIHJldHVybiAnJztcblxuICB2YXIgYmVnaW4gPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChpICsgb2Zmc2V0KTtcblxuICBjb3VudCA9IDE7XG4gIGkgKz0gMTtcblxuICB3aGlsZSAoaSA8IGNvZGUubGVuZ3RoKSB7XG4gICAgY2hhciA9IGNvZGVbaV07XG4gICAgY2xvc2UgPSBDbG9zZVtjaGFyXTtcbiAgICBpZiAoT3BlbltjaGFyXSA9PT0gb3BlbikgY291bnQrKztcbiAgICBpZiAob3BlbiA9PT0gY2xvc2UpIGNvdW50LS07XG5cbiAgICBpZiAoIWNvdW50KSBicmVhaztcbiAgICBpKys7XG4gIH1cblxuICBpZiAoIWNsb3NlKSByZXR1cm4gJyAnO1xuXG4gIHZhciBlbmQgPSBlLmJ1ZmZlci5nZXRPZmZzZXRQb2ludChpICsgb2Zmc2V0KTtcblxuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciB0YWJzO1xuXG4gIHRhYnMgPSBlLmdldFBvaW50VGFicyhiZWdpbik7XG5cbiAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICsgJ3dpZHRoOicgKyBlLmNoYXIud2lkdGggKyAncHg7J1xuICAgICAgICArICd0b3A6JyArIChiZWdpbi55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoKGJlZ2luLnggKyB0YWJzLnRhYnMgKiBlLnRhYlNpemUgLSB0YWJzLnJlbWFpbmRlcikgKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICB0YWJzID0gZS5nZXRQb2ludFRhYnMoZW5kKTtcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGVuZC55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoKGVuZC54ICsgdGFicy50YWJzICogZS50YWJTaXplIC0gdGFicy5yZW1haW5kZXIpICogZS5jaGFyLndpZHRoICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQpICsgJ3B4OydcbiAgICAgICAgKyAnXCI+PC9pPic7XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID1cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID1cbnRlbXBsYXRlLm1hcmsuc3R5bGUgPVxudGVtcGxhdGUucm93cy5zdHlsZSA9XG50ZW1wbGF0ZS5jb2RlLnN0eWxlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiByYW5nZVswXSAqIGUuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogZS5jaGFyLmhlaWdodFxuICB9O1xufTtcblxudGVtcGxhdGUuY2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUuY2FyZXQuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6ICtlLmhhc0ZvY3VzLFxuICAgIGxlZnQ6IGUuY2FyZXRQeC54ICsgZS5tYXJnaW5MZWZ0LFxuICAgIHRvcDogZS5jYXJldFB4LnksXG4gICAgaGVpZ2h0OiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUuZ3V0dGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBudWxsO1xufTtcblxudGVtcGxhdGUuZ3V0dGVyLnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogZS5yb3dzICogZS5jaGFyLmhlaWdodCxcbiAgfTtcbn07XG5cbnRlbXBsYXRlLnJ1bGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cbnRlbXBsYXRlLnJ1bGVyLnN0eWxlID0gZnVuY3Rpb24ocG9pbnQsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICAvLyB3aWR0aDogZS5sb25nZXN0TGluZSAqIGUuY2hhci53aWR0aCxcbiAgICBvcGFjaXR5OiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogKChlLnJvd3MgKyBlLnBhZ2UuaGVpZ2h0KSAqIGUuY2hhci5oZWlnaHQpICsgZS5wYWdlUmVtYWluZGVyLmhlaWdodCxcbiAgfTtcbn07XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuLi8uLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL21lcmdlJyk7XG52YXIgdHJpbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90cmltJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuZnVuY3Rpb24gVmlldyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBWaWV3KSkgcmV0dXJuIG5ldyBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpO1xuXG4gIHRoaXMubmFtZSA9IG5hbWU7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG5cbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIHRoaXMubGFzdFVzZWQgPSAwO1xuXG4gIHRoaXNbMF0gPSB0aGlzWzFdID0gLTE7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICB0aGlzLmVsLmNsYXNzTmFtZSA9IGNzc1tuYW1lXTtcblxuICB2YXIgc3R5bGUgPSB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMCxcbiAgICBvcGFjaXR5OiAwXG4gIH07XG5cbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzXG4gICYmIH50aGlzLmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVycy5pbmRleE9mKG5hbWUpKSB7XG4gICAgc3R5bGUuYmFja2dyb3VuZCA9ICcjJ1xuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KTtcbiAgfVxuXG4gIGRvbS5zdHlsZSh0aGlzLCBzdHlsZSk7XG59XG5cblZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmICghcmFuZ2UpIHJhbmdlID0gdGhpcztcblxuICB0aGlzLmxhc3RVc2VkID0gRGF0ZS5ub3coKTtcblxuICAvLyBjb25zb2xlLmxvZyh0aGlzLm5hbWUsIHRoaXMudmFsdWUsIGUubGF5b3V0W3RoaXMubmFtZV0sIGRpZmYodGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSkpXG4gIC8vIGlmICghZGlmZih0aGlzLnZhbHVlLCB0aGlzLmVkaXRvci5sYXlvdXRbdGhpcy5uYW1lXSkpIHJldHVybjtcblxuICB2YXIgaHRtbCA9IHRoaXMudGVtcGxhdGUocmFuZ2UsIHRoaXMuZWRpdG9yKTtcbiAgaWYgKGh0bWwgPT09IGZhbHNlKSByZXR1cm4gdGhpcy5zdHlsZSgpO1xuXG4gIHRoaXNbMF0gPSByYW5nZVswXTtcbiAgdGhpc1sxXSA9IHJhbmdlWzFdO1xuICB0aGlzLnZpc2libGUgPSB0cnVlO1xuXG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkge1xuICAvLyAgIHZhciByZXMgPSB0cmltLmVtcHR5TGluZXMoaHRtbClcbiAgLy8gICByYW5nZVswXSArPSByZXMubGVhZGluZztcbiAgLy8gICBodG1sID0gcmVzLnN0cmluZztcbiAgLy8gfVxuXG4gIGlmIChodG1sKSBkb20uaHRtbCh0aGlzLCBodG1sKTtcbiAgZWxzZSBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUgfHwgJ2Jsb2NrJyA9PT0gdGhpcy5uYW1lKSByZXR1cm4gdGhpcy5jbGVhcigpO1xuXG4gIC8vIGNvbnNvbGUubG9nKCdyZW5kZXInLCB0aGlzLm5hbWUpXG4gIHRoaXMuc3R5bGUoKTtcbn07XG5cblZpZXcucHJvdG90eXBlLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubGFzdFVzZWQgPSBEYXRlLm5vdygpO1xuICBkb20uc3R5bGUodGhpcywgdGhpcy50ZW1wbGF0ZS5zdHlsZSh0aGlzLCB0aGlzLmVkaXRvcikpO1xufTtcblxuVmlldy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXNbMF0gKyAnLCcgKyB0aGlzWzFdO1xufTtcblxuVmlldy5wcm90b3R5cGUudmFsdWVPZiA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gW3RoaXNbMF0sIHRoaXNbMV1dO1xufTtcblxuVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnZpc2libGUpIHJldHVybjtcbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIC8vIGRvbS5odG1sKHRoaXMsICcnKTtcbiAgZG9tLnN0eWxlKHRoaXMsIHsgdG9wOiAwLCBoZWlnaHQ6IDAsIG9wYWNpdHk6IDAgfSk7XG59O1xuIl19
