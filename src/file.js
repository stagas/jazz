var open = require('open');
var Events = require('events');
var Buffer = require('./buffer');

module.exports = File;

function File(editor) {
  this.path = 'untitled';
  this.buffer = new Buffer;
  this.bindEvents();
}

File.prototype.__proto__ = Events.prototype;

File.prototype.bindEvents = function() {
  this.buffer.on('set', this.emit.bind(this, 'open'));
  this.buffer.on('update', this.emit.bind(this, 'change'));
};

File.prototype.open = function(path, fn) {
  open(path, (err, text) => {
    if (err) {
      this.emit('error', err);
      fn && fn(err);
      return;
    }
    this.path = path;
    this.buffer.set(text);
    fn && fn(null, this);
  });
};

File.prototype.set = function(text) {
  this.buffer.set(text);
};
