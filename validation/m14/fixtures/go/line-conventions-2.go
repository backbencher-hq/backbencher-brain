package gofixture

// M60 line round, part 2. `callsite-lines-825` already pins the conventions for
// calls, extends, implements, contains, instantiates, imports, declared_type
// references and selector uses, each with a named pre-fix shape to forbid. The
// conventions it does NOT cover are the four below, and each has at least one
// plausible alternative site that a counting gate cannot distinguish from the
// right one.

type Out struct{}

type Reader interface {
	Read() error
}

type Box[T any] struct{ v T }

func NewBox[T any](v T) *Box[T] { return &Box[T]{v} }

var total int
var ch chan int

// produce's result TYPE is on the line below the `func produce() (` line, and
// `return_type` names the type — the same rule as a parameter's type, on a
// different list. GO37 ruled that a parameter_declaration inside a
// `function_type` is not a result, so the only return_type site in a file like
// this one is the enclosing function's own result list.
func produce() (
	Out,
	error,
) {
	var o Out
	return o, nil
}

// A generic CALL instantiates the FUNCTION, and a composite literal
// instantiates the TYPE. Two different targets and two different sites in one
// body, which is why `instantiates` cannot be pinned by a single case.
func generic() {
	b := NewBox(
		1,
	)
	_ = b
	var c = Box[int]{}
	_ = c
}

// The identifier is a READ here, not an assignment target: the bare-identifier
// pass publishes reads, and `total = 1 + 2` is a write whose LHS is not one.
// The site is the identifier's OWN line.
func reads() int {
	return total +
		total
}

// A receive and a send are SEPARATE rows with the same target and the same
// enclosing function, and the site is the send/receive statement's own line —
// not the `select` keyword's, and not the case body's.
func pump() {
	select {
	case <-ch:
	case ch <- 1:
	}
}

// And inside a package-scope literal the source is `global`, on the statement's
// line — the GOD9 site, which is only reachable because the fixture literal is
// at file scope.
var _ = func() {
	<-ch
}()

func (b *Box[T]) Read() error { return nil }

var _ Reader = (*Box[int])(nil)
