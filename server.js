// server.js - Manual Knowledge Base Mode
const express = require('express');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
// FIX: Import the correct function names
const { getDanaResponse, resetHistory } = require('./rag-tutor.js');
require('dotenv').config();

// --- CONFIG ---
const API_KEY = process.env.GOOGLE_API_KEY;
const STORE_PATH = path.join(__dirname, 'vector_store', 'memory_store.json');
// -------------

const app = express();
const port = process.env.PORT || 3000; // FIX: Use Render's port or 3000

let memoryStore = []; 
const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: API_KEY });

// 1. Load the manual brain file
async function initializeVectorStore() {
    try {
        console.log("⏳ Loading Manual Knowledge Base...");
        if (fs.existsSync(STORE_PATH)) {
            const rawData = fs.readFileSync(STORE_PATH, 'utf8');
            memoryStore = JSON.parse(rawData);
            console.log(`✅ Knowledge Base READY (${memoryStore.length} chunks loaded).`);
        } else {
            console.error('❌ ERROR: memory_store.json NOT FOUND. Run "node build-kb.js" first.');
        }
    } catch (error) {
        console.error('❌ FATAL: Failed to load brain file:', error.message);
    }
}

// 2. Manual Similarity Search
function dotProduct(vecA, vecB) {
    return vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
}

async function findRelevantContext(query, topK = 4) {
    if (memoryStore.length === 0) return "";

    console.log("🧠 Thinking... (Searching Brain)");
    const queryVector = await embeddings.embedQuery(query);

    const scored = memoryStore.map(item => ({
        ...item,
        score: dotProduct(queryVector, item.embedding)
    }));

    const topResults = scored.sort((a, b) => b.score - a.score).slice(0, topK);

    console.log(`📚 Found ${topResults.length} relevant matches.`);
    
    return topResults.map(res => `
        PROJECT: ${res.metadata.title}
        DETAILS: ${res.content}
    `).join('\n\n---\n\n');
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 3. The Chat Endpoint
app.post('/ask-buddy', async (req, res) => {
    try {
        const userPrompt = req.body.prompt;
        console.log(`👤 User: "${userPrompt}"`);
        
        const context = await findRelevantContext(userPrompt);

        console.log("🤖 Asking Dana...");
        // FIX: Call the correct function
        const danaResponse = await getDanaResponse(userPrompt, context);
        
        console.log("✅ Response sent.");
        res.json({ response: danaResponse });

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