
var assert = require('assert');

module.exports = function(t, Buffer) {

var fixture = `
1/*
2foo
3 */

5while (true) {
6  if (this[something]) {
7    return \`
8foo
9bar
0\`
1  }
2}
3123`;

var b;

function before(text) {
  b = new Buffer;
  b.setText(text || fixture);
}

t('setText', function() {
  before();
  assert.equal(fixture, b.raw);
})

t('toString', function() {
  before();
  assert.equal(fixture, b.toString());
})

t('loc', function() {
  before();
  assert.equal(13, b.loc());

  before('one\n');
  assert.equal(1, b.loc());
})

t('getLineOffset', function() {
  before('012\n45\n78\n');
  assert.equal(0, b.getLineOffset(0));
  assert.equal(4, b.getLineOffset(1));
  assert.equal(7, b.getLineOffset(2));
  assert.equal(10, b.getLineOffset(3));
  // assert.equal(10, b.getLineOffset(4));
})

t('getLineRangeOffsets', function() {
  before('012\n45\n78\n1');
  assert.equal([0,4], b.getLineRangeOffsets([0,0]));
  assert.equal([0,7], b.getLineRangeOffsets([0,1]));
  assert.equal([4,7], b.getLineRangeOffsets([1,1]));
  assert.equal([4,10], b.getLineRangeOffsets([1,2]));
  assert.equal([7,10], b.getLineRangeOffsets([2,2]));
  assert.equal([7,11], b.getLineRangeOffsets([2,3]));
  assert.equal([10,11], b.getLineRangeOffsets([3,3]));
  assert.equal([0,10], b.getLineRangeOffsets([0,2]));
  assert.equal([0,11], b.getLineRangeOffsets([0,3]));
  assert.equal([10,11], b.getLineRangeOffsets([3,4]));
})

t('getLine', function() {
  before('012\n45\n78\n1');
  assert.equal([0,4], b.getLine(0).offsetRange);
  assert.equal(0, b.getLine(0).offset);
  assert.equal(3, b.getLine(0).length);
  assert.equal({x:0,y:0}, b.getLine(0).point);
  assert.equal([4,7], b.getLine(1).offsetRange);
  assert.equal(4, b.getLine(1).offset);
  assert.equal(2, b.getLine(1).length);
  assert.equal({x:0,y:1}, b.getLine(1).point);
  assert.equal([10,11], b.getLine(3).offsetRange);
  assert.equal(10, b.getLine(3).offset);
  assert.equal(1, b.getLine(3).length);
  assert.equal({x:0,y:3}, b.getLine(3).point);
})

t('getLineRangeText', function() {
  before();
  assert.equal('\n', b.getLineRangeText([0,0]));
  assert.equal('1/*\n', b.getLineRangeText([1,1]));
  assert.equal('2foo\n', b.getLineRangeText([2,2]));
  assert.equal('2foo\n3 */\n', b.getLineRangeText([2,3]));
  assert.equal('\n1/*\n', b.getLineRangeText([0,1]));
  assert.equal('3123', b.getLineRangeText([13,13]));
  assert.equal('2}\n3123', b.getLineRangeText([12,13]));
})

t('getOffsetPoint', function() {
  // before('\n234\n67\n9012');
  // assert.equal({ x:0, y:0 }, b.getOffsetPoint(0));
  // assert.equal({ x:0, y:1 }, b.getOffsetPoint(1));
  // assert.equal({ x:1, y:1 }, b.getOffsetPoint(2));
  // assert.equal({ x:2, y:1 }, b.getOffsetPoint(3));
  // assert.equal({ x:0, y:2 }, b.getOffsetPoint(4));

  before('01\n345\n78\n012');
  assert.equal({ x:0, y:0 }, b.getOffsetPoint(0));
  assert.equal({ x:1, y:0 }, b.getOffsetPoint(1));
  assert.equal({ x:2, y:0 }, b.getOffsetPoint(2));
  assert.equal({ x:0, y:1 }, b.getOffsetPoint(3));
  assert.equal({ x:1, y:1 }, b.getOffsetPoint(4));
  assert.equal({ x:2, y:1 }, b.getOffsetPoint(5));
  assert.equal({ x:3, y:1 }, b.getOffsetPoint(6));
  assert.equal({ x:0, y:2 }, b.getOffsetPoint(7));
})

t('failing #1', function() {
  before('\n\n\n/*\ntwo\n*/\n');
  assert.equal([3,10], b.tokens.tokens.segments.toArray());
  b.removeCharAtPoint({x:0,y:1});
  assert.equal('\n\n/*\ntwo\n*/\n', b.text.toString());
  assert.equal([2,9], b.tokens.tokens.segments.toArray());
})

// t('failing #2', function() {
//   before('\n\n\n');
//   console.log(b.getLineOffset(4))
//   console.log(b.getPoint({ x:0, y:4 }))
// })

/*
t('insert', function() {
  before('012\n45\n78\n1');
  assert.equal(4, b.getLineOffset(1));
  assert.equal(7, b.getLineOffset(2));
  assert.equal(3, b.insert({x:0,y:0},'foo'));
  assert.equal('foo012\n45\n78\n1', b.toString());
  assert.equal(7, b.getLineOffset(1));
  assert.equal(10, b.getLineOffset(2));

  before('012\n45\n78\n1');
  assert.equal(4, b.getLineOffset(1));
  assert.equal(7, b.getLineOffset(2));
  assert.equal(3, b.insert({x:0,y:1},'foo'));
  assert.equal('012\nfoo45\n78\n1', b.toString());
  assert.equal(4, b.getLineOffset(1));
  assert.equal(10, b.getLineOffset(2));

  before('012\n45\n78\n1');
  assert.equal(4, b.getLineOffset(1));
  assert.equal(7, b.getLineOffset(2));
  assert.equal(3, b.insert({x:3,y:0},'foo'));
  assert.equal('012foo\n45\n78\n1', b.toString());
  assert.equal(7, b.getLineOffset(1));
  assert.equal(10, b.getLineOffset(2));
  assert.equal(1, b.insert({x:3,y:0},'a'));
  assert.equal(8, b.getLineOffset(1));

  before('012\n45\n78\n');
  assert.equal(1, b.insert({x:0,y:3},'a'));
  assert.equal('012\n45\n78\na', b.toString());
  assert.equal(1, b.insert({x:1,y:3},'b'));
  assert.equal('012\n45\n78\nab', b.toString());
})

t('charAt', function() {
  before('012\n45\n78\n1');
  assert.equal('0', b.charAt(0));
  assert.equal('1', b.charAt(1));
  assert.equal('2', b.charAt(2));
  assert.equal('\n', b.charAt(3));
  assert.equal('1', b.charAt(10));
})

t('removeOffsetRange', function() {
  before('012\n45\n78\n1');
  b.remove([0,4]);
  assert.equal('45\n78\n1', b.toString());
  b.remove([2,3]);
  assert.equal('4578\n1', b.toString());
})

t('removeCharAtPoint', function() {
  before('012\n45\n78\n1');
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('12\n45\n78\n1', b.toString());
  b.removeCharAtPoint({x:0,y:1});
  assert.equal('12\n5\n78\n1', b.toString());
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('12\n5\n8\n1', b.toString());
  b.removeCharAtPoint({x:0,y:3});
  assert.equal('12\n5\n8\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('2\n5\n8\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('\n5\n8\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('5\n8\n', b.toString());

  before('\n123\n\n123\n\n');
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('\n123\n123\n\n', b.toString());
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('\n123\n23\n\n', b.toString());
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('\n123\n3\n\n', b.toString());
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('\n123\n\n\n', b.toString());
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('\n123\n\n', b.toString());
  b.removeCharAtPoint({x:0,y:2});
  assert.equal('\n123\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('123\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('23\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('3\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('\n', b.toString());
  b.removeCharAtPoint({x:0,y:0});
  assert.equal('', b.toString());
})
/**/
};
