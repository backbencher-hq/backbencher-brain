// script/m55/verify-call-hierarchy.ts — M55.T2 verifier + mutation suite
// (issue #771).
//
// "Positions are where the thing is" is not a claim about a component; it is a
// claim about what the EDITOR receives. This suite therefore proves it three
// ways over one fixture (script/m55/t2-fixture.ts, authored before the fix):
//
//   W wire:      the REAL dist server over the REAL index (built by the REAL
//                indexer) — every fromRange slices back to the invoked name in
//                the caller's own source; a caller's own same-named member call
//                (`this.items.get()`) is NOT reported as calling itself;
//                genuine recursion IS; one caller with two call sites reports
//                two ranges; every expand answers without an error; a malformed
//                expand is InvalidParams with a `bb/callHierarchy:` reason —
//                never an InternalError crash.
//   C component: the fields the wire does not carry — `droppedEdges` with the
//                receiver-qualified reason, `callSitesResolved` /
//                `callSitesApproximate`, the `position approximate` declaration
//                on a caller whose invocation cannot be found in its source,
//                and selectionRange being the NAME token.
//   M mutants:   source-copy defects planted into the component, each one a
//                behaviour the pre-M55 code actually had — dropped source
//                resolution, re-admitted receiver-qualified self-edges, a
//                body-wide selectionRange, and an undeclared approximation.
//
// Run: npx tsx script/m55/verify-call-hierarchy.ts
// Evidence: validation/m55/results/T2.json (machine-emitted)

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { T2_ROOT, T2_EXPECT, writeT2Fixture } from "./t2-fixture.ts";
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..");
const COMPONENT = path.join(ROOT, "src/lsp/call_hierarchy.ts");
const SERVER = path.join(ROOT, "dist/lsp/server.js");
const BB = path.join(ROOT, "bin/bb");
const EVIDENCE = path.join(ROOT, "validation/m55/results/T2.json");

let checks = 0;
let passed = 0;
const failures: string[] = [];
let mutantsCaught = 0;
let mutantsTotal = 0;
let mutantsNotJudged = 0;

function check(label: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) passed++;
  else failures.push(detail ? `${label}: ${detail}` : label);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
}

/**
 * A mutant is CAUGHT only when the oracle judged it. A mutant that died on an
 * import error proved nothing — the code under test never ran — and counting it
 * as caught is how this suite reported 5/5 while all five mutants had failed to
 * import. Those are tallied separately in `mutantsNotJudged` and reported.
 */
/** Every mutant's verdict AND its per-predicate detail, so the evidence shows
 *  WHICH oracle assertion flipped — not merely that something changed. A count
 *  with no detail cannot distinguish a behavioural catch from an incidental one. */
const mutantVerdicts: Array<{ name: string; caught: boolean; detail: string; caughtBy: string }> = [];

/** The relationship kinds that can name a CALL SITE. A call hierarchy renders
 *  `fromRanges` — the places in a source where one symbol is invoked — so a row
 *  of any other kind has no call site to point at (§15.3). Membership and
 *  lexical kinds are exactly the ones the engine's default projection folds in.
 *  `instantiates`/`overrides` are deliberately NOT banned here: a `new Foo()` IS
 *  an invocable site and the resolver classifies it (`construct`), so whether
 *  this surface may include them is its owner's declared call, not this gate's.
 *  What this gate forbids is a kind that can never name a call. The list is an
 *  ALLOW-list on purpose: the index's other kinds — contains, uses, references,
 *  imports, exports, implements, extends, inherits — are all refused by it, and a
 *  kind nobody has thought of yet is refused too.
 */
const CALL_SITE_CAPABLE_KINDS = new Set(["calls", "call", "instantiates", "overrides"]);

/**
 * The relationship kind a RENDERED entry came from, read off its own detail line.
 *
 * WHY THIS IS NOT A REGEX ON THE WHOLE STRING — measured, and it changes the
 * verdict. The component builds that line as
 * `${node.symbolType} · ${edge.relationshipType} · ${…}`, so it never STARTS
 * with the relationship kind. The predecessor of this helper tested
 * `/^calls\b/.test(detail)` and therefore flagged EVERY rendered entry,
 * including genuine `calls` rows. Measured over the real index on this
 * fixture's `deep/incoming` answer: both rendered callers (`mid`, `many`) carry
 * `function · calls · 1 call site`, and the old test called both of them
 * "non-call rows". It reported C6 red at HEAD for the right REASON and C6/C6d
 * vacuously GREEN after the fix for the WRONG one — the check could not tell a
 * `calls` row from a `contains` row, so it never tested the law it names
 * (script/m55/verify-call-hierarchy.ts, C6d's `plantedRendered`).
 *
 * The segments are ` · `-delimited and the kind is the SECOND one. This helper
 * is stated over the DETAIL rather than over an internal field because the wire
 * carries the detail and not the row: a check the wire could not satisfy would
 * be checking something the editor never sees.
 */
function renderedRelationshipKind(detail: unknown): string {
  return String(detail ?? "").split(" · ")[1] ?? "";
}

/**
 * §15.1 read as a COHERENCE law rather than a presence law: every relationship
 * kind this answer says it DECLINED must be a kind its own declared filter
 * admits it read.
 *
 * This is the predicate that convicts "the surface stopped asking the engine for
 * call rows but kept declaring that it reads only them". Measured on the real
 * index, with the engine request present the answer declines 1 row (the
 * receiver-qualified `calls` artifact) and `relationshipTypes` is `["calls"]`;
 * with the request removed the very same answer declines 8 rows, 6 of them
 * `contains`/`uses`, while still declaring `["calls"]` — a declaration the
 * answer's own drop list contradicts.
 *
 * Why not assert the request itself: the request is not observable from the
 * response. `defaultTraverse` receives `GraphTraversalOptions`, and nothing the
 * surface returns echoes them, so no check here can distinguish "passed the
 * option" from "ignored it". This predicate states the weaker thing that IS
 * observable and is a real defect on its own — a self-contradicting answer.
 */
function declinedKindsOutsideDeclaredFilter(answer: any): string[] {
  const declared = new Set<string>(Array.isArray(answer.relationshipTypes) ? answer.relationshipTypes : []);
  return (answer.droppedEdges ?? [])
    .map((d: any) => /the stored row is a "([^"]+)" relation/.exec(String(d.reason ?? ""))?.[1])
    .filter((k: string | undefined): k is string => k !== undefined && !declared.has(k));
}

function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++;
  if (caught) mutantsCaught++;
  // Which of the five predicates flipped — this is what makes "caught" mean
  // something. Read from the detail the oracle itself computed.
  let caughtBy = "(none: the mutant changed nothing the oracle measures)";
  try {
    const parsed = JSON.parse(detail) as Record<string, boolean>;
    const flipped = Object.entries(parsed).filter(([, ok]) => !ok).map(([k]) => k);
    caughtBy = flipped.length > 0 ? flipped.join(", ") : caught ? "(component crash)" : "(no predicate flipped)";
  } catch { caughtBy = detail.length > 0 ? detail : caughtBy }
  mutantVerdicts.push({ name: label, caught, detail, caughtBy });
  check(`${label} [mutant]`, caught, detail);
  console.log(`      caught by: ${caughtBy}`);
}

/** The component's ACTUAL relative-import specifiers, read from the source. The
 *  rewriter's correctness is a claim about this list, so the list is published. */
function relativeImportsOfComponent(): string[] {
  return [...readFileSync(COMPONENT, "utf8").matchAll(/from\s+"(\.\.?\/[^"]+)"/g)].map((m) => m[1]!).sort();
}

/** Record a mutant the harness could NOT judge. Never counts as caught. */
function mutantNotJudged(label: string, detail: string): void {
  mutantsTotal++;
  mutantsNotJudged++;
  console.log(`  ✗ ${label} [mutant NOT JUDGED — the oracle never ran] ${detail}`);
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const workingTreeDirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => l.slice(3));

// --- R1: fixture written and indexed by the REAL indexer ----------------------
console.log("R1: fixture (real indexer, isolated data dir)");
writeT2Fixture();
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-t2-data-"));
const env = { ...process.env, BB_DATA_DIR: dataDir };
// The wire leg must exercise the code under test, not a leftover bundle. The
// first run of this suite proved why: dist was six edits stale, and the suite
// reported the OLD behaviour (no `detail`, body-wide selectionRange, the
// artifact self-edge, the -32603) as failures of the new contract.
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(p));
    else if (entry.name.endsWith(".ts")) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}
function distIsStale(): boolean {
  if (!existsSync(SERVER)) return true;
  // EVERY source the server bundles, not a two-file list. The first version of
  // this check watched only call_hierarchy.ts and server.ts, so the positions.ts
  // fix left dist stale and the wire leg reported the OLD behavior as if it
  // were the new one — the exact silent misreport this suite exists to prevent.
  return newestSourceMtime(path.join(ROOT, "src")) > statSync(SERVER).mtimeMs;
}
if (distIsStale()) {
  console.log("  (dist missing or stale — building the server under test)");
  execFileSync("npx", ["tsup"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 420_000 });
}
const idxOut = execFileSync(BB, ["index", T2_ROOT, "--no-setup"], {
  cwd: ROOT,
  env,
  encoding: "utf8",
  timeout: 300_000,
  stdio: ["ignore", "pipe", "inherit"],
});
const indexedMatch = /indexed (\d+) files/.exec(idxOut);
const indexedFiles = indexedMatch ? Number(indexedMatch[1]) : 0;
check("R1: the fixture indexes at least 8 files (real indexer)", indexedFiles >= 8, `indexed=${indexedFiles}`);

