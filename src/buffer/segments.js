var Point = require('../../lib/point');

var Begin = /[\/'"`]/g;

var Match = {
  'single comment': ['//','\n'],
  'double comment': ['/*','*/'],
  'template string': ['`','`'],
  'single quote string': ["'","'"],
  'double quote string': ['"','"'],
  'regexp': ['/','/'],
};

var Type = {
  '{': ['curly', 'open curly'],
  '}': ['curly', 'close curly'],
  '[': ['square', 'open square'],
  ']': ['square', 'close square'],
  '(': ['parens', 'open parens'],
  ')': ['parens', 'close parens'],
  '/': ['segment', 'open comment'],
  '*': ['segment', 'close comment'],
  '`': ['segment', 'template string'],
};

var Skip = {
  'single quote string': "\\",
  'double quote string': "\\",
  'single comment': false,
  'double comment': false,
  'regexp': "\\",
};

var Token = {};
for (var key in Match) {
  var M = Match[key];
  Token[M[0]] = key;
}

var Length = {
  'open comment': 2,
  'close comment': 2,
  'template string': 1,
};

var NotOpen = {
  'close comment': true
};

var Closes = {
  'open comment': 'close comment',
  'template string': 'template string',
};

var Tag = {
  'open comment': 'comment',
  'template string': 'string',
};

var TOKEN = /\/\*|\*\/|`/g;
// var TOKEN = /\/\*|\*\/|`|\{|\}|\[|\]|\(|\)/g;

module.exports = Segments;

function Segments(buffer) {
  this.buffer = buffer;
  this.reset();
}

Segments.prototype.clearCache = function() {
  this.cache = {
    offset: {},
    range: {},
    point: {},
    state: [],
    stateMap: {},
  };
};

Segments.prototype.reset = function() {
  this.segments = [];
  this.blocks = {
    curly: [],
    square: [],
    parens: [],
    segment: this.segments
  };
  this.clearCache();
};

Segments.prototype.get = function(y) {
  // if (y in this.cache.point) {
  //   return this.cache.point[y];
  // }

  var open = false;
  var state = null;
  var waitFor = '';
  var point = { x:-1, y:-1 };
  var close = 0;
  var segment;
  var range;
  var text;
  var valid;
  var last;

  var i = 0;

  var state = this.getCacheState(y);
  if (state) {
    open = true;
    i = state.index + 1;
    state = state.state;
    waitFor = Closes[state.type];
    // console.log('has cache', state, i)
  }

  for (; i < this.segments.length; i++) {
    segment = this.segments[i];

    // searching for close token
    if (open) {
      if (waitFor === segment.type) {
        point = this.getPointOffset(segment.offset);

        if (!point) {
          return (this.cache.point[y] = null);
        }

        if (point.y >= y) {
          return (this.cache.point[y] = Tag[state.type]);
        }

        last = segment;
        last.point = point;
        state = null;
        open = false;

        if (point.y >= y) break;
      }
    }

    // searching for open token
    else {
      point = this.getPointOffset(segment.offset);

      if (!point) {
        return (this.cache.point[y] = null);
      }

      range = point.line.range;

      if (last && last.point.y === point.y) {
        close = last.point.x + Length[last.type];
      } else {
        close = 0;
      }

      valid = this.isValidRange([range[0], range[1]+1], segment, close);

      if (valid) {
        if (NotOpen[segment.type]) continue;
        open = true;
        state = segment;
        state.point = point;
        waitFor = Closes[state.type];
        if (!(state.offset in this.cache.stateMap)) {
          this.cache.state.push(state);
          this.cache.stateMap[state.offset] = true;
        }
      }

      if (point.y >= y) break;
    }
  }

  if (state && state.point.y < y) {
    return (this.cache.point[y] = Tag[state.type]);
  }

  return (this.cache.point[y] = null);
};

//TODO: cache in Lines
Segments.prototype.getPointOffset = function(offset) {
  if (offset in this.cache.offset) return this.cache.offset[offset]
  return (this.cache.offset[offset] = this.buffer.lines.getOffset(offset));
};

Segments.prototype.isValidRange = function(range, segment, close) {
  var key = range.join();
  if (key in this.cache.range) return this.cache.range[key];
  var text = this.buffer.text.getRange(range);
  var valid = this.isValid(text, segment.offset - range[0], close);
  return (this.cache.range[key] = valid);
};

Segments.prototype.isValid = function(text, offset, lastIndex) {
  Begin.lastIndex = lastIndex;

  var match = Begin.exec(text);
  if (!match) return;

  i = match.index;

  last = i;

  var valid = true;

  outer:
  for (; i < text.length; i++) {
    var one = text[i];
    var next = text[i + 1];
    var two = one + next;
    if (i === offset) return true;

    var o = Token[two];
    if (!o) o = Token[one];
    if (!o) {
      continue;
    }

    var waitFor = Match[o][1];

    // console.log('start', i, o)
    last = i;

    switch (waitFor.length) {
      case 1:
        while (++i < text.length) {
          one = text[i];

          if (one === Skip[o]) {
            ++i;
            continue;
          }

          if (waitFor === one) {
            i += 1;
            break;
          }

          if ('\n' === one && !valid) {
            valid = true;
            i = last + 1;
            continue outer;
          }

          if (i === offset) {
            valid = false;
            continue;
          }
        }
        break;
      case 2:
        while (++i < text.length) {

          one = text[i];
          two = text[i] + text[i + 1];

          if (one === Skip[o]) {
            ++i;
            continue;
          }

          if (waitFor === two) {
            i += 2;
            break;
          }

          if ('\n' === one && !valid) {
            valid = true;
            i = last + 2;
            continue outer;
          }

          if (i === offset) {
            valid = false;
            continue;
          }
        }
        break;
    }
  }
  return valid;
}

Segments.prototype.getSegment = function(offset) {
  var begin = 0;
  var end = this.segments.length;
  if (!end) return;

  var p = -1;
  var i = -1;
  var s;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    s = this.segments[i];
    if (s.offset < offset) begin = i;
    else end = i;
  } while (p !== i);

  return {
    segment: s,
    index: i
  };
};

Segments.prototype.getCacheState = function(y) {
  var begin = 0;
  var end = this.cache.state.length;
  if (!end) return;

  var p = -1;
  var i = -1;
  var s;

  do {
    p = i;
    i = begin + (end - begin) / 2 | 0;
    s = this.cache.state[i];
    if (s.point.y < y) begin = i;
    else end = i;
  } while (p !== i);

  if (y - 1 < s.point.y) return null;
  else return {
    state: s,
    index: i
  };
};

Segments.prototype.shift = function(offset, shift) {
  var s = this.getSegment(offset);
  if (!s) return;

  for (var i = s.index + (offset-shift > s.segment.offset); i < this.segments.length; i++) {
    this.segments[i].offset += shift;
  }

  // if (shift < 0) {
  //   this.invalidCacheAfter = {
  //     offset: offset,
  //     point: this.buffer.lines.getOffset(offset)
  //   };
  // }
};

Segments.prototype.index = function(text) {
  this.reset();

  var blocks = this.blocks;
  var match;
  var type;

  // console.time('segments');
  while (match = TOKEN.exec(text)) {
    type = Type[text[match.index]];
    blocks[type[0]].push({
      type: type[1],
      offset: match.index,
      point: null
    });
  }

  // console.log('index!')
  // console.timeEnd('segments');
  this.get(this.buffer.loc);
};
