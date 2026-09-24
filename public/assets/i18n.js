/* ============================================================
   前台多语言（i18n）
   ------------------------------------------------------------
   · 默认语言：英语（en）
   · 自动识别：调用 /api/locale，服务端按访问者 IP 归属地判定
     （中国 / 港澳台 → 中文，其余 → 英语），失败时回退浏览器语言
   · 手动切换：右上角语言按钮，选择结果写入 localStorage 并优先生效
   · 翻译来源两份词条：
       UI 键（如 nav.home）  → 界面文案
       中文原文（如「视频会员」）→ 数据库里的商品/分类/SKU 文案
   · 用法： t('nav.home') 或 t(p.name)，前者查 UI 词条，后者查内容词条
   ============================================================ */

let LANG = 'en';

const LANG_KEY = 'store_lang';

/* ------------------------------------------------------------------ */
/* 界面词条                                                            */
/* ------------------------------------------------------------------ */

const UI = {
  en: {
    'brand.name': 'YunChong',
    'brand.sub': 'Membership Top-up · Instant Delivery',
    'brand.sub2': 'Cashier',
    'nav.home': 'Home',
    'nav.products': 'All Products',
    'nav.query': 'Order Lookup',
    'nav.faq': 'FAQ',
    'nav.service': 'Contact',
    'nav.admin': 'Admin',
    'notice.label': 'Notice',
    'sys.ok': 'All Systems Normal',
    'sys.sandbox': 'Sandbox Mode',

    'hero.badge': 'No sign-up · No password · One-screen checkout',
    'hero.title1': 'One-stop',
    'hero.title2': 'Membership Top-up',
    'hero.chip.auto': '⚡ Auto Recharge',
    'hero.chip.official': '🛡️ Official Channel',
    'hero.chip.refund': '↩️ Refund on Failure',
    'hero.chip.support': '🕘 Support 09:00-23:00',
    'hero.searchPh': 'Search products, e.g. "iQIYI", "X Premium", "Game Credits"',
    'hero.stat.orders': 'Orders Completed',
    'hero.stat.goods': 'Products on Sale',
    'hero.stat.rate': 'Avg. Delivery Time',
    'hero.stat.rateValue': '1 min',

    'live.title': 'Live Recharge Feed · Just Completed',
    'live.bought': 'purchased',

    'hubs.title': 'Choose Your Service Zone',
    'hubs.sub': 'Dedicated zones · Dedicated channels · Secure checkout',
    'hubs.count': '{0} zones · {1} products',
    'hubs.enter': 'Enter zone →',
    'hubs.goods': '{0} products',

    'products.title': 'Available Products',
    'products.all': 'All Zones',
    'products.empty': 'No matching products. Try another keyword.',
    'products.buy': 'Buy Now',
    'products.soldOut': 'Sold Out',
    'products.from': ' from',
    'products.sold': 'Sold {0}',
    'products.stockLeft': 'Stock {0}',
    'products.noStock': 'Out of stock',
    'products.skuCount': '{0} plans',

    'flow.title': 'Checkout in 30 Seconds',
    'flow.sub': 'We compressed the flow: pick a plan, enter your account, pay. Nothing else.',
    'flow.s1': 'STEP 01',
    'flow.h1': 'Pick a Plan',
    'flow.p1': 'Choose monthly / quarterly / yearly plans right inside the product dialog. No page jumps.',
    'flow.s2': 'STEP 02',
    'flow.h2': 'Enter Account',
    'flow.p2': 'Only the account to recharge. No password, no login authorization.',
    'flow.s3': 'STEP 03',
    'flow.h3': 'Pay Securely',
    'flow.p3': 'Alipay, WeChat, QQ Wallet, USDT, credit card or PayPal. Scan or redirect to pay.',
    'flow.s4': 'STEP 04',
    'flow.h4': 'Auto Recharge',
    'flow.p4': 'After payment the system submits to the upstream channel automatically. Track progress by order number.',

    'faq.title': 'Frequently Asked Questions',
    'faq.sub': 'A quick read before ordering saves a lot of back-and-forth',
    'faq.q1': 'Do you need my account password?',
    'faq.a1': 'No. All products use official top-up or family-group invitations. You only provide the account to recharge (phone number / UID / @username). We never ask for passwords or verification codes.',
    'faq.q2': 'How long does delivery take?',
    'faq.a2': 'Most orders complete automatically within 1-5 minutes after payment. Overseas zone products (X / Telegram / YouTube) are processed by a hybrid of staff and bots, usually within 10 minutes. If it takes longer than 30 minutes, contact support with your order number.',
    'faq.q3': 'What if I entered the wrong account?',
    'faq.a3': 'The account cannot be edited after submission. If the order is still <b>unpaid</b>, close it and place a new one. If already paid, contact support immediately — we may intercept it before the upstream accepts it, but accepted orders cannot be recalled.<br><b>Please double-check the account before ordering. Products with re-confirmation enabled require you to type it twice.</b>',
    'faq.q4': 'Do you refund failed recharges?',
    'faq.a4': 'Yes. If the upstream reports failure without charging, the order is marked "Failed" and support refunds it to the original payment method (usually within 1-24 hours). If the upstream already charged due to a wrong account, no refund is possible.',
    'faq.q5': 'How do I check my order?',
    'faq.a5': 'Open the Order Lookup page and enter your order number or the account you submitted. No registration required.',
    'faq.q6': 'Will the membership drop? Any risk?',
    'faq.a6': 'We use official low-price regions and legitimate family-group channels; under normal use it will not drop. There is a very small chance of issues if your account triggers platform risk control (frequent logins from different locations, profile changes). Contact support for a one-time replacement in that case.',

    'footer.desc': 'A virtual goods top-up platform for individuals and small merchants. Every transaction is traceable by order number.',
    'footer.col.service': 'Service',
    'footer.col.support': 'Support',
    'footer.col.compliance': 'Compliance',
    'footer.tg': 'Telegram',
    'footer.wechat': 'WeChat',
    'footer.qq': 'QQ',
    'footer.workTime': 'Hours',
    'footer.c1': 'We provide top-up services only; not an official authorized site',
    'footer.c2': 'Do not order with accounts of unknown origin',
    'footer.c3': 'Virtual goods are non-refundable once delivered successfully',
    'footer.copyright': '© 2026 YunChong · Demo System',
    'footer.sandboxNote': 'Demo environment. Payment and upstream recharge are simulated; no real transactions occur.',

    'modal.title': 'Confirm Your Order',
    'modal.sec1': 'Select Plan',
    'modal.sec2': 'Quantity',
    'modal.sec3': 'Enter {0}',
    'modal.sec3none': 'Order Information',
    'modal.confirmLabel': 'Confirm account again',
    'modal.confirmPh': 'Type it once more to avoid mistakes',
    'modal.qtyHint': 'Up to 10 per order; multiple units recharge the same account consecutively',
    'modal.qtyHintNone': 'Up to 10 per order; each unit is a separate account delivered individually',
    'modal.contact': 'Contact',
    'modal.contactOpt': ' (optional, so we can reach you if anything goes wrong)',
    'modal.contactPh': 'Phone / Email / Telegram',
    'modal.remark': 'Order Note',
    'modal.remarkOpt': ' (optional)',
    'modal.remarkPh': 'e.g. different accounts, please ship separately',
    'modal.pay': 'Payment Method',
    'modal.amount': 'Subtotal',
    'modal.fee': 'Processing Fee',
    'modal.total': 'Amount Due',
    'modal.submit': 'Pay Now',
    'modal.agree': 'By submitting you confirm the account is correct. <b style="color:var(--danger)">Wrong accounts cannot be refunded.</b>',
    'modal.agreeNone': 'Virtual goods <b style="color:var(--danger)">cannot be refunded once delivered</b>. Please confirm before ordering.',
    'modal.expire': 'Order valid for {0} minutes',
    'modal.noticeTitle': 'Product Notes & Usage Policy',
    'modal.trust1': '🔒 No password needed',
    'modal.trust2': '⚡ Auto recharge',
    'modal.trust3': '↩️ Refund on failure',
    'modal.placeholder.account': 'Enter your account',

    'cashier.title': 'Scan to Pay',
    'cashier.created': 'Order created',
    'cashier.expire': 'Time left to pay',
    'cashier.product': 'Product',
    'cashier.account': 'Account',
    'cashier.delivery': 'Delivery',
    'cashier.auto': 'Auto delivery (no account required)',
    'cashier.sandboxTitle': 'Sandbox demo checkout',
    'cashier.sandboxText': 'The QR code cannot be paid for real. Click the button below to simulate a successful payment; the system will immediately trigger auto recharge and show the full flow.',
    'cashier.mockPay': '✅ Simulate Successful Payment (Demo)',
    'cashier.iPaid': 'I have completed payment',
    'cashier.later': 'Later (find it later via Order Lookup)',
    'cashier.autoNote': 'Recharge starts automatically after payment; this page refreshes itself.',
    'cashier.help': 'Payment issue? Contact support {0}',

    'usdt.title': 'USDT Transfer',
    'usdt.network': 'Network',
    'usdt.address': 'Receiving Address',
    'usdt.amount': 'Amount Due',
    'usdt.rate': 'Reference Rate',
    'usdt.rateUnit': '1 USDT = ¥{0}',
    'usdt.memo': 'Memo',
    'usdt.memoHint': 'Please include the order number {0} in the transfer memo',
    'usdt.tips': 'Notes',
    'usdt.txid': 'Transaction Hash (TxID)',
    'usdt.txidPh': 'Paste the on-chain transaction hash',
    'usdt.txidHint': 'Paste the TxID after transferring so we can verify the payment.',
    'usdt.txidRequired': 'Please enter the transaction hash (TxID) of your transfer',
    'usdt.submit': 'I have transferred · Submit for verification',
    'usdt.unconfigured': 'Receiving address is not configured yet. Please contact support.',
    'usdt.copyAddress': 'Address copied',
    'usdt.copyAmount': 'Amount copied',
    'usdt.tooSmall': 'Amount is below the minimum of {0} USDT. Please increase the quantity.',

    'pay.redirect': 'Proceed to Payment',
    'pay.redirectNote': 'You will be redirected to a secure third-party checkout to complete payment.',
    'pay.cardTitle': 'Card Payment',
    'pay.paypalTitle': 'PayPal Payment',
    'pay.foreignAmount': 'Amount in {0}',
    'pay.rate': 'Rate',
    'pay.unconfigured': 'This payment channel is not configured yet. Please contact support.',

    'result.successTitle': 'Recharge Successful',
    'result.failedTitle': 'Recharge Failed',
    'result.rechargingTitle': 'Processing Upstream',
    'result.paidTitle': 'Paid · Dispatching',
    'result.pendingTitle': 'Awaiting Payment',
    'result.refundedTitle': 'Refunded',
    'result.closedTitle': 'Order Closed',
    'result.successDesc': 'Your benefits have been delivered to the account. Please log in to the platform to check. Thank you.',
    'result.failedDesc': 'The upstream reported a failure and we have logged it. Contact support with your order number for a replacement or refund.',
    'result.rechargingDesc': 'Recharging through the upstream channel. Usually done in 1-5 minutes; this page updates automatically.',
    'result.paidDesc': 'Payment confirmed. The system is submitting the order to the upstream channel.',
    'result.pendingDesc': 'This order has not been paid yet.',
    'result.refundedDesc': 'The payment has been refunded to the original method.',
    'result.closedDesc': 'This order has been closed.',
    'result.orderNo': 'Order No.',
    'result.product': 'Product',
    'result.account': 'Account',
    'result.paid': 'Paid',
    'result.supplier': 'Source',
    'result.createdAt': 'Created',
    'result.finishedAt': 'Finished',
    'result.timeline': 'Progress',
    'result.again': 'Keep Browsing',
    'result.query': 'Order Lookup',
    'result.rebuy': 'Buy Again',
    'result.rechargingNote': 'Sending the recharge instruction to the upstream source…',

    'toast.offline': 'Cannot reach the server. Please make sure the backend is running.',
    'toast.soldOut': 'This product is out of stock. Please try again later.',
    'toast.accountMismatch': 'The two account entries do not match. Please check.',
    'toast.orderFail': 'Failed to create order',
    'toast.success': 'Recharge successful and delivered!',
    'toast.failed': 'Recharge failed. Please contact support.',
    'toast.copied': 'Copied to clipboard',

    'query.title': 'Order Lookup',
    'query.sub': 'Enter your order number or the account you submitted to see live progress and full logs',
    'query.ph': 'Order number (starts with DC) / account',
    'query.btn': 'Search',
    'query.hint': 'The order number can be copied from the checkout and result pages. No registration or login required.',
    'query.notFound': 'Order not found. Please check the order number or account.',
    'query.toOrder': 'Place an order',
    'query.logs': 'View processing log',
    'query.continuePay': 'Continue payment',
    'query.failedNote': 'Please contact support; they will verify the upstream charge.',
    'query.empty': 'Enter an order number or contact to search',

    'pay.noOrder': 'Missing order number',
    'pay.notFound': 'Order not found',
    'pay.toQuery': 'Look up order',
    'pay.home': 'Back to Home',
    'pay.query': 'Order Lookup',

    'lang.switch': '中文',

    'status.pending_payment': 'Awaiting Payment',
    'status.paid': 'Paid · Dispatching',
    'status.recharging': 'Recharging',
    'status.success': 'Completed',
    'status.failed': 'Failed',
    'status.refunded': 'Refunded',
    'status.closed': 'Closed',

    'slogan.default': 'Pick a product → enter your account → pay. We handle the rest. Upstream channels are integrated, average delivery within 1 minute.',

    'common.placeholder': '—',
  },

  zh: {
    'brand.name': '云充站',
    'brand.sub': '会员代充 · 极速到账',
    'brand.sub2': '收银台',
    'nav.home': '首页',
    'nav.products': '全部商品',
    'nav.query': '订单查询',
    'nav.faq': '常见问题',
    'nav.service': '联系客服',
    'nav.admin': '后台管理',
    'notice.label': '公告',
    'sys.ok': '系统正常',
    'sys.sandbox': '沙箱模式',

    'hero.badge': '无需注册 · 无需密码 · 一屏下单',
    'hero.title1': '一站式',
    'hero.title2': '会员套餐代充',
    'hero.chip.auto': '⚡ 自动充值',
    'hero.chip.official': '🛡️ 官方渠道',
    'hero.chip.refund': '↩️ 失败退款',
    'hero.chip.support': '🕘 09:00-23:00 客服',
    'hero.searchPh': '搜索商品，例如「爱奇艺」「X Premium」「点券」',
    'hero.stat.orders': '累计成交订单',
    'hero.stat.goods': '在售商品',
    'hero.stat.rate': '平均到账时间',
    'hero.stat.rateValue': '1 分钟',

    'live.title': '实时充值动态 · 刚刚成交',
    'live.bought': '购买了',

    'hubs.title': '选择你的服务专区',
    'hubs.sub': '独立专区 · 专属通道 · 安全下单',
    'hubs.count': '{0} 个专区 · {1} 款商品',
    'hubs.enter': '进入专区 →',
    'hubs.goods': '{0} 款商品',

    'products.title': '在售商品',
    'products.all': '全部专区',
    'products.empty': '没有找到匹配的商品，换个关键词试试',
    'products.buy': '立即购买',
    'products.soldOut': '已售罄',
    'products.from': ' 起',
    'products.sold': '已售 {0}',
    'products.stockLeft': '库存 {0}',
    'products.noStock': '暂时缺货',
    'products.skuCount': '{0} 个套餐',

    'flow.title': '30 秒完成下单',
    'flow.sub': '我们把流程压到了最短 —— 选套餐、填账号、付款，没有多余步骤',
    'flow.s1': 'STEP 01',
    'flow.h1': '选择套餐',
    'flow.p1': '在商品弹窗里直接点选月卡 / 季卡 / 年卡，无需跳转页面。',
    'flow.s2': 'STEP 02',
    'flow.h2': '填写充值账号',
    'flow.p2': '只需填写要充值的账号，不需要密码、不需要登录授权。',
    'flow.s3': 'STEP 03',
    'flow.h3': '完成支付',
    'flow.p3': '支持支付宝 / 微信 / QQ钱包 / USDT / 国际信用卡 / PayPal，扫码或跳转即付。',
    'flow.s4': 'STEP 04',
    'flow.h4': '自动充值',
    'flow.p4': '支付后系统自动对接上游通道，订单号即可实时查询进度。',

    'faq.title': '常见问题',
    'faq.sub': '下单前先看看，能省不少沟通时间',
    'faq.q1': '需要提供账号密码吗？',
    'faq.a1': '不需要。全部商品走官方直充或家庭组邀请，只需填写要充值的账号（手机号 / UID / @用户名等），不需要提供任何密码或验证码。',
    'faq.q2': '下单后多久能到账？',
    'faq.a2': '绝大多数订单在支付后 1-5 分钟内自动完成；海外专区（X / Telegram / YouTube）因上游为人工+BOT 混合处理，通常 10 分钟内在订单页更新状态。若超过 30 分钟仍未完成，请带着订单号联系客服。',
    'faq.q3': '充值账号填错了怎么办？',
    'faq.a3': '订单提交后充值账号不可自行修改。若订单仍在「待支付」状态，可关闭订单后重新下单；若已支付，请立即联系客服，在未被上游受理前我们可尝试拦截，已受理的订单无法撤回。<br><b>所以下单前请务必核对账号，需要二次确认的商品我们已强制要求重复输入。</b>',
    'faq.q4': '充值失败了会退款吗？',
    'faq.a4': '会。上游返回失败且未产生扣费时，系统会自动标记「充值失败」，客服核实后按原路退回（一般 1-24 小时到账）。若因账号填写错误导致上游已扣费，则无法退款，请理解。',
    'faq.q5': '怎么查询我的订单？',
    'faq.a5': '打开「订单查询」页面，输入订单号或充值账号即可查看实时进度与完整日志。无需注册登录。',
    'faq.q6': '会员会掉吗？有风险吗？',
    'faq.a6': '我们走的是官方低价区与正规家庭组渠道，正常使用基本不会掉。仅在账号本身触发平台风控（如异地登录频繁、短期修改资料）时存在极小概率异常，届时可联系客服补开一次。',

    'footer.desc': '面向个人与小型商户的虚拟商品代充交易平台。所有交易均通过订单号可查，全程留痕。',
    'footer.col.service': '服务',
    'footer.col.support': '联系客服',
    'footer.col.compliance': '合规提示',
    'footer.tg': 'Telegram',
    'footer.wechat': '微信',
    'footer.qq': 'QQ',
    'footer.workTime': '工作时间',
    'footer.c1': '本站仅提供代充服务，非官方授权站点',
    'footer.c2': '请勿使用来源不明的账号下单',
    'footer.c3': '虚拟商品一经充值成功不支持退换',
    'footer.copyright': '© 2026 云充站 · 演示系统',
    'footer.sandboxNote': '本站为演示环境，支付与上游充值均为沙箱模拟，不产生真实交易',

    'modal.title': '确认订单信息',
    'modal.sec1': '选择套餐',
    'modal.sec2': '购买数量',
    'modal.sec3': '填写{0}',
    'modal.sec3none': '订单信息',
    'modal.confirmLabel': '再次确认账号',
    'modal.confirmPh': '请重复输入一遍，防止填错',
    'modal.qtyHint': '单笔最多 10 份，多份将连续充值到同一账号',
    'modal.qtyHintNone': '单笔最多 10 份，多份为独立账号，将分别发放',
    'modal.contact': '联系方式',
    'modal.contactOpt': '（选填，便于异常时联系你）',
    'modal.contactPh': '手机号 / 邮箱 / Telegram',
    'modal.remark': '订单备注',
    'modal.remarkOpt': '（选填）',
    'modal.remarkPh': '例如：不同账号请分开下单',
    'modal.pay': '支付方式',
    'modal.amount': '商品金额',
    'modal.fee': '手续费',
    'modal.total': '应付金额',
    'modal.submit': '去支付',
    'modal.agree': '提交即表示你已核对充值账号 <b style="color:var(--danger)">填写错误无法退款</b>',
    'modal.agreeNone': '虚拟商品 <b style="color:var(--danger)">一经发放不支持退款</b>，请确认需求后再下单',
    'modal.expire': '订单有效期 {0} 分钟',
    'modal.noticeTitle': '商品说明与使用须知',
    'modal.trust1': '🔒 无需密码',
    'modal.trust2': '⚡ 自动充值',
    'modal.trust3': '↩️ 失败退款',
    'modal.placeholder.account': '请输入账号',

    'cashier.title': '扫码支付',
    'cashier.created': '订单已创建',
    'cashier.expire': '剩余支付时间',
    'cashier.product': '充值商品',
    'cashier.account': '充值账号',
    'cashier.delivery': '发货方式',
    'cashier.auto': '自动发货（免填账号）',
    'cashier.sandboxTitle': '沙箱演示支付',
    'cashier.sandboxText': '当前为沙箱演示支付：二维码不可真实支付。点击下方按钮即可模拟支付成功，系统会立刻触发自动充值并展示完整链路。',
    'cashier.mockPay': '✅ 模拟支付成功（演示）',
    'cashier.iPaid': '我已支付完成',
    'cashier.later': '稍后再看（订单号已可在查询页找回）',
    'cashier.autoNote': '支付完成后系统自动充值，页面会自动刷新状态',
    'cashier.help': '支付遇到问题？联系客服 {0}',

    'usdt.title': 'USDT 转账',
    'usdt.network': '网络',
    'usdt.address': '收款地址',
    'usdt.amount': '应付金额',
    'usdt.rate': '参考汇率',
    'usdt.rateUnit': '1 USDT = ¥{0}',
    'usdt.memo': '转账备注',
    'usdt.memoHint': '请在转账备注中填写订单号 {0}',
    'usdt.tips': '温馨提示',
    'usdt.txid': '交易哈希（TxID）',
    'usdt.txidPh': '粘贴链上转账的交易哈希',
    'usdt.txidHint': '转账完成后请粘贴 TxID，便于我们核验到账。',
    'usdt.txidRequired': '请填写链上转账的交易哈希（TxID）',
    'usdt.submit': '我已转账，提交核验',
    'usdt.unconfigured': '收款地址尚未配置，请联系客服',
    'usdt.copyAddress': '地址已复制',
    'usdt.copyAmount': '金额已复制',
    'usdt.tooSmall': '金额低于最小收款 {0} USDT，请增加购买数量',

    'pay.redirect': '前往支付',
    'pay.redirectNote': '将跳转到第三方安全收银台完成支付',
    'pay.cardTitle': '信用卡支付',
    'pay.paypalTitle': 'PayPal 支付',
    'pay.foreignAmount': '{0} 应付金额',
    'pay.rate': '汇率',
    'pay.unconfigured': '该收款通道尚未配置，请联系客服',

    'result.successTitle': '充值成功，已到账',
    'result.failedTitle': '充值失败',
    'result.rechargingTitle': '上游处理中，请稍候',
    'result.paidTitle': '已支付，正在派单',
    'result.pendingTitle': '等待支付',
    'result.refundedTitle': '已退款',
    'result.closedTitle': '订单已关闭',
    'result.successDesc': '权益已发放至充值账号，请登录对应平台查看。感谢你的信任。',
    'result.failedDesc': '上游返回失败，我们已记录。请联系客服并提供订单号，可安排补发或退款。',
    'result.rechargingDesc': '正在对接上游通道充值，通常 1-5 分钟完成，页面会自动更新。',
    'result.paidDesc': '支付已确认，系统正在提交上游通道。',
    'result.pendingDesc': '订单尚未支付。',
    'result.refundedDesc': '款项已原路退回。',
    'result.closedDesc': '订单已关闭。',
    'result.orderNo': '订单号',
    'result.product': '商品',
    'result.account': '充值账号',
    'result.paid': '实付金额',
    'result.supplier': '商品来源',
    'result.createdAt': '下单时间',
    'result.finishedAt': '完成时间',
    'result.timeline': '处理进度',
    'result.again': '继续逛逛',
    'result.query': '订单查询页',
    'result.rebuy': '再买一单',
    'result.rechargingNote': '正在向商品来源下发充值指令…',

    'toast.offline': '服务连接失败，请确认后端已启动',
    'toast.soldOut': '该商品暂时缺货，到货后可下单',
    'toast.accountMismatch': '两次填写的充值账号不一致，请核对',
    'toast.orderFail': '下单失败',
    'toast.success': '充值成功，已到账！',
    'toast.failed': '充值失败，请联系客服处理',
    'toast.copied': '已复制到剪贴板',

    'query.title': '订单查询',
    'query.sub': '输入订单号或下单时填写的充值账号，即可查看实时充值进度与完整日志',
    'query.ph': '订单号（DC开头） / 充值账号',
    'query.btn': '查询',
    'query.hint': '订单号在下单支付页与订单结果页均可复制；未注册用户也可查询，无需登录。',
    'query.notFound': '未查询到订单，请核对订单号或充值账号',
    'query.toOrder': '去下单',
    'query.logs': '查看处理日志',
    'query.continuePay': '继续支付',
    'query.failedNote': '请联系客服处理，客服会核对上游扣费情况',
    'query.empty': '请输入订单号或联系方式',

    'pay.noOrder': '缺少订单号参数',
    'pay.notFound': '订单不存在',
    'pay.toQuery': '去查询订单',
    'pay.home': '返回首页',
    'pay.query': '订单查询',

    'lang.switch': 'EN',

    'status.pending_payment': '待支付',
    'status.paid': '已支付·待充值',
    'status.recharging': '充值中',
    'status.success': '已完成',
    'status.failed': '充值失败',
    'status.refunded': '已退款',
    'status.closed': '已关闭',

    'slogan.default': '选择商品 → 填写充值账号 → 支付，剩下的交给我们。自动对接上游通道，平均 1 分钟内到账。',

    'common.placeholder': '—',
  },
};

