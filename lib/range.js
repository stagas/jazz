var AND = require('range-gate-and');
var XOOR = require('range-gate-xoor');

class Range {
  constructor(r) {
    if (r) {
      this[0] = r[0];
      this[1] = r[1];
    } else {
      this[0] = 0;
      this[1] = 1;
    }
  }
}

Range.AND = AND;

Range.XOOR = XOOR;

Range.sort = function(a, b) {
  return a.y === b.y
    ? a.x - b.x
    : a.y - b.y;
};

Range.equal = function(a, b) {
  return a[0] === b[0] && a[1] === b[1];
};

Range.clamp = function(a, b) {
  return [
    Math.max(a[0], b[0]),
    Math.min(a[1], b[1])
  ];
};

module.exports = Range;
