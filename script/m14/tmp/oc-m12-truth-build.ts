// script/m14/tmp/oc-m12-truth-build.ts — rebuild validation/m12/ground-truth/objective-c.json
// from the adjudicated observed set (script/m14/tmp/oc-m12-observed.ts --json).
//
// Discipline (the same one the swift #933 amendment used): a row keeps its evidence
// when its identity is unchanged; a row whose identity changed gets an explicit
// amendment note; a row that did not exist is authored HERE, by hand, quoting its
// fixture line; and the build FAILS if any old fact would vanish or any new row
// arrives without authored evidence. Nothing is minted from the analyzer's output.
//
// Run: bun script/m14/tmp/oc-m12-truth-build.ts [observed.json] [--write]
import { readFileSync, writeFileSync } from "node:fs"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const OBS = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "/tmp/oc-m12-observed.json"
const TRUTH = `${ROOT}/validation/m12/ground-truth/objective-c.json`
const WRITE = process.argv.includes("--write")

type Obs = {
  key: string; id: string; layer: string; kind: string; file: string; line: number | null
  name: string | null; symbolKind: string | null; sourceId: string | null; targetId: string | null
  type: string | null; state: string; lineText: string
}

const PROSE = `Independent hand audit of validation/m12/fixtures/objective-c/*.{h,m} against Objective-C semantics and the M11 Objective-C contract (validated 1.000/1.000 in M11.10; symbols only). Symbols: @protocol -> interface with methods -> method; @interface class -> class with properties -> property and methods -> method (+ class methods via the + token, both method kind); @interface Class (Category) -> extension (category, symbol name = class name, never the category label); @implementation -> class with ivars -> property; methods -> method; C functions -> function; file-scope static vars -> variable. Noise: function-local variables (no symbol), blocks (no symbol), typedefs/enums/constants in .h config headers (parsed by the shared C-family path, same as the C++ shape_config.h precedent). METHOD IDENTITY IS THE FULL SELECTOR (OBJCD7): \`- (BOOL)saveUser:(NSString *)userId\` is \`saveUser:\`, not \`saveUser\`, and \`[NSError errorWithDomain:… code:… userInfo:…]\` calls \`errorWithDomain:code:userInfo:\` — the selector IS a method's identity in ObjC, and leaf naming collapsed distinct overloads (measured on the pinned corpora: the three \`initWithNamespace*\` selectors and the \`setValue*\`/\`storeImage*\` family, 225 colliding occurrences across 35 owners; the lane's selector-identity fixture pins the distinctness). Relationships (family contract, matches Java M12.01 and C M12.16): contains = REAL container ownership only (class/protocol/extension -> member, interface -> method) — never \`global contains X\`; extends = class -> superclass, protocol -> adopted protocol; implements = class -> adopted protocol; calls = message expressions (source = enclosing method, target = the FULL SELECTOR — never the receiver, and never a first-keyword form that cannot name an overload) and C function calls; instantiates = \`[[Foo alloc] init]\` / \`[Foo new]\` (target = the class receiver); references = import/include dependencies (\`root -> module\` on the objc-native path) plus, on the shared C-family path, that path's file-scope type_reference rows for typedef aliases (source \`global\` — the C-family file-scope convention, c.json/cpp.json pin 7 such rows each, e.g. \`typedef struct Point Point;\` -> \`references:global:Point\`); uses = value reads (parameters in argument position, body locals, same-file ivars/properties, file globals, bare receivers) with source = the enclosing METHOD — a call callee is never also a \`uses\` row. Relationship sources are the enclosing METHOD name; top-level file-scope relationships use root on the objc-native path and global on the shared C-family path. The config header user_config.h has no class-declaration markers so the shared C-family path parses it (constants -> constant, enum -> enum with members, typedef -> type, static var -> variable, function prototype -> function, contains for enum members) — identical to the C++ shape_config.h precedent; the differential encodes exactly what the pipeline emits, INCLUDING the value-less \`#define\` (the C lane's #901 ruling: a \`#define\` DECLARES a name whatever its body — include guards cost one symbol per guarded file and produce no edge, measured on sqlite, where skipping them lost real reads). The modern \`typedef NS_ENUM(...)\` macro form is a genuine grammar gap (ERROR node) documented in docs/analyzers/objective-c.md.

AMENDED 2026-09-25 (M60 objc lane — the same stale-audit class as #933, the swift half). This audit had stopped describing the analyzer in four ways, and every row below was resolved by reading it back against the fixture SOURCE TEXT (each added fact's reference quotes its line), never by moving the number. (a) It carried LEAF method names (\`saveUser\`, \`errorWithDomain\`) where the analyzer publishes FULL selectors (OBJCD7): 29 facts were corrected in place, and each corrected reference now names the selector it asserts. (b) It predated the \`uses\` relationship entirely — the family contract it claims to follow (php/python/dart/c) publishes value reads, and 12 of them (parameter, local, ivar and receiver reads) were missing. (c) Four correct analyzer rows were missing as facts: protocol adoption (\`@protocol UserStore <NSObject>\` -> extends, which the audit's own prose already asserted), the two shared-C-path type_reference rows for \`UserRole\`/\`UserId\`, and the value-less \`#define USER_CONFIG_H\` constant. (d) One analyzer row was NOT added because it is a defect rather than a fact: \`uses register_block -> handler\` fired from the block-parameter DECLARATION alone (\`void (^handler)(NSString *)\`, with no read anywhere in the file), contradicting OC-E's own ruling that declaration names are never reads and C family parity (given the identical function-pointer parameter, the C analyzer emits nothing). Fixed in src/ast/real-objective-c-analyzer.ts (\`isParameterDeclaredName\`), pinned by the lane's fixture/mutant suite. The amendment also uncovered a PRODUCTION defect that was eating this lane's output before any consumer saw it: src/ast/pool-worker.ts \`filterNoiseRelationships\` computed a target's "leaf" as the LAST ':'-separated segment, so every selector — which ENDS in ':' because that colon IS its arity — read as an empty leaf and was dropped as noise. 17 of this differential's 30 false negatives were rows the analyzer had emitted and that filter had eaten (every parameterized \`contains\` and every \`calls\` to a keyword selector); the fix keeps them, and this differential is its regression pin.`

