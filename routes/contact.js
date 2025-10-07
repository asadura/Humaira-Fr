// backend/routes/contact.js
const express = require("express");
const router = express.Router();
const Contact = require("../model/Contact");

// POST /api/contact
router.post("/", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ message: "Missing required fields" });

    const newContact = await Contact.create({ name, email, message, createdAt: new Date() });

    // OPTIONAL: send email / notifications here (e.g., nodemailer) if you want.

    res.status(201).json({ message: "Message received", data: newContact });
  } catch (err) {
    console.error("Contact route error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
