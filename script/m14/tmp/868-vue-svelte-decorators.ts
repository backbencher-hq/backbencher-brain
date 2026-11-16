// #868 follow-up measurement: do the SIBLING web analyzers (vue, svelte) share
// the javascript decorator defect in their script blocks? Measured through the
// real entry point (ASTEngine.parseFile) on temp files, since that is how
// production reads .vue/.svelte.
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const JS_SCRIPT = [
  "function sealed(target) { return target }",
  "function inject(name) { return () => undefined }",
  "",
  "@sealed",
  "class Service {",
  '  @inject("db")',
  "  pool = 1",
  "",
  "  @sealed",
  "  method() {}",
  "}",
  "export default Service",
  "",
].join("\n")

const VUE = `<template><div>{{ x }}</div></template>\n<script>\n${JS_SCRIPT}</script>\n`

const SVELTE = `<script>\n${JS_SCRIPT}</script>\n<div>{x}</div>\n`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const dir = mkdtempSync(path.join(tmpdir(), "m868-"))
  const cases = [
    { name: "Component.vue", src: VUE },
    { name: "Component.svelte", src: SVELTE },
  ]
  for (const c of cases) {
    const file = path.join(dir, c.name)
    writeFileSync(file, c.src)
    let res: any
    try {
      res = await ASTEngine.parseFile(file, c.src)
    } catch (e: any) {
      console.log(`===== ${c.name} : PARSE FAILED ${e?.message} =====`)
      continue
    }
    console.log(`===== ${c.name} =====`)
    console.log("--- symbols (decorators) ---")
    for (const s of res.symbols ?? []) {
      console.log(`   ${String(s.kind).padEnd(9)} ${s.name} decorators=${JSON.stringify(s.decorators ?? [])} lines=${JSON.stringify(s.metadata?.decoratorLines ?? null)}`)
    }
    console.log("--- relationships ---")
    for (const r of res.relationships ?? []) {
      const m = r.metadata ?? {}
      if (m.isDecorator || String(r.target) === "sealed" || String(r.target) === "inject") {
        console.log(`   L${r.line_number} ${String(r.type).padEnd(11)} ${r.source} -> ${r.target} meta=${JSON.stringify(m)}`)
      }
    }
    console.log("")
  }
}
main()
