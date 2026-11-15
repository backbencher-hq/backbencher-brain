// PINS the R7 ENDPOINT GATE at the choke point — no relationship may carry an
// empty endpoint, whichever of the nine push sites produced it.
//
// MEASURED, not asserted. `script/m14/go-endpoint-defects.ts` over go-stdlib
// (11,788 files through the production `parseFile`) found 4 `references` edges
// with an empty TARGET, every one in a compiler-rejection fixture:
//
//   src/cmd/compile/internal/syntax/testdata/tparams.go        f -> ""
//     (`func f[ /* ERROR empty type parameter list */ ]()`)
//   src/internal/types/testdata/check/vardecl.go           global -> ""
//   src/internal/types/testdata/examples/functions.go          h -> ""
//   src/internal/types/testdata/fixedbugs/issue45635.go   global -> ""
//
// The cause is the same in all four: the grammar produced an ERROR or MISSING
// node where a type was expected, the name read off it was empty, and the edge
// went out anyway. An edge with an empty endpoint resolves to nothing and can
// never be followed.
//
// WHY THE FIX IS ONE GATE AND NOT FOUR: each emitter reads a name from a node it
// believes is well formed, and the grammar does not always deliver one. A guard
// per push site fixes the site it was written for and leaves the other eight —
// which is exactly how the PHASE-3b import guard was bypassed by a raw-string
// import spelling (see imports-empty-path.go). The gate now sits once, before
// the evidence-tier classifier, so every site is covered by construction.
//
// THE SHAPES MATTER and are pinned here, because the guard must not be
// implemented as "drop the file" or "drop the whole declaration":
//   - a MALFORMED generic type parameter list must cost exactly the ONE edge
//     whose type name is unreadable, and nothing else in the file;
//   - a well-formed generic type in the SAME file must still produce its
//     `references` edges;
//   - a VALID file must drop nothing at all, which is the control: a gate that
//     drops rows on good input is indistinguishable from a gate that is too
//     aggressive, and only the control tells the two apart.
package gofixture

import "fmt"

// A well-formed generic type: its type arguments must still resolve, so the
// guard cannot be "drop anything under a type parameter list".
type Pair[A any, B any] struct {
	First  A
	Second B
}

// A well-formed generic function, same purpose.
func MakePair[A any, B any](a A, b B) Pair[A, B] {
	return Pair[A, B]{First: a, Second: b}
}

// The malformed shape from tparams.go, reproduced: an EMPTY type parameter
// list, which the pinned grammar accepts as a parameter_list with no type
// nodes. This is the edge whose name is unreadable.
func Broken[ /* ERROR empty type parameter list */ ]()

// A second well-formed declaration AFTER the malformed one, so "stop emitting
// once you have seen an error" is caught: Go is not C and a syntax error
// upstream does not silence a declaration downstream.
type After struct {
	N int
}

var (
	_ = fmt.Sprintf
	_ = MakePair[int, string]
	_ = After{}
)