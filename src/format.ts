import type { AnswersResponse, Brand, BrandsResponse, Count, Period, PromptsDocument, ResultsDocument, Verdict } from "./types.js";

/** "155 of 500 answers": a count is always printed with its base. */
export function ofBase(c: Count | undefined | null, unit = "answers"): string {
  if (!c) return "not known";
  return `${c.k} of ${c.n} ${unit}`;
}

export function table(headers: string[], rows: string[][], indent = ""): string[] {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all.map((r) => indent + r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ").trimEnd());
}

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  ai_overviews: "AI Overviews",
  ai_mode: "AI Mode",
  gemini: "Gemini",
  claude: "Claude",
};

const ENGINE_SHORT: Record<string, string> = {
  chatgpt: "GPT",
  perplexity: "PPLX",
  ai_overviews: "AIO",
  ai_mode: "AIM",
  gemini: "GEM",
  claude: "CLD",
};

export function engineLabel(key: string): string {
  return ENGINE_LABELS[key] ?? key;
}

function runRef(number: number | null | undefined, date: string): string {
  return number ? `run ${number} · ${date}` : `run of ${date}`;
}

function periodLines(p: Period | undefined): string[] {
  if (!p) return [];
  return p.line ? ["", p.line] : [];
}

export function formatBrands(r: BrandsResponse): string[] {
  if (r.brands.length === 0) return ["No brands in this workspace yet."];
  const rows = r.brands.map((b: Brand) => [
    b.name,
    b.id,
    b.website,
    b.cadence,
    b.state,
    String(b.groups.length),
    b.latest_publication ? runRef(b.latest_publication.run_number, b.latest_publication.run_date) : "nothing published yet",
  ]);
  return table(["NAME", "ID", "WEBSITE", "CADENCE", "STATE", "GROUPS", "LATEST RUN"], rows);
}

export function formatResults(doc: ResultsDocument, groupName?: string): string[] {
  const c = doc.context;
  const out: string[] = [];
  out.push(`${doc.brand.name} · ${runRef(c.run.number, c.run.date)} · publication v${c.publication.version}`);
  if (groupName) out.push(`Prompt group: ${groupName}`);
  out.push(`${c.prompts} prompts · ${c.engines.length} engines · run ${c.run.state}`);
  out.push("");
  out.push(`Named in ${ofBase(doc.counts.overall)}`);
  out.push(`Linked in ${ofBase(doc.counts.linked)}`);

  if (c.engines.length) {
    out.push("", "By engine");
    out.push(
      ...table(
        ["ENGINE", "NAMED IN"],
        c.engines.map((e) => [e.label + (e.short ? " (short)" : ""), ofBase(doc.counts.by_engine[e.key])]),
        "  ",
      ),
    );
  }

  const stages = ["tofu", "mofu", "bofu"].filter((s) => doc.counts.by_stage?.[s]);
  if (stages.length) {
    out.push("", "By stage");
    out.push(...table(["STAGE", "NAMED IN"], stages.map((s) => [s.toUpperCase(), ofBase(doc.counts.by_stage[s])]), "  "));
  }

  if (doc.competitors.length) {
    out.push("", "Competitors");
    out.push(
      ...table(
        ["RANK", "NAME", "NAMED IN"],
        doc.competitors.map((x) => [x.rank === null ? "-" : String(x.rank), x.name, ofBase(x.k === undefined ? null : { k: x.k, n: x.n })]),
        "  ",
      ),
    );
  }

  if (c.breaks.length) {
    out.push("", "Breaks in the series");
    for (const b of c.breaks) out.push(`  ${b.date}  ${b.engine ? engineLabel(b.engine) : "All engines"}  ${b.note}`);
  }

  out.push(...periodLines(doc.period));
  return out;
}

function mark(v: Verdict | null | undefined): string {
  if (!v) return "";
  if (v.state === "named_linked") return "NL";
  if (v.state === "named") return "N";
  if (v.state === "linked") return "L";
  return "-";
}

export function formatPrompts(doc: PromptsDocument, brandName: string, groupName?: string): string[] {
  const out: string[] = [];
  out.push(`${brandName} · ${runRef(doc.run.number, doc.run.date)} · ${doc.prompts.length} prompts`);
  if (groupName) out.push(`Prompt group: ${groupName}`);
  out.push("");
  if (doc.prompts.length === 0) return [...out, "No prompts in this run."];
  const keys = doc.engines.map((e) => e.key);
  const headers = ["ID", "STAGE", "NAMED ON", ...doc.engines.map((e) => ENGINE_SHORT[e.key] ?? e.label)];
  const rows = doc.prompts.map((p) => {
    const asked = keys.filter((k) => p.verdicts[k]).length;
    return [p.id, p.stage, `${p.named_engines} of ${asked} engines`, ...keys.map((k) => mark(p.verdicts[k]))];
  });
  const lines = table(headers, rows);
  out.push(lines[0]!);
  doc.prompts.forEach((p, i) => {
    out.push(lines[i + 1]!);
    out.push(`      ${p.text}`);
  });
  out.push("");
  out.push("NL named and linked · N named · L linked, not named · - neither · blank: not asked");
  out.push(`Engines: ${doc.engines.map((e) => `${ENGINE_SHORT[e.key] ?? e.label} ${e.label}`).join(", ")}`);
  out.push(...periodLines(doc.period));
  return out;
}

function indentText(text: string, pad = "  "): string[] {
  return text.split(/\r?\n/).map((l) => (l ? pad + l : ""));
}

export function formatAnswers(r: AnswersResponse, brandName: string, engineFilter?: string): string[] {
  const out: string[] = [];
  out.push(`${brandName} · ${r.prompt_id} · run ${r.run_id}`);
  out.push(`Prompt: ${r.prompt}`);
  const keys = Object.keys(r.engines).filter((k) => !engineFilter || k === engineFilter);
  if (keys.length === 0) {
    out.push("", engineFilter ? `No answer from ${engineLabel(engineFilter)} for this prompt in this run.` : "No engine answered this prompt in this run.");
    return out;
  }
  for (const k of keys) {
    const a = r.engines[k]!;
    out.push("");
    out.push(`== ${engineLabel(k)}${a.model ? ` (${a.model})` : ""} ==`);
    if (a.status !== "ok") {
      out.push(`Status: ${a.status === "no_answer" ? "no answer" : "error"}`);
      continue;
    }
    out.push(`Tracked names found: ${a.matches.length ? a.matches.map((m) => m.name + (m.linked ? " (linked)" : "")).join(", ") : "none"}`);
    if (a.sources.length) {
      out.push(`Sources (${a.sources.length}):`);
      a.sources.forEach((s, i) => out.push(`  ${i + 1}. ${s.title ? `${s.title} · ` : ""}${s.url}`));
    } else {
      out.push("Sources: none");
    }
    out.push("Answer:");
    out.push(...indentText(a.text));
  }
  return out;
}
