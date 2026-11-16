// Independent compiler evidence for 2026-11-16 Java analyzer remediations.
// Usage: javac -d /tmp/bb-remediation-oracle JavaAnalyzerRemediationOracle.java
//        java -cp /tmp/bb-remediation-oracle JavaAnalyzerRemediationOracle
import com.sun.source.util.JavacTask;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;

public final class JavaAnalyzerRemediationOracle {
    private static final class Snippet extends SimpleJavaFileObject {
        private final String source;
        Snippet(String path, String source) {
            super(URI.create("string:///" + path), Kind.SOURCE);
            this.source = source;
        }
        @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return source; }
    }
    private static ExecutableElement member(TypeElement type, String name) {
        if (type == null) return null;
        for (Element e : type.getEnclosedElements()) {
            if (e.getKind() == ElementKind.METHOD && e.getSimpleName().contentEquals(name)) return (ExecutableElement) e;
        }
        return null;
    }
    private static boolean method(TypeElement type, String name) { return member(type, name) != null; }
    private static TypeElement type(JavacTask task, String qname) {
        TypeElement t = task.getElements().getTypeElement(qname);
        if (t == null) throw new AssertionError("Missing declared type " + qname);
        return t;
    }
    private static void assertFact(boolean condition, String description) {
        if (!condition) throw new AssertionError(description);
        System.out.println("PASS " + description);
    }
    public static void main(String[] ignored) throws Exception {
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        if (javac == null) throw new IllegalStateException("JDK compiler required");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        List<JavaFileObject> files = List.of(
            new Snippet("audit/Fixture.java", "package audit; class Logger { static void audit() {} } " +
                "class String { static void custom() {} } class App { void equals(int n) {} " +
                "void run() { Logger.audit(); String.custom(); equals(3); System.out.println(\"ok\"); } }"),
            new Snippet("app/Fixture.java", "package app; @interface Data {} @interface Getter {} " +
                "@interface Setter {} @Data class LocalData { private int count; } " +
                "@Getter class LocalGetter { private String title; } " +
                "@Setter class LocalSetter { private long id; } " +
                "interface JpaRepository<T,I> {} interface LocalRepository extends JpaRepository<LocalData, Long> {}"),
            new Snippet("jakarta/project/Fixture.java", "package jakarta.project; " +
                "class Owned { static void work() {} } " +
                "class Consumer { void run() { Owned.work(); jakarta.project.Owned.work(); new jakarta.project.Owned(); } }"),
            new Snippet("oracle/Fixture.java", "package oracle; class Parent<T> { void save(T value) {} } " +
                "class OverloadChild extends Parent<String> { void save(Integer value) {} } " +
                "class OverrideChild extends Parent<String> { @Override void save(String value) {} }")
        );
        try (StandardJavaFileManager manager = javac.getStandardFileManager(diagnostics, null, null)) {
            JavacTask task = (JavacTask) javac.getTask(null, manager, diagnostics,
                List.of("-proc:none", "-g:none"), null, files);
            task.parse();
            task.analyze();
            List<String> errors = new ArrayList<>();
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                if (d.getKind() == Diagnostic.Kind.ERROR) errors.add(d.toString());
            }
            assertFact(errors.isEmpty(), "all four adversarial source files compile: " + errors);
            assertFact(method(type(task, "audit.Logger"), "audit"), "audit.Logger.audit is project-declared");
            assertFact(method(type(task, "audit.String"), "custom"), "audit.String.custom is project-declared");
            assertFact(method(type(task, "audit.App"), "equals"), "audit.App.equals(int) is project-declared");
            assertFact(!method(type(task, "app.LocalData"), "getCount"), "local @Data does not generate getCount");
            assertFact(!method(type(task, "app.LocalData"), "setCount"), "local @Data does not generate setCount");
            assertFact(!method(type(task, "app.LocalGetter"), "getTitle"), "local @Getter does not generate getTitle");
            assertFact(!method(type(task, "app.LocalSetter"), "setId"), "local @Setter does not generate setId");
            assertFact(!method(type(task, "app.LocalRepository"), "save"), "local JpaRepository does not inject save");
            assertFact(method(type(task, "jakarta.project.Owned"), "work"), "jakarta.project.Owned.work belongs to project");
            TypeElement parent = type(task, "oracle.Parent");
            TypeElement overload = type(task, "oracle.OverloadChild");
            TypeElement override = type(task, "oracle.OverrideChild");
            assertFact(!task.getElements().overrides(member(overload, "save"), member(parent, "save"), overload),
                "save(Integer) is NOT a generic override of Parent<T>.save(T) when T=String");
            assertFact(task.getElements().overrides(member(override, "save"), member(parent, "save"), override),
                "save(String) overrides Parent<T>.save(T) when T=String");
            System.out.println("JavaAnalyzerRemediationOracle: 12/12 independent compiler facts passed");
        }
    }
}
