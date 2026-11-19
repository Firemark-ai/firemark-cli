// A small JSON Schema (2020-12 subset) checker, enough to prove the fixtures match the API's OpenAPI schemas.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Schema = Record<string, unknown> | boolean;

const doc = JSON.parse(readFileSync(fileURLToPath(new URL("../../test/fixtures/openapi-schemas.json", import.meta.url)), "utf8")) as {
  schemas: Record<string, Schema>;
};

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(want: string, got: string): boolean {
  return want === got || (want === "number" && got === "integer");
}

export function validate(value: unknown, schema: Schema, path = "$"): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${path}: not allowed`];
  const s = schema as Record<string, any>;
  const errs: string[] = [];
  if (s.$ref) {
    const name = String(s.$ref).split("/").pop()!;
    const target = doc.schemas[name];
    if (target === undefined) return [`${path}: unknown $ref ${s.$ref}`];
    errs.push(...validate(value, target, path));
  }
  const t = typeOf(value);
  if (s.type !== undefined) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((w) => typeMatches(w, t))) return [...errs, `${path}: expected ${types.join("|")}, got ${t}`];
  }
  if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(value)) errs.push(`${path}: expected ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (s.anyOf && !s.anyOf.some((x: Schema) => validate(value, x, path).length === 0)) errs.push(`${path}: matches no anyOf branch`);
  if (s.oneOf && s.oneOf.filter((x: Schema) => validate(value, x, path).length === 0).length !== 1) errs.push(`${path}: does not match exactly one oneOf branch`);
  if (s.allOf) for (const x of s.allOf) errs.push(...validate(value, x, path));
  if (s.not && validate(value, s.not, path).length === 0) errs.push(`${path}: matches not`);
  if (s.if !== undefined) {
    if (validate(value, s.if, path).length === 0) {
      if (s.then !== undefined) errs.push(...validate(value, s.then, path));
    } else if (s.else !== undefined) errs.push(...validate(value, s.else, path));
  }
  if (t === "integer" || t === "number") {
    const n = value as number;
    if (s.minimum !== undefined && n < s.minimum) errs.push(`${path}: below minimum ${s.minimum}`);
    if (s.maximum !== undefined && n > s.maximum) errs.push(`${path}: above maximum ${s.maximum}`);
  }
  if (t === "string") {
    const str = value as string;
    if (s.minLength !== undefined && str.length < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && str.length > s.maxLength) errs.push(`${path}: longer than ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern, "u").test(str)) errs.push(`${path}: does not match ${s.pattern}`);
  }
  if (t === "array") {
    const arr = value as unknown[];
    if (s.minItems !== undefined && arr.length < s.minItems) errs.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && arr.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems} items`);
    const prefix: Schema[] = s.prefixItems ?? [];
    arr.forEach((item, i) => {
      if (i < prefix.length) errs.push(...validate(item, prefix[i]!, `${path}[${i}]`));
      else if (s.items !== undefined) errs.push(...validate(item, s.items, `${path}[${i}]`));
    });
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const props: Record<string, Schema> = s.properties ?? {};
    for (const r of s.required ?? []) if (!(r in obj)) errs.push(`${path}: missing ${r}`);
    if (s.maxProperties !== undefined && Object.keys(obj).length > s.maxProperties) errs.push(`${path}: too many properties`);
    for (const [k, v] of Object.entries(obj)) {
      if (s.propertyNames) errs.push(...validate(k, s.propertyNames, `${path}.<name ${k}>`));
      if (k in props) errs.push(...validate(v, props[k]!, `${path}.${k}`));
      else if (s.additionalProperties !== undefined) errs.push(...validate(v, s.additionalProperties, `${path}.${k}`));
    }
  }
  return errs;
}

export function validateAs(value: unknown, name: string): string[] {
  return validate(value, { $ref: `#/components/schemas/${name}` });
}
