import { Controller, Get } from "nest";

@Controller("users")
export class Users {
  @Get("list")
  findAll() { return []; }

  @Get("/solo")
  solo() { return 1; }

  @Get()
  root() { return 2; }
}
