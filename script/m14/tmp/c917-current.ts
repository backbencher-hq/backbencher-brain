// #917: what does the production analyzer emit today for the wrapped headers?
import path from "node:path"
import { readFileSync } from "node:fs"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const FILES = [
  "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c",
  "/home/ishaq2321/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c",
]

for (const F of FILES) {
  const src = readFileSync(F, "utf8")
  const res: any = await parseFile(F, src, { language: "c" })
  const syms: any[] = res.symbols ?? []
  const rels: any[] = res.relationships ?? []
  const line = (r: any) => r?.location?.startLine ?? r?.location?.start?.line ?? "?"
  console.log(`\n######## ${path.basename(F)}  symbols=${syms.length} relations=${rels.length}`)
  // the wrapped function names we know must exist
  for (const name of ["cmpp_stream", "cmpp_outputer_cleanup", "cmpp_isspace", "Java_org_sqlite_jni_capi_SQLTester_installCustomExtensions"]) {
    const hit = syms.filter((s) => s.name === name)
    console.log(`   symbol ${name}: ${hit.length ? hit.map((h) => `${h.kind}@${h.range?.startLine}`).join(", ") : "ABSENT"}`)
  }
  // file-scope symbols that are locals of the bodies: enum members like BufSize
  const buf = syms.filter((s) => s.name === "BufSize")
  console.log(`   symbols named BufSize: ${buf.length}`, buf.slice(0, 4).map((b) => `${b.kind}@${b.range?.startLine} scope=${b.scope}`).join(" | "))
  // any symbol declared inside the region
  const region = syms.filter((s) => (s.range?.startLine ?? 0) > 8700 && (s.range?.startLine ?? 0) < 8800)
  console.log(`   symbols in L8700-8800: ${region.length} -> ${region.map((s) => `${s.name}(${s.kind}@${s.range?.startLine},scope=${s.scope})`).slice(0, 14).join(", ")}`)
  // edges sourced at global pointing to BufSize
  const bad = rels.filter((r) => r.target === "BufSize")
  console.log(`   edges -> BufSize: ${bad.length}`, bad.slice(0, 6).map((r) => `${r.type} ${r.source}->${r.target}@${line(r)}`).join(" | "))
  // contains edges for cmpp_stream
  const contains = rels.filter((r) => r.target === "cmpp_stream")
  console.log(`   edges -> cmpp_stream: ${contains.length}`, contains.slice(0, 6).map((r) => `${r.type} ${r.source}->${r.target}@${line(r)}`).join(" | "))
}
