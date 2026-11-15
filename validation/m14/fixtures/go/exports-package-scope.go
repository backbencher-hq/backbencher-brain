// Fixture for the SCOPE of the go lane's `exports` edge.
//
// Go's specification scopes an identifier to its PACKAGE. A capitalized name
// declared inside a function body is not reachable from any importer, whatever
// its first letter is, so the lane must not publish an `exports` edge for it —
// and it must not label such an edge `capitalized_package_scope_name`, which is
// the name of the rule it is breaking.
//
// The file is built so that BOTH halves are load-bearing:
//
//   EXPECTED   a capitalised name declared at package scope exports.
//   FORBIDDEN  a capitalised name declared ONLY inside a function body, a
//              method body or a func-literal body does not — including one that
//              is spelled exactly like a type it shadows, because the shadowing
//              is what Go's scoping forbids and not the spelling.
//   FORBIDDEN  the lane's own scope decision (methods, package-scope vars) stays
//              a decision: pinning it means a future change that widens the
//              predicate fails here instead of drifting.
//
// Rows are authored from the Go specification's declaration and block rules and
// from tree-sitter-go's node-types.json (`source_file`'s direct named children
// are `package_clause`, `import_declaration` and the declarations; anything
// under a `block` is inside a body). None of them is copied from a run.

package exportscope

// package scope: exported
type Widget struct{ Label string }

type Sizer interface{ Size() int }

// package scope: unexported
type widgetImpl struct{ n int }

// package scope: exported func
func NewWidget(label string) *Widget { return &Widget{Label: label} }

// package scope: unexported func
func newWidgetImpl() *widgetImpl { return &widgetImpl{} }

// package scope: exported const
const WidgetVersion = 2

// package scope: exported var
var WidgetRegistry = 0

// package scope: type alias, exported
type WidgetAlias = Widget

// package scope: method. Go DOES export a capitalised method name, and this lane
// deliberately does not carry methods on this edge (membership rides
// `contains`; the F3 export-uniqueness invariant requires unique top-level
// names). Pinned FORBIDDEN so the decision cannot drift silently. This is a
// DECISION, not a claim about the language.
func (w *Widget) Size() int { return len(w.Label) }

// A function body. Each declaration below is capitalised and package-invisible.
// `InnerWidget` and `InnerHelper` shadow nothing and must not export;
// `ShadowedAlias` shadows the package-scope `Widget` and STILL must not appear
// twice — the package-scope declaration is the one that exports.
func Run(n int) any {
	type InnerWidget struct{ LocalOnly int }
	var InnerRegistry = 1
	const InnerVersion = "shadow"
	type innerImpl struct{}
	type ShadowedAlias = Widget
	_ = InnerWidget{LocalOnly: n}
	_ = InnerRegistry
	_ = InnerVersion
	_ = innerImpl{}
	_ = ShadowedAlias{}
	return nil
}

// A method body: the receiver's method set does not put a name in package scope.
type Holder struct{}

// func literal body: the same rule, one scope deeper than a method.
var build = func() any {
	type InnerLiteral struct{ FromLiteral int }
	return InnerLiteral{}
}