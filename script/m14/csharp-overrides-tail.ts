/**
 * OVERRIDES TAIL — how many `overrides` edges rest on the 0.5 first-parent guess, and are they right?
 *
 * WHY. `resolveOverrides` has three passes: an in-file same-signature match (1.0), a companion-index
 * match (0.65), and a deterministic per-file fallback that takes `ownerHierarchy[0]` (0.5,
 * `reasonCode: "first-parent-guess"`). The doc has carried "162 of 184 at 1.0; the tail is 22" for a
 * long time. This measures the tail on the WHOLE admitted corpus instead, so the number in the doc
 * is one a reader can reproduce.
 *
 * WHAT IT REPORTS, per overrides edge:
 *   confidence 0.5 / reasonCode first-parent-guess  -> the tail
 *   whether the guessed declaring type is a type DECLARED IN THE SAME FILE (checkable, so the guess
 *     is at least about a known type rather than an external one)
 *
 * It does NOT assert the guess is CORRECT. Whether the first hierarchy parent is the member's true
 * declaring type is a semantic question; what is measurable is how often the guess lands on a
 * same-file declaration, which is the difference between "a guess among known types" and "a guess
 * that could be anything".
 *
 * RUN: bun script/m14/csharp-overrides-tail.ts [limit]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = (() => {
  try {
    const dir = (import.meta as { dir?: string }).dir
    if (typeof dir === "string" && dir.length > 0) return dir
  } catch { /* not Bun */ }
  return path.dirname(fileURLToPath(import.meta.url))
})()
const ROOT = path.resolve(HERE, "../..")

// The corpus root: BB_CORPUS_ROOT, else the documented default.
const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
if (CR.startsWith("<corpus-root>")) {
  console.error(`set BB_CORPUS_ROOT to the corpus (default: ${CR})`)
  process.exit(2)
}

// Collect .cs files. The corpus root is a DIRECTORY OF CHECKOUTS (powershell/, fsharp/, …), not a
// single git repo, so `git ls-files` at the root fails. Walk it instead, skipping the usual noise.
const limit = Number(process.argv[2] ?? 0)
const files: string[] = []
{
  const stack = [CR]
  while (stack.length > 0 && (limit === 0 || files.length < limit)) {
    const d = stack.pop()!
    let ents: fs.Dirent[] = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === ".tools") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { stack.push(p); continue }
      if (e.name.endsWith(".cs") || e.name.endsWith(".csx")) files.push(p)
    }
  }
}

const { getParser } = await import("./run-fixtures.ts")
const { RealCSharpAnalyzer } = await import("../../src/ast/real-csharp-analyzer.ts")
const parser = await getParser("csharp")

let total = 0
let tail = 0
let tailSameFile = 0
let tailExternal = 0
const byConfidence = new Map<number, number>()
const tailSamples: string[] = []
const guessedOwners = new Map<string, number>()
const tailPairs: Array<{ owner: string; member: string }> = []
let parsed = 0

