// M49 W3: re-verify the convergence-sweep findings that are still open for the
// JVM family (declared closed on the board) — #739 java, #740 kotlin,
// #741 scala Spring detection, #742 groovy parse success. Evidence, not titles.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

function tmpf(name: string, src: string): string {
  const p = path.join(ROOT, "script/m14/tmp", name)
  fs.writeFileSync(p, src)
  return p
}

async function analyze(engine: any, name: string, src: string) {
  const p = tmpf(name, src)
  const res: any = await engine.ASTEngine.parseFile(p, src)
  fs.rmSync(p, { force: true })
  return res
}

async function main() {
  const engine: any = await import("../../../src/ast/engine")

  // ── #739 java: bare identifier read of a declared field ────────────────
  const java = await analyze(engine, "conv739.java", [
    "public class B {",
    "  Inner inner;",
    "  static class Inner {}",
    "  int read() {",
    "    return inner;",
    "  }",
    "}",
    "",
  ].join("\n"))
  const javaUses = (java.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => r.target)
  console.log(`#739 java bare read: uses=${JSON.stringify([...new Set(javaUses)])} -> ${javaUses.includes("inner") ? "FIXED" : "STILL OPEN"}`)

  // ── #740 kotlin: plain + dotted member reads ───────────────────────────
  const kt = await analyze(engine, "conv740.kt", [
    "class Holder(val inner: Box) {",
    "  val count = 1",
    "  fun plain(): Int { return count }",
    "  fun dotted(): Box { return this.inner }",
    "}",
    "class Box",
    "",
  ].join("\n"))
  const ktUses = (kt.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => r.target)
  const ktOk = ktUses.includes("count") && ktUses.includes("inner")
  console.log(`#740 kotlin reads: uses=${JSON.stringify([...new Set(ktUses)])} -> ${ktOk ? "FIXED" : "STILL OPEN"} (need count + inner)`)

  // ── #741 scala: Spring framework detection ─────────────────────────────
  const scala = await analyze(engine, "conv741.scala", [
    "import org.springframework.stereotype.Service",
    "import org.springframework.beans.factory.annotation.Autowired",
    "@Service",
    "class Greeter {",
    '  def greet(): String = "hi"',
    "}",
    "",
  ].join("\n"))
  const frameworks = (scala as any).metadata?.frameworks ?? (scala as any).frameworks ?? []
  console.log(`#741 scala frameworks: ${JSON.stringify(frameworks)} -> ${frameworks.length > 0 ? "FIXED" : "STILL OPEN"}`)

  // ── #742 groovy: parse success on the real corpus ──────────────────────
  const groovyDir = "/home/ishaq2321/bb_tests/repositories/grails-core"
  const files: string[] = []
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= 80) return
      if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "target") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".groovy")) files.push(p)
    }
  }
  walk(groovyDir)
  const engineMod: any = await import("../../../src/ast/engine")
  let ok = 0, errFiles = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    try {
      const r: any = await engineMod.ASTEngine.parseFile(f, src)
      if ((r.errors ?? []).some((e: any) => e.severity === "error")) errFiles++
      else ok++
    } catch { errFiles++ }
  }
  const pct = files.length ? ((ok / files.length) * 100).toFixed(1) : "n/a"
  console.log(`#742 groovy grails-core: ${ok}/${files.length} parse clean (${pct}%) -> ${errFiles === 0 ? "FIXED" : "STILL OPEN"}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
