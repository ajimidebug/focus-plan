declare module '*?raw' { const value: string; export default value }
interface Window { App: any; __FRAMEWORK_BOOT: boolean; __RELEASE: string; __legacyReady?: Promise<void> }

interface HTMLElement { _disposeModal?: (() => void) | null }
