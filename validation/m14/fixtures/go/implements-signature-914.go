// PINS the Go `implements` contract (#914): a type T implements I when T's
// method set contains a method the SAME NAME and the SAME CANONICAL SIGNATURE as
// every method I declares. Four analyzer defects and one oracle defect were
// found by classifying every remaining implements disagreement on the two pinned
// corpora (go-tools 9 MISSING + 2 UNEXPLAINED at full extent, terraform 18
// MISSING) and 90 MISSING over 13,488 kubernetes files:
//
//   (1) VARIADIC interface parameters. The interface-method extractor rejected
//       `variadic_parameter_declaration` outright, so `Logf(format string, args
//       ...any)` lost `args` on the DECLARED side while the implementor kept it —
//       every grpc client (all of whose methods end in `opts ...grpc.CallOption`)
//       and every `Output(code, args ...any)` view interface was un-satisfiable.
//       `Logger`/`myLogger` is the go-tools shape (printf testdata a2.go).
//   (2) RECEIVER-ONLY implementors. Go's method set is a PACKAGE-level property:
//       gopls declares `clientDispatcher` in protocol.go and all of Client's
//       methods in tsclient.go, so the pair is provable from this file alone.
//       `Client`/`clientDispatcher` is that shape (the type is declared NOWHERE
//       in this file — deliberately).
//   (3) ALIAS interfaces (`type Alias = interface{ M() }` is a `type_alias`, not
//       a `type_spec`) and interfaces that EMBED one, with a DIAMOND embedding
//       (`A { B; C }`, `B { D }`, `C { D }`) — the visiting mark must be a path
//       mark, or D's methods reach C and A only by declaration order. Both sides
//       lost the diamond edge in different ways, which is why no differential
//       could ever see it. gcimporter testdata issue25301.go is the corpus shape.
//
// The NEGATIVE half pins the class the oracle used to over-claim: it compared
// method NAMES only, a strict superset of Go's rule, so it published pairs Go
// refuses (`Value -> Type` with `Elem() Value` against `Elem() Type`;
// `VT -> VI` with `F(int, ...string)` against `F(int)`; `Diff -> DiffRenderer`;
// `graphTransformerMulti -> GraphVertexTransformer`; every
// `UnimplementedXServer -> XClient`, fixed arity against variadic). Each was
// charged to the analyzer as a MISSING edge it could never close. A variadic
// parameter is `...T`, a DIFFERENT type from `T` and from `[]T`.
package main

import "context"

// (1) variadic interface parameter
type Logger interface {
	Logf(format string, args ...any)
}

type myLogger int

func (myLogger) Logf(format string, args ...any) {}

// (2) receiver-only implementor: `clientDispatcher` is NOT declared here
type Client interface {
	Call(ctx context.Context, in *Params) error
}

func (c *clientDispatcher) Call(ctx context.Context, in *Params) error { return nil }

// (3) alias interface, an interface that embeds it, and a diamond
type Alias = interface {
	M()
}

type Embedder interface {
	Alias
}

type AliasImpl struct{}

func (AliasImpl) M() {}

type D interface{ Deep() }

type B interface {
	D
}

type C interface {
	D
}

type A interface {
	B
	C
}

type Diamond struct{}

func (Diamond) Deep() {}

// ---- NEGATIVE: same method NAME, different SIGNATURE -------------------

// return-type mismatch (reflect.go Value/Type)
type StrictType interface {
	Elem() StrictType
}

type StrictValue struct{}

func (StrictValue) Elem() StrictValue { return StrictValue{} }

// arity mismatch (coverage.go VT/VI)
type ArityIface interface {
	F(x int)
}

type ArityVariadic struct{}

func (ArityVariadic) F(x int, y ...string) {}

// `[]T` is not `...T`
type SliceIface interface {
	G(xs ...string)
}

type SliceNotVariadic struct{}

func (SliceNotVariadic) G(xs []string) {}

// fixed arity against variadic (the grpc UnimplementedXServer/XClient shape)
type Dialer interface {
	Dial(ctx context.Context, addr string, opts ...string) error
}

type unimplementedDialer struct{}

func (unimplementedDialer) Dial(ctx context.Context, addr string) error { return nil }

// bare `T` is not `...T` (the marker a variadic-blind compare collapses)
type BareIface interface {
	H(x string)
}

type VariadicOnly struct{}

func (VariadicOnly) H(x ...string) {}
