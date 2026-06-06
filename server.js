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

// ── SESSION STATE ─────────────────────────────────────────────────────────────
// shownMediaTitles tracks which project media has already been shown
// so the thumbnail only appears once per project per session.
// activeProjectTitle is now a fallback only — frontend sends it on every request.
let shownMediaTitles = new Set();

const embeddings = new GoogleGenerativeAIEmbeddings({ 
    apiKey: process.env.GOOGLE_API_KEY, 
    model: "gemini-embedding-001",
    modelName: "gemini-embedding-001"
});

const ROLE_MAP = {
    "lxd":                   "Learning Architecture & Design",
    "lsa":                   "Learning Solutions Architecture",
    "creative-technologist": "Creative Technology & UX",
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

function isFollowUpQuery(query) {
    const followUpPatterns = [
        /^yes/i,
        /^tell me more/i,
        /^what about/i,
        /^more details/i,
        /^can you elaborate/i,
        /^expand on/i,
        /^go deeper/i,
        /^and the/i,
        /^what (was|were|is|are) the (tech|tool|stack|result|impact|approach|process|team)/i,
        /^how did (you|that)/i,
        /^why did/i,
        /^when did/i,
        /tech stack/i,
        /tools (you|used)/i,
        /leadership approach/i,
        /more about (that|this|it)/i,
        /specific(ally)?/i,
        /further details/i,
        /elaborate/i
    ];
    return followUpPatterns.some(p => p.test(query.trim()));
}

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

function filterByProject(store, projectTitle) {
    if (!projectTitle) return store;
    const filtered = store.filter(item => item.metadata?.title === projectTitle);
    if (filtered.length === 0) {
        console.warn(`⚠️  No chunks found for project: ${projectTitle}. Using full store.`);
        return store;
    }
    console.log(`📌 Project anchored: "${projectTitle}" (${filtered.length} chunks)`);
    return filtered;
}

function translateParam(rawParam, dictionary) {
    if (!rawParam) return [];
    return rawParam
        .split(",")
        .map(slug => dictionary[slug.trim().toLowerCase()])
        .filter(Boolean);
}

function loadJobPosting(companySlug) {
    if (!companySlug) return null;
    const filePath = path.join(__dirname, 'job_postings', `${companySlug.toLowerCase().trim()}.txt`);
    try {
        if (fs.existsSync(filePath)) {
            const text = fs.readFileSync(filePath, 'utf8');
            console.log(`📋 Job posting loaded: ${companySlug}`);
            return text;
        } else {
            console.warn(`⚠️  No job posting found for: ${companySlug}`);
            return null;
        }
    } catch (e) {
        console.error(`❌ Error loading job posting for ${companySlug}:`, e.message);
        return null;
    }
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

async function findRelevantContext(query, filteredStore, topK = 5) {
    const store = filteredStore || memoryStore;
    if (store.length === 0) return { context: "", mediaUrl: null, topProjectTitle: null };

    console.log("🧠 Thinking... (Searching Brain)");
    
    try {
        const queryVector = await embeddings.embedQuery(query);

        const scored = store.map(item => ({
            ...item,
            score: dotProduct(queryVector, item.embedding)
        }));

        const topResults = scored.sort((a, b) => b.score - a.score).slice(0, topK);

        console.log(`📚 Found ${topResults.length} relevant matches.`);

        const topProjectTitle = topResults[0]?.metadata?.title    || null;
        const rawMediaUrl     = topResults[0]?.metadata?.mediaUrl || null;

        // Only show media once per project per session
        const mediaUrl = (rawMediaUrl && topProjectTitle && !shownMediaTitles.has(topProjectTitle))
            ? rawMediaUrl
            : null;

        if (mediaUrl)        { shownMediaTitles.add(topProjectTitle); console.log(`🎬 Media attached: ${mediaUrl}`); }
        if (topProjectTitle)   console.log(`📌 Top project: "${topProjectTitle}"`);

        const context = topResults.map(res => `
            PROJECT: ${res.metadata.title}
            DETAILS: ${res.content || res.pageContent}
        `).join('\n\n---\n\n');

        return { context, mediaUrl, topProjectTitle };

    } catch (error) {
        console.error("❌ EMBEDDING ERROR:", error.message);
        return { context: "", mediaUrl: null, topProjectTitle: null };
    }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' https://img.youtube.com data:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src https://www.youtube.com;"
    );
    next();
});

app.post('/ask-buddy', async (req, res) => {
    try {
        const userPrompt          = req.body.prompt;
        const rawRole             = req.body.role             || null;
        const rawIndustry         = req.body.industry         || null;
        const rawCategory         = req.body.category         || null;
        const rawCompany          = req.body.company          || null;
        // ── Receive active project title from frontend ────────────────────────
        const frontendProjectTitle = req.body.activeProjectTitle || null;

        console.log(`👤 User: "${userPrompt}"`);
        console.log(`🔗 Active filters — role: ${rawRole || "none"} | industry: ${rawIndustry || "none"} | category: ${rawCategory || "none"} | company: ${rawCompany || "none"}`);
        if (frontendProjectTitle) console.log(`📌 Frontend active project: "${frontendProjectTitle}"`);

        const activeRoles      = translateParam(rawRole,     ROLE_MAP);
        const activeIndustries = translateParam(rawIndustry, INDUSTRY_MAP);
        const activeCategories = translateParam(rawCategory, CATEGORY_MAP);

        let filteredStore = preFilterStore(memoryStore, {
            roles:      activeRoles,
            industries: activeIndustries,
            categories: activeCategories
        });

        // ── Use frontend-provided project title for follow-up anchoring ───────
        const followUp = isFollowUpQuery(userPrompt);
        if (followUp && frontendProjectTitle) {
            console.log(`🔁 Follow-up detected — anchoring to: "${frontendProjectTitle}"`);
            filteredStore = filterByProject(filteredStore, frontendProjectTitle);
        }

        const { context, mediaUrl, topProjectTitle } = await findRelevantContext(userPrompt, filteredStore);

        const jobPosting = loadJobPosting(rawCompany);

        console.log("🤖 Asking Dana...");

        const activeRoleLabel = activeRoles.length > 0 ? activeRoles[0] : null;
        const danaResponse = await callBridgeBuddy(userPrompt, context, activeRoleLabel, jobPosting, rawCompany);
        
        console.log("✅ Response sent.");

        // ── Return topProjectTitle so frontend can update its tracking ─────────
        res.json({ 
            response:        danaResponse, 
            mediaUrl:        mediaUrl        || null,
            topProjectTitle: topProjectTitle || null
        });

    } catch (error) {
        console.error("❌ PROCESSING ERROR:", error);
        res.status(500).json({ response: "I'm having trouble accessing my memory right now.", mediaUrl: null, topProjectTitle: null });
    }
});

app.post('/reset-chat', (req, res) => {
    resetHistory();
    shownMediaTitles = new Set();
    console.log("🧹 Memory Cleared.");
    res.json({ status: "Memory Cleared" });
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    initializeVectorStore();
});
