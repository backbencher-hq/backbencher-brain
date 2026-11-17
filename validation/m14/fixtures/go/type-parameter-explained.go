// go/type-parameter-explained — A TYPE PARAMETER IS DECLARED HERE, NOT ELSEWHERE.
//
// A type parameter is a real Go declaration (spec, Type parameter declarations)
// but it is SCOPED to its function or type, so it is not a symbol — the same
// reading LocalsAreNotSymbols applies to locals. The lane still emits the
// reference, which is right: `Pair -> K` is a true fact (Pair uses its parameter
// K), and suppressing it would hide a real dependency.
//
// What was WRONG is the EXPLANATION. With no type-parameter set to consult,
// those rows fell through to the generic declared-type code
// `declared_type_leaf_whose_declaring_file_is_out_of_scope` — which says the
// declaring file is outside this one. For `K` that is false: its declaration is
// the `type_parameter_list` on the very same line. MEASURED on go-tools +
// terraform (3,422 files, 363,830 edges): 981 edges carried that false code.
//
// They now carry `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol`,
// which states the two facts that matter: the declaration IS in this file, and it
// is scoped rather than package-level, which is why it is not a symbol.
package typeparameterexplained

// A generic function: both parameters referenced in the signature.
func Generic[T any, U comparable](a T, b U) T { return a }

// A generic type: its parameters referenced by the struct fields.
type Pair[K comparable, V any] struct {
	Key K
	Val V
}

// CONTROL: a parameter-free type reference must KEEP the generic code, so the fix
// cannot pass by relabelling every declared-type row.
type Plain struct{ Inner Missing }
