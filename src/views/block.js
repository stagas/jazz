var Layer = require('../layer');
var template = require('../template');

module.exports = Find;

function Find(name, editor, template) {
  Layer.call(this, name, editor, template, 1);
}

Find.prototype.__proto__ = Layer.prototype;

Find.prototype.render = function() {
  this.renderPage(1, true);
};
