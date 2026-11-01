const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 员工绑定管理（管理端）：list 搜索分页 + release 解绑
// 鉴权与 cloudfunctions/adminLogin 对齐：adminToken 必须命中 admin_sessions 且未过期。
const SESSION_COLLECTION = 'admin_sessions'
const EMPLOYEE_COLLECTION = 'employees'
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
// 兜底模糊搜索最多扫描的档案数（只在数据库正则查不到时触发，用于找「幽灵记录」）
const FALLBACK_SCAN_LIMIT = 500

// ==================== 文本规范化（与 bindEmployee 保持一致） ====================
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g
const SPACE_RE = /[\s\u00A0\u3000]/g

function toHalfWidth(input) {
  return String(input)
    .replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    })
    .replace(/\u3000/g, ' ')
}

function normalizeEmpNo(value) {
  if (value === undefined || value === null) return ''
  return toHalfWidth(value).replace(ZERO_WIDTH_RE, '').replace(SPACE_RE, '')
}

function cleanText(value) {
  if (value === undefined || value === null) return ''
  return String(value).replace(ZERO_WIDTH_RE, '').trim()
}

// 模糊比较用：全角转半角 + 去空白/零宽 + 大写
function looseText(value) {
  if (value === undefined || value === null) return ''
  return toHalfWidth(value).replace(ZERO_WIDTH_RE, '').replace(SPACE_RE, '').toUpperCase()
}

