(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Jazz
 */

var DefaultOptions = {
  theme: 'western',
  debug_layers: false,
  scroll_speed: 75,
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
var debounce = require('./lib/debounce');
var throttle = require('./lib/throttle');
var atomic = require('./lib/atomic');
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
  this.editing = false;
  this.scroll.set(scroll);
  this.render();
};

Jazz.prototype.onMove = function(point, byEdit) {
  if (!byEdit) this.editing = false;
  if (point) this.setCaret(point);

  if (!byEdit) {
    if (this.input.text.modifiers.shift || this.input.mouse.down) this.markSet();
    else this.markClear();
  }

  this.emit('move');
  this.render();
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
  this.buffer.updateRaw();
  this.setTabMode(this.buffer.syntax.tab);
  this.followCaret();
  this.repaint();
};

Jazz.prototype.onHistoryChange = function() {
  this.clear();
  this.repaint();
  this.followCaret();
};

Jazz.prototype.onBeforeFileChange = function() {
  this.history.save();
};

Jazz.prototype.onFileChange = function(editRange, editShift, textBefore, textAfter) {
  // console.log('change')
  this.editing = true;
  this.pageBounds = [0, this.buffer.loc];

  if (this.find.isOpen) {
    this.onFindValue(this.findValue, true);
  }

  this.history.save();

  this.views.code.renderEdit({
    line: editRange[0],
    range: editRange,
    shift: editShift
  });

  this.render();

  this.emit('change');
};

Jazz.prototype.setCaretFromPx = function(px) {
  var g = new Point({ x: this.marginLeft, y: this.char.height/2 })['+'](this.offset);
  var p = px['-'](g)['+'](this.scroll)['o/'](this.char);

  p.y = Math.max(0, Math.min(p.y, this.buffer.loc));
  p.x = Math.max(0, Math.min(p.x, this.getLineLength(p.y)));

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
    x: this.char.width * (this.caret.x + (tabs * this.tabSize) - tabs),
    y: this.char.height * this.caret.y
  });

  this.followCaret();
};

