import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import type { CredentialScope, CustomApiProtocol, CustomEndpointConfig, CustomModelConfig } from "../shared.js";

const protocols = new Set<CustomApiProtocol>(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);
const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
  return value as Record<string, unknown>;
}
function optionalRecord(value: unknown, name: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const result = record(value, name);
  if (JSON.stringify(result).length > 32768) throw new Error(`${name} is too large`);
  return structuredClone(result);
}
function positiveInteger(value: unknown, name: string, fallback: number, maximum = 4_000_000): number {
  const number = value === undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(`${name} must be a positive integer`);
  return number;
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} is required`);
  return value.trim();
}
function optionalName(value: unknown, name: string, fallback: string): string {
  return value === undefined || value === "" || typeof value === "string" && !value.trim() ? fallback : text(value, name);
}

function normalizeModel(raw: unknown): CustomModelConfig {
  const value = record(raw, "model");
  const id = text(value.id, "Model ID");
  const contextWindow = positiveInteger(value.contextWindow, "contextWindow", 128000);
  const maxTokens = positiveInteger(value.maxTokens, "maxTokens", Math.min(8192, contextWindow));
  if (maxTokens > contextWindow) throw new Error("maxTokens cannot exceed contextWindow");
  const input = value.input === undefined ? ["text"] : value.input;
  if (!Array.isArray(input) || input.length < 1 || input.length > 2 || !input.includes("text") || input.some((item) => item !== "text" && item !== "image")) throw new Error("Model input must include text and may include image");
  if (value.reasoning !== undefined && typeof value.reasoning !== "boolean") throw new Error("reasoning must be a boolean");
  const cost = value.cost === undefined ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : record(value.cost, "cost");
  for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
    if (typeof cost[field] !== "number" || !Number.isFinite(cost[field]) || cost[field] < 0) throw new Error(`cost.${field} must be non-negative`);
  }
  const thinkingLevelMap = optionalRecord(value.thinkingLevelMap, "thinkingLevelMap");
  if (thinkingLevelMap) for (const [level, setting] of Object.entries(thinkingLevelMap)) {
    if (!thinkingLevels.has(level) || setting !== null && typeof setting !== "string") throw new Error("Invalid thinkingLevelMap");
  }
  const promptCache = optionalRecord(value.promptCache, "promptCache");
  if (promptCache) for (const [key, seconds] of Object.entries(promptCache)) {
    if (!["short", "long"].includes(key) || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) throw new Error("Invalid promptCache");
  }
  const inputLimits = optionalRecord(value.inputLimits, "inputLimits");
  if (inputLimits) {
    for (const key of Object.keys(inputLimits)) if (!["maxRequestBytes", "images"].includes(key)) throw new Error("Invalid inputLimits field");
    if (inputLimits.maxRequestBytes !== undefined) positiveInteger(inputLimits.maxRequestBytes, "inputLimits.maxRequestBytes", 1, 1_000_000_000);
    if (inputLimits.images !== undefined) {
      const images = record(inputLimits.images, "inputLimits.images");
      for (const [key, setting] of Object.entries(images)) {
        if (key === "resize") {
          const resize = record(setting, "inputLimits.images.resize");
          for (const [field, limit] of Object.entries(resize)) {
            if (!["maxWidth", "maxHeight", "maxBytes", "jpegQuality"].includes(field)) throw new Error("Invalid image resize field");
            const number = positiveInteger(limit, `resize.${field}`, 1, field === "maxBytes" ? 1_000_000_000 : 4_000_000);
            if (field === "jpegQuality" && number > 100) throw new Error("jpegQuality must be at most 100");
          }
        } else if (["maxPerMessage", "maxPerRequest"].includes(key)) positiveInteger(setting, `images.${key}`, 1);
        else throw new Error("Invalid images input limit field");
      }
    }
  }
  const samplingParams = optionalRecord(value.samplingParams, "samplingParams");
  const compat = optionalRecord(value.compat, "compat");
  if (compat) for (const key of ["supportsDeveloperRole", "supportsReasoningEffort"]) if (compat[key] !== undefined && typeof compat[key] !== "boolean") throw new Error(`compat.${key} must be a boolean`);
  return {
    id,
    name: optionalName(value.name, "Model name", id),
    reasoning: value.reasoning === true,
    input: [...new Set(input)] as Array<"text" | "image">,
    contextWindow,
    maxTokens,
    cost: cost as CustomModelConfig["cost"],
    ...(thinkingLevelMap ? { thinkingLevelMap: thinkingLevelMap as Record<string, string | null> } : {}),
    ...(promptCache ? { promptCache: promptCache as Record<string, number> } : {}),
    ...(inputLimits ? { inputLimits } : {}),
    ...(samplingParams ? { samplingParams } : {}),
    ...(compat ? { compat } : {}),
  };
}

export function normalizeCustomEndpoint(raw: unknown): CustomEndpointConfig {
  const value = record(raw, "endpoint");
  const id = text(value.id, "Endpoint ID", 48);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error("Endpoint ID must use letters, numbers, dots, underscores or hyphens");
  const baseUrl = text(value.baseUrl, "Base URL", 2048);
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("Invalid base URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Invalid base URL");
  if (!protocols.has(value.api as CustomApiProtocol)) throw new Error("Unsupported API protocol");
  if (value.authMode !== "api-key" && value.authMode !== "none") throw new Error("Invalid authentication mode");
  if (value.apiKey !== undefined && (typeof value.apiKey !== "string" || value.apiKey.length > 8192)) throw new Error("Invalid API key");
  const compat = optionalRecord(value.compat, "compat");
  if (compat) for (const key of ["supportsDeveloperRole", "supportsReasoningEffort"]) if (compat[key] !== undefined && typeof compat[key] !== "boolean") throw new Error(`compat.${key} must be a boolean`);
  if (!Array.isArray(value.models) || value.models.length < 1 || value.models.length > 20) throw new Error("Configure 1 to 20 models");
  const models = value.models.map(normalizeModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) throw new Error("Duplicate model ID");
  return { id, name: optionalName(value.name, "Endpoint name", id), baseUrl: url.toString().replace(/\/$/, ""), api: value.api as CustomApiProtocol, authMode: value.authMode, ...(compat ? { compat } : {}), models };
}

export function customProviderId(scope: CredentialScope, id: string): string { return `custom-${scope}-${id}`; }

export function createCustomProvider(config: CustomEndpointConfig, scope: CredentialScope): Provider {
  const providerId = customProviderId(scope, config.id);
  const models: Model<CustomApiProtocol>[] = config.models.map((entry) => ({
    id: entry.id,
    name: entry.name ?? entry.id,
    provider: providerId,
    api: config.api,
    baseUrl: config.baseUrl,
    reasoning: entry.reasoning ?? false,
    input: entry.input ?? ["text"],
    contextWindow: entry.contextWindow ?? 128000,
    maxTokens: entry.maxTokens ?? 8192,
    cost: entry.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(entry.samplingParams ? { samplingParams: entry.samplingParams } : {}),
    ...(entry.thinkingLevelMap ? { thinkingLevelMap: entry.thinkingLevelMap } : {}),
    ...(entry.inputLimits ? { inputLimits: entry.inputLimits } : {}),
    ...(entry.promptCache ? { promptCache: entry.promptCache } : {}),
    ...(config.compat || entry.compat ? { compat: { ...config.compat, ...entry.compat } } : {}),
  } as Model<CustomApiProtocol>));
  return createProvider<CustomApiProtocol>({
    id: providerId,
    name: config.name ?? config.id,
    baseUrl: config.baseUrl,
    auth: { apiKey: {
      name: `${config.name ?? config.id} API key`,
      // Pi's compatible API adapters require a non-empty key value even for local servers.
      resolve: async ({ credential }) => config.authMode === "none" ? { auth: { apiKey: "no-key" }, source: "Local endpoint (no stored key)" } : credential?.key ? { auth: { apiKey: credential.key }, source: "Stored API key" } : undefined,
    } },
    models,
    api: {
      "openai-completions": openAICompletionsApi(),
      "openai-responses": openAIResponsesApi(),
      "anthropic-messages": anthropicMessagesApi(),
      "google-generative-ai": googleGenerativeAIApi(),
    },
  });
}
