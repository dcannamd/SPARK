// server.js
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

// ✅ FIX: Use the EXACT model your key supports
const embeddings = new GoogleGenerativeAIEmbeddings({ 
    apiKey: process.env.GOOGLE_API_KEY, 
    model: "gemini-embedding-001",     // <--- The Critical Fix
    modelName: "gemini-embedding-001"
});

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

async function findRelevantContext(query, topK = 4) {
    if (memoryStore.length === 0) return "";

    console.log("🧠 Thinking... (Searching Brain)");
    
    try {
        const queryVector = await embeddings.embedQuery(query);

        const scored = memoryStore.map(item => ({
            ...item,
            score: dotProduct(queryVector, item.embedding)
        }));

        const topResults = scored.sort((a, b) => b.score - a.score).slice(0, topK);

        console.log(`📚 Found ${topResults.length} relevant matches.`);
        
        return topResults.map(res => `
            PROJECT: ${res.metadata.title}
            DETAILS: ${res.content || res.pageContent}
        `).join('\n\n---\n\n');
    } catch (error) {
        console.error("❌ EMBEDDING ERROR:", error.message);
        return "";
    }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/ask-buddy', async (req, res) => {
    try {
        const userPrompt = req.body.prompt;
        console.log(`👤 User: "${userPrompt}"`);
        
        const context = await findRelevantContext(userPrompt);

        console.log("🤖 Asking Dana...");
        const danaResponse = await callBridgeBuddy(userPrompt, context);
        
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