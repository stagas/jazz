
module.exports = open;

function open(url, cb) {
  return fetch(url)
    .then(getJson)
    .then(getText)
    .then(cb.bind(null, null))
    .catch(cb);
}

function getJson(res) {
  return res.json();
}

function getText(json) {
  return Promise.resolve(json.text);
}
