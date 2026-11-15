// Edge-case fixture — pins the rare shapes probe-verified against the pinned
// tree-sitter-swift grammar: conditional compilation, closures/lambdas,
// optional chaining + binding, do/catch + throw, defer, operators, protocol
// property declarations, subscripts, and actor/struct base semantics.

#if os(iOS)
import UIKit
#else
import Foundation
#endif

import Combine

/// Operator overloads — method symbols (binary_operator instead of a name
/// identifier), and their bodies' calls attributed to the operator method.
struct Vector {
    var x: Double
    var y: Double

    static func + (lhs: Vector, rhs: Vector) -> Vector {
        Vector(x: lhs.x + rhs.x, y: lhs.y + rhs.y)
    }

    static func == (lhs: Vector, rhs: Vector) -> Bool {
        lhs.x == rhs.x && lhs.y == rhs.y
    }
}

/// Protocol with property requirements — protocol_property_declaration.
protocol Shape: AnyObject {
    var area: Double { get }
    var label: String { get set }
    func describe() -> String
}

/// A class whose FIRST base is a protocol (no superclass) — every base is an
/// adoption, so it must be implements, never extends (SWIFTD1 resolution,
/// pins the in-file protocol-kind map).
final class Circle: Shape {
    var area: Double { 3.14 }
    var label: String = "circle"
    func describe() -> String { label }
}

/// Closure capture + higher-order usage.
final class Calculator {
    private var history: [Double] = []

    func apply(_ fn: (Double) -> Double, to value: Double) -> Double {
        let result = fn(value)
        self.history.append(result)
        return result
    }

    func doubleAll(_ values: [Double]) -> [Double] {
        values.map { $0 * 2 }
    }
}

/// Optional handling + error handling + defer in one method.
enum ParseError: Error {
    case invalid
}

func parse(_ raw: String?) throws -> Int {
    defer { cleanup() }
    guard let text = raw else { throw ParseError.invalid }
    do {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return Int(trimmed) ?? 0
    } catch {
        throw ParseError.invalid
    }
}

/// Subscript — not a symbol (C# indexer precedent), but its body's calls
/// still emit.
final class Registry {
    private var entries: [String: Int] = [:]

    subscript(key: String) -> Int? {
        get { entries[key] }
        set { entries[key] = newValue }
    }

    func lookup(_ key: String) -> Int {
        self[key] ?? 0
    }
}
