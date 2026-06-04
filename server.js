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

// --- DICTIONARIES (URL params to exact Notion Tags) ---
const notionRoleDictionary = {
    "lxd": "Learning Architecture & Design",
    "learning-architect": "Learning Architecture & Design",
    "instructional-designer": "Learning Architecture & Design",
    "creative-technologist": "Creative Technology & UX",
    "ux-designer": "Creative Technology & UX",
    "product-lead": "Leadership",
    "founder": "Leadership",
    "startup-ops": "Leadership"
};

const notionCategoryDictionary = {
    "research": "Research",
    "compliance": "Compliance",
    "enablement": "Enablement",
    "onboarding": "Onboarding"
};

async function initializeVectorStore() {
    try {
        console.log("⏳ Loading Manual Knowledge Base...");
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

// --- CONTEXT FILTERING & MEDIA EXTRACTION ---
async function findRelevantContext(query, exactRole, exactCategory, topK = 4) {
    if (memoryStore.length === 0) return { contextString: "", mediaUrl: null };

    console.log(`🧠 Filtering Brain... Role: ${exactRole || 'ALL'}, Category: ${exactCategory || 'ALL'}`);
    
    // 1. Hard-filter the database based on the Custom URL
    const filteredStore = memoryStore.filter(item => {
        let roleMatch = true;
        let categoryMatch = true;

        if (exactRole && item.metadata.Role) {
            roleMatch = item.metadata.Role.includes(exactRole);
        }
        if (exactCategory && item.metadata.Category) {
            categoryMatch = item.metadata.Category.includes(exactCategory);
        }

        return roleMatch && categoryMatch;
    });

    console.log(`🔍 Narrowed down to ${filteredStore.length} relevant chunks.`);

    if (filteredStore.length === 0) return { contextString: "", mediaUrl: null };

    try {
        const queryVector = await embeddings.embedQuery(query);

        // 2. Only run vector math on the filtered chunks
        const scored = filteredStore.map(item => ({
            ...item,
            score: dotProduct(queryVector, item.embedding)
        }));

        const topResults = scored.sort((a, b) => b.score - a.score).slice(0, topK);
        
        // Extract mediaUrl from the highest scoring chunk
        const topMediaUrl = topResults[0]?.metadata?.mediaUrl || null;

        // 3. Format the text context for the AI
        const contextString = topResults.map(res => `
PROJECT: ${res.metadata.title || 'Untitled'}
ROLE: ${res.metadata.Role?.join(", ") || 'General'}
CATEGORY: ${res.metadata.Category?.join(", ") || 'N/A'}
DETAILS: ${res.content}
        `).join('\n\n---\n\n');

        return { contextString, mediaUrl: topMediaUrl };
    } catch (error) {
        console.error("❌ EMBEDDING ERROR:", error.message);
        return { contextString: "", mediaUrl: null };
    }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/ask-buddy', async (req, res) => {
    try {
        const { prompt, role, category } = req.body;
        console.log(`👤 User: "${prompt}" | Role: ${role || 'None'} | Category: ${category || 'None'}`);
        
        // Translate URL parameters into Notion exact tags
        const exactNotionRole = notionRoleDictionary[role] || null;
        const exactNotionCategory = notionCategoryDictionary[category] || null;

        const { contextString, mediaUrl } = await findRelevantContext(prompt, exactNotionRole, exactNotionCategory);
        
        // Dynamic focus based on the URL
        const roleDirectives = {
            "creative-technologist": "Highlight technical delivery, interactive system architecture, hardware integration, and UX.",
            "learning-architect": "Highlight instructional design frameworks, curriculum mapping, compliance, and enterprise enablement.",
            "product-lead": "Highlight product roadmapping, research, operations leadership, and scalable growth metrics.",
            "general": "Provide a balanced overview of technical delivery and strategic learning design."
        };

        const specificFocus = roleDirectives[role] || roleDirectives["general"];

        // The objective, 3rd-person persona prompt
        const systemInstruction = `
            You are the digital twin and portfolio assistant representing Dana, a Learning Solutions Architect and Creative Technologist.
            
            CRITICAL DIRECTIVES:
            1. TONE: Maintain a strictly objective, descriptive tone. NEVER use first-person pronouns ("I", "me", "my"). Describe all actions, startups, and technical delivery from an external, third-person perspective.
            2. CURRENT FOCUS: ${specificFocus}
            3. ALIGNMENT: Only utilize context chunks that align directly with the user's inquiry. 
            
            [RETRIEVED CONTEXT FROM NOTION]:
            ${contextString}
        `;

        console.log("🤖 Asking digital twin...");
        const danaResponse = await callBridgeBuddy(prompt, systemInstruction);
        
        console.log(`✅ Response sent. Media Attached: ${mediaUrl ? 'Yes' : 'No'}`);
        
        // Sending BOTH the text response and media link back to frontend.js
        res.json({ response: danaResponse, mediaUrl: mediaUrl });

    } catch (error) {
        console.error("❌ PROCESSING ERROR:", error);
        res.status(500).json({ response: "I'm having trouble accessing my memory right now." });
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