import { runLang } from "../run-fixtures"

const T: Record<string, (r: any) => any> = {
  "vue/data-keys-drop": (r: any) => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => !((s as any).metadata ?? {}).isDataKey) }),
  "vue/error-offset-revert": (r: any) => ({ ...r, errors: (r.errors ?? []).map((e: any) => ({ ...e, range: { ...(e.range ?? {}), startLine: 2 } })) }),
  "vue/index-revert": (r: any) => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => ({ ...s, range: { ...((s as any).range ?? {}), startIndex: 0 } })) }),
  "vue/chain-root-revert": (r: any) => ({ ...r, relationships: [...(r.relationships ?? []), { type: "uses", source: "member-chain", target: "id", confidence: 0.95, metadata: { isTemplateExpression: true } }] }),
  "vue/quoted-keys-revert": (r: any) => ({ ...r, symbols: [...(r.symbols ?? []).filter((s: any) => s.name !== "save-data"), { name: "\"save-data\"", kind: "method" }, { name: "[dyn]", kind: "method" }] }),
  "vue/lifecycle-drop": (r: any) => ({ ...r, symbols: (r.symbols ?? []).filter((s: any) => s.name !== "serverPrefetch") }),
  "vue/default-text-revert": (r: any) => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "go" ? { ...s, ownerName: undefined } : s)) }),
  "vue/payload-drop": (r: any) => ({ ...r, symbols: (r.symbols ?? []).map((s: any) => (s.name === "save" ? { ...s, parameters: [] } : s)) }),
}

async function main() {
  const mod: any = await import("../../../src/ast/real-vue-analyzer")
  const base: any = await runLang("vue")
  console.log(`baseline: fail=${base.fail}`)
  for (const [id, transform] of Object.entries(T)) {
    const mutant = {
      analyze: async (root: any, content: string, file: string, ctx: any) => transform(await new mod.RealVueAnalyzer().analyze(root, content, file, ctx)),
      transform,
    }
    const mutated: any = await runLang("vue", mutant as any)
    const caught = mutated.fail > base.fail
    const by = mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture).join(",")
    console.log(`${caught ? "CAUGHT" : "SURVIVED"}  ${id}  (${base.fail} -> ${mutated.fail}; ${by})`)
  }
}
main()
