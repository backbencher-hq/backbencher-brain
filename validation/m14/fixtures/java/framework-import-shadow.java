package shadow;

import org.springframework.web.bind.annotation.GetMapping;

class Outer {
    @interface GetMapping { String value(); }
    @GetMapping("/fake")
    void fake() {}
    @org.springframework.web.bind.annotation.GetMapping("/real")
    void real() {}
}
