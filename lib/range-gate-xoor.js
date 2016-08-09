
module.exports = XOOR;

function XOOR(a, b) {
  var range = null;
  var found = false;
  var out = [];

  for (var i = a[0]; i <= a[1]; i++) {
    found = false;
    for (var k = 0; k < b.length; k++) {
      if (i >= b[k][0] && i <= b[k][1]) {
        found = true;
        range = null;
        break;
      }
    }
    if (!found) {
      if (!range) {
        range = [i,i];
        out.push(range);
      }
      range[1] = i;
    }
  }

  return out;
}

console.log(XOOR([5,15], [[0,3],[4,8],[9,15],[16,20]]))