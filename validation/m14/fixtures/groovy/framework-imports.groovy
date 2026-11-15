import grails.gorm.annotation.Entity
import spock.lang.Specification

@Entity
class Widget {
    String name
}

class WidgetSpec extends Specification {
    def "widget has name"() {
        expect: true
    }
}
