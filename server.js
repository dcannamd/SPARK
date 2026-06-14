const express = require('express');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
require('dotenv').config();

const { callBridgeBuddy, generateCoverLetter, resetHistory } = require('./rag-tutor.js');

const STORE_PATH = path.join(__dirname, 'vector_store', 'memory_store.json');

const app = express();
const port = process.env.PORT || 3000;

let memoryStore = [];
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
    "leadership":            "Leadership",
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
    "portfolio":    "Portfolio",
    "case-study":   "Case Study",
    "process":      "Process",
    "tool":         "Tool",
    "leadership":   "Leadership",
    "strategy":     "Strategy",
    "architecture": "Architecture"
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

function isListQuery(query) {
    return /list|all projects|all of your projects|your projects|provide a list|view project/i.test(query.trim());
}

function detectRoleFromQuery(query) {
    if (/leadership|leader|manag|director|executive|strategy/i.test(query))
        return ["Leadership"];
    if (/\bai\b|rag|technical|technology|creative tech|prototype|prototyping|node|code/i.test(query))
        return ["Creative Technology & UX"];
    if (/learning architect|lxd|instructional|curriculum|onboarding|training|education/i.test(query))
        return ["Learning Architecture & Design"];
    return [];
}

function detectCategoryFromQuery(query) {
    if (/compliance|privacy|security|breach|regulation/i.test(query))
        return ["Compliance"];
    if (/onboard|new hire|orientation|new employee/i.test(query))
        return ["Onboarding"];
    if (/research|discovery|analysis|assess/i.test(query))
        return ["Research"];
    if (/architect|system design|infrastructure|framework/i.test(query))
        return ["Architecture"];
    if (/enablement|training program|champion|certification/i.test(query))
        return ["Enablement"];
    if (/prototype|prototyping/i.test(query))
        return ["Prototyping"];
    return [];
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

        let topResults;
        if (topK > 10) {
            // ── List queries: one best chunk per visible project ──────────────
            const byProject = {};
            scored.sort((a, b) => b.score - a.score).forEach(item => {
                const title   = item.metadata?.title;
                const visible = item.metadata?.visible;
                if (title && !byProject[title] && visible !== "No") {
                    byProject[title] = item;
                }
            });
            topResults = Object.values(byProject);
        } else {
            // ── Regular queries: exclude hidden pages ─────────────────────────
            topResults = scored
                .filter(item => item.metadata?.visible !== "No")
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);
        }

        console.log(`📚 Found ${topResults.length} relevant matches.`);

        const topProjectTitle = topResults[0]?.metadata?.title    || null;
        const rawMediaUrl     = topResults[0]?.metadata?.mediaUrl || null;

        const mediaUrl = (rawMediaUrl && topProjectTitle && !shownMediaTitles.has(topProjectTitle))
            ? rawMediaUrl
            : null;

        if (topProjectTitle) console.log(`📌 Top vector result: "${topProjectTitle}"`);

        const context = topResults.map(res => `
            PROJECT: ${res.metadata.title}
            ROLE: ${(res.metadata.Role || []).join(", ") || "Not specified"}
            BUSINESS IMPACT: ${res.metadata.impact || "Not specified"}
            CLIENT: ${res.metadata.client || "Not specified"}
            DATE: ${res.metadata.projectDate || "Not specified"}
            DETAILS: ${res.content || res.pageContent}
        `).join('\n\n---\n\n');

        return { context, mediaUrl, topProjectTitle };

    } catch (error) {
        console.error("❌ EMBEDDING ERROR:", error.message);
        return { context: "", mediaUrl: null, topProjectTitle: null };
    }
}

// ── VISIBLE=NO OVERRIDE: used when a hidden page is directly requested ────────
async function findContextForHiddenPage(query, topK = 15) {
    console.log("🧠 Searching hidden pages...");
    try {
        const queryVector = await embeddings.embedQuery(query);
        const scored = memoryStore
            .filter(item => item.metadata?.visible === "No")
            .map(item => ({ ...item, score: dotProduct(queryVector, item.embedding) }));

        const topResults = scored.sort((a, b) => b.score - a.score).slice(0, topK);
        console.log(`📚 Found ${topResults.length} hidden page matches.`);

        const topProjectTitle = topResults[0]?.metadata?.title || null;
        if (topProjectTitle) console.log(`📌 Hidden page: "${topProjectTitle}"`);

        const context = topResults.map(res => `
            PROJECT: ${res.metadata.title}
            ROLE: ${(res.metadata.Role || []).join(", ") || "Not specified"}
            BUSINESS IMPACT: ${res.metadata.impact || "Not specified"}
            CLIENT: ${res.metadata.client || "Not specified"}
            DATE: ${res.metadata.projectDate || "Not specified"}
            DETAILS: ${res.content || res.pageContent}
        `).join('\n\n---\n\n');

        return { context, mediaUrl: null, topProjectTitle };
    } catch (error) {
        console.error("❌ HIDDEN PAGE SEARCH ERROR:", error.message);
        return { context: "", mediaUrl: null, topProjectTitle: null };
    }
}

// ── DETECT IF QUERY IS ABOUT A HIDDEN PAGE ────────────────────────────────────
function isHiddenPageQuery(query) {
    const normalize = (str) => str.toLowerCase().replace(/['']/g, "");
    const normalizedQuery = normalize(query);

    const hiddenTitles = memoryStore
        .filter(item => item.metadata?.visible === "No")
        .map(item => item.metadata?.title)
        .filter(Boolean);

    return hiddenTitles.some(title => 
        normalizedQuery.includes(normalize(title))
    );
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' https://img.youtube.com data:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src https://www.youtube.com; object-src 'self';"
    );
    next();
});

