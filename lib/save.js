
module.exports = save;

function save(url, src, cb) {
  return fetch(url, {
      method: 'POST',
      body: JSON.stringify({ text: src }),
      headers: new Headers({
        'Content-Type': 'application/json'
      })
    })
    .then(cb.bind(null, null))
    .catch(cb);
}
