const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 订阅消息自检：检查模板 ID 是否配好、模板是否在当前账号下、关键字如何映射，可发测试通知
const KINDS = {
  orderPlaced: { title: '下单成功通知', env: 'ORDER_PLACED_TEMPLATE_ID' },
  pickupReady: { title: '可取餐提醒', env: 'PICKUP_READY_TEMPLATE_ID' },
  deliveryDone: { title: '已送达提醒', env: 'DELIVERY_DONE_TEMPLATE_ID' }
}

const FALLBACK = {
  orderPlaced: { store: 'thing1', orderNo: 'character_string2', amount: 'amount3', time: 'time4', tip: 'thing5' },
  pickupReady: { pickupNo: 'character_string1', store: 'thing2', time: 'time3', tip: 'thing4' },
  deliveryDone: { store: 'thing1', orderNo: 'character_string2', address: 'thing3', time: 'time4', tip: 'thing5' }
}

async function checkAdmin(event) {
  const token = (event && event.adminToken) ? String(event.adminToken) : ''
  if (!token) return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '请先登录管理后台' }
  try {
    const res = await db.collection('admin_sessions')
      .where({ token: token, expireAt: db.command.gt(Date.now()) })
      .limit(1).get()
    if (res.data && res.data.length) return null
  } catch (e) { console.error('[subscribeCheck] auth error', e && e.message) }
  return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '管理登录已过期，请重新登录' }
}

function maskId(id) {
  const s = String(id || '')
  if (!s) return ''
  if (s.length <= 12) return s.slice(0, 4) + '****'
  return s.slice(0, 8) + '****' + s.slice(-4)
}

function formatCst(date) {
  const d = new Date((date ? date.getTime() : Date.now()) + 8 * 3600 * 1000)
  const p = function (n) { return n < 10 ? '0' + n : '' + n }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
}

function parseContent(content) {
  const out = []
  String(content || '').split(/\r?\n/).forEach(function (line) {
    const m = /\{\{([a-zA-Z_]+\d*)\.DATA\}\}/.exec(line)
    if (!m) return
    const key = m[1]
    const label = line.replace(/\{\{[^}]+\}\}/g, '').replace(/[:：\s]/g, '')
    out.push({ key: key, type: key.replace(/\d+$/, ''), label: label })
  })
  return out
}

function clipByKey(key, v) {
  const s = (v === undefined || v === null) ? '' : String(v)
  let max = 32
  if (/^thing/.test(key)) max = 20
  else if (/^phrase/.test(key)) max = 5
  else if (/^name/.test(key)) max = 10
  else if (/^(time|date)/.test(key)) max = 24
  return s.length > max ? s.slice(0, max) : s
}

function pickRole(kw, values) {
  const label = kw.label || ''
  const has = function (r) { return values && values[r] !== undefined && values[r] !== null && values[r] !== '' }
  const rules = [
    [/取餐(号|码)/, 'pickupNo'],
    [/配送时间/, 'deliveryTime'],
    [/订单(号|编号)/, 'orderNo'],
    [/数量|份数/, 'dishQty'],
    [/详情|明细|内容/, 'dishDetail'],
    [/名称|商品名|餐品名|菜品名/, 'dishNames'],
    [/金额|费用|价格|合计|总价/, 'amount'],
    [/时间|日期/, 'time'],
    [/备注/, 'remark'],
    [/地址|位置|地点|配送至/, 'address'],
    [/门店|店铺|商家|餐厅|企业|取餐点/, 'store'],
    [/提示|说明/, 'tip'],
    [/餐品|菜品|商品/, 'dishNames'],
    [/姓名|员工|取餐人/, 'name']
  ]
  for (let i = 0; i < rules.length; i++) {
    if (rules[i][0].test(label) && has(rules[i][1])) return rules[i][1]
  }
  const byType = { time: 'time', date: 'time', amount: 'amount', character_string: 'orderNo', thing: 'tip', phrase: 'tip', name: 'name', number: 'amount' }
  const role = byType[kw.type]
  if (has(role)) return role
  const order = ['orderNo', 'pickupNo', 'amount', 'time', 'store', 'address', 'tip', 'name']
  for (let i = 0; i < order.length; i++) if (has(order[i])) return order[i]
  return null
}

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

function sampleValues(kind) {
  const items = summarizeItems([{ name: '黑椒牛柳饭', spec: '大份', extras: ['加蛋'], qty: 1 }, { name: '鲜榨橙汁', qty: 2 }]);
  const base = {
    store: '企业餐厅（测试）',
    orderNo: 'O20261030001',
    dishNames: items.dishNames,
    dishQty: items.dishQty,
    dishDetail: items.dishDetail,
    dishBrief: items.dishBrief,
    amount: '¥28.00',
    time: formatCst(new Date()),
    tip: '这是一条测试通知，可忽略',
    pickupNo: '12',
    deliveryTime: formatCst(new Date(Date.now() - 10 * 60 * 1000)),
    remark: '不要辣',
    address: '1号楼-3层',
    name: '测试用户'
  }
  return base
}

