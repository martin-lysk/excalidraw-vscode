import { useEffect, useState, useRef, useCallback } from "react";
import {
  Excalidraw,
  loadLibraryFromBlob,
  serializeLibraryAsJSON,
  THEME,
} from "@excalidraw/excalidraw";

import "@excalidraw/excalidraw/index.css";

import "./styles.css";
import {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import { vscode } from "./vscode.ts";
import {
  exportAllFrames,
} from "./frame-exporter.ts";

function detectTheme() {
  switch (document.body.className) {
    case "vscode-dark":
      return THEME.DARK;
    case "vscode-light":
      return THEME.LIGHT;
    default:
      return THEME.LIGHT;
  }
}

function useTheme(initialThemeConfig: string) {
  const [themeConfig, setThemeConfig] = useState(initialThemeConfig);
  const getExcalidrawTheme = () => {
    switch (themeConfig) {
      case "light":
        return THEME.LIGHT;
      case "dark":
        return THEME.DARK;
      case "auto":
        return detectTheme();
    }
  };
  const [theme, setTheme] = useState(getExcalidrawTheme());
  const updateTheme = () => {
    setTheme(getExcalidrawTheme());
  };

  useEffect(updateTheme, [themeConfig]);

  useEffect(() => {
    if (themeConfig !== "auto") return;
    const observer = new MutationObserver(() => {
      updateTheme();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      observer.disconnect();
    };
  }, [themeConfig]);

  return { theme, setThemeConfig };
}

export default function App(props: {
  initialData?: ExcalidrawInitialDataState;
  name: string;
  theme: string;
  langCode: string;
  viewModeEnabled: boolean;
  libraryItems?: LibraryItems;
  imageParams: {
    exportBackground: boolean;
    exportWithDarkMode: boolean;
    exportScale: 1 | 2 | 3;
  };
  dirty: boolean;
  onChange: (
    elements: readonly any[],
    appState: Partial<AppState>,
    files?: BinaryFiles
  ) => void;
  autoExportFrames?: boolean;
  frameExportThemes?: ("light" | "dark")[];
  frameExportDebounce?: number;
}) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const libraryItemsRef = useRef(props.libraryItems);
  const { theme, setThemeConfig } = useTheme(props.theme);
  const [imageParams, setImageParams] = useState(props.imageParams);
  const [langCode, setLangCode] = useState(props.langCode);

  // Track previous elements for frame change detection
  const [previousElements, setPreviousElements] = useState<readonly any[]>(
    props.initialData?.elements || []
  );

  // Debounced frame export handler
  const exportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const handleChange = useCallback(
    (
      elements: readonly any[],
      appState: Partial<AppState>,
      files?: BinaryFiles
    ) => {
      console.log("[App] onChange called");
      console.log("[App] autoExportFrames:", props.autoExportFrames);

      // 1. Save main file (existing behavior)
      props.onChange(elements, appState, files);

      // 2. Export frames if enabled and there are exportable frames
      if (props.autoExportFrames !== false) {
        // Check if there are any exportable frames
        const hasExportableFrames = elements.some(el =>
          el.type === 'frame' &&
          el.name !== null &&
          el.name !== undefined &&
          el.name.startsWith('export_')
        );

        console.log("[App] hasExportableFrames:", hasExportableFrames);

        if (hasExportableFrames) {
          console.log("[App] Frame export triggered!");
          // Clear any pending export
          if (exportTimeoutRef.current) {
            clearTimeout(exportTimeoutRef.current);
          }

          // Debounce export
          const debounceDelay = props.frameExportDebounce || 500;
          console.log("[App] Debouncing export by", debounceDelay, "ms");
          exportTimeoutRef.current = setTimeout(async () => {
            console.log("[App] Export timeout fired, starting export...");
            try {
              const themes = props.frameExportThemes || ["light", "dark"];
              console.log("[App] Calling exportAllFrames with themes:", themes);
              const exports = await exportAllFrames(
                elements,
                appState,
                files || {},
                themes
              );

              console.log("[App] Got", exports.length, "exports from exportAllFrames");
              if (exports.length > 0) {
                console.log("[App] Sending frame-exports message to extension");
                vscode.postMessage({
                  type: "frame-exports",
                  content: exports,
                });

                console.log("[App] Sending info toast message");
                vscode.postMessage({
                  type: "info",
                  content: `Exported ${exports.length} frame(s)`,
                });
              } else {
                console.log("[App] No exports to send");
              }
            } catch (error) {
              console.error("[App] Export failed:", error);
              vscode.postMessage({
                type: "error",
                content: `Failed to export frames: ${(error as Error).message}`,
              });
            }
          }, debounceDelay);
        } else {
          console.log("[App] No exportable frames found");
        }
      } else {
        console.log("[App] Frame export disabled");
      }

      // Update tracked elements
      setPreviousElements(elements);
    },
    [previousElements, props]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (exportTimeoutRef.current) {
        clearTimeout(exportTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!props.dirty) {
      return;
    }
    if (props.initialData) {
      const { elements, appState, files } = props.initialData;
      props.onChange(elements || [], appState || {}, files);
    } else {
      props.onChange([], { viewBackgroundColor: "#ffffff" }, {});
    }
  }, []);

  useEffect(() => {
    const listener = async (e: any) => {
      try {
        const message = e.data;
        switch (message.type) {
          case "library-change": {
            const blob = new Blob([message.library], {
              type: "application/json",
            });
            const libraryItems = await loadLibraryFromBlob(blob);
            if (
              JSON.stringify(libraryItems) ==
              JSON.stringify(libraryItemsRef.current)
            ) {
              return;
            }
            libraryItemsRef.current = libraryItems;
            excalidrawAPI?.updateLibrary({
              libraryItems,
              merge: message.merge,
              openLibraryMenu: !message.merge,
            });
            break;
          }
          case "theme-change": {
            setThemeConfig(message.theme);
            break;
          }
          case "language-change": {
            setLangCode(message.langCode);
            break;
          }
          case "image-params-change": {
            setImageParams(message.imageParams);
          }
        }
      } catch (e) {
        vscode.postMessage({
          type: "error",
          content: (e as Error).message,
        });
      }
    };
    window.addEventListener("message", listener);

    return () => {
      window.removeEventListener("message", listener);
    };
  }, [excalidrawAPI]);

  return (
    <div className="excalidraw-wrapper">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
        langCode={langCode}
        name={props.name}
        theme={theme}
        viewModeEnabled={props.viewModeEnabled}
        initialData={{
          ...props.initialData,
          libraryItems: props.libraryItems,
          scrollToContent: true,
        }}
        libraryReturnUrl={"vscode://pomdtr.excalidraw-editor/importLib"}
        onChange={(elements, appState, files) =>
          handleChange(
            elements,
            { ...appState, ...imageParams, exportEmbedScene: true },
            files
          )
        }
        onLinkOpen={(element, event) => {
          vscode.postMessage({
            type: "link-open",
            url: element.link,
          });
          event.preventDefault();
        }}
        onLibraryChange={(libraryItems) => {
          if (
            JSON.stringify(libraryItems) ==
            JSON.stringify(libraryItemsRef.current)
          ) {
            return;
          }
          libraryItemsRef.current = libraryItems;
          vscode.postMessage({
            type: "library-change",
            library: serializeLibraryAsJSON(libraryItems),
          });
        }}
      />
    </div>
  );
}
