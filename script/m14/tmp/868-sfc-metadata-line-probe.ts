// #868 seam measurement: on an SFC-delegated edge, do `line_number` and the
// metadata LINE MIRRORS (`decoratorLine`, `line`) name the SAME line — and is
// that line the one the source text actually writes the thing on? Printed next
// to the file's own numbered text, so the answer is read, not argued.
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
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
  const dir = mkdtempSync(path.join(tmpdir(), "m868seam-"))
  for (const c of [
    { name: "Component.vue", src: VUE },
    { name: "Component.svelte", src: SVELTE },
  ]) {
    const file = path.join(dir, c.name)
    writeFileSync(file, c.src)
    console.log(`===== ${c.name} — the file's own lines =====`)
    c.src.split("\n").forEach((l, i) => {
      if (/@|class Service|pool|method\(\)/.test(l)) console.log(`   L${i + 1}: ${l}`)
    })
    const res: any = await ASTEngine.parseFile(file, c.src)
    console.log("--- delegated rows: line_number vs metadata line mirrors ---")
    for (const r of res.relationships ?? []) {
      const m = r.metadata ?? {}
      const mirrors = Object.entries(m).filter(([k, v]) => typeof v === "number" && /line/i.test(k))
      if (r.metadata?.sfcDelegated !== true) continue
      if (!mirrors.length && r.metadata?.isDecorator !== true) continue
      console.log(`   ${String(r.type).padEnd(11)} ${r.source} -> ${r.target}  line_number=${r.line_number} mirrors=${JSON.stringify(Object.fromEntries(mirrors))} offset=${m.sfcLineOffset}`)
    }
    console.log("")
  }
}
main()
