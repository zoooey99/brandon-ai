// server.js
import 'dotenv/config';
import express from 'express';
import { execFile } from 'child_process';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { showVisible, truncateForLog as truncateText, decodeAttributedBody } from './lib/text.js';
import { appleToUnix, getChunkDelaySeconds, buildWebhookUrl } from './lib/relay.js';
import { createRequireAuth, createRateLimiter, validateSendRequest } from './lib/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================
const PORT = Number(process.env.PORT) || 8787;
const POLL_MS = parseInt(process.env.POLL_MS || '1500', 10);
const CHAT_DB = process.env.CHAT_DB || `${process.env.HOME}/Library/Messages/chat.db`;
const LOCAL_DB_PATH = process.env.LOCAL_DB_PATH || path.join(__dirname, 'local.db');
const REMOTE_SERVER_URL = process.env.REMOTE_SERVER_URL;
const REMOTE_SERVER_APIKEY = process.env.REMOTE_SERVER_APIKEY;
const MAC_SERVER_APIKEY = process.env.MAC_SERVER_APIKEY;
const INTER_CHUNK_DELAY_SECONDS = parseFloat(process.env.INTER_CHUNK_DELAY_SECONDS || '0.7');
const PLACEHOLDER_TEXT = process.env.PLACEHOLDER_TEXT || '...';
const ENABLE_VERBOSE_LOGGING = process.env.ENABLE_VERBOSE_LOGGING === 'true';

// Database cleanup configuration
const DB_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PROCESSED_MSG_RETENTION_DAYS = 30;

// AppleScript paths
const TYPING_SCRIPT = process.env.TYPING_SCRIPT || path.join(__dirname, 'typing.scpt');
const CLEAR_INPUT_SCRIPT = process.env.CLEAR_INPUT_SCRIPT || path.join(__dirname, 'Clear_input.scpt');
const SEND_SCRIPT = process.env.SEND_SCRIPT || path.join(__dirname, 'send_imessage.scpt');

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================
const chatDb = new Database(CHAT_DB, { readonly: true, fileMustExist: true });
const localDb = new Database(LOCAL_DB_PATH);

localDb.exec(`
  CREATE TABLE IF NOT EXISTS processed_messages (
    message_id INTEGER PRIMARY KEY,
    phone_number TEXT NOT NULL,
    processed_at REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_processed_phone ON processed_messages(phone_number);
`);

// ============================================================================
// IN-MEMORY STATE
// ============================================================================
let currentlyTypingFor = null;     // Phone number we're showing typing for
const typingQueue = [];            // Phone numbers waiting for typing indicator

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function getCurrentTimestamp() {
  return Date.now() / 1000;
}

function truncateForLog(text, maxLength = 50) {
  return truncateText(text, maxLength, ENABLE_VERBOSE_LOGGING);
}

// ============================================================================
// APPLESCRIPT EXECUTION
// ============================================================================
async function runTypingScript(phoneNumber, placeholderText) {
  return new Promise((resolve, reject) => {
    console.log(`[TYPING] Starting typing indicator for ${phoneNumber}`);
    execFile('osascript', [TYPING_SCRIPT, phoneNumber, placeholderText], { timeout: 15000 }, (err) => {
      if (err) {
        console.error(`[TYPING ERROR] Failed for ${phoneNumber}:`, err.message);
        return reject(err);
      }
      console.log(`[TYPING] Successfully started for ${phoneNumber}`);
      resolve({ ok: true });
    });
  });
}

async function runClearInputScript() {
  return new Promise((resolve, reject) => {
    console.log(`[CLEAR] Clearing input field`);
    execFile('osascript', [CLEAR_INPUT_SCRIPT], { timeout: 15000 }, (err) => {
      if (err) {
        console.error(`[CLEAR ERROR] Failed:`, err.message);
        return reject(err);
      }
      console.log(`[CLEAR] Successfully cleared input`);
      resolve({ ok: true });
    });
  });
}

