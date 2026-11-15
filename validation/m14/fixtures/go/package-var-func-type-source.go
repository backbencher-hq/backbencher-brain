package p

// GO40 — a package-scope var/const whose type expression CONTAINS the type
// reference, reached without a func_literal between them.
//
// The func_literal branch of resolveSource reached a var_spec only by climbing
// THROUGH a function literal (`var R = map[string]func(){ ... }`). A var whose
// declared type is a function type has no literal in between: the func type's
// parameter declarations walk parameter_list -> function_type -> var_spec, and
// the walk used to continue straight past the var_spec to `global`. Measured on
// this declaration before the fix: FOUR rows where the language has TWO facts —
// the var_spec pass published the correct sysStat rows and the parameter pass
// published `global -> FileInfo` / `global -> Header` beside them.

type Header struct{}
type FileInfo struct{}

// The subject: a package-scope var whose declared type is a function type.
var sysStat func(fi FileInfo, h *Header) error

// CONTROL: a named non-func type needs no parameter pass, so it was already
// correct before the fix and must stay correct.
var single Header

// CONTROL: two names, one type — each name is its own binding.
var first, second Header

// A blank name at package scope has no name to attribute to; `global` is the
// honest answer and must NOT be moved onto a sibling.
var _ func(h *Header)

// A FUNCTION-LOCAL var with a func type. LocalsAreNotSymbols makes a local not
// a graph node, so this attributes to the ENCLOSING FUNCTION — a fix that
// returned the spec's name unconditionally would publish `localHook -> Header`,
// which no consumer can resolve.
func UseLocal() {
	var localHook func(h *Header)
	_ = localHook
}

// A function literal owned by a package var: the func_literal branch already
// owned this and must keep answering the package var's name.
var Registry = func() {
	var inner func(h *Header)
	_ = inner
}