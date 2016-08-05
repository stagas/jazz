
var debounce = require('debounce');
var dom = require('dom');
var keys = require('./keys');
var Events = require('events');

module.exports = Text;

function Text() {
  Events.call(this);

  this.node = document.createElement('textarea');

  dom.style(this, {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0
  });

  dom.attrs(this, {
    autocapitalize: 'none'
  });

  this.bindEvents();
}

Text.prototype.__proto__ = Events.prototype;

Text.prototype.bindEvents = function() {
  this.oncut = this.oncut.bind(this);
  this.oncopy = this.oncopy.bind(this);
  this.onpaste = this.onpaste.bind(this);
  this.oninput = this.oninput.bind(this);
  this.onkeydown = this.onkeydown.bind(this);
  this.node.oninput = this.oninput;
  this.node.onkeydown = this.onkeydown;
  this.node.oncut = this.oncut;
  this.node.oncopy = this.oncopy;
  this.node.onpaste = this.onpaste;
};

Text.prototype.get = function() {
  return this.node.value.substr(-1);
};

Text.prototype.set = function(value) {
  this.node.value = value;
};

//TODO: on mobile we need to clear without debounce
// or the textarea content is displayed in hacker's keyboard
// or you need to disable word suggestions in hacker's keyboard settings
Text.prototype.clear = debounce(function() {
  this.set('');
}, 10 * 1000);

Text.prototype.focus = function() {
  console.log('focus')
  this.node.focus();
};

Text.prototype.oninput = function(e) {
  e.preventDefault();
  this.emit('text', this.get());
  this.clear();
  return false;
};

Text.prototype.onkeydown = function(e) {
  var key = keys(e);
  if (key) {
    this.emit(key, e);
    this.emit('key', key, e);
  }
};

Text.prototype.oncut = function(e) {
  e.preventDefault();
  this.emit('cut', e);
};

Text.prototype.oncopy = function(e) {
  e.preventDefault();
  this.emit('copy', e);
};

Text.prototype.onpaste = function(e) {
  e.preventDefault();
  this.emit('paste', e);
};
