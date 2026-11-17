package audit;

// Deliberate same-name collisions: these annotations are not Spring or Feign.
@interface GetMapping { String value(); }
@interface RequestMapping { String value(); }
@interface FeignClient { String name(); }

@RequestMapping("/local")
class FakeEndpoint {
    @GetMapping("/not-a-route")
    void method() {}

    @FeignClient(name = "not-an-http-client")
    void feign() {}
}
