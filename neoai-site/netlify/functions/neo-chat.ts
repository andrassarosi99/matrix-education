/**
 * NEO AI Education Agency — Neo chat proxy (website).
 *
 * Forwards chat messages to Claude Haiku 4.5 with a language-selected
 * system prompt. Companion to `neo-chat-mobile.ts` (which serves the
 * mobile app); kept separate so the website can tune its own limits.
 *
 * Endpoint: POST /.netlify/functions/neo-chat
 *
 * Request body:
 * {
 *   "messages": [{ "role": "user" | "assistant", "content": string }, ...],
 *   "language": "en" | "hu"   // optional, defaults to "en"
 * }
 *
 * Response body:
 * { "reply": string, "usage"?: object }
 *
 * Required env: NEO_ANTHROPIC_API_KEY
 *   (Renamed from ANTHROPIC_API_KEY because Netlify's AI Gateway extension
 *   auto-injects a JWT into that name, which is invalid against api.anthropic.com.)
 */

import { PROMPT_EN } from './prompts/en';
import { PROMPT_HU } from './prompts/hu';

type ChatRole = 'user' | 'assistant';
type Language = 'en' | 'hu';

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type RequestBody = {
  messages?: ChatMessage[];
  language?: Language;
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: unknown;
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODELS: Record<Language, string> = {
  en: 'claude-haiku-4-5-20251001',
  hu: 'claude-sonnet-4-6',
};
const MAX_TOKENS = 512;
const HISTORY_WINDOW = 20;

const ERRORS = {
  en: {
    apiKeyMissing: 'API key not configured',
    invalidJson: 'Invalid JSON body',
    messagesRequired: 'Messages array is required',
    upstream: "Sorry, I'm having trouble connecting right now. Please try again in a moment!",
    emptyReply: "Hmm, I couldn't come up with a response. Could you try again?",
    generic: 'Something went wrong on my end. Please try again!',
  },
  hu: {
    apiKeyMissing: 'API kulcs nincs beállítva',
    invalidJson: 'Hibás JSON formátum',
    messagesRequired: 'A messages mező nem lehet üres',
    upstream: 'Bocsi, most nem tudok kapcsolódni. Kérlek, próbáld újra egy pillanat múlva!',
    emptyReply: 'Hmm, most nem jut eszembe válasz. Megpróbálnád újra?',
    generic: 'Valami félrement nálam. Kérlek, próbáld újra!',
  },
} as const;

function selectPrompt(language: Language): string {
  return language === 'hu' ? PROMPT_HU : PROMPT_EN;
}

function pickLanguage(raw: unknown): Language {
  return raw === 'hu' ? 'hu' : 'en';
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: ERRORS.en.invalidJson }, { status: 400 });
  }

  const language = pickLanguage(body.language);
  const errors = ERRORS[language];

  const apiKey = process.env.NEO_ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: errors.apiKeyMissing }, { status: 500 });
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: errors.messagesRequired }, { status: 400 });
  }

  const cleanedMessages = messages
    .filter(
      (m): m is ChatMessage =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-HISTORY_WINDOW);

  if (cleanedMessages.length === 0) {
    return Response.json({ error: errors.messagesRequired }, { status: 400 });
  }

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELS[language],
        max_tokens: MAX_TOKENS,
        system: selectPrompt(language),
        messages: cleanedMessages,
      }),
    });
  } catch (err) {
    console.error('Neo chat upstream fetch failed:', err);
    return Response.json({ error: errors.upstream }, { status: 502 });
  }

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text().catch(() => '');
    console.error('Anthropic API error:', anthropicRes.status, text);
    return Response.json({ error: errors.upstream }, { status: 502 });
  }

  let payload: AnthropicResponse;
  try {
    payload = (await anthropicRes.json()) as AnthropicResponse;
  } catch {
    return Response.json({ error: errors.upstream }, { status: 502 });
  }

  const reply =
    payload.content
      ?.map((block) => (block.type === 'text' ? block.text ?? '' : ''))
      .filter(Boolean)
      .join('\n') ?? '';

  if (!reply) {
    return Response.json({ error: errors.emptyReply }, { status: 502 });
  }

  return Response.json({ reply, usage: payload.usage });
};
