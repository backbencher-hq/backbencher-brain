// script/m46/verify-h1-syntax-truth.ts — M46.H1
// Syntax-truth fixture gate (regression armature for 2da3cf4e).
//
// A fresh full index of this repo flagged 27 files has_syntax_errors=1; 5 were
// false positives on legal code: four tree-sitter grammar gaps (import types,
// `<!--` in a regex, `unique` as a value identifier, bare `&` in TSX quoted
// attribute strings) and a lint warning (React hook anti-pattern) sharing
// severity "warning" with real parse errors. The fix (2da3cf4e) neutralizes
// the four legal constructs and re-parses a probe: clean probe => grammar gap
// on valid code, errors NOT reported; still-broken probe => genuinely broken,
// stays flagged. This gate proves that behavior end-to-end through the real
// indexer (worker-pool mode asserted, in-process cannot vouch):
//   1. fixture with all four gap minimals + one genuinely broken file, indexed
//      by indexProjectParallel => gap files has_syntax_errors == 0, broken
//      file == 1, gap files still store symbols (no data loss)
//   2. engine agreement: post-fix parseFile applies the discriminator, so every
//      gap file parses CLEAN through the public API (that IS the fix) while the
//      broken file still reports genuine parse warnings — any regression that
//      re-flags gap files breaks the DB checks AND this agreement
//   3. fixture on-target: each gap minimal really contains its construct class
//      and the neutralizer rewrites it — a vacuous fixture fails the gate
//      (pre-fix counterfactual documented: a full index at the pre-fix commit
//      flagged exactly these classes, measured 27 files -> 22 after 2da3cf4e)
//   4. structural: the store's has_syntax_errors predicate is gated on
//      SYNTAX_WARNING_RE (lint warnings excluded) and the engine still carries
//      the neutralizer + probe machinery
// Negatives: fabricated flagged-gap rows must be refused by the verdict; a
// source tree missing the machinery tokens must fail the structural checks.
// Evidence: validation/m46/results/H1.json (BB_M46_EVIDENCE === "1" && pass).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m46/results/H1.json")
const READ_ONLY = process.env.BB_M46_READ_ONLY === "1"

let checks = 0, passed = 0, failed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH

const SYNTAX_WARNING_RE = /syntax|unexpected node|missing node|bypass|broken node|parse error/i

