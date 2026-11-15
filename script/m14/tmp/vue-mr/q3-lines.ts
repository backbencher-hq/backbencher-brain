// Q3 — LINE NUMBERS. Every script-derived artifact must be shifted from
// script coordinates to SFC coordinates: symbols, imports, exports, errors,
// relationship line_number, metadata line mirrors, columns, and byte indices.
// Template artifacts are already file-coordinates and must NOT move.
import * as fs from "fs"
import { vue, rels, syms, probe, report } from "./harness"

const lines = (s: string) => s.split("\n")

/** Ground truth: for each 1-based line number, the text of that line. */
function lineAt(src: string, n: number): string {
  return lines(src)[n - 1] ?? ""
}

async function main() {
  console.log("=== Q3.1  the seam shift: every script artifact on a template-above-script SFC ===")
  {
    const src = [
      "<template>",                       // 1
      "  <MyChild :label=\"lab\" />",     // 2
      "  <p>{{ count }}</p>",             // 3
      "</template>",                      // 4
      "",                                 // 5
      "<script>",                         // 6
      "import Child from './Child.vue'",  // 7
      "import { ref } from 'vue'",        // 8
      "",                                 // 9
      "export default {",                 // 10
      "  name: 'Widget',",                // 11
      "  props: { label: String },",      // 12
      "  data() { return { count: 0 } },",// 13
      "  methods: {",                     // 14
      "    save(id) { return this.$emit('save', id) },", // 15
      "  },",                             // 16
      "}",                                // 17
      "</script>",                        // 18
      "<style scoped>",                   // 19
      ".a { color: red }",                // 20
      "</style>",                         // 21
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Widget.vue")
    const rows: string[] = []
    for (const s of r.symbols ?? []) {
      const L = s.range?.startLine
      rows.push(`    SYM  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(14)} line=${L} "${lineAt(src, L).trim().slice(0, 52)}"`)
    }
    for (const i of r.imports ?? []) {
      const L = i.range?.startLine
      rows.push(`    IMP  ${String(i.source).padEnd(14)} line=${L} "${lineAt(src, L).trim().slice(0, 52)}"`)
    }
    for (const e of r.exports ?? []) {
      const L = e.range?.startLine
      rows.push(`    EXP  ${String(e.name).padEnd(14)} line=${L} "${lineAt(src, L).trim().slice(0, 52)}"`)
    }
    for (const rel of r.relationships ?? []) {
      const L = (rel as any).line_number
      rows.push(`    REL  ${String(rel.type).padEnd(11)} ${String(rel.source).padEnd(9)}->${String(rel.target).padEnd(12)} line=${L} "${typeof L === "number" ? lineAt(src, L).trim().slice(0, 44) : ""}"`)
    }
    for (const e of r.errors ?? []) {
      rows.push(`    ERR  line=${e.range?.startLine} "${lineAt(src, e.range?.startLine ?? 0).trim().slice(0, 44)}"`)
    }
    console.log(rows.join("\n"))
  }

  console.log("\n=== Q3.2  COLUMN coherence on the script's FIRST line (a one-line <script>) ===")
  {
    const src = [
      "<template><div/></template>",  // 1
      "<script>const a = 1",           // 2   <- script body starts at column 9 (0-based 8)
      "export default { name: 'W', props: { p: Number } }", // 3
      "</script>",                     // 4
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Inline.vue")
    for (const s of r.symbols ?? []) {
      const L = s.range?.startLine
      const src1 = lineAt(src, L)
      const col = s.range?.startColumn
      // 1-based column -> index into the line
      const token = typeof col === "number" ? src1.slice(col - 1, col - 1 + String(s.name).length) : ""
      console.log(`    SYM ${s.kind} ${s.name} L${L} C${col} -> line-slice "${token}" ${token === s.name ? "OK" : "MISALIGNED"}`)
    }
  }

  console.log("\n=== Q3.3  BYTE-INDEX coherence: startIndex must point at the name in the FILE ===")
  {
    const src = [
      "<template>",                      // 1
      "  <p>{{ n }}</p>",                // 2
      "</template>",                     // 3
      "",                                // 4
      "<script>",                        // 5
      "const alpha = 1",                 // 6
      "function beta() {}",              // 7
      "  return alpha",                  // 8
      "}",                               // 9
      "</script>",                       // 10
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Idx.vue")
    for (const s of r.symbols ?? []) {
      const i0 = s.range?.startIndex
      const i1 = s.range?.endIndex
      if (typeof i0 !== "number") { console.log(`    SYM ${s.name}: no startIndex`); continue }
      const slice = src.slice(i0, i1 ?? i0 + s.name.length)
      const isName = src.slice(i0, i0 + s.name.length) === s.name
      console.log(`    SYM ${String(s.name).padEnd(8)} startIndex=${i0} slice="${slice.replace(/\n/g, "\\n").slice(0, 40)}" ${isName ? "starts at the name OK" : "STARTS ELSEWHERE"}`)
    }
    // and the LINE the index implies must equal the line it reports
    for (const s of r.symbols ?? []) {
      const i0 = s.range?.startIndex
      if (typeof i0 !== "number") continue
      const implied = src.slice(0, i0).split("\n").length
      const reported = s.range?.startLine
      console.log(`    LINE/INDEX ${String(s.name).padEnd(8)} index-implied line=${implied} reported startLine=${reported} ${implied === reported ? "coherent" : "INCOHERENT"}`)
    }
  }

  console.log("\n=== Q3.4  MULTI-BLOCK SFC: a plain <script> AND a <script setup> ===")
  {
    const src = [
      "<template>",                                  // 1
      "  <p>{{ a }}{{ b }}</p>",                     // 2
      "</template>",                                 // 3
      "<script>",                                    // 4
      "export default {",                            // 5
      "  name: 'W',",                                // 6
      "  data: () => ({ a: 1 }),",                   // 7
      "}",                                           // 8
      "</script>",                                   // 9
      "<script setup>",                              // 10
      "const b = 2",                                 // 11
      "const gamma = 3",                             // 12
      "</script>",                                   // 13
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Dual.vue")
    for (const s of r.symbols ?? []) {
      const L = s.range?.startLine
      console.log(`    SYM ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(8)} line=${L} "${lineAt(src, L).trim()}" ${lineAt(src, L).includes(String(s.name)) ? "" : "  <-- LINE DOES NOT NAME IT"}`)
    }
  }

  console.log("\n=== Q3.5  TEMPLATE lines: an identifier on a wrapped interpolation ===")
  {
    const src = [
      "<template>",                                   // 1
      "  <div>",                                      // 2
      "    {{",                                       // 3
      "      count +",                                // 4
      "      total",                                  // 5
      "    }}",                                       // 6
      "  </div>",                                     // 7
      "</template>",                                  // 8
      "<script>",                                     // 9
      "export default { data: () => ({ count: 1, total: 2 }) }", // 10
      "</script>",                                    // 11
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Wrap.vue")
    for (const rel of rels(r, "uses")) {
      const L = (rel as any).line_number
      console.log(`    USES ${rel.source}->${rel.target} line=${L} "${typeof L === "number" ? lineAt(src, L).trim() : ""}" ${typeof L === "number" && lineAt(src, L).includes(String(rel.target)) ? "OK" : "WRONG LINE"}`)
    }
  }

  console.log("\n=== Q3.6  a script that starts on line 1 (no template above) ===")
  {
    const src = [
      "<script>",                       // 1
      "const x = 1",                    // 2
      "</script>",                      // 3
      "<template><p/></template>",      // 4
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Top.vue")
    for (const s of r.symbols ?? []) {
      const L = s.range?.startLine
      const col = s.range?.startColumn
      const l = lineAt(src, L)
      const tok = typeof col === "number" ? l.slice(col - 1, col - 1 + String(s.name).length) : ""
      console.log(`    SYM ${s.name} L${L} C${col} slice="${tok}" ${tok === s.name ? "OK" : "MISALIGNED"}`)
    }
  }

  console.log("\n=== Q3.7  script ERRORS: a syntax error on a known SFC line ===")
  {
    const src = [
      "<template><p/></template>",   // 1
      "<script>",                    // 2
      "const a = 1",                 // 3
      "function ( {",                // 4  <- broken
      "</script>",                   // 5
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Broken.vue")
    console.log(`    errors: ${(r.errors ?? []).length}`)
    for (const e of r.errors ?? []) {
      const L = e.range?.startLine
      console.log(`      ERR line=${L} col=${e.range?.startColumn} "${lineAt(src, L ?? 0).trim()}" sev=${e.severity} msg=${e.message?.slice(0, 60)}`)
    }
  }

  console.log("\n=== Q3.8  metadata LINE MIRRORS on a shifted seam (#868) ===")
  {
    const src = [
      "<template><p/></template>",       // 1
      "",                                 // 2
      "<script>",                         // 3
      "import { Service } from './svc'",  // 4
      "",                                 // 5
      "@sealed",                          // 6
      "export class Impl implements Service {", // 7
      "  run() {}",                       // 8
      "}",                                // 9
      "</script>",                        // 10
    ].join("\n")
    const r = await vue(src, "/tmp/probe/Dec.vue")
    for (const rel of r.relationships ?? []) {
      const md: any = rel.metadata ?? {}
      const L = (rel as any).line_number
      const lineKeys = Object.entries(md).filter(([k, v]) => /line/i.test(k) && (typeof v === "number" || Array.isArray(v)))
      if (!L && !lineKeys.length) continue
      console.log(`    REL ${rel.type} ${rel.source}->${rel.target} line_number=${L} line="${lineAt(src, L).trim().slice(0, 40)}"`)
      for (const [k, v] of lineKeys) console.log(`        md.${k} = ${JSON.stringify(v)}  -> "${lineAt(src, typeof v === "number" ? v : (v as any[])[0]).trim().slice(0, 40)}"`)
    }
    for (const s of r.symbols ?? []) {
      const md: any = s.metadata ?? {}
      const lineKeys = Object.entries(md).filter(([k, v]) => /line/i.test(k) && (typeof v === "number" || Array.isArray(v)))
      if (!lineKeys.length) continue
      console.log(`    SYM ${s.name}`)
      for (const [k, v] of lineKeys) console.log(`        md.${k} = ${JSON.stringify(v)}  -> "${lineAt(src, typeof v === "number" ? v : (v as any[])[0]).trim().slice(0, 40)}"`)
    }
  }

  console.log("\n=== Q3.9  the SFC component symbol's own range ===")
  {
    const src = "<template><p/></template>\n<script>\nexport default { name: 'W' }\n</script>\n<style>.a{}</style>\n"
    const r = await vue(src, "/tmp/probe/Range.vue")
    for (const s of r.symbols ?? []) {
      const rg = s.range
      const i0 = rg?.startIndex ?? 0
      const i1 = rg?.endIndex ?? src.length
      console.log(`    SYM ${s.kind} ${s.name} L${rg?.startLine}-${rg?.endLine} idx ${i0}-${i1} slice="${src.slice(i0, i1).replace(/\n/g, "\\n").slice(0, 60)}"`)
    }
  }

  report()
}
main()
