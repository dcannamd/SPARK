const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

let chatHistory = [];

async function callBridgeBuddy(userQuery, systemInstruction) {
    try {
        const chat = model.startChat({
            history: chatHistory,
        });

        const fullPrompt = `
            ${systemInstruction}
            
            [USER QUESTION]:
            ${userQuery}
        `;
        
        const result = await chat.sendMessage(fullPrompt);
        const response = await result.response;
        const text = response.text();

        chatHistory.push({ role: "user", parts: [{ text: userQuery }] });
        chatHistory.push({ role: "model", parts: [{ text: text }] });

        return text;
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        if (error.message.includes("404")) {
            return "My memory core is having a naming conflict. Please check the model name.";
        }
        return "I'm having a brief connection issue. Please try again.";
    }
}

module.exports = { callBridgeBuddy, resetHistory: () => { chatHistory = []; } };

