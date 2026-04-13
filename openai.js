const OpenAI     = require("openai");
const { toFile } = require("openai");
require("dotenv").config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── ANALYZE IMAGE ────────────────────────────────────────────────────────────
// Fully dynamic — the prompt is built from the actual survey question and target,
// so it works for any camera step without hardcoded rules.
async function analyzeImage(base64Image, target, surveyQuestion) {
  try {
    const prompt = `
You are a smart AI vision assistant helping conduct a field research survey.

The interviewer just asked the participant this question:
"${surveyQuestion}"

The participant is pointing their camera to show: "${target}"

YOUR TASKS:
1. Look at the image and decide if it reasonably matches what "${target}" should look like
   based on the context of the question above.
2. List the real physical objects you can see.
3. Note any brand logos that are clearly visible.
4. If the image does NOT match, write a short, friendly hint to help the user reposition
   or show more — make it sound like a real person talking, not a robot.

CRITICAL RULES:
- observations = real physical objects ONLY (e.g. "laptop", "wooden desk", "monitor")
- Do NOT use abstract words like "setup", "environment", "workspace", "area", "space"
- brands = only if clearly visible logo in the frame, otherwise empty array
- Do NOT evaluate or mention cleanliness
- hint = only needed when result is NO. Keep it under 20 words. Sound warm and human.
  e.g. "Could you tilt down a bit? I want to see the desk surface."
- confidence = your confidence that the image matches the target (0.0 to 1.0)

OUTPUT STRICTLY JSON ONLY — no markdown, no extra text:
{
  "result": "YES" or "NO",
  "observations": ["list of real objects seen"],
  "brands": ["detected brand names"],
  "missing": ["things expected but not visible"],
  "hint": "friendly hint or empty string",
  "confidence": 0.0
}
`;

    const response = await client.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text",      text: "Analyze this image." },
            { type: "image_url", image_url: { url: base64Image } },
          ],
        },
      ],
      max_tokens: 200,
    });

    const raw = response.choices[0].message.content;
    console.log("GPT Vision RAW:", raw);

    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error("No JSON found");
      parsed = JSON.parse(match[0]);
    } catch {
      return fallback();
    }

    // Strip abstract words
    const invalidWords = ["setup", "environment", "workspace", "area", "space"];
    parsed.observations = (parsed.observations || []).filter(
      (o) => !invalidWords.some((w) => o.toLowerCase().includes(w))
    );
    if (!parsed.observations.length) parsed.observations = ["unclear objects"];

    const brands  = parsed.brands  || [];
    const missing = parsed.missing || [];
    const hint    = parsed.hint    || "";

    if (parsed.result === "YES") {
      // Build clean transcript answer — no cleanliness
      const transcriptAnswer = [
        `Observed: ${parsed.observations.join(", ")}.`,
        brands.length ? `Brands visible: ${brands.join(", ")}.` : "",
      ].filter(Boolean).join(" ");

      return {
        status: "ok",
        transcriptAnswer,
        observations: parsed.observations,
        brands,
        confidence: parsed.confidence || 0,
      };
    }

    return {
      status: "retry",
      hint,
      missing,
      observations: parsed.observations,
      brands,
      confidence: parsed.confidence || 0,
    };

  } catch (err) {
    console.error("analyzeImage error:", err.message);
    return fallback();
  }
}

// ─── TRANSCRIBE AUDIO ─────────────────────────────────────────────────────────
async function transcribeAudio(audioBuffer, questionContext = "") {
  try {
    const file = await toFile(audioBuffer, "audio.webm", { type: "audio/webm" });

    const transcription = await client.audio.transcriptions.create({
      file,
      model:    "whisper-1",
      language: "en",
      prompt:   questionContext
        ? `Survey question context: "${questionContext}"`
        : undefined,
    });

    console.log("Whisper:", transcription.text);
    return transcription.text;
  } catch (err) {
    console.error("transcribeAudio error:", err.message);
    return "";
  }
}

// ─── GENERATE PROBE QUESTION ──────────────────────────────────────────────────
async function generateProbe(originalQuestion, userAnswer) {
  try {
    const response = await client.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You are a warm, curious UX researcher having a natural conversation during a user study. You genuinely care about what the participant is saying.

Given a survey question and their answer, write ONE follow-up probe question.

Rules:
- Make it feel personal to THEIR answer — not a generic follow-up
- Sound like a real person, not a survey script
- Max 20 words
- No yes/no questions
- Don't repeat or rephrase the original question
- Dig into the "why", "how", or a specific detail they mentioned

Output ONLY the probe question. Nothing else.`,
        },
        {
          role: "user",
          content: `Question: "${originalQuestion}"\nTheir answer: "${userAnswer}"\n\nProbe:`,
        },
      ],
      max_tokens: 60,
    });

    const probe = response.choices[0].message.content.trim();
    console.log("Probe:", probe);
    return probe;
  } catch (err) {
    console.error("generateProbe error:", err.message);
    return "That's interesting — what made you go with that?";
  }
}

// ─── GENERATE ACKNOWLEDGEMENT ─────────────────────────────────────────────────
// Called after the probe answer is received.
// Returns a short, warm, human-sounding reaction before moving to the next question.
async function generateAcknowledgement(probeQuestion, probeAnswer) {
  try {
    const response = await client.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.85,
      messages: [
        {
          role: "system",
          content: `You are a friendly UX researcher wrapping up a question in a casual conversation.

The participant just answered a follow-up question. Write a SHORT, warm, natural reaction — 
the kind of thing a real interviewer would say before moving on. Think "yeah totally", 
"oh that makes a lot of sense", "haha fair enough", "wow that's actually really interesting" etc.

Rules:
- 1-2 sentences MAX
- Sound genuinely human — use casual phrases, contractions, filler words
- Briefly acknowledge something specific from their answer if possible
- Do NOT ask another question
- Do NOT say "Great answer!" or "That's great!" — too robotic
- End on a natural note that implies you're moving on

Output ONLY the acknowledgement. Nothing else.`,
        },
        {
          role: "user",
          content: `Follow-up question: "${probeQuestion}"\nTheir answer: "${probeAnswer}"\n\nAcknowledgement:`,
        },
      ],
      max_tokens: 60,
    });

    const ack = response.choices[0].message.content.trim();
    console.log("Acknowledgement:", ack);
    return ack;
  } catch (err) {
    console.error("generateAcknowledgement error:", err.message);
    return "Yeah, that totally makes sense. Okay, moving on!";
  }
}

// ─── FALLBACK ─────────────────────────────────────────────────────────────────
function fallback() {
  return {
    status:       "retry",
    hint:         "Hmm, I'm having a bit of trouble seeing — could you adjust the camera?",
    observations: [],
    brands:       [],
    confidence:   0,
  };
}

module.exports = { analyzeImage, transcribeAudio, generateProbe, generateAcknowledgement };