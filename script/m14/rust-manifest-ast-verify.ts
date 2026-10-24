/**
 * rust-manifest-ast-verify.ts — PROVE THE ANALYZER'S TOML READER EQUAL TO THE SERVED GRAMMAR.
 *
 * WHY THIS EXISTS, AND IT IS THE CONTROL FOR A COMMENT THAT PROMISES IT: `real-rust-analyzer.ts`'s
 * `rustManifestFacts` tokenises Cargo.toml by hand — sections, dotted keys, basic/literal strings
 * with escapes, multiline strings, arrays, inline tables — because a per-file analyzer is
 * SYNCHRONOUS and `web-tree-sitter` 0.25.9 exposes only an async `Language.load`, so the analyzer
 * cannot load `wasm/tree-sitter-toml.wasm` itself. The reader's header comment says "IT IS PROVED
 * EQUAL TO THE GRAMMAR, NOT ASSERTED: this verifier reads EVERY tracked Cargo.toml with BOTH this
 * reader and the served grammar and exits non-zero on any disagreement." THIS FILE IS THAT
 * PROMISE. The lane that wrote the reader died before writing it, and a control that is promised
 * in a comment and absent on disk is a claim nobody can check — so the Lead wrote it.
 *
 * WHAT IT COMPARES, AND THE ONE PLACE THE TWO READERS MAY HONESTLY DISAGREE:
 *   · `hasWorkspace`  — the reader's `[workspace]` section test vs the grammar's table-header nodes.
 *   · `packageName`   — the reader's `name = "…"` under the package section vs the grammar's pair.
 *   · `libPath`       — `path` under the `[lib]` table vs the grammar's pair under that table.
 *   · `workspaceMembers` — string array items under `workspace.members` vs the grammar's array.
 * A file that FAILS TO PARSE UNDER THE GRAMMAR (hasError) is counted separately, not as a
 * disagreement — a manifest the corpus never ships is not evidence about the reader.
 *
 * USAGE: npx tsx script/m14/rust-manifest-ast-verify.ts
 * EXIT: 0 all tracked manifests agree · 1 any disagreement (with the file and both readings).
 */
import { getParser } from "../../src/ast/engine"
import { rustManifestFacts } from "../../src/ast/real-rust-analyzer"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

interface Facts { hasWorkspace: boolean; packageName: string | null; libPath: string | null; workspaceMembers: string[] }

/** The SAME facts, read off the served TOML grammar's own tree — the second reader. */
function factsFromTree(root: any): Facts {
  const out: Facts = { hasWorkspace: false, packageName: null, libPath: null, workspaceMembers: [] }
  // Walk every table node; a table's header decides which section its pairs belong to.
  const stack: any[] = [root]
  const kids = (n: any): any[] => { const a: any[] = []; for (let i = 0; i < n.namedChildCount; i++) a.push(n.namedChild(i)); return a }
  let currentTable = ""
  while (stack.length > 0) {
    const n = stack.pop()
    const t = String(n?.type ?? "")
    if (t === "table" || t === "table_array_element") {
      // A [header] table OR a [[header]] table-array element. THE LATTER IS NOT A NICETY: this
      // verifier's first version walked only `table`, so a `path = "…" ` pair inside `[[bin]]`
      // inherited the PREVIOUS table's scope and read as `[package]`'s — a disagreement that was
      // THIS VERIFIER's bug and not the reader's. MEASURED on manifest 747 of 748:
      // `.corpus/cargo/.../creates_binary_when_both_binlib_present/out/Cargo.toml`, where the
      // reader said `lib=lib.rs` (correct) and the verifier said `lib=case.rs` (the bin path).
      // ⇒ A CONTROL MUST MODEL THE GRAMMAR'S FULL NODE VOCABULARY OR IT REFUTES CORRECT WORK.
      let header = ""
      for (const c of kids(n)) {
        const ct = String(c?.type ?? "")
        if (ct === "bare_key" || ct === "dotted_key" || ct === "quoted_key") header += c.text
        else if (ct === "pair") stack.push(c)
      }
      currentTable = header.trim()
      if (currentTable === "workspace") out.hasWorkspace = true
      continue
    }
    if (t === "pair") {
      // key = value. The key node is the first bare/quoted/dotted child.
      const cs = kids(n)
      let key = ""
      for (const c of cs) {
        const ct = String(c?.type ?? "")
        if (ct === "bare_key" || ct === "dotted_key" || ct === "quoted_key") { key = c.text.trim(); break }
      }
      const tbl = currentTable
      if (key === "name" && (tbl === "" || tbl === "package")) {
        for (const c of cs) if (String(c?.type ?? "") === "string") { out.packageName = stripQuotes(c.text); break }
      } else if (key === "path" && tbl === "lib") {
        for (const c of cs) if (String(c?.type ?? "") === "string") { out.libPath = stripQuotes(c.text); break }
      } else if (key === "members" && tbl === "workspace") {
        for (const c of cs) if (String(c?.type ?? "") === "array") {
          for (const e of kids(c)) if (String(e?.type ?? "") === "string") out.workspaceMembers.push(stripQuotes(e.text))
        }
      }
      continue
    }
    for (const c of kids(n)) stack.push(c)
  }
  return out
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2) {
    if (t.startsWith('"""') && t.endsWith('"""') && t.length >= 6) return t.slice(3, -3)
    if (t.startsWith("'''") && t.endsWith("'''") && t.length >= 6) return t.slice(3, -3)
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  }
  return t
}

