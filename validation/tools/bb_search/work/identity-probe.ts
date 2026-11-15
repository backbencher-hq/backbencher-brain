const mod: any = await import("../../../../src/intelligence/search/content-search")
console.log("keys:", Object.keys(mod))
console.log("FN:", mod.searchContent.toString().slice(0, 900))
