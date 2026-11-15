// M49 dup-key ruling (#746) regression fixture — TS object-literal
// last-wins. Pre-fix contract: every object-literal member emitted its own
// symbol (keep-both: 2 save symbols) and the phantom first body's calls
// stayed in the graph, while JS at runtime executes the LAST same-key
// declaration. Ruled contract (family-wide, Option A): one symbol per key
// keyed to the LAST declaration; the dead body's edges are dropped.
// Class-body overloads are NOT affected (different node kind); get/set
// pairs coexist (B5).
export const helpers = {
  save() { return firstHelper(); },
  save() { return lastHelper(); },
}
function firstHelper() { return 1 }
function lastHelper() { return 2 }
