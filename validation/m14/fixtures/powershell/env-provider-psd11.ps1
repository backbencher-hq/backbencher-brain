# PSD11 — `env:` IS THE ENVIRONMENT PROVIDER'S NAMESPACE, SO THE CLAIM IS A LIST, NOT AN OWNER.
#
# `$env:PSModulePath` names a PROCESS environment variable. The prefix is case-insensitive, the
# provider is part of the language, and no project can declare a name spelled `env:Something` — a
# scope-qualified name is never a declaration (PS8's rule, unchanged since the first wave).
#
# MEASURED BEFORE THE CHANGE: the generic reading fired on the `:` and the arbiter refused to check
# it — `verifyExternalClaim` sees a colon and answers UNVERIFIABLE, because a colon is also a
# path/URI byte. Over the whole admitted population that left 855 rows in `ext?`, "a claim no check
# can reach", which clause 1 counts against the lane, on a fact that is not doubtful at all.
#
# The negatives are the point: the prefix test is `env:` exactly, case-folded, so a variable that
# merely STARTS with those letters is not claimed, and a scope prefix the project CAN declare into
# (`global:`, `script:`) is not either.

# 1. POSITIVE — the provider read, lower case.
$modulePath = $env:PSModulePath

# 2. POSITIVE — the same binding in the case a Windows script usually writes it. PowerShell's
#    provider prefixes are case-insensitive, so the test folds case rather than matching bytes.
$temp = $ENV:TEMP

# 3. NEGATIVE TWIN — a plain variable whose name starts with the same three letters. There is no
#    colon, so this is a declaration this file makes, and no namespace claim may attach.
$envLocal = 'not-the-provider'
$envLocal

# 4. NEGATIVE TWIN — a scope prefix the project CAN declare into. `function global:Helper` is
#    ordinary PowerShell, so `global:Helper` is a name this file may bind, not a namespace.
function global:Helper { param($x) $x }
global:Helper -x 1 | Out-Null
