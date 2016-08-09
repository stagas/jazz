/**
 *   ____      ____            ,_______,
 *   \ = \    / = /            | = == = \
 *    \   \  /   /  ,_,   ,_,  |   ___   \
 *     \   \/   /  / = \ / = \ |  '---'  /
 *     /   /\   \  \,_,/ \,_,/ |   ,    /
 *    /   /  \   \ ___________ |   |\   \
 *   / = /    \ = \            | = | \ = \
 *  /___/      \___\           |,_,|  \___\
 *
 */

var dom = require('dom');
var diff = require('diff');
var throttle = require('throttle');
var atomic = require('atomic');
var Events = require('events');
var Dialog = require('dialog');
var Point = require('point');
var Range = require('range');
var Area = require('area');
var Box = require('box');

var syntax = require('./src/syntax');
var template = require('./src/template');
var History = require('./src/history');
var Input = require('./src/input');
var File = require('./src/file');
var Move = require('./src/move');
var View = require('./src/view');
var CodeView = require('./src/views/code');
var MarkView = require('./src/views/mark');
var RowsView = require('./src/views/rows');
var FindView = require('./src/views/find');

var SPECIAL_SEGMENTS = ['/*', '*/', '`'];

module.exports = Xoor;

function Xoor(options) {
  Events.call(this);

  this.options = options || {};
  this.options.debug = this.options.debug || {};

  Object.assign(this, {
    node: document.createDocumentFragment(),

    file: new File,
    move: new Move(this),
    input: new Input(this),
    history: new History(this),
    bindings: {},

    find: new Dialog('Find'),
    findValue: '',
    findNeedle: 0,
    findResults: [],
    findIndexDirty: false,

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

    caret: new Point({ x: -1, y: -1 }),
    code: 0,
    rows: 0,
    mark: new Area({
      begin: new Point({ x: -1, y: -1 }),
      end: new Point({ x: -1, y: -1 })
    }),

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
  };

  dom.append(this.node, this.views, true);
  dom.append(this.views.caret, this.input.text);

  // useful shortcuts
  this.buffer = this.file.buffer;
  this.buffer.mark = this.mark;

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
  this.resize();
};

Xoor.prototype.assign = function(bindings) {
  this.bindings = bindings;
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
  this.file.on('set', this.onFileSet);
  this.file.on('open', this.onFileOpen);
  this.file.on('change', this.onFileChange);
  this.file.on('before change', this.onBeforeFileChange);
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
  this.find.on('value', this.onFindValue);
  this.find.on('open', this.onFindOpen);
  this.find.on('close', this.onFindClose);
};

Xoor.prototype.onScroll = function(scroll) {
  if (scroll.y !== this.scroll.y) {
    this.scroll.set(scroll);
    this.render();
  }
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
  this.history.actuallySave();
};

Xoor.prototype.onFileSet = function() {
  this.views.caret.render();
  this.views.code.clear();
  this.render();
};

Xoor.prototype.onBeforeFileChange = function() {
  this.history.save();
};

Xoor.prototype.onFileChange = function(editRange, editShift, textBefore, textAfter) {
  var _ = this;

  _.rows = this.buffer.loc;
  _.code = this.buffer.text.length;
  _.editLine = editRange[0];
  _.editRange = editRange;
  _.editShift = editShift;
  _.pageBounds = [0, _.rows];
  _.findIndexDirty = true;
  if (_.findValue) {
    _.onFindOpen();
    _.onFindValue(_.findValue);
  }

  if ((!editShift) && textBefore) {
    if (textAfter) textBefore += textAfter;
    for (var i = 0; i < SPECIAL_SEGMENTS.length; i++) {
      if (~textBefore.indexOf(SPECIAL_SEGMENTS[i])) {
        this.views.code.clearBelow(_.editLine);
        this.buffer.updateRaw();
        break;
      }
    }
  }

  // this.history.save();
  this.render();
};

Xoor.prototype.setCaretFromPx = function(px) {
  var _ = this;
  var g = new Point({ x: _.gutter, y: _.char.height/2 });
  var p = px['-'](g)['+'](_.scroll)['o/'](_.char);
  p.y = Math.max(0, Math.min(p.y, this.buffer.loc));
  p.x = Math.max(0, Math.min(p.x, this.getLineLength(p.y)));
  _.caret.set(p);
  return p;
};

Xoor.prototype.onMouseUp = function() {
  // this.markEnd();
  this.focus();
};

Xoor.prototype.onMouseDown = function() {
  if (this.input.text.modifiers.shift) {
    this.markBegin();
  }
  this.setCaretFromPx(this.input.mouse.point);
  this.onMove();
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
      this.caret.set(area.end);
      this.markSetArea(area);
      // this.render();
    }
  }
};

