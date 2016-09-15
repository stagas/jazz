var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = CodeView;

function CodeView(editor) {
  View.call(this, editor);

  this.name = 'code';
  this.dom = dom(css.code);
}

CodeView.prototype.__proto__ = View.prototype;

CodeView.prototype.use = function(target) {
  dom.append(target, this);
};

CodeView.prototype.render = function() {
  var page = this.editor.getPageRange([-1,1]);
  var code = this.editor.buffer.get(page);
  dom.html(this, code);
  dom.style(this, {
    opacity: 1,
    height: (page[1] - page[0]) * this.editor.char.height,
    top: page[0] * this.editor.char.height
  });
};

CodeView.prototype.clear = function() {
  dom.style(this, {
    opacity: 0,
    height: 0,
    top: 0
  });
};
