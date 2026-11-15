import java.util.function.Function;
import java.util.function.Supplier;

/**
 * JLS 15.13 — a method reference's first operand is an ExpressionName or a
 * ReferenceType. Three receiver SHAPES that are neither used to publish the
 * receiver's raw text as a `references` target, which is how the analyzer came
 * to emit an edge naming a CALL:
 *
 *   references -> "newArrayList(v3(), v4())"
 *     android/guava-testlib/.../google/MultimapPutIterableTester.java L51, L64
 *   references -> "\"com.google.common.\""
 *     android/guava-tests/test/.../WriteReplaceOverridesTest.java L59
 *   references -> "StandardTable.this"
 *     android/guava/src/.../collect/StandardTable.java L808, L883
 *
 * Measured receiver node types over every method_reference in the corpus (1,117
 * nodes, 306 files): identifier 1,000, field_access 68, this 25,
 * method_invocation 13, generic_type 9, string_literal 2.
 *
 * `identifier` receivers are DELIBERATELY UNCHANGED — that is the shape the
 * differential's `references:getStatus:String` oracle audits, and a fix that
 * moved an audited behaviour would trade a fabrication for an unexplained
 * false negative. This fixture pins both halves: the shapes that must still
 * emit, and the shapes that must not.
 */
public class MethodReferenceShapes {
    private String label = "x";

    Function<String, Integer> byTypeName() {
        return Integer::parseInt;
    }

    Function<String, Integer> byQualifiedTypeName() {
        return java.lang.Integer::parseInt;
    }

    Function<String, Integer> byGenericTypeName() {
        return java.util.Map.Entry::getKey;
    }

    Supplier<String> byBoundInstanceReceiver() {
        return this.label::trim;
    }

    Supplier<String> byQualifiedThis() {
        return MethodReferenceShapes.this.label::trim;
    }

    Function<String, Integer> byLocalVariable() {
        String local = "1";
        return local::length;
    }
}
