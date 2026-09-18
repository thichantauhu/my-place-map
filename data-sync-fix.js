(() => {
  // Supabase is the source of truth. If it is reachable and empty,
  // clear stale browser data so old local places cannot reappear.
  
  function ensureEditDialog() {
    if (document.getElementById('addressEditDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'addressEditDialog';
    dialog.className = 'address-edit-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="address-edit-form" id="addressEditForm">
        <div class="dialog-head">
          <h3>✏️ Chỉnh sửa địa chỉ</h3>
          <button type="button" class="icon-btn" id="closeAddressEditBtn">✕</button>
        </div>
        <p class="address-edit-place" id="addressEditPlace"></p>
        <label>Địa chỉ
          <input id="addressEditInput" type="text" maxlength="250" autocomplete="street-address" />
        </label>
        <p id="addressEditError" class="error"></p>
        <div class="form-actions">
          <button type="button" class="secondary" id="cancelAddressEditBtn">Hủy</button>
          <button type="submit" class="primary" id="saveAddressEditBtn">Lưu địa chỉ</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);

    const close = () => { if (dialog.open) dialog.close(); };
    document.getElementById('closeAddressEditBtn').onclick = close;
    document.getElementById('cancelAddressEditBtn').onclick = close;

    document.getElementById('addressEditForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id = dialog.dataset.placeId;
      const input = document.getElementById('addressEditInput');
      const error = document.getElementById('addressEditError');
      const save = document.getElementById('saveAddressEditBtn');
      const address = input.value.trim();
      error.textContent = '';
      if (!id) return;
      save.disabled = true;
      save.textContent = '⌛ Đang lưu...';
      try {
        await api(`/api/places/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({address})
        });
        close();
        location.reload();
      } catch (err) {
        error.textContent = err.message || 'Không lưu được địa chỉ.';
      } finally {
        save.disabled = false;
        save.textContent = 'Lưu địa chỉ';
      }
    });
  }

  function openAddressEditor(button) {
    const id = button.dataset.ratingId;
    if (!id) return;
    const card = button.closest('.place-card');
    const title = card?.querySelector('.place-title')?.textContent?.trim() || 'Địa điểm';
    const currentAddress = button.textContent.replace(/^📍\s*/, '').trim();
    const dialog = document.getElementById('addressEditDialog');
    document.getElementById('addressEditPlace').textContent = title;
    document.getElementById('addressEditInput').value = currentAddress;
    document.getElementById('addressEditError').textContent = '';
    dialog.dataset.placeId = id;
    dialog.showModal();
    setTimeout(() => {
      const input = document.getElementById('addressEditInput');
      input.focus();
      input.select();
    }, 50);
  }

  function installAddressEditing() {
    document.addEventListener('click', e => {
      const button = e.target.closest('.place-address-button');
      if (!button) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openAddressEditor(button);
    }, true);
  }

  ensureEditDialog();
  installAddressEditing();

})();
