var dom = require('dom');

module.exports = View;

function View(editor, name, template) {
  if (!(this instanceof View)) return new View(editor, name, template);

  this.editor = editor;
  this.template = template;
  this.range = [-1,-1];
  this.name = name;

  this.node = document.createElement('div');
  this.node.className = name;
  dom.style(this, {
    top: 0,
    visibility: 'hidden'
  });
}

View.prototype.render = function(range) {
  var e = this.editor;
  var html = this.template(range, e.file.buffer);
  if (html === false) return;
  this.range = range;
  dom.html(this, html);
  dom.style(this, {
    visibility: 'visible',
    top: range[0] * e.layout.char.height
  });
};

View.prototype.clear = function() {
  this.range = [-1,-1];
  dom.style(this, { visibility: 'hidden' });
};
