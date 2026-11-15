// #940 / #941 (swift lane, full extent). The pinned grammar cannot parse
// `nonisolated(unsafe)` (newer than the pinned wasm — the same species as
// `~Copyable` and `#assert`), and the failure costs the file its whole `class`
// HEADER: the header and the body land in an ERROR node instead of a
// class_declaration, so no container symbol was ever minted and every member it
// owns was orphaned (`ownerName` undefined — no `contains` edge, no member
// inventory for bare reads, no owner for `self.init`).
//
// The recovery shape is read from the TOKENS, never from source text:
//
//   ERROR
//     child[0] class (anon) "class"                 <- the nominal keyword token
//     child[1] simple_identifier "Container"        <- the recovery's own name
//     child[2] ERROR ": Protocol { ...body... }"
//
// #941 rides on the same file: the convenience initializer BELOW the recovered
// range is a file-scope sibling, so its symbol carries no owner. SW-G says
// "unresolvable stays silent" — an initializer delegation is never a `calls`
// edge (`init` is not a name in this vocabulary; constructors are literally
// `constructor`), and the enclosing symbol's OWN name must never be invented as
// an owner. The resolvable delegation above the recovery point pins the
// positive half: it must still build the recovered container.

final class Container {
    private var count = 0
    private var legacy: Int = 0

    init() {
        self.count = 1
    }

    convenience init(seed: Int) {
        self.init()
        self.count = seed
    }

    func bump() {
        self.count += 1
    }

    func read() -> Int {
        return self.count
    }

    nonisolated(unsafe) var raw: Int = 0

    convenience init(handle: Int) {
        self.init()
        self.count = handle
    }
}
