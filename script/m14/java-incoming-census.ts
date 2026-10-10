/**
 * java-incoming-census — WHAT the Java lane's unresolved and ambiguous targets ARE, by family.
 *
 * WHY THIS EXISTS. `script/m14/java-incoming-gate.ts` ratchets Java's counts, and a ceiling of
 * `calls otherUnresolved 4,516` is a number a reader cannot act on: it does not say whether the
 * backlog is third-party packages, unimported java.lang types, member paths on invisible
 * receivers, or a target the analyzer spells badly. The declaration's rules state the CLASSES;
 * this census states the FAMILIES with counts, so the backlog can be worked family by family.
 *
 * IT IS NOT A SECOND INSTRUMENT. A second instrument measuring the same population is the
 * failure mode the honesty contract names — so this file walks the same 200-file sample with
 * the SAME discovery and stride (copied from `incoming-gate.ts:143-205`, which cannot be
 * imported: that file is a script and importing it would execute it), builds the same
 * declaration pool (name + `qualifiedName` alias counts), applies the same classification
 * (`decls === 0 && !marked → unresolved`, `decls > 1 → ambiguous`, else resolved), and then
 * REFUSES TO PRINT unless its per-type totals EQUAL a fresh run of the fleet gate's JSON.
 * The equality assert is the control: if the copied walk drifts from the gate's, this exits 3
 * rather than reporting a census of a different population.
 *
 * WHAT IT CLASSIFIES, and why each shape is provable from the target string alone:
 *
 *   dotted targets
 *     platform-qualified   root in java./javax./jakarta./jdk./sun./com.sun./kotlin./kotlinx.
 *                          These SHOULD have carried the analyzer's external marker (that is
 *                          what the marker asserts) — an unmarked one here is a FINDING about
 *                          the marker, not a fact about the language.
 *     third-party-ish      org./com./net./io./… in a corpus with no dependency model: the
 *                          analyzer cannot prove them, which is why they are backlog.
 *
 *   bare targets (no dot)
 *     keyword-spelled      `super`, `this`, `class`, `new` — a target that names a KEYWORD
 *                          names no symbol; counted separately because it is a spelling
 *                          defect when it appears, not a similarity.
 *     java-lang-shaped     the spelling is a class in java.lang (published list below),
 *                          auto-importable by JLS 7.5.3. NOT asserted external: a same-package
 *                          class may legally shadow the name and a file cannot see its package.
 *                          It is explained, not marked.
 *     constant-shaped      ALL_CAPS — a static field / enum constant reference.
 *     member-shaped        lowerCamelCase — a method/field of a receiver the edge does not name.
 *     other                anything else, named so it can be looked at.
 *
 *   ambiguous targets
 *     by declaration count (2 / 3 / 4 / 5+), because "5,024 ambiguous" is one number and
 *     "4 of them collide with two declarations while 1,100 collide with five or more" is a
 *     different, actionable statement.
 *
 * The distinct-name count is printed beside every occurrence count: 4,000 occurrences in a
 * family of 30 names is a repeated reference to the same 30 foreign things, and is a very
 * different work item from 4,000 distinct names.
 *
 * Usage:  npx tsx script/m14/java-incoming-census.ts [--json] [--max=200]
 * Exit:   0 census printed · 1 census printed but the marker finding fired (unmarked
 *         platform-qualified targets exist) · 2 environment (corpus/parse) · 3 CONTROL DID NOT
 *         FIRE — the census population is not the gate's population.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const GATE = path.join(ROOT, "script/m14/incoming-gate.ts")

// Copied verbatim from incoming-gate.ts:143 — same corpus root, same env override.
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// Copied from incoming-gate.ts:100-141 — same aliases, or the two walks count different sets.
const EXTERNAL_KEYS = [
  "zigExternalRef", "nimStdlibModule", "isExternal", "isExternalTarget", "external",
  "externalRef", "isStdlib", "stdlibModule", "moduleNamingEdges", "markAsExternal",
]
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", import: "imports", exports: "exports", export: "exports",
  references: "references", reference: "references", ref: "references",
  extends: "extends", implements: "implements", overrides: "overrides", override: "overrides",
  instantiates: "instantiates", instantiate: "instantiates", creates: "instantiates",
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

function isMarkedExternal(rel: any): boolean {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return false
  for (const k of EXTERNAL_KEYS) {
    if (md[k] === true) return true
    if (Array.isArray(md[k]) && md[k].length > 0) return true
  }
  return false
}

/** java.lang's class names an unqualified reference can be written against, by the JDK.
 *  A PUBLISHED LIST, spelled out — a shape rule ("looks like a JDK name") is how a probe
 *  convicts a correct analyzer, so the family is a membership test against names the JDK
 *  actually declares, and anything not on the list falls to the shapes below it. */
