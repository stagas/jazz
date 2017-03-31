var options = {
  theme: 'redbliss',
  // debug_layers: ['code'],
  // scroll_speed: 95,
  // hide_rows: true,
  // center_horizontal: true,
  // center_vertical: true,
  // margin_left: 15,
  // gutter_margin: 20,
};

var jazz = new Jazz(options);

jazz.use(document.body).focus()

// setInterval(() => {
//   jazz.repaint()
// }, 1000)

jazz.use(document.body).open('huge.js', './').focus();
// jazz.use(document.body).open('ember.js', './').focus();
// jazz.use(document.body).open('babel.js', './').focus();
// jazz.use(document.body).open('jazz.js', '../dist/').focus();
// jazz.use(document.body).open('jquery.js', './').focus();
// jazz.use(document.body).open('codemirror.js', './').focus();
// jazz.use(document.body).focus()
// .open('broken.js', '../test/').focus();
// jazz.use(document.body).open('index.js', '../').focus();

// jazz.set('hello')
// setTimeout(() => {
//   jazz.set('world')
// }, 1000)
