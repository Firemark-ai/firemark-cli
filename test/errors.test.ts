import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { BRAND_ID, BRANDS, cli } from "./helpers.js";

describe("errors", () => {
  it("401: passes on the API's sentence and points at the keys page", async () => {
    const r = await cli(["brands"], { routes: { "/brands": { status: 401, file: "error-401.json", headers: { "www-authenticate": "Bearer" } } } });
    assert.equal(r.code, 3);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^A valid API key is required\. \(401 unauthorised\)\n/);
    assert.match(r.stderr, /app\.tryfiremark\.com\/account\/api-keys/);
  });

  it("403 plan_required", async () => {
    const r = await cli(["brands"], { routes: { "/brands": { status: 403, file: "error-403.json" } } });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /Choose a plan in Billing to use this key\. \(403 plan_required\)/);
  });

  it("404 not_published", async () => {
    const r = await cli(["results", "Larkspur"], {
      routes: { ...BRANDS, [`/brands/${BRAND_ID}/results`]: { status: 404, file: "error-404-not-published.json" } },
    });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /Nothing is published for this brand yet\. \(404 not_published\)/);
  });

  it("404 no_brand for a removed brand shows when it goes", async () => {
    const r = await cli(["results", "Larkspur"], {
      routes: {
        ...BRANDS,
        [`/brands/${BRAND_ID}/results`]: {
          status: 404,
          body: { error: "No such brand.", code: "no_brand", removed: true, removed_at: "2026-11-01T00:00:00.000Z", deletes_on: "2026-12-01T00:00:00.000Z" },
        },
      },
    });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /No such brand\. \(404 no_brand\)\nRemoved: 2026-11-01T00:00:00\.000Z\nData deleted on: 2026-12-01/);
  });

  it("404 no_answers", async () => {
    const r = await cli(["answers", "Larkspur", "P099"], {
      routes: { ...BRANDS, [`/brands/${BRAND_ID}/prompts/P099/answers`]: { status: 404, file: "error-404-no-answers.json" } },
    });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /No answers are kept for this prompt in this run\. \(404 no_answers\)/);
  });

  it("429 shows Retry-After", async () => {
    const r = await cli(["brands"], { routes: { "/brands": { status: 429, file: "error-429.json", headers: { "retry-after": "17" } } } });
    assert.equal(r.code, 5);
    assert.equal(r.stderr, "Rate limit reached. (429 rate_limited)\nRetry after 17 seconds.\n");
  });

  it("429 too_many_failures", async () => {
    const r = await cli(["brands"], {
      routes: { "/brands": { status: 429, body: { error: "Too many failed requests.", code: "too_many_failures" }, headers: { "retry-after": "60" } } },
    });
    assert.equal(r.code, 5);
    assert.match(r.stderr, /Retry after 60 seconds/);
  });

  it("400 bad_period names the field", async () => {
    const r = await cli(["results", "Larkspur", "--range", "6w"], {
      routes: { ...BRANDS, [`/brands/${BRAND_ID}/results?range=6w`]: { status: 400, body: { error: "Not a period.", code: "bad_period", field: "range" } } },
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Not a period\. \(400 bad_period\)\nField: range/);
  });

  it("5xx without a body", async () => {
    const r = await cli(["brands"], { routes: { "/brands": { status: 502, body: null } } });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "Firemark answered 502. Try again shortly.\n");
  });

  it("network failure", async () => {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const r = await cli(["brands"], { routes: { "/brands": { throws: err } } });
    assert.equal(r.code, 6);
    assert.match(r.stderr, /^Could not reach https:\/\/api\.test\/api\/v1: ECONNREFUSED\./);
  });

  it("--json also writes the error body to stderr", async () => {
    const r = await cli(["brands", "--json"], { routes: { "/brands": { status: 401, file: "error-401.json" } } });
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^\{"error":"A valid API key is required\.","code":"unauthorised"\}\n/);
  });

  it("no key at all", async () => {
    const r = await cli(["brands"], { env: { FIREMARK_API_KEY: undefined } });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /No API key\. Run `firemark login`, or set FIREMARK_API_KEY\./);
    assert.equal(r.calls.length, 0);
  });
});
