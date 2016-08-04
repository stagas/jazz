
module.exports = function(fn, ms) {
  var timeout;

  return function(a, b, c) {
    clearTimeout(timeout);
    timeout = setTimeout(fn.bind(this), ms, a, b, c);
  };
};
