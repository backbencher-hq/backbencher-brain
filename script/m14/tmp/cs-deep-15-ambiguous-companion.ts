// CS-DEEP-15 — the AMBIGUOUS COMPANION, measured. (The fourth finding of this round.)
//
// WHAT IT IS. csharp has no `extends`/`implements` keyword, so the base-list kind of a base
// TYPE is resolved by NAME through a companion index: the analyzer takes
// `context.typeKinds` (name -> kind) and the differential builds the same map by REGEX over
// the whole corpus (`\binterface\s+(\w+)`). Both are NAME-keyed. In a real repository a
// name is not a type: `Base` is a class in this file and an interface in a dozen others, and
// a Map<string, kind> has no way to say "both". Whichever kind was written last wins, for
// every file in the repository.
//
// MEASURED CONSEQUENCE, found by the F5 differential on a corpus this lane has never drawn
// (roslyn, 60 files): one MISSING edge —
//     implements Derived -> Base
// in `TypeForwarder1.cs`, which declares `public class Base` IN ITS OWN FILE and whose
// `class Derived : Base` is unambiguously `extends`. The analyzer was RIGHT and the oracle
// was wrong, because the oracle's companion had `Base -> interface` from twelve other files.
//
// So the honest question is not "which side is wrong" but "how often does the companion
// decide a heritage label it cannot know", and that is a count over the corpus. This
// instrument measures it directly: for every file, every name declared as a class/struct/
// record/interface/enum, and therefore every name whose kind is AMBIGUOUS repo-wide, and
// every base-list entry in the file whose own kind is in the minority.
//
// Nothing here reads the analyzer: the ambiguity is a property of the corpus text, and the
// correction is a property of the companion, so both are derived here.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const DECL = [
  { kind: "class", re: /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g },
  { kind: "struct", re: /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)/g },
  { kind: "record", re: /\brecord\s+(?:class\s+|struct\s+)?([A-Za-z_][A-Za-z0-9_]*)/g },
  { kind: "interface", re: /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g },
  { kind: "enum", re: /\benum\s+([A-Za-z_][A-Za-z0-9_]*)/g },
]

/** A base-list entry: `class X : A, B<...>` on a declaration line. */
const BASE_ENTRY = /(?:class|struct|record|interface)\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*([^\{]+)/g

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-15-ambiguous-companion.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 1500)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  // name -> kind -> the set of files declaring it that way
  const byName = new Map<string, Map<string, Set<string>>>()
  const add = (name: string, kind: string, file: string): void => {
    let m = byName.get(name)
    if (!m) { m = new Map<string, Set<string>>(); byName.set(name, m) }
    let s = m.get(kind)
    if (!s) { s = new Set<string>(); m.set(kind, s) }
    s.add(file)
  }

  const perFile = new Map<string, { name: string; kind: string }[]>()
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const local: { name: string; kind: string }[] = []
    for (const d of DECL) {
      d.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = d.re.exec(src))) if (m[1]) { add(m[1], d.kind, f); local.push({ name: m[1], kind: d.kind }) }
    }
    perFile.set(f, local)
  }

  // The companion the differential actually builds: interfaces only, last write wins.
  const companion = new Map<string, string>()
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    DECL[3].re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = DECL[3].re.exec(src))) if (m[1]) companion.set(m[1], "interface")
  }

  const ambiguous: Array<{ name: string; kinds: string[]; counts: Record<string, number> }> = []
  for (const [name, kinds] of byName) {
    if (kinds.size > 1) {
      const counts: Record<string, number> = {}
      for (const [k, s] of kinds) counts[k] = s.size
      ambiguous.push({ name, kinds: [...kinds.keys()].sort(), counts })
    }
  }
  ambiguous.sort((a, b) => Object.values(b.counts).reduce((x, y) => x + y, 0) - Object.values(a.counts).reduce((x, y) => x + y, 0))

  console.log(`files: ${files.length}`)
  console.log(`distinct declared type names: ${byName.size}`)
  console.log(`names declared under MORE THAN ONE kind (ambiguous for a name-keyed companion): ${ambiguous.length} (${(ambiguous.length / Math.max(1, byName.size) * 100).toFixed(1)}% of all names)`)
  console.log(`\ntop ambiguous names (name | kinds | files per kind):`)
  for (const a of ambiguous.slice(0, 30)) {
    const flag = companion.get(a.name) === "interface" && !a.kinds.every((k) => k === "interface") ? "  <-- companion says interface" : ""
    console.log(`   ${a.name.padEnd(28)} ${a.kinds.join("/").padEnd(24)} ${JSON.stringify(a.counts)}${flag}`)
  }

  // How many BASE-LIST ENTRIES does the companion decide, and how many of those are decided
  // AGAINST the file's own declaration of that name?
  let baseEntries = 0
  let decidedByCompanion = 0
  let decidedAgainstLocal = 0
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const localKinds = new Map<string, string>()
    for (const d of perFile.get(f) ?? []) if (!localKinds.has(d.name)) localKinds.set(d.name, d.kind)
    BASE_ENTRY.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = BASE_ENTRY.exec(src))) {
      const list = (m[1] ?? "").split(",")
      for (const raw of list) {
        const t = raw.trim()
        if (!t) continue
        const lt = t.indexOf("<")
        const base = (lt > 0 ? t.slice(0, lt) : t).trim()
        const segs = base.split(".")
        const name = segs[segs.length - 1]
        if (!name) continue
        baseEntries++
        if (!companion.has(name)) continue
        decidedByCompanion++
        const local = localKinds.get(name)
        if (local && local !== "interface") {
          decidedAgainstLocal++
          if (samples.length < 15) samples.push(`${path.basename(f)}  base "${name}"  declared IN THIS FILE as ${local}  companion says interface`)
        }
      }
    }
  }
  console.log(`\nbase-list entries seen: ${baseEntries}`)
  console.log(`   resolvable ONLY through the corpus companion (no in-file declaration): ${decidedByCompanion}`)
  console.log(`   of those, decided AGAINST the file's own declaration of that name: ${decidedAgainstLocal}`)
  if (samples.length) console.log(`\n   examples:\n     ${samples.join("\n     ")}`)
}

if (import.meta.main) await main()
