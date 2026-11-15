const result = earlyCall();

function earlyCall() {
  return inner(2);
}

function inner(x) {
  return x * 3;
}
