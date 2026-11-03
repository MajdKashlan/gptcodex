/**
 * Parsing of ERPNext / Frappe HTTP error envelopes.
 *
 * Frappe reports validation and permission failures as a JSON body shaped like:
 *
 * ```json
 * {
 *   "exc_type": "ValidationError",
 *   "_server_messages": "[\"{\\\"message\\\":\\\"Item is mandatory\\\",\\\"title\\\":\\\"Mandatory\\\"}\"]",
 *   "exception": "frappe.exceptions.ValidationError: Item is mandatory"
 * }
 * ```
 *
 * `_server_messages` is a JSON string containing an array of JSON strings, each of
 * which decodes to a message descriptor. Messages frequently embed HTML
 * (`<strong>`, `<br>`, `&nbsp;`), so they are flattened to plain text before being
 * shown in the UI.
 */

/** A single decoded `_server_messages` entry. */
export interface FrappeServerMessage {
  message: string;
  title?: string;
  indicator?: string;
  as_table?: boolean;
  raise_exception?: number | boolean;
}

/** Normalised error information extracted from an unknown thrown value. */
export interface FrappeErrorInfo {
  /** Plain-text messages, most specific first. Never empty. */
  messages: string[];
  /** The first message, for single-line display. */
  message: string;
  /** Frappe exception class name, when the server supplied one. */
  excType: string | null;
  /** Optional title from the first server message, e.g. `Mandatory`. */
  title: string | null;
  /** Frappe indicator (`red`, `orange`, `green`, `blue`). */
  indicator: string | null;
  /** HTTP status code, when the failure came from an HTTP response. */
  status: number | null;
  /** `true` when the request failed because the session is no longer valid. */
  isUnauthorized: boolean;
}

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** Converts a Frappe message that may contain HTML into a single plain-text line. */
export function stripFrappeHtml(value: string): string {
  let text = value;
  // <br> and block-level tags become spaces so words do not run together.
  text = text.replace(/<\s*(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, ' ');
  text = text.replace(/<[^>]*>/g, '');
  for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
    text = text.split(entity).join(replacement);
  }
  // Collapse the whitespace left behind by removed markup.
  return text.replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Decodes `_server_messages`, tolerating already-decoded arrays and objects. */
function decodeServerMessages(raw: unknown): FrappeServerMessage[] {
  if (raw === null || raw === undefined) {
    return [];
  }

  let entries: unknown[] = [];

  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      entries = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Not JSON at all - treat the raw string as the message itself.
      return [{ message: trimmed }];
    }
  } else if (isRecord(raw)) {
    entries = [raw];
  } else {
    return [];
  }

  const messages: FrappeServerMessage[] = [];

  for (const entry of entries) {
    if (typeof entry === 'string') {
      // Each entry is normally a JSON-encoded descriptor.
      const trimmed = entry.trim();
      if (trimmed === '') {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isRecord(parsed)) {
          messages.push(parsed as unknown as FrappeServerMessage);
        } else {
          messages.push({ message: trimmed });
        }
      } catch {
        messages.push({ message: trimmed });
      }
      continue;
    }

    if (isRecord(entry)) {
      messages.push(entry as unknown as FrappeServerMessage);
    }
  }

  return messages;
}

/** Extracts the JSON body from an Angular `HttpErrorResponse`-like value. */
function readErrorBody(error: unknown): Record<string, unknown> | null {
  if (!isRecord(error)) {
    return null;
  }
  const body = error['error'];
  return isRecord(body) ? body : null;
}

/**
 * Turns any thrown value (usually an `HttpErrorResponse`) into displayable,
 * plain-text messages plus the metadata needed to style the notification.
 */
export function parseFrappeError(error: unknown): FrappeErrorInfo {
  const record = isRecord(error) ? error : null;
  const body = readErrorBody(error);

  const statusValue = record?.['status'];
  const status = typeof statusValue === 'number' ? statusValue : null;
  const isUnauthorized = status === 401 || status === 403;

  const excTypeRaw = body?.['exc_type'];
  const excType = typeof excTypeRaw === 'string' && excTypeRaw !== '' ? excTypeRaw : null;

  // 1. Preferred source: the structured messages Frappe builds for `frappe.throw`.
  const decoded = decodeServerMessages(body?.['_server_messages']);
  const cleaned = decoded
    .map((entry) => ({
      message: typeof entry.message === 'string' ? stripFrappeHtml(entry.message) : '',
      title: typeof entry.title === 'string' ? stripFrappeHtml(entry.title) : undefined,
      indicator: entry.indicator,
    }))
    .filter((entry) => entry.message !== '');

  if (cleaned.length > 0) {
    const messages = cleaned.map((entry) => entry.message);
    const first = cleaned[0];
    return {
      messages,
      message: messages[0],
      excType,
      title: first?.title && first.title !== '' ? first.title : null,
      indicator: first?.indicator ?? null,
      status,
      isUnauthorized,
    };
  }

  // 2. Fallbacks, in decreasing specificity.
  const fallbackCandidates: unknown[] = [
    body?.['message'],
    body?.['_error_message'],
    body?.['exception'],
    body?.['exc'],
    record?.['message'],
  ];

  for (const candidate of fallbackCandidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const text = stripFrappeHtml(candidate);
    if (text !== '') {
      return {
        messages: [text],
        message: text,
        excType,
        title: null,
        indicator: null,
        status,
        isUnauthorized,
      };
    }
  }

  // 3. Status-based defaults so the user never sees an empty error.
  const generic = genericMessageForStatus(status);
  return {
    messages: [generic],
    message: generic,
    excType,
    title: null,
    indicator: null,
    status,
    isUnauthorized,
  };
}

function genericMessageForStatus(status: number | null): string {
  switch (status) {
    case 0:
      return 'Could not reach the ERPNext server. Check your connection.';
    case 400:
      return 'The server rejected the request (400).';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'The requested record was not found.';
    case 417:
      return 'The server rejected the request (417 Expectation Failed).';
    case 429:
      return 'Too many requests. Please slow down and try again.';
    case 500:
      return 'The ERPNext server encountered an internal error.';
    case 502:
    case 503:
    case 504:
      return 'The ERPNext server is temporarily unavailable.';
    default:
      return status === null
        ? 'Something went wrong.'
        : 'The request failed with status ' + status + '.';
  }
}

/** Convenience helper for templates and simple call sites. */
export function frappeErrorMessage(error: unknown): string {
  return parseFrappeError(error).message;
}