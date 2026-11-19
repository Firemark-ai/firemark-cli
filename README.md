# Firemark CLI

Read your [Firemark](https://tryfiremark.com) results from the terminal: your brands, each brand's latest
results, every prompt's verdict per engine, and the stored answers to one prompt.

The CLI reads the [Firemark API](https://tryfiremark.com/docs/api). It is read-only: it never starts a run or
changes a brand.

## Install

Node.js 20 or later.

```sh
npm install -g @firemark-ai/cli
```

Or run it without installing: `npx @firemark-ai/cli brands`.

## Log in

Create an API key in Firemark under **API keys** in the account menu
([app.tryfiremark.com/account/api-keys](https://app.tryfiremark.com/account/api-keys)). The API is included on
every paid plan.

```sh
firemark login
```

`login` asks for the key without showing it, checks it against the API, and saves it in your config directory
with file mode 600:

| Platform | File |
|---|---|
| Linux and others | `$XDG_CONFIG_HOME/firemark/config.json`, or `~/.config/firemark/config.json` |
| macOS | `~/Library/Application Support/firemark/config.json` (or `$XDG_CONFIG_HOME/firemark/` when set) |
| Windows | `%APPDATA%\firemark\config.json` |

You can also pipe the key in (`firemark login < key.txt`) or pass `--key`. In CI, skip `login` and set
`FIREMARK_API_KEY`; when it is set it is used before the saved key. `firemark logout` deletes the saved key.

A key reads every brand in its workspace. Treat it like a password: if it leaks, revoke it on the API keys page
and create another.

## Commands

`<brand>` is a brand's id, its name (`Larkspur`, `larkspur`) or its website (`larkspur.example`), as listed by
`firemark brands`. Every command takes `--json` to print the API's JSON exactly as it comes.

### `firemark brands`

```
$ firemark brands
NAME             ID                                    WEBSITE                          CADENCE  STATE   GROUPS  LATEST RUN
Larkspur         8d2f4b1c-6a3e-4f7d-9b20-5c1e7a9d3f42  https://larkspur.example         weekly   active  1       run 12 · 2026-11-16
Larkspur Studio  1b7e9c3a-2d4f-4a8b-8c6d-0e3f5a7b9c11  https://studio.larkspur.example  monthly  paused  0       nothing published yet
```

### `firemark results <brand>`

The brand's latest published results. Every figure is printed with its base.

```
$ firemark results Larkspur
Larkspur · run 12 · 2026-11-16 · publication v14
6 prompts · 5 engines · run complete

Named in 16 of 29 answers
Linked in 8 of 29 answers

By engine
  ENGINE        NAMED IN
  ChatGPT       5 of 6 answers
  Perplexity    3 of 6 answers
  AI Overviews  3 of 6 answers
  AI Mode       3 of 5 answers
  Gemini        2 of 6 answers

By stage
  STAGE  NAMED IN
  TOFU   3 of 10 answers
  MOFU   4 of 9 answers
  BOFU   9 of 10 answers

Competitors
  RANK  NAME           NAMED IN
  1     Fernwood       14 of 29 answers
  3     Halden & Co    5 of 29 answers
  4     Marrow Supply  3 of 29 answers

Breaks in the series
  2026-11-09  AI Mode  AI Mode answers are read a new way from this run.
```

`--group <group>` reads one prompt group (its id or name, from `GET /brands`); `--range <range>` reads a period
(`latest`, `4r`, `12r`, `30d`, `90d`, `qtd`, `12m`) and prints the period's caption.

### `firemark prompts <brand>`

Each prompt's verdict on each engine in the latest published run.

```
$ firemark prompts Larkspur
Larkspur · run 12 · 2026-11-16 · 6 prompts

ID    STAGE  NAMED ON        GPT  PPLX  AIO  AIM  GEM
P001  tofu   2 of 5 engines  N    -     NL   -    -
      What should I look for in a clienteling app for a small boutique?
P002  tofu   1 of 5 engines  -    -     N    -    L
      How do independent fashion stores keep in touch with repeat customers?
P003  mofu   3 of 5 engines  NL   N     -    N    -
      Best retail CRM for a three-store apparel brand
P004  mofu   1 of 4 engines  N    -     -         -
      Clienteling tools that work with Shopify POS
P005  bofu   5 of 5 engines  NL   NL    N    NL   N
      Larkspur vs Fernwood for store associates
P006  bofu   4 of 5 engines  N    NL    -    N    NL
      Is Larkspur worth it for a single boutique?

NL named and linked · N named · L linked, not named · - neither · blank: not asked
Engines: GPT ChatGPT, PPLX Perplexity, AIO AI Overviews, AIM AI Mode, GEM Gemini
```

Takes `--group` and `--range`, like `results`.

### `firemark answers <brand> <prompt>`

One prompt's stored answers, engine by engine, word for word, with the sources each engine cited. `<prompt>` is
the prompt's id from `firemark prompts` (`P003`).

```
$ firemark answers Larkspur P003
Larkspur · P003 · run c3a1e5f7-9b2d-4e6a-8f1c-3d5b7a9e2c40
Prompt: Best retail CRM for a three-store apparel brand

== ChatGPT (gpt-5.1) ==
Tracked names found: Larkspur (linked), Fernwood
Sources (2):
  1. Clienteling for boutiques · https://larkspur.example/clienteling
  2. https://retailtalk.example/crm-guide
Answer:
  For a three-store apparel brand, two options stand out.

  1. Larkspur is built for small multi-store apparel teams, with clienteling on the shop floor.
  2. Fernwood suits larger chains that want deep loyalty tooling.

== Perplexity ==
Tracked names found: Larkspur, Fernwood
Sources: none
Answer:
  Larkspur and Fernwood both offer store-level CRM.

== Gemini ==
Status: no answer
```

`--engine <engine>` shows one engine (`chatgpt`, `perplexity`, `ai_overviews`, `ai_mode`, `gemini`,
`claude`); `--run <run id>` reads another published run. Answers are kept for 13 months.

### Options for every command

| Option | |
|---|---|
| `--json` | Print the API's JSON as it comes |
| `--base-url <url>` | Use another API address (default `https://app.tryfiremark.com/api/v1`; also `FIREMARK_BASE_URL`) |
| `-h`, `--help` | Help |
| `-v`, `--version` | Version |

## How the CLI reports figures

The CLI follows the same rules as the Firemark app and the Firemark MCP server:

- Every count comes with its base: "16 of 29 answers", never a bare number.
- Firemark's own sentences (`statement`, `claims`, `line`, captions and notes) are printed exactly as the API sends them.
- The CLI works out no changes, rankings or percentages the API does not state. A rank is printed only when
  the API gives one.

## Errors and limits

Errors print the API's own sentence and its code, for example
`Rate limit reached. (429 rate_limited)` followed by `Retry after 17 seconds.` Each key may make 60 requests a
minute. Each command makes one or two requests (`results`, `prompts` and `answers` read `GET /brands` first to
find the brand).

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | Another API error (400, 5xx) |
| 2 | Usage error |
| 3 | No key, a key the API refuses (401) or a workspace without a paid plan (403) |
| 4 | Not found: no such brand, group, prompt or published run (404) |
| 5 | Rate limited (429) |
| 6 | Network error |

## API reference

[tryfiremark.com/docs/api](https://tryfiremark.com/docs/api). The OpenAPI document is at
`https://app.tryfiremark.com/api/v1/openapi.json`.

## License

MIT
