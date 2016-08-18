var dom = require('dom');
var Event = require('event');

module.exports = Dialog;

function Dialog(label, keymap) {
  this.node = dom('dialog', [
    '<label>label',
    ['input', [
      '<input>text',
      'info'
    ]]
  ]);
  dom.text(this.node.label, label);
  dom.style(this.node.input.info, { display: 'none' });
  this.keymap = keymap;
  this.onbodykeydown = this.onbodykeydown.bind(this);
  this.onkeydown = this.onkeydown.bind(this);
  this.oninput = this.oninput.bind(this);
  this.node.input.el.onkeydown = this.onkeydown;
  this.node.input.el.onclick = stopPropagation;
  this.node.input.el.onmouseup = stopPropagation;
  this.node.input.el.onmousedown = stopPropagation;
  this.node.input.el.oninput = this.oninput;
  this.isOpen = false;
}

Dialog.prototype.__proto__ = Event.prototype;

function stopPropagation(e) {
  e.stopPropagation();
};

Dialog.prototype.hasFocus = function() {
  return this.node.input.el.hasFocus();
};

Dialog.prototype.onbodykeydown = function(e) {
  if (27 === e.which) {
    e.preventDefault();
    this.close();
    return false;
  }
};

Dialog.prototype.onkeydown = function(e) {
  if (13 === e.which) {
    e.preventDefault();
    this.submit();
    return false;
  }
  if (e.which in this.keymap) {
    this.emit('key', e);
  }
};

Dialog.prototype.oninput = function(e) {
  this.emit('value', this.node.input.text.el.value);
};

Dialog.prototype.open = function() {
  document.body.addEventListener('keydown', this.onbodykeydown);
  dom.append(document.body, this.node);
  dom.focus(this.node.input.text);
  this.node.input.text.el.select();
  this.isOpen = true;
  this.emit('open');
};

Dialog.prototype.close = function() {
  document.body.removeEventListener('keydown', this.onbodykeydown);
  this.node.el.parentNode.removeChild(this.node.el);
  this.isOpen = false;
  this.emit('close');
};

Dialog.prototype.submit = function() {
  this.emit('submit', this.node.input.text.el.value);
};

Dialog.prototype.info = function(info) {
  dom.text(this.node.input.info, info);
  dom.style(this.node.input.info, { display: info ? 'block' : 'none' });
};
