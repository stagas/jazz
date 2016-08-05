
module.exports = assert;

assert.disabled = false;

function assert(expr, msg) {
  if (assert.disabled) return;

  if (!expr) {
    throw new Error(msg || 'assertion failed');
  }
}

assert.equal = function(l, r, msg) {
  if (assert.disabled) return;

  if (!equal(l, r)) fail(l, r, msg);
};

assert.throws = function(contains, fn, msg) {
  if (assert.disabled) return;

  if (arguments.length <= 2) {
    msg = fn;
    fn = contains;
    contains = null;
  }

  var passed = false;
  var error;

  try {
    fn();
    passed = false;
  } catch(e) {
    error = e;
    passed = true;
  }

  if (passed) return;
  else fail(null, fn.toString(), msg || 'to throw');

  if (contains) {
    assert(
      e.message.indexOf(contains) > -1,
      msg || '"' + e.message + '" does not contain "' + contains + '"'
    );
  }
};

function equal(l, r, visited) {
  visited = visited || [];

  var lt = typeof l;
  if (lt !== 'object' || null === l) {
    return l === r;
  }

  if (~visited.indexOf(l)) return true;
  if (~visited.indexOf(r)) return true;

  visited.push(l, r);

  var lk = Object.keys(l);
  var rk = Object.keys(r);

  for (var i = lk.length; i--;) {
    var key = lk[i];
    if (!equal(l[key], r[key])) return false;
  }

  for (var i = rk.length; i--;) {
    var key = rk[i];
    if (!equal(l[key], r[key])) return false;
  }

  return true;
}

function fail(l, r, msg) {
  var ls = '', rs = '';

  try {
    ls = l != null ? JSON.stringify(l, null, Array.isArray(l) ? null : '  ') : msg || '';
    rs = JSON.stringify(r, null, Array.isArray(r) ? null : '  ');
  } catch(_) {
    ls = rs = '';
  }

  var error = new Error(msg == null ? 'not equal' : msg);
  error.meta = { left: ls, right: rs };

  throw error;
}
