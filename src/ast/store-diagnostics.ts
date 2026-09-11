// src/ast/store-diagnostics.ts — #737: per-row FK batch-failure diagnostics.
//
// A single FK constraint failure rolls back the WHOLE storeResults batch, and
// the driver only reports "FOREIGN KEY constraint failed" — no row, no file.
// This module re-executes the failed batch file-by-file with capturing
// statement wrappers to name the exact offending file and statements.
//
// Guarantees (behaviorally gated by script/m54/verify-737-738.ts):
//   - PURE DIAGNOSTICS: the whole re-run happens inside a transaction that
//     always throws at the end, so nothing the diagnose pass writes persists
//     and no counter is touched.
//   - The `stmt` map handed in is restored to its originals on every exit,
//     so the production store path is untouched after diagnosis.
//   - Only FK violations are diagnosed; any other error type returns
//     immediately (normal skip-and-continue path stays untouched).

export interface DiagnosableStatements {
  [name: string]: { run: (...args: any[]) => unknown }
}

export interface StoreDiagnosticsDeps {
  /** Native database handle (rawDb) used to open the diagnostic transaction. */
  rawDb: { transaction: (fn: (...args: any[]) => void) => (...args: any[]) => unknown }
  /** The production batch transaction — re-invoked as tx([oneFileResult]). */
  tx: (batch: any[]) => unknown
  /** The live stmt map whose entries the capture wrappers temporarily replace. */
  stmt: Record<string, any>
  /** The untouched originals restored into `stmt` after diagnosis. */
  stmtOriginal: DiagnosableStatements
  /** Sink for the human-readable diagnostic report (process.stderr in prod). */
  write: (chunk: string) => void
  /** Optional structured-log sink (prod passes the pino-style logger). */
  warn?: (msg: string, ctx: Record<string, unknown>) => void
}

const FK_RE = /FOREIGN KEY constraint failed/i

function describeVal(v: unknown): string {
  if (v === null || v === undefined) return "null"
  if (typeof v === "string") return JSON.stringify(v.length > 80 ? v.slice(0, 77) + "..." : v)
  return String(v)
}

export function createStoreDiagnostics(deps: StoreDiagnosticsDeps) {
  const { rawDb, tx, stmt, stmtOriginal, write } = deps

  return function diagnoseBatchFailure(error: unknown, batch: any[]): void {
    const msg = error instanceof Error ? error.message : String(error)
    if (!FK_RE.test(msg)) return

    const statements: string[][] = []
    const findings: string[] = []
    const capture = (s: { run: (...args: any[]) => unknown }) => ({
      run: (...args: unknown[]) => {
        statements.push(args.map(describeVal))
        return s.run(...args)
      },
    })
    for (const k of Object.keys(stmtOriginal)) stmt[k] = capture((stmtOriginal as any)[k])

    const DIAG_ROLLBACK = "__M54_DIAG_ROLLBACK__"
    try {
      rawDb.transaction(() => {
        for (const result of batch) {
          statements.length = 0
          try {
            // tx([result]) = the exact production store path for one file
            // (tx iterates the array). Nested transaction becomes a SAVEPOINT;
            // the final throw rolls the whole diagnose pass back.
            tx([result])
          } catch (rowError: any) {
            const rowMsg = rowError instanceof Error ? rowError.message : String(rowError)
            if (!FK_RE.test(rowMsg)) throw rowError
            const tail = statements.slice(-6)
            findings.push(
              `file=${(result as any)?.filePath ?? "<unknown>"}\n` +
                tail.map((a, n) => `  stmt[${statements.length - tail.length + n}] ${a.join(" | ")}`).join("\n"),
            )
          }
        }
        // Every batch that reaches here already failed once, so at least one
        // file must re-fail. Throwing forces the full rollback of everything
        // the diagnose pass stored along the way.
        throw new Error(DIAG_ROLLBACK)
      })()
    } catch {
      // Expected: DIAG_ROLLBACK (or a non-FK rethrow mid-diagnose — also fine,
      // the caller's skip path covers it). Everything rolled back either way.
    } finally {
      Object.assign(stmt, stmtOriginal)
    }

    if (findings.length > 0) {
      write(
        `[storeResults][FK-DIAG] ${findings.length} file(s) with FK-violating rows in the rolled-back batch:\n${findings.join("\n")}\n` +
          `[storeResults][FK-DIAG] ^ last statements before the failure per file (violating row is the final one)\n`,
      )
      deps.warn?.("fk batch failure diagnosed", { filesWithViolations: findings.length })
    }
  }
}
