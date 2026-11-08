// PINS the dart wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
// Uniform wave convention: class Greeter with method greet, exercised in main.

/// A greeter that reports the number of items it stores.
class Greeter {
  final List<String> items;

  Greeter(this.items);

  /// Returns the greeting for the stored items.
  String greet() {
    return 'hello ${items.length}';
  }
}

void main() {
  final greeter = Greeter(['a', 'b']);
  print(greeter.greet());
}
