// script/m60/objc-wasm-ab.ts — the A/B instrument for the Objective-C grammar wave.
//
// WHY THIS TOOL, GIVEN objc-wasm-compare.ts ALREADY EXISTS
// --------------------------------------------------------
// script/m12/objc-wasm-compare.ts answers two questions on SEVEN files: does `hasError` differ,
// and which way. That is not enough to land a grammar change, for three reasons measured
// rather than assumed:
//
//   1. It runs on Clyde alone. The whole point of the #743 wave was that 322 files had never
//      been measured, and the instrument that would have caught that is itself still on 7.
//   2. It compares `hasError`, a BOOLEAN. A grammar change that removes one ERROR node and
//      introduces another leaves the boolean identical and both defects invisible.
//   3. — the decisive one, and the reason the #743 review said it outright — "the differential's
//      oracle derives its edges from the SAME tree, so a grammar change that removes a phantom
//      and a grammar change that loses an edge look the same to it." A grammar change moves the
//      tree, so any oracle reading that same tree moves with it. F5 cannot referee a grammar
//      change. The ANALYZER'S OWN OUTPUT, diffed edge by edge against a second build, can: a
//      phantom is a symbol the source does not contain, and it shows up as a symbol present
//      under one build and absent under the other.
//
// So this diffs (a) ERROR/MISSING node counts per file, (b) the exact symbol set, and (c) the
// exact relationship set, and it classifies every difference by whether the new build gained
// or lost surface. "0 files worsened" is then a measured claim over the router's whole universe
// rather than an assertion about seven files.
//
// Usage:
//   bun run script/m60/objc-wasm-ab.ts --old=<wasm> --new=<wasm> [--json=<path>]
// Writes: validation/m60/results/objc-wasm-ab.json (and --json=<path> verbatim)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"
import { RealObjectiveCAnalyzer } from "../../src/ast/real-objective-c-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/objc-wasm-ab.json")
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]

