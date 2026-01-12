// build-kb.js - "Bulletproof" Edition (Recursion + Throttling)

console.log("⚡️ SYSTEM CHECK: Script is reading...");
// ... rest of your imports

const { Client } = require("@notionhq/client");
const { HNSWLib } = require("@langchain/community/vectorstores/hnswlib");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { Document } = require("langchain/document");
const axios = require('axios');
const { YoutubeTranscript } = require('youtube-transcript');
const path = require('path');

// --- CONFIGURATION ---
const VECTOR_STORE_PATH = path.join(__dirname, 'vector_store');

// 🔴 PASTE YOUR API KEYS HERE
const API_KEY = "YOUR_GOOGLE_API"; 
const NOTION_TOKEN = "YOUR_NOTION_INTEGRATION_TOKEN"; 
const NOTION_DATABASE_ID = "YOUR_NOTION_DATABASE_ID";
const GITHUB_TOKEN = ""; 
// --------------------

// Initialize Notion with a higher timeout (120s) to prevent crashes on large pages
const notion = new Client({ 
    auth: NOTION_TOKEN,
    timeoutMs: 120000 
});

// 🐢 HELPER: Sleep function to prevent API Timeouts
// This is the critical piece missing from your previous file!
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 1. HELPER: Clean YouTube URLs ---
function getCleanYoutubeUrl(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) 
    ? `https://www.youtube.com/watch?v=${match[2]}` 
    : null;
}

// --- 2. INTERNAL NOTION READER (RECURSIVE & THROTTLED) ---
async function getNotionPageContent(pageId) {
  let content = [];

  // Recursive function to dive into Toggles, Columns, etc.
  async function scanBlocks(blockId, depth = 0) {
    let cursor;
    try {
      while (true) {
        // 🛑 THROTTLE: Wait 500ms between requests to prevent "Request Timed Out"
        await sleep(500);

        const { results, next_cursor } = await notion.blocks.children.list({
          block_id: blockId,
          start_cursor: cursor,
        });

        for (const block of results) {
          const type = block.type;
          const indent = "  ".repeat(depth); 

          // A. Extract Text
          if (block[type]?.rich_text) {
            const text = block[type].rich_text.map(t => t.plain_text).join('');
            if (type.startsWith('heading')) content.push(`\n${indent}### ${text}\n`);
            else if (type.includes('list')) content.push(`${indent}* ${text}`);
            else if (type === 'callout') content.push(`\n${indent}> 💡 ${text}\n`);
            else content.push(`${indent}${text}`);
          } 
          // B. Extract Code
          else if (type === 'code') {
            const code = block.code.rich_text.map(t => t.plain_text).join('');
            const lang = block.code.language || 'text';
            const caption = block.code.caption?.map(t => t.plain_text).join('') || "";
            content.push(`\n${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\`\n`);
          }

          // C. RECURSION: Deep Dive into children (Toggles/Columns)
          if (block.has_children) {
            await scanBlocks(block.id, depth + 1);
          }
        }

        if (!next_cursor) break;
        cursor = next_cursor;
      }
    } catch (e) {
      console.warn(`      ⚠️ Block Read Warning (Skipped partial content): ${e.message}`);
    }
  }

  await scanBlocks(pageId);
  return content.join('\n');
}

// --- 3. EXTERNAL FETCHER ---
async function fetchExternalContent(url, sourceLocation) {
  if (!url) return "";

  try {
    if (sourceLocation === "GitHub" && url.includes("github.com")) {
      const rawUrl = url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
      console.log(`   🐙 Fetching GitHub: ${rawUrl}`);
      const headers = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
      const { data } = await axios.get(rawUrl, { headers });
      return `\n*** GITHUB CONTENT ***\n${typeof data === 'object' ? JSON.stringify(data) : data}\n`;
    } 
    else if (sourceLocation === "YouTube" || url.includes("youtu")) {
      const cleanUrl = getCleanYoutubeUrl(url);
      if (!cleanUrl) return "";
      console.log(`   📺 Fetching Transcript: ${cleanUrl}`);
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(cleanUrl);
        const text = transcript.map(t => t.text).join(' ');
        if (!text || text.length < 50) return "";
        return `\n*** VIDEO TRANSCRIPT ***\n${text}\n`;
      } catch (e) { return ""; }
    }
  } catch (e) {
    console.warn(`   ⚠️ External Fetch Error: ${e.message}`);
    return "";
  }
  return "";
}

