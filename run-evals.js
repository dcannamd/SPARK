// ─────────────────────────────────────────────────────────────────────────────
// SPARK RAG Evolution — Phase 1: Evaluation Runner
//
// Usage:
//   node evals/run-evals.js            → retrieval evals (reads memory_store.json
//                                        directly; server does NOT need to run;
//                                        run "node build-kb.js" first if missing)
//   node evals/run-evals.js --live     → end-to-end evals against a running
//                                        server (node server.js in another tab)
//
// Env: EVAL_BASE_URL (default http://localhost:3000), GOOGLE_API_KEY
//
// Statuses: PASS (expected is #1) · PARTIAL (expected in top results / mentioned
// in live response) · FAIL · CONFIG (an expected title doesn't exist in the
// store — fix test-questions.json, not the code).
//
// NOTE: The search functions below intentionally mirror server.js
// (findRelevantContext / findContextForHiddenPage / list dedupe) so retrieval
// can be scored in isolation. If you change that logic in server.js, mirror it
// here — or rely on --live mode, which always tests the real thing.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const STORE_PATH = path.join(__dirname, '..', 'vector_store', 'memory_store.json');
const SUITE = require('./test-questions.json');
const LIVE = process.argv.includes('--live');
const BASE_URL = process.env.EVAL_BASE_URL || 'http://localhost:3000';

const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "gemini-embedding-001",
    modelName: "gemini-embedding-001"
});

