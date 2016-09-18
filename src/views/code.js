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

CodeView.prototype.renderRange = function(range) {
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

CodeView.prototype.renderInsert = function(edit) {
  var part;

  this.clearOutPageRange([0,0]);

  if (!this.shortenPartAbove(edit.line)) {
    part = this.getTopPart(edit.line);
    if (part && part[1] !== edit.line) this.removePart(part);
  }

  // part = this.getTopPart(edit.range[1]-edit.shift+1);
  // if (!part) {
    // this.renderPageBelow(edit.range[1]);
  // }
  // else
    this.shiftPartsBelow(edit.line, edit.shift);

  // if (edit.shift === 1) {
  //   // part = this.getTopPart(edit.range[1]);
  //   // if (!part) this.renderPageBelow(edit.range[1]);
  //   // else this.shiftPartsBelow(edit.range[1], edit.shift);

  //   part = this.getLinePart(edit.line);

  //   if (part) {
  //     part[0]++;
  //     part[1]++;
  //     part.render();
  //     this.renderRange([edit.range[0], edit.range[0]]);
  //   } else {
  //     this.renderRange([edit.range[0], edit.range[0]]);
  //     this.renderRange([edit.range[1], edit.range[1]]);
  //   }
  // } else if (edit.shift >= 2) {
    this.renderRange(edit.range);
  // }
};

CodeView.prototype.renderLine = function(edit) {
  var linePart = this.getLinePart(edit.line);
  if (linePart) return linePart.render();
  this.shortenPartAbove(edit.line);
  this.renderRange(edit.range);
  // this.renderPageBelow(edit.range[1]);
};

CodeView.prototype.renderPageBelow = function(y) {
  var page = this.editor.getPageRange([0,0]);
  this.renderRange([y + 1, page[1]]);
};


CodeView.prototype.getLinePart = function(y) {
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part[0] === y && part[1] === y) return part;
  }
};

CodeView.prototype.getTopPart = function(y) {
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part[0] === y) return part;
  }
};

CodeView.prototype.shiftPartsBelow = function(y, dy) {
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part[0] < y) continue;

    part[0] += dy;
    part[1] += dy;
    part.style();
  }
};

CodeView.prototype.shortenPartAbove = function(y) {
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];
    if (part[0] < y && part[1] >= y) { // shorten above
      part[1] = y - 1;
      part.style();
      return true;
    }
  }
};

CodeView.prototype.spliceRange = function(range) {
  for (var i = 0; i < this.parts.length; i++) {
    var part = this.parts[i];

    if (part[1] < range[0] || part[0] > range[1]) {
      continue;
    }

    if (part[0] < range[0] && part[1] >= range[0]) { // shorten above
      part[1] = range[0] - 1;
      part.style();
    } else if (part[1] > range[1]) { // shorten below
      part[0] = range[1] + 1;
      part.render();
    } //else if (part[0] === range[0] && part[1] === range[1]) { // current line
      //part.render();
    //} else {
      //part.clear();
    //}
  }
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

CodeView.prototype.removePart = function(part) {
  part.clear();
  this.parts.splice(this.parts.indexOf(part), 1);
};

CodeView.prototype.clearOutPageRange = function(range) {
  this.outRangeParts(this.editor.getPageRange(range))
    .forEach(part => this.removePart(part));
};

CodeView.prototype.render = function() {
  var page = this.editor.getPageRange([0,0]);

  if (Range.NOT(page, this.parts).length === 0) {
    return;
  }

  if (Range.AND(page, this.parts).length === 0) {
    this.renderRange(page);
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
      this.renderRange(range);
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
  this[0] = range[0];
  this[1] = range[1];

  var style = {};

  if (this.view.editor.options.debug_layers
  && ~this.view.editor.options.debug_layers.indexOf(this.view.name)) {
    style.background = '#'
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16);
  }

  dom.style(this, style);
}

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
