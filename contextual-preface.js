// ─────────────────────────────────────────────────────────────────────────────
// SPARK RAG Evolution — Phase 4: Contextual Retrieval (build-time)
//
// Before embedding each chunk, an LLM writes a 1–2 sentence preface situating
// the chunk within its project ("This chunk describes the Bowery Table Lamp
// within Dana's industrial design practice at ..."). The preface is prepended
// to the chunk BEFORE embedding and is stored as part of the chunk content —
// formalizing the metadata-injection trick that already works in build-kb.js,
// and directly improving retrieval on multi-section pages.
//
// Cost: one gemini-2.5-flash call per chunk per rebuild (~150 calls, pennies).
// Enable:  USE_CONTEXTUAL_RETRIEVAL=true   (env; off = build unchanged)
// Wiring:  small change inside build-kb.js chunk loop —
//          see RAG-EVOLUTION.md → Phase 4.
// After enabling: rebuild the store, then RE-BASELINE evals (chunk content
// changes, so retrieval-mode scores are not comparable to earlier runs).
// ─────────────────────────────────────────────────────────────────────────────
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Returns a short situating preface for one chunk, or "" on any failure
 * (build must never crash because of a preface).
 */
async function generateChunkPreface(projectTitle, businessImpact, chunkText) {
    if (process.env.USE_CONTEXTUAL_RETRIEVAL !== "true") return "";
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { temperature: 0, maxOutputTokens: 120 }
        });

        const prompt = `
Write 1-2 plain sentences situating the CHUNK below within its project, for a
search index. State which project/product/section it belongs to and what it
covers. No preamble, no quotes, no markdown — output only the sentences.

PROJECT: ${projectTitle}
PROJECT SUMMARY: ${businessImpact || "N/A"}

CHUNK:
${chunkText.slice(0, 1500)}
        `.trim();

        const result = await model.generateContent(prompt);
        const preface = (result.response.text() || "").trim();
        return preface.length > 0 && preface.length < 500 ? preface : "";
    } catch (error) {
        console.warn(`⚠️ Preface failed for "${projectTitle}":`, error.message);
        return "";
    }
}

module.exports = { generateChunkPreface };
