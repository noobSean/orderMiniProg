'use strict';

/**
 * 静态校验 A4：体积与兼容性
 *  - 主包（miniprogram 目录）体积 vs 微信小程序主包 2MB 限制
 *  - 云函数各目录体积
 *  - wx.* / wx.cloud.* API 使用清单，与 project.config.json 的 libVersion（2.33.0）
 *    以及最低目标基础库 2.4.4 做兼容性核对
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const project = require('./lib/project.js');

const MAIN_PACKAGE_LIMIT_BYTES = 2 * 1024 * 1024; // 微信小程序主包 2MB
const CLOUD_FUNCTION_WARN_BYTES = 20 * 1024 * 1024; // 单个云函数目录体积上限（保守值）
const MIN_TARGET_LIB = '2.4.4'; // 项目希望兼容的最低基础库
const HIGHER_THAN_MIN_LIB = ['chooseMedia']; // 需要 > 2.4.4 但已做特性检测降级的 API

// 工程用到的小程序 API 最低基础库版本（官方文档口径）
const WX_API_MIN_VERSION = {
  cloud: '2.2.3',
  getStorageSync: '1.0.0',
  setStorageSync: '1.0.0',
  removeStorageSync: '1.0.0',
  clearStorageSync: '1.0.0',
  getStorageInfoSync: '1.0.0',
  showToast: '1.0.0',
  showLoading: '1.1.0',
  hideLoading: '1.1.0',
  showModal: '1.0.0',
  previewImage: '1.0.0',
  chooseImage: '1.0.0',
  chooseMedia: '2.10.0',
  requestSubscribeMessage: '2.4.4',
  navigateTo: '1.0.0',
  navigateBack: '1.0.0',
  redirectTo: '1.0.0',
  switchTab: '1.0.0',
  reLaunch: '1.0.0',
  showTabBar: '1.9.0',
  hideTabBar: '1.9.0',
  stopPullDownRefresh: '1.0.0'
};

// wx.cloud 子 API 最低版本（云开发能力基线 2.2.3）
const WX_CLOUD_API_MIN_VERSION = {
  init: '2.2.3',
  callFunction: '2.2.3',
  uploadFile: '2.2.3',
  deleteFile: '2.2.3',
  getTempFileURL: '2.2.3',
  database: '2.2.3'
};

function versionParts(version) {
  return String(version).split('.').map(function (part) {
    const n = parseInt(part, 10);
    return isNaN(n) ? 0 : n;
  });
}

// a > b 返回正数，a < b 返回负数
function compareVersion(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function collectWxApis() {
  const direct = new Map(); // api -> Set(相对文件)
  const cloud = new Map();
  function add(map, api, file) {
    if (!map.has(api)) map.set(api, new Set());
    map.get(api).add(project.rel(file));
  }
  for (const file of project.listFiles('miniprogram')) {
    if (!file.endsWith('.js')) continue;
    const source = project.readText(file);
    let match;
    const cloudRe = /\bwx\.cloud\.([A-Za-z_][A-Za-z0-9_]*)/g;
    while ((match = cloudRe.exec(source))) add(cloud, match[1], file);
    const directRe = /\bwx\.([A-Za-z_][A-Za-z0-9_]*)/g;
    while ((match = directRe.exec(source))) add(direct, match[1], file);
  }
  return { direct: direct, cloud: cloud };
}

test('project.config.json 的 libVersion 有效且不低于最低目标 2.4.4', () => {
  const config = project.readJson(path.join(project.ROOT, 'project.config.json'));
  assert.equal(config.miniprogramRoot, 'miniprogram/');
  assert.equal(config.cloudfunctionRoot, 'cloudfunctions/');
  assert.match(String(config.libVersion), /^\d+\.\d+\.\d+$/, 'libVersion 格式异常：' + config.libVersion);
  assert.ok(
    compareVersion(config.libVersion, MIN_TARGET_LIB) >= 0,
    'libVersion ' + config.libVersion + ' 低于最低目标基础库 ' + MIN_TARGET_LIB
  );
});

test('wx.* API 使用清单完整，且全部低于当前基础库版本（2.33.0）', () => {
  const config = project.readJson(path.join(project.ROOT, 'project.config.json'));
  const currentLib = config.libVersion;
  const collected = collectWxApis();
  assert.ok(collected.direct.size >= 10, '扫描到的 wx.* API 数量异常（实际 ' + collected.direct.size + '）');
  const unknown = [];
  const tooNew = [];
  for (const api of collected.direct.keys()) {
    const minVersion = WX_API_MIN_VERSION[api];
    if (!minVersion) {
      unknown.push(api + '（' + Array.from(collected.direct.get(api)).join(', ') + '）');
      continue;
    }
    if (compareVersion(minVersion, currentLib) > 0) {
      tooNew.push(api + ' 需要基础库 ' + minVersion + ' > ' + currentLib);
    }
  }
  assert.deepEqual(unknown, [], '发现未登记最低基础库版本的 wx.* API，请补充 WX_API_MIN_VERSION：\n' + unknown.join('\n'));
  assert.deepEqual(tooNew, [], '以下 API 超出当前基础库版本：\n' + tooNew.join('\n'));
});

test('wx.cloud.* 使用清单完整，且满足云开发基线 2.2.3', () => {
  const collected = collectWxApis();
  assert.ok(collected.cloud.size >= 5, '扫描到的 wx.cloud.* API 数量异常（实际 ' + collected.cloud.size + '）');
  const unknown = [];
  for (const api of collected.cloud.keys()) {
    if (!WX_CLOUD_API_MIN_VERSION[api]) unknown.push(api);
  }
  assert.deepEqual(unknown, [], '发现未登记的 wx.cloud.* API：\n' + unknown.join('\n'));
});

test('高于最低基础库 2.4.4 的 API 已被特性检测降级（chooseMedia -> chooseImage）', () => {
  const collected = collectWxApis();
  const high = [];
  for (const api of collected.direct.keys()) {
    const minVersion = WX_API_MIN_VERSION[api];
    if (minVersion && compareVersion(minVersion, MIN_TARGET_LIB) > 0) high.push(api);
  }
  high.sort();
  assert.deepEqual(high, HIGHER_THAN_MIN_LIB.slice().sort(), '高于 ' + MIN_TARGET_LIB + ' 的 API 清单发生变化，请核对降级逻辑：' + high.join(', '));
  const uploadSource = project.readText(path.join(project.ROOT, 'miniprogram/utils/upload.js'));
  assert.match(uploadSource, /if\s*\(\s*wx\.chooseMedia\s*\)/, 'upload.js 应对 wx.chooseMedia 做特性检测');
  assert.match(uploadSource, /wx\.chooseImage\s*\(/, 'wx.chooseMedia 不可用时应降级到 wx.chooseImage');
});

test('小程序主包体积小于 2MB（含逐目录明细）', () => {
  const size = project.dirSize(path.join(project.ROOT, 'miniprogram'));
  assert.ok(size.bytes > 0 && size.fileCount > 0, 'miniprogram 目录为空？');
  assert.ok(
    size.bytes < MAIN_PACKAGE_LIMIT_BYTES,
    '主包体积 ' + (size.bytes / 1024).toFixed(1) + 'KB 超过 2MB 限制（' + size.fileCount + ' 个文件）'
  );
});

test('app.json 未使用分包（主包承担全部页面，2MB 限制适用于整包）', () => {
  const appJson = project.readJson(path.join(project.ROOT, 'miniprogram/app.json'));
  assert.equal(appJson.subpackages, undefined, '当前工程不应有分包配置');
  assert.equal(appJson.subPackages, undefined, '当前工程不应有分包配置');
});

test('云函数目录体积合理（单函数 < 20MB）且结构完整', () => {
  const functionsDir = path.join(project.ROOT, 'cloudfunctions');
  const names = fs.readdirSync(functionsDir).filter(function (name) {
    return fs.statSync(path.join(functionsDir, name)).isDirectory();
  });
  assert.ok(names.length >= 15, '云函数数量异常（实际 ' + names.length + '）');
  const tooBig = [];
  for (const name of names) {
    const dir = path.join(functionsDir, name);
    assert.ok(fs.existsSync(path.join(dir, 'index.js')), name + ' 缺少 index.js');
    assert.ok(fs.existsSync(path.join(dir, 'package.json')), name + ' 缺少 package.json');
    const size = project.dirSize(dir);
    if (size.bytes >= CLOUD_FUNCTION_WARN_BYTES) {
      tooBig.push(name + ' ' + (size.bytes / 1024 / 1024).toFixed(1) + 'MB');
    }
  }
  assert.deepEqual(tooBig, [], '云函数目录体积过大：\n' + tooBig.join('\n'));
});

test('miniprogram 目录不包含 node_modules / miniprogram_npm 等依赖目录', () => {
  const miniprogramDir = path.join(project.ROOT, 'miniprogram');
  const found = [];
  const walk = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm') found.push(project.rel(abs));
      else walk(abs);
    }
  };
  walk(miniprogramDir);
  assert.deepEqual(found, [], '主包内不应有依赖目录：\n' + found.join('\n'));
});
