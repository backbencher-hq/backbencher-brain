async function loadLazy() {
  const mod = await import('./lazy');
  return mod;
}