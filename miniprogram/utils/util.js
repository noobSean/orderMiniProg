function pad(n) { return n < 10 ? '0' + n : '' + n; }

// yyyy-MM-dd HH:mm
function formatTime(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * 解析各种来源的时间值为 Date（拿不到返回 null）
 * 兼容：
 *  - Date 实例
 *  - 毫秒/秒级时间戳（数字或纯数字字符串）
 *  - ISO 字符串（云函数返回的 serverDate 会被序列化成 "2026-10-29T07:23:27.000Z"）
 *  - "YYYY-MM-DD HH:mm:ss"（iOS 不认 - 分隔，会做降级）
 *  - 微信云数据库特殊对象：{ $date } / { $numberLong } / { seconds } / { _seconds } / { time }
 */
function parseTime(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    const ms = v < 1e12 ? v * 1000 : v;   // 10 位按秒处理
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object') {
    if (v.$date !== undefined) return parseTime(v.$date);
    if (v.$numberLong !== undefined) return parseTime(Number(v.$numberLong));
    if (v.time !== undefined) return parseTime(v.time);
    if (v.seconds !== undefined) return parseTime(Number(v.seconds) * 1000);
    if (v._seconds !== undefined) return parseTime(Number(v._seconds) * 1000);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{10,13}$/.test(s)) return parseTime(Number(s));
  // ISO（带 T/Z/时区）直接交给 Date，能正确转成本地时间
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // "YYYY-MM-DD HH:mm:ss" 这类 iOS 不认的格式，降级成 /
  d = new Date(s.replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}

// 解析并格式化为 "yyyy-MM-dd HH:mm"，解析失败返回 ''
function formatTimeValue(v) {
  const d = parseTime(v);
  return d ? formatTime(d) : '';
}

function toYmd(date) {
  const d = date || new Date();
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
}

// 生成取餐号：取餐日期内的递增序号由云函数生成，这里仅做展示格式化
function money(n) {
  return (Number(n) || 0).toFixed(2);
}

module.exports = { formatTime, formatTimeValue, parseTime, toYmd, money, pad };
