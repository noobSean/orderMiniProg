/**
 * 管理后台 —— 修改管理密码
 *
 * 流程：输入原密码 + 新密码（两次确认）→ adminLogin(changePwd) 校验并保存（scrypt 加盐哈希）
 *      → 云端让所有管理会话失效 → 清本地会话 → 跳登录页用新密码重新登录。
 * 密码规则与云函数一致：6-32 位，不能包含空格，不能与原密码相同。
 */
const api = require('../../../utils/api.js');
const adminAuth = require('../../../utils/adminAuth.js');

const MIN_LEN = 6;
const MAX_LEN = 32;

function toast(title) {
  wx.showToast({ title: title, icon: 'none' });
}

Page({
  data: {
    ready: false,
    saving: false,
    oldPwd: '',
    newPwd: '',
    confirmPwd: ''
  },

  onShow() {
    // 管理端会话守卫：未登录/过期会跳转登录页，登录成功回到本页
    if (!adminAuth.ensure()) return;
    this.setData({ ready: true });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value });
  },

  async onSubmit() {
    if (this.data.saving) return;
    const oldPwd = (this.data.oldPwd || '').trim();
    const newPwd = (this.data.newPwd || '').trim();
    const confirmPwd = (this.data.confirmPwd || '').trim();

    if (!oldPwd) return toast('请输入原管理密码');
    if (!newPwd) return toast('请输入新管理密码');
    if (newPwd.length < MIN_LEN || newPwd.length > MAX_LEN) return toast('新密码长度需为 ' + MIN_LEN + '-' + MAX_LEN + ' 位');
    if (/\s/.test(newPwd)) return toast('新密码不能包含空格');
    if (newPwd === oldPwd) return toast('新密码不能与原密码相同');
    if (newPwd !== confirmPwd) return toast('两次输入的新密码不一致');

    this.setData({ saving: true });
    try {
      await api.adminChangePwd(oldPwd, newPwd);
      adminAuth.clear();
      wx.showToast({ title: '密码已修改', icon: 'success', duration: 900 });
      setTimeout(() => {
        const target = '/pages/admin/login?redirect=' + encodeURIComponent('/pages/admin/home');
        wx.redirectTo({ url: target, fail: () => wx.reLaunch({ url: target }) });
      }, 900);
    } catch (err) {
      toast((err && err.message) || '修改失败');
    } finally {
      this.setData({ saving: false });
    }
  }
});
