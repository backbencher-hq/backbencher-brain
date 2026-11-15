// The RECOVERY-DESCENT pin (#799 round) — a call inside a region the grammar
// could not parse is still a call, and a call nested under an UNNAMEABLE callee
// is still a call.
//
// Two LEGAL constructs are involved, both of which the pinned tree-sitter-go
// errors on: `var _ = Backward[[]int]` (Go 1.21+: a generic function
// instantiated as a VALUE) and `Backward[[]int](nil)` (a generic function
// instantiated and called, whose callee is an index_expression, not a
// selector/identifier). Error recovery wraps everything after the first one in
// composite-literal debris, and the package-scope walk used to abandon any
// call_expression whose callee it could not name — so `s[i].Lock()` inside the
// recovered `usesMutex` body was never reached, while `s[i].String()` twelve
// lines later in the same real-world file (go-tools
// go/analysis/passes/modernize/testdata/src/slicesbackward/slicesbackward.go)
// was: the difference was recovery luck, not source.
package errordescend

import "sync"

func Backward[Slice ~[]E, E any](s Slice) Slice { return s }

func tail(s []int) int { return len(s) }

// A generic function instantiated and called as a value: the callee is an
// index_expression, so no static leaf names it — but `tail` inside it is a real
// call the lane must publish.
var _ = Backward[[]int](tail(nil))

// The recovery spike starts here: everything below is parse-recovery debris.
var _ = Backward[[]int]

// Real code inside the recovered region. Both calls below are selector callees
// the lane published before the round only when recovery happened to leave them
// outside a debris call_expression.
func usesMutex(s []sync.Mutex) {
	for i := len(s) - 1; i >= 0; i-- {
		s[i].Lock()
		s[i].Unlock()
	}
}

// A second recovered body, so the pin does not rest on one recovery shape.
func usesMutexOnce(m *sync.Mutex) {
	m.Lock()
	m.Unlock()
}
