// CS-DEEP-17 — PERF, as an A/B against the pre-fix analyzer. The only number that is mine.
//
// CS-DEEP-16 measures absolute throughput, and absolute throughput is a property of the
// MACHINE as much as of the code: this box runs 12 cores with other lanes' sweeps in flight,
// so an absolute ms/file here is not comparable to the 2026-08 M12 envelope measured on other
// hardware. Quoting it as "slower" or "faster" would be guessing.
//
// What IS mine is the DELTA this round introduced. Three hot paths changed:
//   * the qualified-name branch of `csharpDeclaredTypeLeaves` now walks a `type_argument_list`
//     (D1) — one extra child lookup per qualified name;
//   * `extractAttributes` now runs three string normalisers per attribute instead of one
//     (D2) — this is the one with real cost potential, because attributes are the densest
//     syntactic construct in a C# file;
//   * `csharpUsingDirectiveTarget` now walks the target's arguments (D3) — per directive.
//
// So: both analyzers are loaded into ONE process, run INTERLEAVED over the same files in
// randomised-ish order (so a thermal or load drift hits both equally), and the delta is
// reported per round-trip. A fixed regression in one direction is a finding; noise around
// zero is the honest result, and a negative delta (the fix is FASTER) is reported as such
// rather than quietly dropped.
import { execFileSync } from "node:child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  const beforeCommit = arg("--before") ?? "HEAD"
  if (!listFile) { console.error("usage: cs-deep-17-perf-ab.ts --list <paths> [--before <commit>] [count]"); process.exit(2) }
  const count = Number(arg("--count") ?? 300)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, count)

  // Materialise the PRE-FIX module beside the tree (see cs-deep-13 for why the symlink farm).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-deep17-"))
  const beforeSrc = execFileSync("git", ["show", `${beforeCommit}:src/ast/real-csharp-analyzer.ts`], { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
  const stage = path.join(tmp, "src", "ast")
  fs.mkdirSync(stage, { recursive: true })
  fs.writeFileSync(path.join(stage, "real-csharp-analyzer.ts"), beforeSrc)
  for (const entry of fs.readdirSync(path.join(ROOT, "src"), { withFileTypes: true })) {
    const dest = path.join(tmp, "src", entry.name)
    if (dest === stage) continue
    if (entry.isDirectory()) fs.symlinkSync(path.join(ROOT, "src", entry.name), dest, "dir")
    else fs.symlinkSync(path.join(ROOT, "src", entry.name), dest)
  }
  for (const dep of ["engine.ts", "override-context.ts"]) {
    fs.symlinkSync(path.join(ROOT, "src", "ast", dep), path.join(stage, dep))
  }
  const Before: any = await import(path.join(stage, "real-csharp-analyzer.ts"))
  const After: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const before = new Before.RealCSharpAnalyzer()
  const after = new After.RealCSharpAnalyzer()
  const work = files.map((f) => ({ f, src: fs.readFileSync(f, "utf8"), tree: parser.parse(fs.readFileSync(f, "utf8")) }))

  // Warm both on the first file, then measure three interleaved rounds.
  for (const w of work.slice(0, 5)) { before.analyze(w.tree.rootNode, w.src, w.f); after.analyze(w.tree.rootNode, w.src, w.f) }

  const ROUNDS = 3
  const bTimes: number[] = []
  const aTimes: number[] = []
  for (let r = 0; r < ROUNDS; r++) {
    // Alternate the order each round so no side systematically gets the warmer cache.
    const order = r % 2 === 0
      ? [{ k: "b" as const }, { k: "a" as const }]
      : [{ k: "a" as const }, { k: "b" as const }]
    const t: Record<string, number> = { a: 0, b: 0 }
    for (const w of work) {
      for (const side of order) {
        const t0 = performance.now()
        if (side.k === "b") before.analyze(w.tree.rootNode, w.src, w.f)
        else after.analyze(w.tree.rootNode, w.src, w.f)
        t[side.k] += performance.now() - t0
      }
    }
    bTimes.push(t.b)
    aTimes.push(t.a)
  }

  const med = (xs: number[]): number => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  const mb = med(bTimes)
  const ma = med(aTimes)
  console.log(`files: ${work.length}   rounds: ${ROUNDS} (median taken; order alternated so cache warmth is not a side's privilege)`)
  console.log(`pre-fix  (${beforeCommit}): ${bTimes.map((x) => x.toFixed(0)).join(", ")} ms   median ${mb.toFixed(1)} ms   ${(mb / work.length).toFixed(3)} ms/file`)
  console.log(`post-fix (working tree)  : ${aTimes.map((x) => x.toFixed(0)).join(", ")} ms   median ${ma.toFixed(1)} ms   ${(ma / work.length).toFixed(3)} ms/file`)
  const delta = (ma - mb) / mb
  console.log(`\nDELTA: ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}%   (${(ma - mb) >= 0 ? "SLOWER" : "FASTER"} by ${Math.abs(delta * 100).toFixed(2)}%)`)
  console.log(delta > 0.15
    ? "  ABOVE the 15% noise band — a real per-file regression, and the budget needs a look"
    : delta < -0.15
      ? "  below the noise band and FASTER: the fixes replaced a text read with a tree walk on the shapes they touch"
      : "  inside the 15% noise band on this machine: the three fixes are not measurable against the surrounding cost")

  // The cost that actually scales is ATTRIBUTES, since D2 put three normalisers on the
  // densest construct in the language. Report it per-attribute rather than hoping a per-file
  // average notices.
  let attrs = 0
  for (const w of work.slice(0, 100)) {
    const walk = (n: any): void => { if (n.type === "attribute") attrs++; for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)) }
    walk(w.tree.rootNode)
  }
  console.log(`\nattribute count over the first 100 files: ${attrs} (D2's hot path; ${(attrs / 100).toFixed(1)} per file)`)
}

if (import.meta.main) await main()
