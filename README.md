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
node test-features.js       # 密码重置 / 多语言 / USDT 通道 / 信用卡·PayPal 功能断言
node test-bepusdt.js        # BEpusdt 网关接入（签名金标准 / 下单·回调全链路 / 验签与幂等）
node test-source-import.js  # 货源导入商品（免填账号类）全链路断言
node test-new-goods.js      # 新增货源商品（GPT 卡密 / X Premium+ / CheJiu 档位）断言
node check-dom.js           # 前端静态一致性（DOM id / 内联函数 / CSS 类 / 脚本语法）
node visual-check.js        # 真实浏览器渲染 21 个页面并截图到 shots/
```

忘记后台密码时（无需旧密码，离线重置）：

```bash
node tools/reset-admin.js --list              # 查看现有管理员与口令状态
node tools/reset-admin.js 'YourNewPass#2026'  # 重置 admin 的口令（先停服）
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
│   ├── payment.js         # 支付网关适配（扫码 / USDT / 信用卡 / PayPal）
│   └── i18n.js            # 访问者语言识别（IP 归属地 + Accept-Language）
├── tools/
│   ├── import-source.js   # 货源清单批量导入器（upsert 分类/来源/商品）
│   ├── reset-admin.js     # 管理员口令离线重置（忘记密码时的救援通道）
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
支付方式开关 + 国内扫码网关参数 + **各收款通道独立参数**：

| 通道 | 可维护参数 |
| --- | --- |
| 支付宝 / 微信 / QQ钱包 | 网关类型（易支付 / 当面付 / Native）、商户 ID、密钥、异步通知地址、沙箱开关 |
| **USDT 收款** | **收款模式（手动地址 / BEpusdt 网关）**、收款网络（TRC20 / ERC20 / BEP20 / Polygon / Solana）、收款地址、汇率（1 USDT = ? CNY）、最小收款金额、需要确认数、支付窗口、金额加唯一尾数（便于链上对账）、二维码模板、收银台提示语；选网关模式时另可维护 BEpusdt 网关地址、对接令牌、交易类型、法币、超时、回调地址等（见 5.1） |
| **国际信用卡** | 服务商（Stripe Checkout / 通用托管页）、结算币种、汇率、账单显示名、Publishable Key、Secret Key（仅服务端）、接口地址、通用托管页模板 |
| **PayPal** | 收款账号（邮箱）、模式（Sandbox / Live）、结算币种、汇率、IPN 通知地址、Client ID / Secret（可选） |

> 安全约定：`Secret Key` / `Client Secret` / `merchantKey` **只保留在服务端**，`/api/store` 只下发地址、汇率、币种、Publishable Key 等公开信息（`payInfo`），前端拿不到任何密钥。

### 5.1 数字货币收款：接入 [BEpusdt](https://github.com/v03413/BEpusdt) 网关（可选）

默认的 USDT 收款是「固定地址 + 买家回填 TxID + 人工核验」。若希望**逐单收款地址 + 链上自动确认 + 订单自动完成**，把 USDT 通道的「收款模式」切换为 **BEpusdt 网关** 即可，其余支付方式不受影响。

| 对比项 | 手动地址模式（默认） | BEpusdt 网关模式 |
| --- | --- | --- |
| 收款地址 | 全站一个固定地址 | 网关**逐单分配**独立地址，天然便于对账 |
| 金额匹配 | 靠唯一尾数人工核对 | 网关按金额 + 地址自动匹配 |
| 到账确认 | 买家回填 TxID，人工核验 | 网关扫描链上确认后**回调自动完成订单** |
| 订单状态 | `paid` 后需人工推进 | 回调 `status=2` 自动置为已支付并触发派单 |
| 超时处理 | 无 | 回调 `status=3` 自动关闭订单 |
| 部署成本 | 零依赖 | 需自建 BEpusdt（Docker 一行启动，默认 8080 端口） |

**接入步骤**

