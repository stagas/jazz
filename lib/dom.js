var Point = require('./point');
var bindRaf = require('./bind-raf');
var memoize = require('./memoize');
var merge = require('./merge');
var diff = require('./diff');
var slice = [].slice;

var units = {
  left: 'px',
  top: 'px',
  right: 'px',
  bottom: 'px',
  width: 'px',
  height: 'px',
  maxHeight: 'px',
  paddingLeft: 'px',
};

module.exports = dom;

function dom(name, children, attrs) {
  var el;
  var tag = 'div';
  var node;

  if ('string' === typeof name) {
    if ('<' === name.charAt(0)) {
      var matches = name.match(/(?:<)(.*)(?:>)(\S+)?/);
      if (matches) {
        tag = matches[1];
        name = matches[2] || tag;
      }
    }
    el = document.createElement(tag);
    node = {
      el: el,
      name: name.split(' ')[0]
    };
    dom.classes(node, name.split(' ').slice(1));
  } else if (Array.isArray(name)) {
    return dom.apply(null, name);
  } else {
    if ('dom' in name) {
      node = name.dom;
    } else {
      node = name;
    }
  }

  if (Array.isArray(children)) {
    children
      .map(dom)
      .map(function(child, i) {
        node[child.name] = child;
        return child;
      })
      .map(function(child) {
        node.el.appendChild(child.el);
      });
  } else if ('object' === typeof children) {
    dom.style(node, children);
  }

  if (attrs) {
    dom.attrs(node, attrs);
  }

  return node;
}

dom.style = memoize(function(el, _, style) {
  for (var name in style)
    if (name in units)
      style[name] += units[name];
  Object.assign(el.style, style);
}, diff, merge, function(node, style) {
  var el = dom.getElement(node);
  return [el, style];
});

/*
dom.style = function(el, style) {
  el = dom.getElement(el);
  for (var name in style)
    if (name in units)
      style[name] += units[name];
  Object.assign(el.style, style);
};
*/
dom.classes = memoize(function(el, className) {
  el.className = className;
}, null, null, function(node, classes) {
  var el = dom.getElement(node);
  return [el, classes.concat(node.name).filter(Boolean).join(' ')];
});

dom.attrs = function(el, attrs) {
  el = dom.getElement(el);
  Object.assign(el, attrs);
};

dom.html = function(el, html) {
  el = dom.getElement(el);
  el.innerHTML = html;
};

dom.text = function(el, text) {
  el = dom.getElement(el);
  el.textContent = text;
};

dom.focus = function(el) {
  el = dom.getElement(el);
  el.focus();
};

dom.getSize = function(el) {
  el = dom.getElement(el);
  return {
    width: el.clientWidth,
    height: el.clientHeight
  };
};

dom.getCharSize = function(el, className) {
  el = dom.getElement(el);
  var span = document.createElement('span');
  span.className = className;

  el.appendChild(span);

  span.innerHTML = ' ';
  var a = span.getBoundingClientRect();

  span.innerHTML = '  \n ';
  var b = span.getBoundingClientRect();

  el.removeChild(span);

  return {
    width: (b.width - a.width),
    height: (b.height - a.height)
  };
};

dom.getOffset = function(el) {
  el = dom.getElement(el);
  var rect = el.getBoundingClientRect();
  var style = window.getComputedStyle(el);
  var borderLeft = parseInt(style.borderLeftWidth);
  var borderTop = parseInt(style.borderTopWidth);
  return Point.low({ x: 0, y: 0 }, {
    x: (rect.left + borderLeft) | 0,
    y: (rect.top + borderTop) | 0
  });
};

dom.getScroll = function(el) {
  el = dom.getElement(el);
  return getScroll(el);
};

dom.onscroll = function onscroll(el, fn) {
  el = dom.getElement(el);

  if (document.body === el) {
    document.addEventListener('scroll', handler);
  } else {
    el.addEventListener('scroll', handler);
  }

  function handler(ev) {
    fn(getScroll(el));
  }

  return function offscroll() {
    el.removeEventListener('scroll', handler);
  }
};

dom.onoffset = function(el, fn) {
  el = dom.getElement(el);
  while (el = el.offsetParent) {
    dom.onscroll(el, fn);
  }
};

dom.onclick = function(el, fn) {
  return el.addEventListener('click', fn);
};

dom.onresize = function(fn) {
  return window.addEventListener('resize', fn);
};

dom.append = function(target, src, dict) {
  target = dom.getElement(target);
  if ('forEach' in src) src.forEach(dom.append.bind(null, target));
  // else if ('views' in src) dom.append(target, src.views, true);
  else if (dict === true) for (var key in src) dom.append(target, src[key]);
  else if ('function' != typeof src) target.appendChild(dom.getElement(src));
};

dom.remove = function(el) {
  el = dom.getElement(el);
  if (el.parentNode) el.parentNode.removeChild(el);
};

dom.getElement = function(el) {
  return el.dom && el.dom.el || el.el || el.node || el;
};

dom.scrollBy = function(el, x, y, scroll) {
  scroll = scroll || dom.getScroll(el);
  dom.scrollTo(el, scroll.x + x, scroll.y + y);
};

dom.scrollTo = function(el, x, y) {
  if (document.body === el) {
    window.scrollTo(x, y);
  } else {
    el.scrollLeft = x || 0;
    el.scrollTop = y || 0;
  }
};

dom.css = bindRaf(function(id, cssText) {
  if (!(id in dom.css.styles)) {
    dom.css.styles[id] = document.createElement('style');
    document.body.appendChild(dom.css.styles[id]);
  }
  dom.css.styles[id].textContent = cssText;
});

dom.css.styles = {};

dom.getMousePoint = function(e) {
  return new Point({
    x: e.clientX,
    y: e.clientY
  });
};

function getScroll(el) {
  return document.body === el
    ? {
        x: window.scrollX || el.scrollLeft || document.documentElement.scrollLeft,
        y: window.scrollY || el.scrollTop  || document.documentElement.scrollTop
      }
    : {
        x: el.scrollLeft,
        y: el.scrollTop
      };
}
