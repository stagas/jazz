var dom = require('dom');
var Range = require('range');
var Render = require('../render');
var template = require('../template');

module.exports = Mark;

function Mark(name, editor, template) {
  Render.call(this, name, editor, template);
}

Mark.prototype.__proto__ = Render.prototype;

Mark.prototype.render = function() {
  this.renderPage(0, true);
};
