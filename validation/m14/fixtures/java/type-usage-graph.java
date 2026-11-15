import java.util.List;
import java.util.Map;

/**
 * Pins the declared-type reference graph: every declaration position
 * (fields, params, locals, catch, throws) must emit References edges to
 * each named type, generics expanded to base + arguments, scoped names
 * kept fully dotted, primitives correctly silent.
 */
class TypeUsageGraph<T extends Comparable<T>> {
    private List<String> names;
    protected Map<String, List<Integer>> index;

    <R> R process(List<? extends CharSequence> input) throws java.io.IOException {
        List<String> local = null;
        // JD-J12 (M60 java deep review, 2026-09-27): `new T[n]` names the ELEMENT
        // type (JLS 15.10.1). Measured on the corpus, 25 array_creation edges per
        // 60-file draw were undetectable by the differential — 100% of them name a
        // target another rule also names in the same file (23/23 throws_type and
        // 25/25 array_creation are subsumed that way) — and no java fixture pinned
        // the rule either. A rule no assertion exercises does not exist, so it is
        // pinned here.
        Gadget[] made = new Gadget[3];
        // The cast spelling fix: the array strip removed the brackets but left the
        // type ARGUMENTS attached, so `(Sprocket<?>[])` published `Sprocket<?>`
        // while every other position published `Sprocket` — the same type under
        // two spellings, and a `Sprocket<?>` row can never match the `Sprocket`
        // that `(Sprocket<?>)` and a `Sprocket<?> field` both emit. The forbid
        // below is the pre-fix spelling, so the regression cannot come back.
        Sprocket one = (Sprocket<?>[]) null;
        try {
            local = List.of("x");
        } catch (java.nio.file.FileSystemException | IllegalArgumentException e) {
            throw new java.io.IOException(e);
        }
        return null;
    }
}

/**
 * JD-J15 (M60 java deep review, 2026-09-27): an INTERFACE's field is a
 * `constant_declaration` in this grammar, not a `field_declaration`, and the
 * branch that created the Constant symbol stored the type on it WITHOUT emitting
 * a References edge. So `interface I { String IDENTITY = "id"; }` published no
 * reference to String at all, while every neighbouring position fired — a class
 * field, an enum's static final field, a record component, an annotation element.
 * An interface's constants are part of its public surface (JLS 9.3), so this was a
 * real hole in the type-usage graph, found by the differential as the last two
 * MISSING rows at 400 files.
 */
interface TypeUsageGraphConstants {
    String IDENTITY = "id";
    Widget DEFAULT_WIDGET = null;
}
