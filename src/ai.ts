export type AiErrorKind = 'key' | 'model' | 'credit' | 'limit' | 'busy' | 'network' | 'bad';

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
  ) {
    super(message);
  }
}

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter';

export interface Provider {
  id: ProviderId;
  name: string;
  /** Where the person creates a key and watches spend. */
  consoleName: string;
  keyPrefix: string;
  keyPlaceholder: string;
  /** A starting point only: model names change often, so the field stays editable. */
  defaultModel: string;
  modelHint: string;
  billing: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    consoleName: 'the Anthropic Console',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-…',
    defaultModel: 'claude-sonnet-5-5',
    modelHint: 'Any Claude model name, for example the ones listed in the Anthropic Console.',
    billing: 'Calls are billed to your Anthropic Console account, which is separate from a Claude app subscription.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    consoleName: 'the OpenAI platform',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-…',
    defaultModel: 'gpt-5-mini',
    modelHint: 'Any chat model your key can use. If you get “model not found”, check the current names on the OpenAI platform.',
    billing: 'Calls are billed to your OpenAI platform account, which is separate from a ChatGPT subscription.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    consoleName: 'Google AI Studio',
    keyPrefix: 'AIza',
    keyPlaceholder: 'AIza…',
    defaultModel: 'gemini-flash-latest',
    modelHint: 'Any Gemini model name from Google AI Studio. Names ending in -latest follow the newest version.',
    billing: 'Free-tier keys have low limits, and Google may use free-tier prompts to improve its products. Check your plan’s data terms.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (many models)',
    consoleName: 'OpenRouter',
    keyPrefix: 'sk-or-',
    keyPlaceholder: 'sk-or-…',
    defaultModel: 'openrouter/auto',
    modelHint: 'One key for hundreds of models from many makers (Llama, Mistral, DeepSeek, Grok, Claude, GPT, Gemini and more). Use the model id shown on openrouter.ai/models.',
    billing: 'Credit is prepaid on your OpenRouter account. Each model’s maker may have its own data terms.',
  },
];

export const providerOf = (id: string | undefined): Provider => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
export const isProviderId = (x: unknown): x is ProviderId => PROVIDERS.some((p) => p.id === x);

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/* ---------- each key lives in its own storage slot, never inside the app data or its export ---------- */

// The first provider kept the original slot name, so a key saved before other providers existed still works.
const slot = (p: ProviderId) => (p === 'anthropic' ? 'life-dashboard:ai-key' : `life-dashboard:ai-key:${p}`);

