// PINS the swift wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
// Uniform wave convention: type Greeter with method greet, exercised in main.

import Foundation

/// A greeter that reports the number of items it stores.
class Greeter {
    private let items: [String]

    init(items: [String]) {
        self.items = items
    }

    /// Returns the greeting for the stored items.
    func greet() -> String {
        return "hello \(items.count)"
    }
}

func main() {
    let greeter = Greeter(items: ["a", "b"])
    print(greeter.greet())
}

main()