const argv = (f: string, d?: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${f}=`))
  return a ? a.slice(f.length + 3) : d
}
const OLD = argv("old", path.join(ROOT, "wasm/tree-sitter-objc.wasm"))!
const NEW = argv("new", path.join(ROOT, "wasm/tree-sitter-objc.wasm"))!
const OUT_ARG = argv("json")

function admitted(abs: string): boolean {
  const ext = path.extname(abs).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  try {
    const fd = fs.openSync(abs, "r")
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, 65536, 0)
    fs.closeSync(fd)
    return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(buf.toString("utf8", 0, n))
  } catch { return false }
}

const key = (r: any) => `${r.source}|${r.type}|${r.target}`
const symKey = (s: any) => `${s.kind}:${s.name}`

function countErrorNodes(root: any): { errors: number; missing: number } {
  let errors = 0, missing = 0
  const visit = (n: any) => {
    if (n.type === "ERROR") errors++
    else if (n.type === "MISSING") missing++
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return { errors, missing }
}

async function main() {
  // The engine must be initialized BEFORE any Language.load: it installs the WASI shim that
  // web-tree-sitter's loader needs, and loading first fails with
  // `undefined is not an object (evaluating 'C.loadWebAssemblyModule')`.
  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()
  const oldLang = await mod.Language.load(OLD)
  const newLang = await mod.Language.load(NEW)
  const mk = (l: any) => { const p = new mod.Parser(); p.setLanguage(l); return p }
  const oldP = mk(oldLang), newP = mk(newLang)

  // parseFile() is the production entry and hard-wires the WIRED wasm, so it cannot be used
  // to test a second build; the analyzer is driven over each tree directly instead, which is
  // exactly what the engine does internally at src/ast/engine.ts:1522.
  const files: string[] = []
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    let out = ""
    try { out = execSync("git ls-files '*.m' '*.mm' '*.h'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    for (const f of out.split("\n").filter((x) => x.trim())) {
      const abs = path.join(dir, f)
      if (admitted(abs)) files.push(abs)
    }
  }

  const rows: any[] = []
  let improved = 0, regressed = 0, same = 0
  let symGained = 0, symLost = 0, relGained = 0, relLost = 0
  let namesGainedT = 0, namesLostT = 0, kindChangedT = 0
  let namesLostUnbackedT = 0, namesLostNeedsReadT = 0
  const needsRead: any[] = []
  let errOld = 0, errNew = 0, missOld = 0, missNew = 0
  const regressions: any[] = []
  const improvements: any[] = []

  for (const abs of files) {
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { continue }
    const tOld = oldP.parse(src), tNew = newP.parse(src)
    const eOld = countErrorNodes(tOld.rootNode), eNew = countErrorNodes(tNew.rootNode)
    errOld += eOld.errors; errNew += eNew.errors
    missOld += eOld.missing; missNew += eNew.missing

    // Analyze the SAME source under each tree. The analyzer's contract is
    // `analyze(rootNode, content, filePath)` — it walks whatever tree it is handed — so this
    // is the analyzer's output as a FUNCTION OF THE GRAMMAR, which is the quantity the #743
    // review called unrefereeable by the differential (whose oracle reads the same tree) and
    // the one that actually decides whether a grammar change is safe.
    const run = (tree: any) => (new RealObjectiveCAnalyzer() as any).analyze(tree.rootNode, src, abs)
    let rOld: any, rNew: any
    try { rOld = run(tOld) } catch (e: any) { rOld = { symbols: [], relationships: [], __err: String(e?.message ?? e) } }
    try { rNew = run(tNew) } catch (e: any) { rNew = { symbols: [], relationships: [], __err: String(e?.message ?? e) } }

    const sOld = new Map<string, number>(), sNew = new Map<string, number>()
    for (const s of rOld.symbols ?? []) sOld.set(symKey(s), (sOld.get(symKey(s)) ?? 0) + 1)
    for (const s of rNew.symbols ?? []) sNew.set(symKey(s), (sNew.get(symKey(s)) ?? 0) + 1)
    const relOld = new Map<string, number>(), relNew = new Map<string, number>()
    for (const r of rOld.relationships ?? []) relOld.set(key(r), (relOld.get(key(r)) ?? 0) + 1)
    for (const r of rNew.relationships ?? []) relNew.set(key(r), (relNew.get(key(r)) ?? 0) + 1)

    const diffOf = (a: Map<string, number>, b: Map<string, number>) => {
      const gained: string[] = [], lost: string[] = []
      for (const k of b.keys()) { const d = (b.get(k) ?? 0) - (a.get(k) ?? 0); if (d > 0) gained.push(...Array(d).fill(k)) }
      for (const k of a.keys()) { const d = (a.get(k) ?? 0) - (b.get(k) ?? 0); if (d > 0) lost.push(...Array(d).fill(k)) }
      return { gained, lost }
    }
    const ds = diffOf(sOld, sNew), dr = diffOf(relOld, relNew)

    // RECLASSIFICATION IS NOT A LOSS, and the first version of this tool could not tell them
    // apart, which is how 13 files were reported "worsened" when almost all of them were the
    // SAME names arriving with a better kind: `type:SDImageCacheType` → `enum:SDImageCacheType`
    // is the analyzer correcting itself about what a thing is. A diff keyed on `kind:name`
    // calls that a deletion plus an insertion, and a tool that reports a correction as damage
    // gets its reader looking in the wrong place — on a grammar change whose real cost is
    // hidden inside the noise.
    //
    // So symbols are compared by NAME for presence, and kind changes are counted separately.
    // Names that vanish are real losses; names that persist under a new kind are reclassifications
    // and are reported as such, because a reclassification still deserves to be read by a human
    // when it is the analyzer changing its mind about the world.
    const namesOld = new Set([...sOld.keys()].map((k) => k.slice(k.indexOf(":") + 1)))
    const namesNew = new Set([...sNew.keys()].map((k) => k.slice(k.indexOf(":") + 1)))
    const namesLost = [...namesOld].filter((n) => !namesNew.has(n))
    const namesGained = [...namesNew].filter((n) => !namesOld.has(n))
    const kindOf = (m: Map<string, number>, n: string) => {
      const k = [...m.keys()].find((x) => x.slice(x.indexOf(":") + 1) === n)
      return k ? k.slice(0, k.indexOf(":")) : undefined
    }
    const kindChanged = [...namesNew].filter((n) => namesOld.has(n) && kindOf(sNew, n) !== kindOf(sOld, n))
      .map((n) => `${kindOf(sOld, n)}→${kindOf(sNew, n)} ${n}`)
    const namesKept = [...namesNew].filter((n) => namesOld.has(n)).length
    // IS A LOST NAME A LOSS OR A PHANTOM BEING CORRECTED?
    // A name that vanished is not automatically surface that disappeared: when a grammar
    // change repairs a broken region, the wreckage it used to mint goes away too, and the old
    // build's `type:SDImageCachesManagerOperationPolicyLowestOnly` — a `type:` symbol named
    // after an ENUM MEMBER — was exactly that, in 14 places. Counting those as losses is how a
    // fix that adds 194 names and 179 relationships gets reported as net-negative.
    //
    // The discriminator is the SOURCE, not the diff: a name that does not occur in the file at
    // all was never a declaration here and cannot be surface that was lost. A name that DOES
    // occur might be a real declaration that stopped being found, or might be a type merely
    // REFERENCED (the two names lost in AFURLSessionManager.m are Foundation enums used as a
    // block typedef's return type, never declared in that file), so those are handed to a
    // human rather than guessed either way.
    const srcText = readFileSync(abs, "utf8")
    const namesLostUnbacked = namesLost.filter((n) => !srcText.includes(n))
    const namesLostNeedsRead = namesLost.filter((n) => srcText.includes(n))
    const worse = namesLostNeedsRead.length > 0 || dr.lost.length > 0 || !!rNew.__err
    symGained += ds.gained.length; symLost += ds.lost.length
    namesGainedT += namesGained.length; namesLostT += namesLost.length; kindChangedT += kindChanged.length
    namesLostUnbackedT += namesLostUnbacked.length; namesLostNeedsReadT += namesLostNeedsRead.length
    if (namesLostNeedsRead.length || dr.lost.length)
      needsRead.push({ file: path.relative(CORPUS_ROOT, abs), namesLostNeedsRead, lostRels: dr.lost.slice(0, 6) })
    relGained += dr.gained.length; relLost += dr.lost.length

    const row = {
      file: path.relative(CORPUS_ROOT, abs),
      errorNodes: { old: eOld.errors, new: eNew.errors },
      missingNodes: { old: eOld.missing, new: eNew.missing },
      symbols: { old: rOld.symbols?.length ?? 0, new: rNew.symbols?.length ?? 0 },
      relationships: { old: rOld.relationships?.length ?? 0, new: rNew.relationships?.length ?? 0 },
      namesGained, namesLost, namesLostUnbacked, namesLostNeedsRead, kindChanged, namesKept,
      errorDelta: eNew.errors - eOld.errors,
      relsGained: dr.gained, relsLost: dr.lost,
      crash: rOld.__err ?? rNew.__err ?? null,
    }
    const better = ds.gained.length > 0 || dr.gained.length > 0 || eNew.errors < eOld.errors
    if (worse) { regressed++; regressions.push(row) }
    else if (better) { improved++; improvements.push(row) }
    else same++
    rows.push(row)
  }

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C grammar A/B: ERROR/MISSING counts, symbol set, relationship set, per file",
    generatedAt: new Date().toISOString(),
    old: { path: OLD, bytes: fs.statSync(OLD).size, sha256: hashOf(OLD) },
    new: { path: NEW, bytes: fs.statSync(NEW).size, sha256: hashOf(NEW) },
    method:
      "every file the router admits, in 3 pinned repos, no sampling. For each file: ERROR/MISSING " +
      "node counts under both builds, and the analyzer's exact symbol set and relationship set " +
      "under each build, diffed edge by edge. The analyzer output is diffed because the F5 " +
      "oracle derives its truth from the same tree the grammar moved, so it cannot referee this.",
    universe: { repos: REPOS, files: files.length },
    totals: {
      errorNodes: { old: errOld, new: errNew },
      missingNodes: { old: missOld, new: missNew },
      symbols: { gained: symGained, lost: symLost, net: symGained - symLost },
      symbolNames: { gained: namesGainedT, lost: namesLostT, net: namesGainedT - namesLostT },
      kindChanges: kindChangedT,
      namesLostUnbackedInSource: namesLostUnbackedT,
      namesLostButPresentInSource: namesLostNeedsReadT,
      relationships: { gained: relGained, lost: relLost, net: relGained - relLost },
    },
    files: { improved, regressed, unchanged: same },
    verdict:
      namesLostNeedsReadT === 0 && relLost === 0
        ? `NO SURFACE LOST: 0 relationships dropped, 0 lost names that the source actually declares ` +
          `(${namesLostUnbackedT} lost name(s) were absent from their own file — phantoms the old build minted ` +
          `from a broken region, now gone), ${kindChangedT} kind reclassifications, ${improved} files improved ` +
          `(ERROR nodes ${errOld}→${errNew}, symbol names +${namesGainedT}, relationships +${relGained})`
        : `${regressed} file(s) need review: ${namesLostNeedsReadT} lost name(s) DO occur in their source and ` +
          `${relLost} relationship(s) dropped (ERROR nodes ${errOld}→${errNew}, symbol names +${namesGainedT}/-${namesLostT}, ` +
          `kind changes ${kindChangedT}, relationships +${relGained}/-${relLost})`,
    needsRead,
    regressions: regressions.slice(0, 40),
    improvements: improvements.slice(0, 40),
    rows,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  if (OUT_ARG) { mkdirSync(path.dirname(OUT_ARG), { recursive: true }); writeFileSync(OUT_ARG, JSON.stringify(payload, null, 2) + "\n") }

  console.log(`files ${files.length}   improved ${improved}   regressed ${regressed}   unchanged ${same}`)
  console.log(`ERROR nodes   ${errOld} -> ${errNew}   MISSING ${missOld} -> ${missNew}`)
  console.log(`symbol NAMES  +${namesGainedT} / -${namesLostT}   (net ${namesGainedT - namesLostT >= 0 ? "+" : ""}${namesGainedT - namesLostT})   kind reclassifications ${kindChangedT}`)
  console.log(`relationships +${relGained} / -${relLost}   (net ${relGained - relLost >= 0 ? "+" : ""}${relGained - relLost})`)
  console.log(`  lost names absent from their own file (phantoms corrected): ${namesLostUnbackedT}   lost names that DO occur in source: ${namesLostNeedsReadT}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  for (const n of needsRead.slice(0, 10)) console.log(`  NEEDS READ ${n.file}  names [${n.namesLostNeedsRead.slice(0, 5).join(", ")}]  rels [${n.lostRels.slice(0, 3).join(", ")}]`)
  for (const r of regressions.slice(0, 15)) {
    console.log(`  REVIEW ${r.file}  err ${r.errorNodes.old}->${r.errorNodes.new} (${r.errorDelta >= 0 ? "+" : ""}${r.errorDelta})  names ${r.symbols.old}->${r.symbols.new}  needsRead [${(r.namesLostNeedsRead ?? []).slice(0,4).join(", ")}]  lostRel [${(r.relsLost ?? []).slice(0,3).join(", ")}]`)
  }
  console.log(`-> ${OUT_ARG ?? path.relative(ROOT, OUT)}`)
}

function hashOf(p: string): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto")
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}
main().catch((e) => { console.error(e); process.exit(1) })
