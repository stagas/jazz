
var AUTORUN = true;
var BENCH = false;
var BENCH_TIMES = 10e1;

require.paths.push('/test');
var suite = require('suite');
var assert = require('assert');
var test = require('test');
var _bench = require('bench');

var el = setup({
  // 'lib/diff.test': ['lib/diff'],
  // 'lib/trim.test': ['lib/trim'],
  'src/buffer/skipstring.test': ['src/buffer/skipstring'],
  // 'src/buffer/tokens.test': ['src/buffer/tokens'],
  'src/buffer/parts.test': ['src/buffer/parts'],
  'src/buffer/test': ['src/buffer'],
  'src/buffer/prefixtree.test': ['src/buffer/prefixtree'],
  // 'src/buffer/test': ['src/buffer'],
});

append(document.body, el);

if (AUTORUN) {
  setTimeout(function() {
    [].forEach.call(document.querySelectorAll('.execall'), function(el) {
      el.click();
    });
    setTimeout(function() {
      window.scrollTo(0, document.body.offsetHeight);
    })
  });
}

var render = {
  test: function(results) {
    return results.map(function(res) {
      if (!res.pass) setTimeout(function() {
        throw res.error;
      }, 0);
      return res.pass
        ? '<div style="color: #4b4;">pass<span style="font-size:18pt; position: absolute; left: -12px; top: -4px;">✓</span></div>'
        : '<div style="background: red; color: white; display: inline-block; width: 80%;">fail<span style="font-size:21.5pt; color: red; position: absolute; left: -12px; top: -12px;">𝀘</span></div>'
      + '<div style="display: block; color: #28a; margin: 6px 0;">' + res.error.message + '</div>'
      + '<pre style="display: inline-block; text-align:left; font-size: 8pt; margin: 0 0 7px;">'
      + (res.error.meta && res.error.meta.left != null && res.error.meta.right != null
      ? '<b>Expected:</b> ' + safe(res.error.meta.left)
      + '\n<b>  Actual:</b> ' + safe(res.error.meta.right)
      : '')
      + '</pre>'
    }).join(' ');
  },
  bench: function(results) {
    var totals = results.map(function(res) {
      return res.perframe;
    });
    var max = Math.max.apply(Math, totals);
    var html = results.map(function(res, i) {
      return '<div style="background: #e73; text-align: right; color: #ff7; margin-bottom: 1px; width: ' + (res.perframe / max * 100).toFixed(3) + '%;">' + res.perframe + ' o/f&nbsp;</div>';
    }).join('');
    return html;
  }
};

function bench(fn) {
  assert.disable = true;
  var res = _bench(BENCH_TIMES, fn);
  assert.disable = false;
  return res;
}

function run(tests, caseName, fn) {
  return tests.map(function(t) {
    return fn(t[caseName]);
  });
}

function setup(obj) {
  var t = {};

  for (var key in obj) {
    var s = suite('..', key, obj[key]);

    var execs = {};
    execs.test = [];
    if (BENCH) execs.bench = [];

    var runners = [];
    runners.push(test);
    if (BENCH) runners.push(bench);

    t[key] = {
      suite: s,
      execs: execs,
      runners: runners
    };
  }

  var el = h('div', 'suite',
    Object.keys(t).map(function(key) {
      return h('div', 'item', [
        h('div', 'header', key),
        h('table', 'cases',
          [h('tr', null,
            [h('th')].concat(
              t[key].runners.map(function(runner) {
                var button = h('button', 'execall', runner.name + ' all');
                button.onclick = runAll(t[key].execs[runner.name]);
                return h('th', null, [button]);
              })
            )
          )].concat(
            Object.keys(t[key].suite[0]).map(function(caseName) {
              return h('tr', 'case', [
                h('td', 'name', caseName)
              ].concat(t[key].runners.map(function(runner) {
                var resultEl = h('div', 'result');
                var execEl = h('button', 'exec', runner.name);
                var onclick = function() {
                  var results = run(t[key].suite, caseName, runner);
                  var html = render[runner.name](results);
                  resultEl.innerHTML = html;
                };
                t[key].execs[runner.name].push(onclick);
                execEl.onclick = onclick;
                return h('td', 'runner', [resultEl, execEl]);
              })))
            })
          )
        )
      ])
    })
  );

  return el;
}

function runAll(array) {
  return function() {
    array.map(function(fn) { fn() });
  };
}

function h(tag, className, children) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (Array.isArray(children)) {
    children.forEach(append.bind(null, el));
  } else if (children) {
    el.innerHTML = children;
  }
  return el;
}

function append(target, el) {
  target.appendChild(el);
  return el;
}

function safe(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
