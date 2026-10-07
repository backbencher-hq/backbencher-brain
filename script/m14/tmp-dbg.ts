const slug = (text: string): string => {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i); const ch = text[i];
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += ch.toLowerCase();
    else if (c === 32 || c === 9) out += "-";
    else if (c === 45) out += "-";
  }
  return out;
};
for (const t of ["Internal anchor references","Install Now!","C++ and Rust: a Punctuation Test","Duplicate","Spaced Anchor","Gone"])
  console.log(`${JSON.stringify(t).padEnd(40)} -> #${slug(t)}`);
console.log("\nlink fragments in the fixture:");
for (const f of ["internal-anchor-references","install-now","c-and-rust-a-punctuation-test","duplicate","duplicate-1","spaced%20anchor","no-such-heading","also-missing"])
  console.log(`  #${f}`);
