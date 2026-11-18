// go/composite-literal-wrapper-types — A WRAPPER TYPE STILL NAMES WHAT IT CONSTRUCTS.
//
// The composite-literal pass handled only a BARE type node — `type_identifier`,
// `qualified_type`, `generic_type` — and its comment declared that wrapper types
// "yield no named target". So every composite literal whose type is a SLICE, ARRAY,
// MAP, POINTER or CHANNEL of a named type published NOTHING:
//
//     []Item{{N: 1}}        -> no edge      (the elided element literal)
//     [4]Item{}             -> no edge
//     map[string]Item{}     -> no edge
//     &Item{}               -> no edge      (pointer_type)
//     Item{N: 2}            -> an edge      (the only shape that worked)
//
// FOUND BY THE ORACLE DIFFERENTIAL on go-tools/internal/refactor/inline/inline_test.go,
// where `runTests(t, []testcase{...})` appears EIGHT times and only the one direct
// `testcase{...}` had a row.
//
// MEASURED on go-tools + terraform (3,422 files): edges 387,981 -> 422,841 (+34,860,
// all `instantiates`), symbols UNCHANGED at 58,470, dangling source 0.1915 % -> 0.1800 %.
// On the 400-file oracle draw, `references` oracle-only fell 120 -> 62 — a construction
// edge and a reference edge are different rows, and the oracle expects both from the
// same literal.
//
// THREE SUBTLETIES, each a bug the first cut had:
//
//   1. A MAP constructs its KEY and VALUE types, so both are emitted; every other
//      wrapper yields the single element type.
//   2. PREDECLARED types are filtered: `map[string]Item{}` constructs Item, and its
//      key `string` must not become `instantiates -> string`. The first cut emitted it.
//   3. DEDUPE IS PER SITE, not per (source, target). The old key collapsed all four
//      literals below into ONE row carrying the FIRST line, so three real constructions
//      vanished and the surviving row pointed at the wrong line.
package compositewrappertypes

type Item struct{ N int }

func build() {
	a := []Item{{N: 1}}     // slice of named type, elided element literal
	b := [4]Item{}          // array of named type
	c := map[string]Item{}  // map: key is predeclared (no row), value is Item
	d := &Item{}            // pointer to named type
	e := Item{N: 2}         // the bare shape that already worked
	_, _, _, _, _ = a, b, c, d, e
}
