/**
 * CL-G1 — the index-access gap, PRICED. One question, measured: of the `index_access` sites
 * (`xs.[i]`), how many have a receiver that a PER-FILE analyzer could name at all, and of those,
 * how many name a symbol the file actually publishes?
 *
 * WHY THIS IS SEPARATE FROM `extended-census.ts`. That census counts the sites and their receiver
 * SHAPES (identifier/qualified vs expression). It deliberately never calls `parseFile`, so it cannot
 * know which identifiers are PUBLISHED symbols. The price of CL-G1 depends on exactly that
 * difference — a receiver that is a module-level CAF is nameable without a type, a local is not —
 * so the resolution is measured here, in its own instrument, against production `parseFile`.
 *
 * THE DECISION THIS FEEDS, stated so the number is not read as a licence. The lane's `uses`
 * contract admits `callable → record field` and `callable → data constructor` and says *"The FP
 * family emits no bare VALUE read: a receiver, a parameter or a pattern variable never produces an
 * edge"*. Every receiver counted here is a VALUE read, published or not — so this instrument prices
 * a design change (redefining `uses` lane-wide), not a missing case. See CL-G1 in
 * `script/m14/spec/clean-completeness.json`.
 *
 * DETERMINISTIC over the sorted admitted population. Read-only; writes JSON with `--json <path>`.
 *
 *   npx tsx validation/m14/fixtures/clean/index-receiver-census.ts [--json <path>]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine.ts"
import { parseFile } from "../../../../src/ast/pool-worker.ts"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null
const parser = await getParser("clean")

const files: { abs: string; dir: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\n")
      .filter((f) => /\.(icl|dcl)$/i.test(f))
  } catch {
    continue
  }
  for (const f of tracked) {
    const abs = join(dir, f)
    try {
      if (statSync(abs).size > 1024 * 1024) continue
    } catch {
      continue
    }
    files.push({ abs, dir })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))

const out = {
  files: files.length,
  sites: 0,
  receiverIdentifier: 0,
  receiverQualified: 0,
  receiverExpression: 0,
  /** identifier/qualified receivers that name a symbol `parseFile` publishes in the SAME file */
  namedPublished: 0,
  /** identifier receivers that name nothing published in the file (locals, params, pattern vars) */
  namedUnpublished: 0,
  /** qualified receivers whose LAST segment is published */
  qualifiedLastSegmentPublished: 0,
  examplesPublished: [] as string[],
  examplesUnpublished: [] as string[],
}

for (const f of files) {
  let text: string
  try {
    text = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  const result: any = await parseFile(f.abs, f.dir)
  const published = new Set<string>((result?.symbols ?? []).map((s: any) => String(s.name)))
  const tree: any = await parser.parse(text, f.abs)
  if (!tree) continue
  const stack = [tree.rootNode]
  while (stack.length) {
    const n: any = stack.pop()
    if (n.type === "index_access") {
      out.sites++
      const recv = n.namedChild(0)
      const label = `${relative(CR, f.abs)}:${Number(n.startPosition?.row ?? 0) + 1}`
      if (recv?.type === "identifier") {
        out.receiverIdentifier++
        const name = String(recv.text ?? "").trim()
        if (published.has(name)) {
          out.namedPublished++
          if (out.examplesPublished.length < 8) out.examplesPublished.push(`${label} ${name}`)
        } else {
          out.namedUnpublished++
          if (out.examplesUnpublished.length < 8) out.examplesUnpublished.push(`${label} ${name}`)
        }
      } else if (recv?.type === "qualified_identifier" || recv?.type === "field_access") {
        out.receiverQualified++
        const name = String(recv.childForFieldName?.("name")?.text ?? recv.text ?? "").trim()
        if (published.has(name)) out.qualifiedLastSegmentPublished++
      } else {
        out.receiverExpression++
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  tree.delete?.()
}

console.log("CL-G1 — index-access receivers, priced (production parseFile + parse tree)\n")
console.log(`population: ${files.length} admitted files`)
console.log(`index_access sites: ${out.sites}`)
console.log(`  receiver identifier            ${out.receiverIdentifier}`)
console.log(`    names a PUBLISHED symbol     ${out.namedPublished}   ${out.examplesPublished.slice(0, 3).join(" | ")}`)
console.log(`    names nothing published      ${out.namedUnpublished}   ${out.examplesUnpublished.slice(0, 3).join(" | ")}`)
console.log(`  receiver qualified / field     ${out.receiverQualified}   (last segment published ${out.qualifiedLastSegmentPublished})`)
console.log(`  receiver expression            ${out.receiverExpression}`)
console.log(`\nLANDED, NOT EMITTED: ${out.namedPublished} of ${out.sites} sites have a nameable receiver, and every one is a VALUE read.`)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ language: "clean", measuredAt: new Date().toISOString(), population: { admitted: files.length }, ...out }, null, 2) + "\n")
  console.log(`wrote ${jsonOut}`)
}
