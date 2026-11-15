// GO38 — a type declared INSIDE A FUNCTION BODY is a symbol.
//
// LocalsAreNotSymbols (C# M12.07 / Swift M12.21) excludes a function-local
// var/const. The family's own exception is nim's, stated in its analyzer header:
// "THE ONE EXCEPTION IS AN OBJECT/ENUM/FIELD DECLARATION, WHICH IS A SYMBOL
// BECAUSE THE OBJECT OWNS IT." A local type owns its fields, so the fields are
// members and the type is a declaration.
//
// The pre-fix walk `continue`d on every function and method, so it never
// reached a local type at all. That was not a neutral silence: the declared-type
// pass already walks bodies and already attributed a local type's field types to
// that type, so the lane published `references Local -> Host` where `Local` was
// absent from its own symbol table — a relationship whose SOURCE named nothing.
// Found by the round-6 `contains` truth, which derives membership from the
// DECLARATION side of the tree and therefore sees an unpublished type as a
// MISSING row instead of being invisible on both sides (22 such memberships in
// 200 go-tools files).
//
// Everything here is valid, compilable Go.

package localtype

// A PACKAGE-SCOPE control: this worked before the fix and must keep working.
type Host struct {
	Z int
}

func packageScope() {
	// A function-local type, with a NAMED field of a package-scope type and a
	// predeclared one (so the declared-type pass has something to name).
	type Local struct {
		H Host
		N int
	}

	// A second local type, nested inside a FUNC LITERAL — the shape where the
	// walk's `inFunction` flag has to be set by the function node itself rather
	// than by a `block`, or a body the grammar shaped differently would leak.
	h := func() {
		type Nested struct {
			Q Host
		}
		_ = Nested{}
	}
	_ = h

	// A local type in a ONE-STATEMENT body, and in a body that is a bare
	// `if`/`for` init — the non-block shapes.
	if true {
		type InIf struct{ A Host }
		_ = InIf{}
	}
	for i := 0; i < 1; i++ {
		type InFor struct{ B Host }
		_ = InFor{}
	}

	_ = Local{}
}

// The NEGATIVE half: a function-local VAR and CONST must stay out of the symbol
// set. LocalsAreNotSymbols is the other half of the same contract, and the
// round-5 removal of the dead `parentStruct` plumbing is not what keeps them
// out — this `inFunction` gate is.
func localsStayLocal() {
	var localVar int
	const localConst = 1
	type RealType struct{ R Host }
	var alsoReal RealType
	_ = localVar
	_ = localConst
	_ = alsoReal
}
