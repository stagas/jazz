
var Dialog = require('../');

var dialog = new Dialog('Find');

dialog.on('submit', function(s) {
  console.log(s);
});

dialog.on('value', function(s) {
  console.log(s);
});

dialog.open();

setTimeout(function() {
  dialog.info('5/16')
}, 1000)
