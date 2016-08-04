/*

have 0011
need 0101

     0100 have XOOR need

     0111 (have OR need)
add  0100 (^ XOR have)

     0001 (have AND need)
rem  0010 (^ XOR have)

*/

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