export function loadKey(provider: ProviderId = 'anthropic'): string {
  try {
    return window.localStorage.getItem(slot(provider)) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(key: string, provider: ProviderId = 'anthropic'): boolean {
  try {
    window.localStorage.setItem(slot(provider), key);
    return true;
  } catch {
    return false;
  }
}

export function clearKey(provider: ProviderId = 'anthropic'): void {
  try {
    window.localStorage.removeItem(slot(provider));
  } catch {
    /* ignore */
  }
}

export const maskKey = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : '…');

/** A quick check that catches pasting the wrong key or a partial one. The provider is the real judge. */
export function looksLikeKey(key: string, provider: ProviderId = 'anthropic'): boolean {
  const k = key.trim();
  if (!/^[\w.-]{20,}$/.test(k)) return false;
  if (!k.startsWith(providerOf(provider).keyPrefix)) return false;
  // OpenAI keys also start with "sk-", so keys that belong to the other "sk-" providers are told apart.
  if (provider === 'openai' && (k.startsWith('sk-ant-') || k.startsWith('sk-or-'))) return false;
  return true;
}

export const keyAdvice = (provider: ProviderId) => `That doesn’t look like a ${providerOf(provider).name} key. It starts with ${providerOf(provider).keyPrefix} and has no spaces.`;

/* ---------- prompts ---------- */

export const SYSTEM_PROMPT = `You are the advisor inside one person's private life dashboard. It covers training (push, pull, legs three times a week, with the aim of gaining muscle mass, strength and mobility), bodyweight (in the weight unit named in the summary) and measurements, money (a survival fund worth six months of spending first, then an investment fund; amounts are in the currency named in the summary) and a career goal of shipping a set of portfolio projects by a deadline.

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
export interface AskAiOptions extends AskOptions {
  provider: ProviderId;
}

const clip = (m: unknown) => (typeof m === 'string' ? m.slice(0, 200) : '');
const detailOf = (body: unknown): string => {
  const b = body as { error?: { message?: unknown } | string; message?: unknown } | null;
  return clip(typeof b?.error === 'object' ? b.error?.message : b?.error) || clip(b?.message);
};

interface Built {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}
interface Reply {
  text: string;
  cut: boolean;
}

function build(o: AskAiOptions): Built {
  const model = o.model.trim();
  const key = o.apiKey.trim();
  const max = o.maxTokens ?? 700;
  if (o.provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Needed for calls made straight from a web page. The key stays on this device.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: { model, max_tokens: max, system: o.system, messages: o.messages },
    };
  }
  if (o.provider === 'google') {
    return {
      // The model is part of the address; a pasted "models/" prefix is harmless.
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: o.system }] },
        contents: o.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        // Gemini counts its internal thinking inside this limit, so the visible answer needs headroom.
        generationConfig: { maxOutputTokens: max * 3 },
      },
    };
  }
  const chat = [{ role: 'system', content: o.system }, ...o.messages];
  if (o.provider === 'openai') {
    // Reasoning models spend part of the limit thinking, so the visible answer needs headroom.
    return { url: 'https://api.openai.com/v1/chat/completions', headers: { authorization: `Bearer ${key}` }, body: { model, messages: chat, max_completion_tokens: max * 3 } };
  }
  return { url: 'https://openrouter.ai/api/v1/chat/completions', headers: { authorization: `Bearer ${key}` }, body: { model, messages: chat, max_tokens: max * 2 } };
}

function read(provider: ProviderId, body: unknown): Reply {
  if (provider === 'anthropic') {
    const b = body as { content?: { type?: string; text?: string }[]; stop_reason?: string } | null;
    const text = Array.isArray(b?.content)
      ? b.content
          .filter((p) => p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text)
          .join('')
          .trim()
      : '';
    return { text, cut: b?.stop_reason === 'max_tokens' };
  }
  if (provider === 'google') {
    const c = (body as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] } | null)?.candidates?.[0];
    const text = (c?.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    return { text, cut: c?.finishReason === 'MAX_TOKENS' };
  }
  const c = (body as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] } | null)?.choices?.[0];
  return { text: typeof c?.message?.content === 'string' ? c.message.content.trim() : '', cut: c?.finish_reason === 'length' };
}

function failure(provider: ProviderId, status: number, body: unknown): AiError {
  const p = providerOf(provider);
  const detail = detailOf(body);
  const code = String((body as { error?: { code?: unknown } } | null)?.error?.code ?? '');
  if (/credit balance|insufficient[_ ]quota|insufficient credits|payment required/i.test(`${detail} ${code}`) || status === 402) {
    return new AiError(`Your ${p.name} account has no credit left. Add credit with ${p.consoleName}, then try again.`, 'credit');
  }
  if (status === 401 || (provider === 'google' && status === 400 && /api key/i.test(detail))) return new AiError(`${p.name} rejected this API key. Check that you pasted all of it.`, 'key');
  if (status === 403) return new AiError(`This key isn’t allowed to do that.${detail ? ` (${detail})` : ''}`, 'key');
  if (status === 404) return new AiError('That model name wasn’t found for this provider. Check the model in the settings below.', 'model');
  if (status === 429) return new AiError('Too many requests, or a spending limit was reached. Wait a minute and try again.', 'limit');
  if (status >= 500) return new AiError(`${p.name}’s servers are busy. Try again shortly.`, 'busy');
  return new AiError(`The request was rejected${detail ? `: ${detail}` : '.'}`, 'bad');
}

export async function askAi(o: AskAiOptions): Promise<string> {
  const { provider, fetchImpl = fetch, signal } = o;
  const req = build(o);
  let res: Response;
  try {
    res = await fetchImpl(req.url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...req.headers }, body: JSON.stringify(req.body) });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new AiError(`Couldn’t reach ${providerOf(provider).name}. Check your connection. If you opened this dashboard from a saved file and the problem continues, the browser may be blocking direct calls.`, 'network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error pages are handled by status below */
  }
  if (!res.ok) throw failure(provider, res.status, body);
  const { text, cut } = read(provider, body);
  if (!text) throw new AiError('The reply came back empty. Try again, or choose a different model.', 'bad');
  return cut ? `${text}\n\n(The reply was cut off. Ask me to continue.)` : text;
}

/** The original entry point, kept for the Anthropic path. */
export const askClaude = (o: AskOptions): Promise<string> => askAi({ ...o, provider: 'anthropic' });
