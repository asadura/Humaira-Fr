// routes/donateRoutes.js
const express = require("express");
const Stripe = require("stripe");

const router = express.Router();

// Load secret key from environment (server .env)
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error("❌ STRIPE_SECRET_KEY not set. Payments will fail.");
}
const stripe = Stripe(stripeSecret);

// Helper: convert dollars (or any major currency units) to cents (smallest currency unit)
function toCents(amount) {
  const n = Number(String(amount).replace(",", "."));
  if (Number.isNaN(n) || !isFinite(n)) return null;
  return Math.round(n * 100);
}

// Helper: validate currency code
function normalizeCurrency(raw) {
  if (!raw) return "usd";
  if (typeof raw !== "string") return null;
  const cur = raw.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(cur)) return null;
  return cur;
}

/**
 * POST /payment-intent (for direct client payment flow)
 */
router.post("/payment-intent", async (req, res) => {
  try {
    const { amount, name = "Anonymous Donor", currency: rawCurrency } = req.body ?? {};
    if (amount == null) return res.status(400).json({ message: "Missing amount in request body" });

    const currency = normalizeCurrency(rawCurrency);
    if (!currency)
      return res
        .status(400)
        .json({ message: "Invalid currency. Use a 3-letter code like 'usd' or 'aud'." });

    const cents = toCents(amount);
    if (!cents || cents <= 0) return res.status(400).json({ message: "Invalid amount" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: cents,
      currency,
      automatic_payment_methods: { enabled: true },
      description: "Donation",
      metadata: { donor_name: name },
    });

    if (!paymentIntent?.client_secret)
      return res.status(500).json({ message: "Payment initialization failed" });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    console.error("Error in /payment-intent:", err);
    if (err?.type === "StripeInvalidRequestError")
      return res.status(400).json({ message: err.message || "Invalid payment request" });

    res.status(500).json({ message: "Payment failed, try again." });
  }
});

/**
 * POST /create-checkout-session
 * Body: { amount, name?, currency?, frequency? }
 * Supports: one-off, weekly, monthly
 */
router.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      amount,
      name = "Anonymous Donor",
      currency: rawCurrency,
      frequency = "one-off",
    } = req.body ?? {};

    if (amount == null)
      return res.status(400).json({ message: "Missing amount in request body" });

    const currency = normalizeCurrency(rawCurrency);
    if (!currency)
      return res
        .status(400)
        .json({ message: "Invalid currency. Use 'usd', 'aud', etc." });

    const cents = toCents(amount);
    if (!cents || cents <= 0)
      return res.status(400).json({ message: "Invalid amount" });

    // client return URLs
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const successUrl = `${clientUrl}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${clientUrl}/cancel`;

    // Default: one-time payment
    let mode = "payment";
    let line_items = [
      {
        price_data: {
          currency,
          product_data: { name: `Donation from ${name}` },
          unit_amount: cents,
        },
        quantity: 1,
      },
    ];

    // ✅ Upgrade to subscription for weekly/monthly
    if (frequency !== "one-off") {
      const interval = frequency === "weekly" ? "week" : "month";
      mode = "subscription";
      line_items = [
        {
          price_data: {
            currency,
            product_data: {
              name: `${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Donation`,
              description: `Recurring ${frequency} donation by ${name}`,
            },
            unit_amount: cents,
            recurring: { interval },
          },
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      payment_method_types: ["card"],
      line_items,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { donor_name: name, frequency },
    });

    if (!session?.url)
      return res.status(500).json({ message: "Failed to create checkout session" });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error in /create-checkout-session:", err);
    if (err?.type === "StripeInvalidRequestError")
      return res.status(400).json({ message: err.message || "Invalid request to Stripe" });

    res.status(500).json({ message: "Could not create checkout session" });
  }
});

/**
 * Webhook handler
 */
const webhookHandler = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = typeof req.body === "object" ? req.body : JSON.parse(req.body);
    }
  } catch (err) {
    console.error("⚠️ Webhook verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object;
        console.log(
          `✅ Checkout session completed: ${session.id}, amount_total: ${session.amount_total} ${session.currency}`
        );
        break;
      case "invoice.payment_succeeded":
        console.log("✅ Subscription payment succeeded:", event.data.object.id);
        break;
      case "invoice.payment_failed":
        console.warn("❌ Subscription payment failed:", event.data.object.id);
        break;
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error("Error handling webhook event:", err);
    return res.status(500).send();
  }

  res.json({ received: true });
};

module.exports = {
  router,
  webhookHandler,
};
