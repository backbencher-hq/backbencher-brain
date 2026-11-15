# JVM Fixture Limitations

This fixture validates declaration extraction for Java, Kotlin, Scala, Clojure,
and Groovy through the shared indexing pipeline. The symbol truth is manually
audited from the fixture source and stored in `validation/m11/ground-truth/`.

The 71 declaration facts in the current fixture are resolved exactly, including
file identity, kind, name, and source line. The fixture also exercises class and
interface inheritance, implementation, overrides, calls, instantiation,
imports, containment, Kotlin data-class properties, companion constants, Scala
modules, Clojure records/protocols, and Groovy generated property accessors.

Dynamic dispatch, macro expansion, compiler-generated JVM bytecode, and runtime
reflection are outside source-AST truth. Those cases must be represented as
inferred or unknown facts in later relationship and support-matrix validation;
they are not counted as declaration misses here.
