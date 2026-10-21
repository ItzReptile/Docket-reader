// All settings come from environment variables (Bun loads .env automatically).
// See .env.example for what each one does.

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing ${name}. Copy .env.example to .env and set it.`);
  }
  return value;
}

export const config = {
  regsApiKey: env("REGS_API_KEY", "DEMO_KEY"),
  regsRequestsPerHour: Number(env("REGS_REQUESTS_PER_HOUR", "900")),
  databaseUrl: env("DATABASE_URL", "postgres://docket:docket@localhost:5432/docket"),
  llmProvider: env("LLM_PROVIDER", "ollama") as "ollama" | "openai",
  llmModel: env("LLM_MODEL", "qwen3.5:4b"),
  ollamaUrl: env("OLLAMA_URL", "http://127.0.0.1:11434"),
  ollamaNumCtx: Number(env("OLLAMA_NUM_CTX", "8192")),
  openaiBaseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  embedModel: env("EMBED_MODEL", "nomic-embed-text"),
  port: Number(env("PORT", "3000")),
};
