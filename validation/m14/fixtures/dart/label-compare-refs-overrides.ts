/**
 * THE PER-LABEL COMPARISON THE HARNESS DOES NOT PRINT — dart `references` and `overrides`.
 *
 * WHY THIS EXISTS. `script/m14/differential.ts` scores a lane on two aggregates (`MISSING`,
 * `unexplained`) and prints a per-label breakdown of `unexplained` ONLY. So when the two labels
 * this lane emitted but never compared were wired into the comparison (2026-10-13), the run could
 * say "overrides=3 unexplained" and nothing at all about `references`: a label whose truth rows
 * the analyzer covers completely, and a label whose truth rows the harness never derived, produce
 * the SAME silence. The per-label numbers below are the ones that separate those two readings.
 *
 * It is deliberately NOT a re-implementation of the harness's matcher. The harness tolerates
 * FQN-vs-last-segment on targets; this joins on the exact `label|from|target` triple, which for
 * these two labels is the same rule — a type mention and an override target are both spelled as
 * the source spells them, with no dotted FQN to fold. Where the two would disagree, this is the
 * STRICTER instrument, so a clean row here cannot be a tolerance artefact.
 *
 * THE VISIBLE SET IS BUILT THE WAY THE HARNESS BUILDS IT, which is the point of sharing the
 * index rather than each side building its own view: the analyzer's `visibleTypes` is this file's
 * declared types PLUS `projectIndex.typeKinds`, and the `references` oracle's default is the
 * per-file set alone. Handing the oracle the narrower set would report every cross-file mention
 * the analyzer correctly publishes as FABRICATED — a disagreement about the harness, not the lane.
 *
 * CONTROLS RUN BEFORE ANY CORPUS FILE IS READ, because a joiner that cannot match reports 0
 * missing and 0 unexplained on any input and reads exactly like agreement.
 *
 * Run: npx tsx validation/m14/fixtures/dart/label-compare-refs-overrides.ts [repo] [sample] [stride]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { buildProjectIndexStreaming, buildResolutionTables, DART_DECLARATION_SPEC } from "../../../../src/ast/project-index"
import { deriveDartReferencesTruth, dartTypesDeclaredIn } from "../../../../script/m14/oracles/dart-references"
import { deriveDartOverridesTruth } from "../../../../script/m14/oracles/dart-overrides"
import { RealDartAnalyzer } from "../../../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] ?? "dart-http"
const SAMPLE = Number(process.argv[3] ?? 120)
const STRIDE = Number(process.argv[4] ?? 0)
const DIR = path.join(CR, REPO)

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

let cachedParser: any = null
async function parserFor(): Promise<any> {
  if (cachedParser) return cachedParser
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  cachedParser = parser
  return parser
}

type Tally = { truth: number; analyzer: number; agreed: number; missing: string[]; unexplained: string[] }
const newTally = (): Tally => ({ truth: 0, analyzer: 0, agreed: 0, missing: [], unexplained: [] })

/** One source, both sides, joined exactly. `index` supplies the widened visible set when given. */
async function compare(src: string, at: string, index: any): Promise<Map<string, Tally>> {
  const parser = await parserFor()
  const tree = parser.parse(src)
  const label = path.basename(at, path.extname(at))

  const visible = new Set<string>(dartTypesDeclaredIn(tree.rootNode))
  for (const t of index?.typeKinds?.keys?.() ?? []) visible.add(String(t))
  const closed: Map<string, Set<string>> | undefined = index?.__closedMembers ?? undefined

  const truth = [
    ...deriveDartReferencesTruth(tree.rootNode, visible, label),
    ...deriveDartOverridesTruth(tree.rootNode, closed),
  ]
  const r: any = await new RealDartAnalyzer().analyze(
    tree.rootNode, src, at, index ? ({ projectIndex: index } as any) : undefined,
  )
  const WANT = new Set(["references", "overrides"])
  const analyzer = (r.relationships ?? [])
    .map((e: any) => ({ label: String(e.type ?? ""), from: String(e.source ?? e.from ?? ""), target: String(e.target ?? "") }))
    .filter((e: any) => WANT.has(e.label))

  const out = new Map<string, Tally>()
  for (const lab of WANT) out.set(lab, newTally())
  const key = (e: { label: string; from: string; target: string }) => `${e.label}|${e.from}|${e.target}`
  const tKeys = new Set(truth.map(key))
  const aKeys = new Set(analyzer.map(key))
  for (const lab of WANT) {
    const t = out.get(lab)!
    t.truth = [...tKeys].filter((k) => k.startsWith(`${lab}|`)).length
    t.analyzer = [...aKeys].filter((k) => k.startsWith(`${lab}|`)).length
    t.agreed = [...tKeys].filter((k) => k.startsWith(`${lab}|`) && aKeys.has(k)).length
    t.missing = [...tKeys].filter((k) => k.startsWith(`${lab}|`) && !aKeys.has(k))
    t.unexplained = [...aKeys].filter((k) => k.startsWith(`${lab}|`) && !tKeys.has(k))
  }
  return out
}

function merge(into: Map<string, Tally>, from: Map<string, Tally>): void {
  for (const [lab, t] of from) {
    const acc = into.get(lab) ?? newTally()
    acc.truth += t.truth; acc.analyzer += t.analyzer; acc.agreed += t.agreed
    acc.missing.push(...t.missing); acc.unexplained.push(...t.unexplained)
    into.set(lab, acc)
  }
}

