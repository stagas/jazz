var Render = require('./render');
var template = require('./template');

module.exports = Edit;

function Edit(name, editor, template) {
  Render.call(this, name, editor, template);

  this.node = this.views = this.createViews(3);
  this.above = this.views[0];
  this.below = this.views[1];
  this.line = this.views[2];
}

Edit.prototype.__proto__ = Render.prototype;

Edit.prototype.render = function() {
  var shift = this.shift;
  var rows = this.editor.rows;
  var e = this.editor;
  var _ = e.layout;

  _.visible.range = e.getPageRange([0,0]);

  this.isEnter = shift > 0;
  this.isBackspace = shift < 0;

  var y = this.y = _.caret.point.y + this.isEnter;

  // console.log(this.below.range[1], _.visible.range[1])
  this.isBelowMissing = shift
    && this.isBackspace
    && this.below.range[1]-1 < _.visible.range[1];

  var py = this.line.range[0];
  var shouldRender = +this.isNew;

  // console.log('below:', this.below.range[0], y, _.visible.range[1])
  // console.log('above:', this.above.range[1], y, py, _.visible.range[0])

  if (this.isNew) {
    console.log('is new')
    // code.clear();
    this.views.clear();
  }

  // shorten above bottom if visible until non-empty line
  _.above.bottom = y-1;
  while (e.getLineLength(_.above.bottom) === 0
    && _.above.bottom >= _.visible.range[0]) {
    _.above.bottom--;
  }

  _.below.top = y+1;
  _.below.shorten = 0;
  // shorten below top if visible until non-empty line
  while (e.getLineLength(_.below.top) === 0
    && _.below.top <= _.visible.range[1]) {
    _.below.top++;
    _.below.shorten++;
  }

  // _.below.top = y+1;

  // expand below bottom when missing visible lines
  _.below.bottom = Math.max(this.below.range[1], _.visible.range[1] + (this.isBelowMissing ? layout.page.height : 0));

  this.isAboveVisible = _.above.bottom >= _.visible.range[0];
  this.isBelowVisible = _.below.top <= _.visible.range[1];

  if (!this.isAboveVisible) this.above.clear();
  if (!this.isBelowVisible) this.below.clear();

  // console.log('y:', y, 'shift', shift);
  // console.log('above:', _.above.bottom, _.visible.range[0])
  // console.log('bottom:', _.below.top, _.visible.range[1])

  // current line
  this.renderRanges([[y,y]], [this.line]);

  // rows
  if (this.isBelowVisible && this.isAboveVisible) {
    rows.renderVisible();
  } else {
    rows.renderAhead();
  }

  if (!this.isAboveVisible && !this.isBelowVisible) {
    // console.log('>>>>> only line')
    return;
  }

  this.isCurrentBeforeAboveBottom = y+1-this.isEnter <= this.above.range[1];
  this.shouldExpandAbove = shift && _.above.bottom > this.above.range[1];

  // console.log(edit);
  // console.log(edit);

  // above
  var shouldRenderAbove = this.isAboveVisible && (
    this.isNew ||
    this.isCurrentBeforeAboveBottom ||
    this.shouldExpandAbove
  );



  this.isCurrentAfterBelowTop =
    (shift && y-this.isEnter >= _.below.top) ||
    (!shift && y >= this.below.range[0]);

  this.isCurrentBeforeBelowTop = y+1 < _.below.top - _.below.shorten;

  // below
  var shouldRenderBelow = this.isBelowVisible && (
    this.isNew ||
    this.isCurrentAfterBelowTop ||
    this.isCurrentBeforeBelowTop ||
    this.isCurrentBeforeAboveBottom ||
    // (shift && y+1+this.isBackspace-this.isEnter < this.below.range[0]) ||
    // (shift && y === py) ||
    this.isBelowMissing
  );

  // console.log(edit);
  // console.log('above:', _.above);
  // console.log('below:', _.below);

  _.above.range = [_.visible.range[0], _.above.bottom];
  _.below.range = [_.below.top, _.below.bottom];

  if (shouldRenderAbove && shouldRenderBelow) {
    // if (_.above.bottom >= _.visible.range[0]) {
    this.renderRanges([_.above.range, _.below.range], [this.above, this.below]);
    // console.log('>>>>> render all')
    return;
  } else if (shouldRenderAbove) {
    this.renderRanges([_.above.range], [this.above]);
    // console.log('>>>>> render above')
  } else if (shouldRenderBelow) {
    this.renderRanges([_.below.range], [this.below]);
    // console.log('>>>>> render below')
    return;
  }

  if (shift) {
    this.below.range[0] += shift;
    this.below.range[1] += shift;
    this.below.dom.el.style.top = layout.char.height * this.below.range[0] + 'px';
    // console.log('>>>>> shift')
  }
};
