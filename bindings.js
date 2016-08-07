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
  }, 60),
  'pagedown': throttle(function() {
    this.move.pageDown();
  }, 60),
  'ctrl+up': throttle(function() {
    this.move.pageUp(6);
  }, 60),
  'ctrl+down': throttle(function() {
    this.move.pageDown(6);
  }, 60),
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
  },

  'ctrl+shift+up': function() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(-1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(-1);
    } else {
      this.buffer.moveAreaByLines(-1, this.mark.area);
      this.mark.shiftByLines(-1);
      this.move.byLines(-1);
    }
  },
  'ctrl+shift+down': function() {
    if (!this.mark.active) {
      this.buffer.moveAreaByLines(+1, { begin: this.caret.pos, end: this.caret.pos });
      this.move.byLines(+1);
    } else {
      this.buffer.moveAreaByLines(+1, this.mark.area);
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
    this.markBegin();
    this.move.byWord(-1);
    this.delete();
  },
  'shift+ctrl+backspace': function() {
    this.markBegin();
    this.move.beginOfLine();
    this.delete();
  },
  'ctrl+delete': function() {
    this.markBegin();
    this.move.byWord(+1);
    this.delete();
  },
  'shift+ctrl+delete': function() {
    this.markBegin();
    this.move.endOfLine();
    this.delete();
  },
  'shift+delete': function() {
    this.move.beginOfLine();
    this.markBegin();
    this.move.endOfLine();
    this.move.byChars(+1);
    this.delete();
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
    var text = this.buffer.get([area.begin.y, area.end.y-1]);
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
    if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
    area.begin.x = 0;
    area.end.x = 0;
    var text = this.buffer.get([area.begin.y, area.end.y-1]);
    // this.views.code.clear();
    this.buffer.deleteArea(area, true);
    this.buffer.insert({ x:0, y:area.begin.y-1 }, text, -1);
    this.mark.begin.y -= 1;
    this.mark.end.y -= 1;
    this.move.byLines(-1);
  },

  'shift+ctrl+down': function() {
    this.markBegin(false);
    var area = this.mark.get();
    if (area.end.x > 0 || area.begin.y === area.end.y) area.end.y += 1;
    area.begin.x = 0;
    area.end.x = 0;
    var text = this.buffer.get([area.begin.y, area.end.y-1]);
    // this.views.code.clear();
    this.buffer.deleteArea(area, true);
    this.buffer.insert({ x:0, y:area.begin.y+1 }, text, +1);
    this.mark.begin.y += 1;
    this.mark.end.y += 1;
    this.move.byLines(+1);
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
