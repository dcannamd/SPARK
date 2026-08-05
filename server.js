const express = require('express');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
require('dotenv').config();

const { callBridgeBuddy, generateCoverLetter, resetHistory } = require('./rag-tutor.js');
const { routeQuery } = require('./query-router.js');


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
    "general":               "General",
    "design":                "Design"
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

function isTimelineQuery(query) {
    return /timeline|chronolog|work history|career history|experience.*order|ordered.*experience|earliest|most recent|by date|by year/i.test(query.trim());
}

function detectRoleFromQuery(query) {
    if (/leadership|leader|manag|director|executive|strategy/i.test(query))
        return ["Leadership"];
    if (/\bai\b|rag|creative tech|dana.*tech|tech.*project|node\.js|prototyp.*project|show.*prototyp/i.test(query))
        return ["Creative Technology & UX"];
    if (/learning architect|lxd|instructional|curriculum|onboarding|training|education/i.test(query))
        return ["Learning Architecture & Design"];
    if (/\blighting design\b|product design showcase|dana.*design work|show.*design|design.*portfolio/i.test(query))
        return ["Design"];
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
    if (/show.*prototyp|prototyp.*project|dana.*prototyp|prototyp.*work/i.test(query))
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

async function findRelevantContext(query, filteredStore, topK = 5, sortByDate = false) {
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
    const byProject = {};
    const industrialDesignChunks = [];
    scored.sort((a, b) => b.score - a.score).forEach(item => {
        const title   = item.metadata?.title;
        const visible = item.metadata?.visible;
        if (!title || visible === "No") return;
        if (title === "Industrial Design & Product Development") {
            if (industrialDesignChunks.length < 8) industrialDesignChunks.push(item);
        } else if (!byProject[title]) {
            byProject[title] = item;
        }
    });
    topResults = [...industrialDesignChunks, ...Object.values(byProject)];

        } else {
            topResults = scored
                .filter(item => item.metadata?.visible !== "No")
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);
        }

        // ── Sort by date for list/timeline queries ────────────────────────────
        if (sortByDate) {
            topResults.sort((a, b) => {
                const dateA = a.metadata?.projectDate || "0000-00-00";
                const dateB = b.metadata?.projectDate || "0000-00-00";
                return dateB.localeCompare(dateA);
            });
            console.log(`📅 Results sorted chronologically`);
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
            DATE: ${res.metadata.projectDate || "Not specified"}
            ROLE: ${(res.metadata.Role || []).join(", ") || "Not specified"}
            BUSINESS IMPACT: ${res.metadata.impact || "Not specified"}
            CLIENT: ${res.metadata.client || "Not specified"}
            ${res.metadata.teamManagement  ? `TEAM MANAGEMENT: ${res.metadata.teamManagement}` : ""}
            ${res.metadata.crossFunctional ? `CROSS-FUNCTIONAL ALIGNMENT: ${res.metadata.crossFunctional}` : ""}
            ${res.metadata.orgLeadership   ? `ORGANIZATIONAL LEADERSHIP: ${res.metadata.orgLeadership}` : ""}
            DETAILS: ${res.content || res.pageContent}
        `).join('\n\n---\n\n');

        return { context, mediaUrl, topProjectTitle };

    } catch (error) {
        console.error("❌ EMBEDDING ERROR:", error.message);
        return { context: "", mediaUrl: null, topProjectTitle: null };
    }
}

// ── HIDDEN PAGE SEARCH ────────────────────────────────────────────────────────
async function findContextForHiddenPage(query, topK = 15) {
    console.log("🔒 Searching hidden pages...");
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

// ── HIDDEN PAGE DETECTION ─────────────────────────────────────────────────────
function isHiddenPageQuery(query) {
    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedQuery = normalize(query);

    const hiddenTitles = memoryStore
        .filter(item => item.metadata?.visible === "No")
        .map(item => item.metadata?.title)
        .filter(Boolean);

    return hiddenTitles.some(title =>
        normalizedQuery.includes(normalize(title))
    );
}

// ── PERSONAL QUERY DETECTION ──────────────────────────────────────────────────
function isPersonalQuery(query) {
    return /outside of work|personal|hobbies|interests|guitar|music|paddle|swim|ocean|personality|what.*like|who is dana|what kind of person|managing style|values|coaching style|work with|working style|outside work|free time|what does dana do|dana like to|dana enjoy|skills|strengths|abilities|what can dana|what does dana bring|what dana offers|school|university|degree|education|studied|graduate|thesis|eindhoven|alberta|emily carr|teach|taught|instructor|most effective|best at|excels|where.*dana|what.*environment|thrive|passionate|motivated|driven/i.test(query.trim());
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' https://img.youtube.com https://raw.githubusercontent.com data:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src https://www.youtube.com; object-src 'self';"
    );
    next();
});

app.get('/resume', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dana-cannam-resume.html'));
});

// ── COVER LETTER ENDPOINT ─────────────────────────────────────────────────────
app.post('/generate-cover-letter', async (req, res) => {
    try {
        const rawCompany = req.body.company || null;
        const rawRole    = req.body.role    || null;
        const jobPosting = loadJobPosting(rawCompany);

        console.log(`📝 Cover letter requested for: ${rawCompany || "general"} | role: ${rawRole || "none"}`);

        let relevantProjects = [];
        try {
            const activeRoles = translateParam(rawRole, ROLE_MAP);

            let filteredStore = activeRoles.length > 0
                ? preFilterStore(memoryStore, { roles: activeRoles })
                : memoryStore;

            filteredStore = filteredStore.filter(item => item.metadata?.visible !== "No");

            const searchQuery = jobPosting
                ? jobPosting.substring(0, 500)
                : (rawRole || "learning architecture design leadership");

            const queryVector = await embeddings.embedQuery(searchQuery);

            const scored = filteredStore.map(item => ({
                ...item,
                score: dotProduct(queryVector, item.embedding)
            }));

            const byProject = {};
            scored.sort((a, b) => b.score - a.score).forEach(item => {
                const title = item.metadata?.title;
                if (title && !byProject[title]) byProject[title] = item;
            });

            relevantProjects = Object.values(byProject)
                .slice(0, 5)
                .map(item => ({
                    title:           item.metadata.title,
                    impact:          item.metadata.impact          || "Not specified",
                    role:            (item.metadata.Role || []).join(", ") || "Not specified",
                    tech:            item.metadata.tech            || "Not specified",
                    teamManagement:  item.metadata.teamManagement  || null,
                    crossFunctional: item.metadata.crossFunctional || null,
                    orgLeadership:   item.metadata.orgLeadership   || null
                }));

            console.log(`📌 Cover letter projects: ${relevantProjects.map(p => p.title).join(", ")}`);

        } catch (ragError) {
            console.warn("⚠️ RAG retrieval failed for cover letter, using fallback:", ragError.message);
        }

        const coverLetter = await generateCoverLetter(jobPosting, rawCompany, relevantProjects);

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

        const hiddenPageQuery = isHiddenPageQuery(userPrompt) || isPersonalQuery(userPrompt);
        const listQuery       = isListQuery(userPrompt);
        const timelineQuery   = isTimelineQuery(userPrompt);

        if (timelineQuery) console.log(`📅 Timeline query detected`);

        let contextResult;

        if (hiddenPageQuery && !listQuery) {
            console.log(`🔒 Hidden/personal query detected — routing to hidden pages`);
            contextResult = await findContextForHiddenPage(userPrompt);
        } else {
            let filteredStore = preFilterStore(memoryStore, {
                roles:      activeRoles,
                industries: activeIndustries,
                categories: activeCategories
            });

            const isDirectProjectQuery = /^tell me about /i.test(userPrompt.trim());
            const isIndustrialDesignQuery = /industrial design|clamp|bowery|first light|all of a piece|pablo|another country/i.test(userPrompt.trim());


            if (activeRoles.length === 0 && !isDirectProjectQuery) {
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
            const topK = listQuery || timelineQuery ? 20 : isIndustrialDesignQuery ? 15 : roleQuery ? 10 : 5;

            const sortByDate = listQuery || timelineQuery;

            if (listQuery) console.log(`📋 List query detected — using topK: ${topK}`);
            if (roleQuery) console.log(`🏷️ Role/category query detected — using topK: ${topK}`);

            contextResult = await findRelevantContext(userPrompt, filteredStore, topK, sortByDate);
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
        if (confirmedProject) {
            const effectiveTitle = (topProjectTitle === confirmedProject) ? topProjectTitle : confirmedProject;
            if (!shownMediaTitles.has(effectiveTitle)) {
                let resolvedMediaUrl = (topProjectTitle === confirmedProject) ? mediaUrl : null;
                if (!resolvedMediaUrl) {
                    const projectChunk = memoryStore.find(
                        item => item.metadata?.title === confirmedProject && item.metadata?.mediaUrl
                    );
                    resolvedMediaUrl = projectChunk?.metadata?.mediaUrl || null;
                }
                if (resolvedMediaUrl) {
                    shownMediaTitles.add(effectiveTitle);
                    finalMediaUrl = resolvedMediaUrl;
                    console.log(`🎬 Media confirmed for: "${effectiveTitle}"`);
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
