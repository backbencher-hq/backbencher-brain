// Review instrument (NOT a gate): M59 Tier-A source check for the CSS lane.
//
//   bun script/m14/tmp/css-line-oracle.ts [--out <path>]
//
// Tier A is the necessary condition, and the tiers are never conflated: for a
// relationship claiming line L, the source line L must contain the TARGET's name
// as a token. A pass is therefore "consistent", never "correct" — which is
// exactly the wording `script/m59/oracle-callsite.ts` uses for every lane, and
// Tier B (an exact expected value per construct) is reported ABSENT here, never
// as a pass.
//
// The check is derived from the FILE'S OWN TEXT, not from the analyzer's output.
// The only thing shared with the analyzer is the tree-sitter parser.
//
// The third state is notCheckable: a synthesized name, an unknown target, or a
// name the file does not write. It is never counted as a pass — the lane reports
// consistent / INCONSISTENT / notCheckable separately so an empty checkable set
// cannot read as a clean lane.

import { ASTEngine } from "../../../src/ast/engine"
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const REPOS = ["svelte", "grails-core", "scala3", "element-plus", "graphql-js", "cython", "go-tools", "mojo", "zig", "cloogle.org", "vue-core", "cargo", "fsharp"]

/** Names the analyzer synthesises; a line can never be right for one. */
const SYNTHETIC_NAME = /^(constructor|anonymous|anonymous_object|anonymous_[\w$]+|given_\d+|component\d+|default)$/
const UNKNOWN_TARGETS = new Set(["?", "<unknown>", "<anonymous>", ""])

