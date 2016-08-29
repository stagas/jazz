
module.exports = binarySearch;

function binarySearch(array, compare) {
  var index = -1;
  var prev = -1;
  var low = 0;
  var high = array.length;
  if (!high) return {
    item: null,
    index: 0
  };

  do {
    prev = index;
    index = low + (high - low >> 1);
    var item = array[index];
    var result = compare(item);

    if (result) low = index;
    else high = index;
  } while (prev !== index);

  if (item != null) {
    return {
      item: item,
      index: index
    };
  }

  return {
    item: null,
    index: ~low * -1 - 1
  };
}
