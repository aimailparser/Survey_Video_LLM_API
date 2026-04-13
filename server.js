const express = require("express");
const cors = require("cors");
const fs = require("fs");
require("dotenv").config();

const { analyzeImage } = require("./openai");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 📸 Image validation
app.post("/analyze", async (req, res) => {
  const { image, type } = req.body;

  const result = await analyzeImage(image, type);

  res.json(result);
});

// 🎤 Save transcript
app.post("/save", (req, res) => {
  const { text } = req.body;

  const file = "transcripts.json";

  let data = [];
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file));
  }

  data.push({
    text,
    time: new Date()
  });

  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  res.json({ ok: true });
});

app.listen(5000, () =>
  console.log("✅ Backend running on", process.env.PORT)
);