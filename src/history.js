var Events = require('events');
var debounce = require('debounce');

module.exports = History;

//TODO: too many workarounds (`saved` etc)
// because of
// a bad debounce implementation that doesn't
// support .execNow() or something
function History(editor) {
  this.editor = editor;
  this.index = -1;
  this.log = [];
  this.saved = false;
}

History.prototype.__proto__ = Events.prototype;

History.prototype.save = function() {
  this.saved = false;
  this._saveDebounced();
};

History.prototype._saveDebounced = debounce(function() {
  this._save();
}, 700, true);

History.prototype._save = function() {
  var commit = {
    caret: this.editor.caret.copy(),
    text: this.editor.buffer.get()
  };
  this.log = this.log.slice(0, ++this.index);
  this.log[this.index] = commit;
  this.saved = true;
};

History.prototype.undo = function() {
  this._saveDebounced.cancel();
  if (!this.saved) this._save();
  var commit = this.log[--this.index];
  if (!commit) return ++this.index;
  this.editor.buffer.set(commit.text);
  this.editor.caret.set(commit.caret);
};

History.prototype.redo = function() {
  var commit = this.log[++this.index];
  if (!commit) return --this.index;
  this.editor.buffer.set(commit.text);
  this.editor.caret.set(commit.caret);
};
