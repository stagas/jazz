
var assert = require('assert');

module.exports = function(t, Parts) {

var p;

t('append', function() {
  p = new Parts(2);

  p.append([1,2,3]);
  assert.equal(3, p.length);
  assert.equal(1, p.parts.length);
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(0, p.parts[0].startOffset);
  assert.equal([1,2,3], p.parts[0].slice());

  p.append([5,6]);
  assert.equal(5, p.length);
  assert.equal(2, p.parts.length);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[1].startOffset);
  assert.equal([0,1], p.parts[1].slice());

  p.append([10,11]);
  assert.equal(7, p.length);
  assert.equal(3, p.parts.length);
  assert.equal(5, p.parts[2].startIndex);
  assert.equal(10, p.parts[2].startOffset);
  assert.equal([0,1], p.parts[2].slice());

  p = new Parts(10);

  p.append([1,2,3]);
  assert.equal(3, p.length);
  assert.equal(1, p.parts.length);
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(0, p.parts[0].startOffset);
  assert.equal([1,2,3], p.parts[0].slice());

  p.append([5,6]);
  assert.equal(5, p.length);
  assert.equal(1, p.parts.length);
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(0, p.parts[0].startOffset);
  assert.equal([1,2,3,5,6], p.parts[0].slice());

  p.append([10,11]);
  assert.equal(7, p.length);
  assert.equal(1, p.parts.length);
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(0, p.parts[0].startOffset);
  assert.equal([1,2,3,5,6,10,11], p.parts[0].slice());
})

t('findPartByIndex', function() {
  p = new Parts(2);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal(p.parts[0], p.findPartByIndex(0).item);
  assert.equal(p.parts[0], p.findPartByIndex(1).item);
  assert.equal(p.parts[0], p.findPartByIndex(2).item);
  assert.equal(p.parts[1], p.findPartByIndex(3).item);
  assert.equal(p.parts[1], p.findPartByIndex(4).item);
  assert.equal(p.parts[2], p.findPartByIndex(5).item);
  assert.equal(p.parts[2], p.findPartByIndex(6).item);

  p = new Parts(10);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal(p.parts[0], p.findPartByIndex(0).item);
  assert.equal(p.parts[0], p.findPartByIndex(1).item);
  assert.equal(p.parts[0], p.findPartByIndex(2).item);
  assert.equal(p.parts[0], p.findPartByIndex(3).item);
  assert.equal(p.parts[0], p.findPartByIndex(4).item);
  assert.equal(p.parts[0], p.findPartByIndex(5).item);
  assert.equal(p.parts[0], p.findPartByIndex(6).item);
})

t('get', function() {
  p = new Parts(2);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal(1, p.get(0));
  assert.equal(2, p.get(1));
  assert.equal(3, p.get(2));
  assert.equal(5, p.get(3));
  assert.equal(6, p.get(4));
  assert.equal(10, p.get(5));
  assert.equal(11, p.get(6));

  p = new Parts(10);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal(1, p.get(0));
  assert.equal(2, p.get(1));
  assert.equal(3, p.get(2));
  assert.equal(5, p.get(3));
  assert.equal(6, p.get(4));
  assert.equal(10, p.get(5));
  assert.equal(11, p.get(6));
})

t('findPartByOffset', function() {
  p = new Parts(2);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal(p.parts[0], p.findPartByOffset(0).item);
  assert.equal(p.parts[0], p.findPartByOffset(1).item);
  assert.equal(p.parts[0], p.findPartByOffset(2).item);
  assert.equal(p.parts[0], p.findPartByOffset(3).item);
  assert.equal(p.parts[0], p.findPartByOffset(4).item);
  assert.equal(p.parts[1], p.findPartByOffset(5).item);
  assert.equal(p.parts[1], p.findPartByOffset(6).item);
  assert.equal(p.parts[1], p.findPartByOffset(7).item);
  assert.equal(p.parts[2], p.findPartByOffset(10).item);
  assert.equal(p.parts[2], p.findPartByOffset(11).item);
  assert.equal(p.parts[2], p.findPartByOffset(12).item);

  p = new Parts(10);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal(p.parts[0], p.findPartByOffset(0).item);
  assert.equal(p.parts[0], p.findPartByOffset(1).item);
  assert.equal(p.parts[0], p.findPartByOffset(2).item);
  assert.equal(p.parts[0], p.findPartByOffset(3).item);
  assert.equal(p.parts[0], p.findPartByOffset(4).item);
  assert.equal(p.parts[0], p.findPartByOffset(5).item);
  assert.equal(p.parts[0], p.findPartByOffset(6).item);
  assert.equal(p.parts[0], p.findPartByOffset(7).item);
  assert.equal(p.parts[0], p.findPartByOffset(10).item);
  assert.equal(p.parts[0], p.findPartByOffset(11).item);
  assert.equal(p.parts[0], p.findPartByOffset(12).item);
})

