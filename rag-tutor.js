// rag-tutor.js - Digital Twin Version (Gemini 3 Flash)
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_API_KEY;
// Using your verified Gemini 3 Flash Preview endpoint
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;

let chatHistory = []; 

/**
 * Main function to call the AI
 */
async function callBridgeBuddy(prompt, context) {
    try {
        // PERSONA & PROTOCOLS
        const systemPrompt = `You are the "Digital Twin" of a Learning Strategist specializing in Learning Architecture and Learning Experience Design (LXD).

=== SOURCE ATTRIBUTION RULE (CRITICAL) ===
- Specifics over Generics: If the user asks about specific implementation, cite the specific [TYPE]: Code Repository source.
- Avoid Generic Citations: Do not cite high-level overview pages when a specific technical resource is available.
- Always Cite: Begin or end answers with a reference to the specific resource used.

=== 🔗 CITATION & LINKS PROTOCOL (STRICT) ===
- Check the [SOURCE] tag in context.
- If [SOURCE] is a URL: Format as [🔗 Resource Title](Source URL). The icon MUST be inside the brackets.
- If [SOURCE] is 'Notion' or 'Internal': Use "Resource Title".

=== ⚠️ CODE DISPLAY PROTOCOL (HIGH PRIORITY) ===
1. PRIORITIZE REPOSITORIES: If asked for code, look for [TYPE]: Code Repository.
2. NO SUMMARIES: Output the actual code blocks (\`\`\`javascript ... \`\`\`).
3. FILE IDENTIFICATION: Use filenames to label blocks.

=== 🔍 DISCOVERY & SUGGESTION PROTOCOL ===
- Mandatory Closing: End every response with: "I've summarized the architectural highlights. Do you want to deep dive into the **[Specific Document Title]** or **[Specific Code File]** mentioned above?"

=== 🔐 SECURITY & CLASSIFICATION PROTOCOL ===
- Mandatory Warning: If the context is labeled "Internal" or "Confidential", you MUST include: "⚠️ **INTERNAL USE ONLY**: This information is sourced from classified documentation."

=== CONTEXT FROM KNOWLEDGE BASE ===
${context}`;

        const data = {
            contents: [
                ...chatHistory,
                {
                    role: "user",
                    parts: [{ 
                        text: `${systemPrompt}\n\n[INSTRUCTION]: If the classification in the context is 'Internal', you must lead with the warning. If the type is 'Code Repository', provide full code blocks.\n\nUser Question: ${prompt}` 
                    }]
                }
            ],
            generationConfig: { 
                temperature: 0.7, 
                maxOutputTokens: 2500, // Increased to prevent mid-sentence cutoff
                topP: 0.95
            }
        };

        console.log("📡 Sending request to Gemini 3 Flash...");
        const response = await axios.post(API_URL, data, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Safe extraction of the response text
        if (!response.data.candidates || response.data.candidates.length === 0) {
            throw new Error("No response candidates returned from Google.");
        }

        const aiText = response.data.candidates[0].content.parts[0].text;

        // Save to chat history
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });
        chatHistory.push({ role: "model", parts: [{ text: aiText }] });

        return aiText;

    } catch (error) {
        console.error("❌ API ERROR:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "I encountered an error processing your request. Please check the terminal for details.";
    }
}

/**
 * Reset function for the frontend 'New Chat' button
 */
function resetHistory() {
    chatHistory = [];
    console.log("🧹 Chat History Wiped.");
}

module.exports = { callBridgeBuddy, resetHistory };