function maskOpenid(openid) {
  if (!openid) return ''
  const s = String(openid)
  return s.length <= 10 ? s : (s.slice(0, 6) + '****' + s.slice(-4))
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ==================== 鉴权 ====================
async function verifyAdmin(event) {
  const ev = event || {}
  const token = (ev.adminToken === undefined || ev.adminToken === null) ? '' : String(ev.adminToken).trim()
  if (!token) return null
  try {
    const r = await db.collection(SESSION_COLLECTION)
      .where({ token: token, expireAt: _.gt(Date.now()) })
      .limit(1)
      .get()
    return (r && r.data && r.data[0]) || null
  } catch (e) {
    // admin_sessions 不存在 / 查询失败：按未登录处理，不把内部错误暴露给前端
    return null
  }
}

function needLogin() {
  return { ok: false, code: 'NEED_ADMIN_LOGIN', message: '管理登录已失效，请重新输入管理口令' }
}

// ==================== list ====================
async function countAll(where) {
  const q = where ? db.collection(EMPLOYEE_COLLECTION).where(where) : db.collection(EMPLOYEE_COLLECTION)
  const r = await q.count()
  return (r && r.total) || 0
}

async function pageAll(where, skip, pageSize) {
  let q = where ? db.collection(EMPLOYEE_COLLECTION).where(where) : db.collection(EMPLOYEE_COLLECTION)
  q = q.orderBy('createdAt', 'desc')
  if (skip > 0) q = q.skip(skip)
  q = q.limit(pageSize)
  const r = await q.get()
  return (r && r.data) || []
}

// 退化为无排序分页：老档案可能没有 createdAt 字段，orderBy 可能把它漏掉，
// 这恰恰会造成「控制台看得到记录、列表却搜不到」的幽灵绑定，所以空页时兜底再查一次。
async function pageRaw(where, skip, pageSize) {
  let q = where ? db.collection(EMPLOYEE_COLLECTION).where(where) : db.collection(EMPLOYEE_COLLECTION)
  if (skip > 0) q = q.skip(skip)
  q = q.limit(pageSize)
  const r = await q.get()
  return (r && r.data) || []
}

// 数据库正则匹配不到时的兜底：小范围扫描并用「去空白/全角/零宽」后的文本包含匹配。
// 目的：员工端提示「工号已被绑定」但控制台按工号搜不到时，管理端仍能搜到这条幽灵记录并解绑。
async function fallbackSearch(keyword) {
  const kw = looseText(keyword)
  if (!kw) return []
  const matched = []
  let skip = 0
  while (skip < FALLBACK_SCAN_LIMIT) {
    const r = await db.collection(EMPLOYEE_COLLECTION).orderBy('createdAt', 'desc').skip(skip).limit(100).get()
    const rows = (r && r.data) || []
    rows.forEach(function (d) {
      const hay = [looseText(d.empNo), looseText(d.name), looseText(d.dept)].join('\u0000')
      if (hay.indexOf(kw) >= 0) matched.push(d)
    })
    skip += 100
    if (rows.length < 100) break
  }
  return matched
}

function toListItem(d) {
  return {
    _id: d._id,
    empNo: (d.empNo === undefined || d.empNo === null) ? '' : String(d.empNo),
    name: d.name || '',
    dept: d.dept || '',
    location: d.location || '',
    admin: d.admin === true,
    createdAt: d.createdAt === undefined ? null : d.createdAt,
    openidMask: maskOpenid(d.openid)
  }
}

async function listAction(event, session) {
  const ev = event || {}
  const keyword = cleanText(ev.keyword)
  let page = parseInt(ev.page, 10)
  if (!page || page < 1) page = 1
  let pageSize = parseInt(ev.pageSize, 10)
  if (!pageSize || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE
  const skip = (page - 1) * pageSize

  let where = null
  if (keyword) {
    const reg = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
    const ors = [{ empNo: reg }, { name: reg }, { dept: reg }]
    // 兼容旧数据：empNo 为数字类型时正则匹配不到，补一条数值精确匹配
    if (/^[0-9]+$/.test(keyword)) {
      const num = Number(keyword)
      if (Number.isSafeInteger(num)) ors.push({ empNo: num })
    }
    where = _.or(ors)
  }

  let total = 0
  let rows = []
  let fallback = false

  if (!where) {
    total = await countAll(null)
    rows = total > 0 ? await pageAll(null, skip, pageSize) : []
    if (total > 0 && rows.length === 0) {
      rows = await pageRaw(null, skip, pageSize)
      console.log('[employeeAdmin] list fallback-raw', JSON.stringify({ reason: 'orderBy createdAt missed legacy docs', total: total }))
    }
  } else {
    total = await countAll(where)
    if (total > 0) {
      rows = await pageAll(where, skip, pageSize)
      if (rows.length === 0) {
        rows = await pageRaw(where, skip, pageSize)
        console.log('[employeeAdmin] list fallback-raw', JSON.stringify({ reason: 'orderBy createdAt missed legacy docs', keyword: keyword, total: total }))
      }
    } else {
      const scanned = await fallbackSearch(keyword)
      total = scanned.length
      rows = scanned.slice(skip, skip + pageSize)
      fallback = total > 0
    }
  }

  console.log('[employeeAdmin] list', JSON.stringify({
    operator: maskOpenid(session && session.openid),
    keyword: keyword,
    page: page,
    pageSize: pageSize,
    total: total,
    fallback: fallback
  }))
  return {
    ok: true,
    data: { list: rows.map(toListItem), total: total, page: page, pageSize: pageSize, fallback: fallback }
  }
}

// ==================== release ====================
async function findEmpNoMatches(empNo) {
  const list = []
  const seen = {}
  function push(data) {
    (data || []).forEach(function (d) {
      if (d && d._id && !seen[d._id]) { seen[d._id] = true; list.push(d) }
    })
  }
  const exact = await db.collection(EMPLOYEE_COLLECTION).where({ empNo: empNo }).limit(50).get()
  push(exact && exact.data)
  // 兼容旧数据：empNo 为数字类型
  if (/^[0-9]+$/.test(empNo)) {
    const num = Number(empNo)
    if (Number.isSafeInteger(num)) {
      try {
        const numeric = await db.collection(EMPLOYEE_COLLECTION).where({ empNo: num }).limit(50).get()
        push(numeric && numeric.data)
      } catch (e) {
        console.log('[employeeAdmin] numeric empNo query failed', (e && e.message) || '')
      }
    }
  }
  return list
}

async function releaseAction(event, session) {
  const ev = event || {}
  const operator = maskOpenid(session && session.openid)
  const employeeId = (ev.employeeId === undefined || ev.employeeId === null) ? '' : String(ev.employeeId).trim()
  const empNo = normalizeEmpNo(ev.empNo)
  if (!employeeId && !empNo) return { ok: false, code: 'PARAM_EMPTY', message: '缺少 employeeId 或 empNo' }

  let targets = []
  if (employeeId) {
    try {
      const r = await db.collection(EMPLOYEE_COLLECTION).doc(employeeId).get()
      if (r && r.data) targets.push(r.data)
    } catch (e) {
      // doc().get() 在文档不存在时会抛错，按未找到处理
      console.log('[employeeAdmin] release doc-not-found', JSON.stringify({ operator: operator, employeeId: employeeId }))
    }
  }
  if (!targets.length && empNo) targets = await findEmpNoMatches(empNo)
  if (!targets.length) return { ok: false, code: 'NOT_FOUND', message: '未找到该员工的绑定记录，可能已被解绑' }

  const removed = []
  for (let i = 0; i < targets.length; i++) {
    const d = targets[i]
    try {
      await db.collection(EMPLOYEE_COLLECTION).doc(d._id).remove()
      removed.push(d)
    } catch (e) {
      console.log('[employeeAdmin] release remove-failed', JSON.stringify({ operator: operator, id: d._id, message: (e && e.message) || '' }))
    }
  }
  if (!removed.length) return { ok: false, code: 'RELEASE_FAILED', message: '解绑失败，请稍后重试' }

  const first = removed[0]
  const firstEmpNo = (first.empNo === undefined || first.empNo === null) ? '' : String(first.empNo)
  console.log('[employeeAdmin] release', JSON.stringify({
    operator: operator,
    by: employeeId ? 'employeeId' : 'empNo',
    empNo: firstEmpNo,
    name: first.name || '',
    removedCount: removed.length,
    removedIds: removed.map(function (d) { return d._id })
  }))
  return { ok: true, data: { empNo: firstEmpNo, name: first.name || '', removed: removed.length } }
}

// ==================== 入口 ====================
exports.main = async (event, context) => {
  const ev = event || {}
  const action = ev.action || 'list'
  try {
    const session = await verifyAdmin(ev)
    if (!session) {
      console.log('[employeeAdmin] auth failed', JSON.stringify({
        action: action,
        tokenLen: ev.adminToken ? String(ev.adminToken).length : 0
      }))
      return needLogin()
    }
    if (action === 'list') return await listAction(ev, session)
    if (action === 'release') return await releaseAction(ev, session)
    return { ok: false, message: '未知操作：' + action }
  } catch (e) {
    console.log('[employeeAdmin] error', (e && (e.stack || e.message)) || 'unknown')
    return { ok: false, code: 'INTERNAL_ERROR', message: '操作失败：' + ((e && e.message) || '请稍后重试') }
  }
}
