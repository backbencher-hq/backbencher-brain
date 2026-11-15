// Measure validation/m14/fixtures/java/override-key-parameter-lists.java:
// every override edge, with the label each rule produces. The expectation is
// authored FROM this output, never transcribed by hand.
import * as fs from "fs"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"

const PATH = "validation/m14/fixtures/java/override-key-parameter-lists.java"

/** signatures the fixture writes, keyed by method name */
const SIGNATURES: Record<string, string> = {
  query: "(Entity,Outer.Criterion,StringBuilder,boolean)",
  remember: "(java.util.Map.Entry<String, Boolean>)",
  last: "(Outer.Criterion)",
}
function sigFor(method: string): string | null {
  return SIGNATURES[method] ?? null
}
/** the fqn prefixes each owner name can carry (package + enclosing types) */
function ownerFqns(owner: string): string[] {
  return [`com.acme.jvm.${owner}`, `Outer.Query`, `com.acme.jvm.Outer.Builder`]
}

/** the superseded rule, reproduced from the code that carried it */
function oldJava(fqn: string): string {
  const segs = fqn.split(".")
  const last = segs[segs.length - 1].split("(")[0]
  if (segs.length < 2) return last
  const prev = segs[segs.length - 2].split("(")[0]
  return prev ? `${prev}.${last}` : last
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-java.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  const source = fs.readFileSync(PATH, "utf8")
  const tree = parser.parse(source)

  // Error nodes would hide shapes — report them instead of ignoring them.
  let errs = 0
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "ERROR" || n.isMissing) errs++
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  process.stdout.write(`parse errors: ${errs}\n`)

  const az = new RealJavaAnalyzer()
  const res: any = az.analyze(tree.rootNode, source, PATH)
  const rels = (res.relationships ?? []).filter((r: any) => String(r.type ?? r.label ?? "").toLowerCase().indexOf("overrid") >= 0)
  process.stdout.write(`override edges: ${rels.length}\n`)
  for (const r of rels) {
    process.stdout.write(`  ${r.source} -> ${r.target}   (conf ${r.confidence ?? "-"}${r.line_number ? `, line ${r.line_number}` : ""})\n`)
  }
  process.stdout.write(`\nall relationships:\n`)
  for (const r of res.relationships ?? []) {
    process.stdout.write(`  ${r.type}\t${r.source} -> ${r.target}${r.line_number ? ` @${r.line_number}` : ""}\n`)
  }
  process.stdout.write(`\nsymbols:\n`)
  for (const s of res.symbols ?? []) {
    process.stdout.write(`  ${s.kind}\t${s.ownerName ?? "-"}.${s.name}${s.returnType ? ` : ${s.returnType}` : ""}\n`)
  }
  // The pre-fix label for each emitted side, computed by feeding the OLD rule
  // the fqn the analyzer built — reconstructed exactly as the analyzer builds
  // it (`${ownerFqn}.${name}${signature}`), so the forbid list is evidence and
  // not a transcription. The signature is read off the fixture's own written
  // parameter types, and the fixed label supplies owner + name.
  process.stdout.write(`\npre-fix (old-java) labels, from the reconstructed fqns:\n`)
  for (const r of rels) {
    for (const side of ["source", "target"] as const) {
      const label = String(r[side])
      const dot = label.indexOf(".")
      if (dot < 0) continue
      const sig = sigFor(label.slice(dot + 1))
      if (sig === null) continue
      for (const ownerFqn of ownerFqns(label.slice(0, dot))) {
        const fqn = `${ownerFqn}.${label.slice(dot + 1)}${sig}`
        process.stdout.write(`  ${side} ${JSON.stringify(label)}  <-  ${JSON.stringify(oldJava(fqn))}\n`)
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
