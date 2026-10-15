// script/m13/verify-visualize-target-literals.ts — M13.60 (V6).
//
// A TARGET IS A VALUE, NEVER A PATTERN — the gate for F2.
//
// The docs said `%`, `_` and `\` "are escaped and match themselves". They matched
// NOTHING. MEASURED before the fix, against a fixture that held both a
// `src/my_mod/` module and a symbol named `deep_lookup`:
//
//   module target="src/my_mod"   -> 0 nodes, totalNodesAvailable 0 and
//                                   "no indexed symbol matches scope=module
//                                   target=\"src/my_mod\" — absence declared"
//   feature target="deep_lookup" -> 0 nodes, same shape
//
// while `SELECT COUNT(*) ... LIKE 'src/my_mod/%'` (unescaped) returned 2 rows. The
// escaping was there; the escape CHARACTER was not. SQLite has no default escape
// character, so the backslash in `src/my\_mod/%` was a literal backslash and the
// predicate could never match.
//
// Every assertion below is a property of the FIXTURE, not of the query text: the
// discriminating positives are `%` and `_` inside a real directory name, and the
// discriminating negatives are targets that WOULD match if those characters were
// still wildcards.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.60", code: "V6", tool: "bb_visualize",
  title: "bb_visualize: a target is a VALUE — %, _ and \\ match themselves",
  layers: ["unit", "integration"],
  decisions: {
    metacharacters: "a real directory is named `src/50%_util`, so matching it proves both characters match themselves",
    wildcardNegatives: "`src/util%` and `feature 1%0` return nothing — both WOULD match if % were a wildcard",
    absence: "an empty answer names the target verbatim, so a declared absence is checkable",
  },
  limitations: [
    "No fixture file can contain a backslash on every platform, so the backslash case is asserted as a non-match that does not throw or widen.",
    "Case-folding of targets and the rejection of unknown languages/relationship types (F6/F7) are the next batch.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v6-"))
const write = (rel: string, body: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), body)
}
write("src/my_mod/deep.ts", "export function deep_lookup(): number { return 1 }\n")
write("src/50%_util/mod.ts", "export function pctThing(): number { return 2 }\n")
write("src/util/edit_distance.ts", "export function editDistance(): number { return 3 }\n")
write("src/utilities/format_helpers.ts", "export function formatHelper(): number { return 4 }\n")
write("src/pricing.py", 'def discount(rate):\n    """Discount is 100% for partners."""\n    return rate\n')

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})

const handlers = createToolHandlers() as any
const ctx = { projectPath: root, projectId }
const run = async (args: Record<string, unknown>): Promise<any> =>
  JSON.parse((await handlers.bb_visualize({ format: "json", ...args }, ctx)).content[0].text as string)
const fileOf = (node: any): string => String(node.filePath ?? node.file ?? "")
const files = (result: any): string[] => [...new Set((result.nodes as any[]).map(fileOf))]
const note = (result: any): string => String(result.absenceNote ?? "")

// ── a control with no metacharacters, so the fixtures below are known reachable ─
{
  const plain = await run({ scope: "module", target: "src/util" })
  harness.check("control: a plain module target resolves", plain.nodes.length > 0 && plain.declaredAbsent === false, `nodes=${plain.nodes.length}`)
  harness.check("control: `src/util` does not bleed into `src/utilities`", files(plain).every((f) => f.startsWith("src/util/")), files(plain).join(","))
  harness.check("control: the segment boundary is exact (src/utilities is a different module)", !files(plain).some((f) => f.includes("src/utilities/")), files(plain).join(","))
}