const RENAME_NOTE = " AMENDED 2026-09-25 (M60 objc lane, OBJCD7): this fact's identity was corrected from the leaf name to the method's FULL selector; the analyzer publishes the selector (the lane's selector-identity fixture pins three distinct `initWithNamespace*` overloads, which leaf naming collapsed), and the reference has been re-read against the fixture line quoted here."

const REPLACED: Record<string, string> = {
  "rel:Negative.m:calls:userErrorWithCode:errorWithDomain":
    "rel:Negative.m:calls:userErrorWithCode::errorWithDomain:code:userInfo:",
}

const NEW_EVIDENCE: Record<string, string> = {
  "rel:Negative.m:calls:userErrorWithCode::errorWithDomain:code:userInfo:":
    "Negative.m:19 `NSError *error = [NSError errorWithDomain:@\"User\" code:code userInfo:nil];` -> calls userErrorWithCode: -> errorWithDomain:code:userInfo: (message send; the callable identity is the FULL selector — three keyword parts, so the first-keyword form this audit used to carry could not name the overload it means. The receiver `NSError` is not the target. This row could not even reach the differential before the pool-worker leaf fix: its target ends in ':' and was being dropped as noise.)",
  "rel:Negative.m:uses:userErrorWithCode::code":
    "Negative.m:19 `… code:code userInfo:nil]` -> uses userErrorWithCode: -> code (second keyword's ARGUMENT reads the method parameter `code`; source = the enclosing METHOD per the family `uses` contract, target = the value read. The keyword `code:` before it is a NAME, never a read.)",
  "rel:Negative.m:uses:userErrorWithCode::error":
    "Negative.m:20 `return error;` -> uses userErrorWithCode: -> error (bare read of the method-local `error`, declared on line 20; locals bind in the OC-E value frame and are read targets, never symbols.)",
  "rel:Negative.m:uses:localDescription:prefix":
    "Negative.m:25 `return [prefix stringByAppendingString:@\"local\"];` -> uses localDescription -> prefix (bare RECEIVER read of the method-local `prefix`, declared line 24 — the message's selector is the call target, the receiver is a value read.)",
  "rel:UserService.h:extends:UserStore:NSObject":
    "UserService.h:7 `@protocol UserStore <NSObject>` -> extends UserStore -> NSObject (protocol adoption is protocol inheritance in this family: the audit's own prose already said \"extends = class -> superclass, protocol -> adopted protocol\" and the analyzer implements it — the FACT was simply missing from the audit's list.)",
  "rel:UserService.m:uses:initWithName::name":
    "UserService.m:15 `_serviceName = name;` -> uses initWithName: -> name (parameter read on the assignment's RIGHT-hand side; the LHS `_serviceName` is a write and is never a read — SCD1.)",
  "rel:UserService.m:uses:saveUser::userId":
    "UserService.m:22 `_activeUserId = userId;` -> uses saveUser: -> userId (parameter read; LHS `_activeUserId` is the write.)",
  "rel:UserService.m:uses:saveUser::_savedUsers":
    "UserService.m:23 `[_savedUsers addObject:userId];` -> uses saveUser: -> _savedUsers (bare receiver read of the same-file ivar; the selector `addObject:` is the call target, owned by the calls edge.)",
  "rel:UserService.m:uses:findUser::_savedUsers":
    "UserService.m:28 `if ([_savedUsers containsObject:userId]) {` -> uses findUser: -> _savedUsers (bare receiver read of the ivar inside the condition.)",
  "rel:UserService.m:uses:findUser::userId":
    "UserService.m:28 `if ([_savedUsers containsObject:userId]) {` -> uses findUser: -> userId (the message's ARGUMENT reads the method parameter.)",
  "rel:UserService.m:uses:registerUser::userId":
    "UserService.m:35 `return [self saveUser:userId];` -> uses registerUser: -> userId (argument read of the parameter; `self` is an implicit receiver and never a read.)",
  "rel:UserService.m:uses:sharedService:onceToken":
    "UserService.m:41 `dispatch_once(&onceToken, ^{` -> uses sharedService -> onceToken (address-of read of the local declared line 40; the CALLEE `dispatch_once` is a call target, never also a read — family parity, and the probe script/m14/tmp/oc-callee-uses.ts shows the C analyzer emitting only the call for the same shape.)",
  "rel:UserService.m:uses:sharedService:shared":
    "UserService.m:44 `return shared;` -> uses sharedService -> shared (bare read of the local declared line 40.)",
  "rel:UserService.m:uses:isValidUserId::userId":
    "UserService.m:52 `return [userId length] > 0;` -> uses isValidUserId: -> userId (bare RECEIVER read of the parameter; `length` is the zero-argument selector and is the calls target, never a read.)",
  "sym:user_config.h:11:constant:USER_CONFIG_H":
    "user_config.h:11 `#define USER_CONFIG_H` (value-less, the include guard) -> constant. The shared C-family path mints the name by ruling (#901, measured on sqlite): a `#define` DECLARES a name whatever its body, and the old body-based skip lost real reads (`SQLITE_TCLAPI` decorating a function heading). Cost: one symbol per guarded file, no edge.",
  "rel:user_config.h:references:global:UserRole":
    "user_config.h:22 `} UserRole;` -> references global -> UserRole (the shared C-family path's file-scope type_reference row for a typedef alias; the same path emits it for EVERY typedef — measured `typedef int Foo;` -> `references:global:Foo` — and c.json pins the precedent `typedef struct Point Point;` -> `references:global:Point`. Source id `global` is that path's file-scope convention, not this lane's `root`.)",
  "rel:user_config.h:references:global:UserId":
    "user_config.h:24 `typedef NSString *UserId;` -> references global -> UserId (same class as the row above: the shared C-family path's type_reference row for the typedef name, c/cpp precedent `references:global:*`.)",
}

