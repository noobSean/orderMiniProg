'use strict';

/**
 * 静态校验 A1：语法 / JSON / WXML 标签配对 / WXSS 配平
 *
 * 只读工程源码，不执行任何业务逻辑，不连网络。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');

const project = require('./lib/project.js');
const wxml = require('./lib/wxml.js');
const wxss = require('./lib/wxss.js');

const SOURCE_DIRS = ['miniprogram', 'cloudfunctions'];

function sourceFiles(ext) {
  const out = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of project.listFiles(dir)) {
      if (file.endsWith(ext)) out.push(file);
    }
  }
  return out;
}

const SOURCE_JS = sourceFiles('.js');
const SOURCE_WXML = sourceFiles('.wxml');
const SOURCE_WXSS = sourceFiles('.wxss');

test('源码目录结构 sanity：miniprogram 与 cloudfunctions 均存在且包含源码', () => {
  assert.ok(SOURCE_JS.length >= 30, '源码 JS 数量异常（期望 >= 30，实际 ' + SOURCE_JS.length + '）');
  assert.ok(SOURCE_WXML.length >= 10, 'WXML 数量异常（实际 ' + SOURCE_WXML.length + '）');
  assert.ok(SOURCE_WXSS.length >= 10, 'WXSS 数量异常（实际 ' + SOURCE_WXSS.length + '）');
});

test('全部 .js 语法正确（new vm.Script 编译通过）', () => {
  const failures = [];
  for (const file of SOURCE_JS) {
    const source = project.readText(file);
    try {
      new vm.Script(source, { filename: project.rel(file) });
    } catch (err) {
      failures.push(project.rel(file) + ' -> ' + err.message);
    }
  }
  assert.deepEqual(failures, [], '存在语法错误：\n' + failures.join('\n'));
});

test('全部 .json 可被 JSON.parse', () => {
  const failures = [];
  let jsonCount = 0;
  for (const file of project.walk(project.ROOT)) {
    if (!file.endsWith('.json')) continue;
    if (file.indexOf(path.join(project.ROOT, 'tests') + path.sep) === 0) continue;
    jsonCount++;
    try {
      JSON.parse(project.readText(file));
    } catch (err) {
      failures.push(project.rel(file) + ' -> ' + err.message);
    }
  }
  assert.ok(jsonCount >= 30, '发现的 JSON 文件数量异常（实际 ' + jsonCount + '）');
  assert.deepEqual(failures, [], '存在非法 JSON：\n' + failures.join('\n'));
});

test('database/seed/*.jsonl 每行均为合法 JSON', () => {
  const jsonlFiles = project.listFiles('database').filter(function (file) {
    return file.endsWith('.jsonl');
  });
  assert.ok(jsonlFiles.length > 0, '未找到 database/seed/*.jsonl');
  const failures = [];
  for (const file of jsonlFiles) {
    const lines = project.readText(file).split(/\r?\n/);
    lines.forEach(function (line, index) {
      if (!line.trim()) return;
      try {
        JSON.parse(line);
      } catch (err) {
        failures.push(project.rel(file) + ':' + (index + 1) + ' -> ' + err.message);
      }
    });
  }
  assert.deepEqual(failures, [], 'JSONL 存在非法行：\n' + failures.join('\n'));
});

test('全部 WXML 标签配对正确', () => {
  const failures = [];
  for (const file of SOURCE_WXML) {
    const result = wxml.checkTagPairing(project.readText(file));
    assert.ok(result.tagCount > 0, project.rel(file) + ' 没有任何标签？');
    if (!result.ok) failures.push(project.rel(file) + ' -> ' + result.problems.join(' | '));
  }
  assert.deepEqual(failures, [], 'WXML 标签配对问题：\n' + failures.join('\n'));
});

test('全部 WXSS 花括号 / 圆括号配平', () => {
  const failures = [];
  for (const file of SOURCE_WXSS) {
    const result = wxss.checkBraces(project.readText(file));
    if (!result.ok) {
      failures.push(project.rel(file) + ' -> braces=' + result.balance + ', min=' + result.minBalance + ', parens=' + result.parens);
    }
  }
  assert.deepEqual(failures, [], 'WXSS 配平问题：\n' + failures.join('\n'));
});

test('WXSS 中的 @import 相对路径均可解析', () => {
  const failures = [];
  for (const file of SOURCE_WXSS) {
    const source = project.readText(file);
    const re = /@import\s+["']([^"']+)["']/g;
    let match;
    while ((match = re.exec(source))) {
      const target = path.resolve(path.dirname(file), match[1].replace(/^\//, project.ROOT + '/'));
      let exists = false;
      try {
        exists = fs_exists(target) || fs_exists(target + '.wxss');
      } catch (err) {
        exists = false;
      }
      if (!exists) failures.push(project.rel(file) + ' -> @import ' + match[1]);
    }
  }
  assert.deepEqual(failures, [], 'WXSS @import 路径无法解析：\n' + failures.join('\n'));
});

function fs_exists(target) {
  return require('node:fs').existsSync(target) && require('node:fs').statSync(target).isFile();
}
