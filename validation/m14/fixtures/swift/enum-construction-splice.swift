// #942 (swift lane, second corpus, full extent): SW-B converts enum-cased
// member calls (`Path.method(.get)`) into `instantiates` and retires the
// dangling `calls`. The retirement used to remove "the FIRST calls edge with
// this (source, leaf)" — which is a DIFFERENT call site whenever two sites in
// one scope share a leaf name.
//
// Measured on the 98-file alamofire draw (Tests/TestHelpers.swift): a computed
// property `static var get: Endpoint { method(.get) }` lost its real call to
// `Endpoint.method` because a property initializer elsewhere in the same type
// called `Path.method(.get)`. Both sites are attributed to the enclosing TYPE,
// so the two edges collided on (source, leaf).
//
// Both behaviours are pinned here: the construction still converts, and the
// real call to the identically named function SURVIVES next to it.

enum Path {
    case method(Int)
    case upload
}

final class Endpoint {
    var path = Path.method(.get)

    static func method(_ m: Int) -> Int {
        return m
    }

    static var get: Int {
        return method(.get)
    }
}
