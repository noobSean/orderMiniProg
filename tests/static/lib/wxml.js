'use strict';

// WXML 静态解析：标签配对、事件处理函数提取（不做完整 WXML 语法实现，只覆盖工程实际用法）
const EVENT_ATTR_RE = /(?:^|\s)(bind|catch|capture-bind|capture-catch|mut-bind)(:)?([a-zA-Z]+)\s*=\s*"([^"]*)"/g;

// 注释替换成空白（保留换行，便于定位行号）
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, function (m) {
    return m.replace(/[^\n]/g, ' ');
  });
}

// 扫描出所有标签开始/结束位置；跳过注释、非标签的 '<'（如 {{a < b}} 里的比较符）
function scanTags(src) {
  const clean = stripComments(src);
  const tags = [];
  const errors = [];
  let i = 0;
  while (i < clean.length) {
    const lt = clean.indexOf('<', i);
    if (lt < 0) break;
    const next = clean.charAt(lt + 1);
    if (!/[a-zA-Z/]/.test(next)) {
      i = lt + 1;
      continue;
    }
    let j = lt + 1;
    let quote = '';
    while (j < clean.length) {
      const ch = clean.charAt(j);
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    if (j >= clean.length) {
      errors.push({ pos: lt, message: '标签未闭合（缺少 >）' });
      break;
    }
    const raw = clean.slice(lt + 1, j).trim();
    const match = /^(\/?)\s*([a-zA-Z][\w-]*)/.exec(raw);
    if (!match) {
      i = j + 1;
      continue;
    }
    tags.push({
      pos: lt,
      closing: !!match[1],
      name: match[2],
      selfClosing: raw.endsWith('/')
    });
    i = j + 1;
  }
  return { tags: tags, errors: errors };
}

// 返回 { ok, problems: [string], tagCount }
function checkTagPairing(src) {
  const scanned = scanTags(src);
  const problems = scanned.errors.map(function (e) {
    return 'offset ' + e.pos + ': ' + e.message;
  });
  const stack = [];
  for (const tag of scanned.tags) {
    if (tag.closing) {
      if (!stack.length) {
        problems.push('多余的结束标签 </' + tag.name + '> @offset ' + tag.pos);
        continue;
      }
      const top = stack.pop();
      if (top.name !== tag.name) {
        problems.push('标签不配对：<' + top.name + '> @offset ' + top.pos + ' 与 </' + tag.name + '> @offset ' + tag.pos);
      }
    } else if (!tag.selfClosing) {
      stack.push(tag);
    }
  }
  if (stack.length) {
    problems.push('未闭合标签：' + stack.map(function (t) { return '<' + t.name + '>@' + t.pos; }).join(', '));
  }
  return { ok: problems.length === 0, problems: problems, tagCount: scanned.tags.length };
}

// 提取 WXML 上绑定的事件处理函数名；dynamic 为使用 {{}} 动态绑定的情况（静态无法校验）
function extractHandlers(src) {
  const clean = stripComments(src);
  const handlers = [];
  const dynamic = [];
  let match;
  EVENT_ATTR_RE.lastIndex = 0;
  while ((match = EVENT_ATTR_RE.exec(clean))) {
    const value = match[4].trim();
    if (!value) continue;
    if (value.indexOf('{{') >= 0) {
      dynamic.push(match[0]);
    } else {
      handlers.push({ event: match[1] + (match[2] || '') + match[3], handler: value });
    }
  }
  const names = [];
  handlers.forEach(function (h) {
    if (names.indexOf(h.handler) < 0) names.push(h.handler);
  });
  return { handlers: handlers, names: names, dynamic: dynamic };
}

module.exports = {
  stripComments: stripComments,
  scanTags: scanTags,
  checkTagPairing: checkTagPairing,
  extractHandlers: extractHandlers
};