// --- 4. MAIN BUILD PIPELINE ---
async function main() {
  console.log('🚀 Starting Command Center Build (Bulletproof Mode)...');
  console.log(`🔍 Querying Notion DB: ${NOTION_DATABASE_ID}...`);

  // --- PAGINATION LOOP (Fixes 100-item limit) ---
  let pages = [];
  let cursor = undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        start_cursor: cursor,
        filter: {
          property: "Status",
          select: { equals: "Current" }
        }
      });
      pages.push(...response.results);
      hasMore = response.has_more;
      cursor = response.next_cursor;
      process.stdout.write('.'); 
    }
  } catch (e) {
    console.error("\n❌ Notion Query Failed:", e.message);
    return;
  }

  console.log(`\n✅ Found ${pages.length} active resources.`);
  const docs = [];

  for (const page of pages) {
    const p = page.properties;
    const title = p["Name"]?.title[0]?.plain_text || "Untitled";
    const type = p["Type"]?.select?.name || "Reference";
    const sourceLoc = p["Source Location"]?.select?.name || "Internal";
    const url = p["Link to Resource"]?.url;
    const tech = p["Technology"]?.multi_select?.map(x => x.name).join(", ") || "General";
    const domain = p["Functional Domain"]?.multi_select?.map(x => x.name).join(", ") || "General";

    
 // (Assumes it is a 'Select' property in Notion. If it's a 'Status' property, change .select to .status)
    const classification = p["Resource Classification"]?.select?.name || "Unclassified";

    console.log(`Processing: [${type}] ${title} (${classification})`);

    // 1. Get Internal Notes (Now Recursive & Throttled)
    const internalNotes = await getNotionPageContent(page.id);
    
    // 2. Get External Content
    let externalData = "";
    if (sourceLoc === "GitHub" || sourceLoc === "YouTube") {
      externalData = await fetchExternalContent(url, sourceLoc);
    }

    const combinedText = `
      RESOURCE: ${title}
      CLASSIFICATION: ${classification}
      TYPE: ${type}
      TECHNOLOGY: ${tech}
      DOMAIN: ${domain}
      SOURCE LINK: ${url || "Internal Notion"}
      
      === INTERNAL NOTION NOTES ===
      ${internalNotes}
      
      === EXTERNAL SOURCE CONTENT ===
      ${externalData}
    `;

    docs.push(new Document({
      pageContent: combinedText,
      metadata: { title, type, tech, domain, classification, source: url || "Notion" }
    }));
  }

  if (docs.length > 0) {
    console.log(`\n📦 Chunking ${docs.length} documents...`);
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 2000, chunkOverlap: 200 });
    const splitDocs = await splitter.splitDocuments(docs);

    console.log(`🧠 Generating Embeddings...`);
    const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: API_KEY });
    const vectorStore = await HNSWLib.fromDocuments([splitDocs[0]], embeddings);
    
    for (let i = 1; i < splitDocs.length; i++) {
      try { await vectorStore.addDocuments([splitDocs[i]]); } catch(e) {}
      if (i % 10 === 0) process.stdout.write('.');
    }

    await vectorStore.save(VECTOR_STORE_PATH);
    console.log(`\n🎉 Knowledge Base Updated! Saved to: ${VECTOR_STORE_PATH}`);
  } else {
    console.log("⚠️ No documents found.");
  }
}

main();