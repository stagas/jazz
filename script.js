var Xoor = require('./xoor');

var xoor = new Xoor;

xoor.appendTo(document.body);

xoor.open('./xoor.js', function(err) {
  if (err) throw err;

  xoor.focus();

  console.log('ready');
});
