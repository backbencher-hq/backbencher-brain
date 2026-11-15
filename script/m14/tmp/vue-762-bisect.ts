// Which sub-expression kills the prop-default factory body calls?
import * as fs from "fs"

async function show(tag: string, file: string, src?: string) {
  const engine: any = await import("../../../src/ast/engine")
  const content = src ?? fs.readFileSync(file, "utf8")
  const r: any = await engine.ASTEngine.parseFile(file, content)
  const calls = (r.relationships ?? []).filter((e: any) => e.type === "calls").map((e: any) => `${e.source}->${e.target}`)
  const symbols = (r.symbols ?? []).map((s: any) => s.name)
  console.log(`${tag}: calls=${JSON.stringify(calls)} symbols=${JSON.stringify(symbols)}`)
}

async function main() {
  const REPO = "/home/ishaq2321/bb_tests/repositories"
  await show("CORPUS", `${REPO}/vue-element-admin/src/components/MarkdownEditor/index.vue`)
  await show("A (+ +new Date())", "script/m14/tmp/v762b/A.vue")
  await show("B (no unary plus)", "script/m14/tmp/v762b/B.vue")
  await show("C (new Date() no plus)", "script/m14/tmp/v762b/C.vue")
  await show("D (preceding default: '')", "script/m14/tmp/v762b/D.vue")
  await show("E (two factories)", "script/m14/tmp/v762b/E.vue")
  await show("F (corpus props block)", "script/m14/tmp/v762b/F.vue")
}
main().catch((e) => { console.error(e); process.exit(1) })
