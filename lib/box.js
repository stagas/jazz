
class Box {
  constructor(b) {
    if (b) {
      this.width = b.width;
      this.height = b.height;
    } else {
      this.width = 0;
      this.height = 0;
    }
  }
}

module.exports = Box;




function box(b) {
  return b
    ? { width: b.width, height: b.height }
    : { width: 0, height: 0 };
}

box.grid = function(b, a) {
  return {
    width: Math.floor(a.width / b.width),
    height: Math.floor(a.height / b.height)
  };
};
