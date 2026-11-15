# PSA1 — the file is the module: a real owner for top-level declarations and edges.
#
# WHY THIS FILE EXISTS. `src/ast/real-powershell-analyzer.ts` spelled its
# file-scope edge source as the literal string `global`
# (`relSource(): currentOwner() || "global"`), which put `source_external =
# "global"` on every top-level relationship in the language. Two independent
# facts make that unusable rather than merely ugly:
#
#   1. `isIndexArtifactName` (src/ast/analysis-exclusions.ts:129) rejects
#      `global` as a symbol name — so no stored row can ever be the symbol that
#      source names. Measured at the store: on a two-file project, 4 of 7
#      relationships had `source_symbol_id = NULL` and `source_external =
#      "global"`.
#   2. The store's own seam fix for this class (parallel-indexer.ts, M60/#910)
#      only substitutes the importing FILE when the analyzer sets
#      `metadata.fileLevel === true` — and only `real-c-analyzer.ts` and
#      `real-php-analyzer.ts` do. So the answer to "what does this file call"
#      is a constant, on every PowerShell file in every project.
#
# The bash lane already settled the contract (real-bash-analyzer.ts BD2): "The
# file is the unit of bash, so the file is a real owner: every script emits a
# `module` symbol named after its own basename, and top-level declarations and
# top-level edges are owned by it." PowerShell is STRONGER than bash here — a
# `.psm1` IS a module and a `.psd1` IS its manifest — so the same contract is
# the correct one, and the name must be the file's own basename WITH extension,
# because `Build.psm1` and `Build.ps1` are different files.
#
# AUTHORING NOTE (disclosed, not hidden): the reviewer observed this analyzer's
# output before authoring this pin. The expectation below is derived from the
# PowerShell language itself — a script's top-level statements are in the
# script's scope, and a script file is a module — not from what the analyzer
# currently prints. That is why the pin FORBIDS `global` rather than merely
# omitting it: a pin that only asserts the positive would also be satisfied by
# an analyzer that emitted the placeholder as well.

function Get-Config {
    param([string]$Name)
    return $Name
}

$cfg = Get-Config -Name 'prod'
Write-Host $cfg
