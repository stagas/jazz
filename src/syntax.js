var syntax = exports;

// properties

syntax.replace = function(pass, code) {
  for (var i = 0; i < pass.length; i++) {
    code = code.replace(pass[i][0], pass[i][1]);
  }
  return code;
};

syntax.replace.firstPass = [
  [/\/\*/g, '\ufff1'],
  [/\*\//g, '\ufff2'],
  [/\/\/.*/g, '\ufff3$&'],
  [/(?![^\/])\/(?![\/|\*])(.*?[^\\\^]\/[ gim]+)/g, '\ufff4$&\ufff5'],
];
syntax.replace.secondPass = [
  [/\ufff1/g, '<comment>/*'],
  [/\ufff2/g, '*/</comment>'],
  [/\ufff3(.*)/g, '<comment>$1</comment>'],
  [/\ufff4(.*?)\ufff5/g, '<regexp>$1</regexp>'],
  [/\uffe1/g, '<comment>'],
  [/\uffe2/g, '</comment>'],
  [/\uffe3/g, '<string>'],
  [/\uffe4/g, '</string>'],
  [/\uffaa/g, '<mark>'],
  [/\uffab/g, '</mark>'],
];

syntax.rules = map({
  'operator': /!|&gt;=?|&lt;=?|={1,3}|(?:&amp;){1,2}|\|?\||\?|\*|\/|~|\^|%|\.(?!\d)|\+\+|\-\-/g,
  'keyword': /\b(break|case|catch|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|if|implements|import|in|instanceof|interface|let|new|package|private|protected|public|return|static|super|switch|throw|try|typeof|while|with|yield)\b/g,
  'params': /function[ \(]{1}[^]*?\{/g,
  'declare': /\b(function|interface|class|var|let|const|enum|void)\b/g,
  'builtin': /\b(Object|Function|Boolean|Error|EvalError|InternalError|RangeError|ReferenceError|StopIteration|SyntaxError|TypeError|URIError|Number|Math|Date|String|RegExp|Array|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray|ArrayBuffer|DataView|JSON|Intl|arguments|console|window|document|Symbol|Set|Map|WeakSet|WeakMap|Proxy|Reflect|Promise)\b/g,
  'boolean': /\b(true|false)\b/g,
  'string': /("(?:(?:\\\n|\\"|[^"\n]))*?")|('(?:(?:\\\n|\\'|[^'\n]))*?')|(`(?:(?:\\`|[^`]))*?`)/g,
  'function': / ((?!\d)[a-z0-9_ $]+)(?=\(.*\).*{)/ig,
  'number': /-?\b(0x[\dA-Fa-f]+|\d*\.?\d+([Ee][+-]?\d+)?|NaN|-?Infinity|null|undefined)\b/g,
  'symbol': /[{}[\](),:]/g,
  'operator2': /[-+]/g,
}, compile);

syntax.highlight = function highlight(code) {
  var entities = syntax.entities;
  var replace = syntax.replace;
  var rules = syntax.rules;

  // console.time('syntax highlight');

  // console.time('entities');
  code = entities(code);
  // console.timeEnd('entities');

  // console.time('replace 1st');
  code = replace(syntax.replace.firstPass, code);
  // console.timeEnd('replace 1st');

  for (var name in rules) {
    var rule = rules[name];
    // console.time(rule.name);
    code = code.replace(rule.regexp, rule.replacer);
    // console.timeEnd(rule.name);
  }

  // console.time('replace 2nd');
  code = replace(syntax.replace.secondPass, code);
  // console.timeEnd('replace 2nd');

  // console.time('multiline');
  // for (var name in syntax.multiline.rules) {
  //   if (syntax.multiline.find(name, pos)) {
  //     code = '<' + name + '>' + code;
  //   }
  // }
  // console.timeEnd('multiline');

  // console.timeEnd('syntax highlight');

  return code;
};

syntax.entities = function entities(text) {
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
    replacer: function(match) {
      return openTag + match + closeTag;
    }
  };
}

function map(obj, fn) {
  var result = {};
  for (var key in obj) {
    result[key] = fn(obj[key], key);
  }
  return result;
}
