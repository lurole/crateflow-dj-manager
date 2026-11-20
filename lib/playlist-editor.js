(function (root) {
  'use strict';

  function render({ playlist, entries, library }, esc) {
    const disabledWithoutTracks = library.length ? '' : ' disabled';
    const options = library.map(track =>
      '<option value="' + esc(track.id) + '">' + esc([track.artist, track.title, track.remix].filter(Boolean).join(' · ')) + '</option>');
    const rows = entries.map(({ id, track }, index) => {
      const title = esc(track?.title || 'Unavailable track');
      const label = title + ', position ' + (index + 1);
      const button = (action, text, verb, disabled = false) =>
        '<button type="button" class="btn" data-playlist-action="' + action + '" aria-label="' + verb + ' ' + label + '"' +
        (disabled ? ' disabled' : '') + '>' + text + '</button>';
      return '<li class="playlist-entry" data-membership-id="' + esc(id) + '" tabindex="-1">' +
        '<span class="playlist-grip" draggable="true" aria-hidden="true">⠿</span>' +
        '<span class="playlist-track"><strong>' + title + '</strong><small>' +
        esc([track?.artist, track?.remix].filter(Boolean).join(' · ')) + '</small></span>' +
        '<div class="playlist-actions">' + button('up', '↑', 'Move up', index === 0) +
        button('down', '↓', 'Move down', index === entries.length - 1) + button('remove', 'Remove', 'Remove') + '</div></li>';
    });

    return '<section class="panel playlist-editor" id="playlist-editor" aria-labelledby="playlist-editor-title">' +
      '<h2 id="playlist-editor-title">' + esc(playlist.name) + '</h2>' +
      '<p class="note">Drag a handle or use the arrow buttons to change the order.</p>' +
      '<form class="playlist-add" id="playlist-add"><label class="label" for="playlist-track">Library track</label>' +
      '<select class="field" id="playlist-track" required' + disabledWithoutTracks + '><option value="">Choose a track</option>' +
      options.join('') + '</select><button type="submit" class="btn primary"' + disabledWithoutTracks + '>Add track</button></form>' +
      (rows.length ? '<ol class="playlist-entries" role="list">' + rows.join('') + '</ol>' : '<p class="note">This playlist is empty.</p>') +
      '</section>';
  }

  function announce(message) {
    document.querySelector('#playlist-editor-status').textContent = message;
  }

  function focusAfterEdit(edit, result, direction) {
    const editor = document.querySelector('#playlist-editor');
    const picker = editor.querySelector('#playlist-track');
    if (edit.type === 'add') {
      picker.value = edit.trackId;
      picker.focus();
      return;
    }
    const row = Array.from(editor.querySelectorAll('[data-membership-id]'))
      .find(item => item.dataset.membershipId === result.entryId);
    const action = edit.type === 'remove' ? 'remove' : direction;
    const button = action && row?.querySelector('[data-playlist-action="' + action + '"]:not(:disabled)');
    if (button || row) (button || row).focus();
    else if (!picker.disabled) picker.focus();
    else document.querySelector('#togglePlaylistEditor').focus();
  }

  function bind(editor, save) {
    let sourceId;
    let dropRow;
    function clearDrop() {
      dropRow?.classList.remove('playlist-drop-before', 'playlist-drop-after');
      dropRow = null;
    }
    function targetRow(event) {
      return event.target.closest('[data-membership-id]');
    }
    function dropSide(event, row) {
      const rect = row.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    }
    function apply(edit, direction) {
      const result = save(edit);
      if (!result) return;
      const message = edit.type === 'remove' ? result.title + ' removed from playlist.'
        : result.title + (edit.type === 'add' ? ' added at position ' : ' moved to position ') + (result.position + 1) + ' of ' + result.count + '.';
      announce(message);
      focusAfterEdit(edit, result, direction);
    }

    editor.addEventListener('submit', event => {
      event.preventDefault();
      const trackId = editor.querySelector('#playlist-track').value;
      if (trackId) apply({ type: 'add', trackId });
    });
    editor.addEventListener('click', event => {
      const button = event.target.closest('[data-playlist-action]');
      if (!button || button.disabled) return;
      const row = targetRow(event);
      const entryId = row.dataset.membershipId;
      const action = button.dataset.playlistAction;
      if (action === 'remove') return apply({ type: 'remove', entryId });
      const up = action === 'up';
      const target = up ? row.previousElementSibling : row.nextElementSibling;
      if (target) apply({ type: 'move', entryId, targetId: target.dataset.membershipId, side: up ? 'before' : 'after' }, action);
    });
    editor.addEventListener('dragstart', event => {
      if (!event.target.closest('.playlist-grip') || !event.dataTransfer) return;
      sourceId = targetRow(event).dataset.membershipId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', sourceId);
    });
    editor.addEventListener('dragover', event => {
      clearDrop();
      const row = targetRow(event);
      if (!sourceId || !row || row.dataset.membershipId === sourceId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('playlist-drop-' + dropSide(event, row));
      dropRow = row;
    });
    editor.addEventListener('dragleave', event => {
      if (!dropRow?.contains(event.relatedTarget)) clearDrop();
    });
    editor.addEventListener('drop', event => {
      clearDrop();
      const entryId = sourceId;
      sourceId = null;
      const row = targetRow(event);
      if (!entryId || !row || row.dataset.membershipId === entryId) return;
      event.preventDefault();
      apply({ type: 'move', entryId, targetId: row.dataset.membershipId, side: dropSide(event, row) });
    });
    editor.addEventListener('dragend', () => {
      clearDrop();
      sourceId = null;
    });
  }

  root.CrateflowPlaylistEditor = Object.freeze({ render, bind, announce });
})(globalThis);
