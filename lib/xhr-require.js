(function() {

self.require = require;

require.paths = ['/lib'];

require.modules = Object.create(null);

require.resolve = function(name, parent) {
  if ('..' === name.substr(0,2)) {
    var parentParts = parent.split('/');
    var nameParts = name.split('/');
    var fileName = parentParts.pop();
    while (nameParts[0] === '..' && nameParts.shift()) parentParts.pop();
    parentParts.push(fileName);
    name = nameParts.join('/');
    parent = parentParts.join('/');
  } else if ('/' === name[0]) {
    parent = self.location.origin;
  } else if ('.' !== name[0]) {
    parent = self.location.origin;
    // to work with blob created Workers
    if ('blob' === parent.substr(0,4)) {
      parent = self.location.origin;
    }
  }

  var path = new URL(name, parent).href;

  if (path in require.modules) {
    return require.modules[path].path;
  } else {
    return path;
  }
};

require.load = function(name, parent) {
  var path = require.resolve(name, parent);

  var m
    = require.modules[path]
    = require.modules[path]
    || {};

  if (m.isFetched) return m;

  m.request = getModule(path);
  m.isFetched = true;

  if (m.request === false) return m;

  m.path = m.request.responseURL;
  m.body = m.request.responseText;
  m.exports = {};
  m.require = require.bind(null, m.path);
  m.fn = new Function('module', 'exports', 'require', m.body);
  m.isExecuted = false;

  require.modules[m.path] = m;

  return m;
};

function require(parent, name) {
  if (arguments.length < 2) {
    name = parent;
    parent = self.location.href;
  }

  var m = require.load(name, parent);

  if (!m.request) {
    throw new Error('Unable to load module "' + name + '" under "' + parent + '"');
  } else if (!m.isExecuted) {
    m.isExecuted = true;
    m.fn(m, m.exports, m.require);
  }

  return m.exports;
}

function getModule(path) {
  var originalPath = path;
  var path = stripLocation(path);
  return get(path) || pathsGet(require.paths, path) || get(originalPath);
}

function stripLocation(path) {
  var index = path.indexOf(self.location.origin);
  if (index === 0) path = path.substr(self.location.origin.length);
  return path;
}

function pathsGet(paths, path) {
  paths = paths.slice();
  var p;
  var req;
  while (p = paths.shift()) {
    req = get(p + path);
    if (req) return req;
  }
}

function get(path) {
  var name = path.split(/\//g).pop();
  return xhr(path + '.js') || xhr(path + '/' + name + '.js') || xhr(path + '/index.js') || xhr(path);
}

function xhr(path) {
  var req = new XMLHttpRequest;
  req.open('get', path, false);
  req.send(null);
  if (req.status >= 200 && req.status < 400) {
    return req;
  } else {
    return false;
  }
}

})();