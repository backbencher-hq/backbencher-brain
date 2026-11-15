// Measure the three R10 override-key fixtures at once — java, csharp, groovy —
// printing every override edge with the label each lane's pre-fix rule would
// have produced. The expectations are authored FROM this output.
import * as fs from "fs"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"

const CASES = [
  { lang: "java", wasm: "wasm/tree-sitter-java.wasm", file: "validation/m14/fixtures/java/override-key-parameter-lists.java", make: () => new RealJavaAnalyzer() },
  { lang: "csharp", wasm: "wasm/tree-sitter-c_sharp.wasm", file: "validation/m14/fixtures/csharp/override-key-parameter-lists.cs", make: () => new RealCSharpAnalyzer() },
  { lang: "groovy", wasm: "wasm/tree-sitter-groovy.wasm", file: "validation/m14/fixtures/groovy/override-key-parameter-lists.groovy", make: () => new RealGroovyAnalyzer() },
]

/** the superseded rule of java (split, last two, cut each at '(') */
function oldJava(fqn: string): string {
  const segs = fqn.split(".")
  const last = segs[segs.length - 1].split("(")[0]
  if (segs.length < 2) return last
  const prev = segs[segs.length - 2].split("(")[0]
  return prev ? `${prev}.${last}` : last
}
/** the superseded rule of csharp/groovy (cut at the first '(', then split) */
function oldCsGroovy(fqn: string): string {
  return fqn.split("(")[0].split(".").slice(-2).join(".")
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  for (const c of CASES) {
    const lang = await L.load(fs.readFileSync(c.wasm))
    const parser = new P()
    parser.setLanguage(lang)
    const source = fs.readFileSync(c.file, "utf8")
    const tree = parser.parse(source)

    let errs = 0
    const stack = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "ERROR" || n.isMissing) errs++
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }

    const az: any = c.make()
    const res: any = az.analyze(tree.rootNode, source, c.file)
    const rels = (res.relationships ?? []).filter((r: any) =>
      String(r.type ?? r.label ?? "").toLowerCase().indexOf("overrid") >= 0,
    )

    process.stdout.write(`\n########## ${c.lang}  (${c.file})\n`)
    process.stdout.write(`parse errors: ${errs}; override edges: ${rels.length}\n`)
    for (const r of rels) {
      process.stdout.write(`  ${r.source} -> ${r.target}   (conf ${r.confidence ?? "-"})\n`)
    }
    // Symbols carry the parameters the emitting rule used to build the
    // signature, so the pre-fix label is recomputable rather than guessed.
    const sigByLabel = new Map<string, string>()
    for (const s of res.symbols ?? []) {
      if (String(s.kind) !== "method" || !Array.isArray(s.parameters) || !s.ownerName) continue
      sigByLabel.set(`${s.ownerName}.${s.name}`, `(${s.parameters.map((p: any) => p.type ?? "unknown").join(",")})`)
    }
    process.stdout.write(`  signatures recorded on symbols:\n`)
    for (const [k, v] of sigByLabel) process.stdout.write(`    ${k} ${v}\n`)
    process.stdout.write(`  pre-fix labels from the reconstructed fqns:\n`)
    const seen = new Set<string>()
    for (const r of rels) {
      for (const side of ["source", "target"] as const) {
        const label = String(r[side])
        const sig = sigByLabel.get(label)
        if (!sig) continue
        const fqn = `${label}${sig}`
        const k = `${label}|${oldJava(fqn)}|${oldCsGroovy(fqn)}`
        if (seen.has(k)) continue
        seen.add(k)
        process.stdout.write(`    ${label}  +  ${sig}\n      split-last-two : ${JSON.stringify(oldJava(fqn))}\n      cut-at-first-( : ${JSON.stringify(oldCsGroovy(fqn))}\n`)
      }
    }
    process.stdout.write(`  all relationships:\n`)
    for (const r of res.relationships ?? []) {
      process.stdout.write(`    ${r.type}\t${r.source} -> ${r.target}\n`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
