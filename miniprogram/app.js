const config = require('./config/index');
const api = require('./utils/api');

const LOGOUT_KEY = 'dsh_logged_out';

App({
  globalData: {
    profile: null,        // 当前员工档案 { _id, empNo, name, dept, location, admin }
    loginState: 'idle',   // idle | pending | bound | unbound | logged_out | error
    _loginPromise: null
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: config.envId || undefined,
        traceUser: true
      });
    }
    // 启动即静默登录：同一微信（openid）直接恢复员工档案，无需重新绑定
    this.ensureLogin();
  },

  onShow() {
    // 回到前台时后台刷新一次档案（管理员改名/解绑后能及时反映），不阻塞页面
    if (this.globalData.profile) this.refreshProfile();
  },

  /* ---------------- 登录状态 ---------------- */

  isLoggedOut() {
    try { return !!wx.getStorageSync(LOGOUT_KEY); } catch (e) { return false; }
  },

  setLoggedOut(flag) {
    try {
      if (flag) wx.setStorageSync(LOGOUT_KEY, true);
      else wx.removeStorageSync(LOGOUT_KEY);
    } catch (e) {}
  },

  /**
   * 确保登录态（静默登录）：
   *  - 内存已有档案：直接返回；
   *  - 本地有缓存：先返回缓存，同时后台向云端刷新；
   *  - 用户主动退出过（logged_out）：不自动登录，返回 logged_out，等用户点「重新登录」；
   *  - 否则调用 login 云函数：有档案=恢复登录；没有=未绑定；失败=error（可重试）。
   * @param {{force?: boolean}} [opts] force=true 忽略退出标记，强制向云端确认
   * @returns {Promise<{state: string, profile: object|null, error?: Error}>}
   */
  ensureLogin(opts) {
    const force = !!(opts && opts.force);
    if (this.globalData.profile && !force) {
      return Promise.resolve({ state: 'bound', profile: this.globalData.profile });
    }
    if (this.globalData._loginPromise && !force) return this.globalData._loginPromise;

    if (!force && this.isLoggedOut()) {
      this.globalData.loginState = 'logged_out';
      return Promise.resolve({ state: 'logged_out', profile: null });
    }

    const cached = this.getCachedProfile();
    if (cached && !force) {
      this.globalData.loginState = 'bound';
      this.refreshProfile();
      return Promise.resolve({ state: 'bound', profile: cached });
    }

    this.globalData.loginState = 'pending';
    const p = api.login().then(data => {
      const profile = (data && data.profile) || null;
      if (profile) {
        this.setProfile(profile);
        this.globalData.loginState = 'bound';
        return { state: 'bound', profile: profile };
      }
      this.setProfile(null);
      this.globalData.loginState = 'unbound';
      return { state: 'unbound', profile: null };
    }).catch(err => {
      this.globalData.loginState = 'error';
      return { state: 'error', profile: this.getCachedProfile(), error: err };
    }).then(res => {
      this.globalData._loginPromise = null;
      return res;
    });
    this.globalData._loginPromise = p;
    return p;
  },

  // 用户主动点「重新登录」：清除退出标记并强制向云端确认
  loginNow() {
    this.setLoggedOut(false);
    return this.ensureLogin({ force: true });
  },

  // 退出登录：清本地档案并记住退出状态（下次启动不会自动登录）
  logout() {
    this.setProfile(null);
    this.setLoggedOut(true);
    this.globalData.loginState = 'logged_out';
  },

  // 后台静默刷新档案：有档案则更新；被管理员解绑/删除则清空本地登录态
  refreshProfile() {
    if (this.isLoggedOut()) return;
    api.login().then(data => {
      const profile = (data && data.profile) || null;
      if (profile) {
        this.setProfile(profile);
        this.globalData.loginState = 'bound';
      } else {
        this.setProfile(null);
        this.globalData.loginState = 'unbound';
      }
    }).catch(() => {});
  },

  /* ---------------- 本地档案缓存 ---------------- */

  // 读取本地缓存的员工档案
  getCachedProfile() {
    if (this.globalData.profile) return this.globalData.profile;
    try {
      const p = wx.getStorageSync('dsh_profile');
      if (p && p._id) this.globalData.profile = p;
      return (p && p._id) ? p : null;
    } catch (e) { return null; }
  },

  setProfile(p) {
    this.globalData.profile = p || null;
    try {
      if (p) wx.setStorageSync('dsh_profile', p);
      else wx.removeStorageSync('dsh_profile');
    } catch (e) {}
  }
});
