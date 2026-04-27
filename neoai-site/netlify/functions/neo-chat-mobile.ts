/**
 * NEO AI Education Agency — Neo chat proxy.
 *
 * Forwards chat messages to Claude Haiku 4.5 with a language-selected
 * system prompt. Designed to be deployed as a Netlify serverless function
 * (runs on AWS Lambda under the hood — no special framework required,
 * just a default-exported handler that speaks the Fetch API).
 *
 * Endpoint: POST /.netlify/functions/neo-chat-mobile
 *
 * Request body:
 * {
 *   "messages": [{ "role": "user" | "assistant", "content": string }, ...],
 *   "language": "en" | "hu",            // optional, defaults to "en"
 *   "system_prompt": string              // optional; only honored when
 *                                        // server-side ENV === 'development'
 * }
 *
 * Response body:
 * { "reply": string }
 *
 * Required environment variables (Netlify site settings → Environment):
 *   NEO_ANTHROPIC_API_KEY  — your Anthropic API key (required). Renamed from
 *                            ANTHROPIC_API_KEY because Netlify's AI Gateway
 *                            extension auto-injects a JWT into that name.
 *   ENV                    — set to "development" to allow client-side
 *                            system_prompt overrides. Any other value (or
 *                            unset) disables the override.
 *
 * Deploy notes:
 *   - Copy this `netlify/` directory (plus `netlify.toml` at the repo root
 *     of your website) into the website repo, or reference it from the
 *     mobile-app repo if you prefer to deploy separately.
 *   - CORS headers are permissive by default; tighten the `Access-Control-
 *     Allow-Origin` value once you know your production domains.
 */

import { PROMPT_EN } from './prompts/en';
import { PROMPT_HU } from './prompts/hu';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type RequestBody = {
  messages?: ChatMessage[];
  language?: 'en' | 'hu';
  system_prompt?: string;
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODELS: Record<'en' | 'hu', string> = {
  en: 'claude-haiku-4-5-20251001',
  hu: 'claude-sonnet-4-6',
};
const MAX_TOKENS = 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

/** Pick the production system prompt for the given language. */
function selectPrompt(language: 'en' | 'hu' | undefined): string {
  if (language === 'hu') {
    return PROMPT_HU;
  }
  return PROMPT_EN;
}

export default async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  const apiKey = process.env.NEO_ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'NEO_ANTHROPIC_API_KEY not configured' },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { messages, language, system_prompt: clientOverride } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: '`messages` must be a non-empty array' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Dev override: only honored when ENV=development on the server.
  const isDev = process.env.ENV === 'development';
  const systemPrompt =
    isDev && typeof clientOverride === 'string' && clientOverride.trim().length > 0
      ? clientOverride
      : selectPrompt(language);

  // Sanitize messages to just role + content (defensive against client-sent
  // extra fields that Anthropic would reject).
  const cleanedMessages = messages
    .filter(
      (m): m is ChatMessage =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (cleanedMessages.length === 0) {
    return Response.json(
      { error: '`messages` contained no valid entries' },
      { status: 400, headers: CORS_HEADERS },
    );
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
        model: MODELS[language === 'hu' ? 'hu' : 'en'],
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: cleanedMessages,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown fetch error';
    return Response.json(
      { error: `Upstream fetch failed: ${msg}` },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text().catch(() => '');
    return Response.json(
      { error: `Anthropic API error ${anthropicRes.status}`, detail: text.slice(0, 500) },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  let payload: AnthropicResponse;
  try {
    payload = (await anthropicRes.json()) as AnthropicResponse;
  } catch {
    return Response.json(
      { error: 'Failed to parse upstream response' },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  const reply =
    payload.content?.find((c) => c.type === 'text')?.text ??
    payload.content?.[0]?.text ??
    '';

  if (!reply) {
    return Response.json(
      { error: 'Empty reply from upstream' },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  return Response.json({ reply }, { headers: CORS_HEADERS });
};
