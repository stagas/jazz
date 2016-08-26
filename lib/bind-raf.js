module.exports = function(fn) {
  var request;
  return function rafWrap(a, b, c, d) {
    window.cancelAnimationFrame(request);
    request = window.requestAnimationFrame(fn.bind(this, a, b, c, d));
  };
};
