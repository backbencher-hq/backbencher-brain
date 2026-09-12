// script/m55/verify-governance.ts — M55.G1 (issue #773).
//
// Governance for "The Hub That Tells the Truth". Beyond the M24/M42/M44-style
// ledger validation (structure, closure rules, mutant proofs), this gate owns
// three things no component verifier can own:
//
//   1. the LADDER: no issue may be `verified` while an issue BEFORE it in the
//      ledger is still `planned` — the ledger order IS the dependency order
//      (G1 -> T1..T5 -> P1 -> V1 -> X1), so a closable issue sitting behind a
//      planned prerequisite is a machine-detected error, not a review note;
//   2. the CONTRACT AMENDMENT: §15 Truth Rules must be present in
//      docs/IDE-HONESTY-CONTRACT.md with all six rules, and the screenshot
//      protocol doc must carry the facts Truth Rule 5 depends on (bundle hash
//      = HEAD build, external declared fixture, blocked-with-reason states);
//   3. the BAR RE-AUDIT: the M44 and M53 completion bars are re-run HERE, on
//      every run — the M53 R1 ladder drives the whole m24->m44 gate chain
//      (including both closures) and the M53 closure gate re-checks its own
//      bar. "v8 started on a closed v7" is a machine fact, not a claim.
//
// Evidence staleness is RELEVANCE-based (the M24.G1 rule): an issue's evidence
// is stale only when a file relevant to THAT issue changed since its commit.
// Unrelated lanes moving do not invalidate an M55 evidence file — otherwise
// every co-agent commit would red the ledger.
//
// Env: BB_M55_SKIP_LADDER=1 records the bar re-audit as BLOCKED with a reason
// (the shared verify chain runs those same gates individually, so a full-chain
// run would otherwise pay for them twice). A blocked bar is recorded, never
// silently passed: the gate's status follows it.
//
// Run: npx tsx script/m55/verify-governance.ts
// Evidence: validation/m55/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..");
const LEDGER = path.join(ROOT, "validation/m55/results/manifest.json");
const RESULTS = path.join(ROOT, "validation/m55/results");
const PLAN = path.join(ROOT, "docs/m55/M55-MASTER-PLAN.md");
const PROTOCOL = path.join(ROOT, "docs/m55/SCREENSHOT-PROTOCOL.md");
const CONTRACT = path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md");
const PACKAGE = path.join(ROOT, "package.json");

const EXPECTED_CODES = ["G1", "T1", "T2", "T3", "T4", "T5", "P1", "V1", "X1"];

/** The six Truth Rules, exactly as they must appear in the contract. */
const TRUTH_RULES = [
  "**One surface, one answer.**",
  "**Identity is stated.**",
  "**Positions are where the thing is.**",
  "**Human text is human.**",
  "**The editor is the gate.**",
  "**Space is the user's.**",
];

/** Facts the screenshot protocol must carry for Truth Rule 5 to be gateable. */
const PROTOCOL_FACTS: Array<{ label: string; needle: string }> = [
  { label: "bundle hash equals the HEAD build", needle: "hash" },
  { label: "the external declared fixture", needle: "bb-demo-hub" },
  { label: "blocked states are declared, never silent", needle: "blocked" },
  { label: "a frame is READ before it is evidence", needle: "Reading the frames" },
];

/** Per-issue relevant files: evidence stays fresh while none of these changed
 *  since the evidence commit. Mirrors the M24.G1 relevance rule. */
const ISSUE_RELEVANT_FILES: Record<string, string[]> = {
  G1: ["script/m55/verify-governance.ts", "docs/m55/M55-MASTER-PLAN.md", "docs/m55/SCREENSHOT-PROTOCOL.md"],
  T1: ["src/lsp/identity.ts", "script/m55/verify-identity.ts"],
  T2: ["src/lsp/call_hierarchy.ts", "src/lsp/positions.ts", "script/m55/verify-call-hierarchy.ts", "script/m55/t2-fixture.ts"],
  T3: ["src/lsp/usage_vocabulary.ts", "script/m55/verify-usage-vocabulary.ts"],
  T4: ["src/lsp/signature.ts", "script/m55/verify-signatures.ts"],
  T5: ["src/lsp/tiers.ts", "script/m55/verify-tiers.ts"],
  P1: ["ide/vscode/src/panel-placement.ts", "script/m55/verify-panel-placement.ts"],
  V1: ["script/m55/verify-live-surface.ts", "script/m55/screenshot-protocol.ts"],
  X1: ["script/m55/verify-closure.ts"],
};

