import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';

const DEFAULT_IMAP_HOST = 'imap.gmail.com';
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_IMAP_SECURE = true;
// Lookback covers email-arrival skew; 30min is safe for portals with delayed delivery.
const DEFAULT_LOOKBACK_MINUTES = 30;
const DEFAULT_POLL_INTERVAL_MS = 3000;
// Total timeout: must be long enough for slow portals (Fullerton, Allianz can take >2min
// to send the OTP email when their backend is loaded). 180s gives adequate headroom.
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_SOCKET_TIMEOUT_MS = 30000;
const DEFAULT_MAILBOXES = ['INBOX', '[Gmail]/All Mail'];
const DEFAULT_MAX_MESSAGES_PER_MAILBOX = 80;

const PORTAL_MATCHERS = {
  ALLIANZ: {
    labels: [/allianz/i, /worldwide care/i, /azp/i],
    from: [/allianz/i],
  },
  FULLERTON: {
    labels: [
      /fullerton/i,
      /fhn/i,
      /fhn3/i,
      /2xsecure/i,
      /otp/i,
      /one[-\s]?time/i,
      /verification\s*code/i,
      /security\s*code/i,
      /authentication\s*(?:code|token)?/i,
    ],
    from: [/fullerton/i, /fhn/i, /2xsecure/i],
  },
  IHP: {
    labels: [/\bihp\b/i, /eclaim/i, /doctoranywhere/i, /2xsecure/i],
    from: [/\bihp\b/i, /eclaim/i, /doctoranywhere/i, /2xsecure/i],
  },
  IXCHANGE: {
    labels: [/ixchange/i, /\bspos\b/i, /o2ixchange/i],
    from: [/ixchange/i, /o2ixchange/i],
  },
};