```bash
# 1) 部署网关（与平台同机即可，走 127.0.0.1 内网）
docker run -d --restart=unless-stopped -p 8080:8080 v03413/bepusdt:latest
# 2) 打开 http://服务器IP:8080 完成初始化，在
#    「系统管理 → 基本设置 → API 设置 → 对接令牌」复制令牌
# 3) 平台后台「支付配置 → USDT 收款通道设置」：
#    收款模式 = BEpusdt 网关；填 网关地址 + 对接令牌；选 交易类型（如 usdt.trc20）
# 4) 点「🔌 测试网关连通性」——会真实创建一笔 1 法币的最小订单并立即取消，
#    用于验证地址 / 令牌 / 签名，并返回签名原串供核对
# 5) 关闭「沙箱模式」后生效（沙箱开启时仍走本地模拟）
```

**协议要点（实现依据）**

| 项 | 说明 |
| --- | --- |
| 下单 | `POST {gatewayUrl}/api/v1/order/create-transaction`，返回 `trade_id`、`token`（逐单收款地址）、`actual_amount`（加密货币应付）、`payment_url`（网关收银台） |
| 收银台模式 | 通道开关「使用网关收银台」改走 `create-order`，由买家在网关页面自选币种 / 网络 |
| 签名 | 非空参数按 key **ASCII 字典序**拼 `k=v&k=v`，末尾**直接追加** `apiToken`（无 `&`），**MD5 取小写** |
| 回调 | `POST {站点}/api/callback/bepusdt`，含 `order_id / amount / actual_amount / token / block_transaction_id / signature / status`；`status`：1=等待支付（每分钟推送）、2=支付成功、3=支付超时 |
| 应答 | 成功返回纯文本 `ok`（官方两份文档分别写了 `ok` / `success`，可在通道配置「回调应答文本」中切换） |
| 幂等 | 已越过待支付的订单收到重复 `status=2` 只记日志不重复处理；已进入终态的订单不回溯改状态 |
| 验签 | 回调**强制验签**（恒定时间比较），失败应答 `SIGN_ERROR` 并写审计日志 |

> ⚠️ 两点注意：
> 1. 平台「支付配置 → 沙箱模式」与「系统设置 → 全站沙箱模式」是**两个独立开关**：前者控制支付通道，后者控制上游充值通道。
> 2. 金额按「最短数值字符串」参与签名与传输（`20` 而非 `20.00`），避免与网关侧数值解析不一致导致验签失败；签名金标准已用官方文档样例做过断言（见 `test-bepusdt.js` A 段）。

### 6. 前台多语言
- **默认英语**；打开后台「系统设置 → 前台多语言」可切换默认语言。
- **按访问者 IP 自动切换**：服务端取 `X-Forwarded-For` / `X-Real-IP`，查询 IP 归属国，中国 / 港澳台 → 中文，其余 → 英语；查询失败自动回退 `Accept-Language`，仍不确定则用默认语言（不会阻塞页面）。
- **手动切换**：前台右上角语言按钮，选择写入 `localStorage` 后**不再被 IP 识别覆盖**；也支持 `?lang=zh` / `?lang=en` 强制指定。
- 界面文案与商品/分类/套餐文案均可翻译：内容词条以「中文原文 → 英文」的方式维护在 `public/assets/i18n.js`，命中即翻译，未命中则原样展示。
- 后台「系统设置」提供 **IP 识别自测**（输入任意 IP 看判定结果与依据）与缓存状态展示。

### 7. 系统设置
站点名称/标语/公告、客服信息、订单支付有效期、低库存阈值、
支付后自动派单开关、**全站沙箱开关**、**多语言配置（默认语言 / 是否按 IP 自动切换 / IP 接口与缓存）**、
**修改管理员密码**（独立弹窗、二次确认、口令强度校验、改密后注销其他会话）、演示数据重置。

