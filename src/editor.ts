import * as vscode from "vscode";
import { Base64 } from "js-base64";

import { ExcalidrawDocument } from "./document";
import { languageMap } from "./lang";
import { showEditor } from "./commands";

/**
 * Find the git root directory by traversing up from startPath
 * Uses VSCode's cross-platform file system API
 * @param startPath - Path to start searching from
 * @returns Absolute path to git root, or null if not found
 */
async function findGitRoot(startPath: string): Promise<string | null> {
  let currentUri = vscode.Uri.file(startPath);
  const rootUri = vscode.Uri.file("/"); // Root directory

  while (currentUri.toString() !== rootUri.toString()) {
    const gitDirUri = vscode.Uri.joinPath(currentUri, ".git");
    try {
      // Try to stat the .git directory
      await vscode.workspace.fs.stat(gitDirUri);
      return currentUri.fsPath;
    } catch {
      // Directory doesn't exist, continue traversing up
      const parentPath = currentUri.fsPath.split("/").slice(0, -1).join("/") || "/";
      currentUri = vscode.Uri.file(parentPath);
    }
  }

  return null;
}

/**
 * Join path parts using VSCode Uri utilities
 */
function joinPath(basePath: string, ...pathParts: string[]): string {
  const uri = vscode.Uri.file(basePath);
  const resultUri = vscode.Uri.joinPath(uri, ...pathParts);
  return resultUri.fsPath;
}

/**
 * Get directory name using VSCode Uri utilities
 */
function dirName(filePath: string): string {
  const uri = vscode.Uri.file(filePath);
  // Remove the last path component
  const pathParts = uri.path.split("/").filter(Boolean);
  pathParts.pop();
  const parentPath = pathParts.length > 0 ? "/" + pathParts.join("/") : "/";
  // Convert back to fsPath
  return vscode.Uri.file(parentPath).fsPath;
}

/**
 * Get relative path using VSCode Uri utilities
 */
function relativePath(from: string, to: string): string {
  const fromUri = vscode.Uri.file(from);
  const toUri = vscode.Uri.file(to);

  // Simple relative path calculation
  const fromParts = fromUri.path.split("/").filter(Boolean);
  const toParts = toUri.path.split("/").filter(Boolean);

  // Find common prefix
  let commonLength = 0;
  while (commonLength < fromParts.length && commonLength < toParts.length && fromParts[commonLength] === toParts[commonLength]) {
    commonLength++;
  }

  // Build relative path
  const upLevels = fromParts.length - commonLength - 1;
  const relativeParts = [];

  for (let i = 0; i < upLevels; i++) {
    relativeParts.push("..");
  }

  relativeParts.push(...toParts.slice(commonLength));
  return relativeParts.join("/") || ".";
}

/**
 * Get basename without extension
 */
function baseName(filePath: string): string {
  const uri = vscode.Uri.file(filePath);
  const parts = uri.path.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || "";
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex >= 0 ? fileName.slice(0, lastDotIndex) : fileName;
}

export class ExcalidrawEditorProvider
  implements vscode.CustomEditorProvider<ExcalidrawDocument>
{
  public static async register(
    context: vscode.ExtensionContext
  ): Promise<vscode.Disposable> {
    const provider = new ExcalidrawEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      ExcalidrawEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      }
    );

    ExcalidrawEditorProvider.migrateLegacyLibraryItems(context);

    return providerRegistration;
  }

  private static migrateLegacyLibraryItems(context: vscode.ExtensionContext) {
    const libraryItems = context.globalState.get("libraryItems");
    if (!libraryItems) {
      return;
    }
    context.globalState
      .update(
        "library",
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          source:
            "https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor",
          libraryItems,
        })
      )
      .then(() => {
        context.globalState.update("libraryItems", undefined);
      });
  }

  private static readonly viewType = "editor.excalidraw";

  // Event emitter for frame reference requests (to be connected by extension.ts)
  public static _onFrameReferenceRequested = new vscode.EventEmitter<{
    uri: string;
    frameName: string;
  }>();
  public static onFrameReferenceRequested =
    ExcalidrawEditorProvider._onFrameReferenceRequested.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomEditor(
    document: ExcalidrawDocument,
    webviewPanel: vscode.WebviewPanel
  ) {
    const editor = new ExcalidrawEditor(
      document,
      webviewPanel.webview,
      this.context
    );
    const editorDisposable = await editor.setupWebview();

    webviewPanel.onDidDispose(() => {
      editorDisposable.dispose();
    });
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<ExcalidrawDocument>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  async backupCustomDocument(
    document: ExcalidrawDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    return document.backup(context.destination);
  }

  // TODO: Backup Support
  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): Promise<ExcalidrawDocument> {
    let content: Uint8Array;
    if (uri.scheme === "untitled") {
      content = new TextEncoder().encode(
        JSON.stringify({ type: "excalidraw", elements: [] })
      );
    } else {
      content = await vscode.workspace.fs.readFile(
        openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri
      );
    }
    const document = new ExcalidrawDocument(uri, content);

    const onDidDocumentChange = document.onDidContentChange(() => {
      this._onDidChangeCustomDocument.fire({ document });
    });

    document.onDidDispose(() => {
      onDidDocumentChange.dispose();
    });

    return document;
  }

  revertCustomDocument(document: ExcalidrawDocument): Thenable<void> {
    return document.revert();
  }

  saveCustomDocument(document: ExcalidrawDocument): Thenable<void> {
    return document.save();
  }

  async saveCustomDocumentAs(
    document: ExcalidrawDocument,
    destination: vscode.Uri
  ) {
    await document.saveAs(destination);
  }
}

