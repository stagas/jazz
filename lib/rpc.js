var slice = [].slice;
var load = require('lib/load');

module.exports = function init(fn) {
  load('/lib/xhr-require.js', function(body) {
    requirefn = body;

    fn(rpc);

    function rpc(proto) {
      var instance = {};

      for (var method in proto) {
        instance[method] = createProcedure(method, proto[method]);
      }

      return instance;
    };
  });
};

function createProcedure(method, fn) {
  var callbacks = {};
  var id = 0;

  var worker = createWorker(fn);

  worker.onmessage = function(e) {
    var params = JSON.parse(e.data);
    var time = Date.now() - params.timestamp;
    console.log(method + '():', time + 'ms')
    var cb = callbacks[params.id];
    delete callbacks[params.id];
    cb(params.error, params.result);
  };

  return function remoteProcedureCall() {
    var args = slice.call(arguments);
    var cb = args.pop();
    callbacks[++id] = cb;
    worker.postMessage(JSON.stringify({
      id: id,
      args: args,
      timestamp: Date.now()
    }));
  };
}

function createWorker(fn) {
  var s = [requirefn, 'procedure = '+fn, 'onmessage = ' + call].join(';')
  var blob = new Blob([s], { type: "application/javascript" });
  var worker = new Worker(URL.createObjectURL(blob));
  return worker;

  function call(e) {
    var params = JSON.parse(e.data);
    var error, result;
    try {
      result = procedure.apply(null, params.args);
    } catch(e) {
      error = e;
    }
    self.postMessage(JSON.stringify({
      id: params.id,
      error: error && error.message,
      result: result,
      timestamp: params.timestamp
    }));
  }
}

/*

var remote = rpc({
  method: method
  other: other
});


 */