//go:build round5
// +build round5

// GO26 (round 5) — the pin source for the behavioural classes the round-5
// line-by-line read found in the declared-type, export, range, embedding and
// framework surfaces.
//
// The header is load-bearing, not decoration: the Module symbol's range used to
// be hand-built from the package NAME's length at line 1 / byte 0, so a
// `//go:build` header — which 158 of the two pinned corpora's 3,924 files and
// 2,462 of kubernetes's 17,848 carry — is the only shape that can see it.
//
// Everything here is VALID, COMPILABLE Go. The two classes that are only
// reachable on a tree the compiler would reject (a bare call to a name that
// exists only as an interface method; a type declared twice) are pinned by
// `F9-PROBE-GO-BARE-CALLABLE-SET` instead, because a fixture that does not
// compile would make every other pin in this file untrustworthy.

package roundfive

import (
	"fmt"
	"gorm.io/gorm"
	"net/http"
)

// ---- C6 (export rule). Go's spec makes `exported` a UNICODE upper-case test,
// not an ASCII range. `Ünï` / `Ö` / `Ä` are legal Go identifiers and were
// published `private`, which failed the export predicate and removed them from
// the public-API list the product serves.
type Ünï struct{ Ä int }

func Ö() {}

// ---- C5 (predeclared set). `comparable` is the third predeclared identifier
// that appears in ordinary type position, and it was missing from the
// declared-type exclusion set — so the generic constraint below published a
// dangling `Pair -> comparable` target. `any` was in the set, which is the tell.
type Pair[K comparable, V any] struct {
	Key   K
	Value V
}

// RULED CORRECT, pinned as a control: a predeclared interface embedded in an
// interface body is real composition, exactly like `io.Closer` — `comparable` is
// Go's third predeclared interface type.
type Embedded interface {
	comparable
}

// ---- C3 (parameter vs result). An unnamed PARAMETER and an unnamed RESULT are
// both one-named-child `parameter_declaration` nodes, so the arity heuristic
// labelled every unnamed parameter `return_type`.
type Server struct{ N int }

func takesUnnamed(*Server, Server) {}

func returnsUnnamed() (*Server, error) { return nil, nil }

func namedParam(s *Server) {}

// ---- C15 (var/const ranges). A grouped, multi-line declaration names N
// symbols at N positions, and each must report its OWN name node — the #919
// rule the struct-field path already applied.
var alpha,
	Beta int

const (
	Gone   = 1
	AlsoGo = 2
)

// ---- C19 (alias-to-struct embedding). `type A = struct{ *Inner }` is legal
// Go; the member symbol was published and the `mixes_in` edge was not, because
// the embedding pass read `type_spec` only — as did the F5 oracle, so the two
// agreed on the omission and no differential could charge it.
type Inner struct{ Q int }

// Five more methods on ONE struct, so this file's method:struct ratio lands
// inside the [1,5] band `calculateArchitecturalScore` rewards. That is what
// makes `architecturalScore` a live pin of the GO26 struct-kind fix: the
// predicate read `SymbolKind.Class`, which the go analyzer never emits, so the
// ratio was computed over an always-empty struct list and the bonus could
// never be granted. With the ratio in band, the score moves by exactly the
// bonus when the predicate reverts.
func (i *Inner) One() int { return i.Q }
func (i *Inner) Two() int { return i.Q }
func (i *Inner) Three() int {
	return i.Q
}
func (i *Inner) Four() int  { return i.Q }
func (i *Inner) Five() int  { return i.Q }

// A second type, so the named field below derives an edge the EMBEDDED field
// cannot: the lane's per-set convention (GO32) collapses `Alias -> Inner` from
// two fields into one, so pinning the source needs a target with no other
// writer.
type Holder struct{ R int }

// The `architecturalScore` pin (GO26b) is only live while this file's
// method:struct ratio sits inside the [1,5] band `calculateArchitecturalScore`
// rewards. Adding `Holder` for GO36 pushed the ratio to 0.889 and the pin went
// BLIND — which the `go/struct-kind-class-vacuous` mutant reported as a SURVIVOR
// the moment it happened. That is the tripwire working, and the lesson is
// recorded in the expectation file: a payload pin whose liveness depends on a
// ratio is a fragile pin, and the mutant is what makes the fragility
// detectable rather than silent. Two methods here put the ratio at ~1.11, with
// margin on both sides of the lower edge.
func (h *Holder) Wrapped() R2 { return h.R }

type R2 struct{ V int }

func (h *Holder) Tagged() R2 { return R2{V: h.R} }

type Alias = struct {
	*Inner
	// NAMED fields, so the case does not depend on the embedded-field shape: both
	// go through resolveSource, and GO36 was in the RESOLVER, not in either kind
	// of field.
	Wrapped Inner
	Boxed   Holder
}

// ---- Control for the implements rule: an ordinary implicit implementation
// must still be published, and the promoted-method hoist must not have changed
// which pairs are found.
type Cyclic interface {
	Loop() int
}

type Loader struct{ Q int }

func (l *Loader) Loop() int { return l.Q }

type Base struct{ B int }

func (b *Base) Shared() {}

type Derived struct{ *Base }

func UsesLoader() {
	var _ Cyclic = &Loader{}
	var _ interface{ Shared() } = &Derived{}
}

// ---- GO26 (framework vocabulary + struct insight). The file-level detector
// and the per-import detector were two independently written vocabularies:
// `gorm` was in one and could never be pushed into the other, so
// `getGoFrameworkPatterns`'s `case "gorm"` was unreachable. The struct-design
// architectural insight and the struct-design score bonus were unreachable for
// the same reason — their predicate named `SymbolKind.Class`, which the go
// analyzer has never emitted (Go's struct is `SymbolKind.Struct`).
func OpenDB() *gorm.DB {
	return gorm.Open(nil)
}

func Serve() {
	resp, _ := http.Get("http://x")
	_ = resp
	_ = fmt.Sprint(1)
	_ = Ünï{}
	_ = Ö()
	_ = Alias{}
	_ = Alpha
	_ = Beta
}
