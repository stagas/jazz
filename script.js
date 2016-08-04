var Xoor = require('./xoor');

var xoor = new Xoor;

xoor.use(document.body);

xoor.open('./xoor.js', function(err) {
  if (err) throw err;

  xoor.focus();

  console.log('ready');
});
