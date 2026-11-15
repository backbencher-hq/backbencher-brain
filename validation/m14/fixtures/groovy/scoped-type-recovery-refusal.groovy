<%=packageName ? "package ${packageName}" : ''%>

import static org.springframework.http.HttpStatus.*
import org.springframework.transaction.TransactionStatus

class ${className}Controller {

    def index(Integer max) {
        return max
    }
}
