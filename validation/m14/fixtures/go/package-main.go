// go/package-main-attribution — CALLS INSIDE func main MUST ATTRIBUTE TO func main.
//
// The analyzer does this correctly: `resolveGoWorkSource` walks to the enclosing
// `function_declaration` and answers its name, so a `calls` row from inside
// `func main` carries source "main" and the CALL-SITE line. The DEFECT this fixture
// brackets is store-side: the write-time source lookup
// (parallel-indexer.ts `nameToSymbol`, FIRST-WINS) sees the module symbol `main:1`
// (emitted before functions) and binds the edge to it, so bettercap measures 44/44
// edges on `main.go:main:1` and 0 on `func main:20`.
//
// This fixture is the ANALYZER-SIDE CONTROL for that split (it must stay green in
// both worlds); the store-side attribution is pinned by the phase-2 gate and the RED
// evidence in docs/bb-bettercap-fix/evidence/go-imports/.
package main

func main() {
	helper()
}

func helper() {}
