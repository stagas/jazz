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

// setTimeout(() => {

xoor.open('./test/syntax.html.js', function(err) {
// xoor.open('./babel.js', function(err) {
  if (err) throw err;

  xoor.focus();
  setTimeout(function() {
    xoor.focus();
  }, 50)

  console.log('ready');
});

// },2000)