export class ExcalidrawEditor {
  // Allows to pass events between editors
  private static _onDidChangeLibrary = new vscode.EventEmitter<string>();
  private static onDidChangeLibrary =
    ExcalidrawEditor._onDidChangeLibrary.event;
  private static _onLibraryImport = new vscode.EventEmitter<{
    library: string;
  }>();
  private static onLibraryImport = ExcalidrawEditor._onLibraryImport.event;
  private textDecoder = new TextDecoder();

  constructor(
    readonly document: ExcalidrawDocument,
    readonly webview: vscode.Webview,
    readonly context: vscode.ExtensionContext
  ) {
    // Check for pending frame center request
    this.checkPendingFrameCenter();

    // Listen for new frame reference requests from our own event emitter
    ExcalidrawEditorProvider.onFrameReferenceRequested((e) => {
      if (e.uri === this.document.uri.toString()) {
        this.centerOnFrame(e.frameName);
      }
    });
  }

  isViewOnly() {
    return (
      this.document.uri.scheme === "git" ||
      this.document.uri.scheme === "conflictResolution"
    );
  }

  private async checkPendingFrameCenter() {
    const pendingData = this.context.globalState.get<string>("pendingFrameCenter");
    if (!pendingData) {
      return;
    }

    try {
      const pending = JSON.parse(pendingData);
      // Check if the request is recent (within 5 seconds)
      if (Date.now() - pending.timestamp < 5000) {
        // Clear the pending request
        await this.context.globalState.update("pendingFrameCenter", undefined);

        // Send center message after a short delay to ensure the editor is ready
        setTimeout(() => {
          this.centerOnFrame(pending.frameName);
        }, 500);
      }
    } catch (error) {
      console.error("[Editor] Failed to parse pending frame center request:", error);
    }
  }

  private centerOnFrame(frameName: string) {
    this.webview.postMessage({
      type: "scroll-to-frame",
      frameName,
    });
  }

