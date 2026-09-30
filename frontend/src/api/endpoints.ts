/** Typed endpoint functions - one per backend route used by the UI. */

import { downloadFile, requestJson, uploadWithProgress } from "./client";
import type {
  AnalysisDetail,
  AnalysisListItem,
  AnalysisQuery,
  ClassExplanation,
  HealthStatus,
  InferenceStats,
  ModelInfo,
  ModelMetrics,
  OverviewStats,
  Page,
  TokenResponse,
  User,
} from "./types";

export const userTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const authApi = {
  login: (email: string, password: string) =>
    requestJson<TokenResponse>("/api/auth/login", { json: { email, password }, auth: false }),
  register: (full_name: string, email: string, password: string) =>
    requestJson<TokenResponse>("/api/auth/register", { json: { full_name, email, password }, auth: false }),
  logout: () => requestJson<void>("/api/auth/logout", { method: "POST", auth: false }),
  me: () => requestJson<User>("/api/auth/me"),
  updateProfile: (full_name: string) =>
    requestJson<User>("/api/users/me", { method: "PATCH", json: { full_name } }),
  deleteAccount: (password: string) =>
    requestJson<void>("/api/users/me", { method: "DELETE", json: { password } }),
  changePassword: (current_password: string, new_password: string) =>
    requestJson<void>("/api/users/me/password", { json: { current_password, new_password } }),
};

export const analysisApi = {
  create: (file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append("file", file);
    return uploadWithProgress<AnalysisDetail>("/api/analyses", form, onProgress, signal);
  },
  list: (query: AnalysisQuery, signal?: AbortSignal) =>
    requestJson<Page<AnalysisListItem>>("/api/analyses", { query: { ...query }, signal }),
  get: (id: string, signal?: AbortSignal) => requestJson<AnalysisDetail>(`/api/analyses/${id}`, { signal }),
  remove: (id: string) => requestJson<void>(`/api/analyses/${id}`, { method: "DELETE" }),
  rerun: (id: string) => requestJson<AnalysisDetail>(`/api/analyses/${id}/predictions`, { method: "POST" }),
  explainClass: (id: string, code: string, signal?: AbortSignal) =>
    requestJson<ClassExplanation>(`/api/analyses/${id}/explanations/${encodeURIComponent(code)}`, { signal }),
  downloadReport: (id: string) => downloadFile(`/api/analyses/${id}/report`, { tz: userTimeZone() }),
};

export const modelApi = {
  info: () => requestJson<ModelInfo>("/api/model/info"),
  metrics: () => requestJson<ModelMetrics>("/api/model/metrics"),
  inferenceStats: (scope: "mine" | "all") =>
    requestJson<InferenceStats>("/api/model/inference-stats", { query: { scope } }),
};

export const statsApi = {
  overview: () => requestJson<OverviewStats>("/api/stats/overview", { query: { tz: userTimeZone() } }),
};

export const healthApi = {
  get: () => requestJson<HealthStatus>("/api/health", { auth: false }),
};
