
module.exports = diff;

function diff(a, b) {
  if ('object' === typeof a) {
    var d = {};
    var i = 0;
    for (var k in b) {
      if (a[k] !== b[k]) {
        d[k] = b[k];
        i++;
      }
    }
    if (i) return d;
  } else {
    return a !== b;
  }
}
