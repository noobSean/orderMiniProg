'use strict';

/**
 * 回归守护：启动期不得注入 E2E 假数据 / 篡改云调用
 *
 * 背景：本次静态检查在开发过程中曾发现 miniprogram/app.js 的 onLaunch 内嵌一段
 * __TEMP_PREVIEW__ E2E 冒烟代码（写入假管理会话/假员工档案/假购物车，改写
 * wx.cloud.callFunction 与 wx.cloud.database，并自动跳转页面）。该问题已在源码侧移除，
 * 本文件作为回归守护：一旦再次出现，测试立即失败。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const project = require('./lib/project.js');

const APP_JS = path.join(project.ROOT, 'miniprogram/app.js');

test('app.js 不得残留 __TEMP_PREVIEW__ E2E 注入块', () => {
  const source = project.readText(APP_JS);
  assert.doesNotMatch(source, /__TEMP_PREVIEW__/, 'app.js 出现 E2E 注入标记，上线前必须删除');
  assert.doesNotMatch(source, /dsh_admin_session/, 'app.js 启动期不得写入/读取管理会话假数据');
  assert.doesNotMatch(source, /wx\.cloud\.callFunction\s*=\s*function/, 'app.js 不得改写 wx.cloud.callFunction');
  assert.doesNotMatch(source, /wx\.cloud\.database\s*=\s*function/, 'app.js 不得改写 wx.cloud.database');
  assert.doesNotMatch(source, /var\s+tick\s*=\s*function|function\s+tick\s*\(/, 'app.js 不得包含自动跳转 E2E 步骤');
});

test('app.js onLaunch 只做云初始化 + 静默登录', () => {
  const source = project.readText(APP_JS);
  const match = /onLaunch\s*\(\s*\)\s*\{([\s\S]*?)\n\s{2}\},/.exec(source);
  assert.ok(match, '未找到 onLaunch 方法');
  const body = match[1];
  assert.match(body, /wx\.cloud\.init\s*\(/, 'onLaunch 应初始化云开发');
  assert.match(body, /this\.ensureLogin\s*\(/, 'onLaunch 应触发静默登录');
  assert.doesNotMatch(body, /setStorageSync/, 'onLaunch 不应直接写业务缓存（应由 ensureLogin 负责）');
});
