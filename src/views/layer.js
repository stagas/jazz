var dom = require('dom');
var Event = require('event');
var Range = require('range');
var View = require('./view');

module.exports = Layer;

function Layer(name, editor, template, length) {
  this.dom = dom(name + ' layer');
  this.name = name;
  this.editor = editor;
  this.template = template;
  this.views = this.create(length);
}

Layer.prototype.__proto__ = Event.prototype;

Layer.prototype.create = function(length) {
  var views = new Array(length);
  for (var i = 0; i < length; i++) {
    views[i] = new View(this.name, this.editor, this.template);
    dom.append(this, views[i]);
  }
  return views;
};

Layer.prototype.requestView = function() {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view.visible === false) return view;
  }
  return this.clear()[0];
};

Layer.prototype.getPageRange = function(range) {
  return this.editor.getPageRange(range);
};

Layer.prototype.inRangeViews = function(range) {
  var views = [];
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if ( view.visible === true
      && ( view[0] >= range[0] && view[0] <= range[1]
        || view[1] >= range[0] && view[1] <= range[1] ) ) {
      views.push(view);
    }
  }
  return views;
};

Layer.prototype.outRangeViews = function(range) {
  var views = [];
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if ( view.visible === false
      || view[1] < range[0]
      || view[0] > range[1] ) {
      views.push(view);
    }
  }
  return views.sort((a,b) => a.lastUsed - b.lastUsed);
};

Layer.prototype.renderRanges = function(ranges, views) {
  for (var n = 0, i = 0; i < ranges.length; i++) {
    var range = ranges[i];
    var view = views[n++];
    view.render(range);
  }
};

Layer.prototype.renderRange = function(range, include) {
  var visibleRange = this.getPageRange([0,0]);
  var inViews = this.inRangeViews(range);
  var outViews = this.outRangeViews(max(range, visibleRange));

  var needRanges = Range.NOT(range, inViews);
  var needViews = needRanges.length - outViews.length;
  // if ('code' === this.name) console.log('need:', needViews, needRanges.join(' '));
  // if ('code' === this.name) console.log('have:', this.views.join(' '));
  // if ('code' === this.name) console.log('out:', outViews.join(' '));
  // if ('code' === this.name) console.log('range', range, inViews.join(' '));
  if (needViews > 0) {
    this.clear();
    this.renderRanges([visibleRange], this.views);
    return;
  }
  else if (include) this.renderViews(inViews);
  this.renderRanges(needRanges, outViews);
};

Layer.prototype.renderViews = function(views) {
  for (var i = 0; i < views.length; i++) {
    views[i].render();
  }
};

Layer.prototype.renderLine = function(y) {
  this.renderRange([y,y], true);
};

Layer.prototype.renderPage = function(n, include) {
  n = n || 0;
  this.renderRange(this.getPageRange([-n,+n]), include);
};

Layer.prototype.renderAhead = function(include) {
  var views = this.views;
  var currentPageRange = this.getPageRange([0,0]);

  // no view is visible, render current page only
  if (Range.AND(currentPageRange, views).length === 0) {
    this.renderPage(0);
    return;
  }

  // check if we're past the threshold of view
  var aheadRange = this.getPageRange([-.5,+.5]);
  var aheadNeedRanges = Range.NOT(aheadRange, views);
  if (aheadNeedRanges.length) {
    // if so, render further ahead to have some
    // margin to scroll without triggering new renders
    this.renderPage(1, include);
  }
};

/*

1  x
2 -x
3 -x
4 -
5
6

 */

Layer.prototype.spliceRange = function(range) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    // debugger;
    if (view[1] < range[0] || view[0] > range[1]) continue;

    if (view[0] < range[0] && view[1] >= range[0]) { // shorten below
      view[1] = range[0] - 1;
      view.style();
    } else if (view[1] > range[1]) { // shorten above
      view[0] = range[1] + 1;
      view.render();
    } else if (view[0] === range[0] && view[1] === range[1]) { // current line
      view.render();
    } else {
      view.clear();
    }
  }
};

Layer.prototype.shiftViewsBelow = function(y, dy) {
  for (var i = 0; i < this.views.length; i++) {
    var view = this.views[i];
    if (view[0] <= y) continue;

    view[0] += dy;
    view[1] += dy;
    view.style();
  }
};

Layer.prototype.updateRange = function(range) {
  // for (var i = 0; i < this.views.length; i++) {
  //   var view = this.views[i];
  //   if (view[0] >= range[0] && view[1] <= range[1]) {
  //     view.render();
  //   }
  // }
  this.spliceRange(range);
  this.renderRange(range);
};

Layer.prototype.clear = function() {
  for (var i = 0; i < this.views.length; i++) {
    this.views[i].clear();
  }
  return this.views;
};

function max(a, b) {
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}
