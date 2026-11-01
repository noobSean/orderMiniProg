const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ==================== 订阅消息（下单成功通知） ====================
// 模板 ID 与小程序端 miniprogram/config/index.js 的 subscribeTemplates.orderPlaced 一致；
// 可用云函数环境变量 ORDER_PLACED_TEMPLATE_ID 覆盖。
/**
 * 订阅消息公共逻辑（内联版：自动读取模板关键字，按中文标签自动映射字段）
 *
 * 背景：不同账号选用的订阅消息模板，关键字名/顺序都不同（thing1、character_string2…），
 * 手写映射容易配错。这里通过云调用 subscribeMessage.getTemplateList 读取本账号已添加的
 * 模板内容（形如 "取餐号:{{character_string1.DATA}}"），自动解析关键字并按中文标签匹配：
 *   取餐号/订单号/金额/时间/地址/门店/提示/姓名
 * 只有当自动匹配失败（拿不到模板、标签识别不了）时，才用调用方传入的 fallbackMap 兜底。
 *
 * 说明：本段逻辑已内联在云函数 index.js 中（不依赖额外文件，避免上传遗漏导致函数启动失败）。
 */
const CACHE_TTL = 10 * 60 * 1000;
const DEFAULT_STORE_NAME = '企业餐厅';

function createSubscribe(ctx) {
  const cloud = ctx.cloud;
  const db = ctx.db;
  const cache = {};   // templateId -> { ts, info }

  // 按模板关键字类型截断（thing≤20、phrase≤5、name≤10、time/date≤24、其余≤32）
  function clipByKey(key, v) {
    const s = (v === undefined || v === null) ? '' : String(v);
    let max = 32;
    if (/^thing/.test(key)) max = 20;
    else if (/^phrase/.test(key)) max = 5;
    else if (/^name/.test(key)) max = 10;
    else if (/^(time|date)/.test(key)) max = 24;
    return s.length > max ? s.slice(0, max) : s;
  }

  // 北京时间（云函数运行时通常是 UTC，固定 +8）
  function formatCst(date) {
    const d = new Date((date ? date.getTime() : Date.now()) + 8 * 3600 * 1000);
    const p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  // 解析模板 content："取餐号:{{character_string1.DATA}}\n时间:{{time2.DATA}}"
  function parseContent(content) {
    const out = [];
    String(content || '').split(/\r?\n/).forEach(function (line) {
      const m = /\{\{([a-zA-Z_]+\d*)\.DATA\}\}/.exec(line);
      if (!m) return;
      const key = m[1];
      const label = line.replace(/\{\{[^}]+\}\}/g, '').replace(/[:：\s]/g, '');
      out.push({ key: key, type: key.replace(/\d+$/, ''), label: label });
    });
    return out;
  }

  // 返回 { info, fetched, error }：fetched=true 表示已成功拿到账号模板列表（此时找不到=模板 ID 配错，不再兜底硬发）
  async function getTemplateInfo(templateId) {
    const now = Date.now();
    const hit = cache[templateId];
    if (hit && (now - hit.ts) < CACHE_TTL) return hit;
    try {
      const res = await cloud.openapi.subscribeMessage.getTemplateList({});
      const list = (res && res.data) || [];
      const t = list.find(function (x) { return x && x.priTmplId === templateId; });
      const info = t ? { title: t.title, content: t.content, keywords: parseContent(t.content), type: t.type } : null;
      const record = { ts: now, info: info, fetched: true, error: null };
      cache[templateId] = record;
      if (info) {
        console.log('[subscribe] template loaded', JSON.stringify({ templateId: templateId, title: info.title, keywords: info.keywords.map(function (k) { return k.key + '(' + k.label + ')'; }) }));
      } else {
        console.log('[subscribe] template not found in account', JSON.stringify({ templateId: templateId, accountTemplates: list.map(function (x) { return { id: x.priTmplId, title: x.title }; }) }));
      }
      return record;
    } catch (e) {
      console.log('[subscribe] getTemplateList failed', JSON.stringify({ templateId: templateId, errCode: (e && e.errCode !== undefined) ? e.errCode : '', errMsg: (e && (e.errMsg || e.message)) || '' }));
      const record = { ts: now, info: null, fetched: false, error: { errCode: (e && e.errCode !== undefined) ? e.errCode : '', errMsg: (e && (e.errMsg || e.message)) || '' } };
      cache[templateId] = record;
      return record;
    }
  }

  // 按中文标签 → 语义角色
  function pickRole(kw, values) {
    const label = kw.label || '';
    const has = function (r) { return values && values[r] !== undefined && values[r] !== null && values[r] !== ''; };
    const rules = [
      [/取餐(号|码)/, 'pickupNo'],          // 取餐号码 / 取餐号
      [/配送时间/, 'deliveryTime'],          // 配送时间（开始配送/出餐时间）
      [/订单(号|编号)/, 'orderNo'],
      // 餐品相关（餐品详情/订单内容/餐品数量/商品名/商品名称…）
      [/数量|份数/, 'dishQty'],
      [/详情|明细|内容/, 'dishDetail'],       // 餐品详情 / 订单内容
      [/名称|商品名|餐品名|菜品名/, 'dishNames'], // 商品名称 / 商品名
      [/金额|费用|价格|合计|总价/, 'amount'],
      [/时间|日期/, 'time'],                 // 送达时间 / 下单时间 / 取餐时间
      [/备注/, 'remark'],                    // 订单备注
      [/地址|位置|地点|配送至/, 'address'],
      [/门店|店铺|商家|餐厅|企业|取餐点/, 'store'],
      [/提示|说明/, 'tip'],                  // 温馨提示 / 提示说明
      [/餐品|菜品|商品/, 'dishNames'],
      [/姓名|员工|取餐人/, 'name']
    ];
    for (let i = 0; i < rules.length; i++) {
      if (rules[i][0].test(label) && has(rules[i][1])) return rules[i][1];
    }
    const byType = {
      time: 'time', date: 'time', amount: 'amount', character_string: 'orderNo',
      thing: 'tip', phrase: 'tip', name: 'name', number: 'amount'
    };
    const role = byType[kw.type];
    if (has(role)) return role;
    const order = ['orderNo', 'pickupNo', 'amount', 'time', 'store', 'address', 'tip', 'name'];
    for (let i = 0; i < order.length; i++) if (has(order[i])) return order[i];
    return null;
  }

  function buildData(keywords, values) {
    const data = {};
    (keywords || []).forEach(function (kw) {
      const role = pickRole(kw, values);
      if (!role) return;
      let v = values[role];
      // thing 类型最多 20 字：餐品详情太长时自动改用精简版（商品名×数量），避免被截断成半截
      if (role === 'dishDetail' && /^thing/.test(kw.key) && String(v === undefined ? '' : v).length > 20 && values.dishBrief) {
        v = values.dishBrief;
      }
      data[kw.key] = { value: clipByKey(kw.key, v) };
    });
    return data;
  }

  // fallbackMap: { 语义角色: 模板关键字 }，自动解析失败时使用
  function buildFallbackData(fallbackMap, values) {
    const data = {};
    Object.keys(fallbackMap || {}).forEach(function (role) {
      const key = fallbackMap[role];
      if (!key || values[role] === undefined || values[role] === null || values[role] === '') return;
      data[key] = { value: clipByKey(key, values[role]) };
    });
    return data;
  }


  // 订单餐品汇总：商品名 / 总份数 / 明细（供模板里的「商品名/餐品数量/餐品详情」等字段使用）
  function summarizeItems(items) {
    const list = Array.isArray(items) ? items : [];
    const names = [];
    let qty = 0;
    const parts = [];
    const briefs = [];
    list.forEach(function (it) {
      const name = (it && it.name) ? String(it.name) : '';
      if (!name) return;
      if (names.indexOf(name) < 0) names.push(name);
      const q = Number(it && it.qty) || 1;
      qty += q;
      const spec = (it && it.spec) ? '(' + it.spec + ')' : '';
      const extras = (it && Array.isArray(it.extras) && it.extras.length) ? '+' + it.extras.join('/') : '';
      parts.push(name + spec + extras + '×' + q);
      briefs.push(name + '×' + q);
    });
    return { dishNames: names.join('、'), dishQty: String(qty), dishDetail: parts.join('；'), dishBrief: briefs.join('、') };
  }

  async function send(opts) {
    const o = opts || {};
    if (!o.templateId) {
      console.log('[subscribe] skip: templateId 未配置', o.kind || '');
      return { ok: false, reason: 'not_configured' };
    }
    if (!o.openid) {
      console.log('[subscribe] skip: openid 缺失', o.kind || '');
      return { ok: false, reason: 'no_openid' };
    }
    const tpl = await getTemplateInfo(o.templateId);
    const info = tpl.info;
    if (!info && tpl.fetched) {
      // 账号模板列表能拉到，但没有这个 ID：说明模板 ID 配错了（或模板没加到账号下）
      console.log('[subscribe] skip: template not found in account', JSON.stringify({ kind: o.kind || '', templateId: o.templateId }));
      return { ok: false, reason: 'template_not_found' };
    }
    let data = null;
    if (info && info.keywords && info.keywords.length) data = buildData(info.keywords, o.values || {});
    if ((!data || !Object.keys(data).length) && o.fallbackMap) {
      data = buildFallbackData(o.fallbackMap, o.values || {});
      console.log('[subscribe] use fallback map', o.kind || '');
    }
    if (!data || !Object.keys(data).length) {
      console.log('[subscribe] skip: 无法确定模板字段', JSON.stringify({ kind: o.kind || '', templateId: o.templateId }));
      return { ok: false, reason: 'no_fields' };
    }
    try {
      const res = await cloud.openapi.subscribeMessage.send({
        touser: o.openid,
        templateId: o.templateId,
        page: o.page || '',
        lang: 'zh_CN',
        miniprogramState: o.miniprogramState || 'formal',
        data: data
      });
      console.log('[subscribe] sent', JSON.stringify({ kind: o.kind || '', templateId: o.templateId, page: o.page || '', result: res }));
      return { ok: true, result: res };
    } catch (e) {
      const errCode = (e && e.errCode !== undefined) ? e.errCode : '';
      const errMsg = (e && (e.errMsg || e.message)) || '';
      console.log('[subscribe] send failed', JSON.stringify({ kind: o.kind || '', templateId: o.templateId, errCode: errCode, errMsg: errMsg }));
      return { ok: false, error: { errCode: errCode, errMsg: errMsg } };
    }
  }

  async function getStoreName() {
    try {
      const r = await db.collection('settings').limit(1).get();
      return (r.data && r.data[0] && r.data[0].storeName) || DEFAULT_STORE_NAME;
    } catch (e) {
      return DEFAULT_STORE_NAME;
    }
  }

  return {
    send: send,
    summarizeItems: summarizeItems,
    getStoreName: getStoreName,
    formatCst: formatCst,
    parseContent: parseContent,
    clipByKey: clipByKey
  };
}

