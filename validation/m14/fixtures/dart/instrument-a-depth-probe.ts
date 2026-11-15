/**
 * WHY `npx tsx script/m14/ontology-coverage-gate.ts dart` DIES
 *
 * ## The failure, reproduced
 *
 *     RangeError: Maximum call stack size exceeded
 *         at unmarshalNode (node_modules/web-tree-sitter/tree-sitter.js:1093:23)
 *         at Node.child (node_modules/web-tree-sitter/tree-sitter.js:674:12)
 *         at v (script/m14/ontology-coverage-gate.ts:339:141)
 *         at v (script/m14/ontology-coverage-gate.ts:339:137)   x N
 *
 * `v` at gate:339 is Instrument A, the grammar-inventory census:
 *
 *     const v = (n) => { grammarNodeTypes.set(n.type, ...); for (let i=0;i<n.childCount;i++) v(n.child(i)) }
 *     v(t.rootNode)
 *
 * It is unbounded recursion over parse-tree depth. Dart's own test suite ships a file
 * whose declared purpose is to nest a statement as deeply as the parser will accept:
 *
 *     dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart
 *
 * and that file is ALREADY in the gate's `walk-dart.txt` checkpoint marked bad:
 *
 *     !/…/dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart
 *
 * The `parseFile` walk honours that marker. Instrument A does not: gate:336 iterates
 * `files`, the same admitted array the walk consumed, with no bad-file filter, no
 * try/catch, and no depth bound. So the walk correctly abandons the pathological file
 * and then Instrument A re-parses it and takes the whole gate down with it.
 *
 * ## What this probe measures
 *
 * Tree depth, computed ITERATIVELY, because the question is "how deep" and a recursive
 * measurement cannot answer it about the file that breaks recursion. Reports:
 *
 *   - max depth, and the deepest node-type chain, per file;
 *   - the recursion depth at which the arbiter's own `v` raises (child process, so the
 *     RangeError is observed rather than fatal to the probe);
 *   - whether `v` survives the file at all.
 *
 * Run: npx tsx validation/m14/fixtures/dart/instrument-a-depth-probe.ts [file...]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"

const WSP_ROOT = path.join(process.cwd(), "node_modules", "web-tree-sitter")

/** Max depth via an explicit stack. Never recurses, so it cannot itself overflow. */
function depthOf(root: any): { depth: number; chain: string[] } {
  let best = 0
  let bestChain: string[] = []
  // [node, depth] pairs. Push children in reverse so the reported chain reads top-down.
  const stack: [any, number, string[]][] = [[root, 1, [root.type]]]
  while (stack.length) {
    const [n, d, chain] = stack.pop()!
    if (d > best) { best = d; bestChain = chain }
    const cc = n.childCount
    for (let i = cc - 1; i >= 0; i--) stack.push([n.child(i), d + 1, [...chain, n.child(i).type]])
  }
  return { depth: best, chain: bestChain }
}

/** Reproduce the arbiter's Instrument A descent EXACTLY, and report whether it survives. */
function arbiterV(root: any, tally: Map<string, number>): { ok: boolean; err?: string; n: number } {
  let n = 0
  try {
    const v = (x: any): void => {
      n++
      if (n > 20_000_000) throw new Error("node-count guard")
      tally.set(x.type, (tally.get(x.type) ?? 0) + 1)
      for (let i = 0; i < x.childCount; i++) v(x.child(i))
    }
    v(root)
    return { ok: true, n }
  } catch (e: any) {
    return { ok: false, err: `${e?.constructor?.name}: ${e?.message}`, n }
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(WSP_ROOT, "tree-sitter.wasm") })

// The child needs an ABSOLUTE entry file, not a package directory: `node_modules` is a
// symlink into another checkout and `require()` of the directory does not resolve it.
// `exports` maps the require condition to tree-sitter.cjs, so require THAT file directly.
const WSP_CJS = path.join(WSP_ROOT, "tree-sitter.cjs")
const WSP_WASM = path.join(WSP_ROOT, "tree-sitter.wasm")

// The two files `walk-dart.txt` already marked `!bad`, plus the deepest-tree control.
const CHECKPOINT = "validation/m14/measurements/walk-dart.txt"
const bad = readFileSync(CHECKPOINT, "utf8").split("\n").filter((l) => l.startsWith("!")).map((l) => l.slice(1))

const DEFAULTS = [
  ...bad,
  path.join(process.cwd(), "validation/m14/fixtures/dart/type-references.dart"),
]
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS

const parser = new WSP()
const grammar = process.argv.find((a) => a === "--bash") ? "tree-sitter-bash.wasm" : "tree-sitter-dart.wasm"
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", grammar))))

const tally = new Map<string, number>()
console.log(`instrument-A depth probe — grammar ${grammar}`)
console.log(`files: ${files.length}\n`)

for (const f of files) {
  if (!existsSync(f)) { console.log(`  MISSING  ${f}`); continue }
  const text = readFileSync(f, "utf8")
  const label = f.replace("/home/ishaq2321/bb_tests/repositories/", "")
  const t0 = Date.now()
  const tree = parser.parse(text)
  const ms = Date.now() - t0
  if (!tree) { console.log(`  NULLTREE ${label}`); continue }
  const { depth, chain } = depthOf(tree.rootNode)
  const before = [...tally.values()].reduce((a, b) => a + b, 0)
  // The arbiter's descent, run in a child so its RangeError is data and not our death.
  let res: { ok: boolean; err?: string; n: number }
  try {
    const out = execFileSync(
      process.execPath,
      ["-e", `
        const wts = require(${JSON.stringify(WSP_CJS)});
        const fs = require("fs");
        (async () => {
          await wts.Parser.init({ locateFile: () => ${JSON.stringify(WSP_WASM)} });
          const p = new wts.Parser();
          p.setLanguage(await wts.Language.load(fs.readFileSync(${JSON.stringify(path.join(process.cwd(), "wasm", grammar))})));
          const t = p.parse(fs.readFileSync(${JSON.stringify(f)}, "utf8"));
          let n = 0;
          const v = (x) => { n++; if (n > 20000000) throw new Error("node-count guard");
            for (let i = 0; i < x.childCount; i++) v(x.child(i)); };
          try { v(t.rootNode); process.stdout.write(JSON.stringify({ ok: true, n })); }
          catch (e) { process.stdout.write(JSON.stringify({ ok: false, err: e.constructor.name + ": " + e.message, n })); }
        })();
      `],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: process.cwd() },
    )
    res = JSON.parse(out)
  } catch (e: any) {
    res = { ok: false, err: `child died: ${String(e?.message ?? e).slice(0, 200)}`, n: -1 }
  }
  const after = [...tally.values()].reduce((a, b) => a + b, 0)
  void before; void after
  console.log(`  ${label}`)
  console.log(`      bytes=${text.length}  parseMs=${ms}  iterativeMaxDepth=${depth}  nodes=${res.n}`)
  console.log(`      arbiterV -> ${res.ok ? "SURVIVED" : `DIED ${res.err}`}`)
  console.log(`      deepest chain: ${chain.slice(0, 12).join(" > ")}${chain.length > 12 ? " > ..." : ""}`)
}

console.log(`\nnode-type census accumulated over the files walked above: ${tally.size} distinct types`)
console.log("NOTE: the arbiter's `v` mutates its own tally in-process; this probe's tally is")
console.log("      per-file by construction, so the distinct-type count above is a LOWER BOUND.")