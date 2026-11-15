// #841 round 14 — the degraded-class recovery (analyzer side).
//
// This is a real corpus file (grails-core build-logic
// TestTaskShardingPlugin.groovy) reduced by brace-balanced greedy deletion to
// a local minimum that STILL degrades the class: with this source, tree-sitter
// emits the `class` keyword, the name, the super_interfaces and the member
// declarations as ROOT-LEVEL fragments instead of a class_declaration, so the
// walk never pushes a class scope. Before the recovery pass the extraction had
// NO class symbol, NO contains edges, every call sourced "(script)", and two
// FABRICATED `calls` edges naming parameter TYPES (`Project`, `Test`) that are
// never called here. After the pass: the class and its ownership graph are
// restored, and the fabricated edges are gone.
//
// The real Groovy 3.0.24 toolchain ACCEPTS this source (compiled to
// Phases.CONVERSION — syntax only, so unresolved names cannot reject it), which
// is what makes it a legitimate pin rather than a skeleton: the language says
// yes, our parser's recovery says no, and the recovery is the honest bridge.
//
// Parse errors themselves are NOT suppressed — the tree keeps its ERROR nodes;
// only the ownership graph is reconstructed (reviews/m59-841-assert-comma-
// separator.md §7r). The degradation survives every single-line and single-block
// deletion tried against it, so the minimal *construct* remains unlocalized;
// what the fixture pins is the consequence, which is what was lost.
class TestTaskShardingPlugin implements Plugin<Project> {
    void apply(Project project) {
        rootProject.allprojects.each { Project project ->
            project.tasks.withType(Test).each { Test task ->
                candidateTasks.add(task)
            }
        }
        candidateTasks.toList().sort { Test left, Test right ->
        }
        if (task.project.path == ':grails-test-report') {
        }
    }
}
