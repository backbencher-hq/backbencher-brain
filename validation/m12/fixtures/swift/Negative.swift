// validation/m12/fixtures/swift/Negative.swift
// M12.21 Swift negative fixture:
//   - function-local let/var bindings are NOT symbols (LocalsAreNotSymbols)
//   - function parameters are NOT symbols (ParamsAreNotSymbols)
//   - closures and their parameters are NOT symbols (LambdaParamsAreNotSymbols)
//   - type references (String, Int, Array, [User]) produce NO uses edges
//   - bare stdlib calls (print, String(...)) are filtered (BuiltinsAreFiltered)
//   - switch `case` patterns are NOT enum_member symbols
//   - a local `let u = User(...)` still emits instantiates for the constructor

import Foundation

class Transformer {
    var items: [Int] = []

    func transform(input: String, count: Int) -> [Int] {
        let localA = 1
        let localB = "text"
        let doubled = items.map { $0 * 2 }
        print(localB + localA.description)
        return doubled
    }

    func makeCounter() -> () -> Int {
        var counter = 0
        let increment: () -> Int = {
            counter += 1
            return counter
        }
        return increment
    }

    func useSwitch(value: Int) -> String {
        let label = String(value)
        switch value {
        case 1:
            return "one"
        default:
            return label
        }
    }

    func instantiate() -> String {
        let u = User(id: "x")
        return u.id
    }
}

struct User {
    var id: String
    init(id: String) {
        self.id = id
    }
}
