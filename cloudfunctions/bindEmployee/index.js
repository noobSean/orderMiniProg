const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// ==================== 文本规范化 ====================
// 真机输入 / 复制粘贴常会混入全角字符（Ｔ０００１）、首尾或中间空格、零宽字符（U+200B / U+FEFF）等。
// 这些「看起来一样」的工号在数据库里是不同的字符串，会导致：
//   1) 员工端明明查不到该工号，却提示「该工号已被绑定」；
//   2) 管理端 / 解绑时定位不到真正的那条记录。
// 因此所有入参先规范化，再做查询与写入。
const COLLECTION = 'employees'
const MAX_EMP_NO_LEN = 32
const MAX_NAME_LEN = 32
const MAX_DEPT_LEN = 64
const MAX_LOCATION_LEN = 96

const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g
const SPACE_RE = /[\s\u00A0\u3000]/g

// 全角转半角：FF01-FF5E 减 0xFEE0；全角空格 U+3000 转半角空格
function toHalfWidth(input) {
  return String(input)
    .replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    })
    .replace(/\u3000/g, ' ')
}

// 工号：全角转半角 -> 删除所有空白与零宽字符
function normalizeEmpNo(value) {
  if (value === undefined || value === null) return ''
  return toHalfWidth(value).replace(ZERO_WIDTH_RE, '').replace(SPACE_RE, '')
}

// 姓名 / 科室 / 位置：去零宽字符 + trim（保留中文本身）
function cleanText(value) {
  if (value === undefined || value === null) return ''
  return String(value).replace(ZERO_WIDTH_RE, '').trim()
}

// ==================== 掩码与日期 ====================
function maskOpenid(openid) {
  if (!openid) return ''
  const s = String(openid)
  return s.length <= 10 ? s : (s.slice(0, 6) + '****' + s.slice(-4))
}

// 占用提示里的姓名掩码：张三丰 -> 张*丰；张三 -> 张*；单字原样
function maskName(name) {
  const s = cleanText(name)
  if (!s) return '（未填姓名）'
  const arr = Array.from(s)
  if (arr.length <= 1) return arr[0]
  if (arr.length === 2) return arr[0] + '*'
  return arr[0] + new Array(arr.length - 1).join('*') + arr[arr.length - 1]
}

function toDate(value) {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return isNaN(value) ? null : new Date(value)
  if (typeof value === 'object' && value.$date !== undefined) return toDate(value.$date)
  const s = String(value)
  let d = new Date(s)
  if (isNaN(d.getTime())) d = new Date(s.replace(/-/g, '/'))
  return isNaN(d.getTime()) ? null : d
}

