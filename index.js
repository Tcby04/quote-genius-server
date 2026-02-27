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

// Supported products
const PRODUCTS = ['quote-genius', 'linkpage', 'invoice-genius', 'lead-pipe', 'menu-maker', 'pixel-squeeze', 'foodtruckiq'];

// Stripe webhook
app.post('/webhook', (req, res) => {
  const event = req.body;
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name;
    const sessionId = session.id;
    
    // Get product from metadata or line items
    const productId = session.metadata?.product || session.line_items?.data?.[0]?.price?.product || 'unknown';
    const productName = Object.entries(PRODUCTS).find(([k, v]) => v === productId || session.line_items?.data?.[0]?.price?.product === k)?.[1] || productId;
    
    if (customerEmail || sessionId) {
      // Generate unique code from session ID
      let code = sessionId.replace('cs_test_', '').replace('cs_live_', '').substring(0, 8).toUpperCase();
      codes[code] = { 
        created: new Date().toISOString(), 
        used: false,
        email: customerEmail,
        name: customerName,
        stripeSessionId: sessionId,
        product: productId
      };
      
      console.log(`New purchase! Code: ${code}, Email: ${customerEmail}, Product: ${productId}`);
    }
  }
  
  res.json({ received: true });
});

// Create unlock code (admin) - specify product
app.post('/admin/create-code', (req, res) => {
  const { product } = req.body; // 'quote-genius' or 'linkpage'
  const code = generateCode();
  codes[code] = { 
    created: new Date().toISOString(), 
    used: false, 
    manual: true,
    product: product || 'unknown'
  };
  res.json({ code, product });
});

// Validate code - accepts product parameter to scope validation
app.post('/validate', (req, res) => {
  const code = (req.body.code || '').toUpperCase().trim();
  const product = req.body.product; // 'quote-genius' or 'linkpage'
  
  // Check if it's a session ID (cs_test_xxx or cs_live_xxx)
  if (code.startsWith('CS_TEST_') || code.startsWith('CS_LIVE_')) {
    const sessionCode = code.replace('CS_TEST_', '').replace('CS_LIVE_', '').substring(0, 8);
    
    if (codes[sessionCode]) {
      // Check product match if specified
      if (product && codes[sessionCode].product !== product && codes[sessionCode].product !== 'unknown') {
        return res.json({ valid: false, error: 'Code is for different product' });
      }
      
      if (!codes[sessionCode].used) {
        codes[sessionCode].used = true;
        codes[sessionCode].usedAt = new Date().toISOString();
        return res.json({ valid: true });
      }
      return res.json({ valid: false });
    }
    
    // Not found - but accept it anyway for new purchases!
    codes[sessionCode] = {
      created: new Date().toISOString(),
      used: true,
      usedAt: new Date().toISOString(),
      stripeSessionId: code,
      product: product || 'unknown'
    };
    return res.json({ valid: true });
  }
  
  // Check exact code match
  if (codes[code]) {
    // Check product match if specified
    if (product && codes[code].product !== product && codes[code].product !== 'unknown') {
      return res.json({ valid: false, error: 'Code is for different product' });
    }
    
    if (!codes[code].used) {
      codes[code].used = true;
      codes[code].usedAt = new Date().toISOString();
      return res.json({ valid: true });
    }
    return res.json({ valid: false });
  }
  
  // Accept any 6+ char code for demo/testing
  if (code.length >= 6) {
    codes[code] = {
      created: new Date().toISOString(),
      used: true,
      usedAt: new Date().toISOString(),
      manual: true,
      product: product || 'unknown'
    };
    return res.json({ valid: true });
  }
  
  res.json({ valid: false });
});

// Get code by Stripe session
app.get('/get-code', (req, res) => {
  const sessionId = req.query.session;
  const product = req.query.product;
  
  if (!sessionId) {
    return res.json({ error: 'no session' });
  }
  
  // Try to find by session ID prefix
  const sessionPrefix = sessionId.replace('cs_test_', '').replace('cs_live_', '').substring(0, 8).toUpperCase();
  
  for (const [code, data] of Object.entries(codes)) {
    if (data.stripeSessionId && data.stripeSessionId.includes(sessionId.substring(0, 20))) {
      if (product && data.product !== product && data.product !== 'unknown') {
        continue;
      }
      return res.json({ code: code, product: data.product, email: data.email });
    }
  }
  
  // If not found, create one (new purchase)
  const newCode = sessionPrefix;
  codes[newCode] = {
    created: new Date().toISOString(),
    used: false,
    stripeSessionId: sessionId,
    product: product || 'unknown'
  };
  res.json({ code: newCode, product: product });
});

// Get code by exact session match
app.get('/code-by-session', (req, res) => {
  const sessionId = req.query.session_id;
  const product = req.query.product;
  
  for (const [code, data] of Object.entries(codes)) {
    if (data.stripeSessionId === sessionId) {
      if (product && data.product !== product && data.product !== 'unknown') {
        return res.json({ error: 'not found' });
      }
      return res.json({ code: code, product: data.product });
    }
  }
  
  res.json({ error: 'not found' });
});

// List codes (admin)
app.get('/admin/codes', (req, res) => {
  res.json(codes);
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', products: ['quote-genius', 'linkpage'] });
});

// Listen on Render's assigned port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (supports quote-genius + linkpage)`);
});
