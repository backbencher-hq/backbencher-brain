package calleeown

// PINS THE OWNERSHIP BOUNDARY between the `calls` pass and the `uses` pass in
// `analyzeGoBareIdentifierUses`. A call's callee is owned by the CALLS pass and
// must NOT also publish a `uses` row — "one edge per pair", stated at the
// selector pass's own doc comment and enforced by `!isCallCallee(node)` in the
// identifier gate. This fixture exists because that boundary is invisible from
// the outside: a call callee that is ALSO a package-level function name produces
// a `calls` row and NO `uses` row, which reads exactly like a dropped read. The
// boundary is therefore pinned in BOTH directions so neither mistake can land:
// a future "fix" that duplicates the edge onto `uses` fails the forbidden rows,
// and a future change that drops the `calls` row fails the expected ones.

var Global int

var GlobalStruct Config

type Config struct {
	Field int
}

// Target is a package-level function whose name is also a valid value read.
func Target() int { return 1 }

// Bare reads a package var as a plain value. This is the `uses` pass's own
// surface and must keep emitting.
func BareRead() int {
	return Global
}

// CallCallee calls a package-level function. The callee `Target` is owned by
// the CALLS pass: a `calls` row at the call line, and NO `uses` row for it.
func CallCallee() int {
	return Target()
}

// SelectorReceiverRead reads a package var as a selector receiver. BOTH rows
// are correct here: the receiver `GlobalStruct` is a genuine value read owned by
// the `uses` pass, and the field `Field` is a field read. The receiver must
// emit even though a selector is involved — only a selector that is itself a
// call CALLEE is skipped.
func SelectorReceiverRead() int {
	return GlobalStruct.Field
}

// WriteGate assigns a package var and then reads it. The assignment LHS is a
// WRITE and must not emit; the read on the next line must.
func WriteGate() int {
	Global = 1
	return Global
}