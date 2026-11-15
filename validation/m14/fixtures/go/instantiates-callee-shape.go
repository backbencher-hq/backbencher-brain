// Fixture for the CALLEE SHAPE the `instantiates` edge requires.
//
// The lane's stated rule is "PascalCase top-level FUNCTION calls only; methods
// and unresolved stdlib leaves never instantiate". The implementation matched the
// callee's LEAF against the file's symbol table by NAME, so the rule was not
// enforced: a file that declares its own `NewReader` turned `bufio.NewReader(r)`
// into a construction of its own `NewReader`. Measured over a 500-file stride
// sample of go-stdlib (validation/m14/go/go-mislabel-probe.ts): 155 `instantiates`
// edges at confidence 0.6, 8 of them (6 files) labelled a receiver or
// compound-operand selector as a constructor.
//
// The discriminator is the selector's OPERAND, read from the grammar
// (`selector_expression` has `operand` and `field` fields):
//
//   operand is a package name or import alias  -> a package's top-level function
//   operand is anything else                   -> a method on a receiver
//
// The file's OWN package name counts as a qualifier. `src/html/template/
// escape.go:977` is `func HTMLEscape(...) { template.HTMLEscape(w, b) }` — a
// self-qualified call that does select the top-level function, and the first
// version of the falsifier reported it as a defect because it only knew about
// import aliases.

package calleeshape

import (
	"bufio"
	"bytes"
	"fmt"
	"strconv"
	"strings"
)

// Top-level functions that a package-qualified call may legitimately select.
func NewReader(r int) string { return strconv.Itoa(r) }

func Store(n int) error { return nil }

func Sign(k string) error { return nil }

func Open(dsn string) error { return nil }

// EXPECTED: the bare top-level call. Same package, no selector at all.
func Direct() string {
	return NewReader(1)
}

// EXPECTED: a package-qualified call to a top-level function of ANOTHER
// package. `strconv.Itoa` is top-level in strconv.
func Qualified() string {
	return strconv.Itoa(2)
}

// EXPECTED: the own package name used as a qualifier. Legal Go and a real
// top-level call, and the case the alias-only discriminator got wrong.
func SelfQualified() string {
	return calleeshape.NewReader(3)
}

// FORBIDDEN: `bufio.NewReader` is a top-level function in bufio, and this file
// declares its own `NewReader`. Matching by leaf names turns the first into the
// second.
func ReceiverCollision() *bufio.Reader {
	return bufio.NewReader(strings.NewReader("x"))
}

// FORBIDDEN: `err.Error()` is a method on the error interface. A file that also
// declares `func Error()` is the collision this shape exists to reject; the
// receiver here is a named variable so the discriminator cannot be satisfied by
// accident.
func MethodDispatch(err error) string {
	return err.Error()
}

// FORBIDDEN: a compound operand. `t.driver.Open` dispatches through a field; the
// leaf `Open` matches this file's top-level `Open` and must not instantiate it.
type holder struct{ driver interface{ Open(string) error } }

func CompoundOperand(h holder) error {
	return h.driver.Open("dsn")
}

// FORBIDDEN: a selector on a package-scoped variable of function type.
var storeFn = func() error { return nil }

func ViaFuncField() error {
	return storeFn()
}
// FORBIDDEN: the SAME collision at PACKAGE SCOPE. This is the second
// instantiation push site, and it carries the same name-only test, so a fixture
// that only covered the in-function one leaves it unpinned — which is what the
// first run of the lane's own mutation check reported: 5 of 6 mutants killed,
// this one SURVIVED.
var pkgScopedCollision = bufio.NewReader(strings.NewReader("y"))

// EXPECTED: a package-scope call to this file's own top-level function.
var pkgScopedOwn = NewReader(4)

// EXPECTED: a package-scope self-qualified call.
var pkgScopedSelf = calleeshape.NewReader(5)

// A SECOND collision name, used only by the package-scope site. The
// `pkgScopedOwn` and `pkgScopedSelf` rows above both publish
// `global -> NewReader`, and the package-scope site's dedupe key is
// `inst:<leaf>` — so with a name that has a legitimate producer, removing the
// guard still yields the same edge and the mutant SURVIVES. That is what the
// lane's own mutation check reported on its first run: 5 of 6 killed, the
// package-scope one alive. `NewBuffer` has exactly one producer and it is the
// receiver that should not instantiate it.
func NewBuffer(n int) []byte { return make([]byte, n) }

var pkgScopedBufferCollision = bytes.NewBuffer(make([]byte, 1))
