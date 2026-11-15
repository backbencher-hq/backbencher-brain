// M60 groovy ontology pass — a RECEIVER that is not a name.
//
// `collectFieldAccessUses` used to take the receiver from
// `node.text.split(".")[0]`, which is correct only while the receiver happens to
// be a bare identifier. Three ordinary Groovy shapes are not:
//
//   new File(dir).canonicalFile   receiver is an `object_creation_expression`
//   verdicts[0].rev               receiver is an `array_access`
//   (m).label                     receiver is a `parenthesized_expression`
//
// Measured on the pinned corpus (script/m60/groovy-r7-census.ts, 2,825
// `.groovy`/`.gradle` files), the split produced relationship SOURCES that are
// not names at all: `new File(args`, `verdicts[0]`, `(m)`. A source like that
// names no symbol, resolves at no end, and is indistinguishable to a consumer
// from a legitimately dotted call path — which is exactly the ambiguity the call
// walk already removed for `calls` (see `buildGroovyQualifiedCall`: `db.list(user)
// .collect` used to be stored whole).
//
// The rule this fixture pins is the one the walk already applied to a receiver it
// could not resolve: the read belongs to the enclosing method. A method body that
// reads `new File(dir).canonicalFile` performs that read; the constructor is not
// the caller and the argument list is not a caller.
//
// Every pinned member is a DISTINCT name, and that is load-bearing rather than
// stylistic: the walk deduplicates reads per FILE by `(source, member)`, so two
// reads of the same member name from the same owner collapse into one edge. Pinning
// `other.label` next to `(m).label` would have proved nothing — the second row
// would be absent under the fix AND under the defect.
//
// The four controls are what make the surrounding attribution look like a rule
// change rather than a regression. `other.controlName` has a plain identifier
// receiver, and it is attributed to the enclosing METHOD like every other
// non-`this` read (GAD1/JAD2) — identical before and after the change, which is
// what makes it a control. `this.label` keeps the TYPE owner, the java/scala
// family contract. And `plain.method()` is a CALL, so `method` must not appear as
// a read target at all.

class Reader {
  String label = "x"

  String read(String dir, Object m) {
    // receiver: object_creation_expression — source must NOT be a text fragment
    String a = new File(dir).canonicalFile
    // receiver: array_access — same
    String b = verdicts[0].rev
    // receiver: parenthesized_expression — same
    String c = (m).label
    // CONTROL 1: a plain identifier receiver keeps its own name as the source
    String recv = other.controlName
    // CONTROL 2: this.x keeps the TYPE owner, never the method
    String t = this.label
    // CONTROL 3: a method_invocation is a call, never a member read
    String e = plain.method()
    // A MEMBER written as a string literal — the Gradle DSL spelling of a dotted
    // property key, and the same text-slice defect one level down: `node.text.split(".")`
    // ends at `release'`, so the target carried a quote. The `field` node is a
    // `character_literal` whose value is `maven.compiler.release`.
    String f = buildModel.properties.'maven.compiler.release'
    return "${a}${b}${c}${recv}${t}${e}${f}"
  }

  String other = "o"
  String controlName = "c"
  Map buildModel = [:]
  Map properties = [:]
  List verdicts = []
  static class Holder { String configure() { return "" } }
  static Holder build() { return new Holder() }
  static String plain() { return "" }
  static String method() { return "" }
}