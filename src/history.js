var Events = require('events');


/*
   . .
-1 0 1 2 3 4 5
   n

 */

module.exports = History;

function History(editor) {
  this.editor = editor;

  this.log = [];
  this.needle = -1;
  this.timeout = false;
  this.timeStart = 0;
}

History.prototype.__proto__ = Events.prototype;

History.prototype.save = function() {
  if (this.needle === -1) {
    this.actuallySave();
    return;
  }
  if (this.timeout === false) {
    this.timeStart = Date.now();
  }
  clearTimeout(this.timeout);
  if (Date.now() - this.timeStart > 5000) {
    return this.actuallySave();
  }
  this.timeout = setTimeout(() => {
    this.actuallySave();
  }, 700);
};

History.prototype.actuallySave = function() {
  this.log = this.log.slice(0, ++this.needle);
  this.log.push(this.commit());
  this.timeout = false;
};

History.prototype.undo = function() {
  if (this.timeout !== false) {
    clearTimeout(this.timeout);
    this.timeout = false;
    this.actuallySave();
  }

  if (--this.needle < 0) {
    this.needle = -1;
    return;
  }

  var commit = this.log[this.needle];

  this.checkout(commit);

  if (this.needle === 0) this.needle--;
};

History.prototype.redo = function() {
  if (this.timeout !== false) return;

  if (this.needle === -1) this.needle = 0;

  if (++this.needle === this.log.length) {
    this.needle = this.log.length - 1;
    return;
  }

  var commit = this.log[this.needle];

  this.checkout(commit);
};

History.prototype.checkout = function(commit) {
  var _ = this.editor;
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
  };
};
