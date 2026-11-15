package gofixture

import (
	"fmt"
	"strings"
)

// Every type the analyzer publishes BELOW confidence 1.0 must carry a
// machine-readable reason code — docs/M14-HONESTY-CONTRACT.md section 4,
// requirement 1. Measured over go-stdlib at NFILES=200 before the reason-code
// table existed: 14,597 sub-1.0 rows carried no reasonCode and only
// `overrides` complied. This fixture constructs one edge of every sub-1.0
// (type, label) pair so a regression that drops the table fails here rather
// than shipping silently into the graph.

// --- mixes_in 0.8 / go_struct_embedding ------------------------------------
type Base struct{ Field int }

func (b Base) Describe() string { return "base" }

// --- extends 0.8 / go_interface_embedding ----------------------------------
type Readable interface{ Read() string }

type Doubler interface{ Readable }

// --- struct field of a declared type -> references 0.95 / declared_type ----
type Holder struct {
	Item   Base
	Reader Readable
}

// --- mixes_in 0.8 / go_struct_embedding ------------------------------------
// `struct { Base }` promotes Base's method set. There is no extends clause in
// Go, so the edge records a promotion the compiler resolves.
type Wrapper struct{ Base }

// --- return type -> references 0.95 / return_type -------------------------
// The result must be a NAMED result: an unnamed single result is a bare
// `type_identifier` in the result list, not a `parameter_declaration`, and the
// pass reads the list from the tree rather than inferring it from arity.
func Produce() (made Base) { return }

// --- instantiates 0.8 / go_composite_literal_construction ------------------
func Build() *Holder {
	return &Holder{Item: Base{Field: 1}, Reader: nil}
}

// --- instantiates 0.6 / go_instantiation -----------------------------------
// A PascalCase top-level FUNCTION call is read as a constructor. That is Go's
// naming convention with no declaration behind it, which is why the edge is
// 0.6 and not a fact.
func NewWidget(n int) *Holder { return &Holder{Item: Base{Field: n}} }

func MakeWidget() *Holder { return NewWidget(3) }

// --- instantiates 0.8 / go_package_scope_instantiation ---------------------
// The same PascalCase call, reached from a package-scope var initializer.
var packageBuilt = NewWidget(1)

// --- uses 0.7 / go_selector_use --------------------------------------------
func ReadField(h *Holder) int { return h.Item.Field }

// --- uses 0.8 / go_channel_operation ---------------------------------------
// The channel-op pass requires a MEMBER or a declared PACKAGE-SCOPE variable, so
// a channel parameter does not produce the edge — a package var does.
var Sink chan int

func Pump(v int) { Sink <- v }

func Drain() int { return <-Sink }

// --- calls 0.8 / go_function_call ------------------------------------------
func Describe(b Base) string { return fmt.Sprintf("%v/%d", b.Describe(), b.Field) }

func Join() string { return strings.Join([]string{"a"}, ",") }