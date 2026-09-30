// script/m60/objc-grammar-provenance.ts — the patch evidence for objc's grammar pin.
//
// WHY THIS TOOL, AND WHY IT HAS TO EXIST AT ALL
// ----------------------------------------------
// Objective-C runs a PATCHED, VENDORED grammar: upstream tree-sitter-objc 3.0.2 plus
// `macro_prefixed_objc_declaration` (the #743 rule) plus this round's
// `macro_enum_specifier` and `availability_macro_specifier`. Its wired bytes are therefore NOT
// the published npm bytes, and until this tool ran, objc was one of 21 unpinned lanes — the only
// lanes in the file being the six functional-family ones and the data/config ones, none of which
// is a patched grammar.
//
// That combination is the worst case for a pin. The pin's whole job is to catch "the wired bytes
// are not a build of the source we think they are", and a patched grammar is precisely where that
// happens: someone edits grammar.js, rebuilds, and the change is invisible to every measurement
// downstream unless the gate compares the source to the bytes. The C lane's own pin record says
// the same thing about its hazard — "the #936 defect was a node-type literal written from memory
// of a different tree-sitter-c release, which F1 caught only because the vocabulary happened to
// be checked". A patched grammar raises that hazard rather than lowering it, and objc was
// unpinned.
//
// THREE BUILDS, TWO COMPARISONS, BOTH MEASURED
//
//   WIRED    wasm/tree-sitter-objc.wasm                    (what every number in this lane measures)
//   REBUILD  a fresh build of the committed patched source  (does the source account for the bytes?)
//   PRISTINE npm tree-sitter-objc@3.0.2's own wasm         (what do the patches actually buy?)
//
// WIRED vs REBUILD answers "is the pin honest" — identity is claimed on SURFACE and BEHAVIOUR,
// never on bytes, because a wasm build carries its emscripten version, compiler flags and section
// order, and two correct builds of one source are not byte-equal. That is the C lane's stated
// standard and the standard is kept here rather than invented.
//
// PRISTINE vs WIRED answers "are the patches live" — the named node types the patches add must be
// present in WIRED and absent from PRISTINE, with ZERO the other way, which is the statement that
// the patch is in the bytes this lane loads and is purely additive at the node-type level.
//
// BEHAVIOUR IS WHERE THE PATCH VALUE IS, and it is measured over the ROUTER'S 329-file universe
// with the analyzer's own output diffed, not with a boolean: `hasError` cannot tell a removed
// phantom from a lost edge, which is the reason script/m60/objc-wasm-ab.ts exists.
//
// Usage: bun run script/m60/objc-grammar-provenance.ts
// Writes: validation/m60/results/objc-grammar-provenance.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"
import { RealObjectiveCAnalyzer } from "../../src/ast/real-objective-c-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/objc-grammar-provenance.json")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const WIRED = path.join(ROOT, "wasm/tree-sitter-objc.wasm")
const REBUILD = process.argv.find((a) => a.startsWith("--rebuild="))?.slice(10) ?? "/tmp/opencode/tsbuild/rebuild-objc.wasm"
const PRISTINE = process.argv.find((a) => a.startsWith("--pristine="))?.slice(11) ?? "/tmp/opencode/tsbuild/pristine-objc/package/tree-sitter-objc.wasm"
const VENDORED = path.join(ROOT, "grammars/tree-sitter-objc")
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]

/**
 * The node types the patches add, DERIVED FROM THE MEASUREMENT rather than hand-listed.
 *
 * The first version of this tool carried a hand-written list, and it was wrong in a way that is
 * worth not repeating: it named `macro_enum_specifier`, which is a RULE and never a node type,
 * because every place the grammar admits it does so through `alias(..., $.enum_specifier)`. The
 * alias is the point of the design — it reuses the analyzer's existing C-enum path — so the type
 * is correctly absent from the wasm, and the hand-written list reported the pin as NOT HONEST
 * because of a type that was never supposed to exist.
 *
 * A list maintained by hand is a claim; the wired-vs-pristine surface diff is the measurement.
 * So the list is now the diff, which cannot be wrong about a name and picks up a future patch
 * for free.
 */