  public async setupWebview() {
    // Setup initial content for the webview
    // Receive message from the webview.
    this.webview.options = {
      enableScripts: true,
    };

    let libraryUri = await this.getLibraryUri();

    const onDidReceiveMessage = this.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "library-change":
            const library = msg.library;
            await this.saveLibrary(library, libraryUri);
            ExcalidrawEditor._onDidChangeLibrary.fire(library);
            break;
          case "change":
            await this.document.update(new Uint8Array(msg.content));
            break;
          case "link-open":
            await openLink(vscode.Uri.parse(msg.url), this.document.uri);
            break;
          case "error":
            vscode.window.showErrorMessage(msg.content);
            break;
          case "info":
            vscode.window.showInformationMessage(msg.content);
            break;
          case "frame-exports":
            await this.handleFrameExports(msg.content);
            break;
        }
      },
      this
    );

    const onDidChangeThemeConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("excalidraw.theme", this.document.uri)) {
          return;
        }
        this.webview.postMessage({
          type: "theme-change",
          theme: this.getTheme(),
        });
      }, this);

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("excalidraw.language", this.document.uri)) {
        return;
      }
      this.webview.postMessage({
        type: "language-change",
        langCode: this.getLanguage(),
      });
    }, this);

    const onDidChangeEmbedConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("excalidraw.image", this.document.uri)) {
          return;
        }
        this.webview.postMessage({
          type: "image-params-change",
          imageParams: this.getImageParams(),
        });
      }, this);

    const onDidChangeLibraryConfiguration =
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (
          !e.affectsConfiguration(
            "excalidraw.workspaceLibraryPath",
            this.document.uri
          )
        ) {
          return;
        }

        libraryUri = await this.getLibraryUri();
        const library = await this.loadLibrary(libraryUri);
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: false,
        });
      });

    const onLibraryImport = ExcalidrawEditor.onLibraryImport(
      async ({ library }) => {
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: true,
        });
      }
    );

    const onDidChangeLibrary = ExcalidrawEditor.onDidChangeLibrary(
      (library) => {
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: false,
        });
      }
    );

    const config = vscode.workspace.getConfiguration("excalidraw");

    this.webview.html = await this.buildHtmlForWebview({
      content: Array.from(this.document.content),
      contentType: this.document.contentType,
      library: await this.loadLibrary(libraryUri),
      viewModeEnabled: this.isViewOnly() || undefined,
      theme: this.getTheme(),
      imageParams: this.getImageParams(),
      langCode: this.getLanguage(),
      name: this.extractName(this.document.uri),
      autoExportFrames: config.get<boolean>("autoExportFrames", true),
      frameExportThemes: config.get("frameExportThemes", ["light", "dark"]) as ("light" | "dark")[],
      frameExportDebounce: config.get<number>("frameExportDebounce", 500),
    });

    return new vscode.Disposable(() => {
      onDidReceiveMessage.dispose();
      onDidChangeThemeConfiguration.dispose();
      onLibraryImport.dispose();
      onDidChangeLibraryConfiguration.dispose();
      onDidChangeLibrary.dispose();
      onDidChangeEmbedConfiguration.dispose();
    });
  }

  private getImageParams() {
    return vscode.workspace.getConfiguration("excalidraw").get("image");
  }

  private getLanguage() {
    return (
      vscode.workspace.getConfiguration("excalidraw").get("language") ||
      languageMap[vscode.env.language as keyof typeof languageMap]
    );
  }

  private getTheme() {
    return vscode.workspace
      .getConfiguration("excalidraw")
      .get("theme", "light");
  }

  private async handleFrameExports(exports: any[]) {
    const config = vscode.workspace.getConfiguration("excalidraw");
    const autoExport = config.get<boolean>("autoExportFrames", true);

    if (!autoExport) {
      return;
    }

    const basePath = dirName(this.document.uri.fsPath);
    const docDir = basePath;
    const exportLocation = config.get<string>("frameExportLocation", "same");

    for (const exportData of exports) {
      let exportFilePath: string;
      const pathExpression = exportData.exportPath || exportData.frameName;

      // Determine the base directory for export
      if (pathExpression.startsWith("/")) {
        // Absolute path from git root: /images/file
        const gitRoot = await findGitRoot(docDir);
        if (!gitRoot) {
          vscode.window.showErrorMessage(
            `Cannot resolve absolute path for "${pathExpression}": git root not found`
          );
          continue;
        }
        // Remove leading slash and resolve from git root
        const relativePath = pathExpression.substring(1);
        exportFilePath = joinPath(gitRoot, relativePath);
      } else {
        // Relative path: ../file or images/file or just file
        let baseDir = docDir;

        // Apply frameExportLocation setting if path doesn't start with ..
        if (exportLocation === "subfolder" && !pathExpression.startsWith("..")) {
          const subfolder = config.get<string>("frameExportSubfolder", ".exports");
          baseDir = joinPath(docDir, subfolder);
        }

        exportFilePath = joinPath(baseDir, pathExpression);
      }

      // Add filename and theme: {path}.{theme}.exp.svg
      const finalPath = `${exportFilePath}.${exportData.theme}.exp.svg`;
      const uri = vscode.Uri.file(finalPath);

      // Ensure directory exists
      const targetDir = dirName(finalPath);
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));
      } catch {
        // Directory might already exist, ignore error
      }

      // Calculate relative path from SVG to source Excalidraw file
      const absoluteSourcePath = this.document.uri.fsPath;
      const relativeSourcePath = relativePath(targetDir, absoluteSourcePath);

      // Inject relative source file path into SVG metadata
      const svgWithSourcePath = exportData.svg.replace(
        "{SOURCE_FILE_PATH}",
        relativeSourcePath
      );

      try {
        await vscode.workspace.fs.writeFile(
          uri,
          new TextEncoder().encode(svgWithSourcePath)
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to write frame export ${baseName(finalPath)}: ${
            (error as Error).message
          }`
        );
      }
    }
  }

  public extractName(uri: vscode.Uri) {
    // Use a simple string manipulation instead of path.parse
    const fsPath = uri.fsPath;
    const lastSepIndex = fsPath.lastIndexOf('/');
    if (lastSepIndex === -1) {
      // No path separator, return the whole path minus extension
      const name = fsPath;
      return name.endsWith(".excalidraw") ? name.slice(0, -11) : name;
    }
    const name = fsPath.slice(lastSepIndex + 1);
    return name.endsWith(".excalidraw") ? name.slice(0, -11) : name;
  }

  public async getLibraryUri() {
    const libraryPath = await vscode.workspace
      .getConfiguration("excalidraw")
      .get<string>("workspaceLibraryPath");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!libraryPath || !workspaceFolders) {
      return;
    }

    const fileWorkspace = getFileWorkspaceFolder(
      this.document.uri,
      workspaceFolders as vscode.WorkspaceFolder[]
    );
    if (!fileWorkspace) {
      return;
    }

    return vscode.Uri.joinPath(fileWorkspace.uri, libraryPath);
  }

  public static importLibrary(library: string) {
    this._onLibraryImport.fire({ library });
  }

  public async loadLibrary(libraryUri?: vscode.Uri) {
    if (!libraryUri) {
      return this.context.globalState.get<string>("library");
    }
    try {
      const libraryContent = await vscode.workspace.fs.readFile(libraryUri);
      return this.textDecoder.decode(libraryContent);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to load library: ${e}`);
      return this.context.globalState.get<string>("library");
    }
  }

  public async saveLibrary(library: string, libraryUri?: vscode.Uri) {
    if (!libraryUri) {
      return this.context.globalState.update("library", library);
    }
    try {
      await vscode.workspace.fs.writeFile(
        libraryUri,
        new TextEncoder().encode(library)
      );
    } catch (e) {
      await vscode.window.showErrorMessage(`Failed to save library: ${e}`);
    }
  }

  private async buildHtmlForWebview(config: any): Promise<string> {
    const webviewUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "webview",
      "dist"
    );
    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(webviewUri, "index.html")
    );
    let html = this.textDecoder.decode(content);

    html = html.replace(
      "{{data-excalidraw-config}}",
      Base64.encode(JSON.stringify(config))
    );

    html = html.replace(
      "{{excalidraw-asset-path}}",
      `${this.webview.asWebviewUri(webviewUri).toString()}/`
    );

    return this.fixLinks(html, webviewUri);
  }
  private fixLinks(document: string, documentUri: vscode.Uri): string {
    return document.replace(
      new RegExp("((?:src|href)=['\"])(.*?)(['\"])", "gmi"),
      (subString: string, p1: string, p2: string, p3: string): string => {
        const lower = p2.toLowerCase();
        if (
          p2.startsWith("#") ||
          lower.startsWith("http://") ||
          lower.startsWith("https://")
        ) {
          return subString;
        }
        const newUri = vscode.Uri.joinPath(documentUri, p2);
        const newUrl = [p1, this.webview.asWebviewUri(newUri), p3].join("");
        return newUrl;
      }
    );
  }
}

