var bindings = require('./bindings');
var Jazz = require('./jazz');

var options = {
  // debug_layers: true,
  // center: true,
  hide_rows: true,
  // margin_left: 150,
};

var jazz = new Jazz(options);

jazz.use(document.body);
jazz.assign(bindings);
jazz.focus();

// setTimeout(() => {
jazz.open('./jazz.js');
// jazz.open('./babel.js');
// jazz.open('./test/syntax.html.js');
// },2000)
