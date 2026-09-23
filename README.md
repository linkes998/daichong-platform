# 云充站 · 虚拟商品会员代充交易平台

一套可直接运行的账号会员套餐代充交易平台（前台商城 + 运营后台），**零第三方依赖**，只需要 Node.js。

- 前台：无需注册登录，选套餐 → 填充值账号 → 支付 → 自动充值 → 订单号查单
- 后台：商品/套餐、**商品来源（上游 API 通道）**、订单、支付、系统设置、操作日志

---

## 一、快速启动

```bash
cd daichong-platform
node server.js
```

打开浏览器：

| 入口 | 地址 | 账号 |
| --- | --- | --- |
| 前台商城 | http://localhost:8899/ | 无需登录 |
| 订单查询 | http://localhost:8899/query.html | 无需登录 |
| 运营后台 | http://localhost:8899/admin.html | `admin` / `admin888` |

改端口：`PORT=9000 node server.js`

自检脚本：

```bash
node test-e2e.js            # 主干链路端到端断言
node test-source-import.js  # 货源导入商品（免填账号类）全链路断言
node test-new-goods.js      # 新增货源商品（GPT 卡密 / X Premium+ / CheJiu 档位）断言
node check-dom.js           # 前端静态一致性（DOM id / 内联函数 / CSS 类）
node visual-check.js        # 真实浏览器渲染 14 个页面并截图到 shots/
```

> **当前为沙箱模式**：支付与上游充值接口都是本地模拟，不会产生真实交易。数据全部落在 `data/db.json`，删除该文件即可恢复初始种子数据。
> `visual-check.js` 会复用 `shots/profile` 下的浏览器配置，因此**服务重启后再跑**可能因浏览器里残留的旧 Token 在后台登录页产生一个 401 提示，删掉 `shots/profile` 再跑即可。

---

## 二、目录结构

```
daichong-platform/
├── server.js              # HTTP 服务 + 全部 API 路由（零依赖）
├── test-e2e.js            # 主干链路端到端自检
├── test-source-import.js  # 货源导入商品（免填账号类）自检
├── test-new-goods.js      # 新增货源商品（GPT / X Premium+ / CheJiu 档位）自检
├── check-dom.js           # 前端静态一致性检查
├── visual-check.js        # CDP 真实浏览器渲染检查 + 截图
├── lib/
│   ├── db.js              # JSON 数据层（原子写入）
│   ├── supplier.js        # 商品来源/上游 API 对接（签名、重试、沙箱）
│   └── payment.js         # 支付网关适配
├── tools/
│   ├── import-source.js   # 货源清单批量导入器（upsert 分类/来源/商品）
│   ├── grab-site.js       # 货源站抓取探针（站点类型与接口线索识别）
│   ├── grab-spa.js        # CDP 渲染抓取（捕获 XHR/fetch 响应 + 页面内执行脚本）
│   ├── parse-next-flight.js # Next.js App Router 首屏数据（flight）解析
│   ├── verify-patches.js  # 改动标记自检
│   └── free-port.js       # 释放端口占用
├── data/
│   ├── seed.json          # 初始种子：30 商品 / 66 套餐 / 9 通道
│   ├── db.json            # 运行时数据（首次启动自动生成）
│   └── source-import/     # 第三方货源站商品清单归档（可重复导入）
└── public/
    ├── index.html         # 商城首页
    ├── query.html         # 订单查询
    ├── pay.html           # 独立收银台
    ├── admin.html         # 运营后台
    └── assets/            # theme.css / store.css / admin.css / app.js / store.js / admin.js / query.js
```

---

## 三、购买流程（已按需简化为一屏下单）

参考站的流程是「专区 → 商品 → 下单页 → 支付 → 等处理」，本平台压缩为：

1. 首页商品卡片点 **立即购买**
2. 弹窗内完成：**选套餐 → 填充值账号 → 选支付方式**（无需跳页、无购物车、无结算步骤）
3. 点「去支付」即在弹窗内切到收银台，扫码后自动充值
4. 结果页展示订单号、上游单号与完整处理日志

细节设计：

