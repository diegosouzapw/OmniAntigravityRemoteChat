const btn = document.getElementById('loginBtn');
const input = document.getElementById('password');
const toggleBtn = document.getElementById('togglePasswordBtn');
const error = document.getElementById('error');

if (toggleBtn && input) {
  // Prevent desktop click from taking focus away from input
  toggleBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = input.type === 'password';
    const nextType = isPassword ? 'text' : 'password';

    // Preserve cursor selection range across type switches
    const start = input.selectionStart;
    const end = input.selectionEnd;

    input.type = nextType;

    const label = isPassword ? 'Hide password' : 'Show password';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('title', label);
    toggleBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');

    // Maintain focus and cursor position smoothly
    input.focus();
    if (start !== null && end !== null) {
      try {
        input.setSelectionRange(start, end);
      } catch (_) {}
    }
  });
}

function resetButton() {
  btn.disabled = false;
  btn.textContent = 'Connect Securely';
}

async function doLogin() {
  if (btn.disabled) return;
  const password = input.value;
  if (!password) return;

  btn.disabled = true;
  btn.textContent = 'Verifying...';
  error.textContent = 'Invalid password. Please try again.';
  error.style.display = 'none';

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = '/';
      return;
    }

    error.style.display = 'block';
    resetButton();
  } catch (_) {
    error.textContent = 'Connection failed. Is the server running?';
    error.style.display = 'block';
    resetButton();
  }
}

btn.addEventListener('click', doLogin);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    doLogin();
  }
});
