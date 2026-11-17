// go/cross-file-call-visibility — A CALL TO A SIBLING-FILE FUNCTION IS A CALL.
//
// `resolveGoFunctionCall`'s bare branch required the callee to resolve to a
// SAME-FILE callable. A function declared in ANOTHER FILE of the same package —
// which in Go is routine, not an edge case — was therefore DROPPED ENTIRELY:
// no `calls` edge at all, at any confidence.
//
// PROVEN on `go-tools/cmd/benchcmp`:
//
//   fatal, formatNs, parseFile   declared in benchcmp.go  -> `calls` rows YES
//   Correlate                    declared in compare.go   -> NO edge at all
//
// (Correlate is called at benchcmp.go:50: `cmps, warnings := Correlate(before, after)`.)
//
// FOUND BY THE ORACLE DIFFERENTIAL. Every internal invariant the lane owns was
// green while 16,004 cross-file calls were invisible — 4.4% of the whole graph.
//
// MEASURED on go-tools + terraform (3,422 files): `calls` 128,259 -> 142,609 and
// total edges 363,830 -> 385,219, with the symbol count UNCHANGED at 58,470 and
// every other relationship type byte-identical. On the 400-file oracle draw,
// `calls` recall went 0.607 -> 0.634 and the UNEXPLAINED `calls` bucket 934 -> 461.
//
// THE TWO-HALF CONTRACT THIS FIXTURE PINS. A bare callee is emitted when it is NOT
// locally bound, and stays silent when it IS. Both halves are required: emitting
// everything would fabricate calls for closures, and emitting only same-file
// declarations is the bug being fixed.
package crossfilecallvisibility

type Set struct{}

// A LOCAL CLOSURE variable. `done()` is NOT a static call to a declared symbol —
// LocalsAreNotSymbols keeps locals out of the graph, so this MUST stay silent.
func localClosure() {
	done := func() {}
	done()
}

// A PARAMETER that is callable. Also locally bound, also silent.
func paramCall(fn func()) {
	fn()
}

// A RANGE variable used as a callee: bound by the loop, silent.
func rangeCall(fns []func()) {
	for _, f := range fns {
		f()
	}
}

// The sibling-file shape: `SiblingHelper` is NOT declared in this file, so it can
// only name a package-level function from another file of the package. MUST emit.
func siblingCaller(before, after *Set) {
	cmps, warnings := SiblingHelper(before, after)
	_ = cmps
	_ = warnings
}
