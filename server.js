const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
const PORT = 5000;

// ============================================
// CONFIGURATION - CHANGE THESE VALUES
// ============================================
const TWILIO_ACCOUNT_SID = 'AC232fe9ef86fd51105da3e3d4acaef1af';
const TWILIO_AUTH_TOKEN = '62b941533cf4af2b8d76e3b19494911e';
const TWILIO_PHONE_NUMBER = '+18782187370';
const REGISTERED_PHONE_NUMBER = '+919790637955';
// ============================================

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Twilio Client
let twilioClient;
if (TWILIO_ACCOUNT_SID !== 'your_account_sid_here' && TWILIO_AUTH_TOKEN !== 'your_auth_token_here') {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio configured successfully');
} else {
  console.log('⚠️  Twilio not configured. Update credentials in server.js to enable SMS alerts');
}

// In-memory storage for logs
let appLogs = [];

// Track recent alerts to prevent spam (5 minutes cooldown)
const recentAlerts = new Map();
const ALERT_COOLDOWN = 300000;

/**
 * Send SMS alert via Twilio
 */
async function sendAlert(message) {
  if (!twilioClient) {
    console.warn('⚠️  Twilio not configured. Alert message:', message);
    return;
  }

  try {
    const msg = await twilioClient.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: REGISTERED_PHONE_NUMBER
    });
    console.log('✅ SMS Alert sent:', msg.sid);
  } catch (error) {
    console.error('❌ Failed to send SMS alert:', error.message);
  }
}

/**
 * Check if we should send an alert (respects cooldown period)
 */
function shouldSendAlert(alertKey) {
  const lastAlertTime = recentAlerts.get(alertKey);
  const now = Date.now();
  
  if (!lastAlertTime || (now - lastAlertTime) > ALERT_COOLDOWN) {
    recentAlerts.set(alertKey, now);
    return true;
  }
  return false;
}

/**
 * Detect anomalies in app usage
 */
function detectAnomalies(appName, startTime, stopTime) {
  const anomalies = [];
  const lowerAppName = appName.toLowerCase();
  const duration = new Date(stopTime) - new Date(startTime);
  const durationMinutes = duration / (1000 * 60);

  // Detect VPN usage
  const vpnKeywords = ['vpn', 'nordvpn', 'expressvpn', 'protonvpn', 'tunnelbear', 
                       'windscribe', 'surfshark', 'cyberghost', 'hotspot shield'];
  if (vpnKeywords.some(keyword => lowerAppName.includes(keyword))) {
    anomalies.push('VPN_USAGE');
    
    if (shouldSendAlert(`vpn_${appName}`)) {
      sendAlert(`🚨 VPN Usage Detected!\n\nApp: ${appName}\nTime: ${new Date(startTime).toLocaleString()}\nDuration: ${durationMinutes.toFixed(1)} minutes`);
    }
  }

  // Detect social media and entertainment sites
  const distractingSites = {
    'youtube': 'YouTube',
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'twitter': 'Twitter/X',
    'tiktok': 'TikTok',
    'reddit': 'Reddit',
    'netflix': 'Netflix',
    'twitch': 'Twitch',
    'discord': 'Discord',
    'whatsapp': 'WhatsApp',
    'telegram': 'Telegram',
    'snapchat': 'Snapchat'
  };

  for (const [keyword, displayName] of Object.entries(distractingSites)) {
    if (lowerAppName.includes(keyword)) {
      anomalies.push('DISTRACTING_SITE');
      
      if (shouldSendAlert(`site_${keyword}`)) {
        sendAlert(`⚠️ ${displayName} Usage Detected!\n\nApp: ${appName}\nTime: ${new Date(startTime).toLocaleString()}\nDuration: ${durationMinutes.toFixed(1)} minutes`);
      }
      break;
    }
  }

  // Detect tab switching behavior (short duration switches)
  if (durationMinutes < 0.5) {
    anomalies.push('TAB_SWITCH');
  }

  // Detect suspicious browsers/incognito
  const browserKeywords = ['incognito', 'private', 'tor browser'];
  if (browserKeywords.some(keyword => lowerAppName.includes(keyword))) {
    anomalies.push('PRIVATE_BROWSING');
    
    if (shouldSendAlert('private_browsing')) {
      sendAlert(`🔒 Private Browsing Detected!\n\nApp: ${appName}\nTime: ${new Date(startTime).toLocaleString()}`);
    }
  }

  // Detect excessive usage (more than 2 hours)
  if (durationMinutes > 120) {
    anomalies.push('EXCESSIVE_USAGE');
  }

  return anomalies.length > 0 ? anomalies.join(', ') : 'None';
}