// 2026-10-26（占用提示里的绑定日期）
function formatDate(value) {
  const d = toDate(value)
  if (!d) return ''
  const p = function (n) { return n < 10 ? '0' + n : '' + n }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

// ==================== 入参 / 出参 ====================
function buildInput(event) {
  const ev = event || {}
  const rawEmpNo = (ev.empNo === undefined || ev.empNo === null) ? '' : String(ev.empNo)
  return {
    rawEmpNo: rawEmpNo,
    empNo: normalizeEmpNo(ev.empNo),
    name: cleanText(ev.name),
    dept: cleanText(ev.dept).slice(0, MAX_DEPT_LEN),
    location: cleanText(ev.location).slice(0, MAX_LOCATION_LEN),
    hasDept: ev.dept !== undefined && ev.dept !== null,
    hasLocation: ev.location !== undefined && ev.location !== null,
    rebind: ev.rebind === true || ev.rebind === 'true' || ev.rebind === 1
  }
}

// 统一成功返回的员工档案（empNo 一律字符串，避免旧数据的数字类型透传给前端）
function buildProfile(doc) {
  const d = doc || {}
  return {
    _id: d._id,
    openid: d.openid || '',
    empNo: normalizeEmpNo(d.empNo),
    name: d.name || '',
    dept: d.dept || '',
    location: d.location || '',
    admin: d.admin === true,
    createdAt: d.createdAt === undefined ? null : d.createdAt
  }
}

function validateInput(input) {
  if (!input.empNo) return { ok: false, code: 'EMP_NO_EMPTY', message: '请输入工号' }
  if (input.empNo.length > MAX_EMP_NO_LEN) return { ok: false, code: 'EMP_NO_TOO_LONG', message: '工号格式不正确（最多 ' + MAX_EMP_NO_LEN + ' 个字符）' }
  if (!input.name) return { ok: false, code: 'NAME_EMPTY', message: '请输入姓名' }
  if (input.name.length > MAX_NAME_LEN) return { ok: false, code: 'NAME_TOO_LONG', message: '姓名过长（最多 ' + MAX_NAME_LEN + ' 个字符）' }
  return null
}

// ==================== 查询 ====================
// 当前 openid 的档案（历史脏数据可能存在多条，取第一条，并保留全部用于冲突判断）
async function findMyProfiles(openid) {
  const res = await db.collection(COLLECTION).where({ openid: openid }).limit(20).get()
  return (res && res.data) || []
}

// 查该工号的占用记录：字符串精确匹配 + 兼容旧数据 empNo 存成数字类型
async function findEmpNoMatches(empNo, tag) {
  const list = []
  const seen = {}
  function push(data) {
    (data || []).forEach(function (d) {
      if (d && d._id && !seen[d._id]) { seen[d._id] = true; list.push(d) }
    })
  }
  // 1) 正常数据：empNo 为规范化后的字符串
  const exact = await db.collection(COLLECTION).where({ empNo: empNo }).limit(20).get()
  push(exact && exact.data)
  // 2) 旧数据：empNo 曾以数字类型写入（如 1001 而不是 '1001'）
  if (/^[0-9]+$/.test(empNo)) {
    const num = Number(empNo)
    if (Number.isSafeInteger(num)) {
      try {
        const numeric = await db.collection(COLLECTION).where({ empNo: num }).limit(20).get()
        push(numeric && numeric.data)
      } catch (e) {
        console.log('[bindEmployee] numeric empNo query failed', (e && e.message) || '')
      }
    }
  }
  console.log('[bindEmployee] empNo query', JSON.stringify({
    tag: tag || '',
    empNo: empNo,
    matchCount: list.length,
    matchId: list[0] ? list[0]._id : '',
    matchEmpNoType: list[0] ? typeof list[0].empNo : ''
  }))
  return list
}

// 幂等命中时顺手修正历史脏工号（如首尾空格 / 数字类型），失败不影响本次绑定结果
async function healProfileEmpNo(profile, empNo, empNoMatches) {
  const stored = (profile && profile.empNo !== undefined && profile.empNo !== null) ? profile.empNo : ''
  if (stored === empNo) return profile
  const conflict = (empNoMatches || []).filter(function (d) { return d._id !== profile._id })
  if (conflict.length) {
    console.log('[bindEmployee] skip heal, empNo also used by other', JSON.stringify({ id: profile._id, empNo: empNo, conflictCount: conflict.length }))
    return profile
  }
  try {
    await db.collection(COLLECTION).doc(profile._id).update({ data: { empNo: empNo, updatedAt: db.serverDate() } })
    console.log('[bindEmployee] heal empNo', JSON.stringify({ id: profile._id, from: String(stored), to: empNo }))
    return Object.assign({}, profile, { empNo: empNo })
  } catch (e) {
    console.log('[bindEmployee] heal empNo failed', (e && e.message) || '')
    return profile
  }
}

// 工号被占用：返回掩码信息，避免泄露他人完整姓名 / openid
function empNoTaken(occupant, empNo, openid) {
  const boundDate = formatDate(occupant && occupant.createdAt)
  const nameMasked = maskName(occupant && occupant.name)
  const message = '该工号已被其他微信绑定（' + nameMasked + (boundDate ? '，' + boundDate + ' 绑定' : '') +
    '），如确为本人请联系管理员在「员工绑定 → 解绑」后重试'
  console.log('[bindEmployee] empNo taken', JSON.stringify({
    openid: maskOpenid(openid),
    empNo: empNo,
    existId: occupant ? occupant._id : '',
    existOpenid: maskOpenid(occupant && occupant.openid),
    existName: nameMasked,
    boundDate: boundDate
  }))
  return { ok: false, code: 'EMP_NO_TAKEN', message: message, data: { empNo: empNo } }
}

// ==================== 入口 ====================
// 绑定员工档案（成功契约保持不变：{ ok: true, data: profile }）
// 分支：新绑定 / 同 openid 同工号幂等 / 同 openid 换绑（rebind）/ 工号被他人占用（EMP_NO_TAKEN）
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const input = buildInput(event)
  const openidMasked = maskOpenid(OPENID)

  console.log('[bindEmployee] start', JSON.stringify({
    openid: openidMasked,
    empNo: input.empNo,
    rawEmpNoLen: input.rawEmpNo.length,
    empNoChangedByNormalize: input.empNo !== input.rawEmpNo,
    name: input.name,
    rebind: input.rebind
  }))

  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '无法获取微信身份，请退出小程序重新进入后重试' }
  const invalid = validateInput(input)
  if (invalid) {
    console.log('[bindEmployee] invalid input', JSON.stringify({ code: invalid.code, openid: openidMasked }))
    return invalid
  }

  try {
    // 1. 当前 openid 的档案
    const mine = await findMyProfiles(OPENID)
    // 2. 该工号的全部占用记录（含旧数字类型）
    const empNoMatches = await findEmpNoMatches(input.empNo, 'bind')
    const myProfile = mine[0] || null
    const mineIds = {}
    mine.forEach(function (d) { mineIds[d._id] = true })

    console.log('[bindEmployee] query', JSON.stringify({
      openid: openidMasked,
      empNo: input.empNo,
      boundCount: mine.length,
      boundId: myProfile ? myProfile._id : '',
      boundEmpNo: myProfile ? normalizeEmpNo(myProfile.empNo) : '',
      existCount: empNoMatches.length,
      existId: empNoMatches[0] ? empNoMatches[0]._id : '',
      existOpenid: empNoMatches[0] ? maskOpenid(empNoMatches[0].openid) : '',
      existEmpNoType: empNoMatches[0] ? typeof empNoMatches[0].empNo : ''
    }))

    // ========== 情况一：当前微信已有员工档案 ==========
    if (myProfile) {
      const same = mine.filter(function (d) { return normalizeEmpNo(d.empNo) === input.empNo })[0]

      // 1.1 同工号 -> 幂等成功（本地缓存丢失 / 换手机重装后再次提交都走这里）
      if (same) {
        const healed = await healProfileEmpNo(same, input.empNo, empNoMatches)
        console.log('[bindEmployee] done idempotent', JSON.stringify({ openid: openidMasked, empNo: input.empNo, id: healed._id }))
        return { ok: true, data: buildProfile(healed) }
      }

      // 1.2 不同工号、未确认换绑 -> 引导前端弹「换绑」确认
      if (!input.rebind) {
        const curEmpNo = normalizeEmpNo(myProfile.empNo) || String(myProfile.empNo || '')
        const curLabel = curEmpNo ? ('工号 ' + curEmpNo) : '员工档案'
        console.log('[bindEmployee] done need-rebind', JSON.stringify({ openid: openidMasked, curEmpNo: curEmpNo, newEmpNo: input.empNo }))
        return {
          ok: false,
          code: 'ALREADY_BOUND_SELF',
          message: '当前微信已绑定' + curLabel + '（' + (myProfile.name || '未填姓名') + '），如需更换请点「换绑」',
          data: { profile: { _id: myProfile._id, empNo: curEmpNo, name: myProfile.name || '' } }
        }
      }

      // 1.3 已确认换绑：先校验新工号是否被其他微信占用
      const conflict = empNoMatches.filter(function (d) { return !mineIds[d._id] })[0]
      if (conflict) {
        console.log('[bindEmployee] done rebind-conflict', JSON.stringify({ openid: openidMasked, newEmpNo: input.empNo, conflictId: conflict._id }))
        return empNoTaken(conflict, input.empNo, OPENID)
      }
      const updateData = { empNo: input.empNo, name: input.name, updatedAt: db.serverDate() }
      if (input.hasDept) updateData.dept = input.dept
      if (input.hasLocation) updateData.location = input.location
      await db.collection(COLLECTION).doc(myProfile._id).update({ data: updateData })
      console.log('[bindEmployee] done rebind', JSON.stringify({
        openid: openidMasked,
        id: myProfile._id,
        fromEmpNo: normalizeEmpNo(myProfile.empNo),
        toEmpNo: input.empNo
      }))
      return { ok: true, data: buildProfile(Object.assign({}, myProfile, updateData, { updatedAt: new Date() })) }
    }

    // ========== 情况二：当前微信没有员工档案 ==========
    // 2.1 该工号已有记录且就是当前 openid（历史脏数据 / 登录态变化）-> 幂等成功
    const ownOccupied = empNoMatches.filter(function (d) { return d.openid && d.openid === OPENID })[0]
    if (ownOccupied) {
      const healed = await healProfileEmpNo(ownOccupied, input.empNo, empNoMatches)
      console.log('[bindEmployee] done idempotent-occupied-by-self', JSON.stringify({ openid: openidMasked, empNo: input.empNo, id: healed._id }))
      return { ok: true, data: buildProfile(healed) }
    }

    // 2.2 该工号已被其他微信占用
    if (empNoMatches.length) {
      console.log('[bindEmployee] done empNo-taken', JSON.stringify({ openid: openidMasked, empNo: input.empNo, existCount: empNoMatches.length }))
      return empNoTaken(empNoMatches[0], input.empNo, OPENID)
    }

    // 2.3 正常创建
    const now = new Date()
    const doc = {
      openid: OPENID,
      empNo: input.empNo,
      name: input.name,
      dept: input.dept,
      location: input.location,
      admin: false,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    const addRes = await db.collection(COLLECTION).add({ data: doc })

    // 并发兜底：两人同时绑定同一工号时，后写入的一方回滚并提示占用，避免产生重复档案
    const after = await findEmpNoMatches(input.empNo, 'after-add')
    const others = after.filter(function (d) { return d._id !== addRes._id })
    if (others.length) {
      try {
        await db.collection(COLLECTION).doc(addRes._id).remove()
      } catch (e) {
        console.log('[bindEmployee] rollback failed', (e && e.message) || '')
      }
      console.log('[bindEmployee] done race-rollback', JSON.stringify({ openid: openidMasked, empNo: input.empNo, id: addRes._id }))
      return empNoTaken(others[0], input.empNo, OPENID)
    }

    console.log('[bindEmployee] done created', JSON.stringify({ openid: openidMasked, empNo: input.empNo, id: addRes._id, name: input.name }))
    return {
      ok: true,
      data: buildProfile(Object.assign({}, doc, { _id: addRes._id, createdAt: now, updatedAt: now }))
    }
  } catch (e) {
    console.log('[bindEmployee] error', (e && (e.stack || e.message)) || 'unknown')
    return { ok: false, code: 'INTERNAL_ERROR', message: '绑定失败：' + ((e && e.message) || '请稍后重试') }
  }
}
