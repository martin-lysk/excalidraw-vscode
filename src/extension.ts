import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { ExcalidrawUriHandler } from "./uri-handler";
import { ExcalidrawEditorProvider } from "./editor";
import { ExcalidrawFrameReferenceProvider } from "./frame-reference";

export async function activate(context: vscode.ExtensionContext) {
  console.log("[Extension] Activating Excalidraw extension");

  // Register the main editor provider
  context.subscriptions.push(await ExcalidrawEditorProvider.register(context));
  console.log("[Extension] Main editor provider registered");

  // Register the frame reference provider
  // Note: No longer uses Node.js modules, works in both desktop and web
  context.subscriptions.push(await ExcalidrawFrameReferenceProvider.register(context));
  console.log("[Extension] Frame reference provider registered");

  // Wire up frame reference events to the editor provider
  context.subscriptions.push(
    ExcalidrawFrameReferenceProvider.onFrameReferenceRequested((e) => {
      console.log("[Extension] Frame reference requested:", e);
      ExcalidrawEditorProvider._onFrameReferenceRequested.fire(e);
    })
  );

  context.subscriptions.push(ExcalidrawUriHandler.register());
  registerCommands(context);

  console.log("[Extension] Activation complete");
}
