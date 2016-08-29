
module.exports = binarySearch;

function binarySearch(array, compare, loose) {
  var low = 0;
  var high = array.length - 1;

  while (low <= high) {
    var index = low + (high - low >> 1);
    var item = array[index];
    var result = compare(item);

    if (result < 0) low = index + 1;
    else if (result > 0) high = index - 1;
    else return {
      item: item,
      index: index
    };
  }

  if (loose && item) {
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
