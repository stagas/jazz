var dom = require('dom');
var diff = require('diff');
var merge = require('merge');

module.exports = View;

function View(name, editor, template) {
  if (!(this instanceof View)) return new View(editor, name, template);

  this.editor = editor;
  this.name = name;
  this.value = editor.layout[name];
  this.template = template;
  this.range = [-1,-1];

  this.node = document.createElement('div');
  this.node.className = name;
  dom.style(this, {
    top: 0,
    visibility: 'hidden'
  });
}

View.prototype.render = function(range) {
  var e = this.editor;
  // console.log(this.name, this.value, e.layout[this.name], diff(this.value, e.layout[this.name]))
  if (!diff(this.value, e.layout[this.name])) return;

  var html = this.template(range, e.file.buffer);
  if (html === false) return;

  this.range = range;

  if (html) dom.html(this, html);

  dom.style(
    this,
    merge(
      { visibility: 'visible' },
      this.template.style(range, e.layout)
    )
  );
};

View.prototype.clear = function() {
  this.range = [-1,-1];
  dom.style(this, { visibility: 'hidden' });
};
