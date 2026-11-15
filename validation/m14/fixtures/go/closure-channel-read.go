package gofixture

// A package-scope channel. GOD9 pins that a read of it from inside a
// package-scope FUNC LITERAL is published, attributed to `global` — the same
// attribution the selector/identifier read passes already use for a closure
// read. Pre-fix the channel pass required a NAMED containing function and
// dropped these two reads, so the analyzer disagreed with itself: one pass
// published the read, another discarded the same physical read.
var c chan int

var _ = func() int {
	<-c
	c <- 1
	return 0
}

func sendsAndReceives() {
	<-c
	c <- 2
}

func closureInsideFunction() {
	inner := func() {
		<-c
	}
	inner()
}

// The other half of the contract: a channel that is NOT package-scope names no
// graph node (LocalsAreNotSymbols — the same gate the goroutine/defer
// branches apply), so neither the local `l` nor the parameter `ch` may be
// published as a channel target.
func localsAreNotChannels(l chan int, ch chan int) {
	local := make(chan int)
	<-local
	<-l
	ch <- 3
}

// A receive of a CALL RESULT is not a channel read of a named symbol.
func resultIsNotAChannel() {
	<-make(chan int)
	<-chanOf()
}

func chanOf() chan int { return nil }

// A `for range ch` is a range clause over a channel, not a send or a receive
// statement, so it is not a `go_channel_operation`.
func rangingIsNotAnOperation() {
	for range c {
	}
}
