// M37.14-w2 regression fixture (master-review wave 2): pins SWIFTD17-D19.
//
//  - SWIFTD17: self-container subscript READS and WRITES emit `uses` on the
//    container property — a subscript access is a property read, not a method
//    invocation (family precedent probe-verified 2026-09: php + objc emit the
//    container read for `$this->items[$i]` / `self.items[i] = v`). A pure
//    field write (`self.count = 0`) stays gated (NO uses).
//  - SWIFTD18: multi-binding declarations (`var a = 1, b = 2`) symbolize
//    EVERY binding — the pre-fix code dropped all but the first.
//  - SWIFTD19: dotted qualified names resolve to the LEAF segment for
//    extension targets (`extension Outer2.Inner2` -> `Inner2`, never the
//    container) and inheritance bases (`Foundation.URLSession` -> URLSession).
import Foundation

final class Cache {
    private var storage: [String: Int] = [:]
    private var history: [Int] = []
    private var count = 0
    private var key = "k"

    func subRead(_ k: String) -> Int {
        return self.storage[k] ?? 0
    }

    func subWrite(_ k: String, _ v: Int) {
        self.storage[k] = v
    }

    func keyed() -> Int {
        return self.storage[self.key] ?? 0
    }

    func plainWrite() {
        self.count = 0
    }

    func methodCall() {
        self.history.append(1)
    }
}

// SWIFTD18: multi-binding property + top-level variable declarations.
struct Pair {
    var first = 0, second = 1
    func f() {
        var x = 0, y = 1
        x = y
    }
}
let gTop1 = 1, gTop2 = 2

// SWIFTD19: nested-type extension (leaf name = Inner2) + dotted bases.
struct Outer2 {
    struct Inner2 { var v = 0 }
}
extension Outer2.Inner2: Equatable {
    static func == (l: Inner2, r: Inner2) -> Bool { l.v == r.v }
}
struct M2: SharedMod.Proto {}
final class NetSession: Foundation.URLSession {}
