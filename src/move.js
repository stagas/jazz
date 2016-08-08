var Regexp = require('regexp');
var Events = require('events');
var Point = require('point');

var WORDS = Regexp.create(['words'], 'g');

var move = {};

move.byWord = function(buffer, p, dx) {
  var line = buffer.getLine(p.y);

  if (dx > 0 && p.x >= line.length - 1) { // at end of line
    return move.byChars(buffer, p, +1); // move one char right
  } else if (dx < 0 && p.x === 0) { // at begin of line
    return move.byChars(buffer, p, -1); // move one char left
  }

  var words = Regexp.parse(line, WORDS);
  var word;

  if (dx < 0) words.reverse();

  for (var i = 0; i < words.length; i++) {
    word = words[i];
    if (dx > 0
      ? word.index > p.x
      : word.index < p.x) {
      return {
        x: word.index,
        y: p.y
      };
    }
  }

  // reached begin/end of file
  return dx > 0
    ? move.endOfLine(buffer, p)
    : move.beginOfLine(buffer, p);
};

move.byChars = function(buffer, p, dx) {
  var lines = buffer.lines;
  var x = p.x;
  var y = p.y;

  if (dx < 0) { // going left
    x += dx; // move left
    if (x < 0) { // when past left edge
      if (y > 0) { // and lines above
        y -= 1; // move up a line
        x = lines.getLineLength(y); // and go to the end of line
      } else {
        x = 0;
      }
    }
  } else if (dx > 0) { // going right
    x += dx; // move right
    while (x - lines.getLineLength(y) > 0) { // while past line length
      if (y === lines.length) { // on end of file
        x = lines.getLineLength(y); // go to end of line on last line
        break; // and exit
      }
      x -= lines.getLineLength(y) + 1; // wrap this line length
      y += 1; // and move down a line
    }
  }

  return {
    x: x,
    y: y
  };
};

move.byLines = function(buffer, p, dy) {
  var lines = buffer.lines;
  var x = p.x;
  var y = p.y;

  if (dy < 0) { // going up
    if (y + dy > 0) { // when lines above
      y += dy; // move up
    } else {
      y = 0;
    }
  } else if (dy > 0) { // going down
    if (y < lines.length - dy) { // when lines below
      y += dy; // move down
    } else {
      y = lines.length;
    }
  }

  if (x > lines.getLine(y).length) {
    x = lines.getLine(y).length;
  }

  return {
    x: x,
    y: y
  };
};

move.beginOfLine = function(_, p) {
  return {
    x: 0,
    y: p.y
  };
};

move.endOfLine = function(buffer, p) {
  return {
    x: buffer.lines.getLine(p.y).length,
    y: p.y
  };
};

move.beginOfFile = function() {
  return {
    x: 0,
    y: 0
  };
};

move.endOfFile = function(buffer) {
  var last = buffer.lines.length;
  return {
    x: buffer.lines.getLine(last).length,
    y: last
  };
};

move.isBeginOfFile = function(_, p) {
  return p.x === 0 && p.y === 0;
};

move.isEndOfFile = function(buffer, p) {
  var last = buffer.loc;
  return p.y === last && p.x === buffer.lines.getLineLength(last);
};

module.exports = Move;

function Move(editor) {
  Events.call(this);
  this.editor = editor;
}

Move.prototype.__proto__ = Events.prototype;

Object.keys(move).forEach(function(method) {
  Move.prototype[method] = function(param) {
    var result = move[method](
      this.editor.buffer,
      this.editor.caret,
      param
    );

    if ('is' === method.slice(0,2)) return result;

    this.emit('move', result);
  };
});

Move.prototype.pageDown = function(div) {
  div = div || 1;
  var _ = this.editor;
  var page = _.page.height / div | 0;
  var size = _.size.height / div | 0;
  var remainder = size - page * _.char.height | 0;
  this.editor.animateScrollVertical(size - remainder);
  return this.byLines(page);
};

Move.prototype.pageUp = function(div) {
  div = div || 1;
  var _ = this.editor;
  var page = _.page.height / div | 0;
  var size = _.size.height / div | 0;
  var remainder = size - page * _.char.height | 0;
  this.editor.animateScrollVertical(-(size - remainder));
  return this.byLines(-page);
};
