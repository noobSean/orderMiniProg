'use strict'

/**
 * cloudfunctions/subscribeCheck —— 订阅消息自检（模板列表 / 关键字映射 / 测试发送）
 * 鉴权：必须 adminToken；kinds 默认 orderPlaced/pickupReady/deliveryDone。
 * 运行：node --test tests/cloud/subscribeCheck.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createScenario, makeSession } = require('../helpers/mockCloud')

const TOKEN = 'tok_subscribe_admin'
const OPENID = 'oABCDEFGHIJKLMNOP'

const ORDER_TPL = 'TPL_ORDER_PLACED_1234567890'
const PICKUP_TPL = 'TPL_PICKUP_READY_1234567890'
const DELIVERY_TPL = 'TPL_DELIVERY_DONE_1234567890'

const ORDER_CONTENT = [
  '门店:{{thing1.DATA}}',
  '订单号:{{character_string2.DATA}}',
  '金额:{{amount3.DATA}}',
  '时间:{{time4.DATA}}',
  '提示:{{thing5.DATA}}'
].join('\n')

const TEMPLATES = [
  { priTmplId: ORDER_TPL, title: '下单成功通知', content: ORDER_CONTENT, type: 2 },
  { priTmplId: PICKUP_TPL, title: '可取餐提醒', content: '取餐号:{{character_string1.DATA}}\n门店:{{thing2.DATA}}\n时间:{{time3.DATA}}\n提示:{{thing4.DATA}}', type: 2 },
  { priTmplId: DELIVERY_TPL, title: '已送达提醒', content: '门店:{{thing1.DATA}}\n订单号:{{character_string2.DATA}}\n地址:{{thing3.DATA}}\n时间:{{time4.DATA}}\n提示:{{thing5.DATA}}', type: 2 }
]

function scenario(opts) {
  const options = opts || {}
  const seed = Object.assign({}, options.seed)
  seed.admin_sessions = [makeSession({ token: TOKEN, expireAt: Date.now() + 60 * 60 * 1000 })]
  return createScenario({
    fn: 'subscribeCheck',
    openid: OPENID,
    seed: seed,
    env: options.env === undefined ? {} : options.env,
    templates: options.templates === undefined ? TEMPLATES : options.templates,
    templateListError: options.templateListError,
    sendError: options.sendError,
    sendResult: options.sendResult
  })
}

function callCheck(s, event) {
  return s.call(Object.assign({ adminToken: TOKEN }, event || {}))
}

// ---------------- 鉴权 ----------------
test('subscribeCheck: 无 adminToken 返回 NEED_ADMIN_LOGIN', async () => {
  const s = scenario()
  const res = await s.call({})
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /请先登录管理后台/)
})

test('subscribeCheck: 无效 / 过期 adminToken 返回 NEED_ADMIN_LOGIN（已过期文案）', async () => {
  let s = scenario()
  let res = await s.call({ adminToken: 'tok_nope' })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
  assert.match(res.message, /已过期/)

  s = createScenario({
    fn: 'subscribeCheck',
    openid: OPENID,
    seed: { admin_sessions: [makeSession({ token: TOKEN, expireAt: Date.now() - 1 })] },
    templates: TEMPLATES
  })
  res = await s.call({ adminToken: TOKEN })
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

test('subscribeCheck: 鉴权查询数据库异常按未登录处理', async () => {
  const s = scenario()
  s.mock.failNext('admin_sessions', 'get', new Error('session db down'))
  const res = await s.call({ adminToken: TOKEN })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'NEED_ADMIN_LOGIN')
})

// ---------------- 未配置模板 ----------------
test('subscribeCheck: 默认检查 3 种通知；未配置模板 ID 时 status=not_configured', async () => {
  const s = scenario({ templates: [] })
  const res = await callCheck(s)
  assert.equal(res.ok, true)
  assert.equal(res.data.results.length, 3)
  assert.deepEqual(res.data.results.map(function (r) { return r.kind }), ['orderPlaced', 'pickupReady', 'deliveryDone'])
  for (const item of res.data.results) {
    assert.equal(item.configured, false)
    assert.equal(item.templateId, '')
    assert.equal(item.status, 'not_configured')
    assert.match(item.message, /没有配置该模板 ID/)
  }
  assert.equal(res.data.templateListError, null)
  assert.equal(res.data.accountTemplateCount, 0)
  assert.match(res.data.checkedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(res.data.callerOpenidMasked, 'oABCDE****MNOP')
  assert.equal(res.data.miniprogramState, 'formal')
})

test('subscribeCheck: 未知 kind 用 kind 名作标题，状态 not_configured', async () => {
  const s = scenario()
  const res = await callCheck(s, { kinds: ['wechatNotify'] })
  assert.equal(res.data.results.length, 1)
  const item = res.data.results[0]
  assert.equal(item.kind, 'wechatNotify')
  assert.equal(item.title, 'wechatNotify')
  assert.equal(item.status, 'not_configured')
})

test('subscribeCheck: kinds 可只检查部分通知', async () => {
  const s = scenario()
  const res = await callCheck(s, { kinds: ['orderPlaced'] })
  assert.equal(res.data.results.length, 1)
  assert.equal(res.data.results[0].kind, 'orderPlaced')
})

// ---------------- 模板命中 + 自动映射 ----------------
test('subscribeCheck: 模板命中时解析关键字并按中文标签自动映射', async () => {
  const s = scenario()
  const res = await callCheck(s, { subscribeTemplateIds: { orderPlaced: ORDER_TPL } })
  assert.equal(res.ok, true)
  const item = res.data.results[0]
  assert.equal(item.status, 'ok')
  assert.equal(item.title, '下单成功通知')
  assert.equal(item.templateTitle, '下单成功通知')
  assert.equal(item.configured, true)
  assert.equal(item.templateId, 'TPL_ORDE****7890', '模板 ID 需打码')
  assert.equal(item.keywords.length, 5)
  assert.equal(item.keywords[0].key, 'thing1')
  assert.equal(item.keywords[0].type, 'thing')
  assert.equal(item.keywords[0].label, '门店')
  assert.deepEqual(item.mapping.map(function (m) { return m.role }), ['store', 'orderNo', 'amount', 'time', 'tip'])
  assert.deepEqual(item.mapping.map(function (m) { return m.keyword }), ['thing1', 'character_string2', 'amount3', 'time4', 'thing5'])
  assert.equal(item.mappedData.thing1.value, '企业餐厅（测试）')
  assert.equal(item.mappedData.character_string2.value, 'O20261030001')
  assert.equal(item.mappedData.amount3.value, '¥28.00')
  assert.match(item.mappedData.time4.value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(item.mappedData.thing5.value, '这是一条测试通知，可忽略')
  assert.equal(res.data.accountTemplateCount, 3)
})

test('subscribeCheck: 通过环境变量提供模板 ID 时同样视为已配置', async () => {
  const s = scenario({ env: { ORDER_PLACED_TEMPLATE_ID: ORDER_TPL } })
  const res = await callCheck(s, { kinds: ['orderPlaced'] })
  const item = res.data.results[0]
  assert.equal(item.configured, true)
  assert.equal(item.status, 'ok')
  assert.equal(item.templateId, 'TPL_ORDE****7890')
})

test('subscribeCheck: clientIds 优先于环境变量', async () => {
  const s = scenario({ env: { ORDER_PLACED_TEMPLATE_ID: 'ENV_TPL_NOT_IN_ACCOUNT_1234' } })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL } })
  const item = res.data.results[0]
  assert.equal(item.status, 'ok')
  assert.equal(item.templateId, 'TPL_ORDE****7890')
})

test('subscribeCheck: 模板 ID 不在账号模板列表时 status=template_not_found 并列出可用模板', async () => {
  const s = scenario()
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: 'TPL_WRONG_ID_12345678' } })
  const item = res.data.results[0]
  assert.equal(item.status, 'template_not_found')
  assert.match(item.message, /找不到这个模板 ID/)
  assert.equal(item.configured, true)
  assert.equal(item.templateId, 'TPL_WRON****5678')
  assert.equal(item.availableTemplates.length, 3)
  assert.equal(item.availableTemplates[0].templateId, 'TPL_ORDE****7890')
  assert.equal(item.availableTemplates[0].title, '下单成功通知')
})

test('subscribeCheck: 模板 ID 长度 <= 12 时使用短掩码', async () => {
  const shortTpl = { priTmplId: 'SHORT123', title: '短模板', content: '门店:{{thing1.DATA}}', type: 2 }
  const s = scenario({ templates: [shortTpl] })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: 'SHORT123' } })
  assert.equal(res.data.results[0].status, 'ok')
  assert.equal(res.data.results[0].templateId, 'SHOR****')
})

test('subscribeCheck: 模板内容中无关键字的行会被忽略', async () => {
  const tpl = {
    priTmplId: ORDER_TPL,
    title: '自定义',
    content: '感谢使用\n门店:{{thing1.DATA}}\n（本行无占位符）\n提示:{{thing5.DATA}}',
    type: 2
  }
  const s = scenario({ templates: [tpl] })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL } })
  const item = res.data.results[0]
  assert.equal(item.keywords.length, 2)
  assert.deepEqual(item.keywords.map(function (k) { return k.key }), ['thing1', 'thing5'])
})

test('subscribeCheck: thing 类型餐品详情过长时自动改用精简版并截断', async () => {
  const tpl = {
    priTmplId: ORDER_TPL,
    title: '餐品模板',
    content: '餐品详情:{{thing1.DATA}}\n取餐号:{{character_string2.DATA}}',
    type: 2
  }
  const s = scenario({ templates: [tpl] })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL } })
  const item = res.data.results[0]
  const detail = item.mapping.filter(function (m) { return m.role === 'dishDetail' })[0]
  assert.ok(detail, '应识别出餐品详情角色')
  assert.equal(detail.value.length <= 20, true, 'thing 关键字值不能超过 20 字')
  // 21 字的 dishDetail 会换成 14 字的 dishBrief
  assert.equal(detail.value, '黑椒牛柳饭×1、鲜榨橙汁×2')
})

// ---------------- 模板列表拉取失败 / fallback ----------------
test('subscribeCheck: getTemplateList 抛错时 status=template_list_failed 并透出 errCode', async () => {
  const err = new Error('no permission')
  err.errCode = -604101
  err.errMsg = 'no permission'
  const s = scenario({ templateListError: err })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL } })
  assert.equal(res.ok, true)
  const item = res.data.results[0]
  assert.equal(item.status, 'template_list_failed')
  assert.match(item.message, /拉取账号模板列表失败/)
  assert.equal(item.error.errCode, -604101)
  assert.equal(item.error.errMsg, 'no permission')
  assert.equal(res.data.templateListError.errCode, -604101)
  assert.equal(res.data.accountTemplateCount, null)
  // fallbackMap 映射
  assert.deepEqual(item.mapping.map(function (m) { return m.keyword }), ['thing1', 'character_string2', 'amount3', 'time4', 'thing5'])
  assert.ok(item.mapping.every(function (m) { return m.label === '(兜底)' }))
  assert.equal(item.mapping[0].role, 'store')
  assert.equal(item.mapping[0].value, '企业餐厅（测试）')
})

test('subscribeCheck: 三种通知在模板列表失败时各自使用对应 fallbackMap', async () => {
  const s = scenario({ templateListError: new Error('network') })
  const res = await callCheck(s, {
    subscribeTemplateIds: { orderPlaced: ORDER_TPL, pickupReady: PICKUP_TPL, deliveryDone: DELIVERY_TPL }
  })
  const results = res.data.results
  assert.equal(results.length, 3)
  for (const item of results) assert.equal(item.status, 'template_list_failed')
  assert.deepEqual(results[0].mapping.map(function (m) { return m.keyword }), ['thing1', 'character_string2', 'amount3', 'time4', 'thing5'])
  assert.deepEqual(results[1].mapping.map(function (m) { return m.keyword }), ['character_string1', 'thing2', 'time3', 'thing4'])
  assert.deepEqual(results[2].mapping.map(function (m) { return m.keyword }), ['thing1', 'character_string2', 'thing3', 'time4', 'thing5'])
})

// ---------------- 测试发送 ----------------
test('subscribeCheck: send=true 时调用 openapi.send，参数包含 touser/templateId/page/data', async () => {
  const s = scenario()
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL }, send: true })
  const item = res.data.results[0]
  assert.equal(item.sendResult.ok, true)
  assert.equal(s.mock.openapi.calls.getTemplateList.length, 1)
  assert.equal(s.mock.openapi.calls.send.length, 1)
  const sent = s.mock.openapi.calls.send[0]
  assert.equal(sent.touser, OPENID)
  assert.equal(sent.templateId, ORDER_TPL)
  assert.equal(sent.page, 'pages/profile/profile')
  assert.equal(sent.lang, 'zh_CN')
  assert.equal(sent.miniprogramState, 'formal')
  assert.equal(sent.data.thing1.value, '企业餐厅（测试）')
  assert.equal(sent.data.character_string2.value, 'O20261030001')
})

test('subscribeCheck: send 失败时记录 errCode/errMsg，但接口整体 ok', async () => {
  const sendError = new Error('user refused')
  sendError.errCode = 43101
  sendError.errMsg = 'user refused to accept'
  const s = scenario({ sendError: sendError })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL }, send: true })
  assert.equal(res.ok, true)
  const item = res.data.results[0]
  assert.equal(item.sendResult.ok, false)
  assert.equal(item.sendResult.errCode, 43101)
  assert.equal(item.sendResult.errMsg, 'user refused to accept')
})

test('subscribeCheck: 未传 send 或 send=false 时不调用发送接口', async () => {
  let s = scenario()
  await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL } })
  assert.equal(s.mock.openapi.calls.send.length, 0)

  s = scenario()
  await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL }, send: false })
  assert.equal(s.mock.openapi.calls.send.length, 0)
})

test('subscribeCheck: SUBSCRIBE_MINIPROGRAM_STATE 环境变量覆盖 miniprogramState', async () => {
  const s = scenario({ env: { SUBSCRIBE_MINIPROGRAM_STATE: 'trial' } })
  const res = await callCheck(s, { kinds: ['orderPlaced'], subscribeTemplateIds: { orderPlaced: ORDER_TPL }, send: true })
  assert.equal(res.data.miniprogramState, 'trial')
  assert.equal(s.mock.openapi.calls.send[0].miniprogramState, 'trial')
})
