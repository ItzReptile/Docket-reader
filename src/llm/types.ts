// The pipeline talks to models only through these two interfaces, so the
// provider is swappable: Ollama locally by default, or any OpenAI-compatible API.

export type Message = { role: "system" | "user" | "assistant"; content: string };

export interface ChatModel {
  /** Model name as stored with results, e.g. "qwen3.5:4b". */
  readonly model: string;
  /** Ask for a reply that matches a JSON schema. Throws if the reply isn't valid JSON. */
  json<T>(messages: Message[], schema: object): Promise<{ data: T; raw: string }>;
  /** Free GPU memory when a batch is done. Optional; hosted APIs don't need it. */
  unload?(): Promise<void>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}
