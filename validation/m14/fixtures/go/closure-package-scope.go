package closurepkg

// PINS the SOURCE of a channel read inside a FUNC LITERAL, in the one shape the
// existing closure-channel-read fixture does not cover: a literal that is the
// initializer of a NAMED PACKAGE-SCOPE var.
//
// `findContainingGoFunction` walks up for a function_declaration/method_declaration
// only, so a literal had no containing function and the channel pass's
// `?? "global"` fallback answered a pseudo-source for work a named declaration
// owns — the same "one pass resolves the named ancestor and another falls
// through" shape as GOD11, the package-scope `instantiates` site, and the
// declared-type `resolveSource` gap.
//
// The rule the fix implements: a func literal does not STOP the walk, it only
// stops it when the literal initializes a named package-scope var. A literal
// inside a function keeps climbing to its function (pinned by
// go/closure-channel-read: `closureInsideFunction -> c`); a literal inside a
// package var stops there with the var's name; a literal with neither (a call
// argument, a return value) reaches the file and answers undefined.

var Ch = make(chan int)

var Handler = func() int {
	<-Ch
	return 0
}

var Sender = func() {
	Ch <- 1
}

// CONTROL: a blank-identifier var has no name to attribute to, so `global`
// remains the honest answer.
var _ = func() int {
	<-Ch
	return 0
}
