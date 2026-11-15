function add(a, b) {
  return a + b;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = { add, formatDate };
