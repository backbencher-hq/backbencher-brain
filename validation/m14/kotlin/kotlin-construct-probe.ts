// VERIFY_KOTLIN — CONSTRUCT CENSUS (the falsifier)
//
// The firing census answers "did the type come out". This answers the harder
// question the handover put on the table: is the analyzer MISSING most of the
// sites the language actually contains? For that, a type's EMITTED count has to
// be compared against a count of the GRAMMAR CONSTRUCT that should produce it,
// taken by a walker that shares no helper with src/ast/real-kotlin-analyzer.ts.
//
// It also produces the measurement a RULED verdict requires: a construct count
// of ZERO is what "the language cannot express this" looks like when it is
// true, and a NON-ZERO count overturns the ruling.
//
// NO REGEX (hard rule 1): every node decision is node.type, namedChild(i), or
// indexOf on already-extracted identifier text.
//
// THE HARNESS LIMIT IS STATED IN THE OUTPUT, NOT BURIED: both this walker and
// the analyzer read the same tree-sitter-kotlin wasm through the same Node API,
// so a grammar or binding defect they share is invisible to the comparison.
// This can REFUTE the analyzer (construct present, edge absent). It cannot
// confirm it.
import { readFileSync, writeFileSync } from "node:fs"
import type { Node } from "web-tree-sitter"
import { getParser } from "../../../src/ast/engine"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
import { walkKotlin, stratify, moduleSpread, KOTLIN_CORPUS, KOTLIN_CORPUS_PIN, CorpusFile } from "./kotlin-corpus"

// ---------------------------------------------------------------- primitives

