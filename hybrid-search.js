// ─────────────────────────────────────────────────────────────────────────────
// SPARK RAG Evolution — Phase 3: Hybrid Search (BM25 + vectors, RRF fusion)
//
// Why: exact strings — "Airbus", "Qmod", "Bowery", "$20,000" — should match
// lexically even when embedding similarity drifts. Keyword and vector rankings
// are merged with Reciprocal Rank Fusion so neither dominates.
//
// Install:  npm install minisearch
// Enable:   USE_HYBRID_SEARCH=true   (env; off = identical to current behavior)
// Wiring:   one flag-gated line swap inside findRelevantContext —
//           see RAG-EVOLUTION.md → Phase 3.
//
// Scale note: the keyword index is rebuilt per request over the (possibly
// pre-filtered) store. At ~150 chunks this costs ~1ms. If the store ever grows
// past a few thousand chunks, build once at boot and filter afterward instead.
// ─────────────────────────────────────────────────────────────────────────────
const MiniSearch = require('minisearch');

const RRF_K = 60; // standard damping constant; higher = flatter fusion

/**
 * Re-scores the store with fused BM25 + vector ranks.
 * Returns the same shape server.js already expects: store items spread with a
 * numeric `score` (higher = better), UNSORTED — downstream code sorts, exactly
 * as it does today with raw dot-product scores.
 *
 * @param {string}   query        raw user query
 * @param {Array}    store        chunk objects ({content, embedding, metadata})
 * @param {number[]} queryVector  embedding of the query
 * @param {Function} dotFn        dot-product function from server.js
 */
function applyHybrid(query, store, queryVector, dotFn) {
    // 1. Keyword ranking (BM25-family scoring via MiniSearch)
    const mini = new MiniSearch({
        fields: ['title', 'content'],
        idField: 'id',
        searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.1 }
    });
    mini.addAll(store.map((item, id) => ({
        id,
        title: item.metadata?.title || '',
        content: (item.content || '').slice(0, 2000)
    })));
    const kwRank = new Map(mini.search(query).map((r, rank) => [r.id, rank]));

    // 2. Vector ranking
    const vecOrder = store
        .map((item, id) => ({ id, v: dotFn(queryVector, item.embedding) }))
        .sort((a, b) => b.v - a.v);
    const vecRank = new Map(vecOrder.map((r, rank) => [r.id, rank]));

    // 3. Reciprocal Rank Fusion
    const miss = store.length + RRF_K; // rank assumed for docs absent from a list
    return store.map((item, id) => {
        const rrf =
            1 / (RRF_K + (vecRank.has(id) ? vecRank.get(id) : miss)) +
            (kwRank.has(id) ? 1 / (RRF_K + kwRank.get(id)) : 0);
        return { ...item, score: rrf };
    });
}

module.exports = { applyHybrid };