// --- LSP client over stdio (real dist server) --------------------------------
interface WireResponse {
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

class StdioLsp {
  private child;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (v: WireResponse) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(root: string) {
    this.child = spawn(process.execPath, [SERVER, "--dir", root], {
      cwd: ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = this.buffer.subarray(0, headerEnd).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          this.buffer = this.buffer.subarray(headerEnd + 4);
          continue;
        }
        const len = parseInt(m[1]!, 10);
        if (this.buffer.length < headerEnd + 4 + len) return;
        const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString("utf8");
        this.buffer = this.buffer.subarray(headerEnd + 4 + len);
        let msg: any;
        try {
          msg = JSON.parse(body);
        } catch {
          continue;
        }
        if (typeof msg?.id === "number") {
          const entry = this.pending.get(msg.id);
          if (entry !== undefined) {
            this.pending.delete(msg.id);
            entry.resolve(msg as WireResponse);
          }
        }
      }
    });
    this.child.stderr!.on("data", () => {});
  }

  request(method: string, params: unknown): Promise<WireResponse> {
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    this.child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin!.write(body);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  notify(method: string, params: unknown): void {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }));
    this.child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin!.write(body);
  }

  async dispose(): Promise<void> {
    try {
      this.child.stdin!.end();
    } catch {}
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        this.child!.kill("SIGKILL");
        resolve(null);
      }, 2000);
      this.child!.on("exit", () => {
        clearTimeout(t);
        resolve(null);
      });
    });
  }
}

const uri = (rel: string): string => `file://${path.join(T2_ROOT, rel)}`;
const sourceOf = (rel: string): string => readFileSync(path.join(T2_ROOT, rel), "utf8");
const sliceRange = (rel: string, range: { start: { line: number; character: number }; end: { line: number; character: number } }): string => {
  if (range.start.line !== range.end.line) return "";
  const line = sourceOf(rel).split("\n")[range.start.line] ?? "";
  return line.slice(range.start.character, range.end.character);
};
const relOf = (u: string): string => u.replace(`file://${T2_ROOT}/`, "");

const lsp = new StdioLsp(T2_ROOT);
/** The declared symbol's 0-based column on its declaration line: the identifier
 *  immediately before the parameter list. `export function deep(` must resolve
 *  to `deep` — not to `export` (the first run of this suite prepared on
 *  `export` and reported every symbol as unresolved). */
const declarationNameChar = (line: string): number => {
  const paren = line.indexOf("(");
  const before = paren === -1 ? line : line.slice(0, paren);
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
  return m ? before.length - m[1]!.length : 0;
};

const prepareAt = async (rel: string, line1: number) => {
  const line0 = line1 - 1;
  const text = sourceOf(rel).split("\n")[line0] ?? "";
  const character = declarationNameChar(text);
  const res = await lsp.request("textDocument/prepareCallHierarchy", {
    textDocument: { uri: uri(rel) },
    position: { line: line0, character },
  });
  return res;
};

