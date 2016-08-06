var dom = require('dom');
var Events = require('events');

module.exports = Dialog;

function Dialog(label) {
  this.node = dom('dialog', [
    '<label>label',
    '<input>input',
  ]);
  dom.text(this.node.label, label);
  this.node.input.el.onkeydown = this.onkeydown.bind(this);
}

Dialog.prototype.__proto__ = Events.prototype;

Dialog.prototype.onkeydown = function(e) {
  if (27 === e.which) this.close();
  else if (13 === e.which) this.submit();
  this.emit('value', this.node.input.el.value);
};

Dialog.prototype.open = function() {
  dom.append(document.body, this.node);
  dom.focus(this.node.input);
  this.node.input.el.select();
  this.emit('open');
};

Dialog.prototype.close = function() {
  this.node.el.parentNode.removeChild(this.node.el);
  this.emit('close');
};

Dialog.prototype.submit = function() {
  this.emit('submit', this.node.input.el.value);
};
