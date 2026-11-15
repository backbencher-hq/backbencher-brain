/**
 * JLS 7.7 — JPMS. The `exports` type was SILENT on the java corpus (0
 * relationship edges over 3,275 files) because this corpus's exports live in
 * three `module-info.java` files and the analyzer read none of them: the strings
 * `module_declaration` and `exports_module_directive` occurred nowhere in
 * real-java-analyzer.ts. Measured with the grammar inventory over the whole
 * corpus: 3 module-info.java on disk, 3 parsed as `module_declaration` with
 * root.hasError=false, 24 `exports_module_directive` and 12
 * `requires_module_directive` nodes.
 *
 * `requires` is pinned on the IMPORTS channel, not as a relationship, and the
 * reason is a measurement rather than a preference: rel-type-coverage-gate.ts
 * reads the analyzer's CONSTRUCTIBLE types against java's eight audited labels,
 * so emitting `RelationshipType.Imports` edges would take this lane from one
 * DERIVATION finding (`exports`) to two, for 12 rows, on a type no java oracle
 * checks. `ImportInfo` is where the family records dependencies.
 */
module com.example.widget {
    requires java.logging;
    requires transitive com.example.core;
    exports com.example.widget.api;
    exports com.example.widget.spi to java.logging, com.example.core;
}
