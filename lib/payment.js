/**
 * 支付网关适配层（沙箱模拟）。
 * 生产接入时把 createPayment 换成易支付 / 支付宝当面付 / 微信 Native 下单即可，
 * 回调统一走 POST /api/callback/pay，由 server.js 处理。
 */
const crypto = require('crypto');
const db = require('./db');

function isSandbox() {
  const cfg = db.get().payConfig || {};
  return cfg.sandboxMode !== false;
}

/** 创建支付：返回收银台信息 */
function createPayment(order) {
  const sandbox = isSandbox();
  const tradeNo = 'PAY' + crypto.randomBytes(6).toString('hex').toUpperCase();
  if (sandbox) {
    return {
      sandbox: true,
      tradeNo,
      payUrl: '/pay.html?no=' + order.no,
      qrContent: 'sandbox://pay?order=' + order.no + '&amount=' + order.amount + '&trade=' + tradeNo,
      message: '沙箱收银台：点击「模拟支付成功」即可触发自动充值',
    };
  }
  const cfg = db.get().payConfig;
  const params = {
    pid: cfg.merchantId,
    type: order.payMethod,
    out_trade_no: order.no,
    notify_url: cfg.notifyUrl,
    return_url: cfg.notifyUrl,
    name: order.productName + ' ' + order.skuName,
    money: order.amount.toFixed(2),
  };
  const keys = Object.keys(params).sort();
  const raw = keys.map((k) => `${k}=${params[k]}`).join('&') + (cfg.merchantKey || '');
  params.sign = crypto.createHash('md5').update(raw, 'utf8').digest('hex');
  params.sign_type = 'MD5';
  return {
    sandbox: false,
    tradeNo,
    payUrl: cfg.apiUrl + '?' + new URLSearchParams(params).toString(),
    qrContent: cfg.apiUrl + '?' + new URLSearchParams(params).toString(),
    message: '已跳转第三方收银台',
  };
}

module.exports = { createPayment, isSandbox };
