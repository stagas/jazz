
var assert = require('assert');

//
//   0   1   2   3   4    5   0   1   2   3   4    5   0   1   2
// | h | e | l | l | o | \n | w | o | r | l | d | \n | ! | ! | _ |
// 0   1   2   3   4   5    6   7   8   9   10  11   12  13  14  15
//

module.exports = function(t, Lines) {

  !function() {
    var lines = new Lines;
    lines.index = [5,11]
    lines.tail = '!!';
    lines.length = 2;

    t('get', function() {
      assert.equal(0, lines.get(0));
      assert.equal(6, lines.get(1));
      assert.equal(12, lines.get(2));
      assert.throws(() => lines.get(3));
    })

    t('getLine', function() {
      assert.equal(0, lines.getLine(0).offset);
      assert.equal(6, lines.getLine(1).offset);
      assert.equal(12, lines.getLine(2).offset);
      assert.equal([0,5], lines.getLine(0).range);
      assert.equal([6,11], lines.getLine(1).range);
      assert.equal([12,14], lines.getLine(2).range);
      assert.throws(() => lines.getLine(3));
    })

    t('getRange', function() {
      assert.equal([0,6], lines.getRange([0,0]));
      assert.equal([0,12], lines.getRange([0,1]));
      assert.equal([0,14], lines.getRange([0,2]));
      assert.throws(() => lines.getRange([0,3]));
      assert.equal([0,12], lines.getRange([0,1]));
      assert.equal([6,12], lines.getRange([1,1]));
      assert.equal([6,14], lines.getRange([1,2]));
      assert.equal([12,14], lines.getRange([2,2]));
      assert.throws(() => lines.getRange([2,3]));
    })

    t('getPoint', function() {
      assert.equal(0, lines.getPoint({x:0,y:0}).offset);
      assert.equal({x:0,y:0}, lines.getPoint({x:0,y:0}).point);
      assert.equal(2, lines.getPoint({x:2,y:0}).offset);
      assert.equal({x:2,y:0}, lines.getPoint({x:2,y:0}).point);
      assert.equal(5, lines.getPoint({x:10,y:0}).offset);
      assert.equal({x:5,y:0}, lines.getPoint({x:10,y:0}).point);
      assert.equal(6, lines.getPoint({x:0,y:1}).offset);
      assert.equal(8, lines.getPoint({x:2,y:1}).offset);
      assert.equal(11, lines.getPoint({x:10,y:1}).offset);
      assert.equal({x:5,y:1}, lines.getPoint({x:10,y:1}).point);
      assert.equal(12, lines.getPoint({x:0,y:2}).offset);
      assert.equal(14, lines.getPoint({x:10,y:2}).offset);
    })

    t('getLineLength', function() {
      assert.equal(5, lines.getLineLength(0));
      assert.equal(5, lines.getLineLength(1));
      assert.equal(2, lines.getLineLength(2));
      assert.throws(() => lines.getLineLength(3));
    })
  }()

  t('edge case 1', function() {
    var lines = new Lines;
    lines.insertLine(0,'hello\n');
    lines.insertLine(1,'world\n');
    lines.insertLine(0,'\n');
    lines.insertLine(2,'\n');
    console.log(lines.index)
    assert.equal(1, lines.get(1));
    assert.equal(0, lines.getLineLength(0));
    assert.equal(5, lines.getLineLength(1));
    assert.equal(0, lines.getLineLength(2));
    assert.equal(0, lines.getPoint({x:0,y:0}).offset);
    assert.equal(1, lines.getPoint({x:0,y:1}).offset);
    assert.equal(6, lines.getPoint({x:10,y:1}).offset);
    // assert.equal(6, lines.getPoint({x:0,y:2}).offset);
  });

  t('edge case 2', function() {
    var lines = new Lines;
    lines.insertLine(0,'hello\n\n');
    assert.equal(5, lines.getLineLength(0));
    // assert.equal(6, lines.getPoint({x:0,y:2}).offset);
  });

  t('edge case 3', function() {
    var lines = new Lines;
    lines.insertLine(0,'\n\nhello\nthere\n');
    assert.equal(0, lines.getLineLength(0));
    assert.equal(0, lines.getLineLength(1));
    assert.equal(5, lines.getLineLength(2));
    assert.equal(5, lines.getLineLength(3));
    lines.removeCharAt({x:0,y:0});
    lines.removeCharAt({x:0,y:0});
    assert.equal(5, lines.getLineLength(0));
    assert.equal(5, lines.getLineLength(1));
    lines.removeCharAt({x:0,y:0});
    assert.equal(4, lines.getLineLength(0));
    assert.equal(5, lines.getLineLength(1));
    // assert.equal(6, lines.getPoint({x:0,y:2}).offset);
  });

  t('insertLine', function() {
    var lines = new Lines;
    lines.insertLine(0, 'hello\n');
    assert.equal([5], lines.index);
    lines.insertLine(1, 'world\n');
    assert.equal([5,11], lines.index);
    lines.insertLine(2, '!!');
    assert.equal([5,11], lines.index);
    assert.equal(2, lines.getLineLength(2));
    assert.equal('!!', lines.tail);
    lines.insertLine(2, 'tail');
    assert.equal('tail!!', lines.tail);
    assert.equal(6, lines.getLineLength(2));
    lines.insertLine(1, 'middle\n');
    assert.equal([5,12,18], lines.index);
    lines.insertLine(2, 'new\n');
    assert.equal([5,12,16,22], lines.index);
    lines.insertLine(1, 'there\n');
    assert.equal([5,11,18,22,28], lines.index);
    lines.insertLine(0, 'oh!');
    assert.equal([8,14,21,25,31], lines.index);

// h e l l o   m i d d l e   w o r l d
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8

// h e l l o   m i d d l e   n e w   w o r l d
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2

// h e l l o   t h e r e   m i d d l e   n e w   w o r l d
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8

// o h ! h e l l o   t h e r e   m i d d l e   n e w   w o r l d
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1

  })

  t('insert', function() {
    var lines = new Lines;
    lines.insert({ x:0, y:0 }, 'hello!');
    assert.equal([], lines.index);
    assert.equal('hello!', lines.tail);
    assert.equal([], lines.index);
    lines.insert({ x:5, y:0 }, ' world');
    assert.equal([], lines.index);
    assert.equal('hello world!', lines.tail);
    lines.insert({ x:5, y:0 }, '\n');
    assert.equal([5], lines.index);
    assert.equal(' world!', lines.tail);
    lines.insert({ x:100, y:1 }, '\n!');
    assert.equal([5,13], lines.index);
    assert.equal('!', lines.tail);

// h e l l o     w o r l d !   !
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4
  })

  t('removeCharAt', function() {
    var lines = new Lines;
    lines.insert({ x:0, y:0 }, 'hello\n world!\n!');
    assert.equal([5,13], lines.index);
    lines.removeCharAt({x:6,y:0});
    assert.equal([12], lines.index);
    assert.equal('!', lines.tail);
    lines.removeCharAt({x:12,y:0});
    assert.equal([], lines.index);
    assert.equal(12, lines.getLineLength(0));

    var lines = new Lines;
    lines.insert({ x:0, y:0 }, 'hello\n\nworld!\n!');
    assert.equal([5,6,13], lines.index);
    lines.removeCharAt({x:0,y:1});
    assert.equal([5,12], lines.index);
    lines.removeCharAt({x:6,y:0});
    assert.equal([11], lines.index);
    lines.removeCharAt({x:100,y:0});
    assert.equal([], lines.index);
  })

/**/

};
