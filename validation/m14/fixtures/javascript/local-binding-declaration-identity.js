// LOCAL-BINDING DECLARATION IDENTITY (R2) — TWO DECLARATIONS OF THE SAME NAME IN ONE CALLABLE.
//
// R2 (charter §21.41): "A DEDUP KEY MUST CARRY THE DECLARATION'S IDENTITY WHENEVER THE ROW'S
// IDENTITY IS THE OCCURRENCE — NOT THE NAME." A local read is spelled `<callable>\u0000<name>`,
// so two reads of TWO DIFFERENT declarations that share a name in one function spell IDENTICALLY.
// Measured on this lane before the fix (script/m14/js-r2-identity-probe.ts, CASE 1): the two reads
// of `value` produced ONE row and the outer read was DROPPED — a lost fact, not a wrong one.
//
// POSITIVE: `value` is declared in the function body and again in a nested block, and BOTH are
//   read. The two reads name TWO DIFFERENT declarations, so there must be TWO rows — one per
//   declaration, each at its own read's line.
//
// NEGATIVE (and this is the half a LINE-KEYED fix gets wrong): `total` is declared ONCE and read
//   TWICE. One declaration read twice is ONE row. R2 says the line is not the answer — a line
//   cannot tell "two reads of one declaration" from "two reads of two declarations", so it splits
//   both. The second read of `total` must NOT be a row.

function shadowed(limit) {
  const value = 1;
  if (limit) {
    const value = 2;
    return value;
  }
  return value;
}

function readTwice(flag) {
  const total = 0;
  const first = total;
  const second = total;
  return first + second;
}
