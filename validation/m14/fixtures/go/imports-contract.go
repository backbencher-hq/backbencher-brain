package gofixture

import "fmt"

// A grouped block must yield one edge per spec, not one for the block. This is
// the shape 96% of the corpus uses, so a bug here is invisible in any file that
// is not grouped.
import (
	"os"
	"strings"
	"sort"
)

// The target is the PATH, not the alias. An oracle that published the alias
// would satisfy itself against garbage while the real module path went unchecked.
import f "encoding/json"

// A dot import names a real dependency whose name field is a dot.
import . "bytes"

// cgo's pseudo-package is one character and names no module on disk, so any
// derivation that resolves a path to a package name, or that skips a spec
// carrying a name field, drops it.
import "C"

// A blank import is a real dependency: `_ "embed"` exists to run the embed
// generator, and the dependency is the whole point of the label.
import _ "embed"

//go:embed imports-contract.go
var embedded string

// Grouped, aliased and blank specs mixed in one block.
import (
	g "golang.org/x/net/context"
	_ "net/http/pprof"
	"github.com/go-logr/logr"
)

var (
	_ = fmt.Sprintf
	_ = os.Args
	_ = strings.TrimSpace
	_ = sort.SearchInts
	_ = f.Marshal
	_ = C.int(0)
	_ = g.Background
	_ = logr.Logger{}
)
