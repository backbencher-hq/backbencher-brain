#!/usr/bin/env bun
/**
 * SWIFT EXTENDED-TYPE CONSTRUCT CENSUS (lane instrument, 2026-10-23).
 *
 * Measures the four extended-type candidate constructs over the WHOLE admitted population
 * (git-tracked .swift files under the 1 MiB cap, 14 corpus repositories), on the production
 * parse primitives (getParser("swift") — the served build, digest 41c4fdb2249a…), with
 * tree.delete() after every parse per the fleet's WASM lifetime rule.
 *
 * This is a CENSUS, not an emission: it counts construct SITES so the lane can choose a rung
 * (R1/R2/R3 implement vs rule) per type on measured evidence, per the owner's ladder.
 *
 * POPULATION RULE (fleet): git ls-files per repository (the corpus root holds symlinked
 * checkouts), admitted = tracked AND present AND <= 1 MiB. The disk-vs-tracked delta is
 * printed because it is a different population (the sql lane's lesson).
 *
 * RUN: bun validation/m14/fixtures/swift/m14-swift-extended-census.mts
 */
import { getParser } from "../../../../src/ast/engine";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const REPOS = ["flutter-packages","swift-nio","ghostty","proxicall","alamofire","duckdb","dart-http","sdwebimage","afnetworking","riverpod","nvim-treesitter","pb-grpc","tree-sitter-clean","nlohmann-json"];

const files: string[] = [];
let trackedTotal = 0, overCap = 0, absent = 0;
for (const r of REPOS) {
  const real = fs.realpathSync(`${ROOT}/.corpus/${r}`);
  let list: string[] = [];
  try { list = execSync(`git ls-files '*.swift'`, { cwd: real, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean); }
  catch { continue; }
  for (const f of list) {
    trackedTotal++;
    const p = `${real}/${f}`;
    let st: fs.Stats; try { st = fs.statSync(p); } catch { absent++; continue; }
    if (st.size > 1048576) { overCap++; continue; }
    files.push(p);
  }
}
console.log(`POPULATION: git-tracked ${trackedTotal} · admitted ${files.length} · over-cap ${overCap} · absent ${absent} · repos ${REPOS.length}`);

const parser: any = await getParser("swift");

const C = {
  attrTotal: 0, attrFiles: new Set<string>(),
  propertyWrapperDeclSites: 0, propertyWrapperUseSites: 0, resultBuilderAttrs: 0, macroAttrs: 0,
  availAttrs: 0, miscAttrs: 0,
  otherAttrs: new Map<string, number>(),
  attrArgumentHasCall: 0, attrArgumentCallFiles: new Set<string>(),
  attrArgumentHasCallByName: new Map<string, number>(),
  extTotal: 0,
  extConstraints: 0, extWhereSelf: 0, extWhereSelfFiles: new Set<string>(),
  extWithoutConstraints: 0,
  extConstraintsNonSelf: 0,
  someViewReturns: 0, someViewFiles: new Set<string>(),
  viewConformance: 0, viewConformanceFiles: new Set<string>(),
  dslCalls: 0, dslFiles: new Set<string>(),
  bodySomeView: 0, bodySomeViewFiles: new Set<string>(),
  bodyDslCalls: 0, bodyDslCallFiles: new Set<string>(),
  bodyCapCalls: 0, // capitalized bare calls inside body-some-View (instantiates candidates today)
  funcSomeView: 0, funcSomeViewFiles: new Set<string>(),
  // ── the rung-decision counters (added 2026-10-23, one question each) ──
  // mixes_in: the discriminator is the where-clause's OPERATOR. `Self: Base`
  // is a CONFORMANCE constraint (extends-family); `Self == X` is a same-TYPE
  // constraint (a conditional-extension idiom, not a conformance at all).
  extSelfColon: 0, extSelfColonSites: [] as string[],
  extSelfEq: 0, extSelfEqFiles: new Set<string>(),
  // decorates: dart's transfer test — does any corpus file DECLARE the thing
  // that would make an attribute an applied callable (a macro/wrapper/protocol
  // that takes the declaration)? Count `macro` declarations and `wrappedValue`
  // (the @propertyWrapper conformance marker).
  macroDecls: 0, wrappedValueDecls: 0,
};

// SwiftUI property-wrapper USE-site attributes (transforming attributes measured by name)
const PW_USE = /^(State|Published|Binding|ObservedObject|StateObject|EnvironmentObject|Environment|AppStorage|SceneStorage|FocusedValue|FocusedBinding|FetchRequest|SectionedFetchRequest|ScaledMetric|GestureState|Animatable|UITouchBar|Observable|Ignoring|ObservableProperty)?$/;
const WRAPPER_USE_NAMES = new Set(["State","Published","Binding","ObservedObject","StateObject","EnvironmentObject","Environment","AppStorage","SceneStorage","FocusedValue","FocusedBinding","ScaledMetric","GestureState","Observable"]);
const DSL_NAMES = new Set(["VStack","HStack","ZStack","List","Group","ScrollView","Form","NavigationStack","NavigationLink","ForEach","Text","Button","Image","TextField","LazyVStack","LazyHStack","Section","Spacer","Divider","Toggle","Slider","Picker","Stepper","TabView","Canvas","AsyncImage","Menu","Label","SecureField","TextEditor","DetailView","ContentView"]);

const MISC = /^(objc|IBAction|IBOutlet|IBOutletCollection|MainActor|preconcurrency|Sendable|inline|testable|_exported|_spi|frozen|inlinable|dynamic|NSCopying|discardableResult|noescape|autoclosure|convention|escaping|objcMembers|UIApplicationMain|main|IBSegueAction|IBDesignable|IBInspectable|GKInspectable|requires_stored_property_inits|nonobjc|fixed|alignment|assign|exponent|pack|self|Show|file|derived|_alwaysEmitIntoClient|_compiler|_specialize|weak|unowned|lazy|mutating|nonmutating|borrowing|consuming|isolated|rethrows|async|swift|UIAccessibilityIdentification|objc_bridge|cocoa)(_|$|\()/;

function attrName(node: any): string {
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i);
    if (ch && (ch.type === "identifier" || ch.type === "simple_identifier" || ch.type === "user_type" || ch.type === "type_identifier")) return ch.text;
  }
  const m = node.text.match(/^@?([\w.]+)/);
  return m ? m[1] : "";
}

