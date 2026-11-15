// M65 — PART_OF DEDUP: two QUOTED includes that share a FILE STEM are TWO facts, one edge.
//
// WHAT THIS PINS, and why no existing fixture could. The include dedup guard read
// `referencesSeen.has(includePath)` while the row emits `cppPartSymbol(includePath)` — two
// different fields. When two quoted includes share a stem, the guard passed where the row
// repeated, so the file published the SAME (source, target) row twice. That is the
// `one edge per pair` contract, broken, and it was invisible to the suite:
// `cpp/one-edge-per-pair-959` contains only ANGLE includes (so key and target are the same
// string and the bug cannot fire), and `cpp/part-of-quoted-include` carries a single quoted
// include (which cannot collide with itself).
//
// A stem collision needs TWO QUOTED includes in one file whose stems agree. This file writes
// exactly that, twice, in the two shapes the corpus actually produces:
//
//   * `"fmt/format.h"` + `"format.cc"`  -> both stem `format`   (fmt/src/fmt.cc, measured)
//   * `"detail/impl.h"` + `"impl.h"`    -> both stem `impl`     (the flat-spelling variant)
//
// Each pair must publish ONE `part_of` edge, and the edge takes the FIRST directive's line
// because the walk is in source order.
//
// THE OTHER HALF: each pair must ALSO publish its own `imports` edge for any ANGLE include
// that happens to name the same string, because `part_of` and `imports` are different
// relationship types. That is the regression this fix's first cut introduced and the census
// caught: keying the shared set on the target alone let `part_of`'s `format` suppress a real
// `<format>` import. The two rows below pin both facts for the same name.
#include "fmt/format.h"
#include <format>
#include <vector>

#include "format.cc"

#include "detail/impl.h"
#include "impl.h"
#include <string>

// A THIRD pair with a DIFFERENT stem, so the assertions are not an artifact of one name.
#include "core/args.h"
#include "args.h"

int use_them(int v) {
  std::vector<int> xs;
  xs.push_back(v);
  return v;
}