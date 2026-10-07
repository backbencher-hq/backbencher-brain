/**
 * ELX-EXPORTS — source-level mutation A/B for the behaviours this wave added.
 *
 * WHY THIS TOOL EXISTS. `script/m14/mutate-analyzer.ts` is MASTER-owned and
 * cannot be edited by a lane agent, and it carries no mutant for `exports`,
 * `uses`, `overrides`, `evidenceClass` or the four R7 gates this wave closed.
 * The workstream's rule is "a fixture must assert the new behaviour AND a
 * mutant must die" — so this tool supplies the second half for the new code
 * without touching the shared harness.
 *
 * HOW IT MUTATES. Each mutant is an EXACT string replacement in
 * `src/ast/real-elixir-analyzer.ts` (split/join, never a pattern), applied to
 * the working file, run through the real fixture runner, then restored from an
 * in-memory backup in a `finally`. A mutant that leaves the fixture suite
 * passing is a HOLE: the new fixture does not actually pin that code path.
 * Nothing is left modified, and the file's bytes are compared before/after so
 * a failed restore is loud rather than silent.
 *
 * Usage: npx tsx script/m14/oracles/elixir-mutation-ab.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.env.BB_LANE_ROOT ?? path.resolve(process.cwd())
const ANALYZER = path.join(ROOT, "src", "ast", "real-elixir-analyzer.ts")
const RUNNER = path.join(ROOT, "script", "m14", "run-fixtures.ts")

interface Mutant { id: string; find: string; replace: string; note: string }

const MUTANTS: Mutant[] = [
  {
    id: "elixir/exports-private-published",
    find: `if (s.visibility !== "public") continue
      if (s.kind !== ASTEngine.SymbolKind.Function && s.kind !== ASTEngine.SymbolKind.Macro && s.kind !== ASTEngine.SymbolKind.Method) continue`,
    replace: `if (s.kind !== ASTEngine.SymbolKind.Function && s.kind !== ASTEngine.SymbolKind.Macro && s.kind !== ASTEngine.SymbolKind.Method) continue`,
    note: "drop the visibility gate -> defp/defmacrop/defguardp publish as exports",
  },
  {
    id: "elixir/exports-no-owner-gate",
    find: `      if (!_owner || _owner === s.name) continue
      if (s.metadata?.unresolvedName || this.isPlaceholderName(_owner) || this.isPlaceholderName(s.name)) continue`,
    replace: `      if (_owner === s.name) continue
      if (s.metadata?.unresolvedName || this.isPlaceholderName(_owner) || this.isPlaceholderName(s.name)) continue`,
    note: "drop the owner gate -> a file-level definition publishes an export with an EMPTY source",
  },
  {
    id: "elixir/exports-kind-gate-dropped",
    find: `      if (s.kind !== ASTEngine.SymbolKind.Function && s.kind !== ASTEngine.SymbolKind.Macro && s.kind !== ASTEngine.SymbolKind.Method) continue`,
    replace: `      if (s.metadata?.isStructField) continue`,
    note: "replace the callable-kind gate with a struct-field test -> a type alias or a struct itself publishes an export",
  },
  {
    id: "elixir/exports-line-wrong",
    find: `      }, s.range.startLine)
    }

    // Unqualified-call resolution`,
    replace: `      })
    }

    // Unqualified-call resolution`,
    note: "drop the exports edge's line -> the M59 name-bearing-line contract breaks",
  },
  {
    id: "elixir/uses-dropped",
    find: `      if (target === "use") {
          for (const dep of deps) {
              if (!dep.name || dep.name === currentScope?.name) continue
              this.pushRel(ctx, currentScope?.name || "Global", dep.name, ASTEngine.RelationshipType.Uses, 1.0, { elixirSpecific: true, isMixin: true, via: "use" }, dep.line)
          }
      }`,
    replace: `      if (target === "use" && false) {
          for (const dep of deps) {
              if (!dep.name || dep.name === currentScope?.name) continue
              this.pushRel(ctx, currentScope?.name || "Global", dep.name, ASTEngine.RelationshipType.Uses, 1.0, { elixirSpecific: true, isMixin: true, via: "use" }, dep.line)
          }
      }`,
    note: "stop emitting uses -> `use Mod` publishes only the module dependency again",
  },
  {
    id: "elixir/uses-self-loop",
    find: `              if (!dep.name || dep.name === currentScope?.name) continue
              this.pushRel(ctx, currentScope?.name || "Global", dep.name, ASTEngine.RelationshipType.Uses, 1.0, { elixirSpecific: true, isMixin: true, via: "use" }, dep.line)`,
    replace: `              if (!dep.name) continue
              this.pushRel(ctx, currentScope?.name || "Global", dep.name, ASTEngine.RelationshipType.Uses, 1.0, { elixirSpecific: true, isMixin: true, via: "use" }, dep.line)`,
    note: "drop the self-directive guard -> `use UsesSelf` inside UsesSelf forges a self-loop",
  },
  {
    id: "elixir/overrides-mark-without-prior",
    find: `      if (priorLine === undefined) return`,
    replace: `      if (false) return`,
    note: "emit an override for the FIRST declaration too -> a mark with nothing before it becomes an override",
  },
  {
    id: "elixir/overrides-arity-blind",
    find: `      const marked = table.get(\`\${name}/\${arity}\`)`,
    replace: `      let marked = table.get(\`\${name}/\${arity}\`)
      if (marked === undefined) for (const k of Array.from(table.keys())) if (k.startsWith(name + "/")) { marked = table.get(k); break }`,
    note: "fall back to arity 0 -> pick/2 counts as an override of pick/1",
  },
  {
    id: "elixir/overrides-line-first-decl",
    find: `    const declLine = node.startPosition.row + 1
    this.recordOverride(ctx, currentScope?.name, name, arity, ctx.lastDeclLine.get(fnId), declLine)
    ctx.lastDeclLine.set(fnId, declLine)`,
    replace: `    const declLine = node.startPosition.row + 1
    const first = ctx.lastDeclLine.get(fnId)
    this.recordOverride(ctx, currentScope?.name, name, arity, first, declLine)
    if (first === undefined) ctx.lastDeclLine.set(fnId, declLine)`,
    note: "report the FIRST declaration as the overridden one -> a second override points at the wrong prior",
  },
  {
    id: "elixir/evidence-class-dropped",
    find: `      metadata: { evidenceClass: RealElixirAnalyzer.evidenceClassFor(type, confidence, target), ...metadata },`,
    replace: `      metadata: { ...metadata },`,
    note: "stop stamping evidenceClass -> the Q6 pin reads undefined on every edge",
  },
  {
    id: "elixir/r7-directive-name-fallback",
    find: `      if (first.type === "atom") return first.text
      // A dotted path: \`alias Foo.Bar\`, \`alias __MODULE__.Endpoint\`, or the group`,
    replace: `      if (first.type === "atom") return node.text
      // A dotted path: \`alias Foo.Bar\`, \`alias __MODULE__.Endpoint\`, or the group`,
    note: "read the whole arguments TEXT for an ATOM directive name -> `alias :lists, as: MyList` publishes \":lists, as: MyList\"",
  },
  {
    id: "elixir/r7-directive-computed-name",
    find: `      if (first.type === "dot") {
          const left = first.childForFieldName("left")
          const right = first.childForFieldName("right")
          if (!left || !right) return ""
          if (left.type === "dot") {`,
    replace: `      if (first.type === "call") return first.text
      if (first.type === "dot") {
          const left = first.childForFieldName("left")
          const right = first.childForFieldName("right")
          if (!left || !right) return ""
          if (left.type === "dot") {`,
    note: "name a computed directive after its callee -> `alias Module.concat(A, B)` publishes `Module.concat`",
  },
  {
    id: "elixir/r7-spec-read-as-directive",
    find: `               if (!this.isInDeclarationAttributeValue(node) && !this.isDefHead(node)) {
                   this.processDirective(node, t, ctx, currentScope, scopeStack)
               }`,
    replace: `               this.processDirective(node, t, ctx, currentScope, scopeStack)`,
    note: "drop the declaration-attribute and def-head gates -> `@spec require(...)` and `def import(...)` become dependencies",
  },
  {
    id: "elixir/r7-module-name-read-anything",
    find: `    const name = this.moduleNameOf(argsNode)
    // ELX-EXPORTS: an UNREADABLE module name publishes nothing AND its body is`,
    replace: `    const name = this.moduleNameOf(argsNode) || this.stripParens(argsNode.text)
    // ELX-EXPORTS: an UNREADABLE module name publishes nothing AND its body is`,
    note: "restore the source-text fallback -> `defmodule 1 + 2` publishes its own source line as the module name",
  },
  {
    id: "elixir/r7-atom-module-nested",
    find: `      if (this.isAtomModuleName(name)) return name
      if (name === scope || name.startsWith(scope + ".")) return name`,
    replace: `      if (name === scope || name.startsWith(scope + ".")) return name`,
    note: "nest an atom-named module -> `defmodule :root_defmodule` inside ModuleTest publishes `ModuleTest.:root_defmodule` and a false contains edge",
  },
  {
    id: "elixir/r7-unknown-edge-published",
    find: `      if (_owner && _owner !== s.name && !s.metadata?.unresolvedName && !this.isPlaceholderName(_owner)) {`,
    replace: `      if (_owner && _owner !== s.name) {`,
    note: "publish contains edges for a placeholder-named symbol -> `contains Mod -> Unknown` returns",
  },
  {
    id: "elixir/r7-struct-receiver-target",
    find: `      if (finalTarget.indexOf("{") !== -1 || finalTarget.indexOf("}") !== -1) return`,
    replace: `      if (false) return`,
    note: "stop refusing a struct/map-expression receiver -> `%Point{}.foo_bar` publishes the whole expression as a callee",
  },
  {
    id: "elixir/r7-operator-name-overwritten",
    find: `          const opNode = this.findChild(actualCall, (c) => c?.type === "operator_identifier")
          if (opNode?.text) {`,
    replace: `          const opNode = this.findChild(actualCall, (c) => c?.type === "operator_identifier")
          if (false && opNode?.text) {`,
    note: "re-open the EX-A15 dead branch -> `defmacro (..)` publishes a macro named `(`",
  },
]

function runFixtures(): { pass: number; fail: number; failing: string[] } {
  let out = ""
  try {
    out = execFileSync("bun", ["run", RUNNER, "--lang", "elixir"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900_000 })
  } catch (e: any) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
  const failing: string[] = []
  for (const line of out.split("\n")) {
    if (!line.startsWith("FAIL")) continue
    const name = line.slice(4).trim()
    if (name.length) failing.push(name)
  }
  let pass = 0, fail = 0
  for (const line of out.split("\n")) {
    if (!line.startsWith("PASS")) continue
    pass++
  }
  fail = failing.length
  return { pass, fail, failing }
}

function main() {
  const original = fs.readFileSync(ANALYZER, "utf8")
  console.log(`analyzer: ${ANALYZER} (${original.length} bytes)`)
  const clean = runFixtures()
  console.log(`\nCLEAN RUN: ${clean.pass} pass / ${clean.fail} fail`)
  if (clean.fail !== 0) {
    console.log(`  the suite must be green before a mutant means anything; failing: ${clean.failing.join(" ")}`)
    process.exit(1)
  }
  let holes = 0
  for (const m of MUTANTS) {
    const parts = original.split(m.find)
    if (parts.length !== 2) {
      console.log(`SKIP     ${m.id}  (anchor matched ${parts.length - 1}x — the analyzer moved; fix the mutant)`)
      holes++
      continue
    }
    fs.writeFileSync(ANALYZER, parts.join(m.replace))
    let res: { pass: number; fail: number; failing: string[] }
    try { res = runFixtures() } finally { fs.writeFileSync(ANALYZER, original) }
    const caught = res.fail > 0
    if (!caught) holes++
    console.log(`${caught ? "CAUGHT " : "SURVIVED"} ${m.id.padEnd(38)} ${caught ? `-> ${res.failing.slice(0, 4).join(" ")}` : "(suite still green — the fixture does not pin this path)"}`)
    console.log(`         ${m.note}`)
  }
  const after = fs.readFileSync(ANALYZER, "utf8")
  console.log(`\nrestore check: ${after === original ? "byte-identical" : "MISMATCH — the working file was not restored"}`)
  console.log(`\n${MUTANTS.length} mutants, ${holes} holes (SKIP/SURVIVED)`)
  if (holes > 0 || after !== original) process.exit(1)
}

main()