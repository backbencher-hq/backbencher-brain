// M49 W1 (#768) write-LHS contract fixture — authored before the analyzer run.
//
// A member-chain write (obj.a.b = v) suppresses ONLY its own write target.
// Two defects lived where no fixture looked:
//   1. the walk `continue`d on the write node, so the child-push at the loop
//      tail never ran — the ENTIRE subtree was skipped and every read nested
//      inside the statement was lost (call arguments, intermediate segments).
//   2. the chain HEAD was emitted as raw node TEXT, so a call-rooted chain
//      fabricated a non-symbol target (`uses -> document.getElementById(id)`).
// Both were surfaced by the #760 cold-pool rotation on grails-core / lodash.

const store = { count: 0, inner: { limit: 1 } };

function bump(delta) {
  // reads: store (chain root) + inner (intermediate segment) + delta (argument)
  // write: limit — must NOT emit a read
  store.inner.limit = delta;
}

function dom(id) {
  // reads: id (call argument) + style (intermediate segment)
  // write: display — must NOT emit a read
  // the call-rooted head is an EXPRESSION, not a symbol — never a target
  document.getElementById(id).style.display = "none";
}

function augmented(step) {
  // += shares the left field: still a write target, argument still a read
  store.count += step;
}
