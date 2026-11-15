// ONTOLOGY fixture — a MODULE imported SCOPED more than once, and what the
// `imports` edge says about it.
//
// Authored from the measured grammar shapes (script/m14/swift-grammar-shape-probe.ts:
// `import struct Foo.Bar` and `import let Foo.Bar` put an anonymous `struct` /
// `let` token between `import` and the path) and from the corpus population the
// rule was written for.
//
// The rule under test: the `imports` edge is ONE PER MODULE — `import struct
// Single.Alpha`, `import struct Single.Beta` and `import struct Single.Epsilon`
// are three statements and ONE module dependency — so the edge's single-valued
// `scopedItem` cannot describe all of them. It is published only when the module
// has exactly one scoped import in the file; above that it is dropped and
// `scopedItemCount` is published instead, because a field that is silently
// partial reads as though it named them all.
//
// What each pin asserts, and what it would catch:
//   1. `Single` (3 scoped imports) carries `scopedItemCount: 3` and NO
//      `scopedItem`. An implementation that copies the first statement's
//      `scopedItem` publishes `Alpha` and fails this row.
//   2. `Pair` (2 scoped imports) carries `scopedItemCount: 2` and no
//      `scopedItem` — the rule is about ANY module scoped 2+ times, not about
//      one particular count.
//   3. `Solo` (1 plain import) carries NO `scopedItem` and NO
//      `scopedItemCount`: an unscoped import must not grow a count field.
//   4. `references` is PER STATEMENT and unchanged — 6 statements, 6 edges,
//      each naming the SPELLED path (`Single.Alpha`, `Pair.Gamma`, ...). This
//      is the pair of counts that says `imports` and `references` are not the
//      same rule, and a relabel of either dies here.
//   5. `imports` targets a MODULE, never a dotted spelling (R10 — the failure go
//      documents for `net/http`).
//   6. The per-statement record is untouched: every import statement keeps its
//      own `ImportInfo` row with its own `scopedItem`, so nothing is lost by
//      the rule above. That is what makes dropping the field honest rather than
//      lossy, and it is why no `forbid` row can forbid `scopedItem` outright.

import struct Single.Alpha
import struct Single.Beta
import let Pair.Gamma
import let Pair.Delta
import Solo
import struct Single.Epsilon