// ── `_` matches itself ──────────────────────────────────────────────────────
{
  const module_ = await run({ scope: "module", target: "src/my_mod" })
  harness.check("underscore: module target with `_` resolves (was 0 before the escape clause)", module_.nodes.length > 0, `nodes=${module_.nodes.length}`)
  harness.check("underscore: and is NOT declared absent against the project", module_.declaredAbsent === false && module_.totalNodesAvailable > 0, `absent=${module_.declaredAbsent} available=${module_.totalNodesAvailable}`)
  harness.check("underscore: the module's own file is returned", files(module_).some((f) => f === "src/my_mod/deep.ts"), files(module_).join(","))
  const feature = await run({ scope: "feature", target: "deep_lookup" })
  harness.check("underscore: a snake_case feature target resolves (was 0 before)", feature.nodes.length > 0, `nodes=${feature.nodes.length}`)
  harness.check("underscore: the named symbol is in the answer", (feature.nodes as any[]).some((n) => n.name === "deep_lookup"), JSON.stringify((feature.nodes as any[]).map((n) => n.name)))
  const fileScope = await run({ scope: "file", target: "src/my_mod/deep.ts" })
  harness.check("underscore: file scope resolves it by equality as well", fileScope.nodes.length === 1, String(fileScope.nodes.length))
  harness.negative("underscore: a different spelling does not match `my_mod`", (await run({ scope: "module", target: "src/myXmod" })).nodes.length === 0, "src/myXmod matched")
}

// ── `%` and `_` match themselves, in a real directory name ───────────────────
{
  const pct = await run({ scope: "module", target: "src/50%_util" })
  harness.check("percent: a module whose NAME contains % and _ resolves", pct.nodes.length > 0, `nodes=${pct.nodes.length}`)
  harness.check("percent: the symbol under that directory is returned", files(pct).some((f) => f === "src/50%_util/mod.ts"), files(pct).join(","))
  harness.negative("percent: the answer is not an absence note about an existing module", pct.declaredAbsent === false && note(pct) === "", note(pct))
}

// ── the discriminating negatives: `%` is not a wildcard ─────────────────────
{
  // `src/util%` WOULD match src/util/edit_distance.ts if `%` were a wildcard:
  // the pattern `src/util%/%` becomes "src/util" + anything + "/" + anything.
  const wildcardish = await run({ scope: "module", target: "src/util%" })
  harness.check("percent is literal: `src/util%` matches nothing", wildcardish.nodes.length === 0 && wildcardish.totalNodesAvailable === 0, `nodes=${wildcardish.nodes.length}`)
  harness.negative("percent is literal: the miss is declared with the target verbatim", wildcardish.declaredAbsent === true && note(wildcardish).includes("src/util%"), note(wildcardish))

  const docstring = await run({ scope: "feature", target: "100%" })
  harness.check("percent is literal: `100%` matches the docstring that contains it", docstring.nodes.length > 0, `nodes=${docstring.nodes.length}`)
  harness.check("percent is literal: the docstring's symbol is the one returned", files(docstring).some((f) => f === "src/pricing.py"), files(docstring).join(","))
  // `1%0` WOULD match that same docstring if `%` were a wildcard.
  const notWildcard = await run({ scope: "feature", target: "1%0" })
  harness.negative("percent is literal: `1%0` does not match `100%` (a wildcard would)", notWildcard.nodes.length === 0 && notWildcard.declaredAbsent === true, `nodes=${notWildcard.nodes.length}`)
}

// ── the escape character itself ─────────────────────────────────────────────
{
  const withBackslash = await run({ scope: "file", target: "src/my_mod\\deep.ts" })
  harness.check("backslash: a target containing the escape character does not throw", Array.isArray(withBackslash.nodes), "no result")
  harness.negative("backslash: and does not widen into a match (the escape character is itself escapable)", withBackslash.nodes.length === 0 && withBackslash.declaredAbsent === true, `nodes=${withBackslash.nodes.length}`)
  const trailing = await run({ scope: "module", target: "src/my_mod/" })
  harness.check("trailing slash: a directory target with a trailing slash behaves like one without", trailing.nodes.length === (await run({ scope: "module", target: "src/my_mod" })).nodes.length, String(trailing.nodes.length))
}

rmSync(root, { recursive: true, force: true })
harness.emit()
