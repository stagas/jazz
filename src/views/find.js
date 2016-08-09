var Render = require('../render');
var template = require('../template');

module.exports = Find;

function Find(name, editor, template) {
  Render.call(this, name, editor, template);
}

Find.prototype.__proto__ = Render.prototype;

Find.prototype.render = function() {
  if (!this.editor.find.isOpen || !this.editor.findResults.length) return;
  this.renderAhead(true);
};
