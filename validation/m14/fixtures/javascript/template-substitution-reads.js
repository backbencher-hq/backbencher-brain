// M49 W4 (ledger J6) — template-substitution read positions.
//
// Authored BEFORE the analyzer run. The contract pinned here is the family's
// own: a substituted identifier is a read only when it is not part of a call's
// callee expression and not an assignment target (a callee is covered by the
// calls edge; a receiver belongs to that callee). `uses label` must be exactly
// ONE edge — the template walk owns substitution reads (TS TSD28: "Uses only,
// singular"), while the general identifier walk covers the rest.
function fn(x) {
  return x;
}

const obj = { m(v) { return v; } };

function render(label, source) {
  const plain = `${label}`;
  const chain = `${source.b}`;
  const callee = `${fn(source)}`;
  const receiver = `${obj.m(source)}`;
  return [plain, chain, callee, receiver];
}
