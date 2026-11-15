/**
 * MARKDOWN SPEC SURFACE CHECK — section A's invariant, measured against the PINNED GRAMMARS.
 *
 * ## Why
 *
 * `script/m14/spec/markdown-completeness.json` opens with a tally: how many distinct NAMED node
 * types the two pinned wasms produce, and how many of them sit in each bucket. That tally is the
 * file's own claim that its classification is COMPLETE — "Silence is guilt: a type in no bucket
 * fails section A" — and nothing measured it. On 2026-10-09 the tally read
 * `29 handled_verified + 39 internal_silent + 2 gap = 70` while the arrays actually held
 * 30 + 42 + 0 = 72 rows. A completeness document whose own completeness sentence is stale is the
 * failure it exists to catch, so this script measures it.
 *
 * ## What it measures
 *
 *   1. the named-type surface of each pinned wasm, from the grammar's OWN symbol table
 *      (`nodeTypeCount` / `nodeTypeIsNamed` / `nodeTypeForId`) and the sha256 of each file, so a
 *      denominator that has drifted from its pin is visible;
 *   2. the union, and the names shared between block and inline;
 *   3. the spec's buckets, the names in more than one bucket, names no grammar produces, and —
 *      the one that decides COMPLETENESS — names the surface produces that NO bucket classifies.
 *
 * `ERROR` and `MISSING` are reported separately: tree-sitter synthesises both into every tree and
 * neither is a production of the grammar's symbol table, so a bucket may hold them without the
 * surface check calling it a stale row.
 *
 * ## The control
 *
 * A classification check that has only ever said "complete" is not evidence. `--self-test` (run
 * automatically) drops one name from the buckets and duplicates another, and requires the SAME
 * code to report both — uncovered 1, duplicates 1. If the control does not fire the script exits
 * non-zero, because then the real verdict is a statement about the check rather than the spec.
 *
 * Usage: bun validation/m14/fixtures/markdown/spec-surface-check.ts
 */
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")
const SPEC = path.join(REPO, "script/m14/spec/markdown-completeness.json")
const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex")

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(REPO, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const load = async (file: string) => Language.load(readFileSync(path.join(REPO, "wasm", file)))
const namedOf = (g: any): Set<string> => {
  const s = new Set<string>()
  for (let i = 0; i < g.nodeTypeCount; i++) if (g.nodeTypeIsNamed(i)) s.add(g.nodeTypeForId(i))
  return s
}
const block = namedOf(await load("tree-sitter-markdown.wasm"))
const inline = namedOf(await load("tree-sitter-markdown_inline.wasm"))
const union = new Set<string>([...block, ...inline])
const shared = [...block].filter((n) => inline.has(n))

const spec = JSON.parse(readFileSync(SPEC, "utf8"))
const buckets = {
  handled_verified: spec.handled_verified.types as string[],
  internal_silent: spec.internal_silent.types as string[],
  gap: (spec.gap.gaps as any[]).map((x) => x.node_type as string),
}
const rows = [...buckets.handled_verified, ...buckets.internal_silent, ...buckets.gap]
const covered = new Set(rows)
/** The one place the verdict is computed, so the control exercises the same code the run does. */
const analyse = (bucketRows: string[], surface: Set<string>) => {
  const all = [...bucketRows]
  const duplicates = [...new Set(all.filter((x, i) => all.indexOf(x) !== i))]
  const notInGrammar = [...new Set(all.filter((x) => !surface.has(x)))].sort()
  const uncovered = [...surface].filter((x) => !all.includes(x)).sort()
  return { duplicates, notInGrammar, uncovered }
}
const real = analyse(rows, union)

// ─────────────────────────────────────────────────────────── the control
const CONTROL_A = union.has("document") ? "document" : [...union][0]
const CONTROL_B = rows[0]
const control = analyse([...rows.filter((x) => x !== CONTROL_A), CONTROL_B], union)
const controlFired = control.uncovered.length === 1 && control.uncovered[0] === CONTROL_A && control.duplicates.length === 1 && control.duplicates[0] === CONTROL_B

// ─────────────────────────────────────────────────────────── report
const pins = JSON.parse(readFileSync(path.join(REPO, "validation/m14/grammar-pins.json"), "utf8"))
const pinOf = (file: string) => {
  const md = pins?.lanes?.markdown ?? pins?.markdown
  if ((md?.wired?.file ?? "") === `wasm/${file}`) return md.wired.sha256
  const c = (md?.copies ?? []).find((x: any) => String(x.path ?? "").endsWith(file))
  return c?.sha256 ?? null
}
console.log("markdown spec surface check — section A's completeness claim, measured")
console.log(`block  ${block.size} named types  ${sha256(readFileSync(path.join(REPO, "wasm/tree-sitter-markdown.wasm"))).slice(0, 16)}  pin ${(pinOf("tree-sitter-markdown.wasm") ?? "?").slice(0, 16)}`)
console.log(`inline ${inline.size} named types  ${sha256(readFileSync(path.join(REPO, "wasm/tree-sitter-markdown_inline.wasm"))).slice(0, 16)}  pin ${(pinOf("tree-sitter-markdown_inline.wasm") ?? "?").slice(0, 16)}`)
console.log(`shared ${shared.length} (${shared.join(" ")})   union ${union.size}`)
console.log("")
console.log(`spec buckets: handled_verified ${buckets.handled_verified.length} + internal_silent ${buckets.internal_silent.length} + gap ${buckets.gap.length} = ${rows.length} rows`)
console.log(`names in more than one bucket: ${real.duplicates.length === 0 ? "none" : real.duplicates.join(",")}`)
console.log(`bucket names neither grammar's symbol table produces: ${real.notInGrammar.length === 0 ? "none" : real.notInGrammar.join(",")}  (tree-sitter synthesises ERROR/MISSING into every tree; they are not productions)`)
console.log(`SURFACE NAMES NO BUCKET CLASSIFIES ("silence is guilt"): ${real.uncovered.length === 0 ? "none" : real.uncovered.join(",")}`)
console.log(`control (drop ${CONTROL_A}, duplicate ${CONTROL_B}): ${controlFired ? `FIRES — uncovered ${control.uncovered.join(",")}, duplicates ${control.duplicates.join(",")}` : "DID NOT FIRE"}`)
const verdict = real.uncovered.length === 0 && real.duplicates.length === 0 && controlFired
console.log(`\nVERDICT: ${verdict ? "classification is COMPLETE over the union" : "FAILS — see above"}`)
process.exitCode = verdict ? 0 : 1
