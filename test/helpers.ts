import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Io } from "../src/main.js";
import { run } from "../src/main.js";

export const FIXTURES = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));
export const BASE = "https://api.test/api/v1";
export const KEY = "fmk_1a2b3c4d_" + "A".repeat(43);
export const BRAND_ID = "8d2f4b1c-6a3e-4f7d-9b20-5c1e7a9d3f42";

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}
export function fixture<T = any>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export interface Route {
  status?: number;
  file?: string;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: Error;
}

export interface Recorded {
  url: string;
  headers: Record<string, string>;
}

/** A fetch that answers from fixtures by path (and query) and records each request. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const f = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url: input, headers });
    const u = new URL(input);
    const path = u.pathname.replace(/^\/api\/v1/, "") + u.search;
    const r = routes[path] ?? routes[u.pathname.replace(/^\/api\/v1/, "")];
    if (!r) return new Response(JSON.stringify({ error: "No such route in test.", code: "test_missing" }), { status: 599 });
    if (r.throws) throw r.throws;
    const text = r.file ? fixtureText(r.file) : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { fetch: f, calls };
}

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export function tempConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "firemark-cli-test-"));
}

export async function cli(
  argv: string[],
  opts: { routes?: Record<string, Route>; env?: Record<string, string | undefined>; stdin?: string | null; secret?: string } = {},
): Promise<Result & { calls: Recorded[] }> {
  let stdout = "";
  let stderr = "";
  const { fetch, calls } = fakeFetch(opts.routes ?? {});
  const io: Io = {
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    readStdin: async () => (opts.stdin === undefined ? null : opts.stdin),
    promptSecret: async () => opts.secret ?? "",
    env: { FIREMARK_CONFIG_DIR: tempConfigDir(), FIREMARK_API_KEY: KEY, FIREMARK_BASE_URL: BASE, ...opts.env },
    platform: process.platform,
    fetch,
  };
  const code = await run(argv, io);
  return { code, stdout, stderr, calls };
}

export const BRANDS: Record<string, Route> = { "/brands": { file: "brands.json" } };
