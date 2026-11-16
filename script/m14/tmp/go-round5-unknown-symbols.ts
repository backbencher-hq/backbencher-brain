// go lane — LANE-AUDIT-FORMULA §5, measured through the PRODUCTION entry.
//
// "Zero unknown symbols, measured, not assumed." §5 asks for five counts over a
// real corpus, and the second half of the sentence is the part that decides
// this script's shape: run the production entry (`parseFile`), not the analyzer
// directly. Every other gate in this lane drives `RealGoAnalyzer.analyze` or the
// F5 harness's own path, so a defect that only appears in the entry — a
// language-routing miss, a context flag, a normalisation the entry applies
// before the analyzer sees the text — would be invisible to all of them. The R
// lane hit exactly that: "exercise the PRODUCTION path — every other check in
// this lane skips it" (3637d39b).
//
// The five counts, and what each one would mean if it were non-zero:
//
//   1. unknownKind         — a symbol whose kind is not in the enum. The
//                            product's own grouping cannot place it.
//   2. badName             — an empty, whitespace-only, or non-Go-identifier
//                            name. This is F14's G2 rule re-checked at the
//                            entry, plus the empty case.
//   3. memberWithoutOwner  — a member-kind symbol (method/property/field) with
//                            no `ownerName`, i.e. a member that rides no
//                            `contains` edge and is therefore unreachable as a
//                            member in the graph.
//   4. throwOnParse        — `parseFile` raising.
//   5. symbolFreeFile      — a file with zero symbols. Each one is CLASSIFIED,
//                            not counted: a file that legitimately declares
//                            nothing (comment-only, a build-constraint file, a
//                            package clause with no declarations) is fine, and a
//                            file that SHOULD have declarations is the
//                            GO-GAP-1 grammar-damage class. The two are
//                            reported separately, because "0" and "0 because we
//                            did not look" are the same number.
//
// The Go-identifier test is F14's own, copied rather than re-derived: a
// `letter` (Unicode letter or `_`) followed by letters and Unicode DIGITS. NOT
// ASCII — go-tools' own `go/ssa/interp/external.go` writes `ext۰bytes۰Equal`
// with U+06F0, an Arabic zero numeral, as a legal Go identifier, and an ASCII
// test would convict it.
//
// Run: bun script/m14/tmp/go-round5-unknown-symbols.ts [--repos a,b] [--files N] [--full]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const arg = (name: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// F14's predicate, copied. The gate writes its own so that a gate sharing the
// analyzer's rule cannot see the rule being wrong.
const GO_IDENT = /^[\p{L}_][\p{L}\p{Nd}_]*$/u

// The kinds the product can group by. `SymbolKind`'s string values, read from
// the enum's own members rather than guessed — a kind that is not in here is
// exactly what count #1 is looking for.
const KNOWN_KINDS = new Set<string>([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member",
  "type", "import", "export", "method", "property", "constructor", "namespace",
  "module", "table", "service", "resource", "event", "struct", "union", "file",
  "folder", "package", "class_member", "annotation", "field", "local_variable",
  "template", "macro", "protocol", "message", "enum_variant", "record",
  "trait", "impl", "generic", "parameter", "attribute", "label", "state", "action",
  "endpoint", "model", "view", "component", "hook", "store", "task", "job",
  "middleware", "plugin", "extension", "theme", "token", "config", "constant_value",
  "static_field", "instance_field", "abstract_method", "virtual_method", "data_type",
])
// Kinds that legitimately ride no owner: a package/module/file is the root of
// the graph, not a member of something.
const OWNERLESS_KINDS = new Set(["module", "namespace", "package", "file", "folder"])
// The kinds that ride a `contains` edge — i.e. a MEMBER of something. `struct`
// is deliberately NOT here: in the family's systems contract a struct is a
// top-level type that CONTAINS members, and the members are its fields
// (`property`) and methods. Counting a top-level `type Foo struct{}` as an
// ownerless member is the probe's bug, not the lane's — the first run of this
// script reported 1,544 of them, every sample a type declaration
// (`benchmark/parse/parse.go: Benchmark kind=struct`). The kind that IS a member
// without an owner is a real finding, so the set has to be right for the count
// to mean anything.
const MEMBER_KINDS = new Set(["method", "property", "field", "class_member", "enum_member", "instance_field", "static_field", "abstract_method", "virtual_method"])

const REPOS = (arg("--repos") ?? "<corpus-root>/bb_tests/repositories/go-tools").split(",")
const FULL = process.argv.includes("--full")
const WANT = Number(arg("--files") ?? 400)

