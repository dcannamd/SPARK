//update
const express = require('express');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
require('dotenv').config();

const { callBridgeBuddy, resetHistory } = require('./rag-tutor.js');

const STORE_PATH = path.join(__dirname, 'vector_store', 'memory_store.json');

const app = express();
const port = process.env.PORT || 3000;

let memoryStore = [];

const embeddings = new GoogleGenerativeAIEmbeddings({ 
    apiKey: process.env.GOOGLE_API_KEY, 
    model: "gemini-embedding-001",
    modelName: "gemini-embedding-001"
});

const ROLE_MAP = {
    "lxd":                   "Learning Experience Design",
    "lsa":                   "Learning Solutions Architecture",
    "creative-technologist": "Creative Technologist",
    "instructional-design":  "Instructional Design",
    "ai-integration":        "AI Integration",
    "general":               "General"
};

const INDUSTRY_MAP = {
    "aerospace":  "Aerospace",
    "saas":       "SaaS",
    "healthcare": "Healthcare",
    "finance":    "Finance",
    "retail":     "Retail",
    "government": "Government",
    "nonprofit":  "Nonprofit",
    "tech":       "Technology",
    "defense":    "Defense",
    "education":  "Education"
};

const CATEGORY_MAP = {
    "portfolio":  "Portfolio",
    "case-study": "Case Study",
    "process":    "Process",
    "tool":       "Tool",
    "leadership": "Leadership",
    "strategy":   "Strategy"
};

function preFilterStore(store, { roles = [], industries = [], categories = [] }) {
    const hasFilters = roles.length > 0 || industries.length > 0 || categories.length > 0;
    if (!hasFilters) return store;

    const filtered = store.filter(item => {
        const meta = item.metadata || {};
        const roleMatch     = roles.length === 0      || roles.some(r => (meta.Role      || []).includes(r));
        const industryMatch = industries.length === 0 || industries.some(i => (meta.Industry || []).includes(i));
        const categoryMatch = categories.length === 0 || categories.some(c => (meta.Category || []).includes(c));
        return roleMatch && industryMatch && categoryMatch;
    });

    if (filtered.length === 0) {
        console.warn("⚠️  Pre-filter returned 0 results. Falling back to full store.");
        return store;
    }

    console.log(`🎯 Pre-filter active: ${filtered.length}/${store.length} chunks match filters.`);
    return filtered;
}

function translateParam(rawParam, dictionary) {
    if (!rawParam) return [];
    return rawParam
        .split(",")
        .map(slug => dictionary[slug.trim().toLowerCase()])
        .filter(Boolean);
}

async function initializeVectorStore() {
    try {
        console.log("⏳ Loading Knowledge Base...");
        if (fs.existsSync(STORE_PATH)) {
            const rawData = fs.readFileSync(STORE_PATH, 'utf8');
            memoryStore = JSON.parse(rawData);
            console.log(`✅ Knowledge Base READY (${memoryStore.length} chunks loaded).`);
        } else {
            console.error('❌ ERROR: memory_store.json NOT FOUND.');
            console.error('   -> Run "node build-kb.js" to create it.');
        }
    } catch (error) {
        console.error('❌ FATAL: Failed to load brain file:', error.message);
    }
}

function dotProduct(vecA, vecB) {
    return vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA: findRelevantContext now returns both the text context string AND
// the mediaUrl from the single highest-scoring chunk.
// The top chunk is the most semantically relevant to the query, so its
// mediaUrl is the most appropriate asset to surface with the response.
// ─────────────────────────────────────────────────────────────────────────────
async function findRelevantContext(query, filteredStore, topK = 5) {
    const store = filteredStore || memoryStore;
    if (store.length === 0) return { context: "", mediaUrl: null };

    console.log("🧠 Thinking... (Searching Brain)");
    
    try {
        const queryVector = await embeddings.embedQuery(query);

        const scored = store.map(item => ({
            ...item,
            score: dotProduct(queryVector, item.embedding)
        }));

        const topResults = scored.sort((a, b) => b.score - a.score).slice(0, topK);

        console.log(`📚 Found ${topResults.length} relevant matches.`);

        // Pull mediaUrl from the top-ranked result only
        const mediaUrl = topResults[0]?.metadata?.mediaUrl || null;
        if (mediaUrl) console.log(`🎬 Media attached: ${mediaUrl}`);

        const context = topResults.map(res => `
            PROJECT: ${res.metadata.title}
            DETAILS: ${res.content || res.pageContent}
        `).join('\n\n---\n\n');

        return { context, mediaUrl };

    } catch (error) {
        console.error("❌ EMBEDDING ERROR:", error.message);
        return { context: "", mediaUrl: null };
    }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/ask-buddy', async (req, res) => {
    try {
        const userPrompt  = req.body.prompt;
        const rawRole     = req.body.role     || null;
        const rawIndustry = req.body.industry || null;
        const rawCategory = req.body.category || null;

        console.log(`👤 User: "${userPrompt}"`);
        console.log(`🔗 Active filters — role: ${rawRole || "none"} | industry: ${rawIndustry || "none"} | category: ${rawCategory || "none"}`);

        const activeRoles      = translateParam(rawRole,     ROLE_MAP);
        const activeIndustries = translateParam(rawIndustry, INDUSTRY_MAP);
        const activeCategories = translateParam(rawCategory, CATEGORY_MAP);

        const filteredStore = preFilterStore(memoryStore, {
            roles:      activeRoles,
            industries: activeIndustries,
            categories: activeCategories
        });

        // ── MEDIA: Destructure both context text and mediaUrl ────────────────
        const { context, mediaUrl } = await findRelevantContext(userPrompt, filteredStore);

        console.log("🤖 Asking Dana...");

        const activeRoleLabel = activeRoles.length > 0 ? activeRoles[0] : null;
        const danaResponse = await callBridgeBuddy(userPrompt, context, activeRoleLabel);
        
        console.log("✅ Response sent.");

        // ── MEDIA: Include mediaUrl in the JSON response to the frontend ─────
        // Frontend checks this field and renders image or video accordingly.
        res.json({ response: danaResponse, mediaUrl: mediaUrl || null });

    } catch (error) {
        console.error("❌ PROCESSING ERROR:", error);
        res.status(500).json({ response: "I'm having trouble accessing my memory right now.", mediaUrl: null });
    }
});

app.post('/reset-chat', (req, res) => {
    resetHistory(); 
    console.log("🧹 Memory Cleared.");
    res.json({ status: "Memory Cleared" });
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    initializeVectorStore();
});