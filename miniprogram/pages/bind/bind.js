const api = require('../../utils/api');

Page({
  data: {
    empNo: '',
    name: '',
    dept: '',
    deptCode: '',
    location: '',
    submitting: false
  },

  onShow() {
    // 若当前微信其实已绑定过（例如本地缓存被清理），自动恢复登录并返回
    if (this._restoreChecked) return;
    this._restoreChecked = true;
    const app = getApp();
    app.ensureLogin().then(r => {
      if (r && r.state === 'bound' && r.profile) {
        wx.showToast({ title: '已恢复登录', icon: 'none' });
        setTimeout(() => {
          const pages = getCurrentPages();
          if (pages.length > 1) wx.navigateBack();
          else wx.switchTab({ url: '/pages/profile/profile' });
        }, 600);
      }
    }).catch(() => {});
  },

  // 已绑定过但本地登录态丢失：用当前微信直接登录（不重新填资料）
  async onLoginExisting() {
    if (this._loggingIn) return;
    this._loggingIn = true;
    wx.showLoading({ title: '登录中', mask: true });
    try {
      const r = await getApp().loginNow();
      if (r && r.profile) {
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
          const pages = getCurrentPages();
          if (pages.length > 1) wx.navigateBack();
          else wx.switchTab({ url: '/pages/profile/profile' });
        }, 600);
      } else if (r && r.state === 'unbound') {
        wx.showToast({ title: '该微信还没有绑定记录，请先绑定', icon: 'none' });
      } else {
        wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
      }
    } finally {
      this._loggingIn = false;
      wx.hideLoading();
    }
  },

  onEmp(e) { this.setData({ empNo: e.detail.value }); },
  onName(e) { this.setData({ name: e.detail.value }); },
  onLoc(e) { this.setData({ location: e.detail.value }); },

  onPickDept() {
    wx.navigateTo({
      url: '/pages/dept-select/dept-select',
      events: {
        picked: (d) => this.setData({ dept: d.name, deptCode: d.code || '' })
      }
    });
  },

  // 提交前统一 trim，避免真机输入 / 粘贴带入的空格导致「看起来一样」的工号对不上
  collectForm() {
    return {
      empNo: String(this.data.empNo == null ? '' : this.data.empNo).trim(),
      name: String(this.data.name == null ? '' : this.data.name).trim(),
      dept: String(this.data.dept == null ? '' : this.data.dept).trim(),
      location: String(this.data.location == null ? '' : this.data.location).trim()
    };
  },

  submit() { this.doBind(false); },

  // rebind=true 表示用户已确认「换绑」（当前微信已绑定其他工号）
  doBind(rebind) {
    if (this.data.submitting) return;
    const form = this.collectForm();
    if (!form.empNo) { wx.showToast({ title: '请输入工号', icon: 'none' }); return; }
    if (!form.name) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return; }
    if (!form.dept) { wx.showToast({ title: '请选择科室', icon: 'none' }); return; }

    // 回写 trim 后的值，避免用户再次点击时又带上空格
    this.setData({ empNo: form.empNo, name: form.name, location: form.location, submitting: true });
    wx.showLoading({ title: rebind ? '换绑中' : '绑定中', mask: true });

    api.bindEmployee({
      empNo: form.empNo,
      name: form.name,
      dept: form.dept,
      location: form.location,
      rebind: !!rebind
    }).then(data => {
      wx.hideLoading();
      this.setData({ submitting: false });
      getApp().setProfile(data);
      getApp().setLoggedOut(false);   // 绑定成功即视为登录态有效
      wx.showToast({ title: rebind ? '换绑成功' : '绑定成功', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack();
        else wx.switchTab({ url: '/pages/menu/menu' });
      }, 700);
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      this.onBindError(err);
    });
  },

  // 按云函数返回的 code 分支处理
  onBindError(err) {
    const code = err && err.code;
    const message = (err && err.message) || '绑定失败';

    // 工号已被其他微信占用：展示服务端返回的掩码信息（姓名 + 绑定日期），仅提示
    if (code === 'EMP_NO_TAKEN') {
      wx.showModal({
        title: '工号已被占用',
        content: message,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    // 当前微信已绑定其他工号：确认后带 rebind:true 重试（服务端仍会做唯一性校验）
    if (code === 'ALREADY_BOUND_SELF') {
      wx.showModal({
        title: '确认换绑',
        content: message,
        confirmText: '换绑',
        cancelText: '取消',
        success: res => {
          if (res.confirm) this.doBind(true);
        }
      });
      return;
    }

    wx.showToast({ title: message, icon: 'none' });
  }
});
