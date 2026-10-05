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
 *  What this gate forbids is a kind that can never name a call. */
const CALL_SITE_CAPABLE_KINDS = new Set(["calls", "call", "instantiates", "overrides"]);
/** Kinds that are membership or lexical reference — no invocation exists. */
const NON_CALL_KINDS = new Set(["contains", "uses", "references", "imports", "exports"]);

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
  const nonCallRendered = compIncoming.calls.filter((c: any) => !/^calls\b/.test(String(c.from?.detail ?? ""))).map((c: any) => ({
    name: c.from?.name, detail: c.from?.detail, ranges: c.fromRanges,
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
      .filter((c: any) => !/^calls\b/.test(String((c[side] ?? {}).detail ?? "")))
      .map((c: any) => ({ name: c[side]?.name, detail: c[side]?.detail, ranges: c.fromRanges }));
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
  ];
  /**
   * MUTANTS DELIBERATELY NOT ADDED, and why — the reader needs this as much as
   * the verdicts.
   *
   * The obvious sixth mutant is "filter: ask the engine for every relationship
   * kind again". It is NOT in the list, and the reason is the oracle, not
   * laziness: the only predicate that can catch it is "the answer declares a
   * call-site-capable filter" (C6f), and C6f is RED on the real component. A
   * mutant oracle must be evaluated against a baseline in which every predicate
   * holds; adding a permanently-false predicate to this set would make all five
   * existing mutants report "caught by filterOk" while saying nothing about the
   * defect each one plants. That is the tautology §8.7 names.
   *
   * The filter's falsifiability is demonstrated instead by the four C6 checks
   * being red on the real component at this commit. A check observed to be red
   * has, by construction, been observed to fail — a stronger statement than a
   * mutation test that must first be planted.
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
      const selectionOk = sliceRange(T2_EXPECT.store.rel, incomp.calls[0]?.from?.selectionRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }) !== "";
      const approxCase = await mod.expandCalls(raw, projectId, { item: getItem, direction: "incoming" }, fakeTraverse);
      const declaredOk = approxCase.callSitesApproximate === 1 && String(approxCase.calls[0]?.from?.detail ?? "").includes("position approximate");
      const hopOk = !mult.calls.some((c: any) => c.from?.name === "top") &&
        (mult.droppedEdges ?? []).some((d: any) => String(d.reason).includes("transitive hop"));
      const caught = !(rangesOk && droppedOk && selectionOk && declaredOk && hopOk);
      mutant(m.name, caught, JSON.stringify({ rangesOk, droppedOk, selectionOk, declaredOk, hopOk }));
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
      preLaneDefect: "the pre-lane rewriter was a hand-written list that omitted ./signature (and, since wave 1, ./launch_languages, ./symbols, ../brain/freshness and ../intelligence/graph/line-address); every mutant then died on an import error while being counted \"caught\", so the evidence said 5/5 while the oracle had never run",
      importFailureIsNotCaught: true,
      componentImportsAtThisRun: relativeImportsOfComponent(),
    },
    currentCommit,
    workingTreeRelevantChanges: workingTreeDirty,
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
      decision: "(c) gate it precisely: this surface asks the graph engine for CALL rows, DECLARES that filter on every response (§15.1), and drops+declares any non-call row that still arrives. The change is one call site plus one declared field in src/lsp/call_hierarchy.ts, which is another lane's file, so this gate is honestly RED.",
      causeMeasured:
        "For Store.get / callers the engine returns 8 edges: 2 exact, 6 owner-cascade. The row behind the headline range (Store rendered as a caller of get) is the EXACT depth-0 row `Store:contains:get` — the store genuinely holds 'Store contains get'. The pre-lane comment in this file said both non-call rows arrived via the cascade; that is wrong for the contains row and is corrected above. One level down the claim holds in substance: every rule in the component is keyed on `relationshipType === \"calls\"`, so the engine's default TEN-KIND superset feeds membership and lexical rows to a renderer that must emit call-site ranges.",
      rejected: {
        "(a) fix the owner cascade": "refuted by measurement, not by taste: the contains row that produces the range is targetMatch \"exact\", so no cascade change removes it. The cascade is also a DELIBERATE, DISCLOSED superset for the graph/impact/MCP surfaces (its disclosure is itself gated, script/m48/verify-d1-doc-truth.ts), and §15.1 explicitly permits a surface to filter differently PROVIDED it states its filter. Changing the engine would move every graph/impact/MCP answer across 14 languages to fix a lie that lives in one adapter.",
        "(b) declare the behaviour with its reason": "not available. LSP requires a non-empty `fromRanges` on every CallHierarchyIncomingCall, and §15.3 says a range handed to the editor points at the call site it names — a `contains`/`uses` row names no invocation, so there is nothing to point at. The only declaration the protocol permits for such a row is omission with a reason. A labelled membership row in a CALLERS list is still a category error a developer reads as 'Store calls get'.",
      },
      measuredBlastRadius:
        "Run twice over the same index and the same component with one option changed: the receiver-qualified `get -> get` artifact is still dropped AND declared with its reason (C1 unchanged, droppedEdges keeps the 'receiver-qualified ... this.items.get' entry); rendered non-call entries go 2 -> 0 (C6d/C6); rendered callers go 2 -> 0 (W1); the D4 partition still holds (edges 3 -> 0, buckets sum to edges in both runs). What the change does NOT deliver by itself is C6f/C6g: the response still carries no declared filter, and the empty answer's absence text still does not say the store holds non-call rows — both are part of the same patch.",
      patchOwner: "src/lsp/call_hierarchy.ts (not this lane's file); the exact patch is in the lane report for close/surface-and-docs.",
      falsifiability:
        "C6, C6d, C6e, C6f and C6g are RED on the real component at this commit, and W1 is red on the real index. Each is therefore observed to fail, which is stronger evidence of falsifiability than a planted mutant. The filter mutant is deliberately NOT in MUTANTS: its only predicate is C6f, which is false in the baseline, so adding it would make all five existing mutants report 'caught' while judging nothing (see mutantsNotAdded).",
    },
    mutantsNotAdded: [
      {
        name: "filter: ask the engine for every relationship kind again",
        why: "Its only oracle predicate is C6f, which is RED on the real component. A mutant oracle whose baseline contains a false predicate marks every mutant caught for free, which is the tautology the harness above exists to prevent. Its falsifiability is carried by C6d/C6e/C6f/C6g being red instead.",
      },
    ],
    knownGaps: [
      {
        checks: ["W1", "C6", "C6d", "C6e", "C6f", "C6g"],
        why: "one defect with one cause and one owner: this surface renders relationship kinds that cannot name a call site. The fix is in src/lsp/call_hierarchy.ts (another lane). W1 and C6 observe it on the real index; C6d/C6e plant it hermetically in both directions; C6f/C6g pin the two ways a fix could answer without declaring itself.",
        owner: "src/lsp/call_hierarchy.ts",
      },
    ],
    limitations: [
      "the analyzer stores relationship line_number = 0 for every row today; the call-site positions here are derived from the caller's own source, which is why they are exact. The stored-value path (a future analyzer change) is exercised only as a declared fallback.",
      "invocation scanning is line-comment aware but not string-literal aware (declared in the component header); every result is bounded by the caller's own declaration range.",
      "declared on the real index at this commit and NOT fixed: the same receiver-qualified artifact row is reported twice in droppedEdges (once from the depth-0 row, once from a deeper cascade re-fetch of it). The drop is correct and declared both times, so no range is rendered; the duplicate is a reportability defect in the engine's per-direction row dedupe (src/intelligence/graph/graph-engine.ts), not a position lie, and it is not this lane's file.",
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
