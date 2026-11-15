/**
 * READ-ONLY PROBE — end-to-end: does the extensionless route reach the analyzer
 * with real content, and is the extraction sound?
 *
 * Walks the two projects whose entry points are extensionless (`nvm`, `rbenv`),
 * asks the PRODUCTION `parseFile` for each tracked file the router now admits,
 * and reports what came back. A routing rule that admits a file but yields
 * nothing is a rule that only moves a number.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
for (const repo of ["nvm", "rbenv", "ohmyzsh"]) {
  const dir = path.join(CR, repo)
  if (!existsSync(path.join(dir, ".git"))) continue
  const tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .trim().split("\n").filter(Boolean)
  let extless = 0, admitted = 0, symbols = 0, rels = 0, unlined = 0, filesWithSymbols = 0
  const samples: string[] = []
  for (const rel of tracked) {
    const base = rel.slice(rel.lastIndexOf("/") + 1)
    if (base.includes(".")) continue
    extless++
    const abs = path.join(dir, rel)
    let text: string
    try { text = (await import("node:fs")).readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted++
    if (samples.length < 3) samples.push(rel)
    if (text.length > 512 * 1024) continue
    let r: any
    try { r = await parseFile(abs, dir) } catch { continue }
    symbols += (r.symbols ?? []).length
    rels += (r.relationships ?? []).length
    for (const x of r.relationships ?? []) if (!(typeof x.line_number === "number" && x.line_number > 0)) unlined++
    if ((r.symbols ?? []).length > 1) filesWithSymbols++
  }
  console.log(`${repo.padEnd(10)} extensionless=${String(extless).padStart(5)}  admitted=${String(admitted).padStart(4)}  symbols=${String(symbols).padStart(6)}  rels=${String(rels).padStart(6)}  unlined=${unlined}  filesWithRealSymbols=${filesWithSymbols}`)
  if (samples.length) console.log(`           e.g. ${samples.join(", ")}`)
}
