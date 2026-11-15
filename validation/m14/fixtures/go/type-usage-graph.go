package main

import "io"

type TypeGraph struct {
	prop  *io.Writer
	count int
}

func (t *TypeGraph) method(param *io.Writer, n int) (*TypeGraph, error) {
	return t, nil
}

// F6 coverage (2026-09-02): type_alias, const_declaration/const_spec,
// variadic_argument, type_parameter_list, select/send/receive/communication_case
// — declared handled_verified but not previously exercised.
type ID = string

const (
	StatusIdle = iota
	StatusBusy
)

func Sum(vals ...int) int {
	total := 0
	for _, v := range vals {
		total += v
	}
	return total
}

func callVariadic() {
	nums := []int{1, 2}
	_ = Sum(nums...) // F6: variadic_argument (slice spread at call site)
}

func First[T any](items []T) T {
	var zero T
	if len(items) == 0 {
		return zero
	}
	return items[0]
}

func pump(ch chan int, done chan bool) {
	select {
	case v := <-ch:
		_ = v
	case ch <- 1:
		_ = Sum()
	case <-done:
		return
	}
}

// GOD8 channel-op contract (2026-09-06): channel send/receive/select edges
// emit ONLY for declared channels — a bare PACKAGE-SCOPE var/const channel
// (jobs below) or a MEMBER selector (Hub.jobs below, leaf + send/receive
// direction). Bare local/param channels (pump's ch/done), method-result
// channels (`<-ctx.Done()`), and the raw dotted form (`h.jobs`) emit
// NOTHING: LocalsAreNotSymbols + leaf-target family contract. Two sends on
// jobs collapse to ONE row (dedup).
var jobs = make(chan int)
var doneAll = make(chan struct{})

type Hub struct {
	jobs chan int
}

func (h *Hub) worker() {
	jobs <- 1 // pkg-scope var channel -> send
	jobs <- 2 // same channel again -> dedup
	<-doneAll // pkg-scope var channel -> receive
	h.jobs <- 3 // member channel -> send (leaf jobs)
	<-h.jobs // member channel -> receive (leaf jobs)
	_ = <-make(chan int) // anonymous channel -> silent
}
