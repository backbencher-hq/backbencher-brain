/**
 * M12 bash — re-derive `validation/m12/ground-truth/bash.json` from the
 * INDEPENDENT F5 oracle, replacing a hand-authored mirror.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The pre-wave truth was 55 facts, every one `authority: "manual_audit"`,
 * written by the same hand as the analyzer. Twelve of them asserted
 * `sourceId: "global"` — the phantom owner endpoint — as EXPECTED, and two
 * asserted a trap edge whose source was a signal name (`INT`) and whose target
 * was a whole command string with its arguments (`log "WARN" "interrupted"`).
 * A truth file that certifies those as correct is not a check; it is a second
 * copy of the defect, and it is why the lane's `precision 1.000` measured
 * nothing. Worse, it would have made any honest fix read as a REGRESSION.
 *
 * So the truth is no longer hand-written. It is derived from
 * `deriveBashEdges` — the oracle in `script/m14/differential.ts` that walks the
 * TREE and shares no table and no import with the analyzer — plus a symbol
 * derivation that also reads the tree. The authority recorded on every fact is
 * therefore `f5_tree_oracle`, not `manual_audit`.
 *
 * WHAT THIS DOES AND DOES NOT PROVE — stated here because it is the honest
 * limit of the arrangement: the m12 differential and the M14.0.F5 differential
 * now consume the SAME oracle, so they are not independent OF EACH OTHER. The
 * independence that matters is preserved and is the one the M60 sharpness work
 * cares about: the oracle cannot see the analyzer's data, so a fabrication in
 * the analyzer cannot be corroborated by it. Two checks over one independent
 * source beat one check over a mirror, and this file says so rather than
 * letting the reader assume two independent oracles.
 *
 * Writes: validation/m12/ground-truth/bash.json (the ONLY file it writes).
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { deriveBashEdges } from "../m14/differential"

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, "validation/m12/fixtures/bash")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-bash.wasm"))))

const { readdirSync } = await import("node:fs")
const files = readdirSync(FIXTURE_DIR).filter((f) => /\.(sh|bash)$/i.test(f)).sort()

interface Fact {
  id: string
  layer: string
  kind: string
  file: string
  line?: number
  sourceId?: string
  targetId?: string
  attributes: Record<string, unknown>
  evidence: { authority: string; reference: string }
}

const facts: Fact[] = []
const AUTHORITY = "f5_tree_oracle"

for (const file of files) {
  const text = readFileSync(path.join(FIXTURE_DIR, file), "utf8")
  const tree = parser.parse(text)
  if (!tree) continue
  const scriptName = file

  // --- symbols, derived from the tree's own name-bearing nodes ------------
  const declaredFns = new Set<string>()
  {
    const st: any[] = [tree.rootNode]
    while (st.length > 0) {
      const n: any = st.pop()
      if (!n) continue
      if (n.type === "function_definition") {
        const nm = n.childForFieldName?.("name")?.text
        if (nm) declaredFns.add(nm)
      }
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st.push(c) }
    }
  }
  for (const fn of [...declaredFns].sort()) {
    let line = 0
    {
      const st: any[] = [tree.rootNode]
      outer: while (st.length > 0) {
        const n: any = st.pop()
        if (!n) continue
        if (n.type === "function_definition" && n.childForFieldName?.("name")?.text === fn) { line = n.startPosition.row + 1; break outer }
        for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st.push(c) }
      }
    }
    facts.push({
      id: `symbol:${file}:${line}:function:${fn}`,
      layer: "ast_extraction",
      kind: "symbol",
      file,
      line,
      attributes: { name: fn, symbolKind: "function" },
      evidence: { authority: AUTHORITY, reference: "function_definition name field" },
    })
  }

  // The SCRIPT is a declaration too: a module symbol spanning the file. This is
  // the identity BD2 settled on, and a truth file that omits it would call the
  // analyzer's module symbol a fabrication.
  facts.push({
    id: `symbol:${file}:1:module:${scriptName}`,
    layer: "ast_extraction",
    kind: "symbol",
    file,
    line: 1,
    attributes: { name: scriptName, symbolKind: "module" },
    evidence: { authority: AUTHORITY, reference: "the file is bash's unit of declaration (BD2)" },
  })

  // Variable and constant declarations, read off the tree's own name nodes. The
  // KIND is decided by the declaring keyword: `export`/`readonly` state an
  // interface and are constants, everything else is a variable. Deriving the
  // kind here rather than importing the analyzer's table is the point — a truth
  // file that copies the analyzer's mapping cannot check it.
  {
    const st: any[] = [tree.rootNode]
    const seen = new Set<string>()
    while (st.length > 0) {
      const n: any = st.pop()
      if (!n) continue
      // A `variable_assignment` INSIDE a `declaration_command` is the same
      // declaration seen twice — `export X=1` parses as both. Counting it twice
      // put a `variable` fact next to the `constant` the keyword implies, and the
      // differential then read the analyzer's single constant as a false
      // negative for the `variable` id. Same declaration, one fact.
      const nestedInDeclaration = n.type === "variable_assignment" && n.parent?.type === "declaration_command"
      if (!nestedInDeclaration && (n.type === "variable_assignment" || n.type === "declaration_command")) {
        const declKeyword = n.type === "declaration_command" ? (n.child(0)?.text ?? "") : ""
        const isArrayOrTypeset = declKeyword === "declare" || declKeyword === "typeset"
        let isExport = declKeyword === "export"
        if (isArrayOrTypeset) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "word" && c.text === "-x") isExport = true
          }
        }
        const isReadonly = declKeyword === "readonly"
        const names: { name: string; line: number }[] = []
        if (n.type === "variable_assignment") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "variable_name") names.push({ name: c.text, line: c.startPosition.row + 1 })
          }
        } else {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "variable_name") {
              // `export -f fn` exports a FUNCTION, not a variable.
              if (isExport && Array.from({ length: n.namedChildCount }, (_, k) => n.namedChild(k)).some((x: any) => x?.type === "word" && x.text === "-f")) continue
              names.push({ name: c.text, line: c.startPosition.row + 1 })
            } else if (c.type === "variable_assignment") {
              for (let j = 0; j < c.namedChildCount; j++) {
                const v = c.namedChild(j)
                if (v && v.type === "variable_name") names.push({ name: v.text, line: v.startPosition.row + 1 })
              }
            }
          }
        }
        for (const nm of names) {
          const kind = isExport || isReadonly ? "constant" : "variable"
          // One declaration per (SCOPE, name), at the FIRST site — which is what
          // the analyzer emits and what a reader means by "where is it declared".
          // Dedupe on the id alone let a later reassignment add a second fact at
          // a different line, and the differential read the analyzer's single
          // symbol as a false negative for it.
          const scopeKey = `${kind}\u0000${nm.name}`
          if (seen.has(scopeKey)) continue
          seen.add(scopeKey)
          const id = `symbol:${file}:${nm.line}:${kind}:${nm.name}`
          facts.push({
            id,
            layer: "ast_extraction",
            kind: "symbol",
            file,
            line: nm.line,
            attributes: { name: nm.name, symbolKind: kind },
            evidence: {
              authority: AUTHORITY,
              reference: n.type === "variable_assignment" ? "variable_assignment name node" : `declaration_command (${declKeyword || "declaration"}) name node`,
            },
          })
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st.push(c) }
    }
  }

  // An `alias` declares a callable name, and the analyzer models it as a
  // `function` so a call to it resolves. Derived here from the same tree read.
  {
    const st: any[] = [tree.rootNode]
    while (st.length > 0) {
      const n: any = st.pop()
      if (!n) continue
      if (n.type === "command") {
        let cn: any = null
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type === "command_name") { cn = c; break } }
        if (cn && cn.text === "alias") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || (c.type !== "concatenation" && c.type !== "word")) continue
            const eq = c.text.indexOf("=")
            if (eq <= 0) continue
            const nm = c.text.slice(0, eq)
            if (nm.trim() === "" || nm.startsWith("-")) continue
            let line = n.startPosition.row + 1
            facts.push({
              id: `symbol:${file}:${line}:function:${nm}`,
              layer: "ast_extraction",
              kind: "symbol",
              file,
              line,
              attributes: { name: nm, symbolKind: "function" },
              evidence: { authority: AUTHORITY, reference: "alias declaration — a callable name, modelled as a function" },
            })
            break
          }
        }
      }
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) st.push(c) }
    }
  }

  // --- relationships, from the F5 oracle ----------------------------------
  for (const e of deriveBashEdges(tree.rootNode as any, scriptName)) {
    facts.push({
      id: `rel:${file}:${e.label}:${e.from}:${e.target}`,
      layer: "relationships",
      kind: "relationship",
      file,
      sourceId: e.from,
      targetId: e.target,
      attributes: { type: e.label },
      evidence: { authority: AUTHORITY, reference: "deriveBashEdges (script/m14/differential.ts), an independent tree walk" },
    })
  }
  tree.delete?.()
}

const out = {
  schemaVersion: 2,
  truthSource: "f5_tree_oracle",
  authority: AUTHORITY,
  source: "validation/m12/fixtures/bash/{Common.sh,Deploy.sh,Negative.sh}",
  derivedBy: "script/m12/bash-truth-derive.ts",
  derivation:
    "Every fact below is read off the TREE by deriveBashEdges (script/m14/differential.ts) — the same independent oracle the M14.0.F5 differential uses — plus a symbol derivation that reads the grammar's own `name` fields. No fact is transcribed from analyzer output and no analyzer table is imported.",
  independence:
    "The m12 differential and the M14.0.F5 differential now consume the SAME oracle, so they are not independent of each other. The independence that matters is oracle-vs-analyzer: deriveBashEdges walks the tree and shares no table and no import with src/ast/real-bash-analyzer.ts, so it cannot corroborate an analyzer fabrication.",
  supersedes: {
    schemaVersion: 1,
    truthSource: "manual_audit",
    facts: 55,
    why:
      "The v1 truth was hand-authored by the same hand as the analyzer (all 55 facts `authority: manual_audit`). Twelve asserted `sourceId: \"global\"` — the phantom owner endpoint that isIndexArtifactName rejects as a symbol name, so those edges could never resolve — and two asserted a trap edge whose source was a signal name and whose target was a whole command string. It certified two defects as truth, which is why the lane's `precision 1.000` measured nothing and why any honest fix would have read as a regression.",
  },
  facts,
}

writeFileSync(path.join(ROOT, "validation/m12/ground-truth/bash.json"), JSON.stringify(out, null, 2) + "\n")
console.log(`wrote validation/m12/ground-truth/bash.json — ${facts.length} facts, authority=${AUTHORITY}`)
const byType: Record<string, number> = {}
for (const f of facts) {
  const k = f.kind === "symbol" ? `symbol:${f.attributes.symbolKind}` : `rel:${f.attributes.type}`
  byType[k] = (byType[k] ?? 0) + 1
}
console.log(JSON.stringify(byType, null, 2))
