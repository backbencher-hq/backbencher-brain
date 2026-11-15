import groovy.cli.Unparsed

interface ValSepI {
    @Unparsed remaining()
}

class Reader {
    @Unparsed handler(String source) {
        return source.length
    }

    String read(String source) {
        return source.length
    }
}