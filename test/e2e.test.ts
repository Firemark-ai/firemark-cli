import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureText, KEY, tempConfigDir } from "./helpers.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function runCli(args: string[], env: Record<string, string>, stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

describe("the built command against a local server", () => {
  let server: Server;
  let base = "";
  const seen: string[] = [];
  before(async () => {
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
        res.end(fixtureText("error-401.json"));
        return;
      }
      if (req.url === "/api/v1/brands") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(fixtureText("brands.json"));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "No such brand.", code: "no_brand" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  after(() => server.close());

  it("login from stdin, then brands with the stored key", async () => {
    const dir = tempConfigDir();
    const login = await runCli(["login", "--base-url", base], { FIREMARK_CONFIG_DIR: dir }, KEY + "\n");
    assert.equal(login.code, 0, login.stderr);
    const brands = await runCli(["brands", "--base-url", base], { FIREMARK_CONFIG_DIR: dir });
    assert.equal(brands.code, 0, brands.stderr);
    assert.match(brands.stdout, /^NAME +ID/);
    assert.match(brands.stdout, /Larkspur/);
    const out = await runCli(["logout"], { FIREMARK_CONFIG_DIR: dir });
    assert.equal(out.code, 0);
    const after = await runCli(["brands", "--base-url", base], { FIREMARK_CONFIG_DIR: dir });
    assert.equal(after.code, 3);
  });

  it("a wrong key exits 3 with the API's sentence", async () => {
    const r = await runCli(["brands", "--base-url", base], { FIREMARK_API_KEY: "fmk_00000000_" + "Z".repeat(43), FIREMARK_CONFIG_DIR: tempConfigDir() });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /A valid API key is required\./);
  });

  it("a closed port is a network error", async () => {
    const r = await runCli(["brands", "--base-url", "http://127.0.0.1:1/api/v1"], { FIREMARK_API_KEY: KEY, FIREMARK_CONFIG_DIR: tempConfigDir() });
    assert.equal(r.code, 6);
    assert.match(r.stderr, /^Could not reach http:\/\/127\.0\.0\.1:1\/api\/v1/);
  });
});
