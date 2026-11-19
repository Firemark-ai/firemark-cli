import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE, BRAND_ID, BRANDS, cli, fixtureText, KEY } from "./helpers.js";

const SNAP = fileURLToPath(new URL("../../test/snapshots/", import.meta.url));

/** Compares with test/snapshots/<name>.txt; UPDATE_SNAPSHOTS=1 rewrites it. */
function snapshot(name: string, actual: string): void {
  const file = join(SNAP, `${name}.txt`);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    mkdirSync(SNAP, { recursive: true });
    writeFileSync(file, actual);
    if (!process.env.UPDATE_SNAPSHOTS) assert.fail(`Wrote new snapshot ${name}; check it and run again.`);
    return;
  }
  assert.equal(actual, readFileSync(file, "utf8"));
}

const RESULTS = { ...BRANDS, [`/brands/${BRAND_ID}/results`]: { file: "results.json" } };
const PROMPTS = { ...BRANDS, [`/brands/${BRAND_ID}/prompts`]: { file: "prompts.json" } };
const ANSWERS = { ...BRANDS, [`/brands/${BRAND_ID}/prompts/P003/answers`]: { file: "answers-P003.json" } };

describe("brands", () => {
  it("prints a table", async () => {
    const r = await cli(["brands"], { routes: BRANDS });
    assert.equal(r.code, 0, r.stderr);
    snapshot("brands", r.stdout);
    assert.match(r.stdout, /Larkspur Studio .* nothing published yet/);
  });
  it("--json prints the body as it comes", async () => {
    const r = await cli(["brands", "--json"], { routes: BRANDS });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, fixtureText("brands.json"));
  });
  it("sends the key as a bearer token, with a user agent", async () => {
    const r = await cli(["brands"], { routes: BRANDS });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0]!.url, `${BASE}/brands`);
    assert.equal(r.calls[0]!.headers.authorization, `Bearer ${KEY}`);
    assert.match(r.calls[0]!.headers["user-agent"]!, /^firemark-cli\/\d+\.\d+\.\d+$/);
  });
});

describe("results", () => {
  it("prints every figure with its base", async () => {
    const r = await cli(["results", "Larkspur"], { routes: RESULTS });
    assert.equal(r.code, 0, r.stderr);
    snapshot("results", r.stdout);
    assert.match(r.stdout, /Named in 16 of 29 answers/);
    assert.match(r.stdout, /Linked in 8 of 29 answers/);
    assert.doesNotMatch(r.stdout, /%/);
  });
  it("passes the API's sentences on as they are", async () => {
    const r = await cli(["results", "Larkspur"], { routes: RESULTS });
    assert.ok(r.stdout.includes("AI Mode answers are read a new way from this run."));
  });
  it("prints the period caption when there is one", async () => {
    const doc = JSON.parse(fixtureText("results.json"));
    doc.period = { range: "4r", label: "Last 4 runs", is_default: false, cadence: "weekly", from: null, to: null, runs: 4, first_run: null, selected_run: null, latest_run: null, at_latest: true, empty: false, line: "Last 4 runs: 26 Oct to 16 Nov 2026", breaks: [] };
    const r = await cli(["results", "larkspur", "--range", "4r"], { routes: { ...BRANDS, [`/brands/${BRAND_ID}/results?range=4r`]: { body: doc } } });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.trimEnd().endsWith("Last 4 runs: 26 Oct to 16 Nov 2026"));
  });
  it("--json prints the document as it comes", async () => {
    const r = await cli(["results", "Larkspur", "--json"], { routes: RESULTS });
    assert.equal(r.stdout, fixtureText("results.json"));
  });
  it("--group sends the group's id and names it", async () => {
    const r = await cli(["results", "Larkspur", "--group", "clienteling"], {
      routes: { ...BRANDS, [`/brands/${BRAND_ID}/results?group=grp_clienteling`]: { file: "results.json" } },
    });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Prompt group: Clienteling$/m);
  });
  it("an unknown group is a clear error", async () => {
    const r = await cli(["results", "Larkspur", "--group", "Loyalty"], { routes: RESULTS });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /No prompt group of Larkspur matches "Loyalty"/);
  });
});

