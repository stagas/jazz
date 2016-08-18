
var es = new EventSource('/refresh');

es.onclose = es.onerror = () => {
  setTimeout(() => document.location.reload(), 2700);
};
