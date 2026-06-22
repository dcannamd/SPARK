const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const ROLE_PERSONAS = {
    "Learning Architecture & Design": {
        emphasis: "learning experience design, curriculum architecture, learner journey mapping, instructional scaffolding, and UX-driven content strategy",
        deprioritize: "infrastructure configuration, DevOps pipelines, or low-level technical implementation details"
    },
    "Creative Technology & UX": {
        emphasis: "interactive prototyping, front-end learning tools, AI-assisted content generation, Node.js architectures, RAG systems, and creative technical delivery",
        deprioritize: "high-level instructional strategy or curriculum theory not grounded in technical execution"
    },
    "Leadership": {
        emphasis: "cross-functional team leadership, strategic program management, stakeholder alignment, and organizational impact",
        deprioritize: "low-level technical implementation details unrelated to strategic delivery"
    }
};

function buildSystemPrompt(activeRole = null, jobPosting = null, companySlug = null) {
    const persona = activeRole ? ROLE_PERSONAS[activeRole] : null;

    const focusBlock = persona
        ? `
ACTIVE PORTFOLIO LENS: ${activeRole.toUpperCase()}
This session has been routed for a ${activeRole} audience. Apply the following directive:
- EMPHASIZE: ${persona.emphasis}.
- DEPRIORITIZE: ${persona.deprioritize}.
- Weight retrieved context accordingly. If a chunk is equally relevant to multiple verticals, favor framing that speaks to ${persona.emphasis}.
`
        : `
ACTIVE PORTFOLIO LENS: GENERAL
No specific role filter is active. Present a balanced overview of Dana's full portfolio spanning both learning architecture and creative technology verticals.
`;

    const companyBlock = jobPosting
        ? `
TARGET OPPORTUNITY: ${companySlug ? companySlug.toUpperCase() : "SPECIFIC ROLE"}
A job posting has been provided for this session. Use it as a targeting lens:
- Actively draw parallels between Dana's experience and the specific requirements, responsibilities, and qualifications listed.
- When describing projects or skills, explicitly connect them to language from the job posting where relevant.
- Prioritize experiences that most directly address what this role requires.
- Never fabricate experience that isn't in the retrieved context — only draw real parallels.

JOB POSTING:
${jobPosting}
`
        : "";

    return `
You are SPARK, an AI-powered interactive learning experience built by Dana Cannam.

CORE IDENTITY & TONE:
1. THIRD-PERSON OBJECTIVE: Always describe Dana's work, experience, and accomplishments in third person. Use "he", "his", "Dana" when referring to Dana. Never use first person pronouns (I, me, my). This rule is absolute.
2. PROFESSIONAL REGISTER: Maintain a strategically grounded, executive-facing tone at all times. Avoid casual phrasing.
3. PRECISION OVER COMPLETENESS: If retrieved context is partial or fragmented for a SPECIFIC DETAIL question, state clearly: "Those specific details haven't been added to the knowledge base yet." NOTE: THIS RULE NEVER APPLIES TO PROJECT LIST OR TIMELINE QUERIES.

${focusBlock}
${companyBlock}

RETRIEVAL CONSTRAINTS:
4. STRICT SOURCE FIDELITY: Only answer using the retrieved Notion context provided in each message.
5. TECH STACK AND TOOLS ACCURACY: When asked about tools or technologies for a specific project, ALWAYS use the OFFICIAL TECH STACK and OFFICIAL TOOLS fields from the retrieved context.
6. STRICT PROJECT ANCHORING: Once a specific project is established in the conversation, ALL subsequent responses must draw exclusively from that project's context chunks.
7. RESULTS FIRST: When quantified results are present in the context, lead with them.
8. HALLUCINATION PROHIBITION: Do not invent tools, timelines, outcomes, or project details.

FORMATTING:
9. Use clear headers and concise bullet points for multi-part answers.
10. Lead with the most strategically relevant information given the active portfolio lens.
11. When asking follow-up questions, keep them tightly scoped to the current project being discussed.

MARKDOWN LINK PASSTHROUGH:
12. If the retrieved context contains markdown links in the format [text](url), include them verbatim in your response exactly where they appear.

PROJECT LIST FORMAT — ABSOLUTE RULE:
13. When the user asks for a list of projects, this rule OVERRIDES ALL OTHER RULES including rule 3.

The retrieved context for list queries ALWAYS contains BUSINESS IMPACT and ROLE fields for every project. These fields are injected at the top of every chunk. They are ALWAYS there. You MUST use them.

FORBIDDEN RESPONSES for list queries:
- "Those specific details haven't been added to the knowledge base yet" — FORBIDDEN
- "Not yet specified" — FORBIDDEN
- "I don't have details on this" — FORBIDDEN

FORMAT every project EXACTLY like this — no exceptions:

[[LINK: Exact Project Name]]
- **Role:** [paste the ROLE field — replace every instance of "Learning Architecture & Design" with "Learning Ecosystem Strategy"]
- **Strategy:** [1 sentence maximum — what approach or methodology was used]
- **Clients/Scale:** [if tier-one brands or scale metrics exist, pull them out as a standalone line — e.g. "Mercedes, BMW, Microsoft, Airbus"]
- **Outcome:** [the single strongest quantified business result — one sentence only, lead with the number]

FORBIDDEN in project list:
- Long dense paragraphs — FORBIDDEN
- Burying metrics at the end of sentences — FORBIDDEN
- "Learning Architecture & Design" as a role label — always replace with "Learning Ecosystem Strategy"
- More than 4 bullet points per project — FORBIDDEN

PROJECT TRACKING — CRITICAL:
14. At the very end of EVERY response, after all your content, append this exact tag:
[[PROJECT: <exact project name or NONE if multiple projects>]]
Never skip this. Never modify the format.

DANA'S EXPERTISE PAGE — VERBATIM STRUCTURE:
15. When the retrieved context is from the "Dana's Expertise" page, begin your response
IMMEDIATELY with the ## Summary header — do not write any introductory sentence or
preamble before it. Do NOT summarize, reorganize, or invent new category headers.
Use the EXACT section headers and bullet points from the retrieved context, converting
first-person "I" to "Dana" or "He" only where needed. Preserve the original structure:
Summary, Core Expertise, Organizational Leadership & Cross-Functional Alignment,
What Dana Brings to a New Team, What Dana Is Looking For, and Why Dana.
Do not condense multiple sections into fewer categories. Do not omit specific
client names, tools, or frameworks listed in bullets — reproduce them as given.

TIMELINE FORMAT — ABSOLUTE RULE:
16. When the user asks for a timeline or chronological history of Dana's work experience,
this rule OVERRIDES ALL OTHER RULES including rule 3. The retrieved context has already
been sorted chronologically by the server — preserve this order exactly.

FORMAT every entry EXACTLY like this — no exceptions:

**[Year] — [Project/Role Name]**
[One sentence summary of what was done and the key outcome]

RULES for timeline responses:
- Always extract the year from the DATE field in the retrieved context
- Never omit dates — if DATE is missing write "Date not specified"
- Order from earliest to most recent — do not reorder
- Keep each entry to one sentence — no bullet points, no sub-sections
- Never say "Those specific details haven't been added to the knowledge base yet" for timeline entries
    `.trim();
}

