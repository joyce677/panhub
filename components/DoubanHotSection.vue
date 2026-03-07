<template>
  <div v-if="!hasAnyData" class="hidden"></div>

  <div v-else class="douban-hot-section">
    <div class="section-head">
      <h2 class="section-title">豆瓣热搜</h2>
      <p class="section-subtitle">点击影视名可快速发起网盘搜索</p>
    </div>
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <span>豆瓣热搜加载中…</span>
    </div>
    <div v-else class="categories">
      <div
        v-for="cat in categoryList"
        :key="cat.id"
        v-show="cat.items.length > 0"
        class="category-block"
      >
        <h3 class="category-title">{{ cat.label }}</h3>
        <div class="tag-cloud">
          <button
            v-for="item in cat.items"
            :key="item.title + (item.id ?? '')"
            class="tag-item"
            :style="getTagStyle(item, cat.items)"
            :aria-label="`搜索 ${extractTerm(item.title)}`"
            @click="onItemClick(item.title)"
          >
            {{ extractTerm(item.title) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

interface Props {
  onSearch: (term: string) => void;
}

interface DoubanHotItem {
  id?: number;
  title: string;
  url?: string;
  cover?: string;
  desc?: string;
  hot?: number;
}

interface DoubanHotCategory {
  id: string;
  label: string;
  title: string;
  type: string;
  items: DoubanHotItem[];
}

const props = defineProps<Props>();

const loading = ref(false);
const categories = ref<Record<string, DoubanHotCategory>>({});
const hasInitialized = ref(false);

const categoryList = computed(() => Object.values(categories.value));

const hasAnyData = computed(() => {
  if (loading.value) return true;
  return categoryList.value.some((c) => c.items.length > 0);
});

function extractTerm(title: string): string {
  return title.replace(/^【[\d.]+】/, "").trim() || title;
}

async function fetchDoubanHot() {
  loading.value = true;
  try {
    const response = await fetch("/api/douban-hot");
    const data = await response.json();
    if (data.code === 0 && data.data?.categories) {
      categories.value = data.data.categories;
    } else {
      categories.value = {};
    }
  } catch {
    categories.value = {};
  } finally {
    loading.value = false;
  }
}

function getTagStyle(item: DoubanHotItem, items: DoubanHotItem[]) {
  if (items.length === 0) return {};
  const hotValues = items.map((i) => i.hot ?? 0).filter((v) => v > 0);
  const minHot = hotValues.length ? Math.min(...hotValues) : 0;
  const maxHot = hotValues.length ? Math.max(...hotValues) : 1;
  const hot = item.hot ?? 0;
  const normalized = maxHot > minHot ? (hot - minHot) / (maxHot - minHot) : 0.5;

  const fontSize = 12 + normalized * 12;
  const fontWeight = hot >= 70 ? 800 : hot >= 40 ? 700 : 600;
  const opacity = 0.75 + normalized * 0.25;
  const bgOpacity = 0.08 + normalized * 0.22;
  const borderOpacity = 0.16 + normalized * 0.3;

  return {
    fontSize: `${fontSize}px`,
    color: "var(--primary-dark)",
    fontWeight,
    opacity,
    padding: `${6 + normalized * 2}px ${10 + normalized * 4}px`,
    margin: `${4 + (1 - normalized) * 2}px`,
    backgroundColor: `rgba(15, 118, 110, ${bgOpacity.toFixed(3)})`,
    borderColor: `rgba(15, 118, 110, ${borderOpacity.toFixed(3)})`,
  };
}

function onItemClick(title: string) {
  const term = extractTerm(title);
  if (term) props.onSearch(term);
}

async function init() {
  if (hasInitialized.value) return;
  hasInitialized.value = true;
  await fetchDoubanHot();
}

async function refresh() {
  await fetchDoubanHot();
}

defineExpose({ init, refresh });
</script>

<style scoped>
.douban-hot-section {
  width: 100%;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.section-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0;
}

.section-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-light);
  border-radius: 14px;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(15, 118, 110, 0.2);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.categories {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-block {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 18px;
}

.category-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 0 0 12px 0;
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  cursor: pointer;
  transition: transform 200ms ease, box-shadow 200ms ease, filter 200ms ease,
    background-color 200ms ease;
  white-space: nowrap;
  text-align: center;
  line-height: 1.2;
  user-select: none;
}

.tag-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 7px 14px rgba(15, 118, 110, 0.18);
  filter: brightness(1.03);
  z-index: 10;
}

.hidden {
  display: none;
}

@media (max-width: 640px) {
  .section-head {
    flex-direction: column;
    gap: 4px;
  }

  .section-title {
    font-size: 15px;
  }

  .category-block {
    padding: 14px;
  }

  .tag-cloud {
    gap: 6px;
  }
}

@media (prefers-color-scheme: dark) {
  .category-block,
  .loading-state {
    background: rgba(17, 24, 39, 0.5);
    border-color: rgba(75, 85, 99, 0.4);
  }

  .tag-item {
    color: #ccfbf1 !important;
  }

  .tag-item:hover {
    box-shadow: 0 7px 14px rgba(15, 118, 110, 0.28);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tag-item,
  .spinner {
    animation: none;
    transition: none;
  }

  .tag-item:hover {
    transform: none;
  }
}
</style>
