// ─────────────────────────────────────────────────────────────────────────────
// SPARK RAG Evolution — Phase 2: LLM Query Router
//
// Replaces the regex classifier family (isPersonalQuery, detectRoleFromQuery,
// detectCategoryFromQuery, title matching) with one fast structured LLM call.
//
// Safety model:
//   • Disabled unless USE_LLM_ROUTER=true (env)
//   • Returns null on any error / invalid JSON / unknown title → server falls
//     back to the existing regex path unchanged
//
// Wiring instructions: see RAG-EVOLUTION.md → Phase 2.
// ─────────────────────────────────────────────────────────────────────────────
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const VALID_INTENTS = ["list", "timeline", "personal", "project", "general"];
const VALID_ROLES = ["Leadership", "Learning Architecture & Design", "Creative Technology & UX", "Design"];

const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function routeQuery(userPrompt, projectTitles = [], hiddenTitles = []) {
    if (process.env.USE_LLM_ROUTER !== "true") return null;

    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json", temperature: 0 }
        });

        const prompt = `
You are a query router for a portfolio chat assistant about Dana Cannam.
Classify the user's message and return ONLY a JSON object — no prose.

Schema:
{
  "intent": "list" | "timeline" | "personal" | "project" | "general",
  "project": "<one EXACT title copied from the lists below>" | null,
  "roles": []  // subset of ${JSON.stringify(VALID_ROLES)}, usually empty
}

Intent definitions:
- "list": user wants an overview/list of all projects.
- "timeline": user wants work history in chronological order.
- "personal": about Dana as a person — education, school, degrees, thesis,
  teaching, skills, strengths, working style, values, hobbies, life outside
  work, what he's like, where he's most effective.
  NOT career achievements — companies founded or sold, awards won, clients
  served, or results delivered. Those live on project pages: use "project"
  when one project clearly owns the achievement, or "general" when unsure.
- "project": about one specific project. Set "project" to the EXACT matching
  title (copy it verbatim, including dashes) from either list below. This
  includes questions naming a product, client, or artifact that clearly
  belongs to one project (e.g. "Clamp", "Bowery", "flight simulator", a
  client name).
- "general": everything else (multi-project comparisons, capabilities,
  greetings). Leave "project" null.

Rules:
- "project" must be null OR an exact string from the lists. Never invent titles.
- Personal/education questions are "personal" even if phrased casually.
- Only fill "roles" when the user explicitly asks about a discipline
  (e.g. "show me Dana's design work").

VISIBLE PROJECT TITLES:
${projectTitles.map(t => `- ${t}`).join('\n')}

HIDDEN PAGE TITLES (route as "personal" when these topics are asked about):
${hiddenTitles.map(t => `- ${t}`).join('\n')}

USER MESSAGE:
"${userPrompt}"
        `.trim();

        const result = await model.generateContent(prompt);
        const parsed = JSON.parse(result.response.text());

        // ── Validate ─────────────────────────────────────────────────────────
        if (!VALID_INTENTS.includes(parsed.intent)) return null;

        const allTitles = [...projectTitles, ...hiddenTitles];
        if (parsed.project) {
            const match = allTitles.find(t => normalize(t) === normalize(parsed.project));
            parsed.project = match || null;           // exact store title or nothing
            if (!parsed.project && parsed.intent === "project") parsed.intent = "general";
        }

        parsed.roles = Array.isArray(parsed.roles)
            ? parsed.roles.filter(r => VALID_ROLES.includes(r))
            : [];

        return { intent: parsed.intent, project: parsed.project || null, roles: parsed.roles };

    } catch (error) {
        console.warn("⚠️ Router failed, falling back to regex path:", error.message);
        return null;
    }
}

module.exports = { routeQuery };
