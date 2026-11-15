package gofixture

// GOD10: an import block left unterminated does not parse into a degraded
// `import_declaration`. The grammar emits a BARE `ERROR` node that holds the
// specs directly:
//
//   ERROR "import ("
//     import_spec "\"net/url\""
//     import_spec "\"io/ioutil\""
//     ERROR "var _ ="
//
// A pass that keys on the import_declaration wrapper therefore loses the whole
// block. That this is a defect and not a ruling is what GO16 already decided:
// recovery must not swallow a DECLARATION the tree can still see. An import
// path is not a value read out of a recovery the way a composite literal or a
// call receiver is (the GO15/GO17 distinction) — it is a string literal the
// grammar handed back whole, and a dependency graph that loses it because a
// LATER line had a missing paren is wrong in a way a reader cannot detect.
//
// Found by the round-7 `imports` shapes probe, case `import-in-error-region`.
// 0 corpus instances across 6,836 files, so no full-extent read can see it, and
// the surface had no oracle at all before this round.
import (
	"net/url"
	"io/ioutil"
