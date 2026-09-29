// script/m60/objc-enum-loss.ts — what does the NS_ENUM/NS_OPTIONS failure actually cost?
//
// The shape census found 22 files whose ERROR nodes begin at a `typedef NS_ENUM(T, Name) {`
// or `typedef NS_OPTIONS(T, Name) {` line, and the second review ruled this construct
// "verified unparseable, not minable" and shipped a silence. That ruling was made against a
// small corpus. At the router's full universe it is 22 real files in two production
// codebases, and each one contains a list of NAMED CONSTANTS that is the declaration's entire
// reason to exist.
//
// This tool measures the cost rather than restating the rule: for every NS_ENUM/NS_OPTIONS
// declaration in the universe it counts the member names by SOURCE (what a reader sees) and
// asks the analyzer's output for each name (what a consumer of the graph gets). The
// difference is the loss, and it is per-declaration so the worst cases can be named.
//
// Source-side counting is a small brace-matching reader over the declaration's own text, not
// a second parser: it only has to find the balanced `{ ... }` after the macro and list the
// leading identifiers, which is not a judgement about grammar correctness — it is the
// ground truth a reader would type, and it is deliberately dumb so it cannot inherit a bug
// from the thing it is measuring.
//
// Usage: bun run script/m60/objc-enum-loss.ts
// Writes: validation/m60/results/objc-enum-loss.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/objc-enum-loss.json")
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]

function admitted(abs: string): boolean {
  const ext = path.extname(abs).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  try {
    const fd = fs.openSync(abs, "r")
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, 65536, 0)
    fs.closeSync(fd)
    return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(buf.toString("utf8", 0, n))
  } catch { return false }
}

const NS_DECL = /typedef\s+(?:NS_ENUM|NS_OPTIONS|NS_CLOSED_ENUM|NS_TYPED_ENUM|NS_STRING_ENUM|NSErrorDomain)\s*\(([^)]*)\)\s*\{/g

/** Balanced-brace body after `match.index + match[0].length`, then the leading identifiers. */
function membersOf(src: string, openBrace: number): { members: string[]; endLine: number } {
  let depth = 0, i = openBrace
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") { depth--; if (depth === 0) { i++; break } }
  }
  const body = src.slice(openBrace + 1, i - 1)
  // Strip comments so a name mentioned only in a doc comment is not counted as a member.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  const members: string[] = []
  for (const m of clean.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|,|$)/gm)) {
    if (m[1] !== "NS_ENUM" && m[1] !== "NS_OPTIONS") members.push(m[1]!)
  }
  return { members, endLine: src.slice(0, i).split("\n").length }
}

async function main() {
  const files: string[] = []
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    let out = ""
    try { out = execSync("git ls-files '*.m' '*.mm' '*.h'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    for (const f of out.split("\n").filter((x) => x.trim())) {
      const abs = path.join(dir, f)
      if (admitted(abs)) files.push(abs)
    }
  }

  const decls: any[] = []
  for (const abs of files) {
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { continue }
    const found = [...src.matchAll(NS_DECL)]
    if (!found.length) continue
    let parsed: any
    try { parsed = await parseFile(abs, path.dirname(abs)) } catch { continue }
    const symNames = new Set((parsed.symbols ?? []).map((s: any) => s.name))
    for (const m of found) {
      const openBrace = m.index! + m[0].length - 1
      const { members, endLine } = membersOf(src, openBrace)
      // the enum's own type name is the 2nd macro arg
      const args = (m[1] ?? "").split(",").map((x) => x.trim())
      const enumName = args[1] ?? ""
      const line = src.slice(0, m.index!).split("\n").length
      const gotEnumType = symNames.has(enumName)
      const gotMembers = members.filter((x) => symNames.has(x))
      decls.push({
        file: path.relative(CORPUS_ROOT, abs),
        line,
        endLine,
        macro: /^typedef\s+([A-Z_]+)/.exec(m[0])?.[1] ?? "NS_ENUM",
        enumName,
        membersInSource: members.length,
        membersRecovered: gotMembers.length,
        membersLost: members.length - gotMembers.length,
        enumTypeSymbolPresent: gotEnumType,
        // what a value-read of a member resolves to — the graph consequence, not just the symbol count
        lostMemberNames: members.filter((x) => !symNames.has(x)).slice(0, 12),
        membersSample: members.slice(0, 8),
      })
    }
  }

  const totalMembers = decls.reduce((n, d) => n + d.membersInSource, 0)
  const totalLost = decls.reduce((n, d) => n + d.membersLost, 0)
  const filesAffected = new Set(decls.map((d) => d.file)).size
  const clean = decls.filter((d) => d.membersLost === 0)

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "NS_ENUM/NS_OPTIONS member recovery",
    generatedAt: new Date().toISOString(),
    method: `for every NS_ENUM/NS_OPTIONS/NS_CLOSED_ENUM/NS_STRING_ENUM declaration in the router universe (${files.length} files), count member names from the source text with a balanced-brace reader, then ask the analyzer's symbols for each name`,
    why:
      "the second review ruled this construct 'verified unparseable, not minable' against a " +
      "small corpus; at the router's full universe it is 22 files in two production codebases, " +
      "and the loss is a list of named constants that is the declaration's entire reason to exist",
    declarationsFound: decls.length,
    filesAffected,
    totalMembersInSource: totalMembers,
    totalMembersLost: totalLost,
    recoveryRate: totalMembers ? +(1 - totalLost / totalMembers).toFixed(4) : null,
    declarationsFullyRecovered: clean.length,
    declarationsWhollyLost: decls.filter((d) => d.membersLost === d.membersInSource).length,
    enumTypeSymbolsPresent: decls.filter((d) => d.enumTypeSymbolPresent).length,
    decls: decls.sort((a, b) => b.membersLost - a.membersLost),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`files ${files.length}   NS_ENUM/NS_OPTIONS declarations ${decls.length} in ${filesAffected} files`)
  console.log(`members in source ${totalMembers}   recovered ${totalMembers - totalLost}   LOST ${totalLost}   recovery ${payload.recoveryRate}`)
  console.log(`enum TYPE symbol present in ${payload.enumTypeSymbolsPresent}/${decls.length} declarations; wholly-lost declarations ${payload.declarationsWhollyLost}\n`)
  for (const d of payload.decls.slice(0, 12)) {
    console.log(`  ${String(d.membersLost).padStart(3)}/${String(d.membersInSource).padStart(3)} lost  ${d.macro.padEnd(15)} ${d.enumName.padEnd(34)} ${d.file}:${d.line}`)
  }
  console.log(`\n-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
