
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
  return cursor.offset;
};

ChunkArray.prototype.getByOffset = function(offset) {
  var cursor = this.getCursorByOffset(offset);
  return cursor.offset;
};

ChunkArray.prototype.getCursor = function(index) {
  var chunk = this.chunks[0];
  var local = 0;
  var total = 0;

  for (var i = 0; i < this.chunks.length; i++) {
    chunk = this.chunks[i];
    local = index - total;
    if (total + chunk.length > index) {
      var cursor = {
        offset: 0,
        local: Math.min(chunk.length - 1, local),
        index: index,
        chunk: chunk,
        chunkIndex: Math.min(this.chunks.length - 1, i)
      };

      cursor.offset = cursor.chunk[cursor.local] + cursor.chunk.offset;

      return cursor;
    }
    total += chunk.length;
  }
};

ChunkArray.prototype.getCursorByOffset = function(offset, exclusive) {
  var begin = 0;
  var end = this.length;
  if (!end) return this.getCursor(0);

  var p = -1;
  var i = -1;
  var c;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    c = this.getCursor(i);
    if (c.offset <= offset) begin = i;
    else end = i;
  } while (p !== i);

  if (exclusive && offset > c.offset) c.index += 1;

  return c;
};

ChunkArray.prototype.insert = function(index, array) {
  var cursor = this.getCursor(index);
  array = array.map(offset => offset - cursor.chunk.offset);
  array.unshift(cursor.local, 0);
  cursor.chunk.splice.apply(cursor.chunk, array);
  this.length += array.length;
};

ChunkArray.prototype.mergeShift = function(offset, array, shift) {
  var cursor = this.getCursorByOffset(offset, true);

  if (this.length && cursor.index === this.length) {
    array.forEach(offset => this.push(offset));
  } else {
    this.shiftAt(cursor.index, shift);
    this.insert(cursor.index, array);
  }
};

ChunkArray.prototype.removeOffsetRange = function(range) {
  var a = this.getCursorByOffset(range[0], true);
  var b = this.getCursorByOffset(range[1]);

  if (a.chunk === b.chunk) {
    this.length -= spliceRange(range, a.chunk);
  } else {
    this.length -= spliceRange(range, a.chunk);
    this.length -= spliceRange(range, b.chunk);

    if (b.chunkIndex - a.chunkIndex > 1) {
      var items = this.chunks.splice(
        a.chunkIndex + 1,
        b.chunkIndex - a.chunkIndex - 1
      );
      this.length -= items.reduce((p, n) => p + n.length, 0);
    }
  }

  this.shiftAt(a.index, range[0] - range[1]);

  if (!a.chunk.length) this.chunks.splice(this.chunks.indexOf(a.chunk), 1);
  if (!b.chunk.length) this.chunks.splice(this.chunks.indexOf(b.chunk), 1);
  if (!this.chunks.length) {
    var initChunk = [];
    initChunk.offset = 0;
    this.chunks.push(initChunk);
  }

};

function spliceRange(range, array) {
  var count = 0;
  for (var i = 0; i < array.length; i++) {
    if (array[i] + array.offset >= range[0] && array[i] + array.offset < range[1]) {
      array.splice(i--, 1);
      count++;
    }
  }
  return count;
}

ChunkArray.prototype.shiftAt = function(index, shift) {
  var cursor = this.getCursor(index);
  if (!cursor) return;
  var chunk = cursor.chunk;
  var i = cursor.local;

  if (i <= 0) {
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
