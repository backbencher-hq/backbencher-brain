// PINS the R7 endpoint rule on `imports`: an edge endpoint may not be EMPTY.
//
// MEASURED, not asserted. The full go-stdlib census
// (`script/m14/go-ontology-census.ts`, 11,789 files through the production
// `parseFile`) recorded 5 `imports` edges with an empty TARGET and 0 with an
// empty source. Every one of the five is a compiler-rejection fixture whose
// whole purpose is to be rejected:
//
//   test/import6.go                                    `import ""`
//   test/fixedbugs/issue11610a.go                      `import""`
//   src/internal/types/testdata/check/importdecl0/importdecl0b.go   `""`
//   src/internal/types/testdata/fixedbugs/issue43190.go           `import ;`
//
// An empty import path is not a dependency on nothing: Go's spec requires
// `ImportPath` to be a non-empty string and the compiler rejects the file. So
// the edge resolved to nothing, could never be followed by
// `src/ast/import-resolution.ts`, and every consumer of the graph had to
// special-case it. R7 forbids it, and the workstream's definition of done names
// "no empty names" as a per-language requirement.
//
// The guard suppresses the EDGE and counts the suppression in
// `metadata.invalidImportPathCount`. Both halves are pinned here, because a
// guard that drops rows with nothing to show for it is indistinguishable from a
// guard that is not running: the count is what makes the suppression visible to
// a consumer instead of silent.
package gofixture

import "fmt"

// A real dependency, and the shape the guard must NOT touch.
import "strings"

// A grouped block with one EMPTY spec among three real ones: the real three
// must all survive, so the guard cannot be implemented by dropping the whole
// declaration or the whole block.
import (
	"sort"
	""
	"errors"
)

// An empty path inside a grouped block whose other spec is a real one.
import (
	"bytes"
	`` // empty raw string: also an empty path
)

var (
	_ = fmt.Sprintf
	_ = strings.TrimSpace
	_ = sort.SearchInts
	_ = errors.New
	_ = bytes.NewReader
)