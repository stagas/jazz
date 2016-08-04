
var point = require('point');

module.exports = Area;

function Area(a) {
  return a
    ? { begin: point(a.begin), end: point(a.end) }
    : { begin: point(), end: point() };
}

Area.normalize = function(a) {
  var s = [a.begin, a.end].sort(point.sort);
  return {
    begin: point(s[0]),
    end: point(s[1])
  };
};

Area.offset = function(b, a) {
  return {
    begin: point.offset(b.begin, a.begin),
    end: point.offset(b.end, a.end)
  };
};

Area.offsetX = function(x, a) {
  return {
    begin: point.offsetX(x, a.begin),
    end: point.offsetX(x, a.end)
  };
};

Area.offsetY = function(y, a) {
  return {
    begin: point.offsetY(y, a.begin),
    end: point.offsetY(y, a.end)
  };
};

Area.toString = function(a) {
  return point.toString(a.begin) + '-' + point.toString(a.end);
};