t('find', function() {
  p = new Parts(2);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  assert.equal({
    offset: 1,
    index: 0,
    local: 0,
    part: p.parts[0],
    partIndex: 0
  }, p.find(0));

  assert.equal({
    offset: 1,
    index: 0,
    local: 0,
    part: p.parts[0],
    partIndex: 0
  }, p.find(1));

  assert.equal({
    offset: 2,
    index: 1,
    local: 1,
    part: p.parts[0],
    partIndex: 0
  }, p.find(2));

  assert.equal({
    offset: 5,
    index: 3,
    local: 0,
    part: p.parts[1],
    partIndex: 1
  }, p.find(5));

  assert.equal({
    offset: 6,
    index: 4,
    local: 1,
    part: p.parts[1],
    partIndex: 1
  }, p.find(6));

  assert.equal({
    offset: 6,
    index: 4,
    local: 1,
    part: p.parts[1],
    partIndex: 1
  }, p.find(7));

  assert.equal({
    offset: 10,
    index: 5,
    local: 0,
    part: p.parts[2],
    partIndex: 2
  }, p.find(10));

  assert.equal({
    offset: 11,
    index: 6,
    local: 1,
    part: p.parts[2],
    partIndex: 2
  }, p.find(11));

  assert.equal({
    offset: 11,
    index: 6,
    local: 1,
    part: p.parts[2],
    partIndex: 2
  }, p.find(12));
})

t('removeBelowOffset', function() {
  p = new Parts(2);

  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);

  var item = p.find(3);
  assert.equal(7, p.length);
  p.removeBelowOffset(3, item.part);
  assert.equal(5, p.length);
  assert.equal([3], p.parts[0].slice());

  var item = p.find(11);
  p.removeBelowOffset(11, item.part);
  assert.equal([1], p.parts[2].slice());
})

t('removeRange', function() {
  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  assert.equal(7, p.length);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[2].startIndex);
  p.removeRange([2,2]);
  assert.equal(6, p.length);
  assert.equal([1,3], p.parts[0].slice());
  assert.equal(2, p.parts[1].startIndex);
  assert.equal(4, p.parts[2].startIndex);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.removeRange([2,3]);
  assert.equal(5, p.length);
  assert.equal([1], p.parts[0].slice());
  assert.equal(1, p.parts[1].startIndex);
  assert.equal(3, p.parts[2].startIndex);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.removeRange([3,4]);
  assert.equal(6, p.length);
  assert.equal([1,2], p.parts[0].slice());
  assert.equal([0,1], p.parts[1].slice());
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(2, p.parts[1].startIndex);
  assert.equal(4, p.parts[2].startIndex);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.removeRange([3,5]);
  assert.equal(5, p.length);
  assert.equal([1,2], p.parts[0].slice());
  assert.equal([1], p.parts[1].slice());
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(2, p.parts[1].startIndex);
  assert.equal(3, p.parts[2].startIndex);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.removeRange([3,9]);
  assert.equal([1,2], p.parts[0].slice());
  assert.equal([0,1], p.parts[1].slice());
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(2, p.parts[1].startIndex);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.append([15,16]);
  assert.equal(7, p.parts[3].startIndex);
  p.removeRange([3,10]);
  assert.equal(5, p.length);
  assert.equal([1,2], p.parts[0].slice());
  assert.equal([1], p.parts[1].slice());
  assert.equal(0, p.parts[0].startIndex);
  assert.equal(2, p.parts[1].startIndex);
  assert.equal(3, p.parts[2].startIndex);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.append([15,16]);
  p.removeRange([0,16]);
  assert.equal(0, p.length);
  assert.equal(0, p.parts.length);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.append([15,16]);
  p.removeRange([0,18]);
  assert.equal(0, p.parts.length);
})

t('shiftOffset', function() {
  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  assert.equal(3, p.parts[0].length);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[2].startIndex);
  assert.equal(5, p.parts[1].startOffset);
  assert.equal(10, p.parts[2].startOffset);
  p.shiftOffset(2, -1);
  assert.equal(6, p.length);
  assert.equal(2, p.parts[0].length);
  assert.equal(2, p.parts[1].startIndex);
  assert.equal(4, p.parts[2].startIndex);
  assert.equal(4, p.parts[1].startOffset);
  assert.equal(9, p.parts[2].startOffset);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  assert.equal(3, p.parts[0].length);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[2].startIndex);
  assert.equal(5, p.parts[1].startOffset);
  assert.equal(10, p.parts[2].startOffset);
  p.shiftOffset(2, -2);
  assert.equal(5, p.length);
  assert.equal(1, p.parts[0].length);
  assert.equal(1, p.parts[1].startIndex);
  assert.equal(3, p.parts[2].startIndex);
  assert.equal(3, p.parts[1].startOffset);
  assert.equal(8, p.parts[2].startOffset);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  assert.equal(3, p.parts[0].length);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[2].startIndex);
  assert.equal(5, p.parts[1].startOffset);
  assert.equal(10, p.parts[2].startOffset);
  p.shiftOffset(2, 2);
  assert.equal(7, p.length);
  assert.equal(3, p.parts[0].length);
  assert.equal(1, p.parts[0][0]);
  assert.equal(4, p.parts[0][1]);
  assert.equal(5, p.parts[0][2]);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[2].startIndex);
  assert.equal(7, p.parts[1].startOffset);
  assert.equal(12, p.parts[2].startOffset);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.shiftOffset(2, -100);
  assert.equal(1, p.length);

  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  p.shiftOffset(2, -9);
  assert.equal(2, p.length);
  assert.equal(1, p.get(0));
  assert.equal(2, p.get(1));
})

t('insert', function() {
  p = new Parts(2);
  p.append([1,2,3]);
  p.append([5,6]);
  p.append([10,11]);
  assert.equal(7, p.length);
  assert.equal(3, p.parts[1].startIndex);
  assert.equal(5, p.parts[2].startIndex);
  p.insert(7, [7,8,9]);
  assert.equal(10, p.length);
  assert.equal([0,1,2,3,4], p.parts[1].slice());
  assert.equal(8, p.parts[2].startIndex);
})

};
