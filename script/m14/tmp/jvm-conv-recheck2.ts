// M49 W3: tightened re-check of the JVM convergence findings.
// The first pass showed zero uses edges for the whole file — that is either the
// finding or a wrong probe, so this pass adds the CONTROL the issues cite
// (`this.x` reads, which the issues say DO emit) and measures groovy parse
// success from real ERROR nodes rather than sanitized error records.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function analyze(engine: any, name: string, src: string) {
  const p = path.join(ROOT, "script/m14/tmp", name)
  fs.writeFileSync(p, src)
  const res: any = await engine.ASTEngine.parseFile(p, src)
  fs.rmSync(p, { force: true })
  return res
}

async function main() {
  const engine: any = await import("../../../src/ast/engine")

  const dump = (tag: string, res: any) => {
    const uses = [...new Set((res.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => r.target))]
    const refs = [...new Set((res.relationships ?? []).filter((r: any) => r.type === "references").map((r: any) => r.target))]
    console.log(`${tag}: uses=${JSON.stringify(uses)} references=${JSON.stringify(refs)}`)
    return uses
  }

  // ── #739 java: bare field read vs the `this.` control the issue cites ──
  const bare = await analyze(engine, "c739b.java", [
    "public class B {",
    "  Inner inner;",
    "  static class Inner {}",
    "  int read() {",
    "    return inner;",
    "  }",
    "}",
    "",
  ].join("\n"))
  dump("java bare   (issue: should emit uses inner)", bare)
  const ctl = await analyze(engine, "c739c.java", [
    "public class B {",
    "  Inner inner;",
    "  static class Inner {}",
    "  Inner read() {",
    "    return this.inner;",
    "  }",
    "}",
    "",
  ].join("\n"))
  const ctlUses = dump("java this.x (control: issue says EMITS)", ctl)
  console.log(`  -> #739 verdict: bare=${(bare.relationships ?? []).filter((r: any) => r.type === "uses").length} edges, this.x=${ctlUses.length} edges`)

  // ── #740 kotlin: same control structure ────────────────────────────────
  const ktBare = await analyze(engine, "c740b.kt", [
    "class Holder(val box: Box) {",
    "  val count = 1",
    "  fun plain(): Int { return count }",
    "}",
    "class Box",
    "",
  ].join("\n"))
  dump("kotlin bare (issue: should emit uses count)", ktBare)
  const ktCtl = await analyze(engine, "c740c.kt", [
    "class Holder(val box: Box) {",
    "  fun dotted(): Box { return this.box }",
    "}",
    "class Box",
    "",
  ].join("\n"))
  dump("kotlin this.x (control)", ktCtl)

  // ── #742 groovy: real ERROR-node census on grails-core ─────────────────
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
  // The engine caches resolved language wasm under /tmp/bb-wasm_<pkg>_<file>.wasm
  const groovyWasm = "/tmp/bb-wasm_tree-sitter-groovy_tree-sitter-groovy.wasm"
  if (!fs.existsSync(groovyWasm)) { console.log("#742 groovy wasm missing at", groovyWasm); return }
  const lang = await L.load(fs.readFileSync(groovyWasm))
  const parser = new P()
  parser.setLanguage(lang)

  const files: string[] = []
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= 120) return
      if (["node_modules", ".git", "build", "target"].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".groovy")) files.push(p)
    }
  }
  walk("<corpus-root>/bb_tests/repositories/grails-core")
  let clean = 0
  const bad: string[] = []
  for (const f of files) {
    const tree = parser.parse(fs.readFileSync(f, "utf8"))
    if (tree && !tree.rootNode.hasError) clean++
    else bad.push(path.relative("<corpus-root>/bb_tests/repositories/grails-core", f))
  }
  console.log(`#742 groovy ERROR-node census: ${clean}/${files.length} clean (${((clean / files.length) * 100).toFixed(1)}%)`)
  console.log(`  first error files: ${bad.slice(0, 5).join(" | ")}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
