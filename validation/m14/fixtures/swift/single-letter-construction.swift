// SWIFTD17 regression fixture (OO family closure #613 family sweep): bare
// capitalized calls are constructions (instantiates ONLY) regardless of name
// length. `E()` where `struct E: Error` is declared in-file was mislabeled
// `calls` by the old `length > 1` carve-out (inherited from M12.21 with no
// rationale; 15 sites in the swift-nio corpus tests). Also pins the
// multi-char construction path and the lowercase free-function path.
struct E: Error {}

class Kit {
    func run() throws {
        throw E()
    }
}

class Engine {
    func makeFailedFuture<E: Error>(_ e: E) -> Int { 0 }
    func go() {
        _ = makeFailedFuture(E())
        _ = Kit()
    }
    func lower() {
        _ = self.describe()
    }
    func describe() -> Int { 1 }
}