/** Lanes whose files an M55 evidence run may never touch (plan completion bar
 *  item 4). Diff-asserted against every M55 evidence file's recorded working
 *  tree. */
const FORBIDDEN_LANE_PREFIXES = [
  "script/m14/", "script/m37/", "script/m45/", "script/m49/", "script/m50/",
  "validation/m14/", "validation/m37/", "validation/m45/", "validation/m49/", "validation/m50/",
  "src/ast/", "src/analysis/",
];

type Status = "planned" | "verified" | "known-gap" | "blocked";

interface EvidenceRecord {
  status: Status;
  currentCommit: string;
  verifierCommand: string;
  evidenceFile: string;
  passed: number;
  failed: number;
  realFailed?: number;
  negativeCases?: number;
  mutantsCaught?: number;
  mutantsTotal?: number;
  workingTreeRelevantChanges?: string[];
  generatedAt?: string;
}

interface Issue {
  code: string;
  githubIssue: number;
  tool: string;
  status: Status;
  scope: string;
  acceptanceCriteria: string[];
  closureRequirements: string[];
  progress?: {
    stage: string;
    verifiedAt: string;
    fixes: string[];
    remaining: string[];
    defectsReportedToOtherLanes?: string[];
  };
  evidence: EvidenceRecord;
}

interface Ledger {
  schemaVersion: number;
  milestone: string;
  githubMilestone: number;
  title: string;
  status: string;
  authority: string;
  governingContract?: string;
  prerequisite?: string;
  protocol?: string;
  issues: Issue[];
}

interface EvidenceFile {
  issue?: string;
  code?: string;
  status?: string;
  passed?: number;
  failed?: number;
  realFailed?: number;
  negativeCases?: number;
  mutantsCaught?: number;
  mutantsTotal?: number;
  currentCommit?: string;
  verifierCommand?: string;
  evidenceFile?: string;
  workingTreeRelevantChanges?: string[];
}

