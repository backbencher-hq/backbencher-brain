// fixture: go/callsite-lines-825 — M59 (#825).
// A relationship's line_number is the line of the node that NAMES it, never the
// line of the construct that contains it. Go emitted NO line at all before this
// pin (0 of 11,893 edges on a 200-file draw of go-tools), so the pre-fix state is
// "unlined". Every trap below is valid Go, each is the site of a REAL edge, and
// each is a place where a construct-start line is a line too early:
//
//   1. a GROUPED import: `import (` starts on its own line, the spec path on the
//      next — the edge belongs to the spec;
//   2. a RECEIVER-CONTINUED selector call: `.` does not insert a semicolon, so
//      `s.` + newline + `Reset()` parses, and a `selector_expression` starts at
//      its RECEIVER — the edge belongs to the leaf (the c lane's shape);
//   3. `defer` / `go` with the callee on the next line: neither keyword inserts a
//      semicolon, so the statement starts a line before its target is named;
//   4. a WRAPPED parameter list: the `func` keyword line is not where the
//      parameter's type is written;
//   5. an embedded type and an interface declaration: the site that names the
//      edge is the embedded type / the interface, not the enclosing struct.
package main

import (
	"fmt"
)

type Reader interface {
	Read() int
}

type Base struct{}

type Store struct {
	Base
	items []int
}

func (s *Store) Read() int {
	return len(s.items)
}

func (s *Store) Reset() int {
	return len(s.items)
}

func cleanup() {}

func worker() {}

func seed(n int) int {
	return n + 1
}

func wrapped(
	s *Store,
) int {
	return s.Read()
}

func NewStore() *Store {
	return &Store{}
}

func run(s *Store) int {
	defer
		cleanup()
	go
		worker()
	s.
		Reset()
	_ = NewStore()
	fmt.Println(seed(1))
	return seed(2)
}
