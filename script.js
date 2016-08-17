var bindings = require('./bindings');
var Xoor = require('./xoor');

var options = {
  // debug_layers: true,
  center: true,
  hide_rows: true,
};

var xoor = new Xoor(options);

xoor.use(document.body);
xoor.assign(bindings);
xoor.focus();

// setTimeout(() => {
// xoor.open('./xoor.js');
xoor.open('./babel.js');
// xoor.open('./test/syntax.html.js');
// },2000)
