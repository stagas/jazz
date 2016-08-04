
module.exports = Box;

function Box(b) {
  if (b) {
    this.width = b.width;
    this.height = b.height;
  } else {
    this.width = 0;
    this.height = 0;
  }
}

Box.prototype.set = function(b) {
  this.width = b.width;
  this.height = b.height;
};

Box.prototype.grid = function(b) {
  return {
    width: this.width / b.width | 0,
    height: this.height / b.height | 0
  };
};

Box.prototype['*'] =
Box.prototype.mul = function(b) {
  return new Box({
    width: this.width * b.width,
    height: this.height * b.height
  });
};

Box.prototype['-'] =
Box.prototype.sub = function(b) {
  return new Box({
    width: this.width - b.width,
    height: this.height - b.height
  });
};
