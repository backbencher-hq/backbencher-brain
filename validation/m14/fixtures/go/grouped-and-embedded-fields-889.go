// #889: "a declaration that names N names declares N symbols".
//
// Every shape below is a STRUCT FIELD the Go language declares, and each was
// published wrong before this fixture: a grouped field declaration
// (`A, B int`) published only its FIRST name, an embedded field
// (`io.Reader`, `*Inner`, `Pair[X, Y]`) published NOTHING because the grammar
// gives it no `field_identifier`, and the blank padding field `_ int` was
// published as a symbol named `_` — which is not a declaration in any Go
// program (the same GO5 rule the var/const path already applied).
package groupedfields

type Inner struct {
	I int
}

// Pair is generic so the embedded `Pair[X, Y]` case is exercised too.
type Pair[X any, Y any] struct {
	First  X
	Second Y
}

type Holder struct {
	A, B, C int          // grouped: three fields, one declaration
	F       string       // ordinary single field
	_       bool         // blank padding: NOT a field, NOT a symbol
	Inner                // embedded value type  -> field named Inner
	*Pair[int, string]   // embedded pointer to a generic instantiation -> Pair
	pkg unexported       // ordinary field with an unexported type name
}

type unexported struct{ U int }

func (h *Holder) Touch() int {
	return h.A + h.B + h.C
}
