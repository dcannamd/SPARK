// build-kb.js - Mapped to your specific Notion Headers
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const axios = require('axios');
const NotionSDK = require("@notionhq/client");

const API_KEY = process.env.GOOGLE_API_KEY; 
const NOTION_TOKEN = process.env.NOTION_TOKEN; 
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const STORE_PATH = path.join(__dirname, 'vector_store', 'memory_store.json');

const notion = new NotionSDK.Client({ auth: NOTION_TOKEN });

async function getNotionPageContent(pageId) {
    let content = [];
    async function scan(blockId) {
        try {
            const { results } = await notion.blocks.children.list({ block_id: blockId });
            for (const block of results) {
                const type = block.type;
                if (block[type]?.rich_text) {
                    content.push(block[type].rich_text.map(t => t.plain_text).join(''));
                } 
                if (block.has_children) await scan(block.id);
            }
        } catch (e) { /* ignore errors */ }
    }
    await scan(pageId);
    return content.join('\n');
}

async function main() {
    console.log('🚀 Mapping Notion Data to SPARK Digital Twin...');

    try {
        const response = await axios.post(
            `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${NOTION_TOKEN}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                }
            }
        );

        const pages = response.data.results;
        const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: API_KEY });
        const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 100 });
        const finalVectors = [];

        for (const page of pages) {
            const p = page.properties;
            
            // --- MAPPING YOUR COLUMNS ---
            const title = p["Project Name"]?.title?.[0]?.plain_text || "Untitled";
            const github = p["GitHub Link"]?.url || "";
            const video = p["Video/Demo Link"]?.url || "";
            const tech = p["Tech Stack"]?.multi_select?.map(s => s.name).join(', ') || "";
            
            // Logic: Use GitHub as primary source, otherwise Video, otherwise internal
            const source = github || video || "Notion Internal";
            
            // Logic: Mapping your "Status" to Classification (e.g., if Status is 'Private', label Internal)
            const statusValue = p["Status"]?.status?.name || p["Status"]?.select?.name || "Public";
            const classification = (statusValue === "Private" || statusValue === "Internal") ? "Internal" : "Public";
            
            // Determine if this is a Repo (for your Source Attribution rule)
            const type = github ? "Code Repository" : "Learning Architecture Document";

            console.log(`📖 Processing: ${title} [${classification}]`);

            const pageBody = await getNotionPageContent(page.id);
            const fullText = `[RESOURCE TITLE]: ${title}\n[SOURCE]: ${source}\n[CLASSIFICATION]: ${classification}\n[TYPE]: ${type}\n[TECH]: ${tech}\n[CONTENT]: ${pageBody}`;

            const chunks = await splitter.splitText(fullText);
            for (const chunk of chunks) {
                const vector = await embeddings.embedQuery(chunk);
                finalVectors.push({
                    content: chunk,
                    embedding: vector,
                    metadata: { title, source, classification, type }
                });
            }
        }

        fs.writeFileSync(STORE_PATH, JSON.stringify(finalVectors));
        console.log(`🎉 Success! Brain updated with ${finalVectors.length} chunks.`);

    } catch (e) {
        console.error("FATAL ERROR:", e.message);
    }
}

main();