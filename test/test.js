
module.exports = test;

var meta = {
  left: '',
  right: ''
};

function test(fn) {
  var error = null;
  var pass;

  try {
    fn();
    pass = true;
  } catch(e) {
    e.meta = e.meta || meta;
    error = e;
    pass = false;
  }

  return {
    pass: pass,
    error: error
  };
}
