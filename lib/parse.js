var TOKENS = /.+?\b|.\B|\b.+?/g;
var WORD = /[./\\\(\)"'\-:,.;<>~!@#$%^&*\|\+=\[\]{}`~\? ]+/g;

var parse = exports;

parse.words = function(s) {
  var words = [];
  var word;

  while (word = WORD.exec(s)) {
    words.push(word);
  }

  return words;
};

parse.tokens = function(s) {
  var words = [];
  var word;

  while (word = TOKENS.exec(s)) {
    words.push(word);
  }

  return words;
};
