import { parseArgs } from "node:util";
import { ApiError, createClient, describeError, EXIT, type Client, type FetchLike } from "./api.js";
import { configDir, configPath, isLoose, KEY_SHAPE, keyPrefix, readConfig, removeConfig, writeConfig } from "./config.js";
import { formatAnswers, formatBrands, formatPrompts, formatResults } from "./format.js";
import { resolveBrand, resolveGroup, ResolveError } from "./resolve.js";
import type { AnswersResponse, Brand, BrandsResponse, PromptsDocument, ResultsDocument } from "./types.js";
import { API_KEYS_URL, DEFAULT_BASE_URL, VERSION } from "./version.js";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Reads all of stdin when it is not a terminal; null when it is one. */
  readStdin: () => Promise<string | null>;
  /** Asks for a secret on the terminal without echoing it. */
  promptSecret: (question: string) => Promise<string>;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  home?: string;
  fetch?: FetchLike;
}

const HELP = `firemark ${VERSION}: read your Firemark results from the terminal.

Usage
  firemark login [--key <key>]        Save an API key (prompts for it, or reads it from stdin)
  firemark logout                     Forget the saved key
  firemark brands                     The workspace's brands
  firemark results <brand>            The latest published results
  firemark prompts <brand>            Each prompt's verdict per engine
  firemark answers <brand> <prompt>   One prompt's stored answers (prompt id, like P001)

<brand> is a brand's id, name or website, as listed by \`firemark brands\`.

Options
  --json               Print the API's JSON as it comes
  --group <group>      results, prompts: one prompt group (id or name)
  --range <range>      results, prompts, answers: latest, 4r, 12r, 30d, 90d, qtd or 12m
  --run <run id>       answers: another published run
  --engine <engine>    answers: one engine (chatgpt, perplexity, ai_overviews, ai_mode, gemini, claude)
  --base-url <url>     API address (default ${DEFAULT_BASE_URL})
  -h, --help           Show this help
  -v, --version        Show the version

The key comes from FIREMARK_API_KEY when it is set, otherwise from the file \`firemark login\` writes.
Create keys at ${API_KEYS_URL}. API reference: https://tryfiremark.com/docs/api
`;

type Opts = {
  json?: boolean;
  key?: string;
  group?: string;
  range?: string;
  run?: string;
  engine?: string;
  "base-url"?: string;
  help?: boolean;
  version?: boolean;
};

const ALLOWED: Record<string, (keyof Opts)[]> = {
  login: ["key"],
  logout: [],
  brands: [],
  results: ["group", "range"],
  prompts: ["group", "range"],
  answers: ["run", "range", "engine"],
};

const ARITY: Record<string, string[]> = {
  login: [],
  logout: [],
  brands: [],
  results: ["<brand>"],
  prompts: ["<brand>"],
  answers: ["<brand>", "<prompt>"],
};

const ENGINES = ["chatgpt", "perplexity", "ai_overviews", "ai_mode", "gemini", "claude"];

class UsageError extends Error {}

export async function run(argv: string[], io: Io): Promise<number> {
  let values: Opts;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        key: { type: "string" },
        group: { type: "string" },
        range: { type: "string" },
        run: { type: "string" },
        engine: { type: "string" },
        "base-url": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }) as { values: Opts; positionals: string[] });
  } catch (err) {
    io.stderr(`${(err as Error).message}\nRun \`firemark --help\` for usage.\n`);
    return EXIT.usage;
  }

  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT.ok;
  }
  const [command, ...args] = positionals;
  if (values.help || !command) {
    io.stdout(HELP);
    return values.help ? EXIT.ok : command ? EXIT.ok : EXIT.usage;
  }

  try {
    if (!(command in ALLOWED)) throw new UsageError(`Unknown command "${command}".`);
    const allowed = new Set<keyof Opts>([...ALLOWED[command]!, "json", "base-url", "help", "version"]);
    for (const k of Object.keys(values) as (keyof Opts)[]) {
      if (!allowed.has(k)) throw new UsageError(`--${k} does not apply to \`firemark ${command}\`.`);
    }
    const want = ARITY[command]!;
    if (args.length !== want.length) {
      throw new UsageError(`Usage: firemark ${command}${want.length ? " " + want.join(" ") : ""}`);
    }
    if (values.engine && !ENGINES.includes(values.engine)) {
      throw new UsageError(`--engine is one of ${ENGINES.join(", ")}.`);
    }
    if (values.run && values.range) throw new UsageError("--run and --range cannot be used together.");

    const baseUrl = (values["base-url"] ?? io.env.FIREMARK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!/^https?:\/\//.test(baseUrl)) throw new UsageError("--base-url must start with https:// or http://.");

    switch (command) {
      case "login":
        return await login(values, baseUrl, io);
      case "logout":
        return await logout(io);
      default:
        return await read(command, args, values, baseUrl, io);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${err.message}\nRun \`firemark --help\` for usage.\n`);
      return EXIT.usage;
    }
    if (err instanceof ApiError) {
      if (values.json && err.body) io.stderr(JSON.stringify(err.body) + "\n");
      const { lines, exit } = describeError(err, API_KEYS_URL);
      io.stderr(lines.join("\n") + "\n");
      return exit;
    }
    if (err instanceof ResolveError) {
      io.stderr([err.message, ...err.candidates.map((c) => `  ${c}`), err.candidates.length ? "" : "Run `firemark brands` to list them."].filter(Boolean).join("\n") + "\n");
      return EXIT.notFound;
    }
    io.stderr(`${(err as Error).message ?? String(err)}\n`);
    return EXIT.error;
  }
}

