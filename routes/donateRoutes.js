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

// Helper: convert dollars to cents (accepts numbers or numeric strings)
function toCents(amount) {
  const n = Number(amount);
  if (Number.isNaN(n) || !isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * POST /payment-intent
 * Body: { amount: <dollars as number or string>, name?: string, currency?: "usd" }
 * Response: { clientSecret, paymentIntentId }
 */
router.post("/payment-intent", async (req, res) => {
  try {
    const { amount, name = "Anonymous Donor", currency = "usd" } = req.body ?? {};

    if (amount == null) {
      return res.status(400).json({ message: "Missing amount in request body" });
    }

    const cents = toCents(amount);
    if (!cents || cents <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // Create PaymentIntent — use automatic payment methods
    const paymentIntent = await stripe.paymentIntents.create({
      amount: cents,
      currency,
      automatic_payment_methods: { enabled: true },
      description: "Donation",
      metadata: { donor_name: name },
    });

    if (!paymentIntent || !paymentIntent.client_secret) {
      console.error("Stripe created PaymentIntent but missing client_secret:", paymentIntent);
      return res.status(500).json({ message: "Payment initialization failed" });
    }

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    console.error("Error in /payment-intent:", err && (err.raw || err.message) ? (err.raw || err.message) : err);
    return res.status(500).json({ message: "Payment failed, try again." });
  }
});

/**
 * POST /create-checkout-session
 * Body: { amount: <dollars>, name?: string, currency?: "usd" }
 * Response: { url: <stripe checkout url> }
 *
 * Redirect flow to Stripe Checkout (recommended for a simple redirect UI).
 */
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, name = "Anonymous Donor", currency = "usd" } = req.body ?? {};

    if (amount == null) return res.status(400).json({ message: "Missing amount" });

    const cents = toCents(amount);
    if (!cents || cents <= 0) return res.status(400).json({ message: "Invalid amount" });

    // client return URLs (use environment variable CLIENT_URL, fallback)
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const successUrl = `${clientUrl}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${clientUrl}/cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: `Donation from ${name}` },
            unit_amount: cents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { donor_name: name },
    });

    if (!session || !session.url) {
      console.error("Stripe Checkout session creation returned unexpected:", session);
      return res.status(500).json({ message: "Failed to create checkout session" });
    }

    return res.json({ url: session.url });
  } catch (err) {
    console.error("Error in /create-checkout-session:", err && (err.raw || err.message) ? (err.raw || err.message) : err);
    return res.status(500).json({ message: "Could not create checkout session" });
  }
});

/**
 * Webhook handler (exported separately)
 * Mount with:
 * app.post("/api/donate/webhook", express.raw({ type: "application/json" }), donationWebhookHandler);
 */
const webhookHandler = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("⚠️ STRIPE_WEBHOOK_SECRET not set — cannot verify webhook signature.");
  }

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // only for dev without webhook secret
      event = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body);
    }
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err && err.message ? err.message : err);
    return res.status(400).send(`Webhook Error: ${err && err.message ? err.message : "invalid signature"}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log(`✅ Checkout session completed: ${session.id}, amount_total: ${session.amount_total}`);
        // TODO: store session info, send receipts, etc.
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log(`✅ PaymentIntent succeeded: ${pi.id} (${pi.amount} ${pi.currency})`);
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        console.warn(`❌ PaymentIntent failed: ${pi.id}`);
        break;
      }
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
