
exports.Branch = Branch;
exports.Leaf = Leaf;
exports.Render = Render;
exports.flatten = flatten;

function flatten(branch, parent, level) {
  level = level || 0;
  return branch.children.reduce((p, n) => {
    n.parent = parent;
    n.level = level;
    n.path = parent ? parent + '/' + n.name : n.name;
    if ('branch' === n.type) {
      return p.concat(n, flatten(n, n.path, level + 1));
    } else {
      return p.concat(n);
    }
  }, []);
}

function Render(branch, opened, selected, onSelect) {
  var list = flatten(branch);
  list = list.map(Item.bind(null, onSelect));

  var level = 0;
  var index;

  list.forEach(item => {
    if (item.node.parent) {
      var parts = item.node.parent.split('/');
      var shouldHide = false;
      for (var i = 1; i <= parts.length; i++) {
        var parent = parts.slice(0, i).join('/');
        if (!~opened.indexOf(parent)) {
          shouldHide = true;
          break;
        }
      }

      item.el.classList[shouldHide ? 'add' : 'remove']('hidden');
    }

    if (~selected.indexOf(item.node.path)) {
      item.node.isSelected = true;
      item.el.classList.add('selected');
    } else {
      item.node.isSelected = false;
      item.el.classList.remove('selected');
    }

    if (~opened.indexOf(item.node.path)) {
      item.node.isOpened = true;
      item.el.classList.add('opened');
    } else {
      item.node.isOpened = false;
      item.el.classList.remove('opened');
    }
  });

  return list;
}

function Branch(name, children) {
  this.name = name;
  this.type = 'branch';
  this.children = [];
  if (children) this.appendChildren(children);
}

Branch.prototype.appendChildren = function(children) {
  children.forEach(this.appendChild.bind(this));
};

Branch.prototype.appendChild = function(child) {
  var node;
  if (Array.isArray(child)) {
    node = new Branch(child[0], child[1]);
    node.parentNode = this;
    this.children.push(node)
  } else {
    node = new Leaf(child);
    node.parentNode = this;
    this.children.push(node);
  }

  this.children.sort((a, b) =>
      a.type === 'branch' && b.type === 'leaf' ? -1
    : b.type === 'branch' && a.type === 'leaf' ? 1
    : a.name === b.name ? 0
    : a.name < b.name ? -1
    : 1
  )
};

Branch.prototype.removeChild = function(node) {
  var index = this.children.indexOf(node);
  if (~index) this.children.splice(index, 1);
};

function Leaf(name) {
  this.name = name;
  this.type = 'leaf';
}

function Item(onSelect, node) {
  var margin = new Array(node.level + 1).join('<span class="margin"></span>')

  var el = document.createElement('div');
  el.className = 'node';

  if ('branch' == node.type) el.classList.add('branch');
  else el.classList.add('leaf');

  var label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;

  el.innerHTML = margin;
  el.appendChild(label);
  el.onmousedown =
  el.oncontextmenu = onSelect.bind(null, node);

  return {
    el: el,
    node: node
  };
}
