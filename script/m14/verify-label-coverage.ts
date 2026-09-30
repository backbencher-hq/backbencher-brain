/**
 * verify-label-coverage — the gate that makes the allowlist gap VISIBLE.
 *
 * ## The defect this exists to catch
 *
 * `differential.ts` filters the analyzer's relationships through a per-language
 * allowlist before comparing them to truth. A label the analyzer emits and the
 * allowlist omits is therefore compared by NOTHING, and the lane's reported
 * percentage does not know it: the dropped rows never enter either the matched or
 * the unexplained bucket. The lane reads as if its whole output were audited.
 *
 * That is not hypothetical. `scala` published 41.6% of its relationship output
 * that way — `contains`, `uses` and `references` — for its entire life, and the
 * lane read a clean 100% throughout. The three labels hid, among other things, a
 * calls-target defect where expressions were published as symbol names (42 rows,
 * mirrored by the oracle, so no gate could see it). See
 * `reviews/scala/m60-deep-review-2026-09-30.md`.
 *
 * This sweep says the same defect is not a scala story: 22 of 34 lanes emit at
 * least one label the allowlist drops, and `go` publishes 62.9% of its edges
 * unaudited at a 20-file sample. Every one of those edges is invisible to the
 * number the lane publishes about itself.
 *
 * ## What counts as a pass
 *
 * An emitted label is covered when the allowlist admits it, OR when the lane's
 * own spec DECLARES it at `label_coverage.declared_gaps[]` with a reason. A
 * declaration is not an excuse: it puts the gap in the lane's reviewed record,
 * next to the design decisions, where a reader sees it. An UNDECLARED gap is the
 * failure this gate exists to produce.
 *
 * ## What it deliberately does not do
 *
 * It does NOT judge whether the admitted labels are compared CORRECTLY — that is
 * the differential's job. It does not assert an absence: a label absent from a
 * sample is reported as `not seen`, never as `absent`. And it copies nothing: the
 * allowlist expression is EXTRACTED from `differential.ts` and evaluated, the lane
 * table and corpus pins are IMPORTED, and the emitted-label side is MEASURED by
 * running each analyzer. A hand-kept copy of any of those three would drift from
 * the thing under test and make this gate a liar.
 *
 * ## Coverage limit — declared, not implied
 *
 * The emitted-label census is a SAMPLE of `--files` files per lane (default 25),
 * deterministically the first N in sorted path order, which biases toward
 * alphabetically early files. It can only find a label the sampled files happen to
 * produce. `--files 0` walks each lane's whole corpus and is the run that
 * justifies the word "none"; a sampled run justifies only "none in the sample".
 *
 * Usage: npx tsx script/m14/verify-label-coverage.ts [--files N] [--lang L] [--json]
 */

import fs from "node:fs"
import path from "node:path"
import { LANGS, LANG_REPOS, LANG_REPOS_SECOND } from "./differential"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..")
const SPEC_DIR = path.join(ROOT, "script/m14/spec")
const CORPUS_ROOT = "$HOME/fixtures/repositories"

// ── the allowlist, EXTRACTED and EVALUATED, never copied ─────────────────────
function extractAllowlistExpr(src: string): string {
  const MARK = '.filter((r: any) => ["extends", "implements", "instantiates"'
  const at = src.indexOf(MARK)
  if (at < 0) throw new Error("allowlist marker not found — differential.ts changed shape")
  const bodyStart = src.indexOf("=>", at) + 2
  let depth = 0
  let inStr: string | null = null
  let inLine = false
  let inBlock = false
  for (let i = bodyStart; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === "\n") inLine = false; continue }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++ } continue }
    if (inStr) { if (c === "\\") { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === "/" && n === "/") { inLine = true; i++; continue }
    if (c === "/" && n === "*") { inBlock = true; i++; continue }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue }
    if (c === "[" || c === "(" || c === "{") { depth++; continue }
    if (c === "]" || c === ")" || c === "}") {
      depth--
      if (depth === 0 && c === "]") return src.slice(bodyStart, i + 1)
    }
  }
  throw new Error("allowlist expression end not found")
}

function walkFiles(dir: string, exts: string[], cap: number): string[] {
  const out: string[] = []
  const stack: string[] = [dir]
  while (stack.length && out.length <= cap) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "target" ||
          e.name === "dist" || e.name === "build" || e.name === "vendor") continue
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  return out.sort().slice(0, cap)
}

