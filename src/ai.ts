export const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY_SLOT = 'life-dashboard:ai-key';

export type AiErrorKind = 'key' | 'model' | 'credit' | 'limit' | 'busy' | 'network' | 'bad';

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
  ) {
    super(message);
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/* ---------- the key lives in its own storage slot, never inside the app data or its export ---------- */

export function loadKey(): string {
  try {
    return window.localStorage.getItem(KEY_SLOT) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(key: string): boolean {
  try {
    window.localStorage.setItem(KEY_SLOT, key);
    return true;
  } catch {
    return false;
  }
}

export function clearKey(): void {
  try {
    window.localStorage.removeItem(KEY_SLOT);
  } catch {
    /* ignore */
  }
}

export const maskKey = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : '…');
export const looksLikeKey = (key: string) => /^sk-[\w-]{20,}$/.test(key.trim());

/* ---------- prompts ---------- */

export const SYSTEM_PROMPT = `You are the advisor inside one person's private life dashboard. It covers training (push, pull, legs three times a week, with the aim of gaining muscle mass, strength and mobility), bodyweight and measurements, money (a survival fund worth six months of spending first, then an investment fund; amounts are Nigerian naira) and a career goal of shipping a set of portfolio projects by a deadline.

Rules:
- Use only the data summary below. Never invent numbers. If something is missing, say what to log to find out.
- Refer to the actual figures. Be specific, brief and practical: under 180 words unless asked for more.
- Plain text only. No markdown, no headings, no bullet symbols; short paragraphs or "First, second, third" are fine.
- Be honest and kind without flattery. If the numbers are off track, say so and give one or two concrete next steps.
- You are not a doctor, a physiotherapist or a financial adviser. For pain or injury, suggest seeing a professional. On money, give general information and say the decision is theirs.
- Never ask for personal identifiers.`;

export const systemWith = (summaryJson: string) => `${SYSTEM_PROMPT}\n\nData summary as of today (JSON, numbers only):\n${summaryJson}`;

export const SUGGESTED_QUESTIONS = [
  'What should I focus on this week?',
  'Why might my weight trend be flat?',
  'Can I afford a reward this week?',
  'Am I on track for my portfolio goal?',
];

export const weeklyReviewPrompt = (reviewText: string) =>
  `Write my weekly review. Here is the rule-based review for the week, which is accurate:\n\n${reviewText}\n\nUse it as the facts. Add what the numbers mean together (for example how training, spending and coding fit), name the single most important thing to fix, and give a concrete plan for next week covering training, money and code. Under 220 words.`;

/* ---------- the call ---------- */

interface AskOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function apiMessage(body: unknown): string {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === 'string' ? m.slice(0, 200) : '';
}

export async function askClaude({ apiKey, model, system, messages, maxTokens = 700, fetchImpl = fetch, signal }: AskOptions): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        // Needed for calls made straight from a web page. The key stays on this device.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: model.trim(), max_tokens: maxTokens, system, messages }),
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new AiError('Couldn’t reach the Claude API. Check your connection. If you opened this dashboard from a saved file and the problem continues, the browser may be blocking direct calls.', 'network');
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error pages are handled by status below */
  }
  const detail = apiMessage(body);

  if (!res.ok) {
    if (res.status === 401) throw new AiError('Anthropic rejected this API key. Check that you pasted all of it.', 'key');
    if (res.status === 403) throw new AiError(`This key isn’t allowed to do that.${detail ? ` (${detail})` : ''}`, 'key');
    if (res.status === 404) throw new AiError('That model name wasn’t found. Check the model in the settings below.', 'model');
    if (res.status === 400 && /credit balance/i.test(detail)) throw new AiError('Your Anthropic account has no credit left. Add credit in the Anthropic Console, then try again.', 'credit');
    if (res.status === 429) throw new AiError('Too many requests, or a spending limit was reached. Wait a minute and try again.', 'limit');
    if (res.status >= 500) throw new AiError('Anthropic’s servers are busy. Try again shortly.', 'busy');
    throw new AiError(`The request was rejected${detail ? `: ${detail}` : '.'}`, 'bad');
  }

  const parts = (body as { content?: { type?: string; text?: string }[] } | null)?.content;
  const text = Array.isArray(parts)
    ? parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim()
    : '';
  if (!text) throw new AiError('The reply came back empty. Try again.', 'bad');
  const cut = (body as { stop_reason?: string }).stop_reason === 'max_tokens';
  return cut ? `${text}\n\n(The reply was cut off. Ask me to continue.)` : text;
}
