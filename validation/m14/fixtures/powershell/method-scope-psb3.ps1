# PS3/PS4 — a METHOD is a scope, and a CONSTRUCTOR is owned by its class.
#
# WHY. Two separate defects met in one file, and both were measured at the
# SURFACE, not in the analyzer.
#
# PS3: the pre-wave lane pushed an owner only for `function_statement` /
# `class_statement` / `enum_statement` — never for `class_method_definition` — so
# every call written inside a method was attributed to the CLASS. Indexed as a
# project, `bb_graph Start` on a method that IS called returned
# `callers: []` (the caller's source was the placeholder `global`, so no edge
# reached the method) AND `callees: []` (its own calls sat on the class): a dead
# end in both directions, reported with `evidenceClass: "inferred"` and no
# disclosure. M59 #879 and the web family's #814 ruling both point at the
# enclosing METHOD, because it composes with the call graph — a class's incoming
# edges should be its own, not every method's.
#
# PS4: PowerShell writes a constructor with the CLASS's own name, so the
# pre-wave guard "a constructor never contains itself" suppressed the
# containment edge — and the store then refused the owner too, because its
# M51.A1 self-ownership guard compares `parentSymbol.name !== symbol.name`.
# Measured: every PowerShell class constructor stored with
# `owner_symbol_id = NULL` while the property and method beside it were linked.
# csharp settled the shape: a member whose SYMBOL NAME the source never writes
# takes the synthesised name `constructor` and rides a `contains` edge.

class Deployment {
    [string]$Name
    hidden [int]$Retries = 3
    static [string]$Kind = 'web'

    Deployment([string]$name) {
        $this.Name = $name
        Write-Verbose 'constructing'
    }

    [void] Start() {
        Write-Host 'starting'
        $this.Retries = 5
    }

    [string] Describe([int]$Depth) {
        return $this.Name
    }

    # PSD20 — PowerShell names are case-INSENSITIVE, the gate's key space is not: this read of
    # `$this.name` is the SAME property as `[string]$Name`, and it is published under the DECLARED
    # spelling so it resolves.
    [string] FoldedRead() {
        return $this.name
    }
}

class TurboDeployment : Deployment {
    [void] Start() {
        Write-Host 'turbo'
    }
}

$d = [Deployment]::new('web')
$d.Start()
$d.Describe(1)
$t = [TurboDeployment]::new('turbo')
$t.Start()
