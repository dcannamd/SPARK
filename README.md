# SPARK ✨ — AI-Powered Portfolio

**A Shared Portfolio And Resource Knowledge-base developed by Dana Cannam**

SPARK is an interactive, AI-powered digital twin portfolio that transforms a traditional resume/portfolio into a dynamic, conversational experience. Built on a RAG (Retrieval-Augmented Generation) architecture, SPARK uses Notion as a single source of truth and Google Gemini to answer questions about Dana's projects, expertise, and experience in real time.

**Live URL:** https://danas-digital-twin.onrender.com

---

## How It Works

1. **Notion as CMS** — All project content, business impact statements, roles, categories, tech stacks, and media live in a Notion database. This is the single source of truth.
2. **Knowledge Base Build** — `build-kb.js` extracts every page from Notion, chunks the content, generates vector embeddings via Gemini, and writes everything to `vector_store/memory_store.json`.
3. **RAG Retrieval** — When a user asks a question, `server.js` embeds the query, performs a vector similarity search against the knowledge base, applies role/category filters, and assembles relevant context.
4. **AI Response** — `rag-tutor.js` sends the retrieved context plus the user's question to Gemini (`gemini-2.5-flash`) along with a detailed system prompt that controls tone, formatting, and behavior.
5. **Frontend Rendering** — `index.html` renders the AI's markdown response, converts `[[LINK: Project Name]]` tags into clickable project links, and displays YouTube thumbnails for projects with media.

---

## Project Structure

```
/
├── server.js              # Express server, RAG retrieval logic, API routes
├── rag-tutor.js            # AI system prompts, Gemini chat logic, cover letter generation
├── build-kb.js             # Notion → vector store build script
├── vector_store/
│   └── memory_store.json   # Generated knowledge base (embeddings + metadata)
├── job_postings/
│   └── <company>.txt       # Job posting text files for custom URL targeting
├── public/
│   ├── index.html           # Frontend chat interface
│   ├── style.css            # Styling
│   ├── dana-cannam-resume.html  # Resume page (served at /resume)
│   └── spark_typing_animation.json  # Lottie typing indicator
└── .env                    # Environment variables (not committed)
```

---

## Environment Variables

Set these in Render under **Environment**:

| Variable | Description |
|---|---|
| `GOOGLE_API_KEY` | Gemini API key (used for both chat and embeddings) |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DATABASE_ID` | ID of the Notion projects database |
| `PORT` | Set automatically by Render |

---

## Notion Database Schema

Each project page should have these properties:

| Property | Type | Notes |
|---|---|---|
| Project Name | Title | Required |
| Role | Multi-select | e.g. Leadership, Learning Architecture & Design, Creative Technology & UX |
| Category | Multi-select | e.g. Onboarding, Enablement, Research, Compliance, Architecture, Prototyping |
| Industry | Multi-select | Optional |
| Business Impact | Rich text | One-sentence summary used in project lists |
| Client | Rich text | Optional |
| Tech Stack | Multi-select | Authoritative source for tech questions |
| Tools | Multi-select | Authoritative source for tools questions |
| Media URL | URL | YouTube link shown as thumbnail after first mention |
| Date | Date | Project date |
| Status | Status/Select | e.g. Public |
| Visible | Select (Yes/No) | `No` hides the page from general search/list queries — only surfaced when directly asked about by name |

### Hidden Pages (Visible = No)

Pages marked `Visible: No` (e.g. "Dana's Expertise") are excluded from:
- General semantic search results
- "View project list" responses

They are only surfaced when the user's query directly references the page title (case and apostrophe-insensitive matching).

---

## Rebuilding the Knowledge Base

After editing content in Notion, redeploy on Render. The build process automatically runs:

```bash
node build-kb.js
```

This re-scans all Notion pages, regenerates embeddings, and writes a fresh `memory_store.json`. The build log shows a summary for each page including roles, categories, visibility, and chunk counts.

---

## Key Features

### Smart Query Routing
- **List queries** ("View project list") retrieve one chunk per project across the full portfolio
- **Role/category detection** — free-text queries like "tell me about Dana's leadership" or "show me compliance work" automatically filter results by detected role or category
- **Follow-up anchoring** — follow-up questions ("tell me more", "what tech did you use") stay anchored to the currently discussed project
- **Hidden page routing** — queries matching a `Visible: No` page title route directly to that page's full content

### Project Links & Media
- AI responses use `[[LINK: Project Name]]` tags, rendered as clickable links in the frontend
- Clicking a project link triggers a follow-up query about that project
- YouTube media (from the `Media URL` field) displays as a thumbnail with play button after the first response about that project
- Media only shows once per session (tracked via `shownMediaTitles`, reset on "Start Fresh")

### Suggestion & Follow-up Chips
- Three starter chips on load: "How does SPARK work?", "View Dana's project list", "Dana's expertise"
- Contextual follow-up chips appear after certain responses to guide the conversation (e.g. toward the project list or contact info)

### URL-Based Targeting
SPARK supports query parameters for tailored experiences:

```
?role=lxd                          # Filter portfolio lens by role
?company=lululemon                 # Load job posting context from job_postings/lululemon.txt
?role=lxd&company=lululemon        # Combine role lens + company targeting
```

**Role options:** `lxd`, `lsa`, `creative-technologist`, `leadership`, `instructional-design`, `ai-integration`, `general`

### Hidden Cover Letter Generator
Adding `&mode=cover` to a URL with `company=` triggers an automatic, ATS-friendly cover letter generation on page load:

```
?role=lxd&company=lululemon&mode=cover
```

This is a hidden feature — not advertised in the UI — intended for Dana's personal use when applying to roles. The generated letter:
- Is under 400 words, traditional business letter format
- Mirrors language from the job posting (`job_postings/<company>.txt`)
- Includes a dedicated paragraph inviting the reader to try SPARK
- Ends with a standard signature block

**Important:** job posting filenames must be lowercase (e.g. `lululemon.txt`) — the server lowercases the `company` parameter before looking up the file.

---

## Resume Page

A standalone resume is served at `/resume`, styled to match SPARK's dark theme.

---

## Deployment

Hosted on Render (Node.js web service). Recommended tier: **Starter ($7/month)** to avoid cold-start delays when sharing with hiring managers — the free tier spins down after 15 minutes of inactivity.

### Deploy Checklist
1. Push changes to the connected GitHub branch
2. Render automatically runs `node build-kb.js` then `node server.js`
3. Confirm the build log shows the expected number of pages and chunks
4. Test "View project list" and a few project-specific queries
5. Test the "Dana's expertise" chip
6. If media was added/changed, click "+ Start Fresh" to reset session state before testing

---

## Tech Stack

- **Backend:** Node.js, Express
- **AI:** Google Gemini (`gemini-2.5-flash` for chat, `gemini-embedding-001` for embeddings)
- **Vector Store:** Custom JSON-based store with cosine/dot-product similarity search
- **CMS:** Notion API
- **Frontend:** Vanilla HTML/CSS/JS, marked.js for markdown rendering, Lottie for animations
- **Hosting:** Render

---

## Contact

**Dana Cannam**
danacannamdesign@gmail.com
+1 (250) 465-9578
[SPARK Portfolio](https://danas-digital-twin.onrender.com)