// SWIFTD21: `@_exported import M` is Swift's one explicit re-export verb.
// The pre-fix lane read the module name and stopped, so this statement was
// recorded as an ordinary import and the `exports` relationship never fired.
//
// The `@_exported` is on its OWN line on purpose: that puts the attribute on
// line 11 and the module name on line 12, so an edge lined at the declaration's
// start claims a line whose text is `@_exported` and not a module name. This is
// the M59.A7 line rule the `references` edge for the same statement already
// follows, applied to the new edge.
@_exported
import Basic
import Foundation
@testable import PackageInternal
@_exported import Mixed.Submodule
@_exported import Basic

public struct Holder {
  public var value: Int
  public init() { value = 0 }
  public func describe() -> String { return "\(value)" }
}
