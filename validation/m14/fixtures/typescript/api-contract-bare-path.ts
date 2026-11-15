export class Ctrl {

    @Get("/users")
    list(): string {
        return "";
    }

    fetchUsers(): void {
        fetch("/api/users", { method: "POST" });
    }
}