function getFileWorkspaceFolder(
  uri: vscode.Uri,
  workspaceFolders: vscode.WorkspaceFolder[]
): vscode.WorkspaceFolder | undefined {
  // VSCode URIs always use forward slashes
  const parts = uri.path.split('/').slice(0, -1);
  while (parts.length > 0) {
    const joined = parts.join('/');
    const folder = workspaceFolders.find((f) => f.uri.path === joined);
    if (folder) {
      return folder;
    }
    parts.pop();
  }
}

async function openLink(uri: vscode.Uri, source: vscode.Uri): Promise<void> {
  if (uri.scheme !== "file") {
    await vscode.env.openExternal(uri);
    return;
  }

  const targetUri = vscode.Uri.joinPath(source, "..", uri.path);
  try {
    // Ensure the resource exists and is a file
    const stat = await vscode.workspace.fs.stat(targetUri);
    if (stat.type !== vscode.FileType.File) {
      throw new Error(`${targetUri.fsPath} is not a file`);
    }
  } catch (e) {
    // Otherwise, open it externally
    await vscode.env.openExternal(uri);
    return;
  }

  const extensions = [
    ".excalidraw",
    ".excalidraw.json",
    ".excalidraw.png",
    ".excalidraw.svg",
  ];
  for (const ext of extensions) {
    if (targetUri.fsPath.endsWith(ext)) {
      await showEditor(targetUri);
      return;
    }
  }

  await vscode.window.showTextDocument(targetUri, {
    preview: true,
  });
}
