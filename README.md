# digitalTwin

**digitalTwin** is a Retrieval-Augmented Generation (RAG) platform that serves as the AI-powered persona of a Learning Strategist specializing in Learning Architecture and Learning Experience Design (LXD). 

By connecting a Notion-based portfolio to the **Gemini 3 Flash** model, `digitalTwin` provides technical, precise, and context-aware responses about project history, tech stacks, and educational strategy.



## 🧠 Specialized Knowledge
- **Learning Architecture:** Strategic design of scalable learning systems.
- **LXD (Learning Experience Design):** Designing for pedagogical integrity and user engagement.
- **Technical Implementation:** Full-stack awareness, from GitHub repositories to cloud deployment.

## 🛠 Tech Stack
- **Model:** Google Gemini 3 Flash (v1beta REST API)
- **Data Source:** Notion (Project Database)
- **Backend:** Node.js / Express.js
- **Intelligence:** LangChain (Recursive Text Splitting) + Google Generative AI Embeddings

## 🛡 Security & Protocols
The `digitalTwin` operates under a strict "Chain of Trust":
- **Internal Security:** Automatically detects `[Internal]` or `[Confidential]` tags in documentation and triggers mandatory security warnings.
- **Source Attribution:** Mandatory citation logic ensures every claim is backed by a linked resource using `[🔗 Title](URL)` format.
- **Code Priority:** Directly retrieves and displays file-level code blocks for projects identified as `Code Repositories`.

## 🚀 Setup

1. **Environment:**
   Add `GOOGLE_API_KEY`, `NOTION_TOKEN`, and `NOTION_DATABASE_ID` to your `.env` file.

2. **Ingestion:**
   Run `node build-kb.js` to sync your Notion data and generate the vectorized `memory_store.json`.

3. **Execution:**
   Run `node server.js` to start the Digital Twin API.

## 📈 Business Impact Integration
The system is designed to correlate technical implementation with business outcomes, mapping "Tech Stack" choices directly to "Business Impact" results as defined in the source Notion database.