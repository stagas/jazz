
var assert = require('assert');

module.exports = function(t, ChunkArray) {

var c;

t('push', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  assert.equal(3, c.length);
  assert.equal(2, c.chunks.length);
  assert.equal(2, c.chunks[1].offset);

  c.push(20);
  c.push(21);
  c.push(22);
  assert.equal(6, c.length);
  assert.equal(4, c.chunks.length);
  assert.equal(20, c.chunks[2].offset);
  assert.equal(22, c.chunks[3].offset);
})

t('get', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(15, c.get(2));

  c.push(20);
  c.push(21);
  c.push(22);
  assert.equal(20, c.get(3));
  assert.equal(21, c.get(4));
  assert.equal(22, c.get(5));
})

t('getCursor', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  assert.equal({
    local: 0,
    index: 0,
    chunk: c.chunks[0],
    chunkIndex: 0
  }, c.getCursor(0));
  assert.equal({
    local: 1,
    index: 1,
    chunk: c.chunks[0],
    chunkIndex: 0
  }, c.getCursor(1));
  assert.equal({
    local: 0,
    index: 2,
    chunk: c.chunks[1],
    chunkIndex: 1
  }, c.getCursor(2));
})

t('shiftAt', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.shiftAt(0, 2)
  assert.equal(0+2, c.get(0));
  assert.equal(2+2, c.get(1));
  assert.equal(15+2, c.get(2));
  assert.equal(20+2, c.get(3));
  assert.equal(21+2, c.get(4));
  assert.equal(22+2, c.get(5));

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.shiftAt(2, 2)
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(15+2, c.get(2));
  assert.equal(20+2, c.get(3));
  assert.equal(21+2, c.get(4));
  assert.equal(22+2, c.get(5));
})

t('insert', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.insert(2, [5,6]);
  assert.equal(2, c.get(1));
  assert.equal(5, c.get(2));
  assert.equal(6, c.get(3));
  assert.equal(15, c.get(4));
})

t('getCursorByOffset', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  assert.equal(c.chunks[0], c.getCursorByOffset(0).chunk);
  assert.equal(c.chunks[0], c.getCursorByOffset(1).chunk);
  assert.equal(c.chunks[0], c.getCursorByOffset(2).chunk);
  assert.equal(c.chunks[0], c.getCursorByOffset(3).chunk);
  assert.equal(c.chunks[0], c.getCursorByOffset(4).chunk);
  assert.equal(c.chunks[0], c.getCursorByOffset(13).chunk);
  assert.equal(c.chunks[1], c.getCursorByOffset(15).chunk);
  assert.equal(c.chunks[1], c.getCursorByOffset(18).chunk);
  assert.equal(1, c.getCursorByOffset(18).chunkIndex);
})

t('mergeShift', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.mergeShift([5,6], 2);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(5, c.get(2));
  assert.equal(6, c.get(3));
  assert.equal(15+2, c.get(4));
  assert.equal(20+2, c.get(5));
  assert.equal(21+2, c.get(6));
  assert.equal(22+2, c.get(7));
  assert.equal(4, c.chunks.length);

  c = new ChunkArray(2);
  c.push(1);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.mergeShift([0,1], 2);
  assert.equal(0, c.get(0));
  assert.equal(1, c.get(1));
  assert.equal(1+2, c.get(2));
  assert.equal(2+2, c.get(3));
  assert.equal(15+2, c.get(4));
  assert.equal(20+2, c.get(5));
  assert.equal(21+2, c.get(6));
  assert.equal(22+2, c.get(7));
  assert.equal(4, c.chunks.length);

  c = new ChunkArray(2);
  c.push(1);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.mergeShift([30,31], 2);
  assert.equal(1, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(15, c.get(2));
  assert.equal(20, c.get(3));
  assert.equal(21, c.get(4));
  assert.equal(22, c.get(5));
  assert.equal(30, c.get(6));
  assert.equal(31, c.get(7));
  assert.equal(5, c.chunks.length);

  c = new ChunkArray(2);
  c.push(1);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.mergeShift([22,23], 2);
  assert.equal(1, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(15, c.get(2));
  assert.equal(20, c.get(3));
  assert.equal(21, c.get(4));
  assert.equal(22, c.get(5));
  assert.equal(22, c.get(6));
  assert.equal(23, c.get(7));
  assert.equal(5, c.chunks.length);
})

t('removeOffsetRange', function() {
  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([7,17]);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(20-10, c.get(2));
  assert.equal(21-10, c.get(3));
  assert.equal(22-10, c.get(4));
  assert.equal(5, c.length);

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,5]);
  assert.equal(15-5, c.get(0));
  assert.equal(20-5, c.get(1));
  assert.equal(21-5, c.get(2));
  assert.equal(22-5, c.get(3));
  assert.equal(3, c.chunks.length);
  assert.equal(-3, c.chunks[0].offset);
  assert.equal(4, c.length);

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,15]);
  assert.equal(20-15, c.get(0));
  assert.equal(21-15, c.get(1));
  assert.equal(22-15, c.get(2));
  assert.equal(3, c.length);

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,15]);
  assert.equal(20-15, c.get(0));
  assert.equal(21-15, c.get(1));
  assert.equal(22-15, c.get(2));
  assert.equal(3, c.length);

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,22]);
  assert.equal(1, c.chunks.length);
  assert.equal(0, c.chunks[0].offset);
  assert.equal(0, c.length);

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,25]);
  assert.equal(0, c.length);

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([1,21]);
  assert.equal(2, c.length);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([1,22]);
  assert.equal(1, c.length);
  assert.equal(0, c.get(0));

  c = new ChunkArray(10);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([7,17]);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));
  assert.equal(20-10, c.get(2));
  assert.equal(21-10, c.get(3));
  assert.equal(22-10, c.get(4));
  assert.equal(5, c.length);

  c = new ChunkArray(10);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,10]);
  assert.equal(15-10, c.get(0));
  assert.equal(20-10, c.get(1));
  assert.equal(21-10, c.get(2));
  assert.equal(22-10, c.get(3));
  assert.equal(4, c.length);

  c = new ChunkArray(10);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([1,21]);
  assert.equal(2, c.length);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));

  c = new ChunkArray(5);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([1,21]);
  assert.equal(2, c.length);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));

  c = new ChunkArray(1);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([1,21]);
  assert.equal(2, c.length);
  assert.equal(0, c.get(0));
  assert.equal(2, c.get(1));

  c = new ChunkArray(2);
  c.push(0);
  c.push(2);
  c.push(15);
  c.push(20);
  c.push(21);
  c.push(22);
  c.removeOffsetRange([0,15]);
  assert.equal(3, c.length);
  assert.equal(20-15, c.get(0));
  assert.equal(21-15, c.get(1));
  assert.equal(22-15, c.get(2));
})

};
