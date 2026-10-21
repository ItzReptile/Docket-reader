import { config } from "../config.ts";
import { OllamaChat, OllamaEmbedder } from "./ollama.ts";
import { OpenAICompatibleChat } from "./openai.ts";
import type { ChatModel, Embedder } from "./types.ts";

export type { ChatModel, Embedder, Message } from "./types.ts";

export function chatModel(model = config.llmModel): ChatModel {
  if (config.llmProvider === "openai") {
    return new OpenAICompatibleChat(model, config.openaiBaseUrl, config.openaiApiKey);
  }
  return new OllamaChat(model, config.ollamaUrl, config.ollamaNumCtx);
}

export function embedder(): Embedder {
  return new OllamaEmbedder(config.embedModel, config.ollamaUrl);
}
