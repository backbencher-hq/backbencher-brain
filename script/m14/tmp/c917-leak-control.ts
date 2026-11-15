// #917 control: does a NORMAL function's local `enum { BufSize }` get emitted
// at file scope? If no, the recovered case's suppression is not a loss — it is
// the same contract applied to a header that used to be unreadable.
import path from "node:path"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const NORMAL = `
int normal_fn(void){
  int rc = 0;
  enum { BufSize = 1024 * 4 };
  unsigned char buf[BufSize];
  return rc;
}
`

const WRAPPED = `
CMPP__EXPORT(int, wrapped_fn)(void){
  int rc = 0;
  enum { BufSize = 1024 * 4 };
  unsigned char buf[BufSize];
  return rc;
}
`

for (const [label, src] of [["NORMAL (readable header)", NORMAL], ["WRAPPED (#917 recovery)", WRAPPED]] as const) {
  const r: any = await parseFile("probe.c", src, { language: "c" } as any).catch(async () => {
    const m: any = await import(path.resolve("src/ast/real-c-analyzer.ts"))
    return await new m.RealCAnalyzer().analyze(src, "probe.c")
  })
  const syms = (r.symbols ?? []).map((s: any) => `${s.line}:${s.kind}:${s.name}`)
  const rels = (r.relationships ?? r.rels ?? []).map(
    (x: any) => `${x.line}:${x.type}:${x.source}->${x.target}`,
  )
  console.log(`== ${label} ==`)
  console.log("  symbols:", syms.join(" | ") || "(none)")
  console.log("  rels:", rels.join(" | ") || "(none)")
}