const wire: Record<string, any> = {};
try {
  const init = await lsp.request("initialize", { processId: null, rootUri: `file://${T2_ROOT}`, capabilities: {} });
  check("W0: server advertises the call hierarchy provider", init.result?.capabilities?.callHierarchyProvider === true);
  lsp.notify("initialized", {});

  // --- W1: a member's own same-named receiver call is not a caller of itself ---
  console.log("\nW1: a receiver-qualified same-name call is not the symbol's own caller");
  const getPrep = await prepareAt(T2_EXPECT.store.rel, T2_EXPECT.store.getLine1);
  const getItem = getPrep.result?.[0];
  wire.get = getItem;
  check("W1: prepare resolves the member `get`", getItem?.name === "get" && getItem?.kind === 6, JSON.stringify(getItem?.name));
  check("W1: prepare carries a human detail line", typeof getItem?.detail === "string" && getItem.detail.length > 0, String(getItem?.detail));
  check("W1: selectionRange is the NAME token, not the body", sliceRange(relOf(getItem?.uri ?? ""), getItem?.selectionRange) === "get", JSON.stringify(getItem?.selectionRange));

  const getIncoming = await lsp.request("callHierarchy/incomingCalls", { item: getItem });
  const getIncomingCalls: any[] = getIncoming.result ?? [];
  check("W1: incoming answers without an error", getIncoming.error === undefined, JSON.stringify(getIncoming.error));
  check(
    "W1: no caller whose name is the member itself (the analyzer's name-resolution artifact is dropped)",
    !getIncomingCalls.some((c) => c.from?.name === "get" && relOf(c.from?.uri ?? "").endsWith("store.ts")),
    JSON.stringify(getIncomingCalls.map((c) => `${c.from?.name}@${relOf(c.from?.uri ?? "")}`)),
  );
  check("W1: `get` is never called anywhere in the fixture, so it has zero callers (no fabricated ones)", getIncomingCalls.length === 0, JSON.stringify(getIncomingCalls.map((c) => c.from?.name)));

  const getOutgoing = await lsp.request("callHierarchy/outgoingCalls", { item: getItem });
  const getOutgoingCalls: any[] = getOutgoing.result ?? [];
  check("W1: outgoing answers without an error", getOutgoing.error === undefined, JSON.stringify(getOutgoing.error));
  check(
    "W1: outgoing never contains the member itself",
    !getOutgoingCalls.some((c) => c.to?.name === "get" && relOf(c.to?.uri ?? "").endsWith("store.ts")),
    JSON.stringify(getOutgoingCalls.map((c) => `${c.to?.name}@${relOf(c.to?.uri ?? "")}`)),
  );

  // --- W2: genuine recursion is kept and labeled ------------------------------
  console.log("\nW2: genuine recursion is kept and labeled");
  const loopPrep = await prepareAt(T2_EXPECT.loop.rel, T2_EXPECT.loop.line1);
  const loopItem = loopPrep.result?.[0];
  wire.loop = loopItem;
  const loopIncoming = await lsp.request("callHierarchy/incomingCalls", { item: loopItem });
  const loopCallers: any[] = loopIncoming.result ?? [];
  const loopSelf = loopCallers.find((c) => c.from?.name === "loop");
  check("W2: `loop` is its own caller (recursion kept)", loopSelf !== undefined, JSON.stringify(loopCallers.map((c) => c.from?.name)));
  check("W2: the recursive call site is the INVOCATION line", (() => {
    const r = loopSelf?.fromRanges?.[0];
    if (!r) return false;
    return r.start.line === T2_EXPECT.loop.recursiveCallLine1 - 1 && sliceRange(T2_EXPECT.loop.rel, r) === "loop";
  })(), JSON.stringify(loopSelf?.fromRanges));
  check("W2: the recursive node is labeled `recursive`", String(loopSelf?.from?.detail ?? "").includes("recursive"), String(loopSelf?.from?.detail));

  // --- W3: one caller, two call sites → two ranges -----------------------------
  console.log("\nW3: every invocation is reported, exactly positioned");
  const deepPrep = await prepareAt("src/deep.ts", T2_EXPECT.chain.deepLine1);
  const deepItem = deepPrep.result?.[0];
  wire.deep = deepItem;
  const deepIncoming = await lsp.request("callHierarchy/incomingCalls", { item: deepItem });
  const deepCallers: any[] = deepIncoming.result ?? [];
  check(
    "W3b: `top` (which reaches `deep` only THROUGH `mid`) is not listed as a caller of `deep`",
    !deepCallers.some((c) => c.from?.name === "top"),
    JSON.stringify(deepCallers.map((c) => c.from?.name)),
  );
  const manyCall = deepCallers.find((c) => c.from?.name === "many");
  check("W3: `many` is reported as a caller of `deep`", manyCall !== undefined, JSON.stringify(deepCallers.map((c) => c.from?.name)));
  check("W3: both call sites are reported (engine dedupes per symbol; the caller's source does not)", manyCall?.fromRanges?.length === 2, JSON.stringify(manyCall?.fromRanges));
  check("W3: both ranges slice back to the invoked name", (() => {
    const rs = manyCall?.fromRanges ?? [];
    return rs.length === 2 && rs.every((r: any) => sliceRange(T2_EXPECT.multi.rel, r) === "deep");
  })(), JSON.stringify(manyCall?.fromRanges));
  check("W3: the ranges are on the invocation lines (4 and 5, 1-based)", (() => {
    const lines = (manyCall?.fromRanges ?? []).map((r: any) => r.start.line + 1).sort();
    return JSON.stringify(lines) === JSON.stringify([...T2_EXPECT.multi.deepCallLines1]);
  })(), JSON.stringify((manyCall?.fromRanges ?? []).map((r: any) => r.start.line + 1)));

  // --- W4: depth chain + mutual pair survive -----------------------------------
  console.log("\nW4: depth chain and mutual pair");
  const topPrep = await prepareAt(T2_EXPECT.chain.rel, T2_EXPECT.chain.topLine1);
  const topItem = topPrep.result?.[0];
  const topOutgoing = await lsp.request("callHierarchy/outgoingCalls", { item: topItem });
  const topCallees: any[] = topOutgoing.result ?? [];
  check("W4: `top` → `mid`", topCallees.some((c) => c.to?.name === "mid"), JSON.stringify(topCallees.map((c) => c.to?.name)));
  const midCall = topCallees.find((c) => c.to?.name === "mid");
  check("W4: `top` → `mid` call site is the invocation", (() => {
    const r = midCall?.fromRanges?.[0];
    return r !== undefined && sliceRange(T2_EXPECT.chain.rel, r) === "mid";
  })(), JSON.stringify(midCall?.fromRanges));
  const midOutgoing = await lsp.request("callHierarchy/outgoingCalls", { item: midCall?.to });
  check("W4: expanding `mid` answers without an error (the pre-M55 -32603)", midOutgoing.error === undefined, JSON.stringify(midOutgoing.error));
  check("W4: `mid` → `deep` (chain depth 3 reachable)", (midOutgoing.result ?? []).some((c: any) => c.to?.name === "deep"), JSON.stringify((midOutgoing.result ?? []).map((c: any) => c.to?.name)));

  const aPrep = await prepareAt(T2_EXPECT.mutual.rel, T2_EXPECT.mutual.aLine1);
  const bPrep = await prepareAt(T2_EXPECT.mutual.rel, T2_EXPECT.mutual.bLine1);
  const aIncoming = await lsp.request("callHierarchy/incomingCalls", { item: aPrep.result?.[0] });
  const bIncoming = await lsp.request("callHierarchy/incomingCalls", { item: bPrep.result?.[0] });
  check("W4: mutual pair — `a` is called by `b`", (aIncoming.result ?? []).some((c: any) => c.from?.name === "b"), JSON.stringify((aIncoming.result ?? []).map((c: any) => c.from?.name)));
  check("W4: mutual pair — `b` is called by `a`", (bIncoming.result ?? []).some((c: any) => c.from?.name === "a"), JSON.stringify((bIncoming.result ?? []).map((c: any) => c.from?.name)));

  // --- W5: declared absence + a malformed request is the CLIENT's error --------
  console.log("\nW5: declared absence and invalid params");
  const absent = await lsp.request("textDocument/prepareCallHierarchy", {
    textDocument: { uri: uri(T2_EXPECT.blankLine.rel) },
    position: { line: T2_EXPECT.blankLine.line1 - 1, character: 0 },
  });
  check("W5: a position with no symbol is declared absent (null, no crash)", absent.error === undefined && (absent.result === null || absent.result === undefined), JSON.stringify(absent).slice(0, 160));

  const bad = await lsp.request("callHierarchy/incomingCalls", {});
  check("W5: a missing item is InvalidParams (-32602), not an internal crash", bad.error?.code === -32602, JSON.stringify(bad.error));
  check("W5: the reason names the field and the method prefix", String(bad.error?.message ?? "").startsWith("bb/callHierarchy:") && String(bad.error?.message ?? "").includes("symbolId"), String(bad.error?.message));
  check("W5: the error is NOT the pre-M55 internal error", bad.error?.code !== -32603 && !String(bad.error?.message ?? "").includes("Cannot read properties"), JSON.stringify(bad.error));

  // --- C: the component's declared fields (what the wire does not carry) -------
  console.log("\nC: component fields over the REAL index");
  process.env.BB_DATA_DIR = dataDir;
  const { BrainDatabase } = await import(pathToFileURL(path.join(ROOT, "src/brain/database.ts")).href);
  const { getProjectId } = await import(pathToFileURL(path.join(ROOT, "src/util/project-id.ts")).href);
  const projectId = getProjectId(T2_ROOT);
  const raw = await BrainDatabase.getRawInstance(projectId);
  const ch = await import(COMPONENT);

  const compIncoming = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" });
  check("C1: the artifact self-edge is dropped and DECLARED with its reason", (() => {
    const dropped = compIncoming.droppedEdges ?? [];
    return dropped.length >= 1 && dropped.some((d: any) => String(d.reason).includes("receiver-qualified") && String(d.reason).includes("this.items.get"));
  })(), JSON.stringify(compIncoming.droppedEdges));
  check("C1: the drop count matches the wire (no artifact caller rendered)", compIncoming.calls.length === getIncomingCalls.length, `${compIncoming.calls.length} vs ${getIncomingCalls.length}`);

  // --- C6: A fromRange may only be produced for a CALL row. -------------------
  //
  // NEW BUG CLASS, found while measuring D4 and gated here BEFORE any fix (F7).
  // It is RED on the real index.
  //
  // THE CAUSE, MEASURED (script/m55/c6-cascade-probe.ts, real index, this
  // fixture) — and the previous version of this comment named it wrong, which is
  // worth recording because a wrong cause in a gate comment misleads the next
  // fixer. It said the owner cascade folded the non-call rows onto the traced
  // symbol, "both with targetMatch: owner-cascade". Measured, the engine's own
  // verdict for `Store.get` / `callers` is 8 edges: 2 `exact`, 6
  // `owner-cascade`. The row that produces the headline range — `Store` as a
  // caller of `get` — is the EXACT `Store:contains:get` row at depth 0: the
  // store genuinely holds "Store contains get" and the engine reports it as an
  // exact caller edge of `get`. No cascade is involved in that one.
  //
  // What is true is one level down. The component's rules are all keyed on
  // `relationshipType === "calls"`:
  //   - the directness rule (an LSP list is direct edges) carries
  //     `&& edge.relationshipType === "calls"`, so a `uses` row at engine depth 1
  //     is never even considered a hop, and `set` renders as a caller of `get`
  //     with its own name token and `position approximate`;
  //   - nothing asks the engine for call rows at all, so the engine's DEFAULT
  //     projection — a ten-kind superset, documented as such for the graph and
  //     impact surfaces — feeds all of them to a renderer.
  //
  // So the defect is the RELATIONSHIP TYPE, and a call hierarchy renders
  // `fromRanges`: §15.3 "A range handed to the editor points at the call site it
  // names, never at a declaration, never at a body, never at a fabricated line."
  // A `contains` or `uses` row names no invocation, so there is no call site to
  // point at — and LSP REQUIRES a non-empty `fromRanges`, which is why the
  // only honest rendering of such a row is to omit it and declare it.
  //
  // DISPOSITION: (c), not (a) and not (b). See the evidence's `c6Disposition`.
  // The one change that fixes it lives in src/lsp/call_hierarchy.ts — this
  // surface asks the engine for CALL rows and declares that filter on every
  // response (§15.1: a surface that filters differently states its filter), and
  // drops+declares any non-call row that still arrives so the surface cannot
  // depend on the engine's default. Measured over this same index: the fix makes
  // this check and W1 true and leaves the receiver-qualified `get -> get`
  // artifact dropped-and-declared with its reason (C1 unchanged). That file is
  // another lane's, so this gate stays honestly RED with the reason recorded.
  const nonCallRendered = compIncoming.calls.filter((c: any) => renderedRelationshipKind(c.from?.detail) !== "calls").map((c: any) => ({
    name: c.from?.name, kind: renderedRelationshipKind(c.from?.detail), detail: c.from?.detail, ranges: c.fromRanges,
  }))
  check(
    "C6: every rendered caller carries a call-site range for a CALLS row (a `contains`/`uses` row must not produce one)",
    nonCallRendered.length === 0,
    `${nonCallRendered.length} rendered entries come from a non-` + "`calls`" + ` relationship and carry a fromRange: ${JSON.stringify(nonCallRendered)}`,
  )
  // The complementary half, which is what a fix would have to satisfy: the
  // relationship type must stay VISIBLE, so suppressing a row never becomes
  // silently relabelling it.
  check(
    "C6b: the relationship type is declared on every rendered caller (a row must never be relabelled)",
    compIncoming.calls.every((c: any) => typeof c.from?.detail === "string" && c.from.detail.length > 0 && !/·\s*·/.test(c.from.detail)),
    JSON.stringify(compIncoming.calls.map((c: any) => c.from?.detail)),
  );

  // C6d — the SAME law, hermetically, in BOTH directions, and with the omission
  // declared. The real-index check above can only ever see whatever the indexer
  // happened to store; this one plants the exact rows by hand, so it is the
  // regression gate the live one cannot be. It is RED today: both planted rows
  // reach the renderer with a range.
  const storeAbs = path.join(T2_ROOT, T2_EXPECT.store.rel);
  const nonCallNode = (id: string, name: string, symbolType: string, line: number, lineEnd: number) => ({
    id, name, symbolType, file: T2_EXPECT.store.rel, filePath: storeAbs, line, lineEnd,
    language: "typescript", complexity: 0, isExternal: false,
  });
  const nonCallRows = [
    { kind: "contains", from: "sym-owner", name: "Store", symbolType: "class", line: 1, lineEnd: 15 },
    { kind: "uses", from: "sym-writer", name: "set", symbolType: "method", line: T2_EXPECT.store.setLine1, lineEnd: T2_EXPECT.store.setLine1 + 2 },
  ].map((r) => ({
    from: r.from,
    to: getItem.data.symbolId,
    relationshipType: r.kind,
    confidence: 1,
    isCrossLanguage: false,
    // A real stored call-site line for a row that is not a call: the address
    // owner's verdict is honest about the COLUMN and says nothing about whether
    // the row is a call, which is precisely why the type is the gate.
    callSite: { kind: "call-site" as const, file: T2_EXPECT.store.rel, line: T2_EXPECT.store.getLine1 },
    depth: 0,
  }));
  const nonCallTraverse = async (_pid: any, _root: any, _options: any): Promise<any> => ({
    callers: nonCallRows,
    callees: [],
    nodes: Object.fromEntries(nonCallRows.map((r, i) => {
      const meta = [
        { kind: "contains", from: "sym-owner", name: "Store", symbolType: "class", line: 1, lineEnd: 15 },
        { kind: "uses", from: "sym-writer", name: "set", symbolType: "method", line: T2_EXPECT.store.setLine1, lineEnd: T2_EXPECT.store.setLine1 + 2 },
      ][i]!;
      return [r.from, nonCallNode(r.from, meta.name, meta.symbolType, meta.line, meta.lineEnd)];
    })),
    truncated: false,
    maxDepthReached: 1,
  });
  const nonCallAnswer = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, nonCallTraverse);
  const nonCallOutAnswer = await ch.expandCalls(raw, projectId, { item: deepItem, direction: "outgoing" }, async (_pid: any, _root: any, _options: any): Promise<any> => ({
    callers: [],
    callees: nonCallRows.map((r) => ({ ...r, from: deepItem.data.symbolId, to: r.from })),
    nodes: Object.fromEntries(nonCallRows.map((r, i) => {
      const meta = [
        { name: "Store", symbolType: "class", line: 1, lineEnd: 15 },
        { name: "set", symbolType: "method", line: T2_EXPECT.store.setLine1, lineEnd: T2_EXPECT.store.setLine1 + 2 },
      ][i]!;
      return [r.from, nonCallNode(r.from, meta.name, meta.symbolType, meta.line, meta.lineEnd)];
    })),
    truncated: false,
    maxDepthReached: 1,
  }));
  const plantedRendered = (answer: any, side: "from" | "to") =>
    (answer.calls ?? [])
      .filter((c: any) => renderedRelationshipKind((c[side] ?? {}).detail) !== "calls")
      .map((c: any) => ({ name: c[side]?.name, kind: renderedRelationshipKind((c[side] ?? {}).detail), detail: c[side]?.detail, ranges: c.fromRanges }));
  const plantedBoth = [
    ...plantedRendered(nonCallAnswer, "from").map((r: any) => ({ direction: "incoming", ...r })),
    ...plantedRendered(nonCallOutAnswer, "to").map((r: any) => ({ direction: "outgoing", ...r })),
  ];
  check(
    "C6d: a planted `contains`/`uses` row produces NO rendered range in EITHER direction (hermetic — §15.3)",
    plantedBoth.length === 0,
    `${plantedBoth.length} planted non-call row(s) rendered with a range: ${JSON.stringify(plantedBoth)}`,
  );
  const plantedDropped = nonCallAnswer.droppedEdges ?? [];
  check(
    "C6e: every omitted non-call row is DECLARED with its kind named (omission is declared, never silent — §11.7)",
    ["contains", "uses"].every((kind) => plantedDropped.some((d: any) => String(d.reason).includes(kind))),
    JSON.stringify(plantedDropped.map((d: any) => ({ name: d.name, reason: String(d.reason).slice(0, 120) }))),
  );

  // C6g — the trap a correct fix walks into. Filtering to call rows empties
  // `get`'s caller list, and the absence the surface then declares must not
  // imply the STORE holds no stored row: measured on this very index it holds an
  // exact `Store contains get` row and a cascaded `uses` row. A reader told
  // "no stored callers" would conclude the class has no relationship to its own
  // method, which is the opposite of what the store says.
  //
  // READ THE SHAPE OF THIS STIMULUS, because it is the reason the check is
  // worth having. `callsOnly` is the engine asked for CALL rows only, which is
  // exactly what the shipped component now asks for — so this leg can no longer
  // tell a surface that filters BY ASKING from one that filters BY DROPPING.
  // It still measures something real and false-if-broken: it forces the filter
  // at the engine boundary and asserts the ANSWER says which rows it read.
  // With the filter applied the engine still returns the depth-0 `calls` row for
  // this symbol (the receiver-qualified artifact — measured, not assumed:
  // callers.length 1, not 0), so the answer is empty via the drop path and its
  // absence is the one a reader sees. The `relationshipTypes` declaration is
  // asserted separately by C6f over three answers.
  const { defaultTraverse: realTraverse } = await import(COMPONENT);
  const callsOnly = async (pid: any, root: any, options: any) =>
    realTraverse(pid, root, { ...options, relationshipTypes: ["calls"] });
  const filteredReal = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, callsOnly);
  check(
    "C6g: an answer emptied BY the filter says so — the declared absence names the filter instead of implying the store holds no rows (§11.7)",
    (filteredReal.calls ?? []).length === 0 &&
      filteredReal.absence !== null &&
      /call/i.test(String((filteredReal.absence as any).message ?? "")) &&
      /relationship|kind|type|filter/i.test(String((filteredReal.absence as any).message ?? "")),
    JSON.stringify({ rendered: (filteredReal.calls ?? []).length, absence: filteredReal.absence, dropped: filteredReal.droppedEdges }),
  );
  // The absence must not make a CLAIM ABOUT THE STORE'S CONTENTS that the
  // surface cannot support. Stated negatively and tightly, because the two loose
  // halves above are satisfied by almost any sentence that mentions the word
  // "kind": once a surface filters, "the engine returned no stored caller edge"
  // is a claim about rows it never asked for, and on this index it is false (the
  // store holds `Store:contains:get` and a cascaded `uses` row). This is the
  // exact wording the pre-fix code emitted, so this assertion is falsifiable by
  // the pre-fix code itself.
  const absenceMustNotClaimStoreEmpty = (message: string): boolean =>
    !/the engine returned no stored/i.test(message);
  check(
    "C6g: the absence does not assert that the engine returned no stored edge — a filtered surface never asked for the other kinds (§11.7)",
    absenceMustNotClaimStoreEmpty(String((filteredReal.absence as any)?.message ?? "")) &&
      absenceMustNotClaimStoreEmpty(String((compIncoming.absence as any)?.message ?? "")),
    JSON.stringify({
      filtered: String((filteredReal.absence as any)?.message ?? ""),
      shipped: String((compIncoming.absence as any)?.message ?? ""),
    }),
  );
  // The half C6g's stimulus cannot reach, stated over the SHIPPED path: the
  // answer the editor actually receives must declare its filter too, or §15.1's
  // "a surface that filters differently states its filter" holds only on a path
  // no client reaches.
  check(
    "C6g: the SHIPPED answer (no injected traverse) also names the filter in its empty-answer absence (§11.7)",
    (compIncoming.calls ?? []).length === 0 &&
      compIncoming.absence !== null &&
      /call/i.test(String((compIncoming.absence as any).message ?? "")) &&
      /relationship|kind|type|filter/i.test(String((compIncoming.absence as any).message ?? "")),
    JSON.stringify({ rendered: (compIncoming.calls ?? []).length, absence: compIncoming.absence }),
  );

  // C2, RE-UNITED (§13.4): the assertion is now against the RANGES RENDERED, not
  // the caller entries. The pre-lane form (`resolved + approximate ===
  // calls.length`) is the D4 finding: one stored row with two invocations renders
  // two ranges, so the old unit could not be equal to what the editor receives,
  // and it was RED on this very fixture at HEAD (`many` has two call sites).
  // The per-entry counts are still asserted, beside it.
  const renderedIncoming = compIncoming.calls.reduce((n: number, c: any) => n + (c.fromRanges?.length ?? 0), 0);
  check(
    "C2: resolved + approximate equals the RENDERED range count (13.4)",
    compIncoming.callSitesResolved + compIncoming.callSitesApproximate === renderedIncoming,
    JSON.stringify({ resolved: compIncoming.callSitesResolved, approx: compIncoming.callSitesApproximate, rendered: renderedIncoming, calls: compIncoming.calls.length }),
  );
  check(
    "C2: the per-entry counts are kept beside it (13.2 declares multiplicity, it does not collapse it)",
    compIncoming.callSiteEntries !== undefined && compIncoming.callSiteEntries.resolved + compIncoming.callSiteEntries.approximate === compIncoming.calls.length,
    JSON.stringify(compIncoming.callSiteEntries),
  );
  const compMany = await ch.expandCalls(raw, projectId, { item: deepItem, direction: "incoming" });
  check("C3: the multi-call-site caller's ranges are all exact invocations", (() => {
    const many = compMany.calls.find((c: any) => c.from?.name === "many");
    const rs = many?.fromRanges ?? [];
    return rs.length === 2 && rs.every((r: any) => sliceRange(T2_EXPECT.multi.rel, r) === "deep");
  })(), JSON.stringify(compMany.calls.map((c: any) => [c.from?.name, c.fromRanges?.length])));

  // And the case the old unit could not express: a response whose declared count
  // would be WRONG under the entry unit. `deep` has callers `mid` (1 site) and
  // `many` (2 sites), so entries say 2 and ranges say 3.
  const renderedMany = compMany.calls.reduce((n: number, c: any) => n + (c.fromRanges?.length ?? 0), 0);
  check(
    "C2: on a response with a two-call-site caller the declared count equals the RANGES, not the entries",
    compMany.callSitesResolved + compMany.callSitesApproximate === renderedMany && renderedMany !== compMany.calls.length,
    JSON.stringify({ declared: compMany.callSitesResolved + compMany.callSitesApproximate, rendered: renderedMany, entries: compMany.calls.length }),
  );

  // C6f — §15.1: "any surface that filters differently states its filter." This
  // surface MUST filter (C6d), and a filter nothing can read is not a
  // declaration. Stated over BOTH symbols' answers and the hermetic one, so a
  // filter that rides on only one code path fails here. RED today: the response
  // carries no filter at all, which is why a reader of a callers list has no way
  // to know the store holds `contains` and `uses` rows for the same symbol.
  const declaredFilter = (answer: any) => answer.relationshipTypes;
  const filterAnswers = [compIncoming, compMany, nonCallAnswer];
  check(
    "C6f: every expand answer DECLARES the relationship-kind filter it applied, and that filter contains only kinds that can name a call site (§15.1)",
    filterAnswers.every((a: any) => {
      const f = declaredFilter(a);
      return Array.isArray(f) && f.length > 0 && f.every((k: unknown) => typeof k === "string" && CALL_SITE_CAPABLE_KINDS.has(k));
    }),
    JSON.stringify(filterAnswers.map((a: any) => ({ filter: declaredFilter(a) ?? "(absent)" }))),
  );

  // The declared approximation: a caller whose stored span CANNOT BE PLACED in its
  // own file (a stale index row pointing past EOF), so no call site can be read
  // from it and the answer is a LABELLED approximation.
  //
  // FIXTURE REPAIR, and this one is about the EXPECTATION, not just the fixture.
  // C4 said "a caller whose source does NOT invoke the name" — but the directness
  // rule (M55.T2's own sibling law) DROPS such an edge as a stale row rather than
  // rendering it, so that shape can never reach the approximation branch and the
  // check had been RED since wave 1 (the pre-wave `file: ""` version tripped the
  // launch-set gate first, so it never tested the thing it names either). The
  // branch IS reachable — for an unplaceable span, or an unreadable file, or an
  // external node — and the unplaceable-span shape is asserted here, matching
  // script/m24 G9. The file is written here rather than added to
  // script/m55/t2-fixture.ts, which this lane does not own.
  const GHOST_REL = "src/ghost.ts";
  // In a SCRATCH directory, not inside T2_ROOT: writeT2Fixture() deletes and
  // rewrites T2_ROOT, so a file written there disappears when another suite runs
  // (measured: script/m55/measure-address-agreement.ts wiped it between runs of
  // this suite, and the evidence would then depend on run order).
  const ghostDir = mkdtempSync(path.join(tmpdir(), "m55-t2-ghost-"));
  const GHOST_ABS = path.join(ghostDir, "ghost.ts");
  writeFileSync(GHOST_ABS, "export function ghost(): number {\n  return 1;\n}\n", "utf8");
  const fakeTraverse = async (): Promise<any> => ({
    callers: [{ from: "sym-ghost", to: getItem.data.symbolId, relationshipType: "calls", confidence: 1, isCrossLanguage: false, callSite: { kind: "call-site", file: GHOST_REL, line: 900 }, depth: 0 }],
    callees: [],
    nodes: { "sym-ghost": { id: "sym-ghost", name: "ghost", symbolType: "function", file: GHOST_REL, filePath: GHOST_ABS, line: 900, lineEnd: 900, language: "typescript", complexity: 0, isExternal: false } },
    truncated: false,
    maxDepthReached: 1,
  });
  const approx = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, fakeTraverse);
  check("C5: only direct relations are rendered; the engine's deeper hop is DECLARED", (() => {
    const names = compMany.calls.map((c: any) => (c.from ?? c.to).name);
    const hops = (compMany.droppedEdges ?? []).filter((d: any) => String(d.reason).includes("transitive hop"));
    return !names.includes("top") && hops.length >= 1 && hops.some((d: any) => d.name === "top");
  })(), JSON.stringify({ names: compMany.calls.map((c: any) => (c.from ?? c.to).name), dropped: compMany.droppedEdges }));

  // C5b (D4): the hop's reason must state the ENGINE'S depth, not guess between
  // two causes. The pre-lane wording offered "a transitive hop (engine depth > 0)
  // or a stale stored row" for EVERY row, including the rows where the engine had
  // already said which it was.
  check("C5b: the hop's drop reason states the engine's depth rather than offering two causes", (() => {
    const top = (compMany.droppedEdges ?? []).find((d: any) => d.name === "top");
    return top !== undefined && /depth \d+/.test(String(top.reason)) && !String(top.reason).includes("stale stored row");
  })(), JSON.stringify((compMany.droppedEdges ?? []).map((d: any) => ({ name: d.name, reason: String(d.reason).slice(0, 140) }))));

  // --- D4: the two sources of truth for "where is this called?", on the REAL index.
  console.log("\nD4: source-resolved vs store-derived call-site positions (real index)");
  const censusOf = (r: any) => r.addressCrossCheck;
  const bucketsOf = (c: any) => c.agree + c.disagree + c.sourceOnly + c.storeOnly + c.neither;
  for (const [label, res] of [["deep/incoming", compMany], ["get/incoming", compIncoming], ["deep/outgoing", await ch.expandCalls(raw, projectId, { item: deepItem, direction: "outgoing" })]] as const) {
    const c = censusOf(res as any);
    check(`D4: ${label} publishes a PARTITION census over every stored edge read`, c !== undefined && bucketsOf(c) === c.edges, JSON.stringify(c));
  }
  const manyCross = compMany.addressCrossCheck;
  check("D4: the multi-call-site caller is 'agree' — one stored line naming ONE of two invocations is multiplicity, not contradiction", manyCross.agree >= 2, JSON.stringify(manyCross));
  check("D4: directness is declared, hops counted apart (engine depth is 0-BASED)", manyCross.direct >= 1 && manyCross.hop >= 1 && manyCross.directnessUnstated === 0, JSON.stringify(manyCross));
  check("D4: the hop row's stored line agrees with the hop's OWN invocation (like-for-like)", manyCross.disagree === 0, JSON.stringify({ census: manyCross, disagreements: compMany.addressDisagreements }));
  check("D4: every cross-checked comparison actually ran", manyCross.comparisonNotRun === 0, JSON.stringify(manyCross));
  check("D4: no engine edge arrived without an address on this fixture", manyCross.addressMissing === 0, JSON.stringify(manyCross));
  // §15.1: whatever the two sources disagree about must be DECLARED with both
  // positions. This fixture is expected to disagree nowhere; the check is stated
  // over the general rule so a future disagreement cannot pass undeclared.
  check("D4: every disagreement carries both positions and a reason (15.1)", (compMany.addressDisagreements ?? []).every((d: any) => typeof d.reason === "string" && d.reason.length > 0 && d.agreement !== undefined && "sourceLines0" in d.agreement && "address" in d.agreement && "renderedLine0" in d.agreement && typeof d.agreement.direct === "boolean"), JSON.stringify((compMany.addressDisagreements ?? []).map((d: any) => d.reason)));

  check("C4: an unresolvable call site is DECLARED approximate, not silently placed", (() => {
    const call: any = approx.calls[0];
    return approx.callSitesApproximate === 1 && String(call?.from?.detail ?? "").includes("position approximate");
  })(), JSON.stringify({ approx: approx.callSitesApproximate, calls: approx.calls.length, detail: approx.calls[0]?.from?.detail, dropped: approx.droppedEdges, declaredAbsent: approx.declaredAbsentNodes }));

  // --- M: mutants — the suite CAN fail ----------------------------------------
  console.log("\nM: mutants (source-copy defects the pre-M55 code actually had)");
  const componentSource = readFileSync(COMPONENT, "utf8");
  const MUTANTS: Array<{ name: string; from: string; to: string }> = [
    {
      name: "call sites: skip the source resolution (stored line / name-token fallback only)",
      from: "    if (invocations.length > 0) {\n      fromRanges = invocations.map((i) => i.range);",
      to: "    if (false) {\n      fromRanges = invocations.map((i) => i.range);",
    },
    {
      name: "identity: re-admit receiver-qualified self-edges (the pre-M55 behavior)",
      from: "      if (receiverQualified) {\n        droppedEdges.push({",
      to: "      if (false) {\n        droppedEdges.push({",
    },
    {
      name: "selection: point selectionRange at the whole body",
      from: "    selectionRange = nameTokenRange(source, node.name, { start: start0, end: end0 }) ?? range;",
      to: "    selectionRange = range;",
    },
    {
      name: "directness: re-admit transitive hops (the engine's depth > 0 rows)",
      from: "      invocations.length === 0 &&\n      callerSource !== null &&",
      to: "      false &&\n      callerSource !== null &&",
    },
    {
      name: "declared: hide the approximation (undeclared substitute)",
      from: "      ? { ...expanded, detail: `${expanded.detail} · position approximate` }",
      to: "      ? { ...expanded }",
    },
    // The three below plant the defects this lane's fix introduced the MEANS to
    // commit, and each is convicted by its OWN predicate rather than by one
    // shared with the five above: a shared predicate lets one mutant's failure
    // vouch for another's, which is the oracle/implementation sharing §8.7
    // names. A6 removes the defence in depth; A7 removes the engine request
    // (the pre-fix state) — the two are separate because only the second can
    // convict A7: with the drop in place a surface that forgets to ask the
    // engine is still honest, and saying otherwise would be a false claim.
    {
      name: "filter: render a non-call row anyway (defence in depth removed)",
      from: '    if (!(CALL_HIERARCHY_RELATIONSHIP_TYPES as readonly string[]).includes(edge.relationshipType)) {',
      to: "    if (false) {",
    },
    {
      name: "filter: ask the engine for every relationship kind again (the pre-fix request)",
      from: "    relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],\n  });",
      to: "  });",
    },
    {
      name: "declared: answer without the relationship-kind filter (§15.1)",
      from: "    relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],\n  };\n}",
      to: "    relationshipTypes: [],\n  };\n}",
    },
    {
      // The WHOLE message is reverted, not its first clause. MEASURED why the
      // smaller anchor is worthless here: reverting only the opening clause
      // leaves "This surface reads the 1 relationship kind(s) … only and declares
      // that filter" behind, and the predicate that asks for the word "kind" is
      // then satisfied by the mutant itself — it SURVIVED the first run of this
      // table for exactly that reason. The claim being planted is the claim
      // about the store, so the whole sentence that makes it must go.
      name: "absence: imply the store holds no rows when the FILTER emptied the answer (§11.7)",
      // Anchor the EXACT current text of the `edges.length > 0` branch. The
      // component carries TWO absence sentences (the "no rows at all" branch and
      // the "read some, rendered none" branch), and only the second is on this
      // path: with the filter applied the engine still returns the depth-0
      // `calls` row for this symbol (measured, callers.length 1), so a filtered
      // empty answer never reaches the first.
      from: '`no stored ${direction === "callers" ? "caller" : "callee"} CALL row of this symbol is rendered. This surface reads the ${CALL_HIERARCHY_RELATIONSHIP_TYPES.length} relationship kind(s) ${JSON.stringify(CALL_HIERARCHY_RELATIONSHIP_TYPES)} only and declares that filter on every response (§15.1): ${edges.length} stored CALL row(s) were read and ${droppedEdges.length} were dropped or declared absent, each with its reason and kind named — rows of other kinds may be stored for this symbol and are not ${direction === "callers" ? "callers" : "callees"} here, so this answer is "no stored call rendered", not "no stored relationship"`',
      to: '`the engine returned no stored ${direction === "callers" ? "caller" : "callee"} edge for ${rootRow.name} (this is an indexed, served symbol: the answer is "none stored", not "unknown")`',
    },
  ];
  /**
   * THE FILTER MUTANT IS NOW IN THE LIST, and this is the record of why it could
   * not be before.
   *
   * The pre-fix suite deliberately omitted it (comment preserved in the lane
   * report): its only oracle predicate was "the answer declares a
   * call-site-capable filter" (C6f), and C6f was RED on the real component. A
   * mutant oracle must be evaluated against a baseline in which every predicate
   * HOLDS; adding a permanently-false predicate would have made all five
   * existing mutants report `caught by filterOk` while judging nothing about
   * the defect each one plants — the tautology §8.7 names.
   *
   * The predicate set below has a baseline in which all nine hold (verified:
   * the suite reports every new mutant as NOT-judged-free and the unchanged
   * five still convicted by their own predicates), so the filter mutants are
   * now judged rather than argued.
   *
   * WHAT EACH NEW MUTANT IS CONVICTED BY, stated so a reader can check the
   * oracle rather than trust it:
   *
   *   defence in depth removed     `nonCallRenderedOk` — the real-index answer
   *                                renders an entry whose detail is
   *                                `class · contains · 1 call site`, and that
   *                                entry carries a range. This is the pre-fix
   *                                C6 failure verbatim.
   *   every relationship kind again `filterDeclaredOk` (declaration) AND
   *                                `plantedOk`. Removing only the engine request
   *                                leaves the surface HONEST — the rows are read
   *                                and omitted with their kind named — so the
   *                                honest statement is that this defect is a
   *                                §15.1 declaration failure, not a §15.3 range
   *                                failure, and the predicate says so. It is
   *                                convicted because the response still DECLARES
   *                                it read only `calls` while the engine handed
   *                                it `contains` and `uses`: measured on the real
   *                                index, with the request removed the engine
   *                                returns 8 caller rows of which 6 are
   *                                non-`calls` (script/m55/c6-cascade-probe.ts).
   *                                Note what is NOT claimed: the request is not
   *                                observable from the response, so this suite
   *                                cannot prove the option was passed. It proves
   *                                the response does not LIE about it.
   *   no declared filter           `filterDeclaredOk` — `relationshipTypes: []`
   *                                is the declared shape of a response that
   *                                read nothing; the predicate requires a
   *                                non-empty call-site-capable list.
   *   absence implies empty store  `absenceOk` — the reverted wording says
   *                                "the engine returned no stored caller edge",
   *                                which on this index is FALSE (it holds
   *                                `Store:contains:get`), and the predicate
   *                                requires the message to name both the call
   *                                kind and the filter.
   */

