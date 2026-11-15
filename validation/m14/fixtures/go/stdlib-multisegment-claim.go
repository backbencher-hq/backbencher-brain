package stdlibclaim

// GO-STDLIB MULTI-SEGMENT CLAIM — task-38 two-direction pin (Lead ruling 2026-10-19, Option A-modified).
//
// The ruled mechanism: an `imports` edge for a MULTI-SEGMENT standard-library module cites its first
// segment through `meta.languageNamespace` + `languageNamespacePolicy: "strict-absent"` +
// `languageNamespaceSlash: true`, with `meta.stdlibModule` kept as evidence. The arbiter opts into
// splitting the target on `/` ONLY for edges carrying the slash marker (every other lane's citation
// arms are byte-identical). The evidence chain is fail-closed: the module is read from THIS FILE's
// import literal, it has ≥2 `/` segments, and its first segment is a member of the CLOSED
// `GO_STDLIB_TOP_LEVEL` set. No shape heuristic is used — the forbidden sweep (`no dot ⇒ stdlib`)
// would claim a project-local path; the FORBID half below pins that the emission does not.
//
// A wrong/non-listed root is REFUTED by the arbiter rather than resolved; that half is an arbiter
// property and is exercised by `script/m14/go-stdlib-multisegment-census.ts --verify`, not by a
// parser fixture (a fixture can only see what the analyzer emits).

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/go-cmp/cmp"
	"example.com/project/internal/util"
)

import (
	_ "crypto/sha256"
	dot "net/url"
)

var _ = json.Marshal
var _ = fmt.Sprintf
var _ = http.MethodGet
var _ = cmp.Diff
var _ = util.Thing
var _ = sha256.New
var _ = url.Parse
