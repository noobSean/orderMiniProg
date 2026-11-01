/**
 * 订阅消息（微信「服务通知」）
 *
 * 说明：
 *  - 一次性订阅模板：用户每次同意只能下发一条，所以要在用户点击下单时请求授权；
 *  - 必须在用户点击行为中调用 wx.requestSubscribeMessage（本文件由下单按钮点击链触发）；
 *  - 一次弹窗可同时请求多个模板（最多 5 个），类型必须一致（这里都是一次性订阅）；
 *  - 模板 ID 配置在 miniprogram/config/index.js 的 subscribeTemplates，必须与云函数里的模板 ID 一致。
 */
const config = require('../config/index');

function templates() {
  return config.subscribeTemplates || {};
}

function templateId(name) {
  const t = templates()[name];
  return (typeof t === 'string') ? t.trim() : '';
}

// 当前已配置的模板名列表
function configured() {
  const t = templates();
  return Object.keys(t).filter(k => (typeof t[k] === 'string') && t[k].trim());
}

/**
 * 请求订阅指定模板（可多个），返回 { ok, results: {name: status}, statuses }
 * status: accept / reject / ban / filter / unknown / not-configured / unsupported / fail
 */
function request(names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const idMap = {};   // templateId -> name
  list.forEach(name => {
    const id = templateId(name);
    if (id) idMap[id] = name;
  });
  const ids = Object.keys(idMap);
  if (!ids.length) return Promise.resolve({ ok: false, status: 'not-configured', results: {} });
  if (!wx.requestSubscribeMessage) return Promise.resolve({ ok: false, status: 'unsupported', results: {} });

  return new Promise(resolve => {
    try {
      wx.requestSubscribeMessage({
        tmplIds: ids,
        success: res => {
          const results = {};
          let accepted = 0;
          ids.forEach(id => {
            const name = idMap[id];
            const status = (res && res[id]) || 'unknown';
            results[name] = status;
            if (status === 'accept') accepted++;
          });
          resolve({ ok: accepted > 0, status: accepted > 0 ? 'accept' : 'reject', results });
        },
        fail: err => {
          const results = {};
          ids.forEach(id => { results[idMap[id]] = 'fail'; });
          resolve({ ok: false, status: 'fail', reason: (err && err.errMsg) || '', results });
        }
      });
    } catch (e) {
      const results = {};
      ids.forEach(id => { results[idMap[id]] = 'fail'; });
      resolve({ ok: false, status: 'fail', reason: (e && e.message) || '', results });
    }
  });
}

// 下单时按配送方式请求：下单成功通知 + （自取可取餐 / 配送送达提醒）
function requestForOrder(takeWay) {
  if (takeWay === 'delivery') return request(['orderPlaced', 'deliveryDone']);
  return request(['orderPlaced', 'pickupReady']);
}

module.exports = { request, requestForOrder, templateId, configured };
