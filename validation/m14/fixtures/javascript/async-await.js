class Loader {
  async load(url) {
    const res = await fetch(url);
    return res.text();
  }
}