function walk(dir: string, out: string[], d = 0): void {
  if (d > 10) return
  let es: string[]
  try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (["node_modules", ".git", "target", "dist"].includes(e)) continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, d + 1)
    else if (e.endsWith(".css") && st.size > 0) out.push(p)
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Word-boundary containment, allowing a CSS name's own punctuation. */
const onLine = (line: string, token: string): boolean => {
  if (!token) return false
  if (line.includes(token)) return true
  const t = token.replace(/^[.#:@]+/, "")
  if (t.length < 2) return false
  return new RegExp(`(^|[^\\w])${escapeRe(t)}([^\\w]|$)`).test(line)
}

/**
 * The token that must appear on the claimed line, per relationship class.
 *
 * A COMMA GROUP is not one token: a group written across lines
 * (`.a > b,\n.c > d { }`) has its `selectors` node starting on the first line,
 * which is the correct line, while the joined symbol name spans both. Requiring
 * the whole joined name to appear on one line would report every such edge
 * INCONSISTENT and make the gate cry wolf — so the check is per part, and an edge
 * passes when the line carries the part the `selectors` node starts on (the
 * first). This is a limitation of whole-token matching, recorded as such, not a
 * licence: the first part IS on the claimed line, which is what the line claims.
 */
function nameToken(r: any): string {
  const t = String(r.target ?? "")
  if (t.includes(",")) return t.split(",")[0].trim()
  if (r.metadata?.isMediaScope || r.metadata?.isLayerScope || r.metadata?.isContainerScope || r.metadata?.isScopeScope) {
    // The edge is named by the RULE, so the rule's selector is what must be on
    // the line — the scope's own text is on a different line by construction.
    return String(r.target ?? "")
  }
  if (r.metadata?.isVariableRef || r.metadata?.isAnimationRef) return t.replace(/^["']|["']$/g, "")
  // A font-face `uses` names the DECLARATION (`@font-face Inter`), but the thing
  // written on the claimed line is the FAMILY. Same shape as the scope-contains
  // case, where the edge is named by the rule rather than the scope: check the part
  // of the target the author actually wrote.
  if (r.metadata?.isFontFamilyRef) return t.replace(/^@font-face\s+/, "")
  // A namespace `references` names the DECLARATION (`@namespace svg url(…)`), but
  // the SELECTOR is what the claimed line carries. Same shape as the scope-contains
  // case, where the edge is named by the rule rather than the scope.
  if (r.metadata?.isNamespaceRef) return String(r.source ?? t).replace(/^.*\|/, "")
  if (r.type === "references" && r.metadata?.isVariableRef === false && t.startsWith("@namespace ")) {
    return t.replace(/^@namespace\s+\S+\s+/, "")
  }
  if (r.metadata?.isMixinRef) return t.replace(/^@mixin\s+/, "")
  if (r.metadata?.isComposition) return t
  if (r.metadata?.isSelectorChain) return t.replace(/^[.#]/, "")
  if (r.type === "imports") return String(r.target ?? "").split("/").pop() ?? String(r.target ?? "")
  return t
}

async function main() {
  await ASTEngine.init?.()
  const files: string[] = []
  for (const r of REPOS) walk(join(ROOT, r), files)
  files.sort()

  let consistent = 0
  let inconsistent = 0
  let notCheckable = 0
  let withLine = 0
  let withoutLine = 0
  let storedZero = 0
  const bad: { file: string; line: number; rel: string; token: string; sourceLine: string }[] = []
  const noLine: { file: string; rel: string }[] = []
  const byClass: Record<string, { consistent: number; inconsistent: number; notCheckable: number; noLine: number }> = {}

  for (const f of files) {
    const content = readFileSync(f, "utf8")
    const lines = content.split("\n")
    let res: any
    try { res = await ASTEngine.parseFile(f, content) } catch { continue }
    for (const r of res.relationships ?? []) {
      const cls = String(
        r.metadata?.isMediaScope || r.metadata?.isLayerScope || r.metadata?.isContainerScope || r.metadata?.isScopeScope ? "scope-contains"
        : r.metadata?.isSelectorChain ? "selector-chain"
        : r.metadata?.isCustomPropertyScope ? "custom-property"
        : r.metadata?.isNestedSelector ? "nested-selector"
        : r.metadata?.isVariableRef ? "var-reference"
        : r.metadata?.isAnimationRef ? "animation-reference"
        : r.metadata?.isMixinRef ? "mixin-reference"
        : r.metadata?.isComposition ? "composes"
        : r.type === "imports" ? "imports"
        : String(r.type),
      )
      const row = byClass[cls] ??= { consistent: 0, inconsistent: 0, notCheckable: 0, noLine: 0 }

      const ln = r.line_number
      if (typeof ln !== "number") {
        withoutLine++; row.noLine++
        if (noLine.length < 12) noLine.push({ file: f.replace(ROOT + "/", ""), rel: `${r.type} ${r.source} -> ${r.target}` })
        continue
      }
      withLine++
      if (ln === 0) { storedZero++; inconsistent++; row.inconsistent++; continue }

      const target = String(r.target ?? "")
      const token = nameToken(r)
      const source = String(r.source ?? "")
      if (
        !token ||
        // A name the analyzer SYNTHESISES — a `&`-nested rule's resolved selector
        // is written nowhere in the file — can have no right line by definition.
        r.metadata?.isSynthesizedName === true ||
        UNKNOWN_TARGETS.has(target) ||
        SYNTHETIC_NAME.test(target) ||
        SYNTHETIC_NAME.test(token)
        // NOTE: imports used to be excluded here, on the reasoning that "an
        // import's source is the FILE, which is written on no line". That is true
        // of the SOURCE and irrelevant to the check, which tests the TARGET's name
        // against the claimed line — and `nameToken` already reduces an import
        // target to its basename, which the `@import` line does carry. So 19 edges
        // were sitting in notCheckable for a reason that does not apply to the
        // thing being checked. They are checked now.
      ) {
        notCheckable++; row.notCheckable++
        continue
      }

      const srcLine = lines[ln - 1] ?? ""
      if (onLine(srcLine, token)) { consistent++; row.consistent++ }
      else {
        inconsistent++; row.inconsistent++
        if (bad.length < 25) bad.push({ file: f.replace(ROOT + "/", ""), line: ln, rel: `${r.type} ${source} -> ${target}`, token, sourceLine: srcLine.trim().slice(0, 70) })
      }
    }
  }

  const artifact = {
    instrument: "css-line-oracle",
    tier: "A (necessary condition, source-derived). A pass means CONSISTENT, never 'correct'. Tier B — an exact expected value per construct — is ABSENT, reported as absent and never as a pass.",
    method: "For a relationship claiming line L, the file's own source line L must contain the TARGET's name as a token. Nothing is read from the analyzer's output except the claim under test; the expected value comes from the file text. The only shared component is the tree-sitter parser.",
    thirdState: "notCheckable covers a SYNTHESIZED name (a `&`-nested rule's resolved selector is written nowhere, so it can have no right line by definition) and an UNKNOWN target. It is never counted as a pass. Imports are NOT in this set — the exclusion that put 19 of them here reasoned about the edge's SOURCE while the check tests its TARGET, and the `@import` line does carry the imported name.",
    corpora: REPOS,
    filesMeasured: files.length,
    summary: {
      relationshipsWithLine: withLine,
      relationshipsWithoutLine: withoutLine,
      storedLineZero: storedZero,
      consistent,
      INCONSISTENT: inconsistent,
      notCheckable,
    },
    byClass: Object.fromEntries(Object.entries(byClass).sort((a, b) => (b[1].consistent + b[1].inconsistent) - (a[1].consistent + a[1].inconsistent))),
    inconsistentSamples: bad,
    withoutLineSamples: noLine,
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT && OUT !== "undefined") { writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })
