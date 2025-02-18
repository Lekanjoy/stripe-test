require("dotenv").config();
const Airtable = require("airtable");

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

// Function to append data to Airtable
const appendToAirtable = async (data) => {
  try {
    await base("Payments").create([
      {
        fields: {
          "Timestamp": new Date().toLocaleString(),
          "Customer Name": data.customerName,
          "Customer Email": data.customerEmail,
          "Event Name": data.eventName,
          "Items Purchased": data.itemsList,
          "Amount Paid": data.amountPaid,
          "Currency": data.currency,
        },
      },
    ]);
    console.log("✅ Data appended to Airtable!");
  } catch (error) {
    console.error("❌ Error appending to Airtable:", error);
  }
};

// Test data (matching your data structure)
const testData = {
  customerName: "John Doe",
  customerEmail: "john.doe@example.com",
  eventName: "Test Event",
  itemsList: `
    Product A - $10 x 2
    Product B - $15 x 1
  `,
  amountPaid: '35.0',
  currency: "USD",
};

// Run the test
appendToAirtable(testData);