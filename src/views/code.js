var dom = require('dom');
var Range = require('range');
var Render = require('../render');
var template = require('../template');

module.exports = Code;

function Code(name, editor, template) {
  Render.call(this, name, editor, template);

  // this.createViews(50);
}

Code.prototype.__proto__ = Render.prototype;

Code.prototype.render = function() {
  var views = this.views;
  var _ = this.editor;
  var y = _.editLine;
  var g = _.editRange.slice();
  var shift = _.editShift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isRange = g[0] !== -1 && g[1] - g[0] > 0;
  var isEnd = y + isEnter === _.buffer.loc;

  // if (isEnd) console.log('is end!')
  // randomize
  // views.sort(random);

  if (y < 0) return this.renderAhead();

  if (isRange) {
    if (!shift) {
      this.renderPage(0, true);
      return;
    }

    var size = g[1] - g[0];

    g[1] -= 1;

    var foundCurrent;

    for (var i = 0; i < views.length; i++) {
      var view = views[i];
      var r = view;
      if (!view.visible) continue;

      var isInside = r[0] < g[0] && r[1] >= g[0];
      var isContained = r[0] === r[1] && (r[0] === g[0] || r[1] === g[1]);
      var isCurrent = r[0] + shift === g[0] && r[1] + shift === g[1];
      var isTouchBelow = r[0] - isBackspace === g[1];
      var isAbove = r[1] < g[0];
      var isBelow = r[0] > g[1];

      if (isCurrent) foundCurrent = true;

      if (isEnter) {
        if (isCurrent) shiftView(view, shift);
        else if (isContained) shiftView(view, -size);
        else if (isInside) {
          splitView(view, g[0]-1);
          this.renderRange(g);
          foundCurrent = true;
          // this.renderVisible();
          // this.renderRanges([g], _.invisible);
          // this.renderVisible();
        }
        else if (isTouchBelow) {
          shortenView(view, g[1]);
          // this.renderVisible();
        }
        else if (isAbove) noop();
        else if (isBelow) noop();
        else view.clear();
      } else if (isBackspace) {
        if (isCurrent) shiftView(view, shift);
        else if (isContained) shiftView(view, size);
        else if (isInside) {
          splitView(view, g[0]-1);
          this.renderRange(g);
          foundCurrent = true;
          // this.renderVisible();
          // this.renderRanges([g], _.invisible);
          // this.renderVisible();
        }
        else if (isTouchBelow) {
          shortenView(view, g[1]);
          // this.renderVisible();
        }
        else if (isAbove) noop();
        else if (isBelow) noop();
        else view.clear();
      }
    }

    if (!foundCurrent) {
      this.clear();
    }

    this.renderPage(1, true);

    return;
  }

  for (var i = 0; i < views.length; i++) {
    var view = views[i];
    var r = view;
    if (!view.visible) continue;

    var isInside = r[0] < y && r[1] >= y;
    var isBelow = r[0] > y;
    var isAbove = r[1] < y;
    var isSingle = r[0] === r[1];
    var isTouchBelow = r[0] - isBackspace === y;
    // var isTouchAbove = r[1] + isEnter === y;
    var isCurrent = r[0] === r[1] && r[0] === y + isBackspace;

    if (isEnter) {
      if (isCurrent) {
        if (_.getLineLength(y) > 0) {
          view.render();
        } else {
          shiftView(view, shift);
        }
      }
      else if (isInside) {
        splitView(view, y);
        this.renderLine(y);
        if (!isEnd || y + 2 === _.buffer.loc) this.renderLine(y+1);
        y += 2;
      }
      else if (isTouchBelow) {
        if (isEnd) view.render();
        else shortenView(view, y+1);
      }
      else if (isBelow) shiftView(view, shift);
      else if (isAbove) noop();
      // else view.clear();
    } else if (isBackspace) {
      if (isCurrent) {
        shiftView(view, shift);
        if (_.caret.x > 0) {
          // alert('should render')
          view.render();
        }
      }
      else if (isInside) {
        splitView(view, y);
        if (!isEnd) this.renderLine(y);
        y += 1;
      }
      else if (isTouchBelow) {
        if (isEnd) view.render();
        else shortenView(view, y);
      }
      else if (isBelow) shiftView(view, shift);
      else if (isAbove) noop();
      else view.clear();
    } else {
      if (isCurrent) view.render();
      else if (isInside) {
        splitView(view, y);
        this.renderLine(y);
      }
      else if (isTouchBelow) {
        if (isEnd) view.render();
        else shortenView(view, y);
      }
      else if (isBelow) noop();
      else if (isAbove) noop();
      else view.clear();
    }
  }

  this.renderPage(1, true);
};

Code.prototype.clearBelow = function(y) {
  // console.log('clear below!')
  var views = this.views;
  for (var i = 0; i < views.length; i++) {
    var view = views[i];
    var r = view;
    if (!view.visible) continue;

    var isInside = r[0] < y && r[1] >= y;
    var isBelow = r[0] > y;
    if (isInside) splitView(view, y+1);
    else if (isBelow) view.clear();
  }
};

function splitView(view, y) {
  if (view[0] === view[1]) {
    return view.clear();
  }
  view[1] = y - 1;
  view.style();
}

function shiftView(view, shift) {
  view[0] += shift;
  view[1] += shift;
  view.style();
}

function shortenView(view, y) {
  if (view[0] <= view[1] + 1) {
    return view.clear();
  }
  view[0] = y + 1;
  view.render();
}

function random() {
  return Math.random() - .5;
}

function noop() {/* noop */}
