// go/cross-file-value-read — A FUNCTION VALUE FROM A SIBLING FILE IS A READ.
//
// GO1's bare-identifier pass emitted a `uses` row ONLY when the read named a value
// declared in THIS file (`fileValues`, gate at `analyzeGoBareIdentifierUses`). A
// package-scope function/var/const declared in a SIBLING file of the same package —
// which in Go is routine, not an edge case — was therefore dropped entirely: no row
// of any kind, at any confidence.
//
// PROVEN on bettercap `session/`: `plugin.Defines["onEvent"] = jsOnEventFunc` at
// session/session.go:336 names `jsOnEventFunc`, declared at
// session/script_builtin_runtime.go:39. The store has ZERO relationship rows that
// name that function (any type), so `bb_patterns scope=orphaned` reports it dead at
// 70% and `bb_graph`/`bb_impact` see no reference. All 8 registered callbacks are in
// the same state (ISSUE-04).
//
// THE SHAPE OF THE FIX (and why this fixture has no sibling file): the analyzer is a
// PER-FILE entry point — `analyze(rootNode, content, filePath)` has no package
// context — so it cannot verify that a sibling file declares the name. The honest
// row is therefore the documented LEAF: target = the name alone, confidence 0.6,
// metadata.relationshipType "identifier_usage", and the existing reason code
// `used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope`. The
// store may bind the name later; the analyzer's job is to stop DISCARDING the read.
//
// THE TWO HALVES THIS PINS. A bare read is published when it is NOT locally bound
// and NOT same-file-declared; it stays SILENT when it is locally bound (locals,
// params, range vars) or predeclared (nil/true/false/len). Emitting everything would
// fabricate reads for every local; emitting only same-file names is the bug.
package crossfilevalueread

import (
	"errors"
	"testing"
)

// `Registry` and `packageCallback` are declared in SIBLING files of this package
// (deliberately absent here, exactly like the shipped cross-file-call-visibility
// fixture). Both reads must publish.
func setup() {
	Registry["onEvent"] = packageCallback
}

// SAME-FILE CONTROL: a package-scope var declared in THIS file keeps the existing
// same-file behaviour (the row binds in the store).
var fileLocal = func() {}

func sameFileNameRead() {
	_ = fileLocal
}

// OVER-REACH CONTROLS: every identifier below is locally bound or predeclared.
// Emitting any of them would be the naive "publish every unresolved bare name" fix.
func overreach(param int, fn func()) {
	local := 1
	arr := []int{1}
	for _, v := range arr {
		_ = v + local + param
	}
	fn()
	_ = nil
}

var predeclaredValues = []any{nil, true, false, len}

// NON-LOCAL-CALL CONTROLS (shared with the calls surface): `errors.New` and
// `t.Error` are qualifier calls, NEVER local calls and never reads of the qualifier.
// `errors` is an import binding and `t` is a parameter, so neither may appear as a
// cross-file value read; the call edges belong to the calls pass.
func nonLocalCalls(t *testing.T) {
	t.Error(errors.New("x"))
}

// FUNCTION-TYPE PARAMETER NAMES ARE DECLARATIONS, NOT READS. A package-scope type has
// no function frame, so the parameter binder never runs over its `func(...)` type; the
// cross-file branch must therefore skip NAME positions itself or it fabricates reads of
// `args`/`s`/`format` (measured on bettercap session/command_handler.go:16
// `exec func(args []string, s *Session) error` and session/events.go:42). The ARRAY
// LENGTH case is the other side: `[N]int` in a parameter type IS a read and stays.
const FuncTypeArrayLen = 4

type execFunc func(args []string, s int) error

type printer interface {
	Print(format string, args ...interface{}) error
}

func funcTypeShapes(a [FuncTypeArrayLen]int) int {
	return FuncTypeArrayLen
}