/* ------------------------------------------------------------------ */
/* 内容词条：数据库中的中文原文 → 英文                                  */
/*（中文模式下直接返回原文，无需维护反向词条）                          */
/* ------------------------------------------------------------------ */

const CONTENT_EN = {
  /* ---- 分类 ---- */
  '视频会员': 'Video Streaming',
  '音乐音频': 'Music & Audio',
  '网盘工具': 'Cloud & Productivity',
  '游戏充值': 'Game Credits',
  '海外专区': 'Global Zone',
  'iCloud 邮箱': 'iCloud Mailboxes',
  '平台专用验证邮箱': 'Platform Verification Mailboxes',
  'Hotmail 令牌邮箱': 'Hotmail Token Mailboxes',
  'AI 会员': 'AI Memberships',
  '主流视频平台会员直充': 'Direct top-up for major streaming platforms',
  '音乐平台豪华会员': 'Premium plans for music platforms',
  '网盘 / 办公软件会员': 'Cloud drive & office suite memberships',
  '游戏点券与礼包': 'Game credits and bundles',
  'X / Telegram / YouTube Premium': 'X / Telegram / YouTube Premium',
  '接收所有内容，长期使用；长效 / 短效可选': 'Receives all mail, for long-term use; long-life or short-life',
  'PayPal / Cash App / TikTok / Shopify / Claude 等平台专用':
    'Dedicated for PayPal / Cash App / TikTok / Shopify / Claude and more',
  '已绑辅邮，已授权 OAuth2 / IMAP / GRAPH': 'Backup mail bound; OAuth2 / IMAP / GRAPH authorized',
  'GPT 等 AI 服务充值卡密，人工发放': 'Recharge codes for GPT and other AI services, delivered manually',

  /* ---- 商品 ---- */
  '爱奇艺黄金VIP会员': 'iQIYI Gold VIP',
  '腾讯视频VIP会员': 'Tencent Video VIP',
  '优酷酷喵VIP': 'Youku Cool Cat VIP',
  '芒果TV会员': 'Mango TV VIP',
  '哔哩哔哩大会员': 'Bilibili Premium',
  'QQ音乐豪华绿钻': 'QQ Music Luxury Green Diamond',
  '网易云音乐黑胶VIP': 'NetEase Cloud Music Vinyl VIP',
  '酷狗豪华VIP': 'Kugou Luxury VIP',
  '百度网盘超级会员': 'Baidu Netdisk Super VIP',
  'WPS 超级会员': 'WPS Super Member',
  '阿里云盘 SVIP': 'Aliyun Drive SVIP',
  '王者荣耀点券': 'Honor of Kings Credits',
  '和平精英 UC': 'PUBG Mobile UC',
  '网易游戏点卡（通用）': 'NetEase Game Card (Universal)',
  'X Premium（推特蓝V）': 'X Premium (Twitter Blue)',
  'Telegram Premium': 'Telegram Premium',
  'YouTube Premium': 'YouTube Premium',
  'iCloud 长效邮箱 | 仅接收邮件': 'iCloud Long-life Mailbox | Receive-only',
  'iCloud 短效邮箱 | 仅接收邮件': 'iCloud Short-life Mailbox | Receive-only',
  'PayPal 专用 iCloud 邮箱 | 仅接收邮件': 'iCloud Mailbox for PayPal | Receive-only',
  'Cash App 专用 iCloud 邮箱 | 仅接收邮件': 'iCloud Mailbox for Cash App | Receive-only',
  'TikTok 专用 iCloud 邮箱 | 仅接收邮件': 'iCloud Mailbox for TikTok | Receive-only',
  'Shopify 专用 iCloud 邮箱 | 仅接收邮件': 'iCloud Mailbox for Shopify | Receive-only',
  'Claude 专用 iCloud 邮箱 | 仅接收邮件': 'iCloud Mailbox for Claude | Receive-only',
  'Cash App 专用老号 iCloud 邮箱 | 仅接收邮件': 'Aged iCloud Mailbox for Cash App | Receive-only',
  'Hotmail 令牌长效邮箱 | 已绑辅邮 OAuth2 / IMAP / GRAPH':
    'Hotmail Long-life Token Mailbox | OAuth2 / IMAP / GRAPH',
  'GPT Plus 正规充值月套餐': 'GPT Plus Monthly (Official Top-up)',
  'GPT Pro 5x 正规代充 · 30天': 'GPT Pro 5x Top-up · 30 Days',
  'GPT Pro 20x 正规代充 · 30天续费专用': 'GPT Pro 20x Top-up · 30-Day Renewal Only',
  'X Premium+ 会员': 'X Premium+ Membership',

  /* ---- 商品副标题 ---- */
  '支持手机/电脑/平板，不含电视端': 'Mobile / desktop / tablet; TV not included',
  '支持手机/电脑/平板，可与微信QQ绑定': 'Mobile / desktop / tablet; can link WeChat & QQ',
  '手机端 + 电视端通用': 'Works on mobile and TV',
  '综艺看不停，支持多端登录': 'Endless variety shows; multi-device login',
  '1080P 高码率 + 专属装扮': '1080P high bitrate + exclusive themes',
  '无损音质 + 付费歌曲下载': 'Lossless audio + paid song downloads',
  '会员曲库 + 无损音质': 'VIP song library + lossless audio',
  '千万曲库 + 蝰蛇音效': 'Massive library + Viper audio effects',
  '极速下载 + 5T 空间': 'Blazing download + 5TB storage',
  'PDF 转换 + 云空间 + 模板库': 'PDF tools + cloud space + template library',
  '不限速下载 + 大容量空间': 'No speed limit + large storage',
  '官方点券，按区充值': 'Official credits, recharged by server region',
  'UC 点券，直充到角色': 'UC credits, recharged straight to your character',
  '支持大话/梦幻等网易端游': 'Supports NetEase PC games such as DH and MHXY',
  'X 平台 Premium 会员，支持蓝标认证': 'X platform Premium membership with blue checkmark',
  'TG 会员，解锁全部高级功能': 'Telegram Premium, unlocking all advanced features',
  '去广告 + 后台播放 + YT Music': 'Ad-free + background play + YT Music',
  '接收所有内容，长期可用 · 下单自动发货': 'Receives all mail, long-term usable · auto delivery',
  '性价比之选，短周期使用 · 仅接收邮件': 'Best value, short-term use · receive-only',
  'PayPal 注册 / 验证专用 · 仅接收邮件': 'For PayPal sign-up / verification · receive-only',
  'Cash App 注册 / 验证专用 · 仅接收邮件': 'For Cash App sign-up / verification · receive-only',
  'TikTok 注册 / 验证专用 · 仅接收邮件': 'For TikTok sign-up / verification · receive-only',
  'Shopify 注册 / 验证专用 · 仅接收邮件': 'For Shopify sign-up / verification · receive-only',
  'Claude 注册 / 验证专用 · 仅接收邮件': 'For Claude sign-up / verification · receive-only',
  'Cash App 专用老号（注册时间较早）· 仅接收邮件':
    'Aged account for Cash App (registered earlier) · receive-only',
  '已绑定辅邮，已授权 OAuth2 / IMAP / GRAPH · 长效令牌':
    'Backup mail bound; OAuth2 / IMAP / GRAPH authorized · long-life token',
  'GPT 充值卡密 · 30 天订阅 · 原账号续期': 'GPT recharge code · 30-day subscription · renews on your account',
  '高频使用 / 专业项目 · 人工发放卡密': 'Heavy usage / professional work · code delivered manually',
  '高强度任务 / 团队协作 · 暂不支持新开': 'Intensive tasks / team collaboration · renewal only',
  'X 平台最高档会员 · 人工开单 · 手动处理勿催':
    'Highest X membership tier · manually handled · please be patient',

  /* ---- 角标 ---- */
  '热销': 'Hot',
  '新上架': 'New',
  '低价': 'Low Price',
  '专区': 'Featured',
  '热门': 'Popular',
  '旗舰': 'Flagship',

  /* ---- 标签 ---- */
  '官方直充': 'Official',
  '秒到账': 'Instant',
  '含电视端': 'TV included',
  '不限速': 'No throttling',
  '官方渠道': 'Official channel',
  '人工跟进': 'Manual follow-up',
  '家庭组': 'Family plan',
  '卡密发货': 'Code delivery',
  '自动发货': 'Auto delivery',
  '长期可用': 'Long-term',
  '仅接收邮件': 'Receive-only',
  '性价比': 'Best value',
  'PayPal 专用': 'For PayPal',
  'Cash App 专用': 'For Cash App',
  'TikTok 专用': 'For TikTok',
  'Shopify 专用': 'For Shopify',
  'Claude 专用': 'For Claude',
  '老号': 'Aged account',
  '长效令牌': 'Long-life token',
  '已绑辅邮': 'Backup mail bound',
  'GPT': 'GPT',
  '代充': 'Top-up',
  '人工交付': 'Manual delivery',
  '仅续费': 'Renewal only',
  '高价值': 'High value',
  '人工开单': 'Manual handling',

  /* ---- 套餐名 ---- */
  '黄金VIP 月卡': 'Gold VIP · Monthly',
  '黄金VIP 季卡': 'Gold VIP · Quarterly',
  '黄金VIP 年卡': 'Gold VIP · Yearly',
  '白金会员 季卡（含体育）': 'Platinum · Quarterly (with Sports)',
  'VIP 月卡': 'VIP · Monthly',
  'VIP 季卡': 'VIP · Quarterly',
  'VIP 年卡': 'VIP · Yearly',
  酷喵月卡: 'Cool Cat · Monthly',
  酷喵季卡: 'Cool Cat · Quarterly',
  酷喵年卡: 'Cool Cat · Yearly',
  'PC移动影视会员 月卡': 'PC & Mobile VIP · Monthly',
  'PC移动影视会员 季卡': 'PC & Mobile VIP · Quarterly',
  '全屏会员 年卡': 'All-screen VIP · Yearly',
  '大会员 月卡': 'Premium · Monthly',
  '大会员 季卡': 'Premium · Quarterly',
  '大会员 年卡': 'Premium · Yearly',
  '豪华绿钻 月卡': 'Luxury Green Diamond · Monthly',
  '豪华绿钻 季卡': 'Luxury Green Diamond · Quarterly',
  '豪华绿钻 年卡': 'Luxury Green Diamond · Yearly',
  '黑胶VIP 月卡': 'Vinyl VIP · Monthly',
  '黑胶VIP 季卡': 'Vinyl VIP · Quarterly',
  '黑胶VIP 年卡': 'Vinyl VIP · Yearly',
  '豪华VIP 月卡': 'Luxury VIP · Monthly',
  '豪华VIP 年卡': 'Luxury VIP · Yearly',
  '超级会员 月卡': 'Super VIP · Monthly',
  '超级会员 季卡': 'Super VIP · Quarterly',
  '超级会员 年卡': 'Super VIP · Yearly',
  'SVIP 月卡': 'SVIP · Monthly',
  'SVIP 年卡': 'SVIP · Yearly',
  '1000 点券': '1,000 Credits',
  '5000 点券': '5,000 Credits',
  '10000 点券': '10,000 Credits',
  '1000 UC': '1,000 UC',
  '5000 UC': '5,000 UC',
  '30 元点卡': '¥30 Game Card',
  '100 元点卡': '¥100 Game Card',
  'Premium 月付（1个月）': 'Premium · Monthly (1 month)',
  'Premium 季付（3个月）': 'Premium · Quarterly (3 months)',
  'Premium 年付（1年）': 'Premium · Yearly (1 year)',
  '3个月 X Premium（CheJiu 渠道）': 'X Premium 3 months (CheJiu channel)',
  '6个月 X Premium（CheJiu 渠道 · 最受欢迎）': 'X Premium 6 months (CheJiu · most popular)',
  'Premium 1个月': 'Premium · 1 month',
  'Premium 3个月': 'Premium · 3 months',
  'Premium 12个月': 'Premium · 12 months',
  'TG会员 3个月（CheJiu 渠道）': 'Telegram Premium 3 months (CheJiu)',
  'TG会员 6个月（CheJiu 渠道）': 'Telegram Premium 6 months (CheJiu)',
  'TG会员 12个月（CheJiu 渠道）': 'Telegram Premium 12 months (CheJiu)',
  'Premium 1个月（家庭组）': 'Premium · 1 month (Family)',
  'Premium 12个月（家庭组）': 'Premium · 12 months (Family)',
  '长效邮箱 1 个': 'Long-life mailbox × 1',
  '短效邮箱 1 个': 'Short-life mailbox × 1',
  'PayPal 专用邮箱 1 个': 'PayPal mailbox × 1',
  'Cash App 专用邮箱 1 个': 'Cash App mailbox × 1',
  'TikTok 专用邮箱 1 个': 'TikTok mailbox × 1',
  'Shopify 专用邮箱 1 个': 'Shopify mailbox × 1',
  'Claude 专用邮箱 1 个': 'Claude mailbox × 1',
  'Cash App 老号邮箱 1 个': 'Cash App aged mailbox × 1',
  'Hotmail 令牌邮箱 1 个': 'Hotmail token mailbox × 1',
  'Plus 30天': 'Plus · 30 days',
  'Pro 5x 30天': 'Pro 5x · 30 days',
  'Pro 20x 30天': 'Pro 20x · 30 days',
  'Premium+ 3个月': 'Premium+ · 3 months',
  'Premium+ 6个月': 'Premium+ · 6 months',
  'Premium+ 12个月': 'Premium+ · 12 months',

  /* ---- 账号字段标签（后台可自定义，命中即翻译）---- */
  '充值账号': 'Account',
  '爱奇艺账号（手机号）': 'iQIYI account (phone)',
  'X 用户名（@handle）': 'X username (@handle)',
  '游戏账号与区服': 'Game account & server',
  '邮箱地址': 'Email address',

  /* ---- 后台/服务端返回的常见提示 ---- */
  '套餐不存在或已下架': 'This plan does not exist or has been removed.',
  '该套餐已下架': 'This plan has been removed.',
  '该套餐库存不足，请联系客服': 'Insufficient stock for this plan. Please contact support.',
  '请填写充值账号': 'Please enter the account to recharge.',
  '手机号格式不正确，请检查后重试': 'Invalid phone number format. Please check and retry.',
  '邮箱格式不正确，请检查后重试': 'Invalid email format. Please check and retry.',
  '用户名格式不正确，例如 @username': 'Invalid username format, e.g. @username',
  '两次填写的充值账号不一致，请核对': 'The two account entries do not match. Please check.',
  '支付方式不可用': 'This payment method is unavailable.',
  '订单不存在': 'Order not found.',
  '订单状态无需重复支付': 'This order does not require another payment.',
  '请填写链上转账的交易哈希（TxID）后再提交，以便核验到账':
    'Please provide the on-chain transaction hash (TxID) so we can verify the payment.',
  '交易哈希格式不正确，请核对后重新粘贴': 'Invalid transaction hash format. Please check and paste again.',
  '请输入订单号或充值账号': 'Please enter an order number or account.',
  '未查询到订单，请核对订单号或充值账号': 'Order not found. Please check the order number or account.',
  '服务返回异常': 'Unexpected server response.',
  '分': 'min',
};