function stripColon(s: string | null): string {
  return (s ?? "").replace(/:$/, "")
}

function normKey(o: Obs): string {
  if (o.kind === "symbol") return `sym|${o.file}|${o.line}|${o.symbolKind}`
  return `rel|${o.file}|${o.type}|${stripColon(o.sourceId)}|${stripColon(o.targetId)}`
}

function truthNormKey(f: any): string {
  if (f.kind === "symbol") return `sym|${f.file}|${f.line}|${f.attributes.symbolKind}`
  return `rel|${f.file}|${f.attributes.type}|${stripColon(f.sourceId)}|${stripColon(f.targetId)}`
}

function main() {
  const obs = JSON.parse(readFileSync(OBS, "utf8")) as Obs[]
  const truth = JSON.parse(readFileSync(TRUTH, "utf8")) as any
  const oldByKey = new Map<string, any>()
  for (const f of truth.facts) oldByKey.set(truthNormKey(f), f)

  const consumed = new Set<string>()
  const facts: any[] = []
  let kept = 0, renamed = 0, added = 0
  const replacedNewIds = new Set(Object.values(REPLACED))

  for (const o of obs) {
    const id = o.kind === "symbol"
      ? `sym:${o.file}:${o.line}:${o.symbolKind}:${o.name}`
      : `rel:${o.file}:${o.type}:${o.sourceId}:${o.targetId}`
    const base = {
      id, layer: o.layer, kind: o.kind, file: o.file,
      ...(o.kind === "symbol"
        ? { line: o.line, attributes: { name: o.name, symbolKind: o.symbolKind } }
        : { sourceId: o.sourceId, targetId: o.targetId, attributes: { type: o.type } }),
    }
    const old = oldByKey.get(normKey(o))
    if (old) {
      consumed.add(truthNormKey(old))
      const oldId = old.id
      if (replacedNewIds.has(id)) {
        // The multi-part-selector replacement: keep the audit's intent, corrected.
        facts.push({ ...base, evidence: { authority: "manual_audit", reference: NEW_EVIDENCE[id] } })
        added++
        continue
      }
      const same = oldId === id
      const ref = String(old.evidence?.reference ?? "")
      facts.push({
        ...base,
        evidence: { authority: old.evidence?.authority ?? "manual_audit", reference: same ? ref : ref + RENAME_NOTE },
      })
      if (same) kept++
      else renamed++
      continue
    }
    const authored = NEW_EVIDENCE[id]
    if (!authored) throw new Error(`no authored evidence for ${id}`)
    facts.push({ ...base, evidence: { authority: "manual_audit", reference: authored } })
    added++
  }

  const leftovers = truth.facts.filter((f: any) => !consumed.has(truthNormKey(f)))
  const allowed = Object.keys(REPLACED)
  const unexpected = leftovers.filter((f: any) => !allowed.includes(f.id))
  if (unexpected.length) throw new Error(`old facts would vanish: ${unexpected.map((f: any) => f.id).join(", ")}`)

  for (const id of Object.keys(NEW_EVIDENCE)) if (!facts.some((f) => f.id === id)) throw new Error(`authored evidence unused: ${id}`)

  const doc = { schemaVersion: truth.schemaVersion, truthSource: truth.truthSource, source: PROSE, facts }
  console.log(`facts=${facts.length} (kept=${kept} renamed=${renamed} added=${added}) replaced=${allowed.join(",")}`)
  if (WRITE) {
    writeFileSync(TRUTH, JSON.stringify(doc, null, 2) + "\n")
    console.log(`wrote ${TRUTH}`)
  } else {
    console.log("(dry run — pass --write)")
  }
}
main()
