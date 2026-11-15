// Does the libcmpp.c context (`#ifdef __cplusplus / extern "C" {` opening a brace
// the C parse cannot close until much later) reproduce the DECLARATION spelling?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const CASES: Array<[string, string]> = [
  [
    "wrapper-c",
    `typedef unsigned long cmpp_size_t;
void helperTarget(void);
#ifdef __cplusplus
extern "C" {
#endif

CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){
  return sqlite3_realloc64(p, n);
}

#ifdef __cplusplus
}
#endif
`,
  ],
  [
    "wrapper-c-next",
    `typedef unsigned long cmpp_size_t;
void helperTarget(void);
#ifdef __cplusplus
extern "C" {
#endif

CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){
  return sqlite3_realloc64(p, n);
}
CMPP__EXPORT(void *, cmpp_follow)(size_t n){
  return 0;
}

#ifdef __cplusplus
}
#endif
`,
  ],
  [
    "bare-two-params",
    `CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){
  return sqlite3_realloc64(p, n);
}
`,
  ],
]

for (const [label, src] of CASES) {
  const root = parser.parse(src).rootNode
  console.log(`\n#### ${label} hasError=${root.hasError}`)
  // find the site by name text
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    if ((n.type === "function_definition" || n.type === "declaration") && n.text.includes("cmpp_mrealloc")) {
      console.log(`   node=${n.type} type=${n.childForFieldName("type")?.type ?? "-"} declarator=${n.childForFieldName("declarator")?.type ?? "-"} body=${n.childForFieldName("body")?.type ?? "-"}`)
      console.log(`   children: ${Array.from({ length: n.namedChildCount }, (_, i) => `${n.namedChild(i).type}${n.namedChild(i).isError ? "(ERR)" : ""}[${JSON.stringify(n.namedChild(i).text.slice(0, 35))}]`).join(" | ")}`)
      console.log(`   next sibling: ${n.nextSibling ? `${n.nextSibling.type}:${JSON.stringify(n.nextSibling.text.slice(0, 20))}` : "(none)"}`)
      console.log(`   parent chain: ${(() => { const c: string[] = []; let p = n.parent; while (p) { c.push(p.type + (p.isError ? "(ERR)" : "")); p = p.parent } return c.join(" < ") })()}`)
    }
    if (n.type === "macro_type_specifier" && n.text.includes("cmpp_mrealloc")) {
      console.log(`   MTS namedChildren: ${n.namedChildren.map((k: any) => `${k.type}:${JSON.stringify(k.text.slice(0, 25))}`).join(" | ")}`)
    }
    for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
  }
}
