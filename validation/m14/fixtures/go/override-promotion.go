// PINS the `overrides` RELATIONSHIP (ontology workstream 2026-10-02) for Go's
// method-promotion shadowing.
//
// GO HAS THE CONSTRUCT, and the analyzer was already computing it: when a struct
// embeds a type, the embedded type's methods are PROMOTED onto the outer type's
// method set, and a method the outer type declares itself REPLACES the promoted
// one for every selector `x.M` (Go spec, selectors — shallowest depth wins).
// `collectGoPromotedMethods` dropped the shadowed promoted method from the
// method set WITHOUT recording the displacement, so the graph said "Wrapper has
// no Report of its own" while the code says `w.Report()` selects Wrapper's.
//
// This is the same class of omission the ontology gate exists for: bash's
// `overrides` had a prose justification for a whole wave and was wrong.
//
// MEASURED: script/m14/tmp/go-ontology-census.ts probes B2/B3 on go-stdlib +
// cobra (same-file and same-package promotion). Counts in
// docs/analyzers/real-go-analyzer.md.
//
// The match is on the method NAME alone, which is Go's rule and not the
// family's: `Name` below hides `Shape.Name` despite a different signature,
// because `w.Name()` still selects Wrapper's. `sameSignature` records which of
// the two a given edge is.
package shadow

// Shape is the embedded base.
type Shape struct {
	w int
}

// Area is promoted onto Wrapper and NOT shadowed.
func (s *Shape) Area() int { return s.w }

// Report is promoted onto Wrapper AND shadowed by Wrapper's own Report.
func (s *Shape) Report() string { return "shape" }

// Name is promoted onto Wrapper and shadowed with a DIFFERENT signature, which
// Go permits: `w.Name()` still selects Wrapper's method.
func (s *Shape) Name(prefix string) string { return prefix + "shape" }

// Wrapper embeds Shape, so Shape's methods are promoted onto it.
type Wrapper struct {
	Shape
	extra int
}

// Report shadows the promoted Shape.Report (same signature).
func (w *Wrapper) Report() string { return "wrapper" }

// Name hides the promoted Shape.Name (different signature).
func (w *Wrapper) Name() string { return "wrapper" }

// Unrelated shadows nothing — Shape has no such method.
func (w *Wrapper) Unrelated() int { return w.extra + w.Area() }

// Level is a named non-struct type with a method: a receiver type with no
// `type` declaration in this file is still an implementor candidate, and its
// method must not be treated as shadowing anything.
type Level int

func (l Level) Report() int { return int(l) }

// Counter embeds nothing, so nothing is promoted onto it.
type Counter struct {
	n int
}

func (c *Counter) Report() string { return "counter" }