async function runSendScript(phoneNumber, text) {
  return new Promise((resolve, reject) => {
    console.log(`[SEND] Sending to ${phoneNumber}: "${showVisible(truncateForLog(text))}" (len=${text.length})`);
    execFile('osascript', [SEND_SCRIPT, phoneNumber, text], { timeout: 15000 }, (err) => {
      if (err) {
        console.error(`[SEND ERROR] Failed for ${phoneNumber}:`, err.message);
        return reject(err);
      }
      console.log(`[SEND] Successfully sent to ${phoneNumber}`);
      resolve({ ok: true });
    });
  });
}

// ============================================================================
// TYPING QUEUE MANAGEMENT
// ============================================================================
function addToTypingQueue(phoneNumber) {
  if (!typingQueue.includes(phoneNumber)) {
    typingQueue.push(phoneNumber);
    console.log(`[TYPING QUEUE] Added ${phoneNumber}. Queue: [${typingQueue.join(', ')}]`);
  }
}

function removeFromTypingQueue(phoneNumber) {
  const idx = typingQueue.indexOf(phoneNumber);
  if (idx !== -1) {
    typingQueue.splice(idx, 1);
    console.log(`[TYPING QUEUE] Removed ${phoneNumber}. Queue: [${typingQueue.join(', ')}]`);
  }
}

async function startTypingForNext() {
  if (typingQueue.length === 0) {
    currentlyTypingFor = null;
    return;
  }

  const nextPhone = typingQueue[0];

  // Already typing for this person
  if (currentlyTypingFor === nextPhone) return;

  try {
    await runTypingScript(nextPhone, PLACEHOLDER_TEXT);
    currentlyTypingFor = nextPhone;
    console.log(`[TYPING QUEUE] Now typing for ${nextPhone}`);
  } catch (error) {
    console.error(`[TYPING QUEUE] Failed to start typing for ${nextPhone}:`, error.message);
    // Remove failed phone and try next
    removeFromTypingQueue(nextPhone);
    currentlyTypingFor = null;
    await startTypingForNext();
  }
}

// ============================================================================
// SEND MESSAGES (for a single response)
// ============================================================================
async function sendMessagesToUser(phoneNumber, messages) {
  console.log(`[SEND] Sending ${messages.length} chunk(s) to ${phoneNumber}`);

  // Clear typing input before sending first chunk
  try {
    await runClearInputScript();
  } catch (e) {
    console.error(`[SEND] Failed to clear input:`, e.message);
  }

  for (let i = 0; i < messages.length; i++) {
    const chunk = messages[i];
    const text = chunk.text || '';

    if (!text) continue;

    // Wait between chunks (not before the first one)
    const delay = getChunkDelaySeconds(chunk, i, INTER_CHUNK_DELAY_SECONDS);
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }

    try {
      await runSendScript(phoneNumber, text);
    } catch (error) {
      console.error(`[SEND ERROR] Failed chunk ${i} for ${phoneNumber}:`, error.message);
    }
  }

  console.log(`[SEND] Finished sending to ${phoneNumber}`);
}

