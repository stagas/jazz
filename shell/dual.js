var bindings = require('../bindings');
var Jazz = require('../jazz');

var options = {
  // debug_layers: true,
  center: true,
  hide_rows: true,
};

var panes = document.querySelectorAll('.pane');
panes[1].style.left = '50%';

var jazz = new Jazz(options);
jazz.use(panes[0]);
jazz.assign(bindings);
jazz.focus();
jazz.open('../jazz.js');

var jazz = new Jazz(options);
jazz.use(panes[1]);
jazz.assign(bindings);
jazz.focus();
jazz.open('../jazz.js');

// setTimeout(() => {
// jazz.open('./jazz.js');
// jazz.open('./test/syntax.html.js');
// },2000)
