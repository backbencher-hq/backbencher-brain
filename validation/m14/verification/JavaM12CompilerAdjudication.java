import com.sun.source.util.JavacTask;
import java.net.URI;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.TypeElement;
import javax.lang.model.util.Elements;
import javax.lang.model.util.Types;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * Compiler-independent evidence for the four M12 Java fixtures.
 * This oracle uses javac's attributed symbol model (not Backbencher's tree
 * or relationship matcher) and does not change M12's stored ground truth.
 */
public final class JavaM12CompilerAdjudication {
    private static int checks = 0;

    private static void expect(boolean actual, String reason) {
        checks++;
        if (!actual) throw new AssertionError("javac M12 fact failed: " + reason);
        System.out.println("M12_JAVAC_FACT_PASS " + reason);
    }

    private static final class Source extends SimpleJavaFileObject {
        private final String body;
        Source(String name, String body) {
            super(URI.create("string:///" + name + ".java"), Kind.SOURCE);
            this.body = body;
        }
        @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return body; }
    }

    private static TypeElement require(Elements elements, String name) {
        TypeElement found = elements.getTypeElement(name);
        expect(found != null, "declares type " + name);
        return found;
    }

    private static ExecutableElement method(TypeElement owner, String name, String firstType) {
        for (Element e : owner.getEnclosedElements()) {
            if (e.getKind() != ElementKind.METHOD || !e.getSimpleName().contentEquals(name)) continue;
            ExecutableElement m = (ExecutableElement)e;
            if (firstType == null && m.getParameters().isEmpty()) return m;
            if (firstType != null && m.getParameters().size() == 1 &&
                m.getParameters().get(0).asType().toString().equals(firstType)) return m;
        }
        throw new AssertionError("javac did not declare " + owner + "." + name + "(" + firstType + ")");
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("usage: JavaM12CompilerAdjudication <fixture-root>");
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        expect(compiler != null, "JDK compiler is available");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager manager = compiler.getStandardFileManager(diagnostics, null, null)) {
            Path dir = Path.of(args[0]);
            List<Path> names = List.of(
                dir.resolve("AdvancedFeatures.java"),
                dir.resolve("BaseService.java"),
                dir.resolve("Repository.java"),
                dir.resolve("UserService.java")
            );
            List<JavaFileObject> inputs = new ArrayList<>();
            for (JavaFileObject f : manager.getJavaFileObjectsFromPaths(names)) inputs.add(f);
            // An independent local declaration supplies the only external dependency
            // of these four fixtures: UserService's Spring stereotype annotation.
            inputs.add(new Source("org/springframework/stereotype/Service",
                "package org.springframework.stereotype; public @interface Service {}"));
            JavacTask task = (JavacTask)compiler.getTask(
                null, manager, diagnostics, List.of("-proc:none", "-implicit:none"), null, inputs
            );
            task.parse();
            task.analyze();
            for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
                if (d.getKind() == Diagnostic.Kind.ERROR) {
                    throw new AssertionError("M12 source not compiler-valid: " + d);
                }
            }
            expect(true, "four M12 Java fixtures compile with an isolated Spring annotation stub");

            Elements elements = task.getElements();
            Types types = task.getTypes();
            TypeElement repository = require(elements, "com.example.base.Repository");
            TypeElement base = require(elements, "com.example.base.BaseService");
            TypeElement entity = require(elements, "com.example.base.BaseService.Entity");
            TypeElement service = require(elements, "com.example.service.UserService");
            TypeElement user = require(elements, "com.example.service.UserService.User");
            TypeElement advanced = require(elements, "com.example.advanced.AdvancedFeatures");
            TypeElement point = require(elements, "com.example.advanced.AdvancedFeatures.Point");
            TypeElement status = require(elements, "com.example.advanced.AdvancedFeatures.Status");
            TypeElement mapper = require(elements, "com.example.advanced.AdvancedFeatures.Mapper");

            expect(types.isSubtype(service.asType(), types.erasure(base.asType())),
                "UserService extends BaseService (erased)");
            expect(types.isSubtype(user.asType(), entity.asType()),
                "nested User implements BaseService.Entity");
            expect(elements.overrides(method(service, "format", "java.lang.String"),
                    method(base, "format", "java.lang.String"), service),
                "UserService.format overrides BaseService.format");
            expect(elements.overrides(method(service, "save", "com.example.service.UserService.User"),
                    method(repository, "save", "T"), service),
                "UserService.save overrides Repository.save with substituted T");
            expect(elements.overrides(method(base, "findAll", null),
                    method(repository, "findAll", null), base),
                "BaseService.findAll overrides Repository.findAll");
            expect(elements.overrides(method(user, "getId", null),
                    method(entity, "getId", null), user),
                "UserService.User.getId overrides Entity.getId");
            expect(elements.overrides(method(user, "getName", null),
                    method(entity, "getName", null), user),
                "UserService.User.getName overrides Entity.getName");
            expect(!elements.overrides(method(advanced, "overload", "int"),
                    method(advanced, "overload", "java.lang.String"), advanced),
                "overload(int) is not override of overload(String)");
            expect(point.getKind() == ElementKind.RECORD, "Point is a record declaration");
            expect(status.getKind() == ElementKind.ENUM, "Status is an enum declaration");
            expect(mapper.getKind() == ElementKind.INTERFACE, "Mapper is an interface declaration");
            expect(mapper.getEnclosedElements().stream().anyMatch(e ->
                e.getKind() == ElementKind.METHOD && e.getSimpleName().contentEquals("map")),
                "Mapper.map is an actual declared interface method");
            expect(service.getAnnotationMirrors().stream().anyMatch(a ->
                a.getAnnotationType().toString().equals("org.springframework.stereotype.Service")),
                "fully-qualified Spring @Service binds to its declared annotation");
            System.out.println("JavaM12CompilerAdjudication: " + checks + "/" + checks + " passed");
        }
    }
}
