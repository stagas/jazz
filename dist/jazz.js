(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Jazz = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Jazz
 */

var DefaultOptions = {
  debug_layers: false,
  scroll_speed: 0.30,
  center: false,
  margin_left: 0,
};

require('set-immediate');
var dom = require('dom');
var diff = require('diff');
var merge = require('merge');
var clone = require('clone');
var debounce = require('debounce');
var throttle = require('throttle');
var atomic = require('atomic');
var Event = require('event');
var Dialog = require('dialog');
var Point = require('point');
var Range = require('range');
var Area = require('area');
var Box = require('box');

var History = require('./src/history');
var Input = require('./src/input');
var File = require('./src/file');
var Move = require('./src/move');
var Text = require('./src/input/text');
var Views = require('./src/views');

module.exports = Jazz;

function Jazz(options) {
  Event.call(this);

  this.options = merge(clone(DefaultOptions), options || {});

  Object.assign(this, {
    el: document.createDocumentFragment(),

    file: new File,
    move: new Move(this),
    views: new Views(this),
    input: new Input(this),
    history: new History(this),

    bindings: {},

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
    gutterMargin: 15,

    code: 0,
    rows: 0,

    caret: new Point({ x: 0, y: 0 }),

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

  this.bindMethods();
  this.bindEvent();
}

Jazz.prototype.__proto__ = Event.prototype;

Jazz.prototype.use = function(el, scrollEl) {
  dom.append(el, this.el);

  this.el = el;

  dom.onscroll(scrollEl || this.el, this.onScroll);
  dom.onresize(this.onResize);

  this.input.use(this.el);

  window.requestAnimationFrame(this.repaint);

  return this;
};

Jazz.prototype.assign = function(bindings) {
  this.bindings = bindings;
  return this;
};

Jazz.prototype.open = function(path, fn) {
  this.file.open(path, fn);
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

Jazz.prototype.bindMethods = function() {
  this.animationScrollFrame = this.animationScrollFrame.bind(this);
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
  this.history.on('change', this.onFileSet);
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
  if (scroll.y !== this.scroll.y) {
    this.editing = false;
    this.scroll.set(scroll);
    this.render();
  }
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

Jazz.prototype.onInput = function(text) {
  this.render();
};

Jazz.prototype.onText = function(text) {
  this.suggestRoot = '';
  this.insert(text);
};

Jazz.prototype.onKeys = function(keys, e) {
  if (!(keys in this.bindings)) return;
  e.preventDefault();
  this.bindings[keys].call(this, e);
};

Jazz.prototype.onKey = function(key, e) {
  if (!(key in this.bindings.single)) return;
  this.bindings.single[key].call(this, e);
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

Jazz.prototype.onBeforeFileChange = function() {
  this.history.save();
};

Jazz.prototype.onFileChange = function(editRange, editShift, textBefore, textAfter) {
  // console.log('change')
  this.rows = this.buffer.loc;
  this.code = this.buffer.text.length;

  this.editing = true;
  this.editLine = editRange[0];
  this.editRange = editRange;
  this.editShift = editShift;

  this.pageBounds = [0, this.rows];

  if (this.find.isOpen) {
    this.onFindValue(this.findValue, true);
  }

  this.history.save();
  this.render();
  this.emit('change');
};

Jazz.prototype.setCaretFromPx = function(px) {
  var g = new Point({ x: this.gutter + this.options.margin_left, y: this.char.height/2 });
  var p = px['-'](g)['+'](this.scroll)['o/'](this.char);

  p.y = Math.max(0, Math.min(p.y, this.buffer.loc));
  p.x = Math.max(0, Math.min(p.x, this.getLineLength(p.y)));

  this.setCaret(p);
  this.move.lastDeliberateX = p.x;
  this.onMove();

  return p;
};

Jazz.prototype.onMouseUp = function() {
  this.focus();
};

Jazz.prototype.onMouseDown = function() {
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
  var p = (this.animationScrollTarget || this.scroll)['/'](this.char);
  return this.getRange([
    Math.floor(p.y + this.page.height * range[0]),
    Math.ceil(p.y + this.page.height + this.page.height * range[1])
  ]);
};

Jazz.prototype.getLineLength = function(y) {
  return this.buffer.lines.getLineLength(y);
};

Jazz.prototype.followCaret = atomic(function() {
  // console.log('follow caret')
  var p = this.caret['*'](this.char);
  var s = this.animationScrollTarget || this.scroll;

  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + this.size.height) + this.char.height;

  var left = s.x - p.x;
  var right = (p.x) - (s.x + this.size.width - 100) + this.char.width + this.gutter + this.options.margin_left;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  if (!this.animationRunning && !this.find.isOpen)
    this.scrollBy(right - left, bottom - top);
  else
    this.animateScrollBy(right - left, bottom - top);
});

Jazz.prototype.scrollTo = function(p) {
  dom.scrollTo(this.el, p.x, p.y);
};

Jazz.prototype.scrollBy = function(x, y) {
  this.scroll.x += x;
  this.scroll.y += y;
  this.scrollTo(this.scroll);
};

Jazz.prototype.animateScrollBy = function(x, y) {
  if (!this.animationRunning) {
    this.animationRunning = true;
  } else {
    window.cancelAnimationFrame(this.animationFrame);
  }

  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  var s = this.animationScrollTarget || this.scroll;

  this.animationScrollTarget = new Point({
    x: Math.max(0, s.x + x),
    // x: 0,
    y: Math.min((this.rows + 1) * this.char.height - this.size.height, Math.max(0, s.y + y))
  });
};

Jazz.prototype.animationScrollFrame = function() {
  window.cancelAnimationFrame(this.animationFrame);

  var speed = this.options.scroll_speed; // adjust precision to keep caret ~static when paging up/down
  var s = this.scroll;
  var t = this.animationScrollTarget;

  var dx = t.x - s.x;
  var dy = t.y - s.y;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    // this.scrollTo(this.animationScrollTarget);
    this.animationRunning = false;
    this.animationScrollTarget = null;
    this.emit('animation end');
    // console.log('anim end')
    return;
  }

  this.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  dx *= speed;
  dy *= speed;

  dx = dx > 0 ? Math.ceil(dx) : Math.floor(dx);
  dy = dy > 0 ? Math.ceil(dy) : Math.floor(dy);

  this.scrollBy(dx, dy);
};

Jazz.prototype.insert = function(text) {
  if (this.mark.active) this.delete();
  var length = this.buffer.insert(this.caret, text);
  this.move.byChars(length, true);
};

Jazz.prototype.backspace = function() {
  if (this.move.isBeginOfFile()) {
    if (this.mark.active) return this.delete();
    return;
  }
  if (this.mark.active) {
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.deleteArea(area);
    this.markClear(true);
    this.clear();
    this.repaint();
  } else {
    this.move.byChars(-1, true);
    this.buffer.deleteCharAt(this.caret);
  }
};

Jazz.prototype.delete = function() {
  if (this.move.isEndOfFile()) {
    if (this.mark.active) return this.backspace();
    return;
  }
  if (this.mark.active) {
    var area = this.mark.get();
    this.setCaret(area.begin);
    this.buffer.deleteArea(area);
    this.markClear(true);
    this.clear();
    this.repaint();
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
  this.char.set(dom.getCharSize($));
  this.rows = this.buffer.loc;
  this.code = this.buffer.text.length;
  this.page.set(this.size['^/'](this.char));
  this.pageRemainder.set(this.size['-'](this.page['*'](this.char)));
  this.pageBounds = [0, this.rows];
  this.longestLine = Math.min(500, this.buffer.lines.getLongestLineLength());
  this.gutter = Math.max(
    this.options.hide_rows ? 0 : (''+this.rows).length,
    (this.options.center
      ? (this.page.width - 81) / 2 | 0 : 0)
    + (this.options.hide_rows
      ? 0 : Math.max(4, (''+this.rows).length))
  ) * this.char.width + (this.options.hide_rows ? 0 : this.gutterMargin);

  // dom.style(this.el, {
  //   width: this.longestLine * this.char.width,
  //   height: this.rows * this.char.height
  // });

  dom.style(this.views.caret, {
    height: this.char.height
  });

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

  dom.css(''
  + '.editor > .layer > .find,'
  + '.editor > .layer > .mark,'
  + '.editor > .layer > .code {'
  + '  padding-left: ' + (this.options.margin_left + this.gutter) + 'px;'
  + '}'
  + '.editor > .layer > .rows {'
  + '  padding-right: ' + this.gutterMargin + 'px;'
  + '  margin-left: ' + this.options.margin_left + 'px;'
  + '  width: ' + this.gutter + 'px;'
  + '}'
  + '.editor > .layer > .find > i {'
  + '  height: ' + (this.char.height + 1) + 'px;'
  + '}'
  + '.editor > .layer > .block > i {'
  + '  height: ' + (this.char.height + 1) + 'px;'
  + '}'
  + 'indent {'
  + '  background-image: url(' + dataURL + ');'
  + '}'
  );

  this.emit('resize');
};

Jazz.prototype.clear = atomic(function() {
  // console.log('clear')
  this.views.clear();
});

Jazz.prototype.render = atomic(function() {
  // console.log('render')
  this.views.render();
  this.emit('render');
});

},{"./src/file":32,"./src/history":33,"./src/input":34,"./src/input/text":36,"./src/move":37,"./src/views":41,"area":2,"atomic":3,"box":4,"clone":5,"debounce":6,"dialog":7,"diff":8,"dom":9,"event":10,"merge":12,"point":15,"range":19,"set-immediate":22,"throttle":23}],2:[function(require,module,exports){
var Point = require('point');

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

},{"point":15}],3:[function(require,module,exports){

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

  return function(a) {
    clearImmediate(request);
    request = setImmediate(fn.bind(this, a));
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
    width: this.width * b.width | 0,
    height: this.height * b.height | 0
  });
};

Box.prototype['-'] =
Box.prototype.sub = function(b) {
  return new Box({
    width: this.width - b.width,
    height: this.height - b.height
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
var dom = require('dom');
var Event = require('event');

module.exports = Dialog;

function Dialog(label, keymap) {
  this.node = dom('dialog', [
    '<label>label',
    ['input', [
      '<input>text',
      'info'
    ]]
  ]);
  dom.text(this.node.label, label);
  dom.style(this.node.input.info, { display: 'none' });
  this.keymap = keymap;
  this.onbodykeydown = this.onbodykeydown.bind(this);
  this.onkeydown = this.onkeydown.bind(this);
  this.oninput = this.oninput.bind(this);
  this.node.input.el.onkeydown = this.onkeydown;
  this.node.input.el.onclick = stopPropagation;
  this.node.input.el.onmouseup = stopPropagation;
  this.node.input.el.onmousedown = stopPropagation;
  this.node.input.el.oninput = this.oninput;
  this.isOpen = false;
}

Dialog.prototype.__proto__ = Event.prototype;

function stopPropagation(e) {
  e.stopPropagation();
};

Dialog.prototype.hasFocus = function() {
  return this.node.input.el.hasFocus();
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
  this.emit('value', this.node.input.text.el.value);
};

Dialog.prototype.open = function() {
  document.body.addEventListener('keydown', this.onbodykeydown);
  dom.append(document.body, this.node);
  dom.focus(this.node.input.text);
  this.node.input.text.el.select();
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
  this.emit('submit', this.node.input.text.el.value);
};

Dialog.prototype.info = function(info) {
  dom.text(this.node.input.info, info);
  dom.style(this.node.input.info, { display: info ? 'block' : 'none' });
};

},{"dom":9,"event":10}],8:[function(require,module,exports){

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

},{}],9:[function(require,module,exports){
var memoize = require('memoize');
var merge = require('merge');
var diff = require('diff');
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
      name: name
    };
    dom.classes(node, []);
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

dom.getCharSize = function(el) {
  el = dom.getElement(el);
  var span = document.createElement('span');

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
  return {
    x: rect.left + borderLeft,
    y: rect.top + borderTop
  };
};

dom.getScroll = function(el) {
  el = dom.getElement(el);
  return getScroll(el);
};

dom.onscroll = function onscroll(el, fn) {
  el = dom.getElement(el);
  if (document.body === el) {
    document.addEventListener('scroll', function(ev) {
      fn(getScroll(el));
    });
  } else {
    el.addEventListener('scroll', function(ev) {
      fn(getScroll(el));
    });
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
    if (x) el.scrollLeft = x;
    if (y) el.scrollTop = y;
  }
};

dom.css = function(cssText) {
  dom.css.style.textContent = cssText;
};
dom.css.style = document.createElement('style')
document.body.appendChild(dom.css.style);

function getScroll(el) {
  return document.body === el
    ? {
        x: 0, //window.scrollX || el.scrollLeft || document.documentElement.scrollLeft,
        y: window.scrollY || el.scrollTop  || document.documentElement.scrollTop
      }
    : {
        x: 0, //el.scrollLeft,
        y: el.scrollTop
      };
}

},{"diff":8,"memoize":11,"merge":12}],10:[function(require,module,exports){

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

},{}],11:[function(require,module,exports){

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
      cache.push(param);
      nodes.push(node);
      index = results.push(fn(node, param, param));
    }

    return results[index];
  };
};

},{}],12:[function(require,module,exports){

module.exports = function merge(dest, src) {
  for (var key in src) {
    dest[key] = src[key];
  }
  return dest;
};

},{}],13:[function(require,module,exports){

module.exports = open;

function open(url, cb) {
  return fetch(url)
    .then(getJson)
    .then(getText)
    .then(cb.bind(null, null))
    .catch(cb);
}

function getJson(res) {
  return res.json();
}

function getText(json) {
  return Promise.resolve(json.text);
}

},{}],14:[function(require,module,exports){
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

},{}],15:[function(require,module,exports){

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

// TODO: make '_/' for more explicit flooring
Point.prototype['/'] =
Point.prototype.div = function(p) {
  return new Point({
    x: this.x / (p.x || p.width || 0) | 0,
    y: this.y / (p.y || p.height || 0) | 0
  });
};

Point.prototype['o/'] =
Point.prototype.div = function(p) {
  return new Point({
    x: Math.round(this.x / (p.x || p.width || 0)),
    y: Math.round(this.y / (p.y || p.height || 0))
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
  return {
    x: Math.min(area.end.x, Math.max(area.begin.x, p.x)),
    y: Math.min(area.end.y, Math.max(area.begin.y, p.y))
  };
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

},{}],16:[function(require,module,exports){

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

},{}],17:[function(require,module,exports){

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

},{}],18:[function(require,module,exports){

module.exports = XOOR;

function XOOR(a, b) {
  var range = null;
  var found = false;
  var out = [];

  for (var i = a[0]; i <= a[1]; i++) {
    found = false;
    for (var k = 0; k < b.length; k++) {
      if (i >= b[k][0] && i <= b[k][1]) {
        found = true;
        range = null;
        break;
      }
    }
    if (!found) {
      if (!range) {
        range = [i,i];
        out.push(range);
      }
      range[1] = i;
    }
  }

  return out;
}

},{}],19:[function(require,module,exports){
var NOT = require('range-gate-not');
var AND = require('range-gate-and');
var XOOR = require('range-gate-xoor');

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

Range.NOT = NOT;
Range.AND = AND;
Range.XOOR = XOOR;

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

},{"range-gate-and":16,"range-gate-not":17,"range-gate-xoor":18}],20:[function(require,module,exports){

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
      body: JSON.stringify({ text: src }),
      headers: new Headers({
        'Content-Type': 'application/json'
      })
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
var debounce = require('debounce');
var throttle = require('throttle');
var atomic = require('atomic');
var parse = require('parse');
var Area = require('area');
var Range = require('range');
var Regexp = require('regexp');
var Event = require('event');
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

  point = this.lines.getPoint(point);
  lines = this.lines.insert(point, text);
  range = [point.y, point.y + lines];

  shift = !isCtrlShift && (shift || isEOL);

  before = this.get(range);

  this.text.insert(point.offset, text);

  after = this.get(range);

  this.prefix.index(after);
  if (isCtrlShift) range = [Math.max(0, range[0]-1), range[1]];

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
  range = [point.y, point.y + isEOL];

  before = this.get(range);

  this.text.removeCharAt(point.offset);

  after = this.get(range);

  this.prefix.index(after);

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

},{"./indexer":26,"./lines":27,"./prefixtree":28,"./segments":29,"./skipstring":30,"./syntax":31,"area":2,"atomic":3,"debounce":6,"event":10,"parse":14,"range":19,"regexp":20,"throttle":23}],26:[function(require,module,exports){

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
    return this.index[this.length - 1] + this.tail.length;
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

PrefixTreeNode.prototype.getSortedChildren = function() {
  var children = Object
    .keys(this.children)
    .map((key) => this.children[key]);

  //TODO: only filter and sort in the end
  return children
    .reduce((p, n) => p.concat(n.getSortedChildren()), children)
    .filter((node) => node.value)
    .sort((a, b) => {
      var res = b.rank - a.rank;
      if (res === 0) res = b.value.length - a.value.length;
      if (res === 0) res = a.value > b.value;
      return res;
    });
};

PrefixTreeNode.prototype.collect = function(key) {
  var collection = [];
  var node = this.find(key);
  if (node) {
    collection = node.getSortedChildren();
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
  this.cache = {
    offset: {},
    range: {},
  };
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

  for (; i < this.segments.length; i++) {
    segment = this.segments[i];

    // cache state etc dynamically

    if (open) {
      if (waitFor === segment.type) {
        point = this.getPointOffset(segment.offset);
        if (!point) return;
        if (point.y >= y) return Tag[state.type];

        // console.log('close', segment.type, segment.offset, this.buffer.text.getRange([segment.offset, segment.offset + 10]))
        last = segment;
        last.point = point;
        state = null;
        open = false;
      }
    } else {
      point = this.getPointOffset(segment.offset);
      if (!point) return;

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
  if (state && state.point.y < y) return Tag[state.type];
  return;
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

  var p = -1;
  var i = -1;
  var b;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    b = this.segments[i];
    if (b.offset <= offset) begin = i;
    else end = i;
  } while (p !== i);

  return {
    segment: b,
    index: i
  };
};

Segments.prototype.index = function(text) {
  var match;

  var segments = this.segments = [];

  this.cache = {
    offset: {},
    range: {},
  };

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
  'indent':   R(['indent'],   'gm'),
  'symbol':   R(['symbol'],   'g'),
  'string':   R(['template string'], 'g'),
  'number':   R(['special','number'], 'g'),
}, compile);

var Indent = compile(R(['indent'], 'gm'), 'indent');

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
var open = require('open');
var save = require('save');
var Event = require('event');
var Buffer = require('./buffer');

module.exports = File;

function File(editor) {
  Event.call(this);

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

File.prototype.open = function(path, fn) {
  open(path, (err, text) => {
    if (err) {
      this.emit('error', err);
      fn && fn(err);
      return;
    }
    this.path = path;
    this.buffer.set(text);
    this.emit('open');
    fn && fn(null, this);
  });
};

File.prototype.save = function(fn) {
  save(this.path, this.buffer.get(), fn || noop);
};

File.prototype.set = function(text) {
  this.buffer.set(text);
  this.emit('set');
};

function noop() {/* noop */}

},{"./buffer":25,"event":10,"open":13,"save":21}],33:[function(require,module,exports){
var Event = require('event');
var debounce = require('debounce');

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

},{"debounce":6,"event":10}],34:[function(require,module,exports){
var Event = require('event');
var Mouse = require('./mouse');
var Text = require('./text');

module.exports = Input;

function Input(editor) {
  Event.call(this);

  this.editor = editor;
  this.mouse = new Mouse(this);
  this.text = new Text;
  this.bindEvent();
}

Input.prototype.__proto__ = Event.prototype;

Input.prototype.bindEvent = function() {
  this.focus = this.focus.bind(this);
  this.text.on(['key', 'text'], this.emit.bind(this, 'input'));
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
};

Input.prototype.focus = function() {
  this.text.focus();
};

},{"./mouse":35,"./text":36,"event":10}],35:[function(require,module,exports){
var Event = require('event');
var debounce = require('debounce');
var Point = require('point');

module.exports = Mouse;

function Mouse() {
  Event.call(this);

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
    node.removeEventListener('mousedown', this.ondown);
  }
  this.node = node;
  this.node.addEventListener('mousedown', this.ondown);
};

Mouse.prototype.ondown = function(e) {
  this.point = this.down = this.getPoint(e);
  this.emit('down', e);
  this.onclick(e);
  this.maybeDrag();
};

Mouse.prototype.onup = function(e) {
  if (!this.down) return;
  this.emit('up', e);
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

},{"debounce":6,"event":10,"point":15}],36:[function(require,module,exports){
var dom = require('dom');
var debounce = require('debounce');
var Event = require('event');

var THROTTLE = 1000/60;

var map = {
  8: 'backspace',
  9: 'tab',
  33: 'pageup',
  34: 'pagedown',
  35: 'end',
  36: 'home',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  46: 'delete',
  65: 'a',
  68: 'd',
  70: 'f',
  77: 'm',
  78: 'n',
  83: 's',
  89: 'y',
  90: 'z',
  114: 'f3',
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

  this.node = document.createElement('textarea');

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
  this.node.oninput = this.oninput;
  this.node.onkeydown = this.onkeydown;
  this.node.onkeyup = this.onkeyup;
  this.node.oncut = this.oncut;
  this.node.oncopy = this.oncopy;
  this.node.onpaste = this.onpaste;
};

Text.prototype.get = function() {
  return this.node.value.substr(-1);
};

Text.prototype.set = function(value) {
  this.node.value = value;
};

//TODO: on mobile we need to clear without debounce
// or the textarea content is displayed in hacker's keyboard
// or you need to disable word suggestions in hacker's keyboard settings
Text.prototype.clear = debounce(function() {
  this.set('');
}, 10 * 1000);

Text.prototype.focus = function() {
  // console.log('focus')
  this.node.focus();
};

Text.prototype.oninput = function(e) {
  e.preventDefault();
  // forces caret to end of textarea so we can get .slice(-1) char
  setImmediate(() => this.node.selectionStart = this.node.value.length);
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

},{"debounce":6,"dom":9,"event":10}],37:[function(require,module,exports){
var Regexp = require('regexp');
var Event = require('event');
var Point = require('point');

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

},{"event":10,"point":15,"regexp":20}],38:[function(require,module,exports){
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

},{"./layer":42,"./template":45}],39:[function(require,module,exports){
var dom = require('dom');
var Range = require('range');
var Layer = require('./layer');
var template = require('./template');

module.exports = Code;

function Code(name, editor, template) {
  Layer.call(this, name, editor, template, 50);
}

Code.prototype.__proto__ = Layer.prototype;

Code.prototype.render = function() {
  var layer = this;
  var views = this.views;
  var e = this.editor;

  // this.clear();
  // return this.renderPage(0, true);
  if (!e.editing) return this.renderAhead();

  var y = e.editLine;
  var g = e.editRange.slice();
  var shift = e.editShift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isBegin = g[0] + isBackspace === 0;
  var isEnd = g[1] + isEnter === e.rows;

  if (shift) {
    if (isEnter && !isEnd) this.shiftViewsBelow(g[0], shift);
    else if (isBackspace && !isBegin) this.shiftViewsBelow(g[0], shift);
  }

  this.updateRange(g);
  this.renderPage(0);
};

},{"./layer":42,"./template":45,"dom":9,"range":19}],40:[function(require,module,exports){
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

},{"./layer":42,"./template":45}],41:[function(require,module,exports){
var debounce = require('debounce');
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

  if (this.editor.options.hide_rows) this.rows.render = noop;
}

Views.prototype.clear = function() {
  this.forEach(view => view.clear());
},

Views.prototype.render = function() {
  this.forEach(view => view.render());
};

function noop() {/* noop */}

},{"./block":38,"./code":39,"./find":40,"./mark":43,"./rows":44,"./template":45,"./view":46,"debounce":6}],42:[function(require,module,exports){
var dom = require('dom');
var Event = require('event');
var Range = require('range');
var View = require('./view');

module.exports = Layer;

function Layer(name, editor, template, length) {
  this.dom = dom(name + ' layer');
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
  var aheadRange = this.getPageRange([-.5,+.5]);
  var aheadNeedRanges = Range.NOT(aheadRange, views);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders
    this.renderPage(1, include);
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
    // debugger;
    if (view[1] < range[0] || view[0] > range[1]) continue;

    if (view[0] < range[0] && view[1] >= range[0]) { // shorten below
      view[1] = range[0] - 1;
      view.style();
    } else if (view[1] > range[1]) { // shorten above
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
  // for (var i = 0; i < this.views.length; i++) {
  //   var view = this.views[i];
  //   if (view[0] >= range[0] && view[1] <= range[1]) {
  //     view.render();
  //   }
  // }
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

},{"./view":46,"dom":9,"event":10,"range":19}],43:[function(require,module,exports){
var dom = require('dom');
var Range = require('range');
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

},{"./layer":42,"./template":45,"dom":9,"range":19}],44:[function(require,module,exports){
var Layer = require('./layer');
var template = require('./template');

module.exports = Rows;

function Rows(name, editor, template) {
  Layer.call(this, name, editor, template, 20);
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

},{"./layer":42,"./template":45}],45:[function(require,module,exports){
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

  if (!open) return ' ';

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

template.block.style = function() {
  //
};

template.mark.style =
template.rows.style =
template.code.style = function(range, e) {
  return {
    top: range[0] * e.char.height,
    height: (range[1] - range[0] + 1) * e.char.height
  };
};

template.caret = function() {
  return false;
};

template.caret.style = function(point, e) {
  return {
    left: e.char.width * e.caret.x + e.gutter + e.options.margin_left,
    top: e.char.height * e.caret.y,
  };
};

template.gutter = function() {
  return null;
};

template.gutter.style = function(point, e) {
  return {
    width: 1,
    height: e.rows * e.char.height,
  };
};

template.ruler = function() {
  return false;
};

template.ruler.style = function(point, e) {
  return {
    width: e.longestLine * e.char.width,
    height: ((e.rows + e.page.height) * e.char.height) + e.pageRemainder.height,
  };
};

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}

},{}],46:[function(require,module,exports){
var dom = require('dom');
var diff = require('diff');
var merge = require('merge');
var trim = require('trim');

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
  this.el.className = name;

  var style = {
    top: 0,
    height: 0,
    opacity: 0
  };

  if (this.editor.options.debug_layers) {
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

  // if ('code' === this.name) html = trim.emptyLines(html).string;

  this[0] = range[0];
  this[1] = range[1];
  this.visible = true;

  if (html) dom.html(this, html);
  else if ('code' === this.name || 'block' === this.name) return this.clear();

  // console.log('render', this.name)
  this.style();
};

View.prototype.style = function() {
  this.lastUsed = Date.now();

  dom.style(
    this,
    merge(
      { opacity: 1 },
      this.template.style(this, this.editor)
    )
  );
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

},{"diff":8,"dom":9,"merge":12,"trim":24}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy5udm0vdmVyc2lvbnMvbm9kZS92NS40LjEvbGliL25vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiamF6ei5qcyIsImxpYi9hcmVhLmpzIiwibGliL2F0b21pYy5qcyIsImxpYi9ib3guanMiLCJsaWIvY2xvbmUuanMiLCJsaWIvZGVib3VuY2UuanMiLCJsaWIvZGlhbG9nLmpzIiwibGliL2RpZmYuanMiLCJsaWIvZG9tLmpzIiwibGliL2V2ZW50LmpzIiwibGliL21lbW9pemUuanMiLCJsaWIvbWVyZ2UuanMiLCJsaWIvb3Blbi5qcyIsImxpYi9wYXJzZS5qcyIsImxpYi9wb2ludC5qcyIsImxpYi9yYW5nZS1nYXRlLWFuZC5qcyIsImxpYi9yYW5nZS1nYXRlLW5vdC5qcyIsImxpYi9yYW5nZS1nYXRlLXhvb3IuanMiLCJsaWIvcmFuZ2UuanMiLCJsaWIvcmVnZXhwLmpzIiwibGliL3NhdmUuanMiLCJsaWIvc2V0LWltbWVkaWF0ZS5qcyIsImxpYi90aHJvdHRsZS5qcyIsImxpYi90cmltLmpzIiwic3JjL2J1ZmZlci9pbmRleC5qcyIsInNyYy9idWZmZXIvaW5kZXhlci5qcyIsInNyYy9idWZmZXIvbGluZXMuanMiLCJzcmMvYnVmZmVyL3ByZWZpeHRyZWUuanMiLCJzcmMvYnVmZmVyL3NlZ21lbnRzLmpzIiwic3JjL2J1ZmZlci9za2lwc3RyaW5nLmpzIiwic3JjL2J1ZmZlci9zeW50YXguanMiLCJzcmMvZmlsZS5qcyIsInNyYy9oaXN0b3J5LmpzIiwic3JjL2lucHV0L2luZGV4LmpzIiwic3JjL2lucHV0L21vdXNlLmpzIiwic3JjL2lucHV0L3RleHQuanMiLCJzcmMvbW92ZS5qcyIsInNyYy92aWV3cy9ibG9jay5qcyIsInNyYy92aWV3cy9jb2RlLmpzIiwic3JjL3ZpZXdzL2ZpbmQuanMiLCJzcmMvdmlld3MvaW5kZXguanMiLCJzcmMvdmlld3MvbGF5ZXIuanMiLCJzcmMvdmlld3MvbWFyay5qcyIsInNyYy92aWV3cy9yb3dzLmpzIiwic3JjL3ZpZXdzL3RlbXBsYXRlLmpzIiwic3JjL3ZpZXdzL3ZpZXcuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwc0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25NQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNVRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUxBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNU1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIEphenpcbiAqL1xuXG52YXIgRGVmYXVsdE9wdGlvbnMgPSB7XG4gIGRlYnVnX2xheWVyczogZmFsc2UsXG4gIHNjcm9sbF9zcGVlZDogMC4zMCxcbiAgY2VudGVyOiBmYWxzZSxcbiAgbWFyZ2luX2xlZnQ6IDAsXG59O1xuXG5yZXF1aXJlKCdzZXQtaW1tZWRpYXRlJyk7XG52YXIgZG9tID0gcmVxdWlyZSgnZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJ2RpZmYnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJ21lcmdlJyk7XG52YXIgY2xvbmUgPSByZXF1aXJlKCdjbG9uZScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJ3Rocm90dGxlJyk7XG52YXIgYXRvbWljID0gcmVxdWlyZSgnYXRvbWljJyk7XG52YXIgRXZlbnQgPSByZXF1aXJlKCdldmVudCcpO1xudmFyIERpYWxvZyA9IHJlcXVpcmUoJ2RpYWxvZycpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgncG9pbnQnKTtcbnZhciBSYW5nZSA9IHJlcXVpcmUoJ3JhbmdlJyk7XG52YXIgQXJlYSA9IHJlcXVpcmUoJ2FyZWEnKTtcbnZhciBCb3ggPSByZXF1aXJlKCdib3gnKTtcblxudmFyIEhpc3RvcnkgPSByZXF1aXJlKCcuL3NyYy9oaXN0b3J5Jyk7XG52YXIgSW5wdXQgPSByZXF1aXJlKCcuL3NyYy9pbnB1dCcpO1xudmFyIEZpbGUgPSByZXF1aXJlKCcuL3NyYy9maWxlJyk7XG52YXIgTW92ZSA9IHJlcXVpcmUoJy4vc3JjL21vdmUnKTtcbnZhciBUZXh0ID0gcmVxdWlyZSgnLi9zcmMvaW5wdXQvdGV4dCcpO1xudmFyIFZpZXdzID0gcmVxdWlyZSgnLi9zcmMvdmlld3MnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBKYXp6O1xuXG5mdW5jdGlvbiBKYXp6KG9wdGlvbnMpIHtcbiAgRXZlbnQuY2FsbCh0aGlzKTtcblxuICB0aGlzLm9wdGlvbnMgPSBtZXJnZShjbG9uZShEZWZhdWx0T3B0aW9ucyksIG9wdGlvbnMgfHwge30pO1xuXG4gIE9iamVjdC5hc3NpZ24odGhpcywge1xuICAgIGVsOiBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCksXG5cbiAgICBmaWxlOiBuZXcgRmlsZSxcbiAgICBtb3ZlOiBuZXcgTW92ZSh0aGlzKSxcbiAgICB2aWV3czogbmV3IFZpZXdzKHRoaXMpLFxuICAgIGlucHV0OiBuZXcgSW5wdXQodGhpcyksXG4gICAgaGlzdG9yeTogbmV3IEhpc3RvcnkodGhpcyksXG5cbiAgICBiaW5kaW5nczoge30sXG5cbiAgICBmaW5kOiBuZXcgRGlhbG9nKCdGaW5kJywgVGV4dC5tYXApLFxuICAgIGZpbmRWYWx1ZTogJycsXG4gICAgZmluZE5lZWRsZTogMCxcbiAgICBmaW5kUmVzdWx0czogW10sXG5cbiAgICBzY3JvbGw6IG5ldyBQb2ludCxcbiAgICBvZmZzZXQ6IG5ldyBQb2ludCxcbiAgICBzaXplOiBuZXcgQm94LFxuICAgIGNoYXI6IG5ldyBCb3gsXG5cbiAgICBwYWdlOiBuZXcgQm94LFxuICAgIHBhZ2VQb2ludDogbmV3IFBvaW50LFxuICAgIHBhZ2VSZW1haW5kZXI6IG5ldyBCb3gsXG4gICAgcGFnZUJvdW5kczogbmV3IFJhbmdlLFxuICAgIGxvbmdlc3RMaW5lOiAwLFxuXG4gICAgZ3V0dGVyOiAwLFxuICAgIGd1dHRlck1hcmdpbjogMTUsXG5cbiAgICBjb2RlOiAwLFxuICAgIHJvd3M6IDAsXG5cbiAgICBjYXJldDogbmV3IFBvaW50KHsgeDogMCwgeTogMCB9KSxcblxuICAgIG1hcms6IG5ldyBBcmVhKHtcbiAgICAgIGJlZ2luOiBuZXcgUG9pbnQoeyB4OiAtMSwgeTogLTEgfSksXG4gICAgICBlbmQ6IG5ldyBQb2ludCh7IHg6IC0xLCB5OiAtMSB9KVxuICAgIH0pLFxuXG4gICAgZWRpdGluZzogZmFsc2UsXG4gICAgZWRpdExpbmU6IC0xLFxuICAgIGVkaXRSYW5nZTogWy0xLC0xXSxcbiAgICBlZGl0U2hpZnQ6IDAsXG5cbiAgICBzdWdnZXN0SW5kZXg6IDAsXG4gICAgc3VnZ2VzdFJvb3Q6ICcnLFxuICAgIHN1Z2dlc3ROb2RlczogW10sXG5cbiAgICBhbmltYXRpb25GcmFtZTogLTEsXG4gICAgYW5pbWF0aW9uUnVubmluZzogZmFsc2UsXG4gICAgYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0OiBudWxsLFxuICB9KTtcblxuICBkb20uYXBwZW5kKHRoaXMudmlld3MuY2FyZXQsIHRoaXMuaW5wdXQudGV4dCk7XG4gIGRvbS5hcHBlbmQodGhpcywgdGhpcy52aWV3cyk7XG5cbiAgLy8gdXNlZnVsIHNob3J0Y3V0c1xuICB0aGlzLmJ1ZmZlciA9IHRoaXMuZmlsZS5idWZmZXI7XG4gIHRoaXMuYnVmZmVyLm1hcmsgPSB0aGlzLm1hcms7XG4gIHRoaXMuc3ludGF4ID0gdGhpcy5idWZmZXIuc3ludGF4O1xuXG4gIHRoaXMuYmluZE1ldGhvZHMoKTtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuSmF6ei5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5KYXp6LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihlbCwgc2Nyb2xsRWwpIHtcbiAgZG9tLmFwcGVuZChlbCwgdGhpcy5lbCk7XG5cbiAgdGhpcy5lbCA9IGVsO1xuXG4gIGRvbS5vbnNjcm9sbChzY3JvbGxFbCB8fCB0aGlzLmVsLCB0aGlzLm9uU2Nyb2xsKTtcbiAgZG9tLm9ucmVzaXplKHRoaXMub25SZXNpemUpO1xuXG4gIHRoaXMuaW5wdXQudXNlKHRoaXMuZWwpO1xuXG4gIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5yZXBhaW50KTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmFzc2lnbiA9IGZ1bmN0aW9uKGJpbmRpbmdzKSB7XG4gIHRoaXMuYmluZGluZ3MgPSBiaW5kaW5ncztcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24ocGF0aCwgZm4pIHtcbiAgdGhpcy5maWxlLm9wZW4ocGF0aCwgZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uKHRleHQsIHBhdGgpIHtcbiAgdGhpcy5maWxlLnNldCh0ZXh0KTtcbiAgdGhpcy5maWxlLnBhdGggPSBwYXRoIHx8IHRoaXMuZmlsZS5wYXRoO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkphenoucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHNldEltbWVkaWF0ZSh0aGlzLmlucHV0LmZvY3VzKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iaW5kTWV0aG9kcyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lID0gdGhpcy5hbmltYXRpb25TY3JvbGxGcmFtZS5iaW5kKHRoaXMpO1xuICB0aGlzLm1hcmtTZXQgPSB0aGlzLm1hcmtTZXQuYmluZCh0aGlzKTtcbiAgdGhpcy5tYXJrQ2xlYXIgPSB0aGlzLm1hcmtDbGVhci5iaW5kKHRoaXMpO1xuICB0aGlzLnJlcGFpbnQgPSB0aGlzLnJlcGFpbnQuYmluZCh0aGlzKTtcbiAgdGhpcy5mb2N1cyA9IHRoaXMuZm9jdXMuYmluZCh0aGlzKTtcbn07XG5cbkphenoucHJvdG90eXBlLmJpbmRIYW5kbGVycyA9IGZ1bmN0aW9uKCkge1xuICBmb3IgKHZhciBtZXRob2QgaW4gdGhpcykge1xuICAgIGlmICgnb24nID09PSBtZXRob2Quc2xpY2UoMCwgMikpIHtcbiAgICAgIHRoaXNbbWV0aG9kXSA9IHRoaXNbbWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIH1cbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuYmluZEhhbmRsZXJzKClcbiAgdGhpcy5tb3ZlLm9uKCdtb3ZlJywgdGhpcy5vbk1vdmUpO1xuICB0aGlzLmZpbGUub24oJ3JhdycsIHRoaXMub25GaWxlUmF3KTsgLy9UT0RPOiBzaG91bGQgbm90IG5lZWQgdGhpcyBldmVudFxuICB0aGlzLmZpbGUub24oJ3NldCcsIHRoaXMub25GaWxlU2V0KTtcbiAgdGhpcy5maWxlLm9uKCdvcGVuJywgdGhpcy5vbkZpbGVPcGVuKTtcbiAgdGhpcy5maWxlLm9uKCdjaGFuZ2UnLCB0aGlzLm9uRmlsZUNoYW5nZSk7XG4gIHRoaXMuZmlsZS5vbignYmVmb3JlIGNoYW5nZScsIHRoaXMub25CZWZvcmVGaWxlQ2hhbmdlKTtcbiAgdGhpcy5oaXN0b3J5Lm9uKCdjaGFuZ2UnLCB0aGlzLm9uRmlsZVNldCk7XG4gIHRoaXMuaW5wdXQub24oJ2lucHV0JywgdGhpcy5vbklucHV0KTtcbiAgdGhpcy5pbnB1dC5vbigndGV4dCcsIHRoaXMub25UZXh0KTtcbiAgdGhpcy5pbnB1dC5vbigna2V5cycsIHRoaXMub25LZXlzKTtcbiAgdGhpcy5pbnB1dC5vbigna2V5JywgdGhpcy5vbktleSk7XG4gIHRoaXMuaW5wdXQub24oJ2N1dCcsIHRoaXMub25DdXQpO1xuICB0aGlzLmlucHV0Lm9uKCdjb3B5JywgdGhpcy5vbkNvcHkpO1xuICB0aGlzLmlucHV0Lm9uKCdwYXN0ZScsIHRoaXMub25QYXN0ZSk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNldXAnLCB0aGlzLm9uTW91c2VVcCk7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZG93bicsIHRoaXMub25Nb3VzZURvd24pO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWNsaWNrJywgdGhpcy5vbk1vdXNlQ2xpY2spO1xuICB0aGlzLmlucHV0Lm9uKCdtb3VzZWRyYWdiZWdpbicsIHRoaXMub25Nb3VzZURyYWdCZWdpbik7XG4gIHRoaXMuaW5wdXQub24oJ21vdXNlZHJhZycsIHRoaXMub25Nb3VzZURyYWcpO1xuICB0aGlzLmZpbmQub24oJ3N1Ym1pdCcsIHRoaXMuZmluZEp1bXAuYmluZCh0aGlzLCAxKSk7XG4gIHRoaXMuZmluZC5vbigndmFsdWUnLCB0aGlzLm9uRmluZFZhbHVlKTtcbiAgdGhpcy5maW5kLm9uKCdrZXknLCB0aGlzLm9uRmluZEtleSk7XG4gIHRoaXMuZmluZC5vbignb3BlbicsIHRoaXMub25GaW5kT3Blbik7XG4gIHRoaXMuZmluZC5vbignY2xvc2UnLCB0aGlzLm9uRmluZENsb3NlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uU2Nyb2xsID0gZnVuY3Rpb24oc2Nyb2xsKSB7XG4gIGlmIChzY3JvbGwueSAhPT0gdGhpcy5zY3JvbGwueSkge1xuICAgIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2Nyb2xsLnNldChzY3JvbGwpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uTW92ZSA9IGZ1bmN0aW9uKHBvaW50LCBieUVkaXQpIHtcbiAgaWYgKCFieUVkaXQpIHRoaXMuZWRpdGluZyA9IGZhbHNlO1xuICBpZiAocG9pbnQpIHRoaXMuc2V0Q2FyZXQocG9pbnQpO1xuXG4gIGlmICghYnlFZGl0KSB7XG4gICAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgfHwgdGhpcy5pbnB1dC5tb3VzZS5kb3duKSB0aGlzLm1hcmtTZXQoKTtcbiAgICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIH1cblxuICB0aGlzLmVtaXQoJ21vdmUnKTtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uUmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVwYWludCgpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25JbnB1dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5yZW5kZXIoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uVGV4dCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdGhpcy5zdWdnZXN0Um9vdCA9ICcnO1xuICB0aGlzLmluc2VydCh0ZXh0KTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5cyA9IGZ1bmN0aW9uKGtleXMsIGUpIHtcbiAgaWYgKCEoa2V5cyBpbiB0aGlzLmJpbmRpbmdzKSkgcmV0dXJuO1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIHRoaXMuYmluZGluZ3Nba2V5c10uY2FsbCh0aGlzLCBlKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uS2V5ID0gZnVuY3Rpb24oa2V5LCBlKSB7XG4gIGlmICghKGtleSBpbiB0aGlzLmJpbmRpbmdzLnNpbmdsZSkpIHJldHVybjtcbiAgdGhpcy5iaW5kaW5ncy5zaW5nbGVba2V5XS5jYWxsKHRoaXMsIGUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25DdXQgPSBmdW5jdGlvbihlKSB7XG4gIGlmICghdGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuO1xuICB0aGlzLm9uQ29weShlKTtcbiAgdGhpcy5kZWxldGUoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uQ29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSByZXR1cm47XG4gIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLmdldEFyZWEoYXJlYSk7XG4gIGUuY2xpcGJvYXJkRGF0YS5zZXREYXRhKCd0ZXh0L3BsYWluJywgdGV4dCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vblBhc3RlID0gZnVuY3Rpb24oZSkge1xuICB2YXIgdGV4dCA9IGUuY2xpcGJvYXJkRGF0YS5nZXREYXRhKCd0ZXh0L3BsYWluJyk7XG4gIHRoaXMuaW5zZXJ0KHRleHQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm1vdmUuYmVnaW5PZkZpbGUoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbGVSYXcgPSBmdW5jdGlvbihyYXcpIHtcbiAgdGhpcy5jbGVhcigpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaWxlU2V0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0Q2FyZXQoeyB4OjAsIHk6MCB9KTtcbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbiAgdGhpcy5yZXBhaW50KCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkJlZm9yZUZpbGVDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5oaXN0b3J5LnNhdmUoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uRmlsZUNoYW5nZSA9IGZ1bmN0aW9uKGVkaXRSYW5nZSwgZWRpdFNoaWZ0LCB0ZXh0QmVmb3JlLCB0ZXh0QWZ0ZXIpIHtcbiAgLy8gY29uc29sZS5sb2coJ2NoYW5nZScpXG4gIHRoaXMucm93cyA9IHRoaXMuYnVmZmVyLmxvYztcbiAgdGhpcy5jb2RlID0gdGhpcy5idWZmZXIudGV4dC5sZW5ndGg7XG5cbiAgdGhpcy5lZGl0aW5nID0gdHJ1ZTtcbiAgdGhpcy5lZGl0TGluZSA9IGVkaXRSYW5nZVswXTtcbiAgdGhpcy5lZGl0UmFuZ2UgPSBlZGl0UmFuZ2U7XG4gIHRoaXMuZWRpdFNoaWZ0ID0gZWRpdFNoaWZ0O1xuXG4gIHRoaXMucGFnZUJvdW5kcyA9IFswLCB0aGlzLnJvd3NdO1xuXG4gIGlmICh0aGlzLmZpbmQuaXNPcGVuKSB7XG4gICAgdGhpcy5vbkZpbmRWYWx1ZSh0aGlzLmZpbmRWYWx1ZSwgdHJ1ZSk7XG4gIH1cblxuICB0aGlzLmhpc3Rvcnkuc2F2ZSgpO1xuICB0aGlzLnJlbmRlcigpO1xuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuc2V0Q2FyZXRGcm9tUHggPSBmdW5jdGlvbihweCkge1xuICB2YXIgZyA9IG5ldyBQb2ludCh7IHg6IHRoaXMuZ3V0dGVyICsgdGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0LCB5OiB0aGlzLmNoYXIuaGVpZ2h0LzIgfSk7XG4gIHZhciBwID0gcHhbJy0nXShnKVsnKyddKHRoaXMuc2Nyb2xsKVsnby8nXSh0aGlzLmNoYXIpO1xuXG4gIHAueSA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueSwgdGhpcy5idWZmZXIubG9jKSk7XG4gIHAueCA9IE1hdGgubWF4KDAsIE1hdGgubWluKHAueCwgdGhpcy5nZXRMaW5lTGVuZ3RoKHAueSkpKTtcblxuICB0aGlzLnNldENhcmV0KHApO1xuICB0aGlzLm1vdmUubGFzdERlbGliZXJhdGVYID0gcC54O1xuICB0aGlzLm9uTW92ZSgpO1xuXG4gIHJldHVybiBwO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZVVwID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9jdXMoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEb3duID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmlucHV0LnRleHQubW9kaWZpZXJzLnNoaWZ0KSB0aGlzLm1hcmtCZWdpbigpO1xuICBlbHNlIHRoaXMubWFya0NsZWFyKCk7XG4gIHRoaXMuc2V0Q2FyZXRGcm9tUHgodGhpcy5pbnB1dC5tb3VzZS5wb2ludCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5zZXRDYXJldCA9IGZ1bmN0aW9uKHApIHtcbiAgdGhpcy5jYXJldC5zZXQocCk7XG4gIHRoaXMuZm9sbG93Q2FyZXQoKTtcbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VDbGljayA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY2xpY2tzID0gdGhpcy5pbnB1dC5tb3VzZS5jbGlja3M7XG4gIGlmIChjbGlja3MgPiAxKSB7XG4gICAgdmFyIGFyZWE7XG5cbiAgICBpZiAoY2xpY2tzID09PSAyKSB7XG4gICAgICBhcmVhID0gdGhpcy5idWZmZXIud29yZEF0KHRoaXMuY2FyZXQpO1xuICAgIH0gZWxzZSBpZiAoY2xpY2tzID09PSAzKSB7XG4gICAgICB2YXIgeSA9IHRoaXMuY2FyZXQueTtcbiAgICAgIGFyZWEgPSBuZXcgQXJlYSh7XG4gICAgICAgIGJlZ2luOiB7IHg6IDAsIHk6IHkgfSxcbiAgICAgICAgZW5kOiB7IHg6IHRoaXMuZ2V0TGluZUxlbmd0aCh5KSwgeTogeSB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYXJlYSkge1xuICAgICAgdGhpcy5zZXRDYXJldChhcmVhLmVuZCk7XG4gICAgICB0aGlzLm1hcmtTZXRBcmVhKGFyZWEpO1xuICAgICAgLy8gdGhpcy5yZW5kZXIoKTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm9uTW91c2VEcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5tYXJrQmVnaW4oKTtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLmRvd24pO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25Nb3VzZURyYWcgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5zZXRDYXJldEZyb21QeCh0aGlzLmlucHV0Lm1vdXNlLnBvaW50KTtcbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtCZWdpbiA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgaWYgKCF0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdGhpcy5tYXJrLmFjdGl2ZSA9IHRydWU7XG4gICAgaWYgKGFyZWEpIHtcbiAgICAgIHRoaXMubWFyay5zZXQoYXJlYSk7XG4gICAgfSBlbHNlIGlmIChhcmVhICE9PSBmYWxzZSB8fCB0aGlzLm1hcmsuYmVnaW4ueCA9PT0gLTEpIHtcbiAgICAgIHRoaXMubWFyay5iZWdpbi5zZXQodGhpcy5jYXJldCk7XG4gICAgICB0aGlzLm1hcmsuZW5kLnNldCh0aGlzLmNhcmV0KTtcbiAgICB9XG4gIH1cbn07XG5cbkphenoucHJvdG90eXBlLm1hcmtTZXQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMubWFyay5lbmQuc2V0KHRoaXMuY2FyZXQpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya1NldEFyZWEgPSBmdW5jdGlvbihhcmVhKSB7XG4gIHRoaXMubWFya0JlZ2luKGFyZWEpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUubWFya0NsZWFyID0gZnVuY3Rpb24oZm9yY2UpIHtcbiAgaWYgKHRoaXMuaW5wdXQudGV4dC5tb2RpZmllcnMuc2hpZnQgJiYgIWZvcmNlKSByZXR1cm47XG5cbiAgdGhpcy5tYXJrLmFjdGl2ZSA9IGZhbHNlO1xuICB0aGlzLm1hcmsuc2V0KHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pLFxuICAgIGVuZDogbmV3IFBvaW50KHsgeDogLTEsIHk6IC0xIH0pXG4gIH0pO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZ2V0UmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICByZXR1cm4gUmFuZ2UuY2xhbXAocmFuZ2UsIHRoaXMucGFnZUJvdW5kcyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5nZXRQYWdlUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgcCA9ICh0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCB8fCB0aGlzLnNjcm9sbClbJy8nXSh0aGlzLmNoYXIpO1xuICByZXR1cm4gdGhpcy5nZXRSYW5nZShbXG4gICAgTWF0aC5mbG9vcihwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICogcmFuZ2VbMF0pLFxuICAgIE1hdGguY2VpbChwLnkgKyB0aGlzLnBhZ2UuaGVpZ2h0ICsgdGhpcy5wYWdlLmhlaWdodCAqIHJhbmdlWzFdKVxuICBdKTtcbn07XG5cbkphenoucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmJ1ZmZlci5saW5lcy5nZXRMaW5lTGVuZ3RoKHkpO1xufTtcblxuSmF6ei5wcm90b3R5cGUuZm9sbG93Q2FyZXQgPSBhdG9taWMoZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2xsb3cgY2FyZXQnKVxuICB2YXIgcCA9IHRoaXMuY2FyZXRbJyonXSh0aGlzLmNoYXIpO1xuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHZhciB0b3AgPSBzLnkgLSBwLnk7XG4gIHZhciBib3R0b20gPSAocC55KSAtIChzLnkgKyB0aGlzLnNpemUuaGVpZ2h0KSArIHRoaXMuY2hhci5oZWlnaHQ7XG5cbiAgdmFyIGxlZnQgPSBzLnggLSBwLng7XG4gIHZhciByaWdodCA9IChwLngpIC0gKHMueCArIHRoaXMuc2l6ZS53aWR0aCAtIDEwMCkgKyB0aGlzLmNoYXIud2lkdGggKyB0aGlzLmd1dHRlciArIHRoaXMub3B0aW9ucy5tYXJnaW5fbGVmdDtcblxuICBpZiAoYm90dG9tIDwgMCkgYm90dG9tID0gMDtcbiAgaWYgKHRvcCA8IDApIHRvcCA9IDA7XG4gIGlmIChsZWZ0IDwgMCkgbGVmdCA9IDA7XG4gIGlmIChyaWdodCA8IDApIHJpZ2h0ID0gMDtcblxuICBpZiAoIXRoaXMuYW5pbWF0aW9uUnVubmluZyAmJiAhdGhpcy5maW5kLmlzT3BlbilcbiAgICB0aGlzLnNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbiAgZWxzZVxuICAgIHRoaXMuYW5pbWF0ZVNjcm9sbEJ5KHJpZ2h0IC0gbGVmdCwgYm90dG9tIC0gdG9wKTtcbn0pO1xuXG5KYXp6LnByb3RvdHlwZS5zY3JvbGxUbyA9IGZ1bmN0aW9uKHApIHtcbiAgZG9tLnNjcm9sbFRvKHRoaXMuZWwsIHAueCwgcC55KTtcbn07XG5cbkphenoucHJvdG90eXBlLnNjcm9sbEJ5ID0gZnVuY3Rpb24oeCwgeSkge1xuICB0aGlzLnNjcm9sbC54ICs9IHg7XG4gIHRoaXMuc2Nyb2xsLnkgKz0geTtcbiAgdGhpcy5zY3JvbGxUbyh0aGlzLnNjcm9sbCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRlU2Nyb2xsQnkgPSBmdW5jdGlvbih4LCB5KSB7XG4gIGlmICghdGhpcy5hbmltYXRpb25SdW5uaW5nKSB7XG4gICAgdGhpcy5hbmltYXRpb25SdW5uaW5nID0gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25GcmFtZSk7XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICB2YXIgcyA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0IHx8IHRoaXMuc2Nyb2xsO1xuXG4gIHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0ID0gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLm1heCgwLCBzLnggKyB4KSxcbiAgICAvLyB4OiAwLFxuICAgIHk6IE1hdGgubWluKCh0aGlzLnJvd3MgKyAxKSAqIHRoaXMuY2hhci5oZWlnaHQgLSB0aGlzLnNpemUuaGVpZ2h0LCBNYXRoLm1heCgwLCBzLnkgKyB5KSlcbiAgfSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5hbmltYXRpb25TY3JvbGxGcmFtZSA9IGZ1bmN0aW9uKCkge1xuICB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25GcmFtZSk7XG5cbiAgdmFyIHNwZWVkID0gdGhpcy5vcHRpb25zLnNjcm9sbF9zcGVlZDsgLy8gYWRqdXN0IHByZWNpc2lvbiB0byBrZWVwIGNhcmV0IH5zdGF0aWMgd2hlbiBwYWdpbmcgdXAvZG93blxuICB2YXIgcyA9IHRoaXMuc2Nyb2xsO1xuICB2YXIgdCA9IHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0O1xuXG4gIHZhciBkeCA9IHQueCAtIHMueDtcbiAgdmFyIGR5ID0gdC55IC0gcy55O1xuXG4gIGlmIChNYXRoLmFicyhkeCkgPCAxICYmIE1hdGguYWJzKGR5KSA8IDEpIHtcbiAgICAvLyB0aGlzLnNjcm9sbFRvKHRoaXMuYW5pbWF0aW9uU2Nyb2xsVGFyZ2V0KTtcbiAgICB0aGlzLmFuaW1hdGlvblJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLmFuaW1hdGlvblNjcm9sbFRhcmdldCA9IG51bGw7XG4gICAgdGhpcy5lbWl0KCdhbmltYXRpb24gZW5kJyk7XG4gICAgLy8gY29uc29sZS5sb2coJ2FuaW0gZW5kJylcbiAgICByZXR1cm47XG4gIH1cblxuICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSh0aGlzLmFuaW1hdGlvblNjcm9sbEZyYW1lKTtcblxuICBkeCAqPSBzcGVlZDtcbiAgZHkgKj0gc3BlZWQ7XG5cbiAgZHggPSBkeCA+IDAgPyBNYXRoLmNlaWwoZHgpIDogTWF0aC5mbG9vcihkeCk7XG4gIGR5ID0gZHkgPiAwID8gTWF0aC5jZWlsKGR5KSA6IE1hdGguZmxvb3IoZHkpO1xuXG4gIHRoaXMuc2Nyb2xsQnkoZHgsIGR5KTtcbn07XG5cbkphenoucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHRoaXMuZGVsZXRlKCk7XG4gIHZhciBsZW5ndGggPSB0aGlzLmJ1ZmZlci5pbnNlcnQodGhpcy5jYXJldCwgdGV4dCk7XG4gIHRoaXMubW92ZS5ieUNoYXJzKGxlbmd0aCwgdHJ1ZSk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5iYWNrc3BhY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0JlZ2luT2ZGaWxlKCkpIHtcbiAgICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuZGVsZXRlKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLm1hcmsuYWN0aXZlKSB7XG4gICAgdmFyIGFyZWEgPSB0aGlzLm1hcmsuZ2V0KCk7XG4gICAgdGhpcy5zZXRDYXJldChhcmVhLmJlZ2luKTtcbiAgICB0aGlzLmJ1ZmZlci5kZWxldGVBcmVhKGFyZWEpO1xuICAgIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICAgIHRoaXMuY2xlYXIoKTtcbiAgICB0aGlzLnJlcGFpbnQoKTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLm1vdmUuYnlDaGFycygtMSwgdHJ1ZSk7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQ2hhckF0KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMubW92ZS5pc0VuZE9mRmlsZSgpKSB7XG4gICAgaWYgKHRoaXMubWFyay5hY3RpdmUpIHJldHVybiB0aGlzLmJhY2tzcGFjZSgpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodGhpcy5tYXJrLmFjdGl2ZSkge1xuICAgIHZhciBhcmVhID0gdGhpcy5tYXJrLmdldCgpO1xuICAgIHRoaXMuc2V0Q2FyZXQoYXJlYS5iZWdpbik7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQXJlYShhcmVhKTtcbiAgICB0aGlzLm1hcmtDbGVhcih0cnVlKTtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZXBhaW50KCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5idWZmZXIuZGVsZXRlQ2hhckF0KHRoaXMuY2FyZXQpO1xuICB9XG59O1xuXG5KYXp6LnByb3RvdHlwZS5maW5kSnVtcCA9IGZ1bmN0aW9uKGp1bXApIHtcbiAgaWYgKCF0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCB8fCAhdGhpcy5maW5kLmlzT3BlbikgcmV0dXJuO1xuXG4gIHRoaXMuZmluZE5lZWRsZSA9IHRoaXMuZmluZE5lZWRsZSArIGp1bXA7XG4gIGlmICh0aGlzLmZpbmROZWVkbGUgPj0gdGhpcy5maW5kUmVzdWx0cy5sZW5ndGgpIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSAwO1xuICB9IGVsc2UgaWYgKHRoaXMuZmluZE5lZWRsZSA8IDApIHtcbiAgICB0aGlzLmZpbmROZWVkbGUgPSB0aGlzLmZpbmRSZXN1bHRzLmxlbmd0aCAtIDE7XG4gIH1cblxuICB2YXIgcmVzdWx0ID0gdGhpcy5maW5kUmVzdWx0c1t0aGlzLmZpbmROZWVkbGVdO1xuICB0aGlzLnNldENhcmV0KHJlc3VsdCk7XG4gIHRoaXMubWFya0NsZWFyKHRydWUpO1xuICB0aGlzLm1hcmtCZWdpbigpO1xuICB0aGlzLm1vdmUuYnlDaGFycyh0aGlzLmZpbmRWYWx1ZS5sZW5ndGgsIHRydWUpO1xuICB0aGlzLm1hcmtTZXQoKTtcbiAgdGhpcy5mb2xsb3dDYXJldCgpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kVmFsdWUgPSBmdW5jdGlvbih2YWx1ZSwgbm9KdW1wKSB7XG4gIHZhciBnID0gbmV3IFBvaW50KHsgeDogdGhpcy5ndXR0ZXIsIHk6IDAgfSk7XG5cbiAgdGhpcy5idWZmZXIudXBkYXRlUmF3KCk7XG5cbiAgdGhpcy52aWV3cy5maW5kLmNsZWFyKCk7XG5cbiAgdGhpcy5maW5kVmFsdWUgPSB2YWx1ZTtcbiAgLy8gY29uc29sZS50aW1lKCdmaW5kICcgKyB2YWx1ZSk7XG4gIHRoaXMuZmluZFJlc3VsdHMgPSB0aGlzLmJ1ZmZlci5pbmRleGVyLmZpbmQodmFsdWUpLm1hcCgob2Zmc2V0KSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuYnVmZmVyLmxpbmVzLmdldE9mZnNldChvZmZzZXQpO1xuICAgICAgLy9weDogbmV3IFBvaW50KHBvaW50KVsnKiddKGUuY2hhcilbJysnXShnKVxuICB9KTtcbiAgLy8gY29uc29sZS50aW1lRW5kKCdmaW5kICcgKyB2YWx1ZSk7XG5cbiAgdGhpcy5maW5kLmluZm8oJzAvJyArIHRoaXMuZmluZFJlc3VsdHMubGVuZ3RoKTtcblxuICBpZiAoIW5vSnVtcCkgdGhpcy5maW5kSnVtcCgwKTtcblxuICB0aGlzLnZpZXdzLmZpbmQucmVuZGVyKCk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5vbkZpbmRLZXkgPSBmdW5jdGlvbihlKSB7XG4gIGlmICh+WzMzLCAzNCwgMTE0XS5pbmRleE9mKGUud2hpY2gpKSB7IC8vIHBhZ2V1cCwgcGFnZWRvd24sIGYzXG4gICAgdGhpcy5pbnB1dC50ZXh0Lm9ua2V5ZG93bihlKTtcbiAgfVxuXG4gIGlmICg3MCA9PT0gZS53aGljaCAmJiBlLmN0cmxLZXkpIHsgLy8gY3RybCtmXG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoOSA9PT0gZS53aGljaCkgeyAvLyB0YWJcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5pbnB1dC5mb2N1cygpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kT3BlbiA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZpbmQuaW5mbygnJyk7XG4gIHRoaXMub25GaW5kVmFsdWUodGhpcy5maW5kVmFsdWUpO1xufTtcblxuSmF6ei5wcm90b3R5cGUub25GaW5kQ2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy52aWV3cy5maW5kLmNsZWFyKCk7XG4gIHRoaXMuZm9jdXMoKTtcbn07XG5cbkphenoucHJvdG90eXBlLnN1Z2dlc3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGFyZWEgPSB0aGlzLmJ1ZmZlci53b3JkQXQodGhpcy5jYXJldCwgdHJ1ZSk7XG4gIGlmICghYXJlYSkgcmV0dXJuO1xuXG4gIHZhciBrZXkgPSB0aGlzLmJ1ZmZlci5nZXRBcmVhKGFyZWEpO1xuICBpZiAoIWtleSkgcmV0dXJuO1xuXG4gIGlmICghdGhpcy5zdWdnZXN0Um9vdFxuICAgIHx8IGtleS5zdWJzdHIoMCwgdGhpcy5zdWdnZXN0Um9vdC5sZW5ndGgpICE9PSB0aGlzLnN1Z2dlc3RSb290KSB7XG4gICAgdGhpcy5zdWdnZXN0SW5kZXggPSAwO1xuICAgIHRoaXMuc3VnZ2VzdFJvb3QgPSBrZXk7XG4gICAgdGhpcy5zdWdnZXN0Tm9kZXMgPSB0aGlzLmJ1ZmZlci5wcmVmaXguY29sbGVjdChrZXkpO1xuICB9XG5cbiAgaWYgKCF0aGlzLnN1Z2dlc3ROb2Rlcy5sZW5ndGgpIHJldHVybjtcbiAgdmFyIG5vZGUgPSB0aGlzLnN1Z2dlc3ROb2Rlc1t0aGlzLnN1Z2dlc3RJbmRleF07XG5cbiAgdGhpcy5zdWdnZXN0SW5kZXggPSAodGhpcy5zdWdnZXN0SW5kZXggKyAxKSAlIHRoaXMuc3VnZ2VzdE5vZGVzLmxlbmd0aDtcblxuICByZXR1cm4ge1xuICAgIGFyZWE6IGFyZWEsXG4gICAgbm9kZTogbm9kZVxuICB9O1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVwYWludCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnJlc2l6ZSgpO1xuICB0aGlzLnJlbmRlcigpO1xufTtcblxuSmF6ei5wcm90b3R5cGUucmVzaXplID0gZnVuY3Rpb24oKSB7XG4gIHZhciAkID0gdGhpcy5lbDtcblxuICB0aGlzLm9mZnNldC5zZXQoZG9tLmdldE9mZnNldCgkKSk7XG4gIHRoaXMuc2Nyb2xsLnNldChkb20uZ2V0U2Nyb2xsKCQpKTtcbiAgdGhpcy5zaXplLnNldChkb20uZ2V0U2l6ZSgkKSk7XG4gIHRoaXMuY2hhci5zZXQoZG9tLmdldENoYXJTaXplKCQpKTtcbiAgdGhpcy5yb3dzID0gdGhpcy5idWZmZXIubG9jO1xuICB0aGlzLmNvZGUgPSB0aGlzLmJ1ZmZlci50ZXh0Lmxlbmd0aDtcbiAgdGhpcy5wYWdlLnNldCh0aGlzLnNpemVbJ14vJ10odGhpcy5jaGFyKSk7XG4gIHRoaXMucGFnZVJlbWFpbmRlci5zZXQodGhpcy5zaXplWyctJ10odGhpcy5wYWdlWycqJ10odGhpcy5jaGFyKSkpO1xuICB0aGlzLnBhZ2VCb3VuZHMgPSBbMCwgdGhpcy5yb3dzXTtcbiAgdGhpcy5sb25nZXN0TGluZSA9IE1hdGgubWluKDUwMCwgdGhpcy5idWZmZXIubGluZXMuZ2V0TG9uZ2VzdExpbmVMZW5ndGgoKSk7XG4gIHRoaXMuZ3V0dGVyID0gTWF0aC5tYXgoXG4gICAgdGhpcy5vcHRpb25zLmhpZGVfcm93cyA/IDAgOiAoJycrdGhpcy5yb3dzKS5sZW5ndGgsXG4gICAgKHRoaXMub3B0aW9ucy5jZW50ZXJcbiAgICAgID8gKHRoaXMucGFnZS53aWR0aCAtIDgxKSAvIDIgfCAwIDogMClcbiAgICArICh0aGlzLm9wdGlvbnMuaGlkZV9yb3dzXG4gICAgICA/IDAgOiBNYXRoLm1heCg0LCAoJycrdGhpcy5yb3dzKS5sZW5ndGgpKVxuICApICogdGhpcy5jaGFyLndpZHRoICsgKHRoaXMub3B0aW9ucy5oaWRlX3Jvd3MgPyAwIDogdGhpcy5ndXR0ZXJNYXJnaW4pO1xuXG4gIC8vIGRvbS5zdHlsZSh0aGlzLmVsLCB7XG4gIC8vICAgd2lkdGg6IHRoaXMubG9uZ2VzdExpbmUgKiB0aGlzLmNoYXIud2lkdGgsXG4gIC8vICAgaGVpZ2h0OiB0aGlzLnJvd3MgKiB0aGlzLmNoYXIuaGVpZ2h0XG4gIC8vIH0pO1xuXG4gIGRvbS5zdHlsZSh0aGlzLnZpZXdzLmNhcmV0LCB7XG4gICAgaGVpZ2h0OiB0aGlzLmNoYXIuaGVpZ2h0XG4gIH0pO1xuXG4gIC8vVE9ETzogbWFrZSBtZXRob2QvdXRpbFxuICAvLyBkcmF3IGluZGVudCBpbWFnZVxuICB2YXIgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHZhciBmb28gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm9vJyk7XG4gIHZhciBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICBjYW52YXMuc2V0QXR0cmlidXRlKCd3aWR0aCcsIE1hdGguY2VpbCh0aGlzLmNoYXIud2lkdGggKiAyKSk7XG4gIGNhbnZhcy5zZXRBdHRyaWJ1dGUoJ2hlaWdodCcsIHRoaXMuY2hhci5oZWlnaHQpO1xuXG4gIHZhciBjb21tZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY29tbWVudCcpO1xuICAkLmFwcGVuZENoaWxkKGNvbW1lbnQpO1xuICB2YXIgY29sb3IgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShjb21tZW50KS5jb2xvcjtcbiAgJC5yZW1vdmVDaGlsZChjb21tZW50KTtcbiAgY3R4LnNldExpbmVEYXNoKFsxLDFdKTtcbiAgY3R4LmxpbmVEYXNoT2Zmc2V0ID0gMDtcbiAgY3R4LmJlZ2luUGF0aCgpO1xuICBjdHgubW92ZVRvKDAsMSk7XG4gIGN0eC5saW5lVG8oMCwgdGhpcy5jaGFyLmhlaWdodCk7XG4gIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICBjdHguc3Ryb2tlKCk7XG5cbiAgdmFyIGRhdGFVUkwgPSBjYW52YXMudG9EYXRhVVJMKCk7XG5cbiAgZG9tLmNzcygnJ1xuICArICcuZWRpdG9yID4gLmxheWVyID4gLmZpbmQsJ1xuICArICcuZWRpdG9yID4gLmxheWVyID4gLm1hcmssJ1xuICArICcuZWRpdG9yID4gLmxheWVyID4gLmNvZGUgeydcbiAgKyAnICBwYWRkaW5nLWxlZnQ6ICcgKyAodGhpcy5vcHRpb25zLm1hcmdpbl9sZWZ0ICsgdGhpcy5ndXR0ZXIpICsgJ3B4OydcbiAgKyAnfSdcbiAgKyAnLmVkaXRvciA+IC5sYXllciA+IC5yb3dzIHsnXG4gICsgJyAgcGFkZGluZy1yaWdodDogJyArIHRoaXMuZ3V0dGVyTWFyZ2luICsgJ3B4OydcbiAgKyAnICBtYXJnaW4tbGVmdDogJyArIHRoaXMub3B0aW9ucy5tYXJnaW5fbGVmdCArICdweDsnXG4gICsgJyAgd2lkdGg6ICcgKyB0aGlzLmd1dHRlciArICdweDsnXG4gICsgJ30nXG4gICsgJy5lZGl0b3IgPiAubGF5ZXIgPiAuZmluZCA+IGkgeydcbiAgKyAnICBoZWlnaHQ6ICcgKyAodGhpcy5jaGFyLmhlaWdodCArIDEpICsgJ3B4OydcbiAgKyAnfSdcbiAgKyAnLmVkaXRvciA+IC5sYXllciA+IC5ibG9jayA+IGkgeydcbiAgKyAnICBoZWlnaHQ6ICcgKyAodGhpcy5jaGFyLmhlaWdodCArIDEpICsgJ3B4OydcbiAgKyAnfSdcbiAgKyAnaW5kZW50IHsnXG4gICsgJyAgYmFja2dyb3VuZC1pbWFnZTogdXJsKCcgKyBkYXRhVVJMICsgJyk7J1xuICArICd9J1xuICApO1xuXG4gIHRoaXMuZW1pdCgncmVzaXplJyk7XG59O1xuXG5KYXp6LnByb3RvdHlwZS5jbGVhciA9IGF0b21pYyhmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ2NsZWFyJylcbiAgdGhpcy52aWV3cy5jbGVhcigpO1xufSk7XG5cbkphenoucHJvdG90eXBlLnJlbmRlciA9IGF0b21pYyhmdW5jdGlvbigpIHtcbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicpXG4gIHRoaXMudmlld3MucmVuZGVyKCk7XG4gIHRoaXMuZW1pdCgncmVuZGVyJyk7XG59KTtcbiIsInZhciBQb2ludCA9IHJlcXVpcmUoJ3BvaW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQXJlYTtcblxuZnVuY3Rpb24gQXJlYShhKSB7XG4gIGlmIChhKSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludChhLmJlZ2luKTtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludChhLmVuZCk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5iZWdpbiA9IG5ldyBQb2ludDtcbiAgICB0aGlzLmVuZCA9IG5ldyBQb2ludDtcbiAgfVxufVxuXG5BcmVhLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgQXJlYSh0aGlzKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcyA9IFt0aGlzLmJlZ2luLCB0aGlzLmVuZF0uc29ydChQb2ludC5zb3J0KTtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjogbmV3IFBvaW50KHNbMF0pLFxuICAgIGVuZDogbmV3IFBvaW50KHNbMV0pXG4gIH0pO1xufTtcblxuQXJlYS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oYXJlYSkge1xuICB0aGlzLmJlZ2luLnNldChhcmVhLmJlZ2luKTtcbiAgdGhpcy5lbmQuc2V0KGFyZWEuZW5kKTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnNldExlZnQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMuYmVnaW4ueCA9IHg7XG4gIHRoaXMuZW5kLnggPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbkFyZWEucHJvdG90eXBlLmFkZFJpZ2h0ID0gZnVuY3Rpb24oeCkge1xuICBpZiAodGhpcy5iZWdpbi54KSB0aGlzLmJlZ2luLnggKz0geDtcbiAgaWYgKHRoaXMuZW5kLngpIHRoaXMuZW5kLnggKz0geDtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5hZGRCb3R0b20gPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuZW5kLnkgKz0geTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5BcmVhLnByb3RvdHlwZS5zaGlmdEJ5TGluZXMgPSBmdW5jdGlvbih5KSB7XG4gIHRoaXMuYmVnaW4ueSArPSB5O1xuICB0aGlzLmVuZC55ICs9IHk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPiddID1cbkFyZWEucHJvdG90eXBlLmdyZWF0ZXJUaGFuID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmJlZ2luLnggPiBhLmVuZC54XG4gICAgOiB0aGlzLmJlZ2luLnkgPiBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49J10gPVxuQXJlYS5wcm90b3R5cGUuZ3JlYXRlclRoYW5PckVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuYmVnaW4ueCA+PSBhLmJlZ2luLnhcbiAgICA6IHRoaXMuYmVnaW4ueSA+IGEuYmVnaW4ueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8J10gPVxuQXJlYS5wcm90b3R5cGUubGVzc1RoYW4gPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmJlZ2luLnlcbiAgICA/IHRoaXMuZW5kLnggPCBhLmJlZ2luLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmJlZ2luLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnPD0nXSA9XG5BcmVhLnByb3RvdHlwZS5sZXNzVGhhbk9yRXF1YWwgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzLmVuZC55ID09PSBhLmVuZC55XG4gICAgPyB0aGlzLmVuZC54IDw9IGEuZW5kLnhcbiAgICA6IHRoaXMuZW5kLnkgPCBhLmVuZC55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz48J10gPVxuQXJlYS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPiddKGEpICYmIHRoaXNbJzwnXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc8PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihhKSB7XG4gIHJldHVybiB0aGlzWyc8J10oYSkgfHwgdGhpc1snPiddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz49PCddID1cbkFyZWEucHJvdG90eXBlLmluc2lkZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snPj0nXShhKSAmJiB0aGlzWyc8PSddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJzw9PiddID1cbkFyZWEucHJvdG90eXBlLm91dHNpZGVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXNbJzw9J10oYSkgfHwgdGhpc1snPj0nXShhKTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyc9PT0nXSA9XG5BcmVhLnByb3RvdHlwZS5lcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueCA9PT0gYS5iZWdpbi54ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55XG4gICAgICAmJiB0aGlzLmVuZC54ICAgPT09IGEuZW5kLnggICAmJiB0aGlzLmVuZC55ICAgPT09IGEuZW5kLnk7XG59O1xuXG5BcmVhLnByb3RvdHlwZVsnfD0nXSA9XG5BcmVhLnByb3RvdHlwZS5iZWdpbkxpbmVFcXVhbCA9IGZ1bmN0aW9uKGEpIHtcbiAgcmV0dXJuIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18J10gPVxuQXJlYS5wcm90b3R5cGUuZW5kTGluZUVxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5lbmQueSA9PT0gYS5lbmQueTtcbn07XG5cbkFyZWEucHJvdG90eXBlWyd8PXwnXSA9XG5BcmVhLnByb3RvdHlwZS5saW5lc0VxdWFsID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpc1snfD0nXShhKSAmJiB0aGlzWyc9fCddKGEpO1xufTtcblxuQXJlYS5wcm90b3R5cGVbJz18PSddID1cbkFyZWEucHJvdG90eXBlLnNhbWVMaW5lID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gdGhpcy5iZWdpbi55ID09PSB0aGlzLmVuZC55ICYmIHRoaXMuYmVnaW4ueSA9PT0gYS5iZWdpbi55O1xufTtcblxuQXJlYS5wcm90b3R5cGVbJy14LSddID1cbkFyZWEucHJvdG90eXBlLnNob3J0ZW5CeVggPSBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBuZXcgQXJlYSh7XG4gICAgYmVnaW46IHtcbiAgICAgIHg6IHRoaXMuYmVnaW4ueCArIHgsXG4gICAgICB5OiB0aGlzLmJlZ2luLnlcbiAgICB9LFxuICAgIGVuZDoge1xuICAgICAgeDogdGhpcy5lbmQueCAtIHgsXG4gICAgICB5OiB0aGlzLmVuZC55XG4gICAgfVxuICB9KTtcbn07XG5cbkFyZWEucHJvdG90eXBlWycreCsnXSA9XG5BcmVhLnByb3RvdHlwZS53aWRlbkJ5WCA9IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIG5ldyBBcmVhKHtcbiAgICBiZWdpbjoge1xuICAgICAgeDogdGhpcy5iZWdpbi54IC0geCxcbiAgICAgIHk6IHRoaXMuYmVnaW4ueVxuICAgIH0sXG4gICAgZW5kOiB7XG4gICAgICB4OiB0aGlzLmVuZC54ICsgeCxcbiAgICAgIHk6IHRoaXMuZW5kLnlcbiAgICB9XG4gIH0pO1xufTtcblxuQXJlYS5vZmZzZXQgPSBmdW5jdGlvbihiLCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldChiLmJlZ2luLCBhLmJlZ2luKSxcbiAgICBlbmQ6IHBvaW50Lm9mZnNldChiLmVuZCwgYS5lbmQpXG4gIH07XG59O1xuXG5BcmVhLm9mZnNldFggPSBmdW5jdGlvbih4LCBhKSB7XG4gIHJldHVybiB7XG4gICAgYmVnaW46IHBvaW50Lm9mZnNldFgoeCwgYS5iZWdpbiksXG4gICAgZW5kOiBwb2ludC5vZmZzZXRYKHgsIGEuZW5kKVxuICB9O1xufTtcblxuQXJlYS5vZmZzZXRZID0gZnVuY3Rpb24oeSwgYSkge1xuICByZXR1cm4ge1xuICAgIGJlZ2luOiBwb2ludC5vZmZzZXRZKHksIGEuYmVnaW4pLFxuICAgIGVuZDogcG9pbnQub2Zmc2V0WSh5LCBhLmVuZClcbiAgfTtcbn07XG5cbkFyZWEucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oYSkge1xuICByZXR1cm4gJycgKyBhLmJlZ2luICsgJy0nICsgYS5lbmQ7XG59O1xuXG5BcmVhLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLmJlZ2luLnkgPT09IGIuYmVnaW4ueVxuICAgID8gYS5iZWdpbi54IC0gYi5iZWdpbi54XG4gICAgOiBhLmJlZ2luLnkgLSBiLmJlZ2luLnk7XG59O1xuXG5BcmVhLnRvUG9pbnRTb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS5iZWdpbi55IDw9IGIueSAmJiBhLmVuZC55ID49IGIueVxuICAgID8gYS5iZWdpbi55ID09PSBiLnlcbiAgICAgID8gYS5iZWdpbi54IC0gYi54XG4gICAgICA6IGEuZW5kLnkgPT09IGIueVxuICAgICAgICA/IGEuZW5kLnggLSBiLnhcbiAgICAgICAgOiAwXG4gICAgOiBhLmJlZ2luLnkgLSBiLnk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGF0b21pYztcblxuLy8gZnVuY3Rpb24gYXRvbWljKGZuKSB7XG4vLyAgIHZhciBzdGFnZSA9IGZhbHNlO1xuLy8gICB2YXIgbiA9IDA7XG5cbi8vICAgZnVuY3Rpb24gd3JhcCgpIHtcbi8vICAgICBpZiAoc3RhZ2UpIHJldHVybiBuKys7XG4vLyAgICAgZWxzZSBmbi5jYWxsKHRoaXMpO1xuLy8gICB9XG5cbi8vICAgd3JhcC5ob2xkID0gZnVuY3Rpb24oKSB7XG4vLyAgICAgc3RhZ2UgPSB0cnVlO1xuLy8gICAgIG4gPSBuIHx8IDA7XG4vLyAgIH07XG5cbi8vICAgd3JhcC5yZWxlYXNlID0gZnVuY3Rpb24oY29udGV4dCkge1xuLy8gICAgIGlmIChzdGFnZSAmJiBuKSB7XG4vLyAgICAgICBzdGFnZSA9IGZhbHNlO1xuLy8gICAgICAgbiA9IDA7XG4vLyAgICAgICBmbi5jYWxsKGNvbnRleHQpO1xuLy8gICAgIH1cbi8vICAgfTtcblxuLy8gICByZXR1cm4gd3JhcDtcbi8vIH1cblxuZnVuY3Rpb24gYXRvbWljKGZuKSB7XG4gIHZhciByZXF1ZXN0O1xuXG4gIHJldHVybiBmdW5jdGlvbihhKSB7XG4gICAgY2xlYXJJbW1lZGlhdGUocmVxdWVzdCk7XG4gICAgcmVxdWVzdCA9IHNldEltbWVkaWF0ZShmbi5iaW5kKHRoaXMsIGEpKTtcbiAgfTtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBCb3g7XG5cbmZ1bmN0aW9uIEJveChiKSB7XG4gIGlmIChiKSB7XG4gICAgdGhpcy53aWR0aCA9IGIud2lkdGg7XG4gICAgdGhpcy5oZWlnaHQgPSBiLmhlaWdodDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLndpZHRoID0gMDtcbiAgICB0aGlzLmhlaWdodCA9IDA7XG4gIH1cbn1cblxuQm94LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbihiKSB7XG4gIHRoaXMud2lkdGggPSBiLndpZHRoO1xuICB0aGlzLmhlaWdodCA9IGIuaGVpZ2h0O1xufTtcblxuQm94LnByb3RvdHlwZVsnLyddID1cbkJveC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLyAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cbkJveC5wcm90b3R5cGVbJ14vJ10gPVxuQm94LnByb3RvdHlwZS5jZWlsZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IE1hdGguY2VpbCh0aGlzLndpZHRoIC8gKHAueCB8fCBwLndpZHRoIHx8IDApKSxcbiAgICBoZWlnaHQ6IE1hdGguY2VpbCh0aGlzLmhlaWdodCAvIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkpXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnKiddID1cbkJveC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggKiBiLndpZHRoIHwgMCxcbiAgICBoZWlnaHQ6IHRoaXMuaGVpZ2h0ICogYi5oZWlnaHQgfCAwXG4gIH0pO1xufTtcblxuQm94LnByb3RvdHlwZVsnLSddID1cbkJveC5wcm90b3R5cGUuc3ViID0gZnVuY3Rpb24oYikge1xuICByZXR1cm4gbmV3IEJveCh7XG4gICAgd2lkdGg6IHRoaXMud2lkdGggLSBiLndpZHRoLFxuICAgIGhlaWdodDogdGhpcy5oZWlnaHQgLSBiLmhlaWdodFxuICB9KTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gY2xvbmUob2JqKSB7XG4gIHZhciBvID0ge307XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICB2YXIgdmFsID0gb2JqW2tleV07XG4gICAgaWYgKCdvYmplY3QnID09PSB0eXBlb2YgdmFsKSB7XG4gICAgICBvW2tleV0gPSBjbG9uZSh2YWwpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvW2tleV0gPSB2YWw7XG4gICAgfVxuICB9XG4gIHJldHVybiBvO1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihmbiwgbXMpIHtcbiAgdmFyIHRpbWVvdXQ7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uIGRlYm91bmNlV3JhcChhLCBiLCBjLCBkKSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZuLmJpbmQodGhpcywgYSwgYiwgYywgZCksIG1zKTtcbiAgICByZXR1cm4gdGltZW91dDtcbiAgfVxufTtcbiIsInZhciBkb20gPSByZXF1aXJlKCdkb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJ2V2ZW50Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlhbG9nO1xuXG5mdW5jdGlvbiBEaWFsb2cobGFiZWwsIGtleW1hcCkge1xuICB0aGlzLm5vZGUgPSBkb20oJ2RpYWxvZycsIFtcbiAgICAnPGxhYmVsPmxhYmVsJyxcbiAgICBbJ2lucHV0JywgW1xuICAgICAgJzxpbnB1dD50ZXh0JyxcbiAgICAgICdpbmZvJ1xuICAgIF1dXG4gIF0pO1xuICBkb20udGV4dCh0aGlzLm5vZGUubGFiZWwsIGxhYmVsKTtcbiAgZG9tLnN0eWxlKHRoaXMubm9kZS5pbnB1dC5pbmZvLCB7IGRpc3BsYXk6ICdub25lJyB9KTtcbiAgdGhpcy5rZXltYXAgPSBrZXltYXA7XG4gIHRoaXMub25ib2R5a2V5ZG93biA9IHRoaXMub25ib2R5a2V5ZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGUuaW5wdXQuZWwub25rZXlkb3duID0gdGhpcy5vbmtleWRvd247XG4gIHRoaXMubm9kZS5pbnB1dC5lbC5vbmNsaWNrID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGUuaW5wdXQuZWwub25tb3VzZXVwID0gc3RvcFByb3BhZ2F0aW9uO1xuICB0aGlzLm5vZGUuaW5wdXQuZWwub25tb3VzZWRvd24gPSBzdG9wUHJvcGFnYXRpb247XG4gIHRoaXMubm9kZS5pbnB1dC5lbC5vbmlucHV0ID0gdGhpcy5vbmlucHV0O1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xufVxuXG5EaWFsb2cucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuZnVuY3Rpb24gc3RvcFByb3BhZ2F0aW9uKGUpIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaGFzRm9jdXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMubm9kZS5pbnB1dC5lbC5oYXNGb2N1cygpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmJvZHlrZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICBpZiAoMjcgPT09IGUud2hpY2gpIHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuRGlhbG9nLnByb3RvdHlwZS5vbmtleWRvd24gPSBmdW5jdGlvbihlKSB7XG4gIGlmICgxMyA9PT0gZS53aGljaCkge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICB0aGlzLnN1Ym1pdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoZS53aGljaCBpbiB0aGlzLmtleW1hcCkge1xuICAgIHRoaXMuZW1pdCgna2V5JywgZSk7XG4gIH1cbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5lbWl0KCd2YWx1ZScsIHRoaXMubm9kZS5pbnB1dC50ZXh0LmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUub3BlbiA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICBkb20uYXBwZW5kKGRvY3VtZW50LmJvZHksIHRoaXMubm9kZSk7XG4gIGRvbS5mb2N1cyh0aGlzLm5vZGUuaW5wdXQudGV4dCk7XG4gIHRoaXMubm9kZS5pbnB1dC50ZXh0LmVsLnNlbGVjdCgpO1xuICB0aGlzLmlzT3BlbiA9IHRydWU7XG4gIHRoaXMuZW1pdCgnb3BlbicpO1xufTtcblxuRGlhbG9nLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICBkb2N1bWVudC5ib2R5LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCB0aGlzLm9uYm9keWtleWRvd24pO1xuICB0aGlzLm5vZGUuZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLm5vZGUuZWwpO1xuICB0aGlzLmlzT3BlbiA9IGZhbHNlO1xuICB0aGlzLmVtaXQoJ2Nsb3NlJyk7XG59O1xuXG5EaWFsb2cucHJvdG90eXBlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmVtaXQoJ3N1Ym1pdCcsIHRoaXMubm9kZS5pbnB1dC50ZXh0LmVsLnZhbHVlKTtcbn07XG5cbkRpYWxvZy5wcm90b3R5cGUuaW5mbyA9IGZ1bmN0aW9uKGluZm8pIHtcbiAgZG9tLnRleHQodGhpcy5ub2RlLmlucHV0LmluZm8sIGluZm8pO1xuICBkb20uc3R5bGUodGhpcy5ub2RlLmlucHV0LmluZm8sIHsgZGlzcGxheTogaW5mbyA/ICdibG9jaycgOiAnbm9uZScgfSk7XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IGRpZmY7XG5cbmZ1bmN0aW9uIGRpZmYoYSwgYikge1xuICBpZiAoJ29iamVjdCcgPT09IHR5cGVvZiBhKSB7XG4gICAgdmFyIGQgPSB7fTtcbiAgICB2YXIgaSA9IDA7XG4gICAgZm9yICh2YXIgayBpbiBiKSB7XG4gICAgICBpZiAoYVtrXSAhPT0gYltrXSkge1xuICAgICAgICBkW2tdID0gYltrXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaSkgcmV0dXJuIGQ7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGEgIT09IGI7XG4gIH1cbn1cbiIsInZhciBtZW1vaXplID0gcmVxdWlyZSgnbWVtb2l6ZScpO1xudmFyIG1lcmdlID0gcmVxdWlyZSgnbWVyZ2UnKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnZGlmZicpO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbnZhciB1bml0cyA9IHtcbiAgbGVmdDogJ3B4JyxcbiAgdG9wOiAncHgnLFxuICByaWdodDogJ3B4JyxcbiAgYm90dG9tOiAncHgnLFxuICB3aWR0aDogJ3B4JyxcbiAgaGVpZ2h0OiAncHgnLFxuICBtYXhIZWlnaHQ6ICdweCcsXG4gIHBhZGRpbmdMZWZ0OiAncHgnLFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBkb207XG5cbmZ1bmN0aW9uIGRvbShuYW1lLCBjaGlsZHJlbiwgYXR0cnMpIHtcbiAgdmFyIGVsO1xuICB2YXIgdGFnID0gJ2Rpdic7XG4gIHZhciBub2RlO1xuXG4gIGlmICgnc3RyaW5nJyA9PT0gdHlwZW9mIG5hbWUpIHtcbiAgICBpZiAoJzwnID09PSBuYW1lLmNoYXJBdCgwKSkge1xuICAgICAgdmFyIG1hdGNoZXMgPSBuYW1lLm1hdGNoKC8oPzo8KSguKikoPzo+KShcXFMrKT8vKTtcbiAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgIHRhZyA9IG1hdGNoZXNbMV07XG4gICAgICAgIG5hbWUgPSBtYXRjaGVzWzJdIHx8IHRhZztcbiAgICAgIH1cbiAgICB9XG4gICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZyk7XG4gICAgbm9kZSA9IHtcbiAgICAgIGVsOiBlbCxcbiAgICAgIG5hbWU6IG5hbWVcbiAgICB9O1xuICAgIGRvbS5jbGFzc2VzKG5vZGUsIFtdKTtcbiAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KG5hbWUpKSB7XG4gICAgcmV0dXJuIGRvbS5hcHBseShudWxsLCBuYW1lKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoJ2RvbScgaW4gbmFtZSkge1xuICAgICAgbm9kZSA9IG5hbWUuZG9tO1xuICAgIH0gZWxzZSB7XG4gICAgICBub2RlID0gbmFtZTtcbiAgICB9XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZHJlbikpIHtcbiAgICBjaGlsZHJlblxuICAgICAgLm1hcChkb20pXG4gICAgICAubWFwKGZ1bmN0aW9uKGNoaWxkLCBpKSB7XG4gICAgICAgIG5vZGVbY2hpbGQubmFtZV0gPSBjaGlsZDtcbiAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgfSlcbiAgICAgIC5tYXAoZnVuY3Rpb24oY2hpbGQpIHtcbiAgICAgICAgbm9kZS5lbC5hcHBlbmRDaGlsZChjaGlsZC5lbCk7XG4gICAgICB9KTtcbiAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PT0gdHlwZW9mIGNoaWxkcmVuKSB7XG4gICAgZG9tLnN0eWxlKG5vZGUsIGNoaWxkcmVuKTtcbiAgfVxuXG4gIGlmIChhdHRycykge1xuICAgIGRvbS5hdHRycyhub2RlLCBhdHRycyk7XG4gIH1cblxuICByZXR1cm4gbm9kZTtcbn1cblxuZG9tLnN0eWxlID0gbWVtb2l6ZShmdW5jdGlvbihlbCwgXywgc3R5bGUpIHtcbiAgZm9yICh2YXIgbmFtZSBpbiBzdHlsZSlcbiAgICBpZiAobmFtZSBpbiB1bml0cylcbiAgICAgIHN0eWxlW25hbWVdICs9IHVuaXRzW25hbWVdO1xuICBPYmplY3QuYXNzaWduKGVsLnN0eWxlLCBzdHlsZSk7XG59LCBkaWZmLCBtZXJnZSwgZnVuY3Rpb24obm9kZSwgc3R5bGUpIHtcbiAgdmFyIGVsID0gZG9tLmdldEVsZW1lbnQobm9kZSk7XG4gIHJldHVybiBbZWwsIHN0eWxlXTtcbn0pO1xuXG5kb20uY2xhc3NlcyA9IG1lbW9pemUoZnVuY3Rpb24oZWwsIGNsYXNzTmFtZSkge1xuICBlbC5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG59LCBudWxsLCBudWxsLCBmdW5jdGlvbihub2RlLCBjbGFzc2VzKSB7XG4gIHZhciBlbCA9IGRvbS5nZXRFbGVtZW50KG5vZGUpO1xuICByZXR1cm4gW2VsLCBjbGFzc2VzLmNvbmNhdChub2RlLm5hbWUpLmZpbHRlcihCb29sZWFuKS5qb2luKCcgJyldO1xufSk7XG5cbmRvbS5hdHRycyA9IGZ1bmN0aW9uKGVsLCBhdHRycykge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgT2JqZWN0LmFzc2lnbihlbCwgYXR0cnMpO1xufTtcblxuZG9tLmh0bWwgPSBmdW5jdGlvbihlbCwgaHRtbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgZWwuaW5uZXJIVE1MID0gaHRtbDtcbn07XG5cbmRvbS50ZXh0ID0gZnVuY3Rpb24oZWwsIHRleHQpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGVsLnRleHRDb250ZW50ID0gdGV4dDtcbn07XG5cbmRvbS5mb2N1cyA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICBlbC5mb2N1cygpO1xufTtcblxuZG9tLmdldFNpemUgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIHtcbiAgICB3aWR0aDogZWwuY2xpZW50V2lkdGgsXG4gICAgaGVpZ2h0OiBlbC5jbGllbnRIZWlnaHRcbiAgfTtcbn07XG5cbmRvbS5nZXRDaGFyU2l6ZSA9IGZ1bmN0aW9uKGVsKSB7XG4gIGVsID0gZG9tLmdldEVsZW1lbnQoZWwpO1xuICB2YXIgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NwYW4nKTtcblxuICBlbC5hcHBlbmRDaGlsZChzcGFuKTtcblxuICBzcGFuLmlubmVySFRNTCA9ICcgJztcbiAgdmFyIGEgPSBzcGFuLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuXG4gIHNwYW4uaW5uZXJIVE1MID0gJyAgXFxuICc7XG4gIHZhciBiID0gc3Bhbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcblxuICBlbC5yZW1vdmVDaGlsZChzcGFuKTtcblxuICByZXR1cm4ge1xuICAgIHdpZHRoOiAoYi53aWR0aCAtIGEud2lkdGgpLFxuICAgIGhlaWdodDogKGIuaGVpZ2h0IC0gYS5oZWlnaHQpXG4gIH07XG59O1xuXG5kb20uZ2V0T2Zmc2V0ID0gZnVuY3Rpb24oZWwpIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIHZhciByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgdmFyIGJvcmRlckxlZnQgPSBwYXJzZUludChzdHlsZS5ib3JkZXJMZWZ0V2lkdGgpO1xuICB2YXIgYm9yZGVyVG9wID0gcGFyc2VJbnQoc3R5bGUuYm9yZGVyVG9wV2lkdGgpO1xuICByZXR1cm4ge1xuICAgIHg6IHJlY3QubGVmdCArIGJvcmRlckxlZnQsXG4gICAgeTogcmVjdC50b3AgKyBib3JkZXJUb3BcbiAgfTtcbn07XG5cbmRvbS5nZXRTY3JvbGwgPSBmdW5jdGlvbihlbCkge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgcmV0dXJuIGdldFNjcm9sbChlbCk7XG59O1xuXG5kb20ub25zY3JvbGwgPSBmdW5jdGlvbiBvbnNjcm9sbChlbCwgZm4pIHtcbiAgZWwgPSBkb20uZ2V0RWxlbWVudChlbCk7XG4gIGlmIChkb2N1bWVudC5ib2R5ID09PSBlbCkge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIGZ1bmN0aW9uKGV2KSB7XG4gICAgICBmbihnZXRTY3JvbGwoZWwpKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCBmdW5jdGlvbihldikge1xuICAgICAgZm4oZ2V0U2Nyb2xsKGVsKSk7XG4gICAgfSk7XG4gIH1cbn07XG5cbmRvbS5vbm9mZnNldCA9IGZ1bmN0aW9uKGVsLCBmbikge1xuICBlbCA9IGRvbS5nZXRFbGVtZW50KGVsKTtcbiAgd2hpbGUgKGVsID0gZWwub2Zmc2V0UGFyZW50KSB7XG4gICAgZG9tLm9uc2Nyb2xsKGVsLCBmbik7XG4gIH1cbn07XG5cbmRvbS5vbmNsaWNrID0gZnVuY3Rpb24oZWwsIGZuKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGZuKTtcbn07XG5cbmRvbS5vbnJlc2l6ZSA9IGZ1bmN0aW9uKGZuKSB7XG4gIHJldHVybiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgZm4pO1xufTtcblxuZG9tLmFwcGVuZCA9IGZ1bmN0aW9uKHRhcmdldCwgc3JjLCBkaWN0KSB7XG4gIHRhcmdldCA9IGRvbS5nZXRFbGVtZW50KHRhcmdldCk7XG4gIGlmICgnZm9yRWFjaCcgaW4gc3JjKSBzcmMuZm9yRWFjaChkb20uYXBwZW5kLmJpbmQobnVsbCwgdGFyZ2V0KSk7XG4gIC8vIGVsc2UgaWYgKCd2aWV3cycgaW4gc3JjKSBkb20uYXBwZW5kKHRhcmdldCwgc3JjLnZpZXdzLCB0cnVlKTtcbiAgZWxzZSBpZiAoZGljdCA9PT0gdHJ1ZSkgZm9yICh2YXIga2V5IGluIHNyYykgZG9tLmFwcGVuZCh0YXJnZXQsIHNyY1trZXldKTtcbiAgZWxzZSBpZiAoJ2Z1bmN0aW9uJyAhPSB0eXBlb2Ygc3JjKSB0YXJnZXQuYXBwZW5kQ2hpbGQoZG9tLmdldEVsZW1lbnQoc3JjKSk7XG59O1xuXG5kb20uZ2V0RWxlbWVudCA9IGZ1bmN0aW9uKGVsKSB7XG4gIHJldHVybiBlbC5kb20gJiYgZWwuZG9tLmVsIHx8IGVsLmVsIHx8IGVsLm5vZGUgfHwgZWw7XG59O1xuXG5kb20uc2Nyb2xsQnkgPSBmdW5jdGlvbihlbCwgeCwgeSwgc2Nyb2xsKSB7XG4gIHNjcm9sbCA9IHNjcm9sbCB8fCBkb20uZ2V0U2Nyb2xsKGVsKTtcbiAgZG9tLnNjcm9sbFRvKGVsLCBzY3JvbGwueCArIHgsIHNjcm9sbC55ICsgeSk7XG59O1xuXG5kb20uc2Nyb2xsVG8gPSBmdW5jdGlvbihlbCwgeCwgeSkge1xuICBpZiAoZG9jdW1lbnQuYm9keSA9PT0gZWwpIHtcbiAgICB3aW5kb3cuc2Nyb2xsVG8oeCwgeSk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKHgpIGVsLnNjcm9sbExlZnQgPSB4O1xuICAgIGlmICh5KSBlbC5zY3JvbGxUb3AgPSB5O1xuICB9XG59O1xuXG5kb20uY3NzID0gZnVuY3Rpb24oY3NzVGV4dCkge1xuICBkb20uY3NzLnN0eWxlLnRleHRDb250ZW50ID0gY3NzVGV4dDtcbn07XG5kb20uY3NzLnN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKVxuZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChkb20uY3NzLnN0eWxlKTtcblxuZnVuY3Rpb24gZ2V0U2Nyb2xsKGVsKSB7XG4gIHJldHVybiBkb2N1bWVudC5ib2R5ID09PSBlbFxuICAgID8ge1xuICAgICAgICB4OiAwLCAvL3dpbmRvdy5zY3JvbGxYIHx8IGVsLnNjcm9sbExlZnQgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbExlZnQsXG4gICAgICAgIHk6IHdpbmRvdy5zY3JvbGxZIHx8IGVsLnNjcm9sbFRvcCAgfHwgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbFRvcFxuICAgICAgfVxuICAgIDoge1xuICAgICAgICB4OiAwLCAvL2VsLnNjcm9sbExlZnQsXG4gICAgICAgIHk6IGVsLnNjcm9sbFRvcFxuICAgICAgfTtcbn1cbiIsIlxudmFyIHB1c2ggPSBbXS5wdXNoO1xudmFyIHNsaWNlID0gW10uc2xpY2U7XG5cbm1vZHVsZS5leHBvcnRzID0gRXZlbnQ7XG5cbmZ1bmN0aW9uIEV2ZW50KCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgRXZlbnQpKSByZXR1cm4gbmV3IEV2ZW50O1xuXG4gIHRoaXMuX2hhbmRsZXJzID0ge307XG59XG5cbkV2ZW50LnByb3RvdHlwZS5fZ2V0SGFuZGxlcnMgPSBmdW5jdGlvbihuYW1lKSB7XG4gIHRoaXMuX2hhbmRsZXJzID0gdGhpcy5faGFuZGxlcnMgfHwge307XG4gIHJldHVybiB0aGlzLl9oYW5kbGVyc1tuYW1lXSA9IHRoaXMuX2hhbmRsZXJzW25hbWVdIHx8IFtdO1xufTtcblxuRXZlbnQucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihuYW1lLCBhLCBiLCBjLCBkKSB7XG4gIHZhciBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGhhbmRsZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgaGFuZGxlcnNbaV0oYSwgYiwgYywgZCk7XG4gIH07XG59O1xuXG5FdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBoYW5kbGVycztcbiAgdmFyIG5ld0hhbmRsZXJzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBpZiAoQXJyYXkuaXNBcnJheShuYW1lKSkge1xuICAgIG5hbWUuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgICBoYW5kbGVycyA9IHRoaXMuX2dldEhhbmRsZXJzKG5hbWUpO1xuICAgICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnNbbmFtZV0pO1xuICAgIH0sIHRoaXMpO1xuICB9IGVsc2Uge1xuICAgIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gICAgcHVzaC5hcHBseShoYW5kbGVycywgbmV3SGFuZGxlcnMpO1xuICB9XG59O1xuXG5FdmVudC5wcm90b3R5cGUub2ZmID0gZnVuY3Rpb24obmFtZSwgaGFuZGxlcikge1xuICB2YXIgaGFuZGxlcnMgPSB0aGlzLl9nZXRIYW5kbGVycyhuYW1lKTtcbiAgdmFyIGluZGV4ID0gaGFuZGxlcnMuaW5kZXhPZihoYW5kbGVyKTtcbiAgaWYgKH5pbmRleCkgaGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cbkV2ZW50LnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcbiAgdmFyIGhhbmRsZXJzID0gdGhpcy5fZ2V0SGFuZGxlcnMobmFtZSk7XG4gIHZhciBoYW5kbGVyID0gZnVuY3Rpb24oYSwgYiwgYywgZCkge1xuICAgIGZuKGEsIGIsIGMsIGQpO1xuICAgIGhhbmRsZXJzLnNwbGljZShoYW5kbGVycy5pbmRleE9mKGhhbmRsZXIpLCAxKTtcbiAgfTtcbiAgaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gbWVtb2l6ZShmbiwgZGlmZiwgbWVyZ2UsIHByZSkge1xuICBkaWZmID0gZGlmZiB8fCBmdW5jdGlvbihhLCBiKSB7IHJldHVybiBhICE9PSBiIH07XG4gIG1lcmdlID0gbWVyZ2UgfHwgZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYiB9O1xuICBwcmUgPSBwcmUgfHwgZnVuY3Rpb24obm9kZSwgcGFyYW0pIHsgcmV0dXJuIHBhcmFtIH07XG5cbiAgdmFyIG5vZGVzID0gW107XG4gIHZhciBjYWNoZSA9IFtdO1xuICB2YXIgcmVzdWx0cyA9IFtdO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlLCBwYXJhbSkge1xuICAgIHZhciBhcmdzID0gcHJlKG5vZGUsIHBhcmFtKTtcbiAgICBub2RlID0gYXJnc1swXTtcbiAgICBwYXJhbSA9IGFyZ3NbMV07XG5cbiAgICB2YXIgaW5kZXggPSBub2Rlcy5pbmRleE9mKG5vZGUpO1xuICAgIGlmICh+aW5kZXgpIHtcbiAgICAgIHZhciBkID0gZGlmZihjYWNoZVtpbmRleF0sIHBhcmFtKTtcbiAgICAgIGlmICghZCkgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNhY2hlW2luZGV4XSA9IG1lcmdlKGNhY2hlW2luZGV4XSwgcGFyYW0pO1xuICAgICAgICByZXN1bHRzW2luZGV4XSA9IGZuKG5vZGUsIHBhcmFtLCBkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY2FjaGUucHVzaChwYXJhbSk7XG4gICAgICBub2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgaW5kZXggPSByZXN1bHRzLnB1c2goZm4obm9kZSwgcGFyYW0sIHBhcmFtKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdHNbaW5kZXhdO1xuICB9O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBtZXJnZShkZXN0LCBzcmMpIHtcbiAgZm9yICh2YXIga2V5IGluIHNyYykge1xuICAgIGRlc3Rba2V5XSA9IHNyY1trZXldO1xuICB9XG4gIHJldHVybiBkZXN0O1xufTtcbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBvcGVuO1xuXG5mdW5jdGlvbiBvcGVuKHVybCwgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybClcbiAgICAudGhlbihnZXRKc29uKVxuICAgIC50aGVuKGdldFRleHQpXG4gICAgLnRoZW4oY2IuYmluZChudWxsLCBudWxsKSlcbiAgICAuY2F0Y2goY2IpO1xufVxuXG5mdW5jdGlvbiBnZXRKc29uKHJlcykge1xuICByZXR1cm4gcmVzLmpzb24oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VGV4dChqc29uKSB7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoanNvbi50ZXh0KTtcbn1cbiIsInZhciBUT0tFTlMgPSAvLis/XFxifC5cXEJ8XFxiLis/L2c7XG52YXIgV09SRCA9IC9bLi9cXFxcXFwoXFwpXCInXFwtOiwuOzw+fiFAIyQlXiYqXFx8XFwrPVxcW1xcXXt9YH5cXD8gXSsvZztcblxudmFyIHBhcnNlID0gZXhwb3J0cztcblxucGFyc2Uud29yZHMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICB3aGlsZSAod29yZCA9IFdPUkQuZXhlYyhzKSkge1xuICAgIHdvcmRzLnB1c2god29yZCk7XG4gIH1cblxuICByZXR1cm4gd29yZHM7XG59O1xuXG5wYXJzZS50b2tlbnMgPSBmdW5jdGlvbihzKSB7XG4gIHZhciB3b3JkcyA9IFtdO1xuICB2YXIgd29yZDtcblxuICB3aGlsZSAod29yZCA9IFRPS0VOUy5leGVjKHMpKSB7XG4gICAgd29yZHMucHVzaCh3b3JkKTtcbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gUG9pbnQ7XG5cbmZ1bmN0aW9uIFBvaW50KHApIHtcbiAgaWYgKHApIHtcbiAgICB0aGlzLnggPSBwLng7XG4gICAgdGhpcy55ID0gcC55O1xuICB9IGVsc2Uge1xuICAgIHRoaXMueCA9IDA7XG4gICAgdGhpcy55ID0gMDtcbiAgfVxufVxuXG5Qb2ludC5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24ocCkge1xuICB0aGlzLnggPSBwLng7XG4gIHRoaXMueSA9IHAueTtcbn07XG5cblBvaW50LnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgUG9pbnQodGhpcyk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGUuYWRkUmlnaHQgPSBmdW5jdGlvbih4KSB7XG4gIHRoaXMueCArPSB4O1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIFRPRE86IG1ha2UgJ18vJyBmb3IgbW9yZSBleHBsaWNpdCBmbG9vcmluZ1xuUG9pbnQucHJvdG90eXBlWycvJ10gPVxuUG9pbnQucHJvdG90eXBlLmRpdiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC8gKHAueCB8fCBwLndpZHRoIHx8IDApIHwgMCxcbiAgICB5OiB0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApIHwgMFxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnby8nXSA9XG5Qb2ludC5wcm90b3R5cGUuZGl2ID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiBNYXRoLnJvdW5kKHRoaXMueCAvIChwLnggfHwgcC53aWR0aCB8fCAwKSksXG4gICAgeTogTWF0aC5yb3VuZCh0aGlzLnkgLyAocC55IHx8IHAuaGVpZ2h0IHx8IDApKVxuICB9KTtcbn07XG5cblBvaW50LnByb3RvdHlwZVsnKyddID1cblBvaW50LnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IHRoaXMueCArIChwLnggfHwgcC53aWR0aCB8fCAwKSxcbiAgICB5OiB0aGlzLnkgKyAocC55IHx8IHAuaGVpZ2h0IHx8IDApXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlWyctJ10gPVxuUG9pbnQucHJvdG90eXBlLnN1YiA9IGZ1bmN0aW9uKHApIHtcbiAgcmV0dXJuIG5ldyBQb2ludCh7XG4gICAgeDogdGhpcy54IC0gKHAueCB8fCBwLndpZHRoIHx8IDApLFxuICAgIHk6IHRoaXMueSAtIChwLnkgfHwgcC5oZWlnaHQgfHwgMClcbiAgfSk7XG59O1xuXG5Qb2ludC5wcm90b3R5cGVbJyonXSA9XG5Qb2ludC5wcm90b3R5cGUubXVsID0gZnVuY3Rpb24ocCkge1xuICByZXR1cm4gbmV3IFBvaW50KHtcbiAgICB4OiB0aGlzLnggKiAocC54IHx8IHAud2lkdGggfHwgMCkgfCAwLFxuICAgIHk6IHRoaXMueSAqIChwLnkgfHwgcC5oZWlnaHQgfHwgMCkgfCAwXG4gIH0pO1xufTtcblxuUG9pbnQucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAneDonICsgdGhpcy54ICsgJyx5OicgKyB0aGlzLnk7XG59O1xuXG5Qb2ludC5zb3J0ID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYS55ID09PSBiLnlcbiAgICA/IGEueCAtIGIueFxuICAgIDogYS55IC0gYi55O1xufTtcblxuUG9pbnQuZ3JpZFJvdW5kID0gZnVuY3Rpb24oYiwgYSkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgucm91bmQoYS54IC8gYi53aWR0aCksXG4gICAgeTogTWF0aC5yb3VuZChhLnkgLyBiLmhlaWdodClcbiAgfTtcbn07XG5cblBvaW50LmxvdyA9IGZ1bmN0aW9uKGxvdywgcCkge1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgubWF4KGxvdy54LCBwLngpLFxuICAgIHk6IE1hdGgubWF4KGxvdy55LCBwLnkpXG4gIH07XG59O1xuXG5Qb2ludC5jbGFtcCA9IGZ1bmN0aW9uKGFyZWEsIHApIHtcbiAgcmV0dXJuIHtcbiAgICB4OiBNYXRoLm1pbihhcmVhLmVuZC54LCBNYXRoLm1heChhcmVhLmJlZ2luLngsIHAueCkpLFxuICAgIHk6IE1hdGgubWluKGFyZWEuZW5kLnksIE1hdGgubWF4KGFyZWEuYmVnaW4ueSwgcC55KSlcbiAgfTtcbn07XG5cblBvaW50Lm9mZnNldCA9IGZ1bmN0aW9uKGIsIGEpIHtcbiAgcmV0dXJuIHsgeDogYS54ICsgYi54LCB5OiBhLnkgKyBiLnkgfTtcbn07XG5cblBvaW50Lm9mZnNldFggPSBmdW5jdGlvbih4LCBwKSB7XG4gIHJldHVybiB7IHg6IHAueCArIHgsIHk6IHAueSB9O1xufTtcblxuUG9pbnQub2Zmc2V0WSA9IGZ1bmN0aW9uKHksIHApIHtcbiAgcmV0dXJuIHsgeDogcC54LCB5OiBwLnkgKyB5IH07XG59O1xuXG5Qb2ludC50b0xlZnRUb3AgPSBmdW5jdGlvbihwKSB7XG4gIHJldHVybiB7XG4gICAgbGVmdDogcC54LFxuICAgIHRvcDogcC55XG4gIH07XG59O1xuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEFORDtcblxuZnVuY3Rpb24gQU5EKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmb3VuZCkge1xuICAgICAgaWYgKCFyYW5nZSkge1xuICAgICAgICByYW5nZSA9IFtpLGldO1xuICAgICAgICBvdXQucHVzaChyYW5nZSk7XG4gICAgICB9XG4gICAgICByYW5nZVsxXSA9IGk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IE5PVDtcblxuZnVuY3Rpb24gTk9UKGEsIGIpIHtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciByYW5nZSA9IG51bGw7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuXG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBiLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaSA+PSBiW2pdWzBdICYmIGkgPD0gYltqXVsxXSkge1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIGlmICghcmFuZ2UpIHtcbiAgICAgICAgcmFuZ2UgPSBbaSxpXTtcbiAgICAgICAgb3V0LnB1c2gocmFuZ2UpO1xuICAgICAgfVxuICAgICAgcmFuZ2VbMV0gPSBpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cbiIsIlxubW9kdWxlLmV4cG9ydHMgPSBYT09SO1xuXG5mdW5jdGlvbiBYT09SKGEsIGIpIHtcbiAgdmFyIHJhbmdlID0gbnVsbDtcbiAgdmFyIGZvdW5kID0gZmFsc2U7XG4gIHZhciBvdXQgPSBbXTtcblxuICBmb3IgKHZhciBpID0gYVswXTsgaSA8PSBhWzFdOyBpKyspIHtcbiAgICBmb3VuZCA9IGZhbHNlO1xuICAgIGZvciAodmFyIGsgPSAwOyBrIDwgYi5sZW5ndGg7IGsrKykge1xuICAgICAgaWYgKGkgPj0gYltrXVswXSAmJiBpIDw9IGJba11bMV0pIHtcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICByYW5nZSA9IG51bGw7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICBpZiAoIXJhbmdlKSB7XG4gICAgICAgIHJhbmdlID0gW2ksaV07XG4gICAgICAgIG91dC5wdXNoKHJhbmdlKTtcbiAgICAgIH1cbiAgICAgIHJhbmdlWzFdID0gaTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuIiwidmFyIE5PVCA9IHJlcXVpcmUoJ3JhbmdlLWdhdGUtbm90Jyk7XG52YXIgQU5EID0gcmVxdWlyZSgncmFuZ2UtZ2F0ZS1hbmQnKTtcbnZhciBYT09SID0gcmVxdWlyZSgncmFuZ2UtZ2F0ZS14b29yJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gUmFuZ2U7XG5cbmZ1bmN0aW9uIFJhbmdlKHIpIHtcbiAgaWYgKHIpIHtcbiAgICB0aGlzWzBdID0gclswXTtcbiAgICB0aGlzWzFdID0gclsxXTtcbiAgfSBlbHNlIHtcbiAgICB0aGlzWzBdID0gMDtcbiAgICB0aGlzWzFdID0gMTtcbiAgfVxufTtcblxuUmFuZ2UuTk9UID0gTk9UO1xuUmFuZ2UuQU5EID0gQU5EO1xuUmFuZ2UuWE9PUiA9IFhPT1I7XG5cblJhbmdlLnNvcnQgPSBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhLnkgPT09IGIueVxuICAgID8gYS54IC0gYi54XG4gICAgOiBhLnkgLSBiLnk7XG59O1xuXG5SYW5nZS5lcXVhbCA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gPT09IGJbMF0gJiYgYVsxXSA9PT0gYlsxXTtcbn07XG5cblJhbmdlLmNsYW1wID0gZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gbmV3IFJhbmdlKFtcbiAgICBNYXRoLm1pbihiWzFdLCBNYXRoLm1heChhWzBdLCBiWzBdKSksXG4gICAgTWF0aC5taW4oYVsxXSwgYlsxXSlcbiAgXSk7XG59O1xuXG5SYW5nZS5yYW5nZXMgPSBmdW5jdGlvbihpdGVtcykge1xuICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uKGl0ZW0pIHsgcmV0dXJuIGl0ZW0ucmFuZ2UgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUuaW5zaWRlID0gZnVuY3Rpb24oaXRlbXMpIHtcbiAgdmFyIHJhbmdlID0gdGhpcztcbiAgcmV0dXJuIGl0ZW1zLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ucmFuZ2VbMF0gPj0gcmFuZ2VbMF0gJiYgaXRlbS5yYW5nZVsxXSA8PSByYW5nZVsxXTtcbiAgfSk7XG59O1xuXG5SYW5nZS5wcm90b3R5cGUub3ZlcmxhcCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIHZhciByYW5nZSA9IHRoaXM7XG4gIHJldHVybiBpdGVtcy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLnJhbmdlWzBdIDw9IHJhbmdlWzBdICYmIGl0ZW0ucmFuZ2VbMV0gPj0gcmFuZ2VbMV07XG4gIH0pO1xufTtcblxuUmFuZ2UucHJvdG90eXBlLm91dHNpZGUgPSBmdW5jdGlvbihpdGVtcykge1xuICB2YXIgcmFuZ2UgPSB0aGlzO1xuICByZXR1cm4gaXRlbXMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5yYW5nZVsxXSA8IHJhbmdlWzBdIHx8IGl0ZW0ucmFuZ2VbMF0gPiByYW5nZVsxXTtcbiAgfSk7XG59O1xuIiwiXG52YXIgUmVnZXhwID0gZXhwb3J0cztcblxuUmVnZXhwLmNyZWF0ZSA9IGZ1bmN0aW9uKG5hbWVzLCBmbGFncywgZm4pIHtcbiAgZm4gPSBmbiB8fCBmdW5jdGlvbihzKSB7IHJldHVybiBzIH07XG4gIHJldHVybiBuZXcgUmVnRXhwKFxuICAgIG5hbWVzXG4gICAgLm1hcCgobikgPT4gJ3N0cmluZycgPT09IHR5cGVvZiBuID8gUmVnZXhwLnR5cGVzW25dIDogbilcbiAgICAubWFwKChyKSA9PiBmbihyLnRvU3RyaW5nKCkuc2xpY2UoMSwtMSkpKVxuICAgIC5qb2luKCd8JyksXG4gICAgZmxhZ3NcbiAgKTtcbn07XG5cblJlZ2V4cC50eXBlcyA9IHtcbiAgJ3Rva2Vucyc6IC8uKz9cXGJ8LlxcQnxcXGIuKz8vLFxuICAnd29yZHMnOiAvW2EtekEtWjAtOV17MSx9LyxcbiAgJ3BhcnRzJzogL1suL1xcXFxcXChcXClcIidcXC06LC47PD5+IUAjJCVeJipcXHxcXCs9XFxbXFxde31gflxcPyBdKy8sXG5cbiAgJ3NpbmdsZSBjb21tZW50JzogL1xcL1xcLy4qPyQvLFxuICAnZG91YmxlIGNvbW1lbnQnOiAvXFwvXFwqW15dKj9cXCpcXC8vLFxuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IC8oJyg/Oig/OlxcXFxcXG58XFxcXCd8W14nXFxuXSkpKj8nKS8sXG4gICdkb3VibGUgcXVvdGUgc3RyaW5nJzogLyhcIig/Oig/OlxcXFxcXG58XFxcXFwifFteXCJcXG5dKSkqP1wiKS8sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAvKGAoPzooPzpcXFxcYHxbXmBdKSkqP2ApLyxcblxuICAnb3BlcmF0b3InOiAvIXw+PT98PD0/fD17MSwzfXwoPzomKXsxLDJ9fFxcfD9cXHx8XFw/fFxcKnxcXC98fnxcXF58JXxcXC4oPyFcXGQpfFxcK3sxLDJ9fFxcLXsxLDJ9LyxcbiAgJ2Z1bmN0aW9uJzogLyAoKD8hXFxkfFsuIF0qPyhpZnxlbHNlfGRvfGZvcnxjYXNlfHRyeXxjYXRjaHx3aGlsZXx3aXRofHN3aXRjaCkpW2EtekEtWjAtOV8gJF0rKSg/PVxcKC4qXFwpLip7KS8sXG4gICdrZXl3b3JkJzogL1xcYihicmVha3xjYXNlfGNhdGNofGNvbnN0fGNvbnRpbnVlfGRlYnVnZ2VyfGRlZmF1bHR8ZGVsZXRlfGRvfGVsc2V8ZXhwb3J0fGV4dGVuZHN8ZmluYWxseXxmb3J8ZnJvbXxpZnxpbXBsZW1lbnRzfGltcG9ydHxpbnxpbnN0YW5jZW9mfGludGVyZmFjZXxsZXR8bmV3fHBhY2thZ2V8cHJpdmF0ZXxwcm90ZWN0ZWR8cHVibGljfHJldHVybnxzdGF0aWN8c3VwZXJ8c3dpdGNofHRocm93fHRyeXx0eXBlb2Z8d2hpbGV8d2l0aHx5aWVsZClcXGIvLFxuICAnZGVjbGFyZSc6IC9cXGIoZnVuY3Rpb258aW50ZXJmYWNlfGNsYXNzfHZhcnxsZXR8Y29uc3R8ZW51bXx2b2lkKVxcYi8sXG4gICdidWlsdGluJzogL1xcYihPYmplY3R8RnVuY3Rpb258Qm9vbGVhbnxFcnJvcnxFdmFsRXJyb3J8SW50ZXJuYWxFcnJvcnxSYW5nZUVycm9yfFJlZmVyZW5jZUVycm9yfFN0b3BJdGVyYXRpb258U3ludGF4RXJyb3J8VHlwZUVycm9yfFVSSUVycm9yfE51bWJlcnxNYXRofERhdGV8U3RyaW5nfFJlZ0V4cHxBcnJheXxGbG9hdDMyQXJyYXl8RmxvYXQ2NEFycmF5fEludDE2QXJyYXl8SW50MzJBcnJheXxJbnQ4QXJyYXl8VWludDE2QXJyYXl8VWludDMyQXJyYXl8VWludDhBcnJheXxVaW50OENsYW1wZWRBcnJheXxBcnJheUJ1ZmZlcnxEYXRhVmlld3xKU09OfEludGx8YXJndW1lbnRzfGNvbnNvbGV8d2luZG93fGRvY3VtZW50fFN5bWJvbHxTZXR8TWFwfFdlYWtTZXR8V2Vha01hcHxQcm94eXxSZWZsZWN0fFByb21pc2UpXFxiLyxcbiAgJ3NwZWNpYWwnOiAvXFxiKHRydWV8ZmFsc2V8bnVsbHx1bmRlZmluZWQpXFxiLyxcbiAgJ3BhcmFtcyc6IC9mdW5jdGlvblsgXFwoXXsxfVteXSo/XFx7LyxcbiAgJ251bWJlcic6IC8tP1xcYigweFtcXGRBLUZhLWZdK3xcXGQqXFwuP1xcZCsoW0VlXVsrLV0/XFxkKyk/fE5hTnwtP0luZmluaXR5KVxcYi8sXG4gICdzeW1ib2wnOiAvW3t9W1xcXSgpLDpdLyxcbiAgJ3JlZ2V4cCc6IC8oPyFbXlxcL10pKFxcLyg/IVtcXC98XFwqXSkuKj9bXlxcXFxcXF5dXFwvKShbO1xcblxcLlxcKVxcXVxcfSBnaW1dKS8sXG5cbiAgJ3htbCc6IC88W14+XSo+LyxcbiAgJ3VybCc6IC8oKFxcdys6XFwvXFwvKVstYS16QS1aMC05OkA7PyY9XFwvJVxcK1xcLlxcKiEnXFwoXFwpLFxcJF9cXHtcXH1cXF5+XFxbXFxdYCN8XSspLyxcbiAgJ2luZGVudCc6IC9eICsvLFxuICAnbGluZSc6IC9eLiskfF5cXG4vLFxufTtcblxuUmVnZXhwLnR5cGVzLmNvbW1lbnQgPSBSZWdleHAuY3JlYXRlKFtcbiAgJ3NpbmdsZSBjb21tZW50JyxcbiAgJ2RvdWJsZSBjb21tZW50Jyxcbl0pO1xuXG5SZWdleHAudHlwZXMuc3RyaW5nID0gUmVnZXhwLmNyZWF0ZShbXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJyxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnLFxuICAndGVtcGxhdGUgc3RyaW5nJyxcbl0pO1xuXG5SZWdleHAudHlwZXMubXVsdGlsaW5lID0gUmVnZXhwLmNyZWF0ZShbXG4gICdkb3VibGUgY29tbWVudCcsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnLFxuICAnaW5kZW50JyxcbiAgJ2xpbmUnXG5dKTtcblxuUmVnZXhwLnBhcnNlID0gZnVuY3Rpb24ocywgcmVnZXhwLCBmaWx0ZXIpIHtcbiAgdmFyIHdvcmRzID0gW107XG4gIHZhciB3b3JkO1xuXG4gIGlmIChmaWx0ZXIpIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICBpZiAoZmlsdGVyKHdvcmQpKSB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB3aGlsZSAod29yZCA9IHJlZ2V4cC5leGVjKHMpKSB7XG4gICAgICB3b3Jkcy5wdXNoKHdvcmQpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB3b3Jkcztcbn07XG4iLCJcbm1vZHVsZS5leHBvcnRzID0gc2F2ZTtcblxuZnVuY3Rpb24gc2F2ZSh1cmwsIHNyYywgY2IpIHtcbiAgcmV0dXJuIGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHRleHQ6IHNyYyB9KSxcbiAgICAgIGhlYWRlcnM6IG5ldyBIZWFkZXJzKHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgfSlcbiAgICB9KVxuICAgIC50aGVuKGNiLmJpbmQobnVsbCwgbnVsbCkpXG4gICAgLmNhdGNoKGNiKTtcbn1cbiIsIi8vIE5vdGU6IFlvdSBwcm9iYWJseSBkbyBub3Qgd2FudCB0byB1c2UgdGhpcyBpbiBwcm9kdWN0aW9uIGNvZGUsIGFzIFByb21pc2UgaXNcbi8vICAgbm90IHN1cHBvcnRlZCBieSBhbGwgYnJvd3NlcnMgeWV0LlxuXG4oZnVuY3Rpb24oKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICBpZiAod2luZG93LnNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHBlbmRpbmcgPSB7fSxcbiAgICAgICAgbmV4dEhhbmRsZSA9IDE7XG5cbiAgICBmdW5jdGlvbiBvblJlc29sdmUoaGFuZGxlKSB7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IHBlbmRpbmdbaGFuZGxlXTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICBkZWxldGUgcGVuZGluZ1toYW5kbGVdO1xuICAgICAgICAgICAgY2FsbGJhY2suZm4uYXBwbHkobnVsbCwgY2FsbGJhY2suYXJncyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3aW5kb3cuc2V0SW1tZWRpYXRlID0gZnVuY3Rpb24oZm4pIHtcbiAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICAgICAgaGFuZGxlO1xuXG4gICAgICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImludmFsaWQgZnVuY3Rpb25cIik7XG4gICAgICAgIH1cblxuICAgICAgICBoYW5kbGUgPSBuZXh0SGFuZGxlKys7XG4gICAgICAgIHBlbmRpbmdbaGFuZGxlXSA9IHsgZm46IGZuLCBhcmdzOiBhcmdzIH07XG5cbiAgICAgICAgbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICAgICAgcmVzb2x2ZShoYW5kbGUpO1xuICAgICAgICB9KS50aGVuKG9uUmVzb2x2ZSk7XG5cbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9O1xuXG4gICAgd2luZG93LmNsZWFySW1tZWRpYXRlID0gZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgIGRlbGV0ZSBwZW5kaW5nW2hhbmRsZV07XG4gICAgfTtcbn0oKSk7IiwiXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGZuLCBtcykge1xuICB2YXIgcnVubmluZywgdGltZW91dDtcblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYiwgYykge1xuICAgIGlmIChydW5uaW5nKSByZXR1cm47XG4gICAgcnVubmluZyA9IHRydWU7XG4gICAgZm4uY2FsbCh0aGlzLCBhLCBiLCBjKTtcbiAgICBzZXRUaW1lb3V0KHJlc2V0LCBtcyk7XG4gIH07XG5cbiAgZnVuY3Rpb24gcmVzZXQoKSB7XG4gICAgcnVubmluZyA9IGZhbHNlO1xuICB9XG59O1xuIiwiXG52YXIgdHJpbSA9IGV4cG9ydHM7XG5cbnRyaW0uZW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIHRyYWlsaW5nID0gdHJpbS50cmFpbGluZ0VtcHR5TGluZXMocyk7XG4gIHZhciBsZWFkaW5nID0gdHJpbS5sZWFkaW5nRW1wdHlMaW5lcyh0cmFpbGluZy5zdHJpbmcpO1xuICByZXR1cm4ge1xuICAgIHRyYWlsaW5nOiB0cmFpbGluZy5yZW1vdmVkLFxuICAgIGxlYWRpbmc6IGxlYWRpbmcucmVtb3ZlZCxcbiAgICByZW1vdmVkOiB0cmFpbGluZy5yZW1vdmVkICsgbGVhZGluZy5yZW1vdmVkLFxuICAgIHN0cmluZzogbGVhZGluZy5zdHJpbmdcbiAgfTtcbn07XG5cbnRyaW0udHJhaWxpbmdFbXB0eUxpbmVzID0gZnVuY3Rpb24ocykge1xuICB2YXIgaW5kZXggPSBzLmxlbmd0aDtcbiAgdmFyIGxhc3RJbmRleCA9IGluZGV4O1xuICB2YXIgbiA9IDA7XG4gIHdoaWxlIChcbiAgICB+KGluZGV4ID0gcy5sYXN0SW5kZXhPZignXFxuJywgbGFzdEluZGV4IC0gMSkpXG4gICAgJiYgaW5kZXggLSBsYXN0SW5kZXggPT09IC0xKSB7XG4gICAgbisrO1xuICAgIGxhc3RJbmRleCA9IGluZGV4O1xuICB9XG5cbiAgaWYgKG4pIHMgPSBzLnNsaWNlKDAsIGxhc3RJbmRleCk7XG5cbiAgcmV0dXJuIHtcbiAgICByZW1vdmVkOiBuLFxuICAgIHN0cmluZzogc1xuICB9O1xufTtcblxudHJpbS5sZWFkaW5nRW1wdHlMaW5lcyA9IGZ1bmN0aW9uKHMpIHtcbiAgdmFyIGluZGV4ID0gLTE7XG4gIHZhciBsYXN0SW5kZXggPSBpbmRleDtcbiAgdmFyIG4gPSAwO1xuXG4gIHdoaWxlIChcbiAgICB+KGluZGV4ID0gcy5pbmRleE9mKCdcXG4nLCBsYXN0SW5kZXggKyAxKSlcbiAgICAmJiBpbmRleCAtIGxhc3RJbmRleCA9PT0gMSkge1xuICAgIG4rKztcbiAgICBsYXN0SW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIGlmIChuKSBzID0gcy5zbGljZShsYXN0SW5kZXggKyAxKTtcblxuICByZXR1cm4ge1xuICAgIHJlbW92ZWQ6IG4sXG4gICAgc3RyaW5nOiBzXG4gIH07XG59O1xuIiwidmFyIGRlYm91bmNlID0gcmVxdWlyZSgnZGVib3VuY2UnKTtcbnZhciB0aHJvdHRsZSA9IHJlcXVpcmUoJ3Rocm90dGxlJyk7XG52YXIgYXRvbWljID0gcmVxdWlyZSgnYXRvbWljJyk7XG52YXIgcGFyc2UgPSByZXF1aXJlKCdwYXJzZScpO1xudmFyIEFyZWEgPSByZXF1aXJlKCdhcmVhJyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCdyYW5nZScpO1xudmFyIFJlZ2V4cCA9IHJlcXVpcmUoJ3JlZ2V4cCcpO1xudmFyIEV2ZW50ID0gcmVxdWlyZSgnZXZlbnQnKTtcbnZhciBMaW5lcyA9IHJlcXVpcmUoJy4vbGluZXMnKTtcbnZhciBTeW50YXggPSByZXF1aXJlKCcuL3N5bnRheCcpO1xudmFyIFNlZ21lbnRzID0gcmVxdWlyZSgnLi9zZWdtZW50cycpO1xudmFyIFNraXBTdHJpbmcgPSByZXF1aXJlKCcuL3NraXBzdHJpbmcnKTtcbnZhciBQcmVmaXhUcmVlID0gcmVxdWlyZSgnLi9wcmVmaXh0cmVlJyk7XG52YXIgSW5kZXhlciA9IHJlcXVpcmUoJy4vaW5kZXhlcicpO1xuXG5leHBvcnRzID0gbW9kdWxlLmV4cG9ydHMgPSBCdWZmZXI7XG5cbnZhciBFT0wgPSBleHBvcnRzLkVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE4gPSBleHBvcnRzLk4gPSAvXFxuL2c7XG52YXIgQ0hVTktfU0laRSA9IGV4cG9ydHMuQ0hVTktfU0laRSA9IDUwMDA7XG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsndG9rZW5zJ10sICdnJyk7XG5cbmZ1bmN0aW9uIEJ1ZmZlcigpIHtcbiAgdGhpcy5zeW50YXggPSBuZXcgU3ludGF4O1xuICB0aGlzLmluZGV4ZXIgPSBuZXcgSW5kZXhlcih0aGlzKTtcbiAgdGhpcy5zZWdtZW50cyA9IG5ldyBTZWdtZW50cyh0aGlzKTtcbiAgdGhpcy5vbigndXBkYXRlJywgZGVib3VuY2UodGhpcy51cGRhdGVSYXcuYmluZCh0aGlzKSwgMzAwKSk7XG4gIHRoaXMub24oJ3JhdycsIHRoaXMuc2VnbWVudHMuaW5kZXguYmluZCh0aGlzLnNlZ21lbnRzKSk7XG4gIHRoaXMuc2V0KCcnKTtcbn1cblxuQnVmZmVyLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxvYygpIHtcbiAgICByZXR1cm4gdGhpcy5saW5lcy5sZW5ndGg7XG4gIH1cbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmICghcmFuZ2UpIHJldHVybiB0aGlzLnRleHQuZ2V0UmFuZ2UoKTtcbiAgdmFyIG9mZnNldHMgPSB0aGlzLmxpbmVzLmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2Uob2Zmc2V0cyk7XG4gIHJldHVybiB0ZXh0O1xufTtcblxudmFyIEJMT0NLID0ge1xuICAnY29tbWVudCc6ICcvKicsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG52YXIgQkxPQ0tfRU5EID0ge1xuICAnY29tbWVudCc6ICcqLycsXG4gICdzdHJpbmcnOiAnYCcsXG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldEhpZ2hsaWdodGVkID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGNvZGUgPSB0aGlzLmdldChyYW5nZSk7XG4gIC8vIHJldHVybiB0aGlzLnN5bnRheC5lbnRpdGllcyhjb2RlKTtcblxuICB2YXIgYmxvY2sgPSB0aGlzLnNlZ21lbnRzLmdldChyYW5nZVswXSk7XG4gIC8vIGNvbnNvbGUudGltZUVuZCgnZ2V0IHNlZ21lbnQnKVxuICBpZiAoYmxvY2spIHtcbiAgICBjb2RlID0gQkxPQ0tbYmxvY2tdICsgJ1xcdWZmYmEnICsgY29kZSArICdcXHVmZmJlJyArIEJMT0NLX0VORFtibG9ja107XG4gICAgY29kZSA9IHRoaXMuc3ludGF4LmhpZ2hsaWdodChjb2RlKTtcbiAgICBjb2RlID0gJzwnICsgYmxvY2sgKyAnPicgK1xuICAgICAgY29kZS5zdWJzdHJpbmcoXG4gICAgICAgIGNvZGUuaW5kZXhPZignXFx1ZmZiYScpICsgMSxcbiAgICAgICAgY29kZS5sYXN0SW5kZXhPZignXFx1ZmZiZScpXG4gICAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvZGUgPSB0aGlzLnN5bnRheC5oaWdobGlnaHQoY29kZSArICdcXHVmZmJlKi9gJyk7XG4gICAgY29kZSA9IGNvZGUuc3Vic3RyaW5nKFxuICAgICAgMCxcbiAgICAgIGNvZGUubGFzdEluZGV4T2YoJ1xcdWZmYmUnKVxuICAgICk7XG4gIH1cbiAgcmV0dXJuIGNvZGU7XG59O1xuXG4vL1RPRE86IHRoaXMgZGVmZWF0cyB0aGUgcHVycG9zZSBvZiBoYXZpbmcgYSBza2lwbGlzdFxuLy8gbmVlZCB0byBnZXQgcmlkIG9mIGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUudXBkYXRlUmF3ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmF3ID0gdGhpcy5nZXQoKTtcbiAgdGhpcy5lbWl0KCdyYXcnLCB0aGlzLnJhdyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmdldE9mZnNldExpbmUgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5saW5lcy5nZXRPZmZzZXQob2Zmc2V0KTtcbiAgdmFyIHRleHQgPSB0aGlzLnRleHQuZ2V0UmFuZ2UocG9pbnQubGluZS5yYW5nZSk7XG4gIHJldHVybiB7XG4gICAgcG9pbnQ6IHBvaW50LFxuICAgIHRleHQ6IHRleHRcbiAgfTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZ2V0TGluZSA9IGZ1bmN0aW9uKHkpIHtcbiAgcmV0dXJuIHRoaXMuZ2V0KFt5LHldKTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmNoYW5nZXMgPSAwO1xuXG4gIHRoaXMucmF3ID0gdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcbiAgdGhpcy5lbWl0KCdyYXcnLCB0aGlzLnJhdyk7XG5cbiAgdGhpcy50ZXh0ID0gbmV3IFNraXBTdHJpbmcoeyBjaHVua1NpemU6IENIVU5LX1NJWkUgfSk7XG4gIHRoaXMudGV4dC5zZXQodGV4dCk7XG5cbiAgdGhpcy5wcmVmaXggPSBuZXcgUHJlZml4VHJlZTtcbiAgdGhpcy5wcmVmaXguaW5kZXgodGhpcy5yYXcpO1xuXG4gIHRoaXMubGluZXMgPSBuZXcgTGluZXM7XG4gIHRoaXMubGluZXMuaW5zZXJ0KHsgeDowLCB5OjAgfSwgdGhpcy5yYXcpO1xuXG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHBvaW50LCB0ZXh0LCBzaGlmdCwgaXNDdHJsU2hpZnQpIHtcbiAgdmFyIGlzRU9MLCBsaW5lcywgcmFuZ2UsIGJlZm9yZSwgYWZ0ZXI7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgaWYgKCFpc0N0cmxTaGlmdCkgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgdGV4dCA9IG5vcm1hbGl6ZUVPTCh0ZXh0KTtcblxuICBpc0VPTCA9ICdcXG4nID09PSB0ZXh0O1xuXG4gIHBvaW50ID0gdGhpcy5saW5lcy5nZXRQb2ludChwb2ludCk7XG4gIGxpbmVzID0gdGhpcy5saW5lcy5pbnNlcnQocG9pbnQsIHRleHQpO1xuICByYW5nZSA9IFtwb2ludC55LCBwb2ludC55ICsgbGluZXNdO1xuXG4gIHNoaWZ0ID0gIWlzQ3RybFNoaWZ0ICYmIChzaGlmdCB8fCBpc0VPTCk7XG5cbiAgYmVmb3JlID0gdGhpcy5nZXQocmFuZ2UpO1xuXG4gIHRoaXMudGV4dC5pbnNlcnQocG9pbnQub2Zmc2V0LCB0ZXh0KTtcblxuICBhZnRlciA9IHRoaXMuZ2V0KHJhbmdlKTtcblxuICB0aGlzLnByZWZpeC5pbmRleChhZnRlcik7XG4gIGlmIChpc0N0cmxTaGlmdCkgcmFuZ2UgPSBbTWF0aC5tYXgoMCwgcmFuZ2VbMF0tMSksIHJhbmdlWzFdXTtcblxuICAvL1RPRE86IGkgdGhpbmsgc2hpZnQgc2hvdWxkIGJlICdsaW5lcydcbiAgdGhpcy5lbWl0KCd1cGRhdGUnLCByYW5nZSwgc2hpZnQsIGJlZm9yZSwgYWZ0ZXIpO1xuXG4gIC8vIHRoaXMgaXMgdG8gdXBkYXRlIGNhcmV0IHBvc2l0aW9uXG4gIHJldHVybiB0ZXh0Lmxlbmd0aDtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQ2hhckF0ID0gZnVuY3Rpb24ocG9pbnQpIHtcbiAgdmFyIGlzRU9MLCByYW5nZSwgYmVmb3JlLCBhZnRlcjtcblxuICB0aGlzLmNoYW5nZXMrKztcblxuICB0aGlzLmVtaXQoJ2JlZm9yZSB1cGRhdGUnKTtcblxuICBwb2ludCA9IHRoaXMubGluZXMuZ2V0UG9pbnQocG9pbnQpO1xuICBpc0VPTCA9IHRoaXMubGluZXMucmVtb3ZlQ2hhckF0KHBvaW50KTtcbiAgcmFuZ2UgPSBbcG9pbnQueSwgcG9pbnQueSArIGlzRU9MXTtcblxuICBiZWZvcmUgPSB0aGlzLmdldChyYW5nZSk7XG5cbiAgdGhpcy50ZXh0LnJlbW92ZUNoYXJBdChwb2ludC5vZmZzZXQpO1xuXG4gIGFmdGVyID0gdGhpcy5nZXQocmFuZ2UpO1xuXG4gIHRoaXMucHJlZml4LmluZGV4KGFmdGVyKTtcblxuICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlLCAtaXNFT0wsIGJlZm9yZSk7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLndvcmRBdCA9IGZ1bmN0aW9uKHBvaW50LCBpbmNsdXNpdmUpIHtcbiAgaW5jbHVzaXZlID0gaW5jbHVzaXZlIHx8IDA7XG5cbiAgcG9pbnQgPSB0aGlzLmxpbmVzLmdldFBvaW50KHBvaW50KTtcblxuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShwb2ludC5saW5lLnJhbmdlKTtcblxuICB2YXIgd29yZHMgPSBSZWdleHAucGFyc2UodGV4dCwgV09SRFMpO1xuXG4gIGlmICh3b3Jkcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbmV3IEFyZWEoe1xuICAgICAgYmVnaW46IHsgeDogMCwgeTogcG9pbnQueSB9LFxuICAgICAgZW5kOiB7IHg6IHBvaW50LmxpbmUubGVuZ3RoLCB5OiBwb2ludC55IH0sXG4gICAgfSk7XG4gIH1cblxuICB2YXIgbGFzdEluZGV4ID0gMDtcbiAgdmFyIHdvcmQgPSBbXTtcbiAgdmFyIGVuZCA9IHRleHQubGVuZ3RoO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKHdvcmQuaW5kZXggPiBwb2ludC54IC0gaW5jbHVzaXZlKSB7XG4gICAgICBlbmQgPSB3b3JkLmluZGV4O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGxhc3RJbmRleCA9IHdvcmQuaW5kZXg7XG4gIH1cblxuICByZXR1cm4gbmV3IEFyZWEoe1xuICAgIGJlZ2luOiB7IHg6IGxhc3RJbmRleCwgeTogcG9pbnQueSB9LFxuICAgIGVuZDogeyB4OiBlbmQsIHk6IHBvaW50LnkgfVxuICB9KTtcbn07XG5cbkJ1ZmZlci5wcm90b3R5cGUuZGVsZXRlQXJlYSA9IGZ1bmN0aW9uKGFyZWEsIG5vVXBkYXRlKSB7XG4gIHZhciByYW5nZSwgb2Zmc2V0cywgbGluZXM7XG5cbiAgdGhpcy5jaGFuZ2VzKys7XG5cbiAgdGhpcy5lbWl0KCdiZWZvcmUgdXBkYXRlJyk7XG5cbiAgb2Zmc2V0cyA9IHRoaXMubGluZXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICBsaW5lcyA9IHRoaXMubGluZXMucmVtb3ZlQXJlYShhcmVhKTtcbiAgcmFuZ2UgPSBbYXJlYS5iZWdpbi55LCBhcmVhLmVuZC55XTtcblxuICB0aGlzLnRleHQucmVtb3ZlKG9mZnNldHMpO1xuXG4gIGlmICghbm9VcGRhdGUpIHtcbiAgICB0aGlzLmVtaXQoJ3VwZGF0ZScsIHJhbmdlKTtcbiAgfVxufTtcblxuQnVmZmVyLnByb3RvdHlwZS5nZXRBcmVhID0gZnVuY3Rpb24oYXJlYSkge1xuICB2YXIgb2Zmc2V0cyA9IHRoaXMubGluZXMuZ2V0QXJlYU9mZnNldFJhbmdlKGFyZWEpO1xuICB2YXIgdGV4dCA9IHRoaXMudGV4dC5nZXRSYW5nZShvZmZzZXRzKTtcbiAgcmV0dXJuIHRleHQ7XG59O1xuXG5CdWZmZXIucHJvdG90eXBlLm1vdmVBcmVhQnlMaW5lcyA9IGZ1bmN0aW9uKHksIGFyZWEpIHtcbiAgaWYgKGFyZWEuZW5kLnggPiAwIHx8IGFyZWEuYmVnaW4ueSA9PT0gYXJlYS5lbmQueSkgYXJlYS5lbmQueSArPSAxO1xuICBpZiAoYXJlYS5iZWdpbi55ICsgeSA8IDAgfHwgYXJlYS5lbmQueSArIHkgPiB0aGlzLmxvYykgcmV0dXJuIGZhbHNlO1xuXG4gIGFyZWEuYmVnaW4ueCA9IDA7XG4gIGFyZWEuZW5kLnggPSAwO1xuXG4gIHZhciB0ZXh0ID0gdGhpcy5nZXQoW2FyZWEuYmVnaW4ueSwgYXJlYS5lbmQueS0xXSk7XG4gIHRoaXMuZGVsZXRlQXJlYShhcmVhLCB0cnVlKTtcblxuICB0aGlzLmluc2VydCh7IHg6MCwgeTphcmVhLmJlZ2luLnkgKyB5IH0sIHRleHQsIHksIHRydWUpO1xuXG4gIHJldHVybiB0cnVlO1xufTtcblxuZnVuY3Rpb24gbm9ybWFsaXplRU9MKHMpIHtcbiAgcmV0dXJuIHMucmVwbGFjZShleHBvcnRzLkVPTCwgJ1xcbicpO1xufVxuIiwiXG5tb2R1bGUuZXhwb3J0cyA9IEluZGV4ZXI7XG5cbmZ1bmN0aW9uIEluZGV4ZXIoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xufVxuXG5JbmRleGVyLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24ocykge1xuICBpZiAoIXMpIHJldHVybiBbXTtcbiAgdmFyIG9mZnNldHMgPSBbXTtcbiAgdmFyIHRleHQgPSB0aGlzLmJ1ZmZlci5yYXc7XG4gIHZhciBsZW4gPSBzLmxlbmd0aDtcbiAgdmFyIGluZGV4O1xuICB3aGlsZSAofihpbmRleCA9IHRleHQuaW5kZXhPZihzLCBpbmRleCArIGxlbikpKSB7XG4gICAgb2Zmc2V0cy5wdXNoKGluZGV4KTtcbiAgfVxuICByZXR1cm4gb2Zmc2V0cztcbn07XG4iLCJcbi8qXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfID0gY2FyZXRcbiAqXG4gKiAgIDAgICAxICAgMiAgIDMgICA0ICAgIDUgICAwICAgMSAgIDIgICAzICAgNCAgICA1ICAgMCAgIDEgICAyXG4gKiB8IGggfCBlIHwgbCB8IGwgfCBvIHwgXFxuIHwgdyB8IG8gfCByIHwgbCB8IGQgfCBcXG4gfCAhIHwgISB8IF8gfFxuICogMCAgIDEgICAyICAgMyAgIDQgICA1ICAgIDYgICA3ICAgOCAgIDkgICAxMCAgMTEgICAxMiAgMTMgIDE0ICAxNVxuICpcbiAqIGdldCgwKSAtPiAwXG4gKiBnZXQoMSkgLT4gNlxuICogZ2V0KDIpIC0+IDEyXG4gKiBnZXQoMykgLT4gdGhyb3dzXG4gKlxuICogbGVmdCBpbmNsdXNpdmUsIHJpZ2h0IGV4Y2x1c2l2ZTpcbiAqXG4gKiBnZXRMaW5lKHgpLm9mZnNldCA9PT0gZ2V0KHgpXG4gKiBnZXRMaW5lKDApLnJhbmdlIC0+IDAtNlxuICogZ2V0TGluZSgxKS5yYW5nZSAtPiA2LTEyXG4gKiBnZXRMaW5lKDIpLnJhbmdlIC0+IDEyLTEzXG4gKiBnZXRMaW5lKDMpIC0+IHRocm93c1xuICpcbiAqIGdldFJhbmdlKFswLDBdKSAtPiAwLTZcbiAqIGdldFJhbmdlKFswLDFdKSAtPiAwLTEyXG4gKiBnZXRSYW5nZShbMSwxXSkgLT4gNi0xMlxuICogZ2V0UmFuZ2UoWzEsMl0pIC0+IDYtMTNcbiAqIGdldFJhbmdlKFsyLDJdKSAtPiAxMi0xM1xuICogZ2V0UmFuZ2UoWzIsM10pIC0+IHRocm93c1xuICogZ2V0UmFuZ2UoWzAsM10pIC0+IHRocm93c1xuICpcbiAqIGdldFBvaW50KHsgeDp4LCB5OnkgfSkubGluZSA9PT0gZ2V0TGluZSh5KVxuICogZ2V0UG9pbnQoeyB4OjAsIHk6MCB9KS5vZmZzZXQgLT4gMFxuICogZ2V0UG9pbnQoeyB4OjAsIHk6MCB9KS5wb2ludCAtPiB7IHg6MCwgeTowIH1cbiAqIGdldFBvaW50KHsgeDoyLCB5OjAgfSkub2Zmc2V0IC0+IDJcbiAqIGdldFBvaW50KHsgeDoxMCwgeTowIH0pLm9mZnNldCAtPiA1XG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MCB9KS5wb2ludCAtPiB7IHg6NSwgeTowIH1cbiAqIGdldFBvaW50KHsgeDowLCB5OjEgfSkub2Zmc2V0IC0+IDZcbiAqIGdldFBvaW50KHsgeDoyLCB5OjEgfSkub2Zmc2V0IC0+IDhcbiAqIGdldFBvaW50KHsgeDoxMCwgeToxIH0pLm9mZnNldCAtPiAxMVxuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjEgfSkucG9pbnQgLT4geyB4OjUsIHk6MSB9XG4gKiBnZXRQb2ludCh7IHg6MCwgeToyIH0pLm9mZnNldCAtPiAxMlxuICogZ2V0UG9pbnQoeyB4OjEwLCB5OjIgfSkub2Zmc2V0IC0+IDEzXG4gKiBnZXRQb2ludCh7IHg6MTAsIHk6MiB9KS5wb2ludCAtPiB7IHg6MSwgeToyIH1cbiAqIGdldFJhbmdlKHsgeDoxMDAsIHk6MTAwIH0pLm9mZnNldCAtPiAxM1xuICogZ2V0UmFuZ2UoeyB4OjEwMCwgeToxMDAgfSkucG9pbnQgLT4geyB4OjEsIHk6IDIgfVxuICpcbiAqIGdldExpbmVMZW5ndGgoMCkgLT4gNlxuICogZ2V0TGluZUxlbmd0aCgxKSAtPiA2XG4gKiBnZXRMaW5lTGVuZ3RoKDIpIC0+IDJcbiAqIGdldExpbmVMZW5ndGgoMykgLT4gdGhyb3dzXG4gKi9cblxudmFyIEVPTCA9IC9cXHJcXG58XFxyfFxcbi9nO1xudmFyIE4gPSAvXFxuL2c7XG5cbm1vZHVsZS5leHBvcnRzID0gTGluZXM7XG5cbmZ1bmN0aW9uIExpbmVzKCkge1xuICB0aGlzLmluZGV4ID0gW107XG4gIHRoaXMudGFpbCA9ICcnO1xuICB0aGlzLmxlbmd0aCA9IDA7XG59XG5cbkxpbmVzLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbih5KSB7XG4gIGlmICh5ID4gdGhpcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gdGhpcy5pbmRleFt0aGlzLmxlbmd0aCAtIDFdICsgdGhpcy50YWlsLmxlbmd0aDtcbiAgfVxuICB2YXIgbGluZSA9IHRoaXMuaW5kZXhbeSAtIDFdIHx8IDA7XG5cbiAgcmV0dXJuIHkgPiAwID8gbGluZSArIDEgOiAwO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldChyYW5nZVswXSk7XG4gIHZhciBiO1xuXG4gIGlmIChyYW5nZVsxXSArIDEgPj0gdGhpcy5sZW5ndGggKyAxKSB7XG4gICAgYiA9IHRoaXMuZ2V0KHJhbmdlWzFdKSArIHRoaXMudGFpbC5sZW5ndGg7XG4gIH0gZWxzZSB7XG4gICAgYiA9IHRoaXMuZ2V0KHJhbmdlWzFdICsgMSk7XG4gIH1cblxuICByZXR1cm4gW2EsIGJdO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldERpc3RhbmNlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgdmFyIGEgPSB0aGlzLmdldChyYW5nZVswXSk7XG4gIHZhciBiO1xuXG4gIGlmIChyYW5nZVsxXSA9PT0gdGhpcy5sZW5ndGggKyAxKSB7XG4gICAgYiA9IHRoaXMuZ2V0KHJhbmdlWzFdIC0gMSkgKyB0aGlzLnRhaWwubGVuZ3RoO1xuICB9IGVsc2Uge1xuICAgIGIgPSB0aGlzLmdldChyYW5nZVsxXSkgLSAxO1xuICB9XG5cbiAgcmV0dXJuIGIgLSBhO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldExpbmVMZW5ndGggPSBmdW5jdGlvbih5KSB7XG4gIHJldHVybiB0aGlzLmdldERpc3RhbmNlKFt5LCB5KzFdKTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRMb25nZXN0TGluZUxlbmd0aCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgbG9uZ2VzdCA9IDA7XG4gIHZhciBkID0gMDtcbiAgdmFyIHAgPSB0aGlzLmluZGV4W3RoaXMubGVuZ3RoIC0gMV07XG4gIHZhciBpID0gdGhpcy5sZW5ndGg7XG4gIHdoaWxlIChpLS0gPiAwKSB7XG4gICAgZCA9IHRoaXMuaW5kZXhbaV0gLSB0aGlzLmluZGV4W2kgLSAxXTtcbiAgICBsb25nZXN0ID0gZCA+IGxvbmdlc3QgPyBkIDogbG9uZ2VzdDtcbiAgfVxuICByZXR1cm4gbG9uZ2VzdDtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRMaW5lID0gZnVuY3Rpb24oeSkge1xuICB2YXIgb2Zmc2V0ID0gdGhpcy5nZXQoeSk7XG4gIHZhciBwb2ludCA9IHsgeDogMCwgeTogeSB9O1xuICB2YXIgbGVuZ3RoID0gdGhpcy5nZXRMaW5lTGVuZ3RoKHBvaW50LnkpO1xuICB2YXIgcmFuZ2UgPSBbb2Zmc2V0LCBvZmZzZXQgKyBsZW5ndGhdO1xuXG4gIHJldHVybiB7XG4gICAgb2Zmc2V0OiBvZmZzZXQsXG4gICAgcG9pbnQ6IHBvaW50LFxuICAgIHJhbmdlOiByYW5nZSxcbiAgICBsZW5ndGg6IGxlbmd0aCxcbiAgfTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5nZXRQb2ludCA9IGZ1bmN0aW9uKHBvaW50KSB7XG4gIHZhciBsaW5lID0gdGhpcy5nZXRMaW5lKHBvaW50LnkpO1xuXG4gIHZhciBwb2ludCA9IHtcbiAgICB4OiBNYXRoLm1pbihwb2ludC54LCBsaW5lLmxlbmd0aCksXG4gICAgeTogbGluZS5wb2ludC55XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBvZmZzZXQ6IGxpbmUub2Zmc2V0ICsgcG9pbnQueCxcbiAgICBwb2ludDogcG9pbnQsXG4gICAgeDogcG9pbnQueCxcbiAgICB5OiBwb2ludC55LFxuICAgIGxpbmU6IGxpbmUsXG4gIH07XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBiZWdpbiA9IDA7XG4gIHZhciBlbmQgPSB0aGlzLmxlbmd0aDtcbiAgaWYgKCFlbmQpIHJldHVybjtcblxuICB2YXIgcCA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHRoaXMuZ2V0KGkpIDw9IG9mZnNldCkgYmVnaW4gPSBpO1xuICAgIGVsc2UgZW5kID0gaTtcbiAgfSB3aGlsZSAocCAhPT0gaSk7XG5cbiAgdmFyIGxpbmUgPSB0aGlzLmdldExpbmUoaSk7XG4gIHZhciB4ID0gb2Zmc2V0IC0gbGluZS5vZmZzZXQ7XG4gIGlmICggeCA+IGxpbmUubGVuZ3RoXG4gICAgJiYgaSA9PT0gdGhpcy5sZW5ndGggLSAxKSB7XG4gICAgeCAtPSBsaW5lLmxlbmd0aCArIDE7XG4gICAgaSArPSAxO1xuICAgIGlmICh4ID4gdGhpcy50YWlsLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IGksXG4gICAgbGluZTogbGluZVxuICB9O1xufTtcblxuTGluZXMucHJvdG90eXBlLmluc2VydCA9IGZ1bmN0aW9uKHAsIHRleHQpIHtcbiAgdmFyIHBvaW50ID0gdGhpcy5nZXRQb2ludChwKTtcbiAgdmFyIHggPSBwb2ludC54O1xuICB2YXIgeSA9IHBvaW50Lnk7XG4gIHZhciBvZmZzZXQgPSBwb2ludC5vZmZzZXQ7XG5cbiAgaWYgKHkgPT09IHRoaXMubGVuZ3RoKSB7XG4gICAgdGV4dCA9IHRoaXMudGFpbC5zdWJzdHIoMCx4KSArIHRleHQgKyB0aGlzLnRhaWwuc3Vic3RyKHgpO1xuICAgIHRoaXMudGFpbCA9ICcnO1xuICAgIG9mZnNldCAtPSB4O1xuICB9XG5cbiAgdmFyIG1hdGNoZXMgPSBbeSwgMF07XG4gIHZhciBtYXRjaCA9IC0xO1xuICB2YXIgc2hpZnQgPSAwO1xuICB2YXIgbGFzdCA9IC0xO1xuXG4gIHdoaWxlICh+KG1hdGNoID0gdGV4dC5pbmRleE9mKCdcXG4nLCBtYXRjaCArIDEpKSkge1xuICAgIG1hdGNoZXMucHVzaChtYXRjaCArIG9mZnNldCk7XG4gICAgbGFzdCA9IG1hdGNoO1xuICB9XG5cbiAgc2hpZnQgKz0gbGFzdCArIDE7XG5cbiAgdmFyIHRhaWwgPSB0ZXh0LnNsaWNlKGxhc3QgKyAxKTtcbiAgaWYgKHkgPT09IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhpcy50YWlsICs9IHRhaWw7XG4gIH1cblxuICBpZiAoeSA8IHRoaXMubGVuZ3RoKSB7XG4gICAgc2hpZnQgKz0gdGFpbC5sZW5ndGg7XG4gICAgdGhpcy5zaGlmdCh5LCBzaGlmdCk7XG4gIH1cblxuICBpZiAobWF0Y2hlcy5sZW5ndGggPCAzKSByZXR1cm4gMDtcblxuICB0aGlzLmluZGV4LnNwbGljZS5hcHBseSh0aGlzLmluZGV4LCBtYXRjaGVzKTtcblxuICB2YXIgbGluZXMgPSB0aGlzLmluZGV4Lmxlbmd0aCAtIHRoaXMubGVuZ3RoO1xuXG4gIHRoaXMubGVuZ3RoID0gdGhpcy5pbmRleC5sZW5ndGg7XG5cbiAgcmV0dXJuIGxpbmVzO1xufTtcblxuTGluZXMucHJvdG90eXBlLmluc2VydExpbmUgPSBmdW5jdGlvbih5LCB0ZXh0KSB7XG4gIHRoaXMuaW5zZXJ0KHsgeDowLCB5OnkgfSwgdGV4dCk7XG59O1xuXG5MaW5lcy5wcm90b3R5cGUuZ2V0QXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgcmV0dXJuIHRoaXMuZ2V0UmFuZ2UoW1xuICAgIGFyZWEuYmVnaW4ueSxcbiAgICBhcmVhLmVuZC55XG4gIF0pO1xufTtcblxuTGluZXMucHJvdG90eXBlLmdldEFyZWFPZmZzZXRSYW5nZSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgcmV0dXJuIFtcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuYmVnaW4pLm9mZnNldCxcbiAgICB0aGlzLmdldFBvaW50KGFyZWEuZW5kKS5vZmZzZXRcbiAgXTtcbn07XG5cbkxpbmVzLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihwKSB7XG4gIHZhciBhID0gdGhpcy5nZXRQb2ludChwKTtcbiAgaWYgKGEucG9pbnQueSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICB0aGlzLnRhaWwgPSB0aGlzLnRhaWwuc2xpY2UoMCwgLTEpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSBlbHNlIHtcbiAgICB2YXIgaXNFbmRPZkxpbmUgPSBhLmxpbmUubGVuZ3RoID09PSBhLnBvaW50Lng7XG4gICAgaWYgKGlzRW5kT2ZMaW5lKSB7XG4gICAgICB0aGlzLmluZGV4LnNwbGljZShhLnBvaW50LnksIDEpO1xuICAgICAgdGhpcy5sZW5ndGggPSB0aGlzLmluZGV4Lmxlbmd0aDtcbiAgICAgIGlmIChhLnBvaW50LnkgPT09IHRoaXMubGVuZ3RoKSB7XG4gICAgICAgIHRoaXMudGFpbCArPSBuZXcgQXJyYXkoYS5saW5lLmxlbmd0aCsxKS5qb2luKCcqJyk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuc2hpZnQoYS5wb2ludC55LCAtMSk7XG4gICAgcmV0dXJuIGlzRW5kT2ZMaW5lO1xuICB9XG59O1xuXG5MaW5lcy5wcm90b3R5cGUucmVtb3ZlQXJlYSA9IGZ1bmN0aW9uKGFyZWEpIHtcbiAgdmFyIGJlZ2luID0gdGhpcy5nZXRQb2ludChhcmVhLmJlZ2luKTtcbiAgdmFyIGVuZCA9IHRoaXMuZ2V0UG9pbnQoYXJlYS5lbmQpO1xuXG4gIHZhciB4ID0gMDtcblxuICB2YXIgZGlzdCA9IGVuZC55IC0gYmVnaW4ueTtcbiAgdmFyIHNhbWVMaW5lID0gYmVnaW4ueSA9PT0gZW5kLnk7XG4gIGlmIChzYW1lTGluZSkgeCA9IGVuZC54IC0gYmVnaW4ueDtcbiAgZWxzZSB7XG4gICAgdGhpcy5pbmRleC5zcGxpY2UoYmVnaW4ueSwgZGlzdCk7XG4gIH1cblxuICBpZiAoIXNhbWVMaW5lKSB7XG4gICAgaWYgKGFyZWEuYmVnaW4ueSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICAgIHRoaXMudGFpbCA9IHRoaXMudGFpbC5zbGljZSgwLCAteCk7XG4gICAgfVxuICAgIGlmIChhcmVhLmVuZC55ID09PSB0aGlzLmxlbmd0aCkge1xuICAgICAgdGhpcy50YWlsID0gdGhpcy50YWlsLnNsaWNlKGVuZC54KTtcbiAgICAgIHRoaXMudGFpbCArPSBuZXcgQXJyYXkoYmVnaW4ueCArIDEpLmpvaW4oJyonKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgaWYgKGFyZWEuYmVnaW4ueSA9PT0gdGhpcy5sZW5ndGgpIHtcbiAgICAgIHRoaXMudGFpbCA9IHRoaXMudGFpbC5zbGljZSgwLCBiZWdpbi54KSArIHRoaXMudGFpbC5zbGljZShlbmQueCk7XG4gICAgfVxuICB9XG5cbiAgdGhpcy5zaGlmdChhcmVhLmJlZ2luLnksIC0oZW5kLm9mZnNldCAtIGJlZ2luLm9mZnNldCkpO1xuXG4gIHZhciBkaWZmID0gdGhpcy5sZW5ndGggLSB0aGlzLmluZGV4Lmxlbmd0aDtcblxuICB0aGlzLmxlbmd0aCA9IHRoaXMuaW5kZXgubGVuZ3RoO1xuXG4gIHJldHVybiBkaWZmO1xufTtcblxuTGluZXMucHJvdG90eXBlLnNoaWZ0ID0gZnVuY3Rpb24oeSwgZGlmZikge1xuICBmb3IgKHZhciBpID0geTsgaSA8IHRoaXMuaW5kZXgubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLmluZGV4W2ldICs9IGRpZmY7XG4gIH1cbn07XG5cbkxpbmVzLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBsaW5lcyA9IG5ldyBMaW5lcztcbiAgbGluZXMuaW5kZXggPSB0aGlzLmluZGV4LnNsaWNlKCk7XG4gIGxpbmVzLnRhaWwgPSB0aGlzLnRhaWw7XG4gIGxpbmVzLmxlbmd0aCA9IHRoaXMubGVuZ3RoO1xuICByZXR1cm4gbGluZXM7XG59O1xuXG5MaW5lcy5jb3VudCA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgcmV0dXJuIHRoaXMudGV4dC5tYXRjaChOKS5sZW5ndGg7XG59O1xuXG5mdW5jdGlvbiBhZGQoYikge1xuICByZXR1cm4gZnVuY3Rpb24oYSkge1xuICAgIHJldHVybiBhICsgYjtcbiAgfTtcbn1cbiIsIi8vIHZhciBXT1JEID0gL1xcdysvZztcbnZhciBXT1JEID0gL1thLXpBLVowLTldezEsfS9nXG52YXIgcmFuayA9IDA7XG5cbm1vZHVsZS5leHBvcnRzID0gUHJlZml4VHJlZU5vZGU7XG5cbmZ1bmN0aW9uIFByZWZpeFRyZWVOb2RlKCkge1xuICB0aGlzLnZhbHVlID0gJyc7XG4gIHRoaXMucmFuayA9IDA7XG4gIHRoaXMuY2hpbGRyZW4gPSB7fTtcbn1cblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmdldFNvcnRlZENoaWxkcmVuID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjaGlsZHJlbiA9IE9iamVjdFxuICAgIC5rZXlzKHRoaXMuY2hpbGRyZW4pXG4gICAgLm1hcCgoa2V5KSA9PiB0aGlzLmNoaWxkcmVuW2tleV0pO1xuXG4gIC8vVE9ETzogb25seSBmaWx0ZXIgYW5kIHNvcnQgaW4gdGhlIGVuZFxuICByZXR1cm4gY2hpbGRyZW5cbiAgICAucmVkdWNlKChwLCBuKSA9PiBwLmNvbmNhdChuLmdldFNvcnRlZENoaWxkcmVuKCkpLCBjaGlsZHJlbilcbiAgICAuZmlsdGVyKChub2RlKSA9PiBub2RlLnZhbHVlKVxuICAgIC5zb3J0KChhLCBiKSA9PiB7XG4gICAgICB2YXIgcmVzID0gYi5yYW5rIC0gYS5yYW5rO1xuICAgICAgaWYgKHJlcyA9PT0gMCkgcmVzID0gYi52YWx1ZS5sZW5ndGggLSBhLnZhbHVlLmxlbmd0aDtcbiAgICAgIGlmIChyZXMgPT09IDApIHJlcyA9IGEudmFsdWUgPiBiLnZhbHVlO1xuICAgICAgcmV0dXJuIHJlcztcbiAgICB9KTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5jb2xsZWN0ID0gZnVuY3Rpb24oa2V5KSB7XG4gIHZhciBjb2xsZWN0aW9uID0gW107XG4gIHZhciBub2RlID0gdGhpcy5maW5kKGtleSk7XG4gIGlmIChub2RlKSB7XG4gICAgY29sbGVjdGlvbiA9IG5vZGUuZ2V0U29ydGVkQ2hpbGRyZW4oKTtcbiAgICBpZiAobm9kZS52YWx1ZSkgY29sbGVjdGlvbi5wdXNoKG5vZGUpO1xuICB9XG4gIHJldHVybiBjb2xsZWN0aW9uO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmZpbmQgPSBmdW5jdGlvbihrZXkpIHtcbiAgdmFyIG5vZGUgPSB0aGlzO1xuICBmb3IgKHZhciBjaGFyIGluIGtleSkge1xuICAgIGlmIChrZXlbY2hhcl0gaW4gbm9kZS5jaGlsZHJlbikge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGRyZW5ba2V5W2NoYXJdXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbm9kZTtcbn07XG5cblByZWZpeFRyZWVOb2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihzLCB2YWx1ZSkge1xuICB2YXIgbm9kZSA9IHRoaXM7XG4gIHZhciBpID0gMDtcbiAgdmFyIG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBpZiAoc1tpXSBpbiBub2RlLmNoaWxkcmVuKSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZHJlbltzW2ldXTtcbiAgICAgIGkrKztcbiAgICB9IGVsc2Uge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgbm9kZSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSA9XG4gICAgbm9kZS5jaGlsZHJlbltzW2ldXSB8fCBuZXcgUHJlZml4VHJlZU5vZGU7XG4gICAgaSsrO1xuICB9XG5cbiAgbm9kZS52YWx1ZSA9IHM7XG4gIG5vZGUucmFuaysrO1xufTtcblxuUHJlZml4VHJlZU5vZGUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24ocykge1xuICB2YXIgd29yZDtcbiAgd2hpbGUgKHdvcmQgPSBXT1JELmV4ZWMocykpIHtcbiAgICB0aGlzLmluc2VydCh3b3JkWzBdKTtcbiAgfVxufTtcbiIsIlxudmFyIEJlZ2luID0gL1tcXC8nXCJgXS9nO1xuXG52YXIgTWF0Y2ggPSB7XG4gICdzaW5nbGUgY29tbWVudCc6IFsnLy8nLCdcXG4nXSxcbiAgJ2RvdWJsZSBjb21tZW50JzogWycvKicsJyovJ10sXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiBbJ2AnLCdgJ10sXG4gICdzaW5nbGUgcXVvdGUgc3RyaW5nJzogW1wiJ1wiLFwiJ1wiXSxcbiAgJ2RvdWJsZSBxdW90ZSBzdHJpbmcnOiBbJ1wiJywnXCInXSxcbiAgJ3JlZ2V4cCc6IFsnLycsJy8nXSxcbn07XG5cbnZhciBTa2lwID0ge1xuICAnc2luZ2xlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnZG91YmxlIHF1b3RlIHN0cmluZyc6IFwiXFxcXFwiLFxuICAnc2luZ2xlIGNvbW1lbnQnOiBmYWxzZSxcbiAgJ2RvdWJsZSBjb21tZW50JzogZmFsc2UsXG4gICdyZWdleHAnOiBcIlxcXFxcIixcbn07XG5cbnZhciBUb2tlbiA9IHt9O1xuZm9yICh2YXIga2V5IGluIE1hdGNoKSB7XG4gIHZhciBNID0gTWF0Y2hba2V5XTtcbiAgVG9rZW5bTVswXV0gPSBrZXk7XG59XG5cbnZhciBUT0tFTiA9IC8oXFwvXFwqKXwoXFwqXFwvKXwoYCkvZztcblxubW9kdWxlLmV4cG9ydHMgPSBTZWdtZW50cztcblxuZnVuY3Rpb24gU2VnbWVudHMoYnVmZmVyKSB7XG4gIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xuICB0aGlzLnNlZ21lbnRzID0gW107XG4gIHRoaXMuY2FjaGUgPSB7XG4gICAgb2Zmc2V0OiB7fSxcbiAgICByYW5nZToge30sXG4gIH07XG59XG5cbnZhciBMZW5ndGggPSB7XG4gICdvcGVuIGNvbW1lbnQnOiAyLFxuICAnY2xvc2UgY29tbWVudCc6IDIsXG4gICd0ZW1wbGF0ZSBzdHJpbmcnOiAxLFxufTtcblxudmFyIE5vdE9wZW4gPSB7XG4gICdjbG9zZSBjb21tZW50JzogdHJ1ZVxufTtcblxudmFyIENsb3NlcyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjbG9zZSBjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICd0ZW1wbGF0ZSBzdHJpbmcnLFxufTtcblxudmFyIFRhZyA9IHtcbiAgJ29wZW4gY29tbWVudCc6ICdjb21tZW50JyxcbiAgJ3RlbXBsYXRlIHN0cmluZyc6ICdzdHJpbmcnLFxufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIG9wZW4gPSBmYWxzZTtcbiAgdmFyIHN0YXRlID0gbnVsbDtcbiAgdmFyIHdhaXRGb3IgPSAnJztcbiAgdmFyIHBvaW50ID0geyB4Oi0xLCB5Oi0xIH07XG4gIHZhciBjbG9zZSA9IDA7XG4gIHZhciBzZWdtZW50O1xuICB2YXIgcmFuZ2U7XG4gIHZhciB0ZXh0O1xuICB2YXIgdmFsaWQ7XG4gIHZhciBsYXN0O1xuXG4gIHZhciBpID0gMDtcblxuICBmb3IgKDsgaSA8IHRoaXMuc2VnbWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICBzZWdtZW50ID0gdGhpcy5zZWdtZW50c1tpXTtcblxuICAgIC8vIGNhY2hlIHN0YXRlIGV0YyBkeW5hbWljYWxseVxuXG4gICAgaWYgKG9wZW4pIHtcbiAgICAgIGlmICh3YWl0Rm9yID09PSBzZWdtZW50LnR5cGUpIHtcbiAgICAgICAgcG9pbnQgPSB0aGlzLmdldFBvaW50T2Zmc2V0KHNlZ21lbnQub2Zmc2V0KTtcbiAgICAgICAgaWYgKCFwb2ludCkgcmV0dXJuO1xuICAgICAgICBpZiAocG9pbnQueSA+PSB5KSByZXR1cm4gVGFnW3N0YXRlLnR5cGVdO1xuXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKCdjbG9zZScsIHNlZ21lbnQudHlwZSwgc2VnbWVudC5vZmZzZXQsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW3NlZ21lbnQub2Zmc2V0LCBzZWdtZW50Lm9mZnNldCArIDEwXSkpXG4gICAgICAgIGxhc3QgPSBzZWdtZW50O1xuICAgICAgICBsYXN0LnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHN0YXRlID0gbnVsbDtcbiAgICAgICAgb3BlbiA9IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBwb2ludCA9IHRoaXMuZ2V0UG9pbnRPZmZzZXQoc2VnbWVudC5vZmZzZXQpO1xuICAgICAgaWYgKCFwb2ludCkgcmV0dXJuO1xuXG4gICAgICByYW5nZSA9IHBvaW50LmxpbmUucmFuZ2U7XG5cbiAgICAgIGlmIChsYXN0ICYmIGxhc3QucG9pbnQueSA9PT0gcG9pbnQueSkge1xuICAgICAgICBjbG9zZSA9IGxhc3QucG9pbnQueCArIExlbmd0aFtsYXN0LnR5cGVdO1xuICAgICAgICAvLyBjb25zb2xlLmxvZygnbGFzdCBvbmUgd2FzJywgbGFzdC50eXBlLCBsYXN0LnBvaW50LngsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW2xhc3Qub2Zmc2V0LCBsYXN0Lm9mZnNldCArIDEwXSkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjbG9zZSA9IDA7XG4gICAgICB9XG4gICAgICB2YWxpZCA9IHRoaXMuaXNWYWxpZFJhbmdlKFtyYW5nZVswXSwgcmFuZ2VbMV0rMV0sIHNlZ21lbnQsIGNsb3NlKTtcblxuICAgICAgaWYgKHZhbGlkKSB7XG4gICAgICAgIGlmIChOb3RPcGVuW3NlZ21lbnQudHlwZV0pIGNvbnRpbnVlO1xuICAgICAgICAvLyBjb25zb2xlLmxvZygnb3BlbicsIHNlZ21lbnQudHlwZSwgc2VnbWVudC5vZmZzZXQsIHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UoW3NlZ21lbnQub2Zmc2V0LCBzZWdtZW50Lm9mZnNldCArIDEwXSkpXG4gICAgICAgIG9wZW4gPSB0cnVlO1xuICAgICAgICBzdGF0ZSA9IHNlZ21lbnQ7XG4gICAgICAgIHN0YXRlLnBvaW50ID0gcG9pbnQ7XG4gICAgICAgIHdhaXRGb3IgPSBDbG9zZXNbc3RhdGUudHlwZV07XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwb2ludC55ID49IHkpIGJyZWFrO1xuICB9XG4gIGlmIChzdGF0ZSAmJiBzdGF0ZS5wb2ludC55IDwgeSkgcmV0dXJuIFRhZ1tzdGF0ZS50eXBlXTtcbiAgcmV0dXJuO1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmdldFBvaW50T2Zmc2V0ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIGlmIChvZmZzZXQgaW4gdGhpcy5jYWNoZS5vZmZzZXQpIHJldHVybiB0aGlzLmNhY2hlLm9mZnNldFtvZmZzZXRdXG4gIHJldHVybiAodGhpcy5jYWNoZS5vZmZzZXRbb2Zmc2V0XSA9IHRoaXMuYnVmZmVyLmxpbmVzLmdldE9mZnNldChvZmZzZXQpKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkUmFuZ2UgPSBmdW5jdGlvbihyYW5nZSwgc2VnbWVudCwgY2xvc2UpIHtcbiAgdmFyIGtleSA9IHJhbmdlLmpvaW4oKTtcbiAgaWYgKGtleSBpbiB0aGlzLmNhY2hlLnJhbmdlKSByZXR1cm4gdGhpcy5jYWNoZS5yYW5nZVtrZXldO1xuICB2YXIgdGV4dCA9IHRoaXMuYnVmZmVyLnRleHQuZ2V0UmFuZ2UocmFuZ2UpO1xuICB2YXIgdmFsaWQgPSB0aGlzLmlzVmFsaWQodGV4dCwgc2VnbWVudC5vZmZzZXQgLSByYW5nZVswXSwgY2xvc2UpO1xuICByZXR1cm4gKHRoaXMuY2FjaGUucmFuZ2Vba2V5XSA9IHZhbGlkKTtcbn07XG5cblNlZ21lbnRzLnByb3RvdHlwZS5pc1ZhbGlkID0gZnVuY3Rpb24odGV4dCwgb2Zmc2V0LCBsYXN0SW5kZXgpIHtcbiAgQmVnaW4ubGFzdEluZGV4ID0gbGFzdEluZGV4O1xuICB2YXIgbWF0Y2ggPSBCZWdpbi5leGVjKHRleHQpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG5cbiAgaSA9IG1hdGNoLmluZGV4O1xuXG4gIGxhc3QgPSBpO1xuXG4gIHZhciB2YWxpZCA9IHRydWU7XG5cbiAgb3V0ZXI6XG4gIGZvciAoOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBvbmUgPSB0ZXh0W2ldO1xuICAgIHZhciBuZXh0ID0gdGV4dFtpICsgMV07XG4gICAgdmFyIHR3byA9IG9uZSArIG5leHQ7XG4gICAgaWYgKGkgPT09IG9mZnNldCkgcmV0dXJuIHRydWU7XG5cbiAgICB2YXIgbyA9IFRva2VuW3R3b107XG4gICAgaWYgKCFvKSBvID0gVG9rZW5bb25lXTtcbiAgICBpZiAoIW8pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHZhciB3YWl0Rm9yID0gTWF0Y2hbb11bMV07XG5cbiAgICAvLyBjb25zb2xlLmxvZygnc3RhcnQnLCBpLCBvKVxuICAgIGxhc3QgPSBpO1xuXG4gICAgc3dpdGNoICh3YWl0Rm9yLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcbiAgICAgICAgICBvbmUgPSB0ZXh0W2ldO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IG9uZSkge1xuICAgICAgICAgICAgaSArPSAxO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDE7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICB3aGlsZSAoKytpIDwgdGV4dC5sZW5ndGgpIHtcblxuICAgICAgICAgIG9uZSA9IHRleHRbaV07XG4gICAgICAgICAgdHdvID0gdGV4dFtpXSArIHRleHRbaSArIDFdO1xuXG4gICAgICAgICAgaWYgKG9uZSA9PT0gU2tpcFtvXSkge1xuICAgICAgICAgICAgKytpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHdhaXRGb3IgPT09IHR3bykge1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCdcXG4nID09PSBvbmUgJiYgIXZhbGlkKSB7XG4gICAgICAgICAgICB2YWxpZCA9IHRydWU7XG4gICAgICAgICAgICBpID0gbGFzdCArIDI7XG4gICAgICAgICAgICBjb250aW51ZSBvdXRlcjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaSA9PT0gb2Zmc2V0KSB7XG4gICAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsaWQ7XG59XG5cblNlZ21lbnRzLnByb3RvdHlwZS5nZXRTZWdtZW50ID0gZnVuY3Rpb24ob2Zmc2V0KSB7XG4gIHZhciBiZWdpbiA9IDA7XG4gIHZhciBlbmQgPSB0aGlzLnNlZ21lbnRzLmxlbmd0aDtcblxuICB2YXIgcCA9IC0xO1xuICB2YXIgaSA9IC0xO1xuICB2YXIgYjtcblxuICBkbyB7XG4gICAgcCA9IGk7XG4gICAgaSA9IGJlZ2luICsgKGVuZCAtIGJlZ2luKSAvIDIgfCAwO1xuICAgIGIgPSB0aGlzLnNlZ21lbnRzW2ldO1xuICAgIGlmIChiLm9mZnNldCA8PSBvZmZzZXQpIGJlZ2luID0gaTtcbiAgICBlbHNlIGVuZCA9IGk7XG4gIH0gd2hpbGUgKHAgIT09IGkpO1xuXG4gIHJldHVybiB7XG4gICAgc2VnbWVudDogYixcbiAgICBpbmRleDogaVxuICB9O1xufTtcblxuU2VnbWVudHMucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24odGV4dCkge1xuICB2YXIgbWF0Y2g7XG5cbiAgdmFyIHNlZ21lbnRzID0gdGhpcy5zZWdtZW50cyA9IFtdO1xuXG4gIHRoaXMuY2FjaGUgPSB7XG4gICAgb2Zmc2V0OiB7fSxcbiAgICByYW5nZToge30sXG4gIH07XG5cbiAgd2hpbGUgKG1hdGNoID0gVE9LRU4uZXhlYyh0ZXh0KSkge1xuICAgIGlmIChtYXRjaFsnMyddKSBzZWdtZW50cy5wdXNoKG5ldyBTZWdtZW50KCd0ZW1wbGF0ZSBzdHJpbmcnLCBtYXRjaC5pbmRleCkpO1xuICAgIGVsc2UgaWYgKG1hdGNoWycxJ10pIHNlZ21lbnRzLnB1c2gobmV3IFNlZ21lbnQoJ29wZW4gY29tbWVudCcsIG1hdGNoLmluZGV4KSk7XG4gICAgZWxzZSBpZiAobWF0Y2hbJzInXSkgc2VnbWVudHMucHVzaChuZXcgU2VnbWVudCgnY2xvc2UgY29tbWVudCcsIG1hdGNoLmluZGV4KSk7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIFNlZ21lbnQodHlwZSwgb2Zmc2V0KSB7XG4gIHRoaXMudHlwZSA9IHR5cGU7XG4gIHRoaXMub2Zmc2V0ID0gb2Zmc2V0O1xufVxuIiwiLypcblxuZXhhbXBsZSBzZWFyY2ggZm9yIG9mZnNldCBgNGAgOlxuYG9gIGFyZSBub2RlJ3MgbGV2ZWxzLCBgeGAgYXJlIHRyYXZlcnNhbCBzdGVwc1xuXG54XG54XG5vLS0+eCAgIG8gICBvXG5vIG8geCAgIG8gICBvIG8gb1xubyBvIG8teCBvIG8gbyBvIG9cbjEgMiAzIDQgNSA2IDcgOCA5XG5cbiovXG5cbmxvZyA9IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU2tpcFN0cmluZztcblxuZnVuY3Rpb24gTm9kZSh2YWx1ZSwgbGV2ZWwpIHtcbiAgdGhpcy52YWx1ZSA9IHZhbHVlO1xuICB0aGlzLmxldmVsID0gbGV2ZWw7XG4gIHRoaXMud2lkdGggPSBuZXcgQXJyYXkodGhpcy5sZXZlbCkuZmlsbCh2YWx1ZSAmJiB2YWx1ZS5sZW5ndGggfHwgMCk7XG4gIHRoaXMubmV4dCA9IG5ldyBBcnJheSh0aGlzLmxldmVsKS5maWxsKG51bGwpO1xufVxuXG5Ob2RlLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy53aWR0aFswXTtcbiAgfVxufTtcblxuZnVuY3Rpb24gU2tpcFN0cmluZyhvKSB7XG4gIG8gPSBvIHx8IHt9O1xuICB0aGlzLmxldmVscyA9IG8ubGV2ZWxzIHx8IDExO1xuICB0aGlzLmJpYXMgPSBvLmJpYXMgfHwgMSAvIE1hdGguRTtcbiAgdGhpcy5oZWFkID0gbmV3IE5vZGUobnVsbCwgdGhpcy5sZXZlbHMpO1xuICB0aGlzLmNodW5rU2l6ZSA9IG8uY2h1bmtTaXplO1xufVxuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZSA9IHtcbiAgZ2V0IGxlbmd0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5oZWFkLndpZHRoW3RoaXMubGV2ZWxzIC0gMV07XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG9mZnNldCkge1xuICAvLyBncmVhdCBoYWNrIHRvIGRvIG9mZnNldCA+PSBmb3IgLnNlYXJjaCgpXG4gIC8vIHdlIGRvbid0IGhhdmUgZnJhY3Rpb25zIGFueXdheSBzby4uXG4gIHJldHVybiB0aGlzLnNlYXJjaChvZmZzZXQsIHRydWUpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmluc2VydENodW5rZWQoMCwgdGV4dCk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbihvZmZzZXQsIGluY2wpIHtcbiAgaW5jbCA9IGluY2wgPyAuMSA6IDA7XG5cbiAgLy8gcHJlcGFyZSB0byBob2xkIHN0ZXBzXG4gIHZhciBzdGVwcyA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG4gIHZhciB3aWR0aCA9IG5ldyBBcnJheSh0aGlzLmxldmVscyk7XG5cbiAgLy8gaXRlcmF0ZSBsZXZlbHMgZG93biwgc2tpcHBpbmcgdG9wXG4gIHZhciBpID0gdGhpcy5sZXZlbHM7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuXG4gIHdoaWxlIChpLS0pIHtcbiAgICB3aGlsZSAob2Zmc2V0ICsgaW5jbCA+IG5vZGUud2lkdGhbaV0gJiYgbnVsbCAhPSBub2RlLm5leHRbaV0pIHtcbiAgICAgIG9mZnNldCAtPSBub2RlLndpZHRoW2ldO1xuICAgICAgbm9kZSA9IG5vZGUubmV4dFtpXTtcbiAgICB9XG4gICAgc3RlcHNbaV0gPSBub2RlO1xuICAgIHdpZHRoW2ldID0gb2Zmc2V0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBub2RlOiBub2RlLFxuICAgIHN0ZXBzOiBzdGVwcyxcbiAgICB3aWR0aDogd2lkdGgsXG4gICAgb2Zmc2V0OiBvZmZzZXRcbiAgfTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnNwbGljZSA9IGZ1bmN0aW9uKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKSB7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7IC8vIHNraXAgc3RlcHMgbGVmdCBvZiB0aGUgb2Zmc2V0XG4gIHZhciB3aWR0aCA9IHMud2lkdGg7XG5cbiAgdmFyIHA7IC8vIGxlZnQgbm9kZSBvciBgcGBcbiAgdmFyIHE7IC8vIHJpZ2h0IG5vZGUgb3IgYHFgIChvdXIgbmV3IG5vZGUpXG4gIHZhciBsZW47XG5cbiAgLy8gY3JlYXRlIG5ldyBub2RlXG4gIGxldmVsID0gbGV2ZWwgfHwgdGhpcy5yYW5kb21MZXZlbCgpO1xuICBxID0gbmV3IE5vZGUodmFsdWUsIGxldmVsKTtcbiAgbGVuZ3RoID0gcS53aWR0aFswXTtcblxuICAvLyBpdGVyYXRvclxuICB2YXIgaTtcblxuICAvLyBpdGVyYXRlIHN0ZXBzIGxldmVscyBiZWxvdyBuZXcgbm9kZSBsZXZlbFxuICBpID0gbGV2ZWw7XG4gIHdoaWxlIChpLS0pIHtcbiAgICBwID0gc3RlcHNbaV07IC8vIGdldCBsZWZ0IG5vZGUgb2YgdGhpcyBsZXZlbCBzdGVwXG4gICAgcS5uZXh0W2ldID0gcC5uZXh0W2ldOyAvLyBpbnNlcnQgc28gaW5oZXJpdCBsZWZ0J3MgbmV4dFxuICAgIHAubmV4dFtpXSA9IHE7IC8vIGxlZnQncyBuZXh0IGlzIG5vdyBvdXIgbmV3IG5vZGVcbiAgICBxLndpZHRoW2ldID0gcC53aWR0aFtpXSAtIHdpZHRoW2ldICsgbGVuZ3RoO1xuICAgIHAud2lkdGhbaV0gPSB3aWR0aFtpXTtcbiAgfVxuXG4gIC8vIGl0ZXJhdGUgc3RlcHMgYWxsIGxldmVscyBkb3duIHVudGlsIGV4Y2VwdCBuZXcgbm9kZSBsZXZlbFxuICBpID0gdGhpcy5sZXZlbHM7XG4gIHdoaWxlIChpLS0gPiBsZXZlbCkge1xuICAgIHAgPSBzdGVwc1tpXTsgLy8gZ2V0IGxlZnQgbm9kZSBvZiB0aGlzIGxldmVsXG4gICAgcC53aWR0aFtpXSArPSBsZW5ndGg7IC8vIGFkZCBuZXcgbm9kZSB3aWR0aFxuICB9XG5cbiAgLy8gcmV0dXJuIG5ldyBub2RlXG4gIHJldHVybiBxO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24ob2Zmc2V0LCB2YWx1ZSwgbGV2ZWwpIHtcbiAgdmFyIHMgPSB0aGlzLnNlYXJjaChvZmZzZXQpO1xuXG4gIC8vIGlmIHNlYXJjaCBmYWxscyBpbiB0aGUgbWlkZGxlIG9mIGEgc3RyaW5nXG4gIC8vIGluc2VydCBpdCB0aGVyZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIGEgbmV3IG5vZGVcbiAgaWYgKHMub2Zmc2V0ICYmIHMubm9kZS52YWx1ZSAmJiBzLm9mZnNldCA8IHMubm9kZS52YWx1ZS5sZW5ndGgpIHtcbiAgICB0aGlzLnVwZGF0ZShzLCBpbnNlcnQocy5vZmZzZXQsIHMubm9kZS52YWx1ZSwgdmFsdWUpKTtcbiAgICByZXR1cm4gcy5ub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuc3BsaWNlKHMsIG9mZnNldCwgdmFsdWUsIGxldmVsKTtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKHMsIHZhbHVlKSB7XG4gIC8vIHZhbHVlcyBsZW5ndGggZGlmZmVyZW5jZVxuICB2YXIgbGVuZ3RoID0gcy5ub2RlLnZhbHVlLmxlbmd0aCAtIHZhbHVlLmxlbmd0aDtcblxuICAvLyB1cGRhdGUgdmFsdWVcbiAgcy5ub2RlLnZhbHVlID0gdmFsdWU7XG5cbiAgLy8gaXRlcmF0b3JcbiAgdmFyIGk7XG5cbiAgLy8gZml4IHdpZHRocyBvbiBhbGwgbGV2ZWxzXG4gIGkgPSB0aGlzLmxldmVscztcblxuICB3aGlsZSAoaS0tKSB7XG4gICAgcy5zdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgaWYgKHJhbmdlWzFdID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAncmFuZ2UgZW5kIG92ZXIgbWF4aW11bSBsZW5ndGgoJyArXG4gICAgICB0aGlzLmxlbmd0aCArICcpOiBbJyArIHJhbmdlLmpvaW4oKSArICddJ1xuICAgICk7XG4gIH1cblxuICAvLyByZW1haW4gZGlzdGFuY2UgdG8gcmVtb3ZlXG4gIHZhciB4ID0gcmFuZ2VbMV0gLSByYW5nZVswXTtcblxuICAvLyBzZWFyY2ggZm9yIG5vZGUgb24gbGVmdCBlZGdlXG4gIHZhciBzID0gdGhpcy5zZWFyY2gocmFuZ2VbMF0pO1xuICB2YXIgb2Zmc2V0ID0gcy5vZmZzZXQ7XG4gIHZhciBzdGVwcyA9IHMuc3RlcHM7XG4gIHZhciBub2RlID0gcy5ub2RlO1xuXG4gIC8vIHNraXAgaGVhZFxuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gIC8vIHNsaWNlIGxlZnQgZWRnZSB3aGVuIHBhcnRpYWxcbiAgaWYgKG9mZnNldCkge1xuICAgIGlmIChvZmZzZXQgPCBub2RlLndpZHRoWzBdKSB7XG4gICAgICB4IC09IHRoaXMudXBkYXRlKHMsXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoMCwgb2Zmc2V0KSArXG4gICAgICAgIG5vZGUudmFsdWUuc2xpY2UoXG4gICAgICAgICAgb2Zmc2V0ICtcbiAgICAgICAgICBNYXRoLm1pbih4LCBub2RlLmxlbmd0aCAtIG9mZnNldClcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBub2RlID0gbm9kZS5uZXh0WzBdO1xuXG4gICAgaWYgKCFub2RlKSByZXR1cm47XG4gIH1cblxuICAvLyByZW1vdmUgYWxsIGZ1bGwgbm9kZXMgaW4gcmFuZ2VcbiAgd2hpbGUgKG5vZGUgJiYgeCA+PSBub2RlLndpZHRoWzBdKSB7XG4gICAgeCAtPSB0aGlzLnJlbW92ZU5vZGUoc3RlcHMsIG5vZGUpO1xuICAgIG5vZGUgPSBub2RlLm5leHRbMF07XG4gIH1cblxuICAvLyBzbGljZSByaWdodCBlZGdlIHdoZW4gcGFydGlhbFxuICBpZiAoeCkge1xuICAgIHRoaXMucmVwbGFjZShzdGVwcywgbm9kZSwgbm9kZS52YWx1ZS5zbGljZSh4KSk7XG4gIH1cbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLnJlbW92ZU5vZGUgPSBmdW5jdGlvbihzdGVwcywgbm9kZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS53aWR0aFswXTtcblxuICB2YXIgaTtcblxuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aCAtIG5vZGUud2lkdGhbaV07XG4gICAgc3RlcHNbaV0ubmV4dFtpXSA9IG5vZGUubmV4dFtpXTtcbiAgfVxuXG4gIGkgPSB0aGlzLmxldmVscztcbiAgd2hpbGUgKGktLSA+IG5vZGUubGV2ZWwpIHtcbiAgICBzdGVwc1tpXS53aWR0aFtpXSAtPSBsZW5ndGg7XG4gIH1cblxuICByZXR1cm4gbGVuZ3RoO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmVwbGFjZSA9IGZ1bmN0aW9uKHN0ZXBzLCBub2RlLCB2YWx1ZSkge1xuICB2YXIgbGVuZ3RoID0gbm9kZS52YWx1ZS5sZW5ndGggLSB2YWx1ZS5sZW5ndGg7XG5cbiAgbm9kZS52YWx1ZSA9IHZhbHVlO1xuXG4gIHZhciBpO1xuICBpID0gbm9kZS5sZXZlbDtcbiAgd2hpbGUgKGktLSkge1xuICAgIG5vZGUud2lkdGhbaV0gLT0gbGVuZ3RoO1xuICB9XG5cbiAgaSA9IHRoaXMubGV2ZWxzO1xuICB3aGlsZSAoaS0tID4gbm9kZS5sZXZlbCkge1xuICAgIHN0ZXBzW2ldLndpZHRoW2ldIC09IGxlbmd0aDtcbiAgfVxuXG4gIHJldHVybiBsZW5ndGg7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5yZW1vdmVDaGFyQXQgPSBmdW5jdGlvbihvZmZzZXQpIHtcbiAgcmV0dXJuIHRoaXMucmVtb3ZlKFtvZmZzZXQsIG9mZnNldCsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5pbnNlcnRDaHVua2VkID0gZnVuY3Rpb24ob2Zmc2V0LCB0ZXh0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gdGhpcy5jaHVua1NpemUpIHtcbiAgICB2YXIgY2h1bmsgPSB0ZXh0LnN1YnN0cihpLCB0aGlzLmNodW5rU2l6ZSk7XG4gICAgdGhpcy5pbnNlcnQoaSArIG9mZnNldCwgY2h1bmspO1xuICB9XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5zdWJzdHJpbmcgPSBmdW5jdGlvbihhLCBiKSB7XG4gIGEgPSBhIHx8IDA7XG4gIGIgPSBiIHx8IHRoaXMubGVuZ3RoO1xuICB2YXIgbGVuZ3RoID0gYiAtIGE7XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoKGEsIHRydWUpO1xuICB2YXIgbm9kZSA9IHNlYXJjaC5ub2RlO1xuICBpZiAodGhpcy5oZWFkID09PSBub2RlKSBub2RlID0gbm9kZS5uZXh0WzBdO1xuICB2YXIgZCA9IGxlbmd0aCArIHNlYXJjaC5vZmZzZXQ7XG4gIHZhciBzID0gJyc7XG4gIHdoaWxlIChub2RlICYmIGQgPj0gMCkge1xuICAgIGQgLT0gbm9kZS53aWR0aFswXTtcbiAgICBzICs9IG5vZGUudmFsdWU7XG4gICAgbm9kZSA9IG5vZGUubmV4dFswXTtcbiAgfVxuICBpZiAobm9kZSkge1xuICAgIHMgKz0gbm9kZS52YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBzLnN1YnN0cihzZWFyY2gub2Zmc2V0LCBsZW5ndGgpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUucmFuZG9tTGV2ZWwgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxldmVsID0gMTtcbiAgd2hpbGUgKGxldmVsIDwgdGhpcy5sZXZlbHMgLSAxICYmIE1hdGgucmFuZG9tKCkgPCB0aGlzLmJpYXMpIGxldmVsKys7XG4gIHJldHVybiBsZXZlbDtcbn07XG5cblNraXBTdHJpbmcucHJvdG90eXBlLmdldFJhbmdlID0gZnVuY3Rpb24ocmFuZ2UpIHtcbiAgcmFuZ2UgPSByYW5nZSB8fCBbXTtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKHJhbmdlWzBdLCByYW5nZVsxXSk7XG59O1xuXG5Ta2lwU3RyaW5nLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFNraXBTdHJpbmc7XG4gIHZhciBub2RlID0gdGhpcy5oZWFkO1xuICB2YXIgb2Zmc2V0ID0gMDtcbiAgd2hpbGUgKG5vZGUgPSBub2RlLm5leHRbMF0pIHtcbiAgICBjb3B5Lmluc2VydChvZmZzZXQsIG5vZGUudmFsdWUpO1xuICAgIG9mZnNldCArPSBub2RlLndpZHRoWzBdO1xuICB9XG4gIHJldHVybiBjb3B5O1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUuam9pblN0cmluZyA9IGZ1bmN0aW9uKGRlbGltaXRlcikge1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG5vZGUgPSB0aGlzLmhlYWQ7XG4gIHdoaWxlIChub2RlID0gbm9kZS5uZXh0WzBdKSB7XG4gICAgcGFydHMucHVzaChub2RlLnZhbHVlKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbihkZWxpbWl0ZXIpO1xufTtcblxuU2tpcFN0cmluZy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuc3Vic3RyaW5nKCk7XG59O1xuXG5mdW5jdGlvbiB0cmltKHMsIGxlZnQsIHJpZ2h0KSB7XG4gIHJldHVybiBzLnN1YnN0cigwLCBzLmxlbmd0aCAtIHJpZ2h0KS5zdWJzdHIobGVmdCk7XG59XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgUmVnZXhwID0gcmVxdWlyZSgnLi4vLi4vbGliL3JlZ2V4cCcpO1xyXG52YXIgUiA9IFJlZ2V4cC5jcmVhdGU7XHJcblxyXG4vL05PVEU6IG9yZGVyIG1hdHRlcnNcclxudmFyIHN5bnRheCA9IG1hcCh7XHJcbiAgJ29wZXJhdG9yJzogUihbJ29wZXJhdG9yJ10sICdnJywgZW50aXRpZXMpLFxyXG4gICdwYXJhbXMnOiAgIFIoWydwYXJhbXMnXSwgICAnZycpLFxyXG4gICdkZWNsYXJlJzogIFIoWydkZWNsYXJlJ10sICAnZycpLFxyXG4gICdmdW5jdGlvbic6IFIoWydmdW5jdGlvbiddLCAnZycpLFxyXG4gICdrZXl3b3JkJzogIFIoWydrZXl3b3JkJ10sICAnZycpLFxyXG4gICdidWlsdGluJzogIFIoWydidWlsdGluJ10sICAnZycpLFxyXG4gICdpbmRlbnQnOiAgIFIoWydpbmRlbnQnXSwgICAnZ20nKSxcclxuICAnc3ltYm9sJzogICBSKFsnc3ltYm9sJ10sICAgJ2cnKSxcclxuICAnc3RyaW5nJzogICBSKFsndGVtcGxhdGUgc3RyaW5nJ10sICdnJyksXHJcbiAgJ251bWJlcic6ICAgUihbJ3NwZWNpYWwnLCdudW1iZXInXSwgJ2cnKSxcclxufSwgY29tcGlsZSk7XHJcblxyXG52YXIgSW5kZW50ID0gY29tcGlsZShSKFsnaW5kZW50J10sICdnbScpLCAnaW5kZW50Jyk7XHJcblxyXG52YXIgQmxvY2tzID0gUihbJ2NvbW1lbnQnLCdzdHJpbmcnLCdyZWdleHAnXSwgJ2dtJyk7XHJcblxyXG52YXIgVGFnID0ge1xyXG4gICcvLyc6ICdjb21tZW50JyxcclxuICAnLyonOiAnY29tbWVudCcsXHJcbiAgJ2AnOiAnc3RyaW5nJyxcclxuICAnXCInOiAnc3RyaW5nJyxcclxuICBcIidcIjogJ3N0cmluZycsXHJcbiAgJy8nOiAncmVnZXhwJyxcclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU3ludGF4O1xyXG5cclxuZnVuY3Rpb24gU3ludGF4KG8pIHtcclxuICBvID0gbyB8fCB7fTtcclxuICB0aGlzLm1heExpbmUgPSBvLm1heExpbmUgfHwgMzAwO1xyXG4gIHRoaXMuYmxvY2tzID0gW107XHJcbn1cclxuXHJcblN5bnRheC5wcm90b3R5cGUuZW50aXRpZXMgPSBlbnRpdGllcztcclxuXHJcblN5bnRheC5wcm90b3R5cGUuaGlnaGxpZ2h0ID0gZnVuY3Rpb24oY29kZSwgb2Zmc2V0KSB7XHJcbiAgLy8gY29uc29sZS5sb2coMCwgJ2hpZ2hsaWdodCcsIGNvZGUpXHJcblxyXG4gIGNvZGUgPSB0aGlzLmNyZWF0ZUluZGVudHMoY29kZSk7XHJcbiAgY29kZSA9IHRoaXMuY3JlYXRlQmxvY2tzKGNvZGUpO1xyXG4gIGNvZGUgPSBlbnRpdGllcyhjb2RlKTtcclxuXHJcbiAgZm9yICh2YXIga2V5IGluIHN5bnRheCkge1xyXG4gICAgY29kZSA9IGNvZGUucmVwbGFjZShzeW50YXhba2V5XS5yZWdleHAsIHN5bnRheFtrZXldLnJlcGxhY2VyKTtcclxuICB9XHJcblxyXG4gIGNvZGUgPSB0aGlzLnJlc3RvcmVCbG9ja3MoY29kZSk7XHJcblxyXG4gIGNvZGUgPSBjb2RlLnJlcGxhY2UoSW5kZW50LnJlZ2V4cCwgSW5kZW50LnJlcGxhY2VyKTtcclxuXHJcbiAgLy8gY29kZSA9IGNvZGUucmVwbGFjZSgvXFx1ZWVlZS9nLCBmdW5jdGlvbigpIHtcclxuICAvLyAgIHJldHVybiBsb25nLnNoaWZ0KCkuc2xpY2UoMCwgdGhpcy5tYXhMaW5lKSArICcuLi5saW5lIHRvbyBsb25nIHRvIGRpc3BsYXknO1xyXG4gIC8vIH0pO1xyXG5cclxuICByZXR1cm4gY29kZTtcclxufTtcclxuXHJcblN5bnRheC5wcm90b3R5cGUuY3JlYXRlSW5kZW50cyA9IGZ1bmN0aW9uKGNvZGUpIHtcclxuICB2YXIgbGluZXMgPSBjb2RlLnNwbGl0KC9cXG4vZyk7XHJcbiAgaWYgKGxpbmVzLmxlbmd0aCA8PSAyKSByZXR1cm4gY29kZTtcclxuXHJcbiAgdmFyIGxpbmU7XHJcbiAgdmFyIGxvbmcgPSBbXTtcclxuICB2YXIgbWF0Y2g7XHJcbiAgdmFyIGZpcnN0SW5kZW50ID0gMDtcclxuICB2YXIgaSA9IDA7XHJcblxyXG4gIC8vIGZvciAoOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcclxuICAvLyAgIGxpbmUgPSBsaW5lc1tpXTtcclxuICAvLyAgIGlmIChsaW5lLmxlbmd0aCA+IHRoaXMubWF4TGluZSkge1xyXG4gIC8vICAgICBsb25nLnB1c2gobGluZXMuc3BsaWNlKGktLSwgMSwgJ1xcdWVlZWUnKSk7XHJcbiAgLy8gICB9XHJcbiAgLy8gfVxyXG5cclxuICBpID0gMDtcclxuICBsaW5lID0gbGluZXNbaV07XHJcbiAgLy8gY29uc29sZS5sb2cobGluZSlcclxuICB3aGlsZSAoIShtYXRjaCA9IC9cXFMvZy5leGVjKGxpbmUpKSkge1xyXG4gICAgbGluZSA9IGxpbmVzWysraV07XHJcbiAgICAvLyBjb25zb2xlLmxvZyhsaW5lKVxyXG4gIH1cclxuICBmb3IgKHZhciBqID0gMDsgaiA8IGk7IGorKykge1xyXG4gICAgbGluZXNbal0gPSBuZXcgQXJyYXkobWF0Y2guaW5kZXggKyAxKS5qb2luKCcgJyk7XHJcbiAgfVxyXG4gIHZhciBwcmV2O1xyXG4gIGZvciAoOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcclxuICAgIGxpbmUgPSBsaW5lc1tpXTtcclxuICAgIHByZXYgPSBsaW5lc1tpLTFdO1xyXG4gICAgaWYgKCFsaW5lLmxlbmd0aCAmJiBwcmV2Lmxlbmd0aCAmJiBwcmV2WzBdID09PSAnICcgJiYgcHJldltwcmV2Lmxlbmd0aC0xXSAhPT0gJy8nKSBsaW5lc1tpXSA9ICcgJztcclxuICB9XHJcblxyXG4gIGNvZGUgPSBsaW5lcy5qb2luKCdcXG4nKTtcclxuXHJcbiAgcmV0dXJuIGNvZGU7XHJcbn07XHJcblxyXG5TeW50YXgucHJvdG90eXBlLnJlc3RvcmVCbG9ja3MgPSBmdW5jdGlvbihjb2RlKSB7XHJcbiAgdmFyIGJsb2NrO1xyXG4gIHZhciBibG9ja3MgPSB0aGlzLmJsb2NrcztcclxuICB2YXIgbiA9IDA7XHJcbiAgcmV0dXJuIGNvZGUucmVwbGFjZSgvXFx1ZmZlYi9nLCBmdW5jdGlvbigpIHtcclxuICAgIGJsb2NrID0gYmxvY2tzW24rK11cclxuICAgIHZhciB0YWcgPSBpZGVudGlmeShibG9jayk7XHJcbiAgICByZXR1cm4gJzwnK3RhZysnPicrZW50aXRpZXMoYmxvY2spKyc8LycrdGFnKyc+JztcclxuICB9KTtcclxufTtcclxuXHJcblN5bnRheC5wcm90b3R5cGUuY3JlYXRlQmxvY2tzID0gZnVuY3Rpb24oY29kZSkge1xyXG4gIHRoaXMuYmxvY2tzID0gW107XHJcbiAgY29kZSA9IGNvZGUucmVwbGFjZShCbG9ja3MsIChibG9jaykgPT4ge1xyXG4gICAgdGhpcy5ibG9ja3MucHVzaChibG9jayk7XHJcbiAgICByZXR1cm4gJ1xcdWZmZWInO1xyXG4gIH0pO1xyXG4gIHJldHVybiBjb2RlO1xyXG59O1xyXG5cclxuZnVuY3Rpb24gY3JlYXRlSWQoKSB7XHJcbiAgdmFyIGFscGhhYmV0ID0gJ2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6JztcclxuICB2YXIgbGVuZ3RoID0gYWxwaGFiZXQubGVuZ3RoIC0gMTtcclxuICB2YXIgaSA9IDY7XHJcbiAgdmFyIHMgPSAnJztcclxuICB3aGlsZSAoaS0tKSB7XHJcbiAgICBzICs9IGFscGhhYmV0W01hdGgucmFuZG9tKCkgKiBsZW5ndGggfCAwXTtcclxuICB9XHJcbiAgcmV0dXJuIHM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGVudGl0aWVzKHRleHQpIHtcclxuICByZXR1cm4gdGV4dFxyXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcclxuICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcclxuICAgIC5yZXBsYWNlKC8+L2csICcmZ3Q7JylcclxuICAgIDtcclxufVxyXG5cclxuZnVuY3Rpb24gY29tcGlsZShyZWdleHAsIHRhZykge1xyXG4gIHZhciBvcGVuVGFnID0gJzwnICsgdGFnICsgJz4nO1xyXG4gIHZhciBjbG9zZVRhZyA9ICc8LycgKyB0YWcgKyAnPic7XHJcbiAgcmV0dXJuIHtcclxuICAgIG5hbWU6IHRhZyxcclxuICAgIHJlZ2V4cDogcmVnZXhwLFxyXG4gICAgcmVwbGFjZXI6IG9wZW5UYWcgKyAnJCYnICsgY2xvc2VUYWdcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYXAob2JqLCBmbikge1xyXG4gIHZhciByZXN1bHQgPSB7fTtcclxuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XHJcbiAgICByZXN1bHRba2V5XSA9IGZuKG9ialtrZXldLCBrZXkpO1xyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiByZXBsYWNlKHBhc3MsIGNvZGUpIHtcclxuICBmb3IgKHZhciBpID0gMDsgaSA8IHBhc3MubGVuZ3RoOyBpKyspIHtcclxuICAgIGNvZGUgPSBjb2RlLnJlcGxhY2UocGFzc1tpXVswXSwgcGFzc1tpXVsxXSk7XHJcbiAgfVxyXG4gIHJldHVybiBjb2RlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpbnNlcnQob2Zmc2V0LCBzdHJpbmcsIHBhcnQpIHtcclxuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlkZW50aWZ5KGJsb2NrKSB7XHJcbiAgdmFyIG9uZSA9IGJsb2NrWzBdO1xyXG4gIHZhciB0d28gPSBvbmUgKyBibG9ja1sxXTtcclxuICByZXR1cm4gVGFnW3R3b10gfHwgVGFnW29uZV07XHJcbn1cclxuIiwidmFyIG9wZW4gPSByZXF1aXJlKCdvcGVuJyk7XG52YXIgc2F2ZSA9IHJlcXVpcmUoJ3NhdmUnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJ2V2ZW50Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnLi9idWZmZXInKTtcblxubW9kdWxlLmV4cG9ydHMgPSBGaWxlO1xuXG5mdW5jdGlvbiBGaWxlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuXG4gIHRoaXMucGF0aCA9ICd1bnRpdGxlZCc7XG4gIHRoaXMuYnVmZmVyID0gbmV3IEJ1ZmZlcjtcbiAgdGhpcy5iaW5kRXZlbnQoKTtcbn1cblxuRmlsZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5GaWxlLnByb3RvdHlwZS5iaW5kRXZlbnQgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5idWZmZXIub24oJ3JhdycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdyYXcnKSk7XG4gIHRoaXMuYnVmZmVyLm9uKCdzZXQnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnc2V0JykpO1xuICB0aGlzLmJ1ZmZlci5vbigndXBkYXRlJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NoYW5nZScpKTtcbiAgdGhpcy5idWZmZXIub24oJ2JlZm9yZSB1cGRhdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnYmVmb3JlIGNoYW5nZScpKTtcbn07XG5cbkZpbGUucHJvdG90eXBlLm9wZW4gPSBmdW5jdGlvbihwYXRoLCBmbikge1xuICBvcGVuKHBhdGgsIChlcnIsIHRleHQpID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgIGZuICYmIGZuKGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMucGF0aCA9IHBhdGg7XG4gICAgdGhpcy5idWZmZXIuc2V0KHRleHQpO1xuICAgIHRoaXMuZW1pdCgnb3BlbicpO1xuICAgIGZuICYmIGZuKG51bGwsIHRoaXMpO1xuICB9KTtcbn07XG5cbkZpbGUucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbihmbikge1xuICBzYXZlKHRoaXMucGF0aCwgdGhpcy5idWZmZXIuZ2V0KCksIGZuIHx8IG5vb3ApO1xufTtcblxuRmlsZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24odGV4dCkge1xuICB0aGlzLmJ1ZmZlci5zZXQodGV4dCk7XG4gIHRoaXMuZW1pdCgnc2V0Jyk7XG59O1xuXG5mdW5jdGlvbiBub29wKCkgey8qIG5vb3AgKi99XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCdldmVudCcpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnZGVib3VuY2UnKTtcblxuLypcbiAgIC4gLlxuLTEgMCAxIDIgMyA0IDVcbiAgIG5cblxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gSGlzdG9yeTtcblxuZnVuY3Rpb24gSGlzdG9yeShlZGl0b3IpIHtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubG9nID0gW107XG4gIHRoaXMubmVlZGxlID0gMDtcbiAgdGhpcy50aW1lb3V0ID0gdHJ1ZTtcbiAgdGhpcy50aW1lU3RhcnQgPSAwO1xufVxuXG5IaXN0b3J5LnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbkhpc3RvcnkucHJvdG90eXBlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgaWYgKERhdGUubm93KCkgLSB0aGlzLnRpbWVTdGFydCA+IDIwMDApIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG4gIHRoaXMudGltZW91dCA9IHRoaXMuZGVib3VuY2VkU2F2ZSgpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuZGVib3VuY2VkU2F2ZSA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmFjdHVhbGx5U2F2ZSgpO1xufSwgNzAwKTtcblxuSGlzdG9yeS5wcm90b3R5cGUuYWN0dWFsbHlTYXZlID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdzYXZlJywgdGhpcy5uZWVkbGUpXG4gIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICB0aGlzLmxvZyA9IHRoaXMubG9nLnNsaWNlKDAsICsrdGhpcy5uZWVkbGUpO1xuICB0aGlzLmxvZy5wdXNoKHRoaXMuY29tbWl0KCkpO1xuICB0aGlzLm5lZWRsZSA9IHRoaXMubG9nLmxlbmd0aDtcbiAgdGhpcy50aW1lU3RhcnQgPSBEYXRlLm5vdygpO1xuICB0aGlzLnRpbWVvdXQgPSBmYWxzZTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLnVuZG8gPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMudGltZW91dCAhPT0gZmFsc2UpIHRoaXMuYWN0dWFsbHlTYXZlKCk7XG5cbiAgaWYgKHRoaXMubmVlZGxlID4gdGhpcy5sb2cubGVuZ3RoIC0gMSkgdGhpcy5uZWVkbGUgPSB0aGlzLmxvZy5sZW5ndGggLSAxO1xuXG4gIHRoaXMubmVlZGxlLS07XG5cbiAgaWYgKHRoaXMubmVlZGxlIDwgMCkgdGhpcy5uZWVkbGUgPSAwO1xuICAvLyBjb25zb2xlLmxvZygndW5kbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIHRoaXMuY2hlY2tvdXQodGhpcy5uZWVkbGUpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUucmVkbyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy50aW1lb3V0ICE9PSBmYWxzZSkgdGhpcy5hY3R1YWxseVNhdmUoKTtcblxuICB0aGlzLm5lZWRsZSsrO1xuICAvLyBjb25zb2xlLmxvZygncmVkbycsIHRoaXMubmVlZGxlLCB0aGlzLmxvZy5sZW5ndGggLSAxKVxuXG4gIGlmICh0aGlzLm5lZWRsZSA+IHRoaXMubG9nLmxlbmd0aCAtIDEpIHRoaXMubmVlZGxlID0gdGhpcy5sb2cubGVuZ3RoIC0gMTtcblxuICB0aGlzLmNoZWNrb3V0KHRoaXMubmVlZGxlKTtcbn07XG5cbkhpc3RvcnkucHJvdG90eXBlLmNoZWNrb3V0ID0gZnVuY3Rpb24obikge1xuICB2YXIgY29tbWl0ID0gdGhpcy5sb2dbbl07XG4gIGlmICghY29tbWl0KSByZXR1cm47XG5cbiAgdGhpcy5lZGl0b3IubWFyay5hY3RpdmUgPSBjb21taXQubWFya0FjdGl2ZTtcbiAgdGhpcy5lZGl0b3IubWFyay5zZXQoY29tbWl0Lm1hcmsuY29weSgpKTtcbiAgdGhpcy5lZGl0b3Iuc2V0Q2FyZXQoY29tbWl0LmNhcmV0LmNvcHkoKSk7XG4gIHRoaXMuZWRpdG9yLmJ1ZmZlci50ZXh0ID0gY29tbWl0LnRleHQuY29weSgpO1xuICB0aGlzLmVkaXRvci5idWZmZXIubGluZXMgPSBjb21taXQubGluZXMuY29weSgpO1xuICB0aGlzLmVtaXQoJ2NoYW5nZScpO1xufTtcblxuSGlzdG9yeS5wcm90b3R5cGUuY29tbWl0ID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB7XG4gICAgdGV4dDogdGhpcy5lZGl0b3IuYnVmZmVyLnRleHQuY29weSgpLFxuICAgIGxpbmVzOiB0aGlzLmVkaXRvci5idWZmZXIubGluZXMuY29weSgpLFxuICAgIGNhcmV0OiB0aGlzLmVkaXRvci5jYXJldC5jb3B5KCksXG4gICAgbWFyazogdGhpcy5lZGl0b3IubWFyay5jb3B5KCksXG4gICAgbWFya0FjdGl2ZTogdGhpcy5lZGl0b3IubWFyay5hY3RpdmVcbiAgfTtcbn07XG4iLCJ2YXIgRXZlbnQgPSByZXF1aXJlKCdldmVudCcpO1xudmFyIE1vdXNlID0gcmVxdWlyZSgnLi9tb3VzZScpO1xudmFyIFRleHQgPSByZXF1aXJlKCcuL3RleHQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBJbnB1dDtcblxuZnVuY3Rpb24gSW5wdXQoZWRpdG9yKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMubW91c2UgPSBuZXcgTW91c2UodGhpcyk7XG4gIHRoaXMudGV4dCA9IG5ldyBUZXh0O1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5JbnB1dC5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5JbnB1dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuZm9jdXMgPSB0aGlzLmZvY3VzLmJpbmQodGhpcyk7XG4gIHRoaXMudGV4dC5vbihbJ2tleScsICd0ZXh0J10sIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdpbnB1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCd0ZXh0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ3RleHQnKSk7XG4gIHRoaXMudGV4dC5vbigna2V5cycsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXlzJykpO1xuICB0aGlzLnRleHQub24oJ2tleScsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdrZXknKSk7XG4gIHRoaXMudGV4dC5vbignY3V0JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2N1dCcpKTtcbiAgdGhpcy50ZXh0Lm9uKCdjb3B5JywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ2NvcHknKSk7XG4gIHRoaXMudGV4dC5vbigncGFzdGUnLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAncGFzdGUnKSk7XG4gIHRoaXMubW91c2Uub24oJ3VwJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNldXAnKSk7XG4gIHRoaXMubW91c2Uub24oJ2NsaWNrJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlY2xpY2snKSk7XG4gIHRoaXMubW91c2Uub24oJ2Rvd24nLCB0aGlzLmVtaXQuYmluZCh0aGlzLCAnbW91c2Vkb3duJykpO1xuICB0aGlzLm1vdXNlLm9uKCdkcmFnJywgdGhpcy5lbWl0LmJpbmQodGhpcywgJ21vdXNlZHJhZycpKTtcbiAgdGhpcy5tb3VzZS5vbignZHJhZyBiZWdpbicsIHRoaXMuZW1pdC5iaW5kKHRoaXMsICdtb3VzZWRyYWdiZWdpbicpKTtcbn07XG5cbklucHV0LnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIHRoaXMubW91c2UudXNlKG5vZGUpO1xufTtcblxuSW5wdXQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMudGV4dC5mb2N1cygpO1xufTtcbiIsInZhciBFdmVudCA9IHJlcXVpcmUoJ2V2ZW50Jyk7XG52YXIgZGVib3VuY2UgPSByZXF1aXJlKCdkZWJvdW5jZScpO1xudmFyIFBvaW50ID0gcmVxdWlyZSgncG9pbnQnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3VzZTtcblxuZnVuY3Rpb24gTW91c2UoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5ub2RlID0gbnVsbDtcbiAgdGhpcy5jbGlja3MgPSAwO1xuICB0aGlzLnBvaW50ID0gbmV3IFBvaW50O1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmJpbmRFdmVudCgpO1xufVxuXG5Nb3VzZS5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5Nb3VzZS5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25tYXliZWRyYWcgPSB0aGlzLm9ubWF5YmVkcmFnLmJpbmQodGhpcyk7XG4gIHRoaXMub25kcmFnID0gdGhpcy5vbmRyYWcuYmluZCh0aGlzKTtcbiAgdGhpcy5vbmRvd24gPSB0aGlzLm9uZG93bi5iaW5kKHRoaXMpO1xuICB0aGlzLm9udXAgPSB0aGlzLm9udXAuYmluZCh0aGlzKTtcbiAgZG9jdW1lbnQuYm9keS5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgdGhpcy5vbnVwKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS51c2UgPSBmdW5jdGlvbihub2RlKSB7XG4gIGlmICh0aGlzLm5vZGUpIHtcbiAgICBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIHRoaXMub25kb3duKTtcbiAgfVxuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgdGhpcy5vbmRvd24pO1xufTtcblxuTW91c2UucHJvdG90eXBlLm9uZG93biA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZG93biA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZG93bicsIGUpO1xuICB0aGlzLm9uY2xpY2soZSk7XG4gIHRoaXMubWF5YmVEcmFnKCk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub251cCA9IGZ1bmN0aW9uKGUpIHtcbiAgaWYgKCF0aGlzLmRvd24pIHJldHVybjtcbiAgdGhpcy5lbWl0KCd1cCcsIGUpO1xuICB0aGlzLmRvd24gPSBudWxsO1xuICB0aGlzLmRyYWdFbmQoKTtcbiAgdGhpcy5tYXliZURyYWdFbmQoKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5vbmNsaWNrID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnJlc2V0Q2xpY2tzKCk7XG4gIHRoaXMuY2xpY2tzID0gKHRoaXMuY2xpY2tzICUgMykgKyAxO1xuICB0aGlzLmVtaXQoJ2NsaWNrJywgZSk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUub25tYXliZWRyYWcgPSBmdW5jdGlvbihlKSB7XG4gIHRoaXMucG9pbnQgPSB0aGlzLmdldFBvaW50KGUpO1xuXG4gIHZhciBkID1cbiAgICAgIE1hdGguYWJzKHRoaXMucG9pbnQueCAtIHRoaXMuZG93bi54KVxuICAgICsgTWF0aC5hYnModGhpcy5wb2ludC55IC0gdGhpcy5kb3duLnkpO1xuXG4gIGlmIChkID4gNSkge1xuICAgIHRoaXMubWF5YmVEcmFnRW5kKCk7XG4gICAgdGhpcy5kcmFnQmVnaW4oKTtcbiAgfVxufTtcblxuTW91c2UucHJvdG90eXBlLm9uZHJhZyA9IGZ1bmN0aW9uKGUpIHtcbiAgdGhpcy5wb2ludCA9IHRoaXMuZ2V0UG9pbnQoZSk7XG4gIHRoaXMuZW1pdCgnZHJhZycsIGUpO1xufTtcblxuTW91c2UucHJvdG90eXBlLm1heWJlRHJhZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbm1heWJlZHJhZyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUubWF5YmVEcmFnRW5kID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMubm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZW1vdmUnLCB0aGlzLm9ubWF5YmVkcmFnKTtcbn07XG5cbk1vdXNlLnByb3RvdHlwZS5kcmFnQmVnaW4gPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5ub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIHRoaXMub25kcmFnKTtcbiAgdGhpcy5lbWl0KCdkcmFnIGJlZ2luJyk7XG59O1xuXG5Nb3VzZS5wcm90b3R5cGUuZHJhZ0VuZCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLm5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbmRyYWcpO1xuICB0aGlzLmVtaXQoJ2RyYWcgZW5kJyk7XG59O1xuXG5cbk1vdXNlLnByb3RvdHlwZS5yZXNldENsaWNrcyA9IGRlYm91bmNlKGZ1bmN0aW9uKCkge1xuICB0aGlzLmNsaWNrcyA9IDA7XG59LCAzNTApO1xuXG5Nb3VzZS5wcm90b3R5cGUuZ2V0UG9pbnQgPSBmdW5jdGlvbihlKSB7XG4gIHJldHVybiBuZXcgUG9pbnQoe1xuICAgIHg6IGUuY2xpZW50WCxcbiAgICB5OiBlLmNsaWVudFlcbiAgfSk7XG59O1xuIiwidmFyIGRvbSA9IHJlcXVpcmUoJ2RvbScpO1xudmFyIGRlYm91bmNlID0gcmVxdWlyZSgnZGVib3VuY2UnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJ2V2ZW50Jyk7XG5cbnZhciBUSFJPVFRMRSA9IDEwMDAvNjA7XG5cbnZhciBtYXAgPSB7XG4gIDg6ICdiYWNrc3BhY2UnLFxuICA5OiAndGFiJyxcbiAgMzM6ICdwYWdldXAnLFxuICAzNDogJ3BhZ2Vkb3duJyxcbiAgMzU6ICdlbmQnLFxuICAzNjogJ2hvbWUnLFxuICAzNzogJ2xlZnQnLFxuICAzODogJ3VwJyxcbiAgMzk6ICdyaWdodCcsXG4gIDQwOiAnZG93bicsXG4gIDQ2OiAnZGVsZXRlJyxcbiAgNjU6ICdhJyxcbiAgNjg6ICdkJyxcbiAgNzA6ICdmJyxcbiAgNzc6ICdtJyxcbiAgNzg6ICduJyxcbiAgODM6ICdzJyxcbiAgODk6ICd5JyxcbiAgOTA6ICd6JyxcbiAgMTE0OiAnZjMnLFxuICAxOTE6ICcvJyxcblxuICAvLyBudW1wYWRcbiAgOTc6ICdlbmQnLFxuICA5ODogJ2Rvd24nLFxuICA5OTogJ3BhZ2Vkb3duJyxcbiAgMTAwOiAnbGVmdCcsXG4gIDEwMjogJ3JpZ2h0JyxcbiAgMTAzOiAnaG9tZScsXG4gIDEwNDogJ3VwJyxcbiAgMTA1OiAncGFnZXVwJyxcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVGV4dDtcblxuVGV4dC5tYXAgPSBtYXA7XG5cbmZ1bmN0aW9uIFRleHQoKSB7XG4gIEV2ZW50LmNhbGwodGhpcyk7XG5cbiAgdGhpcy5ub2RlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGV4dGFyZWEnKTtcblxuICBkb20uc3R5bGUodGhpcywge1xuICAgIHBvc2l0aW9uOiAnYWJzb2x1dGUnLFxuICAgIGxlZnQ6IDAsXG4gICAgdG9wOiAwLFxuICAgIHdpZHRoOiAxLFxuICAgIGhlaWdodDogMSxcbiAgICBvcGFjaXR5OiAwXG4gIH0pO1xuXG4gIGRvbS5hdHRycyh0aGlzLCB7XG4gICAgYXV0b2NhcGl0YWxpemU6ICdub25lJ1xuICB9KTtcblxuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG4gIHRoaXMubW9kaWZpZXJzID0ge307XG4gIHRoaXMuYmluZEV2ZW50KCk7XG59XG5cblRleHQucHJvdG90eXBlLl9fcHJvdG9fXyA9IEV2ZW50LnByb3RvdHlwZTtcblxuVGV4dC5wcm90b3R5cGUuYmluZEV2ZW50ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMub25jdXQgPSB0aGlzLm9uY3V0LmJpbmQodGhpcyk7XG4gIHRoaXMub25jb3B5ID0gdGhpcy5vbmNvcHkuYmluZCh0aGlzKTtcbiAgdGhpcy5vbnBhc3RlID0gdGhpcy5vbnBhc3RlLmJpbmQodGhpcyk7XG4gIHRoaXMub25pbnB1dCA9IHRoaXMub25pbnB1dC5iaW5kKHRoaXMpO1xuICB0aGlzLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duLmJpbmQodGhpcyk7XG4gIHRoaXMub25rZXl1cCA9IHRoaXMub25rZXl1cC5iaW5kKHRoaXMpO1xuICB0aGlzLm5vZGUub25pbnB1dCA9IHRoaXMub25pbnB1dDtcbiAgdGhpcy5ub2RlLm9ua2V5ZG93biA9IHRoaXMub25rZXlkb3duO1xuICB0aGlzLm5vZGUub25rZXl1cCA9IHRoaXMub25rZXl1cDtcbiAgdGhpcy5ub2RlLm9uY3V0ID0gdGhpcy5vbmN1dDtcbiAgdGhpcy5ub2RlLm9uY29weSA9IHRoaXMub25jb3B5O1xuICB0aGlzLm5vZGUub25wYXN0ZSA9IHRoaXMub25wYXN0ZTtcbn07XG5cblRleHQucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5ub2RlLnZhbHVlLnN1YnN0cigtMSk7XG59O1xuXG5UZXh0LnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbih2YWx1ZSkge1xuICB0aGlzLm5vZGUudmFsdWUgPSB2YWx1ZTtcbn07XG5cbi8vVE9ETzogb24gbW9iaWxlIHdlIG5lZWQgdG8gY2xlYXIgd2l0aG91dCBkZWJvdW5jZVxuLy8gb3IgdGhlIHRleHRhcmVhIGNvbnRlbnQgaXMgZGlzcGxheWVkIGluIGhhY2tlcidzIGtleWJvYXJkXG4vLyBvciB5b3UgbmVlZCB0byBkaXNhYmxlIHdvcmQgc3VnZ2VzdGlvbnMgaW4gaGFja2VyJ3Mga2V5Ym9hcmQgc2V0dGluZ3NcblRleHQucHJvdG90eXBlLmNsZWFyID0gZGVib3VuY2UoZnVuY3Rpb24oKSB7XG4gIHRoaXMuc2V0KCcnKTtcbn0sIDEwICogMTAwMCk7XG5cblRleHQucHJvdG90eXBlLmZvY3VzID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNvbnNvbGUubG9nKCdmb2N1cycpXG4gIHRoaXMubm9kZS5mb2N1cygpO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25pbnB1dCA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAvLyBmb3JjZXMgY2FyZXQgdG8gZW5kIG9mIHRleHRhcmVhIHNvIHdlIGNhbiBnZXQgLnNsaWNlKC0xKSBjaGFyXG4gIHNldEltbWVkaWF0ZSgoKSA9PiB0aGlzLm5vZGUuc2VsZWN0aW9uU3RhcnQgPSB0aGlzLm5vZGUudmFsdWUubGVuZ3RoKTtcbiAgdGhpcy5lbWl0KCd0ZXh0JywgdGhpcy5nZXQoKSk7XG4gIHRoaXMuY2xlYXIoKTtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuVGV4dC5wcm90b3R5cGUub25rZXlkb3duID0gZnVuY3Rpb24oZSkge1xuICAvLyBjb25zb2xlLmxvZyhlLndoaWNoKTtcbiAgdmFyIG5vdyA9IERhdGUubm93KCk7XG4gIGlmIChub3cgLSB0aGlzLnRocm90dGxlVGltZSA8IFRIUk9UVExFKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICB0aGlzLnRocm90dGxlVGltZSA9IG5vdztcblxuICB2YXIgbSA9IHRoaXMubW9kaWZpZXJzO1xuICBtLnNoaWZ0ID0gZS5zaGlmdEtleTtcbiAgbS5jdHJsID0gZS5jdHJsS2V5O1xuICBtLmFsdCA9IGUuYWx0S2V5O1xuXG4gIHZhciBrZXlzID0gW107XG4gIGlmIChtLnNoaWZ0KSBrZXlzLnB1c2goJ3NoaWZ0Jyk7XG4gIGlmIChtLmN0cmwpIGtleXMucHVzaCgnY3RybCcpO1xuICBpZiAobS5hbHQpIGtleXMucHVzaCgnYWx0Jyk7XG4gIGlmIChlLndoaWNoIGluIG1hcCkga2V5cy5wdXNoKG1hcFtlLndoaWNoXSk7XG5cbiAgaWYgKGtleXMubGVuZ3RoKSB7XG4gICAgdmFyIHByZXNzID0ga2V5cy5qb2luKCcrJyk7XG4gICAgdGhpcy5lbWl0KCdrZXlzJywgcHJlc3MsIGUpO1xuICAgIHRoaXMuZW1pdChwcmVzcywgZSk7XG4gICAga2V5cy5mb3JFYWNoKChwcmVzcykgPT4gdGhpcy5lbWl0KCdrZXknLCBwcmVzcywgZSkpO1xuICB9XG59O1xuXG5UZXh0LnByb3RvdHlwZS5vbmtleXVwID0gZnVuY3Rpb24oZSkge1xuICB0aGlzLnRocm90dGxlVGltZSA9IDA7XG5cbiAgdmFyIG0gPSB0aGlzLm1vZGlmaWVycztcblxuICB2YXIga2V5cyA9IFtdO1xuICBpZiAobS5zaGlmdCAmJiAhZS5zaGlmdEtleSkga2V5cy5wdXNoKCdzaGlmdDp1cCcpO1xuICBpZiAobS5jdHJsICYmICFlLmN0cmxLZXkpIGtleXMucHVzaCgnY3RybDp1cCcpO1xuICBpZiAobS5hbHQgJiYgIWUuYWx0S2V5KSBrZXlzLnB1c2goJ2FsdDp1cCcpO1xuXG4gIG0uc2hpZnQgPSBlLnNoaWZ0S2V5O1xuICBtLmN0cmwgPSBlLmN0cmxLZXk7XG4gIG0uYWx0ID0gZS5hbHRLZXk7XG5cbiAgaWYgKG0uc2hpZnQpIGtleXMucHVzaCgnc2hpZnQnKTtcbiAgaWYgKG0uY3RybCkga2V5cy5wdXNoKCdjdHJsJyk7XG4gIGlmIChtLmFsdCkga2V5cy5wdXNoKCdhbHQnKTtcbiAgaWYgKGUud2hpY2ggaW4gbWFwKSBrZXlzLnB1c2gobWFwW2Uud2hpY2hdICsgJzp1cCcpO1xuXG4gIGlmIChrZXlzLmxlbmd0aCkge1xuICAgIHZhciBwcmVzcyA9IGtleXMuam9pbignKycpO1xuICAgIHRoaXMuZW1pdCgna2V5cycsIHByZXNzLCBlKTtcbiAgICB0aGlzLmVtaXQocHJlc3MsIGUpO1xuICAgIGtleXMuZm9yRWFjaCgocHJlc3MpID0+IHRoaXMuZW1pdCgna2V5JywgcHJlc3MsIGUpKTtcbiAgfVxufTtcblxuVGV4dC5wcm90b3R5cGUub25jdXQgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdjdXQnLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9uY29weSA9IGZ1bmN0aW9uKGUpIHtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICB0aGlzLmVtaXQoJ2NvcHknLCBlKTtcbn07XG5cblRleHQucHJvdG90eXBlLm9ucGFzdGUgPSBmdW5jdGlvbihlKSB7XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgdGhpcy5lbWl0KCdwYXN0ZScsIGUpO1xufTtcbiIsInZhciBSZWdleHAgPSByZXF1aXJlKCdyZWdleHAnKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJ2V2ZW50Jyk7XG52YXIgUG9pbnQgPSByZXF1aXJlKCdwb2ludCcpO1xuXG52YXIgV09SRFMgPSBSZWdleHAuY3JlYXRlKFsnd29yZHMnXSwgJ2cnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNb3ZlO1xuXG5mdW5jdGlvbiBNb3ZlKGVkaXRvcikge1xuICBFdmVudC5jYWxsKHRoaXMpO1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSAwO1xufVxuXG5Nb3ZlLnByb3RvdHlwZS5fX3Byb3RvX18gPSBFdmVudC5wcm90b3R5cGU7XG5cbk1vdmUucHJvdG90eXBlLnBhZ2VEb3duID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIHNpemUgLSByZW1haW5kZXIpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKHBhZ2UpO1xufTtcblxuTW92ZS5wcm90b3R5cGUucGFnZVVwID0gZnVuY3Rpb24oZGl2KSB7XG4gIGRpdiA9IGRpdiB8fCAxO1xuICB2YXIgcGFnZSA9IHRoaXMuZWRpdG9yLnBhZ2UuaGVpZ2h0IC8gZGl2IHwgMDtcbiAgdmFyIHNpemUgPSB0aGlzLmVkaXRvci5zaXplLmhlaWdodCAvIGRpdiB8IDA7XG4gIHZhciByZW1haW5kZXIgPSBzaXplIC0gcGFnZSAqIHRoaXMuZWRpdG9yLmNoYXIuaGVpZ2h0IHwgMDtcbiAgdGhpcy5lZGl0b3IuYW5pbWF0ZVNjcm9sbEJ5KDAsIC0oc2l6ZSAtIHJlbWFpbmRlcikpO1xuICByZXR1cm4gdGhpcy5ieUxpbmVzKC1wYWdlKTtcbn07XG5cbnZhciBtb3ZlID0ge307XG5cbm1vdmUuYnlXb3JkID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeCkge1xuICB2YXIgbGluZSA9IGJ1ZmZlci5nZXRMaW5lKHAueSk7XG5cbiAgaWYgKGR4ID4gMCAmJiBwLnggPj0gbGluZS5sZW5ndGggLSAxKSB7IC8vIGF0IGVuZCBvZiBsaW5lXG4gICAgcmV0dXJuIG1vdmUuYnlDaGFycyhidWZmZXIsIHAsICsxKTsgLy8gbW92ZSBvbmUgY2hhciByaWdodFxuICB9IGVsc2UgaWYgKGR4IDwgMCAmJiBwLnggPT09IDApIHsgLy8gYXQgYmVnaW4gb2YgbGluZVxuICAgIHJldHVybiBtb3ZlLmJ5Q2hhcnMoYnVmZmVyLCBwLCAtMSk7IC8vIG1vdmUgb25lIGNoYXIgbGVmdFxuICB9XG5cbiAgdmFyIHdvcmRzID0gUmVnZXhwLnBhcnNlKGxpbmUsIFdPUkRTKTtcbiAgdmFyIHdvcmQ7XG5cbiAgaWYgKGR4IDwgMCkgd29yZHMucmV2ZXJzZSgpO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgd29yZHMubGVuZ3RoOyBpKyspIHtcbiAgICB3b3JkID0gd29yZHNbaV07XG4gICAgaWYgKGR4ID4gMFxuICAgICAgPyB3b3JkLmluZGV4ID4gcC54XG4gICAgICA6IHdvcmQuaW5kZXggPCBwLngpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHg6IHdvcmQuaW5kZXgsXG4gICAgICAgIHk6IHAueVxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyByZWFjaGVkIGJlZ2luL2VuZCBvZiBmaWxlXG4gIHJldHVybiBkeCA+IDBcbiAgICA/IG1vdmUuZW5kT2ZMaW5lKGJ1ZmZlciwgcClcbiAgICA6IG1vdmUuYmVnaW5PZkxpbmUoYnVmZmVyLCBwKTtcbn07XG5cbm1vdmUuYnlDaGFycyA9IGZ1bmN0aW9uKGJ1ZmZlciwgcCwgZHgpIHtcbiAgdmFyIGxpbmVzID0gYnVmZmVyLmxpbmVzO1xuICB2YXIgeCA9IHAueDtcbiAgdmFyIHkgPSBwLnk7XG5cbiAgaWYgKGR4IDwgMCkgeyAvLyBnb2luZyBsZWZ0XG4gICAgeCArPSBkeDsgLy8gbW92ZSBsZWZ0XG4gICAgaWYgKHggPCAwKSB7IC8vIHdoZW4gcGFzdCBsZWZ0IGVkZ2VcbiAgICAgIGlmICh5ID4gMCkgeyAvLyBhbmQgbGluZXMgYWJvdmVcbiAgICAgICAgeSAtPSAxOyAvLyBtb3ZlIHVwIGEgbGluZVxuICAgICAgICB4ID0gbGluZXMuZ2V0TGluZUxlbmd0aCh5KTsgLy8gYW5kIGdvIHRvIHRoZSBlbmQgb2YgbGluZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeCA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKGR4ID4gMCkgeyAvLyBnb2luZyByaWdodFxuICAgIHggKz0gZHg7IC8vIG1vdmUgcmlnaHRcbiAgICB3aGlsZSAoeCAtIGxpbmVzLmdldExpbmVMZW5ndGgoeSkgPiAwKSB7IC8vIHdoaWxlIHBhc3QgbGluZSBsZW5ndGhcbiAgICAgIGlmICh5ID09PSBsaW5lcy5sZW5ndGgpIHsgLy8gb24gZW5kIG9mIGZpbGVcbiAgICAgICAgeCA9IGxpbmVzLmdldExpbmVMZW5ndGgoeSk7IC8vIGdvIHRvIGVuZCBvZiBsaW5lIG9uIGxhc3QgbGluZVxuICAgICAgICBicmVhazsgLy8gYW5kIGV4aXRcbiAgICAgIH1cbiAgICAgIHggLT0gbGluZXMuZ2V0TGluZUxlbmd0aCh5KSArIDE7IC8vIHdyYXAgdGhpcyBsaW5lIGxlbmd0aFxuICAgICAgeSArPSAxOyAvLyBhbmQgbW92ZSBkb3duIGEgbGluZVxuICAgIH1cbiAgfVxuXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcblxuICByZXR1cm4ge1xuICAgIHg6IHgsXG4gICAgeTogeVxuICB9O1xufTtcblxubW92ZS5ieUxpbmVzID0gZnVuY3Rpb24oYnVmZmVyLCBwLCBkeSkge1xuICB2YXIgbGluZXMgPSBidWZmZXIubGluZXM7XG4gIHZhciB4ID0gcC54O1xuICB2YXIgeSA9IHAueTtcblxuICBpZiAoZHkgPCAwKSB7IC8vIGdvaW5nIHVwXG4gICAgaWYgKHkgKyBkeSA+IDApIHsgLy8gd2hlbiBsaW5lcyBhYm92ZVxuICAgICAgeSArPSBkeTsgLy8gbW92ZSB1cFxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gMDtcbiAgICB9XG4gIH0gZWxzZSBpZiAoZHkgPiAwKSB7IC8vIGdvaW5nIGRvd25cbiAgICBpZiAoeSA8IGxpbmVzLmxlbmd0aCAtIGR5KSB7IC8vIHdoZW4gbGluZXMgYmVsb3dcbiAgICAgIHkgKz0gZHk7IC8vIG1vdmUgZG93blxuICAgIH0gZWxzZSB7XG4gICAgICB5ID0gbGluZXMubGVuZ3RoO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmICh4ID4gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGgpIHtcbiAgLy8gICB4ID0gbGluZXMuZ2V0TGluZSh5KS5sZW5ndGg7XG4gIC8vIH0gZWxzZSB7XG4gIC8vIH1cbiAgeCA9IE1hdGgubWluKHRoaXMubGFzdERlbGliZXJhdGVYLCBsaW5lcy5nZXRMaW5lKHkpLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHlcbiAgfTtcbn07XG5cbm1vdmUuYmVnaW5PZkxpbmUgPSBmdW5jdGlvbihfLCBwKSB7XG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0gMDtcbiAgcmV0dXJuIHtcbiAgICB4OiAwLFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5lbmRPZkxpbmUgPSBmdW5jdGlvbihidWZmZXIsIHApIHtcbiAgdmFyIHggPSBidWZmZXIubGluZXMuZ2V0TGluZShwLnkpLmxlbmd0aDtcbiAgdGhpcy5sYXN0RGVsaWJlcmF0ZVggPSBJbmZpbml0eTtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IHAueVxuICB9O1xufTtcblxubW92ZS5iZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmxhc3REZWxpYmVyYXRlWCA9IDA7XG4gIHJldHVybiB7XG4gICAgeDogMCxcbiAgICB5OiAwXG4gIH07XG59O1xuXG5tb3ZlLmVuZE9mRmlsZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICB2YXIgbGFzdCA9IGJ1ZmZlci5saW5lcy5sZW5ndGg7XG4gIHZhciB4ID0gYnVmZmVyLmxpbmVzLmdldExpbmUobGFzdCkubGVuZ3RoXG4gIHRoaXMubGFzdERlbGliZXJhdGVYID0geDtcbiAgcmV0dXJuIHtcbiAgICB4OiB4LFxuICAgIHk6IGxhc3RcbiAgfTtcbn07XG5cbm1vdmUuaXNCZWdpbk9mRmlsZSA9IGZ1bmN0aW9uKF8sIHApIHtcbiAgcmV0dXJuIHAueCA9PT0gMCAmJiBwLnkgPT09IDA7XG59O1xuXG5tb3ZlLmlzRW5kT2ZGaWxlID0gZnVuY3Rpb24oYnVmZmVyLCBwKSB7XG4gIHZhciBsYXN0ID0gYnVmZmVyLmxvYztcbiAgcmV0dXJuIHAueSA9PT0gbGFzdCAmJiBwLnggPT09IGJ1ZmZlci5saW5lcy5nZXRMaW5lTGVuZ3RoKGxhc3QpO1xufTtcblxuT2JqZWN0LmtleXMobW92ZSkuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgTW92ZS5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKHBhcmFtLCBieUVkaXQpIHtcbiAgICB2YXIgcmVzdWx0ID0gbW92ZVttZXRob2RdLmNhbGwoXG4gICAgICB0aGlzLFxuICAgICAgdGhpcy5lZGl0b3IuYnVmZmVyLFxuICAgICAgdGhpcy5lZGl0b3IuY2FyZXQsXG4gICAgICBwYXJhbVxuICAgICk7XG5cbiAgICBpZiAoJ2lzJyA9PT0gbWV0aG9kLnNsaWNlKDAsMikpIHJldHVybiByZXN1bHQ7XG5cbiAgICB0aGlzLmVtaXQoJ21vdmUnLCByZXN1bHQsIGJ5RWRpdCk7XG4gIH07XG59KTtcbiIsInZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBCbG9jaztcblxuZnVuY3Rpb24gQmxvY2sobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDEpO1xufVxuXG5CbG9jay5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5CbG9jay5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMucmVuZGVyUGFnZSgxLCB0cnVlKTtcbn07XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnZG9tJyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCdyYW5nZScpO1xudmFyIExheWVyID0gcmVxdWlyZSgnLi9sYXllcicpO1xudmFyIHRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENvZGU7XG5cbmZ1bmN0aW9uIENvZGUobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSkge1xuICBMYXllci5jYWxsKHRoaXMsIG5hbWUsIGVkaXRvciwgdGVtcGxhdGUsIDUwKTtcbn1cblxuQ29kZS5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5Db2RlLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGxheWVyID0gdGhpcztcbiAgdmFyIHZpZXdzID0gdGhpcy52aWV3cztcbiAgdmFyIGUgPSB0aGlzLmVkaXRvcjtcblxuICAvLyB0aGlzLmNsZWFyKCk7XG4gIC8vIHJldHVybiB0aGlzLnJlbmRlclBhZ2UoMCwgdHJ1ZSk7XG4gIGlmICghZS5lZGl0aW5nKSByZXR1cm4gdGhpcy5yZW5kZXJBaGVhZCgpO1xuXG4gIHZhciB5ID0gZS5lZGl0TGluZTtcbiAgdmFyIGcgPSBlLmVkaXRSYW5nZS5zbGljZSgpO1xuICB2YXIgc2hpZnQgPSBlLmVkaXRTaGlmdDtcbiAgdmFyIGlzRW50ZXIgPSBzaGlmdCA+IDA7XG4gIHZhciBpc0JhY2tzcGFjZSA9IHNoaWZ0IDwgMDtcbiAgdmFyIGlzQmVnaW4gPSBnWzBdICsgaXNCYWNrc3BhY2UgPT09IDA7XG4gIHZhciBpc0VuZCA9IGdbMV0gKyBpc0VudGVyID09PSBlLnJvd3M7XG5cbiAgaWYgKHNoaWZ0KSB7XG4gICAgaWYgKGlzRW50ZXIgJiYgIWlzRW5kKSB0aGlzLnNoaWZ0Vmlld3NCZWxvdyhnWzBdLCBzaGlmdCk7XG4gICAgZWxzZSBpZiAoaXNCYWNrc3BhY2UgJiYgIWlzQmVnaW4pIHRoaXMuc2hpZnRWaWV3c0JlbG93KGdbMF0sIHNoaWZ0KTtcbiAgfVxuXG4gIHRoaXMudXBkYXRlUmFuZ2UoZyk7XG4gIHRoaXMucmVuZGVyUGFnZSgwKTtcbn07XG4iLCJ2YXIgTGF5ZXIgPSByZXF1aXJlKCcuL2xheWVyJyk7XG52YXIgdGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRmluZDtcblxuZnVuY3Rpb24gRmluZChuYW1lLCBlZGl0b3IsIHRlbXBsYXRlKSB7XG4gIExheWVyLmNhbGwodGhpcywgbmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgNCk7XG59XG5cbkZpbmQucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuRmluZC5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5lZGl0b3IuZmluZC5pc09wZW4gfHwgIXRoaXMuZWRpdG9yLmZpbmRSZXN1bHRzLmxlbmd0aCkgcmV0dXJuO1xuICB0aGlzLnJlbmRlclBhZ2UoMCk7XG59O1xuIiwidmFyIGRlYm91bmNlID0gcmVxdWlyZSgnZGVib3VuY2UnKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcbnZhciBDb2RlVmlldyA9IHJlcXVpcmUoJy4vY29kZScpO1xudmFyIE1hcmtWaWV3ID0gcmVxdWlyZSgnLi9tYXJrJyk7XG52YXIgUm93c1ZpZXcgPSByZXF1aXJlKCcuL3Jvd3MnKTtcbnZhciBGaW5kVmlldyA9IHJlcXVpcmUoJy4vZmluZCcpO1xudmFyIEJsb2NrVmlldyA9IHJlcXVpcmUoJy4vYmxvY2snKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVmlld3M7XG5cbmZ1bmN0aW9uIFZpZXdzKGVkaXRvcikge1xuICB0aGlzLmVkaXRvciA9IGVkaXRvcjtcblxuICB0aGlzLnZpZXdzID0gW1xuICAgIG5ldyBWaWV3KCdydWxlcicsIGVkaXRvciwgdGVtcGxhdGUucnVsZXIpLFxuICAgIG5ldyBWaWV3KCdjYXJldCcsIGVkaXRvciwgdGVtcGxhdGUuY2FyZXQpLFxuICAgIG5ldyBDb2RlVmlldygnY29kZScsIGVkaXRvciwgdGVtcGxhdGUuY29kZSksXG4gICAgbmV3IE1hcmtWaWV3KCdtYXJrJywgZWRpdG9yLCB0ZW1wbGF0ZS5tYXJrKSxcbiAgICBuZXcgUm93c1ZpZXcoJ3Jvd3MnLCBlZGl0b3IsIHRlbXBsYXRlLnJvd3MpLFxuICAgIG5ldyBGaW5kVmlldygnZmluZCcsIGVkaXRvciwgdGVtcGxhdGUuZmluZCksXG4gICAgbmV3IEJsb2NrVmlldygnYmxvY2snLCBlZGl0b3IsIHRlbXBsYXRlLmJsb2NrKSxcbiAgXTtcblxuICB0aGlzLnZpZXdzLmZvckVhY2godmlldyA9PiB0aGlzW3ZpZXcubmFtZV0gPSB2aWV3KTtcbiAgdGhpcy5mb3JFYWNoID0gdGhpcy52aWV3cy5mb3JFYWNoLmJpbmQodGhpcy52aWV3cyk7XG5cbiAgdGhpcy5ibG9jay5yZW5kZXIgPSBkZWJvdW5jZSh0aGlzLmJsb2NrLnJlbmRlciwgNjApO1xuXG4gIGlmICh0aGlzLmVkaXRvci5vcHRpb25zLmhpZGVfcm93cykgdGhpcy5yb3dzLnJlbmRlciA9IG5vb3A7XG59XG5cblZpZXdzLnByb3RvdHlwZS5jbGVhciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LmNsZWFyKCkpO1xufSxcblxuVmlld3MucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLmZvckVhY2godmlldyA9PiB2aWV3LnJlbmRlcigpKTtcbn07XG5cbmZ1bmN0aW9uIG5vb3AoKSB7Lyogbm9vcCAqL31cbiIsInZhciBkb20gPSByZXF1aXJlKCdkb20nKTtcbnZhciBFdmVudCA9IHJlcXVpcmUoJ2V2ZW50Jyk7XG52YXIgUmFuZ2UgPSByZXF1aXJlKCdyYW5nZScpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBMYXllcjtcblxuZnVuY3Rpb24gTGF5ZXIobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSwgbGVuZ3RoKSB7XG4gIHRoaXMuZG9tID0gZG9tKG5hbWUgKyAnIGxheWVyJyk7XG4gIHRoaXMubmFtZSA9IG5hbWU7XG4gIHRoaXMuZWRpdG9yID0gZWRpdG9yO1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG4gIHRoaXMudmlld3MgPSB0aGlzLmNyZWF0ZShsZW5ndGgpO1xufVxuXG5MYXllci5wcm90b3R5cGUuX19wcm90b19fID0gRXZlbnQucHJvdG90eXBlO1xuXG5MYXllci5wcm90b3R5cGUuY3JlYXRlID0gZnVuY3Rpb24obGVuZ3RoKSB7XG4gIHZhciB2aWV3cyA9IG5ldyBBcnJheShsZW5ndGgpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmlld3NbaV0gPSBuZXcgVmlldyh0aGlzLm5hbWUsIHRoaXMuZWRpdG9yLCB0aGlzLnRlbXBsYXRlKTtcbiAgICBkb20uYXBwZW5kKHRoaXMsIHZpZXdzW2ldKTtcbiAgfVxuICByZXR1cm4gdmlld3M7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVxdWVzdFZpZXcgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICh2aWV3LnZpc2libGUgPT09IGZhbHNlKSByZXR1cm4gdmlldztcbiAgfVxuICByZXR1cm4gdGhpcy5jbGVhcigpWzBdO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLmdldFBhZ2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHJldHVybiB0aGlzLmVkaXRvci5nZXRQYWdlUmFuZ2UocmFuZ2UpO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLmluUmFuZ2VWaWV3cyA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIHZhciB2aWV3cyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudmlld3MubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmlldyA9IHRoaXMudmlld3NbaV07XG4gICAgaWYgKCB2aWV3LnZpc2libGUgPT09IHRydWVcbiAgICAgICYmICggdmlld1swXSA+PSByYW5nZVswXSAmJiB2aWV3WzBdIDw9IHJhbmdlWzFdXG4gICAgICAgIHx8IHZpZXdbMV0gPj0gcmFuZ2VbMF0gJiYgdmlld1sxXSA8PSByYW5nZVsxXSApICkge1xuICAgICAgdmlld3MucHVzaCh2aWV3KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZpZXdzO1xufTtcblxuTGF5ZXIucHJvdG90eXBlLm91dFJhbmdlVmlld3MgPSBmdW5jdGlvbihyYW5nZSkge1xuICB2YXIgdmlld3MgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHZpZXcgPSB0aGlzLnZpZXdzW2ldO1xuICAgIGlmICggdmlldy52aXNpYmxlID09PSBmYWxzZVxuICAgICAgfHwgdmlld1sxXSA8IHJhbmdlWzBdXG4gICAgICB8fCB2aWV3WzBdID4gcmFuZ2VbMV0gKSB7XG4gICAgICB2aWV3cy5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmlld3Muc29ydCgoYSxiKSA9PiBhLmxhc3RVc2VkIC0gYi5sYXN0VXNlZCk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyUmFuZ2VzID0gZnVuY3Rpb24ocmFuZ2VzLCB2aWV3cykge1xuICBmb3IgKHZhciBuID0gMCwgaSA9IDA7IGkgPCByYW5nZXMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcmFuZ2UgPSByYW5nZXNbaV07XG4gICAgdmFyIHZpZXcgPSB2aWV3c1tuKytdO1xuICAgIHZpZXcucmVuZGVyKHJhbmdlKTtcbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnJlbmRlclJhbmdlID0gZnVuY3Rpb24ocmFuZ2UsIGluY2x1ZGUpIHtcbiAgdmFyIHZpc2libGVSYW5nZSA9IHRoaXMuZ2V0UGFnZVJhbmdlKFswLDBdKTtcbiAgdmFyIGluVmlld3MgPSB0aGlzLmluUmFuZ2VWaWV3cyhyYW5nZSk7XG4gIHZhciBvdXRWaWV3cyA9IHRoaXMub3V0UmFuZ2VWaWV3cyhtYXgocmFuZ2UsIHZpc2libGVSYW5nZSkpO1xuXG4gIHZhciBuZWVkUmFuZ2VzID0gUmFuZ2UuTk9UKHJhbmdlLCBpblZpZXdzKTtcbiAgdmFyIG5lZWRWaWV3cyA9IG5lZWRSYW5nZXMubGVuZ3RoIC0gb3V0Vmlld3MubGVuZ3RoO1xuICAvLyBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUpIGNvbnNvbGUubG9nKCduZWVkOicsIG5lZWRWaWV3cywgbmVlZFJhbmdlcy5qb2luKCcgJykpO1xuICAvLyBpZiAoJ2NvZGUnID09PSB0aGlzLm5hbWUpIGNvbnNvbGUubG9nKCdoYXZlOicsIHRoaXMudmlld3Muam9pbignICcpKTtcbiAgLy8gaWYgKCdjb2RlJyA9PT0gdGhpcy5uYW1lKSBjb25zb2xlLmxvZygnb3V0OicsIG91dFZpZXdzLmpvaW4oJyAnKSk7XG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgY29uc29sZS5sb2coJ3JhbmdlJywgcmFuZ2UsIGluVmlld3Muam9pbignICcpKTtcbiAgaWYgKG5lZWRWaWV3cyA+IDApIHtcbiAgICB0aGlzLmNsZWFyKCk7XG4gICAgdGhpcy5yZW5kZXJSYW5nZXMoW3Zpc2libGVSYW5nZV0sIHRoaXMudmlld3MpO1xuICAgIHJldHVybjtcbiAgfVxuICBlbHNlIGlmIChpbmNsdWRlKSB0aGlzLnJlbmRlclZpZXdzKGluVmlld3MpO1xuICB0aGlzLnJlbmRlclJhbmdlcyhuZWVkUmFuZ2VzLCBvdXRWaWV3cyk7XG59O1xuXG5MYXllci5wcm90b3R5cGUucmVuZGVyVmlld3MgPSBmdW5jdGlvbih2aWV3cykge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmlld3NbaV0ucmVuZGVyKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJMaW5lID0gZnVuY3Rpb24oeSkge1xuICB0aGlzLnJlbmRlclJhbmdlKFt5LHldLCB0cnVlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJQYWdlID0gZnVuY3Rpb24obiwgaW5jbHVkZSkge1xuICBuID0gbiB8fCAwO1xuICB0aGlzLnJlbmRlclJhbmdlKHRoaXMuZ2V0UGFnZVJhbmdlKFstbiwrbl0pLCBpbmNsdWRlKTtcbn07XG5cbkxheWVyLnByb3RvdHlwZS5yZW5kZXJBaGVhZCA9IGZ1bmN0aW9uKGluY2x1ZGUpIHtcbiAgdmFyIHZpZXdzID0gdGhpcy52aWV3cztcbiAgdmFyIGN1cnJlbnRQYWdlUmFuZ2UgPSB0aGlzLmdldFBhZ2VSYW5nZShbMCwwXSk7XG5cbiAgLy8gbm8gdmlldyBpcyB2aXNpYmxlLCByZW5kZXIgY3VycmVudCBwYWdlIG9ubHlcbiAgaWYgKFJhbmdlLkFORChjdXJyZW50UGFnZVJhbmdlLCB2aWV3cykubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5yZW5kZXJQYWdlKDApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIGNoZWNrIGlmIHdlJ3JlIHBhc3QgdGhlIHRocmVzaG9sZCBvZiB2aWV3XG4gIHZhciBhaGVhZFJhbmdlID0gdGhpcy5nZXRQYWdlUmFuZ2UoWy0uNSwrLjVdKTtcbiAgdmFyIGFoZWFkTmVlZFJhbmdlcyA9IFJhbmdlLk5PVChhaGVhZFJhbmdlLCB2aWV3cyk7XG4gIGlmIChhaGVhZE5lZWRSYW5nZXMubGVuZ3RoKSB7XG4gICAgLy8gaWYgc28sIHJlbmRlciBmdXJ0aGVyIGFoZWFkIHRvIGhhdmUgc29tZVxuICAgIC8vIG1hcmdpbiB0byBzY3JvbGwgd2l0aG91dCB0cmlnZ2VyaW5nIG5ldyByZW5kZXJzXG4gICAgdGhpcy5yZW5kZXJQYWdlKDEsIGluY2x1ZGUpO1xuICB9XG59O1xuXG4vKlxuXG4xICB4XG4yIC14XG4zIC14XG40IC1cbjVcbjZcblxuICovXG5cbkxheWVyLnByb3RvdHlwZS5zcGxpY2VSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICAvLyBkZWJ1Z2dlcjtcbiAgICBpZiAodmlld1sxXSA8IHJhbmdlWzBdIHx8IHZpZXdbMF0gPiByYW5nZVsxXSkgY29udGludWU7XG5cbiAgICBpZiAodmlld1swXSA8IHJhbmdlWzBdICYmIHZpZXdbMV0gPj0gcmFuZ2VbMF0pIHsgLy8gc2hvcnRlbiBiZWxvd1xuICAgICAgdmlld1sxXSA9IHJhbmdlWzBdIC0gMTtcbiAgICAgIHZpZXcuc3R5bGUoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMV0gPiByYW5nZVsxXSkgeyAvLyBzaG9ydGVuIGFib3ZlXG4gICAgICB2aWV3WzBdID0gcmFuZ2VbMV0gKyAxO1xuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHZpZXdbMF0gPT09IHJhbmdlWzBdICYmIHZpZXdbMV0gPT09IHJhbmdlWzFdKSB7IC8vIGN1cnJlbnQgbGluZVxuICAgICAgdmlldy5yZW5kZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmlldy5jbGVhcigpO1xuICAgIH1cbiAgfVxufTtcblxuTGF5ZXIucHJvdG90eXBlLnNoaWZ0Vmlld3NCZWxvdyA9IGZ1bmN0aW9uKHksIGR5KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgICBpZiAodmlld1swXSA8PSB5KSBjb250aW51ZTtcblxuICAgIHZpZXdbMF0gKz0gZHk7XG4gICAgdmlld1sxXSArPSBkeTtcbiAgICB2aWV3LnN0eWxlKCk7XG4gIH1cbn07XG5cbkxheWVyLnByb3RvdHlwZS51cGRhdGVSYW5nZSA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIC8vIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy52aWV3cy5sZW5ndGg7IGkrKykge1xuICAvLyAgIHZhciB2aWV3ID0gdGhpcy52aWV3c1tpXTtcbiAgLy8gICBpZiAodmlld1swXSA+PSByYW5nZVswXSAmJiB2aWV3WzFdIDw9IHJhbmdlWzFdKSB7XG4gIC8vICAgICB2aWV3LnJlbmRlcigpO1xuICAvLyAgIH1cbiAgLy8gfVxuICB0aGlzLnNwbGljZVJhbmdlKHJhbmdlKTtcbiAgdGhpcy5yZW5kZXJSYW5nZShyYW5nZSk7XG59O1xuXG5MYXllci5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy52aWV3c1tpXS5jbGVhcigpO1xuICB9XG4gIHJldHVybiB0aGlzLnZpZXdzO1xufTtcblxuZnVuY3Rpb24gbWF4KGEsIGIpIHtcbiAgcmV0dXJuIFtNYXRoLm1pbihhWzBdLCBiWzBdKSwgTWF0aC5tYXgoYVsxXSwgYlsxXSldO1xufVxuIiwidmFyIGRvbSA9IHJlcXVpcmUoJ2RvbScpO1xudmFyIFJhbmdlID0gcmVxdWlyZSgncmFuZ2UnKTtcbnZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBNYXJrO1xuXG5mdW5jdGlvbiBNYXJrKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCAxKTtcbn1cblxuTWFyay5wcm90b3R5cGUuX19wcm90b19fID0gTGF5ZXIucHJvdG90eXBlO1xuXG5NYXJrLnByb3RvdHlwZS5yZW5kZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmVkaXRvci5tYXJrLmFjdGl2ZSkgcmV0dXJuIHRoaXMuY2xlYXIoKTtcbiAgdGhpcy5yZW5kZXJQYWdlKDAsIHRydWUpO1xufTtcbiIsInZhciBMYXllciA9IHJlcXVpcmUoJy4vbGF5ZXInKTtcbnZhciB0ZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBSb3dzO1xuXG5mdW5jdGlvbiBSb3dzKG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgTGF5ZXIuY2FsbCh0aGlzLCBuYW1lLCBlZGl0b3IsIHRlbXBsYXRlLCAyMCk7XG59XG5cblJvd3MucHJvdG90eXBlLl9fcHJvdG9fXyA9IExheWVyLnByb3RvdHlwZTtcblxuUm93cy5wcm90b3R5cGUucmVuZGVyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmVkaXRvci5lZGl0U2hpZnQpIHtcbiAgICB2YXIgdmlld3MgPSB0aGlzLnZpZXdzO1xuICAgIHZhciByb3dzID0gdGhpcy5lZGl0b3Iucm93cztcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZpZXdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgdmlldyA9IHZpZXdzW2ldO1xuICAgICAgdmFyIHIgPSB2aWV3O1xuICAgICAgaWYgKCF2aWV3LnZpc2libGUpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAoclsxXSA+IHJvd3MpIHZpZXcuY2xlYXIoKTtcbiAgICB9XG4gIH1cbiAgdGhpcy5yZW5kZXJBaGVhZCgpO1xufTtcbiIsInZhciB0ZW1wbGF0ZSA9IGV4cG9ydHM7XG5cbnRlbXBsYXRlLmNvZGUgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICAvLyBpZiAodGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID09PSBjb2RlKSB7XG4gIC8vICAgcmV0dXJuIHRlbXBsYXRlLmNvZGUubWVtb2l6ZS5yZXN1bHQ7XG4gIC8vIH0gZWxzZSB7XG4gIC8vICAgdGVtcGxhdGUuY29kZS5tZW1vaXplLnBhcmFtID0gY29kZTtcbiAgLy8gICB0ZW1wbGF0ZS5jb2RlLm1lbW9pemUucmVzdWx0ID0gZmFsc2U7XG4gIC8vIH1cblxuICB2YXIgaHRtbCA9IGUuYnVmZmVyLmdldEhpZ2hsaWdodGVkKHJhbmdlKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbi8vIHNpbmdsZXRvbiBtZW1vaXplIGZvciBmYXN0IGxhc3QgcmVwZWF0aW5nIHZhbHVlXG50ZW1wbGF0ZS5jb2RlLm1lbW9pemUgPSB7XG4gIHBhcmFtOiAnJyxcbiAgcmVzdWx0OiAnJ1xufTtcblxudGVtcGxhdGUucm93cyA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBzID0gJyc7XG4gIGZvciAodmFyIGkgPSByYW5nZVswXTsgaSA8PSByYW5nZVsxXTsgaSsrKSB7XG4gICAgcyArPSAoaSArIDEpICsgJ1xcbic7XG4gIH1cbiAgcmV0dXJuIHM7XG59O1xuXG50ZW1wbGF0ZS5tYXJrID0gZnVuY3Rpb24ocmFuZ2UsIGUpIHtcbiAgdmFyIG1hcmsgPSBlLm1hcmsuZ2V0KCk7XG4gIGlmIChyYW5nZVswXSA+IG1hcmsuZW5kLnkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJhbmdlWzFdIDwgbWFyay5iZWdpbi55KSByZXR1cm4gZmFsc2U7XG5cbiAgdmFyIG9mZnNldCA9IGUuYnVmZmVyLmxpbmVzLmdldFJhbmdlKHJhbmdlKTtcbiAgdmFyIGFyZWEgPSBlLmJ1ZmZlci5saW5lcy5nZXRBcmVhT2Zmc2V0UmFuZ2UobWFyayk7XG4gIHZhciBjb2RlID0gZS5idWZmZXIudGV4dC5nZXRSYW5nZShvZmZzZXQpO1xuXG4gIGFyZWFbMF0gLT0gb2Zmc2V0WzBdO1xuICBhcmVhWzFdIC09IG9mZnNldFswXTtcblxuICB2YXIgYWJvdmUgPSBjb2RlLnN1YnN0cmluZygwLCBhcmVhWzBdKTtcbiAgdmFyIG1pZGRsZSA9IGNvZGUuc3Vic3RyaW5nKGFyZWFbMF0sIGFyZWFbMV0pO1xuICB2YXIgaHRtbCA9IGUuc3ludGF4LmVudGl0aWVzKGFib3ZlKSArICc8bWFyaz4nICsgZS5zeW50YXguZW50aXRpZXMobWlkZGxlKSArICc8L21hcms+JztcblxuICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXG4vZywgJyBcXG4nKTtcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmZpbmQgPSBmdW5jdGlvbihyYW5nZSwgZSkge1xuICB2YXIgcmVzdWx0cyA9IGUuZmluZFJlc3VsdHM7XG5cbiAgdmFyIGJlZ2luID0gMDtcbiAgdmFyIGVuZCA9IHJlc3VsdHMubGVuZ3RoO1xuICB2YXIgcHJldiA9IC0xO1xuICB2YXIgaSA9IC0xO1xuXG4gIGRvIHtcbiAgICBwcmV2ID0gaTtcbiAgICBpID0gYmVnaW4gKyAoZW5kIC0gYmVnaW4pIC8gMiB8IDA7XG4gICAgaWYgKHJlc3VsdHNbaV0ueSA8IHJhbmdlWzBdKSBiZWdpbiA9IGk7XG4gICAgZWxzZSBlbmQgPSBpO1xuICB9IHdoaWxlIChwcmV2ICE9PSBpKTtcblxuICB2YXIgd2lkdGggPSBlLmZpbmRWYWx1ZS5sZW5ndGggKiBlLmNoYXIud2lkdGggKyAncHgnO1xuXG4gIHZhciBodG1sID0gJyc7XG4gIHZhciByO1xuICB3aGlsZSAocmVzdWx0c1tpXSAmJiByZXN1bHRzW2ldLnkgPCByYW5nZVsxXSkge1xuICAgIHIgPSByZXN1bHRzW2krK107XG4gICAgaHRtbCArPSAnPGkgc3R5bGU9XCInXG4gICAgICAgICAgKyAnd2lkdGg6JyArIHdpZHRoICsgJzsnXG4gICAgICAgICAgKyAndG9wOicgKyAoci55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICAgICsgJ2xlZnQ6JyArIChyLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICAgICsgJ1wiPjwvaT4nO1xuICB9XG5cbiAgcmV0dXJuIGh0bWw7XG59O1xuXG50ZW1wbGF0ZS5maW5kLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIC8vXG59O1xuXG50ZW1wbGF0ZS5ibG9jayA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHZhciBvZmZzZXQgPSBlLmJ1ZmZlci5saW5lcy5nZXQocmFuZ2VbMF0pO1xuICB2YXIgdGFyZ2V0ID0gZS5idWZmZXIubGluZXMuZ2V0UG9pbnQoZS5jYXJldCkub2Zmc2V0O1xuICB2YXIgY29kZSA9IGUuYnVmZmVyLmdldChyYW5nZSk7XG4gIHZhciBpID0gdGFyZ2V0IC0gb2Zmc2V0O1xuICB2YXIgY2hhcjtcblxuICB2YXIgT3BlbiA9IHtcbiAgICAneyc6ICdjdXJseScsXG4gICAgJ1snOiAnc3F1YXJlJyxcbiAgICAnKCc6ICdwYXJlbnMnXG4gIH07XG5cbiAgdmFyIENsb3NlID0ge1xuICAgICd9JzogJ2N1cmx5JyxcbiAgICAnXSc6ICdzcXVhcmUnLFxuICAgICcpJzogJ3BhcmVucydcbiAgfTtcblxuICB2YXIgb3BlbjtcbiAgdmFyIGNsb3NlO1xuXG4gIHZhciBjb3VudCA9IDE7XG4gIGkgLT0gMTtcbiAgd2hpbGUgKGkgPiAwKSB7XG4gICAgY2hhciA9IGNvZGVbaV07XG4gICAgb3BlbiA9IE9wZW5bY2hhcl07XG4gICAgaWYgKENsb3NlW2NoYXJdKSBjb3VudCsrO1xuICAgIGlmIChvcGVuICYmICEtLWNvdW50KSBicmVhaztcbiAgICBpLS07XG4gIH1cblxuICBpZiAoIW9wZW4pIHJldHVybiAnICc7XG5cbiAgdmFyIGJlZ2luID0gZS5idWZmZXIubGluZXMuZ2V0T2Zmc2V0KGkgKyBvZmZzZXQpO1xuXG4gIGNvdW50ID0gMTtcbiAgaSArPSAxO1xuXG4gIHdoaWxlIChpIDwgY29kZS5sZW5ndGgpIHtcbiAgICBjaGFyID0gY29kZVtpXTtcbiAgICBjbG9zZSA9IENsb3NlW2NoYXJdO1xuICAgIGlmIChPcGVuW2NoYXJdID09PSBvcGVuKSBjb3VudCsrO1xuICAgIGlmIChvcGVuID09PSBjbG9zZSkgY291bnQtLTtcblxuICAgIGlmICghY291bnQpIGJyZWFrO1xuICAgIGkrKztcbiAgfVxuXG4gIGlmICghY2xvc2UpIHJldHVybiAnICc7XG5cbiAgdmFyIGVuZCA9IGUuYnVmZmVyLmxpbmVzLmdldE9mZnNldChpICsgb2Zmc2V0KTtcblxuICB2YXIgaHRtbCA9ICcnO1xuXG4gIGh0bWwgKz0gJzxpIHN0eWxlPVwiJ1xuICAgICAgICArICd3aWR0aDonICsgZS5jaGFyLndpZHRoICsgJ3B4OydcbiAgICAgICAgKyAndG9wOicgKyAoYmVnaW4ueSAqIGUuY2hhci5oZWlnaHQpICsgJ3B4OydcbiAgICAgICAgKyAnbGVmdDonICsgKGJlZ2luLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICBodG1sICs9ICc8aSBzdHlsZT1cIidcbiAgICAgICAgKyAnd2lkdGg6JyArIGUuY2hhci53aWR0aCArICdweDsnXG4gICAgICAgICsgJ3RvcDonICsgKGVuZC55ICogZS5jaGFyLmhlaWdodCkgKyAncHg7J1xuICAgICAgICArICdsZWZ0OicgKyAoZW5kLnggKiBlLmNoYXIud2lkdGggKyBlLmd1dHRlciArIGUub3B0aW9ucy5tYXJnaW5fbGVmdCkgKyAncHg7J1xuICAgICAgICArICdcIj48L2k+JztcblxuICByZXR1cm4gaHRtbDtcbn07XG5cbnRlbXBsYXRlLmJsb2NrLnN0eWxlID0gZnVuY3Rpb24oKSB7XG4gIC8vXG59O1xuXG50ZW1wbGF0ZS5tYXJrLnN0eWxlID1cbnRlbXBsYXRlLnJvd3Muc3R5bGUgPVxudGVtcGxhdGUuY29kZS5zdHlsZSA9IGZ1bmN0aW9uKHJhbmdlLCBlKSB7XG4gIHJldHVybiB7XG4gICAgdG9wOiByYW5nZVswXSAqIGUuY2hhci5oZWlnaHQsXG4gICAgaGVpZ2h0OiAocmFuZ2VbMV0gLSByYW5nZVswXSArIDEpICogZS5jaGFyLmhlaWdodFxuICB9O1xufTtcblxudGVtcGxhdGUuY2FyZXQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUuY2FyZXQuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IGUuY2hhci53aWR0aCAqIGUuY2FyZXQueCArIGUuZ3V0dGVyICsgZS5vcHRpb25zLm1hcmdpbl9sZWZ0LFxuICAgIHRvcDogZS5jaGFyLmhlaWdodCAqIGUuY2FyZXQueSxcbiAgfTtcbn07XG5cbnRlbXBsYXRlLmd1dHRlciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbnVsbDtcbn07XG5cbnRlbXBsYXRlLmd1dHRlci5zdHlsZSA9IGZ1bmN0aW9uKHBvaW50LCBlKSB7XG4gIHJldHVybiB7XG4gICAgd2lkdGg6IDEsXG4gICAgaGVpZ2h0OiBlLnJvd3MgKiBlLmNoYXIuaGVpZ2h0LFxuICB9O1xufTtcblxudGVtcGxhdGUucnVsZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGZhbHNlO1xufTtcblxudGVtcGxhdGUucnVsZXIuc3R5bGUgPSBmdW5jdGlvbihwb2ludCwgZSkge1xuICByZXR1cm4ge1xuICAgIHdpZHRoOiBlLmxvbmdlc3RMaW5lICogZS5jaGFyLndpZHRoLFxuICAgIGhlaWdodDogKChlLnJvd3MgKyBlLnBhZ2UuaGVpZ2h0KSAqIGUuY2hhci5oZWlnaHQpICsgZS5wYWdlUmVtYWluZGVyLmhlaWdodCxcbiAgfTtcbn07XG5cbmZ1bmN0aW9uIGluc2VydChvZmZzZXQsIHN0cmluZywgcGFydCkge1xuICByZXR1cm4gc3RyaW5nLnNsaWNlKDAsIG9mZnNldCkgKyBwYXJ0ICsgc3RyaW5nLnNsaWNlKG9mZnNldCk7XG59XG4iLCJ2YXIgZG9tID0gcmVxdWlyZSgnZG9tJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJ2RpZmYnKTtcbnZhciBtZXJnZSA9IHJlcXVpcmUoJ21lcmdlJyk7XG52YXIgdHJpbSA9IHJlcXVpcmUoJ3RyaW0nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5mdW5jdGlvbiBWaWV3KG5hbWUsIGVkaXRvciwgdGVtcGxhdGUpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFZpZXcpKSByZXR1cm4gbmV3IFZpZXcobmFtZSwgZWRpdG9yLCB0ZW1wbGF0ZSk7XG5cbiAgdGhpcy5uYW1lID0gbmFtZTtcbiAgdGhpcy5lZGl0b3IgPSBlZGl0b3I7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcblxuICB0aGlzLnZpc2libGUgPSBmYWxzZTtcbiAgdGhpcy5sYXN0VXNlZCA9IDA7XG5cbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcblxuICB0aGlzLmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIHRoaXMuZWwuY2xhc3NOYW1lID0gbmFtZTtcblxuICB2YXIgc3R5bGUgPSB7XG4gICAgdG9wOiAwLFxuICAgIGhlaWdodDogMCxcbiAgICBvcGFjaXR5OiAwXG4gIH07XG5cbiAgaWYgKHRoaXMuZWRpdG9yLm9wdGlvbnMuZGVidWdfbGF5ZXJzKSB7XG4gICAgc3R5bGUuYmFja2dyb3VuZCA9ICcjJ1xuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KVxuICAgICsgKE1hdGgucmFuZG9tKCkgKiAxMiB8IDApLnRvU3RyaW5nKDE2KTtcbiAgfVxuXG4gIGRvbS5zdHlsZSh0aGlzLCBzdHlsZSk7XG59XG5cblZpZXcucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKHJhbmdlKSB7XG4gIGlmICghcmFuZ2UpIHJhbmdlID0gdGhpcztcblxuICB0aGlzLmxhc3RVc2VkID0gRGF0ZS5ub3coKTtcblxuICAvLyBjb25zb2xlLmxvZyh0aGlzLm5hbWUsIHRoaXMudmFsdWUsIGUubGF5b3V0W3RoaXMubmFtZV0sIGRpZmYodGhpcy52YWx1ZSwgZS5sYXlvdXRbdGhpcy5uYW1lXSkpXG4gIC8vIGlmICghZGlmZih0aGlzLnZhbHVlLCB0aGlzLmVkaXRvci5sYXlvdXRbdGhpcy5uYW1lXSkpIHJldHVybjtcblxuICB2YXIgaHRtbCA9IHRoaXMudGVtcGxhdGUocmFuZ2UsIHRoaXMuZWRpdG9yKTtcbiAgaWYgKGh0bWwgPT09IGZhbHNlKSByZXR1cm4gdGhpcy5zdHlsZSgpO1xuXG4gIC8vIGlmICgnY29kZScgPT09IHRoaXMubmFtZSkgaHRtbCA9IHRyaW0uZW1wdHlMaW5lcyhodG1sKS5zdHJpbmc7XG5cbiAgdGhpc1swXSA9IHJhbmdlWzBdO1xuICB0aGlzWzFdID0gcmFuZ2VbMV07XG4gIHRoaXMudmlzaWJsZSA9IHRydWU7XG5cbiAgaWYgKGh0bWwpIGRvbS5odG1sKHRoaXMsIGh0bWwpO1xuICBlbHNlIGlmICgnY29kZScgPT09IHRoaXMubmFtZSB8fCAnYmxvY2snID09PSB0aGlzLm5hbWUpIHJldHVybiB0aGlzLmNsZWFyKCk7XG5cbiAgLy8gY29uc29sZS5sb2coJ3JlbmRlcicsIHRoaXMubmFtZSlcbiAgdGhpcy5zdHlsZSgpO1xufTtcblxuVmlldy5wcm90b3R5cGUuc3R5bGUgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5sYXN0VXNlZCA9IERhdGUubm93KCk7XG5cbiAgZG9tLnN0eWxlKFxuICAgIHRoaXMsXG4gICAgbWVyZ2UoXG4gICAgICB7IG9wYWNpdHk6IDEgfSxcbiAgICAgIHRoaXMudGVtcGxhdGUuc3R5bGUodGhpcywgdGhpcy5lZGl0b3IpXG4gICAgKVxuICApO1xufTtcblxuVmlldy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXNbMF0gKyAnLCcgKyB0aGlzWzFdO1xufTtcblxuVmlldy5wcm90b3R5cGUudmFsdWVPZiA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gW3RoaXNbMF0sIHRoaXNbMV1dO1xufTtcblxuVmlldy5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnZpc2libGUpIHJldHVybjtcbiAgdGhpc1swXSA9IHRoaXNbMV0gPSAtMTtcbiAgdGhpcy52aXNpYmxlID0gZmFsc2U7XG4gIC8vIGRvbS5odG1sKHRoaXMsICcnKTtcbiAgZG9tLnN0eWxlKHRoaXMsIHsgdG9wOiAwLCBoZWlnaHQ6IDAsIG9wYWNpdHk6IDAgfSk7XG59O1xuIl19
