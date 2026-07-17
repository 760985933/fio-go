// Wails runtime - 简化版，用于开发阶段
// 生产环境由 Wails 框架自动提供

export function EventsOn(eventName, callback) {
  window.addEventListener('wails:' + eventName, (e) => callback(e.detail));
}

export function EventsOff(eventName) {
  window.removeEventListener('wails:' + eventName);
}

export function EventsEmit(eventName, ...data) {
  window.dispatchEvent(new CustomEvent('wails:' + eventName, { detail: data }));
}

export function BrowserOpenURL(url) {
  window.open(url, '_blank');
}

export function WindowSetDarkTheme() {}
export function WindowSetLightTheme() {}
