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
  this.text.on('input', this.emit.bind(this, 'input'));
  this.text.on('key', this.emit.bind(this, 'key'));
  this.mouse.on('up', this.emit.bind(this, 'click'));
};

Input.prototype.use = function(node) {
  this.mouse.use(node);
};

Input.prototype.focus = function() {
  this.text.focus();
};
