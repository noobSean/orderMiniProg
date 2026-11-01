'use strict';

// WXSS 静态检查：去掉注释/字符串后校验 {} 与 () 配平
function stripCss(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  out = out.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return out;
}

function checkBraces(src) {
  const clean = stripCss(src);
  let balance = 0;
  let minBalance = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i);
    if (ch === '{') balance++;
    else if (ch === '}') {
      balance--;
      if (balance < minBalance) minBalance = balance;
    }
  }
  const parens = (clean.match(/\(/g) || []).length - (clean.match(/\)/g) || []).length;
  return { balance: balance, minBalance: minBalance, parens: parens, ok: balance === 0 && minBalance === 0 && parens === 0 };
}

module.exports = { stripCss: stripCss, checkBraces: checkBraces };
