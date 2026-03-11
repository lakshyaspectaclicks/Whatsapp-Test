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
 * Generic helper for POST /messages
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
 * 1) Send text message
 * Official shape: type=text, text={ body, preview_url }
 */
async function sendTextMessage(to, body, replyMessageId) {
  const payload = {
    to,
    type: 'text',
    text: {
      body,
      preview_url: false,
    },
  };

  if (replyMessageId) {
    payload.context = { message_id: replyMessageId };
  }

  return sendWhatsAppMessage(payload);
}

/**
 * 2) Send image message
 * Official shape allows a Meta-hosted media id OR external link
 */
async function sendImageMessageByLink(to, imageUrl, caption) {
  return sendWhatsAppMessage({
    to,
    type: 'image',
    image: {
      link: imageUrl,
      caption,
    },
  });
}

/**
 * 3) Send interactive reply buttons
 * Official interactive type: button
 * Up to 3 reply buttons
 */
async function sendReplyButtons(to) {
  return sendWhatsAppMessage({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: 'Choose an option',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'LANG_EN',
              title: 'English',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'LANG_HI',
              title: 'Hindi',
            },
          },
        ],
      },
    },
  });
}

/**
 * 4) Send approved template message
 * Template must already exist, be approved, and enabled
 */
async function sendTemplateMessage(to, templateName, languageCode, bodyTextParam) {
  return sendWhatsAppMessage({
    to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        policy: 'deterministic',
        code: languageCode,
      },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: bodyTextParam,
            },
          ],
        },
      ],
    },
  });
}

/**
 * 5) Mark a message as read
 * Official capability: mark message as read
 */
async function markMessageAsRead(messageId) {
  return sendWhatsAppMessage({
    status: 'read',
    message_id: messageId,
  });
}

/**
 * GET webhook verification
 */
app.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/**
 * POST webhook receiver
 */
app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  console.log(`\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  // Acknowledge quickly
  res.sendStatus(200);

  try {
    if (req.body.object !== 'whatsapp_business_account') {
      return;
    }

    const entries = req.body.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value || {};

        // Incoming user messages
        for (const message of value.messages || []) {
          console.log('Incoming message type:', message.type);
          console.log('Incoming message id:', message.id);
          console.log('From:', message.from);

          // Optional: mark inbound message as read
          await markMessageAsRead(message.id);

          if (message.type === 'text') {
            const userText = message.text?.body || '';
            console.log('User text:', userText);

            if (userText.toLowerCase() === 'hi') {
              await sendTextMessage(message.from, 'Hello from your test Node app');
            } else if (userText.toLowerCase() === 'buttons') {
              await sendReplyButtons(message.from);
            } else if (userText.toLowerCase() === 'image') {
              await sendImageMessageByLink(
                message.from,
                'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg',
                'Sample image'
              );
            } else if (userText.toLowerCase() === 'template') {
              // Replace hello_world with your approved template if needed
              await sendTemplateMessage(message.from, 'hello_world', 'en_US', 'demo');
            } else {
              await sendTextMessage(
                message.from,
                'Send: hi, buttons, image, or template'
              );
            }
          }

          // Interactive button replies
          if (message.type === 'interactive') {
            const buttonReply = message.interactive?.button_reply;
            const listReply = message.interactive?.list_reply;

            if (buttonReply) {
              console.log('Button reply id:', buttonReply.id);
              console.log('Button reply title:', buttonReply.title);

              await sendTextMessage(
                message.from,
                `You clicked ${buttonReply.title} (${buttonReply.id})`
              );
            }

            if (listReply) {
              console.log('List reply id:', listReply.id);
              console.log('List reply title:', listReply.title);

              await sendTextMessage(
                message.from,
                `You selected ${listReply.title} (${listReply.id})`
              );
            }
          }
        }

        // Delivery / read / failed statuses
        for (const status of value.statuses || []) {
          console.log('Status event:', {
            id: status.id,
            status: status.status,
            recipient_id: status.recipient_id,
            timestamp: status.timestamp,
          });
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    if (err.details) {
      console.error(JSON.stringify(err.details, null, 2));
    }
  }
});

/**
 * Simple test endpoints so you can trigger sends from browser/Postman
 */
app.get('/send-text', async (req, res) => {
  try {
    const to = req.query.to || defaultRecipient;
    const body = req.query.body || 'Hello from /send-text';
    const data = await sendTextMessage(to, body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message, details: err.details || null });
  }
});

app.get('/send-image', async (req, res) => {
  try {
    const to = req.query.to || defaultRecipient;
    const data = await sendImageMessageByLink(
      to,
      'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg',
      'Sample image from test app'
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message, details: err.details || null });
  }
});

app.get('/send-buttons', async (req, res) => {
  try {
    const to = req.query.to || defaultRecipient;
    const data = await sendReplyButtons(to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message, details: err.details || null });
  }
});

app.get('/send-template', async (req, res) => {
  try {
    const to = req.query.to || defaultRecipient;
    const templateName = req.query.name || 'hello_world';
    const lang = req.query.lang || 'en_US';
    const bodyParam = req.query.param || 'demo';

    const data = await sendTemplateMessage(to, templateName, lang, bodyParam);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message, details: err.details || null });
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
