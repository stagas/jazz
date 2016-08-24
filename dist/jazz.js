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

    caret: new Point({ x: 0, y: 0 }),
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

Jazz.prototype.onFileSet = function() {
  this.setCaret({ x:0, y:0 });
  this.buffer.updateRaw();
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
  var p = this.caret['_*'](this.char);
  var s = this.animationScrollTarget || this.scroll;

  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + this.size.height) + this.char.height;

  var left = (s.x + this.char.width) - p.x;
  var right = (p.x) - (s.x + this.size.width - this.marginLeft) + this.char.width * 2;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  if (!this.animationRunning && !this.find.isOpen)
    this.scrollBy(right - left, bottom - top);
  else
    this.animateScrollBy(right - left, bottom - top);
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
  'indent': /^ +/,
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
  replacer: (s) => s.replace(/ {1,2}/g, '<indent>$&</indent>')
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
    lines[j] = new Array(match.index + 1).join(' ');
  }
  var prev;
  for (; i < lines.length; i++) {
    line = lines[i];
    prev = lines[i-1];
    if (!line.length && prev.length && prev[0] === ' ' && prev[prev.length-1] !== '/') lines[i] = ' ';
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
      this.insert('  ');
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

template.find.style = function() {
  //
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsImxpYi9hcmVhLmpzIiwibGliL2F0b21pYy5qcyIsImxpYi9ib3guanMiLCJsaWIvY2xvbmUuanMiLCJsaWIvZGVib3VuY2UuanMiLCJsaWIvZGlhbG9nL2luZGV4LmpzIiwibGliL2RpYWxvZy9zdHlsZS5jc3MiLCJsaWIvZGlmZi5qcyIsImxpYi9kb20uanMiLCJsaWIvZXZlbnQuanMiLCJsaWIvbWVtb2l6ZS5qcyIsImxpYi9tZXJnZS5qcyIsImxpYi9vcGVuLmpzIiwibGliL3BhcnNlLmpzIiwibGliL3BvaW50LmpzIiwibGliL3JhbmdlLWdhdGUtYW5kLmpzIiwibGliL3JhbmdlLWdhdGUtbm90LmpzIiwibGliL3JhbmdlLmpzIiwibGliL3JlZ2V4cC5qcyIsImxpYi9zYXZlLmpzIiwibGliL3NldC1pbW1lZGlhdGUuanMiLCJsaWIvdGhyb3R0bGUuanMiLCJsaWIvdHJpbS5qcyIsInNyYy9idWZmZXIvaW5kZXguanMiLCJzcmMvYnVmZmVyL2luZGV4ZXIuanMiLCJzcmMvYnVmZmVyL2xpbmVzLmpzIiwic3JjL2J1ZmZlci9wcmVmaXh0cmVlLmpzIiwic3JjL2J1ZmZlci9zZWdtZW50cy5qcyIsInNyYy9idWZmZXIvc2tpcHN0cmluZy5qcyIsInNyYy9idWZmZXIvc3ludGF4LmpzIiwic3JjL2ZpbGUuanMiLCJzcmMvaGlzdG9yeS5qcyIsInNyYy9pbnB1dC9iaW5kaW5ncy5qcyIsInNyYy9pbnB1dC9pbmRleC5qcyIsInNyYy9pbnB1dC9tb3VzZS5qcyIsInNyYy9pbnB1dC90ZXh0LmpzIiwic3JjL21vdmUuanMiLCJzcmMvc3R5bGUuY3NzIiwic3JjL3RoZW1lLmpzIiwic3JjL3ZpZXdzL2Jsb2NrLmpzIiwic3JjL3ZpZXdzL2NvZGUuanMiLCJzcmMvdmlld3MvZmluZC5qcyIsInNyYy92aWV3cy9pbmRleC5qcyIsInNyYy92aWV3cy9sYXllci5qcyIsInNyYy92aWV3cy9tYXJrLmpzIiwic3JjL3ZpZXdzL3Jvd3MuanMiLCJzcmMvdmlld3MvdGVtcGxhdGUuanMiLCJzcmMvdmlld3Mvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqMEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25NQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9EQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoUUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNVRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9RQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbE5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hNQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaElBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKlxuICogSmF6elxuICovXG5cbnZhciBEZWZhdWx0T3B0aW9ucyA9IHtcbiAgdGhlbWU6ICd3ZXN0ZXJuJyxcbiAgZGVidWdfbGF5ZXJzOiBmYWxzZSxcbiAgc2Nyb2xsX3NwZWVkOiA3NSxcbiAgaGlkZV9yb3dzOiBmYWxzZSxcbiAgY2VudGVyOiBmYWxzZSxcbiAgbWFyZ2luX2xlZnQ6IDE1LFxuICBndXR0ZXJfbWFyZ2luOiAyMCxcbn07XG5cbnJlcXVpcmUoJy4vbGliL3NldC1pbW1lZGlhdGUnKTtcbnZhciBkb20gPSByZXF1aXJlKCcuL2xpYi9kb20nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9saWIvZGlmZicpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnLi9saWIvbWVyZ2UnKTtcbnZhciBjbG9uZSA9IHJlcXVpcmUoJy4vbGliL2Nsb25lJyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi9saWIvdGhyb3R0bGUnKTtcbnZhciBhdG9taWMgPSByZXF1aXJlKCcuL2xpYi9hdG9taWMnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4vbGliL2V2ZW50Jyk7XG52YXIgUmVnZXhwID0gcmVxdWlyZSgnLi9saWIvcmVnZXhwJyk7XG52YXIgRGlhbG9nID0gcmVxdWlyZSgnLi9saWIvZGlhbG9nJyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuL2xpYi9wb2ludCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi9saWIvcmFuZ2UnKTtcbnZhciBBcmVhID0gcmVxdWlyZSgnLi9saWIvYXJlYScpO1xudmFyIEJveCA9IHJlcXVpcmUoJy4vbGliL2JveCcpO1xuXG52YXIgRGVmYXVsdEJpbmRpbmdzID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvYmluZGluZ3MnKTtcbnZhciBIaXN0b3J5ID0gcmVxdWlyZSgnLi9zcmMvaGlzdG9yeScpO1xudmFyIElucHV0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQnKTtcbnZhciBGaWxlID0gcmVxdWlyZSgnLi9zcmMvZmlsZScpO1xudmFyIE1vdmUgPSByZXF1aXJlKCcuL3NyYy9tb3ZlJyk7XG52YXIgVGV4dCA9IHJlcXVpcmUoJy4vc3JjL2lucHV0L3RleHQnKTtcbnZhciBWaWV3cyA9IHJlcXVpcmUoJy4vc3JjL3ZpZXdzJyk7XG52YXIgdGhlbWUgPSByZXF1aXJlKCcuL3NyYy90aGVtZScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3JjL3N0eWxlLmNzcycpO1xuXG52YXIgTkVXTElORSA9IFJlZ2V4cC5jcmVhdGUoWyduZXdsaW5lJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gSmF6ejtcblxuZnVuY3Rpb24gSmF6eihvcHRpb25zKSB7XG4gIHRoaXMub3B0aW9ucyA9IG1lcmdlKGNsb25lKERlZmF1bHRPcHRpb25zKSwgb3B0aW9ucyB8fCB7fSk7XG5cbiAgT2JqZWN0LmFzc2lnbih0aGlzLCB7XG4gICAgZWw6IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKSxcblxuICAgIGlkOiAnamF6el8nICsgKE1hdGgucmFuZG9tKCkgKiAxMGU2IHwgMCkudG9TdHJpbmcoMzYpLFxuICAgIGZpbGU6IG5ldyBGaWxlLFxuICAgIG1vdmU6IG5ldyBNb3ZlKHRoaXMpLFxuICAgIHZpZXdzOiBuZXcgVmlld3ModGhpcyksXG4gICAgaW5wdXQ6IG5ldyBJbnB1dCh0aGlzKSxcbiAgICBoaXN0b3J5OiBuZXcgSGlzdG9yeSh0aGlzKSxcblxuICAgIGJpbmRpbmdzOiB7IHNpbmdsZToge30gfSxcblxuICAgIGZpbmQ6IG5ldyBEaWFsb2coJ0ZpbmQnLCBUZXh0Lm1hcCksXG4gICAgZmluZFZhbHVlOiAnJyxcbiAgICBmaW5kTmVlZGxlOiAwLFxuICAgIGZpbmRSZXN1bHRzOiBbXSxcblxuICAgIHNjcm9sbDogbmV3IFBvaW50LFxuICAgIG9mZnNldDogbmV3IFBvaW50LFxuICAgIHNpemU6IG5ldyBCb3gsXG4gICAgY2hhcjogbmV3IEJveCxcblxuICAgIHBhZ2U6IG5ldyBCb3gsXG4gICAgcGFnZVBvaW50OiBuZXcgUG9pbnQsXG4gICAgcGFnZVJlbWFpbmRlcjogbmV3IEJveCxcbiAgICBwYWdlQm91bmRzOiBuZXcgUmFuZ2UsXG5cbiAgICBsb25nZXN0TGluZTogMCxcbiAgICBndXR0ZXI6IDAsXG4gICAgY29kZTogMCxcbiAgICByb3dzOiAwLFxuXG4gICAgY2FyZXQ6IG5ldyBQb2ludCh7IHg6IDAsIHk6IDAgfSksXG4gICAgaGFzRm9jdXM6IGZhbHNlLFxuXG4gICAgbWFyazogbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KSxcbiAgICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gICAgfSksXG5cbiAgICBlZGl0aW5nOiBmYWxzZSxcbiAgICBlZGl0TGluZTogLTEsXG4gICAgZWRpdFJhbmdlOiBbLTEsLTFdLFxuICAgIGVkaXRTaGlmdDogMCxcblxuICAgIHN1Z2dlc3RJbmRleDogMCxcbiAgICBzdWdnZXN0Um9vdDogJycsXG4gICAgc3VnZ2VzdE5vZGVzOiBbXSxcblxuICAgIGFuaW1hdGlvbkZyYW1lOiAtMSxcbiAgICBhbmltYXRpb25SdW5uaW5nOiBmYWxzZSxcbiAgICBhbmltYXRpb25TY3JvbGxUYXJnZXQ6IG51bGwsXG4gIH0pO1xuXG4gIGRvbS5hcHBlbmQodGhpcy52aWV3cy5jYXJldCwgdGhpcy5pbnB1dC50ZXh0KTtcbiAgZG9tLmFwcGVuZCh0aGlzLCB0aGlzLnZpZXdzKTtcblxuICAvLyB1c2VmdWwgc2hvcnRjdXRzXG4gIHRoaXMuYnVmZmVyID0gdGhpcy5maWxlLmJ1ZmZlcjtcbiAgdGhpcy5idWZmZXIubWFyayA9IHRoaXMubWFyaztcbiAgdGhpcy5zeW50YXggPSB0aGlzLmJ1ZmZlci5zeW50YXg7XG5cbiAgdGhlbWUodGhpcy5vcHRpb25zLnRoZW1lKTtcblxuICB0aGlzLmJpbmRNZXRob2RzKCk7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkphenoucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSmF6ei5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24oZWwsIHNjcm9sbEVsKSB7XG4gIGlmICh0aGlzLnJlZikge1xuICAgIHRoaXMuZWwucmVtb3ZlQXR0cmlidXRlKCdpZCcpO1xuICAgIHRoaXMuZWwuY2xhc3NMaXN0LnJlbW92ZShjc3MuZWRpdG9yKTtcbiAgICB0aGlzLmVsLmNsYXNzTGlzdC5yZW1vdmUodGhpcy5vcHRpb25zLnRoZW1lKTtcbiAgICB0aGlzLm9mZlNjcm9sbCgpO1xuICAgIHRoaXMucmVmLmZvckVhY2gocmVmID0+IHtcbiAgICAgIGRvbS5hcHBlbmQoZWwsIHJlZik7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5yZWYgPSBbXS5zbGljZS5jYWxsKHRoaXMuZWwuY2hpbGRyZW4pO1xuICAgIGRvbS5hcHBlbmQoZWwsIHRoaXMuZWwpO1xuICAgIGRvbS5vbnJlc2l6ZSh0aGlzLm9uUmVzaXplKTtcbiAgfVxuXG4gIHRoaXMuZWwgPSBlbDtcbiAgdGhpcy5lbC5zZXRBdHRyaWJ1dGUoJ2lkJywgdGhpcy5pZCk7XG4gIHRoaXMuZWwuY2xhc3NMaXN0LmFkZChjc3MuZWRpdG9yKTtcbiAgdGhpcy5lbC5jbGFzc0xpc3QuYWRkKHRoaXMub3B0aW9ucy50aGVtZSk7XG4gIHRoaXMub2ZmU2Nyb2xsID0gZG9tLm9uc2Nyb2xsKHNjcm9sbEVsIHx8IHRoaXMuZWwsIHRoaXMub25TY3JvbGwpO1xuICB0aGlzLmlucHV0LnVzZSh0aGlzLmVsKTtcblxuICBzZXRUaW1lb3V0KHRoaXMucmVwYWludCwgMCk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hc3NpZ24gPSBmdW5jdGlvbihiaW5kaW5ncykge1xuICB0aGlzLmJpbmRpbmdzID0gYmluZGluZ3M7XG4gIHJldHVybiB0aGlzO1xufTtcblxuSmF6ei5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKHBhdGgsIHJvb3QsIGZuKSB7XG4gIHRoaXMuZmlsZS5vcGVuKHBhdGgsIHJvb3QsIGZuKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zYXZlID0gZnVuY3Rpb24oZm4pIHtcbiAgdGhpcy5maWxlLnNhdmUoZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQsIHBhdGgpIHtcbiAgdGhpcy5maWxlLnNldCh0ZXh0KTtcbiAgdGhpcy5maWxlLnBhdGggPSBwYXRoIHx8IHRoaXMuZmlsZS5wYXRoO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmZvY3VzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmJsdXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRNZXRob2RzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsRnJhbWUgPSB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lLmJpbmQodGhpcyk7XG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSB0aGlzLmFuaW1hdGlvblNjcm9sbEJlZ2luLmJpbmQodGhpcyk7XG4gIHRoaXMubWFya1NldCA9IHRoaXMubWFya1NldC5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtDbGVhciA9IHRoaXMubWFya0NsZWFyLmJpbmQodGhpcyk7XG4gIHRoaXMucmVwYWludCA9IHRoaXMucmVwYWludC5iaW5kKHRoaXMpO1xuICB0aGlzLmZvY3VzID0gdGhpcy5mb2N1cy5iaW5kKHRoaXMpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEhhbmRsZXJzID0gZnVuY3Rpb24oKSB7XG4gIGZvciAodmFyIG1ldGhvZCBpbiB0aGlzKSB7XG4gICAgaWYgKCdvbicgPT09IG1ldGhvZC5zbGljZSgwLCAyKSkge1xuICAgICAgdGhpc1ttZXRob2RdID0gdGhpc1ttZXRob2RdLmJpbmQodGhpcyk7XG4gICAgfVxuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5iaW5kSGFuZGxlcnMoKVxuICB0aGlzLm1vdmUub24oJ21vdmUnLCB0aGlzLm9uTW92ZSk7XG4gIHRoaXMuZmlsZS5vbigncmF3JywgdGhpcy5vbkZpbGVSYXcpOyAvL1RPRE86IHNob3VsZCBub3QgbmVlZCB0aGlzIGV2ZW50XG4gIHRoaXMuZmlsZS5vbignc2V0JywgdGhpcy5vbkZpbGVTZXQpO1xuICB0aGlzLmZpbGUub24oJ29wZW4nLCB0aGlzLm9uRmlsZU9wZW4pO1xuICB0aGlzLmZpbGUub24oJ2NoYW5nZScsIHRoaXMub25GaWxlQ2hhbmdlKTtcbiAgdGhpcy5maWxlLm9uKCdiZWZvcmUgY2hhbmdlJywgdGhpcy5vbkJlZm9yZUZpbGVDaGFuZ2UpO1xuICB0aGlzLmhpc3Rvcnkub24oJ2NoYW5nZScsIHRoaXMub25IaXN0b3J5Q2hhbmdlKTtcbiAgdGhpcy5pbnB1dC5vbignYmx1cicsIHRoaXMub25CbHVyKTtcbiAgdGhpcy5pbnB1dC5vbignZm9jdXMnLCB0aGlzLm9uRm9jdXMpO1xuICB0aGlzLmlucHV0Lm9uKCdpbnB1dCcsIHRoaXMub25JbnB1dCk7XG4gIHRoaXMuaW5wdXQub24oJ3RleHQnLCB0aGlzLm9uVGV4dCk7XG4gIHRoaXMuaW5wdXQub24oJ2tleXMnLCB0aGlzLm9uS2V5cyk7XG4gIHRoaXMuaW5wdXQub24oJ2tleScsIHRoaXMub25LZXkpO1xuICB0aGlzLmlucHV0Lm9uKCdjdXQnLCB0aGlzLm9uQ3V0KTtcbiAgdGhpcy5pbnB1dC5vbignY29weScsIHRoaXMub25Db3B5KTtcbiAgdGhpcy5pbnB1dC5vbigncGFzdGUnLCB0aGlzLm9uUGFzdGUpO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZXVwJywgdGhpcy5vbk1vdXNlVXApO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRvd24nLCB0aGlzLm9uTW91c2VEb3duKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VjbGljaycsIHRoaXMub25Nb3VzZUNsaWNrKTtcbiAgdGhpcy5pbnB1dC5vbignbW91c2VkcmFnYmVnaW4nLCB0aGlzLm9uTW91c2VEcmFnQmVnaW4pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWcnLCB0aGlzLm9uTW91c2VEcmFnKTtcbiAgdGhpcy5maW5kLm9uKCdzdWJtaXQnLCB0aGlzLmZpbmRKdW1wLmJpbmQodGhpcywgMSkpO1xuICB0aGlzLmZpbmQub24oJ3ZhbHVlJywgdGhpcy5vbkZpbmRWYWx1ZSk7XG4gIHRoaXMuZmluZC5vbigna2V5JywgdGhpcy5vbkZpbmRLZXkpO1xuICB0aGlzLmZpbmQub24oJ29wZW4nLCB0aGlzLm9uRmluZE9wZW4pO1xuICB0aGlzLmZpbmQub24oJ2Nsb3NlJywgdGhpcy5vbkZpbmRDbG9zZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblNjcm9sbCA9IGZ1bmN0aW9uKHNjcm9sbCkge1xuICB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgdGhpcy5zY3JvbGwuc2V0KHNjcm9sbCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdmUgPSBmdW5jdGlvbihwb2ludCwgYnlFZGl0KSB7XG4gIGlmICghYnlFZGl0KSB0aGlzLmVkaXRpbmcgPSBmYWxzZTtcbiAgaWYgKHBvaW50KSB0aGlzLnNldENhcmV0KHBvaW50KTtcblxuICBpZiAoIWJ5RWRpdCkge1xuICAgIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0IHx8IHRoaXMuaW5wdXQubW91c2UuZG93bikgdGhpcy5tYXJrU2V0KCk7XG4gICAgZWxzZSB0aGlzLm1hcmtDbGVhcigpO1xuICB9XG5cbiAgdGhpcy5lbWl0KCdtb3ZlJyk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblJlc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlcGFpbnQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRm9jdXMgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSB0cnVlO1xuICB0aGlzLmVtaXQoJ2ZvY3VzJyk7XG4gIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJsdXIgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuaGFzRm9jdXMgPSBmYWxzZTtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgaWYgKCF0aGlzLmhhc0ZvY3VzKSB7XG4gICAgICB0aGlzLmVtaXQoJ2JsdXInKTtcbiAgICAgIHRoaXMudmlld3MuY2FyZXQucmVuZGVyKCk7XG4gICAgfVxuICB9LCA1KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uSW5wdXQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblRleHQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHRoaXMuc3VnZ2VzdFJvb3QgPSAnJztcbiAgdGhpcy5pbnNlcnQodGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleXMgPSBmdW5jdGlvbihrZXlzLCBlKSB7XG4gIGlmIChrZXlzIGluIHRoaXMuYmluZGluZ3MpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5iaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG4gIGVsc2UgaWYgKGtleXMgaW4gRGVmYXVsdEJpbmRpbmdzKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIERlZmF1bHRCaW5kaW5nc1trZXlzXS5jYWxsKHRoaXMsIGUpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbktleSA9IGZ1bmN0aW9uKGtleSwgZSkge1xuICBpZiAoa2V5IGluIHRoaXMuYmluZGluZ3Muc2luZ2xlKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHRoaXMuYmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxuICBlbHNlIGlmIChrZXkgaW4gRGVmYXVsdEJpbmRpbmdzLnNpbmdsZSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBEZWZhdWx0QmluZGluZ3Muc2luZ2xlW2tleV0uY2FsbCh0aGlzLCBlKTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25DdXQgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB0aGlzLm9uQ29weShlKTtcbiAgdGhpcy5kZWxldGUoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQ29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkhpc3RvcnlDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlcGFpbnQoKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25CZWZvcmVGaWxlQ2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuaGlzdG9yeS5zYXZlKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVDaGFuZ2UgPSBmdW5jdGlvbihlZGl0UmFuZ2UsIGVkaXRTaGlmdCwgdGV4dEJlZm9yZSwgdGV4dEFmdGVyKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdjaGFuZ2UnKVxuICB0aGlzLmVkaXRpbmcgPSB0cnVlO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5idWZmZXIubG9jXTtcblxuICBpZiAodGhpcy5maW5kLmlzT3Blbikge1xuICAgIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUsIHRydWUpO1xuICB9XG5cbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcblxuICB0aGlzLnZpZXdzLmNvZGUucmVuZGVyRWRpdCh7XG4gICAgbGluZTogZWRpdFJhbmdlWzBdLFxuICAgIHJhbmdlOiBlZGl0UmFuZ2UsXG4gICAgc2hpZnQ6IGVkaXRTaGlmdFxuICB9KTtcblxuICB0aGlzLnJlbmRlcigpO1xuXG4gIHRoaXMuZW1pdCgnY2hhbmdlJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldEZyb21QeCA9IGZ1bmN0aW9uKHB4KSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5tYXJnaW5MZWZ0LCB5OiB0aGlzLmNoYXIuaGVpZ2h0LzIgfSlbJysnXSh0aGlzLm9mZnNldCk7XG4gIHZhciBwID0gcHhbJy0nXShnKVsnKyddKHRoaXMuc2Nyb2xsKVsnby8nXSh0aGlzLmNoYXIpO1xuXG4gIHAueSA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueSwgdGhpcy5idWZmZXIubG9jKSk7XG4gIHAueCA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueCwgdGhpcy5nZXRMaW5lTGVuZ3RoKHAueSkpKTtcblxuICB0aGlzLnNldENhcmV0KHApO1xuICB0aGlzLm1vdmUubGFzdERlbGliZXJhdGVYID0gcC54O1xuICB0aGlzLm9uTW92ZSgpO1xuXG4gIHJldHVybiBwO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZVVwID0gZnVuY3Rpb24oKSB7XG4gIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGlmICghdGhpcy5oYXNGb2N1cykgdGhpcy5ibHVyKCk7XG4gIH0sIDUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURvd24gPSBmdW5jdGlvbigpIHtcbiAgc2V0VGltZW91dCh0aGlzLmZvY3VzLmJpbmQodGhpcyksIDEwKTtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQpIHRoaXMubWFya0JlZ2luKCk7XG4gIGVsc2UgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNldENhcmV0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLmNhcmV0LnNldChwKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZUNsaWNrID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjbGlja3MgPSB0aGlzLmlucHV0Lm1vdXNlLmNsaWNrcztcbiAgaWYgKGNsaWNrcyA+IDEpIHtcbiAgICB2YXIgYXJlYTtcblxuICAgIGlmIChjbGlja3MgPT09IDIpIHtcbiAgICAgIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXQodGhpcy5jYXJldCk7XG4gICAgfSBlbHNlIGlmIChjbGlja3MgPT09IDMpIHtcbiAgICAgIHZhciB5ID0gdGhpcy5jYXJldC55O1xuICAgICAgYXJlYSA9IG5ldyBBcmVhKHtcbiAgICAgICAgYmVnaW46IHsgeDogMCwgeTogeSB9LFxuICAgICAgICBlbmQ6IHsgeDogdGhpcy5nZXRMaW5lTGVuZ3RoKHkpLCB5OiB5IH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChhcmVhKSB7XG4gICAgICB0aGlzLnNldENhcmV0KGFyZWEuZW5kKTtcbiAgICAgIHRoaXMubWFya1NldEFyZWEoYXJlYSk7XG4gICAgICAvLyB0aGlzLnJlbmRlcigpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UuZG93bik7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbk1vdXNlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldENhcmV0RnJvbVB4KHRoaXMuaW5wdXQubW91c2UucG9pbnQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0JlZ2luID0gZnVuY3Rpb24oYXJlYSkge1xuICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICB0aGlzLm1hcmsuYWN0aXZlID0gdHJ1ZTtcbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5tYXJrLnNldChhcmVhKTtcbiAgICB9IGVsc2UgaWYgKGFyZWEgIT09IGZhbHNlIHx8IHRoaXMubWFyay5iZWdpbi54ID09PSAtMSkge1xuICAgICAgdGhpcy5tYXJrLmJlZ2luLnNldCh0aGlzLmNhcmV0KTtcbiAgICAgIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkgdGhpcy5tYXJrLmVuZC5zZXQodGhpcy5jYXJldCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrU2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdGhpcy5tYXJrQmVnaW4oYXJlYSk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5tYXJrQ2xlYXIgPSBmdW5jdGlvbihmb3JjZSkge1xuICBpZiAodGhpcy5pbnB1dC50ZXh0Lm1vZGlmaWVycy5zaGlmdCAmJiAhZm9yY2UpIHJldHVybjtcblxuICB0aGlzLm1hcmsuYWN0aXZlID0gZmFsc2U7XG4gIHRoaXMubWFyay5zZXQoe1xuICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgZW5kOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSlcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJldHVybiBSYW5nZS5jbGFtcChyYW5nZSwgdGhpcy5wYWdlQm91bmRzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciBwID0gdGhpcy5zY3JvbGxbJ18vJ10odGhpcy5jaGFyKTtcbiAgcmV0dXJuIHRoaXMuZ2V0UmFuZ2UoW1xuICAgIE1hdGguZmxvb3IocC55ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzBdKSxcbiAgICBNYXRoLmNlaWwocC55ICsgdGhpcy5wYWdlLmhlaWdodCArIHRoaXMucGFnZS5oZWlnaHQgKiByYW5nZVsxXSlcbiAgXSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRMaW5lTGVuZ3RoID0gZnVuY3Rpb24oeSkge1xuICByZXR1cm4gdGhpcy5idWZmZXIubGluZXMuZ2V0TGluZUxlbmd0aCh5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmZvbGxvd0NhcmV0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwID0gdGhpcy5jYXJldFsnXyonXSh0aGlzLmNoYXIpO1xuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHZhciB0b3AgPSBzLnkgLSBwLnk7XG4gIHZhciBib3R0b20gPSAocC55KSAtIChzLnkgKyB0aGlzLnNpemUuaGVpZ2h0KSArIHRoaXMuY2hhci5oZWlnaHQ7XG5cbiAgdmFyIGxlZnQgPSAocy54ICsgdGhpcy5jaGFyLndpZHRoKSAtIHAueDtcbiAgdmFyIHJpZ2h0ID0gKHAueCkgLSAocy54ICsgdGhpcy5zaXplLndpZHRoIC0gdGhpcy5tYXJnaW5MZWZ0KSArIHRoaXMuY2hhci53aWR0aCAqIDI7XG5cbiAgaWYgKGJvdHRvbSA8IDApIGJvdHRvbSA9IDA7XG4gIGlmICh0b3AgPCAwKSB0b3AgPSAwO1xuICBpZiAobGVmdCA8IDApIGxlZnQgPSAwO1xuICBpZiAocmlnaHQgPCAwKSByaWdodCA9IDA7XG5cbiAgaWYgKCF0aGlzLmFuaW1hdGlvblJ1bm5pbmcgJiYgIXRoaXMuZmluZC5pc09wZW4pXG4gICAgdGhpcy5zY3JvbGxCeShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCk7XG4gIGVsc2VcbiAgICB0aGlzLmFuaW1hdGVTY3JvbGxCeShyaWdodCAtIGxlZnQsIGJvdHRvbSAtIHRvcCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB0aGlzLnNjcm9sbC5zZXQoUG9pbnQubG93KHtcbiAgICB4OiAwLFxuICAgIHk6IDBcbiAgfSwge1xuICAgIHg6IHRoaXMuc2Nyb2xsLnggKyB4LFxuICAgIHk6IHRoaXMuc2Nyb2xsLnkgKyB5XG4gIH0pKTtcbiAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRlU2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIGlmICghdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IHRydWU7XG4gICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxCZWdpbik7XG4gIH1cblxuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1heCgwLCBzLnggKyB4KSxcbiAgICB5OiBNYXRoLm1pbigodGhpcy5yb3dzICsgMSkgKiB0aGlzLmNoYXIuaGVpZ2h0IC0gdGhpcy5zaXplLmhlaWdodCwgTWF0aC5tYXgoMCwgcy55ICsgeSkpXG4gIH0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuYW5pbWF0aW9uU2Nyb2xsQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5hbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZSk7XG5cbiAgdmFyIHMgPSB0aGlzLnNjcm9sbDtcbiAgdmFyIHQgPSB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldDtcblxuICB2YXIgZHggPSB0LnggLSBzLng7XG4gIHZhciBkeSA9IHQueSAtIHMueTtcblxuICBkeCA9IE1hdGguc2lnbihkeCkgKiA1O1xuICBkeSA9IE1hdGguc2lnbihkeSkgKiA1O1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gZnVuY3Rpb24oKSB7XG4gIHZhciBzcGVlZCA9IHRoaXMub3B0aW9ucy5zY3JvbGxfc3BlZWQ7XG4gIHZhciBzID0gdGhpcy5zY3JvbGw7XG4gIHZhciB0ID0gdGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQ7XG5cbiAgdmFyIGR4ID0gdC54IC0gcy54O1xuICB2YXIgZHkgPSB0LnkgLSBzLnk7XG5cbiAgdmFyIGFkeCA9IE1hdGguYWJzKGR4KTtcbiAgdmFyIGFkeSA9IE1hdGguYWJzKGR5KTtcblxuICBpZiAoYWR5ID49IHRoaXMuc2l6ZS5oZWlnaHQgKiAxLjIpIHtcbiAgICBzcGVlZCAqPSAyLjQ1O1xuICB9XG5cbiAgaWYgKGFkeCA8IDEgJiYgYWR5IDwgMSkge1xuICAgIHRoaXMuc2Nyb2xsVG8odGhpcy5hbmltYXRpb25TY3JvbGxUYXJnZXQpO1xuICAgIHRoaXMuYW5pbWF0aW9uUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbnVsbDtcbiAgICB0aGlzLmVtaXQoJ2FuaW1hdGlvbiBlbmQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBpZiAoYWR4IDwgc3BlZWQpIGR4ICo9IDAuOTtcbiAgZWxzZSBkeCA9IE1hdGguc2lnbihkeCkgKiBzcGVlZDtcblxuICBpZiAoYWR5IDwgc3BlZWQpIGR5ICo9IDAuOTtcbiAgZWxzZSBkeSA9IE1hdGguc2lnbihkeSkgKiBzcGVlZDtcblxuICB0aGlzLnNjcm9sbEJ5KGR4LCBkeSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB0aGlzLmRlbGV0ZSgpO1xuXG4gIHZhciBsaW5lID0gdGhpcy5idWZmZXIuZ2V0TGluZSh0aGlzLmNhcmV0LnkpO1xuICB2YXIgcmlnaHQgPSBsaW5lW3RoaXMuY2FyZXQueF07XG4gIHZhciBoYXNSaWdodFN5bWJvbCA9IH5bJ30nLCddJywnKSddLmluZGV4T2YocmlnaHQpO1xuXG4gIC8vIGFwcGx5IGluZGVudCBvbiBlbnRlclxuICBpZiAoTkVXTElORS50ZXN0KHRleHQpKSB7XG4gICAgdmFyIGlzRW5kT2ZMaW5lID0gdGhpcy5jYXJldC54ID09PSBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGxlZnQgPSBsaW5lW3RoaXMuY2FyZXQueCAtIDFdO1xuICAgIHZhciBpbmRlbnQgPSBsaW5lLm1hdGNoKC9cXFMvKTtcbiAgICBpbmRlbnQgPSBpbmRlbnQgPyBpbmRlbnQuaW5kZXggOiBsaW5lLmxlbmd0aCAtIDE7XG4gICAgdmFyIGhhc0xlZnRTeW1ib2wgPSB+Wyd7JywnWycsJygnXS5pbmRleE9mKGxlZnQpO1xuXG4gICAgaWYgKGhhc0xlZnRTeW1ib2wpIGluZGVudCArPSAyO1xuXG4gICAgaWYgKGlzRW5kT2ZMaW5lIHx8IGhhc0xlZnRTeW1ib2wpIHtcbiAgICAgIHRleHQgKz0gbmV3IEFycmF5KGluZGVudCArIDEpLmpvaW4oJyAnKTtcbiAgICB9XG4gIH1cblxuICB2YXIgbGVuZ3RoO1xuXG4gIGlmICghaGFzUmlnaHRTeW1ib2wgfHwgKGhhc1JpZ2h0U3ltYm9sICYmICF+Wyd9JywnXScsJyknXS5pbmRleE9mKHRleHQpKSkge1xuICAgIGxlbmd0aCA9IHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCB0ZXh0KTtcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSAxO1xuICB9XG5cbiAgdGhpcy5tb3ZlLmJ5Q2hhcnMobGVuZ3RoLCB0cnVlKTtcblxuICBpZiAoJ3snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ30nKTtcbiAgZWxzZSBpZiAoJygnID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJyknKTtcbiAgZWxzZSBpZiAoJ1snID09PSB0ZXh0KSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgJ10nKTtcblxuICBpZiAoaGFzTGVmdFN5bWJvbCAmJiBoYXNSaWdodFN5bWJvbCkge1xuICAgIGluZGVudCAtPSAyO1xuICAgIHRoaXMuYnVmZmVyLmluc2VydCh0aGlzLmNhcmV0LCAnXFxuJyArIG5ldyBBcnJheShpbmRlbnQgKyAxKS5qb2luKCcgJykpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iYWNrc3BhY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSAmJiAhdGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybiB0aGlzLmRlbGV0ZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSwgdHJ1ZSk7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQ2hhckF0KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUgJiYgIXRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmJ1ZmZlci5kZWxldGVDaGFyQXQodGhpcy5jYXJldCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLmZpbmRKdW1wID0gZnVuY3Rpb24oanVtcCkge1xuICBpZiAoIXRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIHx8ICF0aGlzLmZpbmQuaXNPcGVuKSByZXR1cm47XG5cbiAgdGhpcy5maW5kTmVlZGxlID0gdGhpcy5maW5kTmVlZGxlICsganVtcDtcbiAgaWYgKHRoaXMuZmluZE5lZWRsZSA+PSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IDA7XG4gIH0gZWxzZSBpZiAodGhpcy5maW5kTmVlZGxlIDwgMCkge1xuICAgIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoIC0gMTtcbiAgfVxuXG4gIHZhciByZXN1bHQgPSB0aGlzLmZpbmRSZXN1bHRzW3RoaXMuZmluZE5lZWRsZV07XG4gIHRoaXMuc2V0Q2FyZXQocmVzdWx0KTtcbiAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gIHRoaXMubWFya0JlZ2luKCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKHRoaXMuZmluZFZhbHVlLmxlbmd0aCwgdHJ1ZSk7XG4gIHRoaXMubWFya1NldCgpO1xuICB0aGlzLmZvbGxvd0NhcmV0KCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRWYWx1ZSA9IGZ1bmN0aW9uKHZhbHVlLCBub0p1bXApIHtcbiAgdmFyIGcgPSBuZXcgUG9pbnQoeyB4OiB0aGlzLmd1dHRlciwgeTogMCB9KTtcblxuICB0aGlzLmJ1ZmZlci51cGRhdGVSYXcoKTtcblxuICB0aGlzLnZpZXdzLmZpbmQuY2xlYXIoKTtcblxuICB0aGlzLmZpbmRWYWx1ZSA9IHZhbHVlO1xuICAvLyBjb25zb2xlLnRpbWUoJ2ZpbmQgJyArIHZhbHVlKTtcbiAgdGhpcy5maW5kUmVzdWx0cyA9IHRoaXMuYnVmZmVyLmluZGV4ZXIuZmluZCh2YWx1ZSkubWFwKChvZmZzZXQpID0+IHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KG9mZnNldCk7XG4gICAgICAvL3B4OiBuZXcgUG9pbnQocG9pbnQpWycqJ10oZS5jaGFyKVsnKyddKGcpXG4gIH0pO1xuICAvLyBjb25zb2xlLnRpbWVFbmQoJ2ZpbmQgJyArIHZhbHVlKTtcblxuICB0aGlzLmZpbmQuaW5mbygnMC8nICsgdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpO1xuXG4gIGlmICghbm9KdW1wKSB0aGlzLmZpbmRKdW1wKDApO1xuXG4gIHRoaXMudmlld3MuZmluZC5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmluZEtleSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKH5bMzMsIDM0LCAxMTRdLmluZGV4T2YoZS53aGljaCkpIHsgLy8gcGFnZXVwLCBwYWdlZG93biwgZjNcbiAgICB0aGlzLmlucHV0LnRleHQub25rZXlkb3duKGUpO1xuICB9XG5cbiAgaWYgKDcwID09PSBlLndoaWNoICYmIGUuY3RybEtleSkgeyAvLyBjdHJsK2ZcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICg5ID09PSBlLndoaWNoKSB7IC8vIHRhYlxuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRPcGVuID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZmluZC5pbmZvKCcnKTtcbiAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRDbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnZpZXdzLmZpbmQuY2xlYXIoKTtcbiAgdGhpcy5mb2N1cygpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc3VnZ2VzdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgYXJlYSA9IHRoaXMuYnVmZmVyLndvcmRBdCh0aGlzLmNhcmV0LCB0cnVlKTtcbiAgaWYgKCFhcmVhKSByZXR1cm47XG5cbiAgdmFyIGtleSA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gIGlmICgha2V5KSByZXR1cm47XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3RSb290XG4gICAgfHwga2V5LnN1YnN0cigwLCB0aGlzLnN1Z2dlc3RSb290Lmxlbmd0aCkgIT09IHRoaXMuc3VnZ2VzdFJvb3QpIHtcbiAgICB0aGlzLnN1Z2dlc3RJbmRleCA9IDA7XG4gICAgdGhpcy5zdWdnZXN0Um9vdCA9IGtleTtcbiAgICB0aGlzLnN1Z2dlc3ROb2RlcyA9IHRoaXMuYnVmZmVyLnByZWZpeC5jb2xsZWN0KGtleSk7XG4gIH1cblxuICBpZiAoIXRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aCkgcmV0dXJuO1xuICB2YXIgbm9kZSA9IHRoaXMuc3VnZ2VzdE5vZGVzW3RoaXMuc3VnZ2VzdEluZGV4XTtcblxuICB0aGlzLnN1Z2dlc3RJbmRleCA9ICh0aGlzLnN1Z2dlc3RJbmRleCArIDEpICUgdGhpcy5zdWdnZXN0Tm9kZXMubGVuZ3RoO1xuXG4gIHJldHVybiB7XG4gICAgYXJlYTogYXJlYSxcbiAgICBub2RlOiBub2RlXG4gIH07XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXBhaW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVzaXplKCk7XG4gIHRoaXMucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5yZXNpemUgPSBmdW5jdGlvbigpIHtcbiAgdmFyICQgPSB0aGlzLmVsO1xuXG4gIHRoaXMub2Zmc2V0LnNldChkb20uZ2V0T2Zmc2V0KCQpKTtcbiAgdGhpcy5zY3JvbGwuc2V0KGRvbS5nZXRTY3JvbGwoJCkpO1xuICB0aGlzLnNpemUuc2V0KGRvbS5nZXRTaXplKCQpKTtcblxuICAvLyB0aGlzIGlzIGEgd2VpcmQgZml4IHdoZW4gZG9pbmcgbXVsdGlwbGUgLnVzZSgpXG4gIGlmICh0aGlzLmNoYXIud2lkdGggPT09IDApIHRoaXMuY2hhci5zZXQoZG9tLmdldENoYXJTaXplKCQsIGNzcy5jb2RlKSk7XG5cbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWydfKiddKHRoaXMuY2hhcikpKTtcbiAgdGhpcy5wYWdlQm91bmRzID0gWzAsIHRoaXMucm93c107XG4gIHRoaXMubG9uZ2VzdExpbmUgPSBNYXRoLm1pbig1MDAsIHRoaXMuYnVmZmVyLmxpbmVzLmdldExvbmdlc3RMaW5lTGVuZ3RoKCkpO1xuICB0aGlzLmd1dHRlciA9IE1hdGgubWF4KFxuICAgIHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogKCcnK3RoaXMucm93cykubGVuZ3RoLFxuICAgICh0aGlzLm9wdGlvbnMuY2VudGVyXG4gICAgICA/ICh0aGlzLnBhZ2Uud2lkdGggLSA4MSkgLyAyIHwgMCA6IDApXG4gICAgKyAodGhpcy5vcHRpb25zLmhpZGVfcm93c1xuICAgICAgPyAwIDogTWF0aC5tYXgoMywgKCcnK3RoaXMucm93cykubGVuZ3RoKSlcbiAgKSAqIHRoaXMuY2hhci53aWR0aCArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzID8gMCA6IHRoaXMub3B0aW9ucy5ndXR0ZXJfbWFyZ2luKTtcbiAgdGhpcy5tYXJnaW5MZWZ0ID0gdGhpcy5ndXR0ZXIgKyB0aGlzLm9wdGlvbnMubWFyZ2luX2xlZnQ7XG5cbiAgLy8gZG9tLnN0eWxlKHRoaXMuZWwsIHtcbiAgLy8gICB3aWR0aDogdGhpcy5sb25nZXN0TGluZSAqIHRoaXMuY2hhci53aWR0aCxcbiAgLy8gICBoZWlnaHQ6IHRoaXMucm93cyAqIHRoaXMuY2hhci5oZWlnaHRcbiAgLy8gfSk7XG5cbiAgLy9UT0RPOiBtYWtlIG1ldGhvZC91dGlsXG4gIC8vIGRyYXcgaW5kZW50IGltYWdlXG4gIHZhciBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdmFyIGZvbyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmb28nKTtcbiAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuXG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ3dpZHRoJywgTWF0aC5jZWlsKHRoaXMuY2hhci53aWR0aCAqIDIpKTtcbiAgY2FudmFzLnNldEF0dHJpYnV0ZSgnaGVpZ2h0JywgdGhpcy5jaGFyLmhlaWdodCk7XG5cbiAgdmFyIGNvbW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjb21tZW50Jyk7XG4gICQuYXBwZW5kQ2hpbGQoY29tbWVudCk7XG4gIHZhciBjb2xvciA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGNvbW1lbnQpLmNvbG9yO1xuICAkLnJlbW92ZUNoaWxkKGNvbW1lbnQpO1xuICBjdHguc2V0TGluZURhc2goWzEsMV0pO1xuICBjdHgubGluZURhc2hPZmZzZXQgPSAwO1xuICBjdHguYmVnaW5QYXRoKCk7XG4gIGN0eC5tb3ZlVG8oMCwxKTtcbiAgY3R4LmxpbmVUbygwLCB0aGlzLmNoYXIuaGVpZ2h0KTtcbiAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3I7XG4gIGN0eC5zdHJva2UoKTtcblxuICB2YXIgZGF0YVVSTCA9IGNhbnZhcy50b0RhdGFVUkwoKTtcblxuICBkb20uY3NzKHRoaXMuaWQsIGBcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5ydWxlcn0sXG4gICAgIyR7dGhpcy5pZH0gPiAuJHtjc3MubGF5ZXJ9ID4gLiR7Y3NzLmZpbmR9LFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5tYXJrfSxcbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuY29kZX0ge1xuICAgICAgcGFkZGluZy1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdCArIHRoaXMuZ3V0dGVyfXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3Mucm93c30ge1xuICAgICAgcGFkZGluZy1yaWdodDogJHt0aGlzLm9wdGlvbnMuZ3V0dGVyX21hcmdpbn1weDtcbiAgICAgIG1hcmdpbi1sZWZ0OiAke3RoaXMub3B0aW9ucy5tYXJnaW5fbGVmdH1weDtcbiAgICAgIHdpZHRoOiAke3RoaXMuZ3V0dGVyfXB4O1xuICAgIH1cbiAgICAjJHt0aGlzLmlkfSA+IC4ke2Nzcy5sYXllcn0gPiAuJHtjc3MuZmluZH0gPiBpLFxuICAgICMke3RoaXMuaWR9ID4gLiR7Y3NzLmxheWVyfSA+IC4ke2Nzcy5ibG9ja30gPiBpIHtcbiAgICAgIGhlaWdodDogJHt0aGlzLmNoYXIuaGVpZ2h0ICsgMX1weDtcbiAgICB9XG4gICAgaW5kZW50IHtcbiAgICAgIGJhY2tncm91bmQtaW1hZ2U6IHVybCgke2RhdGFVUkx9KTtcbiAgICB9YFxuICApO1xuXG4gIHRoaXMuZW1pdCgncmVzaXplJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jbGVhciA9IGF0b21pYyhmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2NsZWFyJylcbiAgdGhpcy5lZGl0aW5nID0gZmFsc2U7XG4gIHRoaXMudmlld3MuY2xlYXIoKTtcbn0pO1xuXG5KYXp6LnByb3RvdHlwZS5yZW5kZXIgPSBhdG9taWMoZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdyZW5kZXInKVxuICB0aGlzLnZpZXdzLnJlbmRlcigpO1xuICB0aGlzLmVtaXQoJ3JlbmRlcicpO1xufSk7XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gJycgKyBhLmJlZ2luICsgJy0nICsgYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGF0b21pYztcblxuLy8gZnVuY3Rpb24gYXRvbWljKGZuKSB7XG4vLyAgIHZhciBzdGFnZSA9IGZhbHNlO1xuLy8gICB2YXIgbiA9IDA7XG5cbi8vICAgZnVuY3Rpb24gd3JhcCgpIHtcbi8vICAgICBpZiAoc3RhZ2UpIHJldHVybiBuKys7XG4vLyAgICAgZWxzZSBmbi5jYWxsKHRoaXMpO1xuLy8gICB9XG5cbi8vICAgd3JhcC5ob2xkID0gZnVuY3Rpb24oKSB7XG4vLyAgICAgc3RhZ2UgPSB0cnVlO1xuLy8gICAgIG4gPSBuIHx8IDA7XG4vLyAgIH07XG5cbi8vICAgd3JhcC5yZWxlYXNlID0gZnVuY3Rpb24oY29udGV4dCkge1xuLy8gICAgIGlmIChzdGFnZSAmJiBuKSB7XG4vLyAgICAgICBzdGFnZSA9IGZhbHNlO1xuLy8gICAgICAgbiA9IDA7XG4vLyAgICAgICBmbi5jYWxsKGNvbnRleHQpO1xuLy8gICAgIH1cbi8vICAgfTtcblxuLy8gICByZXR1cm4gd3JhcDtcbi8vIH1cblxuZnVuY3Rpb24gYXRvbWljKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgY2xlYXJJbW1lZGlhdGUocmVxdWVzdCk7XG4gICAgcmVxdWVzdCA9IHNldEltbWVkaWF0ZShmbi5iaW5kKHRoaXMsIGEsIGIsIGMpKTtcbiAgfTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfLyddID1cbkJveC5wcm90b3R5cGUuZmxvb3JEaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSB8IDAsXG4gICAgaGVpZ2h0OiB0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnXi8nXSA9XG5Cb3gucHJvdG90eXBlLmNlaWxkaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWycqJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogdGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKVxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14qJ10gPVxuQm94LnByb3RvdHlwZS5tdWwgPSBmdW5jdGlvbihiKSB7XG4gIHJldHVybiBuZXcgQm94KHtcbiAgICB3aWR0aDogTWF0aC5jZWlsKHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkpLFxuICAgIGhlaWdodDogTWF0aC5jZWlsKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydvKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGgucm91bmQodGhpcy53aWR0aCAqIChiLndpZHRoIHx8IGIueCB8fCAwKSksXG4gICAgaGVpZ2h0OiBNYXRoLnJvdW5kKHRoaXMuaGVpZ2h0ICogKGIuaGVpZ2h0IHx8IGIueSB8fCAwKSlcbiAgfSk7XG59O1xuXG5Cb3gucHJvdG90eXBlWydfKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiAoYi53aWR0aCB8fCBiLnggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgKiAoYi5oZWlnaHQgfHwgYi55IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJy0nXSA9XG5Cb3gucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKGIpIHtcbiAgcmV0dXJuIG5ldyBCb3goe1xuICAgIHdpZHRoOiB0aGlzLndpZHRoIC0gKGIud2lkdGggfHwgYi54IHx8IDApLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSAoYi5oZWlnaHQgfHwgYi55IHx8IDApXG4gIH0pO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjbG9uZShvYmopIHtcbiAgdmFyIG8gPSB7fTtcbiAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgIHZhciB2YWwgPSBvYmpba2V5XTtcbiAgICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiB2YWwpIHtcbiAgICAgIG9ba2V5XSA9IGNsb25lKHZhbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG9ba2V5XSA9IHZhbDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG87XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24gZGVib3VuY2VXcmFwKGEsIGIsIGMsIGQpIHtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgdGltZW91dCA9IHNldFRpbWVvdXQoZm4uYmluZCh0aGlzLCBhLCBiLCBjLCBkKSwgbXMpO1xuICAgIHJldHVybiB0aW1lb3V0O1xuICB9XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uL2RvbScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vZXZlbnQnKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpYWxvZztcblxuZnVuY3Rpb24gRGlhbG9nKGxhYmVsLCBrZXltYXApIHtcbiAgdGhpcy5ub2RlID0gZG9tKGNzcy5kaWFsb2csIFtcbiAgICBgPGxhYmVsPiR7Y3NzLmxhYmVsfWAsXG4gICAgW2Nzcy5pbnB1dCwgW1xuICAgICAgYDxpbnB1dD4ke2Nzcy50ZXh0fWAsXG4gICAgICBjc3MuaW5mb1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGVbY3NzLmxhYmVsXSwgbGFiZWwpO1xuICBkb20uc3R5bGUodGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLmluZm9dLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25jbGljayA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5vbm1vdXNlZG93biA9IHN0b3BQcm9wYWdhdGlvbjtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF0uZWwub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5pc09wZW4gPSBmYWxzZTtcbn1cblxuRGlhbG9nLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbmZ1bmN0aW9uIHN0b3BQcm9wYWdhdGlvbihlKSB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmhhc0ZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLm5vZGVbY3NzLmlucHV0XS5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgdGhpcy5vbmJvZHlrZXlkb3duKTtcbiAgZG9tLmFwcGVuZChkb2N1bWVudC5ib2R5LCB0aGlzLm5vZGUpO1xuICBkb20uZm9jdXModGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdKTtcbiAgdGhpcy5ub2RlW2Nzcy5pbnB1dF1bY3NzLnRleHRdLmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy50ZXh0XS5lbC52YWx1ZSk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLmluZm8gPSBmdW5jdGlvbihpbmZvKSB7XG4gIGRvbS50ZXh0KHRoaXMubm9kZVtjc3MuaW5wdXRdW2Nzcy5pbmZvXSwgaW5mbyk7XG4gIGRvbS5zdHlsZSh0aGlzLm5vZGVbY3NzLmlucHV0XVtjc3MuaW5mb10sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XCJkaWFsb2dcIjpcIl9saWJfZGlhbG9nX3N0eWxlX19kaWFsb2dcIixcImlucHV0XCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5wdXRcIixcInRleHRcIjpcIl9saWJfZGlhbG9nX3N0eWxlX190ZXh0XCIsXCJsYWJlbFwiOlwiX2xpYl9kaWFsb2dfc3R5bGVfX2xhYmVsXCIsXCJpbmZvXCI6XCJfbGliX2RpYWxvZ19zdHlsZV9faW5mb1wifSIsIlxubW9kdWxlLmV4cG9ydHMgPSBkaWZmO1xuXG5mdW5jdGlvbiBkaWZmKGEsIGIpIHtcbiAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgYSkge1xuICAgIHZhciBkID0ge307XG4gICAgdmFyIGkgPSAwO1xuICAgIGZvciAodmFyIGsgaW4gYikge1xuICAgICAgaWYgKGFba10gIT09IGJba10pIHtcbiAgICAgICAgZFtrXSA9IGJba107XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGkpIHJldHVybiBkO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhICE9PSBiO1xuICB9XG59XG4iLCJ2YXIgUG9pbnQgPSByZXF1aXJlKCcuL3BvaW50Jyk7XG52YXIgYXRvbWljID0gcmVxdWlyZSgnLi9hdG9taWMnKTtcbnZhciBtZW1vaXplID0gcmVxdWlyZSgnLi9tZW1vaXplJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuL21lcmdlJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWUuc3BsaXQoJyAnKVswXVxuICAgIH07XG4gICAgZG9tLmNsYXNzZXMobm9kZSwgbmFtZS5zcGxpdCgnICcpLnNsaWNlKDEpKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59LCBkaWZmLCBtZXJnZSwgZnVuY3Rpb24obm9kZSwgc3R5bGUpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIHN0eWxlXTtcbn0pO1xuXG4vKlxuZG9tLnN0eWxlID0gZnVuY3Rpb24oZWwsIHN0eWxlKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBmb3IgKHZhciBuYW1lIGluIHN0eWxlKVxuICAgIGlmIChuYW1lIGluIHVuaXRzKVxuICAgICAgc3R5bGVbbmFtZV0gKz0gdW5pdHNbbmFtZV07XG4gIE9iamVjdC5hc3NpZ24oZWwuc3R5bGUsIHN0eWxlKTtcbn07XG4qL1xuZG9tLmNsYXNzZXMgPSBtZW1vaXplKGZ1bmN0aW9uKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xufSwgbnVsbCwgbnVsbCwgZnVuY3Rpb24obm9kZSwgY2xhc3Nlcykge1xuICB2YXIgZWwgPSBkb20uZ2V0RWxlbWVudChub2RlKTtcbiAgcmV0dXJuIFtlbCwgY2xhc3Nlcy5jb25jYXQobm9kZS5uYW1lKS5maWx0ZXIoQm9vbGVhbikuam9pbignICcpXTtcbn0pO1xuXG5kb20uYXR0cnMgPSBmdW5jdGlvbihlbCwgYXR0cnMpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIE9iamVjdC5hc3NpZ24oZWwsIGF0dHJzKTtcbn07XG5cbmRvbS5odG1sID0gZnVuY3Rpb24oZWwsIGh0bWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLmlubmVySFRNTCA9IGh0bWw7XG59O1xuXG5kb20udGV4dCA9IGZ1bmN0aW9uKGVsLCB0ZXh0KSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC50ZXh0Q29udGVudCA9IHRleHQ7XG59O1xuXG5kb20uZm9jdXMgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuZm9jdXMoKTtcbn07XG5cbmRvbS5nZXRTaXplID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiB7XG4gICAgd2lkdGg6IGVsLmNsaWVudFdpZHRoLFxuICAgIGhlaWdodDogZWwuY2xpZW50SGVpZ2h0XG4gIH07XG59O1xuXG5kb20uZ2V0Q2hhclNpemUgPSBmdW5jdGlvbihlbCwgY2xhc3NOYW1lKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcbiAgc3Bhbi5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG5cbiAgZWwuYXBwZW5kQ2hpbGQoc3Bhbik7XG5cbiAgc3Bhbi5pbm5lckhUTUwgPSAnICc7XG4gIHZhciBhID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgIFxcbiAnO1xuICB2YXIgYiA9IHNwYW4uZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG5cbiAgZWwucmVtb3ZlQ2hpbGQoc3Bhbik7XG5cbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogKGIud2lkdGggLSBhLndpZHRoKSxcbiAgICBoZWlnaHQ6IChiLmhlaWdodCAtIGEuaGVpZ2h0KVxuICB9O1xufTtcblxuZG9tLmdldE9mZnNldCA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB2YXIgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShlbCk7XG4gIHZhciBib3JkZXJMZWZ0ID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyTGVmdFdpZHRoKTtcbiAgdmFyIGJvcmRlclRvcCA9IHBhcnNlSW50KHN0eWxlLmJvcmRlclRvcFdpZHRoKTtcbiAgcmV0dXJuIFBvaW50Lmxvdyh7IHg6IDAsIHk6IDAgfSwge1xuICAgIHg6IChyZWN0LmxlZnQgKyBib3JkZXJMZWZ0KSB8IDAsXG4gICAgeTogKHJlY3QudG9wICsgYm9yZGVyVG9wKSB8IDBcbiAgfSk7XG59O1xuXG5kb20uZ2V0U2Nyb2xsID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHJldHVybiBnZXRTY3JvbGwoZWwpO1xufTtcblxuZG9tLm9uc2Nyb2xsID0gZnVuY3Rpb24gb25zY3JvbGwoZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuXG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9IGVsc2Uge1xuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGhhbmRsZXIpO1xuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlcihldikge1xuICAgIGZuKGdldFNjcm9sbChlbCkpO1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9mZnNjcm9sbCgpIHtcbiAgICBlbC5yZW1vdmVFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBoYW5kbGVyKTtcbiAgfVxufTtcblxuZG9tLm9ub2Zmc2V0ID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB3aGlsZSAoZWwgPSBlbC5vZmZzZXRQYXJlbnQpIHtcbiAgICBkb20ub25zY3JvbGwoZWwsIGZuKTtcbiAgfVxufTtcblxuZG9tLm9uY2xpY2sgPSBmdW5jdGlvbihlbCwgZm4pIHtcbiAgcmV0dXJuIGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZm4pO1xufTtcblxuZG9tLm9ucmVzaXplID0gZnVuY3Rpb24oZm4pIHtcbiAgcmV0dXJuIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdyZXNpemUnLCBmbik7XG59O1xuXG5kb20uYXBwZW5kID0gZnVuY3Rpb24odGFyZ2V0LCBzcmMsIGRpY3QpIHtcbiAgdGFyZ2V0ID0gZG9tLmdldEVsZW1lbnQodGFyZ2V0KTtcbiAgaWYgKCdmb3JFYWNoJyBpbiBzcmMpIHNyYy5mb3JFYWNoKGRvbS5hcHBlbmQuYmluZChudWxsLCB0YXJnZXQpKTtcbiAgLy8gZWxzZSBpZiAoJ3ZpZXdzJyBpbiBzcmMpIGRvbS5hcHBlbmQodGFyZ2V0LCBzcmMudmlld3MsIHRydWUpO1xuICBlbHNlIGlmIChkaWN0ID09PSB0cnVlKSBmb3IgKHZhciBrZXkgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjW2tleV0pO1xuICBlbHNlIGlmICgnZnVuY3Rpb24nICE9IHR5cGVvZiBzcmMpIHRhcmdldC5hcHBlbmRDaGlsZChkb20uZ2V0RWxlbWVudChzcmMpKTtcbn07XG5cbmRvbS5yZW1vdmUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgaWYgKGVsLnBhcmVudE5vZGUpIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpO1xufTtcblxuZG9tLmdldEVsZW1lbnQgPSBmdW5jdGlvbihlbCkge1xuICByZXR1cm4gZWwuZG9tICYmIGVsLmRvbS5lbCB8fCBlbC5lbCB8fCBlbC5ub2RlIHx8IGVsO1xufTtcblxuZG9tLnNjcm9sbEJ5ID0gZnVuY3Rpb24oZWwsIHgsIHksIHNjcm9sbCkge1xuICBzY3JvbGwgPSBzY3JvbGwgfHwgZG9tLmdldFNjcm9sbChlbCk7XG4gIGRvbS5zY3JvbGxUbyhlbCwgc2Nyb2xsLnggKyB4LCBzY3JvbGwueSArIHkpO1xufTtcblxuZG9tLnNjcm9sbFRvID0gZnVuY3Rpb24oZWwsIHgsIHkpIHtcbiAgaWYgKGRvY3VtZW50LmJvZHkgPT09IGVsKSB7XG4gICAgd2luZG93LnNjcm9sbFRvKHgsIHkpO1xuICB9IGVsc2Uge1xuICAgIGVsLnNjcm9sbExlZnQgPSB4IHx8IDA7XG4gICAgZWwuc2Nyb2xsVG9wID0geSB8fCAwO1xuICB9XG59O1xuXG5kb20uY3NzID0gYXRvbWljKGZ1bmN0aW9uKGlkLCBjc3NUZXh0KSB7XG4gIGlmICghKGlkIGluIGRvbS5jc3Muc3R5bGVzKSkge1xuICAgIGRvbS5jc3Muc3R5bGVzW2lkXSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlc1tpZF0pO1xuICB9XG4gIGRvbS5jc3Muc3R5bGVzW2lkXS50ZXh0Q29udGVudCA9IGNzc1RleHQ7XG59KTtcblxuZG9tLmNzcy5zdHlsZXMgPSB7fTtcblxuZG9tLmdldE1vdXNlUG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuXG5mdW5jdGlvbiBnZXRTY3JvbGwoZWwpIHtcbiAgcmV0dXJuIGRvY3VtZW50LmJvZHkgPT09IGVsXG4gICAgPyB7XG4gICAgICAgIHg6IHdpbmRvdy5zY3JvbGxYIHx8IGVsLnNjcm9sbExlZnQgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbExlZnQsXG4gICAgICAgIHk6IHdpbmRvdy5zY3JvbGxZIHx8IGVsLnNjcm9sbFRvcCAgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbFRvcFxuICAgICAgfVxuICAgIDoge1xuICAgICAgICB4OiBlbC5zY3JvbGxMZWZ0LFxuICAgICAgICB5OiBlbC5zY3JvbGxUb3BcbiAgICAgIH07XG59XG4iLCJcbnZhciBwdXNoID0gW10ucHVzaDtcbnZhciBzbGljZSA9IFtdLnNsaWNlO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50O1xuXG5mdW5jdGlvbiBFdmVudCgpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEV2ZW50KSkgcmV0dXJuIG5ldyBFdmVudDtcblxuICB0aGlzLl9oYW5kbGVycyA9IHt9O1xufVxuXG5FdmVudC5wcm90b3R5cGUuX2dldEhhbmRsZXJzID0gZnVuY3Rpb24obmFtZSkge1xuICB0aGlzLl9oYW5kbGVycyA9IHRoaXMuX2hhbmRsZXJzIHx8IHt9O1xuICByZXR1cm4gdGhpcy5faGFuZGxlcnNbbmFtZV0gPSB0aGlzLl9oYW5kbGVyc1tuYW1lXSB8fCBbXTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24obmFtZSwgYSwgYiwgYywgZCkge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBoYW5kbGVycy5sZW5ndGg7IGkrKykge1xuICAgIGhhbmRsZXJzW2ldKGEsIGIsIGMsIGQpO1xuICB9O1xufTtcblxuRXZlbnQucHJvdG90eXBlLm9uID0gZnVuY3Rpb24obmFtZSkge1xuICB2YXIgaGFuZGxlcnM7XG4gIHZhciBuZXdIYW5kbGVycyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgaWYgKEFycmF5LmlzQXJyYXkobmFtZSkpIHtcbiAgICBuYW1lLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgICAgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgICAgIHB1c2guYXBwbHkoaGFuZGxlcnMsIG5ld0hhbmRsZXJzW25hbWVdKTtcbiAgICB9LCB0aGlzKTtcbiAgfSBlbHNlIHtcbiAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgIHB1c2guYXBwbHkoaGFuZGxlcnMsIG5ld0hhbmRsZXJzKTtcbiAgfVxufTtcblxuRXZlbnQucHJvdG90eXBlLm9mZiA9IGZ1bmN0aW9uKG5hbWUsIGhhbmRsZXIpIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBpbmRleCA9IGhhbmRsZXJzLmluZGV4T2YoaGFuZGxlcik7XG4gIGlmICh+aW5kZXgpIGhhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG59O1xuXG5FdmVudC5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKG5hbWUsIGZuKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICB2YXIgaGFuZGxlciA9IGZ1bmN0aW9uKGEsIGIsIGMsIGQpIHtcbiAgICBmbihhLCBiLCBjLCBkKTtcbiAgICBoYW5kbGVycy5zcGxpY2UoaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKSwgMSk7XG4gIH07XG4gIGhhbmRsZXJzLnB1c2goaGFuZGxlcik7XG59O1xuIiwidmFyIGNsb25lID0gcmVxdWlyZSgnLi9jbG9uZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1lbW9pemUoZm4sIGRpZmYsIG1lcmdlLCBwcmUpIHtcbiAgZGlmZiA9IGRpZmYgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYSAhPT0gYiB9O1xuICBtZXJnZSA9IG1lcmdlIHx8IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIGIgfTtcbiAgcHJlID0gcHJlIHx8IGZ1bmN0aW9uKG5vZGUsIHBhcmFtKSB7IHJldHVybiBwYXJhbSB9O1xuXG4gIHZhciBub2RlcyA9IFtdO1xuICB2YXIgY2FjaGUgPSBbXTtcbiAgdmFyIHJlc3VsdHMgPSBbXTtcblxuICByZXR1cm4gZnVuY3Rpb24obm9kZSwgcGFyYW0pIHtcbiAgICB2YXIgYXJncyA9IHByZShub2RlLCBwYXJhbSk7XG4gICAgbm9kZSA9IGFyZ3NbMF07XG4gICAgcGFyYW0gPSBhcmdzWzFdO1xuXG4gICAgdmFyIGluZGV4ID0gbm9kZXMuaW5kZXhPZihub2RlKTtcbiAgICBpZiAofmluZGV4KSB7XG4gICAgICB2YXIgZCA9IGRpZmYoY2FjaGVbaW5kZXhdLCBwYXJhbSk7XG4gICAgICBpZiAoIWQpIHJldHVybiByZXN1bHRzW2luZGV4XTtcbiAgICAgIGVsc2Uge1xuICAgICAgICBjYWNoZVtpbmRleF0gPSBtZXJnZShjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgICAgcmVzdWx0c1tpbmRleF0gPSBmbihub2RlLCBwYXJhbSwgZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhY2hlLnB1c2goY2xvbmUocGFyYW0pKTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBpbmRleCA9IHJlc3VsdHMucHVzaChmbihub2RlLCBwYXJhbSwgcGFyYW0pKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0c1tpbmRleF07XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG1lcmdlKGRlc3QsIHNyYykge1xuICBmb3IgKHZhciBrZXkgaW4gc3JjKSB7XG4gICAgZGVzdFtrZXldID0gc3JjW2tleV07XG4gIH1cbiAgcmV0dXJuIGRlc3Q7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IG9wZW47XG5cbmZ1bmN0aW9uIG9wZW4odXJsLCBjYikge1xuICByZXR1cm4gZmV0Y2godXJsKVxuICAgIC50aGVuKGdldFRleHQpXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuXG5mdW5jdGlvbiBnZXRUZXh0KHJlcykge1xuICByZXR1cm4gcmVzLnRleHQoKTtcbn1cbiIsInZhciBUT0tFTlMgPSAvLis/XFxifC5cXEJ8XFxiLis/L2c7XG52YXIgV09SRCA9IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvZztcblxudmFyIHBhcnNlID0gZXhwb3J0cztcblxucGFyc2Uud29yZHMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICB3aGlsZSAod29yZCA9IFdPUkQuZXhlYyhzKSkge1xuICAgIHdvcmRzLnB1c2god29yZCk7XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuXG5wYXJzZS50b2tlbnMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICB3aGlsZSAod29yZCA9IFRPS0VOUy5leGVjKHMpKSB7XG4gICAgd29yZHMucHVzaCh3b3JkKTtcbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gUG9pbnQ7XG5cbmZ1bmN0aW9uIFBvaW50KHApIHtcbiAgaWYgKHApIHtcbiAgICB0aGlzLnggPSBwLng7XG4gICAgdGhpcy55ID0gcC55O1xuICB9IGVsc2Uge1xuICAgIHRoaXMueCA9IDA7XG4gICAgdGhpcy55ID0gMDtcbiAgfVxufVxuXG5Qb2ludC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLnggPSBwLng7XG4gIHRoaXMueSA9IHAueTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUG9pbnQodGhpcyk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLyddID1cblBvaW50LnByb3RvdHlwZS5kaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfLyddID1cblBvaW50LnByb3RvdHlwZS5mbG9vckRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnby8nXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmREaXYgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydeLyddID1cblBvaW50LnByb3RvdHlwZS5jZWlsRGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLmNlaWwodGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLmNlaWwodGhpcy55IC8gKHAueSB8fCBwLmhlaWdodCB8fCAwKSlcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJysnXSA9XG5Qb2ludC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKyAocC54IHx8IHAud2lkdGggfHwgMCksXG4gICAgeTogdGhpcy55ICsgKHAueSB8fCBwLmhlaWdodCB8fCAwKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnLSddID1cblBvaW50LnByb3RvdHlwZS5zdWIgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCAtIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgLSAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWycqJ10gPVxuUG9pbnQucHJvdG90eXBlLm11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJ14qJ10gPVxuUG9pbnQucHJvdG90eXBlLmNlaWxNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGguY2VpbCh0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkpLFxuICAgIHk6IE1hdGguY2VpbCh0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnbyonXSA9XG5Qb2ludC5wcm90b3R5cGUucm91bmRNdWwgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgucm91bmQodGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICB5OiBNYXRoLnJvdW5kKHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWydfKiddID1cblBvaW50LnByb3RvdHlwZS5mbG9vck11bCA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54ICogKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgKiAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gJ3g6JyArIHRoaXMueCArICcseTonICsgdGhpcy55O1xufTtcblxuUG9pbnQuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblBvaW50LmdyaWRSb3VuZCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLnJvdW5kKGEueCAvIGIud2lkdGgpLFxuICAgIHk6IE1hdGgucm91bmQoYS55IC8gYi5oZWlnaHQpXG4gIH07XG59O1xuXG5Qb2ludC5sb3cgPSBmdW5jdGlvbihsb3csIHApIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLm1heChsb3cueCwgcC54KSxcbiAgICB5OiBNYXRoLm1heChsb3cueSwgcC55KVxuICB9O1xufTtcblxuUG9pbnQuY2xhbXAgPSBmdW5jdGlvbihhcmVhLCBwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IE1hdGgubWluKGFyZWEuZW5kLngsIE1hdGgubWF4KGFyZWEuYmVnaW4ueCwgcC54KSksXG4gICAgeTogTWF0aC5taW4oYXJlYS5lbmQueSwgTWF0aC5tYXgoYXJlYS5iZWdpbi55LCBwLnkpKVxuICB9KTtcbn07XG5cblBvaW50Lm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHsgeDogYS54ICsgYi54LCB5OiBhLnkgKyBiLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFggPSBmdW5jdGlvbih4LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCArIHgsIHk6IHAueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIHApIHtcbiAgcmV0dXJuIHsgeDogcC54LCB5OiBwLnkgKyB5IH07XG59O1xuXG5Qb2ludC50b0xlZnRUb3AgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiB7XG4gICAgbGVmdDogcC54LFxuICAgIHRvcDogcC55XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEFORDtcblxuZnVuY3Rpb24gQU5EKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IE5PVDtcblxuZnVuY3Rpb24gTk9UKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsInZhciBBTkQgPSByZXF1aXJlKCcuL3JhbmdlLWdhdGUtYW5kJyk7XG52YXIgTk9UID0gcmVxdWlyZSgnLi9yYW5nZS1nYXRlLW5vdCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJhbmdlO1xuXG5mdW5jdGlvbiBSYW5nZShyKSB7XG4gIGlmIChyKSB7XG4gICAgdGhpc1swXSA9IHJbMF07XG4gICAgdGhpc1sxXSA9IHJbMV07XG4gIH0gZWxzZSB7XG4gICAgdGhpc1swXSA9IDA7XG4gICAgdGhpc1sxXSA9IDE7XG4gIH1cbn07XG5cblJhbmdlLkFORCA9IEFORDtcblJhbmdlLk5PVCA9IE5PVDtcblxuUmFuZ2Uuc29ydCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEueSA9PT0gYi55XG4gICAgPyBhLnggLSBiLnhcbiAgICA6IGEueSAtIGIueTtcbn07XG5cblJhbmdlLmVxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYVswXSA9PT0gYlswXSAmJiBhWzFdID09PSBiWzFdO1xufTtcblxuUmFuZ2UuY2xhbXAgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBuZXcgUmFuZ2UoW1xuICAgIE1hdGgubWluKGJbMV0sIE1hdGgubWF4KGFbMF0sIGJbMF0pKSxcbiAgICBNYXRoLm1pbihhWzFdLCBiWzFdKVxuICBdKTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFJhbmdlKHRoaXMpO1xufTtcblxuUmFuZ2UucmFuZ2VzID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbihpdGVtKSB7IHJldHVybiBpdGVtLnJhbmdlIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLmluc2lkZSA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdID49IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPD0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm92ZXJsYXAgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVswXSA8PSByYW5nZVswXSAmJiBpdGVtLnJhbmdlWzFdID49IHJhbmdlWzFdO1xuICB9KTtcbn07XG5cblJhbmdlLnByb3RvdHlwZS5vdXRzaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMV0gPCByYW5nZVswXSB8fCBpdGVtLnJhbmdlWzBdID4gcmFuZ2VbMV07XG4gIH0pO1xufTtcbiIsIlxudmFyIFJlZ2V4cCA9IGV4cG9ydHM7XG5cblJlZ2V4cC5jcmVhdGUgPSBmdW5jdGlvbihuYW1lcywgZmxhZ3MsIGZuKSB7XG4gIGZuID0gZm4gfHwgZnVuY3Rpb24ocykgeyByZXR1cm4gcyB9O1xuICByZXR1cm4gbmV3IFJlZ0V4cChcbiAgICBuYW1lc1xuICAgIC5tYXAoKG4pID0+ICdzdHJpbmcnID09PSB0eXBlb2YgbiA/IFJlZ2V4cC50eXBlc1tuXSA6IG4pXG4gICAgLm1hcCgocikgPT4gZm4oci50b1N0cmluZygpLnNsaWNlKDEsLTEpKSlcbiAgICAuam9pbignfCcpLFxuICAgIGZsYWdzXG4gICk7XG59O1xuXG5SZWdleHAudHlwZXMgPSB7XG4gICd0b2tlbnMnOiAvLis/XFxifC5cXEJ8XFxiLis/LyxcbiAgJ3dvcmRzJzogL1thLXpBLVowLTldezEsfS8sXG4gICdwYXJ0cyc6IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvLFxuXG4gICdzaW5nbGUgY29tbWVudCc6IC9cXC9cXC8uKj8kLyxcbiAgJ2RvdWJsZSBjb21tZW50JzogL1xcL1xcKlteXSo/XFwqXFwvLyxcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiAvKCcoPzooPzpcXFxcXFxufFxcXFwnfFteJ1xcbl0pKSo/JykvLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IC8oXCIoPzooPzpcXFxcXFxufFxcXFxcInxbXlwiXFxuXSkpKj9cIikvLFxuICAndGVtcGxhdGUgc3RyaW5nJzogLyhgKD86KD86XFxcXGB8W15gXSkpKj9gKS8sXG5cbiAgJ29wZXJhdG9yJzogLyF8Pj0/fDw9P3w9ezEsM318KD86Jil7MSwyfXxcXHw/XFx8fFxcP3xcXCp8XFwvfH58XFxefCV8XFwuKD8hXFxkKXxcXCt7MSwyfXxcXC17MSwyfS8sXG4gICdmdW5jdGlvbic6IC8gKCg/IVxcZHxbLiBdKj8oaWZ8ZWxzZXxkb3xmb3J8Y2FzZXx0cnl8Y2F0Y2h8d2hpbGV8d2l0aHxzd2l0Y2gpKVthLXpBLVowLTlfICRdKykoPz1cXCguKlxcKS4qeykvLFxuICAna2V5d29yZCc6IC9cXGIoYnJlYWt8Y2FzZXxjYXRjaHxjb25zdHxjb250aW51ZXxkZWJ1Z2dlcnxkZWZhdWx0fGRlbGV0ZXxkb3xlbHNlfGV4cG9ydHxleHRlbmRzfGZpbmFsbHl8Zm9yfGZyb218aWZ8aW1wbGVtZW50c3xpbXBvcnR8aW58aW5zdGFuY2VvZnxpbnRlcmZhY2V8bGV0fG5ld3xwYWNrYWdlfHByaXZhdGV8cHJvdGVjdGVkfHB1YmxpY3xyZXR1cm58c3RhdGljfHN1cGVyfHN3aXRjaHx0aHJvd3x0cnl8dHlwZW9mfHdoaWxlfHdpdGh8eWllbGQpXFxiLyxcbiAgJ2RlY2xhcmUnOiAvXFxiKGZ1bmN0aW9ufGludGVyZmFjZXxjbGFzc3x2YXJ8bGV0fGNvbnN0fGVudW18dm9pZClcXGIvLFxuICAnYnVpbHRpbic6IC9cXGIoT2JqZWN0fEZ1bmN0aW9ufEJvb2xlYW58RXJyb3J8RXZhbEVycm9yfEludGVybmFsRXJyb3J8UmFuZ2VFcnJvcnxSZWZlcmVuY2VFcnJvcnxTdG9wSXRlcmF0aW9ufFN5bnRheEVycm9yfFR5cGVFcnJvcnxVUklFcnJvcnxOdW1iZXJ8TWF0aHxEYXRlfFN0cmluZ3xSZWdFeHB8QXJyYXl8RmxvYXQzMkFycmF5fEZsb2F0NjRBcnJheXxJbnQxNkFycmF5fEludDMyQXJyYXl8SW50OEFycmF5fFVpbnQxNkFycmF5fFVpbnQzMkFycmF5fFVpbnQ4QXJyYXl8VWludDhDbGFtcGVkQXJyYXl8QXJyYXlCdWZmZXJ8RGF0YVZpZXd8SlNPTnxJbnRsfGFyZ3VtZW50c3xjb25zb2xlfHdpbmRvd3xkb2N1bWVudHxTeW1ib2x8U2V0fE1hcHxXZWFrU2V0fFdlYWtNYXB8UHJveHl8UmVmbGVjdHxQcm9taXNlKVxcYi8sXG4gICdzcGVjaWFsJzogL1xcYih0cnVlfGZhbHNlfG51bGx8dW5kZWZpbmVkKVxcYi8sXG4gICdwYXJhbXMnOiAvZnVuY3Rpb25bIFxcKF17MX1bXl0qP1xcey8sXG4gICdudW1iZXInOiAvLT9cXGIoMHhbXFxkQS1GYS1mXSt8XFxkKlxcLj9cXGQrKFtFZV1bKy1dP1xcZCspP3xOYU58LT9JbmZpbml0eSlcXGIvLFxuICAnc3ltYm9sJzogL1t7fVtcXF0oKSw6XS8sXG4gICdyZWdleHAnOiAvKD8hW15cXC9dKShcXC8oPyFbXFwvfFxcKl0pLio/W15cXFxcXFxeXVxcLykoWztcXG5cXC5cXClcXF1cXH0gZ2ltXSkvLFxuXG4gICd4bWwnOiAvPFtePl0qPi8sXG4gICd1cmwnOiAvKChcXHcrOlxcL1xcLylbLWEtekEtWjAtOTpAOz8mPVxcLyVcXCtcXC5cXCohJ1xcKFxcKSxcXCRfXFx7XFx9XFxeflxcW1xcXWAjfF0rKS8sXG4gICdpbmRlbnQnOiAvXiArLyxcbiAgJ2xpbmUnOiAvXi4rJHxeXFxuLyxcbiAgJ25ld2xpbmUnOiAvXFxyXFxufFxccnxcXG4vLFxufTtcblxuUmVnZXhwLnR5cGVzLmNvbW1lbnQgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBjb21tZW50JyxcbiAgJ2RvdWJsZSBjb21tZW50Jyxcbl0pO1xuXG5SZWdleHAudHlwZXMuc3RyaW5nID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbl0pO1xuXG5SZWdleHAudHlwZXMubXVsdGlsaW5lID0gUmVnZXhwLmNyZWF0ZShbXG4gICdkb3VibGUgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuICAnaW5kZW50JyxcbiAgJ2xpbmUnXG5dKTtcblxuUmVnZXhwLnBhcnNlID0gZnVuY3Rpb24ocywgcmVnZXhwLCBmaWx0ZXIpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIGlmIChmaWx0ZXIpIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICBpZiAoZmlsdGVyKHdvcmQpKSB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gc2F2ZTtcblxuZnVuY3Rpb24gc2F2ZSh1cmwsIHNyYywgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBib2R5OiBzcmMsXG4gICAgfSlcbiAgICAudGhlbihjYi5iaW5kKG51bGwsIG51bGwpKVxuICAgIC5jYXRjaChjYik7XG59XG4iLCIvLyBOb3RlOiBZb3UgcHJvYmFibHkgZG8gbm90IHdhbnQgdG8gdXNlIHRoaXMgaW4gcHJvZHVjdGlvbiBjb2RlLCBhcyBQcm9taXNlIGlzXG4vLyAgIG5vdCBzdXBwb3J0ZWQgYnkgYWxsIGJyb3dzZXJzIHlldC5cblxuKGZ1bmN0aW9uKCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgaWYgKHdpbmRvdy5zZXRJbW1lZGlhdGUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBwZW5kaW5nID0ge30sXG4gICAgICAgIG5leHRIYW5kbGUgPSAxO1xuXG4gICAgZnVuY3Rpb24gb25SZXNvbHZlKGhhbmRsZSkge1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBwZW5kaW5nW2hhbmRsZV07XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgZGVsZXRlIHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgICAgIGNhbGxiYWNrLmZuLmFwcGx5KG51bGwsIGNhbGxiYWNrLmFyZ3MpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd2luZG93LnNldEltbWVkaWF0ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgICAgIGhhbmRsZTtcblxuICAgICAgICBpZiAodHlwZW9mIGZuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJpbnZhbGlkIGZ1bmN0aW9uXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaGFuZGxlID0gbmV4dEhhbmRsZSsrO1xuICAgICAgICBwZW5kaW5nW2hhbmRsZV0gPSB7IGZuOiBmbiwgYXJnczogYXJncyB9O1xuXG4gICAgICAgIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgICAgIHJlc29sdmUoaGFuZGxlKTtcbiAgICAgICAgfSkudGhlbihvblJlc29sdmUpO1xuXG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcblxuICAgIHdpbmRvdy5jbGVhckltbWVkaWF0ZSA9IGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgIH07XG59KCkpOyIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHJ1bm5pbmcsIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGEsIGIsIGMpIHtcbiAgICBpZiAocnVubmluZykgcmV0dXJuO1xuICAgIHJ1bm5pbmcgPSB0cnVlO1xuICAgIGZuLmNhbGwodGhpcywgYSwgYiwgYyk7XG4gICAgc2V0VGltZW91dChyZXNldCwgbXMpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlc2V0KCkge1xuICAgIHJ1bm5pbmcgPSBmYWxzZTtcbiAgfVxufTtcbiIsIlxudmFyIHRyaW0gPSBleHBvcnRzO1xuXG50cmltLmVtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciB0cmFpbGluZyA9IHRyaW0udHJhaWxpbmdFbXB0eUxpbmVzKHMpO1xuICB2YXIgbGVhZGluZyA9IHRyaW0ubGVhZGluZ0VtcHR5TGluZXModHJhaWxpbmcuc3RyaW5nKTtcbiAgcmV0dXJuIHtcbiAgICB0cmFpbGluZzogdHJhaWxpbmcucmVtb3ZlZCxcbiAgICBsZWFkaW5nOiBsZWFkaW5nLnJlbW92ZWQsXG4gICAgcmVtb3ZlZDogdHJhaWxpbmcucmVtb3ZlZCArIGxlYWRpbmcucmVtb3ZlZCxcbiAgICBzdHJpbmc6IGxlYWRpbmcuc3RyaW5nXG4gIH07XG59O1xuXG50cmltLnRyYWlsaW5nRW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIGluZGV4ID0gcy5sZW5ndGg7XG4gIHZhciBsYXN0SW5kZXggPSBpbmRleDtcbiAgdmFyIG4gPSAwO1xuICB3aGlsZSAoXG4gICAgfihpbmRleCA9IHMubGFzdEluZGV4T2YoJ1xcbicsIGxhc3RJbmRleCAtIDEpKVxuICAgICYmIGluZGV4IC0gbGFzdEluZGV4ID09PSAtMSkge1xuICAgIG4rKztcbiAgICBsYXN0SW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIGlmIChuKSBzID0gcy5zbGljZSgwLCBsYXN0SW5kZXgpO1xuXG4gIHJldHVybiB7XG4gICAgcmVtb3ZlZDogbixcbiAgICBzdHJpbmc6IHNcbiAgfTtcbn07XG5cbnRyaW0ubGVhZGluZ0VtcHR5TGluZXMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciBpbmRleCA9IC0xO1xuICB2YXIgbGFzdEluZGV4ID0gaW5kZXg7XG4gIHZhciBuID0gMDtcblxuICB3aGlsZSAoXG4gICAgfihpbmRleCA9IHMuaW5kZXhPZignXFxuJywgbGFzdEluZGV4ICsgMSkpXG4gICAgJiYgaW5kZXggLSBsYXN0SW5kZXggPT09IDEpIHtcbiAgICBuKys7XG4gICAgbGFzdEluZGV4ID0gaW5kZXg7XG4gIH1cblxuICBpZiAobikgcyA9IHMuc2xpY2UobGFzdEluZGV4ICsgMSk7XG5cbiAgcmV0dXJuIHtcbiAgICByZW1vdmVkOiBuLFxuICAgIHN0cmluZzogc1xuICB9O1xufTtcbiIsInZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRocm90dGxlID0gcmVxdWlyZSgnLi4vLi4vbGliL3Rocm90dGxlJyk7XG52YXIgYXRvbWljID0gcmVxdWlyZSgnLi4vLi4vbGliL2F0b21pYycpO1xudmFyIHBhcnNlID0gcmVxdWlyZSgnLi4vLi4vbGliL3BhcnNlJyk7XG52YXIgQXJlYSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9hcmVhJyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvcmFuZ2UnKTtcbnZhciBSZWdleHAgPSByZXF1aXJlKCcuLi8uLi9saWIvcmVnZXhwJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCcuLi8uLi9saWIvZXZlbnQnKTtcbnZhciBMaW5lcyA9IHJlcXVpcmUoJy4vbGluZXMnKTtcbnZhciBTeW50YXggPSByZXF1aXJlKCcuL3N5bnRheCcpO1xudmFyIFNlZ21lbnRzID0gcmVxdWlyZSgnLi9zZWdtZW50cycpO1xudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBCdWZmZXI7XG5cbnZhciBFT0wgPSBleHBvcnRzLkVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE4gPSBleHBvcnRzLk4gPSAvXFxuL2c7XG52YXIgQ0hVTktfU0laRSA9IGV4cG9ydHMuQ0hVTktfU0laRSA9IDUwMDA7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbmZ1bmN0aW9uIEJ1ZmZlcigpIHtcbiAgdGhpcy5zeW50YXggPSBuZXcgU3ludGF4O1xuICB0aGlzLmluZGV4ZXIgPSBuZXcgSW5kZXhlcih0aGlzKTtcbiAgdGhpcy5zZWdtZW50cyA9IG5ldyBTZWdtZW50cyh0aGlzKTtcbiAgdGhpcy5vbigndXBkYXRlJywgZGVib3VuY2UodGhpcy51cGRhdGVSYXcuYmluZCh0aGlzKSwgMzAwKSk7XG4gIHRoaXMub24oJ3JhdycsIHRoaXMuc2VnbWVudHMuaW5kZXguYmluZCh0aGlzLnNlZ21lbnRzKSk7XG4gIHRoaXMuc2V0KCcnKTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxvYygpIHtcbiAgICByZXR1cm4gdGhpcy5saW5lcy5sZW5ndGg7XG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmICghcmFuZ2UpIHJldHVybiB0aGlzLnRleHQuZ2V0UmFuZ2UoKTtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmxpbmVzLmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxudmFyIEJMT0NLID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG52YXIgQkxPQ0tfRU5EID0ge1xuICAnY29tbWVudCc6ICcqLycsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEhpZ2hsaWdodGVkID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLmdldChyYW5nZSk7XG4gIC8vIHJldHVybiB0aGlzLnN5bnRheC5lbnRpdGllcyhjb2RlKTtcbiAgLy8gcmV0dXJuIHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlKTtcblxuICB2YXIgYmxvY2sgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIC8vIGNvbnNvbGUudGltZUVuZCgnZ2V0IHNlZ21lbnQnKVxuICBpZiAoYmxvY2spIHtcbiAgICBjb2RlID0gQkxPQ0tbYmxvY2tdICsgJ1xcdWZmYmEnICsgY29kZSArICdcXHVmZmJlJyArIEJMT0NLX0VORFtibG9ja107XG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlKTtcbiAgICBjb2RlID0gJzwnICsgYmxvY2sgKyAnPicgK1xuICAgICAgY29kZS5zdWJzdHJpbmcoXG4gICAgICAgIGNvZGUuaW5kZXhPZignXFx1ZmZiYScpICsgMSxcbiAgICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSArICdcXHVmZmJlKi9gJyk7XG4gICAgY29kZSA9IGNvZGUuc3Vic3RyaW5nKFxuICAgICAgMCxcbiAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG4vL1RPRE86IHRoaXMgZGVmZWF0cyB0aGUgcHVycG9zZSBvZiBoYXZpbmcgYSBza2lwbGlzdFxuLy8gbmVlZCB0byBnZXQgcmlkIG9mIGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUudXBkYXRlUmF3ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmF3ID0gdGhpcy5nZXQoKTtcbiAgdGhpcy5lbWl0KCdyYXcnLCB0aGlzLnJhdyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2UocG9pbnQubGluZS5yYW5nZSk7XG4gIHJldHVybiB7XG4gICAgcG9pbnQ6IHBvaW50LFxuICAgIHRleHQ6IHRleHRcbiAgfTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuZ2V0KFt5LHldKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmNoYW5nZXMgPSAwO1xuXG4gIHRoaXMucmF3ID0gdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcbiAgdGhpcy5lbWl0KCdyYXcnLCB0aGlzLnJhdyk7XG5cbiAgdGhpcy50ZXh0ID0gbmV3IFNraXBTdHJpbmcoeyBjaHVua1NpemU6IENIVU5LX1NJWkUgfSk7XG4gIHRoaXMudGV4dC5zZXQodGV4dCk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIHRoaXMubGluZXMgPSBuZXcgTGluZXM7XG4gIHRoaXMubGluZXMuaW5zZXJ0KHsgeDowLCB5OjAgfSwgdGhpcy5yYXcpO1xuXG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHBvaW50LCB0ZXh0LCBzaGlmdCwgaXNDdHJsU2hpZnQpIHtcbiAgdmFyIGlzRU9MLCBsaW5lcywgcmFuZ2UsIGJlZm9yZSwgYWZ0ZXI7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgaWYgKCFpc0N0cmxTaGlmdCkgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICBpc0VPTCA9ICdcXG4nID09PSB0ZXh0O1xuICBzaGlmdCA9ICFpc0N0cmxTaGlmdCAmJiAoc2hpZnQgfHwgaXNFT0wpO1xuXG4gIHBvaW50ID0gdGhpcy5saW5lcy5nZXRQb2ludChwb2ludCk7XG4gIGxpbmVzID0gdGhpcy5saW5lcy5pbnNlcnQocG9pbnQsIHRleHQpO1xuICByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgbGluZXNdO1xuXG4gIGJlZm9yZSA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnRleHQuaW5zZXJ0KHBvaW50Lm9mZnNldCwgdGV4dCk7XG5cbiAgYWZ0ZXIgPSB0aGlzLmdldChyYW5nZSk7XG5cbiAgdGhpcy5wcmVmaXguaW5kZXgoYWZ0ZXIpO1xuICBpZiAoaXNDdHJsU2hpZnQpIHJhbmdlID0gW01hdGgubWF4KDAsIHJhbmdlWzBdLTEpLCByYW5nZVsxXV07XG5cbiAgdGhpcy5zZWdtZW50cy5zaGlmdChwb2ludC5vZmZzZXQsIHRleHQubGVuZ3RoKTtcblxuICAvL1RPRE86IGkgdGhpbmsgc2hpZnQgc2hvdWxkIGJlICdsaW5lcydcbiAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xuXG4gIC8vIHRoaXMgaXMgdG8gdXBkYXRlIGNhcmV0IHBvc2l0aW9uXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQ2hhckF0ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGlzRU9MLCByYW5nZSwgYmVmb3JlLCBhZnRlcjtcblxuICB0aGlzLmNoYW5nZXMrKztcblxuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICBwb2ludCA9IHRoaXMubGluZXMuZ2V0UG9pbnQocG9pbnQpO1xuICBpc0VPTCA9IHRoaXMubGluZXMucmVtb3ZlQ2hhckF0KHBvaW50KTtcbiAgcmFuZ2UgPSBSYW5nZS5jbGFtcChbMCwgdGhpcy5saW5lcy5sZW5ndGhdLCBbcG9pbnQueSwgcG9pbnQueSArIGlzRU9MXSk7XG5cbiAgYmVmb3JlID0gdGhpcy5nZXQocmFuZ2UpO1xuXG4gIHRoaXMudGV4dC5yZW1vdmVDaGFyQXQocG9pbnQub2Zmc2V0KTtcblxuICBhZnRlciA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG5cbiAgdGhpcy5zZWdtZW50cy5zaGlmdChwb2ludC5vZmZzZXQsIC0xKTtcblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCAtaXNFT0wsIGJlZm9yZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBdCA9IGZ1bmN0aW9uKHBvaW50LCBpbmNsdXNpdmUpIHtcbiAgaW5jbHVzaXZlID0gaW5jbHVzaXZlIHx8IDA7XG5cbiAgcG9pbnQgPSB0aGlzLmxpbmVzLmdldFBvaW50KHBvaW50KTtcblxuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLnJhbmdlKTtcblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQXJlYSA9IGZ1bmN0aW9uKGFyZWEsIG5vVXBkYXRlKSB7XG4gIHZhciByYW5nZSwgb2Zmc2V0cywgbGluZXM7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgb2Zmc2V0cyA9IHRoaXMubGluZXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICBsaW5lcyA9IHRoaXMubGluZXMucmVtb3ZlQXJlYShhcmVhKTtcbiAgcmFuZ2UgPSBbYXJlYS5iZWdpbi55LCBhcmVhLmVuZC55XTtcblxuICB0aGlzLnRleHQucmVtb3ZlKG9mZnNldHMpO1xuXG4gIHRoaXMuc2VnbWVudHMuc2hpZnQob2Zmc2V0c1swXSwgb2Zmc2V0c1swXS1vZmZzZXRzWzFdKTtcblxuICBpZiAoIW5vVXBkYXRlKSB7XG4gICAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSk7XG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmxpbmVzLmdldEFyZWFPZmZzZXRSYW5nZShhcmVhKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxuQnVmZmVyLnByb3RvdHlwZS5tb3ZlQXJlYUJ5TGluZXMgPSBmdW5jdGlvbih5LCBhcmVhKSB7XG4gIGlmIChhcmVhLmVuZC54ID4gMCB8fCBhcmVhLmJlZ2luLnkgPT09IGFyZWEuZW5kLnkpIGFyZWEuZW5kLnkgKz0gMTtcbiAgaWYgKGFyZWEuYmVnaW4ueSArIHkgPCAwIHx8IGFyZWEuZW5kLnkgKyB5ID4gdGhpcy5sb2MpIHJldHVybiBmYWxzZTtcblxuICBhcmVhLmJlZ2luLnggPSAwO1xuICBhcmVhLmVuZC54ID0gMDtcblxuICB2YXIgdGV4dCA9IHRoaXMuZ2V0KFthcmVhLmJlZ2luLnksIGFyZWEuZW5kLnktMV0pO1xuICB0aGlzLmRlbGV0ZUFyZWEoYXJlYSwgdHJ1ZSk7XG5cbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6YXJlYS5iZWdpbi55ICsgeSB9LCB0ZXh0LCB5LCB0cnVlKTtcblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUVPTChzKSB7XG4gIHJldHVybiBzLnJlcGxhY2UoZXhwb3J0cy5FT0wsICdcXG4nKTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBJbmRleGVyO1xuXG5mdW5jdGlvbiBJbmRleGVyKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbn1cblxuSW5kZXhlci5wcm90b3R5cGUuZmluZCA9IGZ1bmN0aW9uKHMpIHtcbiAgaWYgKCFzKSByZXR1cm4gW107XG4gIHZhciBvZmZzZXRzID0gW107XG4gIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIucmF3O1xuICB2YXIgbGVuID0gcy5sZW5ndGg7XG4gIHZhciBpbmRleDtcbiAgd2hpbGUgKH4oaW5kZXggPSB0ZXh0LmluZGV4T2YocywgaW5kZXggKyBsZW4pKSkge1xuICAgIG9mZnNldHMucHVzaChpbmRleCk7XG4gIH1cbiAgcmV0dXJuIG9mZnNldHM7XG59O1xuIiwiXG4vKlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXyA9IGNhcmV0XG4gKlxuICogICAwICAgMSAgIDIgICAzICAgNCAgICA1ICAgMCAgIDEgICAyICAgMyAgIDQgICAgNSAgIDAgICAxICAgMlxuICogfCBoIHwgZSB8IGwgfCBsIHwgbyB8IFxcbiB8IHcgfCBvIHwgciB8IGwgfCBkIHwgXFxuIHwgISB8ICEgfCBfIHxcbiAqIDAgICAxICAgMiAgIDMgICA0ICAgNSAgICA2ICAgNyAgIDggICA5ICAgMTAgIDExICAgMTIgIDEzICAxNCAgMTVcbiAqXG4gKiBnZXQoMCkgLT4gMFxuICogZ2V0KDEpIC0+IDZcbiAqIGdldCgyKSAtPiAxMlxuICogZ2V0KDMpIC0+IHRocm93c1xuICpcbiAqIGxlZnQgaW5jbHVzaXZlLCByaWdodCBleGNsdXNpdmU6XG4gKlxuICogZ2V0TGluZSh4KS5vZmZzZXQgPT09IGdldCh4KVxuICogZ2V0TGluZSgwKS5yYW5nZSAtPiAwLTZcbiAqIGdldExpbmUoMSkucmFuZ2UgLT4gNi0xMlxuICogZ2V0TGluZSgyKS5yYW5nZSAtPiAxMi0xM1xuICogZ2V0TGluZSgzKSAtPiB0aHJvd3NcbiAqXG4gKiBnZXRSYW5nZShbMCwwXSkgLT4gMC02XG4gKiBnZXRSYW5nZShbMCwxXSkgLT4gMC0xMlxuICogZ2V0UmFuZ2UoWzEsMV0pIC0+IDYtMTJcbiAqIGdldFJhbmdlKFsxLDJdKSAtPiA2LTEzXG4gKiBnZXRSYW5nZShbMiwyXSkgLT4gMTItMTNcbiAqIGdldFJhbmdlKFsyLDNdKSAtPiB0aHJvd3NcbiAqIGdldFJhbmdlKFswLDNdKSAtPiB0aHJvd3NcbiAqXG4gKiBnZXRQb2ludCh7IHg6eCwgeTp5IH0pLmxpbmUgPT09IGdldExpbmUoeSlcbiAqIGdldFBvaW50KHsgeDowLCB5OjAgfSkub2Zmc2V0IC0+IDBcbiAqIGdldFBvaW50KHsgeDowLCB5OjAgfSkucG9pbnQgLT4geyB4OjAsIHk6MCB9XG4gKiBnZXRQb2ludCh7IHg6MiwgeTowIH0pLm9mZnNldCAtPiAyXG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MCB9KS5vZmZzZXQgLT4gNVxuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjAgfSkucG9pbnQgLT4geyB4OjUsIHk6MCB9XG4gKiBnZXRQb2ludCh7IHg6MCwgeToxIH0pLm9mZnNldCAtPiA2XG4gKiBnZXRQb2ludCh7IHg6MiwgeToxIH0pLm9mZnNldCAtPiA4XG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MSB9KS5vZmZzZXQgLT4gMTFcbiAqIGdldFBvaW50KHsgeDoxMCwgeToxIH0pLnBvaW50IC0+IHsgeDo1LCB5OjEgfVxuICogZ2V0UG9pbnQoeyB4OjAsIHk6MiB9KS5vZmZzZXQgLT4gMTJcbiAqIGdldFBvaW50KHsgeDoxMCwgeToyIH0pLm9mZnNldCAtPiAxM1xuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjIgfSkucG9pbnQgLT4geyB4OjEsIHk6MiB9XG4gKiBnZXRSYW5nZSh7IHg6MTAwLCB5OjEwMCB9KS5vZmZzZXQgLT4gMTNcbiAqIGdldFJhbmdlKHsgeDoxMDAsIHk6MTAwIH0pLnBvaW50IC0+IHsgeDoxLCB5OiAyIH1cbiAqXG4gKiBnZXRMaW5lTGVuZ3RoKDApIC0+IDZcbiAqIGdldExpbmVMZW5ndGgoMSkgLT4gNlxuICogZ2V0TGluZUxlbmd0aCgyKSAtPiAyXG4gKiBnZXRMaW5lTGVuZ3RoKDMpIC0+IHRocm93c1xuICovXG5cbnZhciBFT0wgPSAvXFxyXFxufFxccnxcXG4vZztcbnZhciBOID0gL1xcbi9nO1xuXG5tb2R1bGUuZXhwb3J0cyA9IExpbmVzO1xuXG5mdW5jdGlvbiBMaW5lcygpIHtcbiAgdGhpcy5pbmRleCA9IFtdO1xuICB0aGlzLnRhaWwgPSAnJztcbiAgdGhpcy5sZW5ndGggPSAwO1xufVxuXG5MaW5lcy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSA+IHRoaXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5kZXhbdGhpcy5sZW5ndGggLSAxXSArIHRoaXMudGFpbC5sZW5ndGggKyAxO1xuICB9XG4gIHZhciBsaW5lID0gdGhpcy5pbmRleFt5IC0gMV0gfHwgMDtcblxuICByZXR1cm4geSA+IDAgPyBsaW5lICsgMSA6IDA7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIGI7XG5cbiAgaWYgKHJhbmdlWzFdICsgMSA+PSB0aGlzLmxlbmd0aCArIDEpIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0pICsgdGhpcy50YWlsLmxlbmd0aDtcbiAgfSBlbHNlIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0gKyAxKTtcbiAgfVxuXG4gIHJldHVybiBbYSwgYl07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0RGlzdGFuY2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgYSA9IHRoaXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIGI7XG5cbiAgaWYgKHJhbmdlWzFdID09PSB0aGlzLmxlbmd0aCArIDEpIHtcbiAgICBiID0gdGhpcy5nZXQocmFuZ2VbMV0gLSAxKSArIHRoaXMudGFpbC5sZW5ndGg7XG4gIH0gZWxzZSB7XG4gICAgYiA9IHRoaXMuZ2V0KHJhbmdlWzFdKSAtIDE7XG4gIH1cblxuICByZXR1cm4gYiAtIGE7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuZ2V0RGlzdGFuY2UoW3ksIHkrMV0pO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExvbmdlc3RMaW5lTGVuZ3RoID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsb25nZXN0ID0gMDtcbiAgdmFyIGQgPSAwO1xuICB2YXIgcCA9IHRoaXMuaW5kZXhbdGhpcy5sZW5ndGggLSAxXTtcbiAgdmFyIGkgPSB0aGlzLmxlbmd0aDtcbiAgd2hpbGUgKGktLSA+IDApIHtcbiAgICBkID0gdGhpcy5pbmRleFtpXSAtIHRoaXMuaW5kZXhbaSAtIDFdO1xuICAgIGxvbmdlc3QgPSBkID4gbG9uZ2VzdCA/IGQgOiBsb25nZXN0O1xuICB9XG4gIHJldHVybiBsb25nZXN0O1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHZhciBvZmZzZXQgPSB0aGlzLmdldCh5KTtcbiAgdmFyIHBvaW50ID0geyB4OiAwLCB5OiB5IH07XG4gIHZhciBsZW5ndGggPSB0aGlzLmdldExpbmVMZW5ndGgocG9pbnQueSk7XG4gIHZhciByYW5nZSA9IFtvZmZzZXQsIG9mZnNldCArIGxlbmd0aF07XG5cbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IG9mZnNldCxcbiAgICBwb2ludDogcG9pbnQsXG4gICAgcmFuZ2U6IHJhbmdlLFxuICAgIGxlbmd0aDogbGVuZ3RoLFxuICB9O1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldFBvaW50ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUocG9pbnQueSk7XG5cbiAgdmFyIHBvaW50ID0ge1xuICAgIHg6IE1hdGgubWluKHBvaW50LngsIGxpbmUubGVuZ3RoKSxcbiAgICB5OiBsaW5lLnBvaW50LnlcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIG9mZnNldDogbGluZS5vZmZzZXQgKyBwb2ludC54LFxuICAgIHBvaW50OiBwb2ludCxcbiAgICB4OiBwb2ludC54LFxuICAgIHk6IHBvaW50LnksXG4gICAgbGluZTogbGluZSxcbiAgfTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRPZmZzZXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHRoaXMubGVuZ3RoO1xuICBpZiAoIWVuZCkgcmV0dXJuO1xuXG4gIHZhciBwID0gLTE7XG4gIHZhciBpID0gLTE7XG5cbiAgZG8ge1xuICAgIHAgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBpZiAodGhpcy5nZXQoaSkgPD0gb2Zmc2V0KSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwICE9PSBpKTtcblxuICB2YXIgbGluZSA9IHRoaXMuZ2V0TGluZShpKTtcbiAgdmFyIHggPSBvZmZzZXQgLSBsaW5lLm9mZnNldDtcbiAgaWYgKCB4ID4gbGluZS5sZW5ndGhcbiAgICAmJiBpID09PSB0aGlzLmxlbmd0aCAtIDEpIHtcbiAgICB4IC09IGxpbmUubGVuZ3RoICsgMTtcbiAgICBpICs9IDE7XG4gICAgaWYgKHggPiB0aGlzLnRhaWwubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogaSxcbiAgICBsaW5lOiBsaW5lXG4gIH07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocCwgdGV4dCkge1xuICB2YXIgcG9pbnQgPSB0aGlzLmdldFBvaW50KHApO1xuICB2YXIgeCA9IHBvaW50Lng7XG4gIHZhciB5ID0gcG9pbnQueTtcbiAgdmFyIG9mZnNldCA9IHBvaW50Lm9mZnNldDtcblxuICBpZiAoeSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0ZXh0ID0gdGhpcy50YWlsLnN1YnN0cigwLHgpICsgdGV4dCArIHRoaXMudGFpbC5zdWJzdHIoeCk7XG4gICAgdGhpcy50YWlsID0gJyc7XG4gICAgb2Zmc2V0IC09IHg7XG4gIH1cblxuICB2YXIgbWF0Y2hlcyA9IFt5LCAwXTtcbiAgdmFyIG1hdGNoID0gLTE7XG4gIHZhciBzaGlmdCA9IDA7XG4gIHZhciBsYXN0ID0gLTE7XG5cbiAgd2hpbGUgKH4obWF0Y2ggPSB0ZXh0LmluZGV4T2YoJ1xcbicsIG1hdGNoICsgMSkpKSB7XG4gICAgbWF0Y2hlcy5wdXNoKG1hdGNoICsgb2Zmc2V0KTtcbiAgICBsYXN0ID0gbWF0Y2g7XG4gIH1cblxuICBzaGlmdCArPSBsYXN0ICsgMTtcblxuICB2YXIgdGFpbCA9IHRleHQuc2xpY2UobGFzdCArIDEpO1xuICBpZiAoeSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0aGlzLnRhaWwgKz0gdGFpbDtcbiAgfVxuXG4gIGlmICh5IDwgdGhpcy5sZW5ndGgpIHtcbiAgICBzaGlmdCArPSB0YWlsLmxlbmd0aDtcbiAgICB0aGlzLnNoaWZ0KHksIHNoaWZ0KTtcbiAgfVxuXG4gIGlmIChtYXRjaGVzLmxlbmd0aCA8IDMpIHJldHVybiAwO1xuXG4gIHRoaXMuaW5kZXguc3BsaWNlLmFwcGx5KHRoaXMuaW5kZXgsIG1hdGNoZXMpO1xuXG4gIHZhciBsaW5lcyA9IHRoaXMuaW5kZXgubGVuZ3RoIC0gdGhpcy5sZW5ndGg7XG5cbiAgdGhpcy5sZW5ndGggPSB0aGlzLmluZGV4Lmxlbmd0aDtcblxuICByZXR1cm4gbGluZXM7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuaW5zZXJ0TGluZSA9IGZ1bmN0aW9uKHksIHRleHQpIHtcbiAgdGhpcy5pbnNlcnQoeyB4OjAsIHk6eSB9LCB0ZXh0KTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgYXJlYS5iZWdpbi55LFxuICAgIGFyZWEuZW5kLnlcbiAgXSk7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0QXJlYU9mZnNldFJhbmdlID0gZnVuY3Rpb24oYXJlYSkge1xuICByZXR1cm4gW1xuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5iZWdpbikub2Zmc2V0LFxuICAgIHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpLm9mZnNldFxuICBdO1xufTtcblxuTGluZXMucHJvdG90eXBlLnJlbW92ZUNoYXJBdCA9IGZ1bmN0aW9uKHApIHtcbiAgdmFyIGEgPSB0aGlzLmdldFBvaW50KHApO1xuICBpZiAoYS5wb2ludC55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgIHRoaXMudGFpbCA9IHRoaXMudGFpbC5zbGljZSgwLCAtMSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGVsc2Uge1xuICAgIHZhciBpc0VuZE9mTGluZSA9IGEubGluZS5sZW5ndGggPT09IGEucG9pbnQueDtcbiAgICBpZiAoaXNFbmRPZkxpbmUpIHtcbiAgICAgIHRoaXMuaW5kZXguc3BsaWNlKGEucG9pbnQueSwgMSk7XG4gICAgICB0aGlzLmxlbmd0aCA9IHRoaXMuaW5kZXgubGVuZ3RoO1xuICAgICAgaWYgKGEucG9pbnQueSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy50YWlsICs9IG5ldyBBcnJheShhLmxpbmUubGVuZ3RoKzEpLmpvaW4oJyonKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5zaGlmdChhLnBvaW50LnksIC0xKTtcbiAgICByZXR1cm4gaXNFbmRPZkxpbmU7XG4gIH1cbn07XG5cbkxpbmVzLnByb3RvdHlwZS5yZW1vdmVBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgYmVnaW4gPSB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pO1xuICB2YXIgZW5kID0gdGhpcy5nZXRQb2ludChhcmVhLmVuZCk7XG5cbiAgdmFyIHggPSAwO1xuXG4gIHZhciBkaXN0ID0gZW5kLnkgLSBiZWdpbi55O1xuICB2YXIgc2FtZUxpbmUgPSBiZWdpbi55ID09PSBlbmQueTtcbiAgaWYgKHNhbWVMaW5lKSB4ID0gZW5kLnggLSBiZWdpbi54O1xuICBlbHNlIHtcbiAgICB0aGlzLmluZGV4LnNwbGljZShiZWdpbi55LCBkaXN0KTtcbiAgfVxuXG4gIGlmICghc2FtZUxpbmUpIHtcbiAgICBpZiAoYXJlYS5iZWdpbi55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKDAsIC14KTtcbiAgICB9XG4gICAgaWYgKGFyZWEuZW5kLnkgPT09IHRoaXMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRhaWwgPSB0aGlzLnRhaWwuc2xpY2UoZW5kLngpO1xuICAgICAgdGhpcy50YWlsICs9IG5ldyBBcnJheShiZWdpbi54ICsgMSkuam9pbignKicpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoYXJlYS5iZWdpbi55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKDAsIGJlZ2luLngpICsgdGhpcy50YWlsLnNsaWNlKGVuZC54KTtcbiAgICB9XG4gIH1cblxuICB0aGlzLnNoaWZ0KGFyZWEuYmVnaW4ueSwgLShlbmQub2Zmc2V0IC0gYmVnaW4ub2Zmc2V0KSk7XG5cbiAgdmFyIGRpZmYgPSB0aGlzLmxlbmd0aCAtIHRoaXMuaW5kZXgubGVuZ3RoO1xuXG4gIHRoaXMubGVuZ3RoID0gdGhpcy5pbmRleC5sZW5ndGg7XG5cbiAgcmV0dXJuIGRpZmY7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuc2hpZnQgPSBmdW5jdGlvbih5LCBkaWZmKSB7XG4gIGZvciAodmFyIGkgPSB5OyBpIDwgdGhpcy5pbmRleC5sZW5ndGg7IGkrKykge1xuICAgIHRoaXMuaW5kZXhbaV0gKz0gZGlmZjtcbiAgfVxufTtcblxuTGluZXMucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxpbmVzID0gbmV3IExpbmVzO1xuICBsaW5lcy5pbmRleCA9IHRoaXMuaW5kZXguc2xpY2UoKTtcbiAgbGluZXMudGFpbCA9IHRoaXMudGFpbDtcbiAgbGluZXMubGVuZ3RoID0gdGhpcy5sZW5ndGg7XG4gIHJldHVybiBsaW5lcztcbn07XG5cbkxpbmVzLmNvdW50ID0gZnVuY3Rpb24odGV4dCkge1xuICByZXR1cm4gdGhpcy50ZXh0Lm1hdGNoKE4pLmxlbmd0aDtcbn07XG5cbmZ1bmN0aW9uIGFkZChiKSB7XG4gIHJldHVybiBmdW5jdGlvbihhKSB7XG4gICAgcmV0dXJuIGEgKyBiO1xuICB9O1xufVxuIiwiLy8gdmFyIFdPUkQgPSAvXFx3Ky9nO1xudmFyIFdPUkQgPSAvW2EtekEtWjAtOV17MSx9L2dcbnZhciByYW5rID0gMDtcblxubW9kdWxlLmV4cG9ydHMgPSBQcmVmaXhUcmVlTm9kZTtcblxuZnVuY3Rpb24gUHJlZml4VHJlZU5vZGUoKSB7XG4gIHRoaXMudmFsdWUgPSAnJztcbiAgdGhpcy5yYW5rID0gMDtcbiAgdGhpcy5jaGlsZHJlbiA9IHt9O1xufVxuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuZ2V0Q2hpbGRyZW4gPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNoaWxkcmVuID0gT2JqZWN0XG4gICAgLmtleXModGhpcy5jaGlsZHJlbilcbiAgICAubWFwKChrZXkpID0+IHRoaXMuY2hpbGRyZW5ba2V5XSk7XG5cbiAgcmV0dXJuIGNoaWxkcmVuLnJlZHVjZSgocCwgbikgPT4gcC5jb25jYXQobi5nZXRDaGlsZHJlbigpKSwgY2hpbGRyZW4pO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmNvbGxlY3QgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIGNvbGxlY3Rpb24gPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmZpbmQoa2V5KTtcbiAgaWYgKG5vZGUpIHtcbiAgICBjb2xsZWN0aW9uID0gbm9kZVxuICAgICAgLmdldENoaWxkcmVuKClcbiAgICAgIC5maWx0ZXIoKG5vZGUpID0+IG5vZGUudmFsdWUpXG4gICAgICAuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICB2YXIgcmVzID0gYi5yYW5rIC0gYS5yYW5rO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBiLnZhbHVlLmxlbmd0aCAtIGEudmFsdWUubGVuZ3RoO1xuICAgICAgICBpZiAocmVzID09PSAwKSByZXMgPSBhLnZhbHVlID4gYi52YWx1ZTtcbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICAgIH0pO1xuXG4gICAgaWYgKG5vZGUudmFsdWUpIGNvbGxlY3Rpb24ucHVzaChub2RlKTtcbiAgfVxuICByZXR1cm4gY29sbGVjdGlvbjtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBub2RlID0gdGhpcztcbiAgZm9yICh2YXIgY2hhciBpbiBrZXkpIHtcbiAgICBpZiAoa2V5W2NoYXJdIGluIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkcmVuW2tleVtjaGFyXV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5vZGU7XG59O1xuXG5QcmVmaXhUcmVlTm9kZS5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ocywgdmFsdWUpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICB2YXIgaSA9IDA7XG4gIHZhciBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgaWYgKHNbaV0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5bc1tpXV07XG4gICAgICBpKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIG5vZGUgPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gPVxuICAgIG5vZGUuY2hpbGRyZW5bc1tpXV0gfHwgbmV3IFByZWZpeFRyZWVOb2RlO1xuICAgIGkrKztcbiAgfVxuXG4gIG5vZGUudmFsdWUgPSBzO1xuICBub2RlLnJhbmsrKztcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHdvcmQ7XG4gIHdoaWxlICh3b3JkID0gV09SRC5leGVjKHMpKSB7XG4gICAgdGhpcy5pbnNlcnQod29yZFswXSk7XG4gIH1cbn07XG4iLCJcbnZhciBCZWdpbiA9IC9bXFwvJ1wiYF0vZztcblxudmFyIE1hdGNoID0ge1xuICAnc2luZ2xlIGNvbW1lbnQnOiBbJy8vJywnXFxuJ10sXG4gICdkb3VibGUgY29tbWVudCc6IFsnLyonLCcqLyddLFxuICAndGVtcGxhdGUgc3RyaW5nJzogWydgJywnYCddLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFtcIidcIixcIidcIl0sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogWydcIicsJ1wiJ10sXG4gICdyZWdleHAnOiBbJy8nLCcvJ10sXG59O1xuXG52YXIgU2tpcCA9IHtcbiAgJ3NpbmdsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBcIlxcXFxcIixcbiAgJ3NpbmdsZSBjb21tZW50JzogZmFsc2UsXG4gICdkb3VibGUgY29tbWVudCc6IGZhbHNlLFxuICAncmVnZXhwJzogXCJcXFxcXCIsXG59O1xuXG52YXIgVG9rZW4gPSB7fTtcbmZvciAodmFyIGtleSBpbiBNYXRjaCkge1xuICB2YXIgTSA9IE1hdGNoW2tleV07XG4gIFRva2VuW01bMF1dID0ga2V5O1xufVxuXG52YXIgVE9LRU4gPSAvKFxcL1xcKil8KFxcKlxcLyl8KGApL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gU2VnbWVudHM7XG5cbmZ1bmN0aW9uIFNlZ21lbnRzKGJ1ZmZlcikge1xuICB0aGlzLmJ1ZmZlciA9IGJ1ZmZlcjtcbiAgdGhpcy5zZWdtZW50cyA9IFtdO1xuICB0aGlzLmNsZWFyQ2FjaGUoKTtcbn1cblxudmFyIExlbmd0aCA9IHtcbiAgJ29wZW4gY29tbWVudCc6IDIsXG4gICdjbG9zZSBjb21tZW50JzogMixcbiAgJ3RlbXBsYXRlIHN0cmluZyc6IDEsXG59O1xuXG52YXIgTm90T3BlbiA9IHtcbiAgJ2Nsb3NlIGNvbW1lbnQnOiB0cnVlXG59O1xuXG52YXIgQ2xvc2VzID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2Nsb3NlIGNvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3RlbXBsYXRlIHN0cmluZycsXG59O1xuXG52YXIgVGFnID0ge1xuICAnb3BlbiBjb21tZW50JzogJ2NvbW1lbnQnLFxuICAndGVtcGxhdGUgc3RyaW5nJzogJ3N0cmluZycsXG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24oeSkge1xuICBpZiAoeSBpbiB0aGlzLmNhY2hlLnN0YXRlKSByZXR1cm4gdGhpcy5jYWNoZS5zdGF0ZVt5XTtcblxuICB2YXIgb3BlbiA9IGZhbHNlO1xuICB2YXIgc3RhdGUgPSBudWxsO1xuICB2YXIgd2FpdEZvciA9ICcnO1xuICB2YXIgcG9pbnQgPSB7IHg6LTEsIHk6LTEgfTtcbiAgdmFyIGNsb3NlID0gMDtcbiAgdmFyIHNlZ21lbnQ7XG4gIHZhciByYW5nZTtcbiAgdmFyIHRleHQ7XG4gIHZhciB2YWxpZDtcbiAgdmFyIGxhc3Q7XG5cbiAgdmFyIGkgPSAwO1xuXG4gIC8vVE9ETzogb3B0aW1pemF0aW9uOlxuICAvLyBjYWNoZSBzZWdtZW50IHkgd2l0aCBvcGVuL2Nsb3NlL3N0YXRlIHNvIHdlIHNraXBcbiAgLy8gaXRlcmF0aW5nIGZyb20gdGhlIGJlZ2luIGV2ZXJ5IHRpbWVcblxuICBmb3IgKDsgaSA8IHRoaXMuc2VnbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBzZWdtZW50ID0gdGhpcy5zZWdtZW50c1tpXTtcblxuICAgIGlmIChvcGVuKSB7XG4gICAgICBpZiAod2FpdEZvciA9PT0gc2VnbWVudC50eXBlKSB7XG4gICAgICAgIHBvaW50ID0gdGhpcy5nZXRQb2ludE9mZnNldChzZWdtZW50Lm9mZnNldCk7XG4gICAgICAgIGlmICghcG9pbnQpIHJldHVybiAodGhpcy5jYWNoZS5zdGF0ZVt5XSA9IG51bGwpO1xuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdjbG9zZScsIHNlZ21lbnQudHlwZSwgc2VnbWVudC5vZmZzZXQsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW3NlZ21lbnQub2Zmc2V0LCBzZWdtZW50Lm9mZnNldCArIDEwXSkpXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0UG9pbnRPZmZzZXQoc2VnbWVudC5vZmZzZXQpO1xuICAgICAgaWYgKCFwb2ludCkgcmV0dXJuICh0aGlzLmNhY2hlLnN0YXRlW3ldID0gbnVsbCk7XG5cbiAgICAgIHJhbmdlID0gcG9pbnQubGluZS5yYW5nZTtcblxuICAgICAgaWYgKGxhc3QgJiYgbGFzdC5wb2ludC55ID09PSBwb2ludC55KSB7XG4gICAgICAgIGNsb3NlID0gbGFzdC5wb2ludC54ICsgTGVuZ3RoW2xhc3QudHlwZV07XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdsYXN0IG9uZSB3YXMnLCBsYXN0LnR5cGUsIGxhc3QucG9pbnQueCwgdGhpcy5idWZmZXIudGV4dC5nZXRSYW5nZShbbGFzdC5vZmZzZXQsIGxhc3Qub2Zmc2V0ICsgMTBdKSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNsb3NlID0gMDtcbiAgICAgIH1cbiAgICAgIHZhbGlkID0gdGhpcy5pc1ZhbGlkUmFuZ2UoW3JhbmdlWzBdLCByYW5nZVsxXSsxXSwgc2VnbWVudCwgY2xvc2UpO1xuXG4gICAgICBpZiAodmFsaWQpIHtcbiAgICAgICAgaWYgKE5vdE9wZW5bc2VnbWVudC50eXBlXSkgY29udGludWU7XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdvcGVuJywgc2VnbWVudC50eXBlLCBzZWdtZW50Lm9mZnNldCwgdGhpcy5idWZmZXIudGV4dC5nZXRSYW5nZShbc2VnbWVudC5vZmZzZXQsIHNlZ21lbnQub2Zmc2V0ICsgMTBdKSlcbiAgICAgICAgb3BlbiA9IHRydWU7XG4gICAgICAgIHN0YXRlID0gc2VnbWVudDtcbiAgICAgICAgc3RhdGUucG9pbnQgPSBwb2ludDtcbiAgICAgICAgd2FpdEZvciA9IENsb3Nlc1tzdGF0ZS50eXBlXTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBvaW50LnkgPj0geSkgYnJlYWs7XG4gIH1cbiAgaWYgKHN0YXRlICYmIHN0YXRlLnBvaW50LnkgPCB5KSByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBUYWdbc3RhdGUudHlwZV0pO1xuICByZXR1cm4gKHRoaXMuY2FjaGUuc3RhdGVbeV0gPSBudWxsKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRQb2ludE9mZnNldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICBpZiAob2Zmc2V0IGluIHRoaXMuY2FjaGUub2Zmc2V0KSByZXR1cm4gdGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XVxuICByZXR1cm4gKHRoaXMuY2FjaGUub2Zmc2V0W29mZnNldF0gPSB0aGlzLmJ1ZmZlci5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KSk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIHNlZ21lbnQsIGNsb3NlKSB7XG4gIHZhciBrZXkgPSByYW5nZS5qb2luKCk7XG4gIGlmIChrZXkgaW4gdGhpcy5jYWNoZS5yYW5nZSkgcmV0dXJuIHRoaXMuY2FjaGUucmFuZ2Vba2V5XTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci50ZXh0LmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIHZhbGlkID0gdGhpcy5pc1ZhbGlkKHRleHQsIHNlZ21lbnQub2Zmc2V0IC0gcmFuZ2VbMF0sIGNsb3NlKTtcbiAgcmV0dXJuICh0aGlzLmNhY2hlLnJhbmdlW2tleV0gPSB2YWxpZCk7XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaXNWYWxpZCA9IGZ1bmN0aW9uKHRleHQsIG9mZnNldCwgbGFzdEluZGV4KSB7XG4gIEJlZ2luLmxhc3RJbmRleCA9IGxhc3RJbmRleDtcbiAgdmFyIG1hdGNoID0gQmVnaW4uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuO1xuXG4gIGkgPSBtYXRjaC5pbmRleDtcblxuICBsYXN0ID0gaTtcblxuICB2YXIgdmFsaWQgPSB0cnVlO1xuXG4gIG91dGVyOlxuICBmb3IgKDsgaSA8IHRleHQubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgb25lID0gdGV4dFtpXTtcbiAgICB2YXIgbmV4dCA9IHRleHRbaSArIDFdO1xuICAgIHZhciB0d28gPSBvbmUgKyBuZXh0O1xuICAgIGlmIChpID09PSBvZmZzZXQpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIG8gPSBUb2tlblt0d29dO1xuICAgIGlmICghbykgbyA9IFRva2VuW29uZV07XG4gICAgaWYgKCFvKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICB2YXIgd2FpdEZvciA9IE1hdGNoW29dWzFdO1xuXG4gICAgLy8gY29uc29sZS5sb2coJ3N0YXJ0JywgaSwgbylcbiAgICBsYXN0ID0gaTtcblxuICAgIHN3aXRjaCAod2FpdEZvci5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgICAgb25lID0gdGV4dFtpXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSBvbmUpIHtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAxO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgd2hpbGUgKCsraSA8IHRleHQubGVuZ3RoKSB7XG5cbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuICAgICAgICAgIHR3byA9IHRleHRbaV0gKyB0ZXh0W2kgKyAxXTtcblxuICAgICAgICAgIGlmIChvbmUgPT09IFNraXBbb10pIHtcbiAgICAgICAgICAgICsraTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh3YWl0Rm9yID09PSB0d28pIHtcbiAgICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICgnXFxuJyA9PT0gb25lICYmICF2YWxpZCkge1xuICAgICAgICAgICAgdmFsaWQgPSB0cnVlO1xuICAgICAgICAgICAgaSA9IGxhc3QgKyAyO1xuICAgICAgICAgICAgY29udGludWUgb3V0ZXI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGkgPT09IG9mZnNldCkge1xuICAgICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbGlkO1xufVxuXG5TZWdtZW50cy5wcm90b3R5cGUuZ2V0U2VnbWVudCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICB2YXIgYmVnaW4gPSAwO1xuICB2YXIgZW5kID0gdGhpcy5zZWdtZW50cy5sZW5ndGg7XG4gIGlmICghZW5kKSByZXR1cm47XG5cbiAgdmFyIHAgPSAtMTtcbiAgdmFyIGkgPSAtMTtcbiAgdmFyIGI7XG5cbiAgZG8ge1xuICAgIHAgPSBpO1xuICAgIGkgPSBiZWdpbiArIChlbmQgLSBiZWdpbikgLyAyIHwgMDtcbiAgICBiID0gdGhpcy5zZWdtZW50c1tpXTtcbiAgICBpZiAoYi5vZmZzZXQgPCBvZmZzZXQpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHAgIT09IGkpO1xuXG4gIHJldHVybiB7XG4gICAgc2VnbWVudDogYixcbiAgICBpbmRleDogaVxuICB9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLnNoaWZ0ID0gZnVuY3Rpb24ob2Zmc2V0LCBzaGlmdCkge1xuICB2YXIgcyA9IHRoaXMuZ2V0U2VnbWVudChvZmZzZXQpO1xuICBpZiAoIXMpIHJldHVybjtcblxuICBmb3IgKHZhciBpID0gcy5pbmRleCArIDE7IGkgPCB0aGlzLnNlZ21lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy5zZWdtZW50c1tpXS5vZmZzZXQgKz0gc2hpZnQ7XG4gIH1cblxuICAvLyBpZiAoc2hpZnQgPCAwKSB7XG4gICAgLy8gdGhpcy5jbGVhckNhY2hlKCk7XG4gIC8vIH1cbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5jbGVhckNhY2hlID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2FjaGUgPSB7XG4gICAgb2Zmc2V0OiB7fSxcbiAgICByYW5nZToge30sXG4gICAgc3RhdGU6IHt9XG4gIH07XG59O1xuXG5TZWdtZW50cy5wcm90b3R5cGUuaW5kZXggPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHZhciBtYXRjaDtcblxuICB2YXIgc2VnbWVudHMgPSB0aGlzLnNlZ21lbnRzID0gW107XG5cbiAgdGhpcy5jbGVhckNhY2hlKCk7XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGlmIChtYXRjaFsnMyddKSBzZWdtZW50cy5wdXNoKG5ldyBTZWdtZW50KCd0ZW1wbGF0ZSBzdHJpbmcnLCBtYXRjaC5pbmRleCkpO1xuICAgIGVsc2UgaWYgKG1hdGNoWycxJ10pIHNlZ21lbnRzLnB1c2gobmV3IFNlZ21lbnQoJ29wZW4gY29tbWVudCcsIG1hdGNoLmluZGV4KSk7XG4gICAgZWxzZSBpZiAobWF0Y2hbJzInXSkgc2VnbWVudHMucHVzaChuZXcgU2VnbWVudCgnY2xvc2UgY29tbWVudCcsIG1hdGNoLmluZGV4KSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNlZ21lbnQodHlwZSwgb2Zmc2V0KSB7XG4gIHRoaXMudHlwZSA9IHR5cGU7XG4gIHRoaXMub2Zmc2V0ID0gb2Zmc2V0O1xufVxuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbmxvZyA9IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplO1xufVxuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkLndpZHRoW3RoaXMubGV2ZWxzIC0gMV07XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICAvLyBncmVhdCBoYWNrIHRvIGRvIG9mZnNldCA+PSBmb3IgLnNlYXJjaCgpXG4gIC8vIHdlIGRvbid0IGhhdmUgZnJhY3Rpb25zIGFueXdheSBzby4uXG4gIHJldHVybiB0aGlzLnNlYXJjaChvZmZzZXQsIHRydWUpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmluc2VydENodW5rZWQoMCwgdGV4dCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbihvZmZzZXQsIGluY2wpIHtcbiAgaW5jbCA9IGluY2wgPyAuMSA6IDA7XG5cbiAgLy8gcHJlcGFyZSB0byBob2xkIHN0ZXBzXG4gIHZhciBzdGVwcyA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG4gIHZhciB3aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG5cbiAgLy8gaXRlcmF0ZSBsZXZlbHMgZG93biwgc2tpcHBpbmcgdG9wXG4gIHZhciBpID0gdGhpcy5sZXZlbHM7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICB3aGlsZSAob2Zmc2V0ICsgaW5jbCA+IG5vZGUud2lkdGhbaV0gJiYgbnVsbCAhPSBub2RlLm5leHRbaV0pIHtcbiAgICAgIG9mZnNldCAtPSBub2RlLndpZHRoW2ldO1xuICAgICAgbm9kZSA9IG5vZGUubmV4dFtpXTtcbiAgICB9XG4gICAgc3RlcHNbaV0gPSBub2RlO1xuICAgIHdpZHRoW2ldID0gb2Zmc2V0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBub2RlOiBub2RlLFxuICAgIHN0ZXBzOiBzdGVwcyxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgb2Zmc2V0OiBvZmZzZXRcbiAgfTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNwbGljZSA9IGZ1bmN0aW9uKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7IC8vIHNraXAgc3RlcHMgbGVmdCBvZiB0aGUgb2Zmc2V0XG4gIHZhciB3aWR0aCA9IHMud2lkdGg7XG5cbiAgdmFyIHA7IC8vIGxlZnQgbm9kZSBvciBgcGBcbiAgdmFyIHE7IC8vIHJpZ2h0IG5vZGUgb3IgYHFgIChvdXIgbmV3IG5vZGUpXG4gIHZhciBsZW47XG5cbiAgLy8gY3JlYXRlIG5ldyBub2RlXG4gIGxldmVsID0gbGV2ZWwgfHwgdGhpcy5yYW5kb21MZXZlbCgpO1xuICBxID0gbmV3IE5vZGUodmFsdWUsIGxldmVsKTtcbiAgbGVuZ3RoID0gcS53aWR0aFswXTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBpdGVyYXRlIHN0ZXBzIGxldmVscyBiZWxvdyBuZXcgbm9kZSBsZXZlbFxuICBpID0gbGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbCBzdGVwXG4gICAgcS5uZXh0W2ldID0gcC5uZXh0W2ldOyAvLyBpbnNlcnQgc28gaW5oZXJpdCBsZWZ0J3MgbmV4dFxuICAgIHAubmV4dFtpXSA9IHE7IC8vIGxlZnQncyBuZXh0IGlzIG5vdyBvdXIgbmV3IG5vZGVcbiAgICBxLndpZHRoW2ldID0gcC53aWR0aFtpXSAtIHdpZHRoW2ldICsgbGVuZ3RoO1xuICAgIHAud2lkdGhbaV0gPSB3aWR0aFtpXTtcbiAgfVxuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgYWxsIGxldmVscyBkb3duIHVudGlsIGV4Y2VwdCBuZXcgbm9kZSBsZXZlbFxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBsZXZlbCkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsXG4gICAgcC53aWR0aFtpXSArPSBsZW5ndGg7IC8vIGFkZCBuZXcgbm9kZSB3aWR0aFxuICB9XG5cbiAgLy8gcmV0dXJuIG5ldyBub2RlXG4gIHJldHVybiBxO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChvZmZzZXQpO1xuXG4gIC8vIGlmIHNlYXJjaCBmYWxscyBpbiB0aGUgbWlkZGxlIG9mIGEgc3RyaW5nXG4gIC8vIGluc2VydCBpdCB0aGVyZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIGEgbmV3IG5vZGVcbiAgaWYgKHMub2Zmc2V0ICYmIHMubm9kZS52YWx1ZSAmJiBzLm9mZnNldCA8IHMubm9kZS52YWx1ZS5sZW5ndGgpIHtcbiAgICB0aGlzLnVwZGF0ZShzLCBpbnNlcnQocy5vZmZzZXQsIHMubm9kZS52YWx1ZSwgdmFsdWUpKTtcbiAgICByZXR1cm4gcy5ub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuc3BsaWNlKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIC8vIHZhbHVlcyBsZW5ndGggZGlmZmVyZW5jZVxuICB2YXIgbGVuZ3RoID0gcy5ub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICAvLyB1cGRhdGUgdmFsdWVcbiAgcy5ub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gZml4IHdpZHRocyBvbiBhbGwgbGV2ZWxzXG4gIGkgPSB0aGlzLmxldmVscztcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgcy5zdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKHJhbmdlWzFdID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAncmFuZ2UgZW5kIG92ZXIgbWF4aW11bSBsZW5ndGgoJyArXG4gICAgICB0aGlzLmxlbmd0aCArICcpOiBbJyArIHJhbmdlLmpvaW4oKSArICddJ1xuICAgICk7XG4gIH1cblxuICAvLyByZW1haW4gZGlzdGFuY2UgdG8gcmVtb3ZlXG4gIHZhciB4ID0gcmFuZ2VbMV0gLSByYW5nZVswXTtcblxuICAvLyBzZWFyY2ggZm9yIG5vZGUgb24gbGVmdCBlZGdlXG4gIHZhciBzID0gdGhpcy5zZWFyY2gocmFuZ2VbMF0pO1xuICB2YXIgb2Zmc2V0ID0gcy5vZmZzZXQ7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7XG4gIHZhciBub2RlID0gcy5ub2RlO1xuXG4gIC8vIHNraXAgaGVhZFxuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gIC8vIHNsaWNlIGxlZnQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKG9mZnNldCkge1xuICAgIGlmIChvZmZzZXQgPCBub2RlLndpZHRoWzBdKSB7XG4gICAgICB4IC09IHRoaXMudXBkYXRlKHMsXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoMCwgb2Zmc2V0KSArXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoXG4gICAgICAgICAgb2Zmc2V0ICtcbiAgICAgICAgICBNYXRoLm1pbih4LCBub2RlLmxlbmd0aCAtIG9mZnNldClcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gICAgaWYgKCFub2RlKSByZXR1cm47XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGZ1bGwgbm9kZXMgaW4gcmFuZ2VcbiAgd2hpbGUgKG5vZGUgJiYgeCA+PSBub2RlLndpZHRoWzBdKSB7XG4gICAgeCAtPSB0aGlzLnJlbW92ZU5vZGUoc3RlcHMsIG5vZGUpO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cblxuICAvLyBzbGljZSByaWdodCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAoeCkge1xuICAgIHRoaXMucmVwbGFjZShzdGVwcywgbm9kZSwgbm9kZS52YWx1ZS5zbGljZSh4KSk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZU5vZGUgPSBmdW5jdGlvbihzdGVwcywgbm9kZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS53aWR0aFswXTtcblxuICB2YXIgaTtcblxuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aCAtIG5vZGUud2lkdGhbaV07XG4gICAgc3RlcHNbaV0ubmV4dFtpXSA9IG5vZGUubmV4dFtpXTtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlLCB2YWx1ZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgbm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIHZhciBpO1xuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIG5vZGUud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlKFtvZmZzZXQsIG9mZnNldCsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnRDaHVua2VkID0gZnVuY3Rpb24ob2Zmc2V0LCB0ZXh0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gdGhpcy5jaHVua1NpemUpIHtcbiAgICB2YXIgY2h1bmsgPSB0ZXh0LnN1YnN0cihpLCB0aGlzLmNodW5rU2l6ZSk7XG4gICAgdGhpcy5pbnNlcnQoaSArIG9mZnNldCwgY2h1bmspO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zdWJzdHJpbmcgPSBmdW5jdGlvbihhLCBiKSB7XG4gIGEgPSBhIHx8IDA7XG4gIGIgPSBiIHx8IHRoaXMubGVuZ3RoO1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xudmFyIFIgPSBSZWdleHAuY3JlYXRlO1xuXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcbnZhciBzeW50YXggPSBtYXAoe1xuICAnb3BlcmF0b3InOiBSKFsnb3BlcmF0b3InXSwgJ2cnLCBlbnRpdGllcyksXG4gICdwYXJhbXMnOiAgIFIoWydwYXJhbXMnXSwgICAnZycpLFxuICAnZGVjbGFyZSc6ICBSKFsnZGVjbGFyZSddLCAgJ2cnKSxcbiAgJ2Z1bmN0aW9uJzogUihbJ2Z1bmN0aW9uJ10sICdnJyksXG4gICdrZXl3b3JkJzogIFIoWydrZXl3b3JkJ10sICAnZycpLFxuICAnYnVpbHRpbic6ICBSKFsnYnVpbHRpbiddLCAgJ2cnKSxcbiAgJ3N5bWJvbCc6ICAgUihbJ3N5bWJvbCddLCAgICdnJyksXG4gICdzdHJpbmcnOiAgIFIoWyd0ZW1wbGF0ZSBzdHJpbmcnXSwgJ2cnKSxcbiAgJ251bWJlcic6ICAgUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcbn0sIGNvbXBpbGUpO1xuXG52YXIgSW5kZW50ID0ge1xuICByZWdleHA6IFIoWydpbmRlbnQnXSwgJ2dtJyksXG4gIHJlcGxhY2VyOiAocykgPT4gcy5yZXBsYWNlKC8gezEsMn0vZywgJzxpbmRlbnQ+JCY8L2luZGVudD4nKVxufTtcblxudmFyIEJsb2NrcyA9IFIoWydjb21tZW50Jywnc3RyaW5nJywncmVnZXhwJ10sICdnbScpO1xuXG52YXIgVGFnID0ge1xuICAnLy8nOiAnY29tbWVudCcsXG4gICcvKic6ICdjb21tZW50JyxcbiAgJ2AnOiAnc3RyaW5nJyxcbiAgJ1wiJzogJ3N0cmluZycsXG4gIFwiJ1wiOiAnc3RyaW5nJyxcbiAgJy8nOiAncmVnZXhwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3ludGF4O1xuXG5mdW5jdGlvbiBTeW50YXgobykge1xuICBvID0gbyB8fCB7fTtcbiAgdGhpcy5tYXhMaW5lID0gby5tYXhMaW5lIHx8IDMwMDtcbiAgdGhpcy5ibG9ja3MgPSBbXTtcbn1cblxuU3ludGF4LnByb3RvdHlwZS5lbnRpdGllcyA9IGVudGl0aWVzO1xuXG5TeW50YXgucHJvdG90eXBlLmhpZ2hsaWdodCA9IGZ1bmN0aW9uKGNvZGUsIG9mZnNldCkge1xuICAvLyBjb25zb2xlLmxvZygwLCAnaGlnaGxpZ2h0JywgY29kZSlcblxuICBjb2RlID0gdGhpcy5jcmVhdGVJbmRlbnRzKGNvZGUpO1xuICBjb2RlID0gdGhpcy5jcmVhdGVCbG9ja3MoY29kZSk7XG4gIGNvZGUgPSBlbnRpdGllcyhjb2RlKTtcblxuICBmb3IgKHZhciBrZXkgaW4gc3ludGF4KSB7XG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShzeW50YXhba2V5XS5yZWdleHAsIHN5bnRheFtrZXldLnJlcGxhY2VyKTtcbiAgfVxuXG4gIGNvZGUgPSB0aGlzLnJlc3RvcmVCbG9ja3MoY29kZSk7XG5cbiAgY29kZSA9IGNvZGUucmVwbGFjZShJbmRlbnQucmVnZXhwLCBJbmRlbnQucmVwbGFjZXIpO1xuXG4gIC8vIGNvZGUgPSBjb2RlLnJlcGxhY2UoL1xcdWVlZWUvZywgZnVuY3Rpb24oKSB7XG4gIC8vICAgcmV0dXJuIGxvbmcuc2hpZnQoKS5zbGljZSgwLCB0aGlzLm1heExpbmUpICsgJy4uLmxpbmUgdG9vIGxvbmcgdG8gZGlzcGxheSc7XG4gIC8vIH0pO1xuXG4gIHJldHVybiBjb2RlO1xufTtcblxuU3ludGF4LnByb3RvdHlwZS5jcmVhdGVJbmRlbnRzID0gZnVuY3Rpb24oY29kZSkge1xuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XG4gIGlmIChsaW5lcy5sZW5ndGggPD0gMikgcmV0dXJuIGNvZGU7XG5cbiAgdmFyIGxpbmU7XG4gIHZhciBsb25nID0gW107XG4gIHZhciBtYXRjaDtcbiAgdmFyIGZpcnN0SW5kZW50ID0gMDtcbiAgdmFyIGkgPSAwO1xuXG4gIC8vIGZvciAoOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgLy8gICBsaW5lID0gbGluZXNbaV07XG4gIC8vICAgaWYgKGxpbmUubGVuZ3RoID4gdGhpcy5tYXhMaW5lKSB7XG4gIC8vICAgICBsb25nLnB1c2gobGluZXMuc3BsaWNlKGktLSwgMSwgJ1xcdWVlZWUnKSk7XG4gIC8vICAgfVxuICAvLyB9XG5cbiAgaSA9IDA7XG4gIGxpbmUgPSBsaW5lc1tpXTtcbiAgLy8gY29uc29sZS5sb2cobGluZSlcbiAgd2hpbGUgKCEobWF0Y2ggPSAvXFxTL2cuZXhlYyhsaW5lKSkpIHtcbiAgICBsaW5lID0gbGluZXNbKytpXTtcbiAgICAvLyBjb25zb2xlLmxvZyhsaW5lKVxuICB9XG4gIGZvciAodmFyIGogPSAwOyBqIDwgaTsgaisrKSB7XG4gICAgbGluZXNbal0gPSBuZXcgQXJyYXkobWF0Y2guaW5kZXggKyAxKS5qb2luKCcgJyk7XG4gIH1cbiAgdmFyIHByZXY7XG4gIGZvciAoOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBsaW5lID0gbGluZXNbaV07XG4gICAgcHJldiA9IGxpbmVzW2ktMV07XG4gICAgaWYgKCFsaW5lLmxlbmd0aCAmJiBwcmV2Lmxlbmd0aCAmJiBwcmV2WzBdID09PSAnICcgJiYgcHJldltwcmV2Lmxlbmd0aC0xXSAhPT0gJy8nKSBsaW5lc1tpXSA9ICcgJztcbiAgfVxuXG4gIGNvZGUgPSBsaW5lcy5qb2luKCdcXG4nKTtcblxuICByZXR1cm4gY29kZTtcbn07XG5cblN5bnRheC5wcm90b3R5cGUucmVzdG9yZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdmFyIGJsb2NrO1xuICB2YXIgYmxvY2tzID0gdGhpcy5ibG9ja3M7XG4gIHZhciBuID0gMDtcbiAgcmV0dXJuIGNvZGUucmVwbGFjZSgvXFx1ZmZlYi9nLCBmdW5jdGlvbigpIHtcbiAgICBibG9jayA9IGJsb2Nrc1tuKytdXG4gICAgdmFyIHRhZyA9IGlkZW50aWZ5KGJsb2NrKTtcbiAgICByZXR1cm4gJzwnK3RhZysnPicrZW50aXRpZXMoYmxvY2spKyc8LycrdGFnKyc+JztcbiAgfSk7XG59O1xuXG5TeW50YXgucHJvdG90eXBlLmNyZWF0ZUJsb2NrcyA9IGZ1bmN0aW9uKGNvZGUpIHtcbiAgdGhpcy5ibG9ja3MgPSBbXTtcbiAgY29kZSA9IGNvZGUucmVwbGFjZShCbG9ja3MsIChibG9jaykgPT4ge1xuICAgIHRoaXMuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgIHJldHVybiAnXFx1ZmZlYic7XG4gIH0pO1xuICByZXR1cm4gY29kZTtcbn07XG5cbmZ1bmN0aW9uIGNyZWF0ZUlkKCkge1xuICB2YXIgYWxwaGFiZXQgPSAnYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXonO1xuICB2YXIgbGVuZ3RoID0gYWxwaGFiZXQubGVuZ3RoIC0gMTtcbiAgdmFyIGkgPSA2O1xuICB2YXIgcyA9ICcnO1xuICB3aGlsZSAoaS0tKSB7XG4gICAgcyArPSBhbHBoYWJldFtNYXRoLnJhbmRvbSgpICogbGVuZ3RoIHwgMF07XG4gIH1cbiAgcmV0dXJuIHM7XG59XG5cbmZ1bmN0aW9uIGVudGl0aWVzKHRleHQpIHtcbiAgcmV0dXJuIHRleHRcbiAgICAucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgO1xufVxuXG5mdW5jdGlvbiBjb21waWxlKHJlZ2V4cCwgdGFnKSB7XG4gIHZhciBvcGVuVGFnID0gJzwnICsgdGFnICsgJz4nO1xuICB2YXIgY2xvc2VUYWcgPSAnPC8nICsgdGFnICsgJz4nO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IHRhZyxcbiAgICByZWdleHA6IHJlZ2V4cCxcbiAgICByZXBsYWNlcjogb3BlblRhZyArICckJicgKyBjbG9zZVRhZ1xuICB9O1xufVxuXG5mdW5jdGlvbiBtYXAob2JqLCBmbikge1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICByZXN1bHRba2V5XSA9IGZuKG9ialtrZXldLCBrZXkpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2UocGFzcywgY29kZSkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhc3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlID0gY29kZS5yZXBsYWNlKHBhc3NbaV1bMF0sIHBhc3NbaV1bMV0pO1xuICB9XG4gIHJldHVybiBjb2RlO1xufVxuXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcbiAgcmV0dXJuIHN0cmluZy5zbGljZSgwLCBvZmZzZXQpICsgcGFydCArIHN0cmluZy5zbGljZShvZmZzZXQpO1xufVxuXG5mdW5jdGlvbiBpZGVudGlmeShibG9jaykge1xuICB2YXIgb25lID0gYmxvY2tbMF07XG4gIHZhciB0d28gPSBvbmUgKyBibG9ja1sxXTtcbiAgcmV0dXJuIFRhZ1t0d29dIHx8IFRhZ1tvbmVdO1xufVxuIiwidmFyIG9wZW4gPSByZXF1aXJlKCcuLi9saWIvb3BlbicpO1xudmFyIHNhdmUgPSByZXF1aXJlKCcuLi9saWIvc2F2ZScpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnLi9idWZmZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaWxlO1xuXG5mdW5jdGlvbiBGaWxlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMucm9vdCA9ICcnO1xuICB0aGlzLnBhdGggPSAndW50aXRsZWQnO1xuICB0aGlzLmJ1ZmZlciA9IG5ldyBCdWZmZXI7XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cbkZpbGUucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuRmlsZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYnVmZmVyLm9uKCdyYXcnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncmF3JykpO1xuICB0aGlzLmJ1ZmZlci5vbignc2V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3NldCcpKTtcbiAgdGhpcy5idWZmZXIub24oJ3VwZGF0ZScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdjaGFuZ2UnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdiZWZvcmUgdXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2JlZm9yZSBjaGFuZ2UnKSk7XG59O1xuXG5GaWxlLnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgcm9vdCwgZm4pIHtcbiAgdGhpcy5wYXRoID0gcGF0aDtcbiAgdGhpcy5yb290ID0gcm9vdDtcbiAgb3Blbihyb290ICsgcGF0aCwgKGVyciwgdGV4dCkgPT4ge1xuICAgIGlmIChlcnIpIHtcbiAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgICAgZm4gJiYgZm4oZXJyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5idWZmZXIuc2V0KHRleHQpO1xuICAgIHRoaXMuZW1pdCgnb3BlbicpO1xuICAgIGZuICYmIGZuKG51bGwsIHRoaXMpO1xuICB9KTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICBzYXZlKHRoaXMucm9vdCArIHRoaXMucGF0aCwgdGhpcy5idWZmZXIuZ2V0KCksIGZuIHx8IG5vb3ApO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmJ1ZmZlci5zZXQodGV4dCk7XG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5mdW5jdGlvbiBub29wKCkgey8qIG5vb3AgKi99XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCcuLi9saWIvZXZlbnQnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uL2xpYi9kZWJvdW5jZScpO1xuXG4vKlxuICAgLiAuXG4tMSAwIDEgMiAzIDQgNVxuICAgblxuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBIaXN0b3J5O1xuXG5mdW5jdGlvbiBIaXN0b3J5KGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sb2cgPSBbXTtcbiAgdGhpcy5uZWVkbGUgPSAwO1xuICB0aGlzLnRpbWVvdXQgPSB0cnVlO1xuICB0aGlzLnRpbWVTdGFydCA9IDA7XG59XG5cbkhpc3RvcnkucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSGlzdG9yeS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAoRGF0ZS5ub3coKSAtIHRoaXMudGltZVN0YXJ0ID4gMjAwMCkgdGhpcy5hY3R1YWxseVNhdmUoKTtcbiAgdGhpcy50aW1lb3V0ID0gdGhpcy5kZWJvdW5jZWRTYXZlKCk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5kZWJvdW5jZWRTYXZlID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG59LCA3MDApO1xuXG5IaXN0b3J5LnByb3RvdHlwZS5hY3R1YWxseVNhdmUgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ3NhdmUnLCB0aGlzLm5lZWRsZSlcbiAgY2xlYXJUaW1lb3V0KHRoaXMudGltZW91dCk7XG4gIHRoaXMubG9nID0gdGhpcy5sb2cuc2xpY2UoMCwgKyt0aGlzLm5lZWRsZSk7XG4gIHRoaXMubG9nLnB1c2godGhpcy5jb21taXQoKSk7XG4gIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoO1xuICB0aGlzLnRpbWVTdGFydCA9IERhdGUubm93KCk7XG4gIHRoaXMudGltZW91dCA9IGZhbHNlO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUudW5kbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICBpZiAodGhpcy5uZWVkbGUgPiB0aGlzLmxvZy5sZW5ndGggLSAxKSB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aCAtIDE7XG5cbiAgdGhpcy5uZWVkbGUtLTtcblxuICBpZiAodGhpcy5uZWVkbGUgPCAwKSB0aGlzLm5lZWRsZSA9IDA7XG4gIC8vIGNvbnNvbGUubG9nKCd1bmRvJywgdGhpcy5uZWVkbGUsIHRoaXMubG9nLmxlbmd0aCAtIDEpXG5cbiAgdGhpcy5jaGVja291dCh0aGlzLm5lZWRsZSk7XG59O1xuXG5IaXN0b3J5LnByb3RvdHlwZS5yZWRvID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnRpbWVvdXQgIT09IGZhbHNlKSB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xuXG4gIHRoaXMubmVlZGxlKys7XG4gIC8vIGNvbnNvbGUubG9nKCdyZWRvJywgdGhpcy5uZWVkbGUsIHRoaXMubG9nLmxlbmd0aCAtIDEpXG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuXG4gIHRoaXMuY2hlY2tvdXQodGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY2hlY2tvdXQgPSBmdW5jdGlvbihuKSB7XG4gIHZhciBjb21taXQgPSB0aGlzLmxvZ1tuXTtcbiAgaWYgKCFjb21taXQpIHJldHVybjtcbiAgdGhpcy5lZGl0b3IubWFyay5hY3RpdmUgPSBjb21taXQubWFya0FjdGl2ZTtcbiAgdGhpcy5lZGl0b3IubWFyay5zZXQoY29tbWl0Lm1hcmsuY29weSgpKTtcbiAgdGhpcy5lZGl0b3Iuc2V0Q2FyZXQoY29tbWl0LmNhcmV0LmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLmJ1ZmZlci50ZXh0ID0gY29tbWl0LnRleHQuY29weSgpO1xuICB0aGlzLmVkaXRvci5idWZmZXIubGluZXMgPSBjb21taXQubGluZXMuY29weSgpO1xuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgdGV4dDogdGhpcy5lZGl0b3IuYnVmZmVyLnRleHQuY29weSgpLFxuICAgIGxpbmVzOiB0aGlzLmVkaXRvci5idWZmZXIubGluZXMuY29weSgpLFxuICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgfTtcbn07XG4iLCJ2YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcblxudmFyIFBBR0lOR19USFJPVFRMRSA9IDcwO1xuXG52YXIga2V5cyA9IG1vZHVsZS5leHBvcnRzID0ge1xuICAnY3RybCt6JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5oaXN0b3J5LnVuZG8oKTtcbiAgfSxcbiAgJ2N0cmwreSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaGlzdG9yeS5yZWRvKCk7XG4gIH0sXG5cbiAgJ2hvbWUnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYmVnaW5PZkxpbmUoKTtcbiAgfSxcbiAgJ2VuZCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5lbmRPZkxpbmUoKTtcbiAgfSxcbiAgJ3BhZ2V1cCc6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlVXAoKTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ3BhZ2Vkb3duJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VEb3duKCk7XG4gIH0sIFBBR0lOR19USFJPVFRMRSksXG4gICdjdHJsK3VwJzogdGhyb3R0bGUoZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLnBhZ2VVcCg2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2N0cmwrZG93bic6IHRocm90dGxlKGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5wYWdlRG93big2KTtcbiAgfSwgUEFHSU5HX1RIUk9UVExFKSxcbiAgJ2xlZnQnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSk7XG4gIH0sXG4gICd1cCc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKC0xKTtcbiAgfSxcbiAgJ3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5Q2hhcnMoKzEpO1xuICB9LFxuICAnZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxKTtcbiAgfSxcblxuICAnY3RybCtsZWZ0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgtMSk7XG4gIH0sXG4gICdjdHJsK3JpZ2h0JzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tb3ZlLmJ5V29yZCgrMSk7XG4gIH0sXG5cbiAgJ2N0cmwrYSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mRmlsZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5lbmRPZkZpbGUobnVsbCwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH0sXG5cbiAgJ2N0cmwrc2hpZnQrdXAnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMubWFyay5hY3RpdmUpIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgeyBiZWdpbjogdGhpcy5jYXJldC5wb3MsIGVuZDogdGhpcy5jYXJldC5wb3MgfSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygtMSwgdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgdGhpcy5tYXJrLmdldCgpKTtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcbiAgJ2N0cmwrc2hpZnQrZG93bic6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCB7IGJlZ2luOiB0aGlzLmNhcmV0LnBvcywgZW5kOiB0aGlzLmNhcmV0LnBvcyB9KTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5idWZmZXIubW92ZUFyZWFCeUxpbmVzKCsxLCB0aGlzLm1hcmsuZ2V0KCkpO1xuICAgICAgdGhpcy5tYXJrLnNoaWZ0QnlMaW5lcygrMSk7XG4gICAgICB0aGlzLm1vdmUuYnlMaW5lcygrMSwgdHJ1ZSk7XG4gICAgfVxuICB9LFxuXG4gICdlbnRlcic6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5zZXJ0KCdcXG4nKTtcbiAgfSxcblxuICAnYmFja3NwYWNlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcbiAgJ2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuZGVsZXRlKCk7XG4gIH0sXG4gICdjdHJsK2JhY2tzcGFjZSc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLm1vdmUuaXNCZWdpbk9mRmlsZSgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgICB0aGlzLm1vdmUuYnlXb3JkKC0xLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnc2hpZnQrY3RybCtiYWNrc3BhY2UnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmRlbGV0ZSgpO1xuICB9LFxuICAnY3RybCtkZWxldGUnOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5tb3ZlLmlzRW5kT2ZGaWxlKCkpIHJldHVybjtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLm1hcmtCZWdpbigpO1xuICAgIHRoaXMubW92ZS5ieVdvcmQoKzEsIHRydWUpO1xuICAgIHRoaXMubWFya1NldCgpO1xuICAgIHRoaXMuYmFja3NwYWNlKCk7XG4gIH0sXG4gICdzaGlmdCtjdHJsK2RlbGV0ZSc6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1hcmtTZXQoKTtcbiAgICB0aGlzLmJhY2tzcGFjZSgpO1xuICB9LFxuICAnc2hpZnQrZGVsZXRlJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQ2xlYXIodHJ1ZSk7XG4gICAgdGhpcy5tb3ZlLmJlZ2luT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgdGhpcy5tb3ZlLmVuZE9mTGluZShudWxsLCB0cnVlKTtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygrMSwgdHJ1ZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgdGhpcy5iYWNrc3BhY2UoKTtcbiAgfSxcblxuICAnc2hpZnQrY3RybCtkJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhZGQgPSAwO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciBsaW5lcyA9IGFyZWEuZW5kLnkgLSBhcmVhLmJlZ2luLnk7XG4gICAgaWYgKGxpbmVzICYmIGFyZWEuZW5kLnggPiAwKSBhZGQgKz0gMTtcbiAgICBpZiAoIWxpbmVzKSBhZGQgKz0gMTtcbiAgICBsaW5lcyArPSBhZGQ7XG4gICAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEuc2V0TGVmdCgwKS5hZGRCb3R0b20oYWRkKSk7XG4gICAgdGhpcy5idWZmZXIuaW5zZXJ0KHsgeDogMCwgeTogYXJlYS5lbmQueSB9LCB0ZXh0KTtcbiAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKGxpbmVzKTtcbiAgICB0aGlzLm1vdmUuYnlMaW5lcyhsaW5lcywgdHJ1ZSk7XG4gIH0sXG5cbiAgJ3NoaWZ0K2N0cmwrdXAnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLm1hcmtCZWdpbihmYWxzZSk7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgaWYgKHRoaXMuYnVmZmVyLm1vdmVBcmVhQnlMaW5lcygtMSwgYXJlYSkpIHtcbiAgICAgIHRoaXMubWFyay5zaGlmdEJ5TGluZXMoLTEpO1xuICAgICAgdGhpcy5tb3ZlLmJ5TGluZXMoLTEsIHRydWUpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCtkb3duJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIGlmICh0aGlzLmJ1ZmZlci5tb3ZlQXJlYUJ5TGluZXMoKzEsIGFyZWEpKSB7XG4gICAgICB0aGlzLm1hcmsuc2hpZnRCeUxpbmVzKCsxKTtcbiAgICAgIHRoaXMubW92ZS5ieUxpbmVzKCsxLCB0cnVlKTtcbiAgICB9XG4gIH0sXG5cbiAgJ3RhYic6IGZ1bmN0aW9uKCkge1xuICAgIHZhciByZXMgPSB0aGlzLnN1Z2dlc3QoKTtcbiAgICBpZiAoIXJlcykge1xuICAgICAgdGhpcy5pbnNlcnQoJyAgJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubWFya1NldEFyZWEocmVzLmFyZWEpO1xuICAgICAgdGhpcy5pbnNlcnQocmVzLm5vZGUudmFsdWUpO1xuICAgIH1cbiAgfSxcblxuICAnY3RybCtmJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kLm9wZW4oKTtcbiAgfSxcblxuICAnZjMnOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmZpbmRKdW1wKCsxKTtcbiAgfSxcbiAgJ3NoaWZ0K2YzJzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5maW5kSnVtcCgtMSk7XG4gIH0sXG5cbiAgJ2N0cmwrLyc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhZGQ7XG4gICAgdmFyIGFyZWE7XG4gICAgdmFyIHRleHQ7XG5cbiAgICB2YXIgY2xlYXIgPSBmYWxzZTtcbiAgICB2YXIgY2FyZXQgPSB0aGlzLmNhcmV0LmNvcHkoKTtcblxuICAgIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgICAgY2xlYXIgPSB0cnVlO1xuICAgICAgdGhpcy5tYXJrQ2xlYXIoKTtcbiAgICAgIHRoaXMubW92ZS5iZWdpbk9mTGluZShudWxsLCB0cnVlKTtcbiAgICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAgICB0aGlzLm1vdmUuZW5kT2ZMaW5lKG51bGwsIHRydWUpO1xuICAgICAgdGhpcy5tYXJrU2V0KCk7XG4gICAgICBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgICB0aGlzLm1hcmsuYWRkQm90dG9tKGFyZWEuZW5kLnggPiAwKS5zZXRMZWZ0KDApO1xuICAgICAgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEodGhpcy5tYXJrLmdldCgpKTtcbiAgICB9XG5cbiAgICAvL1RPRE86IHNob3VsZCBjaGVjayBpZiBsYXN0IGxpbmUgaGFzIC8vIGFsc29cbiAgICBpZiAodGV4dC50cmltTGVmdCgpLnN1YnN0cigwLDIpID09PSAnLy8nKSB7XG4gICAgICBhZGQgPSAtMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oLio/KVxcL1xcLyAoLispL2dtLCAnJDEkMicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhZGQgPSArMztcbiAgICAgIHRleHQgPSB0ZXh0LnJlcGxhY2UoL14oW1xcc10qKSguKykvZ20sICckMS8vICQyJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pbnNlcnQodGV4dCk7XG5cbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEuYWRkUmlnaHQoYWRkKSk7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9ICFjbGVhcjtcblxuICAgIGlmIChjYXJldC54KSBjYXJldC5hZGRSaWdodChhZGQpO1xuICAgIHRoaXMuc2V0Q2FyZXQoY2FyZXQpO1xuXG4gICAgaWYgKGNsZWFyKSB7XG4gICAgICB0aGlzLm1hcmtDbGVhcigpO1xuICAgIH1cbiAgfSxcblxuICAnc2hpZnQrY3RybCsvJzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIGNsZWFyID0gZmFsc2U7XG4gICAgdmFyIGFkZCA9IDA7XG4gICAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSBjbGVhciA9IHRydWU7XG4gICAgdmFyIGNhcmV0ID0gdGhpcy5jYXJldC5jb3B5KCk7XG4gICAgdGhpcy5tYXJrQmVnaW4oZmFsc2UpO1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHZhciB0ZXh0ID0gdGhpcy5idWZmZXIuZ2V0QXJlYShhcmVhKTtcbiAgICBpZiAodGV4dC5zbGljZSgwLDIpID09PSAnLyonICYmIHRleHQuc2xpY2UoLTIpID09PSAnKi8nKSB7XG4gICAgICB0ZXh0ID0gdGV4dC5zbGljZSgyLC0yKTtcbiAgICAgIGFkZCAtPSAyO1xuICAgICAgaWYgKGFyZWEuZW5kLnkgPT09IGFyZWEuYmVnaW4ueSkgYWRkIC09IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRleHQgPSAnLyonICsgdGV4dCArICcqLyc7XG4gICAgICBhZGQgKz0gMjtcbiAgICAgIGlmIChhcmVhLmVuZC55ID09PSBhcmVhLmJlZ2luLnkpIGFkZCArPSAyO1xuICAgIH1cbiAgICB0aGlzLmluc2VydCh0ZXh0KTtcbiAgICBhcmVhLmVuZC54ICs9IGFkZDtcbiAgICB0aGlzLm1hcmsuc2V0KGFyZWEpO1xuICAgIHRoaXMubWFyay5hY3RpdmUgPSAhY2xlYXI7XG4gICAgdGhpcy5zZXRDYXJldChjYXJldC5hZGRSaWdodChhZGQpKTtcbiAgICBpZiAoY2xlYXIpIHtcbiAgICAgIHRoaXMubWFya0NsZWFyKCk7XG4gICAgfVxuICB9LFxufTtcblxua2V5cy5zaW5nbGUgPSB7XG4gIC8vXG59O1xuXG4vLyBzZWxlY3Rpb24ga2V5c1xuWyAnaG9tZScsJ2VuZCcsXG4gICdwYWdldXAnLCdwYWdlZG93bicsXG4gICdsZWZ0JywndXAnLCdyaWdodCcsJ2Rvd24nLFxuICAnY3RybCtsZWZ0JywnY3RybCtyaWdodCdcbl0uZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAga2V5c1snc2hpZnQrJytrZXldID0gZnVuY3Rpb24oZSkge1xuICAgIHRoaXMubWFya0JlZ2luKCk7XG4gICAga2V5c1trZXldLmNhbGwodGhpcywgZSk7XG4gICAgdGhpcy5tYXJrU2V0KCk7XG4gIH07XG59KTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLm1vdXNlID0gbmV3IE1vdXNlKHRoaXMpO1xuICB0aGlzLnRleHQgPSBuZXcgVGV4dDtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSW5wdXQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuSW5wdXQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmJsdXIgPSB0aGlzLmJsdXIuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbiAgdGhpcy50ZXh0Lm9uKFsna2V5JywgJ3RleHQnXSwgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2lucHV0JykpO1xuICB0aGlzLnRleHQub24oJ2ZvY3VzJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2ZvY3VzJykpO1xuICB0aGlzLnRleHQub24oJ2JsdXInLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xuICB0aGlzLnRleHQucmVzZXQoKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS5ibHVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5ibHVyKCk7XG59O1xuXG5JbnB1dC5wcm90b3R5cGUuZm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy50ZXh0LmZvY3VzKCk7XG59O1xuIiwidmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vLi4vbGliL2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCcuLi8uLi9saWIvZGVib3VuY2UnKTtcbnZhciBQb2ludCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9wb2ludCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1vdXNlO1xuXG5mdW5jdGlvbiBNb3VzZSgpIHtcbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAgIC8vIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xuICAvLyB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub251cCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kb3duID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5kb3duID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkb3duJywgZSk7XG4gIHRoaXMub25jbGljayhlKTtcbiAgdGhpcy5tYXliZURyYWcoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbnVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLmVtaXQoJ3VwJywgZSk7XG4gIGlmICghdGhpcy5kb3duKSByZXR1cm47XG4gIHRoaXMuZG93biA9IG51bGw7XG4gIHRoaXMuZHJhZ0VuZCgpO1xuICB0aGlzLm1heWJlRHJhZ0VuZCgpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uY2xpY2sgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucmVzZXRDbGlja3MoKTtcbiAgdGhpcy5jbGlja3MgPSAodGhpcy5jbGlja3MgJSAzKSArIDE7XG4gIHRoaXMuZW1pdCgnY2xpY2snLCBlKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbm1heWJlZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG5cbiAgdmFyIGQgPVxuICAgICAgTWF0aC5hYnModGhpcy5wb2ludC54IC0gdGhpcy5kb3duLngpXG4gICAgKyBNYXRoLmFicyh0aGlzLnBvaW50LnkgLSB0aGlzLmRvd24ueSk7XG5cbiAgaWYgKGQgPiA1KSB7XG4gICAgdGhpcy5tYXliZURyYWdFbmQoKTtcbiAgICB0aGlzLmRyYWdCZWdpbigpO1xuICB9XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25kcmFnID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnBvaW50ID0gdGhpcy5nZXRQb2ludChlKTtcbiAgdGhpcy5lbWl0KCdkcmFnJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5tYXliZURyYWdFbmQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25tYXliZWRyYWcpO1xufTtcblxuTW91c2UucHJvdG90eXBlLmRyYWdCZWdpbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgYmVnaW4nKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9uZHJhZyk7XG4gIHRoaXMuZW1pdCgnZHJhZyBlbmQnKTtcbn07XG5cblxuTW91c2UucHJvdG90eXBlLnJlc2V0Q2xpY2tzID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuY2xpY2tzID0gMDtcbn0sIDM1MCk7XG5cbk1vdXNlLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKGUpIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogZS5jbGllbnRYLFxuICAgIHk6IGUuY2xpZW50WVxuICB9KTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnLi4vLi4vbGliL2RlYm91bmNlJyk7XG52YXIgdGhyb3R0bGUgPSByZXF1aXJlKCcuLi8uLi9saWIvdGhyb3R0bGUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xuXG52YXIgVEhST1RUTEUgPSAxMDAwLzc1O1xuXG52YXIgbWFwID0ge1xuICA4OiAnYmFja3NwYWNlJyxcbiAgOTogJ3RhYicsXG4gIDEzOiAnZW50ZXInLFxuICAzMzogJ3BhZ2V1cCcsXG4gIDM0OiAncGFnZWRvd24nLFxuICAzNTogJ2VuZCcsXG4gIDM2OiAnaG9tZScsXG4gIDM3OiAnbGVmdCcsXG4gIDM4OiAndXAnLFxuICAzOTogJ3JpZ2h0JyxcbiAgNDA6ICdkb3duJyxcbiAgNDY6ICdkZWxldGUnLFxuICA0ODogJzAnLFxuICA0OTogJzEnLFxuICA1MDogJzInLFxuICA1MTogJzMnLFxuICA1MjogJzQnLFxuICA1MzogJzUnLFxuICA1NDogJzYnLFxuICA1NTogJzcnLFxuICA1NjogJzgnLFxuICA1NzogJzknLFxuICA2NTogJ2EnLFxuICA2ODogJ2QnLFxuICA3MDogJ2YnLFxuICA3NzogJ20nLFxuICA3ODogJ24nLFxuICA4MzogJ3MnLFxuICA4OTogJ3knLFxuICA5MDogJ3onLFxuICAxMTI6ICdmMScsXG4gIDExNDogJ2YzJyxcbiAgMTIyOiAnZjExJyxcbiAgMTg4OiAnLCcsXG4gIDE5MDogJy4nLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0Jyk7XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHtcbiAgICBwb3NpdGlvbjogJ2Fic29sdXRlJyxcbiAgICBsZWZ0OiAwLFxuICAgIHRvcDogMCxcbiAgICB3aWR0aDogMSxcbiAgICBoZWlnaHQ6IDEsXG4gICAgb3BhY2l0eTogMFxuICB9KTtcblxuICBkb20uYXR0cnModGhpcywge1xuICAgIGF1dG9jYXBpdGFsaXplOiAnbm9uZSdcbiAgfSk7XG5cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuICB0aGlzLm1vZGlmaWVycyA9IHt9O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5UZXh0LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cblRleHQucHJvdG90eXBlLmJpbmRFdmVudCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm9uY3V0ID0gdGhpcy5vbmN1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9uY29weSA9IHRoaXMub25jb3B5LmJpbmQodGhpcyk7XG4gIHRoaXMub25wYXN0ZSA9IHRoaXMub25wYXN0ZS5iaW5kKHRoaXMpO1xuICB0aGlzLm9uaW5wdXQgPSB0aGlzLm9uaW5wdXQuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmtleWRvd24gPSB0aGlzLm9ua2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXAuYmluZCh0aGlzKTtcbiAgdGhpcy5lbC5vbmJsdXIgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmx1cicpO1xuICB0aGlzLmVsLm9uZm9jdXMgPSB0aGlzLmVtaXQuYmluZCh0aGlzLCAnZm9jdXMnKTtcbiAgdGhpcy5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmVsLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLmVsLm9ua2V5dXAgPSB0aGlzLm9ua2V5dXA7XG4gIHRoaXMuZWwub25jdXQgPSB0aGlzLm9uY3V0O1xuICB0aGlzLmVsLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLmVsLm9ucGFzdGUgPSB0aGlzLm9ucGFzdGU7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnNldCgnJyk7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG59XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lbC52YWx1ZS5zdWJzdHIoLTEpO1xufTtcblxuVGV4dC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgdGhpcy5lbC52YWx1ZSA9IHZhbHVlO1xufTtcblxuLy9UT0RPOiBvbiBtb2JpbGUgd2UgbmVlZCB0byBjbGVhciB3aXRob3V0IGRlYm91bmNlXG4vLyBvciB0aGUgdGV4dGFyZWEgY29udGVudCBpcyBkaXNwbGF5ZWQgaW4gaGFja2VyJ3Mga2V5Ym9hcmRcbi8vIG9yIHlvdSBuZWVkIHRvIGRpc2FibGUgd29yZCBzdWdnZXN0aW9ucyBpbiBoYWNrZXIncyBrZXlib2FyZCBzZXR0aW5nc1xuVGV4dC5wcm90b3R5cGUuY2xlYXIgPSB0aHJvdHRsZShmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXQoJycpO1xufSwgMjAwMCk7XG5cblRleHQucHJvdG90eXBlLmJsdXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2ZvY3VzJylcbiAgdGhpcy5lbC5ibHVyKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5mb2N1cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjb25zb2xlLmxvZygnZm9jdXMnKVxuICB0aGlzLmVsLmZvY3VzKCk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmlucHV0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIC8vIGZvcmNlcyBjYXJldCB0byBlbmQgb2YgdGV4dGFyZWEgc28gd2UgY2FuIGdldCAuc2xpY2UoLTEpIGNoYXJcbiAgc2V0SW1tZWRpYXRlKCgpID0+IHRoaXMuZWwuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLmVsLnZhbHVlLmxlbmd0aCk7XG4gIHRoaXMuZW1pdCgndGV4dCcsIHRoaXMuZ2V0KCkpO1xuICB0aGlzLmNsZWFyKCk7XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ua2V5ZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgLy8gY29uc29sZS5sb2coZS53aGljaCk7XG4gIHZhciBub3cgPSBEYXRlLm5vdygpO1xuICBpZiAobm93IC0gdGhpcy50aHJvdHRsZVRpbWUgPCBUSFJPVFRMRSkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgdGhpcy50aHJvdHRsZVRpbWUgPSBub3c7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcbiAgbS5zaGlmdCA9IGUuc2hpZnRLZXk7XG4gIG0uY3RybCA9IGUuY3RybEtleTtcbiAgbS5hbHQgPSBlLmFsdEtleTtcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCkga2V5cy5wdXNoKCdzaGlmdCcpO1xuICBpZiAobS5jdHJsKSBrZXlzLnB1c2goJ2N0cmwnKTtcbiAgaWYgKG0uYWx0KSBrZXlzLnB1c2goJ2FsdCcpO1xuICBpZiAoZS53aGljaCBpbiBtYXApIGtleXMucHVzaChtYXBbZS53aGljaF0pO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXl1cCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy50aHJvdHRsZVRpbWUgPSAwO1xuXG4gIHZhciBtID0gdGhpcy5tb2RpZmllcnM7XG5cbiAgdmFyIGtleXMgPSBbXTtcbiAgaWYgKG0uc2hpZnQgJiYgIWUuc2hpZnRLZXkpIGtleXMucHVzaCgnc2hpZnQ6dXAnKTtcbiAgaWYgKG0uY3RybCAmJiAhZS5jdHJsS2V5KSBrZXlzLnB1c2goJ2N0cmw6dXAnKTtcbiAgaWYgKG0uYWx0ICYmICFlLmFsdEtleSkga2V5cy5wdXNoKCdhbHQ6dXAnKTtcblxuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSArICc6dXAnKTtcblxuICBpZiAoa2V5cy5sZW5ndGgpIHtcbiAgICB2YXIgcHJlc3MgPSBrZXlzLmpvaW4oJysnKTtcbiAgICB0aGlzLmVtaXQoJ2tleXMnLCBwcmVzcywgZSk7XG4gICAgdGhpcy5lbWl0KHByZXNzLCBlKTtcbiAgICBrZXlzLmZvckVhY2goKHByZXNzKSA9PiB0aGlzLmVtaXQoJ2tleScsIHByZXNzLCBlKSk7XG4gIH1cbn07XG5cblRleHQucHJvdG90eXBlLm9uY3V0ID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgnY3V0JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmNvcHkgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjb3B5JywgZSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbnBhc3RlID0gZnVuY3Rpb24oZSkge1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuZW1pdCgncGFzdGUnLCBlKTtcbn07XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vbGliL3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnLi4vbGliL2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCcuLi9saWIvcG9pbnQnKTtcblxudmFyIFdPUkRTID0gUmVnZXhwLmNyZWF0ZShbJ3dvcmRzJ10sICdnJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTW92ZTtcblxuZnVuY3Rpb24gTW92ZShlZGl0b3IpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbn1cblxuTW92ZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3ZlLnByb3RvdHlwZS5wYWdlRG93biA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCBzaXplIC0gcmVtYWluZGVyKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcyhwYWdlKTtcbn07XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VVcCA9IGZ1bmN0aW9uKGRpdikge1xuICBkaXYgPSBkaXYgfHwgMTtcbiAgdmFyIHBhZ2UgPSB0aGlzLmVkaXRvci5wYWdlLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciBzaXplID0gdGhpcy5lZGl0b3Iuc2l6ZS5oZWlnaHQgLyBkaXYgfCAwO1xuICB2YXIgcmVtYWluZGVyID0gc2l6ZSAtIHBhZ2UgKiB0aGlzLmVkaXRvci5jaGFyLmhlaWdodCB8IDA7XG4gIHRoaXMuZWRpdG9yLmFuaW1hdGVTY3JvbGxCeSgwLCAtKHNpemUgLSByZW1haW5kZXIpKTtcbiAgcmV0dXJuIHRoaXMuYnlMaW5lcygtcGFnZSk7XG59O1xuXG52YXIgbW92ZSA9IHt9O1xuXG5tb3ZlLmJ5V29yZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmUgPSBidWZmZXIuZ2V0TGluZShwLnkpO1xuXG4gIGlmIChkeCA+IDAgJiYgcC54ID49IGxpbmUubGVuZ3RoIC0gMSkgeyAvLyBhdCBlbmQgb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCArMSk7IC8vIG1vdmUgb25lIGNoYXIgcmlnaHRcbiAgfSBlbHNlIGlmIChkeCA8IDAgJiYgcC54ID09PSAwKSB7IC8vIGF0IGJlZ2luIG9mIGxpbmVcbiAgICByZXR1cm4gbW92ZS5ieUNoYXJzKGJ1ZmZlciwgcCwgLTEpOyAvLyBtb3ZlIG9uZSBjaGFyIGxlZnRcbiAgfVxuXG4gIHZhciB3b3JkcyA9IFJlZ2V4cC5wYXJzZShsaW5lLCBXT1JEUyk7XG4gIHZhciB3b3JkO1xuXG4gIGlmIChkeCA8IDApIHdvcmRzLnJldmVyc2UoKTtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHdvcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgd29yZCA9IHdvcmRzW2ldO1xuICAgIGlmIChkeCA+IDBcbiAgICAgID8gd29yZC5pbmRleCA+IHAueFxuICAgICAgOiB3b3JkLmluZGV4IDwgcC54KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiB3b3JkLmluZGV4LFxuICAgICAgICB5OiBwLnlcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gcmVhY2hlZCBiZWdpbi9lbmQgb2YgZmlsZVxuICByZXR1cm4gZHggPiAwXG4gICAgPyBtb3ZlLmVuZE9mTGluZShidWZmZXIsIHApXG4gICAgOiBtb3ZlLmJlZ2luT2ZMaW5lKGJ1ZmZlciwgcCk7XG59O1xuXG5tb3ZlLmJ5Q2hhcnMgPSBmdW5jdGlvbihidWZmZXIsIHAsIGR4KSB7XG4gIHZhciBsaW5lcyA9IGJ1ZmZlci5saW5lcztcbiAgdmFyIHggPSBwLng7XG4gIHZhciB5ID0gcC55O1xuXG4gIGlmIChkeCA8IDApIHsgLy8gZ29pbmcgbGVmdFxuICAgIHggKz0gZHg7IC8vIG1vdmUgbGVmdFxuICAgIGlmICh4IDwgMCkgeyAvLyB3aGVuIHBhc3QgbGVmdCBlZGdlXG4gICAgICBpZiAoeSA+IDApIHsgLy8gYW5kIGxpbmVzIGFib3ZlXG4gICAgICAgIHkgLT0gMTsgLy8gbW92ZSB1cCBhIGxpbmVcbiAgICAgICAgeCA9IGxpbmVzLmdldExpbmVMZW5ndGgoeSk7IC8vIGFuZCBnbyB0byB0aGUgZW5kIG9mIGxpbmVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHggPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIGlmIChkeCA+IDApIHsgLy8gZ29pbmcgcmlnaHRcbiAgICB4ICs9IGR4OyAvLyBtb3ZlIHJpZ2h0XG4gICAgd2hpbGUgKHggLSBsaW5lcy5nZXRMaW5lTGVuZ3RoKHkpID4gMCkgeyAvLyB3aGlsZSBwYXN0IGxpbmUgbGVuZ3RoXG4gICAgICBpZiAoeSA9PT0gbGluZXMubGVuZ3RoKSB7IC8vIG9uIGVuZCBvZiBmaWxlXG4gICAgICAgIHggPSBsaW5lcy5nZXRMaW5lTGVuZ3RoKHkpOyAvLyBnbyB0byBlbmQgb2YgbGluZSBvbiBsYXN0IGxpbmVcbiAgICAgICAgYnJlYWs7IC8vIGFuZCBleGl0XG4gICAgICB9XG4gICAgICB4IC09IGxpbmVzLmdldExpbmVMZW5ndGgoeSkgKyAxOyAvLyB3cmFwIHRoaXMgbGluZSBsZW5ndGhcbiAgICAgIHkgKz0gMTsgLy8gYW5kIG1vdmUgZG93biBhIGxpbmVcbiAgICB9XG4gIH1cblxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYnlMaW5lcyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHkpIHtcbiAgdmFyIGxpbmVzID0gYnVmZmVyLmxpbmVzO1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR5IDwgMCkgeyAvLyBnb2luZyB1cFxuICAgIGlmICh5ICsgZHkgPiAwKSB7IC8vIHdoZW4gbGluZXMgYWJvdmVcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgdXBcbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IDA7XG4gICAgfVxuICB9IGVsc2UgaWYgKGR5ID4gMCkgeyAvLyBnb2luZyBkb3duXG4gICAgaWYgKHkgPCBsaW5lcy5sZW5ndGggLSBkeSkgeyAvLyB3aGVuIGxpbmVzIGJlbG93XG4gICAgICB5ICs9IGR5OyAvLyBtb3ZlIGRvd25cbiAgICB9IGVsc2Uge1xuICAgICAgeSA9IGxpbmVzLmxlbmd0aDtcbiAgICB9XG4gIH1cblxuICAvLyBpZiAoeCA+IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoKSB7XG4gIC8vICAgeCA9IGxpbmVzLmdldExpbmUoeSkubGVuZ3RoO1xuICAvLyB9IGVsc2Uge1xuICAvLyB9XG4gIHggPSBNYXRoLm1pbih0aGlzLmxhc3REZWxpYmVyYXRlWCwgbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpO1xuXG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiB5XG4gIH07XG59O1xuXG5tb3ZlLmJlZ2luT2ZMaW5lID0gZnVuY3Rpb24oXywgcCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuZW5kT2ZMaW5lID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciB4ID0gYnVmZmVyLmxpbmVzLmdldExpbmUocC55KS5sZW5ndGg7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gSW5maW5pdHk7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBwLnlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkZpbGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xuICByZXR1cm4ge1xuICAgIHg6IDAsXG4gICAgeTogMFxuICB9O1xufTtcblxubW92ZS5lbmRPZkZpbGUgPSBmdW5jdGlvbihidWZmZXIpIHtcbiAgdmFyIGxhc3QgPSBidWZmZXIubGluZXMubGVuZ3RoO1xuICB2YXIgeCA9IGJ1ZmZlci5saW5lcy5nZXRMaW5lKGxhc3QpLmxlbmd0aFxuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IHg7XG4gIHJldHVybiB7XG4gICAgeDogeCxcbiAgICB5OiBsYXN0XG4gIH07XG59O1xuXG5tb3ZlLmlzQmVnaW5PZkZpbGUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHJldHVybiBwLnggPT09IDAgJiYgcC55ID09PSAwO1xufTtcblxubW92ZS5pc0VuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCkge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5sb2M7XG4gIHJldHVybiBwLnkgPT09IGxhc3QgJiYgcC54ID09PSBidWZmZXIubGluZXMuZ2V0TGluZUxlbmd0aChsYXN0KTtcbn07XG5cbk9iamVjdC5rZXlzKG1vdmUpLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gIE1vdmUucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbihwYXJhbSwgYnlFZGl0KSB7XG4gICAgdmFyIHJlc3VsdCA9IG1vdmVbbWV0aG9kXS5jYWxsKFxuICAgICAgdGhpcyxcbiAgICAgIHRoaXMuZWRpdG9yLmJ1ZmZlcixcbiAgICAgIHRoaXMuZWRpdG9yLmNhcmV0LFxuICAgICAgcGFyYW1cbiAgICApO1xuXG4gICAgaWYgKCdpcycgPT09IG1ldGhvZC5zbGljZSgwLDIpKSByZXR1cm4gcmVzdWx0O1xuXG4gICAgdGhpcy5lbWl0KCdtb3ZlJywgcmVzdWx0LCBieUVkaXQpO1xuICB9O1xufSk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcImVkaXRvclwiOlwiX3NyY19zdHlsZV9fZWRpdG9yXCIsXCJsYXllclwiOlwiX3NyY19zdHlsZV9fbGF5ZXJcIixcInJvd3NcIjpcIl9zcmNfc3R5bGVfX3Jvd3NcIixcIm1hcmtcIjpcIl9zcmNfc3R5bGVfX21hcmtcIixcImNvZGVcIjpcIl9zcmNfc3R5bGVfX2NvZGVcIixcImNhcmV0XCI6XCJfc3JjX3N0eWxlX19jYXJldFwiLFwiZ3V0dGVyXCI6XCJfc3JjX3N0eWxlX19ndXR0ZXJcIixcInJ1bGVyXCI6XCJfc3JjX3N0eWxlX19ydWxlclwiLFwiYWJvdmVcIjpcIl9zcmNfc3R5bGVfX2Fib3ZlXCIsXCJmaW5kXCI6XCJfc3JjX3N0eWxlX19maW5kXCIsXCJibG9ja1wiOlwiX3NyY19zdHlsZV9fYmxvY2tcIn0iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vbGliL2RvbScpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4vc3R5bGUuY3NzJyk7XG5cbnZhciB0aGVtZXMgPSB7XG4gIG1vbm9rYWk6IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MjgyMicsXG4gICAgY29sb3I6ICcjRjhGOEYyJyxcbiAgICBrZXl3b3JkOiAnI0RGMjI2NicsXG4gICAgZnVuY3Rpb246ICcjQTBEOTJFJyxcbiAgICBkZWNsYXJlOiAnIzYxQ0NFMCcsXG4gICAgbnVtYmVyOiAnI0FCN0ZGQicsXG4gICAgcGFyYW1zOiAnI0ZEOTcxRicsXG4gICAgY29tbWVudDogJyM3NTcxNUUnLFxuICAgIHN0cmluZzogJyNFNkRCNzQnLFxuICB9LFxuXG4gIHdlc3Rlcm46IHtcbiAgICBiYWNrZ3JvdW5kOiAnI0Q5RDFCMScsXG4gICAgY29sb3I6ICcjMDAwMDAwJyxcbiAgICBrZXl3b3JkOiAnIzdBM0IzQicsXG4gICAgZnVuY3Rpb246ICcjMjU2Rjc1JyxcbiAgICBkZWNsYXJlOiAnIzYzNDI1NicsXG4gICAgbnVtYmVyOiAnIzEzNEQyNicsXG4gICAgcGFyYW1zOiAnIzA4MjY2MycsXG4gICAgY29tbWVudDogJyM5OThFNkUnLFxuICAgIHN0cmluZzogJyNDNDNDM0MnLFxuICB9LFxuXG4gIGVyZ29ub206IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzI3MUUxNicsXG4gICAgY29sb3I6ICcjRTlFM0QxJyxcbiAgICBrZXl3b3JkOiAnI0ExMzYzMCcsXG4gICAgZnVuY3Rpb246ICcjQjNERjAyJyxcbiAgICBkZWNsYXJlOiAnI0Y2MzgzMycsXG4gICAgbnVtYmVyOiAnI0ZGOUY0RScsXG4gICAgcGFyYW1zOiAnI0EwOTBBMCcsXG4gICAgcmVnZXhwOiAnI0JENzBGNCcsXG4gICAgY29tbWVudDogJyM2MzUwNDcnLFxuICAgIHN0cmluZzogJyMzRUExRkInLFxuICB9LFxuXG4gIGRheWxpZ2h0OiB7XG4gICAgYmFja2dyb3VuZDogJyNFQkVCRUInLFxuICAgIGNvbG9yOiAnIzAwMDAwMCcsXG4gICAga2V5d29yZDogJyNGRjFCMUInLFxuICAgIGZ1bmN0aW9uOiAnIzAwMDVGRicsXG4gICAgZGVjbGFyZTogJyMwQzdBMDAnLFxuICAgIG51bWJlcjogJyM4MDIxRDQnLFxuICAgIHBhcmFtczogJyM0QzY5NjknLFxuICAgIGNvbW1lbnQ6ICcjQUJBQkFCJyxcbiAgICBzdHJpbmc6ICcjRTY3MDAwJyxcbiAgfSxcbn07XG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHNldFRoZW1lO1xuZXhwb3J0cy50aGVtZXMgPSB0aGVtZXM7XG5cbmZ1bmN0aW9uIHNldFRoZW1lKG5hbWUpIHtcbiAgdmFyIHQgPSB0aGVtZXNbbmFtZV07XG4gIGRvbS5jc3MoJ3RoZW1lJyxcbmBcbi4ke25hbWV9IHtcbiAgYmFja2dyb3VuZDogJHt0LmJhY2tncm91bmR9O1xufVxuXG5vcGVyYXRvcixcbmtleXdvcmQge1xuICBjb2xvcjogJHt0LmtleXdvcmR9O1xufVxuXG5kZWNsYXJlLFxuYnVpbHRpbiB7XG4gIGNvbG9yOiAke3QuZGVjbGFyZX07XG59XG5cbmJvb2xlYW4sXG5udW1iZXIge1xuICBjb2xvcjogJHt0Lm51bWJlcn07XG59XG5cbnBhcmFtcyB7XG4gIGNvbG9yOiAke3QucGFyYW1zfTtcbn1cblxuZnVuY3Rpb24ge1xuICBjb2xvcjogJHt0LmZ1bmN0aW9ufTtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5yZWdleHAge1xuICBjb2xvcjogJHt0LnJlZ2V4cCB8fCB0LnBhcmFtc307XG59XG5cbmNvbW1lbnQge1xuICBjb2xvcjogJHt0LmNvbW1lbnR9O1xufVxuXG5zdHJpbmcge1xuICBjb2xvcjogJHt0LnN0cmluZ307XG59XG5cbnN5bWJvbCxcbi4ke2Nzcy5jb2RlfSB7XG4gIGNvbG9yOiAke3QuY29sb3J9O1xufVxuXG4uJHtjc3MuY2FyZXR9IHtcbiAgYmFja2dyb3VuZDogJHt0LmNvbG9yfTtcbn1cblxucGFyYW1zLFxuZGVjbGFyZSB7XG4gIGZvbnQtc3R5bGU6IGl0YWxpYztcbn1cblxuc3ltYm9sIHtcbiAgZm9udC1zdHlsZTogbm9ybWFsO1xufVxuXG5pbmRlbnQge1xuICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gIGJhY2tncm91bmQtcmVwZWF0OiBuby1yZXBlYXQ7XG59XG5gXG4gIClcblxufVxuXG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQmxvY2s7XG5cbmZ1bmN0aW9uIEJsb2NrKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCAxKTtcbn1cblxuQmxvY2sucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuQmxvY2sucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlbmRlclBhZ2UoMSwgdHJ1ZSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9yYW5nZScpO1xudmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGU7XG5cbmZ1bmN0aW9uIENvZGUobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEwKTtcbn1cblxuQ29kZS5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5Db2RlLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgLy8gdGhpcy5jbGVhcigpO1xuICAvLyByZXR1cm4gdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xuICBpZiAoIXRoaXMuZWRpdG9yLmVkaXRpbmcpIHRoaXMucmVuZGVyQWhlYWQoKTtcbn07XG5cbkNvZGUucHJvdG90eXBlLnJlbmRlckVkaXQgPSBmdW5jdGlvbihlZGl0KSB7XG4gIHZhciB5ID0gZWRpdC5saW5lO1xuICB2YXIgZyA9IGVkaXQucmFuZ2Uuc2xpY2UoKTtcbiAgdmFyIHNoaWZ0ID0gZWRpdC5zaGlmdDtcbiAgdmFyIGlzRW50ZXIgPSBzaGlmdCA+IDA7XG4gIHZhciBpc0JhY2tzcGFjZSA9IHNoaWZ0IDwgMDtcbiAgdmFyIGlzQmVnaW4gPSBnWzBdICsgaXNCYWNrc3BhY2UgPT09IDA7XG4gIHZhciBpc0VuZCA9IGdbMV0gKyBpc0VudGVyID09PSB0aGlzLmVkaXRvci5yb3dzO1xuXG4gIGlmIChzaGlmdCkge1xuICAgIGlmIChpc0VudGVyICYmICFpc0VuZCkgdGhpcy5zaGlmdFZpZXdzQmVsb3coZ1swXSwgc2hpZnQpO1xuICAgIGVsc2UgaWYgKGlzQmFja3NwYWNlICYmICFpc0JlZ2luKSB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhnWzBdLCBzaGlmdCk7XG4gIH1cblxuICB0aGlzLnVwZGF0ZVJhbmdlKGcpO1xuICB0aGlzLnJlbmRlclBhZ2UoMCk7XG59O1xuIiwidmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEZpbmQ7XG5cbmZ1bmN0aW9uIEZpbmQobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDQpO1xufVxuXG5GaW5kLnByb3RvdHlwZS5fX3Byb3RvX18gPSBMYXllci5wcm90b3R5cGU7XG5cbkZpbmQucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuZWRpdG9yLmZpbmQuaXNPcGVuIHx8ICF0aGlzLmVkaXRvci5maW5kUmVzdWx0cy5sZW5ndGgpIHJldHVybjtcbiAgdGhpcy5yZW5kZXJQYWdlKDApO1xufTtcbiIsInZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kZWJvdW5jZScpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIENvZGVWaWV3ID0gcmVxdWlyZSgnLi9jb2RlJyk7XG52YXIgTWFya1ZpZXcgPSByZXF1aXJlKCcuL21hcmsnKTtcbnZhciBSb3dzVmlldyA9IHJlcXVpcmUoJy4vcm93cycpO1xudmFyIEZpbmRWaWV3ID0gcmVxdWlyZSgnLi9maW5kJyk7XG52YXIgQmxvY2tWaWV3ID0gcmVxdWlyZSgnLi9ibG9jaycpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3cztcblxuZnVuY3Rpb24gVmlld3MoZWRpdG9yKSB7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuXG4gIHRoaXMudmlld3MgPSBbXG4gICAgbmV3IFZpZXcoJ3J1bGVyJywgZWRpdG9yLCB0ZW1wbGF0ZS5ydWxlciksXG4gICAgbmV3IFZpZXcoJ2NhcmV0JywgZWRpdG9yLCB0ZW1wbGF0ZS5jYXJldCksXG4gICAgbmV3IENvZGVWaWV3KCdjb2RlJywgZWRpdG9yLCB0ZW1wbGF0ZS5jb2RlKSxcbiAgICBuZXcgTWFya1ZpZXcoJ21hcmsnLCBlZGl0b3IsIHRlbXBsYXRlLm1hcmspLFxuICAgIG5ldyBSb3dzVmlldygncm93cycsIGVkaXRvciwgdGVtcGxhdGUucm93cyksXG4gICAgbmV3IEZpbmRWaWV3KCdmaW5kJywgZWRpdG9yLCB0ZW1wbGF0ZS5maW5kKSxcbiAgICBuZXcgQmxvY2tWaWV3KCdibG9jaycsIGVkaXRvciwgdGVtcGxhdGUuYmxvY2spLFxuICBdO1xuXG4gIHRoaXMudmlld3MuZm9yRWFjaCh2aWV3ID0+IHRoaXNbdmlldy5uYW1lXSA9IHZpZXcpO1xuICB0aGlzLmZvckVhY2ggPSB0aGlzLnZpZXdzLmZvckVhY2guYmluZCh0aGlzLnZpZXdzKTtcblxuICB0aGlzLmJsb2NrLnJlbmRlciA9IGRlYm91bmNlKHRoaXMuYmxvY2sucmVuZGVyLCA2MCk7XG5cbiAgLy9UT0RPOiBuZWVkcyB0byBiZSBzZXQgZHluYW1pY2FsbHlcbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuaGlkZV9yb3dzKSB0aGlzLnJvd3MucmVuZGVyID0gbm9vcDtcbn1cblxuVmlld3MucHJvdG90eXBlLmNsZWFyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcuY2xlYXIoKSk7XG59LFxuXG5WaWV3cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9yRWFjaCh2aWV3ID0+IHZpZXcucmVuZGVyKCkpO1xufTtcblxuZnVuY3Rpb24gbm9vcCgpIHsvKiBub29wICovfVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJy4uLy4uL2xpYi9ldmVudCcpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGNzcyA9IHJlcXVpcmUoJy4uL3N0eWxlLmNzcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IExheWVyO1xuXG5mdW5jdGlvbiBMYXllcihuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCBsZW5ndGgpIHtcbiAgdGhpcy5kb20gPSBkb20oY3NzLmxheWVyKTtcbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy52aWV3cyA9IHRoaXMuY3JlYXRlKGxlbmd0aCk7XG59XG5cbkxheWVyLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkxheWVyLnByb3RvdHlwZS5jcmVhdGUgPSBmdW5jdGlvbihsZW5ndGgpIHtcbiAgdmFyIHZpZXdzID0gbmV3IEFycmF5KGxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXSA9IG5ldyBWaWV3KHRoaXMubmFtZSwgdGhpcy5lZGl0b3IsIHRoaXMudGVtcGxhdGUpO1xuICAgIGRvbS5hcHBlbmQodGhpcywgdmlld3NbaV0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZXF1ZXN0VmlldyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKHZpZXcudmlzaWJsZSA9PT0gZmFsc2UpIHJldHVybiB2aWV3O1xuICB9XG4gIHJldHVybiB0aGlzLmNsZWFyKClbMF07XG59O1xuXG5MYXllci5wcm90b3R5cGUuZ2V0UGFnZVJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmV0dXJuIHRoaXMuZWRpdG9yLmdldFBhZ2VSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuaW5SYW5nZVZpZXdzID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIHZpZXdzID0gW107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAoIHZpZXcudmlzaWJsZSA9PT0gdHJ1ZVxuICAgICAgJiYgKCB2aWV3WzBdID49IHJhbmdlWzBdICYmIHZpZXdbMF0gPD0gcmFuZ2VbMV1cbiAgICAgICAgfHwgdmlld1sxXSA+PSByYW5nZVswXSAmJiB2aWV3WzFdIDw9IHJhbmdlWzFdICkgKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUub3V0UmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IGZhbHNlXG4gICAgICB8fCB2aWV3WzFdIDwgcmFuZ2VbMF1cbiAgICAgIHx8IHZpZXdbMF0gPiByYW5nZVsxXSApIHtcbiAgICAgIHZpZXdzLnB1c2godmlldyk7XG4gICAgfVxuICB9XG4gIHJldHVybiB2aWV3cy5zb3J0KChhLGIpID0+IGEubGFzdFVzZWQgLSBiLmxhc3RVc2VkKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJSYW5nZXMgPSBmdW5jdGlvbihyYW5nZXMsIHZpZXdzKSB7XG4gIGZvciAodmFyIG4gPSAwLCBpID0gMDsgaSA8IHJhbmdlcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciByYW5nZSA9IHJhbmdlc1tpXTtcbiAgICB2YXIgdmlldyA9IHZpZXdzW24rK107XG4gICAgdmlldy5yZW5kZXIocmFuZ2UpO1xuICB9XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgaW5jbHVkZSkge1xuICB2YXIgdmlzaWJsZVJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWzAsMF0pO1xuICB2YXIgaW5WaWV3cyA9IHRoaXMuaW5SYW5nZVZpZXdzKHJhbmdlKTtcbiAgdmFyIG91dFZpZXdzID0gdGhpcy5vdXRSYW5nZVZpZXdzKG1heChyYW5nZSwgdmlzaWJsZVJhbmdlKSk7XG5cbiAgdmFyIG5lZWRSYW5nZXMgPSBSYW5nZS5OT1QocmFuZ2UsIGluVmlld3MpO1xuICB2YXIgbmVlZFZpZXdzID0gbmVlZFJhbmdlcy5sZW5ndGggLSBvdXRWaWV3cy5sZW5ndGg7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ25lZWQ6JywgbmVlZFZpZXdzLCBuZWVkUmFuZ2VzLmpvaW4oJyAnKSk7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ2hhdmU6JywgdGhpcy52aWV3cy5qb2luKCcgJykpO1xuICAvLyBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUpIGNvbnNvbGUubG9nKCdvdXQ6Jywgb3V0Vmlld3Muam9pbignICcpKTtcbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSBjb25zb2xlLmxvZygncmFuZ2UnLCByYW5nZSwgaW5WaWV3cy5qb2luKCcgJykpO1xuICBpZiAobmVlZFZpZXdzID4gMCkge1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlbmRlclJhbmdlcyhbdmlzaWJsZVJhbmdlXSwgdGhpcy52aWV3cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGVsc2UgaWYgKGluY2x1ZGUpIHRoaXMucmVuZGVyVmlld3MoaW5WaWV3cyk7XG4gIHRoaXMucmVuZGVyUmFuZ2VzKG5lZWRSYW5nZXMsIG91dFZpZXdzKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJWaWV3cyA9IGZ1bmN0aW9uKHZpZXdzKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2aWV3c1tpXS5yZW5kZXIoKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckxpbmUgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMucmVuZGVyUmFuZ2UoW3kseV0sIHRydWUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclBhZ2UgPSBmdW5jdGlvbihuLCBpbmNsdWRlKSB7XG4gIG4gPSBuIHx8IDA7XG4gIHRoaXMucmVuZGVyUmFuZ2UodGhpcy5nZXRQYWdlUmFuZ2UoWy1uLCtuXSksIGluY2x1ZGUpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlckFoZWFkID0gZnVuY3Rpb24oaW5jbHVkZSkge1xuICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICB2YXIgY3VycmVudFBhZ2VSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcblxuICAvLyBubyB2aWV3IGlzIHZpc2libGUsIHJlbmRlciBjdXJyZW50IHBhZ2Ugb25seVxuICBpZiAoUmFuZ2UuQU5EKGN1cnJlbnRQYWdlUmFuZ2UsIHZpZXdzKS5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLnJlbmRlclBhZ2UoMCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gY2hlY2sgaWYgd2UncmUgcGFzdCB0aGUgdGhyZXNob2xkIG9mIHZpZXdcbiAgdmFyIGFoZWFkUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbLTEsKzFdKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB2aWV3cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG4gICAgdGhpcy5yZW5kZXJQYWdlKDIsIGluY2x1ZGUpO1xuICB9XG59O1xuXG4vKlxuXG4xICB4XG4yIC14XG4zIC14XG40IC1cbjVcbjZcblxuICovXG5cbkxheWVyLnByb3RvdHlwZS5zcGxpY2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcblxuICAgIGlmICh2aWV3WzFdIDwgcmFuZ2VbMF0gfHwgdmlld1swXSA+IHJhbmdlWzFdKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAodmlld1swXSA8IHJhbmdlWzBdICYmIHZpZXdbMV0gPj0gcmFuZ2VbMF0pIHsgLy8gc2hvcnRlbiBhYm92ZVxuICAgICAgdmlld1sxXSA9IHJhbmdlWzBdIC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMV0gPiByYW5nZVsxXSkgeyAvLyBzaG9ydGVuIGJlbG93XG4gICAgICB2aWV3WzBdID0gcmFuZ2VbMV0gKyAxO1xuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMF0gPT09IHJhbmdlWzBdICYmIHZpZXdbMV0gPT09IHJhbmdlWzFdKSB7IC8vIGN1cnJlbnQgbGluZVxuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmlldy5jbGVhcigpO1xuICAgIH1cbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnNoaWZ0Vmlld3NCZWxvdyA9IGZ1bmN0aW9uKHksIGR5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5KSBjb250aW51ZTtcblxuICAgIHZpZXdbMF0gKz0gZHk7XG4gICAgdmlld1sxXSArPSBkeTtcbiAgICB2aWV3LnN0eWxlKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS51cGRhdGVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHRoaXMuc3BsaWNlUmFuZ2UocmFuZ2UpO1xuICB0aGlzLnJlbmRlclJhbmdlKHJhbmdlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLnZpZXdzW2ldLmNsZWFyKCk7XG4gIH1cbiAgcmV0dXJuIHRoaXMudmlld3M7XG59O1xuXG5mdW5jdGlvbiBtYXgoYSwgYikge1xuICByZXR1cm4gW01hdGgubWluKGFbMF0sIGJbMF0pLCBNYXRoLm1heChhWzFdLCBiWzFdKV07XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnLi4vLi4vbGliL2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgnLi4vLi4vbGliL3JhbmdlJyk7XG52YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gTWFyaztcblxuZnVuY3Rpb24gTWFyayhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgMSk7XG59XG5cbk1hcmsucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuTWFyay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IubWFyay5hY3RpdmUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG4gIHRoaXMucmVuZGVyUGFnZSgwLCB0cnVlKTtcbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUm93cztcblxuZnVuY3Rpb24gUm93cyhuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNSk7XG59XG5cblJvd3MucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuUm93cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0U2hpZnQpIHtcbiAgICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICAgIHZhciByb3dzID0gdGhpcy5lZGl0b3Iucm93cztcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgdmlldyA9IHZpZXdzW2ldO1xuICAgICAgdmFyIHIgPSB2aWV3O1xuICAgICAgaWYgKCF2aWV3LnZpc2libGUpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAoclsxXSA+IHJvd3MpIHZpZXcuY2xlYXIoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJBaGVhZCgpO1xufTtcbiIsInZhciB0ZW1wbGF0ZSA9IGV4cG9ydHM7XG5cbnRlbXBsYXRlLmNvZGUgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICAvLyBpZiAodGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID09PSBjb2RlKSB7XG4gIC8vICAgcmV0dXJuIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5yZXN1bHQ7XG4gIC8vIH0gZWxzZSB7XG4gIC8vICAgdGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID0gY29kZTtcbiAgLy8gICB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucmVzdWx0ID0gZmFsc2U7XG4gIC8vIH1cblxuICB2YXIgaHRtbCA9IGUuYnVmZmVyLmdldEhpZ2hsaWdodGVkKHJhbmdlKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbi8vIHNpbmdsZXRvbiBtZW1vaXplIGZvciBmYXN0IGxhc3QgcmVwZWF0aW5nIHZhbHVlXG50ZW1wbGF0ZS5jb2RlLm1lbW9pemUgPSB7XG4gIHBhcmFtOiAnJyxcbiAgcmVzdWx0OiAnJ1xufTtcblxudGVtcGxhdGUucm93cyA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBzID0gJyc7XG4gIGZvciAodmFyIGkgPSByYW5nZVswXTsgaSA8PSByYW5nZVsxXTsgaSsrKSB7XG4gICAgcyArPSAoaSArIDEpICsgJ1xcbic7XG4gIH1cbiAgcmV0dXJuIHM7XG59O1xuXG50ZW1wbGF0ZS5tYXJrID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmxpbmVzLmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5saW5lcy5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXQpO1xuXG4gIGFyZWFbMF0gLT0gb2Zmc2V0WzBdO1xuICBhcmVhWzFdIC09IG9mZnNldFswXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKSArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICAgKyAnd2lkdGg6JyArIHdpZHRoICsgJzsnXG4gICAgICAgICAgKyAndG9wOicgKyAoci55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICAgICsgJ2xlZnQ6JyArIChyLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIC8vXG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIGlmIChlLmVkaXRpbmcpIHJldHVybiAnJztcblxuICB2YXIgb2Zmc2V0ID0gZS5idWZmZXIubGluZXMuZ2V0KHJhbmdlWzBdKTtcbiAgdmFyIHRhcmdldCA9IGUuYnVmZmVyLmxpbmVzLmdldFBvaW50KGUuY2FyZXQpLm9mZnNldDtcbiAgdmFyIGNvZGUgPSBlLmJ1ZmZlci5nZXQocmFuZ2UpO1xuICB2YXIgaSA9IHRhcmdldCAtIG9mZnNldDtcbiAgdmFyIGNoYXI7XG5cbiAgdmFyIE9wZW4gPSB7XG4gICAgJ3snOiAnY3VybHknLFxuICAgICdbJzogJ3NxdWFyZScsXG4gICAgJygnOiAncGFyZW5zJ1xuICB9O1xuXG4gIHZhciBDbG9zZSA9IHtcbiAgICAnfSc6ICdjdXJseScsXG4gICAgJ10nOiAnc3F1YXJlJyxcbiAgICAnKSc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIG9wZW47XG4gIHZhciBjbG9zZTtcblxuICB2YXIgY291bnQgPSAxO1xuICBpIC09IDE7XG4gIHdoaWxlIChpID4gMCkge1xuICAgIGNoYXIgPSBjb2RlW2ldO1xuICAgIG9wZW4gPSBPcGVuW2NoYXJdO1xuICAgIGlmIChDbG9zZVtjaGFyXSkgY291bnQrKztcbiAgICBpZiAob3BlbiAmJiAhLS1jb3VudCkgYnJlYWs7XG4gICAgaS0tO1xuICB9XG5cbiAgaWYgKCFvcGVuKSByZXR1cm4gJyc7XG5cbiAgdmFyIGJlZ2luID0gZS5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KGkgKyBvZmZzZXQpO1xuXG4gIGNvdW50ID0gMTtcbiAgaSArPSAxO1xuXG4gIHdoaWxlIChpIDwgY29kZS5sZW5ndGgpIHtcbiAgICBjaGFyID0gY29kZVtpXTtcbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICAgIGkrKztcbiAgfVxuXG4gIGlmICghY2xvc2UpIHJldHVybiAnICc7XG5cbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmxpbmVzLmdldE9mZnNldChpICsgb2Zmc2V0KTtcblxuICB2YXIgaHRtbCA9ICcnO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKGJlZ2luLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGVuZC55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoZW5kLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID1cbnRlbXBsYXRlLm1hcmsuc3R5bGUgPVxudGVtcGxhdGUucm93cy5zdHlsZSA9XG50ZW1wbGF0ZS5jb2RlLnN0eWxlID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgcmV0dXJuIHtcbiAgICBvcGFjaXR5OiAxLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiByYW5nZVswXSAqIGUuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogZS5jaGFyLmhlaWdodFxuICB9O1xufTtcblxudGVtcGxhdGUuY2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUuY2FyZXQuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6ICtlLmhhc0ZvY3VzLFxuICAgIGxlZnQ6IGUuY2hhci53aWR0aCAqIGUuY2FyZXQueCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0LFxuICAgIHRvcDogZS5jaGFyLmhlaWdodCAqIGUuY2FyZXQueSxcbiAgICBoZWlnaHQ6IGUuY2hhci5oZWlnaHQsXG4gIH07XG59O1xuXG50ZW1wbGF0ZS5ndXR0ZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG51bGw7XG59O1xuXG50ZW1wbGF0ZS5ndXR0ZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIG9wYWNpdHk6IDEsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiBlLnJvd3MgKiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUucnVsZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUucnVsZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIC8vIHdpZHRoOiBlLmxvbmdlc3RMaW5lICogZS5jaGFyLndpZHRoLFxuICAgIG9wYWNpdHk6IDAsXG4gICAgbGVmdDogMCxcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAoKGUucm93cyArIGUucGFnZS5oZWlnaHQpICogZS5jaGFyLmhlaWdodCkgKyBlLnBhZ2VSZW1haW5kZXIuaGVpZ2h0LFxuICB9O1xufTtcblxuZnVuY3Rpb24gaW5zZXJ0KG9mZnNldCwgc3RyaW5nLCBwYXJ0KSB7XG4gIHJldHVybiBzdHJpbmcuc2xpY2UoMCwgb2Zmc2V0KSArIHBhcnQgKyBzdHJpbmcuc2xpY2Uob2Zmc2V0KTtcbn1cbiIsInZhciBkb20gPSByZXF1aXJlKCcuLi8uLi9saWIvZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4uLy4uL2xpYi9kaWZmJyk7XG52YXIgbWVyZ2UgPSByZXF1aXJlKCcuLi8uLi9saWIvbWVyZ2UnKTtcbnZhciB0cmltID0gcmVxdWlyZSgnLi4vLi4vbGliL3RyaW0nKTtcbnZhciBjc3MgPSByZXF1aXJlKCcuLi9zdHlsZS5jc3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5mdW5jdGlvbiBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFZpZXcpKSByZXR1cm4gbmV3IFZpZXcobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSk7XG5cbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcblxuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgdGhpcy5sYXN0VXNlZCA9IDA7XG5cbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHRoaXMuZWwuY2xhc3NOYW1lID0gY3NzW25hbWVdO1xuXG4gIHZhciBzdHlsZSA9IHtcbiAgICB0b3A6IDAsXG4gICAgaGVpZ2h0OiAwLFxuICAgIG9wYWNpdHk6IDBcbiAgfTtcblxuICBpZiAodGhpcy5lZGl0b3Iub3B0aW9ucy5kZWJ1Z19sYXllcnNcbiAgJiYgfnRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzLmluZGV4T2YobmFtZSkpIHtcbiAgICBzdHlsZS5iYWNrZ3JvdW5kID0gJyMnXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpXG4gICAgKyAoTWF0aC5yYW5kb20oKSAqIDEyIHwgMCkudG9TdHJpbmcoMTYpO1xuICB9XG5cbiAgZG9tLnN0eWxlKHRoaXMsIHN0eWxlKTtcbn1cblxuVmlldy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKCFyYW5nZSkgcmFuZ2UgPSB0aGlzO1xuXG4gIHRoaXMubGFzdFVzZWQgPSBEYXRlLm5vdygpO1xuXG4gIC8vIGNvbnNvbGUubG9nKHRoaXMubmFtZSwgdGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSwgZGlmZih0aGlzLnZhbHVlLCBlLmxheW91dFt0aGlzLm5hbWVdKSlcbiAgLy8gaWYgKCFkaWZmKHRoaXMudmFsdWUsIHRoaXMuZWRpdG9yLmxheW91dFt0aGlzLm5hbWVdKSkgcmV0dXJuO1xuXG4gIHZhciBodG1sID0gdGhpcy50ZW1wbGF0ZShyYW5nZSwgdGhpcy5lZGl0b3IpO1xuICBpZiAoaHRtbCA9PT0gZmFsc2UpIHJldHVybiB0aGlzLnN0eWxlKCk7XG5cbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG4gIHRoaXMudmlzaWJsZSA9IHRydWU7XG5cbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSB7XG4gIC8vICAgdmFyIHJlcyA9IHRyaW0uZW1wdHlMaW5lcyhodG1sKVxuICAvLyAgIHJhbmdlWzBdICs9IHJlcy5sZWFkaW5nO1xuICAvLyAgIGh0bWwgPSByZXMuc3RyaW5nO1xuICAvLyB9XG5cbiAgaWYgKGh0bWwpIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICBlbHNlIGlmICgnY29kZScgPT09IHRoaXMubmFtZSB8fCAnYmxvY2snID09PSB0aGlzLm5hbWUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG5cbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicsIHRoaXMubmFtZSlcbiAgdGhpcy5zdHlsZSgpO1xufTtcblxuVmlldy5wcm90b3R5cGUuc3R5bGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0VXNlZCA9IERhdGUubm93KCk7XG4gIGRvbS5zdHlsZSh0aGlzLCB0aGlzLnRlbXBsYXRlLnN0eWxlKHRoaXMsIHRoaXMuZWRpdG9yKSk7XG59O1xuXG5WaWV3LnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpc1swXSArICcsJyArIHRoaXNbMV07XG59O1xuXG5WaWV3LnByb3RvdHlwZS52YWx1ZU9mID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBbdGhpc1swXSwgdGhpc1sxXV07XG59O1xuXG5WaWV3LnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMudmlzaWJsZSkgcmV0dXJuO1xuICB0aGlzWzBdID0gdGhpc1sxXSA9IC0xO1xuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgLy8gZG9tLmh0bWwodGhpcywgJycpO1xuICBkb20uc3R5bGUodGhpcywgeyB0b3A6IDAsIGhlaWdodDogMCwgb3BhY2l0eTogMCB9KTtcbn07XG4iXX0=