function visit(node: any, file: string, inBodySomeView = false) {
  const t = node.type;
  if (t === "attribute") {
    C.attrTotal++; C.attrFiles.add(file);
    const name = attrName(node);
    if (name === "propertyWrapper") C.propertyWrapperDeclSites++;
    else if (WRAPPER_USE_NAMES.has(name)) C.propertyWrapperUseSites++;
    else if (/Builder$/i.test(name) || name === "resultBuilder") C.resultBuilderAttrs++;
    else if (/^#[A-Z]/.test(node.text)) C.macroAttrs++;
    else if (name === "available" || name === "Unavailable") C.availAttrs++;
    else if (MISC.test(name)) C.miscAttrs++;
    else C.otherAttrs.set(name, (C.otherAttrs.get(name) ?? 0) + 1);
    // Attribute arguments containing a call_expression — the args are DIRECT
    // children of the attribute node (the tree dump shows `(`, call_expression,
    // `)` as siblings of the user_type), so walk the attribute's whole subtree.
    let hasCall = false;
    const walkArgs = (n: any) => {
      if (!n || hasCall) return;
      if (n.type === "call_expression") { hasCall = true; return; }
      for (let i = 0; i < n.childCount; i++) walkArgs(n.child(i));
    };
    for (let i = 0; i < node.childCount; i++) {
      const ch = node.child(i);
      // skip the attribute's NAME node; args begin after the "(" token
      if (ch && !ch.isNamed && ch.text === "(") {
        // walk the remaining named children (the argument expressions)
        for (let j = i + 1; j < node.childCount; j++) walkArgs(node.child(j));
        break;
      }
    }
    if (hasCall) {
      C.attrArgumentHasCall++; C.attrArgumentCallFiles.add(file);
      C.attrArgumentHasCallByName.set(name, (C.attrArgumentHasCallByName.get(name) ?? 0) + 1);
    }
  }
  if (t === "class_declaration") {
    let kind = "";
    for (let i = 0; i < node.childCount; i++) {
      const ch = node.child(i);
      if (ch && !ch.isNamed && ["class","struct","enum","extension","actor"].includes(ch.text)) { kind = ch.text; break; }
    }
    if (kind === "extension") {
      C.extTotal++;
      // SWD2: `where` clauses parse as type_constraints (a DIRECT child), never where_clause
      let constraints: any = null;
      for (let i = 0; i < node.childCount; i++) { const ch = node.child(i); if (ch && ch.type === "type_constraints") { constraints = ch; break; } }
      if (constraints) {
        C.extConstraints++;
        const txt = constraints.text;
        if (/Self\s*:/.test(txt)) {
          C.extWhereSelf++; C.extWhereSelfFiles.add(file);
          C.extSelfColon++;
          if (C.extSelfColonSites.length < 10) C.extSelfColonSites.push(`${file.replace(/^.*repositories\//, "")}: ${node.text.slice(0, 90).replace(/\n/g, " ")}`);
        } else if (/Self\s*==/.test(txt)) {
          C.extSelfEq++; C.extSelfEqFiles.add(file);
        } else C.extConstraintsNonSelf++;
      } else C.extWithoutConstraints++;
    }
  }
  if (t === "opaque_type") {
    if (/^some\s+View$/.test(node.text.trim())) { C.someViewReturns++; C.someViewFiles.add(file); }
  }
  if (t === "inheritance_specifier") {
    if (node.text.trim() === "View") { C.viewConformance++; C.viewConformanceFiles.add(file); }
  }
  if (t === "call_expression") {
    // the callee's first named child
    let callee = "";
    for (let i = 0; i < node.childCount; i++) { const ch = node.child(i); if (ch && (ch.type === "simple_identifier" || ch.type === "identifier")) { callee = ch.text; break; } }
    if (DSL_NAMES.has(callee)) {
      C.dslCalls++; C.dslFiles.add(file);
      if (inBodySomeView) { C.bodyDslCalls++; C.bodyDslCallFiles.add(file); }
    }
    // capitalized bare call inside a body — today's instantiates candidate
    if (inBodySomeView && /^[A-Z]/.test(callee)) C.bodyCapCalls++;
  }
  // decorates falsifier shape: does the corpus DECLARE the applied-callable
  // machinery? (a `macro` declaration is a Swift 5.9 applied callable; a
  // `wrappedValue` declaration is the @propertyWrapper conformance marker)
  if (t === "macro_declaration") C.macroDecls++;
  if (t === "property_declaration" || t === "protocol_property_declaration") {
    for (let i = 0; i < node.childCount; i++) {
      const ch = node.child(i);
      if (ch && ch.type === "pattern" && ch.text.trim() === "wrappedValue") C.wrappedValueDecls++;
    }
  }
  if (t === "property_declaration") {
    for (let i = 0; i < node.childCount; i++) {
      const ch = node.child(i);
      if (ch && ch.type === "type_annotation" && /^:\s*some\s+View$/.test(ch.text.trim())) {
        C.bodySomeView++; C.bodySomeViewFiles.add(file);
      }
    }
  }
  // enter `var body: some View` computed_property subtree with the flag set
  let childInBody = inBodySomeView;
  if (t === "property_declaration" && !inBodySomeView) {
    for (let i = 0; i < node.childCount; i++) {
      const ch = node.child(i);
      if (ch && ch.type === "type_annotation" && /^:\s*some\s+View$/.test(ch.text.trim())) childInBody = true;
    }
  }
  if (t === "function_declaration" && !inBodySomeView) {
    // func ... -> some View
    const rt = findChildByTypeRec(node, "opaque_type", 4);
    if (rt && /^some\s+View$/.test(rt.text.trim())) { C.funcSomeView++; C.funcSomeViewFiles.add(file); childInBody = true; }
  }
  if (node.childCount > 0 && node.childCount < 100000) {
    for (let i = 0; i < node.childCount; i++) visit(node.child(i), file, childInBody);
  }
}
function findChildByTypeRec(node: any, type: string, maxDepth: number): any | null {
  if (maxDepth < 0) return null;
  for (let i =  node.childCount - 1; i >= 0; i--) {
    const ch = node.child(i);
    if (!ch) continue;
    if (ch.type === type) return ch;
    const d = findChildByTypeRec(ch, type, maxDepth - 1);
    if (d) return d;
  }
  return null;
}

let parsed = 0, failed = 0;
const failures: string[] = [];
for (const f of files) {
  let src: string;
  try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
  let tree: any;
  try { tree = parser.parse(src); } catch (e: any) { failed++; if (failures.length < 5) failures.push(`${f}: ${e?.message}`); continue; }
  if (!tree) { failed++; continue; }
  try { visit(tree.rootNode, f); parsed++; }
  catch (e: any) { failed++; if (failures.length < 5) failures.push(`${f}: ${e?.message}`); }
  tree.delete?.();
}
console.log(`PARSED: ${parsed}/${files.length} · failed ${failed}`);
if (failures.length) console.log("  sample:", failures.slice(0, 3));

console.log("\n=== DECORATES CANDIDATES ===");
console.log(`attribute nodes: ${C.attrTotal} (files: ${C.attrFiles.size})`);
console.log(`  @propertyWrapper DECLARATION sites: ${C.propertyWrapperDeclSites}`);
console.log(`  property-wrapper USE-site attrs (@State/@Published/@Binding/...): ${C.propertyWrapperUseSites}`);
console.log(`  @*Builder-family (result builders): ${C.resultBuilderAttrs}`);
console.log(`  freestanding-macro attrs (#…): ${C.macroAttrs}`);
console.log(`  @available-family: ${C.availAttrs}`);
console.log(`  misc/known markers (counted, not candidates): ${C.miscAttrs}`);
console.log(`  attribute arguments containing a CALL: ${C.attrArgumentHasCall} (files: ${C.attrArgumentCallFiles.size})`);
console.log(`  top attrs with call args: ${JSON.stringify([...C.attrArgumentHasCallByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
console.log(`  top OTHER attrs: ${JSON.stringify([...C.otherAttrs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))}`);

console.log("\n=== MIXES_IN CANDIDATES (protocol extensions) ===");
console.log(`extension declarations: ${C.extTotal}`);
console.log(`  with type_constraints (the where clause — SWD2: never where_clause): ${C.extConstraints}`);
console.log(`    \`Self : Base\` CONFORMANCE-constrained (extends-family): ${C.extSelfColon} (files: ${C.extWhereSelfFiles.size})`);
if (C.extSelfColonSites.length) console.log(`    sites: ${JSON.stringify(C.extSelfColonSites)}`);
console.log(`    \`Self == X\` same-TYPE-constrained (the near-miss idiom): ${C.extSelfEq} (files: ${C.extSelfEqFiles.size})`);
console.log(`    constraining generic params only: ${C.extConstraintsNonSelf}`);
console.log(`  without where clause: ${C.extWithoutConstraints}`);
console.log(`  ⇒ the contract's discriminator: \`Self : Base\` DOES declare a conformance (the extending type conforms to Base), so the where-clause form is EXTENDS-FAMILY; the UNCONSTRAINED protocol extension (\`extension Proto { }\`, ${C.extWithoutConstraints}) is the one that composes behaviour with NO conformance declared by the extension itself.`);

console.log("\n=== DECORATES — the applied-callable falsifier (macro/wrapper DECLARATIONS) ===");
console.log(`\`macro\` declarations: ${C.macroDecls}`);
console.log(`\`wrappedValue\` declarations (the @propertyWrapper conformance marker): ${C.wrappedValueDecls}`);
console.log(`@propertyWrapper attribute sites: ${C.propertyWrapperDeclSites} · property-wrapper USE attrs: ${C.propertyWrapperUseSites}`);

console.log("\n=== RENDERS CANDIDATES ===");
console.log(`\`some View\` opaque_type nodes: ${C.someViewReturns} (files: ${C.someViewFiles.size})`);
console.log(`\`var body: some View\` property declarations: ${C.bodySomeView} (files: ${C.bodySomeViewFiles.size})`);
console.log(`\`func … -> some View\` declarations: ${C.funcSomeView} (files: ${C.funcSomeViewFiles.size})`);
console.log(`View conformances: ${C.viewConformance} (files: ${C.viewConformanceFiles.size})`);
console.log(`SwiftUI DSL calls (whole corpus): ${C.dslCalls} (files: ${C.dslFiles.size})`);
console.log(`  DSL calls INSIDE body-some-View: ${C.bodyDslCalls} (files: ${C.bodyDslCallFiles.size})`);
console.log(`  capitalized bare calls inside body-some-View: ${C.bodyCapCalls}`);

console.log("\n=== PART_OF CANDIDATES ===");
console.log(`file-inclusion directive: SWIFT HAS NONE — the grammar's named-type inventory (186 named of 540 ids, served digest 41c4fdb2249a) contains no part/include/mixin node type; closest names are raw_str_end_part/raw_str_part (string-literal fragments, unrelated). Census zero BY GRAMMAR.`);
