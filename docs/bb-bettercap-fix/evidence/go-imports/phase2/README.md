# Go-imports phase-2 evidence (P1-1)

All commands run in the wave-2 worktree (`.tools/wt-wave2`, branch `fix-campaign-wave2`,
from CP1 `380a7e473`). Fixture DBs live under `.tools/triage-fix/go-imports/bbdata` via
`BB_DATA_DIR` (the sandbox blocks `~/.bb/projects` creation). Bettercap is never written.

Gate: `BB_DATA_DIR=$PWD/.tools/triage-fix/go-imports/bbdata npx tsx script/verify-analyze.ts`

| file | what it is |
|---|---|
| `RED-verify-analyze-phase2.txt` | RED before the fix: phase-2 block fails (`no such table: brain_project_meta` — the module identity does not exist) |
| `GREEN-verify-analyze-phase2-attempt1/2/3.txt` | intermediate progression; attempt3 is the granular RED: module identity/isExternal/dependency assertions GREEN, `P2: call inside func main is attributed to func main` still RED |
| `GREEN-verify-analyze-phase2.txt` | GREEN: `ANALYZE: PASS` (51 ok lines) |
| `GREEN-fixtures-go-phase2.txt` | phase-1 Go fixture suite after phase-2 changes: 51/51 pass |
| `GREEN-m13-verify-analyze-modes.txt` | `script/m13/verify-analyze-modes.ts`: 84/84 passed, 27 negatives |
| `GREEN-tsc.txt` | `npx tsc --noEmit`: exit 0, 0 bytes |
| `go9-census-attempt.txt` | environment-blocked: the script hardcodes `/tmp/opencode/wt/VERIFY_GO9/...`, absent here; unrelated to this change |

Phase-1 evidence remains in `docs/bb-bettercap-fix/evidence/go-imports/` (RED/GREEN fixtures and
verify-analyze, bettercap session impact probe before/after the parameter-name guard).
