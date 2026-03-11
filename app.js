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
    type: 'text',
    text: {
      body,
      preview_url: false
    }
  });
}

/**
 * TEMPLATE MESSAGE
 * testing_alert
 */
async function sendTestingAlertTemplate(to, userName) {

  return sendWhatsAppMessage({
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: "testing_alert",
      language: {
        code: "en"
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              parameter_name: "user_name",
              text: userName
            }
          ]
        }
      ]
    }
  });
}

/**
 * DOCUMENT MESSAGE (PDF)
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
 * PAYMENT LINK MESSAGE
 */
async function sendPaymentLinkMessage(to, paymentLink) {

  return sendTextMessage(
    to,
    `💳 Pay your estimate using the link below:\n${paymentLink}`
  );

}

/**
 * SEND LATEST ESTIMATE FLOW
 *
 * template → pdf → payment link
 */
async function sendLatestEstimate(to, userName) {

  const pdfUrl =
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

  const filename = "estimate_march_2026.pdf";

  const paymentLink =
    "https://payments.example.com/pay/EST2026MAR";

  await sendTestingAlertTemplate(to, userName);

  await sendDocumentMessage(to, pdfUrl, filename);

  await sendPaymentLinkMessage(to, paymentLink);

}

/**
 * SEND ESTIMATE BY MONTH
 */
async function sendEstimateByMonth(to, userName, month) {

  const estimates = {

    jan: {
      filename: "estimate_jan_2026.pdf",
      paymentLink: "https://payments.example.com/pay/EST2026JAN"
    },

    feb: {
      filename: "estimate_feb_2026.pdf",
      paymentLink: "https://payments.example.com/pay/EST2026FEB"
    },

    mar: {
      filename: "estimate_mar_2026.pdf",
      paymentLink: "https://payments.example.com/pay/EST2026MAR"
    }

  };

  const estimate = estimates[month.toLowerCase()];

  if (!estimate) {
    throw new Error("Estimate for requested month not found");
  }

  const pdfUrl =
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

  await sendTestingAlertTemplate(to, userName);

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

});

/**
 * SEND TEXT (kept from previous version)
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
 * SEND LATEST ESTIMATE
 *
 * POST /send-latest-estimate
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

/**
 * SEND ESTIMATE BY MONTH
 *
 * POST /send-estimate
 */
app.post('/send-estimate', async (req, res) => {

  try {

    const to = req.body.to || defaultRecipient;
    const userName = req.body.user_name || "Customer";
    const month = req.body.month;

    if (!month) {
      return res.status(400).json({
        message: "month is required"
      });
    }

    await sendEstimateByMonth(
      to,
      userName,
      month
    );

    res.json({
      success: true,
      message: `Estimate for ${month} sent`
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
