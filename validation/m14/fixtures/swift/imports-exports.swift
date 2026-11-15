// INCOMING_SWIFT — the two relationship types this lane did not emit
// (`imports`, `exports`), pinned as behaviour with the shapes probe-verified
// against the pinned tree-sitter-swift grammar.
//
// The expectations were derived from the LANGUAGE and the GRAMMAR, not from a
// run of the new code:
//
//   `imports`      Swift's import declaration names a MODULE. The module path
//                  parses as ONE `identifier` node whose `simple_identifier`
//                  children are the dotted segments, an optional kind keyword
//                  (`import struct Swift.Optional`) precedes it, and an
//                  attribute arrives as `modifiers > attribute > "@" +
//                  user_type > type_identifier` holding the word after the `@`.
//                  Corpus: 234 import nodes in 125 of 300 files; 204 single,
//                  2 dotted, 2 kind-restricted, 6 `@_exported`, 9 `@_spi`,
//                  7 `@_spiOnly`, 2 `@_implementationOnly`.
//   `exports`      Swift has no `export` keyword. The export surface IS the
//                  visibility modifier: `public`/`open` is a DECLARED
//                  `visibility_modifier` token, and `@_exported import X` /
//                  `public import X` are the two constructs that re-publish a
//                  module. Corpus: 1,297 visible declarations in 120 of 300
//                  files (1,290 public, 7 open), 681 of them at file scope.
//                  DERIV_EXPORTS_SWIFT4 narrowed the LABEL to file-scope
//                  declarations: a MEMBER is reached through its type (the
//                  family's `contains`, go GO7), so it is not a second
//                  publication of the module's surface.
//
// Two things this fixture FORBIDS, because both are the failure the gate exists
// to catch:
//
//   - `exports` for an `internal`/`private` declaration. Visibility is the whole
//     rule; a declaration carrying no access modifier is not part of a module's
//     surface.
//   - `exports` for the extension BLOCK itself. `extension Store` is a
//     declaration-site artifact, not a name another module imports; only its
//     members are made public by it, and even they are reached through `Store`.
import Foundation
import struct Swift.Optional
@testable import MyModule
@_exported import ReExported

public struct Store {
    public private(set) var count: Int = 0
    public init() {}
    public func bump() { count += 1 }
    private func hidden() {}
    func implicit() {}
}

open class Base {}

public protocol Proto {
    func requirement()
}

// A `public extension` makes its members public — Swift's own rule: `added`
// publishes as a `public` SYMBOL. It is not a module-level EXPORT (a member's
// publication is reached through its type), and neither is a member of the
// class body.
public extension Store {
    func added() {}
}

struct Internal {
    var value = 0
}
// Ownership is a TYPE's. A declaration inside a function body is not a member
// of anything, so no `contains` edge may name the function as its owner — this
// is the defect the lane's span oracle found (143 `contains` edges on the
// 800-file corpus draw had a FUNCTION owner).
func makeHolder() {
    class Local {}
    struct Pair { var a = 0 }
    _ = Local()
    _ = Pair()
}
