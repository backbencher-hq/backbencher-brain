// #744 fixture source — authored before analyzer run.
const config = { inner: { deeper: { leaf: 1 } } };

function read() {
  // chain root `config` MUST emit (pre-fix dropped), plus inner/deeper/leaf
  return config.inner.deeper.leaf;
}

function bare() {
  // bare identifier read MUST emit (pre-fix invisible)
  return config;
}

function gated(flag) {
  if (flag) {
    // write LHS: config.inner is a WRITE — no uses read of inner (JSD1)
    config.inner = 1;
  }
  // bare read of config MUST emit; flag read MUST emit
  return config;
}

function takesValue(v) {
  // call-callee stays calls-only; parameter `v` is a bare read
  return helper(v) + v;
}

function helper(x) {
  return x;
}
