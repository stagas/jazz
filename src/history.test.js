
var assert = require('assert');
var Buffer = require('./buffer');

module.exports = function(t, History) {

var editor;
var history;

function before() {
  editor = {
    buffer: new Buffer
  };
  history = new History(editor);
}

t('undo', function() {
  before();
  history.actuallySave();
  assert.equal('', editor.buffer.text.toString());
  editor.buffer.insert({x:0,y:0}, '123456789');
  history.actuallySave();
  assert.equal('123456789', editor.buffer.text.toString());
  history.undo();
  assert.equal('', editor.buffer.text.toString());

  before();
  history.actuallySave();
  assert.equal('', editor.buffer.text.toString());
  editor.buffer.insert({x:0,y:0}, '123');
  history.actuallySave();
  editor.buffer.insert({x:3,y:0}, '456');
  history.actuallySave();
  editor.buffer.insert({x:6,y:0}, '789');
  history.actuallySave();
  assert.equal('123456789', editor.buffer.text.toString());
  history.undo();
  assert.equal('123456', editor.buffer.text.toString());
  history.undo();
  assert.equal('123', editor.buffer.text.toString());
  history.undo();
  assert.equal('', editor.buffer.text.toString());
  assert.equal(-1, history.needle);
  history.undo();
  assert.equal('', editor.buffer.text.toString());
  assert.equal(-1, history.needle);
})

t('redo', function() {
  before();
  history.actuallySave();
  assert.equal('', editor.buffer.text.toString());
  editor.buffer.insert({x:0,y:0}, '123');
  history.actuallySave();
  editor.buffer.insert({x:3,y:0}, '456');
  history.actuallySave();
  editor.buffer.insert({x:6,y:0}, '789');
  history.actuallySave();
  assert.equal('123456789', editor.buffer.text.toString());
  history.undo();
  assert.equal('123456', editor.buffer.text.toString());
  history.undo();
  assert.equal('123', editor.buffer.text.toString());
  history.undo();
  assert.equal('', editor.buffer.text.toString());
  assert.equal(-1, history.needle);
  history.undo();
  assert.equal('', editor.buffer.text.toString());
  assert.equal(-1, history.needle);
  history.redo();
  assert.equal('123', editor.buffer.text.toString());
  assert.equal(0, history.needle);
  history.redo();
  assert.equal('123456', editor.buffer.text.toString());
  assert.equal(1, history.needle);
  history.redo();
  assert.equal('123456789', editor.buffer.text.toString());
  assert.equal(2, history.needle);
  history.redo();
  assert.equal('123456789', editor.buffer.text.toString());
  assert.equal(2, history.needle);
})

t('undo/redo', function() {
  before();
  history.actuallySave();
  assert.equal('', editor.buffer.text.toString());
  editor.buffer.insert({x:0,y:0}, '123');
  history.actuallySave();
  editor.buffer.insert({x:3,y:0}, '456');
  history.actuallySave();
  editor.buffer.insert({x:6,y:0}, '789');
  history.actuallySave();
  assert.equal('123456789', editor.buffer.text.toString());
  history.undo();
  assert.equal('123456', editor.buffer.text.toString());
  history.undo();
  assert.equal('123', editor.buffer.text.toString());
  history.undo();
  assert.equal('', editor.buffer.text.toString());
  assert.equal(-1, history.needle);
  history.undo();
  assert.equal('', editor.buffer.text.toString());
  assert.equal(-1, history.needle);
  history.redo();
  assert.equal('123', editor.buffer.text.toString());
  assert.equal(0, history.needle);
  history.redo();
  assert.equal('123456', editor.buffer.text.toString());
  assert.equal(1, history.needle);
  history.redo();
  assert.equal('123456789', editor.buffer.text.toString());
  assert.equal(2, history.needle);
  history.redo();
  assert.equal('123456789', editor.buffer.text.toString());
  assert.equal(2, history.needle);
  history.undo();
  assert.equal('123456', editor.buffer.text.toString());
  assert.equal(1, history.needle);
})

}
