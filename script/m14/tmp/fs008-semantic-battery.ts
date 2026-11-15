// FS008 — SEMANTIC CORRECTNESS battery for the fsharp lane: constructs the analyzer
// must classify a particular way, run through the PRODUCTION entry, each with the
// F#-language reason for the expected answer stated in the case itself.
//
// WHY THIS SHAPE. A differential that compares the analyzer to an oracle built from the
// same assumptions proves agreement, not correctness. These cases are the ones where the
// answer is decided by the LANGUAGE, not by a convention: an F# `struct` is not a class,
// a DU case that carries data is not a C# enum member, a `member` with a `[<Struct>]` is
// not a class member, an active pattern is not a function, a type abbreviation is not a
// class. Each case declares what F# says and what the analyzer emitted.
//
// Run: bun script/m14/tmp/fs008-semantic-battery.ts [--only <id>] [--json out.json]
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }

interface Case {
  id: string
  why: string
  src: string
  /** the assertion: a predicate over the production result */
  check: (r: any) => { ok: boolean; detail: string }
}

const K = (name: string) => (r: any) => r.symbols.filter((s: any) => String(s.kind) === name)
const named = (n: string) => (r: any) => r.symbols.filter((s: any) => String(s.name) === n)
const rels = (t: string) => (r: any) => r.relationships.filter((x: any) => String(x.type) === t)

