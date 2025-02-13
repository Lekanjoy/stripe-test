const express = require("express");
const Stripe = require("stripe");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Apply JSON middleware globally (except for the webhook route)
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") {
    next(); // Skip JSON parsing for the webhook route
  } else {
    express.json()(req, res, next); // Apply JSON parsing for all other routes
  }
});

// Webhook route
app.post(
  "/webhook",
  express.raw({ type: "application/json" }), // Use raw middleware for webhook
  async (request, response) => {
    const sig = request.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`, err.message);
      return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Extract payment details
      const customerEmail =
        session.customer_details?.email || "No Email Provided";
      const customerName = session.customer_details?.name || "No Name Provided";
      const amountPaid = ((session.amount_total || 0) / 100).toFixed(2); // Convert from cents
      const currency = (session.currency || "usd").toUpperCase();
      const eventName = session.metadata?.eventName || "Unknown Event";
      const items = session.metadata?.items
        ? JSON.parse(session.metadata.items)
        : [];

      // Format purchased items list
      const itemsList = items
        .map(
          (item) => `
${item.name} - ${currency}${item.price} x ${item.quantity}
`
        )
        .join("");

      console.log(
        `📨 Sending email for event: ${eventName}, Customer: ${customerEmail}`
      );

      // Send email notification
      try {
        await sendEmail(
          customerEmail,
          customerName,
          eventName,
          itemsList,
          amountPaid,
          currency
        );
      } catch (error) {
        console.error("Failed to send email:", error);
      }
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
  }
);

// ✅ Get Stripe Publishable Key
app.get("/config", (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// ✅ Create Checkout Session
app.post("/create-checkout-session", async (req, res) => {
  const { items, eventName } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: items.map((item) => ({
        price_data: {
          currency: "gbp",
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel.html`,
      metadata: {
        eventName: eventName, // Store event name
        items: JSON.stringify(items), // Store items as JSON
      },
    });

    res.json({ id: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Retrieve Session Details
app.get("/checkout-session", async (req, res) => {
  const { sessionId } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Function to Send Email
const sendEmail = async (
  customerEmail,
  customerName,
  eventName,
  itemsList,
  amountPaid,
  currency
) => {
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: `New Payment for ${eventName}`,
    html: `
      <h2>Payment Confirmation</h2>
      <p><strong>Event:</strong> ${eventName}</p>
      <p><strong>Name:</strong> ${customerName}</p>
      <p><strong>Email:</strong> ${customerEmail}</p>
      <p><strong>Items Purchased:</strong></p>
      ${itemsList}
      <p><strong>Total Paid:</strong> £${amountPaid} ${currency}</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully!");
  } catch (error) {
    console.error("❌ Error sending email:", error);
  }
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
