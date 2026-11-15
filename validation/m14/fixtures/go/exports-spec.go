// PINS the `exports` RELATIONSHIP (ontology workstream 2026-10-02): the Go
// spec's "Exported identifiers" rule — an identifier is exported iff the first
// character of its name is an upper-case Unicode letter — as an EDGE from the
// package symbol to each exported top-level name.
//
// Before this fixture the lane published the EXPORT LIST (`exports: ExportInfo[]`,
// read by the F3 export-uniqueness invariant) and no export EDGE, so the graph
// could not answer "what does this package make available to importers?".
//
// The negatives are as load-bearing as the positives: an unexported name, a
// struct FIELD, an INTERFACE METHOD and a METHOD are all things the Go spec
// classifies as exported but that this lane deliberately does NOT publish as a
// package-scope `exports` edge (membership rides `contains`, per the JVM-closure
// F3 invariant). A future change that widens the surface must widen the forbids
// consciously rather than by accident.
package exports

// Limit is an exported package-scope CONST. Go exports it; so does this lane.
const Limit = 10

// Mode selects a behaviour. Exported TYPE.
type Mode int

// Handler is an exported INTERFACE; its methods are members, not units.
type Handler interface {
	// Handle is a member — membership rides contains, not exports.
	Handle(s string) error
}

// Engine is an exported STRUCT with an exported field (a member) and an
// unexported one.
type Engine struct {
	// Name is a member of Engine, NOT a package-scope unit.
	Name string
	size int
}

// NewEngine is an exported package-scope FUNCTION.
func NewEngine(name string) *Engine {
	return &Engine{Name: name, size: len(name)}
}

// Start is a METHOD — a member of Engine.
func (e *Engine) Start() error {
	if len(e.Name) > Limit {
		return nil
	}
	return nil
}

// modeTable and helper are unexported: lower-case first character, so no edge.
var modeTable = map[Mode]int{0: Limit}

func helper() int { return modeTable[0] }

// exportedVar is a package-scope VAR. Go exports it (`exports.DefaultMode` is
// readable from another package). This lane's export predicate drops VARIABLES —
// the M49 JVM-closure F3 invariant scopes the export list to top-level UNITS.
// NOT pinned in either direction below: it is a declared limitation, recorded
// with its measured count in docs/analyzers/real-go-analyzer.md, and pinning it
// would make a later, deliberate widening of the surface look like a regression.
var exportedVar = Limit

// localUnit is CAPITALIZED and is a SYMBOL (GO38: a function-local type is an
// object/field declaration, which the family's LocalsAreNotSymbols contract
// exempts, because the declared-type pass attributes that type's field types to
// it and omitting the symbol would publish a `references` edge whose source
// names nothing). It is still NOT PACKAGE SCOPE: Go gives a name declared
// inside a function body no reach beyond that body, so nothing outside can bind
// to it and the spec does not export it.
//
// This is the case that made the first version of the edge wrong. The edge read
// the export ARRAY, whose predicate is `!ownerName`, and a function-local type
// carries no ownerName — so the lane published
//
//	exports exports -> localUnit
//
// carrying `exportForm: "capitalized_package_scope_name"`, a claim contradicted
// by the very edge making it. Found by an independent oracle over
// cobra/completions_test.go, where two such edges were live
// (`UserCompletionTypeHelper`, `UserCompletionTypeAliasHelper`).
func scopeBoundary() {
	type localUnit struct{ n int }
	var v localUnit
	_ = v
}