describe("brand matching", () => {
  for (const input of [BRAND_ID, "Larkspur", "LARKSPUR", "larkspur.example", "https://www.larkspur.example/"]) {
    it(`finds Larkspur from "${input}"`, async () => {
      const r = await cli(["results", input, "--json"], { routes: RESULTS });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.calls[1]!.url, `${BASE}/brands/${BRAND_ID}/results`);
    });
  }
  it("finds the second brand by slug", async () => {
    const r = await cli(["prompts", "larkspur-studio", "--json"], {
      routes: { ...BRANDS, "/brands/1b7e9c3a-2d4f-4a8b-8c6d-0e3f5a7b9c11/prompts": { file: "prompts.json" } },
    });
    assert.equal(r.code, 0, r.stderr);
  });
  it("a part of a name that fits two brands lists both", async () => {
    const r = await cli(["results", "lark"], { routes: RESULTS });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /matches more than one brand/);
    assert.match(r.stderr, /Larkspur Studio/);
  });
  it("no match says how to list brands", async () => {
    const r = await cli(["results", "Fernwood"], { routes: RESULTS });
    assert.equal(r.code, 4);
    assert.match(r.stderr, /No brand matches "Fernwood"\.\nRun `firemark brands`/);
  });
});

describe("prompts", () => {
  it("prints each prompt's verdicts with the engines as base", async () => {
    const r = await cli(["prompts", "Larkspur"], { routes: PROMPTS });
    assert.equal(r.code, 0, r.stderr);
    snapshot("prompts", r.stdout);
    assert.match(r.stdout, /P004 +mofu +1 of 4 engines/);
    assert.match(r.stdout, /P005 +bofu +5 of 5 engines/);
  });
  it("--json prints the document as it comes", async () => {
    const r = await cli(["prompts", "Larkspur", "--json"], { routes: PROMPTS });
    assert.equal(r.stdout, fixtureText("prompts.json"));
  });
});

describe("answers", () => {
  it("prints each engine's answer word for word", async () => {
    const r = await cli(["answers", "Larkspur", "p003"], { routes: ANSWERS });
    assert.equal(r.code, 0, r.stderr);
    snapshot("answers", r.stdout);
    assert.ok(r.stdout.includes("  2. Fernwood suits larger chains that want deep loyalty tooling."));
    assert.match(r.stdout, /== Gemini ==\nStatus: no answer/);
  });
  it("--engine shows one engine", async () => {
    const r = await cli(["answers", "Larkspur", "P003", "--engine", "perplexity"], { routes: ANSWERS });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /== Perplexity ==/);
    assert.doesNotMatch(r.stdout, /ChatGPT/);
  });
  it("--run is sent as ?run=", async () => {
    const run = "a9e7c5b3-1d2f-4a6c-8e0b-2f4d6a8c0e19";
    const r = await cli(["answers", "Larkspur", "P003", "--run", run, "--json"], {
      routes: { ...BRANDS, [`/brands/${BRAND_ID}/prompts/P003/answers?run=${run}`]: { file: "answers-P003.json" } },
    });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, fixtureText("answers-P003.json"));
  });
});

describe("usage", () => {
  it("--help and no command print help", async () => {
    const a = await cli(["--help"]);
    assert.equal(a.code, 0);
    assert.match(a.stdout, /firemark answers <brand> <prompt>/);
    const b = await cli([]);
    assert.equal(b.code, 2);
  });
  it("--version", async () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
    const r = await cli(["--version"]);
    assert.equal(r.stdout.trim(), pkg.version);
  });
  it("rejects an unknown command, a missing argument and an option that does not apply", async () => {
    assert.equal((await cli(["start"])).code, 2);
    const missing = await cli(["answers", "Larkspur"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Usage: firemark answers <brand> <prompt>/);
    const wrong = await cli(["brands", "--run", "x"]);
    assert.equal(wrong.code, 2);
    assert.match(wrong.stderr, /--run does not apply to `firemark brands`/);
    assert.equal((await cli(["answers", "Larkspur", "P001", "--engine", "bing"])).code, 2);
    assert.equal((await cli(["brands", "--bogus"])).code, 2);
  });
  it("--base-url overrides the address", async () => {
    const r = await cli(["brands", "--json", "--base-url", "http://127.0.0.1:9/api/v1/"], { routes: BRANDS });
    assert.equal(r.calls[0]!.url, "http://127.0.0.1:9/api/v1/brands");
  });
});

describe("README", () => {
  it("shows the current output of each command", () => {
    const readme = readFileSync(fileURLToPath(new URL("../../README.md", import.meta.url)), "utf8");
    for (const name of ["brands", "results", "prompts", "answers"]) {
      assert.ok(readme.includes(readFileSync(join(SNAP, `${name}.txt`), "utf8").trimEnd()), `README shows ${name}`);
    }
  });
});
