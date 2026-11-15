# PSD10 — A BARE COMMAND NAME IS A COMMAND, AND THE CHANNEL IS THE FACT, NOT THE SPELLING.
#
# The externality reading was SHAPE-based: a Verb-Noun spelling (`Get-ChildItem`) or a qualifier byte
# (`System.IO.Path`, `./build.psm1`). That is a correct test for "this name cannot be a local
# declaration", and it is why a bare `git`, `mkdir` or `dotnet` carried NO reading at all.
#
# MEASURED over the whole admitted population before the change: 34,158 bare command-position rows
# named NOTHING in their own project and carried no claim, so at the arbiter they were
# indistinguishable from broken edges. The 2,758 rows whose name another file does declare are not
# affected: the arbiter consults a claim only where the name model has nothing, so those keep their
# resolved/ambiguous answer and the price of the widening is ZERO refutations.
#
# Every row below has a twin, because the reading must be the CHANNEL and not the bare spelling:
# row 4 is the same bare shape DECLARED by this file, row 5 is a MEMBER call's leaf, and row 6 is a
# relative script path the lane deliberately withholds (PS-B18) — the command reading must not
# resurrect the claim that rule removed.

# 1. POSITIVE — a native program spelled bare: no hyphen, no dot, no shape cue at all.
git status | Out-Null

# 2. POSITIVE — an alias name, which is a command the engine supplies.
cd .

# 3. POSITIVE — the invocation operator with a bare name. `&` is a command by construction.
& whoami

# 4. NEGATIVE TWIN — the SAME bare spelling, declared by THIS file. The guard is the declaration
#    table (`declaredInFile`), not the shape, which is what makes rows 1-3 a claim about the file.
function helper { 'x' }
helper

# 5. NEGATIVE TWIN — a MEMBER call. `$list.Add(1)` publishes `calls -> Add` with
#    `methodCall: true`, and a member name is not a command name: the reading must not reach it.
$list = [System.Collections.Generic.List[int]]::new()
$list.Add(1)

# 6. NEGATIVE TWIN — a relative script path. PS-B18 withheld the reading on this shape on purpose;
#    a fallback that does not respect the refusal would re-publish the claim that rule removed.
& .\lib\Helper.psm1
