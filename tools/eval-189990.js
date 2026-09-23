// 在 189990.xyz 页面上下文内执行：拉取全部分类与全量商品，返回 JSON 字符串
(async () => {
  const j = async (u) => {
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    return r.json();
  };
  const cats = await j('/api/v1/public/categories');
  const first = await j('/api/v1/public/products?page=1&page_size=100');
  let items = (first.data || []).slice();
  const total = (first.meta && (first.meta.total || first.meta.total_count)) || items.length;
  const size = 100;
  const pages = Math.ceil(total / size);
  for (let p = 2; p <= pages; p++) {
    const r = await j('/api/v1/public/products?page=' + p + '&page_size=' + size);
    items = items.concat(r.data || []);
  }
  return JSON.stringify(
    { total, fetched: items.length, categories: cats.data || [], products: items },
    null,
    1
  );
})();
