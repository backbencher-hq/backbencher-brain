// go/local-type-scope — A FUNCTION-LOCAL TYPE IS A SYMBOL, BUT NOT A PACKAGE-SCOPE ONE.
//
// GO38 made a function-local `type` declaration a symbol (it was previously
// skipped entirely, so the declared-type pass published `references Local -> Host`
// whose SOURCE named nothing). That is right and stays.
//
// What was missing is the SCOPE LABEL. Two functions in one file may each declare
// `type localState struct{}` — legal Go, different scopes — and both rows came out
// with `ownerName: undefined` and no marker, so a consumer reading the symbol list
// saw "this file declares localState twice": illegal Go that the file does not
// contain. Measured across go-tools + terraform: 14 such apparent package-scope
// duplicates (objectpath.go `hasElem` x2, module_merge_test.go `testCase` x4, ...),
// every one of them legal Go whose only defect was the absent scope label.
//
// The fix publishes `metadata.isLocalDeclaration`, the FLEET's spelling for the
// fact (clean's analyzer carries the same key), so a consumer filters one name
// across lanes. It is additive — no lookup reads it, so no relationship moves.
//
// The two identical local declarations below are the point: they must BOTH be
// symbols, both marked local, and the package-scope type must carry NO such mark.
package localtypescope

func First() {
	type localState struct{ a int }
	_ = localState{}
}

func Second() {
	type localState struct{ b int }
	_ = localState{}
}

// The control: a package-scope type of the SAME shape, which must NOT be marked.
type PackageLevel struct{ c int }
