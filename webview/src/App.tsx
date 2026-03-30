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
      // 1. Save main file (existing behavior)
      props.onChange(elements, appState, files);

      // 2. Export frames if enabled and there are exportable frames
      if (props.autoExportFrames !== false) {
        // Check if there are any exportable frames (using the same check as exportAllFrames)
        const hasExportableFrames = elements.some(el =>
          el.type === 'frame' &&
          el.name !== null &&
          el.name !== undefined &&
          el.name.startsWith('export_') &&
          !el.isDeleted // Exclude deleted frames
        );

        if (hasExportableFrames) {
          // Clear any pending export
          if (exportTimeoutRef.current) {
            clearTimeout(exportTimeoutRef.current);
          }

          // Debounce export
          const debounceDelay = props.frameExportDebounce || 500;
          exportTimeoutRef.current = setTimeout(async () => {
            try {
              const themes = props.frameExportThemes || ["light", "dark"];
              const exports = await exportAllFrames(
                elements,
                appState,
                files || {},
                themes
              );

              if (exports.length > 0) {
                vscode.postMessage({
                  type: "frame-exports",
                  content: exports,
                });
              }
            } catch (error) {
              console.error("[App] Export failed:", error);
              vscode.postMessage({
                type: "error",
                content: `Failed to export frames: ${(error as Error).message}`,
              });
            }
          }, debounceDelay);
        }
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

  /**
   * Scroll to a specific frame by name
   * @param frameName - The name of the frame to scroll to (including export_ prefix)
   */
  const scrollToFrame = useCallback(
    (frameName: string) => {
      if (!excalidrawAPI) {
        return;
      }

      // Get the current scene elements
      const elements = excalidrawAPI.getSceneElements();

      // Find the frame element
      const frame = elements.find(
        (el: any) => el.type === "frame" && el.name === frameName
      );

      if (!frame) {
        vscode.postMessage({
          type: "error",
          content: `Frame "${frameName}" not found in the document`,
        });
        return;
      }

      // Use scrollToContent to scroll to the frame
      excalidrawAPI.scrollToContent(
        [frame],
        {
          duration: 500, // Smooth scroll animation
          fitToContent: true, // Fit the frame in view
        }
      );
    },
    [excalidrawAPI]
  );

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
            break;
          }
          case "scroll-to-frame": {
            scrollToFrame(message.frameName);
            break;
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
