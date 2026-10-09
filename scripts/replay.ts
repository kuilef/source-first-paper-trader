import { readFile } from "node:fs/promises";
import { validateBundle } from "../src/domain/schema";
import { evaluate } from "../src/domain/policy";
import { hashBundle } from "../src/domain/canonical";
const names = [
  "confirmed",
  "recycled",
  "identity-conflict",
  "future",
  "stale-quote",
  "wide-spread",
];
const name = process.argv[process.argv.indexOf("--case") + 1] || "confirmed";
if (!names.includes(name)) throw new Error(`Choose --case ${names.join("|")}`);
const cases = JSON.parse(
  await readFile(new URL("../fixtures/cases.json", import.meta.url), "utf8"),
);
const bundle = validateBundle(cases[name]);
console.log(
  JSON.stringify(
    {
      mode: bundle.mode,
      notice: "Synthetic quotes; not historical strategy performance.",
      inputHash: await hashBundle(bundle),
      decision: evaluate(bundle),
    },
    null,
    2,
  ),
);
