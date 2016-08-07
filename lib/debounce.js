
module.exports = function(fn, ms, first) {
  var timeout;
  var _first = first;

  function debounceWrap(a, b, c) {
    clearTimeout(timeout);

    timeout = setTimeout(() => {
      first = _first;
      fn.call(this, a, b, c);
    }, ms);

    if (first) {
      fn.call(this, a, b, c);
      first = false;
    }
  }

  debounceWrap.cancel = function() {
    clearTimeout(timeout);
  };

  return debounceWrap;
};
