
module.exports = bloom;

function bloom(map, s, examine) {
  map = map.slice();
  var size = map.length;
  var len = s.length;
  var i = 0, c = 0, m = 0, n = 0;
  while (len--) {
    c = s.charCodeAt(len) + 1;
    i = ((i + c) * c) % size;
    var bit = map[i];
    if (bit) {
      m++;
      n++;
      continue;
    }

    n++;
    map[i] = 1;
  }

  if (examine) return m === n;
  else return map;
}

var map = new Array(4001).fill(0);
var x = map;
for (var i = 0; i < 512; i++) {
  x = bloom(x, String.fromCharCode(i));
}
x = bloom(x, 'hello there happy little world in a galaxy far far away');
x = bloom(x, 'hello ')
x = bloom(x, 'my')
x = bloom(x, 'friend')
x = bloom(x, 'hello my friend')
x = bloom(x, 'my friends')
assert(bloom(x, 'hello ', true) === true);
assert(bloom(x, 'hello my friend', true) === true);
assert(bloom(x, 'hello my friends', true) === false);
assert(bloom(x, 'hello my', true) === false);
assert(bloom(x, 'hello there happy little world in a galaxy far far away', true) === true);
assert(bloom(x, 'hello there happy little world in a galaxy far far awa', true) === false);
assert(bloom(x, 'a', true) === true);
assert(bloom(x, 'ab', true) === false);
assert(bloom(x, '00', true) === false);
assert(bloom(x, '01', true) === false);
// console.log(x.join(''))
function assert(expr) {
  if (!expr) throw new Error('bloom fail');
}
