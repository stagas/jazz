var dom = require('dom');
var Events = require('events');
var Range = require('range');
var View = require('./view');

module.exports = Views;

function Views(name, editor, template) {
  this.name = name;
  this.editor = editor;
  this.template = template;
  this.views = [];
}

Views.prototype.__proto__ = Events.prototype;

Views.prototype.create = function(length) {
  var views = new Array(length);
  for (var i = 0; i < length; i++) {
    views[i] = new View(this.name, this.editor, this.template);
    dom.append(this.editor, views[i]);
  }
  this.views.push.apply(this.views, views);
  return views;
};

Views.prototype.renderRanges = function(ranges, views) {
  for (var n = 0, i = 0; i < ranges.length; i++) {
    var range = ranges[i];
    var view = views[n++];
    view.render(range);
  }
  // console.log(this.views.join(' '))
};

Views.prototype.inRangeViews = function(range) {
  var views = [];
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if ( view.visible === true
      && view[0] >= range[0]
      && view[1] <= range[1] ) {
      views.push(view);
    }
  }
  return views;
};

Views.prototype.outRangeViews = function(range) {
  var views = [];
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if ( view.visible === false
      || view[1] < range[0]
      || view[0] > range[1] ) {
      views.push(view);
    }
  }
  return views;
};

Views.prototype.renderRange = function(range, include) {
  var inViews = this.inRangeViews(range);
  var outViews = this.outRangeViews(range);

  var needRanges = Range.NOT(range, inViews);
  if (needRanges.length > outViews.length) {
    outViews.push.apply(
      outViews,
      this.create(needRanges.length - outViews.length)
    );
  }
  if (include) this.renderViews(inViews);
  this.renderRanges(needRanges, outViews);
};

Views.prototype.renderViews = function(views) {
  for (var i = 0; i < views.length; i++) {
    views[i].render();
  }
};

Views.prototype.getPageRange = function(range) {
  return this.editor.getPageRange(range);
};

Views.prototype.renderPage = function(n, include) {
  n = n || 0;
  this.renderRange(this.getPageRange([-n,+n]), include);
};

Views.prototype.renderAhead = function(include) {
  var views = this.views;
  var currentPageRange = this.getPageRange([0,0]);

  // no view is visible, render current page only
  if (Range.AND(currentPageRange, views).length === 0) {
    this.renderPage(0);
    return;
  }

  // check if we're past the threshold of view
  var aheadRange = this.getPageRange([-1.5,+1.5]);
  var aheadNeedRanges = Range.NOT(aheadRange, views);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders
    this.renderPage(2.5, include);
  }
};
/*
Views.prototype.renderAhead = function() {
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
*/

Views.prototype.renderLine = function(y) {
  this.renderRange([y,y], true);
};
