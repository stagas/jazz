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
