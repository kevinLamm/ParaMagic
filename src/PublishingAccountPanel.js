import { hostedPublishingUrl } from './PublishingClient.js';

function text(parent, value) { const node = document.createElement('p'); node.textContent = value; parent.append(node); return node; }
function button(parent, label, action) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
  node.onclick = action; parent.append(node); return node;
}
function input(parent, label, type, autocomplete) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const node = document.createElement('input'); node.type = type; node.autocomplete = autocomplete;
  node.required = true; wrapper.append(node); parent.append(wrapper); return node;
}
export async function loadAccountPanel(root, client, { signal, onChange = () => {} } = {}) {
  let mode = 'signin'; let emailValue = ''; let busy = false;
  const status = document.createElement('p'); status.role = 'status'; status.textContent = 'Checking sign-in…';
  root.replaceChildren(status);
  async function run(action, notice = '') {
    if (busy) return;
    busy = true;
    root.querySelectorAll('button,input').forEach(item => { item.disabled = true; });
    status.textContent = 'Please wait…';
    let error;
    try { await action(); } catch (failure) { error = failure.message; }
    busy = false;
    await refresh(error || notice);
  }
  async function refresh(notice = '') {
    try {
      const account = await client.account();
      if (signal?.aborted) return;
      root.replaceChildren(); status.textContent = notice;
      if (account.user) {
        text(root, `Signed in as ${account.user.name}.`);
        button(root, 'Sign out', () => run(() => client.signOut()));
      } else if (account.verificationEmail) {
        text(root, `Verify ${account.verificationEmail} using the link in your email. Then return here to continue.`);
        button(root, 'I verified my email', () => run(() => client.checkVerification()));
        button(root, 'Resend verification email', () => run(() => client.resendVerification(), 'Verification email sent. Check your inbox and spam folder.'));
        button(root, 'Sign out', () => run(() => client.signOut()));
      } else if (!account.authConfig) {
        text(root, 'Account sign-in is being configured. The full editor remains available without an account.');
      } else {
        text(root, 'Sign in for drawing storage. You can use the full editor without an account.');
        button(root, 'Continue with Google', () => run(() => client.signIn('google')));
        const heading = document.createElement('h3');
        heading.textContent = mode === 'signup' ? 'Create a ParaMagic account' : mode === 'reset' ? 'Reset your password' : 'ParaMagic sign-in'; root.append(heading);
        const form = document.createElement('form'); form.className = 'publishing-account-form'; root.append(form);
        const name = mode === 'signup' ? input(form, 'Name', 'text', 'name') : null;
        if (name) name.maxLength = 100;
        const email = input(form, 'Email', 'email', 'username'); email.value = emailValue; email.maxLength = 254;
        email.addEventListener('input', () => { emailValue = email.value; });
        const password = mode !== 'reset' ? input(form, 'Password', 'password', mode === 'signup' ? 'new-password' : 'current-password') : null;
        if (password) password.maxLength = 128;
        if (mode === 'signup') {
          password.minLength = 15;
          text(form, 'Use at least 15 characters. We will email you a verification link.');
        }
        if (mode === 'reset') text(form, 'Enter the email address for your ParaMagic account.');
        const submit = document.createElement('button'); submit.type = 'submit';
        submit.textContent = mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'; form.append(submit);
        form.onsubmit = event => {
          event.preventDefault();
          if (!form.reportValidity()) return;
          const secret = password?.value;
          if (password) password.value = '';
          const action = mode === 'signup' ? () => client.register({ name: name.value, email: email.value, password: secret })
            : mode === 'reset' ? () => client.resetPassword(email.value) : () => client.signInEmail(email.value, secret);
          run(action, mode === 'reset' ? 'If an account uses this email, a password reset link has been sent. Check your inbox and spam folder.' : '');
        };
        if (mode === 'signin') {
          button(root, 'Create a ParaMagic account', () => { mode = 'signup'; refresh(); });
          button(root, 'Forgot password?', () => { mode = 'reset'; refresh(); });
        } else button(root, 'Back to sign in', () => { mode = 'signin'; refresh(); });
      }
      root.append(status);
      onChange(account);
    } catch (error) {
      if (signal?.aborted) return;
      status.textContent = error.message; root.append(status);
      root.querySelectorAll('button,input').forEach(item => { item.disabled = false; });
      if (!client.available && !root.querySelector('a')) {
        const link = document.createElement('a'); link.href = hostedPublishingUrl;
        link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open hosted ParaMagic'; root.append(link);
      }
      onChange(null);
    }
  }
  await refresh();
}