/**
 * POST /log-usage - Log app usage
 */
app.post('/log-usage', (req, res) => {
  const { appName, startTime, stopTime } = req.body;

  if (!appName || !startTime || !stopTime) {
    return res.status(400).json({ 
      error: 'Missing required fields: appName, startTime, stopTime' 
    });
  }

  const anomaly = detectAnomalies(appName, startTime, stopTime);

  const log = {
    id: Date.now() + Math.random(),
    appName,
    startTime: new Date(startTime).toISOString(),
    stopTime: new Date(stopTime).toISOString(),
    anomaly,
    loggedAt: new Date().toISOString()
  };

  appLogs.push(log);
  console.log('📝 New log entry:', log);

  res.json({ 
    message: 'Log saved successfully', 
    log,
    alertSent: anomaly !== 'None'
  });
});

/**
 * GET /get-logs - Retrieve filtered logs
 */
app.get('/get-logs', (req, res) => {
  const { startTime, stopTime } = req.query;

  if (!startTime || !stopTime) {
    return res.status(400).json({ 
      error: 'Missing required query parameters: startTime, stopTime' 
    });
  }

  const start = new Date(startTime);
  const stop = new Date(stopTime);

  const filteredLogs = appLogs.filter(log => {
    const logStart = new Date(log.startTime);
    return logStart >= start && logStart <= stop;
  });

  res.json(filteredLogs);
});

/**
 * GET /all-logs - Get all logs
 */
app.get('/all-logs', (req, res) => {
  res.json(appLogs);
});

/**
 * DELETE /clear-logs - Clear all logs
 */
app.delete('/clear-logs', (req, res) => {
  const count = appLogs.length;
  appLogs = [];
  recentAlerts.clear();
  res.json({ message: `Cleared ${count} logs` });
});

/**
 * POST /test-alert - Test Twilio SMS
 */
app.post('/test-alert', async (req, res) => {
  try {
    await sendAlert('🧪 Test Alert: Your monitoring system is working correctly!');
    res.json({ message: 'Test alert sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send test alert', details: error.message });
  }
});

/**
 * GET /stats - Get usage statistics
 */
app.get('/stats', (req, res) => {
  const stats = {
    totalLogs: appLogs.length,
    anomalyCount: appLogs.filter(log => log.anomaly !== 'None').length,
    vpnUsage: appLogs.filter(log => log.anomaly.includes('VPN_USAGE')).length,
    tabSwitches: appLogs.filter(log => log.anomaly.includes('TAB_SWITCH')).length,
    distractingSites: appLogs.filter(log => log.anomaly.includes('DISTRACTING_SITE')).length,
    recentAlerts: recentAlerts.size
  };
  res.json(stats);
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    twilioConfigured: !!twilioClient
  });
});

// Start server
app.listen(PORT, () => {
  console.log('=====================================');
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('=====================================');
  console.log(`📱 Twilio configured: ${!!twilioClient}`);
  if (!twilioClient) {
    console.log('');
    console.log('⚠️  TO ENABLE SMS ALERTS:');
    console.log('1. Get Twilio credentials from https://www.twilio.com');
    console.log('2. Update the configuration section at the top of server.js');
    console.log('3. Restart the server');
  }
  console.log('=====================================');
});

