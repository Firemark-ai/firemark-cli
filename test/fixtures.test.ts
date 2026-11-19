import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { fixture } from "./helpers.js";
import { validateAs } from "./schema.js";

// The fixtures stand in for the API in every other test, so they must match its published schemas.
const CASES: [string, string][] = [
  ["brands.json", "BrandsResponse"],
  ["results.json", "ResultsDocument"],
  ["prompts.json", "PromptsDocument"],
  ["answers-P003.json", "AnswersResponse"],
  ["error-401.json", "Error"],
  ["error-403.json", "Error"],
  ["error-404-not-published.json", "Error"],
  ["error-404-no-answers.json", "Error"],
  ["error-429.json", "Error"],
];

describe("fixtures match the API's OpenAPI schemas", () => {
  for (const [file, schema] of CASES) {
    it(`${file} is a ${schema}`, () => {
      assert.deepEqual(validateAs(fixture(file), schema), []);
    });
  }
  it("the checker catches a wrong shape", () => {
    const doc = fixture("results.json");
    delete doc.counts;
    doc.context.run.state = "done";
    const errs = validateAs(doc, "ResultsDocument");
    assert.ok(errs.some((e) => e.includes("missing counts")));
    assert.ok(errs.some((e) => e.includes("$.context.run.state")));
  });
});
