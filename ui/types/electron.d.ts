export {};

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      openFileDialog: (options?: {
        title?: string;
        defaultPath?: string;
        buttonLabel?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: Array<string>;
        message?: string;
        securityScopedBookmarks?: boolean;
      }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      platform: string;
      version: string;
      getBackendPort: () => Promise<number>;
      hideToTray: () => Promise<void>;
      onBackendReady: (cb: (port: number) => void) => void;
      onBackendError: (cb: (msg: string) => void) => void;
    };
  }
}
