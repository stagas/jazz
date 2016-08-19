
var FileTree = require('filetree');

var tree = new FileTree;

tree.set([
  'one',
  'two',
  'three',
  ['four', [
    'five',
    'six',
    ['seven', [
      'eight',
      'nine',
      ['ten']
    ]],
    ['aaaa', [
      'bbb',
      'ccc',
      ['ddd']
    ]]
  ]]
]);

document.body.appendChild(tree.el);

tree.render();
