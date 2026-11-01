/**
 * 管理后台登录页
 *
 * 管理页守卫（utils/adminAuth.js 的 ensure）在未登录/会话过期时 redirect 到本页，
 * 并带上 redirect 参数；登录成功后回到原页面，直接进入则回到管理首页。
 * 口令由云函数 adminLogin 校验，通过后签发 12 小时有效的管理会话（见 utils/adminAuth.js）。
 */
const api = require('../../utils/api.js');
const adminAuth = require('../../utils/adminAuth.js');

// 只允许站内页面路径作为回跳地址；兼容部分基础库未自动解码 query 的情况
function safeRedirect(raw) {
  let url = (typeof raw === 'string') ? raw.trim() : '';
  if (!url) return '';
  if (url.indexOf('/pages/') !== 0) {
    let decoded = '';
    try {
      decoded = decodeURIComponent(url);
    } catch (e) {
      decoded = '';
    }
    if (decoded && decoded.indexOf('/pages/') === 0) url = decoded;
  }
  return url.indexOf('/pages/') === 0 ? url : '';
}

Page({
  data: {
    pwd: '',
    loading: false,
    redirect: ''   // 登录成功后的回跳地址（已在 onLoad 校验）
  },

  onLoad(options) {
    this.setData({ redirect: safeRedirect(options && options.redirect) });
    // 已有有效会话：直接进入，不再重复输入口令
    if (adminAuth.isValid()) this.goAfterLogin();
  },

  onPwdInput(e) { this.setData({ pwd: e.detail.value }); },

  async onSubmit() {
    const pwd = (this.data.pwd || '').trim();
    if (!pwd) return wx.showToast({ title: '请输入管理口令', icon: 'none' });
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const data = await api.adminLogin({ action: 'login', pwd });
      adminAuth.save(data);
      wx.showToast({ title: '登录成功', icon: 'success', duration: 600 });
      setTimeout(() => this.goAfterLogin(), 400);
    } catch (err) {
      this.setData({ pwd: '' });
      wx.showToast({ title: (err && err.message) || '口令错误', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 登录成功后的跳转：优先回原页面，否则进管理首页
  goAfterLogin() {
    const target = this.data.redirect || '/pages/admin/home';
    wx.redirectTo({
      url: target,
      fail: () => wx.reLaunch({ url: target })
    });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/menu/menu' });
  }
});
