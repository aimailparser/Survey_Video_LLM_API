const OpenAI = require("openai");
require("dotenv").config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const QualificationRules = {
  OFFICE: `MUST SEE:
  - People working at desks
  - Computers, monitors, keyboards
  - Office furniture (chairs, desks)
  - Indoor setting with typical office lighting`,
};

async function analyzeImage(base64Image, type = "OFFICE") {
  try {
    const prompt = `
                  You are a STRICT AI validator.

                  TARGET: ${type}

                  RULES:
                  ${QualificationRules[type]}
                  Reject If Not Found or unclear.

                  CRITICAL:
                  - DO NOT ask questions
                  - DO NOT hallucinate
                  - DO NOT guess extra things
                  - ONLY describe visible facts
                  - If unclear → NO

                  OUTPUT STRICT JSON:
                  {
                    "result": "YES" or "NO",
                    "message": "short instruction",
                    "confidence": 0-1
                  }
                  `;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
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
      max_tokens: 80,
    });

    const raw = response.choices[0].message.content;
    console.log("GPT:", raw);

    const json = raw.match(/\{.*\}/s);
    if (!json) throw new Error("Invalid JSON");

    const parsed = JSON.parse(json[0]);

    return {
      status: parsed.result === "YES" ? "ok" : "retry",
      message: parsed.message,
      confidence: parsed.confidence,
    };
  } catch (err) {
    console.error(err.message);
    return {
      status: "retry",
      message: "Adjust camera and show clearly",
      confidence: 0,
    };
  }
}

module.exports = { analyzeImage };
