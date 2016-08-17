var bindings = require('../bindings');
var Xoor = require('../xoor');

var options = {
  // debug_layers: true,
  center: true,
  hide_rows: true,
};

var panes = document.querySelectorAll('.pane');
panes[1].style.left = '50%';

var xoor = new Xoor(options);
xoor.use(panes[0]);
xoor.assign(bindings);
xoor.focus();
xoor.open('../xoor.js');

var xoor = new Xoor(options);
xoor.use(panes[1]);
xoor.assign(bindings);
xoor.focus();
xoor.open('../xoor.js');

// setTimeout(() => {
// xoor.open('./xoor.js');
// xoor.open('./test/syntax.html.js');
// },2000)
