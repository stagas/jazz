
module.exports = print;

function print(o, depth) {
  var inspect = require('util').inspect;
  if ('object' === typeof o) {
    console.log(inspect(o, null, depth || null, true));
  } else {
    console.log(o.length, o);
  }
}
