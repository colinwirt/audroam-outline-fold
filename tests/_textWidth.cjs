// textWidth slice of audroam-api/templates/outlineViewText.js.
// The package tests cannot import the Audroam tree. Keep this in step with that file's
// readTextWidth / writeTextWidth: an empty fold-: is a document key, so textWidth stays after it.
'use strict';

var LAYOUT_OPEN = /^---\s*layout\s*---\s*$/i;
var FENCE = /^---\s*$/;
var WIDTH_LINE = /^textWidth\s*:\s*(\d+)\s*$/i;
var NODE_KEY = /^([A-Za-z0-9][A-Za-z0-9_-]*):\s*$|^\s/;
var DOC_KEY = /^(?:fold[-+]|collapsedMarker|expandedMarker|fontSize|autoWidth|autoLock|follow|noteUri|noteMapUri|noteDetailsUri|textWidth)\s*:/i;

function bare(line) {
  return line.replace(/\r$/, '');
}

function layoutBlock(lines) {
  for (var i = lines.length - 1; i >= 0; i -= 1) {
    if (!LAYOUT_OPEN.test(bare(lines[i]))) continue;
    for (var j = i + 1; j < lines.length; j += 1) {
      if (FENCE.test(bare(lines[j]))) return { open: i, close: j };
    }
  }
  return null;
}

function widthLine(lines, block) {
  if (!block) return -1;
  for (var i = block.open + 1; i < block.close; i += 1) {
    if (WIDTH_LINE.test(bare(lines[i]))) return i;
  }
  return -1;
}

function readTextWidth(text) {
  var lines = String(text == null ? '' : text).split('\n');
  var at = widthLine(lines, layoutBlock(lines));
  if (at < 0) return null;
  var n = Number(WIDTH_LINE.exec(bare(lines[at]))[1]);
  return n > 0 ? n : null;
}

function insertAt(lines, block) {
  for (var i = block.open + 1; i < block.close; i += 1) {
    var line = bare(lines[i]);
    if (DOC_KEY.test(line)) continue;
    if (NODE_KEY.test(line)) return i;
  }
  return block.close;
}

function removeLine(lines, block, at) {
  lines.splice(at, 1);
  if (block.close - block.open > 2) return lines.join('\n');
  var close = block.close - 1;
  var head = lines.slice(0, block.open).join('\n').replace(/\s+$/, '');
  var cr = /\r$/.test(lines[close]) ? '\r' : '';
  var rest = close + 1 < lines.length ? '\n' + lines.slice(close + 1).join('\n') : '';
  return head + cr + rest;
}

function writeTextWidth(text, ch) {
  var raw = String(text == null ? '' : text);
  var lines = raw.split('\n');
  var block = layoutBlock(lines);
  var at = widthLine(lines, block);
  if (ch == null) return at < 0 ? raw : removeLine(lines, block, at);
  if (!raw.trim()) return raw;
  var entry = 'textWidth: ' + Math.round(ch);
  if (at >= 0) {
    lines[at] = entry + (/\r$/.test(lines[at]) ? '\r' : '');
    return lines.join('\n');
  }
  if (block) {
    lines.splice(insertAt(lines, block), 0, entry + (/\r$/.test(lines[block.open]) ? '\r' : ''));
    return lines.join('\n');
  }
  var body = raw.replace(/\s+$/, '');
  var eol = /\r\n/.test(raw) ? '\r\n' : '\n';
  return body + eol + eol + ['--- layout ---', entry, '---'].join(eol) + raw.slice(body.length);
}

module.exports = { readTextWidth: readTextWidth, writeTextWidth: writeTextWidth };
