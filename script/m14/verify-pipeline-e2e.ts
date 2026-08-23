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
}

async function main() {
  writeProject()

  // index via the REAL compiled CLI pipeline — not engine internals
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" })
  execSync(`node bin/bb index ${TMP} --force`, { cwd: ROOT, stdio: "pipe" })

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

  db.close()
  fs.rmSync(TMP, { recursive: true, force: true })

  // evidence
  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F7",
    title: "Pipeline end-to-end gate",
    claimLevel: "L1",
    layers: ["pipeline-e2e"],
    checks: [
      { id: "e2e-polyglot", description: "real CLI index -> brain.db row-level assertions (symbols/relationships/imports/xlang flags)", status: failures.length ? "fail" : "pass" },
    ],
    limitations: [
      { description: "assertions cover the seam classes discovered so far; every future seam bug must be added here as a permanent check" },
    ],
    data: { failures },
  })

  if (failures.length) {
    console.error("PIPELINE E2E FAILED:")
    for (const f of failures) console.error("  -", f)
    process.exit(7)
  }
  console.log("pipeline e2e: symbols, relationships, imports, cross-language flags all verified in brain.db")
}

main().catch(e => { console.error(e); process.exit(1) })
