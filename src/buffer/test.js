
var assert = require('assert');

module.exports = function(t, Buffer) {
  var times = 50;

  t('set', function() {
    var buffer = new Buffer;
    var a = '12345\r\n789\n\n234\n67';
    buffer.set(a);
    assert.equal(17, buffer.text.length);
    assert.equal(4, buffer.lines.length);
    var a = '12345\r\n789\n';
    buffer.set(a);
    assert.equal(10, buffer.text.length);
    assert.equal(2, buffer.lines.length);
  })

  t('get', function() {
    var buffer = new Buffer;
    var a = '12345\r\n789\n\n234\n67';
    buffer.set(a);
    assert.equal('12345\n789\n\n234\n67', buffer.get());
    assert.equal('12345\n', buffer.get([0,0]));
    assert.equal('12345\n789\n', buffer.get([0,1]));
    assert.equal('789\n', buffer.get([1,1]));
    assert.equal('789\n\n', buffer.get([1,2]));
    assert.equal('\n', buffer.get([2,2]));
    assert.equal('234\n', buffer.get([3,3]));
    assert.equal('67', buffer.get([4,4]));
    assert.equal('234\n67', buffer.get([3,4]));
  })

  t('insert', function() {
    var buffer = new Buffer;
    var a = '12345\r\n789\n\n234\n67';
    buffer.insert({x:0,y:0},a);
    assert.equal(17, buffer.text.length);
    assert.equal(4, buffer.lines.length);
    // buffer.insert({x:2,y:0},'ab');
    // assert.equal(19, buffer.text.length);
    // assert.equal(4, buffer.lines.length);
    assert.equal('12345\n', buffer.get([0,0]));

    buffer.insert({x:2,y:0},'ab');
    assert.equal('12ab345\n', buffer.get([0,0]));
    buffer.insert({x:0,y:2},'cd');
    assert.equal('12ab345\n789\ncd\n234\n67', buffer.get());
    buffer.insert({x:0,y:3},'ef');
    assert.equal('12ab345\n789\ncd\nef234\n67', buffer.get());
    buffer.insert({x:0,y:4},'gh');
    assert.equal('12ab345\n789\ncd\nef234\ngh67', buffer.get());
    buffer.insert({x:2,y:4},'ij');
    assert.equal('12ab345\n789\ncd\nef234\nghij67', buffer.get());
    buffer.insert({x:10,y:4},'kl');
    assert.equal('12ab345\n789\ncd\nef234\nghij67kl', buffer.get());

    var buffer = new Buffer;
    var a = '12345\n789';
    var b = 'ab\ncdef'
    buffer.insert({x:0,y:0}, a);
    buffer.insert({x:2,y:1}, b);
    assert.equal('12345\n78ab\ncdef9', buffer.get());
    buffer.insert({x:0,y:0}, '\n');
    assert.equal('\n12345\n78ab\ncdef9', buffer.get());
  })

  t('insert end newline', function() {
    var buffer = new Buffer;
    var a = '12345\n';
    buffer.insert({x:0,y:0},a);
    assert.equal(6, buffer.text.length);
    assert.equal(1, buffer.lines.length);
    buffer.insert({x:0,y:0},'abc');
    assert.equal(9, buffer.text.length);
    assert.equal(1, buffer.lines.length);
    buffer.insert({x:8,y:0},'def');
    assert.equal(12, buffer.text.length);
    assert.equal(1, buffer.lines.length);
    assert.equal('abc12345def\n', buffer.get());
    buffer.insert({x:100,y:1},'gh');
    buffer.insert({x:100,y:1},'ij');
    buffer.insert({x:100,y:1},'ml');
    assert.equal('abc12345def\nghijml', buffer.get())
  })

  t('deleteCharAt', function() {
    var buffer = new Buffer;
    var a = '12345\n789\n123';
    buffer.insert({x:0,y:0}, a);
    assert.equal('12345\n789\n123', buffer.get());
    buffer.deleteCharAt({x:1,y:0});
    assert.equal('1345\n789\n123', buffer.get());
    buffer.deleteCharAt({x:0,y:0});
    assert.equal('345\n789\n123', buffer.get());
    buffer.deleteCharAt({x:0,y:0});
    assert.equal('45\n789\n123', buffer.get());
    buffer.deleteCharAt({x:0,y:0});
    assert.equal('5\n789\n123', buffer.get());
    buffer.deleteCharAt({x:0,y:0});
    assert.equal('\n789\n123', buffer.get());
    buffer.deleteCharAt({x:0,y:0});
    assert.equal('789\n123', buffer.get());
  })

  t('edge case', function() {
    repeat(times, function() {
      for (var i = 1; i < 10; i++) {
        Buffer.CHUNK_SIZE = i;
        var buffer = new Buffer;
        buffer.set('1234567\n7890123\n456789012');
        assert.equal('1234567\n7890123\n456789012', buffer.get());
        buffer.insert({x:0,y:0}, '\n');
        buffer.insert({x:0,y:1}, '\n');
        assert.equal('\n\n1234567\n7890123\n456789012', buffer.get());
        buffer.deleteCharAt({x:0,y:1});
        buffer.deleteCharAt({x:0,y:0});
        assert.equal('1234567\n7890123\n456789012', buffer.get());
        buffer.insert({x:0,y:0}, '\n');
        buffer.insert({x:0,y:1}, '\n');
        assert.equal('\n\n1234567\n7890123\n456789012', buffer.get());
        buffer.deleteCharAt({x:0,y:1});
        buffer.deleteCharAt({x:0,y:0});
        assert.equal('1234567\n7890123\n456789012', buffer.get());
        buffer.insert({x:0,y:1}, '\n');
        assert.equal('1234567\n\n7890123\n456789012', buffer.get());
        // buffer.insert({x:0,y:2}, '\n');
      }
    })
  })

  t('edge case 2', function() {
    for (var i = 1; i < 15; i++) {
      Buffer.CHUNK_SIZE = i;
      var buffer = new Buffer;
      buffer.set('hello\none\nworld\n');
      assert.equal('one\n', buffer.get([1,1]));
      buffer.insert({x:3,y:1}, '1');
      assert.equal('one1\n', buffer.get([1,1]));
    }
  })

};

function repeat(times, fn) {
  while (times--) fn();
}