const GENERIC_OTP_REGEXES = [
  /\b(?:otp|one[-\s]?time\s*(?:password|pin)|verification\s*code|security\s*code|passcode|token)\D{0,120}([0-9][0-9\s-]{2,18}[0-9])\b/i,
  /\b(?:code|pin)\D{0,80}([0-9][0-9\s-]{2,18}[0-9])\b/i,
  /\b([0-9][0-9\s-]{2,18}[0-9])\D{0,80}(?:otp|one[-\s]?time\s*(?:password|pin)|verification\s*code|security\s*code|passcode|token)\b/i,
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

function maskEmail(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const [local, domain] = raw.split('@');
  if (!domain) return raw.length > 2 ? `${raw.slice(0, 2)}***` : '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

export function parseMailboxList(value) {
  const raw = String(value || '').trim();
  const items = raw
    ? raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    : DEFAULT_MAILBOXES;
  return [...new Set(items)];
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
      /\b(?:fullerton|fhn|2xsecure).{0,120}?(?:otp|verification|security|code|pin|token).{0,120}?([0-9][0-9\s-]{2,18}[0-9])\b/i,
      /\b(?:otp|one[-\s]?time\s*(?:password|pin)|verification|security|code|pin|token).{0,120}?([0-9][0-9\s-]{2,18}[0-9])\b/i,
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

export function shouldConsiderMessage(portal, envelope, parsed = null) {
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

export function extractCodeFromText(text, portal) {
  const body = String(text || '');
  if (!body) return null;

  const regexes = buildOtpRegexes(portal);
  for (const re of regexes) {
    const m = body.match(re);
    if (!m) continue;
    const code = String(m[1] || '').replace(/\D/g, '');
    if (!/^\d{4,8}$/.test(code)) continue;
    return { code, matchedBy: re.source };
  }
  return null;
}

function buildMailAccountConfig({
  email,
  appPassword,
  authSource,
  suffix = '',
  host = null,
  port = null,
  secure = null,
} = {}) {
  return {
    email: String(email || '').trim(),
    appPassword: String(appPassword || '').trim(),
    authSource: authSource || 'missing',
    suffix,
    host:
      String(host || process.env.OTP_GMAIL_IMAP_HOST || DEFAULT_IMAP_HOST).trim() ||
      DEFAULT_IMAP_HOST,
    port: Number(port || process.env.OTP_GMAIL_IMAP_PORT || DEFAULT_IMAP_PORT),
    secure:
      secure === null || secure === undefined
        ? toBoolean(process.env.OTP_GMAIL_IMAP_SECURE, DEFAULT_IMAP_SECURE)
        : toBoolean(secure, DEFAULT_IMAP_SECURE),
    mailboxes: parseMailboxList(process.env.OTP_GMAIL_MAILBOXES),
    maxMessagesPerMailbox: Number(
      process.env.OTP_GMAIL_MAX_MESSAGES_PER_MAILBOX || DEFAULT_MAX_MESSAGES_PER_MAILBOX
    ),
    lookbackMinutes: Number(process.env.OTP_GMAIL_LOOKBACK_MINUTES || DEFAULT_LOOKBACK_MINUTES),
    pollIntervalMs: Number(process.env.OTP_GMAIL_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
    timeoutMs: Number(process.env.OTP_GMAIL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    socketTimeoutMs: Number(process.env.OTP_GMAIL_SOCKET_TIMEOUT_MS || DEFAULT_SOCKET_TIMEOUT_MS),
  };
}

export function getMailConfigsFromEnv(env = process.env) {
  const baseEmail = String(env.OTP_GMAIL_EMAIL || '').trim();
  const baseAppPassword = String(env.OTP_GMAIL_APP_PASSWORD || env.OTP_GMAIL_PASSWORD || '').trim();
  const configs = [
    buildMailAccountConfig({
      email: baseEmail,
      appPassword: baseAppPassword,
      authSource: env.OTP_GMAIL_APP_PASSWORD
        ? 'app_password'
        : env.OTP_GMAIL_PASSWORD
          ? 'password'
          : 'missing',
      suffix: '',
      host: env.OTP_GMAIL_IMAP_HOST,
      port: env.OTP_GMAIL_IMAP_PORT,
      secure: env.OTP_GMAIL_IMAP_SECURE,
    }),
  ];

  for (let index = 2; index <= 5; index += 1) {
    const email = String(env[`OTP_GMAIL_EMAIL_${index}`] || '').trim();
    const appPassword = String(
      env[`OTP_GMAIL_APP_PASSWORD_${index}`] || env[`OTP_GMAIL_PASSWORD_${index}`] || ''
    ).trim();
    if (!email && !appPassword) continue;
    configs.push(
      buildMailAccountConfig({
        email,
        appPassword,
        authSource: env[`OTP_GMAIL_APP_PASSWORD_${index}`]
          ? 'app_password'
          : env[`OTP_GMAIL_PASSWORD_${index}`]
            ? 'password'
            : 'missing',
        suffix: `_${index}`,
        host: env[`OTP_GMAIL_IMAP_HOST_${index}`] || env.OTP_GMAIL_IMAP_HOST,
        port: env[`OTP_GMAIL_IMAP_PORT_${index}`] || env.OTP_GMAIL_IMAP_PORT,
        secure: env[`OTP_GMAIL_IMAP_SECURE_${index}`] || env.OTP_GMAIL_IMAP_SECURE,
      })
    );
  }

  const seen = new Set();
  return configs.filter(config => {
    const key = config.email.toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readRecentMessages(client, sinceDate, maxMessages) {
  const uids = await client.search({ since: sinceDate }).catch(() => []);
  if (!uids || uids.length === 0) return [];
  const latest = [...uids]
    .sort((a, b) => b - a)
    .slice(0, Number.isFinite(maxMessages) && maxMessages > 0 ? maxMessages : 40);
  const messages = [];
  for await (const message of client.fetch(latest, {
    uid: true,
    envelope: true,
    internalDate: true,
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

async function fetchMessageSource(client, uid) {
  if (!uid) return null;
  for await (const message of client.fetch(
    [uid],
    {
      uid: true,
      source: true,
    },
    { uid: true }
  )) {
    return message?.source || null;
  }
  return null;
}

function classifyImapError(error) {
  const details = [
    error?.message || String(error),
    error?.responseText || null,
    error?.responseStatusText || null,
    error?.code || null,
  ]
    .filter(Boolean)
    .join(' | ');
  const status = /auth|invalid credentials|application-specific password|login failed/i.test(
    details
  )
    ? 'imap_auth_error'
    : 'imap_error';
  return { status, details: details || status };
}

export async function getOtpCode(options = {}) {
  const portal = normalizePortal(options.portal);
  const configs = getMailConfigsFromEnv();
  const primaryConfig = configs[0] || buildMailAccountConfig();

  const timeoutMs = Number(options.timeoutMs || primaryConfig.timeoutMs || DEFAULT_TIMEOUT_MS);
  const lookbackMinutes = Number(
    options.lookbackMinutes || primaryConfig.lookbackMinutes || DEFAULT_LOOKBACK_MINUTES
  );
  const pollIntervalMs = Number(
    options.pollIntervalMs || primaryConfig.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS
  );
  const mailboxes = parseMailboxList(options.mailboxes || primaryConfig.mailboxes);
  const maxMessagesPerMailbox = Number(
    options.maxMessagesPerMailbox ||
      primaryConfig.maxMessagesPerMailbox ||
      DEFAULT_MAX_MESSAGES_PER_MAILBOX
  );
  const socketTimeoutMs = Number(
    options.socketTimeoutMs || primaryConfig.socketTimeoutMs || DEFAULT_SOCKET_TIMEOUT_MS
  );
  // STALENESS GUARD: caller can pass `triggeredAfter` (epoch ms or Date) to
  // filter out OTP emails that arrived before the current login submit. This
  // prevents back-to-back visits from reading the PREVIOUS visit's OTP (which
  // the portal has already consumed and will reject). If not provided, the
  // rolling `lookbackMinutes` window is used as before.
  let triggeredAfterMs = null;
  if (options.triggeredAfter !== undefined && options.triggeredAfter !== null) {
    const raw = options.triggeredAfter;
    const ts = raw instanceof Date ? raw.getTime() : Number(raw);
    if (Number.isFinite(ts) && ts > 0) triggeredAfterMs = ts;
  }

  const configuredAccounts = configs.filter(config => config.email && config.appPassword);
  if (configuredAccounts.length === 0) {
    return {
      ok: false,
      status: 'config_missing',
      error: 'OTP Gmail credentials are not configured (OTP_GMAIL_EMAIL / OTP_GMAIL_APP_PASSWORD)',
      portal,
    };
  }

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const connectedAccounts = [];
  const accountErrors = [];

  try {
    for (const config of configuredAccounts) {
      const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        socketTimeout:
          Number.isFinite(socketTimeoutMs) && socketTimeoutMs > 0
            ? socketTimeoutMs
            : DEFAULT_SOCKET_TIMEOUT_MS,
        auth: {
          user: config.email,
          pass: config.appPassword,
        },
        logger: false,
      });
      let clientError = null;
      client.on('error', error => {
        clientError = error;
        logger.warn('[OTP] Gmail IMAP socket error', {
          portal,
          email: maskEmail(config.email),
          suffix: config.suffix || null,
          error: error?.message || String(error),
          code: error?.code || null,
        });
      });

      try {
        await client.connect();
        connectedAccounts.push({
          config,
          client,
          getClientError: () => clientError,
        });
        logger.info('[OTP] Connected to Gmail IMAP', {
          portal,
          email: maskEmail(config.email),
          authSource: config.authSource,
          suffix: config.suffix || null,
          mailboxes,
          lookbackMinutes,
          timeoutMs,
          triggeredAfter: triggeredAfterMs ? new Date(triggeredAfterMs).toISOString() : null,
        });
      } catch (error) {
        const { status, details } = classifyImapError(error);
        accountErrors.push({
          email: maskEmail(config.email),
          suffix: config.suffix || null,
          status,
          error: details,
        });
        await client.logout().catch(() => {});
        logger.warn('[OTP] Gmail IMAP account unavailable', {
          portal,
          email: maskEmail(config.email),
          suffix: config.suffix || null,
          status,
          error: details,
        });
      }
    }

    if (connectedAccounts.length === 0) {
      const firstError = accountErrors[0] || {};
      return {
        ok: false,
        status: firstError.status || 'imap_error',
        portal,
        error: firstError.error || 'No configured OTP mailbox could connect',
        accountErrors,
      };
    }

    let pollCount = 0;
    let newestMessageAt = null;
    let newestMatchingMessageAt = null;
    let matchingMessagesSeen = 0;
    let staleMatchingMessagesSeen = 0;
    let unparseableMatchingMessagesSeen = 0;
    while (Date.now() < deadline) {
      pollCount += 1;
      const sinceDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      const mailboxSummaries = [];

      for (const { config, client, getClientError } of connectedAccounts) {
        for (const mailbox of mailboxes) {
          if (Date.now() >= deadline) break;
          const pendingClientError = getClientError?.();
          if (pendingClientError) {
            const { status, details } = classifyImapError(pendingClientError);
            accountErrors.push({
              email: maskEmail(config.email),
              suffix: config.suffix || null,
              status,
              error: details,
            });
            continue;
          }
          let lock = null;
          try {
            lock = await client.getMailboxLock(mailbox);
            const messages = await readRecentMessages(client, sinceDate, maxMessagesPerMailbox);
            const mailboxNewestAt = messages[0]?.internalDate
              ? new Date(messages[0].internalDate).toISOString()
              : null;
            newestMessageAt = newestMessageAt || mailboxNewestAt;
            mailboxSummaries.push({
              account: maskEmail(config.email),
              mailbox,
              totalMessages: messages.length,
              newestMessageAt: mailboxNewestAt,
            });

            for (const message of messages) {
              const msgTime = new Date(message.internalDate || 0).getTime();
              if (!Number.isFinite(msgTime) || msgTime < sinceDate.getTime()) continue;
              if (!shouldConsiderMessage(portal, message.envelope)) continue;

              matchingMessagesSeen += 1;
              newestMatchingMessageAt =
                !newestMatchingMessageAt || msgTime > new Date(newestMatchingMessageAt).getTime()
                  ? new Date(msgTime).toISOString()
                  : newestMatchingMessageAt;

              // STALENESS GUARD: reject emails that pre-date the OTP trigger.
              if (triggeredAfterMs !== null && msgTime < triggeredAfterMs) {
                staleMatchingMessagesSeen += 1;
                logger.debug('[OTP] Skipping stale matching email (pre-trigger)', {
                  portal,
                  account: maskEmail(config.email),
                  mailbox,
                  msgTime: new Date(msgTime).toISOString(),
                  triggeredAfter: new Date(triggeredAfterMs).toISOString(),
                });
                continue;
              }

              const source = await fetchMessageSource(client, message.uid);
              let parsed = null;
              try {
                parsed = await simpleParser(source);
              } catch (error) {
                unparseableMatchingMessagesSeen += 1;
                logger.warn('[OTP] Failed to parse matching email source', {
                  portal,
                  account: maskEmail(config.email),
                  mailbox,
                  uid: message.uid || null,
                  error: error?.message || String(error),
                });
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
                unparseableMatchingMessagesSeen += 1;
                logger.debug('[OTP] Matching email found but no OTP code extracted', {
                  portal,
                  account: maskEmail(config.email),
                  mailbox,
                  receivedAt: message.internalDate
                    ? new Date(message.internalDate).toISOString()
                    : null,
                });
                continue;
              }

              return {
                ok: true,
                status: 'auto_read',
                portal,
                code: match.code,
                matchedBy: match.matchedBy,
                messageId: parsed?.messageId || null,
                receivedAt: message.internalDate
                  ? new Date(message.internalDate).toISOString()
                  : null,
                subject,
                mailbox,
                account: maskEmail(config.email),
              };
            }
          } catch (error) {
            logger.warn('[OTP] Mailbox scan failed', {
              portal,
              account: maskEmail(config.email),
              mailbox,
              error: error?.message || String(error),
            });
          } finally {
            try {
              if (lock) lock.release();
            } catch {
              // no-op
            }
          }
        }
      }

      // Keep CI logs PHI-safe: only log counts/timestamps, not sender names or subjects.
      if (pollCount === 1 || pollCount % 10 === 0) {
        logger.info('[OTP] Mailbox scan summary', {
          portal,
          poll: pollCount,
          sinceDate: sinceDate.toISOString(),
          mailboxes: mailboxSummaries,
          newestMessageAt,
          newestMatchingMessageAt,
          matchingMessagesSeen,
          staleMatchingMessagesSeen,
          unparseableMatchingMessagesSeen,
        });
      }

      if (Date.now() + pollIntervalMs < deadline) {
        await sleep(pollIntervalMs);
      }
    }

    let status = 'otp_not_received';
    if (staleMatchingMessagesSeen > 0 && matchingMessagesSeen === staleMatchingMessagesSeen) {
      status = 'otp_stale_only';
    } else if (unparseableMatchingMessagesSeen > 0) {
      status = 'otp_unparseable';
    }

    return {
      ok: false,
      status,
      portal,
      error: `Timed out waiting for OTP email after ${timeoutMs}ms (${pollCount} polls, checked ${lookbackMinutes}min window across ${connectedAccounts.length} account(s) and ${mailboxes.join(', ')}${triggeredAfterMs ? `, triggered-after ${new Date(triggeredAfterMs).toISOString()}` : ''})`,
      newestMessageAt,
      newestMatchingMessageAt,
      matchingMessagesSeen,
      staleMatchingMessagesSeen,
      unparseableMatchingMessagesSeen,
      accountErrors,
    };
  } catch (error) {
    const { status, details } = classifyImapError(error);
    return {
      ok: false,
      status,
      portal,
      error: details,
    };
  } finally {
    await Promise.all(connectedAccounts.map(({ client }) => client.logout().catch(() => {})));
  }
}
