// JD5 regression fixture — a shorthand METHOD in a CommonJS export object is
// part of the module's public surface.
//
// `module.exports = { run() { … } }` is the dominant modern CJS form. The
// grammar spells a shorthand method as a `method_definition`, while the export
// collector only read `shorthand_property_identifier`, `identifier`, and `pair`
// keys — so the method was absent from the module's export surface AND from its
// `exports` relationship. Pre-fix, the line below exported NOTHING; the
// same-object `plain` key was the only thing that survived, which is what made
// the gap easy to miss: the export list looked populated.
//
// A `get`/`set` pair is included because the accessor halves are also
// `method_definition` and were dropped by the same miss. Computed keys and
// object spread are deliberately NOT pinned here: neither names a statically
// knowable export, and the contract is to decline them rather than guess.

module.exports = {
  run() {
    return step();
  },
  get val() {
    return 1;
  },
  set val(v) {
    this.stored = v;
  },
  plain: 1,
  ref,
};

function step() {
  return 1;
}
