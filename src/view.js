var dom = require('dom');
var diff = require('diff');
var merge = require('merge');
var trim = require('trim');

module.exports = View;

function View(name, editor, template) {
  if (!(this instanceof View)) return new View(name, editor, template);

  this.name = name;
  this.editor = editor;
  this.template = template;

  this.visible = false;

  this[0] = this[1] = -1;

  this.el = document.createElement('div');
  this.el.className = name;

  var style = {
    top: 0,
    height: 0,
    visibility: 'hidden'
  };

  if (this.editor.options.debug.views && this.name === 'code') {
    style.background = '#'
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16)
    + (Math.random() * 12 | 0).toString(16);
  }

  dom.style(this, style);
}

View.prototype.render = function(range) {
  if (!range) range = this;

  // console.log(this.name, this.value, e.layout[this.name], diff(this.value, e.layout[this.name]))
  // if (!diff(this.value, this.editor.layout[this.name])) return;

  var html = this.template(range, this.editor);
  if (html === false) return this.style();

  // if ('code' === this.name) html = trim.emptyLines(html).string;

  this[0] = range[0];
  this[1] = range[1];
  this.visible = true;

  if (html) dom.html(this, html);
  else if ('code' === this.name || 'block' === this.name) return this.clear();

  // console.log('render', this.name)
  this.style();
};

View.prototype.style = function() {
  dom.style(
    this,
    merge(
      { visibility: 'visible' },
      this.template.style(this, this.editor)
    )
  );
};

View.prototype.toString = function() {
  return this[0] + ',' + this[1];
};

View.prototype.valueOf = function() {
  return [this[0], this[1]];
};

View.prototype.clear = function() {
  if (!this.visible) return;
  this[0] = this[1] = -1;
  this.visible = false;
  // dom.html(this, '');
  dom.style(this, { top: 0, height: 0, visibility: 'hidden' });
};