async function loadKey(io: Io): Promise<string> {
  const fromEnv = io.env.FIREMARK_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const ce = { env: io.env, platform: io.platform, home: io.home };
  const path = configPath(ce);
  const cfg = await readConfig(path);
  if (!cfg?.api_key) throw new UsageErrorAuth("No API key. Run `firemark login`, or set FIREMARK_API_KEY.");
  if (await isLoose(path, io.platform)) {
    io.stderr(`Warning: ${path} can be read by other users. Run \`chmod 600 ${path}\`.\n`);
  }
  return cfg.api_key;
}

class UsageErrorAuth extends UsageError {}

async function login(values: Opts, baseUrl: string, io: Io): Promise<number> {
  let key = values.key?.trim();
  if (!key) {
    const piped = await io.readStdin();
    key = piped === null ? (await io.promptSecret("Firemark API key: ")).trim() : piped.trim();
  }
  if (!key) throw new UsageError("No key given.");
  if (!KEY_SHAPE.test(key)) {
    throw new UsageError(`That is not a Firemark API key: keys look like fmk_1a2b3c4d_… . Create one at ${API_KEYS_URL}.`);
  }
  const client = createClient({ baseUrl, key, fetch: io.fetch });
  const res = await client.get<BrandsResponse>("/brands");
  const ce = { env: io.env, platform: io.platform, home: io.home };
  const path = configPath(ce);
  await writeConfig(path, configDir(ce), { api_key: key });
  if (values.json) {
    io.stdout(JSON.stringify({ ok: true, key_prefix: keyPrefix(key), account_id: res.body.account_id, brands: res.body.brands.length, config: path }) + "\n");
  } else {
    const n = res.body.brands.length;
    io.stdout(`Logged in with ${keyPrefix(key)}. The key reads ${n} ${n === 1 ? "brand" : "brands"}.\nSaved to ${path}\n`);
    if (io.env.FIREMARK_API_KEY) io.stdout("Note: FIREMARK_API_KEY is set and is used before the saved key.\n");
  }
  return EXIT.ok;
}

async function logout(io: Io): Promise<number> {
  const path = configPath({ env: io.env, platform: io.platform, home: io.home });
  const removed = await removeConfig(path);
  io.stdout(removed ? `Removed the saved key (${path}).\n` : "No saved key.\n");
  if (io.env.FIREMARK_API_KEY) io.stdout("FIREMARK_API_KEY is still set in this shell.\n");
  return EXIT.ok;
}

function emitJson(io: Io, text: string): void {
  io.stdout(text.endsWith("\n") ? text : text + "\n");
}

async function brandFor(client: Client, input: string): Promise<Brand> {
  const res = await client.get<BrandsResponse>("/brands");
  return resolveBrand(res.body.brands, input);
}

async function read(command: string, args: string[], values: Opts, baseUrl: string, io: Io): Promise<number> {
  let key: string;
  try {
    key = await loadKey(io);
  } catch (err) {
    if (err instanceof UsageErrorAuth) {
      io.stderr(err.message + "\n");
      return EXIT.auth;
    }
    throw err;
  }
  const client = createClient({ baseUrl, key, fetch: io.fetch });

  if (command === "brands") {
    const res = await client.get<BrandsResponse>("/brands");
    if (values.json) emitJson(io, res.text);
    else io.stdout(formatBrands(res.body).join("\n") + "\n");
    return EXIT.ok;
  }

  const brand = await brandFor(client, args[0]!);
  const b = encodeURIComponent(brand.id);
  const group = values.group ? resolveGroup(brand, values.group) : undefined;

  if (command === "results") {
    const res = await client.get<ResultsDocument>(`/brands/${b}/results`, { group: group?.id, range: values.range });
    if (values.json) emitJson(io, res.text);
    else io.stdout(formatResults(res.body, group?.name).join("\n") + "\n");
    return EXIT.ok;
  }

  if (command === "prompts") {
    const res = await client.get<PromptsDocument>(`/brands/${b}/prompts`, { group: group?.id, range: values.range });
    if (values.json) emitJson(io, res.text);
    else io.stdout(formatPrompts(res.body, brand.name, group?.name).join("\n") + "\n");
    return EXIT.ok;
  }

  // answers
  const prompt = args[1]!.trim().toUpperCase();
  const res = await client.get<AnswersResponse>(`/brands/${b}/prompts/${encodeURIComponent(prompt)}/answers`, {
    run: values.run,
    range: values.range,
  });
  if (values.json) emitJson(io, res.text);
  else io.stdout(formatAnswers(res.body, brand.name, values.engine).join("\n") + "\n");
  return EXIT.ok;
}
