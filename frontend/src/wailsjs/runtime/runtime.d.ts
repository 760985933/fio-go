export function EventsOn(eventName: string, callback: (...data: any[]) => void): void;
export function EventsOff(eventName: string): void;
export function EventsEmit(eventName: string, ...data: any[]): void;
export function BrowserOpenURL(url: string): void;
export function WindowSetDarkTheme(): void;
export function WindowSetLightTheme(): void;
