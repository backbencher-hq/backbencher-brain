// rust #798 — "no unknown symbol" as a MEASUREMENT, not a claim.
//
// The c-lane audit's rule (reviews/m60-c-lane-audit.md): a lane may claim "no
// unknown symbols" only by counting them over real files through the
// production entry. This probe walks every `.rs` file of a corpus and reports
// exactly the classes that would violate the claim:
//
//   blankName      an empty / whitespace symbol name
//   unknownName    a name that is the literal placeholder "unknown" / "?"
//   blankId        the blank identifier `_` minted as a symbol (R12)
//   unknownKind    a symbol kind outside the taxonomy the lane declares
//   noOwnerMember  a member (kind method/field/property) with no parent
//   sentinelOwner  a symbol whose parent is a placeholder owner
//
// It also reports the name-surface shape that would be unresolvable to a
// consumer (whitespace inside a name, a name starting with punctuation),
// the impl-target name surface (R10: an impl's published name must be a name,
// and a QUALIFIED path is one — that class is disclosed, not convicted), and
// the raw-identifier class (kept with its `r#` so it is not a bare keyword).
//
// Run: bun script/m14/tmp/rust-798-symbol-census.ts <repoRoot>
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"

const root = process.argv[2]
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 14) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("rust" as any)
const analyzer = new RealRustAnalyzer()

// ONLY the literal placeholder the analyzer's own fallback can mint
// (real-rust-analyzer.ts: `... ? pName.text : "unknown"`). "null"/"undefined"
// were in an earlier revision of this list and reported ripgrep's REAL type
// `Null` (crates/core/flags/defs.rs) and REAL field `null`
// (crates/core/flags/lowargs.rs) as placeholders — a probe must not invent the
// defect it is looking for.
const PLACEHOLDERS = new Set(["unknown", "?", "<unknown>"])
const MEMBER_KINDS = new Set(["method", "field", "property", "constructor"])

const counts: Record<string, number> = {
  files: files.length, symbols: 0, relationships: 0,
  blankName: 0, unknownName: 0, blankId: 0, unknownKind: 0,
  noOwnerMember: 0, sentinelOwner: 0, whitespaceName: 0, punctuationName: 0,
  // Relationship-target surface: a published target must be a NAME a consumer
  // can resolve. A raw-text target (`anyhow::Error`, `T::Err`, `<T as X>::Err`)
  // is the c/cpp #924 class — so this counts targets that are not bare names,
  // per label, because `references` is the label that carried them.
  refTargetNotName: 0, usesTargetNotName: 0, callsTargetNotName: 0,
  // Raw identifiers: `fn r#try` is spelled `r#try` in source and nowhere else;
  // if the analyzer publishes the prefix in BOTH the symbol and the target it is
  // self-consistent (resolvable), which is what these two counters separate.
  // The prefix is KEPT deliberately: stripping it would publish the bare
  // keywords `try` / `async`, which F14's R2 refuses by name.
  rawIdentSymbol: 0, rawIdentTarget: 0, implTargetNonName: 0, implTargetQualified: 0,
}
const RAW_IDENT = /^r#/
// A bare name: identifier chars only. Deliberately NOT permitting `::`, `<`,
// `>`, whitespace, quotes or a leading punctuation char.
const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
// F14's R2, mirrored: the R10 ruling KEEPS a qualified path as the impl's name
// (the deferred constructor filter reads in-file symbol names), so `::` alone is
// not a violation. A violation is a name that is not a `::`-joined path of rust
// identifiers — i.e. an actual type TEXT (`&mut ProcessBuilder`, `[u8]`).
const RUST_RESERVED = new Set([
  "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn",
  "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref",
  "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
  "unsafe", "use", "where", "while", "async", "await", "dyn", "abstract", "become",
  "box", "do", "final", "macro", "override", "priv", "try", "typeof", "unsized",
  "virtual", "yield", "union",
])
const isRustName = (n: string) => n.split("::").every((seg) => BARE_NAME.test(seg) && !RUST_RESERVED.has(seg))
const samples: string[] = []
const kinds = new Map<string, number>()
const note = (klass: string, detail: string) => {
  counts[klass]++
  if (samples.length < 40) samples.push(`${klass}: ${detail}`)
}

for (const f of files) {
  const content = fs.readFileSync(f, "utf8")
  let rootNode: any
  try { rootNode = parser.parse(content).rootNode } catch { continue }
  if (!rootNode) continue
  const res: any = await analyzer.analyze(rootNode, content, f)
  const rel = path.relative(root, f)
  const syms: any[] = res.symbols ?? []
  counts.symbols += syms.length
  counts.relationships += (res.relationships ?? []).length
  const names = new Set(syms.map(s => String(s.name ?? "")))
  for (const s of syms) {
    const name = String(s.name ?? "")
    const kind = String(s.kind ?? "")
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
    if (name.trim() === "") note("blankName", `${kind} @ ${rel}:${s.startLine ?? "?"}`)
    else if (PLACEHOLDERS.has(name)) note("unknownName", `${name} (${kind}) @ ${rel}`)
    if (name === "_") note("blankId", `${kind} @ ${rel}`)
    if (!kind) note("unknownKind", `<no kind> ${name} @ ${rel}`)
    if (/\s/.test(name.trim())) note("whitespaceName", `${JSON.stringify(name)} (${kind}) @ ${rel}`)
    if (/^[^A-Za-z_]/.test(name)) note("punctuationName", `${JSON.stringify(name)} (${kind}) @ ${rel}`)
    if (RAW_IDENT.test(name)) counts.rawIdentSymbol++
    // The impl-target class: an impl symbol whose name is the target's TYPE TEXT
    // (a reference/slice/tuple is not a nominal name). The same text also rides
    // `implements` sources and `Self` resolution — one root, three surfaces.
    if (kind === "impl" && !BARE_NAME.test(name)) {
      if (isRustName(name)) counts.implTargetQualified++
      else note("implTargetNonName", `${JSON.stringify(name)} @ ${rel}:${s.startLine ?? "?"}`)
    }
    if (MEMBER_KINDS.has(kind)) {
      const parent = String(s.parent ?? s.parentName ?? "")
      if (!parent) note("noOwnerMember", `${name} (${kind}) @ ${rel}`)
      else if (PLACEHOLDERS.has(parent.toLowerCase()) || parent === "_") note("sentinelOwner", `${name} (${kind}) parent=${JSON.stringify(parent)} @ ${rel}`)
    }
  }
  for (const r of res.relationships ?? []) {
    const label = String(r.type ?? "")
    const target = String(r.target ?? "")
    if (label !== "references" && label !== "uses" && label !== "calls") continue
    if (BARE_NAME.test(target)) continue
    const klass = label === "references" ? "refTargetNotName" : label === "uses" ? "usesTargetNotName" : "callsTargetNotName"
    if (RAW_IDENT.test(target)) counts.rawIdentTarget++
    note(klass, `${label} -> ${JSON.stringify(target)} from=${r.source} @ ${rel}`)
  }
  void names
}

console.log(JSON.stringify({ repo: root, ...counts, kinds: Object.fromEntries([...kinds].sort()) }, null, 1))
if (samples.length) console.log("samples:\n" + samples.join("\n"))