### 8. 操作日志
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
| GET | `/api/store` | 前台全量数据（设置/分类/支付方式/商品+套餐/收款公开信息 payInfo） |
| GET | `/api/locale` | 语言识别（按访问者 IP 归属地 → zh / en，返回识别依据） |
| GET | `/api/recent` | 首页实时成交动态（账号已脱敏） |
| POST | `/api/orders` | 创建订单（含账号格式与二次确认校验） |
| POST | `/api/orders/:no/pay` | 模拟支付并触发自动派单 |
| POST | `/api/orders/query` | 按订单号/充值账号查询 |
| POST | `/api/callback/supplier` | 上游异步回调 |
| POST | `/api/callback/bepusdt` | **BEpusdt 数字货币网关回调**（强制验签 + 幂等 + 超时关单） |
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
| GET/POST | `/api/admin/settings` | 系统设置（站点 / 交易参数 / 多语言 / 支付配置与各通道参数） |
| POST | `/api/admin/password` | **修改管理员密码**（校验 + 二次确认 + 注销其他会话 + 审计日志） |
| GET | `/api/admin/i18n/test` | 语言识别自测（`?ip=114.114.114.114`） |
| POST | `/api/admin/pay/bepusdt/test` | **BEpusdt 网关连通性自测**（真实创建并取消最小订单，返回签名原串） |
| GET | `/api/admin/logs` | 操作日志 |

---

## 八、上线前需要处理的事项

当前实现是**完整的业务骨架 + 沙箱模拟**，正式对外运营前建议补齐：

1. **数据存储**：`data/db.json` 适合单机小流量。并发上量后请迁移到 MySQL / PostgreSQL（`lib/db.js` 的 `get()/save()` 是唯一出入口，替换成本低）
2. **支付接入**：国内扫码通道把 `payConfig` 换成真实易支付 / 当面付 / 微信 Native；信用卡在「支付配置 → 国际信用卡」填入 Stripe 密钥即在服务端创建 Checkout Session；PayPal 在「支付配置 → PayPal」填收款邮箱并选 Live；数字货币推荐按 5.1 接入 BEpusdt 网关（**该通道回调已强制验签**）。**上线前必须在 `POST /api/callback/pay` 补做签名校验**（易支付/信用卡/PayPal 这条通用回调目前未验签，任何人可伪造支付成功；BEpusdt 走独立回调已验签）
3. **上游密钥加密**：`appSecret` / `secretKey` / `clientSecret` 目前以明文存在 `data/db.json`，建议改为环境变量或 KMS 加密
4. **后台安全**：口令已改为 scrypt 加盐哈希存储并加了「10 分钟 5 次失败锁定」，默认口令 `admin888` 仍必须修改；建议再加验证码、IP 白名单、操作二次确认
5. **多语言**：IP 归属地查询默认走 `ip-api.com` 免费接口（HTTP，45 次/分钟）。正式运营建议换成自有 IP 库或商业接口，并在后台「系统设置 → 前台多语言」调大缓存时长
6. **合规**：虚拟商品代充业务需关注平台服务协议、发票、实名与风控要求，避免代充来源不明的账号。
   **账号类商品（如本批 `p18`~`p26` 的邮箱账号）风险更高**：货源方自身即声明「仅为有偿租用，仅限合法邮件接收与验证，禁止诈骗 / 赌博 / 洗钱 / 非法批量注册 / 绕过平台风控」，且账号所有权仍在货源方。这类商品在多数平台的服务条款下属于高风险用途，建议保留商品说明与合规声明、限制单笔/单人购买数量、对异常订单人工复核，并自行评估是否值得上架
7. **可靠性**：为「充值中」订单加定时对账任务（轮询上游查单接口），避免回调丢失导致订单卡住
8. **加密货币收款**：默认是「固定地址 + 买家回填 TxID」的人工核验模式；**如需自动到账与逐单地址，推荐接入 BEpusdt 网关（见 5.1）**，无需自研链上监听

---

_本平台为演示/自用系统，与任何官方平台无授权关系。_