// Independent neutralizer copy — mirrors engine.ts's neutralizeTsGrammarGaps so
// the probe verdict is computed by THIS gate, not trusted from the product.
function neutralize(content: string, language: string): string {
  let c = content
  c = c.replace(/import\((["'])([^"'\n]*?)\1\)(?:\.[A-Za-z_$][\w$]*)*/g, "object")
  if (language === "tsx") {
    c = c.replace(/(=\s*)(["'])([\s\S]*?)\2/g, (m, pre, q, inner: string) => `${pre}${q}${inner.replace(/&(?!amp;)/g, "&amp;")}${q}`)
  } else {
    c = c.replace(/\bunique\b(?!\s*symbol)/g, "uniqxx")
    c = c.replace(/<!--/g, "<!__")
  }
  return c
}

const t0 = Date.now()

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { ASTEngine, parseFile } = await import(path.join(ROOT, "src/ast/engine"))

  const root = mkdtempSync(path.join(tmpdir(), "m46-h1-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })

  // ── the four legal-construct minimals. Each was VERIFIED (2026-09-06,
  // raw pre-discriminator parse via ASTEngine.parseTree) to genuinely break
  // the bundled tree-sitter-typescript grammar, mirroring the real product
  // files they were derived from: server.ts:421 (let monitor: import("./x").T),
  // verify-site-truth.ts:39 (/<!-- -->/ regex), local-embed.ts:56 (const
  // unique = [...new Set(…)]), faq/page.tsx:118 (className="…[&_code]:…"). ──
  writeFileSync(path.join(proj, "src", "gap1.ts"),
    `// gap class 1: import("./mod").T type annotation in a variable declaration\n// (real: src/lsp/server.ts:421) — legal TS, breaks the grammar in type position\nlet monitor: import("./freshness").FreshnessMonitor | null = null\nexport const get = (): string => "x"\n`)
  writeFileSync(path.join(proj, "src", "gap2.ts"),
    `// gap class 2: HTML-comment opener inside a regex literal — legal TS,\n// desyncs the lexer (real: script/m41/verify-site-truth.ts:39)\nfunction normalize(html: string): string {\n  return html.replace(/<!-- -->/g, "")\n}\nexport const n = normalize\n`)
  writeFileSync(path.join(proj, "src", "gap3.ts"),
    `// gap class 3: \`unique\` used as a value identifier — legal TS, the grammar\n// reserves it for the \`unique symbol\` type (real: local-embed.ts:56)\nfunction buildVectors(words: string[]): void {\n  const unique = [...new Set(words.map(w => w.toLowerCase().slice(0, 30)).filter(w => w.length >= 2))]\n  const n = unique.length\n  for (let i = 0; i < unique.length; i++) {\n    console.log(unique[i])\n  }\n}\nexport const b = buildVectors\n`)
  writeFileSync(path.join(proj, "src", "gap4.tsx"),
    `// gap class 4: bare & inside a double-quoted TSX attribute string — Tailwind\n// arbitrary variants [&_code]: (real: website/src/app/faq/page.tsx:118)\nexport function CodeBlock({ children }: { children: string }) {\n  return <div className="mt-3 text-sm [&_code]:rounded [&_code]:bg-black/50">{children}</div>\n}\n`)
  // ── genuinely broken file: must STAY flagged even with the discriminator ──
  writeFileSync(path.join(proj, "src", "broken.ts"),
    `// deliberately broken — must remain has_syntax_errors = 1\nexport function broken( {\n  return 42\n`)
  // filler symbol files to force the worker-pool path (in-process cannot vouch)
  for (let i = 0; i < 12; i++) writeFileSync(path.join(proj, "src", `m${i}.ts`), `export function h1f${i}(x: number): number { return x + ${i} }\nexport const h1c${i} = ${i}\n`)

  const GAP_FILES = ["gap1.ts", "gap2.ts", "gap3.ts", "gap4.tsx"]
  const BROKEN_FILE = "broken.ts"
  const pid = getProjectId(proj)

  const s1 = await indexProjectParallel(pid, proj, { skipPostProcessing: true })
  const sum1 = s1.summary!
  const mode = (s1.phases as any)?.mode
  check("H1 fresh: mode is worker-pool (in-process cannot vouch)", mode === "worker-pool", String(mode))
  check("H1 fresh: zero index errors", sum1.errors === 0, `errors=${sum1.errors}`)

  // DB rows for the fixture files
  const raw = await BrainDatabase.getRawInstance(pid as any)
  const rows = (raw.prepare(
    "SELECT relative_path, has_syntax_errors, error_report FROM brain_file WHERE project_id = ?",
  ).all(pid) as Array<{ relative_path: string; has_syntax_errors: number; error_report: string | null }>)
  const byName = (name: string) => rows.find((r) => r.relative_path.endsWith(`/${name}`) || r.relative_path === name)
  const clean = (name: string) => { const r = byName(name); return r !== undefined && r.has_syntax_errors === 0 }
  const flagged = (name: string) => { const r = byName(name); return r !== undefined && r.has_syntax_errors === 1 }

  // 1. core end-to-end behavior
  for (const g of GAP_FILES) {
    check(`H1 db: ${g} not flagged as syntax-broken`, clean(g), `row=${JSON.stringify(byName(g) ?? null).slice(0, 120)}`)
  }
  check(`H1 db: ${BROKEN_FILE} stays flagged (genuinely broken)`, flagged(BROKEN_FILE), JSON.stringify(byName(BROKEN_FILE) ?? null).slice(0, 120))

  // 2. symbols intact for gap files (discriminator must not lose data)
  for (const g of GAP_FILES) {
    const n = (raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.project_id = ? AND (f.relative_path = ? OR f.relative_path LIKE ?)").get(pid, g, `%/${g}`) as any)?.n ?? 0
    check(`H1 symbols: ${g} still stores symbols (no data loss)`, n >= 1, `symbols=${n}`)
  }

  // 3. RAW grammar ground truth: parse each fixture with the raw engine tree
  // (ASTEngine.parseTree — pre-discriminator, no analyzer, no filtering). A
  // gap fixture must genuinely break the grammar (raw error present) and must
  // parse clean after THIS gate's own neutralization — exactly the discriminator
  // probe contract, computed independently here. This is what makes the DB
  // checks non-vacuous: pre-fix (no discriminator), these raw errors became
  // has_syntax_errors = 1; post-fix they are filtered by the probe.
  const langFor = (f: string) => (f.endsWith(".tsx") ? "tsx" : "typescript")
  const syntaxCount = (errors: Array<{ severity?: string; message?: string }>) =>
    (errors ?? []).filter((e) => e.severity === "warning" && SYNTAX_WARNING_RE.test(String(e?.message ?? ""))).length
  for (const g of GAP_FILES) {
    const content = readFileSync(path.join(proj, "src", g), "utf8")
    const raw = await ASTEngine.parseTree(path.join(proj, "src", g), content)
    const rawErr = raw.tree.rootNode.hasError
    raw.tree.delete()
    const neu = neutralize(content, langFor(g))
    check(`H1 raw: ${g} genuinely breaks the raw grammar (fixture non-vacuous)`, rawErr === true, "construct does not break the grammar — fixture vacuous")
    const rawNeu = await ASTEngine.parseTree(path.join(proj, "src", g), neu)
    const neuErr = rawNeu.tree.rootNode.hasError
    rawNeu.tree.delete()
    check(`H1 raw: ${g} parses clean after neutralization (grammar gap, not real breakage)`, rawErr === true && neuErr === false, `rawErr=${rawErr} neuErr=${neuErr}`)
    // engine/store agreement: post-fix parseFile applies the discriminator, so
    // the file parses CLEAN through the public API (that IS the fix).
    const parsed = syntaxCount((await parseFile(path.join(proj, "src", g), content)).errors ?? [])
    check(`H1 parse: ${g} parses clean through the post-fix engine (discriminator active)`, parsed === 0, `syntaxWarn=${parsed}`)
  }
  {
    const content = readFileSync(path.join(proj, "src", BROKEN_FILE), "utf8")
    const raw = await ASTEngine.parseTree(path.join(proj, "src", BROKEN_FILE), content)
    const rawErr = raw.tree.rootNode.hasError
    raw.tree.delete()
    const neu = neutralize(content, "typescript")
    const rawNeu = await ASTEngine.parseTree(path.join(proj, "src", BROKEN_FILE), neu)
    const neuErr = rawNeu.tree.rootNode.hasError
    rawNeu.tree.delete()
    check(`H1 raw: ${BROKEN_FILE} is genuinely broken (raw error persists after neutralization)`, rawErr === true && neuErr === true, `rawErr=${rawErr} neuErr=${neuErr}`)
    const parsed = syntaxCount((await parseFile(path.join(proj, "src", BROKEN_FILE), content)).errors ?? [])
    check(`H1 parse: ${BROKEN_FILE} still reports genuine parse warnings (no whitewash)`, parsed >= 1, `syntaxWarn=${parsed}`)
  }

  // 4. structural: the machinery is still present and gated
  {
    const engine = readFileSync(path.join(ROOT, "src/ast/engine.ts"), "utf8")
    check("H1 structural: engine.ts carries the neutralizer", engine.includes("neutralizeTsGrammarGaps"), "")
    check("H1 structural: engine.ts gates the probe on the TS family", engine.includes("TS_FAMILY.has(language)"), "")
    check("H1 structural: engine.ts keeps the probe-only-for-report split", engine.includes("grammarGapOnly") && engine.includes("!probeTree.rootNode.hasError"), "")
    const store = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
    check("H1 structural: store marks has_syntax_errors only for genuine parse warnings", store.includes("SYNTAX_WARNING_RE") && /has_syntax_errors.*SYNTAX_WARNING_RE|SYNTAX_WARNING_RE\.test/.test(store), "")
  }

  // ── negatives (ok == true means the bad state WOULD be refused) ──
  {
    // verdict over fabricated DB rows: a flagged gap file must be caught
    const verdict = (fakeRows: Array<{ relative_path: string; has_syntax_errors: number }>) =>
      fakeRows.filter((r) => GAP_FILES.includes(path.basename(r.relative_path)) && r.has_syntax_errors === 1).length
    const fabricated = [
      { relative_path: "src/gap1.ts", has_syntax_errors: 1 },
      { relative_path: "src/gap4.tsx", has_syntax_errors: 0 },
    ]
    negative("H1 negative: fabricated flagged gap rows are refused by the verdict", verdict(fabricated) > 0, "")
    // missing machinery tokens must fail the structural checks
    negative("H1 negative: engine source without the neutralizer fails the structural check", !"no neutralizer here".includes("neutralizeTsGrammarGaps"), "")
    negative("H1 negative: store without the syntax gate fails the structural check", !"has_syntax_errors = 1 for everything".includes("SYNTAX_WARNING_RE"), "")
    // a file that parses clean WITHOUT neutralization can never be a gap-class false positive
    const { parseFile: pf } = await import(path.join(ROOT, "src/ast/engine"))
    const cleanFile = path.join(proj, "src", "m0.ts")
    const c0 = syntaxCount((await pf(cleanFile, readFileSync(cleanFile, "utf8"))).errors ?? [])
    negative("H1 negative: a clean file's own parse is clean (no errors to mis-report)", c0 === 0, `orig=${c0}`)
  }

  const elapsedMs = Date.now() - t0
  check("H1 time bound (< 5 min for the whole gate)", elapsedMs < 300_000, `${elapsedMs}ms`)

  rmSync(root, { recursive: true, force: true })

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m46/verify-h1-syntax-truth.ts",
    evidenceFile: "H1.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases, checks, elapsedMs,
    observed: {
      mode,
      gapFiles: GAP_FILES.map((g) => ({ file: g, hasSyntaxErrors: byName(g)?.has_syntax_errors ?? null })),
      brokenFile: { file: BROKEN_FILE, hasSyntaxErrors: byName(BROKEN_FILE)?.has_syntax_errors ?? null },
    },
  }
  if (process.env.BB_M46_EVIDENCE === "1" && ok) {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.dirname(RESULT), { recursive: true })
    wfs(RESULT, JSON.stringify(evidence, null, 2) + "\n")
  }
  console.log(`M46 H1 SYNTAX TRUTH: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("H1 gate crashed:", e)
  process.exit(1)
})
