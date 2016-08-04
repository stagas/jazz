var syntax = require('./syntax');

var symbol = {
  'double comment': '\uffe1',
  'double comment close': '\uffe2',
  'template string': '\uffe3',
  'template string close': '\uffe4'
};

var template = exports;

template.code = function(range, buffer) {
  var code = buffer.get(range);

  if (template.code.memoize.param === code) {
    return template.code.memoize.result;
  } else {
    template.code.memoize.param = code;
    template.code.memoize.result = false;
  }

  if (code.length > 10000) {
    return syntax.entities(code);
  }

  var offset = buffer.lines.get(range[0]);
  var segment = buffer.segments.get(offset);

  if (segment) {
    var offset = segment.offset;
    var node = segment.node;
    var r = node.range.slice();
    r[0] -= offset;
    r[1] -= offset;
    code = symbol[node.value] + code;
    if (r[1] < code.length) {
      code = insert(r[1], code, symbol[node.value + ' close']);
    }
  }

  var html = syntax.highlight(code);

  return '<code>' + html + '</code>';
};

// singleton memoize for fast last repeating value
template.code.memoize = {
  param: '',
  result: ''
};

template.rows = function(range) {
  var s = '';
  for (var i = range[0]; i <= range[1]; i++) {
    s += (i + 1) + '\n';
  }
  return s;
};

template.rows.style =
template.code.style = function(range, layout) {
  return {
    top: range[0] * layout.char.height
  };
};

template.mark = function(range, buffer) {
  var mark = buffer.mark.get();

  if (mark.begin.y >= range[1] || mark.end.y <= range[0]) return false;
  // if (mark.begin.y < range[0] || mark.end.y > range[1]) return false;

  // var a = {
  //   begin: {
  //     x: 0, //range[0] > mark.begin.y ? 0 : mark.begin.x,
  //     y: Math.max(range[0], mark.begin.y)
  //   },
  //   end: {
  //     x: 0, //range[1] < mark.end.y ? 0 : mark.end.x,
  //     y: Math.min(range[1], mark.end.y)
  //   }
  // };

  // range[0] = a.begin.y;
  // range[1] = a.end.y;

  var offset = buffer.lines.getRange(range);
  var area = buffer.lines.getArea(mark);
  var code = buffer.text.getRange(offset);

  area[0].offset -= offset[0];
  area[1].offset -= offset[0];

  var above = code.substring(0, area[0].offset);
  var middle = code.substring(area[0].offset, area[1].offset);
  var html = syntax.entities(above) + '<mark>' + syntax.entities(middle) + '</mark>';

  return html;
};

template.caret = function() {
  return '';
};

template.caret.style = function(point, _) {
  return {
    left: _.char.width * _.caret.x + _.gutter,
    top: _.char.height * _.caret.y,
  };
};

template.gutter = function() {
  return '';
};

template.gutter.style = function(point, _) {
  return {
    width: 1,
    height: _.rows * _.char.height,
  };
};

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}
