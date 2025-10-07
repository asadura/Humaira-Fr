const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentId: { type: String },
    status: { type: String, default: "pending" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Donation", donationSchema);
