import { fetchWithRetry } from "../utils/fetch";
import { DOUBAN_HOT_SOURCES, DAILYHOT_API_BASE } from "../../../config/doubanHot";
import { MemoryCache } from "../cache/memoryCache";

export interface DoubanHotItem {
  id?: number;
  title: string;
  url?: string;
  cover?: string;
  desc?: string;
  hot?: number;
}

export interface DoubanHotCategory {
  id: string;
  label: string;
  title: string;
  type: string;
  items: DoubanHotItem[];
}

export interface DoubanHotResult {
  categories: Record<string, DoubanHotCategory>;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 分钟
const cache = new MemoryCache<DoubanHotResult>({
  maxSize: 10,
});

function buildCacheKey(categories: string[]): string {
  return `douban-hot:${[...categories].sort().join(",")}`;
}

function extractSearchTerm(title: string): string {
  return title.replace(/^【[\d.]+】/, "").trim() || title;
}

function normalizeItem(raw: { id?: number; title?: string; url?: string; cover?: string; desc?: string; hot?: number }): DoubanHotItem {
  const title = String(raw?.title || "").trim();
  return {
    id: raw?.id,
    title,
    url: raw?.url,
    cover: raw?.cover,
    desc: raw?.desc,
    hot: raw?.hot ?? 0,
  };
}

export async function fetchDoubanHot(categories?: string[]): Promise<DoubanHotResult> {
  const routeIds = categories?.length
    ? categories
    : DOUBAN_HOT_SOURCES.map((s) => s.route);
  const cacheKey = buildCacheKey(routeIds);

  const cached = cache.get(cacheKey);
  if (cached.hit && cached.value) {
    return cached.value;
  }

  const sourceMap = new Map(DOUBAN_HOT_SOURCES.map((s) => [s.route, s]));
  const results: DoubanHotResult = { categories: {} };

  await Promise.all(
    routeIds.map(async (route) => {
      const config = sourceMap.get(route);
      if (!config) return;

      try {
        const url = `${DAILYHOT_API_BASE}/${route}`;
        const resp = await fetchWithRetry<{
          name?: string;
          title?: string;
          type?: string;
          data?: Array<Record<string, unknown>>;
        }>(url, {}, { timeout: 10000, maxRetries: 2 });

        const rawItems = resp?.data || [];
        const items = rawItems
          .map((it) => normalizeItem(it as any))
          .filter((it) => it.title);

        results.categories[config.id] = {
          id: config.id,
          label: config.label,
          title: resp?.title || config.label,
          type: resp?.type || "",
          items,
        };
      } catch (_e) {
        results.categories[config.id] = {
          id: config.id,
          label: config.label,
          title: config.label,
          type: "",
          items: [],
        };
      }
    })
  );

  cache.set(cacheKey, results, CACHE_TTL_MS);
  return results;
}

export { extractSearchTerm };
