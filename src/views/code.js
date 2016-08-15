var dom = require('dom');
var Range = require('range');
var Layer = require('../layer');
var template = require('../template');

module.exports = Code;

function Code(name, editor, template) {
  Layer.call(this, name, editor, template, 100);
}

Code.prototype.__proto__ = Layer.prototype;

Code.prototype.render = function() {
  var layer = this;
  var views = this.views;
  var e = this.editor;

  // this.clear();
  // return this.renderPage(0, true);
  if (!e.editing) return this.renderAhead();

  var y = e.editLine;
  var g = e.editRange.slice();
  var shift = e.editShift;
  var isEnter = shift > 0;
  var isBackspace = shift < 0;
  var isBegin = g[0] + isBackspace === 0;
  var isEnd = g[1] + isEnter === e.rows;

  if (shift) {
    if (isEnter && !isEnd) this.shiftViewsBelow(g[0], shift);
    else if (isBackspace && !isBegin) this.shiftViewsBelow(g[0], shift);
  }

  this.updateRange(g);
  this.renderPage(0);
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
    if (isInside) this.spliceView(view, [y+1,y+1]);
    // else if (isBelow) view.clear();
  }
};

function noop() {/* noop */}
