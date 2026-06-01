const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ✅ System instructions are declared here to keep chat history clean
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: `
        You are the advanced digital twin and learning architecture assistant representing Dana, a Learning Strategist and Solutions Architect specializing in Learning Solutions Architecture and Learning Experience Design.

        CRITICAL CONTEXTUAL CONSTRAINTS:
        1. Your knowledge base is pulled dynamically from a categorized Notion database. Each chunk of information contains explicit metadata headers (CATEGORY, TARGET AUDIENCE/TIER, INDUSTRY VERTICAL, and SEQUENCE ORDER).
        2. STRICT BOUNDARIES: Only answer using context blocks where the Category, Industry, and Tier match the logical flow of the user's query. Never blend instructional strategies or protocols across completely different industry verticals or tiers within a single response step.
        3. CHRONOLOGY: If multiple pieces of context are provided, organize your explanation sequentially based on the SEQUENCE ORDER metadata tags.
        4. GAP HANDLING: If the retrieved chunks contain fragmented or incomplete details regarding a topic, do not fill in gaps or hallucinate features. Explicitly state: "I haven't uploaded those specific execution details to my knowledge base yet," and ask a targeted clarifying question based on what information is missing.
        5. TONE: Maintain a highly professional, strategically grounded, and objective tone. Be clear, concise, and focused on learning architecture best practices.
    `
});

let chatHistory = [];

async function callBridgeBuddy(userQuery, context) {
    try {
        // Start the chat session preloaded with cleaner history
        const chat = model.startChat({
            history: chatHistory,
        });

        // Formulate the runtime block separating fresh context from the user's exact query
        const messagePayload = `
[DYNAMIC RETRIEVED NOTION CONTEXT]:
${context || "No explicit context retrieved for this query."}

[CURRENT USER INQUIRY]:
${userQuery}
        `;
        
        const result = await chat.sendMessage(messagePayload);
        const response = await result.response;
        const text = response.text();

        // Keep history pristine: log the user query and the resulting text response
        // This avoids bloating history with raw structural context dumps
        chatHistory.push({ role: "user", parts: [{ text: userQuery }] });
        chatHistory.push({ role: "model", parts: [{ text: text }] });

        return text;
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        if (error.message.includes("404")) {
            return "My memory core is experiencing a configuration conflict. Please verify the model configuration in rag-tutor.js.";
        }
        return "I'm having a brief connection issue. Please try again.";
    }
}

module.exports = { 
    callBridgeBuddy, 
    resetHistory: () => { chatHistory = []; } 
};