const subscribe = createSubscribe({ cloud: cloud, db: db })
const ORDER_PLACED_TEMPLATE_ID = process.env.ORDER_PLACED_TEMPLATE_ID || ''
const SUBSCRIBE_MINIPROGRAM_STATE = process.env.SUBSCRIBE_MINIPROGRAM_STATE || 'formal'
// 自动解析模板失败时的兜底映射（语义角色 → 模板关键字），一般无需修改
const ORDER_PLACED_FALLBACK_MAP = {
  store: 'thing1',
  orderNo: 'character_string2',
  amount: 'amount3',
  time: 'time4',
  tip: 'thing5'
}

// 下单成功通知：字段按模板内容自动匹配，失败不影响下单
async function sendOrderPlacedNotice(order, event) {
  const storeName = await subscribe.getStoreName()
  const items = subscribe.summarizeItems(order.items)
  const isDelivery = order.type === 'delivery'
  const clientIds = (event && event.subscribeTemplateIds) || {}
  return subscribe.send({
    kind: 'orderPlaced',
    // 优先用小程序端随请求传来的模板 ID（只配一次），云函数环境变量作为覆盖/兜底
    templateId: clientIds.orderPlaced || ORDER_PLACED_TEMPLATE_ID,
    openid: order.openid,
    page: 'pages/order-detail/order-detail?id=' + order._id,
    miniprogramState: SUBSCRIBE_MINIPROGRAM_STATE,
    values: {
      store: storeName,
      orderNo: order.orderNo || '--',
      amount: '¥' + (Number(order.total) || 0).toFixed(2),
      time: subscribe.formatCst(new Date()),
      tip: isDelivery ? '已收到订单，餐品将配送到指定位置' : '已收到订单，请凭取餐号取餐',
      dishNames: items.dishNames,
      dishQty: items.dishQty,
      dishDetail: items.dishDetail,
      dishBrief: items.dishBrief,
      remark: (order.delivery && order.delivery.note) || '无',
      name: (order.buyer && order.buyer.name) || ''
    },
    fallbackMap: ORDER_PLACED_FALLBACK_MAP
  })
}

