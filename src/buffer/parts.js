var binarySearch = require('../../lib/binary-search');

module.exports = Parts;

function Parts(minSize) {
  minSize = minSize || 5000;
  this.minSize = minSize;
  this.parts = [];
  this.length = 0;
}

Parts.prototype.push = function(item) {
  this.append([item]);
};

Parts.prototype.append = function(items) {
  var part = last(this.parts);

  if (!part) {
    part = [];
    part.startIndex = 0;
    part.startOffset = 0;
    this.parts.push(part);
  }
  else if (part.length >= this.minSize) {
    var startIndex = part.startIndex + part.length;
    var startOffset = items[0];

    part = [];
    part.startIndex = startIndex;
    part.startOffset = startOffset;
    this.parts.push(part);
  }

  part.push.apply(part, items.map(offset => offset - part.startOffset));

  this.length += items.length;
};

Parts.prototype.get = function(index) {
  var part = this.findPartByIndex(index).item;
  return part[index - part.startIndex] + part.startOffset;
};

Parts.prototype.find = function(offset) {
  var p = this.findPartByOffset(offset);
  if (!p.item) console.log(this)
  var part = p.item;
  var partIndex = p.index;
  var o = this.findOffsetInPart(offset, part);
  return {
    offset: o.item + part.startOffset,
    index: o.index + part.startIndex,
    local: o.index,
    part: part,
    partIndex: partIndex
  };
};

Parts.prototype.insert = function(offset, array) {
  var o = this.find(offset);
  var length = array.length;
  //TODO: maybe subtract 'offset' instead ?
  array = array.map(el => el -= o.part.startOffset);
  insert(o.part, o.local, array);
  this.shiftIndex(o.partIndex + 1, -length);
  this.length += length;
};

Parts.prototype.shiftOffset = function(offset, shift) {
  var parts = this.parts;
  var item = this.find(offset);

  var removed = 0;
  for (var i = item.local; i < item.part.length; i++) {
    item.part[i] += shift;
    if (item.part[i] + item.part.startOffset < offset) {
      removed++;
      item.part.splice(i--, 1);
    }
  }
  if (removed) {
    this.shiftIndex(item.partIndex + 1, removed);
    this.length -= removed;
  }
  for (var i = item.partIndex + 1; i < parts.length; i++) {
    parts[i].startOffset += shift;
    if (parts[i].startOffset < offset) {
      if (last(parts[i]) + parts[i].startOffset < offset) {
        removed = parts[i].length;
        this.shiftIndex(i + 1, removed);
        this.length -= removed;
        parts.splice(i--, 1);
      } else {
        this.removeBelowOffset(offset, parts[i]);
      }
    }
  }
};

Parts.prototype.removeRange = function(range) {
  var a = this.find(range[0]);
  var b = this.find(range[1]);

  if (a.partIndex === b.partIndex) {
    var shift = remove(a.part, a.local, b.local + 1).length;
    this.shiftIndex(a.partIndex + 1, shift);
    this.length -= shift;
  } else {
    var shiftA = remove(a.part, a.local).length;
    var shiftB = remove(b.part, 0, b.local + 1).length;
    if (b.partIndex - a.partIndex > 1) {
      var removed = remove(this.parts, a.partIndex + 1, b.partIndex);
      var shiftBetween = removed.reduce((p,n) => p + n.length, 0);
      b.part.startIndex -= shiftA + shiftBetween;
      this.shiftIndex(b.partIndex - removed.length + 1, shiftA + shiftB + shiftBetween);
      this.length -= shiftA + shiftB + shiftBetween;
    } else {
      b.part.startIndex -= shiftA;
      this.shiftIndex(b.partIndex + 1, shiftA + shiftB);
      this.length -= shiftA + shiftB;
    }
  }

  //TODO: this is inefficient as we can calculate the indexes ourselves
  // if (!a.part.length) {
  //     console.log('SPLICING PART A!', a.part)

  //   this.parts.splice(this.parts.indexOf(a.part), 1);
  // }
  // if (!b.part.length) {
  //     console.log('SPLICING PART B!', b.part)
  //   this.parts.splice(this.parts.indexOf(b.part), 1);
  // }
};

Parts.prototype.shiftIndex = function(startIndex, shift) {
  for (var i = startIndex; i < this.parts.length; i++) {
    this.parts[i].startIndex -= shift;
  }
};

Parts.prototype.removeBelowOffset = function(offset, part) {
  var o = this.findOffsetInPart(offset, part)
  var shift = remove(part, 0, o.index).length;
  this.shiftIndex(o.partIndex + 1, shift);
  this.length -= shift;
};

Parts.prototype.findOffsetInPart = function(offset, part) {
  offset -= part.startOffset;
  return binarySearch(part, o => o <= offset);
};

Parts.prototype.findPartByIndex = function(index) {
  return binarySearch(this.parts, s => s.startIndex <= index);
};

Parts.prototype.findPartByOffset = function(offset) {
  return binarySearch(this.parts, s => s.startOffset <= offset);
};

Parts.prototype.toArray = function() {
  return this.parts.reduce((p,n) => p.concat(n), []);
};

function last(array) {
  return array[array.length - 1];
}

function remove(array, a, b) {
  if (b == null) {
    return array.splice(a);
  } else {
    return array.splice(a, b - a);
  }
}

function insert(target, index, array) {
  var op = array.slice();
  op.unshift(index, 0);
  target.splice.apply(target, op);
}
