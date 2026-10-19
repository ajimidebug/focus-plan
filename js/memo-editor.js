/* Plain-text document with stable ownership for generated passages. No HTML is stored. */
(function () {
  'use strict';
  const App = window.App = window.App || {};
  let root, blocks = [], undo = [], redo = [], composing = false, changed = () => {}, pendingSelection = null;
  const plain = text => ({ id: App.store.uid(), text });
  const textOf = list => list.map(x => x.text).join('');
  const clone = list => list.map(x => Object.assign({}, x));
  function normalize(list) {
    const out = [];
    list.forEach(x => {
      if (!x.text) return;
      const last = out[out.length - 1];
      if (last && (last.eventId || '') === (x.eventId || '')) last.text += x.text;
      else out.push(Object.assign({}, x));
    });
    return out.length ? out : [plain('')];
  }
  // Ownership follows retained characters. Replacements spanning different passages are ordinary text.
  function splice(list, start, end, inserted) {
    const total = textOf(list).length;
    start = Math.max(0, Math.min(total, start)); end = Math.max(start, Math.min(total, end));
    let at = 0, owner = null;
    list.forEach(x => {
      const stop = at + x.text.length;
      if ((start === end ? start > at : start >= at) && start < stop && end <= stop) owner = x;
      at = stop;
    });
    const out = []; at = 0; let added = false;
    list.forEach(x => {
      const stop = at + x.text.length;
      if (at < start) { const s = x.text.slice(0, Math.min(x.text.length, start - at)); if (s) out.push(Object.assign({}, x, { text: s })); }
      if (!added && stop >= start) {
        if (inserted) out.push(Object.assign({}, owner || plain(''), { text: inserted }));
        added = true;
      }
      if (stop > end) { const s = x.text.slice(Math.max(0, end - at)); if (s) out.push(Object.assign({}, x, { text: s })); }
      at = stop;
    });
    if (!added && inserted) out.push(plain(inserted));
    return normalize(out);
  }
  function diff(oldText, newText, selection) {
    if (selection) {
      if (selection.start === selection.end && newText.length < oldText.length) {
        const size = oldText.length - newText.length;
        const from = selection.type === 'deleteContentForward' ? selection.start : selection.start - size;
        if (from >= 0 && oldText.slice(0, from) + oldText.slice(from + size) === newText) return { start: from, end: from + size, text: '' };
      }
      const a = selection.start, b = selection.end;
      const n = newText.length - (oldText.length - (b - a));
      if (n >= 0 && newText.slice(0, a) === oldText.slice(0, a) && newText.slice(a + n) === oldText.slice(b)) return { start: a, end: b, text: newText.slice(a, a + n) };
    }
    let a = 0, b = oldText.length, c = newText.length;
    while (a < b && a < c && oldText[a] === newText[a]) a++;
    while (b > a && c > a && oldText[b - 1] === newText[c - 1]) { b--; c--; }
    return { start: a, end: b, text: newText.slice(a, c) };
  }
  function selection() {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
    const r = s.getRangeAt(0), pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(r.startContainer, r.startOffset);
    return { start: pre.toString().length, end: pre.toString().length + r.toString().length };
  }
  let followFrame = false;
  function followCaret() {
    if (followFrame || !root || document.activeElement !== root) return;
    followFrame = true;
    requestAnimationFrame(() => {
      followFrame = false;
      const selected = window.getSelection();
      if (!selected || !selected.rangeCount || !root.contains(selected.focusNode)) return;
      const viewport = window.visualViewport;
      const visibleTop = viewport ? viewport.offsetTop : 0;
      const visibleBottom = visibleTop + (viewport ? viewport.height : window.innerHeight);
      root.style.maxHeight = Math.max(120, Math.min(420, (visibleBottom - visibleTop) * .55)) + 'px';
      const range = selected.getRangeAt(0).cloneRange(); range.collapse(false);
      let rect = range.getBoundingClientRect();
      if (!rect.height && range.startContainer.nodeType === 3 && range.startOffset > 0) {
        range.setStart(range.startContainer, range.startOffset - 1); rect = range.getBoundingClientRect();
      }
      if (!rect.height) return;
      const box = root.getBoundingClientRect(), pad = 30;
      if (rect.bottom > box.bottom - pad) root.scrollTop += rect.bottom - box.bottom + pad;
      else if (rect.top < box.top + pad) root.scrollTop -= box.top + pad - rect.top;
      const moved = range.getBoundingClientRect();
      if (moved.bottom > visibleBottom - pad) window.scrollBy(0, moved.bottom - visibleBottom + pad);
      else if (moved.top < visibleTop + 100) window.scrollBy(0, moved.top - visibleTop - 100);
    });
  }
  function select(start, end = start) {
    const walk = document.createTreeWalker(root, 4), nodes = []; let node;
    while ((node = walk.nextNode())) nodes.push(node);
    if (!nodes.length) { root.appendChild(document.createTextNode('')); nodes.push(root.firstChild); }
    function point(offset) { for (const n of nodes) { if (offset <= n.length) return [n, offset]; offset -= n.length; } const n = nodes[nodes.length - 1]; return [n, n.length]; }
    const a = point(start), b = point(end), r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); followCaret();
  }
  function paint(caret) {
    const frag = document.createDocumentFragment();
    blocks.forEach(x => {
      const span = document.createElement('span'); span.dataset.block = x.id;
      if (x.eventId) { span.className = 'memo-generated'; span.dataset.event = x.eventId; span.dataset.label = x.label || '打卡生成'; span.title = '此文段由勾选生成；取消对应勾选时删除，段内补充也会删除'; }
      if (x.eventId && x.text.startsWith('\n')) { frag.appendChild(document.createTextNode('\n')); span.textContent = x.text.slice(1); }
      else span.textContent = x.text;
      frag.appendChild(span);
      if (x.eventId) {
        // Empty button: its visible caption is CSS, so selection/text offsets stay plain-text only.
        const next = document.createElement('button'); next.type = 'button'; next.contentEditable = 'false';
        next.className = 'memo-continue'; next.setAttribute('aria-label', '在这段后继续写笔记');
        next.onmousedown = e => e.preventDefault(); next.onclick = () => continueAfter(x.id);
        next.disabled = root.contentEditable === 'false'; frag.appendChild(next);
      }
    });
    // A real trailing line keeps Chromium from consuming the final stored newline when typing.
    const tail = document.createElement('br'); tail.dataset.editorEnd = 'true'; frag.appendChild(tail);
    root.replaceChildren(frag);
    if (caret) select(caret.start, caret.end);
  }
  function continueAfter(id) {
    if (root.contentEditable === 'false' || composing) return;
    let end = 0;
    const index = blocks.findIndex(x => x.id === id); if (index < 0) return;
    for (let i = 0; i <= index; i++) end += blocks[i].text.length;
    const next = blocks[index + 1];
    if (next && !next.eventId) {
      root.focus(); select(end + (next.text.startsWith('\n') ? 1 : 0)); return;
    }
    remember(); blocks.splice(index + 1, 0, plain('\n')); blocks = normalize(blocks);
    root.focus(); paint({ start: end + 1, end: end + 1 }); pendingSelection = null; notify();
  }
  function snapshot() { return { blocks: clone(blocks), caret: selection() }; }
  function remember(caret) { const snap = snapshot(); if (caret) snap.caret = caret; undo.push(snap); if (undo.length > 150) undo.shift(); redo = []; }
  function history(from, to) {
    if (!from.length || root.contentEditable === 'false') return;
    to.push(snapshot()); const s = from.pop(); blocks = clone(s.blocks); paint(s.caret); changed();
  }
  function insert(text) {
    if (root.contentEditable === 'false') return;
    const s = selection() || { start: textOf(blocks).length, end: textOf(blocks).length };
    replace(s.start, s.end, text);
  }
  function notify() { changed(); root.dispatchEvent(new Event('input', { bubbles: true })); }
  function replace(start, end, text) { remember(); blocks = splice(blocks, start, end, text); root.focus(); paint({ start: start + text.length, end: start + text.length }); pendingSelection = null; notify(); }
  function erase(forward) {
    const s = selection(); if (!s) return;
    if (s.start !== s.end) return replace(s.start, s.end, '');
    const value = textOf(blocks);
    let start = s.start, end = s.end;
    const chars = Array.from(value.slice(forward ? end : 0, forward ? undefined : start));
    const segment = forward ? chars[0] : chars[chars.length - 1];
    if (!segment) return;
    if (forward) end += segment.length; else start -= segment.length;
    replace(start, end, '');
  }
  function input() {
    const current = root.textContent;
    const old = textOf(blocks);
    if (current === old) return;
    const caret = selection();
    if (!composing) remember(pendingSelection);
    const edit = diff(old, current, pendingSelection); blocks = splice(blocks, edit.start, edit.end, edit.text); pendingSelection = null;
    // Never replace DOM during an IME composition. Saving still includes the current composition text.
    if (!composing) paint(caret);
    changed();
  }
  function init(element, onChange) {
    root = element; changed = onChange;
    ['input', 'keyup', 'click', 'focus', 'compositionupdate', 'compositionend'].forEach(type => root.addEventListener(type, followCaret));
    document.addEventListener('selectionchange', followCaret);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', followCaret); window.visualViewport.addEventListener('scroll', followCaret); }
    root.addEventListener('compositionstart', () => { remember(); composing = true; });
    root.addEventListener('compositionend', () => { composing = false; input(); paint(selection()); changed(); });
    root.addEventListener('beforeinput', e => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); history(e.inputType === 'historyUndo' ? undo : redo, e.inputType === 'historyUndo' ? redo : undo); return; }
      pendingSelection = selection(); if (pendingSelection) pendingSelection.type = e.inputType;
      if (!e.isComposing && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) { e.preventDefault(); insert('\n'); }
      else if (!e.isComposing && (e.inputType === 'insertText' || e.inputType === 'insertReplacementText') && e.data != null) { e.preventDefault(); insert(e.data); }
      else if (!e.isComposing && (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward')) { e.preventDefault(); erase(e.inputType === 'deleteContentForward'); }
    });
    root.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'End' || e.key === 'Home')) { e.preventDefault(); const end = e.key === 'End' ? textOf(blocks).length : 0; if (e.shiftKey) { const s = selection() || { start: end, end }; select(Math.min(end, s.start), Math.max(end, s.end)); } else select(end); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) { e.preventDefault(); const forward = e.shiftKey || e.key.toLowerCase() === 'y'; history(forward ? redo : undo, forward ? undo : redo); }
    });
    root.addEventListener('paste', e => { e.preventDefault(); insert(e.clipboardData.getData('text/plain')); });
    root.addEventListener('drop', e => { e.preventDefault(); });
    root.addEventListener('input', input);
    root.addEventListener('copy', e => {
      const s = selection(); if (!s || s.start === s.end) return;
      e.preventDefault(); e.clipboardData.setData('text/plain', textOf(blocks).slice(s.start, s.end));
    });
    root.addEventListener('cut', e => {
      const s = selection(); if (!s || s.start === s.end) return;
      e.preventDefault(); e.clipboardData.setData('text/plain', textOf(blocks).slice(s.start, s.end)); insert('');
    });
  }
  function show(list, readOnly) { blocks = clone(list); undo = []; redo = []; root.contentEditable = readOnly ? 'false' : 'true'; paint(); root.scrollTop = root.scrollHeight; }
  App.memoEditor = { init, show, read: () => clone(blocks), text: () => textOf(blocks), selection, insert, busy: () => composing, select, textOf, splice, diff, normalize };
})();
