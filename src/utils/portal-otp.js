import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';

const DEFAULT_IMAP_HOST = 'imap.gmail.com';
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_IMAP_SECURE = true;
const DEFAULT_LOOKBACK_MINUTES = 15;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 120000;

const PORTAL_MATCHERS = {
  ALLIANZ: {
    labels: [/allianz/i, /worldwide care/i, /azp/i],
    from: [/allianz/i],
  },
  FULLERTON: {
    labels: [/fullerton/i, /fhn/i, /fhn3/i],
    from: [/fullerton/i, /fhn/i],
  },
  IHP: {
    labels: [/\bihp\b/i, /eclaim/i],
    from: [/\bihp\b/i, /eclaim/i],
  },
  IXCHANGE: {
    labels: [/ixchange/i, /\bspos\b/i, /o2ixchange/i],
    from: [/ixchange/i, /o2ixchange/i],
  },
};

const GENERIC_OTP_REGEXES = [
  /\b(?:otp|one[-\s]?time\s*password|verification\s*code|security\s*code|passcode)\D{0,20}(\d{6})\b/i,
  /\b(?:code|pin)\D{0,12}(\d{6})\b/i,
];

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

function normalizePortal(portal) {
  return String(portal || '')
    .trim()
    .toUpperCase();
}

function buildOtpRegexes(portal) {
  const key = normalizePortal(portal);
  if (key === 'ALLIANZ') {
    return [
      /\b(?:allianz|worldwide\s*care).{0,40}?(?:otp|verification|security|code).{0,20}?(\d{6})\b/i,
      ...GENERIC_OTP_REGEXES,
    ];
  }
  if (key === 'FULLERTON') {
    return [
      /\b(?:fullerton|fhn|2xsecure).{0,40}?(?:otp|verification|security|code).{0,20}?(\d{6})\b/i,
      ...GENERIC_OTP_REGEXES,
    ];
  }
  if (key === 'IHP') {
    return [
      /\b(?:ihp|eclaim).{0,40}?(?:otp|verification|security|code).{0,20}?(\d{6})\b/i,
      ...GENERIC_OTP_REGEXES,
    ];
  }
  if (key === 'IXCHANGE') {
    return [
      /\b(?:ixchange|spos).{0,40}?(?:otp|verification|security|code).{0,20}?(\d{6})\b/i,
      ...GENERIC_OTP_REGEXES,
    ];
  }
  return GENERIC_OTP_REGEXES;
}

function shouldConsiderMessage(portal, envelope, parsed) {
  const key = normalizePortal(portal);
  const matcher = PORTAL_MATCHERS[key];
  if (!matcher) return true;

  const fromText = String(
    envelope?.from?.map(v => `${v.name || ''} ${v.address || ''}`).join(' ') || ''
  ).trim();
  const subject = String(envelope?.subject || parsed?.subject || '').trim();
  const combined = `${subject} ${fromText}`;

  const fromMatch = matcher.from.some(re => re.test(fromText));
  const labelMatch = matcher.labels.some(re => re.test(combined));

  return fromMatch || labelMatch;
}

function extractCodeFromText(text, portal) {
  const body = String(text || '');
  if (!body) return null;

  const regexes = buildOtpRegexes(portal);
  for (const re of regexes) {
    const m = body.match(re);
    if (!m) continue;
    const code = String(m[1] || '').trim();
    if (!/^\d{4,8}$/.test(code)) continue;
    return { code, matchedBy: re.source };
  }
  return null;
}

