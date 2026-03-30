import * as vscode from "vscode";
import { showEditor } from "./commands";

/**
 * Frame reference document that holds the SVG content
 */
interface FrameReferenceDocument extends vscode.CustomDocument {
  uri: vscode.Uri;
  svgContent: string;
  sourceUri: vscode.Uri;
  frameName: string;
  theme: string;
  dispose(): void;
}

/**
 * Parsed information from an exported SVG
 * Format: {frameName}.{theme}.exp.svg
 */
interface ParsedFrameReference {
  frameName: string;
  theme: string;
  sourceFilePath: string;
}

/**
 * Parse SVG metadata to extract frame reference information
 * @param svgContent - The SVG file content
 * @returns ParsedFrameReference or null if not a valid frame export
 */
function parseFrameReference(svgContent: string): ParsedFrameReference | null {
  // Extract metadata from XML comment
  // Match the multiline comment format
  const lines = svgContent.split('\n');
  let frameName: string | null = null;
  let theme: string | null = null;
  let sourceFilePath: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Excalidraw Frame Export')) {
      // Parse the next few lines
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const dataLine = lines[j];
        if (dataLine.includes('Frame:')) {
          frameName = dataLine.split('Frame:')[1].trim();
        } else if (dataLine.includes('Theme:')) {
          theme = dataLine.split('Theme:')[1].trim();
        } else if (dataLine.includes('Source:')) {
          sourceFilePath = dataLine.split('Source:')[1].trim();
        }
      }
      break;
    }
  }

  if (!frameName || !theme || !sourceFilePath) {
    return null;
  }

  return {
    frameName: frameName,
    theme: theme as "light" | "dark",
    sourceFilePath: sourceFilePath,
  };
}

/**
 * Custom editor provider for exported frame SVG files
 * When a user opens an exported SVG, it redirects to the source Excalidraw file
 * and centers on the corresponding frame
 */
