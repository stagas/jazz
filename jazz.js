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
