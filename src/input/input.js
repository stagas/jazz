var Events = require('events');
var Mouse = require('./mouse');
var Text = require('./text');

module.exports = Input;

function Input(editor) {
  Events.call(this);

  this.editor = editor;
  this.mouse = new Mouse(this);
  this.text = new Text;
  this.bindEvents();
}

Input.prototype.__proto__ = Events.prototype;

Input.prototype.bindEvents = function() {
  this.focus = this.focus.bind(this);
  this.text.on(['key', 'text'], this.emit.bind(this, 'input'));
  this.text.on('text', this.emit.bind(this, 'text'));
  this.text.on('keys', this.emit.bind(this, 'keys'));
  this.text.on('key', this.emit.bind(this, 'key'));
  this.text.on('cut', this.emit.bind(this, 'cut'));
  this.text.on('copy', this.emit.bind(this, 'copy'));
  this.text.on('paste', this.emit.bind(this, 'paste'));
  this.mouse.on('up', this.emit.bind(this, 'mouseup'));
  this.mouse.on('click', this.emit.bind(this, 'mouseclick'));
  this.mouse.on('down', this.emit.bind(this, 'mousedown'));
  this.mouse.on('drag', this.emit.bind(this, 'mousedrag'));
  this.mouse.on('drag begin', this.emit.bind(this, 'mousedragbegin'));
};

Input.prototype.use = function(node) {
  this.mouse.use(node);
};

Input.prototype.focus = function() {
  this.text.focus();
};
