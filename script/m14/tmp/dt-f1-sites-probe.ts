// script/m14/tmp/dt-f1-sites-probe.ts — the two dart grammar findings, measured
// over the lane's pinned corpora (proxicall + dart-http) before either site is
// edited:
//
//   (1) `src/ast/real-dart-analyzer.ts:2205` reads `childForFieldName("return_type")`
//       while the pinned grammar's field set has no such field (F1). If the field
//       cannot be populated, the call is a permanent null and the fallback below it
//       is the only path that ever ran — deleting it is provably behaviour-free.
//   (2) `:453` compares `p.type === "dynamic"` where `p` is a PARAMETER DESCRIPTOR
//       whose `.type` is a Dart TYPE NAME. F1 reads every `X.type === "lit"` as a
//       node-type reference, so this is a false positive — but the block has to be
//       LIVE for the constant rename to be the honest fix rather than a way to hide
//       a dead branch. Counted here per corpus.
//
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = ["proxicall", "dart-http"].map((r) => path.join("<corpus-root>/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|dist|\.dart_tool)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-dart-analyzer"))

  let files = 0
  let returnTypeResolutions = 0
  let nodesWithThatFieldName = 0
  let dynamicParamSites = 0
  let ctorParamRecoveries = 0
  const paramTypeShape: Record<string, number> = {}
  let ctorParams = 0
  const examples: string[] = []

  const cap = Number(process.argv[2] ?? 25)
  for (const repo of REPOS) {
    const name = path.basename(repo)
    const repoFiles = filesUnder(repo).sort().slice(0, cap)
    console.error(`[${name}] ${repoFiles.length} file(s) (cap ${cap})`)
    for (const f of repoFiles) {
      files++
      if (files % 5 === 0) console.error(`  … ${files} files: rt-resolutions=${returnTypeResolutions} dyn-params=${dynamicParamSites}`)
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      const root = p.parse(content).rootNode

      // (1) does the field ever resolve, on ANY node?
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()!
        const rt = n.childForFieldName?.("return_type")
        if (rt) { returnTypeResolutions++; if (examples.length < 5) examples.push(`${name}/${path.relative(repo, f)}:${n.startPosition.row + 1} ${n.type}`) }
        if (n.namedChildCount > 1) nodesWithThatFieldName++
        for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      }

      // (2) the constructor-parameter type recovery block: how often does a
      // parameter still read as the implicit `dynamic` NAME at that point?
      try {
        const r: any = await new mod.RealDartAnalyzer().analyze(root, content, path.basename(f))
        for (const s of r.symbols ?? []) {
          if (s.kind !== "constructor" || !s.ownerName) continue
          for (const prm of s.parameters ?? []) {
            ctorParams++
            const shape = prm.type === undefined ? "<undefined>" : prm.type === "dynamic" ? "dynamic" : "named-type"
            paramTypeShape[shape] = (paramTypeShape[shape] ?? 0) + 1
            if (prm.type === "dynamic") {
              dynamicParamSites++
              const field = (r.symbols ?? []).find((x: any) => x.ownerName === s.ownerName && x.name === prm.name && x.metadata?.isField)
              if (field?.metadata?.dataType) ctorParamRecoveries++
            }
          }
        }
      } catch { /* analyzer refusal on a broken file */ }
    }
  }

  console.log(`files=${files}`)
  console.log(`(1) childForFieldName("return_type") non-null resolutions: ${returnTypeResolutions}  (nodes walked: ${nodesWithThatFieldName})`)
  for (const e of examples) console.log("    example:", e)
  console.log(`(2) constructor params: ${ctorParams} total, shapes ${JSON.stringify(paramTypeShape)}`)
  console.log(`    of those still typed "dynamic" at the recovery site: ${dynamicParamSites}; recoverable from a field's declared type: ${ctorParamRecoveries}`)
}
main()
