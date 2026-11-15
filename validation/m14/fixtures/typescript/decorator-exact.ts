export class Svc {
  @PostConstruct()
  init() {}

  @GetMapping("/go")
  go() { return 1; }

  @Get()
  bare() { return 2; }
}
