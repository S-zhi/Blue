// Visual demo presets; these do not represent readings from a security system.
export const PRESETS = {
  normal: {
    name: '正常', label: 'NORMAL', accent: '#79caff', speed: .24, pulseHz: .35,
    description: '系统运行稳定', glass: '#85ceff', absorption: '#4f9df9',
    deep: [.003, .018, .095], mid: [.006, .12, .44], light: [.07, .60, 1.55], edge: [.035, .23, .53],
  },
  risk: {
    name: '风险', label: 'CAUTION', accent: '#ffd969', speed: .60, pulseHz: .70,
    description: '检测到潜在风险 · 需要关注', glass: '#ffe8a0', absorption: '#ffc249',
    deep: [.055, .03, .001], mid: [.46, .29, .006], light: [1.5, 1.05, .065], edge: [.53, .34, .014],
  },
  critical: {
    name: '危急', label: 'CRITICAL', accent: '#ff727e', speed: 1.20, pulseHz: 1.20,
    description: '安全状态危急 · 需要立即处理', glass: '#ffa7aa', absorption: '#fb5267',
    deep: [.07, .002, .005], mid: [.48, .009, .021], light: [1.5, .06, .12], edge: [.53, .014, .037],
  },
};

export const ACTIONS = {
  flow: { name: '光带环流', value: 0 },
  pulse: { name: '呼吸脉冲', value: 1 },
};

// Extend this list to add choices. Labels are rendered as text, not HTML.
// `state` selects a PRESETS entry; `action` selects an ACTIONS entry;
// `toggle-motion` cycles the current action; `event` is an integration hook.
export const HUD_OPTIONS = [
  { id: 'normal', label: '正常运行', symbol: 'triangle', tone: '#89dec6', type: 'state', value: 'normal' },
  { id: 'risk', label: '风险评估', symbol: 'square', tone: '#ec91b0', type: 'state', value: 'risk' },
  { id: 'critical', label: '危急警报', symbol: 'circle', tone: '#ffb69d', type: 'state', value: 'critical' },
  { id: 'motion', label: '切换动作', symbol: 'cross', tone: '#90d8e4', type: 'toggle-motion' },
];
const ICONS = {
  triangle: '<path d="M12 3 22 22H2Z"/>',
  square: '<path d="M3 3H21V21H3Z"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  cross: '<path d="m3 3 18 18M21 3 3 21"/>',
};

// Opt-in component: no menu, shortcuts, or demo controls are mounted by default.
// Pass business options and an onSelect callback when an interaction is needed.
export function createHudOptions(container, { options = HUD_OPTIONS, onSelect = () => {} } = {}) {
  const menu = document.createElement('div');
  menu.className = 'hud-options';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', '交互选项');
  const buttons = options.map((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-choice';
    button.dataset.option = option.id;
    button.style.setProperty('--symbol-color', option.tone ?? '#90d8e4');
    button.style.setProperty('--row-indent', `${[0, -9, -15, -6][index % 4]}px`);
    const symbol = document.createElement('span');
    symbol.className = 'choice-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[option.symbol] ?? ICONS.circle}</svg>`;
    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = option.label;
    button.append(symbol, label);
    menu.append(button);
    return button;
  });
  function select(event) {
    const button = event.target.closest('button');
    const index = buttons.indexOf(button);
    if (index < 0) return;
    onSelect(options[index]);
    menu.dispatchEvent(new CustomEvent('ring:option-select', {
      bubbles: true, detail: { id: options[index].id },
    }));
  }
  menu.addEventListener('click', select);
  container.append(menu);
  return {
    setSelected(id) {
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.option === id)));
    },
    destroy() {
      menu.removeEventListener('click', select);
      menu.remove();
    },
  };
}