export class ExcalidrawFrameReferenceProvider
  implements vscode.CustomEditorProvider<FrameReferenceDocument>
{
  private static readonly viewType = "editor.excalidraw.frame-reference";

  public static async register(
    context: vscode.ExtensionContext
  ): Promise<vscode.Disposable> {
    const provider = new ExcalidrawFrameReferenceProvider(context);

    // Register for SVG files matching the pattern: *.exp.svg
    const selector = {
      pattern: "**/*.exp.svg",
      scheme: "file",
    };

    const registration = vscode.window.registerCustomEditorProvider(
      ExcalidrawFrameReferenceProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: false },
      }
    );

    return registration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomEditor(
    document: FrameReferenceDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Set up the webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "open-source":
            // Store the pending frame center request
            await this.context.globalState.update(
              "pendingFrameCenter",
              JSON.stringify({
                frameName: `export_${document.frameName}`,
                timestamp: Date.now(),
              })
            );

            // Fire an event to notify the editor
            ExcalidrawFrameReferenceProvider._onFrameReferenceRequested.fire({
              uri: document.sourceUri.toString(),
              frameName: `export_${document.frameName}`,
            });

            // Close the preview and open the source
            webviewPanel.dispose();
            await showEditor(document.sourceUri);
            break;
        }
      },
      null,
      this.context.subscriptions
    );

    // Watch for changes to the SVG file and reload the preview
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      document.uri.fsPath,
      false,
      false,
      false
    );

    fileWatcher.onDidChange(async () => {
      // Read the updated SVG content
      const updatedSvgBytes = await vscode.workspace.fs.readFile(document.uri);
      const updatedSvg = new TextDecoder().decode(updatedSvgBytes);

      // Update the document's SVG content
      (document as any).svgContent = updatedSvg;

      // Re-render the webview with the updated content
      webviewPanel.webview.html = this.getWebviewContent(document);
    });

    // Clean up the file watcher when the panel is disposed
    webviewPanel.onDidDispose(() => {
      fileWatcher.dispose();
    });

    // Render the webview HTML
    webviewPanel.webview.html = this.getWebviewContent(document);
  }

  private getWebviewContent(document: FrameReferenceDocument): string {
    // Extract basename using VSCode Uri
    const uri = document.sourceUri;
    const pathParts = uri.path.split("/").filter(Boolean);
    const fileName = pathParts[pathParts.length - 1] || "";
    const basename = fileName.endsWith(".excalidraw") ? fileName.slice(0, -11) : fileName;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data: https:;">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      overflow: auto;
    }

    .top-bar {
      position: sticky;
      top: 0;
      right: 0;
      display: flex;
      justify-content: flex-end;
      padding: 8px;
      background: var(--vscode-editor-background);
      z-index: 100;
    }

    .open-button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border);
      padding: 6px 14px;
      font-size: 13px;
      border-radius: 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--vscode-font-family);
      transition: background 0.2s;
      white-space: nowrap;
    }

    .open-button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .open-button svg {
      flex-shrink: 0;
    }

    .svg-container {
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: calc(100vh - 50px);
    }

    .svg-container svg {
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <button class="open-button" id="openSource" title="Open source file in Excalidraw editor">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.5 3a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5h11zm-11-1A1.5 1.5 0 0 0 1 3.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 2h-11z"/>
        <path d="M5.5 4.002a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5h2zm1 0h2a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5zm3 0h2a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5z"/>
      </svg>
      Open ${basename}.excalidraw
    </button>
  </div>

  <div class="svg-container">
    ${document.svgContent}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('openSource')?.addEventListener('click', () => {
      vscode.postMessage({
        type: 'open-source'
      });
    });
  </script>
</body>
</html>`;
  }

  private static _onFrameReferenceRequested = new vscode.EventEmitter<{
    uri: string;
    frameName: string;
  }>();

  public static onFrameReferenceRequested =
    ExcalidrawFrameReferenceProvider._onFrameReferenceRequested.event;

  // These are required by CustomEditorProvider but won't be called
  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<never>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  async backupCustomDocument(
    document: vscode.CustomDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    return {
      id: "backup",
      delete: async () => {},
    };
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): Promise<FrameReferenceDocument> {
    console.log("[FrameReference] Opening document:", uri.fsPath);

    // Read the SVG file content
    const svgContentBytes = await vscode.workspace.fs.readFile(uri);
    const svgContent = new TextDecoder().decode(svgContentBytes);

    // Parse the SVG content to get frame info
    const reference = parseFrameReference(svgContent);
    console.log("[FrameReference] Parsed reference:", reference);

    if (!reference) {
      throw new Error("Invalid frame export: missing metadata");
    }

    // Resolve relative path to absolute path
    // Get directory of SVG file
    const fsPath = uri.fsPath;
    const dirParts = fsPath.split("/").filter(Boolean);
    dirParts.pop(); // Remove filename

    // Parse and resolve the relative source path
    const sourceParts = reference.sourceFilePath.split("/").filter(Boolean);
    const resolvedParts = [...dirParts];

    for (const part of sourceParts) {
      if (part === "..") {
        resolvedParts.pop();
      } else if (part !== ".") {
        resolvedParts.push(part);
      }
    }

    const absoluteSourcePath = resolvedParts.length > 0 ? "/" + resolvedParts.join("/") : "/";
    console.log("[FrameReference] Resolved source path:", absoluteSourcePath);
    const sourceUri = vscode.Uri.file(absoluteSourcePath);

    // Create the document with all necessary info
    const document: FrameReferenceDocument = {
      uri: uri,
      svgContent: svgContent,
      sourceUri: sourceUri,
      frameName: reference.frameName,
      theme: reference.theme,
      dispose: () => {},
    };

    return document;
  }

  revertCustomDocument(document: vscode.CustomDocument): Thenable<void> {
    return Promise.resolve();
  }

  saveCustomDocument(document: vscode.CustomDocument): Thenable<void> {
    return Promise.resolve();
  }

  async saveCustomDocumentAs(
    document: vscode.CustomDocument,
    destination: vscode.Uri
  ): Promise<void> {
    // No-op - we don't actually save SVG files
  }
}

type ParsedReference = ParsedFrameReference;
