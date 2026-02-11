const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function checkMyModels() {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  
  console.log("📡 Contacting Google API...");
  
  try {
    // This specific command asks Google: "What models can I use?"
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.apiKey; // Just triggering a verified instance
    
    // We have to use the raw API listing because the SDK hides this sometimes
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}`
    );
    const data = await response.json();

    if (data.models) {
      console.log("\n✅ AVAILABLE MODELS FOR YOUR KEY:");
      const embeddingModels = data.models.filter(m => m.name.includes("embedding"));
      
      embeddingModels.forEach(m => {
        console.log(`   - ${m.name}`); // Will print 'models/text-embedding-004' if you have it
      });

      const hasNew = embeddingModels.some(m => m.name.includes("text-embedding-004"));
      const hasOld = embeddingModels.some(m => m.name.includes("embedding-001"));

      console.log("\n🔍 DIAGNOSIS:");
      if (hasNew) {
        console.log("🎉 You HAVE access to text-embedding-004. The previous error was likely a library version issue.");
      } else if (hasOld) {
        console.log("⚠️ You ONLY have access to embedding-001. You MUST use the older model code.");
      } else {
        console.log("❌ You have NO embedding models available. Check your API Key permissions.");
      }
    } else {
      console.log("❌ Error listing models:", data);
    }

  } catch (error) {
    console.error("❌ CONNECTION ERROR:", error.message);
  }
}

checkMyModels();