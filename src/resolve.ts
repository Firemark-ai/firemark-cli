import type { Brand, PromptGroup } from "./types.js";

export class ResolveError extends Error {
  constructor(message: string, readonly candidates: string[] = []) {
    super(message);
    this.name = "ResolveError";
  }
}

export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function host(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

/**
 * Finds one item by id, then by name (case-insensitive), then by slug, then by website, then by a unique
 * part of its name. Several equal matches are an error that lists them.
 */
function pick<T extends { id: string; name: string }>(items: T[], input: string, kind: string, extra?: (t: T) => string | undefined): T {
  const q = input.trim();
  const tiers: ((t: T) => boolean)[] = [
    (t) => t.id === q,
    (t) => t.name.trim().toLowerCase() === q.toLowerCase(),
    (t) => slug(t.name) === slug(q) && slug(q) !== "",
    (t) => (extra ? host(extra(t) ?? "") === host(q) && host(q) !== "" : false),
    (t) => slug(q) !== "" && slug(t.name).includes(slug(q)),
  ];
  for (const test of tiers) {
    const hits = items.filter(test);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      throw new ResolveError(
        `"${input}" matches more than one ${kind}. Use its id:`,
        hits.map((h) => `${h.id}  ${h.name}`),
      );
    }
  }
  throw new ResolveError(`No ${kind} matches "${input}".`);
}

export function resolveBrand(brands: Brand[], input: string): Brand {
  return pick(brands, input, "brand", (b) => b.website);
}

export function resolveGroup(brand: Brand, input: string): PromptGroup {
  return pick(brand.groups, input, `prompt group of ${brand.name}`);
}
