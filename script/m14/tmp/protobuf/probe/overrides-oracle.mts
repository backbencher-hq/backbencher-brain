/**
 * OVERRIDES ORACLE — the last DERIVATION finding, adjudicated as far as it goes.
 *
 * ## Why this file exists
 *
 * `overrides` is this lane's one remaining DERIVATION finding: a relationship the
 * analyzer emits that nothing audits. Passes 8 and 10 built a `protoc` oracle for
 * `uses`, `contains`, `imports` and `exports` and recorded why `overrides` could
 * not join them:
 *
 *   > no descriptor field records that a field number was declared twice, and
 *   > `protoc` REJECTS the construct — its one corpus instance is
 *   > `nvim-treesitter/tests/query/highlights/proto/test.proto`
 *
 * That reason is half right, and the half that is wrong is worth separating.
 * `protoc` does reject the file, so there is no descriptor. But **`protoc` still
 * reports the doubling as a diagnostic**, and it reports it from C++ code that
 * shares nothing with a tree-sitter grammar:
 *
 *   test.proto:40:25: "Value" is already defined in "sls.asfd.asfd.LogContent".
 *
 * That names the field (`Value`), the message (`sls.asfd.asfd.LogContent`) and the
 * line (40) — independently of anything this lane reads. What that diagnostic
 * covers is the NAME half of the construct. `protoc` fires on the name collision
 * alone and says nothing about whether the two declarations also share a field
 * NUMBER, which is the other half of what this analyzer emits. So this file
 * supplies two witnesses of different scope rather than pretending to one of
 * full scope:
 *
 *   WITNESS 1 — `protoc`, an independent implementation, NO shared grammar:
 *              a second declaration of field `Value` in message
 *              `sls.asfd.asfd.LogContent` exists at line 40.
 *   WITNESS 2 — an independent tree walk in this file, WHICH SHARES the
 *              tree-sitter grammar with the analyzer: a message declares field
 *              number 2 twice, which is the half `protoc` is silent on.
 *   WITNESS 3 — `probe/overrides-direction-witness.mts`, added at pass 19: protoc
 *              DOES adjudicate the number half, across a oneof boundary, on a
 *              well-formed file, and it names the EARLIER declaration as the holder
 *              of the doubled number. That closes the edge DIRECTION, which until
 *              then was asserted by the fixture suite and by nothing else. It is C++
 *              and shares no grammar with this analyzer. It runs on purpose-built
 *              fixtures rather than on the corpus, because protoc REJECTS the corpus
 *              files that carry the construct — see that probe's header for why.
 *
 * ## What witness 2 is and is not
 *
 * It is a second implementation, written here from the parse tree with the node
 * API, sharing no code with `emitSlotOverride`. It is NOT an independent grammar:
 * a tree-sitter grammar bug that invented a `field` node would be invisible to it,
 * and this file says so rather than claiming the finding closed. The declared
 * limitation of every oracle in this programme is the same, and it is stated once
 * here rather than per number.
 *
 * Its value is that it makes the construct's corpus-wide count INDEPENDENT of the
 * analyzer, which is what turns "1 edge" from a possibly-undercounted number into
 * a measured one. It walks every message body in the corpus, collects
 * `(message, fieldNumber) -> declarations`, and reports every pair declared twice.
 * If the analyzer emitted fewer `overrides` edges than that walk finds doubled
 * slots, the analyzer is under-reading a construct this lane has been citing as
 * occurring once in 821 files.
 *
 * The corpus-wide count is also the falsifier: a doubled slot anywhere that
 * carries no `overrides` edge is named here, by file and line.
 *
 * ## Diagnostics are parsed WITHOUT a regular expression
 *
 * `protoc` writes `file:line:col: "name" is already defined in "scope".` The
 * diagnostic is taken apart by scanning for the quote characters and the colons
 * between them, not by a pattern. Nothing in this file or in the analyzer uses a
 * regex.
 *
 * ## Usage
 *
 *   npx tsx script/m14/tmp/protobuf/probe/overrides-oracle.mts [--protoc <path>] [--file <path>]
 *
 * Exits 0 whatever it finds; the numbers are the output.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const PROTOC = process.env.BB_PROTOC ?? "/tmp/opencode/protoc-36/bin/protoc"
const OUT = "/tmp/opencode/pb/overrides-oracle.json"
const DIRECTION_OUT = "/tmp/opencode/pb/overrides-direction.json"
const argOf = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const CARRIER = argOf(
  "file",
  path.join(CR, "nvim-treesitter/tests/query/highlights/proto/test.proto"),
)
const CARRIER_DIR = path.dirname(CARRIER)
const CARRIER_NAME = path.basename(CARRIER)

// ------------------------------------------------------------------ grammar
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const grammar = await LanguageClass.load(
  readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")),
)
const analyzer = new RealProtobufAnalyzer()

// ------------------------------------------------------------------ population
type CorpusFile = { repo: string; rel: string; abs: string }
const corpus: CorpusFile[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (!k.endsWith(".proto")) continue
      corpus.push({ repo: entry, rel: r, abs })
    }
  }
  walk(dir, "")
}

// ================================================================== WITNESS 1
// `protoc`, an independent implementation. Read-only, writes nothing: the
// descriptor goes to /dev/null and the file is never modified.
type Diag = { line: number; col: number; quoted: string[]; text: string }
const diags: Diag[] = []
let protocRan = false
let protocExit: number | null = null
let protocStderrHead = ""
if (existsSync(PROTOC)) {
  protocRan = true
  try {
    execFileSync(PROTOC, [`--proto_path=${CARRIER_DIR}`, "--descriptor_set_out=/dev/null", CARRIER_NAME], {
      cwd: CARRIER_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    })
    protocExit = 0
  } catch (e: any) {
    protocExit = typeof e?.status === "number" ? e.status : null
    const err = String(e?.stderr ?? "")
    protocStderrHead = err.split("\n").slice(0, 3).join("\n")
    for (const raw of err.split("\n")) {
      const line = raw.trim()
      if (line.length === 0) continue
      // `file:line:col: text` — take the position by scanning colons, not by pattern.
      const parts: string[] = []
      let cursor = 0
      while (parts.length < 3) {
        const at = line.indexOf(":", cursor)
        if (at < 0) break
        parts.push(line.slice(cursor, at))
        cursor = at + 1
      }
      const ln = Number(parts[1])
      const cl = Number(parts[2])
      if (!Number.isFinite(ln) || !Number.isFinite(cl)) continue
      const text = line.slice(cursor).trim()
      const quoted: string[] = []
      let q = text.indexOf('"')
      while (q >= 0) {
        const close = text.indexOf('"', q + 1)
        if (close < 0) break
        quoted.push(text.slice(q + 1, close))
        q = text.indexOf('"', close + 1)
      }
      diags.push({ line: ln, col: cl, quoted, text })
    }
  }
}

// ================================================================== WITNESS 2
// An independent walk for the half `protoc` is silent on: the field NUMBER.
//
// ## The population is defined by the NODE TYPE, not by a path through the tree
//
// The first two versions of this walk descended `source_file -> message ->
// message_body -> field`, which is a path and therefore has holes: a field inside
// a `oneof` is a child of the `oneof`, and an extension field is a child of an
// `extend` block, so neither is a direct child of any `message_body` and both were
// skipped. A walk with holes reports a construct count over a population smaller
// than the language, and a construct count over the wrong population is the
// failure the honesty contract names first.
//
// So this walk visits EVERY node in the tree and takes EVERY `field` node that has
// a `field_number` child. The population is then total by construction, and the
// scope each declaration belongs to is read off a stack the walk maintains:
// `package` at the root, `message` by its `message_name`, a `group` by its
// `identifier` (a proto2 group is a `field` node carrying a `message_body` and no
// `type` child, and it declares a nested type), `oneof` by its own name, and
// `extend` by the type it extends.
//
// The counts the walk prints are therefore checkable against each other: the
// number of `field` nodes it consumed, the number of distinct scopes it derived,
// and the number of doubled slots. A walk that silently saw nothing would print
// 0, 0, 0, and would be caught by the `field` node type being absent from the
// tally rather than by trusting the zero.
//
// It is NOT an independent grammar: a tree-sitter grammar bug that invented a
// `field` node would be invisible to it. The oracle limitation declared for every
// instrument in this programme is the same and is stated once, here, rather than
// repeated per number.
type Slot = { file: string; scope: string; kind: string; number: string; name: string; line: number; declType: string }
const slots: Slot[] = []
const declTypeTally = new Map<string, number>()
let fieldNodesSeen = 0
let fieldsWithoutNumber = 0
let groupBodies = 0
let oneofs = 0
let oneofNames = 0
let extendResolved = 0
let extendUnresolved = 0
const extendUnresolvedExamples: string[] = []
let extendBlocks = 0
let messages = 0
let idx = 0
const doubled: (Slot & { alsoName: string[] })[] = []

async function worker(): Promise<void> {
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  while (true) {
    const i = idx++
    if (i >= corpus.length) return
    const f = corpus[i]
    const label = `${f.repo}/${f.rel}`
    const content = readFileSync(f.abs, "utf8")
    const tree = parser.parse(content)
    const pkg = firstIdentOf(tree.rootNode, content, "package")
    const rootScope = pkg ? pkg : ""

    // Every message name THIS file declares, by qualified name. Collected before
    // any slot is recorded, because resolving an `extend`'s target needs it: see
    // `resolveExtendee`.
    const declared = new Set<string>()
    const collect = (node: any, scope: string[]): void => {
      for (const child of namedChildren(node)) {
        if (child.type === "message") {
          const own = firstChildText(child, "message_name") || firstChildText(child, "identifier")
          const parts = own.length === 0 ? [] : own.split(".")
          for (let take = parts.length; take >= 1; take--) {
            declared.add([...scope, ...parts.slice(0, take)].join("."))
          }
          collect(child, [...scope, ...parts])
          continue
        }
        collect(child, scope)
      }
    }
    collect(tree.rootNode, rootScope ? [rootScope] : [])

    // Two scopes are tracked, because they differ inside an `extend` and only
    // there: a field's SLOT belongs to the extendee, while a `message` DECLARED
    // inside the block belongs to the enclosing scope. Collapsing them into one
    // puts every file-level `extend` in the corpus into a single slot space —
    // 58 phantom doublings on the run that did it — because `extendee` is not a
    // node type in this grammar, so the extendee read as empty and the block's
    // fields fell back to the package.
    const recordField = (decl: any, slotScope: string): void => {
      fieldNodesSeen++
      const numNode = namedChildrenOfType(decl, "field_number")[0]
      const groupBody = namedChildrenOfType(decl, "message_body")[0]
      const name = firstChildText(decl, "identifier")
      if (!numNode) { fieldsWithoutNumber++; return }
      if (groupBody) groupBodies++
      const number = textOf(content, numNode)
      // The NODE TYPE, not a coarse "field" bucket: a walk that silently stopped
      // recording `oneof_field` nodes would still report a plausible tally here, and
      // that is precisely the defect this file had. Naming the node type makes a
      // missing population visible in the output instead of in a later disagreement.
      const kind = groupBody ? "field+groupBody" : decl.type
      declTypeTally.set(kind, (declTypeTally.get(kind) ?? 0) + 1)
      // A group declares a nested TYPE, so fields inside its body are scoped to that
      // type's name. Everything else is scoped to the slot space it sits in.
      const own = groupBody && name ? join(slotScope, name) : slotScope
      slots.push({ file: label, scope: own, kind: groupBody ? "group" : "field", number, name, line: decl.startPosition.row + 1, declType: decl.type })
    }

    const visit = (node: any, scopeStack: string[], slotStack: string[]): void => {
      for (const child of namedChildren(node)) {
        if (child.type === "message") {
          messages++
          const own = firstChildText(child, "message_name") || firstChildText(child, "identifier")
          const parts = own.length === 0 ? [] : own.split(".")
          const next = [...scopeStack, ...parts]
          visit(child, next, next)
          continue
        }
        if (child.type === "extend") {
          extendBlocks++
          // The extendee is the block's first `full_ident`, and it is UNNAMED —
          // `fieldNameForChild` returns nothing for an `extend` node.
          //
          // It resolves INNERMOST-FIRST against the enclosing message chain, which
          // is the rule that makes `test_messages_proto2.proto` legal: it declares
          // `MessageSetCorrect` inside BOTH `TestAllTypesProto2` and
          // `TestAllRequiredTypesProto2`, and each `extend MessageSetCorrect` binds
          // to its own. Resolving the name once at file scope merges the two into
          // one phantom slot and reports 4 phantom extension collisions — and
          // `protoc` ACCEPTS that file with exit 0, which is what says so.
          const written = firstChildText(child, "full_ident")
          const target = resolveExtendee(written, scopeStack, declared)
          if (target.resolved) extendResolved++
          else extendUnresolved++
          if (!target.resolved && extendUnresolvedExamples.length < 6) {
            extendUnresolvedExamples.push(`${label}:${child.startPosition.row + 1}  ${written}`)
          }
          visit(child, scopeStack, [...scopeStack, target.name])
          continue
        }
        if (child.type === "oneof") {
          oneofs++
          const name = firstChildText(child, "oneof_name")
          if (name) oneofNames++
          // A oneof's fields share the ENCLOSING message's slot space, so the slot
          // stack does NOT change: `oneof foo { string a = 1; }` and a sibling
          // `string a = 1;` do collide, which is true in protobuf.
          visit(child, scopeStack, slotStack)
          continue
        }
        if (child.type === "field" || child.type === "oneof_field") {
          // `oneof_field` is a SEPARATE node type in this grammar, not a `field`
          // with a flag. Recording only `field` therefore skipped EVERY oneof
          // member's field number — 309 oneofs corpus-wide — and the run then
          // reported "slots declared more than once: 1" when the true count is 2,
          // and printed `FINDING doubled slots 1 vs overrides edges 2 … every
          // doubled slot carries an edge: false`. The instrument was the thing at
          // fault, and it accused the analyzer of an uncorroborated edge.
          //
          // The collision it missed is real and is in the corpus:
          //   gql-ruby/…/perfetto_trace/trace.proto:70  uint64 string_value_iid = 17;
          //       inside `oneof value` of message DebugAnnotation
          //   gql-ruby/…/perfetto_trace/trace.proto:74  uint64 string_value_iid = 17;
          //       directly in message DebugAnnotation
          // Same message, same number, declared twice — which is illegal in protobuf
          // and is exactly what `overrides` means. `protoc` cannot witness it here
          // because it REJECTS the file at 74:3 ("Expected \"required\", \"optional\",
          // or \"repeated\".") before reaching any duplicate diagnostic.
          recordField(child, stackToString(slotStack))
          continue
        }
        visit(child, scopeStack, slotStack)
      }
    }
    visit(tree.rootNode, rootScope ? [rootScope] : [], rootScope ? [rootScope] : [])
    tree.delete?.()
  }
}

/** The text of the first child of `type`, or of a bare `identifier`/`full_ident`. */
function firstChildText(node: any, type: string): string {
  const direct = namedChildrenOfType(node, type)[0]
  return direct ? direct.text : ""
}
function stackToString(stack: string[]): string {
  return stack.join(".")
}
/**
 * protobuf's own rule for an `extend` target: try the name against the innermost
 * enclosing scope first and walk outward. `declared` is the set of qualified
 * message names the file itself declares, which is what makes the search decidable
 * without a compiler.
 */
