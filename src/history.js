var Events = require('events');
var debounce = require('debounce');

/*
   . .
-1 0 1 2 3 4 5
   n

 */

module.exports = History;

function History(editor) {
  this.editor = editor;
  this.log = [];
  this.needle = 0;
  this.timeout = true;
  this.timeStart = 0;
}

History.prototype.__proto__ = Events.prototype;

History.prototype.save = function() {
  if (Date.now() - this.timeStart > 2000) this.actuallySave();
  this.timeout = this.debouncedSave();
};

History.prototype.debouncedSave = debounce(function() {
  this.actuallySave();
}, 700);

History.prototype.actuallySave = function() {
  // console.log('save', this.needle)
  clearTimeout(this.timeout);
  this.log = this.log.slice(0, this.needle++);
  this.log.push(this.commit());
  this.needle = this.log.length;
  this.timeStart = Date.now();
  this.timeout = false;
};

History.prototype.undo = function() {
  // console.log('undo', this.needle, this.log.length)
  if (this.timeout !== false) this.actuallySave();

  if (this.needle > this.log.length - 1) this.needle = this.log.length - 1;

  this.needle--;

  if (this.needle < 0) this.needle = 0;

  this.checkout(this.needle);
};

History.prototype.redo = function() {
  // console.log('redo', this.needle, this.log.length)
  if (this.timeout !== false) return this.actuallySave();

  this.needle++;

  if (this.needle > this.log.length - 1) this.needle = this.log.length - 1;

  this.checkout(this.needle);
};

History.prototype.checkout = function(n) {
  var commit = this.log[n];
  if (!commit) return;

  var _ = this.editor;
  _.mark.active = commit.markActive;
  _.markEnd();
  _.mark.set(commit.mark.copy());
  _.caret.set(commit.caret.copy());
  _.buffer.text = commit.text.copy();
  _.buffer.lines = commit.lines.copy();
  this.emit('change');
};

History.prototype.commit = function() {
  var _ = this.editor;

  return {
    text: _.buffer.text.copy(),
    lines: _.buffer.lines.copy(),
    caret: _.caret.copy(),
    mark: _.mark.copy(),
    markActive: _.mark.active
  };
};
