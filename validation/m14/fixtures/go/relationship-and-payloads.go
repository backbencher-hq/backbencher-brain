// PINS go relationship kinds + #419-D evidence tiers + payloads (completeness
// sections B/C/D) the existing type-usage-graph fixture doesn't cover:
// contains (struct->member), extends (struct embedding), implements
// (interface method-set, duck typing), calls (declared + package-qualified +
// goroutine + defer + package-scope), instantiates (NewXxx constructor),
// uses (selector field access), references (declared_type / import dep),
// imports, complexity, and qualified_calls. See the expectation file.
package main

import (
	"example.com/internal/copy"
	"fmt"
	"time"
)

// Runner is satisfied implicitly (duck typing) by anything with a Run method —
// triggers the implements edge (go_interface_implementation).
type Runner interface {
	Run() string
}

// Shape: Run implements Runner; embedIn runs a NewShape() constructor call.
type Shape struct {
	base *time.Time
	area float64
}

// Run satisfies Runner (implements edge on Shape).
func (s *Shape) Run() string {
	return s.startWork()
}

func (s *Shape) startWork() string {
	// uses: selector field access (s.area); calls: fmt.Sprintf is a
	// package-qualified stdlib call (leaf target Sprintf); goroutine + defer
	// inside the constructor. The anonymous func-literal goroutine/defer have
	// NO static name — they must NOT emit calls targets (forbid pins).
	_ = s.base
	go s.startWork()
	defer s.startWork()
	go func() { _ = s }()
	defer func() { _ = s }()
	if s.area > 0 {
		s.area = float64(len(fmt.Sprintf("%.2f", s.area)))
	}
	return "ok"
}

// NewShape is a top-level PascalCase constructor — triggers Instantiates
// (go_instantiation) at its call site.
func NewShape() *Shape { return &Shape{area: 1} }

// Worker embeds *Shape (mixes_in edge, go_struct_embedding) and adds a field.
type Worker struct {
	*Shape
	name string
}

// ---- S1 write-gate pins (GOD4-class, M37 #604) ----
// Field WRITES must NOT emit uses (family write-gate that cpp/c/php/ruby/
// python/groovy/objc/ts all enforce; go was missing it — measured 5,202
// write-only (fn, field) uses edges across go-tools+terraform before the
// fix). writeOnly is never read: NO uses edge may exist for it.
// readOnly is genuinely read: its uses edge is pinned positive.
type Store struct {
	writeOnly string
	readOnly  string
}

// persist writes writeOnly (forbidden as uses) and reads readOnly (pinned).
func (st *Store) persist(v string) string {
	st.writeOnly = v          // pure write -> NO uses
	st.writeOnly += v         // compound LHS -> write -> NO uses
	return st.readOnly        // genuine read -> uses
}

// packageInit is a package-scope initializer that calls the NewShape
// constructor (package-scope call + instantiates).
var packageInit = NewShape()

// deepReviewClosure is an IMMEDIATELY-INVOKED package-scope closure
// (`var x = func(){...}()`). Because it RUNS at package init, the qualified
// stdlib call inside it (fmt.Sprintf) is a real top-level call and MUST be
// emitted with source = "global" (deep-review 2026-08-29 — package-scope
// IIFE bodies were silently dropped before, measured 12 MISSING on go-tools).
var deepReviewClosure = func() string {
	return fmt.Sprintf("%.2f", packageInit.area)
}()

// work runs a goroutine on the constructor result.
func work() error {
	var w = Worker{Shape: NewShape()}
	go w.Run()
	return nil
}

func main() {
	_ = packageInit
	_ = work
	_ = duplicate()
}

// GO13 (second review): a qualified call on a builtin-NAMED package
// (`copy.DeepCopyValue`, terraform/internal/copy idiom) is a real call —
// the builtin filter matches the callee LEAF, never the receiver.
func duplicate() string {
	return copy.DeepCopyValue("x")
}