function buildPreview(keywords, fallbackMap, values) {
  const data = {}
  const mapping = []
  ;(keywords || []).forEach(function (kw) {
    const role = pickRole(kw, values)
    if (!role) return
    let v = values[role]
    if (role === 'dishDetail' && /^thing/.test(kw.key) && String(v === undefined ? '' : v).length > 20 && values.dishBrief) v = values.dishBrief
    data[kw.key] = { value: clipByKey(kw.key, v) }
    mapping.push({ keyword: kw.key, label: kw.label, role: role, value: clipByKey(kw.key, v) })
  })
  if (!mapping.length && fallbackMap) {
    Object.keys(fallbackMap).forEach(function (role) {
      const key = fallbackMap[role]
      if (values[role] === undefined) return
      data[key] = { value: clipByKey(key, values[role]) }
      mapping.push({ keyword: key, label: '(兜底)', role: role, value: clipByKey(key, values[role]) })
    })
  }
  return { data: data, mapping: mapping }
}

exports.main = async (event) => {
  const ev = event || {}
  const deny = await checkAdmin(ev)
  if (deny) return deny

  const kinds = Array.isArray(ev.kinds) && ev.kinds.length ? ev.kinds : Object.keys(KINDS)
  const clientIds = ev.subscribeTemplateIds || {}
  const { OPENID } = cloud.getWXContext()

  let list = null
  let listError = null
  try {
    const res = await cloud.openapi.subscribeMessage.getTemplateList({})
    list = (res && res.data) || []
  } catch (e) {
    listError = { errCode: (e && e.errCode !== undefined) ? e.errCode : '', errMsg: (e && (e.errMsg || e.message)) || '' }
    console.log('[subscribeCheck] getTemplateList failed', JSON.stringify(listError))
  }

  const results = []
  for (const kind of kinds) {
    const meta = KINDS[kind] || { title: kind, env: '' }
    const templateId = clientIds[kind] || (meta.env ? (process.env[meta.env] || '') : '')
    const item = { kind: kind, title: meta.title, configured: !!templateId, templateId: maskId(templateId) }
    if (!templateId) {
      item.status = 'not_configured'
      item.message = '小程序端 config.subscribeTemplates 里没有配置该模板 ID'
      results.push(item)
      continue
    }
    if (listError) {
      item.status = 'template_list_failed'
      item.message = '拉取账号模板列表失败（云函数权限未生效或网络问题），稍后重试'
      item.error = listError
      const preview = buildPreview([], FALLBACK[kind], sampleValues())
      item.mapping = preview.mapping
      results.push(item)
      continue
    }
    const t = list.find(function (x) { return x && x.priTmplId === templateId })
    if (!t) {
      item.status = 'template_not_found'
      item.message = '当前账号下找不到这个模板 ID（模板 ID 填错，或模板未添加到账号）'
      item.availableTemplates = list.map(function (x) { return { title: x.title, templateId: maskId(x.priTmplId) } })
      results.push(item)
      continue
    }
    item.status = 'ok'
    item.templateTitle = t.title
    item.keywords = parseContent(t.content)
    const preview = buildPreview(item.keywords, FALLBACK[kind], sampleValues())
    item.mapping = preview.mapping
    item.mappedData = preview.data
    if (ev.send === true) {
      try {
        const sendRes = await cloud.openapi.subscribeMessage.send({
          touser: OPENID,
          templateId: templateId,
          page: 'pages/profile/profile',
          lang: 'zh_CN',
          miniprogramState: process.env.SUBSCRIBE_MINIPROGRAM_STATE || 'formal',
          data: preview.data
        })
        item.sendResult = { ok: true, result: sendRes }
      } catch (e) {
        item.sendResult = { ok: false, errCode: (e && e.errCode !== undefined) ? e.errCode : '', errMsg: (e && (e.errMsg || e.message)) || '' }
      }
    }
    results.push(item)
  }

  return {
    ok: true,
    data: {
      checkedAt: formatCst(new Date()),
      callerOpenidMasked: OPENID ? (String(OPENID).slice(0, 6) + '****' + String(OPENID).slice(-4)) : '',
      miniprogramState: process.env.SUBSCRIBE_MINIPROGRAM_STATE || 'formal',
      templateListError: listError,
      accountTemplateCount: list ? list.length : null,
      results: results
    }
  }
}
