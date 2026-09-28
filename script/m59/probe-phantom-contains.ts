// M59 (#825) finding check — SYNTHESISED members and their containment lines.
//
// kotlin's data classes generate componentN/copy/equals/hashCode/toString
// (metadata.isPhantom, deliberately pinned by kotlin/data-class-phantoms) and
// java's Spring-Data repositories / lombok getters-setters do the same. Those
// names are written NOWHERE in the source, yet the containment edge emitted for
// them takes the symbol's range — which for a phantom is the enclosing
// declaration's range. Consequence: a tool navigating to `DataHolder.copy`
// opens the CLASS declaration, and a source check can never be satisfied.
//
// This probe measures the shape on real corpus files and prints, for every
// phantom containment edge, the claimed line and the source text on it.
import * as fs from "fs"
import * as path from "path"

const ROOT = "$HOME/mcp/backbencher-brain"

const FILES = [
  "$HOME/fixtures/repositories/Exposed/exposed-json/src/test/kotlin/org/jetbrains/exposed/v1/json/JsonTestsData.kt",
]

async function check(file: string): Promise<{ phantoms: number; edges: number; wrongLine: number; noLine: number }> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(file, "utf8")
  const lines = src.split("\n")
  const res: any = await ASTEngine.parseFile(file, src)
  const phantom = new Set((res.symbols ?? []).filter((s: any) => s.metadata?.isPhantom).map((s: any) => s.name))
  let edges = 0
  let wrongLine = 0
  let noLine = 0
  console.log(`\n=== ${path.basename(file)} (${phantom.size} phantom symbol(s)) ===`)
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "contains" || !phantom.has(String(r.target))) continue
    edges++
    const ln = r.line_number
    const text = typeof ln === "number" ? (lines[ln - 1] ?? "").trim() : ""
    const nameOnLine = typeof ln === "number" && new RegExp(`(^|[^\\w])${String(r.target)}([^\\w]|$)`).test(text)
    // Three states, never conflated (the M59 oracle's own tier discipline):
    // the name IS written on the claimed line; a line IS claimed that does not
    // contain the name (a defect); or NO line is claimed, which for a name that
    // is written nowhere is the only honest answer.
    const state = typeof ln !== "number" ? "no-line" : nameOnLine ? "name-on-line" : "NAME-NOT-ON-LINE"
    if (typeof ln !== "number") noLine++
    else if (!nameOnLine) wrongLine++
    console.log(
      `  ${String(r.source).padEnd(14)} -> ${String(r.target).padEnd(12)} line=${String(ln ?? "(none)").padEnd(6)} ${state.padEnd(17)} :: ${text.slice(0, 46)}`,
    )
  }
  return { phantoms: phantom.size, edges, wrongLine, noLine }
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : FILES
  let total = { phantoms: 0, edges: 0, wrongLine: 0, noLine: 0 }
  for (const f of files) {
    const r = await check(f)
    total = {
      phantoms: total.phantoms + r.phantoms,
      edges: total.edges + r.edges,
      wrongLine: total.wrongLine + r.wrongLine,
      noLine: total.noLine + r.noLine,
    }
  }
  console.log(
    `\nphantoms=${total.phantoms} containment-edges=${total.edges} no-line=${total.noLine} claimed-line-without-the-name=${total.wrongLine}`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
