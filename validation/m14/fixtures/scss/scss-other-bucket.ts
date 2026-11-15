/**
 * SCSS — what exactly is in the `OTHER` unresolved bucket?
 *
 * `scss-bac-split.ts` classifies unresolved targets by shape and finds 81 targets / 100 edges
 * that are none of CUSTOM-PROP, MODULE-SPECIFIER or BARE-IDENT. Their names are not
 * identifiers. Examples printed by that instrument:
 *
 *     "%reset; background-color: cv.getVar"
 *     "%skeleton-pulsation; background-color: cv.getVar"
 *     "%block; align-items: center; color: hsl(cv.getVar"
 *     "--"
 *
 * A relationship target that carries `;` and a declaration list names nothing: no consumer
 * can bind it, and it is counted `unresolved` forever while looking like a reference. This
 * instrument answers the four questions needed to fix or report it:
 *
 *   1. which relationship type emits each one,
 *   2. which analyzer produced it — the SCSS analyzer delegates half its work to
 *      `RealCssAnalyzer`, so an edge can come from either,
 *   3. the SOURCE TEXT at the emitter's offsets, so the rule that produced it is readable,
 *   4. whether the target's leading fragment (everything before the first `;`) IS a
 *      published name — that is the counterfactual. If it is, the edge is a name that had a
 *      delimiter glued on and is repairable by trimming. If it is not, the edge is a
 *      fabrication and must be suppressed rather than trimmed.
 *
 * Point 4 is the difference between two opposite repairs, so it is measured, not assumed.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-other-bucket.ts [fileCount] [maxShown]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"

const COUNT = Number(process.argv[2] ?? 600)
const MAX = Number(process.argv[3] ?? 24)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files = execFileSync("bash", ["-lc", `find ${CR} -name '*.scss' -type f | sort | head -${COUNT}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

const byName = new Set<string>()
const rows: { t: string; type: string; file: string; rel: string }[] = []
for (const f of files) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
  } catch {
    continue
  }
  for (const s of r?.symbols ?? []) byName.add(String(s.name))
  const rel = f.slice(CR.length + 1)
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) rows.push({ t, type: String(e?.type ?? ""), file: f, rel })
  }
}

function shapeOf(t: string): string {
  if (t.startsWith("--")) return "CUSTOM-PROP"
  if (t.startsWith("$")) return "SCSS-VARIABLE"
  if (t.includes("/") || t.startsWith(".")) return "MODULE-SPECIFIER"
  if (/^[a-zA-Z][\w-]*(\.[\w-]+)*$/.test(t)) return "BARE-IDENT"
  return "OTHER"
}

const unresolved = new Set(rows.map((r) => r.t).filter((t) => !byName.has(t)))
const other = [...unresolved].filter((t) => shapeOf(t) === "OTHER")
const otherEdges = rows.filter((r) => other.includes(r.t) && !byName.has(r.t))

console.log(`scss OTHER-bucket probe — population find *.scss | sort | head -${COUNT}`)
console.log(`unresolved distinct targets ${unresolved.size}   of shape OTHER ${other.length}`)
console.log(`OTHER edges ${otherEdges.length}\n`)

// 1 + 2: by type, and the distinct name shapes
const byType = new Map<string, number>()
for (const e of otherEdges) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
console.log(`1. OTHER edges by relationship type: ${JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])))}`)

// what character makes it not an identifier
const byChar = new Map<string, number>()
for (const t of other) {
  const c = /[;{}() ]/.exec(t)?.[0] ?? "(none)"
  byChar.set(c === " " ? "space" : c, (byChar.get(c === " " ? "space" : c) ?? 0) + 1)
}
console.log(`2. disqualifying first character: ${JSON.stringify(Object.fromEntries([...byChar].sort((a, b) => b[1] - a[1])))}`)
console.log(`   contains ';'  : ${other.filter((t) => t.includes(";")).length}`)
console.log(`   contains ' '  : ${other.filter((t) => t.includes(" ")).length}`)
console.log(`   is exactly '--': ${other.filter((t) => t === "--").length}`)
console.log(`   starts with '%': ${other.filter((t) => t.startsWith("%")).length}   <- @extend placeholder`)
console.log(`   starts with '.': ${other.filter((t) => t.startsWith(".")).length}`)

// ── THE SPLIT THAT DECIDES THE REPAIR ────────────────────────────────────────────
// `OTHER` is not one population. A `%`-prefixed name is not classifiable by the
// BARE-IDENT regex (which requires a leading letter), so every well-formed `%placeholder`
// target lands in OTHER too — and those are NOT fabrications. The defect is only the subset
// whose text carries a statement delimiter, which no selector can contain.
//
// Reading "81 unresolved OTHER targets" as "81 fabrications" overstates the defect by an
// order of magnitude, so the two populations are separated here by the delimiter test,
// which is a property of the language (a CSS selector never contains `;` `{` or `}`)
// rather than by the shape regex.
const FABRICATED = /[;{}]/
const fabTargets = other.filter((t) => FABRICATED.test(t))
const fabEdges = otherEdges.filter((e) => FABRICATED.test(e.t))
const wellFormed = other.filter((t) => !FABRICATED.test(t))
console.log(`\n2b. THE SPLIT — a CSS selector never contains ';' '{' or '}'`)
console.log(`   FABRICATED (target carries a statement delimiter): ${fabTargets.length} targets / ${fabEdges.length} edges`)
console.log(`   WELL-FORMED but unresolved (%placeholder declared elsewhere): ${wellFormed.length} targets / ${otherEdges.length - fabEdges.length} edges`)
for (const [ty, c] of [...new Set(fabEdges.map((e) => e.type))].map((k) => [k, fabEdges.filter((e) => e.type === k).length] as [string, number])) {
  console.log(`     fabricated by type ${ty}: ${c}`)
}

// For the WELL-FORMED half: does any corpus file declare the placeholder? An `@extend %x`
// naming a `%x` that exists is an unresolved edge because of the WINDOW; naming one that
// exists nowhere is the writer's own broken reference, which the analyzer cannot fix and
// should not pretend to.
// POSIX ERE has no `\s` — `grep -E '^\s*%'` matches nothing at all and every placeholder
// then reads as "declared nowhere". `[[:space:]]` is the portable spelling. CONTROL below
// re-runs the same grep against a name the window publishes, so a silent 0 is detectable.
const REPOS = execFileSync("bash", ["-lc", `ls -1 ${CR}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
/** every `%placeholder` declaration anywhere in the corpus, as raw text */
const declared = new Set<string>()
let grepOk = false
for (const repo of REPOS) {
  let list: string
  try {
    list = execFileSync(
      "bash",
      ["-lc", `grep -rhoE '^[[:space:]]*%[-_[:alnum:]]+' ${CR}/${repo} --include='*.scss' 2>/dev/null | tr -d ' \\t'`],
      { encoding: "utf8", maxBuffer: 1 << 28 },
    )
  } catch {
    continue
  }
  for (const line of list.split("\n")) {
    // NOT `[-_[:alnum:]]` in JS: a JS class of that spelling contains the letters a,l,n,u,m
    // only, so `%anim-3d` fails on `i` and every placeholder reads as undeclared. `\w` is the
    // set the grep side already matched.
    const m = /^%[-\w]+$/.exec(line)
    if (m) {
      declared.add(m[0])
      grepOk = true
    }
  }
}
const wfInWindow = wellFormed.filter((t) => byName.has(t))
const wfOutWindow = wellFormed.filter((t) => !byName.has(t) && declared.has(t))
const wfNowhere = wellFormed.filter((t) => !byName.has(t) && !declared.has(t))
console.log(`\n2c. the WELL-FORMED half, against all ${REPOS.length} corpus repos`)
console.log(`   CONTROL — grep matched at least one declaration: ${grepOk}`)
console.log(`   distinct %placeholders declared corpus-wide ${declared.size}   ${JSON.stringify([...declared].slice(0, 4))}`)
console.log(`   resolving in the window  ${wfInWindow.length}`)
console.log(`   declared OUTSIDE the window ${wfOutWindow.length}  <- window artefact, not a defect   ${JSON.stringify(wfOutWindow.slice(0, 5))}`)
console.log(`   declared NOWHERE in the corpus ${wfNowhere.length}  <- the stylesheet's own dangling @extend  ${JSON.stringify(wfNowhere.slice(0, 5))}`)

