'use strict';

// 在 mock wx 环境下加载页面 JS，捕获 Page(...) 配置对象（只执行模块顶层代码，不触发生命周期）
const path = require('node:path');
const { createWxMock } = require('../../helpers/mockWx.js');

const sandboxMock = createWxMock();
sandboxMock.install();
globalThis.getApp = function () { return { globalData: {} }; };

const configCache = new Map();

function loadPageConfig(absPath) {
  const cached = configCache.get(absPath);
  if (cached) return cached;

  let captured = null;
  const prevPage = globalThis.Page;
  const prevWx = globalThis.wx;
  globalThis.Page = function (cfg) { captured = cfg; };
  globalThis.wx = sandboxMock.wx;
  try {
    const resolved = require.resolve(absPath);
    delete require.cache[resolved];
    require(absPath);
  } finally {
    globalThis.Page = prevPage;
    globalThis.wx = prevWx;
  }
  if (!captured || typeof captured !== 'object') {
    throw new Error('页面文件未调用 Page(...)：' + absPath);
  }
  configCache.set(absPath, captured);
  return captured;
}

function pageMethods(config) {
  return Object.keys(config).filter(function (key) {
    return typeof config[key] === 'function';
  });
}

module.exports = { loadPageConfig: loadPageConfig, pageMethods: pageMethods, sandboxMock: sandboxMock };
