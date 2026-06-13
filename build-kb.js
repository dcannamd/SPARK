const { Client } = require("@notionhq/client");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const embeddings = new GoogleGenerativeAIEmbeddings({ 
    apiKey: process.env.GOOGLE_API_KEY, 
    model: "gemini-embedding-001",
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
    console.log("🚀 Starting SPARK Knowledge Base Build...");

    try {
        const response = await notion.databases.query({ database_id: DATABASE_ID });
        console.log(`📦 Found ${response.results.length} pages in Notion database.\n`);

        const finalVectors = [];
        
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const tagInventory = { roles: new Set(), categories: new Set(), industries: new Set() };

        for (const page of response.results) {
            const props = page.properties;
            
            const title       = props["Project Name"]?.title[0]?.plain_text || "Untitled Project";
            const roleArr     = props["Role"]?.multi_select?.map(s => s.name)     || [];
            const catArr      = props["Category"]?.multi_select?.map(s => s.name) || [];
            const industryArr = props["Industry"]?.multi_select?.map(s => s.name) || [];
            const impact      = props["Business Impact"]?.rich_text?.map(t => t.plain_text).join("") || "N/A";
            const status      = props["Status"]?.status?.name || props["Status"]?.select?.name || "Public";
            const github      = props["GitHub Link"]?.url || "Notion Internal";
            const tech        = props["Tech Stack"]?.multi_select?.map(s => s.name).join(", ") || "N/A";
            const tools       = props["Tools"]?.multi_select?.map(s => s.name).join(", ") || "N/A";
            const mediaUrl    = props["Media URL"]?.url || null;
            const projectDate = props["Date"]?.date?.start || null;
            const client      = props["Client"]?.rich_text?.map(t => t.plain_text).join("") || null;

            // ── VISIBLE: Controls whether project appears in general search ───
            // "Yes" = shows in project list and general queries (default)
            // "No"  = hidden from list, only surfaced when directly asked
            const visible = props["Visible"]?.select?.name || "Yes";

            roleArr.forEach(r => tagInventory.roles.add(r));
            catArr.forEach(c => tagInventory.categories.add(c));
            industryArr.forEach(i => tagInventory.industries.add(i));

            console.log(`📖 Deep scanning: "${title}"`);
            console.log(`   Roles: [${roleArr.join(", ") || "none"}] | Categories: [${catArr.join(", ") || "none"}] | Industries: [${industryArr.join(", ") || "none"}]`);
            console.log(`   Date: ${projectDate || "none"} | Client: ${client || "none"} | Visible: ${visible}`);
            console.log(`   Tech: ${tech} | Tools: ${tools}`);
            console.log(`   Impact: ${impact !== "N/A" ? impact.substring(0, 80) + "..." : "none"}`);

            const deepContent = await getFullPageContent(page.id);

            const combinedText = `
DANA'S PROJECT: ${title}
CLIENT: ${client || "Not specified"}
ROLE: ${roleArr.join(", ") || "General"}
CATEGORY: ${catArr.join(", ") || "N/A"}
INDUSTRY: ${industryArr.join(", ") || "N/A"}
PROJECT DATE: ${projectDate || "Not specified"}
BUSINESS IMPACT: ${impact}
OFFICIAL TECH STACK FOR ${title.toUpperCase()}: ${tech}
OFFICIAL TOOLS FOR ${title.toUpperCase()}: ${tools}
STATUS: ${status}
SOURCE: ${github}

FULL DETAILS:
${deepContent}

SUMMARY OF CLIENT: ${client || "Not specified"}
SUMMARY OF ROLE: ${roleArr.join(", ") || "General"}
SUMMARY OF BUSINESS IMPACT: ${impact}
SUMMARY OF TECH STACK: ${tech}
SUMMARY OF TOOLS: ${tools}
            `.trim();

            const chunks = await splitter.splitText(combinedText);
            
            for (const chunk of chunks) {
                const vector = await embeddings.embedQuery(chunk);
                
                finalVectors.push({
                    content: chunk,
                    embedding: vector,
                    metadata: { 
                        title,
                        visible,
                        status, 
                        source:      github,
                        mediaUrl:    mediaUrl,
                        projectDate: projectDate,
                        client:      client,
                        impact:      impact !== "N/A" ? impact : null,
                        tech:        tech,
                        tools:       tools,
                        Role:        roleArr,
                        Category:    catArr,
                        Industry:    industryArr,
                        isDana:      true 
                    }
                });
            }

            console.log(`   ✅ ${chunks.length} chunks embedded.\n`);
        }

        if (!fs.existsSync(path.dirname(STORE_PATH))) {
            fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
        }
        
        fs.writeFileSync(STORE_PATH, JSON.stringify(finalVectors));

        console.log("─────────────────────────────────────────────");
        console.log(`✅ BUILD COMPLETE: ${finalVectors.length} searchable chunks written.`);
        console.log(`📍 Output: ${STORE_PATH}\n`);
        console.log("🏷️  TAG INVENTORY (verify these match your URL dictionary in server.js):");
        console.log(`   Roles:      ${[...tagInventory.roles].join(" | ") || "none found"}`);
        console.log(`   Categories: ${[...tagInventory.categories].join(" | ") || "none found"}`);
        console.log(`   Industries: ${[...tagInventory.industries].join(" | ") || "none found"}`);
        console.log("─────────────────────────────────────────────");

    } catch (error) {
        console.error("❌ FATAL ERROR DURING BUILD:", error);
    }
}

runBuild();
