package p

// Implicit const type inheritance. In a const group, a spec with no type and no
// expression list repeats the PREVIOUS spec's type and expression list (Go spec:
// "Within a parenthesized const declaration list the empty expression list is
// equivalent to the textual substitution of the first preceding non-empty
// expression list and its type if present").
//
// So FormatUnknown, formatV7 and FormatUSTAR ALL have type Format. The first
// states it; the other two inherit it, and both inheritances are real type
// references the graph must carry.
type Format int

const (
	FormatUnknown Format = iota
	formatV7
	FormatUSTAR
)

// A second group proves the inheritance resets at the group boundary and does
// NOT leak across a different base type.
const (
	otherUnknown Other = iota
	otherA
	otherB
)

type Other string