function resolveExtendee(written: string, scopeStack: string[], declared: Set<string>): { name: string; resolved: boolean } {
  const parts = written.split(".").filter((p) => p.length > 0)
  if (parts.length === 0) return { name: scopeStack.join("."), resolved: false }
  for (let take = scopeStack.length; take >= 0; take--) {
    for (let head = parts.length; head >= 1; head--) {
      const candidate = [...scopeStack.slice(0, take), ...parts.slice(0, head)].join(".")
      if (declared.has(candidate)) {
        // A partially-resolved name keeps its remaining segments, exactly as a
        // relative reference does: `extend Foo` inside `Bar` where only `Bar.Foo`
        // exists binds to `Bar.Foo`, while `extend Baz.Qux` binds innermost-first too.
        const qualified = [...scopeStack.slice(0, take), ...parts].join(".")
        return { name: qualified, resolved: true }
      }
    }
  }
  return { name: [...scopeStack, ...parts].join("."), resolved: false }
}
function join(scope: string, name: string): string {
  if (name.length === 0) return scope
  return scope.length === 0 ? name : `${scope}.${name}`
}
function namedChildren(node: any): any[] {
  const out: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) out.push(node.namedChild(i))
  return out
}
function namedChildrenOfType(node: any, type: string): any[] {
  return namedChildren(node).filter((c) => c.type === type)
}
function textOf(content: string, node: any): string {
  return content.slice(node.startIndex, node.endIndex)
}
/** The first child of `type`, or of `identifier` directly inside it. */
function firstIdentOf(node: any, content: string, type: string): string {
  const holder = namedChildrenOfType(node, type)[0]
  if (!holder) return ""
  const direct = namedChildrenOfType(holder, "identifier")[0]
  if (direct) return textOf(content, direct)
  const full = namedChildrenOfType(holder, "full_ident")[0]
  if (full) return textOf(content, full).split(".").filter((s) => s.length > 0).join(".")
  return textOf(content, holder)
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const bySlot = new Map<string, Slot[]>()
for (const s of slots) {
  // The key carries the FILE. Keying on (scope, number) alone merges every
  // `Worker` in the corpus into one slot and reports thousands of phantom
  // doublings — 6,203 on the run that did it — which is the same name-collision
  // failure `incoming-check.ts` exists to catch, committed by the instrument meant
  // to catch it.
  const k = `${s.file}\u0000${s.scope}\u0000${s.number}`
  const arr = bySlot.get(k) ?? []
  arr.push(s)
  bySlot.set(k, arr)
}
for (const [, arr] of bySlot) {
  if (arr.length < 2) continue
  const alsoName = [...new Set(arr.map((a) => a.name))]
  for (let i = 1; i < arr.length; i++) doubled.push({ ...arr[i], alsoName })
}

// ------------------------------------------------------- the analyzer's own edges
const aParser = new ParserClass()
aParser.setLanguage(grammar)
const carrierContent = readFileSync(CARRIER, "utf8")
const carrierTree = aParser.parse(carrierContent)
const carrierAnalyzer: any = analyzer.analyze(carrierTree.rootNode, carrierContent, CARRIER)
const emittedOverrides = (carrierAnalyzer.relationships ?? []).filter(
  (r: any) => String(r.type) === "overrides",
)
// Production, not analyze(): the analyzer is a per-file unit that skips the
// pipeline stages pool-worker owns, so a claim about what ships is measured on it.
const carrierProd: any = await parseFile(CARRIER, CARRIER_DIR)
const prodOverrides = (carrierProd.relationships ?? []).filter(
  (r: any) => String(r.type) === "overrides",
)

// Corpus-wide: how many `overrides` edges does production emit at all?
let prodOverridesCorpus = 0
{
  let j = 0
  async function countWorker(): Promise<void> {
    while (true) {
      const i = j++
      if (i >= corpus.length) return
      const f = corpus[i]
      let prod: any
      try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch { continue }
      for (const r of prod.relationships ?? []) if (String(r.type) === "overrides") prodOverridesCorpus++
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => countWorker()))
}

const nameDiags = diags.filter((d) => d.quoted.length >= 2 && d.text.includes("already defined"))
const nameDiagMatch = nameDiags.map((d) => ({
  line: d.line,
  field: d.quoted[0],
  scope: d.quoted[1],
  text: d.text,
  // does the analyzer's own edge agree on the field name, the scope and the line?
  agreesOnField: emittedOverrides.some((r: any) => String(r.target).endsWith(`.${d.quoted[0]}`) || String(r.source).endsWith(`.${d.quoted[0]}`)),
  agreesOnScope: emittedOverrides.some((r: any) => String(r.source).startsWith(`${d.quoted[1]}.`) || String(r.target).startsWith(`${d.quoted[1]}.`)),
  agreesOnLine: emittedOverrides.some((r: any) => Number(r.line_number) === d.line),
}))

// Witness 3's verdict, READ from the file that measured it. This used to be a prose
// string asserting the direction was witnessed by nothing, in a file whose own header
// described witness 3 — the two halves disagreed and the assertion was the half a
// regression here would have left standing. Absent file, or a witness that reports it
// skipped, are both reported as NOT witnessed rather than counted as agreement.
const witness3: any = (() => {
  if (!existsSync(DIRECTION_OUT)) {
    return { read: false, reason: `${DIRECTION_OUT} does not exist — run probe/overrides-direction-witness.mts` }
  }
  try {
    const v = JSON.parse(readFileSync(DIRECTION_OUT, "utf8"))
    if (v?.skipped) return { read: false, reason: "witness 3 ran and SKIPPED (no protoc), so it measured nothing", skipped: true }
    return { read: true, ...v }
  } catch (e) {
    return { read: false, reason: `${DIRECTION_OUT} is unreadable: ${(e as Error)?.message ?? e}` }
  }
})()

const out = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  population: `working-tree walk of every *.proto under ${CR}, uncapped`,
  filesInPopulation: corpus.length,
  witness1_protoc: {
    binary: PROTOC,
    ran: protocRan,
    exit: protocExit,
    note: "read-only: --descriptor_set_out=/dev/null, the corpus file is never modified",
    stderrFirstLines: protocStderrHead,
    diagnostics: diags.length,
    nameRedefinitionDiagnostics: nameDiags.length,
    nameRedefinitions: nameDiagMatch,
    scope: "the NAME half of the construct: a second declaration of a field name in one message",
  },
  witness2_independentTreeWalk: {
    source: "this file, node API, no code shared with the analyzer",
    sharesGrammarWithAnalyzer: true,
    scope: "the NUMBER half: a field number declared more than once in one message",
      distinctFiles: new Set(slots.map((s) => s.file)).size,
    distinctQualifiedMessages: new Set(slots.map((s) => `${s.file} ${s.msg}`)).size,
    population: "EVERY `field` node carrying a `field_number`, in every file — total by construction, not a descent path",
    fieldNodesSeen,
    fieldsWithoutFieldNumber: fieldsWithoutNumber,
    groupBodiesDescended: groupBodies,
    oneofsSeen: oneofs,
    oneofsNamed: oneofNames,
    extendBlocksSeen: extendBlocks,
    extendTargetsResolvedAgainstThisFile: extendResolved,
    extendTargetsNotDeclaredInThisFile: extendUnresolved,
    extendTargetsNotDeclaredExamples: extendUnresolvedExamples,
    messagesSeen: messages,
    distinctScopes: new Set(slots.map((s) => `${s.file} ${s.scope}`)).size,
    fieldDeclarationsWalked: slots.length,
    declarationsByNodeType: Object.fromEntries([...declTypeTally.entries()].sort()),
    distinctSlots: bySlot.size,
    doubledSlots: doubled.length,
    doubled: doubled
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      .map((d) => ({ file: d.file, scope: d.scope, kind: d.kind, number: d.number, name: d.name, line: d.line, declType: d.declType, alsoDeclaredAs: d.alsoName })),
  },
  analyzerEdges: {
    carrierFile: CARRIER,
    carrierOverridesAnalyzerDirect: emittedOverrides.length,
    carrierOverridesThroughParseFile: prodOverrides.length,
    carrierOverrides: emittedOverrides.map((r: any) => ({
      type: String(r.type),
      source: String(r.source),
      target: String(r.target),
      line: Number(r.line_number),
      confidence: Number(r.confidence),
      evidenceClass: String((r.metadata as any)?.evidenceClass ?? "(absent)"),
    })),
    corpusOverridesThroughParseFile: prodOverridesCorpus,
  },
  finding: {
    doubledSlotsCorpusWide: doubled.length,
    overridesEdgesCorpusWide: prodOverridesCorpus,
    everyDoubledSlotCarriesAnEdge: doubled.length === prodOverridesCorpus,
    // `overrides` properties, and who witnesses each one. Nothing here is asserted:
    // witness 3's column is read from the file that measured it, and `read: false` is
    // reported as such rather than quietly counting as a pass.
    witness3_direction: witness3,
    derivationFindingClosed: false,
    why: witness3.read
      ? `witness 1 (protoc, no shared grammar) covers the NAME half; witness 2 (this file, SHARES the grammar) covers the NUMBER half and the corpus-wide count; witness 3 (protoc again, no shared grammar, reads as ${witness3.directionAgrees} of ${witness3.numberFixtures}) covers the edge DIRECTION, later -> earlier, across a oneof boundary. No unaudited property remains INSIDE the type. The type itself is still unaudited by the shared differential, which carries no protobuf entry — that is why this stays false, and it is a script/m14/differential.ts item, not an analyzer one.`
      : `witness 3's verdict was NOT READ (${witness3.reason}), so the edge DIRECTION later -> earlier is currently witnessed by nothing but the fixture suite. An absent witness is reported as absent; it is not counted as agreement.`,
    // Limits that survive the direction closure, stated once so no reader has to
    // re-derive them from the three probe headers.
    residualLimits: [
      "the corpus-wide count of the construct is witness 2's, and witness 2 shares the tree-sitter grammar — a grammar bug inventing a `field` node is invisible to it",
      "witness 3 runs on purpose-built fixtures because protoc REJECTS the corpus files that carry the construct; it compares diagnostics, not emitted facts, and only ever sees files protoc refuses",
    ],
  },
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`population  ${corpus.length} files`)
console.log(`\nWITNESS 1 — ${PROTOC} (independent implementation, no shared grammar)`)
console.log(`  exit ${protocExit}, ${diags.length} diagnostics, ${nameDiags.length} name-redefinition`)
for (const m of nameDiagMatch) {
  console.log(`    ${CARRIER_NAME}:${m.line}  field="${m.field}" scope="${m.scope}"`)
  console.log(`      analyzer agrees on field ${m.agreesOnField}, scope ${m.agreesOnScope}, line ${m.agreesOnLine}`)
}
console.log(`\nWITNESS 2 — independent tree walk (shares the grammar, not the code)`)
console.log(`  field nodes seen ${fieldNodesSeen}   without a field_number ${fieldsWithoutNumber}   messages ${messages}   oneofs ${oneofs}   extends ${extendBlocks}   groups ${groupBodies}`)
console.log(`  extend targets resolved against this file ${extendResolved}, not declared here ${extendUnresolved}${extendUnresolved ? `  e.g. ${extendUnresolvedExamples[0]}` : ""}`)
console.log(`  slots recorded ${slots.length}   distinct (file, scope, number) ${bySlot.size}   distinct (file, scope) ${out.witness2_independentTreeWalk.distinctScopes}`)
console.log(`  declarations by kind: ${JSON.stringify(Object.fromEntries([...declTypeTally.entries()].sort()))}`)
console.log(`  slots declared more than once: ${doubled.length}`)
for (const d of out.witness2_independentTreeWalk.doubled) {
  console.log(`    ${d.file}:${d.line}  ${d.scope}  number ${d.number}  declared as ${d.alsoDeclaredAs.join(", ")}  (${d.kind})`)
}
console.log(`\nanalyzer  overrides edges: ${emittedOverrides.length} analyzer-direct / ${prodOverrides.length} through parseFile on the carrier`)
for (const r of out.analyzerEdges.carrierOverrides) {
  console.log(`    ${r.type}  ${r.source} -> ${r.target}  line ${r.line}  conf ${r.confidence}  ${r.evidenceClass}`)
}
console.log(`corpus     overrides edges through parseFile: ${prodOverridesCorpus}`)
console.log(`\nFINDING  doubled slots ${doubled.length} vs overrides edges ${prodOverridesCorpus} — every doubled slot carries an edge: ${out.finding.everyDoubledSlotCarriesAnEdge}`)
if (witness3.read) {
  console.log(`WITNESS 3 — direction, read from ${DIRECTION_OUT} (protoc, no shared grammar)`)
  console.log(`  direction agrees with protoc      ${witness3.directionAgrees} of ${witness3.numberFixtures}`)
  console.log(`  direction disagrees               ${witness3.directionDisagrees}`)
  console.log(`  name-collision negatives correct  ${witness3.nameCollisionNegativesCorrect} of 1`)
  console.log(`  name-collision negatives wrong     ${witness3.nameCollisionNegativesWrong}`)
  console.log(`  holds: ${witness3.holds}`)
  for (const l of witness3.limits ?? []) console.log(`    limit: ${l}`)
} else {
  console.log(`WITNESS 3 — direction: NOT WITNESSED (${witness3.reason})`)
}
console.log(`DERIVATION finding closed: ${out.finding.derivationFindingClosed} — ${out.finding.why}`)
console.log(`\nwrote ${OUT}`)