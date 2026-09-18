(() => {
  // Clicking the address also opens the full place editor.
  document.addEventListener('click', e => {
    const button = e.target.closest('.place-address-button');
    if (!button || typeof openEditDialog !== 'function') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openEditDialog(button.dataset.ratingId);
  }, true);
})();