// 4: THE COUNTERFACTUAL — is the fragment before the first ';' a published name?
console.log(`\n4. counterfactual: is target.split(';')[0].trim() a published name?`)
const trimmed = other.map((t) => t.split(";")[0].trim())
const trims = trimmed.filter((x) => x.length > 0)
const trimsPublished = trims.filter((x) => byName.has(x))
console.log(`   OTHER targets ${other.length}   non-empty first fragments ${trims.length}`)
console.log(`   first fragment IS published: ${trimsPublished.length} (${Math.round((100 * trimsPublished.length) / (trims.length || 1))}%)  <- trimming recovers these`)
console.log(`   first fragment NOT published: ${trims.length - trimsPublished.length}  <- no referent exists for these`)
console.log(`   examples published  ${trimsPublished.slice(0, 8).map((s) => JSON.stringify(s)).join(" ")}`)
console.log(`   examples unpublished ${trims.filter((x) => !byName.has(x)).slice(0, 8).map((s) => JSON.stringify(s)).join(" ")}`)

// 3: source text at the emitter, for the first MAX distinct targets
console.log(`\n3. source text for ${Math.min(MAX, other.length)} of ${other.length} distinct OTHER targets:`)
const seen = new Set<string>()
let shown = 0
for (const e of otherEdges) {
  if (seen.has(e.t)) continue
  seen.add(e.t)
  if (shown++ >= MAX) break
  const text = readFileSync(e.file, "utf8")
  const lines = text.split("\n")
  // find the line carrying the target's leading fragment
  const frag = e.t.split(";")[0].trim().replace(/^%|^\./, "")
  const li = lines.findIndex((l) => frag.length > 3 && l.includes(frag.slice(0, 18)))
  console.log(`\n   target ${JSON.stringify(e.t)}`)
  console.log(`   type ${e.type}   file ${e.rel}`)
  if (li >= 0) {
    for (let k = Math.max(0, li - 1); k <= Math.min(lines.length - 1, li + 2); k++) {
      console.log(`     ${String(k + 1).padStart(5)} | ${lines[k].slice(0, 150)}`)
    }
  } else console.log(`     (leading fragment not located in the file text)`)
}

// CONTROL: the probe must be able to see a well-formed name of the same family, or
// "not published" above means nothing. `%`-placeholder extends are such a family.
console.log(`\nCONTROL — %-placeholder targets that DO resolve (probe liveness):`)
const pctAll = [...new Set(rows.filter((r) => r.t.startsWith("%")).map((r) => r.t))]
const pctOk = pctAll.filter((t) => byName.has(t))
console.log(`   distinct %-targets ${pctAll.length}   resolving ${pctOk.length}   ${JSON.stringify(pctOk.slice(0, 6))}`)
console.log(`   distinct --custom-prop targets ${new Set(rows.filter((r) => r.t.startsWith("--")).map((r) => r.t)).size}   resolving ${[...new Set(rows.filter((r) => r.t.startsWith("--")).map((r) => r.t))].filter((t) => byName.has(t)).length}`)
