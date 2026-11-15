// module-exports.swift — the `exports` rule, authored from the Swift language's
// access-control rule BEFORE the analyzer was run against it (M14 honesty
// contract §5.2: expectation files are authored before observing output).
//
// THE RULE UNDER TEST
//
// Swift has no `export` keyword. Measured on 400 tracked .swift files of
// swift-corpus with the pinned grammar: 150 distinct node types produced, ZERO
// of them naming an export declaration, and ZERO anonymous `export` tokens.
//
// The export CONSTRUCT nonetheless exists, and it is access control: a top-level
// declaration whose access level is `public` or `open` is visible to — and
// therefore exported by — every module that imports this one. That is the same
// relation java's exports oracle derives from JLS 7.6 ("a type in a named package
// is exported iff it is public"), the same one go derives from a capitalized
// package-scope name, and the same one python derives from `__all__`.
//
// Three scope decisions, each pinned by a `forbidRelationships` entry below, so
// that widening the rule later has to break this fixture instead of passing it:
//
//   1. TOP-LEVEL ONLY. A member is published as part of its type; it is never
//      imported on its own (`Foo.bar` is reached through `Foo`), so a member is
//      not a second publication of the module's surface.
//   2. NOT AN EXTENSION. An extension symbol is named after the EXTENDED type
//      (`public extension Array` is named `Array`), so exporting it would name a
//      declaration this file does not contain — the extended type is declared
//      (and exported, if public) elsewhere. Extension MEMBERS inherit the
//      block's access level (Swift's own rule), but they are reached through the
//      extended type and are never module-level names.
//   3. `package` (SE-0386) is NOT included: it measures 0 parseable occurrences
//      corpus-wide because the pinned grammar does not reduce it
//      (`package struct C {}` becomes an ERROR node holding the token).

import Foundation

// --- exported: public and open at top level -------------------------------
public struct Repository {
  public var name: String = ""
  public func find(_ id: Int) -> String { name }
}

open class BaseService {
  open func describe() -> String { "" }
}

public protocol Resettable {
  func reset()
}

public typealias Handler = (Int) -> Void

public func topLevelHelper() -> Int { 1 }

// `open`/`public` on a MEMBER must not be a second publication.
public class Service {
  public var counter: Int = 0
  public func run() {}
  open func overridable() {}
}

// --- not exported: internal / private / fileprivate ------------------------
struct InternalStore {
  func touch() {}
}

private func hidden() {}

fileprivate func alsoHidden() {}

internal func explicitlyInternal() {}

// --- not exported: an extension, whose members belong to the type ----------
extension Repository: Codable {
  public func encoded() -> Int { 0 }
}

// --- not exported: the default access level is internal -------------------
class ImplicitInternal {
  func quietly() {}
}

// --- not exported: ERROR-recovered header without a visibility modifier ----
// (`nonisolated(unsafe)` in a body costs this grammar its whole class header;
// the recovery must not invent a publication)
class RecoveredNominal {
  func ok() {}
}