/**
 * 豆瓣热搜数据源配置
 * 对应 DailyHotApi 路由
 */

export const DOUBAN_HOT_SOURCES = [
  { id: "douban-movie", label: "电影", route: "douban-movie" },
  { id: "douban-group", label: "讨论精选", route: "douban-group" },
] as const;

export const DAILYHOT_API_BASE = "https://api-hot.imsyy.top";
