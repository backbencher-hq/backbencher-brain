package forshadow

// PINS the `for_statement` scope frame. Go spec (For statements): "The scope of
// a variable declared in a for statement is the for statement itself." Before the
// frame existed a range target or 3-clause init variable bound into the ENCLOSING
// block, and because the loop's own `block` child pops its own frame the leak
// SURVIVED the loop — every later read of that name in the enclosing block was
// dropped. Real corpus witness: kubernetes staging/src/k8s.io/apiserver/
// authentication/request/websocket/protocol.go, where `protocolHeader` is a
// package var (33), shadowed by a range target (57) and read at (99).

var PackageLevel int

const PackageConst = 5

func RangeShadow(xs []int) int {
	for PackageLevel := range xs {
		_ = PackageLevel
	}
	// MUST emit: a genuine read of the package var, after the loop closed.
	return PackageLevel
}

func ThreeClauseShadow() int {
	for PackageConst = 0; PackageConst < 3; PackageConst++ {
		_ = PackageConst
	}
	// MUST emit: the const read after the loop's init variable goes out of scope.
	return PackageConst
}

// CONTROL: no shadowing at all — the loop's own variables are read inside it,
// and the package var is read after. Both must emit; neither is affected by the
// frame.
func NoShadow(xs []int) int {
	total := 0
	for i, v := range xs {
		total += i + v
	}
	return total + PackageLevel
}

// CONTROL: a NESTED block already had its own frame before the fix. A shadowing
// binding inside it must not leak past the block, so the trailing read emits —
// and it must keep emitting, so a fix that removed block frames would break it.
func NestedBlockShadow(xs []int) int {
	{
		PackageLevel := 1
		_ = PackageLevel
	}
	return PackageLevel
}

// CONTROL/PIN: `case N = <-ch` is an ASSIGNMENT to the package var, not a
// declaration. tree-sitter-go gives `receive_statement` an `=` token for the
// assignment form and `:=` for the declaring form, exactly as it does for
// assignment_statement. Binding the expression_list unconditionally pushed N
// into the ENCLOSING FUNCTION's frame (a select pushes no frame of its own),
// so every later read of N in the rest of the function body was dropped —
// including the trailing read below. Only `:=` declares.
func SelectAssignShadow(ch chan int) int {
	select {
	case PackageLevel = <-ch:
		_ = PackageLevel
	}
	println("after select")
	// MUST emit: the assignment did not declare anything, so the package var is
	// still readable for the rest of the function.
	return PackageLevel
}

// DEFECT 3, `references` source attribution through a FUNCTION LITERAL at
// package scope. `resolveSource` walks up for a `type_spec`/`type_alias` or a
// function declaration, and stops at the var_spec it is called ON — but a
// declaration inside a func literal in a package var's INITIALIZER walks past
// the literal, past the package var_spec (neither type_spec nor a function),
// and lands on `global`. The named declaration that owns that func literal is
// the package var, and the `uses`/`calls` passes already attribute to it.
var Registry = map[string]func() *Thing{
	"a": func() *Thing {
		var local Thing
		return &local
	},
}

type Thing struct{ N int }
