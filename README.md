(*SPARK) ⚡️

**SPARK** is an AI-powered technical knowledge assistant designed to support our Creative Labs and Engineering teams.

The heart of this initiative is to create a **living support system** for our team. Unlike "black box" AI tools where knowledge is locked away, Bridge Buddy is built on an open **Notion database**. This empowers our Creative Technologists to actively share their expertise and keep content fresh. The result is that our client-facing colleagues can feel confident they are always supported by the most accurate, expert-verified resources available.

---

## 🚀 Key Features

* **Deep Technical RAG:** Recursively indexes our internal Notion documentation, reading through toggles, nested columns, and code blocks.
* **Visual Intelligence:** Displays wiring diagrams (images) and video tutorials directly in the chat.
* **Security Aware:** Automatically flags information from "Classified" or "Confidential" sources with warnings.
* **Multi-Interface:** Runs as a simple Web App (`localhost:3000`) or integrates directly into Slack via Socket Mode.
* **Zero-Hallucination Protocol:** Prioritizes verified internal documentation over general AI knowledge.

---

## 🛠 Prerequisites

* **Docker Desktop** (Recommended for easiest usage)
* [cite_start]**Node.js 18+** (Only if running in development mode) 

---

## 📦 Quick Start (Docker)

This is the recommended way for most team members to use the app. It uses the provided `Dockerfile` and `docker-compose.yml` to spin up the environment instantly.

1.  **Unzip** the project folder.
2.  Open your **Terminal** or Command Prompt.
3.  Navigate to the folder:
    ```bash
    cd path/to/BridgeBuddy_v2.1
    ```
4.  **Launch the Bot:**
    ```bash
    docker-compose up --build
    ```
5.  **Access the App:**
    * Open your browser to: [http://localhost:3000](http://localhost:3000)
    * (Or tag `@BridgeBuddy` in Slack if Socket Mode is configured).

---

## ⚙️ Configuration (.env)

The application relies on a `.env` file in the root directory to store secure keys.

**Required Variables:**
```ini
# --- AI & Database Keys ---
GOOGLE_API_KEY=AIzaSy...             # Google Gemini API Key
NOTION_TOKEN=ntn_...                 # Internal Integration Token
NOTION_DATABASE_ID=2b24...           # The ID of the Knowledge Base

# --- Slack Keys (Optional: Only if using Slack Mode) ---
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...# SPARK
Shared, Prototyping, Answers &amp; Resource, Knowledge-base chatbot application
