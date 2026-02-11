const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function findChatModel() {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  
  console.log("📡 Scanning for available CHAT models...");
  
  try {
    // Fetch the raw list from Google
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}`
    );
    const data = await response.json();

    if (data.models) {
      // Filter for models that support "generateContent" (Chat)
      const chatModels = data.models.filter(m => m.supportedGenerationMethods.includes("generateContent"));
      
      console.log("\n✅ YOUR AVAILABLE CHAT MODELS:");
      chatModels.forEach(m => {
        console.log(`   - ${m.name.replace("models/", "")}`);
      });
      
      console.log("\n👉 USE ONE OF THE NAMES ABOVE in your rag-tutor.js file.");
    } else {
      console.log("❌ No models found. Your key might be invalid.");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

findChatModel();