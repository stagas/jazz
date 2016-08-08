
module.exports = Node;

function Node(range, value, parent) {
  this.range = range || [-Infinity, Infinity];
  this.value = value || 'HEAD';
  this.parent = parent || null;
  this.children = [];
}

Node.prototype = {
  get top() {
    var node = this;
    while (node.parent) {
      node = node.parent;
    }
    return node;
  }
};

Node.prototype.offset = function(prev) {
  prev = prev || 0;
  return this.parent
    ? this.parent.offset(prev + this.range[0])
    : prev;
};

Node.prototype.get = function(offset, steps) {
  steps = steps || [this];

  if (this.children.length === 0) return steps;

  var o = this.offset();

  for (var i = 0; i < this.children.length; i++) {
    var node = this.children[i];
    if ( offset >= node.range[0] + o
      && offset <= node.range[1] + o ) {
      steps.unshift(node);
      return node.get(offset, steps);
    }
  }
  return steps;
};

Node.prototype.insert = function(range, value) {
  var steps = this.get(range[0]);
  var parent = steps[0];
  var i = 0, o;
  while ((o = parent.offset())
      && range[0] >= parent.range[0] + o
      && range[1] > parent.range[1] + o) {
    parent = steps[++i];
    if (!parent) {
      parent = this;
      break;
    }
  }

  var offset = parent.offset();

  // console.log('insert', value, steps, steps[0].offset())

  var length = range[1] - range[0] + 1;

  for (var i = 0; i < steps.length; i++) {
    steps[i].range[1] += length;
  }

  for (var i = 0; i < parent.children.length; i++) {
    if (range[0] < parent.children[i].range[0] + parent.children[i].offset()) {
      parent.children[i].range[0] += length;
      parent.children[i].range[1] += length;
    }
  }
  // for (var i = 0; i < steps.length; i++) {
  //   steps[i].range[1] += length;
  // }

  // for (var i = 1; i < steps.length; i++) {
  //   for (var j = 0; j < steps[i].children.length; j++) {
  //     if (range[1] < steps[i].children[j].range[0] + steps[i].children[j].offset()) {
  //       steps[i].children[j].range[0] += length;
  //       steps[i].children[j].range[1] += length;
  //     }
  //   }
  // }

  // console.log(value, 'parent', parent.value, 'offset', offset)

  range = range.slice();
  range[0] -= offset;
  range[1] -= offset;

  var node = new Node(range, value, parent);

  parent.children.push(node);
  parent.children.sort(asc);

  return node;
};

Node.prototype.remove = function(offset) {
  var steps = this.get(offset);
  var node = steps[0];
  var parent = node.parent;
  var i = parent.indexOf(node);
  parent.splice(i, 1, node.children);
};

function asc(a, b) {
  return a.range[0] - b.range[0];
}