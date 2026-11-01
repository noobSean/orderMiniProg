/**
 * 管理后台会话（口令登录态）
 *
 * 设计：
 *  - 管理入口与员工绑定解耦：任何微信打开 `pages/admin/login`，输入管理口令即可进入管理后台；
 *  - 口令由云函数 adminLogin 校验，校验通过后签发 token（服务端 admin_sessions 集合，12 小时有效）；
 *  - token 保存在本地缓存，utils/api.js 会自动把它作为 adminToken 附带到云函数参数；
 *  - 管理端页面 onShow 时调用 ensure()：未登录/过期自动跳转登录页，登录成功后回到原页面。
 *
 * 注意：这里只做前端体验层判断，真正的权限校验在云函数端（admin_sessions）。
 */
const STORAGE_KEY = 'dsh_admin_session';
const DEFAULT_TTL = 12 * 60 * 60 * 1000; // 与云函数 adminLogin 的 TTL 保持一致（仅用于本地兜底）

function read() {
  try {
    const s = wx.getStorageSync(STORAGE_KEY);
    return (s && s.token) ? s : null;
  } catch (e) {
    return null;
  }
}

function isValid(session) {
  const s = session || read();
  return !!(s && s.token && Number(s.expireAt) > Date.now());
}

function session() {
  const s = read();
  return isValid(s) ? s : null;
}

function token() {
  const s = session();
  return s ? s.token : '';
}

// 保存云端下发的会话 {token, expireAt}
function save(s) {
  if (!s || !s.token) return null;
  const out = {
    token: String(s.token),
    expireAt: Number(s.expireAt) || (Date.now() + DEFAULT_TTL)
  };
  try { wx.setStorageSync(STORAGE_KEY, out); } catch (e) {}
  return out;
}

function clear() {
  try { wx.removeStorageSync(STORAGE_KEY); } catch (e) {}
}

// 当前页面完整路径（含 query），用于登录成功后跳回
function currentPageUrl() {
  try {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    if (!page) return '';
    let url = '/' + page.route;
    const opts = page.options || {};
    const query = Object.keys(opts).map(function (k) {
      return k + '=' + encodeURIComponent(opts[k] == null ? '' : opts[k]);
    }).join('&');
    if (query) url += '?' + query;
    return url;
  } catch (e) {
    return '';
  }
}

function loginUrl(redirect) {
  return '/pages/admin/login' + (redirect ? '?redirect=' + encodeURIComponent(redirect) : '');
}

/**
 * 管理端页面守卫：已登录返回 true；未登录则跳转登录页（登录后回到当前页）并返回 false。
 * @param {string} [redirect] 自定义登录成功后的跳转地址
 */
function ensure(redirect) {
  if (isValid()) return true;
  clear();
  const to = (typeof redirect === 'string' && redirect) ? redirect : currentPageUrl();
  wx.redirectTo({ url: loginUrl(to) });
  return false;
}

module.exports = {
  read,
  session,
  isValid,
  token,
  save,
  clear,
  loginUrl,
  ensure
};
