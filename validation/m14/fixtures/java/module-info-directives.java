/**
 * EXPORTS-JAVA2 fixture: JPMS module directives (module-info.java).
 *
 * Every directive shape the grammar can produce is present, because the
 * directive table is read from the grammar's FIELD names and the field names
 * differ per shape:
 *
 *   requires MODULE;                    field `module`
 *   requires [transitive|static] MOD;   field `module` AFTER a `requires_modifier`
 *                                        named child — the shape that makes
 *                                        "first named child" read the modifier
 *   exports PACKAGE [to M (, M)*];      field `package` + repeated `modules`
 *   opens   PACKAGE [to M (, M)*];      field `package` + repeated `modules`
 *   uses    TYPE;                       field `type`
 *   provides SERVICE with IMPL (, IMPL)*; fields `provided` + repeated `provider`
 *
 * The edges are `references`, not `exports`, and the reason is a storage
 * contract rather than taste: a JPMS directive names a PACKAGE, and
 * parallel-indexer.ts:3462-3467 drops any `exports` row whose source or target
 * is path-shaped, which every Java package name is.
 */
module com.example.app {
    requires java.logging;
    requires transitive com.example.core;
    requires static jdk.unsupported;

    exports com.example.api;
    exports com.example.internal.spi to com.example.core, com.example.tools;
    opens com.example.model to com.example.tools;

    uses com.example.spi.Service;
    provides com.example.spi.Service with com.example.impl.ServiceImpl, com.example.impl.AltImpl;
}