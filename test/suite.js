
module.exports = suite;

function suite(root, name, paths) {
  var setup = require(normalize(root, name));
  var tests = paths
    .map(normalize.bind(null, root))
    .map(require)
    .map(load.bind(null, setup));

  return tests;
}

function load(setup, mod) {
  var t = {};
  setup(add(t), mod);
  return t;
}

function add(t) {
  return function(desc, fn) {
    t[desc] = fn;
  };
}

function normalize(root, path) {
  return root + '/' + path;
}

function merge(a, b) {
  for (var key in b) {
    a[key] = b[key];
  }
  return a;
}
