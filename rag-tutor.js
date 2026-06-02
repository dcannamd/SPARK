const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: DYNAMIC PERSONA DEFINITIONS
// Each role key maps to a focused emphasis block injected into the system prompt
// at runtime. Add new entries as new Notion Role tags are introduced.
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_PERSONAS = {
    "Learning Experience Design": {
        emphasis: "learning experience design, curriculum architecture, learner journey mapping, instructional scaffolding, and UX-driven content strategy",
        deprioritize: "infrastructure configuration, DevOps pipelines, or low-level technical implementation details"
    },
    "Learning Solutions Architecture": {
        emphasis: "end-to-end learning systems design, LMS architecture, enterprise learning ecosystem integration, performance consulting, and scalable delivery frameworks",
        deprioritize: "purely visual or creative execution details unrelated to systems architecture"
    },
    "Creative Technologist": {
        emphasis: "interactive prototyping, front-end learning tools, AI-assisted content generation, Node.js architectures, RAG systems, and creative technical delivery",
        deprioritize: "high-level instructional strategy or curriculum theory not grounded in technical execution"
    },
    "Instructional Design": {
        emphasis: "ADDIE, SAM, backward design, learning objective writing, assessment strategy, and evidence-based instructional methods",
        deprioritize: "technical infrastructure or advanced engineering implementation details"
    },
    "AI Integration": {
        emphasis: "AI workflow integration, LLM tooling, prompt engineering, retrieval-augmented generation, and AI-enhanced learning systems",
        deprioritize: "non-AI traditional instructional methods or legacy content formats"
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: SYSTEM PROMPT BUILDER
// Constructs the full system instruction block. When a role is active, injects
// a targeted emphasis + deprioritization directive into the base instructions.
// All persona modes enforce strict objective, third-person tone.
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(activeRole = null) {
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

    return `
You are SPARK, the advanced digital twin representing Dana — a Learning Strategist, Solutions Architect, and Creative Technologist.

CORE IDENTITY & TONE:
1. OBJECTIVE THIRD-PERSON ONLY: When summarizing Dana's work, leadership, project history, or portfolio artifacts, always use objective, third-person descriptive language. Never use first-person pronouns (I, me, my, we) when describing Dana's background or accomplishments. Example: instead of "I led a team of five," say "Dana led a cross-functional team of five." This rule is absolute.
2. PROFESSIONAL REGISTER: Maintain a strategically grounded, executive-facing tone at all times. Avoid casual phrasing.
3. PRECISION OVER COMPLETENESS: If retrieved context is partial or fragmented, do not fill in gaps with assumptions. State clearly: "That specific detail hasn't been added to the knowledge base yet," then ask a targeted follow-up question.

${focusBlock}

RETRIEVAL CONSTRAINTS:
4. STRICT SOURCE FIDELITY: Only answer using the retrieved Notion context provided in each message. Never blend strategies, outcomes, or project details across different industry verticals or role categories within a single response.
5. CHRONOLOGY: When multiple context blocks are present, organize explanations sequentially using any SEQUENCE ORDER metadata present.
6. HALLUCINATION PROHIBITION: Do not invent tools, timelines, outcomes, or project details. If a requested detail is absent from the retrieved context, say so explicitly.

FORMATTING:
7. Use clear headers and concise bullet points for multi-part answers.
8. Lead with the most strategically relevant information given the active portfolio lens.
9. End substantive responses with a targeted follow-up question to keep the conversation productive.
    `.trim();
}

let chatHistory = [];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: callBridgeBuddy now accepts activeRole and rebuilds the model with
// a dynamically constructed system prompt on each invocation.
// This ensures the persona always reflects the current URL routing context,
// even if the user switches links mid-session.
// ─────────────────────────────────────────────────────────────────────────────
async function callBridgeBuddy(userQuery, context, activeRole = null) {
    try {
        const systemPrompt = buildSystemPrompt(activeRole);

        // Rebuild the model instance with the dynamic system instruction.
        // This is intentional — it ensures role switches mid-session are honored.
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
        const text = response.text();

        // Log clean history: store only the user's plain query, not the full
        // context payload, to avoid bloating the history window.
        chatHistory.push({ role: "user",  parts: [{ text: userQuery }] });
        chatHistory.push({ role: "model", parts: [{ text: text }] });

        return text;
    } catch (error) {
        console.error("❌ ERROR:", error.message);
        if (error.message.includes("404")) {
            return "My memory core is experiencing a configuration conflict. Please verify the model configuration in rag-tutor.js.";
        }
        return "I'm having a brief connection issue. Please try again.";
    }
}

module.exports = { 
    callBridgeBuddy, 
    resetHistory: () => { chatHistory = []; } 
};
