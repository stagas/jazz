
var ColorPicker = require('./color-picker');

var picker = [];

for (var i = 0; i < 9; i++) {
  picker[i] = new ColorPicker({
    color: '#566',
    background: '#000',
    el: pickers,
    width: 140,
    height: 100
  });
  picker[i].on('update', updateStyle);
}


function updateStyle() {
  var s = '';
  var t = '';
  s += 'body { background: ' + picker[0].getHexString() + '; color: '+ picker[1].getHexString() +'}';
  t += '\nbackground: ' + picker[0].getHexString();
  t += '\ncolor: ' + picker[1].getHexString();
  s += 'operator,operator2,keyword { color: ' + picker[2].getHexString() + '}';
  t += '\nkeyword: ' + picker[2].getHexString();
  s += 'function { color: ' + picker[3].getHexString() + '}';
  t += '\nfunction: ' + picker[3].getHexString();
  s += 'declare,builtin { color: ' + picker[4].getHexString() + '}';
  t += '\ndeclare: ' + picker[4].getHexString();
  s += 'boolean,number { color: ' + picker[5].getHexString() + '}';
  t += '\nnumber: ' + picker[5].getHexString();
  s += 'params,regexp { color: ' + picker[6].getHexString() + '}';
  t += '\nparams: ' + picker[6].getHexString();
  s += 'comment { color: ' + picker[7].getHexString() + '}';
  t += '\ncomment: ' + picker[7].getHexString();
  s += 'string { color: ' + picker[8].getHexString() + '}';
  t += '\nstring: ' + picker[8].getHexString();

  style.textContent = s;
  colors.textContent = t;
}

randomize.onclick = randomizeColors;

function randomizeColors() {
  picker.forEach(function(p, i) {
    if (0 === i) {
      p.setColor('#' +
        (Math.random() * 0xf | 0).toString(16) + (Math.random() * 0xf | 0).toString(16) +
        (Math.random() * 0xf | 0).toString(16) + (Math.random() * 0xf | 0).toString(16) +
        (Math.random() * 0xf | 0).toString(16) + (Math.random() * 0xf | 0).toString(16)
      )
    } else {
      p.setColor('#' +
        zeroPad((Math.random() * 0xff | 0).toString(16)) +
        zeroPad((Math.random() * 0xff | 0).toString(16)) +
        zeroPad((Math.random() * 0xff | 0).toString(16))
      );
    }
  });
  updateStyle();
}


var style = document.createElement('style');
document.body.appendChild(style);

function zeroPad(s) {
  if (s.length === 1) return '0' + s;
  else return s;
}