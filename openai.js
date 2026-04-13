const OpenAI = require("openai");
require("dotenv").config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================== RULES ==================
const QualificationRules = {
  OFFICE: `MUST SEE:
  - Desk
  - Laptop or monitor
  - Chair
  - Indoor working setup`,
};

// ================== TYPE MAP ==================
const typeMap = {
  "Office Area": "OFFICE",
  OFFICE: "OFFICE",
};

// ================== MAIN FUNCTION ==================
async function analyzeImage(base64Image, type = "OFFICE") {
  try {
    const mappedType = typeMap[type] || "OFFICE";
    const rules = QualificationRules[mappedType];

    const prompt = `
You are an advanced AI vision inspector.

TASK:
1. Detect real objects in the image
2. Detect visible brands/logos (Apple, Dell, HP, Lenovo etc.)
3. Evaluate cleanliness (clean / slightly messy / messy)
4. Validate against TARGET

TARGET: ${mappedType}

RULES:
${rules}

CRITICAL:
- Observations must be REAL objects (laptop, desk, chair, bed etc.)
- Do NOT use abstract words like "setup", "environment"
- Brands only if logo clearly visible
- Cleanliness based on clutter
- DO NOT mention any score

OUTPUT JSON ONLY:
{
  "result": "YES" or "NO",
  "observations": ["objects"],
  "brands": ["detected brands"],
  "cleanliness": "clean | slightly messy | messy",
  "missing": ["missing items"],
  "confidence": 0-1
}
`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze image" },
            {
              type: "image_url",
              image_url: { url: base64Image },
            },
          ],
        },
      ],
      max_tokens: 150,
    });

    const raw = response.choices[0].message.content;
    console.log("GPT RAW:", raw);

    // ================== SAFE PARSE ==================
    let parsed;

    try {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error("No JSON");

      parsed = JSON.parse(match[0]);
    } catch (err) {
      return fallback();
    }

    // ================== CLEAN OBSERVATIONS ==================
    const invalidWords = ["setup", "environment", "workspace"];

    parsed.observations = (parsed.observations || []).filter(
      (o) => !invalidWords.some((w) => o.toLowerCase().includes(w))
    );

    if (!parsed.observations.length) {
      parsed.observations = ["unclear objects"];
    }

    // ================== DEFAULTS ==================
    const brands = parsed.brands || [];
    const cleanliness = parsed.cleanliness || "unknown";
    const missing = parsed.missing || [];

    // ================== 🔥 FINAL MESSAGE ==================
    let message;

    if (parsed.result === "YES") {
      message = `I can see ${parsed.observations.join(", ")}. ${
        brands.length ? `I also notice ${brands.join(", ")} devices. ` : ""
      }Your workspace looks ${cleanliness}.`;
    } else {
      message = `I can see ${parsed.observations.join(", ")}. Please show ${
        missing.join(", ") || "your office setup clearly"
      }.`;
    }

    return {
      status: parsed.result === "YES" ? "ok" : "retry",
      message,
      observations: parsed.observations,
      brands,
      cleanliness,
      confidence: parsed.confidence || 0,
    };
  } catch (err) {
    console.error(err.message);
    return fallback();
  }
}

// ================== FALLBACK ==================
function fallback() {
  return {
    status: "retry",
    message: "Please adjust the camera and show your workspace clearly",
    observations: [],
    brands: [],
    cleanliness: "unknown",
    confidence: 0,
  };
}

module.exports = { analyzeImage };