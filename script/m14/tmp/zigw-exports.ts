/**
 * ZIG WAVE 4 — the `exports` GATE (Z33), site-keyed and bidirectional.
 *
 * Key: `(target, line)`, the name and the line it is written on. Source is the
 * compilation unit, `(file)`, so it carries no discriminating information here —
 * and it is checked anyway, so a future change of marker shows up as a class of
 * PHANTOM rows rather than as a silent redefinition.
 *
 * The interesting half of this class is what it must NOT contain: a `pub` member
 * of a container is a `contains` edge and a `visibility`, not an export (Z20's
 * ruling, "an export must name an IMPORTABLE unit"). A gate that only counted
 * edges would pass while the surface filled up with member names an importer
 * cannot bind, so the container case is counted and reported separately.
 *
 * Usage: npx tsx script/m14/tmp/zigw-exports.ts [files] [--out <path>]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigExports } from "../zig-truth"

async function main(): Promise<void> {
  await init()
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : null
  const limitArg = args.find((a) => /^\d+$/.test(a))
  const limit = limitArg ? Number(limitArg) : 400
  const files = zigFiles(["zig", "zls", "ghostty"], limit)

  let agree = 0, phantom = 0, missing = 0, noLine = 0, wrongSource = 0
  let containerPubs = 0
  const phantomEx: string[] = [], missingEx: string[] = []
  const CONTAINERS = new Set(["struct_declaration", "union_declaration", "enum_declaration", "opaque_declaration", "error_set_declaration"])
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const rel = f.split("/repositories/")[1] ?? f
    const res: any = analyzer().analyze(root, src, f)

    // the `pub`-inside-a-container population, which must NOT be exported
    const memberPubs = new Set<string>()
    const memberPubSites = new Set<string>()
    const scan = (n: any): void => {
      let inContainer = false
      let cur = n.parent
      while (cur) {
        if (CONTAINERS.has(cur.type)) { inContainer = true; break }
        if (cur.type === "source_file") break
        cur = cur.parent
      }
      if (inContainer && (n.type === "variable_declaration" || n.type === "function_declaration")) {
        let isPub = false
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && (c.type === "pub" || c.type === "export")) { isPub = true; break }
        }
        if (isPub) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "identifier") {
              memberPubs.add(String(c.text))
              memberPubSites.add(`${c.text}|${(n.startPosition?.row ?? 0) + 1}`)
              break
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c) }
    }
    scan(root)
    containerPubs += memberPubs.size

    const truth = deriveZigExports(root)
    const truthKeys = new Set(truth.map((t) => `${t.target}|${t.line}`))
    const published = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (r.type !== "exports") continue
      if (String(r.source) !== "(file)") wrongSource++
      if (typeof r.line_number !== "number" || r.line_number <= 0) { noLine++; continue }
      const k = `${r.target}|${r.line_number}`
      published.add(k)
      if (!truthKeys.has(k)) {
        phantom++
        if (phantomEx.length < 12) phantomEx.push(`${rel}  PHANTOM exports -> ${r.target} (L${r.line_number})`)
      }
      if (memberPubSites.has(`${r.target}|${r.line_number}`)) {
        phantomEx.length < 24 && phantomEx.push(`${rel}:${r.line_number}  exports -> ${r.target}  is ALSO a container member's \`pub\` (Z20 says that is a contains edge, not an export)`)
      }
    }
    for (const k of truthKeys) if (!published.has(k)) {
      missing++
      if (missingEx.length < 12) missingEx.push(`${rel}  MISSING exports -> ${k.split("|")[0]} (L${k.split("|")[1]})`)
    }
    agree += [...truthKeys].filter((k) => published.has(k)).length
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  console.log(`AGREE:        ${agree}`)
  console.log(`MISSING:      ${missing}   <- a file-scope \`pub\` the analyzer does not publish`)
  console.log(`PHANTOM:      ${phantom}   <- a published export the tree does not have`)
  console.log(`NO line_number: ${noLine}   (M60.A7: the exported name's own line)`)
  console.log(`wrong source marker: ${wrongSource}   <- \`(file)\` is the compilation unit; \`(global)\` is the expression scope`)
  console.log(`container-member \`pub\`s in these files: ${containerPubs}   <- deliberately NOT exports (Z20)`)
  for (const e of phantomEx) console.log("  " + e)
  for (const e of missingEx) console.log("  " + e)
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      files: files.length,
      totals: { agree, missing, phantom, noLine, wrongSource, containerMemberPubs: containerPubs },
      verdict: missing === 0 && phantom === 0 && noLine === 0 && wrongSource === 0 ? "clean" : "DEFECT",
    }, null, 2) + "\n")
    console.log(`\nwrote ${out}`)
  }
  process.exit(missing === 0 && phantom === 0 && noLine === 0 && wrongSource === 0 ? 0 : 1)
}
void main()
