# PSD13 — THREE SPELLINGS THE OWNER QUESTION CANNOT ANSWER, AND THE CLAIM THAT CAN.
#
# 1. A MODULE-QUALIFIED COMMAND. `Microsoft.PowerShell.Management\Join-Path` is PowerShell's documented
#    way to name one module's command (about_Command_Precedence). The generic externality reading fires
#    on the backslash, and the arbiter then asks about the OWNER of the target — which is
#    `Microsoft.PowerShell`, a string no project declares, so the claim can only be refused (65 rows in
#    `ext?`). The true and checkable claim is the fleet's `moduleNamespace`: "a member of the module named
#    before the backslash", verified against the project's own module space.
#
# 2. A `$using:` READ. Inside a remote scriptblock the engine binds `$Name` from the CALLER's scope;
#    `using` is a reserved scope keyword and no file can declare `using:Something` (measured: zero
#    `function using:…` in the population). It is a NAMESPACE-shaped target, like `env:`, and it carried
#    only the generic marker — 66 rows the arbiter refused.
#
# 3. A QUOTED NAME KEY IS DATA. `$PSDefaultParameterValues['it:skip']` publishes `uses -> it:skip` with
#    `isConstantKey`. The qualified reading fired on the COLON and the claim was unanswerable: a colon in
#    a quoted key is punctuation in DATA, not a scope or provider qualifier.
#
# THE TWO NEGATIVES ARE THE GUARD'S OTHER HALF. A two-segment path (`stage3-release\bin\zig`) and a
# script path (`.\lib\Helper.psm1`) are FILES, not modules — the module claim must not attach. And the
# last row is the control for the key rule: a key whose content is a PATH keeps its reading, because the
# path claim is verified against the project's admitted file list (PS-B18), which is a different question
# from the owner question this wave removes.

# 1. POSITIVE — module-qualified command.
Microsoft.PowerShell.Management\Join-Path -Path a -ChildPath b

# 2. POSITIVE — the using scope, inside the scriptblock the engine ships to the remote session.
$result = Invoke-Command -ScriptBlock { $using:target | Out-Null }

# 3. NEGATIVE TWIN — a quoted NAME key with a colon: data, not a qualified name.
$PSDefaultParameterValues['it:skip'] = $false

# 4. NEGATIVE TWIN — two path segments are a directory path, not a module qualification.
stage3-release\bin\zig build

# 5. NEGATIVE TWIN — an extension leaf is a script on disk, not a command of a module.
& .\lib\Helper.psm1

# 6. CONTROL — a quoted PATH key keeps its reading (PS-B18's rule), because the path claim is answered by
#    the project's admitted file list rather than by the owner question.
$root = $paths['/usr/lib/Helper.ps1']
