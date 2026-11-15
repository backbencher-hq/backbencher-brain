package exportfixture

// GO ONTOLOGY (relationship-type workstream) — the `exports` EDGE contract for
// the go lane.
//
// The `exports` ARRAY (what this package makes available) has been published
// for this lane since the M14 wave. The EDGE was not, so `bb_graph` could not
// answer "what does this module export?" — the question the relationship
// exists for, and the question the F3 export-uniqueness invariant is written
// about.
//
// THE RULE, from the Go specification rather than from a run: an identifier is
// EXPORTED iff the first character of its name is an upper-case Unicode
// letter. No node type says "exported" — this is a CONVENTION, which is why
// only a parse-tree count could decide whether the construct exists at all.
//
// THE SCOPE, pinned by the FORBID half below rather than left to a comment:
// membership in this lane rides `contains`, and the M49 JVM-closure F3
// invariant requires export names to be unique and top-level-resolvable. Go
// DOES export a capitalized package-level `var` and a capitalized method, and
// neither is carried by this edge:
//
//   - a package-scope VARIABLE: a struct and a `var` can share a name in Go
//     (`type Foo struct{}; var Foo = ...` is legal), so a name-keyed export
//     slot cannot hold both without violating F3. `ErrNoWidget` below is the
//     case, and it is FORBIDDEN here rather than quietly absent.
//   - a METHOD: `T.Read` is a member of T, reachable as `x.Read`, not as
//     `pkg.Read`; two types may each declare `Read`, which is the same
//     duplication F3 exists to catch.
//
// Everything below is VALID, COMPILABLE Go, so no other pin in this file is
// resting on a tree the compiler would reject.

// Exported type (struct) — a top-level unit, so it carries the edge. The
// exported field is `Label`, not `Name`: a Go type may not carry a field and a
// method of the same name, and this file must compile so that every other pin
// in it is trustworthy.
type Widget struct {
	// An exported STRUCT FIELD is a member: it rides `contains`, not `exports`.
	Label string
	// An unexported field likewise.
	secret int
}

// Unexported type — no edge under any reading of the rule.
type widgetImpl struct {
	id int
}

// Exported named non-struct type.
type Counter int

// Exported type ALIAS.
type WidgetList = []*Widget

// Exported interface. `hidden()` is UNEXPORTED, and an unexported interface
// method is still part of the interface: only a type in the SAME package can
// satisfy it. So `Namer` is deliberately unsatisfiable by Widget below, which
// pins the rule rather than the accident (this fixture's first draft assumed
// the opposite and the analyzer was right).
type Namer interface {
	// An interface METHOD is a member of the interface: `contains`, not `exports`.
	Name() string
	// Unexported interface method.
	hidden()
}

// Exported interface with one exported method, which Widget DOES satisfy — the
// live control that the export list and the interface pass still agree after
// the new edge was added.
type Sizer interface {
	Size() int
}

// Exported function.
func NewWidget() *Widget { return &Widget{} }

// Unexported function.
func newWidgetImpl() *widgetImpl { return &widgetImpl{} }

// Exported package-scope CONSTANT. A constant is not a `Variable`, so it is in
// the export array and the edge carries it — the `var` below is the contrast.
const Version = "1.0"

// Unexported constant.
const version = "0.0"

// Exported package-scope VARIABLE. Go exports it; this edge deliberately does
// not carry it (see the scope note above), and that decision is FORBIDDEN here
// so it stays a decision and cannot rot into an accident.
var ErrNoWidget = newWidgetImpl()

// Unexported package-scope variable.
var errInternal = newWidgetImpl()

// Methods: exported and not. Both are members of their receiver type, so both
// are forbidden as `exports` targets. `Name` deliberately collides with the
// interface method and the struct field of the same name, so one forbidden row
// pins all three member surfaces.
func (w *Widget) Name() string { return w.Name2() }

func (w *Widget) Name2() string { return w.Label }

func (w *Widget) Size() int { return len(w.Label) }

func (w *Widget) secret2() int { return w.secret }

func (i widgetImpl) Name() string { return i.name() }

func (i widgetImpl) name() string { return "" }
