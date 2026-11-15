package callvar

// PINS the func-typed package-scope variable as a CALL TARGET. A package-level
// var whose declared type is a function is callable in Go, and its calls were
// dropped: `isGoPackageCallable` accepted only Function/Method symbol kinds, so a
// hook/override injection var resolved to nothing and published no `calls` edge,
// while the same call to a `func` DECLARATION did. Real corpus pattern (~85 files
// across seven repos): `var testChecksumHook func()` then `testChecksumHook()`.

var LiteralHook = func() int { return 1 }

var TypedHook func() int

var Plain func() int

func PlainFunc() int { return 3 }

// POSITIVE: a call to a var initialized from a func literal.
func UseLiteral() int {
	return LiteralHook()
}

// POSITIVE: a call to a var whose declared type is a func type.
func UseTyped() int {
	return TypedHook()
}

// POSITIVE control: a call to a plain func declaration still works.
func UsePlainFunc() int {
	return PlainFunc()
}

// NEGATIVE: a function-LOCAL func var is not a package callable, so calling it
// must not produce a calls row naming a package symbol.
func UseLocal() int {
	local := func() int { return 9 }
	return local()
}

// NEGATIVE: a non-func var is not callable. A name-based guess would claim it.
var NotAFunc = 42

func UseNotAFunc() int {
	_ = NotAFunc
	return 0
}

// NEGATIVE: a var initialized from a CALL RESULT is not shape-provably a func
// value (the initializer is a call, not a func_literal), so it must not be
// claimed. This is the case a shape guess would get wrong.
var FromCall = PlainFunc()
