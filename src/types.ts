// The parts of the Firemark API's responses the human output reads. The full shapes are in the API's
// OpenAPI document (GET /api/v1/openapi.json); --json prints the bodies as they come.

export interface Count {
  k: number;
  n: number;
  share?: number;
}

export interface Publication {
  version: number;
  reason: string;
  published_at: string;
  run_id: string;
  run_number: number | null;
  run_date: string;
}

export interface PromptGroup {
  id: string;
  name: string;
  revision: number;
  prompts: number;
  updated_at: string;
}

export interface Brand {
  id: string;
  name: string;
  website: string;
  cadence: string;
  state: string;
  created_at: string;
  latest_publication: Publication | null;
  groups: PromptGroup[];
}

export interface BrandsResponse {
  account_id: string;
  brands: Brand[];
}

export interface PeriodRun {
  run_id: string;
  number: number | null;
  date: string;
}

export interface Period {
  range: string;
  label: string;
  runs: number;
  selected_run: PeriodRun | null;
  line: string | null;
}

export interface ResultsEngineInfo {
  key: string;
  label: string;
  asked: number;
  base: number;
  short: boolean;
}

export interface ResultsDocument {
  schema: "results";
  brand: { id: string; name: string; domains: string[] };
  context: {
    run: { id: string; number: number; date: string; state: string; runs_to_date: number };
    publication: { version: number; reason: string };
    prompts: number;
    engines: ResultsEngineInfo[];
    breaks: { engine: string | null; kind: string; run_id: string; date: string; note: string }[];
  };
  counts: {
    overall: Count;
    linked: Count;
    by_engine: Record<string, Count>;
    by_stage: Record<string, Count>;
  };
  competitors: { id: string; name: string; k?: number; n: number; floored: boolean; rank: number | null }[];
  period?: Period;
}

export interface Verdict {
  state: "named_linked" | "named" | "linked" | "absent";
  named: boolean;
  linked: boolean;
}

export interface PromptsDocument {
  schema: "prompts";
  run: { id: string; number: number; date: string };
  publication_version: number;
  engines: { key: string; label: string }[];
  prompts: {
    id: string;
    text: string;
    stage: string;
    verdicts: Record<string, Verdict | null>;
    named_engines: number;
    branded?: boolean;
  }[];
  period?: Period;
}

export interface EngineAnswer {
  status: "ok" | "no_answer" | "error";
  text: string;
  snippet: string | null;
  sources: { url: string; title: string | null; domain: string }[];
  model: string | null;
  matches: { id: string; name: string; linked: boolean }[];
}

export interface AnswersResponse {
  schema: "answer";
  brand_id: string;
  run_id: string;
  prompt_id: string;
  prompt: string;
  engines: Record<string, EngineAnswer>;
}
