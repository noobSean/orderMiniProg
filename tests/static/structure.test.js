'use strict';

/**
 * 静态校验 A2：工程结构完整性
 *  - require 相对路径可解析
 *  - app.json 注册页面四件套齐全、无孤儿页面、tabBar / sitemap 有效
 *  - WXML 上 bind / catch 事件处理函数在对应 Page() 中真实存在
 *  - 云函数目录结构（index.js / package.json / 依赖声明 / config.json）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const project = require('./lib/project.js');
const wxml = require('./lib/wxml.js');
const pageConfig = require('./lib/pageConfig.js');

const APP_JSON_PATH = path.join(project.ROOT, 'miniprogram/app.json');
const APP_JSON = JSON.parse(project.readText(APP_JSON_PATH));
const PAGES = APP_JSON.pages;
const PAGE_DIR = path.join(project.ROOT, 'miniprogram/pages');

const PAGE_EXTS = ['.js', '.json', '.wxml', '.wxss'];

function pageAbs(route, ext) {
  return path.join(project.ROOT, 'miniprogram', route + ext);
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base + '.js', base + '.json', path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (err) {
      // ignore
    }
  }
  return null;
}

test('app.json 注册的页面四件套（js/json/wxml/wxss）齐全', () => {
  assert.ok(Array.isArray(PAGES) && PAGES.length >= 10, 'app.json pages 数量异常');
  const failures = [];
  for (const route of PAGES) {
    for (const ext of PAGE_EXTS) {
      const abs = pageAbs(route, ext);
      if (!fs.existsSync(abs)) failures.push(route + ext);
    }
  }
  assert.deepEqual(failures, [], '缺少页面文件：\n' + failures.join('\n'));
});

test('pages 目录下所有页面都已注册到 app.json（无孤儿页面）', () => {
  const discovered = [];
  const walkPages = function (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkPages(abs);
      } else if (entry.name.endsWith('.js')) {
        discovered.push(project.rel(abs).replace('miniprogram/', '').replace(/\.js$/, ''));
      }
    }
  };
  walkPages(PAGE_DIR);
  const unregistered = discovered.filter(function (route) {
    return PAGES.indexOf(route) < 0;
  });
  assert.deepEqual(unregistered, [], '存在未在 app.json 注册的页面：\n' + unregistered.join('\n'));
  const missingOnDisk = PAGES.filter(function (route) {
    return discovered.indexOf(route) < 0;
  });
  assert.deepEqual(missingOnDisk, [], 'app.json 注册但磁盘不存在的页面：\n' + missingOnDisk.join('\n'));
});

test('tabBar / sitemap / window 配置有效', () => {
  assert.equal(APP_JSON.sitemapLocation, 'sitemap.json');
  const sitemap = project.readJson(path.join(project.ROOT, 'miniprogram/sitemap.json'));
  assert.ok(Array.isArray(sitemap.rules) && sitemap.rules.length > 0, 'sitemap.json 缺少 rules');
  assert.ok(APP_JSON.window && typeof APP_JSON.window === 'object', 'app.json 缺少 window 配置');
  const tabBar = APP_JSON.tabBar;
  assert.ok(tabBar && Array.isArray(tabBar.list), 'app.json 缺少 tabBar.list');
  assert.ok(tabBar.list.length >= 2, 'tabBar.list 数量异常');
  for (const item of tabBar.list) {
    assert.ok(PAGES.indexOf(item.pagePath) >= 0, 'tabBar 页面未注册：' + item.pagePath);
    assert.ok(typeof item.text === 'string' && item.text.length > 0, 'tabBar 缺少 text：' + item.pagePath);
  }
  assert.ok(typeof APP_JSON.style === 'string', 'app.json 缺少 style（v2）');
});

test('所有相对 require 路径均可解析（miniprogram + cloudfunctions）', () => {
  const roots = ['miniprogram', 'cloudfunctions'];
  const failures = [];
  const external = new Map();
  for (const dir of roots) {
    for (const file of project.listFiles(dir)) {
      if (!file.endsWith('.js')) continue;
      const source = project.readText(file);
      const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
      let match;
      while ((match = re.exec(source))) {
        const spec = match[2];
        if (spec.charAt(0) !== '.') {
          const key = project.rel(file).split('/').slice(0, 2).join('/') + '|' + spec;
          external.set(key, true);
          continue;
        }
        if (!resolveRelative(file, spec)) {
          failures.push(project.rel(file) + ' -> ' + spec);
        }
      }
    }
  }
  assert.deepEqual(failures, [], '相对 require 无法解析：\n' + failures.join('\n'));
  assert.ok(external.size > 0, '未扫描到任何外部依赖 require（检查器可能失效）');
});

test('云函数的外部依赖都在各自 package.json 中声明', () => {
  const builtins = new Set(builtinModules.concat(['node:crypto', 'node:util']));
  const failures = [];
  const functionsDir = path.join(project.ROOT, 'cloudfunctions');
  const functionNames = fs.readdirSync(functionsDir).filter(function (name) {
    return fs.statSync(path.join(functionsDir, name)).isDirectory();
  });
  assert.ok(functionNames.length >= 15, '云函数数量异常（实际 ' + functionNames.length + '）');
  for (const name of functionNames) {
    const dir = path.join(functionsDir, name);
    const indexFile = path.join(dir, 'index.js');
    if (!fs.existsSync(indexFile)) {
      failures.push(name + ' 缺少 index.js');
      continue;
    }
    const packageFile = path.join(dir, 'package.json');
    if (!fs.existsSync(packageFile)) {
      failures.push(name + ' 缺少 package.json');
      continue;
    }
    const pkg = JSON.parse(project.readText(packageFile));
    const deps = pkg.dependencies || {};
    const source = project.readText(indexFile);
    const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
    let match;
    while ((match = re.exec(source))) {
      const spec = match[2];
      if (spec.charAt(0) === '.' || builtins.has(spec) || spec.indexOf('node:') === 0) continue;
      if (!deps[spec]) failures.push(name + ' -> 未声明依赖 ' + spec);
    }
  }
  assert.deepEqual(failures, [], '云函数依赖声明问题：\n' + failures.join('\n'));
});

test('云函数 config.json（如存在）为合法 JSON，且 config 声明的 openapi 权限格式正确', () => {
  const failures = [];
  const functionsDir = path.join(project.ROOT, 'cloudfunctions');
  const functionNames = fs.readdirSync(functionsDir).filter(function (name) {
    return fs.statSync(path.join(functionsDir, name)).isDirectory();
  });
  for (const name of functionNames) {
    const configFile = path.join(functionsDir, name, 'config.json');
    if (!fs.existsSync(configFile)) continue;
    try {
      const config = JSON.parse(project.readText(configFile));
      if (config.permissions && config.permissions.openapi) {
        assert.ok(Array.isArray(config.permissions.openapi), name + ' config.json permissions.openapi 应为数组');
      }
    } catch (err) {
      failures.push(name + '/config.json -> ' + err.message);
    }
  }
  assert.deepEqual(failures, [], '云函数 config.json 问题：\n' + failures.join('\n'));
});

test('WXML 中 bind*/catch* 事件处理函数在对应页面 Page() 中均已定义', () => {
  const failures = [];
  let checkedHandlers = 0;
  for (const route of PAGES) {
    const wxmlAbs = pageAbs(route, '.wxml');
    const jsAbs = pageAbs(route, '.js');
    if (!fs.existsSync(wxmlAbs) || !fs.existsSync(jsAbs)) continue;
    const config = pageConfig.loadPageConfig(jsAbs);
    const methods = new Set(pageConfig.pageMethods(config));
    const extracted = wxml.extractHandlers(project.readText(wxmlAbs));
    assert.deepEqual(extracted.dynamic, [], route + '.wxml 存在 {{}} 动态事件绑定，静态无法校验：' + extracted.dynamic.join(' | '));
    for (const name of extracted.names) {
      checkedHandlers++;
      if (!methods.has(name)) failures.push(route + '.wxml -> ' + name);
    }
    assert.ok(config.data && typeof config.data === 'object', route + '.js 缺少 data');
  }
  assert.ok(checkedHandlers >= 30, '扫描到的事件处理函数数量异常（实际 ' + checkedHandlers + '）');
  assert.deepEqual(failures, [], 'WXML 事件处理函数未定义：\n' + failures.join('\n'));
});

