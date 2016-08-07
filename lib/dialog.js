var dom = require('dom');
var Events = require('events');

module.exports = Dialog;

function Dialog(label) {
  this.node = dom('dialog', [
    '<label>label',
    ['input', [
      '<input>text',
      'info'
    ]]
  ]);
  dom.text(this.node.label, label);
  dom.style(this.node.input.info, { display: 'none' });
  this.onkeydown = this.onkeydown.bind(this);
  this.oninput = this.oninput.bind(this);
  this.node.input.el.onclick = stopPropagation;
  this.node.input.el.onmouseup = stopPropagation;
  this.node.input.el.onmousedown = stopPropagation;
  this.node.input.el.oninput = this.oninput;
}

Dialog.prototype.__proto__ = Events.prototype;

function stopPropagation(e) {
  e.stopPropagation();
};

Dialog.prototype.onkeydown = function(e) {
  if (27 === e.which) {
    e.preventDefault();
    this.close();
    return false;
  }
};

Dialog.prototype.oninput = function(e) {
  if (13 === e.which) {
    e.preventDefault();
    this.submit();
    return false;
  }
  this.emit('value', this.node.input.text.el.value);
};

Dialog.prototype.open = function() {
  document.body.addEventListener('keydown', this.onkeydown);
  dom.append(document.body, this.node);
  dom.focus(this.node.input.text);
  this.node.input.text.el.select();
  this.emit('open');
};

Dialog.prototype.close = function() {
  document.body.removeEventListener('keydown', this.onkeydown);
  this.node.el.parentNode.removeChild(this.node.el);
  this.emit('close');
};

Dialog.prototype.submit = function() {
  this.emit('submit', this.node.input.text.el.value);
};

Dialog.prototype.info = function(info) {
  dom.text(this.node.input.info, info);
  dom.style(this.node.input.info, { display: info ? 'block' : 'none' });
};
