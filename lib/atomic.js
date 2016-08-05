
module.exports = atomic;

// function atomic(fn) {
//   var stage = false;
//   var n = 0;

//   function wrap() {
//     if (stage) return n++;
//     else fn.call(this);
//   }

//   wrap.hold = function() {
//     stage = true;
//     n = n || 0;
//   };

//   wrap.release = function(context) {
//     if (stage && n) {
//       stage = false;
//       n = 0;
//       fn.call(context);
//     }
//   };

//   return wrap;
// }

function atomic(fn) {
  var request;

  return function() {
    clearImmediate(request);
    request = setImmediate(fn.bind(this));
  };
}
