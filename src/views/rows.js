var Render = require('../render');
var template = require('../template');

module.exports = Rows;

function Rows(name, editor, template) {
  Render.call(this, name, editor, template);

  this.createViews(10);
}

Rows.prototype.__proto__ = Render.prototype;

Rows.prototype.render = function() {
  var views = this.views;
  var rows = this.editor.rows;
  for (var i = 0; i < views.length; i++) {
    var view = views[i];
    var r = view.range;
    if (!view.visible) continue;

    if (r[1] > rows) view.clear();
  }
  this.renderAhead();
};
