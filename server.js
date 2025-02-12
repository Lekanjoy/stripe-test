const express = require("express");
const Stripe = require("stripe");
const dotenv = require("dotenv");
const cors = require("cors");
const nodemailer = require("nodemailer");

dotenv.config();

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.raw({ type: "application/json" })); // Required for Stripe webhook validation

// New endpoint to get the publishable key
app.get("/config", (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// Create Checkout Session
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

// Retrieve Session Details
app.get("/checkout-session", async (req, res) => {
  const { sessionId } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Extract payment details
    const customerEmail = session.customer_details.email;
    const customerName = session.customer_details.name;
    const amountPaid = session.amount_total / 100; // Convert from cents
    const currency = session.currency.toUpperCase();
    const eventName = session.metadata.eventName;
    const items = JSON.parse(session.metadata.items);

    // Format purchased items list
    let itemsList = items.map(item => `<p><strong>${item.name}</strong> - £${item.price} x ${item.quantity}</p>`).join("");

    // Send email notification
    await sendEmail(customerEmail, customerName, eventName, itemsList, amountPaid, currency);
  }

  res.status(200).send("Webhook received");
});


// Function to Send Email
const sendEmail = async (customerEmail, customerName, eventName, itemsList, amountPaid, currency) => {
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
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
