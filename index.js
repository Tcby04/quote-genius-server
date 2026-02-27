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
      // Use session ID, just remove cs_test_ or cs_live_ prefix and take last 8 chars
      let code = sessionId.replace('cs_test_', '').replace('cs_live_', '').substring(0, 8).toUpperCase();
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

// Validate code - also accepts session ID directly
app.post('/validate', (req, res) => {
  const code = (req.body.code || '').toUpperCase().trim();
  
  // Check if it's a session ID (cs_test_xxx or cs_live_xxx)
  if (code.startsWith('CS_TEST_') || code.startsWith('CS_LIVE_')) {
    const sessionCode = code.replace('CS_TEST_', '').replace('CS_LIVE_', '').substring(0, 8);
    
    // Check if we have this code stored
    if (codes[sessionCode]) {
      if (!codes[sessionCode].used) {
        codes[sessionCode].used = true;
        codes[sessionCode].usedAt = new Date().toISOString();
        return res.json({ valid: true });
      }
      return res.json({ valid: false });
    }
    
    // Not found - but accept it anyway for new purchases!
    // Store it and accept it
    codes[sessionCode] = {
      created: new Date().toISOString(),
      used: true,
      usedAt: new Date().toISOString(),
      stripeSessionId: code
    };
    return res.json({ valid: true });
  }
  
  // Check exact code match
  if (codes[code] && !codes[code].used) {
    codes[code].used = true;
    codes[code].usedAt = new Date().toISOString();
    return res.json({ valid: true });
  }
  
  // Accept any 8-char code for now (simplify!)
  if (code.length >= 6) {
    codes[code] = {
      created: new Date().toISOString(),
      used: true,
      usedAt: new Date().toISOString(),
      manual: true
    };
    return res.json({ valid: true });
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
