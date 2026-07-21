# SPARK — RAG Evolution Guide
### Branch: `feat/rag-evolution`

Four phases, strictly in order. **Phase 1 ships first and gates everything else** — no phase merges to production unless it beats the recorded baseline. Every phase is behind an env flag, off by default, with automatic fallback to current behavior, so the branch is always deployable.

| Phase | What | New file | Flag | Touches |
|---|---|---|---|---|
| 1 | Eval suite | `evals/test-questions.json`, `evals/run-evals.js` | — | nothing |
| 2 | LLM query router | `query-router.js` | `USE_LLM_ROUTER=true` | `server.js` (small) |
| 3 | Hybrid search (BM25+RRF) | `hybrid-search.js` | `USE_HYBRID_SEARCH=true` | `server.js` (1 swap) |
| 4 | Contextual retrieval | `contextual-preface.js` | `USE_CONTEXTUAL_RETRIEVAL=true` | `build-kb.js` (small) |

Setup on the new branch:
```bash
git checkout feat/rag-evolution
npm install minisearch        # Phase 3 only new dependency
```
Copy the new files into the repo root (`query-router.js`, `hybrid-search.js`, `contextual-preface.js`) and the `evals/` folder alongside them. Add `evals/results/` to `.gitignore` if you don't want result snapshots committed.

---

## Phase 1 — Evals (do this before touching anything)

```bash
node build-kb.js              # ensure a fresh local store
node evals/run-evals.js       # retrieval-level baseline (no server needed)

node server.js                # in a second terminal, then:
node evals/run-evals.js --live
```

- **Retrieval mode** scores the vector store directly (mirrors of the server's three search paths) — fast, isolated, no chat-token cost.
- **Live mode** hits the real `/ask-buddy` endpoint — the ground truth. It calls `/reset-chat` before each test so history doesn't bleed between questions.
- `CONFIG` results mean an expected title in `test-questions.json` doesn't match Notion exactly — fix the JSON, not the code. (Apostrophes and dashes are normalized, so curly quotes don't matter.)
- Results print to console and save to `evals/results/<timestamp>.json`. **Record your baseline hit rate now** — it's the number every later phase must beat.

The 32 tests encode every bug fixed during v1: Airbus title-word false positives, school/skills/effectiveness routing, multi-product page retrieval, list integrity (no Untitled, no hidden pages, no design sub-pages, years present), exact-figure lookups.

---

## Phase 2 — LLM Router (`USE_LLM_ROUTER=true`)

One `gemini-2.5-flash` call classifies each message into `{intent, project, roles}` with exact-title matching against the live store. Any failure returns `null` → the existing regex path runs unchanged. Expected trade-off: +0.5–1.5s latency per message.

**Wiring — four small edits in `server.js`** (anchors are single lines that exist in the current file; whitespace may differ slightly):

**2a. Import** — add near the other requires at the top:
```javascript
const { routeQuery } = require('./query-router.js');
```

**2b. Call the router** — inside `/ask-buddy`, insert immediately **after** the line `if (frontendProjectTitle) console.log(...)`:
```javascript
        let routed = null;
        if (process.env.USE_LLM_ROUTER === "true") {
            const visibleTitles = [...new Set(memoryStore.filter(i => i.metadata?.visible !== "No").map(i => i.metadata?.title).filter(Boolean))];
            const hiddenTitles  = [...new Set(memoryStore.filter(i => i.metadata?.visible === "No").map(i => i.metadata?.title).filter(Boolean))];
            routed = await routeQuery(userPrompt, visibleTitles, hiddenTitles);
            if (routed) console.log(`🧭 Router: ${JSON.stringify(routed)}`);
        }
```

**2c. Let the router drive the flags** — replace these three lines (find each by its `const <name> =` prefix):
```javascript
        const hiddenPageQuery = routed ? routed.intent === "personal" : (isHiddenPageQuery(userPrompt) || isPersonalQuery(userPrompt));
        const listQuery       = routed ? routed.intent === "list"     : isListQuery(userPrompt);
        const timelineQuery   = routed ? routed.intent === "timeline" : isTimelineQuery(userPrompt);
```

