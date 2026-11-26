#!/usr/bin/env node
// script/bench/manual-block.ts — render arms B/C/D/E's frozen bb manual block.
//
// WHY THIS IS GENERATED AND NOT HAND-WRITTEN.
//
// The manual block is the independent variable for arm B and half of it for C. `ARMS.md`:
// "The block is identical in B, C and D. If it differs by even one token between B and C,
// C − B stops being a context-cost measurement." A hand-maintained block drifts the moment a
// tool is renamed, and the drift is INVISIBLE -- B and C would still be byte-identical to
// each other, so the digest would happily match while the block described a bb that no
// longer exists.
//
// So the block is rendered from `docs/data/public-tools.json`, the same file the published
// tool docs are generated from. Then:
//   * one source of truth (the tool contract),
//   * the digest moves when the surface moves, which is exactly when it should,
//   * `--check` fails the wave if the committed block disagrees with the current tools.
//
// WHAT GOES IN, and what deliberately does NOT:
//   * in: the 16 tools, what each answers, whether it mutates;
//   * in: the evidence contract (read the declaration -- freshness, truncation, confidence
//     kind, declared absence), because that is the documented behaviour a user is told;
//   * in: when NOT to call bb (the fallback rule), because a block without it would push
//     the agent to use the tools where they are useless and make arm B look artificially bad;
//   * OUT: any hint about THIS benchmark, its tasks, or the golden files. A manual block that
//     leaks the task is an answer key.
//
// USAGE
//   manual-block.ts render            print the block to stdout
//   manual-block.ts write             write benchmarks/spec/manual-block.md
//   manual-block.ts digest            print the sha256 of the rendered block
//   manual-block.ts check             exit 1 if the committed block differs from a fresh render

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const TOOLS_JSON = path.join(REPO_ROOT, "docs", "data", "public-tools.json");
const OUT = path.join(REPO_ROOT, "benchmarks", "spec", "manual-block.md");

interface ToolEntry {
  name: string;
  description?: string;
  mutatesFiles?: boolean;
  mutates?: boolean;
  readOnly?: boolean;
}

function loadTools(): { version: string; tools: ToolEntry[] } {
  const d = JSON.parse(readFileSync(TOOLS_JSON, "utf8")) as {
    packageVersion?: string;
    tools?: ToolEntry[] | Record<string, ToolEntry>;
  };
  const raw = d.tools ?? [];
  const tools = Array.isArray(raw) ? raw : Object.values(raw);
  if (tools.length === 0) {
    throw new Error(
      `manual-block: ${TOOLS_JSON} lists no tools; refusing to render an empty manual block (an arm B with no tools described is not arm B)`,
    );
  }
  return { version: d.packageVersion ?? "unknown", tools };
}

/**
 * One line per tool: the name and the question it answers.
 *
 * The published MCP descriptions are contract text -- precise, and up to 60 words each. A
 * manual block that included them verbatim would be ~4,000 tokens of boilerplate, which
 * would make arm B (context cost) look enormous for a reason that is an artefact of our
 * rendering rather than of bb's design. So each line is cut to its leading clause, and a
 * short purpose phrase is used where the contract text leads with a list of features.
 */
const PURPOSE: Record<string, string> = {
  bb_search: "find a symbol, its source, or a file (exact/lexical)",
  bb_ask: "ask a natural-language question and get scored semantic matches",
  bb_health: "is the index complete, fresh and healthy",
  bb_patterns: "find dead code, orphans and anti-patterns",
  bb_security: "lexical source→sink security leads to review by hand",
  bb_visualize: "dependency overview for a whole project/file/module",
  bb_migrate: "plan a cross-language migration with ordering",
  bb_analyze: "typed analysis: callers, callees, stats, complexity, tests",
  bb_doc: "cited documentation for a symbol, file, module or API",
  bb_edit: "change source safely: preview, validate, rollback, reindex",
  bb_index: "reindex a file or directory just written or changed",
  bb_graph: "who calls this symbol, and what does it call",
  bb_impact: "what breaks if this symbol changes",
  bb_cross_language: "stored cross-language facts for one symbol",
  bb_annotate: "write a note on a symbol",
  bb_annotations: "read notes back",
};

function oneLine(t: ToolEntry): string {
  const mutates =
    t.mutatesFiles === true || t.mutates === true || t.readOnly === false;
  const purpose =
    PURPOSE[t.name] ??
    (t.description ?? "").replace(/\s+/g, " ").split(/(?<=\.)\s/)[0] ??
    "—";
  return `- \`${t.name}\` — ${purpose}.${mutates ? " [CHANGES files or the index]" : ""}`;
}

