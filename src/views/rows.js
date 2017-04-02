var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = RowsView;

function RowsView(editor) {
  View.call(this, editor);
  this.name = 'rows';
  this.dom = dom(css.rows);
  this.rows = -1;
  this.range = [-1,-1];
  this.html = '';
}

RowsView.prototype.__proto__ = View.prototype;

RowsView.prototype.use = function(target) {
  dom.append(target, this);
};

RowsView.prototype.render = function() {
  var range = this.editor.getPageRange([-1,+1]);

  if ( range[0] >= this.range[0]
    && range[1] <= this.range[1]
    && ( this.range[1] !== this.rows
      || this.editor.rows === this.rows
    )) return;

  range = this.editor.getPageRange([-2,+2]);
  this.rows = this.editor.rows;
  this.range = range;

  var html = '';
  for (var i = range[0]; i <= range[1]; i++) {
    html += (i + 1) + '\n';
  }

  if (html !== this.html) {
    this.html = html;

    dom.html(this, html);

    dom.style(this, {
      top: range[0] * this.editor.char.height,
      height: (range[1] - range[0] + 1) * this.editor.char.height,
    });
  }
};

RowsView.prototype.clear = function() {
  dom.style(this, {
    height: 0
  });
};
