var dom = require('dom');
var Range = require('range');
var Render = require('./render');
var template = require('./template');

module.exports = Mark;

function Mark(name, editor, template) {
  Render.call(this, name, editor, template);

  this.createViews(1);
}

Mark.prototype.__proto__ = Render.prototype;

Mark.prototype.render = function() {
  var views = this.views;
  var e = this.editor;
  var _ = e.layout;

  if (!_.mark.active) {
    if (views[0].range[0] !== -1) this.clear();
    return;
  }

  _.ahead.range = e.getPageRange([-1,+1]);

  _.mark.area = _.mark.get();
  _.mark.ranges = Range.AND(_.ahead.range, [[_.mark.area.begin.y, _.mark.area.end.y]]);

  if (_.mark.ranges.length === 0) return;

  this.renderRanges(_.mark.ranges, this.views);
};

function splitView(view, y) {
  if (view.range[0] === view.range[1]) {
    return view.clear();
  }
  view.range[1] = y - 1;
  view.style();
}

function shiftView(view, shift) {
  view.range[0] += shift;
  view.range[1] += shift;
  view.style();
}

function shortenView(view, y) {
  if (view.range[0] === view.range[1]) {
    return view.clear();
  }
  view.range[0] = y + 1;
  view.render(view.range);
}

function random() {
  return Math.random() - .5;
}

function noop() {/* noop */}
