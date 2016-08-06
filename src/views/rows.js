var Render = require('../render');
var template = require('../template');

module.exports = Rows;

function Rows(name, editor, template) {
  Render.call(this, name, editor, template);

  this.createViews(10);
}

Rows.prototype.__proto__ = Render.prototype;

Rows.prototype.render = function() {
  this.renderAhead();
};