/* ------------------------------------------------------------------ */
/* 核心函数                                                            */
/* ------------------------------------------------------------------ */

const I18N = {
  manual: false,
  source: 'init',
  listeners: [],
};

/** 取当前语言 */
function getLang() {
  return LANG;
}

/** 翻译：先查 UI 词条，再查内容词条；支持 {0} {1} 占位替换 */
function t(key) {
  const s = key == null ? '' : String(key);
  let out = s;
  const dict = UI[LANG];
  if (dict && Object.prototype.hasOwnProperty.call(dict, s)) out = dict[s];
  else if (LANG === 'en' && Object.prototype.hasOwnProperty.call(CONTENT_EN, s)) out = CONTENT_EN[s];
  if (arguments.length > 1) {
    for (let i = 1; i < arguments.length; i++) {
      out = out.split('{' + (i - 1) + '}').join(String(arguments[i] == null ? '' : arguments[i]));
    }
  }
  return out;
}

/** 注册语言变化回调（用于重新渲染数据驱动的内容） */
function onLangChange(fn) {
  if (typeof fn === 'function') I18N.listeners.push(fn);
}

/** 把当前语言的文案刷到 DOM 上 */
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  scope.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  const btn = document.getElementById('langBtn');
  if (btn) {
    btn.textContent = t('lang.switch');
    btn.setAttribute('title', LANG === 'en' ? '切换为中文' : 'Switch to English');
  }
}