- **充值账号字段可配置**：每个商品可设置账号类型（手机号 / 邮箱 / UID / @用户名 / 游戏区服+角色 / 通用账号）、字段名、输入提示、填写说明
- **免填账号商品类型**：账号 / 卡密类商品（如 iCloud 邮箱账号）设置 `accountType = none` 后，下单弹窗自动隐藏「填写充值账号」步骤，订单账号字段留空、改为显示「自动发货（免填账号）」，第二/三步合并为「订单信息 → 支付方式」
- **实时格式校验**：手机号、邮箱、UID 在前端即时校验，后端二次校验
- **二次确认**：高风险商品可开启「重复输入一遍账号」，两次不一致直接拒绝下单
- **商品说明与使用须知**：每个商品可配置一段说明（`notice`），直接展示在下单弹窗里，适合放使用限制与合规声明
- **售罄状态**：套餐库存为 0 时商品卡显示「售罄」角标并禁用购买按钮，进下单弹窗也会被拦截
- **免登录查询**：用订单号或联系方式即可在查询页查看进度，无需注册

---

## 四、后台管理功能

### 1. 数据概览
今日订单/销售额/毛利、累计营收、充值成功率、待处理订单、上游通道余额；
近 7 日经营趋势（销售额柱 + 订单量折线）、分类销售占比、通道健康度、最近订单。

### 2. 订单管理
状态筛选（待支付 / 已支付待充值 / 充值中 / 已完成 / 充值失败 / 已退款）、
订单号/账号/商品/上游单号搜索、**批量派单**、**导出 CSV**（Excel 可直接打开）、
订单抽屉：完整字段 + 处理日志时间线 + 重试派单 / 标记完成 / 标记失败 / 退款 / 加备注。

### 3. 商品与套餐
商品增删改（名称、副标题、分类、图标、主题色、角标、标签、排序、上架状态）、
**充值账号字段配置**（含「免填（账号 / 卡密类商品）」）、**商品说明与使用须知**（展示在下单弹窗内）、
套餐编辑器（面值 / 售价 / 成本 / 库存 / 绑定通道 / 上游 SKU 编码），
列表直接显示每个套餐的**毛利率**。

### 4. 商品来源 / API 通道 ★
这是核心。可维护任意多个上游供货通道：

| 配置项 | 说明 |
| --- | --- |
| 接入模式 | API 接口 / 本地模拟 / 人工工位 |
| 接口地址 | `apiUrl` + 下单路径 `orderPath` + 查单路径 `queryPath` |
| 请求方式 | POST/GET，请求体 form-urlencoded 或 JSON |
| 鉴权 | AppId、AppSecret、签名方式（MD5 / HMAC-SHA256 / 不签名） |
| 供货策略 | 加价率、优先级、超时、失败重试次数、通道余额 |
| 支持分类 | 按分类限定通道，未勾选表示不限 |
| 模拟参数 | 沙箱成功率、模拟处理时长（用于演示与联调） |

- **优先级 + 分类** 决定自动选路：商品套餐显式绑定的通道优先，否则按分类匹配、优先级从高到低选
- **测试连通性**：一键查看实际会发送的请求参数与签名原串，可直接复制给上游开发核对
- **沙箱模式**：全站开关。开启时不发起真实 HTTP 请求，走本地模拟（可设成功率/延时），便于演示；关闭后即真实对接

### 5. 支付配置
支付宝 / 微信 / QQ钱包 / USDT / 卡密 支付方式开关、网关类型与商户参数、异步通知地址、沙箱开关。

### 6. 系统设置
站点名称/标语/公告、客服信息、订单支付有效期、低库存阈值、
支付后自动派单开关、**全站沙箱开关**、管理员密码修改、演示数据重置。

### 7. 操作日志
登录、商品/通道变更、订单操作等关键行为留痕（保留最近 800 条）。

---

## 五、上游对接协议

接入一个新上游只需实现两个接口。

**① 下单** `POST {apiUrl}{orderPath}`

```json
{
  "appId": "CY10086",
  "outTradeNo": "DC20260920A1B2C3",
  "skuCode": "IQIYI_GOLD_1M",
  "account": "13800138000",
  "quantity": "1",
  "notifyUrl": "https://你的域名/api/callback/supplier",
  "timestamp": "1789000000",
  "nonce": "a1b2c3d4e5f6",
  "sign": "大写HEX"
}
```
返回：`{ "code": 0, "msg": "ok", "data": { "supplierOrderNo": "SP123", "status": "PENDING" } }`

**② 查单** `POST {apiUrl}{queryPath}` — 参数同上（去掉业务字段），返回 `data.status`。

**③ 签名规则**