Xoor.prototype.onMouseDragBegin = function() {
  console.log('drag begin')
  this.setCaretFromPx(this.input.mouse.down);
  this.markBegin();
};

Xoor.prototype.onMouseDrag = function() {
  this.setCaretFromPx(this.input.mouse.point);
  this.onMove();
  this.markSet();
};

Xoor.prototype.onMove = function(point) {
  if (point) {
    this.caret.set(point);
  }
  this.followCaret();
  this.render();
  this.emit('move');
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
    this.off('move', this.markSet);
    this.on('move', this.markSet);
    // console.log('mark begin')
  } else {
    this.off('move', this.markClear);
  }
};

Xoor.prototype.markSet = function() {
  this.mark.end.set(this.caret);
};

Xoor.prototype.markSetArea = function(area) {
  this.markBegin(area);
  this.render();
  this.markEnd();
};

Xoor.prototype.markEnd = function() {
  this.off('move', this.markClear);
  this.on('move', this.markClear);
};

Xoor.prototype.markClear = function() {
  this.off('move', this.markClear);
  this.off('move', this.markSet);
  this.mark.active = false;
  this.mark.set({
    begin: new Point({ x: -1, y: -1 }),
    end: new Point({ x: -1, y: -1 })
  });
};

Xoor.prototype.clearEdit = function() {
  this.editLine = -1;
  this.editRange = [-1,-1];
  this.editShift = 0;
};

Xoor.prototype.open = function(path, fn) {
  this.file.open(path, fn);
};

Xoor.prototype.focus = function() {
  this.input.focus();
};

Xoor.prototype.getRange = function(range) {
  return Range.clamp(range, this.pageBounds);
};

Xoor.prototype.getPageRange = function(range) {
  var _ = this;
  var p = (_.animationScrollTarget || _.scroll)['/'](_.char);
  return this.getRange([
    Math.floor(p.y + _.page.height * range[0]),
    Math.ceil(p.y + _.page.height + _.page.height * range[1])
  ]);
};

Xoor.prototype.getLineLength = function(y) {
  return this.buffer.lines.getLineLength(y);
};

Xoor.prototype.followCaret = function(center) {
  var _ = this;
  center = center ? _.size.height / 2 | 0 : 0;
  var p = _.caret['*'](_.char);
  var s = _.animationScrollTarget || _.scroll; //getScroll();
  var top = s.y - p.y;
  var bottom = (p.y) - (s.y + _.size.height) + _.char.height;
  if (!_.animationRunning) {
    if (bottom > 0) this.scrollVertical(bottom + center);
    else if (top > 0) this.scrollVertical(-top - center);
    if (bottom > 0 || top > 0) this.render();
  } else {
    if (bottom > 0) this.animateScrollVertical(bottom + center);
    else if (top > 0) this.animateScrollVertical(-top - center);
    // if (bottom > 0 || top > 0) this.render();
  }
};

Xoor.prototype.scrollTo = function(p) {
  // this.scroll.set(p);
  dom.scrollTo(this.node, p.x, p.y);
};

Xoor.prototype.scrollVertical = function(y) {
  this.scroll.y += y;
  this.scrollTo(this.scroll);
};

Xoor.prototype.animateScrollVertical = function(y) {
  var _ = this;

  if (!_.animationRunning) {
    _.animationRunning = true;
  } else {
    window.cancelAnimationFrame(_.animationFrame);
  }

  _.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  var s = _.animationScrollTarget || _.scroll;

  _.animationScrollTarget = new Point({
    // x: Math.max(0, s.x + x),
    x: 0,
    y: Math.min((_.rows + 1) * _.char.height - _.size.height, Math.max(0, s.y + y))
  });
};

Xoor.prototype.animationScrollFrame = function() {
  var _ = this;

  window.cancelAnimationFrame(_.animationFrame);

  var speed = 0.36;
  var s = _.scroll;
  var t = _.animationScrollTarget;

  // var dx = t.x - s.x;
  var dy = t.y - s.y;

  if (/*dx === 0 && */dy === 0) {
    _.animationRunning = false;
    _.animationScrollTarget = null;
    this.emit('animation end');
    // console.log('anim end')
    return;
  }

  _.animationFrame = window.requestAnimationFrame(this.animationScrollFrame);

  // dx *= speed;
  dy *= speed;

  // dx = dx > 0 ? Math.ceil(dx) : Math.floor(dx);
  dy = dy > 0 ? Math.ceil(dy) : Math.floor(dy);

  this.scrollVertical(dy);
};

