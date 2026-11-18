import heritagedisambig.Widget;

/**
 * JLS 7.5.1: the single-type import binds the simple name `Widget` throughout this
 * compilation unit, so both the `extends` clause and the `new Widget()` below mean
 * the top-level heritagedisambig.Widget - not either of the two nested types.
 *
 * The extends target is written as the bare leaf, and so is the instantiation
 * target; the analyzer must re-spell both to the imported path because the bare leaf
 * is ambiguous across three project declarations.
 */
public class Child extends Widget {
    Widget field = new Widget();

    void run() {
        field = new Widget();
    }
}
