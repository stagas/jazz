
module.exports = bench;

function bench(times, fn, name, mul) {
  var time = Date.now();

  for (var i = times; i--;) {
    fn();
  }

  var diff = Date.now() - time;

  times *= mul || 1;

  return {
    name: name,
    times: times,
    total: diff,
    persec: (1000 / (diff / times)).toFixed(2),
    perframe: ((1000 / 60) / (diff / times)).toFixed(2),
    single: (diff / times).toFixed(4)
  };
}
