const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const CODES_FILE = path.join(__dirname, 'codes.json');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

function loadCodes() {
  try {
    return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCodes(codes) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
}

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function sendEmail(to, code) {
  // Using Resend for email (free tier available)
  // Or use any SMTP service
  const fetch = require('node-fetch');
  
  const emailHtml = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #ff6b35;">⚡ Quote Genius Pro - Unlock Code</h2>
  <p>Thanks for subscribing! Your unlock code is:</p>
  <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
    ${code}
  </div>
  <p>Enter this code in the Quote Genius app to unlock Pro features:</p>
  <ul>
    <li>Unlimited line items</li>
    <li>Custom logo on quotes</li>
    <li>PDF export</li>
    <li>Remove branding</li>
  </ul>
  <p style="color: #888; font-size: 14px; margin-top: 30px;">
    — The Curtis Tech Team<br>
    <a href="https://tcby04.github.io/quote-genius/" style="color: #ff6b35;">quotegenius.io</a>
  </p>
</body>
</html>
`;
  
  // Send via Resend API (free tier: 3,000 emails/month)
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  
  if (RESEND_API_KEY) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Quote Genius <onboarding@resend.dev>',
        to: to,
        subject: '⚡ Your Quote Genius Pro Unlock Code',
        html: emailHtml
      })
    }).then(r => r.json()).then(d => console.log('Email sent:', d)).catch(e => console.log('Email error:', e));
  } else {
    console.log('No email configured. Code:', code, 'Email:', to);
  }
}

// Stripe webhook
app.post('/webhook', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  // Verify webhook (in production, verify with STRIPE_WEBHOOK_SECRET)
  const event = req.body;
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name;
    
    if (customerEmail) {
      const code = generateCode();
      const codes = loadCodes();
      codes[code] = { 
        created: new Date().toISOString(), 
        used: false,
        email: customerEmail,
        name: customerName,
        stripeSessionId: session.id
      };
      saveCodes(codes);
      
      console.log(`New purchase! Code: ${code}, Email: ${customerEmail}`);
      sendEmail(customerEmail, code);
    }
  }
  
  res.json({ received: true });
});

// Create unlock code (for manual use)
app.post('/admin/create-code', (req, res) => {
  const code = generateCode();
  const codes = loadCodes();
  codes[code] = { created: new Date().toISOString(), used: false, manual: true };
  saveCodes(codes);
  res.json({ code });
});

// Validate code
app.post('/validate', (req, res) => {
  const { code } = req.body;
  const codes = loadCodes();
  
  if (codes[code] && !codes[code].used) {
    codes[code].used = true;
    codes[code].usedAt = new Date().toISOString();
    saveCodes(codes);
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

// List codes (admin)
app.get('/admin/codes', (req, res) => {
  const codes = loadCodes();
  res.json(codes);
});

// Get code by Stripe session
app.get('/get-code', (req, res) => {
  const sessionId = req.query.session;
  const codes = loadCodes();
  
  for (const [code, data] of Object.entries(codes)) {
    if (data.stripeSessionId === sessionId) {
      return res.json({ code: code });
    }
  }
  
  res.json({ error: 'not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Quote Genius server running on port ${PORT}`);
});