const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadStore() {
    if (!fs.existsSync(STORE_PATH)) {
        console.error('❌ memory_store.json not found. Run "node build-kb.js" first.');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

// ── Retrieval replicas (keep in sync with server.js) ─────────────────────────
function searchStandard(qv, store, topK = 5) {
    return store
        .filter(i => i.metadata?.visible !== "No")
        .map(i => ({ title: i.metadata?.title || '', score: dot(qv, i.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function searchHidden(qv, store, topK = 15) {
    return store
        .filter(i => i.metadata?.visible === "No")
        .map(i => ({ title: i.metadata?.title || '', score: dot(qv, i.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function searchList(qv, store) {
    const scored = store
        .map(i => ({ i, score: dot(qv, i.embedding) }))
        .sort((a, b) => b.score - a.score);
    const seen = new Set();
    const titles = [];
    for (const { i } of scored) {
        const t = i.metadata?.title;
        if (t && i.metadata?.visible !== "No" && !seen.has(normalize(t))) {
            seen.add(normalize(t));
            titles.push(t);
        }
    }
    return titles;
}

// ── Judging ──────────────────────────────────────────────────────────────────
function expectedList(test) {
    return test.expectTop ? [test.expectTop] : (test.expectAny || []);
}

function configCheck(test, storeTitleSet) {
    const missing = [];
    for (const t of [...expectedList(test), ...(test.expectContains || [])]) {
        if (!storeTitleSet.has(normalize(t))) missing.push(t);
    }
    return missing;
}

function judgeRanked(test, ranked) {
    const wanted = expectedList(test).map(normalize);
    const top1 = normalize(ranked[0]?.title);
    if (wanted.includes(top1)) return { status: 'PASS', detail: `#1 = "${ranked[0].title}"` };
    const hitIdx = ranked.findIndex(r => wanted.includes(normalize(r.title)));
    if (hitIdx > -1) return { status: 'PARTIAL', detail: `expected at rank ${hitIdx + 1}; #1 = "${ranked[0]?.title}"` };
    return { status: 'FAIL', detail: `top3: ${ranked.slice(0, 3).map(r => `"${r.title}"`).join(', ')}` };
}

function judgeList(test, titles) {
    const have = new Set(titles.map(normalize));
    const missing = (test.expectContains || []).filter(t => !have.has(normalize(t)));
    const leaked = (test.expectExcludes || []).filter(t => have.has(normalize(t)));
    if (missing.length === 0 && leaked.length === 0) return { status: 'PASS', detail: `${titles.length} projects returned` };
    const bits = [];
    if (missing.length) bits.push(`missing: ${missing.join(', ')}`);
    if (leaked.length) bits.push(`should be excluded: ${leaked.join(', ')}`);
    return { status: 'FAIL', detail: bits.join(' | ') };
}

// ── Live mode ────────────────────────────────────────────────────────────────
async function runLiveTest(test) {
    await fetch(`${BASE_URL}/reset-chat`, { method: 'POST' }).catch(() => {});
    const res = await fetch(`${BASE_URL}/ask-buddy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: test.query })
    });
    const data = await res.json();
    const text = data.response || '';
    const normText = normalize(text);

    if (test.route === 'list') {
        const have = (t) => normText.includes(normalize(t));
        const missing = (test.expectContains || []).filter(t => !have(t));
        const leaked = (test.expectExcludes || []).filter(t => have(t));
        const yearsOk = !test.expectYears || /\b20\d\d\b/.test(text);
        if (missing.length === 0 && leaked.length === 0 && yearsOk) return { status: 'PASS', detail: 'contains/excludes/years OK' };
        const bits = [];
        if (missing.length) bits.push(`missing: ${missing.join(', ')}`);
        if (leaked.length) bits.push(`leaked: ${leaked.join(', ')}`);
        if (!yearsOk) bits.push('no years found');
        return { status: 'FAIL', detail: bits.join(' | ') };
    }

    const wanted = expectedList(test).map(normalize);
    const tag = normalize(data.topProjectTitle);
    if (tag && wanted.includes(tag)) return { status: 'PASS', detail: `[[PROJECT]] = "${data.topProjectTitle}"` };
    if (wanted.some(w => normText.includes(w))) return { status: 'PARTIAL', detail: `mentioned in text; [[PROJECT]] = "${data.topProjectTitle || 'none'}"` };
    return { status: 'FAIL', detail: `[[PROJECT]] = "${data.topProjectTitle || 'none'}"` };
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    const store = LIVE ? null : loadStore();
    const storeTitleSet = LIVE
        ? null
        : new Set(store.map(i => normalize(i.metadata?.title)).filter(Boolean));

    console.log(`\n🧪 SPARK evals — ${LIVE ? `LIVE mode → ${BASE_URL}` : `retrieval mode → ${STORE_PATH}`}`);
    console.log(`   ${SUITE.tests.length} tests\n`);

    const results = [];
    for (const test of SUITE.tests) {
        let outcome;
        try {
            if (!LIVE) {
                const missing = configCheck(test, storeTitleSet);
                if (missing.length && test.route !== 'list') {
                    outcome = { status: 'CONFIG', detail: `not in store: ${missing.join(', ')}` };
                } else {
                    const qv = await embeddings.embedQuery(test.query);
                    if (test.route === 'hidden') outcome = judgeRanked(test, searchHidden(qv, store));
                    else if (test.route === 'list') outcome = judgeList(test, searchList(qv, store));
                    else outcome = judgeRanked(test, searchStandard(qv, store));
                    await sleep(150);
                }
            } else {
                outcome = await runLiveTest(test);
                await sleep(300);
            }
        } catch (e) {
            outcome = { status: 'ERROR', detail: e.message };
        }
        const icon = { PASS: '✅', PARTIAL: '🟡', FAIL: '❌', CONFIG: '⚙️', ERROR: '💥' }[outcome.status];
        console.log(`${icon} ${test.id} [${outcome.status}] ${test.query}`);
        console.log(`      ${outcome.detail}`);
        results.push({ ...test, ...outcome });
    }

    const count = (s) => results.filter(r => r.status === s).length;
    const scored = results.filter(r => r.status !== 'CONFIG' && r.status !== 'ERROR').length;
    const hitRate = scored ? Math.round((count('PASS') / scored) * 100) : 0;

    console.log('\n──────────────────────────────────────────────');
    console.log(`   PASS ${count('PASS')} · PARTIAL ${count('PARTIAL')} · FAIL ${count('FAIL')} · CONFIG ${count('CONFIG')} · ERROR ${count('ERROR')}`);
    console.log(`   Strict hit rate: ${hitRate}% (${count('PASS')}/${scored})`);
    console.log('──────────────────────────────────────────────');

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}${LIVE ? '-live' : '-retrieval'}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ mode: LIVE ? 'live' : 'retrieval', hitRate, results }, null, 2));
    console.log(`   Saved: ${outFile}\n`);
})();