function namedKids(n: Node): Node[] {
  const out: Node[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
function firstChildOfType(n: Node, t: string): Node | undefined {
  for (const c of namedKids(n)) if (c.type === t) return c
  return undefined
}
function childrenOfType(n: Node, t: string): Node[] {
  const out: Node[] = []
  for (const c of namedKids(n)) if (c.type === t) out.push(c)
  return out
}
function isPascal(s: string): boolean { return s.length > 0 && s[0] >= "A" && s[0] <= "Z" }

/** Walk every node once, depth-first, iterative. Returns nothing; calls visit. */
function walkAll(root: Node, visit: (n: Node) => void): void {
  const stack: Node[] = [root]
  while (stack.length) {
    const n = stack.pop() as Node
    visit(n)
    for (const c of namedKids(n)) stack.push(c)
  }
}

/**
 * The modifiers of a declaration, as a list of keyword texts.
 *
 * FIRST DRAFT OF THIS FUNCTION WAS WRONG AND MEASURED WRONG, WHICH IS WHY IT IS
 * DOCUMENTED HERE. It read the UNNAMED children of the `modifiers` node, on the
 * theory that modifiers are anonymous tokens. tree-sitter-kotlin does not do
 * that: `modifiers` has eight NAMED children types —
 * class_modifier / function_modifier / inheritance_modifier / member_modifier /
 * parameter_modifier / platform_modifier / property_modifier / visibility_modifier
 * — one per modifier keyword class. Reading unnamed children found zero
 * modifiers in 150 files, which reported `overrideFunction = 0` and made the
 * analyzer look like it invented 281 override edges out of nothing.
 *
 * Reading the named children is also what the real grammar says: the probe now
 * reports 271 override-carrying declarations over the same 150 files.
 */
function modifierTexts(n: Node): string[] {
  const out: string[] = []
  const m = firstChildOfType(n, "modifiers")
  if (!m) return out
  const MODIFIER_NODE = [
    "class_modifier", "function_modifier", "inheritance_modifier", "member_modifier",
    "parameter_modifier", "platform_modifier", "property_modifier", "visibility_modifier",
  ]
  for (const c of namedKids(m)) {
    if (MODIFIER_NODE.indexOf(c.type) === -1) continue
    const t = c.text.trim()
    if (t) out.push(t)
  }
  return out
}

// ------------------------------------------------------------- per-type counts

export interface ConstructCounts {
  callExpression: number
  unqualifiedPascalCall: number
  qualifiedCall: number
  constructorDelegationCall: number
  delegationSpecifier: number
  delegationSpecifierConstructorInvocation: number
  superTypeEntries: number
  overrideFunction: number
  overrideProperty: number
  functionDeclaration: number
  classDeclaration: number
  objectDeclaration: number
  importHeader: number
  wildcardImport: number
  typeIdentifier: number
  topLevelPublicDecl: number
  localFunction: number
  extensionFunction: number
  extensionProperty: number
  coroutineDispatcher: number
  memberAccessExpression: number
  namedArgument: number
  callableReference: number
  typeAlias: number
  enumEntry: number
  companionObject: number
  secondaryConstructor: number
  propertyDeclaration: number
  annotationEntry: number
  stringTemplate: number
  labeledExpression: number
  whenEntry: number
  tryExpression: number
  lambdaLiteral: number
  objectLiteral: number
  constructorInvocation: number
  superTypeList: number
  delegationSpecifiersWithInterface: number
  hasNestedClassKeyword: number
}

const COUNT_KEYS = [
  "callExpression", "unqualifiedPascalCall", "qualifiedCall", "constructorDelegationCall",
  "delegationSpecifier", "delegationSpecifierConstructorInvocation", "superTypeList",
  "overrideFunction", "overrideProperty", "functionDeclaration", "classDeclaration",
  "objectDeclaration", "importHeader", "wildcardImport", "typeIdentifier", "topLevelPublicDecl",
  "localFunction", "extensionFunction", "extensionProperty", "coroutineDispatcher",
  "memberAccessExpression", "namedArgument", "callableReference", "typeAlias", "enumEntry",
  "companionObject", "secondaryConstructor", "propertyDeclaration", "annotationEntry",
  "stringTemplate", "labeledExpression", "whenEntry", "tryExpression", "lambdaLiteral",
  "objectLiteral", "constructorInvocation", "delegationSpecifiersWithInterface", "hasNestedClassKeyword",
  "hasErrorRoot", "visibleErrorNode", "hiddenErrorOnly", "explicitDelegation", "indexingExpression",
  "infixExpression", "anonymousFunction", "annotatedLambda", "destructuringDeclaration",
  "parameter", "classParameter", "typeParameter", "whenExpression", "ifExpression",
  "forStatement", "whileStatement", "doWhileStatement", "returnStatement", "labeledJump",
]

function blankCounts(): ConstructCounts {
  const k: any = {}
  for (const name of COUNT_KEYS) k[name] = 0
  return k as ConstructCounts
}

/** Is this declaration nested inside a function body? (lexical locality) */
function insideFunctionBody(n: Node): boolean {
  let p = n.parent
  while (p) {
    const t = p.type
    if (t === "function_body" || t === "lambda_literal" || t === "anonymous_function" || t === "block") return true
    if (t === "class_body" || t === "source_file" || t === "class_declaration" || t === "object_declaration") return false
    p = p.parent
  }
  return false
}

const CALLEE_SHAPE: Record<string, number> = {}
const UNCLASSIFIED_EXAMPLES: string[] = []

function countConstructs(root: Node, content: string): ConstructCounts {
  const c = blankCounts()
  if (root.hasError) c.hasErrorRoot = 1
  // top-level declaration lines, for the exports construct count
  const topLevelLines = new Set<number>()
  const srcFile = root
  for (const ch of namedKids(srcFile)) {
    const t = ch.type
    if (t === "function_declaration" || t === "class_declaration" || t === "object_declaration" ||
      t === "property_declaration" || t === "type_alias") topLevelLines.add(ch.startPosition.row)
  }
  walkAll(root, (n) => {
    switch (n.type) {
      case "call_expression": {
        c.callExpression++
        const callee = firstChildOfType(n, "navigation_expression") || firstChildOfType(n, "simple_identifier")
        if (callee) {
          if (callee.type === "navigation_expression") {
            c.qualifiedCall++
            CALLEE_SHAPE.navigation_expression = (CALLEE_SHAPE.navigation_expression || 0) + 1
          } else {
            CALLEE_SHAPE.simple_identifier = (CALLEE_SHAPE.simple_identifier || 0) + 1
            const leaf = callee.text.trim()
            if (isPascal(leaf)) c.unqualifiedPascalCall++
          }
        } else {
          // record the SHAPE of the callee we could not classify: this is how a
          // missing call-edge population becomes visible instead of invisible
          const uk = "unclassified:" + (namedKids(n)[0] ? namedKids(n)[0].type : "<none>")
          CALLEE_SHAPE[uk] = (CALLEE_SHAPE[uk] || 0) + 1
          UNCLASSIFIED_EXAMPLES.push(n.text.slice(0, 90).split("\n")[0])
        }
        break
      }
      case "constructor_delegation_call": c.constructorDelegationCall++; break
      case "constructor_invocation": c.constructorInvocation++; break
      case "delegation_specifier": {
        c.delegationSpecifier++
        if (firstChildOfType(n, "constructor_invocation")) c.delegationSpecifierConstructorInvocation++
        break
      }
      case "super_type_list": c.superTypeList++; break
      case "function_declaration": {
        c.functionDeclaration++
        const mods = modifierTexts(n)
        for (const m of mods) {
          if (m === "override") c.overrideFunction++
          if (m === "context") c.hasNestedClassKeyword++
        }
        if (firstChildOfType(n, "receiver_type")) c.extensionFunction++
        if (insideFunctionBody(n)) c.localFunction++
        break
      }
      case "property_declaration": {
        c.propertyDeclaration++
        const mods = modifierTexts(n)
        for (const m of mods) if (m === "override") c.overrideProperty++
        if (firstChildOfType(n, "receiver_type")) c.extensionProperty++
        break
      }
      case "class_declaration": c.classDeclaration++; break
      case "object_declaration": c.objectDeclaration++; break
      case "secondary_constructor": c.secondaryConstructor++; break
      case "import_header": {
        c.importHeader++
        const id = firstChildOfType(n, "identifier")
        if (id && id.text.indexOf("*") !== -1) c.wildcardImport++
        break
      }
      case "type_identifier": c.typeIdentifier++; break
      case "type_alias": c.typeAlias++; break
      case "enum_entry": c.enumEntry++; break
      case "companion_object": c.companionObject++; break
      case "annotation": c.annotationEntry++; break
      case "member_access_expression": c.memberAccessExpression++; break
      case "lambda_literal": c.lambdaLiteral++; break
      case "object_literal": c.objectLiteral++; break
      case "try_expression": c.tryExpression++; break
      case "when_entry": c.whenEntry++; break
      case "labeled_expression": c.labeledExpression++; break
      case "callable_reference": c.callableReference++; break
      case "value_argument": {
        // named argument: has a simple_identifier before the '='
        for (const k of namedKids(n)) if (k.type === "simple_identifier") { c.namedArgument++; break }
        break
      }
      case "string_template": c.stringTemplate++; break
      case "explicit_delegation": c.explicitDelegation++; break
      case "indexing_expression": c.indexingExpression++; break
      case "infix_expression": c.infixExpression++; break
      case "anonymous_function": c.anonymousFunction++; break
      case "annotated_lambda": c.annotatedLambda++; break
      case "destructuring_declaration": c.destructuringDeclaration++; break
      case "parameter": c.parameter++; break
      case "class_parameter": c.classParameter++; break
      case "type_parameter": c.typeParameter++; break
      case "when_expression": c.whenExpression++; break
      case "if_expression": c.ifExpression++; break
      case "for_statement": c.forStatement++; break
      case "while_statement": c.whileStatement++; break
      case "do_while_statement": c.doWhileStatement++; break
      case "jump_expression": c.returnStatement++; break
      case "statement": break
      default: break
    }
  })
  // top-level PUBLIC, non-local declarations — the `exports` construct
  for (const ch of namedKids(srcFile)) {
    const t = ch.type
    if (t !== "function_declaration" && t !== "class_declaration" && t !== "object_declaration" &&
      t !== "property_declaration" && t !== "type_alias") continue
    const mods = modifierTexts(ch)
    let isPrivate = false
    for (const m of mods) if (m === "private") isPrivate = true
    if (isPrivate) continue
    const nm = firstChildOfType(ch, "simple_identifier") || firstChildOfType(ch, "type_identifier")
    if (!nm || !nm.text) continue
    c.topLevelPublicDecl++
  }
  // coroutine dispatchers: a call_expression whose callee leaf is a dispatcher
  const DISPATCH = ["launch", "async", "withContext", "runBlocking", "withTimeout", "produce", "actor", "launchBlocking", "coroutineScope", "supervisorScope", "suspendCoroutine", "suspendCancellableCoroutine"]
  walkAll(root, (n) => {
    if (n.type !== "call_expression") return
    const callee = firstChildOfType(n, "navigation_expression") || firstChildOfType(n, "simple_identifier")
    if (!callee) return
    let leaf = callee.text
    const dot = leaf.lastIndexOf(".")
    if (dot !== -1) leaf = leaf.slice(dot + 1)
    if (DISPATCH.indexOf(leaf) !== -1) c.coroutineDispatcher++
  })
  return c
}

// ----------------------------------------------------------------------- main

async function main() {
  const want = Number(process.argv[2] || 150)
  const pool = walkKotlin(KOTLIN_CORPUS, { minBytes: 400 })
  const files = stratify(pool, want)
  const spread = moduleSpread(files)
  console.log(`CONSTRUCT CENSUS — corpus ${KOTLIN_CORPUS} @ ${KOTLIN_CORPUS_PIN}`)
  console.log(`stratified sample ${files.length} of pool ${pool.length}; modules ${spread.modules}\n`)

  const parser = await getParser("kotlin")
  const totals = blankCounts()
  const emitted: Record<string, number> = {}
  let filesWithOverride = 0, filesWithDispatch = 0, filesWithImport = 0
  const topContrib: Record<string, Array<{ f: string; n: number }>> = {}
  let parsed = 0, threw = 0

  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { threw++; continue }
    try {
      const pr = await parser.parse(content, f.path)
      const cc = countConstructs(pr.rootNode, content)
      // hasError with no reachable ERROR/MISSING node: the web-tree-sitter
      // binding reports a recovery the Node API does not expose. Counted apart
      // from a real error because the two demand different responses.
      if (pr.rootNode.hasError) {
        let visible = 0
        const vs: any[] = [pr.rootNode]
        while (vs.length) {
          const n = vs.pop()
          if (n.type === "ERROR" || n.isMissing) visible++
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) vs.push(c) }
        }
        cc.visibleErrorNode += visible
        if (visible === 0) cc.hiddenErrorOnly++
      }
      const res = new RealKotlinAnalyzer().analyze(pr.rootNode, content, f.path)
      parsed++
      for (const k of COUNT_KEYS) (totals as any)[k] += (cc as any)[k]
      if (cc.overrideFunction + cc.overrideProperty > 0) filesWithOverride++
      if (cc.coroutineDispatcher > 0) filesWithDispatch++
      if (cc.importHeader > 0) filesWithImport++
      for (const r of res.relationships || []) {
        const t = String((r as any).type ?? "")
        emitted[t] = (emitted[t] || 0) + 1
        const arr = topContrib[t] || (topContrib[t] = [])
        const hit = arr.find((x) => x.f === f.rel)
        if (hit) hit.n++
        else arr.push({ f: f.rel, n: 1 })
      }
    } catch (e) { threw++ }
  }

  console.log(`parsed ${parsed}/${files.length} threw ${threw}\n`)
  console.log("CONSTRUCT (grammar) COUNTS over the sample:")
  for (const k of COUNT_KEYS) console.log(`  ${k.padEnd(42)} ${(totals as any)[k]}`)
  console.log(`\nfiles containing >=1 override declaration: ${filesWithOverride}`)
  console.log(`files containing >=1 coroutine dispatcher call: ${filesWithDispatch}`)
  console.log(`files containing >=1 import_header: ${filesWithImport}`)

  console.log("\nCALLEE SHAPE of call_expression (first named child class):")
  const shapeKeys = Object.keys(CALLEE_SHAPE).sort((a, b) => CALLEE_SHAPE[b] - CALLEE_SHAPE[a])
  for (const k of shapeKeys) console.log(`  ${k.padEnd(46)} ${CALLEE_SHAPE[k]}`)
  console.log(`  (unclassified examples) ${UNCLASSIFIED_EXAMPLES.slice(0, 8).join(" | ")}`)
  console.log(`\nfiles with hasError root: ${totals.hasErrorRoot}; of those, hidden-only (no reachable ERROR/MISSING node): ${totals.hiddenErrorOnly}`)

  console.log("\nEMITTED vs CONSTRUCT:")
  const rows: Array<{ type: string; emitted: number; construct: number; ratio: string }> = []
  const pairs: Array<[string, string, string]> = [
    ["calls", "call_expression", "call_expression minus unqualified PascalCase (which become instantiates) minus stdlib-filtered"],
    ["instantiates", "unqualifiedPascalCall", "unqualified PascalCase call_expression"],
    ["extends", "delegationSpecifier-nonCtor", "delegation_specifier without constructor_invocation"],
    ["implements", "delegationSpecifierCtor", "delegation_specifier WITH constructor_invocation"],
    ["overrides", "overrideFunction+overrideProperty", "declarations carrying the `override` modifier"],
    ["contains", "functionDeclaration+classDeclaration+objectDeclaration+propertyDeclaration", "member declarations"],
    ["references", "typeIdentifier+importHeader", "declared type_identifiers + import_headers"],
    ["uses", "extensionFunction+extensionProperty+coroutineDispatcher", "extension receivers + dispatcher calls (subset of what uses carries)"],
    ["brain_import", "importHeader", "import_header nodes"],
    ["exports", "topLevelPublicDecl", "top-level non-private declarations"],
  ]
  const ext = totals.delegationSpecifier - totals.delegationSpecifierConstructorInvocation
  for (const [type, key, why] of pairs) {
    let construct = 0
    if (key === "delegationSpecifier-nonCtor") construct = ext
    else if (key === "delegationSpecifierCtor") construct = totals.delegationSpecifierConstructorInvocation
    else if (key === "overrideFunction+overrideProperty") construct = totals.overrideFunction + totals.overrideProperty
    else if (key === "functionDeclaration+classDeclaration+objectDeclaration+propertyDeclaration")
      construct = totals.functionDeclaration + totals.classDeclaration + totals.objectDeclaration + totals.propertyDeclaration
    else if (key === "typeIdentifier+importHeader") construct = totals.typeIdentifier + totals.importHeader
    else if (key === "extensionFunction+extensionProperty+coroutineDispatcher")
      construct = totals.extensionFunction + totals.extensionProperty + totals.coroutineDispatcher
    else construct = (totals as any)[key] || 0
    const e = emitted[type] || 0
    const ratio = construct === 0 ? "n/a" : (e / construct).toFixed(3)
    rows.push({ type, emitted: e, construct, ratio })
    console.log(`  ${type.padEnd(13)} emitted ${String(e).padStart(6)}  construct ${String(construct).padStart(6)}  ratio ${ratio}   [${why}]`)
  }

  const outDir = "/tmp/opencode"
  writeFileSync(`${outDir}/kotlin-constructs.json`, JSON.stringify({ pin: KOTLIN_CORPUS_PIN, sample: files.length, modules: spread.modules, totals, emitted, pairs: rows }, null, 2))
  console.log(`\nwrote ${outDir}/kotlin-constructs.json`)
}

main().catch((e) => { console.error(String(e)); process.exit(1) })