// ==================== 促销/折扣（proto） ====================
// 规则：同一菜品命中多个活动时取折扣力度最大的一个（不叠加）；折扣按分四舍五入。
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }
function promoActive(promo, now) {
  if (!promo || promo.enabled === false) return false
  const rate = Number(promo.rate)
  if (!(rate > 0 && rate < 1)) return false
  const s = promo.startAt === undefined || promo.startAt === null || promo.startAt === '' ? null : Number(promo.startAt)
  const e = promo.endAt === undefined || promo.endAt === null || promo.endAt === '' ? null : Number(promo.endAt)
  if (s !== null && isFinite(s) && now < s) return false
  if (e !== null && isFinite(e) && now > e) return false
  return true
}
function promoMatches(promo, dish) {
  if (!promo || !dish) return false
  const type = promo.scopeType || 'all'
  if (type === 'all') return true
  if (type === 'category') {
    const ids = Array.isArray(promo.categoryIds) ? promo.categoryIds : []
    return ids.map(String).indexOf(String(dish.categoryId)) >= 0
  }
  if (type === 'dish') {
    const ids = Array.isArray(promo.dishIds) ? promo.dishIds : []
    return ids.map(String).indexOf(String(dish._id)) >= 0
  }
  return false
}
function bestPromo(promos, dish) {
  let best = null
  ;(promos || []).forEach(function (p) {
    if (!promoMatches(p, dish)) return
    const rate = Number(p.rate)
    if (!(rate > 0 && rate < 1)) return
    if (!best || rate < Number(best.rate)) best = p
  })
  return best
}

