import type { MergedLinks, GenericResponse, SearchResponse } from "~/server/core/types/models";
import { ALL_PLUGIN_NAMES } from "~/config/plugins";
import { extractMergedFromResponse } from "~/utils/extractMergedFromResponse";
import { mergeMergedByType } from "~/utils/mergeMergedByType";

const devLog = (...args: any[]) => {
  if (import.meta.dev) console.log(...args);
};
const devWarn = (...args: any[]) => {
  if (import.meta.dev) console.warn(...args);
};
const devError = (...args: any[]) => {
  if (import.meta.dev) console.error(...args);
};

export interface SearchOptions {
  apiBase: string;
  keyword: string;
  settings: {
    enabledPlugins: string[];
    enabledTgChannels: string[];
    concurrency: number;
    pluginTimeoutMs: number;
  };
  /** 当搜索接口返回 401 时回调（密码门） */
  onAuthRequired?: () => void;
}

export interface SearchState {
  loading: boolean;
  deepLoading: boolean;
  paused: boolean;
  error: string;
  searched: boolean;
  elapsedMs: number;
  total: number;
  merged: MergedLinks;
}

export function useSearch() {
  const state = ref<SearchState>({
    loading: false,
    deepLoading: false,
    paused: false,
    error: "",
    searched: false,
    elapsedMs: 0,
    total: 0,
    merged: {},
  });

  const setLoading = (v: boolean) => {
    state.value.loading = v;
  };
  const setDeepLoading = (v: boolean) => {
    state.value.deepLoading = v;
  };
  const setPaused = (v: boolean) => {
    state.value.paused = v;
  };
  const setError = (v: string) => {
    state.value.error = v;
  };
  const setSearched = (v: boolean) => {
    state.value.searched = v;
  };
  const setElapsedMs = (v: number) => {
    state.value.elapsedMs = v;
  };
  const setTotal = (v: number) => {
    state.value.total = v;
  };
  const setMerged = (v: MergedLinks) => {
    state.value.merged = v;
  };

  let searchSeq = 0;
  const activeControllers: AbortController[] = [];
  /** 暂停时已完成的任务数，供 continueSearch 从断点续跑 */
  let pausedAtTaskIndex = 0;
  /** 当前并搜已完成数，暂停时用于记录断点 */
  let parallelCompletedCount = 0;

  // 取消所有进行中的请求
  function cancelActiveRequests(): void {
    for (const controller of activeControllers) {
      try {
        controller.abort();
      } catch {}
    }
    activeControllers.length = 0;
  }

  // 暂停搜索
  function pauseSearch(): void {
    if (state.value.loading || state.value.deepLoading) {
      setPaused(true);
      pausedAtTaskIndex = parallelCompletedCount;
      cancelActiveRequests();
    }
  }

  // 继续搜索（从暂停处继续，与 performParallelSearch 同一套任务流）
  async function continueSearch(options: SearchOptions): Promise<void> {
    if (!state.value.paused || !state.value.searched) return;

    setPaused(false);
    setDeepLoading(true);

    const startFrom = pausedAtTaskIndex;
    try {
      await performParallelSearch(options, searchSeq, startFrom);
    } catch (error) {
      // 忽略错误
    } finally {
      pausedAtTaskIndex = 0;
      setDeepLoading(false);
      setLoading(false);
    }
  }
  /** 创建带 AbortController 的搜索任务（插件或 TG 批次） */
  function createSearchTask(
    apiBase: string,
    keyword: string,
    conc: number,
    pluginTimeoutMs: number,
    params: { src: "plugin" | "tg"; plugins?: string; channels?: string },
    label: string,
    shouldSkip: () => boolean,
    onAuthRequired?: () => void
  ): () => Promise<MergedLinks> {
    return async () => {
      if (shouldSkip()) return {};
      const ac = new AbortController();
      activeControllers.push(ac);
      try {
        const extParam = JSON.stringify({ __plugin_timeout_ms: pluginTimeoutMs });
        const q = new URLSearchParams({
          kw: keyword,
          res: "merged_by_type",
          src: params.src,
          conc: String(conc),
          ext: extParam,
        });
        if (params.plugins) q.set("plugins", params.plugins);
        if (params.channels) q.set("channels", params.channels);
        const response = await $fetch<GenericResponse<SearchResponse>>(
          `${apiBase}/search?${q.toString()}`,
          { signal: ac.signal, credentials: "include" } as any
        );
        return extractMergedFromResponse(response.data);
      } catch (error: any) {
        if (error?.name === "AbortError") return {};
        if (error?.statusCode === 401) onAuthRequired?.();
        devWarn(`${label} search failed:`, error);
        return {};
      } finally {
        const idx = activeControllers.indexOf(ac);
        if (idx >= 0) activeControllers.splice(idx, 1);
      }
    };
  }

  // 并发搜索 - 每个源独立请求，支持从 startFromTaskIndex 断点续跑
  async function performParallelSearch(
    options: SearchOptions,
    mySeq: number,
    startFromTaskIndex = 0
  ): Promise<void> {
    const { apiBase, keyword, settings } = options;
    const conc = Math.min(16, Math.max(1, Number(settings.concurrency || 3)));

    const enabledPlugins = settings.enabledPlugins.filter((n) =>
      ALL_PLUGIN_NAMES.includes(n as any)
    );

    const enabledTgChannels = settings.enabledTgChannels || [];

    if (enabledPlugins.length === 0 && enabledTgChannels.length === 0) {
      setError("请先在设置中选择至少一个搜索来源");
      return;
    }

    // 收集所有搜索任务
    const searchTasks: Array<() => Promise<MergedLinks>> = [];

    const shouldSkip = () => mySeq !== searchSeq || state.value.paused;
    const onAuth = options.onAuthRequired;

    // 为每个插件创建独立的搜索任务
    for (const plugin of enabledPlugins) {
      searchTasks.push(
        createSearchTask(
          apiBase,
          keyword,
          conc,
          settings.pluginTimeoutMs,
          { src: "plugin", plugins: plugin },
          `Plugin ${plugin}`,
          shouldSkip,
          onAuth
        )
      );
    }

    // 为 TG 频道创建搜索任务（每批作为一个任务）
    const tgBatchSize = conc;
    for (let i = 0; i < enabledTgChannels.length; i += tgBatchSize) {
      const batch = enabledTgChannels.slice(i, i + tgBatchSize);
      searchTasks.push(
        createSearchTask(
          apiBase,
          keyword,
          conc,
          settings.pluginTimeoutMs,
          { src: "tg", channels: batch.join(",") },
          `TG batch ${Math.floor(i / tgBatchSize)}`,
          shouldSkip,
          onAuth
        )
      );
    }

    // 使用 p-limit 控制并发数
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(conc);

    // 并发执行所有任务，哪个先返回就立即合并展示，不等待其它
    let currentMerged: MergedLinks = {};

    const limitedTasks = searchTasks.map((task) => limit(task));
    const tasksToRun =
      startFromTaskIndex > 0 ? limitedTasks.slice(startFromTaskIndex) : limitedTasks;

    devLog(
      '[performParallelSearch] 开始执行',
      tasksToRun.length,
      '个任务',
      startFromTaskIndex > 0 ? `(从第 ${startFromTaskIndex + 1} 个续跑)` : ''
    );

    let completedCount = startFromTaskIndex;
    parallelCompletedCount = startFromTaskIndex;

    // 每个任务完成即立刻合并展示，不等其它任务
    const processTask = (result: MergedLinks) => {
      if (mySeq !== searchSeq || state.value.paused) return;
      if (Object.keys(result).length > 0) {
        currentMerged = mergeMergedByType(currentMerged, result);
        setMerged(currentMerged);
        setTotal(
          Object.values(currentMerged).reduce(
            (sum, arr) => sum + (arr?.length || 0),
            0
          )
        );
        devLog('[performParallelSearch] 有数据即展示，当前总数:', Object.values(currentMerged).reduce((s, a) => s + a.length, 0));
      }
      completedCount++;
      parallelCompletedCount = completedCount;
    };

    const wrapped = tasksToRun.map((limitedTask) =>
      limitedTask
        .then((result) => {
          processTask(result);
          return result;
        })
        .catch((err) => {
          devError('[performParallelSearch] 任务错误:', err);
        })
    );

    await Promise.all(wrapped);
    devLog('[performParallelSearch] 所有任务完成');
  }

  // 主搜索函数
  async function performSearch(options: SearchOptions): Promise<void> {
    const { keyword, settings } = options;

    // 验证
    if (!keyword || keyword.trim().length === 0) {
      setError("请输入搜索关键词");
      return;
    }

    const enabledPlugins = settings.enabledPlugins.filter((n) =>
      ALL_PLUGIN_NAMES.includes(n as any)
    );

    if (
      (settings.enabledTgChannels?.length || 0) === 0 &&
      enabledPlugins.length === 0
    ) {
      setError("请先在设置中选择至少一个搜索来源");
      return;
    }

    // iOS Safari 兼容性：确保输入框失去焦点
    if (
      typeof window !== "undefined" &&
      document.activeElement instanceof HTMLInputElement
    ) {
      document.activeElement.blur();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 重置状态
    setLoading(true);
    setError("");
    setSearched(true);
    setElapsedMs(0);
    setTotal(0);
    setMerged({});
    setDeepLoading(false);

    const mySeq = ++searchSeq;
    const start = performance.now();

    try {
      // 并行搜索 - 每个源独立请求，实时更新
      await performParallelSearch(options, mySeq);
      
      if (mySeq !== searchSeq) return;
    } catch (error: any) {
      setError(error?.data?.message || error?.message || "请求失败");
    } finally {
      setElapsedMs(Math.round(performance.now() - start));
      // 如果暂停了，保持 loading 状态，只取消 deepLoading
      if (!state.value.paused) {
        setLoading(false);
      }
      setDeepLoading(false);
    }
  }

  // 重置搜索
  function resetSearch(): void {
    cancelActiveRequests();
    searchSeq++;
    setLoading(false);
    setDeepLoading(false);
    setPaused(false);
    setError("");
    setSearched(false);
    setElapsedMs(0);
    setTotal(0);
    setMerged({});
  }

  // 复制链接
  async function copyLink(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
    } catch (error) {
      // 忽略复制失败
    }
  }

  // 响应式状态
  const loading = computed(() => state.value.loading);
  const deepLoading = computed(() => state.value.deepLoading);
  const paused = computed(() => state.value.paused);
  const error = computed(() => state.value.error);
  const searched = computed(() => state.value.searched);
  const elapsedMs = computed(() => state.value.elapsedMs);
  const total = computed(() => state.value.total);
  const merged = computed(() => state.value.merged);
  const hasResults = computed(() => Object.keys(state.value.merged).length > 0);

  return {
    state,
    loading,
    deepLoading,
    paused,
    error,
    searched,
    elapsedMs,
    total,
    merged,
    hasResults,
    performSearch,
    resetSearch,
    copyLink,
    cancelActiveRequests,
    pauseSearch,
    continueSearch,
  };
}
