// index.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const multer = require("multer");

// Import routes (contact optional)
let contactRoutes;
try {
  contactRoutes = require("./routes/contact");
} catch (err) {
  console.warn("⚠️ ./routes/contact not found or failed to load:", err.message);
}

const donateModule = require("./routes/donateRoutes"); // should export { router, webhookHandler }
const donationRoutes = donateModule.router || donateModule;
const donationWebhookHandler = donateModule.webhookHandler;

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------- Multer Setup ----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Serve uploads static
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---- IMPORTANT: mount webhook route using raw body BEFORE any JSON body-parser ----
if (donationWebhookHandler) {
  app.post("/api/donate/webhook", express.raw({ type: "application/json" }), donationWebhookHandler);
  console.log("✅ Webhook route mounted at /api/donate/webhook (raw body)");
} else {
  console.warn("⚠️ donateRoutes webhookHandler not found — make sure donateRoutes exports it.");
}

// ---------------- Now global middleware (after webhook) ----------------
// Allow FRONTEND/CLIENT_URL via env; fallback to localhost:5173 for dev
const FRONTEND = process.env.CLIENT_URL || process.env.FRONTEND || "http://localhost:5173";

const cors = require("cors");

app.use(cors({
  origin: ["https://hdfintl.com"], // your frontend domain
  methods: ["GET", "POST", "PUT", "DELETE"],
}));


// Body parsers for normal routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Simple health route
app.get("/health", (req, res) => res.json({ ok: true, timestamp: Date.now() }));

// File upload route (uses multer)
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({
    message: "File uploaded successfully",
    fileUrl: `/uploads/${req.file.filename}`,
  });
});

// ---------------- API Routes (other routes) ----------------
if (contactRoutes) {
  app.use("/api/contact", contactRoutes);
}

if (donationRoutes) {
  app.use("/api/donate", donationRoutes);
} else {
  console.warn("⚠️ donationRoutes not found — /api/donate endpoints will not be available");
}

// ---------------- 404 & Error Handling ----------------
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// central error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error("❌ Server Error:", err && err.stack ? err.stack : err);
  // If it's a CORS error from our handler, forward a clear message
  if (err && err.message && err.message.startsWith("CORS policy")) {
    return res.status(403).json({ message: err.message });
  }
  res.status(500).json({ message: "Internal Server Error" });
});

// ---------------- Env checks & MongoDB Connection ----------------
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ Missing STRIPE_SECRET_KEY in environment! Stripe payments will fail.");
}
if (!process.env.MONGO_URI) {
  console.warn("⚠️ MONGO_URI not set — DB will not connect until configured.");
}

if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));
} else {
  console.log("ℹ️ Skipping MongoDB connection because MONGO_URI is not set.");
}

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} (frontend allowed: ${FRONTEND})`));
