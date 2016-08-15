var Layer = require('../layer');
var template = require('../template');

module.exports = Find;

function Find(name, editor, template) {
  Layer.call(this, name, editor, template, 10);
}

Find.prototype.__proto__ = Layer.prototype;

Find.prototype.render = function() {
  if (!this.editor.find.isOpen || !this.editor.findResults.length) return;
  this.renderAhead(true);
};