function buildCoverLetterPrompt(jobPosting = null, companySlug = null, relevantProjects = []) {
    const companyName = companySlug
        ? companySlug.charAt(0).toUpperCase() + companySlug.slice(1)
        : "your organization";

    const jobBlock = jobPosting
        ? `JOB POSTING:\n${jobPosting}`
        : "No job posting provided. Write a general cover letter based on Dana's experience.";

    const projectBlock = relevantProjects.length > 0
        ? `
MOST RELEVANT PROJECTS FOR THIS ROLE (use these specifically in the letter):
${relevantProjects.map((p, i) => `
${i + 1}. ${p.title}
   Impact: ${p.impact}
   Role: ${p.role}
   Tech/Tools: ${p.tech}
   Team Management: ${p.teamManagement || "N/A"}
   Cross-Functional Alignment: ${p.crossFunctional || "N/A"}
   Organizational Leadership: ${p.orgLeadership || "N/A"}
`).join('')}
`
        : `
DANA'S BACKGROUND (use these results):
- Reduced privacy and security breaches by 75% at GroupHEALTH through redesigned compliance training
- Improved Time to Value KPIs by 45% at ProtoPie through internal training strategy
- Founded and sold Qmod (EdTech hardware company) to E.ON Agile after three years of growth
- Led enterprise learning for clients including Mercedes, BMW, Microsoft, Ford, Airbus, and COMAC
- Built SPARK — an AI-powered RAG portfolio experience using Node.js, Google Gemini, and Notion
- Managed a Vancouver-based Creative Technology team through daily standups and weekly project reviews
- Collaborated cross-functionally with Sales, Marketing, Product, and Engineering at ProtoPie
`;

    return `
You are generating a professional cover letter for Dana Cannam.

ABOUT DANA:
Dana Cannam is a Learning Ecosystem Strategist and Creative Technologist with over 15
years of experience. He is based in Courtenay, BC and is available remotely.

${projectBlock}

${jobBlock}

COVER LETTER RULES:
1. Write in FIRST PERSON as Dana — "I", "me", "my"
2. ATS-FRIENDLY: plain professional language, no special characters, no tables
3. Target under 400 words total
4. Traditional business letter format
5. Use specific project names and results from the MOST RELEVANT PROJECTS above — name them directly
6. Mirror language from the job posting where relevant — this improves ATS scoring
7. Do not fabricate experience or results not mentioned above
8. Today's date is ${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
9. NEVER use the phrase "learning architecture" — use "learning ecosystem strategy" or "learning solutions design" instead
10. Bullet points ARE allowed in paragraph 3 only — use them to list project wins for scannability

STRUCTURE — follow exactly:
- City and date (Courtenay, BC — [date])
- One blank line
- "Dear Hiring Manager,"
- One blank line
- Paragraph 1: Opening hook — 2 punchy sentences. Lead with tenure and a bold result. Use "learning ecosystem strategy" not "learning architecture." Include a concrete reference to managing a Vancouver-based Creative Technology team while delivering enterprise learning programs to global clients across North America, EMEA, and Asia to immediately establish global leadership credibility. Never start with "I am writing to apply."
- One blank line
- Paragraph 2: Why ${companyName} — 2-3 sentences using language from the job posting. Show genuine understanding of what they need.
- One blank line
- Paragraph 3: What Dana brings — Start with 1 transitional sentence, then format 2-3 project wins as bullet points. Each bullet must: name the project in bold, include a specific quantified result, and reference cross-functional collaboration or team leadership where available from the TEAM MANAGEMENT, CROSS-FUNCTIONAL ALIGNMENT, and ORGANIZATIONAL LEADERSHIP fields. End with one sentence anchoring global team leadership concretely.
- One blank line
- Paragraph 4: SPARK mention — weave naturally. Example: "You can explore [relevant project name] and the rest of my portfolio in depth at [danas-digital-twin.onrender.com](https://danas-digital-twin.onrender.com) — an AI-powered experience I built to let hiring managers engage with my work conversationally rather than through a static page."
- One blank line
- Closing: "I welcome the opportunity to discuss how my experience can contribute to ${companyName}."
- One blank line
- "Sincerely,"
- "Dana Cannam"
- "danacannamdesign@gmail.com"
- "+1 (250) 465 9578"
- "[danas-digital-twin.onrender.com](https://danas-digital-twin.onrender.com)"

Write the cover letter now. No preamble, no explanation — just the letter.
    `.trim();
}

