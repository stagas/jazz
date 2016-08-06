var dom = require('dom');
var diff = require('diff');
var merge = require('merge');
var trim = require('trim');

module.exports = View;

function View(name, editor, template) {
  if (!(this instanceof View)) return new View(name, editor, template);

  this.editor = editor;
  this.visible = false;
  this.name = name;
  this.value = editor[name];
  this.template = template;
  this.range = [-1,-1];

  this.node = document.createElement('div');
  this.node.className = name;
  var style = {
    top: 0,
    height: 0,
    visibility: 'hidden'
  }

  if (this.editor.options.debug.views) {
    style.background = '#'
      + (Math.random() * 12 | 0).toString(16)
      + (Math.random() * 12 | 0).toString(16)
      + (Math.random() * 12 | 0).toString(16);
  }

  dom.style(this, style);
}

View.prototype.render = function(range) {
  // console.log(this.name, this.value, e.layout[this.name], diff(this.value, e.layout[this.name]))
  // if (!diff(this.value, this.editor.layout[this.name])) return;

  var html = this.template(range, this.editor);
  if (html === false) return;

  if ('code' === this.name) {
    var result = trim.emptyLines(html);
    range[0] += result.leading;
    range[1] -= result.trailing - 1;
    html = result.string;
  }

  this.range = range;
  this.visible = true;

  if (html) dom.html(this, html);
  else if ('code' === this.name) return this.clear();

  this.style();
};

View.prototype.style = function() {
  dom.style(
    this,
    merge(
      { visibility: 'visible' },
      this.template.style(this.range, this.editor)
    )
  );
};

View.prototype.clear = function() {
  this.range = [-1,-1];
  this.visible = false;
  dom.html(this, '');
  dom.style(this, { visibility: 'hidden' });
};
