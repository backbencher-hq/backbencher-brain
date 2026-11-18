import importdisambig.Filter;

/**
 * JLS 7.5.1: the single-type import binds the simple name `Filter` throughout this
 * compilation unit, shadowing the same-package and nested types. A reference to
 * `Filter` therefore means the top-level `importdisambig.Filter`, and the
 * declared-type edge must be re-spelled to that path because the bare leaf is
 * ambiguous across three project declarations.
 */
public class Use {
    private Filter field;

    void run() {
        field = null;
    }
}
