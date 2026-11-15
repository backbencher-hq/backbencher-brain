// The Groovy oracle. Reads a list of file paths and asks the REAL Groovy
// compiler (3.0.24, the Gradle wrapper's) whether each one is syntactically
// valid Groovy.
//
// Compilation is stopped at Phases.CONVERSION: that is parse + AST conversion,
// BEFORE semantic analysis, so a file is judged on its syntax alone and cannot
// be failed for unresolved imports or missing classpath — which is exactly the
// distinction we need. A file the oracle accepts but our tree-sitter grammar
// rejects is a gap in OUR grammar, with the language itself as ground truth.
import org.codehaus.groovy.control.CompilationUnit
import org.codehaus.groovy.control.Phases
import org.codehaus.groovy.control.ErrorCollector

def listFile = args[0]
def paths = new File(listFile).readLines().findAll { it.trim().length() > 0 }

int accepted = 0
int rejected = 0
def reasons = [:]

paths.each { p ->
    def f = new File(p)
    if (!f.isFile()) { println "MISSING\t${p}"; return }
    try {
        def cu = new CompilationUnit()
        cu.addSource(f.name, f.text)
        cu.compile(Phases.CONVERSION)
        println "ACCEPTS\t${p}"
        accepted++
    } catch (Throwable t) {
        // The first line of the message is the syntax diagnostic Groovy names.
        def msg = (t.message ?: t.getClass().simpleName).readLines().find { it.trim() } ?: t.getClass().simpleName
        msg = msg.trim().replaceAll(/\s+/, " ")
        if (msg.length() > 150) msg = msg.substring(0, 150)
        reasons[msg] = (reasons[msg] ?: 0) + 1
        println "REJECTS\t${p}\t${msg}"
        rejected++
    }
}

System.err.println "oracle: accepted=${accepted} rejected=${rejected} total=${paths.size()}"
if (reasons.size() > 0) {
    System.err.println "oracle: top rejection reasons:"
    reasons.sort { -it.value }.take(12).each { k, v -> System.err.println "  ${v}\t${k}" }
}