async function main(): Promise<void> {
  // ── CONTROLS, on synthetic sources, before any corpus file is read ──────────────────────
  // A typed parameter mention and a plain override. Both sides must derive them; the joiner must
  // therefore report agreed > 0 for each label. A joiner that matched nothing would print a
  // spotless corpus table below whatever the corpus held, which is the failure this pins.
  const ctl = await compare(
    `class Base { void poke() {} }\nclass Element extends Base { void take(Element e) { } @override void poke() { } }\n`,
    "/tmp/label-compare-control.dart", null,
  )
  check("control: references agrees on a typed parameter", (ctl.get("references")?.agreed ?? 0) > 0,
    `truth=${ctl.get("references")?.truth} analyzer=${ctl.get("references")?.analyzer} agreed=${ctl.get("references")?.agreed}`)
  check("control: overrides agrees on an @override of an in-file base", (ctl.get("overrides")?.agreed ?? 0) > 0,
    `truth=${ctl.get("overrides")?.truth} analyzer=${ctl.get("overrides")?.analyzer} agreed=${ctl.get("overrides")?.agreed}`)

  // THE DISCRIMINATOR for the corpus finding below. `overrides` on a MIXIN-application base
  // (`class C with M`) disagreed on 4 rows of dart-http, every one of them a mixin declared in
  // ANOTHER file. One source cannot say whether the hole is "mixin bases" or "mixins reached
  // through the index", so this control puts the SAME shape in one file: if the oracle derives
  // this row, the hole is cross-file resolution; if it does not, the hole is the mixin base
  // itself. Either answer is a fact about the oracle, and neither is derivable from the corpus
  // rows alone.
  const mix = await compare(
    `mixin M { void poke() {} }\nclass C with M { @override void poke() {} }\n`,
    "/tmp/label-compare-mixin-control.dart", null,
  )
  console.log(`INFO  control: in-file ` + "`class C with M`" + ` override — overrides truth=${mix.get("overrides")?.truth} analyzer=${mix.get("overrides")?.analyzer} agreed=${mix.get("overrides")?.agreed}`)

  // ── THE POPULATION, AND THE FILE LIST IS A MEASURED CHOICE ─────────────────────────────
  //
  // The INDEX is built over a DIRECTORY WALK, not `git ls-files`, because that is the list the
  // harness indexes (`scan()` walks `repoDir` by extension) and the two are NOT the same list on
  // this repository. Measured: `git ls-files` gives 335 tracked `.dart` files, of which 333 are
  // <= 1 MB, and those 333 produce a 380-type index; the walk gives the same 335 files WITHOUT a
  // size filter and produces a **1,012-type** index. TWO files larger than 1 MB carry 632 of the
  // 1,012 type names — so a <= 1 MB index hides 62% of the type names this project has, and the
  // `references` gate reads exactly those names (`visibleTypes`). The probe mirrors the harness so
  // that its per-label numbers belong to the same comparison the gate scores; the SAMPLED files
  // keep the harness's per-file read cap, because that is a cost limit on the draw and not a
  // statement about the key space.
  const walked: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".dart")) walked.push(p)
    }
  }
  walk(DIR)
  const indexable = walked.sort()
  const readable = indexable.filter((f) => { try { return fs.statSync(f).size <= 1024 * 1024 } catch { return false } })
  const stride = STRIDE > 0 ? STRIDE : Math.max(1, Math.floor(readable.length / SAMPLE))
  const drawn = readable.filter((_, i) => i % stride === 0).slice(0, SAMPLE)
  console.log(`\nlabel compare — ${REPO}: ${indexable.length} walked .dart (${readable.length} <= 1 MB), stride ${stride} → ${drawn.length} sampled\n`)

  const index = await buildProjectIndexStreaming(
    path.join(ROOT, "wasm", "tree-sitter-dart.wasm"), indexable, DART_DECLARATION_SPEC,
  )
  buildResolutionTables(index)
  console.log(`project index: ${index.typeKinds?.size ?? 0} types over ${indexable.length} files (the harness's own list)\n`)

  const totals = new Map<string, Tally>()
  for (const f of drawn) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    merge(totals, await compare(src, f, index))
  }

  console.log("label       truth  analyzer  agreed  missing  unexplained".padEnd(60))
  for (const lab of ["references", "overrides"]) {
    const t = totals.get(lab)!
    console.log(`${lab.padEnd(11)} ${String(t.truth).padStart(5)} ${String(t.analyzer).padStart(9)} ${String(t.agreed).padStart(7)} ${String(t.missing.length).padStart(8)} ${String(t.unexplained.length).padStart(12)}`)
  }

  for (const lab of ["references", "overrides"]) {
    const t = totals.get(lab)!
    console.log(`\n${lab} — ${t.missing.length} missing / ${t.unexplained.length} unexplained`)
    for (const k of t.missing.slice(0, 8)) console.log(`  MISSING      ${k}`)
    for (const k of t.unexplained.slice(0, 8)) console.log(`  UNEXPLAINED  ${k}`)
  }

  // The labels are COMPARED (the point of the wiring) only if the population reached them at all:
  // a zero truth AND zero analyzer count means the population has no such edges, not that the two
  // sides agree, and those two states must not print the same table.
  for (const lab of ["references", "overrides"]) {
    const t = totals.get(lab)!
    check(`population: ${lab} is non-empty on both sides`, t.truth > 0 && t.analyzer > 0,
      `truth=${t.truth} analyzer=${t.analyzer}`)
  }
  console.log(failures === 0 ? "\nPASS — both labels compared, controls green" : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
