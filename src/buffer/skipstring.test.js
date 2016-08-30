
var assert = require('assert');

module.exports = function(t, SkipString) {

var times = 50;

t('insert', function() {
  repeat(times, function() {
    var node = new SkipString;
    node.insert(0, '12345');
    assert.equal('12345', node.toString());
    node.insert(5, '67890');
    assert.equal('1234567890', node.toString());
    node.insert(0, 'ab');
    assert.equal('ab1234567890', node.toString());
    node.insert(2, 'cd');
    assert.equal('abcd1234567890', node.toString());
    node.insert(9, 'ef');
    assert.equal('abcd12345ef67890', node.toString());

    var node = new SkipString;
    node.insert(0, '12345');
    assert.equal('12345', node.toString());
    node.insert(2, 'ab');
    assert.equal('12ab345', node.toString());
  })
})

t('remove', function() {
  repeat(times, function() {
    var node = new SkipString;
    node.insert(0,'efgh');
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567');
    node.insert(0,'34');
    node.insert(0,'12');
    node.remove([5,12])
    assert.equal('12345cdefgh', node.toString());

    var node = new SkipString;
    node.insert(0,'efgh');
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567');
    node.insert(0,'34');
    node.insert(0,'12');
    node.remove([4,12])
    assert.equal('1234cdefgh', node.toString());

    var node = new SkipString;
    node.insert(0,'efgh');
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567');
    node.insert(0,'34');
    node.insert(0,'12');
    node.remove([6,13])
    assert.equal('123456defgh', node.toString());

    var node = new SkipString;
    node.insert(0,'efgh');
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567');
    node.insert(0,'34');
    node.insert(0,'12');
    node.remove([2,14])
    assert.equal('12efgh', node.toString());

    var node = new SkipString;
    node.insert(0,'efgh',5);
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567',7);
    node.insert(0,'34');
    node.insert(0,'12');
    node.remove([1,16])
    assert.equal('1gh', node.toString());

    var node = new SkipString;
    node.insert(0,'efgh',3);
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567',7);
    node.insert(0,'34');
    node.insert(0,'12');
    node.remove([0,18])
    assert.equal('', node.toString());

    var node = new SkipString;
    node.insert(0,'efgh',3);
    node.insert(0,'abcd',1);
    node.insert(0,'890',1);
    node.insert(0,'567',7);
    node.insert(0,'34',1);
    node.insert(0,'12',2);
    node.remove([0,15])
    assert.equal('fgh', node.toString());
  })
})

t('removeCharAt', function() {
  repeat(times, function() {
    var node = new SkipString;
    node.insert(0,'efgh');
    node.insert(0,'abcd');
    node.insert(0,'890');
    node.insert(0,'567');
    node.insert(0,'34');
    node.insert(0,'12');
    assert.equal('1234567890abcdefgh', node.toString());
    node.removeCharAt(2);
    assert.equal('124567890abcdefgh', node.toString());
    node.removeCharAt(5);
    assert.equal('12456890abcdefgh', node.toString());
    node.removeCharAt(5);
    assert.equal('1245690abcdefgh', node.toString());
    node.removeCharAt(5);
    assert.equal('124560abcdefgh', node.toString());
    node.removeCharAt(5);
    assert.equal('12456abcdefgh', node.toString());

    var node = new SkipString;
    node.insert(0,'9012');
    node.insert(0,'5678');
    node.insert(0,'1234');
    assert.equal('123456789012', node.toString());
    node.removeCharAt(11);
    assert.equal('12345678901', node.toString());
    node.removeCharAt(5);
    assert.equal('1234578901', node.toString());
    node.removeCharAt(2);
    assert.equal('124578901', node.toString());
    node.removeCharAt(1);
    assert.equal('14578901', node.toString());
    node.removeCharAt(7);
    assert.equal('1457890', node.toString());
  })
})

t('substring', function() {
  repeat(times, function() {
    var node = new SkipString;
    node.insert(0, '12345');
    node.insert(5, '67890');
    node.insert(0, 'ab');
    node.insert(2, 'cd');
    node.insert(9, 'ef');
    assert.equal('abcd12345ef67890', node.substring(0, node.length));

    assert.equal('ab', node.substring(0,2));
    assert.equal('cd', node.substring(2,4));
    assert.equal('d1', node.substring(3,5));
    assert.equal('cd12', node.substring(2,6));
    assert.equal('f678', node.substring(10,14));
    assert.equal('67890', node.substring(11,16));
    assert.equal('7890', node.substring(12, node.length));
  })
})

t('insertChunked', function() {
  repeat(times, function() {
    for (var i = 1; i < 10; i++) {
      var node = new SkipString;
      node.insertChunked(0, '1234567890123', i);
      // assert.equal('123,456,789,012,3', node.joinString());
      assert.equal('123', node.getRange([0,3]));
      assert.equal('456', node.getRange([3,6]));
      assert.equal('789', node.getRange([6,9]));
      assert.equal('012', node.getRange([9,12]));
      assert.equal('12', node.getRange([0,2]));
      assert.equal('1234', node.getRange([0,4]));
      assert.equal('12345', node.getRange([0,5]));
      assert.equal('123456', node.getRange([0,6]));
      assert.equal('1234567', node.getRange([0,7]));
      assert.equal('12345678', node.getRange([0,8]));
      assert.equal('123456789', node.getRange([0,9]));
      assert.equal('1234567890', node.getRange([0,10]));
      assert.equal('12345678901', node.getRange([0,11]));
      assert.equal('123456789012', node.getRange([0,12]));
      assert.equal('1234567890123', node.getRange([0,13]));
      assert.equal('1234567890123', node.getRange([0,14]));
      assert.equal('234', node.getRange([1,4]));
      assert.equal('2345', node.getRange([1,5]));
      assert.equal('23456', node.getRange([1,6]));
      assert.equal('234567', node.getRange([1,7]));
      assert.equal('2345678', node.getRange([1,8]));
      assert.equal('23456789', node.getRange([1,9]));
      assert.equal('234567890', node.getRange([1,10]));
      assert.equal('2345678901', node.getRange([1,11]));
      assert.equal('23456789012', node.getRange([1,12]));
      assert.equal('234567890123', node.getRange([1,13]));
      assert.equal('234567890123', node.getRange([1,14]));
      assert.equal('34', node.getRange([2,4]));
      assert.equal('345', node.getRange([2,5]));
      assert.equal('3456', node.getRange([2,6]));
      assert.equal('34567', node.getRange([2,7]));
      assert.equal('345678', node.getRange([2,8]));
      assert.equal('3456789', node.getRange([2,9]));
      assert.equal('34567890', node.getRange([2,10]));
      assert.equal('345678901', node.getRange([2,11]));
      assert.equal('3456789012', node.getRange([2,12]));
      assert.equal('34567890123', node.getRange([2,13]));
      assert.equal('34567890123', node.getRange([2,14]));
      assert.equal('4', node.getRange([3,4]));
      assert.equal('45', node.getRange([3,5]));
      assert.equal('456', node.getRange([3,6]));
      assert.equal('4567', node.getRange([3,7]));
      assert.equal('45678', node.getRange([3,8]));
      assert.equal('456789', node.getRange([3,9]));
      assert.equal('4567890', node.getRange([3,10]));
      assert.equal('45678901', node.getRange([3,11]));
      assert.equal('456789012', node.getRange([3,12]));
      assert.equal('4567890123', node.getRange([3,13]));
      assert.equal('4567890123', node.getRange([3,14]));


      // node.insert(0,'0');
      // node.insert(0,'0');
      // assert.equal('001234567890123', node.toString())
      // node.removeCharAt(0);
      // assert.equal('01234567890123', node.toString())
      // node.removeCharAt(5);
      // assert.equal('0123467890123', node.toString())
      assert.equal('1234567890123', node.toString())
      node.removeCharAt(0);
      assert.equal('234567890123', node.toString())
      node.removeCharAt(2);
      assert.equal('23567890123', node.toString())

      node.insert(5, '1')
      node.insert(6, '2')
      node.insert(7, '3')
      node.insert(8, '4')
      // node.removeCharAt(1);
      // assert.equal('01234567890123', node.toString())
      // assert.equal('12345', node.get(0).node.value);
      // assert.equal('67890', node.get(5).node.value);
      // assert.equal(0, node.get(5).offset);
      // assert.equal('123', node.get(10).node.value);
      // assert.equal(0, node.get(10).offset);
    }
  })
})

t('gap insert', function() {
  repeat(times, function() {
    var node = new SkipString();
    node.insert(5, 'foo');
    assert.equal(null, node.get(4).node.value);
    assert.equal('foo', node.get(5).node.value);
    node.insert(15, 'bar');
    assert.equal('foo', node.get(14).node.value);
    assert.equal('bar', node.get(15).node.value);
    node.insert(9, 'zoo');
    assert.equal('zoo', node.get(14).node.value);
    assert.equal('zoo', node.get(15).node.value);
    assert.equal('bar', node.get(18).node.value);
    node.insert(11, 'r');
    assert.equal('zoro', node.get(14).node.value);
    node.insert(50, 'x');
    assert.equal('x', node.get(50).node.value);
    node.insert(100, 'y');
    assert.equal('foo', node.get(5).node.value);
    assert.equal('zoro', node.get(9).node.value);
    assert.equal('x', node.get(50).node.value);
    assert.equal('y', node.get(100).node.value);
    node.insert(200, 'z');
    assert.equal('foo', node.get(5).node.value);
    assert.equal('zoro', node.get(9).node.value);
    assert.equal('x', node.get(50).node.value);
    assert.equal('y', node.get(100).node.value);
    assert.equal('z', node.get(200).node.value);
  })
})

/**/
};

function repeat(times, fn) {
  while (times--) fn();
}
