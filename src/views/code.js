var Range = require('../../lib/range');
var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

var AheadThreshold = {
  animation: [.15, .4],
  normal: [1.5, 3]
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
  if (edit.shift > 0) this.renderInsert(edit);
  else if (edit.shift < 0) this.renderRemove(edit);
  else this.renderLine(edit);
};

CodeView.prototype.renderPage = function() {
  var page = this.editor.getPageRange([0,0]);
  var inParts = this.inRangeParts(page);
  var needRanges = Range.NOT(page, this.parts);
  needRanges.forEach(range => this.renderPart(range));
  // inParts.forEach(part => part.render());
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
    } else if (part[0] > edit.line) {
      part[0] += edit.shift;
      part[1] += edit.shift;
      part.style();
    }
  }
  this.renderPage();
};

CodeView.prototype.renderLine = function(edit) {
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
  var page = this.editor.getPageRange([0,0]);

  if (Range.NOT(page, this.parts).length === 0) {
    return;
  }

  if (Range.AND(page, this.parts).length === 0) {
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
