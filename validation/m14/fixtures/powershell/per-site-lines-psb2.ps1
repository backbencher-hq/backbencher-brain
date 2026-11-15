# PS2 — every relationship carries the line of the node that BEARS ITS NAME, and
# that line is part of the edge's identity.
#
# WHY. The pre-wave lane emitted no `line_number` at all: measured on the
# production draw, 0 of 3,410 relationships carried one, and the graph surface
# rendered `"callSite": {"file": "Deploy.ps1", "line": null}` as if it knew a
# position (M59 #825's per-language handoff, open for this lane). Two sites of
# one callee must be TWO rows: the store resolves a containment edge BY the line
# it carries (M60 #921), and a per-set dedupe key swallows every site but the
# first. bash BD1 is the ruling this adopts.
#
# The trap this file is built around is the WRAPPED declaration. `Get-Thing`'s
# NAME is on line 20 while its `param` block is on 22, and `Invoke-Helper`'s body
# opens on 27 — so an edge stamped with the declaration NODE's start line names a
# line the source does not write the callee on. The three `Invoke-Helper` call
# sites are the second trap: one callee, three lines, and a dedupe key without
# the line keeps only the first. Both are pinned twice: once as the correct
# claim, once as the pre-fix shape in forbidRelationships.

function Get-Thing
{
    param([string]$Name)
    Write-Host $Name
}

function Invoke-Helper {
    param([int]$Count)
    return $Count
}

Get-Thing -Name 'alpha'
Get-Thing -Name 'beta'
Invoke-Helper -Count 1
Invoke-Helper -Count 2
Invoke-Helper -Count 3
