// GO-GAP-1 — the declarations a grammar error used to swallow.
//
// Two constructs here are LEGAL Go and the PREVIOUSLY wired tree-sitter-go
// errored on both:
//
//   var _ = slices.Backward[[]int]      Go 1.21+ generic function as a VALUE
//   func (Either[A, B]) A() A           Go 1.18+ method on an instantiated
//                                       generic receiver
//
// The cost was not the construct — it was ERROR RECOVERY. Everything after the
// first error was re-read as composite-literal debris, so the declarations
// AFTER it stopped being declarations. Measured on the real corpus file
// go-tools/.../slicesbackward/slicesbackward.go: 1 symbol and 195 errors before
// the grammar bump, 40 symbols and 0 errors after.
//
// So this fixture pins the RECOVERY BOUNDARY, not the exotic syntax: the
// function declared after a package-scope generic value must be a symbol, must
// own its methods, and must publish the calls in its body. A grammar that
// recovers by swallowing loses all of that silently.
package gapfix

import "sync"

func Backward[Slice ~[]E, E any](s Slice) Slice { return s }

// The construct that used to start the debris: a package-scope generic VALUE.
var _ = Backward[[]int]

// DECLARED AFTER THE ERROR SITE. Under the old grammar this was not a symbol.
func afterTheValue(s []sync.Mutex) {
	for i := len(s) - 1; i >= 0; i-- {
		s[i].Lock()
		s[i].Unlock()
	}
}

type Either[A, B any] struct {
	a A
	b B
}

// A method on an INSTANTIATED generic receiver — the second errored construct.
func (Either[A, B]) Fst() A { return *new(A) }

// Another declaration after a second error site.
func afterTheMethod() int { return 0 }
