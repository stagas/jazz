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
};

CodeView.prototype.render = function() {
  var page = this.editor.getPageRange([0,0]);

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
  this[0] = range[0];
  this[1] = range[1];
}

Part.prototype.render = function() {
  var code = this.view.editor.buffer.get(this);
  dom.html(this, code);
  dom.style(this, {
    height: (this[1] - this[0] + 1) * this.view.editor.char.height,
    top: this[0] * this.view.editor.char.height
  });
  dom.append(this.view.target, this);
};

Part.prototype.clear = function() {
  dom.remove(this);
};
