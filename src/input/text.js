var dom = require('dom');
var debounce = require('debounce');
var Events = require('events');

var map = {
  8: 'backspace',
  9: 'tab',
  33: 'pageup',
  34: 'pagedown',
  35: 'end',
  36: 'home',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  46: 'delete',
  65: 'a',
  89: 'y',
  90: 'z',

  // numpad
  97: 'end',
  98: 'down',
  99: 'pagedown',
  100: 'left',
  102: 'right',
  103: 'home',
  104: 'up',
  105: 'pageup',
};

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

  this.modifiers = {};

  this.bindEvents();
}

Text.prototype.__proto__ = Events.prototype;

Text.prototype.bindEvents = function() {
  this.oncut = this.oncut.bind(this);
  this.oncopy = this.oncopy.bind(this);
  this.onpaste = this.onpaste.bind(this);
  this.oninput = this.oninput.bind(this);
  this.onkeydown = this.onkeydown.bind(this);
  this.onkeyup = this.onkeyup.bind(this);
  this.node.oninput = this.oninput;
  this.node.onkeydown = this.onkeydown;
  this.node.onkeyup = this.onkeyup;
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
  // console.log('focus')
  this.node.focus();
};

Text.prototype.oninput = function(e) {
  e.preventDefault();
  this.emit('text', this.get());
  setImmediate(() => this.node.selectionStart = this.node.value.length);
  this.clear();
  return false;
};

Text.prototype.onkeydown = function(e) {
  var m = this.modifiers;
  m.shift = e.shiftKey;
  m.ctrl = e.ctrlKey;
  m.alt = e.altKey;

  var keys = [];
  if (m.shift) keys.push('shift');
  if (m.ctrl) keys.push('ctrl');
  if (m.alt) keys.push('alt');
  if (e.which in map) keys.push(map[e.which]);

  if (keys.length) {
    var press = keys.join('+');
    this.emit('keys', press, e);
    this.emit(press, e);
    keys.forEach((press) => this.emit('key', press, e));
  }
};

Text.prototype.onkeyup = function(e) {
  var m = this.modifiers;

  var keys = [];
  if (m.shift && !e.shiftKey) keys.push('shift:up');
  if (m.ctrl && !e.ctrlKey) keys.push('ctrl:up');
  if (m.alt && !e.altKey) keys.push('alt:up');

  m.shift = e.shiftKey;
  m.ctrl = e.ctrlKey;
  m.alt = e.altKey;

  if (m.shift) keys.push('shift');
  if (m.ctrl) keys.push('ctrl');
  if (m.alt) keys.push('alt');
  if (e.which in map) keys.push(map[e.which] + ':up');

  if (keys.length) {
    var press = keys.join('+');
    this.emit('keys', press, e);
    this.emit(press, e);
    keys.forEach((press) => this.emit('key', press, e));
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
