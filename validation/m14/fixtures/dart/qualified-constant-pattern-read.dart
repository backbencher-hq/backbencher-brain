// `M.off` parses TWO different ways, and only one of them was read.
//
// In an expression the grammar builds a head and a link: `mode == M.off` parses
// as `equality_expression(identifier(M), selector(.off))`, and the member-read
// pass sees the `selector` and publishes `uses source -> off`.
//
// In a PATTERN it builds one node: `case M.off:` parses as a single `qualified`
// node under a `constant_pattern`. The string "qualified" appeared nowhere in the
// analyzer, so nothing read it — a switch case naming a declared enum member
// published no edge of any kind. Not `uses`, not `references`, nothing.
//
// The same text, the same meaning, two node shapes, and only the common one was
// handled. Measured over ProxiCall/lib: 2,405 edges recovered across the corpus,
// of which 516 name a symbol declared in the same file — `case
// WalletOperationType.recipientLookup:`, `case SessionOfflineBannerMode.offline
// =>`, `case AppErrorCode.unauthorized:`. Pattern matching is not a niche in
// that codebase: `constant_pattern` appears 3,981 times, `variable_pattern` 325
// times across 110 files.
//
// SCOPE, and the pins that hold it. This fires only where a `qualified` sits
// under a `constant_pattern`, which is unambiguous — it names a constant being
// TESTED. A `qualified` in a TYPE position (`prefix.Type` in an annotation) is a
// different question: it names a type, and whether that deserves a `uses` edge is
// a family decision this lane has not made. Pinning the type position below is
// what keeps that decision open instead of answered by accident.
//
// The DT-F convention this follows — a member read emits WITHOUT requiring the
// target to resolve — is why 1,889 of the 2,405 added edges name a library enum
// (`TargetPlatform.iOS`, an error code from a package) rather than a file
// symbol. That is not new behaviour: the expression form has always emitted
// those, and `uses build -> context` for a parameter is the same shape. Pinned
// at the bottom so it cannot be mistaken for resolution.
//
// Authored BEFORE the analyzer run.
enum WalletOperationType {
  transfer,
  recipientLookup,
  refresh,
}

enum AppErrorCode {
  unauthorized,
  notFound,
  validation,
}

enum ColorSwatch {
  light,
  dark,
}

class WalletState {
  final WalletOperationType operation;

  WalletState(this.operation);

  // FALSE POSITIVE-FREE POSITIVE 1: the switch STATEMENT form, a
  // `switch_statement_case` whose constant is a `qualified` under a
  // `constant_pattern`. This is the shape the corpus is full of and the one that
  // published nothing at all.
  String describeStatement() {
    switch (operation) {
      case WalletOperationType.transfer:
        return "transfer";
      case WalletOperationType.recipientLookup:
        return "lookup";
      case WalletOperationType.refresh:
        return "refresh";
    }
  }

  // POSITIVE 2: the switch EXPRESSION form, a `switch_expression_case`. Same
  // `constant_pattern` wrapper, same `qualified` child — pinned separately
  // because it is a different node type and a fix that only handled one of them
  // would pass the other.
  String describeExpression() {
    return switch (operation) {
      WalletOperationType.transfer => "transfer",
      WalletOperationType.recipientLookup => "lookup",
      WalletOperationType.refresh => "refresh",
    };
  }

  // POSITIVE 3: the if-case form.
  bool isLookup() {
    if (operation case WalletOperationType.recipientLookup) return true;
    return false;
  }

  // THE CONTRAST, and the reason this fixture exists. The SAME text in an
  // EXPRESSION already worked, because the grammar builds a `selector` there and
  // the member-read pass saw it. If the fix were wrong about which shapes to
  // read, this edge would change while the pattern ones appeared.
  bool sameTextInExpression() {
    return operation == WalletOperationType.recipientLookup;
  }

  // A qualified constant in a pattern is a constant being TESTED. A bare STRING
  // is not: `case "light":` matches a literal, and `light` is also an enum
  // member declared above, so a widened walk that resolved the case's text
  // against the symbol table would publish `classify -> light` for a string
  // comparison. Pinned as forbidden below.
  static const String prefix = "wallet";
}

// A `qualified` naming a library enum still publishes, matching the DT-F
// convention that a member read does not require the target to resolve — the
// same reason `uses build -> context` publishes for a parameter. The enum here
// is declared in this file so the pin is about the SHAPE and not about
// resolution.
enum NeverDeclared {
  a,
  b,
}

class ResolvesElsewhere {
  String classify(String mode) {
    switch (mode) {
      // a STRING literal case, and `light` is a declared enum member of
      // ColorSwatch above — this must NOT read it
      case "light":
        return "l";
      case NeverDeclared.a:
        return "a";
      default:
        return "d";
    }
  }
}

// A RECORD TYPE is a declared type, and every one of the three type extractors
// used to accept a fixed five-node list — type_identifier, function_type,
// nullable_type, void_type — that a record fell straight through. So
// `void f((int, String) p)` typed its parameter `dynamic` and
// `({int a, String b}) f()` published no return type at all. Pinned below as a
// PARAMETER type and as a RETURN type, because the two go through different
// extractors and either can regress alone.
//
// The record's field names are part of its type, so the pin spells them: a
// normalizer that rewrote `({DateTime? start, DateTime? end})` into anything
// else would lose the shape the programmer declared.
typedef Reading = ({DateTime? start, DateTime? end, int count});

class RecordTyped {
  // POSITIVE: a record-typed PARAMETER (the parameter extractor's allowlist).
  int countFields((int, String) pair) {
    return pair.$1;
  }

  // POSITIVE: a record-typed RETURN (the return-type extractor's scan).
  ({int count, String label}) describe() {
    return (count: 1, label: 'x');
  }

  // A plain control, so a fix that typed EVERY parameter `dynamic` would be
  // distinguishable from one that merely mishandles records.
  int plain(String s) {
    return s.length;
  }
}
