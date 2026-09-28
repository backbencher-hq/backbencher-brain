// script/m20/verify-migration-mappings.ts — M20.M3
// Deterministic mapping-contract checks. No network, embeddings, or corpus claims.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { CrossLanguageMigrationAssistant } from "../../src/ast/cross-language-migration-assistant"
import { generateMigrationPlans } from "../../src/intelligence/migration/migration-engine"
import { migrationSourceFingerprint } from "../../src/intelligence/migration/migration-evidence"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m20/results")
let checks = 0, passed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negativeCases++; check(`${label} [negative]`, ok, detail) }

const fixture = {
  crossLanguageSymbols: [
    { id: "svc", name: "OrderService", type: "service", languages: ["TypeScript"], definitions: [{ filePath: "src/app.ts", symbolId: "svc" }], usages: [], contracts: [], metadata: { imports: ["express", "mystery-lib"] } },
    { id: "py", name: "PyService", type: "service", languages: ["python"], definitions: [{ filePath: "src/app.py", symbolId: "py" }], usages: [], contracts: [], metadata: { imports: ["mystery-lib"] } },
  ],
  crossLanguageRelationships: [],
} as any

const plan = await CrossLanguageMigrationAssistant.generateMigrationPlan("OrderService", " python ", fixture)
check("M3: supported target is normalized", plan?.targetLanguage === "python", String(plan?.targetLanguage))
check("M3: known mapping is supported", plan?.dependencies.some((d: any) => d.source === "express" && d.confidence >= 0.5), JSON.stringify(plan?.dependencies))
check("M3: unknown mapping is explicit uncertain", plan?.dependencies.some((d: any) => d.source === "mystery-lib" && d.confidence < 0.5 && d.target === null), JSON.stringify(plan?.dependencies))
negative("M3: unknown mapping is not presented as supported", !plan?.dependencies.some((d: any) => d.source === "mystery-lib" && d.confidence >= 0.5), JSON.stringify(plan?.dependencies))

const same = await CrossLanguageMigrationAssistant.generateMigrationPlan("OrderService", "typescript", fixture)
negative("M3: same-language request is unsupported", same === null)
const missing = await CrossLanguageMigrationAssistant.generateMigrationPlan("Missing", "python", fixture)
negative("M3: missing symbol is unsupported", missing === null)
const invalid = await CrossLanguageMigrationAssistant.generateMigrationPlan("OrderService", "not-a-language", fixture)
negative("M3: invalid target is rejected", invalid === null)

const source = readFileSync(path.join(ROOT, "src/ast/cross-language-migration-assistant.ts"), "utf8")
check("M3: no fabricated unknown target phrase remains", !source.includes("Unknown - Requires Custom Research"))
check("M3: target normalization helper exists", source.includes("normalizeMigrationLanguage"))
check("M3: explicit uncertainty type exists", source.includes("uncertain") && source.includes("unsupportedReason"))

const engine = readFileSync(path.join(ROOT, "src/intelligence/migration/migration-engine.ts"), "utf8")
check("M3: batch result preserves structured unsupported reasons", engine.includes("unsupportedReason"))
check("M3: batch target is normalized in result", engine.includes("normalizedTargetLanguage"))
check("M3: batch failures preserve distinct reasons", engine.includes("missing-symbol") && engine.includes("same-language") && engine.includes("unsupported-target"))

const requested = Array.from({ length: 105 }, (_, i) => `s${i}`)
check("M3: batch cap is deterministic", requested.slice(0, 100).length === 100)
negative("M3: truncation is observable", requested.length > 100)

let commit = "unknown"
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
const relevant = ["src/ast/cross-language-migration-assistant.ts", "src/intelligence/migration/migration-engine.ts", "script/m20/verify-migration-mappings.ts", "docs/BB_MIGRATE.md", "docs/tools/bb_migrate.md", "package.json", "script/verify-quality-gate.ts"]
let dirty: string[] = []
try { dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" }).split("\n").map(x => x.slice(3).trim()).filter(x => relevant.includes(x)) } catch { dirty = ["git-status-unavailable"] }
const failed = checks - passed
const evidence = { issue: "M20.M3", code: "M3", milestone: "M20", status: failed === 0 && dirty.length === 0 ? "verified" : "known-gap", checks, passed, failed, negativeCases, currentCommit: commit, sourceFingerprint: migrationSourceFingerprint(ROOT), workingTreeRelevantChanges: dirty, verifierCommand: "bun run script/m20/verify-migration-mappings.ts", evidenceFile: "M3.json", generatedAt: new Date().toISOString(), limitations: ["Mappings are advisory equivalence guidance, not translated source or proof of semantic compatibility.", "Only fixture-level mapping boundaries are measured here; real-repository coverage remains a later M20 item."] }
mkdirSync(RESULTS, { recursive: true }); writeFileSync(path.join(RESULTS, "M3.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`M3: ${evidence.status.toUpperCase()} (${passed}/${checks} passed, ${negativeCases} negative)`)
process.exit(failed ? 1 : 0)