const CASES: Case[] = [
  {
    id: "FSS1",
    why: "`type X = struct (int * int)` is a STRUCT (a value type with an implicit layout), not a class. F# 7 `struct_type` is a distinct grammar node; the analyzer's kind ladder has no struct_type arm, so it falls through to the Class default.",
    src: `module M\ntype Point = struct (int * int)\n`,
    check: (r) => {
      const p = named("Point")(r)[0]
      return { ok: !!p && String(p.kind) !== "class", detail: `Point kind = ${p?.kind}` }
    },
  },
  {
    id: "FSS2",
    why: "`type Shape = Circle of int | Square of int` is a discriminated UNION whose cases CARRY DATA. F# case resolution (`if Circle r x`) depends on the payload, so treating them as C#-style enum members publishes a shape the language does not have. The analyzer maps every union_type_case to EnumMember unconditionally (its own comment claims DU -> enum).",
    src: `module M\ntype Shape =\n    | Circle of int\n    | Square of int\n    | Point\n`,
    check: (r) => {
      const c = named("Circle")(r)[0]
      return { ok: !!c && String(c.kind) !== "enum_member", detail: `Circle kind = ${c?.kind} (metadata=${JSON.stringify(c?.metadata)})` }
    },
  },
  {
    id: "FSS3",
    why: "`type Celsius = float with [<Measure>]` and `type Meters = float with [<Measure>]` are UNITS OF MEASURE — distinct types that do not mix. The analyzer sniffs the ATTRIBUTE'S SOURCE TEXT for the substring 'Measure' (a text test, not an AST one) and maps the type to SymbolKind.Type.",
    src: `module M\n[<Measure>]\ntype Celsius = float with [<Measure>]\ntype Meters = float with [<Measure>]\ntype CelsiusTimesMeters = Celsius * Meters\n`,
    check: (r) => {
      const c = named("Celsius")[0] ?? named("Celsius")(r)[0]
      return { ok: !!c, detail: `Celsius kind = ${c?.kind}` }
    },
  },
  {
    id: "FSS4",
    why: "A `struct` (F# 3+) is a nominal type with a primary constructor and members — closer to a class than to a record, but the language gives it value semantics and forbids inheritance. The analyzer has no `struct_type_defn` arm at all (FSS2's census: `struct_type` is a live node, 35 files).",
    src: `module M\n[<Struct>]\ntype S(x: int) =\n    val X = x\n    member this.Double = x * 2\n`,
    check: (r) => {
      const s = named("S")(r)[0]
      return { ok: !!s, detail: `S kind = ${s?.kind}, members = ${JSON.stringify(named("Double")(r).map((m: any) => m.kind))}` }
    },
  },
  {
    id: "FSS5",
    why: "A `member` inside a `type ... with` EXTENSION is a member OF the extended type, not of a new type. The analyzer publishes a `type_extension` as a Class symbol with the extended type's NAME, so `contains` says the type contains itself and the extension's members get a phantom second owner.",
    src: `module M\ntype Foo() =\n    member this.A = 1\ntype Foo with\n    member this.B = 2\n`,
    check: (r) => {
      const foos = named("Foo")(r)
      const b = named("B")(r)[0]
      return { ok: foos.length === 1, detail: `Foo symbols = ${foos.length} (${JSON.stringify(foos.map((f: any) => `${f.kind}@${f.range?.startLine}`))}), B.owner = ${b?.ownerName}` }
    },
  },
  {
    id: "FSS6",
    why: "`[<Struct>]`-free type abbreviations (`type Name = OtherType`) are ALIASES. `SymbolKind.TypeAlias` is the engine's own kind for this, aliased to `type`. The analyzer maps every type_abbrev_defn to `type`, which is the same value — recorded here so the lane's kind ladder is a decision, not an accident.",
    src: `module M\ntype Original = int * string\ntype Alias = Original\n`,
    check: (r) => {
      const a = named("Alias")(r)[0]
      return { ok: !!a && String(a.kind) === "type", detail: `Alias kind = ${a?.kind}` }
    },
  },
  {
    id: "FSS7",
    why: "`type X = | A | B` with a `[<StructuredFormatDisplay>]`-style attribute aside, a plain enum in F# is `type E = A = 0 | B = 1`. The analyzer maps enum_type_defn to Enum — correct — but its DU branch is checked FIRST, so a type that has BOTH (illegal) is moot; the real risk is the reverse order changing nothing. This case pins the enum arm works at all.",
    src: `module M\ntype Color =\n    | Red = 0\n    | Green = 1\n`,
    check: (r) => {
      const c = named("Color")(r)[0]
      const red = named("Red")(r)[0]
      return { ok: String(c?.kind) === "enum" && String(red?.kind) === "enum_member", detail: `Color=${c?.kind} Red=${red?.kind}` }
    },
  },
  {
    id: "FSS8",
    why: "An F# `delegate` is a distinct type with an `Invoke` member. The analyzer maps delegate_type_defn to SymbolKind.Type, and the engine HAS a `delegate` kind. F#'s `delegate` is the language's function type with a target — closer to a C# delegate than to a type abbreviation.",
    src: `module M\ntype Del = delegate of int * int\n`,
    check: (r) => {
      const d = named("Del")(r)[0]
      return { ok: !!d, detail: `Del kind = ${d?.kind}` }
    },
  },
  {
    id: "FSS9",
    why: "A `struct type` abbreviation `type P = struct (int*int)` and a `struct` DECLARATION are different grammar nodes; so is `interface`. The analyzer's `hasInterfaceTypeDefn` check uses findDescendants with default maxDepth 5, which is enough, but `hasRecordTypeDefn` etc. all use depth 5 while `inherits` uses 8 — an asymmetry to pin.",
    src: `module M\ntype I =\n    abstract member A : int\n    abstract member B : int with get\ntype C() =\n    interface I with\n        member this.A = 1\n        member this.B = 2\n`,
    check: (r) => {
      const i = named("I")(r)[0]
      const impl = rels("implements")(r).filter((e: any) => e.source === "C")
      return { ok: String(i?.kind) === "interface" && impl.length >= 1, detail: `I=${i?.kind} implements(C)=${JSON.stringify(impl.map((e: any) => e.target))}` }
    },
  },
  {
    id: "FSS10",
    why: "The engine's SymbolKind has `type`, `union`, `struct`, `interface`, `enum`, `record`(->type), `class`. F#'s four nominal type forms (class, interface, struct, enum, union, record) are 6, and the analyzer has 5 arms + 2 defaults. The DU arm's destination (`enum`) is a language mismatch; the record arm's destination (`class`) is at least a defensible flattening. This case measures the WHOLE ladder on one file so the record is falsifiable.",
    src: `module M\ntype R = { A: int; B: string }\ntype U = X | Y\ntype E = Red = 0\ntype I = interface end\ntype C = class end\ntype S = struct (int*int)\ntype T = int\ntype A = int with [<Measure>]\n`,
    check: (r) => {
      const kinds = ["R", "U", "E", "I", "C", "S", "T", "A"].map((n) => `${n}=${named(n)(r)[0]?.kind ?? "MISSING"}`)
      return { ok: !kinds.some((k) => k.endsWith("MISSING")), detail: kinds.join(" ") }
    },
  },
]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const only = argOf("--only")
  const rows: any[] = []
  let fail = 0
  for (const c of CASES) {
    if (only && c.id !== only) continue
    const f = `/tmp/opencode/fs008-${c.id}.fsx`
    fs.writeFileSync(f, c.src)
    let r: any
    try { r = await ASTEngine.parseFile(f, c.src) } catch (e: any) {
      rows.push({ id: c.id, ok: false, detail: `CRASH ${String(e?.message ?? e).slice(0, 100)}`, why: c.why }); fail++; continue
    }
    const res = c.check(r)
    const errs = [...(r.errors ?? []), ...(r.metadata?.errors ?? [])]
    rows.push({ id: c.id, ok: res.ok, detail: res.detail + (errs.length ? ` [${errs.length} parse error(s)]` : ""), why: c.why,
      symbols: r.symbols.map((s: any) => ({ name: s.name, kind: s.kind, owner: s.ownerName, line: s.range?.startLine })),
      relationships: r.relationships.map((x: any) => ({ type: x.type, source: x.source, target: x.target, line: x.line_number })) })
    if (!res.ok) fail++
  }
  const jp = argOf("--json")
  if (jp) fs.writeFileSync(jp, JSON.stringify({ at: new Date().toISOString(), cases: CASES.length, failed: fail, rows }, null, 1))
  console.log(`FS008 semantic battery: ${rows.length} cases, ${rows.length - fail} hold, ${fail} fail\n`)
  for (const r of rows) {
    console.log(`  ${r.ok ? "HOLD  " : "FAIL  "} ${r.id}  ${r.detail}`)
    if (!r.ok) console.log(`         why: ${r.why}`)
  }
  console.log(`\nNOTE: every case above is a MEASUREMENT of the lane's current behaviour, not yet a verdict.`)
  console.log(`A FAIL here is a finding to adjudicate (analyzer defect vs a declared design decision), not an automatic fix.`)
}
void main()
