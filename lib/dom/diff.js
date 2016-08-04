
module.exports = diff;

function diff(a, b) {
  var d = {};
  var i = 0;
  for (var k in b) {
    if (a[k] !== b[k]) {
      d[k] = b[k];
      i++;
    }
  }
  // for (var k in a) {
  //   if (a[k] !== b[k] && !(k in d)) {
  //     d[k] = a[k];
  //     i++;
  //   }
  // }
  if (i) return d;
}
