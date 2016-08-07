var Render = require('../render');
var template = require('../template');

module.exports = Find;

function Find(name, editor, template) {
  Render.call(this, name, editor, template);

  this.createViews(10);
}

Find.prototype.__proto__ = Render.prototype;

Find.prototype.render = function() {
  if (!this.editor.findValue || !this.editor.findResults.length) return;
  this.renderAhead();
};
