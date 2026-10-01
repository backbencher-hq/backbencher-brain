/**
 * M14.0.F7 — Pipeline End-to-End Gate
 *
 * Exists because layer-gates missed the seam: analyzers emitted imports,
 * fixtures passed, differential passed — yet brain_import was EMPTY for every
 * language for months, because nothing ever queried the DATABASE after
 * indexing. Layer-green does not prove pipeline-works.
 *
 * This gate indexes a small polyglot project through the REAL CLI pipeline
 * (node bin/bb index) and asserts row-level facts in the resulting brain.db:
 *   - symbols persisted per language
 *   - relationships persisted, incl. extends/implements/calls/instantiates
 *   - imports persisted for files that HAVE imports (the regression that
 *     motivated this gate)
 *   - cross-language edges flagged is_cross_language=1 with bridge mechanism
 *
 * Any new seam bug class discovered in the future MUST become a check here.
 *
 * CLI: bun run script/m14/verify-pipeline-e2e.ts
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import Database from "better-sqlite3"

const ROOT = path.resolve(process.cwd())
const TMP = "/tmp/opencode/m14-e2e-project"

function writeProject() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, "src"), { recursive: true })
  // java: import + abstract class + interface
  fs.writeFileSync(path.join(TMP, "src", "BaseService.java"), `package com.acme.core;

import java.io.Serializable;

public abstract class BaseService implements Serializable {
    public abstract String execute(String input);
}
`)
  // groovy: imports + extends JAVA class + implements JAVA interface + call + instantiation
  fs.writeFileSync(path.join(TMP, "src", "GroovyChild.groovy"), `package com.acme.core

import java.util.List

class GroovyChild extends BaseService {
    String execute(String input) {
        def other = new GroovyChild()
        return other.toString() + input
    }
}
`)
  // erlang (M14 #384 BEAM seam): module + behaviour contract + record decl +
  // arity-distinct local calls + remote call + record construction + include.
  // Every construct asserted below is one the erlang analyzer emits through
  // the fixture battery — this seam proves the rows survive the REAL CLI.
  fs.writeFileSync(path.join(TMP, "src", "seam_srv.erl"), `-module(seam_srv).
-behaviour(gen_server).
-include("seam.hrl").
-export([start/0, pick/1, pick/2, handle_call/3]).

-record(state, {count, name}).

start() ->
    gen_server:start_link({local, ?MODULE}, seam_srv, [], []),
    pick(1),
    pick(1, 2),
    io:format("seam ~p~n", [#state{count = 1, name = a}]).

pick(X) -> X.
pick(X, Y) -> {X, Y}.

handle_call(_Req, _From, State) ->
    {reply, ok, State}.
`)
  // elixir (M14 #384 BEAM seam): defmodule + arity-distinct defs + alias
  // reference + qualified call.
  fs.writeFileSync(path.join(TMP, "src", "seam.ex"), `defmodule Seam do
  @moduledoc "Seam module docs."

  alias Seam.Helper

  def pick(x), do: x
  def pick(x, y), do: {x, y}

  @doc "Calls the helper twice."
  def go do
    Helper.call(pick(1), pick(1, 2))
    Helper.call(pick(1), pick(1, 2))
  end
end
`)
  // clojure (CLJ1 seam): defn + leading comment doc channel + per-site calls
  // + extend-protocol implements + def-initializer top-level call — every row
  // the CLJ1 wave revived must survive emit → worker → store through the
  // REAL CLI (same contract the EX2/EX3 seam holds for elixir).
  fs.writeFileSync(path.join(TMP, "src", "seam.clj"), `(ns seam.core)

;; Seam function docs.
(defn pick [x] x)

(defprotocol P (px [this]))

(extend-protocol P
  String
  (px [_] "s"))

(def state (make-state))

(defn go []
  (pick 1)
  (pick 2))
`)
}

async function main() {
  writeProject()

  // index via the REAL compiled CLI pipeline — not engine internals
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" })
  const t0 = Date.now()
  execSync(`node bin/bb index ${TMP} --force`, { cwd: ROOT, stdio: "pipe" })
  const durationMs = Date.now() - t0

  const sha = createHash("sha1").update(TMP).digest("hex")
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
  if (!fs.existsSync(dbPath)) throw new Error(`expected db missing: ${dbPath}`)
  const db = new Database(dbPath, { readonly: true })

  const failures: string[] = []
  const expect = (cond: boolean, msg: string) => { if (!cond) failures.push(msg) }

  const count = (sql: string, ...args: any[]) =>
    (db.prepare(sql).get(...args) as any)?.c ?? 0

  // symbols persisted for both languages
  const javaSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.java'`)
  const groovySymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.groovy'`)
  expect(javaSymbols >= 2, `java symbols persisted (got ${javaSymbols}, want >=2)`)
  expect(groovySymbols >= 2, `groovy symbols persisted (got ${groovySymbols}, want >=2)`)

  // relationships of core kinds
  for (const kind of ["extends", "implements", "calls", "instantiates", "contains"]) {
    const c = count(`SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type = ?`, kind)
    expect(c > 0, `relationship '${kind}' present (got 0)`)
  }

  // THE regression that motivated this gate: imports must persist
  const javaImports = count(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file bf ON bf.id = bi.file_id WHERE bf.path LIKE '%.java'`)
  const groovyImports = count(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file bf ON bf.id = bi.file_id WHERE bf.path LIKE '%.groovy'`)
  expect(javaImports >= 1, `java imports persisted (got ${javaImports})`)
  expect(groovyImports >= 1, `groovy imports persisted (got ${groovyImports})`)

  // BEAM seam (M14 #384): erlang and elixir rows survive the real CLI too —
  // symbols, calls (arity-distinct), the behaviour implements edge, record
  // construction, and the -include import. Asserted via the SOURCE symbol's
  // file so target resolution (symbol id vs external string) is not guessed.
  const edgesFromLang = (ext: string, kind: string) =>
    count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%${ext}' AND r.relationship_type = ?`, kind)
  const erlSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.erl'`)
  const exSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.ex'`)
  expect(erlSymbols >= 6, `erlang symbols persisted (got ${erlSymbols}, want >=6: module + 4 functions + record)`)
  expect(exSymbols >= 2, `elixir symbols persisted (got ${exSymbols}, want >=2)`)
  expect(edgesFromLang(".erl", "calls") >= 3, `erlang calls persisted (got ${edgesFromLang(".erl", "calls")}, want >=3: pick/1, pick/2, gen_server:start_link, io:format)`)
  expect(edgesFromLang(".erl", "implements") >= 1, `erlang behaviour implements persisted (got ${edgesFromLang(".erl", "implements")})`)
  expect(edgesFromLang(".erl", "instantiates") >= 1, `erlang record construction persisted (got ${edgesFromLang(".erl", "instantiates")})`)
  const erlImports = count(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file bf ON bf.id = bi.file_id WHERE bf.path LIKE '%.erl'`)
  expect(erlImports >= 1, `erlang -include persisted (got ${erlImports})`)
  expect(edgesFromLang(".ex", "calls") >= 1, `elixir calls persisted (got ${edgesFromLang(".ex", "calls")})`)
  // EX waves (M60 round-trip): the docstring channel and the M59 call-site
  // lines must survive emit → worker → store through the REAL CLI — the two
  // payloads the EX2/EX3 waves revived for elixir (docstring was NULL for
  // every symbol index-wide; line_number was absent on every relationship).
  const exDocs = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.ex' AND docstring IS NOT NULL`)
  expect(exDocs >= 2, `elixir docstrings persisted (got ${exDocs}, want >=2: @moduledoc + @doc)`)
  const exLinedCalls = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.ex' AND r.relationship_type = 'calls' AND r.line_number IS NOT NULL`)
  expect(exLinedCalls >= 2, `elixir calls carry call-site lines (got ${exLinedCalls}, want >=2: two Helper.call sites)`)
  const exSiteLines = count(`SELECT COUNT(DISTINCT r.line_number) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.ex' AND r.relationship_type = 'calls'`)
  expect(exSiteLines >= 2, `elixir per-site lines distinct (got ${exSiteLines}, want >=2: the twice-called Helper.call sites are separate rows)`)
  const exNullLines = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.ex' AND r.relationship_type = 'calls' AND r.line_number IS NULL`)
  expect(exNullLines === 0, `no fabricated/missing elixir lines (got ${exNullLines} NULL)`)
  const exLineZero = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.ex' AND r.relationship_type = 'calls' AND r.line_number = 0`)
  expect(exLineZero === 0, `no zero-based elixir lines (got ${exLineZero})`)

  // CLJ1 seam: the revived clojure payloads — the doc channel, per-site call
  // lines (the 0/8381-lined defect), the top-level def-initializer call and
  // the extend-protocol implements edge — must survive the same store path.
  const cljSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.clj'`)
  expect(cljSymbols >= 4, `clojure symbols persisted (got ${cljSymbols}, want >=4: pick + P + px + state + go)`)
  const cljDocs = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.clj' AND docstring IS NOT NULL`)
  expect(cljDocs >= 1, `clojure docstrings persisted (got ${cljDocs}, want >=1: the leading comment block on pick)`)
  const cljLinedCalls = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.clj' AND r.relationship_type = 'calls' AND r.line_number IS NOT NULL`)
  expect(cljLinedCalls >= 3, `clojure calls carry call-site lines (got ${cljLinedCalls}, want >=3: make-state + two pick sites)`)
  const cljSiteLines = count(`SELECT COUNT(DISTINCT r.line_number) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.clj' AND r.relationship_type = 'calls'`)
  expect(cljSiteLines >= 3, `clojure per-site lines distinct (got ${cljSiteLines}, want >=3: the two pick sites are separate rows)`)
  const cljNullLines = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.clj' AND r.relationship_type = 'calls' AND r.line_number IS NULL`)
  expect(cljNullLines === 0, `no fabricated/missing clojure lines (got ${cljNullLines} NULL)`)
  const cljLineZero = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.clj' AND r.relationship_type = 'calls' AND r.line_number = 0`)
  expect(cljLineZero === 0, `no zero-based clojure lines (got ${cljLineZero})`)
  // The extend-protocol edge's source (`String`) is a JAVA class — no local
  // symbol id exists for it, and the store persists the row honestly with
  // source_external + the line intact (verified by direct query: src=null,
  // se="String", te="P", ln=9). The symbol JOIN above cannot see such rows,
  // so this pin addresses the row by its external shape.
  const cljImpl = count(`SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type = 'implements' AND source_external = 'String' AND target_external = 'P' AND line_number = 9`)
  expect(cljImpl >= 1, `clojure extend-protocol implements persisted with its line (got ${cljImpl}, want >=1: String → P at line 9, external source)`)


  // cross-language edge flagged with bridge
  const xlang = db.prepare(`
    SELECT r.relationship_type t, r.bridge_mechanism b,
      f1.path p1, f2.path p2
    FROM brain_relationship r
    LEFT JOIN brain_symbol s1 ON s1.id = r.source_symbol_id
    LEFT JOIN brain_symbol s2 ON s2.id = r.target_symbol_id
    LEFT JOIN brain_file f1 ON f1.id = s1.file_id
    LEFT JOIN brain_file f2 ON f2.id = s2.file_id
    WHERE r.is_cross_language = 1`).all() as any[]
  const groovyExtendsJava = xlang.find(r => r.t === "extends" && r.p1?.endsWith(".groovy") && r.p2?.endsWith(".java"))
  expect(!!groovyExtendsJava, "cross-language groovy->java extends edge flagged is_cross_language=1")

  // --- idempotency: re-index must not grow rows (deterministic storage) ---
  const before = {
    symbols: count(`SELECT COUNT(*) c FROM brain_symbol`),
    rels: count(`SELECT COUNT(*) c FROM brain_relationship`),
    imports: count(`SELECT COUNT(*) c FROM brain_import`),
  }
  execSync(`node bin/bb index ${TMP}`, { cwd: ROOT, stdio: "pipe" })
  const after = {
    symbols: count(`SELECT COUNT(*) c FROM brain_symbol`),
    rels: count(`SELECT COUNT(*) c FROM brain_relationship`),
    imports: count(`SELECT COUNT(*) c FROM brain_import`),
  }
  expect(after.symbols === before.symbols, `re-index idempotent symbols (${before.symbols} -> ${after.symbols})`)
  expect(after.rels === before.rels, `re-index idempotent relationships (${before.rels} -> ${after.rels})`)
  expect(after.imports === before.imports, `re-index idempotent imports (${before.imports} -> ${after.imports})`)

  // --- perf trend recording (F9 will add the ceiling gate) ---
  expect(durationMs < 120000, `index duration sane (${durationMs}ms)`)

  db.close()
  fs.rmSync(TMP, { recursive: true, force: true })

  // evidence
  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    // M49 W8: this gate used to emit `M14.0.F7`, which belongs to the
    // analyzer-hygiene gate. Because this one IS in the battery and that one was
    // not, every full run overwrote the hygiene evidence with pipeline content,
    // and the honesty gate's F7 deep-check then passed against the wrong
    // artifact. Each evidence identity has exactly one producer (enforced by
    // script/m49/verify-evidence-identity.ts).
    issueId: "M14.0.PIPE",
    title: "Pipeline end-to-end gate",
    claimLevel: "L1",
    layers: ["pipeline-e2e"],
    checks: [
      { id: "e2e-polyglot", description: "real CLI index -> brain.db row-level assertions (symbols/relationships/imports/xlang flags)", status: failures.length ? "fail" : "pass" },
      { id: "idempotency", description: "re-index does not grow rows", status: failures.some(f => f.includes("idempotent")) ? "fail" : "pass" },
    ],
    limitations: [
      { description: "assertions cover the seam classes discovered so far; every future seam bug must be added here as a permanent check" },
      { description: "duration recorded for F9 trend; hard ceiling intentionally coarse to stay machine-tolerant" },
    ],
    data: { failures, durationMs, perfBaselineRef: "docs/M14-COMPLETENESS-LEDGER.md#perf-baselines" },
  })

  if (failures.length) {
    console.error("PIPELINE E2E FAILED:")
    for (const f of failures) console.error("  -", f)
    process.exit(7)
  }
  console.log("pipeline e2e: symbols, relationships, imports, cross-language flags all verified in brain.db")
}

main().catch(e => { console.error(e); process.exit(1) })
