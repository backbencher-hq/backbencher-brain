// Independent javac oracle for the Java method-generic M14 regressions.
// Usage: javac -d /tmp/bb-java-oracle validation/m14/verification/JavaMethodGenericOverrideOracle.java
//        java -cp /tmp/bb-java-oracle JavaMethodGenericOverrideOracle \
//          validation/m14/fixtures/java/override-unbounded-method-alpha-equivalence.java \
//          validation/m14/fixtures/java/override-generic-method-return-consistency.java
import com.sun.source.util.JavacTask;
import java.util.ArrayList;
import java.util.List;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.TypeElement;
import javax.lang.model.util.Elements;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

public final class JavaMethodGenericOverrideOracle {
    private static ExecutableElement member(TypeElement owner, String name) {
        if (owner == null) throw new IllegalArgumentException("Missing owner for " + name);
        for (Element element : owner.getEnclosedElements()) {
            if (element.getKind() == ElementKind.METHOD && element.getSimpleName().contentEquals(name)) {
                return (ExecutableElement) element;
            }
        }
        throw new IllegalArgumentException("Missing method " + owner + "." + name);
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected two fixture paths");
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("Requires a JDK with javac");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager files = compiler.getStandardFileManager(diagnostics, null, null)) {
            List<String> names = List.of(args[0], args[1]);
            Iterable<? extends JavaFileObject> sources = files.getJavaFileObjectsFromStrings(names);
            // Never run annotation processors from the analyzed source.
            JavacTask task = (JavacTask) compiler.getTask(null, files, diagnostics, List.of("-proc:none"), null, sources);
            task.parse();
            task.analyze();
            List<String> errors = new ArrayList<>();
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                if (d.getKind() == Diagnostic.Kind.ERROR) errors.add(d.toString());
            }
            if (!errors.isEmpty()) throw new AssertionError("Fixture sources rejected by javac: " + errors);
            Elements elements = task.getElements();
            String[][] cases = {
                {"TransformerImpl", "identity", "Transformer", "identity", "true"},
                {"TransformerImpl", "consume", "Transformer", "consume", "true"},
                {"TransformerImpl", "copy", "Transformer", "copy", "true"},
                {"GenericChild", "wrap", "GenericBase", "wrap", "true"},
                {"ShadowChild", "take", "ShadowBase", "take", "true"},
                {"WrongChild", "choose", "WrongBase", "choose", "false"},
                {"GenericImpl", "id", "GenericInterface", "id", "true"},
                {"GenericImpl", "consume", "GenericInterface", "consume", "true"},
                {"GenericImpl", "copy", "GenericInterface", "copy", "true"},
                {"GenericSub", "wrap", "GenericParent", "wrap", "true"},
                {"ShadowSub", "take", "ShadowParent", "take", "true"},
                {"DifferentOverloadSub", "use", "DifferentOverloadParent", "use", "false"}
            };
            int passed = 0;
            for (String[] check : cases) {
                TypeElement child = elements.getTypeElement(check[0]);
                TypeElement ancestor = elements.getTypeElement(check[2]);
                boolean actual = elements.overrides(member(child, check[1]), member(ancestor, check[3]), child);
                boolean expected = Boolean.parseBoolean(check[4]);
                if (actual != expected) throw new AssertionError(check[0] + "." + check[1] +
                    " -> " + check[2] + "." + check[3] + ": expected " + expected + ", got " + actual);
                System.out.println("PASS " + check[0] + "." + check[1] + " overrides " + check[2] + "." + check[3] + ": " + actual);
                passed++;
            }
            System.out.println("javac Elements.overrides: " + passed + "/" + cases.length + " correct");
        }
    }
}
