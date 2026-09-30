/** TanStack Query hooks and cache keys. */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { analysisApi, modelApi, statsApi } from "./endpoints";
import type { AnalysisDetail, AnalysisQuery } from "./types";

export const queryKeys = {
  analyses: ["analyses"] as const,
  analysisList: (query: AnalysisQuery) => ["analyses", "list", query] as const,
  analysisFeed: (query: AnalysisQuery) => ["analyses", "feed", query] as const,
  analysis: (id: string) => ["analyses", "detail", id] as const,
  classExplanation: (id: string, code: string) => ["analyses", "detail", id, "explain", code] as const,
  modelInfo: ["model", "info"] as const,
  modelMetrics: ["model", "metrics"] as const,
  inferenceStats: (scope: "mine" | "all") => ["model", "inference-stats", scope] as const,
  overview: ["stats", "overview"] as const,
};

export function useModelInfo() {
  return useQuery({ queryKey: queryKeys.modelInfo, queryFn: modelApi.info, staleTime: 60_000 });
}

export function useModelMetrics() {
  return useQuery({ queryKey: queryKeys.modelMetrics, queryFn: modelApi.metrics, staleTime: 5 * 60_000 });
}

export function useInferenceStats(scope: "mine" | "all") {
  return useQuery({
    queryKey: queryKeys.inferenceStats(scope),
    queryFn: () => modelApi.inferenceStats(scope),
  });
}

export function useOverview() {
  return useQuery({ queryKey: queryKeys.overview, queryFn: statsApi.overview });
}

export function useAnalyses(query: AnalysisQuery) {
  return useQuery({
    queryKey: queryKeys.analysisList(query),
    queryFn: ({ signal }) => analysisApi.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

/** Paged list that grows as the user scrolls (phones) or presses "Load more". */
export function useAnalysisFeed(query: Omit<AnalysisQuery, "page">) {
  return useInfiniteQuery({
    queryKey: queryKeys.analysisFeed(query),
    queryFn: ({ pageParam, signal }) => analysisApi.list({ ...query, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
}

export function useAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.analysis(id ?? ""),
    queryFn: ({ signal }) => analysisApi.get(id as string, signal),
    enabled: Boolean(id),
    // Signed image URLs expire after 15 minutes. Loaded images stay in memory; if a
    // later request fails the viewer asks for a refetch (fresh URLs) via onImageError.
    staleTime: 5 * 60_000,
  });
}

export function useClassExplanation(id: string, code: string | null) {
  return useQuery({
    queryKey: queryKeys.classExplanation(id, code ?? ""),
    queryFn: ({ signal }) => analysisApi.explainClass(id, code as string, signal),
    enabled: Boolean(code),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function useInvalidateAnalysisData() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.analyses });
    void client.invalidateQueries({ queryKey: queryKeys.overview });
    void client.invalidateQueries({ queryKey: ["model", "inference-stats"] });
  };
}

export function useCreateAnalysis() {
  const client = useQueryClient();
  const invalidate = useInvalidateAnalysisData();
  return useMutation({
    mutationFn: ({
      file,
      onProgress,
      signal,
    }: {
      file: File;
      onProgress: (f: number) => void;
      signal?: AbortSignal;
    }) => analysisApi.create(file, onProgress, signal),
    onSuccess: (detail: AnalysisDetail) => {
      client.setQueryData(queryKeys.analysis(detail.id), detail);
      invalidate();
    },
  });
}

export function useDeleteAnalysis() {
  const client = useQueryClient();
  const invalidate = useInvalidateAnalysisData();
  return useMutation({
    mutationFn: (id: string) => analysisApi.remove(id),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: queryKeys.analysis(id) });
      invalidate();
    },
  });
}

export function useRerunAnalysis() {
  const client = useQueryClient();
  const invalidate = useInvalidateAnalysisData();
  return useMutation({
    mutationFn: (id: string) => analysisApi.rerun(id),
    onSuccess: (detail: AnalysisDetail) => {
      client.setQueryData(queryKeys.analysis(detail.id), detail);
      invalidate();
    },
  });
}
