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

  if (!this.editor.editing) this.renderAhead();
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
      this.outRangeViews(this.getPageRange([0,0])).forEach(view => view.clear());
      if (!this.hasViewAt(edit.caretNow.y) || edit.caretBefore.x > 0) {
        this.shiftViewsBelow(edit.caretNow.y + 1, 1);
        this.split(edit.caretNow.y);
        if (edit.caretBefore.x > 0) {
          this.renderLine(edit.caretBefore.y);
        }
      } else {
        this.shiftViewsBelow(edit.caretNow.y, 1);
      }
      return;
    }
    if (isEnter && !isEnd) this.shiftViewsBelow(g[0], shift);
    else if (isBackspace && !isBegin) this.shiftViewsBelow(g[0], shift);
  }

  // console.log(g)
  this.updateRange(g);
  this.renderPage(0);
};
