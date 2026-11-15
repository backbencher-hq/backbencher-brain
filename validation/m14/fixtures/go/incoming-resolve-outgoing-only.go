// INCOMING / RESOLUTION — the OUTGOING-ONLY contract, pinned as a fixture.
//
// WHY THIS FILE EXISTS. Every edge this analyzer emits is outgoing from the file
// being analysed. "Who points AT me" is therefore not a second edge channel: it
// is a question asked of the target surface, over the rows that already exist.
// The `brain_relationship` table has 16 columns and NO inbound table; a row is
// one fact read in two directions, and `src/lsp/impact.ts:530` and
// `src/intelligence/graph/graph-engine.ts:684` both answer "who points at me"
// with a WHERE clause on `r.target_symbol_id`.
//
// That contract is worth a fixture because the tempting "improvement" is to
// emit the reverse edge as well. Doing so would DOUBLE the graph, and every
// reversed row would be a fabricated relationship: `calls Describe -> Helper`
// read backwards is not a call, it is a caller. A fabricated edge is counted as
// `unexplained` by the differential and poisons bb_graph, bb_impact and
// bb_migrate — a fake caller becomes wrong refactoring advice. So the FORBID
// half below is the contract, and `go-incoming-reverse-edge-added` in
// `validation/m14/go/go-incoming-mutants.ts` is the mutant that has to die.
//
// ONE NAME PER RESOLUTION CLASS, chosen so a reader can see why the four-class
// census in `go-incoming-resolve.ts` reports what it reports:
//
//   Describe       declared at package scope AND as a method on two types, so
//                  the bare string `Describe` binds to THREE declarations. That
//                  is Go, not a defect: it is the AMBIGUOUS class, and it is the
//                  surface on which the leaf reduction (`strings.ToUpper` ->
//                  `ToUpper`) loses the information that would disambiguate.
//   Label          a struct field: it binds inside Wrapper's namespace and at
//                  no package scope, so a target `Label` is resolved only
//                  THROUGH its owner. That is the VIA-OWNER class.
//   Wrapper.Describe / Base.Describe   the analyzer writes method endpoints
//                  already qualified, so the resolution genuinely goes through
//                  the owner and the anchor is unambiguous.
//   Writer         an interface from another package: it is a declaration the
//                  corpus does not contain, which is the UNRESOLVABLE class and
//                  is EXPECTED here (go-stdlib vendors nothing).
package incomingresolve

import "strings"

// Base is embedded, so its methods are promoted into Wrapper and then displaced
// by Wrapper's own depth-0 declaration of the same name.
type Base struct {
	Payload string
}

func (b *Base) Describe() string {
	return b.Payload
}

// Wrapper declares Describe at depth 0: `x.Describe` selects Wrapper's, and the
// promoted Base.Describe is what the `overrides` edge names.
type Wrapper struct {
	Base
	Label string
}

func (w *Wrapper) Describe() string {
	return w.Label
}

// Describe is a package-scope function whose name is ALSO a method name on two
// types above. Go permits this; the reverse direction cannot pick an anchor from
// the bare string alone.
func Describe(v string) string {
	return strings.ToUpper(v)
}

// Writer is deliberately declared in the fixture text but NOT defined: the
// analyzer sees the type reference, the corpus has no such declaration, and
// that is the unresolvable case measured rather than assumed.
type Writer interface {
	Write(p []byte) (n int, err error)
}

// Printer is a struct with a field whose name is also a method name elsewhere,
// and a package-scope constructor, so all three ownership shapes are in one file.
type Printer struct {
	Writer
	Label  string
	buffer []byte
}

func NewPrinter() *Printer {
	return &Printer{}
}

func (p *Printer) Describe() string {
	return Describe(p.Label)
}

func (p *Printer) Describe2() {
	p.Label = Describe2(p.Label)
}

func Describe2(s string) string {
	return s + "!"
}

// Sink satisfies Writer by its OWN declaration rather than by embedding it, so
// `implements` fires and the reverse-direction forbid has a row of its own to
// sit on. Go's satisfaction is implicit, so there is no `implements` keyword
// anywhere in the file: the edge is the whole of the relationship.
type Sink struct {
	Label string
}

func (s *Sink) Write(p []byte) (n int, err error) {
	s.Label = string(p)
	return len(p), nil
}
