const CENTRAL = 'https://id.starry.phd';
const TICKET = `${CENTRAL}/api/apps/boxstarry/ticket`;
const LOCAL_ME = '/api/me';
const LOCAL_LOGOUT = '/api/logout';
const nativeFetch = window.fetch.bind(window);
let syncing = false;
let lastSync = 0;

function emailOf(value: any) {
  return String(value?.email || value?.primaryEmail || '').trim().toLowerCase();
}

async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await nativeFetch(url, { cache:'no-store', credentials:'include', ...init });
  const data = await response.clone().json().catch(() => ({}));
  return { response, data };
}

async function centralSession() {
  const { response, data } = await jsonFetch(`${CENTRAL}/api/ecosystem/session`, { mode:'cors' });
  if (!response.ok) return { authenticated:false, user:null };
  return data || { authenticated:false, user:null };
}

async function localSession() {
  const { response, data } = await jsonFetch(LOCAL_ME);
  if (!response.ok) return { user:null };
  return data || { user:null };
}

async function localLogoutOnly() {
  await nativeFetch(LOCAL_LOGOUT, { method:'POST', credentials:'include', cache:'no-store' }).catch(() => undefined);
}

async function centralLogoutOnly() {
  await nativeFetch(`${CENTRAL}/api/logout`, { method:'POST', mode:'cors', credentials:'include', cache:'no-store', headers:{ 'Content-Type':'application/json' }, body:'{}' }).catch(() => undefined);
}

async function issueTicket() {
  const { response, data } = await jsonFetch(TICKET, { method:'POST', mode:'cors', headers:{ 'Content-Type':'application/json' }, body:'{}' });
  if (!response.ok || !data?.redirect) return false;
  location.replace(String(data.redirect));
  return true;
}

export async function syncStarryEyeSession(force = false) {
  if (syncing) return;
  const now = Date.now();
  if (!force && now - lastSync < 1500) return;
  syncing = true;
  lastSync = now;
  try {
    const [central, local] = await Promise.all([centralSession(), localSession()]);
    const centralUser = central?.authenticated ? central?.user : null;
    const localUser = local?.user || null;

    if (!centralUser) {
      if (localUser) {
        await localLogoutOnly();
        location.reload();
      }
      return;
    }

    const centralEmail = emailOf(centralUser);
    const localEmail = emailOf(localUser);
    if (!localUser || (centralEmail && localEmail && centralEmail !== localEmail)) {
      if (localUser) await localLogoutOnly();
      await issueTicket();
    }
  } catch (error) {
    console.warn('Starry Eye SSO sync skipped:', error);
  } finally {
    syncing = false;
  }
}

export async function logoutStarryEyeEverywhere() {
  await Promise.allSettled([localLogoutOnly(), centralLogoutOnly()]);
  location.replace('/');
}

export async function switchStarryEyeAccount() {
  await Promise.allSettled([localLogoutOnly(), centralLogoutOnly()]);
  location.href = `${CENTRAL}/auth/boxstarry?choose=1`;
}

function installLogoutBridge() {
  if ((window as any).__starryEyeFetchBridge) return;
  (window as any).__starryEyeFetchBridge = true;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const response = await nativeFetch(input as any, init);
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin === location.origin && parsed.pathname === LOCAL_LOGOUT && method === 'POST') {
        await centralLogoutOnly();
      }
    } catch {}
    return response;
  }) as typeof window.fetch;
}

const replacements: [string,string][] = [
  ['繁星膠囊','繁星視界'],
  ['Box Starry','Starry Eye'],
  ['BOX STARRY','STARRY EYE']
];

function replaceText(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  for (const text of nodes) {
    let value = text.nodeValue || '';
    let next = value;
    for (const [from,to] of replacements) next = next.split(from).join(to);
    if (next !== value) text.nodeValue = next;
  }
}

function addSwitchButton() {
  const logout = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '登出');
  if (!logout || document.querySelector('[data-starry-eye-switch]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.starryEyeSwitch = '1';
  button.className = logout.className.replace(/logout/g, '').trim() || 'menu-row';
  button.innerHTML = '<span class="menu-icon">◎</span><span>切換帳號</span>';
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void switchStarryEyeAccount(); });
  logout.parentElement?.insertBefore(button, logout);
}

function installBrandingAndAccountUi() {
  document.title = document.title.replaceAll('繁星膠囊','繁星視界').replaceAll('Box Starry','Starry Eye');
  replaceText(document.body);
  addSwitchButton();
  new MutationObserver(records => {
    for (const record of records) for (const node of Array.from(record.addedNodes)) if (node.nodeType === Node.ELEMENT_NODE) replaceText(node);
    replaceText(document.body);
    addSwitchButton();
  }).observe(document.body, { childList:true, subtree:true });
}

export function initStarryEyeEcosystem() {
  installLogoutBridge();
  const start = () => {
    installBrandingAndAccountUi();
    void syncStarryEyeSession(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
  addEventListener('focus', () => void syncStarryEyeSession());
  addEventListener('online', () => void syncStarryEyeSession());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncStarryEyeSession(); });
}
