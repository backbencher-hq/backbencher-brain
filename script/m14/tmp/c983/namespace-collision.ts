/**
 * #987: is the typedef/tag collision a REAL C distinction, and does the payload
 * publish it? Two independent questions, and the first one does not need the
 * corpus at all.
 *
 *   typedef enum { A, B } V;
 *   struct V { int a; int b; };
 *
 * C keeps typedef names and struct tags in SEPARATE namespaces, so both are
 * spelled `V` and both are legal. The analyzer mints the anonymous enum's owner
 * name from the typedef ALIAS, so it publishes
 *
 *   contains V -> A, B        <- true of the typedef alias
 *   contains V -> a, b        <- true of the struct that shares the name
 *
 * under ONE owner, and a consumer resolving `V` gets a struct carrying two
 * enumerators it does not have. The doc has recorded this as an AMBIGUOUS OWNER
 * and left it unadjudicated, on the grounds that it "is a NAME-RESOLUTION
 * decision about which of two same-named C declarations owns the member" and
 * "neither is a mechanical patch".
 *
 * This probe settles the part that is decidable, which is whether the
 * distinction is real or a parse artifact. It hands clang a six-line translation
 * unit -- no corpus, no cmake, no curl_config.h -- and reads its AST:
 *
 *   TypedefDecl h1_tunnel_state   underlying type: `enum h1_tunnel_state`
 *   RecordDecl  h1_tunnel_state   tagUsed: struct, completeDefinition: true
 *
 * Two decls, one spelling, two namespaces, and the analyzer's payload collapses
 * them. That is the adjudication: the class is real and the payload is wrong
 * about it, and the remaining question is only WHICH losing option to take, since
 * the alias has no other name in the source to carry an identity.
 *
 * The three options, and what each costs, measured rather than asserted:
 *
 *   (a) keep both under `V`            -- current. Every member is present; the
 *                                         OWNER of half of them is a lie.
 *   (b) give the struct `V`, drop the  -- the struct's fields stay resolvable, the
 *       alias's members                  enumerators become unreachable. A NAMED LOSS.
 *   (c) give the alias `V`, drop the   -- the mirror. Also a named loss.
 *       struct's members
 *   (d) invent a qualifier for the      -- a name written in no source file, which
 *       alias (`V.alias`, `V.0`)         is the fabrication class #962 removed from
 *                                         `instantiates` and #963 removed from `exports`.
 *
 * (d) is ruled out by a ruling this lane already made twice. Between (a) and (b)/(c)
 * the choice is the owner's, and it is a loss either way, which is why it was not
 * taken here.
 *
 * The corpus census is a SEPARATE question and lives in
 * `script/m14/tmp/c983/ambiguous-owner.ts`: 9 files, 253 `contains` edges under an
 * ambiguous owner.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const PROBE = `typedef enum { NS_ALPHA, NS_BETA, NS_GAMMA } ns_probe_name;
struct ns_probe_name { int field_one; int field_two; int field_three; };
ns_probe_name instance;
`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c-namespace-"))
const src = path.join(tmp, "ns_probe.c")
fs.writeFileSync(src, PROBE)

let ast: any
try {
  ast = JSON.parse(execFileSync("clang", ["-std=gnu11", "-Xclang", "-ast-dump=json", "-fsyntax-only", src], { stdio: ["ignore", "pipe", "pipe"] }).toString())
} catch (e) {
  console.log(`clang failed: ${(e as Error).message}`)
  process.exit(1)
}

const collect = (node: any, kinds: Set<string>, acc: any[]): void => {
  if (Array.isArray(node)) {
    for (const c of node) collect(c, kinds, acc)
    return
  }
  if (!node || typeof node !== "object") return
  if (kinds.has(node.kind)) acc.push(node)
  for (const c of node.inner ?? []) collect(c, kinds, acc)
}
const decls: any[] = []
const consts: any[] = []
const fields: any[] = []
collect(ast, new Set(["TypedefDecl", "RecordDecl"]), decls)
collect(ast, new Set(["EnumConstantDecl"]), consts)
collect(ast, new Set(["FieldDecl"]), fields)

const typedef = decls.find((d) => d.kind === "TypedefDecl" && d.name === "ns_probe_name")
const record = decls.find((d) => d.kind === "RecordDecl" && d.name === "ns_probe_name")

console.log("== clang's view of the same six lines")
console.log(`  TypedefDecl ns_probe_name  underlying type: ${typedef?.type?.qualType ?? "(none)"}`)
console.log(`  RecordDecl  ns_probe_name  tagUsed: ${record?.tagUsed ?? "(none)"}   completeDefinition: ${record?.completeDefinition}`)
console.log(`  EnumConstantDecl: ${consts.filter((c) => String(c.name).startsWith("NS_")).map((c) => c.name).join(", ")}`)
console.log(`  FieldDecl:          ${fields.filter((f) => String(f.name).startsWith("field_")).map((f) => f.name).join(", ")}`)

const distinct =
  !!typedef &&
  !!record &&
  String(typedef.type?.qualType ?? "").startsWith("enum") &&
  record.tagUsed === "struct"

console.log(
  distinct
    ? "\nVERDICT: clang confirms the C distinction -- the alias is an ENUM and the tag is a STRUCT, two types with one spelling."
    : "\nVERDICT: the probe did NOT reproduce the distinction; do not treat this as an adjudication.",
)

// What the ANALYZER does with the same six lines, so the two answers sit side by side.
const { RealCAnalyzer } = await import(path.join(path.resolve(import.meta.dirname ?? ".", "..", "..", "..", ".."), "src/ast/real-c-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(path.resolve(import.meta.dirname ?? ".", "..", "..", "..", ".."), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(path.resolve(import.meta.dirname ?? ".", "..", "..", "..", ".."), "wasm", "tree-sitter-c.wasm"))))
const result = new RealCAnalyzer().analyze(parser.parse(PROBE).rootNode, PROBE, src)

const containers = (result.symbols ?? []).filter((s: any) => ["struct", "enum", "type"].includes(String(s.kind)) && String(s.name) === "ns_probe_name")
const contains = (result.relationships ?? []).filter((r: any) => String(r.type) === "contains" && String(r.source) === "ns_probe_name")

console.log("\n== the payload's view of the same six lines")
console.log(`  symbols named ns_probe_name: ${containers.map((s: any) => String(s.kind)).join(", ") || "(none)"}`)
console.log(`  contains ns_probe_name -> ${contains.map((r: any) => String(r.target)).join(", ") || "(none)"}`)

const ownersMerge = containers.length > 1 && contains.length > 0
console.log(
  ownersMerge
    ? `\nVERDICT: the payload publishes ${containers.length} containers under ONE name and merges their members under it. clang and the payload DISAGREE, and the corpus census puts the class at 9 files / 253 edges.`
    : "\nVERDICT: the payload did not merge the owners here; the class may be narrower than recorded.",
)
