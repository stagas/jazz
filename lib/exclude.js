
module.exports = function(array, items) {
  var out = [];
  for (var i = 0; i < array.length; i++) {
    var item = array[i];
    if (!~items.indexOf(item)) out.push(item);
  }
  return out;
};
