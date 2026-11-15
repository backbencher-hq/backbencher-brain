// PINS implements detection through PARAMETERIZED interfaces + pointer
// receivers, AND embedded-interface method promotion. The go wave deep-review
// (2026-08-29, terraform corpus) found:
//   (1) extractGoReturnType/extractGoMethodSpecReturnType scanned for
//       parameter_list children: `func (v *S) Notify(name string) {}` reported
//       return type "(v *S)" (the receiver!) and the method_spec reported the
//       PARAMETERS as a fake return type — so signature comparison failed and
//       NOTHING implemented the interface.
//   (2) embedded interfaces (`interface { Reader; Close() }`) parsed as
//       constraint_elem and were NEVER emitted as symbols, so promoted methods
//       were lost — a struct with only Close() was (wrongly) declared to
//       implement ReadCloser (false positive both sides).
// This fixture asserts correct behavior: Emitter->Notifier (parameters), and
// that ReadCloser promotion requires BOTH promoted Read AND Close.
package main

import "context"

// Notifier has parameterized methods (mixed named/empty returns).
type Notifier interface {
	Notify(ctx context.Context, name string) error
	Close()
}

// Emitter implements Notifier with pointer receivers.
type Emitter struct {
	done bool
}

func (e *Emitter) Notify(ctx context.Context, name string) error {
	_ = e.done
	if name == "" {
		return context.Canceled
	}
	return nil
}

func (e *Emitter) Close() { e.done = true }

// Reader+ReadCloser: ReadCloser embeds Reader (promoted Read) + Close.
type Reader interface {
	Read(p []byte) (int, error)
}
type ReadCloser interface {
	Reader
	Close() error
}

// FileOK satisfies BOTH promoted Read and Close -> implements ReadCloser.
type FileOK struct{}
func (f *FileOK) Read(p []byte) (int, error) { return 0, nil }
func (f *FileOK) Close() error               { return nil }

// FileBad lacks the promoted Read method -> MUST NOT implement ReadCloser
// (this is the false-positive guard: without promotion, FileBad only "has"
// Close, and the embedding interface wrongly appeared satisfied).
type FileBad struct{}
func (f *FileBad) Close() error { return nil }

// Worker embeds *Shape; Shape.Run is PROMOTED into Worker's method set, so
// Worker implements Runner even though Worker declares no own methods.
// Without embedded-struct method promotion, Worker->Runner was silently
// missed (go wave deep-review 2026-08-29).
type Runner2 interface {
	Run() error
}
type Shape struct{}
func (s *Shape) Run() error { return nil }
type Worker struct {
	*Shape
	name string
}
// PlainWorker embeds nothing and declares no Run => MUST NOT implement
// Runner2 (negative guard).
type PlainWorker struct{}

// ---- M37 #604 implements classes (GOD5): methods on non-struct defined
// types, named-result signatures, generic skip ----

// RunnerFn implements Runner2 via a FUNC-TYPE receiver — Go allows methods
// on any defined type, so a named func type with Run() satisfies Runner2.
// The pre-fix analyzer only checked isStruct implementors and silently
// missed HandlerFunc-style types (go-tools: jsonrpc2 HandlerFunc/PreempterFunc,
// gopls subcommands slice type).
type RunnerFn func() error

func (f RunnerFn) Run() error { return f() }

// NamedResulter names its results (`(result any, err error)`); HandlerImpl
// declares them unnamed (`(any, error)`) with an unnamed receiver. The
// pre-fix text-signature compare treated those as DIFFERENT signatures and
// dropped the implements edge (go-tools: defaultHandler vs jsonrpc2
// Handler/Preempter named-result interfaces).
type NamedResulter interface {
	Handle() (result any, err error)
}

type HandlerImpl struct{}

func (HandlerImpl) Handle() (any, error) { return nil, nil }

// Box[T] and GenericIface[T] exercise the generic-instantiation guard:
// satisfaction requires type UNIFICATION over instantiations, which neither
// side can verify textually — so NO implements edge may be emitted (forbid
// pin). Without the guard the oracle's name-only check would fabricate it.
type Box[T any] struct {
	v T
}

func (b Box[T]) Ident() T { return b.v }

type GenericIface[T any] interface {
	Ident() T
}