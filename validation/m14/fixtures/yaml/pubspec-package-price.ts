// PUBSPEC-PACKAGE PRICE — the price of wiring `package:`/`dart:` yaml includes as `projectFacts`
// claims, MEASURED before anything is wired.
//
// WHY IT EXISTS, AND WHAT IT CORRECTS. `docs/analyzers/history/yaml-lane-notes.md`'s RULED CLASS carries ~88
// `package:`/`dart:` imports sitting in `ext?` (a claim the arbiter can neither confirm nor deny),
// and it DEFERRED wiring pubspec facts for this lane on the stated ground that "`package:lints` IS
// declared in that checkout, so wiring blind could manufacture refutations". **THAT GROUND IS FALSE,
// and this instrument is what refutes it:** over the whole admitted corpus NO `pubspec.yaml` declares
// `lints` (0 of 0), while `flutter_lints` IS declared — once, at
// `flutter-packages/packages/flutter_lints/pubspec.yaml`, and one of the four
// `include: package:flutter_lints/flutter.yaml` sites sits INSIDE that very package. The real refuter
// is `flutter_lints`, not `lints`, so the deferral rested on a number nobody had taken.
//
// WHY THE GATE CANNOT ALREADY ANSWER IT. `incoming-gate.ts` builds pubspec facts for `dart` only
// (`projectFactsForDart`); every other lane gets `projectFactsForFiles`, whose `packages` set is
// EMPTY — so a yaml `package:` claim classified through `verifyImportClaim` would read as
// `externalVerified` for the wrong reason (nothing is ever "declared"). Wiring is a shared-gate
// change, and this measures its price first.
//
// WHAT IT COUNTS, AND WHY THE VERDICT CANNOT DRIFT. Every `include:` value in the admitted
// `.yaml`/`.yml` population whose target is a `package:`/`dart:` URI scheme (`isLiteralPathSpelling`
// refuses that shape as a path), against the SAME pubspec rule the gate's walk uses (`name:` at
// column 0, value up to whitespace or `#`), scoped PER REPO as the gate scopes it, run through the
// SHARED `verifyImportClaim` imported from `incoming-rule.ts` — so what this prices and what the
// arbiter would do cannot drift.
//
// USAGE: npx tsx validation/m14/fixtures/yaml/pubspec-package-price.ts

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { verifyImportClaim } = await import(`${REPO}/script/m14/incoming-rule.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXTS = ["yaml", "yml"]
const SIZE_CAP = 1024 * 1024

type Facts = { packages: Set<string>; files: Set<string>; sdkLib: boolean }

/** An `include:` whose value is a `package:`/`dart:` URI scheme — the shape the analyzer refuses as a
 *  path and therefore marks `isExternal`. Quoted and unquoted, bare and list-item (`- include:`). */
const INC_RE = /^[ \t]*(?:-\s*)?include:[ \t]*["']?(package:[^"'#\s]+|dart:[^"'#\s]+)["']?[ \t]*(?:#.*)?$/

type Row = { repo: string; file: string; line: number; target: string; pkg: string; verdict: string }
const rows: Row[] = []

const pkgOf = (t: string): string => {
  const raw = t.endsWith(":*") ? t.slice(0, -2) : t
  if (raw.startsWith("package:")) {
    const rest = raw.slice("package:".length)
    const slash = rest.indexOf("/")
    return slash > 0 ? rest.slice(0, slash) : "(no-path)"
  }
  if (raw.startsWith("dart:")) return "dart:" + raw.slice("dart:".length)
  return "(other)"
}

for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }

  // ---- the project's own package names, EXACTLY the gate's rule (`projectFactsForDart`) ----------
  const packages = new Set<string>()
  for (const rel of tracked) {
    if (rel.split("/").pop() !== "pubspec.yaml") continue
    let text: string
    try { text = readFileSync(join(dir, rel), "utf8") } catch { continue }
    for (const line of text.split("\n")) {
      if (!line.startsWith("name:")) continue
      const raw = line.slice(5)
      let v = 0
      while (v < raw.length && (raw[v] === " " || raw[v] === "\t")) v++
      let end = v
      while (end < raw.length) {
        const c = raw[end]
        if (c === " " || c === "\t" || c === "\r" || c === "#") break
        end++
      }
      const value = raw.slice(v, end)
      if (value.length > 0) packages.add(value)
      break
    }
  }
  const files = new Set<string>()
  for (const rel of tracked) {
    let s: number
    try { s = statSync(join(dir, rel)).size } catch { continue }
    if (s <= SIZE_CAP) files.add(rel)
  }
  const facts: Facts = { packages, files, sdkLib: false }

  // ---- every `include: package:`/`dart:` site in this repo's admitted yaml -----------------------
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith("." + e))) continue
    let size: number
    try { size = statSync(join(dir, rel)).size } catch { continue }
    if (size > SIZE_CAP) continue
    let text: string
    try { text = readFileSync(join(dir, rel), "utf8") } catch { continue }
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const m = INC_RE.exec(lines[i])
      if (m === null) continue
      const target = m[1]
      rows.push({ repo: name, file: rel, line: i + 1, target, pkg: pkgOf(target), verdict: verifyImportClaim(facts, target) })
    }
  }
}

// ---- report ------------------------------------------------------------------------------------
const count = (v: string) => rows.filter((r) => r.verdict === v).length
const verified = count("externalVerified")
const refuted = count("externalRefuted")
const unverified = count("externalUnverified")

console.log("PUBSPEC-PACKAGE PRICE — yaml `package:`/`dart:` includes, per-repo, VERDICT the shared")
console.log("arbiter would give if the gate built pubspec facts for this lane (measured BEFORE wiring).")
console.log("")
console.log(`sites found: ${rows.length}`)
console.log(`  externalVerified  (moves ext? -> extOK)  : ${verified}`)
console.log(`  externalRefuted   (moves ext? -> extFAIL) : ${refuted}`)
console.log(`  externalUnverified (would stay ext?)      : ${unverified}`)
console.log("")

const byPkg = new Map<string, { v: number; r: number; u: number }>()
for (const row of rows) {
  const e = byPkg.get(row.pkg) ?? { v: 0, r: 0, u: 0 }
  if (row.verdict === "externalVerified") e.v++
  else if (row.verdict === "externalRefuted") e.r++
  else e.u++
  byPkg.set(row.pkg, e)
}
console.log("BY PACKAGE:")
for (const [pkg, e] of [...byPkg.entries()].sort((a, b) => b[1].v + b[1].r - (a[1].v + a[1].r))) {
  console.log(`  ${pkg.padEnd(34)} verify=${e.v}  REFUTE=${e.r}  unverifiable=${e.u}`)
}

console.log("")
console.log("REFUTATIONS (the claims wiring would EXPOSE as FALSE — every one named):")
const ref = rows.filter((r) => r.verdict === "externalRefuted")
if (ref.length === 0) console.log("  (none)")
for (const r of ref) console.log(`  ${r.target}  @ ${r.repo}/${r.file}:${r.line}`)

console.log("")
console.log("VERDICT: wiring pubspec facts for yaml converts " + verified + " ext? -> extOK and EXPOSES "
  + refuted + " FALSE external claim(s) as extFAIL. The refutations are TRUE statements about the corpus")
console.log("(the project declares the package) and are INHERENT to this routing — a per-file yaml analyzer")
console.log("has no pub-resolution channel to turn the include into an in-repo file claim. That is a")
console.log("FACT-BUILDING / architecture decision for the Lead, priced here rather than guessed.")
process.exit(0)
