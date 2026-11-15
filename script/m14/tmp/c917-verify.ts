// #917 verification: does the recovery give the wrapped definition a name, a
// Function scope, and stop its locals leaking as file-scope symbols?
import path from "node:path"
import { readFileSync } from "node:fs"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const REPO = "/home/ishaq2321/bb_tests/repositories/sqlite"
const CASES: Array<[string, string]> = [
  [
    "minimal wrapped (the issue's body)",
    `CMPP__EXPORT(int, cmpp_stream)( cmpp_input_f inF, void * inState,\n                 cmpp_output_f outF, void * outState ){\n  int rc = 0;\n  enum { BufSize = 1024 * 4 };\n  unsigned char buf[BufSize];\n  while( 0==rc && (rn==BufSize) && (0==(rc=inF(inState, buf, &rn))) ){\n    if(rn) rc = outF(outState, buf, rn);\n  }\n  return rc;\n}\n`,
  ],
  [
    "three-argument macro spelling (jni)",
    `S3JniApi(sqlite3_value_text16(),jstring,1value_1text16)(JNIEnv *env, jobject jObj, jlong jValue){\n  const void *pVal = (const void*)jValue;\n  return (*env)->NewStringUTF(env, "x");\n}\n`,
  ],
  [
    "CONTROL: a plain call chain then a block is not a definition",
    `void caller(void){\n  handler(1)(2);\n  { int nested = 1; (void)nested; }\n}\n`,
  ],
  [
    "CONTROL: a real function keeps its locals model",
    `static int g_counter = 7;\nint plain(int x){\n  int counter = x;\n  return counter + g_counter;\n}\n`,
  ],
]

for (const [label, src] of CASES) {
  const res: any = await parseFile("probe.c", src, { language: "c" })
  const syms = res.symbols ?? []
  const rels = res.relationships ?? []
  console.log(`\n#### ${label}`)
  for (const s of syms) {
    console.log(`   sym ${s.kind} ${s.name}  scope=${s.scope} vis=${s.visibility} ret=${s.returnType ?? "-"} params=${JSON.stringify((s.parameters ?? []).map((p: any) => p.name))} rec=${!!s.metadata?.recoveredFromMacroWrappedHeader}`)
  }
  console.log(`   edges:`)
  for (const r of rels.filter((r: any) => !["contains"].includes(String(r.type)))) {
    console.log(`     ${r.type} ${r.source} -> ${r.target} @${r.location?.startLine ?? "?"}`)
  }
}

for (const F of [`${REPO}/ext/wasm/libcmpp.c`, `${REPO}/ext/jni/src/c/sqlite3-jni.c`]) {
  const src = readFileSync(F, "utf8")
  const res: any = await parseFile(F, src, { language: "c" })
  const syms: any[] = res.symbols ?? []
  const rels: any[] = res.relationships ?? []
  const recovered = syms.filter((s) => s.metadata?.recoveredFromMacroWrappedHeader)
  console.log(`\n#### ${path.basename(F)}  symbols=${syms.length} edges=${rels.length}`)
  console.log(`   recovered macro-wrapped functions: ${recovered.length}`)
  console.log(`   samples: ${recovered.slice(0, 5).map((s) => `${s.name}@${s.range?.startLine}-${s.range?.endLine} ret=${s.returnType} params=${JSON.stringify((s.parameters ?? []).map((p: any) => p.name))}`).join(" | ")}`)
  for (const name of ["cmpp_stream", "cmpp_outputer_cleanup", "BufSize", "1value_1text16"]) {
    const hit = syms.filter((s) => s.name === name)
    console.log(`   ${name}: ${hit.length ? hit.map((h) => `${h.kind}@${h.range?.startLine} rec=${!!h.metadata?.recoveredFromMacroWrappedHeader}`).join(", ") : "absent"}`)
  }
  const bad = rels.filter((r) => r.target === "BufSize")
  console.log(`   edges -> BufSize: ${bad.length}${bad.length ? " " + bad.map((r: any) => `${r.type} ${r.source}->${r.target}`).join(" | ") : ""}`)
  const sourced = rels.filter((r) => r.source === "cmpp_stream")
  console.log(`   edges SOURCED at cmpp_stream: ${sourced.length} (e.g. ${sourced.slice(0, 4).map((r: any) => `${r.type}->${r.target}`).join(", ")})`)
}