Xoor.prototype.insert = function(text) {
  if (this.mark.active) this.delete();
  var length = this.buffer.insert(this.caret, text);
  this.move.byChars(length);
};

Xoor.prototype.backspace = function() {
  if (this.move.isBeginOfFile()) return;
  if (this.mark.active) {
    var area = this.mark.get();
    this.caret.set(area.begin);
    this.buffer.deleteArea(area);
    this.markClear();
  } else {
    this.move.byChars(-1);
    this.buffer.deleteCharAt(this.caret);
  }
};

Xoor.prototype.delete = function() {
  if (this.move.isEndOfFile()) return;
  if (this.mark.active) {
    var area = this.mark.get();
    this.caret.set(area.begin);
    this.buffer.deleteArea(area);
    this.markClear();
  } else {
    this.buffer.deleteCharAt(this.caret);
  }
};

Xoor.prototype.findJump = function(jump) {
  var _ = this;

  if (!_.findResults.length) return;

  _.findNeedle = _.findNeedle + jump;
  if (_.findNeedle === _.findResults.length) {
    _.findNeedle = 0;
  } else if (_.findNeedle < 0) {
    _.findNeedle = _.findResults.length - 1;
  }

  _.markClear();
  var result = _.findResults[_.findNeedle];
  _.caret.set(result);
  _.markBegin();
  _.move.byChars(_.findValue.length);
  _.render();
};

Xoor.prototype.onFindValue = function(value) {
  var _ = this;
  var g = new Point({ x: _.gutter, y: 0 });

  _.views.find.clear();

  _.findValue = value;
  console.time('find ' + value);
  _.findResults = this.buffer
    .indexer.find(value).map((offset) => {
    return _.buffer.lines.getOffset(offset);
      //px: new Point(point)['*'](_.char)['+'](g)
  });
  console.timeEnd('find ' + value);

  _.find.info('0/' + _.findResults.length);

  _.views.find.render();
};

Xoor.prototype.onFindOpen = function() {
  if (!this.findIndexDirty) return;
  this.find.info('');
  console.time('index');
  this.buffer.raw = this.buffer.get();
  console.timeEnd('index');
  this.findIndexDirty = false;
  this.findJump(0);
};

Xoor.prototype.onFindClose = function() {
  this.findValue = '';
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
  var _ = this;

  _.offset.set(dom.getOffset($));
  _.scroll.set(dom.getScroll($));
  _.size.set(dom.getSize($));
  _.char.set(dom.getCharSize($));
  _.rows = _.buffer.loc;
  _.code = _.buffer.text.length;
  _.page.set(_.size['^/'](_.char));
  _.pageRemainder.set(_.size['-'](_.page['*'](_.char)));
  _.pageBounds = [0, _.rows];
  _.longestLine = _.buffer.lines.getLongestLineLength();
  _.gutter = (''+_.rows).length * _.char.width + _.gutterMargin;

  dom.style(_.views.caret, {
    height: _.char.height
  });

  // draw indent image
  var canvas = document.createElement('canvas');
  var foo = document.getElementById('foo');
  var ctx = canvas.getContext('2d');

  canvas.setAttribute('width', Math.ceil(_.char.width * 2));
  canvas.setAttribute('height', _.char.height);

  ctx.setLineDash([1,1]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(0,1);
  ctx.lineTo(0, _.char.height);
  ctx.strokeStyle = '#54544b';
  ctx.stroke();

  var dataURL = canvas.toDataURL();

  dom.css(''
  + '.editor > .find,'
  + '.editor > .mark,'
  + '.editor > .code {'
  + '  padding-left: ' + _.gutter + 'px;'
  + '}'
  + '.editor > .rows {'
  + '  padding-right: ' + _.gutterMargin + 'px;'
  + '  width: ' + _.gutter + 'px;'
  + '}'
  + '.editor > .find > i {'
  + '  height: ' + (_.char.height + 1) + 'px;'
  + '}'
  + 'indent {'
  + '  background-image: url(' + dataURL + ');'
  + '}'
  );

  this.emit('resize');
};

Xoor.prototype.clear = function() {
  // this.views.gutter.clear();
  // this.views.caret.clear();
  this.views.mark.clear();
  this.views.code.clear();
  this.views.rows.clear();
  this.views.find.clear();
};

Xoor.prototype.render = atomic(function() {
  // console.log('render')
  // this.views.gutter.render();
  this.views.ruler.render();
  this.views.caret.render();
  this.views.mark.render();
  this.views.code.render();
  this.views.rows.render();
  this.views.find.render();
  this.clearEdit();
  this.emit('render');
});