// ============================================================================
// BACKEND COMMUNICATION
// ============================================================================
async function sendToBackend(phoneNumber, message) {
  if (!REMOTE_SERVER_URL) {
    console.log(`[BACKEND] No REMOTE_SERVER_URL configured, logging message from ${phoneNumber}: "${truncateForLog(message.text)}"`);
    return;
  }

  const webhookUrl = buildWebhookUrl(REMOTE_SERVER_URL);

  const timestampISO = new Date(message.timestamp_unix * 1000).toISOString();

  const payload = {
    phone_number: phoneNumber,
    messages: [{
      text: String(message.text || ''),
      timestamp: timestampISO
    }]
  };

  console.log(`[BACKEND] Forwarding message from ${phoneNumber}: "${truncateForLog(message.text)}"`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (REMOTE_SERVER_APIKEY) {
      headers['Authorization'] = `Bearer ${REMOTE_SERVER_APIKEY}`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetails = '';
      try { errorDetails = await response.text(); } catch (e) { errorDetails = response.statusText; }
      console.error(`[BACKEND ERROR] ${response.status}: ${errorDetails}`);
      return;
    }

    console.log(`[BACKEND] Message forwarded successfully for ${phoneNumber}`);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[BACKEND ERROR] Request timed out for ${phoneNumber}`);
    } else {
      console.error(`[BACKEND ERROR] ${error.message}`);
    }
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ============================================================================
// MIDDLEWARE (see lib/middleware.js)
// ============================================================================
const RATE_LIMIT_MAX_REQUESTS = 10;

const requireAuth = createRequireAuth(MAC_SERVER_APIKEY);
const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: RATE_LIMIT_MAX_REQUESTS });

// ============================================================================
// EXPRESS API
// ============================================================================

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'operational' });
});

app.get('/status', requireAuth, (_req, res) => {
  res.json({
    ok: true,
    currently_typing_for: currentlyTypingFor,
    typing_queue: [...typingQueue],
    typing_queue_length: typingQueue.length
  });
});

// POST /api/send - Backend sends response here when agent is done
app.post('/api/send', rateLimiter, requireAuth, validateSendRequest, async (req, res) => {
  try {
    const { reply_type, phone_number, messages } = req.body;

    console.log(`[API SEND] Response for ${phone_number}: reply_type=${reply_type}, chunks=${messages?.length || 0}`);

    if (reply_type === 'no_reply') {
      // Remove from typing queue, no response needed
      removeFromTypingQueue(phone_number);
      if (currentlyTypingFor === phone_number) {
        currentlyTypingFor = null;
        await startTypingForNext();
      }
      return res.json({ ok: true, message: 'No reply' });
    }

    if (!messages || messages.length === 0) {
      return res.json({ ok: true, message: 'No messages to send' });
    }

    // Interrupt whatever typing is happening and send immediately
    removeFromTypingQueue(phone_number);

    // Send the messages
    await sendMessagesToUser(phone_number, messages);

    // Clear typing state
    currentlyTypingFor = null;

    // Resume typing for next user in queue (if any)
    await startTypingForNext();

    res.json({ ok: true, message: `Sent ${messages.length} chunk(s) to ${phone_number}` });
  } catch (error) {
    console.error('[API SEND ERROR]:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CHAT.DB POLLING
// ============================================================================
const maxRow = chatDb.prepare('SELECT MAX(ROWID) AS maxId FROM message').get();
let lastRowId = maxRow?.maxId || 0;

const pollStmt = chatDb.prepare(`
  SELECT
    m.ROWID                   AS message_id,
    m.text                    AS text,
    m.attributedBody          AS attributed_body,
    m.is_from_me              AS is_from_me,
    m.date                    AS date_raw,
    m.associated_message_type AS assoc_type,
    m.associated_message_guid AS assoc_guid,
    m.service                 AS service,
    m.cache_has_attachments   AS has_attachments,
    h.id                      AS handle,
    c.guid                    AS chat_guid
  FROM message m
  JOIN handle h ON m.handle_id = h.ROWID
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id
  WHERE m.ROWID > ?
  ORDER BY m.ROWID ASC;
`);

async function tick() {
  try {
    const rows = pollStmt.all(lastRowId);

    for (const r of rows) {
      lastRowId = Math.max(lastRowId, r.message_id);

      // Only process incoming messages
      if (r.is_from_me !== 0) continue;

      // Extract message text
      const plain = typeof r.text === 'string' ? r.text : '';
      let bodyText = plain;

      if (!plain || !/\S/u.test(plain)) {
        bodyText = decodeAttributedBody(r.attributed_body);
      }

      // Skip empty messages and reactions
      if ((!bodyText || !/\S/u.test(bodyText)) && !r.has_attachments) {
        if (r.assoc_type && r.assoc_type !== 0) continue; // reaction/tapback
        continue; // empty message
      }

      // Only process iMessage conversations with phone numbers
      if (!r.chat_guid || !r.chat_guid.startsWith("iMessage;-;+")) continue;

      const phoneNumber = r.handle || r.chat_guid.replace("iMessage;-;", "");
      const timestamp = appleToUnix(r.date_raw);

      // Check if already processed
      const alreadyProcessed = localDb.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?').get(r.message_id);
      if (alreadyProcessed) continue;

      console.log(`[POLL] New message from ${phoneNumber} - ID: ${r.message_id}, preview="${showVisible(truncateForLog(bodyText))}"`);

      // Mark as processed immediately
      localDb.prepare('INSERT OR IGNORE INTO processed_messages (message_id, phone_number, processed_at) VALUES (?, ?, ?)').run(r.message_id, phoneNumber, getCurrentTimestamp());

      // 1. Start typing immediately for this user
      addToTypingQueue(phoneNumber);
      // Don't await - start typing in the background so we can forward quickly
      startTypingForNext().catch(err => console.error('[TYPING ERROR]', err.message));

      // 2. Forward to backend immediately (fire-and-forget)
      sendToBackend(phoneNumber, {
        text: bodyText,
        timestamp_unix: timestamp,
        message_id: r.message_id
      }).catch(err => console.error('[BACKEND ERROR]', err.message));
    }
  } catch (e) {
    console.error('[POLL ERROR]:', e);
  } finally {
    setTimeout(tick, POLL_MS);
  }
}

// ============================================================================
// DATABASE CLEANUP
// ============================================================================
function cleanupDatabase() {
  const now = getCurrentTimestamp();
  const msgCutoff = now - (PROCESSED_MSG_RETENTION_DAYS * 24 * 60 * 60);

  try {
    const result = localDb.prepare('DELETE FROM processed_messages WHERE processed_at < ?').run(msgCutoff);
    console.log(`[CLEANUP] Deleted ${result.changes} processed message records (older than ${PROCESSED_MSG_RETENTION_DAYS} days)`);
    localDb.exec('VACUUM');
  } catch (error) {
    console.error(`[CLEANUP ERROR]`, error.message);
  }
}

function startCleanupScheduler() {
  cleanupDatabase();
  setInterval(cleanupDatabase, DB_CLEANUP_INTERVAL_MS);
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

  try { chatDb.close(); console.log('[SHUTDOWN] Closed chat.db'); }
  catch (err) { console.error('[SHUTDOWN ERROR]', err.message); }

  try { localDb.close(); console.log('[SHUTDOWN] Closed local.db'); }
  catch (err) { console.error('[SHUTDOWN ERROR]', err.message); }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// MAIN STARTUP
// ============================================================================
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`iMessage Relay Server (Simplified)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Server:          http://localhost:${PORT}`);
  console.log(`Chat DB:         ${CHAT_DB}`);
  console.log(`Local DB:        ${LOCAL_DB_PATH}`);
  console.log(`Remote Server:   ${REMOTE_SERVER_URL || 'NOT CONFIGURED'}`);
  console.log(`\nSecurity:`);
  console.log(`  Authentication:    ${MAC_SERVER_APIKEY ? 'ENABLED' : 'DISABLED (WARNING!)'}`);
  console.log(`  Rate Limiting:     ${RATE_LIMIT_MAX_REQUESTS} req/min`);
  console.log(`  Verbose Logging:   ${ENABLE_VERBOSE_LOGGING ? 'ENABLED' : 'DISABLED'}`);
  console.log(`\nConfiguration:`);
  console.log(`  Inter-chunk Delay: ${INTER_CHUNK_DELAY_SECONDS}s`);
  console.log(`  Poll Interval:     ${POLL_MS}ms`);
  console.log(`  Placeholder:       "${PLACEHOLDER_TEXT}"`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health     - Health check`);
  console.log(`  GET  /status     - Server status (auth required)`);
  console.log(`  POST /api/send   - Backend sends responses here (auth required)`);
  console.log(`${'='.repeat(60)}\n`);

  if (!MAC_SERVER_APIKEY) {
    console.warn(`[WARNING] MAC_SERVER_APIKEY not set - endpoints are unprotected!\n`);
  }

  console.log('[STARTUP] Starting chat.db poller...');
  tick();

  console.log('[STARTUP] Starting database cleanup scheduler...');
  startCleanupScheduler();

  console.log('[STARTUP] Ready!\n');
});
