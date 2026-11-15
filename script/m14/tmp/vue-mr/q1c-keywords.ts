// Q1c — two suspicions from Q3:
//   (1) a `uses` edge whose TARGET is a language keyword (`implements`),
//   (2) the owner/contains name when a `name:` option renames the component.
import { vue, rels, syms, probe, report } from "./harness"

const KEYWORDS = new Set([
  "implements", "extends", "class", "const", "let", "var", "function", "return",
  "new", "this", "typeof", "instanceof", "void", "delete", "in", "of", "if", "else",
  "for", "while", "switch", "case", "break", "continue", "import", "export", "default",
  "from", "as", "async", "await", "yield", "try", "catch", "finally", "throw", "do",
  "interface", "type", "enum", "namespace", "declare", "readonly", "static", "public",
  "private", "protected", "abstract", "key", "string", "number", "boolean", "symbol",
  "bigint", "object", "unknown", "any", "never", "null", "undefined", "true", "false",
  "stringify", "then", "catch", "map", "filter",
])

async function main() {
  console.log("=== Q1c.1  keyword targets on a plain script block (no Options API) ===")
  {
    const src = [
      "<template><p/></template>",                        // 1
      "<script>",                                          // 2
      "export class Impl implements Service {",            // 3
      "  run() { return 1 }",                              // 4
      "}",                                                 // 5
      "</script>",                                         // 6
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Kw.vue")
    const bad = rels(r).filter((x: any) => KEYWORDS.has(String(x.target)))
    console.log(`    keyword-target edges: ${JSON.stringify(bad.map((x: any) => `${x.type} ${x.source}->${x.target} @${x.line_number}`))}`)
    for (const x of bad) {
      console.log(`      line ${x.line_number}: ${src.split("\n")[x.line_number - 1]}`)
    }
  }

  console.log("\n=== Q1c.2  the same file as a .ts file — is the keyword edge vue's or the sub-analyzer's? ===")
  {
    const tsSrc = "export class Impl implements Service {\n  run() { return 1 }\n}\n"
    const { plain } = await import("./harness")
    const r = await plain(tsSrc, "/tmp/probe/Kw.ts")
    const bad = rels(r).filter((x: any) => KEYWORDS.has(String(x.target)))
    console.log(`    typescript: keyword-target edges: ${JSON.stringify(bad.map((x: any) => `${x.type} ${x.source}->${x.target} @${x.line_number}`))}`)
    const r2 = await plain("export class Impl extends Base { run() { return 1 } }\n", "/tmp/probe/Kw2.ts")
    console.log(`    typescript extends: ${JSON.stringify(rels(r2, "extends").map((x: any) => `${x.source}->${x.target}`))}`)
  }

  console.log("\n=== Q1c.3  owner/contains naming when a `name:` option renames the component ===")
  {
    const src = [
      "<template><p/></template>",              // 1
      "<script>",                                // 2
      "export default {",                        // 3
      "  name: 'Widget',",                       // 4
      "  props: { label: String },",             // 5
      "  methods: { save() {} },",               // 6
      "}",                                       // 7
      "</script>",                               // 8
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Owner.vue")
    for (const s of r.symbols ?? []) {
      console.log(`    SYM ${String(s.kind).padEnd(8)} name=${String(s.name).padEnd(9)} owner=${s.ownerName ?? "-"} ownerKind=${s.ownerKind ?? "-"} scope=${s.scope ?? "-"}`)
    }
    for (const rel of r.relationships ?? []) {
      if (String(rel.type) === "contains" || String(rel.type) === "instantiates" || String(rel.type) === "uses") {
        console.log(`    REL ${String(rel.type).padEnd(11)} ${String(rel.source).padEnd(9)} -> ${String(rel.target).padEnd(9)} line=${(rel as any).line_number}`)
      }
    }
  }

  console.log("\n=== Q1c.4  TWO class symbols for one component — is the graph ambiguous? ===")
  {
    const src = [
      "<template><p/></template>",              // 1
      "<script>",                                // 2
      "export default {",                        // 3
      "  name: 'Widget',",                       // 4
      "  props: { label: String },",             // 5
      "}",                                       // 6
      "</script>",                               // 7
    ].join("\n")
    const r = await vue(src, "/tmp/probe/TwoClass.vue")
    const classes = (r.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`    class symbols: ${JSON.stringify(classes.map((s: any) => ({ name: s.name, md: s.metadata, L: s.range?.startLine })))}`)
    const owners = new Set((r.symbols ?? []).map((s: any) => s.ownerName).filter(Boolean))
    const classNames = new Set(classes.map((s: any) => s.name))
    const dangling = [...owners].filter((o) => !classNames.has(String(o)))
    console.log(`    owners not among the class symbols: ${JSON.stringify(dangling)}`)
  }

  console.log("\n=== Q1c.5  a component with NO name option — single class? ===")
  {
    const src = [
      "<template><p/></template>",              // 1
      "<script>",                                // 2
      "export default {",                        // 3
      "  props: { label: String },",             // 4
      "}",                                       // 5
      "</script>",                               // 6
    ].join("\n")
    const r = await vue(src, "/tmp/probe/NoName.vue")
    const classes = (r.symbols ?? []).filter((s: any) => s.kind === "class")
    console.log(`    class symbols: ${JSON.stringify(classes.map((s: any) => ({ name: s.name, md: s.metadata, L: s.range?.startLine })))}`)
  }

  report()
}
main()
