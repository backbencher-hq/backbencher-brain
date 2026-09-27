// M12.32 / M60 lua: SET-WISE comparison of two tree-sitter-lua builds.
//
// Why this exists in the shape it does (the groovy precedent, script/m59/
// compare-groovy-grammar.ts, recorded why a headline count is not enough):
// two grammar builds are compared by WHICH FILES each one fixes and which it
// breaks, never by a total. A total can hide a fix and a regression that
// cancel exactly, and a grammar swap that "improves the error count" can have
// done both. So the unit of comparison here is the FILE, and the output names
// fixed / regressed / unchanged on both sides plus the control set that proves
// the instrument can see a difference at all.
//
// Usage:
//   npx tsx script/m12/lua-wasm-compare.ts \
//     --repo kong --new $HOME/fixtures/grammars/npm-0.4.1.wasm \
//     --out $HOME/fixtures/out/lua-grammar-ab.json
//   npx tsx script/m12/lua-wasm-compare.ts --repo kong --list subset.txt --out ...
//
// `--list` restricts the run to an explicit repo-relative file list, one per
// line, so a grammar change can be A/B'd on the BOUNDED set it could possibly
// affect (the union of both sides' failing sets plus a deterministic clean
// control) rather than paying the 1,309-file corpus twice, and so the reduced
// run stays reproducible from the list rather than from whatever /tmp held.
//
// The criterion is the TREE'S OWN rootNode.hasError, not a hand-rolled walk
// for ERROR nodes. Measured reason, carried over from the groovy instrument
// and reproduced here because it is a property of the web-tree-sitter binding
// and not of any one grammar: a walk counting nodes whose type === "ERROR"
// flags zero-width, unnamed, empty-text nodes that sit past the last line (EOF).
// They appear on a second parse of identical source, and they are a binding
// artifact, not a parse failure. Both numbers are kept — the verdict
// (hasError) and the phantom tally — so the artifact stays visible instead of
// being silently corrected.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const arg = (k: string, d?: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const REPOS = "$HOME/fixtures/repositories"
const REPO = arg("--repo", "kong")
const ROOT = join(REPOS, REPO)
const NEW_WASM = arg("--new", "$HOME/fixtures/grammars/npm-0.4.1.wasm")
const OLD_WASM = arg("--old", "$HOME/backbencher-brain/wasm/tree-sitter-lua.wasm")
const OUT = arg("--out", "$HOME/fixtures/out/lua-grammar-ab.json")
const LIST = arg("--list", "")

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex")

interface FileOutcome { rel: string; oldVerdict: string; newVerdict: string; oldPhantoms: number; newPhantoms: number }

