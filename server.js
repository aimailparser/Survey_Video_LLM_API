const express = require("express");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");
const multer  = require("multer");
require("dotenv").config();

const {
  analyzeImage,
  transcribeAudio,
  generateProbe,
  generateAcknowledgement,
  textToSpeech,
} = require("./openai");

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── 📸 ANALYZE IMAGE ────────────────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { image, type, question } = req.body;
  const result = await analyzeImage(image, type, question || type);
  res.json(result);
});

// ─── 🎤 TRANSCRIBE AUDIO ─────────────────────────────────────────────────────
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const transcript = await transcribeAudio(
      req.file.buffer,
      req.body.question || ""
    );
    res.json({ transcript });
  } catch (err) {
    console.error("Transcribe error:", err.message);
    res.status(500).json({ transcript: "", error: err.message });
  }
});

// ─── 🔊 TEXT TO SPEECH ───────────────────────────────────────────────────────
// Returns mp3 audio buffer — used by frontend Audio element (works on mobile)
app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text" });

    const audioBuffer = await textToSpeech(text);

    res.set({
      "Content-Type":   "audio/mpeg",
      "Content-Length": audioBuffer.length,
      "Cache-Control":  "no-cache",
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 🧠 GENERATE PROBE ───────────────────────────────────────────────────────
app.post("/probe", async (req, res) => {
  try {
    const { question, answer } = req.body;
    const probe = await generateProbe(question, answer);
    res.json({ probe });
  } catch (err) {
    console.error("Probe error:", err.message);
    res.status(500).json({ probe: "That's interesting — what made you go with that?" });
  }
});

// ─── 💬 GENERATE ACKNOWLEDGEMENT ─────────────────────────────────────────────
app.post("/acknowledge", async (req, res) => {
  try {
    const { probeQuestion, probeAnswer } = req.body;
    const ack = await generateAcknowledgement(probeQuestion, probeAnswer);
    res.json({ ack });
  } catch (err) {
    console.error("Acknowledge error:", err.message);
    res.status(500).json({ ack: "Yeah, that makes a lot of sense. Let's keep going!" });
  }
});

// ─── 💾 SAVE (MCQ single entry) ──────────────────────────────────────────────
app.post("/save", (req, res) => {
  const { question, answer } = req.body;
  appendToJSON("transcripts.json", { question, answer, time: new Date() });
  res.json({ ok: true });
});

// ─── 💾 SAVE TRANSCRIPT ───────────────────────────────────────────────────────
// Mode A — { entries: [{question, answer}] }  → appends live to transcripts.json
// Mode B — { age, gender, transcript, completedAt } → saves full session files
app.post("/save-transcript", (req, res) => {
  const { entries, age, gender, transcript, completedAt } = req.body;

  // Mode A
  if (entries && Array.isArray(entries)) {
    entries.forEach((e) =>
      appendToJSON("transcripts.json", {
        question: e.question,
        answer:   e.answer,
        time:     new Date(),
      })
    );
    console.log(`📝 Saved ${entries.length} voice entries`);
    return res.json({ ok: true });
  }

  // Mode B
  const timestamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const session    = { age, gender, completedAt, transcript };
  const txtContent = buildTxt(age, gender, completedAt, transcript);
  const filename   = `transcript_${timestamp}.txt`;

  ensureDir("sessions");
  fs.writeFileSync(
    path.join("sessions", `session_${timestamp}.json`),
    JSON.stringify(session, null, 2),
    "utf8"
  );

  ensureDir("data");
  fs.writeFileSync(path.join("data", filename), txtContent, "utf8");

  appendToJSON("all_sessions.json", session);

  console.log(`✅ Session + transcript saved (${timestamp})`);
  res.json({ ok: true, txtContent, filename });
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendToJSON(filepath, entry) {
  let data = [];
  if (fs.existsSync(filepath)) {
    try { data = JSON.parse(fs.readFileSync(filepath, "utf8")); } catch { data = []; }
  }
  data.push(entry);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
}

function buildTxt(age, gender, completedAt, transcript) {
  const divider = "═".repeat(55);
  const thin    = "─".repeat(55);
  const date    = new Date(completedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  const lines = [
    divider,
    "               INTERVIEW TRANSCRIPT",
    divider,
    `  Date    : ${date}`,
    `  Age     : ${age}`,
    `  Gender  : ${gender}`,
    thin,
    "",
  ];

  (transcript || []).forEach((entry, i) => {
    lines.push(`Q${i + 1}: ${entry.question}`);
    lines.push(`A${i + 1}: ${entry.answer}`);
    lines.push("");
  });

  lines.push(divider);
  lines.push("                 END OF SESSION");
  lines.push(divider);

  return lines.join("\n");
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));