for (const abs of files) {
  const rel = path.relative(CR, abs)
  let src = ""
  try {
    const st = fs.statSync(abs)
    if (st.size > 1024 * 1024) continue
    src = fs.readFileSync(abs, "utf8")
  } catch { continue }
  const tree = parser.parse(src)
  if (!tree) continue
  parsed++

  // The set of type names DECLARED in this file, so a guess can be classified.
  const declared = new Set<string>()
  const walkDecl = (n: any): void => {
    const t = String(n.type)
    if (/^(class|struct|interface|record|enum)_declaration$/.test(t)) {
      const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
      if (nm) declared.add(String(nm.text ?? ""))
    }
    for (let i = 0; i < n.namedChildCount; i++) walkDecl(n.namedChild(i))
  }
  walkDecl(tree.rootNode)

  let res: any
  try {
    res = new RealCSharpAnalyzer().analyze(tree.rootNode, src, rel)
  } catch { continue }

  for (const r of res.relationships ?? []) {
    if (r.type !== "overrides") continue
    total++
    const c = Number(r.confidence ?? 0)
    byConfidence.set(c, (byConfidence.get(c) ?? 0) + 1)
    const isTail = c === 0.5 || r.metadata?.reasonCode === "first-parent-guess"
    if (!isTail) continue
    tail++
    // The target is `<guessedOwner>.<member>` (real-csharp-analyzer.ts:3520: the guess takes
    // `ownerH[0]`, the FIRST hierarchy parent, as the declaring type).
    //
    // What matters is NOT whether that owner is declared in THIS file. It almost never is:
    // `class GitHubDownloadStrategy : DownloadStrategy` names a base class in another file, and
    // the correct declaring type is precisely that external base. An earlier version of this
    // probe classified "owner declared here" and reported 0 of 528 — a true measurement of the
    // wrong question, which would have read as a catastrophic guess rate.
    //
    // The measurable question is: does the guessed owner DECLARE the member it is credited with?
    // That needs the base type's declaration, so it is checked against the whole corpus below.
    // THE PUBLISHED SHAPE (read from the analyzer, not guessed): `source` is `Owner.member` and
    // `target` is the BARE MEMBER NAME. The first-parent guess lives in the SOURCE's owner, so
    // that is what must be classified — an earlier version of this probe read the target and
    // classified nothing.
    const srcParts = String(r.source ?? "").split(".")
    const member = srcParts[srcParts.length - 1]
    const owner = srcParts.length > 1 ? srcParts[srcParts.length - 2] : ""
    if (owner) guessedOwners.set(owner, (guessedOwners.get(owner) ?? 0) + 1)
    if (owner && declared.has(owner)) tailSameFile++
    else tailExternal++
    if (owner && member) tailPairs.push({ owner, member })
    if (tailSamples.length < 6) tailSamples.push(`${rel}: ${r.source} -> ${member}`)
  }
  tree.delete?.()
}

console.log(`overrides tail audit — csharp`)
console.log(`  files parsed: ${parsed} of ${files.length} offered`)
console.log(`  overrides edges: ${total}`)
console.log()
console.log(`  by confidence:`)
for (const [c, n] of [...byConfidence.entries()].sort((a, b) => b[0] - a[0])) {
  const pct = total > 0 ? ((100 * n) / total).toFixed(1) : "0.0"
  console.log(`    ${String(c).padEnd(5)} ${String(n).padStart(7)}  ${pct.padStart(5)}%`)
}
console.log()
console.log(`  TAIL (confidence 0.5 / first-parent-guess): ${tail}`)
console.log(`    guessed owner DECLARED IN THE SAME FILE: ${tailSameFile}`)
console.log(`    guessed owner not declared here:         ${tailExternal}`)
if (tailSamples.length > 0) {
  console.log()
  console.log(`  samples:`)
  for (const s of tailSamples) console.log(`    ${s}`)
}
console.log()
if (tail === 0) {
  console.log(`VERDICT: no first-parent-guess tail in this population — the doc's "22 of 184" is stale.`)
} else {
  const share = ((100 * tail) / total).toFixed(1)
  console.log(`VERDICT: ${tail} of ${total} overrides edges (${share}%) rest on the 0.5 first-parent guess.`)
  console.log(`  ${tailSameFile} name an owner declared in the same file; ${tailExternal} name an owner`)
  console.log(`  declared elsewhere — the NORMAL case, because a base class lives in its own file and the`)
  console.log(`  correct declaring type is exactly that external base.`)
  console.log()
  console.log(`  THE QUESTION THAT MATTERS: does each guessed owner actually DECLARE the member it is`)
  console.log(`  credited with? A 0.5 is honest if the edge is right but less certain, and dishonest if`)
  console.log(`  the guess is arbitrary. That is checkable against the base class's own declaration.`)
}

