'use strict';

/**
 * 个人页管理入口可见性（第一层安全）
 * 只有 whoami 返回 isAdmin=true（或首次 bootstrap）才显示管理后台入口。
 * 运行：node --test tests/client/profileAdminEntry.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const req = createRequire(path.join(__dirname, 'load.js'));

const apiPath = req.resolve(path.join(ROOT, 'miniprogram/utils/api.js'));
const authPath = req.resolve(path.join(ROOT, 'miniprogram/utils/adminAuth.js'));
let whoamiResult = { isAdmin: false, bootstrap: false };
req.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    adminWhoami: async () => { if (whoamiResult && whoamiResult.__reject) throw new Error('network'); return whoamiResult; }
  }
};
req.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { isValid: () => false, ensure: () => true, clear: () => {}, loginUrl: (u) => u }
};

globalThis.wx = { getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {}, showToast: () => {}, navigateTo: () => {} };
globalThis.getApp = () => ({ getCachedProfile: () => null, ensureLogin: async () => ({ state: 'unbound' }) });

function loadProfilePage() {
  let def = null;
  globalThis.Page = (d) => { def = d; };
  const file = req.resolve(path.join(ROOT, 'miniprogram/pages/profile/profile.js'));
  delete req.cache[file];
  req(file);
  return def;
}
function instantiate(def) {
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data || {}));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return page;
}

async function visibility(result) {
  whoamiResult = result;
  const page = instantiate(loadProfilePage());
  page.checkAdminEntry();
  await new Promise(r => setTimeout(r, 20));
  return page.data;
}

test('whoami isAdmin=true：显示管理入口', async () => {
  const data = await visibility({ isAdmin: true, bootstrap: false });
  assert.equal(data.showAdmin, true);
  assert.equal(data.adminBootstrap, false);
});

test('whoami bootstrap=true：首次初始化临时显示入口', async () => {
  const data = await visibility({ isAdmin: false, bootstrap: true });
  assert.equal(data.showAdmin, true);
  assert.equal(data.adminBootstrap, true);
});

test('普通员工/用户：隐藏管理入口', async () => {
  const data = await visibility({ isAdmin: false, bootstrap: false });
  assert.equal(data.showAdmin, false);
});

test('whoami 请求失败：保守隐藏入口', async () => {
  const data = await visibility({ __reject: true });
  assert.equal(data.showAdmin, false);
});
