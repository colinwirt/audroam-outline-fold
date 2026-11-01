// Copy of Audroam templates/outlineViewText.js (enterEdit / indentEdit / indentUnit only),
// so key tests run the real host hooks through mountTextEditor.
'use strict';
var LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d+)\.)([ \t]+)/;
function change(start, end, text, selStart, selEnd) {
  var at = selStart == null ? start + text.length : selStart;
  return { start: start, end: end, text: text, selStart: at, selEnd: selEnd == null ? at : selEnd };
}
function lineStartAt(text, pos) { return text.lastIndexOf('\n', pos - 1) + 1; }
function lineEndAt(text, pos) { var at = text.indexOf('\n', pos); return at < 0 ? text.length : at; }
function enterEdit(value, start, end) {
  var text = String(value == null ? '' : value);
  var lineStart = lineStartAt(text, start);
  var before = text.slice(lineStart, start);
  var indent = /^[ \t]*/.exec(before)[0];
  if (indent === before) return change(lineStart, end, '\n' + indent);
  var item = LIST_ITEM.exec(before);
  var lineEnd = lineEndAt(text, end);
  if (item && item[0] === before && start === end && !text.slice(end, lineEnd).trim()) {
    if (!indent) return change(lineStart, lineEnd, '');
    var unit = indentUnit(text, lineStart);
    var cut = indent.charAt(indent.length - 1) === '\t' ? 1 : Math.min(unit === '\t' ? 1 : unit.length, indent.length);
    var outdented = indent.slice(0, indent.length - cut) + item[0].slice(indent.length);
    return change(lineStart, lineEnd, outdented, lineStart + outdented.length);
  }
  var marker = !item ? '' : item[2] ? item[2] + item[4] : (Number(item[3]) + 1) + '.' + item[4];
  return change(start, end, '\n' + indent + marker);
}
var TRAILER_FENCE = /^--- [a-z][a-z-]* ---[ \t]*$/m;
function outlineBody(text) { var m = TRAILER_FENCE.exec(text); return m ? text.slice(0, m.index) : text; }
function indentUnit(text, at) {
  text = outlineBody(String(text == null ? '' : text));
  if (at != null) {
    var lines = text.slice(0, Math.min(text.length, lineEndAt(text, Math.min(at, text.length)))).split('\n');
    for (var i = lines.length - 1; i >= 0; i -= 1) {
      var lead = /^[ \t]+(?=\S)/.exec(lines[i]);
      if (lead) { if (lead[0].charAt(0) === '\t') return '\t'; break; }
    }
  }
  var leads = text.match(/^[ \t]+(?=\S)/gm) || [];
  if (!leads.length) return '  ';
  if (leads.every(function (w) { return /^\t+$/.test(w); })) return '\t';
  if (leads.every(function (w) { return /^( {4})+$/.test(w); })) return '    ';
  return '  ';
}
function indentEdit(value, start, end, outdent) {
  var text = String(value == null ? '' : value);
  var unit = indentUnit(text, start);
  var cut = new RegExp('^(\\t| {1,' + (unit === '\t' ? 2 : unit.length) + '})');
  var from = lineStartAt(text, start);
  var to = lineEndAt(text, end > start && text.charAt(end - 1) === '\n' ? end - 1 : end);
  var lines = text.slice(from, to).split('\n');
  var moves = [];
  var pos = from;
  var out = lines.map(function (line) {
    var hit = outdent ? cut.exec(line) : null;
    var delta = outdent ? (hit ? -hit[0].length : 0) : (lines.length > 1 && !line.trim() ? 0 : unit.length);
    moves.push({ at: pos, delta: delta });
    pos += line.length + 1;
    if (delta > 0) return unit + line;
    return delta < 0 ? line.slice(-delta) : line;
  });
  if (!moves.some(function (m) { return m.delta; })) return null;
  function shift(p, keepLineStart) {
    var moved = p;
    moves.forEach(function (m) {
      if (m.at > p || (keepLineStart && m.at === p)) return;
      moved += m.delta > 0 ? m.delta : -Math.min(-m.delta, p - m.at);
    });
    return moved;
  }
  return change(from, to, out.join('\n'), shift(start, end > start), shift(end));
}
module.exports = { enterEdit: enterEdit, indentEdit: indentEdit, indentUnit: indentUnit };
