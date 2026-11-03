import fs from "node:fs";
const raw = fs.readFileSync("../News/leagues/league_200_all_transactions_0_0.html", "utf8");

const headingPattern = /<th class="boxtitle">\s*([\s\S]*?)\s*<\/th>/gi;
const headings = [...raw.matchAll(headingPattern)];
console.log("boxtitle headings found:", headings.length);

const headingPattern2 = /<th class="dl">\s*([\s\S]*?)\s*<\/th>/gi;
const headings2 = [...raw.matchAll(headingPattern2)];
console.log('th class="dl" headings found:', headings2.length);

const rowPattern = /<td class="dl">\s*([\s\S]*?)\s*<\/td>/gi;
const rows = [...raw.matchAll(rowPattern)];
console.log('td class="dl" (exact) rows found:', rows.length);

const rowPattern2 = /<td class="dl wrap">\s*([\s\S]*?)\s*<\/td>/gi;
const rows2 = [...raw.matchAll(rowPattern2)];
console.log('td class="dl wrap" rows found:', rows2.length);
