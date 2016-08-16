/**
 *  _______,   _______                      ______________,
 *  \      \\ /      /\                     \             |\
 *   \      \Y      / /   _____,     _____,  \      _     ||
 *    \            / /   /     \\   /     \\  \           ||
 *    /     /\     \/   /   _   \\ /   _   \\  \    ______||
 *   /     / /\     \\  \       /Y \       /Y  /        \\
 *  /     / /  \     \\  \_____/ /  \_____/ / /          \\
 * /_____/ /    \_____\\  \____\/    \____\/ /_____/\_____\\
 * \_____\/      \_____Y                     \_____/\______Y
 *
 */

var DefaultOptions = {
  debug_layers: false,
  scroll_speed: 0.30
};

var dom = require('dom');
var diff = require('diff');
var merge = require('merge');
var clone = require('clone');
var debounce = require('debounce');
var throttle = require('throttle');
var atomic = require('atomic');
var Events = require('events');
var Dialog = require('dialog');
var Point = require('point');
var Range = require('range');
var Area = require('area');
var Box = require('box');

var template = require('./src/template');
var History = require('./src/history');
var Input = require('./src/input');
var File = require('./src/file');
var Move = require('./src/move');
var View = require('./src/view');
var Text = require('./src/input/text');
var CodeView = require('./src/views/code');
var MarkView = require('./src/views/mark');
var RowsView = require('./src/views/rows');
var FindView = require('./src/views/find');
var BlockView = require('./src/views/block');

var SPECIAL_SEGMENTS = ['/*', '*/', '`'];

module.exports = Xoor;

