// rag-tutor.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ✅ FIX: Using a model explicitly listed in your allowed menu
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

let chatHistory = [];

async function callBridgeBuddy(userQuery, context) {
    try {
        const chat = model.startChat({
            history: chatHistory,
        });

        // ... rest of your code ...

        const personaPrompt = `
            You are Dana, a Learning Strategist and Solutions Architect. 
            Rules:
            1. Speak in the FIRST PERSON ("I", "my").
            2. Use the provided context to answer. 
            3. If info is missing, say you haven't uploaded those details yet.
            
            [CONTEXT FROM MY NOTION]:
            ${context}
            
            [USER QUESTION]:
            ${userQuery}
        `;
        
        const result = await chat.sendMessage(personaPrompt);
        const response = await result.response;
        const text = response.text();

        chatHistory.push({ role: "user", parts: [{ text: userQuery }] });
        chatHistory.push({ role: "model", parts: [{ text: text }] });

        return text;
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        if (error.message.includes("404")) {
            return "My memory core is having a naming conflict. Please try changing the model name in rag-tutor.js to 'gemini-1.5-flash'.";
        }
        return "I'm having a brief connection issue. Please try again.";
    }
}

module.exports = { callBridgeBuddy, resetHistory: () => { chatHistory = []; } };