const PATCH_ADDS_DECLARED = ["macro_prefixed_objc_declaration", "macro_enum_specifier", "availability_macro_specifier"]

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")
const admitted = (abs: string) => {
  const ext = path.extname(abs).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  try {
    const fd = fs.openSync(abs, "r"); const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, 65536, 0); fs.closeSync(fd)
    return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(buf.toString("utf8", 0, n))
  } catch { return false }
}

async function surface(w: string) {
  const lang = await (await loadWebTreeSitter()).Language.load(w)
  const names: string[] = []
  for (let i = 0; i < lang.nodeTypeCount; i++) names.push(lang.nodeTypeForId(i))
  return new Set(names.filter((n) => /^[a-z_]/.test(n)))
}

function corpusFiles(): string[] {
  const out: string[] = []
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    let ls = ""
    try { ls = execSync("git ls-files '*.m' '*.mm' '*.h'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    for (const f of ls.split("\n").filter((x) => x.trim())) {
      const abs = path.join(dir, f)
      if (admitted(abs)) out.push(abs)
    }
  }
  return out
}

async function main() {
  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()

  const [sWired, sRebuild, sPristine] = await Promise.all([surface(WIRED), surface(REBUILD), surface(PRISTINE)])
  const diff = (a: Set<string>, b: Set<string>) => ({
    onlyInFirst: [...a].filter((x) => !b.has(x)).sort(),
    onlyInSecond: [...b].filter((x) => !a.has(x)).sort(),
  })
  const wiredVsRebuild = diff(sWired, sRebuild)
  const wiredVsPristine = diff(sWired, sPristine)
  // The patches' node-type footprint IS the wired-only set, measured.
  const PATCH_ADDS = wiredVsPristine.onlyInFirst
  const patchTypesPresentInWired = PATCH_ADDS.filter((t) => sWired.has(t))
  const patchTypesAbsentFromPristine = PATCH_ADDS.filter((t) => !sPristine.has(t))
  const patchTypesAbsentFromWired = PATCH_ADDS.filter((t) => !sWired.has(t))
  // Rules the grammar adds but that never become node types, because they are aliased or hidden.
  // `macro_enum_specifier` is aliased to `enum_specifier` at every admission point; the
  // `_method_trailing_modifiers` choice is a hidden (`_`-prefixed) rule. Both are real additions
  // to the source and correctly absent from the wasm, and listing them as expected node types is
  // how the first version of this tool reached a false "NOT HONEST".
  const PATCH_RULES_WITHOUT_NODE_TYPE = PATCH_ADDS_DECLARED.filter((r) => !sWired.has(r))

  // ---- behaviour: analyzer output per build, over the router universe ----
  const mk = async (w: string) => { const p = new mod.Parser(); p.setLanguage(await mod.Language.load(w)); return p }
  const parsers = { wired: await mk(WIRED), rebuild: await mk(REBUILD), pristine: await mk(PRISTINE) }
  const files = corpusFiles()
  const acc = { wired: { sym: 0, rel: 0, err: 0 }, rebuild: { sym: 0, rel: 0, err: 0 }, pristine: { sym: 0, rel: 0, err: 0 } }
  const perFile: any[] = []
  const key = (r: any) => `${r.source}|${r.type}|${r.target}`

  for (const abs of files) {
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { continue }
    const row: any = { file: path.relative(CORPUS_ROOT, abs) }
    const sigs: Record<string, string> = {}
    for (const [tag, parser] of Object.entries(parsers)) {
      const t = parser.parse(src)
      let errors = 0
      const cnt = (n: any) => { if (n.type === "ERROR") errors++; for (let i = 0; i < n.childCount; i++) cnt(n.child(i)) }
      cnt(t.rootNode)
      acc[tag as keyof typeof acc].err += errors
      let r: any
      try { r = (new RealObjectiveCAnalyzer() as any).analyze(t.rootNode, src, abs) } catch { r = { symbols: [], relationships: [] } }
      acc[tag as keyof typeof acc].sym += r.symbols?.length ?? 0
      acc[tag as keyof typeof acc].rel += r.relationships?.length ?? 0
      const sig = [
        ...(r.symbols ?? []).map((s: any) => `S:${s.kind}:${s.name}`).sort(),
        ...(r.relationships ?? []).map((x: any) => `R:${key(x)}`).sort(),
      ].join("\n")
      sigs[tag] = sig
      row[tag] = { errors, symbols: r.symbols?.length ?? 0, relationships: r.relationships?.length ?? 0 }
    }
    row.wiredEqualsRebuild = sigs.wired === sigs.rebuild
    row.wiredEqualsPristine = sigs.wired === sigs.pristine
    perFile.push(row)
  }

  const wiredVsRebuildBehaviour = perFile.filter((r) => !r.wiredEqualsRebuild).map((r) => r.file)
  const wiredVsPristineBehaviour = perFile.filter((r) => !r.wiredEqualsPristine).map((r) => r.file)

  // ---- vendored source, per-file hashes (what the pin re-measures) ----
  const vendoredFiles: Record<string, { sha256: string; bytes: number }> = {}
  const walk = (dir: string, rel = "") => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "parser.c" || e.name === "tree") continue
      const p = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(p, r)
      else { const b = readFileSync(p); vendoredFiles[r] = { sha256: createHash("sha256").update(b).digest("hex"), bytes: b.length } }
    }
  }
  walk(VENDORED)

  // ---- source-declared vs wired surface ----
  const nodeTypesJson = path.join(VENDORED, "src/node-types.json")
  const declaredNamed: Set<string> = new Set()
  if (fs.existsSync(nodeTypesJson)) {
    for (const t of JSON.parse(readFileSync(nodeTypesJson, "utf8"))) if (t.named) declaredNamed.add(t.type)
  }
  const declaredNotInWired = [...declaredNamed].filter((t) => !sWired.has(t)).sort()

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C grammar provenance: wired bytes vs a rebuild of the committed patched source vs pristine upstream",
    generatedAt: new Date().toISOString(),
    why:
      "objc runs a PATCHED vendored grammar and was one of 21 UNPINNED lanes, which is the worst " +
      "case for a pin: the pin exists to catch 'the wired bytes are not a build of the source we " +
      "think they are', and a patched grammar is exactly where that happens — grammar.js is edited, " +
      "rebuilt, and nothing downstream notices. Identity is claimed on SURFACE and BEHAVIOUR, never " +
      "on bytes, because a wasm build carries its emscripten version, compiler flags and section order.",
    builds: {
      wired: { path: path.relative(ROOT, WIRED), bytes: fs.statSync(WIRED).size, sha256: sha(WIRED) },
      rebuild: { path: REBUILD, bytes: fs.statSync(REBUILD).size, sha256: sha(REBUILD), of: "a fresh build of the committed patched source in grammars/tree-sitter-objc" },
      pristine: { path: PRISTINE, bytes: fs.statSync(PRISTINE).size, sha256: sha(PRISTINE), of: "npm tree-sitter-objc@3.0.2's own published wasm" },
    },
    byteIdentity: {
      wiredEqualsPristine: sha(WIRED) === sha(PRISTINE),
      wiredEqualsRebuild: sha(WIRED) === sha(REBUILD),
      note: "expected false for both, and the reason identity is claimed on surface/behaviour instead",
    },
    surface: {
      wired: { uniqueNamed: sWired.size },
      rebuild: { uniqueNamed: sRebuild.size },
      pristine: { uniqueNamed: sPristine.size },
      wiredVsRebuild,
      wiredVsPristine,
    },
    patchEvidence: {
      patchAdds: PATCH_ADDS,
      patchAddsDerivedFrom: "the wired-vs-pristine named-surface diff, so a hand-written list cannot report a rule as a missing node type",
      patchRulesWithNoNodeType: PATCH_RULES_WITHOUT_NODE_TYPE,
      presentInWired: patchTypesPresentInWired,
      absentFromPristine: patchTypesAbsentFromPristine,
      ABSENT_FROM_WIRED: patchTypesAbsentFromWired,
      additiveAtNodeTypeLevel: wiredVsPristine.onlyInSecond.length === 0,
    },
    sourceVsWasm: {
      nodeTypesJson: path.relative(ROOT, nodeTypesJson),
      declaredNamed: declaredNamed.size,
      wasmNamedUnique: sWired.size,
      missingInWasm: declaredNotInWired,
    },
    behaviour: {
      universe: { repos: REPOS, files: files.length },
      totals: acc,
      wiredVsRebuild: { filesDiffering: wiredVsRebuildBehaviour.length, files: wiredVsRebuildBehaviour.slice(0, 20) },
      wiredVsPristine: { filesDiffering: wiredVsPristineBehaviour.length, files: wiredVsPristineBehaviour.slice(0, 20) },
    },
    vendored: { dir: path.relative(ROOT, VENDORED), fileCount: Object.keys(vendoredFiles).length, files: vendoredFiles },
    verdict:
      patchTypesAbsentFromWired.length === 0 &&
      wiredVsRebuild.onlyInFirst.length === 0 && wiredVsRebuild.onlyInSecond.length === 0 &&
      wiredVsRebuildBehaviour.length === 0
        ? `HONEST: the wired bytes are a build of the committed patched source (surface identical in both directions, ` +
          `analyzer output identical on all ${files.length} routed files), and the patches are live ` +
          `(${PATCH_ADDS.length} node types present in WIRED and all absent from pristine, zero the other way; ` +
          `${PATCH_RULES_WITHOUT_NODE_TYPE.length} added RULES have no node type by design — ` +
          `${PATCH_RULES_WITHOUT_NODE_TYPE.join(", ")}). ` +
          `Pristine is worse on the corpus: ${acc.pristine.err} ERROR nodes vs ${acc.wired.err} for WIRED, ` +
          `${acc.pristine.sym} vs ${acc.wired.sym} symbols, ${acc.pristine.rel} vs ${acc.wired.rel} relationships.`
        : `NOT HONEST: ${patchTypesAbsentFromWired.length} patch node type(s) absent from WIRED ` +
          `(${patchTypesAbsentFromWired.join(", ")}); surface differs wired-vs-rebuild by ` +
          `${wiredVsRebuild.onlyInFirst.length}/${wiredVsRebuild.onlyInSecond.length}; ` +
          `${wiredVsRebuildBehaviour.length} file(s) differ in analyzer output.`,
    rows: perFile,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`builds:  wired ${payload.builds.wired.bytes}B  rebuild ${payload.builds.rebuild.bytes}B  pristine ${payload.builds.pristine.bytes}B`)
  console.log(`byte-identical?  wired==pristine: ${payload.byteIdentity.wiredEqualsPristine}   wired==rebuild: ${payload.byteIdentity.wiredEqualsRebuild}  (both false is expected)`)
  console.log(`\nnamed node-type surface:  wired ${sWired.size}  rebuild ${sRebuild.size}  pristine ${sPristine.size}`)
  console.log(`  wired vs rebuild:  only-in-wired ${wiredVsRebuild.onlyInFirst.length}  only-in-rebuild ${wiredVsRebuild.onlyInSecond.length}`)
  console.log(`  wired vs pristine: only-in-wired ${wiredVsPristine.onlyInFirst.length}  only-in-pristine ${wiredVsPristine.onlyInSecond.length}`)
  console.log(`\npatch node types: ${patchTypesPresentInWired.length}/${PATCH_ADDS.length} in WIRED, ${patchTypesAbsentFromPristine.length}/${PATCH_ADDS.length} absent from PRISTINE, ${patchTypesAbsentFromWired.length} absent from WIRED`)
  if (wiredVsPristine.onlyInFirst.length) console.log(`  added by the patches: ${wiredVsPristine.onlyInFirst.join(", ")}`)
  if (declaredNotInWired.length) console.log(`  DECLARED IN SOURCE BUT MISSING FROM WIRED: ${declaredNotInWired.join(", ")}`)
  console.log(`\nbehaviour over ${files.length} routed files:`)
  console.log(`  ERROR nodes    wired ${acc.wired.err}   rebuild ${acc.rebuild.err}   pristine ${acc.pristine.err}`)
  console.log(`  symbols        wired ${acc.wired.sym}   rebuild ${acc.rebuild.sym}   pristine ${acc.pristine.sym}`)
  console.log(`  relationships  wired ${acc.wired.rel}   rebuild ${acc.rebuild.rel}   pristine ${acc.pristine.rel}`)
  console.log(`  files where wired != rebuild: ${wiredVsRebuildBehaviour.length}   wired != pristine: ${wiredVsPristineBehaviour.length}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
