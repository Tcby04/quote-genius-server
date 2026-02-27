const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// In-memory storage (resets on restart - OK for now)
let codes = {};

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Stripe webhook
app.post('/webhook', (req, res) => {
  const event = req.body;
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name;
    const sessionId = session.id;
    
    if (customerEmail) {
      // Use session ID as the code (cleaned up)
      const code = sessionId.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
      codes[code] = { 
        created: new Date().toISOString(), 
        used: false,
        email: customerEmail,
        name: customerName,
        stripeSessionId: sessionId
      };
      
      console.log(`New purchase! Code: ${code}, Email: ${customerEmail}`);
    }
  }
  
  res.json({ received: true });
});

// Create unlock code (admin)
app.post('/admin/create-code', (req, res) => {
  const code = generateCode();
  codes[code] = { created: new Date().toISOString(), used: false, manual: true };
  res.json({ code });
});

// Validate code
app.post('/validate', (req, res) => {
  const code = (req.body.code || '').toUpperCase();
  
  // First check exact code match
  if (codes[code] && !codes[code].used) {
    codes[code].used = true;
    codes[code].usedAt = new Date().toISOString();
    return res.json({ valid: true });
  }
  
  // Also check if it's a session ID (first 8 chars)
  for (const [storedCode, data] of Object.entries(codes)) {
    if (data.stripeSessionId && data.stripeSessionId.substring(0, 8).toUpperCase() === code && !data.used) {
      codes[storedCode].used = true;
      codes[storedCode].usedAt = new Date().toISOString();
      return res.json({ valid: true });
    }
  }
  
  res.json({ valid: false });
});

// Get code by Stripe session
app.get('/get-code', (req, res) => {
  const sessionId = req.query.session;
  
  for (const [code, data] of Object.entries(codes)) {
    if (data.stripeSessionId === sessionId) {
      return res.json({ code: code });
    }
  }
  
  res.json({ error: 'not found' });
});

// List codes (admin)
app.get('/admin/codes', (req, res) => {
  res.json(codes);
});

// Listen on Render's assigned port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Quote Genius server running on port ${PORT}`);
});
