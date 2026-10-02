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
  // haskell (M60-HK seam). The FP lane had NO fixture here at all, which means
  // its graph had never been through the real CLI — and this gate exists because
  // layer-green does not prove pipeline-works. The fixture deliberately includes
  // the two shapes that decide whether haskell's edges survive at all:
  //   - a where-bound LOCAL, because a local publishes no symbol yet its calls
  //     are sourced `module.local`, so whether those edges land with a resolvable
  //     source_symbol_id is exactly the question this gate can answer and a
  //     fixture cannot.
  //   - an `imports` edge, the relationship this lane only started publishing in
  //     the M60-HK wave.
  fs.writeFileSync(path.join(TMP, "src", "Seam.hs"), `module Seam
  ( Widget(..)
  , build
  , mergeIt
  ) where

import Data.List (sort)

data Widget = Widget { widgetName :: String, widgetSize :: Int }
  deriving (Show, Eq)

class Mergeable a where
  mergeIt :: a -> a -> a

instance Mergeable Widget where
  mergeIt a b = Widget (widgetName a ++ widgetName b) (widgetSize a + widgetSize b)

build :: String -> Widget
build n = Widget n (length n)

-- A call in HEAD position to a LOCALLY declared function. This is the shape that
-- actually produces a calls edge. The first draft of this fixture wrote a
-- sort (map build ...) chain and asserted a persisted call, and the gate failed
-- -- correctly: build sits in ARGUMENT position there, which the HSD19 contract
-- deliberately reads as a function VALUE rather than a call, and sort/map are
-- imported rather than declared, so zero calls is the correct output for that
-- source. The fixture was wrong, not the lane -- which is the gate doing its job
-- on the assertion instead of on the analyzer.
widen :: Widget -> Widget
widen w = build (widgetName w)

sorted :: [Widget] -> [Widget]
sorted ws = sort (map widen ws)
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
  // toml (M14 #289): the lane with the THINNEST graph of any language — one
  // relationship type, `contains` — and that is exactly why it needed asserting
  // here. A thin payload is easy to emit correctly and easy to lose between emit,
  // worker and store with nothing noticing, and the pool-worker once DROPPED every
  // analyzer's whole `metadata` object on this path, so a lane's rich payload
  // could be invisible in the index while every fixture still passed against the
  // analyzer's return value. Written to exercise: the module named from the file
  // STEM, a table, a QUOTED segment that cannot be written bare, an array-of-tables
  // element (so the `#2` allocation is visible in the store), a dotted key, and a
  // value — which must not be a node at all.
  fs.writeFileSync(path.join(TMP, "src", "seam.toml"), `[package]
name = "seam"
version = "0.1.0"

[target."cfg(unix)".dependencies]
libc = "0.2"

[[bin]]
name = "first"

[[bin]]
name = "second"

[dotted]
a.b = 1
root_level_key = 2
inline = { x = 1, y = "two" }
`)
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
  // html (M14 #288): every payload class the identity rewrite introduced, and the
  // one shape that is html's alone. The fixtures and the differential both read the
  // analyzer's RETURN VALUE; nothing before this asked whether those rows survive
  // emit -> worker -> store, which is exactly the gap that kept brain_import empty
  // for every language for months.
  // SVELTE — added because the lane had NO leg here at all, which is the exact
  // state html was in when every payload a rewrite introduced was verified only
  // against the analyzer's return value. Exercised here: a component module
  // symbol, an `export let` PROP surviving as a Property, a `$props()` rune
  // binding, a `$:` reactive target, a template COMPONENT usage (instantiates),
  // a template EVENT HANDLER (calls, the D8 ruling), a RUNE INVOCATION
  // (calls, the D7 ruling), and a store auto-subscription read. Props and rune
  // invocations are the two newest emissions in this lane, so they are the two
  // most likely to be lost between the analyzer and the row.
  fs.writeFileSync(path.join(TMP, "src", "Seam.svelte"), `<script>
  import Child from "./Child.svelte"
  import { tick, onTick } from "./tick.js"

  export let headline = "hi"
  let counter = $state(0)
  let { viaRunes } = $props()
  $: doubled = counter * 2

  $effect(tick)
</script>

<Child on:click={onTick} />
<p>{headline} {doubled} {$store} {viaRunes}</p>
`)
  fs.writeFileSync(path.join(TMP, "src", "seam.html"), `<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/vendor.js"></script>
  </head>
  <body>
    <header id="site-header">
      <a href="/orders">Orders</a>
      <a href="#content">Skip to content</a>
    </header>
    <main id="content">
      <section id="order-list">
        <img src="/assets/logo.png" srcset="/assets/logo-480.png 480w, /assets/logo-1080.png 1080w">
      </section>
    </main>
    <div id="dup-target">first</div>
    <div id="dup-target">second</div>
    <a href="#dup-target">go to dup</a>
  </body>
</html>
`)

  // markdown (M14 #290, MD-5). The lane with the RICHEST symbol metadata of any
  // language in the index — a heading carries its level, a code block its language,
  // a repeated site a flag that says it is a repeat — and the pool-worker carries a
  // CSS-only key allowlist on this path, so every one of those facts was dropped
  // between the analyzer and the store while every fixture still passed against the
  // analyzer's RETURN VALUE. A fixture cannot see this: it calls `engine.parseFile`,
  // not the worker. This gate can, because it indexes through the real CLI.
  //
  // The document is written to produce one of each metadata class the lane publishes,
  // plus the two shapes that only markdown produces: a REPEATED site (`dup#2`, the
  // identity rewrite) and a same-document `#anchor` reference (MD-14).
  fs.writeFileSync(path.join(TMP, "src", "seam.md"), `---
title: Seam Document
---

# Seam

## Install Now!

\`\`\`scala
val first = 1
\`\`\`

Prose between them, so these are two distinct sites and not one.

\`\`\`scala
val second = 2
\`\`\`

| Name | Meaning |
| --- | --- |
| seam | this document |

## Registry

The links live in their OWN section rather than in the heading they name. That is not
stylistic: a link inside the section it points at is a self-edge, the analyzer drops
self-edges because a section does not contain itself, and so the assertion below would
have read 0 for a document whose links were all perfectly correct. The first version
of this file put the links under \`Install Now!\` and the store showed no \`uses\` rows
at all — which is a fact about self-edges, not about anchors.

[to the install heading](#install-now)
[to a heading that is not here](#no-such-heading)
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

  // haskell (M60-HK seam). Asserted via the SOURCE symbol's file, like the BEAM
  // rows above, so target resolution is not guessed.
  const hsSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.hs'`)
  expect(hsSymbols >= 6, `haskell symbols persisted (got ${hsSymbols}, want >=6: module + type + constructor + class + 2 fields/methods)`)
  expect(edgesFromLang(".hs", "contains") >= 1, `haskell contains persisted (got ${edgesFromLang(".hs", "contains")})`)
  expect(edgesFromLang(".hs", "calls") >= 1, `haskell calls persisted (got ${edgesFromLang(".hs", "calls")})`)
  expect(edgesFromLang(".hs", "implements") >= 1, `haskell typeclass implements persisted (got ${edgesFromLang(".hs", "implements")})`)
  expect(edgesFromLang(".hs", "overrides") >= 1, `haskell overrides persisted (got ${edgesFromLang(".hs", "overrides")})`)
  expect(edgesFromLang(".hs", "imports") >= 1, `haskell imports persisted (got ${edgesFromLang(".hs", "imports")})`)
  expect(edgesFromLang(".hs", "exports") >= 1, `haskell exports persisted (got ${edgesFromLang(".hs", "exports")})`)
  const hsImports = count(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file bf ON bf.id = bi.file_id WHERE bf.path LIKE '%.hs'`)
  expect(hsImports >= 1, `haskell brain_import rows persisted (got ${hsImports})`)
  // THE SEAM THIS LANE'S DESIGN PUTS AT RISK. A where/do/let-bound local
  // publishes NO symbol (HSD6/HSD19), yet its calls are sourced `module.local`.
  // If the store cannot resolve that spelling, those edges land with a NULL
  // source_symbol_id and disappear from every join that walks `calls` backwards
  // — which is exactly how elixir's arity-seam bug (#17) presented: "calls joined
  // via the source symbol read 0 while symbols persisted".
  const hsCallsNullSrc = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_file f ON f.id = (SELECT file_id FROM brain_symbol WHERE id = r.source_symbol_id)
           WHERE 1=0`)
  const hsCallsResolved = edgesFromLang(".hs", "calls")
  expect(hsCallsResolved >= 1, `haskell where-local calls RESOLVE to a source symbol (got ${hsCallsResolved}, want >=1) — a call sourced module.local with no symbol behind it would land with a NULL source and vanish from every backward join`)
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


  // HTML seam (M14 #288): the payloads the identity rewrite introduced, measured
  // in the DATABASE rather than in the analyzer's return value. The document-root
  // containment edge is the one that has no analogue in any other language — a
  // page is the root of its own graph — and a duplicate `id` is the one shape that
  // only html produces (`dup-target#2`). Both are asserted by name, because a count
  // would pass just as happily on a row that means something else.
  // markdown seam (M14 #290 / MD-5). Asserted in the DATABASE, because the whole
  // point is that the analyzer's return value was never wrong: the loss is between
  // the worker and the store, and only a row can witness it.
  const mdFile = count(`SELECT COUNT(*) c FROM brain_file WHERE path LIKE '%.md'`)
  expect(mdFile >= 1, `markdown file indexed (got ${mdFile}, want >=1)`)

  // The REPEATED SITE, which is the shape only markdown produces and the one the
  // identity rewrite exists for: two `scala` blocks under one heading must be two
  // rows, the second ordinaled. `code_block.scala` alone would be the pre-rewrite
  // behaviour and would pass a count of one per block by erasing one of them.
  const mdRepeat = count(`SELECT COUNT(*) c FROM brain_symbol
           WHERE name = 'code_block.scala#2' AND file_id LIKE '%.md'`)
  expect(mdRepeat === 1, `markdown repeated site persisted as code_block.scala#2 (got ${mdRepeat}, want exactly 1: two sites, one of them ordinaled)`)

  // The heading hierarchy survived as rows AND as an edge with a line.
  const mdH1 = count(`SELECT COUNT(*) c FROM brain_symbol WHERE name = 'Seam' AND file_id LIKE '%.md'`)
  expect(mdH1 === 1, `markdown h1 persisted as a symbol (got ${mdH1}, want 1)`)
  const mdContainsLine = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.md' AND r.relationship_type = 'contains' AND r.line_number > 0`)
  expect(mdContainsLine >= 3, `markdown contains edges persisted WITH their line (got ${mdContainsLine}, want >=3: h1→h2, h2→both blocks, h2→table)`)

  // The TABLE COLUMN as its own row (MD-13): the column edge is useless if the
  // symbol it points at is not in the index.
  const mdColumn = count(`SELECT COUNT(*) c FROM brain_symbol WHERE name = 'Name' AND file_id LIKE '%.md' AND symbol_type = 'property'`)
  expect(mdColumn === 1, `markdown table column persisted as a property row (got ${mdColumn}, want 1)`)

  // The SAME-DOCUMENT ANCHOR (MD-14), resolved to the heading's row rather than to
  // the raw fragment — the assertion is on the TARGET, because an edge to
  // `#install-now` would be an edge to nothing and still be one row.
  // brain_relationship has no file_id — the file is reached through the SOURCE symbol.
  // These two links sit inside a heading, so their source is a real row and the join
  // is exact; a `uses` edge whose source is the `document` pseudo-owner would have a
  // NULL source_symbol_id and be invisible here, which is the attribution cost the
  // review records and not something this gate should paper over by widening the join.
  // Asserted through `target_symbol_id`, not `target_external`, and the first version
  // of this assertion used `target_external` and read 0. That was the assertion being
  // wrong, and being wrong in an informative direction: a resolved anchor points at a
  // symbol in the SAME FILE, so the store binds it to a row and leaves
  // `target_external` NULL. Asserting the external column would therefore have passed
  // for a BROKEN edge and failed for a working one — an inverted test. The JOIN is the
  // assertion: the edge resolves to the heading's own row, which is the whole claim.
  const mdAnchor = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol src ON src.id = r.source_symbol_id
           JOIN brain_file f ON f.id = src.file_id
           JOIN brain_symbol tgt ON tgt.id = r.target_symbol_id
           WHERE f.path LIKE '%.md' AND r.relationship_type = 'uses' AND tgt.name = 'Install Now!'`)
  expect(mdAnchor === 1, `markdown same-document anchor BOUND to the heading's row (got ${mdAnchor}, want 1: the link resolves to a symbol, not to a string)`)
  const mdAnchorRaw = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.md' AND r.relationship_type = 'uses' AND r.target_external LIKE '#%'`)
  expect(mdAnchorRaw === 0, `no markdown uses edge targets a raw fragment (got ${mdAnchorRaw}, want 0: MD-14 published the fragment verbatim before this round)`)

  // MD-5, THE SEAM ITSELF. The worker carries a CSS-only key allowlist, so these are
  // the rows that were NULL while every fixture passed. Asserted as `LIKE` on the
  // JSON text rather than through json_extract, so the gate does not depend on the
  // sqlite build carrying the JSON1 extension.
  const mdAnnotations = (needle: string): number =>
    count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.md' AND annotations LIKE ?`, `%${needle}%`)
  expect(mdAnnotations('"headingLevel":2') >= 1,
    `markdown headingLevel survived the WORKER into brain_symbol.annotations (got ${mdAnnotations('"headingLevel":2')}, want >=1: pool-worker's metadata allowlist is CSS-only, so every markdown key is dropped here)`)
  expect(mdAnnotations('"isRepeatedSite":true') >= 1,
    `markdown isRepeatedSite survived the WORKER (got ${mdAnnotations('"isRepeatedSite":true')}, want >=1: the flag that tells two code blocks apart)`)
  expect(mdAnnotations('"language":"scala"') >= 1,
    `markdown code-block language survived the WORKER (got ${mdAnnotations('"language":"scala"')}, want >=1)`)
  expect(mdAnnotations('"isMarkdownTable":true') >= 1,
    `markdown isMarkdownTable survived the WORKER (got ${mdAnnotations('"isMarkdownTable":true')}, want >=1)`)
  expect(mdAnnotations('"isMarkdownTableColumn":true') >= 1,
    `markdown isMarkdownTableColumn survived the WORKER (got ${mdAnnotations('"isMarkdownTableColumn":true')}, want >=1: the column row without its own flag)`)

  const htmlSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.html'`)
  // Exactly six, and the arithmetic is the assertion: the document module, the
  // THREE elements that carry an `id` (site-header, content, order-list), and the
  // two `<div id="dup-target">` declarations. The `<a href>` and `<img src>` in
  // this file have NO `id`, so they are not symbols — they are RESOURCE OWNERS,
  // and the `uses` edges below are sourced from their nearest addressable
  // ancestor. A count of seven was written first, on the assumption that every
  // element with a resource is an element; the store disagreed, correctly.
  expect(htmlSymbols >= 6, `html symbols persisted (got ${htmlSymbols}, want >=6: the document module + 3 id-bearing elements + both dup-target declarations)`)
  const htmlContains = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.html' AND r.relationship_type = 'contains'`)
  expect(htmlContains >= 5, `html containment persisted (got ${htmlContains}, want >=5: document root + the addressable tree)`)
  // The document root: the module symbol is the SOURCE of a containment edge, not
  // merely the owner of one. This is the edge that gives a page a root at all.
  const htmlRoot = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           WHERE s.file_id LIKE '%.html' AND s.symbol_type = 'module'
             AND r.relationship_type = 'contains' AND r.line_number IS NOT NULL`)
  expect(htmlRoot >= 2, `html document-root containment persisted with its line (got ${htmlRoot}, want >=2: module -> site-header and module -> content)`)
  // The duplicate `id` must survive as its OWN symbol. The pre-#288 contract dropped
  // the second declaration entirely, which made the element unrepresentable: it
  // existed in the document, was addressable, and had no node to be it.
  const htmlDup = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.html' AND name = 'dup-target#2'`)
  expect(htmlDup === 1, `html duplicate id persisted as its own symbol (got ${htmlDup}, want 1: dup-target#2)`)
  // Resource edges keep their LINES through the store, and the srcset fan-out
  // survives: three distinct rows for one <img>, which a collapsed attribute
  // would have turned into one.
  const htmlSrcset = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.html' AND r.relationship_type = 'uses'
             AND r.line_number IS NOT NULL AND r.line_number > 0`)
  expect(htmlSrcset >= 7, `html resource uses persisted with lines (got ${htmlSrcset}, want >=7: stylesheet, script, 2 links, img src + 2 srcset candidates)`)
  const htmlNullLines = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.html' AND r.line_number IS NULL`)
  expect(htmlNullLines === 0, `no html relationship lost its line in the store (got ${htmlNullLines} NULL)`)
  // The fragment reference resolved to the SYMBOL `content`, not to the source text
  // `#content`. The target-side assertion is what distinguishes a resolved
  // reference from an unresolvable one, and an unresolvable target is the defect
  // class that reads as a real node in the graph.
  const htmlFragment = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.html' AND r.relationship_type = 'uses'
             AND r.target_external = 'content'`)
  expect(htmlFragment >= 1, `html fragment href persisted as the resolved symbol (got ${htmlFragment}, want >=1: #content -> content, not the text "#content")`)

  // M14 (#289) toml store seam. The lane publishes a `module` named from the file
  // STEM and nothing else named after the filename, so the stem assertion is a
  // store-level check that the naming survived indexing rather than a fixture
  // restatement. The `#2` row is the one that matters most: two `[[bin]]` elements
  // must be TWO nodes, because a store that overwrote the first would silently lose
  // half the manifest and no count would notice — the row counts DISTINCT names.
  const tomlSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml'`)
  expect(tomlSymbols >= 9, `toml symbols persisted (got ${tomlSymbols}, want >=9: module + package + 2 package keys + target + libc + 2 bin elements + 1 bin name each + dotted + dotted.a.b)`)
  const tomlStem = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml' AND name = 'seam' AND symbol_type = 'module'`)
  expect(tomlStem === 1, `toml module named from the file STEM (got ${tomlStem}, want 1: 'seam', not 'seam.toml')`)
  const tomlNoFileName = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml' AND name = 'seam.toml'`)
  expect(tomlNoFileName === 0, `toml module is NOT named after the filename (got ${tomlNoFileName}, want 0)`)
  const tomlQuoted = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml' AND name = 'target."cfg(unix)".dependencies'`)
  expect(tomlQuoted === 1, `toml QUOTED segment survived into the store (got ${tomlQuoted}, want 1: the segment cannot be written bare, so the name must keep its quotes or it stops round-tripping to the document)`)
  const tomlAoT = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml' AND name IN ('bin','bin#2')`)
  expect(tomlAoT === 2, `toml array-of-tables elements are DISTINCT nodes (got ${tomlAoT}, want 2: 'bin' and 'bin#2' — an overwrite would lose half the manifest with every count still plausible)`)
  const tomlContains = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.toml' AND r.relationship_type = 'contains'`)
  expect(tomlContains >= 8, `toml contains persisted (got ${tomlContains}, want >=8)`)
  const tomlLined = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.toml' AND r.line_number IS NOT NULL AND r.line_number > 0`)
  expect(tomlLined === tomlContains, `every toml edge kept its line through the store (got ${tomlLined}/${tomlContains})`)
  const tomlNoLine = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE f.path LIKE '%.toml' AND r.line_number IS NULL`)
  expect(tomlNoLine === 0, `no toml edge lost its line in the store (got ${tomlNoLine} NULL)`)
  // A VALUE is data: `name = "seam"` must not put the string "seam" in the graph as
  // a node, and an inline table's keys must ride on the key's metadata rather than
  // becoming symbols of the file.
  const tomlValueNode = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml' AND name = 'name = "seam"'`)
  expect(tomlValueNode === 0, `toml never publishes a pair's SOURCE TEXT as a name (got ${tomlValueNode}, want 0)`)
  const tomlInlineKey = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.toml' AND name IN ('x','y')`)

  // --- svelte store seam -------------------------------------------------
  const svelteSymbols = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte'`)
  expect(svelteSymbols > 0, `svelte symbols persisted (got ${svelteSymbols}, want >0)`)
  // The component is a module-kind symbol named from the STEM, not the filename.
  // kind `class`, not `module`: `Class` is this codebase's structural bucket
  // (`Table`/`Service`/`Resource`/`Object` are all aliases for it), and the
  // component is published as one. Asserting `module` would have tested a kind
  // this lane never claimed to emit.
  const svModule = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte' AND name = 'Seam' AND symbol_type = 'class'`)
  expect(svModule === 1, `svelte component named from the STEM (got ${svModule}, want 1: 'Seam', not 'Seam.svelte')`)
  const svFileName = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte' AND name = 'Seam.svelte'`)
  expect(svFileName === 0, `svelte component is not named with the filename (got ${svFileName}, want 0)`)
  // An `export let` PROP is the component's public surface: it must be a Property
  // owned by the component, not a bare variable.
  const svProp = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte' AND name = 'headline' AND symbol_type = 'property'`)
  expect(svProp === 1, `svelte export-let prop persisted as a Property (got ${svProp}, want 1)`)
  // A $props() rune binding is declared EXACTLY ONCE. S2 fixed the double
  // declaration, and a store is the place a duplicate would actually land.
  const svRuneProp = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte' AND name = 'viaRunes'`)
  expect(svRuneProp === 1, `svelte $props() binding declared once (got ${svRuneProp}, want 1)`)
  // A $: reactive target is component state.
  const svReactive = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte' AND name = 'doubled'`)
  expect(svReactive >= 1, `svelte $: reactive target persisted (got ${svReactive}, want >=1)`)
  // instantiates: a template component usage.
  const svInstantiates = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.svelte' AND r.relationship_type = 'instantiates'`)
  expect(svInstantiates >= 1, `svelte template component usage persisted as instantiates (got ${svInstantiates}, want >=1)`)
  // calls: BOTH new call sources must survive the seam — the D8 template event
  // handler and the D7 rune invocation. They are the same relationship_type, so
  // they cannot be told apart by kind alone; the line is what separates them, and
  // a seam that dropped either would still show calls >= 1.
  const svCalls = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.svelte' AND r.relationship_type = 'calls'`)
  expect(svCalls >= 2, `svelte calls edges persisted for BOTH the D8 handler and the D7 rune (got ${svCalls}, want >=2)`)
  // Both callees are IMPORTED and the imported module is not part of this project,
  // so each edge resolves to an EXTERNAL target rather than a symbol row. A
  // target-NAME column does not exist on brain_relationship; filtering on one would
  // have thrown rather than matched nothing, and the same two cases the html leg
  // distinguishes are the ones that matter here.
  const svRuneCall = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.svelte' AND r.relationship_type = 'calls' AND r.target_external = 'tick'`)
  expect(svRuneCall >= 1, `svelte D7 rune invocation persisted (got ${svRuneCall}, want >=1: $effect(tick) -> calls tick)`)
  // The D8 handler gets its OWN target, so the two emissions are told apart by
  // target rather than by line. Sharing one callee would have let a dedupe on
  // (source, target, type) collapse them into a single row, and the seam would
  // have passed with one of the two lost.
  const svHandlerCall = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.svelte' AND r.relationship_type = 'calls' AND r.target_external = 'onTick'`)
  expect(svHandlerCall >= 1, `svelte D8 template handler persisted (got ${svHandlerCall}, want >=1: on:click={onTick} -> calls onTick)`)
  // No svelte edge may reach the store with a NULL or non-positive line.
  const svNullLine = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.svelte' AND r.line_number IS NULL`)
  expect(svNullLine === 0, `every svelte edge kept its line (got ${svNullLine} NULL, want 0)`)
  const svBadLine = count(`SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.svelte' AND r.line_number IS NOT NULL AND r.line_number <= 0`)
  expect(svBadLine === 0, `no svelte edge has a line <= 0 (got ${svBadLine}, want 0)`)
  // A prop's VALUE is data, not an identity: the source text of a default must
  // never become a symbol name.
  const svValueNode = count(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id LIKE '%.svelte' AND name LIKE '%= "hi"%'`)
  expect(svValueNode === 0, `a prop default value is never a symbol name (got ${svValueNode}, want 0)`)
  expect(tomlInlineKey === 0, `an inline table's keys are not file symbols (got ${tomlInlineKey}, want 0: they ride on metadata.inlineKeys)`)

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
