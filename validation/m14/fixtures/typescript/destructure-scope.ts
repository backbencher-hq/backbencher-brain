interface User {
  name: string;
}

function main(u: User): string {
  const { name, age } = u;
  return name;
}