app.get('/resume', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dana-cannam-resume.html'));
});

app.post('/generate-cover-letter', async (req, res) => {
    try {
        const rawCompany = req.body.company || null;
        const jobPosting = loadJobPosting(rawCompany);
        console.log(`📝 Cover letter requested for: ${rawCompany || "general"}`);
        const coverLetter = await generateCoverLetter(jobPosting, rawCompany);
        if (!coverLetter) {
            return res.status(500).json({ error: "Failed to generate cover letter." });
        }
        console.log("✅ Cover letter generated.");
        res.json({ coverLetter });
    } catch (error) {
        console.error("❌ COVER LETTER ERROR:", error);
        res.status(500).json({ error: "Failed to generate cover letter." });
    }
});

app.post('/ask-buddy', async (req, res) => {
    try {
        const userPrompt           = req.body.prompt;
        const rawRole              = req.body.role             || null;
        const rawIndustry          = req.body.industry         || null;
        const rawCategory          = req.body.category         || null;
        const rawCompany           = req.body.company          || null;
        const frontendProjectTitle = req.body.activeProjectTitle || null;

        console.log(`👤 User: "${userPrompt}"`);
        console.log(`🔗 Active filters — role: ${rawRole || "none"} | industry: ${rawIndustry || "none"} | category: ${rawCategory || "none"} | company: ${rawCompany || "none"}`);
        if (frontendProjectTitle) console.log(`📌 Frontend active project: "${frontendProjectTitle}"`);

        const activeRoles      = translateParam(rawRole,     ROLE_MAP);
        const activeIndustries = translateParam(rawIndustry, INDUSTRY_MAP);
        const activeCategories = translateParam(rawCategory, CATEGORY_MAP);

        // ── Check if query is about a hidden page ─────────────────────────────
        const hiddenPageQuery = isHiddenPageQuery(userPrompt);
        const listQuery = isListQuery(userPrompt);

        let contextResult;

        if (hiddenPageQuery) {
            // ── Route directly to hidden page search ──────────────────────────
            console.log(`🔒 Hidden page query detected`);
            contextResult = await findContextForHiddenPage(userPrompt);
        } else {
            // ── Normal search flow ────────────────────────────────────────────
            let filteredStore = preFilterStore(memoryStore, {
                roles:      activeRoles,
                industries: activeIndustries,
                categories: activeCategories
            });

            if (activeRoles.length === 0) {
                const detectedRoles      = detectRoleFromQuery(userPrompt);
                const detectedCategories = detectCategoryFromQuery(userPrompt);

                if (detectedRoles.length > 0 || detectedCategories.length > 0) {
                    console.log(`🏷️ Detected from query — roles: [${detectedRoles.join(", ") || "none"}] | categories: [${detectedCategories.join(", ") || "none"}]`);
                    filteredStore = preFilterStore(memoryStore, {
                        roles:      detectedRoles,
                        categories: detectedCategories
                    });
                }
            }

            const followUp = isFollowUpQuery(userPrompt);
            if (followUp && frontendProjectTitle && frontendProjectTitle !== 'NONE' && !listQuery) {
                console.log(`🔁 Follow-up detected — anchoring to: "${frontendProjectTitle}"`);
                filteredStore = filterByProject(filteredStore, frontendProjectTitle);
            }

            const roleQuery = (detectRoleFromQuery(userPrompt).length > 0 || detectCategoryFromQuery(userPrompt).length > 0) && activeRoles.length === 0;
            const topK = listQuery ? 20 : roleQuery ? 10 : 5;

            if (listQuery) console.log(`📋 List query detected — using topK: ${topK}`);
            if (roleQuery) console.log(`🏷️ Role/category query detected — using topK: ${topK}`);

            contextResult = await findRelevantContext(userPrompt, filteredStore, topK);
        }

        const { context, mediaUrl, topProjectTitle } = contextResult;
        const jobPosting = loadJobPosting(rawCompany);

        console.log("🤖 Asking Dana...");

        const activeRoleLabel = activeRoles.length > 0 ? activeRoles[0] : null;

        const buddyResult = await callBridgeBuddy(
            userPrompt, context, activeRoleLabel, jobPosting, rawCompany
        );

        const danaResponse    = buddyResult?.text            || "I'm having a brief connection issue. Please try again.";
        const detectedProject = buddyResult?.detectedProject || null;

        const confirmedProject = (detectedProject && detectedProject !== 'NONE')
            ? detectedProject
            : null;

        let finalMediaUrl = null;
        if (confirmedProject && mediaUrl) {
            if (topProjectTitle === confirmedProject) {
                if (!shownMediaTitles.has(confirmedProject)) {
                    shownMediaTitles.add(confirmedProject);
                    finalMediaUrl = mediaUrl;
                    console.log(`🎬 Media confirmed for: "${confirmedProject}"`);
                }
            }
        }

        console.log(`✅ Response sent. Detected project: "${confirmedProject || "multiple/none"}"`);

        res.json({ 
            response:        danaResponse, 
            mediaUrl:        finalMediaUrl || null,
            topProjectTitle: confirmedProject || null
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
