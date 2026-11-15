// #743 bucket decision for `preproc_header_name`: does the analyzer CONSUME the
// header-name node (emitting an include-dependency for a header that is only ever
// named inside `__has_include`), or does every include edge come from a real
// `#include` directive?
//
// This distinguishes the two buckets that a grep cannot:
//   handled_verified — the analyzer emits correctly for the construct the node
//                      appears in
//   internal_silent  — the node is the condition's own argument and the analyzer
//                      correctly emits nothing for it (the include edge belongs to
//                      the `#include`, if there is one)
//
// Run: bun script/m14/tmp/c743-header-name.ts
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const C_ONLY_CONDITION = `#if __has_include(<only_here_c.h>)
#  define HAVE_ONLY_HERE 1
#endif

int after_guard(void) {
  return 0;
}
`

const CPP_ONLY_CONDITION = `#if __has_include(<only_here_cpp>) && __has_include("quoted_only.hpp")
#  define HAVE_ONLY_HERE 1
#endif

int after_guard() {
  return 0;
}
`

async function main() {
  for (const [name, src] of [
    ["onlycond.c", C_ONLY_CONDITION],
    ["onlycond.cpp", CPP_ONLY_CONDITION],
  ] as Array<[string, string]>) {
    const res: any = await ASTEngine.parseFile(name, src)
    console.log(`\n=== ${name} ===`)
    const rels = res?.relationships ?? []
    console.log(`  relationships: ${rels.length}`)
    for (const r of rels) {
      console.log(
        `    ${String(r.type).padEnd(18)} -> ${String(r.target).padEnd(24)} line=${r.line_number}` +
          `${r.metadata?.relationshipType ? ` (${r.metadata.relationshipType})` : ""}` +
          `${r.metadata?.isIncludeDependency ? " isIncludeDependency" : ""}`,
      )
    }
    console.log(`  symbols: ${(res?.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`).join(", ") || "(none)"}`)
    const imports = (res as any)?.imports ?? []
    console.log(`  imports: ${JSON.stringify(imports)}`)
  }
}

await main()
