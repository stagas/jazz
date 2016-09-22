var RulerView = require('./ruler');
var CodeView = require('./code');
var CaretView = require('./caret');
// var BlockView = require('./block');
// var FindView = require('./find');
var RowsView = require('./rows');

module.exports = Views;

function Views(editor) {
  this.editor = editor;

  this.views = [
    new RulerView(editor),
    new CodeView(editor),
    new CaretView(editor),
    // new BlockView,
    // new FindView,
    // new MarkView,
    new RowsView(editor),
  ];

  this.views.forEach(view => this[view.name] = view);
  this.forEach = this.views.forEach.bind(this.views);
}

Views.prototype.use = function(el) {
  this.forEach(view => view.use(el));
};

Views.prototype.render = function() {
  this.forEach(view => view.render());
};

Views.prototype.clear = function() {
  this.forEach(view => view.clear());
},

function noop() {/* noop */}
