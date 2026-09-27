export type CredentialScope = "user" | "app";
export type CredentialPolicy =
  | { mode: "user-only" }
  | { mode: "app-only" }
  | { mode: "user-or-app"; defaultSource?: CredentialScope };

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface ModelInfo extends ModelRef {
  name: string;
  providerName?: string;
  inputCapabilities: Array<"text" | "image">;
  reasoning: boolean;
  configured: boolean;
  allowed: boolean;
}

/** Pi's supported wire protocols for user-configured compatible endpoints. */
export type CustomApiProtocol = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export interface CustomModelConfig {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  samplingParams?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, string | null>;
  inputLimits?: Record<string, unknown>;
  promptCache?: Record<string, number>;
  compat?: Record<string, unknown>;
}

export interface CustomEndpointConfig {
  id: string;
  name?: string;
  baseUrl: string;
  api: CustomApiProtocol;
  authMode: "api-key" | "none";
  /** Pi model compatibility defaults applied to every model in this provider. */
  compat?: Record<string, unknown>;
  models: CustomModelConfig[];
}

/** The write-only key is separated from the persisted, readable endpoint config. */
export type CustomEndpointInput = CustomEndpointConfig & { apiKey?: string };

export interface ModelCheckResult {
  model: ModelRef;
  connected: boolean;
  reply: string;
  latencyMs: number;
}

export interface ChatImage {
  mimeType: string;
  dataUrl: string;
  fileName?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images: ChatImage[];
  status: "streaming" | "complete" | "error";
  error?: string;
  createdAt: number;
}

export interface ConfirmationField {
  path: string;
  label: string;
  editable?: boolean;
  multiline?: boolean;
}

export interface ConfirmationPresentation {
  title: string;
  description?: string;
  fields: ConfirmationField[];
  confirmLabel?: string;
  rejectLabel?: string;
}

export interface ConfirmationRequest {
  requestId: string;
  actionId: string;
  conversationId: string;
  messageId?: string;
  proposedValue: Record<string, unknown>;
  finalValue?: Record<string, unknown>;
  presentation: ConfirmationPresentation;
  status: "pending" | "executing" | "success" | "rejected" | "error" | "expired";
  result?: unknown;
  error?: string;
  createdAt: number;
}

export interface ConversationSnapshot {
  id: string;
  title: string;
  model: ModelRef;
  status: "idle" | "running" | "error";
  error?: string;
  messages: ChatMessage[];
  confirmations: ConfirmationRequest[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: ModelRef;
  status: ConversationSnapshot["status"];
  createdAt: number;
  updatedAt: number;
}

export type ChatEvent =
  | { type: "snapshot"; conversation: ConversationSnapshot }
  | { type: "message"; message: ChatMessage }
  | { type: "confirmation"; confirmation: ConfirmationRequest }
  | { type: "status"; status: ConversationSnapshot["status"]; error?: string };

export interface UserSettings {
  defaultModel?: ModelRef;
  preferredSources?: Record<string, CredentialScope>;
  baseUrls?: Record<string, string>;
  customProviders?: CustomEndpointConfig[];
}

export interface AppSettings {
  defaultModel?: ModelRef;
  allowedModels?: ModelRef[];
  baseUrls?: Record<string, string>;
  customProviders?: CustomEndpointConfig[];
}

export interface CredentialStatus {
  provider: string;
  policy: CredentialPolicy;
  userConfigured: boolean;
  appConfigured: boolean;
  effectiveSource?: CredentialScope;
  preferredSource?: CredentialScope;
  canManageApp: boolean;
}

export interface LoginStatus {
  flowId: string;
  provider: string;
  status: "waiting" | "success" | "error" | "cancelled" | "expired";
  verificationUri?: string;
  userCode?: string;
  authUrl?: string;
  message?: string;
  prompt?: { type: "text" | "secret" | "select" | "manual_code"; message: string; placeholder?: string; options?: Array<{ id: string; label: string }> };
  expiresAt?: number;
  error?: string;
}

export interface Principal {
  userId: string;
}