/** 切换语言（同时写入本地偏好，之后不再被 IP 识别覆盖） */
function setLang(lang, opts) {
  LANG = lang === 'zh' ? 'zh' : 'en';
  if (opts && opts.manual) {
    I18N.manual = true;
    I18N.source = 'manual';
    try { localStorage.setItem(LANG_KEY, LANG); } catch (e) {}
  }
  applyI18n();
  I18N.listeners.forEach((fn) => { try { fn(LANG); } catch (e) {} });
  return LANG;
}

/** 中英互换 */
function toggleLang() {
  return setLang(LANG === 'en' ? 'zh' : 'en', { manual: true });
}

/**
 * 初始化语言
 *   1. URL ?lang=  →  2. localStorage  →  3. 浏览器语言（即时渲染，避免白屏）
 *   4. 异步请求 /api/locale 按 IP 校正（仅在用户未手动选择时覆盖）
 */
async function initI18n() {
  let resolved = '';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'zh' || q === 'en') {
      LANG = q;
      I18N.manual = true;
      I18N.source = 'url';
      try { localStorage.setItem(LANG_KEY, q); } catch (e) {}
      resolved = 'url';
    }
  } catch (e) {}

  if (!resolved) {
    let saved = '';
    try { saved = localStorage.getItem(LANG_KEY) || ''; } catch (e) {}
    if (saved === 'zh' || saved === 'en') {
      LANG = saved;
      I18N.manual = true;
      I18N.source = 'local';
    } else {
      const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
      LANG = nav.indexOf('zh') === 0 ? 'zh' : 'en';
      I18N.source = 'browser';
    }
  }

  applyI18n();

  // 按访问者 IP 校正（不阻塞首屏渲染）
  if (!I18N.manual) {
    try {
      const res = await api('/api/locale');
      if (res && res.ok && (res.lang === 'zh' || res.lang === 'en')) {
        I18N.source = res.source || 'ip';
        if (res.lang !== LANG) setLang(res.lang);
      }
    } catch (e) {
      /* 识别失败保持浏览器语言 */
    }
  }
  return LANG;
}

/** 订单状态文案（复用 app.js 的 STATUS_MAP 图标与颜色，文案走词条） */
function statusLabel(status) {
  const dict = UI[LANG] || {};
  const key = 'status.' + status;
  if (dict[key]) return dict[key];
  return STATUS_MAP && STATUS_MAP[status] ? STATUS_MAP[status].text : String(status || '');
}

/** 中英内容二选一：中文模式取中文原文，英文模式优先取英文备用字段，其次查内容词条 */
function pick(zh, en) {
  if (LANG === 'zh') return zh || en || '';
  return en || t(zh) || zh || '';
}

/* 暴露到全局，供内联 onclick 使用 */
window.t = t;
window.pick = pick;
window.statusLabel = statusLabel;
window.toggleLang = toggleLang;
window.setLang = setLang;
window.getLang = getLang;
window.applyI18n = applyI18n;
window.onLangChange = onLangChange;
