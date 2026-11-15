# PS12/PS13/PS15/PS24 — the data shapes PowerShell is actually written in.
#
# PS15. A hashtable literal `@{ Key = Value }` is the most idiomatic PowerShell
# data structure, and the pre-wave lane named NEITHER `hash_entry` NOR
# `key_expression` — 711 keys in the production draw published no symbol and no
# edge. A key DECLARES a named slot; a `$h.Key` read is a use of it.
#
# PS12. `[int]$x` and `[ValidateSet('a')]$x` are typed declarations. The grammar
# has real node names for both (`attributed_variable`, `cast_expression`) that
# the pre-wave lane named neither, so a typed declaration with no assignment
# published nothing at all.
#
# PS13. A `switch` CASE is a decision point. `switch_clause` was never named, so
# a ten-case switch measured a cyclomatic complexity of 1 — 174 `switch_clause`
# nodes in the production draw, all uncounted.
#
# PS24. A class-typed member is how two classes in one file refer to each other.
# The pre-wave lane read such a type only into the symbol's `type` metadata —
# which `pool-worker.ts` DROPS at the worker boundary — so `[EventMessage]
# $EventMessage` was the only edge between two classes and it was invisible on
# both sides.

class EventEntry {
    [EventMessage]$Message
    [LogLevel]$Level
    [string[]]$Tags
}

class EventMessage {
    [string]$Body
    [int]$Code
}

enum LogLevel {
    Debug
    Info
}

$options = @{
    Retries = 3
    Label   = 'prod'
    Nested  = @{ Inner = 'x' }
}

[int]$attempts = 0
[string]$label
[int[]]$counts = @(1, 2)
[ValidateSet('a', 'b')]$mode = 'a'
$tags = @('a', 'b')
$first = $tags[0]

switch ($options.Label) {
    'prod' { $label = 'production' }
    'test' { $label = 'testing' }
    default { $label = 'unknown' }
}
