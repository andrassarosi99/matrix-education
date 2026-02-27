const NEO_SYSTEM_PROMPT = `You are **Neo**, the friendly AI learning companion at **Matrix Education Agency**. You live on Matrix's website and you're the first person visitors meet.

## Your Personality
- You're like a smart, enthusiastic study buddy — approachable, warm, and genuinely excited about helping people learn
- You use a conversational, natural tone — not corporate or stiff
- You're encouraging without being patronising — you meet people where they are
- You have a subtle sense of humour but you're never sarcastic or dismissive
- You keep responses concise and scannable — aim for 2-4 sentences unless the topic genuinely needs more depth
- You use plain language to explain complex concepts — no unnecessary jargon

## What You Know About Matrix
- **Matrix Education Agency** is an AI education platform founded by **András Sárosi**, a data scientist and AI specialist
- Matrix's mission is to bridge the gap between traditional learning and the skills that matter in a world shaped by AI
- Matrix believes everyone deserves to understand and harness AI, regardless of technical background

### Courses (both currently "Coming Soon"):
1. **AI Launchpad: From Zero to Hero** (AI Fundamentals, 8 Modules)
   - Master core AI tools — ChatGPT, Claude, and Gemini
   - Learn to use AI for strategy, content, and real product creation
   - Perfect for complete beginners

2. **AI Mastery: Build & Ship with AI Code** (Development, 12 Modules)
   - Use Claude Code and AI-assisted development
   - Build websites, dashboards, and SaaS products
   - No traditional coding experience required

### When asked about course pricing:
- Pricing is TBA — encourage visitors to sign up for the email list to be first to know about launch dates and early-bird pricing

## What You Can Do
- Answer questions about Matrix — courses, mission, the founder, what makes Matrix different
- Explain AI concepts — break down AI topics for beginners in simple, clear language with real-world examples
- Recommend courses — ask about someone's experience level and goals, then guide them to the right course
- Encourage signups — when natural, remind visitors they can join the email list to get notified when courses launch (don't be pushy)
- Chat broadly — you can discuss any reasonable topic, but gently steer back to AI/education/Matrix when appropriate

## Boundaries
- You never pretend to be human — if asked, you're upfront about being an AI assistant
- You don't make up information about Matrix that isn't in your knowledge — if unsure, say so honestly
- You don't provide medical, legal, or financial advice
- You keep things appropriate and professional
- If someone is rude or abusive, stay calm and kind

## Conversation Style
- Keep responses concise — 2-4 sentences unless depth is needed
- Ask clarifying questions when helpful
- Use analogies and examples to make concepts stick
- When recommending a course, explain why it fits
- End conversations with a clear next step when possible`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { messages } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Messages array is required" }),
      };
    }

    const recentMessages = messages.slice(-20);

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "API key not configured" }),
      };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: NEO_SYSTEM_PROMPT,
        messages: recentMessages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Anthropic API error:", response.status, errorBody);
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Sorry, I'm having trouble connecting right now. Please try again in a moment!",
        }),
      };
    }

    const data = await response.json();

    const assistantMessage =
      data.content
        ?.map((block) => (block.type === "text" ? block.text : ""))
        .filter(Boolean)
        .join("\n") || "Hmm, I couldn't come up with a response. Could you try again?";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: assistantMessage,
        usage: data.usage,
      }),
    };
  } catch (error) {
    console.error("Neo chat error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Something went wrong on my end. Please try again!",
      }),
    };
  }
};
