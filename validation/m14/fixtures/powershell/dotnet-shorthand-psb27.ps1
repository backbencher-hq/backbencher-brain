#requires -Version 5.1
# PS-B27 — A .NET TYPE LITERAL'S ROOT IS A NAMESPACE, NOT AN OWNER; AND A VERSION IS NOT A NAME.
#
# MEASURED, and both halves came from the incoming gate's refuted-claim list rather than from a
# fixture: the whole admitted population read 113 refuted claims (197,028 edges over 1,181 files),
# and 34 of them were `instantiates` rows of ONE shape — `[Text.UTF8Encoding]::new($false)`.
#
# WHY THE CLAIM WAS FALSE. The analyzer published `externalTarget: true`, which the arbiter checks
# by asking about the target's OWNER — everything before the LAST dot — and `Text.UTF8Encoding`'s
# owner is `Text`. The project publishes a VARIABLE named `Text`, so the owner lookup said "the
# project declares that name" and refuted a claim about a .NET type. No file declares a TYPE named
# `Text`; PowerShell classes cannot nest, so no project type can ever be spelled `Text.UTF8Encoding`.
#
# THE FIX IS TO MAKE THE CLAIM SAY WHAT IS TRUE. A bracketed type literal's root is resolved by the
# ENGINE, not by the project: `[Text.UTF8Encoding]` is `System.Text.UTF8Encoding` under PowerShell's
# documented implicit-`System.` rule, and `[System.IO.Path]` needs no rule at all. So the claim is
# the LIST (`languageNamespace`), whose evidence a reviewer can diff, and whose check never asks
# about a name the edge does not carry. The table it is checked against is the framework's own
# direct children of `System`, so a root the table does not carry keeps the old reading.
#
# AND THE VERSION HALF. `#Requires -Version 5.1` (line 1) publishes `references -> 5.1` with
# `requiresVersion: true`, which is a real constraint and stays. What it must NOT carry is an
# externality reading: a version number has no letter in it, so it is not a name in any language
# this fleet reads, and the arbiter's owner question about `5` — the MAJOR VERSION — refuted 13
# such rows across the population on whatever symbol happened to be called that.
#
# MEASURED AFTER: refuted claims 113 -> 60 over the same population. The 53 that left are the 40
# rows whose root the table carries plus the 13 version literals.

# 1. POSITIVE — the shorthand root. `Text` is carried by the table (`System.Text`), so the edge
#    claims the LIST and NOT an owner: `isExternalTarget` is withheld because the arbiter would ask
#    about `Text`.
$utf8 = [Text.UTF8Encoding]::new($false)

# 2. POSITIVE, the same channel with a QUALIFIED owner. `System.Text` carries a dot, so the
#    arbiter's owner question is answerable from the edge's own spelling and BOTH keys publish.
#    A rule that published `languageNamespace` only on the shorthand rows would fail this one, and
#    a rule that published no list at all would fail row 1 — the pair is the check.
$utf32 = [System.Text.UTF32Encoding]::new($false)

# 3. NEGATIVE TWIN — identical shape, a root the documented table does NOT carry. `Foo.Bar` is a
#    type this file creates at runtime, so the row keeps the generic reading and NO namespace
#    claim: a rule that claimed every dotted type-literal root would claim `Foo` and fail here.
Add-Type -TypeDefinition 'namespace Foo { public class Bar { } }'
$bar = [Foo.Bar]::new()

# 4. POSITIVE TWIN for the no-letter rule — a command-position target WITH letters keeps the
#    reading it had at HEAD. The version literal on line 1 carries none, and these two rows are
#    what makes the rule a fact about the spelling rather than a blanket withholding.
Get-ChildItem | Out-Null