type Gap = { label: string; declared: boolean; reason?: string; emitted: number }
type Row = { lang: string; corpus: string; files: number; errors: number; total: number; gaps: Gap[]; seen: string[] }

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const argNum = (k: string, d: number) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d }
  const only = argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1] : null
  const files = argNum("--files", 25)
  const wantJson = argv.includes("--json")

  const diffSrc = fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8")
  const EXPR = extractAllowlistExpr(diffSrc)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const rows: Row[] = []
  const skipped: { lang: string; why: string }[] = []
  const langs = Object.keys(LANGS).filter((l) => !only || l === only).sort()

  for (const lang of langs) {
    const cfg = LANGS[lang] as any
    const corpus = LANG_REPOS[lang] ?? LANG_REPOS_SECOND[lang]
    if (!corpus) { skipped.push({ lang, why: "no corpus pin" }); continue }
    const wasmPath = path.join(ROOT, "wasm", cfg.wasm)
    if (!fs.existsSync(wasmPath)) { skipped.push({ lang, why: `wasm missing: ${cfg.wasm}` }); continue }
    const specPath = path.join(SPEC_DIR, `${lang}-completeness.json`)
    const spec: any = fs.existsSync(specPath) ? JSON.parse(fs.readFileSync(specPath, "utf8")) : {}
    const declared = new Map<string, string>(
      (spec?.label_coverage?.declared_gaps ?? []).map((g: any) => [g.label, g.reason ?? ""]),
    )
    const exts = String(cfg.ext ?? "").split(",").map((e) => `.${e.trim()}`).filter((e) => e !== ".")
    const cap = files === 0 ? Number.MAX_SAFE_INTEGER : files
    const list = walkFiles(path.join(CORPUS_ROOT, corpus), exts, cap)
    if (!list.length) { skipped.push({ lang, why: `no files under ${corpus}` }); continue }

    const gl = await L.load(fs.readFileSync(wasmPath))
    const parser = new P()
    parser.setLanguage(gl)
    const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
    const Cls = mod[cfg.className]
    if (!Cls) { skipped.push({ lang, why: `${cfg.className} not exported` }); continue }
    const analyzer = new Cls()

    const emitted = new Map<string, number>()
    let ok = 0
    let errs = 0
    for (const f of list) {
      let root: any
      const src = fs.readFileSync(f, "utf8")
      try { root = parser.parse(src).rootNode } catch { errs++; continue }
      let res: any
      try { res = analyzer.analyze(root, src, f) } catch { errs++; continue }
      ok++
      for (const r of res.relationships ?? []) {
        const t = String(r.type ?? r.relationshipType ?? "")
        if (t) emitted.set(t, (emitted.get(t) ?? 0) + 1)
      }
    }

    const allow = new Set<string>(new Function("lang", `return ${EXPR}`)(lang) as string[])
    const gaps: Gap[] = []
    for (const [label, n] of [...emitted].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (allow.has(label)) continue
      const isDecl = declared.has(label)
      gaps.push({ label, declared: isDecl, reason: isDecl ? declared.get(label) : undefined, emitted: n })
    }
    // A declared gap whose label the sample never produced is reported too, so a
    // declaration cannot outlive the thing it describes without anyone noticing.
    for (const [label, reason] of declared) {
      if (!emitted.has(label)) gaps.push({ label, declared: true, reason, emitted: 0 })
    }
    const total = [...emitted.values()].reduce((a, b) => a + b, 0)
    rows.push({ lang, corpus, files: ok, errors: errs, total, gaps, seen: [...emitted.keys()].sort() })
  }

  const undeclared = rows.flatMap((r) => r.gaps.filter((g) => !g.declared).map((g) => ({ ...g, lang: r.lang })))
  const undeclaredEdges = undeclared.reduce((a, g) => a + g.emitted, 0)

  if (wantJson) {
    console.log(JSON.stringify({ sampleFilesPerLane: files, rows, undeclared, undeclaredEdges, skipped }, null, 2))
    process.exit(undeclared.length ? 1 : 0)
  }

  const mode = files === 0 ? "FULL corpus walk" : `sample of ${files} files per lane`
  console.log(`# verify-label-coverage — ${mode}`)
  console.log(`# an emitted label the allowlist drops is compared by nothing; a gap the lane spec does not`)
  console.log(`# declare is the failure this gate exists to produce\n`)
  console.log("| lane | corpus | files | edges | covered | UNDECLARED gaps (edges unaudited) | declared gaps |")
  console.log("|---|---|---:|---:|---:|---|---|")
  for (const r of rows) {
    const bad = r.gaps.filter((g) => !g.declared)
    const dec = r.gaps.filter((g) => g.declared)
    const fmt = (gs: Gap[]) => gs.length
      ? gs.map((g) => `**${g.label}** (${g.emitted}${g.emitted === 0 ? ", not seen in sample" : ""})`).join(", ")
      : "—"
    console.log(`| ${r.lang} | ${r.corpus} | ${r.files} | ${r.total} | ${r.total - bad.reduce((a, g) => a + g.emitted, 0)} | ${fmt(bad)} | ${fmt(dec)} |`)
  }
  if (skipped.length) {
    console.log("\n# skipped (not a pass): " + skipped.map((s) => `${s.lang} (${s.why})`).join(", "))
  }
  console.log("")
  if (undeclared.length === 0) {
    console.log("PASS — every emitted label is either compared by the differential or declared in its lane spec.")
  } else {
    console.log(`FAIL — ${undeclared.length} undeclared gap(s) across ${new Set(undeclared.map((g) => g.lang)).size} lane(s); ${undeclaredEdges} edges compared by nothing.`)
    console.log("      Each needs either an allowlist entry (if truth exists) or a spec declaration with a reason:")
    for (const g of undeclared) console.log(`        - ${g.lang}/${g.label}: ${g.emitted} edges unaudited`)
  }
  process.exit(undeclared.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })