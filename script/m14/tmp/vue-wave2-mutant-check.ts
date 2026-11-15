import { runLang } from "../run-fixtures"
const T: Record<string, (r: any) => any> = {
  "vue/string-args-revert": (r: any) => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "template-string-args", target: "save", confidence: 0.95, metadata: { isTemplateExpression: true } }] }),
  "vue/arrow-data-drop": (r: any) => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !(s.name === "count" && (s as any).ownerName === "arrow-data")) }),
  "vue/decorated-default-revert": (r: any) => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "go" ? { ...s, ownerName: undefined } : s)) }),
}
async function main() {
  const base: any = await runLang("vue")
  console.log(`baseline: fail=${base.fail}`)
  for (const [id, transform] of Object.entries(T)) {
    const mutant = { analyze: async (...a: any[]) => transform(await (await import("../../../src/ast/real-vue-analyzer")).RealVueAnalyzer), transform }
    const mutated: any = await runLang("vue", mutant as any)
    const caught = mutated.fail > base.fail
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${id} (${base.fail} -> ${mutated.fail})`)
  }
}
main()
