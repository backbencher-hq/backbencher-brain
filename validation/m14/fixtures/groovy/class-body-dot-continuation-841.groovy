// M49 W22 (#841): a CLASS-LEVEL FIELD whose initializer continues on lines that
// begin with a dot. `field_declaration` ends — delimited — before the first
// dotted line, and the class body had no rule for a bare '.', so the
// parser inserted a MISSING '}' and the census recorded the *collateral* close
// brace as the first-error line (57 files pointed at '}'). The same chain
// inside a method already parsed as sibling `leading_dot_call`s; the field form
// now carries them as children of its own `field_declaration`.
class Cfg {
    Path scriptDir = Paths.get(getClass()
            .protectionDomain
            .codeSource
            .location
            .toURI())
            .toAbsolutePath()
            .parent

    Builder builder = pm.builder()
            .excludeTimestamps()
            .excludeVersion()

    void methodChainControl() {
        def b = pm.builder()
            .excludeTimestamps()
            .excludeVersion()
    }

    void sameLineControl() {
        def b = pm.builder().excludeTimestamps().excludeVersion()
    }
}