async function main(): Promise<void> {
  const revision = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const relative = LIST
    ? readFileSync(LIST, "utf8").trim().split("\n").map((s) => s.trim()).filter(Boolean)
    : execFileSync("git", ["-C", ROOT, "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
        .trim().split("\n").filter(Boolean)

  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod: any = await loadWebTreeSitter()

  // The tree-sitter CORE wasm must be live before a raw Language.load works.
  // loadWebTreeSitter() alone does not do it: the core is initialised lazily
  // inside the engine's first parse (src/ast/engine.ts treeSitterCore), and a
  // Language.load attempted before that throws "Cannot read properties of
  // undefined (reading 'loadWebAssemblyModule')" from the emscripten glue.
  // Measured, not assumed: the same Language.load that throws in a fresh
  // process succeeds on a file after one parseFile call. So the instrument
  // pays one throwaway production parse to enter a known-good state, rather
  // than reimplementing the engine's core-wasm resolution (which exists for a
  // documented reason — see the cwd-dependence note in src/util/wasm.ts).
  const { parseFile } = await import("../../src/ast/pool-worker")
  await parseFile(join(REPOS, "luvit", "init.lua"), REPOS)

  const buildParser = async (wasmPath: string) => {
    const lang = await mod.Language.load(wasmPath)
    const parser = new mod.Parser()
    parser.setLanguage(lang)
    return { parser, lang }
  }
  const oldSide = await buildParser(OLD_WASM)
  const newSide = await buildParser(NEW_WASM)

  const outcome = (parser: any, src: string) => {
    const tree = parser.parse(src)
    let phantoms = 0
    const stack = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "ERROR" || n.isMissing) phantoms++
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    const verdict = tree.rootNode.hasError ? "ERROR" : "CLEAN"
    try { tree.delete() } catch {}
    return { verdict, phantoms }
  }

  const perFile: FileOutcome[] = []
  for (const rel of relative) {
    let src: string
    try { src = readFileSync(join(ROOT, rel), "utf8") } catch { continue }
    if (!src.trim()) continue
    const a = outcome(oldSide.parser, src)
    const b = outcome(newSide.parser, src)
    perFile.push({ rel, oldVerdict: a.verdict, newVerdict: b.verdict, oldPhantoms: a.phantoms, newPhantoms: b.phantoms })
  }

  const fixed = perFile.filter((f) => f.oldVerdict === "ERROR" && f.newVerdict === "CLEAN")
  const regressed = perFile.filter((f) => f.oldVerdict === "CLEAN" && f.newVerdict === "ERROR")
  const stillFailing = perFile.filter((f) => f.oldVerdict === "ERROR" && f.newVerdict === "ERROR")
  const cleanBoth = perFile.filter((f) => f.oldVerdict === "CLEAN" && f.newVerdict === "CLEAN")

  // A headline count alone could hide a fix and a break that cancel, so the
  // verdict that matters is the PAIR, and an all-CLEAN run proves nothing
  // because it cannot tell "both builds agree" from "instrument is blind".
  const canSeeADifference = fixed.length + regressed.length > 0
  const verdict = regressed.length === 0 && fixed.length >= 0 ? "NEW_IS_NOT_WORSE" : "NEW_REGRESSES"

  const report = {
    schemaVersion: 1,
    kind: "lua_grammar_setwise_ab",
    repo: REPO,
    revision,
    restrictedToList: Boolean(LIST),
    listPath: LIST || null,
    oldWasm: { path: OLD_WASM, sha256: sha(OLD_WASM) },
    newWasm: { path: NEW_WASM, sha256: sha(NEW_WASM) },
    filesMeasured: perFile.length,
    setwise: {
      fixed: fixed.map((f) => f.rel),
      regressed: regressed.map((f) => f.rel),
      stillFailing: stillFailing.map((f) => f.rel),
      cleanBoth: cleanBoth.length,
    },
    headline: {
      oldErrorFiles: fixed.length + stillFailing.length,
      newErrorFiles: regressed.length + stillFailing.length,
      // The number that cannot be allowed to mislead on its own.
      netErrorFileDelta: regressed.length - fixed.length,
    },
    phantomTally: {
      note: "Zero-width unnamed EOF nodes the web-tree-sitter binding reports. Kept visible; NOT a parse failure.",
      oldTotal: perFile.reduce((a, f) => a + f.oldPhantoms, 0),
      newTotal: perFile.reduce((a, f) => a + f.newPhantoms, 0),
    },
    instrumentCanSeeADifference: canSeeADifference,
    verdict,
    note: "Set-wise by FILE, not by total. A total can hide a fix and a regression that cancel. An all-CLEAN corpus proves nothing on its own, so instrumentCanSeeADifference is reported separately and must be established on a subset that actually contains failing files before any 'no difference' claim is believed.",
    perFile,
  }
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
  console.log(`repo=${REPO} files=${perFile.length}`)
  console.log(`fixed=${fixed.length} regressed=${regressed.length} stillFailing=${stillFailing.length} cleanBoth=${cleanBoth.length}`)
  console.log(`instrumentCanSeeADifference=${canSeeADifference} verdict=${verdict}`)
  for (const f of regressed) console.log(`  REGRESSED ${f.rel}`)
  for (const f of fixed) console.log(`  FIXED     ${f.rel}`)
  for (const f of stillFailing) console.log(`  STILL     ${f.rel}`)
  console.log(`wrote ${OUT}`)
  if (regressed.length) process.exitCode = 1
}
main()