Jazz.prototype.onMouseClick = function() {
  var clicks = this.input.mouse.clicks;
  if (clicks > 1) {
    var area;

    if (clicks === 2) {
      area = this.buffer.wordAt(this.caret);
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
  if (this.mark.active) this.mark.end.set(this.caret);
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
  return this.buffer.lines.getLineLength(y);
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
    this.scrollBy(right - left, bottom - top);
  // else
    // this.animateScrollBy(right - left, bottom - top);
};

Jazz.prototype.scrollTo = function(p) {
  dom.scrollTo(this.el, p.x, p.y);
};

Jazz.prototype.scrollBy = function(x, y) {
  this.scroll.set(Point.low({
    x: 0,
    y: 0
  }, {
    x: this.scroll.x + x,
    y: this.scroll.y + y
  }));
  this.scrollTo(this.scroll);
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

  if (adx < 1 && ady < 1) {
    this.scrollTo(this.animationScrollTarget);
    this.animationRunning = false;
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

  var line = this.buffer.getLine(this.caret.y);
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
    this.buffer.deleteArea(area);
    this.markClear(true);
    this.clear();
    this.render();
  } else {
    this.move.byChars(-1, true);
    this.buffer.deleteCharAt(this.caret);
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
    this.buffer.deleteArea(area);
    this.markClear(true);
    this.clear();
    this.render();
  } else {
    this.buffer.deleteCharAt(this.caret);
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
  var area = this.buffer.wordAt(this.caret, true);
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
  var line = this.buffer.getLine(point.y);
  var tabs = 0;
  var tab;
  while (~(tab = line.indexOf('\t', tab + 1))) {
    if (tab >= point.x) break;
    tabs++;
  }
  return tabs;
};

Jazz.prototype.repaint = function() {
  this.resize();
  this.render();
};

Jazz.prototype.resize = function() {
  var $ = this.el;

  this.offset.set(dom.getOffset($));
  this.scroll.set(dom.getScroll($));
  this.size.set(dom.getSize($));

  // this is a weird fix when doing multiple .use()
  if (this.char.width === 0) this.char.set(dom.getCharSize($, css.code));

  this.rows = this.buffer.loc;
  this.code = this.buffer.text.length;
  this.page.set(this.size['^/'](this.char));
  this.pageRemainder.set(this.size['-'](this.page['_*'](this.char)));
  this.pageBounds = [0, this.rows];
  this.longestLine = Math.min(500, this.buffer.lines.getLongestLineLength());
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

  var comment = document.createElement('comment');
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
    indent {
      background-image: url(${dataURL});
    }`
  );

  this.emit('resize');
};

Jazz.prototype.clear = atomic(function() {
  // console.log('clear')
  this.editing = false;
  this.views.clear();
});

Jazz.prototype.render = atomic(function() {
  // console.log('render')
  this.views.render();
  this.emit('render');
});

},{"./lib/area":2,"./lib/atomic":3,"./lib/box":4,"./lib/clone":5,"./lib/debounce":6,"./lib/dialog":7,"./lib/diff":9,"./lib/dom":10,"./lib/event":11,"./lib/merge":13,"./lib/point":16,"./lib/range":19,"./lib/regexp":20,"./lib/set-immediate":22,"./lib/throttle":23,"./src/file":32,"./src/history":33,"./src/input":35,"./src/input/bindings":34,"./src/input/text":37,"./src/move":38,"./src/style.css":39,"./src/theme":40,"./src/views":44}],2:[function(require,module,exports){
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

module.exports = atomic;

// function atomic(fn) {
//   var stage = false;
//   var n = 0;

//   function wrap() {
//     if (stage) return n++;
//     else fn.call(this);
//   }

//   wrap.hold = function() {
//     stage = true;
//     n = n || 0;
//   };

//   wrap.release = function(context) {
//     if (stage && n) {
//       stage = false;
//       n = 0;
//       fn.call(context);
//     }
//   };

//   return wrap;
// }

function atomic(fn) {
  var request;

  return function(a, b, c) {
    clearImmediate(request);
    request = setImmediate(fn.bind(this, a, b, c));
  };
}

},{}],4:[function(require,module,exports){

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

},{}],5:[function(require,module,exports){

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

},{}],6:[function(require,module,exports){

module.exports = function(fn, ms) {
  var timeout;

  return function debounceWrap(a, b, c, d) {
    clearTimeout(timeout);
    timeout = setTimeout(fn.bind(this, a, b, c, d), ms);
    return timeout;
  }
};

},{}],7:[function(require,module,exports){
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

},{"../dom":10,"../event":11,"./style.css":8}],8:[function(require,module,exports){
module.exports = {"dialog":"_lib_dialog_style__dialog","input":"_lib_dialog_style__input","text":"_lib_dialog_style__text","label":"_lib_dialog_style__label","info":"_lib_dialog_style__info"}
},{}],9:[function(require,module,exports){

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

},{}],10:[function(require,module,exports){
var Point = require('./point');
var atomic = require('./atomic');
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

dom.css = atomic(function(id, cssText) {
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

},{"./atomic":3,"./diff":9,"./memoize":12,"./merge":13,"./point":16}],11:[function(require,module,exports){

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

},{}],12:[function(require,module,exports){
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

},{"./clone":5}],13:[function(require,module,exports){

module.exports = function merge(dest, src) {
  for (var key in src) {
    dest[key] = src[key];
  }
  return dest;
};

},{}],14:[function(require,module,exports){

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

},{}],15:[function(require,module,exports){
var TOKENS = /.+?\b|.\B|\b.+?/g;
var WORD = /[./\\\(\)"'\-:,.;<>~!@#$%^&*\|\+=\[\]{}`~\? ]+/g;

var parse = exports;

parse.words = function(s) {
  var words = [];
  var word;

  while (word = WORD.exec(s)) {
    words.push(word);
  }

  return words;
};

parse.tokens = function(s) {
  var words = [];
  var word;

  while (word = TOKENS.exec(s)) {
    words.push(word);
  }

  return words;
};

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
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var atomic = require('../../lib/atomic');
var parse = require('../../lib/parse');
var Area = require('../../lib/area');
var Range = require('../../lib/range');
var Regexp = require('../../lib/regexp');
var Event = require('../../lib/event');
var Lines = require('./lines');
var Syntax = require('./syntax');
var Segments = require('./segments');
var SkipString = require('./skipstring');
var PrefixTree = require('./prefixtree');
var Indexer = require('./indexer');

exports = module.exports = Buffer;

var EOL = exports.EOL = /\r\n|\r|\n/g;
var N = exports.N = /\n/g;
var CHUNK_SIZE = exports.CHUNK_SIZE = 5000;
var WORDS = Regexp.create(['tokens'], 'g');

function Buffer() {
  this.syntax = new Syntax;
  this.indexer = new Indexer(this);
  this.segments = new Segments(this);
  this.on('update', debounce(this.updateRaw.bind(this), 300));
  this.on('raw', this.segments.index.bind(this.segments));
  this.set('');
}

Buffer.prototype = {
  get loc() {
    return this.lines.length;
  }
};

Buffer.prototype.__proto__ = Event.prototype;

Buffer.prototype.get = function(range) {
  if (!range) return this.text.getRange();
  var offsets = this.lines.getRange(range);
  var text = this.text.getRange(offsets);
  return text;
};

var BLOCK = {
  'comment': '/*',
  'string': '`',
};

var BLOCK_END = {
  'comment': '*/',
  'string': '`',
};

Buffer.prototype.getHighlighted = function(range) {
  var code = this.get(range);
  // return this.syntax.entities(code);
  // return this.syntax.highlight(code);

  var block = this.segments.get(range[0]);
  // console.timeEnd('get segment')
  if (block) {
    code = BLOCK[block] + '\uffba' + code + '\uffbe' + BLOCK_END[block];
    code = this.syntax.highlight(code);
    code = '<' + block + '>' +
      code.substring(
        code.indexOf('\uffba') + 1,
        code.lastIndexOf('\uffbe')
      );
  } else {
    code = this.syntax.highlight(code + '\uffbe*/`');
    code = code.substring(
      0,
      code.lastIndexOf('\uffbe')
    );
  }
  return code;
};

//TODO: this defeats the purpose of having a skiplist
// need to get rid of in the future
Buffer.prototype.updateRaw = function() {
  this.raw = this.get();
  this.emit('raw', this.raw);
};

Buffer.prototype.getOffsetLine = function(offset) {
  var point = this.lines.getOffset(offset);
  var text = this.text.getRange(point.line.range);
  return {
    point: point,
    text: text
  };
};

Buffer.prototype.getLine = function(y) {
  return this.get([y,y]);
};

Buffer.prototype.set = function(text) {
  this.changes = 0;

  this.raw = text = normalizeEOL(text);
  this.emit('raw', this.raw);

  this.text = new SkipString({ chunkSize: CHUNK_SIZE });
  this.text.set(text);

  this.prefix = new PrefixTree;
  this.prefix.index(this.raw);

  this.lines = new Lines;
  this.lines.insert({ x:0, y:0 }, this.raw);

  this.syntax.tab = this.raw.indexOf('\t') >= 0 ? '\t' : ' ';

  this.emit('set');
};

Buffer.prototype.insert = function(point, text, shift, isCtrlShift) {
  var isEOL, lines, range, before, after;

  this.changes++;

  if (!isCtrlShift) this.emit('before update');

  text = normalizeEOL(text);

  isEOL = '\n' === text;
  shift = !isCtrlShift && (shift || isEOL);

  point = this.lines.getPoint(point);
  lines = this.lines.insert(point, text);
  range = [point.y, point.y + lines];

  before = this.get(range);

  this.text.insert(point.offset, text);

  after = this.get(range);

  this.prefix.index(after);
  if (isCtrlShift) range = [Math.max(0, range[0]-1), range[1]];

  this.segments.shift(point.offset, text.length);

  //TODO: i think shift should be 'lines'
  this.emit('update', range, shift, before, after);

  // this is to update caret position
  return text.length;
};

Buffer.prototype.deleteCharAt = function(point) {
  var isEOL, range, before, after;

  this.changes++;

  this.emit('before update');

  point = this.lines.getPoint(point);
  isEOL = this.lines.removeCharAt(point);
  range = Range.clamp([0, this.lines.length], [point.y, point.y + isEOL]);

  before = this.get(range);

  this.text.removeCharAt(point.offset);

  after = this.get(range);

  this.prefix.index(after);

  this.segments.shift(point.offset, -1);

  this.emit('update', range, -isEOL, before);
};

Buffer.prototype.wordAt = function(point, inclusive) {
  inclusive = inclusive || 0;

  point = this.lines.getPoint(point);

  var text = this.text.getRange(point.line.range);

  var words = Regexp.parse(text, WORDS);

  if (words.length === 1) {
    return new Area({
      begin: { x: 0, y: point.y },
      end: { x: point.line.length, y: point.y },
    });
  }

  var lastIndex = 0;
  var word = [];
  var end = text.length;

  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (word.index > point.x - inclusive) {
      end = word.index;
      break;
    }
    lastIndex = word.index;
  }

  return new Area({
    begin: { x: lastIndex, y: point.y },
    end: { x: end, y: point.y }
  });
};

Buffer.prototype.deleteArea = function(area, noUpdate) {
  var range, offsets, lines;

  this.changes++;

  this.emit('before update');

  offsets = this.lines.getAreaOffsetRange(area);
  lines = this.lines.removeArea(area);
  range = [area.begin.y, area.end.y];

  this.text.remove(offsets);

  this.segments.shift(offsets[0], offsets[0]-offsets[1]);

  if (!noUpdate) {
    this.emit('update', range);
  }
};

Buffer.prototype.getArea = function(area) {
  var offsets = this.lines.getAreaOffsetRange(area);
  var text = this.text.getRange(offsets);
  return text;
};

Buffer.prototype.moveAreaByLines = function(y, area) {
  if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
  if (area.begin.y + y < 0 || area.end.y + y > this.loc) return false;

  area.begin.x = 0;
  area.end.x = 0;

  var text = this.get([area.begin.y, area.end.y-1]);
  this.deleteArea(area, true);

  this.insert({ x:0, y:area.begin.y + y }, text, y, true);

  return true;
};

function normalizeEOL(s) {
  return s.replace(exports.EOL, '\n');
}

},{"../../lib/area":2,"../../lib/atomic":3,"../../lib/debounce":6,"../../lib/event":11,"../../lib/parse":15,"../../lib/range":19,"../../lib/regexp":20,"../../lib/throttle":23,"./indexer":26,"./lines":27,"./prefixtree":28,"./segments":29,"./skipstring":30,"./syntax":31}],26:[function(require,module,exports){

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

/*
 *                                                       _ = caret
 *
 *   0   1   2   3   4    5   0   1   2   3   4    5   0   1   2
 * | h | e | l | l | o | \n | w | o | r | l | d | \n | ! | ! | _ |
 * 0   1   2   3   4   5    6   7   8   9   10  11   12  13  14  15
 *
 * get(0) -> 0
 * get(1) -> 6
 * get(2) -> 12
 * get(3) -> throws
 *
 * left inclusive, right exclusive:
 *
 * getLine(x).offset === get(x)
 * getLine(0).range -> 0-6
 * getLine(1).range -> 6-12
 * getLine(2).range -> 12-13
 * getLine(3) -> throws
 *
 * getRange([0,0]) -> 0-6
 * getRange([0,1]) -> 0-12
 * getRange([1,1]) -> 6-12
 * getRange([1,2]) -> 6-13
 * getRange([2,2]) -> 12-13
 * getRange([2,3]) -> throws
 * getRange([0,3]) -> throws
 *
 * getPoint({ x:x, y:y }).line === getLine(y)
 * getPoint({ x:0, y:0 }).offset -> 0
 * getPoint({ x:0, y:0 }).point -> { x:0, y:0 }
 * getPoint({ x:2, y:0 }).offset -> 2
 * getPoint({ x:10, y:0 }).offset -> 5
 * getPoint({ x:10, y:0 }).point -> { x:5, y:0 }
 * getPoint({ x:0, y:1 }).offset -> 6
 * getPoint({ x:2, y:1 }).offset -> 8
 * getPoint({ x:10, y:1 }).offset -> 11
 * getPoint({ x:10, y:1 }).point -> { x:5, y:1 }
 * getPoint({ x:0, y:2 }).offset -> 12
 * getPoint({ x:10, y:2 }).offset -> 13
 * getPoint({ x:10, y:2 }).point -> { x:1, y:2 }
 * getRange({ x:100, y:100 }).offset -> 13
 * getRange({ x:100, y:100 }).point -> { x:1, y: 2 }
 *
 * getLineLength(0) -> 6
 * getLineLength(1) -> 6
 * getLineLength(2) -> 2
 * getLineLength(3) -> throws
 */

var EOL = /\r\n|\r|\n/g;
var N = /\n/g;

module.exports = Lines;

function Lines() {
  this.index = [];
  this.tail = '';
  this.length = 0;
}

Lines.prototype.get = function(y) {
  if (y > this.length) {
    return this.index[this.length - 1] + this.tail.length + 1;
  }
  var line = this.index[y - 1] || 0;

  return y > 0 ? line + 1 : 0;
};

Lines.prototype.getRange = function(range) {
  var a = this.get(range[0]);
  var b;

  if (range[1] + 1 >= this.length + 1) {
    b = this.get(range[1]) + this.tail.length;
  } else {
    b = this.get(range[1] + 1);
  }

  return [a, b];
};

Lines.prototype.getDistance = function(range) {
  var a = this.get(range[0]);
  var b;

  if (range[1] === this.length + 1) {
    b = this.get(range[1] - 1) + this.tail.length;
  } else {
    b = this.get(range[1]) - 1;
  }

  return b - a;
};

Lines.prototype.getLineLength = function(y) {
  return this.getDistance([y, y+1]);
};

Lines.prototype.getLongestLineLength = function() {
  var longest = 0;
  var d = 0;
  var p = this.index[this.length - 1];
  var i = this.length;
  while (i-- > 0) {
    d = this.index[i] - this.index[i - 1];
    longest = d > longest ? d : longest;
  }
  return longest;
};

Lines.prototype.getLine = function(y) {
  var offset = this.get(y);
  var point = { x: 0, y: y };
  var length = this.getLineLength(point.y);
  var range = [offset, offset + length];

  return {
    offset: offset,
    point: point,
    range: range,
    length: length,
  };
};

Lines.prototype.getPoint = function(point) {
  var line = this.getLine(point.y);

  var point = {
    x: Math.min(point.x, line.length),
    y: line.point.y
  };

  return {
    offset: line.offset + point.x,
    point: point,
    x: point.x,
    y: point.y,
    line: line,
  };
};

Lines.prototype.getOffset = function(offset) {
  var begin = 0;
  var end = this.length;
  if (!end) return;

  var p = -1;
  var i = -1;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    if (this.get(i) <= offset) begin = i;
    else end = i;
  } while (p !== i);

  var line = this.getLine(i);
  var x = offset - line.offset;
  if ( x > line.length
    && i === this.length - 1) {
    x -= line.length + 1;
    i += 1;
    if (x > this.tail.length) return false;
  }

  return {
    x: x,
    y: i,
    line: line
  };
};

Lines.prototype.insert = function(p, text) {
  var point = this.getPoint(p);
  var x = point.x;
  var y = point.y;
  var offset = point.offset;

  if (y === this.length) {
    text = this.tail.substr(0,x) + text + this.tail.substr(x);
    this.tail = '';
    offset -= x;
  }

  var matches = [y, 0];
  var match = -1;
  var shift = 0;
  var last = -1;

  while (~(match = text.indexOf('\n', match + 1))) {
    matches.push(match + offset);
    last = match;
  }

  shift += last + 1;

  var tail = text.slice(last + 1);
  if (y === this.length) {
    this.tail += tail;
  }

  if (y < this.length) {
    shift += tail.length;
    this.shift(y, shift);
  }

  if (matches.length < 3) return 0;

  this.index.splice.apply(this.index, matches);

  var lines = this.index.length - this.length;

  this.length = this.index.length;

  return lines;
};

Lines.prototype.insertLine = function(y, text) {
  this.insert({ x:0, y:y }, text);
};

Lines.prototype.getArea = function(area) {
  return this.getRange([
    area.begin.y,
    area.end.y
  ]);
};

Lines.prototype.getAreaOffsetRange = function(area) {
  return [
    this.getPoint(area.begin).offset,
    this.getPoint(area.end).offset
  ];
};

Lines.prototype.removeCharAt = function(p) {
  var a = this.getPoint(p);
  if (a.point.y === this.length) {
    this.tail = this.tail.slice(0, -1);
    return false;
  } else {
    var isEndOfLine = a.line.length === a.point.x;
    if (isEndOfLine) {
      this.index.splice(a.point.y, 1);
      this.length = this.index.length;
      if (a.point.y === this.length) {
        this.tail += new Array(a.line.length+1).join('*');
      }
    }
    this.shift(a.point.y, -1);
    return isEndOfLine;
  }
};

Lines.prototype.removeArea = function(area) {
  var begin = this.getPoint(area.begin);
  var end = this.getPoint(area.end);

  var x = 0;

  var dist = end.y - begin.y;
  var sameLine = begin.y === end.y;
  if (sameLine) x = end.x - begin.x;
  else {
    this.index.splice(begin.y, dist);
  }

  if (!sameLine) {
    if (area.begin.y === this.length) {
      this.tail = this.tail.slice(0, -x);
    }
    if (area.end.y === this.length) {
      this.tail = this.tail.slice(end.x);
      this.tail += new Array(begin.x + 1).join('*');
    }
  } else {
    if (area.begin.y === this.length) {
      this.tail = this.tail.slice(0, begin.x) + this.tail.slice(end.x);
    }
  }

  this.shift(area.begin.y, -(end.offset - begin.offset));

  var diff = this.length - this.index.length;

  this.length = this.index.length;

  return diff;
};

Lines.prototype.shift = function(y, diff) {
  for (var i = y; i < this.index.length; i++) {
    this.index[i] += diff;
  }
};

Lines.prototype.copy = function() {
  var lines = new Lines;
  lines.index = this.index.slice();
  lines.tail = this.tail;
  lines.length = this.length;
  return lines;
};

Lines.count = function(text) {
  return this.text.match(N).length;
};

function add(b) {
  return function(a) {
    return a + b;
  };
}

},{}],28:[function(require,module,exports){
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

var TOKEN = /(\/\*)|(\*\/)|(`)/g;

module.exports = Segments;

function Segments(buffer) {
  this.buffer = buffer;
  this.segments = [];
  this.clearCache();
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

Segments.prototype.get = function(y) {
  if (y in this.cache.state) return this.cache.state[y];

  var open = false;
  var state = null;
  var waitFor = '';
  var point = { x:-1, y:-1 };
  var close = 0;
  var segment;
  var range;
  var text;
  var valid;
  var last;

  var i = 0;

  //TODO: optimization:
  // cache segment y with open/close/state so we skip
  // iterating from the begin every time

  for (; i < this.segments.length; i++) {
    segment = this.segments[i];

    if (open) {
      if (waitFor === segment.type) {
        point = this.getPointOffset(segment.offset);
        if (!point) return (this.cache.state[y] = null);
        if (point.y >= y) return (this.cache.state[y] = Tag[state.type]);

        // console.log('close', segment.type, segment.offset, this.buffer.text.getRange([segment.offset, segment.offset + 10]))
        last = segment;
        last.point = point;
        state = null;
        open = false;
      }
    } else {
      point = this.getPointOffset(segment.offset);
      if (!point) return (this.cache.state[y] = null);

      range = point.line.range;

      if (last && last.point.y === point.y) {
        close = last.point.x + Length[last.type];
        // console.log('last one was', last.type, last.point.x, this.buffer.text.getRange([last.offset, last.offset + 10]))
      } else {
        close = 0;
      }
      valid = this.isValidRange([range[0], range[1]+1], segment, close);

      if (valid) {
        if (NotOpen[segment.type]) continue;
        // console.log('open', segment.type, segment.offset, this.buffer.text.getRange([segment.offset, segment.offset + 10]))
        open = true;
        state = segment;
        state.point = point;
        waitFor = Closes[state.type];
      }
    }
    if (point.y >= y) break;
  }
  if (state && state.point.y < y) return (this.cache.state[y] = Tag[state.type]);
  return (this.cache.state[y] = null);
};

Segments.prototype.getPointOffset = function(offset) {
  if (offset in this.cache.offset) return this.cache.offset[offset]
  return (this.cache.offset[offset] = this.buffer.lines.getOffset(offset));
};

Segments.prototype.isValidRange = function(range, segment, close) {
  var key = range.join();
  if (key in this.cache.range) return this.cache.range[key];
  var text = this.buffer.text.getRange(range);
  var valid = this.isValid(text, segment.offset - range[0], close);
  return (this.cache.range[key] = valid);
};

Segments.prototype.isValid = function(text, offset, lastIndex) {
  Begin.lastIndex = lastIndex;
  var match = Begin.exec(text);
  if (!match) return;

  i = match.index;

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

    // console.log('start', i, o)
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

Segments.prototype.getSegment = function(offset) {
  var begin = 0;
  var end = this.segments.length;
  if (!end) return;

  var p = -1;
  var i = -1;
  var b;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    b = this.segments[i];
    if (b.offset < offset) begin = i;
    else end = i;
  } while (p !== i);

  return {
    segment: b,
    index: i
  };
};

Segments.prototype.shift = function(offset, shift) {
  var s = this.getSegment(offset);
  if (!s) return;

  for (var i = s.index + 1; i < this.segments.length; i++) {
    this.segments[i].offset += shift;
  }

  // if (shift < 0) {
    // this.clearCache();
  // }
};

Segments.prototype.clearCache = function() {
  this.cache = {
    offset: {},
    range: {},
    state: {}
  };
};

Segments.prototype.index = function(text) {
  var match;

  var segments = this.segments = [];

  this.clearCache();

  while (match = TOKEN.exec(text)) {
    if (match['3']) segments.push(new Segment('template string', match.index));
    else if (match['1']) segments.push(new Segment('open comment', match.index));
    else if (match['2']) segments.push(new Segment('close comment', match.index));
  }
};

function Segment(type, offset) {
  this.type = type;
  this.offset = offset;
}

},{}],30:[function(require,module,exports){
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
  this.chunkSize = o.chunkSize;
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
  a = a || 0;
  b = b || this.length;
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
  return this.substring();
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
  'operator': R(['operator'], 'g', entities),
  'params':   R(['params'],   'g'),
  'declare':  R(['declare'],  'g'),
  'function': R(['function'], 'g'),
  'keyword':  R(['keyword'],  'g'),
  'builtin':  R(['builtin'],  'g'),
  'symbol':   R(['symbol'],   'g'),
  'string':   R(['template string'], 'g'),
  'number':   R(['special','number'], 'g'),
}, compile);

var Indent = {
  regexp: R(['indent'], 'gm'),
  replacer: (s) => s.replace(/ {1,2}|\t/g, '<indent>$&</indent>')
};

var Blocks = R(['comment','string','regexp'], 'gm');

var Tag = {
  '//': 'comment',
  '/*': 'comment',
  '`': 'string',
  '"': 'string',
  "'": 'string',
  '/': 'regexp',
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

  // code = code.replace(/\ueeee/g, function() {
  //   return long.shift().slice(0, this.maxLine) + '...line too long to display';
  // });

  return code;
};

Syntax.prototype.createIndents = function(code) {
  var lines = code.split(/\n/g);
  if (lines.length <= 2) return code;

  var line;
  var long = [];
  var match;
  var firstIndent = 0;
  var i = 0;

  // for (; i < lines.length; i++) {
  //   line = lines[i];
  //   if (line.length > this.maxLine) {
  //     long.push(lines.splice(i--, 1, '\ueeee'));
  //   }
  // }

  i = 0;
  line = lines[i];
  // console.log(line)
  while (!(match = /\S/g.exec(line))) {
    line = lines[++i];
    // console.log(line)
  }
  for (var j = 0; j < i; j++) {
    lines[j] = new Array(match.index + 1).join(this.tab);
  }
  var prev;
  for (; i < lines.length; i++) {
    line = lines[i];
    prev = lines[i-1];
    if (!line.length
      && prev.length
      && prev[0] === this.tab
      && !~['/',';'].indexOf(prev[prev.length-1])) lines[i] = this.tab;
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
    this.buffer.set(text);
    this.emit('open');
    fn && fn(null, this);
  });
};

File.prototype.save = function(fn) {
  save(this.root + this.path, this.buffer.get(), fn || noop);
};

File.prototype.set = function(text) {
  this.buffer.set(text);
  this.emit('set');
};

function noop() {/* noop */}

},{"../lib/event":11,"../lib/open":14,"../lib/save":21,"./buffer":25}],33:[function(require,module,exports){
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

},{"../lib/debounce":6,"../lib/event":11}],34:[function(require,module,exports){
var throttle = require('../../lib/throttle');

var PAGING_THROTTLE = 70;

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
    var text = this.buffer.getArea(area.setLeft(0).addBottom(add));
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

},{"../../lib/event":11,"./mouse":36,"./text":37}],36:[function(require,module,exports){
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

},{"../../lib/debounce":6,"../../lib/event":11,"../../lib/point":16}],37:[function(require,module,exports){
var dom = require('../../lib/dom');
var debounce = require('../../lib/debounce');
var throttle = require('../../lib/throttle');
var Event = require('../../lib/event');

var THROTTLE = 1000/75;

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

  this.el = document.createElement('input');

  dom.style(this, {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0
  });

  dom.attrs(this, {
    autocapitalize: 'none'
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

},{"../../lib/debounce":6,"../../lib/dom":10,"../../lib/event":11,"../../lib/throttle":23}],38:[function(require,module,exports){
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
  var line = buffer.getLine(p.y);

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
  var lines = buffer.lines;
  var x = p.x;
  var y = p.y;

  if (dx < 0) { // going left
    x += dx; // move left
    if (x < 0) { // when past left edge
      if (y > 0) { // and lines above
        y -= 1; // move up a line
        x = lines.getLineLength(y); // and go to the end of line
      } else {
        x = 0;
      }
    }
  } else if (dx > 0) { // going right
    x += dx; // move right
    while (x - lines.getLineLength(y) > 0) { // while past line length
      if (y === lines.length) { // on end of file
        x = lines.getLineLength(y); // go to end of line on last line
        break; // and exit
      }
      x -= lines.getLineLength(y) + 1; // wrap this line length
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
  var lines = buffer.lines;
  var x = p.x;
  var y = p.y;

  if (dy < 0) { // going up
    if (y + dy > 0) { // when lines above
      y += dy; // move up
    } else {
      y = 0;
    }
  } else if (dy > 0) { // going down
    if (y < lines.length - dy) { // when lines below
      y += dy; // move down
    } else {
      y = lines.length;
    }
  }

  // if (x > lines.getLine(y).length) {
  //   x = lines.getLine(y).length;
  // } else {
  // }
  x = Math.min(this.lastDeliberateX, lines.getLine(y).length);

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
  var x = buffer.lines.getLine(p.y).length;
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
  var last = buffer.lines.length;
  var x = buffer.lines.getLine(last).length
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
  var last = buffer.loc;
  return p.y === last && p.x === buffer.lines.getLineLength(last);
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

},{"../lib/event":11,"../lib/point":16,"../lib/regexp":20}],39:[function(require,module,exports){
module.exports = {"editor":"_src_style__editor","layer":"_src_style__layer","rows":"_src_style__rows","mark":"_src_style__mark","code":"_src_style__code","caret":"_src_style__caret","gutter":"_src_style__gutter","ruler":"_src_style__ruler","above":"_src_style__above","find":"_src_style__find","block":"_src_style__block"}
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

function setTheme(name) {
  var t = themes[name];
  dom.css('theme',
`
.${name} {
  background: ${t.background};
}

operator,
keyword {
  color: ${t.keyword};
}

declare,
builtin {
  color: ${t.declare};
}

boolean,
number {
  color: ${t.number};
}

params {
  color: ${t.params};
}

function {
  color: ${t.function};
  font-style: normal;
}

regexp {
  color: ${t.regexp || t.params};
}

comment {
  color: ${t.comment};
}

string {
  color: ${t.string};
}

symbol,
.${css.code} {
  color: ${t.color};
}

.${css.caret} {
  background: ${t.color};
}

params,
declare {
  font-style: italic;
}

symbol {
  font-style: normal;
}

indent {
  display: inline-block;
  background-repeat: no-repeat;
}
`
  )

}


},{"../lib/dom":10,"./style.css":39}],41:[function(require,module,exports){
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

},{"./layer":45,"./template":48}],42:[function(require,module,exports){
var dom = require('../../lib/dom');
var Range = require('../../lib/range');
var Layer = require('./layer');
var template = require('./template');

module.exports = Code;

function Code(name, editor, template) {
  Layer.call(this, name, editor, template, 10);
}

Code.prototype.__proto__ = Layer.prototype;

Code.prototype.render = function() {
  // this.clear();
  // return this.renderPage(0, true);
  if (!this.editor.editing) this.renderAhead();
};

Code.prototype.renderEdit = function(edit) {
  var y = edit.line;
  var g = edit.range.slice();
  var shift = edit.shift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isBegin = g[0] + isBackspace === 0;
  var isEnd = g[1] + isEnter === this.editor.rows;

  if (shift) {
    if (isEnter && !isEnd) this.shiftViewsBelow(g[0], shift);
    else if (isBackspace && !isBegin) this.shiftViewsBelow(g[0], shift);
  }

  this.updateRange(g);
  this.renderPage(0);
};

},{"../../lib/dom":10,"../../lib/range":19,"./layer":45,"./template":48}],43:[function(require,module,exports){
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

},{"./layer":45,"./template":48}],44:[function(require,module,exports){
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
    new FindView('find', editor, template.find),
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

},{"../../lib/debounce":6,"./block":41,"./code":42,"./find":43,"./mark":46,"./rows":47,"./template":48,"./view":49}],45:[function(require,module,exports){
var dom = require('../../lib/dom');
var Event = require('../../lib/event');
var Range = require('../../lib/range');
var View = require('./view');
var css = require('../style.css');

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
  // if ('code' === this.name) console.log('need:', needViews, needRanges.join(' '));
  // if ('code' === this.name) console.log('have:', this.views.join(' '));
  // if ('code' === this.name) console.log('out:', outViews.join(' '));
  // if ('code' === this.name) console.log('range', range, inViews.join(' '));
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
  this.renderRange([y,y], true);
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
  var aheadRange = this.getPageRange([-1,+1]);
  var aheadNeedRanges = Range.NOT(aheadRange, views);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders
    this.renderPage(2, include);
  }
};

/*

1  x
2 -x
3 -x
4 -
5
6

 */

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

Layer.prototype.shiftViewsBelow = function(y, dy) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] <= y) continue;

    view[0] += dy;
    view[1] += dy;
    view.style();
  }
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

},{"../../lib/dom":10,"../../lib/event":11,"../../lib/range":19,"../style.css":39,"./view":49}],46:[function(require,module,exports){
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

},{"../../lib/dom":10,"../../lib/range":19,"./layer":45,"./template":48}],47:[function(require,module,exports){
var Layer = require('./layer');
var template = require('./template');

module.exports = Rows;

function Rows(name, editor, template) {
  Layer.call(this, name, editor, template, 5);
}

Rows.prototype.__proto__ = Layer.prototype;

Rows.prototype.render = function() {
  if (this.editor.editShift) {
    var views = this.views;
    var rows = this.editor.rows;
    for (var i = 0; i < views.length; i++) {
      var view = views[i];
      var r = view;
      if (!view.visible) continue;

      if (r[1] > rows) view.clear();
    }
  }
  this.renderAhead();
};

},{"./layer":45,"./template":48}],48:[function(require,module,exports){
var template = exports;

template.code = function(range, e) {
  // if (template.code.memoize.param === code) {
  //   return template.code.memoize.result;
  // } else {
  //   template.code.memoize.param = code;
  //   template.code.memoize.result = false;
  // }

  var html = e.buffer.getHighlighted(range);

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

  var offset = e.buffer.lines.getRange(range);
  var area = e.buffer.lines.getAreaOffsetRange(mark);
  var code = e.buffer.text.getRange(offset);

  area[0] -= offset[0];
  area[1] -= offset[0];

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
  var r;
  while (results[i] && results[i].y < range[1]) {
    r = results[i++];
    html += '<i style="'
          + 'width:' + width + ';'
          + 'top:' + (r.y * e.char.height) + 'px;'
          + 'left:' + (r.x * e.char.width + e.gutter + e.options.margin_left) + 'px;'
          + '"></i>';
  }

  return html;
};

template.block = function(range, e) {
  if (e.editing) return '';

  var offset = e.buffer.lines.get(range[0]);
  var target = e.buffer.lines.getPoint(e.caret).offset;
  var code = e.buffer.get(range);
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

  var begin = e.buffer.lines.getOffset(i + offset);

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

  var end = e.buffer.lines.getOffset(i + offset);

  var html = '';

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (begin.y * e.char.height) + 'px;'
        + 'left:' + (begin.x * e.char.width + e.gutter + e.options.margin_left) + 'px;'
        + '"></i>';

  html += '<i style="'
        + 'width:' + e.char.width + 'px;'
        + 'top:' + (end.y * e.char.height) + 'px;'
        + 'left:' + (end.x * e.char.width + e.gutter + e.options.margin_left) + 'px;'
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
    left: e.char.width * e.caret.x + e.gutter + e.options.margin_left,
    top: e.char.height * e.caret.y,
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

},{}],49:[function(require,module,exports){
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

},{"../../lib/diff":9,"../../lib/dom":10,"../../lib/merge":13,"../../lib/trim":24,"../style.css":39}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2F0b21pYy5qcyIsImxpYi9ib3guanMiLCJsaWIvY2xvbmUuanMiLCJsaWIvZGVib3VuY2UuanMiLCJsaWIvZGlhbG9nL2luZGV4LmpzIiwibGliL2RpYWxvZy9zdHlsZS5jc3MiLCJsaWIvZGlmZi5qcyIsImxpYi9kb20uanMiLCJsaWIvZXZlbnQuanMiLCJsaWIvbWVtb2l6ZS5qcyIsImxpYi9tZXJnZS5qcyIsImxpYi9vcGVuLmpzIiwibGliL3BhcnNlLmpzIiwibGliL3BvaW50LmpzIiwibGliL3JhbmdlLWdhdGUtYW5kLmpzIiwibGliL3JhbmdlLWdhdGUtbm90LmpzIiwibGliL3JhbmdlLmpzIiwibGliL3JlZ2V4cC5qcyIsImxpYi9zYXZlLmpzIiwibGliL3NldC1pbW1lZGlhdGUuanMiLCJsaWIvdGhyb3R0bGUuanMiLCJsaWIvdHJpbS5qcyIsInNyYy9idWZmZXIvaW5kZXguanMiLCJzcmMvYnVmZmVyL2luZGV4ZXIuanMiLCJzcmMvYnVmZmVyL2xpbmVzLmpzIiwic3JjL2J1ZmZlci9wcmVmaXh0cmVlLmpzIiwic3JjL2J1ZmZlci9zZWdtZW50cy5qcyIsInNyYy9idWZmZXIvc2tpcHN0cmluZy5qcyIsInNyYy9idWZmZXIvc3ludGF4LmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ24yQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbk1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1BBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNVRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL1FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaE1BOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDak5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBKYXp6XG4gKi9cblxudmFyIERlZmF1bHRPcHRpb25zID0ge1xuICB0aGVtZTogJ3dlc3Rlcm4nLFxuICBkZWJ1Z19sYXllcnM6IGZhbHNlLFxuICBzY3JvbGxfc3BlZWQ6IDc1LFxuICBoaWRlX3Jvd3M6IGZhbHNlLFxuICBjZW50ZXI6IGZhbHNlLFxuICBtYXJnaW5fbGVmdDogMTUsXG4gIGd1dHRlcl9tYXJnaW46IDIwLFxufTtcblxucmVxdWlyZSgnLi9saWIvc2V0LWltbWVkaWF0ZScpO1xudmFyIGRvbSA9IHJlcXVpcmUoJy4vbGliL2RvbScpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL2xpYi9tZXJnZScpO1xudmFyIGNsb25lID0gcmVxdWlyZSgnLi9saWIvY2xvbmUnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuL2xpYi90aHJvdHRsZScpO1xudmFyIGF0b21pYyA9IHJlcXVpcmUoJy4vbGliL2F0b21pYycpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi9saWIvZXZlbnQnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuL2xpYi9yZWdleHAnKTtcbnZhciBEaWFsb2cgPSByZXF1aXJlKCcuL2xpYi9kaWFsb2cnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4vbGliL3BvaW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuL2xpYi9yYW5nZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCcuL2xpYi9hcmVhJyk7XG52YXIgQm94ID0gcmVxdWlyZSgnLi9saWIvYm94Jyk7XG5cbnZhciBEZWZhdWx0QmluZGluZ3MgPSByZXF1aXJlKCcuL3NyYy9pbnB1dC9iaW5kaW5ncycpO1xudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcbnZhciB0aGVtZSA9IHJlcXVpcmUoJy4vc3JjL3RoZW1lJyk7XG52YXIgY3NzID0gcmVxdWlyZSgnLi9zcmMvc3R5bGUuY3NzJyk7XG5cbnZhciBORVdMSU5FID0gUmVnZXhwLmNyZWF0ZShbJ25ld2xpbmUnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBKYXp6O1xuXG5mdW5jdGlvbiBKYXp6KG9wdGlvbnMpIHtcbiAgdGhpcy5vcHRpb25zID0gbWVyZ2UoY2xvbmUoRGVmYXVsdE9wdGlvbnMpLCBvcHRpb25zIHx8IHt9KTtcblxuICBPYmplY3QuYXNzaWduKHRoaXMsIHtcbiAgICBlbDogZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpLFxuXG4gICAgaWQ6ICdqYXp6XycgKyAoTWF0aC5yYW5kb20oKSAqIDEwZTYgfCAwKS50b1N0cmluZygzNiksXG4gICAgZmlsZTogbmV3IEZpbGUsXG4gICAgbW92ZTogbmV3IE1vdmUodGhpcyksXG4gICAgdmlld3M6IG5ldyBWaWV3cyh0aGlzKSxcbiAgICBpbnB1dDogbmV3IElucHV0KHRoaXMpLFxuICAgIGhpc3Rvcnk6IG5ldyBIaXN0b3J5KHRoaXMpLFxuXG4gICAgYmluZGluZ3M6IHsgc2luZ2xlOiB7fSB9LFxuXG4gICAgZmluZDogbmV3IERpYWxvZygnRmluZCcsIFRleHQubWFwKSxcbiAgICBmaW5kVmFsdWU6ICcnLFxuICAgIGZpbmROZWVkbGU6IDAsXG4gICAgZmluZFJlc3VsdHM6IFtdLFxuXG4gICAgc2Nyb2xsOiBuZXcgUG9pbnQsXG4gICAgb2Zmc2V0OiBuZXcgUG9pbnQsXG4gICAgc2l6ZTogbmV3IEJveCxcbiAgICBjaGFyOiBuZXcgQm94LFxuXG4gICAgcGFnZTogbmV3IEJveCxcbiAgICBwYWdlUG9pbnQ6IG5ldyBQb2ludCxcbiAgICBwYWdlUmVtYWluZGVyOiBuZXcgQm94LFxuICAgIHBhZ2VCb3VuZHM6IG5ldyBSYW5nZSxcblxuICAgIGxvbmdlc3RMaW5lOiAwLFxuICAgIGd1dHRlcjogMCxcbiAgICBjb2RlOiAwLFxuICAgIHJvd3M6IDAsXG5cbiAgICB0YWJTaXplOiAyLFxuICAgIHRhYjogJyAgJyxcblxuICAgIGNhcmV0OiBuZXcgUG9pbnQoeyB4OiAwLCB5OiAwIH0pLFxuICAgIGNhcmV0UHg6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG5cbiAgICBoYXNGb2N1czogZmFsc2UsXG5cbiAgICBtYXJrOiBuZXcgQXJlYSh7XG4gICAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgICB9KSxcblxuICAgIGVkaXRpbmc6IGZhbHNlLFxuICAgIGVkaXRMaW5lOiAtMSxcbiAgICBlZGl0UmFuZ2U6IFstMSwtMV0sXG4gICAgZWRpdFNoaWZ0OiAwLFxuXG4gICAgc3VnZ2VzdEluZGV4OiAwLFxuICAgIHN1Z2dlc3RSb290OiAnJyxcbiAgICBzdWdnZXN0Tm9kZXM6IFtdLFxuXG4gICAgYW5pbWF0aW9uRnJhbWU6IC0xLFxuICAgIGFuaW1hdGlvblJ1bm5pbmc6IGZhbHNlLFxuICAgIGFuaW1hdGlvblNjcm9sbFRhcmdldDogbnVsbCxcbiAgfSk7XG5cbiAgZG9tLmFwcGVuZCh0aGlzLnZpZXdzLmNhcmV0LCB0aGlzLmlucHV0LnRleHQpO1xuICBkb20uYXBwZW5kKHRoaXMsIHRoaXMudmlld3MpO1xuXG4gIC8vIHVzZWZ1bCBzaG9ydGN1dHNcbiAgdGhpcy5idWZmZXIgPSB0aGlzLmZpbGUuYnVmZmVyO1xuICB0aGlzLmJ1ZmZlci5tYXJrID0gdGhpcy5tYXJrO1xuICB0aGlzLnN5bnRheCA9IHRoaXMuYnVmZmVyLnN5bnRheDtcblxuICB0aGVtZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuXG4gIHRoaXMuYmluZE1ldGhvZHMoKTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSmF6ei5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5KYXp6LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCwgc2Nyb2xsRWwpIHtcbiAgaWYgKHRoaXMucmVmKSB7XG4gICAgdGhpcy5lbC5yZW1vdmVBdHRyaWJ1dGUoJ2lkJyk7XG4gICAgdGhpcy5lbC5jbGFzc0xpc3QucmVtb3ZlKGNzcy5lZGl0b3IpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm9wdGlvbnMudGhlbWUpO1xuICAgIHRoaXMub2ZmU2Nyb2xsKCk7XG4gICAgdGhpcy5yZWYuZm9yRWFjaChyZWYgPT4ge1xuICAgICAgZG9tLmFwcGVuZChlbCwgcmVmKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnJlZiA9IFtdLnNsaWNlLmNhbGwodGhpcy5lbC5jaGlsZHJlbik7XG4gICAgZG9tLmFwcGVuZChlbCwgdGhpcy5lbCk7XG4gICAgZG9tLm9ucmVzaXplKHRoaXMub25SZXNpemUpO1xuICB9XG5cbiAgdGhpcy5lbCA9IGVsO1xuICB0aGlzLmVsLnNldEF0dHJpYnV0ZSgnaWQnLCB0aGlzLmlkKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKGNzcy5lZGl0b3IpO1xuICB0aGlzLmVsLmNsYXNzTGlzdC5hZGQodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgdGhpcy5vZmZTY3JvbGwgPSBkb20ub25zY3JvbGwoc2Nyb2xsRWwgfHwgdGhpcy5lbCwgdGhpcy5vblNjcm9sbCk7XG4gIHRoaXMuaW5wdXQudXNlKHRoaXMuZWwpO1xuXG4gIHNldFRpbWVvdXQodGhpcy5yZXBhaW50LCAwKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmFzc2lnbiA9IGZ1bmN0aW9uKGJpbmRpbmdzKSB7XG4gIHRoaXMuYmluZGluZ3MgPSBiaW5kaW5ncztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5maWxlLm9wZW4ocGF0aCwgcm9vdCwgZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICB0aGlzLmZpbGUuc2F2ZShmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCwgcGF0aCkge1xuICB0aGlzLmZpbGUuc2V0KHRleHQpO1xuICB0aGlzLmZpbGUucGF0aCA9IHBhdGggfHwgdGhpcy5maWxlLnBhdGg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgc2V0SW1tZWRpYXRlKHRoaXMuaW5wdXQuZm9jdXMpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgc2V0SW1tZWRpYXRlKHRoaXMuaW5wdXQuYmx1cik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZE1ldGhvZHMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUuYmluZCh0aGlzKTtcbiAgdGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbiA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4uYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrU2V0ID0gdGhpcy5tYXJrU2V0LmJpbmQodGhpcyk7XG4gIHRoaXMubWFya0NsZWFyID0gdGhpcy5tYXJrQ2xlYXIuYmluZCh0aGlzKTtcbiAgdGhpcy5yZXBhaW50ID0gdGhpcy5yZXBhaW50LmJpbmQodGhpcyk7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kSGFuZGxlcnMgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgbWV0aG9kIGluIHRoaXMpIHtcbiAgICBpZiAoJ29uJyA9PT0gbWV0aG9kLnNsaWNlKDAsIDIpKSB7XG4gICAgICB0aGlzW21ldGhvZF0gPSB0aGlzW21ldGhvZF0uYmluZCh0aGlzKTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJpbmRIYW5kbGVycygpXG4gIHRoaXMubW92ZS5vbignbW92ZScsIHRoaXMub25Nb3ZlKTtcbiAgdGhpcy5maWxlLm9uKCdyYXcnLCB0aGlzLm9uRmlsZVJhdyk7IC8vVE9ETzogc2hvdWxkIG5vdCBuZWVkIHRoaXMgZXZlbnRcbiAgdGhpcy5maWxlLm9uKCdzZXQnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuZmlsZS5vbignb3BlbicsIHRoaXMub25GaWxlT3Blbik7XG4gIHRoaXMuZmlsZS5vbignY2hhbmdlJywgdGhpcy5vbkZpbGVDaGFuZ2UpO1xuICB0aGlzLmZpbGUub24oJ2JlZm9yZSBjaGFuZ2UnLCB0aGlzLm9uQmVmb3JlRmlsZUNoYW5nZSk7XG4gIHRoaXMuaGlzdG9yeS5vbignY2hhbmdlJywgdGhpcy5vbkhpc3RvcnlDaGFuZ2UpO1xuICB0aGlzLmlucHV0Lm9uKCdibHVyJywgdGhpcy5vbkJsdXIpO1xuICB0aGlzLmlucHV0Lm9uKCdmb2N1cycsIHRoaXMub25Gb2N1cyk7XG4gIHRoaXMuaW5wdXQub24oJ2lucHV0JywgdGhpcy5vbklucHV0KTtcbiAgdGhpcy5pbnB1dC5vbigndGV4dCcsIHRoaXMub25UZXh0KTtcbiAgdGhpcy5pbnB1dC5vbigna2V5cycsIHRoaXMub25LZXlzKTtcbiAgdGhpcy5pbnB1dC5vbigna2V5JywgdGhpcy5vbktleSk7XG4gIHRoaXMuaW5wdXQub24oJ2N1dCcsIHRoaXMub25DdXQpO1xuICB0aGlzLmlucHV0Lm9uKCdjb3B5JywgdGhpcy5vbkNvcHkpO1xuICB0aGlzLmlucHV0Lm9uKCdwYXN0ZScsIHRoaXMub25QYXN0ZSk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNldXAnLCB0aGlzLm9uTW91c2VVcCk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWNsaWNrJywgdGhpcy5vbk1vdXNlQ2xpY2spO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWdiZWdpbicsIHRoaXMub25Nb3VzZURyYWdCZWdpbik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZycsIHRoaXMub25Nb3VzZURyYWcpO1xuICB0aGlzLmZpbmQub24oJ3N1Ym1pdCcsIHRoaXMuZmluZEp1bXAuYmluZCh0aGlzLCAxKSk7XG4gIHRoaXMuZmluZC5vbigndmFsdWUnLCB0aGlzLm9uRmluZFZhbHVlKTtcbiAgdGhpcy5maW5kLm9uKCdrZXknLCB0aGlzLm9uRmluZEtleSk7XG4gIHRoaXMuZmluZC5vbignb3BlbicsIHRoaXMub25GaW5kT3Blbik7XG4gIHRoaXMuZmluZC5vbignY2xvc2UnLCB0aGlzLm9uRmluZENsb3NlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uU2Nyb2xsID0gZnVuY3Rpb24oc2Nyb2xsKSB7XG4gIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICB0aGlzLnNjcm9sbC5zZXQoc2Nyb2xsKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW92ZSA9IGZ1bmN0aW9uKHBvaW50LCBieUVkaXQpIHtcbiAgaWYgKCFieUVkaXQpIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICBpZiAocG9pbnQpIHRoaXMuc2V0Q2FyZXQocG9pbnQpO1xuXG4gIGlmICghYnlFZGl0KSB7XG4gICAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgfHwgdGhpcy5pbnB1dC5tb3VzZS5kb3duKSB0aGlzLm1hcmtTZXQoKTtcbiAgICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIH1cblxuICB0aGlzLmVtaXQoJ21vdmUnKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Gb2N1cyA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IHRydWU7XG4gIHRoaXMuZW1pdCgnZm9jdXMnKTtcbiAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmx1ciA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5oYXNGb2N1cyA9IGZhbHNlO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHtcbiAgICAgIHRoaXMuZW1pdCgnYmx1cicpO1xuICAgICAgdGhpcy52aWV3cy5jYXJldC5yZW5kZXIoKTtcbiAgICB9XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKGtleXMgaW4gdGhpcy5iaW5kaW5ncykge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbiAgZWxzZSBpZiAoa2V5cyBpbiBEZWZhdWx0QmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgRGVmYXVsdEJpbmRpbmdzW2tleXNdLmNhbGwodGhpcywgZSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmIChrZXkgaW4gdGhpcy5iaW5kaW5ncy5zaW5nbGUpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleSBpbiBEZWZhdWx0QmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkN1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHRoaXMub25Db3B5KGUpO1xuICB0aGlzLmRlbGV0ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Db3B5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHJldHVybjtcbiAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgZS5jbGlwYm9hcmREYXRhLnNldERhdGEoJ3RleHQvcGxhaW4nLCB0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIHZhciB0ZXh0ID0gZS5jbGlwYm9hcmREYXRhLmdldERhdGEoJ3RleHQvcGxhaW4nKTtcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubW92ZS5iZWdpbk9mRmlsZSgpO1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZVJhdyA9IGZ1bmN0aW9uKHJhdykge1xuICB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRUYWJNb2RlID0gZnVuY3Rpb24oY2hhcikge1xuICBpZiAoJ1xcdCcgPT09IGNoYXIpIHtcbiAgICB0aGlzLnRhYiA9IGNoYXI7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy50YWIgPSBuZXcgQXJyYXkodGhpcy50YWJTaXplICsgMSkuam9pbihjaGFyKTtcbiAgfVxufVxuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVTZXQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldCh7IHg6MCwgeTowIH0pO1xuICB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcbiAgdGhpcy5zZXRUYWJNb2RlKHRoaXMuYnVmZmVyLnN5bnRheC50YWIpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25IaXN0b3J5Q2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xlYXIoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQmVmb3JlRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlQ2hhbmdlID0gZnVuY3Rpb24oZWRpdFJhbmdlLCBlZGl0U2hpZnQsIHRleHRCZWZvcmUsIHRleHRBZnRlcikge1xuICAvLyBjb25zb2xlLmxvZygnY2hhbmdlJylcbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMuYnVmZmVyLmxvY107XG5cbiAgaWYgKHRoaXMuZmluZC5pc09wZW4pIHtcbiAgICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlLCB0cnVlKTtcbiAgfVxuXG4gIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG5cbiAgdGhpcy52aWV3cy5jb2RlLnJlbmRlckVkaXQoe1xuICAgIGxpbmU6IGVkaXRSYW5nZVswXSxcbiAgICByYW5nZTogZWRpdFJhbmdlLFxuICAgIHNoaWZ0OiBlZGl0U2hpZnRcbiAgfSk7XG5cbiAgdGhpcy5yZW5kZXIoKTtcblxuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXRGcm9tUHggPSBmdW5jdGlvbihweCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMubWFyZ2luTGVmdCwgeTogdGhpcy5jaGFyLmhlaWdodC8yIH0pWycrJ10odGhpcy5vZmZzZXQpO1xuICB2YXIgcCA9IHB4WyctJ10oZylbJysnXSh0aGlzLnNjcm9sbClbJ28vJ10odGhpcy5jaGFyKTtcblxuICBwLnkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihwLnksIHRoaXMuYnVmZmVyLmxvYykpO1xuICBwLnggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihwLngsIHRoaXMuZ2V0TGluZUxlbmd0aChwLnkpKSk7XG5cbiAgdGhpcy5zZXRDYXJldChwKTtcbiAgdGhpcy5tb3ZlLmxhc3REZWxpYmVyYXRlWCA9IHAueDtcbiAgdGhpcy5vbk1vdmUoKTtcblxuICByZXR1cm4gcDtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VVcCA9IGZ1bmN0aW9uKCkge1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICBpZiAoIXRoaXMuaGFzRm9jdXMpIHRoaXMuYmx1cigpO1xuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEb3duID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQodGhpcy5mb2N1cy5iaW5kKHRoaXMpLCAxMCk7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0KSB0aGlzLm1hcmtCZWdpbigpO1xuICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy5jYXJldC5zZXQocCk7XG5cbiAgdmFyIHRhYnMgPSB0aGlzLmdldFBvaW50VGFicyh0aGlzLmNhcmV0KTtcblxuICB0aGlzLmNhcmV0UHguc2V0KHtcbiAgICB4OiB0aGlzLmNoYXIud2lkdGggKiAodGhpcy5jYXJldC54ICsgKHRhYnMgKiB0aGlzLnRhYlNpemUpIC0gdGFicyksXG4gICAgeTogdGhpcy5jaGFyLmhlaWdodCAqIHRoaXMuY2FyZXQueVxuICB9KTtcblxuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlQ2xpY2sgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNsaWNrcyA9IHRoaXMuaW5wdXQubW91c2UuY2xpY2tzO1xuICBpZiAoY2xpY2tzID4gMSkge1xuICAgIHZhciBhcmVhO1xuXG4gICAgaWYgKGNsaWNrcyA9PT0gMikge1xuICAgICAgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBdCh0aGlzLmNhcmV0KTtcbiAgICB9IGVsc2UgaWYgKGNsaWNrcyA9PT0gMykge1xuICAgICAgdmFyIHkgPSB0aGlzLmNhcmV0Lnk7XG4gICAgICBhcmVhID0gbmV3IEFyZWEoe1xuICAgICAgICBiZWdpbjogeyB4OiAwLCB5OiB5IH0sXG4gICAgICAgIGVuZDogeyB4OiB0aGlzLmdldExpbmVMZW5ndGgoeSksIHk6IHkgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5lbmQpO1xuICAgICAgdGhpcy5tYXJrU2V0QXJlYShhcmVhKTtcbiAgICAgIC8vIHRoaXMucmVuZGVyKCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZ0JlZ2luID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5kb3duKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQmVnaW4gPSBmdW5jdGlvbihhcmVhKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSB0cnVlO1xuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIH0gZWxzZSBpZiAoYXJlYSAhPT0gZmFsc2UgfHwgdGhpcy5tYXJrLmJlZ2luLnggPT09IC0xKSB7XG4gICAgICB0aGlzLm1hcmsuYmVnaW4uc2V0KHRoaXMuY2FyZXQpO1xuICAgICAgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0ID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLm1hcmtCZWdpbihhcmVhKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtDbGVhciA9IGZ1bmN0aW9uKGZvcmNlKSB7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0ICYmICFmb3JjZSkgcmV0dXJuO1xuXG4gIHRoaXMubWFyay5hY3RpdmUgPSBmYWxzZTtcbiAgdGhpcy5tYXJrLnNldCh7XG4gICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICB9KTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIFJhbmdlLmNsYW1wKHJhbmdlLCB0aGlzLnBhZ2VCb3VuZHMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHAgPSB0aGlzLnNjcm9sbFsnXy8nXSh0aGlzLmNoYXIpO1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMaW5lTGVuZ3RoKHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHAgPSB0aGlzLmNhcmV0UHg7XG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdmFyIHRvcCA9IHMueSAtIHAueTtcbiAgdmFyIGJvdHRvbSA9IChwLnkpIC0gKHMueSArIHRoaXMuc2l6ZS5oZWlnaHQpICsgdGhpcy5jaGFyLmhlaWdodDtcblxuICB2YXIgbGVmdCA9IChzLnggKyB0aGlzLmNoYXIud2lkdGgpIC0gcC54O1xuICB2YXIgcmlnaHQgPSAocC54KSAtIChzLnggKyB0aGlzLnNpemUud2lkdGggLSB0aGlzLm1hcmdpbkxlZnQpICsgdGhpcy5jaGFyLndpZHRoICogMjtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICAvLyBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZylcbiAgICB0aGlzLnNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbiAgLy8gZWxzZVxuICAgIC8vIHRoaXMuYW5pbWF0ZVNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbFRvID0gZnVuY3Rpb24ocCkge1xuICBkb20uc2Nyb2xsVG8odGhpcy5lbCwgcC54LCBwLnkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIHRoaXMuc2Nyb2xsLnNldChQb2ludC5sb3coe1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9LCB7XG4gICAgeDogdGhpcy5zY3JvbGwueCArIHgsXG4gICAgeTogdGhpcy5zY3JvbGwueSArIHlcbiAgfSkpO1xuICB0aGlzLnNjcm9sbFRvKHRoaXMuc2Nyb2xsKTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGVTY3JvbGxCeSA9IGZ1bmN0aW9uKHgsIHkpIHtcbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcpIHtcbiAgICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luKTtcbiAgfVxuXG4gIHZhciBzID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgfHwgdGhpcy5zY3JvbGw7XG5cbiAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWF4KDAsIHMueCArIHgpLFxuICAgIHk6IE1hdGgubWluKCh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0LCBNYXRoLm1heCgwLCBzLnkgKyB5KSlcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGR4ID0gTWF0aC5zaWduKGR4KSAqIDU7XG4gIGR5ID0gTWF0aC5zaWduKGR5KSAqIDU7XG5cbiAgdGhpcy5zY3JvbGxCeShkeCwgZHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDtcbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICB2YXIgYWR4ID0gTWF0aC5hYnMoZHgpO1xuICB2YXIgYWR5ID0gTWF0aC5hYnMoZHkpO1xuXG4gIGlmIChhZHkgPj0gdGhpcy5zaXplLmhlaWdodCAqIDEuMikge1xuICAgIHNwZWVkICo9IDIuNDU7XG4gIH1cblxuICBpZiAoYWR4IDwgMSAmJiBhZHkgPCAxKSB7XG4gICAgdGhpcy5zY3JvbGxUbyh0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCk7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQgPSBudWxsO1xuICAgIHRoaXMuZW1pdCgnYW5pbWF0aW9uIGVuZCcpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRoaXMuYW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUpO1xuXG4gIGlmIChhZHggPCBzcGVlZCkgZHggKj0gMC45O1xuICBlbHNlIGR4ID0gTWF0aC5zaWduKGR4KSAqIHNwZWVkO1xuXG4gIGlmIChhZHkgPCBzcGVlZCkgZHkgKj0gMC45O1xuICBlbHNlIGR5ID0gTWF0aC5zaWduKGR5KSAqIHNwZWVkO1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMuZGVsZXRlKCk7XG5cbiAgdmFyIGxpbmUgPSB0aGlzLmJ1ZmZlci5nZXRMaW5lKHRoaXMuY2FyZXQueSk7XG4gIHZhciByaWdodCA9IGxpbmVbdGhpcy5jYXJldC54XTtcbiAgdmFyIGhhc1JpZ2h0U3ltYm9sID0gflsnfScsJ10nLCcpJ10uaW5kZXhPZihyaWdodCk7XG5cbiAgLy8gYXBwbHkgaW5kZW50IG9uIGVudGVyXG4gIGlmIChORVdMSU5FLnRlc3QodGV4dCkpIHtcbiAgICB2YXIgaXNFbmRPZkxpbmUgPSB0aGlzLmNhcmV0LnggPT09IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgbGVmdCA9IGxpbmVbdGhpcy5jYXJldC54IC0gMV07XG4gICAgdmFyIGluZGVudCA9IGxpbmUubWF0Y2goL1xcUy8pO1xuICAgIGluZGVudCA9IGluZGVudCA/IGluZGVudC5pbmRleCA6IGxpbmUubGVuZ3RoIC0gMTtcbiAgICB2YXIgaGFzTGVmdFN5bWJvbCA9IH5bJ3snLCdbJywnKCddLmluZGV4T2YobGVmdCk7XG5cbiAgICBpZiAoaGFzTGVmdFN5bWJvbCkgaW5kZW50ICs9IDI7XG5cbiAgICBpZiAoaXNFbmRPZkxpbmUgfHwgaGFzTGVmdFN5bWJvbCkge1xuICAgICAgdGV4dCArPSBuZXcgQXJyYXkoaW5kZW50ICsgMSkuam9pbignICcpO1xuICAgIH1cbiAgfVxuXG4gIHZhciBsZW5ndGg7XG5cbiAgaWYgKCFoYXNSaWdodFN5bWJvbCB8fCAoaGFzUmlnaHRTeW1ib2wgJiYgIX5bJ30nLCddJywnKSddLmluZGV4T2YodGV4dCkpKSB7XG4gICAgbGVuZ3RoID0gdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsIHRleHQpO1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IDE7XG4gIH1cblxuICB0aGlzLm1vdmUuYnlDaGFycyhsZW5ndGgsIHRydWUpO1xuXG4gIGlmICgneycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnfScpO1xuICBlbHNlIGlmICgnKCcgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnKScpO1xuICBlbHNlIGlmICgnWycgPT09IHRleHQpIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXScpO1xuXG4gIGlmIChoYXNMZWZ0U3ltYm9sICYmIGhhc1JpZ2h0U3ltYm9sKSB7XG4gICAgaW5kZW50IC09IDI7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHRoaXMuY2FyZXQsICdcXG4nICsgbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKSk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmJhY2tzcGFjZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkge1xuICAgIGlmICh0aGlzLm1hcmsuYWN0aXZlICYmICF0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuIHRoaXMuZGVsZXRlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5kZWxldGVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xLCB0cnVlKTtcbiAgICB0aGlzLmJ1ZmZlci5kZWxldGVDaGFyQXQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzQmVnaW5PZkZpbGUoKSkgcmV0dXJuIHRoaXMuYmFja3NwYWNlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5kZWxldGVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuYnVmZmVyLmRlbGV0ZUNoYXJBdCh0aGlzLmNhcmV0KTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuZmluZEp1bXAgPSBmdW5jdGlvbihqdW1wKSB7XG4gIGlmICghdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggfHwgIXRoaXMuZmluZC5pc09wZW4pIHJldHVybjtcblxuICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmROZWVkbGUgKyBqdW1wO1xuICBpZiAodGhpcy5maW5kTmVlZGxlID49IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gMDtcbiAgfSBlbHNlIGlmICh0aGlzLmZpbmROZWVkbGUgPCAwKSB7XG4gICAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGggLSAxO1xuICB9XG5cbiAgdmFyIHJlc3VsdCA9IHRoaXMuZmluZFJlc3VsdHNbdGhpcy5maW5kTmVlZGxlXTtcbiAgdGhpcy5zZXRDYXJldChyZXN1bHQpO1xuICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5tb3ZlLmJ5Q2hhcnModGhpcy5maW5kVmFsdWUubGVuZ3RoLCB0cnVlKTtcbiAgdGhpcy5tYXJrU2V0KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZFZhbHVlID0gZnVuY3Rpb24odmFsdWUsIG5vSnVtcCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMuZ3V0dGVyLCB5OiAwIH0pO1xuXG4gIHRoaXMuYnVmZmVyLnVwZGF0ZVJhdygpO1xuXG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuXG4gIHRoaXMuZmluZFZhbHVlID0gdmFsdWU7XG4gIC8vIGNvbnNvbGUudGltZSgnZmluZCAnICsgdmFsdWUpO1xuICB0aGlzLmZpbmRSZXN1bHRzID0gdGhpcy5idWZmZXIuaW5kZXhlci5maW5kKHZhbHVlKS5tYXAoKG9mZnNldCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KTtcbiAgICAgIC8vcHg6IG5ldyBQb2ludChwb2ludClbJyonXShlLmNoYXIpWycrJ10oZylcbiAgfSk7XG4gIC8vIGNvbnNvbGUudGltZUVuZCgnZmluZCAnICsgdmFsdWUpO1xuXG4gIHRoaXMuZmluZC5pbmZvKCcwLycgKyB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCk7XG5cbiAgaWYgKCFub0p1bXApIHRoaXMuZmluZEp1bXAoMCk7XG5cbiAgdGhpcy52aWV3cy5maW5kLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kS2V5ID0gZnVuY3Rpb24oZSkge1xuICBpZiAoflszMywgMzQsIDExNF0uaW5kZXhPZihlLndoaWNoKSkgeyAvLyBwYWdldXAsIHBhZ2Vkb3duLCBmM1xuICAgIHRoaXMuaW5wdXQudGV4dC5vbmtleWRvd24oZSk7XG4gIH1cblxuICBpZiAoNzAgPT09IGUud2hpY2ggJiYgZS5jdHJsS2V5KSB7IC8vIGN0cmwrZlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKDkgPT09IGUud2hpY2gpIHsgLy8gdGFiXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZE9wZW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5maW5kLmluZm8oJycpO1xuICB0aGlzLm9uRmluZFZhbHVlKHRoaXMuZmluZFZhbHVlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZENsb3NlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudmlld3MuZmluZC5jbGVhcigpO1xuICB0aGlzLmZvY3VzKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zdWdnZXN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhcmVhID0gdGhpcy5idWZmZXIud29yZEF0KHRoaXMuY2FyZXQsIHRydWUpO1xuICBpZiAoIWFyZWEpIHJldHVybjtcblxuICB2YXIga2V5ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgaWYgKCFrZXkpIHJldHVybjtcblxuICBpZiAoIXRoaXMuc3VnZ2VzdFJvb3RcbiAgICB8fCBrZXkuc3Vic3RyKDAsIHRoaXMuc3VnZ2VzdFJvb3QubGVuZ3RoKSAhPT0gdGhpcy5zdWdnZXN0Um9vdCkge1xuICAgIHRoaXMuc3VnZ2VzdEluZGV4ID0gMDtcbiAgICB0aGlzLnN1Z2dlc3RSb290ID0ga2V5O1xuICAgIHRoaXMuc3VnZ2VzdE5vZGVzID0gdGhpcy5idWZmZXIucHJlZml4LmNvbGxlY3Qoa2V5KTtcbiAgfVxuXG4gIGlmICghdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoKSByZXR1cm47XG4gIHZhciBub2RlID0gdGhpcy5zdWdnZXN0Tm9kZXNbdGhpcy5zdWdnZXN0SW5kZXhdO1xuXG4gIHRoaXMuc3VnZ2VzdEluZGV4ID0gKHRoaXMuc3VnZ2VzdEluZGV4ICsgMSkgJSB0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGg7XG5cbiAgcmV0dXJuIHtcbiAgICBhcmVhOiBhcmVhLFxuICAgIG5vZGU6IG5vZGVcbiAgfTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBvaW50VGFicyA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZShwb2ludC55KTtcbiAgdmFyIHRhYnMgPSAwO1xuICB2YXIgdGFiO1xuICB3aGlsZSAofih0YWIgPSBsaW5lLmluZGV4T2YoJ1xcdCcsIHRhYiArIDEpKSkge1xuICAgIGlmICh0YWIgPj0gcG9pbnQueCkgYnJlYWs7XG4gICAgdGFicysrO1xuICB9XG4gIHJldHVybiB0YWJzO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVwYWludCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2l6ZSgpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHZhciAkID0gdGhpcy5lbDtcblxuICB0aGlzLm9mZnNldC5zZXQoZG9tLmdldE9mZnNldCgkKSk7XG4gIHRoaXMuc2Nyb2xsLnNldChkb20uZ2V0U2Nyb2xsKCQpKTtcbiAgdGhpcy5zaXplLnNldChkb20uZ2V0U2l6ZSgkKSk7XG5cbiAgLy8gdGhpcyBpcyBhIHdlaXJkIGZpeCB3aGVuIGRvaW5nIG11bHRpcGxlIC51c2UoKVxuICBpZiAodGhpcy5jaGFyLndpZHRoID09PSAwKSB0aGlzLmNoYXIuc2V0KGRvbS5nZXRDaGFyU2l6ZSgkLCBjc3MuY29kZSkpO1xuXG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYztcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG4gIHRoaXMucGFnZS5zZXQodGhpcy5zaXplWydeLyddKHRoaXMuY2hhcikpO1xuICB0aGlzLnBhZ2VSZW1haW5kZXIuc2V0KHRoaXMuc2l6ZVsnLSddKHRoaXMucGFnZVsnXyonXSh0aGlzLmNoYXIpKSk7XG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuICB0aGlzLmxvbmdlc3RMaW5lID0gTWF0aC5taW4oNTAwLCB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMb25nZXN0TGluZUxlbmd0aCgpKTtcbiAgdGhpcy5ndXR0ZXIgPSBNYXRoLm1heChcbiAgICB0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6ICgnJyt0aGlzLnJvd3MpLmxlbmd0aCxcbiAgICAodGhpcy5vcHRpb25zLmNlbnRlclxuICAgICAgPyAodGhpcy5wYWdlLndpZHRoIC0gODEpIC8gMiB8IDAgOiAwKVxuICAgICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3NcbiAgICAgID8gMCA6IE1hdGgubWF4KDMsICgnJyt0aGlzLnJvd3MpLmxlbmd0aCkpXG4gICkgKiB0aGlzLmNoYXIud2lkdGggKyAodGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiB0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbik7XG4gIHRoaXMubWFyZ2luTGVmdCA9IHRoaXMuZ3V0dGVyICsgdGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0O1xuXG4gIC8vIGRvbS5zdHlsZSh0aGlzLmVsLCB7XG4gIC8vICAgd2lkdGg6IHRoaXMubG9uZ2VzdExpbmUgKiB0aGlzLmNoYXIud2lkdGgsXG4gIC8vICAgaGVpZ2h0OiB0aGlzLnJvd3MgKiB0aGlzLmNoYXIuaGVpZ2h0XG4gIC8vIH0pO1xuXG4gIC8vVE9ETzogbWFrZSBtZXRob2QvdXRpbFxuICAvLyBkcmF3IGluZGVudCBpbWFnZVxuICB2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHZhciBmb28gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9vJyk7XG4gIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICBjYW52YXMuc2V0QXR0cmlidXRlKCd3aWR0aCcsIE1hdGguY2VpbCh0aGlzLmNoYXIud2lkdGggKiAyKSk7XG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ2hlaWdodCcsIHRoaXMuY2hhci5oZWlnaHQpO1xuXG4gIHZhciBjb21tZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY29tbWVudCcpO1xuICAkLmFwcGVuZENoaWxkKGNvbW1lbnQpO1xuICB2YXIgY29sb3IgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShjb21tZW50KS5jb2xvcjtcbiAgJC5yZW1vdmVDaGlsZChjb21tZW50KTtcbiAgY3R4LnNldExpbmVEYXNoKFsxLDFdKTtcbiAgY3R4LmxpbmVEYXNoT2Zmc2V0ID0gMDtcbiAgY3R4LmJlZ2luUGF0aCgpO1xuICBjdHgubW92ZVRvKDAsMSk7XG4gIGN0eC5saW5lVG8oMCwgdGhpcy5jaGFyLmhlaWdodCk7XG4gIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICBjdHguc3Ryb2tlKCk7XG5cbiAgdmFyIGRhdGFVUkwgPSBjYW52YXMudG9EYXRhVVJMKCk7XG5cbiAgZG9tLmNzcyh0aGlzLmlkLCBgXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MucnVsZXJ9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5maW5kfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MubWFya30sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmNvZGV9IHtcbiAgICAgIHBhZGRpbmctbGVmdDogJHt0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQgKyB0aGlzLmd1dHRlcn1weDtcbiAgICAgIHRhYi1zaXplOiAke3RoaXMudGFiU2l6ZX07XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5yb3dzfSB7XG4gICAgICBwYWRkaW5nLXJpZ2h0OiAke3RoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2lufXB4O1xuICAgICAgbWFyZ2luLWxlZnQ6ICR7dGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0fXB4O1xuICAgICAgd2lkdGg6ICR7dGhpcy5ndXR0ZXJ9cHg7XG4gICAgfVxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5maW5kfSA+IGksXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmJsb2NrfSA+IGkge1xuICAgICAgaGVpZ2h0OiAke3RoaXMuY2hhci5oZWlnaHQgKyAxfXB4O1xuICAgIH1cbiAgICBpbmRlbnQge1xuICAgICAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCR7ZGF0YVVSTH0pO1xuICAgIH1gXG4gICk7XG5cbiAgdGhpcy5lbWl0KCdyZXNpemUnKTtcbn07XG5cbkphenoucHJvdG90eXBlLmNsZWFyID0gYXRvbWljKGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnY2xlYXInKVxuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgdGhpcy52aWV3cy5jbGVhcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlbmRlciA9IGF0b21pYyhmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicpXG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG4gIHRoaXMuZW1pdCgncmVuZGVyJyk7XG59KTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBBcmVhO1xuXG5mdW5jdGlvbiBBcmVhKGEpIHtcbiAgaWYgKGEpIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50KGEuYmVnaW4pO1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50KGEuZW5kKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJlZ2luID0gbmV3IFBvaW50O1xuICAgIHRoaXMuZW5kID0gbmV3IFBvaW50O1xuICB9XG59XG5cbkFyZWEucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHRoaXMpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzID0gW3RoaXMuYmVnaW4sIHRoaXMuZW5kXS5zb3J0KFBvaW50LnNvcnQpO1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoc1swXSksXG4gICAgZW5kOiBuZXcgUG9pbnQoc1sxXSlcbiAgfSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMuYmVnaW4uc2V0KGFyZWEuYmVnaW4pO1xuICB0aGlzLmVuZC5zZXQoYXJlYS5lbmQpO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0TGVmdCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy5iZWdpbi54ID0geDtcbiAgdGhpcy5lbmQueCA9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuQXJlYS5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIGlmICh0aGlzLmJlZ2luLngpIHRoaXMuYmVnaW4ueCArPSB4O1xuICBpZiAodGhpcy5lbmQueCkgdGhpcy5lbmQueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZEJvdHRvbSA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5lbmQueSArPSB5O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLnNoaWZ0QnlMaW5lcyA9IGZ1bmN0aW9uKHkpIHtcbiAgdGhpcy5iZWdpbi55ICs9IHk7XG4gIHRoaXMuZW5kLnkgKz0geTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc+J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+IGEuZW5kLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj0nXSA9XG5BcmVhLnByb3RvdHlwZS5ncmVhdGVyVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5iZWdpbi54ID49IGEuYmVnaW4ueFxuICAgIDogdGhpcy5iZWdpbi55ID4gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzwnXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbiA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuYmVnaW4ueVxuICAgID8gdGhpcy5lbmQueCA8IGEuYmVnaW4ueFxuICAgIDogdGhpcy5lbmQueSA8IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PSddID1cbkFyZWEucHJvdG90eXBlLmxlc3NUaGFuT3JFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuZW5kLnkgPT09IGEuZW5kLnlcbiAgICA/IHRoaXMuZW5kLnggPD0gYS5lbmQueFxuICAgIDogdGhpcy5lbmQueSA8IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPjwnXSA9XG5BcmVhLnByb3RvdHlwZS5pbnNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+J10oYSkgJiYgdGhpc1snPCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZSA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzwnXShhKSB8fCB0aGlzWyc+J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPj08J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc+PSddKGEpICYmIHRoaXNbJzw9J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0+J10gPVxuQXJlYS5wcm90b3R5cGUub3V0c2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPD0nXShhKSB8fCB0aGlzWyc+PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz09PSddID1cbkFyZWEucHJvdG90eXBlLmVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi54ID09PSBhLmJlZ2luLnggJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICAgICYmIHRoaXMuZW5kLnggICA9PT0gYS5lbmQueCAgICYmIHRoaXMuZW5kLnkgICA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PSddID1cbkFyZWEucHJvdG90eXBlLmJlZ2luTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXwnXSA9XG5BcmVhLnByb3RvdHlwZS5lbmRMaW5lRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJ3w9fCddID1cbkFyZWEucHJvdG90eXBlLmxpbmVzRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyd8PSddKGEpICYmIHRoaXNbJz18J10oYSk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPXw9J10gPVxuQXJlYS5wcm90b3R5cGUuc2FtZUxpbmUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmJlZ2luLnkgPT09IHRoaXMuZW5kLnkgJiYgdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnLXgtJ10gPVxuQXJlYS5wcm90b3R5cGUuc2hvcnRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54ICsgeCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54IC0geCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJyt4KyddID1cbkFyZWEucHJvdG90eXBlLndpZGVuQnlYID0gZnVuY3Rpb24oeCkge1xuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7XG4gICAgICB4OiB0aGlzLmJlZ2luLnggLSB4LFxuICAgICAgeTogdGhpcy5iZWdpbi55XG4gICAgfSxcbiAgICBlbmQ6IHtcbiAgICAgIHg6IHRoaXMuZW5kLnggKyB4LFxuICAgICAgeTogdGhpcy5lbmQueVxuICAgIH1cbiAgfSk7XG59O1xuXG5BcmVhLm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0KGIuYmVnaW4sIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0KGIuZW5kLCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICBiZWdpbjogcG9pbnQub2Zmc2V0WCh4LCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldFgoeCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFkgPSBmdW5jdGlvbih5LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFkoeSwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRZKHksIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiAnJyArIGEuYmVnaW4gKyAnLScgKyBhLmVuZDtcbn07XG5cbkFyZWEuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEuYmVnaW4ueSA9PT0gYi5iZWdpbi55XG4gICAgPyBhLmJlZ2luLnggLSBiLmJlZ2luLnhcbiAgICA6IGEuYmVnaW4ueSAtIGIuYmVnaW4ueTtcbn07XG5cbkFyZWEudG9Qb2ludFNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPD0gYi55ICYmIGEuZW5kLnkgPj0gYi55XG4gICAgPyBhLmJlZ2luLnkgPT09IGIueVxuICAgICAgPyBhLmJlZ2luLnggLSBiLnhcbiAgICAgIDogYS5lbmQueSA9PT0gYi55XG4gICAgICAgID8gYS5lbmQueCAtIGIueFxuICAgICAgICA6IDBcbiAgICA6IGEuYmVnaW4ueSAtIGIueTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gYXRvbWljO1xuXG4vLyBmdW5jdGlvbiBhdG9taWMoZm4pIHtcbi8vICAgdmFyIHN0YWdlID0gZmFsc2U7XG4vLyAgIHZhciBuID0gMDtcblxuLy8gICBmdW5jdGlvbiB3cmFwKCkge1xuLy8gICAgIGlmIChzdGFnZSkgcmV0dXJuIG4rKztcbi8vICAgICBlbHNlIGZuLmNhbGwodGhpcyk7XG4vLyAgIH1cblxuLy8gICB3cmFwLmhvbGQgPSBmdW5jdGlvbigpIHtcbi8vICAgICBzdGFnZSA9IHRydWU7XG4vLyAgICAgbiA9IG4gfHwgMDtcbi8vICAgfTtcblxuLy8gICB3cmFwLnJlbGVhc2UgPSBmdW5jdGlvbihjb250ZXh0KSB7XG4vLyAgICAgaWYgKHN0YWdlICYmIG4pIHtcbi8vICAgICAgIHN0YWdlID0gZmFsc2U7XG4vLyAgICAgICBuID0gMDtcbi8vICAgICAgIGZuLmNhbGwoY29udGV4dCk7XG4vLyAgICAgfVxuLy8gICB9O1xuXG4vLyAgIHJldHVybiB3cmFwO1xuLy8gfVxuXG5mdW5jdGlvbiBhdG9taWMoZm4pIHtcbiAgdmFyIHJlcXVlc3Q7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMpIHtcbiAgICBjbGVhckltbWVkaWF0ZShyZXF1ZXN0KTtcbiAgICByZXF1ZXN0ID0gc2V0SW1tZWRpYXRlKGZuLmJpbmQodGhpcywgYSwgYiwgYykpO1xuICB9O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEJveDtcblxuZnVuY3Rpb24gQm94KGIpIHtcbiAgaWYgKGIpIHtcbiAgICB0aGlzLndpZHRoID0gYi53aWR0aDtcbiAgICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xuICB9IGVsc2Uge1xuICAgIHRoaXMud2lkdGggPSAwO1xuICAgIHRoaXMuaGVpZ2h0ID0gMDtcbiAgfVxufVxuXG5Cb3gucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKGIpIHtcbiAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gIHRoaXMuaGVpZ2h0ID0gYi5oZWlnaHQ7XG59O1xuXG5Cb3gucHJvdG90eXBlWycvJ10gPVxuQm94LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18vJ10gPVxuQm94LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSB8IDBcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydeLyddID1cbkJveC5wcm90b3R5cGUuY2VpbGRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJyonXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXionXSA9XG5Cb3gucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiBNYXRoLmNlaWwodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLmNlaWwodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ28qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5yb3VuZCh0aGlzLndpZHRoICogKGIud2lkdGggfHwgYi54IHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGgucm91bmQodGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ18qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAqIChiLmhlaWdodCB8fCBiLnkgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnLSddID1cbkJveC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLSAoYi53aWR0aCB8fCBiLnggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAtIChiLmhlaWdodCB8fCBiLnkgfHwgMClcbiAgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGNsb25lKG9iaikge1xuICB2YXIgbyA9IHt9O1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgdmFyIHZhbCA9IG9ialtrZXldO1xuICAgIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIHZhbCkge1xuICAgICAgb1trZXldID0gY2xvbmUodmFsKTtcbiAgICB9IGVsc2Uge1xuICAgICAgb1trZXldID0gdmFsO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZm4sIG1zKSB7XG4gIHZhciB0aW1lb3V0O1xuXG4gIHJldHVybiBmdW5jdGlvbiBkZWJvdW5jZVdyYXAoYSwgYiwgYywgZCkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICB0aW1lb3V0ID0gc2V0VGltZW91dChmbi5iaW5kKHRoaXMsIGEsIGIsIGMsIGQpLCBtcyk7XG4gICAgcmV0dXJuIHRpbWVvdXQ7XG4gIH1cbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vZG9tJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9ldmVudCcpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlhbG9nO1xuXG5mdW5jdGlvbiBEaWFsb2cobGFiZWwsIGtleW1hcCkge1xuICB0aGlzLm5vZGUgPSBkb20oY3NzLmRpYWxvZywgW1xuICAgIGA8bGFiZWw+JHtjc3MubGFiZWx9YCxcbiAgICBbY3NzLmlucHV0LCBbXG4gICAgICBgPGlucHV0PiR7Y3NzLnRleHR9YCxcbiAgICAgIGNzcy5pbmZvXG4gICAgXV1cbiAgXSk7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MubGFiZWxdLCBsYWJlbCk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogJ25vbmUnIH0pO1xuICB0aGlzLmtleW1hcCA9IGtleW1hcDtcbiAgdGhpcy5vbmJvZHlrZXlkb3duID0gdGhpcy5vbmJvZHlrZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXlkb3duID0gdGhpcy5vbmtleWRvd24uYmluZCh0aGlzKTtcbiAgdGhpcy5vbmlucHV0ID0gdGhpcy5vbmlucHV0LmJpbmQodGhpcyk7XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmNsaWNrID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNldXAgPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLm9ubW91c2Vkb3duID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xufVxuXG5EaWFsb2cucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuZnVuY3Rpb24gc3RvcFByb3BhZ2F0aW9uKGUpIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaGFzRm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMubm9kZVtjc3MuaW5wdXRdLmVsLmhhc0ZvY3VzKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9uYm9keWtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgyNyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKDEzID09PSBlLndoaWNoKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuc3VibWl0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChlLndoaWNoIGluIHRoaXMua2V5bWFwKSB7XG4gICAgdGhpcy5lbWl0KCdrZXknLCBlKTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3ZhbHVlJywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICBkb20uYXBwZW5kKGRvY3VtZW50LmJvZHksIHRoaXMubm9kZSk7XG4gIGRvbS5mb2N1cyh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0pO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MudGV4dF0uZWwuc2VsZWN0KCk7XG4gIHRoaXMuaXNPcGVuID0gdHJ1ZTtcbiAgdGhpcy5lbWl0KCdvcGVuJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gIGRvY3VtZW50LmJvZHkucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIHRoaXMub25ib2R5a2V5ZG93bik7XG4gIHRoaXMubm9kZS5lbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMubm9kZS5lbCk7XG4gIHRoaXMuaXNPcGVuID0gZmFsc2U7XG4gIHRoaXMuZW1pdCgnY2xvc2UnKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuc3VibWl0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZW1pdCgnc3VibWl0JywgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaW5mbyA9IGZ1bmN0aW9uKGluZm8pIHtcbiAgZG9tLnRleHQodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCBpbmZvKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgeyBkaXNwbGF5OiBpbmZvID8gJ2Jsb2NrJyA6ICdub25lJyB9KTtcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImRpYWxvZ1wiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2RpYWxvZ1wiLFwiaW5wdXRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbnB1dFwiLFwidGV4dFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX3RleHRcIixcImxhYmVsXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9fbGFiZWxcIixcImluZm9cIjpcIl9saWJfZGlhbG9nX3N0eWxlX19pbmZvXCJ9IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG5cbmZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBhKSB7XG4gICAgdmFyIGQgPSB7fTtcbiAgICB2YXIgaSA9IDA7XG4gICAgZm9yICh2YXIgayBpbiBiKSB7XG4gICAgICBpZiAoYVtrXSAhPT0gYltrXSkge1xuICAgICAgICBkW2tdID0gYltrXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaSkgcmV0dXJuIGQ7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGEgIT09IGI7XG4gIH1cbn1cbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJy4vcG9pbnQnKTtcbnZhciBhdG9taWMgPSByZXF1aXJlKCcuL2F0b21pYycpO1xudmFyIG1lbW9pemUgPSByZXF1aXJlKCcuL21lbW9pemUnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4vbWVyZ2UnKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG52YXIgc2xpY2UgPSBbXS5zbGljZTtcblxudmFyIHVuaXRzID0ge1xuICBsZWZ0OiAncHgnLFxuICB0b3A6ICdweCcsXG4gIHJpZ2h0OiAncHgnLFxuICBib3R0b206ICdweCcsXG4gIHdpZHRoOiAncHgnLFxuICBoZWlnaHQ6ICdweCcsXG4gIG1heEhlaWdodDogJ3B4JyxcbiAgcGFkZGluZ0xlZnQ6ICdweCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGRvbTtcblxuZnVuY3Rpb24gZG9tKG5hbWUsIGNoaWxkcmVuLCBhdHRycykge1xuICB2YXIgZWw7XG4gIHZhciB0YWcgPSAnZGl2JztcbiAgdmFyIG5vZGU7XG5cbiAgaWYgKCdzdHJpbmcnID09PSB0eXBlb2YgbmFtZSkge1xuICAgIGlmICgnPCcgPT09IG5hbWUuY2hhckF0KDApKSB7XG4gICAgICB2YXIgbWF0Y2hlcyA9IG5hbWUubWF0Y2goLyg/OjwpKC4qKSg/Oj4pKFxcUyspPy8pO1xuICAgICAgaWYgKG1hdGNoZXMpIHtcbiAgICAgICAgdGFnID0gbWF0Y2hlc1sxXTtcbiAgICAgICAgbmFtZSA9IG1hdGNoZXNbMl0gfHwgdGFnO1xuICAgICAgfVxuICAgIH1cbiAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcbiAgICBub2RlID0ge1xuICAgICAgZWw6IGVsLFxuICAgICAgbmFtZTogbmFtZS5zcGxpdCgnICcpWzBdXG4gICAgfTtcbiAgICBkb20uY2xhc3Nlcyhub2RlLCBuYW1lLnNwbGl0KCcgJykuc2xpY2UoMSkpO1xuICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICByZXR1cm4gZG9tLmFwcGx5KG51bGwsIG5hbWUpO1xuICB9IGVsc2Uge1xuICAgIGlmICgnZG9tJyBpbiBuYW1lKSB7XG4gICAgICBub2RlID0gbmFtZS5kb207XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUgPSBuYW1lO1xuICAgIH1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KGNoaWxkcmVuKSkge1xuICAgIGNoaWxkcmVuXG4gICAgICAubWFwKGRvbSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQsIGkpIHtcbiAgICAgICAgbm9kZVtjaGlsZC5uYW1lXSA9IGNoaWxkO1xuICAgICAgICByZXR1cm4gY2hpbGQ7XG4gICAgICB9KVxuICAgICAgLm1hcChmdW5jdGlvbihjaGlsZCkge1xuICAgICAgICBub2RlLmVsLmFwcGVuZENoaWxkKGNoaWxkLmVsKTtcbiAgICAgIH0pO1xuICB9IGVsc2UgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgY2hpbGRyZW4pIHtcbiAgICBkb20uc3R5bGUobm9kZSwgY2hpbGRyZW4pO1xuICB9XG5cbiAgaWYgKGF0dHJzKSB7XG4gICAgZG9tLmF0dHJzKG5vZGUsIGF0dHJzKTtcbiAgfVxuXG4gIHJldHVybiBub2RlO1xufVxuXG5kb20uc3R5bGUgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBfLCBzdHlsZSkge1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn0sIGRpZmYsIG1lcmdlLCBmdW5jdGlvbihub2RlLCBzdHlsZSkge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgc3R5bGVdO1xufSk7XG5cbi8qXG5kb20uc3R5bGUgPSBmdW5jdGlvbihlbCwgc3R5bGUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGZvciAodmFyIG5hbWUgaW4gc3R5bGUpXG4gICAgaWYgKG5hbWUgaW4gdW5pdHMpXG4gICAgICBzdHlsZVtuYW1lXSArPSB1bml0c1tuYW1lXTtcbiAgT2JqZWN0LmFzc2lnbihlbC5zdHlsZSwgc3R5bGUpO1xufTtcbiovXG5kb20uY2xhc3NlcyA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbC5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG59LCBudWxsLCBudWxsLCBmdW5jdGlvbihub2RlLCBjbGFzc2VzKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBjbGFzc2VzLmNvbmNhdChub2RlLm5hbWUpLmZpbHRlcihCb29sZWFuKS5qb2luKCcgJyldO1xufSk7XG5cbmRvbS5hdHRycyA9IGZ1bmN0aW9uKGVsLCBhdHRycykge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgT2JqZWN0LmFzc2lnbihlbCwgYXR0cnMpO1xufTtcblxuZG9tLmh0bWwgPSBmdW5jdGlvbihlbCwgaHRtbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn07XG5cbmRvbS50ZXh0ID0gZnVuY3Rpb24oZWwsIHRleHQpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLnRleHRDb250ZW50ID0gdGV4dDtcbn07XG5cbmRvbS5mb2N1cyA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5mb2N1cygpO1xufTtcblxuZG9tLmdldFNpemUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogZWwuY2xpZW50V2lkdGgsXG4gICAgaGVpZ2h0OiBlbC5jbGllbnRIZWlnaHRcbiAgfTtcbn07XG5cbmRvbS5nZXRDaGFyU2l6ZSA9IGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3BhbicpO1xuICBzcGFuLmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcblxuICBlbC5hcHBlbmRDaGlsZChzcGFuKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgJztcbiAgdmFyIGEgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAgXFxuICc7XG4gIHZhciBiID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBlbC5yZW1vdmVDaGlsZChzcGFuKTtcblxuICByZXR1cm4ge1xuICAgIHdpZHRoOiAoYi53aWR0aCAtIGEud2lkdGgpLFxuICAgIGhlaWdodDogKGIuaGVpZ2h0IC0gYS5oZWlnaHQpXG4gIH07XG59O1xuXG5kb20uZ2V0T2Zmc2V0ID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgdmFyIGJvcmRlckxlZnQgPSBwYXJzZUludChzdHlsZS5ib3JkZXJMZWZ0V2lkdGgpO1xuICB2YXIgYm9yZGVyVG9wID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyVG9wV2lkdGgpO1xuICByZXR1cm4gUG9pbnQubG93KHsgeDogMCwgeTogMCB9LCB7XG4gICAgeDogKHJlY3QubGVmdCArIGJvcmRlckxlZnQpIHwgMCxcbiAgICB5OiAocmVjdC50b3AgKyBib3JkZXJUb3ApIHwgMFxuICB9KTtcbn07XG5cbmRvbS5nZXRTY3JvbGwgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIGdldFNjcm9sbChlbCk7XG59O1xuXG5kb20ub25zY3JvbGwgPSBmdW5jdGlvbiBvbnNjcm9sbChlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG5cbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH0gZWxzZSB7XG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcignc2Nyb2xsJywgaGFuZGxlcik7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVyKGV2KSB7XG4gICAgZm4oZ2V0U2Nyb2xsKGVsKSk7XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24gb2Zmc2Nyb2xsKCkge1xuICAgIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG59O1xuXG5kb20ub25vZmZzZXQgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHdoaWxlIChlbCA9IGVsLm9mZnNldFBhcmVudCkge1xuICAgIGRvbS5vbnNjcm9sbChlbCwgZm4pO1xuICB9XG59O1xuXG5kb20ub25jbGljayA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICByZXR1cm4gZWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmbik7XG59O1xuXG5kb20ub25yZXNpemUgPSBmdW5jdGlvbihmbikge1xuICByZXR1cm4gd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIGZuKTtcbn07XG5cbmRvbS5hcHBlbmQgPSBmdW5jdGlvbih0YXJnZXQsIHNyYywgZGljdCkge1xuICB0YXJnZXQgPSBkb20uZ2V0RWxlbWVudCh0YXJnZXQpO1xuICBpZiAoJ2ZvckVhY2gnIGluIHNyYykgc3JjLmZvckVhY2goZG9tLmFwcGVuZC5iaW5kKG51bGwsIHRhcmdldCkpO1xuICAvLyBlbHNlIGlmICgndmlld3MnIGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyYy52aWV3cywgdHJ1ZSk7XG4gIGVsc2UgaWYgKGRpY3QgPT09IHRydWUpIGZvciAodmFyIGtleSBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmNba2V5XSk7XG4gIGVsc2UgaWYgKCdmdW5jdGlvbicgIT0gdHlwZW9mIHNyYykgdGFyZ2V0LmFwcGVuZENoaWxkKGRvbS5nZXRFbGVtZW50KHNyYykpO1xufTtcblxuZG9tLnJlbW92ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBpZiAoZWwucGFyZW50Tm9kZSkgZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChlbCk7XG59O1xuXG5kb20uZ2V0RWxlbWVudCA9IGZ1bmN0aW9uKGVsKSB7XG4gIHJldHVybiBlbC5kb20gJiYgZWwuZG9tLmVsIHx8IGVsLmVsIHx8IGVsLm5vZGUgfHwgZWw7XG59O1xuXG5kb20uc2Nyb2xsQnkgPSBmdW5jdGlvbihlbCwgeCwgeSwgc2Nyb2xsKSB7XG4gIHNjcm9sbCA9IHNjcm9sbCB8fCBkb20uZ2V0U2Nyb2xsKGVsKTtcbiAgZG9tLnNjcm9sbFRvKGVsLCBzY3JvbGwueCArIHgsIHNjcm9sbC55ICsgeSk7XG59O1xuXG5kb20uc2Nyb2xsVG8gPSBmdW5jdGlvbihlbCwgeCwgeSkge1xuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICB3aW5kb3cuc2Nyb2xsVG8oeCwgeSk7XG4gIH0gZWxzZSB7XG4gICAgZWwuc2Nyb2xsTGVmdCA9IHggfHwgMDtcbiAgICBlbC5zY3JvbGxUb3AgPSB5IHx8IDA7XG4gIH1cbn07XG5cbmRvbS5jc3MgPSBhdG9taWMoZnVuY3Rpb24oaWQsIGNzc1RleHQpIHtcbiAgaWYgKCEoaWQgaW4gZG9tLmNzcy5zdHlsZXMpKSB7XG4gICAgZG9tLmNzcy5zdHlsZXNbaWRdID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRvbS5jc3Muc3R5bGVzW2lkXSk7XG4gIH1cbiAgZG9tLmNzcy5zdHlsZXNbaWRdLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn0pO1xuXG5kb20uY3NzLnN0eWxlcyA9IHt9O1xuXG5kb20uZ2V0TW91c2VQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG5cbmZ1bmN0aW9uIGdldFNjcm9sbChlbCkge1xuICByZXR1cm4gZG9jdW1lbnQuYm9keSA9PT0gZWxcbiAgICA/IHtcbiAgICAgICAgeDogd2luZG93LnNjcm9sbFggfHwgZWwuc2Nyb2xsTGVmdCB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsTGVmdCxcbiAgICAgICAgeTogd2luZG93LnNjcm9sbFkgfHwgZWwuc2Nyb2xsVG9wICB8fCBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsVG9wXG4gICAgICB9XG4gICAgOiB7XG4gICAgICAgIHg6IGVsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJ2YXIgY2xvbmUgPSByZXF1aXJlKCcuL2Nsb25lJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChjbG9uZShwYXJhbSkpO1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIGluZGV4ID0gcmVzdWx0cy5wdXNoKGZuKG5vZGUsIHBhcmFtLCBwYXJhbSkpO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVyZ2UoZGVzdCwgc3JjKSB7XG4gIGZvciAodmFyIGtleSBpbiBzcmMpIHtcbiAgICBkZXN0W2tleV0gPSBzcmNba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gb3BlbjtcblxuZnVuY3Rpb24gb3Blbih1cmwsIGNiKSB7XG4gIHJldHVybiBmZXRjaCh1cmwpXG4gICAgLnRoZW4oZ2V0VGV4dClcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG5cbmZ1bmN0aW9uIGdldFRleHQocmVzKSB7XG4gIHJldHVybiByZXMudGV4dCgpO1xufVxuIiwidmFyIFRPS0VOUyA9IC8uKz9cXGJ8LlxcQnxcXGIuKz8vZztcbnZhciBXT1JEID0gL1suL1xcXFxcXChcXClcIidcXC06LC47PD5+IUAjJCVeJipcXHxcXCs9XFxbXFxde31gflxcPyBdKy9nO1xuXG52YXIgcGFyc2UgPSBleHBvcnRzO1xuXG5wYXJzZS53b3JkcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgd29yZHMucHVzaCh3b3JkKTtcbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG5cbnBhcnNlLnRva2VucyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIHdoaWxlICh3b3JkID0gVE9LRU5TLmV4ZWMocykpIHtcbiAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICB9XG5cbiAgcmV0dXJuIHdvcmRzO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBQb2ludDtcblxuZnVuY3Rpb24gUG9pbnQocCkge1xuICBpZiAocCkge1xuICAgIHRoaXMueCA9IHAueDtcbiAgICB0aGlzLnkgPSBwLnk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy54ID0gMDtcbiAgICB0aGlzLnkgPSAwO1xuICB9XG59XG5cblBvaW50LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihwKSB7XG4gIHRoaXMueCA9IHAueDtcbiAgdGhpcy55ID0gcC55O1xufTtcblxuUG9pbnQucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh0aGlzKTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5hZGRSaWdodCA9IGZ1bmN0aW9uKHgpIHtcbiAgdGhpcy54ICs9IHg7XG4gIHJldHVybiB0aGlzO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycvJ10gPVxuUG9pbnQucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18vJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvLyddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZERpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14vJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKyddID1cblBvaW50LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCArIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWyctJ10gPVxuUG9pbnQucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC0gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAtIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJyonXSA9XG5Qb2ludC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnXionXSA9XG5Qb2ludC5wcm90b3R5cGUuY2VpbE11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5jZWlsKHRoaXMueCAqIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5jZWlsKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydvKiddID1cblBvaW50LnByb3RvdHlwZS5yb3VuZE11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5yb3VuZCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGgucm91bmQodGhpcy55ICogKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ18qJ10gPVxuUG9pbnQucHJvdG90eXBlLmZsb29yTXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAneDonICsgdGhpcy54ICsgJyx5OicgKyB0aGlzLnk7XG59O1xuXG5Qb2ludC5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUG9pbnQuZ3JpZFJvdW5kID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgucm91bmQoYS54IC8gYi53aWR0aCksXG4gICAgeTogTWF0aC5yb3VuZChhLnkgLyBiLmhlaWdodClcbiAgfTtcbn07XG5cblBvaW50LmxvdyA9IGZ1bmN0aW9uKGxvdywgcCkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgubWF4KGxvdy54LCBwLngpLFxuICAgIHk6IE1hdGgubWF4KGxvdy55LCBwLnkpXG4gIH07XG59O1xuXG5Qb2ludC5jbGFtcCA9IGZ1bmN0aW9uKGFyZWEsIHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogTWF0aC5taW4oYXJlYS5lbmQueCwgTWF0aC5tYXgoYXJlYS5iZWdpbi54LCBwLngpKSxcbiAgICB5OiBNYXRoLm1pbihhcmVhLmVuZC55LCBNYXRoLm1heChhcmVhLmJlZ2luLnksIHAueSkpXG4gIH0pO1xufTtcblxuUG9pbnQub2Zmc2V0ID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4geyB4OiBhLnggKyBiLngsIHk6IGEueSArIGIueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WCA9IGZ1bmN0aW9uKHgsIHApIHtcbiAgcmV0dXJuIHsgeDogcC54ICsgeCwgeTogcC55IH07XG59O1xuXG5Qb2ludC5vZmZzZXRZID0gZnVuY3Rpb24oeSwgcCkge1xuICByZXR1cm4geyB4OiBwLngsIHk6IHAueSArIHkgfTtcbn07XG5cblBvaW50LnRvTGVmdFRvcCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIHtcbiAgICBsZWZ0OiBwLngsXG4gICAgdG9wOiBwLnlcbiAgfTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gQU5EO1xuXG5mdW5jdGlvbiBBTkQoYSwgYikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIG91dCA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSBhWzBdOyBpIDw9IGFbMV07IGkrKykge1xuICAgIGZvdW5kID0gZmFsc2U7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGIubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChpID49IGJbal1bMF0gJiYgaSA8PSBiW2pdWzFdKSB7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQ7XG59XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gTk9UO1xuXG5mdW5jdGlvbiBOT1QoYSwgYikge1xuICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIG91dCA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSBhWzBdOyBpIDw9IGFbMV07IGkrKykge1xuICAgIGZvdW5kID0gZmFsc2U7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGIubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChpID49IGJbal1bMF0gJiYgaSA8PSBiW2pdWzFdKSB7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwidmFyIEFORCA9IHJlcXVpcmUoJy4vcmFuZ2UtZ2F0ZS1hbmQnKTtcbnZhciBOT1QgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtbm90Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUmFuZ2U7XG5cbmZ1bmN0aW9uIFJhbmdlKHIpIHtcbiAgaWYgKHIpIHtcbiAgICB0aGlzWzBdID0gclswXTtcbiAgICB0aGlzWzFdID0gclsxXTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzWzBdID0gMDtcbiAgICB0aGlzWzFdID0gMTtcbiAgfVxufTtcblxuUmFuZ2UuQU5EID0gQU5EO1xuUmFuZ2UuTk9UID0gTk9UO1xuXG5SYW5nZS5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUmFuZ2UuZXF1YWwgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhWzBdID09PSBiWzBdICYmIGFbMV0gPT09IGJbMV07XG59O1xuXG5SYW5nZS5jbGFtcCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIG5ldyBSYW5nZShbXG4gICAgTWF0aC5taW4oYlsxXSwgTWF0aC5tYXgoYVswXSwgYlswXSkpLFxuICAgIE1hdGgubWluKGFbMV0sIGJbMV0pXG4gIF0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UodGhpcyk7XG59O1xuXG5SYW5nZS5yYW5nZXMgPSBmdW5jdGlvbihpdGVtcykge1xuICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uKGl0ZW0pIHsgcmV0dXJuIGl0ZW0ucmFuZ2UgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPj0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA8PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3ZlcmxhcCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdIDw9IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPj0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVsxXSA8IHJhbmdlWzBdIHx8IGl0ZW0ucmFuZ2VbMF0gPiByYW5nZVsxXTtcbiAgfSk7XG59O1xuIiwiXG52YXIgUmVnZXhwID0gZXhwb3J0cztcblxuUmVnZXhwLmNyZWF0ZSA9IGZ1bmN0aW9uKG5hbWVzLCBmbGFncywgZm4pIHtcbiAgZm4gPSBmbiB8fCBmdW5jdGlvbihzKSB7IHJldHVybiBzIH07XG4gIHJldHVybiBuZXcgUmVnRXhwKFxuICAgIG5hbWVzXG4gICAgLm1hcCgobikgPT4gJ3N0cmluZycgPT09IHR5cGVvZiBuID8gUmVnZXhwLnR5cGVzW25dIDogbilcbiAgICAubWFwKChyKSA9PiBmbihyLnRvU3RyaW5nKCkuc2xpY2UoMSwtMSkpKVxuICAgIC5qb2luKCd8JyksXG4gICAgZmxhZ3NcbiAgKTtcbn07XG5cblJlZ2V4cC50eXBlcyA9IHtcbiAgJ3Rva2Vucyc6IC8uKz9cXGJ8LlxcQnxcXGIuKz8vLFxuICAnd29yZHMnOiAvW2EtekEtWjAtOV17MSx9LyxcbiAgJ3BhcnRzJzogL1suL1xcXFxcXChcXClcIidcXC06LC47PD5+IUAjJCVeJipcXHxcXCs9XFxbXFxde31gflxcPyBdKy8sXG5cbiAgJ3NpbmdsZSBjb21tZW50JzogL1xcL1xcLy4qPyQvLFxuICAnZG91YmxlIGNvbW1lbnQnOiAvXFwvXFwqW15dKj9cXCpcXC8vLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IC8oJyg/Oig/OlxcXFxcXG58XFxcXCd8W14nXFxuXSkpKj8nKS8sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogLyhcIig/Oig/OlxcXFxcXG58XFxcXFwifFteXCJcXG5dKSkqP1wiKS8sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAvKGAoPzooPzpcXFxcYHxbXmBdKSkqP2ApLyxcblxuICAnb3BlcmF0b3InOiAvIXw+PT98PD0/fD17MSwzfXwoPzomKXsxLDJ9fFxcfD9cXHx8XFw/fFxcKnxcXC98fnxcXF58JXxcXC4oPyFcXGQpfFxcK3sxLDJ9fFxcLXsxLDJ9LyxcbiAgJ2Z1bmN0aW9uJzogLyAoKD8hXFxkfFsuIF0qPyhpZnxlbHNlfGRvfGZvcnxjYXNlfHRyeXxjYXRjaHx3aGlsZXx3aXRofHN3aXRjaCkpW2EtekEtWjAtOV8gJF0rKSg/PVxcKC4qXFwpLip7KS8sXG4gICdrZXl3b3JkJzogL1xcYihicmVha3xjYXNlfGNhdGNofGNvbnN0fGNvbnRpbnVlfGRlYnVnZ2VyfGRlZmF1bHR8ZGVsZXRlfGRvfGVsc2V8ZXhwb3J0fGV4dGVuZHN8ZmluYWxseXxmb3J8ZnJvbXxpZnxpbXBsZW1lbnRzfGltcG9ydHxpbnxpbnN0YW5jZW9mfGludGVyZmFjZXxsZXR8bmV3fHBhY2thZ2V8cHJpdmF0ZXxwcm90ZWN0ZWR8cHVibGljfHJldHVybnxzdGF0aWN8c3VwZXJ8c3dpdGNofHRocm93fHRyeXx0eXBlb2Z8d2hpbGV8d2l0aHx5aWVsZClcXGIvLFxuICAnZGVjbGFyZSc6IC9cXGIoZnVuY3Rpb258aW50ZXJmYWNlfGNsYXNzfHZhcnxsZXR8Y29uc3R8ZW51bXx2b2lkKVxcYi8sXG4gICdidWlsdGluJzogL1xcYihPYmplY3R8RnVuY3Rpb258Qm9vbGVhbnxFcnJvcnxFdmFsRXJyb3J8SW50ZXJuYWxFcnJvcnxSYW5nZUVycm9yfFJlZmVyZW5jZUVycm9yfFN0b3BJdGVyYXRpb258U3ludGF4RXJyb3J8VHlwZUVycm9yfFVSSUVycm9yfE51bWJlcnxNYXRofERhdGV8U3RyaW5nfFJlZ0V4cHxBcnJheXxGbG9hdDMyQXJyYXl8RmxvYXQ2NEFycmF5fEludDE2QXJyYXl8SW50MzJBcnJheXxJbnQ4QXJyYXl8VWludDE2QXJyYXl8VWludDMyQXJyYXl8VWludDhBcnJheXxVaW50OENsYW1wZWRBcnJheXxBcnJheUJ1ZmZlcnxEYXRhVmlld3xKU09OfEludGx8YXJndW1lbnRzfGNvbnNvbGV8d2luZG93fGRvY3VtZW50fFN5bWJvbHxTZXR8TWFwfFdlYWtTZXR8V2Vha01hcHxQcm94eXxSZWZsZWN0fFByb21pc2UpXFxiLyxcbiAgJ3NwZWNpYWwnOiAvXFxiKHRydWV8ZmFsc2V8bnVsbHx1bmRlZmluZWQpXFxiLyxcbiAgJ3BhcmFtcyc6IC9mdW5jdGlvblsgXFwoXXsxfVteXSo/XFx7LyxcbiAgJ251bWJlcic6IC8tP1xcYigweFtcXGRBLUZhLWZdK3xcXGQqXFwuP1xcZCsoW0VlXVsrLV0/XFxkKyk/fE5hTnwtP0luZmluaXR5KVxcYi8sXG4gICdzeW1ib2wnOiAvW3t9W1xcXSgpLDpdLyxcbiAgJ3JlZ2V4cCc6IC8oPyFbXlxcL10pKFxcLyg/IVtcXC98XFwqXSkuKj9bXlxcXFxcXF5dXFwvKShbO1xcblxcLlxcKVxcXVxcfSBnaW1dKS8sXG5cbiAgJ3htbCc6IC88W14+XSo+LyxcbiAgJ3VybCc6IC8oKFxcdys6XFwvXFwvKVstYS16QS1aMC05OkA7PyY9XFwvJVxcK1xcLlxcKiEnXFwoXFwpLFxcJF9cXHtcXH1cXF5+XFxbXFxdYCN8XSspLyxcbiAgJ2luZGVudCc6IC9eICt8XlxcdCsvLFxuICAnbGluZSc6IC9eLiskfF5cXG4vLFxuICAnbmV3bGluZSc6IC9cXHJcXG58XFxyfFxcbi8sXG59O1xuXG5SZWdleHAudHlwZXMuY29tbWVudCA9IFJlZ2V4cC5jcmVhdGUoW1xuICAnc2luZ2xlIGNvbW1lbnQnLFxuICAnZG91YmxlIGNvbW1lbnQnLFxuXSk7XG5cblJlZ2V4cC50eXBlcy5zdHJpbmcgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZycsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuXSk7XG5cblJlZ2V4cC50eXBlcy5tdWx0aWxpbmUgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ2RvdWJsZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZycsXG4gICdpbmRlbnQnLFxuICAnbGluZSdcbl0pO1xuXG5SZWdleHAucGFyc2UgPSBmdW5jdGlvbihzLCByZWdleHAsIGZpbHRlcikge1xuICB2YXIgd29yZHMgPSBbXTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGZpbHRlcikge1xuICAgIHdoaWxlICh3b3JkID0gcmVnZXhwLmV4ZWMocykpIHtcbiAgICAgIGlmIChmaWx0ZXIod29yZCkpIHdvcmRzLnB1c2god29yZCk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHdoaWxlICh3b3JkID0gcmVnZXhwLmV4ZWMocykpIHtcbiAgICAgIHdvcmRzLnB1c2god29yZCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHdvcmRzO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBzYXZlO1xuXG5mdW5jdGlvbiBzYXZlKHVybCwgc3JjLCBjYikge1xuICByZXR1cm4gZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGJvZHk6IHNyYyxcbiAgICB9KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cbiIsIi8vIE5vdGU6IFlvdSBwcm9iYWJseSBkbyBub3Qgd2FudCB0byB1c2UgdGhpcyBpbiBwcm9kdWN0aW9uIGNvZGUsIGFzIFByb21pc2UgaXNcbi8vICAgbm90IHN1cHBvcnRlZCBieSBhbGwgYnJvd3NlcnMgeWV0LlxuXG4oZnVuY3Rpb24oKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICBpZiAod2luZG93LnNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBlbmRpbmcgPSB7fSxcbiAgICAgICAgbmV4dEhhbmRsZSA9IDE7XG5cbiAgICBmdW5jdGlvbiBvblJlc29sdmUoaGFuZGxlKSB7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICAgICAgY2FsbGJhY2suZm4uYXBwbHkobnVsbCwgY2FsbGJhY2suYXJncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3aW5kb3cuc2V0SW1tZWRpYXRlID0gZnVuY3Rpb24oZm4pIHtcbiAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICAgICAgaGFuZGxlO1xuXG4gICAgICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImludmFsaWQgZnVuY3Rpb25cIik7XG4gICAgICAgIH1cblxuICAgICAgICBoYW5kbGUgPSBuZXh0SGFuZGxlKys7XG4gICAgICAgIHBlbmRpbmdbaGFuZGxlXSA9IHsgZm46IGZuLCBhcmdzOiBhcmdzIH07XG5cbiAgICAgICAgbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICAgICAgcmVzb2x2ZShoYW5kbGUpO1xuICAgICAgICB9KS50aGVuKG9uUmVzb2x2ZSk7XG5cbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9O1xuXG4gICAgd2luZG93LmNsZWFySW1tZWRpYXRlID0gZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgfTtcbn0oKSk7IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgcnVubmluZywgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYykge1xuICAgIGlmIChydW5uaW5nKSByZXR1cm47XG4gICAgcnVubmluZyA9IHRydWU7XG4gICAgZm4uY2FsbCh0aGlzLCBhLCBiLCBjKTtcbiAgICBzZXRUaW1lb3V0KHJlc2V0LCBtcyk7XG4gIH07XG5cbiAgZnVuY3Rpb24gcmVzZXQoKSB7XG4gICAgcnVubmluZyA9IGZhbHNlO1xuICB9XG59O1xuIiwiXG52YXIgdHJpbSA9IGV4cG9ydHM7XG5cbnRyaW0uZW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHRyYWlsaW5nID0gdHJpbS50cmFpbGluZ0VtcHR5TGluZXMocyk7XG4gIHZhciBsZWFkaW5nID0gdHJpbS5sZWFkaW5nRW1wdHlMaW5lcyh0cmFpbGluZy5zdHJpbmcpO1xuICByZXR1cm4ge1xuICAgIHRyYWlsaW5nOiB0cmFpbGluZy5yZW1vdmVkLFxuICAgIGxlYWRpbmc6IGxlYWRpbmcucmVtb3ZlZCxcbiAgICByZW1vdmVkOiB0cmFpbGluZy5yZW1vdmVkICsgbGVhZGluZy5yZW1vdmVkLFxuICAgIHN0cmluZzogbGVhZGluZy5zdHJpbmdcbiAgfTtcbn07XG5cbnRyaW0udHJhaWxpbmdFbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgaW5kZXggPSBzLmxlbmd0aDtcbiAgdmFyIGxhc3RJbmRleCA9IGluZGV4O1xuICB2YXIgbiA9IDA7XG4gIHdoaWxlIChcbiAgICB+KGluZGV4ID0gcy5sYXN0SW5kZXhPZignXFxuJywgbGFzdEluZGV4IC0gMSkpXG4gICAgJiYgaW5kZXggLSBsYXN0SW5kZXggPT09IC0xKSB7XG4gICAgbisrO1xuICAgIGxhc3RJbmRleCA9IGluZGV4O1xuICB9XG5cbiAgaWYgKG4pIHMgPSBzLnNsaWNlKDAsIGxhc3RJbmRleCk7XG5cbiAgcmV0dXJuIHtcbiAgICByZW1vdmVkOiBuLFxuICAgIHN0cmluZzogc1xuICB9O1xufTtcblxudHJpbS5sZWFkaW5nRW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIGluZGV4ID0gLTE7XG4gIHZhciBsYXN0SW5kZXggPSBpbmRleDtcbiAgdmFyIG4gPSAwO1xuXG4gIHdoaWxlIChcbiAgICB+KGluZGV4ID0gcy5pbmRleE9mKCdcXG4nLCBsYXN0SW5kZXggKyAxKSlcbiAgICAmJiBpbmRleCAtIGxhc3RJbmRleCA9PT0gMSkge1xuICAgIG4rKztcbiAgICBsYXN0SW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIGlmIChuKSBzID0gcy5zbGljZShsYXN0SW5kZXggKyAxKTtcblxuICByZXR1cm4ge1xuICAgIHJlbW92ZWQ6IG4sXG4gICAgc3RyaW5nOiBzXG4gIH07XG59O1xuIiwidmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBhdG9taWMgPSByZXF1aXJlKCcuLi8uLi9saWIvYXRvbWljJyk7XG52YXIgcGFyc2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcGFyc2UnKTtcbnZhciBBcmVhID0gcmVxdWlyZSgnLi4vLi4vbGliL2FyZWEnKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yZWdleHAnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIExpbmVzID0gcmVxdWlyZSgnLi9saW5lcycpO1xudmFyIFN5bnRheCA9IHJlcXVpcmUoJy4vc3ludGF4Jyk7XG52YXIgU2VnbWVudHMgPSByZXF1aXJlKCcuL3NlZ21lbnRzJyk7XG52YXIgU2tpcFN0cmluZyA9IHJlcXVpcmUoJy4vc2tpcHN0cmluZycpO1xudmFyIFByZWZpeFRyZWUgPSByZXF1aXJlKCcuL3ByZWZpeHRyZWUnKTtcbnZhciBJbmRleGVyID0gcmVxdWlyZSgnLi9pbmRleGVyJyk7XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IEJ1ZmZlcjtcblxudmFyIEVPTCA9IGV4cG9ydHMuRU9MID0gL1xcclxcbnxcXHJ8XFxuL2c7XG52YXIgTiA9IGV4cG9ydHMuTiA9IC9cXG4vZztcbnZhciBDSFVOS19TSVpFID0gZXhwb3J0cy5DSFVOS19TSVpFID0gNTAwMDtcbnZhciBXT1JEUyA9IFJlZ2V4cC5jcmVhdGUoWyd0b2tlbnMnXSwgJ2cnKTtcblxuZnVuY3Rpb24gQnVmZmVyKCkge1xuICB0aGlzLnN5bnRheCA9IG5ldyBTeW50YXg7XG4gIHRoaXMuaW5kZXhlciA9IG5ldyBJbmRleGVyKHRoaXMpO1xuICB0aGlzLnNlZ21lbnRzID0gbmV3IFNlZ21lbnRzKHRoaXMpO1xuICB0aGlzLm9uKCd1cGRhdGUnLCBkZWJvdW5jZSh0aGlzLnVwZGF0ZVJhdy5iaW5kKHRoaXMpLCAzMDApKTtcbiAgdGhpcy5vbigncmF3JywgdGhpcy5zZWdtZW50cy5pbmRleC5iaW5kKHRoaXMuc2VnbWVudHMpKTtcbiAgdGhpcy5zZXQoJycpO1xufVxuXG5CdWZmZXIucHJvdG90eXBlID0ge1xuICBnZXQgbG9jKCkge1xuICAgIHJldHVybiB0aGlzLmxpbmVzLmxlbmd0aDtcbiAgfVxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKCFyYW5nZSkgcmV0dXJuIHRoaXMudGV4dC5nZXRSYW5nZSgpO1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMubGluZXMuZ2V0UmFuZ2UocmFuZ2UpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG52YXIgQkxPQ0sgPSB7XG4gICdjb21tZW50JzogJy8qJyxcbiAgJ3N0cmluZyc6ICdgJyxcbn07XG5cbnZhciBCTE9DS19FTkQgPSB7XG4gICdjb21tZW50JzogJyovJyxcbiAgJ3N0cmluZyc6ICdgJyxcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0SGlnaGxpZ2h0ZWQgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgY29kZSA9IHRoaXMuZ2V0KHJhbmdlKTtcbiAgLy8gcmV0dXJuIHRoaXMuc3ludGF4LmVudGl0aWVzKGNvZGUpO1xuICAvLyByZXR1cm4gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUpO1xuXG4gIHZhciBibG9jayA9IHRoaXMuc2VnbWVudHMuZ2V0KHJhbmdlWzBdKTtcbiAgLy8gY29uc29sZS50aW1lRW5kKCdnZXQgc2VnbWVudCcpXG4gIGlmIChibG9jaykge1xuICAgIGNvZGUgPSBCTE9DS1tibG9ja10gKyAnXFx1ZmZiYScgKyBjb2RlICsgJ1xcdWZmYmUnICsgQkxPQ0tfRU5EW2Jsb2NrXTtcbiAgICBjb2RlID0gdGhpcy5zeW50YXguaGlnaGxpZ2h0KGNvZGUpO1xuICAgIGNvZGUgPSAnPCcgKyBibG9jayArICc+JyArXG4gICAgICBjb2RlLnN1YnN0cmluZyhcbiAgICAgICAgY29kZS5pbmRleE9mKCdcXHVmZmJhJykgKyAxLFxuICAgICAgICBjb2RlLmxhc3RJbmRleE9mKCdcXHVmZmJlJylcbiAgICAgICk7XG4gIH0gZWxzZSB7XG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlICsgJ1xcdWZmYmUqL2AnKTtcbiAgICBjb2RlID0gY29kZS5zdWJzdHJpbmcoXG4gICAgICAwLFxuICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgKTtcbiAgfVxuICByZXR1cm4gY29kZTtcbn07XG5cbi8vVE9ETzogdGhpcyBkZWZlYXRzIHRoZSBwdXJwb3NlIG9mIGhhdmluZyBhIHNraXBsaXN0XG4vLyBuZWVkIHRvIGdldCByaWQgb2YgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS51cGRhdGVSYXcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5yYXcgPSB0aGlzLmdldCgpO1xuICB0aGlzLmVtaXQoJ3JhdycsIHRoaXMucmF3KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0T2Zmc2V0TGluZSA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmxpbmVzLmdldE9mZnNldChvZmZzZXQpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLnJhbmdlKTtcbiAgcmV0dXJuIHtcbiAgICBwb2ludDogcG9pbnQsXG4gICAgdGV4dDogdGV4dFxuICB9O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRMaW5lID0gZnVuY3Rpb24oeSkge1xuICByZXR1cm4gdGhpcy5nZXQoW3kseV0pO1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuY2hhbmdlcyA9IDA7XG5cbiAgdGhpcy5yYXcgPSB0ZXh0ID0gbm9ybWFsaXplRU9MKHRleHQpO1xuICB0aGlzLmVtaXQoJ3JhdycsIHRoaXMucmF3KTtcblxuICB0aGlzLnRleHQgPSBuZXcgU2tpcFN0cmluZyh7IGNodW5rU2l6ZTogQ0hVTktfU0laRSB9KTtcbiAgdGhpcy50ZXh0LnNldCh0ZXh0KTtcblxuICB0aGlzLnByZWZpeCA9IG5ldyBQcmVmaXhUcmVlO1xuICB0aGlzLnByZWZpeC5pbmRleCh0aGlzLnJhdyk7XG5cbiAgdGhpcy5saW5lcyA9IG5ldyBMaW5lcztcbiAgdGhpcy5saW5lcy5pbnNlcnQoeyB4OjAsIHk6MCB9LCB0aGlzLnJhdyk7XG5cbiAgdGhpcy5zeW50YXgudGFiID0gdGhpcy5yYXcuaW5kZXhPZignXFx0JykgPj0gMCA/ICdcXHQnIDogJyAnO1xuXG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHBvaW50LCB0ZXh0LCBzaGlmdCwgaXNDdHJsU2hpZnQpIHtcbiAgdmFyIGlzRU9MLCBsaW5lcywgcmFuZ2UsIGJlZm9yZSwgYWZ0ZXI7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgaWYgKCFpc0N0cmxTaGlmdCkgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICBpc0VPTCA9ICdcXG4nID09PSB0ZXh0O1xuICBzaGlmdCA9ICFpc0N0cmxTaGlmdCAmJiAoc2hpZnQgfHwgaXNFT0wpO1xuXG4gIHBvaW50ID0gdGhpcy5saW5lcy5nZXRQb2ludChwb2ludCk7XG4gIGxpbmVzID0gdGhpcy5saW5lcy5pbnNlcnQocG9pbnQsIHRleHQpO1xuICByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgbGluZXNdO1xuXG4gIGJlZm9yZSA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG5cbiAgYWZ0ZXIgPSB0aGlzLmdldChyYW5nZSk7XG5cbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICBpZiAoaXNDdHJsU2hpZnQpIHJhbmdlID0gW01hdGgubWF4KDAsIHJhbmdlWzBdLTEpLCByYW5nZVsxXV07XG5cbiAgdGhpcy5zZWdtZW50cy5zaGlmdChwb2ludC5vZmZzZXQsIHRleHQubGVuZ3RoKTtcblxuICAvL1RPRE86IGkgdGhpbmsgc2hpZnQgc2hvdWxkIGJlICdsaW5lcydcbiAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xuXG4gIC8vIHRoaXMgaXMgdG8gdXBkYXRlIGNhcmV0IHBvc2l0aW9uXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQ2hhckF0ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGlzRU9MLCByYW5nZSwgYmVmb3JlLCBhZnRlcjtcblxuICB0aGlzLmNoYW5nZXMrKztcblxuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICBwb2ludCA9IHRoaXMubGluZXMuZ2V0UG9pbnQocG9pbnQpO1xuICBpc0VPTCA9IHRoaXMubGluZXMucmVtb3ZlQ2hhckF0KHBvaW50KTtcbiAgcmFuZ2UgPSBSYW5nZS5jbGFtcChbMCwgdGhpcy5saW5lcy5sZW5ndGhdLCBbcG9pbnQueSwgcG9pbnQueSArIGlzRU9MXSk7XG5cbiAgYmVmb3JlID0gdGhpcy5nZXQocmFuZ2UpO1xuXG4gIHRoaXMudGV4dC5yZW1vdmVDaGFyQXQocG9pbnQub2Zmc2V0KTtcblxuICBhZnRlciA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG5cbiAgdGhpcy5zZWdtZW50cy5zaGlmdChwb2ludC5vZmZzZXQsIC0xKTtcblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCAtaXNFT0wsIGJlZm9yZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBdCA9IGZ1bmN0aW9uKHBvaW50LCBpbmNsdXNpdmUpIHtcbiAgaW5jbHVzaXZlID0gaW5jbHVzaXZlIHx8IDA7XG5cbiAgcG9pbnQgPSB0aGlzLmxpbmVzLmdldFBvaW50KHBvaW50KTtcblxuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLnJhbmdlKTtcblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQXJlYSA9IGZ1bmN0aW9uKGFyZWEsIG5vVXBkYXRlKSB7XG4gIHZhciByYW5nZSwgb2Zmc2V0cywgbGluZXM7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgb2Zmc2V0cyA9IHRoaXMubGluZXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICBsaW5lcyA9IHRoaXMubGluZXMucmVtb3ZlQXJlYShhcmVhKTtcbiAgcmFuZ2UgPSBbYXJlYS5iZWdpbi55LCBhcmVhLmVuZC55XTtcblxuICB0aGlzLnRleHQucmVtb3ZlKG9mZnNldHMpO1xuXG4gIHRoaXMuc2VnbWVudHMuc2hpZnQob2Zmc2V0c1swXSwgb2Zmc2V0c1swXS1vZmZzZXRzWzFdKTtcblxuICBpZiAoIW5vVXBkYXRlKSB7XG4gICAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSk7XG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmxpbmVzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmVuZC54ID4gMCB8fCBhcmVhLmJlZ2luLnkgPT09IGFyZWEuZW5kLnkpIGFyZWEuZW5kLnkgKz0gMTtcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwO1xuICBhcmVhLmVuZC54ID0gMDtcblxuICB2YXIgdGV4dCA9IHRoaXMuZ2V0KFthcmVhLmJlZ2luLnksIGFyZWEuZW5kLnktMV0pO1xuICB0aGlzLmRlbGV0ZUFyZWEoYXJlYSwgdHJ1ZSk7XG5cbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0LCB5LCB0cnVlKTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVPTChzKSB7XG4gIHJldHVybiBzLnJlcGxhY2UoZXhwb3J0cy5FT0wsICdcXG4nKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBJbmRleGVyO1xuXG5mdW5jdGlvbiBJbmRleGVyKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbn1cblxuSW5kZXhlci5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKCFzKSByZXR1cm4gW107XG4gIHZhciBvZmZzZXRzID0gW107XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIucmF3O1xuICB2YXIgbGVuID0gcy5sZW5ndGg7XG4gIHZhciBpbmRleDtcbiAgd2hpbGUgKH4oaW5kZXggPSB0ZXh0LmluZGV4T2YocywgaW5kZXggKyBsZW4pKSkge1xuICAgIG9mZnNldHMucHVzaChpbmRleCk7XG4gIH1cbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuIiwiXG4vKlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXyA9IGNhcmV0XG4gKlxuICogICAwICAgMSAgIDIgICAzICAgNCAgICA1ICAgMCAgIDEgICAyICAgMyAgIDQgICAgNSAgIDAgICAxICAgMlxuICogfCBoIHwgZSB8IGwgfCBsIHwgbyB8IFxcbiB8IHcgfCBvIHwgciB8IGwgfCBkIHwgXFxuIHwgISB8ICEgfCBfIHxcbiAqIDAgICAxICAgMiAgIDMgICA0ICAgNSAgICA2ICAgNyAgIDggICA5ICAgMTAgIDExICAgMTIgIDEzICAxNCAgMTVcbiAqXG4gKiBnZXQoMCkgLT4gMFxuICogZ2V0KDEpIC0+IDZcbiAqIGdldCgyKSAtPiAxMlxuICogZ2V0KDMpIC0+IHRocm93c1xuICpcbiAqIGxlZnQgaW5jbHVzaXZlLCByaWdodCBleGNsdXNpdmU6XG4gKlxuICogZ2V0TGluZSh4KS5vZmZzZXQgPT09IGdldCh4KVxuICogZ2V0TGluZSgwKS5yYW5nZSAtPiAwLTZcbiAqIGdldExpbmUoMSkucmFuZ2UgLT4gNi0xMlxuICogZ2V0TGluZSgyKS5yYW5nZSAtPiAxMi0xM1xuICogZ2V0TGluZSgzKSAtPiB0aHJvd3NcbiAqXG4gKiBnZXRSYW5nZShbMCwwXSkgLT4gMC02XG4gKiBnZXRSYW5nZShbMCwxXSkgLT4gMC0xMlxuICogZ2V0UmFuZ2UoWzEsMV0pIC0+IDYtMTJcbiAqIGdldFJhbmdlKFsxLDJdKSAtPiA2LTEzXG4gKiBnZXRSYW5nZShbMiwyXSkgLT4gMTItMTNcbiAqIGdldFJhbmdlKFsyLDNdKSAtPiB0aHJvd3NcbiAqIGdldFJhbmdlKFswLDNdKSAtPiB0aHJvd3NcbiAqXG4gKiBnZXRQb2ludCh7IHg6eCwgeTp5IH0pLmxpbmUgPT09IGdldExpbmUoeSlcbiAqIGdldFBvaW50KHsgeDowLCB5OjAgfSkub2Zmc2V0IC0+IDBcbiAqIGdldFBvaW50KHsgeDowLCB5OjAgfSkucG9pbnQgLT4geyB4OjAsIHk6MCB9XG4gKiBnZXRQb2ludCh7IHg6MiwgeTowIH0pLm9mZnNldCAtPiAyXG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MCB9KS5vZmZzZXQgLT4gNVxuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjAgfSkucG9pbnQgLT4geyB4OjUsIHk6MCB9XG4gKiBnZXRQb2ludCh7IHg6MCwgeToxIH0pLm9mZnNldCAtPiA2XG4gKiBnZXRQb2ludCh7IHg6MiwgeToxIH0pLm9mZnNldCAtPiA4XG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MSB9KS5vZmZzZXQgLT4gMTFcbiAqIGdldFBvaW50KHsgeDoxMCwgeToxIH0pLnBvaW50IC0+IHsgeDo1LCB5OjEgfVxuICogZ2V0UG9pbnQoeyB4OjAsIHk6MiB9KS5vZmZzZXQgLT4gMTJcbiAqIGdldFBvaW50KHsgeDoxMCwgeToyIH0pLm9mZnNldCAtPiAxM1xuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjIgfSkucG9pbnQgLT4geyB4OjEsIHk6MiB9XG4gKiBnZXRSYW5nZSh7IHg6MTAwLCB5OjEwMCB9KS5vZmZzZXQgLT4gMTNcbiAqIGdldFJhbmdlKHsgeDoxMDAsIHk6MTAwIH0pLnBvaW50IC0+IHsgeDoxLCB5OiAyIH1cbiAqXG4gKiBnZXRMaW5lTGVuZ3RoKDApIC0+IDZcbiAqIGdldExpbmVMZW5ndGgoMSkgLT4gNlxuICogZ2V0TGluZUxlbmd0aCgyKSAtPiAyXG4gKiBnZXRMaW5lTGVuZ3RoKDMpIC0+IHRocm93c1xuICovXG5cbnZhciBFT0wgPSAvXFxyXFxufFxccnxcXG4vZztcbnZhciBOID0gL1xcbi9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IExpbmVzO1xuXG5mdW5jdGlvbiBMaW5lcygpIHtcbiAgdGhpcy5pbmRleCA9IFtdO1xuICB0aGlzLnRhaWwgPSAnJztcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5MaW5lcy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5kZXhbdGhpcy5sZW5ndGggLSAxXSArIHRoaXMudGFpbC5sZW5ndGggKyAxO1xuICB9XG4gIHZhciBsaW5lID0gdGhpcy5pbmRleFt5IC0gMV0gfHwgMDtcblxuICByZXR1cm4geSA+IDAgPyBsaW5lICsgMSA6IDA7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIGI7XG5cbiAgaWYgKHJhbmdlWzFdICsgMSA+PSB0aGlzLmxlbmd0aCArIDEpIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0pICsgdGhpcy50YWlsLmxlbmd0aDtcbiAgfSBlbHNlIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0gKyAxKTtcbiAgfVxuXG4gIHJldHVybiBbYSwgYl07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0RGlzdGFuY2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIGI7XG5cbiAgaWYgKHJhbmdlWzFdID09PSB0aGlzLmxlbmd0aCArIDEpIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0gLSAxKSArIHRoaXMudGFpbC5sZW5ndGg7XG4gIH0gZWxzZSB7XG4gICAgYiA9IHRoaXMuZ2V0KHJhbmdlWzFdKSAtIDE7XG4gIH1cblxuICByZXR1cm4gYiAtIGE7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuZ2V0RGlzdGFuY2UoW3ksIHkrMV0pO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExvbmdlc3RMaW5lTGVuZ3RoID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsb25nZXN0ID0gMDtcbiAgdmFyIGQgPSAwO1xuICB2YXIgcCA9IHRoaXMuaW5kZXhbdGhpcy5sZW5ndGggLSAxXTtcbiAgdmFyIGkgPSB0aGlzLmxlbmd0aDtcbiAgd2hpbGUgKGktLSA+IDApIHtcbiAgICBkID0gdGhpcy5pbmRleFtpXSAtIHRoaXMuaW5kZXhbaSAtIDFdO1xuICAgIGxvbmdlc3QgPSBkID4gbG9uZ2VzdCA/IGQgOiBsb25nZXN0O1xuICB9XG4gIHJldHVybiBsb25nZXN0O1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBvZmZzZXQgPSB0aGlzLmdldCh5KTtcbiAgdmFyIHBvaW50ID0geyB4OiAwLCB5OiB5IH07XG4gIHZhciBsZW5ndGggPSB0aGlzLmdldExpbmVMZW5ndGgocG9pbnQueSk7XG4gIHZhciByYW5nZSA9IFtvZmZzZXQsIG9mZnNldCArIGxlbmd0aF07XG5cbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICBwb2ludDogcG9pbnQsXG4gICAgcmFuZ2U6IHJhbmdlLFxuICAgIGxlbmd0aDogbGVuZ3RoLFxuICB9O1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocG9pbnQueSk7XG5cbiAgdmFyIHBvaW50ID0ge1xuICAgIHg6IE1hdGgubWluKHBvaW50LngsIGxpbmUubGVuZ3RoKSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIG9mZnNldDogbGluZS5vZmZzZXQgKyBwb2ludC54LFxuICAgIHBvaW50OiBwb2ludCxcbiAgICB4OiBwb2ludC54LFxuICAgIHk6IHBvaW50LnksXG4gICAgbGluZTogbGluZSxcbiAgfTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHRoaXMubGVuZ3RoO1xuICBpZiAoIWVuZCkgcmV0dXJuO1xuXG4gIHZhciBwID0gLTE7XG4gIHZhciBpID0gLTE7XG5cbiAgZG8ge1xuICAgIHAgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBpZiAodGhpcy5nZXQoaSkgPD0gb2Zmc2V0KSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwICE9PSBpKTtcblxuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShpKTtcbiAgdmFyIHggPSBvZmZzZXQgLSBsaW5lLm9mZnNldDtcbiAgaWYgKCB4ID4gbGluZS5sZW5ndGhcbiAgICAmJiBpID09PSB0aGlzLmxlbmd0aCAtIDEpIHtcbiAgICB4IC09IGxpbmUubGVuZ3RoICsgMTtcbiAgICBpICs9IDE7XG4gICAgaWYgKHggPiB0aGlzLnRhaWwubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogaSxcbiAgICBsaW5lOiBsaW5lXG4gIH07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocCwgdGV4dCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgeCA9IHBvaW50Lng7XG4gIHZhciB5ID0gcG9pbnQueTtcbiAgdmFyIG9mZnNldCA9IHBvaW50Lm9mZnNldDtcblxuICBpZiAoeSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0ZXh0ID0gdGhpcy50YWlsLnN1YnN0cigwLHgpICsgdGV4dCArIHRoaXMudGFpbC5zdWJzdHIoeCk7XG4gICAgdGhpcy50YWlsID0gJyc7XG4gICAgb2Zmc2V0IC09IHg7XG4gIH1cblxuICB2YXIgbWF0Y2hlcyA9IFt5LCAwXTtcbiAgdmFyIG1hdGNoID0gLTE7XG4gIHZhciBzaGlmdCA9IDA7XG4gIHZhciBsYXN0ID0gLTE7XG5cbiAgd2hpbGUgKH4obWF0Y2ggPSB0ZXh0LmluZGV4T2YoJ1xcbicsIG1hdGNoICsgMSkpKSB7XG4gICAgbWF0Y2hlcy5wdXNoKG1hdGNoICsgb2Zmc2V0KTtcbiAgICBsYXN0ID0gbWF0Y2g7XG4gIH1cblxuICBzaGlmdCArPSBsYXN0ICsgMTtcblxuICB2YXIgdGFpbCA9IHRleHQuc2xpY2UobGFzdCArIDEpO1xuICBpZiAoeSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0aGlzLnRhaWwgKz0gdGFpbDtcbiAgfVxuXG4gIGlmICh5IDwgdGhpcy5sZW5ndGgpIHtcbiAgICBzaGlmdCArPSB0YWlsLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0KHksIHNoaWZ0KTtcbiAgfVxuXG4gIGlmIChtYXRjaGVzLmxlbmd0aCA8IDMpIHJldHVybiAwO1xuXG4gIHRoaXMuaW5kZXguc3BsaWNlLmFwcGx5KHRoaXMuaW5kZXgsIG1hdGNoZXMpO1xuXG4gIHZhciBsaW5lcyA9IHRoaXMuaW5kZXgubGVuZ3RoIC0gdGhpcy5sZW5ndGg7XG5cbiAgdGhpcy5sZW5ndGggPSB0aGlzLmluZGV4Lmxlbmd0aDtcblxuICByZXR1cm4gbGluZXM7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuaW5zZXJ0TGluZSA9IGZ1bmN0aW9uKHksIHRleHQpIHtcbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6eSB9LCB0ZXh0KTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgYXJlYS5iZWdpbi55LFxuICAgIGFyZWEuZW5kLnlcbiAgXSk7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICByZXR1cm4gW1xuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5iZWdpbikub2Zmc2V0LFxuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpLm9mZnNldFxuICBdO1xufTtcblxuTGluZXMucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGEgPSB0aGlzLmdldFBvaW50KHApO1xuICBpZiAoYS5wb2ludC55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgIHRoaXMudGFpbCA9IHRoaXMudGFpbC5zbGljZSgwLCAtMSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGVsc2Uge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IGEubGluZS5sZW5ndGggPT09IGEucG9pbnQueDtcbiAgICBpZiAoaXNFbmRPZkxpbmUpIHtcbiAgICAgIHRoaXMuaW5kZXguc3BsaWNlKGEucG9pbnQueSwgMSk7XG4gICAgICB0aGlzLmxlbmd0aCA9IHRoaXMuaW5kZXgubGVuZ3RoO1xuICAgICAgaWYgKGEucG9pbnQueSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy50YWlsICs9IG5ldyBBcnJheShhLmxpbmUubGVuZ3RoKzEpLmpvaW4oJyonKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5zaGlmdChhLnBvaW50LnksIC0xKTtcbiAgICByZXR1cm4gaXNFbmRPZkxpbmU7XG4gIH1cbn07XG5cbkxpbmVzLnByb3RvdHlwZS5yZW1vdmVBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgYmVnaW4gPSB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pO1xuICB2YXIgZW5kID0gdGhpcy5nZXRQb2ludChhcmVhLmVuZCk7XG5cbiAgdmFyIHggPSAwO1xuXG4gIHZhciBkaXN0ID0gZW5kLnkgLSBiZWdpbi55O1xuICB2YXIgc2FtZUxpbmUgPSBiZWdpbi55ID09PSBlbmQueTtcbiAgaWYgKHNhbWVMaW5lKSB4ID0gZW5kLnggLSBiZWdpbi54O1xuICBlbHNlIHtcbiAgICB0aGlzLmluZGV4LnNwbGljZShiZWdpbi55LCBkaXN0KTtcbiAgfVxuXG4gIGlmICghc2FtZUxpbmUpIHtcbiAgICBpZiAoYXJlYS5iZWdpbi55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKDAsIC14KTtcbiAgICB9XG4gICAgaWYgKGFyZWEuZW5kLnkgPT09IHRoaXMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRhaWwgPSB0aGlzLnRhaWwuc2xpY2UoZW5kLngpO1xuICAgICAgdGhpcy50YWlsICs9IG5ldyBBcnJheShiZWdpbi54ICsgMSkuam9pbignKicpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoYXJlYS5iZWdpbi55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKDAsIGJlZ2luLngpICsgdGhpcy50YWlsLnNsaWNlKGVuZC54KTtcbiAgICB9XG4gIH1cblxuICB0aGlzLnNoaWZ0KGFyZWEuYmVnaW4ueSwgLShlbmQub2Zmc2V0IC0gYmVnaW4ub2Zmc2V0KSk7XG5cbiAgdmFyIGRpZmYgPSB0aGlzLmxlbmd0aCAtIHRoaXMuaW5kZXgubGVuZ3RoO1xuXG4gIHRoaXMubGVuZ3RoID0gdGhpcy5pbmRleC5sZW5ndGg7XG5cbiAgcmV0dXJuIGRpZmY7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuc2hpZnQgPSBmdW5jdGlvbih5LCBkaWZmKSB7XG4gIGZvciAodmFyIGkgPSB5OyBpIDwgdGhpcy5pbmRleC5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMuaW5kZXhbaV0gKz0gZGlmZjtcbiAgfVxufTtcblxuTGluZXMucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxpbmVzID0gbmV3IExpbmVzO1xuICBsaW5lcy5pbmRleCA9IHRoaXMuaW5kZXguc2xpY2UoKTtcbiAgbGluZXMudGFpbCA9IHRoaXMudGFpbDtcbiAgbGluZXMubGVuZ3RoID0gdGhpcy5sZW5ndGg7XG4gIHJldHVybiBsaW5lcztcbn07XG5cbkxpbmVzLmNvdW50ID0gZnVuY3Rpb24odGV4dCkge1xuICByZXR1cm4gdGhpcy50ZXh0Lm1hdGNoKE4pLmxlbmd0aDtcbn07XG5cbmZ1bmN0aW9uIGFkZChiKSB7XG4gIHJldHVybiBmdW5jdGlvbihhKSB7XG4gICAgcmV0dXJuIGEgKyBiO1xuICB9O1xufVxuIiwiLy8gdmFyIFdPUkQgPSAvXFx3Ky9nO1xudmFyIFdPUkQgPSAvW2EtekEtWjAtOV17MSx9L2dcbnZhciByYW5rID0gMDtcblxubW9kdWxlLmV4cG9ydHMgPSBQcmVmaXhUcmVlTm9kZTtcblxuZnVuY3Rpb24gUHJlZml4VHJlZU5vZGUoKSB7XG4gIHRoaXMudmFsdWUgPSAnJztcbiAgdGhpcy5yYW5rID0gMDtcbiAgdGhpcy5jaGlsZHJlbiA9IHt9O1xufVxuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZ2V0Q2hpbGRyZW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNoaWxkcmVuID0gT2JqZWN0XG4gICAgLmtleXModGhpcy5jaGlsZHJlbilcbiAgICAubWFwKChrZXkpID0+IHRoaXMuY2hpbGRyZW5ba2V5XSk7XG5cbiAgcmV0dXJuIGNoaWxkcmVuLnJlZHVjZSgocCwgbikgPT4gcC5jb25jYXQobi5nZXRDaGlsZHJlbigpKSwgY2hpbGRyZW4pO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmNvbGxlY3QgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIGNvbGxlY3Rpb24gPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmZpbmQoa2V5KTtcbiAgaWYgKG5vZGUpIHtcbiAgICBjb2xsZWN0aW9uID0gbm9kZVxuICAgICAgLmdldENoaWxkcmVuKClcbiAgICAgIC5maWx0ZXIoKG5vZGUpID0+IG5vZGUudmFsdWUpXG4gICAgICAuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICB2YXIgcmVzID0gYi5yYW5rIC0gYS5yYW5rO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBiLnZhbHVlLmxlbmd0aCAtIGEudmFsdWUubGVuZ3RoO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBhLnZhbHVlID4gYi52YWx1ZTtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pO1xuXG4gICAgaWYgKG5vZGUudmFsdWUpIGNvbGxlY3Rpb24ucHVzaChub2RlKTtcbiAgfVxuICByZXR1cm4gY29sbGVjdGlvbjtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgZm9yICh2YXIgY2hhciBpbiBrZXkpIHtcbiAgICBpZiAoa2V5W2NoYXJdIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW2tleVtjaGFyXV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5vZGU7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICB2YXIgaSA9IDA7XG4gIHZhciBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgaWYgKHNbaV0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bc1tpXV07XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIG5vZGUgPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gfHwgbmV3IFByZWZpeFRyZWVOb2RlO1xuICAgIGkrKztcbiAgfVxuXG4gIG5vZGUudmFsdWUgPSBzO1xuICBub2RlLnJhbmsrKztcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmQ7XG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgdGhpcy5pbnNlcnQod29yZFswXSk7XG4gIH1cbn07XG4iLCJcbnZhciBCZWdpbiA9IC9bXFwvJ1wiYF0vZztcblxudmFyIE1hdGNoID0ge1xuICAnc2luZ2xlIGNvbW1lbnQnOiBbJy8vJywnXFxuJ10sXG4gICdkb3VibGUgY29tbWVudCc6IFsnLyonLCcqLyddLFxuICAndGVtcGxhdGUgc3RyaW5nJzogWydgJywnYCddLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFtcIidcIixcIidcIl0sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogWydcIicsJ1wiJ10sXG4gICdyZWdleHAnOiBbJy8nLCcvJ10sXG59O1xuXG52YXIgU2tpcCA9IHtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ3NpbmdsZSBjb21tZW50JzogZmFsc2UsXG4gICdkb3VibGUgY29tbWVudCc6IGZhbHNlLFxuICAncmVnZXhwJzogXCJcXFxcXCIsXG59O1xuXG52YXIgVG9rZW4gPSB7fTtcbmZvciAodmFyIGtleSBpbiBNYXRjaCkge1xuICB2YXIgTSA9IE1hdGNoW2tleV07XG4gIFRva2VuW01bMF1dID0ga2V5O1xufVxuXG52YXIgVE9LRU4gPSAvKFxcL1xcKil8KFxcKlxcLyl8KGApL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudHM7XG5cbmZ1bmN0aW9uIFNlZ21lbnRzKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbiAgdGhpcy5zZWdtZW50cyA9IFtdO1xuICB0aGlzLmNsZWFyQ2FjaGUoKTtcbn1cblxudmFyIExlbmd0aCA9IHtcbiAgJ29wZW4gY29tbWVudCc6IDIsXG4gICdjbG9zZSBjb21tZW50JzogMixcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IDEsXG59O1xuXG52YXIgTm90T3BlbiA9IHtcbiAgJ2Nsb3NlIGNvbW1lbnQnOiB0cnVlXG59O1xuXG52YXIgQ2xvc2VzID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVGFnID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2NvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3N0cmluZycsXG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSBpbiB0aGlzLmNhY2hlLnN0YXRlKSByZXR1cm4gdGhpcy5jYWNoZS5zdGF0ZVt5XTtcblxuICB2YXIgb3BlbiA9IGZhbHNlO1xuICB2YXIgc3RhdGUgPSBudWxsO1xuICB2YXIgd2FpdEZvciA9ICcnO1xuICB2YXIgcG9pbnQgPSB7IHg6LTEsIHk6LTEgfTtcbiAgdmFyIGNsb3NlID0gMDtcbiAgdmFyIHNlZ21lbnQ7XG4gIHZhciByYW5nZTtcbiAgdmFyIHRleHQ7XG4gIHZhciB2YWxpZDtcbiAgdmFyIGxhc3Q7XG5cbiAgdmFyIGkgPSAwO1xuXG4gIC8vVE9ETzogb3B0aW1pemF0aW9uOlxuICAvLyBjYWNoZSBzZWdtZW50IHkgd2l0aCBvcGVuL2Nsb3NlL3N0YXRlIHNvIHdlIHNraXBcbiAgLy8gaXRlcmF0aW5nIGZyb20gdGhlIGJlZ2luIGV2ZXJ5IHRpbWVcblxuICBmb3IgKDsgaSA8IHRoaXMuc2VnbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBzZWdtZW50ID0gdGhpcy5zZWdtZW50c1tpXTtcblxuICAgIGlmIChvcGVuKSB7XG4gICAgICBpZiAod2FpdEZvciA9PT0gc2VnbWVudC50eXBlKSB7XG4gICAgICAgIHBvaW50ID0gdGhpcy5nZXRQb2ludE9mZnNldChzZWdtZW50Lm9mZnNldCk7XG4gICAgICAgIGlmICghcG9pbnQpIHJldHVybiAodGhpcy5jYWNoZS5zdGF0ZVt5XSA9IG51bGwpO1xuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdjbG9zZScsIHNlZ21lbnQudHlwZSwgc2VnbWVudC5vZmZzZXQsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW3NlZ21lbnQub2Zmc2V0LCBzZWdtZW50Lm9mZnNldCArIDEwXSkpXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0UG9pbnRPZmZzZXQoc2VnbWVudC5vZmZzZXQpO1xuICAgICAgaWYgKCFwb2ludCkgcmV0dXJuICh0aGlzLmNhY2hlLnN0YXRlW3ldID0gbnVsbCk7XG5cbiAgICAgIHJhbmdlID0gcG9pbnQubGluZS5yYW5nZTtcblxuICAgICAgaWYgKGxhc3QgJiYgbGFzdC5wb2ludC55ID09PSBwb2ludC55KSB7XG4gICAgICAgIGNsb3NlID0gbGFzdC5wb2ludC54ICsgTGVuZ3RoW2xhc3QudHlwZV07XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdsYXN0IG9uZSB3YXMnLCBsYXN0LnR5cGUsIGxhc3QucG9pbnQueCwgdGhpcy5idWZmZXIudGV4dC5nZXRSYW5nZShbbGFzdC5vZmZzZXQsIGxhc3Qub2Zmc2V0ICsgMTBdKSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNsb3NlID0gMDtcbiAgICAgIH1cbiAgICAgIHZhbGlkID0gdGhpcy5pc1ZhbGlkUmFuZ2UoW3JhbmdlWzBdLCByYW5nZVsxXSsxXSwgc2VnbWVudCwgY2xvc2UpO1xuXG4gICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgaWYgKE5vdE9wZW5bc2VnbWVudC50eXBlXSkgY29udGludWU7XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdvcGVuJywgc2VnbWVudC50eXBlLCBzZWdtZW50Lm9mZnNldCwgdGhpcy5idWZmZXIudGV4dC5nZXRSYW5nZShbc2VnbWVudC5vZmZzZXQsIHNlZ21lbnQub2Zmc2V0ICsgMTBdKSlcbiAgICAgICAgb3BlbiA9IHRydWU7XG4gICAgICAgIHN0YXRlID0gc2VnbWVudDtcbiAgICAgICAgc3RhdGUucG9pbnQgPSBwb2ludDtcbiAgICAgICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gIH1cbiAgaWYgKHN0YXRlICYmIHN0YXRlLnBvaW50LnkgPCB5KSByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBudWxsKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRQb2ludE9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0IGluIHRoaXMuY2FjaGUub2Zmc2V0KSByZXR1cm4gdGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XVxuICByZXR1cm4gKHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF0gPSB0aGlzLmJ1ZmZlci5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KSk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIHNlZ21lbnQsIGNsb3NlKSB7XG4gIHZhciBrZXkgPSByYW5nZS5qb2luKCk7XG4gIGlmIChrZXkgaW4gdGhpcy5jYWNoZS5yYW5nZSkgcmV0dXJuIHRoaXMuY2FjaGUucmFuZ2Vba2V5XTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci50ZXh0LmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIHZhbGlkID0gdGhpcy5pc1ZhbGlkKHRleHQsIHNlZ21lbnQub2Zmc2V0IC0gcmFuZ2VbMF0sIGNsb3NlKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnJhbmdlW2tleV0gPSB2YWxpZCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCwgbGFzdEluZGV4KSB7XG4gIEJlZ2luLmxhc3RJbmRleCA9IGxhc3RJbmRleDtcbiAgdmFyIG1hdGNoID0gQmVnaW4uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuXG4gIGkgPSBtYXRjaC5pbmRleDtcblxuICBsYXN0ID0gaTtcblxuICB2YXIgdmFsaWQgPSB0cnVlO1xuXG4gIG91dGVyOlxuICBmb3IgKDsgaSA8IHRleHQubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgb25lID0gdGV4dFtpXTtcbiAgICB2YXIgbmV4dCA9IHRleHRbaSArIDFdO1xuICAgIHZhciB0d28gPSBvbmUgKyBuZXh0O1xuICAgIGlmIChpID09PSBvZmZzZXQpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIG8gPSBUb2tlblt0d29dO1xuICAgIGlmICghbykgbyA9IFRva2VuW29uZV07XG4gICAgaWYgKCFvKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICB2YXIgd2FpdEZvciA9IE1hdGNoW29dWzFdO1xuXG4gICAgLy8gY29uc29sZS5sb2coJ3N0YXJ0JywgaSwgbylcbiAgICBsYXN0ID0gaTtcblxuICAgIHN3aXRjaCAod2FpdEZvci5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSBvbmUpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAxO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG5cbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuICAgICAgICAgIHR3byA9IHRleHRbaV0gKyB0ZXh0W2kgKyAxXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSB0d28pIHtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAyO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0U2VnbWVudCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgYmVnaW4gPSAwO1xuICB2YXIgZW5kID0gdGhpcy5zZWdtZW50cy5sZW5ndGg7XG4gIGlmICghZW5kKSByZXR1cm47XG5cbiAgdmFyIHAgPSAtMTtcbiAgdmFyIGkgPSAtMTtcbiAgdmFyIGI7XG5cbiAgZG8ge1xuICAgIHAgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBiID0gdGhpcy5zZWdtZW50c1tpXTtcbiAgICBpZiAoYi5vZmZzZXQgPCBvZmZzZXQpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHAgIT09IGkpO1xuXG4gIHJldHVybiB7XG4gICAgc2VnbWVudDogYixcbiAgICBpbmRleDogaVxuICB9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLnNoaWZ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBzaGlmdCkge1xuICB2YXIgcyA9IHRoaXMuZ2V0U2VnbWVudChvZmZzZXQpO1xuICBpZiAoIXMpIHJldHVybjtcblxuICBmb3IgKHZhciBpID0gcy5pbmRleCArIDE7IGkgPCB0aGlzLnNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy5zZWdtZW50c1tpXS5vZmZzZXQgKz0gc2hpZnQ7XG4gIH1cblxuICAvLyBpZiAoc2hpZnQgPCAwKSB7XG4gICAgLy8gdGhpcy5jbGVhckNhY2hlKCk7XG4gIC8vIH1cbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5jbGVhckNhY2hlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2FjaGUgPSB7XG4gICAgb2Zmc2V0OiB7fSxcbiAgICByYW5nZToge30sXG4gICAgc3RhdGU6IHt9XG4gIH07XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHZhciBtYXRjaDtcblxuICB2YXIgc2VnbWVudHMgPSB0aGlzLnNlZ21lbnRzID0gW107XG5cbiAgdGhpcy5jbGVhckNhY2hlKCk7XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGlmIChtYXRjaFsnMyddKSBzZWdtZW50cy5wdXNoKG5ldyBTZWdtZW50KCd0ZW1wbGF0ZSBzdHJpbmcnLCBtYXRjaC5pbmRleCkpO1xuICAgIGVsc2UgaWYgKG1hdGNoWycxJ10pIHNlZ21lbnRzLnB1c2gobmV3IFNlZ21lbnQoJ29wZW4gY29tbWVudCcsIG1hdGNoLmluZGV4KSk7XG4gICAgZWxzZSBpZiAobWF0Y2hbJzInXSkgc2VnbWVudHMucHVzaChuZXcgU2VnbWVudCgnY2xvc2UgY29tbWVudCcsIG1hdGNoLmluZGV4KSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNlZ21lbnQodHlwZSwgb2Zmc2V0KSB7XG4gIHRoaXMudHlwZSA9IHR5cGU7XG4gIHRoaXMub2Zmc2V0ID0gb2Zmc2V0O1xufVxuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbmxvZyA9IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplO1xufVxuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkLndpZHRoW3RoaXMubGV2ZWxzIC0gMV07XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICAvLyBncmVhdCBoYWNrIHRvIGRvIG9mZnNldCA+PSBmb3IgLnNlYXJjaCgpXG4gIC8vIHdlIGRvbid0IGhhdmUgZnJhY3Rpb25zIGFueXdheSBzby4uXG4gIHJldHVybiB0aGlzLnNlYXJjaChvZmZzZXQsIHRydWUpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmluc2VydENodW5rZWQoMCwgdGV4dCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbihvZmZzZXQsIGluY2wpIHtcbiAgaW5jbCA9IGluY2wgPyAuMSA6IDA7XG5cbiAgLy8gcHJlcGFyZSB0byBob2xkIHN0ZXBzXG4gIHZhciBzdGVwcyA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG4gIHZhciB3aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG5cbiAgLy8gaXRlcmF0ZSBsZXZlbHMgZG93biwgc2tpcHBpbmcgdG9wXG4gIHZhciBpID0gdGhpcy5sZXZlbHM7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICB3aGlsZSAob2Zmc2V0ICsgaW5jbCA+IG5vZGUud2lkdGhbaV0gJiYgbnVsbCAhPSBub2RlLm5leHRbaV0pIHtcbiAgICAgIG9mZnNldCAtPSBub2RlLndpZHRoW2ldO1xuICAgICAgbm9kZSA9IG5vZGUubmV4dFtpXTtcbiAgICB9XG4gICAgc3RlcHNbaV0gPSBub2RlO1xuICAgIHdpZHRoW2ldID0gb2Zmc2V0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBub2RlOiBub2RlLFxuICAgIHN0ZXBzOiBzdGVwcyxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgb2Zmc2V0OiBvZmZzZXRcbiAgfTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNwbGljZSA9IGZ1bmN0aW9uKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7IC8vIHNraXAgc3RlcHMgbGVmdCBvZiB0aGUgb2Zmc2V0XG4gIHZhciB3aWR0aCA9IHMud2lkdGg7XG5cbiAgdmFyIHA7IC8vIGxlZnQgbm9kZSBvciBgcGBcbiAgdmFyIHE7IC8vIHJpZ2h0IG5vZGUgb3IgYHFgIChvdXIgbmV3IG5vZGUpXG4gIHZhciBsZW47XG5cbiAgLy8gY3JlYXRlIG5ldyBub2RlXG4gIGxldmVsID0gbGV2ZWwgfHwgdGhpcy5yYW5kb21MZXZlbCgpO1xuICBxID0gbmV3IE5vZGUodmFsdWUsIGxldmVsKTtcbiAgbGVuZ3RoID0gcS53aWR0aFswXTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBpdGVyYXRlIHN0ZXBzIGxldmVscyBiZWxvdyBuZXcgbm9kZSBsZXZlbFxuICBpID0gbGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbCBzdGVwXG4gICAgcS5uZXh0W2ldID0gcC5uZXh0W2ldOyAvLyBpbnNlcnQgc28gaW5oZXJpdCBsZWZ0J3MgbmV4dFxuICAgIHAubmV4dFtpXSA9IHE7IC8vIGxlZnQncyBuZXh0IGlzIG5vdyBvdXIgbmV3IG5vZGVcbiAgICBxLndpZHRoW2ldID0gcC53aWR0aFtpXSAtIHdpZHRoW2ldICsgbGVuZ3RoO1xuICAgIHAud2lkdGhbaV0gPSB3aWR0aFtpXTtcbiAgfVxuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgYWxsIGxldmVscyBkb3duIHVudGlsIGV4Y2VwdCBuZXcgbm9kZSBsZXZlbFxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBsZXZlbCkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsXG4gICAgcC53aWR0aFtpXSArPSBsZW5ndGg7IC8vIGFkZCBuZXcgbm9kZSB3aWR0aFxuICB9XG5cbiAgLy8gcmV0dXJuIG5ldyBub2RlXG4gIHJldHVybiBxO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChvZmZzZXQpO1xuXG4gIC8vIGlmIHNlYXJjaCBmYWxscyBpbiB0aGUgbWlkZGxlIG9mIGEgc3RyaW5nXG4gIC8vIGluc2VydCBpdCB0aGVyZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIGEgbmV3IG5vZGVcbiAgaWYgKHMub2Zmc2V0ICYmIHMubm9kZS52YWx1ZSAmJiBzLm9mZnNldCA8IHMubm9kZS52YWx1ZS5sZW5ndGgpIHtcbiAgICB0aGlzLnVwZGF0ZShzLCBpbnNlcnQocy5vZmZzZXQsIHMubm9kZS52YWx1ZSwgdmFsdWUpKTtcbiAgICByZXR1cm4gcy5ub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuc3BsaWNlKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIC8vIHZhbHVlcyBsZW5ndGggZGlmZmVyZW5jZVxuICB2YXIgbGVuZ3RoID0gcy5ub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICAvLyB1cGRhdGUgdmFsdWVcbiAgcy5ub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gZml4IHdpZHRocyBvbiBhbGwgbGV2ZWxzXG4gIGkgPSB0aGlzLmxldmVscztcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgcy5zdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKHJhbmdlWzFdID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAncmFuZ2UgZW5kIG92ZXIgbWF4aW11bSBsZW5ndGgoJyArXG4gICAgICB0aGlzLmxlbmd0aCArICcpOiBbJyArIHJhbmdlLmpvaW4oKSArICddJ1xuICAgICk7XG4gIH1cblxuICAvLyByZW1haW4gZGlzdGFuY2UgdG8gcmVtb3ZlXG4gIHZhciB4ID0gcmFuZ2VbMV0gLSByYW5nZVswXTtcblxuICAvLyBzZWFyY2ggZm9yIG5vZGUgb24gbGVmdCBlZGdlXG4gIHZhciBzID0gdGhpcy5zZWFyY2gocmFuZ2VbMF0pO1xuICB2YXIgb2Zmc2V0ID0gcy5vZmZzZXQ7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7XG4gIHZhciBub2RlID0gcy5ub2RlO1xuXG4gIC8vIHNraXAgaGVhZFxuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gIC8vIHNsaWNlIGxlZnQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKG9mZnNldCkge1xuICAgIGlmIChvZmZzZXQgPCBub2RlLndpZHRoWzBdKSB7XG4gICAgICB4IC09IHRoaXMudXBkYXRlKHMsXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoMCwgb2Zmc2V0KSArXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoXG4gICAgICAgICAgb2Zmc2V0ICtcbiAgICAgICAgICBNYXRoLm1pbih4LCBub2RlLmxlbmd0aCAtIG9mZnNldClcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gICAgaWYgKCFub2RlKSByZXR1cm47XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGZ1bGwgbm9kZXMgaW4gcmFuZ2VcbiAgd2hpbGUgKG5vZGUgJiYgeCA+PSBub2RlLndpZHRoWzBdKSB7XG4gICAgeCAtPSB0aGlzLnJlbW92ZU5vZGUoc3RlcHMsIG5vZGUpO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cblxuICAvLyBzbGljZSByaWdodCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAoeCkge1xuICAgIHRoaXMucmVwbGFjZShzdGVwcywgbm9kZSwgbm9kZS52YWx1ZS5zbGljZSh4KSk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZU5vZGUgPSBmdW5jdGlvbihzdGVwcywgbm9kZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS53aWR0aFswXTtcblxuICB2YXIgaTtcblxuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aCAtIG5vZGUud2lkdGhbaV07XG4gICAgc3RlcHNbaV0ubmV4dFtpXSA9IG5vZGUubmV4dFtpXTtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlLCB2YWx1ZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgbm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIHZhciBpO1xuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIG5vZGUud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlKFtvZmZzZXQsIG9mZnNldCsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnRDaHVua2VkID0gZnVuY3Rpb24ob2Zmc2V0LCB0ZXh0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gdGhpcy5jaHVua1NpemUpIHtcbiAgICB2YXIgY2h1bmsgPSB0ZXh0LnN1YnN0cihpLCB0aGlzLmNodW5rU2l6ZSk7XG4gICAgdGhpcy5pbnNlcnQoaSArIG9mZnNldCwgY2h1bmspO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zdWJzdHJpbmcgPSBmdW5jdGlvbihhLCBiKSB7XG4gIGEgPSBhIHx8IDA7XG4gIGIgPSBiIHx8IHRoaXMubGVuZ3RoO1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIFIgPSBSZWdleHAuY3JlYXRlO1xuXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcbnZhciBzeW50YXggPSBtYXAoe1xuICAnb3BlcmF0b3InOiBSKFsnb3BlcmF0b3InXSwgJ2cnLCBlbnRpdGllcyksXG4gICdwYXJhbXMnOiAgIFIoWydwYXJhbXMnXSwgICAnZycpLFxuICAnZGVjbGFyZSc6ICBSKFsnZGVjbGFyZSddLCAgJ2cnKSxcbiAgJ2Z1bmN0aW9uJzogUihbJ2Z1bmN0aW9uJ10sICdnJyksXG4gICdrZXl3b3JkJzogIFIoWydrZXl3b3JkJ10sICAnZycpLFxuICAnYnVpbHRpbic6ICBSKFsnYnVpbHRpbiddLCAgJ2cnKSxcbiAgJ3N5bWJvbCc6ICAgUihbJ3N5bWJvbCddLCAgICdnJyksXG4gICdzdHJpbmcnOiAgIFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ251bWJlcic6ICAgUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0ge1xuICByZWdleHA6IFIoWydpbmRlbnQnXSwgJ2dtJyksXG4gIHJlcGxhY2VyOiAocykgPT4gcy5yZXBsYWNlKC8gezEsMn18XFx0L2csICc8aW5kZW50PiQmPC9pbmRlbnQ+Jylcbn07XG5cbnZhciBCbG9ja3MgPSBSKFsnY29tbWVudCcsJ3N0cmluZycsJ3JlZ2V4cCddLCAnZ20nKTtcblxudmFyIFRhZyA9IHtcbiAgJy8vJzogJ2NvbW1lbnQnLFxuICAnLyonOiAnY29tbWVudCcsXG4gICdgJzogJ3N0cmluZycsXG4gICdcIic6ICdzdHJpbmcnLFxuICBcIidcIjogJ3N0cmluZycsXG4gICcvJzogJ3JlZ2V4cCcsXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN5bnRheDtcblxuZnVuY3Rpb24gU3ludGF4KG8pIHtcbiAgbyA9IG8gfHwge307XG4gIHRoaXMudGFiID0gby50YWIgfHwgJ1xcdCc7XG4gIHRoaXMubWF4TGluZSA9IG8ubWF4TGluZSB8fCAzMDA7XG4gIHRoaXMuYmxvY2tzID0gW107XG59XG5cblN5bnRheC5wcm90b3R5cGUuZW50aXRpZXMgPSBlbnRpdGllcztcblxuU3ludGF4LnByb3RvdHlwZS5oaWdobGlnaHQgPSBmdW5jdGlvbihjb2RlLCBvZmZzZXQpIHtcbiAgLy8gY29uc29sZS5sb2coMCwgJ2hpZ2hsaWdodCcsIGNvZGUpXG5cbiAgY29kZSA9IHRoaXMuY3JlYXRlSW5kZW50cyhjb2RlKTtcbiAgY29kZSA9IHRoaXMuY3JlYXRlQmxvY2tzKGNvZGUpO1xuICBjb2RlID0gZW50aXRpZXMoY29kZSk7XG5cbiAgZm9yICh2YXIga2V5IGluIHN5bnRheCkge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2Uoc3ludGF4W2tleV0ucmVnZXhwLCBzeW50YXhba2V5XS5yZXBsYWNlcik7XG4gIH1cblxuICBjb2RlID0gdGhpcy5yZXN0b3JlQmxvY2tzKGNvZGUpO1xuXG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoSW5kZW50LnJlZ2V4cCwgSW5kZW50LnJlcGxhY2VyKTtcblxuICAvLyBjb2RlID0gY29kZS5yZXBsYWNlKC9cXHVlZWVlL2csIGZ1bmN0aW9uKCkge1xuICAvLyAgIHJldHVybiBsb25nLnNoaWZ0KCkuc2xpY2UoMCwgdGhpcy5tYXhMaW5lKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknO1xuICAvLyB9KTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlSW5kZW50cyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGxpbmVzID0gY29kZS5zcGxpdCgvXFxuL2cpO1xuICBpZiAobGluZXMubGVuZ3RoIDw9IDIpIHJldHVybiBjb2RlO1xuXG4gIHZhciBsaW5lO1xuICB2YXIgbG9uZyA9IFtdO1xuICB2YXIgbWF0Y2g7XG4gIHZhciBmaXJzdEluZGVudCA9IDA7XG4gIHZhciBpID0gMDtcblxuICAvLyBmb3IgKDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gIC8vICAgbGluZSA9IGxpbmVzW2ldO1xuICAvLyAgIGlmIChsaW5lLmxlbmd0aCA+IHRoaXMubWF4TGluZSkge1xuICAvLyAgICAgbG9uZy5wdXNoKGxpbmVzLnNwbGljZShpLS0sIDEsICdcXHVlZWVlJykpO1xuICAvLyAgIH1cbiAgLy8gfVxuXG4gIGkgPSAwO1xuICBsaW5lID0gbGluZXNbaV07XG4gIC8vIGNvbnNvbGUubG9nKGxpbmUpXG4gIHdoaWxlICghKG1hdGNoID0gL1xcUy9nLmV4ZWMobGluZSkpKSB7XG4gICAgbGluZSA9IGxpbmVzWysraV07XG4gICAgLy8gY29uc29sZS5sb2cobGluZSlcbiAgfVxuICBmb3IgKHZhciBqID0gMDsgaiA8IGk7IGorKykge1xuICAgIGxpbmVzW2pdID0gbmV3IEFycmF5KG1hdGNoLmluZGV4ICsgMSkuam9pbih0aGlzLnRhYik7XG4gIH1cbiAgdmFyIHByZXY7XG4gIGZvciAoOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgcHJldiA9IGxpbmVzW2ktMV07XG4gICAgaWYgKCFsaW5lLmxlbmd0aFxuICAgICAgJiYgcHJldi5sZW5ndGhcbiAgICAgICYmIHByZXZbMF0gPT09IHRoaXMudGFiXG4gICAgICAmJiAhflsnLycsJzsnXS5pbmRleE9mKHByZXZbcHJldi5sZW5ndGgtMV0pKSBsaW5lc1tpXSA9IHRoaXMudGFiO1xuICB9XG5cbiAgY29kZSA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5yZXN0b3JlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgYmxvY2s7XG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcbiAgdmFyIG4gPSAwO1xuICByZXR1cm4gY29kZS5yZXBsYWNlKC9cXHVmZmViL2csIGZ1bmN0aW9uKCkge1xuICAgIGJsb2NrID0gYmxvY2tzW24rK11cbiAgICB2YXIgdGFnID0gaWRlbnRpZnkoYmxvY2spO1xuICAgIHJldHVybiAnPCcrdGFnKyc+JytlbnRpdGllcyhibG9jaykrJzwvJyt0YWcrJz4nO1xuICB9KTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xuICB0aGlzLmJsb2NrcyA9IFtdO1xuICBjb2RlID0gY29kZS5yZXBsYWNlKEJsb2NrcywgKGJsb2NrKSA9PiB7XG4gICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XG4gICAgcmV0dXJuICdcXHVmZmViJztcbiAgfSk7XG4gIHJldHVybiBjb2RlO1xufTtcblxuZnVuY3Rpb24gY3JlYXRlSWQoKSB7XG4gIHZhciBhbHBoYWJldCA9ICdhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eic7XG4gIHZhciBsZW5ndGggPSBhbHBoYWJldC5sZW5ndGggLSAxO1xuICB2YXIgaSA9IDY7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBzICs9IGFscGhhYmV0W01hdGgucmFuZG9tKCkgKiBsZW5ndGggfCAwXTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuZnVuY3Rpb24gZW50aXRpZXModGV4dCkge1xuICByZXR1cm4gdGV4dFxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgLnJlcGxhY2UoLzwvZywgJyZsdDsnKVxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcbiAgICA7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGUocmVnZXhwLCB0YWcpIHtcbiAgdmFyIG9wZW5UYWcgPSAnPCcgKyB0YWcgKyAnPic7XG4gIHZhciBjbG9zZVRhZyA9ICc8LycgKyB0YWcgKyAnPic7XG4gIHJldHVybiB7XG4gICAgbmFtZTogdGFnLFxuICAgIHJlZ2V4cDogcmVnZXhwLFxuICAgIHJlcGxhY2VyOiBvcGVuVGFnICsgJyQmJyArIGNsb3NlVGFnXG4gIH07XG59XG5cbmZ1bmN0aW9uIG1hcChvYmosIGZuKSB7XG4gIHZhciByZXN1bHQgPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHJlc3VsdFtrZXldID0gZm4ob2JqW2tleV0sIGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZShwYXNzLCBjb2RlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcGFzcy5sZW5ndGg7IGkrKykge1xuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UocGFzc1tpXVswXSwgcGFzc1tpXVsxXSk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG5cbmZ1bmN0aW9uIGlkZW50aWZ5KGJsb2NrKSB7XG4gIHZhciBvbmUgPSBibG9ja1swXTtcbiAgdmFyIHR3byA9IG9uZSArIGJsb2NrWzFdO1xuICByZXR1cm4gVGFnW3R3b10gfHwgVGFnW29uZV07XG59XG4iLCJ2YXIgb3BlbiA9IHJlcXVpcmUoJy4uL2xpYi9vcGVuJyk7XG52YXIgc2F2ZSA9IHJlcXVpcmUoJy4uL2xpYi9zYXZlJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBCdWZmZXIgPSByZXF1aXJlKCcuL2J1ZmZlcicpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbGU7XG5cbmZ1bmN0aW9uIEZpbGUoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5yb290ID0gJyc7XG4gIHRoaXMucGF0aCA9ICd1bnRpdGxlZCc7XG4gIHRoaXMuYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuRmlsZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5GaWxlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5idWZmZXIub24oJ3JhdycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdyYXcnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdzZXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnc2V0JykpO1xuICB0aGlzLmJ1ZmZlci5vbigndXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZScpKTtcbiAgdGhpcy5idWZmZXIub24oJ2JlZm9yZSB1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmVmb3JlIGNoYW5nZScpKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCByb290LCBmbikge1xuICB0aGlzLnBhdGggPSBwYXRoO1xuICB0aGlzLnJvb3QgPSByb290O1xuICBvcGVuKHJvb3QgKyBwYXRoLCAoZXJyLCB0ZXh0KSA9PiB7XG4gICAgaWYgKGVycikge1xuICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICBmbiAmJiBmbihlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmJ1ZmZlci5zZXQodGV4dCk7XG4gICAgdGhpcy5lbWl0KCdvcGVuJyk7XG4gICAgZm4gJiYgZm4obnVsbCwgdGhpcyk7XG4gIH0pO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHNhdmUodGhpcy5yb290ICsgdGhpcy5wYXRoLCB0aGlzLmJ1ZmZlci5nZXQoKSwgZm4gfHwgbm9vcCk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuYnVmZmVyLnNldCh0ZXh0KTtcbiAgdGhpcy5lbWl0KCdzZXQnKTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uL2xpYi9ldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vbGliL2RlYm91bmNlJyk7XG5cbi8qXG4gICAuIC5cbi0xIDAgMSAyIDMgNCA1XG4gICBuXG5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEhpc3Rvcnk7XG5cbmZ1bmN0aW9uIEhpc3RvcnkoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLmxvZyA9IFtdO1xuICB0aGlzLm5lZWRsZSA9IDA7XG4gIHRoaXMudGltZW91dCA9IHRydWU7XG4gIHRoaXMudGltZVN0YXJ0ID0gMDtcbn1cblxuSGlzdG9yeS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oKSB7XG4gIGlmIChEYXRlLm5vdygpIC0gdGhpcy50aW1lU3RhcnQgPiAyMDAwKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuICB0aGlzLnRpbWVvdXQgPSB0aGlzLmRlYm91bmNlZFNhdmUoKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmRlYm91bmNlZFNhdmUgPSBkZWJvdW5jZShmdW5jdGlvbigpIHtcbiAgdGhpcy5hY3R1YWxseVNhdmUoKTtcbn0sIDcwMCk7XG5cbkhpc3RvcnkucHJvdG90eXBlLmFjdHVhbGx5U2F2ZSA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnc2F2ZScsIHRoaXMubmVlZGxlKVxuICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgdGhpcy5sb2cgPSB0aGlzLmxvZy5zbGljZSgwLCArK3RoaXMubmVlZGxlKTtcbiAgdGhpcy5sb2cucHVzaCh0aGlzLmNvbW1pdCgpKTtcbiAgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGg7XG4gIHRoaXMudGltZVN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgdGhpcy50aW1lb3V0ID0gZmFsc2U7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS51bmRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcblxuICB0aGlzLm5lZWRsZS0tO1xuXG4gIGlmICh0aGlzLm5lZWRsZSA8IDApIHRoaXMubmVlZGxlID0gMDtcbiAgLy8gY29uc29sZS5sb2coJ3VuZG8nLCB0aGlzLm5lZWRsZSwgdGhpcy5sb2cubGVuZ3RoIC0gMSlcblxuICB0aGlzLmNoZWNrb3V0KHRoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnJlZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgdGhpcy5uZWVkbGUrKztcbiAgLy8gY29uc29sZS5sb2coJ3JlZG8nLCB0aGlzLm5lZWRsZSwgdGhpcy5sb2cubGVuZ3RoIC0gMSlcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG5cbiAgdGhpcy5jaGVja291dCh0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jaGVja291dCA9IGZ1bmN0aW9uKG4pIHtcbiAgdmFyIGNvbW1pdCA9IHRoaXMubG9nW25dO1xuICBpZiAoIWNvbW1pdCkgcmV0dXJuO1xuICB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSA9IGNvbW1pdC5tYXJrQWN0aXZlO1xuICB0aGlzLmVkaXRvci5tYXJrLnNldChjb21taXQubWFyay5jb3B5KCkpO1xuICB0aGlzLmVkaXRvci5zZXRDYXJldChjb21taXQuY2FyZXQuY29weSgpKTtcbiAgdGhpcy5lZGl0b3IuYnVmZmVyLnRleHQgPSBjb21taXQudGV4dC5jb3B5KCk7XG4gIHRoaXMuZWRpdG9yLmJ1ZmZlci5saW5lcyA9IGNvbW1pdC5saW5lcy5jb3B5KCk7XG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5jb21taXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHtcbiAgICB0ZXh0OiB0aGlzLmVkaXRvci5idWZmZXIudGV4dC5jb3B5KCksXG4gICAgbGluZXM6IHRoaXMuZWRpdG9yLmJ1ZmZlci5saW5lcy5jb3B5KCksXG4gICAgY2FyZXQ6IHRoaXMuZWRpdG9yLmNhcmV0LmNvcHkoKSxcbiAgICBtYXJrOiB0aGlzLmVkaXRvci5tYXJrLmNvcHkoKSxcbiAgICBtYXJrQWN0aXZlOiB0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZVxuICB9O1xufTtcbiIsInZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi90aHJvdHRsZScpO1xuXG52YXIgUEFHSU5HX1RIUk9UVExFID0gNzA7XG5cbnZhciBrZXlzID0gbW9kdWxlLmV4cG9ydHMgPSB7XG4gICdjdHJsK3onOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmhpc3RvcnkudW5kbygpO1xuICB9LFxuICAnY3RybCt5JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnJlZG8oKTtcbiAgfSxcblxuICAnaG9tZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZSgpO1xuICB9LFxuICAnZW5kJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZSgpO1xuICB9LFxuICAncGFnZXVwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCgpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAncGFnZWRvd24nOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZURvd24oKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrdXAnOiB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUucGFnZVVwKDYpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnY3RybCtkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKDYpO1xuICB9LCBQQUdJTkdfVEhST1RUTEUpLFxuICAnbGVmdCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKC0xKTtcbiAgfSxcbiAgJ3VwJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEpO1xuICB9LFxuICAncmlnaHQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSk7XG4gIH0sXG4gICdkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEpO1xuICB9LFxuXG4gICdjdHJsK2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xKTtcbiAgfSxcbiAgJ2N0cmwrcmlnaHQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKCsxKTtcbiAgfSxcblxuICAnY3RybCthJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZGaWxlKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgfSxcblxuICAnY3RybCtzaGlmdCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCB7IGJlZ2luOiB0aGlzLmNhcmV0LnBvcywgZW5kOiB0aGlzLmNhcmV0LnBvcyB9KTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xLCB0cnVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCB0aGlzLm1hcmsuZ2V0KCkpO1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuICAnY3RybCtzaGlmdCtkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIHsgYmVnaW46IHRoaXMuY2FyZXQucG9zLCBlbmQ6IHRoaXMuY2FyZXQucG9zIH0pO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIHRoaXMubWFyay5nZXQoKSk7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKCsxKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ2VudGVyJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5pbnNlcnQoJ1xcbicpO1xuICB9LFxuXG4gICdiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5kZWxldGUoKTtcbiAgfSxcbiAgJ2N0cmwrYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoLTEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNFbmRPZkZpbGUoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ3NoaWZ0K2N0cmwrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubW92ZS5ieUNoYXJzKCsxLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuXG4gICdzaGlmdCtjdHJsK2QnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdmFyIGxpbmVzID0gYXJlYS5lbmQueSAtIGFyZWEuYmVnaW4ueTtcbiAgICBpZiAobGluZXMgJiYgYXJlYS5lbmQueCA+IDApIGFkZCArPSAxO1xuICAgIGlmICghbGluZXMpIGFkZCArPSAxO1xuICAgIGxpbmVzICs9IGFkZDtcbiAgICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYS5zZXRMZWZ0KDApLmFkZEJvdHRvbShhZGQpKTtcbiAgICB0aGlzLmJ1ZmZlci5pbnNlcnQoeyB4OiAwLCB5OiBhcmVhLmVuZC55IH0sIHRleHQpO1xuICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMobGluZXMpO1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKGxpbmVzLCB0cnVlKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCt1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0JlZ2luKGZhbHNlKTtcbiAgICB2YXIgYXJlYSA9IHRoaXMubWFyay5nZXQoKTtcbiAgICBpZiAodGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKC0xLCBhcmVhKSkge1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygtMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdzaGlmdCtjdHJsK2Rvd24nOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygrMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoKzEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoKzEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAndGFiJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlcyA9IHRoaXMuc3VnZ2VzdCgpO1xuICAgIGlmICghcmVzKSB7XG4gICAgICB0aGlzLmluc2VydCh0aGlzLnRhYik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya1NldEFyZWEocmVzLmFyZWEpO1xuICAgICAgdGhpcy5pbnNlcnQocmVzLm5vZGUudmFsdWUpO1xuICAgIH1cbiAgfSxcblxuICAnY3RybCtmJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kLm9wZW4oKTtcbiAgfSxcblxuICAnZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKCsxKTtcbiAgfSxcbiAgJ3NoaWZ0K2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgtMSk7XG4gIH0sXG5cbiAgJ2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhZGQ7XG4gICAgdmFyIGFyZWE7XG4gICAgdmFyIHRleHQ7XG5cbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcblxuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgY2xlYXIgPSB0cnVlO1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0aGlzLm1hcmsuYWRkQm90dG9tKGFyZWEuZW5kLnggPiAwKS5zZXRMZWZ0KDApO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEodGhpcy5tYXJrLmdldCgpKTtcbiAgICB9XG5cbiAgICAvL1RPRE86IHNob3VsZCBjaGVjayBpZiBsYXN0IGxpbmUgaGFzIC8vIGFsc29cbiAgICBpZiAodGV4dC50cmltTGVmdCgpLnN1YnN0cigwLDIpID09PSAnLy8nKSB7XG4gICAgICBhZGQgPSAtMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLio/KVxcL1xcLyAoLispL2dtLCAnJDEkMicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGQgPSArMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oW1xcc10qKSguKykvZ20sICckMS8vICQyJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG5cbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEuYWRkUmlnaHQoYWRkKSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcblxuICAgIGlmIChjYXJldC54KSBjYXJldC5hZGRSaWdodChhZGQpO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQpO1xuXG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSBjbGVhciA9IHRydWU7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICBpZiAodGV4dC5zbGljZSgwLDIpID09PSAnLyonICYmIHRleHQuc2xpY2UoLTIpID09PSAnKi8nKSB7XG4gICAgICB0ZXh0ID0gdGV4dC5zbGljZSgyLC0yKTtcbiAgICAgIGFkZCAtPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkIC09IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRleHQgPSAnLyonICsgdGV4dCArICcqLyc7XG4gICAgICBhZGQgKz0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCArPSAyO1xuICAgIH1cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcbiAgICBhcmVhLmVuZC54ICs9IGFkZDtcbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldC5hZGRSaWdodChhZGQpKTtcbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxufTtcblxua2V5cy5zaW5nbGUgPSB7XG4gIC8vXG59O1xuXG4vLyBzZWxlY3Rpb24ga2V5c1xuWyAnaG9tZScsJ2VuZCcsXG4gICdwYWdldXAnLCdwYWdlZG93bicsXG4gICdsZWZ0JywndXAnLCdyaWdodCcsJ2Rvd24nLFxuICAnY3RybCtsZWZ0JywnY3RybCtyaWdodCdcbl0uZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAga2V5c1snc2hpZnQrJytrZXldID0gZnVuY3Rpb24oZSkge1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAga2V5c1trZXldLmNhbGwodGhpcywgZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH07XG59KTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLm1vdXNlID0gbmV3IE1vdXNlKHRoaXMpO1xuICB0aGlzLnRleHQgPSBuZXcgVGV4dDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSW5wdXQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSW5wdXQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJsdXIgPSB0aGlzLmJsdXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy50ZXh0Lm9uKFsna2V5JywgJ3RleHQnXSwgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2lucHV0JykpO1xuICB0aGlzLnRleHQub24oJ2ZvY3VzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJykpO1xuICB0aGlzLnRleHQub24oJ2JsdXInLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xuICB0aGlzLnRleHQucmVzZXQoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5ibHVyKCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmZvY3VzKCk7XG59O1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdXNlO1xuXG5mdW5jdGlvbiBNb3VzZSgpIHtcbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAgIC8vIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAvLyB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kb3duID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5kb3duID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkb3duJywgZSk7XG4gIHRoaXMub25jbGljayhlKTtcbiAgdGhpcy5tYXliZURyYWcoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbnVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3VwJywgZSk7XG4gIGlmICghdGhpcy5kb3duKSByZXR1cm47XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuZHJhZ0VuZCgpO1xuICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uY2xpY2sgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucmVzZXRDbGlja3MoKTtcbiAgdGhpcy5jbGlja3MgPSAodGhpcy5jbGlja3MgJSAzKSArIDE7XG4gIHRoaXMuZW1pdCgnY2xpY2snLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbm1heWJlZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG5cbiAgdmFyIGQgPVxuICAgICAgTWF0aC5hYnModGhpcy5wb2ludC54IC0gdGhpcy5kb3duLngpXG4gICAgKyBNYXRoLmFicyh0aGlzLnBvaW50LnkgLSB0aGlzLmRvd24ueSk7XG5cbiAgaWYgKGQgPiA1KSB7XG4gICAgdGhpcy5tYXliZURyYWdFbmQoKTtcbiAgICB0aGlzLmRyYWdCZWdpbigpO1xuICB9XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkcmFnJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgYmVnaW4nKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBlbmQnKTtcbn07XG5cblxuTW91c2UucHJvdG90eXBlLnJlc2V0Q2xpY2tzID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xpY2tzID0gMDtcbn0sIDM1MCk7XG5cbk1vdXNlLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xuXG52YXIgVEhST1RUTEUgPSAxMDAwLzc1O1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZSdcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufSwgMjAwMCk7XG5cblRleHQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5ibHVyKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmZvY3VzKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIC8vIGZvcmNlcyBjYXJldCB0byBlbmQgb2YgdGV4dGFyZWEgc28gd2UgY2FuIGdldCAuc2xpY2UoLTEpIGNoYXJcbiAgc2V0SW1tZWRpYXRlKCgpID0+IHRoaXMuZWwuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLmVsLnZhbHVlLmxlbmd0aCk7XG4gIHRoaXMuZW1pdCgndGV4dCcsIHRoaXMuZ2V0KCkpO1xuICB0aGlzLmNsZWFyKCk7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgLy8gY29uc29sZS5sb2coZS53aGljaCk7XG4gIHZhciBub3cgPSBEYXRlLm5vdygpO1xuICBpZiAobm93IC0gdGhpcy50aHJvdHRsZVRpbWUgPCBUSFJPVFRMRSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSBub3c7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0pO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXl1cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQgJiYgIWUuc2hpZnRLZXkpIGtleXMucHVzaCgnc2hpZnQ6dXAnKTtcbiAgaWYgKG0uY3RybCAmJiAhZS5jdHJsS2V5KSBrZXlzLnB1c2goJ2N0cmw6dXAnKTtcbiAgaWYgKG0uYWx0ICYmICFlLmFsdEtleSkga2V5cy5wdXNoKCdhbHQ6dXAnKTtcblxuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSArICc6dXAnKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9uY3V0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY3V0JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjb3B5JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbnBhc3RlID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgncGFzdGUnLCBlKTtcbn07XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi9saWIvcG9pbnQnKTtcblxudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3dvcmRzJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW92ZTtcblxuZnVuY3Rpb24gTW92ZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbn1cblxuTW92ZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlRG93biA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCBzaXplIC0gcmVtYWluZGVyKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcyhwYWdlKTtcbn07XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VVcCA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCAtKHNpemUgLSByZW1haW5kZXIpKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcygtcGFnZSk7XG59O1xuXG52YXIgbW92ZSA9IHt9O1xuXG5tb3ZlLmJ5V29yZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmUgPSBidWZmZXIuZ2V0TGluZShwLnkpO1xuXG4gIGlmIChkeCA+IDAgJiYgcC54ID49IGxpbmUubGVuZ3RoIC0gMSkgeyAvLyBhdCBlbmQgb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCArMSk7IC8vIG1vdmUgb25lIGNoYXIgcmlnaHRcbiAgfSBlbHNlIGlmIChkeCA8IDAgJiYgcC54ID09PSAwKSB7IC8vIGF0IGJlZ2luIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgLTEpOyAvLyBtb3ZlIG9uZSBjaGFyIGxlZnRcbiAgfVxuXG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZShsaW5lLCBXT1JEUyk7XG4gIHZhciB3b3JkO1xuXG4gIGlmIChkeCA8IDApIHdvcmRzLnJldmVyc2UoKTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmIChkeCA+IDBcbiAgICAgID8gd29yZC5pbmRleCA+IHAueFxuICAgICAgOiB3b3JkLmluZGV4IDwgcC54KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiB3b3JkLmluZGV4LFxuICAgICAgICB5OiBwLnlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVhY2hlZCBiZWdpbi9lbmQgb2YgZmlsZVxuICByZXR1cm4gZHggPiAwXG4gICAgPyBtb3ZlLmVuZE9mTGluZShidWZmZXIsIHApXG4gICAgOiBtb3ZlLmJlZ2luT2ZMaW5lKGJ1ZmZlciwgcCk7XG59O1xuXG5tb3ZlLmJ5Q2hhcnMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciBsaW5lcyA9IGJ1ZmZlci5saW5lcztcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeCA8IDApIHsgLy8gZ29pbmcgbGVmdFxuICAgIHggKz0gZHg7IC8vIG1vdmUgbGVmdFxuICAgIGlmICh4IDwgMCkgeyAvLyB3aGVuIHBhc3QgbGVmdCBlZGdlXG4gICAgICBpZiAoeSA+IDApIHsgLy8gYW5kIGxpbmVzIGFib3ZlXG4gICAgICAgIHkgLT0gMTsgLy8gbW92ZSB1cCBhIGxpbmVcbiAgICAgICAgeCA9IGxpbmVzLmdldExpbmVMZW5ndGgoeSk7IC8vIGFuZCBnbyB0byB0aGUgZW5kIG9mIGxpbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHggPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChkeCA+IDApIHsgLy8gZ29pbmcgcmlnaHRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIHJpZ2h0XG4gICAgd2hpbGUgKHggLSBsaW5lcy5nZXRMaW5lTGVuZ3RoKHkpID4gMCkgeyAvLyB3aGlsZSBwYXN0IGxpbmUgbGVuZ3RoXG4gICAgICBpZiAoeSA9PT0gbGluZXMubGVuZ3RoKSB7IC8vIG9uIGVuZCBvZiBmaWxlXG4gICAgICAgIHggPSBsaW5lcy5nZXRMaW5lTGVuZ3RoKHkpOyAvLyBnbyB0byBlbmQgb2YgbGluZSBvbiBsYXN0IGxpbmVcbiAgICAgICAgYnJlYWs7IC8vIGFuZCBleGl0XG4gICAgICB9XG4gICAgICB4IC09IGxpbmVzLmdldExpbmVMZW5ndGgoeSkgKyAxOyAvLyB3cmFwIHRoaXMgbGluZSBsZW5ndGhcbiAgICAgIHkgKz0gMTsgLy8gYW5kIG1vdmUgZG93biBhIGxpbmVcbiAgICB9XG4gIH1cblxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYnlMaW5lcyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHkpIHtcbiAgdmFyIGxpbmVzID0gYnVmZmVyLmxpbmVzO1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR5IDwgMCkgeyAvLyBnb2luZyB1cFxuICAgIGlmICh5ICsgZHkgPiAwKSB7IC8vIHdoZW4gbGluZXMgYWJvdmVcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgdXBcbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IDA7XG4gICAgfVxuICB9IGVsc2UgaWYgKGR5ID4gMCkgeyAvLyBnb2luZyBkb3duXG4gICAgaWYgKHkgPCBsaW5lcy5sZW5ndGggLSBkeSkgeyAvLyB3aGVuIGxpbmVzIGJlbG93XG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIGRvd25cbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IGxpbmVzLmxlbmd0aDtcbiAgICB9XG4gIH1cblxuICAvLyBpZiAoeCA+IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoKSB7XG4gIC8vICAgeCA9IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoO1xuICAvLyB9IGVsc2Uge1xuICAvLyB9XG4gIHggPSBNYXRoLm1pbih0aGlzLmxhc3REZWxpYmVyYXRlWCwgbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpO1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZMaW5lID0gZnVuY3Rpb24oXywgcCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZMaW5lID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciB4ID0gYnVmZmVyLmxpbmVzLmdldExpbmUocC55KS5sZW5ndGg7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gSW5maW5pdHk7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkZpbGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9O1xufTtcblxubW92ZS5lbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubGluZXMubGVuZ3RoO1xuICB2YXIgeCA9IGJ1ZmZlci5saW5lcy5nZXRMaW5lKGxhc3QpLmxlbmd0aFxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBsYXN0XG4gIH07XG59O1xuXG5tb3ZlLmlzQmVnaW5PZkZpbGUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHJldHVybiBwLnggPT09IDAgJiYgcC55ID09PSAwO1xufTtcblxubW92ZS5pc0VuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2M7XG4gIHJldHVybiBwLnkgPT09IGxhc3QgJiYgcC54ID09PSBidWZmZXIubGluZXMuZ2V0TGluZUxlbmd0aChsYXN0KTtcbn07XG5cbk9iamVjdC5rZXlzKG1vdmUpLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gIE1vdmUucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbihwYXJhbSwgYnlFZGl0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG1vdmVbbWV0aG9kXS5jYWxsKFxuICAgICAgdGhpcyxcbiAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlcixcbiAgICAgIHRoaXMuZWRpdG9yLmNhcmV0LFxuICAgICAgcGFyYW1cbiAgICApO1xuXG4gICAgaWYgKCdpcycgPT09IG1ldGhvZC5zbGljZSgwLDIpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgdGhpcy5lbWl0KCdtb3ZlJywgcmVzdWx0LCBieUVkaXQpO1xuICB9O1xufSk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImVkaXRvclwiOlwiX3NyY19zdHlsZV9fZWRpdG9yXCIsXCJsYXllclwiOlwiX3NyY19zdHlsZV9fbGF5ZXJcIixcInJvd3NcIjpcIl9zcmNfc3R5bGVfX3Jvd3NcIixcIm1hcmtcIjpcIl9zcmNfc3R5bGVfX21hcmtcIixcImNvZGVcIjpcIl9zcmNfc3R5bGVfX2NvZGVcIixcImNhcmV0XCI6XCJfc3JjX3N0eWxlX19jYXJldFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIGVyZ29ub206IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MUUxNicsXG4gICAgY29sb3I6ICcjRTlFM0QxJyxcbiAgICBrZXl3b3JkOiAnI0ExMzYzMCcsXG4gICAgZnVuY3Rpb246ICcjQjNERjAyJyxcbiAgICBkZWNsYXJlOiAnI0Y2MzgzMycsXG4gICAgbnVtYmVyOiAnI0ZGOUY0RScsXG4gICAgcGFyYW1zOiAnI0EwOTBBMCcsXG4gICAgcmVnZXhwOiAnI0JENzBGNCcsXG4gICAgY29tbWVudDogJyM2MzUwNDcnLFxuICAgIHN0cmluZzogJyMzRUExRkInLFxuICB9LFxuXG4gIGRheWxpZ2h0OiB7XG4gICAgYmFja2dyb3VuZDogJyNFQkVCRUInLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyNGRjFCMUInLFxuICAgIGZ1bmN0aW9uOiAnIzAwMDVGRicsXG4gICAgZGVjbGFyZTogJyMwQzdBMDAnLFxuICAgIG51bWJlcjogJyM4MDIxRDQnLFxuICAgIHBhcmFtczogJyM0QzY5NjknLFxuICAgIGNvbW1lbnQ6ICcjQUJBQkFCJyxcbiAgICBzdHJpbmc6ICcjRTY3MDAwJyxcbiAgfSxcbn07XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHNldFRoZW1lO1xuZXhwb3J0cy50aGVtZXMgPSB0aGVtZXM7XG5cbmZ1bmN0aW9uIHNldFRoZW1lKG5hbWUpIHtcbiAgdmFyIHQgPSB0aGVtZXNbbmFtZV07XG4gIGRvbS5jc3MoJ3RoZW1lJyxcbmBcbi4ke25hbWV9IHtcbiAgYmFja2dyb3VuZDogJHt0LmJhY2tncm91bmR9O1xufVxuXG5vcGVyYXRvcixcbmtleXdvcmQge1xuICBjb2xvcjogJHt0LmtleXdvcmR9O1xufVxuXG5kZWNsYXJlLFxuYnVpbHRpbiB7XG4gIGNvbG9yOiAke3QuZGVjbGFyZX07XG59XG5cbmJvb2xlYW4sXG5udW1iZXIge1xuICBjb2xvcjogJHt0Lm51bWJlcn07XG59XG5cbnBhcmFtcyB7XG4gIGNvbG9yOiAke3QucGFyYW1zfTtcbn1cblxuZnVuY3Rpb24ge1xuICBjb2xvcjogJHt0LmZ1bmN0aW9ufTtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5yZWdleHAge1xuICBjb2xvcjogJHt0LnJlZ2V4cCB8fCB0LnBhcmFtc307XG59XG5cbmNvbW1lbnQge1xuICBjb2xvcjogJHt0LmNvbW1lbnR9O1xufVxuXG5zdHJpbmcge1xuICBjb2xvcjogJHt0LnN0cmluZ307XG59XG5cbnN5bWJvbCxcbi4ke2Nzcy5jb2RlfSB7XG4gIGNvbG9yOiAke3QuY29sb3J9O1xufVxuXG4uJHtjc3MuY2FyZXR9IHtcbiAgYmFja2dyb3VuZDogJHt0LmNvbG9yfTtcbn1cblxucGFyYW1zLFxuZGVjbGFyZSB7XG4gIGZvbnQtc3R5bGU6IGl0YWxpYztcbn1cblxuc3ltYm9sIHtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5pbmRlbnQge1xuICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gIGJhY2tncm91bmQtcmVwZWF0OiBuby1yZXBlYXQ7XG59XG5gXG4gIClcblxufVxuXG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvY2s7XG5cbmZ1bmN0aW9uIEJsb2NrKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCAxKTtcbn1cblxuQmxvY2sucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuQmxvY2sucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlbmRlclBhZ2UoMSwgdHJ1ZSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGU7XG5cbmZ1bmN0aW9uIENvZGUobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEwKTtcbn1cblxuQ29kZS5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5Db2RlLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuICBpZiAoIXRoaXMuZWRpdG9yLmVkaXRpbmcpIHRoaXMucmVuZGVyQWhlYWQoKTtcbn07XG5cbkNvZGUucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciB5ID0gZWRpdC5saW5lO1xuICB2YXIgZyA9IGVkaXQucmFuZ2Uuc2xpY2UoKTtcbiAgdmFyIHNoaWZ0ID0gZWRpdC5zaGlmdDtcbiAgdmFyIGlzRW50ZXIgPSBzaGlmdCA+IDA7XG4gIHZhciBpc0JhY2tzcGFjZSA9IHNoaWZ0IDwgMDtcbiAgdmFyIGlzQmVnaW4gPSBnWzBdICsgaXNCYWNrc3BhY2UgPT09IDA7XG4gIHZhciBpc0VuZCA9IGdbMV0gKyBpc0VudGVyID09PSB0aGlzLmVkaXRvci5yb3dzO1xuXG4gIGlmIChzaGlmdCkge1xuICAgIGlmIChpc0VudGVyICYmICFpc0VuZCkgdGhpcy5zaGlmdFZpZXdzQmVsb3coZ1swXSwgc2hpZnQpO1xuICAgIGVsc2UgaWYgKGlzQmFja3NwYWNlICYmICFpc0JlZ2luKSB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhnWzBdLCBzaGlmdCk7XG4gIH1cblxuICB0aGlzLnVwZGF0ZVJhbmdlKGcpO1xuICB0aGlzLnJlbmRlclBhZ2UoMCk7XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbmQ7XG5cbmZ1bmN0aW9uIEZpbmQobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDQpO1xufVxuXG5GaW5kLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkZpbmQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcbiAgdGhpcy5yZW5kZXJQYWdlKDApO1xufTtcbiIsInZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xudmFyIEZpbmRWaWV3ID0gcmVxdWlyZSgnLi9maW5kJyk7XG52YXIgQmxvY2tWaWV3ID0gcmVxdWlyZSgnLi9ibG9jaycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3cztcblxuZnVuY3Rpb24gVmlld3MoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuXG4gIHRoaXMudmlld3MgPSBbXG4gICAgbmV3IFZpZXcoJ3J1bGVyJywgZWRpdG9yLCB0ZW1wbGF0ZS5ydWxlciksXG4gICAgbmV3IFZpZXcoJ2NhcmV0JywgZWRpdG9yLCB0ZW1wbGF0ZS5jYXJldCksXG4gICAgbmV3IENvZGVWaWV3KCdjb2RlJywgZWRpdG9yLCB0ZW1wbGF0ZS5jb2RlKSxcbiAgICBuZXcgTWFya1ZpZXcoJ21hcmsnLCBlZGl0b3IsIHRlbXBsYXRlLm1hcmspLFxuICAgIG5ldyBSb3dzVmlldygncm93cycsIGVkaXRvciwgdGVtcGxhdGUucm93cyksXG4gICAgbmV3IEZpbmRWaWV3KCdmaW5kJywgZWRpdG9yLCB0ZW1wbGF0ZS5maW5kKSxcbiAgICBuZXcgQmxvY2tWaWV3KCdibG9jaycsIGVkaXRvciwgdGVtcGxhdGUuYmxvY2spLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcblxuICB0aGlzLmJsb2NrLnJlbmRlciA9IGRlYm91bmNlKHRoaXMuYmxvY2sucmVuZGVyLCA2MCk7XG5cbiAgLy9UT0RPOiBuZWVkcyB0byBiZSBzZXQgZHluYW1pY2FsbHlcbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuaGlkZV9yb3dzKSB0aGlzLnJvd3MucmVuZGVyID0gbm9vcDtcbn1cblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59LFxuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IExheWVyO1xuXG5mdW5jdGlvbiBMYXllcihuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCBsZW5ndGgpIHtcbiAgdGhpcy5kb20gPSBkb20oY3NzLmxheWVyKTtcbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy52aWV3cyA9IHRoaXMuY3JlYXRlKGxlbmd0aCk7XG59XG5cbkxheWVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkxheWVyLnByb3RvdHlwZS5jcmVhdGUgPSBmdW5jdGlvbihsZW5ndGgpIHtcbiAgdmFyIHZpZXdzID0gbmV3IEFycmF5KGxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXSA9IG5ldyBWaWV3KHRoaXMubmFtZSwgdGhpcy5lZGl0b3IsIHRoaXMudGVtcGxhdGUpO1xuICAgIGRvbS5hcHBlbmQodGhpcywgdmlld3NbaV0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZXF1ZXN0VmlldyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiB2aWV3O1xuICB9XG4gIHJldHVybiB0aGlzLmNsZWFyKClbMF07XG59O1xuXG5MYXllci5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuaW5SYW5nZVZpZXdzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHZpZXdzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAoIHZpZXcudmlzaWJsZSA9PT0gdHJ1ZVxuICAgICAgJiYgKCB2aWV3WzBdID49IHJhbmdlWzBdICYmIHZpZXdbMF0gPD0gcmFuZ2VbMV1cbiAgICAgICAgfHwgdmlld1sxXSA+PSByYW5nZVswXSAmJiB2aWV3WzFdIDw9IHJhbmdlWzFdICkgKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUub3V0UmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IGZhbHNlXG4gICAgICB8fCB2aWV3WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHZpZXdbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHZpZXdzLnB1c2godmlldyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB2aWV3cy5zb3J0KChhLGIpID0+IGEubGFzdFVzZWQgLSBiLmxhc3RVc2VkKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJSYW5nZXMgPSBmdW5jdGlvbihyYW5nZXMsIHZpZXdzKSB7XG4gIGZvciAodmFyIG4gPSAwLCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciByYW5nZSA9IHJhbmdlc1tpXTtcbiAgICB2YXIgdmlldyA9IHZpZXdzW24rK107XG4gICAgdmlldy5yZW5kZXIocmFuZ2UpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgaW5jbHVkZSkge1xuICB2YXIgdmlzaWJsZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5WaWV3cyA9IHRoaXMuaW5SYW5nZVZpZXdzKHJhbmdlKTtcbiAgdmFyIG91dFZpZXdzID0gdGhpcy5vdXRSYW5nZVZpZXdzKG1heChyYW5nZSwgdmlzaWJsZVJhbmdlKSk7XG5cbiAgdmFyIG5lZWRSYW5nZXMgPSBSYW5nZS5OT1QocmFuZ2UsIGluVmlld3MpO1xuICB2YXIgbmVlZFZpZXdzID0gbmVlZFJhbmdlcy5sZW5ndGggLSBvdXRWaWV3cy5sZW5ndGg7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ25lZWQ6JywgbmVlZFZpZXdzLCBuZWVkUmFuZ2VzLmpvaW4oJyAnKSk7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ2hhdmU6JywgdGhpcy52aWV3cy5qb2luKCcgJykpO1xuICAvLyBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUpIGNvbnNvbGUubG9nKCdvdXQ6Jywgb3V0Vmlld3Muam9pbignICcpKTtcbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSBjb25zb2xlLmxvZygncmFuZ2UnLCByYW5nZSwgaW5WaWV3cy5qb2luKCcgJykpO1xuICBpZiAobmVlZFZpZXdzID4gMCkge1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlclJhbmdlcyhbdmlzaWJsZVJhbmdlXSwgdGhpcy52aWV3cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGVsc2UgaWYgKGluY2x1ZGUpIHRoaXMucmVuZGVyVmlld3MoaW5WaWV3cyk7XG4gIHRoaXMucmVuZGVyUmFuZ2VzKG5lZWRSYW5nZXMsIG91dFZpZXdzKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJWaWV3cyA9IGZ1bmN0aW9uKHZpZXdzKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXS5yZW5kZXIoKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckxpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMucmVuZGVyUmFuZ2UoW3kseV0sIHRydWUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbihuLCBpbmNsdWRlKSB7XG4gIG4gPSBuIHx8IDA7XG4gIHRoaXMucmVuZGVyUmFuZ2UodGhpcy5nZXRQYWdlUmFuZ2UoWy1uLCtuXSksIGluY2x1ZGUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckFoZWFkID0gZnVuY3Rpb24oaW5jbHVkZSkge1xuICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICB2YXIgY3VycmVudFBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcblxuICAvLyBubyB2aWV3IGlzIHZpc2libGUsIHJlbmRlciBjdXJyZW50IHBhZ2Ugb25seVxuICBpZiAoUmFuZ2UuQU5EKGN1cnJlbnRQYWdlUmFuZ2UsIHZpZXdzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLnJlbmRlclBhZ2UoMCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbLTEsKzFdKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB2aWV3cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG4gICAgdGhpcy5yZW5kZXJQYWdlKDIsIGluY2x1ZGUpO1xuICB9XG59O1xuXG4vKlxuXG4xICB4XG4yIC14XG4zIC14XG40IC1cbjVcbjZcblxuICovXG5cbkxheWVyLnByb3RvdHlwZS5zcGxpY2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcblxuICAgIGlmICh2aWV3WzFdIDwgcmFuZ2VbMF0gfHwgdmlld1swXSA+IHJhbmdlWzFdKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAodmlld1swXSA8IHJhbmdlWzBdICYmIHZpZXdbMV0gPj0gcmFuZ2VbMF0pIHsgLy8gc2hvcnRlbiBhYm92ZVxuICAgICAgdmlld1sxXSA9IHJhbmdlWzBdIC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMV0gPiByYW5nZVsxXSkgeyAvLyBzaG9ydGVuIGJlbG93XG4gICAgICB2aWV3WzBdID0gcmFuZ2VbMV0gKyAxO1xuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMF0gPT09IHJhbmdlWzBdICYmIHZpZXdbMV0gPT09IHJhbmdlWzFdKSB7IC8vIGN1cnJlbnQgbGluZVxuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmlldy5jbGVhcigpO1xuICAgIH1cbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnNoaWZ0Vmlld3NCZWxvdyA9IGZ1bmN0aW9uKHksIGR5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5KSBjb250aW51ZTtcblxuICAgIHZpZXdbMF0gKz0gZHk7XG4gICAgdmlld1sxXSArPSBkeTtcbiAgICB2aWV3LnN0eWxlKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS51cGRhdGVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMuc3BsaWNlUmFuZ2UocmFuZ2UpO1xuICB0aGlzLnJlbmRlclJhbmdlKHJhbmdlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnZpZXdzW2ldLmNsZWFyKCk7XG4gIH1cbiAgcmV0dXJuIHRoaXMudmlld3M7XG59O1xuXG5mdW5jdGlvbiBtYXgoYSwgYikge1xuICByZXR1cm4gW01hdGgubWluKGFbMF0sIGJbMF0pLCBNYXRoLm1heChhWzFdLCBiWzFdKV07XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFyaztcblxuZnVuY3Rpb24gTWFyayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbk1hcmsucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuTWFyay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IubWFyay5hY3RpdmUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUm93cztcblxuZnVuY3Rpb24gUm93cyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNSk7XG59XG5cblJvd3MucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuUm93cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0U2hpZnQpIHtcbiAgICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICAgIHZhciByb3dzID0gdGhpcy5lZGl0b3Iucm93cztcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgdmlldyA9IHZpZXdzW2ldO1xuICAgICAgdmFyIHIgPSB2aWV3O1xuICAgICAgaWYgKCF2aWV3LnZpc2libGUpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAoclsxXSA+IHJvd3MpIHZpZXcuY2xlYXIoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJBaGVhZCgpO1xufTtcbiIsInZhciB0ZW1wbGF0ZSA9IGV4cG9ydHM7XG5cbnRlbXBsYXRlLmNvZGUgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICAvLyBpZiAodGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID09PSBjb2RlKSB7XG4gIC8vICAgcmV0dXJuIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5yZXN1bHQ7XG4gIC8vIH0gZWxzZSB7XG4gIC8vICAgdGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID0gY29kZTtcbiAgLy8gICB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucmVzdWx0ID0gZmFsc2U7XG4gIC8vIH1cblxuICB2YXIgaHRtbCA9IGUuYnVmZmVyLmdldEhpZ2hsaWdodGVkKHJhbmdlKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbi8vIHNpbmdsZXRvbiBtZW1vaXplIGZvciBmYXN0IGxhc3QgcmVwZWF0aW5nIHZhbHVlXG50ZW1wbGF0ZS5jb2RlLm1lbW9pemUgPSB7XG4gIHBhcmFtOiAnJyxcbiAgcmVzdWx0OiAnJ1xufTtcblxudGVtcGxhdGUucm93cyA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBzID0gJyc7XG4gIGZvciAodmFyIGkgPSByYW5nZVswXTsgaSA8PSByYW5nZVsxXTsgaSsrKSB7XG4gICAgcyArPSAoaSArIDEpICsgJ1xcbic7XG4gIH1cbiAgcmV0dXJuIHM7XG59O1xuXG50ZW1wbGF0ZS5tYXJrID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmxpbmVzLmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5saW5lcy5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXQpO1xuXG4gIGFyZWFbMF0gLT0gb2Zmc2V0WzBdO1xuICBhcmVhWzFdIC09IG9mZnNldFswXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKSArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICAgKyAnd2lkdGg6JyArIHdpZHRoICsgJzsnXG4gICAgICAgICAgKyAndG9wOicgKyAoci55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICAgICsgJ2xlZnQ6JyArIChyLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIGlmIChlLmVkaXRpbmcpIHJldHVybiAnJztcblxuICB2YXIgb2Zmc2V0ID0gZS5idWZmZXIubGluZXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIHRhcmdldCA9IGUuYnVmZmVyLmxpbmVzLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcbiAgdmFyIGNvZGUgPSBlLmJ1ZmZlci5nZXQocmFuZ2UpO1xuICB2YXIgaSA9IHRhcmdldCAtIG9mZnNldDtcbiAgdmFyIGNoYXI7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgY291bnQgPSAxO1xuICBpIC09IDE7XG4gIHdoaWxlIChpID4gMCkge1xuICAgIGNoYXIgPSBjb2RlW2ldO1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAob3BlbiAmJiAhLS1jb3VudCkgYnJlYWs7XG4gICAgaS0tO1xuICB9XG5cbiAgaWYgKCFvcGVuKSByZXR1cm4gJyc7XG5cbiAgdmFyIGJlZ2luID0gZS5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KGkgKyBvZmZzZXQpO1xuXG4gIGNvdW50ID0gMTtcbiAgaSArPSAxO1xuXG4gIHdoaWxlIChpIDwgY29kZS5sZW5ndGgpIHtcbiAgICBjaGFyID0gY29kZVtpXTtcbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICAgIGkrKztcbiAgfVxuXG4gIGlmICghY2xvc2UpIHJldHVybiAnICc7XG5cbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmxpbmVzLmdldE9mZnNldChpICsgb2Zmc2V0KTtcblxuICB2YXIgaHRtbCA9ICcnO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKGJlZ2luLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGVuZC55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoZW5kLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQuc3R5bGUgPVxudGVtcGxhdGUuYmxvY2suc3R5bGUgPVxudGVtcGxhdGUubWFyay5zdHlsZSA9XG50ZW1wbGF0ZS5yb3dzLnN0eWxlID1cbnRlbXBsYXRlLmNvZGUuc3R5bGUgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6IDEsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IHJhbmdlWzBdICogZS5jaGFyLmhlaWdodCxcbiAgICBoZWlnaHQ6IChyYW5nZVsxXSAtIHJhbmdlWzBdICsgMSkgKiBlLmNoYXIuaGVpZ2h0XG4gIH07XG59O1xuXG50ZW1wbGF0ZS5jYXJldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG50ZW1wbGF0ZS5jYXJldC5zdHlsZSA9IGZ1bmN0aW9uKHBvaW50LCBlKSB7XG4gIHJldHVybiB7XG4gICAgb3BhY2l0eTogK2UuaGFzRm9jdXMsXG4gICAgbGVmdDogZS5jaGFyLndpZHRoICogZS5jYXJldC54ICsgZS5ndXR0ZXIgKyBlLm9wdGlvbnMubWFyZ2luX2xlZnQsXG4gICAgdG9wOiBlLmNoYXIuaGVpZ2h0ICogZS5jYXJldC55LFxuICAgIGhlaWdodDogZS5jaGFyLmhlaWdodCxcbiAgfTtcbn07XG5cbnRlbXBsYXRlLmd1dHRlciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbnVsbDtcbn07XG5cbnRlbXBsYXRlLmd1dHRlci5zdHlsZSA9IGZ1bmN0aW9uKHBvaW50LCBlKSB7XG4gIHJldHVybiB7XG4gICAgb3BhY2l0eTogMSxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6IGUucm93cyAqIGUuY2hhci5oZWlnaHQsXG4gIH07XG59O1xuXG50ZW1wbGF0ZS5ydWxlciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gZmFsc2U7XG59O1xuXG50ZW1wbGF0ZS5ydWxlci5zdHlsZSA9IGZ1bmN0aW9uKHBvaW50LCBlKSB7XG4gIHJldHVybiB7XG4gICAgLy8gd2lkdGg6IGUubG9uZ2VzdExpbmUgKiBlLmNoYXIud2lkdGgsXG4gICAgb3BhY2l0eTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6ICgoZS5yb3dzICsgZS5wYWdlLmhlaWdodCkgKiBlLmNoYXIuaGVpZ2h0KSArIGUucGFnZVJlbWFpbmRlci5oZWlnaHQsXG4gIH07XG59O1xuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi4vLi4vbGliL2RpZmYnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9tZXJnZScpO1xudmFyIHRyaW0gPSByZXF1aXJlKCcuLi8uLi9saWIvdHJpbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cbmZ1bmN0aW9uIFZpZXcobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgVmlldykpIHJldHVybiBuZXcgVmlldyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKTtcblxuICB0aGlzLm5hbWUgPSBuYW1lO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy50ZW1wbGF0ZSA9IHRlbXBsYXRlO1xuXG4gIHRoaXMudmlzaWJsZSA9IGZhbHNlO1xuICB0aGlzLmxhc3RVc2VkID0gMDtcblxuICB0aGlzWzBdID0gdGhpc1sxXSA9IC0xO1xuXG4gIHRoaXMuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgdGhpcy5lbC5jbGFzc05hbWUgPSBjc3NbbmFtZV07XG5cbiAgdmFyIHN0eWxlID0ge1xuICAgIHRvcDogMCxcbiAgICBoZWlnaHQ6IDAsXG4gICAgb3BhY2l0eTogMFxuICB9O1xuXG4gIGlmICh0aGlzLmVkaXRvci5vcHRpb25zLmRlYnVnX2xheWVyc1xuICAmJiB+dGhpcy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnMuaW5kZXhPZihuYW1lKSkge1xuICAgIHN0eWxlLmJhY2tncm91bmQgPSAnIydcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNilcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNilcbiAgICArIChNYXRoLnJhbmRvbSgpICogMTIgfCAwKS50b1N0cmluZygxNik7XG4gIH1cblxuICBkb20uc3R5bGUodGhpcywgc3R5bGUpO1xufVxuXG5WaWV3LnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbihyYW5nZSkge1xuICBpZiAoIXJhbmdlKSByYW5nZSA9IHRoaXM7XG5cbiAgdGhpcy5sYXN0VXNlZCA9IERhdGUubm93KCk7XG5cbiAgLy8gY29uc29sZS5sb2codGhpcy5uYW1lLCB0aGlzLnZhbHVlLCBlLmxheW91dFt0aGlzLm5hbWVdLCBkaWZmKHRoaXMudmFsdWUsIGUubGF5b3V0W3RoaXMubmFtZV0pKVxuICAvLyBpZiAoIWRpZmYodGhpcy52YWx1ZSwgdGhpcy5lZGl0b3IubGF5b3V0W3RoaXMubmFtZV0pKSByZXR1cm47XG5cbiAgdmFyIGh0bWwgPSB0aGlzLnRlbXBsYXRlKHJhbmdlLCB0aGlzLmVkaXRvcik7XG4gIGlmIChodG1sID09PSBmYWxzZSkgcmV0dXJuIHRoaXMuc3R5bGUoKTtcblxuICB0aGlzWzBdID0gcmFuZ2VbMF07XG4gIHRoaXNbMV0gPSByYW5nZVsxXTtcbiAgdGhpcy52aXNpYmxlID0gdHJ1ZTtcblxuICAvLyBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUpIHtcbiAgLy8gICB2YXIgcmVzID0gdHJpbS5lbXB0eUxpbmVzKGh0bWwpXG4gIC8vICAgcmFuZ2VbMF0gKz0gcmVzLmxlYWRpbmc7XG4gIC8vICAgaHRtbCA9IHJlcy5zdHJpbmc7XG4gIC8vIH1cblxuICBpZiAoaHRtbCkgZG9tLmh0bWwodGhpcywgaHRtbCk7XG4gIGVsc2UgaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lIHx8ICdibG9jaycgPT09IHRoaXMubmFtZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcblxuICAvLyBjb25zb2xlLmxvZygncmVuZGVyJywgdGhpcy5uYW1lKVxuICB0aGlzLnN0eWxlKCk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS5zdHlsZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmxhc3RVc2VkID0gRGF0ZS5ub3coKTtcbiAgZG9tLnN0eWxlKHRoaXMsIHRoaXMudGVtcGxhdGUuc3R5bGUodGhpcywgdGhpcy5lZGl0b3IpKTtcbn07XG5cblZpZXcucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzWzBdICsgJywnICsgdGhpc1sxXTtcbn07XG5cblZpZXcucHJvdG90eXBlLnZhbHVlT2YgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIFt0aGlzWzBdLCB0aGlzWzFdXTtcbn07XG5cblZpZXcucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy52aXNpYmxlKSByZXR1cm47XG4gIHRoaXNbMF0gPSB0aGlzWzFdID0gLTE7XG4gIHRoaXMudmlzaWJsZSA9IGZhbHNlO1xuICAvLyBkb20uaHRtbCh0aGlzLCAnJyk7XG4gIGRvbS5zdHlsZSh0aGlzLCB7IHRvcDogMCwgaGVpZ2h0OiAwLCBvcGFjaXR5OiAwIH0pO1xufTtcbiJdfQ==
