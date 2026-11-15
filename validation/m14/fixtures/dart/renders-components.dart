// fixture: dart/renders-components
// THE `renders` FIXTURE — a component RENDERS another component, and the REFUSALS around it.
//
// THE CONTRACT (`src/ast/types.ts:131-140`): *"A component RENDERS another component: source = the
// rendering symbol, target = the rendered component."* The fleet's other lanes publish it in this
// shape — typescript/javascript: the enclosing component function -> the JSX tag name; clojure: the
// enclosing fn -> the component symbol inside a hiccup vector; csharp: the rendering context -> the
// component named by a type argument. DART'S CONSTRUCT IS FLUTTER'S `build` METHOD:
//
//   class Home extends StatelessWidget { Widget build(BuildContext context) => Scaffold(); }
//
// `Home` IS the component and `Scaffold` IS the component it renders — the structural analogue of a
// React component returning `<Scaffold/>`. Dart has no JSX, so the syntax that carries the construct
// is the rendering ENTRY POINT. NO GRAMMAR CHANGE: the existing `method_signature`,
// `function_body`, `const_object_expression`, `new_expression` and `identifier`+`selector` node types
// carry it (R3).
//
// POSITIVE — the edge exists ONLY when the construct reaches the analyzer as a real node. All four
// of dart's construction spellings must publish the SAME edge, because a lane that handled only the
// const form would pass one row and fail the other three.
//   Rendered        RENDERS Scaffold   (the modern call: `=> Scaffold()`)
//   RenderedConst   RENDERS Scaffold   (`=> const Scaffold()`)
//   RenderedNew     RENDERS Scaffold   (`=> new Scaffold()`)
//   RenderedBlock   RENDERS Scaffold   (`{ return Scaffold(); }`)
//
// THE REFUSALS, each named, and each a shape a reader could otherwise believe is a render:
//   1. NotReturned — the construction is NOT the returned expression, so it stays a `calls` row and
//      NO render is published for it. (This is the half a prose claim cannot fake: an analyzer that
//      published a render for EVERY construction in a build method would pass every positive row.)
//   2. ReturnsVariable — the build method returns a variable: no component is NAMED.
//   3. ReturnsCall — the build method returns a call to a helper: no component is NAMED.
//   4. NotAWidget — the declared return type is not `Widget`: not a rendering host.
//   5. Lowercase — a lowercase name is not a class: dart's own naming convention, the same test
//      the JS lane applies to a JSX tag (`<div>` is an intrinsic, not a component).
//   6. The construction that is NOT returned is still a `calls` row — the ordinary row must not be
//      swallowed by the render row.
//
// The source of a render row is the COMPONENT (the class), not the method: `Home` renders
// `Scaffold`, exactly as the JS lane's source is the enclosing component function.

class Rendered extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Scaffold();
}

class RenderedConst extends StatelessWidget {
  @override
  Widget build(BuildContext context) => const Scaffold();
}

class RenderedNew extends StatelessWidget {
  @override
  Widget build(BuildContext context) => new Scaffold();
}

class RenderedBlock extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold();
  }
}

// REFUSAL 1 — the construction is NOT the returned expression.
class NotReturned extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    Scaffold();
    return _cached;
  }

  Widget get _cached => const SizedBox();
}

// REFUSAL 2 — the build method returns a VARIABLE: no component is named.
class ReturnsVariable extends StatelessWidget {
  Widget? _cached;

  @override
  Widget build(BuildContext context) => _cached!;
}

// REFUSAL 3 — the build method returns a CALL to a helper: no component is named.
class ReturnsCall extends StatelessWidget {
  @override
  Widget build(BuildContext context) => _helper();

  Widget _helper() => const SizedBox();
}

// REFUSAL 4 — the declared return type is not `Widget`: not a rendering host.
class NotAWidget {
  int build() => 1;
}

// REFUSAL 5 — a lowercase name is not a class.
class Lowercase extends StatelessWidget {
  @override
  Widget build(BuildContext context) => scaffold();

  Widget scaffold() => const SizedBox();
}