1. 取所有非空参数（不含 `sign`），按 key 字典序升序
2. 拼成 `k=v&k=v&...`
3. MD5：末尾追加 `&key={appSecret}` 后取 MD5 大写；HMAC-SHA256：直接对拼接串做 HMAC-SHA256 取大写
4. `code` 非 0 视为业务失败；`status` 取值 `PENDING` / `SUCCESS` / `FAILED`

**④ 回调** `POST /api/callback/supplier`，请求体含 `outTradeNo`、`status`、`supplierOrderNo`，响应纯文本 `SUCCESS`。
支付网关回调：`POST /api/callback/pay`。

---

### ⑤ 从第三方货源站批量导入商品

适合「先批量上架一批别人的货，再逐个换成自己的通道」这种冷启动方式。

1. 抓取货源站的商品数据（分类、名称、价格、库存、销量），整理成清单放到 `data/source-import/<货源名>.json`

   抓取姿势按站点类型选：

   | 站点类型 | 特征 | 抓法 |
   | --- | --- | --- |
   | 独角数卡 / 自研 API 站 | 页面 HTML 无商品数据，有 `/user/api/index/commodity`、`/api/v1/public/products` 之类接口 | `node tools/grab-site.js <url>` 探路，再直接调接口 |
   | Next.js App Router | HTML 里有 `self.__next_f.push(...)` | `node tools/parse-next-flight.js <html> initialProducts` 解析首屏数据 |
   | 纯前端渲染 + 接口反爬（直连被 ECONNRESET） | 源码只有页面骨架 | `node tools/grab-spa.js --url <地址> --eval-file <脚本>`：用本机 Chrome 真实渲染，捕获接口响应并在页面上下文里同源 fetch 拉全量 |

2. 执行导入器：

```bash
node tools/import-source.js --dry                               # 先校验 + 预览，不写盘
node tools/import-source.js data/source-import/xxx.json         # 写入 data/db.json
node tools/import-source.js data/source-import/xxx.json --seed  # 同时写入初始化模板 seed.json
```

3. 后台「商品与套餐」核对商品，在「商品来源 / API 通道」把通道参数换成真实货源接口

清单结构：

```json
{
  "source":     { "name": "货源名", "site": "https://…", "pickedAt": "2026-09-21", "method": "抓取方式说明" },
  "supplier":   { "id": "s7", "name": "…", "apiUrl": "…", "categories": ["c6", "c7"] },
  "categories": [ { "id": "c6", "name": "…", "icon": "📧", "hue": "#8b5cf6", "sort": 6 } ],
  "products":   [ { "id": "p18", "catId": "c6", "name": "…", "accountType": "none",
                    "skus": [ { "id": "p18-s1", "price": 2, "cost": 2, "stock": 4569,
                                "supplierId": "s7", "supplierSku": "ICLOUD_LONG_MAIL" } ] } ]
}
```

导入器按 `id` upsert（新增或覆盖），**不动 orders / logs / admins / settings**，保留商品原有 `sales`，并写一条 `source.import` 操作日志。写入前会做完整性校验（内 id 重复、缺 `catId`、套餐无售价、绑定的通道不存在等），不通过直接中止。

> ⚠️ 服务运行时会整库读写 `data/db.json`。导入前请先停服（`node tools/free-port.js 8899`），导入完再启动，否则内存里的旧数据可能在下次保存时把导入结果覆盖掉。

已归档的货源清单：

| 清单 | 货源 | 导入内容 |
| --- | --- | --- |
| `data/source-import/icloud011.json` | icloud011.com（iCloud / Hotmail 邮箱账号，自动发货型） | 3 个分类（`c6` iCloud 邮箱、`c7` 平台专用验证邮箱、`c8` Hotmail 令牌邮箱）+ 1 个通道（`s7`）+ 9 个商品（`p18`~`p26`）。均为 `accountType = none` 免填账号；价格 / 库存 / 销量按抓取时点快照**原价上架**（`cost = price`，未加价），其中 Hotmail 令牌邮箱库存为 0，前台显示售罄 |
| `data/source-import/189990-yumixu.json` | 189990.xyz（玉米须AI服务 / 布肝，独角数卡 Next 版） | 1 个分类（`c9` AI 会员）+ 1 个通道（`s9`）+ 3 个商品（`p27`~`p29`，GPT Plus / Pro 5x / Pro 20x 充值卡密）。站点接口全站仅这 3 款在售（其余分类货架为空）。`accountType = none` 免填账号（卡密类）；售价取接口原值、`cost = price`，接口的 `reference_price` 作为划线原价；库存 / 销量按快照 |
| `data/source-import/chejiu888.json` | chejiu888.online（CheJiu.VIP，X / TG 会员代充） | 1 个通道（`s8`）。商品为**合并式导入**：`p15` X Premium 新增「3 个月 ¥30 / 6 个月 ¥50」两个 CheJiu 档位，`p16` Telegram Premium 新增「3 / 6 / 12 个月」档位，并新增 `p30` X Premium+（3 / 6 / 12 个月）。原有 `s3` 通道的档位**保留不动**，同一商品下可按渠道对比取舍。站点未公开库存与成本，档位库存按人工可接单量预设 |


