var db = require('idb');
var Event = require('event');
var throttle = require('throttle');
var debounce = require('debounce');
var bindings = require('../bindings');
var Editor = require('../jazz');

var options = {
  // debug_layers: true
};

var shell = new Event;

shell.wipsave = debounce(function(pane) {
  // var name = '__wip__' + pane.editor.file.path;
  // var text = pane.editor.buffer.get();

  // db.set(name, text)
  //   .then(() => shell.refreshFilelist());
}, 300);

shell.files = [];
shell.panes = [];

shell.createPane = function createPane() {
  var pane = {};

  // pane.el = document.createElement('div');
  // pane.el.className = 'editor pane';
  // document.body.appendChild(pane.el);

  pane.editor = new Editor(options);
  pane.editor.on('change', shell.emit.bind(shell, 'change', pane));
  pane.editor.use(document.body);
  pane.editor.assign(bindings);
  pane.editor.focus();

  return pane;
};

shell.on('change', shell.wipsave);

shell.render = function() {
  var wip = shell.files
    .filter(name => name.indexOf('__wip__') === 0)
    .map(name => name.split('__wip__').pop());

  var files = shell.files
    .filter(name => !~wip.indexOf(name) && name.indexOf('__wip__') !== 0);

  filelist.innerHTML =
    wip
    .map(name => '<button data-path="__wip__'+name+'" class="wip">'+name+'</button>')
    .join('')
    +
    files
    .map(name => '<button data-path="'+name+'">'+name+'</button>')
    .join('')
  ;
};

// filelist.onmousedown = function(e) {
//   var path = e.target.dataset.path;
//   shell.load(path);
//   return false;
// };

shell.panes.push(shell.createPane());
shell.activePane = shell.panes[shell.panes.length - 1];
shell.activePane.editor.open('../jazz.js');

shell.load = function(path) {
  // db.get(path)
  //   .then(value => {
  //     var editor = shell.activePane.editor;
  //     editor.set(value || '', path.split('__wip__').pop());
  //   })
};

// newfile.onclick = function() {
//   var name = prompt('Type a name');
//   db.set(name, '')
//     .then(() => db.set('__wip__' + name, ''))
//     .then(() => shell.refreshFilelist());
// };
shell.refreshFilelist = function() {
  // db.keys()
  //   .then(keys => {
  //     shell.files = keys;
  //     shell.render();
  //   });
}

shell.refreshFilelist();


document.addEventListener('touchstart', handleTouchStart, false);
document.addEventListener('touchmove', handleTouchMove, false);
document.addEventListener('touchend', handleTouchEnd, false);

var xDown = null;
var yDown = null;

function handleTouchEnd(e) {
  if (menuOpen) {
    filelist.style.left = 'inherit';
  }
}

function handleTouchStart(evt) {
    xDown = evt.touches[0].clientX;
    yDown = evt.touches[0].clientY;
    // evt.preventDefault();
};

var menuOpen = false;

var positionMenu = throttle(function(x) {
    filelist.style.left = x + 'px';
}, 30)

function handleTouchMove(evt) {
  if (menuOpen) {
    evt.preventDefault();
    //positionMenu(evt.touches[0].clientX)
  }

    var xUp = evt.touches[0].clientX;
    var yUp = evt.touches[0].clientY;

    xDown = xDown || xUp;
    yDown = yDown || yUp;
    if (!menuOpen && xDown > 40) return;

    var xDiff = xDown - xUp;
    var yDiff = yDown - yUp;

    if ( Math.abs( xDiff ) > Math.abs( yDiff ) ) {/*most significant*/
        if ( xDiff > 0 ) {
          // evt.preventDefault();
          filelist.classList.remove('open');
            /* left swipe */
            setTimeout(function() {

            menuOpen = false
            filelist.style.display = 'none';
          }, 800)
            // return false
        } else {
          // evt.preventDefault();
          menuOpen = true;
          filelist.style.display = 'block';
          setTimeout(function() {
            // filelist.classList.add('open');
          filelist.classList.add('open');
        },100)
            /* right swipe */
            // return false
        }
    } else {
        if ( yDiff > 0 ) {
            /* up swipe */
        } else {
            /* down swipe */
        }
    }
    /* reset values */
    xDown = null;
    yDown = null;
};
