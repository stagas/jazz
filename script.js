var bindings = require('./bindings');
var Xoor = require('./xoor');

var options = {
  debug: {
    // views: true,
  }
};

var xoor = new Xoor(options);

xoor.use(document.body);
xoor.assign(bindings);

xoor.open('./xoor.js', function(err) {
  if (err) throw err;

  xoor.focus();
  setTimeout(function() {
    xoor.focus();
  }, 50)

  console.log('ready');
});