function getMailConfig() {
  const email = String(process.env.OTP_GMAIL_EMAIL || '').trim();
  const appPassword = String(process.env.OTP_GMAIL_APP_PASSWORD || '').trim();

  return {
    email,
    appPassword,
    host: String(process.env.OTP_GMAIL_IMAP_HOST || DEFAULT_IMAP_HOST).trim() || DEFAULT_IMAP_HOST,
    port: Number(process.env.OTP_GMAIL_IMAP_PORT || DEFAULT_IMAP_PORT),
    secure: toBoolean(process.env.OTP_GMAIL_IMAP_SECURE, DEFAULT_IMAP_SECURE),
    lookbackMinutes: Number(process.env.OTP_GMAIL_LOOKBACK_MINUTES || DEFAULT_LOOKBACK_MINUTES),
    pollIntervalMs: Number(process.env.OTP_GMAIL_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
    timeoutMs: Number(process.env.OTP_GMAIL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

async function readRecentMessages(client, sinceDate) {
  const uids = await client.search({ since: sinceDate }).catch(() => []);
  if (!uids || uids.length === 0) return [];
  const latest = [...uids].sort((a, b) => b - a).slice(0, 40);
  const messages = [];
  for await (const message of client.fetch(latest, {
    uid: true,
    envelope: true,
    internalDate: true,
    source: true,
  })) {
    messages.push(message);
  }
  messages.sort((a, b) => {
    const ta = new Date(a.internalDate || 0).getTime();
    const tb = new Date(b.internalDate || 0).getTime();
    return tb - ta;
  });
  return messages;
}

export async function getOtpCode(options = {}) {
  const portal = normalizePortal(options.portal);
  const config = getMailConfig();

  const timeoutMs = Number(options.timeoutMs || config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const lookbackMinutes = Number(
    options.lookbackMinutes || config.lookbackMinutes || DEFAULT_LOOKBACK_MINUTES
  );
  const pollIntervalMs = Number(
    options.pollIntervalMs || config.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS
  );

  if (!config.email || !config.appPassword) {
    return {
      ok: false,
      status: 'config_missing',
      error: 'OTP Gmail credentials are not configured (OTP_GMAIL_EMAIL / OTP_GMAIL_APP_PASSWORD)',
      portal,
    };
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.email,
      pass: config.appPassword,
    },
    logger: false,
  });

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lock = null;

  try {
    await client.connect();
    lock = await client.getMailboxLock('INBOX');
    logger.info('[OTP] Connected to Gmail IMAP', { portal, email: config.email });

    while (Date.now() < deadline) {
      const sinceDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      const messages = await readRecentMessages(client, sinceDate);

      for (const message of messages) {
        const msgTime = new Date(message.internalDate || 0).getTime();
        if (!Number.isFinite(msgTime) || msgTime < sinceDate.getTime()) continue;

        let parsed = null;
        try {
          parsed = await simpleParser(message.source);
        } catch (error) {
          logger.warn('[OTP] Failed to parse email source', {
            portal,
            uid: message.uid || null,
            error: error?.message || String(error),
          });
          continue;
        }

        if (!shouldConsiderMessage(portal, message.envelope, parsed)) {
          continue;
        }

        const subject = String(parsed?.subject || message?.envelope?.subject || '').trim();
        const textBody = [
          parsed?.text || '',
          parsed?.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : '',
        ]
          .join('\n')
          .replace(/\s+/g, ' ')
          .trim();

        const match = extractCodeFromText(`${subject}\n${textBody}`, portal);
        if (!match) {
          continue;
        }

        return {
          ok: true,
          status: 'auto_read',
          portal,
          code: match.code,
          matchedBy: match.matchedBy,
          messageId: parsed?.messageId || null,
          receivedAt: message.internalDate ? new Date(message.internalDate).toISOString() : null,
          subject,
        };
      }

      await sleep(pollIntervalMs);
    }

    return {
      ok: false,
      status: 'timeout',
      portal,
      error: `Timed out waiting for OTP email after ${timeoutMs}ms`,
    };
  } catch (error) {
    const details = [
      error?.message || String(error),
      error?.responseText || null,
      error?.responseStatusText || null,
      error?.code || null,
    ]
      .filter(Boolean)
      .join(' | ');
    return {
      ok: false,
      status: 'imap_error',
      portal,
      error: details || 'imap_error',
    };
  } finally {
    try {
      if (lock) {
        lock.release();
      }
    } catch {
      // no-op
    }
    await client.logout().catch(() => {});
  }
}
