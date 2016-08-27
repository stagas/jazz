
module.exports = ChunkArray;

function ChunkArray(chunkLength) {
  var initChunk = [];
  initChunk.offset = 0;

  this.chunks = [initChunk];
  this.chunkLength = chunkLength;
  this.length = 0;
}

ChunkArray.prototype.push = function(offset) {
  var chunk = last(this.chunks);

  chunk.push(offset - chunk.offset);
  this.length++;

  if (chunk.length >= this.chunkLength) {
    var appendChunk = [];
    appendChunk.offset = offset;
    this.chunks.push(appendChunk);
  }
};

ChunkArray.prototype.get = function(index) {
  var cursor = this.getCursor(index);
  return cursor.chunk[cursor.local] + cursor.chunk.offset;
};

ChunkArray.prototype.getCursor = function(index) {
  var chunk;
  var total = 0;

  for (var i = 0; i < this.chunks.length; i++) {
    chunk = this.chunks[i];
    if (total + chunk.length > index) break;
    total += chunk.length;
  }

  return {
    local: index - total,
    index: index,
    chunk: chunk,
    chunkIndex: i
  };
};

ChunkArray.prototype.getCursorByOffset = function(offset, exclusive) {
  var begin = 0;
  var end = this.length;
  if (!end) return;

  var p = -1;
  var i = -1;
  var c;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    c = this.getCursor(i);
    if (c.chunk[c.local] + c.chunk.offset <= offset) begin = i;
    else end = i;
  } while (p !== i);

  if (exclusive && offset >= c.chunk[c.local] + c.chunk.offset) c.index += 1;

  return c;
};

ChunkArray.prototype.insert = function(index, array) {
  var cursor = this.getCursor(index);
  array = array.map(offset => offset - cursor.chunk.offset);
  array.unshift(cursor.local, 0);
  cursor.chunk.splice.apply(cursor.chunk, array);
  this.length += array.length;
};

ChunkArray.prototype.mergeShift = function(array, shift) {
  var cursor = this.getCursorByOffset(array[0], true);
  if (cursor.index === this.length) {
    array.forEach(offset => this.push(offset));
  } else {
    this.shiftAt(cursor.index, shift);
    this.insert(cursor.index, array);
  }
};

ChunkArray.prototype.removeOffsetRange = function(range) {
  var a = this.getCursorByOffset(range[0], true);
  var b = this.getCursorByOffset(range[1], true);

  //TODO: jesus this algorithm
  var a_equal = a.chunk[a.local] + a.chunk.offset === range[0];
  var b_equal = b.chunk[b.local] + b.chunk.offset === range[1];
  var b_less = b.chunk[b.local] + b.chunk.offset < range[1];

  if (a.chunk === b.chunk) {
    a.chunk.splice(a.local + !a_equal, b.local - a.local + 1 - !a_equal);
    this.length -= b.index - a.index + a_equal;
  } else {
    a.chunk.splice(a.local + !a_equal);
    b.chunk.splice(0, b.local + b_equal + b_less);
    if (b.chunkIndex - a.chunkIndex > 1) {
      this.chunks.splice(a.chunkIndex + 1, b.chunkIndex - a.chunkIndex - 1);
    }
    this.length -= b.index - a.index + a_equal - !b_equal + b_less;
  }

  if (!a.chunk.length) this.chunks.splice(this.chunks.indexOf(a.chunk), 1);
  if (a.chunk !== b.chunk && !b.chunk.length) this.chunks.splice(this.chunks.indexOf(b.chunk), 1);

  this.shiftAt(a.index - a_equal, range[0] - range[1]);
};

ChunkArray.prototype.shiftAt = function(index, shift) {
  var cursor = this.getCursor(index);

  var chunk = cursor.chunk;
  var i = cursor.local;

  if (i === 0) {
    chunk.offset += shift;
  } else {
    for (; i < chunk.length; i++) {
      chunk[i] += shift;
    }
  }

  for (i = cursor.chunkIndex + 1; i < this.chunks.length; i++) {
    this.chunks[i].offset += shift;
  }
};

function last(array) {
  return array[array.length - 1];
}

// ChunkArray.prototype.iterator = function(beginIndex) {
//   return new Iterator(this, beginIndex);
// };


// function Iterator(chunkArray, beginIndex) {
//   this.chunkArray = chunkArray;
//   this.chunkIndex = beginIndex / chunkArray.chunkLength | 0;
//   this.chunk = this.chunkArray.chunks[this.chunkIndex];
//   this.index = -1;
// }

// Iterator.prototype.next = function() {
//   this.index++;
//   if (this.index === this.chunkArray.chunkLength) {
//     this.index = 0;
//     this.chunk = this.chunkArray.chunks[++this.chunkIndex];
//     if (!this.chunk) return null;
//   }
//   return {
//     index: this.index,
//     chunk: this.chunk
//   };
// };
