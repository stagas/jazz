var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = RulerView;

function RulerView(editor) {
  View.call(this, editor);
  this.name = 'ruler';
  this.dom = dom(css.ruler);
}

RulerView.prototype.__proto__ = View.prototype;

RulerView.prototype.use = function(target) {
  dom.append(target, this);
};

RulerView.prototype.render = function() {
  dom.style(this, {
    top: 0,
    height: (this.editor.rows + this.editor.page.height)
      * this.editor.char.height
      + this.editor.pageRemainder.height
  });
};

RulerView.prototype.clear = function() {
  dom.style(this, {
    height: 0
  });
};
