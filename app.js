const express = require('express');
const crypto = require('node:crypto');

const app = express();
const port = process.env.PORT || 3000;

function verifySignature(rawBody, receivedSignature, secret) {
  if (!receivedSignature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    service: 'razorpay-webhook-test'
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ success: true });
});

app.post(
  '/webhooks/razorpay',
  express.raw({ type: 'application/json', limit: '2mb' }),
  (req, res) => {
    const receivedAt = new Date().toISOString();
    const signature = req.get('x-razorpay-signature') || '';
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || '');

    console.log('[razorpay-webhook] request received', {
      receivedAt,
      contentType: req.get('content-type'),
      contentLength: rawBody.length,
      hasSignature: Boolean(signature),
      userAgent: req.get('user-agent'),
      forwardedFor: req.get('x-forwarded-for')
    });

    let payload;

    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
      console.error('[razorpay-webhook] invalid JSON', {
        receivedAt,
        error: error.message
      });

      return res.status(400).json({
        success: false,
        error: 'invalid_json'
      });
    }

    const signatureValid = verifySignature(
      rawBody,
      signature,
      process.env.RAZORPAY_WEBHOOK_SECRET
    );

    console.log('[razorpay-webhook] event received', {
      receivedAt,
      signatureValid,
      event: payload?.event || null,
      accountId: payload?.account_id || null,
      paymentId: payload?.payload?.payment?.entity?.id || null,
      orderId:
        payload?.payload?.order?.entity?.id ||
        payload?.payload?.payment?.entity?.order_id ||
        null,
      paymentStatus: payload?.payload?.payment?.entity?.status || null
    });

    if (process.env.LOG_WEBHOOK_BODY === 'true') {
      console.log(
        '[razorpay-webhook] complete payload',
        JSON.stringify(payload, null, 2)
      );
    }

    if (!signatureValid) {
      console.warn('[razorpay-webhook] signature rejected');

      return res.status(401).json({
        success: false,
        error: 'invalid_signature'
      });
    }

    return res.status(200).json({
      success: true,
      event: payload?.event || null
    });
  }
);

app.listen(port, '0.0.0.0', () => {
  console.log(`Webhook test server listening on port ${port}`);
});