var bindings = require('./bindings');
var Xoor = require('./xoor');




var xoor = new Xoor;

xoor.use(document.body);
xoor.assign(bindings);

xoor.open('./babel.js', function(err) {
  if (err) throw err;

  xoor.focus();
  setTimeout(function() {
    xoor.focus();
  }, 50)


  console.log('ready');
});
