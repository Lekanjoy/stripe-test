const express = require("express");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const cors = require("cors");
const Airtable = require("airtable");

dotenv.config();

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

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
      const customerPhone =
        session.customer_details?.phone || "No Phone Provided";
      const amountPaid = ((session.amount_total || 0) / 100).toFixed(2); // Convert from cents
      const currency = (session.currency || "usd").toUpperCase();
      const eventName = session.metadata?.eventName || "Unknown Event";
      const items = session.metadata?.items
        ? JSON.parse(session.metadata.items)
        : [];

      // Format purchased items list
      const itemsList = items
        .map(
          (item) =>
            ` — ${item.name} (${item.price.toFixed(2)} ${currency} x ${
              item.quantity
            }) <br>`
        )
        .join("");

      console.log(
        `📨 Sending email for event: ${eventName}, Customer: ${customerEmail}`
      );

      // Send email notification and append data to airtable
      try {
        // Run sendEmail and appendToAirtable simultaneously
        await Promise.all([
          sendEmail(
            customerEmail,
            customerPhone,
            customerName,
            eventName,
            itemsList,
            amountPaid,
            currency
          ),
          appendToAirtable({
            customerName,
            customerEmail,
            customerPhone,
            eventName,
            itemsList,
            amountPaid,
            currency,
          }),
        ]);
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
      phone_number_collection: {
        enabled: true,
      },
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
  customerPhone,
  customerName,
  eventName,
  itemsList,
  amountPaid,
  currency
) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: customerEmail,
    bcc: process.env.EMAIL_USER,
    subject: `New Payment for ${eventName}`,
    html: `
    <div style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
  <a href="https://gohangers.com style="display: block; width: 100%; text-align: center; padding: 8px; margin-bottom: 20px; background-color: #ffffff;">
    <img src="https://gohangers.com/assets/Home/GOHANGERS_Logotype-strap.png" alt="Gohangers Logo" style="width: 100px; height: auto;">
  </a>
  <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
    <h2 style="color: #333333; margin-bottom: 20px;">Payment Confirmation</h2>
    <p style="color: #555555; font-size: 14px; margin-bottom: 10px;">
      <strong style="color: #333333;">Event:</strong> ${eventName}
    </p>
    <p style="color: #555555; font-size: 14px; margin-bottom: 10px;">
      <strong style="color: #333333;">Name:</strong> ${customerName}
    </p>
    <p style="color: #555555; font-size: 14px; margin-bottom: 10px;">
      <strong style="color: #333333;">Email:</strong> ${customerEmail}
    </p>
    <p style="color: #555555; font-size: 14px; margin-bottom: 10px;">
      <strong style="color: #333333;">Phone Number:</strong> ${customerPhone}
    </p>
    <p style="color: #555555; font-size: 14px; margin-bottom: 10px;">
      <strong style="color: #333333;">Select Product:</strong>
    </p>
    <div style="color: #555555; font-size: 14px; margin-bottom: 20px;">
      ${itemsList}
    </div>
    <p style="color: #555555; font-size: 14px; margin-bottom: 10px;">
      <strong style="color: #333333;">Total Paid:</strong> ${amountPaid} ${currency}
    </p>
  </div>
</div>
  `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: ", info.response);
  } catch (error) {
    console.error("Error occurred while sending email: ", error);
  }
};

// Send Payment Details to Airtable
const appendToAirtable = async (data) => {
  try {
    await base("Payments").create([
      {
        fields: {
          Timestamp: new Date().toLocaleString(),
          "Customer Name": data.customerName,
          "Customer Email": data.customerEmail,
          "Phone Number": data.customerPhone,
          "Event Name": data.eventName,
          "Amount Paid": data.amountPaid,
          "Items Purchased": data.itemsList,
          Currency: data.currency,
        },
      },
    ]);
    console.log("✅ Data appended to Airtable!");
  } catch (error) {
    console.error("❌ Error appending to Airtable:", error);
  }
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
