
/*!
 *
 * async-map
 *
 */

/**
 * Expose `map`.
 */

module.exports = map;

/**
 * Invokes `fn` for all elements in `arr`
 * and calls `cb` when done.
 *
 * @param {Array} arr
 * @param {Function} fn
 * @param {Function} cb
 * @api public
 */

function map(arr, fn, cb){
  var len = arr.length;
  if (!len) return cb(null, []);

  var results = new Array(len);
  var failed = false;
  var count = len;

  for (var i = 0; i < len; i++) {
    invoke(i);
  }

  function invoke(i){
    fn(arr[i], function(err, res){
      if (failed) return;
      if (err) {
        failed = true;
        return cb(err);
      }

      results[i] = res;

      --count || cb(null, results);
    });
  }
}