**2d. Project anchoring + regex bypass** — find the detection guard line `if (activeRoles.length === 0 && !isDirectProjectQuery) {` and change it to also skip when the router answered:
```javascript
            if (activeRoles.length === 0 && !isDirectProjectQuery && !routed) {
```
Then insert immediately **after** that whole detection `if { ... }` block:
```javascript
            if (routed && routed.intent === "project" && routed.project) {
                filteredStore = filterByProject(memoryStore, routed.project);
            } else if (routed && routed.roles.length > 0) {
                filteredStore = preFilterStore(memoryStore, { roles: routed.roles });
            }
```

**Validate:** `USE_LLM_ROUTER=true node server.js` → `node evals/run-evals.js --live` → compare to baseline. Watch the `🧭 Router:` log lines for sensible classifications. Then run once with the flag off to confirm zero regression on the fallback path.

---

## Phase 3 — Hybrid Search (`USE_HYBRID_SEARCH=true`)

**Wiring — one import + one flag-gated swap in `server.js`:**

Import at the top:
```javascript
const { applyHybrid } = require('./hybrid-search.js');
```

Inside `findRelevantContext`, find:
```javascript
        const scored = store.map(item => ({
            ...item,
            score: dotProduct(queryVector, item.embedding)
        }));
```
Replace with:
```javascript
        const scored = process.env.USE_HYBRID_SEARCH === "true"
            ? applyHybrid(query, store, queryVector, dotProduct)
            : store.map(item => ({ ...item, score: dotProduct(queryVector, item.embedding) }));
```
Everything downstream (dedupe branches, sorting, date sort) is untouched — `applyHybrid` returns the same shape with fused scores. Optional: apply the identical swap inside the cover-letter endpoint's scoring block.

**Validate:** evals with flag on vs off. Expect the single-word tests (R09 Clamp, R10 Bowery, R14 "$20,000") to be the first movers.

---

## Phase 4 — Contextual Retrieval (`USE_CONTEXTUAL_RETRIEVAL=true`)

**Wiring — inside the chunk loop in `build-kb.js`:**

Import at the top:
```javascript
const { generateChunkPreface } = require('./contextual-preface.js');
```

Find (inside `for (const chunk of chunks) {`):
```javascript
                const vector = await embeddings.embedQuery(chunk);
```
Replace with:
```javascript
                const preface = await generateChunkPreface(title, impact, chunk);
                const enrichedChunk = preface ? `${preface}\n\n${chunk}` : chunk;
                const vector = await embeddings.embedQuery(enrichedChunk);
```
And a few lines below, change what gets stored so retrieval returns the enriched text:
```javascript
                    content: enrichedChunk,
```

**Validate:** `USE_CONTEXTUAL_RETRIEVAL=true node build-kb.js` (slower — one extra flash call per chunk), then re-run evals. **This phase changes chunk content, so re-baseline**: compare Phase-4-on vs Phase-4-off rebuilds, not against pre-Phase-4 result files.

---

## Render / production

- Production stays on `feat/gemini-3-digital-twin` untouched. Optionally point a second free Render service at `feat/rag-evolution` as staging; set the flags in that service's Environment tab.
- Merge criteria per phase: live-mode hit rate ≥ baseline, zero new FAILs among the regression-guard tests (R01, R03, R04, H01–H03, L01), and no format-contract breaks (years in lists, `[[PROJECT:]]` tags present).
- Merge: `git checkout feat/gemini-3-digital-twin && git merge feat/rag-evolution && git push`, then add the enabled flags to the production service's environment.

## Provider bake-off (optional, after Phase 1)

With evals in place you can settle Gemini vs Claude empirically: extract the chat call behind the `ai-client.js` abstraction described in `agents.md`, run the live suite against `gemini-2.5-flash` and a Claude model, and compare hit rate + format-contract failures. Swap only the Response Agent if the numbers justify it; embeddings stay where they are regardless (Anthropic has no embeddings API).
