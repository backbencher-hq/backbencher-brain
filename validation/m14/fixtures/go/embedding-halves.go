// go/embedding-halves — THE EMBEDDING CONTRACT'S TWO HALVES, PINNED APART.
//
// Go's embedding is published under TWO stored relationship types, and the
// split is the CONTRACT's, not the construct's name:
//
//   STRUCT half      `type T struct{ E }`      -> `mixes_in`
//     E's IMPLEMENTATION is composed into T's method set. There is no single
//     base (a struct may embed several), the embed list is not an inheritance
//     clause, and no conformance is declared — which is exactly the `mixes_in`
//     member's own definition and its own "not extends / not implements" test.
//     The row keeps its confidence 0.8, its evidenceClass (`inferred`, derived
//     from that confidence) and its `go_struct_embedding` construct id, so the
//     move is a LABEL move and nothing else.
//
//   INTERFACE half   `type I interface { J }`  -> `extends`
//     J contributes NO implementation (an interface has none), so `mixes_in`'s
//     "composes this mixin's IMPLEMENTATION" is FALSE of it; a declared
//     interface-superset relation is the fleet's interface-inheritance rule
//     (java interface extends interface, rust trait supertrait).
//
// BOTH HALVES ARE COUNTED, once per embedded type. The forbid rows pin the
// crossing: an `extends` edge for the struct half, or a `mixes_in` edge for the
// interface half, is the defect this fixture exists to catch.
package embeddinghalves

type Inner struct{ I int }

type Pair[X any, Y any] struct {
	First  X
	Second Y
}

type Holder struct {
	Inner
	*Pair[int, string]
	A int
}

type Reader interface{ Read(p []byte) (int, error) }

type Closer interface{ Close() error }

type ReadCloser interface {
	Reader
	Closer
}
