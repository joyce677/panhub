import { defineEventHandler, getQuery } from "h3";
import { fetchDoubanHot } from "../core/services/doubanHotService";

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const categoriesParam = (query.categories as string) || "";
    const categories = categoriesParam
      ? categoriesParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const data = await fetchDoubanHot(categories);

    return {
      code: 0,
      message: "success",
      data: {
        categories: data.categories,
      },
    };
  } catch (error) {
    console.error("[GET /api/douban-hot] 错误:", error);
    return {
      code: -1,
      message: "获取豆瓣热搜失败",
      data: { categories: {} },
    };
  }
});
