// R7 regression fixture — an edge with an EMPTY endpoint is never published.
//
// Standing rule R7: when a fallback has nothing truthful to say, the honest state
// is ABSENCE, not a placeholder or an empty string. An edge whose endpoint is
// `""` names nothing — it cannot be resolved, hovered or followed — and every
// consumer that counts names gets a row for a name no file contains.
//
// Measured before the fix (13,202 admitted corpus files, 356,490 edges): 2,037
// rows carried an empty source or target, and every one of them came from
// tree-sitter's ERROR RECOVERY producing a zero-length node:
//
//   uses  <- ""   a bare read of a zero-length `identifier`                 1,934
//   uses  <- ""   a member-chain segment whose property node is missing          87
//   uses  <- ""   a `template_substitution` written `${ }`                      5
//   uses  "" -> x an empty SOURCE (`method ?? owner ?? moduleName` keeps "")      7
//   calls <- ""   a callee node recovery left empty                              3
//   exports <- "" a CJS surface path segment that is empty                       1
//
// This fixture is the CLEAN half: every construct here is valid JavaScript, so
// nothing here should ever produce an empty endpoint. It pins the invariant
// across all six affected relationship types AND pins the edges around them, so a
// guard implemented as "drop everything" fails here rather than passing vacuously.
// The recovery-damaged shapes are exercised by `recovery-empty-node-endpoints`.

class Store {
  constructor() {
    this.count = 0;
    this.label = "shelf";
  }

  bump(by) {
    return this.count + by;
  }
}

const store = new Store();

function describe(item) {
  return item.label + ":" + store.count;
}

export function run(by) {
  return describe(store) + store.bump(by);
}

// A CJS deep-export write, the shape whose path segment can come back empty.
module.exports.store = store;