const out: any[] = []
for (const root of REPOS) {
  const files: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "vendor" || e.name === "node_modules") continue
        stack.push(path.join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(dir, e.name))
    }
  }
  files.sort()
  const read = FULL ? files : files.slice(0, WANT)

  const counts = {
    filesListed: files.length,
    filesRead: 0,
    throwOnParse: 0,
    throwSamples: [] as string[],
    unknownKind: 0,
    unknownKindSamples: [] as string[],
    badName: 0,
    badNameSamples: [] as string[],
    memberWithoutOwner: 0,
    memberWithoutOwnerSamples: [] as string[],
    symbols: 0,
    symbolFreeFiles: 0,
    symbolFreeLegit: 0,
    symbolFreeSuspicious: 0,
    symbolFreeSuspiciousSamples: [] as string[],
    errorsReported: 0,
  }

  for (const f of read) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(root, f)
    let res: any
    try {
      res = await ASTEngine.parseFile(f, src, { language: "go" } as any)
    } catch (e: any) {
      counts.throwOnParse++
      if (counts.throwSamples.length < 8) counts.throwSamples.push(`${rel}: ${String(e?.message ?? e).slice(0, 140)}`)
      continue
    }
    counts.filesRead++
    counts.errorsReported += (res?.errors ?? []).length
    const syms: any[] = res?.symbols ?? []
    counts.symbols += syms.length
    if (syms.length === 0) {
      counts.symbolFreeFiles++
      // A file with no symbols is legitimate when it declares nothing: strip
      // comments and blank lines and see whether any declaration keyword
      // survives. That is the honest test — "0 symbols" is only a finding if
      // the text contains a declaration the analyzer failed to publish.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, "")
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "")
      const declares = /(^|\n)\s*(func|type|var|const|import)\b/.test(stripped)
      if (declares) {
        counts.symbolFreeSuspicious++
        if (counts.symbolFreeSuspiciousSamples.length < 10) {
          counts.symbolFreeSuspiciousSamples.push(`${rel} (a declaration keyword survives comment/string stripping)`)
        }
      } else {
        counts.symbolFreeLegit++
      }
    }
    for (const s of syms) {
      const kind = String(s?.kind ?? "")
      if (!KNOWN_KINDS.has(kind)) {
        counts.unknownKind++
        if (counts.unknownKindSamples.length < 10) counts.unknownKindSamples.push(`${rel}: ${JSON.stringify(String(s?.name))} kind=${JSON.stringify(kind)}`)
      }
      const name = String(s?.name ?? "")
      if (name.trim() === "" || !GO_IDENT.test(name)) {
        counts.badName++
        if (counts.badNameSamples.length < 10) counts.badNameSamples.push(`${rel}: ${JSON.stringify(name)}`)
      }
      if (MEMBER_KINDS.has(kind) && !s?.ownerName && !OWNERLESS_KINDS.has(kind)) {
        counts.memberWithoutOwner++
        if (counts.memberWithoutOwnerSamples.length < 10) {
          counts.memberWithoutOwnerSamples.push(`${rel}: ${JSON.stringify(name)} kind=${kind} metadata.isStructField=${String((s?.metadata as any)?.isStructField ?? "-")} isInterfaceMethod=${String((s?.metadata as any)?.isInterfaceMethod ?? "-")}`)
        }
      }
    }
  }
  out.push({ repo: root, extent: FULL ? "full extent" : `first ${WANT} of ${files.length}`, counts })
}

const total = out.reduce(
  (a, r) => {
    for (const k of Object.keys(r.counts)) {
      if (typeof r.counts[k] === "number") a[k] = (a[k] ?? 0) + r.counts[k]
    }
    return a
  },
  {} as Record<string, number>,
)

console.log(
  JSON.stringify(
    {
      probe: "go-round5-unknown-symbols",
      entry: "ASTEngine.parseFile — the production entry, not the analyzer directly",
      goIdentifierTest: "F14's own predicate, copied (Unicode letter head; letters and Unicode digits in the tail — NOT ASCII, because go-tools ships a legal identifier with U+06F0 in it)",
      note: "memberWithoutOwner is reported but the Go lane PUBLISHES embedded-interface members and struct fields with an owner; if this count is non-zero the sample tells you which shape, and the answer may be a ruling rather than a defect.",
      perRepo: out,
      total,
      verdict: {
        throwOnParse: total.throwOnParse === 0 ? "0 — production entry never raised" : `${total.throwOnParse} FILES RAISED`,
        unknownKind: total.unknownKind === 0 ? "0 — every kind is one the product can group by" : `${total.unknownKind} UNKNOWN KINDS`,
        badName: total.badName === 0 ? "0 — no empty, whitespace or non-Go-identifier name" : `${total.badName} BAD NAMES`,
        memberWithoutOwner: total.memberWithoutOwner === 0 ? "0 — every member rides an owner" : `${total.memberWithoutOwner} MEMBERS WITHOUT AN OWNER`,
        symbolFreeFiles: `${total.symbolFreeFiles} total: ${total.symbolFreeLegit} legitimately declaration-free, ${total.symbolFreeSuspicious} carrying a declaration the analyzer did not publish`,
      },
    },
    null,
    2,
  ),
)
