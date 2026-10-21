import type { ChatModel, Message } from "./types.ts";

/**
 * Any server that speaks the OpenAI chat-completions API with structured outputs:
 * OpenAI itself, OpenRouter, Groq, vLLM, LM Studio, or Ollama's own /v1 endpoint.
 */
export class OpenAICompatibleChat implements ChatModel {
  constructor(
    readonly model: string,
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async json<T>(messages: Message[], schema: object) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "result", strict: true, schema },
        },
      }),
    });
    if (!res.ok) throw new Error(`${this.baseUrl} ${res.status}: ${await res.text()}`);
    const body: any = await res.json();
    const raw: string = body.choices[0].message.content;
    return { data: JSON.parse(raw) as T, raw };
  }
}