export function renderManualBlock(): string {
  const { version, tools } = loadTools();
  const reads = tools.filter(
    (t) =>
      !(t.mutatesFiles === true || t.mutates === true || t.readOnly === false),
  );
  const writes = tools.filter(
    (t) =>
      t.mutatesFiles === true || t.mutates === true || t.readOnly === false,
  );

  const lines: string[] = [];
  lines.push(
    `<!-- BENCHMARK MANUAL BLOCK — generated by script/bench/manual-block.ts -->`,
  );
  lines.push(
    `<!-- bb ${version} · ${tools.length} tools · identical in arms B, C, D and E -->`,
  );
  lines.push(
    `<!-- Do not edit by hand: change the tool surface or the renderer, then re-render. -->`,
  );
  lines.push("");
  lines.push("# Backbencher Brain (bb)");
  lines.push("");
  lines.push(
    "This repository is indexed by bb. For questions about the code, prefer these tools over",
  );
  lines.push(
    "reading files one at a time: they answer from an indexed AST of symbols, relationships,",
  );
  lines.push(
    "taint and embeddings, and they DECLARE what they do not know instead of guessing.",
  );
  lines.push("");
  lines.push(`## The ${tools.length} tools`);
  lines.push("");
  for (const t of reads) lines.push(oneLine(t));
  lines.push("");
  if (writes.length > 0) {
    lines.push("Write tools - only when a change is actually wanted:");
    lines.push("");
    for (const t of writes) lines.push(oneLine(t));
    lines.push("");
  }
  lines.push(
    'A tool name outside this list does not exist. Calling it returns "unavailable tool" and',
  );
  lines.push("teaches nothing.");
  lines.push("");
  lines.push("## Read the declaration, not just the answer");
  lines.push("");
  lines.push(
    "Every bb answer carries a provenance block. Treat it as part of the answer:",
  );
  lines.push("");
  lines.push(
    "- FRESHNESS: `fresh` / `stale` / `missing`, and whether the check read the file or",
  );
  lines.push(
    "  only its mtime. A `stale` symbol may have changed since it was indexed.",
  );
  lines.push(
    "- TRUNCATION: `returned` vs `totalMatches`, with a reason. A short page is not the",
  );
  lines.push("  whole set.");
  lines.push(
    "- CONFIDENCE KIND: a number, a declared floor, or a statement that the ranking is",
  );
  lines.push(
    "  non-discriminative. When it says the scores do not separate candidates, the order is",
  );
  lines.push("  not a relevance ranking.");
  lines.push(
    '- DECLARED ABSENCE: "no such symbol", "not indexed", "unsupported language".',
  );
  lines.push(
    "  Absence is a fact about the index, never a licence to invent an answer.",
  );
  lines.push("");
  lines.push("## When NOT to call bb");
  lines.push("");
  lines.push(
    "- A file that is new, unsaved, or outside the indexed tree: the index cannot see it.",
  );
  lines.push(
    "- A question about runtime behaviour, shell state, or anything not in the source.",
  );
  lines.push(
    "- A tool that refused, or that returned `stale` for the thing you need: fall back to",
  );
  lines.push("  reading the file directly, and say that you did.");
  lines.push(
    "- Anything the index declares it does not support for this language.",
  );
  lines.push("");
  lines.push(
    "Host tools (read, grep, glob, shell) remain available and are the right choice outside",
  );
  lines.push(
    "the index. bb is an accelerator for indexed code, not a replacement for reading it.",
  );
  lines.push("");
  return lines.join("\n");
}

export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ── cli ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? "render";
  const text = renderManualBlock();
  if (mode === "render") {
    process.stdout.write(text);
  } else if (mode === "write") {
    writeFileSync(OUT, text);
    console.log(
      `wrote ${path.relative(REPO_ROOT, OUT)} (${text.length} chars, sha256 ${digestOf(text).slice(0, 16)}…)`,
    );
  } else if (mode === "digest") {
    console.log(digestOf(text));
  } else if (mode === "check") {
    if (!existsSync(OUT)) {
      console.error(
        `manual-block: ${path.relative(REPO_ROOT, OUT)} is missing. Run \`manual-block.ts write\`.`,
      );
      process.exit(1);
    }
    const committed = readFileSync(OUT, "utf8");
    if (committed === text) {
      console.log(
        `manual-block: unchanged (sha256 ${digestOf(text).slice(0, 16)}…)`,
      );
      process.exit(0);
    }
    // Name WHICH tool made it drift, not just that it drifts.
    const a = committed.split("\n");
    const b = text.split("\n");
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        const tool =
          /`(bb_[a-z_]+)`/.exec(a[i] ?? "")?.[1] ??
          /`(bb_[a-z_]+)`/.exec(b[i] ?? "")?.[1];
        diffs.push(
          `  line ${i + 1}${tool ? ` (${tool})` : ""}: ${JSON.stringify((a[i] ?? "").slice(0, 60))} -> ${JSON.stringify((b[i] ?? "").slice(0, 60))}`,
        );
        if (diffs.length >= 6) break;
      }
    }
    console.error(
      "manual-block: DRIFT — the committed block no longer matches the tool surface.",
    );
    for (const d of diffs) console.error(d);
    console.error(
      "  The block is identical across arms, so a stale block keeps B and C byte-identical",
    );
    console.error(
      "  to each other while describing a bb that no longer exists. Re-render and re-freeze.",
    );
    process.exit(1);
  } else {
    console.error(
      `manual-block: unknown mode "${mode}" (render|write|digest|check)`,
    );
    process.exit(2);
  }
}