const JAVA_LANG_NAMES = new Set([
  "String", "Object", "Integer", "Long", "Double", "Float", "Boolean", "Byte", "Short",
  "Character", "Number", "Void", "Math", "System", "Class", "Enum", "Record", "Iterable",
  "Comparable", "Cloneable", "Runnable", "Thread", "Throwable", "Exception", "Error",
  "RuntimeException", "IllegalArgumentException", "IllegalStateException",
  "UnsupportedOperationException", "NullPointerException", "IndexOutOfBoundsException",
  "ArrayIndexOutOfBoundsException", "ClassCastException", "NumberFormatException",
  "ArithmeticException", "InterruptedException", "Runtime", "Process", "ProcessBuilder",
  "StringBuilder", "StringBuffer", "CharSequence", "Deprecated", "Override", "SuppressWarnings",
  "FunctionalInterface", "SafeVarargs", "Integer", "Package", "Module", "ClassLoader",
  "AutoCloseable", "Appendable", "Readable", "ThreadLocal", "StackTraceElement",
])

/** Copied from incoming-gate.ts:143-205 — the discovery, verbatim, so the population matches. */
function discoverFiles(ext: string, maxFiles: number): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > 512 * 1024) continue
      } catch {
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  let files = found
  if (total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size }
}

type Family = "platform-qualified" | "third-party" | "keyword-spelled" | "java-lang-shaped" |
  "constant-shaped" | "member-shaped" | "other"

const PLATFORM_ROOTS = ["java.", "javax.", "jakarta.", "jdk.", "sun.", "com.sun.", "kotlin.", "kotlinx."]

function familyOf(target: string): Family {
  if (PLATFORM_ROOTS.some((p) => target.startsWith(p))) return "platform-qualified"
  if (target.includes(".")) return "third-party"
  if (["super", "this", "class", "new", "null", "true", "false"].includes(target)) return "keyword-spelled"
  if (JAVA_LANG_NAMES.has(target)) return "java-lang-shaped"
  if (/^[A-Z][A-Z0-9_]*$/.test(target)) return "constant-shaped"
  if (/^[a-z_$][A-Za-z0-9_$]*$/.test(target)) return "member-shaped"
  return "other"
}

type Fam = { occurrences: number; names: Set<string> }
const mkFam = (): Map<Family, Fam> => {
  const m = new Map<Family, Fam>()
  for (const f of ["platform-qualified", "third-party", "keyword-spelled", "java-lang-shaped",
    "constant-shaped", "member-shaped", "other"] as Family[]) {
    m.set(f, { occurrences: 0, names: new Set() })
  }
  return m
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const maxArg = argv.find((a) => a.startsWith("--max="))
const MAX = Number(maxArg ? maxArg.split("=")[1] : 200)

// THE GATE'S OWN NUMBERS, for the equality assert. Exit 1 (its normal verdict) carries the
// JSON on stdout, so it is read from error.stdout exactly as java-incoming-gate.ts does.
function gateJson(): any {
  try {
    const out = execFileSync("npx", ["tsx", GATE, "java", "java", String(MAX), "--json"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] })
    return JSON.parse(out)
  } catch (e) {
    const stdout = String((e as { stdout?: string | Buffer })?.stdout ?? "")
    if (stdout.trim().length === 0) throw e
    return JSON.parse(stdout)
  }
}

