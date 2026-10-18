const pageUrl = 'https://ice-infinite.github.io/';

async function copyText(button, text, status) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = '已复制';
  } catch {
    status.textContent = `未能自动复制，请长按或手动复制：${text}`;
  }
  button.focus();
}

const pageButton = document.querySelector('[data-copy-page]');
pageButton?.addEventListener('click', () => copyText(pageButton, pageUrl,
  document.querySelector('[data-copy-status]')));
const hashButton = document.querySelector('[data-copy-hash]');
hashButton?.addEventListener('click', () => copyText(hashButton,
  document.querySelector('[data-sha256]').textContent.trim(),
  document.querySelector('[data-hash-status]')));