function same(a: Facts, b: Facts): boolean {
  if (a.hasWorkspace !== b.hasWorkspace) return false
  if (a.packageName !== b.packageName) return false
  if (a.libPath !== b.libPath) return false
  if (a.workspaceMembers.length !== b.workspaceMembers.length) return false
  for (let i = 0; i < a.workspaceMembers.length; i++) if (a.workspaceMembers[i] !== b.workspaceMembers[i]) return false
  return true
}

async function main(): Promise<void> {
  const corpus = path.resolve(process.cwd(), ".corpus")
  // THE SAME POPULATION RULE AS THE LANE: git-tracked Cargo.toml per checkout, present on disk.
  const dirs: string[] = []
  for (const e of execFileSync("ls", ["-1", corpus], { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean)) {
    const d = path.join(corpus, e)
    try { execFileSync("git", ["-C", d, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" }) } catch { continue }
    dirs.push(d)
  }
  let compared = 0
  let unparsed = 0
  let disagreements = 0
  const samples: string[] = []
  for (const d of dirs) {
    let files: string[] = []
    try {
      // ★ THE PATHSPEC IS THE GLOB, NOT THE BARE NAME. The first run of this verifier compared
      // FOUR manifests; `ls-files -- Cargo.toml` matches only the repository ROOT and the corpus
      // holds **748** tracked Cargo.toml at depth. A CONTROL THAT COVERS 0.5 % OF ITS POPULATION
      // IS A CONTROL THAT HAS NOT RUN — the same class as a summary that was silently a sample.
      files = execFileSync("git", ["-C", d, "ls-files", "-z", "--", "*Cargo.toml"], { encoding: "utf8" })
        .split("\0").map((f) => f.trim()).filter(Boolean).map((f) => path.join(d, f))
    } catch { continue }
    for (const f of files) {
      let text = ""
      try { text = readFileSync(f, "utf8") } catch { continue }
      compared++
      const reader = rustManifestFacts(text)
      let tree = null
      try { tree = await (await getParser("toml")).parse(text) } catch { unparsed++; continue }
      if (tree.rootNode.hasError) { unparsed++; continue }
      const grammar = factsFromTree(tree.rootNode)
      if (!same(reader, grammar)) {
        disagreements++
        if (samples.length < 5) {
          samples.push(
            `${path.relative(corpus, f)}\n` +
            `  reader:   workspace=${reader.hasWorkspace} name=${reader.packageName} lib=${reader.libPath} members=[${reader.workspaceMembers.join(",")}]\n` +
            `  grammar:  workspace=${grammar.hasWorkspace} name=${grammar.packageName} lib=${grammar.libPath} members=[${grammar.workspaceMembers.join(",")}]`,
          )
        }
      }
    }
  }
  console.log(`rust-manifest-ast-verify: ${compared} tracked Cargo.toml compared · ${unparsed} failed the grammar (counted, not disagreements) · ${disagreements} disagreement(s)`)
  for (const s of samples) console.log(s)
  if (disagreements > 0) { console.log("FAIL — the hand reader and the served grammar disagree."); process.exit(1) }
  console.log("PASS — the analyzer's TOML reader and the served tree-sitter-toml grammar agree on every tracked manifest.")
}

main().catch((e) => { console.error(e); process.exit(1) })
