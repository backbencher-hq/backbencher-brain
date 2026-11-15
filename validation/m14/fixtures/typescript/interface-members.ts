interface UserRepo {
  name: string;
  find(id: number): string | null;
  save(user: { id: number }): void;
}