let checks = 0;
let passed = 0;
let negatives = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  checks++;
  if (condition) passed++;
  else {
    failures.push(detail ? `${label} — ${detail}` : label);
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function negative(label: string, condition: boolean, detail = ""): void {
  negatives++;
  check(`${label} [negative]`, condition, detail);
}

// ---------------------------------------------------------------------------
// Ledger validation — pure over an injected context so the mutants can run it
// in memory without touching disk.
// ---------------------------------------------------------------------------

interface Ctx {
  currentCommit: string;
  isAncestor: (commit: string) => boolean;
  readEvidence: (file: string) => EvidenceFile | null;
  changedSince: (commit: string, files: string[]) => string[];
  plan: string;
  protocol: string;
  contract: string;
}

function collectErrors(ledger: Ledger, ctx: Ctx): string[] {
  const errors: string[] = [];
  if (ledger.schemaVersion !== 1) errors.push("schemaVersion");
  if (ledger.milestone !== "M55" || ledger.githubMilestone !== 55) errors.push("milestone");
  if (!ledger.authority || !ledger.title) errors.push("identity");
  if (!ledger.governingContract || !ledger.prerequisite || !ledger.protocol) errors.push("contract-fields");
  if (!Array.isArray(ledger.issues) || ledger.issues.length !== EXPECTED_CODES.length) errors.push("issue-count");

  const codes = new Set<string>();
  const githubNumbers = new Set<number>();
  let seenPlanned = false;
  for (const issue of ledger.issues ?? []) {
    if (!EXPECTED_CODES.includes(issue.code)) errors.push(`code:${issue.code}`);
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`);
    codes.add(issue.code);
    if (!Number.isInteger(issue.githubIssue) || githubNumbers.has(issue.githubIssue)) errors.push(`github-issue:${issue.code}`);
    githubNumbers.add(issue.githubIssue);
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`);
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`);
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`);
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`);

    if (issue.status === "planned") {
      seenPlanned = true;
      // Partial work is allowed and must be declared: a planned issue carrying
      // progress must say what is still missing, and an issue that claims
      // verified work must never carry a `remaining` list.
      if (issue.progress !== undefined) {
        if (!Array.isArray(issue.progress.remaining) || issue.progress.remaining.length === 0) {
          errors.push(`progress-without-remaining:${issue.code}`);
        }
        if (!issue.progress.stage || !issue.progress.verifiedAt) errors.push(`progress-hollow:${issue.code}`);
      }
    } else {
      // The ladder: a verified issue may not sit behind a planned prerequisite.
      if (seenPlanned) errors.push(`ladder-order:${issue.code}`);
      if ((issue.progress?.remaining ?? []).length > 0) errors.push(`closable-with-remaining:${issue.code}`);
      const e = issue.evidence;
      if (e === undefined || e.status !== issue.status) errors.push(`evidence-status:${issue.code}`);
      else {
        if (!e.verifierCommand || !e.evidenceFile) errors.push(`evidence-identity:${issue.code}`);
        if (!(e.passed > 0)) errors.push(`evidence-passed:${issue.code}`);
        const realFailed = typeof e.realFailed === "number" ? e.realFailed : e.failed;
        if (realFailed !== 0) errors.push(`evidence-failed:${issue.code}`);
        const mutantProof =
          typeof e.mutantsCaught === "number" &&
          typeof e.mutantsTotal === "number" &&
          e.mutantsCaught > 0 &&
          e.mutantsCaught === e.mutantsTotal;
        if (!mutantProof && !((e.negativeCases ?? 0) > 0)) errors.push(`evidence-can-fail:${issue.code}`);
        // The referenced evidence FILE is the machine-emitted record: it must
        // exist, corroborate the verdict, and be fresh by relevance.
        const file = ctx.readEvidence(e.evidenceFile);
        if (file === null) errors.push(`evidence-file-missing:${issue.code}`);
        else {
          if (file.status !== "verified") errors.push(`evidence-file-status:${issue.code}`);
          if (typeof file.realFailed === "number" && file.realFailed !== 0) errors.push(`evidence-file-failed:${issue.code}`);
          if (file.code !== issue.code) errors.push(`evidence-file-code:${issue.code}`);
          if (file.verifierCommand !== undefined && file.verifierCommand !== e.verifierCommand) errors.push(`evidence-command-drift:${issue.code}`);
          const commit = file.currentCommit ?? "";
          if (!/^[0-9a-f]{40}$/.test(commit)) errors.push(`evidence-commit:${issue.code}`);
          else if (!ctx.isAncestor(commit)) errors.push(`evidence-commit-not-ancestor:${issue.code}`);
          else {
            const relevant = ISSUE_RELEVANT_FILES[issue.code] ?? [];
            const changed = ctx.changedSince(commit, relevant);
            if (changed.length > 0) errors.push(`evidence-stale:${issue.code}(${changed.join(",")})`);
          }
          for (const f of file.workingTreeRelevantChanges ?? []) {
            if (FORBIDDEN_LANE_PREFIXES.some((p) => f.startsWith(p))) errors.push(`lane-violation:${issue.code}(${f})`);
          }
        }
      }
    }
  }

  // The plan, the protocol and the contract amendment are the milestone's
  // authority documents: they must carry what the ledger points at.
  if (!ctx.plan.includes("## Truth Rules")) errors.push("plan-truth-rules");
  if (!ctx.plan.includes("## Milestone completion bar")) errors.push("plan-completion-bar");
  if (!ctx.contract.includes("## 15. Truth Rules (M55 amendment")) errors.push("contract-section");
  for (const rule of TRUTH_RULES) {
    if (!ctx.contract.includes(rule)) errors.push(`contract-rule:${rule}`);
  }
  for (const fact of PROTOCOL_FACTS) {
    if (!ctx.protocol.includes(fact.needle)) errors.push(`protocol:${fact.label}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function main(): void {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
  const plan = readFileSync(PLAN, "utf8");
  const protocol = readFileSync(PROTOCOL, "utf8");
  const contract = readFileSync(CONTRACT, "utf8");

  let currentCommit = "unknown";
  try {
    currentCommit = git(["rev-parse", "HEAD"]);
  } catch {}

  const changedSinceCache = new Map<string, string[]>();
  const ctx: Ctx = {
    currentCommit,
    isAncestor: (commit) => {
      try {
        git(["merge-base", "--is-ancestor", commit, "HEAD"]);
        return true;
      } catch {
        return false;
      }
    },
    readEvidence: (file) => {
      const p = path.join(RESULTS, file);
      if (!existsSync(p)) return null;
      try {
        return JSON.parse(readFileSync(p, "utf8")) as EvidenceFile;
      } catch {
        return null;
      }
    },
    changedSince: (commit, files) => {
      if (files.length === 0) return [];
      const key = `${commit}:${files.join("|")}`;
      const hit = changedSinceCache.get(key);
      if (hit !== undefined) return hit;
      let changed: string[] = [];
      try {
        changed = git(["diff", "--name-only", commit, "HEAD", "--", ...files]).split("\n").filter((l) => l !== "");
      } catch {
        changed = ["git-diff-unavailable"];
      }
      // Working-tree edits count: evidence produced before an uncommitted edit
      // of the same component is stale for the same reason.
      try {
        const dirty = git(["status", "--porcelain", "--untracked-files=all"])
          .split("\n")
          .map((l) => l.slice(3).trim())
          .filter((l) => l !== "" && files.includes(l));
        changed = Array.from(new Set([...changed, ...dirty]));
      } catch {}
      changedSinceCache.set(key, changed);
      return changed;
    },
    plan,
    protocol,
    contract,
  };

  // --- G1: the ledger at HEAD ------------------------------------------------
  console.log("G1: ledger, contract amendment and protocol");
  const errors = collectErrors(ledger, ctx);
  check("G1: the M55 ledger is structurally valid at HEAD", errors.length === 0, errors.join("; "));
  check("G1: every expected code is present exactly once", EXPECTED_CODES.every((c) => ledger.issues.some((i) => i.code === c)));
  check("G1: the ledger status is mechanical (closed only when every issue is verified)", (() => {
    const allVerified = ledger.issues.every((i) => i.status === "verified");
    return ledger.status === (allVerified ? "closed" : "open");
  })(), `ledger=${ledger.status}`);
  check("G1: §15 Truth Rules present in the contract with all six rules", TRUTH_RULES.every((r) => contract.includes(r)));
  check("G1: the screenshot protocol carries the Truth-Rule-5 facts", PROTOCOL_FACTS.every((f) => protocol.includes(f.needle)));
  const verifiedCount = ledger.issues.filter((i) => i.status === "verified").length;
  const partial = ledger.issues.filter((i) => i.status === "planned" && i.progress !== undefined).map((i) => i.code);
  console.log(`      verified: ${verifiedCount}/${ledger.issues.length}${partial.length ? ` · partial: ${partial.join(",")}` : ""}`);

  // --- G1 wiring: the gate itself must be in the chains ----------------------
  const pkg = readFileSync(PACKAGE, "utf8");
  check("G1: the governance gate is wired into the shared verify chain", pkg.includes("script/m55/verify-governance.ts"));

  // --- Mutants: the ledger rules can FAIL ------------------------------------
  console.log("\nG1: mutants (the closure rules must be able to fail)");
  const clone = (): Ledger => JSON.parse(JSON.stringify(ledger)) as Ledger;

  const mMissing: Ledger = clone();
  const mMissingIssue = mMissing.issues[1]!;
  mMissing.issues[1] = {
    ...mMissingIssue,
    status: "verified",
    progress: { stage: "t", verifiedAt: "2026-09-12", fixes: [], remaining: [] },
    evidence: { ...mMissingIssue.evidence, status: "verified", passed: 39, failed: 0, realFailed: 0, mutantsCaught: 5, mutantsTotal: 5, evidenceFile: "NOPE.json" },
  };
  const mMissingErrors = collectErrors(mMissing, ctx);
  negative("G1: a verified issue whose evidence file is missing", mMissingErrors.some((e) => e.startsWith("evidence-file-missing")), mMissingErrors.join("; ").slice(0, 200));

  const mStale: Ledger = clone();
  const mStaleIssue = mStale.issues[1]!;
  mStale.issues[1] = {
    ...mStaleIssue,
    status: "verified",
    progress: { stage: "t", verifiedAt: "2026-09-12", fixes: [], remaining: [] },
    evidence: { ...mStaleIssue.evidence, status: "verified", passed: 39, failed: 0, realFailed: 0, mutantsCaught: 5, mutantsTotal: 5 },
  };
  const staleCtx: Ctx = { ...ctx, readEvidence: () => ({ ...(ctx.readEvidence(mStaleIssue.evidence.evidenceFile) ?? {}), currentCommit: "0".repeat(40) }) };
  const mStaleErrors = collectErrors(mStale, staleCtx);
  negative("G1: a stale commit pin (evidence commit is not an ancestor of HEAD)", mStaleErrors.some((e) => e.startsWith("evidence-commit-not-ancestor")), mStaleErrors.join("; ").slice(0, 200));

  const mNoAcceptance: Ledger = clone();
  mNoAcceptance.issues[1] = { ...mNoAcceptance.issues[1]!, acceptanceCriteria: [] };
  negative("G1: an issue with no acceptance criteria", collectErrors(mNoAcceptance, ctx).some((e) => e.startsWith("acceptance:")), "");

  const mLadder: Ledger = clone();
  mLadder.issues[0] = { ...mLadder.issues[0]!, status: "planned", progress: { stage: "open", verifiedAt: "2026-09-12", fixes: [], remaining: ["the rest of G1"] } };
  const mLadderIssue = mLadder.issues[1]!;
  mLadder.issues[1] = {
    ...mLadderIssue,
    status: "verified",
    progress: { stage: "t", verifiedAt: "2026-09-12", fixes: [], remaining: [] },
    evidence: { ...mLadderIssue.evidence, status: "verified", passed: 39, failed: 0, realFailed: 0, mutantsCaught: 5, mutantsTotal: 5 },
  };
  negative("G1: a closable issue behind a planned prerequisite", collectErrors(mLadder, ctx).some((e) => e.startsWith("ladder-order")), "");

  const mContract: Ctx = { ...ctx, contract: contract.replace("**Identity is stated.**", "**Identity is implied.**") };
  negative("G1: a missing Truth Rule in the contract", collectErrors(clone(), mContract).some((e) => e.startsWith("contract-rule")), "");

  const mLane: Ledger = clone();
  const laneIssue = mLane.issues[1]!;
  mLane.issues[1] = {
    ...laneIssue,
    status: "verified",
    progress: { stage: "t", verifiedAt: "2026-09-12", fixes: [], remaining: [] },
    evidence: { ...laneIssue.evidence, status: "verified", passed: 39, failed: 0, realFailed: 0, mutantsCaught: 5, mutantsTotal: 5 },
  };
  const laneCtx: Ctx = { ...ctx, readEvidence: () => ({ ...(ctx.readEvidence(laneIssue.evidence.evidenceFile) ?? {}), workingTreeRelevantChanges: ["src/ast/real-java-analyzer.ts"] }) };
  negative("G1: a lane violation recorded in an evidence file", collectErrors(mLane, laneCtx).some((e) => e.startsWith("lane-violation")), "");

  // --- The bar re-audit: the M53 R1 ladder + the M53 closure -----------------
  console.log("\nG1: the M44/M53 bars (re-audited on every run)");
  const ladderBlocked = process.env.BB_M55_SKIP_LADDER === "1";
  const ladder: Array<{ gate: string; exit: number; lastLine: string }> = [];
  let barStatus: "verified" | "blocked" | "failed" = "verified";
  let barReason = "";
  if (ladderBlocked) {
    barStatus = "blocked";
    barReason = "BB_M55_SKIP_LADDER=1 — the ladder's own gates are run individually by the shared verify chain in this mode (declared, never a silent pass)";
    console.log(`      blocked: ${barReason}`);
  } else {
    for (const [gate, script] of [["m53-ladder", "script/m53/verify-r1-ladder.ts"], ["m53-closure", "script/m53/verify-closure.ts"]] as const) {
      let exit = 1;
      let out = "";
      try {
        out = execFileSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 });
        exit = 0;
      } catch (e: any) {
        exit = e.status ?? 1;
        out = String(e.stdout ?? "");
      }
      const lastLine = out.split("\n").filter((l) => l.trim() !== "").pop() ?? "";
      ladder.push({ gate, exit, lastLine });
      console.log(`      ${gate}: exit=${exit} · ${lastLine.slice(0, 110)}`);
    }
    if (ladder.some((l) => l.exit !== 0)) {
      barStatus = "failed";
      barReason = ladder.filter((l) => l.exit !== 0).map((l) => `${l.gate} exit=${l.exit}`).join(", ");
    }
    check("G1: the M44 bar (via the M53 R1 ladder, which includes m44-closure) re-audits green at HEAD", ladder.find((l) => l.gate === "m53-ladder")?.exit === 0, ladder.find((l) => l.gate === "m53-ladder")?.lastLine ?? "");
    check("G1: the M53 completion bar re-audits green at HEAD", ladder.find((l) => l.gate === "m53-closure")?.exit === 0, ladder.find((l) => l.gate === "m53-closure")?.lastLine ?? "");
  }

  // --- Evidence --------------------------------------------------------------
  mkdirSync(RESULTS, { recursive: true });
  const realFailed = failures.length;
  const status =
    realFailed > 0 || barStatus === "failed" ? "known-gap" : barStatus === "blocked" ? "blocked" : "verified";
  const workingTreeRelevantChanges = (() => {
    try {
      return git(["status", "--porcelain", "--untracked-files=all"])
        .split("\n")
        .map((l) => l.slice(3).trim())
        .filter((l) => l !== "" && (l.startsWith("script/m55/") || l.startsWith("validation/m55/") || l.startsWith("docs/m55/")));
    } catch {
      return ["git-status-unavailable"];
    }
  })();

  const evidence = {
    issue: "M55.G1",
    code: "G1",
    milestone: "M55",
    status,
    checks,
    passed,
    failed: 0,
    realFailed,
    negativeCases: negatives,
    currentCommit,
    workingTreeRelevantChanges,
    verifierCommand: "npx tsx script/m55/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    ledger: {
      issues: ledger.issues.length,
      verified: ledger.issues.filter((i) => i.status === "verified").map((i) => i.code),
      planned: ledger.issues.filter((i) => i.status === "planned").map((i) => i.code),
      partial: ledger.issues.filter((i) => i.status === "planned" && i.progress !== undefined).map((i) => i.code),
      ledgerStatus: ledger.status,
    },
    contract: { section15: "docs/IDE-HONESTY-CONTRACT.md", rules: TRUTH_RULES.length },
    bar: { status: barStatus, reason: barReason, ladder },
    failures,
    limitations: [
      "The bar re-audit runs the M53 R1 ladder (m24->m44 gate chain, including both closures) as subprocesses; under heavy machine load those gates' latency budgets can miss, which this gate reports as a failed bar rather than retrying silently.",
      "Relevance-based staleness mirrors M24.G1: a file not listed for an issue does not invalidate its evidence. The list is maintained here; a new component must be added to it when its issue lands.",
      "The in-editor legs (V1's frames) are out of this gate's reach: it can only assert that the ledger points at evidence files, never that a frame was read by a human.",
    ],
  };
  writeFileSync(path.join(RESULTS, "G1.json"), `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`\nG1: ${status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`);
  console.log(`Evidence: ${path.join(RESULTS, "G1.json")}`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(realFailed === 0 && barStatus !== "failed" ? 0 : 1);
}

main();