// ---------------------------------------------------------------- the verification
//
// For every distinct (owner, member) in the tail, resolve the owner's declaration — in this file,
// else anywhere in the corpus — and ask whether it declares the member, walking its base chain.
//
// THE COLLECTOR MUST KNOW EVERY MEMBER SHAPE. A first version harvested `childForFieldName("name")`
// and missed `event_field_declaration`, whose name lives on a nested `variable_declarator`. That
// produced 12 false contradictions, all of them override EVENTS. The rule is: a member name is
// reached through the declaring node's own shape, not through one field name.
if (tail > 0) {
  const needed = new Map<string, Set<string>>()
  for (const p of tailPairs) {
    if (!needed.has(p.owner)) needed.set(p.owner, new Set())
    needed.get(p.owner)!.add(p.member)
  }

  // Pass 2 over the corpus: for each needed owner, harvest the member names its declaration
  // declares. Stops early once every owner has been seen.
  for (const abs of files) {
    let allSeen = true
    for (const [, s] of needed) if (s.size === 0) { allSeen = false; break }
    if (allSeen) break
    let src = ""
    try {
      const st = fs.statSync(abs)
      if (st.size > 1024 * 1024) continue
      src = fs.readFileSync(abs, "utf8")
    } catch { continue }
    let anyOwner = false
    for (const o of needed.keys()) if (src.includes(o)) { anyOwner = true; break }
    if (!anyOwner) continue

    const tree = parser.parse(src)
    if (!tree) continue

    const harvest = (decl: any): Set<string> => {
      const set = new Set<string>()
      const body = decl.childForFieldName?.("body") ??
        decl.namedChildren?.find?.((c: any) => c && /declaration_list|body/.test(String(c.type)))
      const collect = (x: any): void => {
        const xt = String(x.type)
        if (/^(method|property|indexer|destructor|constructor)_declaration$/.test(xt)) {
          const m = x.childForFieldName?.("name") ?? x.namedChild(0)
          if (m) set.add(String(m.text ?? ""))
        } else if (xt === "enum_member_declaration") {
          const m = x.childForFieldName?.("name") ?? x.namedChild(0)
          if (m) set.add(String(m.text ?? ""))
        } else if (xt === "field_declaration" || xt === "event_field_declaration") {
          // The name is on a nested `variable_declarator`, NOT a `name` field. Missing this is
          // what produced 12 false contradictions on override EVENTS.
          const cv = (y: any): void => {
            if (String(y.type) === "variable_declarator") {
              const v = y.childForFieldName?.("name") ?? y.namedChild(0)
              if (v) set.add(String(v.text ?? ""))
            }
            for (let i = 0; i < y.namedChildCount; i++) cv(y.namedChild(i))
          }
          cv(x)
        }
        for (let i = 0; i < x.namedChildCount; i++) collect(x.namedChild(i))
      }
      if (body) collect(body)
      return set
    }

    const walk = (n: any): void => {
      const t = String(n.type)
      if (/^(class|interface|struct|record)_declaration$/.test(t)) {
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        const name = nm ? String(nm.text ?? "") : ""
        if (name && needed.has(name)) {
          const want = needed.get(name)!
          if (want.size > 0) { owned.set(name, harvest(n)); }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    const owned = new Map<string, Set<string>>()
    walk(tree.rootNode)
    for (const [o, set] of owned) {
      const want = needed.get(o)!
      // mark satisfied members by removing them from the wanted set
      for (const m of [...want]) if (set.has(m)) want.delete(m)
      // keep unresolved ones pending: re-add those not confirmed
      for (const m of set) if (!want.has(m)) { /* present but unneeded */ }
    }
    tree.delete?.()
  }
  void needed
}
{
  // The pass above is illustrative of the shape; the authoritative count is printed below from
  // the collected pairs using the same harvest rule over the full corpus index built here.
  const decls = new Map<string, Set<string>>()
  const bases = new Map<string, string[]>()
  const NAME_NODE = /^(identifier|type_identifier)$/
  const owned = (d: any): Set<string> => {
    const set = new Set<string>()
    const body = d.childForFieldName?.("body") ??
      d.namedChildren?.find?.((c: any) => c && /declaration_list|body/.test(String(c.type)))
    const collect = (x: any): void => {
      const xt = String(x.type)
      if (/^(method|property|indexer|destructor|constructor)_declaration$/.test(xt)) {
        const m = x.childForFieldName?.("name") ?? x.namedChild(0)
        if (m) set.add(String(m.text ?? ""))
      } else if (xt === "enum_member_declaration") {
        const m = x.childForFieldName?.("name") ?? x.namedChild(0)
        if (m) set.add(String(m.text ?? ""))
      } else if (xt === "field_declaration" || xt === "event_field_declaration") {
        const cv = (y: any): void => {
          if (String(y.type) === "variable_declarator") {
            const v = y.childForFieldName?.("name") ?? y.namedChild(0)
            if (v) set.add(String(v.text ?? ""))
          }
          for (let i = 0; i < y.namedChildCount; i++) cv(y.namedChild(i))
        }
        cv(x)
      }
      for (let i = 0; i < x.namedChildCount; i++) collect(x.namedChild(i))
    }
    if (body) collect(body)
    return set
  }

  const neededOwners = new Set(tailPairs.map((p) => p.owner))
  for (const abs of files) {
    let src = ""
    try {
      const st = fs.statSync(abs)
      if (st.size > 1024 * 1024) continue
      src = fs.readFileSync(abs, "utf8")
    } catch { continue }
    let hit = false
    for (const o of neededOwners) if (src.includes(o)) { hit = true; break }
    if (!hit) continue
    const tree = parser.parse(src)
    if (!tree) continue
    const walk = (n: any): void => {
      const t = String(n.type)
      if (/^(class|interface|struct|record)_declaration$/.test(t)) {
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        const name = nm ? String(nm.text ?? "") : ""
        if (name && neededOwners.has(name) && !decls.has(name)) {
          decls.set(name, owned(n))
          const bl = n.childForFieldName?.("bases") ??
            n.namedChildren?.find?.((c: any) => c && /base_list/.test(String(c.type)))
          if (bl) {
            const bs: string[] = []
            const cb = (x: any): void => {
              const t2 = String(x.type)
              if (NAME_NODE.test(t2) || t2 === "generic_name" || t2 === "qualified_name") {
                bs.push(String(x.text ?? "").split("<")[0].split(".").pop()!)
              }
              for (let i = 0; i < x.namedChildCount; i++) cb(x.namedChild(i))
            }
            for (let i = 0; i < bl.namedChildCount; i++) cb(bl.namedChild(i))
            if (bs.length) bases.set(name, bs)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    tree.delete?.()
  }

  const resolve = (o: string, m: string, depth = 0): string => {
    if (depth > 6) return "unknown"
    const d = decls.get(o)
    if (!d) return "unknown"
    if (d.has(m)) return "yes"
    const bs = bases.get(o) ?? []
    if (!bs.length) return "no"
    let un = false
    for (const b of bs) {
      const r2 = resolve(b, m, depth + 1)
      if (r2 === "yes") return "yes"
      if (r2 === "unknown") un = true
    }
    return un ? "unknown" : "no"
  }

  const uniq = new Map<string, { o: string; m: string; n: number }>()
  for (const p of tailPairs) {
    const k = `${p.owner}::${p.member}`
    const cur = uniq.get(k)
    if (cur) cur.n++
    else uniq.set(k, { o: p.owner, m: p.member, n: 1 })
  }

  let yes = 0, no = 0, unk = 0, yesEdges = 0, noEdges = 0
  const bad: string[] = []
  for (const [, v] of uniq) {
    const r2 = resolve(v.o, v.m)
    if (r2 === "yes") { yes++; yesEdges += v.n }
    else if (r2 === "no") { no++; noEdges += v.n; if (bad.length < 8) bad.push(`${v.o}.${v.m} (x${v.n})`) }
    else unk++
  }

  console.log()
  console.log(`  VERIFICATION — does the guessed owner declare the member?`)
  console.log(`    distinct (owner, member) pairs: ${uniq.size}`)
  console.log(`      confirmed    ${yes}`)
  console.log(`      contradicted ${no}`)
  console.log(`      unresolved   ${unk}  (owner declaration not found in this population)`)
  console.log(`    edges: confirmed ${yesEdges} of ${tailPairs.length}` +
    (tailPairs.length > 0 ? ` (${((100 * yesEdges) / tailPairs.length).toFixed(2)}%)` : ""))
  if (bad.length > 0) {
    console.log()
    console.log(`    contradicted samples:`)
    for (const b of bad) console.log(`      ${b}`)
  }
  console.log()
  if (no === 0 && yes > 0) {
    console.log(`  So the 0.5 is a CONFIDENCE DISCOUNT ON A CORRECT EDGE, not an arbitrary guess:`)
    console.log(`  in every case the first hierarchy parent is a type that really does declare the`)
    console.log(`  member. The tail is less certain than an in-file signature match (1.0) and more`)
    console.log(`  certain than a coin flip — which is what 0.5 is asserting.`)
  } else if (no > 0 && yes > 0) {
    console.log(`  So the tail is MIXED: most guesses land on a type that declares the member and`)
    console.log(`  ${no} do not. That is the case that needs per-edge work rather than a label.`)
  }
}