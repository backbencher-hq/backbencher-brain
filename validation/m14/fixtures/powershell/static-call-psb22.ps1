# PS-B22 — a static member call targets the store's qualified name (`Counter.Add`),
# never the source spelling (`Counter::Add`). The class is declared IN THIS FILE, so
# the call has a declaration to bind to; the BCL twin must stay external.

class Counter {
    static [int] Add([int] $a, [int] $b) {
        return $a + $b
    }

    static [int] Zero() {
        return 0
    }
}

function Use-Static {
    $sum = [Counter]::Add(1, 2)
    return [Counter]::Zero() + $sum
}

function Use-Inherited {
    return [Counter]::ReferenceEquals(1, 2)
}

function Use-Bcl {
    return [System.Math]::Max(1, 2)
}
