const express = require('express');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const accessToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const graphVersion = process.env.GRAPH_VERSION || 'v23.0';
const defaultRecipient = process.env.TEST_RECIPIENT;

const GRAPH_BASE_URL = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}`;

/**
 * Generic WhatsApp sender
 */
async function sendWhatsAppMessage(payload) {

  const response = await fetch(`${GRAPH_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...payload,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(`WhatsApp API error: ${response.status}`);
    err.details = data;
    throw err;
  }

  return data;
}

/**
 * TEXT MESSAGE
 */
async function sendTextMessage(to, body) {

  return sendWhatsAppMessage({
    to,
    type: "text",
    text: {
      body,
      preview_url: false
    }
  });

}

/**
 * DOCUMENT MESSAGE
 */
async function sendDocumentMessage(to, pdfUrl, filename) {

  return sendWhatsAppMessage({
    to,
    type: "document",
    document: {
      link: pdfUrl,
      filename
    }
  });

}

/**
 * PAYMENT MESSAGE
 */
async function sendPaymentLinkMessage(to, paymentLink) {

  return sendTextMessage(
    to,
    `💳 Pay your estimate using the link below:\n${paymentLink}`
  );

}

/**
 * SEND LATEST ESTIMATE
 * text → pdf → payment link
 */
async function sendLatestEstimate(to, userName) {

  const pdfUrl =
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

  const filename = "estimate_march_2026.pdf";

  const paymentLink =
    "https://rzp.io/rzp/bWvWtihJ";

  await sendTextMessage(
    to,
    `Dear ${userName}, Your latest estimate is ready. Please find the attached PDF.`
  );

  await sendDocumentMessage(to, pdfUrl, filename);

  await sendPaymentLinkMessage(to, paymentLink);

}

/**
 * ESTIMATE LOOKUP TABLE (dummy data)
 */
const estimates = {

  jan: {
    filename: "estimate_jan_2026.pdf",
    paymentLink: "https://rzp.io/rzp/bWvWtihJ"
  },

  feb: {
    filename: "estimate_feb_2026.pdf",
    paymentLink: "https://rzp.io/rzp/bWvWtihJ"
  },

  mar: {
    filename: "estimate_mar_2026.pdf",
    paymentLink: "https://rzp.io/rzp/bWvWtihJ"
  }

};

/**
 * SEND ESTIMATE BY MONTH
 */
async function sendEstimateByMonth(to, month) {

  const estimate = estimates[month];

  if (!estimate) {

    await sendTextMessage(
      to,
      "Sorry, we could not find the estimate for that month."
    );

    return;
  }

  const pdfUrl =
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

  await sendDocumentMessage(
    to,
    pdfUrl,
    estimate.filename
  );

  await sendPaymentLinkMessage(
    to,
    estimate.paymentLink
  );

}

/**
 * PARSE MONTH FROM CUSTOMER MESSAGE
 */
function parseMonth(text) {

  if (!text) return null;

  text = text.toLowerCase();

  const months = [
    "jan","feb","mar","apr","may","jun",
    "jul","aug","sep","oct","nov","dec"
  ];

  for (const month of months) {
    if (text.includes(month)) {
      return month;
    }
  }

  return null;

}

/**
 * WEBHOOK VERIFICATION
 */
app.get('/', (req, res) => {

  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  if (mode === 'subscribe' && token === verifyToken) {

    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);

  }

  return res.sendStatus(403);

});

/**
 * WEBHOOK RECEIVER
 */
app.post('/', async (req, res) => {

  const timestamp =
    new Date().toISOString().replace('T', ' ').slice(0, 19);

  console.log(`\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  res.sendStatus(200);

  try {

    if (req.body.object !== 'whatsapp_business_account') {
      return;
    }

    const entries = req.body.entry || [];

    for (const entry of entries) {

      for (const change of entry.changes || []) {

        if (change.field !== "messages") continue;

        const value = change.value || {};

        for (const message of value.messages || []) {

          if (message.type !== "text") continue;

          const userText = message.text?.body || "";
          const from = message.from;

          console.log("Customer message:", userText);

          const month = parseMonth(userText);

          if (month) {

            await sendEstimateByMonth(from, month);

          } else if (userText.toLowerCase().includes("estimate")) {

            await sendTextMessage(
              from,
              "Please specify a month. Example: estimate jan"
            );

          }

        }

      }

    }

  } catch (err) {

    console.error("Webhook processing error:", err.message);

  }

});

/**
 * SEND TEXT TEST
 */
app.get('/send-text', async (req, res) => {

  try {

    const to = req.query.to || defaultRecipient;
    const body = req.query.body || "Hello from test API";

    const data = await sendTextMessage(to, body);

    res.json(data);

  } catch (err) {

    res.status(500).json({
      message: err.message,
      details: err.details || null
    });

  }

});

/**
 * SEND LATEST ESTIMATE TEST
 */
app.post('/send-latest-estimate', async (req, res) => {

  try {

    const to = req.body.to || defaultRecipient;
    const userName = req.body.user_name || "Customer";

    await sendLatestEstimate(to, userName);

    res.json({
      success: true,
      message: "Latest estimate sent"
    });

  } catch (err) {

    res.status(500).json({
      message: err.message,
      details: err.details || null
    });

  }

});

app.listen(port, () => {

  console.log(`Server running on port ${port}`);

});
