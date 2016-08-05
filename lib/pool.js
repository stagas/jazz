
module.exports = Pool;

function Pool(length, factory) {
  if (!(this instanceof Pool)) return new Pool(length, factory);
  this.length = length;
  this.factory = factory;
  this.items = new Array(this.length);
  this.needle = 0;
}

Pool.prototype.fill = function() {
  for (var i = 0; i < this.length; i++) {
    this[i] = this.items[i] = this.factory();
  }
  return this;
};

Pool.prototype.add = function() {
  var item = this.factory();
  this.items.push(item);
  this.length++;
  return item;
};

Pool.prototype.find = function(fn) {
  for (var i = 0; i < this.length; i++) {
    var item = this.items[i];
    if (fn(item, i)) return item;
  }
};

Pool.prototype.next = function() {
  this.needle++;
  if (this.needle === this.length) this.needle = 0;
  return this.items[this.needle];
};

Pool.prototype.slice = function(a, b) {
  return this.items.slice(a, b);
};

Pool.prototype.forEach = function(fn) {
  return this.items.forEach(fn);
};

Pool.prototype.map = function(fn) {
  var arr = new Array(this.length);
  for (var i = 0; i < this.length; i++) {
    arr[i] = fn(this.items[i], i);
  }
  return arr;
};

Pool.prototype.randomize = function() {
  this.items.sort(function(a, b) {
    return Math.random() - .5;
  });
};

Pool.prototype.filter = function(fn) {
  return this.items.filter(fn);
};

Pool.prototype.clear = function(except) {
  except = except || [];
  for (var i = 0; i < this.length; i++) {
    var item = this.items[i];
    if (!~except.indexOf(item)) {
      item.clear();
    }
  }
};
