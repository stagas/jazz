
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
    appendChunk.offset = chunk.offset + offset;
    this.chunks.push(appendChunk);
  }
};

ChunkArray.prototype.get = function(index) {
  var cursor = this.getCursor(index);
  return cursor.chunk[cursor.index] + cursor.chunk.offset;
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
    index: index - total,
    chunk: chunk,
    chunkIndex: i
  };
};

ChunkArray.prototype.shiftAt = function(index, shift) {
  var cursor = this.getCursor(index);

  var chunk = cursor.chunk;
  var i = cursor.index;

  for (; i < chunk.length; i++) {
    chunk[i] += shift;
  }

  for (i = cursor.chunkIndex + 1; i < this.chunks.length; i++) {
    this.chunks[i].offset += shift;
  }
};

ChunkArray.prototype.iterator = function(beginIndex) {
  return new Iterator(this, beginIndex);
};

function last(array) {
  return array[array.length - 1];
}

function Iterator(chunkArray, beginIndex) {
  this.chunkArray = chunkArray;
  this.chunkIndex = beginIndex / chunkArray.chunkLength | 0;
  this.chunk = this.chunkArray.chunks[this.chunkIndex];
  this.index = -1;
}

Iterator.prototype.next = function() {
  this.index++;
  if (this.index === this.chunkArray.chunkLength) {
    this.index = 0;
    this.chunk = this.chunkArray.chunks[++this.chunkIndex];
    if (!this.chunk) return null;
  }
  return {
    index: this.index,
    chunk: this.chunk
  };
};
