var Regexp = require('../../lib/regexp');
var R = Regexp.create;

//NOTE: order matters
var syntax = map({
  'operator': R(['operator'], 'g', entities),
  'indent':   R(['indent'],   'gm'),
  'params':   R(['params'],   'g'),
  'declare':  R(['declare'],  'g'),
  'function': R(['function'], 'g'),
  'keyword':  R(['keyword'],  'g'),
  'builtin':  R(['builtin'],  'g'),
  'symbol':   R(['symbol'],   'g'),
  'string':   R(['template string'], 'g'),
  'number':   R(['special','number'], 'g'),
}, compile);

var AnyBlockStart = /[\/'"`]/g;

var Blocks = {
  'single comment': ['//','\n'],
  'double comment': ['/*','*/'],
  'template string': ['`','`'],
  'single quote string': ["'","'"],
  'double quote string': ['"','"'],
  'regexp': ['/','/'],
};

var Tags = {
  'single comment': 'comment',
  'double comment': 'comment',
  'template string': 'string',
  'single quote string': 'string',
  'double quote string': 'string',
  'regexp': 'regexp',
};

var Skip = {
  'single quote string': "\\",
  'double quote string': "\\",
  'single comment': false,
  'double comment': false,
  'regexp': "\\",
};

var Cancel = {
  'single quote string': '\n',
  'double quote string': '\n',
  'regexp': '\n',
};

var Tokens = {};
for (var key in Blocks) {
  var B = Blocks[key];
  Tokens[B[0]] = key;
}

module.exports = Syntax;

function Syntax(o) {
  o = o || {};
  this.maxLine = o.maxLine || 300;
  this.blocks = [];
  this.blocksMap = {};
}

Syntax.prototype.entities = entities;

Syntax.prototype.highlight = function(code, offset) {
  // console.log(0, 'highlight', code)

  //TODO: make method
  var lines = code.split(/\n/g);
  var line;
  var long = [];
  var match;
  var firstIndent = 0;
  var i = 0;
  // for (; i < lines.length; i++) {
  //   line = lines[i];
  //   if (line.length > this.maxLine) {
  //     long.push(lines.splice(i--, 1, '\ueeee'));
  //   }
  // }

  i = 0;
  line = lines[i];
  // console.log(line)
  while (!(match = /\S/g.exec(line))) {
    line = lines[++i];
    // console.log(line)
  }
  for (var j = 0; j < i; j++) {
    lines[j] = new Array(match.index + 1).join(' ');
  }
  var last = true;
  for (; i < lines.length; i++) {
    line = lines[i];
    if (!line.length && lines[i-1].length && lines[i-1][0] === ' ') lines[i] = '  ';
  }

  // }
  code = lines.join('\n');

  code = this.createBlocks(code);

  code = entities(code);

  for (var key in syntax) {
    code = code.replace(syntax[key].regexp, syntax[key].replacer);
  }

  code = this.restoreBlocks(code);

  // code = code.replace(/\ueeee/g, function() {
  //   return long.shift().slice(0, this.maxLine) + '...line too long to display';
  // });

  return code;
};

Syntax.prototype.restoreBlocks = function(code) {
  var block;
  var blocksMap = this.blocksMap;
  return code.replace(
    /\uffe1([a-z]*?)\uffe2/g,
    (_, id) => {
    block = blocksMap[id];
    return '<'+block.tag+'>'+entities(block.value)+'</'+block.tag+'>';
  });
};

Syntax.prototype.createBlocks = function(code) {
  var block = {};
  var blocks = this.blocks = [];
  var blocksMap = this.blocksMap = {};

  var s = '';

  // var cols = 0;

  var i = 0;
  var last = 0;
  var skip = 0;
  var match;

  outer:
  while (i < code.length) {
    // cols = 0;

    AnyBlockStart.lastIndex = i + skip;
    match = AnyBlockStart.exec(code);
    if (!match) {
      s += code.substring(i);
      break;
    }

    var lastLineOffset = code.lastIndexOf('\n', match.index);
    // if (match.index - lastLineOffset > 500) {
    //   s += code.substring(last, lastLineOffset + 500) + '...line too long to display';
    //   i = code.indexOf('\n', match.index);
    //   last = i;
    //   continue;
    // }

    i = match.index;
    s += code.substring(last, i);
    last = i;
    skip = 0;

    inner:
    for (; i < code.length; i++) {
      var one = code[i];
      var next = code[i + 1];
      var two = one + next;

      var o = Tokens[two];
      if (!o) o = Tokens[one];
      if (!o) {
        // if ('\n' === one) cols = 0;
        // else if (cols++ > this.maxLine) {
        //   s += '...line too long to display';
        //   i = code.indexOf('\n', i) - 1;
        //   cols = 0;
        //   continue;
        // }
        s += one;
        continue;
      }

      last = i;

      var B = Blocks[o];
      var waitFor = B[1];

      i += waitFor.length - 1;

      switch (waitFor.length) {
        case 1:
          while (++i < code.length) {
            one = code[i];
            // cols++;
            // if ('\n' === one) cols = 0;
            // if (cols > this.maxLine) break;
            if (one === Skip[o]) {
              ++i;
              continue;
            }
            if (waitFor === one) {
              i += 1;
              break;
            }
            if (i === code.length - 1) {
              i = last;
              skip = 1;
              continue outer;
            }
            if (one === Cancel[o]) {
              i = last + 1;
              continue outer;
            }
          }
          break;
        case 2:
          while (++i < code.length) {
            one = code[i];
            two = code[i] + code[i + 1];
            // cols++;
            // if ('\n' === one) cols = 0;
            // if (cols > this.maxLine) break;
            if (one === Skip[o]) {
              ++i;
              continue;
            }
            if (waitFor === two) {
              i += 2;
              break;
            }
          }
          break;
      }

      if (code[i-1] === '\n') i -= 1;

      block = block.next = {
        id: createId(),
        offset: last,
        length: i - last,
        value: code.substring(last, i),
        tag: Tags[o],
      };

      last = i;

      blocks.push(block);
      blocksMap[block.id] = block;
      s += '\uffe1'+block.id+'\uffe2';
      continue outer;
    }
  }

  return s;
};

function createId() {
  var alphabet = 'abcdefghijklmnopqrstuvwxyz';
  var length = alphabet.length - 1;
  var i = 6;
  var s = '';
  while (i--) {
    s += alphabet[Math.random() * length | 0];
  }
  return s;
}

function entities(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    ;
}

function compile(regexp, tag) {
  var openTag = '<' + tag + '>';
  var closeTag = '</' + tag + '>';
  return {
    name: tag,
    regexp: regexp,
    replacer: openTag + '$&' + closeTag
  };
}

function map(obj, fn) {
  var result = {};
  for (var key in obj) {
    result[key] = fn(obj[key], key);
  }
  return result;
}

function replace(pass, code) {
  for (var i = 0; i < pass.length; i++) {
    code = code.replace(pass[i][0], pass[i][1]);
  }
  return code;
}

function insert(offset, string, part) {
  return string.slice(0, offset) + part + string.slice(offset);
}
