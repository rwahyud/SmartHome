const mqtt = require("mqtt");
const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// Static + correct MIME types for PWA assets (some browsers are strict)
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    const base = path.basename(filePath);

    if (base === "manifest.webmanifest") {
      res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
    }

    if (base === "sw.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function normalizeStatus(statusRaw) {
  const s = String(statusRaw || "").trim().toUpperCase();
  if (s === "ON" || s === "1" || s === "TRUE") return "ON";
  if (s === "OFF" || s === "0" || s === "FALSE") return "OFF";
  return null;
}

// ================= SUPABASE =================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment (.env)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================= MQTT =================
const client = mqtt.connect("mqtt://test.mosquitto.org");

client.on("connect", () => {
  console.log("MQTT Connected ✅");
  client.subscribe("sensor/data");
});

client.on("message", async (topic, message) => {
  const raw = message.toString();

  console.log("\nTOPIC:", topic);
  console.log("RAW:", raw);

  // filter non JSON
  if (!raw.startsWith("{")) {
    console.log("❌ Bukan JSON ESP32, skip");
    return;
  }

  try {
    const data = JSON.parse(raw);

    console.log("DATA PARSED:", data);

    const { error } = await supabase.from("ldr").insert([{
      suhu: data.suhu,
      ldr: data.ldr,
      gas: data.gas,
      lampu: data.lampu,
      kipas: data.kipas,
      buzzer: data.buzzer
    }]);

    if (error) {
      console.log("❌ Supabase Error:", error.message);
    } else {
      console.log("Insert OK ✅");
    }

  } catch (err) {
    console.log("❌ JSON ERROR:", err.message);
  }
});

// ================= API GET DATA =================
app.get("/data", async (req, res) => {
  const { data, error } = await supabase
    .from("ldr")
    .select("*")
    .order("id", { ascending: false })
    .limit(20);

  if (error) return res.status(500).json(error);

  res.json(data);
});

// ================= CONTROL LAMPU =================
app.post("/lampu/:status", (req, res) => {
  const status = normalizeStatus(req.params.status);
  if (!status) return res.status(400).json({ error: "Invalid status. Use ON/OFF" });

  if (!client.connected) {
    return res.status(503).json({ error: "MQTT not connected" });
  }

  client.publish("lampu/control", status, (err) => {
    if (err) return res.status(500).json({ error: "Publish failed" });

    return res.json({
      success: true,
      device: "lampu",
      status
    });
  });
});

// ================= CONTROL KIPAS =================
app.post("/kipas/:status", (req, res) => {
  const status = normalizeStatus(req.params.status);
  if (!status) return res.status(400).json({ error: "Invalid status. Use ON/OFF" });

  if (!client.connected) {
    return res.status(503).json({ error: "MQTT not connected" });
  }

  client.publish("kipas/control", status, (err) => {
    if (err) return res.status(500).json({ error: "Publish failed" });

    return res.json({
      success: true,
      device: "kipas",
      status
    });
  });
});

// ================= SERVER =================
app.listen(3000, () => {
  console.log("Server jalan di http://localhost:3000");
});