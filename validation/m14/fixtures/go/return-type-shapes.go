// Fixture for the SHAPE of a function's result list in Go's grammar.
//
// Every row below is authored from tree-sitter-go 0.25.0's node-types.json and
// the Go specification's function-type rule, not from a run. The grammar says a
// function's `result` FIELD is either a single TYPE node or a
// `parameter_list`; the spec says Go writes one result without parentheses and
// two or more inside them. Both forms declare a dependency on the named types,
// so both are expected to publish a `references` edge with
// metadata.relationshipType `return_type`.
//
// The FORBID half pins the two things that must NOT appear: a predeclared type
// (`error`, `int`) is universe-scope and resolves to no declaration anywhere,
// and a named result (`func f() (n int)`) is a parameter_list, so it is the
// parenthesised shape's business and not this fixture's.

package retshape

import "io"

type Alpha struct{ N int }

type Beta struct{ A Alpha }

type Pair struct{ L, R Alpha }

// single result, written directly after the parameter list
func BareIdentifier() Alpha { return Alpha{} }

// single result behind a pointer
func BarePointer() *Alpha { return nil }

// single result behind a slice
func BareSlice() []Alpha { return nil }

// single result behind a map value
func BareMapValue() map[string]Alpha { return nil }

// single result behind a channel
func BareChannel() chan Alpha { return nil }

// single result behind a nested function type
func BareFuncValue() func() Alpha { return nil }

// single result, package-qualified
func BareQualified() io.Writer { return nil }

// two results, parenthesised
func ParenPair() (Alpha, error) { return Alpha{}, nil }

// two results, parenthesised, pointer first
func ParenPointerPair() (*Alpha, error) { return nil, nil }

// one NAMED result, parenthesised: a parameter_list, not a bare type
func ParenNamedResult() (a *Alpha) { return nil }

// method with a single bare result
func (b Beta) Method() Alpha { return b.A }

// method with a single bare pointer result
func (b Beta) PointerMethod() *Beta { return &b }

// predeclared-only results publish nothing
func OnlyError() error { return nil }

func OnlyInt() int { return 0 }

func OnlyString() string { return "" }