// 事务：校验并扣库存、生成订单
exports.main = async (event, context) => {
  // 自测：云函数测试时传 {"action":"ping"}，能返回即说明函数部署/启动正常
  if (event && event.action === 'ping') {
    return { ok: true, data: { pong: true, fn: 'submitOrder', version: 'notify-inline-v1', now: new Date().toISOString() } }
  }
  const { OPENID } = cloud.getWXContext()
  const type = event && event.type
  const items = (event && Array.isArray(event.items)) ? event.items : []
  const delivery = (event && event.delivery) || {}
  const note = (event && event.note) ? String(event.note) : ''

  if (type !== 'pickup' && type !== 'delivery') return { ok: false, message: '配送方式不合法' }
  if (!items.length) return { ok: false, message: '请选择至少一个菜品' }

  try {
    const empRes = await db.collection('employees').where({ openid: OPENID }).limit(1).get()
    if (!empRes.data || !empRes.data.length) {
      return { ok: false, message: '请先绑定员工档案再下单' }
    }
    const buyer = empRes.data[0]

    // 读取生效中的促销活动（集合不存在/查询失败按无活动处理，不影响下单）
    let promotions = []
    try {
      const pr = await db.collection('promotions').where({ enabled: true }).limit(50).get()
      promotions = (pr.data || []).filter(function (p) { return promoActive(p, Date.now()) })
    } catch (e) {
      promotions = []
    }

    const transaction = await db.startTransaction()
    try {
      const orderItems = []
      let total = 0
      let originalTotal = 0
      const discountMap = {}

      for (const it of items) {
        if (!it || !it.dishId) throw new Error('菜品缺少 dishId')
        const dishRes = await transaction.collection('dishes').doc(it.dishId).get()
        const dish = dishRes.data
        if (!dish) throw new Error('菜品不存在')
        if (dish.available === false) throw new Error('菜品【' + dish.name + '】已下架')

        // 数量必须为正整数：非法值按 1 件，小数向下取整，上限 99
        let qty = Number(it.qty)
        if (!isFinite(qty) || qty <= 0) qty = 1
        qty = Math.min(99, Math.floor(qty))
        let unitPrice = Number(dish.price) || 0

        // 规格
        let spec = (it.spec !== undefined && it.spec !== null) ? String(it.spec) : ''
        if (spec && Array.isArray(dish.specs)) {
          const s = dish.specs.find(function (x) { return x && x.name === spec })
          if (s) unitPrice += Number(s.price) || 0
        }

        // 加料
        const extrasIn = Array.isArray(it.extras) ? it.extras : []
        const extrasFinal = []
        if (Array.isArray(dish.extras) && dish.extras.length && extrasIn.length) {
          for (const en of extrasIn) {
            const e = dish.extras.find(function (x) { return x && x.name === en })
            if (e) {
              unitPrice += Number(e.price) || 0
              extrasFinal.push(en)
            } else {
              extrasFinal.push(en)
            }
          }
        }

        // 库存校验与扣减
        if (dish.stock !== null && dish.stock !== undefined) {
          const stock = Number(dish.stock) || 0
          if (qty > stock) throw new Error('菜品【' + dish.name + '】库存不足')
          await transaction.collection('dishes').doc(it.dishId)
            .update({ data: { stock: stock - qty } })
        }

        // 促销：命中活动则按最优折扣率计算（不叠加）
        const originalLine = round2(unitPrice * qty)
        const promo = bestPromo(promotions, dish)
        const rate = promo ? Number(promo.rate) : 1
        const payLine = round2(originalLine * rate)
        const lineDiscount = round2(originalLine - payLine)
        originalTotal = round2(originalTotal + originalLine)
        total = round2(total + payLine)

        const orderItem = {
          dishId: dish._id,
          name: dish.name,
          price: round2(unitPrice),
          spec: spec,
          extras: extrasFinal,
          qty: qty
        }
        if (promo && lineDiscount > 0) {
          orderItem.originalPrice = round2(unitPrice)
          orderItem.discountRate = rate
          orderItem.discountAmount = lineDiscount
          orderItem.lineTotal = payLine
          orderItem.promotionId = promo._id || ''
          orderItem.promotionName = promo.name || ''
          const key = promo._id || promo.name || 'promo'
          if (!discountMap[key]) discountMap[key] = { promotionId: promo._id || '', name: promo.name || '促销活动', rate: rate, amount: 0 }
          discountMap[key].amount = round2(discountMap[key].amount + lineDiscount)
        }
        orderItems.push(orderItem)
      }

      const now = new Date()
      const ts = Date.now()
      const rand = Math.floor(Math.random() * 900 + 100)
      const orderNo = 'O' + ts + rand

      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      // 事务内不支持 where 条件查询，改用普通查询统计当日已提交订单数
      const countRes = await db.collection('orders')
        .where({ createdAt: _.gte(dayStart).and(_.lt(dayEnd)) })
        .count()
      const pickupNo = (countRes.total || 0) + 1

      const deliveryTarget = delivery.target !== undefined ? String(delivery.target) : ''
      const orderDoc = {
        orderNo: orderNo,
        pickupNo: pickupNo,
        openid: OPENID,
        type: type,
        buyer: {
          empNo: buyer.empNo,
          name: buyer.name,
          dept: buyer.dept || '',
          location: buyer.location || ''
        },
        items: orderItems,
        total: round2(total),
        delivery: {
          target: deliveryTarget,
          note: note || (delivery.note ? String(delivery.note) : '')
        },
        status: 'pending',
        statusHistory: [{ status: 'pending', time: db.serverDate(), note: '已下单' }],
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
      const discountAmount = round2(originalTotal - total)
      if (discountAmount > 0) {
        orderDoc.originalTotal = round2(originalTotal)
        orderDoc.discountAmount = discountAmount
        orderDoc.discounts = Object.keys(discountMap).map(function (k) { return discountMap[k] })
      }

      const addRes = await transaction.collection('orders').add({ data: orderDoc })
      await transaction.commit()
      // 下单成功通知（用户在下单弹窗授权过才会真正下发；失败不影响下单）
      try {
        orderDoc._id = addRes._id
        await sendOrderPlacedNotice(orderDoc, event)
      } catch (e) {
        console.log('[subscribe] order placed error', (e && (e.errMsg || e.message)) || 'unknown')
      }
      return {
        ok: true,
        data: Object.assign({
          orderId: addRes._id,
          orderNo: orderNo,
          pickupNo: pickupNo,
          total: orderDoc.total
        }, orderDoc.discountAmount ? {
          originalTotal: orderDoc.originalTotal,
          discountAmount: orderDoc.discountAmount,
          discounts: orderDoc.discounts
        } : {})
      }
    } catch (err) {
      await transaction.rollback().catch(function () {})
      throw err
    }
  } catch (e) {
    return { ok: false, message: (e && e.message) || '下单失败' }
  }
}
