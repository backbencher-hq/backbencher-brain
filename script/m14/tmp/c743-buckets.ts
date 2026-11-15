// #743 completeness buckets: what DOES the analyzer do with the three node types
// the inventory gate reports as unclassified (`preproc_header_name`,
// `macro_prefixed_type_specifier`, `macro_specifier`)?
//
// The gate's buckets are not labels of convenience:
//   handled_verified : the analyzer emits CORRECTLY for this type (probe-confirmed)
//   internal_silent  : container/literal/keyword that correctly emits nothing
//   gap              : the analyzer should emit and does not
//
// So the classification cannot be decided by grepping for the type name, and the
// first version of this probe could not decide it either: it walked
// `parseFile`'s return value, which does not carry the tree, so every
// "tree contains X" read false for the wrong reason. This version parses with the
// PINNED wasm directly (child(i) API, the same convention as c917-root.ts) and
// prints the analyzer's own output beside it.
//
// Run: bun script/m14/tmp/c743-buckets.ts
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const C_SRC = `#if __has_include(<sys/types.h>)
#  include <sys/types.h>
#endif

JNIEXPORT void JNICALL Java_probe_run(JNIEnv *env, jobject self) {
  return;
}

MYAPI int probe_plain(void) {
  return 1;
}
`

const CPP_SRC = `#if __has_include(<meta>) && __has_include(<ranges>)
#  include <meta>
#endif

namespace probe {
FMT_EXPORT void run_loud(int x) {
  (void)x;
}

std::string probe_plain() {
  return "";
}
}
`

const WANTED = ["preproc_header_name", "macro_prefixed_type_specifier", "macro_specifier"]

async function treeTypes(wasm: string, src: string): Promise<{ types: Set<string>; where: Map<string, string[]> }> {
  const lang = await (L as any).load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const parser = new P()
  parser.setLanguage(lang)
  const root = parser.parse(src).rootNode
  const types = new Set<string>()
  const where = new Map<string, string[]>()
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    types.add(n.type)
    if (WANTED.includes(n.type)) {
      const list = where.get(n.type) ?? []
      list.push(`L${n.startPosition.row + 1} "${n.text.replace(/\n/g, "\\n").slice(0, 40)}" parent=${n.parent?.type ?? "-"}`)
      where.set(n.type, list)
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  return { types, where }
}

async function main() {
  const cases: Array<[string, string, string, string]> = [
    ["c", "probe.c", "tree-sitter-c.wasm", C_SRC],
    ["cpp", "probe.cpp", "tree-sitter-cpp.wasm", CPP_SRC],
  ]
  for (const [lang, name, wasm, src] of cases) {
    const { types, where } = await treeTypes(wasm, src)
    const res: any = await ASTEngine.parseFile(name, src)

    console.log(`\n================ ${lang} (${name}) ================`)
    console.log(`  named node types in the tree: ${types.size}`)
    for (const t of WANTED) {
      const sites = where.get(t)
      console.log(`  ${t}: ${sites ? `${sites.length} site(s)` : "ABSENT"}`)
      for (const s of sites ?? []) console.log(`      ${s}`)
    }
    console.log("  analyzer symbols:")
    for (const s of res?.symbols ?? []) {
      const md = s.metadata ?? {}
      console.log(
        `    ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(26)} line=${s.range?.startLine}` +
          `${md.returnType ? ` returnType=${md.returnType}` : ""}` +
          `${md.annotations ? ` annotations=${JSON.stringify(md.annotations).slice(0, 50)}` : ""}`,
      )
    }
    console.log("  analyzer relationships:")
    for (const r of res?.relationships ?? []) {
      console.log(
        `    ${String(r.type).padEnd(18)} ${String(r.from ?? "-").padEnd(18)} -> ${String(r.target).padEnd(22)} line=${r.line_number}` +
          `${r.metadata?.relationshipType ? ` (${r.metadata.relationshipType})` : ""}`,
      )
    }
  }
}

await main()
