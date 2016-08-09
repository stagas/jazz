var throttle = require('throttle');

var keys = module.exports = {
  'ctrl+z': function() {
    this.history.undo();
  },
  'ctrl+y': function() {
    this.history.redo();
  },

  'home': function() {
    this.move.beginOfLine();
  },
  'end': function() {
    this.move.endOfLine();
  },
  'pageup': throttle(function() {
    this.move.pageUp();
  }, 1000/13),
  'pagedown': throttle(function() {
    this.move.pageDown();
  }, 1000/13),
  'ctrl+up': throttle(function() {
    this.move.pageUp(6);
  }, 1000/13),
  'ctrl+down': throttle(function() {
    this.move.pageDown(6);
  }, 1000/13),
  'left': function() {
    this.move.byChars(-1);
  },
  'up': function() {
    this.move.byLines(-1);
  },
  'right': function() {
    this.move.byChars(+1);
  },
  'down': function() {
    this.move.byLines(+1);
  },

  'ctrl+left': function() {
    this.move.byWord(-1);
  },
  'ctrl+right': function() {
    this.move.byWord(+1);
  },

  'ctrl+a': function() {
    this.move.beginOfFile();
    this.markBegin();
    this.move.endOfFile();
    this.markEnd();
  },

  'ctrl+shift+up': function() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(-1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(-1);
    } else {
      this.buffer.moveAreaByLines(-1, this.mark.get());
      this.mark.shiftByLines(-1);
      this.move.byLines(-1);
    }
  },
  'ctrl+shift+down': function() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(+1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(+1);
    } else {
      this.buffer.moveAreaByLines(+1, this.mark.get());
      this.mark.shiftByLines(+1);
      this.move.byLines(+1);
    }
  },

  'backspace': function() {
    this.backspace();
  },
  'delete': function() {
    this.delete();
  },
  'ctrl+backspace': function() {
    if (this.move.isBeginOfFile()) return;
    this.markClear();
    this.markBegin();
    this.move.byWord(-1);
    this.delete();
  },
  'shift+ctrl+backspace': function() {
    this.markClear();
    this.markBegin();
    this.move.beginOfLine();
    this.delete();
  },
  'ctrl+delete': function() {
    if (this.move.isEndOfFile()) return;
    this.markClear();
    this.markBegin();
    this.move.byWord(+1);
    this.backspace();
  },
  'shift+ctrl+delete': function() {
    this.markClear();
    this.markBegin();
    this.move.endOfLine();
    this.backspace();
  },
  'shift+delete': function() {
    this.markClear();
    this.move.beginOfLine();
    this.markBegin();
    this.move.endOfLine();
    this.move.byChars(+1);
    this.backspace();
  },

  'shift+ctrl+d': function() {
    var clear = false;
    if (!this.mark.active) clear = true;
    this.markBegin(false);
    var area = this.mark.get();
    if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
    area.begin.x = 0;
    area.end.x = 0;
    var lines = area.end.y - area.begin.y;
    var text = this.buffer.get([area.begin.y, area.end.y]);
    this.buffer.insert({ x: 0, y: this.caret.y }, text);
    if (clear) {
      this.markClear();
    } else {
      this.mark.begin.y += lines;
      this.mark.end.y += lines;
    }
    this.move.byLines(lines);
  },

  'shift+ctrl+up': function() {
    this.markBegin(false);
    var area = this.mark.get();
    if (this.buffer.moveAreaByLines(-1, area)) {
      this.mark.shiftByLines(-1);
      this.move.byLines(-1);
    }
  },

  'shift+ctrl+down': function() {
    this.markBegin(false);
    var area = this.mark.get();
    if (this.buffer.moveAreaByLines(+1, area)) {
      this.mark.shiftByLines(+1);
      this.move.byLines(+1);
    }
  },

  'tab': function() {
    var res = this.suggest();
    if (!res) {
      this.insert('  ');
    } else {
      this.markSetArea(res.area);
      this.insert(res.node.value);
    }
  },

  'ctrl+f': function() {
    this.find.open();
  },

  'f3': function() {
    this.findJump(+1);
  },
  'shift+f3': function() {
    this.findJump(-1);
  },

  'ctrl+/': function() {
    var clear = false;
    var caret = this.caret.copy();
    var area;
    var text;
    if (!this.mark.active) {
      clear = true;
      this.markClear();
      this.move.beginOfLine();
      this.markBegin();
      this.move.endOfLine();
      area = this.mark.get();
      text = this.buffer.getArea(area);
    } else {
      this.markBegin(false);
      area = this.mark.get();
      area.begin.x = 0;
      area.end.x = 0;
      text = this.buffer.get([area.begin.y, area.end.y-1]);
    }

    if (text.substr(0,2) === '//') {
      text = text.replace(/^.*?\/\/ (.+)/gm, '$1');
    } else {
      text = text.replace(/^.+/gm, '// $&');
    }

    this.insert(text);
    this.mark.set(area);
    this.mark.active = !clear;
    this.caret.set(caret);
    this.markEnd();
    if (clear) {
      this.markClear();
    }
  },

  'shift+ctrl+/': function() {
    var clear = false;
    if (!this.mark.active) clear = true;
    var caret = this.caret.copy();
    this.markBegin(false);
    var area = this.mark.get();
    var text = this.buffer.getArea(area);
    if (text.slice(0,2) === '/*' && text.slice(-2) === '*/') {
      text = text.slice(2,-2);
      area.end.x -= 2;
      if (area.end.y === area.begin.y) area.end.x -= 2;
    } else {
      text = '/*' + text + '*/';
      area.end.x += 2;
      if (area.end.y === area.begin.y) area.end.x += 2;
    }
    this.insert(text);
    this.mark.set(area);
    this.mark.active = !clear;
    this.caret.set(caret);
    this.markEnd();
    if (clear) {
      this.markClear();
    }
  }
};

keys.single = {
  'shift:up': function() {
    this.markEnd();
  }
};

// selection keys
[ 'home','end',
  'pageup','pagedown',
  'left','up','right','down',
  'ctrl+left','ctrl+right'
].forEach(function(key) {
  keys['shift+'+key] = function(e) {
    this.markBegin();
    keys[key].call(this, e);
  };
});
