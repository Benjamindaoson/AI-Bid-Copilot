// Local fork: upstream analytics are intentionally disabled. Preserve call sites without network traffic.
export function trackAppOpen(): void {}
export function trackPageView(_page: string): void {}
export function trackChangelogOpen(): void {}
export function trackConfigUsage(_payload: Record<string, unknown> = {}, _config?: unknown): void {}
export function trackResourceClick(_resourceKey: string): void {}
export function trackNoticeBoardOpen(): void {}