## 六、订单状态与自动化

```
待支付 ──支付──▶ 已支付·待充值 ──派单──▶ 充值中 ──上游回调──▶ 已完成
                    │                      │
                    └──────失败────────────┴──▶ 充值失败 ──退款──▶ 已退款
```

自动化链路：支付成功 → 自动选路 → 调用上游下单接口（带签名、超时、失败重试）→
上游同步返回成功则直接完成；返回 PENDING 则等待异步回调 / 定时结算 → 写入日志、扣库存、累加销量。
「人工工位」通道的订单不会自动完成，需在后台点「标记完成」。

---

## 七、主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/store` | 前台全量数据（设置/分类/支付方式/商品+套餐） |
| GET | `/api/recent` | 首页实时成交动态（账号已脱敏） |
| POST | `/api/orders` | 创建订单（含账号格式与二次确认校验） |
| POST | `/api/orders/:no/pay` | 模拟支付并触发自动派单 |
| POST | `/api/orders/query` | 按订单号/充值账号查询 |
| POST | `/api/callback/supplier` | 上游异步回调 |
| POST | `/api/admin/login` | 后台登录（返回 Bearer Token） |
| GET | `/api/admin/overview` | 经营看板数据 |
| GET | `/api/admin/orders` | 订单列表（筛选/搜索/分页） |
| POST | `/api/admin/orders/:no/action` | 重试派单/完成/失败/退款/关闭/备注 |
| POST | `/api/admin/orders/batch-dispatch` | 批量派单 |
| GET | `/api/admin/orders/export` | 导出 CSV |
| GET/POST | `/api/admin/products` | 商品列表 / 新增或更新 |
| POST | `/api/admin/products/:id/skus` | 保存套餐 |
| GET/POST | `/api/admin/suppliers` | 商品来源通道列表 / 新增或更新 |
| POST | `/api/admin/suppliers/:id/test` | 通道连通性测试 |
| GET/POST | `/api/admin/settings` | 系统设置（含支付配置、管理员密码） |
| GET | `/api/admin/logs` | 操作日志 |

---

## 八、上线前需要处理的事项

当前实现是**完整的业务骨架 + 沙箱模拟**，正式对外运营前建议补齐：

1. **数据存储**：`data/db.json` 适合单机小流量。并发上量后请迁移到 MySQL / PostgreSQL（`lib/db.js` 的 `get()/save()` 是唯一出入口，替换成本低）
2. **支付接入**：在 `lib/payment.js` 中把 `createPayment` 换成易支付 / 支付宝当面付 / 微信 Native 的真实下单，回调走 `POST /api/callback/pay` 并补做签名校验
3. **上游密钥加密**：`appSecret` 目前明文存储，建议改为环境变量或 KMS 加密
4. **后台安全**：默认口令 `admin888` 必须修改；建议加验证码、登录失败锁定、IP 白名单、操作二次确认
5. **合规**：虚拟商品代充业务需关注平台服务协议、发票、实名与风控要求，避免代充来源不明的账号。
   **账号类商品（如本批 `p18`~`p26` 的邮箱账号）风险更高**：货源方自身即声明「仅为有偿租用，仅限合法邮件接收与验证，禁止诈骗 / 赌博 / 洗钱 / 非法批量注册 / 绕过平台风控」，且账号所有权仍在货源方。这类商品在多数平台的服务条款下属于高风险用途，建议保留商品说明与合规声明、限制单笔/单人购买数量、对异常订单人工复核，并自行评估是否值得上架
6. **可靠性**：为「充值中」订单加定时对账任务（轮询上游查单接口），避免回调丢失导致订单卡住

---

_本平台为演示/自用系统，与任何官方平台无授权关系。_
