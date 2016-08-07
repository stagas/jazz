var Events = require('events');

module.exports = History;

function History(editor) {
  this.editor = editor;

  this.log = [];
  this.needle = 0;
  this.timeout = false;
  this.timeStart = 0;
}

History.prototype.save = function() {
  if (this.timeout === false) {
    this.timeStart = Date.now();
  }
  clearTimeout(this.timeout);
  if (Date.now() - this.timeStart > 2000) {
    return this.actuallySave();
  }
  this.timeout = setTimeout(() => {
    this.actuallySave();
  }, 300);
};

History.prototype.actuallySave = function() {
  this.log = this.log.slice(0, ++this.needle);
  this.log.push(this.commit());
  this.timeout = false;
};

History.prototype.undo = function() {
  if (this.timeout !== false) {
    this.actuallySave();
    this.needle -= 1;
  }

  this.needle = Math.min(this.needle, this.log.length - 1);
  this.needle -= 1;
  if (this.needle < 0) {
    this.needle = -1;
    return;
  }

  var commit = this.log[this.needle];
  this.checkout(commit);
};

History.prototype.redo = function() {
  if (this.timeout !== false) return;

  this.needle += 1;
  if (this.needle === this.log.length) {
    this.needle = this.log.length - 1;
    return;
  }

  var commit = this.log[this.needle];
  this.checkout(commit);
};

History.prototype.checkout = function(commit) {
  var _ = this.editor;
  _.caret = commit.caret.copy();
  _.buffer.text = commit.text.copy();
  _.buffer.lines = commit.lines.copy();
  _.buffer.emit('set');
};

History.prototype.commit = function() {
  var _ = this.editor;

  return {
    text: _.buffer.text.copy(),
    lines: _.buffer.lines.copy(),
    caret: _.caret.copy(),
  };
};
