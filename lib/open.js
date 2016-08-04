
module.exports = open;

function open(url, cb) {
  return fetch(url)
    .then(getText)
    .then(cb.bind(null, null))
    .catch(cb);
}

function getText(res) {
  return res.text();
}
