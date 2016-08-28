var dom = require('../lib/dom');
var css = require('./style.css');

var themes = {
  monokai: {
    background: '#272822',
    color: '#F8F8F2',
    keyword: '#DF2266',
    function: '#A0D92E',
    declare: '#61CCE0',
    number: '#AB7FFB',
    params: '#FD971F',
    comment: '#75715E',
    string: '#E6DB74',
  },

  western: {
    background: '#D9D1B1',
    color: '#000000',
    keyword: '#7A3B3B',
    function: '#256F75',
    declare: '#634256',
    number: '#134D26',
    params: '#082663',
    comment: '#998E6E',
    string: '#C43C3C',
  },

  ergonom: {
    background: '#271E16',
    color: '#E9E3D1',
    keyword: '#A13630',
    function: '#B3DF02',
    declare: '#F63833',
    number: '#FF9F4E',
    params: '#A090A0',
    regexp: '#BD70F4',
    comment: '#635047',
    string: '#3EA1FB',
  },

  daylight: {
    background: '#EBEBEB',
    color: '#000000',
    keyword: '#FF1B1B',
    function: '#0005FF',
    declare: '#0C7A00',
    number: '#8021D4',
    params: '#4C6969',
    comment: '#ABABAB',
    string: '#E67000',
  },
};

exports = module.exports = setTheme;
exports.themes = themes;

/*
t: operator
k: keyword
d: declare
b: builtin
o: boolean
n: number
m: params
f: function
r: regexp
c: comment
s: string
l: symbol
x: indent
 */
function setTheme(name) {
  var t = themes[name];
  dom.css('theme',
`
.${name} {
  background: ${t.background};
}

t,
k {
  color: ${t.keyword};
}

d,
n {
  color: ${t.declare};
}

o,
e {
  color: ${t.number};
}

m {
  color: ${t.params};
}

f {
  color: ${t.function};
  font-style: normal;
}

r {
  color: ${t.regexp || t.params};
}

c {
  color: ${t.comment};
}

s {
  color: ${t.string};
}

l,
.${css.code} {
  color: ${t.color};
}

.${css.caret} {
  background: ${t.color};
}

m,
d {
  font-style: italic;
}

l {
  font-style: normal;
}

x {
  display: inline-block;
  background-repeat: no-repeat;
}
`
  )

}