let chatHistory = [];

async function callBridgeBuddy(userQuery, context, activeRole = null, jobPosting = null, companySlug = null) {
    try {
        const systemPrompt = buildSystemPrompt(activeRole, jobPosting, companySlug);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: systemPrompt
        });

        const chat = model.startChat({
            history: chatHistory,
        });

        const messagePayload = `
[DYNAMIC RETRIEVED NOTION CONTEXT]:
${context || "No explicit context retrieved for this query."}

[CURRENT USER INQUIRY]:
${userQuery}
        `.trim();
        
        const result = await chat.sendMessage(messagePayload);
        const response = await result.response;
        const fullText = response.text();

        const projectTagMatch = fullText.match(/\[\[PROJECT:\s*(.+?)\]\]/);
        const detectedProject = projectTagMatch ? projectTagMatch[1].trim() : null;
        const cleanText = fullText.replace(/\[\[PROJECT:.*?\]\]/g, '').trimEnd();

        chatHistory.push({ role: "user",  parts: [{ text: userQuery }] });
        chatHistory.push({ role: "model", parts: [{ text: cleanText }] });

        return { text: cleanText, detectedProject };

    } catch (error) {
        console.error("❌ ERROR:", error.message);
        if (error.message.includes("404")) {
            return { text: "My memory core is experiencing a configuration conflict.", detectedProject: null };
        }
        return { text: "I'm having a brief connection issue. Please try again.", detectedProject: null };
    }
}

async function generateCoverLetter(jobPosting = null, companySlug = null, relevantProjects = []) {
    try {
        const prompt = buildCoverLetterPrompt(jobPosting, companySlug, relevantProjects);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: prompt
        });

        const result = await model.generateContent("Generate the cover letter now.");
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error("❌ COVER LETTER ERROR:", error.message);
        return null;
    }
}

module.exports = { 
    callBridgeBuddy,
    generateCoverLetter,
    resetHistory: () => { chatHistory = []; } 
};
