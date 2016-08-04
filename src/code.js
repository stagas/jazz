var Render = require('./render');
var template = require('./template');

module.exports = Code;

function Code(name, editor, template) {
  Render.call(this, name, editor, template);

  this.views = this.createViews(6);
}

Code.prototype.__proto__ = Render.prototype;

Code.prototype.render = function() {
  this.renderAhead();
};
