import { VERSION } from "./version.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiErrorBody {
  error?: string;
  code?: string;
  removed?: boolean;
  removed_at?: string;
  deletes_on?: string;
  reason?: string;
  field?: string;
  [k: string]: unknown;
}

/** A failed request: an API error (with status and body) or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ApiErrorBody | null,
    readonly retryAfter: string | null,
    readonly url: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get code(): string | undefined {
    return this.body?.code;
  }
}

export interface ApiResponse<T = unknown> {
  status: number;
  text: string;
  body: T;
  headers: Headers;
}

export interface Client {
  readonly baseUrl: string;
  get<T = unknown>(path: string, query?: Record<string, string | undefined>): Promise<ApiResponse<T>>;
}

export interface ClientOptions {
  baseUrl: string;
  key: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createClient({ baseUrl, key, fetch: f = fetch, timeoutMs = 30_000 }: ClientOptions): Client {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    baseUrl: base,
    async get<T>(path: string, query?: Record<string, string | undefined>): Promise<ApiResponse<T>> {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, v);
      const url = base + path + (qs.size ? `?${qs.toString()}` : "");
      let res: Response;
      try {
        res = await f(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
            "User-Agent": `firemark-cli/${VERSION}`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const e = err as Error & { cause?: { code?: string; message?: string } };
        const why = e.name === "TimeoutError" ? `no answer after ${Math.round(timeoutMs / 1000)} seconds` : e.cause?.code ?? e.cause?.message ?? e.message;
        throw new ApiError(`Could not reach ${base}: ${why}.`, 0, null, null, url);
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        const eb = body && typeof body === "object" ? (body as ApiErrorBody) : null;
        throw new ApiError(eb?.error ?? `Firemark answered ${res.status}.`, res.status, eb, res.headers.get("retry-after"), url);
      }
      if (body === null) throw new ApiError(`Firemark answered ${res.status} with a body that is not JSON.`, res.status, null, null, url);
      return { status: res.status, text, body: body as T, headers: res.headers };
    },
  };
}

export const EXIT = { ok: 0, error: 1, usage: 2, auth: 3, notFound: 4, rateLimited: 5, network: 6 } as const;

/** The lines to print for a failed request, and the exit code. The API's own sentence is passed on as it is. */
export function describeError(err: ApiError, keysUrl: string): { lines: string[]; exit: number } {
  if (err.status === 0) return { lines: [err.message, "Check your connection, or the address given with --base-url."], exit: EXIT.network };
  const tag = `(${err.status}${err.code ? ` ${err.code}` : ""})`;
  const first = `${err.message} ${tag}`;
  if (err.status === 401) {
    return { lines: [first, `Check the key on ${keysUrl}, then run \`firemark login\` again.`], exit: EXIT.auth };
  }
  if (err.status === 403) return { lines: [first], exit: EXIT.auth };
  if (err.status === 429) {
    const wait = err.retryAfter ? `Retry after ${err.retryAfter} seconds.` : "Wait a minute before trying again.";
    return { lines: [first, wait], exit: EXIT.rateLimited };
  }
  if (err.status === 404) {
    const lines = [first];
    if (err.body?.removed) {
      if (err.body.removed_at) lines.push(`Removed: ${err.body.removed_at}`);
      if (err.body.deletes_on) lines.push(`Data deleted on: ${err.body.deletes_on}`);
    }
    if (err.body?.reason) lines.push(`Reason: ${err.body.reason}`);
    return { lines, exit: EXIT.notFound };
  }
  if (err.status >= 500) return { lines: [`Firemark answered ${err.status}. Try again shortly.`], exit: EXIT.error };
  const lines = [first];
  if (err.body?.field) lines.push(`Field: ${err.body.field}`);
  return { lines, exit: EXIT.error };
}
