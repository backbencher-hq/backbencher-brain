// #850 residual (M49 W21): Java-reserved words as named-argument KEYS.
//
// `open`, `module`, `record`, `with` and `sealed` are Java keywords, and this
// Groovy grammar extends Java — so `exclude group: 'a', module: 'b'`
// (ubiquitous in Gradle build scripts, and the single largest parse-failure
// class in the `.gradle` surface) lexed `module` as a keyword token and could
// not form a `map_item` at all. The failure did not stay local: the enclosing
// `dependencies { … }` closure collapsed into ERROR recovery, which is why the
// census's largest first-error signature was a bare `ID {`.
class DepsCfg {
    // two named arguments, the SECOND key reserved
    def twoKeys(conf) {
        conf.exclude group: 'org.apache.groovy', module: 'groovy-all'
    }

    // a single named argument whose key is reserved
    def oneReservedKey(conf) {
        conf.exclude module: 'grails-async'
    }

    // reserved keys inside a map literal, every one of the five
    def asMap() {
        return [module: 'a', record: 'b', sealed: 'c', open: 'd', with: 'e']
    }

    // CONTROL: the same shape with non-reserved keys
    def control(conf) {
        conf.exclude group: 'a', name: 'b'
    }
}
