// lib/text.js
// Pure text sanitization and chat.db attributedBody decoding helpers.
import * as bplist from 'bplist-parser';

export function showVisible(s) {
  return String(s)
    .replace(/ /g, '·')
    .replace(/\t/g, '→')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function truncateForLog(text, maxLength = 50, verbose = false) {
  if (verbose) return text;
  if (!text) return '';
  const str = String(text);
  return str.length > maxLength ? `${str.substring(0, maxLength)}... [${str.length} chars total]` : str;
}

export function sanitizeExact(s) {
  if (s == null) return '';
  return String(s).replace(/\u0000/g, '').replace(/^\uFEFF/, '');
}

export const NOISE_TOKENS = new Set([
  'streamtyped',
  'NSAttributedString',
  'NSObject',
  'NSString',
  'NSDictionary',
  '__kIMMessagePartAttributeName',
  'NSNumber',
  'NSValue',
]);

export function stripNoiseTokens(s) {
  let out = s;
  for (const token of NOISE_TOKENS) {
    out = out.replace(new RegExp(token, 'g'), '');
  }
  return out;
}

export function dropBinaryNoiseKeepHumanText(s) {
  let out = s;
  out = out.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  out = out.replace(/\uFFFD+/g, '');
  out = out.replace(/[\uE000-\uF8FF]/g, '');
  return out;
}

export function decodeAttributedBody(buf) {
  if (!buf) return '';

  try {
    const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

    try {
      const [root] = bplist.parseBuffer(buffer);

      const visit = (obj, depth = 0) => {
        if (depth > 10) return null;
        if (!obj || typeof obj !== 'object') {
          if (typeof obj === 'string' && /\S/u.test(obj)) return obj;
          return null;
        }
        if (Object.prototype.hasOwnProperty.call(obj, 'NS.string')) {
          return obj['NS.string'];
        }
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const hit = visit(item, depth + 1);
            if (hit != null) return hit;
          }
        } else {
          for (const k of Object.keys(obj)) {
            const hit = visit(obj[k], depth + 1);
            if (hit != null) return hit;
          }
        }
        return null;
      };

      const text = visit(root);
      return sanitizeExact(typeof text === 'string' ? text : '');
    } catch (_plistError) {
      let s = buffer.toString('utf8');
      s = sanitizeExact(s);
      s = stripNoiseTokens(s);
      s = dropBinaryNoiseKeepHumanText(s);
      if (!/\S/u.test(s)) return '';
      return s;
    }
  } catch (_e) {
    return '';
  }
}