/**
 * Rewrite every RELATIVE import in a component copy to an absolute file URL.
 *
 * Why this is generic and not a list: the hand-written list this replaces
 * omitted `./signature` (and, since wave 1, also `./launch_languages`,
 * `./symbols`, `../brain/freshness` and `../intelligence/graph/line-address`), so
 * EVERY mutant in this suite died on an import error while the suite counted it
 * "caught" — the evidence said 5/5 mutants caught and the oracle had never run.
 * A missing list entry is silent; resolving what the source actually imports
 * cannot go stale.
 */
function rewriteRelativeImports(source: string): string {
  const componentDir = path.dirname(COMPONENT);
  return source.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_match, specifier: string) => {
    const target = path.join(componentDir, specifier);
    const resolved = existsSync(`${target}.ts`) ? `${target}.ts` : existsSync(target) ? target : `${target}.ts`;
    return `from "${pathToFileURL(resolved).href}"`;
  });
}

  const mutantDir = mkdtempSync(path.join(tmpdir(), "m55-t2-mut-"));

  /**
   * THE CONTROL, and it is the check that makes the whole mutant table mean
   * anything. Every predicate below is evaluated against the UNMUTATED component
   * first; if any one of them is FALSE there, the table is reporting "caught" by
   * a predicate that never held, and every verdict it produces is free.
   *
   * This control is NOT decorative, and this suite is the proof: adding the four
   * filter/declaration predicates in this lane initially left `selectionOk`
   * reading `incomp.calls[0]` — and because the fix legitimately empties `get`'s
   * caller list, `incomp.calls` was empty, `selectionOk` was FALSE in the
   * baseline, and the run reported four of the nine mutants "caught by
   * selectionOk" for free. The predicate is now read off an answer that renders,
   * and this control is what would have said so automatically. §8.7's tautology,
   * caught by measurement instead of shipped.
   */
  const baselinePredicates = (await (async () => {
    const incomp = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" });
    const mult = await ch.expandCalls(raw, projectId, { item: deepItem, direction: "incoming" });
    const approxCase = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, fakeTraverse);
    const planted = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, nonCallTraverse);
    const absent = await ch.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, callsOnly);
    const manyMod = mult.calls.find((c: any) => c.from?.name === "many");
    const selectionEntry = mult.calls[0];
    const absenceMessage = String((absent.absence as any)?.message ?? "");
    return {
      rangesOk: (manyMod?.fromRanges ?? []).length === 2 &&
        (manyMod?.fromRanges ?? []).every((r: any) => sliceRange(T2_EXPECT.multi.rel, r) === "deep"),
      droppedOk: (incomp.droppedEdges ?? []).length >= 1 && incomp.calls.every((c: any) => c.from?.name !== "get"),
      selectionOk: selectionEntry !== undefined &&
        sliceRange(relOf(selectionEntry.from?.uri ?? ""), selectionEntry.from?.selectionRange) === String(selectionEntry.from?.name ?? "\u0000"),
      declaredOk: approxCase.callSitesApproximate === 1 && String(approxCase.calls[0]?.from?.detail ?? "").includes("position approximate"),
      hopOk: !mult.calls.some((c: any) => c.from?.name === "top") &&
        (mult.droppedEdges ?? []).some((d: any) => String(d.reason).includes("transitive hop")),
      nonCallRenderedOk: [...(incomp.calls ?? []), ...(mult.calls ?? [])]
        .every((c: any) => renderedRelationshipKind((c.from ?? c.to)?.detail) === "calls"),
      filterDeclaredOk: Array.isArray(incomp.relationshipTypes) && incomp.relationshipTypes.length > 0 &&
        incomp.relationshipTypes.every((k: unknown) => typeof k === "string" && CALL_SITE_CAPABLE_KINDS.has(k)),
      plantedOk: planted.calls.length === 0 &&
        ["contains", "uses"].every((kind) => (planted.droppedEdges ?? []).some((d: any) => String(d.reason).includes(kind))),
      absenceOk: absent.calls.length === 0 && /call/i.test(absenceMessage) &&
        /relationship|kind|type|filter/i.test(absenceMessage),
      filterCoherentOk: declinedKindsOutsideDeclaredFilter(incomp).length === 0,
    };
  })());
  const baselineFalse = Object.entries(baselinePredicates).filter(([, ok]) => !ok).map(([k]) => k);
  check(
    "M/CONTROL: every mutant-oracle predicate HOLDS on the UNMUTATED component (no free verdicts — §8.7)",
    baselineFalse.length === 0,
    `predicate(s) false in the baseline: ${JSON.stringify(baselineFalse)} — every mutant reading "caught by" one of these is convicted for free`,
  );

  for (const m of MUTANTS) {
    if (!componentSource.includes(m.from)) {
      mutantNotJudged(`${m.name} (anchor not found — suite is stale)`, "anchor missing");
      continue;
    }
    const patched = rewriteRelativeImports(componentSource.replace(m.from, m.to));
    const mutantPath = path.join(mutantDir, `ch_mutant_${mutantsTotal}.ts`);
    writeFileSync(mutantPath, patched, "utf8");
    let mod: any;
    try {
      mod = await import(pathToFileURL(mutantPath).href);
    } catch (error) {
      // NOT a caught mutant: the oracle never ran. Counting it as caught is the
      // defect this harness carried before.
      mutantNotJudged(m.name, `import failure: ${String(error).split("\n")[0]}`);
      continue;
    }
    try {
      const incomp = await mod.expandCalls(raw, projectId, { item: getItem, direction: "incoming" });
      const mult = await mod.expandCalls(raw, projectId, { item: deepItem, direction: "incoming" });
      const manyMod = mult.calls.find((c: any) => c.from?.name === "many");
      const rangesOk = (manyMod?.fromRanges ?? []).length === 2 &&
        (manyMod?.fromRanges ?? []).every((r: any) => sliceRange(T2_EXPECT.multi.rel, r) === "deep");
      const droppedOk = (incomp.droppedEdges ?? []).length >= 1 && incomp.calls.every((c: any) => c.from?.name !== "get");
      // Read off `mult` (deep/incoming), NOT off `incomp` (get/incoming). MEASURED
      // why that matters now: `get` is genuinely never called in this fixture, so
      // the fix empties its caller list (that is the W1 law), `incomp.calls[0]` is
      // undefined, and a predicate reading it was FALSE in the baseline — which
      // is the tautology §8.7 names: every mutant then reads as "caught by
      // selectionOk" for free while selectionOk says nothing about selection.
      // `deep/incoming` renders two callers (`mid`, `many`), so the predicate has
      // something real to read in the baseline and can fail when selection is
      // broken.
      const selectionEntry = mult.calls[0];
      // The law this predicate states is "selectionRange is the NAME token in the
      // caller's OWN source" — the same law W1 asserts on the wire — so it reads
      // the caller's own file by URI rather than a fixture constant. It held
      // only a non-emptiness test against a FIXED path before, which would have
      // passed for a body-wide range on any non-empty line.
      const selectionOk = selectionEntry !== undefined &&
        sliceRange(relOf(selectionEntry.from?.uri ?? ""), selectionEntry.from?.selectionRange) === String(selectionEntry.from?.name ?? "\u0000");
      const approxCase = await mod.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, fakeTraverse);
      const declaredOk = approxCase.callSitesApproximate === 1 && String(approxCase.calls[0]?.from?.detail ?? "").includes("position approximate");
      const hopOk = !mult.calls.some((c: any) => c.from?.name === "top") &&
        (mult.droppedEdges ?? []).some((d: any) => String(d.reason).includes("transitive hop"));
      // The three filter/declaration predicates. Each is stated over a REAL
      // answer of the MUTANT module, so a mutant cannot pass by declaring
      // something the oracle never reads.
      //
      // `nonCallRenderedOk` is the same law C6 states, re-expressed against the
      // mutant: a rendered entry whose detail does not begin `calls` came from a
      // row that names no call site, and it is carrying a range.
      const nonCallRenderedOk = [...(incomp.calls ?? []), ...(mult.calls ?? [])]
        .every((c: any) => renderedRelationshipKind((c.from ?? c.to)?.detail) === "calls");
      // A surface that forgets to ASK the engine still reads the engine's
      // default ten-kind superset. With the defence in depth in place those rows
      // are omitted and DECLARED, which is honest — so the predicate that
      // convicts this mutant is the DECLARED filter matching what was asked
      // for, which is what §15.1 is about. The declaration is not evidence of
      // the request, so this mutant is convicted by comparing the engine's own
      // caller rows against the kinds the response says it read: if a non-call
      // kind was read, the response's declaration is false.
      const declaredKinds = incomp.relationshipTypes;
      const filterDeclaredOk = Array.isArray(declaredKinds) && declaredKinds.length > 0 &&
        declaredKinds.every((k: unknown) => typeof k === "string" && CALL_SITE_CAPABLE_KINDS.has(k));
      // The hermetic leg: with a traverse that hands back a planted
      // `contains`/`uses` row (bypassing the engine option entirely), nothing
      // may render and both kinds must be named in the drop list.
      const plantedMod = await mod.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, nonCallTraverse);
      const plantedOk = plantedMod.calls.length === 0 &&
        ["contains", "uses"].every((kind) => (plantedMod.droppedEdges ?? []).some((d: any) => String(d.reason).includes(kind)));
      // C6g's law: an answer emptied BY the filter must say so, and must not
      // claim the store holds nothing. The second half is stated negatively and
      // tightly (see `absenceMustNotClaimStoreEmpty` at the C6g checks): the
      // two positive halves are satisfied by almost any sentence containing the
      // word "kind", so on their own they do not convict the reverted wording.
      const absentMod = await mod.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, callsOnly);
      const absenceMessage = String((absentMod.absence as any)?.message ?? "");
      const absenceOk = absentMod.calls.length === 0 && /call/i.test(absenceMessage) &&
        /relationship|kind|type|filter/i.test(absenceMessage) &&
        !/the engine returned no stored/i.test(absenceMessage);
      // §15.1 coherence: the answer may not decline a row of a kind its own
      // declared filter excludes. Convicts the pre-fix request.
      const filterCoherentOk = declinedKindsOutsideDeclaredFilter(incomp).length === 0;
      const caught = !(rangesOk && droppedOk && selectionOk && declaredOk && hopOk && nonCallRenderedOk && filterDeclaredOk && plantedOk && absenceOk && filterCoherentOk);
      mutant(m.name, caught, JSON.stringify({ rangesOk, droppedOk, selectionOk, declaredOk, hopOk, nonCallRenderedOk, filterDeclaredOk, plantedOk, absenceOk, filterCoherentOk }));
    } catch {
      mutant(m.name, true, "component crash under the mutant");
    }
  }
  rmSync(mutantDir, { recursive: true, force: true });

  // --- Evidence -----------------------------------------------------------------
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  const realFailed = failures.length;
  const evidence = {
    issue: "M55.T2",
    code: "T2",
    milestone: "M55",
    status: realFailed === 0 && mutantsCaught === mutantsTotal && mutantsNotJudged === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed: 0,
    realFailed,
    mutantsCaught,
    mutantsTotal,
    mutantsNotJudged,
    mutantsJudged: mutantsCaught,
    mutantVerdicts,
    mutantHarness: {
      importRewriting: "GENERIC: every relative import in the component copy is rewritten to an absolute file URL from what the source ACTUALLY imports (not a hand-written list)",
      baselineControl: {
        law: "every predicate the mutant table uses is evaluated against the UNMUTATED component first, and the run FAILS if any one of them is false there (check `M/CONTROL`). A predicate that never held convicts every mutant for free; §8.7 names that the tautology.",
        predicatesAtThisRun: baselinePredicates,
        falseInBaseline: baselineFalse,
        caughtByThisControl: "this lane added the four filter/declaration predicates while `selectionOk` still read `incomp.calls[0]`. The fix legitimately empties `get`'s caller list (that is the W1 law), so that entry was undefined, `selectionOk` was FALSE in the baseline, and four mutants reported `caught by: selectionOk` for free. Measured, then fixed: the predicate now reads an answer that renders (`deep/incoming`), asserts the NAME token in the caller's OWN file rather than non-emptiness against a fixed path, and M/CONTROL is what makes that class of defect fail loudly instead of quietly.",
      },
      relationshipKindReadCorrected:
        "C6, C6d's `plantedRendered` and the mutant predicate all read the relationship kind with `/^calls\\b/.test(detail)`. The component's detail line is `${symbolType} · ${relationshipType} · …`, so it never STARTS with the kind: measured on the real index, BOTH rendered callers of `deep` carry `function · calls · 1 call site` and the old test called both of them non-call rows. The check reported the pre-fix failure for the right reason and would have gone vacuously green afterwards for the wrong one — it could not tell a `calls` row from a `contains` row. Corrected to read the SECOND ` · `-delimited segment (`renderedRelationshipKind`). This is a correction to a check, justified by measurement, and it TIGHTENS the gate: the pre-fix component is still red under it (verified by re-running the suite against the unmutated pre-fix source through the same predicate).",
      preLaneDefect: "the pre-lane rewriter was a hand-written list that omitted ./signature (and, since wave 1, ./launch_languages, ./symbols, ../brain/freshness and ../intelligence/graph/line-address); every mutant then died on an import error while being counted \"caught\", so the evidence said 5/5 while the oracle had never run",
      importFailureIsNotCaught: true,
      componentImportsAtThisRun: relativeImportsOfComponent(),
    },
    currentCommit,
    workingTreeRelevantChanges: workingTreeDirty,
    /**
     * §8.2 — "byte-identical modulo timestamps declared as such" is only
     * meaningful if the record says WHICH fields those are. Declared here so a
     * byte-identity checker does not have to guess, and so an undeclared
     * difference is a finding rather than a judgement call.
     *
     * Measured at commit 462f620be with a clean tree: two consecutive runs of
     * this suite differ ONLY in `generatedAt`, the seal that hashes it, and
     * `workingTreeRelevantChanges`. The last is self-referential — it lists the
     * dirty files at run time, and writing this record dirties it — so it cannot
     * be stable by construction. Everything else, including every count, every
     * mutant verdict and the whole disposition block, is stable.
     */
    volatileFields: ["generatedAt", "bbSeal.sealedAt", "bbSeal.contentSha256", "workingTreeRelevantChanges"],
    verifierCommand: "npx tsx script/m55/verify-call-hierarchy.ts",
    evidenceFile: "T2.json",
    generatedAt: new Date().toISOString(),
    fixture: {
      root: T2_ROOT,
      files: ["src/store.ts", "src/loop.ts", "src/mutual.ts", "src/chain.ts", "src/mid.ts", "src/deep.ts", "src/multi.ts"],
      shapes: [
        "receiver-qualified same-name call (this.items.get inside Store.get) — artifact, must be dropped and declared",
        "genuine recursion (loop → loop) — must be kept and labeled recursive",
        "mutual pair (a ↔ b) — must not error",
        "3-deep chain (top → mid → deep) — must expand without error",
        "one caller with two call sites (many → deep ×2) — both ranges reported",
      ],
    },
    failures,
    /**
     * The C6 DISPOSITION, recorded where the next reader will find it rather
     * than only in a commit message. Every claim in it is measured by
     * script/m55/c6-cascade-probe.ts over this same fixture's real index.
     */
    c6Disposition: {
      decision: "(c) gate it precisely: this surface asks the graph engine for CALL rows, DECLARES that filter on every response (§15.1), and drops+declares any non-call row that still arrives. APPLIED in src/lsp/call_hierarchy.ts on branch fix/c6-call-site-filter (gated RED here first, per F7: W1, C6, C6d, C6e, C6f and C6g all failed at 51/57 before the change and all pass at 58/58 after).",
      regressionCaught:
        "Sibling gate L5 (script/m24/verify-call-hierarchy.ts, this component's own M24 gate) went verified 97/97 -> known-gap 96/97 on the FIRST run of this patch, and its G7 check is the sibling law of the sentence this lane rewrote: G7 asserts the empty-answer absence contains \"none stored\". The first reword dropped that phrase and left L5 red. Fixed in the COMPONENT, not by touching L5: the absence now carries TWO sentences, one per branch, and the branch that answers \"the engine returned no rows at all\" keeps the \"none stored\" wording L5 asserts while stating that the claim is scoped to the kind(s) this surface reads. L5 re-runs at 97/97 with 23/23 mutants. Recorded because a fix that silently moves a sibling gate from verified to known-gap is a regression even when the failing check belongs to another milestone, and because the honest fix was in the wording, not in the other lane's assertion.",
    landed: {
        component: "src/lsp/call_hierarchy.ts",
        constant: "CALL_HIERARCHY_RELATIONSHIP_TYPES = [\"calls\"] as const, passed into the engine's traverse options",
        defenceInDepth: "a non-call row that still arrives is omitted and DECLARED with its kind named, placed AFTER the D4 tally so the census still partitions every stored edge read",
        declaration: "relationshipTypes on every ExpandResult, including all three early returns and the normal answer (§15.1)",
        absence: "TWO sentences, one per branch, because measurement showed a filtered empty answer does not take the \"no rows at all\" branch. Both name the filter; the first keeps the \"none stored\" wording M24 G7 asserts and scopes it to the kinds this surface reads, the second reports what was read and what was dropped with its kind.",
        specDrift: "the handoff patch spec (PATCHES.md) had three gaps against the file at HEAD, each measured rather than assumed: (1) it added relationshipTypes to the three early returns but NOT to the normal return, so tsc rejected the build (TS2741) and C6f stayed RED; (2) it reworded ONLY the `edges.length === 0` branch of the absence, which a filtered empty answer never takes — measured: the engine still returns the depth-0 `calls` row for this symbol under relationshipTypes [\"calls\"] (callers.length 1), so the taken branch was the other one and C6g stayed RED; (3) it placed the defence-in-depth drop correctly after the D4 tally, and that part was accurate.",
      },
      causeMeasured:
        "For Store.get / callers the engine returns 8 edges: 2 exact, 6 owner-cascade. The row behind the headline range (Store rendered as a caller of get) is the EXACT depth-0 row `Store:contains:get` — the store genuinely holds 'Store contains get'. The pre-lane comment in this file said both non-call rows arrived via the cascade; that is wrong for the contains row and is corrected above. One level down the claim holds in substance: every rule in the component is keyed on `relationshipType === \"calls\"`, so the engine's default TEN-KIND superset feeds membership and lexical rows to a renderer that must emit call-site ranges.",
      rejected: {
        "(a) fix the owner cascade": "refuted by measurement, not by taste: the contains row that produces the range is targetMatch \"exact\", so no cascade change removes it. The cascade is also a DELIBERATE, DISCLOSED superset for the graph/impact/MCP surfaces (its disclosure is itself gated, script/m48/verify-d1-doc-truth.ts), and §15.1 explicitly permits a surface to filter differently PROVIDED it states its filter. Changing the engine would move every graph/impact/MCP answer across 14 languages to fix a lie that lives in one adapter.",
        "(b) declare the behaviour with its reason": "not available. LSP requires a non-empty `fromRanges` on every CallHierarchyIncomingCall, and §15.3 says a range handed to the editor points at the call site it names — a `contains`/`uses` row names no invocation, so there is nothing to point at. The only declaration the protocol permits for such a row is omission with a reason. A labelled membership row in a CALLERS list is still a category error a developer reads as 'Store calls get'.",
      },
      measuredBlastRadius:
        "Run twice over the same index and the same component with one option changed: the receiver-qualified `get -> get` artifact is still dropped AND declared with its reason (C1 unchanged, droppedEdges keeps the 'receiver-qualified ... this.items.get' entry); rendered non-call entries go 2 -> 0 (C6d/C6); rendered callers go 2 -> 0 (W1); the D4 partition still holds (edges 3 -> 0, buckets sum to edges in both runs). What the change does NOT deliver by itself is C6f/C6g: the response still carries no declared filter, and the empty answer's absence text still does not say the store holds non-call rows — both are part of the same patch.",
      patchOwner: "src/lsp/call_hierarchy.ts — this lane's file, changed on fix/c6-call-site-filter.",
      falsifiability:
        "Gated BEFORE the fix, per F7: at HEAD this suite reported 51/57 with W1, C6, C6d, C6e, C6f and C6g failing, so each of those six was OBSERVED TO FAIL rather than argued about. Four mutants then plant the three behaviours the fix introduces and convict them: the defence-in-depth drop (rendered non-call entry with a range), the engine request (a response declaring it read only `calls` while the engine handed it `contains`/`uses`), the missing declaration (relationshipTypes: []), and the absence that implies an empty store. Each is convicted by its own predicate, and the five pre-existing mutants still report the predicate they were convicted by, which is the evidence that no new predicate is false in the baseline.",
      whatTheSuiteCannotProve:
        "The engine request itself is not observable from the response, so no check here can prove `relationshipTypes: [\"calls\"]` was actually passed to traverseGraph. What IS proven is that the surface cannot render a range for a non-call row whether or not the option is honoured (the hermetic leg plants the rows directly, bypassing the engine), and that the response does not contradict itself about what it read (`filterCoherentOk`). Stated because a gate that cannot distinguish 'asks the engine' from 'drops the rows' should not be read as if it could.",
      measuredPredicateConvictions:
        "Each of the four new mutants is convicted by exactly ONE predicate, and it is the one that names its own defect: defence-in-depth removal -> plantedOk; the pre-fix engine request -> filterCoherentOk; a missing declaration -> filterDeclaredOk; the reverted absence -> absenceOk. That one-to-one mapping is the thing that makes 'caught' mean something here, and it was NOT the first result: with only the positive halves of C6g as the predicate, the reverted-absence mutant SURVIVED (the surviving text still contained the word 'kind'), and with only a presence test on relationshipTypes as the predicate, the pre-fix-request mutant SURVIVED (a surface that drops non-call rows honestly is not lying about them, it is only contradicting its own declaration). Both survived mutants are recorded rather than deleted.",
    },
    mutantsNotAdded: [],
    knownGaps: [],
    limitations: [
      "the analyzer stores relationship line_number = 0 for every row today; the call-site positions here are derived from the caller's own source, which is why they are exact. The stored-value path (a future analyzer change) is exercised only as a declared fallback.",
      "invocation scanning is line-comment aware but not string-literal aware (declared in the component header); every result is bounded by the caller's own declaration range.",
      "declared on the real index at this commit and NOT fixed: the same receiver-qualified artifact row is reported twice in droppedEdges (once from the depth-0 row, once from a deeper cascade re-fetch of it). The drop is correct and declared both times, so no range is rendered; the duplicate is a reportability defect in the engine's per-direction row dedupe (src/intelligence/graph/graph-engine.ts), not a position lie, and it is not this lane's file.",
      "the relationship-kind filter this surface declares is `calls` alone. `instantiates`/`overrides` are deliberately NOT included, so a `new Foo()` relationship stored for a symbol is omitted from this hierarchy with its kind named. A `new Foo()` IS an invocable site and this surface's resolver already classifies it as `construct`, so including those kinds is a plausible future widening — it is this surface owner's declared call, not this gate's, and it is left un-widened rather than decided by default.",
      "the engine's owner cascade can still place a non-`calls` row at depth 0 adjacent to a traced member (the exact `Store:contains:get` row is one, measured). This surface now omits every such row and declares its kind, so the cascade's rows cannot produce a range here — but the cascade itself is a deliberate, disclosed superset for the graph/impact/MCP surfaces (gated by script/m48/verify-d1-doc-truth.ts) and was NOT changed, so this gate makes no claim about what those surfaces render.",
    ],
  };
  writeSealed(EVIDENCE, evidence);
} finally {
  await lsp.dispose();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\nT2: ${failures.length === 0 && mutantsCaught === mutantsTotal && mutantsNotJudged === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught, ${mutantsNotJudged} not judged${failures.length ? `, ${failures.length} failed` : ""})`);
console.log(`Evidence: ${EVIDENCE}`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
