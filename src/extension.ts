import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { ExcalidrawEditorProvider } from "./editor";
import { ExcalidrawUriHandler } from "./uri-handler";
import { ExcalidrawFrameReferenceProvider } from "./frame-reference";

export async function activate(context: vscode.ExtensionContext) {
  // Register our custom editor providers
  context.subscriptions.push(await ExcalidrawEditorProvider.register(context));
  context.subscriptions.push(await ExcalidrawFrameReferenceProvider.register(context));
  context.subscriptions.push(ExcalidrawUriHandler.register());
  registerCommands(context);
}
