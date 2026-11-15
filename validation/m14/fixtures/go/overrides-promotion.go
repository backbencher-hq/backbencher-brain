package shadowfixture

// GO ONTOLOGY (relationship-type workstream) — the `overrides` contract for the
// go lane.
//
// Go has no `override` keyword. It has the SEMANTIC: a method declared on the
// outer type at depth 0 replaces the promoted method of the same name for every
// selector `x.M` (Go specification, selectors: the shallowest depth wins). The
// lane already modelled half of this — the embedding itself is a `mixes_in`
// edge — and the analyzer already COMPUTED the shadowing inside its promotion
// collector and discarded it, dropping the promoted method from the method set
// without recording that it had been displaced.
//
// This file is the pin for the second half, and each block is one shape a
// derivation can plausibly get wrong:
//
//	Sub      depth-1 shadow, SAME signature — the substitutable override every
//	         other language's `overrides` means, and the only one a
//	         signature-matching rule would report.
//	Sub.Close   depth-1 shadow, DIFFERENT signature (`error` vs no result).
//	         Legal in Go: the outer method HIDES the promoted one, `x.Close`
//	         still selects the outer, and a rule that demanded matching
//	         signatures would miss it.
//	Mid      depth-2 promotion. `Read` reaches `Sub.Read` at depth 1 and
//	         `Base.Read` at depth 2, and Mid's own declaration shadows BOTH.
//	Diamond  two embedding paths to ONE promoted method. `Base.Read` sits at
//	         depth 2 by both paths, which is a single method at the shallowest
//	         depth — legal, unambiguous, and ONE edge. `Left.Read` and
//	         `Right.Read` name methods that exist nowhere, so they are pinned
//	         FORBIDDEN: they are the fabrication this shape invites.
//	Only     promoted and never shadowed: the control that the pass does not
//	         invent an edge for every promoted method.
//
// Everything here is VALID, COMPILABLE Go.

// Base declares the method set that promotion carries.
type Base struct{ n int }

func (b *Base) Read(p []byte) (int, error) { return 0, nil }

func (b Base) Close() error { return nil }

// Only is promoted onto Sub, Mid and Diamond and shadowed by none of them.
func (b *Base) Only() string { return "" }

// Sub embeds Base and redeclares two of its three methods.
type Sub struct {
	Base
}

func (s *Sub) Read(p []byte) (int, error) { return 0, nil }

// Close HIDES `Base.Close` rather than overriding it: the result list is empty
// where the promoted one returns `error`. Legal Go — the two declarations are
// on different types — and `x.Close` selects this one.
func (s *Sub) Close() {}

// Mid embeds Sub, so the promoted set is one level deeper.
type Mid struct {
	Sub
}

func (m *Mid) Read(p []byte) (int, error) { return 0, nil }

// Left and Right each embed Base, which makes the promoted `Read` ambiguous on
// Diamond — and a declaration on Diamond resolves that ambiguity by shadowing
// both paths.
type Left struct{ Base }

type Right struct{ Base }

type Diamond struct {
	Left
	Right
}

func (d *Diamond) Read(p []byte) (int, error) { return 0, nil }

// Embeds carries an embedded type with no methods at all, so nothing can be
// promoted and nothing can be shadowed. The control for the empty closure.
type Embeds struct {
	Base
	Left
}
