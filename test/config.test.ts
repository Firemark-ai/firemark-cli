import { strict as assert } from "node:assert";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { configDir } from "../src/config.js";
import { BRANDS, cli, KEY, tempConfigDir } from "./helpers.js";

const posix = process.platform !== "win32";

describe("config location", () => {
  it("follows FIREMARK_CONFIG_DIR, XDG_CONFIG_HOME and the platform", () => {
    assert.equal(configDir({ env: { FIREMARK_CONFIG_DIR: "/x/fm" }, platform: "linux", home: "/h" }), "/x/fm");
    assert.equal(configDir({ env: { XDG_CONFIG_HOME: "/x" }, platform: "darwin", home: "/h" }), join("/x", "firemark"));
    assert.equal(configDir({ env: {}, platform: "linux", home: "/h" }), join("/h", ".config", "firemark"));
    assert.equal(configDir({ env: {}, platform: "darwin", home: "/h" }), join("/h", "Library", "Application Support", "firemark"));
    assert.equal(configDir({ env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, platform: "win32", home: "/h" }), join("C:\\Users\\a\\AppData\\Roaming", "firemark"));
  });
});

describe("login", () => {
  it("verifies the key with GET /brands and stores it with mode 600", async () => {
    const dir = join(tempConfigDir(), "nested");
    const r = await cli(["login", "--key", KEY], { routes: BRANDS, env: { FIREMARK_CONFIG_DIR: dir, FIREMARK_API_KEY: undefined } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0]!.headers.authorization, `Bearer ${KEY}`);
    const file = join(dir, "config.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { api_key: KEY });
    if (posix) {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
    }
    assert.match(r.stdout, /^Logged in with fmk_1a2b3c4d\. The key reads 2 brands\.\nSaved to /);
    assert.ok(!r.stdout.includes(KEY), "the full key is never printed");
  });

  it("tightens an existing looser file", { skip: !posix }, async () => {
    const dir = tempConfigDir();
    const file = join(dir, "config.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);
    const r = await cli(["login", "--key", KEY], { routes: BRANDS, env: { FIREMARK_CONFIG_DIR: dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("reads the key from stdin", async () => {
    const dir = tempConfigDir();
    const r = await cli(["login"], { routes: BRANDS, stdin: `${KEY}\n`, env: { FIREMARK_CONFIG_DIR: dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).api_key, KEY);
  });

  it("prompts for the key on a terminal", async () => {
    const dir = tempConfigDir();
    const r = await cli(["login"], { routes: BRANDS, stdin: null, secret: KEY, env: { FIREMARK_CONFIG_DIR: dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(dir, "config.json")));
  });

  it("refuses a key of the wrong shape without calling the API", async () => {
    const dir = tempConfigDir();
    const r = await cli(["login", "--key", "sk-not-a-firemark-key"], { routes: BRANDS, env: { FIREMARK_CONFIG_DIR: dir } });
    assert.equal(r.code, 2);
    assert.equal(r.calls.length, 0);
    assert.ok(!existsSync(join(dir, "config.json")));
  });

  it("stores nothing when the API refuses the key", async () => {
    const dir = tempConfigDir();
    const r = await cli(["login", "--key", KEY], { routes: { "/brands": { status: 401, file: "error-401.json" } }, env: { FIREMARK_CONFIG_DIR: dir } });
    assert.equal(r.code, 3);
    assert.ok(!existsSync(join(dir, "config.json")));
  });

  it("--json", async () => {
    const r = await cli(["login", "--key", KEY, "--json"], { routes: BRANDS });
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.key_prefix, "fmk_1a2b3c4d");
    assert.equal(out.brands, 2);
  });
});

describe("stored key", () => {
  it("is used when FIREMARK_API_KEY is not set, and the env key wins when it is", async () => {
    const dir = tempConfigDir();
    const stored = "fmk_99999999_" + "B".repeat(43);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ api_key: stored }), { mode: 0o600 });
    const a = await cli(["brands", "--json"], { routes: BRANDS, env: { FIREMARK_CONFIG_DIR: dir, FIREMARK_API_KEY: undefined } });
    assert.equal(a.calls[0]!.headers.authorization, `Bearer ${stored}`);
    const b = await cli(["brands", "--json"], { routes: BRANDS, env: { FIREMARK_CONFIG_DIR: dir } });
    assert.equal(b.calls[0]!.headers.authorization, `Bearer ${KEY}`);
  });

  it("warns when the file can be read by others", { skip: !posix }, async () => {
    const dir = tempConfigDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ api_key: KEY }));
    chmodSync(file, 0o644);
    const r = await cli(["brands", "--json"], { routes: BRANDS, env: { FIREMARK_CONFIG_DIR: dir, FIREMARK_API_KEY: undefined } });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /can be read by other users/);
  });
});

describe("logout", () => {
  it("removes the saved key", async () => {
    const dir = tempConfigDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ api_key: KEY }), { mode: 0o600 });
    const r = await cli(["logout"], { env: { FIREMARK_CONFIG_DIR: dir, FIREMARK_API_KEY: undefined } });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Removed the saved key/);
    assert.ok(!existsSync(join(dir, "config.json")));
    const again = await cli(["logout"], { env: { FIREMARK_CONFIG_DIR: dir, FIREMARK_API_KEY: undefined } });
    assert.equal(again.stdout, "No saved key.\n");
  });
  it("says when FIREMARK_API_KEY is still set", async () => {
    const r = await cli(["logout"]);
    assert.match(r.stdout, /FIREMARK_API_KEY is still set/);
  });
});
