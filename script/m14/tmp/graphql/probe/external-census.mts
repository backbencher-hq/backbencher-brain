/**
 * Cause C, measured: WHICH unresolved targets are the SPECIFICATION's own
 * vocabulary, and which are genuinely absent?
 *
 * The brief asks for external references to be "emitted with an explicit
 * external marker so they are countable and excluded, instead of silently
 * unresolved". Before writing the marker I have to know the population it would
 * mark, because a marker that catches everything external-looking is decoration.
 *
 * The store measurement (out/store-resolution-gqlgen110.txt) showed `references`
 * failing 714/1312 with the 714 being exactly String 495, Int 119, Boolean 76,
 * Float 24 — five names the GraphQL specification defines. That is one corpus.
 * This probe runs the same classification over a wider sample through production
 * `parseFile`, and splits the remainder into named buckets so the residue is not
 * a single unexplained blob.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/external-census.mts <files> <corpus>
 */
import * as fs from "fs"
import * as path from "path"
import { ASTEngine } from "../../../../../src/ast/engine"

const limit = Number(process.argv[2] ?? 400)
const corpus = process.argv[3] ?? "<corpus-root>/bb_tests/repositories"

/** The GraphQL specification's own vocabulary — declared by the SPEC, not by any
 * file in a corpus. Section 3.5 "Built-in Scalars" and section 3.13 "Built-in
 * Directives"; the introspection types are section 4. */
const SPEC_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])
const SPEC_DIRECTIVES = new Set(["skip", "include", "deprecated", "specifiedBy"])
const SPEC_INTROSPECTION = new Set([
  "__Schema",
  "__Type",
  "__Field",
  "__InputValue",
  "__EnumValue",
  "__Directive",
  "__TypeKind",
  "__DirectiveLocation",
])

function collect(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
      collect(p, out)
    } else if (e.name.endsWith(".graphql") || e.name.endsWith(".gql")) out.push(p)
  }
  return out
}

const all = collect(corpus).sort()
const files = all.slice(0, limit)
console.log(`corpus ${corpus}: ${all.length} graphql files present, walking ${files.length}`)

const names = new Set<string>()
const unresolved = new Map<string, { n: number; types: Set<string>; files: Set<string> }>()
let parsed = 0
let failed = 0
let edges = 0

for (const f of files) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) names.add(s.name)
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (!t) continue
    edges++
    if (names.has(t)) continue // NOTE: checked against a growing set; see caveat below
    let u = unresolved.get(t)
    if (!u) unresolved.set(t, (u = { n: 0, types: new Set(), files: new Set() }))
    u.n++
    u.types.add(String(e?.type ?? ""))
    u.files.add(f)
  }
}

console.log(`parsed ${parsed} failed ${failed}   edges ${edges}   published names ${names.size}`)
console.log(`unresolved distinct targets (name-only, single pass): ${unresolved.size}\n`)

const buckets = new Map<string, string[]>()
const put = (b: string, t: string) => {
  let a = buckets.get(b)
  if (!a) buckets.set(b, (a = []))
  a.push(t)
}
for (const t of unresolved.keys()) {
  const bare = t.startsWith("@") ? t.slice(1) : t
  if (SPEC_SCALARS.has(bare)) put("spec built-in scalar", t)
  else if (SPEC_DIRECTIVES.has(bare)) put("spec built-in directive", t)
  else if (t.startsWith("__")) put("spec introspection", t)
  else put("NOT spec — residual", t)
}

for (const [b, ts] of [...buckets.entries()].sort((a, b2) => b2[1].length - a[1].length)) {
  const edgesIn = ts.reduce((s, t) => s + unresolved.get(t)!.n, 0)
  console.log(`${b.padEnd(24)} distinct ${String(ts.length).padStart(5)}   edges ${String(edgesIn).padStart(6)}`)
  const sorted = ts.sort((a, b2) => unresolved.get(b2)!.n - unresolved.get(a)!.n)
  for (const t of sorted.slice(0, 12)) {
    const u = unresolved.get(t)!
    console.log(`      ${String(u.n).padStart(5)}  ${t.padEnd(34)} [${[...u.types].join(",")}]`)
  }
  if (sorted.length > 12) console.log(`      ... ${sorted.length - 12} more`)
  console.log()
}
console.log(
  "CAVEAT: this is a SINGLE PASS with a growing name set, so a target that a LATER file\n" +
    "declares is still counted unresolved. It is an UPPER BOUND on the unresolved set, and\n" +
    "the store numbers in out/store-resolution-gqlgen110.txt are the exact ones.",
)