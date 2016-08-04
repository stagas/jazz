
module.exports = function translate(e) {
  if (!(e.which in map)) return;

  var k = [];

  if (e.ctrlKey) k.push('ctrl');
  if (e.altKey) k.push('alt');
  if (e.shiftKey) k.push('shift');

  k.push(map[e.which]);

  return k.join('+');
};

var map = {
  8: 'backspace',
  9: 'tab',
  33: 'pageup',
  34: 'pagedown',
  35: 'end',
  36: 'home',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  46: 'delete',
  65: 'a',
  89: 'y',
  90: 'z',

  // numpad
  97: 'end',
  98: 'down',
  99: 'pagedown',
  100: 'left',
  102: 'right',
  103: 'home',
  104: 'up',
  105: 'pageup',
};