const gate = gateJson()
if (!gate?.instrumentSelfTest?.ok) {
  console.error("FATAL: the fleet gate's own self-test did not fire; its numbers cannot anchor this census.")
  process.exit(3)
}

const { files, total, repos } = discoverFiles("java", MAX)

async function main(): Promise<void> {
  const declCount = new Map<string, number>()
  const perType = new Map<Type, { edges: number; resolved: number; ambiguous: number; unresolved: number; external: number }>()
  for (const t of ALL_TYPES) perType.set(t, { edges: 0, resolved: 0, ambiguous: 0, unresolved: 0, external: 0 })

  // unresolved/ambiguous targets, in occurrence order, full (no 25-name cap — this file's
  // whole job is the complete list; the gate caps because it prints a verdict, not a worklist).
  const unresolved: { type: Type; target: string }[] = []
  const ambiguous: { type: Type; target: string; decls: number }[] = []

  let parsed = 0
  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, path.dirname(f))
    } catch {
      continue
    }
    if (!r || r.fallback === true) continue
    parsed++
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      declCount.set(name, (declCount.get(name) ?? 0) + 1)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) declCount.set(q, (declCount.get(q) ?? 0) + 1)
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const row = perType.get(label)!
      row.edges++
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue
      const decls = declCount.get(tgt) ?? 0
      if (decls === 0) {
        if (isMarkedExternal(rel)) row.external++
        else { row.unresolved++; unresolved.push({ type: label, target: tgt }) }
        continue
      }
      if (decls > 1) { row.ambiguous++; ambiguous.push({ type: label, target: tgt, decls }); continue }
      row.resolved++
    }
  }

  // THE CONTROL. Every per-type number must equal the fleet gate's, or this census is about a
  // different population and its families describe a walk nobody else can see.
  const diffs: string[] = []
  for (const t of ALL_TYPES) {
    const mine = perType.get(t)!
    const theirs = gate.perType?.[t]
    if (!theirs) { diffs.push(`${t}: gate has no row`); continue }
    const pairs: [string, number, number][] = [
      ["edges", mine.edges, theirs.edges],
      ["resolved", mine.resolved, theirs.resolved],
      ["ambiguous", mine.ambiguous, theirs.ambiguousByDecl],
      ["unresolved", mine.unresolved, theirs.unresolved],
      ["external", mine.external, theirs.markedExternal],
    ]
    for (const [k, a, b] of pairs) if (a !== b) diffs.push(`${t}.${k}: census ${a} != gate ${b}`)
  }
  if (parsed !== gate.population.parsed) diffs.push(`parsed: census ${parsed} != gate ${gate.population.parsed}`)
  if (diffs.length > 0) {
    console.error("FATAL: the census population is not the gate's population — refusing to report families.")
    for (const d of diffs.slice(0, 20)) console.error(`  ${d}`)
    console.error("A family table over a different walk is a number about nothing. Fix the copied walk.")
    process.exit(3)
  }

  // ---- families over the UNRESOLVED population, per type ----
  const byType = new Map<Type, Map<Family, Fam>>()
  for (const t of ALL_TYPES) byType.set(t, mkFam())
  const globalFam = mkFam()
  const platformNames: { type: Type; target: string }[] = []
  for (const u of unresolved) {
    const fam = familyOf(u.target)
    const f = byType.get(u.type)!.get(fam)!
    f.occurrences++
    f.names.add(u.target)
    const g = globalFam.get(fam)!
    g.occurrences++
    g.names.add(u.target)
    if (fam === "platform-qualified") platformNames.push(u)
  }

  // ---- ambiguous by declaration count ----
  const ambBuckets = new Map<string, Fam>()
  for (const key of ["2", "3", "4", "5+"]) ambBuckets.set(key, { occurrences: 0, names: new Set() })
  const ambByType = new Map<Type, { total: number; max: number }>()
  for (const a of ambiguous) {
    const key = a.decls >= 5 ? "5+" : String(a.decls)
    const b = ambBuckets.get(key)!
    b.occurrences++
    b.names.add(a.target)
    const cur = ambByType.get(a.type) ?? { total: 0, max: 0 }
    cur.total++
    cur.max = Math.max(cur.max, a.decls)
    ambByType.set(a.type, cur)
  }

  const sorted = (m: Map<Family, Fam>) =>
    [...m.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences)

  if (JSON_OUT) {
    console.log(JSON.stringify({
      population: { sampled: files.length, parsed, corpusTotal: total, repos, maxFiles: MAX },
      equalityControl: { ok: true, checkedAgainst: "script/m14/incoming-gate.ts --json" },
      perType: Object.fromEntries([...perType.entries()].map(([t, v]) => [t, v])),
      unresolvedFamilies: Object.fromEntries(sorted(globalFam).map(([f, v]) => [f, {
        occurrences: v.occurrences, distinctNames: v.names.size,
      }])),
      unresolvedByType: Object.fromEntries([...byType.entries()].map(([t, m]) => [t,
        Object.fromEntries(sorted(m).filter(([, v]) => v.occurrences > 0).map(([f, v]) => [f, {
          occurrences: v.occurrences, distinctNames: v.names.size,
        }])),
      ])),
      ambiguousBuckets: Object.fromEntries([...ambBuckets.entries()].map(([k, v]) => [k, {
        occurrences: v.occurrences, distinctNames: v.names.size,
      }])),
      ambiguousByType: Object.fromEntries([...ambByType.entries()].map(([t, v]) => [t, v])),
      markerFinding: {
        unmarkedPlatformQualified: platformNames.length,
        examples: platformNames.slice(0, 10),
      },
    }, null, 2))
  } else {
    const w = (s: string | number, n: number) => String(s).padEnd(n)
    console.log(`java incoming census — ${parsed} parsed of ${files.length} sampled (corpus ${total} .java across ${repos} repos)`)
    console.log(`equality control: PASS — every per-type count equals incoming-gate.ts --json on the same walk`)
    console.log()
    console.log("UNRESOLVED FAMILIES (occurrences / distinct names)")
    console.log("-".repeat(72))
    for (const [f, v] of sorted(globalFam)) {
      if (v.occurrences === 0) continue
      console.log(`${w(f, 20)} ${w(v.occurrences, 8)} / ${v.names.size}`)
      // Show the biggest contributors per family so the family is a list, not a bucket.
      const perTypeOf = [...byType.entries()]
        .map(([t, m]) => [t, m.get(f)!.occurrences] as [Type, number])
        .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4)
      console.log(`${" ".repeat(22)}by type: ${perTypeOf.map(([t, n]) => `${t} ${n}`).join(", ")}`)
      const examples = [...v.names].slice(0, 6)
      console.log(`${" ".repeat(22)}e.g. ${examples.join(", ")}`)
    }
    console.log()
    console.log("AMBIGUOUS BY DECLARATION COUNT (occurrences / distinct names)")
    console.log("-".repeat(72))
    for (const [k, v] of ambBuckets) {
      console.log(`${w(`${k} declaration(s)`, 20)} ${w(v.occurrences, 8)} / ${v.names.size}`)
    }
    const worst = [...ambByType.entries()].sort((a, b) => b[1].total - a[1].total)
    console.log(`by type: ${worst.map(([t, v]) => `${t} ${v.total}(max ${v.max})`).join(", ")}`)
    console.log()
    if (platformNames.length > 0) {
      console.log(`MARKER FINDING: ${platformNames.length} unmarked platform-qualified target(s) — the marker`)
      console.log("asserts exactly this class, so each one is a marking defect, not a language fact:")
      for (const p of platformNames.slice(0, 10)) console.log(`  ${w(p.type, 13)} ${p.target}`)
    } else {
      console.log("MARKER FINDING: none — every platform-qualified target carries the external marker.")
    }
  }

  // Exit 1 when the marker finding fires: a markable class left unmarked is a defect the
  // census exists to surface, and a finding that cannot fail is a log line.
  process.exit(platformNames.length > 0 ? 1 : 0)
}

await main()