test('页面 JS 均使用 Page() 注册，页面 json 合法', () => {
  const failures = [];
  for (const route of PAGES) {
    const jsAbs = pageAbs(route, '.js');
    if (!fs.existsSync(jsAbs)) continue;
    const source = project.readText(jsAbs);
    if (!/\bPage\s*\(/.test(source)) failures.push(route + '.js 未调用 Page()');
    if (/\bComponent\s*\(/.test(source) && !/\bPage\s*\(/.test(source)) failures.push(route + '.js 使用了 Component()');
    try {
      const pageJson = JSON.parse(project.readText(pageAbs(route, '.json')));
      const using = pageJson.usingComponents || {};
      for (const tag of Object.keys(using)) {
        const componentPath = String(using[tag]);
        const base = componentPath.charAt(0) === '/'
          ? path.join(project.ROOT, 'miniprogram', componentPath)
          : path.resolve(path.dirname(pageAbs(route, '.json')), componentPath);
        const ok = fs.existsSync(base) || fs.existsSync(base + '.js') || fs.existsSync(base + '.json');
        if (!ok) failures.push(route + '.json -> 组件不存在 ' + tag + '=' + componentPath);
      }
    } catch (err) {
      failures.push(route + '.json -> ' + err.message);
    }
  }
  assert.deepEqual(failures, [], '页面注册/json 问题：\n' + failures.join('\n'));
});
