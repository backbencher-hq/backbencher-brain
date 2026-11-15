const src = process.argv[2]
const lines = src.replace(/^\n/, "").replace(/\n$/, "").split("\n")
lines.forEach((l, i) => console.log(String(i + 1).padStart(3) + " | " + l.replace(/\/\/\s*@line:.*$/, (m) => "   <<MARKER>> " + m)))
