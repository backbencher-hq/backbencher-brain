// go/type-argument-uses — AN INSTANTIATION NAMES ITS TYPE ARGUMENTS.
//
// `is[*Named](t)` is a generic function CALL, and the lane already published the call
// (`calls -> is`). What it did NOT publish is that the expression also NAMES the type
// `Named`: the argument lives under `type_arguments` inside a `generic_type`, and no pass
// read it, so the type was invisible to the graph.
//
// FOUND BY THE ORACLE DIFFERENTIAL on go-tools/go/analysis/passes/modernize/maps.go:278
// (`if is[*types.Named](t)`), where the oracle expected `references -> Named` and the
// analyzer emitted nothing. 22 of the 62 then-unexplained rows were the callee `is`.
//
// EXPRESSION POSITION ONLY, and that boundary is the whole difficulty. A `generic_type` in
// TYPE position belongs to the declaration pass — `type Box[T any] struct{...}` (where `T` is
// the declared type PARAMETER, not a use), `func f(x Box[string])`, a struct field type, a
// result type. Reading those here published `references Box -> T` for a parameter that uses
// nothing, which is why the first cut pushed `global` from 761 to 1,063 and the dangling rate
// from 0.18 % to 0.25 %. The guard skips every generic_type whose parent is a declaration,
// parameter, field or another type-argument list.
//
// MEASURED on go-tools + terraform (3,422 files): `references` 82,067 (from 79,108, +2,959)
// and on the 400-file oracle draw the UNEXPLAINED `references` bucket fell 62 -> 34.
package typeargumentuses

import "sync"

type Named struct{ N int }

type Box[T any] struct{ v T }

// is mirrors the real helper: a package-level generic function.
func is[T any](x any) bool { _, ok := x.(T); return ok }

func call(t any) bool {
	return is[*Named](t) // the type ARGUMENT Named is a use
}

func withMutex(m *sync.Mutex) {
	m.Lock()
	m.Unlock()
}

// A package-scope var of an instantiated type: the argument is a use of int, and int is
// predeclared, so no row. The construction `Box[int]{}` is the composite-literal pass's.
var Global = Box[int]{}

func explicit() {
	_ = Box[string]{} // explicit instantiation in expression position
}