function Xoor(options) {
  Events.call(this);

  this.options = merge(clone(DefaultOptions), options || {});

  Object.assign(this, {
    node: document.createDocumentFragment(),

    file: new File,
    move: new Move(this),
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

  this.views = {
    // gutter: new View('gutter', this, template.gutter),
    ruler: new View('ruler', this, template.ruler),
    caret: new View('caret', this, template.caret),
    code: new CodeView('code', this, template.code),
    mark: new MarkView('mark', this, template.mark),
    rows: new RowsView('rows', this, template.rows),
    find: new FindView('find', this, template.find),
    block: new BlockView('block', this, template.block),
  };

  dom.append(this.node, this.views, true);
  dom.append(this.views.caret, this.input.text);

  // useful shortcuts
  this.buffer = this.file.buffer;
  this.buffer.mark = this.mark;
  this.syntax = this.buffer.syntax;

  this.bindMethods();
  this.bindEvents();
}

Xoor.prototype.__proto__ = Events.prototype;

Xoor.prototype.use = function(node) {
  node.appendChild(this.node);
  this.node = node;

  dom.onscroll(this.node, this.onScroll);
  dom.onresize(this.onResize);

  this.input.use(node);
  this.repaint();
  return this;
};

Xoor.prototype.assign = function(bindings) {
  this.bindings = bindings;
  return this;
};

Xoor.prototype.open = function(path, fn) {
  this.file.open(path, fn);
  return this;
};

Xoor.prototype.focus = function() {
  setImmediate(this.input.focus.bind(this.input));
  return this;
};

Xoor.prototype.bindMethods = function() {
  this.animationScrollFrame = this.animationScrollFrame.bind(this);
  this.markSet = this.markSet.bind(this);
  this.markClear = this.markClear.bind(this);
  this.focus = this.focus.bind(this);
};

Xoor.prototype.bindHandlers = function() {
  for (var method in this) {
    if ('on' === method.slice(0, 2)) {
      this[method] = this[method].bind(this);
    }
  }
};

Xoor.prototype.bindEvents = function() {
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

Xoor.prototype.onScroll = function(scroll) {
  if (scroll.y !== this.scroll.y) {
    this.editing = false;
    this.scroll.set(scroll);
    this.render();
  }
};

Xoor.prototype.onMove = function(point, byEdit) {
  if (!byEdit) this.editing = false;
  if (point) this.setCaret(point);

  if (!byEdit) {
    if (this.input.text.modifiers.shift || this.input.mouse.down) this.markSet();
    else this.markClear();
  }

  this.emit('move');
  this.render();
};

Xoor.prototype.onResize = function() {
  this.repaint();
};

Xoor.prototype.onInput = function(text) {
  this.render();
};

Xoor.prototype.onText = function(text) {
  this.suggestRoot = '';
  this.insert(text);
};

Xoor.prototype.onKeys = function(keys, e) {
  if (!(keys in this.bindings)) return;
  e.preventDefault();
  this.bindings[keys].call(this, e);
};

Xoor.prototype.onKey = function(key, e) {
  if (!(key in this.bindings.single)) return;
  this.bindings.single[key].call(this, e);
};

Xoor.prototype.onCut = function(e) {
  if (!this.mark.active) return;
  this.onCopy(e);
  this.delete();
};

Xoor.prototype.onCopy = function(e) {
  if (!this.mark.active) return;
  var area = this.mark.get();
  var text = this.buffer.getArea(area);
  e.clipboardData.setData('text/plain', text);
};

Xoor.prototype.onPaste = function(e) {
  var text = e.clipboardData.getData('text/plain');
  this.insert(text);
};

Xoor.prototype.onFileOpen = function() {
  this.move.beginOfFile();
  this.repaint();
};

Xoor.prototype.onFileRaw = function(raw) {
  this.clear();
  this.repaint();
};

Xoor.prototype.onFileSet = function() {
  this.buffer.updateRaw();
  this.followCaret();
};

Xoor.prototype.onBeforeFileChange = function() {
  this.history.save();
};

Xoor.prototype.onFileChange = function(editRange, editShift, textBefore, textAfter) {
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

/*
  if ((!editShift) && textBefore) {
    if (textAfter) textBefore += textAfter;
    for (var i = 0; i < SPECIAL_SEGMENTS.length; i++) {
      if (~textBefore.indexOf(SPECIAL_SEGMENTS[i])) {
        this.views.code.clearBelow(e.editLine);
        this.buffer.updateRaw();
        break;
      }
    }
  }
*/
  this.history.save();
  this.render();
};

Xoor.prototype.setCaretFromPx = function(px) {
  var g = new Point({ x: this.gutter, y: this.char.height/2 });
  var p = px['-'](g)['+'](this.scroll)['o/'](this.char);

  p.y = Math.max(0, Math.min(p.y, this.buffer.loc));
  p.x = Math.max(0, Math.min(p.x, this.getLineLength(p.y)));

  this.setCaret(p);
  this.move.lastDeliberateX = p.x;
  this.onMove();

  return p;
};

Xoor.prototype.onMouseUp = function() {
  this.focus();
};

Xoor.prototype.onMouseDown = function() {
  if (this.input.text.modifiers.shift) this.markBegin();
  else this.markClear();
  this.setCaretFromPx(this.input.mouse.point);
};

Xoor.prototype.setCaret = function(p) {
  this.caret.set(p);
  this.followCaret();
};

Xoor.prototype.onMouseClick = function() {
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

Xoor.prototype.onMouseDragBegin = function() {
  this.markBegin();
  this.setCaretFromPx(this.input.mouse.down);
};

Xoor.prototype.onMouseDrag = function() {
  this.setCaretFromPx(this.input.mouse.point);
};

Xoor.prototype.markBegin = function(area) {
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

Xoor.prototype.markSet = function() {
  if (this.mark.active) this.mark.end.set(this.caret);
};

Xoor.prototype.markSetArea = function(area) {
  this.markBegin(area);
  this.render();
};

Xoor.prototype.markClear = function(force) {
  if (this.input.text.modifiers.shift && !force) return;

  this.mark.active = false;
  this.mark.set({
    begin: new Point({ x: -1, y: -1 }),
    end: new Point({ x: -1, y: -1 })
  });
};

Xoor.prototype.getRange = function(range) {
  return Range.clamp(range, this.pageBounds);
};

Xoor.prototype.getPageRange = function(range) {
  var p = (this.animationScrollTarget || this.scroll)['/'](this.char);
  return this.getRange([
    Math.floor(p.y + this.page.height * range[0]),
    Math.ceil(p.y + this.page.height + this.page.height * range[1])
  ]);
};

Xoor.prototype.getLineLength = function(y) {
  return this.buffer.lines.getLineLength(y);
};

Xoor.prototype.followCaret = atomic(function() {
  // console.log('follow caret')
  var p = this.caret['*'](this.char);
  var s = this.animationScrollTarget || this.scroll;

  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + this.size.height) + this.char.height;

  var left = s.x - p.x;
  var right = (p.x) - (s.x + this.size.width - 100) + this.char.width;

  if (bottom < 0) bottom = 0;
  if (top < 0) top = 0;
  if (left < 0) left = 0;
  if (right < 0) right = 0;

  if (!this.animationRunning && !this.find.isOpen)
    this.scrollBy(right - left, bottom - top);
  else
    this.animateScrollBy(right - left, bottom - top);
});

Xoor.prototype.scrollTo = function(p) {
  dom.scrollTo(this.node, p.x, p.y);
};

Xoor.prototype.scrollBy = function(x, y) {
  this.scroll.x += x;
  this.scroll.y += y;
  this.scrollTo(this.scroll);
};

Xoor.prototype.animateScrollBy = function(x, y) {
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

Xoor.prototype.animationScrollFrame = function() {
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

Xoor.prototype.insert = function(text) {
  if (this.mark.active) this.delete();
  var length = this.buffer.insert(this.caret, text);
  this.move.byChars(length, true);
};

Xoor.prototype.backspace = function() {
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

Xoor.prototype.delete = function() {
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

Xoor.prototype.findJump = function(jump) {
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
  // this.render();
};

Xoor.prototype.onFindValue = function(value, noJump) {
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

Xoor.prototype.onFindKey = function(e) {
  if (114 === e.which) { // f3
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

Xoor.prototype.onFindOpen = function() {
  this.find.info('');
  this.onFindValue(this.findValue);
};

Xoor.prototype.onFindClose = function() {
  this.views.find.clear();
  this.focus();
};

Xoor.prototype.suggest = function() {
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

Xoor.prototype.repaint = function() {
  this.resize();
  this.render();
};

Xoor.prototype.resize = function() {
  var $ = this.node;

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
  this.gutter = Math.max(3, (''+this.rows).length) * this.char.width + this.gutterMargin;

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
  + '.editor > .find,'
  + '.editor > .mark,'
  + '.editor > .code {'
  + '  padding-left: ' + this.gutter + 'px;'
  + '}'
  + '.editor > .rows {'
  + '  padding-right: ' + this.gutterMargin + 'px;'
  + '  width: ' + this.gutter + 'px;'
  + '}'
  + '.editor > .find > i {'
  + '  height: ' + (this.char.height + 1) + 'px;'
  + '}'
  + '.editor > .block > i {'
  + '  height: ' + (this.char.height + 1) + 'px;'
  + '}'
  + 'indent {'
  + '  background-image: url(' + dataURL + ');'
  + '}'
  );

  this.emit('resize');
};

Xoor.prototype.clear = function() {
  // this.views.caret.clear();
  // this.views.ruler.clear();
  this.views.mark.clear();
  this.views.code.clear();
  this.views.rows.clear();
  this.views.find.clear();
  this.views.block.clear();
  console.log('clear')
};

Xoor.prototype.render = atomic(function() {
  // console.log('render')
  this.views.caret.render();
  this.views.ruler.render();
  this.views.mark.render();
  this.views.code.render();
  this.views.rows.render();
  this.debouncedRender();
  this.emit('render');
});

Xoor.prototype.debouncedRender = debounce(function() {
  this.views.find.render();
  this.views.block.render();
}, 60);
