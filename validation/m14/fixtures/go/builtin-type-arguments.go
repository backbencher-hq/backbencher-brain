// go/builtin-type-arguments — A TYPE NAMED IN EXPRESSION POSITION IS STILL A USE.
//
// `new(T)` and `make(T, ...)` name a TYPE, but the callee is a BUILTIN, so the lane
// publishes no `calls` edge for it (builtin leaves are deliberately filtered). The only
// fact left is that the enclosing declaration USES T — and that row was MISSING.
//
// MINIMAL REPRODUCTION, before the fix:
//
//     type Thing struct{ N int }
//     type MSet map[string]int
//     func build() { p := new(Thing); m := make(MSet); _ = p; _ = m }
//
// emitted `Thing contains -> N`, `nm exports -> Thing`, `nm exports -> MSet` and
// NOTHING for the two uses. The type was invisible to the graph.
//
// FOUND BY THE ORACLE DIFFERENTIAL, NOT BY AN INTERNAL INVARIANT — every coverage,
// range, resolution and explanation check the lane owns was GREEN while this edge was
// missing. That is the whole reason an independent oracle has to exist, and it is why
// "all internal gates green" is not the same claim as "the graph is correct".
//
// MEASURED on go-tools + terraform (3,422 files): 636 `new`/`make` call sites, 180 of
// them passing a type declared in the same file. After the fix the baseline gains
// **898 `references` edges** (71,249 -> 72,147) with the symbol count UNCHANGED at
// 58,470 and every other relationship type byte-identical — the shape a pure
// missing-edge fix must have.
package builtintypearguments

import "bytes"

type Thing struct{ N int }

type MSet map[string]int

type Slice []Thing

func build() {
	p := new(Thing)      // same-file type
	m := make(MSet)      // same-file named map
	s := make(Slice, 4)  // same-file named slice
	b := new(bytes.Buffer) // QUALIFIED: leaf target + qualifiedType
	_ = p
	_ = m
	_ = s
	_ = b
}
