var dom = require('../../lib/dom');
var css = require('../style.css');
var View = require('./view');

module.exports = FindView;

function FindView(editor) {
  View.call(this, editor);
  this.name = 'find';
  this.dom = dom(css.find);
}

FindView.prototype.__proto__ = View.prototype;

FindView.prototype.use = function(target) {
  dom.append(target, this);
};

FindView.prototype.get = function(range, e) {
  var results = e.findResults;

  var begin = 0;
  var end = results.length;
  var prev = -1;
  var i = -1;

  do {
    prev = i;
    i = begin + (end - begin) / 2 | 0;
    if (results[i].y < range[0] - 1) begin = i;
    else end = i;
  } while (prev !== i);

  var width = e.findValue.length * e.char.width + 'px';

  var html = '';
  var tabs;
  var r;
  while (results[i] && results[i].y < range[1]) {
    r = results[i++];
    tabs = e.getPointTabs(r);
    html += '<i style="'
          + 'width:' + width + ';'
          + 'top:' + (r.y * e.char.height) + 'px;'
          + 'left:' + ((r.x + tabs.tabs * e.tabSize - tabs.remainder)
                    * e.char.width + e.codeLeft) + 'px;'
          + '"></i>';
  }

  return html;
};

FindView.prototype.render = function() {
  if (!this.editor.find.isOpen || !this.editor.findResults.length) return;

  var page = this.editor.getPageRange([-.5,+.5]);
  var html = this.get(page, this.editor);

  dom.html(this, html);
};

FindView.prototype.clear = function() {
  dom.html(this, '');
};
