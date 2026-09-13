// PINS the groovy wave fixture pack (M29.R2 — wave-2 candidate).
// Uniform wave convention (same shape as the wave-1 packs): class Greeter with
// method greet, exercised once from the script method, plus a constant.

class Greeter {
    private final List<String> items

    Greeter(List<String> items) {
        this.items = items
    }

    String greet() {
        return "hello ${items.size()}"
    }
}

def run() {
    def g = new Greeter(["a", "b"])
    println(g.greet())
    println(g.items.size())
}

run()

final CONSTANT = 42
