import './style.css';
import { getConversation } from './conversation.js';

const conversation = getConversation();

const dialog = document.querySelector('#agent-dialog');
const launch = document.querySelector('#agent-launch');
const close = document.querySelector('#agent-close');
const form = document.querySelector('#agent-form');
const input = document.querySelector('#agent-input');
const send = document.querySelector('#agent-send');
const status = document.querySelector('#agent-status');
let sending = false;

const unsubscribe = conversation.subscribe(state => {
  launch.hidden = state !== 'unavailable';
  if (state !== 'unavailable' && dialog.open) dialog.close();
});
function open() {
  if (conversation.microphone !== 'unavailable') return;
  dialog.showModal(); input.focus();
}
function dismiss() { dialog.close(); }
async function submit(event) {
  event.preventDefault();
  if (sending || !input.value.trim() || conversation.microphone !== 'unavailable') return;
  window.blueTts?.stop();
  window.blueTts?.unlock();
  const question = input.value.trim();
  input.value = ''; sending = true; send.disabled = true;
  status.textContent = '正在执行，回答将显示在字幕区。';
  dialog.close();
  try { await conversation.manual(question); }
  finally { sending = false; send.disabled = false; status.textContent = ''; }
}
launch.addEventListener('click', open);
close.addEventListener('click', dismiss);
form.addEventListener('submit', submit);
if (import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribe();
  launch.removeEventListener('click', open); close.removeEventListener('click', dismiss);
  form.removeEventListener('submit', submit);
});
