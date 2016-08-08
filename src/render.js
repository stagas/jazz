var dom = require('dom');
var Events = require('events');
var Range = require('range');
var View = require('./view');

module.exports = Render;

function Render(name, editor, template) {
  this.name = name;
  this.editor = editor;
  this.template = template;

  var _ = this.editor;
  _.visible = {};
  _.ahead = {};
  _.line = {};
}

Render.prototype.__proto__ = Events.prototype;

Render.prototype.createViews = function(length) {
  this.views = new Array(length);
  for (var i = 0; i < this.views.length; i++) {
    this.views[i] = new View(this.name, this.editor, this.template);
  }
};

Render.prototype.renderRanges = function(ranges, views) {
  for (var n = 0, i = 0; i < ranges.length; i++) {
    var range = ranges[i];
    var view = views[n++];
    view.render(range);
  }
};

Render.prototype.renderVisible = function() {
  var views = this.views;
  var _ = this.editor;

  views.ranges = Range.ranges(views);

  _.visible.range = _.getPageRange([0,0]);
  _.visible.need = Range.XOOR(_.visible.range, views.ranges);
  _.visible.outside = _.visible.range.outside(views);
  if (_.visible.need.length > _.visible.outside.length) {
    this.clear();
    return this.renderVisible();
  }

  this.renderRanges(_.visible.need, _.visible.outside);
};

Render.prototype.renderLittleAhead = function() {
  var views = this.views;
  var _ = this.editor;

  views.ranges = Range.ranges(views);

  _.visible.range = _.getPageRange([-.7,+.7]);
  _.visible.need = Range.XOOR(_.visible.range, views.ranges);
  _.visible.outside = _.visible.range.outside(views);
  if (_.visible.need.length > _.visible.outside.length) {
    // console.log('last resort, clear all and try again');
    this.clear();
    return this.renderLittleAhead();
  }

  this.renderRanges(_.visible.need, _.visible.outside);
};

Render.prototype.renderAhead = function() {
  var views = this.views;
  var _ = this.editor;

  views.ranges = Range.ranges(views);

  _.visible.range = _.getPageRange([0,0]);

  if (Range.AND(_.visible.range, views.ranges).length > 0) {
    _.ahead.range = _.getPageRange([-1.5,+1.5]);
    _.ahead.need = Range.XOOR(_.ahead.range, views.ranges);
    if (_.ahead.need.length) {
      // console.log(this.name + ': need', _.ahead.need.join(' '), '#### have:', views.ranges.join(' '))
      _.ahead.range = _.getPageRange([-2.5,+2.5]);
      _.ahead.outside = _.ahead.range.outside(views);
      _.ahead.need = Range.XOOR(_.ahead.range, views.ranges);
      // console.log(this.name + ': need', _.ahead.need.join(' '), '#### have:', views.ranges.join(' '))
      if (_.ahead.need.length <= _.ahead.outside.length) {
        this.renderRanges(_.ahead.need, _.ahead.outside);
        // console.log(this.name + ': render ahead')
        return;
      }
    } else {
      // console.log(this.name + ': nothing to render')
      return;
    }
  }

  _.visible.need = Range.XOOR(_.visible.range, views.ranges);
  _.visible.outside = _.visible.range.outside(views);
  if (_.visible.need.length > _.visible.outside.length) {
    this.clear();
    // console.log(this.name + ': last resort, clear all and try again');
    return this.renderAhead(views);
  }

  this.renderRanges(_.visible.need, _.visible.outside);
  // console.log(this.name + ': render outside visible');
};

Render.prototype.renderLine = function(y, views) {
  var _ = this.editor;

  _.line.range = [y,y];
  _.line.current = views.pop();

  this.renderRanges([_.line.range], [_.line.current]);

  return _.line.current;
};

Render.prototype.clearInvisible = function() {
  var views = this.views;
  var _ = this.editor;

  _.visible.range = _.getPageRange([0,0]);
  _.visible.outside = _.visible.range.outside(views);
  _.visible.outside.forEach((view) => view.clear());

  return _.visible.outside;
};

Render.prototype.clear = function() {
  this.views.forEach((view) => view.clear());
};
