// go/builtin-type-arguments — A TYPE NAMED IN EXPRESSION POSITION IS STILL A USE.
//
// Three expression-position surfaces name a TYPE, and all three were invisible:
//
//   1. `new(T)` / `make(T, ...)`  the callee is a BUILTIN, so no `calls` edge exists
//   2. `x.(*T)`                   a TYPE ASSERTION
//   3. `case *T:`                 a TYPE SWITCH case
//
// MINIMAL REPRODUCTION, before the fix (all three emitted NOTHING):
//
//     type Thing struct{ N int }
//     type Other struct{ M int }

type Third struct{ K int }
//     func build() { p := new(Thing); _ = p }
//     func check(x any) { _ = x.(*Other); switch x.(type) { case Thing: } }
//
// emitted the declarations' own rows and NOT ONE edge for the uses — the types were
// invisible to the graph.
//
// FOUND BY THE ORACLE DIFFERENTIAL, NOT BY AN INTERNAL INVARIANT — every coverage,
// range, resolution and explanation check the lane owns was GREEN while these edges
// were missing. That is the whole reason an independent oracle has to exist, and it is
// why "all internal gates green" is a weaker claim than "the graph is correct".
//
// MEASURED on go-tools + terraform (3,422 files): 636 `new`/`make` call sites, 180 of
// them passing a type declared in the same file. After BOTH fixes the baseline gains
// **7,859 `references` edges** (71,249 -> 79,108, of which +898 is new/make and +6,961
// is assertions and type switches) with the symbol count UNCHANGED at 58,470 and every
// other relationship type byte-identical — the exact shape a pure missing-edge fix must
// have, and the check that this is not a relabel in disguise. Dangling source improved
// 0.2039 % -> 0.1999 % as a side effect.
package builtintypearguments

import "bytes"

type Thing struct{ N int }

type MSet map[string]int

type Slice []Thing

type Other struct{ M int }

type Third struct{ K int }

func build() {
	p := new(Thing)        // 1. same-file type via new
	m := make(MSet)        // 1. same-file named map via make
	s := make(Slice, 4)    // 1. same-file named slice via make
	b := new(bytes.Buffer) // 1. QUALIFIED: leaf target + qualifiedType
	_ = p
	_ = m
	_ = s
	_ = b
}

func check(x any) {
	if t, ok := x.(*Other); ok { // 2. type ASSERTION
		_ = t
	}
}

func sw(x any) {
	switch x.(type) { // 3. TYPE SWITCH case
	case *Third:
		_ = x
	}
}
