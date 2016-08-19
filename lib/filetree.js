var Event = require('event');
var Tree = require('treeview');
var map = [].map;

module.exports = FileTree;

function FileTree(tree) {
  this.el = document.createElement('div');
  this.el.className = 'treeview';

  this.root = new Tree.Branch;
  this.opened = [];
  this.selected = [];
}

FileTree.prototype.__proto__ = Event.prototype;

FileTree.prototype.set = function(tree) {
  this.root.children = [];
  this.root.appendChildren(tree);
  return this;
};

FileTree.prototype.onSelect = function(node, e) {
  if (e.which === 3) {
    e.preventDefault();
    if (e.type === 'contextmenu') {
      return false;
    }
    node.parentNode.removeChild(node);
    this.render();
    return false;
  }

  if (!e.ctrlKey) {
    var list = Tree.flatten(this.root);
    var sel = list.filter(node => node.isSelected);
    if (!e.shiftKey) {
      if ('branch' === node.type) {
        node.isOpened = !node.isOpened;
      } else {
        sel.forEach(node => node.isSelected = false);
        node.isSelected = true;
        this.emit('select', node, this);
      }
    } else {
      var a = list.indexOf(node);
      var b = list.indexOf(sel[0]);
      if (a > b) {
        var swap = a;
        a = b;
        b = swap;
      }
      for (var i = a; i <= b; i++) {
        list[i].isSelected = true;
      }
    }
  } else {
    node.isSelected = !node.isSelected;
  }

  this.selected = Tree
    .flatten(this.root)
    .filter(node => node.isSelected)
    .map(node => node.path);

  this.opened = Tree
    .flatten(this.root)
    .filter(node => node.isOpened)
    .map(node => node.path);

  this.render();
};

FileTree.prototype.render = function() {
  var prev = this.el;
  var list = Tree.Render(this.root, this.opened, this.selected, this.onSelect.bind(this));

  var next = list.reduce((p, n) => {
    p.appendChild(n.el);
    return p;
  }, document.createElement('div'));

  if (!prev.children.length) {
    for (var i = 0; i < next.children.length; i++) {
      prev.appendChild(cloneNode(next.children[i]));
    }
    return;
  }

  var prevList = map.call(prev.children, el => el.textContent);
  var nextList = map.call(next.children, el => el.textContent);

  for (var i = 0; i < prevList.length; i++) {
    if (!~nextList.indexOf(prevList[i])) {
      prev.removeChild(prev.children[i]);
      prevList.splice(i--, 1);
    }
  }

  var index;
  var clone;
  var last = 0;
  for (var i = 0; i < nextList.length; i++) {
    index = prevList.indexOf(nextList[i]);
    if (!~index) {
      clone = cloneNode(next.children[i]);
      if (prev.children[last]) {
        prev.children[last].insertAdjacentElement('afterend', clone);
      }
    } else {
      last = i;
    }
  }

  for (var i = 0; i < prev.children.length; i++) {
    prev.children[i].className = next.children[i].className;
    prev.children[i].onmousedown =
    prev.children[i].oncontextmenu = next.children[i].onmousedown;
  }
};

function cloneNode(node) {
  var clone = node.cloneNode(true);
  clone.onmousedown =
  clone.oncontextmenu = node.onmousedown;
  return clone;
}
