// The GRAMMAR-GAP pin (#889 round) — a grammar error region is not evidence.
//
// `var _ = Backward[[]int]` is LEGAL Go (Go 1.21+: a generic function may be
// instantiated as a value), and `func (Either[A, B]) A() A` is LEGAL Go too
// (Go 1.18+: a method on an instantiated generic receiver). The pinned
// tree-sitter-go grammar errors on BOTH, and its error RECOVERY re-reads the
// following declaration's text as a composite literal — for `func caller(...)`
// it produced `composite_literal "s []int) { _ = s }"`, from which the lane
// published `instantiates -> s`: a construction of a name the source never
// constructs, named after a parameter.
//
// This fixture asserts the HONEST state: no construction edge from the error
// region. It does NOT assert the swallowed declarations — losing them is the
// grammar gap (registered in the lane's spec with its blast radius), and
// enshrining that loss in an expectation is exactly how a defect becomes a
// contract.
package grammarerror

func Backward[Slice ~[]E, E any](s Slice) Slice { return s }

// A package-scope generic function VALUE. Everything the grammar cannot
// represent starts here.
var _ = Backward[[]int]

func caller(s []int) int {
	return len(s)
}
