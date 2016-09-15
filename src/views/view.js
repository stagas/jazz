
module.exports = View;

function View(editor) {
  this.editor = editor;
}

View.prototype.render = function() {
  throw new Error('render not implemented');
};

View.prototype.clear = function() {
  throw new Error('clear not implemented');
};
