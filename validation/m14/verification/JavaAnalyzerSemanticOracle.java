import com.sun.source.util.JavacTask;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import javax.lang.model.element.AnnotationMirror;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.TypeElement;
import javax.tools.JavaCompiler;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/**
 * Compiler-side independent facts used by the Java analyzer's M14 fixtures.
 * Deliberately does not call Backbencher production code or the M14 matcher.
 */
public final class JavaAnalyzerSemanticOracle {
    private static int checks = 0;

    private static void check(boolean condition, String description) {
        checks++;
        if (!condition) throw new AssertionError("javac semantic fact failed: " + description);
    }

    private static ExecutableElement method(TypeElement type, String name, int arity) {
        for (Element e : type.getEnclosedElements()) {
            if (e.getKind() == ElementKind.METHOD && e.getSimpleName().contentEquals(name)) {
                ExecutableElement m = (ExecutableElement)e;
                if (m.getParameters().size() == arity) return m;
            }
        }
        throw new AssertionError("missing method " + name + "/" + arity + " on " + type);
    }

    private static final class Source extends SimpleJavaFileObject {
        private final String source;
        Source(String name, String source) {
            super(URI.create("string:///" + name + ".java"), Kind.SOURCE);
            this.source = source;
        }
        @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return source; }
    }

    public static void main(String[] args) throws Exception {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        check(compiler != null, "running on a JDK with javac");
        String code = """
            @interface GetMapping { String value(); }
            @interface FeignClient { String name(); }
            enum RequestMethod { GET, POST }
            @interface RequestMapping {
                String value();
                RequestMethod method();
            }
            class ImplicitObjectMethods implements Runnable {
                @Override public String toString() { return "ok"; }
                @Override public int hashCode() { return 41; }
                public void toString(int value) {}
                @Override public void run() {}
            }
            @RequestMapping(value = "/orders", method = RequestMethod.GET)
            class LocalAnnotations {
                @GetMapping("/fake") void route() {}
                @FeignClient(name = "also-fake") void client() {}
            }
            """;
        List<String> options = List.of("-proc:none", "-Xlint:all");
        JavacTask task = (JavacTask)compiler.getTask(null, null, null, options, null, List.of(new Source("SemanticProbe", code)));
        task.parse();
        task.analyze();
        var elements = task.getElements();
        TypeElement owner = elements.getTypeElement("ImplicitObjectMethods");
        TypeElement object = elements.getTypeElement("java.lang.Object");
        check(owner != null && object != null, "type symbols exist");
        check(elements.overrides(method(owner, "toString", 0), method(object, "toString", 0), owner), "toString overrides Object");
        check(elements.overrides(method(owner, "hashCode", 0), method(object, "hashCode", 0), owner), "hashCode overrides Object");
        check(!elements.overrides(method(owner, "toString", 1), method(object, "toString", 0), owner), "toString(int) does not override");
        TypeElement local = elements.getTypeElement("LocalAnnotations");
        check(local != null, "local annotation class exists");
        check(local.getAnnotationMirrors().stream().anyMatch(m -> m.getAnnotationType().toString().equals("RequestMapping")), "unqualified local RequestMapping is not Spring");
        TypeElement fakeMapping = elements.getTypeElement("GetMapping");
        check(fakeMapping != null && fakeMapping.getQualifiedName().contentEquals("GetMapping"), "GetMapping is a project type");
        TypeElement fakeFeign = elements.getTypeElement("FeignClient");
        check(fakeFeign != null && fakeFeign.getQualifiedName().contentEquals("FeignClient"), "FeignClient is a project type");
        boolean enumGet = false;
        for (AnnotationMirror mirror : local.getAnnotationMirrors()) {
            if (!mirror.getAnnotationType().toString().equals("RequestMapping")) continue;
            for (var entry : mirror.getElementValues().entrySet()) {
                if (entry.getKey().getSimpleName().contentEquals("method")) {
                    enumGet = entry.getValue().getValue().toString().equals("GET");
                }
            }
        }
        check(enumGet, "enum-valued RequestMethod.GET is GET");
        System.out.println("JavaAnalyzerSemanticOracle: " + checks + "/" + checks + " passed");
    }
}
