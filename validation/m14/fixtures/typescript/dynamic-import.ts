async function load(): Promise<unknown> {
  const mod = await import("./lazy");
  return mod.thing;
}
