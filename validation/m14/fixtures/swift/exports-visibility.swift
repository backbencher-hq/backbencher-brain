// DERIV_EXPORTS_SWIFT4 — the exports surface, pinned.
//
// The handover said "Swift has no export keyword — likely RULED". It does not
// have an export KEYWORD, and that is not the question. Swift expresses module
// export through ACCESS CONTROL, and the pinned grammar reduces it:
//
//   public class C          modifiers > visibility_modifier("public")
//   open class OC           modifiers > visibility_modifier("open")
//   public import M         modifiers > visibility_modifier("public")   SE-0409
//   @_exported import M     modifiers > attribute > user_type > type_identifier
//
// Corpus measurement over the derived 24,386-file population, stride 8 (3,048
// files): 28 `public import`, 29 `@_exported import`, 1,189 `public` nominals in
// 441 files, 5,073 `public` members in 667 files, 62 `open` nominals.
// validation/m14/fixtures/swift/probe-exports-construct.mts is the probe and
// validation/m14/fixtures/swift/census-ontology.mts re-measures the emission.
//
// The five shapes this file pins, each of which a first implementation got
// wrong or a naive one would:
//   1. `public`/`open` on a file-scope declaration IS an export.
//   2. `internal`/`private` are NOT — they are the absence of one.
//   3. a `public` MEMBER of an `internal` type is NOT a module export: Swift
//      caps a member's access at its container's, so it exports nothing.
//   4. a re-exporting import is an export, in ADDITION to the `references` edge
//      the same import already produces — the two facts differ.
//   5. `public extension Array` does NOT export `Array`: it makes the
//      extension's members public. `Array` is the stdlib's declaration.

import Foundation
import protocol ArgumentParser.ExpressibleByArgument
public import WinSDK
@_exported import Utils

public protocol Shape: AnyObject {
    func area() -> Double
}

public struct Widget {
    public var id: Int = 0
    func internalHelper() {}
}

public enum Mode: String {
    case fast
}

public typealias Handle = Int

public func bootstrap() {}

public let globalSeed = 7

open class Service {}

internal class Hidden {
    public func notAnExport() {}
}

private struct Secret {}

public extension Array where Element: Equatable {
    func stableUnique() -> [Element] { self }
}

// A DECORATED export. The declaration node begins on the attribute's line, the
// NAME node is two lines lower, and the M59.A7 line rule requires the edge to
// carry the NAME's line — the one a reader can check against the source. The
// fixture pins the number, because a `public` export whose line names the
// decorator is a line claim nothing can verify (mutant SW-EXP-14).
@available(*, deprecated,
           message: "use Widget instead")
public
class Decorated {}