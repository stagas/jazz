var dom = require('dom');
var Range = require('range');
var Render = require('../render');
var template = require('../template');

module.exports = Code;

function Code(name, editor, template) {
  Render.call(this, name, editor, template);

  this.createViews(8);
}

Code.prototype.__proto__ = Render.prototype;

Code.prototype.render = function() {
  var views = this.views;
  var _ = this.editor;
  var y = _.editLine;
  var range = _.editRange;
  var shift = _.editShift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isRange = range[0] !== -1 && range[1] - range[0] > 1;

  // randomize
  views.sort(random);

  if (isRange) {
    this.clear();
    this.renderVisible();
    return;
  }

  if (y < 0) return this.renderAhead();

  _.invisible = this.clearInvisible();
  if (_.invisible.length < 2) {
    this.clear();
    this.render();
    return;
  }

  for (var i = 0; i < views.length; i++) {
    var view = views[i];
    var r = view.range;
    if (!view.visible) continue;

    var isInside = r[0] < y && r[1] > y;
    var isBelow = r[0] > y;
    var isAbove = r[1] < y;
    var isSingle = r[0] === r[1];
    var isTouchBelow = r[0] - isBackspace === y;
    // var isTouchAbove = r[1] + isEnter === y;
    var isCurrent = r[0] === r[1] && r[0] === y + isBackspace;

    if (isEnter) {
      if (isCurrent) {
        if (_.getLineLength(y) > 0) {
          view.render([y,y]);
        } else {
          shiftView(view, shift);
        }
      }
      else if (isInside) {
        splitView(view, y);
        this.renderLine(y, _.invisible);
        this.renderLine(y+1, _.invisible);
        y += 2;
      }
      else if (isTouchBelow) shortenView(view, y+1);
      else if (isBelow) shiftView(view, shift);
      else if (isAbove) noop();
      else view.clear();
    } else if (isBackspace) {
      if (isCurrent) {
        shiftView(view, shift);
        if (_.caret.x > 0) {
          // alert('should render')
          view.render([y,y]);
        }
      }
      else if (isInside) {
        splitView(view, y);
        this.renderLine(y, _.invisible);
        y += 1;
      }
      else if (isTouchBelow) shortenView(view, y);
      else if (isBelow) shiftView(view, shift);
      else if (isAbove) noop();
      else view.clear();
    } else {
      if (isCurrent) view.render([y,y]);
      else if (isInside) {
        splitView(view, y);
        this.renderLine(y, _.invisible);
      }
      else if (isTouchBelow) shortenView(view, y);
      else if (isBelow) noop();
      else if (isAbove) noop();
      else view.clear();
    }
  }

  this.renderVisible();
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
