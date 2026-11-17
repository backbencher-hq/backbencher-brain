package audit;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

// The exact annotation type comes from an explicit Spring import.
class RequestMethodEndpoint {
    @RequestMapping(value = "/orders", method = RequestMethod.GET)
    void orders() {}
}
