// `renders` (R3, no grammar change): a View type's `var body: some View` names
// the component the type renders — the dart lane's `build`-returns-`Widget`
// shape. Both halves of the trigger are structural: the type CONFORMS TO View
// and the property is `body` with type_annotation `: some View`.

import SwiftUI

// THE POSITIVE HOST: CardView renders VStack (the body's top-level DSL call).
struct CardView: View {
  var body: some View {
    VStack {
      Text("hello")
    }
  }
}

// THE ARGUMENT REFUSAL: DetailView() inside NavigationLink's argument list is
// an ordinary instantiates row — only the TOP-LEVEL expression is the rendered
// tree's root (dart's "a construction that is NOT the returned expression").
struct RowView: View {
  var body: some View {
    NavigationLink(destination: DetailView()) {
      Text("row")
    }
  }
}

// THE NON-HOST REFUSAL: a `body` property on a type that does NOT conform to
// View is not a rendering host (the protobuf-builder impostor shape).
struct Builder {
  var body: some View {
    VStack { Text("no host") }
  }
}

// THE NON-BODY REFUSAL: `some View` on a helper member is not the type's
// rendering entry point; only `body` is.
struct HelperView: View {
  var helper: some View {
    VStack { Text("helper") }
  }
  var body: some View {
    Group {
      Text("real body")
    }
  }
}

// THE SCALAR REFUSAL: a member whose declared type is NOT `some View` (here
// `Int`) is never a render site, even on a conforming host — only the typed
// `var body: some View` is.
struct ScalarView: View {
  var x: Int { 0 }
  var body: some View {
    Text("scalar")
  }
}

// THE FUNCTION REFUSAL: a FUNCTION returning `some View` is not the type's
// rendering entry point — the render site is a PROPERTY named `body`, read
// structurally.
struct FunctionView: View {
  func makeView() -> some View {
    VStack { Text("fn") }
  }
}

// THE GENERIC NON-HOST REFUSAL: a generic container that does not conform to
// View is not a rendering host, whatever its `body` property says.
struct GenericBox<T> {
  var body: some View {
    VStack { Text("generic") }
  }
}
