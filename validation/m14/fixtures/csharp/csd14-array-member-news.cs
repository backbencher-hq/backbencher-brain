// CSD14 regression fixture (OO family closure): target-typed `new()` must
// resolve through the DECLARED TYPE of array/collection-typed members —
// element type for collection-initializer positions, base for direct
// property/field initializers — never the member NAME. Also guards the
// nested-expression bail (a new() inside a call argument resolves nothing).
namespace Fixtures
{
    public enum Mode { A, B }

    public sealed class Widget
    {
        public string Label { get; set; } = "";
    }

    public sealed class Kit
    {
        // Collection-expression property: element targets, not the member name.
        public static Widget[] Prebuilt { get; } =
        [
            new() { Label = "x" },
            new() { Label = "y" },
        ];

        // Collection-typed property whose element type leaf differs from the
        // member name — the old direct-child scan self-mapped these.
        public static Mode[] Selected { get; } =
        [
            new(),
            new(),
        ];

        // Array-of-array + generic form: element resolution must strip exactly
        // one container level at each nested position.
        public static Mode[][] Grid { get; } =
        [
            [new(), new()],
            [new()],
        ];

        // Direct target-typed initializer on a field.
        private static readonly Widget Fallback = new();

        // Trailing object initializer: `new() { ... }` — the inner assignment
        // member values must not redirect resolution.
        public static Widget Default { get; } = new() { Label = "z" };

        // Nested inside a call argument — the parameter type is not resolvable
        // per-file; honest no-edge for the inner new (outer ctor call still
        // attributed through the explicit type).
        public static string Describe() => Label(new() { Label = "inner" });

        private static string Label(Widget w) => w.Label;
    }
}
