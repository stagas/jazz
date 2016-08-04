var RangeTree = require('./rangetree');

module.exports = Segments;

function Segments(rules) {
  this.tree = new RangeTree;
  this.rules = rules || Segments.RULES;
}

Segments.RULES = [
  {
    name: 'double comment',
    open: '/*',
    close: '*/'
  },
  {
    name: 'template string',
    open: '`',
    close: '`'
  }
  // {
  //   name: 'single comment',
  //   open: '//',
  //   close: '\n'
  // }
  // {
  //   name: 'string',
  //   regexp: /("(?:(?:\\\n|\\"|[^"\n]))*?")|('(?:(?:\\\n|\\'|[^'\n]))*?')|(`(?:(?:\\`|[^`]))*?`)/g,
  // }
];

Segments.prototype.get = function(offset) {
  var steps = this.tree.get(offset);
  var node = steps[0];
  if ('HEAD' === node.value) return null;
  else return {
    node: node,
    offset: offset
  };
};

Segments.prototype.set = function(text) {
  var open, close;
  var line, lineStart, lineComment;
  for (var i = 0; i < this.rules.length; i++) {
    var rule = this.rules[i];
    var index = -1;
    while (~(index = text.indexOf(rule.open, index + rule.open.length))) {
      lineStart = text.lastIndexOf('\n', index);
      line = text.substring(lineStart, index);
      lineComment = Math.max(line.indexOf('//'), line.indexOf("'"), line.indexOf('"'));
      if (lineComment > -1 && lineComment + lineStart < index) continue;
      if (this.get(index)) {
        continue;
      }
      open = index;
      index = text.indexOf(rule.close, index + rule.open.length);

      if (~index) {
        if (this.get(index)) {
          index = open;
          continue;
        }
        close = index + rule.close.length + 1;
        this.tree.insert([open, close], rule.name);
      } else {
        index = open;
      }
    }
  }
};
