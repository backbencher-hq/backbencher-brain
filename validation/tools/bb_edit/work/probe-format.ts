// Focused probe: does the DEFAULT formatter step preserve a CRLF file's line
// endings? The edit engine splices with the file's own ending; the formatter runs
// afterwards and its own default may rewrite them.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine"
import { ASTEngine } from "../../../../src/ast/engine"

const checks: Array<{ name: string; pass: boolean; detail: string; negative?: boolean }> = []
function ck(name: string, pass: boolean, detail = ""): void { checks.push({ name, pass, detail }); if (!pass) console.log(`FAIL ${name} — ${detail}`) }
const crlfCount = (text: string): number => (text.match(/\r\n/g) ?? []).length
const loneLf = (text: string): number => (text.match(/(?<!\r)\n/g) ?? []).length

async function fixture(label: string, files: Record<string, string>): Promise<{ root: string; projectId: string }> {
  const root = path.resolve(`validation/tools/bb_edit/work/run/format-${label}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const projectId = getProjectId(root)
  await indexProjectParallel(projectId as any, root, {})
  return { root, projectId }
}

async function main(): Promise<void> {
  const GO_CRLF = "package fixture\r\n\r\nfunc target(x int) int {\r\n\treturn x + 1\r\n}\r\n"
  // 1. .go CRLF, default format:true → gofmt runs
  {
    const { root, projectId } = await fixture("go-default", { "t.go": GO_CRLF, "go.mod": "module fixture\n\ngo 1.21\n" })
    const r = await executeEdit(root, projectId, { mode: "update", symbolName: "target", filePath: "t.go", newContent: "return x + 100" })
    const after = readFileSync(path.join(root, "t.go"), "utf8")
    ck("go CRLF default format:true — formatted is measured true (gofmt ran)", r.formatted === true && r.formatting?.[0]?.formatter === "gofmt", JSON.stringify(r.formatting))
    ck("go CRLF default format:true — the file keeps CRLF (gofmt's LF output is repaired)", crlfCount(after) > 0 && loneLf(after) === 0, `crlf=${crlfCount(after)} loneLf=${loneLf(after)}`)
    ck("go CRLF default format:true — the repair is DECLARED on the formatting entry", r.formatting?.[0]?.lineEndingRestored === true, JSON.stringify(r.formatting))
  }
  // 2. .go CRLF, format:false → control: the engine's own splice preserves CRLF
  {
    const { root, projectId } = await fixture("go-noformat", { "t.go": GO_CRLF, "go.mod": "module fixture\n\ngo 1.21\n" })
    await executeEdit(root, projectId, { mode: "update", symbolName: "target", filePath: "t.go", newContent: "return x + 100", format: false })
    const after = readFileSync(path.join(root, "t.go"), "utf8")
    ck("go CRLF format:false — the engine's splice preserves CRLF (control)", crlfCount(after) > 0 && loneLf(after) === 0, `crlf=${crlfCount(after)} loneLf=${loneLf(after)}`)
  }
  // 3. .ts CRLF, default format:true → no formatter on this machine, engine-only
  {
    const { root, projectId } = await fixture("ts-default", { "t.ts": "export function target(): number {\r\n  return 1\r\n}\r\n" })
    const r = await executeEdit(root, projectId, { mode: "update", symbolName: "target", filePath: "t.ts", newContent: "return 2" })
    const after = readFileSync(path.join(root, "t.ts"), "utf8")
    ck("ts CRLF default format:true — no formatter installed so CRLF is preserved", r.formatted === false && crlfCount(after) > 0 && loneLf(after) === 0, `formatted=${r.formatted} crlf=${crlfCount(after)} loneLf=${loneLf(after)}`)
  }
  // 4. .go LF file (the ordinary case) — gofmt formatted:true, content formatted
  {
    const { root, projectId } = await fixture("go-lf", { "t.go": "package fixture\n\nfunc   target(x int) int {\n\treturn x + 1\n}\n", "go.mod": "module fixture\n\ngo 1.21\n" })
    const before = readFileSync(path.join(root, "t.go"), "utf8")
    const r = await executeEdit(root, projectId, { mode: "update", symbolName: "target", filePath: "t.go", newContent: "return x + 100" })
    const after = readFileSync(path.join(root, "t.go"), "utf8")
    ck("go LF default format:true — gofmt reformats the whole file (formatted:true)", r.formatted === true && before.includes("func   target") && after.includes("func target("), JSON.stringify({ formatted: r.formatted, after: after.slice(0, 60) }))
  }
  void ASTEngine
  const out = path.resolve("validation/tools/bb_edit/artifacts/formatting.json")
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", phase: "A-audit-formatting", generatedAt: new Date().toISOString(), summary: { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length }, checks }, null, 2) + "\n")
  console.log(`\nFORMATTING: ${checks.filter((c) => c.pass).length}/${checks.length} passed → ${out}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(2) })
