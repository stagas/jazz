var syntax = require('./syntax');

var symbol = {
  'double comment': '\uffe1',
  'double comment close': '\uffe2',
  'template string': '\uffe3',
  'template string close': '\uffe4'
};

var template = exports;

template.code = function(range, _) {
  var code = _.buffer.get(range);

  // if (template.code.memoize.param === code) {
  //   return template.code.memoize.result;
  // } else {
  //   template.code.memoize.param = code;
  //   template.code.memoize.result = false;
  // }

  if (code.length > 10000) {
    return syntax.entities(code);
  }

  var offset = _.buffer.lines.get(range[0]);
  var segment = _.buffer.segments.get(offset);

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

  return html;
};

// singleton memoize for fast last repeating value
template.code.memoize = {
  param: '',
  result: ''
};

template.rows = function(range, _) {
  var s = '';
  for (var i = range[0]; i <= range[1]; i++) {
    s += (i + 1) + '\n';
  }
  return s;
};

template.mark = function(range, _) {
  var mark = _.mark.get();

  var offset = _.buffer.lines.getRange(range);
  var area = _.buffer.lines.getArea(mark);
  var code = _.buffer.text.getRange(offset);

  area[0].offset -= offset[0];
  area[1].offset -= offset[0];

  var above = code.substring(0, area[0].offset);
  var middle = code.substring(area[0].offset, area[1].offset);
  var html = syntax.entities(above) + '<mark>' + syntax.entities(middle) + '</mark>';

  html = html.replace(/\n/g, ' \n');

  return html;
};

template.find = function(range, _) {
  var results = _.findResults;

  var begin = 0;
  var end = results.length;
  var prev = -2;
  var i = -1;

  do {
    prev = i;
    i = begin + (end - begin) / 2 | 0;
    if (results[i].y <= range[0]) begin = i;
    else end = i;
  } while (prev !== i);

  var width = _.findValue.length * _.char.width + 'px';

  var html = '';
  var r;

  while (results[i] && results[i].y < range[1]) {
    r = results[i++];
    html += '<i style="'
      + 'width:' + width + ';'
      + 'top:' + (r.y * _.char.height) + 'px;'
      + 'left:' + (r.x * _.char.width + _.gutter) + 'px;'
      + '"></i>';
  }

  return html;
};

template.find.style = function() {
  //
};

template.mark.style =
template.rows.style =
template.code.style = function(range, _) {
  return {
    top: range[0] * _.char.height,
    height: (range[1] - range[0] + 1) * _.char.height
  };
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
