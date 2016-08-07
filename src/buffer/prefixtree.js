// var WORD = /\w+/g;
var WORD = /[a-zA-Z0-9]{2,}/g
var rank = 0;

module.exports = PrefixTreeNode;

function PrefixTreeNode() {
  this.value = '';
  this.rank = 0;
  this.children = {};
}

PrefixTreeNode.prototype.incrementRank = function() {
  this.rank = ++rank;
};

PrefixTreeNode.prototype.getSortedChildren = function() {
  var children = Object
    .keys(this.children)
    .map((key) => this.children[key]);

  return children
    .reduce((p, n) => p.concat(n.getSortedChildren()), children)
    .filter((node) => node.value)
    .sort((a, b) => {
      var res = b.rank - a.rank;
      if (res === 0) res = a.value.length - b.value.length;
      if (res === 0) res = a.value > b.value;
      return res;
    });
};

PrefixTreeNode.prototype.collect = function(key) {
  var collection = [];
  var node = this.find(key);
  if (node) {
    collection = node.getSortedChildren();
    if (node.value) collection.unshift(node);
  }
  return collection;
};

PrefixTreeNode.prototype.find = function(key) {
  var node = this;
  for (var char in key) {
    if (key[char] in node.children) {
      node = node.children[key[char]];
    } else {
      return;
    }
  }
  return node;
};

PrefixTreeNode.prototype.insert = function(s, value) {
  var node = this;
  var i = 0;
  var n = s.length;

  while (i < n) {
    if (s[i] in node.children) {
      node = node.children[s[i]];
      i++;
    } else {
      break;
    }
  }

  while (i < n) {
    node.children[s[i]] = new PrefixTreeNode;
    node = node.children[s[i]];
    i++;
  }

  node.value = s;
};

PrefixTreeNode.prototype.index = function(s) {
  var word;
  while (word = WORD.exec(s)) {
    this.insert(word[0]);
  }
};
