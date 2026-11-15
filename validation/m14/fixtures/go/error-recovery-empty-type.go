package recoveryfixture

// GO ONTOLOGY (relationship-type workstream) — the empty-endpoint guard on the
// declared-type collector.
//
// This is the corpus shape verbatim: `src/cmd/compile/internal/syntax/testdata/
// tparams.go` carries generic declarations annotated with the errors the Go
// compiler's own test suite expects, and one of them is an EMPTY type-parameter
// list. The pinned grammar types that hole as a `type_identifier` whose `text`
// is the empty string, and the declared-type walk collected it like any other
// type name and published `references f -> ""`.
//
// THE FILE DOES NOT COMPILE, and that is the point: it is a grammar-recovery
// fixture, not a Go program. It is a file of its own rather than a block inside
// a shared fixture precisely so it cannot weaken the pins in the compilable
// ones — the lane's own convention (see round5-surfaces, which moved its two
// recovery shapes into a probe for the same reason).
//
// The EXPECT rows are what stop the guard from being over-applied: `Recovered`
// and `WithMethods` carry the SAME damaged type-parameter list, and their type
// references must still be published. A guard that dropped the whole list
// instead of the empty name would fail here.

type Recovered[a, b /* ERROR missing type constraint */ ] struct{}

// `type WithMethods` uses the field's own type, and the damaged list above it
// must not swallow it.
type WithMethods struct {
	Field Recovered[int, string]
}

// `func Generic[ /* ERROR empty type parameter list */ ]()` is the shape that
// produced the empty target: the list exists, its only child does not.
func Generic[ /* ERROR empty type parameter list */ ]() {}

func Uses(v WithMethods) Recovered[int, string] { return v.Field }
