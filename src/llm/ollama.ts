import type { ChatModel, Embedder, Message } from "./types.ts";

async function post(baseUrl: string, path: string, body: object): Promise<any> {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export class OllamaChat implements ChatModel {
  constructor(
    readonly model: string,
    private baseUrl: string,
    private numCtx: number,
  ) {}

  async json<T>(messages: Message[], schema: object) {
    const res = await post(this.baseUrl, "/api/chat", {
      model: this.model,
      messages,
      stream: false,
      // Ollama turns the JSON schema into a grammar, so the reply is always
      // parseable JSON with the right shape. The *content* still needs checking.
      format: schema,
      // Thinking models (qwen3.5) would otherwise write a long reasoning trace
      // first. Extraction doesn't need it and it multiplies the time per comment.
      think: false,
      keep_alive: "5m",
      options: { temperature: 0, num_ctx: this.numCtx },
    });
    const raw: string = res.message.content;
    return { data: JSON.parse(raw) as T, raw };
  }

  async unload() {
    await post(this.baseUrl, "/api/generate", { model: this.model, keep_alive: 0 });
  }
}

export class OllamaEmbedder implements Embedder {
  constructor(
    private model: string,
    private baseUrl: string,
  ) {}

  async embed(texts: string[]) {
    // nomic-embed-text expects a task prefix; "clustering: " suits grouping similar text.
    const res = await post(this.baseUrl, "/api/embed", {
      model: this.model,
      input: texts.map((t) => `clustering: ${t}`),
      keep_alive: "1m",
    });
    return res.embeddings as number[][];
  }
}
