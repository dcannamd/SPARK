const { Client } = require("@notionhq/client");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ✅ FIX: Use the EXACT model your key supports
const embeddings = new GoogleGenerativeAIEmbeddings({ 
    apiKey: process.env.GOOGLE_API_KEY, 
    model: "gemini-embedding-001",     // <--- The Critical Fix
    modelName: "gemini-embedding-001"
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const STORE_PATH = path.join(__dirname, 'vector_store', 'memory_store.json');

async function getFullPageContent(blockId) {
    let text = "";
    try {
        const { results } = await notion.blocks.children.list({ block_id: blockId });
        for (const block of results) {
            const type = block.type;
            const richText = block[type]?.rich_text;
            if (richText) {
                const content = richText.map(t => t.plain_text).join("");
                if (content) text += content + "\n";
            }
            if (block.has_children) {
                text += await getFullPageContent(block.id);
            }
        }
    } catch (e) {
        console.error(`⚠️ Error scanning block ${blockId}:`, e.message);
    }
    return text;
}

async function runBuild() {
    console.log("🚀 Starting Dana's Digital Twin Brain Build...");

    try {
        const response = await notion.databases.query({ database_id: DATABASE_ID });
        const finalVectors = [];
        
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        for (const page of response.results) {
            const props = page.properties;
            const title = props["Project Name"]?.title[0]?.plain_text || "Untitled Project";
            const role = props["Role"]?.select?.name || "Learning Strategist";
            const impact = props["Business Impact"]?.rich_text?.map(t => t.plain_text).join("") || "N/A";
            const status = props["Status"]?.status?.name || props["Status"]?.select?.name || "Public";
            const github = props["GitHub Link"]?.url || "Notion Internal";
            const tech = props["Tech Stack"]?.multi_select?.map(s => s.name).join(", ") || "N/A";

            console.log(`📖 Deep scanning: ${title}...`);
            const deepContent = await getFullPageContent(page.id);

            const combinedText = `
                DANA'S PROJECT: ${title}
                ROLE: ${role}
                BUSINESS IMPACT: ${impact}
                TECH STACK: ${tech}
                STATUS: ${status}
                SOURCE: ${github}
                FULL DETAILS: ${deepContent}
            `;

            const chunks = await splitter.splitText(combinedText);
            
            for (const chunk of chunks) {
                console.log(` ✨ Generating embedding for chunk of: ${title}`);
                const vector = await embeddings.embedQuery(chunk);
                
                finalVectors.push({
                    content: chunk,
                    embedding: vector,
                    metadata: { title, status, source: github, role, isDana: true }
                });
            }
        }

        if (!fs.existsSync(path.dirname(STORE_PATH))) {
            fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
        }
        
        fs.writeFileSync(STORE_PATH, JSON.stringify(finalVectors));
        console.log(`\n✅ SUCCESS: Brain built with ${finalVectors.length} searchable units.`);
        console.log(`📍 Location: ${STORE_PATH}`);

    } catch (error) {
        console.error("❌ FATAL ERROR DURING BUILD:", error);
    }
}

runBuild();